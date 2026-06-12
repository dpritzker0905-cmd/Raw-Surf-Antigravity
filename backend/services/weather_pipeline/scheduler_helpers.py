"""
Scheduler helper utilities extracted from scheduler.py for LOC compliance.
Contains mock data generators, environment detection, and the common
normalize-and-save loop used by all ingestion tasks.
"""
import asyncio
import gc
import logging
import math
import os
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Any, Optional

logger = logging.getLogger(__name__)


def get_env_flags() -> dict:
    """Returns environment detection flags used by all ingestion tasks."""
    import sys
    node_env = os.environ.get("NODE_ENV", "").lower()
    env = os.environ.get("ENV", "").lower()
    is_prod = os.environ.get("IS_PROD", "").lower()
    local_test_fixture = os.environ.get("LOCAL_TEST_FIXTURE", "").lower() == "true"
    
    is_pytest = "pytest" in sys.modules
    
    is_test = False
    if is_pytest:
        if not (node_env == "production" or env == "production" or is_prod == "true"):
            is_test = (
                os.environ.get("NODE_ENV") == "test" or
                local_test_fixture or
                os.environ.get("TESTING") == "1"
            )
    else:
        if local_test_fixture:
            is_test = True
        elif not (node_env == "production" or env == "production" or is_prod == "true"):
            is_test = (
                os.environ.get("NODE_ENV") == "test" or
                local_test_fixture or
                os.environ.get("TESTING") == "1"
            )
            
    return {
        "is_render": os.environ.get("RENDER") == "true",
        "is_test_env": is_test,
    }


def generate_mock_marine_results(om_provider, region: dict, resolution: float,
                                 include_swell_2: bool = True) -> list:
    """Generate mock marine raw results for test environments."""
    lats, lons = om_provider.generate_grid_coords(region, resolution)
    base_time = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    times = [
        (base_time + timedelta(hours=h)).strftime("%Y-%m-%dT%H:00:00Z")
        for h in range(0, 24)
    ]
    results = []
    units = {
        "wave_height": "m", "wave_direction": "°", "wave_period": "s",
        "swell_wave_height": "m", "swell_wave_direction": "°", "swell_wave_period": "s",
        "wind_wave_height": "m", "wind_wave_direction": "°", "wind_wave_period": "s",
    }
    if include_swell_2:
        units.update({
            "secondary_swell_wave_height": "m",
            "secondary_swell_wave_direction": "°",
            "secondary_swell_wave_period": "s",
        })

    for lat, lon in zip(lats, lons):
        hourly = {
            "time": times,
            "wave_height": [1.2 + 0.4 * math.sin(lat) for _ in times],
            "wave_direction": [240.0 for _ in times],
            "wave_period": [10.0 for _ in times],
            "swell_wave_height": [0.8 + 0.3 * math.sin(lat) for _ in times],
            "swell_wave_direction": [110.0 for _ in times],
            "swell_wave_period": [8.0 for _ in times],
            "wind_wave_height": [0.5 + 0.2 * math.sin(lat) for _ in times],
            "wind_wave_direction": [100.0 for _ in times],
            "wind_wave_period": [5.0 for _ in times],
        }
        if include_swell_2:
            hourly.update({
                "secondary_swell_wave_height": [0.3 + 0.1 * math.sin(lat) for _ in times],
                "secondary_swell_wave_direction": [140.0 for _ in times],
                "secondary_swell_wave_period": [6.0 for _ in times],
            })
        results.append({
            "latitude": lat, "longitude": lon,
            "hourly_units": units.copy(),
            "hourly": hourly,
            "is_test_fixture": True,
        })
    return results


def generate_mock_icon_marine_results(om_provider, region: dict, resolution: float) -> list:
    """Generate mock ICON marine raw results (no swell_2)."""
    lats, lons = om_provider.generate_grid_coords(region, resolution)
    base_time = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    times = [
        (base_time + timedelta(hours=h)).strftime("%Y-%m-%dT%H:00:00Z")
        for h in range(0, 24)
    ]
    results = []
    for lat, lon in zip(lats, lons):
        results.append({
            "latitude": lat, "longitude": lon,
            "hourly_units": {
                "wave_height": "m", "wave_direction": "°", "wave_period": "s",
                "swell_wave_height": "m", "swell_wave_direction": "°", "swell_wave_period": "s",
                "wind_wave_height": "m", "wind_wave_direction": "°", "wind_wave_period": "s",
            },
            "hourly": {
                "time": times,
                "wave_height": [1.1 + 0.3 * math.sin(lat) for _ in times],
                "wave_direction": [245.0 for _ in times],
                "wave_period": [9.0 for _ in times],
                "swell_wave_height": [0.7 + 0.2 * math.sin(lat) for _ in times],
                "swell_wave_direction": [115.0 for _ in times],
                "swell_wave_period": [7.5 for _ in times],
                "wind_wave_height": [0.4 + 0.1 * math.sin(lat) for _ in times],
                "wind_wave_direction": [105.0 for _ in times],
                "wind_wave_period": [4.5 for _ in times],
            },
            "is_test_fixture": True,
        })
    return results


