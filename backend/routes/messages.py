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

# Import OneSignal service for push notifications
try:
    from services.onesignal_service import onesignal_service
except ImportError:
    onesignal_service = None

router = APIRouter()

# Supabase config
SUPABASE_URL = os.environ.get('SUPABASE_URL', '')
SUPABASE_SERVICE_KEY = os.environ.get('SUPABASE_SERVICE_KEY', '')

# Supported reaction emojis (Shaka, Wave, Heart, Fire)
ALLOWED_REACTIONS = ['🤙', '🌊', '❤️', '🔥', '👏', '😂']


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

@router.get("/messages/check-thread/{user_id}/{recipient_id}")
async def check_existing_thread(user_id: str, recipient_id: str, db: AsyncSession = Depends(get_db)):
    """
    Lazy thread check: Returns existing conversation ID if one exists.
    Does NOT create a new conversation - that happens on first message send.
    """
    # Sort user IDs for consistent lookup
    sorted_ids = sorted([user_id, recipient_id])
    
    # Query for existing conversation
    result = await db.execute(
        select(Conversation).where(
            or_(
                and_(Conversation.participant_one_id == sorted_ids[0], Conversation.participant_two_id == sorted_ids[1]),
                and_(Conversation.participant_one_id == sorted_ids[1], Conversation.participant_two_id == sorted_ids[0])
            )
        ).order_by(Conversation.created_at.asc()).limit(1)
    )
    conversation = result.scalar_one_or_none()
    
    # Get recipient profile info
    recipient_result = await db.execute(select(Profile).where(Profile.id == recipient_id))
    recipient = recipient_result.scalar_one_or_none()
    if not recipient:
        raise HTTPException(status_code=404, detail="Recipient not found")
    
    if conversation:
        return {
            "exists": True,
            "conversation_id": conversation.id,
            "recipient_id": recipient_id,
            "recipient_name": recipient.full_name,
            "recipient_avatar": recipient.avatar_url
        }
    else:
        return {
            "exists": False,
            "conversation_id": None,
            "recipient_id": recipient_id,
            "recipient_name": recipient.full_name,
            "recipient_avatar": recipient.avatar_url
        }


@router.post("/messages/send")
async def send_message(data: SendMessageRequest, sender_id: str, db: AsyncSession = Depends(get_db)):
    # GROM SAFETY GATE: Check Grom-to-Grom restriction
    grom_check = await check_grom_to_grom_only(sender_id, data.recipient_id, db)
    if not grom_check["allowed"]:
        if grom_check["reason"] == "groms_can_only_message_groms":
            raise HTTPException(
                status_code=403, 
                detail="Groms can only message other Groms in the Grom Zone."
            )
        elif grom_check["reason"] == "cannot_message_grom":
            raise HTTPException(
                status_code=403, 
                detail="Cannot send messages to Grom accounts."
            )
        raise HTTPException(status_code=403, detail="Messaging not allowed.")
    
    # Check messaging permissions (with Grom channel flag)
    is_grom_channel = grom_check.get("use_grom_channel", False)
    perm_check = await check_grom_messaging_permission(sender_id, db, is_grom_channel)
    if not perm_check["allowed"]:
        if perm_check["reason"] == "not_linked":
            raise HTTPException(status_code=403, detail="Messaging is locked. Parent link required.")
        elif perm_check["reason"] == "not_approved":
            raise HTTPException(status_code=403, detail="Messaging is locked. Waiting for parent approval.")
        elif perm_check["reason"] == "grom_channel_disabled":
            raise HTTPException(status_code=403, detail="Grom Zone messaging is disabled by your parent.")
        elif perm_check["reason"] == "messaging_disabled":
            raise HTTPException(status_code=403, detail="Messaging is disabled by your parent.")
        raise HTTPException(status_code=403, detail="Messaging not allowed.")
    
    sender_result = await db.execute(select(Profile).where(Profile.id == sender_id))
    sender = sender_result.scalar_one_or_none()
    if not sender:
        raise HTTPException(status_code=404, detail="Sender not found")
    
    recipient_result = await db.execute(select(Profile).where(Profile.id == data.recipient_id))
    recipient = recipient_result.scalar_one_or_none()
    if not recipient:
        raise HTTPException(status_code=404, detail="Recipient not found")
    
    conversation, is_new = await get_or_create_conversation(sender_id, data.recipient_id, db)
    
    # Validate reply_to_id if provided
    reply_to_message = None
    if data.reply_to_id:
        reply_result = await db.execute(
            select(Message).where(
                Message.id == data.reply_to_id,
                Message.conversation_id == conversation.id
            )
        )
        reply_to_message = reply_result.scalar_one_or_none()
        if not reply_to_message:
            raise HTTPException(status_code=404, detail="Reply message not found")
    
    message = Message(
        conversation_id=conversation.id,
        sender_id=sender_id,
        content=data.content,
        message_type=data.message_type,
        media_url=data.media_url,
        reply_to_id=data.reply_to_id
    )
    db.add(message)
    
    # Generate preview based on message type
    if data.message_type == 'image':
        preview = "📷 Photo"
    elif data.message_type == 'video':
        preview = "🎬 Video"
    elif data.message_type == 'voice_note':
        preview = "🎤 Voice message"
    elif data.message_type == 'gif':
        preview = "🎭 GIF"
    else:
        preview = data.content[:100] + "..." if len(data.content) > 100 else data.content
    
    conversation.last_message_preview = preview
    conversation.last_message_at = datetime.now(timezone.utc)
    
    notification = Notification(
        user_id=data.recipient_id,
        type='new_message',
        title=f"New message from {sender.full_name}",
        body=preview,
        data=json.dumps({
            "conversation_id": conversation.id,
            "sender_id": sender_id,
            "type": "new_message"
        })
    )
    db.add(notification)
    
    await db.commit()
    await db.refresh(message)
    
    # Send push notification via OneSignal (fire and forget)
    if onesignal_service:
        asyncio.create_task(
            onesignal_service.send_message_notification(
                recipient_id=data.recipient_id,
                sender_name=sender.full_name or "Someone",
                message_preview=preview,
                conversation_id=conversation.id
            )
        )
    
    return {
        "id": message.id,
        "conversation_id": conversation.id,
        "content": message.content,
        "message_type": message.message_type,
        "media_url": message.media_url,
        "reply_to_id": message.reply_to_id,
        "created_at": message.created_at.isoformat(),
        "is_new_conversation": is_new
    }

