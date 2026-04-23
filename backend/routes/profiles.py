from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
from pathlib import Path
import base64
import uuid

from database import get_db
from models import Profile, RoleEnum

router = APIRouter()

# Upload directory for avatars
UPLOAD_DIR = Path(__file__).parent.parent / "uploads" / "avatars"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

class ProfileResponse(BaseModel):
    id: str
    user_id: str
    email: str
    full_name: Optional[str]
    username: Optional[str] = None  # @username for Instagram-style display
    role: str
    subscription_tier: Optional[str]
    elite_tier: Optional[str] = None  # 'pro_elite', 'competitive', 'grom_rising'
    credit_balance: float
    bio: Optional[str]
    avatar_url: Optional[str]
    is_verified: bool = False
    is_live: bool = False  # Social broadcasting to followers
    is_shooting: bool = False  # Professional work at a spot (separate from is_live)
    is_private: bool = False
    is_approved_pro: bool = False
    pinned_post_id: Optional[str] = None  # ID of pinned post for profile
    location: Optional[str]
    company_name: Optional[str]
    portfolio_url: Optional[str]
    instagram_url: Optional[str]
    website_url: Optional[str]
    hourly_rate: Optional[float]
    session_price: Optional[float]
    accepts_donations: bool = False
    skill_level: Optional[str]
    stance: Optional[str]
    home_break: Optional[str]
    surf_mode: Optional[str] = 'casual'  # casual, competitive, pro (user-set); legend is via elite_tier (admin-set)
    is_grom_parent: bool = False  # True if user has Grom Parent privileges (role OR opt-in flag)
    # Surfer identification (for photographers)
    wetsuit_color: Optional[str] = None
    rash_guard_color: Optional[str] = None
    # Home/Pinned location for map centering
    home_latitude: Optional[float] = None
    home_longitude: Optional[float] = None
    home_location_name: Optional[str] = None
    created_at: datetime
    # On-Demand fields for Quick Book feature
    on_demand_active: bool = False  # Alias for on_demand_available for frontend compatibility
    on_demand_hourly_rate: Optional[float] = None
    is_logo_avatar: bool = False  # True = display as logo (object-contain), False = headshot (object-cover)

class ProfileUpdate(BaseModel):
    full_name: Optional[str] = None
    bio: Optional[str] = None
    avatar_url: Optional[str] = None
    location: Optional[str] = None
    is_live: Optional[bool] = None
    is_private: Optional[bool] = None
    company_name: Optional[str] = None
    portfolio_url: Optional[str] = None
    instagram_url: Optional[str] = None
    website_url: Optional[str] = None
    hourly_rate: Optional[float] = None
    session_price: Optional[float] = None
    accepts_donations: Optional[bool] = None
    skill_level: Optional[str] = None
    stance: Optional[str] = None
    home_break: Optional[str] = None
    surf_mode: Optional[str] = None  # casual, competitive, pro
    is_grom_parent: Optional[bool] = None  # toggle Grom Parent privileges for surfers
    # Surfer identification fields (for photographers)
    wetsuit_color: Optional[str] = None
    rash_guard_color: Optional[str] = None
    # For testing - allow credit adjustments
    credit_balance: Optional[float] = None
    # On-Demand fields
    on_demand_available: Optional[bool] = None
    on_demand_latitude: Optional[float] = None
    on_demand_longitude: Optional[float] = None
    on_demand_city: Optional[str] = None
    on_demand_hourly_rate: Optional[float] = None
    is_logo_avatar: Optional[bool] = None  # Toggle avatar display mode: logo vs headshot

class SubscriptionUpdate(BaseModel):
    subscription_tier: str

class ProOnboardingRequest(BaseModel):
    portfolio_url: str
    instagram_url: Optional[str] = None
    website_url: Optional[str] = None
    bio: Optional[str] = None

