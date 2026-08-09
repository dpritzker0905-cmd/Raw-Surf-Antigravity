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
# The surf composition (geometry -> breaking height -> partitions -> readiness). Extracted
# 2026-07-30 when this file hit 801 of the 800-line ratchet; it remains the SINGLE place
# `surf_height_m` is produced.
from services.weather_pipeline.point_surf_augment import augment_with_surf  # noqa: E402
from services.weather_pipeline import wave_physics  # noqa: E402

def _selection_key(pair):
    """Candidate ranking for the point resolver's manifest selection, ONE definition for both
    sites (resolve_point + find_cached_grid_product — they had drifted into four identical
    lambdas). ⭐ RESOLUTION BREAKS TIME TIES (2026-08-09, MASTER-AUDIT-11.0 resolution F7): the
    old key was (time_diff, bbox_area), and two GLOBAL products at the same hour tie on BOTH
    terms — manifest order decided, so a 10° product could answer a point a 2° product covered.
    55.22% of served spots depend on a global tier, and this tie-break is the gate the audit put
    in front of any 0.25° coverage expansion. Finer resolution wins within a time tie; area stays
    the final term. Kill: POINT_RES_TIEBREAK=0 restores (diff, area) exactly."""
    from services.weather_pipeline.product_selection import get_bbox_area
    p, diff = pair
    area = get_bbox_area(p.coverage.west, p.coverage.south, p.coverage.east, p.coverage.north)
    if os.environ.get("POINT_RES_TIEBREAK", "1") != "0":
        return (diff, float(p.resolution), area)
    return (diff, area)


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

    # The partition layers this model publishes alongside the total `waves` field, with the `kind`
    # `surf_rating`'s partition-aware factors expect.
    _PARTITION_LAYERS = (("swell_1", "swell"), ("swell_2", "swell"), ("wind_waves", "windsea"))

    async def _resolve_partitions(self, model, layer, lat, lng, valid_time_str, total_h,
                                  total_tp=None):
        """The spectral partitions at this point, reconciled to the total — or None.

        ⚠️⚠️ RE-ENTRANCY. This calls `_resolve_point_internal`, NOT `resolve_point`. The surf
        transform lives in `resolve_point`, so going through the public method would make each
        partition resolve its own partitions, recursively. Using the internal method is a
        STRUCTURAL guard — recursion is not merely avoided, it is unreachable.

        ⚠️ COST — this is why it is OFF by default. Three extra point resolutions per `waves`
        point, i.e. 4x. Measured against production 2026-07-29 the extra layers answer in
        0.17-0.77 s each (median ~0.4 s), and they are real ingested products the map already
        renders as heatmap layers — so this samples cached grids rather than triggering upstream
        fetches. But the serve box is 1-CPU with a THREE-INCIDENT melt history at 7.5-8.6 s/req
        (see `routes/weather.py`'s live-ratings load shed), so 4x on the hot path is not a
        decision to make from a docstring. Turn it on in the PRECOMPUTE first and measure.

        ⛔ IF YOU ENABLE IT, ENABLE IT EVERYWHERE. `surf_height_m` from this lane is what the map
        glyphs, the spot hub and the weather sim all display; a flag set in one environment and not
        another makes the same spot two different heights depending on which lane answered.

        Fails OPEN in every branch: any miss returns None and the caller falls through to the
        total-field estimate, byte-identical to today.
        """
        if os.environ.get("SURF_PARTITIONS", "0") != "1":
            return None
        if (layer or "").lower() != "waves":      # only the TOTAL field has partitions to split
            return None
        parts = []
        for part_layer, kind in self._PARTITION_LAYERS:
            try:
                # ⚠️ grid_product_id/grid_bbox are deliberately NOT forwarded: they identify the
                # caller's WAVES product, and reusing them would sample the wrong grid.
                r = await self._resolve_point_internal(
                    model=model, domain="marine", layer=part_layer,
                    lat=lat, lng=lng, valid_time_str=valid_time_str)
                # ⛔ AUTHENTICITY: a ratio-derived train is the TOTAL field re-weighted (swell_2
                # historically got the total's direction ROTATED +40°) — feeding it to the
                # spectral factors double-counts the total under an invented bearing. Reconcile
                # rescales energy and the represent gate checks coverage; neither can detect
                # fabrication — only provenance can (2026-07-30, the phantom NE swell).
                _basis = getattr(r, "estimate_basis", None)
                if isinstance(_basis, dict) and _basis.get("method") == "wave_component_ratio_estimation":
                    continue
                p = getattr(r, "point", None)
                # ⚠️ NaN passes `not x` AND `x <= 0` (both False) — the self-inequality checks are
                # what actually reject it, exactly like the total's guard. A NaN train that slips
                # through poisons the RATING half into score=NaN, which score_to_level maps to
                # 'epic' (every `score < upper` is False). Direction NaN is nulled, not fatal:
                # the exposure factors skip a dirless train.
                if (p is None or not p.speed or not p.period
                        or p.speed != p.speed or p.period != p.period
                        or p.speed <= 0 or p.period <= 0):
                    continue
                _dir = p.direction
                if _dir is not None and _dir != _dir:
                    _dir = None
                parts.append({"h": float(p.speed), "tp": float(p.period),
                              "dir": _dir, "kind": kind})
            except Exception as _pe:
                logger.debug(f"[Surf partitions] {part_layer} at ({lat},{lng}) skipped: {_pe}")
        if not parts:
            return None
        from services.weather_pipeline.surf_transform import (
            partitions_represent, reconcile_partitions)
        # The REPRESENT gate: if the surviving trains carry under half the total Hs in quadrature,
        # the dominant train is missing and reconciling would inflate a minority train to carry all
        # the energy at its own period — fall back to the total field instead.
        # total_tp closes the PERIOD half: a decomposition can carry the height and still omit
        # the long train that dominates energy flux (P ~ h^2*T). See PARTITION_MAX_TP_RATIO.
        if not partitions_represent(parts, total_h, total_tp):
            return None
        return reconcile_partitions(parts, total_h)

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

        # The surf augmentation (geometry -> breaking height -> spectral partitions -> readiness)
        # lives in `point_surf_augment`; this file hit the 800-line ratchet. `_resolve_partitions`
        # is passed in so the re-entrancy guard stays intact (it uses `_resolve_point_internal`,
        # never this method, so a partition cannot resolve its own partitions).
        response = await augment_with_surf(
            response, model, domain, layer, lat, lng, valid_time_str, self._resolve_partitions)

        # ⭐ THE PHYSICS VALIDITY STAMP GOES HERE AND NOWHERE ELSE. `NormalizedPointDetail` is built
        # at 14 sites across 5 modules, so there is no chokepoint down there — but EVERY consumer
        # that matters (the ratings precompute, the spot hub, buoy calibration, and /api/weather/
        # point) calls THIS method, and it has exactly one return. A check placed on the direct-point
        # path instead would not have reached the defect at all: every impossible pair measured on
        # 2026-08-04 arrived via `source: grid_file`. See wave_physics for the measurement.
        response = wave_physics.stamp_point_validity(response, domain, layer)
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

        # 2b. Check scheduled products in the manifest — via the identity-keyed lane index
        # (manifest_view). The old full scan was O(16,132) x 22 per hub request, on the loop.
        manifest = await asyncio.to_thread(self.store.get_manifest)
        authoritative_candidates = []
        estimated_candidates = []

        from services.weather_pipeline.manifest_view import products_for
        for p in products_for(manifest, model, domain, layer):
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

        best_auth = None
        best_est = None
        if authoritative_candidates:
            best_auth = min(authoritative_candidates, key=_selection_key)
        if estimated_candidates:
            best_est = min(estimated_candidates, key=_selection_key)

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

                        # ⚠️ A LITERAL ZERO IS THE SAME LAND-MASK SIGNATURE AS A NULL, AND THE GUARD
                        # ABOVE ONLY CAUGHT None. Measured 2026-07-28 against production: Biarritz,
                        # Guéthary, Anglet, Busua (GH) and Barra da Lagoa (BR) served
                        # Hs=0.0 / Tp=0.0 / dir=0.0 with is_forecast_authoritative=true at the hours
                        # NOT covered by a cached grid frame (source=backend_direct_point,
                        # product_id=None), while EURO had 0.8-1.5 m of swell at the identical
                        # coordinate and hour. A user dragging the scrubber watched the swell blink
                        # out: Biarritz real at 08-18Z, hard zero at 02Z/05Z/20Z/23Z.
                        #
                        # ★ THE PHYSICAL TELL: a dead-calm sea still has a PEAK PERIOD. Height AND
                        # period simultaneously exactly zero is a mask/no-data signature, never a sea
                        # state — so it must degrade to the stashed coarse sample or an honest
                        # no-coverage response, exactly as the NULL case above already does.
                        # Kill: MARINE_ZERO_IS_NO_COVERAGE=0 restores the pre-fix behaviour.
                        if (speed == 0.0 and period == 0.0
                                and os.environ.get("MARINE_ZERO_IS_NO_COVERAGE", "1") != "0"):
                            logger.info(
                                f"[Point] {model} {layer} at ({lat},{lng}) {valid_time_str}: direct "
                                f"point returned Hs=0 AND Tp=0 — treating as NO COVERAGE, not data.")
                            if coarse_last_resort is not None:
                                return coarse_last_resort
                            return make_no_coverage_point_response(model, layer, lat, lng, valid_time_str, grid_product_id)
                        
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

        # 2. Check scheduled products in the manifest — same lane index as resolve_point above.
        manifest = await asyncio.to_thread(self.store.get_manifest)
        authoritative_candidates = []
        estimated_candidates = []

        from services.weather_pipeline.manifest_view import products_for
        from services.weather_pipeline.route_helpers import is_inside_bounds, get_actual_grid_bounds
        for p in products_for(manifest, model, domain, layer):
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

        best_auth = None
        best_est = None
        if authoritative_candidates:
            best_auth = min(authoritative_candidates, key=_selection_key)
        if estimated_candidates:
            best_est = min(estimated_candidates, key=_selection_key)

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
        forecast_days: int = 11,
        spot_id: Any = None
    ) -> Dict[str, Any]:
        """
        Unifies conditions retrieval for a spot, checking local dynamic/manifest
        caches first, and falling back to a single upstream point query on miss.

        `spot_id` is OPTIONAL and changes nothing about the forecast itself — it lets the rating
        grade the height against the SPOT'S OWN good day (`spot_size_climatology`, gated
        RATING_LOCAL_SIZE) instead of the global curve, which is what the map glyphs do. Omit it and
        the hub keeps the global curve, i.e. the behaviour before that flag existed. Every caller
        that has an id should pass it, or the hub and the glyphs grade the same spot differently.
        """
        from services.weather_pipeline.spot_conditions import resolve_spot_conditions_impl
        return await resolve_spot_conditions_impl(self, model, lat, lng, forecast_days,
                                                  spot_id=spot_id)

