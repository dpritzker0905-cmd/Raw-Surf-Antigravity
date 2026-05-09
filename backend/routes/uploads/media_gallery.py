"""
media_gallery.py — User gallery, photographer gallery, watermark test, and session photo uploads.
Extracted from media.py (v88 decomposition).
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
    MAX_FILE_SIZE, MAX_IMAGE_SIZE,
    SUPABASE_STORAGE_AVAILABLE,
    upload_to_supabase_storage, get_file_extension, add_watermark,
    _cached_file_response, _SHORT_CACHE,
)
from utils.video_processor import (
    process_video_upload, generate_video_thumbnail
)
from PIL import Image, ImageDraw, ImageFont
import io

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/upload/user-gallery")
async def upload_user_gallery_media(
    file: UploadFile = File(...),
    user_id: str = Form(...),
    db: AsyncSession = Depends(get_db)
):
    """Upload media to user's personal gallery. Videos transcoded to 1080p."""
    is_video = file.content_type in ALLOWED_VIDEO_TYPES
    is_image = file.content_type in ALLOWED_IMAGE_TYPES
    if not is_video and not is_image:
        raise HTTPException(status_code=400, detail="Invalid file type. Allowed: JPEG, PNG, WebP, GIF, MP4, MOV, WebM")
    content = await file.read()
    max_size = MAX_FILE_SIZE if is_video else MAX_IMAGE_SIZE
    if len(content) > max_size:
        raise HTTPException(status_code=400, detail=f"File too large. Maximum size is {max_size // (1024*1024)}MB")
    user_gallery_dir = UPLOAD_DIR / "user-gallery" / user_id
    user_gallery_dir.mkdir(parents=True, exist_ok=True)
    if is_video:
        success, error, result = await asyncio.to_thread(
            process_video_upload, content, file.filename or "video.mp4",
            user_gallery_dir, user_subscription='free', upload_type='feed'
        )
        if not success:
            raise HTTPException(status_code=400, detail=f"Video processing failed: {error}")
        media_url = f"/api/uploads/user-gallery/{user_id}/{result['filename']}"
        thumbnail_url = None
        video_path = user_gallery_dir / result['filename']
        thumbnail_filename = f"{result['filename'].rsplit('.', 1)[0]}_thumb.jpg"
        thumbnail_path = user_gallery_dir / thumbnail_filename
        thumb_success, _ = await asyncio.to_thread(
            generate_video_thumbnail, str(video_path), str(thumbnail_path), 'smart'
        )
        if thumb_success:
            thumbnail_url = f"/api/uploads/user-gallery/{user_id}/{thumbnail_filename}"
        return {
            "media_url": media_url, "media_type": "video", "thumbnail_url": thumbnail_url,
            "filename": result['filename'], "original_width": result['original_width'],
            "original_height": result['original_height'],
            "final_width": result.get('final_width'), "final_height": result.get('final_height'),
            "duration": result['duration'], "was_transcoded": result['was_transcoded'],
            "size": result.get('size', 0)
        }
    else:
        ext = get_file_extension(file.content_type)
        filename = f"{uuid.uuid4()}{ext}"
        file_path = user_gallery_dir / filename
        with open(file_path, "wb") as f:
            f.write(content)
        local_url = f"/api/uploads/user-gallery/{user_id}/{filename}"
        supabase_url = upload_to_supabase_storage(
            file_path, 'user-gallery', f"{user_id}/{filename}",
            content_type=file.content_type or 'image/jpeg'
        )
        media_url = supabase_url or local_url
        return {"media_url": media_url, "media_type": "image", "filename": filename,
                "size": len(content), "persistent": bool(supabase_url)}


