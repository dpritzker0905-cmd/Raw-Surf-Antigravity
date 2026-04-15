"""
Crew Leaderboard API Routes
Handles crew statistics, badges, and leaderboard rankings
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc, or_, and_, text, cast
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone, timedelta
import hashlib
import json

from database import get_db
from models import (
    Profile, Booking, BookingParticipant,
    CrewStats, CrewBadge, UserCrewStats, CrewBadgeTypeEnum
)

router = APIRouter()


# ============================================================
# PYDANTIC MODELS
# ============================================================

class CrewMemberResponse(BaseModel):
    user_id: str
    full_name: Optional[str]
    avatar_url: Optional[str]
    role: Optional[str]


class CrewBadgeResponse(BaseModel):
    badge_type: str
    badge_name: str
    description: str
    tier: int
    tier_name: str
    icon: str
    progress: int
    target: int
    earned_at: Optional[datetime]


class CrewStatsResponse(BaseModel):
    id: str
    name: Optional[str]
    crew_size: int
    members: List[CrewMemberResponse]
    total_sessions: int
    total_waves_caught: int
    total_money_saved: float
    sunrise_sessions: int
    sunset_sessions: int
    weekend_sessions: int
    current_streak: int
    longest_streak: int
    badges: List[CrewBadgeResponse]
    is_public: bool
    first_session_at: Optional[datetime]
    last_session_at: Optional[datetime]


class LeaderboardEntry(BaseModel):
    rank: int
    crew_id: str
    crew_name: Optional[str]
    members: List[CrewMemberResponse]
    metric_value: float
    metric_name: str


class UserCrewSummary(BaseModel):
    total_crew_sessions: int
    total_unique_buddies: int
    total_saved_via_splits: float
    badges_earned: List[CrewBadgeResponse]
    favorite_buddy: Optional[CrewMemberResponse]
    top_crews: List[CrewStatsResponse]


# ============================================================
# BADGE DEFINITIONS
# ============================================================

BADGE_DEFINITIONS = {
    CrewBadgeTypeEnum.FREQUENT_FLYERS: {
        "name": "Frequent Flyers",
        "description": "Surf together 10+ times",
        "icon": "✈️",
        "tiers": [10, 25, 50],  # Bronze, Silver, Gold
    },
    CrewBadgeTypeEnum.DAWN_PATROL: {
        "name": "Dawn Patrol",
        "description": "5+ sunrise sessions together",
        "icon": "🌅",
        "tiers": [5, 15, 30],
    },
    CrewBadgeTypeEnum.SUNSET_CREW: {
        "name": "Sunset Crew",
        "description": "5+ evening sessions together",
        "icon": "🌇",
        "tiers": [5, 15, 30],
    },
    CrewBadgeTypeEnum.WEEKEND_WARRIORS: {
        "name": "Weekend Warriors",
        "description": "10+ weekend sessions together",
        "icon": "🏄",
        "tiers": [10, 25, 50],
    },
    CrewBadgeTypeEnum.SQUAD_GOALS: {
        "name": "Squad Goals",
        "description": "Crew of 5+ people",
        "icon": "👥",
        "tiers": [1, 5, 10],  # Earned N times with 5+ crew
    },
    CrewBadgeTypeEnum.DYNAMIC_DUO: {
        "name": "Dynamic Duo",
        "description": "Regular 2-person crew",
        "icon": "🤝",
        "tiers": [10, 25, 50],
    },
    CrewBadgeTypeEnum.WOLF_PACK: {
        "name": "Wolf Pack",
        "description": "4+ person crew 5+ times",
        "icon": "🐺",
        "tiers": [5, 15, 30],
    },
    CrewBadgeTypeEnum.RIDE_OR_DIE: {
        "name": "Ride or Die",
        "description": "Same crew 10+ sessions",
        "icon": "💯",
        "tiers": [10, 25, 50],
    },
    CrewBadgeTypeEnum.VARIETY_PACK: {
        "name": "Variety Pack",
        "description": "Surfed with 20+ different people",
        "icon": "🎭",
        "tiers": [20, 50, 100],
    },
    CrewBadgeTypeEnum.LOCAL_LEGENDS: {
        "name": "Local Legends",
        "description": "Same spot 10+ times together",
        "icon": "📍",
        "tiers": [10, 25, 50],
    },
    CrewBadgeTypeEnum.SMART_SPLITTERS: {
        "name": "Smart Splitters",
        "description": "Saved $500+ via crew splits",
        "icon": "💰",
        "tiers": [500, 1000, 2500],
    },
    CrewBadgeTypeEnum.BUDGET_BOSSES: {
        "name": "Budget Bosses",
        "description": "Saved $1000+ via crew splits",
        "icon": "👑",
        "tiers": [1000, 2500, 5000],
    },
}


def get_tier_name(tier: int) -> str:
    return ["Bronze", "Silver", "Gold"][tier - 1] if 1 <= tier <= 3 else "Bronze"


def generate_crew_hash(member_ids: List[str]) -> str:
    """Generate unique hash for a crew based on sorted member IDs"""
    sorted_ids = sorted(member_ids)
    return hashlib.md5(",".join(sorted_ids).encode()).hexdigest()


# ============================================================
# API ENDPOINTS
# ============================================================

@router.get("/crew/leaderboard")
async def get_crew_leaderboard(
    metric: str = Query("total_sessions", enum=["total_sessions", "total_money_saved", "total_waves_caught", "current_streak"]),
    limit: int = Query(20, ge=1, le=100),
    min_crew_size: int = Query(2, ge=2),
    db: AsyncSession = Depends(get_db)
):
    """
    Get crew leaderboard ranked by specified metric
    """
    # Build query based on metric
    order_column = getattr(CrewStats, metric)
    
    result = await db.execute(
        select(CrewStats)
        .where(CrewStats.is_public.is_(True))
        .where(CrewStats.crew_size >= min_crew_size)
        .order_by(desc(order_column))
        .limit(limit)
    )
    
    crews = result.scalars().all()
    
    leaderboard = []
    for rank, crew in enumerate(crews, 1):
        # Fetch member profiles
        member_profiles = []
        for member_id in crew.member_ids:
            profile_result = await db.execute(
                select(Profile).where(Profile.id == member_id)
            )
            profile = profile_result.scalar_one_or_none()
            if profile:
                member_profiles.append({
                    "user_id": profile.id,
                    "full_name": profile.full_name,
                    "avatar_url": profile.avatar_url,
                    "role": profile.role.value if profile.role else None
                })
        
        leaderboard.append({
            "rank": rank,
            "crew_id": crew.id,
            "crew_name": crew.name,
            "members": member_profiles,
            "metric_value": getattr(crew, metric),
            "metric_name": metric.replace("_", " ").title(),
            "crew_size": crew.crew_size,
            "badges_count": len(crew.badges) if crew.badges else 0
        })
    
    return {
        "leaderboard": leaderboard,
        "metric": metric,
        "total_crews": len(leaderboard)
    }


@router.get("/crew/stats/{crew_hash}")
async def get_crew_stats(
    crew_hash: str,
    user_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """
    Get detailed stats for a specific crew
    """
    result = await db.execute(
        select(CrewStats)
        .where(CrewStats.crew_hash == crew_hash)
        .options(selectinload(CrewStats.badges))
    )
    crew = result.scalar_one_or_none()
    
    if not crew:
        raise HTTPException(status_code=404, detail="Crew not found")
    
    # Check privacy
    if not crew.is_public:
        if not user_id or user_id not in crew.member_ids:
            raise HTTPException(status_code=403, detail="This crew's stats are private")
    
    # Fetch member profiles
    member_profiles = []
    for member_id in crew.member_ids:
        profile_result = await db.execute(
            select(Profile).where(Profile.id == member_id)
        )
        profile = profile_result.scalar_one_or_none()
        if profile:
            member_profiles.append({
                "user_id": profile.id,
                "full_name": profile.full_name,
                "avatar_url": profile.avatar_url,
                "role": profile.role.value if profile.role else None
            })
    
    # Format badges
    badges = []
    for badge in crew.badges:
        badge_def = BADGE_DEFINITIONS.get(badge.badge_type, {})
        badges.append({
            "badge_type": badge.badge_type.value,
            "badge_name": badge_def.get("name", badge.badge_type.value),
            "description": badge_def.get("description", ""),
            "tier": badge.tier,
            "tier_name": get_tier_name(badge.tier),
            "icon": badge_def.get("icon", "🏆"),
            "progress": badge.progress,
            "target": badge.target,
            "earned_at": badge.earned_at
        })
    
    return {
        "id": crew.id,
        "crew_hash": crew.crew_hash,
        "name": crew.name,
        "crew_size": crew.crew_size,
        "members": member_profiles,
        "is_public": crew.is_public,
        "stats": {
            "total_sessions": crew.total_sessions,
            "total_waves_caught": crew.total_waves_caught,
            "total_money_saved": crew.total_money_saved,
            "total_photos_shared": crew.total_photos_shared,
            "sunrise_sessions": crew.sunrise_sessions,
            "sunset_sessions": crew.sunset_sessions,
            "weekend_sessions": crew.weekend_sessions,
            "current_streak": crew.current_streak,
            "longest_streak": crew.longest_streak
        },
        "badges": badges,
        "first_session_at": crew.first_session_at,
        "last_session_at": crew.last_session_at
    }


@router.get("/users/{user_id}/crew-summary")
async def get_user_crew_summary(
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Get user's crew statistics for profile display
    """
    # Get or create user crew stats
    result = await db.execute(
        select(UserCrewStats).where(UserCrewStats.user_id == user_id)
    )
    user_stats = result.scalar_one_or_none()
    
    if not user_stats:
        # Calculate stats from bookings
        user_stats = await calculate_user_crew_stats(user_id, db)
    
    # Get user's top crews - use raw SQL for JSON array contains check
    # PostgreSQL: Check if user_id is in the member_ids JSON array
    crews_result = await db.execute(
        select(CrewStats)
        .where(text(f"member_ids::jsonb @> '\"{user_id}\"'::jsonb"))
        .order_by(desc(CrewStats.total_sessions))
        .limit(5)
    )
    top_crews = crews_result.scalars().all()
    
    # Format top crews
    formatted_crews = []
    for crew in top_crews:
        member_profiles = []
        for member_id in crew.member_ids:
            if member_id != user_id:  # Exclude current user
                profile_result = await db.execute(
                    select(Profile).where(Profile.id == member_id)
                )
                profile = profile_result.scalar_one_or_none()
                if profile:
                    member_profiles.append({
                        "user_id": profile.id,
                        "full_name": profile.full_name,
                        "avatar_url": profile.avatar_url
                    })
        
        formatted_crews.append({
            "crew_hash": crew.crew_hash,
            "name": crew.name or f"Crew with {', '.join([m.get('full_name', '?')[:10] for m in member_profiles[:2]])}",
            "members": member_profiles,
            "total_sessions": crew.total_sessions,
            "badges_count": len(crew.badges) if hasattr(crew, 'badges') and crew.badges else 0
        })
    
    # Get favorite buddy profile
    favorite_buddy = None
    if user_stats and user_stats.favorite_buddy_id:
        buddy_result = await db.execute(
            select(Profile).where(Profile.id == user_stats.favorite_buddy_id)
        )
        buddy = buddy_result.scalar_one_or_none()
        if buddy:
            favorite_buddy = {
                "user_id": buddy.id,
                "full_name": buddy.full_name,
                "avatar_url": buddy.avatar_url
            }
    
    # Format badges
    badges = []
    if user_stats and user_stats.badges_earned:
        for badge_data in user_stats.badges_earned:
            badge_type = badge_data.get("type")
            badge_def = BADGE_DEFINITIONS.get(CrewBadgeTypeEnum(badge_type), {}) if badge_type else {}
            badges.append({
                "badge_type": badge_type,
                "badge_name": badge_def.get("name", badge_type or "Unknown"),
                "description": badge_def.get("description", ""),
                "icon": badge_def.get("icon", "🏆"),
                "tier": badge_data.get("tier", 1),
                "tier_name": get_tier_name(badge_data.get("tier", 1)),
                "earned_at": badge_data.get("earned_at")
            })
    
    return {
        "user_id": user_id,
        "total_crew_sessions": user_stats.total_crew_sessions if user_stats else 0,
        "total_unique_buddies": user_stats.total_unique_buddies if user_stats else 0,
        "total_saved_via_splits": user_stats.total_saved_via_splits if user_stats else 0,
        "badges": badges,
        "favorite_buddy": favorite_buddy,
        "top_crews": formatted_crews
    }


