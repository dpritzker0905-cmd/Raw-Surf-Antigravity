from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Optional
from datetime import datetime, timezone
import os
import uuid
import shutil
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import io
import asyncio
import json
import logging

# Supabase Storage client for persistent video/thumbnail storage
# Prefer service_role key (has Storage write access) over anon key (read-only)
try:
    from supabase import create_client as _create_supabase_client
    _SUPABASE_URL = os.environ.get('SUPABASE_URL', '')
    _SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY') or os.environ.get('SUPABASE_KEY', '')
    _supabase = _create_supabase_client(_SUPABASE_URL, _SUPABASE_KEY) if _SUPABASE_URL and _SUPABASE_KEY else None
    SUPABASE_STORAGE_AVAILABLE = _supabase is not None
    if SUPABASE_STORAGE_AVAILABLE:
        logging.getLogger(__name__).info('Supabase Storage client initialized (service_role key available: %s)', bool(os.environ.get('SUPABASE_SERVICE_ROLE_KEY')))
except Exception:
    _supabase = None
    SUPABASE_STORAGE_AVAILABLE = False

# Import pillow-heif for HEIC support
try:
    import pillow_heif
    pillow_heif.register_heif_opener()
    HEIF_SUPPORT = True
except ImportError:
    HEIF_SUPPORT = False

from database import get_db
from models import Profile, GalleryItem
from utils.video_processor import (
    get_video_info, 
    needs_transcoding, 
    process_video_upload,
    generate_video_thumbnail,
    MAX_FEED_HEIGHT, 
    MAX_FEED_WIDTH,
    MAX_GALLERY_HEIGHT,
    MAX_GALLERY_WIDTH
)

router = APIRouter()
logger = logging.getLogger(__name__)

# Upload directory
UPLOAD_DIR = Path(__file__).parent.parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

# Allowed file types
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"}
ALLOWED_VIDEO_TYPES = {"video/mp4", "video/quicktime", "video/webm", "video/mpeg", "video/x-m4v"}
MAX_FILE_SIZE = 500 * 1024 * 1024  # 500MB for videos
MAX_IMAGE_SIZE = 50 * 1024 * 1024  # 50MB for images


def upload_to_supabase_storage(local_path: Path, bucket: str, remote_key: str, content_type: str = 'video/mp4') -> str | None:
    """Upload a local file to Supabase Storage and return the public URL.
    Returns None if Supabase is unavailable or upload fails."""
    _log = logging.getLogger(__name__)
    if not SUPABASE_STORAGE_AVAILABLE or _supabase is None:
        _log.warning('Supabase Storage not available (client=%s, available=%s)', _supabase is not None, SUPABASE_STORAGE_AVAILABLE)
        return None
    try:
        with open(local_path, 'rb') as f:
            data = f.read()
        _log.info('Uploading %d bytes to Supabase bucket=%s key=%s', len(data), bucket, remote_key)
        # Ensure bucket exists (ignore error if already exists)
        try:
            _supabase.storage.create_bucket(bucket, options={'public': True})
        except Exception:
            pass
        res = _supabase.storage.from_(bucket).upload(
            remote_key, data,
            file_options={'content-type': content_type, 'upsert': 'true'}
        )
        if hasattr(res, 'error') and res.error:
            _log.warning('Supabase upload returned error: %s', res.error)
            return None
        public_url = _supabase.storage.from_(bucket).get_public_url(remote_key)
        _log.info('Supabase upload success: %s', public_url)
        return public_url
    except Exception as e:
        _log.error('Supabase upload exception for bucket=%s key=%s: %s', bucket, remote_key, e, exc_info=True)
        return None


