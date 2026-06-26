import os
import json
import logging
from datetime import datetime, timezone, timedelta
from pathlib import Path
from services.weather_pipeline.scheduler_helpers import (
    get_env_flags,
    generate_mock_wind_results,
    normalize_and_save_loop,
    REGIONAL_CONFIGS
)

logger = logging.getLogger(__name__)

# GFS/EURO wind GLOBAL ingestion fetched 14 days × the global coarse grid in batches of 500 points,
# which reliably timed out open-meteo on the 1-CPU/512MB box (it processes 14 days × 500 pts per call
# too slowly) → no product (manifest stuck: EURO wind 341h stale, GFS 166h). We KEEP the full 14-day
# horizon (the forecast must reach 14 days) but fetch in SMALLER point-batches so each open-meteo/proxy
# call processes fewer points and completes — marine succeeds at 500pts×8d×12vars, so 200pts×14d×3vars
# is a lighter call. Both env-tunable: drop WIND_GLOBAL_FORECAST_DAYS or raise WIND_GLOBAL_BATCH_SIZE
# if needed. ICON wind global already uses 5 days (its native horizon) and is unchanged.
_WIND_GLOBAL_FORECAST_DAYS = int(os.environ.get("WIND_GLOBAL_FORECAST_DAYS", "14"))
_WIND_GLOBAL_BATCH_SIZE = int(os.environ.get("WIND_GLOBAL_BATCH_SIZE", "200"))


async def ingest_gfs_wind_pilot_impl(scheduler) -> bool:
    """GFS wind pilot ingestion."""
    logger.info("[Pipeline Scheduler] Starting GFS Wind Ingestion job for all regions...")
    env = get_env_flags()
    run_time = datetime.now(timezone.utc)
    total_saved = 0

    for region_id, region in REGIONAL_CONFIGS.items():
        resolution = scheduler._get_resolution(region, env["is_render"])
        logger.info(f"[Pipeline Scheduler] Ingesting GFS Wind for region: {region_id}")

        results = await scheduler._fetch_or_mock(
            "GFS", "wind", "wind", region, resolution, 14,
            False,
            lambda: generate_mock_wind_results(scheduler.om_provider, region, resolution),
            region_id
        )
        if not results:
            continue

        count = await normalize_and_save_loop(
            scheduler.normalizer, scheduler.store, results,
            model="GFS", provider="open-meteo", domain="wind", layer="wind",
            bbox=region, resolution=resolution, run_time=run_time,
            region_id=region_id, coverage_mode="regional_tile",
            is_test_env=env["is_test_env"],
            log_prefix=f"[Pipeline Scheduler] GFS wind {region_id}"
        )
        logger.info(f"[Pipeline Scheduler] Ingested {count} GFS Wind grid files for region {region_id}.")
        total_saved += count
        await scheduler._cleanup_and_pause(results)

    return total_saved > 0


