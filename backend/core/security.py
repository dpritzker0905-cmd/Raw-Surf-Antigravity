"""
backend/core/security.py — JWT token signing and verification for Raw Surf.

Uses python-jose (already in requirements.txt) with HS256 algorithm.
Secret key is loaded from SECRET_KEY env var (required in production).

Usage:
    from core.security import create_access_token, verify_token, get_current_user_id

    # In auth route — generate token on login/signup:
    token = create_access_token({"sub": profile.id, "role": profile.role.value})

    # As FastAPI dependency — validate and extract user ID:
    async def my_route(user_id: str = Depends(get_current_user_id)):
        ...
"""

import os
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, Header, HTTPException
from jose import JWTError, jwt

logger = logging.getLogger(__name__)

# ── Development identity shortcuts ────────────────────────────────────────────
# Env vars that mean "this process is a real deployment", whatever else is unset. Render sets
# RENDER on every service; the rest cover the usual PaaS targets so a future move cannot silently
# re-open this.
_DEPLOYMENT_MARKERS = (
    "RENDER", "DYNO", "K_SERVICE", "FLY_APP_NAME", "WEBSITE_INSTANCE_ID",
    "KUBERNETES_SERVICE_HOST", "AWS_EXECUTION_ENV", "VERCEL",
)
# Env vars that positively assert "this is a local or test process".
_LOCAL_ENV_VALUES = frozenset({"development", "dev", "local", "test", "testing"})
_warned_refusal = False


def dev_identity_allowed() -> bool:
    """
    Whether the hardcoded development identities may stand in for a real one.

    ⛔ THIS FAILS CLOSED, AND THE PREVIOUS VERSION FAILED OPEN IN PRODUCTION.
    Measured against the live backend on 2026-08-06: neither ENV nor IS_PROD is set on Render, so
    the old test — `ENV != "production" and IS_PROD != "true"` — was TRUE in production. On
    https://raw-surf-antigravity.onrender.com, with no credentials at all:
        GET /api/streak/dev-mock-user-id                              -> 401
        ... with `Authorization: Bearer not-a-real-token-xyz`         -> 401   (control)
        ... with `Authorization: Bearer dev-mock-user-token`          -> 200
    The same condition guards the mock-profile seeding in server.py, so production also holds a
    seeded `dev-mock-user-id` with is_admin=True and withdrawable credits. The token string is
    hardcoded in the public frontend bundle (contexts/AuthContext.js).

    ★ THE DEFECT WAS THE DIRECTION OF THE TEST. It asked "have we been TOLD this is production?"
      when the only safe question is "have we been TOLD this is NOT production?". An environment
      that says nothing must be treated as production — absence of a signal is not a signal.

    To use the shortcut locally set any one of: TESTING=1 (the test suite already does),
    ENV=development, NODE_ENV=development, or ALLOW_DEV_MOCK_AUTH=true.
    """
    global _warned_refusal

    if os.getenv("ENV") == "production" or os.getenv("IS_PROD") == "true":
        return False
    deployed = [m for m in _DEPLOYMENT_MARKERS if os.environ.get(m)]
    if deployed:
        return False

    if os.getenv("ALLOW_DEV_MOCK_AUTH") == "true" or os.getenv("TESTING"):
        return True
    for var in ("ENV", "ENVIRONMENT", "NODE_ENV"):
        if (os.environ.get(var) or "").strip().lower() in _LOCAL_ENV_VALUES:
            return True

    # Refused by the fail-closed default. Say so ONCE and name the fix, so a local developer is
    # never left guessing why a mock login stopped working.
    if not _warned_refusal:
        _warned_refusal = True
        logger.warning(
            "[security] dev identity shortcut REFUSED: no environment variable asserts this is a "
            "local/test process. This is the safe default. For local development set one of "
            "TESTING=1, ENV=development, NODE_ENV=development or ALLOW_DEV_MOCK_AUTH=true."
        )
    return False


