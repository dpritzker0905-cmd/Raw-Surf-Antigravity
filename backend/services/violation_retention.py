"""What a ToS violation keeps after its account is erased.

David's ruling (2026-11-19, 02:20Z): "Keep the ban evidence, only wipe GPS and notes". So erasure:
- nulls the four claimed/actual lat/long columns;
- replaces the free-text notes (`description`, `appeal_text`, and `title`, which an admin may have typed);
- drops only the GPS and note entries inside `evidence` (matched by whole key name) and KEEPS everything else;
- keeps the row itself, its reason code (`violation_type`), severity, strikes, action, dates, reviewer and decision ref.
There is NO expiry: the rows are not deleted on a clock.

Deferred, pending David's word: skipping the day-30 erasure while an appeal is open.
Not here (on hold for counsel): the hashed `moderation_tombstones` anti-evasion trail.
"""
from __future__ import annotations

import re

from sqlalchemy import select


REMOVED_TEXT = "[removed at account erasure]"
_LOCATION_COLUMNS = ("claimed_latitude", "claimed_longitude", "actual_latitude", "actual_longitude")
# `evidence` is kept (David, 2026-11-19: "only wipe GPS and notes"). Only an entry whose key IS a position or a note is
# dropped, with whatever is under it. Keys match as whole names (camelCase and dashes normalised), never as substrings:
# `violation_ids`, `platform`, `context`, `detail`, `summary`, `body`, `gps_ok` and the like all survive.
_PREFIX = r"(?:claimed_|actual_|user_|device_|reported_|detected_)?"
_GPS_KEY = re.compile(
    rf"{_PREFIX}(?:lat|lng|lon|long|latitude|longitude|coord|coords|coordinate|coordinates|gps|geo|geolocation|"
    r"lat_lng|lat_lon|latlng|latlon)")
_NOTE_KEY = re.compile(
    r"(?:admin_|reviewer_|moderator_|internal_|user_|appeal_|staff_)?(?:note|notes|comment|comments|remark|remarks)")
_MAX_DEPTH = 12
_DROP = object()


def _norm(key: str) -> str:
    return re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", key).replace("-", "_").lower()


def _sensitive(key) -> bool:
    if not isinstance(key, str):
        return True                                   # JSON keys are strings; anything else is not ours to keep
    k = _norm(key)
    return bool(_GPS_KEY.fullmatch(k) or _NOTE_KEY.fullmatch(k))


def _clean(value, depth: int = 0):
    """`value` without GPS or note entries. Deeper than `_MAX_DEPTH` is dropped (fail closed), not kept unread."""
    if depth > _MAX_DEPTH:
        return _DROP
    if isinstance(value, dict):
        return {k: c for k, v in value.items() if not _sensitive(k)
                for c in [_clean(v, depth + 1)] if c is not _DROP}
    if isinstance(value, (list, tuple)):
        return [c for c in (_clean(i, depth + 1) for i in value) if c is not _DROP]
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    return _DROP


def scrub_evidence(evidence) -> dict:
    """`evidence` minus its GPS and note entries, everything else kept as it was. A non-dict loses everything."""
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
