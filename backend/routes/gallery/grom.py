"""
Cross-profile grom tagging — tag/untag groms in photos, highlights, linked groms.

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
from models import PhotoTag

router = APIRouter()

# ============ CROSS-PROFILE TAGGING (Parent → Grom) ============

class GromTagRequest(BaseModel):
    gallery_item_id: str
    grom_id: str


@router.post("/gallery/tag-grom")
async def tag_grom_in_photo(
    data: GromTagRequest,
    parent_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Allow a Grom Parent to tag their linked Grom in a photo.
    Creates a PhotoTag record for cross-profile sync.
    """
    from models import PhotoTag
    from sqlalchemy.orm.attributes import flag_modified
    
    # Verify parent is a Grom Parent
    parent_result = await db.execute(select(Profile).where(Profile.id == parent_id))
    parent = parent_result.scalar_one_or_none()
    
    if not parent:
        raise HTTPException(status_code=404, detail="Parent profile not found")
    
    if not is_grom_parent_eligible(parent):
        raise HTTPException(status_code=403, detail="Only Grom Parents can tag Groms in photos")
    
    # Get linked Grom and verify it's the parent's linked Grom
    grom_result = await db.execute(select(Profile).where(Profile.id == data.grom_id))
    grom = grom_result.scalar_one_or_none()
    
    if not grom:
        raise HTTPException(status_code=404, detail="Grom profile not found")
    
    if grom.parent_id != parent_id:
        raise HTTPException(status_code=403, detail="You can only tag your linked Grom")
    
    if grom.role != RoleEnum.GROM:
        raise HTTPException(status_code=400, detail="Target user is not a Grom")
    
    # Get the gallery item and verify parent owns it
    item_result = await db.execute(select(GalleryItem).where(GalleryItem.id == data.gallery_item_id))
    item = item_result.scalar_one_or_none()
    
    if not item:
        raise HTTPException(status_code=404, detail="Photo not found")
    
    if item.photographer_id != parent_id:
        raise HTTPException(status_code=403, detail="You can only tag Groms in your own photos")
    
    # Check if already tagged
    existing_tag_result = await db.execute(
        select(PhotoTag).where(
            PhotoTag.gallery_item_id == data.gallery_item_id,
            PhotoTag.surfer_id == data.grom_id
        )
    )
    existing_tag = existing_tag_result.scalar_one_or_none()
    
    if existing_tag:
        raise HTTPException(status_code=400, detail="Grom is already tagged in this photo")
    
    # Create PhotoTag for cross-profile sync
    photo_tag = PhotoTag(
        gallery_item_id=data.gallery_item_id,
        surfer_id=data.grom_id,
        photographer_id=parent_id,
        access_granted=True,  # Parents give free access to their Grom
        is_gift=True,  # Mark as gift (no charge)
        session_photo_price=0.0  # No charge for Grom
    )
    db.add(photo_tag)
    
    # Also update the tagged_surfer_ids on the gallery item
    tagged_ids = json.loads(item.tagged_surfer_ids) if item.tagged_surfer_ids else []
    if data.grom_id not in tagged_ids:
        tagged_ids.append(data.grom_id)
        item.tagged_surfer_ids = json.dumps(tagged_ids)
    
    # Create notification for Grom
    notification = Notification(
        user_id=data.grom_id,
        type='grom_highlight',
        title="Your parent tagged you in a photo!",
        body=f"{parent.full_name} added a photo to your Grom Highlights",
        data=json.dumps({
            "gallery_item_id": data.gallery_item_id,
            "photographer_id": parent_id,
            "type": "grom_highlight"
        })
    )
    db.add(notification)
    
    await db.commit()
    
    return {
        "message": "Grom tagged successfully",
        "gallery_item_id": data.gallery_item_id,
        "grom_id": data.grom_id,
        "grom_name": grom.full_name
    }


