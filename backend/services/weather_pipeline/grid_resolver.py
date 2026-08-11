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
from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException
from fastapi.responses import JSONResponse

from services.weather_pipeline.schemas import NormalizedProduct
from services.weather_pipeline.route_helpers import (
    parse_valid_time, parse_bbox, filter_grid_to_bbox,
    make_unsupported_icon_swell2_grid_response, make_no_coverage_grid_response,
    compute_truth_tag, get_snapped_bbox, is_bbox_covered_by
)
from services.weather_pipeline.product_selection import select_best_candidate
from services.weather_pipeline.viewport_helper import _is_oversized_grid
# 2026-07-11 split (786/800 LOC): candidate search + coverage policy + surf regional-prefer live in
# grid_resolver_selection; the surf/rating overlay tail + wind sampler live in grid_resolver_surf.
# Pure extractions — calculate_bbox_intersection_area is re-exported here for compatibility.
from services.weather_pipeline.grid_resolver_selection import (
    calculate_bbox_intersection_area, find_candidates, decide_manifest_product,
    apply_surf_regional_prefer,
)
from services.weather_pipeline.grid_resolver_surf import apply_surf_overlay

logger = logging.getLogger(__name__)


def stamp_frame_honesty(product, target_dt, ask_str: str) -> None:
    """SERVING HONESTY (2026-07-14 §0c, frame-skew postmortem): resolve_grid overwrites
    product.valid_time with the REQUESTED time just before responding — the response has always
    echoed the ask, so a ±3h nearest-frame substitution served as if exact (stale=False) with
    the product_id filename as the only truth. That mask hid the surf-override frame skew for
    hours. The echo is a load-bearing frontend contract and stays; call this BEFORE the
    overwrite to capture the served frame's true time into the ADDITIVE honesty fields
    (served_valid_time / frame_offset_hours / frame_substituted at >30 min). Never raises —
    a naive/aware datetime mismatch leaves the defaults (None/0.0/False) rather than failing
    a serve."""
    try:
        true_frame_dt = product.valid_time
        if true_frame_dt is None:
            return
        offset_h = (true_frame_dt - target_dt).total_seconds() / 3600.0
        product.served_valid_time = true_frame_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
        product.frame_offset_hours = round(offset_h, 2)
        product.frame_substituted = abs(offset_h) > 0.5
        if product.frame_substituted:
            logger.info(
                f"[Grid Resolver] Frame substitution: serving {product.served_valid_time} "
                f"for ask {ask_str} ({product.frame_offset_hours:+.1f}h) — {product.product_id}"
            )
    except Exception as _e:
        # R11-07/R11-13 (2026-08-09): a failure HERE serves a time-substituted frame with its
        # honesty flags silently unset — the served payload then claims the ask was the answer.
        # Non-fatal stays (honesty stamping must never cost the frame); silence does not.
        logger.warning(f"[Grid Resolver] frame-honesty stamp failed for "
                       f"{getattr(product, 'product_id', '?')}: {type(_e).__name__}: {_e}")


def _grid_cell_deg(grid) -> Optional[float]:
    """Approx longitudinal cell size (°) of a resolved grid = lon-span / cols (antimeridian-safe).
    Returns None when bounds/cols are missing. Used by the Step-1&2 resolution-adequacy guard to
    compare a cached dynamic-viewport product against a covering precomputed regional tile."""
    try:
        b = getattr(grid, "bounds", None)
        cols = getattr(grid, "cols", None)
        if not b or not cols:
            return None
        span = (b.east + 360.0 - b.west) if b.east < b.west else (b.east - b.west)
        return (span / cols) if span > 0 else None
    except Exception:
        return None



