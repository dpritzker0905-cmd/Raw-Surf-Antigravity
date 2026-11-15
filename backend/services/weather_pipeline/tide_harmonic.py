"""tide_harmonic.py - official NOAA CO-OPS harmonic tide where a station is near, read from the products bucket.

Plan + pre-registered gate: docs/weather-program/log/2026-11-15-claude-tide-harmonic-plan.md (owner chose eta option
(B) "Tide + Surge", 2026-11-15). Served through the ONE door, `tide.fetch_tide_hourly`, so the infobox, the Tides
overlay, the hub, the glyph card and the rating all read the same numbers.

- The daily CI job (`scripts/tide_harmonic_ingest.py`) writes `tides/coops/index.json` (the harmonic stations that
  serve a catalogued spot) and `tides/coops/<station>.json` (hourly MSL predictions from yesterday to +15 days, the
  CO-OPS high/low events, and `model_offset_m`). Render ONLY reads the bucket: zero CO-OPS calls at serve time,
  one read per station per process per TTL.
- A point uses the nearest indexed station within RADIUS_KM (gate G3, leave-one-out: the neighbour beat the model's
  median error in every bucket up to 100 km); else the model (tide.py, local datum).
- `level` = the harmonic prediction (astronomical tide, station MSL): what every surface DISPLAYS, and eta while the
  surge term below is held off (TIDE_SURGE_RESIDUAL, gate G10).
  `water_level` = level + the model's non-tidal residual (eta, the breaking-depth cap): residual = 25 h running mean of
  (model raw level - harmonic) - model_offset_m (the model's stable per-place offset, from 14 past days in CI), so a
  multi-day surge survives. Outside the model's ~72 h the residual is unknown and water_level = level.
- Never raises: any failure serves the model, as before. Kill: TIDE_HARMONIC=0.
"""
import asyncio
import logging
import math
import os
import time
from datetime import datetime, timezone
from typing import Callable, Dict, Optional

try:
    from services import runtime_flags as _rf
except ImportError:                                   # pragma: no cover - script context
    _rf = None

logger = logging.getLogger(__name__)

INDEX_KEY = "tides/coops/index.json"
STATION_KEY = "tides/coops/{sid}.json"
RADIUS_KM = 100.0            # gate G3 (2026-11-15): largest bucket where the neighbour's median error beat the model's
SOURCE = "noaa_coops_harmonic"
_TTL_S = 6 * 3600.0
_FAIL_S = 300.0
_TIMEOUT_S = 3.0
_LOWPASS_H = 25              # one tidal day: removes the diurnal and semidiurnal bands from (model - harmonic)
_LOWPASS_MIN = 13

_cache: Dict[str, dict] = {}       # key -> {"ts", "doc", "fail_until"}
_locks: Dict[str, asyncio.Lock] = {}
_fetch: Optional[Callable] = None  # tests inject an async (key) -> dict | None


def harmonic_on() -> bool:
    return _rf is None or _rf.flag("TIDE_HARMONIC") != "0"


def surge_on() -> bool:
    """TIDE_SURGE_RESIDUAL (owner's eta option B), HELD OFF by its own pre-registered gate G10 (2026-11-15): against CO-OPS
    observed water level, 20 stations x 7 days, tide + residual 0.284 m median RMSE vs the tide alone 0.248 m (it won
    big where a real surge ran, Sandy Hook 0.350 -> 0.126 m, and lost in the Southeast, Charleston 0.106 -> 0.351 m).
    OFF: water_level = level (eta = the official tide, itself better than the model's 0.354 m)."""
    return _rf is not None and _rf.flag("TIDE_SURGE_RESIDUAL") == "1"


def km(lat1, lng1, lat2, lng2) -> float:
    la1, lo1, la2, lo2 = map(math.radians, (lat1, lng1, lat2, lng2))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 6371.0 * 2 * math.asin(math.sqrt(min(1.0, h)))


def nearest_station(index: Optional[dict], lat, lng, radius_km: float = RADIUS_KM) -> Optional[dict]:
    """PURE: the nearest indexed station within radius_km, as {id, name, lat, lng, distance_km}, or None."""
    best = None
    for sid, s in ((index or {}).get("stations") or {}).items():
        try:
            d = km(float(lat), float(lng), float(s["lat"]), float(s["lng"]))
        except (KeyError, TypeError, ValueError):
            continue
        if d <= radius_km and (best is None or d < best["distance_km"]):
            best = {"id": str(sid), "name": s.get("name") or str(sid), "lat": float(s["lat"]), "lng": float(s["lng"]),
                    "distance_km": round(d, 1)}
    return best


