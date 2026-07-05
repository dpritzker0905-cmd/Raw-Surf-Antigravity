"""
mid_res_tier.py

Step 3.6 MID-RES GLOBAL TIER for grid_resolver (extracted 2026-07-05 to keep grid_resolver.py under
the 800-LOC ceiling, and upgraded to MIRROR the extended-estimate blend structure of the coarse
products).

The tier serves the pre-computed `global_mid` (~2°) product CLIPPED to the viewport for marine
requests whose span sits between the regional tiles (≤2°) and the wide/global view (>15°). Two rules
keep the FORECAST TIMELINE consistent with the coarse siblings (the "mirror"):

  • AUTHORITATIVE-FIRST, THEN ESTIMATED: native mid hours serve the authoritative global_mid; hours
    past a model's native horizon (EURO 240→336h extended estimates, tails) serve the ESTIMATED
    global_mid built by the same machinery as the coarse blends — provenance flows from the product
    unmodified (is_estimated / estimate_basis / source_dataset), so real reads real and estimates
    read estimated at every hour.
  • REPLACE-COARSE-GLOBAL ONLY: at estimated hours Step 3 short-circuits (an estimated manifest item
    sets use_manifest_product=True) and serves the UNCLIPPED 10° global_coarse before Step 3.6 is
    reached — so the tier also runs as a REPLACE pass: it may swap an unclipped GLOBAL-span product
    for the clipped mid, but NEVER replaces a regional/finer product.

`split_mid_candidates` additionally removes global_mid items from the GENERIC candidate lists:
select_best_candidate ties globals on intersection+coverage area and falls to list order, so leaving
global_mid in made the world-zoom product (and the Step 3.7/stale-fallback previews) an ORDER-LUCK
draw between a 629-vector coarse and a ~15k-vector mid. global_mid is served ONLY by this tier,
clipped. Kill switch: MARINE_MID_RES_TIER=0; band tunable MARINE_MID_RES_{MIN,MAX}_SPAN.
"""
import asyncio
import logging
import os

from services.weather_pipeline.route_helpers import filter_grid_to_bbox, get_snapped_bbox
from services.weather_pipeline.viewport_helper import _is_oversized_grid

logger = logging.getLogger(__name__)

_MID_LAYERS = ("waves", "swell_1", "swell_2", "wind_waves")


def split_mid_candidates(authoritative_candidates, estimated_candidates):
    """Partition (product, diff) candidate lists into (generic_auth, generic_est, mid_auth, mid_est).

    global_mid items must never compete in the generic selection (world-zoom tie / preview order-luck
    above) — the tier below is their single serving path.
    """
    def _split(cands):
        generic, mid = [], []
        for pair in cands:
            p = pair[0]
            (mid if getattr(p, "region_id", None) == "global_mid" else generic).append(pair)
        return generic, mid

    generic_auth, mid_auth = _split(authoritative_candidates)
    generic_est, mid_est = _split(estimated_candidates)
    return generic_auth, generic_est, mid_auth, mid_est


def _request_span(req_w, req_s, req_e, req_n):
    if req_w <= req_e:
        span_lng = req_e - req_w
    else:
        span_lng = (180.0 - req_w) + (req_e + 180.0)
    return max(span_lng, abs(req_n - req_s))


def _grid_span(product):
    try:
        b = product.grid.bounds
        return (b.east - b.west) if b.east >= b.west else (b.east + 360.0 - b.west)
    except Exception:
        return 0.0


def pick_mid_item(mid_auth, mid_est):
    """Authoritative mid first (native hours); else estimated mid (the mirror's blend/tail hours).
    Within a class, smallest time-diff wins."""
    for cands in (mid_auth, mid_est):
        if cands:
            return min(cands, key=lambda pair: pair[1])[0]
    return None


async def try_serve_mid_res_tier(
    store,
    *,
    model,
    domain,
    layer,
    bbox,
    req_w, req_s, req_e, req_n,
    mid_auth,
    mid_est,
    current_product,
):
    """Serve (or replace with) the clipped global_mid when the request sits in the mid span band.

    Returns the mid product to use, or None to keep `current_product` / fall through. Never replaces
    a regional/finer product — only fills a hole (current_product None) or upgrades an UNCLIPPED
    GLOBAL-span grid (the 10° coarse the estimated-hour Step 3 shortcut serves).
    """
    if os.environ.get("MARINE_MID_RES_TIER", "1") == "0":
        return None
    if not bbox or req_w is None or domain.lower() != "marine" or layer.lower() not in _MID_LAYERS:
        return None

    span = _request_span(req_w, req_s, req_e, req_n)
    lo = float(os.environ.get("MARINE_MID_RES_MIN_SPAN", "2.0"))
    hi = float(os.environ.get("MARINE_MID_RES_MAX_SPAN", "15.0"))
    if not (lo < span <= hi):
        return None

    # Replace-guard: only fill a hole or upgrade an unclipped global-span product.
    if current_product is not None and _grid_span(current_product) < 350.0:
        return None

    mid_item = pick_mid_item(mid_auth, mid_est)
    if mid_item is None:
        return None

    candidate_product = await asyncio.to_thread(store.load_product, mid_item.filename)
    if not candidate_product or not candidate_product.grid:
        return None
    if _is_oversized_grid(candidate_product):
        logger.warning(f"[Grid Resolver] Skipping oversized global_mid product {mid_item.filename} in Step 3.6.")
        return None

    product = candidate_product
    product.product_id = mid_item.filename
    product.coverage_scope = "regional"      # served clipped → regional-like on the client
    product.coverage_mode = "regional_tile"  # so filter_grid_to_bbox clips it below
    product.partial_coverage = False
    product.requested_bbox_original = bbox
    product.query_bbox = bbox
    product.requested_bbox = bbox
    product = filter_grid_to_bbox(product, get_snapped_bbox(bbox, model))
    if product.grid:
        if product.grid.diagnostics is None:
            product.grid.diagnostics = {}
        product.grid.diagnostics["mid_res_tier"] = True  # surf gate keeps this coarse-ish tier honest
        if product.grid.bounds:
            product.served_bbox = (
                f"{product.grid.bounds.west:.4f},{product.grid.bounds.south:.4f},"
                f"{product.grid.bounds.east:.4f},{product.grid.bounds.north:.4f}"
            )
    logger.info(
        f"[Grid Route] Mid-res tier: serving global_mid '{mid_item.filename}' clipped to viewport "
        f"({span:.1f}°) for {model} {layer}"
        + (" [estimated mirror hour]" if getattr(mid_item, "is_estimated", False) else "")
        + (" [replaced unclipped global]" if current_product is not None else "")
        + " — regional-quality at zoom-out."
    )
    return product
