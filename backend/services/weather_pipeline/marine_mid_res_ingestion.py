"""
marine_mid_res_ingestion.py

MID-RESOLUTION global marine ingestion — the z6-7 quality tier (2026-07-05). Between the close-zoom
regional 0.25° tiles and the 10° global_coarse there was a resolution cliff: a z6-7 viewport (span
2-15°) WIDER than any regional tile fell to the 10° global — at an ~8° viewport that's <1 cell across
the screen, so every crest shares one direction (uniform "grid" lattice) and the heatmap is one flat
cell. These jobs pre-compute a finer (~2°, {GFS,ICON,EURO}_MID_RES) global product per marine provider,
saved under region_id 'global_mid'; grid_resolver's Step 3.6 serves it CLIPPED to the viewport so the
client renders it as a regional-quality fine grid.

Extracted from scheduler.py (thin `ingest_*_global_mid` wrappers delegate here) to keep that file under
the 800-LOC ceiling — same pattern as pressure_ingestion / wind_ingestion. Provenance MIRRORS the coarse
siblings exactly (native GFS ncep_gfswave025 / native ICON dwd_gwam / native CMEMS for EURO's primary
horizon) so the normalizer derives is_estimated/source_dataset unchanged — real-vs-estimated truth is
preserved, nothing relabeled.
"""
import os
import logging
from datetime import datetime, timezone

from services.weather_pipeline.scheduler_helpers import (
    get_env_flags,
    generate_mock_marine_results,
    generate_mock_icon_marine_results,
    normalize_and_save_loop,
)

logger = logging.getLogger(__name__)

_GLOBAL_REGION = {"west": -180.0, "south": -80.0, "east": 180.0, "north": 85.0}


async def ingest_gfs_marine_global_mid_impl(scheduler) -> bool:
    """MID-RES global GFS/NOAA waves — same NOAA-direct GFS-Wave path as the coarse sibling, only a finer
    resolution (GFS_MID_RES, default 2°). Kill switch: GFS_MARINE_MID_RES_INGEST=0 (registration site)."""
    logger.info("[Pipeline Scheduler] Starting GFS Marine Global MID-RES Ingestion job...")
    env = get_env_flags()
    run_time = datetime.now(timezone.utc)
    total_saved = 0
    resolution = float(os.environ.get("GFS_MID_RES", "2.0"))
    # 14 days (was 10) MIRRORS ingest_gfs_marine_global's horizon (GFS_GLOBAL_FORECAST_DAYS=14): the
    # forecast timeline must not change resolution mid-scrub. This also FEEDS the blend mirror — the
    # frontend's ICON >168h and ICON swell_2 blends recursively fetch GFS component grids (which now
    # resolve to this mid product at z6-7), and the EURO extended-estimates machinery uses GFS
    # global_mid targets to build the EURO mid 240→336h estimated extension.
    forecast_days = int(os.environ.get("GFS_MID_RES_FORECAST_DAYS", "2" if env["is_test_env"] else "14"))

    noaa_direct = os.environ.get("GFS_MARINE_NOAA_DIRECT", "1") != "0"
    results = None
    from_noaa = False
    if noaa_direct:
        try:
            from services.noaa_marine_service import fetch_gfs_marine_global_coarse
            results = await fetch_gfs_marine_global_coarse(_GLOBAL_REGION, resolution, forecast_days)
            if results:
                from_noaa = True
                logger.info(f"[Pipeline Scheduler] GFS-Wave mid-res NOAA-direct OK: {len(results)} points.")
        except Exception as _ne:
            logger.error(f"[Pipeline Scheduler] GFS-Wave mid-res NOAA-direct fetch errored: {_ne}")

    if not results:
        results = await scheduler._fetch_or_mock(
            "GFS", "marine", "all_marine", _GLOBAL_REGION, resolution, forecast_days,
            env["is_test_env"],
            lambda: generate_mock_marine_results(scheduler.om_provider, _GLOBAL_REGION, resolution),
            "global_mid"
        )
    if not results:
        logger.error("[Pipeline Scheduler] GFS marine global_mid fetch failed. Skipping.")
        return False

    save_step = 1 if from_noaa else 3
    for layer in ["waves", "swell_1", "swell_2", "wind_waves"]:
        count = await normalize_and_save_loop(
            scheduler.normalizer, scheduler.store, results,
            model="GFS", provider="open-meteo", domain="marine", layer=layer,
            bbox=_GLOBAL_REGION, resolution=resolution, run_time=run_time,
            region_id="global_mid", coverage_mode="global_tile",
            is_test_env=env["is_test_env"], step=save_step,
            log_prefix=f"[Pipeline Scheduler] GFS {layer} global_mid"
        )
        logger.info(f"[Pipeline Scheduler] Ingested {count} GFS {layer} global mid-res grid files.")
        total_saved += count
        if count > 0:
            scheduler.store.prune_superseded_products("GFS", "marine", layer, "global_mid", run_time)

    await scheduler._cleanup_and_pause(results, 0)
    return total_saved > 0


