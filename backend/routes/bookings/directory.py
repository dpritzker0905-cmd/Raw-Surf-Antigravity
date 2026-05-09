"""
bookings/directory.py — Photographer directory & nearby booking discovery
Extracted from crud.py (v96 audit) for LOC governance.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, func
from sqlalchemy.orm import selectinload
from typing import Optional
from datetime import datetime, timezone
import math
import logging

from database import get_db
from core.security import get_optional_user_id_from_jwt_or_query
from models import (
    Profile, Booking, BookingParticipant, RoleEnum
)

router = APIRouter()
logger = logging.getLogger(__name__)


# ============ PHOTOGRAPHER DIRECTORY ============


@router.get("/photographers/directory")
async def get_photographer_directory(
    region: Optional[str] = None,
    gear_type: Optional[str] = None,
    skill_level: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = 50,
    db: AsyncSession = Depends(get_db)
):
    """
    Get list of photographers for the booking directory.
    Supports filtering by region, gear type, skill level, and search by name/username.
    """
    # Build query for photographer roles
    # Hobbyists are NOT listed in directory — they're found organically (profile visits, existing conversations)
    photographer_roles = [RoleEnum.PHOTOGRAPHER, RoleEnum.APPROVED_PRO]
    
    query = select(Profile).where(Profile.role.in_(photographer_roles))
    
    # Apply skill level filter
    if skill_level and skill_level != 'all':
        role_map = {
            'hobbyist': RoleEnum.HOBBYIST,
            'photographer': RoleEnum.PHOTOGRAPHER,
            'approved_pro': RoleEnum.APPROVED_PRO
        }
        if skill_level in role_map:
            query = query.where(Profile.role == role_map[skill_level])
    
    # Apply search filter - search by name, username, or home_break
    if search:
        search_lower = f"%{search.lower()}%"
        query = query.where(
            or_(
                func.lower(Profile.full_name).like(search_lower),
                func.lower(Profile.username).like(search_lower),
                func.lower(Profile.home_break).like(search_lower),
                func.lower(Profile.location).like(search_lower)
            )
        )
    
    # Apply region filter (if home_break contains region info)
    if region and region != 'all':
        region_keywords = {
            'ny': ['new york', 'ny', 'long island', 'rockaway'],
            'fl': ['florida', 'fl', 'cocoa', 'jacksonville', 'miami'],
            'ca': ['california', 'ca', 'huntington', 'malibu', 'san diego', 'santa cruz'],
            'hi': ['hawaii', 'hi', 'oahu', 'maui', 'pipeline', 'north shore'],
            'cr': ['costa rica', 'tamarindo', 'nosara', 'pavones'],
            'pr': ['puerto rico', 'rincon', 'aguadilla'],
            'mx': ['mexico', 'baja', 'puerto escondido', 'sayulita'],
            'id': ['indonesia', 'bali', 'mentawai', 'lombok'],
            'au': ['australia', 'gold coast', 'byron', 'sydney', 'bells']
        }
        if region in region_keywords:
            region_conditions = [
                func.lower(Profile.home_break).like(f"%{kw}%") for kw in region_keywords[region]
            ] + [
                func.lower(Profile.location).like(f"%{kw}%") for kw in region_keywords[region]
            ]
            query = query.where(or_(*region_conditions))
    
    # Order by: real users first (have username), then approved pros, then verified
    query = query.order_by(
        Profile.username.isnot(None).desc(),  # Users with usernames first
        Profile.is_approved_pro.desc(),
        Profile.is_verified.desc(),
        Profile.full_name.asc()
    ).limit(limit)
    
    result = await db.execute(query)
    photographers = result.scalars().all()
    
    # Build response
    directory = []
    for p in photographers:
        # Default gear types (will be enhanced later when fields are added to Profile)
        gear_types = ['land']  # Default assumption
        
        directory.append({
            "id": p.id,
            "full_name": p.full_name,
            "username": p.username,  # Added username for @handle display
            "avatar_url": p.avatar_url,
            "role": p.role.value if p.role else None,
            "is_approved_pro": p.is_approved_pro or False,
            "is_verified": p.is_verified or False,
            "home_break": p.home_break or p.location,
            "location": p.location,
            "region": None,  # Will be parsed from home_break
            "gear_types": gear_types,
            "avg_rating": 4.8,  # Will be calculated from reviews
            "total_sessions": 0,  # Will be calculated from bookings
            # Use booking rate hierarchy: booking_hourly_rate > hourly_rate > session_price
            "session_rate": p.booking_hourly_rate or p.hourly_rate or p.session_price,
            "hourly_rate": p.booking_hourly_rate or p.hourly_rate,
            "is_available": True,
            "is_shooting": p.is_shooting or False
        })
    
    return directory


# ============ NEARBY OPEN BOOKINGS ============


@router.get("/bookings/nearby")
async def get_nearby_open_bookings(
    latitude: float,
    longitude: float,
    radius: float = Query(default=5.0, description="Radius in miles"),
    skill_level: Optional[str] = Query(default=None, description="Filter by skill level (Beginner, Intermediate, Advanced, Expert)"),
    user_id: Optional[str] = Depends(get_optional_user_id_from_jwt_or_query),
    db: AsyncSession = Depends(get_db)
):
    """Find open bookings nearby that allow strangers to join, optionally filtered by skill level"""
    # Get user skill level if user_id provided
    user_skill = None
    if user_id:
        user_result = await db.execute(select(Profile).where(Profile.id == user_id))
        user = user_result.scalar_one_or_none()
        if user:
            user_skill = user.skill_level
    
    # Get bookings with open_nearby or skill_match mode
    result = await db.execute(
        select(Booking)
        .where(Booking.allow_splitting.is_(True))
        .where(Booking.split_mode.in_(['open_nearby', 'skill_match']))
        .where(Booking.status.in_(['Pending', 'Confirmed']))
        .where(Booking.session_date > datetime.now(timezone.utc))
        .options(
            selectinload(Booking.photographer),
            selectinload(Booking.participants).selectinload(BookingParticipant.participant),
            selectinload(Booking.creator)
        )
    )
    bookings = result.scalars().all()
    
    nearby_bookings = []
    for booking in bookings:
        if not booking.latitude or not booking.longitude:
            continue
        
        # Calculate distance
        lat_diff = abs(latitude - booking.latitude) * 69
        lon_diff = abs(longitude - booking.longitude) * 69 * math.cos(math.radians(latitude))
        distance = math.sqrt(lat_diff**2 + lon_diff**2)
        
        # Check if within radius and booking's proximity radius
        max_radius = min(radius, booking.proximity_radius or 5.0)
        if distance > max_radius:
            continue
        
        # Skill level filtering
        # If booking has a skill filter, only show to matching skill levels
        if booking.skill_level_filter:
            # If user skill doesn't match booking filter, skip
            if skill_level and skill_level != booking.skill_level_filter:
                continue
            if user_skill and user_skill != booking.skill_level_filter:
                continue
        
        # If explicit skill_level param is provided, filter bookings
        if skill_level:
            # Show bookings that either have no filter or match the requested skill
            if booking.skill_level_filter and booking.skill_level_filter != skill_level:
                continue
        
        # Check if has room
        confirmed_count = len([p for p in booking.participants if p.status in ['pending', 'confirmed']])
        if confirmed_count >= booking.max_participants:
            continue
        
        split_price = booking.total_price / (confirmed_count + 1)
        
        # Get participant skill levels for display
        participant_skills = []
        for p in booking.participants:
            if p.status in ['pending', 'confirmed'] and p.participant:
                participant_skills.append({
                    "name": p.participant.full_name,
                    "skill_level": p.participant.skill_level or "Unknown",
                    "avatar_url": p.participant.avatar_url
                })
        
        # Get creator skill level
        creator_skill = booking.creator.skill_level if booking.creator else None
        
        nearby_bookings.append({
            "id": booking.id,
            "photographer_name": booking.photographer.full_name if booking.photographer else None,
            "photographer_avatar": booking.photographer.avatar_url if booking.photographer else None,
            "creator_name": booking.creator.full_name if booking.creator else None,
            "creator_skill": creator_skill,
            "location": booking.location,
            "session_date": booking.session_date.isoformat(),
            "distance": round(distance, 1),
            "current_participants": confirmed_count,
            "max_participants": booking.max_participants,
            "split_price": split_price,
            "description": booking.description,
            "skill_level_filter": booking.skill_level_filter,
            "participant_skills": participant_skills,
            "split_mode": booking.split_mode
        })
    
    # Sort by distance
    nearby_bookings.sort(key=lambda x: x["distance"])
    
    return nearby_bookings
