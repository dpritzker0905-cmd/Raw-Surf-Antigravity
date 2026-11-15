"""tide_datum.py - the tide model's own 1-year mean per 0.1-degree cell: the local datum (TIDE_LOCAL_DATUM).

Open-Meteo `sea_level_height_msl` is relative to a GLOBAL reference: at the coast it sits a stable per-place offset from
the local mean sea level (the mean dynamic topography; +0.57 m Hawaii, -0.50 m US Northeast). Subtracting the model's
own long-term mean at the cell removes that offset and keeps real water (seasonal anomaly, multi-day surge). Pre-
registered held-out test, 26 NOAA stations x 4 weeks across the past year, vs OBSERVED water: median RMSE raw 0.414 m,
72 h de-mean 0.180, **1-year mean 0.177**, fitted-offset yardstick 0.127; every US West Coast station within +0.015 m
of raw (docs/weather-program/log/2026-11-15-claude-tide-local-datum.md). The SOTA research
(notes tide-datum-sota-2026-11-15.md) puts >= 12 complete months as the minimum for a model-mean datum.

The table `tides/model_datum.json` is built by CI (`scripts/tide_datum_ingest.py`, `.github/workflows/tide-datum.yml`)
for the cells the catalogued spots need; Render only READS it (6 h cache, 5 min failure cooldown). A cell not in the
table takes the nearest table cell within NEAREST_DEG (the offset varies over hundreds of km); else None, and tide.py
serves the model level unchanged (the status quo) and says so (`datum: model_msl`).
"""
import asyncio
import logging
import math
import os
import time
from typing import Optional

logger = logging.getLogger(__name__)

DATUM_KEY = "tides/model_datum.json"
NEAREST_DEG = 0.5
_TTL_S = 6 * 3600.0
_FAIL_S = 300.0
_TIMEOUT_S = 3.0

_state = {"ts": 0.0, "doc": None, "fail_until": 0.0}
_lock: Optional[asyncio.Lock] = None
_fetch = None   # tests inject an async () -> dict | None


def cell_key(lat, lng) -> str:
    return f"{round(float(lat), 1)},{round(float(lng), 1)}"


def lookup(doc: Optional[dict], lat, lng) -> Optional[float]:
    """PURE: the 1-year model mean for the point's cell, else the nearest table cell within NEAREST_DEG, else None."""
    cells = (doc or {}).get("cells") or {}
    hit = cells.get(cell_key(lat, lng))
    if isinstance(hit, dict) and isinstance(hit.get("mean_m"), (int, float)):
        return float(hit["mean_m"])
    best, best_d = None, None
    la, lo = float(lat), float(lng)
    for k, v in cells.items():
        try:
            cla, clo = (float(x) for x in k.split(","))
        except ValueError:
            continue
        d = math.hypot(cla - la, (clo - lo) * math.cos(math.radians(la)))
        if d <= NEAREST_DEG and isinstance((v or {}).get("mean_m"), (int, float)) and (best_d is None or d < best_d):
            best, best_d = float(v["mean_m"]), d
    return best


async def _bucket_json() -> Optional[dict]:
    if _fetch is not None:
        return await _fetch()
    if os.environ.get("PYTEST_CURRENT_TEST"):
        return None
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    svc = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY", "")
    if not base or not svc:
        return None
    import httpx
    from services.weather_pipeline.store import WEATHER_BUCKET
    async with httpx.AsyncClient(timeout=_TIMEOUT_S) as client:
        resp = await client.get(f"{base}/storage/v1/object/{WEATHER_BUCKET}/{DATUM_KEY}",
                                headers={"Authorization": f"Bearer {svc}", "apikey": svc})
    if resp.status_code in (400, 404):
        return None
    resp.raise_for_status()
    return resp.json()


async def _table() -> Optional[dict]:
    global _lock
    now = time.time()
    if now - _state["ts"] < _TTL_S or now < _state["fail_until"]:
        return _state["doc"]
    if _lock is None:
        _lock = asyncio.Lock()
    async with _lock:
        if time.time() - _state["ts"] < _TTL_S or time.time() < _state["fail_until"]:
            return _state["doc"]
        try:
            doc = await asyncio.wait_for(_bucket_json(), _TIMEOUT_S + 1)
            _state.update(ts=time.time(), doc=doc, fail_until=0.0)
        except asyncio.CancelledError:
            raise
        except Exception as e:                       # noqa: BLE001 - storage trouble = the model level serves
            logger.warning(f"[tide-datum] table unreadable: {type(e).__name__}: {e}"[:200])
            _state.update(fail_until=time.time() + _FAIL_S)
        return _state["doc"]


async def datum_offset(lat, lng) -> Optional[float]:
    """The point's local datum offset (the model's 1-year mean at its cell), or None. Never raises."""
    try:
        return lookup(await _table(), lat, lng)
    except asyncio.CancelledError:
        raise
    except Exception as e:                           # noqa: BLE001
        logger.warning(f"[tide-datum] lookup failed at ({lat},{lng}): {e}"[:200])
        return None


def _reset_for_tests(fetch=None):
    global _fetch, _lock
    _state.update(ts=0.0, doc=None, fail_until=0.0)
    _lock = None
    _fetch = fetch
