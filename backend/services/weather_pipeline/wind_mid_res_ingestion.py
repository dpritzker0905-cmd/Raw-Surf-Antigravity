"""
wind_mid_res_ingestion.py

MID-RESOLUTION (~2°) global WIND ingestion — the wind sibling of marine_mid_res_ingestion
(2026-07-20, "the overlay needs to be global"). These jobs precompute a 2° world wind product
per model (region_id 'global_mid'); mid_res_tier's Step 3.6 serves it CLIPPED at any span and
WHOLE for world-span requests, so the client's global base becomes a 2° field instead of the
629-vector 10° coarse — the fixed-resolution world field (Windy/nullschool pattern) that makes
a visible clamp edge structurally impossible at every zoom.

Extracted from wind_ingestion.py at birth (the 800-LOC governance ceiling — same reason
marine_mid_res_ingestion.py exists). Provenance mirrors each model's coarse sibling exactly.

Sourcing: GFS = NOAA NOMADS byte-range GRIB2 (quota-free; open-meteo fallback). ICON = DWD
icosahedral GRIB, EURO = ECMWF Open Data IFS — both NATIVE-ONLY by design: on native failure
the cycle is skipped, because the 10° coarse jobs own outage continuity with their
estimation/cyclic-fill machinery, and a stale/estimated mid would just double-label the same
estimate. Kills: {GFS,ICON,EURO}_WIND_MID_RES_INGEST=0 (registration sites in
scheduler/forecast.py).
"""
import os
import logging
from datetime import datetime, timezone

from services.weather_pipeline.scheduler_helpers import (
    get_env_flags,
    generate_mock_wind_results,
    normalize_and_save_loop,
)
from services.weather_pipeline.wind_ingestion import (
    _WIND_GLOBAL_FORECAST_DAYS,
    _WIND_GLOBAL_BATCH_SIZE,
)

logger = logging.getLogger(__name__)

_GLOBAL_REGION = {"west": -180.0, "south": -80.0, "east": 180.0, "north": 85.0}


async def ingest_gfs_wind_global_mid_impl(scheduler) -> bool:
    """MID-RES (~2°) global GFS wind — NOAA-direct primary (quota-free NOMADS: this tier can
    never rate-limit); open-meteo fallback; no forecast_cache lane (see module docstring).
    Kill switch: GFS_WIND_MID_RES_INGEST=0."""
    logger.info("[Pipeline Scheduler] Starting GFS Wind Global MID-RES Ingestion job...")
    env = get_env_flags()
    run_time = datetime.now(timezone.utc)
    resolution = float(os.environ.get("GFS_WIND_MID_RES", "2.0"))
    # Horizon MIRRORS the coarse sibling (the forecast timeline must not change resolution
    # mid-scrub — the marine mid lesson, 2026-07-05).
    forecast_days = int(os.environ.get(
        "GFS_WIND_MID_RES_FORECAST_DAYS", "2" if env["is_test_env"] else str(_WIND_GLOBAL_FORECAST_DAYS)))

    noaa_direct = os.environ.get("GFS_WIND_NOAA_DIRECT", "1") != "0"
    results = None
    from_noaa = False
    if noaa_direct:
        try:
            from services.noaa_wind_service import fetch_gfs_wind_global_coarse
            results = await fetch_gfs_wind_global_coarse(_GLOBAL_REGION, resolution, forecast_days)
            if results:
                from_noaa = True
                logger.info(f"[Pipeline Scheduler] GFS wind mid-res NOAA-direct OK: {len(results)} points.")
        except Exception as _ne:
            logger.error(f"[Pipeline Scheduler] GFS wind mid-res NOAA-direct fetch errored: {_ne}")

    if not results:
        if noaa_direct:
            logger.warning("[Pipeline Scheduler] GFS wind mid-res NOAA-direct unavailable; falling back to open-meteo.")
        results = await scheduler._fetch_or_mock(
            "GFS", "wind", "wind", _GLOBAL_REGION, resolution, forecast_days,
            False,
            lambda: generate_mock_wind_results(scheduler.om_provider, _GLOBAL_REGION, resolution, forecast_days=2),
            "global_mid",
            batch_size=_WIND_GLOBAL_BATCH_SIZE
        )
    if not results:
        logger.warning("[Pipeline Scheduler] GFS wind global_mid fetch failed this cycle.")
        return False

    save_step = 1 if from_noaa else 3
    count = await normalize_and_save_loop(
        scheduler.normalizer, scheduler.store, results,
        model="GFS", provider="open-meteo", domain="wind", layer="wind",
        bbox=_GLOBAL_REGION, resolution=resolution, run_time=run_time,
        region_id="global_mid", coverage_mode="global_tile",
        is_test_env=env["is_test_env"], step=save_step,
        log_prefix="[Pipeline Scheduler] GFS wind global_mid",
    )
    logger.info(f"[Pipeline Scheduler] Ingested {count} GFS Wind global mid grid files.")
    if count > 0:
        scheduler.store.prune_superseded_products("GFS", "wind", "wind", "global_mid", run_time)
    await scheduler._cleanup_and_pause(results, 0)
    return count > 0


