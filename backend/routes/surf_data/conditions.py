from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Optional, Dict, Any
from datetime import datetime, timedelta, timezone
import httpx
import logging
import os

from database import get_db
from models import SurfSpot

# Weather pipeline point resolution
from services.weather_pipeline.point_resolution import PointResolutionService
from services.weather_pipeline.sampler import PointSampler
from services.weather_pipeline.providers.open_meteo_provider import OpenMeteoProvider
from services.conditions_labels import get_conditions_label
from services.weather_pipeline.spot_conditions import hourly_breaking_forecast
from services.weather_pipeline.surf_point import resolve_surf_geometry

point_sampler = PointSampler()
open_meteo_provider = OpenMeteoProvider()
point_resolution_service = PointResolutionService(
    sampler=point_sampler,
    provider=open_meteo_provider
)

router = APIRouter()
logger = logging.getLogger(__name__)

OPEN_METEO_MARINE_URL = "https://marine-api.open-meteo.com/v1/marine"
NOAA_TIDES_URL = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter"

REGION_TIDE_STATIONS = {
    "Northeast Florida": "8720030",
    "Central Florida": "8721604",
    "Treasure Coast": "8722670",
    "Southeast Florida": "8723214",
    "Miami": "8723214",
}

# ★ BOUNDED + PARALLEL (2026-08-09, MASTER-AUDIT-11.0 §3.3). This route was uncapped and strictly
# serial: 250 spot_ids produced 250 serial DB round trips + 250 serial upstream resolutions in ONE
# unauthenticated request (measured 95.9x slower than the gather equivalent; ~0.431 s/spot live —
# 60 ids blew past the Netlify proxy window). The bounds are /spot-ratings' own, one file away:
# the 200-spot cap mirrors its `le=200`, and the semaphore reads the SAME env var so one number
# governs both call sites instead of two caps that drift.
from services.weather_pipeline.config_env import env_int

BATCH_MAX_SPOTS = 200
# lo=1: Semaphore(0) is a request that never returns, not a setting (MC-08's deadlock input;
# weather.py's twin clamped this SAME var while this site did not — MC-09 makes them one policy).
_BATCH_CONCURRENCY = env_int("SPOT_RATINGS_CONCURRENCY", 6, lo=1, hi=64)


@router.get("/conditions/batch")
async def get_batch_conditions(
    spot_ids: str = "",
    model: str = Query("GFS", pattern="^(GFS|ICON|EURO)$"),
    db: AsyncSession = Depends(get_db)
):
    import asyncio

    if not spot_ids:
        return {"conditions": {}}

    ids = [id.strip() for id in spot_ids.split(",") if id.strip()]
    truncated = len(ids) > BATCH_MAX_SPOTS
    if truncated:
        logger.warning(f"/conditions/batch truncated {len(ids)} spot_ids to {BATCH_MAX_SPOTS}")
        ids = ids[:BATCH_MAX_SPOTS]

    # ONE query instead of one per id; missing ids are simply absent, exactly as before.
    result = await db.execute(select(SurfSpot).where(SurfSpot.id.in_(ids)))
    spots_by_id = {s.id: s for s in result.scalars().all()}

    sem = asyncio.Semaphore(_BATCH_CONCURRENCY)

    async def one(spot_id, spot):
        async with sem:
            try:
                data = await point_resolution_service.resolve_spot_conditions(
                    model=model, lat=spot.latitude, lng=spot.longitude, forecast_days=1,
                    spot_id=spot_id
                )
                if data and "current_conditions" in data:
                    current = data["current_conditions"]
                    return spot_id, {
                        "wave_height_ft": current["wave_height_ft"],
                        "wave_direction": current["wave_direction"],
                        "wave_period": current["wave_period"],
                        "swell_height_ft": current["swell_height_ft"],
                        "label": current["label"],
                        "updated_at": current["updated_at"]
                    }
            except Exception as e:
                # WS-CAN-0009: the exception is LOGGED, never returned — `str(e)` on a wire any
                # client can reach leaks internal paths, driver text and upstream URLs.
                # ⚠️ THE ENTRY STAYS. I first omitted the spot, and
                # `test_response_shape_and_input_order_match_the_serial_implementation` caught it:
                # a failed spot is deliberately KEPT in `conditions`, in input order, because this
                # is a PARTIAL-SUCCESS surface and "this one failed" is a real answer about it.
                # Omitting it would have made failure indistinguishable from an unknown id.
                logger.error(f"Error fetching conditions for {spot_id} via service: {str(e)}")
                return spot_id, {"error": "Unable to fetch conditions"}
        return spot_id, None

    results = dict(await asyncio.gather(
        *(one(sid, spots_by_id[sid]) for sid in ids if sid in spots_by_id)))
    # Rebuild in INPUT order so the payload is byte-comparable with the serial implementation.
    conditions = {sid: results[sid] for sid in ids if results.get(sid) is not None}

    out = {"conditions": conditions}
    # ⛔ NEVER raise here: this is a PARTIAL-SUCCESS surface serving up to 200 spots, and one
    # upstream failure must not fail the other 199. The per-spot entry already says which failed;
    # this lifts it to the top level so a caller can branch on it WITHOUT type-sniffing every value.
    # ⚠️ RESIDUAL, and it is client-side: `useExploreData.js:32` spreads each entry into the UI
    # state map, so an error entry still becomes `wave_height_ft: undefined` — blank data rather
    # than a stated failure. Fixing that needs the frontend, which is frozen (WS-CAN-0039).
    # Additive and only when it happened, exactly like `truncated_to` below.
    _failed = [sid for sid, v in conditions.items() if isinstance(v, dict) and "error" in v]
    if _failed:
        out["failed"] = _failed
    if truncated:
        out["truncated_to"] = BATCH_MAX_SPOTS   # additive key, only present when it happened
    return out

