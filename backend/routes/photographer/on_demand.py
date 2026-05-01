"""
Photographer on-demand — toggle, status, directory, stats, and XP/gamification.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func
from typing import Optional
from datetime import datetime, timezone
import math
import json
import logging

logger = logging.getLogger(__name__)

from database import get_db
from models import (
    Profile, Booking, LiveSession, LiveSessionParticipant,
    CreditTransaction, GalleryItem, SurfSpot, RoleEnum
)
from .schemas import (
    OnDemandToggleRequest, OnDemandStatusResponse,
    PhotographerStatsResponse,
)

router = APIRouter()


@router.get("/photographers/on-demand")
async def get_on_demand_photographers(
    latitude: Optional[float] = None,
    longitude: Optional[float] = None,
    radius: float = 25.0,
    db: AsyncSession = Depends(get_db)
):
    """Get all photographers available for on-demand requests."""
    query = select(Profile).where(
        and_(
            Profile.on_demand_available.is_(True),
            Profile.role.in_([RoleEnum.PHOTOGRAPHER, RoleEnum.PRO, RoleEnum.APPROVED_PRO])
        )
    )
    result = await db.execute(query)
    photographers = result.scalars().all()
    
    available_pros = []
    for p in photographers:
        photographer_data = {
            "id": p.id,
            "full_name": p.full_name,
            "avatar_url": p.avatar_url,
            "role": p.role.value if p.role else "Photographer",
            "on_demand_hourly_rate": p.on_demand_hourly_rate or 75.0,
            "on_demand_photos_included": p.on_demand_photos_included or 3,
            "photo_price_web": p.photo_price_web or 3.0,
            "photo_price_standard": p.photo_price_standard or 5.0,
            "photo_price_high": p.photo_price_high or 10.0,
            "on_demand_latitude": p.on_demand_latitude,
            "on_demand_longitude": p.on_demand_longitude,
            "on_demand_city": p.on_demand_city,
            "on_demand_county": p.on_demand_county,
            "rating": getattr(p, 'rating', None) or 4.5,
            "total_reviews": getattr(p, 'total_reviews', 0) or 0,
            "on_demand_cancellation_fee_pct": getattr(p, 'on_demand_cancellation_fee_pct', None) if getattr(p, 'on_demand_cancellation_fee_pct', None) is not None else 100,
            "distance": None
        }
        
        if latitude and longitude and p.on_demand_latitude and p.on_demand_longitude:
            lat1, lon1 = math.radians(latitude), math.radians(longitude)
            lat2, lon2 = math.radians(p.on_demand_latitude), math.radians(p.on_demand_longitude)
            dlat = lat2 - lat1
            dlon = lon2 - lon1
            a = math.sin(dlat/2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon/2)**2
            c = 2 * math.asin(math.sqrt(a))
            distance_miles = 3956 * c
            photographer_data["distance"] = round(distance_miles, 1)
            if distance_miles > radius:
                continue
        
        available_pros.append(photographer_data)
    
    priority_order = {"Approved Pro": 0, "Pro": 1, "Photographer": 2}
    available_pros.sort(key=lambda x: (priority_order.get(x["role"], 99), x.get("distance") or 999))
    return available_pros


@router.get("/photographer/{photographer_id}/on-demand-status")
async def get_on_demand_status(
    photographer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get photographer's On-Demand availability status with selected spot"""
    result = await db.execute(select(Profile).where(Profile.id == photographer_id))
    profile = result.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    if profile.role not in [RoleEnum.PHOTOGRAPHER, RoleEnum.PRO, RoleEnum.APPROVED_PRO]:
        return OnDemandStatusResponse(is_available=False)
    
    spot_name = profile.on_demand_city
    if profile.current_spot_id and not spot_name:
        spot_result = await db.execute(select(SurfSpot).where(SurfSpot.id == profile.current_spot_id))
        spot = spot_result.scalar_one_or_none()
        if spot:
            spot_name = spot.name
    
    return OnDemandStatusResponse(
        is_available=profile.on_demand_available or False,
        latitude=profile.on_demand_latitude,
        longitude=profile.on_demand_longitude,
        city=spot_name,
        county=profile.on_demand_county,
        spot_id=profile.current_spot_id,
        spot_name=spot_name
    )


