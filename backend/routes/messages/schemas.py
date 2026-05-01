"""Messages schemas — Pydantic models and constants."""
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, and_, text
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime, timezone, timedelta
import json
import os
import uuid
import httpx
import asyncio

from database import get_db
from models import Profile, Conversation, Message, Follow, Notification, MessageReaction
from utils.grom_parent import is_grom_parent_eligible
from models import RoleEnum

# Import OneSignal service for push notifications
try:
    from services.onesignal_service import onesignal_service
except ImportError:
    onesignal_service = None

router = APIRouter()

# Supabase config
SUPABASE_URL = os.environ.get('SUPABASE_URL', '')
SUPABASE_SERVICE_KEY = os.environ.get('SUPABASE_SERVICE_KEY', '')

# Supported reaction emojis — must stay in sync with frontend constants/emojis.js → REACTION_EMOJIS
ALLOWED_REACTIONS = ['🤙', '🌊', '🏄', '🔥', '💯', '❤️', '👏', '😂', '😎', '💪']


async def check_grom_messaging_permission(user_id: str, db: AsyncSession, is_grom_channel: bool = False) -> dict:
    """
    Check if a Grom user has permission to use messaging.
    
    Returns dict with:
    - allowed: bool - Whether messaging is allowed
    - reason: str - Reason if blocked
    - is_grom: bool - Whether user is a Grom
    - can_message_adults: bool - Can message non-Groms (regular channels)
    - can_message_groms: bool - Can message other Groms (Grom Zone)
    """
    from models import RoleEnum
    
    result = await db.execute(
        select(Profile).where(Profile.id == user_id)
    )
    user = result.scalar_one_or_none()
    
    if not user:
        return {"allowed": False, "reason": "user_not_found", "is_grom": False}
    
    # Admins always have full access
    if user.is_admin:
        return {"allowed": True, "reason": None, "is_grom": False, "can_message_adults": True, "can_message_groms": True}
    
    # Non-Groms have full access (but can't access Grom-only channels)
    if user.role != RoleEnum.GROM:
        return {
            "allowed": not is_grom_channel,  # Non-Groms can't use Grom channel
            "reason": "grom_channel_only" if is_grom_channel else None,
            "is_grom": False,
            "can_message_adults": True,
            "can_message_groms": False  # Adults can't message in Grom Zone
        }
    
    # ===== GROM USER CHECKS =====
    
    # Must be linked AND approved
    if not user.parent_id:
        return {"allowed": False, "reason": "not_linked", "is_grom": True, "can_message_adults": False, "can_message_groms": False}
    
    if not user.parent_link_approved:
        return {"allowed": False, "reason": "not_approved", "is_grom": True, "can_message_adults": False, "can_message_groms": False}
    
    # Check parental controls for messaging permissions
    parental_controls = user.parental_controls or {}
    
    # Separate permissions for regular messaging and Grom channel
    can_message_adults = parental_controls.get('can_message', True)  # Regular channels (adults)
    can_message_groms = parental_controls.get('can_message_grom_channel', True)  # Grom Zone
    
    if is_grom_channel:
        # Checking Grom channel permission
        if not can_message_groms:
            return {"allowed": False, "reason": "grom_channel_disabled", "is_grom": True, "can_message_adults": can_message_adults, "can_message_groms": False}
        return {"allowed": True, "reason": None, "is_grom": True, "can_message_adults": can_message_adults, "can_message_groms": True}
    else:
        # Checking regular channel permission
        if not can_message_adults:
            return {"allowed": False, "reason": "messaging_disabled", "is_grom": True, "can_message_adults": False, "can_message_groms": can_message_groms}
        return {"allowed": True, "reason": None, "is_grom": True, "can_message_adults": True, "can_message_groms": can_message_groms}


