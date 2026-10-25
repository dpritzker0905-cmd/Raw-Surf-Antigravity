"""
Passkey (WebAuthn) routes: register, list / rename / remove, sign in with a passkey, and use one as the second factor.

Design and relying-party configuration: docs/runbooks/MFA-DESIGN.md and core/webauthn_config.py. The checks live in
services/passkey_factors.py. Same status-code convention as the rest of two-step verification: a wrong step-up answer is
403 (never 401, which signs the web client out); a failed sign-in assertion is 401.
"""
import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from core.mfa_secrets import MfaKeyError, mfa_configured, token_digest
from core.rate_limiter import rate_limit_check
from core.security import create_access_token
from core.webauthn_config import RpContext, passkeys_available, resolve_rp
from database import get_db
from routes.auth_pkg.auth import session_payload
from routes.auth_pkg.mfa import (
    EXPIRED, UNAVAILABLE, MfaCaller, _check_password, _manage_limit, _profile, finish_second_step,
    full_session_caller, mfa_caller, reject_attempt,
)
from services import mfa_factors as svc
from services import passkey_factors as pk

router = APIRouter()
logger = logging.getLogger(__name__)

NOT_HERE = "Passkeys aren't set up for this site."
ASK_AGAIN = "That passkey request expired. Please try again."
FAILED = "Your passkey couldn't be verified."


def _rp(request: Request) -> RpContext:
    if not passkeys_available():
        raise HTTPException(status_code=503, detail="Passkeys aren't available right now.")
    rp = resolve_rp(request.headers.get("origin"))
    if rp is None:
        raise HTTPException(status_code=400, detail=NOT_HERE)
    return rp


def _public(row, rp: Optional[RpContext] = None) -> dict:
    created: Optional[datetime] = row.created_at
    used: Optional[datetime] = row.last_used_at
    return {
        "id": row.id, "name": row.name,
        "created_at": created.isoformat() if created else None,
        "last_used_at": used.isoformat() if used else None,
        "usable_here": bool(rp and rp.rp_id == row.rp_id),
    }


# ── Registration ──────────────────────────────────────────────────────────────

class RegisterOptionsBody(BaseModel):
    password: Optional[str] = Field(default=None, max_length=256)


class RegisterVerifyBody(BaseModel):
    ceremony_id: str = Field(min_length=10, max_length=200)
    credential: dict
    name: Optional[str] = Field(default=None, max_length=80)


@router.post("/auth/passkeys/register/options")
async def register_options(request: Request, data: RegisterOptionsBody, caller: MfaCaller = Depends(mfa_caller),
                           db: AsyncSession = Depends(get_db)):
    _manage_limit(request)
    if not mfa_configured():  # recovery codes (made with the first factor) need the key
        raise HTTPException(status_code=503, detail=UNAVAILABLE)
    rp = _rp(request)
    profile = await _profile(db, caller.user_id)
    if not caller.setup_only:  # the enrol-only token was itself issued for a correct password a moment ago
        _check_password(profile, data.password or "")
    try:
        ceremony, options = await pk.registration_options(db, profile, rp)
    except pk.TooManyPasskeys:
        raise HTTPException(status_code=409, detail=f"You can have up to {pk.MAX_PASSKEYS} passkeys.")
    return {"ceremony_id": ceremony, "options": options}


@router.post("/auth/passkeys/register/verify")
async def register_verify(request: Request, data: RegisterVerifyBody, caller: MfaCaller = Depends(mfa_caller),
                          db: AsyncSession = Depends(get_db)):
    _manage_limit(request)
    profile = await _profile(db, caller.user_id)
    try:
        row = await pk.finish_registration(db, profile.id, data.ceremony_id, data.credential, data.name)
    except pk.CeremonyInvalid:
        raise HTTPException(status_code=400, detail=ASK_AGAIN)
    except pk.PasskeyRejected:
        raise HTTPException(status_code=400, detail=FAILED)
    except pk.DuplicatePasskey:
        raise HTTPException(status_code=409, detail="That passkey is already registered.")
    try:
        codes = await svc.ensure_recovery_codes(db, profile.id)  # [] when this is not the account's first factor
    except MfaKeyError:
        logger.error("[mfa] recovery codes could not be made: key not configured")
        codes = []
    await svc.notify_security_event(db, profile.id, "A passkey was added",
                                    f"\"{row.name}\" can now be used to sign in. If this was not you, change your password now.")
    response = {"passkey": _public(row, resolve_rp(request.headers.get("origin"))), "recovery_codes": codes}
    if caller.setup_only:
        token = create_access_token({"sub": profile.id, "role": profile.role.value, "amr": ["pwd", "webauthn"]})
        response["session"] = session_payload(profile, token)
    return response


# ── Manage ────────────────────────────────────────────────────────────────────

