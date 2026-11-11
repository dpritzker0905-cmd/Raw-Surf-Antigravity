"""spot_hub_composition.py: the spot hub on THE ONE composition (spot-hub phase 2, 2026-11-03, DARK).

WHY. `spot_conditions.resolve_spot_conditions_impl` is the hub's OWN chain. It samples cached grids itself, rates
the 0.1-ft-ROUNDED breaking height, leaves out `tide_norm`, `best_tide` and `breaker_xi`, takes "now" as the
nearest 3 h, and picks its own product (`find_cached_grid_product`). So the hub and the glyph beside it could grade
one spot-hour differently (research M3). Its daily rows were worse: ONE 12:00 UTC sample per UTC day, labelled
"max", with min = 0.6 x max (M1). At Hawaii 12:00 UTC is 02:00 local.

WHAT THIS DOES, ON by default (`SPOT_HUB_RATE_ONE_SPOT`, read at call time in spot_conditions.py; '0' is the kill
switch that restores the hub's own chain byte for byte; owner policy 2026-11-04 ~01:41Z: fixes ship ON):
  * EVERY hub frame is `spot_ratings.rate_one_spot`, the reference implementation, answered the way
    `/point-rating` answers: the glyph's PRECOMPUTED frame item first, else `rate_one_spot` live plus the
    single-model observation gate. Same product choice (`resolve_point`), same tide and breaker terms, the exact
    height (no 0.1 ft pre-rounding). This module rates NOTHING itself.
  * Daily rows are the spot's LOCAL day (solar time, `utc_offset_hours`), and `wave_height_max` /
    `wave_height_min` are the real max and min over the frames of that day that resolved. Each row says how many
    frames it rests on, and on what cadence.
  * ONE frame plan (`frame_plan`) for the hub and for the CI chart series (phase 3, `scripts/spot_series_ci.py`):
    3-hourly to +72 h, then three local day-parts (06/12/18 solar) per day. The hub and the chart cannot sample
    a day differently.

COST on the 1-CPU serve box. One frame is one `rate_one_spot` (marine + wind point resolves, ~54 ms warm, measured
in CI run 41491110869). The frames asked stop at the TIER WINDOW the caller passes (free 72 h ~ 24 frames, premium
~45), rows beyond it are named but not computed, live frames are cached per (model, spot, hour) for 15 minutes,
at most `_CONCURRENCY` frames resolve at once per request, and the whole payload is built ONCE per (model, spot,
window, hour): concurrent viewers await that one build, repeats inside 5 minutes read it. ⚠️ That is still more on-demand work than the old
hub. The FLIP GATE in the phase-2 log asks for a measured CPU budget, and the phase-3 series is the path that
moves this work to CI.

LOCAL DAY. The catalogue has no timezone column and the backend has no tz database, so "local" is SOLAR time,
round(lng / 15) hours. It is within ~1-2 h of civil time almost everywhere; the offset is sent with every row so a
client can show it.
"""
import asyncio
import logging
import math
import os
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from services import runtime_flags as _rf   # D-065: guarded flags are read through the guardrail's manifest
from services.weather_pipeline import location_time as _lt   # phase 1: civil labels/grouping, never the frame plan

logger = logging.getLogger(__name__)

FLAG = "SPOT_HUB_RATE_ONE_SPOT"
M_TO_FT = 3.28084
FRAME_STEP_H = 3                 # the UTC grid every frame sits on (GFS-Wave's native step beyond +120 h)
DENSE_HORIZON_H = 72             # 3-hourly frames to here, then day-parts
DAY_PART_LOCAL_HOURS = (6, 12, 18)
MAX_DAILY_ROWS = 10              # what the hub has always asked for (forecast_days=11)
_CONCURRENCY = 2                 # frames resolving at once, per request
_CACHE: Dict[str, Any] = {}
_CACHE_TTL_S = 900.0
_CACHE_MAX = 4000
# Whole-payload cache + in-flight coalescing (Reflection review, 2026-11-03): N viewers opening one spot in the same
# hour cost ONE build, not N x ~45 frame resolves. Keyed by the hour, so a new hour is a new key.
_PAYLOAD: Dict[Any, Any] = {}
_PAYLOAD_TTL_S = 300.0
_PAYLOAD_MAX = 500
_BUILDING: Dict[Any, Any] = {}


