"""Uploads media — feed uploads and wave videos.

Gallery, watermark test, and session photo endpoints are in media_gallery.py (v88).
"""
from fastapi import Depends, File, Form, HTTPException, UploadFile, APIRouter
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db
from datetime import datetime
from typing import Optional
import uuid
import json
import os
import shutil
import asyncio
import logging
from models import GalleryItem, Profile
from .core import (
    UPLOAD_DIR, ALLOWED_IMAGE_TYPES, ALLOWED_VIDEO_TYPES,
    MAX_FILE_SIZE, MAX_IMAGE_SIZE, STREAM_CHUNK_SIZE,
    SUPABASE_STORAGE_AVAILABLE,
    upload_to_supabase_storage, get_file_extension,
    _cached_file_response, _SHORT_CACHE,
)
from utils.video_processor import (
    get_video_info, process_video_from_path, process_video_upload,
    generate_video_thumbnail
)

router = APIRouter()
logger = logging.getLogger(__name__)

@router.post("/upload/feed")
async def upload_feed_media(
    file: UploadFile = File(...),
    user_id: str = Form(...),
    db: AsyncSession = Depends(get_db)
):
    """
    Upload media for a feed post (image or video)
    Videos are automatically transcoded to 1080p max for all users.

    Memory-safe: video uploads are streamed to disk in 1 MB chunks.
    """
    import gc


    # Validate file type — with filename-based fallback for iPhone Safari
    # iPhone can send HEVC .MOV videos as application/octet-stream or video/3gpp
    is_video = file.content_type in ALLOWED_VIDEO_TYPES
    is_image = file.content_type in ALLOWED_IMAGE_TYPES

    if not is_video and not is_image:
        # Fallback: infer type from filename extension (critical for iPhone uploads)
        ext = (file.filename or '').rsplit('.', 1)[-1].lower() if file.filename else ''
        VIDEO_EXTS = {'mp4', 'mov', 'webm', 'mpeg', 'm4v', '3gp', '3gpp', 'avi', 'mkv'}
        IMAGE_EXTS = {'jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif'}
        if ext in VIDEO_EXTS:
            is_video = True
            logger.info(f"Feed upload: inferred video from extension .{ext} (content_type={file.content_type})")
        elif ext in IMAGE_EXTS:
            is_image = True
            logger.info(f"Feed upload: inferred image from extension .{ext} (content_type={file.content_type})")
        else:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid file type '{file.content_type}'. Allowed: JPEG, PNG, WebP, GIF, MP4, MOV, WebM"
            )

    # Create feed subdirectory
    feed_dir = UPLOAD_DIR / "feed"
    feed_dir.mkdir(exist_ok=True)

    if is_video:
        # ── Stream video to disk (never hold full file in RAM) ──
        temp_filename = f"temp_{uuid.uuid4()}.mp4"
        temp_path = feed_dir / temp_filename
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
            logger.error(f"Feed video streaming write failed: {e}")
            if temp_path.exists():
                os.remove(temp_path)
            raise HTTPException(status_code=500, detail="Upload write failed")
        finally:
            await file.close()
            gc.collect()

        # Process video from the file on disk
        success, error, result = await asyncio.to_thread(
            process_video_from_path,
            temp_path,
            file.filename or "video.mp4",
            feed_dir,
            user_subscription='free',
            upload_type='feed'
        )

        if not success:
            # ── Fallback: keep raw video when processing fails (no ffmpeg / OOM / timeout) ──
            logger.warning(f"Feed video processing failed ({error}), keeping raw video")
            raw_filename = f"{uuid.uuid4()}.mp4"
            raw_path = feed_dir / raw_filename
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
                'duration': 0,
                'was_transcoded': False,
                'size': file_size,
            }

        gc.collect()

        video_path = feed_dir / result['filename']
        thumbnail_filename = f"{result['filename'].rsplit('.', 1)[0]}_thumb.jpg"
        thumbnail_path = feed_dir / thumbnail_filename

        # Generate smart thumbnail (graceful if ffmpeg unavailable)
        thumbnail_url = None
        try:
            thumb_success, _ = await asyncio.to_thread(
                generate_video_thumbnail,
                str(video_path),
                str(thumbnail_path),
                'smart'
            )
        except Exception as thumb_err:
            logger.warning(f"Feed thumbnail generation skipped: {thumb_err}")
            thumb_success = False

        gc.collect()

        # Prefer Supabase Storage (permanent) over ephemeral disk URL
        remote_key = f"feed/{result['filename']}"
        supabase_video_url = await asyncio.to_thread(
            upload_to_supabase_storage, video_path, 'feed', remote_key, 'video/mp4'
        )
        media_url = supabase_video_url or f"/api/uploads/feed/{result['filename']}"

        if thumb_success:
            remote_thumb_key = f"feed/{thumbnail_filename}"
            supabase_thumb_url = await asyncio.to_thread(
                upload_to_supabase_storage, thumbnail_path, 'feed', remote_thumb_key, 'image/jpeg'
            )
            thumbnail_url = supabase_thumb_url or f"/api/uploads/feed/{thumbnail_filename}"

        return {
            "media_url": media_url,
            "media_type": "video",
            "thumbnail_url": thumbnail_url,
            "filename": result['filename'],
            "original_width": result['original_width'],
            "original_height": result['original_height'],
            "final_width": result.get('final_width'),
            "final_height": result.get('final_height'),
            "duration": result['duration'],
            "was_transcoded": result['was_transcoded'],
            "size": result.get('size', 0)
        }
    else:
        # Handle image upload (images are small enough for in-memory read)
        content = await file.read()

        if len(content) > MAX_IMAGE_SIZE:
            raise HTTPException(
                status_code=400,
                detail=f"File too large. Maximum size is {MAX_IMAGE_SIZE // (1024*1024)}MB"
            )

        ext = get_file_extension(file.content_type)
        filename = f"{uuid.uuid4()}{ext}"
        file_path = feed_dir / filename

        with open(file_path, "wb") as f:
            f.write(content)

        content_size = len(content)
        del content
        gc.collect()

        # Prefer Supabase Storage (permanent) over ephemeral disk URL
        remote_key = f"feed/{filename}"
        supabase_image_url = await asyncio.to_thread(
            upload_to_supabase_storage, file_path, 'feed', remote_key,
            content_type=file.content_type or 'image/jpeg'
        )
        media_url = supabase_image_url or f"/api/uploads/feed/{filename}"
        if supabase_image_url:
            logger.info(f"Feed image persisted to Supabase: {supabase_image_url}")
        else:
            logger.warning(f"Feed image saved to ephemeral disk only: {media_url}")

        return {
            "media_url": media_url,
            "media_type": "image",
            "filename": filename,
            "size": content_size,
            "persistent": bool(supabase_image_url)
        }


