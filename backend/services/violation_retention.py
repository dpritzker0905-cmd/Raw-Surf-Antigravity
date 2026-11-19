"""What a ToS violation keeps after its account is erased (David, 2026-11-18: "do the GPS clean-up now").

Erasure scrubs the location and the free text of the account's violation rows, keeping what shows that a decision
was made and why: the reason code (`violation_type`), `severity`, `strike_points`, `action_taken`, dates, `reviewed_by`,
`related_type`/`related_id` (the decision ref) and the distance discrepancy. A daily job then deletes those rows once
`VIOLATION_RETENTION` has passed since the erasure, unless an admin set `legal_hold` for the account.

Not here (on hold for counsel): the hashed `moderation_tombstones` anti-evasion trail.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import delete, select

logger = logging.getLogger(__name__)

# "12 months" after the erasure (docs/audits/2026-11-18-moderation-trail-after-deletion-memo.md). Counsel confirms.
VIOLATION_RETENTION = timedelta(days=365)
REMOVED_TEXT = "[removed at account erasure]"
# The only `evidence` keys that survive a scrub, and only as plain numbers: a discrepancy, never a position.
_EVIDENCE_KEEP = ("distance_miles",)
_LOCATION_COLUMNS = ("claimed_latitude", "claimed_longitude", "actual_latitude", "actual_longitude")


def scrub_evidence(evidence) -> dict:
    """`evidence` with every coordinate, list and string dropped; only whitelisted numbers remain."""
    kept = {}
    if isinstance(evidence, dict):
        for key in _EVIDENCE_KEEP:
            value = evidence.get(key)
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                kept[key] = value
    kept["scrubbed"] = True
    return kept


async def scrub_violations(db, user_id: str) -> int:
    """Scrub every violation row of `user_id`. Does not commit (runs inside the erasure transaction). Idempotent."""
    from models import TosViolation
    rows = (await db.execute(select(TosViolation).where(TosViolation.user_id == user_id))).scalars().all()
    for row in rows:
        for column in _LOCATION_COLUMNS:
            setattr(row, column, None)
        row.evidence = scrub_evidence(row.evidence)
        row.title = str(row.violation_type or "violation").replace("_", " ").title()
        row.description = REMOVED_TEXT
        row.appeal_text = None
    return len(rows)


async def open_case(db, user_id: str) -> bool:
    """True when the account has a violation under appeal. The caller treats a failure to ask as open."""
    from models import TosViolation
    found = (await db.execute(select(TosViolation.id).where(
        TosViolation.user_id == user_id,
        (TosViolation.status == "appealed") | (TosViolation.appeal_status == "pending"),
    ).limit(1))).first()
    return found is not None


async def flag_open_case(db, user_id: str, now: Optional[datetime] = None) -> None:
    from models import ModerationHold
    now = now or datetime.now(timezone.utc)
    row = await db.get(ModerationHold, user_id)
    if row is None:
        row = ModerationHold(profile_id=user_id, legal_hold=False)
        db.add(row)
    row.open_case_flagged_at = now
    await db.commit()


async def purge_expired_violations(db, now: Optional[datetime] = None) -> int:
    """Delete the violation rows of accounts erased more than VIOLATION_RETENTION ago, except those under legal hold.
    Fails closed: only an account whose erasure is recorded (`account_deletions.status == purged` with a date) counts."""
    from models import AccountDeletion, ModerationHold, TosViolation
    now = now or datetime.now(timezone.utc)
    cutoff = now - VIOLATION_RETENTION
    held = select(ModerationHold.profile_id).where(ModerationHold.legal_hold.is_(True))
    due = select(AccountDeletion.profile_id).where(
        AccountDeletion.status == "purged",
        AccountDeletion.purged_at.is_not(None),
        AccountDeletion.purged_at <= cutoff,
        AccountDeletion.profile_id.not_in(held),
    )
    result = await db.execute(delete(TosViolation).where(TosViolation.user_id.in_(due)))
    await db.commit()
    count = result.rowcount or 0
    if count:
        logger.info("[violation retention] %d violation rows past %d days deleted", count, VIOLATION_RETENTION.days)
    return count