@router.get("/uploads/supabase-diagnostic")
async def supabase_diagnostic():
    """Test Supabase Storage connectivity and bucket availability."""
    import os
    diag = {
        "supabase_storage_available": SUPABASE_STORAGE_AVAILABLE,
        "supabase_url_set": bool(os.environ.get('SUPABASE_URL')),
        "supabase_service_role_key_set": bool(os.environ.get('SUPABASE_SERVICE_ROLE_KEY')),
        "supabase_key_set": bool(os.environ.get('SUPABASE_KEY')),
        "client_initialized": _supabase is not None,
    }
    if _supabase:
        try:
            buckets = _supabase.storage.list_buckets()
            diag["buckets"] = [b.name if hasattr(b, 'name') else str(b) for b in buckets]
            # Test gallery bucket
            try:
                files = _supabase.storage.from_('gallery').list(limit=1)
                diag["gallery_bucket_accessible"] = True
                diag["gallery_file_count_sample"] = len(files) if files else 0
            except Exception as e:
                diag["gallery_bucket_accessible"] = False
                diag["gallery_bucket_error"] = str(e)
        except Exception as e:
            diag["bucket_list_error"] = str(e)
    return diag


def convert_heic_to_jpeg(content: bytes) -> tuple[bytes, str]:
    """Convert HEIC/HEIF image to JPEG"""
    try:
        img = Image.open(io.BytesIO(content))
        # Convert to RGB if needed (HEIC can have alpha)
        if img.mode in ('RGBA', 'P'):
            img = img.convert('RGB')
        
        output = io.BytesIO()
        img.save(output, format='JPEG', quality=90)
        return output.getvalue(), 'image/jpeg'
    except Exception as e:
        logger.error(f"Failed to convert HEIC: {e}")
        raise HTTPException(status_code=400, detail="Failed to process iPhone image. Please try taking a new photo.")

def get_file_extension(content_type: str) -> str:
    """Get file extension from content type"""
    extensions = {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
        "image/gif": ".gif",
        "video/mp4": ".mp4",
        "video/quicktime": ".mov",
        "video/webm": ".webm"
    }
    return extensions.get(content_type, ".bin")

def add_watermark(image_path: str, output_path: str, text: str = "RAW SURF OS") -> tuple:
    """
    Add watermark to an image.
    Returns (output_path, processing_time_ms)
    Optimized for sub-2-second processing of 5MB images.
    """
    import time
    start_time = time.time()
    
    try:
        from PIL import Image, ImageDraw, ImageFont
        
        # Open and resize for processing if image is very large
        img = Image.open(image_path)
        original_size = img.size
        
        # For very large images (>4K), resize for watermarking then upscale
        max_dimension = 4096
        if img.width > max_dimension or img.height > max_dimension:
            # Calculate scale factor
            scale = min(max_dimension / img.width, max_dimension / img.height)
            new_size = (int(img.width * scale), int(img.height * scale))
            img = img.resize(new_size, Image.Resampling.LANCZOS)
        
        # Convert to RGBA if needed
        if img.mode != 'RGBA':
            img = img.convert('RGBA')
        
        # Create watermark overlay
        txt_layer = Image.new('RGBA', img.size, (255, 255, 255, 0))
        draw = ImageDraw.Draw(txt_layer)
        
        # Calculate font size based on image dimensions (optimized)
        font_size = max(20, min(img.width, img.height) // 25)
        
        try:
            # Try common font paths (Linux, macOS, Windows, bundled)
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
                    font = ImageFont.truetype(fp, font_size)
                    break
            if font is None:
                font = ImageFont.load_default()
        except Exception:
            font = ImageFont.load_default()
        
        # Get text bounding box
        bbox = draw.textbbox((0, 0), text, font=font)
        text_width = bbox[2] - bbox[0]
        text_height = bbox[3] - bbox[1]
        
        # Tile watermark across image (with larger spacing for performance)
        spacing_y = text_height * 4
        spacing_x = text_width + 80
        
        for y in range(0, img.height, spacing_y):
            for x in range(0, img.width, spacing_x):
                draw.text((x, y), text, font=font, fill=(255, 255, 255, 50))
        
        # Composite
        watermarked = Image.alpha_composite(img, txt_layer)
        
        # Convert back to RGB for saving as JPEG
        if output_path.lower().endswith('.jpg') or output_path.lower().endswith('.jpeg'):
            watermarked = watermarked.convert('RGB')
        
        # Save with optimized settings
        watermarked.save(output_path, quality=80, optimize=True)
        
        processing_time_ms = (time.time() - start_time) * 1000
        logging.info(f"Watermark applied in {processing_time_ms:.0f}ms for {original_size[0]}x{original_size[1]} image")
        
        return output_path, processing_time_ms
        
    except Exception as e:
        processing_time_ms = (time.time() - start_time) * 1000
        logging.error(f"Watermark error after {processing_time_ms:.0f}ms: {e}")
        # If watermarking fails, just copy the original
        shutil.copy(image_path, output_path)
        return output_path, processing_time_ms


@router.post("/upload")
async def upload_general_file(
    file: UploadFile = File(...)
):
    """
    General file upload endpoint for selfies, profile photos, etc.
    Returns a URL to the uploaded file.
    Supports iPhone HEIC format with automatic conversion to JPEG.
    """
    # Validate file type - only allow images
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="Invalid file type. Allowed: JPEG, PNG, WebP, GIF, HEIC")
    
    # Read file content
    content = await file.read()
    
    # Check file size
    if len(content) > MAX_IMAGE_SIZE:
        raise HTTPException(status_code=400, detail=f"File too large. Maximum size is {MAX_IMAGE_SIZE // (1024*1024)}MB")
    
    # Convert HEIC/HEIF to JPEG (iPhone photos)
    actual_content_type = file.content_type
    if file.content_type in ('image/heic', 'image/heif'):
        if not HEIF_SUPPORT:
            raise HTTPException(status_code=400, detail="HEIC format not supported. Please convert to JPEG.")
        content, actual_content_type = convert_heic_to_jpeg(content)
    
    # Generate unique filename
    ext = get_file_extension(actual_content_type)
    filename = f"{uuid.uuid4()}{ext}"
    
    # Create general uploads subdirectory
    general_dir = UPLOAD_DIR / "general"
    general_dir.mkdir(exist_ok=True)
    
    file_path = general_dir / filename
    
    # Save file
    with open(file_path, "wb") as f:
        f.write(content)
    
    # Generate URL
    file_url = f"/api/uploads/general/{filename}"
    
    return {
        "url": file_url,
        "filename": filename,
        "size": len(content),
        "content_type": actual_content_type
    }


