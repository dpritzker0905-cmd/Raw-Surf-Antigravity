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
        try:
            raw_data = await self.om_provider.fetch_grid(
                model=model, domain=domain, layer=layer,
                bbox=region, resolution=resolution, forecast_days=forecast_days
            )
        except Exception as e:
            logger.error(f"[Pipeline Scheduler] Exception during fetch: {e}")
            raw_data = None

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
                "GFS", "marine", "all_marine", region, resolution, 16,
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
                "GFS", "wind", "wind", region, resolution, 14,
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

    async def ingest_gfs_wind_global(self) -> bool:
        """
        Ingests GFS wind grid forecast globally at a coarse resolution.
        Fetches 48 hours of forecasts in 3-hour increments.
        """
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

        results = await self._fetch_or_mock(
            "GFS", "wind", "wind", global_region, resolution, 14,
            env["is_test_env"],
            lambda: generate_mock_wind_results(self.om_provider, global_region, resolution),
            "global_coarse"
        )
        if not results:
            logger.warning("[Pipeline Scheduler] GFS wind global_coarse fetch failed. Trying to load from forecast_cache fallback...")
            import json
            from pathlib import Path
            fallback_path = Path(__file__).parent.parent.parent / "uploads" / "forecast_cache" / "wind_global.json"
            if fallback_path.exists():
                try:
                    with open(fallback_path, "r") as f:
                        cached_data = json.load(f)
                    
                    # Shift and extend the timestamps to cover 14 days (336 hours)
                    base_date = run_time.replace(hour=0, minute=0, second=0, microsecond=0)
                    for item in cached_data:
                        if "hourly" in item and "time" in item["hourly"]:
                            orig_speed = item["hourly"].get("wind_speed_10m", [])
                            orig_direction = item["hourly"].get("wind_direction_10m", [])
                            
                            new_times = []
                            new_speed = []
                            new_direction = []
                            
                            # Generate 14 days of forecast (336 hours)
                            for hour_idx in range(14 * 24):
                                new_time = (base_date + timedelta(hours=hour_idx)).strftime("%Y-%m-%dT%H:%M")
                                new_times.append(new_time)
                                
                                # Wrap around the cached hourly data
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

        count = await normalize_and_save_loop(
            self.normalizer, self.store, results,
            model="GFS", provider="open-meteo", domain="wind", layer="wind",
            bbox=global_region, resolution=resolution, run_time=run_time,
            region_id="global_coarse", coverage_mode="global_tile",
            is_test_env=env["is_test_env"],
            log_prefix="[Pipeline Scheduler] GFS wind global_coarse"
        )
        logger.info(f"[Pipeline Scheduler] Ingested {count} GFS Wind global coarse grid files.")
        await self._cleanup_and_pause(results, 0)
        return count > 0

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

            try:
                raw_data = await self.om_provider.fetch_grid(
                    model="ICON", domain="marine", layer="all_marine",
                    bbox=region, resolution=resolution, forecast_days=7
                )
            except Exception as e:
                logger.error(f"[Pipeline Scheduler] ICON Marine fetch exception: {e}")
                raw_data = None

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

            try:
                raw_data = await self.om_provider.fetch_grid(
                    model="ICON", domain="wind", layer="wind",
                    bbox=region, resolution=resolution, forecast_days=2
                )
            except Exception as e:
                logger.error(f"[Pipeline Scheduler] ICON Wind fetch exception: {e}")
                raw_data = None

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

            try:
                raw_data = await self.om_provider.fetch_grid(
                    model="EURO", domain="wind", layer="wind",
                    bbox=region, resolution=resolution, forecast_days=2
                )
            except Exception as e:
                logger.error(f"[Pipeline Scheduler] EURO Wind fetch exception: {e}")
                raw_data = None

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

    async def ingest_euro_marine_extended_estimates(self) -> bool:
        """
        Stage 6I.2: Precomputes and saves EURO Marine extended estimate grids.
        For each region, finds the last authoritative EURO marine forecast product (the anchor),
        then for all GFS marine forecast products beyond that anchor,
        computes the blended estimate using the formulas in estimator.py and saves them.
        """
        logger.info("[Pipeline Scheduler] Starting EURO Marine Extended Estimate Ingestion job...")
        from services.weather_pipeline.estimator import (
            estimate_euro_grid, EURO_LIMIT_WAVES, EURO_LIMIT_COMPONENTS, EstimateContractError
        )
        
        manifest = self.store.get_manifest()
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
                euro_anchor_product = self.store.load_product(euro_anchor_item.filename)
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
                
                gfs_anchor_product = self.store.load_product(gfs_anchor_item.filename)
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
                        icon_anchor_product = self.store.load_product(icon_anchor_item.filename)
                
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
                    gfs_target_product = self.store.load_product(gfs_target_item.filename)
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
                        icon_target_product = self.store.load_product(icon_target_item.filename)
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
                            res = self.store.save_product(est_product, resolution=euro_anchor_item.resolution)
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

