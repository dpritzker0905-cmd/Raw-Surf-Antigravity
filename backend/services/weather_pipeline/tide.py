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
from datetime import datetime, timedelta, timezone
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


# ── HIGH/LOW EVENTS FROM THE HOURLY SERIES (2026-07-29) ─────────────────────────────────────────
# The `/tides/{spot_id}` endpoint used NOAA CO-OPS with a FIVE-ENTRY region->station map, every entry
# a Florida region, and defaulted to 8721604 (Trident Pier, Port Canaveral FL). Measured against
# production: 1,743 of 1,773 active spots across 491 regions took that default, so 98.3% of the
# catalogue — Pipeline, Nazare, Teahupo'o and every new pin anywhere on Earth — was served FLORIDA
# tide times stamped with its own spot_id. Same class as the fabricated GFS zeros: confidently-wrong
# data rendered as authoritative, and worse because a tide time looks plausible.
#
# This module already exists precisely to replace that path — see the header: a lat/lng source
# "covers every spot worldwide with no schema change". It was only ever wired to the rating. These
# helpers give the endpoint the HIGH/LOW EVENT shape it needs from the same global hourly series, so
# there is one tide source instead of two.
_MIN_EXTREMA_SEPARATION_H = 4.0   # semidiurnal highs are ~6h12m apart; 4h rejects sampling wobble
                                  # without merging genuine consecutive turns


def _interpolate_turn(y0, y1, y2):
    """Sub-hour offset (in samples, -0.5..0.5) of a parabola's vertex through three equally spaced
    points. Hourly sampling puts the true turn up to 30 min from the sampled peak; this recovers it.
    Returns 0.0 when the three points are collinear (a flat or perfectly linear stretch)."""
    denom = y0 - 2.0 * y1 + y2
    if denom == 0:
        return 0.0
    return max(-0.5, min(0.5, 0.5 * (y0 - y2) / denom))


def tide_extrema(times, levels, min_separation_h: float = _MIN_EXTREMA_SEPARATION_H):
    """High/low water events from an hourly sea-level series.

    Returns [{"time": datetime (UTC, tz-aware), "level_m": float, "type": "High"|"Low"}] in time
    order. Pure — no I/O — so it is unit-testable against a synthetic sinusoid.

    A turn is a strict local extremum over its two neighbours; its time and height are refined by a
    parabolic fit so an hourly series does not quantise every high tide to the top of an hour. When
    two same-type turns fall within ``min_separation_h`` the more extreme one wins, which suppresses
    the double-peak wobble a flat-topped tide produces without discarding a real semidiurnal pair."""
    if not times or not levels or len(times) != len(levels):
        return []
    parsed = [_parse_iso(t) for t in times]
    out = []
    for i in range(1, len(levels) - 1):
        y0, y1, y2 = levels[i - 1], levels[i], levels[i + 1]
        if y0 is None or y1 is None or y2 is None or parsed[i] is None:
            continue
        is_high = y1 > y0 and y1 >= y2
        is_low = y1 < y0 and y1 <= y2
        if not (is_high or is_low):
            continue
        shift = _interpolate_turn(y0, y1, y2)
        # Vertex height of the same parabola; falls back to the sampled value when degenerate.
        peak = y1 - 0.25 * (y0 - y2) * shift
        step_s = 3600.0
        if parsed[i - 1] is not None:
            step_s = (parsed[i] - parsed[i - 1]).total_seconds() or 3600.0
        out.append({"time": parsed[i] + timedelta(seconds=shift * step_s),
                    "level_m": float(peak), "type": "High" if is_high else "Low"})

    # Collapse turns that are too close together to be a real semidiurnal pair.
    #
    # ⚠️ A flat-topped tide wobbles as High -> shallow Low -> High, so the two spurious highs are NOT
    # adjacent in the list — an opposite-type turn sits between them. Comparing only against the
    # PREVIOUS event therefore never fires (measured: it left both highs of a 2 h wobble). Collapse
    # the whole TRIPLE instead: when events i and i+2 share a type and span less than the minimum
    # separation, keep the more extreme of the pair and drop the wobble between them. Repeat until
    # stable, because removing one triple can expose another.
    window_s = min_separation_h * 3600.0
    collapsed = list(out)
    changed = True
    while changed and len(collapsed) >= 3:
        changed = False
        for i in range(len(collapsed) - 2):
            a, b, c = collapsed[i], collapsed[i + 1], collapsed[i + 2]
            if a["type"] != c["type"]:
                continue
            if (c["time"] - a["time"]).total_seconds() >= window_s:
                continue
            keep = max((a, c), key=lambda e: e["level_m"]) if a["type"] == "High" \
                else min((a, c), key=lambda e: e["level_m"])
            collapsed[i:i + 3] = [keep]
            changed = True
            break
    return collapsed


def tide_trend_at(extrema, at):
    """"Rising" | "Falling" | None — from the NEXT event after ``at``. Rising into a High, falling
    into a Low. None when there is no future event (the series ran out), because guessing a trend
    from an exhausted series is the kind of confident invention this whole change is removing."""
    if not extrema or at is None:
        return None
    for ev in extrema:
        if ev["time"] > at:
            return "Rising" if ev["type"] == "High" else "Falling"
    return None


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
