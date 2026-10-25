"""
Two-factor authentication routes: TOTP + recovery codes, and the second step of sign-in.

Design and reasoning: docs/runbooks/MFA-DESIGN.md. The guards live in services/mfa_factors.py; this file is the HTTP
shell. Status-code convention: a wrong step-up answer (password / current factor) on a management route is 403, never
401, because the client treats any 401 on a non-auth route as an expired session and signs the user out.
"""
import logging
from dataclasses import dataclass
from datetime import timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core import mfa_limits
from core.mfa_policy import profile_requires_mfa
from core.mfa_secrets import MfaKeyError, mfa_configured, warn_if_unconfigured
from core.rate_limiter import rate_limit_check
from core.security import create_access_token, verify_token
from core import totp as totp_core
from database import get_db
from models import Profile
from routes.auth_pkg.auth import session_payload, verify_password
from services import mfa_factors as svc

router = APIRouter()
logger = logging.getLogger(__name__)

SETUP_SCOPE = "mfa_setup"
SETUP_TOKEN_TTL = timedelta(minutes=15)
STEPUP_PASSWORD_ERROR = "Password is incorrect"
STEPUP_FACTOR_ERROR = "That code is not valid"
UNAVAILABLE = "Two-step verification is not available right now."

warn_if_unconfigured()


# ── Caller identity (accepts the enrol-only token that ordinary routes refuse) ─

@dataclass
class MfaCaller:
    user_id: str
    setup_only: bool


async def mfa_caller(authorization: Optional[str] = Header(None)) -> MfaCaller:
    if authorization and authorization.startswith("Bearer "):
        payload = verify_token(authorization.split(" ", 1)[1], allow_scopes=(SETUP_SCOPE,))
        if payload.get("sub"):
            return MfaCaller(user_id=payload["sub"], setup_only=payload.get("scp") == SETUP_SCOPE)
    raise HTTPException(status_code=401, detail="Authentication required.")


async def full_session_caller(caller: MfaCaller = Depends(mfa_caller)) -> MfaCaller:
    if caller.setup_only:
        raise HTTPException(status_code=403, detail="Finish setting up two-step verification first.")
    return caller


async def _profile(db: AsyncSession, user_id: str) -> Profile:
    profile = (await db.execute(select(Profile).where(Profile.id == user_id))).scalar_one_or_none()
    if profile is None or profile.is_suspended:
        raise HTTPException(status_code=401, detail="Authentication required.")
    return profile


def _check_password(profile: Profile, password: str) -> None:
    """Step-up: re-enter the current password. Counted per ACCOUNT, because the bearer token alone must not be able
    to guess it. 403 (not 401) on a miss."""
    key = f"stepup:{profile.id}"
    mfa_limits.check_not_blocked(key)
    ok = False
    if profile.password_hash and password:
        try:
            ok = verify_password(password, profile.password_hash)
        except Exception:
            ok = False
    if not ok:
        mfa_limits.record_failure(key)
        raise HTTPException(status_code=403, detail=STEPUP_PASSWORD_ERROR)


async def _check_current_factor(db: AsyncSession, profile: Profile, code: str) -> str:
    """Step-up: a current authenticator code or an unused recovery code. Returns which one it was."""
    key = f"stepup:{profile.id}"
    mfa_limits.check_not_blocked(key)
    try:
        method = await svc.check_factor(db, profile.id, code)
    except svc.TotpPaused as paused:
        raise HTTPException(status_code=429, detail=f"Too many incorrect codes. Use a recovery code, or try again in "
                            f"{paused.retry_after // 60 + 1} minutes.", headers={"Retry-After": str(paused.retry_after)})
    except MfaKeyError:
        logger.error("[mfa] stored secret cannot be opened with the configured key")
        raise HTTPException(status_code=503, detail=UNAVAILABLE)
    if method is None:
        mfa_limits.record_failure(key)
        raise HTTPException(status_code=403, detail=STEPUP_FACTOR_ERROR)
    return method


# ── Sign-in gate (called by POST /auth/login after the password is accepted) ───

