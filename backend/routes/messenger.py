"""
Messenger 2.0 Routes
Advanced messaging with reactions, threading, voice notes, and real-time features
"""

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, func, desc
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
import os

from database import get_db
from models import (
    Profile, Conversation, Message, MessageReaction, 
    MessageReadReceipt, TypingIndicator, ConversationParticipant,
    VoiceNote, GalleryItem, LiveSession
)

router = APIRouter(prefix="/messages", tags=["messages"])


# ===================== PYDANTIC SCHEMAS =====================

class CreateConversation(BaseModel):
    participant_ids: List[str]  # For 1:1, just one ID. For group, multiple
    name: Optional[str] = None  # For group chats
    is_group: bool = False


class SendMessage(BaseModel):
    content: Optional[str] = None
    message_type: str = "text"  # text, image, video, voice_note, gallery_share, session_share
    media_url: Optional[str] = None
    gallery_item_id: Optional[str] = None
    live_session_id: Optional[str] = None
    reply_to_id: Optional[str] = None


class AddReaction(BaseModel):
    emoji: str


class TypingStatus(BaseModel):
    is_typing: bool


# ===================== CONVERSATION ROUTES =====================

@router.post("/conversations")
async def create_or_get_conversation(
    data: CreateConversation,
    creator_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Create a new conversation or get existing 1:1 conversation"""
    
    if not data.is_group and len(data.participant_ids) == 1:
        # 1:1 conversation - check if exists
        other_id = data.participant_ids[0]
        
        result = await db.execute(
            select(Conversation).where(
                or_(
                    and_(
                        Conversation.participant_one_id == creator_id,
                        Conversation.participant_two_id == other_id
                    ),
                    and_(
                        Conversation.participant_one_id == other_id,
                        Conversation.participant_two_id == creator_id
                    )
                )
            )
        )
        existing = result.scalar_one_or_none()
        
        if existing:
            return {"conversation_id": existing.id, "is_new": False}
        
        # Create new 1:1 conversation
        conversation = Conversation(
            participant_one_id=creator_id,
            participant_two_id=other_id
        )
        db.add(conversation)
        await db.commit()
        
        return {"conversation_id": conversation.id, "is_new": True}
    
    else:
        # Group conversation - NOTE: Requires schema update for group support
        # For now, return error
        raise HTTPException(
            status_code=501, 
            detail="Group conversations require schema migration. Use 1:1 conversations for now."
        )


@router.get("/conversations/{user_id}")
async def get_conversations(
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get user's conversations (inbox)"""
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
            selectinload(Conversation.participant_two)
        )
        .order_by(desc(Conversation.last_message_at))
    )
    conversations = result.scalars().all()
    
    inbox = []
    for conv in conversations:
        # Get the other participant
        other = conv.participant_two if conv.participant_one_id == user_id else conv.participant_one
        
        # Count unread messages
        unread_result = await db.execute(
            select(func.count(Message.id))
            .where(
                Message.conversation_id == conv.id,
                Message.sender_id != user_id,
                Message.is_read == False
            )
        )
        unread_count = unread_result.scalar() or 0
        
        inbox.append({
            "id": conv.id,
            "other_user": {
                "id": other.id,
                "full_name": other.full_name,
                "avatar_url": other.avatar_url,
                "role": other.role
            },
            "last_message": conv.last_message_preview,
            "last_message_at": conv.last_message_at.isoformat() if conv.last_message_at else None,
            "unread_count": unread_count,
            "status": conv.status_for_one if conv.participant_one_id == user_id else conv.status_for_two
        })
    
    return {"conversations": inbox}


