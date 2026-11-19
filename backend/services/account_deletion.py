"""Account deletion with a 30-day restore window (David, 2026-11-18).

A deletion request by default SCHEDULES the erasure instead of running it:
- at once: every session is revoked and sign-in is refused (the profile is suspended; the session-revocation hook
  fires), and the person's surf reports leave every NEW export (surf_truth_export reads pending_user_ids);
- a restore link is emailed to the account's address; the token is stored only as a SHA-256 hash;
- within GRACE_DAYS, the link restores the account (unsuspended; the person signs in again with their password);
- after GRACE_DAYS, the daily job runs the full erasure (routes/compliance_pkg/gdpr.erase_account) and marks it purged.
`delete-my-data?immediate=true` erases at once, as before.

Guards (advisor hold on #1062), enforced by ONE database hook so every current and future code path is covered:
- if anything other than the restore link lifts the suspension during the window (an admin unsuspend, an appeal),
  the deletion is CANCELLED: the account is live again and is never erased on day 30;
- if moderation suspends or bans the account during the window, the row records `moderation_hold`, and a restore
  then leaves the account suspended. An account already suspended or banned when it asked to be deleted is recorded
  in `prior_suspended` and stays suspended after a restore. Nothing is inferred from the suspension's text.
- the purge erases only an account that is still pending AND still suspended.

Not yet hidden during the window (phase 2): the public profile page, posts and photos stay reachable. Today the
profile is suspended, signed out and excluded from exports; hiding its content everywhere, and moving its public
photos to private storage for the window, are the next step.
"""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple

from sqlalchemy import event, select
from sqlalchemy.orm import Session

GRACE_DAYS = 30
PENDING, RESTORED, PURGED, CANCELLED = "pending", "restored", "purged", "cancelled"
_OWN = "account_deletion_writer"     # Session.info: profile ids this module is changing (the hook skips them)
_WATCHED = ("is_suspended", "is_banned", "suspended_reason", "suspended_at", "suspension_until", "banned_at")
SUSPENDED_REASON = "account deletion requested (restorable for 30 days)"


def _mine(db, profile_id) -> None:
    """Mark a profile change as this module's own, so the hook does not read it as moderation."""
    db.sync_session.info.setdefault(_OWN, set()).add(str(profile_id))


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _aware(ts: datetime) -> datetime:
    return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)


async def schedule(db, profile, now: Optional[datetime] = None) -> Tuple[object, str]:
    """Record a pending deletion and lock the account. Returns (row, restore token). Does not commit."""
    from core.session_revocation import revoke
    from models import AccountDeletion
    now = now or datetime.now(timezone.utc)
    token = secrets.token_urlsafe(32)
    row = await db.get(AccountDeletion, profile.id)
    if row is None:
        row = AccountDeletion(profile_id=profile.id)
        db.add(row)
    if row.status != PENDING:                                  # a repeat request keeps what the first one recorded
        row.prior_suspended = bool(profile.is_suspended or profile.is_banned)
        row.moderation_hold = False
    row.cancelled_at = None
    _mine(db, profile.id)
    row.status, row.requested_at, row.purge_after = PENDING, now, now + timedelta(days=GRACE_DAYS)
    row.restore_token_hash, row.restored_at, row.purged_at = _hash(token), None, None
    profile.is_suspended = True
    profile.suspended_at = now
    profile.suspended_reason = SUSPENDED_REASON
    await revoke(db, profile.id, "deletion_requested", now=now)   # also when the profile was already suspended
    return row, token


async def restore(db, token: str, now: Optional[datetime] = None):
    """The profile restored by `token`, or None (unknown, used, or past the window). Does not commit."""
    from models import AccountDeletion, Profile
    now = now or datetime.now(timezone.utc)
    if not token or len(token) > 200:
        return None
    row = (await db.execute(select(AccountDeletion).where(AccountDeletion.restore_token_hash == _hash(token))))\
        .scalar_one_or_none()
    if row is None or row.status != PENDING or _aware(row.purge_after) <= now:
        return None
    profile = await db.get(Profile, row.profile_id)
    if profile is None:
        return None
    row.status, row.restored_at, row.restore_token_hash = RESTORED, now, None
    # Lift only the suspension the request imposed: never one recorded as moderation, never a ban.
    if not (row.prior_suspended or row.moderation_hold or profile.is_banned):
        _mine(db, profile.id)
        profile.is_suspended, profile.suspended_at, profile.suspended_reason = False, None, None
    return profile