@router.post("/upload/photographer-gallery")
async def upload_photographer_gallery_media(
    file: UploadFile = File(...), user_id: str = Form(...),
    add_watermark_preview: bool = Form(True), db: AsyncSession = Depends(get_db)
):
    """Upload media for photographer's gallery. Paid photographers can upload 4K videos."""
    result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    subscription = user.subscription_tier or 'free'
    is_paid = subscription in ['basic', 'premium']
    is_video = file.content_type in ALLOWED_VIDEO_TYPES
    is_image = file.content_type in ALLOWED_IMAGE_TYPES
    if not is_video and not is_image:
        raise HTTPException(status_code=400, detail="Invalid file type. Allowed: JPEG, PNG, WebP, GIF, MP4, MOV, WebM")
    content = await file.read()
    max_size = MAX_FILE_SIZE if is_video else MAX_IMAGE_SIZE
    if len(content) > max_size:
        raise HTTPException(status_code=400, detail=f"File too large. Maximum size is {max_size // (1024*1024)}MB")
    gallery_dir = UPLOAD_DIR / "gallery" / user_id
    gallery_dir.mkdir(parents=True, exist_ok=True)
    if is_video:
        success, error, result_data = await asyncio.to_thread(
            process_video_upload, content, file.filename or "video.mp4",
            gallery_dir, user_subscription=subscription, upload_type='gallery'
        )
        if not success:
            fallback_filename = f"{uuid.uuid4()}.mp4"
            fallback_path = gallery_dir / fallback_filename
            with open(fallback_path, "wb") as fb:
                fb.write(content)
            logger.warning(f"Video processing failed ({error}), saved raw file: {fallback_filename}")
            result_data = {'filename': fallback_filename, 'original_width': 0, 'original_height': 0,
                           'duration': 0, 'was_transcoded': False, 'size': len(content)}
        original_url = f"/api/uploads/gallery/{user_id}/{result_data['filename']}"
        preview_url = original_url
        thumbnail_url = None
        try:
            video_path = gallery_dir / result_data['filename']
            thumbnail_filename = f"{result_data['filename'].rsplit('.', 1)[0]}_thumb.jpg"
            thumbnail_path = gallery_dir / thumbnail_filename
            thumb_success, _ = await asyncio.to_thread(
                generate_video_thumbnail, str(video_path), str(thumbnail_path), 'smart'
            )
            if thumb_success:
                thumbnail_url = f"/api/uploads/gallery/{user_id}/{thumbnail_filename}"
        except Exception as thumb_err:
            logger.warning(f"Thumbnail generation skipped: {thumb_err}")
        max_res = "4K" if is_paid else "1080p"
        supabase_original = upload_to_supabase_storage(
            gallery_dir / result_data['filename'], 'gallery',
            f"{user_id}/{result_data['filename']}", content_type=file.content_type or 'video/mp4'
        )
        supabase_thumb = None
        if thumbnail_url and thumbnail_filename:
            supabase_thumb = upload_to_supabase_storage(
                gallery_dir / thumbnail_filename, 'gallery',
                f"{user_id}/{thumbnail_filename}", content_type='image/jpeg'
            )
        final_original = supabase_original or original_url
        final_preview = supabase_original or preview_url
        final_thumbnail = supabase_thumb or thumbnail_url
        return {
            "original_url": final_original, "preview_url": final_preview,
            "thumbnail_url": final_thumbnail, "media_type": "video",
            "filename": result_data['filename'],
            "original_width": result_data['original_width'],
            "original_height": result_data['original_height'],
            "final_width": result_data.get('final_width'),
            "final_height": result_data.get('final_height'),
            "duration": result_data['duration'],
            "was_transcoded": result_data['was_transcoded'],
            "size": result_data.get('size', 0),
            "max_allowed_resolution": max_res, "has_watermark": False
        }
    else:
        import gc
        ext = get_file_extension(file.content_type)
        base_filename = str(uuid.uuid4())
        original_filename = f"{base_filename}_original{ext}"
        preview_filename = f"{base_filename}_preview{ext}"
        original_path = gallery_dir / original_filename
        preview_path = gallery_dir / preview_filename
        content_size = len(content)
        try:
            from PIL import Image as PILImage, ImageOps
            from io import BytesIO
            img = PILImage.open(BytesIO(content))
            img = ImageOps.exif_transpose(img)
            del content
            gc.collect()
            save_kwargs = {}
            if ext.lower() in ('.jpg', '.jpeg'):
                save_kwargs = {'quality': 95, 'exif': b''}
            elif ext.lower() == '.png':
                save_kwargs = {'optimize': True}
            elif ext.lower() == '.webp':
                save_kwargs = {'quality': 95}
            img.save(str(original_path), **save_kwargs)
            logger.info(f"Saved EXIF-corrected image: {original_filename}")
            img.close()
            del img
            gc.collect()
        except Exception as exif_err:
            logger.warning(f"EXIF auto-rotate failed ({exif_err}), saving raw file")
            with open(original_path, "wb") as f:
                f.write(content)
            try:
                del content
            except NameError:
                pass
            gc.collect()
        watermark_time_ms = 0
        if add_watermark_preview:
            _, watermark_time_ms = add_watermark(str(original_path), str(preview_path))
            gc.collect()
        else:
            shutil.copy(original_path, preview_path)
        local_original_url = f"/api/uploads/gallery/{user_id}/{original_filename}"
        local_preview_url = f"/api/uploads/gallery/{user_id}/{preview_filename}"
        supabase_original = upload_to_supabase_storage(
            original_path, 'gallery', f"{user_id}/{original_filename}",
            content_type=file.content_type or 'image/jpeg'
        )
        supabase_preview = upload_to_supabase_storage(
            preview_path, 'gallery', f"{user_id}/{preview_filename}",
            content_type=file.content_type or 'image/jpeg'
        )
        return {
            "original_url": supabase_original or local_original_url,
            "preview_url": supabase_preview or local_preview_url,
            "media_type": "image", "filename": base_filename,
            "size": content_size, "has_watermark": add_watermark_preview,
            "watermark_time_ms": watermark_time_ms
        }


