"""location_time.py - the civil time zone at ANY coordinate, for presentation (phase 1, 2026-11-10).

WHY: every surface used a SOLAR offset, round(lng / 15). Measured offline on 20,772 near-spot clicks, that offset was
wrong in January or July at 56.3% of them (DST, half-hour zones, zones that do not follow longitude). This answers the
real IANA zone instead, from a precomputed grid (`scripts/build_location_tz_grid.py`), with no geo library at runtime.

POLICY C' (owner, 2026-11-10): the official zone on land and inside territorial waters; a sea cell whose nearest
OpenStreetMap land is <= 50 km away takes that coast's zone (`coast_snap`); else the nautical Etc/GMT+-N zone. A snapped
cell beside a different coast zone carries `near_border` + `alt_iana` (the client shows a note).

PHASE 1 IS PRESENTATION ONLY: labels and day grouping. It must never choose which UTC instants are sampled or rated,
what an alert is eligible for, or any fetch/rating cache key - `tests/test_location_time_invariance.py` pins that.

CONTRACT (describe()):
  {iana, source: civil|coast_snap|nautical, coast_km_band: [lo, hi] | None, near_border, alt_iana,
   utc_offset_min (int, for `at`), local_date, local_time, at (UTC, echoed), grid}
  or {iana: None, reason: invalid_coordinate | grid_unavailable | grid_corrupt | unknown_zone, ...} - NEVER a solar
  guess presented as civil time.
KILL: the GUARDED flag LOCATION_TIME_FIELD (runtime manifest 'off' within the TTL, no deploy; or env '0').
  Killed -> describe() returns None and every caller behaves exactly as before.
DATA: ODbL 1.0 (OpenStreetMap contributors + timezone-boundary-builder); see data/location_time/LICENSE.md.
"""
import hashlib
import json
import logging
import math
import os
import threading
import time
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from services import runtime_flags as _rf

logger = logging.getLogger(__name__)

FLAG = "LOCATION_TIME_FIELD"
DATA_DIR = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", "data", "location_time"))
_lock = threading.Lock()
_state: Dict[str, Any] = {"grid": None, "error": None, "error_at": 0.0, "manifest": None, "dir": None}
RETRY_S = 300.0          # a failed load is retried after this long (a transient read error must not last the process)
MEM_CAP_BYTES = 8 * 2**20


# DARK until the civil-aware tier window lands (forecast_tier_window.py, outside this change): civil day rows send a
# dateline spot's free tier one row fewer (strict xfail in test_location_time_invariance.py). Owner intent is ON
# (2026-11-10): flip with the runtime manifest ('on', no deploy) once that fix ships, then make this "1".
# Registration in runtime_flags.GUARDED / _RATING_FLAGS is a shared-file change requested from root; until then
# flag(name, default) already honours env > manifest > default.
CODE_DEFAULT = "0"


def enabled() -> bool:
    return _rf.flag(FLAG, CODE_DEFAULT) == "1"


