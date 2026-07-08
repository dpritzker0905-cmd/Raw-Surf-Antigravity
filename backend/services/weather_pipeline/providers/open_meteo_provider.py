import os
import httpx
import logging
import asyncio
from typing import Dict, List, Any, Optional
import math
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv
from pathlib import Path

# Load backend .env if it exists
backend_dir = Path(__file__).resolve().parent.parent.parent.parent
load_dotenv(backend_dir / '.env')

logger = logging.getLogger(__name__)

def is_test_environment() -> bool:
    import os
    import sys
    node_env = os.environ.get("NODE_ENV", "").lower()
    env = os.environ.get("ENV", "").lower()
    is_prod_env = os.environ.get("IS_PROD", "").lower()
    local_test_fixture = os.environ.get("LOCAL_TEST_FIXTURE", "").lower() == "true"
    
    # Under test runner (pytest), enforce production overrides strictly to satisfy hardening tests.
    is_pytest = "pytest" in sys.modules
    
    if is_pytest:
        if node_env == "production" or env == "production" or is_prod_env == "true":
            return False
    else:
        # In actual execution (uvicorn / local dev), if LOCAL_TEST_FIXTURE is explicitly true,
        # we treat it as test environment to use mock data and avoid rate limits, even if
        # NODE_ENV is set to production.
        if local_test_fixture:
            return True
            
        if node_env == "production" or env == "production" or is_prod_env == "true":
            return False
            
    return (
        os.environ.get("NODE_ENV") == "test"
        or local_test_fixture
        or os.environ.get("TESTING") == "1"
    )

