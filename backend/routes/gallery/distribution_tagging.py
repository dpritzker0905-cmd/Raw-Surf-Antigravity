"""
Gallery distribution tagging — tag/untag items, distribution status, publish galleries.

Extracted from distribution.py (v87) to keep modules under 800 LOC.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, case
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
import json
import logging

gallery_logger = logging.getLogger("routes.gallery")

from database import get_db
from models import (
    Profile, GalleryItem, Gallery, LiveSession, LiveSessionParticipant,
    SurferGalleryItem, Notification
)
from services.gallery_sync import manually_assign_item_to_surfer

router = APIRouter()


@router.post("/gallery/{gallery_id}/tag-item")
async def tag_single_item_to_surfer(
    gallery_id: str,
    photographer_id: str,
    data: TagItemToSurferRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Tag a single gallery item to a specific surfer's locker.
    
    Access type is determined automatically based on payment:
    - If surfer has remaining photos_credit from buy-in → 'included' (full-res)
    - Otherwise → 'pending_selection' (watermarked preview, purchase to unlock)
    
    Idempotent: won't create duplicates.
    """
    from services.gallery_sync import manually_assign_item_to_surfer
    
    # Verify gallery ownership
    result = await db.execute(select(Gallery).where(Gallery.id == gallery_id))
    gallery = result.scalar_one_or_none()
    if not gallery:
        raise HTTPException(status_code=404, detail="Gallery not found")
    if gallery.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    # Verify item belongs to gallery
    item_result = await db.execute(
        select(GalleryItem).where(
            GalleryItem.id == data.item_id,
            GalleryItem.gallery_id == gallery_id
        )
    )
    item = item_result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found in this gallery")
    
    # Check if already tagged
    existing_result = await db.execute(
        select(SurferGalleryItem).where(
            SurferGalleryItem.surfer_id == data.surfer_id,
            SurferGalleryItem.gallery_item_id == data.item_id
        )
    )
    existing_item = existing_result.scalar_one_or_none()
    if existing_item:
        is_delivered = existing_item.access_type in ('included', 'purchased', 'gifted')
        return {
            "message": "Already delivered to this surfer" if is_delivered else "Already tagged to this surfer",
            "item_id": data.item_id,
            "surfer_id": data.surfer_id,
            "already_tagged": True,
            "is_delivered": is_delivered,
            "access_type": existing_item.access_type
        }
    
    # Determine access_type based on payment credits
    # Use the correct credit pool: photos vs videos
    access_type = 'pending_selection'  # default: watermarked preview
    is_video = item.media_type == 'video'
    
    # Check if surfer has credits from their session buy-in
    participant_result = await db.execute(
        select(LiveSessionParticipant).where(
            LiveSessionParticipant.surfer_id == data.surfer_id,
            LiveSessionParticipant.photographer_id == photographer_id,
            LiveSessionParticipant.status.notin_(['cancelled', 'refunded'])
        ).order_by(LiveSessionParticipant.joined_at.desc()).limit(1)
    )
    participant = participant_result.scalar_one_or_none()
    
    credits_remaining = 0
    if participant:
        if is_video:
            credits_remaining = participant.videos_credit_remaining or 0
        else:
            credits_remaining = participant.photos_credit_remaining or 0
        
        # Retroactive fix: if credits are 0 but participant paid and no items distributed yet,
        # calculate from session's photos/videos_included (handles legacy records)
        if credits_remaining == 0 and participant.amount_paid and participant.amount_paid > 0:
            # Count ALL already-included items (unified pool approach)
            dist_count_result = await db.execute(
                select(func.count(SurferGalleryItem.id))
                .where(
                    SurferGalleryItem.surfer_id == data.surfer_id,
                    SurferGalleryItem.photographer_id == photographer_id,
                    SurferGalleryItem.access_type == 'included'
                )
            )
            already_included_total = dist_count_result.scalar() or 0
            
            # Get included counts from session settings
            photos_included_setting = 3  # default
            videos_included_setting = 0  # default
            if gallery.live_session_id:
                ls_result = await db.execute(
                    select(LiveSession).where(LiveSession.id == gallery.live_session_id)
                )
                ls = ls_result.scalar_one_or_none()
                if ls:
                    photos_included_setting = getattr(ls, 'photos_included', 3) or 3
                    raw_vid = getattr(ls, 'videos_included', None)
                    videos_included_setting = raw_vid if raw_vid and raw_vid > 0 else 0
            
            # When videos_included=0, photos_included is a unified pool for all content
            total_pool = photos_included_setting + videos_included_setting
            retroactive_credits = max(0, total_pool - already_included_total)
            if retroactive_credits > 0:
                credits_remaining = retroactive_credits
                # Repair the record for future calls
                participant.photos_credit_remaining = credits_remaining
    
    if credits_remaining > 0:
        access_type = 'included'  # Full resolution — covered by buy-in
        # Decrement the correct credit pool
        if participant:
            if is_video:
                participant.videos_credit_remaining = max(0, credits_remaining - 1)
            else:
                participant.photos_credit_remaining = max(0, credits_remaining - 1)
    
    try:
        await manually_assign_item_to_surfer(
            db=db,
            gallery_item_id=data.item_id,
            surfer_id=data.surfer_id,
            photographer_id=photographer_id,
            access_type=access_type,
            gallery=gallery
        )
        
        # Update tagged_surfer_ids on the GalleryItem for grid display
        tagged_ids = json.loads(item.tagged_surfer_ids) if item.tagged_surfer_ids else []
        if data.surfer_id not in tagged_ids:
            tagged_ids.append(data.surfer_id)
            item.tagged_surfer_ids = json.dumps(tagged_ids)
        
        await db.commit()
        
        # Get surfer profile for response
        surfer_result = await db.execute(select(Profile).where(Profile.id == data.surfer_id))
        surfer = surfer_result.scalar_one_or_none()
        
        return {
            "message": f"Tagged to surfer as {access_type}",
            "item_id": data.item_id,
            "surfer_id": data.surfer_id,
            "surfer_name": surfer.full_name if surfer else "Unknown",
            "surfer_avatar": surfer.avatar_url if surfer else None,
            "access_type": access_type,
            "credits_remaining": participant.photos_credit_remaining if participant else 0,
            "already_tagged": False
        }
    except Exception as e:
        gallery_logger.error(f"Failed to tag item {data.item_id} to surfer {data.surfer_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to tag item: {str(e)}")



