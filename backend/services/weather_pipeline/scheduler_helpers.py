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
    times = [
        (datetime.now(timezone.utc) + timedelta(hours=h)).strftime("%Y-%m-%dT%H:00:00Z")
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
    times = [
        (datetime.now(timezone.utc) + timedelta(hours=h)).strftime("%Y-%m-%dT%H:00:00Z")
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
                               include_gusts: bool = False, gust_base: float = 12.0) -> list:
    """Generate mock wind raw results for test environments."""
    lats, lons = om_provider.generate_grid_coords(region, resolution)
    times = [
        (datetime.now(timezone.utc) + timedelta(hours=h)).strftime("%Y-%m-%dT%H:00:00Z")
        for h in range(0, 24)
    ]
    results = []
    for lat, lon in zip(lats, lons):
        units = {"wind_speed_10m": "kn", "wind_direction_10m": "°"}
        hourly = {
            "time": times,
            "wind_speed_10m": [speed_base + 2.5 * math.cos(lat) for _ in times],
            "wind_direction_10m": [dir_base for _ in times],
        }
        if include_gusts:
            units["wind_gusts_10m"] = "kn"
            hourly["wind_gusts_10m"] = [gust_base + 3.0 * math.cos(lat) for _ in times]
        results.append({
            "latitude": lat, "longitude": lon,
            "hourly_units": units,
            "hourly": hourly,
            "is_test_fixture": True,
        })
    return results


def generate_mock_pressure_results(om_provider, region: dict, resolution: float) -> list:
    """Generate mock pressure raw results for test environments."""
    lats, lons = om_provider.generate_grid_coords(region, resolution)
    times = [
        (datetime.now(timezone.utc) + timedelta(hours=h)).strftime("%Y-%m-%dT%H:00:00Z")
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
    times = [
        (datetime.now(timezone.utc) + timedelta(hours=h)).strftime("%Y-%m-%dT%H:00:00Z")
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
    log_prefix: str = "[Pipeline Scheduler]"
) -> int:
    """
    Common normalize-and-save loop used by all ingestion methods.
    Returns the number of successfully saved products.
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
                store.save_product(product, resolution=resolution)
                success_count += 1
                del product
                gc.collect()
                await asyncio.sleep(0.2)
        except Exception as e:
            logger.error(f"{log_prefix} Normalization error for {model} {layer} at hour index {idx}: {e}")

    return success_count
