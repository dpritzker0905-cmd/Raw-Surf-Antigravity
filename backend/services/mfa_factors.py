"""
backend/services/mfa_factors.py -- the database side of two-factor sign-in.

Routes (routes/auth_pkg/mfa.py) stay thin; every guard that matters lives here so it can be tested and mutated
on its own. See docs/runbooks/MFA-DESIGN.md for the reasoning behind each number.

Rules this module owns:
  * a challenge is single use (one conditional UPDATE decides the winner) and attempt counted (an attempt is RESERVED
    atomically BEFORE the code is checked, so parallel guesses cannot exceed the limit);
  * a TOTP step already accepted is refused (monotonic last step advanced with a conditional UPDATE);
  * wrong authenticator codes are counted per account and pause TOTP only, never recovery codes or passkeys;
  * recovery codes are single use (conditional UPDATE) and stored as keyed hashes.
Nothing here logs a secret, a code, or a token.
"""
import json
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import List, Optional, Tuple

from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from core import totp
from core.mfa_secrets import (
    MfaKeyError, decrypt_secret, encrypt_secret, generate_recovery_codes, hash_recovery_code,
    new_opaque_token, recovery_code_matches, token_digest,
)
from models import MfaChallenge, MfaRecoveryCode, Notification, UserMfa, WebauthnCredential

logger = logging.getLogger(__name__)

CHALLENGE_TTL = timedelta(minutes=5)
CHALLENGE_MAX_ATTEMPTS = 5
TOTP_FAIL_MAX = 10
TOTP_FAIL_WINDOW = timedelta(minutes=15)


class TotpPaused(Exception):
    """Too many wrong authenticator codes for this account; TOTP (only) is paused until the window ends."""

    def __init__(self, retry_after: int):
        super().__init__("authenticator codes paused")
        self.retry_after = retry_after


class AlreadyEnrolled(Exception):
    pass


class EnrolmentNotStarted(Exception):
    pass


def _update(model):
    # Bulk statements are decided by the database (they are the atomic guards); never evaluated in Python against
    # session objects, which SQLite hands back with naive datetimes.
    return update(model).execution_options(synchronize_session=False)


def _delete(model):
    return delete(model).execution_options(synchronize_session=False)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def aware(value: Optional[datetime]) -> Optional[datetime]:
    """SQLite hands datetimes back naive; they were stored as UTC."""
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


@dataclass
class FactorState:
    totp: bool
    passkeys: int
    recovery_remaining: int

    @property
    def enabled(self) -> bool:
        return self.totp or self.passkeys > 0

    @property
    def methods(self) -> List[str]:
        out = []
        if self.totp:
            out.append("totp")
        if self.passkeys > 0:
            out.append("passkey")
        if self.recovery_remaining > 0:
            out.append("recovery")
        return out


async def get_factor_state(db: AsyncSession, user_id: str) -> FactorState:
    row = (await db.execute(select(UserMfa).where(UserMfa.user_id == user_id))).scalar_one_or_none()
    has_totp = bool(row and row.totp_confirmed_at and row.totp_secret_enc)
    remaining = (await db.execute(
        select(func.count()).select_from(MfaRecoveryCode)
        .where(MfaRecoveryCode.user_id == user_id, MfaRecoveryCode.used_at.is_(None))
    )).scalar_one()
    passkeys = (await db.execute(
        select(func.count()).select_from(WebauthnCredential).where(WebauthnCredential.user_id == user_id)
    )).scalar_one()
    return FactorState(totp=has_totp, passkeys=int(passkeys or 0), recovery_remaining=int(remaining or 0))


# ── Login challenges ──────────────────────────────────────────────────────────

async def create_login_challenge(db: AsyncSession, user_id: str) -> str:
    """A fresh single-use challenge for a user who has just proved their password. Only its hash is stored."""
    token = new_opaque_token()
    now = utcnow()
    await db.execute(_delete(MfaChallenge).where(
        MfaChallenge.user_id == user_id,
        or_(MfaChallenge.expires_at < now - timedelta(hours=1), MfaChallenge.consumed_at.is_not(None)),
    ))
    db.add(MfaChallenge(token_hash=token_digest(token), user_id=user_id, purpose="login",
                        expires_at=now + CHALLENGE_TTL, attempts=0))
    await db.commit()
    return token


