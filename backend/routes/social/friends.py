"""
Social Proximity - Friends Routes
Friend finder, privacy settings, map visibility
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, func
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone

from database import get_db
from models import (
    Profile, Friend, FriendshipStatusEnum, PrivacySetting
)

router = APIRouter(prefix="/friends", tags=["friends"])


# ===================== PYDANTIC SCHEMAS =====================

class SendFriendRequest(BaseModel):
    addressee_id: str


class UpdatePrivacySettings(BaseModel):
    map_visibility: Optional[str] = None  # 'public', 'friends', 'none'
    is_ghost_mode: Optional[bool] = None
    allow_proximity_pings: Optional[bool] = None
    show_online_status: Optional[bool] = None
    show_last_seen: Optional[bool] = None
    is_private: Optional[bool] = None  # Profile-level: private account
    accepting_lineup_invites: Optional[bool] = None  # Profile-level: accept lineup invites


class UpdateGPSLocation(BaseModel):
    latitude: float
    longitude: float


# ===================== FRIEND ROUTES =====================

@router.post("/request")
async def send_friend_request(
    request_data: SendFriendRequest,
    requester_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Send a friend request"""
    if requester_id == request_data.addressee_id:
        raise HTTPException(status_code=400, detail="Cannot send friend request to yourself")
    
    # Check if request already exists
    result = await db.execute(
        select(Friend).where(
            or_(
                and_(
                    Friend.requester_id == requester_id,
                    Friend.addressee_id == request_data.addressee_id
                ),
                and_(
                    Friend.requester_id == request_data.addressee_id,
                    Friend.addressee_id == requester_id
                )
            )
        )
    )
    existing = result.scalar_one_or_none()
    
    if existing:
        if existing.status == FriendshipStatusEnum.ACCEPTED:
            raise HTTPException(status_code=400, detail="Already friends")
        elif existing.status == FriendshipStatusEnum.PENDING:
            raise HTTPException(status_code=400, detail="Friend request already pending")
        elif existing.status == FriendshipStatusEnum.BLOCKED:
            raise HTTPException(status_code=400, detail="Cannot send request to this user")
    
    # Create friend request
    friend_request = Friend(
        requester_id=requester_id,
        addressee_id=request_data.addressee_id,
        status=FriendshipStatusEnum.PENDING
    )
    
    db.add(friend_request)
    await db.commit()
    
    return {"message": "Friend request sent", "id": friend_request.id}


