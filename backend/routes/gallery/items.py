"""
Gallery Item CRUD â€” create, read, update, delete, move, copy, assign items.

Part of the gallery package â€” extracted from the gallery.py monolith.
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
from utils.grom_parent import is_grom_parent_eligible

from .schemas import (
    GalleryItemCreate, GalleryItemUpdate, GalleryItemResponse,
    PurchaseRequest, GalleryCreate, GalleryUpdate,
    get_quality_price
)

router = APIRouter()

@router.post("/gallery")
async def create_gallery_item(
    photographer_id: str,
    data: GalleryItemCreate,
    db: AsyncSession = Depends(get_db)
):
    """Create a new gallery item"""
    # Verify photographer exists and is a photographer role
    result = await db.execute(select(Profile).where(Profile.id == photographer_id))
    photographer = result.scalar_one_or_none()
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    photographer_roles = [RoleEnum.GROM_PARENT, RoleEnum.HOBBYIST, RoleEnum.PHOTOGRAPHER, RoleEnum.APPROVED_PRO]
    if photographer.role not in photographer_roles:
        raise HTTPException(status_code=403, detail="Only photographers can create gallery items")
    
    # GROM PARENT ISOLATION: Force for_sale=false for personal capture only
    is_grom_parent = is_grom_parent_eligible(photographer)
    effective_for_sale = False if is_grom_parent else data.is_for_sale
    
    # Verify spot if provided
    spot_name = None
    if data.spot_id:
        spot_result = await db.execute(select(SurfSpot).where(SurfSpot.id == data.spot_id))
        spot = spot_result.scalar_one_or_none()
        if spot:
            spot_name = spot.name
    
    item = GalleryItem(
        photographer_id=photographer_id,
        spot_id=data.spot_id,
        session_id=data.session_id,
        original_url=data.original_url,
        preview_url=data.preview_url,
        thumbnail_url=data.thumbnail_url,
        media_type=data.media_type,
        title=data.title,
        description=data.description,
        tags=json.dumps(data.tags) if data.tags else None,
        price=data.price if not is_grom_parent else 0,  # Grom Parent: no pricing
        is_for_sale=effective_for_sale,  # Grom Parent: always false
        tagged_surfer_ids=json.dumps(data.tagged_surfer_ids) if data.tagged_surfer_ids else None,
        shot_at=data.shot_at,
        video_width=data.video_width,
        video_height=data.video_height,
        video_duration=data.video_duration
    )
    
    db.add(item)
    await db.commit()
    await db.refresh(item)
    
    # Notify tagged surfers
    if data.tagged_surfer_ids:
        for surfer_id in data.tagged_surfer_ids:
            notification = Notification(
                user_id=surfer_id,
                type='photo_tagged',
                title=f"{photographer.full_name} tagged you in a {'video' if data.media_type == 'video' else 'photo'}!",
                body=f"Check out the {'video' if data.media_type == 'video' else 'photo'} from {spot_name or 'a surf session'}",
                data=json.dumps({
                    "gallery_item_id": item.id,
                    "photographer_id": photographer_id,
                    "type": "photo_tagged"
                })
            )
            db.add(notification)
        await db.commit()
    
    return {
        "id": item.id,
        "preview_url": item.preview_url,
        "media_type": item.media_type,
        "spot_name": spot_name,
        "message": f"{'Video' if data.media_type == 'video' else 'Photo'} added to gallery!"
    }

@router.get("/gallery/photographer/{photographer_id}")
async def get_photographer_gallery(
    photographer_id: str,
    viewer_id: Optional[str] = None,
    include_in_folders: bool = False,  # If False, only show items not in any folder
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db)
):
    """Get a photographer's gallery. By default excludes items that are in folders.
    
    Privacy: Items from on-demand/booking galleries are PRIVATE and only visible
    to session participants. Live session and manual gallery items are public.
    """
    query = select(GalleryItem)\
        .where(GalleryItem.photographer_id == photographer_id)\
        .where(GalleryItem.is_public == True)\
        .where(GalleryItem.is_deleted == False)
    
    # By default, exclude items that are in folders (gallery_id is not null)
    if not include_in_folders:
        query = query.where(GalleryItem.gallery_id == None)
    else:
        # When including folder items, exclude items from PRIVATE session galleries
        # (on_demand, booking) â€” those are only visible to session participants.
        # Items with no gallery_id (unfiled), or in live/manual galleries, are public.
        query = query.where(
            (GalleryItem.gallery_id == None) | 
            (~GalleryItem.gallery_id.in_(
                select(Gallery.id)
                .where(Gallery.photographer_id == photographer_id)
                .where(Gallery.session_type.in_(['on_demand', 'booking']))
            ))
        )
    
    query = query.options(selectinload(GalleryItem.photographer), selectinload(GalleryItem.spot))\
        .order_by(GalleryItem.created_at.desc())\
        .offset(offset)\
        .limit(limit)
    
    result = await db.execute(query)
    items = result.scalars().all()
    
    # Check which items the viewer has purchased
    purchased_ids = set()
    if viewer_id:
        purchase_result = await db.execute(
            select(GalleryPurchase.gallery_item_id)
            .where(GalleryPurchase.buyer_id == viewer_id)
        )
        purchased_ids = set(row[0] for row in purchase_result.fetchall())
    
    return [{
        "id": item.id,
        "gallery_id": item.gallery_id,  # Needed for frontend folder filtering
        "photographer_id": item.photographer_id,
        "photographer_name": item.photographer.full_name if item.photographer else None,
        "photographer_avatar": item.photographer.avatar_url if item.photographer else None,
        "spot_id": item.spot_id,
        "spot_name": item.spot.name if item.spot else None,
        "original_url": item.original_url if item.id in purchased_ids else None,  # Only show original if purchased
        "preview_url": item.preview_url,
        "thumbnail_url": item.thumbnail_url,
        "media_type": item.media_type or 'image',
        "title": item.title,
        "description": item.description,
        "tags": json.loads(item.tags) if item.tags else None,
        "price": item.price,
        "custom_price": item.custom_price,  # Dynamic Pricing: Manual override if set
        "is_for_sale": item.is_for_sale,
        "is_public": item.is_public,
        "is_featured": item.is_featured,
        "view_count": item.view_count,
        "purchase_count": item.purchase_count,
        "is_purchased": item.id in purchased_ids,
        "video_width": item.video_width,
        "video_height": item.video_height,
        "video_duration": item.video_duration,
        "created_at": item.created_at.isoformat(),
        "shot_at": item.shot_at.isoformat() if item.shot_at else None
    } for item in items]

@router.get("/gallery/spot/{spot_id}")
async def get_spot_gallery(
    spot_id: str,
    viewer_id: Optional[str] = None,
    limit: int = 50,
    db: AsyncSession = Depends(get_db)
):
    """
    Get all gallery items for a surf spot.
    Includes:
    1. Photographer's original uploads (for sale)
    2. Surfer's public items (from My Gallery with is_public=true)
    
    This implements the "Public â†’ Spot Hub Mirror" per Master Logic Sync.
    """
    # Get photographer's gallery items (for sale)
    photographer_items_result = await db.execute(
        select(GalleryItem)
        .where(GalleryItem.spot_id == spot_id)
        .where(GalleryItem.is_public == True)
        .where(GalleryItem.is_for_sale == True)
        .options(selectinload(GalleryItem.photographer))
        .order_by(GalleryItem.created_at.desc())
        .limit(limit)
    )
    photographer_items = photographer_items_result.scalars().all()
    
    # Get surfer's public gallery items (mirrored to Spot Hub)
    surfer_public_items_result = await db.execute(
        select(SurferGalleryItem)
        .where(SurferGalleryItem.spot_id == spot_id)
        .where(SurferGalleryItem.is_public == True)
        .options(
            selectinload(SurferGalleryItem.gallery_item),
            selectinload(SurferGalleryItem.surfer)
        )
        .order_by(SurferGalleryItem.added_at.desc())
        .limit(limit)
    )
    surfer_public_items = surfer_public_items_result.scalars().all()
    
    purchased_ids = set()
    if viewer_id:
        purchase_result = await db.execute(
            select(GalleryPurchase.gallery_item_id)
            .where(GalleryPurchase.buyer_id == viewer_id)
        )
        purchased_ids = set(row[0] for row in purchase_result.fetchall())
    
    # Combine results
    items_response = []
    
    # Add photographer items (for sale)
    for item in photographer_items:
        items_response.append({
            "id": item.id,
            "type": "photographer_listing",
            "photographer_id": item.photographer_id,
            "photographer_name": item.photographer.full_name if item.photographer else None,
            "preview_url": item.preview_url,
            "thumbnail_url": item.thumbnail_url,
            "title": item.title,
            "price": item.price,
            "is_purchased": item.id in purchased_ids,
            "is_for_sale": True,
            "media_type": item.media_type or 'image',
            "created_at": item.created_at.isoformat() if item.created_at else None
        })
    
    # Add surfer's public items (mirrored from My Gallery)
    for surfer_item in surfer_public_items:
        gi = surfer_item.gallery_item
        if not gi:
            continue
        items_response.append({
            "id": surfer_item.id,
            "type": "surfer_public",
            "surfer_id": surfer_item.surfer_id,
            "surfer_name": surfer_item.surfer.full_name if surfer_item.surfer else None,
            "surfer_avatar": surfer_item.surfer.avatar_url if surfer_item.surfer else None,
            "preview_url": gi.preview_url,
            "thumbnail_url": gi.thumbnail_url,
            "title": f"Wave at {surfer_item.spot_name}" if surfer_item.spot_name else "Surf Session",
            "media_type": gi.media_type or 'image',
            "is_for_sale": False,
            "session_date": surfer_item.session_date.isoformat() if surfer_item.session_date else None,
            "created_at": surfer_item.added_at.isoformat() if surfer_item.added_at else None
        })
    
    # Sort combined results by created_at
    items_response.sort(key=lambda x: x.get('created_at') or '', reverse=True)
    
    return {
        "spot_id": spot_id,
        "items": items_response[:limit],
        "total_photographer_items": len(photographer_items),
        "total_surfer_public_items": len(surfer_public_items)
    }

@router.get("/gallery/item/{item_id}")
async def get_gallery_item(
    item_id: str,
    viewer_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """Get a single gallery item"""
    result = await db.execute(
        select(GalleryItem)
        .where(GalleryItem.id == item_id)
        .options(selectinload(GalleryItem.photographer), selectinload(GalleryItem.spot))
    )
    item = result.scalar_one_or_none()
    
    if not item:
        raise HTTPException(status_code=404, detail="Gallery item not found")
    
    # Increment view count
    item.view_count += 1
    await db.commit()
    
    # Check if viewer purchased
    is_purchased = False
    if viewer_id:
        purchase_result = await db.execute(
            select(GalleryPurchase).where(
                GalleryPurchase.gallery_item_id == item_id,
                GalleryPurchase.buyer_id == viewer_id
            )
        )
        is_purchased = purchase_result.scalar_one_or_none() is not None
    
    return {
        "id": item.id,
        "photographer_id": item.photographer_id,
        "photographer_name": item.photographer.full_name if item.photographer else None,
        "photographer_avatar": item.photographer.avatar_url if item.photographer else None,
        "spot_id": item.spot_id,
        "spot_name": item.spot.name if item.spot else None,
        "original_url": item.original_url if is_purchased else None,
        "preview_url": item.preview_url,
        "title": item.title,
        "description": item.description,
        "tags": json.loads(item.tags) if item.tags else None,
        "price": item.price,
        "is_for_sale": item.is_for_sale,
        "view_count": item.view_count,
        "purchase_count": item.purchase_count,
        "is_purchased": is_purchased,
        "created_at": item.created_at.isoformat()
    }



# Pricing, custom-price endpoints extracted to gallery_purchases.py (v86)


@router.patch("/gallery/item/{item_id}")
async def update_gallery_item(
    item_id: str,
    photographer_id: str,
    data: GalleryItemUpdate,
    db: AsyncSession = Depends(get_db)
):
    """Update gallery item"""
    result = await db.execute(select(GalleryItem).where(GalleryItem.id == item_id))
    item = result.scalar_one_or_none()
    
    if not item:
        raise HTTPException(status_code=404, detail="Gallery item not found")
    
    if item.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    # Check if photographer is Grom Parent (restricted from commerce)
    profile_result = await db.execute(select(Profile).where(Profile.id == photographer_id))
    photographer = profile_result.scalar_one_or_none()
    is_grom_parent = bool(photographer) and is_grom_parent_eligible(photographer)
    
    if data.title is not None:
        item.title = data.title
    if data.description is not None:
        item.description = data.description
    if data.tags is not None:
        item.tags = json.dumps(data.tags)
    if data.price is not None:
        # GROM PARENT ISOLATION: Cannot set prices
        item.price = 0 if is_grom_parent else data.price
    if data.custom_price is not None:
        # Allow setting custom_price to null by passing 0 or negative
        # GROM PARENT: Always null/0
        if is_grom_parent:
            item.custom_price = None
        else:
            item.custom_price = data.custom_price if data.custom_price > 0 else None
    if data.is_for_sale is not None:
        # GROM PARENT ISOLATION: Cannot mark for sale
        item.is_for_sale = False if is_grom_parent else data.is_for_sale
    if data.is_public is not None:
        item.is_public = data.is_public
    if data.is_featured is not None:
        item.is_featured = data.is_featured
    
    await db.commit()
    return {"message": "Gallery item updated", "custom_price": item.custom_price}


class MoveToFolderRequest(BaseModel):
    target_gallery_id: str

@router.patch("/gallery/item/{item_id}/move")
async def move_item_to_gallery(
    item_id: str,
    photographer_id: str,
    data: MoveToFolderRequest,
    db: AsyncSession = Depends(get_db)
):
    """Move a gallery item to a different gallery/folder"""
    # Get the item
    result = await db.execute(select(GalleryItem).where(GalleryItem.id == item_id))
    item = result.scalar_one_or_none()
    
    if not item:
        raise HTTPException(status_code=404, detail="Gallery item not found")
    
    if item.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    # Verify target gallery exists and is owned by photographer
    target_result = await db.execute(select(Gallery).where(Gallery.id == data.target_gallery_id))
    target_gallery = target_result.scalar_one_or_none()
    
    if not target_gallery:
        raise HTTPException(status_code=404, detail="Target folder not found")
    
    if target_gallery.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized to move to this folder")
    
    # Update item counts on old and new galleries
    if item.gallery_id:
        old_result = await db.execute(select(Gallery).where(Gallery.id == item.gallery_id))
        old_gallery = old_result.scalar_one_or_none()
        if old_gallery:
            old_gallery.item_count = max(0, old_gallery.item_count - 1)
    
    # Move item
    item.gallery_id = data.target_gallery_id
    target_gallery.item_count += 1
    
    # ============ PRICE SNAPSHOT: Inherit gallery's locked prices ============
    # When a photo is moved into a session gallery, it should adopt the pricing
    # that was active at the time of the session â€” NOT the photographer's current prices.
    # This ensures price consistency even if the photographer changes rates later.
    if target_gallery.locked_price_web is not None:
        item.locked_price_web = target_gallery.locked_price_web
    if target_gallery.locked_price_standard is not None:
        item.locked_price_standard = target_gallery.locked_price_standard
    if target_gallery.locked_price_high is not None:
        item.locked_price_high = target_gallery.locked_price_high
    if target_gallery.session_type:
        item.session_origin_mode = target_gallery.session_type
    
    # Set cover image if target doesn't have one
    if not target_gallery.cover_image_url and item.media_type == 'image':
        target_gallery.cover_image_url = item.preview_url
    
    # AUTO-DISTRIBUTE: If target gallery is session-linked, push to participants' lockers
    distributed = 0
    if target_gallery.live_session_id or target_gallery.booking_id or target_gallery.dispatch_id:
        try:
            distributed = await distribute_gallery_item_to_participants(
                db, item.id, target_gallery
            )
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning(f"Auto-distribution failed for item {item.id}: {e}")
    
    await db.commit()
    return {
        "message": "Item moved to folder", 
        "gallery_id": data.target_gallery_id,
        "distributed_to_surfers": distributed
    }


# ============ MANUAL SURFER ASSIGNMENT (Photographer Fallback) ============

class AssignSurferRequest(BaseModel):
    photographer_id: str
    surfer_id: str
    access_type: str = 'pending_selection'  # 'pending_selection', 'included', 'gifted'

@router.post("/gallery/item/{item_id}/assign-surfer")
async def assign_item_to_surfer(
    item_id: str,
    data: AssignSurferRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Manual photographer fallback: assign a specific item to a specific surfer's locker.
    Also records the assignment as AI training data for future matching.
    
    access_type:
    - 'pending_selection': Surfer sees watermarked, must select or purchase
    - 'included': Free â€” counts toward session allocation
    - 'gifted': Photographer gift â€” free download
    """
    # Verify photographer owns the item
    item_result = await db.execute(select(GalleryItem).where(GalleryItem.id == item_id))
    item = item_result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Gallery item not found")
    if item.photographer_id != data.photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    # Verify surfer exists
    surfer_result = await db.execute(select(Profile).where(Profile.id == data.surfer_id))
    if not surfer_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Surfer not found")
    
    result = await manually_assign_item_to_surfer(
        db=db,
        gallery_item_id=item_id,
        surfer_id=data.surfer_id,
        photographer_id=data.photographer_id,
        access_type=data.access_type
    )
    
    if "error" in result and not result.get("already_exists"):
        raise HTTPException(status_code=400, detail=result["error"])
    
    await db.commit()
    return result