async def reserve_challenge_attempt(db: AsyncSession, token: str) -> Optional[Tuple[str, int]]:
    """
    Spend one attempt of a live challenge BEFORE checking the code. Returns (user_id, attempts_used) or None when the
    challenge is unknown, expired, consumed or out of attempts. One conditional UPDATE: concurrent callers cannot
    exceed CHALLENGE_MAX_ATTEMPTS.
    """
    digest = token_digest(token)
    result = await db.execute(
        _update(MfaChallenge)
        .where(MfaChallenge.token_hash == digest, MfaChallenge.consumed_at.is_(None),
               MfaChallenge.expires_at > utcnow(), MfaChallenge.attempts < CHALLENGE_MAX_ATTEMPTS)
        .values(attempts=MfaChallenge.attempts + 1)
    )
    await db.commit()
    if result.rowcount != 1:
        return None
    row = (await db.execute(
        select(MfaChallenge.user_id, MfaChallenge.attempts).where(MfaChallenge.token_hash == digest)
    )).one()
    return row.user_id, int(row.attempts)


async def peek_challenge(db: AsyncSession, token: str) -> Optional[str]:
    """The user a LIVE challenge belongs to (no attempt spent), or None."""
    return (await db.execute(
        select(MfaChallenge.user_id).where(
            MfaChallenge.token_hash == token_digest(token), MfaChallenge.consumed_at.is_(None),
            MfaChallenge.expires_at > utcnow(), MfaChallenge.attempts < CHALLENGE_MAX_ATTEMPTS)
    )).scalar_one_or_none()


async def consume_challenge(db: AsyncSession, token: str) -> bool:
    """Mark the challenge used. True for exactly one caller, however many submit at once."""
    result = await db.execute(
        _update(MfaChallenge)
        .where(MfaChallenge.token_hash == token_digest(token), MfaChallenge.consumed_at.is_(None))
        .values(consumed_at=utcnow())
    )
    await db.commit()
    return result.rowcount == 1


# ── Checking a second factor ──────────────────────────────────────────────────

def looks_like_totp(code: str) -> bool:
    compact = "".join((code or "").split())
    return len(compact) == totp.DIGITS and compact.isascii() and compact.isdigit()


async def check_factor(db: AsyncSession, user_id: str, code: str) -> Optional[str]:
    """
    Verify a submitted authenticator code or recovery code for this user. Returns "totp", "recovery" or None.
    Side effects on success only: the TOTP step / the recovery code is spent. Raises TotpPaused or MfaKeyError.
    """
    if looks_like_totp(code):
        return "totp" if await _check_totp(db, user_id, code) else None
    return "recovery" if await _check_recovery(db, user_id, code) else None


async def _check_totp(db: AsyncSession, user_id: str, code: str) -> bool:
    row = (await db.execute(select(UserMfa).where(UserMfa.user_id == user_id))).scalar_one_or_none()
    if not (row and row.totp_confirmed_at and row.totp_secret_enc):
        return False
    now = utcnow()
    # Roll the failure window over when it has ended, then RESERVE one failure slot atomically. If the account is at
    # its ceiling the conditional UPDATE matches nothing and the code is not even looked at.
    await db.execute(_update(UserMfa).where(
        UserMfa.user_id == user_id,
        or_(UserMfa.totp_failed_window_start.is_(None), UserMfa.totp_failed_window_start <= now - TOTP_FAIL_WINDOW),
    ).values(totp_failed_count=0, totp_failed_window_start=now))
    reserved = await db.execute(_update(UserMfa).where(
        UserMfa.user_id == user_id,
        or_(UserMfa.totp_failed_count.is_(None), UserMfa.totp_failed_count < TOTP_FAIL_MAX),
    ).values(totp_failed_count=func.coalesce(UserMfa.totp_failed_count, 0) + 1))
    await db.commit()
    if reserved.rowcount != 1:
        fresh = (await db.execute(select(UserMfa.totp_failed_window_start).where(UserMfa.user_id == user_id))).scalar()
        started = aware(fresh) or now
        raise TotpPaused(max(1, int((started + TOTP_FAIL_WINDOW - now).total_seconds())))

    step = totp.verify(decrypt_secret(row.totp_secret_enc), code, last_used_step=row.totp_last_step)
    if step is None:
        return False
    accepted = await db.execute(_update(UserMfa).where(
        UserMfa.user_id == user_id, or_(UserMfa.totp_last_step.is_(None), UserMfa.totp_last_step < step),
    ).values(totp_last_step=step, totp_failed_count=0))
    await db.commit()
    return accepted.rowcount == 1  # 0 = a concurrent request already spent this step


