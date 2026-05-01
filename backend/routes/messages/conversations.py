"""Messages conversations — thread management, sending, listing, and actions."""
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
    is_current_user_business = current_user_role in ['Photographer', 'Approved Pro', 'Hobbyist', 'Shop', 'Shaper', 'Surf School', 'Resort']
    
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
        is_other_business = other_role in ['Photographer', 'Approved Pro', 'Hobbyist', 'Shop', 'Shaper', 'Surf School', 'Resort']
        
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
        
        # PRIORITY 4: THE CHANNEL - Business/Photographer ↔ Surfer communication
        # Only routes to Channel when ONE side is a business role and the OTHER is not.
        # Photographer-to-photographer (same-role) stays in Primary — that's colleagues chatting.
        elif (is_current_user_business and not is_other_business) or (is_other_business and not is_current_user_business):
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