@router.post("/uploads/test-watermark")
async def test_watermark_performance(file: UploadFile = File(...)):
    """Test watermarking performance. Target: <2 seconds for 5MB image."""
    import time
    import tempfile
    start_time = time.time()
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="Invalid file type")
    content = await file.read()
    file_size_mb = len(content) / (1024 * 1024)
    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as input_file:
        input_file.write(content)
        input_path = input_file.name
    output_path = input_path.replace(".jpg", "_watermarked.jpg")
    _, watermark_time_ms = add_watermark(input_path, output_path)
    total_time_ms = (time.time() - start_time) * 1000
    with open(output_path, "rb") as f:
        watermarked_content = f.read()
    output_size_mb = len(watermarked_content) / (1024 * 1024)
    os.unlink(input_path)
    os.unlink(output_path)
    return {
        "input_size_mb": round(file_size_mb, 2), "output_size_mb": round(output_size_mb, 2),
        "watermark_time_ms": round(watermark_time_ms, 0), "total_time_ms": round(total_time_ms, 0),
        "meets_2_second_target": total_time_ms < 2000
    }


@router.post("/photos/upload")
async def upload_session_photo(
    file: UploadFile = File(...), photographer_id: str = Form(...),
    gallery_id: Optional[str] = Form(None), session_id: Optional[str] = Form(None),
    tagged_surfer_ids: Optional[str] = Form(None), price: Optional[float] = Form(None),
    is_session_photo: bool = Form(False), media_type: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db)
):
    """Upload a photo or video from a live session with optional surfer tagging."""
    result = await db.execute(select(Profile).where(Profile.id == photographer_id))
    photographer = result.scalar_one_or_none()
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    is_video = file.content_type in ALLOWED_VIDEO_TYPES
    is_image = file.content_type in ALLOWED_IMAGE_TYPES
    if not is_video and not is_image:
        raise HTTPException(status_code=400, detail="Invalid file type. Supported: images and videos")
    content = await file.read()
    max_size = MAX_FILE_SIZE if is_video else MAX_IMAGE_SIZE
    if len(content) > max_size:
        raise HTTPException(status_code=400, detail=f"File too large. Max {max_size // (1024*1024)}MB")
    gallery_dir = UPLOAD_DIR / "gallery" / photographer_id
    gallery_dir.mkdir(parents=True, exist_ok=True)
    ext = file.filename.rsplit('.', 1)[-1].lower() if file.filename else ('mp4' if is_video else 'jpg')
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    filename = f"session_{timestamp}_{str(uuid.uuid4())[:8]}.{ext}"
    file_path = gallery_dir / filename
    with open(file_path, 'wb') as f:
        f.write(content)
    original_url = f"/api/uploads/gallery/{photographer_id}/{filename}"
    preview_url = original_url
    if is_image:
        preview_filename = f"preview_{filename}"
        preview_path = gallery_dir / preview_filename
        try:
            img = Image.open(io.BytesIO(content))
            img.thumbnail((1200, 1200), Image.Resampling.LANCZOS)
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
            bbox = draw.textbbox((0, 0), watermark_text, font=font)
            text_width = bbox[2] - bbox[0]
            text_height = bbox[3] - bbox[1]
            x = (img.width - text_width) // 2
            y = (img.height - text_height) // 2
            draw.text((x, y), watermark_text, font=font, fill=(255, 255, 255, 100))
            img.save(preview_path, quality=85)
            preview_url = f"/api/uploads/gallery/{photographer_id}/{preview_filename}"
        except Exception as e:
            logger.error(f"Watermark error: {e}")
    elif is_video:
        try:
            thumbnail_filename = f"thumb_{filename.rsplit('.', 1)[0]}.jpg"
            thumbnail_path = gallery_dir / thumbnail_filename
            from utils.video_processor import generate_video_thumbnail as gen_thumb
            thumbnail_success = await gen_thumb(str(file_path), str(thumbnail_path))
            if thumbnail_success:
                preview_url = f"/api/uploads/gallery/{photographer_id}/{thumbnail_filename}"
        except Exception as e:
            logger.error(f"Video thumbnail error: {e}")
    tagged_ids = []
    if tagged_surfer_ids:
        try:
            tagged_ids = json.loads(tagged_surfer_ids)
        except Exception:
            pass
    final_media_type = 'video' if is_video else 'image'
    if media_type and media_type in ['image', 'video']:
        final_media_type = media_type
    from models import generate_uuid
    gallery_item = GalleryItem(
        id=generate_uuid(), photographer_id=photographer_id, gallery_id=gallery_id,
        original_url=original_url, preview_url=preview_url, media_type=final_media_type,
        price=price or (15.0 if is_video else 5.0), is_public=True,
        tagged_surfer_ids=json.dumps(tagged_ids) if tagged_ids else None,
        session_id=session_id
    )
    db.add(gallery_item)
    await db.commit()
    await db.refresh(gallery_item)
    return {
        "success": True, "id": gallery_item.id, "original_url": original_url,
        "preview_url": preview_url, "tagged_surfers": len(tagged_ids),
        "price": gallery_item.price, "media_type": final_media_type
    }
