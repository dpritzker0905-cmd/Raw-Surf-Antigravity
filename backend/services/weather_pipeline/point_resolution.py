import math
import logging
from datetime import datetime, timezone
from typing import Optional, Any

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
    make_no_coverage_point_response, make_grid_miss_point_response
)

logger = logging.getLogger(__name__)

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

    async def resolve_point(
        self,
        model: str,
        domain: str,
        layer: str,
        lat: float,
        lng: float,
        valid_time_str: str,
        grid_product_id: Optional[str] = None
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
            product = self.store.load_product(grid_product_id)
            if not product or not product.grid or not product.grid.vectors:
                return make_grid_miss_point_response(model, layer, lat, lng, valid_time_str, grid_product_id, "grid_product_not_found")

            # Enforce bounds containment strictly (0.01 margin, antimeridian aware)
            if not is_inside_bounds(lat, lng, product.grid.bounds, margin=0.01):
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
            product = self.store.load_product(dynamic_match["product_id"])
            if product:
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
        manifest = self.store.get_manifest()
        authoritative_candidates = []
        estimated_candidates = []

        for p in manifest.products:
            if (
                p.model.upper() == model.upper()
                and p.domain.lower() == domain.lower()
                and p.layer.lower() == layer.lower()
            ):
                # Check point containment (0.01 margin, antimeridian aware)
                if is_inside_bounds(lat, lng, p.coverage, margin=0.01) or model.upper() == "EURO":
                    diff = abs(p.valid_time_start.timestamp() - target_dt.timestamp())
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
            product = self.store.load_product(matching_item.filename)
            if product:
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
                        speed = raw_point["hourly"]["wind_speed_10m"][idx]
                        direction = raw_point["hourly"]["wind_direction_10m"][idx]
                        gust = raw_point["hourly"].get("wind_gusts_10m", [None])[idx]
                        
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
                        
                        speed = raw_point["hourly"][speed_key][idx]
                        direction = raw_point["hourly"][dir_key][idx]
                        period = raw_point["hourly"][period_key][idx]
                        
                        speed = speed if speed is not None else 0.0
                        direction = direction if direction is not None else 0.0
                        period = period if period is not None else 0.0
                        
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

        # If fallback not applicable or failed, return structured 404 response
        return make_no_coverage_point_response(model, layer, lat, lng, valid_time_str, grid_product_id)
