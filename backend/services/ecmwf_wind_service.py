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
    timeout_sec: Optional[int] = None,
) -> Optional[List[dict]]:
    """BACKGROUND-ONLY: coarse GLOBAL EURO 10 m wind grid direct from ECMWF Open Data (IFS 0.25° GRIB).
    Slow (~3-6 min, low CPU/mem) — scheduler ingestion or the wind native-recovery lane ONLY (never
    the serve path). Native horizon 10d (240h, 00/12 runs). ``timeout_sec`` bounds the subprocess
    (recovery passes ~900s; unset keeps the scheduler's 1800s default). None in test env."""
    kwargs = {"timeout": int(timeout_sec)} if timeout_sec else {}
    return await run_fetcher_subprocess(
        "ecmwf_opendata_fetcher.py", bbox, resolution, forecast_days,
        log_tag="ECMWF EURO-Wind", out_prefix="ecmwfwind_global",
        extra_payload={"layer": "wind"}, **kwargs,
    )


async def fetch_euro_wind_regions(
    bboxes: dict,
    resolution: float = 0.25,
    forecast_days: int = 8,
    timeout_s: int = 1800,
) -> Optional[dict]:
    """MULTI-BBOX single-download-pass: ONE ECMWF retrieve samples EVERY region in `bboxes`
    ({region_id: bbox}) — N regions for one region's download cost (ECMWF ships a single whole-globe
    multi-step file, so a per-region pass re-downloads identical bytes).

    THE FETCHER ALREADY SUPPORTED THIS since 2026-07-13 — `ecmwf_opendata_fetcher.fetch_global_coarse`
    honours `bboxes` for any layer — but only the WAVES lane was ever wired to it
    (fetch_euro_marine_waves_regions). The wind lane kept fetching per region, so it stayed on the
    clock rotation that left uk_ireland / east_australia at 29.3 h. The capability was built and left
    unconsumed on this layer: attachment != consumption, at the service boundary this time.

    Returns {region_id: [Open-Meteo-shaped points]} or None (caller falls back to the per-region
    path). None in test env via the run_fetcher_subprocess short-circuit."""
    if not bboxes:
        return None
    first = next(iter(bboxes.values()))
    data = await run_fetcher_subprocess(
        "ecmwf_opendata_fetcher.py", first, resolution, forecast_days,
        log_tag="ECMWF EURO-Wind multi", out_prefix="ecmwfwind_regions", timeout=int(timeout_s),
        extra_payload={"layer": "wind", "bboxes": bboxes},
    )
    if isinstance(data, dict) and data.get("__multi_region__"):
        regions = data.get("regions")
        return regions if regions else None
    return None
