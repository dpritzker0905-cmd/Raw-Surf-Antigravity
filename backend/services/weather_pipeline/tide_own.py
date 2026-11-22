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
import base64
import gzip
import sys
from array import array
import json
import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Optional

from services.weather_pipeline.config_env import env_float
from core.supabase_auth import supabase_headers
from services.weather_pipeline.tide_credits import CREDITS

logger = logging.getLogger(__name__)

SERIES_KEY = "tide_own/series.json.gz"
PREV_KEY = "tide_own/series.prev.json.gz"        # the last good table: the build keeps it on every publish
SCHEMA = "raw-surf/tide-own/2"   # /2 (2026-11-18): int16 mm series in base64; a reader of /1 refuses a /2 table
LABELS = {                       # (label, credit): the credit is the exact attribution (tide_credits), carried by every series
    "cmems": ("Tide: ocean model sea level (tide + currents; no storm-surge guarantee)", CREDITS["cmems"]),
    "am": ("Tide: astronomical prediction + average sea level (no storm surge); heights above local mean sea level",
           CREDITS["am"]),
}
_TTL_S = env_float("TIDE_OWN_TTL_S", 3600.0)
_FAIL_COOLDOWN_S = 300.0
_TIMEOUT_S = env_float("TIDE_OWN_TIMEOUT_S", 10.0)
# NEVER MISSING (the owner, 2026-11-22: "we don't have missing tide tables ever"). The harmonic tide (A + M) is
# deterministic, so a table keeps serving it for as long as its hourly axis covers today: a build that failed for days
# or weeks changes nothing users see (the build publishes 90 days ahead; publish_guard refuses < 60, alerts < 30).
# Only the CMEMS sea level is a forecast that ages: it is served from a table generated in the last _CMEMS_MAX_AGE_S.
_CMEMS_MAX_AGE_S = 2 * 86400.0
_HORIZON_WARN_DAYS = 30.0
_DISK_PATH = os.environ.get("TIDE_OWN_DISK_CACHE") or os.path.join(
    __import__("tempfile").gettempdir(), "raw-surf-tide-own-series.json.gz")

_state = {"table": None, "read_at": 0.0, "fail_until": 0.0, "disk_gen": None, "etag": None}
_lock = threading.Lock()           # guards _state (held only briefly)
_load_gate = threading.Lock()      # single-flight: at most one download + decode at a time
# T3 (the advisor on #1138): the tide load runs on its OWN one-worker executor, never the default one. On the 1-CPU box
# the default executor's few threads could all park on this load (up to the timeout each) and starve every other
# to_thread caller. With one worker, a second cold caller queues behind the one load instead of taking a thread.
_EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="tide-own-load")
_fetcher = None                   # tests inject callables returning the decoded table (or None, or raising)
_prev_fetcher = None


def key_str(key) -> str:
    """The table's key for a `tide._round_key` tuple: '21.3,-157.9'."""
    return f"{float(key[0]):.1f},{float(key[1]):.1f}"


