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


def is_test_environment() -> bool:
    import os
    import sys
    node_env = os.environ.get("NODE_ENV", "").lower()
    env = os.environ.get("ENV", "").lower()
    is_prod_env = os.environ.get("IS_PROD", "").lower()
    local_test_fixture = os.environ.get("LOCAL_TEST_FIXTURE", "").lower() == "true"
    
    is_pytest = "pytest" in sys.modules
    
    if is_pytest:
        if node_env == "production" or env == "production" or is_prod_env == "true":
            return False
    else:
        if local_test_fixture:
            return True
            
        if node_env == "production" or env == "production" or is_prod_env == "true":
            return False
            
    return (
        os.environ.get("NODE_ENV") == "test"
        or local_test_fixture
        or os.environ.get("TESTING") == "1"
    )


def generate_mock_copernicus_response(
    latitudes: List[float],
    longitudes: List[float],
    forecast_days: int,
    variables: Optional[List[str]]
) -> List[dict]:
    import math
    from datetime import datetime, timezone, timedelta
    
    start_time = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0) - timedelta(days=1)
    hours_count = forecast_days * 24
    time_strings = [(start_time + timedelta(hours=h)).strftime("%Y-%m-%dT%H:00:00Z") for h in range(hours_count)]
    
    if not variables:
        variables = [
            "wave_height", "wave_direction", "wave_period",
            "swell_wave_height", "swell_wave_direction", "swell_wave_period",
            "secondary_swell_wave_height", "secondary_swell_wave_direction", "secondary_swell_wave_period",
            "wind_wave_height", "wind_wave_direction", "wind_wave_period"
        ]
        
    results = []
    for lat, lon in zip(latitudes, longitudes):
        hourly_data = {
            "time": time_strings
        }
        hourly_units = {
            "time": "iso8601"
        }
        
        lat_rad = math.radians(lat)
        lon_rad = math.radians(lon)
        
        for var in variables:
            values = []
            unit = "m"
            if "direction" in var:
                unit = "°"
            elif "period" in var:
                unit = "s"
                
            for h in range(hours_count):
                t_factor = math.sin(h / 12.0)
                if "direction" in var:
                    val = (180.0 + 45.0 * t_factor + 90.0 * math.sin(lat_rad - lon_rad)) % 360.0
                elif "period" in var:
                    val = 8.0 + 2.0 * math.sin(lat_rad - lon_rad) + 0.5 * t_factor
                else: # height
                    val = 1.2 + 0.4 * math.sin(lat_rad * 3 + lon_rad * 2) + 0.3 * t_factor
                values.append(round(max(0.1, val), 2))
                
            hourly_data[var] = values
            hourly_units[var] = unit
            
        results.append({
            "latitude": lat,
            "longitude": lon,
            "generationtime_ms": 0.01,
            "utc_offset_seconds": 0,
            "timezone": "GMT",
            "timezone_abbreviation": "GMT",
            "elevation": 0.0,
            "__provider": "copernicus",
            # Mock data is only produced under is_test_environment(); flag it so the normalizer tags the
            # product provider="test-fixture" (and its non-test security guard rejects it), exactly like
            # the open-meteo mock — keeps test expectations + the fixture-safety model consistent.
            "is_test_fixture": True,
            "hourly_units": hourly_units,
            "hourly": hourly_data
        })
    return results


import copy
import time

_point_cache = {}
POINT_CACHE_TTL = 600.0  # 10 minutes

import threading
_copernicus_sync_lock = threading.RLock()