# ============================================================
# WAVES UPLOAD - Short-form vertical video (60 sec max)
# ============================================================
MAX_WAVE_DURATION = 60  # seconds - music label compliance

@router.post("/upload/wave")
async def upload_wave_video(
    file: UploadFile = File(...),
    user_id: str = Form(...),
    db: AsyncSession = Depends(get_db)
):
    """
    Upload short-form vertical video (Wave)
    - Max 60 seconds for music label compliance
    - Vertical (9:16) or portrait (4:5) recommended
    - Auto-transcoded to 1080p max

    Memory-safe: streams video directly to disk in 1 MB chunks instead of
    buffering the entire file in Python RAM.  Designed for Render 512 MB tier.
    """
    import gc


    # Waves must be video — with filename-based fallback for iPhone
    if file.content_type not in ALLOWED_VIDEO_TYPES:
        ext = (file.filename or '').rsplit('.', 1)[-1].lower() if file.filename else ''
        VIDEO_EXTS = {'mp4', 'mov', 'webm', 'mpeg', 'm4v', '3gp', '3gpp'}
        if ext not in VIDEO_EXTS:
            raise HTTPException(
                status_code=400,
                detail="Waves must be video: MP4, MOV, or WebM"
            )
        logger.info(f"Wave upload: inferred video from extension .{ext} (content_type={file.content_type})")

    # ── 1. Stream upload directly to disk (never hold full file in RAM) ──
    waves_dir = UPLOAD_DIR / "waves"
    waves_dir.mkdir(exist_ok=True)

    temp_filename = f"temp_{uuid.uuid4()}.mp4"
    temp_path = waves_dir / temp_filename
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
        logger.error(f"Wave streaming write failed: {e}")
        if temp_path.exists():
            os.remove(temp_path)
        raise HTTPException(status_code=500, detail="Upload write failed")
    finally:
        # Release the Starlette SpooledTemporaryFile immediately
        await file.close()
        gc.collect()

    # ── 2. Read metadata from the file on disk (zero extra RAM) ──
    video_info = await asyncio.to_thread(get_video_info, str(temp_path))

    if not video_info:
        logger.warning("Could not read video metadata (ffprobe missing?), proceeding with defaults")
        video_info = {
            'width': 0,
            'height': 0,
            'duration': 0,
            'codec': 'unknown',
            'bitrate': 0,
            'size': file_size
        }
    else:
        # ENFORCE 60-SECOND LIMIT for music label compliance
        if video_info.get('duration', 0) > MAX_WAVE_DURATION:
            os.remove(temp_path)
            raise HTTPException(
                status_code=400,
                detail=f"Waves must be {MAX_WAVE_DURATION} seconds or less. "
                       f"Your video is {video_info['duration']:.1f} seconds."
            )

    gc.collect()

    # ── 3. Calculate aspect ratio ──
    width = video_info.get('width', 0)
    height = video_info.get('height', 0)

    if width > 0 and height > 0:
        ratio = height / width
        if ratio >= 1.7:
            aspect_ratio = '9:16'
        elif ratio >= 1.2:
            aspect_ratio = '4:5'
        elif ratio >= 0.9:
            aspect_ratio = '1:1'
        else:
            aspect_ratio = '16:9'
    else:
        aspect_ratio = '9:16'

    # ── 4. Process video from the file on disk (path-based, no bytes in RAM) ──
    success, error, result = await asyncio.to_thread(
        process_video_from_path,
        temp_path,
        file.filename or "wave.mp4",
        waves_dir,
        user_subscription='free',
        upload_type='feed'
    )

    if not success:
        # Fallback: keep the raw temp file as-is
        logger.warning(f"Wave transcoding failed ({error}), keeping raw video")
        raw_filename = f"{uuid.uuid4()}.mp4"
        raw_path = waves_dir / raw_filename
        if temp_path.exists():
            shutil.move(str(temp_path), str(raw_path))
        else:
            raise HTTPException(status_code=500, detail="Video processing failed and source lost")
        result = {
            'filename': raw_filename,
            'original_width': width,
            'original_height': height,
            'final_width': width,
            'final_height': height,
            'duration': video_info.get('duration', 0),
            'was_transcoded': False,
            'size': file_size,
        }

    gc.collect()

    media_url = f"/api/uploads/waves/{result['filename']}"

    # ── 5. Generate thumbnail (runs ffmpeg subprocess, not Python RAM) ──
    thumbnail_url = None
    video_path = waves_dir / result['filename']
    thumbnail_filename = f"{result['filename'].rsplit('.', 1)[0]}_thumb.jpg"
    thumbnail_path = waves_dir / thumbnail_filename

    thumb_success, _ = await asyncio.to_thread(
        generate_video_thumbnail,
        str(video_path),
        str(thumbnail_path),
        'smart'
    )

    if thumb_success:
        thumbnail_url = f"/api/uploads/waves/{thumbnail_filename}"

    gc.collect()

    # ── 6. Upload to Supabase for persistence ──
    if SUPABASE_STORAGE_AVAILABLE:
        wave_remote_key = f"waves/{user_id}/{result['filename']}"
        supa_media = await asyncio.to_thread(
            upload_to_supabase_storage, video_path, 'feed', wave_remote_key, 'video/mp4'
        )
        if supa_media:
            media_url = supa_media
            logger.info(f'Wave video uploaded to Supabase: {supa_media}')

        if thumb_success and thumbnail_path.exists():
            thumb_remote_key = f"waves/{user_id}/{thumbnail_filename}"
            supa_thumb = await asyncio.to_thread(
                upload_to_supabase_storage, thumbnail_path, 'feed', thumb_remote_key, 'image/jpeg'
            )
            if supa_thumb:
                thumbnail_url = supa_thumb

    gc.collect()

    return {
        "media_url": media_url,
        "media_type": "video",
        "content_type": "wave",
        "thumbnail_url": thumbnail_url,
        "filename": result['filename'],
        "original_width": result['original_width'],
        "original_height": result['original_height'],
        "final_width": result.get('final_width'),
        "final_height": result.get('final_height'),
        "duration": result['duration'],
        "aspect_ratio": aspect_ratio,
        "was_transcoded": result['was_transcoded'],
        "size": result.get('size', 0)
    }


