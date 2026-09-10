"""
tide.py — global tide level at any surf spot, for the rating's tide_fit factor (plan §4 P4).

Source: Open-Meteo Marine ``sea_level_height_msl`` (sea-level height including tides, metres above global
mean sea level; not a chart-datum or pure astronomical tide measurement), by
LAT/LNG). This deliberately sidesteps the NOAA CO-OPS path (US stations only + needs a per-spot station map) —
a lat/lng source covers every spot worldwide with no schema change. Open-Meteo stays our FALLBACK provider, so
using it for a variable the direct sources don't carry (tide) is consistent.

Pure helpers (normalize / tide_state_at) are unit-tested. Acquisition shares a horizon-aware cache and
per-cell locks across point requests and batch prewarming. Failures return unavailable with a timed
cooldown; cancellation propagates. No retry loop or detached request is started.
"""
import asyncio
from contextlib import asynccontextmanager
import logging
import math
import time
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from typing import Optional

logger = logging.getLogger(__name__)

OPEN_METEO_MARINE_API = "https://marine-api.open-meteo.com/v1/marine"
_TIDE_TTL_S = 3 * 3600.0          # maximum cache age, provided the requested day range is covered
_TIDE_CACHE = {}                  # (lat_r, lng_r) -> {"ts", "time":[...], "level":[...]}
_TIDE_CACHE_MAX = 2000
_TIDE_FAILURE_COOLDOWN_S = 30.0
_TIDE_POINT_TIMEOUT_S = 15.0
_TIDE_BATCH_TIMEOUT_S = 60.0
_TIDE_FAILURE_UNTIL = {}
_TIDE_RATE_LIMIT_UNTIL = 0.0
_TIDE_LOCKS = {}  # (event loop, rounded cell) -> [lock, active/queued users]; removed after last user


def _round_key(lat, lng):
    """~0.1° (~11 km) cache key so nearby spots share one tide fetch."""
    return (round(float(lat), 1), round(float(lng), 1))