def profile_to_response(profile: Profile) -> ProfileResponse:
    return ProfileResponse(
        id=profile.id,
        user_id=profile.user_id,
        email=profile.email,
        full_name=profile.full_name,
        username=profile.username,  # @username for Instagram-style display
        role=profile.role.value,
        subscription_tier=profile.subscription_tier,
        elite_tier=profile.elite_tier,
        credit_balance=profile.credit_balance or 0,
        bio=profile.bio,
        avatar_url=profile.avatar_url,
        is_verified=profile.is_verified or False,
        is_live=profile.is_live or False,
        is_shooting=profile.is_shooting or False,  # Professional work at a spot
        is_private=profile.is_private or False,
        is_approved_pro=profile.is_approved_pro or False,
        pinned_post_id=profile.pinned_post_id,  # ID of pinned post
        location=profile.location,
        company_name=profile.company_name,
        portfolio_url=profile.portfolio_url,
        instagram_url=profile.instagram_url,
        website_url=profile.website_url,
        hourly_rate=profile.hourly_rate,
        session_price=profile.session_price,
        accepts_donations=profile.accepts_donations or False,
        skill_level=profile.skill_level,
        stance=profile.stance,
        home_break=profile.home_break,
        surf_mode=profile.surf_mode or 'casual',
        is_grom_parent=profile.is_grom_parent or False,
        # Surfer identification fields
        wetsuit_color=profile.wetsuit_color,
        rash_guard_color=profile.rash_guard_color,
        # Home/Pinned location for map centering
        home_latitude=profile.home_latitude,
        home_longitude=profile.home_longitude,
        home_location_name=profile.home_location_name,
        created_at=profile.created_at,
        # On-Demand fields for Quick Book feature
        on_demand_active=profile.on_demand_available or False,
        on_demand_hourly_rate=profile.on_demand_hourly_rate,
        is_logo_avatar=profile.is_logo_avatar or False
    )


@router.get("/profiles/search")
async def search_profiles(
    q: str,
    limit: int = 20,
    user_id: str = None,
    db: AsyncSession = Depends(get_db)
):
    """Search profiles by name - for compose modal with priority sorting and follow status"""
    from models import Friend, FriendshipStatusEnum
    
    search_term = f"%{q}%"
    
    result = await db.execute(
        select(Profile)
        .where(
            Profile.full_name.ilike(search_term)
        )
        .limit(50)  # Get more to sort properly
    )
    profiles = result.scalars().all()
    
    # Get follow relationships if user_id is provided
    follow_data = {}
    if user_id:
        # Get who the current user follows
        follows_result = await db.execute(
            select(Friend).where(
                Friend.requester_id == user_id,
                Friend.status == FriendshipStatusEnum.ACCEPTED
            )
        )
        user_follows = {f.addressee_id for f in follows_result.scalars().all()}
        
        # Get who follows the current user
        followers_result = await db.execute(
            select(Friend).where(
                Friend.addressee_id == user_id,
                Friend.status == FriendshipStatusEnum.ACCEPTED
            )
        )
        user_followers = {f.requester_id for f in followers_result.scalars().all()}
        
        # Build follow data for each profile
        for p in profiles:
            follow_data[p.id] = {
                'is_following': p.id in user_follows,
                'follows_you': p.id in user_followers,
                'is_mutual': p.id in user_follows and p.id in user_followers
            }
    
    # Priority sorting: 1. God Mode (Admins), 2. Pros/Photographers/Businesses, 3. Regular users
    def get_priority(p):
        if p.is_admin:
            return 0  # God Mode - highest priority
        role = p.role.value if p.role else 'Surfer'
        if role in ['Pro', 'Approved Pro', 'Comp Surfer']:
            return 1  # Pro Surfers
        if role in ['Photographer']:
            return 2  # Photographers
        if role in ['Shop', 'Shaper', 'Surf School', 'Resort']:
            return 3  # Businesses
        return 4  # Regular users
    
    sorted_profiles = sorted(profiles, key=lambda p: (get_priority(p), p.full_name or ''))[:limit]
    
    return [{
        "id": p.id,
        "full_name": p.full_name,
        "username": p.username,  # Use actual username from DB
        "avatar_url": p.avatar_url,
        "role": p.role.value if p.role else None,
        "location": p.location,
        "is_verified": p.is_verified,
        "is_admin": p.is_admin,
        "is_following": follow_data.get(p.id, {}).get('is_following', False),
        "follows_you": follow_data.get(p.id, {}).get('follows_you', False),
        "is_mutual": follow_data.get(p.id, {}).get('is_mutual', False)
    } for p in sorted_profiles]


@router.get("/profiles/by-username/{username}")
async def get_profile_by_username(username: str, db: AsyncSession = Depends(get_db)):
    """Resolve a username to a full profile. Used by shareable gallery storefront URLs."""
    from sqlalchemy import func as sql_func
    result = await db.execute(
        select(Profile).where(sql_func.lower(Profile.username) == username.lower())
    )
    profile = result.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="No user found with that username")
    return profile_to_response(profile)


