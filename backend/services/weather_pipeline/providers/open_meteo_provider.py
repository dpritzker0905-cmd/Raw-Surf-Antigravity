import httpx
import logging
import asyncio
from typing import Dict, List, Any, Optional

logger = logging.getLogger(__name__)

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
        forecast_days: int = 2
    ) -> Optional[Dict[str, Any]]:
        """
        Asynchronously fetches a coordinate snap-grid from Open-Meteo.
        Returns the raw HTTP response as JSON.
        """
        # Generate grid points
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
                    
                    if "models" in params:
                        query_params["models"] = params["models"]
                    if "wind_speed_unit" in params:
                        query_params["wind_speed_unit"] = params["wind_speed_unit"]

                    max_retries = 3
                    response = None
                    for attempt in range(1, max_retries + 2):
                        response = await client.get(url, params=query_params, timeout=45.0)
                        if response.status_code == 429:
                            retry_delay = 12.0 * attempt
                            if attempt > max_retries:
                                logger.warning(f"[Open-Meteo Provider] Hit rate limits (429) and exhausted all {max_retries} retries.")
                                return None
                            logger.warning(f"[Open-Meteo Provider] Hit rate limits (429). Retrying in {retry_delay}s... (Attempt {attempt}/{max_retries})")
                            await asyncio.sleep(retry_delay)
                        else:
                            break

                    if response is None:
                        logger.error("[Open-Meteo Provider] Response is None after batch call.")
                        return None
                        
                    response.raise_for_status()
                    data = response.json()
                    
                    if isinstance(data, list):
                        aggregated_results.extend(data)
                    else:
                        # Open-Meteo returns a single dictionary if it's only 1 point, wrap in a list
                        aggregated_results.append(data)

                    # Increase delay to 1.2s to fully respect Open-Meteo rate limits during background ingestion
                    # For wind grids, increase the delay to 2.5s to be safe
                    delay = 2.5 if domain == "wind" else 1.2
                    if i + batch_size < len(lats):
                        await asyncio.sleep(delay)

                return aggregated_results
                
            except Exception as e:
                logger.error(f"[Open-Meteo Provider] Upstream request failed: {e}")
                return None

    @staticmethod
    def generate_grid_coords(bbox: Dict[str, float], resolution: float) -> tuple:
        """
        Generates flattened 1D lists of latitudes and longitudes matching the bbox step bounds.
        """
        west = min(bbox["west"], bbox["east"])
        east = max(bbox["west"], bbox["east"])
        south = min(bbox["south"], bbox["north"])
        north = max(bbox["south"], bbox["north"])

        lats = []
        lons = []

        # We step systematically through latitude and longitude rows
        lat = south
        while lat <= north + 0.0001:
            lon = west
            while lon <= east + 0.0001:
                lats.append(round(lat, 4))
                lons.append(round(lon, 4))
                lon += resolution
            lat += resolution

        return lats, lons