@router.get("/uploads/waves/{filename}")
async def get_wave_media(filename: str):
    """Serve Wave video/thumbnail files"""
    file_path = UPLOAD_DIR / "waves" / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return _cached_file_response(file_path)



# ============================================================
# TIMELINE FRAME EXTRACTOR & DRM PHOTO REGISTRATION
# ============================================================
from pydantic import BaseModel

class FrameExportRequest(BaseModel):
    timestamp: float
    gallery_id: str

@router.post("/gallery/item/{item_id}/export-frame")
async def export_video_frame(
    item_id: str,
    payload: FrameExportRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Extract a high-resolution frame from an existing gallery video at the requested timestamp,
    apply watermarking, upload to Supabase, and register as a new saleable GalleryItem.
    
    Uses backend subprocess FFmpeg. High performance, zero RAM spikes.
    """
    import subprocess
    import shutil
    
    # 1. Pull the source video from database
    result = await db.execute(select(GalleryItem).where(GalleryItem.id == item_id))
    source_item = result.scalar_one_or_none()
    
    if not source_item:
        raise HTTPException(status_code=404, detail="Video file item not found")
        
    if source_item.media_type != 'video':
        raise HTTPException(status_code=400, detail="Frame grab can only be executed on video files")

    # Determine local working path
    photographer_id = source_item.photographer_id
    working_dir = UPLOAD_DIR / "gallery" / photographer_id
    working_dir.mkdir(parents=True, exist_ok=True)
    
    # We locate local copy if stored, otherwise fetch source stream
    filename = source_item.original_url.rsplit('/', 1)[-1]
    local_video_path = working_dir / filename
    
    if not local_video_path.exists():
        # Fallback: if running on stateless container, download stream frame directly via URL
        video_source = source_item.original_url
    else:
        video_source = str(local_video_path)

    # 2. Setup output filenames
    unique_id = str(uuid.uuid4())
    frame_filename = f"exported_{unique_id}.jpg"
    frame_preview_filename = f"preview_exported_{unique_id}.jpg"
    
    out_original_path = working_dir / frame_filename
    out_preview_path = working_dir / frame_preview_filename

    # 3. Extract exact frame using ffmpeg subprocess (extremely memory-safe)
    try:
        ffmpeg_cmd = [
            'ffmpeg',
            '-ss', str(payload.timestamp),   # Fast seek to frame
            '-i', video_source,
            '-vframes', '1',                 # Extract single frame
            '-q:v', '2',                     # High-quality JPEG quantization
            '-y',                            # Overwrite output
            str(out_original_path)
        ]
        
        process = subprocess.run(ffmpeg_cmd, capture_output=True, text=True, timeout=10)
        
        if process.returncode != 0:
            logger.error(f"FFmpeg frame grab failed: {process.stderr}")
            raise HTTPException(status_code=500, detail="Failed to parse frame from video container")
            
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Frame extraction timed out")
    except Exception as e:
        logger.error(f"Frame extraction exception: {e}")
        raise HTTPException(status_code=500, detail="Frame extraction processor failure")

    # 4. Generate watermarked preview for e-commerce protection
    try:
        from routes.uploads.core import add_watermark
        from models import Profile
        
        # Default watermark settings
        w_text = "RAW SURF DRM"
        w_logo_path = None
        w_position = "tiled"
        w_opacity = 0.12
        w_style = "text"
        
        try:
            profile_res = await db.execute(select(Profile).where(Profile.id == photographer_id))
            profile = profile_res.scalar_one_or_none()
            if profile:
                if profile.watermark_text:
                    w_text = profile.watermark_text
                if profile.watermark_position:
                    w_position = profile.watermark_position
                if profile.watermark_opacity is not None:
                    w_opacity = profile.watermark_opacity
                if profile.watermark_style:
                    w_style = profile.watermark_style
                
                if profile.watermark_logo_url:
                    logo_url = profile.watermark_logo_url
                    if logo_url.startswith("/api/uploads/"):
                        rel_path = logo_url.replace("/api/uploads/", "")
                        local_logo = UPLOAD_DIR / rel_path
                        if local_logo.exists():
                            w_logo_path = str(local_logo)
                    elif not logo_url.startswith("http"):
                        local_logo = UPLOAD_DIR / logo_url
                        if local_logo.exists():
                            w_logo_path = str(local_logo)
        except Exception as db_err:
            logger.warning(f"Failed to query watermark settings for frame export: {db_err}")
            
        add_watermark(
            str(out_original_path), 
            str(out_preview_path), 
            text=w_text, 
            logo_path=w_logo_path, 
            position=w_position, 
            opacity=w_opacity,
            style=w_style
        )
    except Exception as e:
        logger.warning(f"Failed to auto-watermark extracted frame: {e}")
        shutil.copy(str(out_original_path), str(out_preview_path))

    # 5. Persist original and preview files to Supabase Storage
    supabase_original = None
    supabase_preview = None
    
    if SUPABASE_STORAGE_AVAILABLE:
        try:
            supabase_original = await asyncio.to_thread(
                upload_to_supabase_storage,
                out_original_path, 'gallery', 
                f"{photographer_id}/{frame_filename}", 'image/jpeg'
            )
            supabase_preview = await asyncio.to_thread(
                upload_to_supabase_storage,
                out_preview_path, 'gallery', 
                f"{photographer_id}/{frame_preview_filename}", 'image/jpeg'
            )
        except Exception as supa_err:
            logger.error(f"Supabase upload failed for frame extract: {supa_err}")

    # Set up final database URLs
    final_original_url = supabase_original or f"/api/uploads/gallery/{photographer_id}/{frame_filename}"
    final_preview_url = supabase_preview or f"/api/uploads/gallery/{photographer_id}/{frame_preview_filename}"

    # 6. Write new saleable photo row into the database
    from models import generate_uuid
    new_photo_item = GalleryItem(
        id=generate_uuid(),
        photographer_id=photographer_id,
        gallery_id=payload.gallery_id,
        original_url=final_original_url,
        preview_url=final_preview_url,
        media_type='image',
        price=5.0,  # Standard standard photo price
        is_public=True,
        session_id=source_item.session_id
    )
    
    db.add(new_photo_item)
    await db.commit()
    await db.refresh(new_photo_item)

    return {
        "success": True,
        "item_id": new_photo_item.id,
        "original_url": final_original_url,
        "preview_url": final_preview_url,
        "message": "Frame successfully extracted, watermarked, and listed in your session gallery!"
    }

