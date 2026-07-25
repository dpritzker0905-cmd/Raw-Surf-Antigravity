"""Uploads core — diagnostics, general upload, story, conditions, avatar, static file serving."""
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
    process_video_from_path,
    generate_video_thumbnail,
    MAX_FEED_HEIGHT, 
    MAX_FEED_WIDTH,
    MAX_GALLERY_HEIGHT,
    MAX_GALLERY_WIDTH
)
from sqlalchemy import text

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
STREAM_CHUNK_SIZE = 1024 * 1024    # 1 MB chunks for streaming video to disk

# This helper returns public CDN URLs. Keep its contract disjoint from
# services.private_media, which owns signed delivery for sensitive chat media.
PUBLIC_UPLOAD_BUCKETS = frozenset({
    "avatars", "conditions", "gallery", "general", "stories", "user-gallery",
})

# ── Egress-reduction: cache headers for static media ────────────────────
# Filenames contain UUIDs (content-addressed), so aggressive caching is safe.
_IMMUTABLE_CACHE = 'public, max-age=31536000, immutable'  # 1 year
_SHORT_CACHE     = 'public, max-age=86400'                 # 24 hours

def _cached_file_response(
    path: Path,
    *,
    media_type: str | None = None,
    cache_control: str = _IMMUTABLE_CACHE,
) -> FileResponse:
    """Wrap FileResponse with Cache-Control + Accept-Ranges headers."""
    headers = {
        'Cache-Control': cache_control,
        'Accept-Ranges': 'bytes',
    }
    if media_type:
        return FileResponse(path, media_type=media_type, headers=headers)
    return FileResponse(path, headers=headers)


def upload_to_supabase_storage(local_path: Path, bucket: str, remote_key: str, content_type: str = 'video/mp4') -> str | None:
    """Upload a product-public asset and return its public CDN URL.

    Bucket provisioning is deliberately outside this request path. A missing or
    private bucket is a deploy/configuration failure, not a reason to silently
    change a bucket's access model at runtime.
    """
    _log = logging.getLogger(__name__)
    if bucket not in PUBLIC_UPLOAD_BUCKETS:
        _log.error("Rejected non-public bucket from public upload helper: %s", bucket)
        return None
    if not SUPABASE_STORAGE_AVAILABLE or _supabase is None:
        _log.warning('Supabase Storage not available (client=%s, available=%s)', _supabase is not None, SUPABASE_STORAGE_AVAILABLE)
        return None
    try:
        with open(local_path, 'rb') as f:
            data = f.read()
        _log.info('Uploading %d bytes to Supabase bucket=%s key=%s', len(data), bucket, remote_key)
        # Public bucket state is provisioned and verified by SQL migration, not here.

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

