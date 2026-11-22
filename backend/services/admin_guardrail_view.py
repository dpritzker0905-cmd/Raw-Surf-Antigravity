"""What the admin's Guardrail view shows (D-065): the guardrail's live entries and its decision history. READ-ONLY.

- `control/flags.json`: the runtime manifest, each entry with state, reason, set_by, set_at, evidence (and, for an
  owner re-enable, the fix version it was made under).
- `control/flags-actions.jsonl`: one line per decision the guardrail APPLIED ({at, flag, action, reason, run}). It is
  written only in enforce mode; in dry-run mode the guardrail writes nothing and reports in its GitHub issue.

Turning a fix back on is NOT an admin action, by design: the guardrail workflow is the only writer of the manifest,
and a re-enable needs the owner's words through its workflow_dispatch (flag-guardrail.yml, inputs `reenable` and
`owner_words`; it writes only when FLAG_GUARDRAIL_ENFORCE is '1'). The view says exactly how, with the run link.
"""
from __future__ import annotations

import json
import os
import threading
import time
from typing import Callable, Optional

from services import runtime_flags as _rf
from core.supabase_auth import supabase_headers

ACTIONS_KEY = "control/flags-actions.jsonl"
WORKFLOW = "flag-guardrail.yml"
SCHEDULE_UTC = "02:30, 08:30, 14:30 and 20:30 UTC"
DEFAULT_REPO = "dpritzker0905-cmd/Raw-Surf-Antigravity"   # public; GITHUB_REPOSITORY overrides
MAX_ACTIONS = 200


def fetch_object(key: str) -> Optional[str]:
    """The text of a private bucket object, None when absent. Raises on any other failure (reported by the caller)."""
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    secret = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY", "")
    if not base or not secret:
        raise RuntimeError("storage is not configured on this server")
    import requests
    from services.weather_pipeline.store import WEATHER_BUCKET
    r = requests.get(f"{base}/storage/v1/object/{WEATHER_BUCKET}/{key}",
                     headers={**supabase_headers(secret), "Cache-Control": "no-cache"},
                     timeout=10)
    if r.status_code in (400, 404):
        return None
    r.raise_for_status()
    return r.text


def parse_actions(text: Optional[str]) -> tuple:
    """(newest-first decision lines, count of unreadable lines)."""
    rows, bad = [], 0
    for line in (text or "").splitlines():
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except ValueError:
            bad += 1
            continue
        if isinstance(row, dict):
            rows.append({k: row.get(k) for k in ("at", "flag", "action", "reason", "run")})
        else:
            bad += 1
    rows.sort(key=lambda r: str(r.get("at") or ""), reverse=True)
    return rows[:MAX_ACTIONS], bad


CACHE_TTL_S = 60.0
_cache: dict = {"at": None, "value": None}
_cache_lock = threading.Lock()


def cached_guardrail_view(now: Optional[float] = None) -> dict:
    """guardrail_view() reused for CACHE_TTL_S (advisor, #1032: each open panel polls every 60 s and each poll made two
    private-bucket reads). The guardrail runs every 6 h, so a minute of staleness hides nothing; one lock means one
    read per minute however many admins have the panel open."""
    now = time.monotonic() if now is None else now
    with _cache_lock:
        if _cache["at"] is not None and now - _cache["at"] < CACHE_TTL_S:
            return _cache["value"]
        value = guardrail_view()
        _cache.update(at=now, value=value)
        return value


def guardrail_view(fetch: Optional[Callable[[str], Optional[str]]] = None) -> dict:
    fetch = fetch or fetch_object
    repo = os.environ.get("GITHUB_REPOSITORY") or DEFAULT_REPO
    out = {"schedule_utc": SCHEDULE_UTC, "workflow": WORKFLOW,
           "workflow_url": f"https://github.com/{repo}/actions/workflows/{WORKFLOW}",
           "guarded": {name: {"code_default": default, "fix_version": _rf.FIX_VERSION.get(name)}
                       for name, default in sorted(_rf.GUARDED.items())},
           "entries": {}, "actions": [], "errors": []}
    try:
        raw = fetch(_rf.MANIFEST_KEY)
        out["entries"] = _rf.validate(json.loads(raw)) if raw else {}
    except Exception as e:  # reported, never raised
        out["errors"].append(f"manifest unreadable: {e}")
    try:
        out["actions"], bad = parse_actions(fetch(ACTIONS_KEY))
        if bad:
            out["errors"].append(f"{bad} unreadable line(s) in {ACTIONS_KEY}")
    except Exception as e:
        out["errors"].append(f"decision history unreadable: {e}")
    return out
