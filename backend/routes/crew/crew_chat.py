"""
Crew Chat Routes - Real-time messaging for booking coordination
Allows Captains, Crew members, and Photographers to communicate
about gear, meeting spots, and session details.
"""
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import List, Optional, Dict
from datetime import datetime, timezone
import json
import logging

from database import get_db
from models import (
    Profile, Booking, CrewChatMessage, Notification
)
from services.mentions_service import mentions_service

# Reaction endpoints, WebSocket manager, and WS endpoint extracted to crew_chat_reactions.py (v94)
from .crew_chat_reactions import crew_chat_manager, verify_chat_access  # noqa: F401

router = APIRouter()
logger = logging.getLogger(__name__)

# ============================================================
# PYDANTIC MODELS
# ============================================================

class SendCrewChatMessageRequest(BaseModel):
    content: str
    message_type: str = "text"
    media_url: Optional[str] = None
    voice_duration_seconds: Optional[int] = None
    reply_to_id: Optional[str] = None  # For threaded replies


class CrewChatMessageResponse(BaseModel):
    id: str
    booking_id: str
    sender_id: str
    sender_name: str
    sender_avatar: Optional[str]
    sender_role: str  # 'captain', 'crew', 'photographer'
    content: str
    message_type: str
    media_url: Optional[str]
    voice_duration_seconds: Optional[int]
    created_at: str
    is_system: bool = False
    reply_to: Optional[Dict] = None  # Reply context
    mentions: List[Dict] = []  # Parsed mentions


# ============================================================
# HELPER FUNCTIONS
# ============================================================

async def create_system_message(booking_id: str, content: str, system_data: dict, db: AsyncSession):
    """Create a system-generated message (e.g., payment updates)"""
    message = CrewChatMessage(
        booking_id=booking_id,
        sender_id="system",  # Special system sender
        content=content,
        message_type="system",
        system_data=system_data
    )
    db.add(message)
    await db.flush()
    return message


# ============================================================
# REST API ENDPOINTS
# ============================================================

