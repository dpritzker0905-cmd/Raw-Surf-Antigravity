import os
import asyncio
import logging
import math
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
    is_bbox_covered_by
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

    # Class-level registry for active revalidation tasks (SWR)
    ACTIVE_REVALIDATIONS = set()

    # Class-level registry for negative caching of rate limit errors / timeouts
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

    async def get_cached_dynamic_product(
        self,
        model: str,
        domain: str,
        layer: str,
        target_dt: datetime,
        bbox_str: str
    ) -> Optional[NormalizedProduct]:
        """
        Step 1 & 2: Checks dynamic product index for a fresh or stale cache hit.
        Returns the product if found (and triggers SWR if stale).
        """
        # Parse and snap bounding box outward to nearest tileSize (1.0 for GFS vs 2.0 for EURO/ICON)
        req_w, req_s, req_e, req_n = parse_bbox(bbox_str)
        tileSize = 1.0 if model.upper() == "GFS" else 2.0
        
        snap_w = math.floor(req_w / tileSize) * tileSize
        snap_s = math.floor(req_s / tileSize) * tileSize
        snap_e = math.ceil(req_e / tileSize) * tileSize
        snap_n = math.ceil(req_n / tileSize) * tileSize
        
        west, south, east, north = clamp_and_normalize_bbox(snap_w, snap_s, snap_e, snap_n)

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
        cache_key = build_dynamic_cache_key(model, domain, layer, target_dt, west, south, east, north)
        viewport_filename = f"{cache_key}.json"

        # Check Dynamic Product Index
        cached_entry = self.dynamic_index.find_product(
            model=model, domain=domain, layer=layer, valid_time=target_dt, cache_key=cache_key
        )

        if cached_entry:
            loaded_product = self.store.load_product(cached_entry["product_id"])
            if loaded_product:
                logger.info(f"[Dynamic Viewport] Cache HIT for {viewport_filename}")
                loaded_product.resolution = cached_entry.get("resolution")
                loaded_product.requested_bbox_original = bbox_str
                loaded_product.query_bbox = f"{west:.4f},{south:.4f},{east:.4f},{north:.4f}"
                loaded_product.partial_coverage = False
                
                is_stale_swr = False
                # Check age for SWR background revalidation
                created_at_str = cached_entry.get("created_at")
                if created_at_str:
                    try:
                        created_at = datetime.fromisoformat(created_at_str.replace("Z", "+00:00"))
                        age_sec = (datetime.now(timezone.utc) - created_at).total_seconds()
                        if age_sec > 1800:  # 30 minutes
                            is_stale_swr = True
                            reval_key = f"{model.lower()}_{domain.lower()}_{layer.lower()}_{time_str}_{cache_key}"
                            if reval_key not in self.ACTIVE_REVALIDATIONS:
                                self.ACTIVE_REVALIDATIONS.add(reval_key)
                                logger.info(f"[Dynamic Viewport] SWR background revalidation triggered for {reval_key} (age: {age_sec:.1f}s)")
                                asyncio.create_task(self._revalidate_fetch(
                                    model, domain, layer, time_str, target_dt, bbox_str, reval_key
                                ))
                    except Exception as swr_err:
                        logger.error(f"[Dynamic Viewport] SWR setup error: {swr_err}")
                
                loaded_product.cache_hit = "stale_cache_hit" if is_stale_swr else "cache_hit"
                loaded_product.stale = is_stale_swr
                if is_stale_swr:
                    loaded_product.staleReason = "swr_revalidation_pending"
                else:
                    loaded_product.staleReason = None
                
                # Update diagnostics in the response
                if loaded_product.grid:
                    # Crop the loaded product to exact requested bbox bounds
                    loaded_product = filter_grid_to_bbox(loaded_product, bbox_str)
                    served_bbox = f"{loaded_product.grid.bounds.west:.4f},{loaded_product.grid.bounds.south:.4f},{loaded_product.grid.bounds.east:.4f},{loaded_product.grid.bounds.north:.4f}"
                    
                    loaded_product.grid.diagnostics = {
                        "requested_bbox": bbox_str,
                        "served_bbox": served_bbox,
                        "coverage_scope": cached_entry.get("coverage_scope", coverage_scope),
                        "source_product_ids": [cached_entry["product_id"]],
                        "cache_hit": "stale_cache_hit" if is_stale_swr else "cache_hit",
                        "provider": loaded_product.provider,
                        "model": model,
                        "domain": domain,
                        "layer": layer,
                        "valid_time": target_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
                        "nonzeroCount": loaded_product.grid.diagnostics.get("nonzeroCount", 0) if loaded_product.grid.diagnostics else 0,
                        "vectorCount": len(loaded_product.grid.vectors) if loaded_product.grid.vectors else 0,
                        "vectors_length": len(loaded_product.grid.vectors) if loaded_product.grid.vectors else 0,
                        "gridMode": "rectangular",
                        "renderable": len(loaded_product.grid.vectors) > 0 and any(v.speed > 0 for v in loaded_product.grid.vectors),
                        "stale": is_stale_swr,
                        "staleReason": "swr_revalidation_pending" if is_stale_swr else None,
                        "partial_coverage": False
                    }
                    loaded_product.served_bbox = served_bbox
                return loaded_product
        return None

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
        # Parse and snap bounding box outward to nearest tileSize (1.0 for GFS vs 2.0 for EURO/ICON)
        req_w, req_s, req_e, req_n = parse_bbox(bbox_str)
        tileSize = 1.0 if model.upper() == "GFS" else 2.0
        
        snap_w = math.floor(req_w / tileSize) * tileSize
        snap_s = math.floor(req_s / tileSize) * tileSize
        snap_e = math.ceil(req_e / tileSize) * tileSize
        snap_n = math.ceil(req_n / tileSize) * tileSize
        
        west, south, east, north = clamp_and_normalize_bbox(snap_w, snap_s, snap_e, snap_n)

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

        # Check negative cache
        now_ts = datetime.now(timezone.utc).timestamp()
        if cache_key in self.NEGATIVE_CACHE:
            expire_ts = self.NEGATIVE_CACHE[cache_key]
            if now_ts < expire_ts:
                logger.warning(f"[Dynamic Viewport] Negative cache hit for {cache_key}. Attempting stale fallback before rejecting.")
                fallback_product = self._find_any_cached_product(model, domain, layer, target_dt, bbox_str)
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
                    
                    fallback_product = filter_grid_to_bbox(fallback_product, bbox_str)
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

        # Deduplicate concurrent requests in-flight
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
                    loaded_product.requested_bbox_original = bbox_str
                    loaded_product.query_bbox = f"{west:.4f},{south:.4f},{east:.4f},{north:.4f}"
                    loaded_product.partial_coverage = False
                    loaded_product.stale = False
                    loaded_product = filter_grid_to_bbox(loaded_product, bbox_str)
                    if loaded_product.grid and loaded_product.grid.bounds:
                        loaded_product.served_bbox = f"{loaded_product.grid.bounds.west:.4f},{loaded_product.grid.bounds.south:.4f},{loaded_product.grid.bounds.east:.4f},{loaded_product.grid.bounds.north:.4f}"
                    return loaded_product
            except Exception as e:
                logger.error(f"[Dynamic Viewport] Shared in-flight fetch failed: {e}")
                raise HTTPException(status_code=504, detail="Upstream weather request failed (shared).")

        try:
            # We are the fetcher! Let's generate coordinates
            lats_coords, lons_coords = generate_bbox_coords(west, south, east, north, resolution)
            coord_count = len(lats_coords)

            # Safety step-up for coordinate count
            resolution_steps = [0.25, 0.5, 1.0, 2.0, 2.5, 5.0, 10.0, 15.0, 20.0, 30.0, 40.0]
            while coord_count > 100 and resolution != 40.0:
                idx = resolution_steps.index(resolution)
                resolution = resolution_steps[min(len(resolution_steps) - 1, idx + 1)]
                lats_coords, lons_coords = generate_bbox_coords(west, south, east, north, resolution)
                coord_count = len(lats_coords)

            logger.info(f"[Dynamic Viewport] Fetching coordinates count: {coord_count} at resolution {resolution}°")

            bbox_dict = {"west": west, "south": south, "east": east, "north": north}
            days_diff = (target_dt - datetime.now(timezone.utc)).days + 2
            forecast_days = max(2, min(16, days_diff))

            # Fetch via OpenMeteoProvider
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
                raise Exception("Upstream fetch returned empty data.")

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
                raise Exception("Grid normalization failed.")

            # Update conformed metadata
            served_bbox_full = f"{normalized_product.grid.bounds.west},{normalized_product.grid.bounds.south},{normalized_product.grid.bounds.east},{normalized_product.grid.bounds.north}"
            
            normalized_product.product_id = viewport_filename
            normalized_product.is_dynamic_viewport_product = True
            normalized_product.cache_key = cache_key
            normalized_product.cache_hit = "cache_miss"
            normalized_product.requested_bbox = bbox_str
            normalized_product.served_bbox = served_bbox_full
            normalized_product.coverage_scope = coverage_scope
            normalized_product.coordinate_count = coord_count
            normalized_product.resolution = resolution
            normalized_product.requested_bbox_original = bbox_str
            normalized_product.query_bbox = f"{west:.4f},{south:.4f},{east:.4f},{north:.4f}"
            normalized_product.partial_coverage = False
            normalized_product.stale = False

            # Populate diagnostics in the response
            if normalized_product.grid:
                normalized_product.grid.diagnostics = {
                    "requested_bbox": bbox_str,
                    "served_bbox": served_bbox_full,
                    "coverage_scope": coverage_scope,
                    "source_product_ids": ["open-meteo"],
                    "cache_hit": "cache_miss",
                    "provider": normalized_product.provider,
                    "model": model,
                    "domain": domain,
                    "layer": layer,
                    "valid_time": target_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
                    "nonzeroCount": normalized_product.grid.diagnostics.get("nonzeroCount", 0) if normalized_product.grid.diagnostics else 0,
                    "vectorCount": len(normalized_product.grid.vectors) if normalized_product.grid.vectors else 0,
                    "vectors_length": len(normalized_product.grid.vectors) if normalized_product.grid.vectors else 0,
                    "gridMode": "rectangular",
                    "renderable": len(normalized_product.grid.vectors) > 0 and any(v.speed > 0 for v in normalized_product.grid.vectors),
                    "stale": False,
                    "partial_coverage": False
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
                served_bbox=served_bbox_full,
                coverage_scope=coverage_scope,
                resolution=resolution,
                cache_key=cache_key,
                source=normalized_product.provider
            )

            # Acknowledge completion to shared listeners
            async with self.IN_FLIGHT_LOCK:
                my_future.set_result(viewport_filename)
                self.IN_FLIGHT_REQUESTS.pop(request_dedup_key, None)

            # Return exact cropped product for the client's original bbox request
            cropped_product = filter_grid_to_bbox(normalized_product, bbox_str)
            if cropped_product.grid and cropped_product.grid.bounds:
                cropped_product.served_bbox = f"{cropped_product.grid.bounds.west:.4f},{cropped_product.grid.bounds.south:.4f},{cropped_product.grid.bounds.east:.4f},{cropped_product.grid.bounds.north:.4f}"
            return cropped_product

        except Exception as e:
            # Reject shared listeners
            async with self.IN_FLIGHT_LOCK:
                if request_dedup_key in self.IN_FLIGHT_REQUESTS:
                    self.IN_FLIGHT_REQUESTS[request_dedup_key].set_exception(e)
                    self.IN_FLIGHT_REQUESTS.pop(request_dedup_key, None)

            logger.warning(f"[Dynamic Viewport] Upstream fetch failed for {model} {layer}: {e}")
            
            # Store failure in negative cache
            err_msg = str(e).lower()
            is_429 = "429" in err_msg or "rate limit" in err_msg or "too many requests" in err_msg
            neg_ttl = 120 if is_429 else 60
            now_ts = datetime.now(timezone.utc).timestamp()
            self.NEGATIVE_CACHE[cache_key] = now_ts + neg_ttl
            logger.info(f"[Dynamic Viewport] Registered negative cache key for {neg_ttl}s: {cache_key}")

            # Step 5: Stale fallback (Dynamic or Manifest)
            fallback_product = self._find_any_cached_product(model, domain, layer, target_dt, bbox_str)
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
                
                # Crop to requested bounds
                fallback_product = filter_grid_to_bbox(fallback_product, bbox_str)
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

            # No fallback cached product exists -> raise exception
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
        """
        Fallback/Wrapper to check dynamic cache first (if force_refresh=False) and then fetch upstream.
        """
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
        """Asynchronously refetches a viewport grid and updates cache without throwing errors to response."""
        try:
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

    def _find_any_cached_product(
        self,
        model: str,
        domain: str,
        layer: str,
        target_dt: datetime,
        bbox_str: Optional[str] = None
    ) -> Optional[NormalizedProduct]:
        """Searches dynamic index and manifest for any product matching model/layer and target time."""
        req_w, req_s, req_e, req_n = None, None, None, None
        if bbox_str:
            try:
                req_w, req_s, req_e, req_n = parse_bbox(bbox_str)
            except Exception:
                pass

        # 1. Search Dynamic Index
        items = self.dynamic_index._load_index()
        target_ts = target_dt.timestamp()
        
        best_item = None
        min_diff = float("inf")
        
        for item in items:
            if (
                item.get("model", "").upper() == model.upper()
                and item.get("domain", "").lower() == domain.lower()
                and item.get("layer", "").lower() == layer.lower()
            ):
                try:
                    item_dt = datetime.fromisoformat(item["valid_time"].replace("Z", "+00:00"))
                    diff = abs(item_dt.timestamp() - target_ts)
                    # Allow up to 24 hours stale product fallback for rate limit
                    if diff < min_diff and diff <= 24 * 3600:
                        # If bbox is specified, verify that item overlaps/covers it
                        if req_w is not None:
                            cand_bbox = item.get("served_bbox") or item.get("requested_bbox")
                            if cand_bbox:
                                cw, cs, ce, cn = parse_bbox(cand_bbox)
                                # Simple overlap check
                                lat_overlap = not (req_n < cs or req_s > cn)
                                if cw <= ce:
                                    if req_w <= req_e:
                                        lon_overlap = not (req_e < cw or req_w > ce)
                                    else:
                                        lon_overlap = not (ce < req_w and cw > req_e)
                                else:
                                    if req_w <= req_e:
                                        lon_overlap = not (req_e < cw and req_w > ce)
                                    else:
                                        lon_overlap = True
                                if not (lat_overlap and lon_overlap):
                                    continue
                        min_diff = diff
                        best_item = item
                except Exception:
                    continue
                    
        if best_item:
            loaded = self.store.load_product(best_item["product_id"])
            if loaded:
                return loaded

        # 2. Search Manifest (pruning for anomalous future-dated entries runs inside get_manifest())
        manifest = self.store.get_manifest()
        best_manifest_item = None
        min_diff = float("inf")
        
        for p in manifest.products:
            if (
                p.model.upper() == model.upper()
                and p.domain.lower() == domain.lower()
                and p.layer.lower() == layer.lower()
            ):
                diff = abs(p.valid_time_start.timestamp() - target_ts)
                # Allow up to 24 hours stale product fallback for rate limit
                if diff < min_diff and diff <= 24 * 3600:
                    # If bbox is specified, manifest fallback in Step 5 MUST fully cover the bbox.
                    # Partial coverage falls back to Step 6 instead!
                    if req_w is not None:
                        if not is_bbox_covered_by(req_w, req_s, req_e, req_n, p.coverage, margin=0.05):
                            continue
                    min_diff = diff
                    best_manifest_item = p
                    
        if best_manifest_item:
            loaded = self.store.load_product(best_manifest_item.filename)
            if loaded:
                loaded.product_id = best_manifest_item.filename
                return loaded
                
        return None

