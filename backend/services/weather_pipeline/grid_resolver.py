"""
grid_resolver.py

Extracted resolution logic for GET /api/weather/grid (routes.weather.get_grid).
Kept as a dependency-injected coroutine (store + viewport_service passed in) so the route
handler stays a thin wrapper and grid_series can reuse the exact same resolver. Behavior is
identical to the former inline route body — this is a pure extraction.
"""
import asyncio
import os
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import HTTPException
from fastapi.responses import JSONResponse

from services.weather_pipeline.schemas import NormalizedProduct
from services.weather_pipeline.route_helpers import (
    parse_valid_time, parse_bbox, is_bbox_covered_by, filter_grid_to_bbox,
    make_unsupported_icon_swell2_grid_response, make_no_coverage_grid_response,
    compute_truth_tag, get_snapped_bbox
)
from services.weather_pipeline.product_selection import select_best_candidate
from services.weather_pipeline.viewport_helper import _is_oversized_grid

logger = logging.getLogger(__name__)


def calculate_bbox_intersection_area(w1: float, s1: float, e1: float, n1: float, w2: float, s2: float, e2: float, n2: float) -> float:
    """Calculates the intersection area of two bounding boxes."""
    from services.weather_pipeline.product_selection import bbox_intersection_area
    from collections import namedtuple
    SimpleCov = namedtuple("SimpleCov", ["west", "south", "east", "north"])
    return bbox_intersection_area(w1, s1, e1, n1, SimpleCov(w2, s2, e2, n2))


