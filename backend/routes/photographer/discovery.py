"""
Photographer discovery — public listing endpoints for live and featured photographers.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func
from sqlalchemy.orm import selectinload
from typing import Optional
import math
import logging

logger = logging.getLogger(__name__)

from database import get_db
from models import (
    Profile, LiveSessionParticipant, CreditTransaction,
    GalleryItem, RoleEnum
)

router = APIRouter()


@router.get("/photographers/live")
async def get_live_photographers(
    latitude: Optional[float] = None,
    longitude: Optional[float] = None,
    radius: float = Query(default=5.0, description="Radius in miles"),
    db: AsyncSession = Depends(get_db)
):
    """Get all photographers currently shooting live"""
    query = select(Profile).where(
        and_(
            Profile.is_shooting.is_(True),
            Profile.role.in_([RoleEnum.GROM_PARENT, RoleEnum.HOBBYIST, RoleEnum.PHOTOGRAPHER, RoleEnum.APPROVED_PRO])
        )
    ).options(selectinload(Profile.current_spot))
    
    result = await db.execute(query)
    photographers = result.scalars().all()
    
    response = []
    for p in photographers:
        participants_result = await db.execute(
            select(func.count(LiveSessionParticipant.id))
            .where(LiveSessionParticipant.photographer_id == p.id)
            .where(LiveSessionParticipant.status == 'active')
        )
        active_count = participants_result.scalar() or 0
        
        photographer_data = {
            "id": p.id,
            "full_name": p.full_name,
            "avatar_url": p.avatar_url,
            "location": p.location or (p.current_spot.name if p.current_spot else None),
            "spot_name": p.current_spot.name if p.current_spot else None,
            "session_price": p.session_price or 25.0,
            "active_participants": active_count,
            "is_verified": p.is_verified,
            "distance": None
        }
        
        if latitude and longitude and p.current_spot:
            spot_lat = p.current_spot.latitude
            spot_lon = p.current_spot.longitude
            if spot_lat and spot_lon:
                lat_diff = abs(latitude - spot_lat) * 69
                lon_diff = abs(longitude - spot_lon) * 69 * math.cos(math.radians(latitude))
                distance = math.sqrt(lat_diff**2 + lon_diff**2)
                photographer_data["distance"] = round(distance, 1)
                if distance > radius:
                    continue
        
        response.append(photographer_data)
    
    return response


# NOTE: /photographers/directory endpoint is defined in bookings.py to avoid duplication


@router.get("/photographers/featured")
async def get_featured_photographers(
    limit: int = Query(default=10, le=50),
    db: AsyncSession = Depends(get_db)
):
    """
    Get featured photographers based on earnings and activity.
    Combines top earners with most active photographers.
    """
    from sqlalchemy import desc
    
    # Hobbyists are NOT featured — organic discovery only
    photographer_roles = [RoleEnum.PHOTOGRAPHER, RoleEnum.APPROVED_PRO]
    
    photographers_result = await db.execute(
        select(Profile)
        .where(Profile.role.in_(photographer_roles))
        .options(selectinload(Profile.current_spot))
    )
    photographers = photographers_result.scalars().all()
    
    featured = []
    for p in photographers:
        earnings_result = await db.execute(
            select(func.sum(CreditTransaction.amount))
            .where(CreditTransaction.user_id == p.id)
            .where(CreditTransaction.transaction_type.in_([
                'live_session_earning', 'booking_earning', 'gallery_sale'
            ]))
        )
        total_earnings = earnings_result.scalar() or 0
        
        sessions_result = await db.execute(
            select(func.count(LiveSessionParticipant.id))
            .where(LiveSessionParticipant.photographer_id == p.id)
            .where(LiveSessionParticipant.status == 'completed')
        )
        total_sessions = sessions_result.scalar() or 0
        
        gallery_result = await db.execute(
            select(func.count(GalleryItem.id))
            .where(GalleryItem.photographer_id == p.id)
        )
        gallery_count = gallery_result.scalar() or 0
        
        score = (total_earnings * 2) + (total_sessions * 10) + (gallery_count * 5)
        if p.is_shooting:
            score += 100
        
        featured.append({
            "id": p.id,
            "full_name": p.full_name,
            "avatar_url": p.avatar_url,
            "role": p.role.value,
            "is_verified": p.is_verified,
            "is_live": p.is_shooting,
            "location": p.location or (p.current_spot.name if p.current_spot else None),
            "current_spot": p.current_spot.name if p.current_spot else None,
            "session_price": p.live_buyin_price or p.session_price or 25.0,
            "total_earnings": total_earnings,
            "total_sessions": total_sessions,
            "gallery_count": gallery_count,
            "score": score
        })
    
    featured.sort(key=lambda x: x["score"], reverse=True)
    return featured[:limit]