def generate_mock_wind_results(om_provider, region: dict, resolution: float,
                               speed_base: float = 8.5, dir_base: float = 120.0,
                               include_gusts: bool = False, gust_base: float = 12.0,
                               forecast_days: int = 2, is_test_fixture: bool = True) -> list:
    """Generate mock wind raw results for test environments using a high-fidelity model."""
    lats, lons = om_provider.generate_grid_coords(region, resolution)
    base_time = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    times = [
        (base_time + timedelta(hours=h)).strftime("%Y-%m-%dT%H:00:00Z")
        for h in range(0, forecast_days * 24)
    ]
    
    # Storm center parameters (moving storm in North Atlantic)
    storm_lat_start = 25.0
    storm_lon_start = -60.0
    
    results = []
    for lat, lon in zip(lats, lons):
        lat_rad = math.radians(lat)
        lon_rad = math.radians(lon)
        lat_deg = lat
        lon_deg = lon
        
        # Calculate base planetary wind parameters for this latitude
        if abs(lat_deg) < 30.0:
            planet_dir = 90.0 - 45.0 * (lat_deg / 30.0)
            planet_speed = 12.0 + 4.0 * math.cos(lat_rad * 3.0)
        elif abs(lat_deg) < 60.0:
            pct = (abs(lat_deg) - 30.0) / 30.0
            start_dir = 45.0 if lat_deg >= 0.0 else 135.0
            target_dir = 225.0 if lat_deg >= 0.0 else 315.0
            planet_dir = start_dir + (target_dir - start_dir) * pct
            planet_speed = 15.0 + 7.0 * math.sin(pct * math.pi)
        else:
            pct = (abs(lat_deg) - 60.0) / 30.0
            start_dir = 225.0 if lat_deg >= 0.0 else 315.0
            target_dir = 90.0 - 45.0 * (lat_deg / 90.0)
            planet_dir = start_dir + (target_dir - start_dir) * pct
            planet_speed = 8.0 + 4.0 * math.cos(pct * math.pi / 2.0)
            
        units = {"wind_speed_10m": "kn", "wind_direction_10m": "°"}
        wind_speeds = []
        wind_dirs = []
        wind_gusts = []
        
        for h in range(len(times)):
            t_factor = math.sin(h / 12.0)
            
            storm_lat = storm_lat_start + 1.5 * (h / 24.0)
            storm_lon = storm_lon_start + 4.0 * (h / 24.0)
            if storm_lon > 180.0:
                storm_lon -= 360.0
            
            dx = lon_deg - storm_lon
            if dx > 180.0:
                dx -= 360.0
            elif dx < -180.0:
                dx += 360.0
            dy = lat_deg - storm_lat
            dist = math.sqrt(dx*dx + dy*dy)
            
            storm_weight = math.exp(-dist / 12.0)
            is_nh = lat_deg >= 0
            spiral_inflow = math.radians(20.0)
            if is_nh:
                tangent_rad = math.atan2(dy, dx) + math.pi/2.0 + spiral_inflow
            else:
                tangent_rad = math.atan2(dy, dx) - math.pi/2.0 - spiral_inflow
            
            storm_dir = (math.degrees(tangent_rad)) % 360.0
            storm_speed = 45.0 * (dist / 2.5) * math.exp(-dist / 4.0)
            
            final_dir = (1.0 - storm_weight) * planet_dir + storm_weight * storm_dir
            final_dir = (final_dir + 15.0 * t_factor) % 360.0
            
            final_speed = (1.0 - storm_weight) * planet_speed + storm_weight * storm_speed
            final_speed = max(2.0, final_speed + 3.0 * t_factor)
            
            wind_speeds.append(round(final_speed, 2))
            wind_dirs.append(round(final_dir, 2))
            if include_gusts:
                wind_gusts.append(round(final_speed * 1.3 + 4.0 * t_factor, 2))
                
        hourly = {
            "time": times,
            "wind_speed_10m": wind_speeds,
            "wind_direction_10m": wind_dirs,
        }
        if include_gusts:
            units["wind_gusts_10m"] = "kn"
            hourly["wind_gusts_10m"] = wind_gusts
            
        results.append({
            "latitude": lat, "longitude": lon,
            "hourly_units": units,
            "hourly": hourly,
            "is_test_fixture": is_test_fixture,
        })
    return results