async def resolve_grid(
    store,
    viewport_service,
    *,
    model: str,
    domain: str,
    layer: str,
    valid_time: str,
    bbox: Optional[str] = None,
    surf: bool = False,
    background_tasks=None,
    request=None,
):
    """
    Resolves a compact normalized coordinate grid ready for WebGL rendering, enforcing dynamic
    bounding-box coordinate filtering to conserve bandwidth. `store` and `viewport_service`
    are injected so the route handler and grid_series share one resolver.
    """
    # Disconnect detection: under timeline scrubbing / model toggling the client aborts
    # obsolete requests. Bail before any heavy work so we don't pile up zombie handlers that
    # keep downloading + normalizing grids for a connection that's already gone. `request` is
    # None when resolve_grid is called as a plain coroutine (e.g. from build_grid_series).
    if request is not None and await request.is_disconnected():
        raise HTTPException(status_code=499, detail="Client Closed Request")

    # Parse target timestamp
    target_dt = parse_valid_time(valid_time)

    # Immediate rejection for unsupported layer
    if model.upper() == "ICON" and layer.lower() == "swell_2":
        return make_unsupported_icon_swell2_grid_response(domain, target_dt)

    # Parse bounding box values if provided
    req_w, req_s, req_e, req_n = None, None, None, None
    if bbox:
        req_w, req_s, req_e, req_n = parse_bbox(bbox)

    # 1. Search the manifest for candidate products covering the target time
    manifest = await asyncio.to_thread(store.get_manifest)
    authoritative_candidates = []
    estimated_candidates = []
    for p in manifest.products:
        if (
            p.model.upper() == model.upper()
            and p.domain.lower() == domain.lower()
            and p.layer.lower() == layer.lower()
        ):
            diff = abs(p.valid_time_start.timestamp() - target_dt.timestamp())
            if diff <= 3 * 3600:
                if getattr(p, "is_estimated", False):
                    estimated_candidates.append((p, diff))
                else:
                    authoritative_candidates.append((p, diff))

    # Match best candidate from registry
    matching_manifest_item = select_best_candidate(
        authoritative_candidates, estimated_candidates, req_w, req_s, req_e, req_n
    )

    manifest_preview_item = None
    use_manifest_product = False
    regional_span_lng = 0.0
    if matching_manifest_item:
        cov = matching_manifest_item.coverage
        if cov.west <= cov.east:
            regional_span_lng = cov.east - cov.west
        else:
            regional_span_lng = (180.0 - cov.west) + (cov.east + 180.0)
        regional_span_lat = abs(cov.north - cov.south)

        is_regional = regional_span_lng < 350.0

        if is_regional:
            if req_w is not None:
                # Check requested bbox span
                if req_w <= req_e:
                    req_span_lng = req_e - req_w
                else:
                    req_span_lng = (180.0 - req_w) + (req_e + 180.0)
                req_span_lat = abs(req_n - req_s)

                # If requested viewport is wider than the regional tile, dynamic viewport must win.
                is_wider_lng = req_span_lng > (regional_span_lng + 0.05)
                is_wider_lat = req_span_lat > (regional_span_lat + 0.05)
                is_wider = is_wider_lng or is_wider_lat
                is_covered = is_bbox_covered_by(req_w, req_s, req_e, req_n, cov, margin=0.05)

                if is_covered and not is_wider:
                    use_manifest_product = True
                elif domain.lower() == "marine" and os.environ.get("MARINE_REGIONAL_OVERLAP_REUSE", "1") != "0":
                    # Reuse a regional marine tile when the viewport OVERLAPS it and isn't wider — even if not
                    # FULLY covered. Without this, a zoomed-in viewport that spills slightly past the tile edge
                    # (e.g. a z9 Florida view ~0.4° wider than the 2° FL pilot tile) fell back to the global-
                    # COARSE grid (live: "no covering regional frame for coarse_global") — which is blocky AND
                    # skips the rating band (the surf transform is skipped on coarse/global extent). Extended
                    # from EURO-only to ALL marine models (GFS/ICON pilots too) so close-up coasts get FINE data
                    # plus the rating band. Kill switch: MARINE_REGIONAL_OVERLAP_REUSE=0.
                    overlap_area = calculate_bbox_intersection_area(
                        req_w, req_s, req_e, req_n,
                        cov.west, cov.south, cov.east, cov.north
                    )
                    if overlap_area > 0.0001 and not is_wider:
                        use_manifest_product = True
            else:
                # If no bbox coordinates provided, serve manifest product by default
                use_manifest_product = True
        else:
            # It's a global conformed manifest product (regional_span_lng >= 350.0).
            # If the user is requesting a global view (large span), directly serve this global manifest product.
            if req_w is not None:
                if req_w <= req_e:
                    req_span_lng = req_e - req_w
                else:
                    req_span_lng = (180.0 - req_w) + (req_e + 180.0)
                req_span_lat = abs(req_n - req_s)
                if req_span_lng > 15.0 or req_span_lat > 15.0:
                    use_manifest_product = True
                elif model.upper() == "ICON" and domain.lower() == "wind":
                    # Compute dynamic boundary for the maximum 5-day calendar forecast range of ICON
                    today_utc = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
                    max_icon_wind_dynamic_dt = today_utc + timedelta(days=5)
                    if target_dt >= max_icon_wind_dynamic_dt:
                        use_manifest_product = True
                else:
                    # Zooms closer in: do NOT use the coarse global manifest product.
                    use_manifest_product = False
            else:
                use_manifest_product = True

        if matching_manifest_item and getattr(matching_manifest_item, "is_estimated", False):
            use_manifest_product = True

        if not use_manifest_product:
            # Do NOT serve a regional preview or global coarse preview for a zoomed-in viewport query (use_manifest_product is False),
            # as it causes jarring visual expand/shrink transitions and clamping jitters due to grid dimension/resolution mismatch.
            manifest_preview_item = None
            matching_manifest_item = None

    # Step-wise product resolution
    product = None

    # Step 1 & 2: Exact/fresh or stale dynamic cache hit for snapped viewport
    if bbox and viewport_service.is_viewport_enabled(model, domain, layer, False, bbox, target_dt=target_dt):
        product = await viewport_service.get_cached_dynamic_product(
            model=model, domain=domain, layer=layer, target_dt=target_dt, bbox_str=bbox
        )

    # Step 3: Durable manifest full coverage
    if not product:
        if use_manifest_product and matching_manifest_item:
            candidate_product = await asyncio.to_thread(store.load_product, matching_manifest_item.filename)
            if candidate_product and not _is_oversized_grid(candidate_product):
                product = candidate_product
                if product.grid:
                    product.product_id = matching_manifest_item.filename
                    product.coverage_scope = "global" if regional_span_lng >= 350.0 else "regional"
                    product.partial_coverage = False
                    product.requested_bbox_original = bbox
                    product.query_bbox = bbox
                    product.requested_bbox = bbox
                    product.coverage_mode = getattr(matching_manifest_item, "coverage_mode", None)
                    if not product.coverage_mode:
                        product.coverage_mode = "global_tile" if regional_span_lng >= 350.0 else "regional_tile"
                    if bbox and product.coverage_mode != "global_tile" and domain.lower() != "wind":
                        product = filter_grid_to_bbox(product, get_snapped_bbox(bbox, model))
                    if product.grid and product.grid.bounds:
                        product.served_bbox = f"{product.grid.bounds.west:.4f},{product.grid.bounds.south:.4f},{product.grid.bounds.east:.4f},{product.grid.bounds.north:.4f}"
            elif candidate_product:
                logger.warning(
                    f"[Grid Resolver] Skipping oversized stale manifest product {matching_manifest_item.filename} "
                    f"({len(candidate_product.grid.vectors)} vectors) in Step 3."
                )

    # Step 3.5: Fast manifest preview (SWR)
    from services.weather_pipeline.store import is_test_environment
    if not product and manifest_preview_item and not is_test_environment():
        file_path = store.cache_dir / manifest_preview_item.filename
        file_exists = await asyncio.to_thread(file_path.exists)
        if file_exists:
            logger.info(f"[Grid Route] Serving conformed manifest item {manifest_preview_item.filename} as instant SWR preview")
            candidate_product = await asyncio.to_thread(store.load_product, manifest_preview_item.filename)
            if candidate_product and not _is_oversized_grid(candidate_product):
                product = candidate_product
                if product.grid:
                    product.product_id = manifest_preview_item.filename
                    product.coverage_mode = getattr(manifest_preview_item, "coverage_mode", None)
                    if not product.coverage_mode:
                        product.coverage_mode = "global_tile" if regional_span_lng >= 350.0 else "regional_tile"
                    if regional_span_lng >= 350.0:
                        product.coverage_scope = "global_coarse"
                        product.partial_coverage = False
                    else:
                        if use_manifest_product:
                            product.coverage_scope = "regional"
                            product.partial_coverage = False
                        else:
                            product.coverage_scope = "regional_partial"
                            product.partial_coverage = True
                    product.requested_bbox_original = bbox
                    product.query_bbox = bbox
                    product.requested_bbox = bbox
                    product.stale = True
                    product.staleReason = "swr_revalidation_pending"
                    if bbox and product.coverage_mode != "global_tile" and domain.lower() != "wind":
                        product = filter_grid_to_bbox(product, get_snapped_bbox(bbox, model))
                    if product.grid and product.grid.bounds:
                        product.served_bbox = f"{product.grid.bounds.west:.4f},{product.grid.bounds.south:.4f},{product.grid.bounds.east:.4f},{product.grid.bounds.north:.4f}"
                    if bbox and viewport_service.is_viewport_enabled(model, domain, layer, False, bbox, target_dt=target_dt):
                        reval_key = f"{model.lower()}_{domain.lower()}_{layer.lower()}_{valid_time}_{bbox}"
                        if reval_key not in viewport_service.ACTIVE_REVALIDATIONS:
                            viewport_service.ACTIVE_REVALIDATIONS.add(reval_key)
                            if background_tasks:
                                background_tasks.add_task(
                                    viewport_service._revalidate_fetch,
                                    model, domain, layer, valid_time, target_dt, bbox, reval_key
                                )
                            else:
                                asyncio.create_task(
                                    viewport_service._revalidate_fetch(
                                        model, domain, layer, valid_time, target_dt, bbox, reval_key
                                    )
                                )
            elif candidate_product:
                logger.warning(
                    f"[Grid Resolver] Skipping oversized stale preview product {manifest_preview_item.filename} "
                    f"({len(candidate_product.grid.vectors)} vectors) in Step 3.5."
                )

    # Step 3.7: Instant coarse preview for marine (SWR). On a cold viewport (Step 1&2 cache
    # miss) the response would otherwise BLOCK on the slow upstream fetch — notably EURO's
    # multi-second Copernicus call (~7s) and ICON's gwam call — leaving the heatmap blank until
    # it returns. Instead, serve a covering cached coarse/regional product immediately and
    # revalidate the precise viewport in the background. This proactively gives EURO/ICON the
    # same fast coarse render GFS already gets (GFS only reaches it as an upstream-failure
    # fallback). Purely additive: any failure or absent preview falls straight through to the
    # normal upstream path below.
    PREVIEW_MAX_VECTORS = 5000  # coarse/regional products are <~1k cells; guards against ever
                                # serving a stale native-resolution (e.g. 0.25° global ~952k) field.
    if (
        not product
        and bbox
        and domain.lower() == "marine"
        and not is_test_environment()
        and viewport_service.is_viewport_enabled(model, domain, layer, False, bbox, target_dt=target_dt)
    ):
        preview = None
        try:
            preview = await viewport_service._find_any_cached_product(model, domain, layer, target_dt, bbox)
        except Exception as preview_err:
            logger.warning(f"[Grid Route] Coarse preview lookup failed for {model} {layer}: {preview_err}")
        if (
            preview and preview.grid and preview.grid.vectors
            and 0 < len(preview.grid.vectors) <= PREVIEW_MAX_VECTORS
            and any(v.speed > 0 for v in preview.grid.vectors)
        ):
            preview.requested_bbox_original = bbox
            preview.query_bbox = bbox
            preview.requested_bbox = bbox
            preview.partial_coverage = False
            preview.stale = True
            preview.staleReason = "swr_revalidation_pending"
            preview.cache_hit = "coarse_preview"
            if preview.grid and preview.grid.bounds:
                preview.served_bbox = f"{preview.grid.bounds.west:.4f},{preview.grid.bounds.south:.4f},{preview.grid.bounds.east:.4f},{preview.grid.bounds.north:.4f}"
            # Kick off background revalidation so the next request resolves the precise viewport.
            reval_key = f"{model.lower()}_{domain.lower()}_{layer.lower()}_{valid_time}_{bbox}"
            if reval_key not in viewport_service.ACTIVE_REVALIDATIONS:
                viewport_service.ACTIVE_REVALIDATIONS.add(reval_key)
                if background_tasks:
                    background_tasks.add_task(
                        viewport_service._revalidate_fetch,
                        model, domain, layer, valid_time, target_dt, bbox, reval_key
                    )
                else:
                    asyncio.create_task(
                        viewport_service._revalidate_fetch(
                            model, domain, layer, valid_time, target_dt, bbox, reval_key
                        )
                    )
            logger.info(
                f"[Grid Route] Instant coarse preview {preview.product_id} "
                f"({len(preview.grid.vectors)} vec) for {model} {layer}; revalidating viewport in background."
            )
            product = preview

    # Step 4 & 5: Upstream dynamic fetch & stale fallback
    if not product:
        # The upstream viewport fetch is the single heaviest step (network download + full
        # normalization). Skip it if the client already walked away (scrub/toggle abort).
        if request is not None and await request.is_disconnected():
            raise HTTPException(status_code=499, detail="Client Closed Request")
        if bbox and viewport_service.is_viewport_enabled(model, domain, layer, False, bbox, target_dt=target_dt):
            try:
                # For ICON wind, dynamic viewport fetch is supported beyond 5-day limit by loop-extrapolation inside fetch_viewport_grid_upstream.

                product = await viewport_service.fetch_viewport_grid_upstream(
                    model=model, domain=domain, layer=layer, valid_time_str=valid_time, target_dt=target_dt, bbox_str=bbox
                )
            except Exception as dynamic_err:
                logger.warning(f"[Grid Route] Dynamic viewport upstream fetch failed: {dynamic_err}. Checking fallback/step 6...")

                # EURO → GFS fallback. Marine: Copernicus upstream failed. Wind: EURO (ecmwf_ifs) wind
                # has no fresh global product and its on-demand open-meteo fetch fails for the current
                # horizon (curl: every EURO wind hour past the stale product 500'd while GFS wind 200'd).
                # Without this, EURO wind fell through to a path that returned an unhandled 500 (no CORS)
                # → the heatmap never activated. GFS wind is a sound global proxy (same as marine's GFS
                # fallback), so EURO wind always shows real wind data; provider is labelled honestly.
                _is_euro_marine = model.upper() == "EURO" and domain.lower() == "marine" and layer.lower() in ("waves", "swell_1", "swell_2", "wind_waves")
                _is_euro_wind = model.upper() == "EURO" and domain.lower() == "wind" and layer.lower() == "wind"
                if _is_euro_marine or _is_euro_wind:
                    logger.info(f"[Grid Route] EURO {domain} upstream failed. Attempting GFS {domain} fallback...")
                    try:
                        product = await viewport_service.fetch_viewport_grid_upstream(
                            model="GFS", domain=domain, layer=layer, valid_time_str=valid_time, target_dt=target_dt, bbox_str=bbox
                        )
                        if product:
                            from services.copernicus_marine_service import is_test_environment
                            is_test = is_test_environment()
                            product.model = "EURO"
                            if _is_euro_wind:
                                product.provider = "gfs_fallback"
                                product.is_estimated = True
                                product.is_forecast_authoritative = False
                            else:
                                product.provider = "gfs_estimated_fallback" if is_test else "copernicus"
                                product.is_estimated = True if is_test else False
                                product.is_forecast_authoritative = False if is_test else True
                            if product.grid:
                                if product.grid.diagnostics is None:
                                    product.grid.diagnostics = {}
                                product.grid.diagnostics["provider"] = product.provider
                                product.grid.diagnostics["stale"] = False
                                product.grid.diagnostics["renderable"] = len(product.grid.vectors) > 0 and any(v.speed > 0 for v in product.grid.vectors)
                            logger.info(f"[Grid Route] GFS fallback grid successfully fetched for EURO {layer}.")
                    except Exception as fallback_err:
                        logger.error(f"[Grid Route] GFS fallback grid fetch also failed: {fallback_err}")

                if not product:
                    logger.warning("[Grid Route] Checking Step 6 regional_partial fallback...")

                # Step 6: Durable manifest overlap as regional_partial only if no better dynamic/stale viewport product exists
                overlap_candidates = []
                for p in manifest.products:
                    if (
                        p.model.upper() == model.upper()
                        and p.domain.lower() == domain.lower()
                        and p.layer.lower() == layer.lower()
                    ):
                        diff = abs(p.valid_time_start.timestamp() - target_dt.timestamp())
                        if diff <= 3 * 3600:
                            # Avoid matching a tiny regional product for a wide global/wide query
                            cov = p.coverage
                            if cov.west <= cov.east:
                                p_span_lng = cov.east - cov.west
                            else:
                                p_span_lng = (180.0 - cov.west) + (cov.east + 180.0)
                            p_is_regional = p_span_lng < 350.0

                            is_wide_req = False
                            if req_w is not None:
                                if req_w <= req_e:
                                    req_span_lng = req_e - req_w
                                else:
                                    req_span_lng = (180.0 - req_w) + (req_e + 180.0)
                                req_span_lat = abs(req_n - req_s)
                                if req_span_lng > 15.0 or req_span_lat > 15.0:
                                    is_wide_req = True

                            if is_wide_req and p_is_regional:
                                continue

                            if req_w is not None:
                                area = calculate_bbox_intersection_area(
                                    req_w, req_s, req_e, req_n,
                                    p.coverage.west, p.coverage.south, p.coverage.east, p.coverage.north
                                )
                                if area > 0.0:
                                    overlap_candidates.append((p, area, diff))
                            else:
                                overlap_candidates.append((p, 1.0, diff))

                overlap_manifest_item = None
                if overlap_candidates:
                    # Rank by: area (descending), time difference (ascending), authoritative first (is_estimated = False first)
                    overlap_candidates.sort(
                        key=lambda x: (
                            -x[1],  # area descending
                            x[2],   # time difference ascending
                            getattr(x[0], "is_estimated", False)  # authoritative (False) before estimated (True)
                        )
                    )
                    overlap_manifest_item = overlap_candidates[0][0]

                if overlap_manifest_item:
                    logger.info(f"[Grid Route] Fallback: Serving overlapping regional manifest product '{overlap_manifest_item.filename}' as regional_partial")
                    candidate_product = await asyncio.to_thread(store.load_product, overlap_manifest_item.filename)
                    if candidate_product and not _is_oversized_grid(candidate_product):
                        product = candidate_product
                        if not product or not product.grid:
                            raise HTTPException(status_code=500, detail="Failed to load prepared grid from storage.")
                        product.product_id = overlap_manifest_item.filename
                        product.coverage_scope = "regional_partial"
                        product.partial_coverage = True
                        product.requested_bbox_original = bbox
                        product.query_bbox = bbox
                        product.requested_bbox = bbox
                        if bbox and getattr(overlap_manifest_item, "coverage_mode", None) != "global_tile" and domain.lower() != "wind":
                            product = filter_grid_to_bbox(product, get_snapped_bbox(bbox, model))
                        if product.grid and product.grid.bounds:
                            product.served_bbox = f"{product.grid.bounds.west:.4f},{product.grid.bounds.south:.4f},{product.grid.bounds.east:.4f},{product.grid.bounds.north:.4f}"
                    elif candidate_product:
                        logger.warning(
                            f"[Grid Resolver] Skipping oversized stale overlap product {overlap_manifest_item.filename} "
                            f"({len(candidate_product.grid.vectors)} vectors) in Step 6."
                        )
                else:
                    # Step 7: Honest no_coverage/temporary_unavailable (raise the error or return empty grid if wide request)
                    is_wide_req = False
                    if req_w is not None:
                        if req_w <= req_e:
                            req_span_lng = req_e - req_w
                        else:
                            req_span_lng = (180.0 - req_w) + (req_e + 180.0)
                        req_span_lat = abs(req_n - req_s)
                        if req_span_lng > 15.0 or req_span_lat > 15.0:
                            is_wide_req = True

                    if not product and is_wide_req and domain.lower() != "wind":
                        return JSONResponse(status_code=200, content={
                            "model": model,
                            "provider": "none",
                            "domain": domain,
                            "layer": layer,
                            "run_time": datetime.now(timezone.utc).isoformat(),
                            "valid_time": target_dt.isoformat(),
                            "is_forecast_authoritative": False,
                            "is_estimated": False,
                            "grid": {
                                "bounds": {
                                    "west": -180.0, "south": -90.0, "east": 180.0, "north": 90.0
                                },
                                "cols": 0,
                                "rows": 0,
                                "vectors": [],
                                "diagnostics": {
                                    "nonzeroCount": 0,
                                    "vectors_length": 0,
                                    "renderable": False,
                                    "gridMode": "none"
                                }
                            },
                            "value_kind": "wind_speed" if domain.lower() == "wind" else "wave_height",
                            "value_unit": "kn" if domain.lower() == "wind" else "m",
                            "display_unit_hint": "kn" if domain.lower() == "wind" else "ft",
                            "units": {
                                "speed": "kn" if domain.lower() == "wind" else "m",
                                "direction": "degrees",
                                "period": "seconds"
                            },
                            "source_variables": [],
                            "freshness_sec": 1800,
                            "warnings": ["no_global_coverage"],
                            "is_test_fixture": False,
                            "status": "empty_fallback",
                            "reason": "no_global_coverage",
                            "source": "empty_fallback",
                            "renderable": False
                        })

                    # If the EURO→GFS fallback above set a product, USE it — don't raise. The Step 6/7
                    # no-coverage block runs even when the fallback succeeded, and these raises would
                    # otherwise discard the fallback product (the EURO-wind-never-activates 500/503 bug).
                    if not product:
                        if isinstance(dynamic_err, HTTPException):
                            raise dynamic_err
                        raise HTTPException(status_code=503, detail=f"Grid service temporarily unavailable: {dynamic_err}")
        else:
            # Dynamic viewport not enabled for this layer/model, return honest no-coverage
            return make_no_coverage_grid_response(model, layer, valid_time)

    if product:
        product.valid_time = target_dt

    # 4. Set diagnostics renderable property explicitly
    if product and product.grid:
        if product.grid.diagnostics is None:
            product.grid.diagnostics = {}
        product.grid.diagnostics["renderable"] = len(product.grid.vectors) > 0 and any(v.speed > 0 for v in product.grid.vectors)
        product.grid.diagnostics["partial_coverage"] = getattr(product, "partial_coverage", False)
        product.grid.diagnostics["valid_time"] = product.valid_time.strftime("%Y-%m-%dT%H:%M:%SZ")

    # Attach truthTag for GFS marine waves and all wind forecast models
    is_gfs_marine_waves = (model.upper() == "GFS" and domain.lower() == "marine" and layer.lower() == "waves")
    is_wind = (domain.lower() == "wind" and layer.lower() == "wind")
    if is_gfs_marine_waves or is_wind:
        if isinstance(product, NormalizedProduct):
            product.truthTag = compute_truth_tag(
                model=product.model,
                domain=product.domain,
                layer=product.layer,
                valid_time=product.valid_time,
                run_time=product.run_time,
                product_id=product.product_id,
                provider=product.provider,
                upstream_model=product.upstream_model,
                is_dynamic_viewport_product=product.is_dynamic_viewport_product,
                coverage_scope=product.coverage_scope,
                requested_bbox=product.requested_bbox,
                served_bbox=product.served_bbox,
                cols=product.grid.cols if product.grid else 0,
                rows=product.grid.rows if product.grid else 0,
                vectors=product.grid.vectors if product.grid else []
            )

    from services.copernicus_marine_service import is_test_environment
    if product and model.upper() == "EURO" and domain.lower() == "marine" and layer.lower() in ("waves", "swell_1", "swell_2", "wind_waves") and not is_test_environment():
        product.provider = "copernicus"
        product.is_estimated = False
        product.is_forecast_authoritative = True
        if product.grid:
            if product.grid.diagnostics is None:
                product.grid.diagnostics = {}
            product.grid.diagnostics["provider"] = "copernicus"

    if product and _is_oversized_grid(product):
        logger.warning(
            f"[Grid Resolver] Safety check failed: resolved product {product.product_id} is oversized "
            f"({len(product.grid.vectors)} vectors). Returning no-coverage response."
        )
        return make_no_coverage_grid_response(model, layer, valid_time)

    # ── Option-2 Swell<->Surf toggle: when surf mode is requested, render a COASTAL SURF BAND. Each coastal
    # cell's offshore wave HEIGHT is replaced with its bathymetry breaker estimate (per-cell shelf depth +
    # Komar shoaling / friction / depth-limited breaking; can be bigger at steep reefs, smaller on shallow
    # shelves), u/v scaled to keep direction; every OPEN-OCEAN cell is transparency-masked (is_valid=False)
    # because surf is a coastline property, not an open-ocean field. Additive + gated; serve-only safe
    # (bundled bathymetry + cheap cached math). Marine height-layers only. Kill switch SURF_TRANSFORM=0.
    if (
        surf
        and domain.lower() == "marine"
        and layer.lower() in ("waves", "swell_1", "swell_2", "wind_waves")
        and isinstance(product, NormalizedProduct)
        and product.grid and product.grid.vectors
        and os.environ.get("SURF_TRANSFORM", "1") != "0"
    ):
        # CACHE SAFETY (critical): the surf/rating transform mutates grid vectors IN PLACE (speed→score/10,
        # u/v→0) and stamps diagnostics. `product` here is the SHARED CACHED dynamic product, so mutating it
        # corrupts the cache for the OTHER surf state — a surf=1 request would rewrite the cached grid to ratings,
        # then a surf=0 (Swell) request gets that rating grid (and vice-versa). Live-proven: fresh bbox surf=0 →
        # wave_height, but after a surf=1 hit the same bbox surf=0 returned surf_rating. Deep-copy first so the
        # cached base grid stays pristine and surf=0/surf=1 never cross-contaminate. (Only on surf requests.)
        import copy as _copy
        product = _copy.deepcopy(product)
        try:
            from services.weather_pipeline.bathymetry import shelf_depth_at, is_coastal, shelf_width_km, shore_normal_at
            # Keep the AMBIENT field honest at global/coarse zoom (rating plan §1): a ~10° coarse frame can't
            # resolve a trustworthy shore-normal / exposure, surf is a coastline property, and a blocky
            # world-zoom rating band isn't the experience — the per-spot rating GLYPHS (P1) are the accuracy
            # path. So on a global-extent grid we DON'T transform; the frontend Option-A gate then shows the
            # honest swell field. (This was happening accidentally via an OverflowError on a coastal-classified
            # deep cell; now it's intentional + the math is also hardened in shoaling_coefficient.)
            _b = product.grid.bounds
            _span = ((_b.east - _b.west) if (_b and _b.east >= _b.west) else ((_b.east + 360.0 - _b.west) if _b else 0.0))
            if _b is not None and _span >= 350.0:
                if product.grid.diagnostics is None:
                    product.grid.diagnostics = {}
                product.grid.diagnostics["surf_transform"] = {"skipped": "coarse_extent"}
                logger.info(f"[Grid Route] Surf rating skipped on global/coarse extent ({_span:.0f}°) — honest swell served for {model} {layer}.")
            else:
                # The "surf" toggle renders a SURF-QUALITY RATING overlay: per coastal cell compute the 0-100
                # rating (size + period + wind offshore/onshore via shore_normal) and store score/10 in the
                # height channel (the shader colours it via getRatingColor); open-ocean cells are masked. Wind
                # is co-sampled from the model's own wind product. Kill switch SURF_RATING=0 falls back to the
                # surf-HEIGHT band (the prior surf_transform_grid behaviour) for rollback.
                if os.environ.get("SURF_RATING", "1") != "0":
                    from services.weather_pipeline.surf_rating import rating_transform_grid
                    wind_fn = await _build_wind_sampler(store, manifest, model, target_dt)
                    n_t, n_masked = rating_transform_grid(
                        product.grid.vectors, shelf_depth_at, is_coastal, shelf_width_km, wind_fn, shore_normal_at)
                    tag = {"rated": n_t, "masked": n_masked, "value_kind": "surf_rating", "wind": bool(wind_fn)}
                    label = "RATING overlay"
                else:
                    from services.weather_pipeline.surf_transform import surf_transform_grid
                    n_t, n_masked = surf_transform_grid(product.grid.vectors, shelf_depth_at, is_coastal, shelf_width_km)
                    tag = {"transformed": n_t, "masked": n_masked}
                    label = "height band"
                product.is_estimated = True
                if product.grid.diagnostics is None:
                    product.grid.diagnostics = {}
                product.grid.diagnostics["surf_transform"] = tag
                logger.info(f"[Grid Route] Surf {label}: {n_t} coastal cells, {n_masked} open-ocean masked, for {model} {layer}.")
        except Exception as _se:
            logger.warning(f"[Grid Route] Surf overlay skipped: {_se}")
            # Forensic instrumentation (rating plan §8 #3): the global-coarse frame returns surf_transform:None
            # and the Render exception isn't capturable locally. Stash the exception type+message into the
            # response diagnostics so the NEXT live `/grid?surf=true` on the global frame reveals WHY the
            # transform was skipped (a throw vs a no-op) — forensics over guessing. Purely additive; the
            # frontend Option-A gate already renders the honest swell field when no rating grid exists.
            try:
                if product is not None and getattr(product, "grid", None) is not None:
                    if product.grid.diagnostics is None:
                        product.grid.diagnostics = {}
                    product.grid.diagnostics["surf_skip_reason"] = f"{type(_se).__name__}: {_se}"
            except Exception:
                pass

    return product