async def check_grom_to_grom_only(sender_id: str, recipient_id: str, db: AsyncSession) -> dict:
    """
    For Grom users, check if they can message the recipient.
    Groms can ONLY message other Groms (in Grom Zone).
    
    Returns dict with:
    - allowed: bool
    - reason: str if blocked
    - use_grom_channel: bool - Should use Grom Zone
    """
    from models import RoleEnum
    
    # Get both profiles
    sender_result = await db.execute(select(Profile).where(Profile.id == sender_id))
    sender = sender_result.scalar_one_or_none()
    
    recipient_result = await db.execute(select(Profile).where(Profile.id == recipient_id))
    recipient = recipient_result.scalar_one_or_none()
    
    if not sender or not recipient:
        return {"allowed": False, "reason": "user_not_found", "use_grom_channel": False}
    
    sender_is_grom = sender.role == RoleEnum.GROM
    recipient_is_grom = recipient.role == RoleEnum.GROM
    
    # If sender is Grom
    if sender_is_grom:
        if recipient_is_grom:
            # Grom to Grom - allowed via Grom Zone
            return {"allowed": True, "reason": None, "use_grom_channel": True}
        else:
            # Grom trying to message non-Grom - BLOCKED
            return {"allowed": False, "reason": "groms_can_only_message_groms", "use_grom_channel": False}
    
    # If recipient is Grom (and sender is not)
    if recipient_is_grom:
        # Non-Grom trying to message Grom - BLOCKED (safety)
        return {"allowed": False, "reason": "cannot_message_grom", "use_grom_channel": False}
    
    # Both are non-Groms - normal messaging
    return {"allowed": True, "reason": None, "use_grom_channel": False}

class SendMessageRequest(BaseModel):
    recipient_id: str
    content: str
    message_type: str = 'text'
    media_url: Optional[str] = None
    reply_to_id: Optional[str] = None

class MessageReactionData(BaseModel):
    emoji: str
    user_id: str
    user_name: Optional[str] = None

class ReplyPreview(BaseModel):
    id: str
    content: str
    sender_name: Optional[str] = None

class MessageResponse(BaseModel):
    id: str
    sender_id: str
    sender_name: Optional[str]
    sender_avatar: Optional[str]
    content: Optional[str] = None
    message_type: str
    is_read: bool
    created_at: datetime
    is_mine: bool = False
    media_url: Optional[str] = None
    media_thumbnail_url: Optional[str] = None
    voice_duration_seconds: Optional[int] = None
    reply_to: Optional[ReplyPreview] = None
    reactions: List[MessageReactionData] = []

class ConversationResponse(BaseModel):
    id: str
    other_user_id: str
    other_user_name: Optional[str]
    other_username: Optional[str] = None  # Actual @username
    other_user_avatar: Optional[str]
    other_user_role: Optional[str]
    other_user_updated_at: Optional[datetime] = None  # For avatar cache-busting
    other_user_last_active: Optional[datetime] = None  # Last message sent by other user (real presence)
    last_message_preview: Optional[str]
    last_message_at: Optional[datetime]
    unread_count: int
    is_request: bool
    folder: str = 'primary'  # official, primary, requests, hidden
    is_pinned: bool = False
    is_muted: bool = False
    is_manually_unread: bool = False

class ConversationDetailResponse(BaseModel):
    id: str
    other_user_id: str
    other_user_name: Optional[str]
    other_user_avatar: Optional[str]
    other_user_last_active: Optional[datetime] = None  # For real presence
    messages: List[MessageResponse]
    is_request: bool
    is_pinned: bool = False
    is_muted: bool = False
    is_manually_unread: bool = False

