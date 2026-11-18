"""Revoke an account's sessions: refuse every token issued at or before a cutoff (advisor limit on #1022).

Tokens are stateless 30-day JWTs, so revocation needs server state. It is checked inside `security.verify_token`, the
one function every authenticated path calls (HTTP dependencies, WebSockets, MFA), against an IN-MEMORY map of
`profile_id -> cutoff` so no request pays a database query. The map is
- updated in-process the moment this process revokes (after its commit), and
- reloaded from `session_revocations` every minute by the scheduler (and once at start), so every other process
  catches up within a minute.
Only cutoffs younger than the token lifetime are loaded: an older token has expired anyway, so the map stays small.
Tokens with no `iat` (none are minted that way) count as issued at time 0, i.e. revoked.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Dict, Optional

logger = logging.getLogger(__name__)

_cutoffs: Dict[str, float] = {}       # profile_id -> epoch seconds; tokens with iat <= cutoff are refused


def is_revoked(payload: dict) -> bool:
    sub = payload.get("sub")
    cutoff = _cutoffs.get(str(sub)) if sub is not None else None
    if cutoff is None:
        return False
    try:
        iat = float(payload.get("iat") or 0)
    except (TypeError, ValueError):
        iat = 0.0
    return iat <= cutoff


def note_revoked(profile_id: str, at: datetime) -> None:
    """Make a committed revocation effective in THIS process immediately."""
    _cutoffs[str(profile_id)] = at.timestamp()


async def revoke(db, profile_id: str, reason: str = "account_deleted", now: Optional[datetime] = None) -> datetime:
    """Record the cutoff in the caller's transaction (no commit). Call note_revoked(profile_id, at) after commit."""
    from models import SessionRevocation
    at = now or datetime.now(timezone.utc)
    row = await db.get(SessionRevocation, profile_id)
    if row is None:
        db.add(SessionRevocation(profile_id=profile_id, revoked_at=at, reason=reason))
    else:
        row.revoked_at, row.reason = at, reason
    return at


async def refresh(session_maker=None, lifetime_days: Optional[int] = None) -> int:
    """Reload the map from the table (cutoffs younger than the token lifetime). Never raises; returns the count."""
    from sqlalchemy import select

    from core.security import ACCESS_TOKEN_EXPIRE_DAYS
    from models import SessionRevocation
    if session_maker is None:
        from database import async_session_maker as session_maker
    since = datetime.now(timezone.utc) - timedelta(days=(lifetime_days or ACCESS_TOKEN_EXPIRE_DAYS) + 1)
    try:
        async with session_maker() as db:
            rows = (await db.execute(select(SessionRevocation.profile_id, SessionRevocation.revoked_at)
                                     .where(SessionRevocation.revoked_at >= since))).all()
    except Exception as exc:  # noqa: BLE001 - keep the last good map; the next minute retries
        logger.warning("[sessions] revocation refresh failed: %s", type(exc).__name__)
        return len(_cutoffs)
    fresh = {}
    for pid, at in rows:
        at = at if at.tzinfo else at.replace(tzinfo=timezone.utc)
        fresh[str(pid)] = at.timestamp()
    # Keep any in-process revocation newer than what the table returned (a commit this process just made).
    for pid, cutoff in _cutoffs.items():
        if cutoff > fresh.get(pid, -1):
            fresh[pid] = cutoff
    _cutoffs.clear()
    _cutoffs.update(fresh)
    return len(_cutoffs)
