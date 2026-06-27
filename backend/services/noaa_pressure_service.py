"""
NOAA Pressure Service — GFS MSL pressure global-coarse fetcher (open-meteo replacement for GFS pressure).

Spawns noaa_gfs_pressure_fetcher.py off the request path and returns Open-Meteo-shaped point dicts
(pressure_msl [hPa]). The caller (ingest_gfs_pressure_global) keeps provider='open-meteo' (manifest
byte-identical: source_dataset='gfs_seamless'). Public NOAA data, no creds. Returns None on failure /
in test env -> open-meteo fallback. Subprocess plumbing lives in _fetch_common.run_fetcher_subprocess.
"""
from typing import List, Optional

from services._fetch_common import run_fetcher_subprocess


async def fetch_gfs_pressure_global_coarse(
    bbox: dict,
    resolution: float = 10.0,
    forecast_days: int = 16,
) -> Optional[List[dict]]:
    """BACKGROUND-ONLY: coarse GLOBAL GFS MSL-pressure grid direct from NOAA AWS Open Data (byte-range
    PRMSL). Slow (~3-6 min, low CPU/mem) — scheduler ingestion ONLY. None in test env."""
    return await run_fetcher_subprocess(
        "noaa_gfs_pressure_fetcher.py", bbox, resolution, forecast_days,
        log_tag="NOAA GFS-Pressure", out_prefix="gfsprmsl_global",
    )