def _series_ok(d, hours):
    """Each series is a list of mm-or-null, or a base64 string of `hours` little-endian int16 (-32768 = no value)."""
    if not isinstance(d, dict):
        return False
    for v in d.values():
        if isinstance(v, list):
            if len(v) != hours:
                return False
        elif isinstance(v, str):
            if len(v) != 4 * ((2 * hours + 2) // 3):
                return False
        else:
            return False
    return True


_MISSING = -32768                 # int16 sentinel for "no value" (levels are mm, well inside +-32.7 m)


def _pack(d):
    """{key: array('h')} - two bytes per hourly value instead of a Python int per value (about 36 bytes): a full table
    (about 1,800 keys x 1,152 hours x 2 series) then holds a few MB in the serving process, not about 100 MB."""
    out = {}
    for k, vals in d.items():
        if isinstance(vals, str):                  # the builder's compact form: decoding stays near the table's size
            a = array("h")
            a.frombytes(base64.b64decode(vals))
            if sys.byteorder != "little":
                a.byteswap()
        else:
            a = array("h", (_MISSING if v is None else max(-32767, min(32767, int(v))) for v in vals))
        out[k] = a
    return out


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
    return {"start": start, "hours": hours, "am": _pack(am), "cmems": _pack(cm), "generated_at": generated}


def _decode(raw: bytes) -> dict:
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    return json.loads(raw.decode("utf-8"))


NOT_MODIFIED = "not-modified"     # a fetcher's answer when the published table has not changed (HTTP 304)


def _fetch_bucket(object_key: str = SERIES_KEY):
    """The decoded table, None (absent), or NOT_MODIFIED. The published table is asked for conditionally
    (If-None-Match with the last ETag), so a table that changes once a day is not re-downloaded or re-decoded hourly."""
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY", "")
    if not base or not key:
        return None
    import requests
    from services.weather_pipeline.store import WEATHER_BUCKET
    url = f"{base}/storage/v1/object/{WEATHER_BUCKET}/{object_key}"
    headers = dict(supabase_headers(key))
    conditional = object_key == SERIES_KEY and _state.get("etag") and _state.get("table") is not None
    if conditional:
        headers["If-None-Match"] = _state["etag"]
    resp = requests.get(url, headers=headers, timeout=_TIMEOUT_S)
    if resp.status_code == 304 and conditional:
        return NOT_MODIFIED
    if resp.status_code in (400, 404):
        return None
    resp.raise_for_status()
    if object_key == SERIES_KEY:
        _state["pending_etag"] = resp.headers.get("ETag")
    return _decode(resp.content)


def _try(source, fetch):
    """(doc, validated table) from one source, NOT_MODIFIED, or None; never raises."""
    try:
        doc = fetch()
        if doc == NOT_MODIFIED:
            return NOT_MODIFIED
        fresh = validate(doc) if doc is not None else None
    except Exception as e:                                  # noqa: BLE001 - fail safe: the next source is tried
        logger.warning("[tide-own] %s table unreadable (%s)", source, type(e).__name__)
        return None
    return (doc, fresh) if fresh is not None else None


def _read_disk() -> Optional[dict]:
    with open(_DISK_PATH, "rb") as fh:
        return _decode(fh.read())


def _write_disk(doc: dict, generated) -> None:
    """The last good table on local disk (atomic replace), so a restart during a storage outage still has a tide."""
    if _state.get("disk_gen") == generated:
        return
    try:
        tmp = _DISK_PATH + ".tmp"
        with gzip.open(tmp, "wt", encoding="utf-8") as fh:
            json.dump(doc, fh, separators=(",", ":"))
        os.replace(tmp, _DISK_PATH)
        _state["disk_gen"] = generated
    except OSError as e:
        logger.warning("[tide-own] could not keep the table on disk (%s)", type(e).__name__)


def _load_sync(now: float) -> Optional[dict]:
    """The served table. Order: the published table, then the previous good one (the build keeps it), then this
    process's in-memory copy, then the copy on local disk. A table is replaced only by a valid NEWER one.

    SINGLE-FLIGHT (the advisor on #1138): one loader at a time. While a reload runs, other callers get the current
    table at once (no second download or decode on the 1-CPU box); with no table yet (cold start) they wait for the
    one loader, bounded by the timeout, instead of starting their own."""
    with _lock:
        table, read_at, fail_until = _state["table"], _state["read_at"], _state["fail_until"]
    if table is not None and now - read_at < _TTL_S:
        return table
    if now < fail_until:
        return table
    if not _load_gate.acquire(blocking=table is None, timeout=_TIMEOUT_S if table is None else -1):
        with _lock:
            return _state["table"]
    try:
        with _lock:                                       # another loader may have finished while we waited
            if _state["table"] is not None and now - _state["read_at"] < _TTL_S:
                return _state["table"]
            # T1 (the advisor on #1138): ...or FAILED while we waited. A cold waiter must not re-run the whole fetch
            # chain inside the cooldown (that defeats it during a storage outage): it gets the current table.
            if now < _state["fail_until"]:
                return _state["table"]
            table = _state["table"]
        got = _try("published", _fetcher or _fetch_bucket)
        published = got is not None and got != NOT_MODIFIED
        if got == NOT_MODIFIED:                           # unchanged since the last read: nothing to decode
            with _lock:
                _state["read_at"] = now
                return _state["table"]
        if got is None:
            # T2 (the advisor on #1138): an ETag is adopted only with a VALID published table. The published read set
            # pending_etag before validate; it failed or was refused here, so its ETag must not outlive it.
            with _lock:
                _state.pop("pending_etag", None)
            got = _try("previous", _prev_fetcher or (lambda: _fetch_bucket(PREV_KEY)))
            got = None if got == NOT_MODIFIED else got
        if got is None and table is None:
            got = _try("disk", _read_disk)                # cold start during a storage outage
        with _lock:
            if got is not None:
                cur = _state["table"]
                if cur is None or got[1]["generated_at"] >= cur["generated_at"]:
                    _state["table"] = got[1]
                _state["read_at"] = now
                if published and _state.get("pending_etag"):  # T2: only the published branch carries an ETag
                    _state["etag"] = _state.pop("pending_etag")
                _state.pop("pending_etag", None)
            else:
                _state["fail_until"] = now + _FAIL_COOLDOWN_S
            served = _state["table"]
        if got is not None:                               # outside the lock: requests never wait on the disk write
            _write_disk(got[0], got[1]["generated_at"])
            h = horizon_days(served, datetime.now(timezone.utc))
            if h < _HORIZON_WARN_DAYS:
                logger.warning("[tide-own] the served table covers only %.1f days ahead (warn below %.0f)",
                               h, _HORIZON_WARN_DAYS)
        return served
    finally:
        _load_gate.release()


def horizon_days(table: Optional[dict], now: datetime) -> float:
    """Days from `now` to the end of the table's hourly axis (negative when ended; -inf when there is no table)."""
    if table is None:
        return float("-inf")
    return ((table["start"] + timedelta(hours=table["hours"])) - now).total_seconds() / 86400.0


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
        levels.append(None if v is None or v == _MISSING else round(v / 1000.0, 3))
    if all(v is None for v in levels):
        return None
    return {"time": times, "level": levels}


def series_from_table(table: Optional[dict], key, forecast_days: int, now: datetime,
                      prefer_cmems: bool = True) -> Optional[dict]:
    """PURE: {"time": ["YYYY-MM-DDTHH:00", ...], "level": [m, ...], "source", "label", "credit"} from 00Z today for
    `forecast_days` days (the window the old request returned, so callers see the same shape), truncated to the
    series' end. `cmems` first when preferred, present for the key AND from a table generated in the last
    _CMEMS_MAX_AGE_S (a forecast ages); else `am`, which is deterministic and served for as long as the table covers
    today. None when there is no table, its axis no longer covers today, or no series has a value in the window."""
    if table is None:
        return None
    k = key_str(key)
    cmems_fresh = (now - table["generated_at"]).total_seconds() <= _CMEMS_MAX_AGE_S
    order = ("cmems", "am") if (prefer_cmems and cmems_fresh) else ("am",)
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
    now = time.time()
    with _lock:
        table, read_at, fail_until = _state["table"], _state["read_at"], _state["fail_until"]
    # T3's fast path: a fresh table, a cooldown, or a load already running with a table in hand answers at once, with
    # no executor hop (warm callers never queue behind the one worker).
    if table is not None and (now - read_at < _TTL_S or now < fail_until or _load_gate.locked()):
        return series_from_table(table, key, forecast_days, datetime.now(timezone.utc), prefer_cmems)
    try:
        loop = asyncio.get_running_loop()
        table = await asyncio.wait_for(loop.run_in_executor(_EXECUTOR, _load_sync, now), _TIMEOUT_S + 1.0)
    except (asyncio.TimeoutError, TimeoutError):
        logger.warning("[tide-own] table load exceeded its budget")
        with _lock:
            table = _state["table"]
    return series_from_table(table, key, forecast_days, datetime.now(timezone.utc), prefer_cmems)


def _reset_for_tests(fetcher=None, prev_fetcher=None, disk_path=None) -> None:
    """Tests inject the published and previous table sources (callables) and a disk path. With no prev_fetcher given,
    the previous table is absent (never the live bucket)."""
    global _fetcher, _prev_fetcher, _DISK_PATH
    _fetcher = fetcher
    _prev_fetcher = prev_fetcher if prev_fetcher is not None else (lambda: None)
    import tempfile                                     # a fresh, empty disk slot per reset: no test sees another's
    _DISK_PATH = disk_path or os.path.join(tempfile.mkdtemp(prefix="tide-own-test-"), "series.json.gz")
    with _lock:
        _state.update(table=None, read_at=0.0, fail_until=0.0, disk_gen=None, etag=None)
        _state.pop("pending_etag", None)
