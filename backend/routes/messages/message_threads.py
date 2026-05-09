"""
messages/message_threads.py — Grom Zone, family threads, start/decline conversations.

Extracted from conversations.py (v90) to comply with <800 LOC governance.
Contains: grom-zone endpoints, family conversations, start-conversation, decline
"""
from fastapi import Depends, HTTPException, APIRouter
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from database import get_db
from datetime import datetime, timezone
import json
from models import Conversation, Message, Notification, Profile, RoleEnum
from utils.grom_parent import is_grom_parent_eligible

from .schemas import (
    check_grom_messaging_permission,
    get_or_create_conversation,
    onesignal_service,
)

router = APIRouter()


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
        select(Profile).where(
            Profile.role == RoleEnum.GROM,
            Profile.id != user_id,
            Profile.parent_id.isnot(None),
            Profile.parent_link_approved.is_(True)
        )
    )
    groms = result.scalars().all()
    
    return [{
        "id": g.id,
        "full_name": g.full_name,
        "username": g.username,
        "avatar_url": g.avatar_url,
        "age": g.age
    } for g in groms]


@router.get("/messages/grom-zone/family-members/{user_id}")
async def get_family_members(user_id: str, db: AsyncSession = Depends(get_db)):
    """
    Get family members (Parent or Groms) linked to the given user.
    """
    from models import RoleEnum
    
    user_result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = user_result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    family_members = []
    
    if is_grom_parent_eligible(user):
        # Get linked Groms
        groms_result = await db.execute(
            select(Profile).where(
                Profile.parent_id == user_id,
                Profile.role == RoleEnum.GROM,
                Profile.parent_link_approved.is_(True)
            )
        )
        groms = groms_result.scalars().all()
        for g in groms:
            family_members.append({
                "id": g.id,
                "full_name": g.full_name,
                "avatar_url": g.avatar_url,
                "role": g.role.value if g.role else "Grom",
                "relationship": "child"
            })
    
    elif user.role == RoleEnum.GROM and user.parent_id and user.parent_link_approved:
        # Get parent
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