@router.get("/profiles/{profile_id}/storefront-stats")
async def get_storefront_stats(profile_id: str, db: AsyncSession = Depends(get_db)):
    """Get rich stats for a photographer's public gallery storefront.
    Returns gallery count, total photos, follower count, review stats, and session history."""
    from models import GalleryItem, Gallery, Follow, LiveSession, Review
    from sqlalchemy import func as sql_func
    
    # Verify profile exists
    profile_result = await db.execute(select(Profile).where(Profile.id == profile_id))
    profile = profile_result.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    
    # Gallery stats
    gallery_count_result = await db.execute(
        select(sql_func.count(Gallery.id)).where(Gallery.photographer_id == profile_id)
    )
    gallery_count = gallery_count_result.scalar() or 0
    
    photo_count_result = await db.execute(
        select(sql_func.count(GalleryItem.id)).where(GalleryItem.photographer_id == profile_id)
    )
    photo_count = photo_count_result.scalar() or 0
    
    # Follower count
    follower_count_result = await db.execute(
        select(sql_func.count(Follow.id)).where(Follow.following_id == profile_id)
    )
    follower_count = follower_count_result.scalar() or 0
    
    # Session stats
    session_count_result = await db.execute(
        select(sql_func.count(LiveSession.id)).where(
            LiveSession.photographer_id == profile_id,
            LiveSession.status == 'ended'
        )
    )
    session_count = session_count_result.scalar() or 0
    
    # Review stats
    try:
        review_result = await db.execute(
            select(
                sql_func.count(Review.id),
                sql_func.avg(Review.rating)
            ).where(Review.reviewee_id == profile_id)
        )
        row = review_result.one()
        review_count = row[0] or 0
        avg_rating = round(float(row[1]), 1) if row[1] else 0
    except Exception:
        review_count = 0
        avg_rating = 0
    
    return {
        "gallery_count": gallery_count,
        "photo_count": photo_count,
        "follower_count": follower_count,
        "session_count": session_count,
        "review_count": review_count,
        "avg_rating": avg_rating,
        "is_shooting": profile.is_shooting or False,
        "on_demand_active": profile.on_demand_available or False,
    }


@router.get("/profiles/{profile_id}", response_model=ProfileResponse)
async def get_profile(profile_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Profile).where(Profile.id == profile_id))
    profile = result.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    return profile_to_response(profile)

@router.patch("/profiles/{profile_id}", response_model=ProfileResponse)
async def update_profile(profile_id: str, data: ProfileUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Profile).where(Profile.id == profile_id))
    profile = result.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    
    update_data = data.model_dump(exclude_unset=True)
    
    # Handle base64 avatar - store directly in DB as data URL 
    # (Render's ephemeral filesystem is wiped on every deploy, so we cannot use disk storage)
    if 'avatar_url' in update_data and update_data['avatar_url']:
        avatar_data = update_data['avatar_url']
        if avatar_data.startswith('data:image'):
            # Validate it's a real base64 image
            try:
                header, base64_str = avatar_data.split(',', 1)
                # Validate format (68 chars = multiple of 4, safe for padding check)
                import base64 as b64_module
                b64_module.b64decode(base64_str[:68], validate=False)
                # Keep the full data URL as-is in the DB — persistent across deploys
                # getFullUrl() on the frontend already handles data: URLs transparently
                update_data['avatar_url'] = avatar_data
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"Invalid image data: {str(e)}")
    
    for field, value in update_data.items():
        setattr(profile, field, value)
    
    await db.commit()
    await db.refresh(profile)
    return profile_to_response(profile)

@router.post("/profiles/{profile_id}/subscription")
async def update_subscription(profile_id: str, data: SubscriptionUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Profile).where(Profile.id == profile_id))
    profile = result.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    
    profile.subscription_tier = data.subscription_tier
    await db.commit()
    await db.refresh(profile)
    
    return {"message": "Subscription updated", "subscription_tier": profile.subscription_tier}

