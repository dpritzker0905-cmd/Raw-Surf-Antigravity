"""
Username Management Routes
Handles:
- Username availability checking
- Username setting (during signup)
- Username changing (with 60-day cooldown)
- Username history tracking
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_
from pydantic import BaseModel, validator
from typing import Optional
from datetime import datetime, timezone, timedelta
import re

from database import get_db
from models import Profile, UsernameHistory

router = APIRouter(prefix="/username", tags=["username"])

# Username validation rules
USERNAME_MIN_LENGTH = 3
USERNAME_MAX_LENGTH = 30
USERNAME_PATTERN = re.compile(r'^[a-zA-Z][a-zA-Z0-9_]*$')  # Must start with letter, alphanumeric + underscore
RESERVED_USERNAMES = {
    'admin', 'administrator', 'support', 'help', 'rawsurf', 'rawsurfos',
    'official', 'mod', 'moderator', 'system', 'staff', 'team', 'api',
    'null', 'undefined', 'root', 'test', 'user', 'anonymous'
}
USERNAME_CHANGE_COOLDOWN_DAYS = 60


# ============ PYDANTIC SCHEMAS ============

class CheckUsernameRequest(BaseModel):
    username: str


class SetUsernameRequest(BaseModel):
    username: str
    
    @validator('username')
    def validate_username(cls, v):
        v = v.strip().lower()
        
        if len(v) < USERNAME_MIN_LENGTH:
            raise ValueError(f'Username must be at least {USERNAME_MIN_LENGTH} characters')
        if len(v) > USERNAME_MAX_LENGTH:
            raise ValueError(f'Username cannot exceed {USERNAME_MAX_LENGTH} characters')
        if not USERNAME_PATTERN.match(v):
            raise ValueError('Username must start with a letter and contain only letters, numbers, and underscores')
        if v in RESERVED_USERNAMES:
            raise ValueError('This username is reserved')
        
        return v


class ChangeUsernameRequest(BaseModel):
    new_username: str
    
    @validator('new_username')
    def validate_username(cls, v):
        v = v.strip().lower()
        
        if len(v) < USERNAME_MIN_LENGTH:
            raise ValueError(f'Username must be at least {USERNAME_MIN_LENGTH} characters')
        if len(v) > USERNAME_MAX_LENGTH:
            raise ValueError(f'Username cannot exceed {USERNAME_MAX_LENGTH} characters')
        if not USERNAME_PATTERN.match(v):
            raise ValueError('Username must start with a letter and contain only letters, numbers, and underscores')
        if v in RESERVED_USERNAMES:
            raise ValueError('This username is reserved')
        
        return v


# ============ HELPER FUNCTIONS ============

async def is_username_available(db: AsyncSession, username: str, exclude_user_id: Optional[str] = None) -> bool:
    """Check if a username is available (case-insensitive)"""
    username_lower = username.lower()
    
    # Check if reserved
    if username_lower in RESERVED_USERNAMES:
        return False
    
    # Check if currently taken by another user
    query = select(Profile).where(func.lower(Profile.username) == username_lower)
    if exclude_user_id:
        query = query.where(Profile.id != exclude_user_id)
    
    result = await db.execute(query)
    if result.scalar_one_or_none():
        return False
    
    return True


async def can_user_reclaim_username(db: AsyncSession, user_id: str, username: str) -> bool:
    """
    Check if a user can reclaim a username they previously owned.
    Returns False if someone else has claimed it.
    """
    username_lower = username.lower()
    
    # Find history record for this username
    result = await db.execute(
        select(UsernameHistory)
        .where(func.lower(UsernameHistory.username) == username_lower)
        .where(UsernameHistory.previous_owner_id == user_id)
    )
    history = result.scalar_one_or_none()
    
    if not history:
        return True  # User never owned this username, normal availability rules apply
    
    # If someone else claimed it, user cannot reclaim
    if history.claimed_by_id and history.claimed_by_id != user_id:
        return False
    
    return True


# ============ ENDPOINTS ============

@router.get("/check/{username}")
async def check_username_availability(
    username: str,
    user_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """
    Check if a username is available.
    Returns availability status and any issues.
    """
    username = username.strip().lower()
    
    # Validate format
    if len(username) < USERNAME_MIN_LENGTH:
        return {
            "username": username,
            "available": False,
            "reason": f"Username must be at least {USERNAME_MIN_LENGTH} characters"
        }
    
    if len(username) > USERNAME_MAX_LENGTH:
        return {
            "username": username,
            "available": False,
            "reason": f"Username cannot exceed {USERNAME_MAX_LENGTH} characters"
        }
    
    if not USERNAME_PATTERN.match(username):
        return {
            "username": username,
            "available": False,
            "reason": "Username must start with a letter and contain only letters, numbers, and underscores"
        }
    
    if username in RESERVED_USERNAMES:
        return {
            "username": username,
            "available": False,
            "reason": "This username is reserved"
        }
    
    # Check availability
    available = await is_username_available(db, username, exclude_user_id=user_id)
    
    # If user is checking for themselves, also check if they can reclaim
    can_reclaim = True
    if user_id and not available:
        # Check if the current owner is someone else
        result = await db.execute(
            select(Profile).where(func.lower(Profile.username) == username)
        )
        current_owner = result.scalar_one_or_none()
        if current_owner and current_owner.id == user_id:
            available = True  # They already own it
    
    if user_id and not available:
        can_reclaim = await can_user_reclaim_username(db, user_id, username)
    
    return {
        "username": username,
        "available": available,
        "can_reclaim": can_reclaim if not available else None,
        "reason": None if available else "Username is already taken"
    }


@router.post("/set")
async def set_username(
    data: SetUsernameRequest,
    user_id: str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    """
    Set username for the first time (during signup or profile setup).
    Only works if user doesn't already have a username.
    """
    result = await db.execute(
        select(Profile).where(Profile.id == user_id)
    )
    profile = result.scalar_one_or_none()
    
    if not profile:
        raise HTTPException(status_code=404, detail="User not found")
    
    if profile.username:
        raise HTTPException(status_code=400, detail="Username already set. Use change endpoint instead.")
    
    username = data.username.lower()
    
    # Check availability
    if not await is_username_available(db, username):
        raise HTTPException(status_code=409, detail="Username is already taken")
    
    # Set username
    profile.username = username
    profile.username_changed_at = datetime.now(timezone.utc)
    
    await db.commit()
    
    return {
        "success": True,
        "username": username,
        "message": f"Username @{username} has been set!"
    }


@router.put("/change")
async def change_username(
    data: ChangeUsernameRequest,
    user_id: str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    """
    Change username (with 60-day cooldown).
    Old username becomes available to others.
    If someone else takes the old username, original user cannot reclaim it.
    """
    result = await db.execute(
        select(Profile).where(Profile.id == user_id)
    )
    profile = result.scalar_one_or_none()
    
    if not profile:
        raise HTTPException(status_code=404, detail="User not found")
    
    old_username = profile.username
    new_username = data.new_username.lower()
    
    # Check cooldown
    if profile.username_changed_at:
        cooldown_end = profile.username_changed_at + timedelta(days=USERNAME_CHANGE_COOLDOWN_DAYS)
        if datetime.now(timezone.utc) < cooldown_end:
            days_remaining = (cooldown_end - datetime.now(timezone.utc)).days
            raise HTTPException(
                status_code=429,
                detail=f"Username can only be changed once every {USERNAME_CHANGE_COOLDOWN_DAYS} days. {days_remaining} days remaining."
            )
    
    # Check if same username
    if old_username and old_username.lower() == new_username:
        raise HTTPException(status_code=400, detail="New username is the same as current username")
    
    # Check availability
    if not await is_username_available(db, new_username, exclude_user_id=user_id):
        raise HTTPException(status_code=409, detail="Username is already taken")
    
    # Check if user can reclaim (if it was their old username taken by someone else)
    if not await can_user_reclaim_username(db, user_id, new_username):
        raise HTTPException(
            status_code=409,
            detail="This username was previously yours but has been claimed by another user. You cannot reclaim it."
        )
    
    # Record old username in history (if they had one)
    if old_username:
        history = UsernameHistory(
            username=old_username,
            previous_owner_id=user_id
        )
        db.add(history)
    
    # Update username
    profile.username = new_username
    profile.username_changed_at = datetime.now(timezone.utc)
    
    await db.commit()
    
    return {
        "success": True,
        "old_username": old_username,
        "new_username": new_username,
        "next_change_available": (datetime.now(timezone.utc) + timedelta(days=USERNAME_CHANGE_COOLDOWN_DAYS)).isoformat(),
        "message": f"Username changed to @{new_username}!"
    }


@router.get("/status")
async def get_username_status(
    user_id: str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    """
    Get user's current username status including cooldown info.
    """
    result = await db.execute(
        select(Profile).where(Profile.id == user_id)
    )
    profile = result.scalar_one_or_none()
    
    if not profile:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Calculate cooldown
    can_change = True
    days_until_change = 0
    next_change_date = None
    
    if profile.username_changed_at:
        cooldown_end = profile.username_changed_at + timedelta(days=USERNAME_CHANGE_COOLDOWN_DAYS)
        now = datetime.now(timezone.utc)
        
        if now < cooldown_end:
            can_change = False
            days_until_change = (cooldown_end - now).days + 1
            next_change_date = cooldown_end.isoformat()
        else:
            next_change_date = now.isoformat()
    
    return {
        "user_id": user_id,
        "username": profile.username,
        "has_username": profile.username is not None,
        "can_change": can_change,
        "days_until_change": days_until_change,
        "next_change_date": next_change_date,
        "last_changed": profile.username_changed_at.isoformat() if profile.username_changed_at else None,
        "cooldown_days": USERNAME_CHANGE_COOLDOWN_DAYS
    }


@router.get("/search")
async def search_usernames(
    q: str = Query(..., min_length=1),
    limit: int = Query(10, le=20),
    db: AsyncSession = Depends(get_db)
):
    """
    Search users by username for @mention autocomplete.
    Prioritizes exact prefix matches.
    """
    search_term = q.lower()
    
    # First get exact prefix matches
    prefix_result = await db.execute(
        select(Profile)
        .where(Profile.username.isnot(None))
        .where(func.lower(Profile.username).like(f"{search_term}%"))
        .order_by(Profile.username)
        .limit(limit)
    )
    prefix_matches = prefix_result.scalars().all()
    
    # If we need more, get contains matches
    remaining = limit - len(prefix_matches)
    contains_matches = []
    
    if remaining > 0:
        prefix_ids = [p.id for p in prefix_matches]
        contains_result = await db.execute(
            select(Profile)
            .where(Profile.username.isnot(None))
            .where(func.lower(Profile.username).like(f"%{search_term}%"))
            .where(Profile.id.notin_(prefix_ids) if prefix_ids else True)
            .order_by(Profile.username)
            .limit(remaining)
        )
        contains_matches = contains_result.scalars().all()
    
    # Combine results
    all_users = prefix_matches + contains_matches
    
    return [
        {
            "id": u.id,
            "user_id": u.id,
            "username": u.username,
            "full_name": u.full_name,
            "avatar_url": u.avatar_url,
            "role": u.role.value if u.role else None,
            "is_verified": u.is_verified
        }
        for u in all_users
    ]



@router.get("/lookup/{username}")
async def lookup_username(
    username: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Lookup a user by username.
    Returns user profile info for @mention navigation.
    """
    # Normalize username
    clean_username = username.lower().lstrip('@')
    
    result = await db.execute(
        select(Profile).where(
            func.lower(Profile.username) == clean_username
        )
    )
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    return {
        "id": user.id,
        "username": user.username,
        "full_name": user.full_name,
        "avatar_url": user.avatar_url,
        "role": user.role.value if user.role else None,
        "is_verified": user.is_verified
    }
