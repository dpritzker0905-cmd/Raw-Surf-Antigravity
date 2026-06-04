import math
import logging
from typing import Optional, Dict, Any, Tuple, List
from services.weather_pipeline.schemas import (
    NormalizedProduct, NormalizedPointDetail, NormalizedPointResponse
)

logger = logging.getLogger(__name__)

class PointSampler:
    """
    Samples point forecasts from NormalizedProduct grid files
    using high-fidelity Bilinear Interpolation.
    """

    def sample_point(
        self,
        product: NormalizedProduct,
        lat: float,
        lng: float
    ) -> NormalizedPointResponse:
        """
        Samples a coordinate from a NormalizedProduct grid.
        Returns a NormalizedPointResponse.
        """
        warnings = []
        is_estimated = product.is_estimated
        estimate_basis = product.estimate_basis or {}

        # 1. Bounds verification
        grid = product.grid
        if not grid or not grid.vectors:
            return self._build_unavailable_response(product, lat, lng, "Empty or missing grid data")

        lats = sorted(list(set(v.lat for v in grid.vectors)))
        lons = sorted(list(set(v.lng for v in grid.vectors)))

        if not lats or not lons:
            return self._build_unavailable_response(product, lat, lng, "Invalid grid coordinates list")

        min_lat, max_lat = lats[0], lats[-1]
        min_lon, max_lon = lons[0], lons[-1]

        # Enforce strict coverage check as requested by User Condition 5
        if lat < min_lat or lat > max_lat or lng < min_lon or lng > max_lon:
            warnings.append("Requested point falls outside the authoritative grid boundaries")
            is_estimated = True
            estimate_basis["out_of_bounds"] = {
                "grid_min_lat": min_lat,
                "grid_max_lat": max_lat,
                "grid_min_lon": min_lon,
                "grid_max_lon": max_lon
            }
            # Return estimates as 0 when out of bounds
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
                interpolation_method="out_of_bounds_fallback"
            )
            return NormalizedPointResponse(
                model=product.model,
                provider=product.provider,
                domain=product.domain,
                layer=product.layer,
                run_time=product.run_time,
                valid_time=product.valid_time,
                is_forecast_authoritative=False,
                is_estimated=is_estimated,
                estimate_basis=estimate_basis,
                point=detail,
                value_kind=product.value_kind,
                value_unit=product.value_unit,
                display_unit_hint=product.display_unit_hint,
                units=product.units,
                source_variables=product.source_variables,
                freshness_sec=product.freshness_sec,
                warnings=warnings,
                source_dataset=product.source_dataset,
                is_test_fixture=product.is_test_fixture,
                upstream_provider=product.upstream_provider,
                upstream_model=product.upstream_model
            )

        # 2. Build coordinate map for constant-time lookup
        coordinate_map = {(v.lat, v.lng): v for v in grid.vectors}

        # 3. Locate bounding box coordinates
        lat0, lat1 = self._find_surrounding_brackets(lats, lat)
        lon0, lon1 = self._find_surrounding_brackets(lons, lng)

        # Exact match path
        if lat0 == lat1 and lon0 == lon1:
            vec = coordinate_map.get((lat0, lon0))
            if vec:
                detail = NormalizedPointDetail(
                    requested_lat=lat,
                    requested_lng=lng,
                    sampled_lat=lat0,
                    sampled_lng=lon0,
                    speed=vec.speed,
                    direction=vec.direction,
                    u=vec.u,
                    v=vec.v,
                    period=vec.period,
                    gust=getattr(vec, "gust", None),
                    interpolation_method="exact_match"
                )
                return self._build_success_response(product, is_estimated, estimate_basis, detail, warnings)

        # 4. Fetch 4 grid intersections
        v11 = coordinate_map.get((lat0, lon0)) # bottom-left
        v12 = coordinate_map.get((lat0, lon1)) # bottom-right
        v21 = coordinate_map.get((lat1, lon0)) # top-left
        v22 = coordinate_map.get((lat1, lon1)) # top-right

        # Solve fractions:
        t = (lng - lon0) / (lon1 - lon0) if lon1 != lon0 else 0.0
        u = (lat - lat0) / (lat1 - lat0) if lat1 != lat0 else 0.0

        # Weights
        w11 = (1.0 - t) * (1.0 - u)
        w12 = t * (1.0 - u)
        w21 = (1.0 - t) * u
        w22 = t * u

        corner_weights = [
            (v11, w11),
            (v12, w12),
            (v21, w21),
            (v22, w22)
        ]

        valid_ocean_corners = [
            (v, w) for v, w in corner_weights
            if v is not None and v.speed > 0.0
        ]

        if len(valid_ocean_corners) == 4:
            # 1. Standard Bilinear Interpolation
            interp_u = w11 * v11.u + w12 * v12.u + w21 * v21.u + w22 * v22.u
            interp_v = w11 * v11.v + w12 * v12.v + w21 * v21.v + w22 * v22.v
            
            interp_period = 0.0
            p_sum_weights = 0.0
            for v, w in corner_weights:
                if v is not None and v.period is not None:
                    interp_period += w * v.period
                    p_sum_weights += w
            if p_sum_weights > 0.0:
                interp_period = interp_period / p_sum_weights

            interp_gust = 0.0
            g_sum_weights = 0.0
            for v, w in corner_weights:
                vg = getattr(v, "gust", None)
                if v is not None and vg is not None:
                    interp_gust += w * vg
                    g_sum_weights += w
            if g_sum_weights > 0.0:
                interp_gust = interp_gust / g_sum_weights
            else:
                interp_gust = None
            
            interp_speed = math.sqrt(interp_u**2 + interp_v**2)
            interp_dir = math.atan2(-interp_u, -interp_v) * (180.0 / math.pi)
            if interp_dir < 0.0:
                interp_dir += 360.0

            detail = NormalizedPointDetail(
                requested_lat=lat,
                requested_lng=lng,
                sampled_lat=round(lat, 4),
                sampled_lng=round(lng, 4),
                speed=round(interp_speed, 4),
                direction=round(interp_dir, 2),
                u=round(interp_u, 4),
                v=round(interp_v, 4),
                period=round(interp_period, 2),
                gust=round(interp_gust, 4) if interp_gust is not None else None,
                interpolation_method="bilinear"
            )
            return self._build_success_response(product, is_estimated, estimate_basis, detail, warnings)

        elif len(valid_ocean_corners) >= 2:
            # 2. Bilinear Ocean Masked (Normalized Bilinear over valid ocean corners)
            sum_w = sum(w for v, w in valid_ocean_corners)
            if sum_w > 0.0:
                interp_u = 0.0
                interp_v = 0.0
                interp_period = 0.0
                p_sum_w = 0.0
                
                interp_gust = 0.0
                g_sum_w = 0.0
                
                for v, w in valid_ocean_corners:
                    norm_w = w / sum_w
                    interp_u += norm_w * v.u
                    interp_v += norm_w * v.v
                    if v.period is not None:
                        interp_period += norm_w * v.period
                        p_sum_w += norm_w
                    vg = getattr(v, "gust", None)
                    if vg is not None:
                        interp_gust += norm_w * vg
                        g_sum_w += norm_w
                
                if p_sum_w > 0.0:
                    interp_period = interp_period / p_sum_w
                if g_sum_w > 0.0:
                    interp_gust = interp_gust / g_sum_w
                else:
                    interp_gust = None
                
                interp_speed = math.sqrt(interp_u**2 + interp_v**2)
                interp_dir = math.atan2(-interp_u, -interp_v) * (180.0 / math.pi)
                if interp_dir < 0.0:
                    interp_dir += 360.0

                detail = NormalizedPointDetail(
                    requested_lat=lat,
                    requested_lng=lng,
                    sampled_lat=round(lat, 4),
                    sampled_lng=round(lng, 4),
                    speed=round(interp_speed, 4),
                    direction=round(interp_dir, 2),
                    u=round(interp_u, 4),
                    v=round(interp_v, 4),
                    period=round(interp_period, 2),
                    gust=round(interp_gust, 4) if interp_gust is not None else None,
                    interpolation_method="bilinear_ocean_masked"
                )
                return self._build_success_response(product, is_estimated, estimate_basis, detail, warnings)

        elif len(valid_ocean_corners) == 1:
            # 3. Fallback to Nearest Ocean Vector (exactly 1 valid ocean corner exists)
            ocean_vectors = [v for v in grid.vectors if v.speed > 0.0]
            if ocean_vectors:
                nearest = self._find_nearest_vector(ocean_vectors, lat, lng)
                detail = NormalizedPointDetail(
                    requested_lat=lat,
                    requested_lng=lng,
                    sampled_lat=nearest.lat,
                    sampled_lng=nearest.lng,
                    speed=nearest.speed,
                    direction=nearest.direction,
                    u=nearest.u,
                    v=nearest.v,
                    period=nearest.period,
                    gust=getattr(nearest, "gust", None),
                    interpolation_method="nearest_ocean_fallback"
                )
                warnings.append("Bilinear corners are land/masked; fallback to nearest ocean neighbor.")
                return self._build_success_response(product, is_estimated, estimate_basis, detail, warnings)
            else:
                return self._build_unavailable_response(product, lat, lng, "No valid ocean data in grid")

        else:
            # 4. No valid ocean corners exist
            return self._build_unavailable_response(product, lat, lng, "No valid ocean corners exist")

    @staticmethod
    def _find_surrounding_brackets(coords: List[float], val: float) -> Tuple[float, float]:
        """Finds the bounding bracket values around val."""
        if val <= coords[0]:
            return coords[0], coords[0]
        if val >= coords[-1]:
            return coords[-1], coords[-1]
            
        for i in range(len(coords) - 1):
            if coords[i] <= val <= coords[i+1]:
                return coords[i], coords[i+1]
        return coords[0], coords[-1]

    @staticmethod
    def _find_nearest_vector(vectors: List[Any], lat: float, lng: float) -> Any:
        """Finds the single nearest vector by geometric distance."""
        best_vec = vectors[0]
        min_dist = float("inf")
        for v in vectors:
            dist = (v.lat - lat)**2 + (v.lng - lng)**2
            if dist < min_dist:
                min_dist = dist
                best_vec = v
        return best_vec

    def _build_unavailable_response(
        self,
        product: NormalizedProduct,
        lat: float,
        lng: float,
        reason: str
    ) -> NormalizedPointResponse:
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
            interpolation_method="unavailable"
        )
        return NormalizedPointResponse(
            model=product.model,
            provider=product.provider,
            domain=product.domain,
            layer=product.layer,
            run_time=product.run_time,
            valid_time=product.valid_time,
            is_forecast_authoritative=False,
            is_estimated=True,
            estimate_basis={"unavailable_reason": reason},
            point=detail,
            value_kind=product.value_kind,
            value_unit=product.value_unit,
            display_unit_hint=product.display_unit_hint,
            units=product.units,
            source_variables=product.source_variables,
            freshness_sec=product.freshness_sec,
            warnings=[f"Point unavailable: {reason}"],
            source_dataset=product.source_dataset,
            is_test_fixture=product.is_test_fixture,
            upstream_provider=product.upstream_provider,
            upstream_model=product.upstream_model
        )

    def _build_success_response(
        self,
        product: NormalizedProduct,
        is_estimated: bool,
        estimate_basis: Dict[str, Any],
        detail: NormalizedPointDetail,
        warnings: List[str]
    ) -> NormalizedPointResponse:
        return NormalizedPointResponse(
            model=product.model,
            provider=product.provider,
            domain=product.domain,
            layer=product.layer,
            run_time=product.run_time,
            valid_time=product.valid_time,
            is_forecast_authoritative=not is_estimated,
            is_estimated=is_estimated,
            estimate_basis=estimate_basis if is_estimated else None,
            point=detail,
            value_kind=product.value_kind,
            value_unit=product.value_unit,
            display_unit_hint=product.display_unit_hint,
            units=product.units,
            source_variables=product.source_variables,
            freshness_sec=product.freshness_sec,
            warnings=warnings,
            source_dataset=product.source_dataset,
            is_test_fixture=product.is_test_fixture,
            upstream_provider=product.upstream_provider,
            upstream_model=product.upstream_model
        )