@router.get("/uploads/general/{filename}")
async def get_general_upload(filename: str):
    """Serve general uploaded files"""
    file_path = UPLOAD_DIR / "general" / filename
    
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    
    return FileResponse(file_path)


@router.post("/upload/story")
async def upload_story_media(
    file: UploadFile = File(...),
    user_id: str = Form(...)
):
    """Upload media for a story (image or video)"""
    # Validate file type
    if file.content_type not in ALLOWED_IMAGE_TYPES and file.content_type not in ALLOWED_VIDEO_TYPES:
        raise HTTPException(status_code=400, detail="Invalid file type. Allowed: JPEG, PNG, WebP, GIF, MP4, MOV, WebM")
    
    # Read file content
    content = await file.read()
    
    # Check file size
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail=f"File too large. Maximum size is {MAX_FILE_SIZE // (1024*1024)}MB")
    
    # Generate unique filename
    ext = get_file_extension(file.content_type)
    filename = f"{uuid.uuid4()}{ext}"
    
    # Determine media type
    media_type = "video" if file.content_type in ALLOWED_VIDEO_TYPES else "image"
    
    # Create stories subdirectory
    stories_dir = UPLOAD_DIR / "stories"
    stories_dir.mkdir(exist_ok=True)
    
    file_path = stories_dir / filename
    
    # Save file
    with open(file_path, "wb") as f:
        f.write(content)
    
    # Generate URL
    media_url = f"/api/uploads/stories/{filename}"
    
    return {
        "media_url": media_url,
        "media_type": media_type,
        "filename": filename,
        "size": len(content)
    }

