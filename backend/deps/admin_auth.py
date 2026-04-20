"""
backend/deps/admin_auth.py — Secure admin authentication dependency.

Validates the caller is an admin via JWT Bearer token instead of
trusting a user-supplied admin_id query parameter.

Usage:
    from deps.admin_auth import get_current_admin

    @router.get("/admin/endpoint")
    async def my_admin_route(admin: Profile = Depends(get_current_admin)):
        # admin is guaranteed to be a valid, authenticated admin user
        ...
"""

from fastapi import Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from database import get_db
from models import Profile
from core.security import get_current_user_id


async def get_current_admin(
    current_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> Profile:
    """
    FastAPI dependency that verifies the request comes from an authenticated admin.

    Chains on get_current_user_id (which validates the JWT Bearer token),
    then checks the is_admin flag on the user's profile.

    Returns the admin Profile object for use in the route handler.

    Raises:
        HTTPException 401 — if no valid token is provided.
        HTTPException 403 — if the authenticated user is not an admin.
        HTTPException 404 — if the user profile does not exist.
    """
    result = await db.execute(select(Profile).where(Profile.id == current_user_id))
    admin = result.scalar_one_or_none()

    if not admin:
        raise HTTPException(status_code=404, detail="Admin profile not found")

    if not admin.is_admin:
        raise HTTPException(status_code=403, detail="Admin privileges required")

    return admin
