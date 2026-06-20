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


async def build_grid_series(resolve_grid, model: str, domain: str, layer: str, bbox: str, hours: str) -> dict:
    """
    resolve_grid: the SAME async resolver /grid uses (routes.weather.get_grid). Called once
    per requested hour with its valid_time so every frame matches exactly what the live
    heatmap renders (manifest regional/global products AND dynamic viewport products). The
    first hour warms any shared upstream/manifest cache; the rest reuse it.
    """
    try:
        hour_list = sorted({int(h) for h in hours.split(",") if h.strip() != ""})[:MAX_FRAMES]
    except ValueError:
        raise HTTPException(status_code=400, detail="hours must be comma-separated integers")
    if not hour_list:
        raise HTTPException(status_code=400, detail="no valid hours provided")

    base = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)

    # Bound concurrency so we don't spike CPU/memory on the 1-CPU box re-normalizing many
    # hours at once (each hour after the first is a cheap re-slice of the cached fetch).
    sem = asyncio.Semaphore(CONCURRENCY)
    deadline = time.monotonic() + OVERALL_DEADLINE

    async def _build_one(h: int):
        if time.monotonic() > deadline:
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
        results = [await _build_one(hour_list[0])]
        if len(hour_list) > 1:
            results.extend(await asyncio.gather(*[_build_one(h) for h in hour_list[1:]], return_exceptions=True))
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
