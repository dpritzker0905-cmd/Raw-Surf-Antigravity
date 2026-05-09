"""
crew/crew_chat_reactions.py — Message reactions and WebSocket management.
Extracted from crew_chat.py (v94 audit) for LOC compliance.
"""
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from typing import List, Optional, Dict
from datetime import datetime, timezone
import json
import logging

from database import get_db
from models import Profile, Booking, CrewChatMessage, Notification

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


# Global chat manager instance — shared with crew_chat.py
crew_chat_manager = CrewChatConnectionManager()


# Quick reaction emojis for crew chat
REACTION_EMOJIS = ['\U0001F919', '\U0001F30A', '\U0001F3C4', '\U0001F525', '\U0001F4AF', '\u2764\uFE0F', '\U0001F44D', '\U0001F602']


# ============================================================
# HELPER — verify chat access (shared)
# ============================================================

async def verify_chat_access(booking_id: str, user_id: str, db: AsyncSession) -> tuple:
    """
    Verify user has access to the booking chat.
    Returns (booking, role) where role is 'captain', 'crew', or 'photographer'
    """
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

    if booking.photographer_id == user_id:
        return booking, "photographer"

    for p in booking.participants or []:
        if p.participant_id == user_id:
            if p.is_captain or booking.creator_id == user_id:
                return booking, "captain"
            return booking, "crew"

    return None, None


# ============================================================
# MESSAGE REACTIONS
# ============================================================

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
    booking, role = await verify_chat_access(booking_id, user_id, db)
    if not booking:
        raise HTTPException(status_code=403, detail="You don't have access to this chat")

    result = await db.execute(
        select(CrewChatMessage).where(
            CrewChatMessage.id == message_id,
            CrewChatMessage.booking_id == booking_id
        )
    )
    message = result.scalar_one_or_none()

    if not message:
        raise HTTPException(status_code=404, detail="Message not found")

    if emoji not in REACTION_EMOJIS:
        raise HTTPException(status_code=400, detail=f"Invalid reaction emoji. Allowed: {REACTION_EMOJIS}")

    reactions = message.reactions or {}

    if emoji not in reactions:
        reactions[emoji] = []

    if user_id in reactions[emoji]:
        reactions[emoji].remove(user_id)
        if not reactions[emoji]:
            del reactions[emoji]
        action = "removed"
    else:
        reactions[emoji].append(user_id)
        action = "added"

    message.reactions = reactions
    await db.commit()

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


@router.get("/crew-chat/{booking_id}/messages/{message_id}/reactions")
async def get_message_reactions(
    booking_id: str,
    message_id: str,
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get detailed reactions for a message"""
    booking, _ = await verify_chat_access(booking_id, user_id, db)
    if not booking:
        raise HTTPException(status_code=403, detail="You don't have access to this chat")

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

    async with async_session_maker() as db:
        booking, role = await verify_chat_access(booking_id, user_id, db)
        if not booking:
            await websocket.close(code=4003, reason="Access denied")
            return

    await crew_chat_manager.connect(websocket, booking_id, user_id)

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
            data = await websocket.receive_text()

            if data == "ping":
                await websocket.send_text("pong")
                continue

            try:
                message_data = json.loads(data)

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

        leave_message = {
            "type": "user_left",
            "data": {
                "user_id": user_id,
                "online_users": crew_chat_manager.get_online_users(booking_id)
            }
        }
        await crew_chat_manager.broadcast_to_booking(booking_id, leave_message)
