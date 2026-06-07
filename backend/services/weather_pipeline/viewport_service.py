import os
import asyncio
import logging
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
    choose_adaptive_resolution, build_dynamic_cache_key
)

logger = logging.getLogger(__name__)

class ViewportService:
    """
    Service responsible for managing dynamic viewport bounding-box weather queries.
    Handles caching, concurrent request deduplication, coordinate generation,
    Open-Meteo fetching, and normalization.
    """
    
    # Class-level registry for request deduplication
    IN_FLIGHT_REQUESTS: Dict[str, asyncio.Future] = {}
    IN_FLIGHT_LOCK = asyncio.Lock()

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

    def is_viewport_enabled(self, model: str, domain: str, layer: str, use_manifest_product: bool, bbox: Optional[str] = None) -> bool:
        """
        Determines if dynamic viewport bounds fetching is enabled for the model/layer combination.
        """
        return (
            bool(bbox) and
            model.upper() in ("GFS", "ICON", "EURO") and
            (
                (domain.lower() == "marine" and layer.lower() in ("waves", "swell_1", "swell_2", "wind_waves")) or
                (domain.lower() == "wind" and layer.lower() == "wind")
            )
            and not use_manifest_product
        )

    async def fetch_viewport_grid(
        self,
        model: str,
        domain: str,
        layer: str,
        valid_time_str: str,
        target_dt: datetime,
        bbox_str: str
    ) -> NormalizedProduct:
        """
        Orchestrates the dynamic viewport fetching workflow.
        """
        # 1. Parse and clamp/normalize bounding box
        req_w, req_s, req_e, req_n = parse_bbox(bbox_str)
        west, south, east, north = clamp_and_normalize_bbox(req_w, req_s, req_e, req_n)

        # Calculate spans (taking into account antimeridian wrap)
        if west <= east:
            span_lng = east - west
        else:
            span_lng = (180.0 - west) + (east + 180.0)
        span_lat = abs(north - south)

        is_global_view = (span_lng > 180.0 or span_lat > 90.0)
        coverage_scope = "global_coarse" if is_global_view else "viewport"

        # Determine adaptive resolution
        resolution = choose_adaptive_resolution(span_lng, span_lat)

        # Generate cache key and viewport filename
        time_str = target_dt.strftime("%Y%m%dT%H%M%SZ")
        bbox_key_str = f"{west:.2f}_{south:.2f}_{east:.2f}_{north:.2f}"
        cache_key = build_dynamic_cache_key(model, domain, layer, target_dt, west, south, east, north)
        viewport_filename = f"{cache_key}.json"

        # 2. Check Dynamic Product Index
        cached_entry = self.dynamic_index.find_product(
            model=model, domain=domain, layer=layer, valid_time=target_dt, cache_key=cache_key
        )

        if cached_entry:
            # Try to load the file from L1 cache
            loaded_product = self.store.load_product(cached_entry["product_id"])
            if loaded_product:
                logger.info(f"[Dynamic Viewport] Cache HIT for {viewport_filename}")
                loaded_product.cache_hit = "cache_hit"
                loaded_product.resolution = cached_entry.get("resolution")
                
                # Update diagnostics in the response
                if loaded_product.grid:
                    loaded_product.grid.diagnostics = {
                        "requested_bbox": bbox_str,
                        "served_bbox": cached_entry["served_bbox"],
                        "coverage_scope": cached_entry["coverage_scope"],
                        "source_product_ids": [cached_entry["product_id"]],
                        "cache_hit": "cache_hit",
                        "provider": cached_entry["source"],
                        "model": model,
                        "domain": domain,
                        "layer": layer,
                        "valid_time": valid_time_str,
                        "nonzeroCount": loaded_product.grid.diagnostics.get("nonzeroCount", 0) if loaded_product.grid.diagnostics else 0,
                        "vectorCount": len(loaded_product.grid.vectors) if loaded_product.grid.vectors else 0,
                        "vectors_length": len(loaded_product.grid.vectors) if loaded_product.grid.vectors else 0,
                        "gridMode": "rectangular",
                        "renderable": loaded_product.grid.diagnostics.get("renderable", True) if loaded_product.grid.diagnostics else True
                    }
                return loaded_product

        # Cache MISS or load failed — Fetch dynamically
        logger.info(f"[Dynamic Viewport] Cache MISS for {viewport_filename}. Fetching dynamically.")

        # 3. Deduplicate concurrent requests in-flight
        request_dedup_key = f"{model.lower()}_{domain.lower()}_{layer.lower()}_{time_str}_{bbox_key_str}"
        my_future = None
        is_fetcher = False

        async with self.IN_FLIGHT_LOCK:
            if request_dedup_key in self.IN_FLIGHT_REQUESTS:
                my_future = self.IN_FLIGHT_REQUESTS[request_dedup_key]
            else:
                my_future = asyncio.Future()
                self.IN_FLIGHT_REQUESTS[request_dedup_key] = my_future
                is_fetcher = True

        if not is_fetcher:
            logger.info(f"[Dynamic Viewport] Sharing in-flight request for {request_dedup_key}")
            try:
                result_filename = await my_future
                loaded_product = self.store.load_product(result_filename)
                if loaded_product:
                    loaded_product.cache_hit = "cache_hit"  # Shared from fetcher
                    return loaded_product
            except Exception as e:
                logger.error(f"[Dynamic Viewport] Shared in-flight fetch failed: {e}")
                raise HTTPException(status_code=504, detail="Upstream weather request failed (shared).")

        try:
            # We are the fetcher! Let's generate coordinates
            lats_coords, lons_coords = generate_bbox_coords(west, south, east, north, resolution)
            coord_count = len(lats_coords)

            # Safety step-up for coordinate count
            resolution_steps = [0.25, 0.5, 1.0, 2.0, 2.5, 5.0, 10.0]
            while coord_count > 800 and resolution != 10.0:
                idx = resolution_steps.index(resolution)
                resolution = resolution_steps[min(len(resolution_steps) - 1, idx + 1)]
                lats_coords, lons_coords = generate_bbox_coords(west, south, east, north, resolution)
                coord_count = len(lats_coords)

            logger.info(f"[Dynamic Viewport] Fetching coordinates count: {coord_count} at resolution {resolution}°")

            bbox_dict = {"west": west, "south": south, "east": east, "north": north}
            days_diff = (target_dt - datetime.now(timezone.utc)).days + 2
            forecast_days = max(2, min(16, days_diff))

            # Fetch via updated OpenMeteoProvider without monkeypatching!
            # Pass precomputed coordinates and low inter-batch delay (0.1s)
            raw_data = await self.provider.fetch_grid(
                model=model,
                domain=domain,
                layer=layer,
                bbox=bbox_dict,
                resolution=resolution,
                forecast_days=forecast_days,
                precomputed_coords=(lats_coords, lons_coords),
                inter_batch_delay=0.1
            )

            if not raw_data:
                logger.error(f"[Dynamic Viewport] Upstream fetch returned empty data.")
                raise HTTPException(status_code=504, detail="Weather data fetch from Open-Meteo failed.")

            # Normalize raw data
            raw_list = raw_data if isinstance(raw_data, list) else [raw_data]
            normalized_product = self.normalizer.normalize(
                model=model,
                provider="open-meteo",
                domain=domain,
                layer=layer,
                raw_results=raw_list,
                bbox=bbox_dict,
                resolution=resolution,
                target_time=target_dt,
                coverage_mode="viewport",
                region_id=f"viewport_{bbox_key_str}"
            )

            if not normalized_product:
                logger.error(f"[Dynamic Viewport] Normalization failed.")
                raise HTTPException(status_code=500, detail="Grid normalization failed.")

            # Update conformed metadata
            served_bbox = f"{normalized_product.grid.bounds.west},{normalized_product.grid.bounds.south},{normalized_product.grid.bounds.east},{normalized_product.grid.bounds.north}"
            
            normalized_product.product_id = viewport_filename
            normalized_product.is_dynamic_viewport_product = True
            normalized_product.cache_key = cache_key
            normalized_product.cache_hit = "cache_miss"
            normalized_product.requested_bbox = bbox_str
            normalized_product.served_bbox = served_bbox
            normalized_product.coverage_scope = coverage_scope
            normalized_product.coordinate_count = coord_count
            normalized_product.resolution = resolution

            # Populate diagnostics in the response
            if normalized_product.grid:
                normalized_product.grid.diagnostics = {
                    "requested_bbox": bbox_str,
                    "served_bbox": served_bbox,
                    "coverage_scope": coverage_scope,
                    "source_product_ids": ["open-meteo"],
                    "cache_hit": "cache_miss",
                    "provider": "open-meteo",
                    "model": model,
                    "domain": domain,
                    "layer": layer,
                    "valid_time": valid_time_str,
                    "nonzeroCount": normalized_product.grid.diagnostics.get("nonzeroCount", 0) if normalized_product.grid.diagnostics else 0,
                    "vectorCount": len(normalized_product.grid.vectors) if normalized_product.grid.vectors else 0,
                    "vectors_length": len(normalized_product.grid.vectors) if normalized_product.grid.vectors else 0,
                    "gridMode": "rectangular",
                    "renderable": normalized_product.grid.diagnostics.get("renderable", True) if normalized_product.grid.diagnostics else True
                }

            # Save to disk L1 cache and upload L2
            filepath = self.store.cache_dir / viewport_filename
            tmp_filepath = filepath.with_suffix(".tmp")
            try:
                product_json_bytes = normalized_product.model_dump_json().encode("utf-8")
                with open(tmp_filepath, "wb") as f:
                    f.write(product_json_bytes)
                os.replace(tmp_filepath, filepath)
                
                self.store._upload_to_supabase(viewport_filename, product_json_bytes)
            except Exception as se:
                logger.error(f"[Dynamic Viewport] Failed to save dynamic conformed product file: {se}")

            # Register in Dynamic Product Index
            self.dynamic_index.add_product(
                product_id=viewport_filename,
                model=model,
                domain=domain,
                layer=layer,
                valid_time=target_dt,
                requested_bbox=bbox_str,
                served_bbox=served_bbox,
                coverage_scope=coverage_scope,
                resolution=resolution,
                cache_key=cache_key,
                source="open-meteo"
            )

            # Acknowledge completion to shared listeners
            async with self.IN_FLIGHT_LOCK:
                my_future.set_result(viewport_filename)
                self.IN_FLIGHT_REQUESTS.pop(request_dedup_key, None)

            return normalized_product

        except Exception as e:
            # Reject shared listeners
            async with self.IN_FLIGHT_LOCK:
                if request_dedup_key in self.IN_FLIGHT_REQUESTS:
                    self.IN_FLIGHT_REQUESTS[request_dedup_key].set_exception(e)
                    self.IN_FLIGHT_REQUESTS.pop(request_dedup_key, None)
            if isinstance(e, HTTPException):
                raise e
            raise HTTPException(status_code=504, detail=f"Viewport fetch failed: {str(e)}")