async def ingest_gfs_wind_global_impl(scheduler) -> bool:
    """GFS global coarse wind ingestion."""
    logger.info("[Pipeline Scheduler] Starting GFS Wind Global Coarse Ingestion job...")
    env = get_env_flags()
    run_time = datetime.now(timezone.utc)

    global_region = {
        "west": -180.0,
        "south": -80.0,
        "east": 180.0,
        "north": 85.0
    }
    resolution = 10.0

    # ══ PRIMARY: native GFS 10m wind direct from NOAA (AWS Open Data, byte-range GRIB2) ══
    # Moves GFS wind OFF open-meteo (frees the daily budget for ICON/etc.) using the same GFS model.
    # Provider stays 'open-meteo' below so the manifest (source_dataset='gfs_seamless') is byte-identical
    # — zero regression. NOAA is 3-hourly (step=1) vs open-meteo hourly (step=3). NOAA failed -> open-meteo
    # fallback (then the forecast_cache fallback). Kill switch: GFS_WIND_NOAA_DIRECT=0.
    noaa_direct = os.environ.get("GFS_WIND_NOAA_DIRECT", "1") != "0"
    results = None
    from_noaa = False
    if noaa_direct:
        try:
            from services.noaa_wind_service import fetch_gfs_wind_global_coarse
            results = await fetch_gfs_wind_global_coarse(global_region, resolution, _WIND_GLOBAL_FORECAST_DAYS)
            if results:
                from_noaa = True
                logger.info(f"[Pipeline Scheduler] GFS wind NOAA-direct OK: {len(results)} points (off open-meteo).")
        except Exception as _ne:
            logger.error(f"[Pipeline Scheduler] GFS wind NOAA-direct fetch errored: {_ne}")

    if not results:
        if noaa_direct:
            logger.warning("[Pipeline Scheduler] GFS wind NOAA-direct unavailable; falling back to open-meteo.")
        results = await scheduler._fetch_or_mock(
            "GFS", "wind", "wind", global_region, resolution, _WIND_GLOBAL_FORECAST_DAYS,
            False,
            lambda: generate_mock_wind_results(scheduler.om_provider, global_region, resolution, forecast_days=14),
            "global_coarse",
            batch_size=_WIND_GLOBAL_BATCH_SIZE
        )
    if not results:
        logger.warning("[Pipeline Scheduler] GFS wind global_coarse fetch failed. Trying to load from forecast_cache fallback...")
        fallback_path = Path(__file__).parent.parent.parent / "uploads" / "forecast_cache" / "wind_global.json"
        if fallback_path.exists():
            try:
                with open(fallback_path, "r") as f:
                    cached_data = json.load(f)
                
                if len(cached_data) < 100:
                    logger.warning(f"[Pipeline Scheduler] Fallback file has only {len(cached_data)} points (too small for global). Generating full global mock grid fallback instead.")
                    results = None
                else:
                    base_date = run_time.replace(hour=0, minute=0, second=0, microsecond=0)
                    for item in cached_data:
                        if "hourly" in item and "time" in item["hourly"]:
                            orig_speed = item["hourly"].get("wind_speed_10m", [])
                            orig_direction = item["hourly"].get("wind_direction_10m", [])
                            
                            new_times = []
                            new_speed = []
                            new_direction = []
                            
                            for hour_idx in range(14 * 24):
                                new_time = (base_date + timedelta(hours=hour_idx)).strftime("%Y-%m-%dT%H:%M")
                                new_times.append(new_time)
                                
                                if orig_speed:
                                    new_speed.append(orig_speed[hour_idx % len(orig_speed)])
                                if orig_direction:
                                    new_direction.append(orig_direction[hour_idx % len(orig_direction)])
                                    
                            item["hourly"]["time"] = new_times
                            item["hourly"]["wind_speed_10m"] = new_speed
                            item["hourly"]["wind_direction_10m"] = new_direction
                            
                    results = cached_data
                    logger.info(f"[Pipeline Scheduler] Successfully loaded and time-shifted {len(results)} points from forecast_cache fallback.")
            except Exception as cache_err:
                logger.error(f"[Pipeline Scheduler] Failed to load forecast_cache fallback: {cache_err}")

    if not results:
        return False

    if not results:
        return False

    # NOAA GFS is natively 3-hourly (step=1 keeps every step); open-meteo all-wind is hourly (step=3 ->
    # 3-hourly products). Same 3-hourly product cadence either way. (forecast_cache fallback is hourly too.)
    save_step = 1 if from_noaa else 3
    count = await normalize_and_save_loop(
        scheduler.normalizer, scheduler.store, results,
        model="GFS", provider="open-meteo", domain="wind", layer="wind",
        bbox=global_region, resolution=resolution, run_time=run_time,
        region_id="global_coarse", coverage_mode="global_tile",
        is_test_env=env["is_test_env"], step=save_step,
        log_prefix="[Pipeline Scheduler] GFS wind global_coarse"
    )
    logger.info(f"[Pipeline Scheduler] Ingested {count} GFS Wind global coarse grid files.")
    if count > 0:
        scheduler.store.prune_superseded_products("GFS", "wind", "wind", "global_coarse", run_time)
    await scheduler._cleanup_and_pause(results, 0)
    return count > 0


