"""Write one row to the append-only surf-truth admin action log. The caller commits (with the action itself)."""
from __future__ import annotations

import json
from typing import Optional

from models import SurfTruthAdminAction


def log_action(db, admin_id: str, action: str, target_type: str, target_id: str, *, reason: Optional[str] = None,
               detail: Optional[dict] = None) -> SurfTruthAdminAction:
    row = SurfTruthAdminAction(admin_id=admin_id, action=action, target_type=target_type, target_id=target_id,
                               reason=reason, detail=json.dumps(detail, sort_keys=True) if detail else None)
    db.add(row)
    return row
