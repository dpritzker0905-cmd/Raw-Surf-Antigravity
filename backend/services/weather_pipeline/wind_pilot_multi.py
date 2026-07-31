"""Multi-bbox single-download-pass for the regional WIND pilots (GFS / ICON / EURO).

Extracted from wind_ingestion.py 2026-07-31 (LOC gate) once all three models shared this path.

WHY IT EXISTS — the region ROTATION was rationing a cost that was never real. All three wind
upstreams have the SAME property: the bbox never reaches the wire.
  NOAA  byte-range selects a GRIB *message*, and a message is the whole global 0.25 deg field.
        Measured live on the 20260731 12Z cycle: UGRD 591,525 B + VGRD 572,474 B per step,
        BYTE-IDENTICAL for a 609-point Hawaii box and a 2,009-point uk_ireland box.
  DWD   publishes whole-globe files per (var, forecast hour) with no spatial byte-range.
  ECMWF ships one whole-globe multi-step file.
So a per-region pass re-downloads identical bytes, and WORLDWIDE_REGIONS_PER_CYCLE existed only to
bound that duplication. Bounding it by rotation is what starved Hawaii's wind to a 75 h-old run
behind a CURRENT valid_time, and uk_ireland / east_australia to 29.9 h.

Sampling every region out of each decoded field removes the cost instead of scheduling it: every
region refreshes EVERY fire (8 h max gap vs the 32 h floor of the best possible schedule), and
adding regions is free.
"""
import logging

from services.weather_pipeline.scheduler_helpers import (
    get_all_pilot_regions,
    normalize_and_save_loop,
)

logger = logging.getLogger(__name__)


async def save_wind_regional(scheduler, env, run_time, model, region_id, region,
                             results, save_step) -> int:
    """Save `results` as a regional_tile wind product + prune superseded. Shared by the multi-bbox
    and per-region pilot paths so the manifest shape is identical either way (mirrors
    _save_marine_regional in marine_mid_res_ingestion)."""
    resolution = float(region.get("resolution", 0.25))
    count = await normalize_and_save_loop(
        scheduler.normalizer, scheduler.store, results,
        model=model, provider="open-meteo", domain="wind", layer="wind",
        bbox=region, resolution=resolution, run_time=run_time,
        region_id=region_id, coverage_mode="regional_tile",
        is_test_env=env["is_test_env"], step=save_step,
        log_prefix=f"[Pipeline Scheduler] {model} wind {region_id}"
    )
    logger.info(f"[Pipeline Scheduler] Ingested {count} {model} Wind grid files for region {region_id}.")
    if count > 0:
        scheduler.store.prune_superseded_products(model, "wind", "wind", region_id, run_time)
    return count


async def multi_bbox_wind_pass(scheduler, env, run_time, model, fetch_regions,
                               forecast_days, save_step=1, timeout_s=1800) -> int:
    """ONE download pass covering EVERY pilot region, for one region's download cost.

    ⚠️ PORT ALL THREE MODELS OR NONE. Fixing GFS alone creates a refresh ASYMMETRY that does not
    exist today: GFS would cover 10 regions every fire while ICON/EURO cover 2, so at a starved pair
    GFS reads current and the other two read 30 h old. The obs gate grants Good/Epic only where >=2
    models agree, so that would cap ratings on a self-inflicted disagreement — the same shape already
    recorded for `valid_time` mismatch. Measured 2026-07-31 21:26Z, the 3-model wind spread at
    starved sites (2.7-3.0 kt) is NO worse than at fresh sites (1.5-3.6 kt), precisely because the
    three wind pilots run back-to-back in one job and rotate in LOCKSTEP. Today the staleness is
    symmetric; a partial port is what would make it an artifact.

    Returns products saved (0 => caller falls back to its per-region path).
    """
    regions_all = get_all_pilot_regions()
    multi = None
    try:
        multi = await fetch_regions(regions_all, 0.25, forecast_days, timeout_s=timeout_s)
    except Exception as _me:
        logger.error(f"[Pipeline Scheduler] {model} wind multi-region fetch errored: {_me}")
        return 0
    if not multi:
        logger.warning(f"[Pipeline Scheduler] {model} wind multi-region unavailable; "
                       "falling back to the per-region rotation path.")
        return 0

    logger.info(f"[Pipeline Scheduler] {model} wind multi-region OK: {len(multi)} regions in one pass.")
    saved = 0
    for region_id, results in multi.items():
        region = regions_all.get(region_id)
        if not region or not results:
            continue
        saved += await save_wind_regional(
            scheduler, env, run_time, model, region_id, region, results, save_step)
        await scheduler._cleanup_and_pause(results, 0)
    return saved
