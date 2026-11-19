"""Write one row to the append-only surf-truth admin action log. The caller commits (with the action itself).

MINIMAL CONTENT (log retention design, docs/weather-program/T1-LOG-RETENTION-DESIGN-2026-11-18.md): these logs are
append-only, so whatever is written stays until the table's retention mechanism removes it. Nothing typed by an admin
about a person, and nothing the person reported, is written:
- `reason` is a REASON CODE from a fixed list (ANCHOR_REASONS / AUDIT_FAIL_REASONS), never free text. A code says
  why an admin acted without recording an opinion about a named person that would then outlive an erasure.
- `detail` keys come from DETAIL_KEYS only (status names, verdicts, counts, object names); anything else is refused.
The labels shown in the admin screen mirror these codes in frontend/src/components/admin/surf-truth/shared.js
(parity pinned by tests/test_surf_truth_log_minimal.py).
"""
from __future__ import annotations

import json
from typing import Optional

from models import SurfTruthAdminAction

# Why an anchor's status changed. Code -> the admin screen's label.
ANCHOR_REASONS = {
    "reliable_record": "Consistent, well-documented reports",
    "new_anchor_watch": "New anchor: watch period first",
    "probation_passed": "Probation passed",
    "quality_concern": "Concern about report quality",
    "inactive": "No recent reports",
    "observer_request": "The observer asked",
    "account_issue": "Account or conduct issue",
    "admin_correction": "Corrects an earlier admin change",
}

# Why a sampled report failed its audit (a fail withholds XP, so it needs one). A pass needs none.
AUDIT_FAIL_REASONS = {
    "photo_wrong_spot": "Photo is not of this spot",
    "photo_not_current": "Photo is not current",
    "photo_no_surf": "Photo does not show the surf",
    "photo_reused": "Photo copied or reused",
    "place_time_implausible": "Place or time implausible",
    "other_policy": "Other policy breach",
}

# The only keys `detail` may carry: statuses, verdicts, counts, run/object names and system-written text ("why" is
# set by code, e.g. retention's "fresh export after an account deletion"); none of them holds user content.
DETAIL_KEYS = frozenset({"from", "to", "self", "verdict", "xp_status", "rows", "object", "why",
                         "kept", "deleted_runs", "fresh_export", "overdue"})


def log_action(db, admin_id: str, action: str, target_type: str, target_id: str, *, reason: Optional[str] = None,
               detail: Optional[dict] = None) -> SurfTruthAdminAction:
    if reason is not None and reason not in ANCHOR_REASONS and reason not in AUDIT_FAIL_REASONS:
        raise ValueError(f"admin log reasons are codes, not free text: {reason[:40]!r}")
    extra = set(detail or {}) - DETAIL_KEYS
    if extra:
        raise ValueError(f"admin log detail keys not allowed (user content stays out of the log): {sorted(extra)}")
    row = SurfTruthAdminAction(admin_id=admin_id, action=action, target_type=target_type, target_id=target_id,
                               reason=reason, detail=json.dumps(detail, sort_keys=True) if detail else None)
    db.add(row)
    return row
