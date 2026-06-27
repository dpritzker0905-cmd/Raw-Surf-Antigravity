"""
ECMWF Wind Service — EURO 10 m wind global-coarse fetcher (open-meteo replacement for EURO wind).

Spawns ecmwf_opendata_fetcher.py (layer=wind) off the request path and returns Open-Meteo-shaped point
dicts (wind_speed_10m [m/s] + wind_direction_10m [°]). The caller (ingest_euro_wind_global) keeps
provider='open-meteo' (manifest byte-identical: source_dataset='ecmwf_ifs'). ECMWF Open Data is free
CC-BY, no creds. Returns None on failure / in test env -> caller falls back to open-meteo. Subprocess
plumbing lives in _fetch_common.run_fetcher_subprocess.
"""
from typing import List, Optional

from services._fetch_common import run_fetcher_subprocess


async def fetch_euro_wind_global_coarse(
    bbox: dict,
    resolution: float = 10.0,
    forecast_days: int = 10,
) -> Optional[List[dict]]:
    """BACKGROUND-ONLY: coarse GLOBAL EURO 10 m wind grid direct from ECMWF Open Data (IFS 0.25° GRIB).
    Slow (~3-6 min, low CPU/mem) — scheduler ingestion ONLY. Native horizon 10d (240h, 00/12 runs).
    None in test env."""
    return await run_fetcher_subprocess(
        "ecmwf_opendata_fetcher.py", bbox, resolution, forecast_days,
        log_tag="ECMWF EURO-Wind", out_prefix="ecmwfwind_global",
        extra_payload={"layer": "wind"},
    )
