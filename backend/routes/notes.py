"""
Instagram-style Notes API
Short status updates that appear above user avatars in Messages
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, delete, func
from sqlalchemy.orm import selectinload
from datetime import datetime, timezone, timedelta
from pydantic import BaseModel, Field
from typing import Optional, List
import json
import asyncio
from database import get_db
from models import UserNote, NoteReply, NoteReaction, Profile, Follow, Conversation, Notification

# Import OneSignal service for push notifications
try:
    from services.onesignal_service import onesignal_service
except ImportError:
    onesignal_service = None


router = APIRouter(prefix="/notes", tags=["notes"])

# Available reaction emojis for notes
NOTE_REACTION_EMOJIS = ['🤙', '🌊', '🏄', '🔥', '💯', '❤️', '😂', '🤯']


# Request/Response Models
class CreateNoteRequest(BaseModel):
    content: str = Field(..., min_length=1, max_length=60)
    emoji: Optional[str] = None


class NoteResponse(BaseModel):
    id: str
    user_id: str
    user_name: str
    user_avatar: Optional[str]
    user_role: Optional[str]
    content: str
    emoji: Optional[str]
    is_own_note: bool
    view_count: int
    reply_count: int
    created_at: datetime
    expires_at: datetime
    time_remaining: str  # "23h", "45m", etc.


class ReplyToNoteRequest(BaseModel):
    reply_text: Optional[str] = Field(None, max_length=500)
    reply_emoji: Optional[str] = None


class NoteReplyResponse(BaseModel):
    id: str
    note_id: str
    replier_id: str
    replier_name: str
    replier_avatar: Optional[str]
    reply_text: Optional[str]
    reply_emoji: Optional[str]
    conversation_id: Optional[str]
    created_at: datetime


def get_time_remaining(expires_at: datetime) -> str:
    """Calculate human-readable time remaining"""
    now = datetime.now(timezone.utc)
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    
    remaining = expires_at - now
    if remaining.total_seconds() <= 0:
        return "expired"
    
    hours = int(remaining.total_seconds() // 3600)
    minutes = int((remaining.total_seconds() % 3600) // 60)
    
    if hours > 0:
        return f"{hours}h"
    return f"{minutes}m"


@router.post("/create")
async def create_note(
    request: CreateNoteRequest,
    user_id: str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    """Create a new note (replaces existing active note)"""
    
    # Verify user exists
    user_result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = user_result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Deactivate any existing active notes for this user
    await db.execute(
        delete(UserNote).where(
            and_(
                UserNote.user_id == user_id,
                UserNote.is_active
            )
        )
    )
    
    # Create new note with 24-hour expiration
    note = UserNote(
        user_id=user_id,
        content=request.content,
        emoji=request.emoji,
        expires_at=datetime.now(timezone.utc) + timedelta(hours=24)
    )
    db.add(note)
    await db.commit()
    await db.refresh(note)
    
    return {
        "success": True,
        "note": NoteResponse(
            id=note.id,
            user_id=note.user_id,
            user_name=user.full_name or "Anonymous",
            user_avatar=user.avatar_url,
            user_role=user.role.value if user.role else None,
            content=note.content,
            emoji=note.emoji,
            is_own_note=True,
            view_count=note.view_count,
            reply_count=note.reply_count,
            created_at=note.created_at,
            expires_at=note.expires_at,
            time_remaining=get_time_remaining(note.expires_at)
        )
    }


@router.get("/my-note")
async def get_my_note(
    user_id: str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    """Get current user's active note"""
    
    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(UserNote)
        .options(selectinload(UserNote.user))
        .where(
            and_(
                UserNote.user_id == user_id,
                UserNote.is_active,
                UserNote.expires_at > now
            )
        )
        .order_by(UserNote.created_at.desc())
        .limit(1)
    )
    note = result.scalar_one_or_none()
    
    if not note:
        return {"note": None}
    
    user = note.user
    return {
        "note": NoteResponse(
            id=note.id,
            user_id=note.user_id,
            user_name=user.full_name or "Anonymous",
            user_avatar=user.avatar_url,
            user_role=user.role.value if user.role else None,
            content=note.content,
            emoji=note.emoji,
            is_own_note=True,
            view_count=note.view_count,
            reply_count=note.reply_count,
            created_at=note.created_at,
            expires_at=note.expires_at,
            time_remaining=get_time_remaining(note.expires_at)
        )
    }


