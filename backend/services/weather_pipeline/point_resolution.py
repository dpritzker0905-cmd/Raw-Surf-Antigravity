import math
import logging
import asyncio
from datetime import datetime, timezone
from typing import Optional, Any, Dict

from fastapi import HTTPException
from fastapi.responses import JSONResponse
from services.weather_pipeline.store import ProductStore
from services.weather_pipeline.dynamic_index import DynamicProductIndex
from services.weather_pipeline.sampler import PointSampler
from services.weather_pipeline.providers.open_meteo_provider import OpenMeteoProvider
from services.weather_pipeline.schemas import (
    NormalizedPointResponse, NormalizedPointDetail, CoverageBounds
)
from services.weather_pipeline.route_helpers import (
    parse_valid_time, is_inside_bounds, make_unsupported_icon_swell2_point_response,
    make_no_coverage_point_response, make_grid_miss_point_response, compute_truth_tag,
    filter_grid_to_bbox, get_actual_grid_bounds
)

logger = logging.getLogger(__name__)

def safe_index_get(dict_obj: dict, key: str, index: int, default_val: Any = 0.0) -> Any:
    """Safely retrieves the index element of list from dict_obj, returning default_val if missing or out of bounds."""
    if not dict_obj:
        return default_val
    lst = dict_obj.get(key)
    if isinstance(lst, list) and index < len(lst):
        val = lst[index]
        return val if val is not None else default_val
    return default_val

