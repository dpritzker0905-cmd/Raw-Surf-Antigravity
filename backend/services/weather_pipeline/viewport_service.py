import os
import asyncio
import logging
import math
import gc
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List

from fastapi import HTTPException
from services.weather_pipeline.store import ProductStore
from services.weather_pipeline.dynamic_index import DynamicProductIndex
from services.weather_pipeline.normalizer import WeatherNormalizer
from services.weather_pipeline.providers.open_meteo_provider import OpenMeteoProvider
from services.weather_pipeline.schemas import NormalizedProduct
from services.weather_pipeline.route_helpers import (
    parse_bbox, clamp_and_normalize_bbox, generate_bbox_coords,
    choose_adaptive_resolution, build_dynamic_cache_key, filter_grid_to_bbox,
    is_bbox_covered_by, get_snapped_bbox
)
from services.weather_pipeline.viewport_helper import _is_oversized_grid, extend_icon_wind_to_14d

logger = logging.getLogger(__name__)

class FetchContext:
    """
    Context for in-flight dynamic viewport requests to deduplicate and share
    raw fetched data and hour-specific processing results.
    """
    def __init__(self):
        self.raw_fetch_future = asyncio.Future()
        self.raw_list = None
        self.hour_futures: Dict[datetime, asyncio.Future] = {}

