"""
Surf conditions — auto-fetch from Open-Meteo/NOAA + live shooting pulse at spots.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime, timezone
import logging

from database import get_db
from models import Profile, SurfSpot, RoleEnum, LiveSession

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/surf-conditions")
async def get_surf_conditions(
    latitude: Optional[float] = Query(None),
    longitude: Optional[float] = Query(None),
    spot_id: Optional[str] = Query(None),
    spot_name: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db)
):
    """
    Auto-fetch surf conditions from Open-Meteo Marine API + NOAA Tides
    
    Provide either:
    - latitude & longitude: Direct coordinates
    - spot_id: Get coordinates from database spot
    - spot_name: Try to match known spot by name
    """
    from services.surf_conditions import (
        get_full_conditions, 
        get_conditions_for_spot,
        SPOT_COORDINATES
    )
    
    noaa_station = None
    
    # If spot_id provided, get coordinates from database
    if spot_id:
        result = await db.execute(select(SurfSpot).where(SurfSpot.id == spot_id))
        spot = result.scalar_one_or_none()
        if spot and spot.latitude and spot.longitude:
            latitude = spot.latitude
            longitude = spot.longitude
            spot_name = spot.name
    
    # If spot_name matches a known spot, get NOAA station
    if spot_name:
        normalized = spot_name.lower().replace(" ", "_").replace("-", "_").replace(",", "")
        for key, info in SPOT_COORDINATES.items():
            if key in normalized or normalized in key or info["name"].lower() in spot_name.lower():
                noaa_station = info.get("noaa_station")
                break
    
    # If we have coordinates, fetch conditions
    if latitude is not None and longitude is not None:
        conditions = await get_full_conditions(latitude, longitude, spot_name, noaa_station)
        return conditions
    
    # If spot_name provided, try to match known spot
    if spot_name:
        conditions = await get_conditions_for_spot(spot_name)
        return conditions
    
    raise HTTPException(
        status_code=400, 
        detail="Provide either latitude/longitude, spot_id, or spot_name"
    )


@router.get("/surf-conditions/known-spots")
async def get_known_spots():
    """Get list of spots with known coordinates for auto-conditions"""
    from services.surf_conditions import SPOT_COORDINATES
    
    return {
        "spots": [
            {
                "key": key,
                "name": info["name"],
                "lat": info["lat"],
                "lon": info["lon"]
            }
            for key, info in SPOT_COORDINATES.items()
        ]
    }
class LiveShootingPulseResponse(BaseModel):
    spot_id: str
    has_live_photographers: bool
    live_photographers: List[dict]
    total_live: int


@router.get("/surf-spots/{spot_id}/live-shooting-pulse")
async def get_spot_live_shooting_pulse(
    spot_id: str,
    viewer_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """
    Get live shooting photographers at a specific spot.
    
    Permission-based visibility:
    - Only users who have subscribed to live alerts for this photographer
    - OR users who are within 2 miles of the spot
    - OR users who follow the photographer
    - Returns empty if viewer has no permission to see pulse
    """
    from models import PhotographerAlertSubscription, Follow
    
    # Get the spot
    spot_result = await db.execute(select(SurfSpot).where(SurfSpot.id == spot_id))
    spot = spot_result.scalar_one_or_none()
    
    if not spot:
        raise HTTPException(status_code=404, detail="Spot not found")
    
    # Get active live sessions at this spot with photographer info
    active_sessions_result = await db.execute(
        select(LiveSession)
        .where(
            and_(
                LiveSession.status == 'active',
                LiveSession.surf_spot_id == spot_id
            )
        )
        .options(selectinload(LiveSession.photographer))
    )
    active_sessions = list(active_sessions_result.scalars().all())
    
    # ── STALE SESSION AUTO-CLEANUP ──
    # Auto-end sessions older than 4 hours to prevent ghost "LIVE SHOOTING" indicators
    stale_threshold_hours = 4
    now = datetime.now(timezone.utc)
    clean_sessions = []
    stale_cleaned = 0
    for session in active_sessions:
        started = session.started_at
        if started:
            if started.tzinfo is None:
                started = started.replace(tzinfo=timezone.utc)
            hours_elapsed = (now - started).total_seconds() / 3600
            if hours_elapsed > stale_threshold_hours:
                # Auto-end stale session
                session.status = 'ended'
                session.ended_at = now
                # Also reset photographer flags if they match
                if session.photographer:
                    session.photographer.is_shooting = False
                    session.photographer.current_spot_id = None
                    session.photographer.shooting_started_at = None
                stale_cleaned += 1
                logger.warning(
                    f"[live-pulse] Auto-ended stale session {session.id} "
                    f"(started {hours_elapsed:.1f}h ago)"
                )
                continue
        clean_sessions.append(session)
    
    if stale_cleaned > 0:
        await db.commit()
    
    active_sessions = clean_sessions
    
    # Permission check: determine which photographers the viewer can see
    visible_sessions = []
    
    for session in active_sessions:
        photographer = session.photographer
        if not photographer:
            continue
        
        can_see = False
        
        # Check 1: Approved Pro is always visible (even to anonymous)
        if photographer.role == RoleEnum.APPROVED_PRO:
            can_see = True
        
        # For authenticated viewers, check more permissions
        if not can_see and viewer_id:
            # Check 2: Is viewer subscribed to live alerts from this photographer?
            sub_result = await db.execute(
                select(PhotographerAlertSubscription).where(
                    PhotographerAlertSubscription.user_id == viewer_id,
                    PhotographerAlertSubscription.photographer_id == photographer.id,
                    PhotographerAlertSubscription.alert_type == 'live_shooting',
                    PhotographerAlertSubscription.is_active == True
                )
            )
            if sub_result.scalar_one_or_none():
                can_see = True
            
            # Check 3: Does viewer follow this photographer?
            if not can_see:
                follow_result = await db.execute(
                    select(Follow).where(
                        Follow.follower_id == viewer_id,
                        Follow.following_id == photographer.id
                    )
                )
                if follow_result.scalar_one_or_none():
                    can_see = True
            
            # Check 4: Is viewer within 2 miles of the spot?
            if not can_see:
                viewer_result = await db.execute(select(Profile).where(Profile.id == viewer_id))
                viewer = viewer_result.scalar_one_or_none()
                if viewer and hasattr(viewer, 'on_demand_latitude') and viewer.on_demand_latitude:
                    if spot.latitude and spot.longitude:
                        lat_diff = abs(viewer.on_demand_latitude - spot.latitude)
                        lon_diff = abs(viewer.on_demand_longitude - spot.longitude)
                        if lat_diff < 0.03 and lon_diff < 0.03:  # ~2 miles
                            can_see = True
        
        if can_see:
            visible_sessions.append(session)
    
    # Build response
    live_data = []
    for session in visible_sessions:
        p = session.photographer
        if not p:
            continue
            
        live_data.append({
            "photographer_id": p.id,
            "photographer_name": p.full_name,
            "avatar_url": p.avatar_url,
            "role": p.role.value if p.role else "Photographer",
            "is_approved_pro": p.role == RoleEnum.APPROVED_PRO,
            "session_id": session.id,
            "started_at": session.started_at.isoformat() if session.started_at else None,
            "photo_count": getattr(session, 'photo_count', 0),
            "participant_count": session.participant_count or 0,
            "session_pricing": {
                "web": session.session_price_web or p.photo_price_web,
                "standard": session.session_price_standard or p.photo_price_standard,
                "high": session.session_price_high or p.photo_price_high
            }
        })
    
    return {
        "spot_id": spot_id,
        "spot_name": spot.name,
        "has_live_photographers": len(live_data) > 0,
        "live_photographers": live_data,
        "total_live": len(live_data),
        "pulse_active": len(live_data) > 0  # For frontend animation trigger
    }
