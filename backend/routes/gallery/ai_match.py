"""
AI lineup match and included photos integration.

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

# ============ AI LINEUP MATCH & INCLUDED PHOTOS INTEGRATION ============


class TriggerAIMatchRequest(BaseModel):
    gallery_id: Optional[str] = None
    booking_id: Optional[str] = None
    live_session_id: Optional[str] = None


@router.post("/gallery/trigger-ai-match")
async def trigger_ai_lineup_match(
    photographer_id: str,
    data: TriggerAIMatchRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Trigger AI lineup matching for a session's gallery items.
    Called after photographer finishes uploading photos to a session.
    
    This will:
    1. Run Vision API analysis on uploaded photos
    2. Match photos to session participants based on board/wetsuit/face
    3. Create SurferGalleryItems for each match
    4. Create selection quotas based on photographer's "photos included" setting
    """
    from services.ai_lineup_match import trigger_lineup_match_for_session
    
    # Verify photographer owns this gallery/session
    if data.gallery_id:
        gallery_result = await db.execute(
            select(Gallery)
            .where(Gallery.id == data.gallery_id)
            .options(selectinload(Gallery.live_session))
        )
        gallery = gallery_result.scalar_one_or_none()
        
        if not gallery or gallery.photographer_id != photographer_id:
            raise HTTPException(status_code=403, detail="Not authorized to access this gallery")
        
        session_id = gallery.live_session_id
        session_type = 'live_session'
        booking_id = None
        live_session = gallery.live_session
    elif data.booking_id:
        booking_result = await db.execute(
            select(Booking).where(Booking.id == data.booking_id)
        )
        booking = booking_result.scalar_one_or_none()
        
        if not booking or booking.photographer_id != photographer_id:
            raise HTTPException(status_code=403, detail="Not authorized to access this booking")
        
        session_id = data.booking_id
        session_type = 'booking'
        booking_id = data.booking_id
        live_session = None
    elif data.live_session_id:
        session_result = await db.execute(
            select(LiveSession).where(LiveSession.id == data.live_session_id)
        )
        live_session = session_result.scalar_one_or_none()
        
        if not live_session or live_session.photographer_id != photographer_id:
            raise HTTPException(status_code=403, detail="Not authorized to access this session")
        
        session_id = data.live_session_id
        session_type = 'live_session'
        booking_id = None
    else:
        raise HTTPException(status_code=400, detail="Must provide gallery_id, booking_id, or live_session_id")
    
    # Get photographer settings for "photos included"
    photographer_result = await db.execute(select(Profile).where(Profile.id == photographer_id))
    photographer = photographer_result.scalar_one_or_none()
    
    # Determine photos included based on session type
    photos_included = 0
    gallery_tier = GalleryTierEnum.STANDARD
    
    if session_type == 'booking' and booking_id:
        booking_result = await db.execute(select(Booking).where(Booking.id == booking_id))
        booking = booking_result.scalar_one_or_none()
        if booking:
            photos_included = booking.booking_photos_included or photographer.booking_photos_included or 0
            gallery_tier = GalleryTierEnum.PRO if booking.booking_type == 'scheduled' else GalleryTierEnum.STANDARD
    elif live_session:
        photos_included = live_session.photos_included or photographer.live_session_photos_included or 0
        gallery_tier = GalleryTierEnum.STANDARD  # Live sessions are always standard tier
    
    # Trigger AI matching (only if we have a valid session_id)
    if session_id:
        ai_result = await trigger_lineup_match_for_session(session_id, session_type, db)
    else:
        ai_result = {"success": False, "reason": "No session linked to this gallery"}
    
    if not ai_result.get('success'):
        # Continue without AI - will use manual tagging
        pass
    
    # Get participants to create selection quotas for
    participants = []
    if session_type == 'booking':
        part_result = await db.execute(
            select(BookingParticipant)
            .where(BookingParticipant.booking_id == booking_id)
            .options(selectinload(BookingParticipant.participant))
        )
        participants = [(p.participant_id, p.participant) for p in part_result.scalars().all() if p.participant]
    else:
        part_result = await db.execute(
            select(LiveSessionParticipant)
            .where(LiveSessionParticipant.live_session_id == session_id)
            .options(selectinload(LiveSessionParticipant.surfer))
        )
        participants = [(p.surfer_id, p.surfer) for p in part_result.scalars().all() if p.surfer]
    
    # Create selection quotas if photos_included > 0
    quotas_created = 0
    surfer_items_created = 0
    
    if photos_included > 0:
        selection_deadline = datetime.now(timezone.utc) + timedelta(days=7)
        
        for surfer_id, surfer in participants:
            # Check if quota already exists
            existing_quota = None
            if booking_id:
                existing_result = await db.execute(
                    select(SurferSelectionQuota).where(
                        SurferSelectionQuota.surfer_id == surfer_id,
                        SurferSelectionQuota.booking_id == booking_id
                    )
                )
                existing_quota = existing_result.scalar_one_or_none()
            else:
                existing_result = await db.execute(
                    select(SurferSelectionQuota).where(
                        SurferSelectionQuota.surfer_id == surfer_id,
                        SurferSelectionQuota.live_session_id == session_id
                    )
                )
                existing_quota = existing_result.scalar_one_or_none()
            
            if not existing_quota:
                quota = SurferSelectionQuota(
                    surfer_id=surfer_id,
                    photographer_id=photographer_id,
                    booking_id=booking_id if session_type == 'booking' else None,
                    live_session_id=session_id if session_type == 'live_session' else None,
                    photos_allowed=photos_included,
                    photos_selected=0,
                    videos_allowed=0,  # Future: could add video quota
                    videos_selected=0,
                    status='pending_selection',
                    selection_deadline=selection_deadline
                )
                db.add(quota)
                quotas_created += 1
    
    # Get gallery items from this session to create surfer gallery items
    if data.gallery_id:
        items_result = await db.execute(
            select(GalleryItem).where(GalleryItem.gallery_id == data.gallery_id)
        )
    elif booking_id:
        # Get items linked to this booking
        items_result = await db.execute(
            select(GalleryItem).where(GalleryItem.session_id == booking_id)
        )
    else:
        items_result = await db.execute(
            select(GalleryItem).where(GalleryItem.session_id == session_id)
        )
    
    gallery_items = items_result.scalars().all()
    
    # Create surfer gallery items for each participant
    for surfer_id, surfer in participants:
        for gi in gallery_items:
            # Check if already exists
            existing_item = await db.execute(
                select(SurferGalleryItem).where(
                    SurferGalleryItem.surfer_id == surfer_id,
                    SurferGalleryItem.gallery_item_id == gi.id
                )
            )
            if existing_item.scalar_one_or_none():
                continue
            
            # Determine access type based on photos_included
            if photos_included > 0:
                access_type = 'pending_selection'
                selection_eligible = True
            else:
                access_type = 'pending'
                selection_eligible = False
            
            # Determine quality limits
            max_photo_quality = 'high' if gallery_tier == GalleryTierEnum.PRO else 'standard'
            max_video_quality = '4k' if gallery_tier == GalleryTierEnum.PRO else '1080p'
            
            surfer_item = SurferGalleryItem(
                surfer_id=surfer_id,
                gallery_item_id=gi.id,
                photographer_id=photographer_id,
                booking_id=booking_id if session_type == 'booking' else None,
                live_session_id=session_id if session_type == 'live_session' else None,
                service_type=session_type,
                gallery_tier=gallery_tier,
                max_photo_quality=max_photo_quality,
                max_video_quality=max_video_quality,
                access_type=access_type,
                selection_eligible=selection_eligible,
                selection_deadline=datetime.now(timezone.utc) + timedelta(days=7) if selection_eligible else None,
                is_paid=False,
                ai_suggested=False,  # Will be updated by AI match results
                surfer_confirmed=False,
                spot_id=gi.spot_id
            )
            db.add(surfer_item)
            surfer_items_created += 1
    
    await db.commit()
    
    return {
        "success": True,
        "ai_match_result": ai_result,
        "quotas_created": quotas_created,
        "surfer_items_created": surfer_items_created,
        "photos_included_per_surfer": photos_included,
        "gallery_tier": gallery_tier.value,
        # Frontend-expected fields for toast messages
        "matches_found": ai_result.get("matches", 0) if ai_result.get("success") else 0,
        "items_processed": ai_result.get("processed", 0) if ai_result.get("success") else 0
    }




# ============================================================
# PHASE 3: SALES INTELLIGENCE ENDPOINTS
# ============================================================

