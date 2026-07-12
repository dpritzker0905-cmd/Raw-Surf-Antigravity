"""
grid_resolver_selection.py

Manifest-candidate search + the use_manifest_product policy + the surf regional-preference
override, extracted VERBATIM from grid_resolver.resolve_grid (2026-07-11 split — the file sat at
786/800 LOC and task #17 needs this policy as a clean surgical site). Pure extraction: behavior
is identical; resolve_grid passes its locals in and takes the decision tuple back.
"""
import os
import logging
from datetime import datetime, timezone, timedelta

logger = logging.getLogger(__name__)


def calculate_bbox_intersection_area(w1: float, s1: float, e1: float, n1: float, w2: float, s2: float, e2: float, n2: float) -> float:
    """Calculates the intersection area of two bounding boxes."""
    from services.weather_pipeline.product_selection import bbox_intersection_area
    from collections import namedtuple
    SimpleCov = namedtuple("SimpleCov", ["west", "south", "east", "north"])
    return bbox_intersection_area(w1, s1, e1, n1, SimpleCov(w2, s2, e2, n2))


def find_candidates(manifest, model, domain, layer, target_dt):
    """Search the manifest for candidate products covering the target time (±3h), split
    authoritative vs estimated. Returns (authoritative_candidates, estimated_candidates) as
    lists of (product, time_diff_seconds)."""
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
    return authoritative_candidates, estimated_candidates


def decide_manifest_product(matching_manifest_item, req_w, req_s, req_e, req_n, domain, model, target_dt):
    """The regional/global coverage policy: should the selected manifest item be served for this
    viewport? Returns (matching_manifest_item, manifest_preview_item, use_manifest_product,
    regional_span_lng) — matching_manifest_item comes back None when the policy rejects it."""
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
                from services.weather_pipeline.route_helpers import is_bbox_covered_by
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

    return matching_manifest_item, manifest_preview_item, use_manifest_product, regional_span_lng


def apply_surf_regional_prefer(
    *, surf, use_manifest_product, domain, layer, req_w, req_s, req_e, req_n,
    authoritative_candidates, estimated_candidates,
    matching_manifest_item, manifest_preview_item, regional_span_lng,
):
    """── SURF RATING regional preference (kill switch SURF_REGIONAL_PREFER=0) ──
    The rating band is a COASTAL feature. When the (frontend-padded) viewport pokes just past a regional
    tile's offshore edge, select_best_candidate picks the GLOBAL coarse product on raw intersection
    area, use_manifest_product ends up False (or the global is_wider/coverage check fails), the resolver
    serves the coarse global extent, and the surf transform is skipped (coarse_extent) → the band vanishes.
    Live root cause: the FL tile's offshore edge -79° is ~1° off the -80° surf coast and the series client
    pads +0.5°. For surf requests over a NON-wide viewport, re-select the regional tile that overlaps the
    viewport (Step 3 clips it to the snapped bbox; the offshore remainder is masked open-ocean) so the band
    paints on its coastal cells. Fixes every narrow coast worldwide without touching tile ingest extents.
    Returns the (possibly updated) (matching_manifest_item, manifest_preview_item,
    use_manifest_product, regional_span_lng) tuple."""
    if (
        surf
        and not use_manifest_product
        and domain.lower() == "marine"
        and layer.lower() in ("waves", "swell_1", "swell_2", "wind_waves")
        and req_w is not None
        and os.environ.get("SURF_REGIONAL_PREFER", "1") != "0"
    ):
        from services.weather_pipeline.product_selection import pick_surf_regional_override
        # COVERAGE FLOOR (2026-07-12, the "no band off Tampa" + "band clears zooming 5.46→5.30"
        # reports): any-overlap acceptance served the florida_east_coast SLIVER to Tampa-centered
        # and wide viewports, preempting the DYNAMIC lane — which rates the WHOLE viewport (the
        # transform runs on any sub-350° extent; probe-proven on ICON/GFS dynamic products). The
        # engine then held/rejected the sliver → band gaps and the zoom-out clear. Require the
        # tile to cover ≥ SURF_REGIONAL_PREFER_MIN_FRAC (default 0.45) of the viewport — the
        # offshore-poke case this override exists for sits at ~0.7-0.95; the Tampa sliver at
        # ~0.05-0.2 now falls through to the dynamic lane and gets a full-viewport rating grid.
        try:
            _surf_min_frac = float(os.environ.get("SURF_REGIONAL_PREFER_MIN_FRAC", "0.45"))
        except ValueError:
            _surf_min_frac = 0.45
        surf_regional_item = pick_surf_regional_override(
            authoritative_candidates, estimated_candidates, req_w, req_s, req_e, req_n,
            min_viewport_frac=_surf_min_frac,
        )
        if surf_regional_item is not None:
            matching_manifest_item = surf_regional_item
            manifest_preview_item = None
            use_manifest_product = True
            _cov = surf_regional_item.coverage
            if _cov.west <= _cov.east:
                regional_span_lng = _cov.east - _cov.west
            else:
                regional_span_lng = (180.0 - _cov.west) + (_cov.east + 180.0)
            logger.info(
                f"[Grid Route] Surf regional-prefer: serving regional tile "
                f"'{getattr(surf_regional_item, 'filename', '?')}' over global so the rating band paints."
            )
    return matching_manifest_item, manifest_preview_item, use_manifest_product, regional_span_lng


# ⛔ apply_marine_intersect_prefer REMOVED same-day (2026-07-11 eve, shipped 6a5f6992 → reverted):
# its premise — "manifest regional tiles are FINE" — was falsified by live probes (FL pilots are
# 13×9 = 0.25° at every hour; choose_adaptive_resolution floors the dynamic lane at 0.25° too), so
# the pass served a coarser-or-equal PARTIAL rect clipped at the tile edge with no revalidation
# (sticky) — a clamped-rectangle regression at straddling viewports, user-reported minutes after
# deploy. pick_surf_regional_override keeps the min_viewport_frac param (tested, dormant) for the
# redesigned #17 once the fine-grid resolution provenance is mapped.
