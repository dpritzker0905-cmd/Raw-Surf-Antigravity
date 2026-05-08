"""
Gallery admin Ã¢â‚¬â€ cleanup, heal URLs, thumbnails, conditions, AI find-me, migrations.

Part of the gallery package Ã¢â‚¬â€ extracted from the gallery.py monolith.
"""
from fastapi import APIRouter, Depends, HTTPException, Body, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, case
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone, timedelta
import json
import uuid
import logging

gallery_logger = logging.getLogger("routes.gallery")

from database import get_db
from models import (
    Profile, SurfSpot, GalleryItem, GalleryPurchase, Notification,
    RoleEnum, Gallery, LiveSession, LiveSessionParticipant,
    XPTransaction, SurferGalleryItem, SurferSelectionQuota,
    GalleryTierEnum, Booking, BookingParticipant, DispatchRequest,
    ConditionReport
)

from routes.career_hub.gamification import check_badge_milestones
from services.gallery_sync import (
    distribute_gallery_item_to_participants,
    manually_assign_item_to_surfer,
    safe_delete_gallery_item
)
from websocket_manager import broadcast_earnings_update
from services.watermark import watermark_image_from_url, generate_watermarked_preview
from utils.grom_parent import is_grom_parent_eligible

from .schemas import (
    GalleryItemCreate, GalleryItemUpdate, GalleryItemResponse,
    PurchaseRequest, GalleryCreate, GalleryUpdate,
    get_quality_price
)

router = APIRouter()

