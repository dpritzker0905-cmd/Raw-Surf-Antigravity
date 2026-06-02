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
    """Synchronous Copernicus fetch using a separate lightweight downloader subprocess to prevent OOMs."""
    import subprocess
    import sys
    import os
    import time
    from pathlib import Path
    import tempfile

    start_time_total = time.time()
    username, password = _check_credentials()

    # Compute bounding box
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

    OM_TO_COPERNICUS = {v[1]: v[0] for v in VARIABLE_MAP}
    if variables and len(variables) > 0:
        requested_cop_vars = []
        for om_var in variables:
            if om_var in OM_TO_COPERNICUS:
                requested_cop_vars.append(OM_TO_COPERNICUS[om_var])
        fetch_vars = requested_cop_vars if requested_cop_vars else COPERNICUS_VARS
    else:
        fetch_vars = COPERNICUS_VARS

    now = datetime.now(timezone.utc)
    start_time = now - timedelta(hours=6)
    end_time = now + timedelta(days=forecast_days)

    logger.info(
        f"[Copernicus Subprocess API] Triggering downloader for {len(latitudes)} points, "
        f"bbox=[{lat_min:.2f},{lat_max:.2f},{lon_min:.2f},{lon_max:.2f}], "
        f"vars={len(fetch_vars)}/{len(COPERNICUS_VARS)}, "
        f"time=[{start_time.isoformat()},{end_time.isoformat()}]"
    )

    open_start = time.time()
    temp_file = None

    try:
        import gc
        gc.collect()

        # Create a temp file to hold the subset NetCDF
        fd, temp_path_str = tempfile.mkstemp(suffix=".nc", prefix="cmems_subset_")
        os.close(fd) # Close file descriptor, let downloader write to it
        temp_file = Path(temp_path_str)

        # Build paths
        script_path = Path(__file__).parent.parent / "scripts" / "copernicus_downloader.py"

        # Run downloader as a separate subprocess to avoid memory overhead
        logger.info(f"[Copernicus Subprocess API] Executing downloader subprocess...")
        env = os.environ.copy()

        # Invoke subprocess synchronously inside the thread pool
        res = subprocess.run(
            [sys.executable, str(script_path), str(temp_file.parent), temp_file.name],
            env=env,
            capture_output=True,
            text=True,
            timeout=180.0
        )

        if res.returncode != 0:
            logger.error(f"[Copernicus Subprocess API] Downloader subprocess failed (code {res.returncode}): {res.stderr}")
            raise RuntimeError(f"Downloader failed: {res.stderr}")

        logger.info(f"[Copernicus Subprocess API] Downloader completed. Stdout: {res.stdout.strip()}")

        # Now import xarray and numpy dynamically to parse the local NetCDF file
        import xarray as xr
        import numpy as np

        logger.info(f"[Copernicus Subprocess API] Parsing downloaded NetCDF file...")
        ds = xr.open_dataset(temp_file, engine="h5netcdf")

        # Load variables to memory synchronously
        for var in fetch_vars:
            if var in ds:
                ds[var] = ds[var].load()
        if "latitude" in ds:
            ds["latitude"] = ds["latitude"].load()
        if "longitude" in ds:
            ds["longitude"] = ds["longitude"].load()
        if "time" in ds:
            ds["time"] = ds["time"].load()

        # Perform pointwise selection locally in memory on the loaded dataset
        lat_da = xr.DataArray(latitudes, dims="point")
        lon_da = xr.DataArray(longitudes, dims="point")
        ds_points = ds.sel(latitude=lat_da, longitude=lon_da, method="nearest")
    except Exception as e:
        logger.error(f"[Copernicus Subprocess API] Fetch and load failed: {e}")
        if temp_file and temp_file.exists():
            try:
                temp_file.unlink()
            except Exception:
                pass
        raise
    open_time = time.time() - open_start

    extract_start = time.time()
    results = []

    for i in range(len(latitudes)):
        lat = latitudes[i]
        lon = longitudes[i]

        try:
            point = ds_points.isel(point=i)
            times_raw = point.time.values
            times = []
            for t in times_raw:
                ts = np.datetime_as_string(t, unit="m")
                times.append(ts)

            hourly = {"time": times}
            hourly_units = {"time": "iso8601"}

            for cop_var, om_var, unit in VARIABLE_MAP:
                if cop_var in point:
                    vals = point[cop_var].values
                    hourly[om_var] = [
                        round(float(v), 4) if not np.isnan(v) else None
                        for v in vals
                    ]
                else:
                    hourly[om_var] = [None] * len(times)
                hourly_units[om_var] = unit

            snapped_lat = float(point.latitude.values)
            snapped_lon = float(point.longitude.values)

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

        except Exception as e:
            logger.warning(
                f"[Copernicus Subprocess API] Point {lat},{lon} extraction failed: {e}"
            )
            results.append({
                "latitude": lat,
                "longitude": lon,
                "generationtime_ms": 0,
                "utc_offset_seconds": 0,
                "timezone": "GMT",
                "timezone_abbreviation": "GMT",
                "elevation": 0,
                "__provider": "copernicus",
                "hourly_units": {"time": "iso8601"},
                "hourly": {"time": []},
            })
    extract_time = time.time() - extract_start

    # Close dataset and explicitly free memory/delete temp file
    try:
        ds_points.close()
        del ds_points
        ds.close()
        del ds
        if temp_file and temp_file.exists():
            temp_file.unlink()
        import gc
        gc.collect()
    except Exception:
        pass

    total_time = time.time() - start_time_total

    # Expose timing telemetries directly inside the JSON response
    for res in results:
        res["__diagnostics"] = {
            "open_time_sec": round(open_time, 3),
            "extract_time_sec": round(extract_time, 3),
            "total_time_sec": round(total_time, 3),
            "point_count": len(latitudes),
            "variable_count": len(fetch_vars),
            "variables": fetch_vars
        }

    logger.info(
        f"[Copernicus Diagnostics Telemetry] Success: {len(results)} points. "
        f"OpenTime: {open_time:.2f}s | ExtractTime: {extract_time:.2f}s | "
        f"TotalTime: {total_time:.2f}s | Variables: {fetch_vars}"
    )
    return results