@router.get("/messages/conversations/{user_id}")
async def get_conversations(user_id: str, inbox_type: str = "primary", grom_zone: bool = False, db: AsyncSession = Depends(get_db)):
    # GROM SAFETY GATE: Check messaging permission first
    perm_check = await check_grom_messaging_permission(user_id, db, is_grom_channel=grom_zone)
    if not perm_check["allowed"]:
        # Return empty list instead of error for cleaner UX
        return []
    
    # Get current user's role
    user_result = await db.execute(select(Profile).where(Profile.id == user_id))
    current_user = user_result.scalar_one_or_none()
    current_user_role = current_user.role.value if current_user and current_user.role else 'Surfer'
    is_current_user_grom = current_user_role == 'Grom'
    # PRO LOUNGE: Only 'Pro' (Verified Pro Surfer) or 'God' has access - NOT Comp Surfer
    # Admin status alone does NOT grant Pro Lounge access - must have Pro or God role
    is_current_user_pro = current_user_role in ['Pro', 'God']
    is_current_user_business = current_user_role in ['Photographer', 'Approved Pro', 'Shop', 'Shaper', 'Surf School', 'Resort']
    
    result = await db.execute(
        select(Conversation)
        .where(
            or_(
                Conversation.participant_one_id == user_id,
                Conversation.participant_two_id == user_id
            )
        )
        .options(
            selectinload(Conversation.participant_one),
            selectinload(Conversation.participant_two),
            selectinload(Conversation.messages)
        )
        .order_by(Conversation.last_message_at.desc())
    )
    conversations = result.scalars().all()
    
    response = []
    for conv in conversations:
        is_participant_one = conv.participant_one_id == user_id
        my_status = conv.status_for_one if is_participant_one else conv.status_for_two
        other_user = conv.participant_two if is_participant_one else conv.participant_one
        
        if not other_user:
            continue
        
        other_role = other_user.role.value if other_user.role else 'Surfer'
        is_other_grom = other_role == 'Grom'
        
        # GROM ZONE FILTER: If grom_zone=true, only show Grom-to-Grom conversations
        if grom_zone:
            if not (is_current_user_grom and is_other_grom):
                continue  # Skip non-Grom conversations in Grom Zone
        elif is_current_user_grom:
            # In regular inbox, Groms should only see Grom conversations anyway
            if not is_other_grom:
                continue
            
        other_role = other_user.role.value if other_user.role else 'Surfer'
        # PRO LOUNGE: Only 'Pro' (Verified Pro Surfer) or 'God' - NOT Comp Surfer or Approved Pro
        # Admin status alone does NOT grant Pro Lounge access - must have Pro or God role
        is_other_pro = other_role in ['Pro', 'God']
        # Business roles route to Channel (includes Photographers)
        is_other_business = other_role in ['Photographer', 'Approved Pro', 'Shop', 'Shaper', 'Surf School', 'Resort']
        
        # Determine folder based on roles AND follow status
        folder = 'primary'  # Default
        
        # PRIORITY 1: REQUESTS - Messages from non-followers go to requests first
        # This takes precedence over channel/business routing
        if my_status == 'request':
            folder = 'requests'
        
        # PRIORITY 2: HIDDEN - Muted conversations
        elif my_status == 'hidden':
            folder = 'hidden'
        
        # PRIORITY 3: THE PRO LOUNGE - Pro-to-Pro communication (hidden from non-pros)
        elif is_current_user_pro and is_other_pro:
            folder = 'pro_lounge'
        
        # PRIORITY 4: THE CHANNEL - Business/Photographer communication
        # Note: Admin status alone does NOT route to channel - only explicit business roles do
        elif is_other_business or is_current_user_business:
            folder = 'channel'
        
        # PRIORITY 5: PRIMARY - Standard surfer-to-surfer (default)
        else:
            folder = 'primary'
        
        # Privacy: Hide Pro Lounge from non-pro users
        if folder == 'pro_lounge' and not is_current_user_pro:
            continue
        
        # Filter by requested folder
        if inbox_type != 'all' and folder != inbox_type:
            continue
        
        unread_count = sum(1 for m in conv.messages if not m.is_read and m.sender_id != user_id)
        
        # Get user-specific settings
        is_pinned = conv.is_pinned_for_one if is_participant_one else conv.is_pinned_for_two
        is_muted = conv.is_muted_for_one if is_participant_one else conv.is_muted_for_two
        is_manually_unread = conv.is_unread_for_one if is_participant_one else conv.is_unread_for_two
        
        # Get last activity by the OTHER user (their most recent message) for online dot
        other_user_msgs = [m for m in conv.messages if m.sender_id != user_id]
        other_user_last_active = max((m.created_at for m in other_user_msgs), default=None) if other_user_msgs else None
        
        response.append(ConversationResponse(
            id=conv.id,
            other_user_id=other_user.id if other_user else "",
            other_user_name=other_user.full_name if other_user else None,
            other_username=other_user.username if other_user else None,  # Include actual username
            other_user_avatar=other_user.avatar_url if other_user else None,
            other_user_role=other_role,
            other_user_updated_at=other_user.updated_at if other_user else None,
            other_user_last_active=other_user_last_active,
            last_message_preview=conv.last_message_preview,
            last_message_at=conv.last_message_at,
            unread_count=unread_count,
            is_request=(folder == 'requests'),
            folder=folder,
            is_pinned=is_pinned or False,
            is_muted=is_muted or False,
            is_manually_unread=is_manually_unread or False
        ))
    
    return response

