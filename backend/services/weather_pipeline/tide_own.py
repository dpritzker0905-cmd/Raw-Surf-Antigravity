"""tide_own.py - the served tide level from sources WE read directly; no Open-Meteo in any user-facing number.

WHY: the owner, 2026-11-18 ~23:00Z (via the director): cut Open-Meteo out of all user data; it is for internal testing
only (licence). The served tide was Open-Meteo `sea_level_height_msl`, which is itself CMEMS
`cmems_mod_glo_phy_anfc_merged-sl_PT1H-i` (the research lead's finding). Our CI (`scripts/tide_own/build_series.py`,
workflow `tide-own-series.yml`) builds ONE table with up to two series per 0.1-degree key (`tide._round_key`):
  cmems  CMEMS `total_sea_level` at the nearest cell, read directly (the same numbers the served level had; parity
         proven first by M1-0, `scripts/tide_cmems`), hourly, about 3 days back to ~9 days ahead;
  am     our harmonic tide A + M: FES2022b ocean tide + long-period equilibrium (PyFES in CI only; GPL, never in this
         backend; only predictions leave CI) + the 2016-2025 altimetry mean level at the G3t cell rule (the arm the tide
         gates G3t / G4 measure), 3 days back to 45 days ahead.
Order at serve time, per key: `cmems` when SURF_TIDE_CMEMS is on and the key has it, else `am`, else None ("tide
unavailable"). NEVER Open-Meteo. The kill switches: SURF_TIDE_CMEMS=0 serves the harmonic tide everywhere;
SURF_TIDE_OWN=0 serves no tide (honest "unavailable"). Every series says its source and carries its label.

NO STORM SURGE in `am`; `cmems` is the ocean model's total sea level (tide + dynamic sea level), as served before.
The two sources sit on different references (`cmems`: above the geoid, as Open-Meteo's level was; `am`: mean sea
level), so a key never mixes them within one series.

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
LABELS = {
    "cmems": ("Tide: ocean model sea level (tide + currents; no storm-surge guarantee)",
              "Copernicus Marine Service (Global Ocean Physics Analysis and Forecast)"),
    "am": ("Tide: astronomical prediction + average sea level (no storm surge)",
           "FES2022 (AVISO/CNES/LEGOS/NOVELTIS); Copernicus Marine Service (altimetry mean sea level)"),
}
_TTL_S = float(os.environ.get("TIDE_OWN_TTL_S", "3600"))
_FAIL_COOLDOWN_S = 300.0
_TIMEOUT_S = float(os.environ.get("TIDE_OWN_TIMEOUT_S", "10"))
_MAX_AGE_S = 7 * 86400.0          # a table older than this is not served (the CI job runs daily)

_state = {"table": None, "read_at": 0.0, "fail_until": 0.0}
_lock = threading.Lock()
_fetcher = None                   # tests inject a callable returning the decoded table (or None)


def key_str(key) -> str:
    """The table's key for a `tide._round_key` tuple: '21.3,-157.9'."""
    return f"{float(key[0]):.1f},{float(key[1]):.1f}"


def _series_ok(d, hours):
    return isinstance(d, dict) and all(isinstance(v, list) and len(v) == hours for v in d.values())


def validate(doc) -> Optional[dict]:
    """The table if it has the expected shape, else None. Levels are integer millimetres or null. `keys` is the
    harmonic (am) series; `cmems` (optional) the CMEMS direct read, on the same hourly axis."""
    if not isinstance(doc, dict) or doc.get("schema") != SCHEMA:
        return None
    try:
        start = datetime.fromisoformat(str(doc["start"])).replace(tzinfo=timezone.utc)
        hours = int(doc["hours"])
        am = doc["keys"]
        cm = doc.get("cmems") or {}
        generated = datetime.fromisoformat(str(doc["generated_at"]).replace("Z", "+00:00"))
    except (KeyError, TypeError, ValueError):
        return None
    if hours <= 0 or not _series_ok(am, hours) or not _series_ok(cm, hours):
        return None
    return {"start": start, "hours": hours, "am": am, "cmems": cm, "generated_at": generated}


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


def _slice(table, vals, forecast_days, now):
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


def series_from_table(table: Optional[dict], key, forecast_days: int, now: datetime,
                      prefer_cmems: bool = True) -> Optional[dict]:
    """PURE: {"time": ["YYYY-MM-DDTHH:00", ...], "level": [m, ...], "source", "label", "credit"} from 00Z today for
    `forecast_days` days (the window the old request returned, so callers see the same shape), truncated to the
    series' end. `cmems` first when preferred and present for the key, else `am`. None when the table is missing or
    too old, or neither series has a value for the key in the window."""
    if table is None or (now - table["generated_at"]).total_seconds() > _MAX_AGE_S:
        return None
    k = key_str(key)
    order = ("cmems", "am") if prefer_cmems else ("am",)
    for src in order:
        vals = table[src].get(k)
        if vals is None:
            continue
        s = _slice(table, vals, forecast_days, now)
        if s is not None:
            label, credit = LABELS[src]
            return dict(s, source=src, label=label, credit=credit)
    return None


async def fetch_series(key, forecast_days: int = 3, prefer_cmems: bool = True) -> Optional[dict]:
    """The served tide series for a rounded key, or None (tide unavailable). Never raises; bounded by the timeout."""
    try:
        table = await asyncio.wait_for(asyncio.to_thread(_load_sync, time.time()), _TIMEOUT_S + 1.0)
    except (asyncio.TimeoutError, TimeoutError):
        logger.warning("[tide-own] table load exceeded its budget")
        with _lock:
            table = _state["table"]
    return series_from_table(table, key, forecast_days, datetime.now(timezone.utc), prefer_cmems)


def _reset_for_tests(fetcher=None) -> None:
    global _fetcher
    _fetcher = fetcher
    with _lock:
        _state.update(table=None, read_at=0.0, fail_until=0.0)