def clear_caches() -> None:
    _CACHE.clear()
    _PAYLOAD.clear()
    _BUILDING.clear()


def enabled() -> bool:
    return _rf.on(FLAG)


def spot_meta_of(spot) -> Dict[str, Any]:
    """The spot dict `rate_one_spot` is given by /spot-ratings (routes/weather.py `_rate`), same keys."""
    return {"id": spot.id, "name": getattr(spot, "name", None),
            "latitude": spot.latitude, "longitude": spot.longitude,
            "accuracy_flag": getattr(spot, "accuracy_flag", None),
            "is_verified_peak": getattr(spot, "is_verified_peak", False),
            "best_tide": getattr(spot, "best_tide", None)}


def call_kwargs(spot=None, horizon_hours: Optional[int] = None) -> Dict[str, Any]:
    """Extra kwargs for `resolve_spot_conditions`, EMPTY under the kill switch, so a killed call is the exact call
    the routes made before."""
    if not enabled():
        return {}
    out: Dict[str, Any] = {}
    if spot is not None:
        out["spot_meta"] = spot_meta_of(spot)
    if horizon_hours is not None:
        out["horizon_hours"] = int(horizon_hours)
    return out


# ── time: the local day and the frame plan ─────────────────────────────────────────────────────────────────

def solar_utc_offset_hours(lng: float) -> int:
    """round(lng / 15), in [-12, 12]. See LOCAL DAY in the module docstring."""
    try:
        off = int(round(float(lng) / 15.0))
    except (TypeError, ValueError):
        return 0
    return max(-12, min(12, off))


def valid_time_str(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:00:00Z")


def current_valid_time(now: Optional[datetime] = None) -> datetime:
    """The hub's "now": the top of the current UTC hour, the base the glyph precompute rates from."""
    now = now or datetime.now(timezone.utc)
    return now.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)


def local_date(dt: datetime, offset_h: int):
    return (dt.astimezone(timezone.utc) + timedelta(hours=offset_h)).date()


def _snap_to_grid(dt: datetime, step_h: int = FRAME_STEP_H) -> datetime:
    base = dt.replace(minute=0, second=0, microsecond=0)
    hour = int(round(base.hour / step_h) * step_h)
    return base.replace(hour=0) + timedelta(hours=hour)


def frame_plan(lng: float, now: datetime, horizon_h: int, dense_h: int = DENSE_HORIZON_H,
               step_h: int = FRAME_STEP_H) -> List[datetime]:
    """The forecast frames for one spot, sorted, unique, all inside (now, now + horizon_h]:
    every `step_h` on the UTC grid to now + dense_h, then the local day-parts of each later local day,
    each snapped to that grid. ⚠️ The dense part is ~24 frames, the day-parts ~3 a day."""
    now = now.astimezone(timezone.utc)
    end = now + timedelta(hours=max(0, int(horizon_h)))
    dense_end = min(end, now + timedelta(hours=dense_h))
    out = set()
    t = now.replace(minute=0, second=0, microsecond=0)
    t = t + timedelta(hours=(-t.hour) % step_h)
    if t <= now:
        t += timedelta(hours=step_h)
    while t <= dense_end:
        out.add(t)
        t += timedelta(hours=step_h)
    off = solar_utc_offset_hours(lng)
    day = local_date(dense_end, off)
    while True:
        midnight_utc = datetime(day.year, day.month, day.day, tzinfo=timezone.utc) - timedelta(hours=off)
        if midnight_utc > end:
            break
        for lh in DAY_PART_LOCAL_HOURS:
            at = _snap_to_grid(midnight_utc + timedelta(hours=lh), step_h)
            if dense_end < at <= end:
                out.add(at)
        day = day + timedelta(days=1)
    return sorted(out)