async def mfa_login_gate(db: AsyncSession, profile: Profile) -> Optional[dict]:
    """
    None  -> sign in as before (no factor enrolled, role not required).
    dict  -> NO session token: a challenge to answer, or an enrol-only token for a required role without a factor.
    """
    state = await svc.get_factor_state(db, profile.id)
    if state.enabled:
        challenge = await svc.create_login_challenge(db, profile.id)
        return {
            "mfa_required": True,
            "challenge_token": challenge,
            "expires_in": int(svc.CHALLENGE_TTL.total_seconds()),
            "methods": state.methods,
        }
    if profile_requires_mfa(profile):
        if not mfa_configured():
            # Failing closed here would lock the role out with no way to enrol. Misconfiguration is loud instead.
            logger.error("[mfa] MFA_REQUIRED_ROLES covers this account but MFA_ENCRYPTION_KEY is not configured; "
                         "signing in without a second factor")
            return None
        setup_token = create_access_token({"sub": profile.id, "role": profile.role.value, "scp": SETUP_SCOPE},
                                          expires_delta=SETUP_TOKEN_TTL)
        return {
            "mfa_setup_required": True,
            "setup_token": setup_token,
            "expires_in": int(SETUP_TOKEN_TTL.total_seconds()),
            "methods": ["totp"],
        }
    return None


# ── Second step of sign-in ────────────────────────────────────────────────────

class MfaLoginRequest(BaseModel):
    challenge_token: str = Field(min_length=10, max_length=200)
    code: str = Field(min_length=1, max_length=64)


EXPIRED = "Sign-in expired. Please start again."


@router.post("/auth/login/mfa")
async def login_mfa(request: Request, data: MfaLoginRequest, db: AsyncSession = Depends(get_db)):
    rate_limit_check(request, max_requests=20, window_seconds=60, key_prefix="mfa_login:")
    reserved = await svc.reserve_challenge_attempt(db, data.challenge_token)
    if reserved is None:
        raise HTTPException(status_code=401, detail=EXPIRED)
    user_id, attempts_used = reserved

    try:
        method = await svc.check_factor(db, user_id, data.code)
    except svc.TotpPaused as paused:
        raise HTTPException(status_code=429, detail="Too many incorrect authenticator codes. Use a recovery code, or "
                            f"try again in {paused.retry_after // 60 + 1} minutes.",
                            headers={"Retry-After": str(paused.retry_after)})
    except MfaKeyError:
        logger.error("[mfa] stored secret cannot be opened with the configured key")
        raise HTTPException(status_code=503, detail=UNAVAILABLE)

    if method is None:
        remaining = svc.CHALLENGE_MAX_ATTEMPTS - attempts_used
        if remaining <= 0:
            await svc.consume_challenge(db, data.challenge_token)  # the last miss kills the challenge
            raise HTTPException(status_code=401, detail=EXPIRED)
        raise HTTPException(status_code=401, detail=f"Incorrect code. {remaining} "
                            f"{'attempt' if remaining == 1 else 'attempts'} left.")

    if not await svc.consume_challenge(db, data.challenge_token):
        raise HTTPException(status_code=401, detail=EXPIRED)  # a concurrent request won this challenge

    profile = await _profile(db, user_id)
    token = create_access_token({"sub": profile.id, "role": profile.role.value, "amr": ["pwd", method]})
    payload = session_payload(profile, token)
    payload["mfa_method"] = method
    if method == "recovery":
        state = await svc.get_factor_state(db, profile.id)
        payload["recovery_codes_remaining"] = state.recovery_remaining
        await svc.notify_security_event(
            db, profile.id, "A recovery code was used to sign in",
            f"{state.recovery_remaining} recovery codes remain. If this was not you, change your password now.")
    return payload


# ── Management ────────────────────────────────────────────────────────────────

class PasswordBody(BaseModel):
    password: Optional[str] = Field(default=None, max_length=256)


class CodeBody(BaseModel):
    code: str = Field(min_length=1, max_length=64)


class StepUpBody(BaseModel):
    password: str = Field(max_length=256)
    code: str = Field(min_length=1, max_length=64)


def _manage_limit(request: Request) -> None:
    rate_limit_check(request, max_requests=30, window_seconds=300, key_prefix="mfa_manage:")


