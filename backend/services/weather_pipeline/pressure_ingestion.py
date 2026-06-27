import logging
import os
from datetime import datetime, timezone, timedelta
from services.weather_pipeline.scheduler_helpers import (
    get_env_flags,
    generate_mock_pressure_results,
    normalize_and_save_loop,
    REGIONAL_CONFIGS
)

logger = logging.getLogger(__name__)

async def ingest_gfs_pressure_pilot_impl(scheduler) -> bool:
    """GFS pressure pilot ingestion."""
    logger.info("[Pipeline Scheduler] Starting GFS Pressure Pilot ingestion job...")
    env = get_env_flags()
    region = REGIONAL_CONFIGS["florida_east_coast"]
    resolution = scheduler._get_resolution(region, env["is_render"])

    results = await scheduler._fetch_or_mock(
        "GFS", "weather", "pressure", region, resolution, 2,
        env["is_test_env"],
        lambda: generate_mock_pressure_results(scheduler.om_provider, region, resolution),
        "florida_east_coast"
    )
    if not results:
        return False

    run_time = datetime.now(timezone.utc)
    count = await normalize_and_save_loop(
        scheduler.normalizer, scheduler.store, results,
        model="GFS", provider="open-meteo", domain="weather", layer="pressure",
        bbox=region, resolution=resolution, run_time=run_time,
        is_test_env=env["is_test_env"],
        log_prefix="[Pipeline Scheduler] GFS pressure"
    )
    await scheduler._cleanup_and_pause(results, 0)
    logger.info(f"[Pipeline Scheduler] GFS Pressure Ingestion Job done! Saved {count} hourly grid files.")
    return count > 0


async def ingest_icon_pressure_pilot_impl(scheduler) -> bool:
    """ICON pressure pilot ingestion."""
    logger.info("[Pipeline Scheduler] Starting ICON Pressure Pilot ingestion job...")
    env = get_env_flags()
    region = REGIONAL_CONFIGS["florida_east_coast"]
    resolution = scheduler._get_resolution(region, env["is_render"])

    results = await scheduler._fetch_or_mock(
        "ICON", "weather", "pressure", region, resolution, 2,
        env["is_test_env"],
        lambda: generate_mock_pressure_results(scheduler.om_provider, region, resolution),
        "florida_east_coast"
    )
    if not results:
        return False

    run_time = datetime.now(timezone.utc)
    count = await normalize_and_save_loop(
        scheduler.normalizer, scheduler.store, results,
        model="ICON", provider="open-meteo", domain="weather", layer="pressure",
        bbox=region, resolution=resolution, run_time=run_time,
        is_test_env=env["is_test_env"],
        log_prefix="[Pipeline Scheduler] ICON pressure"
    )
    await scheduler._cleanup_and_pause(results, 0)
    logger.info(f"[Pipeline Scheduler] ICON Pressure Ingestion Job done! Saved {count} hourly grid files.")
    return count > 0


async def ingest_euro_pressure_pilot_impl(scheduler) -> bool:
    """EURO pressure pilot ingestion."""
    logger.info("[Pipeline Scheduler] Starting EURO Pressure Pilot ingestion job...")
    env = get_env_flags()
    region = REGIONAL_CONFIGS["florida_east_coast"]
    resolution = scheduler._get_resolution(region, env["is_render"])

    results = await scheduler._fetch_or_mock(
        "EURO", "weather", "pressure", region, resolution, 2,
        env["is_test_env"],
        lambda: generate_mock_pressure_results(scheduler.om_provider, region, resolution),
        "florida_east_coast"
    )
    if not results:
        return False

    run_time = datetime.now(timezone.utc)
    count = await normalize_and_save_loop(
        scheduler.normalizer, scheduler.store, results,
        model="EURO", provider="open-meteo", domain="weather", layer="pressure",
        bbox=region, resolution=resolution, run_time=run_time,
        is_test_env=env["is_test_env"],
        log_prefix="[Pipeline Scheduler] EURO pressure"
    )
    await scheduler._cleanup_and_pause(results, 0)
    logger.info(f"[Pipeline Scheduler] EURO Pressure Ingestion Job done! Saved {count} hourly grid files.")
    return count > 0