# ── Config ────────────────────────────────────────────────────────────────────
# SECRET_KEY must be set in production Render env vars.
# Generate one with: python -c "import secrets; print(secrets.token_hex(32))"
SECRET_KEY = os.getenv("SECRET_KEY", "")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_DAYS = 30  # Long-lived tokens for mobile-style UX

if not SECRET_KEY:
    import secrets
    _generated = secrets.token_hex(32)
    SECRET_KEY = _generated
    logger.warning(
        "[security] SECRET_KEY not set in environment — using ephemeral key. "
        "All tokens will be invalidated on server restart. "
        "Set SECRET_KEY in your Render environment variables."
    )


# ── Token Generation ──────────────────────────────────────────────────────────
def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """
    Create a signed JWT access token.

    Args:
        data: Payload to encode. Must include "sub" (subject = user_id).
        expires_delta: Optional expiry override. Defaults to ACCESS_TOKEN_EXPIRE_DAYS.

    Returns:
        Signed JWT string.
    """
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(days=ACCESS_TOKEN_EXPIRE_DAYS)
    )
    to_encode.update({"exp": expire, "iat": datetime.now(timezone.utc)})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


# ── Token Verification ────────────────────────────────────────────────────────
def verify_token(token: str) -> dict:
    """
    Verify a JWT token and return its decoded payload.

    Raises:
        HTTPException 401 if token is invalid, expired, or tampered.
    """
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except JWTError as e:
        logger.error(f"Token verification failed: {e}")
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired session. Please log in again.",
        )


# ── FastAPI Dependency ────────────────────────────────────────────────────────
async def get_current_user_id(
    authorization: Optional[str] = Header(None),
) -> str:
    """
    FastAPI dependency that extracts the authenticated user's ID
    from a verified JWT Bearer token.

    Usage:
        @router.get("/my-route")
        async def my_route(current_user_id: str = Depends(get_current_user_id)):
            ...
    """
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1]
        if token == "dev-mock-user-token" and dev_identity_allowed():
            return "dev-mock-user-id"
        payload = verify_token(token)
        sub = payload.get("sub")
        if not sub:
            raise HTTPException(status_code=401, detail="Invalid token payload.")
        return sub

    raise HTTPException(
        status_code=401,
        detail="Authentication required. Include Authorization: Bearer <token> header.",
    )


async def get_optional_user_id(
    authorization: Optional[str] = Header(None),
) -> Optional[str]:
    """
    Like get_current_user_id but returns None instead of raising for public routes.
    """
    try:
        return await get_current_user_id(authorization=authorization)
    except HTTPException:
        return None


# ── Migration Bridge ──────────────────────────────────────────────────────────
# These helpers let routes accept BOTH JWT tokens AND legacy user_id query params
# during the migration period.  Once the frontend is fully migrated, the query
# param fallback can be removed and routes can use get_current_user_id directly.

def get_user_id_from_jwt_or_query(
    authorization: Optional[str] = Header(None),
    user_id: Optional[str] = None,
) -> str:
    """
    Resolve the authenticated user's ID.

    Priority:
      1. JWT Bearer token (from Authorization header)
      2. Legacy user_id query parameter (backwards compat)

    Raises HTTPException 401 if neither is provided.
    """
    # Try JWT first
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1]
        if token == "dev-mock-user-token" and dev_identity_allowed():
            return "dev-mock-user-id"
        payload = verify_token(token)
        sub = payload.get("sub")
        if sub:
            return sub

    # Fall back to legacy query param
    if user_id:
        return user_id

    raise HTTPException(
        status_code=401,
        detail="Authentication required. Provide a Bearer token or user_id parameter.",
    )


def get_optional_user_id_from_jwt_or_query(
    authorization: Optional[str] = Header(None),
    user_id: Optional[str] = None,
) -> Optional[str]:
    """
    Like get_user_id_from_jwt_or_query but returns None for public/optional-auth routes.
    """
    try:
        return get_user_id_from_jwt_or_query(
            authorization=authorization, user_id=user_id
        )
    except HTTPException:
        return None