class PointResolutionService:
    """
    Service responsible for sampling weather points from grids or falling back
    to direct point API queries while maintaining strict parity.
    """

    def __init__(
        self,
        store: Optional[ProductStore] = None,
        dynamic_index: Optional[DynamicProductIndex] = None,
        sampler: Optional[PointSampler] = None,
        provider: Optional[OpenMeteoProvider] = None
    ):
        self._store = store
        self._dynamic_index = dynamic_index
        self.sampler = sampler or PointSampler()
        self.provider = provider or OpenMeteoProvider()

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

    @staticmethod
    def deduce_grid_resolution(grid) -> float:
        """
        Deduces the coordinate resolution step from the unique sorted latitudes/longitudes
        of a loaded NormalizedGrid.
        """
        if not grid or not grid.vectors:
            return 0.0
        lats = sorted(list(set(v.lat for v in grid.vectors)))
        if len(lats) > 1:
            return round(lats[1] - lats[0], 4)
        lons = sorted(list(set(v.lng for v in grid.vectors)))
        if len(lons) > 1:
            return round(lons[1] - lons[0], 4)
        return 0.0

    async def resolve_point(
        self,
        model: str,
        domain: str,
        layer: str,
        lat: float,
        lng: float,
        valid_time_str: str,
        grid_product_id: Optional[str] = None,
        grid_bbox: Optional[str] = None
    ) -> Any:
        """
        Resolves point forecast queries by sampling matching grids or calling the direct point API.
        """
        # Parse valid_time ISO timestamp
        target_dt = parse_valid_time(valid_time_str)

        # Handle ICON swell_2 unsupported layer immediately
        if model.upper() == "ICON" and layer.lower() == "swell_2":
            return make_unsupported_icon_swell2_point_response(domain, lat, lng, target_dt)

        # ── PATH 1: Strict grid_product_id lookup ────────────────────────────
        if grid_product_id:
            product = await asyncio.to_thread(self.store.load_product, grid_product_id)
            if not product or not product.grid or not product.grid.vectors:
                return make_grid_miss_point_response(model, layer, lat, lng, valid_time_str, grid_product_id, "grid_product_not_found")

            # Crop if grid_bbox is provided
            if grid_bbox:
                product = filter_grid_to_bbox(product, grid_bbox)

            # Enforce bounds containment strictly (0.0001 snapping-tolerant margin, antimeridian aware)
            res_val = self.deduce_grid_resolution(product.grid)
            actual_cov = get_actual_grid_bounds(product.grid.bounds, res_val)
            if not is_inside_bounds(lat, lng, actual_cov, margin=0.0001):
                return make_grid_miss_point_response(model, layer, lat, lng, valid_time_str, grid_product_id, "point_outside_grid_product")

            # Inside bounds - sample from product
            response = self.sampler.sample_point(product, lat, lng)
            response.product_id = grid_product_id
            response.source = "grid_file"
            response.coverage_status = "inside_served_bbox"
            response.fallback_attempted = False
            response.fallback_reason = None
            response.is_dynamic_viewport_product = getattr(product, "is_dynamic_viewport_product", False)
            response.cache_key = getattr(product, "cache_key", None)
            response.cache_hit = getattr(product, "cache_hit", None)
            response.requested_bbox = getattr(product, "requested_bbox", None)
            response.served_bbox = getattr(product, "served_bbox", None)
            response.coverage_scope = getattr(product, "coverage_scope", None)
            response.coordinate_count = getattr(product, "coordinate_count", None)
            response.grid_parity = True
            response.gridParity = True
            return response

        # ── PATH 2: Automatic matching sequence ─────────────────────────────
        # 2a. Check Dynamic Product Index first
        dynamic_match = self.dynamic_index.find_product_containing(
            model=model, domain=domain, layer=layer, valid_time=target_dt, lat=lat, lng=lng
        )
        if dynamic_match:
            product = await asyncio.to_thread(self.store.load_product, dynamic_match["product_id"])
            if product:
                if grid_bbox:
                    product = filter_grid_to_bbox(product, grid_bbox)
                response = self.sampler.sample_point(product, lat, lng)
                response.product_id = dynamic_match["product_id"]
                response.source = "grid_file"
                response.coverage_status = "inside_served_bbox"
                response.fallback_attempted = False
                response.fallback_reason = None
                response.is_dynamic_viewport_product = True
                response.cache_key = dynamic_match.get("cache_key")
                response.cache_hit = "cache_hit"
                response.requested_bbox = dynamic_match.get("requested_bbox")
                response.served_bbox = dynamic_match.get("served_bbox")
                response.coverage_scope = dynamic_match.get("coverage_scope")
                response.coordinate_count = dynamic_match.get("coordinate_count")
                response.grid_parity = True
                response.gridParity = True
                return response

        # 2b. Check scheduled products in the manifest
        manifest = await asyncio.to_thread(self.store.get_manifest)
        authoritative_candidates = []
        estimated_candidates = []

        for p in manifest.products:
            if (
                p.model.upper() == model.upper()
                and p.domain.lower() == domain.lower()
                and p.layer.lower() == layer.lower()
            ):
                # Check point containment (0.0001 snapping-tolerant margin, antimeridian aware)
                actual_cov = get_actual_grid_bounds(p.coverage, p.resolution)
                if is_inside_bounds(lat, lng, actual_cov, margin=0.0001) or model.upper() == "EURO":
                    t1 = p.valid_time_start.replace(tzinfo=timezone.utc) if p.valid_time_start.tzinfo is None else p.valid_time_start
                    t2 = target_dt.replace(tzinfo=timezone.utc) if target_dt.tzinfo is None else target_dt
                    diff = abs(t1.timestamp() - t2.timestamp())
                    if diff <= 3 * 3600:
                        if getattr(p, "is_estimated", False):
                            estimated_candidates.append((p, diff))
                        else:
                            authoritative_candidates.append((p, diff))

        matching_item = None
        if authoritative_candidates:
            matching_item = min(authoritative_candidates, key=lambda pair: pair[1])[0]
        elif estimated_candidates:
            matching_item = min(estimated_candidates, key=lambda pair: pair[1])[0]

        if matching_item:
            product = await asyncio.to_thread(self.store.load_product, matching_item.filename)
            if product:
                if grid_bbox:
                    product = filter_grid_to_bbox(product, grid_bbox)
                response = self.sampler.sample_point(product, lat, lng)
                response.product_id = matching_item.filename
                response.source = "grid_file"
                response.coverage_status = "inside_regional_tile"
                response.fallback_attempted = False
                response.fallback_reason = None
                response.grid_parity = True
                response.gridParity = True
                return response

        # 2c. Fallback to direct point query
        if domain.lower() == "wind" and layer.lower() == "wind":
            try:
                raw_point = await self.provider.fetch_point(model=model, domain=domain, layer=layer, lat=lat, lng=lng)
                if raw_point and "hourly" in raw_point and "time" in raw_point["hourly"]:
                    from services.weather_pipeline.normalizer import WeatherNormalizer
                    times = raw_point["hourly"]["time"]
                    idx = WeatherNormalizer.find_closest_time_index(times, target_dt)
                    if idx is not None:
                        speed = safe_index_get(raw_point["hourly"], "wind_speed_10m", idx, 0.0)
                        direction = safe_index_get(raw_point["hourly"], "wind_direction_10m", idx, 0.0)
                        gust = safe_index_get(raw_point["hourly"], "wind_gusts_10m", idx, None)
                        
                        rad = direction * (math.pi / 180.0)
                        u = -speed * math.sin(rad)
                        v = -speed * math.cos(rad)
                        
                        detail = NormalizedPointDetail(
                            requested_lat=lat,
                            requested_lng=lng,
                            sampled_lat=lat,
                            sampled_lng=lng,
                            speed=round(speed, 4),
                            direction=round(direction, 2),
                            u=round(u, 4),
                            v=round(v, 4),
                            gust=round(gust, 4) if gust is not None else None,
                            interpolation_method="direct_point_api"
                        )
                        
                        upstream_model = self.provider.FORECAST_MODELS.get(model.upper(), "gfs_seamless")
                        
                        return NormalizedPointResponse(
                            model=model.upper(),
                            provider="open-meteo",
                            domain="wind",
                            layer="wind",
                            run_time=datetime.now(timezone.utc),
                            valid_time=target_dt,
                            is_forecast_authoritative=True,
                            is_estimated=False,
                            point=detail,
                            value_kind="wind_speed",
                            value_unit="kn",
                            display_unit_hint="kn",
                            source_variables=["wind_speed_10m", "wind_direction_10m"],
                            freshness_sec=1800,
                            source="backend_direct_point",
                            coverage_status="outside_grid_tile",
                            fallback_attempted=True,
                            fallback_reason="no_matching_grid_product",
                            upstream_provider="open-meteo",
                            upstream_model=upstream_model,
                            grid_parity=False,
                            gridParity=False
                        )
            except Exception as ex:
                logger.error(f"[Point Fallback] Failed fetching point for {model} wind at ({lat}, {lng}): {ex}")

        elif domain.lower() == "marine" and layer.lower() in ("waves", "swell_1", "swell_2", "wind_waves") and model.upper() in ("GFS", "ICON", "EURO"):
            try:
                raw_point = await self.provider.fetch_point(model=model, domain=domain, layer=layer, lat=lat, lng=lng)
                if raw_point and "hourly" in raw_point and "time" in raw_point["hourly"]:
                    from services.weather_pipeline.normalizer import WeatherNormalizer
                    times = raw_point["hourly"]["time"]
                    idx = WeatherNormalizer.find_closest_time_index(times, target_dt)
                    if idx is not None:
                        if layer.lower() == "waves":
                            layer_vars = ("wave_height", "wave_direction", "wave_period")
                        elif layer.lower() == "swell_1":
                            layer_vars = ("swell_wave_height", "swell_wave_direction", "swell_wave_period")
                        elif layer.lower() == "swell_2":
                            if model.upper() == "ICON":
                                layer_vars = ("swell_wave_height", "swell_wave_direction", "swell_wave_period")
                            else:
                                layer_vars = ("secondary_swell_wave_height", "secondary_swell_wave_direction", "secondary_swell_wave_period")
                        elif layer.lower() == "wind_waves":
                            layer_vars = ("wind_wave_height", "wind_wave_direction", "wind_wave_period")
                        else:
                            layer_vars = ("wave_height", "wave_direction", "wave_period")
                        
                        speed_key, dir_key, period_key = layer_vars
                        
                        speed = safe_index_get(raw_point["hourly"], speed_key, idx, 0.0)
                        direction = safe_index_get(raw_point["hourly"], dir_key, idx, 0.0)
                        period = safe_index_get(raw_point["hourly"], period_key, idx, 0.0)
                        
                        rad = direction * (math.pi / 180.0)
                        u = -speed * math.sin(rad)
                        v = -speed * math.cos(rad)
                        
                        detail = NormalizedPointDetail(
                            requested_lat=lat,
                            requested_lng=lng,
                            sampled_lat=lat,
                            sampled_lng=lng,
                            speed=round(speed, 4),
                            direction=round(direction, 2),
                            u=round(u, 4),
                            v=round(v, 4),
                            period=round(period, 2),
                            gust=None,
                            interpolation_method="direct_point_api"
                        )
                        
                        if model.upper() == "GFS":
                            upstream_model = "ncep_gfswave025"
                        elif model.upper() == "ICON":
                            upstream_model = "gwam"
                        elif model.upper() == "EURO":
                            upstream_model = "ecmwf_wam025"
                        else:
                            upstream_model = "gfs_seamless"
                            
                        value_kind = "wave_height"
                        value_unit = "m"
                        display_unit_hint = "ft"
                        units = {
                            "speed": "m",
                            "direction": "degrees",
                            "period": "seconds"
                        }
                        
                        return NormalizedPointResponse(
                            model=model.upper(),
                            provider="open-meteo",
                            domain="marine",
                            layer=layer.lower(),
                            run_time=datetime.now(timezone.utc),
                            valid_time=target_dt,
                            is_forecast_authoritative=True,
                            is_estimated=False,
                            point=detail,
                            value_kind=value_kind,
                            value_unit=value_unit,
                            display_unit_hint=display_unit_hint,
                            source_variables=list(layer_vars),
                            freshness_sec=1800,
                            source="backend_direct_point",
                            coverage_status="outside_grid_tile",
                            fallback_attempted=True,
                            fallback_reason="no_matching_grid_product",
                            upstream_provider="open-meteo",
                            upstream_model=upstream_model,
                            units=units,
                            grid_parity=False,
                            gridParity=False
                        )
            except Exception as ex:
                logger.error(f"[Point Fallback] Failed fetching point for {model} marine at ({lat}, {lng}): {ex}")

        elif domain.lower() == "weather" and layer.lower() in ("pressure", "precipitation") and model.upper() in ("GFS", "ICON", "EURO"):
            try:
                raw_point = await self.provider.fetch_point(model=model, domain=domain, layer=layer, lat=lat, lng=lng)
                if raw_point and "hourly" in raw_point and "time" in raw_point["hourly"]:
                    from services.weather_pipeline.normalizer import WeatherNormalizer
                    times = raw_point["hourly"]["time"]
                    idx = WeatherNormalizer.find_closest_time_index(times, target_dt)
                    if idx is not None:
                        val_key = "pressure_msl" if layer.lower() == "pressure" else "precipitation"
                        val = safe_index_get(raw_point["hourly"], val_key, idx, 0.0)
                        
                        detail = NormalizedPointDetail(
                            requested_lat=lat,
                            requested_lng=lng,
                            sampled_lat=lat,
                            sampled_lng=lng,
                            speed=0.0,
                            direction=0.0,
                            u=0.0,
                            v=0.0,
                            period=0.0,
                            gust=None,
                            value=round(val, 4),
                            interpolation_method="direct_point_api"
                        )
                        
                        upstream_model = self.provider.FORECAST_MODELS.get(model.upper(), "gfs_seamless")
                        value_kind = "pressure" if layer.lower() == "pressure" else "precipitation"
                        value_unit = "hPa" if layer.lower() == "pressure" else "mm"
                        display_unit_hint = value_unit
                        
                        units = {
                            "value": value_unit
                        }
                        
                        fb_reason = "point_only_precipitation_backend" if layer.lower() == "precipitation" else "no_matching_grid_product"
                        g_parity = "point_only" if layer.lower() == "precipitation" else False
                        
                        return NormalizedPointResponse(
                            model=model.upper(),
                            provider="open-meteo",
                            domain="weather",
                            layer=layer.lower(),
                            run_time=datetime.now(timezone.utc),
                            valid_time=target_dt,
                            is_forecast_authoritative=True,
                            is_estimated=False,
                            point=detail,
                            value_kind=value_kind,
                            value_unit=value_unit,
                            display_unit_hint=display_unit_hint,
                            source_variables=[val_key],
                            freshness_sec=1800,
                            source="backend_direct_point",
                            coverage_status="outside_grid_tile",
                            fallback_attempted=True,
                            fallback_reason=fb_reason,
                            upstream_provider="open-meteo",
                            upstream_model=upstream_model,
                            units=units,
                            grid_parity=g_parity,
                            gridParity=g_parity
                        )
            except Exception as ex:
                logger.error(f"[Point Fallback] Failed fetching point for {model} weather/{layer} at ({lat}, {lng}): {ex}")

        # If fallback not applicable or failed, return structured 404 response
        return make_no_coverage_point_response(model, layer, lat, lng, valid_time_str, grid_product_id)

    async def find_cached_grid_product(
        self,
        model: str,
        domain: str,
        layer: str,
        lat: float,
        lng: float,
        target_dt: datetime
    ) -> Optional[Any]:
        """Helper to look up a cached dynamic grid or manifest grid product containing the point."""
        # 1. Check Dynamic Product Index first
        dynamic_match = self.dynamic_index.find_product_containing(
            model=model, domain=domain, layer=layer, valid_time=target_dt, lat=lat, lng=lng
        )
        if dynamic_match:
            product = await asyncio.to_thread(self.store.load_product, dynamic_match["product_id"])
            if product:
                return product

        # 2. Check scheduled products in the manifest
        manifest = await asyncio.to_thread(self.store.get_manifest)
        authoritative_candidates = []
        estimated_candidates = []

        for p in manifest.products:
            if (
                p.model.upper() == model.upper()
                and p.domain.lower() == domain.lower()
                and p.layer.lower() == layer.lower()
            ):
                from services.weather_pipeline.route_helpers import is_inside_bounds, get_actual_grid_bounds
                actual_cov = get_actual_grid_bounds(p.coverage, p.resolution)
                if is_inside_bounds(lat, lng, actual_cov, margin=0.0001) or model.upper() == "EURO":
                    t1 = p.valid_time_start.replace(tzinfo=timezone.utc) if p.valid_time_start.tzinfo is None else p.valid_time_start
                    t2 = target_dt.replace(tzinfo=timezone.utc) if target_dt.tzinfo is None else target_dt
                    diff = abs(t1.timestamp() - t2.timestamp())
                    if diff <= 3 * 3600:
                        if getattr(p, "is_estimated", False):
                            estimated_candidates.append((p, diff))
                        else:
                            authoritative_candidates.append((p, diff))

        matching_item = None
        if authoritative_candidates:
            matching_item = min(authoritative_candidates, key=lambda pair: pair[1])[0]
        elif estimated_candidates:
            matching_item = min(estimated_candidates, key=lambda pair: pair[1])[0]

        if matching_item:
            product = await asyncio.to_thread(self.store.load_product, matching_item.filename)
            return product

        return None

    async def resolve_spot_conditions(
        self,
        model: str,
        lat: float,
        lng: float,
        forecast_days: int = 11
    ) -> Dict[str, Any]:
        """
        Unifies conditions retrieval for a spot, checking local dynamic/manifest
        caches first, and falling back to a single upstream point query on miss.
        """
        from datetime import timedelta
        now_dt = datetime.now(timezone.utc)
        
        # Round current conditions target time to nearest 3 hours
        current_hour = round(now_dt.hour / 3.0) * 3
        if current_hour == 24:
            current_dt = (now_dt + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
        else:
            current_dt = now_dt.replace(hour=current_hour, minute=0, second=0, microsecond=0)
            
        # 10 daily forecast days
        forecast_dates = []
        tomorrow_date = now_dt.date() + timedelta(days=1)
        for i in range(10):
            d = tomorrow_date + timedelta(days=i)
            forecast_dates.append(datetime(d.year, d.month, d.day, 12, 0, 0, tzinfo=timezone.utc))
            
        all_dates = [current_dt] + forecast_dates
        
        waves_data = {}
        swell_data = {}
        cache_misses = False
        
        # Try local cache resolution for waves and swell
        for dt in all_dates:
            # Waves
            waves_prod = await self.find_cached_grid_product(model, "marine", "waves", lat, lng, dt)
            if waves_prod:
                res = self.sampler.sample_point(waves_prod, lat, lng)
                waves_data[dt] = {
                    "wave_height": res.point.speed,
                    "wave_direction": res.point.direction,
                    "wave_period": res.point.period
                }
            else:
                cache_misses = True
                
            # Swell
            swell_prod = await self.find_cached_grid_product(model, "marine", "swell_1", lat, lng, dt)
            if swell_prod:
                res = self.sampler.sample_point(swell_prod, lat, lng)
                swell_data[dt] = {
                    "swell_height": res.point.speed,
                    "swell_direction": res.point.direction
                }
            else:
                cache_misses = True

        # Fallback to direct point query if any target date was a cache miss
        if cache_misses:
            logger.info(f"[Spot conditions] Cache miss for {model} at ({lat}, {lng}). Fetching direct point forecast...")
            try:
                raw_point = await self.provider.fetch_point(
                    model=model, domain="marine", layer="all_marine", lat=lat, lng=lng, forecast_days=forecast_days
                )
                if raw_point and "hourly" in raw_point and "time" in raw_point["hourly"]:
                    times = raw_point["hourly"]["time"]
                    from services.weather_pipeline.normalizer import WeatherNormalizer
                    
                    for dt in all_dates:
                        idx = WeatherNormalizer.find_closest_time_index(times, dt)
                        if idx is not None:
                            # Parse waves fallback
                            if dt not in waves_data:
                                wave_height = safe_index_get(raw_point["hourly"], "wave_height", idx, 0.0)
                                wave_dir = safe_index_get(raw_point["hourly"], "wave_direction", idx, 0.0)
                                wave_per = safe_index_get(raw_point["hourly"], "wave_period", idx, 0.0)
                                waves_data[dt] = {
                                    "wave_height": wave_height,
                                    "wave_direction": wave_dir,
                                    "wave_period": wave_per
                                }
                            # Parse swell fallback
                            if dt not in swell_data:
                                swell_height = safe_index_get(raw_point["hourly"], "swell_wave_height", idx, 0.0)
                                swell_dir = safe_index_get(raw_point["hourly"], "swell_wave_direction", idx, 0.0)
                                swell_data[dt] = {
                                    "swell_height": swell_height,
                                    "swell_direction": swell_dir
                                }
            except Exception as e:
                logger.error(f"[Spot conditions] Upstream point fallback failed for {model} at ({lat}, {lng}): {e}")

        # Local helper for labels
        def get_local_label(wave_height_ft: float) -> str:
            if wave_height_ft < 1:
                return "Flat"
            elif wave_height_ft < 2:
                return "Ankle High"
            elif wave_height_ft < 3:
                return "Knee High"
            elif wave_height_ft < 4:
                return "Waist High"
            elif wave_height_ft < 5:
                return "Chest High"
            elif wave_height_ft < 6:
                return "Head High"
            elif wave_height_ft < 8:
                return "Overhead"
            elif wave_height_ft < 10:
                return "Double Overhead"
            else:
                return "Triple Overhead+"

        # Construct current conditions response dict
        current_waves = waves_data.get(current_dt, {"wave_height": 0.0, "wave_direction": 0.0, "wave_period": 0.0})
        current_swell = swell_data.get(current_dt, {"swell_height": 0.0, "swell_direction": 0.0})
        
        current_wave_height_ft = round(current_waves["wave_height"] * 3.28084, 1) if current_waves["wave_height"] else 0
        current_swell_height_ft = round(current_swell["swell_height"] * 3.28084, 1) if current_swell["swell_height"] else 0
        
        current_conditions = {
            "wave_height_ft": current_wave_height_ft,
            "wave_direction": current_waves["wave_direction"],
            "wave_period": current_waves["wave_period"],
            "swell_height_ft": current_swell_height_ft,
            "swell_direction": current_swell["swell_direction"],
            "label": get_local_label(current_wave_height_ft),
            "updated_at": datetime.now(timezone.utc).isoformat()
        }
        
        # Construct forecast response list
        forecast_list = []
        for dt in forecast_dates:
            date_str = dt.strftime("%Y-%m-%d")
            day_waves = waves_data.get(dt, {"wave_height": 0.0, "wave_direction": 0.0, "wave_period": 0.0})
            day_swell = swell_data.get(dt, {"swell_height": 0.0})
            
            max_ft = round(day_waves["wave_height"] * 3.28084, 1) if day_waves["wave_height"] else 0
            min_ft = round(max_ft * 0.6, 1)
            swell_max_ft = round(day_swell["swell_height"] * 3.28084, 1) if day_swell["swell_height"] else 0
            
            forecast_list.append({
                "date": date_str,
                "wave_height_min": min_ft,
                "wave_height_max": max_ft,
                "wave_direction": day_waves["wave_direction"],
                "wave_period": day_waves["wave_period"],
                "swell_height_ft": swell_max_ft,
                "label": get_local_label(max_ft)
            })
            
        return {
            "current_conditions": current_conditions,
            "forecast": forecast_list
        }
