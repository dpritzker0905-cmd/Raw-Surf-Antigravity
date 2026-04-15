"""
Surf Conditions Service - Auto-pull from Open-Meteo Marine Weather API + NOAA Tides
Provides wave height, period, wind speed, direction, and tide data
"""

import httpx
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any, List
import logging

logger = logging.getLogger(__name__)

OPEN_METEO_MARINE_API = "https://marine-api.open-meteo.com/v1/marine"
NOAA_TIDES_API = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter"

# Known surf spots with coordinates and nearest NOAA tide station
# NOAA station IDs from: https://tidesandcurrents.noaa.gov/map/
SPOT_COORDINATES = {
    "pipeline": {"lat": 21.6651, "lon": -158.0534, "name": "Pipeline, Oahu", "noaa_station": "1612340"},
    "mavericks": {"lat": 37.4952, "lon": -122.4984, "name": "Mavericks, CA", "noaa_station": "9414290"},
    "rincon": {"lat": 34.3723, "lon": -119.4766, "name": "Rincon, CA", "noaa_station": "9411340"},
    "huntington": {"lat": 33.6559, "lon": -117.9989, "name": "Huntington Beach, CA", "noaa_station": "9410660"},
    "jaws": {"lat": 20.9417, "lon": -156.2983, "name": "Jaws, Maui", "noaa_station": "1615680"},
    "trestles": {"lat": 33.3836, "lon": -117.5895, "name": "Trestles, CA", "noaa_station": "9410660"},
    "nazare": {"lat": 39.6026, "lon": -9.0711, "name": "Nazaré, Portugal", "noaa_station": None},
    "teahupoo": {"lat": -17.8667, "lon": -149.2667, "name": "Teahupo'o, Tahiti", "noaa_station": None},
    "mundaka": {"lat": 43.4098, "lon": -2.6958, "name": "Mundaka, Spain", "noaa_station": None},
    "gold_coast": {"lat": -28.0167, "lon": 153.4333, "name": "Gold Coast, Australia", "noaa_station": None},
    "bells": {"lat": -38.3698, "lon": 144.2788, "name": "Bells Beach, Australia", "noaa_station": None},
    "jeffreys": {"lat": -34.0339, "lon": 24.9273, "name": "Jeffreys Bay, South Africa", "noaa_station": None},
    "newquay": {"lat": 50.4148, "lon": -5.0764, "name": "Newquay, UK", "noaa_station": None},
    "biarritz": {"lat": 43.4832, "lon": -1.5586, "name": "Biarritz, France", "noaa_station": None},
    "hossegor": {"lat": 43.6672, "lon": -1.4311, "name": "Hossegor, France", "noaa_station": None},
    "sebastian": {"lat": 27.8120, "lon": -80.4506, "name": "Sebastian Inlet, FL", "noaa_station": "8721604"},
    "cocoa": {"lat": 28.3658, "lon": -80.6070, "name": "Cocoa Beach, FL", "noaa_station": "8721604"},
    "volusia": {"lat": 29.2108, "lon": -81.0228, "name": "Volusia County, FL", "noaa_station": "8720218"},
    "new_smyrna": {"lat": 29.0258, "lon": -80.9278, "name": "New Smyrna Beach, FL", "noaa_station": "8721120"},
    "jacksonville": {"lat": 30.2895, "lon": -81.3969, "name": "Jacksonville Beach, FL", "noaa_station": "8720218"},
    "outer_banks": {"lat": 35.5635, "lon": -75.4699, "name": "Outer Banks, NC", "noaa_station": "8651370"},
    "wrightsville": {"lat": 34.2104, "lon": -77.7905, "name": "Wrightsville Beach, NC", "noaa_station": "8658163"},
    "myrtle": {"lat": 33.6891, "lon": -78.8867, "name": "Myrtle Beach, SC", "noaa_station": "8661070"},
    "folly": {"lat": 32.6552, "lon": -79.9403, "name": "Folly Beach, SC", "noaa_station": "8665530"},
    "galveston": {"lat": 29.2872, "lon": -94.7847, "name": "Galveston, TX", "noaa_station": "8771450"},
    "south_padre": {"lat": 26.1118, "lon": -97.1686, "name": "South Padre Island, TX", "noaa_station": "8779770"},
    "puerto_escondido": {"lat": 15.8616, "lon": -97.0729, "name": "Puerto Escondido, Mexico", "noaa_station": None},
    "cabo": {"lat": 22.8905, "lon": -109.9167, "name": "Cabo San Lucas, Mexico", "noaa_station": None},
    "sayulita": {"lat": 20.8690, "lon": -105.4407, "name": "Sayulita, Mexico", "noaa_station": None},
}


