"""
Crew Chat Media — image, voice, and file upload endpoints + quick actions.

Extracted from crew_chat.py (v86) to keep each module under 800 LOC.
"""
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional
import uuid
import logging

from database import get_db
from models import Profile, CrewChatMessage
from core.security import get_current_user_id
from services.private_media import delivery_url_for_media, upload_private_media

from .crew_chat import verify_chat_access, crew_chat_manager

logger = logging.getLogger(__name__)

router = APIRouter()


# ============================================================
# MEDIA UPLOAD CONFIG
# ============================================================

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


async def _persist_crew_chat_media(booking_id: str, filename: str, content: bytes, content_type: str) -> tuple[str, str]:
    """Persist an opaque reference and mint a one-hour URL only for the response."""
    media_url = await upload_private_media(
        bucket="crew_chat",
        object_key=f"{booking_id}/{filename}",
        content=content,
        content_type=content_type or "application/octet-stream",
    )
    if media_url is None:
        raise HTTPException(status_code=503, detail="Private media storage is temporarily unavailable")
    delivery_url = await delivery_url_for_media(media_url)
    if not delivery_url:
        raise HTTPException(status_code=503, detail="Private media delivery is temporarily unavailable")
    return media_url, delivery_url

# ============================================================
# MEDIA UPLOAD ENDPOINTS
# ============================================================

@router.post("/crew-chat/{booking_id}/upload-image")
async def upload_crew_chat_image(
    booking_id: str,
    user_id: str = Form(...),
    caption: str = Form(""),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user_id: str = Depends(get_current_user_id),
):
    """
    Upload an image to crew chat.
    Creates a message with the image attached.
    """
    if user_id != current_user_id:
        raise HTTPException(status_code=403, detail="Cannot upload media for another user")
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
    
    media_url, delivery_url = await _persist_crew_chat_media(
        booking_id, filename, content, file.content_type or "application/octet-stream"
    )
    
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
            "media_url": delivery_url,
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
        "media_url": delivery_url
    }


@router.post("/crew-chat/{booking_id}/upload-voice")
async def upload_crew_chat_voice(
    booking_id: str,
    user_id: str = Form(...),
    duration: int = Form(...),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user_id: str = Depends(get_current_user_id),
):
    """
    Upload a voice note to crew chat.
    Max duration: 30 seconds.
    """
    if user_id != current_user_id:
        raise HTTPException(status_code=403, detail="Cannot upload media for another user")
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
    
    media_url, delivery_url = await _persist_crew_chat_media(
        booking_id, filename, content, file.content_type or "application/octet-stream"
    )
    
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
            "media_url": delivery_url,
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
        "media_url": delivery_url,
        "duration": duration
    }


@router.post("/crew-chat/{booking_id}/upload-file")
async def upload_crew_chat_file(
    booking_id: str,
    user_id: str = Form(...),
    caption: str = Form(""),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user_id: str = Depends(get_current_user_id),
):
    """
    Upload a file (document, PDF, etc.) to crew chat.
    Supports: PDF, Word, Excel, PowerPoint, TXT, CSV, ZIP, images
    Max size: 25MB
    """
    if user_id != current_user_id:
        raise HTTPException(status_code=403, detail="Cannot upload media for another user")
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
    
    media_url, delivery_url = await _persist_crew_chat_media(
        booking_id, filename, content, file.content_type or "application/octet-stream"
    )
    file_size = len(content)
    file_size_display = f"{file_size / 1024:.1f}KB" if file_size < 1024*1024 else f"{file_size / (1024*1024):.1f}MB"
    
    # Get sender profile
    sender_result = await db.execute(select(Profile).where(Profile.id == user_id))
    sender = sender_result.scalar_one_or_none()
    
    # Create message with file metadata
    message_content = caption if caption else f"\U0001f4ce {original_name}"
    message = CrewChatMessage(
        booking_id=booking_id,
        sender_id=user_id,
        content=message_content,
        message_type="file",
        media_url=media_url,
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
            "media_url": delivery_url,
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
        "media_url": delivery_url,
        "file_name": original_name,
        "file_size": file_size_display,
        "file_type": ext
    }


# ============================================================
# QUICK ACTIONS - PRE-SET MESSAGES
# ============================================================

QUICK_ACTIONS = [
    {"id": "omw", "text": "On my way! \U0001f3c4", "category": "status"},
    {"id": "late", "text": "Running 5 mins late", "category": "status"},
    {"id": "arrived", "text": "Just arrived at the spot", "category": "status"},
    {"id": "pumping", "text": "Waves are pumping! \U0001f30a", "category": "conditions"},
    {"id": "checking", "text": "Checking conditions now", "category": "conditions"},
    {"id": "glassy", "text": "It's glassy out here! \U0001f525", "category": "conditions"},
    {"id": "choppy", "text": "Getting a bit choppy", "category": "conditions"},
    {"id": "gear", "text": "Bringing extra gear", "category": "logistics"},
    {"id": "board", "text": "Got the boards loaded", "category": "logistics"},
    {"id": "wax", "text": "Anyone need wax?", "category": "logistics"},
    {"id": "directions", "text": "Need directions to the spot", "category": "logistics"},
    {"id": "ready", "text": "Ready when you are! \U0001f919", "category": "status"},
    {"id": "stoked", "text": "So stoked for this session!", "category": "vibes"},
    {"id": "thanks", "text": "Thanks for organizing! \U0001f64f", "category": "vibes"},
]


@router.get("/crew-chat/quick-actions")
async def get_quick_actions():
    """Get list of pre-set quick action messages"""
    return {
        "quick_actions": QUICK_ACTIONS,
        "categories": ["status", "conditions", "logistics", "vibes"]
    }