@router.post("/accept/{friend_request_id}")
async def accept_friend_request(
    friend_request_id: str,
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Accept a friend request"""
    result = await db.execute(
        select(Friend).where(Friend.id == friend_request_id)
    )
    request = result.scalar_one_or_none()
    
    if not request:
        raise HTTPException(status_code=404, detail="Friend request not found")
    
    if request.addressee_id != user_id:
        raise HTTPException(status_code=403, detail="Only the addressee can accept this request")
    
    if request.status != FriendshipStatusEnum.PENDING:
        raise HTTPException(status_code=400, detail=f"Request is not pending. Status: {request.status.value}")
    
    request.status = FriendshipStatusEnum.ACCEPTED
    request.accepted_at = datetime.now(timezone.utc)
    
    await db.commit()
    
    return {"message": "Friend request accepted"}


@router.post("/decline/{friend_request_id}")
async def decline_friend_request(
    friend_request_id: str,
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Decline a friend request"""
    result = await db.execute(
        select(Friend).where(Friend.id == friend_request_id)
    )
    request = result.scalar_one_or_none()
    
    if not request:
        raise HTTPException(status_code=404, detail="Friend request not found")
    
    if request.addressee_id != user_id:
        raise HTTPException(status_code=403, detail="Only the addressee can decline this request")
    
    await db.delete(request)
    await db.commit()
    
    return {"message": "Friend request declined"}


@router.delete("/{friend_id}")
async def remove_friend(
    friend_id: str,
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Remove a friend (unfriend)"""
    result = await db.execute(
        select(Friend).where(
            Friend.id == friend_id,
            Friend.status == FriendshipStatusEnum.ACCEPTED
        )
    )
    friendship = result.scalar_one_or_none()
    
    if not friendship:
        raise HTTPException(status_code=404, detail="Friendship not found")
    
    if user_id not in [friendship.requester_id, friendship.addressee_id]:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    await db.delete(friendship)
    await db.commit()
    
    return {"message": "Friend removed"}


@router.get("/list/{user_id}")
async def get_friends_list(
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get user's friends list"""
    result = await db.execute(
        select(Friend)
        .where(
            or_(
                Friend.requester_id == user_id,
                Friend.addressee_id == user_id
            ),
            Friend.status == FriendshipStatusEnum.ACCEPTED
        )
        .options(
            selectinload(Friend.requester),
            selectinload(Friend.addressee)
        )
    )
    friendships = result.scalars().all()
    
    friends = []
    for f in friendships:
        # Get the other person
        friend_profile = f.addressee if f.requester_id == user_id else f.requester
        friends.append({
            "friendship_id": f.id,
            "user": {
                "id": friend_profile.id,
                "full_name": friend_profile.full_name,
                "avatar_url": friend_profile.avatar_url,
                "role": friend_profile.role,
                "is_shooting": friend_profile.is_shooting
            },
            "since": f.accepted_at.isoformat() if f.accepted_at else None
        })
    
    return {"friends": friends, "count": len(friends)}


@router.get("/pending/{user_id}")
async def get_pending_requests(
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get pending friend requests (received)"""
    result = await db.execute(
        select(Friend)
        .where(
            Friend.addressee_id == user_id,
            Friend.status == FriendshipStatusEnum.PENDING
        )
        .options(selectinload(Friend.requester))
    )
    requests = result.scalars().all()
    
    return {
        "pending_requests": [{
            "id": r.id,
            "requester": {
                "id": r.requester.id,
                "full_name": r.requester.full_name,
                "avatar_url": r.requester.avatar_url,
                "role": r.requester.role
            },
            "created_at": r.created_at.isoformat()
        } for r in requests]
    }


# ===================== PRIVACY ROUTES =====================

@router.get("/privacy/{user_id}")
async def get_privacy_settings(
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get user's privacy settings"""
    result = await db.execute(
        select(PrivacySetting).where(PrivacySetting.user_id == user_id)
    )
    settings = result.scalar_one_or_none()
    
    if not settings:
        # Create default settings
        settings = PrivacySetting(user_id=user_id)
        db.add(settings)
        await db.commit()
    
    # Also get profile-level privacy settings
    from models import Profile
    profile_result = await db.execute(
        select(Profile).where(Profile.id == user_id)
    )
    profile = profile_result.scalar_one_or_none()
    
    return {
        "map_visibility": settings.map_visibility,
        "is_ghost_mode": settings.is_ghost_mode,
        "allow_proximity_pings": settings.allow_proximity_pings,
        "show_online_status": settings.show_online_status,
        "show_last_seen": settings.show_last_seen,
        # Profile-level privacy settings
        "is_private": profile.is_private if profile else False,
        "accepting_lineup_invites": getattr(profile, 'accepting_lineup_invites', True) if profile else True
    }


@router.put("/privacy/{user_id}")
async def update_privacy_settings(
    user_id: str,
    settings_data: UpdatePrivacySettings,
    db: AsyncSession = Depends(get_db)
):
    """Update user's privacy settings"""
    result = await db.execute(
        select(PrivacySetting).where(PrivacySetting.user_id == user_id)
    )
    settings = result.scalar_one_or_none()
    
    if not settings:
        settings = PrivacySetting(user_id=user_id)
        db.add(settings)
    
    # Update PrivacySetting fields that were provided
    if settings_data.map_visibility is not None:
        settings.map_visibility = settings_data.map_visibility
    if settings_data.is_ghost_mode is not None:
        settings.is_ghost_mode = settings_data.is_ghost_mode
    if settings_data.allow_proximity_pings is not None:
        settings.allow_proximity_pings = settings_data.allow_proximity_pings
    if settings_data.show_online_status is not None:
        settings.show_online_status = settings_data.show_online_status
    if settings_data.show_last_seen is not None:
        settings.show_last_seen = settings_data.show_last_seen
    
    # Also update Profile-level privacy settings if provided
    from models import Profile
    if hasattr(settings_data, 'is_private') and settings_data.is_private is not None:
        profile_result = await db.execute(
            select(Profile).where(Profile.id == user_id)
        )
        profile = profile_result.scalar_one_or_none()
        if profile:
            profile.is_private = settings_data.is_private
    
    if hasattr(settings_data, 'accepting_lineup_invites') and settings_data.accepting_lineup_invites is not None:
        profile_result = await db.execute(
            select(Profile).where(Profile.id == user_id)
        )
        profile = profile_result.scalar_one_or_none()
        if profile:
            profile.accepting_lineup_invites = settings_data.accepting_lineup_invites
    
    await db.commit()
    
    return {"message": "Privacy settings updated"}


# ===================== MAP LOCATION ROUTES =====================

@router.post("/location/{user_id}")
async def update_gps_location(
    user_id: str,
    location: UpdateGPSLocation,
    db: AsyncSession = Depends(get_db)
):
    """Update user's GPS location for friend finder"""
    result = await db.execute(
        select(PrivacySetting).where(PrivacySetting.user_id == user_id)
    )
    settings = result.scalar_one_or_none()
    
    if not settings:
        settings = PrivacySetting(user_id=user_id)
        db.add(settings)
    
    settings.gps_latitude = location.latitude
    settings.gps_longitude = location.longitude
    settings.gps_updated_at = datetime.now(timezone.utc)
    
    await db.commit()
    
    return {"message": "Location updated"}


@router.get("/map/{user_id}")
async def get_friends_on_map(
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Get friends' locations for map display
    Only returns friends who:
    - Have map_visibility = 'friends'
    - Are NOT in ghost mode
    - Have GPS coordinates updated (app is open)
    """
    # Get user's friends
    result = await db.execute(
        select(Friend)
        .where(
            or_(
                Friend.requester_id == user_id,
                Friend.addressee_id == user_id
            ),
            Friend.status == FriendshipStatusEnum.ACCEPTED
        )
    )
    friendships = result.scalars().all()
    
    # Get friend IDs
    friend_ids = []
    for f in friendships:
        friend_id = f.addressee_id if f.requester_id == user_id else f.requester_id
        friend_ids.append(friend_id)
    
    if not friend_ids:
        return {"friends_on_map": []}
    
    # Get friends' privacy settings and profiles
    result = await db.execute(
        select(PrivacySetting, Profile)
        .join(Profile, Profile.id == PrivacySetting.user_id)
        .where(
            PrivacySetting.user_id.in_(friend_ids),
            PrivacySetting.map_visibility == 'friends',
            PrivacySetting.is_ghost_mode.is_(False),
            PrivacySetting.gps_latitude.isnot(None),
            PrivacySetting.gps_longitude.isnot(None)
        )
    )
    results = result.all()
    
    friends_on_map = []
    for settings, profile in results:
        friends_on_map.append({
            "id": profile.id,
            "full_name": profile.full_name,
            "avatar_url": profile.avatar_url,
            "role": profile.role,
            "latitude": settings.gps_latitude,
            "longitude": settings.gps_longitude,
            "last_update": settings.gps_updated_at.isoformat() if settings.gps_updated_at else None,
            "is_shooting": profile.is_shooting
        })
    
    return {"friends_on_map": friends_on_map}



@router.get("/nearby")
async def get_nearby_friends(
    user_id: str,
    latitude: Optional[float] = None,
    longitude: Optional[float] = None,
    radius_miles: float = 10.0,
    db: AsyncSession = Depends(get_db)
):
    """
    Get friends who are currently nearby.
    Used for "Invite Nearby Crew" feature in Live Now sessions.
    """
    import math
    
    # Get user's location from params or profile
    if not latitude or not longitude:
        user_result = await db.execute(select(Profile).where(Profile.id == user_id))
        user = user_result.scalar_one_or_none()
        if user:
            latitude = user.latitude
            longitude = user.longitude
    
    if not latitude or not longitude:
        # Can't find nearby friends without location
        return []
    
    # Get user's accepted friends
    friends_result = await db.execute(
        select(Friend).where(
            and_(
                or_(Friend.requester_id == user_id, Friend.addressee_id == user_id),
                Friend.status == FriendshipStatusEnum.ACCEPTED
            )
        )
    )
    friends = friends_result.scalars().all()
    
    friend_ids = set()
    for f in friends:
        if f.requester_id == user_id:
            friend_ids.add(f.addressee_id)
        else:
            friend_ids.add(f.requester_id)
    
    if not friend_ids:
        return []
    
    # Get friend profiles with their locations
    profiles_result = await db.execute(
        select(Profile).where(
            Profile.id.in_(list(friend_ids))
        )
    )
    friend_profiles = profiles_result.scalars().all()
    
    # Filter to friends with location and calculate distance
    nearby_friends = []
    for profile in friend_profiles:
        if not profile.latitude or not profile.longitude:
            continue
        
        # Calculate distance (Haversine approximation)
        lat_diff = abs(latitude - profile.latitude)
        lon_diff = abs(longitude - profile.longitude)
        # Rough approximation: 1 degree latitude ≈ 69 miles
        distance_miles = math.sqrt((lat_diff * 69)**2 + (lon_diff * 69 * math.cos(math.radians(latitude)))**2)
        
        if distance_miles <= radius_miles:
            nearby_friends.append({
                "id": profile.id,
                "full_name": profile.full_name,
                "avatar_url": profile.avatar_url,
                "role": profile.role,
                "distance_miles": round(distance_miles, 1),
                "latitude": profile.latitude,
                "longitude": profile.longitude
            })
    
    # Sort by distance
    nearby_friends.sort(key=lambda x: x["distance_miles"])
    
    return nearby_friends