@router.get("/conditions/{spot_id}")
async def get_spot_conditions(
    spot_id: str,
    model: str = Query("GFS", pattern="^(GFS|ICON|EURO)$"),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(SurfSpot).where(SurfSpot.id == spot_id))
    spot = result.scalar_one_or_none()
    
    if not spot:
        raise HTTPException(status_code=404, detail="Surf spot not found")
    
    try:
        data = await point_resolution_service.resolve_spot_conditions(
            model=model, lat=spot.latitude, lng=spot.longitude, forecast_days=2, spot_id=spot_id
        )
        if data and "current_conditions" in data:
            current = data["current_conditions"]
            
            raw_point = await point_resolution_service.provider.fetch_point(
                model=model, domain="marine", layer="waves", lat=spot.latitude, lng=spot.longitude, forecast_days=1
            )
            # ⛔⛔ THIS LOOP USED TO BE `height * 3.28084`, i.e. the OFFSHORE significant wave height
            # served under `wave_height_ft` — THE SAME FIELD NAME `current` uses for the BREAKING
            # height, in the same payload, with a human label applied to it. Measured live
            # 2026-08-03: Sebastian Inlet current 2.90 ft vs forecast[0] 1.10 ft (0.38x, "Knee High"
            # vs "Ankle High"); Mavericks 4.80 vs 5.20 (1.08x, "Chest High" vs "Head High"). Signed
            # BOTH ways, so no constant could reconcile them — only the geometry, which is the
            # binding ONE FORECAST COMPOSITION rule. The composition now lives in
            # `spot_conditions.hourly_breaking_forecast`, beside the `_breaking_ft` that `current`
            # already used, so this route MIRRORS the one chain rather than being a second path.
            # ⚠️ Geometry is resolved ONCE here and reused across all hours — arithmetic, not I/O.
            geometry = resolve_surf_geometry(spot.latitude, spot.longitude)
            forecast = hourly_breaking_forecast(
                spot.latitude, spot.longitude, (raw_point or {}).get("hourly"), geometry, limit=6)
            
            return {
                "spot_id": spot_id,
                "spot_name": spot.name,
                "current": {
                    "wave_height_ft": current["wave_height_ft"],
                    "wave_direction": current["wave_direction"],
                    "wave_period": current["wave_period"],
                    "swell_height_ft": current["swell_height_ft"],
                    "swell_direction": current.get("swell_direction"),
                    "swell_period": current.get("wave_period"),
                    "label": current["label"],
                    "updated_at": current["updated_at"],
                    # ⛔ THIS DICT IS A WHITELIST, AND THAT IS THE DEFECT CLASS IT BELONGS TO.
                    # Everything the producer (`spot_conditions.resolve_spot_conditions`) attaches
                    # beyond the eight names above is dropped here, silently. `forecast_confidence`
                    # was attached at `spot_conditions.py:452` in `0998af5d` and the SpotConditions.js
                    # block written to render it — and it could never arrive, because this literal
                    # never listed it. Measured in MASTER-AUDIT-10.0 §1.2 by executing this handler:
                    # producer emitted 9 keys, response `current` carried 8; control wave_height_ft
                    # survived. ★ A hand-listed response whitelist is a second wire boundary with the
                    # same failure mode as an undeclared Pydantic field — if you add a field to the
                    # producer for this surface, it must be added HERE too.
                    # Absent-unless-it-binds, mirroring the producer's own contract.
                    **({"forecast_confidence": current["forecast_confidence"]}
                       if current.get("forecast_confidence") else {}),
                },
                "forecast": forecast
            }
        else:
            raise HTTPException(status_code=502, detail="Unable to fetch conditions")

    except HTTPException:
        raise                      # 404 spot-not-found and the 502 above are already honest
    except Exception as e:
        # WS-CAN-0009: a failed request must not answer 200. ⚠️ 502, NOT 503 — `apiClient.js`
        # toasts 503 globally ("Service temporarily unavailable"), so a single spot failing
        # behind the explore feed would interrupt the user; 502 falls through to the
        # caller's own catch. The exception is logged, never returned (it leaked `str(e)`).
        logger.error(f"Error fetching conditions for {spot_id}: {str(e)}")
        raise HTTPException(status_code=502, detail="Unable to fetch conditions")


