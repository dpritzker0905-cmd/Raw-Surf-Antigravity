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
    import json
    from pathlib import Path
    import tempfile

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

    logger.info(
        f"[Copernicus Subprocess API] Setting up isolated downloader for {len(latitudes)} points..."
    )

    req_file = None
    res_file = None
    results = []

    try:
        import gc
        gc.collect()

        # Create input JSON file
        fd_in, req_path_str = tempfile.mkstemp(suffix=".json", prefix="cmems_req_")
        os.close(fd_in)
        req_file = Path(req_path_str)
        
        # Create output JSON file path
        fd_out, res_path_str = tempfile.mkstemp(suffix=".json", prefix="cmems_res_")
        os.close(fd_out)
        res_file = Path(res_path_str)

        # Write request parameters
        req_data = {
            "latitudes": latitudes,
            "longitudes": longitudes,
            "forecast_days": forecast_days,
            "variables": variables
        }
        with open(req_file, "w") as f_in:
            json.dump(req_data, f_in)

        # Build paths
        script_path = Path(__file__).parent.parent / "scripts" / "copernicus_downloader.py"

        # Run downloader as a separate subprocess to avoid memory overhead
        logger.info(f"[Copernicus Subprocess API] Executing downloader subprocess...")
        env = os.environ.copy()

        # Invoke subprocess synchronously inside the thread pool
        res = subprocess.run(
            [sys.executable, str(script_path), str(req_file), str(res_file)],
            env=env,
            capture_output=True,
            text=True,
            timeout=180.0
        )

        if res.returncode != 0:
            logger.error(f"[Copernicus Subprocess API] Downloader subprocess failed (code {res.returncode}): {res.stderr}")
            raise RuntimeError(f"Downloader failed: {res.stderr}")

        logger.info(f"[Copernicus Subprocess API] Downloader completed. Stdout: {res.stdout.strip()}")

        # Load parsed results
        with open(res_file, "r") as f_out:
            results = json.load(f_out)

    except Exception as e:
        logger.error(f"[Copernicus Subprocess API] Fetch and load failed: {e}")
        raise
    finally:
        # Clean up temp files
        for f in (req_file, res_file):
            if f and f.exists():
                try:
                    f.unlink()
                except Exception:
                    pass

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