@router.post("/upload/conditions")
async def upload_conditions_media(
    file: UploadFile = File(...),
    user_id: str = Form(...)
):
    """
    Upload conditions check media (photo or video) for a live session go-live.
    Returns a URL that is then passed to the /photographer/{id}/go-live endpoint
    as condition_media_url instead of inline base64 (which causes network errors
    due to large JSON body size).
    """
    is_video = file.content_type in ALLOWED_VIDEO_TYPES

    # Accept both images and videos; also accept unknown types as video/webm from browser MediaRecorder
    if file.content_type not in ALLOWED_IMAGE_TYPES and file.content_type not in ALLOWED_VIDEO_TYPES:
        # MediaRecorder on some browsers produces "video/webm" without codec suffix - still accept it
        if not file.content_type.startswith("video/"):
            raise HTTPException(
                status_code=400,
                detail="Invalid file type. Please upload an image (JPEG, PNG, WebP) or video (MP4, MOV, WebM)."
            )
        is_video = True

    content = await file.read()

    max_size = MAX_FILE_SIZE if is_video else MAX_IMAGE_SIZE
    if len(content) > max_size:
        raise HTTPException(
            status_code=400,
            detail=f"File too large. Max {max_size // (1024 * 1024)}MB for {'video' if is_video else 'image'}."
        )

    # Use .webm extension for browser-recorded video (content_type may be "video/webm")
    ext = get_file_extension(file.content_type) if file.content_type in {**dict.fromkeys(ALLOWED_IMAGE_TYPES), **dict.fromkeys(ALLOWED_VIDEO_TYPES)} else ".webm"
    filename = f"{uuid.uuid4()}{ext}"
    media_type = "video" if is_video else "image"

    conditions_dir = UPLOAD_DIR / "conditions" / user_id
    conditions_dir.mkdir(parents=True, exist_ok=True)

    file_path = conditions_dir / filename
    with open(file_path, "wb") as f:
        f.write(content)

    # Upload to Supabase for persistence (Render disk is ephemeral)
    local_url = f"/api/uploads/conditions/{user_id}/{filename}"
    supabase_url = upload_to_supabase_storage(
        file_path, 'conditions',
        f"{user_id}/{filename}",
        content_type=file.content_type or ('video/webm' if is_video else 'image/jpeg')
    )
    media_url = supabase_url or local_url
    if supabase_url:
        logger.info(f"Condition media persisted to Supabase: {supabase_url}")
    else:
        logger.warning(f"Condition media saved to ephemeral disk only: {local_url}")

    return {
        "media_url": media_url,
        "media_type": media_type,
        "filename": filename,
        "size": len(content),
        "persistent": bool(supabase_url)
    }


@router.get("/uploads/conditions/{user_id}/{filename}")
async def get_conditions_media(user_id: str, filename: str):
    """Serve conditions check media file"""
    file_path = UPLOAD_DIR / "conditions" / user_id / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(file_path)


@router.post("/upload/gallery")
async def upload_gallery_media(
    file: UploadFile = File(...),
    user_id: str = Form(...),
    add_watermark_preview: bool = Form(True)
):
    """Upload media for gallery (creates watermarked preview).
    Persists to Supabase Storage for durable URLs; falls back to local disk."""
    # Validate file type - gallery only accepts images
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="Gallery only accepts images: JPEG, PNG, WebP, GIF")
    
    content = await file.read()
    
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail=f"File too large. Maximum size is {MAX_FILE_SIZE // (1024*1024)}MB")
    
    # Generate unique filename
    ext = get_file_extension(file.content_type)
    base_filename = str(uuid.uuid4())
    original_filename = f"{base_filename}_original{ext}"
    preview_filename = f"{base_filename}_preview{ext}"
    
    # Create gallery subdirectory (local working copy)
    gallery_dir = UPLOAD_DIR / "gallery" / user_id
    gallery_dir.mkdir(parents=True, exist_ok=True)
    
    original_path = gallery_dir / original_filename
    preview_path = gallery_dir / preview_filename
    
    # Save original (high-res) locally first
    with open(original_path, "wb") as f:
        f.write(content)
    
    # Create watermarked preview
    watermark_time_ms = 0
    if add_watermark_preview:
        _, watermark_time_ms = add_watermark(str(original_path), str(preview_path))
    else:
        shutil.copy(original_path, preview_path)
    
    # --- Persist to Supabase Storage for durable URLs ---
    content_type_img = file.content_type or 'image/jpeg'
    supabase_original = upload_to_supabase_storage(
        original_path, 'gallery', f'{user_id}/{original_filename}', content_type_img
    )
    supabase_preview = upload_to_supabase_storage(
        preview_path, 'gallery', f'{user_id}/{preview_filename}', content_type_img
    )
    
    # Use Supabase URLs if available, otherwise fall back to ephemeral local paths
    final_original = supabase_original or f"/api/uploads/gallery/{user_id}/{original_filename}"
    final_preview = supabase_preview or f"/api/uploads/gallery/{user_id}/{preview_filename}"
    
    return {
        "original_url": final_original,
        "preview_url": final_preview,
        "filename": base_filename,
        "size": len(content),
        "has_watermark": add_watermark_preview,
        "watermark_time_ms": watermark_time_ms,
        "storage": "supabase" if supabase_original else "local"
    }