def wind_word(wind_from_deg, shore_normal_deg) -> Optional[str]:
    """offshore / cross-shore / onshore, by the SAME thresholds `spot_ratings.rating_why` writes."""
    from services.weather_pipeline.spot_ratings import wind_relation
    return wind_relation(wind_from_deg, shore_normal_deg)


# ── one frame: the glyph's item, or rate_one_spot live ─────────────────────────────────────────────────────

class _RecordingResolver:
    """Passes every call through and KEEPS the marine and wind point responses `rate_one_spot` resolves, so the
    hub can show the wind it was graded on without a second resolve (and without widening the glyph blob)."""

    def __init__(self, inner):
        self._inner = inner
        self.marine = None
        self.wind = None

    def __getattr__(self, name):
        return getattr(self._inner, name)

    async def resolve_point(self, *args, **kwargs):
        resp = await self._inner.resolve_point(*args, **kwargs)
        domain = kwargs.get("domain")
        if domain == "marine":
            self.marine = resp
        elif domain == "wind":
            self.wind = resp
        return resp


def precomputed_item(obj, spot: Dict[str, Any], model: str, vt: str, exact: bool):
    """(item, source, served_valid_time) for THIS spot (by id) in the frame /spot-ratings serves, or (None, ...).
    `exact` refuses a frame whose own hour differs from `vt`: a daily max must not count a neighbouring hour."""
    if not obj:
        return None, "live", None
    from services.weather_pipeline.point_rating import MATCH_KM, _bbox_around
    from services.weather_pipeline.spot_ratings_precompute import select_precomputed_laddered
    lat, lng = spot["latitude"], spot["longitude"]
    spots, source, served = select_precomputed_laddered(obj, _bbox_around(lat, lng, MATCH_KM), model, vt)
    if not spots or (exact and served != vt):
        return None, "live", None
    sid = str(spot["id"])
    item = next((s for s in spots if str(s.get("spot_id")) == sid), None)
    if item is None:
        return None, "live", None
    return item, source, served


async def _live_frame(resolver, spot, model, vt, ref):
    from services.weather_pipeline.rating_confirmation import gate_single_model_surface
    from services.weather_pipeline.spot_ratings import rate_one_spot
    rec = _RecordingResolver(resolver)
    item = await rate_one_spot(rec, spot, model, vt, reference_size_m=ref)
    # The hub's and the infobox's post-step (point_rating.live_rating): display what the app displays. Off the
    # event loop, as both of them do (a TTL miss inside is a blocking L2 load).
    gated, level, confirm, raw = await asyncio.to_thread(
        gate_single_model_surface, item.get("score"), spot["latitude"], spot["longitude"], vt)
    if gated is not None:
        item["score"], item["level"] = gated, level
    item["raw_score"], item["confirmed"] = raw, confirm
    return item, rec


def _point_field(resp, name):
    point = getattr(resp, "point", None)
    return getattr(point, name, None) if point is not None else None


def frame_row(item: Dict[str, Any], vt: str, source: str, served: Optional[str] = None,
              marine=None, wind=None, shore_normal_deg=None) -> Dict[str, Any]:
    """One hub/chart frame from a rate_one_spot item. Heights stay in metres, exactly as rated."""
    wind_kt = _point_field(wind, "speed")
    wind_from = _point_field(wind, "direction")
    normal = getattr(marine, "shore_normal_deg", None) if marine is not None else None
    if normal is None:
        normal = shore_normal_deg
    return {
        "valid_time": vt,
        "served_valid_time": served,
        "source": source,
        "surf_height_m": item.get("surf_height_m"),
        "offshore_hs_m": item.get("offshore_hs_m"),
        "period_s": item.get("period_s"),
        "swell_from_deg": item.get("swell_from_deg"),
        "primary_swell_hs_m": item.get("primary_swell_hs_m"),
        "score": item.get("score"),
        "level": item.get("level"),
        "raw_score": item.get("raw_score"),
        "confirmed": item.get("confirmed"),
        "tide": item.get("tide"),
        "why": item.get("why"),
        "limiter": item.get("limiter"),
        "directional_conflict": item.get("directional_conflict"),
        "forecast_confidence": item.get("forecast_confidence"),
        "surf_regime": getattr(marine, "surf_regime", None) if marine is not None else None,
        "wind_kt": round(float(wind_kt), 1) if isinstance(wind_kt, (int, float)) else None,
        "wind_from_deg": wind_from,
        "wind_word": wind_word(wind_from, normal),
    }


