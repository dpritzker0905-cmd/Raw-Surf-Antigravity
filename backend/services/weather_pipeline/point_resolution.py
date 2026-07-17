import math
import os
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

# safe_index_get + the WIND / WEATHER-scalar direct-point builders moved to
# point_direct_fallbacks (800-LOC split, 2026-07-03); re-exported for existing importers.
from services.weather_pipeline.point_direct_fallbacks import (  # noqa: E402
    safe_index_get, build_wind_direct_point_response, build_scalar_direct_point_response
)

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
        if not grid or not grid.vectors: return 0.0
        lats = sorted(list(set(v.lat for v in grid.vectors)))
        if len(lats) > 1: return round(lats[1] - lats[0], 4)
        lons = sorted(list(set(v.lng for v in grid.vectors)))
        return round(lons[1] - lons[0], 4) if len(lons) > 1 else 0.0

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
        response = await self._resolve_point_internal(
            model=model,
            domain=domain,
            layer=layer,
            lat=lat,
            lng=lng,
            valid_time_str=valid_time_str,
            grid_product_id=grid_product_id,
            grid_bbox=grid_bbox
        )

        # REMOVED (2026-07-04): the blanket EURO-marine production override (provider="copernicus",
        # is_estimated=False, is_forecast_authoritative=True on EVERY point response) compensated
        # for ingestion stamping native CMEMS products estimated — and in doing so served the
        # GENUINELY estimated products (GFS 10-14d tail, fallback-derived points) labeled as native
        # Copernicus. Ingestion now saves truthful flags; the point response carries the product's
        # own provenance unmodified in every environment.

        # ── Option-2 surf transform: augment a successful MARINE point with a bathymetry-derived surf
        # height (additive — the offshore height/period in `point` are untouched). SINGLE injection point,
        # so it covers every resolution path without touching their fetch/sample logic (the regression-safe
        # pattern; the infobox 2-month history is all about fetch deps / flooding / unmount — none of which
        # this touches). Pure in-process compute (bundled bathymetry), serve-only safe. Kill switch SURF_TRANSFORM=0.
        if (
            domain.lower() == "marine"
            and layer.lower() in ("waves", "swell_1", "swell_2", "wind_waves")
            and isinstance(response, NormalizedPointResponse)
            and response.point is not None
            and os.environ.get("SURF_TRANSFORM", "1") != "0"
        ):
            try:
                from services.weather_pipeline.bathymetry import shelf_depth_at, is_coastal, shelf_width_km, shore_normal_at
                from services.weather_pipeline.surf_transform import estimate_surf
                depth = shelf_depth_at(lat, lng)
                # Coastal-proximity gate is GEOGRAPHY-only (model-independent) so the surf row shows at the
                # same coastal points for GFS/EURO/ICON; open-ocean points get regime 'open_ocean' (hidden).
                # shelf_width drives cross-shelf bottom friction: a wide shallow shelf (Florida) yields surf
                # MUCH smaller than the offshore swell; a steep/deep coast passes most of it through.
                # Seaward bearing for the surf-quality rating's offshore/onshore wind factor. Pure bathymetry
                # (lru-cached, no fetch) so it adds no latency to the marine point. The frontend pairs it with
                # the already-fetched wind point + surf height/period to compute the rating badge ([[surf_rating]]).
                # Computed BEFORE estimate_surf (v3): the surf HEIGHT now also uses it for swell-angle exposure.
                try:
                    response.shore_normal_deg = shore_normal_at(lat, lng)
                except Exception:
                    response.shore_normal_deg = None
                # SURF v3 per-spot wave-magnet focusing (sub-grid inlet/jetty amplification — e.g. New
                # Smyrna Inlet reads ~1.4x its neighboring beach). /point lane only; the grid band stays
                # cell-honest. Factor is inert unless SURF_V3_MAGNETS is on inside estimate_surf.
                try:
                    from services.weather_pipeline.surf_magnets import magnet_factor_at
                    _magnet, _magnet_name = magnet_factor_at(lat, lng)
                except Exception:
                    _magnet, _magnet_name = 1.0, None
                surf, regime = estimate_surf(response.point.speed, response.point.period, depth,
                                             coastal=is_coastal(lat, lng), shelf_width_km=shelf_width_km(lat, lng),
                                             swell_from_deg=response.point.direction,
                                             shore_normal_deg=response.shore_normal_deg,
                                             magnet_factor=_magnet)
                if _magnet_name and surf is not None:
                    logger.debug(f"[Surf v3] magnet '{_magnet_name}' x{_magnet} at ({lat},{lng})")
                response.surf_height_m = round(surf, 4) if surf is not None else None
                response.surf_regime = regime
                response.shelf_depth_m = round(depth, 1) if depth is not None else None
            except Exception as _se:
                logger.debug(f"[Surf Transform] skipped for ({lat},{lng}): {_se}")

        return response

    async def _resolve_point_internal(
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
        # Parse valid_time ISO timestamp
        target_dt = parse_valid_time(valid_time_str)

        # Handle ICON swell_2 unsupported layer immediately
        if model.upper() == "ICON" and layer.lower() == "swell_2":
            return make_unsupported_icon_swell2_point_response(domain, lat, lng, target_dt)

        # ── PATH 1: Strict grid_product_id lookup ────────────────────────────
        if grid_product_id:
            # Swap timestamp in grid_product_id filename to match valid_time_str (e.g. timeline scrubbing temporal parity)
            import re
            ts_match = re.search(r'\d{8}T\d{6}Z', grid_product_id)
            if ts_match:
                filename_ts = ts_match.group(0)
                target_ts = target_dt.strftime("%Y%m%dT%H%M%SZ")
                if filename_ts != target_ts:
                    adjusted_grid_product_id = grid_product_id.replace(filename_ts, target_ts)
                    file_path = self.store.cache_dir / adjusted_grid_product_id
                    if file_path.exists():
                        logger.info(f"[Point Resolution] Swapped grid_product_id from {grid_product_id} to {adjusted_grid_product_id} due to temporal mismatch during scrubbing.")
                        grid_product_id = adjusted_grid_product_id
                    else:
                        logger.warning(f"[Point Resolution] Temporal mismatch: {adjusted_grid_product_id} not cached on disk. Suppressing strict grid lookup to allow dynamic/upstream fallback.")
                        grid_product_id = None

        if grid_product_id:
            product = await asyncio.to_thread(self.store.load_product, grid_product_id)
            if product and getattr(product, "layer", "").lower() != layer.lower():
                logger.warning(f"[Point Resolution] Layer mismatch: loaded product has layer={product.layer}, but requested layer={layer}. Bypassing strict grid lookup.")
                product = None
                grid_product_id = None

            if not product or not product.grid or not product.grid.vectors:
                return make_grid_miss_point_response(model, layer, lat, lng, valid_time_str, grid_product_id or "unknown", "grid_product_not_found")

            # Let's ensure coverage_mode is set correctly!
            if not getattr(product, "coverage_mode", None):
                if "global_coarse" in grid_product_id:
                    product.coverage_mode = "global_tile"
                elif "florida" in grid_product_id:
                    product.coverage_mode = "regional_tile"
                else:
                    product.coverage_mode = "viewport"

            # Crop if grid_bbox is provided and not wind
            if grid_bbox and domain.lower() != "wind" and getattr(product, "coverage_mode", None) not in ("global_tile", "viewport"):
                product = filter_grid_to_bbox(product, grid_bbox)

            # Enforce bounds containment strictly (0.0001 snapping-tolerant margin, antimeridian aware)
            res_val = self.deduce_grid_resolution(product.grid)
            actual_cov = get_actual_grid_bounds(product.grid.bounds, res_val)
            if not is_inside_bounds(lat, lng, actual_cov, margin=0.0001):
                return make_grid_miss_point_response(model, layer, lat, lng, valid_time_str, grid_product_id, "point_outside_grid_product")

            # Inside bounds - sample from product
            response = self.sampler.sample_point(product, lat, lng)
            response.valid_time = target_dt
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
            model=model, domain=domain, layer=layer, valid_time=target_dt, lat=lat, lng=lng, grid_bbox=grid_bbox
        )
        if dynamic_match:
            product = await asyncio.to_thread(self.store.load_product, dynamic_match["product_id"])
            if product:
                # Ensure coverage_mode is set!
                if not getattr(product, "coverage_mode", None):
                    product.coverage_mode = dynamic_match.get("coverage_mode") or "viewport"
                if grid_bbox and domain.lower() != "wind" and getattr(product, "coverage_mode", None) not in ("global_tile", "viewport"):
                    product = filter_grid_to_bbox(product, grid_bbox)
                response = self.sampler.sample_point(product, lat, lng)
                response.valid_time = target_dt
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
                if is_inside_bounds(lat, lng, actual_cov, margin=0.0001):
                    t1 = p.valid_time_start.replace(tzinfo=timezone.utc) if p.valid_time_start.tzinfo is None else p.valid_time_start
                    t2 = target_dt.replace(tzinfo=timezone.utc) if target_dt.tzinfo is None else target_dt
                    diff = abs(t1.timestamp() - t2.timestamp())
                    if diff <= 3 * 3600:
                        if getattr(p, "is_estimated", False):
                            estimated_candidates.append((p, diff))
                        else:
                            authoritative_candidates.append((p, diff))

        from services.weather_pipeline.product_selection import get_bbox_area

        best_auth = None
        best_est = None
        if authoritative_candidates:
            best_auth = min(
                authoritative_candidates,
                key=lambda pair: (
                    pair[1],
                    get_bbox_area(pair[0].coverage.west, pair[0].coverage.south, pair[0].coverage.east, pair[0].coverage.north)
                )
            )
        if estimated_candidates:
            best_est = min(
                estimated_candidates,
                key=lambda pair: (
                    pair[1],
                    get_bbox_area(pair[0].coverage.west, pair[0].coverage.south, pair[0].coverage.east, pair[0].coverage.north)
                )
            )

        matching_item = None
        if best_auth and best_est:
            auth_p, auth_diff = best_auth
            est_p, est_diff = best_est
            if est_diff <= 1800 and auth_diff > 1800:
                matching_item = est_p
            else:
                matching_item = auth_p
        elif best_auth:
            matching_item = best_auth[0]
        elif best_est:
            matching_item = best_est[0]

        coarse_last_resort = None
        if matching_item:
            product = await asyncio.to_thread(self.store.load_product, matching_item.filename)
            if product:
                # Ensure coverage_mode is set!
                if not getattr(product, "coverage_mode", None):
                    product.coverage_mode = getattr(matching_item, "coverage_mode", None)
                    if not product.coverage_mode:
                        if "global_coarse" in matching_item.filename:
                            product.coverage_mode = "global_tile"
                        else:
                            product.coverage_mode = "regional_tile"
                if grid_bbox and domain.lower() != "wind" and getattr(product, "coverage_mode", None) not in ("global_tile", "viewport"):
                    product = filter_grid_to_bbox(product, grid_bbox)
                response = self.sampler.sample_point(product, lat, lng)
                response.valid_time = target_dt
                response.product_id = matching_item.filename
                response.source = "grid_file"
                is_global_coarse = (
                    getattr(product, "coverage_mode", None) == "global_tile"
                    or "global_coarse" in matching_item.filename
                )
                # Honest labeling: the 10° global coarse is NOT a regional tile.
                response.coverage_status = "inside_global_coarse" if is_global_coarse else "inside_regional_tile"
                response.fallback_attempted = False
                response.fallback_reason = None
                response.grid_parity = True
                response.gridParity = True
                interp = getattr(response.point, "interpolation_method", None) if response.point else None
                degraded = interp in (
                    "unavailable", "nearest_ocean_coarse_masked",
                    "nearest_ocean_fallback", "out_of_bounds_fallback",
                    # 2026-07-03 global gulf/bay sweep: at 10° resolution a MASKED bilinear
                    # (1-3 land corners) renormalizes onto whatever open-ocean neighbors exist and
                    # smears their swell into enclosed water — Gulf of Oman read 3.07 m where GFS
                    # says 0.66 m (Arabian-Sea monsoon swell), Tonkin 0.47 vs 1.58, German Bight
                    # 0.75 vs 2.28. Full 4-corner bilinear (open ocean) stays grid-served.
                    "bilinear_ocean_masked",
                )
                if is_global_coarse and degraded and domain.lower() == "marine":
                    # Gulf-of-Mexico class: every bracketing 10° coarse center is land, so the
                    # sampler serves the nearest "ocean" cell — which can be an ATLANTIC cell
                    # 12–15° away (Galveston was getting (30,-80) Florida water). That sample is
                    # not the user's water. Prefer the true 0.25° upstream point (PATH 2c below);
                    # keep this sample only as a last resort if the upstream fetch fails.
                    coarse_last_resort = response
                    coarse_last_resort.grid_parity = False
                    coarse_last_resort.gridParity = False
                    coarse_last_resort.fallback_attempted = True
                    coarse_last_resort.fallback_reason = "coarse_sample_degraded_direct_point_failed"
                else:
                    return response

        # 2c. Fallback to direct point query
        if domain.lower() == "wind" and layer.lower() == "wind":
            wind_resp = await build_wind_direct_point_response(self.provider, model, lat, lng, target_dt)
            if wind_resp is not None:
                return wind_resp

        elif domain.lower() == "marine" and layer.lower() in ("waves", "swell_1", "swell_2", "wind_waves") and model.upper() in ("GFS", "ICON", "EURO"):
            try:
                # Use model-appropriate forecast_days for point fallback
                point_forecast_days = {"ICON": 7, "EURO": 10, "GFS": 16}.get(model.upper(), 2)
                is_fallback_active = False
                if model.upper() == "EURO":
                    try:
                        # CI batch lanes skip the native CMEMS point (POINT_SKIP_NATIVE_COPERNICUS=1,
                        # 2026-07-05): precompute/report-calibration fire hundreds of these serially
                        # and CMEMS throttles under that volume — run 28754458502 burned 138 × the
                        # full 25s subprocess timeout (57.5 of its 60 minutes) while the open-meteo
                        # proxy fallback answered every point sub-second. Raising into the existing
                        # except → the standard provider fallback path. Live /point keeps
                        # native-first authority (flag unset on the serve box); the real cure is
                        # spatial batching of the CMEMS fetches.
                        if os.environ.get("POINT_SKIP_NATIVE_COPERNICUS") == "1":
                            raise RuntimeError("native CMEMS point skipped (POINT_SKIP_NATIVE_COPERNICUS=1)")
                        # DEGRADED MODE (2026-07-14): the batch pre-warm tripped its budget/breaker
                        # (CMEMS slow/timing out — run 29297471819 burned 75 min inside the pre-warm
                        # alone). Points it already warmed keep native authority (their batched cache
                        # entry is consulted inside fetch_euro_marine); points WITHOUT an entry go
                        # straight to the provider fallback rather than spawning a fresh per-point
                        # CMEMS subprocess into a known-degraded upstream (the 138×25s murder-loop).
                        if os.environ.get("POINT_BATCH_DEGRADED") == "1":
                            try:
                                from services.copernicus_point_batching import batched_point_cache_key
                                from services.copernicus_marine_service import _point_cache
                                if batched_point_cache_key(lat, lng, point_forecast_days) not in _point_cache:
                                    raise RuntimeError("CMEMS degraded and point not pre-warmed (POINT_BATCH_DEGRADED=1)")
                            except ImportError:
                                pass  # never let the guard itself break native resolution
                        from services.copernicus_marine_service import fetch_euro_marine
                        if layer.lower() == "waves":
                            variables = ["wave_height", "wave_direction", "wave_period"]
                        elif layer.lower() == "swell_1":
                            variables = ["swell_wave_height", "swell_wave_direction", "swell_wave_period"]
                        elif layer.lower() == "swell_2":
                            variables = ["secondary_swell_wave_height", "secondary_swell_wave_direction", "secondary_swell_wave_period"]
                        elif layer.lower() == "wind_waves":
                            variables = ["wind_wave_height", "wind_wave_direction", "wind_wave_period"]
                        else:
                            variables = ["wave_height", "wave_direction", "wave_period"]
                        
                        raw_points = await fetch_euro_marine(
                            latitudes=[lat],
                            longitudes=[lng],
                            forecast_days=point_forecast_days,
                            variables=variables,
                            valid_time=valid_time_str
                        )
                        raw_point = raw_points[0] if raw_points else None
                        
                        # Verify if the requested layer variables are completely masked/null
                        if raw_point and "hourly" in raw_point:
                            if layer.lower() == "waves":
                                speed_key = "wave_height"
                            elif layer.lower() == "swell_1":
                                speed_key = "swell_wave_height"
                            elif layer.lower() == "swell_2":
                                speed_key = "secondary_swell_wave_height"
                            elif layer.lower() == "wind_waves":
                                speed_key = "wind_wave_height"
                            else:
                                speed_key = "wave_height"
                            
                            vals = raw_point["hourly"].get(speed_key, [])
                            if not vals or all(v is None for v in vals):
                                logger.info(f"[Copernicus Point] Native data for {layer} at ({lat}, {lng}) is completely masked. Triggering GFS fallback.")
                                raw_point = None
                    except Exception as ex:
                        logger.warning(f"[Copernicus Point] Native fetch failed or unavailable: {ex}. Falling back to GFS point.")
                        raw_point = None
                    
                    if not raw_point:
                        is_fallback_active = True
                        fallback_model = "EURO" if layer.lower() == "waves" else "GFS"
                        raw_point = await self.provider.fetch_point(model=fallback_model, domain=domain, layer=layer, lat=lat, lng=lng, forecast_days=16)
                else:
                    raw_point = await self.provider.fetch_point(model=model, domain=domain, layer=layer, lat=lat, lng=lng, forecast_days=point_forecast_days)
                
                if raw_point and "hourly" in raw_point and "time" in raw_point["hourly"]:
                    from services.weather_pipeline.normalizer import WeatherNormalizer
                    times = raw_point["hourly"]["time"]
                    idx = WeatherNormalizer.find_closest_time_index(times, target_dt)
                    if idx is None and model.upper() == "EURO" and not is_fallback_active:
                        from services.weather_pipeline.estimator import resolve_euro_estimate_point
                        est_res = await resolve_euro_estimate_point(self.provider, domain, layer, lat, lng, target_dt, raw_point)
                        if est_res:
                            return est_res
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

                        # Upstream NULL at the target hour = GFS does not model this water/land point
                        # (deep-inland pins reach here via the coarse-gap fall-through). Do NOT coerce
                        # to 0.0 and serve it as data — fall through to the stashed coarse sample
                        # (whose 'unavailable' interpolation the frontend conforms to "--") or the 404.
                        _raw_h_series = raw_point["hourly"].get(speed_key, [])
                        _raw_h_at_idx = _raw_h_series[idx] if idx < len(_raw_h_series) else None
                        if _raw_h_at_idx is None:
                            if coarse_last_resort is not None:
                                return coarse_last_resort
                            return make_no_coverage_point_response(model, layer, lat, lng, valid_time_str, grid_product_id)

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
                        
                        if model.upper() == "GFS" or is_fallback_active:
                            upstream_model = "ncep_gfswave025"
                        elif model.upper() == "ICON":
                            upstream_model = "gwam"
                        elif model.upper() == "EURO":
                            upstream_model = "cmems_mod_glo_wav_anfc_0.083deg_PT3H-i"
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
                        
                        # Set is_estimated and estimate_basis matching normalizer conformed rules
                        is_estimated = is_fallback_active
                        est_basis = None
                        if model.upper() == "EURO" and layer.lower() in ("swell_1", "swell_2", "wind_waves") and is_fallback_active:
                            is_estimated = True
                            est_basis = {
                                "type": "ecmwf_ifs_derived_fallback",
                                "method": "wave_component_ratio_estimation",
                                "source_model": "ecmwf_wam025"
                            }
                        elif is_fallback_active:
                            is_estimated = True
                            est_basis = {
                                "type": "gfs_derived_fallback",
                                "method": "wave_component_ratio_estimation",
                                "source_model": "ncep_gfswave025"
                            }

                        # Labels flow from data truth in EVERY environment (2026-07-04): the old
                        # branches were honest only under is_test — production stamped
                        # fallback-derived EURO points provider="copernicus"/is_estimated=False.
                        return NormalizedPointResponse(
                            model=model.upper(),
                            provider="gfs_estimated_fallback" if is_fallback_active else ("copernicus" if model.upper() == "EURO" else "open-meteo"),
                            domain="marine",
                            layer=layer.lower(),
                            run_time=datetime.now(timezone.utc),
                            valid_time=target_dt,
                            is_forecast_authoritative=(not is_estimated),
                            is_estimated=is_estimated,
                            estimate_basis=est_basis,
                            point=detail,
                            value_kind=value_kind,
                            value_unit=value_unit,
                            display_unit_hint=display_unit_hint,
                            source_variables=list(layer_vars),
                            freshness_sec=1800,
                            source="backend_direct_point",
                            coverage_status="coarse_gap_direct_point" if coarse_last_resort is not None else "outside_grid_tile",
                            fallback_attempted=True,
                            fallback_reason="copernicus_missing_fallback" if is_fallback_active else ("coarse_sample_degraded" if coarse_last_resort is not None else "no_matching_grid_product"),
                            upstream_provider="gfs_estimated_fallback" if is_fallback_active else ("copernicus" if model.upper() == "EURO" else "open-meteo"),
                            upstream_model=upstream_model,
                            units=units,
                            grid_parity=False,
                            gridParity=False
                        )
            except Exception as ex:
                # {ex!r} not {ex}: transport transients at a burst boundary stringify to "" (the
                # undiagnosable empty-message log, runbook §12). WARNING not ERROR: this fails OPEN
                # below (coarse_last_resort → no-coverage 404), so it is a handled fallback-miss, not
                # an error. A systematic outage still surfaces via volume + the ratings coverage guard.
                logger.warning(f"[Point Fallback] Failed fetching point for {model} marine at ({lat}, {lng}): {ex!r} (serving coarse/no-coverage fallback)")

        elif domain.lower() == "weather" and layer.lower() in ("pressure", "precipitation") and model.upper() in ("GFS", "ICON", "EURO"):
            scalar_resp = await build_scalar_direct_point_response(self.provider, model, layer, lat, lng, target_dt)
            if scalar_resp is not None:
                return scalar_resp

        # Direct point failed/unavailable: serve the stashed degraded coarse sample rather than a
        # 404 (fail-open — it is labeled fallback_attempted + coarse_sample_degraded so the
        # frontend/diagnostics can see it is NOT the user's water).
        if coarse_last_resort is not None:
            return coarse_last_resort

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
                if is_inside_bounds(lat, lng, actual_cov, margin=0.0001):
                    t1 = p.valid_time_start.replace(tzinfo=timezone.utc) if p.valid_time_start.tzinfo is None else p.valid_time_start
                    t2 = target_dt.replace(tzinfo=timezone.utc) if target_dt.tzinfo is None else target_dt
                    diff = abs(t1.timestamp() - t2.timestamp())
                    if diff <= 3 * 3600:
                        if getattr(p, "is_estimated", False):
                            estimated_candidates.append((p, diff))
                        else:
                            authoritative_candidates.append((p, diff))

        from services.weather_pipeline.product_selection import get_bbox_area

        best_auth = None
        best_est = None
        if authoritative_candidates:
            best_auth = min(
                authoritative_candidates,
                key=lambda pair: (
                    pair[1],
                    get_bbox_area(pair[0].coverage.west, pair[0].coverage.south, pair[0].coverage.east, pair[0].coverage.north)
                )
            )
        if estimated_candidates:
            best_est = min(
                estimated_candidates,
                key=lambda pair: (
                    pair[1],
                    get_bbox_area(pair[0].coverage.west, pair[0].coverage.south, pair[0].coverage.east, pair[0].coverage.north)
                )
            )

        matching_item = None
        if best_auth and best_est:
            auth_p, auth_diff = best_auth
            est_p, est_diff = best_est
            if est_diff <= 1800 and auth_diff > 1800:
                matching_item = est_p
            else:
                matching_item = auth_p
        elif best_auth:
            matching_item = best_auth[0]
        elif best_est:
            matching_item = best_est[0]

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
        from services.weather_pipeline.spot_conditions import resolve_spot_conditions_impl
        return await resolve_spot_conditions_impl(self, model, lat, lng, forecast_days)

