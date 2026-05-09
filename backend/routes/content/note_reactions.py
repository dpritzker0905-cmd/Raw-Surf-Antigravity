"""
content/note_reactions.py — Emoji reactions on notes.
Extracted from notes.py (v93 audit) for LOC compliance.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from sqlalchemy.orm import selectinload
from datetime import datetime, timezone
from pydantic import BaseModel, Field
from typing import Optional
import json
import asyncio
from database import get_db
from models import UserNote, NoteReaction, Profile, Notification
from core.security import get_user_id_from_jwt_or_query

# Import OneSignal service for push notifications
try:
    from services.onesignal_service import onesignal_service
except ImportError:
    onesignal_service = None


router = APIRouter(prefix="/notes", tags=["notes"])

# Available reaction emojis for notes
NOTE_REACTION_EMOJIS = ['\U0001F919', '\U0001F30A', '\U0001F3C4', '\U0001F525', '\U0001F4AF', '\u2764\uFE0F', '\U0001F602', '\U0001F92F']


# Request/Response Models
class NoteReactionRequest(BaseModel):
    emoji: str = Field(..., description="Emoji to react with")


class NoteReactionResponse(BaseModel):
    id: str
    note_id: str
    user_id: str
    user_name: str
    user_avatar: Optional[str]
    emoji: str
    created_at: datetime


@router.get("/reaction-emojis")
async def get_note_reaction_emojis():
    """Get available emoji reactions for notes"""
    return {"emojis": NOTE_REACTION_EMOJIS}


@router.post("/{note_id}/react")
async def react_to_note(
    note_id: str,
    request: NoteReactionRequest,
    user_id: str = Depends(get_user_id_from_jwt_or_query),
    db: AsyncSession = Depends(get_db)
):
    """
    Add/update emoji reaction to a note
    - If user already reacted with same emoji, remove reaction (toggle)
    - If user already reacted with different emoji, update reaction
    """
    
    # Validate emoji
    if request.emoji not in NOTE_REACTION_EMOJIS:
        raise HTTPException(
            status_code=400, 
            detail=f"Invalid emoji. Allowed: {', '.join(NOTE_REACTION_EMOJIS)}"
        )
    
    # Get the note
    note_result = await db.execute(
        select(UserNote)
        .options(selectinload(UserNote.user))
        .where(UserNote.id == note_id)
    )
    note = note_result.scalar_one_or_none()
    
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    
    if not note.is_active or note.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Note has expired")
    
    # Can't react to own note
    if note.user_id == user_id:
        raise HTTPException(status_code=400, detail="Cannot react to your own note")
    
    # Get reactor info
    reactor_result = await db.execute(select(Profile).where(Profile.id == user_id))
    reactor = reactor_result.scalar_one_or_none()
    if not reactor:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Check for existing reaction
    existing_result = await db.execute(
        select(NoteReaction).where(
            and_(
                NoteReaction.note_id == note_id,
                NoteReaction.user_id == user_id
            )
        )
    )
    existing = existing_result.scalar_one_or_none()
    
    if existing:
        if existing.emoji == request.emoji:
            # Same emoji - toggle off (remove reaction)
            await db.delete(existing)
            await db.commit()
            return {
                "success": True,
                "action": "removed",
                "message": "Reaction removed"
            }
        else:
            # Different emoji - update reaction
            existing.emoji = request.emoji
            await db.commit()
            return {
                "success": True,
                "action": "updated",
                "reaction": NoteReactionResponse(
                    id=existing.id,
                    note_id=existing.note_id,
                    user_id=existing.user_id,
                    user_name=reactor.full_name or "Anonymous",
                    user_avatar=reactor.avatar_url,
                    emoji=existing.emoji,
                    created_at=existing.created_at
                )
            }
    
    # New reaction
    reaction = NoteReaction(
        note_id=note_id,
        user_id=user_id,
        emoji=request.emoji
    )
    db.add(reaction)
    
    # Create notification for note owner
    notification_data = json.dumps({
        "type": "note_reaction",
        "note_id": note_id,
        "note_content": note.content[:30] + "..." if len(note.content) > 30 else note.content,
        "reactor_id": user_id,
        "reactor_name": reactor.full_name,
        "reactor_avatar": reactor.avatar_url,
        "emoji": request.emoji
    })
    
    notification = Notification(
        user_id=note.user_id,
        type="note_reaction",
        title=f"{reactor.full_name or 'Someone'} reacted {request.emoji} to your note",
        body=note.content[:50],
        data=notification_data
    )
    db.add(notification)
    
    await db.commit()
    await db.refresh(reaction)
    
    # Send push notification via OneSignal (fire and forget)
    if onesignal_service:
        asyncio.create_task(
            onesignal_service.send_note_reaction_notification(
                recipient_id=note.user_id,
                reactor_name=reactor.full_name or "Someone",
                emoji=request.emoji,
                note_content=note.content
            )
        )
    
    return {
        "success": True,
        "action": "added",
        "reaction": NoteReactionResponse(
            id=reaction.id,
            note_id=reaction.note_id,
            user_id=reaction.user_id,
            user_name=reactor.full_name or "Anonymous",
            user_avatar=reactor.avatar_url,
            emoji=reaction.emoji,
            created_at=reaction.created_at
        )
    }


@router.get("/{note_id}/reactions")
async def get_note_reactions(
    note_id: str,
    user_id: str = Depends(get_user_id_from_jwt_or_query),
    db: AsyncSession = Depends(get_db)
):
    """Get all reactions on a note with counts by emoji"""
    
    result = await db.execute(
        select(NoteReaction)
        .options(selectinload(NoteReaction.user))
        .where(NoteReaction.note_id == note_id)
        .order_by(NoteReaction.created_at.desc())
    )
    reactions = result.scalars().all()
    
    # Count reactions by emoji
    emoji_counts = {}
    for r in reactions:
        emoji_counts[r.emoji] = emoji_counts.get(r.emoji, 0) + 1
    
    # Check if current user has reacted
    user_reaction = next((r for r in reactions if r.user_id == user_id), None)
    
    return {
        "reactions": [
            NoteReactionResponse(
                id=r.id,
                note_id=r.note_id,
                user_id=r.user_id,
                user_name=r.user.full_name or "Anonymous",
                user_avatar=r.user.avatar_url,
                emoji=r.emoji,
                created_at=r.created_at
            )
            for r in reactions
        ],
        "emoji_counts": emoji_counts,
        "total_count": len(reactions),
        "user_reaction": user_reaction.emoji if user_reaction else None
    }