async def ingest_gfs_pressure_global_impl(scheduler) -> bool:
    """GFS global coarse pressure ingestion."""
    logger.info("[Pipeline Scheduler] Starting GFS Pressure Global Coarse Ingestion job...")
    env = get_env_flags()
    run_time = datetime.now(timezone.utc)

    global_region = {
        "west": -180.0,
        "south": -80.0,
        "east": 180.0,
        "north": 85.0
    }
    resolution = 10.0

    forecast_days = 2 if env["is_test_env"] else 16

    # ══ PRIMARY: native GFS MSL pressure direct from NOAA (AWS Open Data, byte-range PRMSL) ══
    # Off open-meteo (frees budget), same GFS model. Provider stays 'open-meteo' below so the manifest
    # (source_dataset='gfs_seamless') is byte-identical — zero regression. NOAA is 3-hourly (step=1) vs
    # open-meteo hourly (step=3). NOAA failed -> open-meteo fallback. Kill switch GFS_PRESSURE_NOAA_DIRECT=0.
    noaa_direct = os.environ.get("GFS_PRESSURE_NOAA_DIRECT", "1") != "0"
    results = None
    from_noaa = False
    if noaa_direct:
        try:
            from services.noaa_pressure_service import fetch_gfs_pressure_global_coarse
            results = await fetch_gfs_pressure_global_coarse(global_region, resolution, forecast_days)
            if results:
                from_noaa = True
                logger.info(f"[Pipeline Scheduler] GFS pressure NOAA-direct OK: {len(results)} points (off open-meteo).")
        except Exception as _ne:
            logger.error(f"[Pipeline Scheduler] GFS pressure NOAA-direct fetch errored: {_ne}")

    if not results:
        if noaa_direct:
            logger.warning("[Pipeline Scheduler] GFS pressure NOAA-direct unavailable; falling back to open-meteo.")
        results = await scheduler._fetch_or_mock(
            "GFS", "weather", "pressure", global_region, resolution, forecast_days,
            env["is_test_env"],
            lambda: generate_mock_pressure_results(scheduler.om_provider, global_region, resolution),
            "global_coarse"
        )
    if not results:
        return False

    save_step = 1 if from_noaa else 3
    count = await normalize_and_save_loop(
        scheduler.normalizer, scheduler.store, results,
        model="GFS", provider="open-meteo", domain="weather", layer="pressure",
        bbox=global_region, resolution=resolution, run_time=run_time,
        region_id="global_coarse", coverage_mode="global_tile",
        is_test_env=env["is_test_env"], step=save_step,
        log_prefix="[Pipeline Scheduler] GFS pressure global_coarse"
    )
    logger.info(f"[Pipeline Scheduler] Ingested {count} GFS Pressure global coarse grid files.")
    if count > 0:
        scheduler.store.prune_superseded_products("GFS", "weather", "pressure", "global_coarse", run_time)
    await scheduler._cleanup_and_pause(results, 0)
    return count > 0


