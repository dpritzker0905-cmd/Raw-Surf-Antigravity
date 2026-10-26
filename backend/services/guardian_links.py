"""Two-sided guardian linking (audit 2026-10-18 F-01; policy docs/runbooks/GUARDIAN-LEVELS.md).

Before this module an adult could set ``is_grom_parent`` on their own profile and then link ANY unlinked Grom with
one call. Now a link exists only when the child's account took part:

  child code      the child's account generates a code (``create_child_code``); an adult redeems it
                  (``redeem_child_code``). Single-use, bound to that child, 48 hours.
  parent invite   an adult proposes a link to a child (``create_parent_invite``); the child's account confirms it
                  (``confirm_parent_invite``). Single-use, bound to that child, 48 hours.

Both end in ``_link``: it consumes the proof atomically (the UPDATE that sets ``consumed_at`` is the lock, so two
concurrent redemptions cannot both win), writes the confirmed link, and recomputes the guardian's derived
``is_grom_parent`` flag. The flag is a cache of "has at least one confirmed link", maintained here and nowhere
else; no profile route may set it.

Delivery is a thin seam (``register_invite_delivery``): today the only delivery is an in-app notification. The email
service (another session) registers a function here; nothing in this module sends email.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import secrets
from datetime import datetime, timedelta, timezone
from typing import Awaitable, Callable, List, Optional

from fastapi import HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from core.security import SECRET_KEY
from models import GromGuardian, GuardianLinkCode, Notification, Profile, RoleEnum
from services.guardian_levels import age_on, has_confirmed_link

CODE_TTL = timedelta(hours=48)
KIND_CHILD_CODE = "child_code"
KIND_PARENT_INVITE = "parent_invite"
# No 0/O/1/I/L: a code is read aloud and typed by a parent.
_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
CODE_LENGTH = 8
MAX_OPEN_INVITES_PER_GUARDIAN = 5   # a stranger cannot flood children's inboxes
INVALID_CODE_DETAIL = "That code is not valid, has expired, or was already used."


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: Optional[datetime]) -> Optional[datetime]:
    """SQLite hands datetimes back naive; the database stores UTC either way."""
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def normalize_code(code: str) -> str:
    return "".join(ch for ch in (code or "").upper() if ch.isalnum())


def hash_code(code: str) -> str:
    """Keyed hash: a leaked table cannot be replayed, and codes cannot be tested offline without the key."""
    return hmac.new(SECRET_KEY.encode(), normalize_code(code).encode(), hashlib.sha256).hexdigest()


def new_code() -> str:
    return "".join(secrets.choice(_ALPHABET) for _ in range(CODE_LENGTH))


def display_code(code: str) -> str:
    return f"{code[:4]}-{code[4:]}"


# ------------------------------------------------------------------------------------------------ delivery seam

InviteDelivery = Callable[..., Awaitable[None]]
_deliveries: List[InviteDelivery] = []


def register_invite_delivery(fn: InviteDelivery) -> None:
    """Add a delivery channel (the email service registers one). ``fn(db, event, recipient, code, invite)``."""
    if fn not in _deliveries:
        _deliveries.append(fn)


async def _deliver(db: AsyncSession, event: str, recipient: Optional[Profile], *, invite: GuardianLinkCode,
                   code: Optional[str] = None) -> None:
    """In-app notification first, then every registered channel. A channel failure never blocks the link flow."""
    if recipient is not None:
        titles = {
            "guardian_code_at_signup": ("A child named you as their parent or guardian",
                                        "Redeem the code they give you in Grom HQ to link the account."),
            "guardian_invite": ("A parent or guardian wants to link to your account",
                                "Open Ask my parent to confirm or decline."),
            "guardian_linked": ("Guardian link confirmed", "The link between you is now active."),
            "guardian_declined": ("Guardian invite declined", "The child declined the link."),
        }
        title, body = titles[event]
        db.add(Notification(user_id=recipient.id, type=event, title=title, body=body,
                            data=json.dumps({"invite_id": invite.id, "alert_type": event})))
    for fn in list(_deliveries):
        try:
            await fn(db, event, recipient, code, invite)
        except Exception:  # noqa: BLE001 - a broken channel must not fail a safety flow
            continue


# ------------------------------------------------------------------------------------------------ eligibility

def assert_may_be_guardian(adult: Profile) -> None:
    """403 unless ``adult`` can act as a guardian: not a minor account, not a stated minor."""
    if adult.role == RoleEnum.GROM:
        raise HTTPException(status_code=403, detail="A child account cannot be a guardian.")
    age = age_on(adult.birthdate)
    if age is not None and age < 18:
        raise HTTPException(status_code=403, detail="A guardian must be 18 or older.")
    if getattr(adult, "is_suspended", False):
        raise HTTPException(status_code=403, detail="This account cannot link a child right now.")


async def has_any_confirmed_link(db: AsyncSession, guardian_id: str) -> bool:
    """The definition of "is a parent": at least one CONFIRMED link, read from the profiles/links tables."""
    found = await db.execute(
        select(Profile.id).where(Profile.parent_id == guardian_id, Profile.role == RoleEnum.GROM,
                                 Profile.parent_link_approved.is_(True)).limit(1))
    return found.first() is not None


async def sync_parent_flag(db: AsyncSession, guardian_id: str) -> None:
    """Recompute the derived ``is_grom_parent`` cache. A GROM_PARENT role is always a parent account."""
    guardian = (await db.execute(select(Profile).where(Profile.id == guardian_id))).scalar_one_or_none()
    if guardian is None:
        return
    derived = guardian.role == RoleEnum.GROM_PARENT or await has_any_confirmed_link(db, guardian_id)
    if bool(guardian.is_grom_parent) != derived:
        guardian.is_grom_parent = derived


# ------------------------------------------------------------------------------------------------ child code

async def _revoke_open(db: AsyncSession, grom_id: str, kind: Optional[str] = None) -> None:
    stmt = (update(GuardianLinkCode)
            .where(GuardianLinkCode.grom_id == grom_id, GuardianLinkCode.consumed_at.is_(None),
                   GuardianLinkCode.revoked_at.is_(None))
            .values(revoked_at=_now())
            .execution_options(synchronize_session=False))
    if kind:
        stmt = stmt.where(GuardianLinkCode.kind == kind)
    await db.execute(stmt)


async def create_child_code(db: AsyncSession, child: Profile) -> dict:
    """The child's account asks for a code. Any earlier open code is revoked: one live code at a time."""
    if child.role != RoleEnum.GROM:
        raise HTTPException(status_code=403, detail="Only a child account can ask a parent to link.")
    if has_confirmed_link(child):
        raise HTTPException(status_code=409, detail="This account already has a linked parent or guardian.")
    await _revoke_open(db, child.id, KIND_CHILD_CODE)
    code = new_code()
    now = _now()
    row = GuardianLinkCode(grom_id=child.id, kind=KIND_CHILD_CODE, code_hash=hash_code(code),
                           created_at=now, expires_at=now + CODE_TTL)
    db.add(row)
    await db.commit()
    return {"code": display_code(code), "expires_at": row.expires_at.isoformat(),
            "valid_hours": int(CODE_TTL.total_seconds() // 3600)}


async def offer_code_at_signup(db: AsyncSession, child: Profile, named_guardian: Optional[Profile]) -> None:
    """At signup a child named an adult. Nothing is linked and no `parent_id` is written: the child gets a code
    and the named adult (if they have an account) is told a child named them. The adult redeems the code the
    child gives them."""
    code = new_code()
    now = _now()
    row = GuardianLinkCode(grom_id=child.id, kind=KIND_CHILD_CODE, code_hash=hash_code(code),
                           created_at=now, expires_at=now + CODE_TTL)
    db.add(row)
    await db.flush()
    if named_guardian is not None and named_guardian.role != RoleEnum.GROM:
        await _deliver(db, "guardian_code_at_signup", named_guardian, invite=row)


async def redeem_child_code(db: AsyncSession, guardian: Profile, code: str) -> Profile:
    """An adult redeems a child's code. Returns the linked child. Invalid, expired, used and revoked codes all give
    the same answer, so a guesser learns nothing."""
    assert_may_be_guardian(guardian)
    normalized = normalize_code(code)
    if len(normalized) != CODE_LENGTH:
        raise HTTPException(status_code=400, detail=INVALID_CODE_DETAIL)
    row = (await db.execute(select(GuardianLinkCode).where(
        GuardianLinkCode.code_hash == hash_code(normalized), GuardianLinkCode.kind == KIND_CHILD_CODE))
    ).scalar_one_or_none()
    child = None
    if row is not None:
        child = (await db.execute(select(Profile).where(Profile.id == row.grom_id))).scalar_one_or_none()
    if (row is None or child is None or child.role != RoleEnum.GROM or row.consumed_at is not None
            or row.revoked_at is not None or _as_utc(row.expires_at) <= _now()):
        raise HTTPException(status_code=400, detail=INVALID_CODE_DETAIL)
    await _link(db, child, guardian, row)
    return child


# ------------------------------------------------------------------------------------------------ parent invite

async def create_parent_invite(db: AsyncSession, guardian: Profile, grom_id: str) -> dict:
    """An adult proposes a link to a child. Nothing is linked: the child's account must confirm it."""
    assert_may_be_guardian(guardian)
    child = (await db.execute(select(Profile).where(Profile.id == grom_id))).scalar_one_or_none()
    if child is None or child.role != RoleEnum.GROM:
        raise HTTPException(status_code=404, detail="No child profile found with that id.")
    if has_confirmed_link(child):
        raise HTTPException(status_code=409, detail="This account already has a linked parent or guardian.")
    now = _now()
    open_count = (await db.execute(
        select(func.count(GuardianLinkCode.id)).where(
            GuardianLinkCode.guardian_id == guardian.id, GuardianLinkCode.kind == KIND_PARENT_INVITE,
            GuardianLinkCode.consumed_at.is_(None), GuardianLinkCode.revoked_at.is_(None),
            GuardianLinkCode.expires_at > now))).scalar() or 0
    if open_count >= MAX_OPEN_INVITES_PER_GUARDIAN:
        raise HTTPException(status_code=429, detail="You have too many open invites. Wait for them to expire.")
    await db.execute(update(GuardianLinkCode).where(
        GuardianLinkCode.guardian_id == guardian.id, GuardianLinkCode.grom_id == child.id,
        GuardianLinkCode.kind == KIND_PARENT_INVITE, GuardianLinkCode.consumed_at.is_(None),
        GuardianLinkCode.revoked_at.is_(None)).values(revoked_at=now).execution_options(synchronize_session=False))
    row = GuardianLinkCode(grom_id=child.id, kind=KIND_PARENT_INVITE, guardian_id=guardian.id,
                           created_at=now, expires_at=now + CODE_TTL)
    db.add(row)
    await db.flush()
    await _deliver(db, "guardian_invite", child, invite=row)
    await db.commit()
    return {"invite_id": row.id, "grom_id": child.id, "expires_at": row.expires_at.isoformat(), "status": "pending"}


async def _open_invite_for_child(db: AsyncSession, child: Profile, invite_id: str) -> GuardianLinkCode:
    row = (await db.execute(select(GuardianLinkCode).where(GuardianLinkCode.id == invite_id))).scalar_one_or_none()
    # Wrong owner, wrong kind, used, revoked or expired all answer the same way: the id says nothing.
    if (row is None or row.grom_id != child.id or row.kind != KIND_PARENT_INVITE or row.consumed_at is not None
            or row.revoked_at is not None or _as_utc(row.expires_at) <= _now()):
        raise HTTPException(status_code=404, detail="That invite is not valid or has expired.")
    return row


async def confirm_parent_invite(db: AsyncSession, child: Profile, invite_id: str) -> Profile:
    """The child's account confirms an adult's invite. Returns the guardian."""
    if child.role != RoleEnum.GROM:
        raise HTTPException(status_code=403, detail="Only the child account can confirm a link.")
    row = await _open_invite_for_child(db, child, invite_id)
    guardian = (await db.execute(select(Profile).where(Profile.id == row.guardian_id))).scalar_one_or_none()
    if guardian is None:
        raise HTTPException(status_code=404, detail="That invite is not valid or has expired.")
    assert_may_be_guardian(guardian)
    await _link(db, child, guardian, row)
    return guardian


async def decline_parent_invite(db: AsyncSession, child: Profile, invite_id: str) -> None:
    row = await _open_invite_for_child(db, child, invite_id)
    row.revoked_at = _now()
    guardian = (await db.execute(select(Profile).where(Profile.id == row.guardian_id))).scalar_one_or_none()
    await _deliver(db, "guardian_declined", guardian, invite=row)
    await db.commit()


async def pending_for_user(db: AsyncSession, user: Profile) -> dict:
    """What this account can act on: a child sees invites sent to them; an adult sees invites they sent."""
    now = _now()
    open_clause = (GuardianLinkCode.consumed_at.is_(None), GuardianLinkCode.revoked_at.is_(None),
                   GuardianLinkCode.expires_at > now, GuardianLinkCode.kind == KIND_PARENT_INVITE)
    incoming, outgoing = [], []
    if user.role == RoleEnum.GROM:
        rows = (await db.execute(select(GuardianLinkCode, Profile).join(
            Profile, Profile.id == GuardianLinkCode.guardian_id).where(
            GuardianLinkCode.grom_id == user.id, *open_clause))).all()
        incoming = [{"invite_id": r.id, "from": {"id": g.id, "full_name": g.full_name, "avatar_url": g.avatar_url},
                     "expires_at": r.expires_at.isoformat()} for r, g in rows]
    else:
        rows = (await db.execute(select(GuardianLinkCode).where(
            GuardianLinkCode.guardian_id == user.id, *open_clause))).scalars().all()
        outgoing = [{"invite_id": r.id, "expires_at": r.expires_at.isoformat()} for r in rows]
    return {"incoming": incoming, "outgoing": outgoing}


# ------------------------------------------------------------------------------------------------ the link

async def _link(db: AsyncSession, child: Profile, guardian: Profile, proof: GuardianLinkCode) -> None:
    """Consume ``proof`` atomically and write the confirmed link. Raises 400/404/409 and writes nothing on failure."""
    if has_confirmed_link(child):
        raise HTTPException(status_code=409, detail="This account already has a linked parent or guardian.")
    now = _now()
    # The atomic single-use gate: only one caller can flip consumed_at from NULL. rowcount 0 = someone else won,
    # or the proof expired/was revoked between the read and now.
    claimed = await db.execute(
        update(GuardianLinkCode)
        .where(GuardianLinkCode.id == proof.id, GuardianLinkCode.consumed_at.is_(None),
               GuardianLinkCode.revoked_at.is_(None), GuardianLinkCode.expires_at > now)
        .values(consumed_at=now, consumed_by=guardian.id,
                guardian_id=guardian.id if proof.kind == KIND_CHILD_CODE else proof.guardian_id)
        .execution_options(synchronize_session=False))
    if claimed.rowcount != 1:
        await db.rollback()
        raise HTTPException(status_code=400, detail=INVALID_CODE_DETAIL)

    child.parent_id = guardian.id
    child.parent_link_approved = True
    existing = (await db.execute(select(GromGuardian).where(
        GromGuardian.grom_id == child.id, GromGuardian.guardian_id == guardian.id))).scalar_one_or_none()
    if existing is None:
        db.add(GromGuardian(grom_id=child.id, guardian_id=guardian.id, is_primary=True, verified_at=now,
                            created_at=now))
    else:
        existing.is_primary, existing.verified_at, existing.revoked_at = True, now, None
    await _revoke_open(db, child.id)   # every other open proof for this child dies with the link
    await db.flush()
    await sync_parent_flag(db, guardian.id)
    await _deliver(db, "guardian_linked", guardian, invite=proof)
    await _deliver(db, "guardian_linked", child, invite=proof)
    await db.commit()


async def unlink(db: AsyncSession, child: Profile) -> None:
    """End the confirmed link (the guardian-side, password-checked routes call this) and recompute the flag."""
    former = child.parent_id
    child.parent_id = None
    child.parent_link_approved = False
    if former:
        await db.execute(update(GromGuardian).where(
            GromGuardian.grom_id == child.id, GromGuardian.guardian_id == former,
            GromGuardian.revoked_at.is_(None)).values(revoked_at=_now()).execution_options(synchronize_session=False))
    await db.flush()
    if former:
        await sync_parent_flag(db, former)
    await db.commit()
