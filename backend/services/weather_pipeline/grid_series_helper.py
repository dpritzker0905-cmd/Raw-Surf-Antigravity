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
import os
import time
from datetime import datetime, timezone, timedelta

from fastapi import HTTPException
from starlette.background import BackgroundTasks

from services.weather_pipeline.series_vector_budget import (
    decimate_vectors,
    stamp_build_time_bound,
    stride_for,
)

logger = logging.getLogger(__name__)

MAX_FRAMES = 48
CONCURRENCY = 4


def _frame_rating_mode(grid) -> bool:
    """True when a series frame is a genuine surf-RATING grid (surf=1 + regional → rating_transform_grid ran,
    diagnostics.surf_transform.value_kind == 'surf_rating'). The frontend conformer (frameToMarineData) keys
    `grid.ratingMode` off this so the shader paints the rating band on series-committed frames (the clamp/scrub
    paths commit series frames, so WITHOUT this the rating band never rendered — the 'no heatmap rating colour'
    report). False for raw-height / coarse frames (honest swell)."""
    try:
        d = getattr(grid, "diagnostics", None) or {}
        return bool((d.get("surf_transform") or {}).get("value_kind") == "surf_rating")
    except Exception:
        return False


def _frame_provenance(product) -> dict:
    """Run/upstream identity for a series frame (2026-08-09, Report 11.0 R11-04).

    Series frames used to strip run_time/upstream_provider/source_dataset/estimate_basis — the
    per-hour /grid lane serves all four, so this was a serialization gap, not missing data. Two
    consequences it caused: (1) adjacent scrubber hours could mix MODEL RUNS with no disclosure
    (each hour resolves independently against a manifest that legitimately holds two run
    generations mid-cycle); (2) the frontend's model→dataset guess — FALSIFIED for EURO, measured
    2026-08-03 — stayed the active provenance path for every series-committed frame, because
    frameToMarineData prefers `frame.upstream_provider` and it was never present. Additive
    fields only; None where the resolved product carries none. run_time remains the INGEST
    wall-clock (true model-cycle identity is a separate, Phase-3 item)."""
    rt = getattr(product, "run_time", None)
    return {
        "run_time": rt.strftime("%Y-%m-%dT%H:%M:%SZ") if hasattr(rt, "strftime") else rt,
        "upstream_provider": getattr(product, "upstream_provider", None),
        "source_dataset": getattr(product, "source_dataset", None),
        "estimate_basis": getattr(product, "estimate_basis", None),
    }


# ── BUILD-TIME BOUND (2026-08-10, the Render OOM root) ────────────────────────────────────────
# MEASURED on the live box before this existed: ONE global-bbox 48h series returned 6.67 MB on the
# wire and cost +170.3 MB RESIDENT, which 150 s of total idle did not give back — RSS is a
# monotonic high-water mark here. The serve box idles at ~1.65-1.7 GB of a 2,048 MB cgroup cap
# (~350 MB headroom) and the client fires THREE series pages per settle: 3 x 170 > 350 => OOM.
# Seven oomKilled events in the 15 h before this landed.
#
# WHY THE EXISTING BUDGET DID NOT STOP IT: apply_vector_budget runs on the ASSEMBLED response
# (build_grid_series, below) while asyncio.gather holds EVERY hour's full product alive at once —
# CONCURRENCY bounds resolution, never RETENTION. The measured request materialised ~390,000
# GridVector models (26 frames x ~15,023) and then discarded 8 in 9. That is a TRANSFER budget:
# bounding at the END cannot lower a peak that is reached BEFORE the end.
#
# So decimate each hour AS IT LANDS, using the stride the end-stage bound would have picked anyway
# (stride_for — one quantity, one expression, pinned equal in test_series_build_time_bound.py).
# Peak retention drops from N full grids to CONCURRENCY full grids + N decimated ones.
# ★ SCOPE, stated rather than implied: this covers the GENERIC PER-HOUR LOOP only. The EURO and
# Open-Meteo fast paths return before it and are unchanged — they keep the end-stage bound alone.
def _series_build_stride(product, hour_count: int) -> int:
    """Stride for the whole series, chosen from the FIRST resolved frame's geometry.

    The first hour is already built serially (it warms the regional tile), so its grid is the
    cheapest honest sample of what the remaining hours look like. Never raises: a series whose
    geometry cannot be read is served unbounded, exactly as it was before this existed.

    ⚠️ ASYMMETRY, STATED SO IT IS NOT LATER READ AS A BUG: this counts the hours REQUESTED, while
    the end-stage bound counts the frames that SURVIVED the deadline. When hours time out the
    build therefore picks a slightly coarser stride than the end stage would have (measured live:
    48 requested, 26 survived -> stride 4 here vs 3 there). That direction is the only safe one —
    a memory bound has to be chosen before the outcome is known, and assuming fewer frames than
    arrive is how you blow the budget. For the SAME frame count the two agree exactly, and
    test_series_build_time_bound.py pins that.
    """
    try:
        g = getattr(product, "grid", None)
        if g is None or not getattr(g, "vectors", None):
            return 1
        return stride_for(g.cols, g.rows, max(1, hour_count))
    except Exception:
        logger.exception("[series-build-bound] stride selection failed; building unbounded")
        return 1