@router.get("/messages/conversation/{conversation_id}")
async def get_conversation_messages(conversation_id: str, user_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Conversation)
        .where(Conversation.id == conversation_id)
        .options(
            selectinload(Conversation.participant_one),
            selectinload(Conversation.participant_two),
            selectinload(Conversation.messages).selectinload(Message.sender),
            selectinload(Conversation.messages).selectinload(Message.reply_to).selectinload(Message.sender)
        )
    )
    conversation = result.scalar_one_or_none()
    
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    if user_id not in [conversation.participant_one_id, conversation.participant_two_id]:
        raise HTTPException(status_code=403, detail="Not a participant in this conversation")
    
    for message in conversation.messages:
        if message.sender_id != user_id and not message.is_read:
            message.is_read = True
    await db.commit()
    
    is_participant_one = conversation.participant_one_id == user_id
    other_user = conversation.participant_two if is_participant_one else conversation.participant_one
    my_status = conversation.status_for_one if is_participant_one else conversation.status_for_two
    
    # Get all message IDs to fetch reactions
    message_ids = [m.id for m in conversation.messages]
    
    # Fetch all reactions for these messages
    reactions_result = await db.execute(
        select(MessageReaction)
        .where(MessageReaction.message_id.in_(message_ids))
        .options(selectinload(MessageReaction.user))
    )
    all_reactions = reactions_result.scalars().all()
    
    # Group reactions by message_id
    reactions_by_message = {}
    for r in all_reactions:
        if r.message_id not in reactions_by_message:
            reactions_by_message[r.message_id] = []
        reactions_by_message[r.message_id].append(MessageReactionData(
            emoji=r.emoji,
            user_id=r.user_id,
            user_name=r.user.full_name if r.user else None
        ))
    
    current_time = datetime.now(timezone.utc)
    expiration_cutoff = current_time - timedelta(hours=24)
    
    messages = []
    for m in sorted(conversation.messages, key=lambda x: x.created_at):
        # Discard expiring videos dynamically (handle both tz-aware and tz-naive datetimes)
        if m.message_type == 'ephemeral_video':
            msg_time = m.created_at.replace(tzinfo=timezone.utc) if m.created_at.tzinfo is None else m.created_at
            if msg_time < expiration_cutoff:
                continue
            
        # Build reply preview if this message is a reply
        reply_preview = None
        if m.reply_to:
            reply_preview = ReplyPreview(
                id=m.reply_to.id,
                content=(m.reply_to.content[:50] + "..." if m.reply_to.content and len(m.reply_to.content) > 50 else (m.reply_to.content or "[Media]")),
                sender_name=m.reply_to.sender.full_name if m.reply_to.sender else None
            )
        
        messages.append(MessageResponse(
            id=m.id,
            sender_id=m.sender_id,
            sender_name=m.sender.full_name if m.sender else None,
            sender_avatar=m.sender.avatar_url if m.sender else None,
            content=m.content,
            message_type=m.message_type,
            is_read=m.is_read,
            created_at=m.created_at,
            is_mine=(m.sender_id == user_id),
            media_url=getattr(m, 'media_url', None),
            media_thumbnail_url=getattr(m, 'media_thumbnail_url', None),
            voice_duration_seconds=getattr(m, 'voice_duration_seconds', None),
            reply_to=reply_preview,
            reactions=reactions_by_message.get(m.id, [])
        ))
    
    # Get user-specific settings
    is_pinned = conversation.is_pinned_for_one if is_participant_one else conversation.is_pinned_for_two
    is_muted = conversation.is_muted_for_one if is_participant_one else conversation.is_muted_for_two
    is_manually_unread = conversation.is_unread_for_one if is_participant_one else conversation.is_unread_for_two
    
    return ConversationDetailResponse(
        id=conversation.id,
        other_user_id=other_user.id if other_user else "",
        other_user_name=other_user.full_name if other_user else None,
        other_user_avatar=other_user.avatar_url if other_user else None,
        other_user_last_active=other_user.updated_at if other_user else None,
        messages=messages,
        is_request=(my_status == 'request'),
        is_pinned=is_pinned or False,
        is_muted=is_muted or False,
        is_manually_unread=is_manually_unread or False
    )

@router.post("/messages/accept/{conversation_id}")
async def accept_message_request(conversation_id: str, user_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Conversation).where(Conversation.id == conversation_id))
    conversation = result.scalar_one_or_none()
    
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    if conversation.participant_one_id == user_id:
        conversation.status_for_one = 'primary'
    elif conversation.participant_two_id == user_id:
        conversation.status_for_two = 'primary'
    else:
        raise HTTPException(status_code=403, detail="Not a participant")
    
    await db.commit()
    return {"message": "Message request accepted"}