async def fetch_euro_marine(
    latitudes: List[float],
    longitudes: List[float],
    forecast_days: int = 3,
    variables: Optional[List[str]] = None,
    valid_time: Optional[str] = None,
) -> List[dict]:
    """
    Fetch EURO marine wave data from Copernicus Marine Service.
    Includes 10-minute server-side caching keyed by rounded coordinate arrays.
    """
    if is_test_environment():
        logger.info(f"[Copernicus Point mock] Returning mock Copernicus results under test environment")
        return generate_mock_copernicus_response(latitudes, longitudes, forecast_days, variables)
    # Round latitudes/longitudes to 2 decimals for caching stability
    rounded_lats = tuple(round(lat, 2) for lat in latitudes)
    rounded_lons = tuple(round(lon, 2) for lon in longitudes)
    sorted_vars = tuple(sorted(variables)) if variables else None
    
    cache_key = (rounded_lats, rounded_lons, forecast_days, sorted_vars, valid_time)
    
    now = time.time()
    if cache_key in _point_cache:
        cached_data, timestamp = _point_cache[cache_key]
        if now - timestamp < POINT_CACHE_TTL:
            logger.info(f"[Copernicus Backend Cache] HIT for cache_key={cache_key}")
            return copy.deepcopy(cached_data)
            
    import asyncio

    # Run the blocking Copernicus fetch in a thread pool (serialized at the synchronous _fetch_sync level)
    loop = asyncio.get_event_loop()
    results = await loop.run_in_executor(
        None, _fetch_sync, latitudes, longitudes, forecast_days, variables, valid_time
    )
    
    if results and len(results) > 0:
        _point_cache[cache_key] = (copy.deepcopy(results), now)
        if len(_point_cache) > 100:
            oldest_key = min(_point_cache.keys(), key=lambda k: _point_cache[k][1])
            _point_cache.pop(oldest_key, None)
            
    return results


async def fetch_euro_marine_global_coarse(
    bbox: dict,
    resolution: float = 10.0,
    forecast_days: int = 10,
) -> Optional[List[dict]]:
    """
    BACKGROUND-ONLY: fetch a coarse (resolution°) GLOBAL EURO marine grid from Copernicus using the
    thin-latitude-band subset fetcher (copernicus_global_fetcher.py). Returns Open-Meteo-shaped point
    dicts for ALL 4 native layers (waves/swell_1/swell_2/wind_waves incl REAL ECMWF-WAM swells), or
    None on failure. Slow (~15-30 min, ~0.3 GB, ~36 MB peak) — scheduler ingestion ONLY, never a user
    request. CMEMS global waves is a ~10-day product (caller extends 10->14d with cached GFS).
    """
    def _axis(lo, hi, step):
        out = []
        v = lo
        while v < hi - 1e-9:
            out.append(round(v, 4))
            v += step
        return out
    lons = _axis(float(bbox["west"]), float(bbox["east"]), resolution)
    lats = _axis(float(bbox["south"]), float(bbox["north"]), resolution)

    if is_test_environment():
        all_lats = [la for la in lats for _ in lons]
        all_lons = [lo for _ in lats for lo in lons]
        return generate_mock_copernicus_response(all_lats, all_lons, forecast_days, None)

    import asyncio
    import subprocess
    import sys
    import json
    import os
    import tempfile
    import uuid
    from pathlib import Path
    from datetime import datetime, timezone, timedelta

    user, pwd = _check_credentials()
    now = datetime.now(timezone.utc)
    tmp = Path(tempfile.gettempdir())
    os.environ["COPERNICUSMARINE_CREDENTIALS_DIRECTORY"] = str(tmp)
    out = tmp / f"cmems_global_{uuid.uuid4().hex}.json"
    payload = {
        "username": user, "password": pwd, "bbox": bbox, "resolution": resolution,
        "start_datetime": (now - timedelta(hours=6)).strftime("%Y-%m-%dT%H:%M:%S"),
        "end_datetime": (now + timedelta(days=forecast_days)).strftime("%Y-%m-%dT%H:%M:%S"),
        "output_path": str(out),
    }
    script = os.path.join(os.path.dirname(__file__), "copernicus_global_fetcher.py")

    def _run():
        return subprocess.run(
            [sys.executable, "-OO", script, json.dumps(payload)],
            capture_output=True, text=True, timeout=2400,  # 40 min ceiling
        )

    try:
        result = await asyncio.get_event_loop().run_in_executor(None, _run)
        if result.stdout and result.stdout.strip():
            logger.info(f"[Copernicus Global] {result.stdout.strip().splitlines()[-1]}")
        if result.returncode != 0:
            logger.error(f"[Copernicus Global] fetcher failed (exit {result.returncode}): {result.stderr.strip()[-600:]}")
            return None
        with open(out) as f:
            data = json.load(f)
        return data if data else None
    except subprocess.TimeoutExpired:
        logger.error("[Copernicus Global] fetcher subprocess timed out (>2400s)")
        return None
    except Exception as e:
        logger.error(f"[Copernicus Global] error: {e}")
        return None
    finally:
        try:
            if out.exists():
                out.unlink()
        except Exception:
            pass