@router.get("/conditions/forecast/{spot_id}")
async def get_spot_forecast(
    spot_id: str,
    days: int = 10,
    model: str = Query("GFS", pattern="^(GFS|ICON|EURO)$"),
    db: AsyncSession = Depends(get_db)
):
    """
    Get multi-day surf forecast for a spot.
    Returns daily wave height ranges and conditions.
    Tiered access: Free/Basic = 3 days, Premium = 10 days
    """
    result = await db.execute(select(SurfSpot).where(SurfSpot.id == spot_id))
    spot = result.scalar_one_or_none()
    
    if not spot:
        raise HTTPException(status_code=404, detail="Surf spot not found")
    
    try:
        data = await point_resolution_service.resolve_spot_conditions(
            model=model, lat=spot.latitude, lng=spot.longitude, forecast_days=min(days, 10),
            spot_id=spot_id
        )
        if data and "forecast" in data:
            forecast = data["forecast"][:days]
            return {
                "spot_id": spot_id,
                "spot_name": spot.name,
                "forecast": forecast,
                "source": f"Unified PointResolutionService ({model})",
                "updated_at": datetime.now(timezone.utc).isoformat()
            }
        else:
            raise HTTPException(status_code=502, detail="Unable to fetch forecast")
            
    except HTTPException:
        raise
    except Exception as e:
        # WS-CAN-0009: 502, NOT 503 — apiClient.js toasts 503 globally; 502 falls through to the
        # caller's own catch. The exception is logged, never returned.
        logger.error(f"Error fetching forecast for {spot_id}: {str(e)}")
        raise HTTPException(status_code=502, detail="Unable to fetch forecast")

