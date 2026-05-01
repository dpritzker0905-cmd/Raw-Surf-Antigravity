"""Surfer gallery selection — included photos selection system and session browsing."""
from pydantic import BaseModel
from fastapi import Depends, HTTPException, Query, APIRouter
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from database import get_db
from datetime import datetime, timezone
from models import Gallery, GalleryItem, Profile

from .claims import SelectPhotosRequest
router = APIRouter()

@router.get("/selection-queue/{surfer_id}")
async def get_selection_queue(
    surfer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Get all pending photo selection quotas for a surfer.
    Returns sessions where the surfer has photos to select from their "included" allocation.
    """
    
    # Get all pending quotas
    result = await db.execute(
        select(SurferSelectionQuota)
        .where(SurferSelectionQuota.surfer_id == surfer_id)
        .where(SurferSelectionQuota.status == 'pending_selection')
        .options(
            selectinload(SurferSelectionQuota.photographer),
            selectinload(SurferSelectionQuota.booking),
            selectinload(SurferSelectionQuota.live_session)
        )
        .order_by(SurferSelectionQuota.created_at.desc())
    )
    quotas = result.scalars().all()
    
    response_quotas = []
    for quota in quotas:
        # Determine session type and ID
        session_type = 'booking' if quota.booking_id else 'live_session'
        session_id = quota.booking_id or quota.live_session_id
        
        # Get eligible gallery items for this session that haven't been selected yet
        items_query = select(SurferGalleryItem).where(
            SurferGalleryItem.surfer_id == surfer_id,
            SurferGalleryItem.selection_eligible == True,
            SurferGalleryItem.access_type == 'pending_selection'
        )
        
        if quota.booking_id:
            items_query = items_query.where(SurferGalleryItem.booking_id == quota.booking_id)
        else:
            items_query = items_query.where(SurferGalleryItem.live_session_id == quota.live_session_id)
        
        items_result = await db.execute(
            items_query.options(selectinload(SurferGalleryItem.gallery_item))
        )
        items = items_result.scalars().all()
        
        eligible_items = []
        for item in items:
            gi = item.gallery_item
            if not gi:
                continue
            eligible_items.append({
                "id": item.id,
                "gallery_item_id": item.gallery_item_id,
                "preview_url": gi.preview_url,
                "thumbnail_url": gi.thumbnail_url,
                "media_type": gi.media_type or 'image',
                "shot_at": gi.shot_at.isoformat() if gi.shot_at else None
            })
        
        # Get session/booking details for display
        photographer_name = quota.photographer.full_name if quota.photographer else None
        session_date = None
        spot_name = None
        
        if quota.booking:
            session_date = quota.booking.session_date
            spot_name = quota.booking.location
        elif quota.live_session:
            session_date = quota.live_session.started_at
            spot_name = quota.live_session.location_name
        
        response_quotas.append({
            "id": quota.id,
            "session_type": session_type,
            "session_id": session_id,
            "photographer_name": photographer_name,
            "photos_allowed": quota.photos_allowed,
            "photos_selected": quota.photos_selected,
            "videos_allowed": quota.videos_allowed,
            "videos_selected": quota.videos_selected,
            "remaining_selections": quota.photos_allowed - quota.photos_selected,
            "status": quota.status,
            "selection_deadline": quota.selection_deadline.isoformat() if quota.selection_deadline else None,
            "session_date": session_date.isoformat() if session_date else None,
            "spot_name": spot_name,
            "eligible_items": eligible_items,
            "total_eligible": len(eligible_items)
        })
    
    return {
        "quotas": response_quotas,
        "pending_count": len(response_quotas)
    }


@router.post("/selection-queue/{quota_id}/select")
async def select_included_photos(
    quota_id: str,
    request: SelectPhotosRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Surfer selects which photos/videos to claim as part of their "included" allocation.
    Once selected, these items become 'included' access_type (fully unlocked).
    Remaining items stay 'pending' for individual purchase.
    """
    
    # Get the quota
    result = await db.execute(
        select(SurferSelectionQuota).where(SurferSelectionQuota.id == quota_id)
    )
    quota = result.scalar_one_or_none()
    
    if not quota:
        raise HTTPException(status_code=404, detail="Selection quota not found")
    
    if quota.status != 'pending_selection':
        raise HTTPException(status_code=400, detail="Selection already completed or expired")
    
    # Check deadline
    if quota.selection_deadline and datetime.now(timezone.utc) > quota.selection_deadline:
        quota.status = 'expired'
        await db.commit()
        raise HTTPException(status_code=400, detail="Selection deadline has passed")
    
    # Separate photos and videos
    photo_items = []
    video_items = []
    
    for item_id in request.item_ids:
        # Get the surfer gallery item
        item_result = await db.execute(
            select(SurferGalleryItem)
            .where(SurferGalleryItem.id == item_id)
            .where(SurferGalleryItem.surfer_id == quota.surfer_id)
            .options(selectinload(SurferGalleryItem.gallery_item))
        )
        item = item_result.scalar_one_or_none()
        
        if not item:
            continue
        
        if not item.selection_eligible:
            continue
        
        # Check if from the same session
        if quota.booking_id and item.booking_id != quota.booking_id:
            continue
        if quota.live_session_id and item.live_session_id != quota.live_session_id:
            continue
        
        gi = item.gallery_item
        if gi.media_type == 'video':
            video_items.append(item)
        else:
            photo_items.append(item)
    
    # Validate selection counts
    remaining_photos = quota.photos_allowed - quota.photos_selected
    remaining_videos = quota.videos_allowed - quota.videos_selected
    
    if len(photo_items) > remaining_photos:
        raise HTTPException(
            status_code=400, 
            detail=f"You can only select {remaining_photos} more photos. You tried to select {len(photo_items)}."
        )
    
    if len(video_items) > remaining_videos:
        raise HTTPException(
            status_code=400, 
            detail=f"You can only select {remaining_videos} more videos. You tried to select {len(video_items)}."
        )
    
    # Mark selected items as 'included'
    for item in photo_items + video_items:
        item.access_type = 'included'
        item.is_paid = True  # Included = free access
        item.paid_at = datetime.now(timezone.utc)
        item.payment_method = 'included'
        item.selection_eligible = False  # No longer in selection pool
    
    # Update quota counts
    quota.photos_selected += len(photo_items)
    quota.videos_selected += len(video_items)
    
    # Check if selection is complete
    photos_done = quota.photos_selected >= quota.photos_allowed
    videos_done = quota.videos_selected >= quota.videos_allowed or quota.videos_allowed == 0
    
    if photos_done and videos_done:
        quota.status = 'selections_complete'
        quota.completed_at = datetime.now(timezone.utc)
        
        # Mark remaining eligible items as 'pending' (purchasable)
        remaining_result = await db.execute(
            select(SurferGalleryItem).where(
                SurferGalleryItem.surfer_id == quota.surfer_id,
                SurferGalleryItem.selection_eligible == True,
                SurferGalleryItem.access_type == 'pending_selection'
            )
        )
        remaining_items = remaining_result.scalars().all()
        
        for item in remaining_items:
            item.access_type = 'pending'  # Now requires purchase
            item.selection_eligible = False
    
    await db.commit()
    
    return {
        "success": True,
        "photos_selected": len(photo_items),
        "videos_selected": len(video_items),
        "quota_remaining_photos": quota.photos_allowed - quota.photos_selected,
        "quota_remaining_videos": quota.videos_allowed - quota.videos_selected,
        "selection_complete": quota.status == 'selections_complete'
    }


@router.get("/selection-queue/{quota_id}/items")
async def get_selection_eligible_items(
    quota_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Get all items eligible for selection in a specific quota.
    Returns both selected and unselected items for review.
    """
    
    result = await db.execute(
        select(SurferSelectionQuota)
        .where(SurferSelectionQuota.id == quota_id)
        .options(selectinload(SurferSelectionQuota.photographer))
    )
    quota = result.scalar_one_or_none()
    
    if not quota:
        raise HTTPException(status_code=404, detail="Selection quota not found")
    
    # Get items query
    items_query = select(SurferGalleryItem).where(
        SurferGalleryItem.surfer_id == quota.surfer_id
    )
    
    if quota.booking_id:
        items_query = items_query.where(SurferGalleryItem.booking_id == quota.booking_id)
    else:
        items_query = items_query.where(SurferGalleryItem.live_session_id == quota.live_session_id)
    
    items_result = await db.execute(
        items_query.options(selectinload(SurferGalleryItem.gallery_item))
        .order_by(SurferGalleryItem.added_at)
    )
    items = items_result.scalars().all()
    
    unselected = []
    selected = []
    
    for item in items:
        gi = item.gallery_item
        if not gi:
            continue
        
        item_data = {
            "id": item.id,
            "gallery_item_id": item.gallery_item_id,
            "preview_url": gi.preview_url,
            "thumbnail_url": gi.thumbnail_url,
            "media_type": gi.media_type or 'image',
            "shot_at": gi.shot_at.isoformat() if gi.shot_at else None,
            "access_type": item.access_type
        }
        
        if item.access_type == 'included':
            selected.append(item_data)
        elif item.access_type == 'pending_selection' and item.selection_eligible:
            unselected.append(item_data)
    
    return {
        "quota_id": quota_id,
        "photos_allowed": quota.photos_allowed,
        "photos_selected": quota.photos_selected,
        "videos_allowed": quota.videos_allowed,
        "videos_selected": quota.videos_selected,
        "status": quota.status,
        "selection_deadline": quota.selection_deadline.isoformat() if quota.selection_deadline else None,
        "unselected_items": unselected,
        "selected_items": selected,
        "total_unselected": len(unselected),
        "total_selected": len(selected)
    }



class UpdateSelectionPreferenceRequest(BaseModel):
    auto_select_on_expiry: bool  # True = auto-select, False = forfeit


@router.patch("/selection-queue/{quota_id}/preference")
async def update_selection_preference(
    quota_id: str,
    request: UpdateSelectionPreferenceRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Set the surfer's preference for what happens when selection deadline expires.
    
    - auto_select_on_expiry=True: Auto-select top photos based on engagement
    - auto_select_on_expiry=False: Forfeit remaining selections
    """
    
    result = await db.execute(
        select(SurferSelectionQuota).where(SurferSelectionQuota.id == quota_id)
    )
    quota = result.scalar_one_or_none()
    
    if not quota:
        raise HTTPException(status_code=404, detail="Selection quota not found")
    
    if quota.status != 'pending_selection':
        raise HTTPException(status_code=400, detail="Cannot change preference - selection already completed or expired")
    
    quota.auto_select_on_expiry = request.auto_select_on_expiry
    
    await db.commit()
    
    preference_text = "auto-select best photos" if request.auto_select_on_expiry else "forfeit remaining"
    
    return {
        "message": f"Preference updated: Will {preference_text} when deadline expires",
        "quota_id": quota_id,
        "auto_select_on_expiry": quota.auto_select_on_expiry,
        "selection_deadline": quota.selection_deadline.isoformat() if quota.selection_deadline else None
    }


@router.get("/selection-queue/{quota_id}/deadline-info")
async def get_selection_deadline_info(
    quota_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Get deadline and preference info for a selection quota.
    Useful for showing countdown and preference UI.
    """
    
    result = await db.execute(
        select(SurferSelectionQuota)
        .where(SurferSelectionQuota.id == quota_id)
        .options(selectinload(SurferSelectionQuota.photographer))
    )
    quota = result.scalar_one_or_none()
    
    if not quota:
        raise HTTPException(status_code=404, detail="Selection quota not found")
    
    now = datetime.now(timezone.utc)
    time_remaining = None
    is_expired = False
    
    if quota.selection_deadline:
        if now > quota.selection_deadline:
            is_expired = True
            time_remaining = 0
        else:
            time_remaining = int((quota.selection_deadline - now).total_seconds())
    
    return {
        "quota_id": quota_id,
        "status": quota.status,
        "selection_deadline": quota.selection_deadline.isoformat() if quota.selection_deadline else None,
        "time_remaining_seconds": time_remaining,
        "is_expired": is_expired,
        "auto_select_on_expiry": quota.auto_select_on_expiry,
        "preference_set": quota.auto_select_on_expiry is not None,
        "photos_remaining": quota.photos_allowed - quota.photos_selected,
        "videos_remaining": quota.videos_allowed - quota.videos_selected
    }


# ═══════════════════════════════════════════════════════════════════
# HYBRID MODEL D: "All Session" Browse Endpoint
# ═══════════════════════════════════════════════════════════════════


@router.get("/browse-session/{session_type}/{session_id}")
async def browse_session_photos(
    session_type: str,  # 'live', 'booking', 'on_demand'
    session_id: str,
    surfer_id: str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    """
    Hybrid Model D: 'All Session' tab.
    
    Returns ALL photos from a session, regardless of whether they've been
    AI-matched to this surfer. Each photo includes:
    - Whether it's already in the surfer's locker (is_in_locker)
    - Whether the surfer can self-claim it (can_claim)
    - AI confidence if it was matched (ai_confidence)
    
    This is the fallback browse view — ensures surfers never miss photos.
    """
    from models import Gallery, GalleryItem


    
    # Find the gallery for this session
    if session_type == 'live':
        gallery_result = await db.execute(
            select(Gallery).where(Gallery.live_session_id == session_id)
        )
    elif session_type == 'booking':
        gallery_result = await db.execute(
            select(Gallery).where(Gallery.booking_id == session_id)
        )
    elif session_type == 'on_demand':
        gallery_result = await db.execute(
            select(Gallery).where(Gallery.dispatch_id == session_id)
        )
    else:
        raise HTTPException(status_code=400, detail=f"Invalid session_type: {session_type}")
    
    gallery = gallery_result.scalar_one_or_none()
    if not gallery:
        return {"items": [], "gallery_id": None, "total": 0}
    
    # Get ALL gallery items for this gallery
    items_result = await db.execute(
        select(GalleryItem).where(
            GalleryItem.gallery_id == gallery.id,
            GalleryItem.is_deleted != True
        ).order_by(GalleryItem.created_at.desc())
    )
    all_items = items_result.scalars().all()
    
    # Get surfer's existing locker items for this gallery
    locker_result = await db.execute(
        select(SurferGalleryItem).where(
            SurferGalleryItem.surfer_id == surfer_id,
            SurferGalleryItem.gallery_item_id.in_([gi.id for gi in all_items])
        )
    )
    locker_items = {str(sgi.gallery_item_id): sgi for sgi in locker_result.scalars().all()}
    
    # Get photographer info
    photographer_result = await db.execute(
        select(Profile).where(Profile.id == gallery.photographer_id)
    )
    photographer = photographer_result.scalar_one_or_none()
    
    items = []
    for gi in all_items:
        gi_id = str(gi.id)
        locker_item = locker_items.get(gi_id)
        
        items.append({
            "id": gi_id,
            "url": gi.preview_url or gi.original_url,
            "thumbnail_url": gi.thumbnail_url,
            "media_type": gi.media_type,
            "created_at": gi.created_at.isoformat() if gi.created_at else None,
            "title": gi.title,
            # Hybrid Model D metadata
            "is_in_locker": locker_item is not None,
            "can_claim": locker_item is None,  # Can self-claim if not already in locker
            "locker_item_id": str(locker_item.id) if locker_item else None,
            "ai_confidence": locker_item.ai_confidence if locker_item else None,
            "ai_match_method": locker_item.ai_match_method if locker_item else None,
            "is_paid": locker_item.is_paid if locker_item else False,
            "access_type": locker_item.access_type if locker_item else None,
            # Photographer info
            "photographer_name": photographer.full_name if photographer else None,
            "photographer_avatar": photographer.avatar_url if photographer else None,
        })
    
    return {
        "gallery_id": str(gallery.id),
        "gallery_title": gallery.title,
        "session_type": session_type,
        "total": len(items),
        "in_locker_count": sum(1 for i in items if i["is_in_locker"]),
        "claimable_count": sum(1 for i in items if i["can_claim"]),
        "items": items
    }
