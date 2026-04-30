"""
Gallery distribution — distribute to surfers, tag items, publish galleries.

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

from routes.gamification import check_badge_milestones
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

# ============ OPERATIONAL ENDPOINTS ============

@router.post("/gallery/{gallery_id}/distribute")
async def trigger_gallery_distribution(
    gallery_id: str,
    photographer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Manually trigger distribution of all items in a gallery to session participants.
    Used for:
    - Re-running distribution after fixing participant status issues
    - Verifying the auto-distribution pipeline works end-to-end
    - Backfilling locker items for galleries uploaded before distribution was wired
    
    Idempotent: won't create duplicate SurferGalleryItems.
    """
    # Verify gallery exists and belongs to photographer
    result = await db.execute(
        select(Gallery).where(Gallery.id == gallery_id)
    )
    gallery = result.scalar_one_or_none()
    
    if not gallery:
        raise HTTPException(status_code=404, detail="Gallery not found")
    if gallery.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    # Must be a session-linked gallery
    if not gallery.live_session_id and not gallery.booking_id and not gallery.dispatch_id:
        raise HTTPException(
            status_code=400, 
            detail="Gallery is not linked to a session. Distribution only works for session galleries."
        )
    
    # Get all items in this gallery
    items_result = await db.execute(
        select(GalleryItem).where(
            GalleryItem.gallery_id == gallery_id,
            GalleryItem.is_deleted == False
        )
    )
    items = items_result.scalars().all()
    
    if not items:
        return {
            "message": "No items to distribute",
            "gallery_id": gallery_id,
            "total_items": 0,
            "total_distributed": 0
        }
    
    total_distributed = 0
    distribution_details = []
    
    for item in items:
        try:
            count = await distribute_gallery_item_to_participants(db, item.id, gallery)
            total_distributed += count
            distribution_details.append({
                "item_id": item.id,
                "media_type": item.media_type,
                "distributed_to": count
            })
        except Exception as e:
            gallery_logger.warning(f"Distribution failed for item {item.id}: {e}")
            distribution_details.append({
                "item_id": item.id,
                "error": str(e)
            })
    
    await db.commit()
    
    return {
        "message": f"Distributed {total_distributed} locker items across {len(items)} gallery items",
        "gallery_id": gallery_id,
        "session_type": gallery.session_type,
        "live_session_id": gallery.live_session_id,
        "total_items": len(items),
        "total_distributed": total_distributed,
        "details": distribution_details
    }


