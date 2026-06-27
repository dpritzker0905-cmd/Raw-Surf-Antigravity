"""
NOAA Pressure Service — GFS MSL pressure global-coarse fetcher (open-meteo replacement for GFS pressure).

Spawns noaa_gfs_pressure_fetcher.py and returns Open-Meteo-shaped point dicts (pressure_msl [hPa]). The
caller (ingest_gfs_pressure_global) keeps provider='open-meteo' (manifest byte-identical:
source_dataset='gfs_seamless'). Public NOAA data, no creds. Returns None on failure -> open-meteo fallback.
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


async def fetch_gfs_pressure_global_coarse(
    bbox: dict,
    resolution: float = 10.0,
    forecast_days: int = 16,
) -> Optional[List[dict]]:
    """
    BACKGROUND-ONLY: fetch a coarse (resolution°) GLOBAL GFS MSL-pressure grid direct from NOAA AWS Open
    Data (byte-range PRMSL via noaa_gfs_pressure_fetcher.py). Returns Open-Meteo-shaped point dicts, or None
    on failure. Slow (~3-6 min, low CPU/mem) — scheduler ingestion ONLY.

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
    out = tmp / f"gfsprmsl_global_{uuid.uuid4().hex}.json"
    payload = {
        "bbox": bbox,
        "resolution": resolution,
        "forecast_days": int(forecast_days),
        "output_path": str(out),
    }
    script = os.path.join(os.path.dirname(__file__), "noaa_gfs_pressure_fetcher.py")

    def _run():
        return subprocess.run(
            [sys.executable, "-OO", script, json.dumps(payload)],
            capture_output=True, text=True, timeout=1800,
        )

    try:
        result = await asyncio.get_event_loop().run_in_executor(None, _run)
        if result.stdout and result.stdout.strip():
            logger.info(f"[NOAA GFS-Pressure] {result.stdout.strip().splitlines()[-1]}")
        if result.returncode != 0:
            logger.error(f"[NOAA GFS-Pressure] fetcher failed (exit {result.returncode}): {result.stderr.strip()[-600:]}")
            return None
        if not out.exists():
            logger.error("[NOAA GFS-Pressure] fetcher produced no output file")
            return None
        with open(out) as f:
            data = json.load(f)
        return data if data else None
    except subprocess.TimeoutExpired:
        logger.error("[NOAA GFS-Pressure] fetcher subprocess timed out (>1800s)")
        return None
    except Exception as e:
        logger.error(f"[NOAA GFS-Pressure] error: {e}")
        return None
    finally:
        try:
            if out.exists():
                out.unlink()
        except Exception:
            pass