async def rate_frame(resolver, spot, model, vt: str, ref, l2_obj, exact: bool) -> Dict[str, Any]:
    """One frame, as /point-rating would answer it for this spot and hour. Live answers are cached."""
    item, source, served = precomputed_item(l2_obj, spot, model, vt, exact)
    if item is not None:
        return frame_row(item, vt, source, served)
    key = f"{model}|{spot['id']}|{vt}|{ref}"
    hit = _CACHE.get(key)
    if hit is not None and (time.time() - hit[0]) < _CACHE_TTL_S:
        return dict(hit[1])
    item, rec = await _live_frame(resolver, spot, model, vt, ref)
    row = frame_row(item, vt, "live", None, rec.marine, rec.wind)
    if len(_CACHE) >= _CACHE_MAX:
        _CACHE.pop(next(iter(_CACHE)))
    _CACHE[key] = (time.time(), row)
    return dict(row)


# ── the hub payload ────────────────────────────────────────────────────────────────────────────────────────

def _ft(m):
    return round(m * M_TO_FT, 1) if isinstance(m, (int, float)) and math.isfinite(m) else None


def _label(ft):
    from services.conditions_labels import get_conditions_label
    return get_conditions_label(ft) if ft is not None else "Unavailable"


def current_conditions(row: Dict[str, Any]) -> Dict[str, Any]:
    """The keys the hub's `current_conditions` has always carried, filled from one rate_one_spot frame."""
    ft = _ft(row.get("surf_height_m"))
    out = {
        "wave_height_ft": ft,
        "offshore_height_ft": _ft(row.get("offshore_hs_m")),
        "surf_regime": row.get("surf_regime"),
        "wave_direction": row.get("swell_from_deg"),
        "wave_period": row.get("period_s"),
        "swell_height_ft": _ft(row.get("primary_swell_hs_m")),
        "swell_direction": None,
        "label": _label(ft),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        # ★ NEW, additive: the exact rated height and where the verdict came from.
        "surf_height_m": row.get("surf_height_m"),
        "valid_time": row.get("valid_time"),
        "rating_source": row.get("source"),
        "rating_served_valid_time": row.get("served_valid_time"),
        "rating_why": row.get("why"),
        "rating_limiter": row.get("limiter"),
        "tide": row.get("tide"),
        "data_source": {"kind": "rate_one_spot", "source": row.get("source")},
    }
    if row.get("score") is not None:
        out.update({"rating": row["score"], "rating_level": row.get("level"),
                    "rating_raw": row.get("raw_score"), "rating_confirmed": row.get("confirmed")})
    for k in ("forecast_confidence", "directional_conflict"):
        if row.get(k):
            out[k] = row[k]
    if row.get("wind_kt") is not None:
        out["wind_speed_kts"] = row["wind_kt"]
        out["wind_direction"] = row.get("wind_from_deg")
        out["wind_word"] = row.get("wind_word")
    return out