async def ingest_icon_marine_global_mid_impl(scheduler) -> bool:
    """MID-RES global ICON/gwam waves — DWD-direct at ICON_MID_RES (default 2°). Mirror of the coarse
    ICON global (no swell_2). Kill switch: ICON_MARINE_MID_RES_INGEST=0 (registration site)."""
    logger.info("[Pipeline Scheduler] Starting ICON Marine Global MID-RES Ingestion job...")
    env = get_env_flags()
    run_time = datetime.now(timezone.utc)
    total_saved = 0
    resolution = float(os.environ.get("ICON_MID_RES", "2.0"))
    forecast_days = int(os.environ.get("ICON_MID_RES_FORECAST_DAYS", "2" if env["is_test_env"] else "7"))

    dwd_direct = os.environ.get("ICON_MARINE_DWD_DIRECT", "1") != "0"
    results = None
    from_dwd = False
    if dwd_direct:
        try:
            from services.dwd_marine_service import fetch_icon_marine_global_coarse
            results = await fetch_icon_marine_global_coarse(_GLOBAL_REGION, resolution, forecast_days)
            if results:
                from_dwd = True
                logger.info(f"[Pipeline Scheduler] ICON marine mid-res DWD-direct OK: {len(results)} points.")
        except Exception as _de:
            logger.error(f"[Pipeline Scheduler] ICON marine mid-res DWD-direct fetch errored: {_de}")

    if not results:
        results = await scheduler._fetch_or_mock(
            "ICON", "marine", "all_marine", _GLOBAL_REGION, resolution, forecast_days,
            env["is_test_env"],
            lambda: generate_mock_icon_marine_results(scheduler.om_provider, _GLOBAL_REGION, resolution),
            "global_mid"
        )
    if not results:
        logger.error("[Pipeline Scheduler] ICON marine global_mid fetch failed. Skipping.")
        return False

    save_step = 1 if from_dwd else 3
    for layer in ["waves", "swell_1", "wind_waves"]:
        count = await normalize_and_save_loop(
            scheduler.normalizer, scheduler.store, results,
            model="ICON", provider="open-meteo", domain="marine", layer=layer,
            bbox=_GLOBAL_REGION, resolution=resolution, run_time=run_time,
            region_id="global_mid", coverage_mode="global_tile",
            is_test_env=env["is_test_env"], step=save_step,
            log_prefix=f"[Pipeline Scheduler] ICON {layer} global_mid"
        )
        logger.info(f"[Pipeline Scheduler] Ingested {count} ICON {layer} global mid-res grid files.")
        total_saved += count
        if count > 0:
            scheduler.store.prune_superseded_products("ICON", "marine", layer, "global_mid", run_time)

    await scheduler._cleanup_and_pause(results, 0)
    return total_saved > 0


async def ingest_euro_marine_global_mid_impl(scheduler) -> bool:
    """MID-RES global EURO/Copernicus waves — CMEMS native at EURO_MID_RES (default 2°), PRIMARY horizon.
    The 240→336h ESTIMATED extension (the coarse sibling's blend mirror) is NOT built here: the
    region-parameterized ingest_euro_marine_extended_estimates job now includes region 'global_mid', so
    once these native anchors exist it generates the mid-res persistence+GFS/ICON-blend tail with honest
    estimate provenance — exactly the machinery the coarse products use. ⚠️ COST: a SECOND Copernicus
    fetch (~15-30 min) per cycle → default-OFF at the registration site (EURO_MARINE_MID_RES_INGEST);
    enable once the cron budget is confirmed."""
    logger.info("[Pipeline Scheduler] Starting EURO Marine Global MID-RES Ingestion job...")
    env = get_env_flags()
    run_time = datetime.now(timezone.utc)
    total_saved = 0
    resolution = float(os.environ.get("EURO_MID_RES", "2.0"))
    cop_days = int(os.environ.get("EURO_MID_RES_DAYS", "2" if env["is_test_env"] else "10"))
    _cop_basis = {"type": "copernicus_native_global_coarse", "method": "cmems_thin_band_subset",
                  "source_model": "ecmwf_wam_cmems_glo_0083"}

    cop_results = None
    try:
        from services.copernicus_marine_service import fetch_euro_marine_global_coarse
        cop_results = await fetch_euro_marine_global_coarse(_GLOBAL_REGION, resolution, cop_days)
    except Exception as _ce:
        logger.error(f"[Pipeline Scheduler] EURO Copernicus mid-res fetch errored: {_ce}")
    if not cop_results:
        logger.warning("[Pipeline Scheduler] EURO marine global_mid unavailable (Copernicus); skipping.")
        return False

    for layer in ["waves", "swell_1", "swell_2", "wind_waves"]:
        c = await normalize_and_save_loop(
            scheduler.normalizer, scheduler.store, cop_results,
            model="EURO", provider="copernicus", domain="marine", layer=layer,
            bbox=_GLOBAL_REGION, resolution=resolution, run_time=run_time,
            region_id="global_mid", coverage_mode="global_tile",
            is_test_env=env["is_test_env"], step=1,
            log_prefix=f"[Pipeline Scheduler] EURO {layer} (copernicus native) global_mid",
            estimate_basis=_cop_basis
        )
        logger.info(f"[Pipeline Scheduler] Ingested {c} EURO {layer} global mid-res grid files.")
        total_saved += c
        if c > 0:
            scheduler.store.prune_superseded_products("EURO", "marine", layer, "global_mid", run_time)

    await scheduler._cleanup_and_pause(cop_results, 0)
    return total_saved > 0