def meters_to_feet(meters: float) -> float:
    """Convert meters to feet"""
    return round(meters * 3.28084, 1)


def mps_to_mph(mps: float) -> float:
    """Convert meters per second to miles per hour"""
    return round(mps * 2.237, 1)


def degrees_to_direction(degrees: float) -> str:
    """Convert wind/wave direction in degrees to compass direction"""
    directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
    index = round(degrees / 45) % 8
    return directions[index]


async def get_noaa_tide_data(
    station_id: str,
    target_datetime: Optional[datetime] = None
) -> Dict[str, Any]:
    """
    Fetch tide predictions from NOAA Tides and Currents API
    
    Args:
        station_id: NOAA tide station ID
        target_datetime: Optional specific datetime (defaults to current)
    
    Returns:
        Dictionary with tide_height_ft, tide_status, next_high, next_low
    """
    if not station_id:
        return {"source": "error", "error": "No NOAA station for this location"}
    
    if target_datetime is None:
        target_datetime = datetime.now(timezone.utc)
    
    # Get predictions for today
    date_str = target_datetime.strftime("%Y%m%d")
    
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            # Get high/low tide predictions
            response = await client.get(
                NOAA_TIDES_API,
                params={
                    "station": station_id,
                    "product": "predictions",
                    "datum": "MLLW",  # Mean Lower Low Water
                    "units": "english",
                    "time_zone": "gmt",
                    "application": "RawSurfOS",
                    "format": "json",
                    "begin_date": date_str,
                    "end_date": date_str,
                    "interval": "hilo"  # High/Low only
                }
            )
            
            if response.status_code != 200:
                logger.warning(f"NOAA API error: {response.status_code}")
                return {"source": "error", "error": f"NOAA API returned {response.status_code}"}
            
            data = response.json()
            predictions = data.get("predictions", [])
            
            if not predictions:
                return {"source": "noaa", "tide_status": "unknown"}
            
            result = {
                "source": "noaa",
                "station_id": station_id
            }
            
            # Parse predictions to find current tide status
            now = target_datetime
            prev_tide = None
            next_tide = None
            
            for pred in predictions:
                try:
                    pred_time = datetime.strptime(pred["t"], "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)
                    pred_type = pred.get("type", "").upper()  # "H" for high, "L" for low
                    pred_height = float(pred.get("v", 0))
                    
                    if pred_time <= now:
                        prev_tide = {"time": pred_time, "type": pred_type, "height": pred_height}
                    elif next_tide is None:
                        next_tide = {"time": pred_time, "type": pred_type, "height": pred_height}
                        break
                except (ValueError, KeyError):
                    continue
            
            # Determine tide status
            if prev_tide and next_tide:
                if prev_tide["type"] == "L" and next_tide["type"] == "H":
                    result["tide_status"] = "Rising"
                elif prev_tide["type"] == "H" and next_tide["type"] == "L":
                    result["tide_status"] = "Falling"
                elif prev_tide["type"] == "H":
                    result["tide_status"] = "High"
                else:
                    result["tide_status"] = "Low"
                
                # Interpolate current tide height
                if prev_tide and next_tide:
                    total_duration = (next_tide["time"] - prev_tide["time"]).total_seconds()
                    elapsed = (now - prev_tide["time"]).total_seconds()
                    if total_duration > 0:
                        progress = elapsed / total_duration
                        height_diff = next_tide["height"] - prev_tide["height"]
                        current_height = prev_tide["height"] + (height_diff * progress)
                        result["tide_height_ft"] = round(current_height, 1)
                
                # Add next high/low info
                if next_tide["type"] == "H":
                    result["next_high"] = next_tide["time"].isoformat()
                    result["next_high_height"] = next_tide["height"]
                else:
                    result["next_low"] = next_tide["time"].isoformat()
                    result["next_low_height"] = next_tide["height"]
            
            elif prev_tide:
                result["tide_status"] = "High" if prev_tide["type"] == "H" else "Low"
                result["tide_height_ft"] = prev_tide["height"]
            
            return result
            
    except httpx.TimeoutException:
        logger.warning("NOAA API timeout")
        return {"source": "error", "error": "NOAA API timeout"}
    except Exception as e:
        logger.error(f"Error fetching tide data: {e}")
        return {"source": "error", "error": str(e)}


async def get_surf_conditions(
    latitude: float, 
    longitude: float, 
    target_datetime: Optional[datetime] = None
) -> Dict[str, Any]:
    """
    Fetch surf conditions from Open-Meteo Marine API
    
    Args:
        latitude: Spot latitude
        longitude: Spot longitude
        target_datetime: Optional specific datetime (defaults to current)
    
    Returns:
        Dictionary with wave_height_ft, wave_period_sec, wind_speed_mph, 
        wind_direction, and source
    """
    if target_datetime is None:
        target_datetime = datetime.now(timezone.utc)
    
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                OPEN_METEO_MARINE_API,
                params={
                    "latitude": latitude,
                    "longitude": longitude,
                    "hourly": [
                        "wave_height",
                        "wave_period", 
                        "wave_direction",
                        "wind_wave_height",
                        "swell_wave_height",
                        "swell_wave_period",
                    ],
                    "current": [
                        "wave_height",
                        "wave_period",
                        "wave_direction",
                    ],
                    "timezone": "UTC",
                    "forecast_days": 1
                }
            )
            
            if response.status_code != 200:
                logger.warning(f"Open-Meteo API error: {response.status_code}")
                return {"source": "error", "error": f"API returned {response.status_code}"}
            
            data = response.json()
            
            # Get current conditions if available
            current = data.get("current", {})
            
            wave_height_m = current.get("wave_height")
            wave_period = current.get("wave_period")
            wave_direction = current.get("wave_direction")
            
            # If no current data, try hourly
            if wave_height_m is None:
                hourly = data.get("hourly", {})
                times = hourly.get("time", [])
                heights = hourly.get("wave_height", [])
                periods = hourly.get("wave_period", [])
                directions = hourly.get("wave_direction", [])
                
                # Find closest hour
                if times and heights:
                    target_hour = target_datetime.strftime("%Y-%m-%dT%H:00")
                    for i, t in enumerate(times):
                        if t == target_hour:
                            wave_height_m = heights[i] if i < len(heights) else None
                            wave_period = periods[i] if i < len(periods) else None
                            wave_direction = directions[i] if i < len(directions) else None
                            break
                    
                    # If no exact match, use first available
                    if wave_height_m is None and heights:
                        wave_height_m = heights[0]
                        wave_period = periods[0] if periods else None
                        wave_direction = directions[0] if directions else None
            
            result = {
                "source": "open-meteo",
                "fetched_at": datetime.now(timezone.utc).isoformat()
            }
            
            if wave_height_m is not None:
                result["wave_height_ft"] = meters_to_feet(wave_height_m)
            
            if wave_period is not None:
                result["wave_period_sec"] = int(wave_period)
            
            if wave_direction is not None:
                result["wave_direction"] = degrees_to_direction(wave_direction)
                result["wave_direction_degrees"] = wave_direction  # Keep raw degrees for visualization
            
            return result
            
    except httpx.TimeoutException:
        logger.warning("Open-Meteo API timeout")
        return {"source": "error", "error": "API timeout"}
    except Exception as e:
        logger.error(f"Error fetching surf conditions: {e}")
        return {"source": "error", "error": str(e)}