@router.delete("/messages/conversation/{conversation_id}")
async def delete_conversation(conversation_id: str, user_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Conversation).where(Conversation.id == conversation_id))
    conversation = result.scalar_one_or_none()
    
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    if conversation.participant_one_id == user_id:
        conversation.status_for_one = 'hidden'
    elif conversation.participant_two_id == user_id:
        conversation.status_for_two = 'hidden'
    else:
        raise HTTPException(status_code=403, detail="Not a participant")
    
    await db.commit()
    return {"message": "Conversation hidden"}


@router.post("/messages/conversation/{conversation_id}/pin")
async def toggle_pin_conversation(conversation_id: str, user_id: str, db: AsyncSession = Depends(get_db)):
    """Toggle pin status for a conversation"""
    result = await db.execute(select(Conversation).where(Conversation.id == conversation_id))
    conversation = result.scalar_one_or_none()
    
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    if conversation.participant_one_id == user_id:
        conversation.is_pinned_for_one = not conversation.is_pinned_for_one
        is_pinned = conversation.is_pinned_for_one
    elif conversation.participant_two_id == user_id:
        conversation.is_pinned_for_two = not conversation.is_pinned_for_two
        is_pinned = conversation.is_pinned_for_two
    else:
        raise HTTPException(status_code=403, detail="Not a participant")
    
    await db.commit()
    return {"is_pinned": is_pinned, "message": "Pinned" if is_pinned else "Unpinned"}


@router.post("/messages/conversation/{conversation_id}/mute")
async def toggle_mute_conversation(conversation_id: str, user_id: str, db: AsyncSession = Depends(get_db)):
    """Toggle mute status for a conversation"""
    result = await db.execute(select(Conversation).where(Conversation.id == conversation_id))
    conversation = result.scalar_one_or_none()
    
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    if conversation.participant_one_id == user_id:
        conversation.is_muted_for_one = not conversation.is_muted_for_one
        is_muted = conversation.is_muted_for_one
    elif conversation.participant_two_id == user_id:
        conversation.is_muted_for_two = not conversation.is_muted_for_two
        is_muted = conversation.is_muted_for_two
    else:
        raise HTTPException(status_code=403, detail="Not a participant")
    
    await db.commit()
    return {"is_muted": is_muted, "message": "Muted" if is_muted else "Unmuted"}


@router.post("/messages/conversation/{conversation_id}/mark-unread")
async def toggle_unread_conversation(conversation_id: str, user_id: str, db: AsyncSession = Depends(get_db)):
    """Toggle mark as unread for a conversation"""
    result = await db.execute(select(Conversation).where(Conversation.id == conversation_id))
    conversation = result.scalar_one_or_none()
    
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    if conversation.participant_one_id == user_id:
        conversation.is_unread_for_one = not conversation.is_unread_for_one
        is_unread = conversation.is_unread_for_one
    elif conversation.participant_two_id == user_id:
        conversation.is_unread_for_two = not conversation.is_unread_for_two
        is_unread = conversation.is_unread_for_two
    else:
        raise HTTPException(status_code=403, detail="Not a participant")
    
    await db.commit()
    return {"is_unread": is_unread, "message": "Marked as unread" if is_unread else "Marked as read"}


@router.get("/messages/unread-counts/{user_id}")
async def get_unread_counts(user_id: str, db: AsyncSession = Depends(get_db)):
    """Get unread message counts for both primary inbox, requests, and Grom Zone"""
    from models import RoleEnum
    
    # Get user to check if Grom
    user_result = await db.execute(select(Profile).where(Profile.id == user_id))
    current_user = user_result.scalar_one_or_none()
    is_grom = current_user and current_user.role == RoleEnum.GROM
    
    result = await db.execute(
        select(Conversation)
        .where(
            or_(
                Conversation.participant_one_id == user_id,
                Conversation.participant_two_id == user_id
            )
        )
        .options(
            selectinload(Conversation.messages),
            selectinload(Conversation.participant_one),
            selectinload(Conversation.participant_two)
        )
    )
    conversations = result.scalars().all()
    
    primary_unread = 0
    request_unread = 0
    grom_zone_unread = 0
    
    for conv in conversations:
        is_participant_one = conv.participant_one_id == user_id
        my_status = conv.status_for_one if is_participant_one else conv.status_for_two
        other_user = conv.participant_two if is_participant_one else conv.participant_one
        
        if my_status == 'hidden':
            continue
        
        # Check if this is a Grom-to-Grom conversation
        other_is_grom = other_user and other_user.role == RoleEnum.GROM
        is_grom_conversation = is_grom and other_is_grom
            
        unread = sum(1 for m in conv.messages if not m.is_read and m.sender_id != user_id)
        
        if is_grom_conversation:
            grom_zone_unread += unread
        elif my_status == 'primary':
            primary_unread += unread
        elif my_status == 'request':
            request_unread += unread
    
    return {
        "primary": primary_unread,
        "requests": request_unread,
        "grom_zone": grom_zone_unread,
        "total": primary_unread + request_unread + grom_zone_unread
    }


@router.get("/messages/grom-zone/available-groms/{user_id}")
async def get_available_groms_to_message(user_id: str, db: AsyncSession = Depends(get_db)):
    """
    Get list of other Groms that this Grom can message.
    Only returns Groms who are linked and approved by their parents.
    """
    from models import RoleEnum
    
    # Verify user is a Grom
    user_result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = user_result.scalar_one_or_none()
    
    if not user or user.role != RoleEnum.GROM:
        raise HTTPException(status_code=403, detail="Only Groms can access Grom Zone")
    
    # Check if user has Grom Zone permission
    perm_check = await check_grom_messaging_permission(user_id, db, is_grom_channel=True)
    if not perm_check["allowed"]:
        raise HTTPException(status_code=403, detail="Grom Zone access not permitted")
    
    # Get all other Groms who are linked and approved
    result = await db.execute(
        select(Profile)
        .where(
            Profile.role == RoleEnum.GROM,
            Profile.id != user_id,
            Profile.parent_id.isnot(None),
            Profile.parent_link_approved.is_(True)
        )
        .order_by(Profile.full_name)
        .limit(50)
    )
    groms = result.scalars().all()
    
    return [
        {
            "id": g.id,
            "full_name": g.full_name,
            "avatar_url": g.avatar_url,
            "location": g.location
        }
        for g in groms
        # Additional check: their parental controls allow Grom Zone messaging
        if (g.parental_controls or {}).get('can_message_grom_channel', True)
    ]