class RenameBody(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class RemoveBody(BaseModel):
    password: str = Field(max_length=256)


@router.get("/auth/passkeys")
async def list_my_passkeys(request: Request, caller: MfaCaller = Depends(full_session_caller),
                           db: AsyncSession = Depends(get_db)):
    _manage_limit(request)
    rp = resolve_rp(request.headers.get("origin"))
    return {"passkeys": [_public(row, rp) for row in await pk.list_passkeys(db, caller.user_id)]}


@router.patch("/auth/passkeys/{passkey_id}")
async def rename_passkey(request: Request, passkey_id: str, data: RenameBody,
                         caller: MfaCaller = Depends(full_session_caller), db: AsyncSession = Depends(get_db)):
    _manage_limit(request)
    if not data.name.strip():
        raise HTTPException(status_code=400, detail="Give the passkey a name.")
    if not await pk.rename_passkey(db, caller.user_id, passkey_id, data.name):
        raise HTTPException(status_code=404, detail="Passkey not found.")
    return {"id": passkey_id, "name": data.name.strip()[:80]}


@router.post("/auth/passkeys/{passkey_id}/remove")
async def remove_passkey(request: Request, passkey_id: str, data: RemoveBody,
                         caller: MfaCaller = Depends(full_session_caller), db: AsyncSession = Depends(get_db)):
    """Remove one passkey. Needs the password. Never removes the account's LAST second factor: turning
    two-step verification off entirely is /auth/mfa/disable (password + a current code)."""
    _manage_limit(request)
    profile = await _profile(db, caller.user_id)
    _check_password(profile, data.password)
    mine = {row.id for row in await pk.list_passkeys(db, profile.id)}
    if passkey_id not in mine:
        raise HTTPException(status_code=404, detail="Passkey not found.")
    state = await svc.get_factor_state(db, profile.id)
    if not state.totp and state.passkeys <= 1:
        raise HTTPException(
            status_code=409,
            detail="This is your only second step. Add an authenticator app or another passkey first, or turn "
                   "two-step verification off.")
    await pk.remove_passkey(db, profile.id, passkey_id)
    await svc.notify_security_event(db, profile.id, "A passkey was removed",
                                    "If this was not you, change your password now.")
    return {"removed": passkey_id}


# ── Sign in with a passkey (first factor, no password) ────────────────────────

class LoginVerifyBody(BaseModel):
    ceremony_id: str = Field(min_length=10, max_length=200)
    credential: dict


@router.post("/auth/login/passkey/options")
async def login_passkey_options(request: Request, db: AsyncSession = Depends(get_db)):
    rate_limit_check(request, max_requests=30, window_seconds=60, key_prefix="passkey_login:")
    ceremony, options = await pk.login_options(db, _rp(request))
    return {"ceremony_id": ceremony, "options": options}


@router.post("/auth/login/passkey/verify")
async def login_passkey_verify(request: Request, data: LoginVerifyBody, db: AsyncSession = Depends(get_db)):
    rate_limit_check(request, max_requests=30, window_seconds=60, key_prefix="passkey_login:")
    try:
        row = await pk.finish_authentication(db, data.ceremony_id, "login", data.credential)
    except pk.CeremonyInvalid:
        raise HTTPException(status_code=401, detail=ASK_AGAIN)
    except pk.PasskeyRejected:
        raise HTTPException(status_code=401, detail=FAILED)
    profile = await _profile(db, row.user_id)
    token = create_access_token({"sub": profile.id, "role": profile.role.value, "amr": ["webauthn"]})
    payload = session_payload(profile, token)
    payload["mfa_method"] = "passkey"
    return payload


# ── A passkey as the second factor ────────────────────────────────────────────

class MfaPasskeyOptionsBody(BaseModel):
    challenge_token: str = Field(min_length=10, max_length=200)


class MfaPasskeyVerifyBody(LoginVerifyBody):
    challenge_token: str = Field(min_length=10, max_length=200)


@router.post("/auth/login/mfa/passkey/options")
async def mfa_passkey_options(request: Request, data: MfaPasskeyOptionsBody, db: AsyncSession = Depends(get_db)):
    rate_limit_check(request, max_requests=30, window_seconds=60, key_prefix="mfa_login:")
    rp = _rp(request)
    user_id = await svc.peek_challenge(db, data.challenge_token)
    if user_id is None:
        raise HTTPException(status_code=401, detail=EXPIRED)
    try:
        ceremony, options = await pk.mfa_options(db, user_id, rp, token_digest(data.challenge_token))
    except pk.NoPasskeyHere:
        raise HTTPException(status_code=400, detail="You have no passkey for this site. Use another method.")
    return {"ceremony_id": ceremony, "options": options}


@router.post("/auth/login/mfa/passkey/verify")
async def mfa_passkey_verify(request: Request, data: MfaPasskeyVerifyBody, db: AsyncSession = Depends(get_db)):
    rate_limit_check(request, max_requests=30, window_seconds=60, key_prefix="mfa_login:")
    reserved = await svc.reserve_challenge_attempt(db, data.challenge_token)  # an attempt is spent BEFORE the check
    if reserved is None:
        raise HTTPException(status_code=401, detail=EXPIRED)
    user_id, attempts_used = reserved
    try:
        await pk.finish_authentication(db, data.ceremony_id, "mfa", data.credential, expect_user_id=user_id,
                                       expect_mfa_challenge_hash=token_digest(data.challenge_token))
    except (pk.CeremonyInvalid, pk.PasskeyRejected):
        await reject_attempt(db, data.challenge_token, attempts_used, FAILED)
    return await finish_second_step(db, data.challenge_token, user_id, "webauthn")
