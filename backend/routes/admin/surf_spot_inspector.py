"""Admin · Surf Forecast · Spot inspector: what the ONE forecast chain did at one spot, and with what geometry.

READ-ONLY and cheap on the one 1-CPU box that serves production:
- the geometry comes from `surf_point.resolve_surf_geometry` (the offline git asset, the same call the chain makes);
- the ratings are the PRECOMPUTED `rate_one_spot` frames already in the served L2 object (cached read, off the event
  loop). Nothing here calls estimate_surf_at or fetches weather, so the inspector can never become a second forecast
  path (ONE FORECAST COMPOSITION) and an admin looking at spots cannot load the box.
- the spot's local size reference comes from the spot size climatology (also a cached L2 read).

  GET /admin/surf-forecast/spots?q=...            search the catalogue by name (max 25)
  GET /admin/surf-forecast/spots/{spot_id}        catalogue row + geometry + every precomputed frame for the spot
"""
import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from deps.admin_auth import get_current_admin
from models import Profile, SurfSpot

logger = logging.getLogger(__name__)
router = APIRouter()

# The per-spot fields of a precomputed frame worth showing (rate_one_spot's output); bulky replay inputs are left out.
FRAME_FIELDS = ("score", "level", "surf_height_m", "period_s", "swell_from_deg", "offshore_hs_m", "primary_swell_hs_m",
                "limiter", "limiter_f", "why", "directional_conflict", "geometry_readiness", "confidence",
                "forecast_confidence", "reference_size_m", "tide", "confirmed")
GEOMETRY_FIELDS = ("shore_normal_deg", "shore_normal_src", "shore_normal_match_km", "swell_normal_deg",
                   "break_depth_m", "depth_m", "shelf_width_km", "coastal", "nearshore", "magnet_factor", "magnet_name")


def _spot_row(s: SurfSpot) -> dict:
    return {"id": s.id, "name": s.name, "latitude": s.latitude, "longitude": s.longitude,
            "country": getattr(s, "country", None), "region": getattr(s, "state_province", None),
            "accuracy_flag": getattr(s, "accuracy_flag", None), "is_verified_peak": getattr(s, "is_verified_peak", None)}


def geometry_for(lat: float, lng: float) -> dict:
    """The chain's own geometry at the coordinate; never raises (an error is reported, not thrown)."""
    try:
        from services.weather_pipeline.surf_point import resolve_surf_geometry
        geo = resolve_surf_geometry(lat, lng)
    except Exception as e:  # the inspector reports, it does not fail
        return {"error": str(e)}
    if geo is None:
        return {"error": "no geometry at this coordinate"}
    return {k: getattr(geo, k, None) for k in GEOMETRY_FIELDS}


def frames_for(obj: Optional[dict], spot_id: str) -> list:
    """Every precomputed frame's entry for `spot_id`, oldest valid time first, with its model and hour."""
    out = []
    for fr in (obj or {}).get("frames") or []:
        for s in fr.get("spots") or []:
            if str(s.get("spot_id")) == str(spot_id):
                row = {"model": fr.get("model"), "valid_time": fr.get("valid_time"),
                       "hour_offset": fr.get("hour_offset")}
                row.update({k: s.get(k) for k in FRAME_FIELDS if k in s})
                out.append(row)
                break
    out.sort(key=lambda r: (str(r.get("valid_time") or ""), str(r.get("model") or "")))
    return out


@router.get("/admin/surf-forecast/spots")
async def search_spots(q: str = Query("", max_length=80), admin: Profile = Depends(get_current_admin),
                       db: AsyncSession = Depends(get_db)):
    term = q.strip()
    stmt = select(SurfSpot).order_by(SurfSpot.name).limit(25)
    if term:
        stmt = stmt.where(SurfSpot.name.ilike(f"%{term}%"))
    rows = (await db.execute(stmt)).scalars().all()
    return {"spots": [_spot_row(s) for s in rows]}


@router.get("/admin/surf-forecast/spots/{spot_id}")
async def inspect_spot(spot_id: str, admin: Profile = Depends(get_current_admin), db: AsyncSession = Depends(get_db)):
    spot = (await db.execute(select(SurfSpot).where(SurfSpot.id == spot_id))).scalar_one_or_none()
    if spot is None:
        raise HTTPException(status_code=404, detail="Surf spot not found")
    out = {"spot": _spot_row(spot)}
    out["geometry"] = (await asyncio.to_thread(geometry_for, spot.latitude, spot.longitude)
                       if spot.latitude is not None and spot.longitude is not None
                       else {"error": "the spot has no coordinates"})
    try:
        from services.weather_pipeline.spot_ratings_precompute import load_spot_ratings_l2_cached
        obj = await asyncio.to_thread(load_spot_ratings_l2_cached)
        # The scan walks every frame x every spot, so it runs off the event loop too (advisor, #1031).
        frames = await asyncio.to_thread(frames_for, obj, spot_id)
        out["ratings"] = {"generated_at": (obj or {}).get("generated_at"), "frames": frames}
    except Exception as e:
        out["ratings"] = {"error": str(e)}
    try:
        from services.weather_pipeline.spot_size_climatology import load_size_climatology_l2_cached
        clim = await asyncio.to_thread(load_size_climatology_l2_cached)
        rec = ((clim or {}).get("spots") or {}).get(str(spot_id))
        out["size_climatology"] = rec if isinstance(rec, dict) else None
    except Exception as e:
        out["size_climatology"] = {"error": str(e)}
    return out