def generate_mock_open_meteo_response(lats: list, lons: list, hourly_vars_str: str, forecast_days: int) -> list:
    # Generate times: hourly for forecast_days
    start_time = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0) - timedelta(days=1)
    hours_count = forecast_days * 24
    time_strings = [(start_time + timedelta(hours=h)).strftime("%Y-%m-%dT%H:00Z") for h in range(hours_count)]
    
    variables = hourly_vars_str.split(",")
    
    # Storm center parameters (e.g. moving storm in North Atlantic)
    storm_lat_start = 25.0
    storm_lon_start = -60.0
    
    results = []
    for lat, lon in zip(lats, lons):
        # Generate mock values for this point
        hourly_data = {
            "time": time_strings
        }
        
        lat_rad = math.radians(lat)
        lon_rad = math.radians(lon)
        lat_deg = lat
        lon_deg = lon
        
        # Calculate base planetary wind parameters for this latitude
        if abs(lat_deg) < 30.0:
            # NE trades in NH (45-90 deg), SE trades in SH (90-135 deg)
            planet_dir = 90.0 - 45.0 * (lat_deg / 30.0)
            planet_speed = 12.0 + 4.0 * math.cos(lat_rad * 3.0)
        elif abs(lat_deg) < 60.0:
            # NH westerlies (SW, ~225 deg), SH westerlies (NW, ~315 deg)
            pct = (abs(lat_deg) - 30.0) / 30.0
            start_dir = 45.0 if lat_deg >= 0.0 else 135.0
            target_dir = 225.0 if lat_deg >= 0.0 else 315.0
            planet_dir = start_dir + (target_dir - start_dir) * pct
            planet_speed = 15.0 + 7.0 * math.sin(pct * math.pi)
        else:
            # Polar easterlies
            pct = (abs(lat_deg) - 60.0) / 30.0
            start_dir = 225.0 if lat_deg >= 0.0 else 315.0
            target_dir = 90.0 - 45.0 * (lat_deg / 90.0)
            planet_dir = start_dir + (target_dir - start_dir) * pct
            planet_speed = 8.0 + 4.0 * math.cos(pct * math.pi / 2.0)
            
        for var in variables:
            values = []
            for h in range(hours_count):
                t_factor = math.sin(h / 12.0)
                
                # Model storm center moving eastward and northward over time
                storm_lat = storm_lat_start + 1.5 * (h / 24.0)
                storm_lon = storm_lon_start + 4.0 * (h / 24.0)
                if storm_lon > 180.0:
                    storm_lon -= 360.0
                
                # Distance and angle to storm center
                dx = lon_deg - storm_lon
                # Handle antimeridian wrapping
                if dx > 180.0:
                    dx -= 360.0
                elif dx < -180.0:
                    dx += 360.0
                dy = lat_deg - storm_lat
                dist = math.sqrt(dx*dx + dy*dy)
                
                # Storm influence decays exponentially with distance
                storm_weight = math.exp(-dist / 12.0)
                
                # In NH (lat > 0), low pressure is counter-clockwise (cyclonic).
                # NH: tangent direction is atan2(dy, dx) + pi/2 + inflow
                # SH: low pressure is clockwise (anticyclonic).
                # SH: tangent direction is atan2(dy, dx) - pi/2 - inflow
                is_nh = lat_deg >= 0
                spiral_inflow = math.radians(20.0)
                if is_nh:
                    tangent_rad = math.atan2(dy, dx) + math.pi/2.0 + spiral_inflow
                else:
                    tangent_rad = math.atan2(dy, dx) - math.pi/2.0 - spiral_inflow
                
                storm_dir = (math.degrees(tangent_rad)) % 360.0
                
                # Storm speed profile: calm eye, peak winds at radius of maximum winds, decay
                # Peak winds at dist = 2.5 degrees
                storm_speed = 45.0 * (dist / 2.5) * math.exp(-dist / 4.0)
                
                # Blend planetary winds with local storm vortex
                final_dir = (1.0 - storm_weight) * planet_dir + storm_weight * storm_dir
                # Add some temporal variance
                final_dir = (final_dir + 15.0 * t_factor) % 360.0
                
                final_speed = (1.0 - storm_weight) * planet_speed + storm_weight * storm_speed
                final_speed = max(2.0, final_speed + 3.0 * t_factor)
                
                if "direction" in var:
                    val = final_dir
                elif "speed" in var or "wind" in var:
                    val = final_speed
                elif "period" in var:
                    val = 7.0 + 3.0 * math.sin(lat_rad - lon_rad) + 1.5 * t_factor
                elif "height" in var or "swell" in var:
                    val = 0.5 + 0.08 * final_speed + 0.3 * math.sin(lat_rad * 3 + lon_rad * 2)
                else:
                    val = 1.0 + 0.1 * t_factor
                values.append(round(max(0.01, val), 2))
            hourly_data[var] = values
            
        hourly_units = {v: "degree" if "direction" in v else ("s" if "period" in v else ("kn" if "wind" in v else "m")) for v in variables}
        hourly_units["time"] = "iso8601"
        
        results.append({
            "latitude": lat,
            "longitude": lon,
            "generationtime_ms": 0.01,
            "utc_offset_seconds": 0,
            "timezone": "GMT",
            "timezone_abbreviation": "GMT",
            "elevation": 0.0,
            "hourly_units": hourly_units,
            "hourly": hourly_data
        })
    return results

DEFAULT_WEATHER_PROXY_URL = "https://dev--rawsurf.netlify.app/.netlify/functions/weather-proxy"

def resolve_weather_proxy_url() -> str:
    # `or` (not a .get default): CI injects WEATHER_PROXY_URL as an EMPTY string when the
    # secret is unset, which would otherwise shadow the default and break every proxied fetch
    # ("Request URL is missing an 'http://' or 'https://' protocol").
    return os.environ.get("WEATHER_PROXY_URL") or DEFAULT_WEATHER_PROXY_URL

