"""
Admin session management — simulate live, force start/end sessions, active sessions, cleanup stale.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from typing import Optional
from datetime import datetime, timezone
import logging

from database import get_db
from deps.admin_auth import get_current_admin
from models import Profile, SurfSpot, RoleEnum, LiveSession
from .schemas import SimulateLiveRequest, SimulateLiveResponse, ForceStartSessionRequest

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/admin/simulate-live", response_model=SimulateLiveResponse)
async def simulate_photographer_live(data: SimulateLiveRequest, admin: Profile = Depends(get_current_admin), db: AsyncSession = Depends(get_db)):
    """Admin endpoint to simulate a photographer going live or stopping."""
    photographer_result = await db.execute(select(Profile).where(Profile.id == data.photographer_id))
    photographer = photographer_result.scalar_one_or_none()
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    spot_result = await db.execute(select(SurfSpot).where(SurfSpot.id == data.spot_id))
    spot = spot_result.scalar_one_or_none()
    if not spot:
        raise HTTPException(status_code=404, detail="Surf spot not found")
    
    if data.is_live:
        photographer.is_shooting = True
        photographer.shooting_started_at = datetime.now(timezone.utc)
        photographer.current_spot_id = spot.id
        photographer.location = spot.name
        photographer.session_price = data.session_price
        message = f"{photographer.full_name} is now shooting at {spot.name}"
    else:
        photographer.is_shooting = False
        photographer.shooting_started_at = None
        photographer.current_spot_id = None
        photographer.location = None
        photographer.session_price = None
        message = f"{photographer.full_name} has stopped shooting"
    
    await db.commit()
    await db.refresh(photographer)
    
    return SimulateLiveResponse(
        success=True, message=message, photographer_id=photographer.id,
        photographer_name=photographer.full_name,
        spot_name=spot.name if data.is_live else None,
        is_live=photographer.is_shooting or False
    )


@router.get("/admin/photographers")
async def get_all_photographers(admin: Profile = Depends(get_current_admin), db: AsyncSession = Depends(get_db)):
    """Get all photographers for admin panel"""
    photographer_roles = [RoleEnum.GROM_PARENT, RoleEnum.HOBBYIST, RoleEnum.PHOTOGRAPHER, RoleEnum.APPROVED_PRO]
    result = await db.execute(
        select(Profile).where(Profile.role.in_(photographer_roles))
        .options(selectinload(Profile.current_spot)).order_by(Profile.full_name)
    )
    photographers = result.scalars().all()
    return [{
        "id": p.id, "full_name": p.full_name, "email": p.email,
        "role": p.role.value if p.role else None, "avatar_url": p.avatar_url,
        "is_shooting": p.is_shooting or False, "current_spot_id": p.current_spot_id,
        "current_spot_name": p.current_spot.name if p.current_spot else None,
        "session_price": p.session_price,
        "shooting_started_at": p.shooting_started_at.isoformat() if p.shooting_started_at else None
    } for p in photographers]


@router.post("/admin/force-start-session")
async def admin_force_start_session(data: ForceStartSessionRequest, admin: Profile = Depends(get_current_admin), db: AsyncSession = Depends(get_db)):
    """Admin endpoint to force-start a live session for a photographer."""
    photographer_result = await db.execute(select(Profile).where(Profile.id == data.photographer_id))
    photographer = photographer_result.scalar_one_or_none()
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    if photographer.is_shooting:
        raise HTTPException(status_code=400, detail=f"{photographer.full_name} is already in a live session")
    
    spot_result = await db.execute(select(SurfSpot).where(SurfSpot.id == data.spot_id))
    spot = spot_result.scalar_one_or_none()
    if not spot:
        raise HTTPException(status_code=404, detail="Surf spot not found")
    
    live_session = LiveSession(
        photographer_id=data.photographer_id, surf_spot_id=spot.id, location_name=spot.name,
        buyin_price=data.session_price, photo_price=5.0, session_photo_price=5.0,
        photos_included=3, general_photo_price=10.0, max_surfers=10,
        estimated_duration_hours=2, participant_count=0, total_earnings=0.0,
        started_at=datetime.now(timezone.utc), status='active'
    )
    db.add(live_session)
    await db.flush()
    
    photographer.is_shooting = True
    photographer.shooting_started_at = datetime.now(timezone.utc)
    photographer.current_spot_id = spot.id
    photographer.location = spot.name
    photographer.session_price = data.session_price
    
    await db.commit()
    await db.refresh(photographer)
    await db.refresh(live_session)
    
    return {
        "success": True,
        "message": f"🔴 FORCE STARTED: {photographer.full_name} is now LIVE at {spot.name}",
        "photographer_id": photographer.id, "photographer_name": photographer.full_name,
        "spot_name": spot.name, "is_live": True, "live_session_id": live_session.id,
        "started_at": photographer.shooting_started_at.isoformat()
    }


@router.post("/admin/force-end-session/{photographer_id}")
async def admin_force_end_session(photographer_id: str, admin: Profile = Depends(get_current_admin), db: AsyncSession = Depends(get_db)):
    """Admin endpoint to force-end a live session for a photographer."""
    photographer_result = await db.execute(select(Profile).where(Profile.id == photographer_id))
    photographer = photographer_result.scalar_one_or_none()
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    spot_name = photographer.location or "Unknown"
    
    session_result = await db.execute(
        select(LiveSession).where(LiveSession.photographer_id == photographer_id)
        .where(LiveSession.status == 'active')
    )
    live_sessions = session_result.scalars().all()
    
    for session in live_sessions:
        session.status = 'completed'
        session.ended_at = datetime.now(timezone.utc)
    
    photographer.is_shooting = False
    photographer.is_live = False
    photographer.shooting_started_at = None
    photographer.current_spot_id = None
    photographer.location = None
    
    await db.commit()
    return {
        "success": True,
        "message": f"⏹️ FORCE ENDED: {photographer.full_name}'s session at {spot_name}",
        "photographer_id": photographer.id, "photographer_name": photographer.full_name,
        "is_live": False, "sessions_closed": len(live_sessions)
    }


@router.get("/admin/active-sessions")
async def get_admin_active_sessions(admin: Profile = Depends(get_current_admin), db: AsyncSession = Depends(get_db)):
    """Get all active live sessions for admin panel"""
    shooting_result = await db.execute(
        select(Profile).where(Profile.is_shooting.is_(True))
        .options(selectinload(Profile.current_spot))
    )
    shooting_photographers = shooting_result.scalars().all()
    
    sessions = []
    for p in shooting_photographers:
        session_result = await db.execute(
            select(LiveSession).where(LiveSession.photographer_id == p.id)
            .where(LiveSession.status == 'active')
            .order_by(LiveSession.started_at.desc()).limit(1)
        )
        live_session = session_result.scalar_one_or_none()
        sessions.append({
            "id": live_session.id if live_session else p.id,
            "photographer_id": p.id, "photographer_name": p.full_name,
            "photographer_avatar": p.avatar_url, "spot_id": p.current_spot_id,
            "spot_name": p.location or (p.current_spot.name if p.current_spot else "Unknown"),
            "started_at": p.shooting_started_at.isoformat() if p.shooting_started_at else None,
            "participant_count": live_session.participant_count if live_session else 0,
            "total_earnings": float(live_session.total_earnings or 0) if live_session else 0,
            "buyin_price": float(p.session_price or 25)
        })
    return sessions


@router.post("/admin/cleanup-stale-sessions")
async def cleanup_stale_sessions(admin: Profile = Depends(get_current_admin), db: AsyncSession = Depends(get_db)):
    """Admin endpoint to cleanup stale LiveSession records."""
    result = await db.execute(
        select(LiveSession).where(LiveSession.status == 'active')
        .options(selectinload(LiveSession.photographer))
    )
    active_sessions = result.scalars().all()
    
    closed_count = 0
    for session in active_sessions:
        if not session.photographer or not session.photographer.is_shooting:
            session.status = 'completed'
            session.ended_at = datetime.now(timezone.utc)
            closed_count += 1
    
    await db.commit()
    return {"success": True, "message": f"Cleaned up {closed_count} stale sessions", "closed_count": closed_count}