@router.get("/messages/family/members/{user_id}")
async def get_family_members_to_message(user_id: str, db: AsyncSession = Depends(get_db)):
    """
    Get family members that a user can message.
    For Grom Parents: returns their linked Groms
    For Groms: returns their linked Parent
    """
    from models import RoleEnum
    
    # Get user profile
    user_result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = user_result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    family_members = []
    
    # Grom Parent - get linked Groms
    if is_grom_parent_eligible(user):
        result = await db.execute(
            select(Profile)
            .where(
                Profile.parent_id == user_id,
                Profile.role == RoleEnum.GROM,
                Profile.parent_link_approved.is_(True)
            )
            .order_by(Profile.full_name)
        )
        groms = result.scalars().all()
        family_members = [
            {
                "id": g.id,
                "full_name": g.full_name,
                "avatar_url": g.avatar_url,
                "role": "Grom",
                "relationship": "child"
            }
            for g in groms
        ]
    
    # Grom - get linked Parent
    elif user.role == RoleEnum.GROM and user.parent_id and user.parent_link_approved:
        parent_result = await db.execute(select(Profile).where(Profile.id == user.parent_id))
        parent = parent_result.scalar_one_or_none()
        if parent:
            family_members = [
                {
                    "id": parent.id,
                    "full_name": parent.full_name,
                    "avatar_url": parent.avatar_url,
                    "role": parent.role.value if parent.role else "Grom Parent",
                    "relationship": "parent"
                }
            ]
    
    return {"family_members": family_members}


