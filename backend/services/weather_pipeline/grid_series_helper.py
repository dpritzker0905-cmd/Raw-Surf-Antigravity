"""
grid_series_helper.py — multi-hour marine grid series assembly.

Extracted from routes/weather.py to keep that route file under the LOC limit. Builds a
TIME-SERIES of viewport grids by reusing the EXACT per-hour dynamic-product builder that
/grid already uses (viewport_service.get_cached_dynamic_product). The first requested hour
triggers the multi-hour upstream fetch (Open-Meteo/Copernicus already return it and the
provider caches it for 5 min); every subsequent hour re-slices that same cached data.

Additive: nothing here changes the existing /grid path.
"""
import asyncio
import logging
import time
from datetime import datetime, timezone, timedelta

from fastapi import HTTPException
from starlette.background import BackgroundTasks

logger = logging.getLogger(__name__)

MAX_FRAMES = 48
CONCURRENCY = 4
# A single hour must never hang the whole series. Models with pre-built regional/global
# products (GFS/ICON via manifest) resolve in ms; models that fall to the slow dynamic
# path (EURO/Copernicus) can stall — so cap each hour and the whole build, and return
# whatever frames completed. The client uses the partial series and falls back to the
# per-hour flow for missing hours.
PER_HOUR_TIMEOUT = 10.0
OVERALL_DEADLINE = 35.0
# EURO/Copernicus fast path budget. Kept under the client's 45s fetch timeout so the
# backend always answers first. The Copernicus full-range fetch is cached (10 min), so
# only the FIRST EURO series load pays this; later ones are instant.
EURO_SERIES_TIMEOUT = 40.0
EURO_NATIVE_HOURS = 240  # EURO marine native horizon; 241..336h are stored ESTIMATED products


