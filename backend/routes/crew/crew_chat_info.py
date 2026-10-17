"""Minimal booking chat metadata for the existing crew chat consumer."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.security import get_current_user_id
from database import get_db
from models import Profile
from . import crew_chat_reactions

router = APIRouter()


@router.get("/crew-chat/{booking_id}/info")
async def get_crew_chat_info(
    booking_id: str,
    user_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user_id: str = Depends(get_current_user_id),
):
    """Return display metadata only after the existing booking chat access gate."""
    if user_id is not None and user_id != current_user_id:
        raise HTTPException(status_code=403, detail="Cannot read another user's crew chat")
    booking, _ = await crew_chat_reactions.verify_chat_access(booking_id, current_user_id, db)
    if not booking:
        raise HTTPException(status_code=403, detail="You don't have access to this chat")

    participant_ids = {p.participant_id for p in booking.participants or []}
    participant_ids.add(booking.photographer_id)
    result = await db.execute(
        select(Profile.id, Profile.full_name, Profile.avatar_url)
        .where(Profile.id.in_(participant_ids)).order_by(Profile.id)
    )
    participants = [
        {"user_id": p.id, "full_name": p.full_name, "avatar_url": p.avatar_url}
        for p in result.all()
    ]
    visible_ids = {p["user_id"] for p in participants}
    online_users = sorted(
        visible_ids.intersection(crew_chat_reactions.crew_chat_manager.get_online_users(booking_id))
    )
    return {"location": booking.location, "participants": participants, "online_users": online_users}