@router.get("/tides/{spot_id}")
async def get_spot_tides(spot_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(SurfSpot).where(SurfSpot.id == spot_id))
    spot = result.scalar_one_or_none()
    
    if not spot:
        raise HTTPException(status_code=404, detail="Surf spot not found")
    
    # ── GLOBAL TIDE (2026-07-29). ─────────────────────────────────────────────────────────────
    # This endpoint used to pick a NOAA CO-OPS station from REGION_TIDE_STATIONS, a FIVE-ENTRY map
    # whose every entry is a Florida region, defaulting to 8721604 = Trident Pier, Port Canaveral FL.
    # Measured against production: 1,743 of 1,773 active spots across 491 distinct regions took that
    # default, so 98.3% of the catalogue — Pipeline, Nazare, Teahupo'o and every newly pinned spot
    # anywhere on Earth — was served FLORIDA tide times stamped with its own spot_id. Same class of
    # defect as the fabricated GFS zeros (a44d5d23): confidently-wrong data rendered as authoritative,
    # and worse, because a tide time looks entirely plausible.
    #
    # `services/weather_pipeline/tide.py` exists precisely to replace that path — its header says it
    # "deliberately sidesteps the NOAA CO-OPS path (US stations only + needs a per-spot station map)"
    # because a lat/lng source "covers every spot worldwide with no schema change". It was only ever
    # wired into the rating. Routing this endpoint through it means ONE tide source, not two, which
    # is the same ONE FORECAST COMPOSITION rule the surf chain follows.
    #
    # Response shape is unchanged (tides[].time/height/type + current_status) so SpotConditions.js
    # needs no change. `station_id` is retained for compatibility and now reports the real source.
    # Heights are metres from Open-Meteo, converted to FEET here because the UI prints "ft".
    # Kill: TIDES_GLOBAL_SOURCE=0 restores the NOAA/Florida path byte-identically.
    if os.environ.get("TIDES_GLOBAL_SOURCE", "1") != "0":
        try:
            from services.weather_pipeline.tide import (
                fetch_tide_hourly, tide_extrema, tide_trend_at)
            series = await fetch_tide_hourly(spot.latitude, spot.longitude)
            if series:
                events = tide_extrema(series.get("time"), series.get("level"))
                now_utc = datetime.now(timezone.utc)
                tides = [{
                    "time": e["time"].strftime("%Y-%m-%dT%H:%M:%SZ"),
                    "height": round(e["level_m"] * 3.28084, 2),
                    "type": e["type"],
                } for e in events if e["time"] >= now_utc - timedelta(hours=6)]
                if tides:
                    return {
                        "spot_id": spot_id,
                        "station_id": "open-meteo:sea_level_height_msl",
                        "source": "global",
                        "tides": tides,
                        "current_status": tide_trend_at(events, now_utc),
                    }
            # No usable series -> say so. NEVER fall through to another region's tides: serving
            # Florida to a spot in Portugal is what this change exists to stop.
            logger.info(f"[tides] no global tide series for spot {spot_id} "
                        f"({spot.latitude},{spot.longitude})")
            return {"error": "Tide data unavailable for this location", "spot_id": spot_id,
                    "source": "global"}
        except Exception as e:
            # ⛔ This is the FAILURE twin of the absence path above, and it used to answer with the
            # SAME sentence — "unavailable for this location" asserts something about the WORLD.
            # A lookup that threw knows nothing about the location. Absence stays 200; this does not.
            logger.error(f"[tides] global tide lookup failed for {spot_id}: {e}")
            raise HTTPException(status_code=502, detail="Unable to fetch tide data")

    station_id = REGION_TIDE_STATIONS.get(spot.region, "8721604")

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(NOAA_TIDES_URL, params={
                "begin_date": datetime.now().strftime("%Y%m%d"),
                "end_date": (datetime.now()).strftime("%Y%m%d"),
                "station": station_id,
                "product": "predictions",
                "datum": "MLLW",
                "time_zone": "lst_ldt",
                "units": "english",
                "interval": "hilo",
                "format": "json"
            })
            
            if response.status_code == 200:
                data = response.json()
                predictions = data.get("predictions", [])
                
                tides = []
                for p in predictions:
                    tide_type = "High" if p.get("type") == "H" else "Low"
                    tides.append({
                        "time": p.get("t"),
                        "height": p.get("v"),
                        "type": tide_type
                    })
                
                current_status = None
                now = datetime.now()
                
                for i, tide in enumerate(tides):
                    tide_time = datetime.strptime(tide["time"], "%Y-%m-%d %H:%M")
                    if tide_time > now:
                        if i > 0:
                            prev_tide = tides[i-1]
                            if prev_tide["type"] == "Low":
                                current_status = "Rising"
                            else:
                                current_status = "Falling"
                        break
                
                return {
                    "spot_id": spot_id,
                    "station_id": station_id,
                    "tides": tides,
                    "current_status": current_status
                }
            else:
                raise HTTPException(status_code=502, detail="Unable to fetch tide data")
                
    except HTTPException:
        raise
    except Exception as e:
        # WS-CAN-0009: 502, NOT 503 — apiClient.js toasts 503 globally; 502 falls through to the
        # caller's own catch. The exception is logged, never returned.
        logger.error(f"Error fetching tides for {spot_id}: {str(e)}")
        raise HTTPException(status_code=502, detail="Unable to fetch tide data")