@router.post("/profiles/{profile_id}/pro-onboarding")
async def submit_pro_onboarding(profile_id: str, data: ProOnboardingRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Profile).where(Profile.id == profile_id))
    profile = result.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    
    if profile.role != RoleEnum.APPROVED_PRO:
        raise HTTPException(status_code=403, detail="Only Approved Pro photographers can submit onboarding")
    
    # Update profile with onboarding data
    profile.portfolio_url = data.portfolio_url
    if data.instagram_url:
        profile.instagram_url = data.instagram_url
    if data.website_url:
        profile.website_url = data.website_url
    if data.bio:
        profile.bio = data.bio
    
    # Also update the VerificationRequest with the professional information
    from models import VerificationRequest
    vr_result = await db.execute(
        select(VerificationRequest).where(
            VerificationRequest.user_id == profile_id,
            VerificationRequest.verification_type == 'approved_pro_photographer',
            VerificationRequest.status == 'pending'
        )
    )
    verification_request = vr_result.scalar_one_or_none()
    
    if verification_request:
        # Update the verification request with the professional info
        verification_request.portfolio_website = data.portfolio_url
        verification_request.instagram_url = data.instagram_url
        # Update additional notes with full professional context
        verification_request.additional_notes = f"Professional Profile Submitted:\n" \
            f"Portfolio: {data.portfolio_url}\n" \
            f"Instagram: {data.instagram_url or 'Not provided'}\n" \
            f"Website: {data.website_url or 'Not provided'}\n" \
            f"Bio: {data.bio or 'Not provided'}"
    
    await db.commit()
    await db.refresh(profile)
    
    return {"message": "Pro onboarding submitted for review", "portfolio_url": profile.portfolio_url}

@router.get("/profiles", response_model=List[ProfileResponse])
async def get_live_photographers(is_live: bool = True, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Profile)
        .where(Profile.role == RoleEnum.PHOTOGRAPHER)
        .where(Profile.is_live == is_live)
    )
    profiles = result.scalars().all()
    return [profile_to_response(p) for p in profiles]


@router.get("/users/search")
async def search_users(
    query: str,
    limit: int = 10,
    db: AsyncSession = Depends(get_db)
):
    """Search users by name, username, or email"""
    from sqlalchemy import or_
    
    if not query or len(query) < 2:
        return {"users": []}
    
    search_pattern = f"%{query}%"
    
    result = await db.execute(
        select(Profile)
        .where(
            or_(
                Profile.full_name.ilike(search_pattern),
                Profile.username.ilike(search_pattern),
                Profile.email.ilike(search_pattern)
            )
        )
        .limit(limit)
    )
    
    profiles = result.scalars().all()
    
    return {
        "users": [
            {
                "id": p.id,
                "full_name": p.full_name,
                "username": p.username,
                "avatar_url": p.avatar_url,
                "role": p.role.value if p.role else None
            }
            for p in profiles
        ]
    }


@router.get("/users/{user_id}/recent-buddies")
async def get_recent_buddies(
    user_id: str,
    limit: int = 10,
    db: AsyncSession = Depends(get_db)
):
    """Get users who the current user has been in sessions with recently"""
    from models import Booking, BookingParticipant
    from sqlalchemy.orm import selectinload
    
    # Find bookings where user was a participant
    bookings_result = await db.execute(
        select(Booking)
        .join(BookingParticipant, Booking.id == BookingParticipant.booking_id)
        .where(BookingParticipant.participant_id == user_id)
        .options(selectinload(Booking.participants).selectinload(BookingParticipant.participant))
        .order_by(Booking.session_date.desc())
        .limit(20)
    )
    
    bookings = bookings_result.scalars().all()
    
    # Collect unique buddies from these bookings
    seen_ids = set([user_id])
    buddies = []
    
    for booking in bookings:
        for participant in booking.participants:
            if participant.participant_id not in seen_ids and participant.participant:
                seen_ids.add(participant.participant_id)
                p = participant.participant
                buddies.append({
                    "id": p.id,
                    "full_name": p.full_name,
                    "username": p.username,  # Use actual username from DB
                    "avatar_url": p.avatar_url,
                    "role": p.role.value if p.role else None
                })
                if len(buddies) >= limit:
                    break
        if len(buddies) >= limit:
            break
    
    return {"buddies": buddies}