async def _check_recovery(db: AsyncSession, user_id: str, code: str) -> bool:
    rows = (await db.execute(
        select(MfaRecoveryCode).where(MfaRecoveryCode.user_id == user_id, MfaRecoveryCode.used_at.is_(None))
    )).scalars().all()
    hit = None
    for row in rows:  # no early exit: timing does not reveal which code matched
        if recovery_code_matches(code, row.code_hash) and hit is None:
            hit = row
    if hit is None:
        return False
    spent = await db.execute(_update(MfaRecoveryCode).where(
        MfaRecoveryCode.id == hit.id, MfaRecoveryCode.used_at.is_(None)).values(used_at=utcnow()))
    await db.commit()
    return spent.rowcount == 1


# ── Enrolment, recovery codes, removal ────────────────────────────────────────

async def start_totp_enrolment(db: AsyncSession, user_id: str) -> str:
    """Create (or replace an unfinished) pending secret. Returns the plain secret ONCE, for the QR / manual entry."""
    row = (await db.execute(select(UserMfa).where(UserMfa.user_id == user_id))).scalar_one_or_none()
    if row is not None and row.totp_confirmed_at:
        raise AlreadyEnrolled()
    secret = totp.generate_secret()
    encrypted = encrypt_secret(secret)  # raises MfaKeyError when the key is not configured
    if row is None:
        db.add(UserMfa(user_id=user_id, totp_secret_enc=encrypted, totp_failed_count=0))
    else:
        row.totp_secret_enc = encrypted
        row.totp_last_step = None
    await db.commit()
    return secret


async def finish_totp_enrolment(db: AsyncSession, user_id: str, code: str) -> Optional[List[str]]:
    """Confirm the pending secret with a live code. Returns the recovery codes (shown once) or None for a wrong code."""
    row = (await db.execute(select(UserMfa).where(UserMfa.user_id == user_id))).scalar_one_or_none()
    if row is None or not row.totp_secret_enc:
        raise EnrolmentNotStarted()
    if row.totp_confirmed_at:
        raise AlreadyEnrolled()
    step = totp.verify(decrypt_secret(row.totp_secret_enc), code)
    if step is None:
        return None
    won = await db.execute(_update(UserMfa).where(
        UserMfa.user_id == user_id, UserMfa.totp_confirmed_at.is_(None),
    ).values(totp_confirmed_at=utcnow(), totp_last_step=step, totp_failed_count=0, totp_failed_window_start=None))
    if won.rowcount != 1:
        await db.rollback()
        raise AlreadyEnrolled()
    # The first factor of any kind creates the recovery codes; adding a second factor keeps the ones already saved.
    codes = await _ensure_recovery_codes(db, user_id)
    await db.commit()
    return codes


async def _ensure_recovery_codes(db: AsyncSession, user_id: str) -> List[str]:
    existing = (await db.execute(
        select(func.count()).select_from(MfaRecoveryCode).where(MfaRecoveryCode.user_id == user_id)
    )).scalar_one()
    return [] if existing else await _replace_recovery_codes(db, user_id)


async def _replace_recovery_codes(db: AsyncSession, user_id: str) -> List[str]:
    codes = generate_recovery_codes()
    await db.execute(_delete(MfaRecoveryCode).where(MfaRecoveryCode.user_id == user_id))
    for code in codes:
        db.add(MfaRecoveryCode(user_id=user_id, code_hash=hash_recovery_code(code)))
    return codes


async def regenerate_recovery_codes(db: AsyncSession, user_id: str) -> List[str]:
    codes = await _replace_recovery_codes(db, user_id)
    await db.commit()
    return codes


async def ensure_recovery_codes(db: AsyncSession, user_id: str) -> List[str]:
    """Codes for a user who has none yet (the first factor of any kind creates them); [] if they already exist."""
    codes = await _ensure_recovery_codes(db, user_id)
    await db.commit()
    return codes


async def remove_all_factors(db: AsyncSession, user_id: str) -> None:
    await db.execute(_delete(MfaRecoveryCode).where(MfaRecoveryCode.user_id == user_id))
    await db.execute(_delete(MfaChallenge).where(MfaChallenge.user_id == user_id))
    await db.execute(_delete(WebauthnCredential).where(WebauthnCredential.user_id == user_id))
    await db.execute(_delete(UserMfa).where(UserMfa.user_id == user_id))
    await db.commit()


async def notify_security_event(db: AsyncSession, user_id: str, title: str, body: str) -> None:
    """In-app notice for a security change. Best effort: a failure here must never undo or block the change."""
    try:
        db.add(Notification(user_id=user_id, type="security", title=title, body=body,
                            data=json.dumps({"alert_type": "security"})))
        await db.commit()
    except Exception:
        await db.rollback()
        logger.exception("could not record security notification")
