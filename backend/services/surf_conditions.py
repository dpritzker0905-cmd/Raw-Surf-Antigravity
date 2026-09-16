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


def _breaking_ft(lat, lng, offshore_m, period_s, swell_from_deg):
    """Offshore Hs -> BREAKING height in feet, through the production chain.

    ⚠️⚠️ THIS MODULE SERVED THE OFFSHORE NUMBER AS THE SURF, AND THAT IS THE DEFECT CLAUDE.md WAS
    WRITTEN TO PREVENT. `/api/surf-conditions` fetched open-meteo marine directly and put
    `wave_height` — the OFFSHORE significant wave height — into `wave_height_ft`, never calling
    `resolve_surf_geometry` + `estimate_surf_at`. That is a FOURTH forecast path, and it auto-fills
    the session form in the post composer, so a surfer's own report was stamped with it.

    Measured 2026-08-01 at 1.8 m / 13 s across this module's own 29 SPOT_COORDINATES, offshore vs
    breaking at the same coordinate — SIGNED BOTH WAYS, which is why no constant can correct it:

        pipeline    5.9 ft offshore ->  9.0 ft breaking   -34.1%   (deep water, shoaling)
        teahupoo    5.9 ft          ->  9.0 ft            -34.1%
        jeffreys    5.9 ft          ->  8.5 ft            -30.2%
        galveston   5.9 ft          ->  4.6 ft            +29.7%   (166 km shelf, 16 m — friction)
        myrtle      5.9 ft          ->  4.9 ft            +21.5%

    24 of 29 read LOW (steep/deep coasts jack up), 5 read HIGH (wide shallow shelves bleed energy).

    ★ MIRRORS `spot_conditions._breaking_ft` (`902f47a9`, the same fix at the spot hub) rather than
    re-deriving it — CLAUDE.md: mirror the reference, never re-derive. Same signature shape, same
    fail-open contract, same `(value, source)` provenance tuple.

    Fails OPEN to the offshore value: an endpoint that shows a slightly wrong number is worth more
    than one that shows nothing, and this is an enrichment of an already-working read. No I/O — the
    transform is arithmetic over the bundled bathymetry."""
    if not offshore_m:
        return 0.0, "calm"
    try:
        from services.weather_pipeline.surf_point import estimate_surf_at
        breaking_m, regime = estimate_surf_at(
            lat, lng, offshore_m, period_s or 0.0, swell_from_deg=swell_from_deg)
        if breaking_m is not None:
            return round(breaking_m * 3.28084, 1), regime
    except Exception as e:
        logger.debug(f"[surf-conditions] surf transform failed at ({lat},{lng}): {e}")
    return round(offshore_m * 3.28084, 1), "offshore_estimate"


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
    target_datetime = (target_datetime.replace(tzinfo=timezone.utc) if target_datetime.tzinfo is None
                       else target_datetime.astimezone(timezone.utc))
    # Include adjacent days so midnight has both surrounding extrema in UTC.
    begin_date = (target_datetime - timedelta(days=1)).strftime("%Y%m%d")
    end_date = (target_datetime + timedelta(days=1)).strftime("%Y%m%d")
    
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
                    "begin_date": begin_date,
                    "end_date": end_date,
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
                "station_id": station_id,
                "tide_status": "unknown",
                "tide_datum": "MLLW",
                "tide_method": "linear_hilo_estimate"
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
            
            elif prev_tide and prev_tide["time"] == now:
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
    explicit_target = target_datetime is not None
    if target_datetime is None:
        target_datetime = datetime.now(timezone.utc)
    # The provider is queried in UTC. Naive caller timestamps retain the historical UTC convention.
    target_datetime = (target_datetime.replace(tzinfo=timezone.utc) if target_datetime.tzinfo is None
                       else target_datetime.astimezone(timezone.utc))
    target_hour = target_datetime.strftime("%Y-%m-%dT%H:00")
    time_params = ({"start_hour": target_hour, "end_hour": target_hour}
                   if explicit_target else {"forecast_days": 1})
    
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
                        "swell_wave_height",
                    ],
                    "timezone": "UTC",
                    **time_params
                }
            )
            
            if response.status_code != 200:
                logger.warning(f"Open-Meteo API error: {response.status_code}")
                return {"source": "error", "error": f"API returned {response.status_code}"}
            
            data = response.json()
            
            # Get current conditions if available
            current = {} if explicit_target else data.get("current", {})
            
            wave_height_m = current.get("wave_height")
            wave_period = current.get("wave_period")
            wave_direction = current.get("wave_direction")
            swell_height_m = current.get("swell_wave_height")
            
            # If no current data, try hourly
            if wave_height_m is None:
                hourly = data.get("hourly", {})
                times = hourly.get("time", [])
                heights = hourly.get("wave_height", [])
                periods = hourly.get("wave_period", [])
                directions = hourly.get("wave_direction", [])
                swells = hourly.get("swell_wave_height", [])
                swell_height_m = None
                
                # Select the containing UTC hour. Missing data must not borrow another valid time.
                if times and heights:
                    for i, t in enumerate(times):
                        if t == target_hour:
                            wave_height_m = heights[i] if i < len(heights) else None
                            wave_period = periods[i] if i < len(periods) else None
                            wave_direction = directions[i] if i < len(directions) else None
                            swell_height_m = swells[i] if i < len(swells) else None
                            break
                    
            
            result = {
                "source": "open-meteo",
                "fetched_at": datetime.now(timezone.utc).isoformat()
            }
            
            if wave_height_m is not None:
                # ★ THE LABEL IS THE CORRECTNESS SURFACE. Surfline's own vocabulary splits
                # "swell" (offshore) from "surf" (breaking); ours must too, because the two share
                # units and nothing else distinguishes them. `wave_height_ft` is what the post
                # composer auto-fills as the surf the user rode, so it must be the BREAKING height;
                # the offshore number is kept beside it, named, rather than deleted.
                breaking_ft, regime = _breaking_ft(
                    latitude, longitude, wave_height_m, wave_period, wave_direction)
                result["wave_height_ft"] = breaking_ft          # BREAKING — what a surfer rides
                result["offshore_height_ft"] = meters_to_feet(wave_height_m)  # TOTAL SEA, not swell
                result["surf_regime"] = regime                  # provenance: 'offshore_estimate' == the transform failed open

            # Swell is a distinct provider quantity. Missing swell must not fall back to total sea.
            result["swell_height_ft"] = meters_to_feet(swell_height_m) if swell_height_m is not None else None

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
        spot_info.get("noaa_station"),
        target_datetime=target_datetime
    )
    
    conditions["coordinates"] = {"lat": spot_info["lat"], "lon": spot_info["lon"]}
    
    return conditions


