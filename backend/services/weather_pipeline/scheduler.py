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
        Fetches 48 hours of forecasts in 3-hour increments.
        """
        logger.info("[Pipeline Scheduler] Starting GFS Marine Pilot ingestion job...")
        region = REGIONAL_CONFIGS["florida_east_coast"]
        
        # Open-Meteo GFS wave grid fetch
        raw_data = await self.om_provider.fetch_grid(
            model="GFS",
            domain="marine",
            layer="waves",
            bbox=region,
            resolution=region["resolution"],
            forecast_days=2
        )

        if not raw_data:
            logger.error("[Pipeline Scheduler] GFS Marine Ingestion: failed to fetch grid data.")
            return False

        # Open-Meteo returns a batch array, process each coordinate point
        results = raw_data if isinstance(raw_data, list) else [raw_data]
        
        # 1. Map hourly valid times and run standard normalization loops
        first_pt = results[0]
        times = first_pt.get("hourly", {}).get("time", [])
        if not times:
            logger.error("[Pipeline Scheduler] Ingested GFS payload missing hourly times array.")
            return False

        run_time = datetime.now(timezone.utc)
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
                    layer="waves",
                    raw_results=results,
                    bbox=region,
                    resolution=region["resolution"],
                    target_time=target_dt,
                    run_time=run_time
                )
                
                if product:
                    self.store.save_product(product, resolution=region["resolution"])
                    success_count += 1
            except Exception as e:
                logger.error(f"[Pipeline Scheduler] Normalization error at hour index {idx}: {e}")

        logger.info(f"[Pipeline Scheduler] GFS Marine Ingestion Job done! Saved {success_count} hourly grid files.")
        return success_count > 0

    async def ingest_gfs_wind_pilot(self) -> bool:
        """
        Stage 3A Pilot: Ingests GFS wind grid forecast for Florida/East Coast.
        Fetches 48 hours of forecasts in 3-hour increments.
        """
        logger.info("[Pipeline Scheduler] Starting GFS Wind Pilot ingestion job...")
        region = REGIONAL_CONFIGS["florida_east_coast"]
        
        # Open-Meteo GFS wind grid fetch
        raw_data = await self.om_provider.fetch_grid(
            model="GFS",
            domain="wind",
            layer="wind",
            bbox=region,
            resolution=region["resolution"],
            forecast_days=2
        )

        if not raw_data:
            logger.error("[Pipeline Scheduler] GFS Wind Ingestion: failed to fetch grid data.")
            return False

        # Process coordinates points
        results = raw_data if isinstance(raw_data, list) else [raw_data]
        
        # 1. Map hourly valid times and run standard normalization loops
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
                    resolution=region["resolution"],
                    target_time=target_dt,
                    run_time=run_time
                )
                
                if product:
                    self.store.save_product(product, resolution=region["resolution"])
                    success_count += 1
            except Exception as e:
                logger.error(f"[Pipeline Scheduler] Normalization error at hour index {idx}: {e}")

        logger.info(f"[Pipeline Scheduler] GFS Wind Ingestion Job done! Saved {success_count} hourly grid files.")
        return success_count > 0

    async def ingest_copernicus_regional(self) -> bool:
        """
        Stage 4 Ingestion: Scheduled fetch of Copernicus regional wave component layers (swell_1, swell_2, wind_waves)
        at a 6-hour refresh cadence.
        """
        logger.info("[Pipeline Scheduler] Starting Copernicus Regional Ingestion job...")
        region = REGIONAL_CONFIGS["florida_east_coast"]
        layers = ["swell_1", "swell_2", "wind_waves"]
        run_time = datetime.now(timezone.utc)
        total_success = 0

        for layer in layers:
            # Copernicus NetCDF regional slice fetch
            results = await self.cop_provider.fetch_grid(
                layer=layer,
                bbox=region,
                resolution=0.5, # Slightly lower resolution to guarantee Render runtime stability
                forecast_days=3
            )

            if not results:
                logger.error(f"[Pipeline Scheduler] Copernicus Ingestion: failed to fetch grid for layer: {layer}")
                continue

            first_pt = results[0]
            times = first_pt.get("hourly", {}).get("time", [])
            if not times:
                logger.error(f"[Pipeline Scheduler] Copernicus layer {layer} missing times.")
                continue

            for idx, time_str in enumerate(times):
                if idx % 6 != 0:
                    continue # Slice every 6 hours as approved

                if not time_str.endswith("Z"):
                    time_str += "Z"
                target_dt = datetime.fromisoformat(time_str.replace("Z", "+00:00"))

                try:
                    product = self.normalizer.normalize(
                        model="EURO",
                        provider="copernicus",
                        domain="marine",
                        layer=layer,
                        raw_results=results,
                        bbox=region,
                        resolution=0.5,
                        target_time=target_dt,
                        run_time=run_time
                    )
                    
                    if product:
                        self.store.save_product(product, resolution=0.5)
                        total_success += 1
                except Exception as e:
                    logger.error(f"[Pipeline Scheduler] Copernicus normalize error for {layer} at {time_str}: {e}")

        logger.info(f"[Pipeline Scheduler] Copernicus Ingestion Job completed! Saved {total_success} product files.")
        return total_success > 0