def _read_grid(data_dir: str):
    """(grid, manifest) or raises. Verifies the checksum AND the structure, so a lookup can never index out of range or
    read a neighbouring row's zone (a file can match its manifest and still be malformed)."""
    import numpy as np
    with open(os.path.join(data_dir, "manifest.json"), encoding="utf-8") as fh:
        manifest = json.load(fh)
    path = os.path.join(data_dir, "grid.npz")
    h = hashlib.sha256()
    with open(path, "rb") as fh:                                       # streamed: no second copy of the file in memory
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    digest = h.hexdigest()
    if digest != manifest.get("grid_sha256"):
        raise _Corrupt(f"grid.npz sha256 {digest[:12]} != manifest {str(manifest.get('grid_sha256'))[:12]}")
    with np.load(path, allow_pickle=False) as z:                      # closed: no handle held open on Windows
        res = float(z["res"])
        row_ptr, starts, ids = z["row_ptr"], z["starts"], z["ids"]   # each read is already a fresh array
        cls = {k: [x.item() if hasattr(x, "item") else x for x in z[k]]
               for k in ("cls_iana", "cls_source", "cls_near_border", "cls_alt", "cls_band")}
    nlat, nlon, ncls = int(round(180 / res)), int(round(360 / res)), len(cls["cls_iana"])
    if ncls < 2**16 and ids.dtype != np.uint16:                         # 3,019 classes: half the memory of uint32
        ids = ids.astype(np.uint16)
    lens = np.diff(row_ptr)
    if (len(row_ptr) != nlat + 1 or row_ptr[0] != 0 or row_ptr[-1] != len(starts) or len(starts) != len(ids)
            or (lens <= 0).any() or (starts[row_ptr[:-1]] != 0).any() or int(starts.max()) >= nlon
            or int(ids.max()) >= ncls or any(len(v) != ncls for v in cls.values())):
        raise _Corrupt("grid.npz structure does not match its header")
    grid = {"row_ptr": row_ptr, "starts": starts, "ids": ids, "res": res, "nlat": nlat, "nlon": nlon,
            "iana": [str(x) for x in cls["cls_iana"]], "source": [str(x) for x in cls["cls_source"]],
            "near_border": [bool(x) for x in cls["cls_near_border"]], "alt": [str(x) for x in cls["cls_alt"]],
            "band": [int(x) for x in cls["cls_band"]], "id": f"tz{res:g}/{manifest.get('grid_sha256', '')[:12]}"}
    grid["nbytes"] = int(row_ptr.nbytes + starts.nbytes + ids.nbytes)
    return grid, manifest


class _Corrupt(Exception):
    pass


