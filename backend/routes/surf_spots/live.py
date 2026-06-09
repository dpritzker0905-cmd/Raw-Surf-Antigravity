"""
Live photographer endpoints — go-live, stop-live, toggle-streaming, list live photographers.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_
from sqlalchemy.orm import selectinload
from typing import List, Optional
from datetime import datetime, timezone
import math
import logging

from database import get_db
from models import Profile, SurfSpot, RoleEnum, LiveSession
from utils.grom_parent import is_grom_parent_eligible
from .schemas import LivePhotographerResponse, GoLiveRequest, StopLiveRequest, SpotImageUpdate
from core.security import get_current_user_id
from deps.admin_auth import get_current_admin

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/live-photographers", response_model=List[LivePhotographerResponse])
async def get_live_photographers(spot_id: Optional[str] = None, db: AsyncSession = Depends(get_db)):
    query = select(Profile).where(Profile.is_shooting.is_(True))
    if spot_id:
        query = query.where(Profile.current_spot_id == spot_id)
    
    result = await db.execute(query.options(selectinload(Profile.current_spot)))
    photographers = result.scalars().all()
    
    return [LivePhotographerResponse(
        id=p.id, full_name=p.full_name, avatar_url=p.avatar_url,
        is_shooting=p.is_shooting or False, is_streaming=p.is_streaming or False,
        current_spot_id=p.current_spot_id,
        current_spot_name=p.current_spot.name if p.current_spot else None,
        shooting_started_at=p.shooting_started_at, last_story_url=p.last_story_url,
        session_price=p.session_price,
        latitude=p.current_spot.latitude if p.current_spot else None,
        longitude=p.current_spot.longitude if p.current_spot else None,
        live_buyin_price=p.live_buyin_price, live_photo_price=p.live_photo_price,
        photo_package_size=p.photo_package_size, photo_price_standard=p.photo_price_standard,
        gallery_photo_price=p.photo_price_standard
    ) for p in photographers]


@router.post("/photographers/{profile_id}/go-live")
async def photographer_go_live(
    profile_id: str,
    data: GoLiveRequest,
    db: AsyncSession = Depends(get_db),
    current_user_id: str = Depends(get_current_user_id)
):
    """Start a live shooting session with session-specific pricing"""
    if profile_id != current_user_id:
        raise HTTPException(
            status_code=403,
            detail="Unauthorized: profile_id does not match the authenticated user."
        )
    result = await db.execute(select(Profile).where(Profile.id == profile_id))
    profile = result.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    
    photographer_roles = [RoleEnum.GROM_PARENT, RoleEnum.HOBBYIST, RoleEnum.PHOTOGRAPHER, RoleEnum.APPROVED_PRO]
    if profile.role not in photographer_roles:
        raise HTTPException(status_code=403, detail="Only photographers can go live")
    
    # ============ ROLE-BASED PERMISSION CHECK ============
    if is_grom_parent_eligible(profile):
        raise HTTPException(status_code=403, detail="Grom Parents cannot start Live Sessions. Gallery and Bookings access only.")
    
    # Hobbyist: Can do Live Sessions ONLY if no other photographers are nearby (0.1 mile radius)
    if profile.role == RoleEnum.HOBBYIST and profile.on_demand_latitude and profile.on_demand_longitude:
        mile_threshold = 0.1
        lat_range = mile_threshold / 69.0
        lon_range = mile_threshold / (69.0 * math.cos(math.radians(profile.on_demand_latitude)))
        
        nearby_query = await db.execute(
            select(Profile).where(
                and_(
                    Profile.is_shooting.is_(True),
                    Profile.role.in_([RoleEnum.PHOTOGRAPHER, RoleEnum.APPROVED_PRO]),
                    Profile.id != profile_id,
                    Profile.on_demand_latitude.isnot(None),
                    Profile.on_demand_longitude.isnot(None)
                )
            )
        )
        nearby_photographers = nearby_query.scalars().all()
        
        for nearby_pro in nearby_photographers:
            if nearby_pro.on_demand_latitude and nearby_pro.on_demand_longitude:
                lat_diff = abs(profile.on_demand_latitude - nearby_pro.on_demand_latitude)
                lon_diff = abs(profile.on_demand_longitude - nearby_pro.on_demand_longitude)
                if lat_diff <= lat_range and lon_diff <= lon_range:
                    raise HTTPException(
                        status_code=403,
                        detail="A Pro photographer is active within 0.1 miles of your location. Hobbyists can only go live when no Pro photographers are nearby."
                    )
    
    # Handle spot lookup
    spot = None
    spot_name = data.location or "Unknown Location"
    spot_id = data.spot_id
    
    if data.spot_id:
        spot_result = await db.execute(select(SurfSpot).where(SurfSpot.id == data.spot_id))
        spot = spot_result.scalar_one_or_none()
        if spot:
            spot_name = spot.name
        else:
            spot_id = None
    
    # Use resolution pricing from request, or fall back to profile defaults
    session_price_web = data.photo_price_web or profile.photo_price_web or 3.0
    session_price_standard = data.photo_price_standard or profile.photo_price_standard or 5.0
    session_price_high = data.photo_price_high or profile.photo_price_high or 10.0
    
    # Create LiveSession record with session-specific pricing
    live_session = LiveSession(
        photographer_id=profile_id, surf_spot_id=spot_id, location_name=spot_name,
        buyin_price=data.price_per_join, photo_price=profile.live_photo_price or 5.0,
        session_photo_price=data.live_photo_price or profile.live_photo_price or 5.0,
        photos_included=data.photos_included or 3,
        videos_included=data.videos_included if data.videos_included is not None else 1,
        general_photo_price=data.general_photo_price or profile.photo_price_standard or 10.0,
        session_price_web=session_price_web, session_price_standard=session_price_standard,
        session_price_high=session_price_high,
        max_surfers=data.max_surfers or 10, estimated_duration_hours=data.estimated_duration or 2,
        participant_count=0, total_earnings=0.0,
        started_at=datetime.now(timezone.utc), status='active'
    )
    db.add(live_session)
    await db.flush()
    
    # Update photographer profile
    profile.is_shooting = True
    profile.is_streaming = data.is_streaming
    profile.current_spot_id = spot_id
    profile.shooting_started_at = datetime.now(timezone.utc)
    profile.session_price = data.price_per_join
    
    await db.commit()
    await db.refresh(profile)
    
    session_photo_price = live_session.session_photo_price or 5.0
    general_photo_price = live_session.general_photo_price or 10.0
    savings_per_photo = general_photo_price - session_photo_price
    
    return {
        "message": f"Now shooting at {spot_name}",
        "is_shooting": profile.is_shooting, "is_streaming": profile.is_streaming,
        "spot_name": spot_name,
        "started_at": profile.shooting_started_at.isoformat(),
        "live_session_id": live_session.id,
        "live_session_rates": {
            "buyin_price": live_session.buyin_price,
            "live_photo_price": session_photo_price,
            "photos_included": live_session.photos_included,
            "general_photo_price": general_photo_price,
            "savings_per_photo": savings_per_photo,
            "max_surfers": live_session.max_surfers,
            "resolution_pricing": {
                "web": session_price_web, "standard": session_price_standard, "high": session_price_high
            }
        }
    }


@router.post("/photographers/{profile_id}/stop-live")
async def photographer_stop_live(
    profile_id: str,
    data: StopLiveRequest,
    db: AsyncSession = Depends(get_db),
    current_user_id: str = Depends(get_current_user_id)
):
    if profile_id != current_user_id:
        raise HTTPException(
            status_code=403,
            detail="Unauthorized: profile_id does not match the authenticated user."
        )
    result = await db.execute(select(Profile).where(Profile.id == profile_id))
    profile = result.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    
    if profile.is_streaming and data.story_url:
        profile.last_story_url = data.story_url
    
    profile.is_shooting = False
    profile.is_streaming = False
    profile.current_spot_id = None
    profile.shooting_started_at = None
    
    await db.commit()
    return {"message": "Stopped shooting", "is_shooting": False}


@router.post("/photographers/{profile_id}/toggle-streaming")
async def toggle_streaming(
    profile_id: str,
    db: AsyncSession = Depends(get_db),
    current_user_id: str = Depends(get_current_user_id)
):
    if profile_id != current_user_id:
        raise HTTPException(
            status_code=403,
            detail="Unauthorized: profile_id does not match the authenticated user."
        )
    result = await db.execute(select(Profile).where(Profile.id == profile_id))
    profile = result.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    if not profile.is_shooting:
        raise HTTPException(status_code=400, detail="Must be shooting to toggle streaming")
    profile.is_streaming = not profile.is_streaming
    await db.commit()
    return {"is_streaming": profile.is_streaming}


@router.patch("/surf-spots/{spot_id}/image")
async def update_spot_image(
    spot_id: str,
    data: SpotImageUpdate,
    db: AsyncSession = Depends(get_db),
    admin: Profile = Depends(get_current_admin)
):
    result = await db.execute(select(SurfSpot).where(SurfSpot.id == spot_id))
    spot = result.scalar_one_or_none()
    if not spot:
        raise HTTPException(status_code=404, detail="Surf spot not found")
    spot.image_url = data.image_url
    await db.commit()
    return {"message": "Spot image updated", "spot_id": spot_id}