@router.get("/users/{user_id}/following")
async def get_following_list(
    user_id: str,
    limit: int = 20,
    db: AsyncSession = Depends(get_db)
):
    """Get list of users that current user is following or connected with.
    Falls back to Friend (mutual follow) relationships when no Follow records exist.
    This ensures the crew quick-add suggestions always have candidates.
    """
    from models import Follow, Friend, FriendshipStatusEnum
    from sqlalchemy.orm import selectinload

    # First try explicit Follow table
    result = await db.execute(
        select(Follow)
        .where(Follow.follower_id == user_id)
        .options(selectinload(Follow.following))
        .limit(limit)
    )
    follows = result.scalars().all()

    following = []
    seen_ids = set()
    for follow in follows:
        if follow.following:
            p = follow.following
            seen_ids.add(p.id)
            following.append({
                "id": p.id,
                "full_name": p.full_name,
                "username": p.username,
                "avatar_url": p.avatar_url,
                "role": p.role.value if p.role else None
            })

    # If too few results, supplement from Friend (mutual connection) table
    if len(following) < limit:
        from sqlalchemy import or_
        friend_result = await db.execute(
            select(Friend)
            .where(
                or_(Friend.requester_id == user_id, Friend.addressee_id == user_id),
                Friend.status == FriendshipStatusEnum.ACCEPTED
            )
            .options(
                selectinload(Friend.requester),
                selectinload(Friend.addressee)
            )
            .limit(limit * 2)
        )
        friends = friend_result.scalars().all()

        for friend in friends:
            # Determine which side is the other person
            other = friend.addressee if friend.requester_id == user_id else friend.requester
            if other and other.id not in seen_ids and other.id != user_id:
                seen_ids.add(other.id)
                following.append({
                    "id": other.id,
                    "full_name": other.full_name,
                    "username": other.username,
                    "avatar_url": other.avatar_url,
                    "role": other.role.value if other.role else None
                })
                if len(following) >= limit:
                    break

    return {"following": following}


# ============================================================
# User Favorites
# ============================================================

class FavoriteRequest(BaseModel):
    post_id: str

@router.post("/users/{user_id}/favorites")
async def add_to_favorites(
    user_id: str,
    request: FavoriteRequest,
    db: AsyncSession = Depends(get_db)
):
    """Add a post to user's favorites"""
    from models import UserFavorite, Post
    
    # Verify user exists
    user_result = await db.execute(select(Profile).where(Profile.id == user_id))
    if not user_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="User not found")
    
    # Verify post exists
    post_result = await db.execute(select(Post).where(Post.id == request.post_id))
    if not post_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Post not found")
    
    # Check if already favorited
    existing = await db.execute(
        select(UserFavorite)
        .where(UserFavorite.user_id == user_id)
        .where(UserFavorite.post_id == request.post_id)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Already in favorites")
    
    # Add to favorites
    favorite = UserFavorite(
        id=str(uuid.uuid4()),
        user_id=user_id,
        post_id=request.post_id
    )
    db.add(favorite)
    await db.commit()
    
    return {"success": True, "message": "Added to favorites"}

@router.delete("/users/{user_id}/favorites/{post_id}")
async def remove_from_favorites(
    user_id: str,
    post_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Remove a post from user's favorites"""
    from models import UserFavorite
    
    result = await db.execute(
        select(UserFavorite)
        .where(UserFavorite.user_id == user_id)
        .where(UserFavorite.post_id == post_id)
    )
    favorite = result.scalar_one_or_none()
    
    if not favorite:
        raise HTTPException(status_code=404, detail="Not in favorites")
    
    await db.delete(favorite)
    await db.commit()
    
    return {"success": True, "message": "Removed from favorites"}

@router.get("/users/{user_id}/favorites")
async def get_user_favorites(
    user_id: str,
    limit: int = 50,
    db: AsyncSession = Depends(get_db)
):
    """Get user's favorited posts"""
    from models import UserFavorite, Post
    from sqlalchemy.orm import selectinload
    
    result = await db.execute(
        select(UserFavorite)
        .options(selectinload(UserFavorite.post).selectinload(Post.author))
        .where(UserFavorite.user_id == user_id)
        .order_by(UserFavorite.created_at.desc())
        .limit(limit)
    )
    favorites = result.scalars().all()
    
    return [
        {
            "id": f.id,
            "post_id": f.post_id,
            "post": {
                "id": f.post.id,
                "media_url": f.post.media_url,
                "media_type": f.post.media_type,
                "thumbnail_url": f.post.thumbnail_url,
                "caption": f.post.caption,
                "author_name": f.post.author.full_name if f.post.author else None,
                "created_at": f.post.created_at
            } if f.post else None,
            "created_at": f.created_at
        } for f in favorites
    ]
