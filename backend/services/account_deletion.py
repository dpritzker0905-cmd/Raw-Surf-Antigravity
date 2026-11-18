"""Account deletion with a 30-day restore window (David, 2026-11-18).

A deletion request by default SCHEDULES the erasure instead of running it:
- at once: every session is revoked and sign-in is refused (the profile is suspended; the session-revocation hook
  fires), and the person's surf reports leave every NEW export (surf_truth_export reads pending_user_ids);
- a restore link is emailed to the account's address; the token is stored only as a SHA-256 hash;
- within GRACE_DAYS, the link restores the account (unsuspended; the person signs in again with their password);
- after GRACE_DAYS, the daily job runs the full erasure (routes/compliance_pkg/gdpr.erase_account) and marks it purged.
`delete-my-data?immediate=true` erases at once, as before.

Not yet hidden during the window (phase 2): the public profile page, posts and photos stay reachable. Today the
profile is suspended, signed out and excluded from exports; hiding its content everywhere, and moving its public
photos to private storage for the window, are the next step.
"""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple

from sqlalchemy import select

GRACE_DAYS = 30
PENDING, RESTORED, PURGED = "pending", "restored", "purged"
SUSPENDED_REASON = "account deletion requested (restorable for 30 days)"


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
    if profile.suspended_reason == SUSPENDED_REASON:          # never lift a suspension that came from moderation
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
    due = (await db.execute(select(AccountDeletion).where(AccountDeletion.status == PENDING,
                                                          AccountDeletion.purge_after <= now))).scalars().all()
    done = 0
    for row in due:
        pid = row.profile_id
        try:
            await erase(db, pid)
        except Exception as exc:  # noqa: BLE001 - one bad account must not stop the others; retried tomorrow
            await db.rollback()
            import logging
            logging.getLogger(__name__).error("[account deletion] erasure failed (%s); retried next run", type(exc).__name__)
            continue
        row = await db.get(AccountDeletion, pid)
        row.status, row.purged_at, row.restore_token_hash = PURGED, now, None
        await db.commit()
        done += 1
    return done
