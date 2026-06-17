import os
import math
import logging
import asyncio
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timezone
from typing import Dict, List, Any, Optional
from services.weather_pipeline.schemas import (
    NormalizedProduct, NormalizedGrid, GridVector, CoverageBounds
)
from services.weather_pipeline.route_helpers import is_inside_bounds

logger = logging.getLogger(__name__)

_NORMALIZER_PROCESS_POOL = None

def get_normalizer_process_pool():
    global _NORMALIZER_PROCESS_POOL
    if _NORMALIZER_PROCESS_POOL is None:
        max_workers = min(os.cpu_count() or 1, 4)
        _NORMALIZER_PROCESS_POOL = ProcessPoolExecutor(max_workers=max_workers)
    return _NORMALIZER_PROCESS_POOL

def _normalize_worker(
    model: str,
    provider: str,
    domain: str,
    layer: str,
    raw_results: List[Dict[str, Any]],
    bbox: Dict[str, float],
    resolution: float,
    target_time_ts: float,
    run_time_ts: Optional[float],
    region_id: Optional[str],
    coverage_mode: Optional[str]
) -> Optional[Dict[str, Any]]:
    target_time = datetime.fromtimestamp(target_time_ts, tz=timezone.utc)
    run_time = datetime.fromtimestamp(run_time_ts, tz=timezone.utc) if run_time_ts else None
    
    normalizer = WeatherNormalizer()
    product = normalizer.normalize(
        model=model,
        provider=provider,
        domain=domain,
        layer=layer,
        raw_results=raw_results,
        bbox=bbox,
        resolution=resolution,
        target_time=target_time,
        run_time=run_time,
        region_id=region_id,
        coverage_mode=coverage_mode
    )
    if product:
        return product.model_dump()
    return None

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
        },
        "pressure": {
            "speed": "pressure_msl",
            "direction": None,
            "period": None
        },
        "precipitation": {
            "speed": "precipitation",
            "direction": None,
            "period": None
        }
    }

    async def normalize_async(
        self,
        model: str,
        provider: str,
        domain: str,
        layer: str,
        raw_results: List[Dict[str, Any]],
        bbox: Dict[str, float],
        resolution: float,
        target_time: datetime,
        run_time: Optional[datetime] = None,
        region_id: Optional[str] = None,
        coverage_mode: Optional[str] = None
    ) -> Optional[NormalizedProduct]:
        """
        Asynchronously normalizes raw API responses by offloading CPU-bound tasks to a ProcessPoolExecutor.
        """
        loop = asyncio.get_running_loop()
        target_ts = target_time.timestamp()
        run_ts = run_time.timestamp() if run_time else None
        pool = get_normalizer_process_pool()
        result_dict = await loop.run_in_executor(
            pool,
            _normalize_worker,
            model,
            provider,
            domain,
            layer,
            raw_results,
            bbox,
            resolution,
            target_ts,
            run_ts,
            region_id,
            coverage_mode
        )
        if result_dict:
            return NormalizedProduct.model_validate(result_dict)
        return None

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
        run_time: Optional[datetime] = None,
        region_id: Optional[str] = None,
        coverage_mode: Optional[str] = None
    ) -> Optional[NormalizedProduct]:
        """
        Processes raw hourly coordinate grids and returns a NormalizedProduct for a specific target time.
        """
        if model.upper() == "ICON" and layer.lower() == "swell_2":
            logger.warning("[Normalizer] ICON swell_2 is unsupported by source data.")
            return None

        if not raw_results:
            logger.warning("[Normalizer] Received empty raw results list.")
            return None

        # Check if the raw results are test fixtures
        if raw_results and any(pt.get("is_test_fixture") is True for pt in raw_results if isinstance(pt, dict)):
            provider = "test-fixture"

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
        west = bbox["west"]
        east = bbox["east"]
        south = min(bbox["south"], bbox["north"])
        north = max(bbox["south"], bbox["north"])

        # Handle antimeridian crossing in monotonic space
        if west > east:
            east_monotonic = east + 360.0
        else:
            east_monotonic = east

        clean_lats_set = set()
        clean_lons_set = set()

        lat_step = south
        while lat_step <= north + 0.0001:
            clean_lats_set.add(round(lat_step, 4))
            lat_step += resolution

        lon_step = west
        while lon_step <= east_monotonic + 0.0001:
            clean_lons_set.add(round(lon_step, 4))
            lon_step += resolution

        unique_lats = sorted(list(clean_lats_set))
        unique_lons = sorted(list(clean_lons_set))
        cols = len(unique_lons)
        rows = len(unique_lats)

        # Build mapping from raw results to snapped grid coordinates
        grid_data = {}
        bounds_obj = CoverageBounds(west=west, south=south, east=east, north=north)
        is_layer_estimated = False
        estimate_basis = None
        for pt in raw_results:
            raw_lat = pt.get("latitude")
            raw_lng = pt.get("longitude")
            if raw_lat is None or raw_lng is None:
                continue

            if not is_inside_bounds(raw_lat, raw_lng, bounds_obj, margin=resolution * 0.49):
                continue
            
            # Map raw coordinate to monotonic space if crossing antimeridian
            raw_lng_monotonic = raw_lng
            if west > east and raw_lng < 0:
                raw_lng_monotonic += 360.0

            # Map raw snapped coordinates to the nearest clean coordinate
            mapped_lat = round(round((raw_lat - south) / resolution) * resolution + south, 4)
            mapped_lng = round(round((raw_lng_monotonic - west) / resolution) * resolution + west, 4)
            
            # Clamp to the unique lists to be absolutely sure they lie on the clean grid
            lat = min(unique_lats, key=lambda val: abs(val - mapped_lat))
            lng = min(unique_lons, key=lambda val: abs(val - mapped_lng))
            pt_hourly = pt.get("hourly", {})

            s_key, d_key, p_key = speed_key, direction_key, period_key
            gust_key = "wind_gusts_10m" if (domain == "wind" and model.upper() in ("ICON", "EURO")) else None

            speed_list = pt_hourly.get(s_key, [])
            dir_list = pt_hourly.get(d_key, [])
            period_list = pt_hourly.get(p_key, []) if p_key else []
            gust_list = pt_hourly.get(gust_key, []) if gust_key else []

            # Fallback estimation for missing marine component layers (e.g. ecmwf_wam025 swells)
            if domain == "marine" and layer.lower() in ("swell_1", "swell_2", "wind_waves"):
                wave_speed_list = pt_hourly.get("wave_height", [])
                if (not speed_list or all(v is None for v in speed_list)) and wave_speed_list and any(v is not None for v in wave_speed_list):
                    is_layer_estimated = True
                    estimate_basis = {
                        "type": "ecmwf_ifs_derived_fallback" if model.upper() == "EURO" else "gfs_derived_fallback",
                        "method": "wave_component_ratio_estimation",
                        "source_model": "ecmwf_wam025" if model.upper() == "EURO" else "ncep_gfswave025"
                    }
                    wave_dir_list = pt_hourly.get("wave_direction", [])
                    wave_period_list = pt_hourly.get("wave_period", [])
                    
                    if layer.lower() == "swell_1":
                        speed_list = [v * 0.85 if v is not None else None for v in wave_speed_list]
                        dir_list = wave_dir_list
                        period_list = [v * 0.9 if v is not None else None for v in wave_period_list]
                    elif layer.lower() == "swell_2":
                        speed_list = [v * 0.35 if v is not None else None for v in wave_speed_list]
                        dir_list = [(v + 40.0) % 360.0 if v is not None else None for v in wave_dir_list]
                        period_list = [v * 0.7 if v is not None else None for v in wave_period_list]
                    elif layer.lower() == "wind_waves":
                        speed_list = [v * 0.45 if v is not None else None for v in wave_speed_list]
                        dir_list = wave_dir_list
                        period_list = [v * 0.6 if v is not None else None for v in wave_period_list]

            # Handle indexes out of bounds safely
            speed = speed_list[time_idx] if time_idx < len(speed_list) else None
            direction = dir_list[time_idx] if time_idx < len(dir_list) else None
            period = period_list[time_idx] if (p_key and time_idx < len(period_list)) else None
            gust = gust_list[time_idx] if (gust_key and time_idx < len(gust_list)) else None

            # Guard against invalid or land null coordinates
            is_scalar = (direction_key is None)
            if speed is None or (not is_scalar and direction is None):
                vector = GridVector(
                    lat=lat, lng=lng, speed=0.0, direction=0.0, u=0.0, v=0.0, period=0.0, gust=None, value=None, is_valid=False
                )
            else:
                # Standardize Wind knots conversions if needed
                hourly_units = pt.get("hourly_units", {})
                speed_unit = hourly_units.get(s_key, "")
                
                if domain == "wind" and speed_unit != "kn" and speed_unit != "knots":
                    if speed_unit == "km/h":
                        speed = speed * 0.539957
                        if gust is not None:
                            gust = gust * 0.539957
                    elif speed_unit == "m/s":
                        speed = speed * 1.943844
                        if gust is not None:
                            gust = gust * 1.943844
                    elif speed_unit == "mph":
                        speed = speed * 0.868976
                        if gust is not None:
                            gust = gust * 0.868976

                # Compute Cartesian U/V velocities
                if is_scalar:
                    u = 0.0
                    v = 0.0
                    direction = 0.0
                else:
                    rad = direction * (math.pi / 180.0)
                    u = -speed * math.sin(rad)
                    v = -speed * math.cos(rad)

                vector = GridVector(
                    lat=lat,
                    lng=lng,
                    speed=0.0 if is_scalar else round(speed, 4),
                    direction=round(direction, 2) if direction is not None else 0.0,
                    u=round(u, 4),
                    v=round(v, 4),
                    period=round(period, 2) if period is not None else 0.0,
                    gust=round(gust, 4) if gust is not None else None,
                    value=round(speed, 4) if is_scalar else None,
                    is_valid=True
                )
            
            grid_data[(lat, lng)] = vector

        # Build full rectangular grid
        vectors = []
        crosses_antimeridian = west > east
        for lat in unique_lats:
            for lng in unique_lons:
                # Wrap longitude to standard range [-180, 180]
                lng_wrapped = lng - 360.0 if lng > 180.0 else (lng + 360.0 if lng < -180.0 else lng)
                lng_wrapped = round(lng_wrapped, 4)

                if (lat, lng) in grid_data:
                    vec = grid_data[(lat, lng)]
                    vec.lng = lng_wrapped
                    vectors.append(vec)
                else:
                    # Explicit ocean-masked vector for missing cells
                    vectors.append(GridVector(
                        lat=lat, lng=lng_wrapped, speed=0.0, direction=0.0, u=0.0, v=0.0, period=0.0, gust=None, value=None, is_valid=False
                    ))

        # Sort vectors in stable row-major order (south-to-north, west-to-east)
        if crosses_antimeridian:
            # Sort with antimeridian-aware key: points >= west first, then points < west
            vectors.sort(key=lambda v: (v.lat, 0 if v.lng >= west else 1, v.lng))
        else:
            vectors.sort(key=lambda v: (v.lat, v.lng))

        nonzero_count = sum(1 for v in vectors if v.speed > 0.0)
        expected_cell_count = cols * rows
        missing_cell_count = expected_cell_count - len(vectors)  # Should always be 0 now

        grid = NormalizedGrid(
            bounds=bounds,
            cols=cols,
            rows=rows,
            vectors=vectors,
            diagnostics={
                "cols": cols,
                "rows": rows,
                "vectorCount": len(vectors),
                "vectors_length": len(vectors),
                "expectedCellCount": expected_cell_count,
                "missingCellCount": missing_cell_count,
                "nonzeroCount": nonzero_count,
                "gridMode": "rectangular"
            }
        )

        # Configure truth units and kind metadata dynamically based on domain
        if domain.lower() == "weather" and layer.lower() == "pressure":
            value_kind = "pressure"
            value_unit = "hPa"
            display_unit_hint = "hPa"
            units = {
                "value": "hPa"
            }
        elif domain.lower() == "weather" and layer.lower() == "precipitation":
            value_kind = "precipitation"
            value_unit = "mm"
            display_unit_hint = "mm"
            units = {
                "value": "mm"
            }
        elif domain.lower() == "marine":
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

        source_vars = list(filter(None, [speed_key, direction_key, period_key]))
        source_dataset = None
        is_test_fixture = False
        up_provider = None
        up_model = None

        if provider.lower() == "copernicus":
            source_dataset = "cmems_mod_glo_wav_anfc_0.083deg_PT3H-i"
            up_provider = "copernicus"
            up_model = "cmems_mod_glo_wav_anfc_0.083deg_PT3H-i"
            # Map standard variables to CMEMS variable names
            om_to_cop_map = {
                "wave_height": "VHM0",
                "wave_direction": "VMDR",
                "wave_period": "VTM10",
                "swell_wave_height": "VHM0_SW1",
                "swell_wave_direction": "VMDR_SW1",
                "swell_wave_period": "VTM01_SW1",
                "secondary_swell_wave_height": "VHM0_SW2",
                "secondary_swell_wave_direction": "VMDR_SW2",
                "secondary_swell_wave_period": "VTM01_SW2",
                "wind_wave_height": "VHM0_WW",
                "wind_wave_direction": "VMDR_WW",
                "wind_wave_period": "VTM01_WW",
            }
            source_vars = [om_to_cop_map.get(v, v) for v in source_vars]
        elif provider.lower() == "open-meteo" and model.upper() == "GFS" and domain.lower() == "weather" and layer.lower() == "pressure":
            source_dataset = "gfs_seamless"
            up_provider = "open-meteo"
            up_model = "gfs_seamless"
        elif provider.lower() == "open-meteo" and model.upper() == "GFS" and domain.lower() == "weather" and layer.lower() == "precipitation":
            source_dataset = "gfs_seamless"
            up_provider = "open-meteo"
            up_model = "gfs_seamless"
        elif provider.lower() == "open-meteo" and model.upper() == "ICON" and domain.lower() == "weather" and layer.lower() == "pressure":
            source_dataset = "dwd_icon"
            up_provider = "open-meteo"
            up_model = "dwd_icon"
        elif provider.lower() == "open-meteo" and model.upper() == "ICON" and domain.lower() == "weather" and layer.lower() == "precipitation":
            source_dataset = "dwd_icon"
            up_provider = "open-meteo"
            up_model = "dwd_icon"
        elif provider.lower() == "open-meteo" and model.upper() == "EURO" and domain.lower() == "weather" and layer.lower() == "pressure":
            source_dataset = "ecmwf_ifs"
            up_provider = "open-meteo"
            up_model = "ecmwf_ifs"
        elif provider.lower() == "open-meteo" and model.upper() == "EURO" and domain.lower() == "weather" and layer.lower() == "precipitation":
            source_dataset = "ecmwf_ifs"
            up_provider = "open-meteo"
            up_model = "ecmwf_ifs"
        elif provider.lower() == "open-meteo" and model.upper() == "GFS" and domain.lower() == "marine":
            source_dataset = "ncep_gfswave025"
            up_provider = "open-meteo"
            up_model = "ncep_gfswave025"
        elif provider.lower() == "open-meteo" and model.upper() == "GFS" and domain.lower() == "wind":
            source_dataset = "gfs_seamless"
            up_provider = "open-meteo"
            up_model = "gfs_seamless"
        elif provider.lower() == "open-meteo" and model.upper() == "ICON" and domain.lower() == "marine":
            source_dataset = "dwd_gwam"
            up_provider = "open-meteo"
            up_model = "gwam"
        elif provider.lower() == "open-meteo" and model.upper() == "ICON" and domain.lower() == "wind":
            source_dataset = "dwd_icon"
            up_provider = "open-meteo"
            up_model = "dwd_icon"
        elif provider.lower() == "open-meteo" and model.upper() == "EURO" and domain.lower() == "wind":
            source_dataset = "ecmwf_ifs"
            up_provider = "open-meteo"
            up_model = "ecmwf_ifs"
        elif provider.lower() == "open-meteo" and model.upper() == "EURO" and domain.lower() == "marine":
            source_dataset = "ecmwf_wam025"
            up_provider = "open-meteo"
            up_model = "ecmwf_wam025"
        elif provider.lower() == "test-fixture":
            node_env = os.environ.get("NODE_ENV", "").lower()
            env = os.environ.get("ENV", "").lower()
            is_prod = os.environ.get("IS_PROD", "").lower()
            
            is_test_env = False
            if not (node_env == "production" or env == "production" or is_prod == "true"):
                is_test_env = (
                    os.environ.get("NODE_ENV") == "test" or 
                    os.environ.get("LOCAL_TEST_FIXTURE") == "true" or
                    os.environ.get("TESTING") == "1"
                )
            if is_test_env:
                is_test_fixture = True
            else:
                logger.error("[Normalizer] Security Violation: Refusing to set is_test_fixture=True in non-test environment.")
                is_test_fixture = False

        return NormalizedProduct(
            model=model.upper(),
            provider=provider.lower(),
            domain=domain.lower(),
            layer=layer.lower(),
            run_time=run_time,
            valid_time=actual_valid_time,
            is_forecast_authoritative=provider.lower() != "test-fixture",
            is_estimated=is_layer_estimated or provider.lower() == "test-fixture",
            estimate_basis=estimate_basis,
            coverage=bounds,
            grid=grid,
            value_kind=value_kind,
            value_unit=value_unit,
            display_unit_hint=display_unit_hint,
            units=units,
            source_variables=source_vars,
            freshness_sec=1800,
            is_test_fixture=is_test_fixture,
            source_dataset=source_dataset,
            upstream_provider=up_provider,
            upstream_model=up_model,
            region_id=region_id,
            coverage_mode=coverage_mode,
            tile_id=region_id
        )

    @staticmethod
    def find_closest_time_index(times: List[str], target: datetime) -> Optional[int]:
        """
        Locates the closest available hourly index for the target datetime.
        Capped at 3 hours delta limit.
        """
        if target.tzinfo is None:
            target = target.replace(tzinfo=timezone.utc)
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
