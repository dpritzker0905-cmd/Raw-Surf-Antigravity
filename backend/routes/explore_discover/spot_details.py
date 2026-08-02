"""
explore_discover/spot_details.py — Spot details endpoint with full conditions, forecast, and photographer listing.
Extracted from explore.py (v92 audit) for LOC compliance.
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from sqlalchemy.orm import selectinload
from typing import Optional
from datetime import datetime, timezone, timedelta
import httpx
import logging

from database import get_db
from models import Profile, SurfSpot, Post, SurfReport

# Weather pipeline point resolution
from services.weather_pipeline.point_resolution import PointResolutionService
from services.weather_pipeline.sampler import PointSampler
from services.weather_pipeline.providers.open_meteo_provider import OpenMeteoProvider
from services.conditions_labels import get_conditions_label

point_sampler = PointSampler()
open_meteo_provider = OpenMeteoProvider()
point_resolution_service = PointResolutionService(
    sampler=point_sampler,
    provider=open_meteo_provider
)

router = APIRouter()
logger = logging.getLogger(__name__)

OPEN_METEO_MARINE_URL = "https://marine-api.open-meteo.com/v1/marine"


@router.get("/explore/spot-details/{spot_id}")
async def get_spot_details(
    spot_id: str,
    subscription_tier: str = "free",
    model: str = Query("GFS", pattern="^(GFS|ICON|EURO)$"),
    db: AsyncSession = Depends(get_db)
):
    """
    Get detailed information about a specific surf spot including
    conditions, full forecast, reports, and content.
    """
    result = await db.execute(
        select(SurfSpot).where(SurfSpot.id == spot_id)
    )
    spot = result.scalar_one_or_none()
    
    if not spot:
        return {"error": "Spot not found"}
    
    # Determine forecast days AFTER today
    # TODAY = current conditions (not forecast)
    # FREE = 3 days AFTER today
    # PAID = 7 days AFTER today  
    # PREMIUM = 10 days AFTER today
    forecast_days_after_today = 3
    if subscription_tier in ['paid', 'basic']:
        forecast_days_after_today = 7
    elif subscription_tier in ['premium', 'pro', 'gold']:
        forecast_days_after_today = 10
    
    # Always fetch 10 days from the API so we can show locked previews
    max_forecast_days = 10
    api_forecast_days = max_forecast_days + 1  # +1 because index 0 is today
    
    spot_data = {
        "id": spot.id,
        "name": spot.name,
        "region": spot.region,
        "difficulty": spot.difficulty,
        "image_url": spot.image_url,
        "latitude": spot.latitude,
        "longitude": spot.longitude,
        "description": spot.description,
        "wave_type": getattr(spot, 'wave_type', None),
        "best_tide": spot.best_tide,
        "best_swell": getattr(spot, 'best_swell', None),
        "current_conditions": None,
        "forecast": [],
        "forecast_days_allowed": forecast_days_after_today
    }
    
    # Fetch real-time conditions and forecast using unified service
    try:
        conditions_data = await point_resolution_service.resolve_spot_conditions(
            model=model, lat=spot.latitude, lng=spot.longitude, forecast_days=api_forecast_days,
            spot_id=spot.id
        )
        if conditions_data:
            spot_data["current_conditions"] = conditions_data.get("current_conditions")
            spot_data["forecast"] = conditions_data.get("forecast", [])
    except Exception as e:
        logger.error(f"Error fetching conditions for {spot.name} via service: {e}")
    
    # Get recent reports (last 48 hours)
    reports_result = await db.execute(
        select(SurfReport)
        .where(SurfReport.spot_id == spot_id)
        .where(SurfReport.created_at > datetime.now(timezone.utc) - timedelta(hours=48))
        .order_by(desc(SurfReport.created_at))
        .limit(10)
    )
    reports = reports_result.scalars().all()
    
    spot_data["recent_reports"] = [{
        "id": r.id,
        "wave_height": r.wave_height,
        "conditions": r.conditions,
        "crowd_level": r.crowd_level,
        "wind_direction": r.wind_direction,
        "rating": r.rating,
        "notes": r.notes,
        "created_at": r.created_at.isoformat() if r.created_at else None
    } for r in reports]
    
    # Get photographers at this spot: live-shooting AND on-demand available
    shooting_result = await db.execute(
        select(Profile)
        .where(Profile.current_spot_id == spot_id)
        .where(Profile.is_shooting .is_(True))
    )
    shooting_photographers = shooting_result.scalars().all()
    
    on_demand_result = await db.execute(
        select(Profile)
        .where(Profile.current_spot_id == spot_id)
        .where(Profile.on_demand_available .is_(True))
        .where(Profile.is_shooting .is_(False))  # NOT already in live session
    )
    on_demand_photographers = on_demand_result.scalars().all()
    
    # Combine with status differentiation
    combined_photographers = []
    for p in shooting_photographers:
        combined_photographers.append({
            "id": p.id,
            "full_name": p.full_name,
            "avatar_url": p.avatar_url,
            "is_shooting": True,
            "is_streaming": p.is_streaming,
            "is_on_demand": False,
            "status": "live_shooting",
            "on_demand_hourly_rate": getattr(p, 'on_demand_hourly_rate', None),
            "session_price": p.session_price,
            "hourly_rate": p.hourly_rate,
            "booking_hourly_rate": getattr(p, 'booking_hourly_rate', None),
            "role": p.role.value if p.role else 'photographer',
            "current_spot_id": p.current_spot_id
        })
    for p in on_demand_photographers:
        combined_photographers.append({
            "id": p.id,
            "full_name": p.full_name,
            "avatar_url": p.avatar_url,
            "is_shooting": False,
            "is_streaming": False,
            "is_on_demand": True,
            "status": "on_demand",
            "on_demand_hourly_rate": getattr(p, 'on_demand_hourly_rate', None),
            "session_price": p.session_price,
            "hourly_rate": p.hourly_rate,
            "booking_hourly_rate": getattr(p, 'booking_hourly_rate', None),
            "role": p.role.value if p.role else 'photographer',
            "current_spot_id": p.current_spot_id
        })
    
    spot_data["active_photographers"] = combined_photographers
    
    # Get recent posts at this spot
    posts_result = await db.execute(
        select(Post)
        .options(selectinload(Post.author))
        .where(Post.spot_id == spot_id)
        .order_by(desc(Post.created_at))
        .limit(12)
    )
    posts = posts_result.scalars().all()
    
    spot_data["recent_posts"] = [{
        "id": p.id,
        "image_url": p.media_url,
        "caption": p.caption,
        "likes_count": p.likes_count,
        "author_name": p.author.full_name if p.author else None,
        "author_avatar": p.author.avatar_url if p.author else None
    } for p in posts]
    
    return spot_data