@router.get("/auth/mfa/status")
async def mfa_status(request: Request, caller: MfaCaller = Depends(mfa_caller), db: AsyncSession = Depends(get_db)):
    _manage_limit(request)
    profile = await _profile(db, caller.user_id)
    state = await svc.get_factor_state(db, profile.id)
    return {
        "enabled": state.enabled,
        "totp": state.totp,
        "passkeys": state.passkeys,
        "recovery_codes_remaining": state.recovery_remaining,
        "enrolment_available": mfa_configured(),
        "required": profile_requires_mfa(profile),
        "setup_only": caller.setup_only,
    }


@router.post("/auth/mfa/totp/begin")
async def totp_begin(request: Request, data: PasswordBody, caller: MfaCaller = Depends(mfa_caller),
                     db: AsyncSession = Depends(get_db)):
    _manage_limit(request)
    if not mfa_configured():
        raise HTTPException(status_code=503, detail=UNAVAILABLE)
    profile = await _profile(db, caller.user_id)
    if not caller.setup_only:  # the enrol-only token was itself issued for a correct password a moment ago
        _check_password(profile, data.password or "")
    try:
        secret = await svc.start_totp_enrolment(db, profile.id)
    except svc.AlreadyEnrolled:
        raise HTTPException(status_code=409, detail="An authenticator app is already set up. Turn it off first.")
    return {
        "secret": secret,
        "otpauth_uri": totp_core.provisioning_uri(secret, profile.email),
        "issuer": "Raw Surf",
        "account": profile.email,
        "digits": totp_core.DIGITS,
        "period": totp_core.PERIOD,
    }


@router.post("/auth/mfa/totp/confirm")
async def totp_confirm(request: Request, data: CodeBody, caller: MfaCaller = Depends(mfa_caller),
                       db: AsyncSession = Depends(get_db)):
    _manage_limit(request)
    profile = await _profile(db, caller.user_id)
    try:
        codes = await svc.finish_totp_enrolment(db, profile.id, data.code)
    except svc.EnrolmentNotStarted:
        raise HTTPException(status_code=409, detail="Start setting up the authenticator app first.")
    except svc.AlreadyEnrolled:
        raise HTTPException(status_code=409, detail="An authenticator app is already set up.")
    except MfaKeyError:
        logger.error("[mfa] pending secret cannot be opened with the configured key")
        raise HTTPException(status_code=503, detail=UNAVAILABLE)
    if codes is None:
        raise HTTPException(status_code=400, detail="That code didn't match. Check your authenticator and try again.")
    await svc.notify_security_event(db, profile.id, "Two-step verification is on",
                                    "An authenticator app now protects your sign-in.")
    response = {"enabled": True, "recovery_codes": codes}
    if caller.setup_only:
        token = create_access_token({"sub": profile.id, "role": profile.role.value, "amr": ["pwd", "totp"]})
        response["session"] = session_payload(profile, token)
    return response


@router.post("/auth/mfa/disable")
async def mfa_disable(request: Request, data: StepUpBody, caller: MfaCaller = Depends(full_session_caller),
                      db: AsyncSession = Depends(get_db)):
    _manage_limit(request)
    profile = await _profile(db, caller.user_id)
    state = await svc.get_factor_state(db, profile.id)
    if not state.enabled:
        raise HTTPException(status_code=409, detail="Two-step verification is not turned on.")
    _check_password(profile, data.password)
    await _check_current_factor(db, profile, data.code)
    await svc.remove_all_factors(db, profile.id)
    await svc.notify_security_event(db, profile.id, "Two-step verification was turned off",
                                    "If this was not you, change your password now.")
    return {"enabled": False}


@router.post("/auth/mfa/recovery-codes/regenerate")
async def recovery_regenerate(request: Request, data: StepUpBody, caller: MfaCaller = Depends(full_session_caller),
                              db: AsyncSession = Depends(get_db)):
    _manage_limit(request)
    profile = await _profile(db, caller.user_id)
    state = await svc.get_factor_state(db, profile.id)
    if not state.enabled:
        raise HTTPException(status_code=409, detail="Two-step verification is not turned on.")
    _check_password(profile, data.password)
    await _check_current_factor(db, profile, data.code)
    codes = await svc.regenerate_recovery_codes(db, profile.id)
    await svc.notify_security_event(db, profile.id, "Recovery codes were replaced",
                                    "Your old recovery codes no longer work.")
    return {"recovery_codes": codes}