async def get_or_create_conversation(sender_id: str, recipient_id: str, db: AsyncSession):
    """
    Get existing conversation or create new one.
    STRICT UNIQUENESS: Always returns the OLDEST conversation between two users.
    If duplicates exist, they will be merged into the oldest one.
    
    STATUS LOGIC:
    - SENDER always sees conversation in 'primary' (they initiated)
    - RECIPIENT sees in 'primary' if SENDER follows them, otherwise 'request'
    """
    # Sort user IDs to ensure consistent ordering regardless of who initiates
    sorted_ids = sorted([sender_id, recipient_id])
    
    # Query ALL existing conversations between these users
    result = await db.execute(
        select(Conversation).where(
            or_(
                and_(Conversation.participant_one_id == sorted_ids[0], Conversation.participant_two_id == sorted_ids[1]),
                and_(Conversation.participant_one_id == sorted_ids[1], Conversation.participant_two_id == sorted_ids[0])
            )
        ).order_by(Conversation.created_at.asc())
    )
    conversations = result.scalars().all()
    
    if conversations:
        # Return the OLDEST conversation
        oldest_conversation = conversations[0]
        
        # If there are duplicates, merge them into the oldest
        if len(conversations) > 1:
            await merge_duplicate_conversations(oldest_conversation.id, [c.id for c in conversations[1:]], db)
        
        # Check if conversation needs status update (e.g., was hidden but user sends message)
        needs_update = False
        
        # Check if sender follows recipient (determines recipient's status)
        sender_follows_recipient_result = await db.execute(
            select(Follow).where(
                Follow.follower_id == sender_id,
                Follow.following_id == recipient_id
            )
        )
        sender_follows_recipient = sender_follows_recipient_result.scalar_one_or_none() is not None
        
        # Determine which participant is which in sorted order
        is_sender_participant_one = sorted_ids[0] == sender_id
        
        if is_sender_participant_one:
            # participant_one = sender, participant_two = recipient
            # Sender ALWAYS gets primary
            proper_status_one = 'primary'
            # Recipient gets primary if sender follows them, else request
            proper_status_two = 'primary' if sender_follows_recipient else 'request'
        else:
            # participant_one = recipient, participant_two = sender
            # Recipient gets primary if sender follows them, else request
            proper_status_one = 'primary' if sender_follows_recipient else 'request'
            # Sender ALWAYS gets primary
            proper_status_two = 'primary'
        
        # Update status if currently hidden (user deleted but is starting new convo)
        if oldest_conversation.status_for_one == 'hidden':
            oldest_conversation.status_for_one = proper_status_one
            needs_update = True
        if oldest_conversation.status_for_two == 'hidden':
            oldest_conversation.status_for_two = proper_status_two
            needs_update = True
            
        if needs_update:
            await db.commit()
            await db.refresh(oldest_conversation)
        
        return oldest_conversation, False
    
    # No existing conversation - create new one with sorted IDs
    # Check if sender follows recipient (determines recipient's status)
    sender_follows_recipient_result = await db.execute(
        select(Follow).where(
            Follow.follower_id == sender_id,
            Follow.following_id == recipient_id
        )
    )
    sender_follows_recipient = sender_follows_recipient_result.scalar_one_or_none() is not None
    
    # Determine which participant is which in sorted order
    is_sender_participant_one = sorted_ids[0] == sender_id
    
    if is_sender_participant_one:
        # participant_one = sender, participant_two = recipient
        # Sender ALWAYS gets primary
        status_one = 'primary'
        # Recipient gets primary if sender follows them, else request
        status_two = 'primary' if sender_follows_recipient else 'request'
    else:
        # participant_one = recipient, participant_two = sender
        # Recipient gets primary if sender follows them, else request
        status_one = 'primary' if sender_follows_recipient else 'request'
        # Sender ALWAYS gets primary
        status_two = 'primary'
    
    conversation = Conversation(
        participant_one_id=sorted_ids[0],  # Always store in sorted order
        participant_two_id=sorted_ids[1],
        status_for_one=status_one,
        status_for_two=status_two
    )
    db.add(conversation)
    
    try:
        await db.commit()
        await db.refresh(conversation)
    except Exception as e:
        # Race condition: another request created the conversation
        await db.rollback()
        # Fetch the existing conversation
        result = await db.execute(
            select(Conversation).where(
                and_(Conversation.participant_one_id == sorted_ids[0], Conversation.participant_two_id == sorted_ids[1])
            ).limit(1)
        )
        conversation = result.scalar_one_or_none()
        if not conversation:
            raise HTTPException(status_code=500, detail=f"Failed to create conversation: {e}")
        return conversation, False
    
    return conversation, True


async def merge_duplicate_conversations(target_conversation_id: str, duplicate_ids: List[str], db: AsyncSession):
    """
    Merge duplicate conversations: Move all messages to the target conversation,
    then delete the duplicates.
    """
    import logging
    logger = logging.getLogger(__name__)
    
    for dup_id in duplicate_ids:
        # Move all messages from duplicate to target
        # Use text() with bound params — raw f-string is SQL-injectable and not valid in AsyncSession
        await db.execute(
            text("UPDATE messages SET conversation_id = :target WHERE conversation_id = :dup"),
            {"target": target_conversation_id, "dup": dup_id}
        )
        logger.info(f"Moved messages from conversation {dup_id} to {target_conversation_id}")
        
        # Delete the duplicate conversation
        dup_result = await db.execute(select(Conversation).where(Conversation.id == dup_id))
        dup_conv = dup_result.scalar_one_or_none()
        if dup_conv:
            await db.delete(dup_conv)
            logger.info(f"Deleted duplicate conversation {dup_id}")
    
    await db.commit()