@router.get("/messages/conversations/{user_id}/family")
async def get_family_conversations(
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Get conversations between user and their family members.
    For Grom Parents: conversations with their Groms
    For Groms: conversations with their Parent
    """
    from models import RoleEnum
    
    # Get user profile
    user_result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = user_result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Build list of family member IDs
    family_ids = []
    
    if is_grom_parent_eligible(user):
        # Get linked Groms
        groms_result = await db.execute(
            select(Profile.id)
            .where(
                Profile.parent_id == user_id,
                Profile.role == RoleEnum.GROM,
                Profile.parent_link_approved.is_(True)
            )
        )
        family_ids = [g[0] for g in groms_result.all()]
    
    elif user.role == RoleEnum.GROM and user.parent_id and user.parent_link_approved:
        family_ids = [user.parent_id]
    
    if not family_ids:
        return []
    
    # Get conversations with family members
    result = await db.execute(
        select(Conversation)
        .where(
            or_(
                and_(
                    Conversation.participant_one_id == user_id,
                    Conversation.participant_two_id.in_(family_ids)
                ),
                and_(
                    Conversation.participant_two_id == user_id,
                    Conversation.participant_one_id.in_(family_ids)
                )
            )
        )
        .options(
            selectinload(Conversation.participant_one),
            selectinload(Conversation.participant_two),
            selectinload(Conversation.messages)
        )
        .order_by(Conversation.last_message_at.desc())
    )
    conversations = result.scalars().all()
    
    # Build response
    response = []
    for conv in conversations:
        is_participant_one = conv.participant_one_id == user_id
        other_user = conv.participant_two if is_participant_one else conv.participant_one
        
        # Get last message
        last_message = None
        unread_count = 0
        if conv.messages:
            sorted_messages = sorted(conv.messages, key=lambda m: m.created_at, reverse=True)
            if sorted_messages:
                last_message = sorted_messages[0]
                unread_count = sum(1 for m in conv.messages if not m.is_read and m.sender_id != user_id)
        
        response.append({
            "id": conv.id,
            "other_user_id": other_user.id if other_user else None,
            "other_user_name": other_user.full_name if other_user else "Unknown",
            "other_user_avatar": other_user.avatar_url if other_user else None,
            "other_user_role": other_user.role.value if other_user and other_user.role else None,
            "other_user_updated_at": other_user.updated_at.isoformat() if other_user and other_user.updated_at else None,
            "last_message": last_message.content[:50] if last_message else None,
            "last_message_at": conv.last_message_at.isoformat() if conv.last_message_at else None,
            "unread_count": unread_count,
            "folder": "family"
        })
    
    return response


@router.post("/messages/start-conversation")
async def start_conversation(
    sender_id: str,
    recipient_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Start or get existing conversation with a user.
    Used when clicking "Message" on a profile.
    """
    # Validate both users exist
    sender_result = await db.execute(select(Profile).where(Profile.id == sender_id))
    sender = sender_result.scalar_one_or_none()
    if not sender:
        raise HTTPException(status_code=404, detail="Sender not found")
    
    recipient_result = await db.execute(select(Profile).where(Profile.id == recipient_id))
    recipient = recipient_result.scalar_one_or_none()
    if not recipient:
        raise HTTPException(status_code=404, detail="Recipient not found")
    
    if sender_id == recipient_id:
        raise HTTPException(status_code=400, detail="Cannot message yourself")
    
    # Get or create conversation
    conversation, is_new = await get_or_create_conversation(sender_id, recipient_id, db)
    
    # Unhide if previously hidden
    if conversation.participant_one_id == sender_id:
        if conversation.status_for_one == 'hidden':
            conversation.status_for_one = 'primary'
    else:
        if conversation.status_for_two == 'hidden':
            conversation.status_for_two = 'primary'
    
    await db.commit()
    await db.refresh(conversation)
    
    return {
        "conversation_id": conversation.id,
        "recipient_id": recipient_id,
        "recipient_name": recipient.full_name,
        "recipient_avatar": recipient.avatar_url,
        "is_new": is_new
    }


@router.post("/messages/decline/{conversation_id}")
async def decline_message_request(conversation_id: str, user_id: str, db: AsyncSession = Depends(get_db)):
    """Decline/hide a message request"""
    result = await db.execute(select(Conversation).where(Conversation.id == conversation_id))
    conversation = result.scalar_one_or_none()
    
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    if conversation.participant_one_id == user_id:
        conversation.status_for_one = 'hidden'
    elif conversation.participant_two_id == user_id:
        conversation.status_for_two = 'hidden'
    else:
        raise HTTPException(status_code=403, detail="Not a participant")
    
    await db.commit()
    return {"message": "Message request declined"}


# ===================== MESSAGE REACTIONS =====================

class ReactionRequest(BaseModel):
    emoji: str


@router.post("/messages/react/{message_id}")
async def add_reaction(message_id: str, user_id: str, data: ReactionRequest, db: AsyncSession = Depends(get_db)):
    """Add or toggle an emoji reaction on a message (Shaka 🤙, Wave 🌊, Heart ❤️, Fire 🔥)"""
    
    # Validate emoji is in allowed list
    if data.emoji not in ALLOWED_REACTIONS:
        raise HTTPException(
            status_code=400, 
            detail=f"Invalid reaction. Allowed: {', '.join(ALLOWED_REACTIONS)}"
        )
    
    # Verify message exists and get conversation for notification
    result = await db.execute(
        select(Message)
        .where(Message.id == message_id)
        .options(selectinload(Message.conversation), selectinload(Message.sender))
    )
    message = result.scalar_one_or_none()
    
    if not message:
        raise HTTPException(status_code=404, detail="Message not found")
    
    # Verify user is in the conversation
    conv = message.conversation
    if user_id not in [conv.participant_one_id, conv.participant_two_id]:
        raise HTTPException(status_code=403, detail="Not a participant in this conversation")
    
    # Check for existing reaction
    result = await db.execute(
        select(MessageReaction).where(
            MessageReaction.message_id == message_id,
            MessageReaction.user_id == user_id,
            MessageReaction.emoji == data.emoji
        )
    )
    existing = result.scalar_one_or_none()
    
    if existing:
        # Remove reaction (toggle off)
        await db.delete(existing)
        await db.commit()
        return {"action": "removed", "emoji": data.emoji}
    
    # Add new reaction
    reaction = MessageReaction(
        message_id=message_id,
        user_id=user_id,
        emoji=data.emoji
    )
    db.add(reaction)
    
    # Send notification to message sender (if not self-reacting)
    if message.sender_id != user_id:
        reactor_result = await db.execute(select(Profile).where(Profile.id == user_id))
        reactor = reactor_result.scalar_one_or_none()
        notification = Notification(
            user_id=message.sender_id,
            type='message_reaction',
            title=f"{reactor.full_name if reactor else 'Someone'} reacted {data.emoji}",
            body=f"Reacted to: {message.content[:50]}...",
            data=json.dumps({
                "conversation_id": conv.id,
                "message_id": message_id,
                "type": "message_reaction"
            })
        )
        db.add(notification)
    
    await db.commit()
    
    return {"action": "added", "reaction_id": reaction.id, "emoji": data.emoji}


@router.get("/messages/{message_id}/reactions")
async def get_reactions(message_id: str, db: AsyncSession = Depends(get_db)):
    """Get all reactions for a message"""
    from models import MessageReaction
    
    result = await db.execute(
        select(MessageReaction)
        .where(MessageReaction.message_id == message_id)
        .options(selectinload(MessageReaction.user))
    )
    reactions = result.scalars().all()
    
    return [{
        "id": r.id,
        "emoji": r.emoji,
        "user_id": r.user_id,
        "user_name": r.user.full_name if r.user else None
    } for r in reactions]


# ===================== TYPING INDICATORS =====================

class TypingRequest(BaseModel):
    is_typing: bool


@router.post("/messages/typing/{conversation_id}")
async def update_typing(conversation_id: str, user_id: str, data: TypingRequest, db: AsyncSession = Depends(get_db)):
    """Update typing indicator for a conversation"""
    from models import TypingIndicator
    
    result = await db.execute(
        select(TypingIndicator).where(
            TypingIndicator.conversation_id == conversation_id,
            TypingIndicator.user_id == user_id
        )
    )
    existing = result.scalar_one_or_none()
    
    if data.is_typing:
        if not existing:
            indicator = TypingIndicator(
                conversation_id=conversation_id,
                user_id=user_id
            )
            db.add(indicator)
        else:
            existing.started_at = datetime.now(timezone.utc)
    else:
        if existing:
            await db.delete(existing)
    
    await db.commit()
    return {"typing": data.is_typing}


@router.get("/messages/typing/{conversation_id}")
async def get_typing_users(conversation_id: str, user_id: str, db: AsyncSession = Depends(get_db)):
    """Get users currently typing in a conversation (last 10 seconds)"""
    from models import TypingIndicator
    
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=10)
    
    result = await db.execute(
        select(TypingIndicator, Profile)
        .join(Profile, Profile.id == TypingIndicator.user_id)
        .where(
            TypingIndicator.conversation_id == conversation_id,
            TypingIndicator.user_id != user_id,
            TypingIndicator.started_at >= cutoff
        )
    )
    indicators = result.all()
    
    return {
        "typing_users": [{
            "user_id": ind.user_id,
            "user_name": profile.full_name
        } for ind, profile in indicators]
    }


