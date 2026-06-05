import asyncio
import logging
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Any, Optional
from services.weather_pipeline.store import ProductStore
from services.weather_pipeline.providers.open_meteo_provider import OpenMeteoProvider
from services.weather_pipeline.providers.copernicus_provider import CopernicusProvider
from services.weather_pipeline.normalizer import WeatherNormalizer
from services.weather_pipeline.scheduler_helpers import (
    get_env_flags,
    generate_mock_marine_results,
    generate_mock_icon_marine_results,
    generate_mock_wind_results,
    generate_mock_pressure_results,
    generate_mock_copernicus_results,
    normalize_and_save_loop,
)

logger = logging.getLogger(__name__)

# Configurable regional bounding boxes
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

    def _get_resolution(self, region: dict, is_render: bool) -> float:
        return 0.5 if is_render else region["resolution"]

    async def _fetch_or_mock(self, model: str, domain: str, layer: str,
                             region: dict, resolution: float, forecast_days: int,
                             is_test_env: bool, mock_fn, region_id: str = "") -> Optional[list]:
        """Fetch grid from provider, falling back to mock data in test environments."""
        raw_data = await self.om_provider.fetch_grid(
            model=model, domain=domain, layer=layer,
            bbox=region, resolution=resolution, forecast_days=forecast_days
        )
        if raw_data:
            return raw_data if isinstance(raw_data, list) else [raw_data]

        if is_test_env:
            logger.warning(f"[Pipeline Scheduler] {model} {domain}/{layer} fetch failed for {region_id or 'default'}. Injecting mock data...")
            return mock_fn()

        logger.error(f"[Pipeline Scheduler] {model} {domain}/{layer} fetch failed for {region_id or 'default'}. Skipping.")
        return None

    async def _cleanup_and_pause(self, results, pause: float = 1.0):
        """Delete results and pause between region iterations."""
        import gc
        del results
        gc.collect()
        await asyncio.sleep(pause)

    async def ingest_gfs_marine_pilot(self) -> bool:
        """
        Stage 2 / 6H.2 Pilot: Ingests GFS waves grid forecast for all configured regions.
        Fetches 48 hours of forecasts in 3-hour increments for waves, swell_1, swell_2, and wind_waves.
        """
        logger.info("[Pipeline Scheduler] Starting GFS Marine Ingestion job for all regions...")
        env = get_env_flags()
        run_time = datetime.now(timezone.utc)
        total_saved = 0

        for region_id, region in REGIONAL_CONFIGS.items():
            resolution = self._get_resolution(region, env["is_render"])
            logger.info(f"[Pipeline Scheduler] Ingesting GFS Marine for region: {region_id}")

            results = await self._fetch_or_mock(
                "GFS", "marine", "all_marine", region, resolution, 2,
                env["is_test_env"],
                lambda: generate_mock_marine_results(self.om_provider, region, resolution),
                region_id
            )
            if not results:
                continue

            # Swell 2 is not requested for SoCal
            layers = ["waves", "swell_1", "wind_waves"] if region_id == "us_west_coast_socal" \
                else ["waves", "swell_1", "swell_2", "wind_waves"]

            for layer in layers:
                count = await normalize_and_save_loop(
                    self.normalizer, self.store, results,
                    model="GFS", provider="open-meteo", domain="marine", layer=layer,
                    bbox=region, resolution=resolution, run_time=run_time,
                    region_id=region_id, coverage_mode="regional_tile",
                    is_test_env=env["is_test_env"],
                    log_prefix=f"[Pipeline Scheduler] GFS {layer} {region_id}"
                )
                logger.info(f"[Pipeline Scheduler] Ingested {count} GFS {layer} products for region {region_id}.")
                total_saved += count

            await self._cleanup_and_pause(results)

        logger.info(f"[Pipeline Scheduler] GFS Marine Ingestion Job done! Saved {total_saved} total conformed product files.")
        return total_saved > 0

    async def ingest_gfs_wind_pilot(self) -> bool:
        """
        Stage 3A/6H.1: Ingests GFS wind grid forecast for all configured regions.
        Fetches 48 hours of forecasts in 3-hour increments.
        """
        logger.info("[Pipeline Scheduler] Starting GFS Wind Ingestion job for all regions...")
        env = get_env_flags()
        run_time = datetime.now(timezone.utc)
        total_saved = 0

        for region_id, region in REGIONAL_CONFIGS.items():
            resolution = self._get_resolution(region, env["is_render"])
            logger.info(f"[Pipeline Scheduler] Ingesting GFS Wind for region: {region_id}")

            results = await self._fetch_or_mock(
                "GFS", "wind", "wind", region, resolution, 2,
                env["is_test_env"],
                lambda: generate_mock_wind_results(self.om_provider, region, resolution),
                region_id
            )
            if not results:
                continue

            count = await normalize_and_save_loop(
                self.normalizer, self.store, results,
                model="GFS", provider="open-meteo", domain="wind", layer="wind",
                bbox=region, resolution=resolution, run_time=run_time,
                region_id=region_id, coverage_mode="regional_tile",
                is_test_env=env["is_test_env"],
                log_prefix=f"[Pipeline Scheduler] GFS wind {region_id}"
            )
            logger.info(f"[Pipeline Scheduler] Ingested {count} GFS Wind grid files for region {region_id}.")
            total_saved += count
            await self._cleanup_and_pause(results)

        return total_saved > 0

    async def ingest_gfs_pressure_pilot(self) -> bool:
        """
        Stage 6D Pilot: Ingests GFS pressure grid forecast for Florida/East Coast.
        Fetches 48 hours of forecasts in 3-hour increments.
        """
        logger.info("[Pipeline Scheduler] Starting GFS Pressure Pilot ingestion job...")
        env = get_env_flags()
        region = REGIONAL_CONFIGS["florida_east_coast"]
        resolution = self._get_resolution(region, env["is_render"])

        results = await self._fetch_or_mock(
            "GFS", "weather", "pressure", region, resolution, 2,
            env["is_test_env"],
            lambda: generate_mock_pressure_results(self.om_provider, region, resolution),
            "florida_east_coast"
        )
        if not results:
            return False

        run_time = datetime.now(timezone.utc)
        count = await normalize_and_save_loop(
            self.normalizer, self.store, results,
            model="GFS", provider="open-meteo", domain="weather", layer="pressure",
            bbox=region, resolution=resolution, run_time=run_time,
            is_test_env=env["is_test_env"],
            log_prefix="[Pipeline Scheduler] GFS pressure"
        )
        await self._cleanup_and_pause(results, 0)
        logger.info(f"[Pipeline Scheduler] GFS Pressure Ingestion Job done! Saved {count} hourly grid files.")
        return count > 0

    async def ingest_icon_pressure_pilot(self) -> bool:
        """
        Stage 6E Pilot: Ingests ICON pressure grid forecast for Florida/East Coast.
        Fetches 48 hours of forecasts in 3-hour increments.
        """
        logger.info("[Pipeline Scheduler] Starting ICON Pressure Pilot ingestion job...")
        env = get_env_flags()
        region = REGIONAL_CONFIGS["florida_east_coast"]
        resolution = self._get_resolution(region, env["is_render"])

        results = await self._fetch_or_mock(
            "ICON", "weather", "pressure", region, resolution, 2,
            env["is_test_env"],
            lambda: generate_mock_pressure_results(self.om_provider, region, resolution),
            "florida_east_coast"
        )
        if not results:
            return False

        run_time = datetime.now(timezone.utc)
        count = await normalize_and_save_loop(
            self.normalizer, self.store, results,
            model="ICON", provider="open-meteo", domain="weather", layer="pressure",
            bbox=region, resolution=resolution, run_time=run_time,
            is_test_env=env["is_test_env"],
            log_prefix="[Pipeline Scheduler] ICON pressure"
        )
        await self._cleanup_and_pause(results, 0)
        logger.info(f"[Pipeline Scheduler] ICON Pressure Ingestion Job done! Saved {count} hourly grid files.")
        return count > 0

    async def ingest_euro_pressure_pilot(self) -> bool:
        """
        Stage 6E Pilot: Ingests EURO pressure grid forecast for Florida/East Coast.
        Fetches 48 hours of forecasts in 3-hour increments.
        """
        logger.info("[Pipeline Scheduler] Starting EURO Pressure Pilot ingestion job...")
        env = get_env_flags()
        region = REGIONAL_CONFIGS["florida_east_coast"]
        resolution = self._get_resolution(region, env["is_render"])

        results = await self._fetch_or_mock(
            "EURO", "weather", "pressure", region, resolution, 2,
            env["is_test_env"],
            lambda: generate_mock_pressure_results(self.om_provider, region, resolution),
            "florida_east_coast"
        )
        if not results:
            return False

        run_time = datetime.now(timezone.utc)
        count = await normalize_and_save_loop(
            self.normalizer, self.store, results,
            model="EURO", provider="open-meteo", domain="weather", layer="pressure",
            bbox=region, resolution=resolution, run_time=run_time,
            is_test_env=env["is_test_env"],
            log_prefix="[Pipeline Scheduler] EURO pressure"
        )
        await self._cleanup_and_pause(results, 0)
        logger.info(f"[Pipeline Scheduler] EURO Pressure Ingestion Job done! Saved {count} hourly grid files.")
        return count > 0

    async def ingest_copernicus_regional(self) -> bool:
        """
        Stage 4 Ingestion: Scheduled fetch of Copernicus regional wave component layers.
        """
        logger.info("[Pipeline Scheduler] Starting Copernicus Regional Ingestion job...")
        import os
        env = get_env_flags()
        region = REGIONAL_CONFIGS["florida_east_coast"]
        layers = ["waves", "swell_1", "swell_2", "wind_waves"]
        run_time = datetime.now(timezone.utc)
        total_success = 0

        has_credentials = bool(
            os.environ.get("COPERNICUSMARINE_SERVICE_USERNAME") and
            os.environ.get("COPERNICUSMARINE_SERVICE_PASSWORD")
        )

        for layer in layers:
            results = None
            res_to_save = 0.5
            provider_name = "copernicus"

            if has_credentials:
                results = await self.cop_provider.fetch_grid(
                    layer=layer, bbox=region, resolution=0.5,
                    forecast_days=1 if os.environ.get("RENDER") == "true" else 3
                )
                if results:
                    results = results if isinstance(results, list) else [results]

            if not results:
                if env["is_test_env"]:
                    logger.info("[Pipeline Scheduler] Test environment active. Generating isolated mock Copernicus test fixture...")
                    mock_res = 1.5
                    res_to_save = mock_res
                    provider_name = "test-fixture"
                    results = generate_mock_copernicus_results(region, mock_res)
                else:
                    logger.error(f"[Pipeline Scheduler] Copernicus Ingestion: failed to fetch grid for layer: {layer}. Skipping.")
                    continue

            count = await normalize_and_save_loop(
                self.normalizer, self.store, results,
                model="EURO", provider=provider_name, domain="marine", layer=layer,
                bbox=region, resolution=res_to_save, run_time=run_time,
                is_test_env=env["is_test_env"],
                step=1,  # Save all frames, not just every 3rd
                log_prefix=f"[Pipeline Scheduler] Copernicus {layer}"
            )
            total_success += count
            await self._cleanup_and_pause(results, 0)

        logger.info(f"[Pipeline Scheduler] Copernicus Ingestion Job completed! Saved {total_success} product files.")
        return total_success > 0

    async def ingest_icon_marine_pilot(self) -> bool:
        """
        Stage 4F.1 / 6H.2: Ingests ICON/gwam marine grid forecast for all configured regions.
        Fetches 48 hours of forecasts in 3-hour increments for waves, swell_1, and wind_waves.
        Swell 2 is unsupported and will not be ingested.
        """
        logger.info("[Pipeline Scheduler] Starting ICON Marine Ingestion job for supported layers...")
        env = get_env_flags()
        run_time = datetime.now(timezone.utc)
        total_saved = 0

        for region_id, region in REGIONAL_CONFIGS.items():
            resolution = self._get_resolution(region, env["is_render"])
            logger.info(f"[Pipeline Scheduler] Ingesting ICON Marine for region: {region_id}")

            raw_data = await self.om_provider.fetch_grid(
                model="ICON", domain="marine", layer="all_marine",
                bbox=region, resolution=resolution, forecast_days=2
            )

            if raw_data:
                results = raw_data if isinstance(raw_data, list) else [raw_data]
                provider = "open-meteo"
            elif env["is_test_env"]:
                logger.warning(f"[Pipeline Scheduler] ICON Marine fetch failed for {region_id}. Injecting mock data...")
                results = generate_mock_icon_marine_results(self.om_provider, region, resolution)
                provider = "test-fixture"
            else:
                logger.error(f"[Pipeline Scheduler] ICON Marine fetch failed for {region_id}. Skipping.")
                continue

            layers = ["waves", "swell_1", "wind_waves"]
            for layer in layers:
                count = await normalize_and_save_loop(
                    self.normalizer, self.store, results,
                    model="ICON", provider=provider, domain="marine", layer=layer,
                    bbox=region, resolution=resolution, run_time=run_time,
                    region_id=region_id, coverage_mode="regional_tile",
                    is_test_env=env["is_test_env"],
                    log_prefix=f"[Pipeline Scheduler] ICON {layer} {region_id}"
                )
                logger.info(f"[Pipeline Scheduler] Ingested {count} ICON {layer} products for region {region_id}.")
                total_saved += count

            await self._cleanup_and_pause(results)

        logger.info(f"[Pipeline Scheduler] ICON Marine Ingestion Job done! Saved {total_saved} total conformed product files.")
        return total_saved > 0

    async def ingest_icon_wind_pilot(self) -> bool:
        """
        Stage 5C/6H.1: Ingests ICON wind grid forecast for all configured regions.
        Fetches 48 hours of forecasts in 3-hour increments.
        """
        logger.info("[Pipeline Scheduler] Starting ICON Wind Ingestion job for all regions...")
        env = get_env_flags()
        run_time = datetime.now(timezone.utc)
        total_saved = 0

        for region_id, region in REGIONAL_CONFIGS.items():
            resolution = self._get_resolution(region, env["is_render"])
            logger.info(f"[Pipeline Scheduler] Ingesting ICON Wind for region: {region_id}")

            raw_data = await self.om_provider.fetch_grid(
                model="ICON", domain="wind", layer="wind",
                bbox=region, resolution=resolution, forecast_days=2
            )

            if raw_data:
                results = raw_data if isinstance(raw_data, list) else [raw_data]
                provider = "open-meteo"
            elif env["is_test_env"]:
                logger.warning(f"[Pipeline Scheduler] ICON Wind fetch failed for {region_id}. Injecting mock data...")
                results = generate_mock_wind_results(
                    self.om_provider, region, resolution,
                    speed_base=7.5, dir_base=110.0, include_gusts=True, gust_base=12.0
                )
                provider = "test-fixture"
            else:
                logger.error(f"[Pipeline Scheduler] ICON Wind fetch failed for {region_id}. Skipping.")
                continue

            count = await normalize_and_save_loop(
                self.normalizer, self.store, results,
                model="ICON", provider=provider, domain="wind", layer="wind",
                bbox=region, resolution=resolution, run_time=run_time,
                region_id=region_id, coverage_mode="regional_tile",
                is_test_env=env["is_test_env"],
                log_prefix=f"[Pipeline Scheduler] ICON wind {region_id}"
            )
            logger.info(f"[Pipeline Scheduler] Ingested {count} ICON Wind grid files for region {region_id}.")
            total_saved += count
            await self._cleanup_and_pause(results)

        return total_saved > 0

    async def ingest_euro_wind_pilot(self) -> bool:
        """
        Stage 5D/6H.1: Ingests EURO wind grid forecast for all configured regions.
        Fetches 48 hours of forecasts in 3-hour increments.
        """
        logger.info("[Pipeline Scheduler] Starting EURO Wind Ingestion job for all regions...")
        env = get_env_flags()
        run_time = datetime.now(timezone.utc)
        total_saved = 0

        for region_id, region in REGIONAL_CONFIGS.items():
            resolution = self._get_resolution(region, env["is_render"])
            logger.info(f"[Pipeline Scheduler] Ingesting EURO Wind for region: {region_id}")

            raw_data = await self.om_provider.fetch_grid(
                model="EURO", domain="wind", layer="wind",
                bbox=region, resolution=resolution, forecast_days=2
            )

            if raw_data:
                results = raw_data if isinstance(raw_data, list) else [raw_data]
                provider = "open-meteo"
            elif env["is_test_env"]:
                logger.warning(f"[Pipeline Scheduler] EURO Wind fetch failed for {region_id}. Injecting mock data...")
                results = generate_mock_wind_results(
                    self.om_provider, region, resolution,
                    speed_base=6.5, dir_base=100.0, include_gusts=True, gust_base=10.0
                )
                provider = "test-fixture"
            else:
                logger.error(f"[Pipeline Scheduler] EURO Wind fetch failed for {region_id}. Skipping.")
                continue

            count = await normalize_and_save_loop(
                self.normalizer, self.store, results,
                model="EURO", provider=provider, domain="wind", layer="wind",
                bbox=region, resolution=resolution, run_time=run_time,
                region_id=region_id, coverage_mode="regional_tile",
                is_test_env=env["is_test_env"],
                log_prefix=f"[Pipeline Scheduler] EURO wind {region_id}"
            )
            logger.info(f"[Pipeline Scheduler] Ingested {count} EURO Wind grid files for region {region_id}.")
            total_saved += count
            await self._cleanup_and_pause(results)

        return total_saved > 0