@router.post("/upload/avatar")
async def upload_avatar(
    file: UploadFile = File(...),
    user_id: str = Form(...)
):
    """Upload user avatar"""
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="Avatar must be an image: JPEG, PNG, WebP, GIF")
    
    content = await file.read()
    
    # Avatars max 5MB
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Avatar too large. Maximum size is 5MB")
    
    ext = get_file_extension(file.content_type)
    filename = f"{user_id}{ext}"
    
    avatars_dir = UPLOAD_DIR / "avatars"
    avatars_dir.mkdir(exist_ok=True)
    
    file_path = avatars_dir / filename
    
    # Resize avatar to reasonable size
    try:
        img = Image.open(io.BytesIO(content))
        img.thumbnail((500, 500), Image.LANCZOS)
        
        if img.mode in ('RGBA', 'P'):
            img = img.convert('RGB')
        
        img.save(file_path, "JPEG", quality=85)
    except Exception as e:
        logging.warning(f"Could not process image, saving as raw: {e}")
        with open(file_path, "wb") as f:
            f.write(content)
    
    return {
        "avatar_url": f"/api/uploads/avatars/{filename}",
        "filename": filename
    }

@router.get("/uploads/stories/{filename}")
async def get_story_media(filename: str):
    """Serve story media file"""
    file_path = UPLOAD_DIR / "stories" / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(file_path)

@router.get("/uploads/gallery/{user_id}/{filename}")
async def get_gallery_media(user_id: str, filename: str):
    """Serve gallery media file"""
    file_path = UPLOAD_DIR / "gallery" / user_id / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(file_path)

@router.get("/uploads/avatars/{filename}")
async def get_avatar(filename: str):
    """Serve avatar file"""
    file_path = UPLOAD_DIR / "avatars" / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(file_path)


@router.get("/uploads/crew_chat/{filename}")
async def get_crew_chat_media(filename: str):
    """Serve crew chat media files (images, voice notes)"""
    file_path = UPLOAD_DIR / "crew_chat" / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    
    # Set appropriate content type for audio files
    content_type = None
    if filename.endswith('.webm'):
        content_type = "audio/webm"
    elif filename.endswith('.m4a'):
        content_type = "audio/mp4"
    elif filename.endswith('.wav'):
        content_type = "audio/wav"
    elif filename.endswith('.ogg'):
        content_type = "audio/ogg"
    
    if content_type:
        return FileResponse(file_path, media_type=content_type)
    return FileResponse(file_path)


@router.get("/uploads/chat_media/{filename}")
async def get_chat_media(filename: str):
    """Serve direct message chat media files (images, videos, voice notes)"""
    file_path = UPLOAD_DIR / "chat_media" / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    
    # Set appropriate content type
    content_type = None
    lower_filename = filename.lower()
    if lower_filename.endswith('.webm'):
        content_type = "audio/webm"
    elif lower_filename.endswith('.m4a'):
        content_type = "audio/mp4"
    elif lower_filename.endswith('.wav'):
        content_type = "audio/wav"
    elif lower_filename.endswith('.ogg'):
        content_type = "audio/ogg"
    elif lower_filename.endswith('.mp4'):
        content_type = "video/mp4"
    elif lower_filename.endswith('.mov'):
        content_type = "video/quicktime"
    elif lower_filename.endswith(('.jpg', '.jpeg')):
        content_type = "image/jpeg"
    elif lower_filename.endswith('.png'):
        content_type = "image/png"
    elif lower_filename.endswith('.gif'):
        content_type = "image/gif"
    elif lower_filename.endswith('.webp'):
        content_type = "image/webp"
    
    if content_type:
        return FileResponse(file_path, media_type=content_type)
    return FileResponse(file_path)


