"""
Gallery admin — cleanup, heal URLs, thumbnails, conditions, AI find-me, migrations.

Part of the gallery package — extracted from the gallery.py monolith.
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


# ═══════════════════════════════════════════════════════════════════
# ADMIN: Correct Session Content Settings
# ═══════════════════════════════════════════════════════════════════

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
    
    # Sync to linked condition reports — when the gallery thumbnail changes,
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
    
    gallery_logger.info(f"Gallery {gallery_id} thumbnail cleared — will auto-select on next load")
    
    return {
        "success": True,
        "gallery_id": gallery_id,
        "message": "Thumbnail cleared. Auto-selection will apply on next page load."
    }


# ============ PUSH CONDITIONS REPORT TO SPOT HUB ============

class PushConditionsRequest(BaseModel):
    caption: Optional[str] = None
    media_item_id: Optional[str] = None  # Specific gallery item to use as media


@router.post("/galleries/{gallery_id}/push-conditions")
async def push_conditions_to_spot_hub(
    gallery_id: str,
    photographer_id: str,
    data: PushConditionsRequest = PushConditionsRequest(),
    db: AsyncSession = Depends(get_db)
):
    """
    Manually push/sync a conditions report from a gallery to the linked spot hub.
    
    This is a photographer failsafe for when:
    - A gallery was deleted and re-created (orphaning the original CR)
    - A condition report had bad media and needs replacing
    - The auto-sync from set-thumbnail failed
    - The photographer wants to manually refresh their spot hub presence
    
    Behavior:
    - If an existing CR is found for this gallery's session/spot → UPDATE it
      (refresh media, reset 24h expiry, reactivate)
    - If no CR exists → CREATE a new one
    """
    from models import ConditionReport, SurfSpot, GalleryItem, Profile, Story
    
    # Load gallery with relationships
    result = await db.execute(
        select(Gallery).where(Gallery.id == gallery_id)
        .options(
            selectinload(Gallery.surf_spot),
            selectinload(Gallery.items)
        )
    )
    gallery = result.scalar_one_or_none()
    
    if not gallery:
        raise HTTPException(status_code=404, detail="Gallery not found")
    if gallery.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    # Must have a surf spot to push to
    if not gallery.surf_spot_id:
        raise HTTPException(
            status_code=400, 
            detail="This gallery has no linked surf spot. Link a session or assign a spot first."
        )
    
    # Must be linked to a live session — condition reports are tethered to sessions.
    # Without this, orphaned CRs appear on dates with no session record.
    if not gallery.live_session_id:
        raise HTTPException(
            status_code=400,
            detail="This gallery is not linked to a live session. Link a session first, then push to Spot Hub."
        )
    
    # Resolve media URL to use for the condition report
    media_url = None
    media_type = 'image'
    
    # Option 1: Use a specific gallery item
    if data.media_item_id:
        item_result = await db.execute(
            select(GalleryItem).where(
                GalleryItem.id == data.media_item_id,
                GalleryItem.gallery_id == gallery_id
            )
        )
        item = item_result.scalar_one_or_none()
        if item:
            # Use unwatermarked original for condition reports (they're promotional, not for sale)
            media_url = item.original_url or item.url_standard or item.url_web or item.thumbnail_url
            media_type = item.media_type or 'image'
    
    # Option 2: Use gallery cover image
    if not media_url and gallery.cover_image_url:
        media_url = gallery.cover_image_url
    
    # Option 3: Use first gallery item
    if not media_url and gallery.items:
        sorted_items = sorted(gallery.items, key=lambda i: i.created_at or datetime.min)
        for item in sorted_items:
            # Use unwatermarked original for condition reports
            candidate = item.original_url or item.url_standard or item.url_web or item.thumbnail_url
            if candidate:
                media_url = candidate
                media_type = item.media_type or 'image'
                break
    
    if not media_url:
        raise HTTPException(
            status_code=400, 
            detail="No media available in this gallery to use for the condition report."
        )
    
    # Get spot info
    spot = gallery.surf_spot
    spot_name = spot.name if spot else None
    region = spot.region if spot else None
    latitude = spot.latitude if spot else None
    longitude = spot.longitude if spot else None
    
    # Get photographer info
    prof_result = await db.execute(select(Profile).where(Profile.id == photographer_id))
    photographer = prof_result.scalar_one_or_none()
    
    # Look for an existing condition report to update
    # ONLY match by live_session_id — prevents cross-session contamination
    # when multiple sessions happen at the same spot
    existing_cr = None
    
    if gallery.live_session_id:
        cr_result = await db.execute(
            select(ConditionReport).where(
                ConditionReport.live_session_id == gallery.live_session_id,
                ConditionReport.photographer_id == photographer_id
            ).order_by(ConditionReport.created_at.desc())
        )
        existing_cr = cr_result.scalars().first()
    
    # Caption
    caption = data.caption or (gallery.title if gallery.title else f"Conditions at {spot_name or 'surf spot'}")
    
    # Use the gallery's original session date for created_at so the CR
    # appears at the correct time in feeds (not "just now")
    original_date = gallery.session_date or gallery.created_at or datetime.now(timezone.utc)
    
    # Expiration: 24 hours from NOW so the report is visible for the next day
    expires_at = datetime.now(timezone.utc) + timedelta(hours=24)
    
    action = "updated"
    
    if existing_cr:
        # UPDATE existing condition report
        existing_cr.media_url = media_url
        existing_cr.media_type = media_type
        existing_cr.caption = caption
        existing_cr.expires_at = expires_at
        existing_cr.is_expired = False
        existing_cr.is_active = True
        # Preserve the original created_at from the session date
        existing_cr.created_at = original_date
        
        # Update thumbnail_url if the field exists
        try:
            existing_cr.thumbnail_url = media_url
        except Exception:
            pass
        
        condition_report_id = existing_cr.id
        gallery_logger.info(
            f"Push-conditions: UPDATED CR {existing_cr.id} for gallery {gallery_id} → spot {spot_name}"
        )
    else:
        # CREATE new condition report
        action = "created"
        cr_kwargs = dict(
            photographer_id=photographer_id,
            spot_id=gallery.surf_spot_id,
            media_url=media_url,
            media_type=media_type,
            caption=caption,
            spot_name=spot_name,
            region=region,
            latitude=latitude,
            longitude=longitude,
            live_session_id=gallery.live_session_id,
            expires_at=expires_at,
            is_active=True,
            created_at=original_date,
        )
        # Only set optional fields if model supports them
        try:
            cr_kwargs['is_expired'] = False
            cr_kwargs['thumbnail_url'] = media_url
        except Exception:
            pass
        
        new_cr = ConditionReport(**cr_kwargs)
        db.add(new_cr)
        await db.flush()
        condition_report_id = new_cr.id
        
        gallery_logger.info(
            f"Push-conditions: CREATED new CR {new_cr.id} for gallery {gallery_id} → spot {spot_name} (date={original_date})"
        )
    
    await db.commit()
    
    return {
        "success": True,
        "action": action,
        "condition_report_id": condition_report_id,
        "spot_name": spot_name,
        "spot_id": gallery.surf_spot_id,
        "media_url": media_url,
        "expires_at": expires_at.isoformat(),
        "session_date": original_date.isoformat() if original_date else None,
        "message": f"Conditions report {action} for {spot_name or 'spot hub'}! Visible for 24 hours."
    }


@router.get("/galleries/{gallery_id}/conditions-status")
async def get_gallery_conditions_status(
    gallery_id: str,
    photographer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Check if a condition report already exists for this gallery's linked spot.
    Returns status info so the frontend can show the right button label.
    """
    from models import ConditionReport
    
    result = await db.execute(
        select(Gallery).where(Gallery.id == gallery_id)
    )
    gallery = result.scalar_one_or_none()
    
    if not gallery:
        raise HTTPException(status_code=404, detail="Gallery not found")
    if gallery.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    if not gallery.surf_spot_id:
        return {
            "has_spot": False,
            "has_active_report": False,
            "report_id": None,
            "expires_at": None,
            "is_expired": True
        }
    
    # Look for existing CR — ONLY by live_session_id to prevent cross-session confusion
    existing_cr = None
    
    if gallery.live_session_id:
        cr_result = await db.execute(
            select(ConditionReport).where(
                ConditionReport.live_session_id == gallery.live_session_id,
                ConditionReport.photographer_id == photographer_id
            ).order_by(ConditionReport.created_at.desc())
        )
        existing_cr = cr_result.scalars().first()
    
    now = datetime.now(timezone.utc)
    
    if existing_cr:
        expires = existing_cr.expires_at
        if expires and expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        is_expired = getattr(existing_cr, 'is_expired', False) or (expires and expires < now)
        return {
            "has_spot": True,
            "has_active_report": not is_expired,
            "report_id": existing_cr.id,
            "expires_at": expires.isoformat() if expires else None,
            "is_expired": is_expired,
            "media_url": existing_cr.media_url
        }
    
    return {
        "has_spot": True,
        "has_active_report": False,
        "report_id": None,
        "expires_at": None,
        "is_expired": True
    }


