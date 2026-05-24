# File: backend/routes/uploads/comments.py
from fastapi import Depends, File, Form, HTTPException, UploadFile, APIRouter
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db
import uuid
import os
import shutil
import asyncio
import logging
from .core import (
    UPLOAD_DIR, MAX_IMAGE_SIZE, MAX_FILE_SIZE, STREAM_CHUNK_SIZE,
    SUPABASE_STORAGE_AVAILABLE, ALLOWED_VIDEO_TYPES, ALLOWED_IMAGE_TYPES,
    upload_to_supabase_storage, get_file_extension,
    _cached_file_response,
)
from utils.video_processor import (
    get_video_info, process_video_from_path, generate_video_thumbnail
)

router = APIRouter()
logger = logging.getLogger(__name__)

# ============================================================
# COMMENT UPLOAD - Photo, video, or GIF comments (60 sec max video)
# ============================================================
MAX_COMMENT_VIDEO_DURATION = 60  # seconds

@router.post("/upload/comment")
async def upload_comment_media(
    file: UploadFile = File(...),
    user_id: str = Form(...),
    db: AsyncSession = Depends(get_db)
):
    """
    Upload media for a comment (photo, video, or gif)
    Videos are restricted to 60 seconds or less.
    """
    import gc

    # Validate file type
    is_video = file.content_type in ALLOWED_VIDEO_TYPES
    is_image = file.content_type in ALLOWED_IMAGE_TYPES

    if not is_video and not is_image:
        # Fallback: infer from filename
        ext = (file.filename or '').rsplit('.', 1)[-1].lower() if file.filename else ''
        VIDEO_EXTS = {'mp4', 'mov', 'webm', 'mpeg', 'm4v', '3gp', '3gpp', 'avi', 'mkv'}
        IMAGE_EXTS = {'jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif'}
        if ext in VIDEO_EXTS:
            is_video = True
        elif ext in IMAGE_EXTS:
            is_image = True
        else:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid file type '{file.content_type}'. Allowed: JPEG, PNG, WebP, GIF, MP4, MOV, WebM"
            )

    # Create comments directory
    comments_dir = UPLOAD_DIR / "comments"
    comments_dir.mkdir(exist_ok=True)

    if is_video:
        # 1. Stream video to disk
        temp_filename = f"temp_{uuid.uuid4()}.mp4"
        temp_path = comments_dir / temp_filename
        file_size = 0

        try:
            with open(temp_path, "wb") as out:
                while True:
                    chunk = await file.read(STREAM_CHUNK_SIZE)
                    if not chunk:
                        break
                    file_size += len(chunk)
                    if file_size > MAX_FILE_SIZE:
                        out.close()
                        os.remove(temp_path)
                        raise HTTPException(
                            status_code=400,
                            detail=f"File too large. Maximum size is {MAX_FILE_SIZE // (1024*1024)}MB"
                        )
                    out.write(chunk)
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Comment video streaming write failed: {e}")
            if temp_path.exists():
                os.remove(temp_path)
            raise HTTPException(status_code=500, detail="Upload write failed")
        finally:
            await file.close()
            gc.collect()

        # 2. Get video info and validate duration
        video_info = await asyncio.to_thread(get_video_info, str(temp_path))
        if video_info and video_info.get('duration', 0) > 60.9:
            os.remove(temp_path)
            raise HTTPException(
                status_code=400,
                detail=f"Comment videos must be 60 seconds or less. Your video is {video_info['duration']:.1f} seconds."
            )

        # 3. Process video from disk path
        success, error, result = await asyncio.to_thread(
            process_video_from_path,
            temp_path,
            file.filename or "video.mp4",
            comments_dir,
            user_subscription='free',
            upload_type='feed'
        )

        if not success:
            logger.warning(f"Comment video processing failed ({error}), keeping raw video")
            raw_filename = f"{uuid.uuid4()}.mp4"
            raw_path = comments_dir / raw_filename
            if temp_path.exists():
                shutil.move(str(temp_path), str(raw_path))
            else:
                raise HTTPException(status_code=500, detail="Video processing failed and source lost")
            result = {
                'filename': raw_filename,
                'original_width': 0,
                'original_height': 0,
                'final_width': 0,
                'final_height': 0,
                'duration': video_info.get('duration', 0) if video_info else 0,
                'was_transcoded': False,
                'size': file_size,
            }

        gc.collect()

        video_path = comments_dir / result['filename']
        thumbnail_filename = f"{result['filename'].rsplit('.', 1)[0]}_thumb.jpg"
        thumbnail_path = comments_dir / thumbnail_filename

        # Generate thumbnail
        thumbnail_url = None
        try:
            thumb_success, _ = await asyncio.to_thread(
                generate_video_thumbnail,
                str(video_path),
                str(thumbnail_path),
                'smart'
            )
        except Exception as thumb_err:
            logger.warning(f"Comment thumbnail generation skipped: {thumb_err}")
            thumb_success = False

        gc.collect()

        # Upload to Supabase if available
        media_url = None
        if SUPABASE_STORAGE_AVAILABLE:
            remote_key = f"comments/{result['filename']}"
            supabase_video_url = await asyncio.to_thread(
                upload_to_supabase_storage, video_path, 'feed', remote_key, 'video/mp4'
            )
            media_url = supabase_video_url

        if not media_url:
            media_url = f"/api/uploads/comments/{result['filename']}"

        if thumb_success and SUPABASE_STORAGE_AVAILABLE:
            remote_thumb_key = f"comments/{thumbnail_filename}"
            supabase_thumb_url = await asyncio.to_thread(
                upload_to_supabase_storage, thumbnail_path, 'feed', remote_thumb_key, 'image/jpeg'
            )
            if supabase_thumb_url:
                thumbnail_url = supabase_thumb_url

        if not thumbnail_url and thumb_success:
            thumbnail_url = f"/api/uploads/comments/{thumbnail_filename}"

        return {
            "media_url": media_url,
            "media_type": "video",
            "thumbnail_url": thumbnail_url,
            "filename": result['filename'],
            "duration": result['duration'],
            "was_transcoded": result['was_transcoded'],
            "size": result.get('size', 0)
        }
    else:
        # Handle image/gif comment upload
        content = await file.read()

        if len(content) > MAX_IMAGE_SIZE:
            raise HTTPException(
                status_code=400,
                detail=f"File too large. Maximum size is {MAX_IMAGE_SIZE // (1024*1024)}MB"
            )

        ext = get_file_extension(file.content_type)
        filename = f"{uuid.uuid4()}{ext}"
        file_path = comments_dir / filename

        with open(file_path, "wb") as f:
            f.write(content)

        content_size = len(content)
        del content
        gc.collect()

        # Upload to Supabase if available
        media_url = None
        if SUPABASE_STORAGE_AVAILABLE:
            remote_key = f"comments/{filename}"
            supabase_image_url = await asyncio.to_thread(
                upload_to_supabase_storage, file_path, 'feed', remote_key,
                content_type=file.content_type or 'image/jpeg'
            )
            media_url = supabase_image_url

        if not media_url:
            media_url = f"/api/uploads/comments/{filename}"

        return {
            "media_url": media_url,
            "media_type": "image",
            "filename": filename,
            "size": content_size,
            "persistent": bool(media_url.startswith("http"))
        }


@router.get("/uploads/comments/{filename}")
async def get_comment_media(filename: str):
    """Serve comment media files"""
    file_path = UPLOAD_DIR / "comments" / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return _cached_file_response(file_path)