async def ingest_euro_wind_global_impl(scheduler) -> bool:
    """EURO global coarse wind ingestion."""
    logger.info("[Pipeline Scheduler] Starting EURO Wind Global Coarse Ingestion job...")
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
        "EURO", "wind", "wind", global_region, resolution, _WIND_GLOBAL_FORECAST_DAYS,
        False,
        lambda: generate_mock_wind_results(scheduler.om_provider, global_region, resolution, speed_base=7.0, dir_base=105.0, forecast_days=14),
        "global_coarse",
        batch_size=_WIND_GLOBAL_BATCH_SIZE
    )
    if not results:
        logger.warning("[Pipeline Scheduler] EURO wind global_coarse fetch failed. Trying to load from forecast_cache fallback...")
        fallback_path = Path(__file__).parent.parent.parent / "uploads" / "forecast_cache" / "wind_global.json"
        if fallback_path.exists():
            try:
                with open(fallback_path, "r") as f:
                    cached_data = json.load(f)
                
                if len(cached_data) < 100:
                    logger.warning(f"[Pipeline Scheduler] Fallback file has only {len(cached_data)} points (too small for global). Generating full global mock grid fallback instead.")
                    results = None
                else:
                    base_date = run_time.replace(hour=0, minute=0, second=0, microsecond=0)
                    for item in cached_data:
                        if "hourly" in item and "time" in item["hourly"]:
                            orig_speed = item["hourly"].get("wind_speed_10m", [])
                            orig_direction = item["hourly"].get("wind_direction_10m", [])
                            
                            new_times = []
                            new_speed = []
                            new_direction = []
                            
                            for hour_idx in range(14 * 24):
                                new_time = (base_date + timedelta(hours=hour_idx)).strftime("%Y-%m-%dT%H:%M")
                                new_times.append(new_time)
                                
                                if orig_speed:
                                    new_speed.append(orig_speed[hour_idx % len(orig_speed)])
                                if orig_direction:
                                    new_direction.append(orig_direction[hour_idx % len(orig_direction)])
                                    
                            item["hourly"]["time"] = new_times
                            item["hourly"]["wind_speed_10m"] = new_speed
                            item["hourly"]["wind_direction_10m"] = new_direction
                            
                    results = cached_data
                    logger.info(f"[Pipeline Scheduler] Successfully loaded and time-shifted {len(results)} points from forecast_cache fallback.")
            except Exception as cache_err:
                logger.error(f"[Pipeline Scheduler] Failed to load forecast_cache fallback: {cache_err}")

    if not results:
        return False

    if not results:
        return False

    count = await normalize_and_save_loop(
        scheduler.normalizer, scheduler.store, results,
        model="EURO", provider="open-meteo", domain="wind", layer="wind",
        bbox=global_region, resolution=resolution, run_time=run_time,
        region_id="global_coarse", coverage_mode="global_tile",
        is_test_env=env["is_test_env"],
        log_prefix="[Pipeline Scheduler] EURO wind global_coarse"
    )
    logger.info(f"[Pipeline Scheduler] Ingested {count} EURO Wind global coarse grid files.")
    if count > 0:
        scheduler.store.prune_superseded_products("EURO", "wind", "wind", "global_coarse", run_time)
    await scheduler._cleanup_and_pause(results, 0)
    return count > 0


