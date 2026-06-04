import asyncio
import logging
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Any, Optional
from services.weather_pipeline.store import ProductStore
from services.weather_pipeline.providers.open_meteo_provider import OpenMeteoProvider
from services.weather_pipeline.providers.copernicus_provider import CopernicusProvider
from services.weather_pipeline.normalizer import WeatherNormalizer

logger = logging.getLogger(__name__)

# Configurable regional bounding boxes
REGIONAL_CONFIGS = {
    "florida_east_coast": {
        "west": -85.0,
        "south": 24.0,
        "east": -79.0,
        "north": 31.0,
        "resolution": 0.25
    }
}

class WeatherPipelineScheduler:
    """
    Orchestrates the background scheduled updates for the backend weather products.
    Enforces configurable regions and standard refresh cadences.
    """

    def __init__(self, store: Optional[ProductStore] = None):
        self.store = store or ProductStore()
        self.om_provider = OpenMeteoProvider()
        self.cop_provider = CopernicusProvider()
        self.normalizer = WeatherNormalizer()

    async def ingest_gfs_marine_pilot(self) -> bool:
        """
        Stage 2 Pilot: Ingests GFS waves grid forecast for Florida/East Coast.
        Fetches 48 hours of forecasts in 3-hour increments for waves, swell_1, swell_2, and wind_waves.
        """
        logger.info("[Pipeline Scheduler] Starting GFS Marine Ingestion job for all component layers...")
        region = REGIONAL_CONFIGS["florida_east_coast"]
        
        import os
        is_render = os.environ.get("RENDER") == "true"
        resolution = 0.5 if is_render else region["resolution"]

        # Open-Meteo GFS wave grid fetch - query conformed 12 variables at once
        raw_data = await self.om_provider.fetch_grid(
            model="GFS",
            domain="marine",
            layer="all_marine",
            bbox=region,
            resolution=resolution,
            forecast_days=2
        )

        import os
        is_test_env = (
            os.environ.get("NODE_ENV") == "test" or 
            os.environ.get("LOCAL_TEST_FIXTURE") == "true"
        )

        if not raw_data:
            if is_test_env:
                logger.warning("[Pipeline Scheduler] GFS Marine Ingestion: failed to fetch grid data. Injecting high-fidelity mock conformed raw data for offline/deployed fallback...")
                import math
                lats, lons = self.om_provider.generate_grid_coords(region, resolution)
                times = [(datetime.now(timezone.utc) + timedelta(hours=h)).strftime("%Y-%m-%dT%H:00:00Z") for h in range(0, 24)]
                mock_raw_results_waves = []
                for lat, lon in zip(lats, lons):
                    mock_raw_results_waves.append({
                        "latitude": lat,
                        "longitude": lon,
                        "hourly_units": {
                            "wave_height": "m",
                            "wave_direction": "°",
                            "wave_period": "s",
                            "swell_wave_height": "m",
                            "swell_wave_direction": "°",
                            "swell_wave_period": "s",
                            "secondary_swell_wave_height": "m",
                            "secondary_swell_wave_direction": "°",
                            "secondary_swell_wave_period": "s",
                            "wind_wave_height": "m",
                            "wind_wave_direction": "°",
                            "wind_wave_period": "s"
                        },
                        "hourly": {
                            "time": times,
                            "wave_height": [1.2 + 0.4 * math.sin(lat) for _ in times],
                            "wave_direction": [240.0 for _ in times],
                            "wave_period": [10.0 for _ in times],
                            "swell_wave_height": [0.8 + 0.3 * math.sin(lat) for _ in times],
                            "swell_wave_direction": [110.0 for _ in times],
                            "swell_wave_period": [8.0 for _ in times],
                            "secondary_swell_wave_height": [0.3 + 0.1 * math.sin(lat) for _ in times],
                            "secondary_swell_wave_direction": [140.0 for _ in times],
                            "secondary_swell_wave_period": [6.0 for _ in times],
                            "wind_wave_height": [0.5 + 0.2 * math.sin(lat) for _ in times],
                            "wind_wave_direction": [100.0 for _ in times],
                            "wind_wave_period": [5.0 for _ in times]
                        }
                    })
                results = mock_raw_results_waves
            else:
                logger.error("[Pipeline Scheduler] GFS Marine Ingestion: failed to fetch grid data. Ingestion failed (will not generate synthetic data in production/dev).")
                return False
        else:
            results = raw_data if isinstance(raw_data, list) else [raw_data]
        
        # 1. Map hourly valid times and run standard normalization loops
        first_pt = results[0]
        times = first_pt.get("hourly", {}).get("time", [])
        if not times:
            logger.error("[Pipeline Scheduler] Ingested GFS payload missing hourly times array.")
            return False

        run_time = datetime.now(timezone.utc)
        layers = ["waves", "swell_1", "swell_2", "wind_waves"]
        total_saved = 0

        for layer in layers:
            success_count = 0
            # Normalization and atomic cache slicing (every 3 hours to optimize file count)
            for idx, time_str in enumerate(times):
                if idx % 3 != 0:
                    continue # Slice every 3 hours
                    
                if not time_str.endswith("Z"):
                    time_str += "Z"
                target_dt = datetime.fromisoformat(time_str.replace("Z", "+00:00"))

                try:
                    product = self.normalizer.normalize(
                        model="GFS",
                        provider="open-meteo",
                        domain="marine",
                        layer=layer,
                        raw_results=results,
                        bbox=region,
                        resolution=resolution,
                        target_time=target_dt,
                        run_time=run_time
                    )
                    
                    if product:
                        self.store.save_product(product, resolution=resolution)
                        success_count += 1
                        del product
                        import gc
                        gc.collect()
                        await asyncio.sleep(0.2)
                except Exception as e:
                    logger.error(f"[Pipeline Scheduler] Normalization error for GFS {layer} at hour index {idx}: {e}")
            
            logger.info(f"[Pipeline Scheduler] Ingested {success_count} GFS {layer} products.")
            if success_count > 0:
                total_saved += success_count

        del results
        import gc
        gc.collect()
        logger.info(f"[Pipeline Scheduler] GFS Marine Ingestion Job done! Saved {total_saved} total conformed product files.")
        return total_saved > 0

    async def ingest_gfs_wind_pilot(self) -> bool:
        """
        Stage 3A Pilot: Ingests GFS wind grid forecast for Florida/East Coast.
        Fetches 48 hours of forecasts in 3-hour increments.
        """
        logger.info("[Pipeline Scheduler] Starting GFS Wind Pilot ingestion job...")
        region = REGIONAL_CONFIGS["florida_east_coast"]
        
        import os
        is_render = os.environ.get("RENDER") == "true"
        resolution = 0.5 if is_render else region["resolution"]

        # Open-Meteo GFS wind grid fetch
        raw_data = await self.om_provider.fetch_grid(
            model="GFS",
            domain="wind",
            layer="wind",
            bbox=region,
            resolution=resolution,
            forecast_days=2
        )

        import os
        is_test_env = (
            os.environ.get("NODE_ENV") == "test" or 
            os.environ.get("LOCAL_TEST_FIXTURE") == "true"
        )

        if not raw_data:
            if is_test_env:
                logger.warning("[Pipeline Scheduler] GFS Wind Ingestion: failed to fetch grid data. Injecting high-fidelity mock wind raw data for offline/deployed fallback...")
                import math
                lats, lons = self.om_provider.generate_grid_coords(region, resolution)
                times = [(datetime.now(timezone.utc) + timedelta(hours=h)).strftime("%Y-%m-%dT%H:00:00Z") for h in range(0, 24)]
                mock_raw_results_wind = []
                for lat, lon in zip(lats, lons):
                    mock_raw_results_wind.append({
                        "latitude": lat,
                        "longitude": lon,
                        "hourly_units": {
                            "wind_speed_10m": "kn",
                            "wind_direction_10m": "°"
                        },
                        "hourly": {
                            "time": times,
                            "wind_speed_10m": [8.5 + 2.5 * math.cos(lat) for _ in times],
                            "wind_direction_10m": [120.0 for _ in times]
                        }
                    })
                results = mock_raw_results_wind
            else:
                logger.error("[Pipeline Scheduler] GFS Wind Ingestion: failed to fetch grid data. Ingestion failed (will not generate synthetic data in production/dev).")
                return False
        else:
            results = raw_data if isinstance(raw_data, list) else [raw_data]
            first_pt = results[0]
            times = first_pt.get("hourly", {}).get("time", [])
            if not times:
                logger.error("[Pipeline Scheduler] Ingested GFS payload missing hourly times array.")
                return False

        run_time = datetime.now(timezone.utc)
        success_count = 0

        # Normalization and atomic cache slicing (every 3 hours)
        for idx, time_str in enumerate(times):
            if idx % 3 != 0:
                continue # Slice every 3 hours
                
            if not time_str.endswith("Z"):
                time_str += "Z"
            target_dt = datetime.fromisoformat(time_str.replace("Z", "+00:00"))

            try:
                product = self.normalizer.normalize(
                    model="GFS",
                    provider="open-meteo",
                    domain="wind",
                    layer="wind",
                    raw_results=results,
                    bbox=region,
                    resolution=resolution,
                    target_time=target_dt,
                    run_time=run_time
                )
                
                if product:
                    self.store.save_product(product, resolution=resolution)
                    success_count += 1
                    del product
                    import gc
                    gc.collect()
                    await asyncio.sleep(0.2)
            except Exception as e:
                logger.error(f"[Pipeline Scheduler] Normalization error at hour index {idx}: {e}")

        del results
        import gc
        gc.collect()
        logger.info(f"[Pipeline Scheduler] GFS Wind Ingestion Job done! Saved {success_count} hourly grid files.")
        return success_count > 0

    async def ingest_gfs_pressure_pilot(self) -> bool:
        """
        Stage 6D Pilot: Ingests GFS pressure grid forecast for Florida/East Coast.
        Fetches 48 hours of forecasts in 3-hour increments.
        """
        logger.info("[Pipeline Scheduler] Starting GFS Pressure Pilot ingestion job...")
        region = REGIONAL_CONFIGS["florida_east_coast"]
        
        import os
        is_render = os.environ.get("RENDER") == "true"
        resolution = 0.5 if is_render else region["resolution"]

        # Open-Meteo GFS pressure grid fetch
        raw_data = await self.om_provider.fetch_grid(
            model="GFS",
            domain="weather",
            layer="pressure",
            bbox=region,
            resolution=resolution,
            forecast_days=2
        )

        import os
        is_test_env = (
            os.environ.get("NODE_ENV") == "test" or 
            os.environ.get("LOCAL_TEST_FIXTURE") == "true"
        )

        if not raw_data:
            if is_test_env:
                logger.warning("[Pipeline Scheduler] GFS Pressure Ingestion: failed to fetch grid data. Injecting high-fidelity mock pressure raw data for offline/deployed fallback...")
                import math
                lats, lons = self.om_provider.generate_grid_coords(region, resolution)
                times = [(datetime.now(timezone.utc) + timedelta(hours=h)).strftime("%Y-%m-%dT%H:00:00Z") for h in range(0, 24)]
                mock_raw_results_pressure = []
                for lat, lon in zip(lats, lons):
                    mock_raw_results_pressure.append({
                        "latitude": lat,
                        "longitude": lon,
                        "hourly_units": {
                            "pressure_msl": "hPa"
                        },
                        "hourly": {
                            "time": times,
                            "pressure_msl": [1013.2 + 2.5 * math.sin(lat) for _ in times]
                        }
                    })
                results = mock_raw_results_pressure
            else:
                logger.error("[Pipeline Scheduler] GFS Pressure Ingestion: failed to fetch grid data. Ingestion failed (will not generate synthetic data in production/dev).")
                return False
        else:
            results = raw_data if isinstance(raw_data, list) else [raw_data]

        first_pt = results[0]
        times = first_pt.get("hourly", {}).get("time", [])
        if not times:
            logger.error("[Pipeline Scheduler] Ingested GFS pressure payload missing hourly times array.")
            return False

        run_time = datetime.now(timezone.utc)
        success_count = 0

        # Normalization and atomic cache slicing (every 3 hours)
        for idx, time_str in enumerate(times):
            if idx % 3 != 0:
                continue # Slice every 3 hours
                
            if not time_str.endswith("Z"):
                time_str += "Z"
            target_dt = datetime.fromisoformat(time_str.replace("Z", "+00:00"))

            try:
                product = self.normalizer.normalize(
                    model="GFS",
                    provider="open-meteo",
                    domain="weather",
                    layer="pressure",
                    raw_results=results,
                    bbox=region,
                    resolution=resolution,
                    target_time=target_dt,
                    run_time=run_time
                )
                
                if product:
                    self.store.save_product(product, resolution=resolution)
                    success_count += 1
                    del product
                    import gc
                    gc.collect()
                    await asyncio.sleep(0.2)
            except Exception as e:
                logger.error(f"[Pipeline Scheduler] Normalization error at hour index {idx}: {e}")

        del results
        import gc
        gc.collect()
        logger.info(f"[Pipeline Scheduler] GFS Pressure Ingestion Job done! Saved {success_count} hourly grid files.")
        return success_count > 0

    async def ingest_icon_pressure_pilot(self) -> bool:
        """
        Stage 6E Pilot: Ingests ICON pressure grid forecast for Florida/East Coast.
        Fetches 48 hours of forecasts in 3-hour increments.
        """
        logger.info("[Pipeline Scheduler] Starting ICON Pressure Pilot ingestion job...")
        region = REGIONAL_CONFIGS["florida_east_coast"]
        
        import os
        is_render = os.environ.get("RENDER") == "true"
        resolution = 0.5 if is_render else region["resolution"]

        # Open-Meteo ICON pressure grid fetch
        raw_data = await self.om_provider.fetch_grid(
            model="ICON",
            domain="weather",
            layer="pressure",
            bbox=region,
            resolution=resolution,
            forecast_days=2
        )

        import os
        is_test_env = (
            os.environ.get("NODE_ENV") == "test" or 
            os.environ.get("LOCAL_TEST_FIXTURE") == "true"
        )

        if not raw_data:
            if is_test_env:
                logger.warning("[Pipeline Scheduler] ICON Pressure Ingestion: failed to fetch grid data. Injecting high-fidelity mock pressure raw data for offline/deployed fallback...")
                import math
                lats, lons = self.om_provider.generate_grid_coords(region, resolution)
                times = [(datetime.now(timezone.utc) + timedelta(hours=h)).strftime("%Y-%m-%dT%H:00:00Z") for h in range(0, 24)]
                mock_raw_results_pressure = []
                for lat, lon in zip(lats, lons):
                    mock_raw_results_pressure.append({
                        "latitude": lat,
                        "longitude": lon,
                        "hourly_units": {
                            "pressure_msl": "hPa"
                        },
                        "hourly": {
                            "time": times,
                            "pressure_msl": [1013.2 + 2.5 * math.sin(lat) for _ in times]
                        }
                    })
                results = mock_raw_results_pressure
            else:
                logger.error("[Pipeline Scheduler] ICON Pressure Ingestion: failed to fetch grid data. Ingestion failed.")
                return False
        else:
            results = raw_data if isinstance(raw_data, list) else [raw_data]

        first_pt = results[0]
        times = first_pt.get("hourly", {}).get("time", [])
        if not times:
            logger.error("[Pipeline Scheduler] Ingested ICON pressure payload missing hourly times array.")
            return False

        run_time = datetime.now(timezone.utc)
        success_count = 0

        # Normalization and atomic cache slicing (every 3 hours)
        for idx, time_str in enumerate(times):
            if idx % 3 != 0:
                continue
                
            if not time_str.endswith("Z"):
                time_str += "Z"
            target_dt = datetime.fromisoformat(time_str.replace("Z", "+00:00"))

            try:
                product = self.normalizer.normalize(
                    model="ICON",
                    provider="open-meteo",
                    domain="weather",
                    layer="pressure",
                    raw_results=results,
                    bbox=region,
                    resolution=resolution,
                    target_time=target_dt,
                    run_time=run_time
                )
                
                if product:
                    self.store.save_product(product, resolution=resolution)
                    success_count += 1
                    del product
                    import gc
                    gc.collect()
                    await asyncio.sleep(0.2)
            except Exception as e:
                logger.error(f"[Pipeline Scheduler] Normalization error for ICON pressure at hour index {idx}: {e}")

        del results
        import gc
        gc.collect()
        logger.info(f"[Pipeline Scheduler] ICON Pressure Ingestion Job done! Saved {success_count} hourly grid files.")
        return success_count > 0

    async def ingest_euro_pressure_pilot(self) -> bool:
        """
        Stage 6E Pilot: Ingests EURO pressure grid forecast for Florida/East Coast.
        Fetches 48 hours of forecasts in 3-hour increments.
        """
        logger.info("[Pipeline Scheduler] Starting EURO Pressure Pilot ingestion job...")
        region = REGIONAL_CONFIGS["florida_east_coast"]
        
        import os
        is_render = os.environ.get("RENDER") == "true"
        resolution = 0.5 if is_render else region["resolution"]

        # Open-Meteo EURO pressure grid fetch
        raw_data = await self.om_provider.fetch_grid(
            model="EURO",
            domain="weather",
            layer="pressure",
            bbox=region,
            resolution=resolution,
            forecast_days=2
        )

        import os
        is_test_env = (
            os.environ.get("NODE_ENV") == "test" or 
            os.environ.get("LOCAL_TEST_FIXTURE") == "true"
        )

        if not raw_data:
            if is_test_env:
                logger.warning("[Pipeline Scheduler] EURO Pressure Ingestion: failed to fetch grid data. Injecting high-fidelity mock pressure raw data for offline/deployed fallback...")
                import math
                lats, lons = self.om_provider.generate_grid_coords(region, resolution)
                times = [(datetime.now(timezone.utc) + timedelta(hours=h)).strftime("%Y-%m-%dT%H:00:00Z") for h in range(0, 24)]
                mock_raw_results_pressure = []
                for lat, lon in zip(lats, lons):
                    mock_raw_results_pressure.append({
                        "latitude": lat,
                        "longitude": lon,
                        "hourly_units": {
                            "pressure_msl": "hPa"
                        },
                        "hourly": {
                            "time": times,
                            "pressure_msl": [1013.2 + 2.5 * math.sin(lat) for _ in times]
                        }
                    })
                results = mock_raw_results_pressure
            else:
                logger.error("[Pipeline Scheduler] EURO Pressure Ingestion: failed to fetch grid data. Ingestion failed.")
                return False
        else:
            results = raw_data if isinstance(raw_data, list) else [raw_data]

        first_pt = results[0]
        times = first_pt.get("hourly", {}).get("time", [])
        if not times:
            logger.error("[Pipeline Scheduler] Ingested EURO pressure payload missing hourly times array.")
            return False

        run_time = datetime.now(timezone.utc)
        success_count = 0

        # Normalization and atomic cache slicing (every 3 hours)
        for idx, time_str in enumerate(times):
            if idx % 3 != 0:
                continue
                
            if not time_str.endswith("Z"):
                time_str += "Z"
            target_dt = datetime.fromisoformat(time_str.replace("Z", "+00:00"))

            try:
                product = self.normalizer.normalize(
                    model="EURO",
                    provider="open-meteo",
                    domain="weather",
                    layer="pressure",
                    raw_results=results,
                    bbox=region,
                    resolution=resolution,
                    target_time=target_dt,
                    run_time=run_time
                )
                
                if product:
                    self.store.save_product(product, resolution=resolution)
                    success_count += 1
                    del product
                    import gc
                    gc.collect()
                    await asyncio.sleep(0.2)
            except Exception as e:
                logger.error(f"[Pipeline Scheduler] Normalization error for EURO pressure at hour index {idx}: {e}")

        del results
        import gc
        gc.collect()
        logger.info(f"[Pipeline Scheduler] EURO Pressure Ingestion Job done! Saved {success_count} hourly grid files.")
        return success_count > 0

    async def ingest_copernicus_regional(self) -> bool:
        """
        Stage 4 Ingestion: Scheduled fetch of Copernicus regional wave component layers (swell_1)
        at a 6-hour refresh cadence.
        """
        logger.info("[Pipeline Scheduler] Starting Copernicus Regional Ingestion job...")
        region = REGIONAL_CONFIGS["florida_east_coast"]
        layers = ["waves", "swell_1", "swell_2", "wind_waves"]
        run_time = datetime.now(timezone.utc)
        total_success = 0

        # Detect test fixture environment flags
        import os
        is_test_env = (
            os.environ.get("NODE_ENV") == "test" or 
            os.environ.get("LOCAL_TEST_FIXTURE") == "true"
        )

        for layer in layers:
            # Check if credentials are configured
            has_credentials = bool(
                os.environ.get("COPERNICUSMARINE_SERVICE_USERNAME") and
                os.environ.get("COPERNICUSMARINE_SERVICE_PASSWORD")
            )
            
            results = None
            res_to_save = 0.5
            provider_name = "copernicus"
            
            if has_credentials:
                # Copernicus NetCDF regional slice fetch
                results = await self.cop_provider.fetch_grid(
                    layer=layer,
                    bbox=region,
                    resolution=0.5, # Slightly lower resolution to guarantee Render runtime stability
                    forecast_days=1 if os.environ.get("RENDER") == "true" else 3
                )
            else:
                logger.warning("[Pipeline Scheduler] Copernicus credentials not configured. Skipping CMEMS fetch.")

            if not results:
                if is_test_env:
                    logger.info("[Pipeline Scheduler] Test environment active. Generating isolated mock Copernicus test fixture...")
                    import math
                    mock_res = 1.5 # Coarser resolution to scale down coords count and save memory/CPU
                    res_to_save = mock_res
                    provider_name = "test-fixture"
                    lats, lons = OpenMeteoProvider.generate_grid_coords(region, mock_res)
                    # Generate hourly times for the next 72 hours matching GFS times (in 3-hourly steps)
                    times = [(datetime.now(timezone.utc) + timedelta(hours=h)).strftime("%Y-%m-%dT%H:00:00Z") for h in range(0, 72, 3)]
                    mock_results = []
                    for lat, lon in zip(lats, lons):
                        mock_results.append({
                            "latitude": lat,
                            "longitude": lon,
                            "generationtime_ms": 0,
                            "utc_offset_seconds": 0,
                            "timezone": "GMT",
                            "timezone_abbreviation": "GMT",
                            "elevation": 0,
                            "__provider": "test-fixture",
                            "hourly_units": {
                                "time": "iso8601",
                                "swell_wave_height": "m",
                                "swell_wave_direction": "°",
                                "swell_wave_period": "s",
                                "secondary_swell_wave_height": "m",
                                "secondary_swell_wave_direction": "°",
                                "secondary_swell_wave_period": "s",
                                "wind_wave_height": "m",
                                "wind_wave_direction": "°",
                                "wind_wave_period": "s",
                                "wave_height": "m",
                                "wave_direction": "°",
                                "wave_period": "s"
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
                                "wave_period": [10.0 for _ in times]
                            }
                        })
                    results = mock_results
                else:
                    logger.error(f"[Pipeline Scheduler] Copernicus Ingestion: failed to fetch grid for layer: {layer}. No credentials or CMEMS error. Ingestion failed (will not generate synthetic data in production/dev).")
                    continue

            first_pt = results[0]
            times = first_pt.get("hourly", {}).get("time", [])
            if not times:
                logger.error(f"[Pipeline Scheduler] Copernicus layer {layer} missing times.")
                continue

            for idx, time_str in enumerate(times):
                # Save all 3-hourly conformed frames to database to align with frontend timelines
                pass

                if not time_str.endswith("Z"):
                    time_str += "Z"
                target_dt = datetime.fromisoformat(time_str.replace("Z", "+00:00"))

                try:
                    product = self.normalizer.normalize(
                        model="EURO",
                        provider=provider_name,
                        domain="marine",
                        layer=layer,
                        raw_results=results,
                        bbox=region,
                        resolution=res_to_save,
                        target_time=target_dt,
                        run_time=run_time
                    )
                    
                    if product:
                        self.store.save_product(product, resolution=res_to_save)
                        total_success += 1
                        del product
                        import gc
                        gc.collect()
                        await asyncio.sleep(0.2)
                except Exception as e:
                    logger.error(f"[Pipeline Scheduler] Copernicus normalize error for {layer} at {time_str}: {e}")

            del results
            import gc
            gc.collect()

        logger.info(f"[Pipeline Scheduler] Copernicus Ingestion Job completed! Saved {total_success} product files.")
        return total_success > 0

    async def ingest_icon_marine_pilot(self) -> bool:
        """
        Stage 4F.1: Ingests ICON/gwam marine grid forecast for Florida/East Coast.
        Fetches 48 hours of forecasts in 3-hour increments for waves, swell_1, and wind_waves.
        Swell 2 is unsupported and will not be ingested.
        """
        logger.info("[Pipeline Scheduler] Starting ICON Marine Ingestion job for supported layers...")
        region = REGIONAL_CONFIGS["florida_east_coast"]
        
        import os
        is_render = os.environ.get("RENDER") == "true"
        resolution = 0.5 if is_render else region["resolution"]

        # Open-Meteo ICON wave grid fetch - models=gwam (DWD Global Wave Model)
        raw_data = await self.om_provider.fetch_grid(
            model="ICON",
            domain="marine",
            layer="all_marine",
            bbox=region,
            resolution=resolution,
            forecast_days=2
        )

        is_test_env = (
            os.environ.get("NODE_ENV") == "test" or 
            os.environ.get("LOCAL_TEST_FIXTURE") == "true"
        )

        if not raw_data:
            if is_test_env:
                logger.warning("[Pipeline Scheduler] ICON Marine Ingestion: failed to fetch grid data. Injecting high-fidelity mock conformed raw data for offline/deployed fallback...")
                import math
                lats, lons = self.om_provider.generate_grid_coords(region, resolution)
                times = [(datetime.now(timezone.utc) + timedelta(hours=h)).strftime("%Y-%m-%dT%H:00:00Z") for h in range(0, 24)]
                mock_raw_results = []
                for lat, lon in zip(lats, lons):
                    mock_raw_results.append({
                        "latitude": lat,
                        "longitude": lon,
                        "hourly_units": {
                            "wave_height": "m",
                            "wave_direction": "°",
                            "wave_period": "s",
                            "swell_wave_height": "m",
                            "swell_wave_direction": "°",
                            "swell_wave_period": "s",
                            "wind_wave_height": "m",
                            "wind_wave_direction": "°",
                            "wind_wave_period": "s"
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
                            "wind_wave_period": [4.5 for _ in times]
                        }
                    })
                results = mock_raw_results
            else:
                logger.error("[Pipeline Scheduler] ICON Marine Ingestion: failed to fetch grid data from Open-Meteo. Ingestion aborted.")
                return False
        else:
            results = raw_data if isinstance(raw_data, list) else [raw_data]

        first_pt = results[0]
        times = first_pt.get("hourly", {}).get("time", [])
        if not times:
            logger.error("[Pipeline Scheduler] Ingested ICON payload missing hourly times array.")
            return False

        run_time = datetime.now(timezone.utc)
        layers = ["waves", "swell_1", "wind_waves"] # Swell 2 is unsupported, skip completely!
        total_saved = 0

        for layer in layers:
            success_count = 0
            for idx, time_str in enumerate(times):
                if idx % 3 != 0:
                    continue
                if not time_str.endswith("Z"):
                    time_str += "Z"
                target_dt = datetime.fromisoformat(time_str.replace("Z", "+00:00"))

                try:
                    product = self.normalizer.normalize(
                        model="ICON",
                        provider="open-meteo" if not is_test_env or raw_data else "test-fixture",
                        domain="marine",
                        layer=layer,
                        raw_results=results,
                        bbox=region,
                        resolution=resolution,
                        target_time=target_dt,
                        run_time=run_time
                    )
                    
                    if product:
                        # Double-check is_test_fixture guard for deployed products (Correction 2)
                        if not is_test_env and product.is_test_fixture:
                            logger.error(f"[Pipeline Scheduler] Security violation: trying to save test fixture product in non-test environment.")
                            continue
                        self.store.save_product(product, resolution=resolution)
                        success_count += 1
                        del product
                        import gc
                        gc.collect()
                        await asyncio.sleep(0.2)
                except Exception as e:
                    logger.error(f"[Pipeline Scheduler] Normalization error for ICON {layer} at hour index {idx}: {e}")
            
            logger.info(f"[Pipeline Scheduler] Ingested {success_count} ICON {layer} products.")
            if success_count > 0:
                total_saved += success_count

        del results
        import gc
        gc.collect()
        logger.info(f"[Pipeline Scheduler] ICON Marine Ingestion Job done! Saved {total_saved} total conformed product files.")
        return total_saved > 0

    async def ingest_icon_wind_pilot(self) -> bool:
        """
        Stage 5C: Ingests ICON wind grid forecast for Florida/East Coast.
        Fetches 48 hours of forecasts in 3-hour increments.
        """
        logger.info("[Pipeline Scheduler] Starting ICON Wind Pilot ingestion job...")
        region = REGIONAL_CONFIGS["florida_east_coast"]
        
        import os
        is_render = os.environ.get("RENDER") == "true"
        resolution = 0.5 if is_render else region["resolution"]

        # Open-Meteo ICON wind grid fetch
        raw_data = await self.om_provider.fetch_grid(
            model="ICON",
            domain="wind",
            layer="wind",
            bbox=region,
            resolution=resolution,
            forecast_days=2
        )

        import os
        is_test_env = (
            os.environ.get("NODE_ENV") == "test" or 
            os.environ.get("LOCAL_TEST_FIXTURE") == "true"
        )

        if not raw_data:
            if is_test_env:
                logger.warning("[Pipeline Scheduler] ICON Wind Ingestion: failed to fetch grid data. Injecting high-fidelity mock wind raw data for offline/deployed fallback...")
                import math
                lats, lons = self.om_provider.generate_grid_coords(region, resolution)
                times = [(datetime.now(timezone.utc) + timedelta(hours=h)).strftime("%Y-%m-%dT%H:00:00Z") for h in range(0, 24)]
                mock_raw_results_wind = []
                for lat, lon in zip(lats, lons):
                    mock_raw_results_wind.append({
                        "latitude": lat,
                        "longitude": lon,
                        "hourly_units": {
                            "wind_speed_10m": "kn",
                            "wind_direction_10m": "°",
                            "wind_gusts_10m": "kn"
                        },
                        "hourly": {
                            "time": times,
                            "wind_speed_10m": [7.5 + 2.0 * math.cos(lat) for _ in times],
                            "wind_direction_10m": [110.0 for _ in times],
                            "wind_gusts_10m": [12.0 + 3.0 * math.cos(lat) for _ in times]
                        }
                    })
                results = mock_raw_results_wind
            else:
                logger.error("[Pipeline Scheduler] ICON Wind Ingestion: failed to fetch grid data. Ingestion failed.")
                return False
        else:
            results = raw_data if isinstance(raw_data, list) else [raw_data]
            first_pt = results[0]
            times = first_pt.get("hourly", {}).get("time", [])
            if not times:
                logger.error("[Pipeline Scheduler] Ingested ICON wind payload missing hourly times array.")
                return False

        run_time = datetime.now(timezone.utc)
        success_count = 0

        # Normalization and atomic cache slicing (every 3 hours)
        for idx, time_str in enumerate(times):
            if idx % 3 != 0:
                continue # Slice every 3 hours
                
            if not time_str.endswith("Z"):
                time_str += "Z"
            target_dt = datetime.fromisoformat(time_str.replace("Z", "+00:00"))

            try:
                product = self.normalizer.normalize(
                    model="ICON",
                    provider="open-meteo" if not is_test_env or raw_data else "test-fixture",
                    domain="wind",
                    layer="wind",
                    raw_results=results,
                    bbox=region,
                    resolution=resolution,
                    target_time=target_dt,
                    run_time=run_time
                )
                
                if product:
                    if not is_test_env and product.is_test_fixture:
                        logger.error(f"[Pipeline Scheduler] Security violation: trying to save test fixture product in non-test environment.")
                        continue
                    self.store.save_product(product, resolution=resolution)
                    success_count += 1
                    del product
                    import gc
                    gc.collect()
                    await asyncio.sleep(0.2)
            except Exception as e:
                logger.error(f"[Pipeline Scheduler] Normalization error for ICON wind at hour index {idx}: {e}")

        del results
        import gc
        gc.collect()
        logger.info(f"[Pipeline Scheduler] ICON Wind Ingestion Job done! Saved {success_count} hourly grid files.")
        return success_count > 0

    async def ingest_euro_wind_pilot(self) -> bool:
        """
        Stage 5D: Ingests EURO wind grid forecast for Florida/East Coast.
        Fetches 48 hours of forecasts in 3-hour increments.
        """
        logger.info("[Pipeline Scheduler] Starting EURO Wind Pilot ingestion job...")
        region = REGIONAL_CONFIGS["florida_east_coast"]
        
        import os
        is_render = os.environ.get("RENDER") == "true"
        resolution = 0.5 if is_render else region["resolution"]

        # Open-Meteo EURO wind grid fetch
        raw_data = await self.om_provider.fetch_grid(
            model="EURO",
            domain="wind",
            layer="wind",
            bbox=region,
            resolution=resolution,
            forecast_days=2
        )

        import os
        is_test_env = (
            os.environ.get("NODE_ENV") == "test" or 
            os.environ.get("LOCAL_TEST_FIXTURE") == "true"
        )

        if not raw_data:
            if is_test_env:
                logger.warning("[Pipeline Scheduler] EURO Wind Ingestion: failed to fetch grid data. Injecting high-fidelity mock wind raw data for offline/deployed fallback...")
                import math
                lats, lons = self.om_provider.generate_grid_coords(region, resolution)
                times = [(datetime.now(timezone.utc) + timedelta(hours=h)).strftime("%Y-%m-%dT%H:00:00Z") for h in range(0, 24)]
                mock_raw_results_wind = []
                for lat, lon in zip(lats, lons):
                    mock_raw_results_wind.append({
                        "latitude": lat,
                        "longitude": lon,
                        "hourly_units": {
                            "wind_speed_10m": "kn",
                            "wind_direction_10m": "°",
                            "wind_gusts_10m": "kn"
                        },
                        "hourly": {
                            "time": times,
                            "wind_speed_10m": [6.5 + 1.5 * math.cos(lat) for _ in times],
                            "wind_direction_10m": [100.0 for _ in times],
                            "wind_gusts_10m": [10.0 + 2.0 * math.cos(lat) for _ in times]
                        }
                    })
                results = mock_raw_results_wind
            else:
                logger.error("[Pipeline Scheduler] EURO Wind Ingestion: failed to fetch grid data. Ingestion failed.")
                return False
        else:
            results = raw_data if isinstance(raw_data, list) else [raw_data]
            first_pt = results[0]
            times = first_pt.get("hourly", {}).get("time", [])
            if not times:
                logger.error("[Pipeline Scheduler] Ingested EURO wind payload missing hourly times array.")
                return False

        run_time = datetime.now(timezone.utc)
        success_count = 0

        # Normalization and atomic cache slicing (every 3 hours)
        for idx, time_str in enumerate(times):
            if idx % 3 != 0:
                continue # Slice every 3 hours
                
            if not time_str.endswith("Z"):
                time_str += "Z"
            target_dt = datetime.fromisoformat(time_str.replace("Z", "+00:00"))

            try:
                product = self.normalizer.normalize(
                    model="EURO",
                    provider="open-meteo" if not is_test_env or raw_data else "test-fixture",
                    domain="wind",
                    layer="wind",
                    raw_results=results,
                    bbox=region,
                    resolution=resolution,
                    target_time=target_dt,
                    run_time=run_time
                )
                
                if product:
                    if not is_test_env and product.is_test_fixture:
                        logger.error(f"[Pipeline Scheduler] Security violation: trying to save test fixture product in non-test environment.")
                        continue
                    self.store.save_product(product, resolution=resolution)
                    success_count += 1
                    del product
                    import gc
                    gc.collect()
                    await asyncio.sleep(0.2)
            except Exception as e:
                logger.error(f"[Pipeline Scheduler] Normalization error for EURO wind at hour index {idx}: {e}")

        del results
        import gc
        gc.collect()
        logger.info(f"[Pipeline Scheduler] EURO Wind Ingestion Job done! Saved {success_count} hourly grid files.")
        return success_count > 0