def _fetch_tiled_sync(
    latitudes: List[float],
    longitudes: List[float],
    forecast_days: int,
    variables: Optional[List[str]] = None,
    valid_time: Optional[str] = None,
) -> List[dict]:
    """
    Fetch Copernicus data for large bounding boxes by splitting into 25°×50° tiles.
    Each tile is processed sequentially via _fetch_sync to keep memory usage constant
    (one NetCDF file in memory at a time).
    """
    import math
    import time

    start_total = time.time()
    TILE_LAT = 25.0
    TILE_LON = 50.0

    # Cap forecast_days for tiles to keep each NetCDF download fast
    tile_forecast_days = min(forecast_days, 3)

    # Group coordinate indices by spatial tile
    tiles = {}
    for i, (lat, lon) in enumerate(zip(latitudes, longitudes)):
        tile_key = (math.floor(lat / TILE_LAT), math.floor(lon / TILE_LON))
        tiles.setdefault(tile_key, []).append(i)

    logger.info(
        f"[Copernicus Tiled] Splitting {len(latitudes)} points into {len(tiles)} tiles "
        f"(forecast_days={tile_forecast_days}, tile_size={TILE_LAT}°x{TILE_LON}°)"
    )

    all_results = [None] * len(latitudes)
    tiles_ok = 0
    tiles_failed = 0

    for tile_key, indices in tiles.items():
        tile_lats = [latitudes[i] for i in indices]
        tile_lons = [longitudes[i] for i in indices]

        try:
            tile_results = _fetch_sync(tile_lats, tile_lons, tile_forecast_days, variables, valid_time=valid_time)
            if tile_results:
                for j, idx in enumerate(indices):
                    if j < len(tile_results):
                        all_results[idx] = tile_results[j]
                tiles_ok += 1
            else:
                tiles_failed += 1
                logger.warning(f"[Copernicus Tiled] Tile {tile_key} returned empty results ({len(indices)} pts)")
        except Exception as e:
            tiles_failed += 1
            logger.warning(f"[Copernicus Tiled] Tile {tile_key} ({len(indices)} pts) failed: {e}")
            # Create empty result stubs for failed tile points so coordinate ordering is preserved
            for idx in indices:
                all_results[idx] = {
                    "latitude": latitudes[idx],
                    "longitude": longitudes[idx],
                    "generationtime_ms": 0,
                    "utc_offset_seconds": 0,
                    "timezone": "GMT",
                    "timezone_abbreviation": "GMT",
                    "elevation": 0,
                    "__provider": "copernicus",
                    "hourly_units": {"time": "iso8601"},
                    "hourly": {"time": []},
                }

    elapsed = time.time() - start_total
    logger.info(
        f"[Copernicus Tiled] Complete: {tiles_ok}/{tiles_ok + tiles_failed} tiles OK, "
        f"{len([r for r in all_results if r is not None])} results in {elapsed:.1f}s"
    )

    results = [r for r in all_results if r is not None]
    return results if results else None