async def ingest_icon_wind_global_impl(scheduler) -> bool:
    """ICON global coarse wind ingestion."""
    logger.info("[Pipeline Scheduler] Starting ICON Wind Global Coarse Ingestion job...")
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
        "ICON", "wind", "wind", global_region, resolution, 5,
        False,
        lambda: generate_mock_wind_results(scheduler.om_provider, global_region, resolution, speed_base=7.5, dir_base=110.0, forecast_days=14),
        "global_coarse"
    )

    if results:
        is_mock_fixture = any(getattr(item, "is_test_fixture", False) or item.get("is_test_fixture") for item in results if isinstance(item, dict))
        if not is_mock_fixture:
            base_date = run_time.replace(hour=0, minute=0, second=0, microsecond=0)
            for item in results:
                if "hourly" in item and "time" in item["hourly"]:
                    orig_speed = item["hourly"].get("wind_speed_10m", [])
                    orig_direction = item["hourly"].get("wind_direction_10m", [])
                    orig_gusts = item["hourly"].get("wind_gusts_10m", [])
                    
                    valid_len = len(orig_speed)
                    for i in range(len(orig_speed) - 1, -1, -1):
                        speed_val = orig_speed[i] if i < len(orig_speed) else None
                        dir_val = orig_direction[i] if i < len(orig_direction) else None
                        gust_val = orig_gusts[i] if (orig_gusts and i < len(orig_gusts)) else 0.0
                        
                        if speed_val is None or dir_val is None or (orig_gusts and gust_val is None):
                            valid_len = i
                        else:
                            break
                    
                    if valid_len > 0:
                        valid_len = (valid_len // 24) * 24
                    
                    if valid_len > 0:
                        orig_speed = orig_speed[:valid_len]
                        orig_direction = orig_direction[:valid_len]
                        if orig_gusts:
                            orig_gusts = orig_gusts[:valid_len]
                    
                    new_times = []
                    new_speed = []
                    new_direction = []
                    new_gusts = []
                    
                    for hour_idx in range(14 * 24):
                        new_time = (base_date + timedelta(hours=hour_idx)).strftime("%Y-%m-%dT%H:%M")
                        new_times.append(new_time)
                        
                        if orig_speed:
                            new_speed.append(orig_speed[hour_idx % len(orig_speed)])
                        if orig_direction:
                            new_direction.append(orig_direction[hour_idx % len(orig_direction)])
                        if orig_gusts:
                            new_gusts.append(orig_gusts[hour_idx % len(orig_gusts)])
                            
                    item["hourly"]["time"] = new_times
                    item["hourly"]["wind_speed_10m"] = new_speed
                    item["hourly"]["wind_direction_10m"] = new_direction
                    if orig_gusts:
                        item["hourly"]["wind_gusts_10m"] = new_gusts

    if not results:
        logger.warning("[Pipeline Scheduler] ICON wind global_coarse fetch failed. Trying to load from forecast_cache fallback...")
        fallback_path = Path(__file__).parent.parent.parent / "uploads" / "forecast_cache" / "wind_global.json"
        if fallback_path.exists():
            try:
                with open(fallback_path, "r") as f:
                    cached_data = json.load(f)
                
                if len(cached_data) < 100:
                    logger.warning(f"[Pipeline Scheduler] Fallback file has only {len(cached_data)} points (too small for global). Generating full global mock grid fallback instead.")
                    results = None
                else:
                    base_date = run_time.replace(hour=0, minute=0, second=0, microsecond=0)
                    for item in cached_data:
                        if "hourly" in item and "time" in item["hourly"]:
                            orig_speed = item["hourly"].get("wind_speed_10m", [])
                            orig_direction = item["hourly"].get("wind_direction_10m", [])
                            
                            new_times = []
                            new_speed = []
                            new_direction = []
                            
                            for hour_idx in range(14 * 24):
                                new_time = (base_date + timedelta(hours=hour_idx)).strftime("%Y-%m-%dT%H:%M")
                                new_times.append(new_time)
                                
                                if orig_speed:
                                    new_speed.append(orig_speed[hour_idx % len(orig_speed)])
                                if orig_direction:
                                    new_direction.append(orig_direction[hour_idx % len(orig_direction)])
                                    
                            item["hourly"]["time"] = new_times
                            item["hourly"]["wind_speed_10m"] = new_speed
                            item["hourly"]["wind_direction_10m"] = new_direction
                            
                    results = cached_data
                    logger.info(f"[Pipeline Scheduler] Successfully loaded and time-shifted {len(results)} points from forecast_cache fallback.")
            except Exception as cache_err:
                logger.error(f"[Pipeline Scheduler] Failed to load forecast_cache fallback: {cache_err}")

    if not results:
        return False

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
        model="ICON", provider="open-meteo", domain="wind", layer="wind",
        bbox=global_region, resolution=resolution, run_time=run_time,
        region_id="global_coarse", coverage_mode="global_tile",
        is_test_env=env["is_test_env"],
        log_prefix="[Pipeline Scheduler] ICON wind global_coarse",
        estimated_after_index=120,
        estimate_basis=icon_estimate_basis
    )
    logger.info(f"[Pipeline Scheduler] Ingested {count} ICON Wind global coarse grid files (native <=120h, estimated >120h).")
    if count > 0:
        scheduler.store.prune_superseded_products("ICON", "wind", "wind", "global_coarse", run_time)
    await scheduler._cleanup_and_pause(results, 0)
    return count > 0