def generate_mock_pressure_results(om_provider, region: dict, resolution: float) -> list:
    """Generate mock pressure raw results for test environments."""
    lats, lons = om_provider.generate_grid_coords(region, resolution)
    base_time = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    times = [
        (base_time + timedelta(hours=h)).strftime("%Y-%m-%dT%H:00:00Z")
        for h in range(0, 24)
    ]
    results = []
    for lat, lon in zip(lats, lons):
        results.append({
            "latitude": lat, "longitude": lon,
            "hourly_units": {"pressure_msl": "hPa"},
            "hourly": {
                "time": times,
                "pressure_msl": [1013.2 + 2.5 * math.sin(lat) for _ in times],
            },
            "is_test_fixture": True,
        })
    return results


def generate_mock_copernicus_results(region: dict, resolution: float) -> list:
    """Generate mock Copernicus marine raw results for test environments."""
    from services.weather_pipeline.providers.open_meteo_provider import OpenMeteoProvider
    lats, lons = OpenMeteoProvider.generate_grid_coords(region, resolution)
    base_time = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    times = [
        (base_time + timedelta(hours=h)).strftime("%Y-%m-%dT%H:00:00Z")
        for h in range(0, 72, 3)
    ]
    results = []
    for lat, lon in zip(lats, lons):
        results.append({
            "latitude": lat, "longitude": lon,
            "generationtime_ms": 0, "utc_offset_seconds": 0,
            "timezone": "GMT", "timezone_abbreviation": "GMT",
            "elevation": 0, "__provider": "test-fixture",
            "hourly_units": {
                "time": "iso8601",
                "swell_wave_height": "m", "swell_wave_direction": "°", "swell_wave_period": "s",
                "secondary_swell_wave_height": "m", "secondary_swell_wave_direction": "°",
                "secondary_swell_wave_period": "s",
                "wind_wave_height": "m", "wind_wave_direction": "°", "wind_wave_period": "s",
                "wave_height": "m", "wave_direction": "°", "wave_period": "s",
            },
            "hourly": {
                "time": times,
                "swell_wave_height": [0.8 + 0.3 * math.sin(lat) for _ in times],
                "swell_wave_direction": [110.0 for _ in times],
                "swell_wave_period": [8.0 for _ in times],
                "secondary_swell_wave_height": [0.3 + 0.1 * math.sin(lat) for _ in times],
                "secondary_swell_wave_direction": [140.0 for _ in times],
                "secondary_swell_wave_period": [6.0 for _ in times],
                "wind_wave_height": [0.5 + 0.2 * math.sin(lat) for _ in times],
                "wind_wave_direction": [100.0 for _ in times],
                "wind_wave_period": [5.0 for _ in times],
                "wave_height": [1.0 + 0.3 * math.sin(lat) for _ in times],
                "wave_direction": [240.0 for _ in times],
                "wave_period": [10.0 for _ in times],
            },
            "is_test_fixture": True,
        })
    return results


async def normalize_and_save_loop(
    normalizer, store, results: list, model: str, provider: str,
    domain: str, layer: str, bbox: dict, resolution: float,
    run_time: datetime, region_id: Optional[str] = None,
    coverage_mode: Optional[str] = None,
    is_test_env: bool = False, step: int = 3,
    log_prefix: str = "[Pipeline Scheduler]",
    estimated_after_index: Optional[int] = None,
    estimate_basis: Optional[dict] = None
) -> int:
    """
    Common normalize-and-save loop used by all ingestion methods.
    Returns the number of successfully saved products.

    If estimated_after_index is set, products at or beyond that hourly index
    are tagged as is_estimated=True with the given estimate_basis.
    """
    first_pt = results[0]
    times = first_pt.get("hourly", {}).get("time", [])
    if not times:
        logger.error(f"{log_prefix} Payload missing hourly times array.")
        return 0

    success_count = 0
    norm_kwargs = {
        "model": model, "provider": provider, "domain": domain, "layer": layer,
        "raw_results": results, "bbox": bbox, "resolution": resolution,
        "target_time": None, "run_time": run_time,
    }
    if region_id is not None:
        norm_kwargs["region_id"] = region_id
    if coverage_mode is not None:
        norm_kwargs["coverage_mode"] = coverage_mode

    for idx, time_str in enumerate(times):
        if idx % step != 0:
            continue
        if not time_str.endswith("Z"):
            time_str += "Z"
        target_dt = datetime.fromisoformat(time_str.replace("Z", "+00:00"))
        norm_kwargs["target_time"] = target_dt

        try:
            product = normalizer.normalize(**norm_kwargs)
            if product:
                # Security guard: reject test fixtures in non-test environments
                if not is_test_env and hasattr(product, 'is_test_fixture') and product.is_test_fixture:
                    logger.error(f"{log_prefix} Security violation: trying to save test fixture product in non-test environment.")
                    continue
                # Tag as estimated if beyond the native horizon
                if estimated_after_index is not None and idx >= estimated_after_index:
                    product.is_estimated = True
                    product.is_forecast_authoritative = False
                    product.estimate_basis = estimate_basis
                store.save_product(product, resolution=resolution)
                success_count += 1
                del product
                gc.collect()
                has_supabase = False
                try:
                    from services.weather_pipeline.store import _get_supabase_storage
                    has_supabase = _get_supabase_storage() is not None
                except Exception:
                    pass
                sleep_dur = 0.0 if (is_test_env or not has_supabase) else 0.2
                await asyncio.sleep(sleep_dur)
        except Exception as e:
            logger.error(f"{log_prefix} Normalization error for {model} {layer} at hour index {idx}: {e}")

    return success_count