async def get_conditions_for_spot(
    spot_name: str,
    target_datetime: Optional[datetime] = None
) -> Dict[str, Any]:
    """
    Get surf conditions for a known spot by name
    
    Args:
        spot_name: Name of the spot (e.g., "pipeline", "new_smyrna")
        target_datetime: Optional specific datetime
    
    Returns:
        Conditions dictionary with spot info
    """
    # Normalize spot name
    normalized = spot_name.lower().replace(" ", "_").replace("-", "_")
    
    # Try to find spot
    spot_info = SPOT_COORDINATES.get(normalized)
    
    if not spot_info:
        # Try partial match
        for key, info in SPOT_COORDINATES.items():
            if normalized in key or key in normalized:
                spot_info = info
                break
    
    if not spot_info:
        return {
            "source": "error",
            "error": f"Unknown spot: {spot_name}. Try providing coordinates."
        }
    
    # Get full conditions including tide
    conditions = await get_full_conditions(
        spot_info["lat"],
        spot_info["lon"],
        spot_info["name"],
        spot_info.get("noaa_station")
    )
    
    conditions["coordinates"] = {"lat": spot_info["lat"], "lon": spot_info["lon"]}
    
    return conditions


async def get_wind_conditions(
    latitude: float,
    longitude: float
) -> Dict[str, Any]:
    """
    Fetch wind conditions from Open-Meteo Weather API
    
    Args:
        latitude: Location latitude
        longitude: Location longitude
    
    Returns:
        Dictionary with wind_speed_mph, wind_direction
    """
    WEATHER_API = "https://api.open-meteo.com/v1/forecast"
    
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                WEATHER_API,
                params={
                    "latitude": latitude,
                    "longitude": longitude,
                    "current": ["wind_speed_10m", "wind_direction_10m"],
                    "timezone": "UTC"
                }
            )
            
            if response.status_code != 200:
                return {"source": "error", "error": f"API returned {response.status_code}"}
            
            data = response.json()
            current = data.get("current", {})
            
            result = {"source": "open-meteo-weather"}
            
            wind_speed = current.get("wind_speed_10m")
            wind_dir = current.get("wind_direction_10m")
            
            if wind_speed is not None:
                # Open-Meteo returns km/h, convert to mph
                result["wind_speed_mph"] = round(wind_speed * 0.621371, 1)
            
            if wind_dir is not None:
                result["wind_direction"] = degrees_to_direction(wind_dir)
            
            return result
            
    except Exception as e:
        logger.error(f"Error fetching wind conditions: {e}")
        return {"source": "error", "error": str(e)}