@router.put("/crew/{crew_hash}/settings")
async def update_crew_settings(
    crew_hash: str,
    user_id: str,
    name: Optional[str] = None,
    is_public: Optional[bool] = None,
    db: AsyncSession = Depends(get_db)
):
    """
    Update crew settings (name, privacy) - only members can update
    """
    result = await db.execute(
        select(CrewStats).where(CrewStats.crew_hash == crew_hash)
    )
    crew = result.scalar_one_or_none()
    
    if not crew:
        raise HTTPException(status_code=404, detail="Crew not found")
    
    if user_id not in crew.member_ids:
        raise HTTPException(status_code=403, detail="Only crew members can update settings")
    
    if name is not None:
        crew.name = name
    if is_public is not None:
        crew.is_public = is_public
    
    crew.updated_at = datetime.now(timezone.utc)
    await db.commit()
    
    return {"success": True, "message": "Crew settings updated"}


@router.post("/crew/update-stats")
async def trigger_crew_stats_update(
    booking_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Update crew stats after a completed booking
    Called automatically after session completion
    """
    # Get booking with participants
    booking_result = await db.execute(
        select(Booking)
        .where(Booking.id == booking_id)
        .options(selectinload(Booking.participants))
    )
    booking = booking_result.scalar_one_or_none()
    
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    
    # Get all participant IDs including creator
    participant_ids = [booking.creator_id]
    for p in booking.participants:
        if p.participant_id and p.status == 'confirmed':
            participant_ids.append(p.participant_id)
    
    if len(participant_ids) < 2:
        return {"message": "Not enough participants for crew stats"}
    
    # Generate crew hash
    crew_hash = generate_crew_hash(participant_ids)
    
    # Get or create crew stats
    crew_result = await db.execute(
        select(CrewStats).where(CrewStats.crew_hash == crew_hash)
    )
    crew = crew_result.scalar_one_or_none()
    
    if not crew:
        crew = CrewStats(
            crew_hash=crew_hash,
            member_ids=participant_ids,
            crew_size=len(participant_ids),
            first_session_at=booking.session_date
        )
        db.add(crew)
    
    # Update stats
    crew.total_sessions += 1
    crew.last_session_at = booking.session_date
    
    # Check session time for dawn/sunset/weekend
    if booking.session_date:
        session_hour = booking.session_date.hour
        session_weekday = booking.session_date.weekday()
        
        if session_hour < 8:
            crew.sunrise_sessions += 1
        if session_hour >= 17:
            crew.sunset_sessions += 1
        if session_weekday >= 5:  # Saturday=5, Sunday=6
            crew.weekend_sessions += 1
    
    # Update money saved if split
    if booking.allow_splitting and booking.total_price:
        original_per_person = booking.total_price
        split_per_person = booking.total_price / len(participant_ids)
        savings = original_per_person - split_per_person
        crew.total_money_saved += savings * len(participant_ids)
    
    crew.updated_at = datetime.now(timezone.utc)
    
    # Check and award badges
    await check_and_award_badges(crew, db)
    
    # Update individual user stats
    for user_id in participant_ids:
        await update_user_crew_stats(user_id, db)
    
    await db.commit()
    
    return {"success": True, "crew_hash": crew_hash, "total_sessions": crew.total_sessions}


async def calculate_user_crew_stats(user_id: str, db: AsyncSession) -> UserCrewStats:
    """Calculate and create user crew stats from booking history"""
    
    # Count sessions where user was a participant with others
    bookings_result = await db.execute(
        select(Booking)
        .join(BookingParticipant, Booking.id == BookingParticipant.booking_id)
        .where(
            or_(
                Booking.creator_id == user_id,
                BookingParticipant.participant_id == user_id
            )
        )
        .where(Booking.status.in_(['Completed', 'Confirmed']))
        .options(selectinload(Booking.participants))
    )
    bookings = bookings_result.scalars().all()
    
    total_sessions = 0
    unique_buddies = set()
    total_saved = 0.0
    
    for booking in bookings:
        participant_ids = [booking.creator_id]
        for p in booking.participants:
            if p.participant_id and p.status in ['confirmed', 'Confirmed']:
                participant_ids.append(p.participant_id)
        
        if len(participant_ids) >= 2 and user_id in participant_ids:
            total_sessions += 1
            for pid in participant_ids:
                if pid != user_id:
                    unique_buddies.add(pid)
            
            if booking.allow_splitting and booking.total_price:
                split_per_person = booking.total_price / len(participant_ids)
                total_saved += booking.total_price - split_per_person
    
    # Create user stats
    user_stats = UserCrewStats(
        user_id=user_id,
        total_crew_sessions=total_sessions,
        total_unique_buddies=len(unique_buddies),
        total_saved_via_splits=total_saved,
        badges_earned=[]
    )
    
    # Find favorite buddy (most sessions with)
    if unique_buddies:
        buddy_counts = {}
        for booking in bookings:
            for p in booking.participants:
                if p.participant_id and p.participant_id != user_id:
                    buddy_counts[p.participant_id] = buddy_counts.get(p.participant_id, 0) + 1
        
        if buddy_counts:
            favorite = max(buddy_counts, key=buddy_counts.get)
            user_stats.favorite_buddy_id = favorite
    
    db.add(user_stats)
    
    return user_stats


async def update_user_crew_stats(user_id: str, db: AsyncSession):
    """Update user's crew stats after a session"""
    result = await db.execute(
        select(UserCrewStats).where(UserCrewStats.user_id == user_id)
    )
    user_stats = result.scalar_one_or_none()
    
    if not user_stats:
        user_stats = await calculate_user_crew_stats(user_id, db)
    else:
        user_stats.total_crew_sessions += 1
        user_stats.updated_at = datetime.now(timezone.utc)


async def check_and_award_badges(crew: CrewStats, db: AsyncSession):
    """Check if crew qualifies for any new badges"""
    
    existing_badges = {b.badge_type: b for b in (crew.badges or [])}
    
    badge_checks = [
        (CrewBadgeTypeEnum.FREQUENT_FLYERS, crew.total_sessions),
        (CrewBadgeTypeEnum.DAWN_PATROL, crew.sunrise_sessions),
        (CrewBadgeTypeEnum.SUNSET_CREW, crew.sunset_sessions),
        (CrewBadgeTypeEnum.WEEKEND_WARRIORS, crew.weekend_sessions),
        (CrewBadgeTypeEnum.RIDE_OR_DIE, crew.total_sessions),
        (CrewBadgeTypeEnum.SMART_SPLITTERS, crew.total_money_saved),
        (CrewBadgeTypeEnum.BUDGET_BOSSES, crew.total_money_saved),
    ]
    
    # Check crew size badges
    if crew.crew_size >= 5:
        badge_checks.append((CrewBadgeTypeEnum.SQUAD_GOALS, crew.total_sessions))
    if crew.crew_size == 2:
        badge_checks.append((CrewBadgeTypeEnum.DYNAMIC_DUO, crew.total_sessions))
    if crew.crew_size >= 4:
        badge_checks.append((CrewBadgeTypeEnum.WOLF_PACK, crew.total_sessions))
    
    for badge_type, progress in badge_checks:
        badge_def = BADGE_DEFINITIONS.get(badge_type)
        if not badge_def:
            continue
        
        tiers = badge_def["tiers"]
        current_tier = 0
        target = tiers[0]
        
        for i, threshold in enumerate(tiers):
            if progress >= threshold:
                current_tier = i + 1
                target = tiers[i + 1] if i + 1 < len(tiers) else threshold
        
        if current_tier > 0:
            existing = existing_badges.get(badge_type)
            if existing:
                if current_tier > existing.tier:
                    existing.tier = current_tier
                    existing.progress = progress
                    existing.target = target
                    existing.earned_at = datetime.now(timezone.utc)
            else:
                new_badge = CrewBadge(
                    crew_stats_id=crew.id,
                    badge_type=badge_type,
                    tier=current_tier,
                    progress=progress,
                    target=target
                )
                db.add(new_badge)
