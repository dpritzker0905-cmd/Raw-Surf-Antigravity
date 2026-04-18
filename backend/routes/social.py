from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
import json
import asyncio

from database import get_db
from models import Profile, Follow, Notification

# Import OneSignal service for push notifications
try:
    from services.onesignal_service import onesignal_service
except ImportError:
    onesignal_service = None

router = APIRouter()

@router.post("/follow/{user_id}")
async def follow_user(user_id: str, follower_id: str, db: AsyncSession = Depends(get_db)):
    if user_id == follower_id:
        raise HTTPException(status_code=400, detail="Cannot follow yourself")
    
    user_result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = user_result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User to follow not found")
    
    follower_result = await db.execute(select(Profile).where(Profile.id == follower_id))
    follower = follower_result.scalar_one_or_none()
    if not follower:
        raise HTTPException(status_code=404, detail="Follower not found")
    
    existing = await db.execute(
        select(Follow).where(
            Follow.follower_id == follower_id,
            Follow.following_id == user_id
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Already following this user")
    
    follow = Follow(follower_id=follower_id, following_id=user_id)
    db.add(follow)
    
    notification = Notification(
        user_id=user_id,
        type='new_follower',
        title=f"{follower.full_name} started following you",
        body=f"@{follower.email.split('@')[0]} is now following you",
        data=json.dumps({
            "follower_id": follower_id,
            "type": "new_follower"
        })
    )
    db.add(notification)
    
    await db.commit()
    
    # Send push notification via OneSignal (fire and forget)
    if onesignal_service:
        asyncio.create_task(
            onesignal_service.send_new_follower_notification(
                recipient_id=user_id,
                follower_name=follower.full_name or "Someone",
                follower_id=follower_id
            )
        )
    
    return {"message": f"Now following {user.full_name}"}

@router.delete("/follow/{user_id}")
async def unfollow_user(user_id: str, follower_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Follow).where(
            Follow.follower_id == follower_id,
            Follow.following_id == user_id
        )
    )
    follow = result.scalar_one_or_none()
    
    if not follow:
        raise HTTPException(status_code=400, detail="Not following this user")
    
    await db.delete(follow)
    await db.commit()
    return {"message": "Unfollowed successfully"}

@router.get("/follow/check")
async def check_follow_status(follower_id: str, following_id: str, db: AsyncSession = Depends(get_db)):
    """Fast check: is follower_id following following_id?"""
    result = await db.execute(
        select(Follow).where(
            Follow.follower_id == follower_id,
            Follow.following_id == following_id
        )
    )
    follow = result.scalar_one_or_none()
    return {"is_following": follow is not None}

@router.get("/followers/{user_id}")
async def get_followers(user_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Follow)
        .where(Follow.following_id == user_id)
        .options(selectinload(Follow.follower))
    )
    follows = result.scalars().all()
    
    return [{
        "id": f.follower.id,
        "full_name": f.follower.full_name,
        "avatar_url": f.follower.avatar_url,
        "role": f.follower.role.value,
        "followed_at": f.created_at.isoformat()
    } for f in follows if f.follower]

@router.get("/following/{user_id}")
async def get_following(user_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Follow)
        .where(Follow.follower_id == user_id)
        .options(selectinload(Follow.following))
    )
    follows = result.scalars().all()
    
    return [{
        "id": f.following.id,
        "full_name": f.following.full_name,
        "avatar_url": f.following.avatar_url,
        "role": f.following.role.value,
        "followed_at": f.created_at.isoformat()
    } for f in follows if f.following]


@router.get("/profiles/{user_id}/friends")
async def get_friends(user_id: str, db: AsyncSession = Depends(get_db)):
    """
    Get mutual followers (friends) - people who follow you AND you follow back.
    Used for lineup invites, split sessions, etc.
    """
    # Get people who follow this user
    followers_result = await db.execute(
        select(Follow.follower_id)
        .where(Follow.following_id == user_id)
    )
    follower_ids = {f[0] for f in followers_result.fetchall()}
    
    # Get people this user follows
    following_result = await db.execute(
        select(Follow)
        .where(Follow.follower_id == user_id)
        .options(selectinload(Follow.following))
    )
    following = following_result.scalars().all()
    
    # Filter to only mutual (friends)
    friends = []
    for f in following:
        if f.following and f.following_id in follower_ids:
            friends.append({
                "id": f.following.id,
                "full_name": f.following.full_name,
                "username": f.following.username,
                "avatar_url": f.following.avatar_url,
                "role": f.following.role.value if f.following.role else None,
                "is_mutual": True
            })
    
    return friends
