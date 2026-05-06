"""Uploads media — feed uploads, wave videos, user/photographer galleries, watermarking, session photos."""
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


    # Validate file type
    is_video = file.content_type in ALLOWED_VIDEO_TYPES
    is_image = file.content_type in ALLOWED_IMAGE_TYPES

    if not is_video and not is_image:
        raise HTTPException(
            status_code=400,
            detail="Invalid file type. Allowed: JPEG, PNG, WebP, GIF, MP4, MOV, WebM"
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
            upload_to_supabase_storage, video_path, 'videos', remote_key, 'video/mp4'
        )
        media_url = supabase_video_url or f"/api/uploads/feed/{result['filename']}"

        if thumb_success:
            remote_thumb_key = f"feed/{thumbnail_filename}"
            supabase_thumb_url = await asyncio.to_thread(
                upload_to_supabase_storage, thumbnail_path, 'videos', remote_thumb_key, 'image/jpeg'
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

        media_url = f"/api/uploads/feed/{filename}"

        return {
            "media_url": media_url,
            "media_type": "image",
            "filename": filename,
            "size": content_size
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


    # Waves must be video
    if file.content_type not in ALLOWED_VIDEO_TYPES:
        raise HTTPException(
            status_code=400,
            detail="Waves must be video: MP4, MOV, or WebM"
        )

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


@router.post("/upload/user-gallery")
async def upload_user_gallery_media(
    file: UploadFile = File(...),
    user_id: str = Form(...),
    db: AsyncSession = Depends(get_db)
):
    """
    Upload media to user's personal gallery
    Videos are transcoded to 1080p for user uploads
    """
    is_video = file.content_type in ALLOWED_VIDEO_TYPES
    is_image = file.content_type in ALLOWED_IMAGE_TYPES
    
    if not is_video and not is_image:
        raise HTTPException(
            status_code=400, 
            detail="Invalid file type. Allowed: JPEG, PNG, WebP, GIF, MP4, MOV, WebM"
        )
    
    content = await file.read()
    
    max_size = MAX_FILE_SIZE if is_video else MAX_IMAGE_SIZE
    if len(content) > max_size:
        raise HTTPException(
            status_code=400, 
            detail=f"File too large. Maximum size is {max_size // (1024*1024)}MB"
        )
    
    # Create user gallery directory
    user_gallery_dir = UPLOAD_DIR / "user-gallery" / user_id
    user_gallery_dir.mkdir(parents=True, exist_ok=True)
    
    if is_video:
        # User gallery videos capped at 1080p
        success, error, result = await asyncio.to_thread(
            process_video_upload,
            content,
            file.filename or "video.mp4",
            user_gallery_dir,
            user_subscription='free',
            upload_type='feed'  # Same 1080p limit
        )
        
        if not success:
            raise HTTPException(status_code=400, detail=f"Video processing failed: {error}")
        
        media_url = f"/api/uploads/user-gallery/{user_id}/{result['filename']}"
        
        # Generate smart thumbnail
        thumbnail_url = None
        video_path = user_gallery_dir / result['filename']
        thumbnail_filename = f"{result['filename'].rsplit('.', 1)[0]}_thumb.jpg"
        thumbnail_path = user_gallery_dir / thumbnail_filename
        
        thumb_success, _ = await asyncio.to_thread(
            generate_video_thumbnail,
            str(video_path),
            str(thumbnail_path),
            'smart'
        )
        
        if thumb_success:
            thumbnail_url = f"/api/uploads/user-gallery/{user_id}/{thumbnail_filename}"
        
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
        # Handle image upload
        ext = get_file_extension(file.content_type)
        filename = f"{uuid.uuid4()}{ext}"
        file_path = user_gallery_dir / filename
        
        with open(file_path, "wb") as f:
            f.write(content)
        
        media_url = f"/api/uploads/user-gallery/{user_id}/{filename}"
        
        return {
            "media_url": media_url,
            "media_type": "image",
            "filename": filename,
            "size": len(content)
        }


@router.post("/upload/photographer-gallery")
async def upload_photographer_gallery_media(
    file: UploadFile = File(...),
    user_id: str = Form(...),
    add_watermark_preview: bool = Form(True),
    db: AsyncSession = Depends(get_db)
):
    """
    Upload media for photographer's gallery
    Paid photographers (basic/premium subscription) can upload 4K videos
    Free photographers limited to 1080p
    """
    # Check user subscription
    result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    subscription = user.subscription_tier or 'free'
    is_paid = subscription in ['basic', 'premium']
    
    is_video = file.content_type in ALLOWED_VIDEO_TYPES
    is_image = file.content_type in ALLOWED_IMAGE_TYPES
    
    if not is_video and not is_image:
        raise HTTPException(
            status_code=400, 
            detail="Invalid file type. Allowed: JPEG, PNG, WebP, GIF, MP4, MOV, WebM"
        )
    
    content = await file.read()
    
    max_size = MAX_FILE_SIZE if is_video else MAX_IMAGE_SIZE
    if len(content) > max_size:
        raise HTTPException(
            status_code=400, 
            detail=f"File too large. Maximum size is {max_size // (1024*1024)}MB"
        )
    
    # Create photographer gallery directory
    gallery_dir = UPLOAD_DIR / "gallery" / user_id
    gallery_dir.mkdir(parents=True, exist_ok=True)
    
    if is_video:
        # Process video - paid photographers can upload 4K
        success, error, result_data = await asyncio.to_thread(
            process_video_upload,
            content,
            file.filename or "video.mp4",
            gallery_dir,
            user_subscription=subscription,
            upload_type='gallery'  # 4K for paid, 1080p for free
        )
        
        if not success:
            # Fallback: save raw video file when processing fails (e.g. no ffmpeg)
            fallback_filename = f"{uuid.uuid4()}.mp4"
            fallback_path = gallery_dir / fallback_filename
            with open(fallback_path, "wb") as fb:
                fb.write(content)
            logger.warning(f"Video processing failed ({error}), saved raw file: {fallback_filename}")
            result_data = {
                'filename': fallback_filename,
                'original_width': 0,
                'original_height': 0,
                'duration': 0,
                'was_transcoded': False,
                'size': len(content)
            }
        
        original_url = f"/api/uploads/gallery/{user_id}/{result_data['filename']}"
        preview_url = original_url  # For videos, preview is same as original
        
        # Generate smart thumbnail (graceful if ffmpeg unavailable)
        thumbnail_url = None
        try:
            video_path = gallery_dir / result_data['filename']
            thumbnail_filename = f"{result_data['filename'].rsplit('.', 1)[0]}_thumb.jpg"
            thumbnail_path = gallery_dir / thumbnail_filename
            
            thumb_success, _ = await asyncio.to_thread(
                generate_video_thumbnail,
                str(video_path),
                str(thumbnail_path),
                'smart'
            )
            
            if thumb_success:
                thumbnail_url = f"/api/uploads/gallery/{user_id}/{thumbnail_filename}"
        except Exception as thumb_err:
            logger.warning(f"Thumbnail generation skipped: {thumb_err}")
        
        max_res = "4K" if is_paid else "1080p"
        
        # Upload video + thumbnail to Supabase for persistence
        supabase_original = upload_to_supabase_storage(
            gallery_dir / result_data['filename'],
            'gallery',
            f"{user_id}/{result_data['filename']}",
            content_type=file.content_type or 'video/mp4'
        )
        supabase_thumb = None
        if thumbnail_url and thumbnail_filename:
            supabase_thumb = upload_to_supabase_storage(
                gallery_dir / thumbnail_filename,
                'gallery',
                f"{user_id}/{thumbnail_filename}",
                content_type='image/jpeg'
            )
        
        # Use Supabase URLs if available, otherwise fall back to local
        final_original = supabase_original or original_url
        final_preview = supabase_original or preview_url
        final_thumbnail = supabase_thumb or thumbnail_url
        
        return {
            "original_url": final_original,
            "preview_url": final_preview,
            "thumbnail_url": final_thumbnail,
            "media_type": "video",
            "filename": result_data['filename'],
            "original_width": result_data['original_width'],
            "original_height": result_data['original_height'],
            "final_width": result_data.get('final_width'),
            "final_height": result_data.get('final_height'),
            "duration": result_data['duration'],
            "was_transcoded": result_data['was_transcoded'],
            "size": result_data.get('size', 0),
            "max_allowed_resolution": max_res,
            "has_watermark": False
        }
    else:
        # Handle image upload (existing logic)
        # Memory-safe: release buffers between steps to stay under 512MB
        import gc
        ext = get_file_extension(file.content_type)
        base_filename = str(uuid.uuid4())
        original_filename = f"{base_filename}_original{ext}"
        preview_filename = f"{base_filename}_preview{ext}"
        
        original_path = gallery_dir / original_filename
        preview_path = gallery_dir / preview_filename
        content_size = len(content)
        
        # Auto-rotate based on EXIF orientation (fixes sideways mobile photos)
        try:
            from PIL import Image as PILImage, ImageOps
            from io import BytesIO
            img = PILImage.open(BytesIO(content))
            img = ImageOps.exif_transpose(img)
            # Release raw bytes NOW — we no longer need them
            del content
            gc.collect()
            # Save the corrected original
            save_kwargs = {}
            if ext.lower() in ('.jpg', '.jpeg'):
                save_kwargs = {'quality': 95, 'exif': b''}  # Strip EXIF after applying rotation
            elif ext.lower() == '.png':
                save_kwargs = {'optimize': True}
            elif ext.lower() == '.webp':
                save_kwargs = {'quality': 95}
            img.save(str(original_path), **save_kwargs)
            logger.info(f"Saved EXIF-corrected image: {original_filename}")
            # Release PIL image before watermarking opens it again
            img.close()
            del img
            gc.collect()
        except Exception as exif_err:
            logger.warning(f"EXIF auto-rotate failed ({exif_err}), saving raw file")
            with open(original_path, "wb") as f:
                f.write(content)
            # Release raw bytes after writing to disk
            try:
                del content
            except NameError:
                pass
            gc.collect()
        
        # Create watermarked preview (reads from disk, not memory)
        watermark_time_ms = 0
        if add_watermark_preview:
            _, watermark_time_ms = add_watermark(str(original_path), str(preview_path))
            gc.collect()  # Release watermark PIL objects
        else:
            shutil.copy(original_path, preview_path)
        
        # Upload images to Supabase for persistence
        local_original_url = f"/api/uploads/gallery/{user_id}/{original_filename}"
        local_preview_url = f"/api/uploads/gallery/{user_id}/{preview_filename}"
        
        supabase_original = upload_to_supabase_storage(
            original_path, 'gallery',
            f"{user_id}/{original_filename}",
            content_type=file.content_type or 'image/jpeg'
        )
        supabase_preview = upload_to_supabase_storage(
            preview_path, 'gallery',
            f"{user_id}/{preview_filename}",
            content_type=file.content_type or 'image/jpeg'
        )
        
        return {
            "original_url": supabase_original or local_original_url,
            "preview_url": supabase_preview or local_preview_url,
            "media_type": "image",
            "filename": base_filename,
            "size": content_size,
            "has_watermark": add_watermark_preview,
            "watermark_time_ms": watermark_time_ms
        }


@router.get("/uploads/feed/{filename}")
async def get_feed_media(filename: str):
    """Serve feed media file with correct MIME type for video streaming.
    .mov files are served as video/mp4 (same codec, different container label)
    so that Safari/iOS can play them without requiring QuickTime plugin.
    """
    file_path = UPLOAD_DIR / "feed" / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")

    # Explicit MIME type mapping to avoid FastAPI mis-detecting .mov as
    # video/quicktime, which breaks video streaming on iOS Safari
    lower = filename.lower()
    if lower.endswith('.mp4') or lower.endswith('.mov'):
        content_type = 'video/mp4'
    elif lower.endswith('.webm'):
        content_type = 'video/webm'
    elif lower.endswith('.ogv'):
        content_type = 'video/ogg'
    elif lower.endswith(('.jpg', '.jpeg')):
        content_type = 'image/jpeg'
    elif lower.endswith('.png'):
        content_type = 'image/png'
    elif lower.endswith('.webp'):
        content_type = 'image/webp'
    elif lower.endswith('.gif'):
        content_type = 'image/gif'
    else:
        content_type = None

    return _cached_file_response(file_path, media_type=content_type, cache_control=_SHORT_CACHE)


@router.get("/uploads/user-gallery/{user_id}/{filename}")
async def get_user_gallery_media(user_id: str, filename: str):
    """Serve user gallery media file with correct MIME type"""
    file_path = UPLOAD_DIR / "user-gallery" / user_id / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")

    lower = filename.lower()
    if lower.endswith('.mp4') or lower.endswith('.mov'):
        content_type = 'video/mp4'
    elif lower.endswith('.webm'):
        content_type = 'video/webm'
    elif lower.endswith(('.jpg', '.jpeg')):
        content_type = 'image/jpeg'
    elif lower.endswith('.png'):
        content_type = 'image/png'
    elif lower.endswith('.webp'):
        content_type = 'image/webp'
    else:
        content_type = None

    return _cached_file_response(file_path, media_type=content_type, cache_control=_SHORT_CACHE)



@router.post("/uploads/test-watermark")
async def test_watermark_performance(
    file: UploadFile = File(...)
):
    """
    Test watermarking performance.
    Upload an image and get back watermarked version with timing info.
    Target: <2 seconds for 5MB image.
    """
    import time
    import tempfile
    
    start_time = time.time()
    
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="Invalid file type")
    
    content = await file.read()
    file_size_mb = len(content) / (1024 * 1024)
    
    # Create temp files
    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as input_file:
        input_file.write(content)
        input_path = input_file.name
    
    output_path = input_path.replace(".jpg", "_watermarked.jpg")
    
    # Apply watermark and measure time
    _, watermark_time_ms = add_watermark(input_path, output_path)
    
    total_time_ms = (time.time() - start_time) * 1000
    
    # Read watermarked file
    with open(output_path, "rb") as f:
        watermarked_content = f.read()
    
    output_size_mb = len(watermarked_content) / (1024 * 1024)
    
    # Clean up
    os.unlink(input_path)
    os.unlink(output_path)
    
    # Return stats
    return {
        "input_size_mb": round(file_size_mb, 2),
        "output_size_mb": round(output_size_mb, 2),
        "watermark_time_ms": round(watermark_time_ms, 0),
        "total_time_ms": round(total_time_ms, 0),
        "meets_2_second_target": total_time_ms < 2000
    }



# ============ SESSION PHOTO UPLOAD WITH SURFER TAGGING ============

@router.post("/photos/upload")
async def upload_session_photo(
    file: UploadFile = File(...),
    photographer_id: str = Form(...),
    gallery_id: Optional[str] = Form(None),
    session_id: Optional[str] = Form(None),
    tagged_surfer_ids: Optional[str] = Form(None),  # JSON array
    price: Optional[float] = Form(None),
    is_session_photo: bool = Form(False),
    media_type: Optional[str] = Form(None),  # 'image' or 'video' from frontend
    db: AsyncSession = Depends(get_db)
):
    """
    Upload a photo or video from a live session with optional surfer tagging.
    Media is added to the photographer's gallery and tagged surfers get notified.
    """
    # Verify photographer
    result = await db.execute(select(Profile).where(Profile.id == photographer_id))
    photographer = result.scalar_one_or_none()
    
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    # Determine if this is a video or image based on content type
    is_video = file.content_type in ALLOWED_VIDEO_TYPES
    is_image = file.content_type in ALLOWED_IMAGE_TYPES
    
    # Validate file type
    if not is_video and not is_image:
        raise HTTPException(status_code=400, detail="Invalid file type. Supported: images (JPEG, PNG, WebP, GIF) and videos (MP4, MOV, WebM)")
    
    content = await file.read()
    
    # Check size limits
    max_size = MAX_FILE_SIZE if is_video else MAX_IMAGE_SIZE
    if len(content) > max_size:
        raise HTTPException(status_code=400, detail=f"File too large. Max {max_size // (1024*1024)}MB")
    
    # Create gallery directory
    gallery_dir = UPLOAD_DIR / "gallery" / photographer_id
    gallery_dir.mkdir(parents=True, exist_ok=True)
    
    # Generate filename
    ext = file.filename.rsplit('.', 1)[-1].lower() if file.filename else ('mp4' if is_video else 'jpg')
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    filename = f"session_{timestamp}_{str(uuid.uuid4())[:8]}.{ext}"
    file_path = gallery_dir / filename
    
    # Save original
    with open(file_path, 'wb') as f:
        f.write(content)
    
    # URLs
    original_url = f"/api/uploads/gallery/{photographer_id}/{filename}"
    preview_url = original_url  # Default preview to original
    
    # For images, generate watermarked preview
    if is_image:
        preview_filename = f"preview_{filename}"
        preview_path = gallery_dir / preview_filename
        
        try:
            img = Image.open(io.BytesIO(content))
            
            # Resize for preview (max 1200px)
            img.thumbnail((1200, 1200), Image.Resampling.LANCZOS)
            
            # Add watermark
            draw = ImageDraw.Draw(img)
            watermark_text = "RAW SURF OS"
            
            try:
                font_paths = [
                    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
                    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
                    "/System/Library/Fonts/Helvetica.ttc",
                    "C:/Windows/Fonts/arial.ttf",
                    os.path.join(os.path.dirname(__file__), "..", "assets", "DejaVuSans-Bold.ttf"),
                ]
                font = None
                for fp in font_paths:
                    if os.path.exists(fp):
                        font = ImageFont.truetype(fp, 48)
                        break
                if font is None:
                    font = ImageFont.load_default()
            except Exception:
                font = ImageFont.load_default()
            
            # Calculate position (center)
            bbox = draw.textbbox((0, 0), watermark_text, font=font)
            text_width = bbox[2] - bbox[0]
            text_height = bbox[3] - bbox[1]
            x = (img.width - text_width) // 2
            y = (img.height - text_height) // 2
            
            # Draw semi-transparent watermark
            draw.text((x, y), watermark_text, font=font, fill=(255, 255, 255, 100))
            
            img.save(preview_path, quality=85)
            preview_url = f"/api/uploads/gallery/{photographer_id}/{preview_filename}"
        except Exception as e:
            logger.error(f"Watermark error: {e}")
            # Just use original as preview
    
    # For videos, optionally generate thumbnail (if video processor is available)
    elif is_video:
        try:
            thumbnail_filename = f"thumb_{filename.rsplit('.', 1)[0]}.jpg"
            thumbnail_path = gallery_dir / thumbnail_filename
            # Try to generate video thumbnail
            from utils.video_processor import generate_video_thumbnail
            thumbnail_success = await generate_video_thumbnail(str(file_path), str(thumbnail_path))
            if thumbnail_success:
                preview_url = f"/api/uploads/gallery/{photographer_id}/{thumbnail_filename}"
        except Exception as e:
            logger.error(f"Video thumbnail error: {e}")
            # Keep original URL as preview
    
    # Parse tagged surfers
    tagged_ids = []
    if tagged_surfer_ids:
        try:
            tagged_ids = json.loads(tagged_surfer_ids)
        except Exception:
            pass
    
    # Determine final media type
    final_media_type = 'video' if is_video else 'image'
    # Use frontend-provided media_type if available (for explicit override)
    if media_type and media_type in ['image', 'video']:
        final_media_type = media_type
    
    # Create gallery item record
    from models import generate_uuid


    
    gallery_item = GalleryItem(
        id=generate_uuid(),
        photographer_id=photographer_id,
        gallery_id=gallery_id,
        original_url=original_url,
        preview_url=preview_url,
        media_type=final_media_type,
        price=price or (15.0 if is_video else 5.0),  # Default higher price for videos
        is_public=True,
        tagged_surfer_ids=json.dumps(tagged_ids) if tagged_ids else None,
        session_id=session_id
    )
    
    db.add(gallery_item)
    await db.commit()
    await db.refresh(gallery_item)
    
    # TODO: Send notifications to tagged surfers
    # This would integrate with OneSignal or in-app notifications
    
    return {
        "success": True,
        "id": gallery_item.id,
        "original_url": original_url,
        "preview_url": preview_url,
        "tagged_surfers": len(tagged_ids),
        "price": gallery_item.price,
        "media_type": final_media_type
    }
