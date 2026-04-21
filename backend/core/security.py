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