def daily_rows(frames: List[Dict[str, Any]], dates, offset_h: int,
               dense_end: Optional[datetime] = None, civil: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    """One row per LOCAL date in `dates`: the real max / min over that day's frames that resolved, and the
    day's best-rated frame. A date with no resolved frame is a `no_data` row, never a 0 ft one.

    `civil` = {"iana", "plan_start", "plan_end"} groups the SAME frames by civil date instead (location_time phase 1,
    presentation only: the frames were planned and rated before this and are not changed by it)."""
    by_day: Dict[Any, List[Dict[str, Any]]] = {d: [] for d in dates}
    for fr in frames:
        at = datetime.fromisoformat(fr["valid_time"].replace("Z", "+00:00"))
        d = _lt.civil_date(at, civil["iana"]) if civil else local_date(at, offset_h)
        if d in by_day:
            by_day[d].append(fr)
    rows = []
    for d in dates:
        planned = by_day[d]
        rated = [f for f in planned if isinstance(f.get("surf_height_m"), (int, float))]
        row = {"date": d.isoformat(), "utc_offset_hours": offset_h, "frames_planned": len(planned),
               "frames_rated": len(rated)}
        if civil:
            row.update(_civil_row_fields(d, civil))
        if dense_end is not None and planned:
            dense = [datetime.fromisoformat(f["valid_time"].replace("Z", "+00:00")) <= dense_end for f in planned]
            row["sample_basis"] = "3-hourly" if all(dense) else ("day-parts" if not any(dense) else "mixed")
        if not rated:
            row.update({"wave_height_min": None, "wave_height_max": None, "label": "Unavailable",
                        "status": "no_data" if planned else "not_computed"})
            rows.append(row)
            continue
        top = max(rated, key=lambda f: f["surf_height_m"])
        low = min(rated, key=lambda f: f["surf_height_m"])
        scored = [f for f in rated if f.get("score") is not None]
        best = max(scored, key=lambda f: f["score"]) if scored else None
        max_ft = _ft(top["surf_height_m"])
        row.update({
            "wave_height_min": _ft(low["surf_height_m"]),
            "wave_height_max": max_ft,
            "surf_height_max_m": top["surf_height_m"],
            "surf_height_min_m": low["surf_height_m"],
            "max_time": top["valid_time"],
            "offshore_height_ft": _ft(top.get("offshore_hs_m")),
            "surf_regime": top.get("surf_regime"),
            "wave_direction": top.get("swell_from_deg"),
            "wave_period": top.get("period_s"),
            "swell_height_ft": _ft(top.get("primary_swell_hs_m")),
            "label": _label(max_ft),
            "status": "available",
        })
        if best is not None:
            row.update({"rating": best["score"], "rating_level": best.get("level"),
                        "rating_time": best["valid_time"], "rating_basis": "best_frame"})
        if civil:
            for k in ("max_time", "rating_time"):
                if row.get(k):
                    row[k + "_local"] = _lt.local_iso(datetime.fromisoformat(row[k].replace("Z", "+00:00")),
                                                      civil["iana"])
        rows.append(row)
    return rows


def _civil_row_fields(d, civil: Dict[str, Any]) -> Dict[str, Any]:
    """The civil day's zone, its offset at local noon, and `partial` when the day reaches outside the planned span
    (the plan keeps its solar local-day bounds in phase 1, so a civil day at either end can be partly unplanned)."""
    start, end = _lt.civil_day_bounds(d, civil["iana"])
    noon = start + (end - start) / 2
    off_min = _lt.offset_minutes(civil["iana"], noon)
    return {"iana": civil["iana"], "utc_offset_min": off_min,
            "utc_offset_hours": off_min // 60 if off_min % 60 == 0 else round(off_min / 60.0, 2),
            "day_start_utc": start.strftime("%Y-%m-%dT%H:%M:%SZ"), "day_end_utc": end.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "partial": bool(start < civil["plan_start"] or end > civil["plan_end"])}


def describe_location_time(lat: float, lng: float, now: datetime) -> Optional[Dict[str, Any]]:
    """`location_time` for the hub, read ONCE per request: the cache key and the payload must come from the same answer,
    or a flag flip between two reads would file a civil payload under a solar key (or the reverse) for the TTL."""
    try:
        return _lt.describe(lat, lng, now)
    except Exception as e:                                              # noqa: BLE001 - presentation only
        logger.warning(f"[spot-hub] location_time failed at ({lat},{lng}); solar rows: {e}")
        return None


def presentation_identity(lt: Optional[Dict[str, Any]]):
    """What the payload cache must also key on now that rows can be civil: the zone + grid version (or 'solar' when the
    flag is off or the grid cannot answer). Per-frame rating keys (`_CACHE`) do NOT include it - phase 1 never changes
    which frames are rated."""
    return ("civil", lt["iana"], lt.get("grid")) if lt and lt.get("iana") else ("solar",)


async def resolve_hub_conditions(resolver, model: str, lat: float, lng: float, forecast_days: int = 11,
                                 spot_id: Any = None, spot_meta: Optional[Dict[str, Any]] = None,
                                 horizon_hours: Optional[int] = None,
                                 now: Optional[datetime] = None, load_l2=None) -> Dict[str, Any]:
    """The hub payload (`current_conditions` + `forecast`) with every frame from `rate_one_spot`.
    One build per (model, spot, window, hour): a repeat is served from `_PAYLOAD`, a concurrent one awaits the
    build already running."""
    import copy
    now = now or datetime.now(timezone.utc)
    lt = describe_location_time(lat, lng, now)
    key = (model, str(spot_id if spot_id is not None else f"{float(lat):.4f},{float(lng):.4f}"),
           int(forecast_days), horizon_hours, valid_time_str(current_valid_time(now)),
           _rf.flag("RATING_LOCAL_SIZE"), os.environ.get("RATING_TIDE", "0"),
           presentation_identity(lt))
    hit = _PAYLOAD.get(key)
    if hit is not None and (time.time() - hit[0]) < _PAYLOAD_TTL_S:
        return copy.deepcopy(hit[1])
    task = _BUILDING.get(key)
    if task is None:
        task = asyncio.ensure_future(_build_hub_conditions(resolver, model, lat, lng, forecast_days, spot_id,
                                                           spot_meta, horizon_hours, now, load_l2, lt))
        _BUILDING[key] = task

        def _store(t, key=key):
            _BUILDING.pop(key, None)
            if t.cancelled() or t.exception() is not None:
                return
            if len(_PAYLOAD) >= _PAYLOAD_MAX:
                _PAYLOAD.pop(next(iter(_PAYLOAD)))
            _PAYLOAD[key] = (time.time(), t.result())
        task.add_done_callback(_store)
    # SHIELDED: a caller that gives up (spot_details' opt-in deadline) does not cancel the build the next
    # viewer is waiting on; the build finishes and fills the cache.
    payload = await asyncio.shield(task)
    return copy.deepcopy(payload)


async def _build_hub_conditions(resolver, model, lat, lng, forecast_days, spot_id, spot_meta, horizon_hours,
                                now, load_l2, lt=None) -> Dict[str, Any]:
    spot = dict(spot_meta or {})
    spot.setdefault("id", spot_id if spot_id is not None else f"point:{float(lat):.4f},{float(lng):.4f}")
    spot["latitude"], spot["longitude"] = lat, lng
    ref = None
    if spot_id is not None and _rf.on("RATING_LOCAL_SIZE"):
        try:
            from services.weather_pipeline.spot_size_climatology import reference_for_spot
            ref = reference_for_spot(spot_id)
        except Exception as e:   # the global curve: a less local number, never a wrong one
            logger.debug(f"[spot-hub] size reference unavailable for {spot_id}: {e}")
    l2_obj = None
    try:
        if load_l2 is None:
            from services.weather_pipeline.spot_ratings_precompute import load_spot_ratings_l2_cached
            load_l2 = load_spot_ratings_l2_cached
        l2_obj = await asyncio.to_thread(load_l2)
    except Exception as e:
        logger.debug(f"[spot-hub] precomputed read failed: {e}")

    from services.forecast_tier_window import tier_horizon_hours
    cap_h = tier_horizon_hours("premium", model)          # the model's capability horizon (capabilities.py)
    horizon = cap_h if horizon_hours is None else max(0, min(int(horizon_hours), cap_h))
    n_days = min(MAX_DAILY_ROWS, max(0, int(forecast_days) - 1))
    offset = solar_utc_offset_hours(lng)
    first = local_date(now, offset) + timedelta(days=1)
    dates = [first + timedelta(days=i) for i in range(n_days)]
    last_day_end = (datetime(dates[-1].year, dates[-1].month, dates[-1].day, tzinfo=timezone.utc)
                    + timedelta(days=1, hours=-offset)) if dates else now
    plan_end_h = max(0.0, min(horizon, (last_day_end - now).total_seconds() / 3600.0))
    plan = frame_plan(lng, now, int(plan_end_h)) if dates else []
    plan = [t for t in plan if local_date(t, offset) >= first]

    sem = asyncio.Semaphore(_CONCURRENCY)

    async def one(at: datetime, exact: bool):
        vt = valid_time_str(at)
        async with sem:
            try:
                return await rate_frame(resolver, spot, model, vt, ref, l2_obj, exact)
            except Exception as e:   # one frame must not cost the payload
                logger.debug(f"[spot-hub] frame {vt} unavailable at ({lat},{lng}): {e}")
                return {"valid_time": vt, "surf_height_m": None, "score": None, "source": "error"}

    now_vt = current_valid_time(now)
    rows = await asyncio.gather(one(now_vt, False), *[one(t, True) for t in plan])
    current_row, frames = rows[0], list(rows[1:])
    if current_row.get("source", "").startswith("precomputed") and current_row.get("wind_kt") is None:
        await _display_wind(resolver, model, lat, lng, current_row)
    dense_end = now + timedelta(hours=DENSE_HORIZON_H)
    composition = {"flag": FLAG, "chain": "spot_ratings.rate_one_spot",
                   "frames": len(plan) + 1, "horizon_hours": horizon, "utc_offset_hours": offset}
    forecast = None
    if lt is not None:                                       # killed -> None -> the composition is exactly as before
        composition["location_time"] = lt
    if lt and lt.get("iana") and dates:
        # location_time phase 1: the SAME rated frames, grouped by the spot's civil date. Any failure here falls back
        # to the solar rows (the flag-off payload), never to a 500.
        try:
            civil_first = _lt.civil_date(now, lt["iana"]) + timedelta(days=1)
            civil_dates = [civil_first + timedelta(days=i) for i in range(n_days)]
            plan_start = datetime(first.year, first.month, first.day, tzinfo=timezone.utc) - timedelta(hours=offset)
            civil = {"iana": lt["iana"], "plan_start": plan_start,
                     "plan_end": now + timedelta(hours=plan_end_h)}
            forecast = daily_rows(frames, civil_dates, offset, dense_end, civil)
            composition["day_grouping"] = "civil"
        except Exception as e:                                          # noqa: BLE001 - presentation only
            logger.warning(f"[spot-hub] civil grouping failed at ({lat},{lng}) zone {lt.get('iana')}; solar rows: {e}")
            forecast = None
            composition["day_grouping"] = "solar_fallback"
    if forecast is None:
        forecast = daily_rows(frames, dates, offset, dense_end)
    return {"current_conditions": current_conditions(current_row), "forecast": forecast, "composition": composition}


async def _display_wind(resolver, model, lat, lng, row):
    """A precomputed frame carries no wind: one wind resolve for DISPLAY (the verdict stays the glyph's)."""
    try:
        from services.weather_pipeline.surf_point import resolve_surf_geometry
        wind = await resolver.resolve_point(model=model, domain="wind", layer="wind", lat=lat, lng=lng,
                                            valid_time_str=row["valid_time"])
        normal = getattr(resolve_surf_geometry(lat, lng), "shore_normal_deg", None)
        kt, frm = _point_field(wind, "speed"), _point_field(wind, "direction")
        row["wind_kt"] = round(float(kt), 1) if isinstance(kt, (int, float)) else None
        row["wind_from_deg"] = frm
        row["wind_word"] = wind_word(frm, normal)
    except Exception as e:
        logger.debug(f"[spot-hub] display wind unavailable at ({lat},{lng}): {e}")
