"""grid_series_viewport.py — the series frame fields and the two single-fetch viewport fast paths.

Moved VERBATIM from `grid_series_helper.py` on 2026-09-29 (that file sat at 799 of the 800-line cap). The EURO
(Copernicus) and GFS/ICON (Open-Meteo) fast paths fetch a viewport's full forecast range ONCE and normalise every
requested hour from it; `_frame_rating_mode` / `_frame_provenance` are the per-frame fields both they and the
resolve_grid-backed path in `grid_series_helper` stamp. `grid_series_helper` imports every name back, so its
callers — and the tests that patch `grid_series_helper._build_euro_marine_series` and friends — see no change:
the series builder looks these names up in its own module at call time.
"""
from datetime import datetime, timedelta

from services.weather_pipeline.provider_fetches import await_provider_fetch


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
    from services.weather_pipeline.cycle_provenance import time_provenance
    cycle = time_provenance(product)
    for key in ("model_run_time", "ingested_at"):
        value = cycle[key]
        if hasattr(value, "isoformat"):
            cycle[key] = value.isoformat()
    # Preserve the resolver's degraded-answer receipt without aliasing cached warnings.
    fallback = {}
    warnings = getattr(product, "warnings", None)
    if warnings:
        fallback["warnings"] = list(warnings)
    reason = getattr(product, "fallbackReason", None)
    if reason is not None:
        fallback["fallbackReason"] = reason
    if getattr(product, "partial_coverage", False):
        fallback["partial_coverage"] = True
    return {
        **fallback,
        **cycle,
        "run_time": rt.strftime("%Y-%m-%dT%H:%M:%SZ") if hasattr(rt, "strftime") else rt,
        "upstream_provider": getattr(product, "upstream_provider", None),
        "source_dataset": getattr(product, "source_dataset", None),
        "estimate_basis": getattr(product, "estimate_basis", None),
    }


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
    from services.weather_pipeline.route_helpers import parse_bbox
    from services.weather_pipeline.series_coordinates import generate_series_coords
    from services.weather_pipeline.normalizer import WeatherNormalizer

    w, s, e, n = parse_bbox(bbox)
    bbox_dict = {"west": w, "south": s, "east": e, "north": n}

    # Preserve the adaptive grid while avoiding allocation of rejected candidates.
    resolution, lats, lons = generate_series_coords(w, s, e, n)
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
    raw = await await_provider_fetch(cop.fetch_grid(
        layer=layer, bbox=bbox_dict, resolution=resolution,
        forecast_days=forecast_days, precomputed_coords=(lats, lons),
        valid_time=None,  # FULL range in ONE fetch — the entire point of this path
    ), provider="Copernicus/EURO")
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
    from services.weather_pipeline.route_helpers import parse_bbox
    from services.weather_pipeline.series_coordinates import generate_series_coords
    from services.weather_pipeline.normalizer import WeatherNormalizer

    w, s, e, n = parse_bbox(bbox)
    bbox_dict = {"west": w, "south": s, "east": e, "north": n}

    # Preserve the adaptive grid while avoiding allocation of rejected candidates.
    resolution, lats, lons = generate_series_coords(w, s, e, n)
    if not lats:
        return None

    max_h = max(hour_list) if hour_list else 72
    forecast_days = min(16, max(3, (max_h // 24) + 2))

    provider = OpenMeteoProvider()
    # Shield the fetch (like EURO) so a cancelled request still warms the provider's 5-min cache for next time.
    raw = await await_provider_fetch(provider.fetch_grid(
        model=model, domain="marine", layer=layer, bbox=bbox_dict,
        resolution=resolution, forecast_days=forecast_days, precomputed_coords=(lats, lons),
    ), provider="Open-Meteo")
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