@router.get("/crew-chat/{booking_id}/messages")
async def get_crew_chat_messages(
    booking_id: str,
    user_id: str,
    limit: int = 50,
    before: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """
    Get chat message history for a booking.
    Supports pagination with 'before' cursor (message ID).
    """
    # Verify access
    booking, role = await verify_chat_access(booking_id, user_id, db)
    if not booking:
        raise HTTPException(status_code=403, detail="You don't have access to this chat")
    
    # Build query
    query = select(CrewChatMessage).where(
        CrewChatMessage.booking_id == booking_id,
        not CrewChatMessage.is_deleted
    ).options(selectinload(CrewChatMessage.sender))
    
    # Pagination cursor
    if before:
        before_msg = await db.execute(
            select(CrewChatMessage).where(CrewChatMessage.id == before)
        )
        before_msg = before_msg.scalar_one_or_none()
        if before_msg:
            query = query.where(CrewChatMessage.created_at < before_msg.created_at)
    
    query = query.order_by(CrewChatMessage.created_at.desc()).limit(limit)
    
    result = await db.execute(query)
    messages = result.scalars().all()
    
    # Get participant info for role mapping
    participant_roles = {}
    for p in booking.participants or []:
        if p.is_captain or booking.creator_id == p.participant_id:
            participant_roles[p.participant_id] = "captain"
        else:
            participant_roles[p.participant_id] = "crew"
    participant_roles[booking.photographer_id] = "photographer"
    
    # Format response - need to fetch reply_to messages
    [msg.id for msg in messages]
    reply_to_ids = [msg.reply_to_id for msg in messages if msg.reply_to_id]
    
    # Fetch reply-to messages
    reply_messages = {}
    if reply_to_ids:
        reply_result = await db.execute(
            select(CrewChatMessage).where(CrewChatMessage.id.in_(reply_to_ids))
            .options(selectinload(CrewChatMessage.sender))
        )
        for reply_msg in reply_result.scalars().all():
            reply_messages[reply_msg.id] = {
                "id": reply_msg.id,
                "sender_name": reply_msg.sender.full_name if reply_msg.sender else "Unknown",
                "content": reply_msg.content[:100] + ("..." if len(reply_msg.content) > 100 else ""),
                "message_type": reply_msg.message_type
            }
    
    # Format response
    response = []
    for msg in reversed(messages):  # Reverse to get chronological order
        sender_role = "system" if msg.message_type == "system" else participant_roles.get(msg.sender_id, "crew")
        response.append({
            "id": msg.id,
            "booking_id": msg.booking_id,
            "sender_id": msg.sender_id,
            "sender_name": msg.sender.full_name if msg.sender else "System",
            "sender_avatar": msg.sender.avatar_url if msg.sender else None,
            "sender_role": sender_role,
            "content": msg.content,
            "message_type": msg.message_type,
            "media_url": msg.media_url,
            "voice_duration_seconds": msg.voice_duration_seconds,
            "created_at": msg.created_at.isoformat(),
            "is_system": msg.message_type == "system",
            "reactions": msg.reactions or {},
            "reply_to": reply_messages.get(msg.reply_to_id) if msg.reply_to_id else None,
            "mentions": msg.mentions or []
        })
    
    # Get online users
    online_users = crew_chat_manager.get_online_users(booking_id)
    
    return {
        "messages": response,
        "online_users": online_users,
        "my_role": role,
        "booking_status": booking.status,
        "has_more": len(messages) == limit
    }


@router.post("/crew-chat/{booking_id}/send")
async def send_crew_chat_message(
    booking_id: str,
    user_id: str,
    data: SendCrewChatMessageRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Send a message to the crew chat.
    Supports @mentions and threaded replies.
    Broadcasts to all connected WebSocket clients.
    """
    # Verify access
    booking, role = await verify_chat_access(booking_id, user_id, db)
    if not booking:
        raise HTTPException(status_code=403, detail="You don't have access to this chat")
    
    if not data.content.strip():
        raise HTTPException(status_code=400, detail="Message content cannot be empty")
    
    # Get sender profile
    sender_result = await db.execute(select(Profile).where(Profile.id == user_id))
    sender = sender_result.scalar_one_or_none()
    if not sender:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Process @mentions
    processed_content, mentions = await mentions_service.resolve_mentions(data.content.strip(), db)
    
    # Get reply context if replying
    reply_to_data = None
    if data.reply_to_id:
        reply_msg_result = await db.execute(
            select(CrewChatMessage).where(CrewChatMessage.id == data.reply_to_id)
            .options(selectinload(CrewChatMessage.sender))
        )
        reply_msg = reply_msg_result.scalar_one_or_none()
        if reply_msg:
            reply_to_data = {
                "id": reply_msg.id,
                "sender_name": reply_msg.sender.full_name if reply_msg.sender else "Unknown",
                "content": reply_msg.content[:100] + ("..." if len(reply_msg.content) > 100 else ""),
                "message_type": reply_msg.message_type
            }
    
    # Create message
    message = CrewChatMessage(
        booking_id=booking_id,
        sender_id=user_id,
        content=processed_content,
        message_type=data.message_type,
        media_url=data.media_url,
        voice_duration_seconds=data.voice_duration_seconds,
        reply_to_id=data.reply_to_id,
        mentions=mentions
    )
    db.add(message)
    await db.flush()
    
    # Send mention notifications
    if mentions:
        await mentions_service.send_mention_notifications(
            mentions=mentions,
            sender_id=user_id,
            sender_name=sender.full_name,
            message_preview=processed_content,
            context='crew_chat',
            context_id=booking_id,
            message_id=message.id,
            db=db
        )
    
    # Prepare broadcast data
    message_data = {
        "type": "new_message",
        "data": {
            "id": message.id,
            "booking_id": booking_id,
            "sender_id": user_id,
            "sender_name": sender.full_name,
            "sender_avatar": sender.avatar_url,
            "sender_role": role,
            "content": message.content,
            "message_type": message.message_type,
            "media_url": message.media_url,
            "voice_duration_seconds": message.voice_duration_seconds,
            "created_at": message.created_at.isoformat(),
            "is_system": False,
            "reply_to": reply_to_data,
            "mentions": mentions,
            "reactions": {}
        }
    }
    
    # Broadcast to all connected users
    await crew_chat_manager.broadcast_to_booking(booking_id, message_data)
    
    # Send push notification to offline participants
    online_users = set(crew_chat_manager.get_online_users(booking_id))
    for p in booking.participants or []:
        if p.participant_id != user_id and p.participant_id not in online_users:
            notification = Notification(
                user_id=p.participant_id,
                type="crew_chat_message",
                title=f"Crew Chat: {sender.full_name}",
                body=message.content[:100] + ("..." if len(message.content) > 100 else ""),
                data=json.dumps({
                    "booking_id": booking_id,
                    "sender_name": sender.full_name,
                    "deep_link": f"/bookings/{booking_id}/chat"
                })
            )
            db.add(notification)
    
    # Notify photographer if offline
    if booking.photographer_id != user_id and booking.photographer_id not in online_users:
        notification = Notification(
            user_id=booking.photographer_id,
            type="crew_chat_message",
            title=f"Crew Chat: {sender.full_name}",
            body=message.content[:100] + ("..." if len(message.content) > 100 else ""),
            data=json.dumps({
                "booking_id": booking_id,
                "sender_name": sender.full_name,
                "deep_link": f"/bookings/{booking_id}/chat"
            })
        )
        db.add(notification)
    
    await db.commit()
    
    return {
        "success": True,
        "message_id": message.id,
        "created_at": message.created_at.isoformat()
    }


@router.post("/crew-chat/{booking_id}/mark-read")
async def mark_messages_read(
    booking_id: str,
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Mark all messages in the chat as read by this user"""
    # Verify access
    booking, _ = await verify_chat_access(booking_id, user_id, db)
    if not booking:
        raise HTTPException(status_code=403, detail="You don't have access to this chat")
    
    # Get unread messages
    result = await db.execute(
        select(CrewChatMessage).where(
            CrewChatMessage.booking_id == booking_id,
            CrewChatMessage.sender_id != user_id,
            not CrewChatMessage.is_deleted
        )
    )
    messages = result.scalars().all()
    
    now_iso = datetime.now(timezone.utc).isoformat()
    for msg in messages:
        read_by = msg.read_by or {}
        if user_id not in read_by:
            read_by[user_id] = now_iso
            msg.read_by = read_by
    
    await db.commit()
    
    return {"success": True, "marked_count": len(messages)}

# ============================================================
# MENTIONS AUTOCOMPLETE
# ============================================================

@router.get("/mentions/search")
async def search_mentions(
    query: str,
    user_id: str,
    context: str = "crew_chat",
    context_id: Optional[str] = None,
    limit: int = 10,
    db: AsyncSession = Depends(get_db)
):
    """
    Search for users to @mention.
    
    Args:
        query: Search query (partial username or name)
        user_id: Current user ID
        context: 'crew_chat', 'dm', 'comment', 'post'
        context_id: booking_id, conversation_id, etc.
        limit: Max results
    
    Returns prioritized list:
    1. Participants in current context (booking, conversation)
    2. Users the current user follows
    3. All public profiles matching query
    """
    results = await mentions_service.search_mentionable_users(
        query=query,
        current_user_id=user_id,
        context=context,
        context_id=context_id,
        db=db,
        limit=limit
    )
    
    return {"users": results}
# ============================================================
# SYSTEM MESSAGE HELPERS (Called from other routes)
# ============================================================

async def send_crew_chat_system_message(
    booking_id: str,
    content: str,
    system_type: str,
    db: AsyncSession
):
    """
    Send a system message to the crew chat.
    Called from bookings.py when payment events occur.
    
    system_type: 'payment', 'status_change', 'crew_update'
    """
    message = CrewChatMessage(
        booking_id=booking_id,
        sender_id="system",
        content=content,
        message_type="system",
        system_data={"type": system_type}
    )
    db.add(message)
    await db.flush()
    
    # Broadcast to connected users
    message_data = {
        "type": "new_message",
        "data": {
            "id": message.id,
            "booking_id": booking_id,
            "sender_id": "system",
            "sender_name": "System",
            "sender_avatar": None,
            "sender_role": "system",
            "content": content,
            "message_type": "system",
            "media_url": None,
            "voice_duration_seconds": None,
            "created_at": message.created_at.isoformat(),
            "is_system": True
        }
    }
    await crew_chat_manager.broadcast_to_booking(booking_id, message_data)
    
    return message

# Media upload endpoints and quick actions extracted to crew_chat_media.py (v86)

