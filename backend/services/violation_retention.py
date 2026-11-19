"""What a ToS violation keeps after its account is erased.

David's ruling (2026-11-19, 02:20Z): "Keep the ban evidence, only wipe GPS and notes". So erasure:
- nulls the four claimed/actual lat/long columns;
- replaces the free-text notes (`description`, `appeal_text`, and `title`, which an admin may have typed);
- strips coordinates and free text from inside `evidence` but KEEPS the rest of it;
- keeps the row itself, its reason code (`violation_type`), severity, strikes, action, dates, reviewer and decision ref.
There is NO expiry: the rows are not deleted on a clock.

`purge_due` also skips an account with an open moderation case at day 30 (see `open_case` / `flag_open_case`).
Not here (on hold for counsel): the hashed `moderation_tombstones` anti-evasion trail.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select

logger = logging.getLogger(__name__)

REMOVED_TEXT = "[removed at account erasure]"
_LOCATION_COLUMNS = ("claimed_latitude", "claimed_longitude", "actual_latitude", "actual_longitude")
# An `evidence` KEY whose name says it holds a position or a note: dropped with everything under it.
_SENSITIVE_KEY = re.compile(
    r"lat|lon|lng|coord|gps|position|location|geo|address|note|comment|text|description|message|body|reason_text|"
    r"narrative|summary|detail|remark|caption|exif", re.I)
# A string value survives only if it looks like a code ("location_fraud", "ban"), never a sentence.
_CODE = re.compile(r"^[A-Za-z0-9_.:\-]{1,40}$")


def _clean(value, depth: int = 0):
    """`value` with coordinates and free text removed; the sentinel `_DROP` means "remove this entry"."""
    if depth > 6:
        return _DROP
    if isinstance(value, bool) or value is None:
        return value
    if isinstance(value, (int, float)):
        return value
    if isinstance(value, str):
        return value if _CODE.match(value) else _DROP
    if isinstance(value, dict):
        out = {}
        for key, item in value.items():
            if not isinstance(key, str) or _SENSITIVE_KEY.search(key):
                continue
            cleaned = _clean(item, depth + 1)
            if cleaned is not _DROP:
                out[key] = cleaned
        return out
    if isinstance(value, (list, tuple)):
        if any(isinstance(i, (int, float)) and not isinstance(i, bool) for i in value) and len(value) >= 2 \
                and all(isinstance(i, (int, float)) and not isinstance(i, bool) for i in value):
            return _DROP                                       # a bare number list is a coordinate pair or a track
        kept = [c for c in (_clean(i, depth + 1) for i in value) if c is not _DROP]
        return kept
    return _DROP


_DROP = object()


def scrub_evidence(evidence) -> dict:
    """`evidence` minus coordinates and free text, rest kept. Anything that is not a dict loses everything."""
    cleaned = _clean(evidence) if isinstance(evidence, dict) else {}
    if cleaned is _DROP:
        cleaned = {}
    cleaned["scrubbed"] = True
    return cleaned


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
        row = ModerationHold(profile_id=user_id)
        db.add(row)
    row.open_case_flagged_at = now
    await db.commit()