def _load_stride_of(grid) -> int:
    """The stride the RESOLVER already applied to this grid, or 1 if it applied none.

    Read from `grid.diagnostics['load_stride']`, stamped by `store._stride_raw_grid_dicts`. Never
    raises and never guesses: an unstamped grid is treated as unstrided, which is the safe
    direction — the worst case is the pre-2026-08-10 behaviour of striding it here instead.
    """
    try:
        d = getattr(grid, "diagnostics", None)
        v = int(d.get("load_stride")) if isinstance(d, dict) else 1
        return v if v > 1 else 1
    except (TypeError, ValueError, AttributeError):
        return 1


def _resolver_takes_series_stride(resolve_grid) -> bool:
    """True when the injected resolver accepts `series_stride`.

    The series lane is handed its resolver by the caller (`build_grid_series(get_grid, ...)`), and
    the test suite injects plain coroutines with the OLD signature. Probing instead of assuming is
    what keeps this additive: an unknown resolver is called exactly as it was before.
    ⚠️ `inspect.signature` is not free at 48 hours x N requests, so the answer is memoised per
    function object.
    """
    try:
        cached = getattr(resolve_grid, "_takes_series_stride", None)
        if cached is not None:
            return cached
        import inspect
        params = inspect.signature(resolve_grid).parameters
        ok = "series_stride" in params or any(
            p.kind is inspect.Parameter.VAR_KEYWORD for p in params.values())
        try:
            resolve_grid._takes_series_stride = ok      # memoise on the function object
        except (AttributeError, TypeError):
            pass                                        # builtins / bound methods: probe each time
        return ok
    except (TypeError, ValueError):
        return False       # unintrospectable callable -> call it the old way


def _apply_build_stride(product, stride: int) -> bool:
    """Decimate one resolved product's grid before the series takes a reference to it.

    ⚠️ REBINDS grid.vectors — never mutates it. ProductStore.load_product hands out a SHALLOW
    model_copy, so that list object is the one in _product_cache; an in-place stride would
    decimate the CACHED product and every later reader of it. See decimate_vectors.
    """
    if stride <= 1 or product is None:
        return False
    try:
        g = getattr(product, "grid", None)
        if g is None or not getattr(g, "vectors", None):
            return False
        out = decimate_vectors(g.vectors, g.cols, g.rows, stride)
        if out is None:
            return False
        g.vectors, g.cols, g.rows = out
        return True
    except Exception:
        logger.exception("[series-build-bound] frame decimation failed; serving that frame whole")
        return False


