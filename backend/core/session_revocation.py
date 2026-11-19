"""Revoke an account's sessions: refuse every token issued at or before a cutoff (advisor limit on #1022).

Tokens are stateless 30-day JWTs, so revocation needs server state. It is checked inside `security.verify_token`, the
one function every authenticated path calls (HTTP dependencies, WebSockets, MFA), against an IN-MEMORY map of
`profile_id -> cutoff` so no request pays a database query. The map is
- updated in-process the moment this process revokes (after its commit), and
- loaded ONCE in server startup BEFORE the first request is served (`load_at_startup`, awaited by the lifespan; a
  failure is logged at ERROR, advisor hold on #1057: the map used to stay empty until the scheduler's first run, and
  forever if the scheduler did not start), then
- reloaded from `session_revocations` every minute by the scheduler, so every other process catches up within a minute.
Only cutoffs younger than the token lifetime are loaded: an older token has expired anyway, so the map stays small.
Tokens with no `iat` (none are minted that way) count as issued at time 0, i.e. revoked.

WHEN sessions are revoked: an account deletion (explicitly), and, through ONE database hook so every current and
future code path is covered, whenever a profile's password is replaced or cleared, or the profile becomes suspended or
banned. The hook writes the cutoff in the same transaction and makes it effective in this process after the commit.
A token minted AFTER a revocation can carry `rv` (the cutoff it was minted past): the password-change route returns one,
so the device that changed the password stays signed in while every other session ends.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Dict, Optional

from sqlalchemy import event
from sqlalchemy import inspect as sa_inspect
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)
_PENDING = "revoked_sessions"           # Session.info key: profile_id -> cutoff, made effective after commit

_cutoffs: Dict[str, float] = {}       # profile_id -> epoch seconds; tokens with iat <= cutoff are refused
_state = {"loaded": False}            # True once a refresh has read the table successfully in this process


def is_revoked(payload: dict) -> bool:
    sub = payload.get("sub")
    cutoff = _cutoffs.get(str(sub)) if sub is not None else None
    if cutoff is None:
        return False
    try:
        iat = float(payload.get("iat") or 0)
        rv = float(payload.get("rv") or 0)
    except (TypeError, ValueError):
        iat, rv = 0.0, 0.0
    if rv >= cutoff:                    # minted on purpose past this cutoff (the password-change route's new token)
        return False
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
    getattr(db, "sync_session", db).info.setdefault(_PENDING, {})[str(profile_id)] = at
    return at


def _change_reason(profile) -> Optional[str]:
    """Why this flush must revoke the profile's sessions, or None."""
    state = sa_inspect(profile)
    for attr, why in (("is_banned", "banned"), ("is_suspended", "suspended")):
        hist = state.attrs[attr].history
        if hist.added and hist.added[0] and not (hist.deleted and hist.deleted[0]):
            return why
    hist = state.attrs["password_hash"].history
    if hist.has_changes() and hist.deleted and hist.deleted[0] is not None:
        return "password_changed"       # a real password was replaced or cleared (setting a first one is not)
    return None


@event.listens_for(Session, "before_flush")
def _revoke_on_profile_change(session, flush_context, instances):
    from models import Profile, SessionRevocation
    pending = session.info.setdefault(_PENDING, {})
    queued = {o.profile_id for o in session.new if isinstance(o, SessionRevocation)}
    for obj in list(session.dirty):
        if not isinstance(obj, Profile) or obj.id is None or str(obj.id) in pending or obj.id in queued:
            continue
        reason = _change_reason(obj)
        if reason is None:
            continue
        at = datetime.now(timezone.utc)
        with session.no_autoflush:
            row = session.get(SessionRevocation, obj.id)
        if row is None:
            session.add(SessionRevocation(profile_id=obj.id, revoked_at=at, reason=reason))
        else:
            row.revoked_at, row.reason = at, reason
        pending[str(obj.id)] = at


@event.listens_for(Session, "after_commit")
def _apply_after_commit(session):
    for pid, at in session.info.pop(_PENDING, {}).items():
        note_revoked(pid, at)


@event.listens_for(Session, "after_rollback")
def _forget_after_rollback(session):
    session.info.pop(_PENDING, None)


def cutoff_for(profile_id: str) -> Optional[float]:
    return _cutoffs.get(str(profile_id))


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
    _state["loaded"] = True
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


def loaded() -> bool:
    """True once this process has read the revocation table at least once."""
    return _state["loaded"]


async def load_at_startup(session_maker=None, attempts: int = 3, pause_s: float = 1.0) -> bool:
    """Load the cutoffs before the server takes traffic. Retries briefly; on failure logs at ERROR (revoked tokens
    would be accepted until the scheduler's next successful refresh) and returns False. Never raises: refusing to
    boot would take the whole site down over one table."""
    import asyncio
    for attempt in range(1, attempts + 1):
        count = await refresh(session_maker)
        if loaded():
            logger.info("[sessions] %d revoked-session cutoff(s) loaded at startup", count)
            return True
        if attempt < attempts:
            await asyncio.sleep(pause_s * attempt)
    logger.error("[sessions] REVOKED SESSIONS NOT LOADED AT STARTUP after %d attempts: tokens of deleted, suspended "
                 "or password-changed accounts are ACCEPTED by this process until a refresh succeeds", attempts)
    return False
