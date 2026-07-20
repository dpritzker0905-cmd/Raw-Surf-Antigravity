"""ICON marine >168h pre-baked estimates (strategy slice 1 second half, 2026-07-11).

GWAM (DWD's wave model) ends at 168h; the 168-336h window was synthesized CLIENT-side per
viewport per hour by fetchBackendMarineGridIconExtended — persistence(ICON@168) + GFS trend,
THREE /grid requests per far hour. The math is byte-identical to the backend estimator's
no-third-model path (get_estimate_weights is_icon_valid=False), so this bakes it on the runner
by calling estimate_euro_grid with the ICON anchor in the persistence slot and relabeling the
output (model=ICON, basis icon_persistence_gfs_blend). estimator.py is UNTOUCHED — the EURO
lane's machinery is load-bearing and this wrapper only remaps labels on the returned product.

TIERS (2026-07-15, Phase 2): the tail is baked for BOTH global_coarse (10°) AND global_mid (~2°).
Originally global_coarse only — which left ICON's 7→14d tail on the 9.73° coarse lattice while
EURO's tail already carried a global_mid variant, so the resolver served ICON at 9.73° past 168h
even at a coastal/mid zoom (curl-proven 2026-07-15: ICON day-8..14 = global_coarse estimated, while
EURO = global_mid estimated). ICON has native global_mid anchors (icon_marine_waves_global_mid,
dwd_gwam, ICON_MARINE_MID_RES_INGEST default-ON) and GFS global_mid targets reach 14d, so the mid
tail anchors ICON-mid + GFS-mid → served at ~1.75° instead of 9.73° (a ~5.5× resolution lift), still
honestly labelled is_estimated. The mid tier is a NO-OP when ICON native mid anchors are absent
(empty pool → skip). The client blend demotes to FALLBACK automatically — the resolver serves
stored products first (the fc0ec396/e1adb799 pattern). copernicus_validator early-returns for
non-EURO models, so no whitelist change is needed (verified 2026-07-11).

Kill switches: ICON_MARINE_EXTEND=0 (whole job); ICON_MARINE_EXTEND_MID=0 (mid tier only, keeps coarse).
"""
import os
import asyncio
import logging
from datetime import timedelta

logger = logging.getLogger(__name__)

ICON_NATIVE_LIMIT_HOURS = 168.0
_CEILING_HOURS = 336.0
_LAYERS = ("waves", "swell_1", "wind_waves")  # GWAM's native set; swell_2 stays a client blend


def _gfs_regions_for(tier):
    """The manifest region_ids that belong to a global TIER. global_coarse products were historically
    also stamped 'global'/None; global_mid is strict."""
    return ("global_coarse", "global", None) if tier == "global_coarse" else (tier,)


def _region_tiers():
    """Global tiers whose 168→336h ICON tail we pre-bake. global_coarse (10°) is always extended;
    global_mid (~2°) added 2026-07-15 (Phase 2) — a NO-OP until ICON native mid anchors exist. Kill
    the mid tier alone (e.g. cron-budget pressure) with ICON_MARINE_EXTEND_MID=0."""
    tiers = ["global_coarse"]
    if os.environ.get("ICON_MARINE_EXTEND_MID", "1") != "0":
        tiers.append("global_mid")
    return tiers


def _icon_anchor_item(products, layer, tier):
    """Last NATIVE ICON marine product for the given global tier lane."""
    ok = _gfs_regions_for(tier)
    pool = [
        p for p in products
        if p.model == "ICON" and p.domain == "marine" and p.layer == layer
        and p.region_id in ok and not p.is_estimated
    ]
    return max(pool, key=lambda p: p.valid_time_start) if pool else None


async def ingest_icon_marine_extended_estimates_impl(scheduler) -> bool:
    if os.environ.get("ICON_MARINE_EXTEND", "1") == "0":
        return False
    from services.weather_pipeline.estimator import estimate_euro_grid, EstimateContractError
    from services.weather_pipeline.scheduler_helpers import find_nearest_manifest_product

    manifest = await asyncio.to_thread(scheduler.store.get_manifest)
    products_to_save = []

    for tier in _region_tiers():
        gfs_regions = _gfs_regions_for(tier)
        for layer in _LAYERS:
            anchor_item = _icon_anchor_item(manifest.products, layer, tier)
            if not anchor_item:
                logger.info(f"[Pipeline Scheduler] No ICON marine {layer} anchor for {tier}. Skipping layer.")
                continue
            anchor_time = anchor_item.valid_time_start
            icon_anchor = await asyncio.to_thread(scheduler.store.load_product, anchor_item.filename)
            if not icon_anchor:
                continue

            gfs_anchor_item = find_nearest_manifest_product(
                manifest, "GFS", "marine", layer, tier, anchor_time, max_delta_hours=3.0
            )
            if not gfs_anchor_item:
                logger.warning(f"[Pipeline Scheduler] No GFS anchor near {anchor_time.isoformat()} for ICON {layer} {tier} ext. Skipping layer.")
                continue
            gfs_anchor = await asyncio.to_thread(scheduler.store.load_product, gfs_anchor_item.filename)
            if not gfs_anchor:
                continue

            run_time = getattr(icon_anchor, "run_time", None) or anchor_time
            ceiling = run_time + timedelta(hours=_CEILING_HOURS)
            gfs_targets = sorted(
                (p for p in manifest.products
                 if p.model == "GFS" and p.domain == "marine" and p.layer == layer
                 and p.region_id in gfs_regions and not p.is_estimated
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
                    logger.error(f"[Pipeline Scheduler] Skipped invalid ICON {layer} {tier} estimate @{target_time.isoformat()}: {e}")
                    continue
                except Exception as e:
                    # Same isolation as the EURO job (2026-07-20 UnboundLocalError class): one bad
                    # target must not kill the batch save of everything already generated.
                    logger.error(
                        f"[Pipeline Scheduler] Unexpected ICON {layer} {tier} estimate failure "
                        f"@{target_time.isoformat()}: {type(e).__name__}: {e}", exc_info=True
                    )
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
                # resolution tag rides the anchor tier: ~10° for coarse, ~2° for mid (drives the serve tier)
                products_to_save.append((est, float(getattr(anchor_item, "resolution", 10.0) or 10.0)))

    total = 0
    if products_to_save:
        try:
            total = await asyncio.to_thread(scheduler.store.save_products_batch, products_to_save)
        except Exception as e:
            logger.error(f"[Pipeline Scheduler] ICON marine extended-estimate batch save failed: {e}", exc_info=True)
    logger.info(f"[Pipeline Scheduler] ICON Marine Extended Estimate job completed. Saved {total} estimated product files.")
    return total > 0
