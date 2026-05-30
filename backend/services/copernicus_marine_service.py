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


async def fetch_euro_marine(
    latitudes: List[float],
    longitudes: List[float],
    forecast_days: int = 3,
) -> List[dict]:
    """
    Fetch EURO marine wave data from Copernicus Marine Service.

    Args:
        latitudes: List of latitude values
        longitudes: List of longitude values
        forecast_days: Number of forecast days (default 3)

    Returns:
        List of Open-Meteo-shaped result dicts, one per coordinate pair.
    """
    import asyncio

    # Run the blocking Copernicus fetch in a thread pool
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        None, _fetch_sync, latitudes, longitudes, forecast_days
    )


def _fetch_sync(
    latitudes: List[float],
    longitudes: List[float],
    forecast_days: int,
) -> List[dict]:
    """Synchronous Copernicus fetch (runs in thread pool)."""
    import copernicusmarine
    import numpy as np

    username, password = _check_credentials()

    # Compute bounding box with padding for nearest-neighbor selection
    lat_min = min(latitudes) - 0.5
    lat_max = max(latitudes) + 0.5
    lon_min = min(longitudes) - 0.5
    lon_max = max(longitudes) + 0.5

    # Time range
    now = datetime.now(timezone.utc)
    # Start 6 hours ago to capture the latest analysis step
    start_time = now - timedelta(hours=6)
    end_time = now + timedelta(days=forecast_days)

    logger.info(
        f"[Copernicus] Fetching {len(latitudes)} points, "
        f"bbox=[{lat_min:.2f},{lat_max:.2f},{lon_min:.2f},{lon_max:.2f}], "
        f"time=[{start_time.isoformat()},{end_time.isoformat()}]"
    )

    try:
        ds = copernicusmarine.open_dataset(
            dataset_id=DATASET_ID,
            variables=COPERNICUS_VARS,
            minimum_latitude=lat_min,
            maximum_latitude=lat_max,
            minimum_longitude=lon_min,
            maximum_longitude=lon_max,
            start_datetime=start_time.strftime("%Y-%m-%dT%H:%M:%S"),
            end_datetime=end_time.strftime("%Y-%m-%dT%H:%M:%S"),
            username=username,
            password=password,
        )
    except Exception as e:
        logger.error(f"[Copernicus] Dataset open failed: {e}")
        raise

    results = []

    for i in range(len(latitudes)):
        lat = latitudes[i]
        lon = longitudes[i]

        try:
            # Select nearest grid point
            point = ds.sel(latitude=lat, longitude=lon, method="nearest")

            # Extract time array
            times_raw = point.time.values  # numpy datetime64 array
            times = []
            for t in times_raw:
                # Convert numpy datetime64 → ISO string without Z/seconds
                ts = np.datetime_as_string(t, unit="m")
                times.append(ts)

            # Build hourly dict
            hourly = {"time": times}
            hourly_units = {"time": "iso8601"}

            for cop_var, om_var, unit in VARIABLE_MAP:
                if cop_var in point:
                    vals = point[cop_var].values
                    # Convert to Python floats, NaN → None
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
                f"[Copernicus] Point {lat},{lon} extraction failed: {e}"
            )
            # Return an empty result for this point (land / out of domain)
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

    # Close dataset
    try:
        ds.close()
    except Exception:
        pass

    logger.info(
        f"[Copernicus] Success: {len(results)} points, "
        f"{len(results[0].get('hourly', {}).get('time', []))} timesteps"
    )
    return results
