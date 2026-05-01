"""Messages features — reactions, typing indicators, voice notes, media upload, cleanup."""
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

