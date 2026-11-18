"""The one place an anchor observer is appointed or changes status (and the one place it is read).

Every change writes the anchor row AND an append-only log line in the same transaction, with the acting admin and a
required reason. Nothing here touches a reported number: anchors are about whose reports set the scale, never about
editing what anyone reported. The caller commits.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select

from models import SurfTruthAnchor, SurfTruthAnchorEvent

STATUSES = ("active", "probation", "suspended")
MAX_REASON = 500


class AnchorError(ValueError):
    """Refused change; the API answers 422 with the message."""


async def anchor_status(db, profile_id: str) -> Optional[str]:
    return (await db.execute(select(SurfTruthAnchor.status).where(SurfTruthAnchor.profile_id == profile_id))
            ).scalar_one_or_none()


def role_for(status: Optional[str]) -> Optional[str]:
    """observer_role contribution: only an ACTIVE anchor sets the scale; probation is recorded separately; a
    suspended anchor is an ordinary observer again."""
    return {"active": "anchor", "probation": "anchor_probation"}.get(status)


async def set_status(db, profile_id: str, status: str, actor_id: str, reason: str) -> SurfTruthAnchorEvent:
    if status not in STATUSES:
        raise AnchorError(f"status must be one of {STATUSES}")
    reason = (reason or "").strip()
    if not reason:
        raise AnchorError("a reason is required")
    if len(reason) > MAX_REASON:
        raise AnchorError(f"reason is limited to {MAX_REASON} characters")
    row = await db.get(SurfTruthAnchor, profile_id)
    previous = row.status if row else None
    if previous == status:
        raise AnchorError(f"already {status}")
    now = datetime.now(timezone.utc)
    if row is None:
        db.add(SurfTruthAnchor(profile_id=profile_id, status=status, status_since=now, appointed_at=now,
                               appointed_by=actor_id))
    else:
        row.status = status
        row.status_since = now
    log = SurfTruthAnchorEvent(profile_id=profile_id, from_status=previous, to_status=status, actor_id=actor_id,
                               reason=reason, at=now)
    db.add(log)
    return log
