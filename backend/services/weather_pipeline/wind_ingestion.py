import os
import json
import logging
from datetime import datetime, timezone, timedelta
from pathlib import Path
from services.weather_pipeline.scheduler_helpers import (
    get_env_flags,
    generate_mock_wind_results,
    normalize_and_save_loop,
    REGIONAL_CONFIGS,
    get_pilot_regions,
)

logger = logging.getLogger(__name__)


def _parse_om_time(s):
    """Open-meteo hourly times are offset-naive ('...T00:00'); normalize to UTC-aware."""
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt
    except Exception:
        return None


def _slice_hours_after(results, after_dt):
    """Trim open-meteo-shaped point results to hourly entries STRICTLY AFTER after_dt (the extended
    tail slice — mirror of the EURO marine gfs_ext slice in scheduler.py). Returns None when empty."""
    if not results or after_dt is None:
        return None
    sliced = []
    for pt in results:
        hourly = pt.get("hourly", {}) or {}
        times = hourly.get("time", []) or []
        keep = [i for i, t in enumerate(times) if (_parse_om_time(t) and _parse_om_time(t) > after_dt)]
        if not keep:
            continue
        new_hourly = {k: ([arr[i] for i in keep] if (isinstance(arr, list) and len(arr) == len(times)) else arr)
                      for k, arr in hourly.items()}
        npt = dict(pt)
        npt["hourly"] = new_hourly
        sliced.append(npt)
    return sliced or None

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

    # Regional pilot mirrors ingest_gfs_wind_global_impl's NOAA-direct PRIMARY: fetch_gfs_wind_global_coarse
    # is bbox+resolution-parameterized, so a regional 0.25° fetch is just a smaller bbox. open-meteo is
    # unreachable on the decoupled GitHub runner, so without this the regional pilot ships ZERO wind tiles —
    # the zoomed-in-wind slow path (no regional product -> ~20s live viewport fetch per request on the serve
    # box). Provider stays 'open-meteo' (manifest byte-identical, source_dataset='gfs_seamless'); open-meteo
    # remains the fallback. Kill switch: GFS_WIND_NOAA_DIRECT=0.
    noaa_direct = os.environ.get("GFS_WIND_NOAA_DIRECT", "1") != "0"
    forecast_days = int(os.environ.get("WIND_PILOT_FORECAST_DAYS", "8"))

    for region_id, region in get_pilot_regions().items():
        resolution = scheduler._get_resolution(region, env["is_render"])
        logger.info(f"[Pipeline Scheduler] Ingesting GFS Wind for region: {region_id}")

        results = None
        from_noaa = False
        if noaa_direct:
            try:
                from services.noaa_wind_service import fetch_gfs_wind_global_coarse
                results = await fetch_gfs_wind_global_coarse(region, resolution, forecast_days)
                if results:
                    from_noaa = True
                    logger.info(f"[Pipeline Scheduler] GFS wind NOAA-direct OK for {region_id}: "
                                f"{len(results)} points (off open-meteo).")
            except Exception as _ne:
                logger.error(f"[Pipeline Scheduler] GFS wind NOAA-direct fetch errored for {region_id}: {_ne}")

        if not results:
            if noaa_direct:
                logger.warning(f"[Pipeline Scheduler] GFS wind NOAA-direct unavailable for {region_id}; "
                               "falling back to open-meteo.")
            results = await scheduler._fetch_or_mock(
                "GFS", "wind", "wind", region, resolution, 14,
                False,
                lambda r=region, res=resolution: generate_mock_wind_results(scheduler.om_provider, r, res),
                region_id
            )
        if not results:
            continue

        # NOAA GFS wind is natively 3-hourly (step=1 keeps every step); open-meteo is hourly (step=3 ->
        # 3-hourly products). Same 3-hourly product cadence either way.
        save_step = 1 if from_noaa else 3
        count = await normalize_and_save_loop(
            scheduler.normalizer, scheduler.store, results,
            model="GFS", provider="open-meteo", domain="wind", layer="wind",
            bbox=region, resolution=resolution, run_time=run_time,
            region_id=region_id, coverage_mode="regional_tile",
            is_test_env=env["is_test_env"], step=save_step,
            log_prefix=f"[Pipeline Scheduler] GFS wind {region_id}"
        )
        logger.info(f"[Pipeline Scheduler] Ingested {count} GFS Wind grid files for region {region_id}.")
        total_saved += count
        if count > 0:
            scheduler.store.prune_superseded_products("GFS", "wind", "wind", region_id, run_time)
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
    from_cache = False
    if not results:
        logger.warning("[Pipeline Scheduler] GFS wind global_coarse fetch failed. Trying to load from forecast_cache fallback...")
        fallback_path = Path(__file__).parent.parent.parent / "uploads" / "forecast_cache" / "wind_global.json"
        if fallback_path.exists():
            try:
                with open(fallback_path, "r") as f:
                    cached_data = json.load(f)
                
                if len(cached_data) < 100:
                    logger.warning(f"[Pipeline Scheduler] Fallback file has only {len(cached_data)} points (too small for global). Skipping this cycle (no mock is generated in production).")
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
                    from_cache = True
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
    # Recycled-cache products are ESTIMATES (2026-07-04): the last-resort fallback time-shifts a
    # stale snapshot onto current dates — that must never serve labeled as a live forecast.
    _cache_basis = {"type": "stale_cache_recycled", "method": "time_shifted_forecast_cache",
                    "source_model": "gfs_seamless"} if from_cache else None
    count = await normalize_and_save_loop(
        scheduler.normalizer, scheduler.store, results,
        model="GFS", provider="open-meteo", domain="wind", layer="wind",
        bbox=global_region, resolution=resolution, run_time=run_time,
        region_id="global_coarse", coverage_mode="global_tile",
        is_test_env=env["is_test_env"], step=save_step,
        log_prefix="[Pipeline Scheduler] GFS wind global_coarse",
        estimated_after_index=0 if from_cache else None, estimate_basis=_cache_basis
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

    # ══ PRIMARY: native EURO 10m wind direct from ECMWF Open Data (free IFS 0.25° GRIB, 10u/10v) ══
    # Off open-meteo (which was STARVING EURO wind — failing multiple cycles, ~10h stale). Provider stays
    # 'open-meteo' below so the manifest (source_dataset='ecmwf_ifs') is byte-identical — zero frontend
    # regression (the EURO-wind clearing/seam/activation fixes operate on the rendered grid, unaffected).
    # ECMWF is 3/6-hourly native (step=1); open-meteo is hourly (step=3). ECMWF failed -> the open-meteo
    # fallback + forecast_cache path below, all UNCHANGED. Kill switch EURO_WIND_ECMWF_DIRECT=0.
    ecmwf_direct = os.environ.get("EURO_WIND_ECMWF_DIRECT", "1") != "0"
    results = None
    from_ecmwf = False
    if ecmwf_direct:
        try:
            from services.ecmwf_wind_service import fetch_euro_wind_global_coarse
            results = await fetch_euro_wind_global_coarse(global_region, resolution, min(_WIND_GLOBAL_FORECAST_DAYS, 10))
            if results:
                from_ecmwf = True
                logger.info(f"[Pipeline Scheduler] EURO wind ECMWF-direct OK: {len(results)} points (off open-meteo).")
        except Exception as _ee:
            logger.error(f"[Pipeline Scheduler] EURO wind ECMWF-direct fetch errored: {_ee}")

    if not results:
        if ecmwf_direct:
            logger.warning("[Pipeline Scheduler] EURO wind ECMWF-direct unavailable; falling back to open-meteo.")
        results = await scheduler._fetch_or_mock(
            "EURO", "wind", "wind", global_region, resolution, _WIND_GLOBAL_FORECAST_DAYS,
            False,
            lambda: generate_mock_wind_results(scheduler.om_provider, global_region, resolution, speed_base=7.0, dir_base=105.0, forecast_days=14),
            "global_coarse",
            batch_size=_WIND_GLOBAL_BATCH_SIZE
        )
    from_cache = False
    if not results:
        logger.warning("[Pipeline Scheduler] EURO wind global_coarse fetch failed. Trying to load from forecast_cache fallback...")
        fallback_path = Path(__file__).parent.parent.parent / "uploads" / "forecast_cache" / "wind_global.json"
        if fallback_path.exists():
            try:
                with open(fallback_path, "r") as f:
                    cached_data = json.load(f)
                
                if len(cached_data) < 100:
                    logger.warning(f"[Pipeline Scheduler] Fallback file has only {len(cached_data)} points (too small for global). Skipping this cycle (no mock is generated in production).")
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
                    from_cache = True
                    logger.info(f"[Pipeline Scheduler] Successfully loaded and time-shifted {len(results)} points from forecast_cache fallback.")
            except Exception as cache_err:
                logger.error(f"[Pipeline Scheduler] Failed to load forecast_cache fallback: {cache_err}")

    if not results:
        return False

    if not results:
        return False

    # ECMWF is native 3/6-hourly (step=1 keeps every step); open-meteo all-wind + forecast_cache are
    # hourly (step=3 -> 3-hourly products). Same product cadence either way.
    save_step = 1 if from_ecmwf else 3
    # Recycled-cache products are ESTIMATES (2026-07-04) — see the GFS block above.
    _cache_basis = {"type": "stale_cache_recycled", "method": "time_shifted_forecast_cache",
                    "source_model": "gfs_seamless"} if from_cache else None
    count = await normalize_and_save_loop(
        scheduler.normalizer, scheduler.store, results,
        model="EURO", provider="open-meteo", domain="wind", layer="wind",
        bbox=global_region, resolution=resolution, run_time=run_time,
        region_id="global_coarse", coverage_mode="global_tile",
        is_test_env=env["is_test_env"], step=save_step,
        log_prefix="[Pipeline Scheduler] EURO wind global_coarse",
        estimated_after_index=0 if from_cache else None, estimate_basis=_cache_basis
    )
    logger.info(f"[Pipeline Scheduler] Ingested {count} EURO Wind global coarse grid files.")

    # Strategy slice 1 (2026-07-10 late): PRE-BAKE the EURO wind 240->336h tail as GFS-fallback
    # clones (see euro_wind_extension.py — same labels the live dynamic fallback serves, computed
    # on the runner instead of per-request on the 1-CPU box). Skipped for forecast_cache recycles
    # (already 14d, estimated from hour 0). Kill switch: EURO_WIND_EXTEND=0.
    ext_count = 0
    if count > 0 and not from_cache and os.environ.get("EURO_WIND_EXTEND", "1") != "0":
        try:
            native_max = None
            for item in results:
                times = (item.get("hourly", {}) or {}).get("time", []) or []
                if times:
                    native_max = _parse_om_time(times[-1])
                    break
            from services.weather_pipeline.euro_wind_extension import extend_euro_wind_from_gfs
            ext_count = await extend_euro_wind_from_gfs(scheduler, run_time, native_max)
            if ext_count:
                logger.info(f"[Pipeline Scheduler] Ingested {ext_count} EURO wind extended-tail files (gfs_fallback clones, beyond {native_max}).")
        except Exception as _ee:
            logger.error(f"[Pipeline Scheduler] EURO wind extended-tail save failed (natives unaffected): {_ee}")

    if count + ext_count > 0:
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

    # ══ PRIMARY: native ICON 10m wind direct from DWD opendata (icosahedral GRIB via CLAT/CLON) ══
    # Off open-meteo (frees budget), same ICON model. Provider stays 'open-meteo' below so the manifest
    # (source_dataset='dwd_icon') is byte-identical — zero regression. DWD gives REAL ~7.5d (180h) data,
    # so the DWD path is authoritative (no estimation) at step=1; the open-meteo fallback keeps its 5d +
    # cyclic-fill post-processing + >120h-estimated behavior. Kill switch ICON_WIND_DWD_DIRECT=0.
    dwd_direct = os.environ.get("ICON_WIND_DWD_DIRECT", "1") != "0"
    results = None
    from_dwd = False
    if dwd_direct:
        try:
            from services.dwd_wind_service import fetch_icon_wind_global_coarse
            results = await fetch_icon_wind_global_coarse(global_region, resolution, 8)
            if results:
                from_dwd = True
                logger.info(f"[Pipeline Scheduler] ICON wind DWD-direct OK: {len(results)} points (off open-meteo).")
        except Exception as _de:
            logger.error(f"[Pipeline Scheduler] ICON wind DWD-direct fetch errored: {_de}")

    if not results:
        if dwd_direct:
            logger.warning("[Pipeline Scheduler] ICON wind DWD-direct unavailable; falling back to open-meteo.")
        results = await scheduler._fetch_or_mock(
            "ICON", "wind", "wind", global_region, resolution, 5,
            False,
            lambda: generate_mock_wind_results(scheduler.om_provider, global_region, resolution, speed_base=7.5, dir_base=110.0, forecast_days=14),
            "global_coarse"
        )

    if results and not from_dwd:
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

    from_cache = False
    if not results:
        logger.warning("[Pipeline Scheduler] ICON wind global_coarse fetch failed. Trying to load from forecast_cache fallback...")
        fallback_path = Path(__file__).parent.parent.parent / "uploads" / "forecast_cache" / "wind_global.json"
        if fallback_path.exists():
            try:
                with open(fallback_path, "r") as f:
                    cached_data = json.load(f)
                
                if len(cached_data) < 100:
                    logger.warning(f"[Pipeline Scheduler] Fallback file has only {len(cached_data)} points (too small for global). Skipping this cycle (no mock is generated in production).")
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
                    from_cache = True
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

    # DWD-direct is real 3-hourly data to ~180h -> authoritative, step=1, no estimation. open-meteo path
    # is hourly to 120h + cyclic-filled -> step=3, estimated beyond index 120. A recycled forecast_cache
    # (2026-07-04) is an ESTIMATE from hour 0 — time-shifted stale data must never serve as live.
    save_step = 1 if from_dwd else 3
    est_after = None if from_dwd else (0 if from_cache else 120)
    est_basis = None if from_dwd else (
        {"type": "stale_cache_recycled", "method": "time_shifted_forecast_cache", "source_model": "gfs_seamless"}
        if from_cache else icon_estimate_basis)
    count = await normalize_and_save_loop(
        scheduler.normalizer, scheduler.store, results,
        model="ICON", provider="open-meteo", domain="wind", layer="wind",
        bbox=global_region, resolution=resolution, run_time=run_time,
        region_id="global_coarse", coverage_mode="global_tile",
        is_test_env=env["is_test_env"], step=save_step,
        log_prefix="[Pipeline Scheduler] ICON wind global_coarse",
        estimated_after_index=est_after,
        estimate_basis=est_basis
    )
    logger.info(f"[Pipeline Scheduler] Ingested {count} ICON Wind global coarse grid files (from_dwd={from_dwd}).")

    # Audit #22 (2026-07-10): PRE-BAKE the ICON wind extended tail. The 14d loop-extrapolation only
    # ran on the open-meteo FALLBACK path — the production DWD-direct path saved natives (~180h) and
    # stopped, so every far hour fell to the on-demand 629-pt dynamic build (measured >40s cold on
    # Render, 504s + open-meteo 503s under load = the far-hour wind scrub grind). Bake the SAME
    # extension here on the runner: natives stay authoritative step=1; the tail (> native max) saves
    # 3-hourly as ESTIMATED (loop-extrapolation basis) — cf0b4b23's prune rule preserves the old tail
    # until this new one lands (continuity), and the resolver serves stored products before any
    # dynamic build. Kill switch: ICON_WIND_EXTEND=0.
    ext_count = 0
    if from_dwd and count > 0 and os.environ.get("ICON_WIND_EXTEND", "1") != "0":
        try:
            native_max = None
            for item in results:
                times = (item.get("hourly", {}) or {}).get("time", []) or []
                if times:
                    native_max = _parse_om_time(times[-1])
                    break
            from services.weather_pipeline.viewport_helper import extend_icon_wind_to_14d
            extend_icon_wind_to_14d(results)  # mutates: day-looped hourly arrays out to 336h
            ext_results = _slice_hours_after(results, native_max)
            if ext_results:
                native_h = None
                try:
                    native_h = int((native_max - run_time).total_seconds() // 3600)
                except Exception:
                    pass
                ext_count = await normalize_and_save_loop(
                    scheduler.normalizer, scheduler.store, ext_results,
                    model="ICON", provider="open-meteo", domain="wind", layer="wind",
                    bbox=global_region, resolution=resolution, run_time=run_time,
                    region_id="global_coarse", coverage_mode="global_tile",
                    is_test_env=env["is_test_env"], step=3,
                    log_prefix="[Pipeline Scheduler] ICON wind (14d loop-ext tail) global_coarse",
                    estimated_after_index=0,
                    estimate_basis={**icon_estimate_basis, "native_horizon_hours": native_h or 180},
                )
                logger.info(f"[Pipeline Scheduler] Ingested {ext_count} ICON wind extended-tail files (beyond {native_max}).")
        except Exception as _ee:
            logger.error(f"[Pipeline Scheduler] ICON wind extended-tail save failed (natives unaffected): {_ee}")

    if count + ext_count > 0:
        scheduler.store.prune_superseded_products("ICON", "wind", "wind", "global_coarse", run_time)
    await scheduler._cleanup_and_pause(results, 0)
    return count > 0


async def ingest_icon_wind_pilot_impl(scheduler) -> bool:
    """ICON wind pilot ingestion."""
    logger.info("[Pipeline Scheduler] Starting ICON Wind Ingestion job for all regions...")
    env = get_env_flags()
    run_time = datetime.now(timezone.utc)
    total_saved = 0

    # DWD-direct PRIMARY (mirrors ingest_icon_wind_global_impl): fetch_icon_wind_global_coarse is bbox-
    # parameterized, so a regional fetch is just a smaller bbox. open-meteo is unreachable on the CI runner,
    # so without this the pilot ships ZERO regional wind tiles. Provider stays 'open-meteo' (manifest byte-
    # identical, source_dataset='dwd_icon'); open-meteo remains the fallback. Kill switch: ICON_WIND_DWD_DIRECT=0.
    dwd_direct = os.environ.get("ICON_WIND_DWD_DIRECT", "1") != "0"
    forecast_days = int(os.environ.get("WIND_PILOT_FORECAST_DAYS", "8"))

    for region_id, region in get_pilot_regions().items():
        resolution = scheduler._get_resolution(region, env["is_render"])
        logger.info(f"[Pipeline Scheduler] Ingesting ICON Wind for region: {region_id}")

        results = None
        from_dwd = False
        if dwd_direct:
            try:
                from services.dwd_wind_service import fetch_icon_wind_global_coarse
                results = await fetch_icon_wind_global_coarse(region, resolution, forecast_days)
                if results:
                    from_dwd = True
                    logger.info(f"[Pipeline Scheduler] ICON wind DWD-direct OK for {region_id}: "
                                f"{len(results)} points (off open-meteo).")
            except Exception as _de:
                logger.error(f"[Pipeline Scheduler] ICON wind DWD-direct fetch errored for {region_id}: {_de}")

        if not results:
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
            else:
                logger.error(f"[Pipeline Scheduler] ICON Wind fetch failed for {region_id}. Skipping.")
                continue

        save_step = 1 if from_dwd else 3
        count = await normalize_and_save_loop(
            scheduler.normalizer, scheduler.store, results,
            model="ICON", provider="open-meteo", domain="wind", layer="wind",
            bbox=region, resolution=resolution, run_time=run_time,
            region_id=region_id, coverage_mode="regional_tile",
            is_test_env=env["is_test_env"], step=save_step,
            log_prefix=f"[Pipeline Scheduler] ICON wind {region_id}"
        )
        logger.info(f"[Pipeline Scheduler] Ingested {count} ICON Wind grid files for region {region_id}.")
        total_saved += count
        if count > 0:
            scheduler.store.prune_superseded_products("ICON", "wind", "wind", region_id, run_time)
        await scheduler._cleanup_and_pause(results)

    return total_saved > 0


async def ingest_euro_wind_pilot_impl(scheduler) -> bool:
    """EURO wind pilot ingestion."""
    logger.info("[Pipeline Scheduler] Starting EURO Wind Ingestion job for all regions...")
    env = get_env_flags()
    run_time = datetime.now(timezone.utc)
    total_saved = 0

    # ECMWF-direct PRIMARY (mirrors ingest_euro_wind_global_impl): fetch_euro_wind_global_coarse is bbox-
    # parameterized. open-meteo is unreachable on the CI runner (and was starving EURO wind), so without this
    # the pilot ships ZERO regional wind tiles. Provider stays 'open-meteo' (manifest byte-identical,
    # source_dataset='ecmwf_ifs'); open-meteo remains the fallback. Kill switch: EURO_WIND_ECMWF_DIRECT=0.
    ecmwf_direct = os.environ.get("EURO_WIND_ECMWF_DIRECT", "1") != "0"
    forecast_days = int(os.environ.get("WIND_PILOT_FORECAST_DAYS", "8"))

    for region_id, region in get_pilot_regions().items():
        resolution = scheduler._get_resolution(region, env["is_render"])
        logger.info(f"[Pipeline Scheduler] Ingesting EURO Wind for region: {region_id}")

        results = None
        from_ecmwf = False
        if ecmwf_direct:
            try:
                from services.ecmwf_wind_service import fetch_euro_wind_global_coarse
                results = await fetch_euro_wind_global_coarse(region, resolution, min(forecast_days, 10))
                if results:
                    from_ecmwf = True
                    logger.info(f"[Pipeline Scheduler] EURO wind ECMWF-direct OK for {region_id}: "
                                f"{len(results)} points (off open-meteo).")
            except Exception as _ee:
                logger.error(f"[Pipeline Scheduler] EURO wind ECMWF-direct fetch errored for {region_id}: {_ee}")

        if not results:
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
            else:
                logger.error(f"[Pipeline Scheduler] EURO Wind fetch failed for {region_id}. Skipping.")
                continue

        save_step = 1 if from_ecmwf else 3
        count = await normalize_and_save_loop(
            scheduler.normalizer, scheduler.store, results,
            model="EURO", provider="open-meteo", domain="wind", layer="wind",
            bbox=region, resolution=resolution, run_time=run_time,
            region_id=region_id, coverage_mode="regional_tile",
            is_test_env=env["is_test_env"], step=save_step,
            log_prefix=f"[Pipeline Scheduler] EURO wind {region_id}"
        )
        logger.info(f"[Pipeline Scheduler] Ingested {count} EURO Wind grid files for region {region_id}.")
        total_saved += count
        if count > 0:
            scheduler.store.prune_superseded_products("EURO", "wind", "wind", region_id, run_time)
        await scheduler._cleanup_and_pause(results)

    return total_saved > 0
