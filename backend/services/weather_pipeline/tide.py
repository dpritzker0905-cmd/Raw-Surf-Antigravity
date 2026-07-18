"""
tide.py — global tide level at any surf spot, for the rating's tide_fit factor (plan §4 P4).

Source: Open-Meteo Marine ``sea_level_height_msl`` (hourly tidal height in metres, GLOBAL, free, no key, by
LAT/LNG). This deliberately sidesteps the NOAA CO-OPS path (US stations only + needs a per-spot station map) —
a lat/lng source covers every spot worldwide with no schema change. Open-Meteo stays our FALLBACK provider, so
using it for a variable the direct sources don't carry (tide) is consistent.

Pure helpers (normalize / tide_state_at) are unit-tested; the async fetch is TTL-cached by rounded lat/lng so
the precompute loop (and the live endpoint) hit the API at most once per ~11 km area per TTL — tide changes
slowly and one hourly series covers the whole forecast window. Never raises: a tide miss -> neutral rating.
"""
import logging
import time
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)

OPEN_METEO_MARINE_API = "https://marine-api.open-meteo.com/v1/marine"
_TIDE_TTL_S = 3 * 3600.0          # tide series is stable for hours; refetch a spot-area at most every 3h
_TIDE_CACHE = {}                  # (lat_r, lng_r) -> {"ts", "time":[...], "level":[...]}
_TIDE_CACHE_MAX = 2000


def _round_key(lat, lng):
    """~0.1° (~11 km) cache key so nearby spots share one tide fetch."""
    return (round(float(lat), 1), round(float(lng), 1))


def _parse_iso(s):
    """Open-Meteo emits naive local time; we request timezone=GMT so treat as UTC."""
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except (ValueError, TypeError):
        return None


def normalize_tide(level, lo, hi):
    """Map an absolute tide height to 0..1 within [lo, hi] (0 = low water, 1 = high water). Returns 0.5 when
    the window is degenerate (flat tide)."""
    if level is None or lo is None or hi is None or hi <= lo:
        return 0.5
    return max(0.0, min(1.0, (level - lo) / (hi - lo)))


def tide_state_at(times, levels, valid_time, window_h: int = 12) -> Optional[dict]:
    """PURE: tide state at ``valid_time`` from an hourly (times, levels) series. Returns
    {height_m, norm (0..1 within the surrounding ±window_h tidal window), trend ('rising'|'falling'|'slack')}
    or None when the series can't be used. ``valid_time`` is an ISO-8601 UTC string or datetime."""
    if not times or not levels or len(times) != len(levels):
        return None
    req = valid_time if isinstance(valid_time, datetime) else _parse_iso(valid_time)
    if req is None:
        return None
    if req.tzinfo is None:
        req = req.replace(tzinfo=timezone.utc)
    # nearest sample to valid_time
    best_i, best_d = None, None
    parsed = []
    for i, t in enumerate(times):
        dt = _parse_iso(t)
        parsed.append(dt)
        if dt is None or levels[i] is None:
            continue
        d = abs((dt - req).total_seconds())
        if best_d is None or d < best_d:
            best_i, best_d = i, d
    if best_i is None:
        return None
    height = levels[best_i]
    # local min/max over ±window_h (a tidal day) for the normalized position
    lo = hi = height
    for i, dt in enumerate(parsed):
        if dt is None or levels[i] is None:
            continue
        if abs((dt - req).total_seconds()) <= window_h * 3600:
            lo = min(lo, levels[i]); hi = max(hi, levels[i])
    norm = normalize_tide(height, lo, hi)
    # trend from the neighbouring samples
    trend = "slack"
    prev_v = next((levels[j] for j in range(best_i - 1, -1, -1) if levels[j] is not None), None)
    next_v = next((levels[j] for j in range(best_i + 1, len(levels)) if levels[j] is not None), None)
    ref = next_v if next_v is not None else prev_v
    if ref is not None:
        delta = (next_v - height) if next_v is not None else (height - prev_v)
        if delta > 0.02:
            trend = "rising"
        elif delta < -0.02:
            trend = "falling"
    return {"height_m": round(height, 3), "norm": round(norm, 3), "trend": trend}


