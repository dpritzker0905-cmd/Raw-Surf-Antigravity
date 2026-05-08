"""
Gallery Collection management — create, list, get, update, delete galleries.

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

from .collections_roster import (
    build_session_settings as _build_session_settings,
    build_photographer_pricing as _build_photographer_pricing,
)

router = APIRouter()

@router.post("/galleries")
async def create_gallery(
    photographer_id: str,
    data: GalleryCreate,
    db: AsyncSession = Depends(get_db)
):
    """Create a new gallery (collection)"""
    
    # Verify photographer
    result = await db.execute(select(Profile).where(Profile.id == photographer_id))
    photographer = result.scalar_one_or_none()
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    photographer_roles = [RoleEnum.GROM_PARENT, RoleEnum.HOBBYIST, RoleEnum.PHOTOGRAPHER, RoleEnum.APPROVED_PRO]
    if photographer.role not in photographer_roles:
        raise HTTPException(status_code=403, detail="Only photographers can create galleries")
    
    gallery = Gallery(
        photographer_id=photographer_id,
        title=data.title,
        description=data.description,
        surf_spot_id=data.surf_spot_id,
        cover_image_url=data.cover_image_url,
        # Phase 5: Session linking at creation — prevent orphaned galleries
        session_type=data.session_type or 'manual',
        live_session_id=data.live_session_id,
        booking_id=data.booking_id,
        dispatch_id=data.dispatch_id,
        price_web=data.price_web,
        price_standard=data.price_standard,
        price_high=data.price_high,
        price_720p=data.price_720p,
        price_1080p=data.price_1080p,
        price_4k=data.price_4k
    )
    
    db.add(gallery)
    await db.commit()
    await db.refresh(gallery)
    
    return {
        "id": gallery.id,
        "title": gallery.title,
        "message": "Gallery created successfully"
    }


# NOTE: get_photographer_galleries moved to collections_roster.py (v87)
# NOTE: _build_session_settings, _build_photographer_pricing, _build_session_roster moved to collections_roster.py (v87)



@router.get("/galleries/{gallery_id}")
async def get_gallery(
    gallery_id: str,
    viewer_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """Get a single gallery with items"""
    
    result = await db.execute(
        select(Gallery)
        .where(Gallery.id == gallery_id)
        .options(
            selectinload(Gallery.photographer),
            selectinload(Gallery.surf_spot),
            selectinload(Gallery.items),
            selectinload(Gallery.live_session)
        )
    )
    gallery = result.scalar_one_or_none()
    
    if not gallery:
        raise HTTPException(status_code=404, detail="Gallery not found")
    
    # Increment view count
    gallery.view_count += 1
    await db.commit()
    
    # Get purchased item IDs for viewer
    purchased_ids = set()
    if viewer_id:
        purchase_result = await db.execute(
            select(GalleryPurchase.gallery_item_id)
            .where(GalleryPurchase.buyer_id == viewer_id)
        )
        purchased_ids = set(row[0] for row in purchase_result.fetchall())
    
    
    # Phase 4: Pre-fetch per-item distribution counts for status badges
    is_owner = viewer_id and viewer_id == gallery.photographer_id
    item_ids = [item.id for item in gallery.items]
    distribution_map = {}  # item_id -> {count, has_ai_suggestion}
    if item_ids and is_owner:
        dist_result = await db.execute(
            select(
                SurferGalleryItem.gallery_item_id,
                func.count(SurferGalleryItem.id).label('count'),
                func.sum(case((SurferGalleryItem.ai_suggested == True, 1), else_=0)).label('ai_count'),
                func.sum(case((SurferGalleryItem.surfer_confirmed == True, 1), else_=0)).label('confirmed_count')
            )
            .where(SurferGalleryItem.gallery_item_id.in_(item_ids))
            .group_by(SurferGalleryItem.gallery_item_id)
        )
        for row in dist_result.fetchall():
            distribution_map[row[0]] = {
                "distributed_count": row[1],
                "ai_suggested_count": row[2],
                "confirmed_count": row[3]
            }
    
    # Batch-load tagged surfer profiles for avatar chips on grid
    tagged_surfers_map = {}
    if is_owner and item_ids:
        tagged_result = await db.execute(
            select(SurferGalleryItem.gallery_item_id, SurferGalleryItem.surfer_id, 
                   SurferGalleryItem.access_type, Profile.full_name, Profile.avatar_url)
            .join(Profile, SurferGalleryItem.surfer_id == Profile.id)
            .where(SurferGalleryItem.gallery_item_id.in_(item_ids))
        )
        for row in tagged_result.fetchall():
            item_id = row[0]
            if item_id not in tagged_surfers_map:
                tagged_surfers_map[item_id] = []
            tagged_surfers_map[item_id].append({
                "surfer_id": row[1],
                "access_type": row[2],
                "full_name": row[3],
                "avatar_url": row[4]
            })
    
    items = []
    for item in gallery.items:
        # Gallery owner can always see all items (including private/draft ones)
        # Public viewers only see items marked is_public
        if is_owner or item.is_public:
            item_dist = distribution_map.get(item.id, {})
            item_tagged = tagged_surfers_map.get(item.id, [])
            items.append({
                "id": item.id,
                "preview_url": item.preview_url,
                "thumbnail_url": item.thumbnail_url,
                "media_type": item.media_type or "image",
                "title": item.title,
                "description": item.description,
                "tags": item.tags,
                "price": item.price,
                "custom_price": item.custom_price,
                "is_for_sale": item.is_for_sale,
                "is_public": item.is_public,
                "is_featured": item.is_featured,
                "view_count": item.view_count,
                "purchase_count": item.purchase_count,
                "tagged_surfer_ids": item.tagged_surfer_ids,
                "tagged_surfers": item_tagged,  # Full surfer profiles for avatar chips
                "is_purchased": item.id in purchased_ids,
                "created_at": item.created_at.isoformat(),
                # Phase 4: Distribution status per item
                "distributed_count": item_dist.get('distributed_count', 0),
                "ai_suggested_count": item_dist.get('ai_suggested_count', 0),
                "confirmed_count": item_dist.get('confirmed_count', 0)
            })
    
    return {
        "id": gallery.id,
        "photographer_id": gallery.photographer_id,
        "photographer_name": gallery.photographer.full_name if gallery.photographer else None,
        "photographer_avatar": gallery.photographer.avatar_url if gallery.photographer else None,
        "title": gallery.title,
        "description": gallery.description,
        "cover_image_url": gallery.cover_image_url,
        "surf_spot_name": gallery.surf_spot.name if gallery.surf_spot else None,
        "item_count": len(items),
        "view_count": gallery.view_count,
        "purchase_count": gallery.purchase_count,
        "is_public": gallery.is_public,
        "session_date": gallery.session_date.isoformat() if gallery.session_date else None,
        "session_type": gallery.session_type,
        "live_session_id": gallery.live_session_id,
        "booking_id": gallery.booking_id,
        "dispatch_id": gallery.dispatch_id,
        "created_at": gallery.created_at.isoformat(),
        "pricing": {
            "photo": {
                "web": gallery.price_web,
                "standard": gallery.price_standard,
                "high": gallery.price_high
            },
            "video": {
                "720p": gallery.price_720p,
                "1080p": gallery.price_1080p,
                "4k": gallery.price_4k
            }
        },
        "session_settings": _build_session_settings(gallery),
        "photographer_pricing": _build_photographer_pricing(gallery.photographer) if gallery.photographer else None,
        "items": items
    }


@router.put("/galleries/{gallery_id}")
async def update_gallery(
    gallery_id: str,
    photographer_id: str,
    data: GalleryUpdate,
    db: AsyncSession = Depends(get_db)
):
    """Update gallery details and pricing"""
    
    result = await db.execute(select(Gallery).where(Gallery.id == gallery_id))
    gallery = result.scalar_one_or_none()
    
    if not gallery:
        raise HTTPException(status_code=404, detail="Gallery not found")
    
    if gallery.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    # Update fields
    if data.title is not None:
        gallery.title = data.title
    if data.description is not None:
        gallery.description = data.description
    if data.cover_image_url is not None:
        gallery.cover_image_url = data.cover_image_url
    if data.is_public is not None:
        gallery.is_public = data.is_public
    if data.is_featured is not None:
        gallery.is_featured = data.is_featured
    
    # Update pricing
    if data.price_web is not None:
        gallery.price_web = data.price_web
    if data.price_standard is not None:
        gallery.price_standard = data.price_standard
    if data.price_high is not None:
        gallery.price_high = data.price_high
    if data.price_720p is not None:
        gallery.price_720p = data.price_720p
    if data.price_1080p is not None:
        gallery.price_1080p = data.price_1080p
    if data.price_4k is not None:
        gallery.price_4k = data.price_4k
    
    await db.commit()
    
    return {
        "message": "Gallery updated",
        "pricing": {
            "photo": {
                "web": gallery.price_web,
                "standard": gallery.price_standard,
                "high": gallery.price_high
            },
            "video": {
                "720p": gallery.price_720p,
                "1080p": gallery.price_1080p,
                "4k": gallery.price_4k
            }
        }
    }


@router.patch("/galleries/{gallery_id}/session-settings")
async def update_session_settings(
    gallery_id: str,
    photographer_id: str,
    body: dict = Body(...),
    db: AsyncSession = Depends(get_db)
):
    """
    Update session-level content settings (photos/videos included).
    For live sessions → updates the LiveSession record directly.
    For bookings/on-demand → updates the photographer profile defaults.
    """
    result = await db.execute(
        select(Gallery)
        .where(Gallery.id == gallery_id)
        .options(selectinload(Gallery.live_session), selectinload(Gallery.photographer))
    )
    gallery = result.scalar_one_or_none()
    
    if not gallery:
        raise HTTPException(status_code=404, detail="Gallery not found")
    if gallery.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    photos_included = body.get("photos_included")
    videos_included = body.get("videos_included")
    
    updated_target = "unknown"
    
    if gallery.live_session_id and gallery.live_session:
        # Update the actual LiveSession record
        ls = gallery.live_session
        if photos_included is not None:
            ls.photos_included = int(photos_included)
        if videos_included is not None:
            ls.videos_included = int(videos_included)
        updated_target = "live_session"
    elif gallery.booking_id and gallery.photographer:
        p = gallery.photographer
        if photos_included is not None:
            p.booking_photos_included = int(photos_included)
        if videos_included is not None:
            p.booking_videos_included = int(videos_included)
        updated_target = "booking_profile"
    elif gallery.dispatch_id and gallery.photographer:
        p = gallery.photographer
        if photos_included is not None:
            p.on_demand_photos_included = int(photos_included)
        if videos_included is not None:
            p.on_demand_videos_included = int(videos_included)
        updated_target = "on_demand_profile"
    else:
        raise HTTPException(status_code=400, detail="No linked session to update")
    
    await db.commit()
    
    return {
        "message": "Session settings updated",
        "updated_target": updated_target,
        "photos_included": photos_included,
        "videos_included": videos_included
    }


@router.delete("/galleries/{gallery_id}")
async def delete_gallery(
    gallery_id: str,
    photographer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Delete a gallery and its items, plus any linked condition reports"""
    
    result = await db.execute(select(Gallery).where(Gallery.id == gallery_id))
    gallery = result.scalar_one_or_none()
    
    if not gallery:
        raise HTTPException(status_code=404, detail="Gallery not found")
    
    if gallery.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    # Cascade: delete linked condition reports
    deleted_reports = 0
    if gallery.live_session_id:
        # Delete all condition reports linked to this live session
        cr_result = await db.execute(
            select(ConditionReport).where(ConditionReport.live_session_id == gallery.live_session_id)
        )
        for cr in cr_result.scalars().all():
            await db.delete(cr)
            deleted_reports += 1
    
    # Also clean up any condition reports from this photographer at this spot
    # that were created around the same time as the gallery (within 24 hours)
    if gallery.surf_spot_id:
        from datetime import timedelta
        window_start = gallery.created_at - timedelta(hours=1) if gallery.created_at else None
        window_end = gallery.created_at + timedelta(hours=24) if gallery.created_at else None
        if window_start and window_end:
            cr_spot_result = await db.execute(
                select(ConditionReport).where(
                    ConditionReport.photographer_id == photographer_id,
                    ConditionReport.spot_id == gallery.surf_spot_id,
                    ConditionReport.created_at >= window_start,
                    ConditionReport.created_at <= window_end
                )
            )
            for cr in cr_spot_result.scalars().all():
                await db.delete(cr)
                deleted_reports += 1
    
    await db.delete(gallery)
    await db.commit()
    
    return {"message": "Gallery deleted", "condition_reports_deleted": deleted_reports}


