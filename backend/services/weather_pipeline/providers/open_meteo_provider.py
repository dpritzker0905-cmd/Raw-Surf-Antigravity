import os
import httpx
import logging
import asyncio
from typing import Dict, List, Any, Optional
import math
from datetime import datetime, timezone, timedelta

logger = logging.getLogger(__name__)

def is_test_environment() -> bool:
    import os
    node_env = os.environ.get("NODE_ENV", "").lower()
    env = os.environ.get("ENV", "").lower()
    is_prod_env = os.environ.get("IS_PROD", "").lower()
    
    if node_env == "production" or env == "production" or is_prod_env == "true":
        return False
        
    return (
        os.environ.get("NODE_ENV") == "test"
        or os.environ.get("LOCAL_TEST_FIXTURE") == "true"
        or os.environ.get("TESTING") == "1"
    )

def generate_mock_open_meteo_response(lats: list, lons: list, hourly_vars_str: str, forecast_days: int) -> list:
    # Generate times: hourly for forecast_days
    start_time = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0) - timedelta(days=1)
    hours_count = forecast_days * 24
    time_strings = [(start_time + timedelta(hours=h)).strftime("%Y-%m-%dT%H:00Z") for h in range(hours_count)]
    
    variables = hourly_vars_str.split(",")
    
    results = []
    for lat, lon in zip(lats, lons):
        # Generate mock values for this point
        hourly_data = {
            "time": time_strings
        }
        
        # Smooth spatial variations using trigonometry
        lat_rad = math.radians(lat)
        lon_rad = math.radians(lon)
        
        for var in variables:
            values = []
            for h in range(hours_count):
                t_factor = math.sin(h / 6.0)
                if "height" in var or "swell" in var:
                    val = 1.2 + 0.4 * math.sin(lat_rad * 3 + lon_rad * 2) + 0.2 * t_factor
                elif "speed" in var or "wind" in var:
                    val = 15.0 + 5.0 * math.sin(lat_rad * 2 - lon_rad * 3) + 3.0 * t_factor
                elif "direction" in var:
                    val = 180.0 + 45.0 * math.cos(lat_rad + lon_rad) + 10.0 * t_factor
                elif "period" in var:
                    val = 7.0 + 2.0 * math.sin(lat_rad - lon_rad) + 1.0 * t_factor
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

