"""What the admin's switch board and Verification & skill panel read besides the code (2026-11-23). READ-ONLY.

  * the ops snapshot `admin/ops-snapshot.json` (written every 6 h by admin-ops-snapshot.yml; repository variables,
    SCOREBOARD rows, memory_audit's overdue read-backs, verification-workflow runs, skill-queue fill, gust and
    served-wave record counts). Read at most once a minute per process, off the event loop.
  * the guardrail's coverage class per GUARDED flag (P1-4): `scripts/flag_guardrail.coverage`, imported read-only
    (this module never edits or calls the guardrail), so the admin says which guarded flags its replay is BLIND to.

A missing or unreadable snapshot is reported as such, never as zeros: the lanes then read "set in CI".
"""
from __future__ import annotations

import json
import threading
import time
from datetime import datetime, timezone
from typing import Callable, Optional

from services import runtime_flags as _rf

SNAPSHOT_KEY = "admin/ops-snapshot.json"
SCHEMA = "raw-surf/admin-ops-snapshot/1"
TTL_S = 60.0
STALE_H = 18.0          # three missed 6-hourly runs
WORKFLOW = "admin-ops-snapshot.yml"

_lock = threading.Lock()
_cache = {"at": 0.0, "value": None}
_fetcher: Optional[Callable[[str], Optional[str]]] = None    # tests inject; None = the bucket


def _fetch(key: str) -> Optional[str]:
    if _fetcher is not None:
        return _fetcher(key)
    from services.admin_guardrail_view import fetch_object
    return fetch_object(key)


def _age_h(iso: Optional[str], now: Optional[datetime] = None) -> Optional[float]:
    try:
        t = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return round(((now or datetime.now(timezone.utc)) - t).total_seconds() / 3600.0, 1)


def read_snapshot() -> dict:
    """{snapshot|None, status: ok|stale|absent|error, error?, age_h?}. Cached TTL_S."""
    now = time.time()
    with _lock:
        if _cache["value"] is not None and now - _cache["at"] < TTL_S:
            return _cache["value"]
    try:
        text = _fetch(SNAPSHOT_KEY)
        if text is None:
            out = {"snapshot": None, "status": "absent",
                   "error": f"no snapshot yet: {WORKFLOW} has not run (lanes read 'set in CI')"}
        else:
            doc = json.loads(text)
            if not isinstance(doc, dict) or doc.get("schema") != SCHEMA:
                raise ValueError("not an admin ops snapshot")
            age = _age_h(doc.get("generated_at"))
            out = {"snapshot": doc, "age_h": age,
                   "status": "stale" if age is not None and age > STALE_H else "ok"}
    except Exception as e:  # noqa: BLE001 - reported to the admin, never fatal
        out = {"snapshot": None, "status": "error", "error": f"{type(e).__name__}: {e}"[:200]}
    with _lock:
        _cache.update(at=now, value=out)
    return out


def _reset_for_tests(fetcher=None):
    global _fetcher
    with _lock:
        _cache.update(at=0.0, value=None)
    _fetcher = fetcher


def coverage_map() -> dict:
    """{flag: {class, why}} for every GUARDED flag; {} when the guardrail module cannot be imported here."""
    try:
        from scripts import flag_guardrail as g
    except Exception:  # noqa: BLE001
        return {}
    out = {}
    for name in sorted(_rf.GUARDED):
        try:
            c = g.coverage(name)
        except Exception:  # noqa: BLE001
            c = None
        out[name] = {"class": c[0], "why": c[1]} if c else {"class": "none", "why": "no coverage declared"}
    return out


def coverage_report(cov: dict) -> dict:
    """P1-4: the guarded flags by coverage class, and the BLIND ones that are effectively ON right now."""
    by: dict = {}
    for name, c in cov.items():
        by.setdefault(c["class"], []).append(name)
    blind_on = [n for n in by.get("blind", []) if _rf.resolve(n, _rf.GUARDED[n])["value"] == "1"]
    return {"guarded": len(cov), "by_class": {k: sorted(v) for k, v in sorted(by.items())},
            "blind_effectively_on": sorted(blind_on)}


def verification_view() -> dict:
    snap = read_snapshot()
    doc = snap.get("snapshot") or {}
    cov = coverage_map()
    return {"snapshot": {k: snap.get(k) for k in ("status", "error", "age_h")},
            "generated_at": doc.get("generated_at"), "bucket_read_at": doc.get("bucket_read_at"),
            "commit": doc.get("commit"), "run_url": doc.get("run_url"),
            "verification": doc.get("verification") or {}, "alerts": doc.get("alerts") or [],
            "proposals": doc.get("proposals") or [],
            "coverage": coverage_report(cov) if cov else {"error": "guardrail coverage unavailable on this server"},
            "workflow": WORKFLOW}