@router.get("/user/{target_user_id}")
async def get_user_note(
    target_user_id: str,
    viewer_id: str = Query(..., description="ID of the user viewing the profile"),
    db: AsyncSession = Depends(get_db)
):
    """
    Get a specific user's active note (for profile pages)
    Respects mutual follow visibility: only returns note if viewer and target are mutual followers
    OR if viewer is viewing their own note
    """
    
    now = datetime.now(timezone.utc)
    
    # If viewing own profile, just return the note
    if target_user_id == viewer_id:
        result = await db.execute(
            select(UserNote)
            .options(selectinload(UserNote.user))
            .where(
                and_(
                    UserNote.user_id == target_user_id,
                    UserNote.is_active,
                    UserNote.expires_at > now
                )
            )
            .order_by(UserNote.created_at.desc())
            .limit(1)
        )
        note = result.scalar_one_or_none()
        
        if not note:
            return {"note": None, "is_mutual_follower": True}
        
        user = note.user
        return {
            "note": NoteResponse(
                id=note.id,
                user_id=note.user_id,
                user_name=user.full_name or "Anonymous",
                user_avatar=user.avatar_url,
                user_role=user.role.value if user.role else None,
                content=note.content,
                emoji=note.emoji,
                is_own_note=True,
                view_count=note.view_count,
                reply_count=note.reply_count,
                created_at=note.created_at,
                expires_at=note.expires_at,
                time_remaining=get_time_remaining(note.expires_at)
            ),
            "is_mutual_follower": True
        }
    
    # Check mutual follow status
    # Viewer follows target?
    viewer_follows_result = await db.execute(
        select(Follow).where(
            and_(
                Follow.follower_id == viewer_id,
                Follow.following_id == target_user_id
            )
        )
    )
    viewer_follows = viewer_follows_result.scalar_one_or_none() is not None
    
    # Target follows viewer?
    target_follows_result = await db.execute(
        select(Follow).where(
            and_(
                Follow.follower_id == target_user_id,
                Follow.following_id == viewer_id
            )
        )
    )
    target_follows = target_follows_result.scalar_one_or_none() is not None
    
    is_mutual = viewer_follows and target_follows
    
    # If not mutual followers, don't show note
    if not is_mutual:
        return {"note": None, "is_mutual_follower": False}
    
    # Fetch the target user's active note
    result = await db.execute(
        select(UserNote)
        .options(selectinload(UserNote.user))
        .where(
            and_(
                UserNote.user_id == target_user_id,
                UserNote.is_active,
                UserNote.expires_at > now
            )
        )
        .order_by(UserNote.created_at.desc())
        .limit(1)
    )
    note = result.scalar_one_or_none()
    
    if not note:
        return {"note": None, "is_mutual_follower": True}
    
    # Increment view count
    note.view_count += 1
    await db.commit()
    
    user = note.user
    return {
        "note": NoteResponse(
            id=note.id,
            user_id=note.user_id,
            user_name=user.full_name or "Anonymous",
            user_avatar=user.avatar_url,
            user_role=user.role.value if user.role else None,
            content=note.content,
            emoji=note.emoji,
            is_own_note=False,
            view_count=note.view_count,
            reply_count=note.reply_count,
            created_at=note.created_at,
            expires_at=note.expires_at,
            time_remaining=get_time_remaining(note.expires_at)
        ),
        "is_mutual_follower": True
    }