@router.delete("/gallery/cleanup-empty")
async def cleanup_empty_galleries(
    photographer_id: str,
    protect_gallery_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """
    Delete all empty galleries (item_count=0) for a photographer.
    Protects any gallery specified by protect_gallery_id.
    
    Designed to clean up leftover test galleries from development.
    """
    # Verify photographer exists
    profile_result = await db.execute(select(Profile).where(Profile.id == photographer_id))
    photographer = profile_result.scalar_one_or_none()
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    # Find all empty galleries for this photographer
    query = select(Gallery).where(
        Gallery.photographer_id == photographer_id,
        Gallery.item_count == 0
    )
    
    result = await db.execute(query)
    empty_galleries = result.scalars().all()
    
    deleted_ids = []
    protected_ids = []
    
    for gallery in empty_galleries:
        # Protect specified gallery
        if protect_gallery_id and gallery.id == protect_gallery_id:
            protected_ids.append(gallery.id)
            continue
        
        deleted_ids.append({
            "id": gallery.id,
            "title": gallery.title,
            "created_at": gallery.created_at.isoformat() if gallery.created_at else None
        })
        await db.delete(gallery)
    
    await db.commit()
    
    return {
        "message": f"Deleted {len(deleted_ids)} empty galleries",
        "deleted": deleted_ids,
        "protected": protected_ids,
        "remaining_empty": len(protected_ids)
    }


@router.post("/gallery/{gallery_id}/heal-urls")
async def heal_gallery_item_urls(
    gallery_id: str,
    photographer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Re-upload gallery items with ephemeral local URLs (/api/uploads/...) to Supabase.
    Fixes items that were uploaded before Supabase integration was working or
    when Supabase was temporarily unavailable.
    
    For each item with a local URL:
    1. Read the file from local disk (if it still exists)
    2. Upload to Supabase storage
    3. Update the GalleryItem URLs to point to Supabase
    """
    import os
    from pathlib import Path
    
    # Verify gallery ownership
    result = await db.execute(select(Gallery).where(Gallery.id == gallery_id))
    gallery = result.scalar_one_or_none()
    if not gallery:
        raise HTTPException(status_code=404, detail="Gallery not found")
    if gallery.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    # Get all items with local URLs
    items_result = await db.execute(
        select(GalleryItem).where(
            GalleryItem.gallery_id == gallery_id,
            GalleryItem.is_deleted == False
        )
    )
    items = items_result.scalars().all()
    
    # Try to import Supabase upload function
    try:
        from routes.uploads import upload_to_supabase_storage, UPLOAD_DIR
    except ImportError:
        raise HTTPException(status_code=500, detail="Supabase upload not available")
    
    healed = []
    failed = []
    skipped = []
    
    for item in items:
        # Check if URLs are local (ephemeral)
        urls_to_heal = {}
        if item.original_url and item.original_url.startswith('/api/uploads/'):
            urls_to_heal['original_url'] = item.original_url
        if item.preview_url and item.preview_url.startswith('/api/uploads/'):
            urls_to_heal['preview_url'] = item.preview_url
        if item.thumbnail_url and item.thumbnail_url.startswith('/api/uploads/'):
            urls_to_heal['thumbnail_url'] = item.thumbnail_url
        
        if not urls_to_heal:
            skipped.append({"item_id": item.id, "reason": "Already using persistent URLs"})
            continue
        
        item_healed = {"item_id": item.id, "healed_urls": {}}
        item_failed = False
        
        for field, local_url in urls_to_heal.items():
            # Convert API URL to filesystem path
            # /api/uploads/gallery/USER_ID/filename -> UPLOAD_DIR/gallery/USER_ID/filename
            relative_path = local_url.replace('/api/uploads/', '')
            local_path = UPLOAD_DIR / relative_path
            
            if not local_path.exists():
                failed.append({
                    "item_id": item.id,
                    "field": field,
                    "reason": f"Local file not found: {relative_path}"
                })
                item_failed = True
                continue
            
            # Determine content type
            ext = local_path.suffix.lower()
            content_types = {
                '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
                '.png': 'image/png', '.webp': 'image/webp',
                '.gif': 'image/gif', '.mp4': 'video/mp4',
                '.mov': 'video/mp4', '.webm': 'video/webm'
            }
            content_type = content_types.get(ext, 'application/octet-stream')
            
            # Upload to Supabase
            supabase_url = upload_to_supabase_storage(
                local_path, 'gallery',
                relative_path.replace('gallery/', '', 1) if relative_path.startswith('gallery/') else relative_path,
                content_type=content_type
            )
            
            if supabase_url:
                setattr(item, field, supabase_url)
                item_healed["healed_urls"][field] = supabase_url
            else:
                failed.append({
                    "item_id": item.id,
                    "field": field,
                    "reason": "Supabase upload failed"
                })
                item_failed = True
        
        if item_healed["healed_urls"]:
            healed.append(item_healed)
    
    # Also heal gallery cover image if it's local
    if gallery.cover_image_url and gallery.cover_image_url.startswith('/api/uploads/'):
        relative_path = gallery.cover_image_url.replace('/api/uploads/', '')
        local_path = UPLOAD_DIR / relative_path
        
        if local_path.exists():
            ext = local_path.suffix.lower()
            ct = 'image/jpeg' if ext in ('.jpg', '.jpeg') else 'image/png'
            supabase_url = upload_to_supabase_storage(
                local_path, 'conditions',
                relative_path.replace('conditions/', '', 1) if relative_path.startswith('conditions/') else relative_path,
                content_type=ct
            )
            if supabase_url:
                gallery.cover_image_url = supabase_url
                healed.append({"field": "gallery_cover", "healed_url": supabase_url})
    
    await db.commit()
    
    return {
        "message": f"Healed {len(healed)} items, {len(failed)} failed, {len(skipped)} already persistent",
        "gallery_id": gallery_id,
        "healed": healed,
        "failed": failed,
        "skipped": skipped
    }


@router.delete("/surfer-gallery/item/{surfer_gallery_item_id}")
async def remove_surfer_gallery_item(
    surfer_gallery_item_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Admin: Remove a specific item from a surfer's locker by its surfer_gallery_item ID."""
    result = await db.execute(
        select(SurferGalleryItem).where(SurferGalleryItem.id == surfer_gallery_item_id)
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Surfer gallery item not found")
    
    await db.delete(item)
    await db.commit()
    return {"deleted": True, "surfer_gallery_item_id": surfer_gallery_item_id}


@router.post("/gallery/{gallery_id}/recalculate-counts")
async def recalculate_gallery_counts(
    gallery_id: str,
    fix_cover: bool = True,
    db: AsyncSession = Depends(get_db)
):
    """Admin: Recalculate the cached item_count column and optionally fix the cover image.
    Use this when items were deleted but the count wasn't decremented.
    Also cleans up stale items with broken local/ephemeral URLs."""
    try:
        gallery = await db.get(Gallery, gallery_id)
        if not gallery:
            raise HTTPException(status_code=404, detail="Gallery not found")
        
        # Find and delete stale items with ephemeral local URLs
        from sqlalchemy import func, delete
        all_items_result = await db.execute(
            select(GalleryItem).where(GalleryItem.gallery_id == gallery_id)
        )
        all_items = all_items_result.scalars().all()
        
        stale_ids = []
        for item in all_items:
            has_supabase_thumb = item.thumbnail_url and item.thumbnail_url.startswith('https://')
            has_supabase_preview = item.preview_url and item.preview_url.startswith('https://')
            if not has_supabase_thumb and not has_supabase_preview:
                stale_ids.append(item.id)
        
        stale_count = 0
        delete_errors = []
        for item_id in stale_ids:
            try:
                await db.execute(
                    delete(GalleryItem).where(GalleryItem.id == item_id)
                )
                stale_count += 1
            except Exception as del_err:
                delete_errors.append(f"{item_id[:8]}: {str(del_err)[:50]}")
        
        if stale_count > 0:
            await db.flush()
        
        # Count actual remaining items
        count_result = await db.execute(
            select(func.count(GalleryItem.id)).where(GalleryItem.gallery_id == gallery_id)
        )
        actual_count = count_result.scalar() or 0
        old_count = gallery.item_count
        gallery.item_count = actual_count
        
        cover_fixed = False
        old_cover = gallery.cover_image_url
        
        # Fix cover image if it's a local path
        if fix_cover and (
            not gallery.cover_image_url or 
            gallery.cover_image_url.startswith('/api/uploads/')
        ):
            first_item_result = await db.execute(
                select(GalleryItem)
                .where(GalleryItem.gallery_id == gallery_id)
                .order_by(GalleryItem.created_at.desc())
                .limit(1)
            )
            first_item = first_item_result.scalar_one_or_none()
            if first_item:
                cover_url = first_item.thumbnail_url or first_item.preview_url
                if cover_url and cover_url.startswith('https://'):
                    gallery.cover_image_url = cover_url
                    cover_fixed = True
        
        await db.commit()
        
        result = {
            "gallery_id": gallery_id,
            "old_item_count": old_count,
            "new_item_count": actual_count,
            "stale_items_purged": stale_count,
            "cover_fixed": cover_fixed,
            "old_cover": old_cover,
            "new_cover": gallery.cover_image_url
        }
        if delete_errors:
            result["delete_errors"] = delete_errors
        return result
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        return {"error": str(e), "traceback": traceback.format_exc()}


# Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
# ADMIN: Correct Session Content Settings
# Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â

class UpdateSessionSettingsRequest(BaseModel):
    photos_included: Optional[int] = None
    videos_included: Optional[int] = None


@router.patch("/gallery/{gallery_id}/session-settings")
async def update_session_settings(
    gallery_id: str,
    photographer_id: str = Query(..., description="Photographer ID for authorization"),
    data: UpdateSessionSettingsRequest = Body(...),
    db: AsyncSession = Depends(get_db)
):
    """
    Correct the photos_included / videos_included for a session's gallery.
    Updates the linked LiveSession, Booking, or DispatchRequest record.
    Only the gallery owner (photographer) can do this.
    """
    gallery_result = await db.execute(
        select(Gallery)
        .where(Gallery.id == gallery_id)
        .options(selectinload(Gallery.live_session))
    )
    gallery = gallery_result.scalar_one_or_none()
    
    if not gallery:
        raise HTTPException(status_code=404, detail="Gallery not found")
    if gallery.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    updated = {}
    
    if gallery.live_session_id and gallery.live_session:
        ls = gallery.live_session
        if data.photos_included is not None:
            old_val = ls.photos_included
            ls.photos_included = data.photos_included
            updated["photos_included"] = {"old": old_val, "new": data.photos_included}
        if data.videos_included is not None:
            old_val = ls.videos_included
            ls.videos_included = data.videos_included
            updated["videos_included"] = {"old": old_val, "new": data.videos_included}
    elif gallery.booking_id:
        bk_result = await db.execute(
            select(Booking).where(Booking.id == gallery.booking_id)
        )
        booking = bk_result.scalar_one_or_none()
        if booking and data.photos_included is not None:
            old_val = booking.booking_photos_included
            booking.booking_photos_included = data.photos_included
            updated["photos_included"] = {"old": old_val, "new": data.photos_included}
    else:
        raise HTTPException(status_code=400, detail="No linked session to update")
    
    if not updated:
        return {"message": "No changes made", "gallery_id": gallery_id}
    
    await db.commit()
    
    gallery_logger.info(
        f"Updated session settings for gallery {gallery_id}: {updated}"
    )
    
    return {
        "success": True,
        "gallery_id": gallery_id,
        "updated": updated,
        "message": "Session content settings updated. Roster will reflect changes on next load."
    }


class SetThumbnailRequest(BaseModel):
    item_id: Optional[str] = None
    thumbnail_url: Optional[str] = None  # Direct URL override (for conditions report sync)


@router.patch("/galleries/{gallery_id}/set-thumbnail")
async def set_gallery_thumbnail(
    gallery_id: str,
    photographer_id: str,
    data: SetThumbnailRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Manually set a gallery's cover thumbnail.
    
    Accepts either:
    - item_id: Use that item's preview/thumbnail as the cover
    - thumbnail_url: Direct URL to use as the cover
    
    This gives photographers full control over which image
    represents their session folder in the gallery hub.
    """
    result = await db.execute(
        select(Gallery).where(Gallery.id == gallery_id)
    )
    gallery = result.scalar_one_or_none()
    
    if not gallery:
        raise HTTPException(status_code=404, detail="Gallery not found")
    if gallery.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    new_cover_url = None
    
    if data.item_id:
        # Find the item and use its preview URL
        item_result = await db.execute(
            select(GalleryItem).where(
                GalleryItem.id == data.item_id,
                GalleryItem.photographer_id == photographer_id
            )
        )
        item = item_result.scalar_one_or_none()
        if not item:
            raise HTTPException(status_code=404, detail="Gallery item not found")
        
        new_cover_url = item.preview_url or item.thumbnail_url or item.original_url
    elif data.thumbnail_url:
        new_cover_url = data.thumbnail_url
    else:
        raise HTTPException(
            status_code=400, 
            detail="Must provide either item_id or thumbnail_url"
        )
    
    if not new_cover_url:
        raise HTTPException(status_code=400, detail="No valid thumbnail URL found for this item")
    
    old_cover = gallery.cover_image_url
    gallery.cover_image_url = new_cover_url
    
    # Sync to linked condition reports Ã¢â‚¬â€ when the gallery thumbnail changes,
    # any condition report linked via the same live_session_id should also update.
    # This prevents blank/broken photos on SpotHub's condition reports section.
    # DEFENSIVE: wrap in try/except so CR sync issues never block cover photo updates.
    synced_reports = 0
    try:
        if gallery.live_session_id:
            linked_reports = await db.execute(
                select(ConditionReport).where(
                    ConditionReport.live_session_id == gallery.live_session_id,
                    ConditionReport.photographer_id == photographer_id
                )
            )
            for report in linked_reports.scalars().all():
                report.thumbnail_url = new_cover_url
                # If media_url is broken (local path), also update it
                if report.media_url and report.media_url.startswith('/api/uploads/'):
                    report.media_url = new_cover_url
                synced_reports += 1
        
        # Also check if there are condition reports by this photographer at the same spot
        # that were created around the same time as the gallery
        if synced_reports == 0 and gallery.surf_spot_id:
            spot_reports = await db.execute(
                select(ConditionReport).where(
                    ConditionReport.photographer_id == photographer_id,
                    ConditionReport.spot_id == gallery.surf_spot_id,
                    ConditionReport.is_active.is_(True)
                ).order_by(ConditionReport.created_at.desc()).limit(1)
            )
            latest_report = spot_reports.scalar_one_or_none()
            if latest_report:
                latest_report.thumbnail_url = new_cover_url
                if latest_report.media_url and latest_report.media_url.startswith('/api/uploads/'):
                    latest_report.media_url = new_cover_url
                synced_reports += 1
    except Exception as sync_err:
        gallery_logger.warning(
            f"Gallery {gallery_id} cover updated but CR sync failed: {sync_err}"
        )
    
    await db.commit()
    
    gallery_logger.info(
        f"Gallery {gallery_id} thumbnail manually set: {old_cover} -> {new_cover_url}"
        + (f" (synced {synced_reports} condition reports)" if synced_reports > 0 else "")
    )
    
    return {
        "success": True,
        "gallery_id": gallery_id,
        "cover_image_url": new_cover_url,
        "condition_reports_synced": synced_reports,
        "message": "Gallery thumbnail updated successfully"
    }


@router.patch("/galleries/{gallery_id}/clear-thumbnail")
async def clear_gallery_thumbnail(
    gallery_id: str,
    photographer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Clear a gallery's manually-set cover thumbnail.
    The auto-heal logic will select a new one from gallery items on next load.
    """
    result = await db.execute(
        select(Gallery).where(Gallery.id == gallery_id)
    )
    gallery = result.scalar_one_or_none()
    
    if not gallery:
        raise HTTPException(status_code=404, detail="Gallery not found")
    if gallery.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    gallery.cover_image_url = None
    await db.commit()
    
    gallery_logger.info(f"Gallery {gallery_id} thumbnail cleared Ã¢â‚¬â€ will auto-select on next load")
    
    return {
        "success": True,
        "gallery_id": gallery_id,
        "message": "Thumbnail cleared. Auto-selection will apply on next page load."
    }



# Push conditions and conditions-status endpoints extracted to gallery_conditions.py (v86)
# AI Find Me extracted to gallery_find_me.py (v85)
# Gallery migrations extracted to gallery_migrations.py (v85)