@router.get("/gallery/{gallery_id}/session-participants")
async def get_gallery_session_participants(
    gallery_id: str,
    photographer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Get all session participants for a gallery's linked session.
    Returns participant profiles with distribution status for each.
    Used by the photographer's distribution UI.
    """
    result = await db.execute(
        select(Gallery).where(Gallery.id == gallery_id)
    )
    gallery = result.scalar_one_or_none()
    
    if not gallery:
        raise HTTPException(status_code=404, detail="Gallery not found")
    if gallery.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    participants = []
    session_info = {
        "session_type": gallery.session_type,
        "live_session_id": gallery.live_session_id,
        "booking_id": gallery.booking_id,
        "dispatch_id": gallery.dispatch_id,
        "session_date": gallery.session_date.isoformat() if gallery.session_date else None,
        "is_linked": bool(gallery.live_session_id or gallery.booking_id or gallery.dispatch_id)
    }
    
    if gallery.live_session_id:
        # Get live session participants with profiles
        # Try matching by live_session_id first
        part_result = await db.execute(
            select(LiveSessionParticipant, Profile)
            .join(Profile, LiveSessionParticipant.surfer_id == Profile.id)
            .where(LiveSessionParticipant.live_session_id == gallery.live_session_id)
            .where(LiveSessionParticipant.status.notin_(['cancelled', 'refunded']))
        )
        rows = part_result.fetchall()
        
        # FALLBACK: If no participants found by live_session_id, some may have been
        # created via card payment path which doesn't set live_session_id.
        # Fall back to matching by photographer_id + approximate time window.
        if not rows:
            # Get the live session to find the photographer and time range
            from models import LiveSession as LS
            ls_result = await db.execute(
                select(LS).where(LS.id == gallery.live_session_id)
            )
            live_session = ls_result.scalar_one_or_none()
            
            if live_session:
                from datetime import timedelta
                # Look for participants of this photographer around the session time
                session_start = live_session.created_at
                if session_start:
                    time_start = session_start - timedelta(hours=1)
                    time_end = (live_session.ended_at or session_start) + timedelta(hours=6)
                    
                    part_result = await db.execute(
                        select(LiveSessionParticipant, Profile)
                        .join(Profile, LiveSessionParticipant.surfer_id == Profile.id)
                        .where(LiveSessionParticipant.photographer_id == live_session.photographer_id)
                        .where(LiveSessionParticipant.status.notin_(['cancelled', 'refunded']))
                        .where(LiveSessionParticipant.joined_at >= time_start)
                        .where(LiveSessionParticipant.joined_at <= time_end)
                    )
                    rows = part_result.fetchall()
        
        seen_surfer_ids = set()
        for participant, profile in rows:
            if profile.id in seen_surfer_ids:
                continue  # Skip duplicates
            seen_surfer_ids.add(profile.id)
            # Count how many items are distributed to this surfer from this gallery
            dist_count_result = await db.execute(
                select(func.count(SurferGalleryItem.id))
                .where(
                    SurferGalleryItem.surfer_id == profile.id,
                    SurferGalleryItem.gallery_item_id.in_(
                        select(GalleryItem.id).where(GalleryItem.gallery_id == gallery_id)
                    )
                )
            )
            distributed_count = dist_count_result.scalar() or 0
            
            # Retroactive credit fix: if 0 but participant paid, calculate from session
            effective_credits = participant.photos_credit_remaining or 0
            if effective_credits == 0 and participant.amount_paid and participant.amount_paid > 0:
                # Count ALL included items (photos + videos) since photos_included
                # covers all content types when videos_included is 0
                included_dist_result = await db.execute(
                    select(func.count(SurferGalleryItem.id)).where(
                        SurferGalleryItem.surfer_id == profile.id,
                        SurferGalleryItem.photographer_id == gallery.photographer_id,
                        SurferGalleryItem.access_type == 'included'
                    )
                )
                already_included = included_dist_result.scalar() or 0
                photos_included_setting = 3  # default
                videos_included_setting = 0  # default
                if gallery.live_session_id:
                    ls_result2 = await db.execute(
                        select(LiveSession).where(LiveSession.id == gallery.live_session_id)
                    )
                    ls2 = ls_result2.scalar_one_or_none()
                    if ls2:
                        photos_included_setting = ls2.photos_included or 3
                        raw_vid = getattr(ls2, 'videos_included', None)
                        videos_included_setting = raw_vid if raw_vid and raw_vid > 0 else 0
                # When videos_included=0, photos_included is a unified pool
                total_pool = photos_included_setting + videos_included_setting
                effective_credits = max(0, total_pool - already_included)
                # Repair the record
                if effective_credits > 0:
                    participant.photos_credit_remaining = effective_credits
            
            participants.append({
                "surfer_id": profile.id,
                "full_name": profile.full_name,
                "username": profile.username,
                "avatar_url": profile.avatar_url,
                "selfie_url": participant.selfie_url,
                "amount_paid": participant.amount_paid,
                "joined_at": participant.joined_at.isoformat() if participant.joined_at else None,
                "status": participant.status,
                "items_distributed": distributed_count,
                "photos_credit_remaining": effective_credits,
                "resolution_preference": participant.resolution_preference or 'standard',
                "payment_method": participant.payment_method
            })
    
    elif gallery.booking_id:
        part_result = await db.execute(
            select(BookingParticipant, Profile)
            .join(Profile, BookingParticipant.participant_id == Profile.id)
            .where(BookingParticipant.booking_id == gallery.booking_id)
            .where(BookingParticipant.status.in_(['confirmed', 'completed']))
        )
        for participant, profile in part_result.fetchall():
            dist_count_result = await db.execute(
                select(func.count(SurferGalleryItem.id))
                .where(
                    SurferGalleryItem.surfer_id == profile.id,
                    SurferGalleryItem.gallery_item_id.in_(
                        select(GalleryItem.id).where(GalleryItem.gallery_id == gallery_id)
                    )
                )
            )
            distributed_count = dist_count_result.scalar() or 0
            
            participants.append({
                "surfer_id": profile.id,
                "full_name": profile.full_name,
                "username": profile.username,
                "avatar_url": profile.avatar_url,
                "selfie_url": None,
                "amount_paid": getattr(participant, 'amount_paid', 0),
                "joined_at": participant.created_at.isoformat() if hasattr(participant, 'created_at') and participant.created_at else None,
                "status": participant.status,
                "items_distributed": distributed_count
            })
    
    elif gallery.dispatch_id:
        dispatch_result = await db.execute(
            select(DispatchRequest, Profile)
            .join(Profile, DispatchRequest.requester_id == Profile.id)
            .where(DispatchRequest.id == gallery.dispatch_id)
        )
        row = dispatch_result.first()
        if row:
            dispatch, profile = row
            dist_count_result = await db.execute(
                select(func.count(SurferGalleryItem.id))
                .where(
                    SurferGalleryItem.surfer_id == profile.id,
                    SurferGalleryItem.gallery_item_id.in_(
                        select(GalleryItem.id).where(GalleryItem.gallery_id == gallery_id)
                    )
                )
            )
            distributed_count = dist_count_result.scalar() or 0
            
            participants.append({
                "surfer_id": profile.id,
                "full_name": profile.full_name,
                "username": profile.username,
                "avatar_url": profile.avatar_url,
                "selfie_url": None,
                "amount_paid": getattr(dispatch, 'price', 0),
                "joined_at": dispatch.created_at.isoformat() if dispatch.created_at else None,
                "status": dispatch.status,
                "items_distributed": distributed_count
            })
    
    # Get total gallery items for distribution progress calculation
    item_count_result = await db.execute(
        select(func.count(GalleryItem.id)).where(
            GalleryItem.gallery_id == gallery_id,
            GalleryItem.is_deleted == False
        )
    )
    total_items = item_count_result.scalar() or 0
    
    return {
        "session": session_info,
        "participants": participants,
        "total_gallery_items": total_items
    }


class LinkSessionRequest(BaseModel):
    live_session_id: Optional[str] = None
    booking_id: Optional[str] = None
    dispatch_id: Optional[str] = None


@router.post("/gallery/{gallery_id}/link-session")
async def link_gallery_to_session(
    gallery_id: str,
    photographer_id: str,
    data: LinkSessionRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Retroactively link a gallery to a session (live, booking, or dispatch).
    This enables auto-distribution for galleries that were created manually
    or whose session link was lost.
    """
    result = await db.execute(
        select(Gallery).where(Gallery.id == gallery_id)
    )
    gallery = result.scalar_one_or_none()
    
    if not gallery:
        raise HTTPException(status_code=404, detail="Gallery not found")
    if gallery.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    if not data.live_session_id and not data.booking_id and not data.dispatch_id:
        raise HTTPException(status_code=400, detail="Must provide live_session_id, booking_id, or dispatch_id")
    
    # Validate the session exists and belongs to this photographer
    if data.live_session_id:
        ls_result = await db.execute(
            select(LiveSession).where(
                LiveSession.id == data.live_session_id,
                LiveSession.photographer_id == photographer_id
            )
        )
        ls = ls_result.scalar_one_or_none()
        if not ls:
            raise HTTPException(status_code=404, detail="Live session not found or not yours")
        gallery.live_session_id = data.live_session_id
        gallery.session_type = 'live'
        if ls.surf_spot_id and not gallery.surf_spot_id:
            gallery.surf_spot_id = ls.surf_spot_id
        if ls.started_at and not gallery.session_date:
            gallery.session_date = ls.started_at
    
    elif data.booking_id:
        bk_result = await db.execute(
            select(Booking).where(
                Booking.id == data.booking_id,
                Booking.photographer_id == photographer_id
            )
        )
        bk = bk_result.scalar_one_or_none()
        if not bk:
            raise HTTPException(status_code=404, detail="Booking not found or not yours")
        gallery.booking_id = data.booking_id
        gallery.session_type = 'booking'
    
    elif data.dispatch_id:
        dp_result = await db.execute(
            select(DispatchRequest).where(
                DispatchRequest.id == data.dispatch_id,
                DispatchRequest.photographer_id == photographer_id
            )
        )
        dp = dp_result.scalar_one_or_none()
        if not dp:
            raise HTTPException(status_code=404, detail="Dispatch request not found or not yours")
        gallery.dispatch_id = data.dispatch_id
        gallery.session_type = 'on_demand'
    
    await db.commit()
    
    return {
        "message": "Gallery linked to session successfully",
        "gallery_id": gallery_id,
        "session_type": gallery.session_type,
        "live_session_id": gallery.live_session_id,
        "booking_id": gallery.booking_id,
        "dispatch_id": gallery.dispatch_id
    }


class DistributeToSurferRequest(BaseModel):
    surfer_id: str
    access_type: str = 'pending_selection'  # 'pending_selection', 'included', 'gifted'


@router.post("/gallery/{gallery_id}/distribute-to-surfer")
async def distribute_gallery_to_surfer(
    gallery_id: str,
    photographer_id: str,
    data: DistributeToSurferRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Distribute ALL items in a gallery to a specific surfer's locker.
    Used for manual assignment when photographers want to push entire gallery
    contents to a surfer who was in the session.
    
    Idempotent: won't create duplicates for already-distributed items.
    """
    from services.gallery_sync import manually_assign_item_to_surfer
    
    result = await db.execute(
        select(Gallery).where(Gallery.id == gallery_id)
    )
    gallery = result.scalar_one_or_none()
    
    if not gallery:
        raise HTTPException(status_code=404, detail="Gallery not found")
    if gallery.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    # Verify surfer exists
    surfer_result = await db.execute(select(Profile).where(Profile.id == data.surfer_id))
    surfer = surfer_result.scalar_one_or_none()
    if not surfer:
        raise HTTPException(status_code=404, detail="Surfer not found")
    
    # Get all items in the gallery
    items_result = await db.execute(
        select(GalleryItem).where(
            GalleryItem.gallery_id == gallery_id,
            GalleryItem.is_deleted == False
        )
    )
    items = items_result.scalars().all()
    
    if not items:
        return {
            "message": "No items to distribute",
            "gallery_id": gallery_id,
            "surfer_id": data.surfer_id,
            "items_distributed": 0
        }
    
    distributed_count = 0
    skipped_count = 0
    included_count = 0
    preview_count = 0
    
    # ── Credit-aware distribution ──
    # Look up participant's credit pool to determine access_type per item
    participant = None
    photos_included_setting = 3
    videos_included_setting = 0
    
    # Check if surfer is a session participant
    for Model, session_id_field in [
        (LiveSessionParticipant, 'live_session_id'),
        (BookingParticipant, 'booking_id'),
    ]:
        session_id = getattr(gallery, session_id_field, None)
        if session_id:
            p_result = await db.execute(
                select(Model).where(
                    Model.session_id == session_id if hasattr(Model, 'session_id') else getattr(Model, session_id_field.replace('_id', '_id')) == session_id,
                    Model.surfer_id == data.surfer_id
                )
            )
            participant = p_result.scalar_one_or_none()
            if participant:
                break
    
    # Get session settings for credit pool
    if gallery.live_session_id:
        ls_result = await db.execute(
            select(LiveSession).where(LiveSession.id == gallery.live_session_id)
        )
        ls = ls_result.scalar_one_or_none()
        if ls:
            photos_included_setting = ls.photos_included or 3
            raw_vid = getattr(ls, 'videos_included', None)
            videos_included_setting = raw_vid if raw_vid and raw_vid > 0 else 0
    
    total_credit_pool = photos_included_setting + videos_included_setting
    
    # Count already-included items for this surfer
    already_included_result = await db.execute(
        select(func.count(SurferGalleryItem.id)).where(
            SurferGalleryItem.surfer_id == data.surfer_id,
            SurferGalleryItem.photographer_id == photographer_id,
            SurferGalleryItem.access_type == 'included'
        )
    )
    already_included_count = already_included_result.scalar() or 0
    credits_available = max(0, total_credit_pool - already_included_count) if participant else 0
    
    for item in items:
        # Check if already distributed
        existing = await db.execute(
            select(SurferGalleryItem).where(
                SurferGalleryItem.surfer_id == data.surfer_id,
                SurferGalleryItem.gallery_item_id == item.id
            )
        )
        if existing.scalar_one_or_none():
            skipped_count += 1
            continue
        
        # Determine access_type based on remaining credits
        if credits_available > 0:
            item_access_type = 'included'
            credits_available -= 1
            included_count += 1
        else:
            item_access_type = data.access_type  # fallback to request default (pending_selection)
            preview_count += 1
        
        try:
            result = await manually_assign_item_to_surfer(
                db=db,
                gallery_item_id=item.id,
                surfer_id=data.surfer_id,
                photographer_id=photographer_id,
                access_type=item_access_type,
                gallery=gallery
            )
            distributed_count += 1
        except Exception as e:
            gallery_logger.warning(f"Failed to distribute item {item.id} to surfer {data.surfer_id}: {e}")
    
    await db.commit()
    
    # Send notification
    try:
        photographer_result = await db.execute(select(Profile).where(Profile.id == photographer_id))
        photographer = photographer_result.scalar_one_or_none()
        photographer_name = photographer.full_name if photographer else "Your photographer"
        
        notification = Notification(
            user_id=data.surfer_id,
            type='gallery_distributed',
            title=f'{distributed_count} new photos in your Locker!',
            body=f'{photographer_name} shared {distributed_count} photos/videos from your session. Check your Locker!',
            data=json.dumps({
                "type": "gallery_distributed",
                "gallery_id": gallery_id,
                "photographer_id": photographer_id,
                "items_count": distributed_count
            })
        )
        db.add(notification)
        await db.commit()
    except Exception as e:
        gallery_logger.warning(f"Failed to send distribution notification: {e}")
    
    return {
        "message": f"Distributed {distributed_count} items to {surfer.full_name}'s Locker ({included_count} included, {preview_count} preview)",
        "gallery_id": gallery_id,
        "surfer_id": data.surfer_id,
        "surfer_name": surfer.full_name,
        "items_distributed": distributed_count,
        "items_included": included_count,
        "items_preview": preview_count,
        "items_skipped": skipped_count,
        "total_items": len(items)
    }


class TagItemToSurferRequest(BaseModel):
    surfer_id: str
    item_id: str


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
