"""
Spatial batching for native CMEMS point fetches (2026-07-06, chip task_2d50cd81).

WHY: batch lanes (spot-ratings precompute: ~1000 spots × the EURO model pass) used to fire ONE
CMEMS subset subprocess PER SPOT — ~5.7s each when healthy, and CMEMS throttles under that
request volume (run 28754458502 burned 138 × the full 25s timeout = 57.5 of its 60 minutes).
The stopgap POINT_SKIP_NATIVE_COPERNICUS=1 routed batch-lane points to the open-meteo proxy —
sub-second, but NOT native authority.

HOW: surf spots cluster along coastlines, and copernicus_marine_service._fetch_sync already
subsets ONE bounding box around ALL points in a call. The pre-warm groups a lane's spots into
grid buckets of POINT_BATCH_BOX_DEG (default 5°), issues ONE full-variable, full-horizon fetch
per bucket, and stashes a per-point BATCHED cache entry that fetch_euro_marine consults for any
layer subset / valid_time (the full variable set supersets every per-layer list; the full horizon
supersets any valid_time window — consumers sample their target hour by timestamp). ~1000 points
become ~60-100 box requests; native authority restored to the batch lanes.

GATING: POINT_BATCH_NATIVE_COPERNICUS=1 enables (set it in batch-lane workflow env ONLY —
default off everywhere, zero serve-box impact). A lane still running POINT_SKIP_NATIVE_COPERNICUS
pre-warms nothing: the ladder would never read the entries.
"""
import os
import copy
import time
import logging

logger = logging.getLogger(__name__)

# Must MATCH the ladder's EURO point horizon (point_resolution: point_forecast_days["EURO"]) —
# the batched cache key includes forecast_days, so a mismatch means every lookup misses.
EURO_POINT_FORECAST_DAYS = 10


def cluster_points_into_boxes(points, box_deg: float):
    """Group (lat, lng) pairs into grid buckets of box_deg on each axis (pure; exported for
    tests). Coordinates are rounded to 2dp (the point-cache key convention) and deduped; None/NaN
    skipped. Each bucket spans ≤ box_deg — far under _fetch_sync's 28°×55° single-request limit."""
    buckets = {}
    seen = set()
    for pair in points or []:
        try:
            la = float(pair[0])
            lo = float(pair[1])
        except (TypeError, ValueError, IndexError):
            continue
        if la != la or lo != lo:  # NaN
            continue
        key = (round(la, 2), round(lo, 2))
        if key in seen:
            continue
        seen.add(key)
        b = (int(la // box_deg), int(lo // box_deg))
        buckets.setdefault(b, []).append(key)
    return list(buckets.values())


def batched_point_cache_key(lat: float, lng: float, forecast_days: int):
    """The cache key fetch_euro_marine's batched lookup probes: single rounded point, full
    variable set (None), no valid_time restriction (full horizon)."""
    return ((round(lat, 2),), (round(lng, 2),), forecast_days, None, None)


async def prewarm_euro_marine_point_cache(coords, forecast_days: int = EURO_POINT_FORECAST_DAYS) -> dict:
    """Pre-warm the CMEMS point cache for a batch lane: one box fetch per spot cluster, one
    batched entry per spot. Never raises; returns stats for the lane log."""
    if os.environ.get("POINT_BATCH_NATIVE_COPERNICUS") != "1":
        return {"enabled": False, "reason": "flag_off"}
    if os.environ.get("POINT_SKIP_NATIVE_COPERNICUS") == "1":
        # The ladder skips native CMEMS entirely under this flag — fetching would be pure waste.
        return {"enabled": False, "reason": "skip_flag_active"}
    from services.copernicus_marine_service import fetch_euro_marine, _point_cache, _point_cache_cap

    try:
        box_deg = float(os.environ.get("POINT_BATCH_BOX_DEG", "5") or 5)
    except ValueError:
        box_deg = 5.0
    boxes = cluster_points_into_boxes(coords, box_deg)
    stats = {
        "enabled": True,
        "points": sum(len(b) for b in boxes),
        "boxes": len(boxes),
        "fetched": 0,
        "failed": 0,
        "cached_points": 0,
        "elapsed_s": 0.0,
    }

    # SELF-CORRECTING CAP (2026-07-08, runbook §11 — forecast-ingest cron-hang root). The per-box
    # eviction below trims _point_cache to _point_cache_cap() (POINT_CACHE_MAX, default 100). If a
    # lane enables batching but forgets to raise the cap, the pre-warm silently EVICTS its own
    # ~1000 entries before the consume pass reads them → 0 batched hits → every point re-spawns a
    # CMEMS subprocess (forecast-ingest ran its ~1000-spot EURO ratings pass this way for days: the
    # ~100-min tail that pushed runs past the 165-min timeout). Guarantee the cap holds this whole
    # pre-warmed batch (batched hits return before adding exact-key entries, so the cache never
    # grows past this during consume) so the pre-warm can NEVER defeat itself; warn so drift is
    # visible. Only ever runs in gated batch lanes (ephemeral runners) — safe to raise there.
    # (_point_cache + _point_cache_cap already imported from copernicus_marine_service above.)
    required = len(_point_cache) + stats["points"]          # must hold existing entries + this batch
    if _point_cache_cap() < required:
        target = required + max(stats["points"] // 2, 64)    # headroom for exact-key entries during consume
        logger.warning(
            "[Copernicus Batching] POINT_CACHE_MAX=%s is too small for %d pre-warmed points - "
            "raising to %d for this run so the pre-warm doesn't evict its own entries (0 batched "
            "hits = every point re-spawns a subprocess). Set POINT_CACHE_MAX>=%d in the lane env "
            "to silence this.", os.environ.get("POINT_CACHE_MAX", "100 (default)"),
            stats["points"], target, target)
        os.environ["POINT_CACHE_MAX"] = str(target)

    t0 = time.time()
    for box in boxes:
        lats = [p[0] for p in box]
        lons = [p[1] for p in box]
        try:
            results = await fetch_euro_marine(
                latitudes=lats, longitudes=lons,
                forecast_days=forecast_days, variables=None, valid_time=None,
            )
        except Exception as e:
            stats["failed"] += 1
            logger.warning(f"[Copernicus Batching] box fetch failed ({len(box)} pts): {e}")
            continue
        if not results:
            stats["failed"] += 1
            continue
        stats["fetched"] += 1
        now = time.time()
        # Results are INDEX-ALIGNED with the request (error stubs preserve ordering) — key by the
        # REQUESTED coords, never the grid-snapped result coords.
        for (rla, rlo), res in zip(box, results):
            if not res or not res.get("hourly", {}).get("time"):
                continue  # error stub — leave that point to the ladder's own fallback
            _point_cache[batched_point_cache_key(rla, rlo, forecast_days)] = ([copy.deepcopy(res)], now)
            stats["cached_points"] += 1
        cap = _point_cache_cap()
        while len(_point_cache) > cap:
            oldest = min(_point_cache.keys(), key=lambda k: _point_cache[k][1])
            _point_cache.pop(oldest, None)
    stats["elapsed_s"] = round(time.time() - t0, 1)
    logger.info(f"[Copernicus Batching] pre-warm complete: {stats}")
    return stats