# A single hour must never hang the whole series. Models with pre-built regional/global
# products (GFS/ICON via manifest) resolve in ms; models that fall to the slow dynamic
# path (EURO/Copernicus) can stall — so cap each hour and the whole build, and return
# whatever frames completed. The client uses the partial series and falls back to the
# per-hour flow for missing hours.
PER_HOUR_TIMEOUT = 10.0
# PROXY-WINDOW ALIGNMENT (§0f(3), 2026-07-14): production serves /api/* through Netlify's CDN
# proxy, which cuts the response at ~26s (NETLIFY_PROXY_WINDOW_S below) — a build that runs past
# it is a TOTAL loss (the client sees "Fetch failed" and caches zero frames) even though partial
# frames were ready. The old 35s deadline sat BEYOND the window, guaranteeing that loss whenever
# a heavy page (measured: EURO surf 48-frame = 23.1s cold) ran long. The deadline must sit UNDER
# the window with headroom for in-flight per-hour builds (~1s each measured) + transfer, so the
# worst case degrades to a PARTIAL page (client per-hour fallback covers the rest) instead of
# nothing. The frontend's smaller heavy-class pages (16 frames) keep typical builds ~8s so this
# deadline rarely binds — it is the backstop for contended/cold days.
NETLIFY_PROXY_WINDOW_S = 26.0
from services.weather_pipeline.config_env import env_float
OVERALL_DEADLINE = env_float("GRID_SERIES_DEADLINE_S", 20.0, lo=1.0)
# COLD-START budget (2026-07-06, chip task_e618f9ff): during the post-deploy L2 restore, product
# loads block on Supabase downloads and the 10s cap expired EVERY hour — the first mid-tier series
# after a restart returned frame_count:0 and the client treated it as no-coverage until the next
# gesture. While the restore is in flight each hour gets this budget instead. Must stay under
# OVERALL_DEADLINE (proxy-window alignment above): the serial first-hour build gets this budget in
# full, so a larger value would push the whole response past the proxy cut during every restore.
PER_HOUR_TIMEOUT_COLD = 16.0


def _restore_in_progress() -> bool:
    try:
        from services.weather_pipeline.store import ProductStore
        return bool(getattr(ProductStore, "_restore_in_progress", False))
    except Exception:
        return False


def _per_hour_timeout() -> float:
    return PER_HOUR_TIMEOUT_COLD if _restore_in_progress() else PER_HOUR_TIMEOUT
# EURO/Copernicus fast path budget. Kept under the client's 45s fetch timeout so the
# backend always answers first. The Copernicus full-range fetch is cached (10 min), so
# only the FIRST EURO series load pays this; later ones are instant.
EURO_SERIES_TIMEOUT = 40.0
EURO_NATIVE_HOURS = 240  # EURO marine native horizon; 241..336h are stored ESTIMATED products
# GFS/ICON marine full-range fast path budget (kept under the client's 45s fetch timeout).
OPENMETEO_SERIES_TIMEOUT = 30.0


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
    # Shield the full-range fetch from cancellation. If THIS request's outer budget
    # (EURO_SERIES_TIMEOUT) expires and cancels us, a bare `await` would also cancel the
    # Copernicus download — so it never finishes, never populates the provider's 10-min cache,
    # and the NEXT cold load re-pays the full latency and times out again (the >60s hang the
    # user sees as EURO never serving native data, falling back to the estimate every time).
    # With shield the download keeps running in the background and caches, so the next series
    # request resolves from cache and EURO serves its native Copernicus grid (incl. real swell
    # partitions). Restored from 4bbe81c3 — it was dropped as collateral in the 06-23 00:56 batch
    # revert (the actual breaker was the coordinator-parity change, re-applied corrected as f0627bf8).
    raw = await asyncio.shield(cop.fetch_grid(
        layer=layer, bbox=bbox_dict, resolution=resolution,
        forecast_days=forecast_days, precomputed_coords=(lats, lons),
        valid_time=None,  # FULL range in ONE fetch — the entire point of this path
    ))
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
            "rating_mode": _frame_rating_mode(g),
            # §0c: this fast path normalizes each hour directly from one fetch — the frame IS
            # the exact ask, so honesty fields report identity (uniform schema with the
            # resolve_grid-backed path below).
            "served_valid_time": t_actual.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "frame_offset_hours": 0.0,
            "frame_substituted": False,
            **_frame_provenance(normalized),
        })

    frames.sort(key=lambda f: f["hour_offset"])
    return {
        "model": "EURO", "domain": "marine", "layer": layer,
        "base_time": base.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "bounds": shared_bounds, "cols": shared_cols, "rows": shared_rows,
        "frame_count": len(frames), "frames": frames,
    }