REGIONAL_CONFIGS = {
    "florida_east_coast": {
        "west": -85.0,
        "south": 24.0,
        "east": -79.0,
        "north": 31.0,
        "resolution": 0.25
    },
    "us_west_coast_socal": {
        "west": -125.0,
        "south": 30.0,
        "east": -115.0,
        "north": 38.0,
        "resolution": 0.25
    }
}


def find_nearest_manifest_product(
    manifest, model: str, domain: str, layer: str, region_id: str,
    target_time: datetime, max_delta_hours: float = 3.0
):
    """
    Locates the product in manifest closest to target_time within max_delta_hours.
    Returns the ManifestProduct item or None if no product is close enough.
    """
    candidates = [
        p for p in manifest.products
        if (
            p.model.upper() == model.upper()
            and p.domain.lower() == domain.lower()
            and p.layer.lower() == layer.lower()
            and p.region_id == region_id
            and not p.is_estimated
        )
    ]
    if not candidates:
        return None

    best_candidate = min(candidates, key=lambda p: abs((p.valid_time_start - target_time).total_seconds()))
    delta_sec = abs((best_candidate.valid_time_start - target_time).total_seconds())
    if delta_sec <= max_delta_hours * 3600.0:
        return best_candidate
    return None


async def ingest_euro_marine_extended_estimates_impl(scheduler) -> bool:
    """Implementation of ingest_euro_marine_extended_estimates delegated from scheduler."""
    from services.weather_pipeline.estimator import (
        estimate_euro_grid, EURO_LIMIT_WAVES, EURO_LIMIT_COMPONENTS, EstimateContractError
    )
    
    manifest = scheduler.store.get_manifest()
    total_saved = 0
    
    for region_id, region in REGIONAL_CONFIGS.items():
        logger.info(f"[Pipeline Scheduler] Processing region for estimates: {region_id}")
        layers = ["waves", "swell_1", "swell_2", "wind_waves"]
        
        for layer in layers:
            # 1. Find the last authoritative EURO product (the anchor)
            euro_products = [
                p for p in manifest.products
                if (
                    p.model == "EURO"
                    and p.domain == "marine"
                    and p.layer == layer
                    and p.region_id == region_id
                    and p.is_forecast_authoritative
                    and not p.is_estimated
                )
            ]
            if not euro_products:
                logger.debug(f"[Pipeline Scheduler] No authoritative EURO marine {layer} products found for region {region_id}. Skipping layer.")
                continue
            
            # The anchor is the one with the maximum valid_time_start
            euro_anchor_item = max(euro_products, key=lambda p: p.valid_time_start)
            anchor_time = euro_anchor_item.valid_time_start
            logger.info(f"[Pipeline Scheduler] Found EURO marine {layer} anchor for {region_id} at {anchor_time.isoformat()}")
            
            # Load the full euro anchor product
            euro_anchor_product = scheduler.store.load_product(euro_anchor_item.filename)
            if not euro_anchor_product:
                logger.warning(f"[Pipeline Scheduler] Failed to load EURO anchor product {euro_anchor_item.filename}. Skipping layer.")
                continue
            
            # 2. Find GFS anchor product near the anchor time (within 3h tolerance)
            gfs_anchor_item = find_nearest_manifest_product(
                manifest, "GFS", "marine", layer, region_id, anchor_time, max_delta_hours=3.0
            )
            if not gfs_anchor_item:
                logger.warning(f"[Pipeline Scheduler] No GFS anchor product found near {anchor_time.isoformat()} for {region_id} {layer}. Skipping layer.")
                continue
            
            gfs_anchor_product = scheduler.store.load_product(gfs_anchor_item.filename)
            if not gfs_anchor_product:
                logger.warning(f"[Pipeline Scheduler] Failed to load GFS anchor product {gfs_anchor_item.filename}. Skipping layer.")
                continue
            
            # 3. Find ICON anchor product near the anchor time (within 3h tolerance, if layer != swell_2)
            icon_anchor_product = None
            icon_anchor_item = None
            if layer != "swell_2":
                icon_anchor_item = find_nearest_manifest_product(
                    manifest, "ICON", "marine", layer, region_id, anchor_time, max_delta_hours=3.0
                )
                if icon_anchor_item:
                    icon_anchor_product = scheduler.store.load_product(icon_anchor_item.filename)
            
            native_limit = EURO_LIMIT_WAVES if layer == "waves" else EURO_LIMIT_COMPONENTS
            
            # 4. Find all GFS target products with valid_time > anchor_time
            gfs_targets = [
                p for p in manifest.products
                if (
                    p.model == "GFS"
                    and p.domain == "marine"
                    and p.layer == layer
                    and p.region_id == region_id
                    and p.valid_time_start > anchor_time
                    and not p.is_estimated
                )
            ]
            # Sort targets chronologically
            gfs_targets.sort(key=lambda p: p.valid_time_start)
            
            for gfs_target_item in gfs_targets:
                target_time = gfs_target_item.valid_time_start
                hours_diff = (target_time - anchor_time).total_seconds() / 3600.0
                target_hour = native_limit + hours_diff
                
                # Load GFS target product
                gfs_target_product = scheduler.store.load_product(gfs_target_item.filename)
                if not gfs_target_product:
                    continue
                
                # Load ICON target product (if layer != swell_2 and target_hour <= 168)
                icon_target_item = None
                icon_target_product = None
                is_icon_required = (layer != "swell_2" and target_hour <= 168.0)
                
                if is_icon_required:
                    if not icon_anchor_product:
                        logger.debug(f"[Pipeline Scheduler] Missing required ICON anchor for target at {target_time.isoformat()} (offset <= 168h). Skipping.")
                        continue
                    
                    icon_target_item = find_nearest_manifest_product(
                        manifest, "ICON", "marine", layer, region_id, target_time, max_delta_hours=3.0
                    )
                    if not icon_target_item:
                        logger.debug(f"[Pipeline Scheduler] Missing required ICON target product near {target_time.isoformat()}. Skipping.")
                        continue
                    icon_target_product = scheduler.store.load_product(icon_target_item.filename)
                    if not icon_target_product:
                        logger.debug(f"[Pipeline Scheduler] Failed to load ICON target product {icon_target_item.filename}. Skipping.")
                        continue
                
                # Generate the estimate product grid
                logger.debug(f"[Pipeline Scheduler] Generating EURO marine {layer} estimate for {target_time.isoformat()} (offset: {target_hour}h)")
                try:
                    est_product = estimate_euro_grid(
                        target_hour=target_hour,
                        native_limit=native_limit,
                        active_layer=layer,
                        euro_anchor_product=euro_anchor_product,
                        gfs_target_product=gfs_target_product,
                        gfs_anchor_product=gfs_anchor_product,
                        icon_target_product=icon_target_product,
                        icon_anchor_product=icon_anchor_product,
                        euro_anchor_valid_time=euro_anchor_item.valid_time_start,
                        gfs_anchor_valid_time=gfs_anchor_item.valid_time_start,
                        icon_anchor_valid_time=icon_anchor_item.valid_time_start if icon_anchor_item else None,
                        gfs_target_valid_time=gfs_target_item.valid_time_start,
                        icon_target_valid_time=icon_target_item.valid_time_start if icon_target_item else None
                    )
                    
                    if est_product:
                        res = scheduler.store.save_product(est_product, resolution=euro_anchor_item.resolution)
                        if res:
                            total_saved += 1
                except EstimateContractError as e:
                    logger.error(
                        f"[Pipeline Scheduler] Skipped invalid estimate for region={region_id}, layer={layer}, "
                        f"target_time={target_time.isoformat()} due to contract error: {e}"
                    )
                    continue
                        
    logger.info(f"[Pipeline Scheduler] EURO Marine Extended Estimate Ingestion job completed. Saved {total_saved} estimated product files.")
    return total_saved > 0