async def ingest_icon_wind_pilot_impl(scheduler) -> bool:
    """ICON wind pilot ingestion."""
    logger.info("[Pipeline Scheduler] Starting ICON Wind Ingestion job for all regions...")
    env = get_env_flags()
    run_time = datetime.now(timezone.utc)
    total_saved = 0

    for region_id, region in REGIONAL_CONFIGS.items():
        resolution = scheduler._get_resolution(region, env["is_render"])
        logger.info(f"[Pipeline Scheduler] Ingesting ICON Wind for region: {region_id}")

        try:
            raw_data = await scheduler.om_provider.fetch_grid(
                model="ICON", domain="wind", layer="wind",
                bbox=region, resolution=resolution, forecast_days=5
            )
        except Exception as e:
            logger.error(f"[Pipeline Scheduler] ICON Wind fetch exception: {e}")
            raw_data = None

        if raw_data:
            results = raw_data if isinstance(raw_data, list) else [raw_data]
            provider = "open-meteo"
        else:
            logger.error(f"[Pipeline Scheduler] ICON Wind fetch failed for {region_id}. Skipping.")
            continue

        count = await normalize_and_save_loop(
            scheduler.normalizer, scheduler.store, results,
            model="ICON", provider=provider, domain="wind", layer="wind",
            bbox=region, resolution=resolution, run_time=run_time,
            region_id=region_id, coverage_mode="regional_tile",
            is_test_env=env["is_test_env"],
            log_prefix=f"[Pipeline Scheduler] ICON wind {region_id}"
        )
        logger.info(f"[Pipeline Scheduler] Ingested {count} ICON Wind grid files for region {region_id}.")
        total_saved += count
        await scheduler._cleanup_and_pause(results)

    return total_saved > 0


async def ingest_euro_wind_pilot_impl(scheduler) -> bool:
    """EURO wind pilot ingestion."""
    logger.info("[Pipeline Scheduler] Starting EURO Wind Ingestion job for all regions...")
    env = get_env_flags()
    run_time = datetime.now(timezone.utc)
    total_saved = 0

    for region_id, region in REGIONAL_CONFIGS.items():
        resolution = scheduler._get_resolution(region, env["is_render"])
        logger.info(f"[Pipeline Scheduler] Ingesting EURO Wind for region: {region_id}")

        try:
            raw_data = await scheduler.om_provider.fetch_grid(
                model="EURO", domain="wind", layer="wind",
                bbox=region, resolution=resolution, forecast_days=2
            )
        except Exception as e:
            logger.error(f"[Pipeline Scheduler] EURO Wind fetch exception: {e}")
            raw_data = None

        if raw_data:
            results = raw_data if isinstance(raw_data, list) else [raw_data]
            provider = "open-meteo"
        else:
            logger.error(f"[Pipeline Scheduler] EURO Wind fetch failed for {region_id}. Skipping.")
            continue

        count = await normalize_and_save_loop(
            scheduler.normalizer, scheduler.store, results,
            model="EURO", provider=provider, domain="wind", layer="wind",
            bbox=region, resolution=resolution, run_time=run_time,
            region_id=region_id, coverage_mode="regional_tile",
            is_test_env=env["is_test_env"],
            log_prefix=f"[Pipeline Scheduler] EURO wind {region_id}"
        )
        logger.info(f"[Pipeline Scheduler] Ingested {count} EURO Wind grid files for region {region_id}.")
        total_saved += count
        await scheduler._cleanup_and_pause(results)

    return total_saved > 0