def _load(data_dir: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Load + verify once per directory. A failure is answered as a reason (never raised) and retried after RETRY_S.
    State is published only when complete, so a concurrent caller never sees a half-loaded grid as 'unavailable'."""
    data_dir = data_dir or DATA_DIR
    st = _state
    if st["dir"] == data_dir and (st["grid"] is not None
                                  or (st["error"] and time.monotonic() - st["error_at"] < RETRY_S)):
        return st["grid"]
    with _lock:
        if _state["dir"] == data_dir and (_state["grid"] is not None
                                          or (_state["error"] and time.monotonic() - _state["error_at"] < RETRY_S)):
            return _state["grid"]
        grid = manifest = error = None
        try:
            grid, manifest = _read_grid(data_dir)
        except FileNotFoundError as e:
            error = "grid_unavailable"
            logger.error("[location_time] grid missing (%s); location_time answers reason=grid_unavailable", e)
        except Exception as e:                                   # noqa: BLE001 - a broken grid is a reason, not a 500
            error = "grid_corrupt"
            logger.error("[location_time] grid load failed: %s", e)
        _state.update(grid=grid, manifest=manifest, error=error, error_at=time.monotonic() if error else 0.0,
                      dir=data_dir)
        return grid


def reset_for_tests() -> None:
    with _lock:
        _state.update(grid=None, error=None, error_at=0.0, manifest=None, dir=None)


def grid_id(data_dir: Optional[str] = None) -> str:
    g = _load(data_dir)
    return g["id"] if g else f"none:{_state['error']}"


def valid_coordinate(lat: Any, lng: Any) -> bool:
    try:
        a, b = float(lat), float(lng)
    except (TypeError, ValueError):
        return False
    return math.isfinite(a) and math.isfinite(b) and -90.0 <= a <= 90.0 and -180.0 <= b <= 180.0


def lookup(lat: float, lng: float, data_dir: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """The cell's class, or None (grid missing/corrupt). Raises ValueError on an invalid coordinate."""
    if not valid_coordinate(lat, lng):
        raise ValueError("invalid coordinate")
    g = _load(data_dir)
    if g is None:
        return None
    import numpy as np
    res = g["res"]
    i = min(g["nlat"] - 1, int((float(lat) + 90.0) / res))
    j = min(g["nlon"] - 1, int((float(lng) + 180.0) / res))
    lo, hi = int(g["row_ptr"][i]), int(g["row_ptr"][i + 1])
    k = lo + int(np.searchsorted(g["starts"][lo:hi], j, side="right")) - 1
    c = int(g["ids"][k])
    band = g["band"][c]
    return {"iana": g["iana"][c], "source": g["source"][c], "near_border": g["near_border"][c],
            "alt_iana": g["alt"][c] or None, "coast_km_band": [band, band + 10] if band >= 0 else None,
            "grid": g["id"]}


def offset_minutes(iana: str, at_utc: datetime) -> int:
    """UTC offset of an INSTANT. `ZoneInfo(z).utcoffset(dt_utc)` would read the UTC wall clock as local time and is wrong
    inside DST transition hours (New York 2026-11-01T05:30Z: -300 instead of -240) - always go through astimezone."""
    return int(at_utc.astimezone(ZoneInfo(iana)).utcoffset().total_seconds() // 60)


def _utc(at: Optional[datetime]) -> datetime:
    at = at or datetime.now(timezone.utc)
    return at.replace(tzinfo=timezone.utc) if at.tzinfo is None else at.astimezone(timezone.utc)


def describe(lat: Any, lng: Any, at: Optional[datetime] = None, data_dir: Optional[str] = None,
             force: bool = False) -> Optional[Dict[str, Any]]:
    """The `location_time` field. None when the flag is off (callers then behave exactly as before)."""
    if not force and not enabled():
        return None
    at_utc = _utc(at)
    at_s = at_utc.strftime("%Y-%m-%dT%H:%M:%SZ")
    if not valid_coordinate(lat, lng):
        return {"iana": None, "reason": "invalid_coordinate", "at": at_s}
    try:
        cell = lookup(lat, lng, data_dir)
    except (IndexError, KeyError, ValueError) as e:                   # structure is checked at load; belt and braces
        logger.error("[location_time] lookup failed at (%s, %s): %s", lat, lng, e)
        return {"iana": None, "reason": "grid_corrupt", "at": at_s}
    if cell is None:
        return {"iana": None, "reason": _state["error"] or "grid_unavailable", "at": at_s}
    try:
        local = at_utc.astimezone(ZoneInfo(cell["iana"]))
    except (ZoneInfoNotFoundError, ValueError, KeyError):
        return {"iana": None, "reason": "unknown_zone", "zone": cell["iana"], "at": at_s, "grid": cell["grid"]}
    out = dict(cell)
    out.update({"utc_offset_min": int(local.utcoffset().total_seconds() // 60),
                "local_date": local.date().isoformat(), "local_time": local.strftime("%Y-%m-%dT%H:%M:%S%z"),
                "at": at_s})
    if cell["alt_iana"]:
        try:
            out["alt_utc_offset_min"] = offset_minutes(cell["alt_iana"], at_utc)
        except (ZoneInfoNotFoundError, ValueError, KeyError):
            out["alt_iana"] = None
    return out


def local_iso(at_utc: datetime, iana: str) -> str:
    """An instant as civil wall time with its offset, e.g. '2026-11-10T06:00:00-1000'."""
    return _utc(at_utc).astimezone(ZoneInfo(iana)).strftime("%Y-%m-%dT%H:%M:%S%z")


def civil_date(at_utc: datetime, iana: str):
    return _utc(at_utc).astimezone(ZoneInfo(iana)).date()


def civil_day_bounds(day, iana: str):
    """[start, end) of a civil date in UTC. Handles 23/25-hour DST days and zones whose midnight is skipped."""
    from datetime import timedelta
    z = ZoneInfo(iana)
    start = datetime(day.year, day.month, day.day, tzinfo=z).astimezone(timezone.utc)
    nxt = day + timedelta(days=1)
    end = datetime(nxt.year, nxt.month, nxt.day, tzinfo=z).astimezone(timezone.utc)
    return start, end