def _cached_series(key, forecast_days, now):
    hit = _TIDE_CACHE.get(key)
    if not hit or not 0 <= now - hit["ts"] < _TIDE_TTL_S:
        return None
    # A three-day request made yesterday does not cover the last day of today's request.
    through_day = hit.get("through_day", int(hit["ts"] // 86400) + 3)
    if through_day < int(now // 86400) + forecast_days:
        return None
    return {"time": hit["time"], "level": hit["level"]}


@asynccontextmanager
async def _acquire_cells(keys):
    """Waiters recheck the cache under the lock. Cancellation owns no detached HTTP work.

    Sorted acquisition prevents overlapping batches from deadlocking. Reference counts cover
    both holders and queued callers, so cleanup cannot create two locks for an active cell.
    Locks are event-loop scoped; no future can be awaited from a different loop.
    """
    entries, acquired = [], []
    loop = asyncio.get_running_loop()
    try:
        for cell in sorted(set(keys)):
            key = (loop, cell)
            entry = _TIDE_LOCKS.setdefault(key, [asyncio.Lock(), 0])
            entry[1] += 1
            entries.append((key, entry))
        for _, entry in entries:
            await entry[0].acquire()
            acquired.append(entry[0])
        yield
    finally:
        for lock in reversed(acquired):
            lock.release()
        for key, entry in entries:
            entry[1] -= 1
            if entry[1] == 0:
                _TIDE_LOCKS.pop(key, None)


def _cooling_down(key):
    now = time.monotonic()
    until = _TIDE_FAILURE_UNTIL.get(key, 0.0)
    if until <= now:
        _TIDE_FAILURE_UNTIL.pop(key, None)
    return now < max(until, _TIDE_RATE_LIMIT_UNTIL)


def _record_failure(keys, response=None):
    """Refuse new acquisition for 30s, or a longer finite server Retry-After on HTTP429.

    This is a deadline, not a sleep or retry. A quota refusal protects all tide cells in this
    process, including the per-point fallback after a failed batch. No payload/URL is logged.
    """
    global _TIDE_RATE_LIMIT_UNTIL
    delay = _TIDE_FAILURE_COOLDOWN_S
    status = getattr(response, 'status_code', None)
    if status == 429:
        value = getattr(response, 'headers', {}).get('Retry-After', '')
        try:
            try:
                requested = float(value)
            except (TypeError, ValueError):
                retry_at = parsedate_to_datetime(value)
                if retry_at.tzinfo is None:  # obsolete HTTP-date forms still mean GMT
                    retry_at = retry_at.replace(tzinfo=timezone.utc)
                requested = retry_at.timestamp() - time.time()
            if math.isfinite(requested) and requested > delay:
                delay = requested
        except (TypeError, ValueError, OverflowError):
            pass
    now = time.monotonic()
    until = now + delay
    if not math.isfinite(until):
        until = now + _TIDE_FAILURE_COOLDOWN_S
    if status == 429:
        _TIDE_RATE_LIMIT_UNTIL = max(_TIDE_RATE_LIMIT_UNTIL, until)
    for key in keys:
        if key not in _TIDE_FAILURE_UNTIL and len(_TIDE_FAILURE_UNTIL) >= _TIDE_CACHE_MAX:
            _TIDE_FAILURE_UNTIL.pop(min(_TIDE_FAILURE_UNTIL, key=_TIDE_FAILURE_UNTIL.get))
        _TIDE_FAILURE_UNTIL[key] = until
    logger.warning('[tide] acquisition unavailable: status=%s cells=%d cooldown_s=%.1f',
                   status, len(keys), until - now)


async def _fetch_json(url, keys, client, timeout):
    try:
        if client is None:
            import httpx
            async with httpx.AsyncClient(timeout=timeout) as owned:
                response = await owned.get(url)
        else:
            response = await client.get(url)
        if response.status_code != 200:
            _record_failure(keys, response)
            return None
        data = response.json()
        if data is None:
            _record_failure(keys)
        return data
    except Exception as exc:
        # CancelledError is a BaseException and deliberately propagates through client/lock cleanup.
        logger.debug('[tide] acquisition exception: %s', type(exc).__name__)
        _record_failure(keys)
        return None


def _store_series(key, item, forecast_days, requested_at):
    hourly = item.get('hourly') if isinstance(item, dict) else None
    times = hourly.get('time') if isinstance(hourly, dict) else None
    levels = hourly.get('sea_level_height_msl') if isinstance(hourly, dict) else None
    if not isinstance(times, list) or not isinstance(levels, list) or not times or len(times) != len(levels):
        _record_failure([key])
        return False
    if key not in _TIDE_CACHE and len(_TIDE_CACHE) >= _TIDE_CACHE_MAX:
        # Evict one oldest entry; clearing the entire cache would create another cold request burst.
        _TIDE_CACHE.pop(min(_TIDE_CACHE, key=lambda k: _TIDE_CACHE[k]['ts']))
    _TIDE_CACHE[key] = {'ts': requested_at, 'time': times, 'level': levels,
                        'through_day': int(requested_at // 86400) + forecast_days}
    _TIDE_FAILURE_UNTIL.pop(key, None)
    return True


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
    (tests). Unavailable data returns None; caller cancellation propagates."""
    key = _round_key(lat, lng)
    return await _within_budget(_fetch_point(key, client, forecast_days), [key],
                                _TIDE_POINT_TIMEOUT_S, None)


async def _within_budget(operation, keys, seconds, unavailable):
    """Bound lock waiting plus HTTP together; external caller cancellation still propagates."""
    try:
        async with asyncio.timeout(seconds):
            return await operation
    except TimeoutError:
        logger.warning('[tide] acquisition budget exhausted: cells=%d budget_s=%.1f', len(keys), seconds)
        _record_failure(keys)
        return unavailable


async def _fetch_point(key, client, forecast_days):
    async with _acquire_cells([key]):
        now = time.time()
        hit = _cached_series(key, forecast_days, now)
        if hit is not None or _cooling_down(key):
            return hit
        url = (f"{OPEN_METEO_MARINE_API}?latitude={key[0]}&longitude={key[1]}"
               f"&hourly=sea_level_height_msl&forecast_days={forecast_days}&timezone=GMT")
        data = await _fetch_json(url, [key], client, _TIDE_POINT_TIMEOUT_S)
        if data is not None and _store_series(key, data, forecast_days, now):
            return _cached_series(key, forecast_days, now)
        return None


def _prewarm_keys(latlngs, now=None, forecast_days=3):
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
        if _cached_series(k, forecast_days, now) is not None:
            continue
        keys.append(k)
    return keys


async def prewarm_tide_cache(latlngs, client=None, forecast_days: int = 3, chunk_size: int = 100) -> int:
    """Batch-seed the tide cache for many spots in a few requests: Open-Meteo accepts comma-separated
    latitude/longitude lists and returns an ARRAY of per-location results in request order (probed
    2026-07-18). The ratings precompute calls this once per run — a fresh CI process would otherwise
    cold-fetch ~900 spot-cells one request at a time inside rate_one_spot (quota + tail latency); batched
    it's ~10 requests for ~1500 spots. Requests use the ROUNDED key coords, exactly what fetch_tide_hourly
    would request, so the seeded entries have the same values as the per-spot path. Failures cool down
    without seeding data; cancellation propagates. Returns the number of cells seeded."""
    keys = _prewarm_keys(latlngs, forecast_days=forecast_days)
    seeded = 0
    for i in range(0, len(keys), chunk_size):
        chunk = keys[i:i + chunk_size]
        if time.monotonic() < _TIDE_RATE_LIMIT_UNTIL:
            break
        seeded += await _within_budget(_prewarm_chunk(chunk, client, forecast_days), chunk,
                                       _TIDE_BATCH_TIMEOUT_S, 0)
    return seeded


async def _prewarm_chunk(chunk, client, forecast_days):
    async with _acquire_cells(chunk):
        now = time.time()
        chunk = [k for k in chunk if _cached_series(k, forecast_days, now) is None and not _cooling_down(k)]
        if not chunk:
            return 0
        url = (f"{OPEN_METEO_MARINE_API}?latitude={','.join(str(k[0]) for k in chunk)}"
               f"&longitude={','.join(str(k[1]) for k in chunk)}"
               f"&hourly=sea_level_height_msl&forecast_days={forecast_days}&timezone=GMT")
        data = await _fetch_json(url, chunk, client, _TIDE_BATCH_TIMEOUT_S)
        if data is None:
            return 0
        results = data if isinstance(data, list) else [data]
        if len(results) != len(chunk):
            _record_failure(chunk)
            return 0
        return sum(int(_store_series(k, item, forecast_days, now)) for k, item in zip(chunk, results))


async def tide_norm_at(lat, lng, valid_time, client=None) -> Optional[dict]:
    """Convenience: fetch + resolve the tide state at a spot for ``valid_time``. Returns the tide_state_at dict
    ({height_m, norm, trend}) or None. The `norm` feeds surf_rating.tide_fit; the rest is for explainability."""
    series = await fetch_tide_hourly(lat, lng, client=client)
    if not series:
        return None
    return tide_state_at(series["time"], series["level"], valid_time)


def _reset_tide_cache_for_test():
    global _TIDE_RATE_LIMIT_UNTIL
    _TIDE_CACHE.clear()
    _TIDE_FAILURE_UNTIL.clear()
    _TIDE_RATE_LIMIT_UNTIL = 0.0
    assert not _TIDE_LOCKS, 'tide callers must finish/cancel before resetting acquisition state'
