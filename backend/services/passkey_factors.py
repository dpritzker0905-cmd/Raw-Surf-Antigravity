"""
backend/services/passkey_factors.py -- the database + WebAuthn side of passkeys (py_webauthn does the cryptography).

Rules this module owns:
  * a ceremony (the challenge we issued) is single use: one conditional UPDATE decides the winner, and it is spent
    BEFORE the response is verified, so a failed attempt cannot be retried against the same challenge;
  * verification uses the RP ID and origin STORED with the ceremony, never the request's;
  * user verification is required (a passkey is only ever accepted with a PIN / biometric / device unlock);
  * attestation is "none"; only the public key is stored;
  * the sign counter is advanced with a compare-and-set on the old value, and py_webauthn itself refuses a counter that
    did not increase when the authenticator reports counters;
  * a login assertion must carry the user handle of the credential's owner.
Nothing here logs a credential, a challenge, or a signature.
"""
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import List, Optional, Tuple

from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from webauthn import (
    generate_authentication_options, generate_registration_options, options_to_json,
    verify_authentication_response, verify_registration_response,
)
from webauthn.helpers import base64url_to_bytes, bytes_to_base64url
from webauthn.helpers.structs import (
    AttestationConveyancePreference, AuthenticatorSelectionCriteria, AuthenticatorTransport,
    PublicKeyCredentialDescriptor, ResidentKeyRequirement, UserVerificationRequirement,
)

from core.mfa_secrets import new_opaque_token, token_digest
from core.webauthn_config import RP_NAME, RpContext
from models import WebauthnCeremony, WebauthnCredential

logger = logging.getLogger(__name__)

CEREMONY_TTL = timedelta(minutes=5)
MAX_PASSKEYS = 20
_TRANSPORTS = {t.value for t in AuthenticatorTransport}


class CeremonyInvalid(Exception):
    """Unknown, expired, already used, or for a different purpose / user."""


class PasskeyRejected(Exception):
    """The authenticator's response did not verify."""


class DuplicatePasskey(Exception):
    pass


class TooManyPasskeys(Exception):
    pass


