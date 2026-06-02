import math
import logging
from datetime import datetime, timezone
from typing import Dict, List, Any, Optional
from services.weather_pipeline.schemas import (
    NormalizedProduct, NormalizedGrid, GridVector, CoverageBounds
)

logger = logging.getLogger(__name__)

class WeatherNormalizer:
    """
    Normalizes raw API responses from Open-Meteo and Copernicus Marine
    into a standardized NormalizedProduct grid.
    """

    # Mapping of layers to provider variable names
    LAYER_VARS = {
        "wind": {
            "speed": "wind_speed_10m",
            "direction": "wind_direction_10m",
            "period": None
        },
        "waves": {
            "speed": "wave_height",
            "direction": "wave_direction",
            "period": "wave_period"
        },
        "swell_1": {
            "speed": "swell_wave_height",
            "direction": "swell_wave_direction",
            "period": "swell_wave_period"
        },
        "swell_2": {
            "speed": "secondary_swell_wave_height",
            "direction": "secondary_swell_wave_direction",
            "period": "secondary_swell_wave_period"
        },
        "wind_waves": {
            "speed": "wind_wave_height",
            "direction": "wind_wave_direction",
            "period": "wind_wave_period"
        }
    }

    def normalize(
        self,
        model: str,
        provider: str,
        domain: str,
        layer: str,
        raw_results: List[Dict[str, Any]],
        bbox: Dict[str, float],
        resolution: float,
        target_time: datetime,
        run_time: Optional[datetime] = None
    ) -> Optional[NormalizedProduct]:
        """
        Processes raw hourly coordinate grids and returns a NormalizedProduct for a specific target time.
        """
        if not raw_results:
            logger.warning("[Normalizer] Received empty raw results list.")
            return None

        # Verify time coordinate coverage and extract standard time index
        first_point = raw_results[0]
        hourly = first_point.get("hourly", {})
        times = hourly.get("time", [])

        if not times:
            logger.warning("[Normalizer] Hourly time array is missing or empty.")
            return None

        time_idx = self.find_closest_time_index(times, target_time)
        if time_idx is None:
            logger.warning(f"[Normalizer] Target time {target_time} not covered by provider time range.")
            return None

        # Resolve actual valid time string and datetime
        valid_time_str = times[time_idx]
        # Open-Meteo returns 'YYYY-MM-DDTHH:MM' or 'YYYY-MM-DDTHH:MM:SSZ'
        if not valid_time_str.endswith("Z"):
            valid_time_str += "Z"
        actual_valid_time = datetime.fromisoformat(valid_time_str.replace("Z", "+00:00"))

        # Deduce run time
        if not run_time:
            run_time = datetime.now(timezone.utc)

        # Build bounds
        bounds = CoverageBounds(
            west=bbox["west"],
            south=bbox["south"],
            east=bbox["east"],
            north=bbox["north"]
        )

        # Standardize layers
        layer_def = self.LAYER_VARS.get(layer)
        if not layer_def:
            logger.error(f"[Normalizer] Unknown layer mapping requested: {layer}")
            return None

        speed_key = layer_def["speed"]
        direction_key = layer_def["direction"]
        period_key = layer_def["period"]

        # Reconstruct clean coordinates by rounding to the nearest resolution step relative to bbox origins
        west = min(bbox["west"], bbox["east"])
        east = max(bbox["west"], bbox["east"])
        south = min(bbox["south"], bbox["north"])
        north = max(bbox["south"], bbox["north"])

        clean_lats_set = set()
        clean_lons_set = set()

        lat_step = south
        while lat_step <= north + 0.0001:
            clean_lats_set.add(round(lat_step, 4))
            lat_step += resolution

        lon_step = west
        while lon_step <= east + 0.0001:
            clean_lons_set.add(round(lon_step, 4))
            lon_step += resolution

        unique_lats = sorted(list(clean_lats_set))
        unique_lons = sorted(list(clean_lons_set))
        cols = len(unique_lons)
        rows = len(unique_lats)

        vectors = []
        for pt in raw_results:
            raw_lat = pt.get("latitude")
            raw_lng = pt.get("longitude")
            
            # Map raw snapped coordinates to the nearest clean coordinate
            mapped_lat = round(round((raw_lat - south) / resolution) * resolution + south, 4)
            mapped_lng = round(round((raw_lng - west) / resolution) * resolution + west, 4)
            
            # Clamp to the unique lists to be absolutely sure they lie on the clean grid
            lat = min(unique_lats, key=lambda val: abs(val - mapped_lat))
            lng = min(unique_lons, key=lambda val: abs(val - mapped_lng))
            pt_hourly = pt.get("hourly", {})

            # Open-Meteo gwam secondary swell fallback
            if layer == "swell_2" and speed_key not in pt_hourly and "swell_wave_height" in pt_hourly:
                s_key, d_key, p_key = "swell_wave_height", "swell_wave_direction", "swell_wave_period"
            else:
                s_key, d_key, p_key = speed_key, direction_key, period_key

            speed_list = pt_hourly.get(s_key, [])
            dir_list = pt_hourly.get(d_key, [])
            period_list = pt_hourly.get(p_key, []) if p_key else []

            # Handle indexes out of bounds safely
            speed = speed_list[time_idx] if time_idx < len(speed_list) else None
            direction = dir_list[time_idx] if time_idx < len(dir_list) else None
            period = period_list[time_idx] if (p_key and time_idx < len(period_list)) else None

            # Guard against invalid or land null coordinates
            if speed is None or direction is None:
                # Keep a safe zero vector to guarantee coordinate indexing is perfectly regular
                vectors.append(GridVector(
                    lat=lat, lng=lng, speed=0.0, direction=0.0, u=0.0, v=0.0, period=0.0
                ))
                continue

            # Standardize Wind knots conversions if needed
            # Open-Meteo forecast hourly units wind_speed is knots only if requested, default km/h
            hourly_units = pt.get("hourly_units", {})
            speed_unit = hourly_units.get(s_key, "")
            
            if domain == "wind" and speed_unit != "kn" and speed_unit != "knots":
                if speed_unit == "km/h":
                    speed = speed * 0.539957
                elif speed_unit == "m/s":
                    speed = speed * 1.943844
                elif speed_unit == "mph":
                    speed = speed * 0.868976

            # Compute Cartesian U/V velocities
            rad = direction * (math.pi / 180.0)
            u = -speed * math.sin(rad)
            v = -speed * math.cos(rad)

            vectors.append(GridVector(
                lat=lat,
                lng=lng,
                speed=round(speed, 4),
                direction=round(direction, 2),
                u=round(u, 4),
                v=round(v, 4),
                period=round(period, 2) if period is not None else None
            ))

        # Sort vectors in stable row-major order (south-to-north, west-to-east)
        vectors.sort(key=lambda v: (v.lat, v.lng))

        grid = NormalizedGrid(
            bounds=bounds,
            cols=cols,
            rows=rows,
            vectors=vectors
        )

        # Configure truth units and kind metadata dynamically based on domain
        if domain.lower() == "marine":
            value_kind = "wave_height"
            value_unit = "m"
            display_unit_hint = "ft"
            units = {
                "speed": "m",
                "direction": "degrees",
                "period": "seconds"
            }
        else:
            value_kind = "wind_speed"
            value_unit = "kn"
            display_unit_hint = "kn"
            units = {
                "speed": "kn",
                "direction": "degrees",
                "period": "seconds"
            }

        return NormalizedProduct(
            model=model.upper(),
            provider=provider.lower(),
            domain=domain.lower(),
            layer=layer.lower(),
            run_time=run_time,
            valid_time=actual_valid_time,
            is_forecast_authoritative=True,
            is_estimated=False,
            coverage=bounds,
            grid=grid,
            value_kind=value_kind,
            value_unit=value_unit,
            display_unit_hint=display_unit_hint,
            units=units,
            source_variables=list(filter(None, [speed_key, direction_key, period_key])),
            freshness_sec=1800
        )

    @staticmethod
    def find_closest_time_index(times: List[str], target: datetime) -> Optional[int]:
        """
        Locates the closest available hourly index for the target datetime.
        Capped at 3 hours delta limit.
        """
        target_ts = target.timestamp()
        best_idx = None
        min_diff = float("inf")

        for idx, time_str in enumerate(times):
            if not time_str.endswith("Z"):
                time_str += "Z"
            dt = datetime.fromisoformat(time_str.replace("Z", "+00:00"))
            diff = abs(dt.timestamp() - target_ts)
            
            if diff < min_diff:
                min_diff = diff
                best_idx = idx

        # Enforce 3h cover guard threshold
        if min_diff > 3 * 3600:
            return None
            
        return best_idx
