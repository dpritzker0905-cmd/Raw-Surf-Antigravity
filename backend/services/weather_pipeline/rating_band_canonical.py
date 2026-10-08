"""WC01 dark band: rate already-loaded cells through the reference composition.

Runs in the overlay worker, with one event loop per grid, no forecast fetches,
and no tide requests for anonymous cells lacking a spot's best-tide prior.
Cell reference and observation gate remain the band's explicit spatial policy.
"""
import asyncio
import math
import os

from services.weather_pipeline.schemas import NormalizedPointDetail, NormalizedPointResponse
from services.weather_pipeline import surf_rating as SR
from services.weather_pipeline.surf_point import resolve_surf_geometry, estimate_surf_at
from services.weather_pipeline.spot_ratings import rate_one_spot


class _CellResolver:
    """Only the loaded marine cell and co-sampled wind can answer this resolver."""
    def __init__(self, product, vector, geometry, wind):
        self.product, self.vector, self.geometry, self.wind = product, vector, geometry, wind

    async def find_cached_grid_product(self, *args, **kwargs):
        return None  # optional display swell; never trigger another forecast load

    async def resolve_point(self, *, domain, **kwargs):
        product, vector = self.product, self.vector
        if domain == "wind" and not self.wind:
            return None
        speed, direction = ((self.wind[0] / SR.KT_TO_MS, self.wind[1]) if domain == "wind"
                            else (vector.speed, vector.direction))
        result = NormalizedPointResponse(
            model=product.model, provider=product.provider, domain=domain,
            layer="wind" if domain == "wind" else product.layer,
            run_time=product.run_time, valid_time=product.valid_time,
            model_run_time=product.model_run_time, model_run_time_status=product.model_run_time_status,
            is_forecast_authoritative=product.is_forecast_authoritative, is_estimated=product.is_estimated,
            source_variables=product.source_variables, freshness_sec=product.freshness_sec,
            value_kind="wind_speed" if domain == "wind" else product.value_kind,
            value_unit="kn" if domain == "wind" else product.value_unit,
            display_unit_hint=product.display_unit_hint, product_id=product.product_id,
            point=NormalizedPointDetail(
                requested_lat=vector.lat, requested_lng=vector.lng,
                sampled_lat=vector.lat, sampled_lng=vector.lng, speed=speed,
                direction=direction, period=vector.period, u=vector.u, v=vector.v,
                speed_spread=vector.speed_spread, interpolation_method="exact_grid_cell"))
        if domain == "marine":
            height, regime = estimate_surf_at(vector.lat, vector.lng, speed, vector.period,
                                            swell_from_deg=direction, geometry=self.geometry)
            result.surf_height_m = height
            result.surf_regime = regime
            result.break_depth_m = self.geometry.break_depth_m
            result.break_depth_source = self.geometry.break_depth_source
            result.shore_normal_deg = self.geometry.shore_normal_deg
        return result


async def _transform(product, vectors, wind_fn, reference_fn, gate_fn):
    rated = masked = 0
    for vector in vectors:
        offshore = vector.speed
        if not vector.is_valid or not math.isfinite(offshore) or offshore < 0:
            vector.is_valid = False
            masked += 1
            continue
        if offshore == 0:
            continue
        geometry = resolve_surf_geometry(vector.lat, vector.lng)
        if not geometry.coastal:
            vector.phys_speed = offshore
            vector.is_valid = False
            masked += 1
            continue
        def optional(fn):
            try:
                return fn(vector.lat, vector.lng) if fn else None
            except Exception:
                return None

        wind = optional(wind_fn)
        reference = optional(reference_fn)
        resolver = _CellResolver(product, vector, geometry, wind)
        rating = await rate_one_spot(
            resolver, {"id": f"cell:{vector.lat}:{vector.lng}",
                       "latitude": vector.lat, "longitude": vector.lng},
            product.model, product.valid_time.isoformat(), reference_size_m=reference,
            tide_state_override=None)
        score = rating["score"]
        if score is None or not math.isfinite(score) or score <= 0:
            vector.phys_speed = offshore
            vector.is_valid = False
            masked += 1
            continue
        if gate_fn:
            # Same fail-open observation policy as the existing transform.
            try:
                gated = gate_fn(vector.lat, vector.lng, score)
                if gated is not None and gated > 0:
                    score = gated
            except Exception:
                pass
        vector.phys_speed = offshore
        vector.speed = round(float(score) / 10., 4)
        rated += 1
    return rated, masked


def transform_rating_band(product, wind_fn=None, reference_fn=None, gate_fn=None):
    """Worker-only entry point; the caller supplies owned vector copies."""
    # These point refinements require inputs not carried by a combined-sea
    # grid. Refuse the dark candidate before mutation rather than imply parity.
    if (os.environ.get("SURF_PARTITIONS", "0") == "1"
            or os.environ.get("SURF_TIDE_DEPTH", "0") != "0"
            or os.environ.get("SURF_NEARSHORE_MOP", "0") == "1"):
        raise ValueError("canonical_band_inputs_missing: partitions/tide-depth/nearshore")
    # Publish atomically: the overlay's fail-open exception path must return
    # offshore heights, never a mixture of graded cells and raw heights.
    vectors = [vector.model_copy() for vector in product.grid.vectors]
    counts = asyncio.run(_transform(product, vectors, wind_fn, reference_fn, gate_fn))
    product.grid.vectors = vectors
    return counts
