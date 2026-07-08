"""Direct upstream point-API fallback builders (the resolver's PATH 2c).

Split out of point_resolution.py (800-LOC limit, 2026-07-03): the WIND and WEATHER-scalar
builders are self-contained; the MARINE builder stays in the resolver because it interleaves
with the coarse-gap last-resort stash and the EURO/Copernicus masking ladder.

Each builder returns a NormalizedPointResponse on success or None (upstream unavailable /
time not covered) so the resolver can fall through to its stashed sample or structured 404.
"""
import math
import logging
from datetime import datetime, timezone
from typing import Any, Optional

from services.weather_pipeline.schemas import NormalizedPointResponse, NormalizedPointDetail

logger = logging.getLogger(__name__)


def safe_index_get(dict_obj: dict, key: str, index: int, default_val: Any = 0.0) -> Any:
    """Safely retrieves the index element of list from dict_obj, returning default_val if missing or out of bounds."""
    if dict_obj and isinstance(dict_obj.get(key), list) and index < len(dict_obj[key]):
        val = dict_obj[key][index]
        return val if val is not None else default_val
    return default_val


async def build_wind_direct_point_response(provider, model: str, lat: float, lng: float,
                                           target_dt: datetime) -> Optional[NormalizedPointResponse]:
    """Direct open-meteo point fallback for domain=wind/layer=wind (behavior-identical extraction)."""
    try:
        point_forecast_days = {"ICON": 5, "EURO": 15, "GFS": 16}.get(model.upper(), 2)
        raw_point = await provider.fetch_point(model=model, domain="wind", layer="wind", lat=lat, lng=lng, forecast_days=point_forecast_days)
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

                upstream_model = provider.FORECAST_MODELS.get(model.upper(), "gfs_seamless")

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
        # {ex!r} + WARNING (runbook §12): transport transients stringify to "" and this fails open
        # (returns None → caller serves coarse/no-coverage). repr keeps the type diagnosable.
        logger.warning(f"[Point Fallback] Failed fetching point for {model} wind at ({lat}, {lng}): {ex!r} (fails open)")
    return None


async def build_scalar_direct_point_response(provider, model: str, layer: str, lat: float, lng: float,
                                             target_dt: datetime) -> Optional[NormalizedPointResponse]:
    """Direct open-meteo point fallback for domain=weather pressure/precipitation (behavior-identical extraction)."""
    try:
        point_forecast_days = {"ICON": 5, "EURO": 15, "GFS": 16}.get(model.upper(), 2)
        raw_point = await provider.fetch_point(model=model, domain="weather", layer=layer, lat=lat, lng=lng, forecast_days=point_forecast_days)
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

                upstream_model = provider.FORECAST_MODELS.get(model.upper(), "gfs_seamless")
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
        # {ex!r} + WARNING (runbook §12): transport transients stringify to "" and this fails open
        # (returns None → caller serves coarse/no-coverage). repr keeps the type diagnosable.
        logger.warning(f"[Point Fallback] Failed fetching point for {model} weather/{layer} at ({lat}, {lng}): {ex!r} (fails open)")
    return None
