"""
Spot of the Day — social discovery engine for trending surf spots.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_
from typing import Optional
from datetime import datetime, timezone, date, timedelta
import logging

from database import get_db
from deps.admin_auth import get_current_admin
from models import Profile, SurfSpot, SpotOfTheDay

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/spot-of-the-day")
async def get_spot_of_the_day(
    region: Optional[str] = None,
    user_lat: Optional[float] = None,
    user_lon: Optional[float] = None,
    db: AsyncSession = Depends(get_db)
):
    """
    Get the Spot of the Day for a region or nearby location.
    Returns the best spot based on:
    - Epic/Good conditions reported by photographers
    - High photographer activity
    - Trending/popular spots
    """
    today = date.today()
    
    # Try to find existing spot of the day
    query = select(SpotOfTheDay).where(SpotOfTheDay.date == today)
    if region:
        query = query.where(SpotOfTheDay.region == region)
    
    result = await db.execute(query.order_by(SpotOfTheDay.created_at.desc()))
    sotd = result.scalar_one_or_none()
    
    if sotd:
        # Get full spot details
        spot_result = await db.execute(select(SurfSpot).where(SurfSpot.id == sotd.spot_id))
        spot = spot_result.scalar_one_or_none()
        
        photographer = None
        if sotd.featured_photographer_id:
            p_result = await db.execute(select(Profile).where(Profile.id == sotd.featured_photographer_id))
            photographer = p_result.scalar_one_or_none()
        
        return {
            "has_spot_of_the_day": True,
            "spot": {
                "id": spot.id,
                "name": spot.name,
                "region": spot.region,
                "latitude": spot.latitude,
                "longitude": spot.longitude,
                "wave_type": spot.wave_type
            } if spot else None,
            "reason": sotd.reason,
            "rating": sotd.rating,
            "featured_photo_url": sotd.featured_photo_url,
            "featured_photographer": {
                "id": photographer.id,
                "full_name": photographer.full_name,
                "avatar_url": photographer.avatar_url
            } if photographer else None,
            "active_photographers": sotd.active_photographers,
            "wave_height": sotd.wave_height,
            "wind_conditions": sotd.wind_conditions,
            "expires_at": sotd.expires_at.isoformat() if sotd.expires_at else None
        }
    
    # No spot of the day set - calculate one based on activity
    # Find spot with most active photographers in the region
    query = (
        select(SurfSpot, func.count(Profile.id).label('photographer_count'))
        .outerjoin(Profile, and_(Profile.current_spot_id == SurfSpot.id, Profile.is_shooting.is_(True)))
        .group_by(SurfSpot.id)
        .order_by(func.count(Profile.id).desc())
        .limit(1)
    )
    
    if region:
        query = query.where(SurfSpot.region == region)
    
    result = await db.execute(query)
    row = result.first()
    
    if row:
        spot, count = row
        return {
            "has_spot_of_the_day": count > 0,
            "spot": {
                "id": spot.id,
                "name": spot.name,
                "region": spot.region,
                "latitude": spot.latitude,
                "longitude": spot.longitude,
                "wave_type": spot.wave_type
            },
            "reason": "high_activity" if count > 0 else "default",
            "rating": None,
            "featured_photo_url": None,
            "featured_photographer": None,
            "active_photographers": count,
            "wave_height": None,
            "wind_conditions": None,
            "expires_at": None,
            "is_calculated": True  # Not manually set
        }
    
    return {"has_spot_of_the_day": False}


@router.post("/spot-of-the-day/trigger")
async def trigger_spot_of_the_day(
    spot_id: str,
    photographer_id: str,
    rating: str = Query(..., description="FLAT, POOR, FAIR, GOOD, or EPIC"),
    photo_url: Optional[str] = None,
    wave_height: Optional[str] = None,
    wind_conditions: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """
    Trigger a Spot of the Day based on photographer activity.
    Called when a photographer uploads a high-rating conditions photo.
    """
    # Validate spot
    spot_result = await db.execute(select(SurfSpot).where(SurfSpot.id == spot_id))
    spot = spot_result.scalar_one_or_none()
    if not spot:
        raise HTTPException(status_code=404, detail="Spot not found")
    
    # Validate photographer
    photog_result = await db.execute(select(Profile).where(Profile.id == photographer_id))
    photographer = photog_result.scalar_one_or_none()
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    # Only trigger for GOOD or EPIC ratings
    valid_ratings = ['GOOD', 'GOOD_TO_EPIC', 'EPIC']
    if rating.upper() not in valid_ratings:
        return {
            "triggered": False,
            "reason": f"Rating must be one of {valid_ratings} to trigger Spot of the Day"
        }
    
    today = date.today()
    
    # Check if already exists for this region today
    existing = await db.execute(
        select(SpotOfTheDay).where(
            SpotOfTheDay.region == spot.region,
            SpotOfTheDay.date == today
        )
    )
    if existing.scalar_one_or_none():
        return {
            "triggered": False,
            "reason": "Spot of the Day already set for this region today"
        }
    
    # Count active photographers at this spot
    count_result = await db.execute(
        select(func.count(Profile.id))
        .where(Profile.current_spot_id == spot_id)
        .where(Profile.is_shooting.is_(True))
    )
    active_count = count_result.scalar() or 0
    
    # Create Spot of the Day
    sotd = SpotOfTheDay(
        spot_id=spot_id,
        region=spot.region,
        date=today,
        reason='epic_conditions' if rating.upper() == 'EPIC' else 'good_conditions',
        rating=rating.upper(),
        featured_photo_url=photo_url,
        featured_photographer_id=photographer_id,
        active_photographers=active_count,
        wave_height=wave_height,
        wind_conditions=wind_conditions,
        expires_at=datetime.now(timezone.utc).replace(hour=23, minute=59, second=59)
    )
    
    db.add(sotd)
    await db.commit()
    
    logger.info(f"Spot of the Day triggered: {spot.name} ({spot.region}) - {rating}")
    
    return {
        "triggered": True,
        "spot_of_the_day": {
            "spot_name": spot.name,
            "region": spot.region,
            "rating": rating.upper(),
            "featured_photographer": photographer.full_name,
            "expires_at": sotd.expires_at.isoformat()
        }
    }


@router.get("/admin/spot-of-the-day/history")
async def get_spot_of_the_day_history(
    admin: Profile = Depends(get_current_admin),
    days: int = 30,
    db: AsyncSession = Depends(get_db)
):
    """Get Spot of the Day history for admin review."""
    from_date = date.today() - timedelta(days=days)
    
    result = await db.execute(
        select(SpotOfTheDay)
        .where(SpotOfTheDay.date >= from_date)
        .order_by(SpotOfTheDay.date.desc())
    )
    history = result.scalars().all()
    
    return {
        "history": [
            {
                "date": s.date.isoformat(),
                "region": s.region,
                "spot_id": s.spot_id,
                "reason": s.reason,
                "rating": s.rating,
                "active_photographers": s.active_photographers
            }
            for s in history
        ]
    }