async def _build_openmeteo_marine_series(viewport_service, model: str, layer: str, bbox: str, hour_list, base):
    """GFS/ICON marine fast path — the SCRUB analog of the regional-tile warm (mirrors _build_euro_marine_series).

    WHY: the generic per-hour loop calls resolve_grid, whose Step-3.7 serves the instant GLOBAL coarse preview
    for a cold viewport, so a zoomed-in scrub stays coarse-clamped across ALL hours — and enclosed seas are
    land-masked at the 10° coarse resolution (the Gulf-of-Mexico "no-data square" while scrubbing GFS waves).
    Instead, fetch the FULL forecast range ONCE from Open-Meteo for the viewport bbox and normalize EVERY
    requested hour from that single response, so the whole scrub renders the REGIONAL 0.25° grid (the Gulf
    fully resolved). One fetch per series page (provider-cached 5 min), reusing the SAME normalizer the generic
    dynamic path uses. Additive + GFS/ICON-marine-only + fall-through: on ANY problem returns None so
    build_grid_series uses the generic per-hour loop unchanged. Gated by GFS_ICON_SERIES_FASTPATH (default off)
    because it trades the manifest-coarse instant render for a live regional fetch (latency + open-meteo load)."""
    from services.weather_pipeline.providers.open_meteo_provider import OpenMeteoProvider
    from services.weather_pipeline.route_helpers import parse_bbox, generate_bbox_coords
    from services.weather_pipeline.normalizer import WeatherNormalizer

    w, s, e, n = parse_bbox(bbox)
    bbox_dict = {"west": w, "south": s, "east": e, "north": n}

    # Adaptive resolution + 500-point cap, mirroring the dynamic builder so the grid matches /grid's.
    resolution = 0.25
    steps = [0.25, 0.5, 1.0, 2.0, 2.5, 5.0, 10.0, 15.0, 20.0, 30.0, 40.0]
    lats, lons = generate_bbox_coords(w, s, e, n, resolution)
    while len(lats) > 500 and resolution != steps[-1]:
        resolution = steps[min(len(steps) - 1, steps.index(resolution) + 1)]
        lats, lons = generate_bbox_coords(w, s, e, n, resolution)
    if not lats:
        return None

    max_h = max(hour_list) if hour_list else 72
    forecast_days = min(16, max(3, (max_h // 24) + 2))

    provider = OpenMeteoProvider()
    # Shield the fetch (like EURO) so a cancelled request still warms the provider's 5-min cache for next time.
    raw = await asyncio.shield(provider.fetch_grid(
        model=model, domain="marine", layer=layer, bbox=bbox_dict,
        resolution=resolution, forecast_days=forecast_days, precomputed_coords=(lats, lons),
    ))
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
            model=model, provider="open-meteo", domain="marine", layer=layer,
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
            "provider": getattr(normalized, "provider", "open-meteo"),
            "is_estimated": getattr(normalized, "is_estimated", False),
            "rating_mode": _frame_rating_mode(g),
            # §0c: find_closest_time_index can snap to a NEIGHBORING available time — this path
            # can genuinely substitute, so compute the real offset (ask = base+h, served =
            # t_actual) rather than reporting identity.
            "served_valid_time": t_actual.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "frame_offset_hours": round((t_actual - target_dt).total_seconds() / 3600.0, 2),
            "frame_substituted": abs((t_actual - target_dt).total_seconds()) > 1800,
            **_frame_provenance(normalized),
        })

    frames.sort(key=lambda f: f["hour_offset"])
    return {
        "model": model, "domain": "marine", "layer": layer,
        "base_time": base.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "bounds": shared_bounds, "cols": shared_cols, "rows": shared_rows,
        "frame_count": len(frames), "frames": frames,
    }


async def build_grid_series(resolve_grid, viewport_service, model: str, domain: str, layer: str,
                            bbox: str, hours: str, request=None, surf: bool = False) -> dict:
    """Public entry point: build the series, then BOUND it (audit v7 §3).

    A thin wrapper, deliberately. This module has THREE assembly points -- the EURO fast path, the
    Open-Meteo fast path, and the generic per-hour loop -- and a budget applied at one of them is
    the "guard ran nowhere" class this codebase has now hit seven times. Every path returns through
    here, so the invariant lives here and cannot be routed around by a future fourth path.
    """
    resp = await _build_grid_series_impl(
        resolve_grid, viewport_service, model, domain, layer, bbox, hours,
        request=request, surf=surf,
    )
    # RUN CENSUS (2026-08-09, R11-04): each hour resolves independently, so ONE response can mix
    # model runs mid-ingest (~1-2.75 h window, 6x/day) — physically discontinuous adjacent frames.
    # Frames now carry run_time; the census makes a mixed page detectable at a glance (client-side
    # and in any dump) without walking every frame. Additive; absent when no frame carries a run.
    try:
        runs = sorted({f["run_time"] for f in resp.get("frames", []) if f.get("run_time")})
        if runs:
            resp["run_census"] = {"distinct_runs": len(runs), "min_run_time": runs[0],
                                  "max_run_time": runs[-1], "mixed_runs": len(runs) > 1}
    except Exception:
        logger.exception("[series-run-census] census failed; serving without it")
    try:
        from services.weather_pipeline.series_vector_budget import apply_vector_budget
        return apply_vector_budget(resp)
    except Exception:
        logger.exception("[series-budget] bounding failed; serving the unbounded response")
        return resp


async def _build_grid_series_impl(resolve_grid, viewport_service, model: str, domain: str, layer: str, bbox: str, hours: str, request=None, surf: bool = False) -> dict:
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
    # EURO grid_series ROOT-CAUSE FIX (2026-07-09, live-measured): the live-Copernicus fast path
    # (_build_euro_marine_series) hangs to EURO_SERIES_TIMEOUT (40s) then returns EMPTY — the measured
    # EURO scrub-lag root (GFS series ~2s, EURO single-hour /grid ~0.8s, but EURO series 40s→empty). Its
    # premise ("each EURO hour is a slow ±3h serialized CMEMS download") is STALE since the EURO-marine
    # L2 pre-ingest: resolve_grid now serves the stored EURO product in ~0.5-1s/hour at EVERY hour
    # 0..336h (verified live). So by DEFAULT skip the fast path and route EURO through the SAME generic
    # per-hour loop GFS/ICON use — it resolves in ~2-5s, degrades gracefully (per-hour timeout +
    # OVERALL_DEADLINE bound any slow hour instead of sinking the whole series to empty), AND makes the
    # scrub series consistent with the /grid heatmap (both read L2). Kill: EURO_SERIES_LIVE_COPERNICUS=1.
    _euro_live_cop = os.environ.get("EURO_SERIES_LIVE_COPERNICUS") == "1"
    if (_euro_live_cop and viewport_service is not None and model.upper() == "EURO"
            and domain.lower() == "marine" and not surf and not await _client_gone()):
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
                    # Fast path missed (cold cache / slow Copernicus). Do NOT let the generic
                    # per-hour loop re-grind the NATIVE EURO hours — each is the same slow ±3h
                    # serialized CMEMS download the fast path just timed out on, and stacking
                    # OVERALL_DEADLINE on top of EURO_SERIES_TIMEOUT is the ~75s hang. Build only the
                    # cheap STORED estimated hours; native hours are omitted this round (the shielded
                    # fetch above is warming the 10-min cache), and the client falls back to its
                    # per-hour flow for them meanwhile. Next request resolves native from cache.
                    loop_hours = estimated_hours
                    logger.warning("[grid_series] EURO fast path returned no frames; serving estimated-only, native hours warming")
            except BaseException as e:
                loop_hours = estimated_hours
                logger.warning(f"[grid_series] EURO fast path failed ({type(e).__name__}: {e}); serving estimated-only, native hours warming")
        # native_hours empty (page entirely >240h): loop_hours stays = hour_list (all estimated)
        # and the per-hour loop resolves the stored estimated EURO products directly.

    # GFS/ICON marine fast path (flag-gated GFS_ICON_SERIES_FASTPATH, default OFF): fetch the FULL forecast
    # range ONCE from Open-Meteo for the viewport + slice EVERY hour, so a zoomed-in scrub renders the REGIONAL
    # 0.25° grid for all hours instead of the global-coarse frame (which masks enclosed seas → the Gulf-of-Mexico
    # no-data square during scrub). Additive + fall-through: on any failure the generic per-hour loop below runs
    # unchanged. Default off because it trades the instant manifest-coarse render for a live regional fetch.
    #
    # SWR budget (audit #24, 2026-07-11): Render logs showed the await hitting the 30s ceiling on 62% of
    # attempts (+21% upstream 400s, 17% empty) — every one a 30s-held request on the 1-CPU box before the
    # instant stored fallback. The inner fetch is SHIELDED, so on timeout it keeps running and warms the
    # provider's 5-min cache; the client's coarse-reval machinery already re-fetches spaced retries. So the
    # long await bought nothing: await only a short first-paint budget (warm-cache scrubs still return
    # regional frames instantly), fall back fast otherwise, and let the reval pick up the warmed cache.
    # Revert lever: GFS_ICON_SERIES_FASTPATH_WAIT_SEC=30.
    if (os.environ.get("GFS_ICON_SERIES_FASTPATH") == "1"
            and viewport_service is not None
            and model.upper() in ("GFS", "ICON")
            and domain.lower() == "marine"
            and not surf
            and not await _client_gone()):
        try:
            fastpath_wait = float(os.environ.get("GFS_ICON_SERIES_FASTPATH_WAIT_SEC", "2.5"))
            fp = await asyncio.wait_for(
                _build_openmeteo_marine_series(viewport_service, model, layer, bbox, hour_list, base),
                timeout=min(fastpath_wait, OPENMETEO_SERIES_TIMEOUT),
            )
            if fp and fp.get("frame_count", 0) > 0:
                return fp
            logger.warning(f"[grid_series] {model} marine fast path returned no frames; using the per-hour loop.")
        except BaseException as e:
            logger.warning(f"[grid_series] {model} marine fast path failed ({type(e).__name__}: {e}); using the per-hour loop.")

    # Bound concurrency so we don't spike CPU/memory on the 1-CPU box re-normalizing many
    # hours at once (each hour after the first is a cheap re-slice of the cached fetch).
    sem = asyncio.Semaphore(CONCURRENCY)
    deadline = time.monotonic() + OVERALL_DEADLINE
    # Build-time bound state (see _series_build_stride above). `stride` stays 1 until the first
    # hour resolves and reveals the geometry; `hours` records which frames were ACTUALLY rewritten
    # so the response stamp counts them instead of assuming; `before` accumulates what the series
    # would have retained, so the saving is measured rather than claimed.
    bound = {"stride": 1, "hours": set(), "before": 0}

    async def _build_one(h: int, warm_regional: bool = False):
        if time.monotonic() > deadline or await _client_gone():
            return (h, None)
        target_dt = base + timedelta(hours=h)
        vt_str = target_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
        try:
            async with sem:
                if time.monotonic() > deadline:
                    return (h, None)
                # background_tasks selection — the difference between grid_series staying coarse forever vs.
                # sharpening to the regional tile (the zoom-in clamp root cause):
                #   * A zoomed-in COLD bbox gets resolve_grid's instant GLOBAL coarse preview (Step 3.7), which
                #     schedules an SWR revalidation that BUILDS + CACHES the precise regional viewport tile.
                #   * That schedule runs via asyncio.create_task ONLY when background_tasks is falsy; a (throwaway)
                #     BackgroundTasks() just .add_task()s to an object that never executes outside a request — so
                #     grid_series served the global preview FOREVER and the heatmap stayed coarse-clamped.
                # Pass None for the FIRST hour so the regional revalidation actually fires (warming the tile once
                # for the bbox); throwaway for the rest so we don't fan out N background fetches on the 1-CPU box.
                bg = None if warm_regional else BackgroundTasks()
                # Per-hour timeout so a slow/stalled model (EURO dynamic) can't hang the whole
                # series; cold budget while the L2 restore is in flight (see PER_HOUR_TIMEOUT_COLD).
                _t = _per_hour_timeout()
                # ── LOAD-TIME BOUND (2026-08-10) ──────────────────────────────────────────────
                # By the time hour 0 has resolved, `bound["stride"]` is known — and every
                # remaining hour is going to be strided by exactly that number a few lines below.
                # Telling the resolver up front means the discarded cells are never built into
                # GridVector models at all. `_apply_build_stride` still runs on whatever comes
                # back: a product that arrived pre-strided is already at the target geometry and
                # the second pass is a no-op, so the two paths cannot disagree about cell
                # selection (both go through `decimate_vectors`).
                # ⚠️ Hour 0 CANNOT use this — its geometry is what CHOOSES the stride. It is the
                # one full grid the series still pays for, by construction.
                # Only forwarded when the injected resolver accepts it, so a test double or any
                # other caller with the old signature keeps working unchanged.
                _kw = {}
                if bound["stride"] > 1 and _resolver_takes_series_stride(resolve_grid):
                    _kw["series_stride"] = bound["stride"]
                product = await asyncio.wait_for(
                    resolve_grid(
                        model=model, domain=domain, layer=layer,
                        valid_time=vt_str, bbox=bbox, surf=surf, background_tasks=bg, **_kw
                    ),
                    timeout=_t,
                )
            # Bound this hour BEFORE the gather can collect it — the whole point (see above).
            _g = getattr(product, "grid", None) if product is not None else None
            if _g is not None and getattr(_g, "vectors", None):
                bound["before"] += len(_g.vectors)
                # ⚠️ A grid that arrived ALREADY strided must not be strided twice. The resolver
                # stamps `diagnostics.load_stride` when it honoured the hint; keying off that
                # rather than off geometry is deliberate, because cols/rows cannot distinguish
                # "already decimated by 4" from "natively this small". Getting this wrong is not
                # subtle — it served stride^2 (966 cells -> 72) and the wiring test caught it.
                # ⚠️ `bound["stride"] > 1` is load-bearing, not defensive. Without it an UNBOUNDED
                # series (stride 1, an unstamped grid -> _load_stride_of 1) takes the first branch
                # and stamps `decimated_stride: 1` on every frame of a viewport that was never
                # decimated at all — a HIT advertising itself as bounded.
                # `test_a_small_viewport_is_never_decimated` caught exactly that.
                if bound["stride"] > 1 and _load_stride_of(_g) == bound["stride"]:
                    bound["hours"].add(h)          # already at target geometry; stamp, don't redo
                elif _apply_build_stride(product, bound["stride"]):
                    bound["hours"].add(h)
            return (h, product)
        except asyncio.TimeoutError:
            logger.warning(f"[grid_series] hour +{h}h timed out after {_per_hour_timeout()}s")
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
            # First hour warms the regional viewport tile (background_tasks=None → the SWR revalidation fires)
            # so the NEXT series request for this bbox serves the precise regional grid instead of global-coarse.
            results = [await _build_one(loop_hours[0], warm_regional=True)]
            # The first hour is home: its geometry picks the stride for every remaining hour — and
            # for itself, since it was built before that stride could be known.
            bound["stride"] = _series_build_stride(results[0][1], len(loop_hours))
            if _apply_build_stride(results[0][1], bound["stride"]):
                bound["hours"].add(results[0][0])
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
            "rating_mode": _frame_rating_mode(g),
            # Present only on frames this build actually strided, so a client can tell a
            # decimated frame from a natively-small one (they are otherwise identical).
            **({"decimated_stride": bound["stride"]} if h in bound["hours"] else {}),
            # §0c SERVING HONESTY: valid_time above echoes the per-hour ask (resolve_grid's
            # contract); these carry the frame actually served — stamped by stamp_frame_honesty
            # inside the resolve_grid call this frame came from.
            "served_valid_time": getattr(product, "served_valid_time", None),
            "frame_offset_hours": getattr(product, "frame_offset_hours", 0.0),
            "frame_substituted": getattr(product, "frame_substituted", False),
            **_frame_provenance(product),
        })

    # Merge the EURO native fast-path frames (<=240h) with the per-hour-built estimated frames
    # (>240h) so a boundary-spanning page returns its full hour range.
    if prebuilt_frames:
        have = {f["hour_offset"] for f in frames}
        for pf in prebuilt_frames:
            if pf.get("hour_offset") not in have:
                frames.append(pf)
                # Fast-path frames are not build-bounded; count them so vectors_before_bound
                # describes the WHOLE response rather than only the hours this loop built.
                bound["before"] += len(pf.get("vectors") or [])
                if shared_bounds is None and pf.get("bounds"):
                    shared_bounds, shared_cols, shared_rows = pf["bounds"], pf.get("cols", 0), pf.get("rows", 0)

    frames.sort(key=lambda f: f["hour_offset"])
    resp = {
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
    # COLD-START marker (chip task_e618f9ff): an EMPTY series built while the L2 restore is in
    # flight is a warming artifact, not "no coverage" — the client retries with backoff instead
    # of abandoning the viewport to the per-hour fallback until the next gesture.
    # Stamp what the BUILD bounded. The end-stage apply_vector_budget still runs after this
    # (build_grid_series) and will find the response already under budget, so it no-ops — the
    # stamp has to come from here or the diagnostic would silently vanish for bounded pages.
    if bound["stride"] > 1:
        stamp_build_time_bound(resp, bound["stride"], len(bound["hours"]), bound["before"])
    if not frames and _restore_in_progress():
        resp["warming"] = True
    return resp