# ===================== VOICE NOTES =====================


@router.post("/messages/voice-note")
async def upload_voice_note(
    file: UploadFile = File(...),
    duration: int = Form(...),
    conversation_id: str = Form(...),
    sender_id: str = Form(...),
    db: AsyncSession = Depends(get_db)
):
    """Upload a voice note and create a message"""
    from models import VoiceNote
    
    # Verify conversation exists and sender is participant
    result = await db.execute(select(Conversation).where(Conversation.id == conversation_id))
    conversation = result.scalar_one_or_none()
    
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    if sender_id not in [conversation.participant_one_id, conversation.participant_two_id]:
        raise HTTPException(status_code=403, detail="Not a participant in this conversation")
    
    # Read file content
    file_content = await file.read()
    file_ext = file.filename.split('.')[-1] if '.' in file.filename else 'webm'
    storage_filename = f"voice_notes/{uuid.uuid4()}.{file_ext}"
    
    audio_url = None
    
    # Upload to Supabase Storage
    if SUPABASE_URL and SUPABASE_SERVICE_KEY:
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{SUPABASE_URL}/storage/v1/object/chat_media/{storage_filename}",
                    headers={
                        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
                        "Content-Type": file.content_type or "audio/webm"
                    },
                    content=file_content
                )
                
                if response.status_code not in [200, 201]:
                    logger.error(f"Supabase upload error: {response.text}")
                    raise HTTPException(status_code=500, detail="Failed to upload voice note")
                
                audio_url = f"{SUPABASE_URL}/storage/v1/object/public/chat_media/{storage_filename}"
        except Exception as e:
            logger.error(f"Supabase upload error: {e}")
            audio_url = f"/api/uploads/{storage_filename}"
    else:
        audio_url = f"/api/uploads/{storage_filename}"
    
    # Get recipient ID
    recipient_id = conversation.participant_two_id if conversation.participant_one_id == sender_id else conversation.participant_one_id
    
    # Create message with voice note metadata
    message = Message(
        conversation_id=conversation_id,
        sender_id=sender_id,
        content="🎤 Voice message",
        message_type="voice_note",
        media_url=audio_url,
        voice_duration_seconds=duration,
        is_read=False
    )
    db.add(message)
    
    # Update conversation
    conversation.last_message_at = datetime.now(timezone.utc)
    conversation.last_message_preview = "🎤 Voice message"
    
    # Send notification
    sender_result = await db.execute(select(Profile).where(Profile.id == sender_id))
    sender = sender_result.scalar_one_or_none()
    notification = Notification(
        user_id=recipient_id,
        type='new_message',
        title=f"Voice message from {sender.full_name if sender else 'Someone'}",
        body="🎤 Voice message",
        data=json.dumps({
            "conversation_id": conversation_id,
            "sender_id": sender_id,
            "type": "voice_note"
        })
    )
    db.add(notification)
    
    await db.commit()
    await db.refresh(message)
    
    # Send push notification via OneSignal
    try:
        from routes.push import notify_new_message
        await notify_new_message(
            recipient_id=recipient_id,
            sender_name=sender.full_name if sender else "Someone",
            preview="🎤 Voice message"
        )
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning(f"Push notification failed: {e}")
    
    return {
        "message_id": message.id,
        "audio_url": audio_url,
        "duration": duration,
        "created_at": message.created_at.isoformat()
    }


# ===================== MEDIA UPLOAD =====================