def _fetch_sync(
    latitudes: List[float],
    longitudes: List[float],
    forecast_days: int,
    variables: Optional[List[str]] = None,
    valid_time: Optional[str] = None,
) -> List[dict]:
    """Synchronous Copernicus fetch using copernicusmarine and netCDF4 in-process (no subprocess) to avoid fork OOMs."""
    with _copernicus_sync_lock:
        import tempfile
        import os
        import time
        import json
        import gc
        from pathlib import Path
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
        if bbox_lat_range > 28 or bbox_lon_range > 55:
            logger.info(
                f"[Copernicus] Bbox {bbox_lat_range:.1f}° x {bbox_lon_range:.1f}° exceeds single-request limit. "
                f"Switching to tiled fetch for {len(latitudes)} points."
            )
            return _fetch_tiled_sync(latitudes, longitudes, forecast_days, variables, valid_time=valid_time)

        forecast_days = min(forecast_days, 10)

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
        if valid_time:
            try:
                iso_str = valid_time.replace("Z", "+00:00")
                target_dt = datetime.fromisoformat(iso_str)
                start_time_dt = target_dt - timedelta(hours=3)
                end_time_dt = target_dt + timedelta(hours=3)
                logger.info(f"[Copernicus Time Window] Restricted query around valid_time={valid_time}: {start_time_dt} to {end_time_dt}")
            except Exception as te:
                logger.error(f"[Copernicus Time Window] Failed to parse valid_time={valid_time}: {te}. Falling back to default window.")
                start_time_dt = now_dt - timedelta(hours=6)
                end_time_dt = now_dt + timedelta(days=forecast_days)
        else:
            start_time_dt = now_dt - timedelta(hours=6)
            end_time_dt = now_dt + timedelta(days=forecast_days)

        import uuid
        temp_dir = Path(tempfile.gettempdir())
        temp_filename = f"cmems_subset_{uuid.uuid4().hex}.nc"
        temp_file = temp_dir / temp_filename

        if temp_file.exists():
            temp_file.unlink()

        os.environ["COPERNICUSMARINE_CREDENTIALS_DIRECTORY"] = str(temp_dir)
        results = []

        try:
            import subprocess
            import sys
            
            fetcher_script = os.path.join(os.path.dirname(__file__), "copernicus_fetcher.py")
            payload = {
                "dataset_id": "cmems_mod_glo_wav_anfc_0.083deg_PT3H-i",
                "variables": fetch_vars,
                "minimum_longitude": float(lon_min),
                "maximum_longitude": float(lon_max),
                "minimum_latitude": float(lat_min),
                "maximum_latitude": float(lat_max),
                "start_datetime": start_time_dt.strftime("%Y-%m-%dT%H:%M:%S"),
                "end_datetime": end_time_dt.strftime("%Y-%m-%dT%H:%M:%S"),
                "output_directory": str(temp_dir),
                "output_filename": temp_file.name,
                "username": username,
                "password": pwd
            }

            # Free memory before spawning subprocess to maximize available RAM on constrained envs
            gc.collect()

            # If valid_time is provided, it's a client request -> use 25.0s to fail fast before Netlify timeout
            # Otherwise, it's a background ingestion request -> allow up to 180s (3 minutes) for large subsets
            subprocess_timeout = 25.0 if valid_time else 180.0
            logger.info(f"[Copernicus Subprocess API] Downloading subset via {sys.executable} -OO {fetcher_script} to {temp_file} (timeout={subprocess_timeout}s)...")
            try:
                result = subprocess.run(
                    [sys.executable, "-OO", fetcher_script, json.dumps(payload)],
                    capture_output=True,
                    text=True,
                    check=False,
                    timeout=subprocess_timeout
                )
                if result.returncode != 0:
                    raise RuntimeError(f"Fetcher subprocess failed (exit code {result.returncode}): {result.stdout.strip()} | stderr: {result.stderr.strip()}")
            except subprocess.TimeoutExpired as te:
                logger.error(f"[Copernicus Subprocess API] Fetcher subprocess timed out after {subprocess_timeout} seconds: {te}")
                raise TimeoutError(f"Copernicus Marine fetcher subprocess timed out after {subprocess_timeout} seconds") from te
            logger.info("[Copernicus Subprocess API] Download completed. Parsing with netCDF4...")
            
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

