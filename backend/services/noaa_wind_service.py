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
    timeout_sec: Optional[int] = None,
) -> Optional[List[dict]]:
    """BACKGROUND-ONLY: coarse GLOBAL GFS 10 m wind grid direct from NOAA AWS Open Data (byte-range
    GRIB2). Slow (~3-6 min, low CPU/mem) — scheduler ingestion or the wind native-recovery lane
    ONLY (never the serve path). ``timeout_sec`` bounds the subprocess (recovery passes ~900s;
    unset keeps the scheduler's 1800s default). None in test env."""
    kwargs = {"timeout": int(timeout_sec)} if timeout_sec else {}
    return await run_fetcher_subprocess(
        "noaa_gfs_wind_fetcher.py", bbox, resolution, forecast_days,
        log_tag="NOAA GFS-Wind", out_prefix="gfswind_global", **kwargs,
    )


async def fetch_gfs_wind_regions(
    bboxes: dict,
    resolution: float = 0.25,
    forecast_days: int = 8,
    timeout_s: int = 1800,
) -> Optional[dict]:
    """MULTI-BBOX single-download-pass: ONE GFS wind download pass samples EVERY region in `bboxes`
    ({region_id: bbox}) — N regions for one region's download cost.

    WHY (measured live 2026-07-31, 20260731 12Z cycle): NOAA's byte-range selects a GRIB *message*,
    not a region, and a message is the whole global 0.25° field — UGRD 591,525 B + VGRD 572,474 B per
    step, byte-identical for a 609-point Hawaii box and a 2,009-point uk_ireland box. Per-region
    passes re-downloaded those same bytes once per region (77.7 MB / 195 requests each at the 8-day
    horizon). That redundancy is the entire reason the pilot lane rationed regions by ROTATION, and
    the rotation is what let Hawaii's wind reach a 75 h-old run behind a current valid_time.
    Mirrors fetch_icon_marine_regions (dwd_marine_service), the 2026-07-13 GWAM precedent.

    Returns {region_id: [Open-Meteo-shaped points]} or None (caller falls back to the per-region
    path). None in test env via the run_fetcher_subprocess short-circuit, same as every fetcher."""
    if not bboxes:
        return None
    first = next(iter(bboxes.values()))
    data = await run_fetcher_subprocess(
        "noaa_gfs_wind_fetcher.py", first, resolution, forecast_days,
        log_tag="NOAA GFS-Wind multi", out_prefix="gfswind_regions", timeout=int(timeout_s),
        extra_payload={"bboxes": bboxes},
    )
    if isinstance(data, dict) and data.get("__multi_region__"):
        regions = data.get("regions")
        return regions if regions else None
    return None
