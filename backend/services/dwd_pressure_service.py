"""
DWD Pressure Service — ICON MSL pressure global-coarse fetcher (open-meteo replacement for ICON pressure).

Spawns dwd_icon_pressure_fetcher.py (icosahedral GRIB via CLAT/CLON + 3D nearest-neighbor) off the
request path and returns Open-Meteo-shaped point dicts (pressure_msl [hPa]). The caller
(ingest_icon_pressure_global) keeps provider='open-meteo' (manifest byte-identical:
source_dataset='dwd_icon'). DWD opendata is public, no creds. Returns None on failure / in test env ->
caller falls back to open-meteo. Subprocess plumbing lives in _fetch_common.run_fetcher_subprocess.
"""
from typing import List, Optional

from services._fetch_common import run_fetcher_subprocess


async def fetch_icon_pressure_global_coarse(
    bbox: dict,
    resolution: float = 10.0,
    forecast_days: int = 8,
) -> Optional[List[dict]]:
    """BACKGROUND-ONLY: coarse GLOBAL ICON MSL-pressure grid direct from DWD opendata (icosahedral
    PMSL GRIB). Slow (~5-8 min, ~tens-of-MB peak from the icosahedral arrays) — scheduler ingestion
    ONLY. ICON native horizon ~7.5 days (180h). None in test env."""
    return await run_fetcher_subprocess(
        "dwd_icon_pressure_fetcher.py", bbox, resolution, forecast_days,
        log_tag="DWD ICON-Pressure", out_prefix="iconpmsl_global",
    )
