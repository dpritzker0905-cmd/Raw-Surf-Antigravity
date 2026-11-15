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
from datetime import datetime, timedelta, timezone
from typing import Callable, Dict, Optional

try:
    from services import runtime_flags as _rf
except ImportError:                                   # pragma: no cover - script context
    _rf = None

logger = logging.getLogger(__name__)

INDEX_KEY = "tides/coops/index.json"
STATION_KEY = "tides/coops/{sid}.json"
RADIUS_KM = 10.0             # gate G3 as REVIEWED (advisor, 2026-11-15): the LOO sample was first-30-by-ID per bucket (bays,
                             # little Pacific coast); on the open coast the model scored 0.117 m and a neighbour beyond 5 km
                             # 0.12-0.16. Only <= 5-10 km was a clear win (5 km: 0.064 vs 0.244, 28/28). Widen only after a
                             # region-stratified LOO passes. The shape guard below also keeps a bay station off an outer coast.
SHAPE_MIN_R = 0.8            # the station's tide must move with the spot cell's model: correlation over the overlap,
SHAPE_RANGE = (0.6, 1.6)     # a similar range (sd ratio model/station),
SHAPE_MAX_LAG_H = 1          # and no phase shift beyond 1 h; else the cell is not that station's water: serve the model
STALE_AHEAD_H = 72           # a station file that does not cover now .. +72 h is stale (ingest stopped): serve the model
SOURCE = "noaa_coops_harmonic"
_TTL_S = 6 * 3600.0
_FAIL_S = 300.0
_TIMEOUT_S = 3.0
_LOWPASS_H = 25              # one tidal day: removes the diurnal and semidiurnal bands from (model - harmonic)
_LOWPASS_MIN = 13

_cache: Dict[str, dict] = {}       # key -> {"ts", "doc", "fail_until"}
_ALLOW_STORAGE_IN_TESTS = False    # the G4 test opens the real HTTP path (patched client) to prove where it goes
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


def shape_agrees(harm: Dict[datetime, float], model_raw: Dict[datetime, float]) -> Optional[dict]:
    """PURE: does the station's tide move with the spot cell's model? {r, sd_ratio, lag_h, ok} over their overlap
    (both de-meaned), or None when they overlap < 48 h (nothing to check against: the station is trusted)."""
    keys = sorted(t for t in harm if t in model_raw)
    if len(keys) < 48:
        return None
    h = [harm[t] for t in keys]
    m = [model_raw[t] for t in keys]
    mh, mm = sum(h) / len(h), sum(m) / len(m)
    h = [x - mh for x in h]
    m = [x - mm for x in m]

    def corr(a, b):
        den = math.sqrt(sum(x * x for x in a) * sum(y * y for y in b))
        return sum(x * y for x, y in zip(a, b)) / den if den else 0.0
    lags = {lag: corr(h[max(0, lag):len(h) + min(0, lag)], m[max(0, -lag):len(m) + min(0, -lag)]) for lag in range(-3, 4)}
    best = max(lags, key=lags.get)
    sd_h = math.sqrt(sum(x * x for x in h) / len(h))
    sd_m = math.sqrt(sum(x * x for x in m) / len(m))
    ratio = sd_m / sd_h if sd_h else float("inf")
    out = {"r": round(lags[0], 3), "sd_ratio": round(ratio, 3), "lag_h": best}
    out["ok"] = (lags[0] >= SHAPE_MIN_R and SHAPE_RANGE[0] <= ratio <= SHAPE_RANGE[1] and abs(best) <= SHAPE_MAX_LAG_H)
    return out


def covers(times, now: datetime, ahead_h: int = STALE_AHEAD_H) -> bool:
    """PURE: the station file spans now .. now + ahead_h (else the ingest has stopped and the model must serve)."""
    parsed = [t for t in (_parse(x) for x in times or []) if t is not None]
    return bool(parsed) and parsed[0] <= now and parsed[-1] >= now + timedelta(hours=ahead_h)


def combine(model: Optional[dict], doc: dict, station: dict, now: Optional[datetime] = None) -> Optional[dict]:
    """PURE: the served series for a harmonic point. `model` is tide.py's local-datum model series (or None);
    `doc` the station object from the bucket. Shape = fetch_tide_hourly's, plus water_level, events, source, station."""
    ser = (doc or {}).get("series") or {}
    times, levels = ser.get("time"), ser.get("level")
    if not isinstance(times, list) or not isinstance(levels, list) or len(times) != len(levels) or len(times) < 2:
        return None
    parsed = [_parse(t) for t in times]
    if not covers(times, now or datetime.now(timezone.utc)):
        return None                                   # stale: the ingest stopped; the model serves (advisor, #931)
    harm = {t: v for t, v in zip(parsed, levels) if t is not None and isinstance(v, (int, float))}
    model_raw = {}
    if model and isinstance(model.get("time"), list):
        off = model.get("datum_offset_m") or 0.0
        for t, v in zip(model["time"], model.get("level") or []):
            dt = _parse(t)
            if dt is not None and isinstance(v, (int, float)) and math.isfinite(v):
                model_raw[dt] = v + off
    shape = shape_agrees(harm, model_raw)
    if shape is not None and not shape["ok"]:
        return None                                   # the station's water is not this cell's (e.g. a bay vs an outer coast)
    resid = lowpass_residual(parsed, model_raw, harm, doc.get("model_offset_m")) if surge_on() else {}
    water = [None if lv is None else round(lv + resid.get(t, 0.0), 4) for t, lv in zip(parsed, levels)]
    events = []
    for e in doc.get("events") or []:
        dt = _parse(e.get("time"))
        if dt is not None and isinstance(e.get("height_m"), (int, float)) and e.get("type") in ("High", "Low"):
            events.append({"time": dt, "level_m": float(e["height_m"]), "type": e["type"]})
    return {"time": times, "level": levels, "water_level": water, "events": events, "datum": "station_msl", "datum_offset_m": None,
            "source": SOURCE, "station": station, "surge_hours": len(resid), "shape": shape}


async def _bucket_json(key: str) -> Optional[dict]:
    if _fetch is not None:
        return await _fetch(key)
    if os.environ.get("PYTEST_CURRENT_TEST") and not _ALLOW_STORAGE_IN_TESTS:
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