async def get_wind_conditions(
    latitude: float,
    longitude: float,
    target_datetime: Optional[datetime] = None
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
    target_hour = None
    if target_datetime is not None:
        target_datetime = (target_datetime.replace(tzinfo=timezone.utc) if target_datetime.tzinfo is None
                           else target_datetime.astimezone(timezone.utc))
        target_hour = target_datetime.strftime("%Y-%m-%dT%H:00")
    fields = ["wind_speed_10m", "wind_direction_10m"]
    time_params = ({"hourly": fields, "start_hour": target_hour, "end_hour": target_hour}
                   if target_hour else {"current": fields})
    
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                WEATHER_API,
                params={
                    "latitude": latitude,
                    "longitude": longitude,
                    **time_params,
                    "timezone": "UTC"
                }
            )
            
            if response.status_code != 200:
                return {"source": "error", "error": f"API returned {response.status_code}"}
            
            data = response.json()
            current = data.get("current", {}) if target_hour is None else {}
            if target_hour is not None:
                hourly = data.get("hourly", {})
                times = hourly.get("time", [])
                if target_hour in times:
                    index = times.index(target_hour)
                    current = {field: hourly.get(field, [])[index]
                               for field in fields if index < len(hourly.get(field, []))}
            
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
    noaa_station: Optional[str] = None,
    target_datetime: Optional[datetime] = None
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
    # An explicit composite represents one containing UTC hour for every source.
    target_args = {}
    if target_datetime is not None:
        target_datetime = (target_datetime.replace(tzinfo=timezone.utc) if target_datetime.tzinfo is None
                           else target_datetime.astimezone(timezone.utc))
        target_datetime = target_datetime.replace(minute=0, second=0, microsecond=0)
        target_args = {"target_datetime": target_datetime}
    # Default current-mode callers retain their existing provider behavior.
    surf = await get_surf_conditions(latitude, longitude, **target_args)
    
    # Get wind conditions
    wind = await get_wind_conditions(latitude, longitude, **target_args)
    
    # Get tide conditions (if NOAA station available)
    tide = {}
    if noaa_station:
        tide = await get_noaa_tide_data(noaa_station, **target_args)
    
    # Merge results
    result = {
        "wave_height_ft": surf.get("wave_height_ft"),          # BREAKING (see _breaking_ft)
        # ⚠️ THE PROVENANCE TRAVELS WITH THE NUMBER OR IT IS NOT PROVENANCE. `get_surf_conditions`
        # stamps the offshore value and the regime beside the breaking height; forwarding only the
        # height here would leave this surface unable to say whether the transform ran or failed
        # open — the same "a number that cannot say what it is" class the fix above closed.
        "swell_height_ft": surf.get("swell_height_ft"),        # PROVIDER SWELL, may be unknown
        "offshore_height_ft": surf.get("offshore_height_ft"),  # TOTAL SEA
        "surf_regime": surf.get("surf_regime"),                # 'offshore_estimate' == failed open
        "wave_period_sec": surf.get("wave_period_sec"),
        "wave_direction": surf.get("wave_direction"),
        "wave_direction_degrees": surf.get("wave_direction_degrees"),  # Keep raw degrees for visualization
        "wind_speed_mph": wind.get("wind_speed_mph"),
        "wind_direction": wind.get("wind_direction"),
        "tide_height_ft": tide.get("tide_height_ft"),
        "tide_status": tide.get("tide_status"),
        "tide_method": tide.get("tide_method"),
        "tide_datum": tide.get("tide_datum"),
        "next_high": tide.get("next_high"),
        "next_low": tide.get("next_low"),
        "source": "auto",
        "tide_source": "noaa" if tide.get("source") == "noaa" else None,
        "fetched_at": datetime.now(timezone.utc).isoformat()
    }
    
    if spot_name:
        result["spot_name"] = spot_name
    if target_datetime is not None:
        result["requested_time"] = target_datetime.isoformat()
    
    # Remove None values
    result = {k: v for k, v in result.items() if v is not None}
    
    return result
