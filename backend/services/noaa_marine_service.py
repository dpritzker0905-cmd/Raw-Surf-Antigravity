"""
NOAA Marine Service — GFS-Wave global-coarse fetcher (open-meteo replacement for GFS marine).

Spawns the low-strain byte-range GRIB2 fetcher (noaa_gfs_wave_fetcher.py) as a subprocess and returns
Open-Meteo-shaped point dicts (all 4 layers, REAL ncep_gfswave025 partitions) — the SAME schema the
open-meteo all_marine path returns, so the caller (ingest_gfs_marine_global) consumes it unchanged with
provider='open-meteo' (manifest stays byte-identical → zero regression). NOAA is public-domain, no creds.

Returns None on any failure → caller falls through to the existing open-meteo path (no regression).
"""

import os
import logging
from typing import List, Optional

logger = logging.getLogger(__name__)


def _is_test_environment() -> bool:
    import sys
    node_env = os.environ.get("NODE_ENV", "").lower()
    env = os.environ.get("ENV", "").lower()
    is_prod_env = os.environ.get("IS_PROD", "").lower()
    if node_env == "production" or env == "production" or is_prod_env == "true":
        return False
    return (
        "pytest" in sys.modules
        or os.environ.get("NODE_ENV") == "test"
        or os.environ.get("LOCAL_TEST_FIXTURE") == "true"
        or os.environ.get("TESTING") == "1"
    )


async def fetch_gfs_marine_global_coarse(
    bbox: dict,
    resolution: float = 10.0,
    forecast_days: int = 14,
    bboxes: Optional[dict] = None,
):
    """
    BACKGROUND-ONLY: fetch a coarse (resolution°) GLOBAL GFS-Wave grid direct from NOAA AWS Open Data
    (byte-range GRIB2 via noaa_gfs_wave_fetcher.py). Returns Open-Meteo-shaped point dicts for all 4 native
    layers (waves/swell_1/swell_2/wind_waves), or None on failure. Slow (~5-15 min, low CPU/mem) — scheduler
    ingestion ONLY, never a user request. GFS-Wave runs to 16 days; we serve up to forecast_days (cap 16).

    ``bboxes`` ({region_id: bbox}) switches the fetcher to MULTI-REGION mode and the return becomes the
    keyed envelope {"__multi_region__": True, "regions": {...}} — use fetch_gfs_marine_regions rather
    than calling this with bboxes directly. Threaded through the SAME subprocess plumbing on purpose:
    a second copy of the spawn/timeout/cleanup logic is how two paths drift apart.

    In a test environment returns None so the existing open-meteo mock path runs unchanged.
    """
    if _is_test_environment():
        return None

    import asyncio
    import subprocess
    import sys
    import json
    import tempfile
    import uuid
    from pathlib import Path

    tmp = Path(tempfile.gettempdir())
    out = tmp / f"gfswave_global_{uuid.uuid4().hex}.json"
    payload = {
        "bbox": bbox,
        "resolution": resolution,
        "forecast_days": int(forecast_days),
        "output_path": str(out),
    }
    if bboxes:
        payload["bboxes"] = dict(bboxes)
    script = os.path.join(os.path.dirname(__file__), "noaa_gfs_wave_fetcher.py")

    # HARD ceiling — a BACKSTOP, not the primary control. The fetcher's own NOAA_FETCH_BUDGET_S
    # (default 2400 s) stops it first and returns the hours already in hand; this kill only fires if
    # that soft deadline is disabled or the process wedges beneath it. Deliberately ABOVE the soft
    # budget so a slow-but-working run is never killed mid-serialization.
    # Raised from a hardcoded 1800 s on 2026-08-02: upstream throughput roughly halved (8.8 ->
    # ~14-17 s/step) and the global_mid 14-day pass — the heaviest fetch in the system — began
    # hitting the wall EVERY cycle, discarding ~30 min of downloaded GRIB and stranding the lane at
    # 19.8 h stale while every other GFS-marine job in the same run succeeded. Sized against the
    # pilots lane's 200-min budget (worst case ~154 min). Tune with NOAA_FETCH_TIMEOUT_S.
    hard_timeout_s = float(os.environ.get("NOAA_FETCH_TIMEOUT_S", "2700"))

    def _run():
        return subprocess.run(
            [sys.executable, "-OO", script, json.dumps(payload)],
            capture_output=True, text=True, timeout=hard_timeout_s,
        )

    try:
        result = await asyncio.get_event_loop().run_in_executor(None, _run)
        if result.stdout and result.stdout.strip():
            logger.info(f"[NOAA GFS-Wave] {result.stdout.strip().splitlines()[-1]}")
        # Surface stderr on SUCCESS too: the soft-deadline truncation and the coverage-floor refusal
        # both report there, and a degraded success that logs nothing is how a silent horizon cut
        # would ship unnoticed. Tail-capped; per-step failures share this channel.
        if result.returncode == 0 and result.stderr and result.stderr.strip():
            logger.warning(f"[NOAA GFS-Wave] fetcher stderr: {result.stderr.strip()[-600:]}")
        if result.returncode != 0:
            logger.error(f"[NOAA GFS-Wave] fetcher failed (exit {result.returncode}): {result.stderr.strip()[-600:]}")
            return None
        if not out.exists():
            logger.error("[NOAA GFS-Wave] fetcher produced no output file")
            return None
        with open(out) as f:
            data = json.load(f)
        return data if data else None
    except subprocess.TimeoutExpired:
        # Reaching HERE means the soft deadline did not fire (disabled, or the process wedged inside
        # a single step) — everything fetched is lost. Say which wall was hit, not a stale literal.
        logger.error(f"[NOAA GFS-Wave] fetcher subprocess timed out (>{hard_timeout_s:.0f}s hard "
                     f"ceiling; NOAA_FETCH_BUDGET_S should have salvaged a partial result first)")
        return None
    except Exception as e:
        logger.error(f"[NOAA GFS-Wave] error: {e}")
        return None
    finally:
        try:
            if out.exists():
                out.unlink()
        except Exception:
            pass


async def fetch_gfs_marine_regions(
    bboxes: dict,
    resolution: float = 0.25,
    forecast_days: int = 3,
) -> Optional[dict]:
    """MULTI-BBOX single-download-pass: ONE GFS-Wave download pass samples EVERY region in `bboxes`
    ({region_id: bbox}) — N regions for one region's download cost.

    WHY (measured 2026-07-31): NOAA's byte-range selects a GRIB *message*, not a region, and a
    message is the whole global 0.25° field — so the bbox never touches the wire and per-region
    passes re-downloaded identical bytes. Rationing that duplication by ROTATION is what left
    uk_ireland and east_australia on an 18.7-day-old run with no covering product, which the serve
    path then answered by falling through to the 2° global_mid tile (uk_ireland) or by a LIVE
    per-request upstream fetch (east_australia, `source: backend_direct_point`). The rotation was
    converting a batch cost into per-request compute on a box with three melt incidents.
    Mirrors fetch_icon_marine_regions / fetch_gfs_wind_regions.

    Returns {region_id: [Open-Meteo-shaped points]} or None (caller falls back to the per-region
    path). None in test env, same as the single-bbox fetcher."""
    if not bboxes:
        return None
    first = next(iter(bboxes.values()))
    data = await fetch_gfs_marine_global_coarse(
        first, resolution, forecast_days, bboxes=dict(bboxes))
    if isinstance(data, dict) and data.get("__multi_region__"):
        regions = data.get("regions")
        return regions if regions else None
    return None