class NoPasskeyHere(Exception):
    """The user has no passkey for this site (RP ID)."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _update(model):
    return update(model).execution_options(synchronize_session=False)


def _descriptor(row: WebauthnCredential) -> PublicKeyCredentialDescriptor:
    transports = [AuthenticatorTransport(t) for t in _transports_of(row) if t in _TRANSPORTS]
    return PublicKeyCredentialDescriptor(id=base64url_to_bytes(row.credential_id), transports=transports or None)


def _transports_of(row: WebauthnCredential) -> List[str]:
    try:
        value = json.loads(row.transports) if row.transports else []
        return [t for t in value if isinstance(t, str)]
    except ValueError:
        return []


# ── Ceremonies ────────────────────────────────────────────────────────────────

async def open_ceremony(db: AsyncSession, *, purpose: str, rp: RpContext, challenge: bytes,
                        user_id: Optional[str] = None, mfa_challenge_hash: Optional[str] = None) -> str:
    token = new_opaque_token()
    await db.execute(delete(WebauthnCeremony).where(WebauthnCeremony.expires_at < _now() - timedelta(hours=1))
                     .execution_options(synchronize_session=False))
    db.add(WebauthnCeremony(
        token_hash=token_digest(token), purpose=purpose, user_id=user_id, challenge=bytes_to_base64url(challenge),
        rp_id=rp.rp_id, origin=rp.origin, mfa_challenge_hash=mfa_challenge_hash, expires_at=_now() + CEREMONY_TTL))
    await db.commit()
    return token


async def take_ceremony(db: AsyncSession, token: str, purpose: str,
                        user_id: Optional[str] = None) -> WebauthnCeremony:
    """Spend a ceremony. Exactly one caller gets it, however many submit at once."""
    digest = token_digest(token)
    conditions = [WebauthnCeremony.token_hash == digest, WebauthnCeremony.purpose == purpose,
                  WebauthnCeremony.consumed_at.is_(None), WebauthnCeremony.expires_at > _now()]
    if user_id is not None:
        conditions.append(WebauthnCeremony.user_id == user_id)
    spent = await db.execute(_update(WebauthnCeremony).where(*conditions).values(consumed_at=_now()))
    await db.commit()
    if spent.rowcount != 1:
        raise CeremonyInvalid()
    return (await db.execute(select(WebauthnCeremony).where(WebauthnCeremony.token_hash == digest))).scalar_one()


# ── Registration ──────────────────────────────────────────────────────────────

async def list_passkeys(db: AsyncSession, user_id: str) -> List[WebauthnCredential]:
    return list((await db.execute(
        select(WebauthnCredential).where(WebauthnCredential.user_id == user_id).order_by(WebauthnCredential.created_at)
    )).scalars().all())


async def registration_options(db: AsyncSession, profile, rp: RpContext) -> Tuple[str, dict]:
    existing = await list_passkeys(db, profile.id)
    if len(existing) >= MAX_PASSKEYS:
        raise TooManyPasskeys()
    options = generate_registration_options(
        rp_id=rp.rp_id, rp_name=RP_NAME, user_id=profile.id.encode("utf-8"), user_name=profile.email,
        user_display_name=profile.full_name or profile.email,
        attestation=AttestationConveyancePreference.NONE,
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.REQUIRED, user_verification=UserVerificationRequirement.REQUIRED),
        exclude_credentials=[_descriptor(c) for c in existing if c.rp_id == rp.rp_id],
    )
    ceremony = await open_ceremony(db, purpose="register", rp=rp, challenge=options.challenge, user_id=profile.id)
    return ceremony, json.loads(options_to_json(options))


async def finish_registration(db: AsyncSession, user_id: str, ceremony_id: str, credential: dict,
                              name: Optional[str]) -> WebauthnCredential:
    ceremony = await take_ceremony(db, ceremony_id, "register", user_id=user_id)
    try:
        verified = verify_registration_response(
            credential=credential, expected_challenge=base64url_to_bytes(ceremony.challenge),
            expected_rp_id=ceremony.rp_id, expected_origin=ceremony.origin, require_user_verification=True)
    except Exception as exc:
        logger.info("[passkeys] registration did not verify (%s)", type(exc).__name__)
        raise PasskeyRejected() from exc
    transports = [t for t in (credential.get("response", {}).get("transports") or []) if t in _TRANSPORTS]
    row = WebauthnCredential(
        user_id=user_id, credential_id=bytes_to_base64url(verified.credential_id),
        public_key=bytes_to_base64url(verified.credential_public_key), sign_count=verified.sign_count,
        rp_id=ceremony.rp_id, name=(name or "").strip()[:80] or "Passkey", transports=json.dumps(transports))
    db.add(row)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise DuplicatePasskey() from exc
    return row


# ── Authentication ────────────────────────────────────────────────────────────

async def login_options(db: AsyncSession, rp: RpContext) -> Tuple[str, dict]:
    """First-factor sign-in with no username: the browser offers the passkeys it holds for this site."""
    options = generate_authentication_options(rp_id=rp.rp_id, user_verification=UserVerificationRequirement.REQUIRED)
    ceremony = await open_ceremony(db, purpose="login", rp=rp, challenge=options.challenge)
    return ceremony, json.loads(options_to_json(options))


async def mfa_options(db: AsyncSession, user_id: str, rp: RpContext, mfa_challenge_hash: str) -> Tuple[str, dict]:
    mine = [c for c in await list_passkeys(db, user_id) if c.rp_id == rp.rp_id]
    if not mine:
        raise NoPasskeyHere()
    options = generate_authentication_options(
        rp_id=rp.rp_id, allow_credentials=[_descriptor(c) for c in mine],
        user_verification=UserVerificationRequirement.REQUIRED)
    ceremony = await open_ceremony(db, purpose="mfa", rp=rp, challenge=options.challenge, user_id=user_id,
                                   mfa_challenge_hash=mfa_challenge_hash)
    return ceremony, json.loads(options_to_json(options))


async def finish_authentication(db: AsyncSession, ceremony_id: str, purpose: str, credential: dict, *,
                                expect_user_id: Optional[str] = None,
                                expect_mfa_challenge_hash: Optional[str] = None) -> WebauthnCredential:
    """Verify an assertion; returns the credential row (its owner is the signed-in user)."""
    ceremony = await take_ceremony(db, ceremony_id, purpose, user_id=expect_user_id)
    if purpose == "mfa" and ceremony.mfa_challenge_hash != expect_mfa_challenge_hash:
        raise CeremonyInvalid()
    row = (await db.execute(select(WebauthnCredential).where(
        WebauthnCredential.credential_id == str(credential.get("id") or ""),
        WebauthnCredential.rp_id == ceremony.rp_id))).scalar_one_or_none()
    if row is None or (expect_user_id is not None and row.user_id != expect_user_id):
        raise PasskeyRejected()
    if purpose == "login":
        handle = (credential.get("response") or {}).get("userHandle")
        try:
            owner = base64url_to_bytes(handle).decode("utf-8") if handle else None
        except Exception:
            owner = None
        if owner != row.user_id:
            raise PasskeyRejected()
    try:
        verified = verify_authentication_response(
            credential=credential, expected_challenge=base64url_to_bytes(ceremony.challenge),
            expected_rp_id=ceremony.rp_id, expected_origin=ceremony.origin,
            credential_public_key=base64url_to_bytes(row.public_key),
            credential_current_sign_count=int(row.sign_count or 0), require_user_verification=True)
    except Exception as exc:
        logger.info("[passkeys] assertion did not verify (%s)", type(exc).__name__)
        raise PasskeyRejected() from exc
    advanced = await db.execute(_update(WebauthnCredential).where(
        WebauthnCredential.id == row.id, WebauthnCredential.sign_count == int(row.sign_count or 0),
    ).values(sign_count=verified.new_sign_count, last_used_at=_now()))
    await db.commit()
    if advanced.rowcount != 1:
        raise PasskeyRejected()  # a concurrent assertion already moved the counter
    return row


# ── Management ────────────────────────────────────────────────────────────────

async def rename_passkey(db: AsyncSession, user_id: str, passkey_id: str, name: str) -> bool:
    done = await db.execute(_update(WebauthnCredential).where(
        WebauthnCredential.id == passkey_id, WebauthnCredential.user_id == user_id).values(name=name.strip()[:80]))
    await db.commit()
    return done.rowcount == 1


async def remove_passkey(db: AsyncSession, user_id: str, passkey_id: str) -> bool:
    gone = await db.execute(delete(WebauthnCredential).where(
        WebauthnCredential.id == passkey_id, WebauthnCredential.user_id == user_id
    ).execution_options(synchronize_session=False))
    await db.commit()
    return gone.rowcount == 1
