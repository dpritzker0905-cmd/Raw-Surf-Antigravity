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
    timeout_sec: Optional[int] = None,
) -> Optional[List[dict]]:
    """BACKGROUND-ONLY: coarse GLOBAL ICON 10m wind grid direct from DWD opendata (icosahedral GRIB).
    Slow (~5-8 min) — scheduler ingestion or the wind native-recovery lane ONLY (never the serve
    path). Native horizon ~7.5 days (180h). ``timeout_sec`` bounds the subprocess (recovery passes
    ~900s; unset keeps the scheduler's 1800s default). None in test env."""
    kwargs = {"timeout": int(timeout_sec)} if timeout_sec else {}
    return await run_fetcher_subprocess(
        "dwd_icon_wind_fetcher.py", bbox, resolution, forecast_days,
        log_tag="DWD ICON-Wind", out_prefix="iconwind_global", **kwargs,
    )