@router.get("/photographer/{photographer_id}/status")
async def get_photographer_status(
    photographer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get photographer's overall status including live session info"""
    result = await db.execute(select(Profile).where(Profile.id == photographer_id))
    profile = result.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    current_spot_name = None
    if profile.current_spot_id:
        spot_result = await db.execute(select(SurfSpot).where(SurfSpot.id == profile.current_spot_id))
        spot = spot_result.scalar_one_or_none()
        if spot:
            current_spot_name = spot.name
    if not current_spot_name and profile.on_demand_city:
        current_spot_name = profile.on_demand_city
    
    return {
        "is_shooting": profile.is_shooting or False,
        "on_demand_available": profile.on_demand_available or False,
        "current_spot_id": profile.current_spot_id,
        "current_spot_name": current_spot_name,
        "latitude": profile.on_demand_latitude,
        "longitude": profile.on_demand_longitude
    }


@router.post("/photographer/{photographer_id}/on-demand-toggle")
async def toggle_on_demand(
    photographer_id: str,
    data: OnDemandToggleRequest,
    db: AsyncSession = Depends(get_db)
):
    """Toggle On-Demand availability for Pro photographers with spot selection"""
    result = await db.execute(select(Profile).where(Profile.id == photographer_id))
    profile = result.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    if profile.role not in [RoleEnum.PHOTOGRAPHER, RoleEnum.PRO, RoleEnum.APPROVED_PRO]:
        raise HTTPException(status_code=403, detail="On-Demand is only available for Pro photographers")
    
    if data.is_available and profile.is_shooting:
        raise HTTPException(
            status_code=400,
            detail="Cannot enable On-Demand while in an active live session. Please end your session first."
        )
    
    profile.on_demand_available = data.is_available
    if data.is_available:
        if data.spot_id:
            profile.current_spot_id = data.spot_id
        if data.latitude and data.longitude:
            profile.on_demand_latitude = data.latitude
            profile.on_demand_longitude = data.longitude
        if data.spot_name:
            profile.on_demand_city = data.spot_name
        profile.on_demand_updated_at = datetime.now(timezone.utc)
    else:
        profile.on_demand_latitude = None
        profile.on_demand_longitude = None
        profile.on_demand_city = None
        profile.on_demand_county = None
        profile.current_spot_id = None
    
    await db.commit()
    return {
        "success": True,
        "is_available": profile.on_demand_available,
        "spot_name": profile.on_demand_city if data.is_available else None,
        "message": f"On-Demand enabled at {data.spot_name}" if data.is_available else "On-Demand disabled"
    }


@router.get("/photographer/{photographer_id}/stats", response_model=PhotographerStatsResponse)
async def get_photographer_stats(
    photographer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get photographer's dashboard stats including gamification data"""
    result = await db.execute(select(Profile).where(Profile.id == photographer_id))
    profile = result.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    active_sessions_result = await db.execute(
        select(func.count(LiveSession.id)).where(
            and_(LiveSession.photographer_id == photographer_id, LiveSession.status == 'active')
        )
    )
    active_sessions = active_sessions_result.scalar() or 0
    
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    earnings_result = await db.execute(
        select(func.sum(CreditTransaction.amount)).where(
            and_(
                CreditTransaction.user_id == photographer_id,
                CreditTransaction.created_at >= today_start,
                CreditTransaction.amount > 0,
                CreditTransaction.transaction_type.in_(['photographer_earning', 'gallery_sale', 'live_session_buyin'])
            )
        )
    )
    today_earnings = earnings_result.scalar() or 0
    
    pending_bookings_result = await db.execute(
        select(func.count(Booking.id)).where(
            and_(Booking.photographer_id == photographer_id, Booking.status == 'pending')
        )
    )
    pending_bookings = pending_bookings_result.scalar() or 0
    
    gallery_photos_result = await db.execute(
        select(func.count(GalleryItem.id)).where(GalleryItem.photographer_id == photographer_id)
    )
    gallery_photos = gallery_photos_result.scalar() or 0
    
    xp = profile.xp_total or 0
    streak = profile.on_demand_streak or 0
    badges = []
    if profile.badges:
        try:
            badges = json.loads(profile.badges) if isinstance(profile.badges, str) else profile.badges
        except (ValueError, TypeError):
            badges = []
    hot_streak_multiplier = 2.0 if streak >= 3 else 1.0
    
    return PhotographerStatsResponse(
        activeSessions=active_sessions,
        todayEarnings=float(today_earnings),
        pendingBookings=pending_bookings,
        galleryPhotos=gallery_photos,
        xp=xp, streak=streak, badges=badges,
        hotStreakMultiplier=hot_streak_multiplier
    )


@router.post("/photographer/{photographer_id}/award-xp")
async def award_xp(
    photographer_id: str,
    xp_amount: int = 10,
    reason: str = "activity",
    db: AsyncSession = Depends(get_db)
):
    """Award XP to photographer (called internally after successful actions)"""
    result = await db.execute(select(Profile).where(Profile.id == photographer_id))
    profile = result.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    multiplier = 2.0 if (profile.on_demand_streak or 0) >= 3 else 1.0
    final_xp = int(xp_amount * multiplier)
    profile.xp_total = (profile.xp_total or 0) + final_xp
    await db.commit()
    
    return {
        "success": True,
        "xp_awarded": final_xp,
        "multiplier": multiplier,
        "new_total": profile.xp_total,
        "reason": reason
    }
