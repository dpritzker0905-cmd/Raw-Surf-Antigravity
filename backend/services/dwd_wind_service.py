"""
DWD Wind Service — ICON 10m wind global-coarse fetcher (open-meteo replacement for ICON wind).

Spawns dwd_icon_wind_fetcher.py (icosahedral GRIB via CLAT/CLON + 3D nearest-neighbor) off the request
path and returns Open-Meteo-shaped point dicts (wind_speed_10m [m/s] + wind_direction_10m [°]). The
caller (ingest_icon_wind_global) keeps provider='open-meteo' (manifest byte-identical:
source_dataset='dwd_icon'). DWD opendata is public, no creds. Returns None on failure / in test env ->
caller falls back to open-meteo. Subprocess plumbing lives in _fetch_common.run_fetcher_subprocess.
"""
from typing import List, Optional

from services._fetch_common import run_fetcher_subprocess


async def fetch_icon_wind_global_coarse(
    bbox: dict,
    resolution: float = 10.0,
    forecast_days: int = 8,
) -> Optional[List[dict]]:
    """BACKGROUND-ONLY: coarse GLOBAL ICON 10m wind grid direct from DWD opendata (icosahedral GRIB).
    Slow (~5-8 min) — scheduler ingestion ONLY. Native horizon ~7.5 days (180h). None in test env."""
    return await run_fetcher_subprocess(
        "dwd_icon_wind_fetcher.py", bbox, resolution, forecast_days,
        log_tag="DWD ICON-Wind", out_prefix="iconwind_global",
    )
