"""point_rating.py — the map infobox's surf QUALITY for any coordinate (A15-05(b), 2026-09-26).

The infobox badge was the last rating surface computed in the BROWSER: `MapForecastOverlay.js` fed
`surfRating.js::computeSurfRating` (a JS mirror of `surf_rating.py`) with the backend's breaking height
but with the WIND from the browser's Open-Meteo forecast (`wx`, bias-adjusted locally), not the backend
wind point the glyph grades on, and without `break_depth_m`, so the oversize gate lost its per-spot
capacity. Same spot-hour, two answers: the glyph beside the box and the badge inside it.

★ THIS MODULE DERIVES NOTHING. It answers with what the app already shows, in the order /spot-ratings
serves it:
  1. a catalogued spot within `MATCH_KM` of the coordinate in the PRECOMPUTED frame the glyph reads
     (`select_precomputed_laddered`, the same fresh -> bounded-stale ladder) -> that item, verbatim;
  2. otherwise `spot_ratings.rate_one_spot` — the reference implementation — at the coordinate, with the
     per-coordinate size reference, then the observation gate the hub applies (`gate_single_model_surface`,
     unconditional for the reason `spot_conditions` records).
Anything computed here instead would be the "second forecast path for one screen" CLAUDE.md forbids.

COST, on a 1-CPU serve box with a melt history: the precomputed answer is an in-memory read of the L2
object /spot-ratings already caches. The live answer is three point resolutions (~0.2-0.5 s, the
per-spot cost of the /spot-ratings live lane), so it is cached per coordinate+hour and capped in flight;
beyond the cap the route answers 503 and the badge is simply absent, never a guessed number.
"""
import asyncio
import logging
import math
import os
import time
from typing import Optional

logger = logging.getLogger(__name__)

MATCH_KM = 2.0            # the tolerance `rating_confirmation.confirmation_for` uses to call two coordinates one break
_CACHE: dict = {}
_CACHE_TTL_S = 600.0      # keyed by valid_time, so a new hour is a new key; this only bounds re-views
_CACHE_MAX = 2000
_INFLIGHT = 0


class PointRatingAtCapacity(Exception):
    """The live lane is full; the caller answers 503 rather than queueing on the serve box."""


async def local_reference_at(lat, lng) -> Optional[float]:
    """The size reference a rating at this COORDINATE grades against, or None (the global curve).

    Moved here verbatim from `point_surf_augment` so the infobox's rating and the exact-point payload
    read ONE reference. The reasoning it carried there still holds:
    ★ THE CELL BLOB IS THE FALLBACK, NOT THE ANSWER — CORRECTED 2026-08-01 (queue E#1). At a catalogued
    spot the per-spot reference wins, because that is the number the glyph beside the box graded with
    (|cell - spot| median 21.3%, max 52.5%; -11.4 to +9.6 points at the badge). Away from a spot the
    cell value is right — there is no glyph there to disagree with.
    ⛔ OFF THE EVENT LOOP — `load_grid_size_climatology_l2_cached` is a `requests.get(timeout=10)` behind
    a 600 s TTL. ⚠️ THE SHORT-CIRCUIT IS PRESERVED DELIBERATELY: the loader runs only when the spot
    lookup came back empty, so a point that has a per-coordinate reference never pays a cache miss.
    Gated RATING_LOCAL_SIZE (the same flag the glyph lanes read); fail-open is the caller's job."""
    if os.environ.get("RATING_LOCAL_SIZE", "0") != "1":
        return None
    from services.weather_pipeline.grid_size_climatology import (
        load_grid_size_climatology_l2_cached, reference_for)
    from services.weather_pipeline.spot_size_climatology import reference_for_coordinate
    ref = reference_for_coordinate(lat, lng)
    if not ref:
        clim = await asyncio.to_thread(load_grid_size_climatology_l2_cached)
        ref = reference_for(clim, lat, lng)
    return ref


def _bbox_around(lat, lng, km):
    """A (w, s, e, n) box that contains every point within `km`; longitudes wrap at +-180."""
    dlat = km / 111.0
    dlng = km / (111.0 * max(math.cos(math.radians(lat)), 0.05))
    w, e = lng - dlng, lng + dlng
    w = w + 360.0 if w < -180.0 else w
    e = e - 360.0 if e > 180.0 else e
    return (w, lat - dlat, e, lat + dlat)