@router.delete("/delete")
async def delete_note(
    user_id: str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    """Delete user's active note"""
    
    await db.execute(
        delete(UserNote).where(
            and_(
                UserNote.user_id == user_id,
                UserNote.is_active
            )
        )
    )
    await db.commit()
    
    return {"success": True, "message": "Note deleted"}


@router.get("/feed")
async def get_notes_feed(
    user_id: str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    """
    Get notes from MUTUAL FOLLOWERS only (users you follow who follow you back)
    Plus the user's own note (if any)
    Returns notes sorted by recency
    
    Instagram logic: "Shared with followers you follow back"
    """
    
    now = datetime.now(timezone.utc)
    
    # Get users the current user follows
    following_result = await db.execute(
        select(Follow.following_id).where(Follow.follower_id == user_id)
    )
    following_ids = set(row[0] for row in following_result.fetchall())
    
    # Get users who follow the current user
    followers_result = await db.execute(
        select(Follow.follower_id).where(Follow.following_id == user_id)
    )
    follower_ids = set(row[0] for row in followers_result.fetchall())
    
    # MUTUAL FOLLOWERS: Users I follow who also follow me back
    mutual_follower_ids = following_ids.intersection(follower_ids)
    
    # Include own user ID
    user_ids = list(mutual_follower_ids) + [user_id]
    
    # Get active, non-expired notes from mutual followers
    result = await db.execute(
        select(UserNote)
        .options(selectinload(UserNote.user))
        .where(
            and_(
                UserNote.user_id.in_(user_ids),
                UserNote.is_active,
                UserNote.expires_at > now
            )
        )
        .order_by(UserNote.created_at.desc())
        .limit(50)  # Limit to 50 notes
    )
    notes = result.scalars().all()
    
    # Build response with user's own note first
    feed = []
    own_note = None
    
    for note in notes:
        user = note.user
        is_own = note.user_id == user_id
        
        note_response = NoteResponse(
            id=note.id,
            user_id=note.user_id,
            user_name=user.full_name or "Anonymous",
            user_avatar=user.avatar_url,
            user_role=user.role.value if user.role else None,
            content=note.content,
            emoji=note.emoji,
            is_own_note=is_own,
            view_count=note.view_count,
            reply_count=note.reply_count,
            created_at=note.created_at,
            expires_at=note.expires_at,
            time_remaining=get_time_remaining(note.expires_at)
        )
        
        if is_own:
            own_note = note_response
        else:
            feed.append(note_response)
    
    # Increment view counts for notes being viewed (not own)
    for note in notes:
        if note.user_id != user_id:
            note.view_count += 1
    await db.commit()
    
    return {
        "own_note": own_note,
        "feed": feed,
        "total_count": len(feed) + (1 if own_note else 0),
        "mutual_follower_count": len(mutual_follower_ids)
    }


@router.post("/{note_id}/reply")
async def reply_to_note(
    note_id: str,
    request: ReplyToNoteRequest,
    user_id: str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    """
    Reply to a note - creates a DM conversation
    """
    
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
    
    # Can't reply to own note
    if note.user_id == user_id:
        raise HTTPException(status_code=400, detail="Cannot reply to your own note")
    
    # Need either text or emoji
    if not request.reply_text and not request.reply_emoji:
        raise HTTPException(status_code=400, detail="Reply must have text or emoji")
    
    # Get replier info
    replier_result = await db.execute(select(Profile).where(Profile.id == user_id))
    replier = replier_result.scalar_one_or_none()
    if not replier:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Find or create conversation between replier and note author
    sorted_ids = sorted([user_id, note.user_id])
    conv_result = await db.execute(
        select(Conversation).where(
            and_(
                Conversation.participant_one_id == sorted_ids[0],
                Conversation.participant_two_id == sorted_ids[1]
            )
        )
    )
    conversation = conv_result.scalar_one_or_none()
    
    if not conversation:
        # Create new conversation
        conversation = Conversation(
            participant_one_id=sorted_ids[0],
            participant_two_id=sorted_ids[1],
            status_for_one='primary',
            status_for_two='primary'
        )
        db.add(conversation)
        await db.commit()
        await db.refresh(conversation)
    
    # Import Message model
    from models import Message
    
    # Create a message in the conversation for proper threading
    # This makes the note reply visible in the chat history
    reply_content = request.reply_text if request.reply_text else f"Reacted {request.reply_emoji} to your note"
    note_context = f"📝 Replying to note: \"{note.content[:40]}{'...' if len(note.content) > 40 else ''}\"\n\n{reply_content}"
    
    message = Message(
        conversation_id=conversation.id,
        sender_id=user_id,
        content=note_context,
        message_type='text'
    )
    db.add(message)
    
    # Update conversation preview
    conversation.last_message_preview = f"📝 Note reply: {reply_content[:50]}"
    conversation.last_message_at = datetime.now(timezone.utc)
    
    # Create the reply record (for note stats)
    reply = NoteReply(
        note_id=note_id,
        replier_id=user_id,
        reply_text=request.reply_text,
        reply_emoji=request.reply_emoji,
        conversation_id=conversation.id
    )
    db.add(reply)
    
    # Update note reply count
    note.reply_count += 1
    
    # Create notification for note owner
    notification_data = json.dumps({
        "type": "note_reply",
        "note_id": note_id,
        "note_content": note.content[:30] + "..." if len(note.content) > 30 else note.content,
        "reply_id": reply.id,
        "conversation_id": conversation.id,
        "replier_id": user_id,
        "replier_name": replier.full_name,
        "replier_avatar": replier.avatar_url
    })
    
    notification = Notification(
        user_id=note.user_id,
        type="note_reply",
        title=f"{replier.full_name or 'Someone'} replied to your note",
        body=request.reply_text[:100] if request.reply_text else f"Reacted with {request.reply_emoji}",
        data=notification_data
    )
    db.add(notification)
    
    await db.commit()
    await db.refresh(reply)
    
    # Send push notification via OneSignal (fire and forget)
    if onesignal_service:
        asyncio.create_task(
            onesignal_service.send_note_reply_notification(
                recipient_id=note.user_id,
                sender_name=replier.full_name or "Someone",
                note_content=note.content,
                conversation_id=conversation.id
            )
        )
    
    return {
        "success": True,
        "reply": NoteReplyResponse(
            id=reply.id,
            note_id=reply.note_id,
            replier_id=reply.replier_id,
            replier_name=replier.full_name or "Anonymous",
            replier_avatar=replier.avatar_url,
            reply_text=reply.reply_text,
            reply_emoji=reply.reply_emoji,
            conversation_id=reply.conversation_id,
            created_at=reply.created_at
        ),
        "conversation_id": conversation.id
    }


@router.get("/{note_id}/replies")
async def get_note_replies(
    note_id: str,
    user_id: str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    """Get all replies to a note"""
    
    result = await db.execute(
        select(NoteReply)
        .options(selectinload(NoteReply.replier))
        .where(NoteReply.note_id == note_id)
        .order_by(NoteReply.created_at.desc())
    )
    replies = result.scalars().all()
    
    return {
        "replies": [
            NoteReplyResponse(
                id=reply.id,
                note_id=reply.note_id,
                replier_id=reply.replier_id,
                replier_name=reply.replier.full_name or "Anonymous",
                replier_avatar=reply.replier.avatar_url,
                reply_text=reply.reply_text,
                reply_emoji=reply.reply_emoji,
                conversation_id=reply.conversation_id,
                created_at=reply.created_at
            )
            for reply in replies
        ]
    }



@router.get("/notifications")
async def get_note_notifications(
    user_id: str = Query(...),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db)
):
    """Get note-related notifications for a user"""
    
    result = await db.execute(
        select(Notification)
        .where(
            and_(
                Notification.user_id == user_id,
                Notification.type == "note_reply"
            )
        )
        .order_by(Notification.created_at.desc())
        .limit(limit)
    )
    notifications = result.scalars().all()
    
    # Count unread
    unread_count = sum(1 for n in notifications if not n.is_read)
    
    return {
        "notifications": [
            {
                "id": n.id,
                "type": n.type,
                "title": n.title,
                "body": n.body,
                "data": json.loads(n.data) if n.data else None,
                "is_read": n.is_read,
                "created_at": n.created_at.isoformat()
            }
            for n in notifications
        ],
        "unread_count": unread_count,
        "total_count": len(notifications)
    }


@router.post("/notifications/mark-read")
async def mark_note_notifications_read(
    user_id: str = Query(...),
    notification_ids: Optional[list] = None,
    db: AsyncSession = Depends(get_db)
):
    """Mark note notifications as read"""
    
    if notification_ids:
        # Mark specific notifications
        result = await db.execute(
            select(Notification).where(
                and_(
                    Notification.id.in_(notification_ids),
                    Notification.user_id == user_id
                )
            )
        )
        notifications = result.scalars().all()
        for n in notifications:
            n.is_read = True
    else:
        # Mark all note notifications as read
        result = await db.execute(
            select(Notification).where(
                and_(
                    Notification.user_id == user_id,
                    Notification.type == "note_reply",
                    not Notification.is_read
                )
            )
        )
        notifications = result.scalars().all()
        for n in notifications:
            n.is_read = True
    
    await db.commit()
    
    return {
        "success": True,
        "marked_count": len(notifications)
    }



# ============================================================
# NOTE REACTIONS - Emoji reactions on notes
# ============================================================

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
    user_id: str = Query(...),
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
    user_id: str = Query(...),
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