@router.get("/conversation/{conversation_id}")
async def get_conversation_messages(
    conversation_id: str,
    user_id: str,
    limit: int = 50,
    before_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """Get messages in a conversation with pagination"""
    # Verify user is participant
    result = await db.execute(
        select(Conversation).where(Conversation.id == conversation_id)
    )
    conv = result.scalar_one_or_none()
    
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    if user_id not in [conv.participant_one_id, conv.participant_two_id]:
        raise HTTPException(status_code=403, detail="Not a participant in this conversation")
    
    # Build query
    query = select(Message).where(
        Message.conversation_id == conversation_id,
        Message.is_deleted == False
    )
    
    if before_id:
        # Get the timestamp of the before_id message for pagination
        before_result = await db.execute(
            select(Message.created_at).where(Message.id == before_id)
        )
        before_time = before_result.scalar_one_or_none()
        if before_time:
            query = query.where(Message.created_at < before_time)
    
    query = query.options(
        selectinload(Message.sender),
        selectinload(Message.reply_to)
    ).order_by(desc(Message.created_at)).limit(limit)
    
    result = await db.execute(query)
    messages = result.scalars().all()
    
    # Get reactions for these messages
    message_ids = [m.id for m in messages]
    reactions_result = await db.execute(
        select(MessageReaction)
        .where(MessageReaction.message_id.in_(message_ids))
        .options(selectinload(MessageReaction.user))
    )
    all_reactions = reactions_result.scalars().all()
    
    # Group reactions by message
    reactions_by_message = {}
    for r in all_reactions:
        if r.message_id not in reactions_by_message:
            reactions_by_message[r.message_id] = []
        reactions_by_message[r.message_id].append({
            "emoji": r.emoji,
            "user_id": r.user_id,
            "user_name": r.user.full_name if r.user else None
        })
    
    # Mark messages as read
    for msg in messages:
        if msg.sender_id != user_id and not msg.is_read:
            msg.is_read = True
    await db.commit()
    
    return {
        "messages": [{
            "id": m.id,
            "sender": {
                "id": m.sender.id,
                "full_name": m.sender.full_name,
                "avatar_url": m.sender.avatar_url
            } if m.sender else None,
            "content": m.content,
            "message_type": m.message_type,
            "is_read": m.is_read,
            "created_at": m.created_at.isoformat(),
            "reply_to": {
                "id": m.reply_to.id,
                "content": m.reply_to.content[:50] + "..." if m.reply_to and len(m.reply_to.content or "") > 50 else (m.reply_to.content if m.reply_to else None),
                "sender_name": m.reply_to.sender.full_name if m.reply_to and m.reply_to.sender else None
            } if m.reply_to else None,
            "reactions": reactions_by_message.get(m.id, [])
        } for m in reversed(messages)]  # Reverse to get chronological order
    }


# ===================== MESSAGE ROUTES =====================

@router.post("/send/{conversation_id}")
async def send_message(
    conversation_id: str,
    sender_id: str,
    message_data: SendMessage,
    db: AsyncSession = Depends(get_db)
):
    """Send a message in a conversation"""
    # Verify conversation exists and sender is participant
    result = await db.execute(
        select(Conversation).where(Conversation.id == conversation_id)
    )
    conv = result.scalar_one_or_none()
    
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    if sender_id not in [conv.participant_one_id, conv.participant_two_id]:
        raise HTTPException(status_code=403, detail="Not a participant in this conversation")
    
    # Create message
    message = Message(
        conversation_id=conversation_id,
        sender_id=sender_id,
        content=message_data.content,
        message_type=message_data.message_type,
        reply_to_id=message_data.reply_to_id
    )
    
    db.add(message)
    
    # Update conversation's last message
    conv.last_message_at = datetime.now(timezone.utc)
    conv.last_message_preview = (message_data.content or "")[:200] if message_data.content else f"[{message_data.message_type}]"
    
    # Clear typing indicator for this user
    await db.execute(
        select(TypingIndicator).where(
            TypingIndicator.conversation_id == conversation_id,
            TypingIndicator.user_id == sender_id
        )
    )
    
    await db.commit()
    
    return {
        "message_id": message.id,
        "created_at": message.created_at.isoformat()
    }


@router.post("/share/gallery/{conversation_id}")
async def share_gallery_item(
    conversation_id: str,
    sender_id: str,
    gallery_item_id: str,
    caption: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """Share a gallery item to a conversation"""
    # Verify gallery item exists
    result = await db.execute(
        select(GalleryItem).where(GalleryItem.id == gallery_item_id)
    )
    item = result.scalar_one_or_none()
    
    if not item:
        raise HTTPException(status_code=404, detail="Gallery item not found")
    
    # Create message with gallery share
    message = Message(
        conversation_id=conversation_id,
        sender_id=sender_id,
        content=caption or f"Shared a photo from {item.title or 'gallery'}",
        message_type="gallery_share"
    )
    
    db.add(message)
    
    # Update conversation
    result = await db.execute(
        select(Conversation).where(Conversation.id == conversation_id)
    )
    conv = result.scalar_one_or_none()
    if conv:
        conv.last_message_at = datetime.now(timezone.utc)
        conv.last_message_preview = "[Photo shared]"
    
    await db.commit()
    
    return {"message_id": message.id}


@router.post("/share/session/{conversation_id}")
async def share_live_session(
    conversation_id: str,
    sender_id: str,
    session_id: str,
    caption: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """Share a live session link to a conversation"""
    # Verify session exists
    result = await db.execute(
        select(LiveSession).where(LiveSession.id == session_id)
    )
    session = result.scalar_one_or_none()
    
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    # Create message with session share
    message = Message(
        conversation_id=conversation_id,
        sender_id=sender_id,
        content=caption or f"Shared a live session",
        message_type="session_invite"
    )
    
    db.add(message)
    
    # Update conversation
    result = await db.execute(
        select(Conversation).where(Conversation.id == conversation_id)
    )
    conv = result.scalar_one_or_none()
    if conv:
        conv.last_message_at = datetime.now(timezone.utc)
        conv.last_message_preview = "[Live session shared]"
    
    await db.commit()
    
    return {"message_id": message.id}


# ===================== REACTIONS ROUTES =====================

@router.post("/react/{message_id}")
async def add_reaction(
    message_id: str,
    user_id: str,
    reaction_data: AddReaction,
    db: AsyncSession = Depends(get_db)
):
    """Add an emoji reaction to a message"""
    # Verify message exists
    result = await db.execute(
        select(Message).where(Message.id == message_id)
    )
    message = result.scalar_one_or_none()
    
    if not message:
        raise HTTPException(status_code=404, detail="Message not found")
    
    # Check for existing reaction (same user, same emoji)
    result = await db.execute(
        select(MessageReaction).where(
            MessageReaction.message_id == message_id,
            MessageReaction.user_id == user_id,
            MessageReaction.emoji == reaction_data.emoji
        )
    )
    existing = result.scalar_one_or_none()
    
    if existing:
        # Remove reaction (toggle off)
        await db.delete(existing)
        await db.commit()
        return {"action": "removed"}
    
    # Add new reaction
    reaction = MessageReaction(
        message_id=message_id,
        user_id=user_id,
        emoji=reaction_data.emoji
    )
    db.add(reaction)
    await db.commit()
    
    return {"action": "added", "reaction_id": reaction.id}


# ===================== READ RECEIPTS ROUTES =====================

@router.post("/read/{conversation_id}")
async def mark_messages_read(
    conversation_id: str,
    user_id: str,
    up_to_message_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """Mark messages as read up to a certain message"""
    query = select(Message).where(
        Message.conversation_id == conversation_id,
        Message.sender_id != user_id,
        Message.is_read == False
    )
    
    if up_to_message_id:
        # Get timestamp of the message
        result = await db.execute(
            select(Message.created_at).where(Message.id == up_to_message_id)
        )
        up_to_time = result.scalar_one_or_none()
        if up_to_time:
            query = query.where(Message.created_at <= up_to_time)
    
    result = await db.execute(query)
    messages = result.scalars().all()
    
    for msg in messages:
        msg.is_read = True
        
        # Create read receipt
        receipt = MessageReadReceipt(
            message_id=msg.id,
            user_id=user_id
        )
        db.add(receipt)
    
    await db.commit()
    
    return {"marked_read": len(messages)}


# ===================== TYPING INDICATOR ROUTES =====================

@router.post("/typing/{conversation_id}")
async def update_typing_status(
    conversation_id: str,
    user_id: str,
    status: TypingStatus,
    db: AsyncSession = Depends(get_db)
):
    """Update typing indicator for a conversation"""
    result = await db.execute(
        select(TypingIndicator).where(
            TypingIndicator.conversation_id == conversation_id,
            TypingIndicator.user_id == user_id
        )
    )
    existing = result.scalar_one_or_none()
    
    if status.is_typing:
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
    
    return {"typing": status.is_typing}


@router.get("/typing/{conversation_id}")
async def get_typing_users(
    conversation_id: str,
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get users currently typing in a conversation"""
    # Only show typing indicators from last 10 seconds
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=10)
    
    result = await db.execute(
        select(TypingIndicator)
        .where(
            TypingIndicator.conversation_id == conversation_id,
            TypingIndicator.user_id != user_id,
            TypingIndicator.started_at >= cutoff
        )
        .options(selectinload(TypingIndicator.user))
    )
    indicators = result.scalars().all()
    
    return {
        "typing_users": [{
            "user_id": ind.user_id,
            "user_name": ind.user.full_name if ind.user else None
        } for ind in indicators]
    }


# Import timedelta at top
from datetime import timedelta
