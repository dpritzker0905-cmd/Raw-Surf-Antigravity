"""
DWD Marine Service — ICON marine (GWAM) global-coarse fetcher (open-meteo replacement for ICON marine).

Spawns dwd_gwam_fetcher.py off the request path and returns Open-Meteo-shaped point dicts (waves/
swell_1/wind_waves; gwam has no secondary swell). The caller (ingest_icon_marine_global) keeps
provider='open-meteo' (manifest byte-identical: source_dataset='dwd_gwam'). DWD opendata is public, no
creds. Returns None on failure / in test env -> open-meteo fallback. Subprocess plumbing lives in
_fetch_common.run_fetcher_subprocess.
"""
from typing import List, Optional

from services._fetch_common import run_fetcher_subprocess


async def fetch_icon_marine_global_coarse(
    bbox: dict,
    resolution: float = 10.0,
    forecast_days: int = 7,
    timeout_s: int = 1800,
) -> Optional[List[dict]]:
    """BACKGROUND-ONLY: coarse GLOBAL ICON/GWAM marine grid direct from DWD opendata (bz2 GRIB2).
    Slow (~5-10 min, many small downloads, low CPU/mem) — scheduler ingestion ONLY. GWAM horizon
    ~7.25 days (f174). None in test env. `timeout_s`: the regional PILOT passes a tight 600 s so a
    DWD-throttled pass (repeat whole-globe downloads from one runner IP, 2026-07-13 pilots-run
    hang) fails fast to the open-meteo fallback instead of riding the full 30-min cap per region."""
    return await run_fetcher_subprocess(
        "dwd_gwam_fetcher.py", bbox, resolution, forecast_days,
        log_tag="DWD GWAM", out_prefix="gwam_global", timeout=timeout_s,
    )


async def fetch_icon_marine_regions(
    bboxes: dict,
    resolution: float = 0.25,
    forecast_days: int = 2,
    timeout_s: int = 900,
) -> Optional[dict]:
    """MULTI-BBOX single-download-pass (2026-07-13): ONE GWAM download pass samples EVERY region in
    `bboxes` ({region_id: bbox}) — N regions for one region's download cost (DWD has no spatial
    byte-range; per-region passes re-download identical whole-globe files, the pilots-lane budget
    lesson from run 29249603524). Returns {region_id: [Open-Meteo-shaped points]} or None (caller
    falls back to the per-region flagship path). None in test env (run_fetcher_subprocess
    short-circuit, same as every fetcher)."""
    if not bboxes:
        return None
    first = next(iter(bboxes.values()))
    data = await run_fetcher_subprocess(
        "dwd_gwam_fetcher.py", first, resolution, forecast_days,
        log_tag="DWD GWAM multi", out_prefix="gwam_regions", timeout=timeout_s,
        extra_payload={"bboxes": bboxes},
    )
    if isinstance(data, dict) and data.get("__multi_region__"):
        regions = data.get("regions")
        return regions if regions else None
    return None
