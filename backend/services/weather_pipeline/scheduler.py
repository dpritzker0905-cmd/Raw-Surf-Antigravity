import os
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
    REGIONAL_CONFIGS,
    find_nearest_manifest_product,
)

logger = logging.getLogger(__name__)


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
        return region["resolution"]

    async def _fetch_or_mock(self, model: str, domain: str, layer: str,
                             region: dict, resolution: float, forecast_days: int,
                             is_test_env: bool, mock_fn, region_id: str = "",
                             batch_size: Optional[int] = None) -> Optional[list]:
        """Fetch grid from provider, falling back to mock data in test environments."""
        try:
            raw_data = await self.om_provider.fetch_grid(
                model=model, domain=domain, layer=layer,
                bbox=region, resolution=resolution, forecast_days=forecast_days,
                batch_size=batch_size
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

            env_forecast_days = int(os.environ.get("GFS_MARINE_FORECAST_DAYS", "8"))
            results = await self._fetch_or_mock(
                "GFS", "marine", "all_marine", region, resolution, env_forecast_days,
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
                if count > 0:
                    self.store.prune_superseded_products("GFS", "marine", layer, region_id, run_time)

            await self._cleanup_and_pause(results)

        logger.info(f"[Pipeline Scheduler] GFS Marine Ingestion Job done! Saved {total_saved} total conformed product files.")
        return total_saved > 0

    async def ingest_gfs_wind_pilot(self) -> bool:
        """Stage 3A/6H.1: Ingests GFS wind grid forecast for all configured regions."""
        from services.weather_pipeline.wind_ingestion import ingest_gfs_wind_pilot_impl
        return await ingest_gfs_wind_pilot_impl(self)

    async def ingest_gfs_wind_global(self) -> bool:
        """Ingests GFS wind grid forecast globally at a coarse resolution."""
        from services.weather_pipeline.wind_ingestion import ingest_gfs_wind_global_impl
        return await ingest_gfs_wind_global_impl(self)

    async def ingest_gfs_marine_global(self) -> bool:
        """
        Ingests GFS waves grid forecast globally at a coarse resolution.
        Fetches 14 days of forecasts in 3-hour increments for waves, swell_1, swell_2, and wind_waves.
        """
        logger.info("[Pipeline Scheduler] Starting GFS Marine Global Coarse Ingestion job...")
        env = get_env_flags()
        run_time = datetime.now(timezone.utc)
        total_saved = 0

        global_region = {
            "west": -180.0,
            "south": -80.0,
            "east": 180.0,
            "north": 85.0
        }
        resolution = 10.0

        forecast_days = int(os.environ.get("GFS_GLOBAL_FORECAST_DAYS", "2" if env["is_test_env"] else "14"))

        # ══ PRIMARY: native GFS-Wave direct from NOAA (AWS Open Data, byte-range GRIB2) ══
        # Moves GFS marine OFF open-meteo (frees the whole open-meteo daily budget so ICON marine can keep
        # its 3-hourly cadence) using the SAME ncep_gfswave025 model. Low-strain (~tens of MB peak), slow
        # (~5-15 min, background only — see noaa_gfs_wave_fetcher.py). Provider stays 'open-meteo' in the
        # save loop below so the manifest (source_dataset='ncep_gfswave025') is BYTE-IDENTICAL to the
        # open-meteo path — zero regression. NOAA unavailable/failed -> falls through to the existing
        # open-meteo fetch. Kill switch: GFS_MARINE_NOAA_DIRECT=0.
        noaa_direct = os.environ.get("GFS_MARINE_NOAA_DIRECT", "1") != "0"
        results = None
        from_noaa = False
        if noaa_direct:
            try:
                from services.noaa_marine_service import fetch_gfs_marine_global_coarse
                results = await fetch_gfs_marine_global_coarse(global_region, resolution, forecast_days)
                if results:
                    from_noaa = True
                    logger.info(f"[Pipeline Scheduler] GFS-Wave NOAA-direct OK: {len(results)} points (off open-meteo).")
            except Exception as _ne:
                logger.error(f"[Pipeline Scheduler] GFS-Wave NOAA-direct fetch errored: {_ne}")

        if not results:
            if noaa_direct:
                logger.warning("[Pipeline Scheduler] GFS-Wave NOAA-direct unavailable; falling back to open-meteo.")
            results = await self._fetch_or_mock(
                "GFS", "marine", "all_marine", global_region, resolution, forecast_days,
                env["is_test_env"],
                lambda: generate_mock_marine_results(self.om_provider, global_region, resolution),
                "global_coarse"
            )
        if not results:
            logger.error("[Pipeline Scheduler] GFS marine global_coarse fetch failed. Skipping.")
            return False

        # NOAA GFS-Wave is natively 3-hourly (step=1 keeps every step); open-meteo all_marine is hourly
        # (step=3 -> 3-hourly products). Same 3-hourly product cadence either way.
        save_step = 1 if from_noaa else 3
        layers = ["waves", "swell_1", "swell_2", "wind_waves"]
        for layer in layers:
            count = await normalize_and_save_loop(
                self.normalizer, self.store, results,
                model="GFS", provider="open-meteo", domain="marine", layer=layer,
                bbox=global_region, resolution=resolution, run_time=run_time,
                region_id="global_coarse", coverage_mode="global_tile",
                is_test_env=env["is_test_env"], step=save_step,
                log_prefix=f"[Pipeline Scheduler] GFS {layer} global_coarse"
            )
            logger.info(f"[Pipeline Scheduler] Ingested {count} GFS {layer} global coarse grid files.")
            total_saved += count
            if count > 0:
                self.store.prune_superseded_products("GFS", "marine", layer, "global_coarse", run_time)

        await self._cleanup_and_pause(results, 0)
        return total_saved > 0

    async def ingest_euro_marine_global(self) -> bool:
        """
        Ingests EURO waves grid forecast globally at a coarse resolution.
        Fetches 7 days of forecasts in 3-hour increments.
        Conforms waves under model='EURO', and component layers under GFS fallback conjoined to EURO.
        """
        logger.info("[Pipeline Scheduler] Starting EURO Marine Global Coarse Ingestion job...")
        env = get_env_flags()
        run_time = datetime.now(timezone.utc)
        total_saved = 0

        global_region = {
            "west": -180.0,
            "south": -80.0,
            "east": 180.0,
            "north": 85.0
        }
        resolution = 10.0

        forecast_days = int(os.environ.get("EURO_GLOBAL_FORECAST_DAYS", "2" if env["is_test_env"] else "7"))
        # GFS swell/wind_waves fallback: request the SAME horizon as ingest_gfs_marine_global (which runs
        # ~1 min earlier in the same cycle) so this resolves as a provider _GRID_CACHE HIT (TTL 300s)
        # instead of a SECOND, redundant open-meteo all_marine fetch of identical GFS data. open-meteo
        # bills each of the ~612 grid locations as a call, so de-duplicating this frees ~600+ calls/cycle
        # of the daily quota — enough to keep the cycle's tail jobs (ICON marine) under the 5k/hour cap so
        # they stop getting 429'd. Worst case (GFS job failed / cache expired) it re-fetches as before — no
        # regression. (The longer-term win is moving EURO marine onto Copernicus entirely; tiled fetch is
        # memory-safe but ~60 slow tile downloads, deferred.)
        gfs_forecast_days = int(os.environ.get("GFS_GLOBAL_FORECAST_DAYS", "2" if env["is_test_env"] else "14"))

        # ══ PRIMARY: native EURO from Copernicus (REAL ECMWF-WAM swells), 0-10d + cached-GFS 10->14d ══
        # Moves EURO marine OFF open-meteo (frees ~1,200 calls/cycle for ICON) and upgrades swell_1/swell_2/
        # wind_waves from GFS-fallback to REAL CMEMS partitions. The Copernicus fetch is slow (~15-30 min)
        # but LOW-STRAIN (background thin-latitude-band subsets, ~0.3 GB, ~36 MB peak — see
        # copernicus_global_fetcher.py). CMEMS global waves is a ~10-day product, so days 10->14 are filled
        # by the cached GFS all_marine (estimated). Copernicus unavailable/failed -> falls through to the
        # existing open-meteo path below (zero regression).
        cop_days = int(os.environ.get("EURO_COPERNICUS_DAYS", "2" if env["is_test_env"] else "10"))
        _cop_basis = {"type": "copernicus_native_global_coarse", "method": "cmems_thin_band_subset", "source_model": "ecmwf_wam_cmems_glo_0083"}
        _gfs_ext_basis = {"type": "gfs_estimated_fallback", "method": "gfs_wave_fallback", "source_model": "ncep_gfswave025"}

        def _parse_iso(s):
            if not s:
                return None
            try:
                dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
                # open-meteo GFS times are offset-NAIVE ("...T00:00"); Copernicus times are AWARE ("...Z").
                # Normalize to UTC-aware so the GFS 10->14d slice comparison can't raise a naive-vs-aware
                # TypeError (which otherwise aborts the whole EURO ingest before any product is saved).
                return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt
            except Exception:
                return None

        def _slice_after(results, after_dt):
            """Trim Open-Meteo-shaped point results to hourly times STRICTLY AFTER after_dt (the GFS 10->14d tail)."""
            if not results or after_dt is None:
                return None
            sliced = []
            for pt in results:
                hourly = pt.get("hourly", {}) or {}
                times = hourly.get("time", []) or []
                keep = [i for i, t in enumerate(times) if (_parse_iso(t) and _parse_iso(t) > after_dt)]
                if not keep:
                    continue
                new_hourly = {k: ([arr[i] for i in keep] if (isinstance(arr, list) and len(arr) == len(times)) else arr)
                              for k, arr in hourly.items()}
                npt = dict(pt)
                npt["hourly"] = new_hourly
                sliced.append(npt)
            return sliced or None

        cop_results = None
        try:
            from services.copernicus_marine_service import fetch_euro_marine_global_coarse
            cop_results = await fetch_euro_marine_global_coarse(global_region, resolution, cop_days)
        except Exception as _ce:
            logger.error(f"[Pipeline Scheduler] EURO Copernicus global-coarse fetch errored: {_ce}")

        if cop_results:
            logger.info(f"[Pipeline Scheduler] EURO Copernicus global-coarse OK: {len(cop_results)} points (native swells).")
            # cached GFS (ingest_gfs_marine_global ran ~1 min earlier -> _GRID_CACHE hit) for the 10->14d tail
            gfs_ext_src = await self._fetch_or_mock(
                "GFS", "marine", "all_marine", global_region, resolution, gfs_forecast_days,
                env["is_test_env"],
                lambda: generate_mock_marine_results(self.om_provider, global_region, resolution),
                "global_coarse"
            )
            _cop_times = cop_results[0].get("hourly", {}).get("time", []) if cop_results else []
            _cop_max = _parse_iso(_cop_times[-1]) if _cop_times else None
            gfs_ext = _slice_after(gfs_ext_src, _cop_max)
            for layer in ["waves", "swell_1", "swell_2", "wind_waves"]:
                # native Copernicus 0-10d (CMEMS is natively 3-hourly -> step=1)
                c = await normalize_and_save_loop(
                    self.normalizer, self.store, cop_results,
                    model="EURO", provider="copernicus", domain="marine", layer=layer,
                    bbox=global_region, resolution=resolution, run_time=run_time,
                    region_id="global_coarse", coverage_mode="global_tile",
                    is_test_env=env["is_test_env"], step=1,
                    log_prefix=f"[Pipeline Scheduler] EURO {layer} (copernicus native) global_coarse",
                    estimated_after_index=0, estimate_basis=_cop_basis
                )
                e_cnt = 0
                if gfs_ext:  # GFS days 10->14 (open-meteo hourly -> step=3)
                    e_cnt = await normalize_and_save_loop(
                        self.normalizer, self.store, gfs_ext,
                        model="EURO", provider="copernicus", domain="marine", layer=layer,
                        bbox=global_region, resolution=resolution, run_time=run_time,
                        region_id="global_coarse", coverage_mode="global_tile",
                        is_test_env=env["is_test_env"], step=3,
                        log_prefix=f"[Pipeline Scheduler] EURO {layer} (GFS 10-14d ext) global_coarse",
                        estimated_after_index=0, estimate_basis=_gfs_ext_basis
                    )
                logger.info(f"[Pipeline Scheduler] Ingested EURO {layer}: {c} native + {e_cnt} GFS-ext global coarse files.")
                total_saved += c + e_cnt
                if (c + e_cnt) > 0:
                    self.store.prune_superseded_products("EURO", "marine", layer, "global_coarse", run_time)
            await self._cleanup_and_pause(cop_results, 0)
            if gfs_ext_src:
                await self._cleanup_and_pause(gfs_ext_src, 0)
            return total_saved > 0

        # ══ FALLBACK: Copernicus unavailable -> existing open-meteo path (ecmwf_wam025 + cached GFS), no regression ══
        logger.warning("[Pipeline Scheduler] EURO Copernicus global-coarse unavailable; falling back to open-meteo (ecmwf_wam025 + GFS).")

        # 1. Fetch EURO waves results (real ECMWF WAM via open-meteo ecmwf_wam025)
        euro_results = await self._fetch_or_mock(
            "EURO", "marine", "all_marine", global_region, resolution, forecast_days,
            env["is_test_env"],
            lambda: generate_mock_marine_results(self.om_provider, global_region, resolution),
            "global_coarse"
        )

        # 2. GFS swell/wind_waves fallback — reuses the GFS-marine-global fetch via cache (see note above)
        gfs_results = await self._fetch_or_mock(
            "GFS", "marine", "all_marine", global_region, resolution, gfs_forecast_days,
            env["is_test_env"],
            lambda: generate_mock_marine_results(self.om_provider, global_region, resolution),
            "global_coarse"
        )

        if not euro_results and not gfs_results:
            logger.error("[Pipeline Scheduler] Both EURO and GFS marine global_coarse fetches failed. Skipping.")
            return False

        # Conformed global coarse open-meteo products must be labeled as estimated to meet capabilities contract
        euro_estimate_basis = {
            "type": "open_meteo_fallback",
            "method": "direct_global_fallback",
            "source_model": "ecmwf_wam025"
        }

        gfs_estimate_basis = {
            "type": "gfs_estimated_fallback",
            "method": "gfs_wave_fallback",
            "source_model": "ncep_gfswave025"
        }

        if euro_results:
            count = await normalize_and_save_loop(
                self.normalizer, self.store, euro_results,
                model="EURO", provider="copernicus", domain="marine", layer="waves",
                bbox=global_region, resolution=resolution, run_time=run_time,
                region_id="global_coarse", coverage_mode="global_tile",
                is_test_env=env["is_test_env"],
                log_prefix="[Pipeline Scheduler] EURO waves global_coarse",
                estimated_after_index=0,
                estimate_basis=euro_estimate_basis
            )
            logger.info(f"[Pipeline Scheduler] Ingested {count} EURO waves global coarse grid files.")
            total_saved += count
            if count > 0:
                self.store.prune_superseded_products("EURO", "marine", "waves", "global_coarse", run_time)

        if gfs_results:
            for layer in ["swell_1", "swell_2", "wind_waves"]:
                count = await normalize_and_save_loop(
                    self.normalizer, self.store, gfs_results,
                    model="EURO", provider="copernicus", domain="marine", layer=layer,
                    bbox=global_region, resolution=resolution, run_time=run_time,
                    region_id="global_coarse", coverage_mode="global_tile",
                    is_test_env=env["is_test_env"],
                    log_prefix=f"[Pipeline Scheduler] EURO {layer} (GFS fallback) global_coarse",
                    estimated_after_index=0,
                    estimate_basis=gfs_estimate_basis
                )
                logger.info(f"[Pipeline Scheduler] Ingested {count} EURO {layer} (GFS fallback) global coarse grid files.")
                total_saved += count
                if count > 0:
                    self.store.prune_superseded_products("EURO", "marine", layer, "global_coarse", run_time)

        if euro_results:
            await self._cleanup_and_pause(euro_results, 0)
        if gfs_results:
            await self._cleanup_and_pause(gfs_results, 0)
        return total_saved > 0

    async def ingest_euro_wind_global(self) -> bool:
        """Ingests EURO wind grid forecast globally at a coarse resolution."""
        from services.weather_pipeline.wind_ingestion import ingest_euro_wind_global_impl
        return await ingest_euro_wind_global_impl(self)

    async def ingest_icon_wind_global(self) -> bool:
        """Ingests ICON wind grid forecast globally at a coarse resolution."""
        from services.weather_pipeline.wind_ingestion import ingest_icon_wind_global_impl
        return await ingest_icon_wind_global_impl(self)

    async def ingest_gfs_pressure_pilot(self) -> bool:
        """Stage 6D Pilot: Ingests GFS pressure grid forecast for Florida/East Coast."""
        from services.weather_pipeline.pressure_ingestion import ingest_gfs_pressure_pilot_impl
        return await ingest_gfs_pressure_pilot_impl(self)

    async def ingest_icon_pressure_pilot(self) -> bool:
        """Stage 6E Pilot: Ingests ICON pressure grid forecast for Florida/East Coast."""
        from services.weather_pipeline.pressure_ingestion import ingest_icon_pressure_pilot_impl
        return await ingest_icon_pressure_pilot_impl(self)

    async def ingest_euro_pressure_pilot(self) -> bool:
        """Stage 6E Pilot: Ingests EURO pressure grid forecast for Florida/East Coast."""
        from services.weather_pipeline.pressure_ingestion import ingest_euro_pressure_pilot_impl
        return await ingest_euro_pressure_pilot_impl(self)

    async def ingest_icon_marine_global(self) -> bool:
        """
        Ingests ICON waves grid forecast globally at a coarse resolution.
        Fetches 7 days of forecasts in 3-hour increments for waves, swell_1, and wind_waves.
        Swell 2 is unsupported and will not be ingested.
        """
        logger.info("[Pipeline Scheduler] Starting ICON Marine Global Coarse Ingestion job...")
        env = get_env_flags()
        run_time = datetime.now(timezone.utc)
        total_saved = 0

        global_region = {
            "west": -180.0,
            "south": -80.0,
            "east": 180.0,
            "north": 85.0
        }
        resolution = 10.0

        forecast_days = int(os.environ.get("ICON_GLOBAL_FORECAST_DAYS", "2" if env["is_test_env"] else "7"))
        results = await self._fetch_or_mock(
            "ICON", "marine", "all_marine", global_region, resolution, forecast_days,
            env["is_test_env"],
            lambda: generate_mock_icon_marine_results(self.om_provider, global_region, resolution),
            "global_coarse"
        )
        if not results:
            logger.error("[Pipeline Scheduler] ICON marine global_coarse fetch failed. Skipping.")
            return False

        layers = ["waves", "swell_1", "wind_waves"]
        for layer in layers:
            count = await normalize_and_save_loop(
                self.normalizer, self.store, results,
                model="ICON", provider="open-meteo", domain="marine", layer=layer,
                bbox=global_region, resolution=resolution, run_time=run_time,
                region_id="global_coarse", coverage_mode="global_tile",
                is_test_env=env["is_test_env"],
                log_prefix=f"[Pipeline Scheduler] ICON {layer} global_coarse"
            )
            logger.info(f"[Pipeline Scheduler] Ingested {count} ICON {layer} global coarse grid files.")
            total_saved += count
            if count > 0:
                self.store.prune_superseded_products("ICON", "marine", layer, "global_coarse", run_time)

        await self._cleanup_and_pause(results, 0)
        return total_saved > 0

    async def ingest_gfs_pressure_global(self) -> bool:
        """Ingests GFS pressure grid forecast globally at a coarse resolution."""
        from services.weather_pipeline.pressure_ingestion import ingest_gfs_pressure_global_impl
        return await ingest_gfs_pressure_global_impl(self)

    async def ingest_icon_pressure_global(self) -> bool:
        """Ingests ICON pressure grid forecast globally at a coarse resolution."""
        from services.weather_pipeline.pressure_ingestion import ingest_icon_pressure_global_impl
        return await ingest_icon_pressure_global_impl(self)

    async def ingest_euro_pressure_global(self) -> bool:
        """Ingests EURO pressure grid forecast globally at a coarse resolution."""
        from services.weather_pipeline.pressure_ingestion import ingest_euro_pressure_global_impl
        return await ingest_euro_pressure_global_impl(self)

    async def ingest_copernicus_regional(self) -> bool:
        """
        Stage 4 Ingestion: Scheduled fetch of Copernicus regional wave component layers for all configured regions.
        """
        logger.info("[Pipeline Scheduler] Starting Copernicus Regional Ingestion job...")
        import os
        env = get_env_flags()
        layers = ["waves", "swell_1", "swell_2", "wind_waves"]
        run_time = datetime.now(timezone.utc)
        total_success = 0

        has_credentials = bool(
            os.environ.get("COPERNICUSMARINE_SERVICE_USERNAME") and
            os.environ.get("COPERNICUSMARINE_SERVICE_PASSWORD")
        )

        for region_id, region in REGIONAL_CONFIGS.items():
            logger.info(f"[Pipeline Scheduler] Ingesting Copernicus Regional for region: {region_id}")
            
            # Swell 2 is not requested for SoCal
            region_layers = ["waves", "swell_1", "wind_waves"] if region_id == "us_west_coast_socal" \
                else layers

            for layer in region_layers:
                results = None
                res_to_save = 0.5
                provider_name = "copernicus"

                if has_credentials:
                    results = await self.cop_provider.fetch_grid(
                        layer=layer, bbox=region, resolution=0.5,
                        forecast_days=int(os.environ.get("COPERNICUS_FORECAST_DAYS", "10"))
                    )
                    if results:
                        results = results if isinstance(results, list) else [results]

                if not results:
                    if env["is_test_env"]:
                        logger.info(f"[Pipeline Scheduler] Test environment active. Generating isolated mock Copernicus test fixture for {region_id}...")
                        mock_res = 1.5
                        res_to_save = mock_res
                        provider_name = "test-fixture"
                        results = generate_mock_copernicus_results(region, mock_res)
                    else:
                        logger.error(f"[Pipeline Scheduler] Copernicus Ingestion: failed to fetch grid for region: {region_id}, layer: {layer}. Skipping.")
                        continue

                count = await normalize_and_save_loop(
                    self.normalizer, self.store, results,
                    model="EURO", provider=provider_name, domain="marine", layer=layer,
                    bbox=region, resolution=res_to_save, run_time=run_time,
                    region_id=region_id, coverage_mode="regional_tile",
                    is_test_env=env["is_test_env"],
                    step=1,  # Save all frames, not just every 3rd
                    log_prefix=f"[Pipeline Scheduler] Copernicus {layer} {region_id}"
                )
                total_success += count
                if count > 0:
                    self.store.prune_superseded_products("EURO", "marine", layer, region_id, run_time)
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
        """Stage 5C/6H.1: Ingests ICON wind grid forecast for all configured regions."""
        from services.weather_pipeline.wind_ingestion import ingest_icon_wind_pilot_impl
        return await ingest_icon_wind_pilot_impl(self)

    async def ingest_euro_wind_pilot(self) -> bool:
        """Stage 5D/6H.1: Ingests EURO wind grid forecast for all configured regions."""
        from services.weather_pipeline.wind_ingestion import ingest_euro_wind_pilot_impl
        return await ingest_euro_wind_pilot_impl(self)

    async def ingest_euro_marine_extended_estimates(self) -> bool:
        """
        Stage 6I.2: Precomputes and saves EURO Marine extended estimate grids.
        Delegated to scheduler_helpers.py to satisfy the 800 LOC limit.
        """
        from services.weather_pipeline.scheduler_helpers import ingest_euro_marine_extended_estimates_impl
        return await ingest_euro_marine_extended_estimates_impl(self)