@router.get("/gallery/{gallery_id}/surfer-items/{surfer_id}")
async def get_surfer_tagged_items(
    gallery_id: str,
    surfer_id: str,
    photographer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Get all items tagged/distributed to a specific surfer in a gallery.
    Returns thumbnails, access_type, and surfer_gallery_item IDs for untag support.
    """
    # Verify gallery ownership
    result = await db.execute(select(Gallery).where(Gallery.id == gallery_id))
    gallery = result.scalar_one_or_none()
    if not gallery:
        raise HTTPException(status_code=404, detail="Gallery not found")
    if gallery.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    # Get all gallery items for this gallery
    items_result = await db.execute(
        select(GalleryItem).where(
            GalleryItem.gallery_id == gallery_id,
            GalleryItem.is_deleted == False
        )
    )
    gallery_items = items_result.scalars().all()
    gallery_item_ids = [i.id for i in gallery_items]
    gallery_item_lookup = {i.id: i for i in gallery_items}
    
    if not gallery_item_ids:
        return {"gallery_id": gallery_id, "surfer_id": surfer_id, "tagged_items": []}
    
    # Get all SurferGalleryItem records for this surfer in this gallery
    sgi_result = await db.execute(
        select(SurferGalleryItem).where(
            SurferGalleryItem.surfer_id == surfer_id,
            SurferGalleryItem.gallery_item_id.in_(gallery_item_ids)
        )
    )
    surfer_items = sgi_result.scalars().all()
    
    tagged_items = []
    for sgi in surfer_items:
        gi = gallery_item_lookup.get(sgi.gallery_item_id)
        if gi:
            tagged_items.append({
                "surfer_gallery_item_id": sgi.id,
                "gallery_item_id": gi.id,
                "preview_url": gi.preview_url,
                "thumbnail_url": gi.thumbnail_url,
                "original_url": gi.original_url,
                "media_type": gi.media_type,
                "access_type": sgi.access_type,
                "ai_suggested": sgi.ai_suggested,
                "surfer_confirmed": sgi.surfer_confirmed,
                "added_at": sgi.added_at.isoformat() if sgi.added_at else None
            })
    
    return {
        "gallery_id": gallery_id,
        "surfer_id": surfer_id,
        "tagged_items": tagged_items
    }


class UntagItemRequest(BaseModel):
    surfer_id: str
    item_id: str


@router.post("/gallery/{gallery_id}/untag-item")
async def untag_item_from_surfer(
    gallery_id: str,
    photographer_id: str,
    data: UntagItemRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Remove a tagged item from a surfer's locker.
    Restores the surfer's photo credit if the item was 'included' access.
    Also removes the surfer from the item's tagged_surfer_ids JSON.
    """
    # Verify gallery ownership
    result = await db.execute(select(Gallery).where(Gallery.id == gallery_id))
    gallery = result.scalar_one_or_none()
    if not gallery:
        raise HTTPException(status_code=404, detail="Gallery not found")
    if gallery.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    # Find the SurferGalleryItem
    sgi_result = await db.execute(
        select(SurferGalleryItem).where(
            SurferGalleryItem.surfer_id == data.surfer_id,
            SurferGalleryItem.gallery_item_id == data.item_id
        )
    )
    sgi = sgi_result.scalar_one_or_none()
    if not sgi:
        raise HTTPException(status_code=404, detail="Item not tagged to this surfer")
    
    was_included = sgi.access_type == 'included'
    
    # Delete the SurferGalleryItem
    await db.delete(sgi)
    
    # Remove surfer from tagged_surfer_ids on GalleryItem
    item_result = await db.execute(
        select(GalleryItem).where(GalleryItem.id == data.item_id)
    )
    item = item_result.scalar_one_or_none()
    if item and item.tagged_surfer_ids:
        tagged_ids = json.loads(item.tagged_surfer_ids)
        if data.surfer_id in tagged_ids:
            tagged_ids.remove(data.surfer_id)
            item.tagged_surfer_ids = json.dumps(tagged_ids) if tagged_ids else None
    
    # Restore credit if the item was 'included' (covered by buy-in)
    # Use the correct credit pool: photo vs video
    credits_restored = False
    is_video = item.media_type == 'video' if item else False
    if was_included:
        participant_result = await db.execute(
            select(LiveSessionParticipant).where(
                LiveSessionParticipant.surfer_id == data.surfer_id,
                LiveSessionParticipant.photographer_id == photographer_id,
                LiveSessionParticipant.status.notin_(['cancelled', 'refunded'])
            ).order_by(LiveSessionParticipant.joined_at.desc()).limit(1)
        )
        participant = participant_result.scalar_one_or_none()
        if participant:
            if is_video:
                participant.videos_credit_remaining = (participant.videos_credit_remaining or 0) + 1
            else:
                participant.photos_credit_remaining = (participant.photos_credit_remaining or 0) + 1
            credits_restored = True
    
    await db.commit()
    
    return {
        "message": "Item untagged from surfer",
        "item_id": data.item_id,
        "surfer_id": data.surfer_id,
        "credit_restored": credits_restored,
        "was_included": was_included
    }


@router.get("/gallery/{gallery_id}/distribution-status")
async def get_gallery_distribution_status(
    gallery_id: str,
    photographer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Get per-item distribution status for all items in a gallery.
    Shows how many surfers each item has been distributed to.
    """
    result = await db.execute(
        select(Gallery).where(Gallery.id == gallery_id)
    )
    gallery = result.scalar_one_or_none()
    
    if not gallery:
        raise HTTPException(status_code=404, detail="Gallery not found")
    if gallery.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    # Get all items with their distribution counts
    items_result = await db.execute(
        select(GalleryItem).where(
            GalleryItem.gallery_id == gallery_id,
            GalleryItem.is_deleted == False
        )
    )
    items = items_result.scalars().all()
    
    item_statuses = []
    for item in items:
        # Count distributions for this item
        dist_result = await db.execute(
            select(
                func.count(SurferGalleryItem.id),
                func.count(case(
                    (SurferGalleryItem.ai_suggested == True, 1),
                    else_=None
                )),
                func.count(case(
                    (SurferGalleryItem.surfer_confirmed == True, 1),
                    else_=None
                ))
            )
            .where(SurferGalleryItem.gallery_item_id == item.id)
        )
        row = dist_result.first()
        total_dist = row[0] if row else 0
        ai_suggested = row[1] if row else 0
        confirmed = row[2] if row else 0
        
        # Get surfer names who received this item
        surfers_result = await db.execute(
            select(SurferGalleryItem.surfer_id, Profile.full_name, Profile.avatar_url)
            .join(Profile, SurferGalleryItem.surfer_id == Profile.id)
            .where(SurferGalleryItem.gallery_item_id == item.id)
        )
        surfer_list = [
            {"surfer_id": r[0], "name": r[1], "avatar_url": r[2]}
            for r in surfers_result.fetchall()
        ]
        
        # Determine distribution status
        if total_dist == 0:
            status = "unassigned"
        elif confirmed > 0:
            status = "confirmed"
        elif ai_suggested > 0:
            status = "ai_suggested"
        else:
            status = "distributed"
        
        # Check tagged_surfer_ids for tag info
        tagged_ids = json.loads(item.tagged_surfer_ids) if item.tagged_surfer_ids else []
        
        item_statuses.append({
            "item_id": item.id,
            "media_type": item.media_type,
            "preview_url": item.preview_url,
            "status": status,
            "distributed_to": total_dist,
            "ai_suggested": ai_suggested,
            "confirmed": confirmed,
            "tagged_surfer_ids": tagged_ids,
            "surfers": surfer_list
        })
    
    return {
        "gallery_id": gallery_id,
        "session_type": gallery.session_type,
        "is_linked": bool(gallery.live_session_id or gallery.booking_id or gallery.dispatch_id),
        "items": item_statuses
    }


# ============ PUBLISH GALLERY TO PUBLIC ============

class PublishGalleryRequest(BaseModel):
    is_published: bool = True  # True to publish, False to unpublish


@router.post("/gallery/{gallery_id}/publish")
async def publish_gallery_to_public(
    gallery_id: str,
    photographer_id: str,
    data: PublishGalleryRequest = PublishGalleryRequest(),
    db: AsyncSession = Depends(get_db)
):
    """
    Publish or unpublish a gallery to the photographer's public profile.
    Published galleries appear on the Sessions tab of the photographer's profile
    and in the public gallery system for users to browse.
    """
    result = await db.execute(select(Gallery).where(Gallery.id == gallery_id))
    gallery = result.scalar_one_or_none()
    if not gallery:
        raise HTTPException(status_code=404, detail="Gallery not found")
    if gallery.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    gallery.is_public = data.is_published
    gallery.is_featured = data.is_published  # Mark as featured when published
    
    await db.commit()
    
    action = "published" if data.is_published else "unpublished"
    gallery_logger.info(f"Gallery {gallery_id} {action} by photographer {photographer_id}")
    
    return {
        "message": f"Gallery {action} successfully",
        "gallery_id": gallery_id,
        "is_public": gallery.is_public,
        "is_featured": gallery.is_featured
    }


@router.get("/photographer/{photographer_id}/public-galleries")
async def get_photographer_public_galleries(
    photographer_id: str,
    limit: int = 20,
    offset: int = 0,
    db: AsyncSession = Depends(get_db)
):
    """
    Get all published/public galleries for a photographer's profile.
    These show on the photographer's Sessions tab and are browsable by users.
    Returns gallery metadata, cover images, item counts, and session info.
    """
    result = await db.execute(
        select(Gallery)
        .where(
            Gallery.photographer_id == photographer_id,
            Gallery.is_public == True
        )
        .order_by(Gallery.session_date.desc().nullslast(), Gallery.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    galleries = result.scalars().all()
    
    public_galleries = []
    for g in galleries:
        # Get first few preview items for thumbnails
        items_result = await db.execute(
            select(GalleryItem)
            .where(GalleryItem.gallery_id == g.id, GalleryItem.is_deleted == False)
            .order_by(GalleryItem.created_at.asc())
            .limit(6)
        )
        preview_items = items_result.scalars().all()
        
        public_galleries.append({
            "id": g.id,
            "title": g.title,
            "description": g.description,
            "cover_image_url": g.cover_image_url or (preview_items[0].preview_url if preview_items else None),
            "session_type": g.session_type,
            "session_date": g.session_date.isoformat() if g.session_date else None,
            "item_count": g.item_count or len(preview_items),
            "is_featured": g.is_featured,
            "preview_items": [
                {
                    "id": item.id,
                    "preview_url": item.preview_url,
                    "thumbnail_url": item.thumbnail_url,
                    "media_type": item.media_type,
                }
                for item in preview_items
            ],
            "created_at": g.created_at.isoformat() if g.created_at else None,
        })
    
    return {
        "photographer_id": photographer_id,
        "galleries": public_galleries,
        "total": len(public_galleries)
    }


# ============ SURFER LOCKER → PUBLIC SESSIONS TAB ============