@router.delete("/gallery/untag-grom/{gallery_item_id}/{grom_id}")
async def untag_grom_from_photo(
    gallery_item_id: str,
    grom_id: str,
    parent_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Remove Grom tag from a photo"""
    from models import PhotoTag
    
    # Verify parent owns the photo
    item_result = await db.execute(select(GalleryItem).where(GalleryItem.id == gallery_item_id))
    item = item_result.scalar_one_or_none()
    
    if not item:
        raise HTTPException(status_code=404, detail="Photo not found")
    
    if item.photographer_id != parent_id:
        raise HTTPException(status_code=403, detail="You can only untag from your own photos")
    
    # Find and delete the tag
    tag_result = await db.execute(
        select(PhotoTag).where(
            PhotoTag.gallery_item_id == gallery_item_id,
            PhotoTag.surfer_id == grom_id
        )
    )
    tag = tag_result.scalar_one_or_none()
    
    if tag:
        await db.delete(tag)
    
    # Update tagged_surfer_ids
    tagged_ids = json.loads(item.tagged_surfer_ids) if item.tagged_surfer_ids else []
    if grom_id in tagged_ids:
        tagged_ids.remove(grom_id)
        item.tagged_surfer_ids = json.dumps(tagged_ids) if tagged_ids else None
    
    await db.commit()
    
    return {"message": "Grom tag removed", "gallery_item_id": gallery_item_id}


@router.get("/gallery/grom-highlights/{parent_id}")
async def get_grom_highlights(
    parent_id: str,
    grom_id: Optional[str] = None,
    limit: int = 20,
    offset: int = 0,
    db: AsyncSession = Depends(get_db)
):
    """
    Get photos tagged with a parent's linked Grom(s).
    Used for the "Grom Highlights" section in parent's gallery.
    """
    from models import PhotoTag
    
    # Verify parent is a Grom Parent
    parent_result = await db.execute(select(Profile).where(Profile.id == parent_id))
    parent = parent_result.scalar_one_or_none()
    
    if not parent:
        raise HTTPException(status_code=404, detail="Parent profile not found")
    
    if not is_grom_parent_eligible(parent):
        raise HTTPException(status_code=403, detail="Only Grom Parents can view Grom Highlights")
    
    # If specific grom_id provided, use that; otherwise get all linked Groms
    if grom_id:
        # Verify grom is linked to this parent
        grom_result = await db.execute(select(Profile).where(Profile.id == grom_id, Profile.parent_id == parent_id))
        grom = grom_result.scalar_one_or_none()
        if not grom:
            raise HTTPException(status_code=403, detail="Grom is not linked to this parent")
        grom_ids = [grom_id]
    else:
        # Get all linked Groms
        groms_result = await db.execute(select(Profile).where(Profile.parent_id == parent_id, Profile.role == RoleEnum.GROM))
        groms = groms_result.scalars().all()
        grom_ids = [g.id for g in groms]
    
    if not grom_ids:
        return {"items": [], "total": 0, "groms": []}
    
    # Get tagged photos for these Groms
    query = (
        select(GalleryItem, PhotoTag)
        .join(PhotoTag, PhotoTag.gallery_item_id == GalleryItem.id)
        .where(PhotoTag.surfer_id.in_(grom_ids))
        .order_by(PhotoTag.tagged_at.desc())
        .limit(limit)
        .offset(offset)
    )
    
    result = await db.execute(query)
    rows = result.all()
    
    # Count total
    count_query = (
        select(func.count())
        .select_from(PhotoTag)
        .where(PhotoTag.surfer_id.in_(grom_ids))
    )
    count_result = await db.execute(count_query)
    total = count_result.scalar() or 0
    
    # Get grom info
    groms_info = []
    if not grom_id:
        groms_result = await db.execute(select(Profile).where(Profile.parent_id == parent_id, Profile.role == RoleEnum.GROM))
        groms = groms_result.scalars().all()
        groms_info = [{"id": g.id, "name": g.full_name, "avatar": g.avatar_url} for g in groms]
    
    # Build response
    items = []
    for item, tag in rows:
        items.append({
            "id": item.id,
            "original_url": item.original_url,
            "preview_url": item.preview_url,
            "thumbnail_url": item.thumbnail_url,
            "media_type": item.media_type,
            "title": item.title,
            "grom_id": tag.surfer_id,
            "tagged_at": tag.tagged_at.isoformat() if tag.tagged_at else None,
            "created_at": item.created_at.isoformat() if item.created_at else None
        })
    
    return {
        "items": items,
        "total": total,
        "groms": groms_info
    }


@router.get("/gallery/grom-profile-photos/{grom_id}")
async def get_grom_profile_photos(
    grom_id: str,
    viewer_id: Optional[str] = None,
    limit: int = 20,
    offset: int = 0,
    db: AsyncSession = Depends(get_db)
):
    """
    Get photos that a Grom is tagged in.
    This powers the "Tagged Photos" section on a Grom's profile.
    Only accessible by the Grom themselves, their linked parent, or admins.
    """
    from models import PhotoTag
    
    # Get the Grom
    grom_result = await db.execute(select(Profile).where(Profile.id == grom_id))
    grom = grom_result.scalar_one_or_none()
    
    if not grom:
        raise HTTPException(status_code=404, detail="Grom profile not found")
    
    if grom.role != RoleEnum.GROM:
        raise HTTPException(status_code=400, detail="Profile is not a Grom")
    
    # Check viewer authorization
    is_authorized = False
    if viewer_id:
        viewer_result = await db.execute(select(Profile).where(Profile.id == viewer_id))
        viewer = viewer_result.scalar_one_or_none()
        
        if viewer:
            is_authorized = (
                viewer.is_admin or
                viewer_id == grom_id or
                viewer_id == grom.parent_id
            )
    
    if not is_authorized:
        raise HTTPException(status_code=403, detail="Not authorized to view Grom's tagged photos")
    
    # Get tagged photos
    query = (
        select(GalleryItem, PhotoTag, Profile)
        .join(PhotoTag, PhotoTag.gallery_item_id == GalleryItem.id)
        .join(Profile, Profile.id == PhotoTag.photographer_id)
        .where(PhotoTag.surfer_id == grom_id, PhotoTag.access_granted.is_(True))
        .order_by(PhotoTag.tagged_at.desc())
        .limit(limit)
        .offset(offset)
    )
    
    result = await db.execute(query)
    rows = result.all()
    
    # Build response
    items = []
    for item, tag, photographer in rows:
        items.append({
            "id": item.id,
            "original_url": item.original_url,
            "preview_url": item.preview_url,
            "thumbnail_url": item.thumbnail_url,
            "media_type": item.media_type,
            "title": item.title,
            "photographer_id": photographer.id,
            "photographer_name": photographer.full_name,
            "photographer_avatar": photographer.avatar_url,
            "tagged_at": tag.tagged_at.isoformat() if tag.tagged_at else None,
            "is_gift": tag.is_gift
        })
    
    return {"items": items, "grom_name": grom.full_name}


@router.get("/gallery/linked-groms/{parent_id}")
async def get_linked_groms(
    parent_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Get all Groms linked to a parent.
    Used for the tagging dropdown in parent's gallery.
    """
    # Verify parent
    parent_result = await db.execute(select(Profile).where(Profile.id == parent_id))
    parent = parent_result.scalar_one_or_none()
    
    if not parent:
        raise HTTPException(status_code=404, detail="Parent profile not found")
    
    if not is_grom_parent_eligible(parent):
        raise HTTPException(status_code=403, detail="Only Grom Parents can view linked Groms")
    
    # Get linked Groms
    result = await db.execute(
        select(Profile)
        .where(Profile.parent_id == parent_id, Profile.role == RoleEnum.GROM)
        .order_by(Profile.full_name)
    )
    groms = result.scalars().all()
    
    return {
        "groms": [
            {
                "id": g.id,
                "name": g.full_name,
                "avatar": g.avatar_url,
                "is_approved": g.parent_link_approved
            }
            for g in groms
        ]
    }


# ============ AI LINEUP MATCH & INCLUDED PHOTOS INTEGRATION ============