async def fetch_tide_hourly(lat, lng, client=None, forecast_days: int = 3) -> Optional[dict]:
    """Fetch the hourly tide series (sea_level_height_msl) for (lat,lng) from Open-Meteo Marine, TTL-cached by
    rounded coords. Returns {"time":[...], "level":[...]} or None. Uses an injected async client when given
    (tests); never raises."""
    key = _round_key(lat, lng)
    now = time.time()
    hit = _TIDE_CACHE.get(key)
    if hit and (now - hit["ts"]) < _TIDE_TTL_S:
        return {"time": hit["time"], "level": hit["level"]}
    url = (f"{OPEN_METEO_MARINE_API}?latitude={key[0]}&longitude={key[1]}"
           f"&hourly=sea_level_height_msl&forecast_days={forecast_days}&timezone=GMT")
    try:
        if client is not None:
            resp = await client.get(url)
            data = resp.json() if resp.status_code == 200 else None
        else:
            import httpx
            async with httpx.AsyncClient(timeout=15) as c:
                resp = await c.get(url)
                data = resp.json() if resp.status_code == 200 else None
    except Exception as e:
        logger.debug(f"[tide] fetch failed for {key}: {e}")
        return None
    if not data or "hourly" not in data:
        return None
    h = data["hourly"]
    times, levels = h.get("time"), h.get("sea_level_height_msl")
    if not times or not levels:
        return None
    if len(_TIDE_CACHE) >= _TIDE_CACHE_MAX:
        _TIDE_CACHE.clear()
    _TIDE_CACHE[key] = {"ts": now, "time": times, "level": levels}
    return {"time": times, "level": levels}


def _prewarm_keys(latlngs, now=None):
    """PURE: unique rounded cache keys from (lat,lng) pairs that are not already cache-fresh — the batch
    prewarm's work list. Order-preserving so a chunk's results zip back to its keys."""
    now = time.time() if now is None else now
    keys, seen = [], set()
    for pair in latlngs or []:
        try:
            lat, lng = pair
        except (TypeError, ValueError):
            continue
        if lat is None or lng is None:
            continue
        k = _round_key(lat, lng)
        if k in seen:
            continue
        seen.add(k)
        hit = _TIDE_CACHE.get(k)
        if hit and (now - hit["ts"]) < _TIDE_TTL_S:
            continue
        keys.append(k)
    return keys


async def prewarm_tide_cache(latlngs, client=None, forecast_days: int = 3, chunk_size: int = 100) -> int:
    """Batch-seed the tide cache for many spots in a few requests: Open-Meteo accepts comma-separated
    latitude/longitude lists and returns an ARRAY of per-location results in request order (probed
    2026-07-18). The ratings precompute calls this once per run — a fresh CI process would otherwise
    cold-fetch ~900 spot-cells one request at a time inside rate_one_spot (quota + tail latency); batched
    it's ~10 requests for ~1500 spots. Requests use the ROUNDED key coords, exactly what fetch_tide_hourly
    would request, so the seeded entries are byte-identical to the per-spot path's. Never raises; returns
    the number of cells seeded."""
    keys = _prewarm_keys(latlngs)
    seeded = 0
    for i in range(0, len(keys), chunk_size):
        chunk = keys[i:i + chunk_size]
        url = (f"{OPEN_METEO_MARINE_API}?latitude={','.join(str(k[0]) for k in chunk)}"
               f"&longitude={','.join(str(k[1]) for k in chunk)}"
               f"&hourly=sea_level_height_msl&forecast_days={forecast_days}&timezone=GMT")
        try:
            if client is not None:
                resp = await client.get(url)
                data = resp.json() if resp.status_code == 200 else None
            else:
                import httpx
                async with httpx.AsyncClient(timeout=60) as c:
                    resp = await c.get(url)
                    data = resp.json() if resp.status_code == 200 else None
        except Exception as e:
            logger.debug(f"[tide] prewarm chunk failed ({len(chunk)} cells): {e}")
            continue
        if not data:
            continue
        results = data if isinstance(data, list) else [data]   # a 1-coord batch comes back as a bare object
        now = time.time()
        for k, item in zip(chunk, results):
            h = (item or {}).get("hourly") or {}
            times, levels = h.get("time"), h.get("sea_level_height_msl")
            if not times or not levels:
                continue
            if len(_TIDE_CACHE) >= _TIDE_CACHE_MAX:
                _TIDE_CACHE.clear()
            _TIDE_CACHE[k] = {"ts": now, "time": times, "level": levels}
            seeded += 1
    return seeded


async def tide_norm_at(lat, lng, valid_time, client=None) -> Optional[dict]:
    """Convenience: fetch + resolve the tide state at a spot for ``valid_time``. Returns the tide_state_at dict
    ({height_m, norm, trend}) or None. The `norm` feeds surf_rating.tide_fit; the rest is for explainability."""
    series = await fetch_tide_hourly(lat, lng, client=client)
    if not series:
        return None
    return tide_state_at(series["time"], series["level"], valid_time)


def _reset_tide_cache_for_test():
    _TIDE_CACHE.clear()