async def ingest_icon_pressure_global_impl(scheduler) -> bool:
    """ICON global coarse pressure ingestion."""
    logger.info("[Pipeline Scheduler] Starting ICON Pressure Global Coarse Ingestion job...")
    env = get_env_flags()
    run_time = datetime.now(timezone.utc)

    global_region = {
        "west": -180.0,
        "south": -80.0,
        "east": 180.0,
        "north": 85.0
    }
    resolution = 10.0

    results = await scheduler._fetch_or_mock(
        "ICON", "weather", "pressure", global_region, resolution, 5,
        env["is_test_env"],
        lambda: generate_mock_pressure_results(scheduler.om_provider, global_region, resolution),
        "global_coarse"
    )

    if results:
        is_mock_fixture = any(getattr(item, "is_test_fixture", False) or item.get("is_test_fixture") for item in results if isinstance(item, dict))
        if not is_mock_fixture:
            base_date = run_time.replace(hour=0, minute=0, second=0, microsecond=0)
            for item in results:
                if "hourly" in item and "time" in item["hourly"]:
                    orig_pressure = item["hourly"].get("pressure_msl", [])
                    
                    valid_len = len(orig_pressure)
                    for i in range(len(orig_pressure) - 1, -1, -1):
                        p_val = orig_pressure[i] if i < len(orig_pressure) else None
                        if p_val is None:
                            valid_len = i
                        else:
                            break
                    
                    if valid_len > 0:
                        valid_len = (valid_len // 24) * 24
                    
                    if valid_len > 0:
                        orig_pressure = orig_pressure[:valid_len]
                    
                    new_times = []
                    new_pressure = []
                    
                    for hour_idx in range(14 * 24):
                        new_time = (base_date + timedelta(hours=hour_idx)).strftime("%Y-%m-%dT%H:%M")
                        new_times.append(new_time)
                        
                        if orig_pressure:
                            new_pressure.append(orig_pressure[hour_idx % len(orig_pressure)])
                            
                    item["hourly"]["time"] = new_times
                    item["hourly"]["pressure_msl"] = new_pressure

    if not results:
        return False

    icon_estimate_basis = {
        "type": "icon_loop_extrapolation",
        "native_horizon_hours": 120,
        "method": "diurnal_cycle_loop",
        "source_model": "dwd_icon"
    }

    count = await normalize_and_save_loop(
        scheduler.normalizer, scheduler.store, results,
        model="ICON", provider="open-meteo", domain="weather", layer="pressure",
        bbox=global_region, resolution=resolution, run_time=run_time,
        region_id="global_coarse", coverage_mode="global_tile",
        is_test_env=env["is_test_env"],
        log_prefix="[Pipeline Scheduler] ICON pressure global_coarse",
        estimated_after_index=120,
        estimate_basis=icon_estimate_basis
    )
    logger.info(f"[Pipeline Scheduler] Ingested {count} ICON Pressure global coarse grid files (native <=120h, estimated >120h).")
    if count > 0:
        scheduler.store.prune_superseded_products("ICON", "weather", "pressure", "global_coarse", run_time)
    await scheduler._cleanup_and_pause(results, 0)
    return count > 0


async def ingest_euro_pressure_global_impl(scheduler) -> bool:
    """EURO global coarse pressure ingestion."""
    logger.info("[Pipeline Scheduler] Starting EURO Pressure Global Coarse Ingestion job...")
    env = get_env_flags()
    run_time = datetime.now(timezone.utc)

    global_region = {
        "west": -180.0,
        "south": -80.0,
        "east": 180.0,
        "north": 85.0
    }
    resolution = 10.0

    forecast_days = 2 if env["is_test_env"] else 14
    results = await scheduler._fetch_or_mock(
        "EURO", "weather", "pressure", global_region, resolution, forecast_days,
        env["is_test_env"],
        lambda: generate_mock_pressure_results(scheduler.om_provider, global_region, resolution),
        "global_coarse"
    )
    if not results:
        return False

    count = await normalize_and_save_loop(
        scheduler.normalizer, scheduler.store, results,
        model="EURO", provider="open-meteo", domain="weather", layer="pressure",
        bbox=global_region, resolution=resolution, run_time=run_time,
        region_id="global_coarse", coverage_mode="global_tile",
        is_test_env=env["is_test_env"],
        log_prefix="[Pipeline Scheduler] EURO pressure global_coarse"
    )
    logger.info(f"[Pipeline Scheduler] Ingested {count} EURO Pressure global coarse grid files.")
    if count > 0:
        scheduler.store.prune_superseded_products("EURO", "weather", "pressure", "global_coarse", run_time)
    await scheduler._cleanup_and_pause(results, 0)
    return count > 0