@router.post("/upload/feed")
async def upload_feed_media(
    file: UploadFile = File(...),
    user_id: str = Form(...),
    db: AsyncSession = Depends(get_db)
):
    """
    Upload media for a feed post (image or video)
    Videos are automatically transcoded to 1080p max for all users
    """
    # Validate file type
    is_video = file.content_type in ALLOWED_VIDEO_TYPES
    is_image = file.content_type in ALLOWED_IMAGE_TYPES
    
    if not is_video and not is_image:
        raise HTTPException(
            status_code=400, 
            detail="Invalid file type. Allowed: JPEG, PNG, WebP, GIF, MP4, MOV, WebM"
        )
    
    # Read file content
    content = await file.read()
    
    # Check file size
    max_size = MAX_FILE_SIZE if is_video else MAX_IMAGE_SIZE
    if len(content) > max_size:
        raise HTTPException(
            status_code=400, 
            detail=f"File too large. Maximum size is {max_size // (1024*1024)}MB"
        )
    
    # Create feed subdirectory
    feed_dir = UPLOAD_DIR / "feed"
    feed_dir.mkdir(exist_ok=True)
    
    if is_video:
        # Process video with automatic 1080p transcoding
        success, error, result = await asyncio.to_thread(
            process_video_upload,
            content,
            file.filename or "video.mp4",
            feed_dir,
            user_subscription='free',  # Feed posts always capped at 1080p
            upload_type='feed'
        )
        
        if not success:
            raise HTTPException(status_code=400, detail=f"Video processing failed: {error}")

        video_path = feed_dir / result['filename']
        thumbnail_filename = f"{result['filename'].rsplit('.', 1)[0]}_thumb.jpg"
        thumbnail_path = feed_dir / thumbnail_filename

        # Generate smart thumbnail
        thumbnail_url = None
        thumb_success, _ = await asyncio.to_thread(
            generate_video_thumbnail,
            str(video_path),
            str(thumbnail_path),
            'smart'
        )

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
        # Handle image upload
        ext = get_file_extension(file.content_type)
        filename = f"{uuid.uuid4()}{ext}"
        file_path = feed_dir / filename
        
        with open(file_path, "wb") as f:
            f.write(content)
        
        media_url = f"/api/uploads/feed/{filename}"
        
        return {
            "media_url": media_url,
            "media_type": "image",
            "filename": filename,
            "size": len(content)
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
    """
    # Waves must be video
    if file.content_type not in ALLOWED_VIDEO_TYPES:
        raise HTTPException(
            status_code=400,
            detail="Waves must be video: MP4, MOV, or WebM"
        )
    
    content = await file.read()
    
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"File too large. Maximum size is {MAX_FILE_SIZE // (1024*1024)}MB"
        )
    
    # Create waves subdirectory
    waves_dir = UPLOAD_DIR / "waves"
    waves_dir.mkdir(exist_ok=True)
    
    # Save temp file to check duration
    temp_filename = f"temp_{uuid.uuid4()}.mp4"
    temp_path = waves_dir / temp_filename
    
    with open(temp_path, "wb") as f:
        f.write(content)
    
    # Get video info to check duration and aspect ratio
    video_info = get_video_info(str(temp_path))
    
    if not video_info:
        # ffprobe not available or video unreadable — proceed with fallback metadata
        logger.warning("Could not read video metadata (ffprobe missing?), proceeding with defaults")
        video_info = {
            'width': 0,
            'height': 0,
            'duration': 0,
            'codec': 'unknown',
            'bitrate': 0,
            'size': len(content)
        }
    else:
        # ENFORCE 60-SECOND LIMIT for music label compliance (only if we have real metadata)
        if video_info.get('duration', 0) > MAX_WAVE_DURATION:
            os.remove(temp_path)
            raise HTTPException(
                status_code=400,
                detail=f"Waves must be {MAX_WAVE_DURATION} seconds or less. Your video is {video_info['duration']:.1f} seconds."
            )
    
    # Calculate aspect ratio
    width = video_info.get('width', 0)
    height = video_info.get('height', 0)
    
    if width > 0 and height > 0:
        ratio = height / width
        if ratio >= 1.7:  # ~9:16
            aspect_ratio = '9:16'
        elif ratio >= 1.2:  # ~4:5
            aspect_ratio = '4:5'
        elif ratio >= 0.9:  # ~1:1
            aspect_ratio = '1:1'
        else:  # landscape
            aspect_ratio = '16:9'
    else:
        aspect_ratio = '9:16'  # Default for Waves
    
    # Clean up temp file
    os.remove(temp_path)
    
    # Process video with transcoding
    success, error, result = await asyncio.to_thread(
        process_video_upload,
        content,
        file.filename or "wave.mp4",
        waves_dir,
        user_subscription='free',  # Waves capped at 1080p
        upload_type='feed'
    )
    
    if not success:
        # Fallback: save raw video without transcoding
        logger.warning(f"Wave transcoding failed ({error}), saving raw video instead")
        raw_filename = f"{uuid.uuid4()}.mp4"
        raw_path = waves_dir / raw_filename
        with open(raw_path, "wb") as f:
            f.write(content)
        result = {
            'filename': raw_filename,
            'original_width': width,
            'original_height': height,
            'final_width': width,
            'final_height': height,
            'duration': video_info.get('duration', 0),
            'was_transcoded': False,
            'size': len(content),
        }
    
    media_url = f"/api/uploads/waves/{result['filename']}"
    
    # Generate thumbnail
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
    
    # ── Upload to Supabase for persistence ──
    if SUPABASE_STORAGE_AVAILABLE:
        wave_remote_key = f"waves/{user_id}/{result['filename']}"
        supa_media = upload_to_supabase_storage(video_path, 'feed', wave_remote_key, content_type='video/mp4')
        if supa_media:
            media_url = supa_media
            logger.info(f'Wave video uploaded to Supabase: {supa_media}')
        
        if thumb_success and thumbnail_path.exists():
            thumb_remote_key = f"waves/{user_id}/{thumbnail_filename}"
            supa_thumb = upload_to_supabase_storage(thumbnail_path, 'feed', thumb_remote_key, content_type='image/jpeg')
            if supa_thumb:
                thumbnail_url = supa_thumb
    
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
    return FileResponse(file_path)


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
        ext = get_file_extension(file.content_type)
        base_filename = str(uuid.uuid4())
        original_filename = f"{base_filename}_original{ext}"
        preview_filename = f"{base_filename}_preview{ext}"
        
        original_path = gallery_dir / original_filename
        preview_path = gallery_dir / preview_filename
        
        # Auto-rotate based on EXIF orientation (fixes sideways mobile photos)
        try:
            from PIL import Image as PILImage, ImageOps
            from io import BytesIO
            img = PILImage.open(BytesIO(content))
            img = ImageOps.exif_transpose(img)
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
        except Exception as exif_err:
            logger.warning(f"EXIF auto-rotate failed ({exif_err}), saving raw file")
            with open(original_path, "wb") as f:
                f.write(content)
        
        # Create watermarked preview
        watermark_time_ms = 0
        if add_watermark_preview:
            _, watermark_time_ms = add_watermark(str(original_path), str(preview_path))
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
            "size": len(content),
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

    return FileResponse(
        file_path,
        media_type=content_type,
        headers={
            'Accept-Ranges': 'bytes',  # Allow browser to seek/scrub video
            'Cache-Control': 'public, max-age=86400',  # 24h cache for videos
        }
    )


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

    return FileResponse(
        file_path,
        media_type=content_type,
        headers={'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=86400'}
    )



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
