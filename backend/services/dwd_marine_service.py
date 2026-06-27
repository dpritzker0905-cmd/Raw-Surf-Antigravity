"""
DWD Marine Service — ICON marine (GWAM) global-coarse fetcher (open-meteo replacement for ICON marine).

Spawns dwd_gwam_fetcher.py as a subprocess and returns Open-Meteo-shaped point dicts (waves/swell_1/
wind_waves; gwam has no secondary swell). The caller (ingest_icon_marine_global) consumes it unchanged
with provider='open-meteo' (manifest stays byte-identical: source_dataset='dwd_gwam'). DWD opendata is
public, no creds. Returns None on any failure -> caller falls back to open-meteo.
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


async def fetch_icon_marine_global_coarse(
    bbox: dict,
    resolution: float = 10.0,
    forecast_days: int = 7,
) -> Optional[List[dict]]:
    """
    BACKGROUND-ONLY: fetch a coarse (resolution°) GLOBAL ICON/GWAM marine grid direct from DWD opendata
    (bz2 GRIB2 via dwd_gwam_fetcher.py). Returns Open-Meteo-shaped point dicts (3 layers), or None on
    failure. Slow (~5-10 min, many small downloads, low CPU/mem) — scheduler ingestion ONLY. GWAM horizon
    is ~7.25 days (f174).

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
    out = tmp / f"gwam_global_{uuid.uuid4().hex}.json"
    payload = {
        "bbox": bbox,
        "resolution": resolution,
        "forecast_days": int(forecast_days),
        "output_path": str(out),
    }
    script = os.path.join(os.path.dirname(__file__), "dwd_gwam_fetcher.py")

    def _run():
        return subprocess.run(
            [sys.executable, "-OO", script, json.dumps(payload)],
            capture_output=True, text=True, timeout=1800,  # 30 min ceiling
        )

    try:
        result = await asyncio.get_event_loop().run_in_executor(None, _run)
        if result.stdout and result.stdout.strip():
            logger.info(f"[DWD GWAM] {result.stdout.strip().splitlines()[-1]}")
        if result.returncode != 0:
            logger.error(f"[DWD GWAM] fetcher failed (exit {result.returncode}): {result.stderr.strip()[-600:]}")
            return None
        if not out.exists():
            logger.error("[DWD GWAM] fetcher produced no output file")
            return None
        with open(out) as f:
            data = json.load(f)
        return data if data else None
    except subprocess.TimeoutExpired:
        logger.error("[DWD GWAM] fetcher subprocess timed out (>1800s)")
        return None
    except Exception as e:
        logger.error(f"[DWD GWAM] error: {e}")
        return None
    finally:
        try:
            if out.exists():
                out.unlink()
        except Exception:
            pass
