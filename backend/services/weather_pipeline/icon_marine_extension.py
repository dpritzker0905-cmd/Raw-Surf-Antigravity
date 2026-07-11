"""ICON marine >168h pre-baked estimates (strategy slice 1 second half, 2026-07-11).

GWAM (DWD's wave model) ends at 168h; the 168-336h window was synthesized CLIENT-side per
viewport per hour by fetchBackendMarineGridIconExtended — persistence(ICON@168) + GFS trend,
THREE /grid requests per far hour. The math is byte-identical to the backend estimator's
no-third-model path (get_estimate_weights is_icon_valid=False), so this bakes it on the runner
by calling estimate_euro_grid with the ICON anchor in the persistence slot and relabeling the
output (model=ICON, basis icon_persistence_gfs_blend). estimator.py is UNTOUCHED — the EURO
lane's machinery is load-bearing and this wrapper only remaps labels on the returned product.
Scope: global_coarse only (the far-zoom scrub path; regional mirroring is a follow-up). The
client blend demotes to FALLBACK automatically — the resolver serves stored products first
(the fc0ec396/e1adb799 pattern). copernicus_validator early-returns for non-EURO models, so no
whitelist change is needed (verified 2026-07-11).

Kill switch: ICON_MARINE_EXTEND=0.
"""
import os
import asyncio
import logging
from datetime import timedelta

logger = logging.getLogger(__name__)

ICON_NATIVE_LIMIT_HOURS = 168.0
_CEILING_HOURS = 336.0
_GLOBAL_REGION_IDS = ("global_coarse", "global", None)
_LAYERS = ("waves", "swell_1", "wind_waves")  # GWAM's native set; swell_2 stays a client blend


def _icon_anchor_item(products, layer):
    """Last NATIVE ICON marine product for the global_coarse lane."""
    pool = [
        p for p in products
        if p.model == "ICON" and p.domain == "marine" and p.layer == layer
        and p.region_id in _GLOBAL_REGION_IDS and not p.is_estimated
    ]
    return max(pool, key=lambda p: p.valid_time_start) if pool else None


async def ingest_icon_marine_extended_estimates_impl(scheduler) -> bool:
    if os.environ.get("ICON_MARINE_EXTEND", "1") == "0":
        return False
    from services.weather_pipeline.estimator import estimate_euro_grid, EstimateContractError
    from services.weather_pipeline.scheduler_helpers import find_nearest_manifest_product

    manifest = await asyncio.to_thread(scheduler.store.get_manifest)
    products_to_save = []

    for layer in _LAYERS:
        anchor_item = _icon_anchor_item(manifest.products, layer)
        if not anchor_item:
            logger.info(f"[Pipeline Scheduler] No ICON marine {layer} anchor for global_coarse. Skipping layer.")
            continue
        anchor_time = anchor_item.valid_time_start
        icon_anchor = await asyncio.to_thread(scheduler.store.load_product, anchor_item.filename)
        if not icon_anchor:
            continue

        gfs_anchor_item = find_nearest_manifest_product(
            manifest, "GFS", "marine", layer, "global_coarse", anchor_time, max_delta_hours=3.0
        )
        if not gfs_anchor_item:
            logger.warning(f"[Pipeline Scheduler] No GFS anchor near {anchor_time.isoformat()} for ICON {layer} ext. Skipping layer.")
            continue
        gfs_anchor = await asyncio.to_thread(scheduler.store.load_product, gfs_anchor_item.filename)
        if not gfs_anchor:
            continue

        run_time = getattr(icon_anchor, "run_time", None) or anchor_time
        ceiling = run_time + timedelta(hours=_CEILING_HOURS)
        gfs_targets = sorted(
            (p for p in manifest.products
             if p.model == "GFS" and p.domain == "marine" and p.layer == layer
             and p.region_id in _GLOBAL_REGION_IDS and not p.is_estimated
             and anchor_time < p.valid_time_start <= ceiling),
            key=lambda p: p.valid_time_start,
        )

        for target_item in gfs_targets:
            target_time = target_item.valid_time_start
            target_hour = ICON_NATIVE_LIMIT_HOURS + (target_time - anchor_time).total_seconds() / 3600.0
            gfs_target = await asyncio.to_thread(scheduler.store.load_product, target_item.filename)
            if not gfs_target:
                continue
            try:
                est = estimate_euro_grid(
                    target_hour=target_hour,
                    native_limit=ICON_NATIVE_LIMIT_HOURS,
                    active_layer=layer,
                    euro_anchor_product=icon_anchor,       # persistence slot — parameterized, not EURO-specific
                    gfs_target_product=gfs_target,
                    gfs_anchor_product=gfs_anchor,
                    icon_target_product=None,              # no third model: is_icon_valid=False weight path
                    icon_anchor_product=None,
                    euro_anchor_valid_time=anchor_time,
                    gfs_anchor_valid_time=gfs_anchor_item.valid_time_start,
                    gfs_target_valid_time=target_time,
                )
            except EstimateContractError as e:
                logger.error(f"[Pipeline Scheduler] Skipped invalid ICON {layer} estimate @{target_time.isoformat()}: {e}")
                continue
            if not est:
                continue
            # Relabel: the estimator stamps EURO/euro_* — this product's identity is ICON.
            est.model = "ICON"
            basis = est.estimate_basis or {}
            basis["type"] = "icon_persistence_gfs_blend"
            basis["persistence_anchor_product_id"] = basis.pop("euro_anchor_product_id", None)
            basis["persistence_anchor_valid_time"] = basis.pop("euro_anchor_valid_time", None)
            est.estimate_basis = basis
            products_to_save.append((est, float(getattr(anchor_item, "resolution", 10.0) or 10.0)))

    total = 0
    if products_to_save:
        try:
            total = await asyncio.to_thread(scheduler.store.save_products_batch, products_to_save)
        except Exception as e:
            logger.error(f"[Pipeline Scheduler] ICON marine extended-estimate batch save failed: {e}", exc_info=True)
    logger.info(f"[Pipeline Scheduler] ICON Marine Extended Estimate job completed. Saved {total} estimated product files.")
    return total > 0