# ============ AI "FIND ME" IN GALLERY ============


class FindMeRequest(BaseModel):
    selfie_url: str
    board_description: Optional[str] = None
    wetsuit_description: Optional[str] = None
    rash_guard_description: Optional[str] = None
    stance: Optional[str] = None  # 'regular' or 'goofy'


@router.post("/gallery/{gallery_id}/find-me")
async def find_me_in_gallery(
    gallery_id: str,
    user_id: str,
    data: FindMeRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    AI-powered surfer identification in a gallery.
    Scans gallery photos and returns matches ranked by confidence.
    
    Rate limits:
      - Free/Basic: 5 scans/day, max 150 photos/scan
      - Premium: 10 scans/day, unlimited photos/scan
    """
    # Verify user exists
    user_result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = user_result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Determine tier limits
    subscription_tier = getattr(user, 'subscription_tier', 'free') or 'free'
    is_premium = subscription_tier in ('premium', 'pro', 'gold')
    max_scans_per_day = 10 if is_premium else 5
    max_photos_per_scan = None if is_premium else 150  # None = unlimited
    
    # Check daily scan count (use XPTransaction as a scan log)
    from sqlalchemy import func
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    scan_count_result = await db.execute(
        select(func.count(XPTransaction.id)).where(
            XPTransaction.user_id == user_id,
            XPTransaction.transaction_type == 'find_me_scan',
            XPTransaction.created_at >= today_start
        )
    )
    scans_today = scan_count_result.scalar() or 0
    
    if scans_today >= max_scans_per_day:
        tier_label = "Premium" if is_premium else "Free/Basic"
        raise HTTPException(
            status_code=429,
            detail=f"Daily scan limit reached ({max_scans_per_day}/day for {tier_label} users). "
                   f"{'Try again tomorrow.' if is_premium else 'Upgrade to Premium for 10 scans/day.'}"
        )
    
    # Get gallery (public OR private — access check below)
    gallery_result = await db.execute(
        select(Gallery).where(Gallery.id == gallery_id)
    )
    gallery = gallery_result.scalar_one_or_none()
    if not gallery:
        raise HTTPException(status_code=404, detail="Gallery not found")
    
    # Access control: public = anyone, private = owner or session participants only
    if not gallery.is_public:
        if gallery.photographer_id == user_id:
            pass  # Owner always has access
        else:
            # Check if user has a selection quota (= was assigned to this session)
            quota_result = await db.execute(
                select(SurferSelectionQuota).where(
                    SurferSelectionQuota.surfer_id == user_id,
                    SurferSelectionQuota.gallery_id == gallery_id
                )
            )
            if not quota_result.scalar_one_or_none():
                # Also check by live_session_id as a fallback
                has_session_access = False
                if gallery.live_session_id:
                    session_quota = await db.execute(
                        select(SurferSelectionQuota).where(
                            SurferSelectionQuota.surfer_id == user_id,
                            SurferSelectionQuota.live_session_id == gallery.live_session_id
                        )
                    )
                    has_session_access = session_quota.scalar_one_or_none() is not None
                if not has_session_access:
                    raise HTTPException(
                        status_code=403,
                        detail="This gallery is private. Only session participants can scan it."
                    )
    
    # Fetch gallery items (watermarked previews for AI analysis)
    items_query = select(GalleryItem).where(
        GalleryItem.gallery_id == gallery_id,
        GalleryItem.is_public.is_(True),
        GalleryItem.is_deleted.is_(False)
    ).order_by(GalleryItem.created_at.desc())
    
    if max_photos_per_scan:
        items_query = items_query.limit(max_photos_per_scan)
    
    items_result = await db.execute(items_query)
    items = items_result.scalars().all()
    
    if not items:
        return {
            "matches": [],
            "total_photos_scanned": 0,
            "matches_found": 0,
            "gallery_id": gallery_id,
            "message": "No photos in this gallery to scan"
        }
    
    # Build surfer profile for AI matching
    from services.ai_identity_matching import SurferProfile, batch_analyze_session_photos
    
    surfer_profile = SurferProfile(
        profile_photo_url=user.avatar_url,
        session_selfie_url=data.selfie_url,
        board_description=data.board_description,
        wetsuit_description=data.wetsuit_description,
        rash_guard_description=data.rash_guard_description,
        stance=data.stance
    )
    
    # Get photo URLs for analysis (use preview_url for watermarked previews)
    photo_urls = []
    url_to_item = {}
    for item in items:
        url = item.preview_url or item.original_url
        if url:
            photo_urls.append(url)
            url_to_item[url] = item
    
    # Build session context
    spot_name = gallery.title or "Unknown Spot"
    session_context = f"Session at {spot_name}"
    if gallery.session_date:
        session_context += f" on {gallery.session_date.strftime('%B %d, %Y')}"
    
    # Run AI batch analysis
    gallery_logger.info(
        f"Find Me scan: user={user_id}, gallery={gallery_id}, "
        f"photos={len(photo_urls)}, tier={subscription_tier}"
    )
    
    ai_results = await batch_analyze_session_photos(
        photo_urls=photo_urls,
        surfer_profile=surfer_profile,
        session_context=session_context
    )
    
    # Process results and build response
    matches = []
    for result in ai_results:
        if result.get("is_match") and result.get("confidence", 0) >= 0.3:
            item = url_to_item.get(result["photo_url"])
            if item:
                matches.append({
                    "gallery_item_id": item.id,
                    "preview_url": item.preview_url,
                    "thumbnail_url": item.thumbnail_url,
                    "media_type": item.media_type or 'image',
                    "confidence": round(result["confidence"], 2),
                    "match_methods": result.get("match_methods", []),
                    "reasoning": result.get("details", {}).get("reasoning", ""),
                    "is_for_sale": item.is_for_sale,
                    "price": item.price
                })
    
    # Sort by confidence (highest first)
    matches.sort(key=lambda x: x["confidence"], reverse=True)
    
    # Log the scan (for rate limiting)
    scan_log = XPTransaction(
        user_id=user_id,
        transaction_type='find_me_scan',
        xp_amount=0,
        description=f"AI Find Me scan in gallery {gallery_id} ({len(matches)} matches from {len(photo_urls)} photos)"
    )
    db.add(scan_log)
    await db.commit()
    
    # Fire push notification if matches were found (best-effort, never blocks response)
    if matches:
        try:
            from routes.notifications.push import notify_photos_found_ai
            spot_name = gallery.title or "Unknown Spot"
            await notify_photos_found_ai(
                surfer_id=user_id,
                gallery_id=gallery_id,
                match_count=len(matches),
                spot_name=spot_name
            )
        except Exception as push_err:
            gallery_logger.warning(f"Find-Me push notification failed: {push_err}")
    
    return {
        "matches": matches,
        "total_photos_scanned": len(photo_urls),
        "matches_found": len(matches),
        "gallery_id": gallery_id,
        "scans_remaining_today": max_scans_per_day - scans_today - 1,
        "max_photos_per_scan": max_photos_per_scan or "unlimited",
        "subscription_tier": subscription_tier
    }


# ═══════════════════════════════════════════════════════════════════
# ADMIN: Migrate Gallery Titles to Date · Time · Location · Type
# ═══════════════════════════════════════════════════════════════════

SESSION_TYPE_LABELS = {
    'live': 'Live Session',
    'on_demand': 'On-Demand',
    'booking': 'Booking',
    'manual': 'Gallery',
    None: 'Gallery',
}


@router.post("/gallery/migrate-titles")
async def migrate_gallery_titles(
    photographer_id: str = Query(..., description="Photographer ID for authorization"),
    dry_run: bool = Query(False, description="If true, preview changes without saving"),
    db: AsyncSession = Depends(get_db)
):
    """
    Retroactively update all gallery titles to the new format:
      Date · Time · Location · Type
    
    Skips galleries whose title already contains ' · ' (already migrated).
    Use dry_run=true to preview changes before committing.
    """
    import re

    # Verify photographer exists
    profile_result = await db.execute(select(Profile).where(Profile.id == photographer_id))
    photographer = profile_result.scalar_one_or_none()
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")

    # Fetch all galleries for this photographer, eager-load surf_spot
    result = await db.execute(
        select(Gallery)
        .where(Gallery.photographer_id == photographer_id)
        .options(selectinload(Gallery.surf_spot))
    )
    galleries = result.scalars().all()

    updated = []
    skipped = []

    for g in galleries:
        # Skip already-migrated titles (contain · separator)
        if g.title and ' · ' in g.title:
            skipped.append({"id": g.id, "title": g.title, "reason": "already_migrated"})
            continue

        # Need session_date to build the new title
        ts = g.session_date or g.created_at
        if not ts:
            skipped.append({"id": g.id, "title": g.title, "reason": "no_date"})
            continue

        # Format date and time components
        date_part = ts.strftime("%b %d, %Y")
        try:
            time_part = ts.strftime("%-I:%M %p")  # Linux/Mac
        except ValueError:
            time_part = ts.strftime("%#I:%M %p")  # Windows

        # Get spot name from relationship or parse from existing title
        spot_name = None
        if g.surf_spot:
            spot_name = g.surf_spot.name
        elif g.title:
            # Try to extract spot name from old-format title
            # Old format: "Live Session at Cocoa Beach Pier - April 26, 2026 at 1:00 PM"
            match = re.search(r'(?:Session|Gallery) at (.+?)(?:\s*-\s*)', g.title)
            if match:
                spot_name = match.group(1).strip()

        # Build type label
        type_label = SESSION_TYPE_LABELS.get(g.session_type, 'Gallery')

        # Assemble new title
        if spot_name:
            new_title = f"{date_part} · {time_part} · {spot_name} · {type_label}"
        else:
            new_title = f"{date_part} · {time_part} · {type_label}"

        old_title = g.title
        updated.append({
            "id": g.id,
            "old_title": old_title,
            "new_title": new_title,
        })

        if not dry_run:
            g.title = new_title

    if not dry_run and updated:
        await db.commit()

    return {
        "message": f"{'Would update' if dry_run else 'Updated'} {len(updated)} gallery titles, skipped {len(skipped)}",
        "dry_run": dry_run,
        "updated": updated,
        "skipped": skipped,
    }


# ═══════════════════════════════════════════════════════════════════
# ADMIN: Clean up GalleryItem titles (replace hash/UUID filenames)
# ═══════════════════════════════════════════════════════════════════

def _is_hash_title(title: str) -> bool:
    """Detect if a title is a non-human-readable hash, UUID, or numeric string.
    Returns True for titles like:
      - '517123533_30162777753884_4533105'
      - 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
      - '2f3a4b5c_original'
    """
    if not title:
        return True
    import re
    cleaned = title.strip()
    # UUID pattern
    if re.match(r'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}', cleaned, re.I):
        return True
    # UUID without dashes (32 hex chars)
    if re.match(r'^[a-f0-9]{32}', cleaned, re.I):
        return True
    # Strip common suffixes like _original, _preview
    base = re.sub(r'_(original|preview|thumb|thumbnail)$', '', cleaned)
    # All digits + underscores (Instagram-style) — at least 10 chars
    if re.match(r'^[\d_]+$', base) and len(base) >= 10:
        return True
    # Mostly digits/hex with underscores — >70% non-alpha in a long string
    alpha_count = sum(1 for c in base if c.isalpha() and c not in 'abcdefABCDEF')
    if len(base) > 15 and alpha_count < len(base) * 0.3:
        return True
    return False


@router.post("/gallery/{gallery_id}/clean-item-titles")
async def clean_gallery_item_titles(
    gallery_id: str,
    photographer_id: str = Query(..., description="Photographer ID for authorization"),
    dry_run: bool = Query(False, description="If true, preview changes without saving"),
    db: AsyncSession = Depends(get_db)
):
    """
    Replace hash/UUID/numeric-only item titles with clean sequential names.
    
    Photos become: "Surf Photo 1", "Surf Photo 2", …
    Videos become: "Surf Video 1", "Surf Video 2", …
    
    Only renames items whose current title looks like a system-generated hash.
    Items with human-readable titles are left untouched.
    """
    # Verify gallery ownership
    result = await db.execute(select(Gallery).where(Gallery.id == gallery_id))
    gallery = result.scalar_one_or_none()
    if not gallery:
        raise HTTPException(status_code=404, detail="Gallery not found")
    if gallery.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized")

    # Get all items, ordered by creation date
    items_result = await db.execute(
        select(GalleryItem)
        .where(
            GalleryItem.gallery_id == gallery_id,
            GalleryItem.is_deleted == False
        )
        .order_by(GalleryItem.created_at.asc())
    )
    items = items_result.scalars().all()

    photo_counter = 0
    video_counter = 0
    updated = []
    skipped = []

    for item in items:
        is_video = item.media_type == 'video'

        if is_video:
            video_counter += 1
        else:
            photo_counter += 1

        if not _is_hash_title(item.title):
            skipped.append({"id": item.id, "title": item.title, "reason": "human_readable"})
            continue

        if is_video:
            new_title = f"Surf Video {video_counter}"
        else:
            new_title = f"Surf Photo {photo_counter}"

        updated.append({
            "id": item.id,
            "old_title": item.title,
            "new_title": new_title,
        })

        if not dry_run:
            item.title = new_title

    if not dry_run and updated:
        await db.commit()

    return {
        "message": f"{'Would rename' if dry_run else 'Renamed'} {len(updated)} items, skipped {len(skipped)} (already readable)",
        "gallery_id": gallery_id,
        "dry_run": dry_run,
        "updated": updated,
        "skipped": skipped,
    }


@router.post("/gallery/clean-all-item-titles")
async def clean_all_item_titles(
    photographer_id: str = Query(..., description="Photographer ID for authorization"),
    dry_run: bool = Query(False, description="If true, preview changes without saving"),
    db: AsyncSession = Depends(get_db)
):
    """
    Batch version: Clean up hash-style item titles across ALL galleries for a photographer.
    Calls the per-gallery logic for each gallery.
    """
    # Verify photographer exists
    profile_result = await db.execute(select(Profile).where(Profile.id == photographer_id))
    photographer = profile_result.scalar_one_or_none()
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")

    # Get all galleries
    result = await db.execute(
        select(Gallery).where(Gallery.photographer_id == photographer_id)
    )
    galleries = result.scalars().all()

    total_updated = 0
    total_skipped = 0
    gallery_results = []

    for g in galleries:
        items_result = await db.execute(
            select(GalleryItem)
            .where(
                GalleryItem.gallery_id == g.id,
                GalleryItem.is_deleted == False
            )
            .order_by(GalleryItem.created_at.asc())
        )
        items = items_result.scalars().all()

        photo_counter = 0
        video_counter = 0
        g_updated = 0

        for item in items:
            is_video = item.media_type == 'video'
            if is_video:
                video_counter += 1
            else:
                photo_counter += 1

            if not _is_hash_title(item.title):
                total_skipped += 1
                continue

            new_title = f"Surf Video {video_counter}" if is_video else f"Surf Photo {photo_counter}"

            if not dry_run:
                item.title = new_title
            g_updated += 1
            total_updated += 1

        if g_updated > 0:
            gallery_results.append({
                "gallery_id": g.id,
                "gallery_title": g.title,
                "items_renamed": g_updated,
            })

    if not dry_run and total_updated > 0:
        await db.commit()

    return {
        "message": f"{'Would rename' if dry_run else 'Renamed'} {total_updated} items across {len(gallery_results)} galleries, skipped {total_skipped}",
        "dry_run": dry_run,
        "total_updated": total_updated,
        "total_skipped": total_skipped,
        "galleries": gallery_results,
    }


# ── Admin: Heal Session Dates ─────────────────────────────────────────────────
# Backfill NULL session_date values on legacy galleries using linked metadata.
# Secured via JWT admin auth.
from deps.admin_auth import get_current_admin

@router.post("/gallery/admin/heal-session-dates")
async def heal_session_dates(
    dry_run: bool = Query(default=True, description="Preview changes without committing"),
    admin: dict = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Backfill NULL session_date values on galleries using metadata from linked
    LiveSession, Booking, or DispatchRequest records.

    Priority order:
      1. LiveSession.started_at (most accurate — actual session start)
      2. Booking.session_date (scheduled date)
      3. DispatchRequest.created_at (on-demand request timestamp)
      4. Gallery.created_at (last-resort fallback)

    Use dry_run=true (default) to preview before committing.
    """
    # Fetch all galleries with NULL session_date
    result = await db.execute(
        select(Gallery).where(Gallery.session_date.is_(None))
    )
    galleries = result.scalars().all()

    healed = []
    skipped = []

    for gallery in galleries:
        source = None
        healed_date = None

        # 1. Try linked LiveSession
        if gallery.live_session_id:
            ls_result = await db.execute(
                select(LiveSession).where(LiveSession.id == gallery.live_session_id)
            )
            live_session = ls_result.scalar_one_or_none()
            if live_session and live_session.started_at:
                healed_date = live_session.started_at
                source = "live_session.started_at"

        # 2. Try linked Booking
        if not healed_date and gallery.booking_id:
            bk_result = await db.execute(
                select(Booking).where(Booking.id == gallery.booking_id)
            )
            booking = bk_result.scalar_one_or_none()
            if booking and booking.session_date:
                healed_date = booking.session_date
                source = "booking.session_date"

        # 3. Try linked DispatchRequest
        if not healed_date and gallery.dispatch_request_id:
            dr_result = await db.execute(
                select(DispatchRequest).where(DispatchRequest.id == gallery.dispatch_request_id)
            )
            dispatch = dr_result.scalar_one_or_none()
            if dispatch and dispatch.created_at:
                healed_date = dispatch.created_at
                source = "dispatch_request.created_at"

        # 4. Fallback to gallery.created_at
        if not healed_date and gallery.created_at:
            healed_date = gallery.created_at
            source = "gallery.created_at (fallback)"

        if healed_date:
            if not dry_run:
                gallery.session_date = healed_date
            healed.append({
                "gallery_id": gallery.id,
                "title": gallery.title,
                "source": source,
                "healed_date": healed_date.isoformat() if healed_date else None,
            })
        else:
            skipped.append({
                "gallery_id": gallery.id,
                "title": gallery.title,
                "reason": "No linked metadata found"
            })

    if not dry_run and healed:
        await db.commit()

    return {
        "message": f"{'Would heal' if dry_run else 'Healed'} {len(healed)} galleries, skipped {len(skipped)}",
        "dry_run": dry_run,
        "total_null": len(galleries),
        "total_healed": len(healed),
        "total_skipped": len(skipped),
        "healed": healed,
        "skipped": skipped,
    }