async def _build_euro_marine_series(viewport_service, layer: str, bbox: str, hour_list, base):
    """
    EURO/Copernicus fast path. The per-hour loop hangs for EURO because each hour passes a
    `valid_time`, which makes copernicus_marine_service fetch only a ±3h CMEMS window per
    hour (serialized behind a global lock) — N slow downloads. Instead, fetch the FULL
    forecast range ONCE (valid_time=None) and normalize every requested hour from that one
    response, reusing the SAME normalizer /grid's dynamic path uses.

    Additive + EURO-marine-only: touches no existing method, cache, or the /grid path. On
    any problem returns None so build_grid_series falls back to the generic per-hour loop.
    """
    from services.weather_pipeline.providers.copernicus_provider import CopernicusProvider
    from services.weather_pipeline.route_helpers import parse_bbox, generate_bbox_coords
    from services.weather_pipeline.normalizer import WeatherNormalizer

    w, s, e, n = parse_bbox(bbox)
    bbox_dict = {"west": w, "south": s, "east": e, "north": n}

    # Adaptive resolution + 500-point cap, mirroring the dynamic builder so the grid matches.
    resolution = 0.25
    steps = [0.25, 0.5, 1.0, 2.0, 2.5, 5.0, 10.0, 15.0, 20.0, 30.0, 40.0]
    lats, lons = generate_bbox_coords(w, s, e, n, resolution)
    while len(lats) > 500 and resolution != steps[-1]:
        resolution = steps[min(len(steps) - 1, steps.index(resolution) + 1)]
        lats, lons = generate_bbox_coords(w, s, e, n, resolution)
    if not lats:
        return None

    max_h = max(hour_list) if hour_list else 72
    forecast_days = min(10, max(3, (max_h // 24) + 2))

    cop = CopernicusProvider()
    raw = await cop.fetch_grid(
        layer=layer, bbox=bbox_dict, resolution=resolution,
        forecast_days=forecast_days, precomputed_coords=(lats, lons),
        valid_time=None,  # FULL range in ONE fetch — the entire point of this path
    )
    if not raw:
        return None
    raw_list = raw if isinstance(raw, list) else [raw]
    times = (raw_list[0].get("hourly") or {}).get("time") or []
    if not times:
        return None

    frames = []
    shared_bounds = None
    shared_cols = shared_rows = 0
    region_id = f"viewport_series_{w:.2f}_{s:.2f}_{e:.2f}_{n:.2f}"
    for h in hour_list:
        target_dt = base + timedelta(hours=h)
        idx = WeatherNormalizer.find_closest_time_index(times, target_dt)
        if idx is None:
            continue
        t_str = times[idx]
        t_actual = datetime.fromisoformat((t_str if t_str.endswith("Z") else t_str + "Z").replace("Z", "+00:00"))
        normalized = await viewport_service.normalizer.normalize_async(
            model="EURO", provider="copernicus", domain="marine", layer=layer,
            raw_results=raw_list, bbox=bbox_dict, resolution=resolution,
            target_time=t_actual, coverage_mode="viewport", region_id=region_id,
        )
        if not normalized or not getattr(normalized, "grid", None) or not normalized.grid.vectors:
            continue
        g = normalized.grid
        b = {"west": g.bounds.west, "south": g.bounds.south, "east": g.bounds.east, "north": g.bounds.north} if g.bounds else None
        if shared_bounds is None and b:
            shared_bounds, shared_cols, shared_rows = b, g.cols, g.rows
        frames.append({
            "hour_offset": h,
            "valid_time": t_actual.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "cols": g.cols, "rows": g.rows, "bounds": b,
            "vectors": g.vectors,
            "provider": getattr(normalized, "provider", "copernicus"),
            "is_estimated": getattr(normalized, "is_estimated", False),
        })

    frames.sort(key=lambda f: f["hour_offset"])
    return {
        "model": "EURO", "domain": "marine", "layer": layer,
        "base_time": base.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "bounds": shared_bounds, "cols": shared_cols, "rows": shared_rows,
        "frame_count": len(frames), "frames": frames,
    }


async def build_grid_series(resolve_grid, viewport_service, model: str, domain: str, layer: str, bbox: str, hours: str, request=None) -> dict:
    """
    resolve_grid: the SAME async resolver /grid uses (routes.weather.get_grid). Called once
    per requested hour with its valid_time so every frame matches exactly what the live
    heatmap renders (manifest regional/global products AND dynamic viewport products). The
    first hour warms any shared upstream/manifest cache; the rest reuse it.

    request: optional Starlette Request. When the client aborts (scrub/toggle), per-hour
    builds short-circuit so a single series fan-out can't keep N hours of heavy upstream
    fetches running for a dead connection.
    """
    async def _client_gone() -> bool:
        if request is None:
            return False
        try:
            return await request.is_disconnected()
        except Exception:
            return False

    try:
        hour_list = sorted({int(h) for h in hours.split(",") if h.strip() != ""})[:MAX_FRAMES]
    except ValueError:
        raise HTTPException(status_code=400, detail="hours must be comma-separated integers")
    if not hour_list:
        raise HTTPException(status_code=400, detail="no valid hours provided")

    base = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)

    # EURO/Copernicus fast path: one full-range fetch + slice all hours (the generic per-hour
    # loop below hangs for EURO — each hour is a separate ±3h CMEMS download). Additive +
    # EURO-marine-only; on any failure fall through to the generic loop.
    #
    # F2: a page can SPAN the native/estimate boundary (240h) — e.g. 144..285h. Copernicus only
    # covers <=240h, so run the fast path on the NATIVE hours and let the per-hour loop build the
    # ESTIMATED hours (>240h). Those resolve to STORED estimated products (manifest match + load
    # — fast, no Copernicus), so they don't hang like a native per-hour EURO fetch would.
    loop_hours = hour_list
    prebuilt_frames = []  # native EURO frames carried over from the Copernicus fast path
    if viewport_service is not None and model.upper() == "EURO" and domain.lower() == "marine" and not await _client_gone():
        native_hours = [h for h in hour_list if h <= EURO_NATIVE_HOURS]
        estimated_hours = [h for h in hour_list if h > EURO_NATIVE_HOURS]
        if native_hours:
            try:
                euro = await asyncio.wait_for(
                    _build_euro_marine_series(viewport_service, layer, bbox, native_hours, base),
                    timeout=EURO_SERIES_TIMEOUT,
                )
                if euro and euro.get("frame_count", 0) > 0:
                    if not estimated_hours:
                        return euro
                    prebuilt_frames = euro.get("frames", []) or []
                    loop_hours = estimated_hours  # build only the stored estimated hours per-hour
                else:
                    logger.warning("[grid_series] EURO fast path returned no frames; falling back to per-hour")
            except BaseException as e:
                logger.warning(f"[grid_series] EURO fast path failed ({type(e).__name__}: {e}); falling back to per-hour")
        # native_hours empty (page entirely >240h): loop_hours stays = hour_list (all estimated)
        # and the per-hour loop resolves the stored estimated EURO products directly.

    # Bound concurrency so we don't spike CPU/memory on the 1-CPU box re-normalizing many
    # hours at once (each hour after the first is a cheap re-slice of the cached fetch).
    sem = asyncio.Semaphore(CONCURRENCY)
    deadline = time.monotonic() + OVERALL_DEADLINE

    async def _build_one(h: int):
        if time.monotonic() > deadline or await _client_gone():
            return (h, None)
        target_dt = base + timedelta(hours=h)
        vt_str = target_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
        try:
            async with sem:
                if time.monotonic() > deadline:
                    return (h, None)
                # Throwaway BackgroundTasks so get_grid's revalidation scheduling has a sink
                # (these tasks never run outside a request cycle — harmless). Per-hour timeout
                # so a slow/stalled model (EURO dynamic) can't hang the whole series.
                product = await asyncio.wait_for(
                    resolve_grid(
                        model=model, domain=domain, layer=layer,
                        valid_time=vt_str, bbox=bbox, background_tasks=BackgroundTasks()
                    ),
                    timeout=PER_HOUR_TIMEOUT,
                )
            return (h, product)
        except asyncio.TimeoutError:
            logger.warning(f"[grid_series] hour +{h}h timed out after {PER_HOUR_TIMEOUT}s")
            return (h, None)
        except BaseException as e:  # incl. CancelledError — one hour must never sink the series
            logger.warning(f"[grid_series] hour +{h}h failed: {type(e).__name__}: {e}")
            return (h, None)

    # Build the first hour FIRST so it populates the shared upstream cache, then build the
    # rest concurrently (bounded) — they re-slice the cached multi-hour data. The whole
    # thing must never 500: on any unexpected error return an empty series so the client
    # silently falls back to the per-hour flow. (_error is temporary diagnostics.)
    try:
        results = []
        if loop_hours:
            results = [await _build_one(loop_hours[0])]
            if len(loop_hours) > 1:
                results.extend(await asyncio.gather(*[_build_one(h) for h in loop_hours[1:]], return_exceptions=True))
        results = [r for r in results if isinstance(r, tuple)]
    except BaseException as e:
        import traceback
        logger.error(f"[grid_series] build failed for {model}/{layer}: {type(e).__name__}: {e}\n{traceback.format_exc()}")
        return {"model": model, "domain": domain, "layer": layer, "base_time": base.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "bounds": None, "cols": 0, "rows": 0, "frame_count": 0, "frames": [], "_error": f"{type(e).__name__}: {e}"}

    shared_bounds = None
    shared_cols = shared_rows = 0
    frames = []
    for h, product in results:
        if not product or not getattr(product, "grid", None) or not product.grid.vectors:
            continue
        g = product.grid
        b = {"west": g.bounds.west, "south": g.bounds.south, "east": g.bounds.east, "north": g.bounds.north} if g.bounds else None
        if shared_bounds is None and b:
            shared_bounds, shared_cols, shared_rows = b, g.cols, g.rows
        frames.append({
            "hour_offset": h,
            "valid_time": product.valid_time.strftime("%Y-%m-%dT%H:%M:%SZ") if getattr(product, "valid_time", None) else None,
            "cols": g.cols,
            "rows": g.rows,
            "bounds": b,
            "vectors": g.vectors,
            "provider": getattr(product, "provider", None),
            "is_estimated": getattr(product, "is_estimated", False),
        })

    # Merge the EURO native fast-path frames (<=240h) with the per-hour-built estimated frames
    # (>240h) so a boundary-spanning page returns its full hour range.
    if prebuilt_frames:
        have = {f["hour_offset"] for f in frames}
        for pf in prebuilt_frames:
            if pf.get("hour_offset") not in have:
                frames.append(pf)
                if shared_bounds is None and pf.get("bounds"):
                    shared_bounds, shared_cols, shared_rows = pf["bounds"], pf.get("cols", 0), pf.get("rows", 0)

    frames.sort(key=lambda f: f["hour_offset"])
    return {
        "model": model,
        "domain": domain,
        "layer": layer,
        "base_time": base.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "bounds": shared_bounds,
        "cols": shared_cols,
        "rows": shared_rows,
        "frame_count": len(frames),
        "frames": frames,
    }