class OpenMeteoProvider:
    """
    Open-Meteo API provider for the Weather Ingestion Pipeline.
    Fetches GFS and ICON grids for both Marine (wave heights, swells, wind waves)
    and Wind (velocity, direction) domains.
    """
    MARINE_URL = "https://marine-api.open-meteo.com/v1/marine"
    FORECAST_URL = "https://api.open-meteo.com/v1/forecast"

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
        inter_batch_delay: Optional[float] = None
    ) -> Optional[Dict[str, Any]]:
        """
        Asynchronously fetches a coordinate snap-grid from Open-Meteo.
        Returns the raw HTTP response as JSON.
        """
        # Generate grid points
        if precomputed_coords is not None:
            lats, lons = precomputed_coords
        else:
            lats, lons = self.generate_grid_coords(bbox, resolution)
        if not lats:
            logger.error(f"[Open-Meteo Provider] Generated empty grid for bbox: {bbox}")
            return None

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
            if layer == "waves":
                params["hourly"] = "wave_height,wave_direction,wave_period"
            elif layer == "swell_1":
                params["hourly"] = "swell_wave_height,swell_wave_direction,swell_wave_period"
            elif layer == "swell_2":
                if api_model == "gwam":
                    # ICON swell_2 doesn't have native secondary swell in gwam, fallback to swell
                    params["hourly"] = "swell_wave_height,swell_wave_direction,swell_wave_period"
                else:
                    params["hourly"] = "secondary_swell_wave_height,secondary_swell_wave_direction,secondary_swell_wave_period"
            elif layer == "wind_waves":
                params["hourly"] = "wind_wave_height,wind_wave_direction,wind_wave_period"
            elif layer == "all_marine":
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
        if is_test:
            logger.info(f"[Open-Meteo Provider] LOCAL_TEST_FIXTURE is true. Returning conformed mock grid immediately.")
            mock_res = generate_mock_open_meteo_response(lats, lons, params["hourly"], forecast_days)
            for item in mock_res:
                item["is_test_fixture"] = True
            return mock_res

        use_proxy = bool(os.environ.get("USE_WEATHER_PROXY", "false").lower() == "true")
        proxy_url = os.environ.get("WEATHER_PROXY_URL", "https://dev--rawsurf.netlify.app/api/weather-proxy")

        async with httpx.AsyncClient() as client:
            try:
                # Coordinate batch chunking of size 100 to prevent HTTP 414 URI Too Long errors on large grids
                batch_size = 100
                aggregated_results = []

                for i in range(0, len(lats), batch_size):
                    batch_lats = lats[i:i + batch_size]
                    batch_lons = lons[i:i + batch_size]
                    
                    query_params = {
                        "latitude": ",".join(f"{lat:.4f}" for lat in batch_lats),
                        "longitude": ",".join(f"{lon:.4f}" for lon in batch_lons),
                        "forecast_days": str(forecast_days),
                        "hourly": params["hourly"]
                    }
                    
                    if use_proxy:
                        query_params["type"] = "marine" if domain == "marine" else ("pressure" if domain == "weather" else "wind")
                        request_url = proxy_url
                    else:
                        request_url = url
                        if "models" in params:
                            query_params["models"] = params["models"]
                        if "wind_speed_unit" in params:
                            query_params["wind_speed_unit"] = params["wind_speed_unit"]

                    max_retries = 3
                    response = None
                    for attempt in range(1, max_retries + 2):
                        response = await client.get(request_url, params=query_params, timeout=45.0)
                        if response.status_code == 429:
                            retry_delay = 12.0 * attempt
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

                    # Increase delay to 1.2s to fully respect Open-Meteo rate limits during background ingestion
                    # For wind grids, increase the delay to 2.5s to be safe
                    delay = inter_batch_delay if inter_batch_delay is not None else (2.5 if domain == "wind" else 1.2)
                    if i + batch_size < len(lats):
                        await asyncio.sleep(delay)

                return aggregated_results
                
            except Exception as e:
                is_test = is_test_environment()
                if is_test:
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
                forecast_days = min(forecast_days, 7)
            elif model.upper() == "EURO":
                forecast_days = min(forecast_days, 10)
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
                if api_model == "gwam":
                    params["hourly"] = "swell_wave_height,swell_wave_direction,swell_wave_period"
                else:
                    params["hourly"] = "secondary_swell_wave_height,secondary_swell_wave_direction,secondary_swell_wave_period"
            elif layer == "wind_waves":
                params["hourly"] = "wind_wave_height,wind_wave_direction,wind_wave_period"
            elif layer == "all_marine":
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

        logger.info(
            f"[Open-Meteo Provider] Fetching single point forecast for {model} {domain}/{layer} at ({lat}, {lng})"
        )

        is_test = is_test_environment()
        if is_test:
            logger.info(f"[Open-Meteo Provider] LOCAL_TEST_FIXTURE is true. Returning conformed mock point immediately.")
            mock_res = generate_mock_open_meteo_response([lat], [lng], params["hourly"], forecast_days)
            if mock_res:
                mock_res[0]["is_test_fixture"] = True
                return mock_res[0]
            return None

        use_proxy = bool(os.environ.get("USE_WEATHER_PROXY", "false").lower() == "true")
        proxy_url = os.environ.get("WEATHER_PROXY_URL", "https://dev--rawsurf.netlify.app/api/weather-proxy")

        if use_proxy:
            params["type"] = "marine" if domain == "marine" else ("pressure" if domain == "weather" else "wind")
            request_url = proxy_url
        else:
            request_url = url

        async with httpx.AsyncClient() as client:
            try:
                response = await client.get(request_url, params=params, timeout=15.0)
                response.raise_for_status()
                return response.json()
            except Exception as e:
                is_test = is_test_environment()
                if is_test:
                    logger.error(f"[Open-Meteo Provider] Single point request failed: {e}. Generating conformed mock point fallback.")
                    mock_res = generate_mock_open_meteo_response([lat], [lng], params["hourly"], forecast_days)
                    if mock_res:
                        mock_res[0]["is_test_fixture"] = True
                        return mock_res[0]
                    return None
                else:
                    logger.error(f"[Open-Meteo Provider] Single point request failed: {e}. Propagating exception in production.")
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
