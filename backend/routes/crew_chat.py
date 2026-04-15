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

logger = logging.getLogger(__name__)

router = APIRouter()


# ============================================================
# WEBSOCKET CONNECTION MANAGER FOR CREW CHAT
# ============================================================

class CrewChatConnectionManager:
    """Manages WebSocket connections for crew chat rooms (per booking)"""
    
    def __init__(self):
        # booking_id -> {user_id: websocket}
        self.active_connections: Dict[str, Dict[str, WebSocket]] = {}
    
    async def connect(self, websocket: WebSocket, booking_id: str, user_id: str):
        """Accept and track a new WebSocket connection for a booking chat"""
        await websocket.accept()
        
        if booking_id not in self.active_connections:
            self.active_connections[booking_id] = {}
        
        self.active_connections[booking_id][user_id] = websocket
        logger.info(f"[CrewChat] User {user_id} connected to booking {booking_id}")
    
    def disconnect(self, booking_id: str, user_id: str):
        """Remove a WebSocket connection"""
        if booking_id in self.active_connections:
            self.active_connections[booking_id].pop(user_id, None)
            if not self.active_connections[booking_id]:
                del self.active_connections[booking_id]
        logger.info(f"[CrewChat] User {user_id} disconnected from booking {booking_id}")
    
    async def broadcast_to_booking(self, booking_id: str, message: dict, exclude_user: str = None):
        """Broadcast a message to all connected users in a booking chat"""
        if booking_id not in self.active_connections:
            return
        
        disconnected = []
        for user_id, websocket in self.active_connections[booking_id].items():
            if user_id == exclude_user:
                continue
            try:
                await websocket.send_json(message)
            except Exception as e:
                logger.warning(f"[CrewChat] Failed to send to {user_id}: {e}")
                disconnected.append(user_id)
        
        # Clean up disconnected
        for user_id in disconnected:
            self.active_connections[booking_id].pop(user_id, None)
    
    def get_online_users(self, booking_id: str) -> List[str]:
        """Get list of online user IDs in a booking chat"""
        if booking_id not in self.active_connections:
            return []
        return list(self.active_connections[booking_id].keys())


# Global chat manager instance
crew_chat_manager = CrewChatConnectionManager()


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

async def verify_chat_access(booking_id: str, user_id: str, db: AsyncSession) -> tuple:
    """
    Verify user has access to the booking chat.
    Returns (booking, role) where role is 'captain', 'crew', or 'photographer'
    """
    # Get booking with participants
    result = await db.execute(
        select(Booking).where(Booking.id == booking_id)
        .options(
            selectinload(Booking.participants),
            selectinload(Booking.photographer)
        )
    )
    booking = result.scalar_one_or_none()
    
    if not booking:
        return None, None
    
    # Check if user is the photographer
    if booking.photographer_id == user_id:
        return booking, "photographer"
    
    # Check if user is a participant
    for p in booking.participants or []:
        if p.participant_id == user_id:
            if p.is_captain or booking.creator_id == user_id:
                return booking, "captain"
            return booking, "crew"
    
    return None, None


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
# MESSAGE REACTIONS
# ============================================================

# Quick reaction emojis for crew chat
REACTION_EMOJIS = ['🤙', '🌊', '🏄', '🔥', '💯', '❤️', '👏', '😂']


