"""tide_own.py - the served tide from OUR OWN data: FES2022b astronomical tide + the altimetry mean level (A + M).

WHY: the owner, 2026-11-18: "No user data should be open-meteo" (13:13Z), then "use open-meteo only if not using it
causes a downgrade in forecast or service". The served tide was Open-Meteo
`sea_level_height_msl`. It now comes from a table our CI builds (`scripts/tide_own/build_series.py`, workflow
`tide-own-series.yml`), the same arm the tide gates G3t and G4 measure:
  A = FES2022b ocean tide + its long-period equilibrium term (PyFES, run ONLY in CI: PyFES is GPL and never enters
      this backend; the FES constants never leave CI either, only predictions do);
  M = the 2016-2025 mean of the altimetry sea-level anomaly at the G3t cell rule (Copernicus Marine), one constant per
      key, so the curve sits on today's mean sea level.
Metres relative to mean sea level, hourly, per 0.1-degree key (`tide._round_key`), from 3 days back to ~45 days ahead.

NO STORM SURGE. Where the table has no value (FES has no water there, M is not computed yet, or the table is
missing/stale) this returns None and `tide.fetch_tide_hourly` falls back to Open-Meteo FOR THAT KEY ONLY (a blank tide
is a service downgrade); the series it returns says which source it is. The kill switch `SURF_TIDE_OWN=0` serves
Open-Meteo everywhere, the pre-change behaviour.

The table is read from the weather bucket at most once per TTL per process; a failed read cools down and keeps the
last good table. A request never blocks on storage longer than `TIDE_OWN_TIMEOUT_S`.
"""
import asyncio
import gzip
import json
import logging
import os
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

logger = logging.getLogger(__name__)

SERIES_KEY = "tide_own/series.json.gz"
SCHEMA = "raw-surf/tide-own/1"
LABEL = "Tide: astronomical prediction + average sea level (no storm surge)"
CREDITS = "FES2022 (AVISO/CNES/LEGOS/NOVELTIS); Copernicus Marine Service (altimetry mean sea level)"
_TTL_S = float(os.environ.get("TIDE_OWN_TTL_S", "3600"))
_FAIL_COOLDOWN_S = 300.0
_TIMEOUT_S = float(os.environ.get("TIDE_OWN_TIMEOUT_S", "10"))
_MAX_AGE_S = 7 * 86400.0          # a table older than this is not served (the CI job runs every 3 days)

_state = {"table": None, "read_at": 0.0, "fail_until": 0.0}
_lock = threading.Lock()
_fetcher = None                   # tests inject a callable returning the decoded table (or None)


def key_str(key) -> str:
    """The table's key for a `tide._round_key` tuple: '21.3,-157.9'."""
    return f"{float(key[0]):.1f},{float(key[1]):.1f}"


def validate(doc) -> Optional[dict]:
    """The table if it has the expected shape, else None. Levels are integer millimetres or null."""
    if not isinstance(doc, dict) or doc.get("schema") != SCHEMA:
        return None
    try:
        start = datetime.fromisoformat(str(doc["start"])).replace(tzinfo=timezone.utc)
        hours = int(doc["hours"])
        keys = doc["keys"]
        generated = datetime.fromisoformat(str(doc["generated_at"]).replace("Z", "+00:00"))
    except (KeyError, TypeError, ValueError):
        return None
    if hours <= 0 or not isinstance(keys, dict):
        return None
    if any(not isinstance(v, list) or len(v) != hours for v in keys.values()):
        return None
    return {"start": start, "hours": hours, "keys": keys, "generated_at": generated}


def _fetch_bucket() -> Optional[dict]:
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY", "")
    if not base or not key:
        return None
    import requests
    from services.weather_pipeline.store import WEATHER_BUCKET
    url = f"{base}/storage/v1/object/{WEATHER_BUCKET}/{SERIES_KEY}"
    resp = requests.get(url, headers={"Authorization": f"Bearer {key}", "apikey": key}, timeout=_TIMEOUT_S)
    if resp.status_code in (400, 404):
        return None
    resp.raise_for_status()
    raw = resp.content
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    return json.loads(raw.decode("utf-8"))


def _load_sync(now: float) -> Optional[dict]:
    with _lock:
        table, read_at, fail_until = _state["table"], _state["read_at"], _state["fail_until"]
    if table is not None and now - read_at < _TTL_S:
        return table
    if now < fail_until:
        return table
    try:
        doc = (_fetcher or _fetch_bucket)()
        fresh = validate(doc) if doc is not None else None
    except Exception as e:                                  # noqa: BLE001 - fail safe: keep the last good table
        logger.warning("[tide-own] table unreadable (%s); keeping the last good table", type(e).__name__)
        fresh = None
    with _lock:
        if fresh is not None:
            _state["table"], _state["read_at"] = fresh, now
        else:
            _state["fail_until"] = now + _FAIL_COOLDOWN_S
        return _state["table"]


def series_from_table(table: Optional[dict], key, forecast_days: int, now: datetime) -> Optional[dict]:
    """PURE: {"time": ["YYYY-MM-DDTHH:00", ...], "level": [m, ...]} from 00Z today for `forecast_days` days (the
    window the Open-Meteo request returned, so callers see the same shape), truncated to the table's end. None when
    the table is missing or too old, the key is absent, or the window holds no value."""
    if table is None:
        return None
    if (now - table["generated_at"]).total_seconds() > _MAX_AGE_S:
        return None
    vals = table["keys"].get(key_str(key))
    if vals is None:
        return None
    day0 = now.astimezone(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    i0 = int((day0 - table["start"]).total_seconds() // 3600)
    i1 = min(i0 + 24 * int(forecast_days), table["hours"])
    if i0 < 0 or i0 >= i1:
        return None
    times, levels = [], []
    for i in range(i0, i1):
        v = vals[i]
        times.append((table["start"] + timedelta(hours=i)).strftime("%Y-%m-%dT%H:00"))
        levels.append(None if v is None else round(v / 1000.0, 3))
    if all(v is None for v in levels):
        return None
    return {"time": times, "level": levels}


async def fetch_series(key, forecast_days: int = 3) -> Optional[dict]:
    """The served tide series for a rounded key, or None (tide unavailable). Never raises; bounded by the timeout."""
    try:
        table = await asyncio.wait_for(asyncio.to_thread(_load_sync, time.time()), _TIMEOUT_S + 1.0)
    except (asyncio.TimeoutError, TimeoutError):
        logger.warning("[tide-own] table load exceeded its budget")
        with _lock:
            table = _state["table"]
    return series_from_table(table, key, forecast_days, datetime.now(timezone.utc))


def _reset_for_tests(fetcher=None) -> None:
    global _fetcher
    _fetcher = fetcher
    with _lock:
        _state.update(table=None, read_at=0.0, fail_until=0.0)
