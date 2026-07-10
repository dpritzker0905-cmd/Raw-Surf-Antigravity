"""EURO wind 240->336h pre-baked tail (strategy slice 1, 2026-07-10 late).

ECMWF open-data ends at 240h; every EURO wind request beyond it fell to the on-demand dynamic
build, whose EURO->GFS fallback fetches GFS live and relabels it (grid_resolver.py ~:430,
b0655047) — a per-request upstream fetch on the 1-CPU box. This bakes the SAME contract on the
runner: clone the already-stored GFS wind global products beyond the EURO native max, relabel
model=EURO / provider=gfs_fallback / is_estimated=True (byte-for-byte the labels the live
fallback serves — pre-baking changes WHERE the work happens, never WHAT is served), and save
them valid-time-keyed (_estimated suffix -> overwrite-in-place across cycles = cf0b4b23
continuity). The resolver serves stored products before any dynamic build, so far-hour EURO
wind becomes instant. No upstream fetches here at all — raw-results reuse across jobs is the
premise that died in audit finding #15, so this reads ONLY the store.

Kill switch: EURO_WIND_EXTEND=0.
"""
import os
import asyncio
import logging
from datetime import timedelta

logger = logging.getLogger(__name__)

# Contract ceiling (14d); matches capabilities max_forecast_hours for EURO wind.
_EXT_CEILING_HOURS = 336
# Tail cadence: 3-hourly, matching the ICON extended tail and the far-horizon scrub granularity.
_TAIL_STEP_HOURS = 3


async def extend_euro_wind_from_gfs(scheduler, run_time, euro_native_max) -> int:
    """Save EURO-labeled gfs_fallback clones for hours in (euro_native_max, run+336h].
    Returns the number of products saved. Never raises past its own boundary — callers treat
    failure as 'natives unaffected'."""
    if os.environ.get("EURO_WIND_EXTEND", "1") == "0":
        return 0
    if not euro_native_max or not run_time:
        return 0
    ceiling = run_time + timedelta(hours=_EXT_CEILING_HOURS)
    if euro_native_max >= ceiling:
        return 0

    manifest = await asyncio.to_thread(scheduler.store.get_manifest)
    by_valid_time = {}
    for p in manifest.products:
        if (
            p.model == "GFS"
            and p.domain == "wind"
            and p.layer == "wind"
            and p.region_id == "global_coarse"
            and not p.is_estimated
            and p.valid_time_start > euro_native_max
            and p.valid_time_start <= ceiling
            and p.valid_time_start.hour % _TAIL_STEP_HOURS == 0
        ):
            # One source per valid_time (manifest dedup already guarantees uniqueness per
            # provider/region slice; the dict guards against any historical double entry).
            by_valid_time[p.valid_time_start] = p

    if not by_valid_time:
        logger.info("[Pipeline Scheduler] EURO wind tail: no GFS global_coarse sources beyond "
                    f"{euro_native_max.isoformat()} — skipping (GFS job may not have run yet this cycle).")
        return 0

    basis_native_h = None
    try:
        basis_native_h = int((euro_native_max - run_time).total_seconds() // 3600)
    except Exception:
        pass
    estimate_basis = {
        "type": "gfs_wind_fallback",
        "method": "gfs_relabel_prebake",
        "source_model": "gfs_seamless",
        "native_horizon_hours": basis_native_h if basis_native_h is not None else 240,
    }

    products_to_save = []
    for valid_time in sorted(by_valid_time):
        item = by_valid_time[valid_time]
        gfs = await asyncio.to_thread(scheduler.store.load_product, item.filename)
        if not gfs or not gfs.grid or not gfs.grid.vectors:
            continue
        clone = gfs.model_copy()
        clone.model = "EURO"
        clone.provider = "gfs_fallback"
        clone.is_estimated = True
        clone.is_forecast_authoritative = False
        clone.estimate_basis = dict(estimate_basis)
        clone.run_time = run_time
        clone.product_id = None  # save_product derives the _estimated valid-time-keyed filename
        products_to_save.append((clone, float(getattr(item, "resolution", 10.0) or 10.0)))

    if not products_to_save:
        return 0
    saved = await asyncio.to_thread(scheduler.store.save_products_batch, products_to_save)
    return saved or 0