@router.post("/messages/media")
async def upload_message_media(
    file: UploadFile = File(...),
    sender_id: str = Form(...),
    recipient_id: str = Form(default=""),
    conversation_id: str = Form(default=""),
    caption: str = Form(default=""),
    reply_to_id: Optional[str] = Form(default=None),
    message_type_override: Optional[str] = Form(default=None),
    db: AsyncSession = Depends(get_db)
):
    """Upload photo/video media to a conversation"""
    
    # If starting a new chat via media upload, create the conversation first
    if not conversation_id and recipient_id:
        conversation, _ = await get_or_create_conversation(sender_id, recipient_id, db)
    else:
        # Verify conversation exists and sender is participant
        result = await db.execute(select(Conversation).where(Conversation.id == conversation_id))
        conversation = result.scalar_one_or_none()
        
        if not conversation:
            raise HTTPException(status_code=404, detail="Conversation not found")
        if sender_id not in [conversation.participant_one_id, conversation.participant_two_id]:
            raise HTTPException(status_code=403, detail="Not a participant in this conversation")
    
    # Determine media type from file or override
    content_type = file.content_type or ""
    if message_type_override == 'ephemeral_video':
        media_type = 'ephemeral_video'
        preview_text = "📹 Disappearing Video"
    elif content_type.startswith("image/"):
        media_type = "image"
        preview_text = "📷 Photo"
    elif content_type.startswith("video/"):
        media_type = "video"
        preview_text = "🎬 Video"
    else:
        raise HTTPException(status_code=400, detail="Invalid media type. Only images and videos allowed.")
    
    # Read file content
    file_content = await file.read()
    file_ext = file.filename.split('.')[-1] if '.' in file.filename else 'jpg'
    storage_filename = f"chat_media/{uuid.uuid4()}.{file_ext}"
    
    media_url = None
    
    # Upload to Supabase Storage
    if SUPABASE_URL and SUPABASE_SERVICE_KEY:
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{SUPABASE_URL}/storage/v1/object/chat_media/{storage_filename}",
                    headers={
                        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
                        "Content-Type": content_type
                    },
                    content=file_content
                )
                
                if response.status_code not in [200, 201]:
                    logger.error(f"Supabase upload error: {response.text}")
                    raise HTTPException(status_code=500, detail="Failed to upload media")
                
                media_url = f"{SUPABASE_URL}/storage/v1/object/public/chat_media/{storage_filename}"
        except Exception as e:
            logger.error(f"Supabase upload error: {e}")
            # Fall back to local storage
            from pathlib import Path
            UPLOAD_DIR = Path(__file__).parent.parent / "uploads"
            local_path = UPLOAD_DIR / storage_filename
            local_path.parent.mkdir(parents=True, exist_ok=True)
            with open(local_path, 'wb') as f:
                f.write(file_content)
            media_url = f"/api/uploads/{storage_filename}"
    else:
        # Save to local storage
        from pathlib import Path
        UPLOAD_DIR = Path(__file__).parent.parent / "uploads"
        local_path = UPLOAD_DIR / storage_filename
        local_path.parent.mkdir(parents=True, exist_ok=True)
        with open(local_path, 'wb') as f:
            f.write(file_content)
        media_url = f"/api/uploads/{storage_filename}"
    
    # Get recipient ID
    recipient_id = conversation.participant_two_id if conversation.participant_one_id == sender_id else conversation.participant_one_id
    
    # Create message
    message = Message(
        conversation_id=conversation_id,
        sender_id=sender_id,
        content=caption or preview_text,
        message_type=media_type,
        media_url=media_url,
        reply_to_id=reply_to_id,
        is_read=False
    )
    db.add(message)
    
    # Update conversation
    conversation.last_message_at = datetime.now(timezone.utc)
    conversation.last_message_preview = preview_text
    
    # Send notification
    sender_result = await db.execute(select(Profile).where(Profile.id == sender_id))
    sender = sender_result.scalar_one_or_none()
    notification = Notification(
        user_id=recipient_id,
        type='new_message',
        title=f"{preview_text} from {sender.full_name if sender else 'Someone'}",
        body=caption or preview_text,
        data=json.dumps({
            "conversation_id": conversation_id,
            "sender_id": sender_id,
            "type": media_type
        })
    )
    db.add(notification)
    
    await db.commit()
    await db.refresh(message)
    
    # Send push notification via OneSignal
    try:
        from routes.push import notify_new_message
        await notify_new_message(
            recipient_id=recipient_id,
            sender_name=sender.full_name if sender else "Someone",
            preview=preview_text
        )
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning(f"Push notification failed: {e}")
    
    return {
        "message_id": message.id,
        "media_url": media_url,
        "media_type": media_type,
        "created_at": message.created_at.isoformat()
    }


@router.post("/messages/cleanup-duplicates")
async def cleanup_duplicate_conversations(db: AsyncSession = Depends(get_db)):
    """
    Admin endpoint to cleanup all duplicate conversations.
    Merges messages from duplicates into the oldest conversation.
    """
    import logging
    from sqlalchemy import text
    logger = logging.getLogger(__name__)
    
    # Find all unique participant pairs and their conversation counts
    result = await db.execute(
        text("""
            SELECT 
                LEAST(participant_one_id, participant_two_id) as user_a,
                GREATEST(participant_one_id, participant_two_id) as user_b,
                COUNT(*) as conv_count,
                array_agg(id ORDER BY created_at ASC) as conv_ids
            FROM conversations
            GROUP BY user_a, user_b
            HAVING COUNT(*) > 1
        """)
    )
    duplicates = result.fetchall()
    
    merged_count = 0
    deleted_count = 0
    
    for row in duplicates:
        user_a, user_b, count, conv_ids = row
        target_id = conv_ids[0]  # Oldest conversation
        duplicate_ids = conv_ids[1:]  # All others
        
        logger.info(f"Merging {count - 1} duplicate conversations for users {user_a} <-> {user_b}")
        
        for dup_id in duplicate_ids:
            # Move messages
            await db.execute(
                text("UPDATE messages SET conversation_id = :target_id WHERE conversation_id = :dup_id"),
                {"target_id": target_id, "dup_id": dup_id}
            )
            
            # Delete duplicate conversation
            await db.execute(
                text("DELETE FROM conversations WHERE id = :dup_id"),
                {"dup_id": dup_id}
            )
            
            deleted_count += 1
        
        merged_count += 1
    
    await db.commit()
    
    return {
        "status": "success",
        "message": f"Cleaned up {deleted_count} duplicate conversations, merged into {merged_count} unique threads"
    }


@router.get("/messages/conversation-count/{user_id}")
async def get_conversation_count(user_id: str, db: AsyncSession = Depends(get_db)):
    """Debug endpoint to check for duplicate conversations for a user"""
    from sqlalchemy import text
    
    result = await db.execute(
        text("""
            SELECT 
                CASE 
                    WHEN participant_one_id = :user_id THEN participant_two_id
                    ELSE participant_one_id
                END as other_user_id,
                COUNT(*) as conv_count
            FROM conversations
            WHERE participant_one_id = :user_id OR participant_two_id = :user_id
            GROUP BY other_user_id
            HAVING COUNT(*) > 1
        """),
        {"user_id": user_id}
    )
    duplicates = result.fetchall()
    
    return {
        "user_id": user_id,
        "duplicate_conversations": [
            {"other_user_id": row[0], "count": row[1]}
            for row in duplicates
        ]
    }

