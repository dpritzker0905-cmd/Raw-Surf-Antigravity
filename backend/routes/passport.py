"""
Surf Passport API Routes
GPS-verified check-ins at surf spots for gamification
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, desc
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime, timezone, date, timedelta
import math
import json

from database import get_db
from models import Profile, SurfSpot, SurfPassportCheckIn, SurfPassportStats

router = APIRouter()

# GPS verification radius (meters) - user must be within this distance to check in
GPS_CHECKIN_RADIUS_METERS = 500  # 500m radius for check-in verification

# XP rewards
XP_FIRST_VISIT = 100  # First time visiting a spot
XP_REPEAT_VISIT = 25  # Repeat visit to same spot
XP_NEW_COUNTRY = 500  # First spot in a new country
XP_NEW_REGION = 100   # First spot in a new region
XP_STREAK_BONUS = 50  # Bonus per day of streak (multiplier)

# Level thresholds
LEVEL_THRESHOLDS = [0, 500, 1500, 3500, 7000, 12000, 20000, 35000, 55000, 80000]  # Level 1-10


def calculate_distance_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate distance between two GPS coordinates using Haversine formula."""
    R = 6371000  # Earth's radius in meters
    
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    
    a = math.sin(delta_phi/2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    
    return R * c


def get_level_from_xp(total_xp: int) -> int:
    """Calculate level from total XP."""
    for level, threshold in enumerate(LEVEL_THRESHOLDS):
        if total_xp < threshold:
            return max(1, level)
    return len(LEVEL_THRESHOLDS)


class CheckInRequest(BaseModel):
    spot_id: str
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    session_duration_minutes: Optional[int] = None
    notes: Optional[str] = None
    photo_url: Optional[str] = None


class CheckInResponse(BaseModel):
    success: bool
    message: str
    checkin_id: Optional[str] = None
    distance_meters: float
    is_verified: bool
    is_first_visit: bool
    xp_earned: int
    badge_earned: Optional[str] = None
    new_total_xp: int
    new_level: int
    streak_days: int


class PassportStatsResponse(BaseModel):
    total_checkins: int
    unique_spots_visited: int
    unique_countries_visited: int
    unique_regions_visited: int
    current_streak_days: int
    longest_streak_days: int
    total_xp_earned: int
    passport_level: int
    countries_breakdown: dict
    recent_checkins: list


@router.post("/passport/checkin", response_model=CheckInResponse)
async def checkin_at_spot(
    request: CheckInRequest,
    user_id: str = Query(..., description="User ID"),
    db: AsyncSession = Depends(get_db)
):
    """
    GPS-verified check-in at a surf spot.
    User must be within 500m of the spot to successfully check in.
    """
    # Get user profile
    user_result = await db.execute(select(Profile).where(Profile.id == user_id))
    current_user = user_result.scalar_one_or_none()
    if not current_user:
        raise HTTPException(status_code=404, detail="User not found")
    # Get the spot
    result = await db.execute(select(SurfSpot).where(SurfSpot.id == request.spot_id))
    spot = result.scalar_one_or_none()
    
    if not spot:
        raise HTTPException(status_code=404, detail="Surf spot not found")
    
    # Calculate distance from spot
    distance = calculate_distance_meters(
        request.latitude, request.longitude,
        float(spot.latitude), float(spot.longitude)
    )
    
    is_verified = distance <= GPS_CHECKIN_RADIUS_METERS
    
    if not is_verified:
        return CheckInResponse(
            success=False,
            message=f"You're too far from {spot.name}! You're {int(distance)}m away. Must be within {GPS_CHECKIN_RADIUS_METERS}m to check in.",
            distance_meters=round(distance, 1),
            is_verified=False,
            is_first_visit=False,
            xp_earned=0,
            new_total_xp=0,
            new_level=1,
            streak_days=0
        )
    
    # Check if this is first visit to this spot
    existing_checkin = await db.execute(
        select(SurfPassportCheckIn).where(
            and_(
                SurfPassportCheckIn.user_id == current_user.id,
                SurfPassportCheckIn.spot_id == spot.id,
                SurfPassportCheckIn.is_verified == True
            )
        ).limit(1)
    )
    is_first_visit = existing_checkin.scalar() is None
    
    # Get or create passport stats
    stats_result = await db.execute(
        select(SurfPassportStats).where(SurfPassportStats.user_id == current_user.id)
    )
    stats = stats_result.scalar_one_or_none()
    
    if not stats:
        stats = SurfPassportStats(user_id=current_user.id)
        db.add(stats)
    
    # Check for new country/region
    countries_data = json.loads(stats.countries_breakdown) if stats.countries_breakdown else {}
    is_new_country = spot.country and spot.country not in countries_data
    
    # Calculate XP
    xp_earned = 0
    if is_first_visit:
        xp_earned += XP_FIRST_VISIT
    else:
        xp_earned += XP_REPEAT_VISIT
    
    if is_new_country:
        xp_earned += XP_NEW_COUNTRY
    
    # Streak calculation
    today = date.today()
    if stats.last_checkin_date:
        days_since_last = (today - stats.last_checkin_date).days
        if days_since_last == 1:
            stats.current_streak_days += 1
            xp_earned += XP_STREAK_BONUS * min(stats.current_streak_days, 7)  # Cap at 7x
        elif days_since_last > 1:
            stats.current_streak_days = 1
    else:
        stats.current_streak_days = 1
    
    stats.longest_streak_days = max(stats.longest_streak_days, stats.current_streak_days)
    stats.last_checkin_date = today
    
    # Create check-in record
    checkin = SurfPassportCheckIn(
        user_id=current_user.id,
        spot_id=spot.id,
        checkin_latitude=request.latitude,
        checkin_longitude=request.longitude,
        distance_from_spot_meters=round(distance, 1),
        is_verified=True,
        is_first_visit=is_first_visit,
        earned_xp=xp_earned,
        session_duration_minutes=request.session_duration_minutes,
        notes=request.notes,
        photo_url=request.photo_url,
        spot_country=spot.country,
        spot_region=spot.region
    )
    db.add(checkin)
    
    # Update stats
    stats.total_checkins += 1
    stats.total_xp_earned += xp_earned
    stats.passport_level = get_level_from_xp(stats.total_xp_earned)
    
    if is_first_visit:
        stats.unique_spots_visited += 1
    
    if is_new_country and spot.country:
        stats.unique_countries_visited += 1
        countries_data[spot.country] = 1
    elif spot.country:
        countries_data[spot.country] = countries_data.get(spot.country, 0) + 1
    
    stats.countries_breakdown = json.dumps(countries_data)
    stats.updated_at = datetime.now(timezone.utc)
    
    # Check for badges
    badge_earned = None
    badges = json.loads(stats.badges_earned) if stats.badges_earned else []
    
    # First Check-In badge
    if stats.total_checkins == 1 and "first_checkin" not in badges:
        badge_earned = "first_checkin"
        badges.append(badge_earned)
        checkin.badge_earned = badge_earned
    
    # 10 Spots badge
    if stats.unique_spots_visited >= 10 and "explorer_10" not in badges:
        badge_earned = "explorer_10"
        badges.append(badge_earned)
        checkin.badge_earned = badge_earned
    
    # 5 Countries badge
    if stats.unique_countries_visited >= 5 and "globetrotter_5" not in badges:
        badge_earned = "globetrotter_5"
        badges.append(badge_earned)
        checkin.badge_earned = badge_earned
    
    # 7-Day Streak badge
    if stats.current_streak_days >= 7 and "streak_7" not in badges:
        badge_earned = "streak_7"
        badges.append(badge_earned)
        checkin.badge_earned = badge_earned
    
    # Track badge XP bonuses
    badge_xp_bonus = 0
    
    # Dawn Patrol badge - check-in before 7 AM local time
    # Using UTC time and calculating based on spot's approximate timezone from longitude
    # Each 15 degrees of longitude = 1 hour offset from UTC
    current_utc = datetime.now(timezone.utc)
    # Approximate local hour based on longitude (-180 to 180 maps to -12 to +12 hours)
    timezone_offset_hours = round(float(spot.longitude) / 15)
    local_hour = (current_utc.hour + timezone_offset_hours) % 24
    
    if local_hour < 7 and "dawn_patrol" not in badges:
        badge_earned = "dawn_patrol"
        badges.append(badge_earned)
        checkin.badge_earned = badge_earned
        badge_xp_bonus += 50  # Bonus XP for Dawn Patrol
    
    # Storm Chaser badge - check-in when wave height is significant
    # We'll check if user reports large swell OR if conditions from Open-Meteo show large waves
    # For now, we use session_notes or a separate field - simplified implementation
    # This badge is earned on first check-in during big swell conditions
    if request.notes and any(term in request.notes.lower() for term in ['big', 'heavy', 'overhead', 'double', 'triple', 'massive', 'storm', 'hurricane', 'pumping', '6ft', '8ft', '10ft', 'xl']):
        if "storm_chaser" not in badges:
            badge_earned = "storm_chaser"
            badges.append(badge_earned)
            checkin.badge_earned = badge_earned
            badge_xp_bonus += 75  # Bonus XP for Storm Chaser
    
    # Apply badge XP bonus to totals
    xp_earned += badge_xp_bonus
    checkin.earned_xp = xp_earned
    stats.total_xp_earned += badge_xp_bonus
    stats.passport_level = get_level_from_xp(stats.total_xp_earned)
    
    stats.badges_earned = json.dumps(badges)
    
    await db.commit()
    
    return CheckInResponse(
        success=True,
        message=f"Welcome to {spot.name}! {'First visit - bonus XP!' if is_first_visit else 'Great to see you again!'}",
        checkin_id=checkin.id,
        distance_meters=round(distance, 1),
        is_verified=True,
        is_first_visit=is_first_visit,
        xp_earned=xp_earned,
        badge_earned=badge_earned,
        new_total_xp=stats.total_xp_earned,
        new_level=stats.passport_level,
        streak_days=stats.current_streak_days
    )


@router.get("/passport/stats")
async def get_passport_stats(
    user_id: str = Query(..., description="User ID"),
    db: AsyncSession = Depends(get_db)
):
    """Get user's Surf Passport statistics."""
    # Get user profile
    user_result = await db.execute(select(Profile).where(Profile.id == user_id))
    current_user = user_result.scalar_one_or_none()
    if not current_user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Get or create stats
    result = await db.execute(
        select(SurfPassportStats).where(SurfPassportStats.user_id == current_user.id)
    )
    stats = result.scalar_one_or_none()
    
    if not stats:
        stats = SurfPassportStats(user_id=current_user.id)
        db.add(stats)
        await db.commit()
    
    # Get recent check-ins
    recent_result = await db.execute(
        select(SurfPassportCheckIn, SurfSpot)
        .join(SurfSpot, SurfPassportCheckIn.spot_id == SurfSpot.id)
        .where(
            and_(
                SurfPassportCheckIn.user_id == current_user.id,
                SurfPassportCheckIn.is_verified == True
            )
        )
        .order_by(desc(SurfPassportCheckIn.checkin_time))
        .limit(10)
    )
    
    recent_checkins = []
    for checkin, spot in recent_result:
        recent_checkins.append({
            "id": checkin.id,
            "spot_id": spot.id,
            "spot_name": spot.name,
            "country": spot.country,
            "region": spot.region,
            "checkin_time": checkin.checkin_time.isoformat(),
            "xp_earned": checkin.earned_xp,
            "is_first_visit": checkin.is_first_visit,
            "badge_earned": checkin.badge_earned
        })
    
    countries_data = json.loads(stats.countries_breakdown) if stats.countries_breakdown else {}
    badges = json.loads(stats.badges_earned) if stats.badges_earned else []
    
    return {
        "total_checkins": stats.total_checkins,
        "unique_spots_visited": stats.unique_spots_visited,
        "unique_countries_visited": stats.unique_countries_visited,
        "unique_regions_visited": stats.unique_regions_visited,
        "current_streak_days": stats.current_streak_days,
        "longest_streak_days": stats.longest_streak_days,
        "total_xp_earned": stats.total_xp_earned,
        "passport_level": stats.passport_level,
        "xp_to_next_level": LEVEL_THRESHOLDS[min(stats.passport_level, len(LEVEL_THRESHOLDS)-1)] - stats.total_xp_earned,
        "countries_breakdown": countries_data,
        "badges_earned": badges,
        "recent_checkins": recent_checkins
    }


@router.get("/passport/visited-spots")
async def get_visited_spots(
    user_id: str = Query(..., description="User ID"),
    country: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """Get all spots the user has visited (for passport stamp display)."""
    # Get user profile
    user_result = await db.execute(select(Profile).where(Profile.id == user_id))
    current_user = user_result.scalar_one_or_none()
    if not current_user:
        raise HTTPException(status_code=404, detail="User not found")
    
    query = select(SurfPassportCheckIn, SurfSpot).join(
        SurfSpot, SurfPassportCheckIn.spot_id == SurfSpot.id
    ).where(
        and_(
            SurfPassportCheckIn.user_id == current_user.id,
            SurfPassportCheckIn.is_verified == True
        )
    )
    
    if country:
        query = query.where(SurfSpot.country == country)
    
    query = query.order_by(desc(SurfPassportCheckIn.checkin_time))
    
    result = await db.execute(query)
    
    # Group by spot to get unique visits with counts
    spots_visited = {}
    for checkin, spot in result:
        if spot.id not in spots_visited:
            spots_visited[spot.id] = {
                "spot_id": spot.id,
                "spot_name": spot.name,
                "country": spot.country,
                "region": spot.region,
                "latitude": float(spot.latitude),
                "longitude": float(spot.longitude),
                "first_visit": checkin.checkin_time.isoformat(),
                "visit_count": 1,
                "total_xp_earned": checkin.earned_xp
            }
        else:
            spots_visited[spot.id]["visit_count"] += 1
            spots_visited[spot.id]["total_xp_earned"] += checkin.earned_xp
    
    return {
        "visited_spots": list(spots_visited.values()),
        "total_unique_spots": len(spots_visited)
    }


@router.get("/passport/leaderboard")
async def get_passport_leaderboard(
    category: str = Query("spots", enum=["spots", "countries", "xp", "streak"]),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db)
):
    """Get Surf Passport leaderboard."""
    order_column = {
        "spots": SurfPassportStats.unique_spots_visited,
        "countries": SurfPassportStats.unique_countries_visited,
        "xp": SurfPassportStats.total_xp_earned,
        "streak": SurfPassportStats.longest_streak_days
    }[category]
    
    result = await db.execute(
        select(SurfPassportStats, Profile)
        .join(Profile, SurfPassportStats.user_id == Profile.id)
        .order_by(desc(order_column))
        .limit(limit)
    )
    
    leaderboard = []
    for rank, (stats, profile) in enumerate(result, 1):
        leaderboard.append({
            "rank": rank,
            "user_id": profile.id,
            "full_name": profile.full_name,
            "avatar_url": profile.avatar_url,
            "unique_spots_visited": stats.unique_spots_visited,
            "unique_countries_visited": stats.unique_countries_visited,
            "total_xp_earned": stats.total_xp_earned,
            "passport_level": stats.passport_level,
            "longest_streak_days": stats.longest_streak_days
        })
    
    return {
        "category": category,
        "leaderboard": leaderboard
    }


@router.get("/passport/check-proximity/{spot_id}")
async def check_spot_proximity(
    spot_id: str,
    latitude: float = Query(..., ge=-90, le=90),
    longitude: float = Query(..., ge=-180, le=180),
    db: AsyncSession = Depends(get_db)
):
    """Check if user is within check-in range of a spot (preview before check-in)."""
    result = await db.execute(select(SurfSpot).where(SurfSpot.id == spot_id))
    spot = result.scalar_one_or_none()
    
    if not spot:
        raise HTTPException(status_code=404, detail="Surf spot not found")
    
    distance = calculate_distance_meters(
        latitude, longitude,
        float(spot.latitude), float(spot.longitude)
    )
    
    can_checkin = distance <= GPS_CHECKIN_RADIUS_METERS
    
    return {
        "spot_id": spot.id,
        "spot_name": spot.name,
        "distance_meters": round(distance, 1),
        "checkin_radius_meters": GPS_CHECKIN_RADIUS_METERS,
        "can_checkin": can_checkin,
        "message": f"You're {int(distance)}m from {spot.name}. " + 
                   ("Ready to check in!" if can_checkin else f"Get within {GPS_CHECKIN_RADIUS_METERS}m to check in.")
    }