class ViewportService:
    """
    Service responsible for managing dynamic viewport bounding-box weather queries.
    Handles caching, concurrent request deduplication, coordinate generation,
    Open-Meteo fetching, and normalization.
    """

    IN_FLIGHT_REQUESTS: Dict[str, FetchContext] = {}
    IN_FLIGHT_LOCK = asyncio.Lock()

    ACTIVE_BG_TASKS: Dict[str, asyncio.Task] = {}

    ACTIVE_REVALIDATIONS = set()

    NEGATIVE_CACHE: Dict[str, float] = {}

    def __init__(
        self,
        store: Optional[ProductStore] = None,
        dynamic_index: Optional[DynamicProductIndex] = None,
        provider: Optional[OpenMeteoProvider] = None,
        normalizer: Optional[WeatherNormalizer] = None
    ):
        self._store = store
        self._dynamic_index = dynamic_index
        self.provider = provider or OpenMeteoProvider()
        self.normalizer = normalizer or WeatherNormalizer()

    @property
    def store(self) -> ProductStore:
        if self._store is not None:
            return self._store
        import routes.weather
        return routes.weather.store

    @property
    def dynamic_index(self) -> DynamicProductIndex:
        if self._dynamic_index is not None:
            return self._dynamic_index
        import routes.weather
        return routes.weather.dynamic_index

    def is_viewport_enabled(
        self,
        model: str,
        domain: str,
        layer: str,
        use_manifest_product: bool,
        bbox: Optional[str] = None,
        target_dt: Optional[datetime] = None
    ) -> bool:
        """
        Determines if dynamic viewport bounds fetching is enabled for the model/layer combination.
        """
        from services.weather_pipeline.viewport_helper import is_viewport_enabled_helper
        return is_viewport_enabled_helper(model, domain, layer, use_manifest_product, bbox, target_dt)

    async def get_cached_dynamic_product(
        self,
        model: str,
        domain: str,
        layer: str,
        target_dt: datetime,
        bbox_str: str
    ) -> Optional[NormalizedProduct]:
        from services.weather_pipeline.viewport_helper import get_cached_dynamic_product_helper
        return await get_cached_dynamic_product_helper(
            service=self,
            model=model,
            domain=domain,
            layer=layer,
            target_dt=target_dt,
            bbox_str=bbox_str
        )

    async def fetch_viewport_grid_upstream(
        self,
        model: str,
        domain: str,
        layer: str,
        valid_time_str: str,
        target_dt: datetime,
        bbox_str: str
    ) -> NormalizedProduct:
        """
        Step 4 & 5: Fetches viewport grid from upstream Open-Meteo, handling negative caching,
        in-flight request deduplication, and conformed stale fallback if upstream fails.
        """
        req_w, req_s, req_e, req_n = parse_bbox(bbox_str)
        t_sz = 1.0 if model.upper() == "GFS" else 2.0
        west, south, east, north = clamp_and_normalize_bbox(
            math.floor(req_w / t_sz) * t_sz,
            math.floor(req_s / t_sz) * t_sz,
            math.ceil(req_e / t_sz) * t_sz,
            math.ceil(req_n / t_sz) * t_sz
        )
        span_lng = (east - west) if west <= east else ((180.0 - west) + (east + 180.0))
        span_lat = abs(north - south)

        is_global_view = (span_lng > 180.0 or span_lat > 90.0)
        if is_global_view:
            west, south, east, north = -180.0, -80.0, 180.0, 85.0
            span_lng = 360.0
            span_lat = 165.0
        coverage_scope = "global_coarse" if is_global_view else "viewport"

        target_pts = 200.0 if domain.lower() == "marine" else 400.0
        resolution = choose_adaptive_resolution(span_lng, span_lat, target_pts)

        time_str = target_dt.strftime("%Y%m%dT%H%M%SZ")
        bbox_key_str = f"{west:.2f}_{south:.2f}_{east:.2f}_{north:.2f}"
        cache_key = build_dynamic_cache_key(model, domain, layer, target_dt, west, south, east, north)
        viewport_filename = f"{cache_key}.json"

        now_ts = datetime.now(timezone.utc).timestamp()
        if cache_key in self.NEGATIVE_CACHE:
            expire_ts = self.NEGATIVE_CACHE[cache_key]
            if now_ts < expire_ts:
                logger.warning(f"[Dynamic Viewport] Negative cache hit for {cache_key}. Attempting stale fallback before rejecting.")
                fallback_product = await self._find_any_cached_product(model, domain, layer, target_dt, bbox_str)
                if fallback_product:
                    logger.info(f"[Dynamic Viewport] Fallback (Negative Cache Hit): Found previous cached product {fallback_product.product_id} for stale return")
                    fallback_product.cache_hit = "stale_cache_hit"
                    fallback_product.requested_bbox_original = bbox_str
                    fallback_product.query_bbox = f"{west:.4f},{south:.4f},{east:.4f},{north:.4f}"
                    fallback_product.requested_bbox = bbox_str
                    fallback_product.is_dynamic_viewport_product = True
                    fallback_product.stale = True
                    fallback_product.staleReason = "upstream_rate_limited"
                    fallback_product.fallbackReason = "upstream_rate_limited"
                    fallback_product.partial_coverage = False

                    if domain.lower() != "wind":
                        fallback_product = filter_grid_to_bbox(fallback_product, get_snapped_bbox(bbox_str, model))
                    served_bbox = f"{fallback_product.grid.bounds.west:.4f},{fallback_product.grid.bounds.south:.4f},{fallback_product.grid.bounds.east:.4f},{fallback_product.grid.bounds.north:.4f}"
                    fallback_product.served_bbox = served_bbox

                    if fallback_product.grid:
                        fallback_product.grid.diagnostics = {
                            "requested_bbox": bbox_str,
                            "served_bbox": served_bbox,
                            "coverage_scope": fallback_product.coverage_scope or coverage_scope,
                            "source_product_ids": [fallback_product.product_id],
                            "cache_hit": "stale_cache_hit",
                            "provider": fallback_product.provider,
                            "model": model,
                            "domain": domain,
                            "layer": layer,
                            "valid_time": target_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
                            "nonzeroCount": fallback_product.grid.diagnostics.get("nonzeroCount", 0) if fallback_product.grid.diagnostics else 0,
                            "vectorCount": len(fallback_product.grid.vectors) if fallback_product.grid.vectors else 0,
                            "vectors_length": len(fallback_product.grid.vectors) if fallback_product.grid.vectors else 0,
                            "gridMode": "rectangular",
                            "renderable": len(fallback_product.grid.vectors) > 0 and any(v.speed > 0 for v in fallback_product.grid.vectors),
                            "stale": True,
                            "staleReason": "upstream_rate_limited",
                            "fallbackReason": "upstream_rate_limited",
                            "partial_coverage": False
                        }
                    return fallback_product

                raise HTTPException(
                    status_code=503,
                    detail="Upstream weather API is temporarily unavailable (cached rate limit block)."
                )

        days_diff = (target_dt - datetime.now(timezone.utc)).days + 2
        forecast_days = max(2, min(16, days_diff))

        if domain.lower() == "wind":
            if model.upper() == "ICON":
                forecast_days = 5
            elif model.upper() == "EURO":
                forecast_days = 10
            else:
                forecast_days = 16
        else:
            if domain.lower() == "marine":
                if model.upper() == "ICON":
                    forecast_days = min(forecast_days, 7)
                elif model.upper() == "EURO":
                    forecast_days = min(forecast_days, 12)
                else:
                    forecast_days = min(forecast_days, 16)

        is_conjoined = model.upper() in ("GFS", "ICON") and layer.lower() in ("waves", "swell_1", "swell_2", "wind_waves")
        dedup_layer = "all_marine" if is_conjoined else layer
        request_dedup_key = f"{model.lower()}_{domain.lower()}_{dedup_layer.lower()}_{bbox_key_str}_{forecast_days}"
        context = None
        is_fetcher = False

        async with self.IN_FLIGHT_LOCK:
            if request_dedup_key in self.IN_FLIGHT_REQUESTS:
                context = self.IN_FLIGHT_REQUESTS[request_dedup_key]
                is_fetcher = False
            else:
                context = FetchContext()
                self.IN_FLIGHT_REQUESTS[request_dedup_key] = context
                is_fetcher = True

        if not is_fetcher:
            logger.info(f"[Dynamic Viewport] Sharing in-flight request for {request_dedup_key}")
            try:
                await context.raw_fetch_future

                my_cache_key = build_dynamic_cache_key(model, domain, layer, target_dt, west, south, east, north)
                my_viewport_filename = f"{my_cache_key}.json"

                loaded_product = await asyncio.to_thread(self.store.load_product, my_viewport_filename)
                if not loaded_product:
                    hour_fut = None
                    async with self.IN_FLIGHT_LOCK:
                        if target_dt in context.hour_futures:
                            hour_fut = context.hour_futures[target_dt]
                        else:
                            hour_fut = asyncio.Future()
                            context.hour_futures[target_dt] = hour_fut

                    await hour_fut
                    loaded_product = await asyncio.to_thread(self.store.load_product, my_viewport_filename)

                if loaded_product and _is_oversized_grid(loaded_product):
                    logger.warning(
                        f"[Dynamic Viewport] Waiter loaded cached product {my_viewport_filename} "
                        f"but it was oversized ({len(loaded_product.grid.vectors)} vectors). Treating as cache miss to self-heal."
                    )
                    loaded_product = None

                if loaded_product:
                    loaded_product.cache_hit = "cache_hit"  # Shared from fetcher
                    loaded_product.requested_bbox_original = bbox_str
                    loaded_product.query_bbox = f"{west:.4f},{south:.4f},{east:.4f},{north:.4f}"
                    loaded_product.partial_coverage = False
                    loaded_product.stale = False
                    if domain.lower() != "wind":
                        loaded_product = filter_grid_to_bbox(loaded_product, get_snapped_bbox(bbox_str, model))
                    if loaded_product.grid and loaded_product.grid.bounds:
                        loaded_product.served_bbox = f"{loaded_product.grid.bounds.west:.4f},{loaded_product.grid.bounds.south:.4f},{loaded_product.grid.bounds.east:.4f},{loaded_product.grid.bounds.north:.4f}"
                    return loaded_product
                else:
                    logger.warning(f"[Dynamic Viewport] Waiter awoke but target product was not in cache: {my_viewport_filename}. Proceeding to self-heal and fetch.")
            except Exception as e:
                logger.warning(f"[Dynamic Viewport] Shared in-flight fetch failed or raised exception: {e}. Proceeding to self-heal and fetch.")

            async with self.IN_FLIGHT_LOCK:
                if request_dedup_key in self.IN_FLIGHT_REQUESTS:
                    context = self.IN_FLIGHT_REQUESTS[request_dedup_key]
                    is_fetcher = False
                else:
                    context = FetchContext()
                    self.IN_FLIGHT_REQUESTS[request_dedup_key] = context
                    is_fetcher = True

            if not is_fetcher:
                logger.info(f"[Dynamic Viewport] Waiter sharing newly spawned self-heal fetcher for {request_dedup_key}")
                try:
                    await context.raw_fetch_future
                    my_cache_key = build_dynamic_cache_key(model, domain, layer, target_dt, west, south, east, north)
                    my_viewport_filename = f"{my_cache_key}.json"

                    loaded_product = await asyncio.to_thread(self.store.load_product, my_viewport_filename)
                    if not loaded_product:
                        hour_fut = None
                        async with self.IN_FLIGHT_LOCK:
                            if target_dt in context.hour_futures:
                                hour_fut = context.hour_futures[target_dt]
                            else:
                                hour_fut = asyncio.Future()
                                context.hour_futures[target_dt] = hour_fut
                        await hour_fut
                        loaded_product = await asyncio.to_thread(self.store.load_product, my_viewport_filename)

                    if loaded_product and _is_oversized_grid(loaded_product):
                        logger.warning(
                            f"[Dynamic Viewport] Waiter self-heal loaded cached product {my_viewport_filename} "
                            f"but it was oversized ({len(loaded_product.grid.vectors)} vectors). Treating as cache miss."
                        )
                        loaded_product = None

                    if loaded_product:
                        loaded_product.cache_hit = "cache_hit"
                        loaded_product.requested_bbox_original = bbox_str
                        loaded_product.query_bbox = f"{west:.4f},{south:.4f},{east:.4f},{north:.4f}"
                        loaded_product.partial_coverage = False
                        loaded_product.stale = False
                        if domain.lower() != "wind":
                            loaded_product = filter_grid_to_bbox(loaded_product, get_snapped_bbox(bbox_str, model))
                        if loaded_product.grid and loaded_product.grid.bounds:
                            loaded_product.served_bbox = f"{loaded_product.grid.bounds.west:.4f},{loaded_product.grid.bounds.south:.4f},{loaded_product.grid.bounds.east:.4f},{loaded_product.grid.bounds.north:.4f}"
                        return loaded_product
                except Exception as inner_e:
                    logger.error(f"[Dynamic Viewport] Waiter self-heal retry failed: {inner_e}")

                fallback_product = await self._find_any_cached_product(model, domain, layer, target_dt, bbox_str)
                if fallback_product:
                    logger.info(f"[Dynamic Viewport] Fallback (Self-Heal Waiter Failure): Found cached product {fallback_product.product_id}")
                    fallback_product.cache_hit = "stale_cache_hit"
                    fallback_product.requested_bbox_original = bbox_str
                    fallback_product.query_bbox = f"{west:.4f},{south:.4f},{east:.4f},{north:.4f}"
                    fallback_product.requested_bbox = bbox_str
                    fallback_product.is_dynamic_viewport_product = True
                    fallback_product.stale = True
                    fallback_product.staleReason = "upstream_request_failed"
                    fallback_product.partial_coverage = False
                    if domain.lower() != "wind":
                        fallback_product = filter_grid_to_bbox(fallback_product, get_snapped_bbox(bbox_str, model))
                    if fallback_product.grid and fallback_product.grid.bounds:
                        fallback_product.served_bbox = f"{fallback_product.grid.bounds.west:.4f},{fallback_product.grid.bounds.south:.4f},{fallback_product.grid.bounds.east:.4f},{fallback_product.grid.bounds.north:.4f}"
                    return fallback_product

                raise HTTPException(status_code=504, detail="Upstream weather request failed (shared self-heal).")

        try:
            lats_coords, lons_coords = generate_bbox_coords(west, south, east, north, resolution)
            coord_count = len(lats_coords)

            coord_cap = 3000 if domain.lower() == "wind" else 800
            resolution_steps = [0.25, 0.5, 1.0, 2.0, 2.5, 5.0, 10.0, 15.0, 20.0, 30.0, 40.0]
            while coord_count > coord_cap and resolution != 40.0:
                idx = resolution_steps.index(resolution)
                resolution = resolution_steps[min(len(resolution_steps) - 1, idx + 1)]
                lats_coords, lons_coords = generate_bbox_coords(west, south, east, north, resolution)
                coord_count = len(lats_coords)

            bbox_dict = {"west": west, "south": south, "east": east, "north": north}
            env_viewport_marine_delay = float(os.environ.get("OPEN_METEO_VIEWPORT_MARINE_BATCH_DELAY_SEC", "0.8"))
            env_wind_delay = float(os.environ.get("OPEN_METEO_WIND_BATCH_DELAY_SEC", "0.5"))
            inter_delay = env_wind_delay if (model.upper() == "GFS" and domain == "wind") else env_viewport_marine_delay
            is_conjoined = model.upper() in ("GFS", "ICON") and layer.lower() in ("waves", "swell_1", "swell_2", "wind_waves")
            fetch_model = model
            fetch_layer = "all_marine" if is_conjoined else layer
            # Upstream timeout caps ANY provider hang (the open-meteo path had none → EURO wind fetches
            # for uncached wide viewports hung ~90s, blocking the worker). On timeout → graceful no-cov.
            is_render_env = os.environ.get("RENDER") == "true"
            upstream_timeout = float(os.environ.get("VIEWPORT_UPSTREAM_TIMEOUT_SEC", "20.0" if is_render_env else "30.0"))
            # EURO (ecmwf_ifs) wind upstream is reliably ~20s for a global viewport — too slow for the
            # marine→wind toggle. Use a SHORT timeout so it fails over FAST to the GFS-wind fallback
            # (grid_resolver) instead of blocking activation ~20s. Once the scheduled EURO wind
            # global_coarse product exists, /grid serves it from disk and never reaches this fetch.
            if model.upper() == "EURO" and domain.lower() == "wind":
                upstream_timeout = float(os.environ.get("EURO_WIND_UPSTREAM_TIMEOUT_SEC", "6.0"))
            if model.upper() == "EURO" and domain.lower() == "marine":
                from services.weather_pipeline.providers.copernicus_provider import CopernicusProvider
                cop_provider = CopernicusProvider()
                cop_forecast_days = min(forecast_days, 3) if is_global_view else forecast_days
                try:
                    raw_data = await asyncio.wait_for(
                        cop_provider.fetch_grid(
                            layer=fetch_layer,
                            bbox=bbox_dict,
                            resolution=resolution,
                            forecast_days=cop_forecast_days,
                            precomputed_coords=(lats_coords, lons_coords),
                            valid_time=valid_time_str
                        ),
                        timeout=upstream_timeout
                    )
                except asyncio.TimeoutError:
                    logger.error(f"[Dynamic Viewport] Copernicus fetch timed out after {upstream_timeout}s. Returning empty grid.")
                    raw_data = None
            else:
                try:
                    raw_data = await asyncio.wait_for(
                        self.provider.fetch_grid(
                            model=fetch_model,
                            domain=domain,
                            layer=fetch_layer,
                            bbox=bbox_dict,
                            resolution=resolution,
                            forecast_days=forecast_days,
                            precomputed_coords=(lats_coords, lons_coords),
                            inter_batch_delay=inter_delay
                        ),
                        timeout=upstream_timeout
                    )
                except asyncio.TimeoutError:
                    logger.error(f"[Dynamic Viewport] Open-Meteo {model} {domain}/{layer} fetch timed out after {upstream_timeout}s. Returning empty grid.")
                    raw_data = None

            if not raw_data:
                logger.error(f"[Dynamic Viewport] Upstream fetch returned empty data.")
                raise Exception("Upstream fetch returned empty data.")

            raw_list = raw_data if isinstance(raw_data, list) else [raw_data]

            if model.upper() == "ICON" and domain.lower() == "wind":
                logger.info("[Dynamic Viewport] Dynamically extending ICON wind raw results to 14 days (336 hours) via loop extrapolation.")
                extend_icon_wind_to_14d(raw_list)

            first_point = raw_list[0]
            hourly = first_point.get("hourly", {})
            times = hourly.get("time", [])

            if not times:
                logger.error(f"[Dynamic Viewport] Upstream fetch returned no time array.")
                raise Exception("Upstream fetch returned no time array.")

            target_idx = WeatherNormalizer.find_closest_time_index(times, target_dt)
            if target_idx is None:
                logger.error(f"[Dynamic Viewport] target_dt {target_dt} is not covered by the fetched times.")
                raise Exception(f"target_dt {target_dt} is not covered by the fetched times.")

            context.raw_list = raw_list
            async with self.IN_FLIGHT_LOCK:
                if not context.raw_fetch_future.done():
                    context.raw_fetch_future.set_result(True)

            target_t_str = times[target_idx]
            target_t_str_with_z = target_t_str if target_t_str.endswith("Z") else target_t_str + "Z"
            target_dt_actual = datetime.fromisoformat(target_t_str_with_z.replace("Z", "+00:00"))

            is_conjoined = model.upper() in ("GFS", "ICON") and layer.lower() in ("waves", "swell_1", "swell_2", "wind_waves")
            if is_conjoined:
                conjoined_layers = ("waves", "swell_1", "wind_waves") if model.upper() == "ICON" else ("waves", "swell_1", "swell_2", "wind_waves")
            else:
                conjoined_layers = (layer.lower(),)
            target_normalized_product = None

            for target_layer in conjoined_layers:
                target_cache_key = build_dynamic_cache_key(model, domain, target_layer, target_dt_actual, west, south, east, north)
                target_viewport_filename = f"{target_cache_key}.json"

                normalized = await self.normalizer.normalize_async(
                    model=model,
                    provider="copernicus" if (model.upper() == "EURO" and domain.lower() == "marine") else "open-meteo",
                    domain=domain,
                    layer=target_layer,
                    raw_results=raw_list,
                    bbox=bbox_dict,
                    resolution=resolution,
                    target_time=target_dt_actual,
                    coverage_mode="viewport",
                    region_id=f"viewport_{bbox_key_str}"
                )

                if normalized and model.upper() == "ICON" and domain.lower() == "wind" and target_idx >= 120:
                    normalized.is_estimated = True
                    normalized.is_forecast_authoritative = False
                    normalized.estimate_basis = {
                        "type": "icon_loop_extrapolation",
                        "native_horizon_hours": 120,
                        "method": "diurnal_cycle_loop",
                        "source_model": "dwd_icon"
                    }



                if not normalized:
                    if target_layer == layer.lower():
                        raise Exception("Target product normalization returned None.")
                    continue

                is_empty_grid = False
                if normalized.grid and normalized.grid.vectors:
                    if not any(v.speed > 0 for v in normalized.grid.vectors):
                        is_empty_grid = True

                if is_empty_grid:
                    logger.warning(f"[Dynamic Viewport] Normalization produced empty grid for target hour: model={model}, domain={domain}, layer={target_layer}. Allowing zero grid.")

                served_bbox_full = f"{normalized.grid.bounds.west},{normalized.grid.bounds.south},{normalized.grid.bounds.east},{normalized.grid.bounds.north}"

                normalized.product_id = target_viewport_filename
                normalized.is_dynamic_viewport_product = True
                normalized.cache_key = target_cache_key
                normalized.cache_hit = "cache_miss"
                normalized.requested_bbox = bbox_str
                normalized.served_bbox = served_bbox_full
                normalized.coverage_scope = coverage_scope
                normalized.coordinate_count = coord_count
                normalized.resolution = resolution
                normalized.requested_bbox_original = bbox_str
                normalized.query_bbox = f"{west:.4f},{south:.4f},{east:.4f},{north:.4f}"
                normalized.partial_coverage = False
                normalized.stale = False

                if normalized.grid:
                    normalized.grid.diagnostics = {
                        "requested_bbox": bbox_str,
                        "served_bbox": served_bbox_full,
                        "coverage_scope": coverage_scope,
                        "source_product_ids": ["open-meteo"],
                        "cache_hit": "cache_miss",
                        "provider": normalized.provider,
                        "model": model,
                        "domain": domain,
                        "layer": target_layer,
                        "valid_time": target_dt_actual.strftime("%Y-%m-%dT%H:%M:%SZ"),
                        "nonzeroCount": normalized.grid.diagnostics.get("nonzeroCount", 0) if normalized.grid.diagnostics else 0,
                        "vectorCount": len(normalized.grid.vectors) if normalized.grid.vectors else 0,
                        "vectors_length": len(normalized.grid.vectors) if normalized.grid.vectors else 0,
                        "gridMode": "rectangular",
                        "renderable": len(normalized.grid.vectors) > 0 and any(v.speed > 0 for v in normalized.grid.vectors),
                        "stale": False,
                        "partial_coverage": False
                    }

                filepath = self.store.cache_dir / target_viewport_filename
                tmp_filepath = filepath.with_suffix(".tmp")

                product_json_bytes = normalized.model_dump_json().encode("utf-8")
                def save_to_disk(filepath, tmp_filepath, product_json_bytes):
                    with open(tmp_filepath, "wb") as f:
                        f.write(product_json_bytes)
                    os.replace(tmp_filepath, filepath)
                await asyncio.to_thread(save_to_disk, filepath, tmp_filepath, product_json_bytes)

                self.dynamic_index.add_product(
                    product_id=target_viewport_filename,
                    model=model,
                    domain=domain,
                    layer=target_layer,
                    valid_time=target_dt_actual,
                    requested_bbox=bbox_str,
                    served_bbox=served_bbox_full,
                    coverage_scope=coverage_scope,
                    resolution=resolution,
                    cache_key=target_cache_key,
                    source=normalized.provider
                )

                if target_layer == layer.lower():
                    target_normalized_product = normalized

            async with self.IN_FLIGHT_LOCK:
                for d in (target_dt, target_dt_actual):
                    fut = context.hour_futures.get(d)
                    if fut and not fut.done():
                        fut.set_result(True)

            bg_key = f"{model.lower()}_{domain.lower()}"
            old_task = self.ACTIVE_BG_TASKS.get(bg_key)
            if old_task and not old_task.done():
                logger.info(f"[Dynamic Viewport] Canceling stale background task for {bg_key}")
                old_task.cancel()

            from services.weather_pipeline.viewport_helper import bg_process_remaining_hours_helper
            task = asyncio.create_task(bg_process_remaining_hours_helper(
                service=self,
                context=context,
                request_dedup_key=request_dedup_key,
                model=model,
                domain=domain,
                layer=layer,
                bbox_dict=bbox_dict,
                resolution=resolution,
                west=west,
                south=south,
                east=east,
                north=north,
                times=times,
                target_idx=target_idx,
                bbox_str=bbox_str,
                coverage_scope=coverage_scope,
                coord_count=coord_count,
                bbox_key_str=bbox_key_str
            ))
            self.ACTIVE_BG_TASKS[bg_key] = task

            gc.collect()
            if target_normalized_product and _is_oversized_grid(target_normalized_product):
                raise ValueError(
                    f"Freshly normalized product {target_normalized_product.product_id} is oversized: "
                    f"{len(target_normalized_product.grid.vectors)} vectors"
                )

            if target_normalized_product.coverage_scope == "global_coarse" or domain.lower() == "wind":
                return target_normalized_product
            cropped_product = filter_grid_to_bbox(target_normalized_product, get_snapped_bbox(bbox_str, model))
            if cropped_product.grid and cropped_product.grid.bounds:
                cropped_product.served_bbox = f"{cropped_product.grid.bounds.west:.4f},{cropped_product.grid.bounds.south:.4f},{cropped_product.grid.bounds.east:.4f},{cropped_product.grid.bounds.north:.4f}"
            return cropped_product

        except Exception as e:
            async with self.IN_FLIGHT_LOCK:
                if request_dedup_key in self.IN_FLIGHT_REQUESTS:
                    ctx = self.IN_FLIGHT_REQUESTS[request_dedup_key]
                    if not ctx.raw_fetch_future.done():
                        ctx.raw_fetch_future.set_exception(e)
                        try:
                            ctx.raw_fetch_future.exception()
                        except Exception:
                            pass
                    for dt, fut in ctx.hour_futures.items():
                        if not fut.done():
                            fut.set_exception(e)
                            try:
                                fut.exception()
                            except Exception:
                                pass
                    self.IN_FLIGHT_REQUESTS.pop(request_dedup_key, None)

            logger.warning(f"[Dynamic Viewport] Upstream fetch failed for {model} {layer}: {e}")

            err_cls, err_str = e.__class__.__name__.lower(), str(e).lower()
            is_cancelled = isinstance(e, asyncio.CancelledError) or any(x in err_cls or x in err_str for x in ("cancel", "abort", "disconnect"))
            if not is_cancelled:
                is_429 = any(x in err_str for x in ("429", "rate limit", "too many requests"))
                neg_ttl = 120 if is_429 else 60
                self.NEGATIVE_CACHE[cache_key] = datetime.now(timezone.utc).timestamp() + neg_ttl
                logger.info(f"[Dynamic Viewport] Registered negative cache key for {neg_ttl}s: {cache_key}")
            else:
                logger.info(f"[Dynamic Viewport] Request cancelled or aborted ({e}). Skipping negative cache registration.")

            fallback_product = await self._find_any_cached_product(model, domain, layer, target_dt, bbox_str)
            if fallback_product:
                logger.info(f"[Dynamic Viewport] Fallback: Found previous cached product {fallback_product.product_id} for stale return")
                fallback_product.cache_hit = "stale_cache_hit"
                fallback_product.requested_bbox_original = bbox_str
                fallback_product.query_bbox = f"{west:.4f},{south:.4f},{east:.4f},{north:.4f}"
                fallback_product.requested_bbox = bbox_str
                fallback_product.is_dynamic_viewport_product = True
                fallback_product.stale = True
                fallback_product.staleReason = "upstream_rate_limited"
                fallback_product.fallbackReason = "upstream_rate_limited"
                fallback_product.partial_coverage = False

                if domain.lower() != "wind":
                    fallback_product = filter_grid_to_bbox(fallback_product, get_snapped_bbox(bbox_str, model))
                served_bbox = f"{fallback_product.grid.bounds.west:.4f},{fallback_product.grid.bounds.south:.4f},{fallback_product.grid.bounds.east:.4f},{fallback_product.grid.bounds.north:.4f}"
                fallback_product.served_bbox = served_bbox

                if fallback_product.grid:
                    fallback_product.grid.diagnostics = {
                        "requested_bbox": bbox_str,
                        "served_bbox": served_bbox,
                        "coverage_scope": fallback_product.coverage_scope or coverage_scope,
                        "source_product_ids": [fallback_product.product_id],
                        "cache_hit": "stale_cache_hit",
                        "provider": fallback_product.provider,  # Keep real provider name
                        "model": model,
                        "domain": domain,
                        "layer": layer,
                        "valid_time": target_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
                        "nonzeroCount": fallback_product.grid.diagnostics.get("nonzeroCount", 0) if fallback_product.grid.diagnostics else 0,
                        "vectorCount": len(fallback_product.grid.vectors) if fallback_product.grid.vectors else 0,
                        "vectors_length": len(fallback_product.grid.vectors) if fallback_product.grid.vectors else 0,
                        "gridMode": "rectangular",
                        "renderable": len(fallback_product.grid.vectors) > 0 and any(v.speed > 0 for v in fallback_product.grid.vectors),
                        "stale": True,
                        "staleReason": "upstream_rate_limited",
                        "fallbackReason": "upstream_rate_limited",
                        "partial_coverage": False
                    }
                return fallback_product

            if isinstance(e, HTTPException):
                raise e
            raise HTTPException(status_code=504, detail=f"Viewport fetch failed: {str(e)}")

    async def fetch_viewport_grid(
        self,
        model: str,
        domain: str,
        layer: str,
        valid_time_str: str,
        target_dt: datetime,
        bbox_str: str,
        force_refresh: bool = False
    ) -> NormalizedProduct:
        if not force_refresh:
            cached = await self.get_cached_dynamic_product(model, domain, layer, target_dt, bbox_str)
            if cached:
                return cached
        return await self.fetch_viewport_grid_upstream(model, domain, layer, valid_time_str, target_dt, bbox_str)

    async def _revalidate_fetch(
        self,
        model: str,
        domain: str,
        layer: str,
        valid_time_str: str,
        target_dt: datetime,
        bbox_str: str,
        reval_key: str
    ):
        """Asynchronously refetches a viewport grid and updates cache without throwing errors to response.

        SERIALIZED (2026-07-05, the 18:40Z Render OOM while panning with the mid-tier SWR live): the
        per-key ACTIVE_REVALIDATIONS dedup does NOT bound CONCURRENCY across keys — a pan/scrub spawns
        several revalidations (different hours/layers/bboxes), each a full upstream fetch + normalize,
        and the 512MB 1-CPU serve box OOMs. A class-level semaphore (MARINE_REVAL_CONCURRENCY, default
        1) serializes them: the serve path stays instant (previews), sharpening queues instead of
        stampeding."""
        if not hasattr(type(self), "_REVAL_SEMAPHORE"):
            type(self)._REVAL_SEMAPHORE = asyncio.Semaphore(
                max(1, int(os.environ.get("MARINE_REVAL_CONCURRENCY", "1")))
            )
        try:
            async with type(self)._REVAL_SEMAPHORE:
                await self.fetch_viewport_grid(
                    model=model, domain=domain, layer=layer,
                    valid_time_str=valid_time_str, target_dt=target_dt,
                    bbox_str=bbox_str, force_refresh=True
                )
            logger.info(f"[Dynamic Viewport] SWR background revalidation succeeded for {reval_key}")
        except Exception as e:
            logger.warning(f"[Dynamic Viewport] SWR background revalidation failed for {reval_key}: {e}")
        finally:
            self.ACTIVE_REVALIDATIONS.discard(reval_key)

    async def _find_any_cached_product(
        self,
        model: str,
        domain: str,
        layer: str,
        target_dt: datetime,
        bbox_str: Optional[str] = None,
        require_coverage: bool = False
    ) -> Optional[NormalizedProduct]:
        """Searches dynamic index and manifest for any product matching model/layer and target time, choosing the closest.

        ``require_coverage`` forwards to find_any_cached_product_helper — set True only for the Step 3.7
        instant-preview so a non-wide viewport gets a COVERING tile (kills the zoom-out clamp); the
        rate-limit / self-heal callers leave it False to keep serving any overlapping stale tile."""
        from services.weather_pipeline.viewport_helper import find_any_cached_product_helper
        return await find_any_cached_product_helper(
            model=model,
            domain=domain,
            layer=layer,
            target_dt=target_dt,
            dynamic_index=self.dynamic_index,
            store=self.store,
            bbox_str=bbox_str,
            require_coverage=require_coverage
        )