def precomputed_rating(obj, lat, lng, model, valid_time):
    """PURE: (item, source, served_valid_time) for the nearest catalogued spot within MATCH_KM in the
    frame /spot-ratings would serve for this hour, or (None, "live", None)."""
    from services.weather_pipeline.rating_confirmation import _haversine_km
    from services.weather_pipeline.spot_ratings_precompute import select_precomputed_laddered
    spots, source, served = select_precomputed_laddered(
        obj, _bbox_around(lat, lng, MATCH_KM), model, valid_time)
    best, best_km = None, None
    for sp in spots or []:
        d = _haversine_km(lat, lng, sp["latitude"], sp["longitude"])
        if d <= MATCH_KM and (best_km is None or d < best_km):
            best, best_km = sp, d
    if best is None:
        return None, "live", None
    return best, source, served


async def live_rating(resolver, lat, lng, model, valid_time) -> dict:
    """`rate_one_spot` at the coordinate, then the hub's observation gate. Nothing else."""
    from services.weather_pipeline.rating_confirmation import gate_single_model_surface
    from services.weather_pipeline.spot_ratings import rate_one_spot
    try:
        ref = await local_reference_at(lat, lng)
    except Exception as e:   # no reference is the global curve: a less local number, never a wrong one
        logger.debug(f"[point-rating] size reference unavailable at ({lat},{lng}): {e}")
        ref = None
    spot = {"id": f"point:{lat:.4f},{lng:.4f}", "name": None, "latitude": lat, "longitude": lng}
    item = await rate_one_spot(resolver, spot, model, valid_time, reference_size_m=ref)
    # ⛔ OFF THE EVENT LOOP: `confirmation_for` inside may do a blocking L2 load on a TTL miss —
    # the same offload `spot_conditions` applies to this same call.
    gated, level, confirm, raw = await asyncio.to_thread(
        gate_single_model_surface, item.get("score"), lat, lng, valid_time)
    if gated is not None:
        item["score"], item["level"] = gated, level
    # The cap changes the DISPLAYED verdict, never the physics: the ungated score stays auditable.
    item["raw_score"], item["confirmed"] = raw, confirm
    return item


async def rate_point(resolver, lat, lng, model, valid_time, load_l2=None) -> tuple:
    """(item_or_None, source, served_valid_time) for the infobox at (lat, lng, valid_time).

    Raises PointRatingAtCapacity when the live lane is full (POINT_RATING_MAX_CONCURRENT, default 2;
    0 disables the live lane, leaving catalogued spots served from the precomputed frame)."""
    global _INFLIGHT
    lat, lng = round(float(lat), 4), round(float(lng), 4)
    obj = None
    try:
        if load_l2 is None:
            from services.weather_pipeline.spot_ratings_precompute import load_spot_ratings_l2_cached
            load_l2 = load_spot_ratings_l2_cached
        # ⛔ OFF THE EVENT LOOP — a synchronous Supabase Storage GET behind a 300 s TTL (the same
        # offload /spot-ratings applies; tests/test_event_loop_offload_guard.py bans the bare shape).
        obj = await asyncio.to_thread(load_l2)
    except Exception as e:
        logger.debug(f"[point-rating] precomputed read failed: {e}")
    item, source, served = precomputed_rating(obj, lat, lng, model, valid_time)
    if item is not None:
        return item, source, served

    key = f"{model}|{valid_time}|{lat}|{lng}"
    hit = _CACHE.get(key)
    if hit is not None and (time.time() - hit[0]) < _CACHE_TTL_S:
        return hit[1], "live", None
    cap = int(os.environ.get("POINT_RATING_MAX_CONCURRENT", "2"))
    if _INFLIGHT >= cap:
        raise PointRatingAtCapacity()
    _INFLIGHT += 1
    try:
        item = await live_rating(resolver, lat, lng, model, valid_time)
    finally:
        _INFLIGHT -= 1
    if len(_CACHE) >= _CACHE_MAX:
        _CACHE.pop(next(iter(_CACHE)))
    _CACHE[key] = (time.time(), item)
    return item, "live", None
