"""
ECMWF Pressure Service — EURO MSL pressure global-coarse fetcher (open-meteo replacement for EURO pressure).

Spawns ecmwf_opendata_fetcher.py (layer=pressure) off the request path and returns Open-Meteo-shaped
point dicts (pressure_msl [hPa]). The caller (ingest_euro_pressure_global) keeps provider='open-meteo'
(manifest byte-identical: source_dataset='ecmwf_ifs'). ECMWF Open Data is free CC-BY, no creds. Returns
None on failure / in test env -> caller falls back to open-meteo. Subprocess plumbing lives in
_fetch_common.run_fetcher_subprocess.
"""
from typing import List, Optional

from services._fetch_common import run_fetcher_subprocess


async def fetch_euro_pressure_global_coarse(
    bbox: dict,
    resolution: float = 10.0,
    forecast_days: int = 10,
) -> Optional[List[dict]]:
    """BACKGROUND-ONLY: coarse GLOBAL EURO MSL-pressure grid direct from ECMWF Open Data (IFS 0.25° GRIB).
    Slow (~3-6 min, low CPU/mem) — scheduler ingestion ONLY. Native horizon 10d (240h, 00/12 runs).
    None in test env."""
    return await run_fetcher_subprocess(
        "ecmwf_opendata_fetcher.py", bbox, resolution, forecast_days,
        log_tag="ECMWF EURO-Pressure", out_prefix="ecmwfpmsl_global",
        extra_payload={"layer": "pressure"},
    )