async def ingest_icon_wind_global_mid_impl(scheduler) -> bool:
    """MID-RES (~2°) global ICON wind — NATIVE-DIRECT ONLY (DWD icosahedral GRIB).
    Kill switch: ICON_WIND_MID_RES_INGEST=0."""
    logger.info("[Pipeline Scheduler] Starting ICON Wind Global MID-RES Ingestion job...")
    env = get_env_flags()
    run_time = datetime.now(timezone.utc)
    resolution = float(os.environ.get("ICON_WIND_MID_RES", "2.0"))
    forecast_days = int(os.environ.get("ICON_WIND_MID_RES_FORECAST_DAYS", "2" if env["is_test_env"] else "8"))

    if os.environ.get("ICON_WIND_DWD_DIRECT", "1") == "0":
        logger.info("[Pipeline Scheduler] ICON wind mid-res skipped (DWD-direct disabled; native-only tier).")
        return False
    results = None
    try:
        from services.dwd_wind_service import fetch_icon_wind_global_coarse
        results = await fetch_icon_wind_global_coarse(_GLOBAL_REGION, resolution, forecast_days)
    except Exception as _de:
        logger.error(f"[Pipeline Scheduler] ICON wind mid-res DWD-direct fetch errored: {_de}")
    if not results:
        logger.warning("[Pipeline Scheduler] ICON wind global_mid fetch failed this cycle (native-only tier).")
        return False

    count = await normalize_and_save_loop(
        scheduler.normalizer, scheduler.store, results,
        model="ICON", provider="open-meteo", domain="wind", layer="wind",
        bbox=_GLOBAL_REGION, resolution=resolution, run_time=run_time,
        region_id="global_mid", coverage_mode="global_tile",
        is_test_env=env["is_test_env"], step=1,
        log_prefix="[Pipeline Scheduler] ICON wind global_mid",
    )
    logger.info(f"[Pipeline Scheduler] Ingested {count} ICON Wind global mid grid files.")
    if count > 0:
        scheduler.store.prune_superseded_products("ICON", "wind", "wind", "global_mid", run_time)
    await scheduler._cleanup_and_pause(results, 0)
    return count > 0


async def ingest_euro_wind_global_mid_impl(scheduler) -> bool:
    """MID-RES (~2°) global EURO wind — NATIVE-DIRECT ONLY (ECMWF Open Data IFS, authoritative
    <=240h). Kill switch: EURO_WIND_MID_RES_INGEST=0."""
    logger.info("[Pipeline Scheduler] Starting EURO Wind Global MID-RES Ingestion job...")
    env = get_env_flags()
    run_time = datetime.now(timezone.utc)
    resolution = float(os.environ.get("EURO_WIND_MID_RES", "2.0"))
    forecast_days = int(os.environ.get("EURO_WIND_MID_RES_FORECAST_DAYS", "2" if env["is_test_env"] else "10"))

    if os.environ.get("EURO_WIND_ECMWF_DIRECT", "1") == "0":
        logger.info("[Pipeline Scheduler] EURO wind mid-res skipped (ECMWF-direct disabled; native-only tier).")
        return False
    results = None
    try:
        from services.ecmwf_wind_service import fetch_euro_wind_global_coarse
        results = await fetch_euro_wind_global_coarse(_GLOBAL_REGION, resolution, min(forecast_days, 10))
    except Exception as _ee:
        logger.error(f"[Pipeline Scheduler] EURO wind mid-res ECMWF-direct fetch errored: {_ee}")
    if not results:
        logger.warning("[Pipeline Scheduler] EURO wind global_mid fetch failed this cycle (native-only tier).")
        return False

    count = await normalize_and_save_loop(
        scheduler.normalizer, scheduler.store, results,
        model="EURO", provider="open-meteo", domain="wind", layer="wind",
        bbox=_GLOBAL_REGION, resolution=resolution, run_time=run_time,
        region_id="global_mid", coverage_mode="global_tile",
        is_test_env=env["is_test_env"], step=1,
        log_prefix="[Pipeline Scheduler] EURO wind global_mid",
    )
    logger.info(f"[Pipeline Scheduler] Ingested {count} EURO Wind global mid grid files.")
    if count > 0:
        scheduler.store.prune_superseded_products("EURO", "wind", "wind", "global_mid", run_time)
    await scheduler._cleanup_and_pause(results, 0)
    return count > 0