async def get_full_conditions(
    latitude: float,
    longitude: float,
    spot_name: Optional[str] = None,
    noaa_station: Optional[str] = None
) -> Dict[str, Any]:
    """
    Get combined surf, wind, and tide conditions
    
    Args:
        latitude: Location latitude
        longitude: Location longitude
        spot_name: Optional spot name for display
        noaa_station: Optional NOAA tide station ID
    
    Returns:
        Combined conditions dictionary
    """
    # Get surf conditions (wave data)
    surf = await get_surf_conditions(latitude, longitude)
    
    # Get wind conditions
    wind = await get_wind_conditions(latitude, longitude)
    
    # Get tide conditions (if NOAA station available)
    tide = {}
    if noaa_station:
        tide = await get_noaa_tide_data(noaa_station)
    
    # Merge results
    result = {
        "wave_height_ft": surf.get("wave_height_ft"),
        "wave_period_sec": surf.get("wave_period_sec"),
        "wave_direction": surf.get("wave_direction"),
        "wave_direction_degrees": surf.get("wave_direction_degrees"),  # Keep raw degrees for visualization
        "wind_speed_mph": wind.get("wind_speed_mph"),
        "wind_direction": wind.get("wind_direction"),
        "tide_height_ft": tide.get("tide_height_ft"),
        "tide_status": tide.get("tide_status"),
        "next_high": tide.get("next_high"),
        "next_low": tide.get("next_low"),
        "source": "auto",
        "tide_source": "noaa" if tide.get("source") == "noaa" else None,
        "fetched_at": datetime.now(timezone.utc).isoformat()
    }
    
    if spot_name:
        result["spot_name"] = spot_name
    
    # Remove None values
    result = {k: v for k, v in result.items() if v is not None}
    
    return result