@router.get("/galleries/{gallery_id}/items")
async def get_gallery_items(
    gallery_id: str,
    viewer_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """Get all items in a gallery"""
    # Verify gallery exists
    result = await db.execute(select(Gallery).where(Gallery.id == gallery_id))
    gallery = result.scalar_one_or_none()
    
    if not gallery:
        raise HTTPException(status_code=404, detail="Gallery not found")
    
    # Get items in this gallery
    result = await db.execute(
        select(GalleryItem)
        .where(GalleryItem.gallery_id == gallery_id)
        .where(GalleryItem.is_public == True)
        .where(GalleryItem.is_deleted == False)
        .options(selectinload(GalleryItem.photographer), selectinload(GalleryItem.spot))
        .order_by(GalleryItem.created_at.desc())
    )
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
        "photographer_id": item.photographer_id,
        "photographer_name": item.photographer.full_name if item.photographer else None,
        "spot_id": item.spot_id,
        "spot_name": item.spot.name if item.spot else None,
        "original_url": item.original_url if item.id in purchased_ids else None,
        "preview_url": item.preview_url,
        "thumbnail_url": item.thumbnail_url,
        "media_type": item.media_type or 'image',
        "title": item.title,
        "description": item.description,
        "tags": json.loads(item.tags) if item.tags else None,
        "price": item.price,
        "custom_price": item.custom_price,
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


@router.post("/galleries/{gallery_id}/items")
async def add_item_to_gallery(
    gallery_id: str,
    photographer_id: str,
    data: GalleryItemCreate,
    db: AsyncSession = Depends(get_db)
):
    """Add an item to a specific gallery"""
    
    # Verify gallery ownership
    result = await db.execute(select(Gallery).where(Gallery.id == gallery_id))
    gallery = result.scalar_one_or_none()
    
    if not gallery:
        raise HTTPException(status_code=404, detail="Gallery not found")
    
    if gallery.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    # Get photographer profile to check role
    profile_result = await db.execute(select(Profile).where(Profile.id == photographer_id))
    photographer = profile_result.scalar_one_or_none()
    
    # GROM PARENT ISOLATION: Force for_sale=false for personal capture only
    is_grom_parent = bool(photographer) and is_grom_parent_eligible(photographer)
    effective_for_sale = False if is_grom_parent else data.is_for_sale
    effective_price = 0 if is_grom_parent else data.price
    
    # Create item linked to gallery
    item = GalleryItem(
        photographer_id=photographer_id,
        gallery_id=gallery_id,
        spot_id=gallery.surf_spot_id or data.spot_id,
        original_url=data.original_url,
        preview_url=data.preview_url,
        thumbnail_url=data.thumbnail_url,
        media_type=data.media_type,
        title=data.title,
        description=data.description,
        tags=json.dumps(data.tags) if data.tags else None,
        price=effective_price,
        is_for_sale=effective_for_sale,
        tagged_surfer_ids=json.dumps(data.tagged_surfer_ids) if data.tagged_surfer_ids else None,
        shot_at=data.shot_at,
        video_width=data.video_width,
        video_height=data.video_height,
        video_duration=data.video_duration
    )
    
    db.add(item)
    
    # Update gallery stats
    gallery.item_count += 1
    
    # Auto-thumbnail sync logic:
    # 1. If gallery has no cover yet, set from this item
    # 2. If gallery is linked to an active live session, always update cover
    #    to the latest item (keeps conditions report / latest media as thumbnail)
    item_thumbnail = data.preview_url or data.thumbnail_url
    if item_thumbnail:
        if not gallery.cover_image_url:
            gallery.cover_image_url = item_thumbnail
        elif gallery.live_session_id:
            # Live session galleries: always update cover to latest upload
            # This ensures conditions report photos sync as the folder thumbnail
            try:
                ls_result = await db.execute(
                    select(LiveSession).where(LiveSession.id == gallery.live_session_id)
                )
                live_session = ls_result.scalar_one_or_none()
                if live_session and live_session.status in ('active', 'shooting', 'live'):
                    gallery.cover_image_url = item_thumbnail
                    gallery_logger.info(
                        f"Live session auto-thumbnail sync: gallery {gallery_id} cover updated to latest upload"
                    )
            except Exception as e:
                gallery_logger.warning(f"Live session thumbnail sync check failed: {e}")
    
    await db.commit()
    await db.refresh(item)
    
    # Notify tagged surfers
    if data.tagged_surfer_ids:
        for surfer_id in data.tagged_surfer_ids:
            notification = Notification(
                user_id=surfer_id,
                type='photo_tagged',
                title='You were tagged in a photo!',
                body=f'Check out the photo in {gallery.title}',
                data=json.dumps({
                    "gallery_item_id": item.id,
                    "gallery_id": gallery_id,
                    "photographer_id": photographer_id
                })
            )
            db.add(notification)
        await db.commit()
    
    return {
        "id": item.id,
        "gallery_id": gallery_id,
        "preview_url": item.preview_url,
        "message": "Item added to gallery"
    }



@router.delete("/galleries/{gallery_id}/items/{item_id}")
async def remove_item_from_gallery(
    gallery_id: str,
    item_id: str,
    photographer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Delete an item from a gallery (photographer only)"""
    # Verify gallery ownership
    result = await db.execute(select(Gallery).where(Gallery.id == gallery_id))
    gallery = result.scalar_one_or_none()
    
    if not gallery:
        raise HTTPException(status_code=404, detail="Gallery not found")
    
    if gallery.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized to modify this gallery")
    
    # Verify item exists in this gallery
    item_check = await db.execute(
        select(GalleryItem).where(
            GalleryItem.id == item_id,
            GalleryItem.gallery_id == gallery_id
        )
    )
    item = item_check.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found in this gallery")
    
    # Safe delete (protects paid surfer locker items)
    result = await safe_delete_gallery_item(db, item_id, photographer_id)
    
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    
    # Update gallery stats
    gallery.item_count = max(0, gallery.item_count - 1)
    
    await db.commit()
    
    return {**result, "gallery_id": gallery_id, "item_id": item_id}


# ============ CROSS-PROFILE TAGGING (Parent → Grom) ============

class GromTagRequest(BaseModel):
    gallery_item_id: str
