"""
ECMWF Wave Service — EURO total-sea waves fetcher (the free wave stream that lights the EURO mid tier).

Spawns ecmwf_opendata_fetcher.py (layer=waves, stream="wave": swh/mwp/pp1d/mwd at 0.25°, free CC-BY,
no auth) off the request path and returns Open-Meteo-shaped point dicts (wave_height [m] +
wave_period [s, pp1d peak with mwp fallback] + wave_direction [°]). The caller
(ingest_euro_marine_global_mid) keeps provider='open-meteo' so the normalizer stamps
source_dataset='ecmwf_wam025' — real ECMWF WAM data, honestly labeled. TOTAL sea only: the free feed
has no swell-partition params, so swell_1/swell_2/wind_waves stay on CMEMS. Returns None on failure /
in test env -> caller falls back to the legacy CMEMS path. Subprocess plumbing lives in
_fetch_common.run_fetcher_subprocess.
"""
from typing import List, Optional

from services._fetch_common import run_fetcher_subprocess


async def fetch_euro_marine_waves_global(
    bbox: dict,
    resolution: float = 2.0,
    forecast_days: int = 10,
    timeout_s: int = 1800,
) -> Optional[List[dict]]:
    """BACKGROUND-ONLY: global EURO total-sea waves direct from ECMWF Open Data (IFS 0.25° wave-stream
    GRIB, sampled at ``resolution``°). Slow (~3-6 min, low CPU/mem) — scheduler ingestion ONLY. Native
    horizon 10d (240h) on 00/12 cycles; 06/18 cycles fall back to ≤144h inside the fetcher. None in
    test env. `timeout_s`: the regional PILOT passes a tight 600 s (fail fast, mid tier still covers)
    while the global mid keeps the 30-min default."""
    return await run_fetcher_subprocess(
        "ecmwf_opendata_fetcher.py", bbox, resolution, forecast_days,
        log_tag="ECMWF EURO-Waves", out_prefix="ecmwfwave_global",
        extra_payload={"layer": "waves"}, timeout=timeout_s,
    )