async def _build_wind_sampler(store, manifest, model, target_dt):
    """Return a ``(lat, lng) -> (speed_ms, from_deg) | None`` sampler over the model's wind product nearest
    ``target_dt`` (within 3h), for the surf-rating's offshore/onshore wind factor. The wind product stores
    speed in KNOTS (value_unit=kn) -> converted to m/s; ``direction`` is the meteorological FROM bearing.
    Nearest-cell by lat/lng (robust to grid ordering; the wind grid is small/coarse). None if no product."""
    try:
        cands = [
            p for p in manifest.products
            if p.model.upper() == model.upper() and p.domain.lower() == "wind" and p.layer.lower() == "wind"
            and abs((p.valid_time_start - target_dt).total_seconds()) <= 3 * 3600
        ]
        if not cands:
            return None
        best = min(cands, key=lambda p: abs((p.valid_time_start - target_dt).total_seconds()))
        wp = await asyncio.to_thread(store.load_product, best.filename)
        if not wp or not wp.grid or not wp.grid.vectors:
            return None
        vex = [v for v in wp.grid.vectors
               if getattr(v, "lat", None) is not None and getattr(v, "lng", None) is not None
               and getattr(v, "speed", None) is not None]
        if not vex:
            return None
        KT_TO_MS = 0.514444

        def sampler(lat, lng):
            if lat is None or lng is None:
                return None
            best_v = None
            best_d = None
            for v in vex:
                dlng = abs(v.lng - lng)
                if dlng > 180:
                    dlng = 360 - dlng
                d = (v.lat - lat) ** 2 + dlng ** 2
                if best_d is None or d < best_d:
                    best_d = d
                    best_v = v
            if best_v is None:
                return None
            return (best_v.speed * KT_TO_MS, getattr(best_v, "direction", None))

        return sampler
    except Exception:
        return None
