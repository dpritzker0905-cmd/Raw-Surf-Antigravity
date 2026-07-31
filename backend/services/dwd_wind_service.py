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


async def fetch_icon_wind_regions(
    bboxes: dict,
    resolution: float = 0.25,
    forecast_days: int = 8,
    timeout_s: int = 1800,
) -> Optional[dict]:
    """MULTI-BBOX single-download-pass: ONE ICON download pass samples EVERY region in `bboxes`
    ({region_id: bbox}) — N regions for one region's download cost.

    WHY: DWD publishes whole-globe files per (var, forecast hour) with NO spatial byte-range — the
    same property that motivated the GWAM multi-bbox fix on 2026-07-13 (run 29249603524 budget
    post-mortem). The wind lane was never ported, so it kept re-downloading identical U_10M/V_10M
    files once per region and rationed the duplication with a clock rotation that left uk_ireland /
    east_australia at 29.8 h. Mirrors fetch_icon_marine_regions.

    Returns {region_id: [Open-Meteo-shaped points]} or None (caller falls back to the per-region
    path). None in test env via the run_fetcher_subprocess short-circuit."""
    if not bboxes:
        return None
    first = next(iter(bboxes.values()))
    data = await run_fetcher_subprocess(
        "dwd_icon_wind_fetcher.py", first, resolution, forecast_days,
        log_tag="DWD ICON-Wind multi", out_prefix="iconwind_regions", timeout=int(timeout_s),
        extra_payload={"bboxes": bboxes},
    )
    if isinstance(data, dict) and data.get("__multi_region__"):
        regions = data.get("regions")
        return regions if regions else None
    return None
