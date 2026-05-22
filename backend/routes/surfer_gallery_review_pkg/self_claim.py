"""
Surfer Gallery Review — Self-Claim ("That's me!") Endpoint
Allows surfers to manually claim photos the AI didn't match.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime, timezone
import logging
import json

from database import get_db
from models import (
    Profile, SurferGalleryItem, SurferGalleryClaimQueue,
    GalleryItem, Gallery, LiveSessionParticipant,
    BookingParticipant, DispatchRequest, SurfSpot,
    GalleryTierEnum
)
from .schemas import SelfClaimRequest

router = APIRouter(prefix="/surfer-gallery", tags=["Surfer Gallery Review"])
logger = logging.getLogger(__name__)


@router.post("/self-claim")
async def self_claim_photo(
    request: SelfClaimRequest,
    surfer_id: str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    """
    'That's me!' self-claim endpoint.

    Used in the 'All Session' browse tab — when a surfer sees a photo
    of themselves that the AI didn't match, they can self-tag it.

    This serves two purposes:
    1. Creates a SurferGalleryItem so the surfer can purchase/download
    2. Records as AI training data (confidence=0.95) to improve future matching
    """
    # Get the gallery item
    gi_result = await db.execute(
        select(GalleryItem).where(GalleryItem.id == request.gallery_item_id)
    )
    gallery_item = gi_result.scalar_one_or_none()
    if not gallery_item:
        raise HTTPException(status_code=404, detail="Photo not found")

    # Check if already claimed by this surfer
    existing = await db.execute(
        select(SurferGalleryItem).where(
            SurferGalleryItem.surfer_id == surfer_id,
            SurferGalleryItem.gallery_item_id == request.gallery_item_id
        )
    )
    if existing.scalar_one_or_none():
        return {"success": True, "already_claimed": True, "message": "Already in your locker"}

    # Verify surfer is a session participant (security: can't claim random photos)
    gallery_result = await db.execute(
        select(Gallery).where(Gallery.id == gallery_item.gallery_id)
    )
    gallery = gallery_result.scalar_one_or_none()

    is_participant = False
    if gallery:
        if gallery.live_session_id:
            part_result = await db.execute(
                select(LiveSessionParticipant).where(
                    LiveSessionParticipant.live_session_id == gallery.live_session_id,
                    LiveSessionParticipant.surfer_id == surfer_id,
                    LiveSessionParticipant.status.in_(['active', 'completed', 'confirmed'])
                )
            )
            is_participant = part_result.scalar_one_or_none() is not None
        elif gallery.booking_id:
            part_result = await db.execute(
                select(BookingParticipant).where(
                    BookingParticipant.booking_id == gallery.booking_id,
                    BookingParticipant.participant_id == surfer_id
                )
            )
            is_participant = part_result.scalar_one_or_none() is not None
        elif gallery.dispatch_id:
            dispatch_result = await db.execute(
                select(DispatchRequest).where(
                    DispatchRequest.id == gallery.dispatch_id,
                    DispatchRequest.requester_id == surfer_id
                )
            )
            is_participant = dispatch_result.scalar_one_or_none() is not None

    if not is_participant:
        raise HTTPException(
            status_code=403,
            detail="You must be a session participant to claim photos"
        )

    # Determine session context
    session_type = gallery.session_type or 'manual'
    if session_type in ('booking', 'on_demand'):
        gallery_tier = GalleryTierEnum.PRO
        max_photo = 'high'
        max_video = '4k'
    else:
        gallery_tier = GalleryTierEnum.STANDARD
        max_photo = 'standard'
        max_video = '1080p'

    spot_name = None
    if gallery.surf_spot_id:
        spot_result = await db.execute(
            select(SurfSpot).where(SurfSpot.id == gallery.surf_spot_id)
        )
        spot = spot_result.scalar_one_or_none()
        spot_name = spot.name if spot else None

    # Create the SurferGalleryItem
    surfer_item = SurferGalleryItem(
        surfer_id=surfer_id,
        gallery_item_id=request.gallery_item_id,
        photographer_id=gallery.photographer_id,
        live_session_id=gallery.live_session_id,
        booking_id=gallery.booking_id,
        service_type=session_type,
        gallery_tier=gallery_tier,
        max_photo_quality=max_photo,
        max_video_quality=max_video,
        is_paid=False,
        access_type='pending_selection',
        selection_eligible=True,
        # Self-claim metadata
        ai_suggested=False,
        ai_confidence=0.95,  # High — user confirmed it's them
        ai_match_method='self_claim',
        surfer_confirmed=True,
        session_date=gallery.session_date,
        spot_name=spot_name,
        spot_id=gallery.surf_spot_id,
    )
    db.add(surfer_item)

    # Record as AI training data — self-claims are high-quality training signals
    training_entry = SurferGalleryClaimQueue(
        surfer_id=surfer_id,
        gallery_item_id=request.gallery_item_id,
        photographer_id=gallery.photographer_id,
        live_session_id=gallery.live_session_id,
        booking_id=gallery.booking_id,
        ai_confidence=0.95,
        ai_match_reasons=json.dumps(['surfer_self_claim', 'user_confirmed']),
        status='claimed',
        claimed_at=datetime.now(timezone.utc)
    )
    db.add(training_entry)

    # Update tagged_surfer_ids on the gallery item
    tagged_ids = json.loads(gallery_item.tagged_surfer_ids) if gallery_item.tagged_surfer_ids else []
    if surfer_id not in tagged_ids:
        tagged_ids.append(surfer_id)
        gallery_item.tagged_surfer_ids = json.dumps(tagged_ids)

    await db.commit()

    logger.info(f"Self-claim: Surfer {surfer_id} claimed gallery item {request.gallery_item_id}")

    return {
        "success": True,
        "already_claimed": False,
        "surfer_gallery_item_id": str(surfer_item.id),
        "message": "Photo added to your locker! You can now preview and purchase it."
    }
