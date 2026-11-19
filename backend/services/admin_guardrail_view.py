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
from typing import Callable, Optional

from services import runtime_flags as _rf

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
                     headers={"Authorization": f"Bearer {secret}", "apikey": secret, "Cache-Control": "no-cache"},
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