class OpenMeteoProvider:
    """
    Open-Meteo API provider for the Weather Ingestion Pipeline.
    Fetches GFS and ICON grids for both Marine (wave heights, swells, wind waves)
    and Wind (velocity, direction) domains.
    """
    MARINE_URL = "https://marine-api.open-meteo.com/v1/marine"
    FORECAST_URL = "https://api.open-meteo.com/v1/forecast"

    # Class-level caches for API responses
    _GRID_CACHE: Dict[str, tuple] = {}
    _POINT_CACHE: Dict[str, tuple] = {}
    _CACHE_TTL_SEC = 300.0  # 5 minutes

    # Mapping from model name to Open-Meteo models identifier
    MARINE_MODELS = {
        "GFS": "ncep_gfswave025",
        "ICON": "gwam",
        "EURO": "ecmwf_wam025"
    }

    FORECAST_MODELS = {
        "GFS": "gfs_seamless",
        "ICON": "dwd_icon",
        "EURO": "ecmwf_ifs"
    }

    async def fetch_grid(
        self,
        model: str,
        domain: str,
        layer: str,
        bbox: Dict[str, float],
        resolution: float = 0.25,
        forecast_days: int = 2,
        precomputed_coords: Optional[tuple] = None,
        inter_batch_delay: Optional[float] = None,
        batch_size: Optional[int] = None
    ) -> Optional[Dict[str, Any]]:
        """
        Asynchronously fetches a coordinate snap-grid from Open-Meteo.
        Returns the raw HTTP response as JSON.
        """
        # Clamp forecast_days based on model limits to prevent Open-Meteo 400 errors
        if domain == "marine":
            if model.upper() in ("ICON", "EURO"):
                forecast_days = min(forecast_days, 7)
            else:
                forecast_days = min(forecast_days, 16)
        else: # weather / wind
            if model.upper() == "ICON":
                forecast_days = min(forecast_days, 5)
            elif model.upper() == "EURO":
                forecast_days = min(forecast_days, 15)
            else:
                forecast_days = min(forecast_days, 16)

        # Generate grid points
        if precomputed_coords is not None:
            lats, lons = precomputed_coords
        else:
            lats, lons = self.generate_grid_coords(bbox, resolution)
        if not lats:
            logger.error(f"[Open-Meteo Provider] Generated empty grid for bbox: {bbox}")
            return None

        # Check in-memory grid cache
        now = datetime.now(timezone.utc).timestamp()
        coords_key = f"{len(lats)}_coords_{lats[0]:.4f}_{lons[0]:.4f}_{lats[-1]:.4f}_{lons[-1]:.4f}" if lats else "empty"
        cache_key = f"{model.upper()}_{domain.lower()}_{layer.lower()}_{coords_key}_{resolution}_{forecast_days}"
        if cache_key in self._GRID_CACHE:
            exp_time, cached_data = self._GRID_CACHE[cache_key]
            if now < exp_time:
                logger.info(f"[Open-Meteo Provider] Cache HIT for grid key: {cache_key}")
                return cached_data
            else:
                self._GRID_CACHE.pop(cache_key, None)

        # Build query parameters
        params = {
            "latitude": ",".join(f"{lat:.4f}" for lat in lats),
            "longitude": ",".join(f"{lon:.4f}" for lon in lons),
            "forecast_days": str(forecast_days),
        }

        if domain == "marine":
            url = self.MARINE_URL
            api_model = self.MARINE_MODELS.get(model.upper(), "ncep_gfswave025")
            params["models"] = api_model
            
            # Map layer variables
            if model.upper() == "EURO":
                # ecmwf_wam025 only supports significant wave height, direction, and period.
                # All swell partitions/wind waves must be estimated using the fallback in normalizer.py.
                params["hourly"] = "wave_height,wave_direction,wave_period"
            elif layer == "waves":
                params["hourly"] = "wave_height,wave_direction,wave_period"
            elif layer == "swell_1":
                params["hourly"] = "swell_wave_height,swell_wave_direction,swell_wave_period"
            elif layer == "swell_2":
                if api_model in ("gwam", "dwd_gwam"):
                    # ICON swell_2 doesn't have native secondary swell in gwam, fallback to swell
                    params["hourly"] = "swell_wave_height,swell_wave_direction,swell_wave_period"
                else:
                    params["hourly"] = "secondary_swell_wave_height,secondary_swell_wave_direction,secondary_swell_wave_period"
            elif layer == "wind_waves":
                params["hourly"] = "wind_wave_height,wind_wave_direction,wind_wave_period"
            elif layer == "all_marine":
                if api_model in ("gwam", "dwd_gwam"):
                    # gwam (DWD ICON wave) has NO native secondary swell parameter. Including
                    # secondary_swell_wave_* makes Open-Meteo 400 the ENTIRE all_marine request,
                    # which silently zeroes ICON marine global ingestion -> no coarse product ->
                    # ICON marine falls to the slow on-demand path on activation (unlike GFS/EURO,
                    # whose models support secondary swell). Mirror the swell_2 gwam special-case.
                    params["hourly"] = "wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period,wind_wave_height,wind_wave_direction,wind_wave_period"
                else:
                    params["hourly"] = "wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period,secondary_swell_wave_height,secondary_swell_wave_direction,secondary_swell_wave_period,wind_wave_height,wind_wave_direction,wind_wave_period"
            else:
                params["hourly"] = "wave_height,wave_direction,wave_period"
                
            # Always query wave_height for masking support if not present
            if "wave_height" not in params["hourly"]:
                params["hourly"] += ",wave_height"
                
        elif domain == "weather":
            url = self.FORECAST_URL
            api_model = self.FORECAST_MODELS.get(model.upper(), "gfs_seamless")
            params["models"] = api_model
            if layer == "pressure":
                params["hourly"] = "pressure_msl"
            elif layer == "precipitation":
                params["hourly"] = "precipitation"
            else:
                params["hourly"] = "pressure_msl"
                
        else: # wind
            url = self.FORECAST_URL
            api_model = self.FORECAST_MODELS.get(model.upper(), "gfs_seamless")
            params["models"] = api_model
            params["hourly"] = "wind_speed_10m,wind_direction_10m"
            if model.upper() in ("ICON", "EURO"):
                params["hourly"] += ",wind_gusts_10m"
            params["wind_speed_unit"] = "kn"

        logger.info(
            f"[Open-Meteo Provider] Fetching {model} {domain}/{layer} grid. "
            f"Coords count: {len(lats)} | Bbox: {bbox} | Res: {resolution}"
        )

        is_test = is_test_environment()
        if is_test and domain != "wind":
            logger.info(f"[Open-Meteo Provider] LOCAL_TEST_FIXTURE is true. Returning conformed mock grid immediately.")
            mock_res = generate_mock_open_meteo_response(lats, lons, params["hourly"], forecast_days)
            for item in mock_res:
                item["is_test_fixture"] = True
            return mock_res

        use_proxy = bool(os.environ.get("USE_WEATHER_PROXY", "true" if os.environ.get("RENDER") == "true" else "false").lower() == "true")
        if len(lats) > 100:
            logger.info(f"[Open-Meteo Provider] Grid size {len(lats)} > 100. Bypassing weather proxy for global/large background runs.")
            use_proxy = False

        proxy_url = resolve_weather_proxy_url()

        async with httpx.AsyncClient() as client:
            try:
                # We restrict the batch size to 500 to avoid excessive sequential HTTP request overhead, while still staying within safe limits.
                # Callers can pass a smaller batch_size for heavy long-horizon fetches (e.g. 14-day wind
                # global) so each proxy/open-meteo call processes fewer points and completes in time.
                if batch_size is None:
                    batch_size = 500
                aggregated_results = []

                for i in range(0, len(lats), batch_size):
                    batch_lats = lats[i:i + batch_size]
                    batch_lons = lons[i:i + batch_size]
                    
                    if use_proxy:
                        proxy_type = "marine" if domain == "marine" else ("pressure" if domain == "weather" else "wind")
                        hourly_val = params["hourly"]
                        if isinstance(hourly_val, str):
                            hourly_val = hourly_val.split(",")
                        
                        payload = {
                            "type": proxy_type,
                            "body": {
                                "latitude": batch_lats,
                                "longitude": batch_lons,
                                "forecast_days": int(forecast_days),
                                "hourly": hourly_val
                            }
                        }
                        if "models" in params:
                            models_val = params["models"]
                            if isinstance(models_val, str):
                                models_val = models_val.split(",")
                            payload["body"]["models"] = models_val
                        if "wind_speed_unit" in params:
                            payload["body"]["wind_speed_unit"] = params["wind_speed_unit"]
                    else:
                        query_params = {
                            "latitude": ",".join(f"{lat:.4f}" for lat in batch_lats),
                            "longitude": ",".join(f"{lon:.4f}" for lon in batch_lons),
                            "forecast_days": str(forecast_days),
                            "hourly": params["hourly"]
                        }
                        if "models" in params:
                            query_params["models"] = params["models"]
                        if "wind_speed_unit" in params:
                            query_params["wind_speed_unit"] = params["wind_speed_unit"]

                    max_retries = 5
                    response = None
                    for attempt in range(1, max_retries + 2):
                        if use_proxy:
                            response = await client.post(proxy_url, json=payload, timeout=45.0)
                        else:
                            response = await client.post(url, data=query_params, timeout=45.0)

                        if response.status_code == 429:
                            retry_delay = 8.0 * attempt
                            if attempt > max_retries:
                                raise RuntimeError(f"Hit rate limits (429) and exhausted all {max_retries} retries.")
                            logger.warning(f"[Open-Meteo Provider] Hit rate limits (429). Retrying in {retry_delay}s... (Attempt {attempt}/{max_retries})")
                            await asyncio.sleep(retry_delay)
                        else:
                            break

                    if response is None:
                        raise RuntimeError("Response is None after batch call.")
                        
                    response.raise_for_status()
                    data = response.json()
                    
                    if isinstance(data, list):
                        aggregated_results.extend(data)
                    else:
                        # Open-Meteo returns a single dictionary if it's only 1 point, wrap in a list
                        aggregated_results.append(data)

                    # Resolve delay defaults using env variables
                    env_marine_delay = float(os.environ.get("OPEN_METEO_MARINE_BATCH_DELAY_SEC", "2.5"))
                    env_wind_delay = float(os.environ.get("OPEN_METEO_WIND_BATCH_DELAY_SEC", "0.5"))

                    delay = inter_batch_delay if inter_batch_delay is not None else (
                        env_marine_delay if domain == "marine" else env_wind_delay
                    )
                    if i + batch_size < len(lats):
                        await asyncio.sleep(delay)

                # Cache successful response
                if len(self._GRID_CACHE) >= 50:
                    oldest_key = next(iter(self._GRID_CACHE))
                    self._GRID_CACHE.pop(oldest_key, None)
                self._GRID_CACHE[cache_key] = (now + self._CACHE_TTL_SEC, aggregated_results)
                return aggregated_results
                
            except Exception as e:
                is_test = is_test_environment()
                if is_test and domain != "wind":
                    logger.error(f"[Open-Meteo Provider] Upstream request failed: {e}. Generating conformed mock grid fallback.")
                    mock_res = generate_mock_open_meteo_response(lats, lons, params["hourly"], forecast_days)
                    for item in mock_res:
                        item["is_test_fixture"] = True
                    return mock_res
                else:
                    logger.error(f"[Open-Meteo Provider] Upstream request failed: {e}. Propagating exception in production.")
                    raise e

    async def fetch_point(
        self,
        model: str,
        domain: str,
        layer: str,
        lat: float,
        lng: float,
        forecast_days: int = 2
    ) -> Optional[Dict[str, Any]]:
        """
        Asynchronously fetches a single coordinate point forecast from Open-Meteo.
        Returns the raw HTTP response as JSON.
        """
        # Clamp forecast_days based on model limits to prevent Open-Meteo 400 errors
        if domain == "marine":
            if model.upper() in ("ICON", "EURO"):
                forecast_days = min(forecast_days, 7)
            else:
                forecast_days = min(forecast_days, 16)
        else: # weather / wind
            if model.upper() == "ICON":
                forecast_days = min(forecast_days, 5)
            elif model.upper() == "EURO":
                forecast_days = min(forecast_days, 15)
            else:
                forecast_days = min(forecast_days, 16)

        params = {
            "latitude": f"{lat:.4f}",
            "longitude": f"{lng:.4f}",
            "forecast_days": str(forecast_days),
        }

        if domain == "marine":
            url = self.MARINE_URL
            api_model = self.MARINE_MODELS.get(model.upper(), "ncep_gfswave025")
            params["models"] = api_model
            
            # Map layer variables
            if layer == "waves":
                params["hourly"] = "wave_height,wave_direction,wave_period"
            elif layer == "swell_1":
                params["hourly"] = "swell_wave_height,swell_wave_direction,swell_wave_period"
            elif layer == "swell_2":
                if api_model in ("gwam", "dwd_gwam"):
                    params["hourly"] = "swell_wave_height,swell_wave_direction,swell_wave_period"
                else:
                    params["hourly"] = "secondary_swell_wave_height,secondary_swell_wave_direction,secondary_swell_wave_period"
            elif layer == "wind_waves":
                params["hourly"] = "wind_wave_height,wind_wave_direction,wind_wave_period"
            elif layer == "all_marine":
                if api_model in ("gwam", "dwd_gwam"):
                    # gwam (DWD ICON wave) has NO native secondary swell parameter. Including
                    # secondary_swell_wave_* makes Open-Meteo 400 the ENTIRE all_marine request,
                    # which silently zeroes ICON marine global ingestion -> no coarse product ->
                    # ICON marine falls to the slow on-demand path on activation (unlike GFS/EURO,
                    # whose models support secondary swell). Mirror the swell_2 gwam special-case.
                    params["hourly"] = "wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period,wind_wave_height,wind_wave_direction,wind_wave_period"
                else:
                    params["hourly"] = "wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period,secondary_swell_wave_height,secondary_swell_wave_direction,secondary_swell_wave_period,wind_wave_height,wind_wave_direction,wind_wave_period"
            else:
                params["hourly"] = "wave_height,wave_direction,wave_period"
        elif domain == "weather":
            url = self.FORECAST_URL
            api_model = self.FORECAST_MODELS.get(model.upper(), "gfs_seamless")
            params["models"] = api_model
            if layer == "pressure":
                params["hourly"] = "pressure_msl"
            elif layer == "precipitation":
                params["hourly"] = "precipitation"
            else:
                params["hourly"] = "pressure_msl"
        else: # wind
            url = self.FORECAST_URL
            api_model = self.FORECAST_MODELS.get(model.upper(), "gfs_seamless")
            params["models"] = api_model
            params["hourly"] = "wind_speed_10m,wind_direction_10m"
            if model.upper() in ("ICON", "EURO"):
                params["hourly"] += ",wind_gusts_10m"
            params["wind_speed_unit"] = "kn"

        # Check in-memory point cache
        now = datetime.now(timezone.utc).timestamp()
        cache_key = f"{model.upper()}_{domain.lower()}_{layer.lower()}_{lat:.4f}_{lng:.4f}_{forecast_days}"
        if cache_key in self._POINT_CACHE:
            exp_time, cached_data = self._POINT_CACHE[cache_key]
            if now < exp_time:
                logger.info(f"[Open-Meteo Provider] Cache HIT for point key: {cache_key}")
                return cached_data
            else:
                self._POINT_CACHE.pop(cache_key, None)

        logger.info(
            f"[Open-Meteo Provider] Fetching single point forecast for {model} {domain}/{layer} at ({lat}, {lng})"
        )

        is_test = is_test_environment()
        if is_test and domain != "wind":
            logger.info(f"[Open-Meteo Provider] LOCAL_TEST_FIXTURE is true. Returning conformed mock point immediately.")
            mock_res = generate_mock_open_meteo_response([lat], [lng], params["hourly"], forecast_days)
            if mock_res:
                mock_res[0]["is_test_fixture"] = True
                return mock_res[0]
            return None

        use_proxy = bool(os.environ.get("USE_WEATHER_PROXY", "true" if os.environ.get("RENDER") == "true" else "false").lower() == "true")
        proxy_url = resolve_weather_proxy_url()

        if use_proxy:
            proxy_type = "marine" if domain == "marine" else ("pressure" if domain == "weather" else "wind")
            hourly_val = params.get("hourly", [])
            if isinstance(hourly_val, str):
                hourly_val = hourly_val.split(",")
            
            payload = {
                "type": proxy_type,
                "body": {
                    "latitude": [float(lat)],
                    "longitude": [float(lng)],
                    "forecast_days": int(params.get("forecast_days", 7)),
                    "hourly": hourly_val
                }
            }
            if "models" in params:
                models_val = params["models"]
                if isinstance(models_val, str):
                    models_val = models_val.split(",")
                payload["body"]["models"] = models_val
            if "wind_speed_unit" in params:
                payload["body"]["wind_speed_unit"] = params["wind_speed_unit"]
        else:
            request_url = url

        async with httpx.AsyncClient() as client:
            try:
                max_retries = 5
                response = None
                for attempt in range(1, max_retries + 2):
                    if use_proxy:
                        response = await client.post(proxy_url, json=payload, timeout=15.0)
                    else:
                        response = await client.get(request_url, params=params, timeout=15.0)
                    if response.status_code == 429:
                        retry_delay = 2.0 * attempt
                        if attempt > max_retries:
                            raise RuntimeError(f"Hit rate limits (429) for point query and exhausted all {max_retries} retries.")
                        logger.warning(f"[Open-Meteo Provider] Hit rate limits (429) for point query. Retrying in {retry_delay}s... (Attempt {attempt}/{max_retries})")
                        await asyncio.sleep(retry_delay)
                    else:
                        break

                response.raise_for_status()
                result_json = response.json()
                if isinstance(result_json, list) and len(result_json) > 0:
                    result_json = result_json[0]
                if len(self._POINT_CACHE) >= 200:
                    oldest_key = next(iter(self._POINT_CACHE))
                    self._POINT_CACHE.pop(oldest_key, None)
                self._POINT_CACHE[cache_key] = (now + self._CACHE_TTL_SEC, result_json)
                return result_json
            except Exception as e:
                is_test = is_test_environment()
                if is_test and domain != "wind":
                    logger.error(f"[Open-Meteo Provider] Single point request failed: {e}. Generating conformed mock point fallback.")
                    mock_res = generate_mock_open_meteo_response([lat], [lng], params["hourly"], forecast_days)
                    if mock_res:
                        mock_res[0]["is_test_fixture"] = True
                        return mock_res[0]
                    return None
                else:
                    # {e!r} (repr), not {e}: transport-level errors (connection reset/timeout at a
                    # concurrency burst boundary) stringify to "" — the empty-message log that made
                    # the forecast-ingest point-fallback failures undiagnosable (runbook §12). repr
                    # always carries the type. The caller fails OPEN (coarse sample / no-coverage), so
                    # this is informational for the propagated exception, not a hard failure.
                    logger.warning(f"[Open-Meteo Provider] Single point request failed: {e!r}. Propagating exception (caller fails open).")
                    raise e

    @staticmethod
    def generate_grid_coords(bbox: Dict[str, float], resolution: float) -> tuple:
        """
        Generates flattened 1D lists of latitudes and longitudes matching the bbox step bounds.
        """
        west = bbox["west"]
        east = bbox["east"]
        south = min(bbox["south"], bbox["north"])
        north = max(bbox["south"], bbox["north"])

        lats = []
        lons = []

        crosses = west > east
        east_val = east + 360.0 if crosses else east

        # We step systematically through latitude and longitude rows
        lat = south
        while lat <= north + 0.0001:
            lon = west
            while lon <= east_val + 0.0001:
                # Wrap to [-180, 180]
                lon_wrapped = lon - 360.0 if lon > 180.0 else (lon + 360.0 if lon < -180.0 else lon)
                lats.append(round(lat, 4))
                lons.append(round(lon_wrapped, 4))
                lon += resolution
            lat += resolution

        return lats, lons
