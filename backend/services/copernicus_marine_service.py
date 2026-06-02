"""
Copernicus Marine Service — EURO wave data fetcher.

Fetches ECMWF WAM wave analysis & forecast data from the Copernicus Marine
Service (CMEMS) and returns it in Open-Meteo-compatible JSON shape so the
frontend can consume it without any format changes.

Dataset: cmems_mod_glo_wav_anfc_0.083deg_PT3H-i
  - Global wave analysis & forecast, 0.083° resolution, 3-hourly
  - Source model: ECMWF WAM (same as EURO in Open-Meteo, but with full
    swell decomposition that Open-Meteo's ecmwf_wam025 lacks)

Environment variables (required):
  COPERNICUSMARINE_SERVICE_USERNAME
  COPERNICUSMARINE_SERVICE_PASSWORD

RULES:
  - No credentials in source code
  - Returns Open-Meteo shaped JSON (same schema frontend already consumes)
  - Tags results with __provider: 'copernicus'
  - Copernicus directions are 'from' direction — do NOT flip
"""

import os
import gc
import logging
from datetime import datetime, timezone, timedelta
from typing import List, Optional

logger = logging.getLogger(__name__)

# ── Copernicus dataset identifiers ──────────────────────────────────────────
DATASET_ID = "cmems_mod_glo_wav_anfc_0.083deg_PT3H-i"

# ── Variable mapping: Copernicus → Open-Meteo ──────────────────────────────
# Each tuple: (copernicus_var, open_meteo_var, unit)
VARIABLE_MAP = [
    ("VHM0",     "wave_height",                    "m"),
    ("VMDR",     "wave_direction",                  "°"),
    ("VTM10",    "wave_period",                     "s"),
    ("VHM0_SW1", "swell_wave_height",              "m"),
    ("VMDR_SW1", "swell_wave_direction",            "°"),
    ("VTM01_SW1","swell_wave_period",               "s"),
    ("VHM0_SW2", "secondary_swell_wave_height",     "m"),
    ("VMDR_SW2", "secondary_swell_wave_direction",  "°"),
    ("VTM01_SW2","secondary_swell_wave_period",     "s"),
    ("VHM0_WW",  "wind_wave_height",                "m"),
    ("VMDR_WW",  "wind_wave_direction",             "°"),
    ("VTM01_WW", "wind_wave_period",                "s"),
]

COPERNICUS_VARS = [v[0] for v in VARIABLE_MAP]
COPERNICUS_TO_OM = {v[0]: v[1] for v in VARIABLE_MAP}
OM_UNITS = {v[1]: v[2] for v in VARIABLE_MAP}


def _check_credentials():
    """Verify Copernicus credentials are available."""
    user = os.environ.get("COPERNICUSMARINE_SERVICE_USERNAME", "")
    pwd = os.environ.get("COPERNICUSMARINE_SERVICE_PASSWORD", "")
    if not user or not pwd:
        raise EnvironmentError(
            "Copernicus Marine credentials not configured. "
            "Set COPERNICUSMARINE_SERVICE_USERNAME and "
            "COPERNICUSMARINE_SERVICE_PASSWORD environment variables."
        )
    return user, pwd


import copy
import time

_point_cache = {}
POINT_CACHE_TTL = 600.0  # 10 minutes

async def fetch_euro_marine(
    latitudes: List[float],
    longitudes: List[float],
    forecast_days: int = 3,
    variables: Optional[List[str]] = None,
) -> List[dict]:
    """
    Fetch EURO marine wave data from Copernicus Marine Service.
    Includes 10-minute server-side caching keyed by rounded coordinate arrays.
    """
    # Round latitudes/longitudes to 2 decimals for caching stability
    rounded_lats = tuple(round(lat, 2) for lat in latitudes)
    rounded_lons = tuple(round(lon, 2) for lon in longitudes)
    sorted_vars = tuple(sorted(variables)) if variables else None
    
    cache_key = (rounded_lats, rounded_lons, forecast_days, sorted_vars)
    
    now = time.time()
    if cache_key in _point_cache:
        cached_data, timestamp = _point_cache[cache_key]
        if now - timestamp < POINT_CACHE_TTL:
            logger.info(f"[Copernicus Backend Cache] HIT for cache_key={cache_key}")
            return copy.deepcopy(cached_data)
            
    import asyncio

    # Run the blocking Copernicus fetch in a thread pool
    loop = asyncio.get_event_loop()
    results = await loop.run_in_executor(
        None, _fetch_sync, latitudes, longitudes, forecast_days, variables
    )
    
    if results and len(results) > 0:
        _point_cache[cache_key] = (copy.deepcopy(results), now)
        if len(_point_cache) > 100:
            oldest_key = min(_point_cache.keys(), key=lambda k: _point_cache[k][1])
            _point_cache.pop(oldest_key, None)
            
    return results


