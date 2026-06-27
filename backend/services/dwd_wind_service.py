"""
DWD Wind Service — ICON 10m wind global-coarse fetcher (open-meteo replacement for ICON wind).

Spawns dwd_icon_wind_fetcher.py (icosahedral GRIB via CLAT/CLON + 3D nearest-neighbor) and returns
Open-Meteo-shaped point dicts (wind_speed_10m [m/s] + wind_direction_10m [°]). The caller
(ingest_icon_wind_global) keeps provider='open-meteo' (manifest byte-identical: source_dataset='dwd_icon').
DWD opendata is public, no creds. Returns None on failure -> caller falls back to open-meteo.
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


async def fetch_icon_wind_global_coarse(
    bbox: dict,
    resolution: float = 10.0,
    forecast_days: int = 8,
) -> Optional[List[dict]]:
    """
    BACKGROUND-ONLY: fetch a coarse (resolution°) GLOBAL ICON 10m wind grid direct from DWD opendata
    (icosahedral GRIB via dwd_icon_wind_fetcher.py). Returns Open-Meteo-shaped point dicts, or None on
    failure. Slow (~5-8 min, ~tens-of-MB peak from the icosahedral arrays) — scheduler ingestion ONLY.
    ICON wind native horizon is ~7.5 days (180h).

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
    out = tmp / f"iconwind_global_{uuid.uuid4().hex}.json"
    payload = {
        "bbox": bbox,
        "resolution": resolution,
        "forecast_days": int(forecast_days),
        "output_path": str(out),
    }
    script = os.path.join(os.path.dirname(__file__), "dwd_icon_wind_fetcher.py")

    def _run():
        return subprocess.run(
            [sys.executable, "-OO", script, json.dumps(payload)],
            capture_output=True, text=True, timeout=1800,
        )

    try:
        result = await asyncio.get_event_loop().run_in_executor(None, _run)
        if result.stdout and result.stdout.strip():
            logger.info(f"[DWD ICON-Wind] {result.stdout.strip().splitlines()[-1]}")
        if result.returncode != 0:
            logger.error(f"[DWD ICON-Wind] fetcher failed (exit {result.returncode}): {result.stderr.strip()[-600:]}")
            return None
        if not out.exists():
            logger.error("[DWD ICON-Wind] fetcher produced no output file")
            return None
        with open(out) as f:
            data = json.load(f)
        return data if data else None
    except subprocess.TimeoutExpired:
        logger.error("[DWD ICON-Wind] fetcher subprocess timed out (>1800s)")
        return None
    except Exception as e:
        logger.error(f"[DWD ICON-Wind] error: {e}")
        return None
    finally:
        try:
            if out.exists():
                out.unlink()
        except Exception:
            pass
