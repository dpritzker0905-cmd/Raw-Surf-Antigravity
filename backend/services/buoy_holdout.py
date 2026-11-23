"""buoy_holdout.py - the ONE fence around the LOCKED final buoy holdout (#1199 served-wave-skill-v1 section 1a), for EVERY
module that reads buoy truth. STDLIB ONLY, so scripts run by path and fetcher subprocesses can import it.

WHY. #1199 locks 20 % of the eligible buoys per region (seed 1199; the list and its SHA-256 committed at freeze). No gate,
ablation, calibration, fit or diagnostic may read a LOCKED buoy before the pre-registered LOCKED WINDOW (2027-03-01 to
2027-04-30). An unlogged read voids the holdout. LOCKED buoys are still COLLECTED (archived) for that window.

THE RECORD (one place). The served-wave buoy list (`docs/weather-program/gates/served-wave-verify-v1-buoys.json`) carries
`holdout.locked_list` = null until the freeze, then {"path", "sha256"} naming the committed locked list (the SHA-256 of
its raw bytes), and each station's `locked` tag. This module verifies that record and returns the locked ids, each with
its aliases (station id, WMO id and, for a CDIP buoy, CDIP's station number; upper case).

STATES (state()["status"]):
  * "none"       - no list recorded (today): locked() is empty and every consumer behaves exactly as before;
  * "verified"   - the list verifies: locked() is its ids plus their aliases;
  * "quarantine" - a list is recorded but does NOT verify (missing, hash mismatch, unknown or duplicate ids, tags that
                   disagree): FAIL CLOSED without crashing production. locked() is the WHOLE drawn-from pool (every
                   station of the buoy list, with aliases), and the reason is printed once to stderr. No second source
                   of truth is trusted (advisors, 2026-11-23: Reflection; SubQ).

THE API (every buoy-truth consumer uses it AT LOAD, before any aggregation or join):
  is_locked(station_id) / keep(station_id)  one id
  drop(rows, key)                            rows minus the locked ones (key: a field name or a callable)
  allow_url(url)                             False when a URL names a locked station (a runtime gate in every fetch path,
                                             so a URL built at runtime is caught too)
  redact(text)                               every locked id replaced by <locked> (public Actions logs, reports)
  declare_collector(name, why)               a module whose only job is to ARCHIVE raw truth for the locked window says
                                             so; it still redacts what it prints (tests/test_buoy_holdout_guard.py)
The guard test scans backend/ and fails on any module that touches buoy truth without one of these.
The strict served-wave scorer keeps its own NOT_READ rule (point_archive/holdout.py), which reads this same record.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
BUOY_LIST = "docs/weather-program/gates/served-wave-verify-v1-buoys.json"
REDACTED = "<locked>"
ENV_ROOT = "RAW_SURF_HOLDOUT_REPO_ROOT"          # tests only: read the record under another root

_CACHE = {}
_COLLECTORS = {}


class HoldoutError(ValueError):
    """The recorded locked list does not verify."""


def _root():
    return Path(os.environ.get(ENV_ROOT) or REPO_ROOT)


def _aliases(station):
    """Every id a consumer may use for this station: its id, its WMO id and, for a CDIP buoy, CDIP's own station number
    (`cdip_id`, else the trailing "(NNN)" of its name, as NDBC's station table writes it: 'Waimea Bay, HI (106)')."""
    out = {str(station.get("id", "")).upper()}
    if station.get("wmo_id"):
        out.add(str(station["wmo_id"]).upper())
    cdip = station.get("cdip_id")
    if not cdip and str(station.get("source", "")).lower() == "cdip":
        m = re.search(r"\((\d{3})\)\s*$", str(station.get("name") or ""))
        cdip = m.group(1) if m else None
    if cdip:
        out.add(str(cdip).upper())
    return {a for a in out if a}


def _norm(station_id):
    """Upper-cased id; a CDIP '100p1' (deployment-agnostic product suffix) is its station '100'."""
    s = str(station_id or "").strip().upper()
    m = re.fullmatch(r"(\d{3})P\d", s)
    return m.group(1) if m else s


def verify(doc, root):
    """(locked ids, sha256) of the recorded list, or None when none is recorded. Raises HoldoutError when it does not
    verify. `doc` is the parsed buoy list."""
    ref = (doc.get("holdout") or {}).get("locked_list")
    stations = doc.get("stations") or []
    if not ref:
        if any(s.get("locked") is not None for s in stations):
            raise HoldoutError("stations carry `locked` tags but no locked list is recorded")
        return None
    rel = Path(str(ref["path"]))
    if rel.anchor or ".." in rel.parts:                 # rooted ('/x', 'C:/x', 'C:x') or climbing out: refuse
        raise HoldoutError(f"locked list path {ref['path']!r} must be relative and inside the repository")
    path = Path(root) / rel
    if not path.is_file():
        raise HoldoutError(f"locked list {ref['path']} is recorded but missing")
    raw = path.read_bytes()
    got = hashlib.sha256(raw).hexdigest()
    if got != ref.get("sha256"):
        raise HoldoutError(f"locked list sha256 {got[:12]} != recorded {str(ref.get('sha256'))[:12]}")
    ids = [str(i).upper() for i in (json.loads(raw.decode("utf-8")).get("locked") or [])]
    known = {str(s["id"]).upper() for s in stations}
    if not ids or len(set(ids)) != len(ids) or set(ids) - known:
        raise HoldoutError(f"locked list ids invalid ({len(set(ids) - known)} unknown, {len(ids)} listed)")
    locked = frozenset(ids)
    if any(s.get("locked") is not (str(s["id"]).upper() in locked) for s in stations):
        raise HoldoutError("a station's `locked` tag disagrees with the locked list")
    return locked, got


def _alarm(reason):
    """A quarantine locks EVERY listed buoy (all ~100), so it must be loud, never a quiet stderr line: a banner on stderr
    and, inside GitHub Actions, an ::error:: annotation that shows on the run's summary page. The reason names no buoy id
    (only paths, counts and hash prefixes), so it is safe in public logs."""
    msg = f"LOCKED holdout QUARANTINE: {reason}; every listed buoy is treated as LOCKED until the record verifies"
    print("!" * 100 + f"\n[buoy_holdout] {msg}\n" + "!" * 100, file=sys.stderr)
    if os.environ.get("GITHUB_ACTIONS") == "true":
        print(f"::error title=LOCKED holdout quarantine::{msg}", flush=True)


def state(refresh=False):
    """{"status": none|verified|quarantine, "locked": frozenset (with aliases), "sha256", "reason"}. Cached per process."""
    root = _root()
    key = str(root)
    if refresh or key not in _CACHE:
        doc_path = root / BUOY_LIST
        try:
            doc = json.loads(doc_path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            _CACHE[key] = {"status": "none", "locked": frozenset(), "sha256": None, "reason": f"no buoy list at {BUOY_LIST}"}
            return _CACHE[key]
        except ValueError as e:
            doc = None
            reason = f"buoy list unreadable: {e}"
        if doc is not None:
            by_id = {str(s["id"]).upper(): s for s in doc.get("stations") or []}
            try:
                got = verify(doc, root)
            except (HoldoutError, KeyError, TypeError, ValueError) as e:
                got, reason = "bad", str(e)
            if got is None:
                _CACHE[key] = {"status": "none", "locked": frozenset(), "sha256": None, "reason": "no locked list recorded"}
                return _CACHE[key]
            if got != "bad":
                ids, sha = got
                locked = frozenset(a for i in ids for a in _aliases(by_id[i]))
                _CACHE[key] = {"status": "verified", "locked": locked, "sha256": sha, "reason": None}
                return _CACHE[key]
            pool = frozenset(a for s in by_id.values() for a in _aliases(s))
        else:
            pool = frozenset()
        _alarm(reason)
        _CACHE[key] = {"status": "quarantine", "locked": pool, "sha256": None, "reason": reason, "all": doc is None}
    return _CACHE[key]


def locked():
    return state()["locked"]


def is_locked(station_id):
    st = state()
    if st["status"] == "quarantine" and st.get("all"):
        return True                                     # the list itself is unreadable: nothing is known to be safe
    return _norm(station_id) in st["locked"]


def keep(station_id):
    return not is_locked(station_id)


def drop(rows, key="station_id"):
    """`rows` without the locked ones. `key` is a field name (dict rows) or a callable row -> station id."""
    if not locked() and state()["status"] != "quarantine":
        return list(rows)
    get = key if callable(key) else (lambda r: r.get(key) if isinstance(r, dict) else getattr(r, key, None))
    return [r for r in rows if keep(get(r))]


def _pattern(ids):
    if not ids:
        return None
    alt = "|".join(sorted((re.escape(i) for i in ids), key=len, reverse=True))
    return re.compile(r"(?<![0-9A-Za-z])(" + alt + r")(?![0-9A-Za-z])", re.IGNORECASE)


def allow_url(url):
    """False when `url` names a locked station (or everything is quarantined); the fetch must not happen. A station is
    named when its id stands alone in the URL's path or query, or is followed directly by NDBC's historical `h<year>` /
    CDIP's `p<n>` suffix (realtime2/<ID>.txt, ?filename=<id>h2025.txt.gz, station_page.php?station=<id>,
    cdip/realtime/<ID>p1_rt.nc, cdip/archive/<ID>p1/...)."""
    st = state()
    if st["status"] == "quarantine" and st.get("all"):
        return False
    ids = st["locked"]
    if not ids:
        return True
    tail = re.sub(r"^[a-z]+://[^/]+", "", str(url), flags=re.I)
    alt = "|".join(sorted((re.escape(i) for i in ids), key=len, reverse=True))
    return re.search(r"(?<![0-9A-Za-z])(" + alt + r")(?=$|[^0-9A-Za-z]|[hHpP]\d)", tail, re.IGNORECASE) is None


# Any token shaped like a buoy id (an NDBC/WMO id: 5 upper-case letters or digits with at least one digit; a CDIP station
# number: 3 digits, optionally with its p<n> suffix). Used only when the buoy list itself is unreadable.
_ANY_ID = re.compile(r"(?<![0-9A-Za-z])(?:(?=[0-9A-Z]{0,4}\d)[0-9A-Z]{5}|\d{3}(?:p\d)?)(?![0-9A-Za-z])")


def redact(text):
    """`text` with every locked id replaced by <locked>. When the buoy list is unreadable no id is known to be safe, so
    every token shaped like a buoy id is redacted (fail closed; LongCat review 2026-11-23)."""
    st = state()
    if st["status"] == "quarantine" and st.get("all"):
        return _ANY_ID.sub(REDACTED, str(text))
    pat = _pattern(st["locked"])
    return pat.sub(REDACTED, str(text)) if pat else str(text)


def declare_collector(name, why):
    """Mark a module as a pure collector (archives raw truth, scores nothing). Returns the reason (for logs)."""
    _COLLECTORS[name] = why
    return why


def reset_cache():
    _CACHE.clear()
