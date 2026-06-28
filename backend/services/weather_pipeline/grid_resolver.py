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
                elif model.upper() == "EURO" and domain.lower() == "marine":
                    # Reuse regional Copernicus tiles if the requested viewport overlaps the region and is not wider
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
        try:
            from services.weather_pipeline.surf_transform import surf_transform_grid
            from services.weather_pipeline.bathymetry import shelf_depth_at, is_coastal
            n_t, n_masked = surf_transform_grid(product.grid.vectors, shelf_depth_at, is_coastal)
            product.is_estimated = True
            if product.grid.diagnostics is None:
                product.grid.diagnostics = {}
            product.grid.diagnostics["surf_transform"] = {"transformed": n_t, "masked": n_masked}
            logger.info(f"[Grid Route] Surf band: {n_t} coastal cells -> breaker height, "
                        f"{n_masked} open-ocean cells masked, for {model} {layer}.")
        except Exception as _se:
            logger.warning(f"[Grid Route] Surf transform skipped: {_se}")

    return product
