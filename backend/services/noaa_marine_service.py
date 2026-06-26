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
) -> Optional[List[dict]]:
    """
    BACKGROUND-ONLY: fetch a coarse (resolution°) GLOBAL GFS-Wave grid direct from NOAA AWS Open Data
    (byte-range GRIB2 via noaa_gfs_wave_fetcher.py). Returns Open-Meteo-shaped point dicts for all 4 native
    layers (waves/swell_1/swell_2/wind_waves), or None on failure. Slow (~5-15 min, low CPU/mem) — scheduler
    ingestion ONLY, never a user request. GFS-Wave runs to 16 days; we serve up to forecast_days (cap 16).

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
    script = os.path.join(os.path.dirname(__file__), "noaa_gfs_wave_fetcher.py")

    def _run():
        return subprocess.run(
            [sys.executable, "-OO", script, json.dumps(payload)],
            capture_output=True, text=True, timeout=1800,  # 30 min ceiling
        )

    try:
        result = await asyncio.get_event_loop().run_in_executor(None, _run)
        if result.stdout and result.stdout.strip():
            logger.info(f"[NOAA GFS-Wave] {result.stdout.strip().splitlines()[-1]}")
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
        logger.error("[NOAA GFS-Wave] fetcher subprocess timed out (>1800s)")
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