def _parse(t) -> Optional[datetime]:
    if isinstance(t, datetime):
        dt = t
    else:
        try:
            dt = datetime.fromisoformat(str(t).replace("Z", "+00:00"))
        except ValueError:
            return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def lowpass_residual(times, model_raw, harmonic, model_offset_m) -> Dict[datetime, float]:
    """PURE: {hour: non-tidal residual} where the model and the harmonic series overlap. residual = centered 25 h
    running mean of (model raw - harmonic) minus the model's stable per-place offset. Windows with fewer than
    _LOWPASS_MIN samples (edges, gaps) are dropped, never extrapolated."""
    if model_offset_m is None:
        return {}
    diff = {}
    for t in times:
        m, h = model_raw.get(t), harmonic.get(t)
        if isinstance(m, (int, float)) and isinstance(h, (int, float)) and math.isfinite(m) and math.isfinite(h):
            diff[t] = m - h
    keys = sorted(diff)
    half = _LOWPASS_H // 2
    out = {}
    for t in keys:
        win = [diff[u] for u in keys if abs((u - t).total_seconds()) <= half * 3600]
        if len(win) >= _LOWPASS_MIN:
            out[t] = sum(win) / len(win) - float(model_offset_m)
    return out


def combine(model: Optional[dict], doc: dict, station: dict) -> Optional[dict]:
    """PURE: the served series for a harmonic point. `model` is tide.py's local-datum model series (or None);
    `doc` the station object from the bucket. Shape = fetch_tide_hourly's, plus water_level, events, source, station."""
    ser = (doc or {}).get("series") or {}
    times, levels = ser.get("time"), ser.get("level")
    if not isinstance(times, list) or not isinstance(levels, list) or len(times) != len(levels) or len(times) < 2:
        return None
    parsed = [_parse(t) for t in times]
    harm = {t: v for t, v in zip(parsed, levels) if t is not None and isinstance(v, (int, float))}
    model_raw = {}
    if model and isinstance(model.get("time"), list):
        off = model.get("datum_offset_m") or 0.0
        for t, v in zip(model["time"], model.get("level") or []):
            dt = _parse(t)
            if dt is not None and isinstance(v, (int, float)) and math.isfinite(v):
                model_raw[dt] = v + off
    resid = lowpass_residual(parsed, model_raw, harm, doc.get("model_offset_m")) if surge_on() else {}
    water = [None if lv is None else round(lv + resid.get(t, 0.0), 4) for t, lv in zip(parsed, levels)]
    events = []
    for e in doc.get("events") or []:
        dt = _parse(e.get("time"))
        if dt is not None and isinstance(e.get("height_m"), (int, float)) and e.get("type") in ("High", "Low"):
            events.append({"time": dt, "level_m": float(e["height_m"]), "type": e["type"]})
    return {"time": times, "level": levels, "water_level": water, "events": events, "datum": "station_msl", "datum_offset_m": None,
            "source": SOURCE, "station": station, "surge_hours": len(resid)}


async def _bucket_json(key: str) -> Optional[dict]:
    if _fetch is not None:
        return await _fetch(key)
    if os.environ.get("PYTEST_CURRENT_TEST"):
        return None                                   # unit tests never reach storage unless they inject _fetch
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    svc = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY", "")
    if not base or not svc:
        return None
    import httpx
    from services.weather_pipeline.store import WEATHER_BUCKET
    async with httpx.AsyncClient(timeout=_TIMEOUT_S) as client:
        resp = await client.get(f"{base}/storage/v1/object/{WEATHER_BUCKET}/{key}",
                                headers={"Authorization": f"Bearer {svc}", "apikey": svc})
    if resp.status_code in (400, 404):
        return None
    resp.raise_for_status()
    return resp.json()


async def _cached(key: str) -> Optional[dict]:
    now = time.time()
    hit = _cache.get(key)
    if hit and (now - hit["ts"] < _TTL_S or now < hit.get("fail_until", 0)):
        return hit["doc"]
    lock = _locks.setdefault(key, asyncio.Lock())
    async with lock:
        hit = _cache.get(key)
        if hit and (time.time() - hit["ts"] < _TTL_S or time.time() < hit.get("fail_until", 0)):
            return hit["doc"]
        try:
            doc = await asyncio.wait_for(_bucket_json(key), _TIMEOUT_S + 1)
            _cache[key] = {"ts": time.time(), "doc": doc}
        except asyncio.CancelledError:
            raise
        except Exception as e:                        # noqa: BLE001 - storage trouble = the model serves
            logger.warning(f"[tide-harmonic] {key} unreadable: {type(e).__name__}: {e}"[:200])
            prev = (hit or {}).get("doc")
            _cache[key] = {"ts": 0.0, "doc": prev, "fail_until": time.time() + _FAIL_S}
            doc = prev
        return doc


async def harmonic_for(lat, lng) -> Optional[tuple]:
    """(station, doc) for the point, or None (flag off, no station within RADIUS_KM, storage miss). Never raises."""
    if not harmonic_on():
        return None
    try:
        station = nearest_station(await _cached(INDEX_KEY), lat, lng)
        if station is None:
            return None
        doc = await _cached(STATION_KEY.format(sid=station["id"]))
        return (station, doc) if doc else None
    except asyncio.CancelledError:
        raise
    except Exception as e:                            # noqa: BLE001
        logger.warning(f"[tide-harmonic] lookup failed at ({lat},{lng}): {e}"[:200])
        return None


def _reset_for_tests(fetch=None):
    global _fetch
    _cache.clear()
    _locks.clear()
    _fetch = fetch