def add_watermark(
    image_path: str,
    output_path: str,
    text: str = "RAW SURF OS",
    logo_path: str = None,
    position: str = "tiled",
    opacity: float = 0.12,
    style: str = "text"
) -> tuple:
    """
    Add custom text or logo watermark to an image.
    Returns (output_path, processing_time_ms)
    Optimized for sub-2-second processing of 5MB images.
    Memory-safe: releases intermediate PIL images between steps.
    """
    import time
    import gc
    import os
    start_time = time.time()
    
    try:
        from PIL import Image, ImageDraw, ImageFont
        
        # Open and resize for processing if image is very large
        img = Image.open(image_path)
        original_size = img.size
        
        # For very large images (>4K), resize for watermarking
        max_dimension = 4096
        if img.width > max_dimension or img.height > max_dimension:
            scale = min(max_dimension / img.width, max_dimension / img.height)
            new_size = (int(img.width * scale), int(img.height * scale))
            img = img.resize(new_size, Image.Resampling.LANCZOS)
        
        # Convert to RGBA if needed
        if img.mode != 'RGBA':
            img = img.convert('RGBA')
        
        # Create watermark overlay layer
        overlay_layer = Image.new('RGBA', img.size, (255, 255, 255, 0))
        draw = ImageDraw.Draw(overlay_layer)
        
        # 1. Load and scale custom logo if provided
        has_logo = False
        logo_img = None
        if logo_path and os.path.exists(logo_path) and style in ['logo', 'both']:
            try:
                logo_img = Image.open(logo_path)
                if logo_img.mode != 'RGBA':
                    logo_img = logo_img.convert('RGBA')
                
                # Scale logo to ~18% of background dimensions
                l_w, l_h = logo_img.size
                max_w = int(img.width * 0.18)
                max_h = int(img.height * 0.18)
                scale = min(max_w / l_w, max_h / l_h)
                if scale < 1.0:
                    logo_img = logo_img.resize((int(l_w * scale), int(l_h * scale)), Image.Resampling.LANCZOS)
                
                # Apply opacity blending directly to logo's alpha channel
                r, g, b, a = logo_img.split()
                a = a.point(lambda p: int(p * opacity))
                logo_img = Image.merge('RGBA', (r, g, b, a))
                has_logo = True
            except Exception as le:
                logger.error(f"Error preparing watermark logo: {le}")
                has_logo = False

        # 2. Setup text styling if text is included
        text_width, text_height = 0, 0
        font = None
        if style in ['text', 'both']:
            font_size = max(20, min(img.width, img.height) // 25)
            try:
                font_paths = [
                    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
                    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
                    "/System/Library/Fonts/Helvetica.ttc",
                    "C:/Windows/Fonts/arial.ttf",
                    os.path.join(os.path.dirname(__file__), "..", "assets", "DejaVuSans-Bold.ttf"),
                ]
                for fp in font_paths:
                    if os.path.exists(fp):
                        font = ImageFont.truetype(fp, font_size)
                        break
                if font is None:
                    font = ImageFont.load_default()
            except Exception:
                font = ImageFont.load_default()
            
            bbox = draw.textbbox((0, 0), text, font=font)
            text_width = bbox[2] - bbox[0]
            text_height = bbox[3] - bbox[1]

        # 3. Position and composite watermark
        if position == 'tiled':
            # Repeating grid diagonal watermark
            spacing_y = int((logo_img.height * 4.5) if has_logo else (text_height * 4))
            spacing_x = int((logo_img.width + 150) if has_logo else (text_width + 80))
            
            for y in range(40, img.height, spacing_y):
                for x in range(40, img.width, spacing_x):
                    if has_logo:
                        overlay_layer.paste(logo_img, (x, y), logo_img)
                        if style == 'both':
                            tx = x + (logo_img.width - text_width) // 2
                            ty = y + logo_img.height + 8
                            draw.text((tx, ty), text, font=font, fill=(255, 255, 255, int(opacity * 255)))
                    elif style == 'text':
                        draw.text((x, y), text, font=font, fill=(255, 255, 255, int(opacity * 255)))
        else:
            # Single placement (center or corners)
            margin_w, margin_h = 45, 45
            px, py = margin_w, margin_h
            
            # Width and height of complete watermark stamp
            stamp_w = logo_img.width if has_logo else text_width
            stamp_h = logo_img.height if has_logo else text_height
            if has_logo and style == 'both':
                stamp_w = max(logo_img.width, text_width)
                stamp_h = logo_img.height + text_height + 8
                
            if position == 'center':
                px = (img.width - stamp_w) // 2
                py = (img.height - stamp_h) // 2
            elif position == 'bottom-right':
                px = img.width - stamp_w - margin_w
                py = img.height - stamp_h - margin_h
            elif position == 'bottom-left':
                px = margin_w
                py = img.height - stamp_h - margin_h
            elif position == 'top-right':
                px = img.width - stamp_w - margin_w
                py = margin_h
            elif position == 'top-left':
                px = margin_w
                py = margin_h
                
            # Paste/Draw watermark stamp at px, py
            if has_logo:
                lx = px + (stamp_w - logo_img.width) // 2
                ly = py
                overlay_layer.paste(logo_img, (lx, ly), logo_img)
                if style == 'both':
                    tx = px + (stamp_w - text_width) // 2
                    ty = py + logo_img.height + 8
                    draw.text((tx, ty), text, font=font, fill=(255, 255, 255, int(opacity * 255)))
            elif style == 'text':
                draw.text((px, py), text, font=font, fill=(255, 255, 255, int(opacity * 255)))

        # Composite and immediately release source images
        watermarked = Image.alpha_composite(img, overlay_layer)
        img.close()
        overlay_layer.close()
        if logo_img:
            logo_img.close()
            del logo_img
        del img, overlay_layer, draw
        
        # Convert back to RGB for saving as JPEG
        if output_path.lower().endswith('.jpg') or output_path.lower().endswith('.jpeg'):
            rgb_result = watermarked.convert('RGB')
            watermarked.close()
            del watermarked
            rgb_result.save(output_path, quality=80, optimize=True)
            rgb_result.close()
            del rgb_result
        else:
            watermarked.save(output_path, quality=80, optimize=True)
            watermarked.close()
            del watermarked
        
        gc.collect()
        
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
    
    # Save file locally first
    content_size = len(content)
    with open(file_path, "wb") as f:
        f.write(content)
    
    # Persist to Supabase Storage (Render disk is ephemeral)
    local_url = f"/api/uploads/general/{filename}"
    supabase_url = upload_to_supabase_storage(
        file_path, 'general',
        filename,
        content_type=actual_content_type or 'image/jpeg'
    )
    file_url = supabase_url or local_url
    
    return {
        "url": file_url,
        "filename": filename,
        "size": content_size,
        "content_type": actual_content_type,
        "persistent": bool(supabase_url)
    }


@router.get("/uploads/general/{filename}")
async def get_general_upload(filename: str):
    """Serve general uploaded files"""
    file_path = UPLOAD_DIR / "general" / filename
    
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    
    return _cached_file_response(file_path)


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
    
    # Save file locally first
    content_size = len(content)
    with open(file_path, "wb") as f:
        f.write(content)
    
    # Persist to Supabase Storage (Render disk is ephemeral)
    local_url = f"/api/uploads/stories/{filename}"
    supabase_url = upload_to_supabase_storage(
        file_path, 'stories',
        f"{user_id}/{filename}",
        content_type=file.content_type or ('video/mp4' if media_type == 'video' else 'image/jpeg')
    )
    media_url = supabase_url or local_url
    
    return {
        "media_url": media_url,
        "media_type": media_type,
        "filename": filename,
        "size": content_size,
        "persistent": bool(supabase_url)
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
    return _cached_file_response(file_path, cache_control=_SHORT_CACHE)


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
    
    # Persist to Supabase Storage (Render disk is ephemeral)
    local_url = f"/api/uploads/avatars/{filename}"
    supabase_url = upload_to_supabase_storage(
        file_path, 'avatars',
        filename,
        content_type='image/jpeg'
    )
    avatar_url = supabase_url or local_url
    
    return {
        "avatar_url": avatar_url,
        "filename": filename,
        "persistent": bool(supabase_url)
    }

@router.get("/uploads/stories/{filename}")
async def get_story_media(filename: str):
    """Serve story media file"""
    file_path = UPLOAD_DIR / "stories" / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return _cached_file_response(file_path)

@router.get("/uploads/gallery/{user_id}/{filename}")
async def get_gallery_media(user_id: str, filename: str):
    """Serve gallery media file"""
    file_path = UPLOAD_DIR / "gallery" / user_id / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return _cached_file_response(file_path)

@router.get("/uploads/avatars/{filename}")
async def get_avatar(filename: str):
    """Serve avatar file"""
    file_path = UPLOAD_DIR / "avatars" / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return _cached_file_response(file_path)


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
        return _cached_file_response(file_path, media_type=content_type)
    return _cached_file_response(file_path)


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
        return _cached_file_response(file_path, media_type=content_type)
    return _cached_file_response(file_path)


