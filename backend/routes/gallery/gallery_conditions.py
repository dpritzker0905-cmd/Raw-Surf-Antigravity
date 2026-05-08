"""
Gallery Conditions — push condition reports to Spot Hub and check status.

Extracted from admin.py (v86) to keep each module under 800 LOC.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone, timedelta
import logging

gallery_logger = logging.getLogger("routes.gallery")

from database import get_db
from models import (
    Profile, GalleryItem, Gallery, ConditionReport, SurfSpot
)

router = APIRouter()


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
    - If an existing CR is found for this gallery's session/spot -> UPDATE it
      (refresh media, reset 24h expiry, reactivate)
    - If no CR exists -> CREATE a new one
    """
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
    
    # Must be linked to a live session - condition reports are tethered to sessions.
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
    # ONLY match by live_session_id - prevents cross-session contamination
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
            f"Push-conditions: UPDATED CR {existing_cr.id} for gallery {gallery_id} -> spot {spot_name}"
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
            f"Push-conditions: CREATED new CR {new_cr.id} for gallery {gallery_id} -> spot {spot_name} (date={original_date})"
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
    
    # Look for existing CR - ONLY by live_session_id to prevent cross-session confusion
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