def _fetch_sync(
    latitudes: List[float],
    longitudes: List[float],
    forecast_days: int,
    variables: Optional[List[str]] = None,
) -> List[dict]:
    """Synchronous Copernicus fetch using copernicusmarine and netCDF4 in-process (no subprocess) to avoid fork OOMs."""
    import tempfile
    import os
    import time
    import json
    import gc
    from pathlib import Path
    import copernicusmarine
    import netCDF4
    import numpy as np

    start_time_total = time.time()
    username, pwd = _check_credentials()

    # Pre-validation check for bounding box size
    if len(latitudes) <= 2:
        lat_min = min(latitudes) - 0.15
        lat_max = max(latitudes) + 0.15
        lon_min = min(longitudes) - 0.15
        lon_max = max(longitudes) + 0.15
    else:
        lat_min = min(latitudes) - 0.05
        lat_max = max(latitudes) + 0.05
        lon_min = min(longitudes) - 0.05
        lon_max = max(longitudes) + 0.05

    lat_min = max(-90, lat_min)
    lat_max = min(90, lat_max)
    lon_min = max(-180, lon_min)
    lon_max = min(180, lon_max)

    bbox_lat_range = lat_max - lat_min
    bbox_lon_range = lon_max - lon_min
    if bbox_lat_range > 30 or bbox_lon_range > 60:
        raise ValueError(
            f"Bbox too large: {bbox_lat_range:.1f}° x {bbox_lon_range:.1f}°. Max: 30° x 60°."
        )

    forecast_days = min(forecast_days, 3)

    # CMEMS VARIABLE MAP
    VARIABLE_MAP = [
        ("VHM0",     "wave_height",                    "m"),
        ("VMDR",     "wave_direction",                  "°"),
        ("VTM10",    "wave_period",                     "s"),
        ("VHM0_SW1", "swell_wave_height",              "m"),
        ("VMDR_SW1", "swell_wave_direction",            "°"),
        ("VTM01_SW1","swell_wave_period",               "s"),
        ("VHM0_SW2", "secondary_swell_wave_height",     "m"),
        ("VMDR_SW2", "secondary_swell_wave_direction",  "°"),
        ("VTM01_SW2","secondary_swell_wave_period",     "s"),
        ("VHM0_WW",  "wind_wave_height",                "m"),
        ("VMDR_WW",  "wind_wave_direction",             "°"),
        ("VTM01_WW", "wind_wave_period",                "s"),
    ]
    COPERNICUS_VARS = [v[0] for v in VARIABLE_MAP]
    
    OM_TO_COPERNICUS = {v[1]: v[0] for v in VARIABLE_MAP}
    if variables and len(variables) > 0:
        requested_cop_vars = []
        for om_var in variables:
            if om_var in OM_TO_COPERNICUS:
                requested_cop_vars.append(OM_TO_COPERNICUS[om_var])
        fetch_vars = requested_cop_vars if requested_cop_vars else COPERNICUS_VARS
    else:
        fetch_vars = COPERNICUS_VARS

    now_dt = datetime.now(timezone.utc)
    start_time_dt = now_dt - timedelta(hours=6)
    end_time_dt = now_dt + timedelta(days=forecast_days)

    temp_dir = Path(tempfile.gettempdir())
    temp_filename = f"cmems_subset_{int(time.time())}.nc"
    temp_file = temp_dir / temp_filename

    if temp_file.exists():
        temp_file.unlink()

    os.environ["COPERNICUSMARINE_CREDENTIALS_DIRECTORY"] = str(temp_dir)
    results = []

    try:
        logger.info(f"[Copernicus In-Process API] Downloading subset to {temp_file}...")
        copernicusmarine.subset(
            dataset_id="cmems_mod_glo_wav_anfc_0.083deg_PT3H-i",
            variables=fetch_vars,
            minimum_longitude=lon_min,
            maximum_longitude=lon_max,
            minimum_latitude=lat_min,
            maximum_latitude=lat_max,
            start_datetime=start_time_dt.strftime("%Y-%m-%dT%H:%M:%S"),
            end_datetime=end_time_dt.strftime("%Y-%m-%dT%H:%M:%S"),
            output_directory=str(temp_dir),
            output_filename=temp_file.name,
            username=username,
            password=pwd
        )
        logger.info("[Copernicus In-Process API] Download completed. Parsing with netCDF4...")
        
        nc = netCDF4.Dataset(temp_file, "r")
        lats = nc.variables["latitude"][:]
        lons = nc.variables["longitude"][:]
        time_var = nc.variables["time"]
        times_raw = time_var[:]
        
        times_parsed = netCDF4.num2date(times_raw, units=time_var.units)
        times = [t.strftime("%Y-%m-%dT%H:%M:%SZ") for t in times_parsed]

        for i in range(len(latitudes)):
            lat_val = latitudes[i]
            lon_val = longitudes[i]
            try:
                lat_idx = np.abs(lats - lat_val).argmin()
                lon_idx = np.abs(lons - lon_val).argmin()
                
                snapped_lat = float(lats[lat_idx])
                snapped_lon = float(lons[lon_idx])
                
                hourly = {"time": times}
                hourly_units = {"time": "iso8601"}
                
                for cop_var, om_var, unit in VARIABLE_MAP:
                    if cop_var in nc.variables:
                        vals = nc.variables[cop_var][:, lat_idx, lon_idx]
                        hourly[om_var] = [
                            round(float(v), 4) if not np.ma.is_masked(v) and not np.isnan(v) else None
                            for v in vals
                        ]
                    else:
                        hourly[om_var] = [None] * len(times)
                    hourly_units[om_var] = unit
                    
                results.append({
                    "latitude": snapped_lat,
                    "longitude": snapped_lon,
                    "generationtime_ms": 0,
                    "utc_offset_seconds": 0,
                    "timezone": "GMT",
                    "timezone_abbreviation": "GMT",
                    "elevation": 0,
                    "__provider": "copernicus",
                    "hourly_units": hourly_units,
                    "hourly": hourly,
                })
            except Exception as pe:
                logger.error(f"[Copernicus In-Process API] Point {lat_val},{lon_val} parse error: {pe}")
                results.append({
                    "latitude": lat_val,
                    "longitude": lon_val,
                    "generationtime_ms": 0,
                    "utc_offset_seconds": 0,
                    "timezone": "GMT",
                    "timezone_abbreviation": "GMT",
                    "elevation": 0,
                    "__provider": "copernicus",
                    "hourly_units": {"time": "iso8601"},
                    "hourly": {"time": []},
                })
        nc.close()
    except Exception as e:
        logger.error(f"[Copernicus In-Process API] Ingestion failed: {e}")
        raise
    finally:
        if temp_file.exists():
            try:
                temp_file.unlink()
            except Exception:
                pass
        gc.collect()

    total_time = time.time() - start_time_total

    # Expose timing telemetries directly inside the JSON response
    for res in results:
        res["__diagnostics"] = {
            "open_time_sec": 0.0,
            "extract_time_sec": 0.0,
            "total_time_sec": round(total_time, 3),
            "point_count": len(latitudes),
            "variable_count": len(variables) if variables else 12,
            "variables": variables
        }

    logger.info(
        f"[Copernicus Diagnostics Telemetry] Success: {len(results)} points. "
        f"TotalTime: {total_time:.2f}s"
    )
    return results