@router.post("/crew-chat/{booking_id}/messages/{message_id}/react")
async def add_message_reaction(
    booking_id: str,
    message_id: str,
    user_id: str,
    emoji: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Add or toggle a reaction to a message.
    If user already reacted with this emoji, removes it.
    """
    # Verify access
    booking, role = await verify_chat_access(booking_id, user_id, db)
    if not booking:
        raise HTTPException(status_code=403, detail="You don't have access to this chat")
    
    # Get message
    result = await db.execute(
        select(CrewChatMessage).where(
            CrewChatMessage.id == message_id,
            CrewChatMessage.booking_id == booking_id
        )
    )
    message = result.scalar_one_or_none()
    
    if not message:
        raise HTTPException(status_code=404, detail="Message not found")
    
    # Validate emoji
    if emoji not in REACTION_EMOJIS:
        raise HTTPException(status_code=400, detail=f"Invalid reaction emoji. Allowed: {REACTION_EMOJIS}")
    
    # Toggle reaction
    reactions = message.reactions or {}
    
    if emoji not in reactions:
        reactions[emoji] = []
    
    if user_id in reactions[emoji]:
        # Remove reaction
        reactions[emoji].remove(user_id)
        if not reactions[emoji]:
            del reactions[emoji]
        action = "removed"
    else:
        # Add reaction
        reactions[emoji].append(user_id)
        action = "added"
    
    message.reactions = reactions
    await db.commit()
    
    # Broadcast reaction update
    reaction_data = {
        "type": "reaction_update",
        "data": {
            "message_id": message_id,
            "emoji": emoji,
            "user_id": user_id,
            "action": action,
            "reactions": reactions
        }
    }
    await crew_chat_manager.broadcast_to_booking(booking_id, reaction_data)
    
    return {
        "success": True,
        "action": action,
        "emoji": emoji,
        "reactions": reactions
    }


@router.get("/crew-chat/reaction-emojis")
async def get_reaction_emojis():
    """Get the list of allowed reaction emojis"""
    return {"emojis": REACTION_EMOJIS}


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


@router.get("/crew-chat/{booking_id}/messages/{message_id}/reactions")
async def get_message_reactions(
    booking_id: str,
    message_id: str,
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get detailed reactions for a message"""
    # Verify access
    booking, _ = await verify_chat_access(booking_id, user_id, db)
    if not booking:
        raise HTTPException(status_code=403, detail="You don't have access to this chat")
    
    # Get message
    result = await db.execute(
        select(CrewChatMessage).where(
            CrewChatMessage.id == message_id,
            CrewChatMessage.booking_id == booking_id
        )
    )
    message = result.scalar_one_or_none()
    
    if not message:
        raise HTTPException(status_code=404, detail="Message not found")
    
    reactions = message.reactions or {}
    
    # Get user info for each reaction
    detailed_reactions = {}
    for emoji, user_ids in reactions.items():
        detailed_reactions[emoji] = []
        for uid in user_ids:
            profile_result = await db.execute(select(Profile).where(Profile.id == uid))
            profile = profile_result.scalar_one_or_none()
            if profile:
                detailed_reactions[emoji].append({
                    "user_id": uid,
                    "name": profile.full_name,
                    "avatar_url": profile.avatar_url
                })
    
    return {
        "message_id": message_id,
        "reactions": detailed_reactions,
        "total_count": sum(len(users) for users in reactions.values())
    }


@router.get("/crew-chat/{booking_id}/info")
async def get_crew_chat_info(
    booking_id: str,
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get chat info including participants and booking details"""
    # Verify access
    booking, role = await verify_chat_access(booking_id, user_id, db)
    if not booking:
        raise HTTPException(status_code=403, detail="You don't have access to this chat")
    
    # Get all participants with profiles
    participants = []
    for p in booking.participants or []:
        profile_result = await db.execute(
            select(Profile).where(Profile.id == p.participant_id)
        )
        profile = profile_result.scalar_one_or_none()
        if profile:
            is_captain = p.is_captain or booking.creator_id == p.participant_id
            participants.append({
                "user_id": profile.id,
                "full_name": profile.full_name,
                "avatar_url": profile.avatar_url,
                "role": "captain" if is_captain else "crew",
                "payment_status": p.payment_status
            })
    
    # Add photographer
    if booking.photographer:
        participants.append({
            "user_id": booking.photographer.id,
            "full_name": booking.photographer.full_name,
            "avatar_url": booking.photographer.avatar_url,
            "role": "photographer",
            "payment_status": None
        })
    
    # Get unread count for user
    unread_result = await db.execute(
        select(CrewChatMessage).where(
            CrewChatMessage.booking_id == booking_id,
            CrewChatMessage.sender_id != user_id,
            not CrewChatMessage.is_deleted
        )
    )
    unread_messages = unread_result.scalars().all()
    unread_count = sum(1 for msg in unread_messages if user_id not in (msg.read_by or {}))
    
    return {
        "booking_id": booking_id,
        "booking_status": booking.status,
        "location": booking.location,
        "session_date": booking.session_date.isoformat() if booking.session_date else None,
        "participants": participants,
        "online_users": crew_chat_manager.get_online_users(booking_id),
        "unread_count": unread_count,
        "my_role": role
    }


# ============================================================
# WEBSOCKET ENDPOINT
# ============================================================

@router.websocket("/ws/crew-chat/{booking_id}/{user_id}")
async def crew_chat_websocket(
    websocket: WebSocket,
    booking_id: str,
    user_id: str
):
    """
    WebSocket connection for real-time crew chat.
    Clients connect per booking and receive messages in real-time.
    """
    from database import async_session_maker
    
    # Verify access before accepting connection
    async with async_session_maker() as db:
        booking, role = await verify_chat_access(booking_id, user_id, db)
        if not booking:
            await websocket.close(code=4003, reason="Access denied")
            return
    
    # Connect to chat
    await crew_chat_manager.connect(websocket, booking_id, user_id)
    
    # Broadcast user joined
    join_message = {
        "type": "user_joined",
        "data": {
            "user_id": user_id,
            "online_users": crew_chat_manager.get_online_users(booking_id)
        }
    }
    await crew_chat_manager.broadcast_to_booking(booking_id, join_message, exclude_user=user_id)
    
    try:
        while True:
            # Wait for messages (ping/pong or chat commands)
            data = await websocket.receive_text()
            
            if data == "ping":
                await websocket.send_text("pong")
                continue
            
            try:
                message_data = json.loads(data)
                
                # Handle typing indicator
                if message_data.get("type") == "typing":
                    typing_broadcast = {
                        "type": "typing",
                        "data": {
                            "user_id": user_id,
                            "is_typing": message_data.get("is_typing", True)
                        }
                    }
                    await crew_chat_manager.broadcast_to_booking(
                        booking_id, typing_broadcast, exclude_user=user_id
                    )
            except json.JSONDecodeError:
                pass
    
    except WebSocketDisconnect:
        crew_chat_manager.disconnect(booking_id, user_id)
        
        # Broadcast user left
        leave_message = {
            "type": "user_left",
            "data": {
                "user_id": user_id,
                "online_users": crew_chat_manager.get_online_users(booking_id)
            }
        }
        await crew_chat_manager.broadcast_to_booking(booking_id, leave_message)


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



# ============================================================
# MEDIA UPLOAD ENDPOINTS
# ============================================================

from fastapi import UploadFile, File, Form
from pathlib import Path
import uuid

# Upload directory for crew chat media
CREW_CHAT_UPLOAD_DIR = Path(__file__).parent.parent / "uploads" / "crew_chat"
CREW_CHAT_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
ALLOWED_AUDIO_TYPES = {"audio/webm", "audio/mp4", "audio/mpeg", "audio/wav", "audio/ogg"}
# File sharing - documents, PDFs, etc.
ALLOWED_FILE_TYPES = {
    # Documents
    "application/pdf": "pdf",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.ms-excel": "xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/vnd.ms-powerpoint": "ppt",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
    # Text
    "text/plain": "txt",
    "text/csv": "csv",
    # Archives
    "application/zip": "zip",
    # Images (also allowed as files)
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
}
MAX_VOICE_DURATION = 30  # seconds
MAX_IMAGE_SIZE = 10 * 1024 * 1024  # 10MB
MAX_VOICE_SIZE = 2 * 1024 * 1024  # 2MB
MAX_FILE_SIZE = 25 * 1024 * 1024  # 25MB for general files


@router.post("/crew-chat/{booking_id}/upload-image")
async def upload_crew_chat_image(
    booking_id: str,
    user_id: str = Form(...),
    caption: str = Form(""),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db)
):
    """
    Upload an image to crew chat.
    Creates a message with the image attached.
    """
    # Verify access
    booking, role = await verify_chat_access(booking_id, user_id, db)
    if not booking:
        raise HTTPException(status_code=403, detail="You don't have access to this chat")
    
    # Validate file type
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="Invalid image type. Allowed: JPEG, PNG, WebP")
    
    # Read file content
    content = await file.read()
    if len(content) > MAX_IMAGE_SIZE:
        raise HTTPException(status_code=400, detail="Image too large. Max 10MB")
    
    # Generate unique filename
    ext = file.filename.split('.')[-1] if '.' in file.filename else 'jpg'
    filename = f"{uuid.uuid4()}.{ext}"
    file_path = CREW_CHAT_UPLOAD_DIR / filename
    
    # Save file
    with open(file_path, 'wb') as f:
        f.write(content)
    
    media_url = f"/api/uploads/crew_chat/{filename}"
    
    # Get sender profile
    sender_result = await db.execute(select(Profile).where(Profile.id == user_id))
    sender = sender_result.scalar_one_or_none()
    
    # Create message
    message = CrewChatMessage(
        booking_id=booking_id,
        sender_id=user_id,
        content=caption or "Shared a photo",
        message_type="image",
        media_url=media_url
    )
    db.add(message)
    await db.flush()
    
    # Broadcast to all connected users
    message_data = {
        "type": "new_message",
        "data": {
            "id": message.id,
            "booking_id": booking_id,
            "sender_id": user_id,
            "sender_name": sender.full_name if sender else "Unknown",
            "sender_avatar": sender.avatar_url if sender else None,
            "sender_role": role,
            "content": message.content,
            "message_type": "image",
            "media_url": media_url,
            "voice_duration_seconds": None,
            "created_at": message.created_at.isoformat(),
            "is_system": False
        }
    }
    await crew_chat_manager.broadcast_to_booking(booking_id, message_data)
    
    await db.commit()
    
    return {
        "success": True,
        "message_id": message.id,
        "media_url": media_url
    }


@router.post("/crew-chat/{booking_id}/upload-voice")
async def upload_crew_chat_voice(
    booking_id: str,
    user_id: str = Form(...),
    duration: int = Form(...),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db)
):
    """
    Upload a voice note to crew chat.
    Max duration: 30 seconds.
    """
    # Verify access
    booking, role = await verify_chat_access(booking_id, user_id, db)
    if not booking:
        raise HTTPException(status_code=403, detail="You don't have access to this chat")
    
    # Validate duration
    if duration > MAX_VOICE_DURATION:
        raise HTTPException(status_code=400, detail=f"Voice note too long. Max {MAX_VOICE_DURATION} seconds")
    
    # Validate file type
    if file.content_type not in ALLOWED_AUDIO_TYPES:
        raise HTTPException(status_code=400, detail="Invalid audio type")
    
    # Read file content
    content = await file.read()
    if len(content) > MAX_VOICE_SIZE:
        raise HTTPException(status_code=400, detail="Voice note too large. Max 2MB")
    
    # Generate unique filename
    ext = "webm"  # Standard format for web audio
    if "mp4" in file.content_type or "m4a" in (file.filename or ""):
        ext = "m4a"
    elif "wav" in file.content_type:
        ext = "wav"
    elif "ogg" in file.content_type:
        ext = "ogg"
    
    filename = f"voice_{uuid.uuid4()}.{ext}"
    file_path = CREW_CHAT_UPLOAD_DIR / filename
    
    # Save file
    with open(file_path, 'wb') as f:
        f.write(content)
    
    media_url = f"/api/uploads/crew_chat/{filename}"
    
    # Get sender profile
    sender_result = await db.execute(select(Profile).where(Profile.id == user_id))
    sender = sender_result.scalar_one_or_none()
    
    # Create message
    message = CrewChatMessage(
        booking_id=booking_id,
        sender_id=user_id,
        content="Voice message",
        message_type="voice",
        media_url=media_url,
        voice_duration_seconds=duration
    )
    db.add(message)
    await db.flush()
    
    # Broadcast to all connected users
    message_data = {
        "type": "new_message",
        "data": {
            "id": message.id,
            "booking_id": booking_id,
            "sender_id": user_id,
            "sender_name": sender.full_name if sender else "Unknown",
            "sender_avatar": sender.avatar_url if sender else None,
            "sender_role": role,
            "content": "Voice message",
            "message_type": "voice",
            "media_url": media_url,
            "voice_duration_seconds": duration,
            "created_at": message.created_at.isoformat(),
            "is_system": False
        }
    }
    await crew_chat_manager.broadcast_to_booking(booking_id, message_data)
    
    await db.commit()
    
    return {
        "success": True,
        "message_id": message.id,
        "media_url": media_url,
        "duration": duration
    }


@router.post("/crew-chat/{booking_id}/upload-file")
async def upload_crew_chat_file(
    booking_id: str,
    user_id: str = Form(...),
    caption: str = Form(""),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db)
):
    """
    Upload a file (document, PDF, etc.) to crew chat.
    Supports: PDF, Word, Excel, PowerPoint, TXT, CSV, ZIP, images
    Max size: 25MB
    """
    # Verify access
    booking, role = await verify_chat_access(booking_id, user_id, db)
    if not booking:
        raise HTTPException(status_code=403, detail="You don't have access to this chat")
    
    # Validate file type
    if file.content_type not in ALLOWED_FILE_TYPES:
        allowed_types = ", ".join(ALLOWED_FILE_TYPES.values())
        raise HTTPException(
            status_code=400, 
            detail=f"Invalid file type. Allowed: {allowed_types}"
        )
    
    # Read file content
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File too large. Max 25MB")
    
    # Generate unique filename with proper extension
    ext = ALLOWED_FILE_TYPES.get(file.content_type, "bin")
    original_name = file.filename or f"file.{ext}"
    safe_name = "".join(c for c in original_name if c.isalnum() or c in "._- ").strip()
    filename = f"{uuid.uuid4()}_{safe_name}"
    file_path = CREW_CHAT_UPLOAD_DIR / filename
    
    # Save file
    with open(file_path, 'wb') as f:
        f.write(content)
    
    media_url = f"/api/uploads/crew_chat/{filename}"
    file_size = len(content)
    file_size_display = f"{file_size / 1024:.1f}KB" if file_size < 1024*1024 else f"{file_size / (1024*1024):.1f}MB"
    
    # Get sender profile
    sender_result = await db.execute(select(Profile).where(Profile.id == user_id))
    sender = sender_result.scalar_one_or_none()
    
    # Create message with file metadata
    message_content = caption if caption else f"📎 {original_name}"
    message = CrewChatMessage(
        booking_id=booking_id,
        sender_id=user_id,
        content=message_content,
        message_type="file",
        media_url=media_url,
        # Store file metadata in a JSON field or separate columns
        # For now, include in content
    )
    db.add(message)
    await db.flush()
    
    # Broadcast to all connected users
    message_data = {
        "type": "new_message",
        "data": {
            "id": message.id,
            "booking_id": booking_id,
            "sender_id": user_id,
            "sender_name": sender.full_name if sender else "Unknown",
            "sender_avatar": sender.avatar_url if sender else None,
            "sender_role": role,
            "content": message_content,
            "message_type": "file",
            "media_url": media_url,
            "file_name": original_name,
            "file_size": file_size_display,
            "file_type": ext,
            "voice_duration_seconds": None,
            "created_at": message.created_at.isoformat(),
            "is_system": False
        }
    }
    await crew_chat_manager.broadcast_to_booking(booking_id, message_data)
    
    await db.commit()
    
    return {
        "success": True,
        "message_id": message.id,
        "media_url": media_url,
        "file_name": original_name,
        "file_size": file_size_display,
        "file_type": ext
    }


# ============================================================
# QUICK ACTIONS - PRE-SET MESSAGES
# ============================================================

QUICK_ACTIONS = [
    {"id": "omw", "text": "On my way! 🏄", "category": "status"},
    {"id": "late", "text": "Running 5 mins late", "category": "status"},
    {"id": "arrived", "text": "Just arrived at the spot", "category": "status"},
    {"id": "pumping", "text": "Waves are pumping! 🌊", "category": "conditions"},
    {"id": "checking", "text": "Checking conditions now", "category": "conditions"},
    {"id": "glassy", "text": "It's glassy out here! 🔥", "category": "conditions"},
    {"id": "choppy", "text": "Getting a bit choppy", "category": "conditions"},
    {"id": "gear", "text": "Bringing extra gear", "category": "logistics"},
    {"id": "board", "text": "Got the boards loaded", "category": "logistics"},
    {"id": "wax", "text": "Anyone need wax?", "category": "logistics"},
    {"id": "directions", "text": "Need directions to the spot", "category": "logistics"},
    {"id": "ready", "text": "Ready when you are! 🤙", "category": "status"},
    {"id": "stoked", "text": "So stoked for this session!", "category": "vibes"},
    {"id": "thanks", "text": "Thanks for organizing! 🙏", "category": "vibes"},
]


@router.get("/crew-chat/quick-actions")
async def get_quick_actions():
    """Get list of pre-set quick action messages"""
    return {
        "quick_actions": QUICK_ACTIONS,
        "categories": ["status", "conditions", "logistics", "vibes"]
    }
