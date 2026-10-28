"""RESOLVER_SKIP_MISSING_OBJECT (dark, 2026-10-26): a listed-but-absent product is skipped, not answered with a 404.

WHY. The manifest can list an object storage no longer holds (manifest_object_identity.py has the measured cause: a prune of a
duplicate registration deleted the object its surviving twin names, 51-54 EURO global_coarse estimates per cycle). Step 3 of
resolve_grid then loaded nothing and the ask fell through to 404 no_copernicus_coverage, while the 3-hourly neighbours of
the missing slot sat in storage within the resolver's own +-3 h window.

THE RULE. Before Step 3 loads the selected manifest item, make sure its object is here (the same fetch load_product does: L1
file, else one L2 download with its negative cache). If it is absent, drop that item and re-run the SAME selection on the
remaining candidates (select_best_candidate -> prefer_overlapping_marine_region -> decide_manifest_product), up to
MAX_SKIPS times. Nothing new is invented: the neighbour served is one the policy would have chosen had the missing slot
not been listed, and stamp_frame_honesty labels it with its own valid time (served_valid_time / frame_offset_hours), so the
client's status line says "the nearest stored forecast" (#444/#578).

This changes what is served (a 404 becomes the neighbouring frame), so it ships dark (D-001). Kill/flip: the env var.
"""
import asyncio
import logging
import os

logger = logging.getLogger(__name__)

FLAG = "RESOLVER_SKIP_MISSING_OBJECT"
MAX_SKIPS = 3


def enabled() -> bool:
    return os.environ.get(FLAG, "0") == "1"


def object_present(store, filename) -> bool:
    """The object is on L1, or one L2 fetch brings it there (fetch_l2_to_disk: its lock and negative cache)."""
    if (store.cache_dir / filename).exists():
        return True
    from services.weather_pipeline.store_helpers import fetch_l2_to_disk
    return fetch_l2_to_disk(store, filename)


def reselect(auth, est, mid, domain, model, target_dt, req_w, req_s, req_e, req_n):
    """resolve_grid's own selection chain on a candidate set (same order, same functions)."""
    from services.weather_pipeline.grid_resolver_selection import decide_manifest_product, prefer_overlapping_marine_region
    from services.weather_pipeline.product_selection import select_best_candidate
    item = select_best_candidate(auth, est, req_w, req_s, req_e, req_n)
    item = prefer_overlapping_marine_region(item, auth, est, domain, req_w, req_s, req_e, req_n, mid)
    return decide_manifest_product(item, req_w, req_s, req_e, req_n, domain, model, target_dt)


async def skip_missing(store, decision, auth, est, mid, domain, model, target_dt, req_w, req_s, req_e, req_n):
    """decision = (matching_manifest_item, manifest_preview_item, use_manifest_product, regional_span_lng). Returns the
    decision to serve: unchanged when the flag is off or the item's object is present."""
    if not enabled():
        return decision
    skipped = []
    for _ in range(MAX_SKIPS):
        item, _preview, use, _span = decision
        if item is None or not use or await asyncio.to_thread(object_present, store, item.filename):
            break
        skipped.append(item.filename)
        auth = [pair for pair in auth if pair[0] is not item]
        est = [pair for pair in est if pair[0] is not item]
        decision = reselect(auth, est, mid, domain, model, target_dt, req_w, req_s, req_e, req_n)
    if skipped:
        chosen = decision[0].filename if decision[0] is not None and decision[2] else None
        logger.warning("[Grid Resolver] Listed product(s) absent from storage %s; serving %s", skipped, chosen)
    return decision