class BulkAssignRequest(BaseModel):
    photographer_id: str
    surfer_id: str
    item_ids: Optional[List[str]] = None  # If None, assigns all items in gallery
    access_type: str = 'included'  # Default to 'included' for session-purchased content

@router.post("/gallery/{gallery_id}/assign-all-to-surfer")
async def bulk_assign_to_surfer(
    gallery_id: str,
    data: BulkAssignRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Bulk assign multiple gallery items to a surfer's locker.
    If item_ids not provided, assigns ALL items in the gallery.
    """
    # Verify gallery ownership
    gallery_result = await db.execute(select(Gallery).where(Gallery.id == gallery_id))
    gallery = gallery_result.scalar_one_or_none()
    if not gallery:
        raise HTTPException(status_code=404, detail="Gallery not found")
    if gallery.photographer_id != data.photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    # Verify surfer exists
    surfer_result = await db.execute(select(Profile).where(Profile.id == data.surfer_id))
    if not surfer_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Surfer not found")
    
    # Get items to assign
    if data.item_ids:
        items_result = await db.execute(
            select(GalleryItem).where(
                GalleryItem.id.in_(data.item_ids),
                GalleryItem.gallery_id == gallery_id
            )
        )
    else:
        items_result = await db.execute(
            select(GalleryItem).where(
                GalleryItem.gallery_id == gallery_id,
                GalleryItem.is_deleted == False
            )
        )
    
    items = items_result.scalars().all()
    
    assigned_count = 0
    skipped_count = 0
    
    for item in items:
        result = await manually_assign_item_to_surfer(
            db=db,
            gallery_item_id=item.id,
            surfer_id=data.surfer_id,
            photographer_id=data.photographer_id,
            access_type=data.access_type,
            gallery=gallery
        )
        if result.get("success"):
            assigned_count += 1
        else:
            skipped_count += 1
    
    await db.commit()
    return {
        "message": f"Assigned {assigned_count} items to surfer's locker",
        "assigned": assigned_count,
        "skipped": skipped_count,
        "total_items": len(items)
    }


@router.post("/gallery/item/{item_id}/copy")
async def copy_item_to_gallery(
    item_id: str,
    photographer_id: str,
    data: MoveToFolderRequest,
    db: AsyncSession = Depends(get_db)
):
    """Copy a gallery item to a folder (keeps original in main gallery)"""
    # Get the original item
    result = await db.execute(select(GalleryItem).where(GalleryItem.id == item_id))
    item = result.scalar_one_or_none()
    
    if not item:
        raise HTTPException(status_code=404, detail="Gallery item not found")
    
    if item.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    # Verify target gallery exists and is owned by photographer
    target_result = await db.execute(select(Gallery).where(Gallery.id == data.target_gallery_id))
    target_gallery = target_result.scalar_one_or_none()
    
    if not target_gallery:
        raise HTTPException(status_code=404, detail="Target folder not found")
    
    if target_gallery.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized to copy to this folder")
    
    # Create a copy of the item in the target folder
    new_item = GalleryItem(
        id=str(uuid.uuid4()),
        photographer_id=item.photographer_id,
        spot_id=item.spot_id,
        gallery_id=data.target_gallery_id,
        original_url=item.original_url,
        preview_url=item.preview_url,
        thumbnail_url=item.thumbnail_url,
        media_type=item.media_type,
        title=item.title,
        description=item.description,
        tags=item.tags,
        price=item.price,
        custom_price=item.custom_price,
        is_for_sale=item.is_for_sale,
        is_public=item.is_public,
        is_featured=item.is_featured,
        video_width=item.video_width,
        video_height=item.video_height,
        video_duration=item.video_duration,
        shot_at=item.shot_at,
        # ============ PRICE SNAPSHOT: Inherit gallery's locked prices ============
        # Copy inherits the session-time pricing from the target gallery so
        # future photographer price changes don't retroactively affect this gallery.
        locked_price_web=target_gallery.locked_price_web,
        locked_price_standard=target_gallery.locked_price_standard,
        locked_price_high=target_gallery.locked_price_high,
        session_origin_mode=target_gallery.session_type,
    )
    db.add(new_item)
    
    # Update target gallery count
    target_gallery.item_count += 1
    
    # Set cover image if target doesn't have one
    if not target_gallery.cover_image_url and item.media_type == 'image':
        target_gallery.cover_image_url = item.preview_url
    
    await db.commit()
    return {"message": "Item copied to folder", "gallery_id": data.target_gallery_id, "new_item_id": new_item.id}


# SetCustomPriceRequest + custom-price endpoint extracted to gallery_purchases.py (v86)



@router.delete("/gallery/item/{item_id}")
async def delete_gallery_item(
    item_id: str,
    photographer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Delete gallery item (soft-deletes if surfers have paid for it)"""
    result = await safe_delete_gallery_item(db, item_id, photographer_id)
    
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    
    await db.commit()
    return result

