"""
NOAA Wind Service — GFS 10 m wind global-coarse fetcher (open-meteo replacement for GFS wind).

Spawns noaa_gfs_wind_fetcher.py off the request path and returns Open-Meteo-shaped point dicts
(wind_speed_10m [m/s] + wind_direction_10m [°]). The caller (ingest_gfs_wind_global) keeps
provider='open-meteo' (manifest byte-identical: source_dataset='gfs_seamless'). Public NOAA data, no
creds. Returns None on failure / in test env -> open-meteo fallback. Subprocess plumbing lives in
_fetch_common.run_fetcher_subprocess.
"""
from typing import List, Optional

from services._fetch_common import run_fetcher_subprocess


async def fetch_gfs_wind_global_coarse(
    bbox: dict,
    resolution: float = 10.0,
    forecast_days: int = 14,
) -> Optional[List[dict]]:
    """BACKGROUND-ONLY: coarse GLOBAL GFS 10 m wind grid direct from NOAA AWS Open Data (byte-range
    GRIB2). Slow (~3-6 min, low CPU/mem) — scheduler ingestion ONLY. None in test env."""
    return await run_fetcher_subprocess(
        "noaa_gfs_wind_fetcher.py", bbox, resolution, forecast_days,
        log_tag="NOAA GFS-Wind", out_prefix="gfswind_global",
    )