async def is_pending(db, profile_id: str) -> bool:
    from models import AccountDeletion
    row = await db.get(AccountDeletion, profile_id)
    return row is not None and row.status == PENDING


async def pending_user_ids(db) -> set:
    from models import AccountDeletion
    return set((await db.execute(select(AccountDeletion.profile_id)
                                 .where(AccountDeletion.status == PENDING))).scalars().all())


async def purge_due(db, erase, now: Optional[datetime] = None) -> int:
    """Run `erase(db, profile_id)` (the full erasure, which commits) for every pending deletion past its window."""
    from models import AccountDeletion
    now = now or datetime.now(timezone.utc)
    import logging
    log = logging.getLogger(__name__)
    from models import Profile
    ids = list((await db.execute(select(AccountDeletion.profile_id).where(
        AccountDeletion.status == PENDING, AccountDeletion.purge_after <= now))).scalars().all())   # ids, not rows:
    done = 0                                                   # a rollback below must not expire what we iterate
    for pid in ids:
        profile = await db.get(Profile, pid)
        if profile is None or not profile.is_suspended:        # lifted outside the hook's sight: never erase a live account
            row = await db.get(AccountDeletion, pid)
            row.status, row.cancelled_at, row.restore_token_hash = CANCELLED, now, None
            await db.commit()
            log.warning("[account deletion] a due deletion was cancelled: the account is no longer suspended")
            continue
        try:
            result = await erase(db, pid)
        except Exception as exc:  # noqa: BLE001 - one bad account must not stop the others; retried tomorrow
            await db.rollback()
            log.error("[account deletion] erasure failed (%s); retried next run", type(exc).__name__)
            continue
        media = (result or {}).get("media") if isinstance(result, dict) else None
        if media and media.get("error"):
            log.error("[account deletion] erased, but its public media were NOT removed: %s", media["error"])
        row = await db.get(AccountDeletion, pid)
        row.status, row.purged_at, row.restore_token_hash = PURGED, now, None
        await db.commit()
        done += 1
    return done


_TABLE_SEEN: dict = {}


def _table_present(session) -> bool:
    """True when the bound database has `account_deletions` (always, in production). Cached per engine, so a database
    built without the table (a narrow test world) is not asked on every flush."""
    from sqlalchemy import inspect as sa_inspect
    bind = session.get_bind()
    engine = getattr(bind, "engine", bind)
    seen = _TABLE_SEEN.get(id(engine))
    if seen is None or seen[0] is not engine:                 # an id can be reused by a later engine: compare identity
        seen = (engine, sa_inspect(session.connection()).has_table("account_deletions"))
        _TABLE_SEEN[id(engine)] = seen
    return seen[1]


@event.listens_for(Session, "before_flush")
def _guard_pending_deletions(session, flush_context, instances):
    """Cancel a pending deletion whose suspension is lifted by anything but restore(); record moderation as a hold."""
    from sqlalchemy import inspect as sa_inspect

    from models import AccountDeletion, Profile
    own = session.info.get(_OWN, set())
    for obj in list(session.dirty):
        if not isinstance(obj, Profile) or obj.id is None or str(obj.id) in own:
            continue
        state = sa_inspect(obj)
        # committed_state, not history: it also records an assignment of the SAME value (routes/admin/p1.py re-sets
        # is_suspended=True on an account that is already suspended), which a moderator meant as a suspension.
        touched = [a for a in _WATCHED if a in state.committed_state]
        if not touched:
            continue
        if not _table_present(session):
            return
        with session.no_autoflush:
            row = session.get(AccountDeletion, obj.id)
        if row is None or row.status != PENDING:
            continue
        lifted = "is_suspended" in touched and state.attrs.is_suspended.history.has_changes() and not obj.is_suspended
        if lifted and not obj.is_banned:
            row.status, row.cancelled_at = CANCELLED, datetime.now(timezone.utc)
            row.restore_token_hash = None                      # the emailed link stops working too
        else:
            row.moderation_hold = True


@event.listens_for(Session, "after_commit")
@event.listens_for(Session, "after_rollback")
def _forget_own(session):
    session.info.pop(_OWN, None)


# Same reason as the end of core/session_revocation: load the models (and with them every Session hook) at import time,
# never for the first time inside a flush, where registering a hook mutates the listener list being dispatched.
import models  # noqa: E402,F401