def _load_kw(series_stride) -> dict:
    """`{"stride": n}` only when a stride is actually wanted, else `{}`.

    ⚠️ ADDITIVE BY CONSTRUCTION, and that is the point. Passing `stride` unconditionally — even as
    None — breaks every existing test double whose `load_product(self, filename)` takes two
    positional arguments. Two mid-res-tier tests failed exactly that way before this existed. A
    store that never receives the kwarg cannot behave differently because of it.
    """
    return {"stride": series_stride} if (series_stride or 0) > 1 else {}


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
    series_stride: Optional[int] = None,
):
    """
    Resolves a compact normalized coordinate grid ready for WebGL rendering, enforcing dynamic
    bounding-box coordinate filtering to conserve bandwidth. `store` and `viewport_service`
    are injected so the route handler and grid_series share one resolver.

    ``series_stride`` (>1) is passed through to `store.load_product` so a caller that is going to
    decimate the grid ANYWAY — grid_series, which already strides every hour as it lands — never
    pays to build the cells it will discard. Default None means every other caller, including the
    single-hour `/grid` route, resolves exactly as before. Only the DURABLE-PRODUCT lanes honour
    it; the dynamic-viewport fast path is untouched (see the note at Step 1&2).
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
    authoritative_candidates, estimated_candidates = find_candidates(
        manifest, model, domain, layer, target_dt
    )

    # MID-RES split (Step 3.6 tier, mid_res_tier.py): global_mid items must never compete in the
    # generic selection — select_best_candidate ties globals on intersection+coverage area and falls
    # to LIST ORDER, so leaving them in made the world-zoom product (and the preview/stale fallbacks)
    # an order-luck draw between the 629-vector coarse and the ~15k-vector mid. The tier serves them,
    # clipped, authoritative-first-then-estimated (the coarse blend mirror).
    from services.weather_pipeline.mid_res_tier import split_mid_candidates, try_serve_mid_res_tier
    authoritative_candidates, estimated_candidates, _mid_auth, _mid_est = split_mid_candidates(
        authoritative_candidates, estimated_candidates
    )

    # Match best candidate from registry
    matching_manifest_item = select_best_candidate(
        authoritative_candidates, estimated_candidates, req_w, req_s, req_e, req_n
    )

    # Coverage policy (extracted: grid_resolver_selection.decide_manifest_product) — should the
    # selected manifest item be served for this viewport?
    matching_manifest_item, manifest_preview_item, use_manifest_product, regional_span_lng = (
        decide_manifest_product(
            matching_manifest_item, req_w, req_s, req_e, req_n, domain, model, target_dt
        )
    )

    # SURF RATING regional preference (extracted; kill switch SURF_REGIONAL_PREFER=0): for surf
    # requests over a non-wide viewport, re-select the overlapping regional tile so the coastal
    # rating band paints even when the padded viewport pokes past the tile's offshore edge.
    matching_manifest_item, manifest_preview_item, use_manifest_product, regional_span_lng = (
        apply_surf_regional_prefer(
            surf=surf, use_manifest_product=use_manifest_product, domain=domain, layer=layer,
            req_w=req_w, req_s=req_s, req_e=req_e, req_n=req_n,
            authoritative_candidates=authoritative_candidates,
            estimated_candidates=estimated_candidates,
            matching_manifest_item=matching_manifest_item,
            manifest_preview_item=manifest_preview_item,
            regional_span_lng=regional_span_lng,
        )
    )

    # ⛔ REVERTED same-day (2026-07-11 eve): apply_marine_intersect_prefer ("serve the intersecting
    # fine tile for straddling viewports") was built on a FALSIFIED premise — live probes showed the
    # marine manifest pilots are 13×9 (0.25°, every hour), i.e. NEVER finer than the dynamic lane
    # (choose_adaptive_resolution also floors at 0.25°). The pass served a coarser-or-equal PARTIAL
    # rect clipped at the tile edge with NO revalidation scheduled (sticky), which reads as a clamped
    # rectangle at straddling viewports — the exact user report minutes after deploy. The real #17
    # cold-arrival fix needs a resolution-provenance map first (what lane, if any, produces the
    # historical fine 61×41 grids). See HANDOFF-2026-07-11-EVE §revert.

    # Step-wise product resolution
    product = None
    _dropped_dyn_cache = None   # root-A guard: a coarse dynamic hit set aside for a finer regional

    # Step 1 & 2: Exact/fresh or stale dynamic cache hit for snapped viewport
    if bbox and viewport_service.is_viewport_enabled(model, domain, layer, False, bbox, target_dt=target_dt):
        product = await viewport_service.get_cached_dynamic_product(
            model=model, domain=domain, layer=layer, target_dt=target_dt, bbox_str=bbox
        )

        # RESOLUTION-ADEQUACY GUARD (2026-07-15, root A — the "ICON coarse / wave-direction wrong when
        # the rating band is on" report): a STALE COARSE dynamic-viewport product (e.g. a 0.44°/cell
        # ICON tile cached mid-pan) must NOT preempt a FINER precomputed regional tile that FULLY
        # COVERS this viewport. Curl-proven 2026-07-15: fresh coastal serves are 0.235° for all models,
        # yet an overlapping cached 0.44° dynamic tile was served OVER the available 0.25° regional
        # (the dynamic-cache lane short-circuits Step 3 below). Unlike the reverted §0n cache gate
        # (which rejected to global_mid — a WORSE fallthrough), we drop the dynamic hit ONLY when a
        # covering, meaningfully-finer regional manifest item is CONFIRMED present, so Step 3 serves
        # THAT fine regional (clipped) — the fallthrough is guaranteed finer, never coarser. The
        # dropped product is restored if Step 3 unexpectedly yields nothing (never serve blank).
        # Kill: MARINE_DYNCACHE_PREFER_FINE_REGIONAL=0.
        if (product is not None and getattr(product, "grid", None) is not None
                and domain.lower() == "marine" and req_w is not None
                and use_manifest_product and matching_manifest_item is not None
                and regional_span_lng < 350.0
                and os.environ.get("MARINE_DYNCACHE_PREFER_FINE_REGIONAL", "1") != "0"):
            _dyn_cell = _grid_cell_deg(product.grid)
            _reg_res = getattr(matching_manifest_item, "resolution", None)
            _reg_cov = getattr(matching_manifest_item, "coverage", None)
            _covers = bool(_reg_cov is not None
                           and is_bbox_covered_by(req_w, req_s, req_e, req_n, _reg_cov, margin=0.05))
            if _dyn_cell is not None and _reg_res and _covers and _dyn_cell > _reg_res * 1.25:
                logger.info(
                    f"[Grid Resolver] Root-A: dynamic-cache {_dyn_cell:.3f}°/cell is coarser than the "
                    f"covering regional '{getattr(matching_manifest_item, 'filename', '?')}' "
                    f"({_reg_res:.3f}°) — preferring the fine regional tile."
                )
                _dropped_dyn_cache = product
                product = None

    # Step 3: Durable manifest full coverage
    if not product:
        if use_manifest_product and matching_manifest_item:
            candidate_product = await asyncio.to_thread(store.load_product, matching_manifest_item.filename, **_load_kw(series_stride))
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

    # Root-A restore: if the fine regional we deferred to could NOT be served (missing/oversized
    # file), fall back to the dynamic-cache product we set aside rather than serving blank — the
    # coarse-but-covering tile beats nothing. Normal path: Step 3 served the regional → product set →
    # no restore.
    if product is None and _dropped_dyn_cache is not None:
        logger.info("[Grid Resolver] Root-A: fine regional unavailable in Step 3 — restoring the "
                    "set-aside dynamic-cache product.")
        product = _dropped_dyn_cache

    # Step 3.5: Fast manifest preview (SWR)
    from services.weather_pipeline.store import is_test_environment
    if not product and manifest_preview_item and not is_test_environment():
        file_path = store.cache_dir / manifest_preview_item.filename
        file_exists = await asyncio.to_thread(file_path.exists)
        if file_exists:
            logger.info(f"[Grid Route] Serving conformed manifest item {manifest_preview_item.filename} as instant SWR preview")
            candidate_product = await asyncio.to_thread(store.load_product, manifest_preview_item.filename, **_load_kw(series_stride))
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

    # Step 3.6: MID-RES GLOBAL TIER (2026-07-05; extracted to mid_res_tier.py). The z5-7 quality tier:
    # serves the ~2° global_mid CLIPPED to the viewport for marine spans in (0,40]° (tight-zoom floor
    # dropped 2026-07-12 so cold/panned surf zooms get an instant coastal band; MAX_SPAN raised 15→40
    # 2026-07-22 so a zoom-out to ~z5 keeps compact storms resolved — see mid_res_tier.py), authoritative-first
    # then ESTIMATED (mirroring the coarse products' extended-estimate blend structure so scrubbing past a
    # model's native horizon keeps mid-res quality). Also a REPLACE pass: at estimated hours Step 3 above
    # short-circuits and serves the UNCLIPPED 10° coarse global — the tier upgrades that to the clipped
    # mid, but never replaces a regional/finer product. No-op until the cron ships global_mid products.
    # Kill: MARINE_MID_RES_TIER=0; band tunable MARINE_MID_RES_{MIN,MAX}_SPAN.
    if not is_test_environment():
        _mid_product = await try_serve_mid_res_tier(
            store, model=model, domain=domain, layer=layer, bbox=bbox,
            req_w=req_w, req_s=req_s, req_e=req_e, req_n=req_n,
            mid_auth=_mid_auth, mid_est=_mid_est, current_product=product,
            # SWR sharpen (#2): the tier serves the mid INSTANTLY and schedules the same background
            # fine-viewport revalidation Step 3.7 uses (span-capped at MARINE_MID_REVAL_MAX_SPAN=5°),
            # so dwelling viewports sharpen 2° → 0.25° — the pre-mid steady state restored.
            viewport_service=viewport_service, valid_time=valid_time, target_dt=target_dt,
            background_tasks=background_tasks,
        )
        if _mid_product is not None:
            product = _mid_product

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
            # Require the instant preview to fully COVER the viewport (kills the zoom-out clamp: a
            # smaller overlapping viewport tile would otherwise render as a floating sub-viewport
            # rectangle). When nothing covers, the helper returns the covering global-coarse instead,
            # and the background revalidation below sharpens to the exact viewport tile on the next
            # request. Kill switch MARINE_PREVIEW_REQUIRE_COVERAGE=0 restores the prior overlap reuse.
            _preview_require_cov = os.environ.get("MARINE_PREVIEW_REQUIRE_COVERAGE", "1") != "0"
            preview = await viewport_service._find_any_cached_product(
                model, domain, layer, target_dt, bbox, require_coverage=_preview_require_cov
            )
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
                            product.model = "EURO"
                            if _is_euro_wind:
                                product.provider = "gfs_fallback"
                                product.is_estimated = True
                                product.is_forecast_authoritative = False
                            else:
                                # GFS data relabeled EURO is an ESTIMATE in every environment
                                # (2026-07-04): the old prod branch stamped it provider="copernicus"/
                                # is_estimated=False — GFS served as native CMEMS, the exact
                                # provenance lie the audit banned. Tests and prod now agree.
                                product.provider = "gfs_estimated_fallback"
                                product.is_estimated = True
                                product.is_forecast_authoritative = False
                                if not getattr(product, "estimate_basis", None):
                                    product.estimate_basis = {
                                        "type": "gfs_estimated_fallback",
                                        "method": "gfs_wave_fallback",
                                        "source_model": "ncep_gfswave025",
                                    }
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
                    candidate_product = await asyncio.to_thread(store.load_product, overlap_manifest_item.filename, **_load_kw(series_stride))
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

                    # FAR-EDGE HOLD (S4): past the lane's tail, serve the last covered frame
                    # relabeled instead of a zero grid / 404 blank. Kill: FAR_EDGE_HOLD=0.
                    if not product and domain.lower() == "marine":
                        from services.weather_pipeline.far_edge_hold import try_far_edge_hold
                        product = await try_far_edge_hold(store, model, domain, layer, target_dt)

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
            # FAR-EDGE HOLD (S4) before the terminal: the h336 no_copernicus_coverage class —
            # dynamic viewport is disabled past the model's window, but the estimated tail's last
            # frame is a few hours back and honest to hold. Kill: FAR_EDGE_HOLD=0.
            if domain.lower() == "marine":
                from services.weather_pipeline.far_edge_hold import try_far_edge_hold
                product = await try_far_edge_hold(store, model, domain, layer, target_dt)
            if not product:
                # Dynamic viewport not enabled for this layer/model, return honest no-coverage
                return make_no_coverage_grid_response(model, layer, valid_time)

    if product:
        stamp_frame_honesty(product, target_dt, valid_time)
        product.valid_time = target_dt

    # 4. Set diagnostics renderable property explicitly
    if product and product.grid:
        if product.grid.diagnostics is None:
            product.grid.diagnostics = {}
        product.grid.diagnostics["renderable"] = len(product.grid.vectors) > 0 and any(v.speed > 0 for v in product.grid.vectors)
        product.grid.diagnostics["partial_coverage"] = getattr(product, "partial_coverage", False)
        product.grid.diagnostics["valid_time"] = product.valid_time.strftime("%Y-%m-%dT%H:%M:%SZ")
        product.grid.diagnostics["served_valid_time"] = product.served_valid_time
        product.grid.diagnostics["frame_offset_hours"] = product.frame_offset_hours

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

    # REMOVED (2026-07-04): the blanket EURO-marine production override (provider="copernicus",
    # is_estimated=False, is_forecast_authoritative=True on EVERY response) compensated for the
    # ingestion bug that stamped native CMEMS products estimated — but it also WHITEWASHED genuine
    # estimates (the GFS 10-14d tail, live upstream fallbacks) as native Copernicus. Ingestion now
    # labels truthfully at save (scheduler estimated_after_index fix), so provenance flows from the
    # product unmodified: real data reads real, estimates read estimated — in every environment.

    if product and _is_oversized_grid(product):
        logger.warning(
            f"[Grid Resolver] Safety check failed: resolved product {product.product_id} is oversized "
            f"({len(product.grid.vectors)} vectors). Returning no-coverage response."
        )
        return make_no_coverage_grid_response(model, layer, valid_time)

    # Option-2 Swell<->Surf toggle (extracted: grid_resolver_surf.apply_surf_overlay; kill
    # switches SURF_TRANSFORM=0 / SURF_RATING=0). Deep-copies the shared cached product before
    # the in-place rating/height transform so surf=0/surf=1 never cross-contaminate the cache.
    product = await apply_surf_overlay(
        product, store=store, manifest=manifest, model=model, domain=domain, layer=layer,
        surf=surf, target_dt=target_dt,
    )

    return product
