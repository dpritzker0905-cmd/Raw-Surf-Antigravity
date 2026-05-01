"""
Photographer participants — live session participant listing and notes.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
import logging

logger = logging.getLogger(__name__)

from database import get_db
from models import Profile, LiveSessionParticipant
from .schemas import UpdateParticipantNotesRequest

router = APIRouter()


@router.get("/photographer/{photographer_id}/live-participants")
async def get_live_session_participants(
    photographer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get list of users currently in photographer's live session with full identification info"""
    photographer_result = await db.execute(
        select(Profile).where(Profile.id == photographer_id)
        .options(selectinload(Profile.current_spot))
    )
    photographer = photographer_result.scalar_one_or_none()
    
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    if not photographer.is_shooting:
        return {
            "is_live": False,
            "participants": [],
            "total_participants": 0,
            "total_earnings": 0
        }
    
    result = await db.execute(
        select(LiveSessionParticipant)
        .where(LiveSessionParticipant.photographer_id == photographer_id)
        .where(LiveSessionParticipant.status == 'active')
        .options(selectinload(LiveSessionParticipant.surfer))
        .order_by(LiveSessionParticipant.joined_at.desc())
    )
    participants = result.scalars().all()
    
    total_earnings = sum(p.amount_paid for p in participants)
    
    participants_data = []
    for p in participants:
        surfer = p.surfer
        participants_data.append({
            "id": p.id,
            "surfer_id": p.surfer_id,
            "name": surfer.full_name if surfer else "Unknown",
            "username": surfer.username if surfer else None,
            "avatar_url": surfer.avatar_url if surfer else None,
            "selfie_url": p.selfie_url,
            "role": surfer.role.value if surfer and surfer.role else None,
            "amount_paid": p.amount_paid,
            "joined_at": p.joined_at.isoformat(),
            "stance": surfer.stance if surfer else None,
            "wetsuit_color": surfer.wetsuit_color if surfer else None,
            "rash_guard_color": surfer.rash_guard_color if surfer else None,
            "skill_level": surfer.skill_level if surfer else None,
            "photographer_notes": p.photographer_notes
        })
    
    return {
        "is_live": True,
        "location": photographer.location or (photographer.current_spot.name if photographer.current_spot else None),
        "spot_name": photographer.current_spot.name if photographer.current_spot else None,
        "started_at": photographer.shooting_started_at.isoformat() if photographer.shooting_started_at else None,
        "participants": participants_data,
        "total_participants": len(participants_data),
        "total_earnings": total_earnings
    }


@router.patch("/photographer/{photographer_id}/participant/{participant_id}/notes")
async def update_participant_notes(
    photographer_id: str,
    participant_id: str,
    data: UpdateParticipantNotesRequest,
    db: AsyncSession = Depends(get_db)
):
    """Update photographer's notes for a session participant (for identification)"""
    result = await db.execute(
        select(LiveSessionParticipant)
        .where(LiveSessionParticipant.id == participant_id)
        .where(LiveSessionParticipant.photographer_id == photographer_id)
    )
    participant = result.scalar_one_or_none()
    
    if not participant:
        raise HTTPException(status_code=404, detail="Participant not found in your session")
    
    participant.photographer_notes = data.notes
    await db.commit()
    
    return {"success": True, "notes": data.notes}
