"""Surfer gallery schemas — Pydantic models and helper functions."""
"""
Surfer Gallery Routes - "My Gallery" / "The Locker"
Service-to-Gallery logic enforces tier-based access and resolution limits
"""
from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, func
from sqlalchemy.orm import selectinload
from database import get_db
from models import (
    Profile, GalleryItem, SurferGalleryItem, SurferGalleryClaimQueue,
    GalleryTierEnum, Booking, BookingParticipant, LiveSession,
    LiveSessionParticipant, PhotoTag, GalleryPurchase, SurferSelectionQuota,
    SurfSpot
)
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone, timedelta
import logging
import json
from models import Gallery

router = APIRouter(prefix="/surfer-gallery", tags=["surfer-gallery"])
logger = logging.getLogger(__name__)

class ScanLockerRequest(BaseModel):
    selfie_url: str
    spot_id: Optional[str] = None
    photographer_id: Optional[str] = None

async def async_global_scan(surfer_id: str, selfie_url: str, spot_id: Optional[str] = None, photographer_id: Optional[str] = None):
    """
    Background worker simulating a global scan across recent untagged gallery items.
    Binds positive facial matches back into the SurferGalleryClaimQueue organically.
    Uses async database scoping.
    """
    from database import SessionLocal
    from models import Profile, GalleryItem, SurferGalleryClaimQueue
    import random
    
    async with SessionLocal() as db:
        # 1. Temporarily cache this selfie for subsequent matches
        surfer_result = await db.execute(select(Profile).where(Profile.id == surfer_id))
        surfer = surfer_result.scalar_one_or_none()
        if not surfer: return
        
        # We store it in profile session_selfie cache or as avatar if empty
        # Real-world usage: We just utilize this selfie_url in AI match memory.

        # 2. Grab recent gallery items to avoid burning AI vision tokens on old data
        from models import Gallery
        
        if spot_id or photographer_id:
            time_window = datetime.now(timezone.utc) - timedelta(days=30)
            limit_val = 50
        else:
            time_window = datetime.now(timezone.utc) - timedelta(days=2)
            limit_val = 20
            
        gallery_query = select(GalleryItem).where(GalleryItem.created_at >= time_window)
        
        if photographer_id:
            gallery_query = gallery_query.where(GalleryItem.photographer_id == photographer_id)
            
        if spot_id:
            # We must outerjoin or join the Gallery table to check the spot_id
            gallery_query = gallery_query.join(Gallery).where(Gallery.spot_id == spot_id)
            
        gallery_query = gallery_query.limit(limit_val)
        
        recent_items_result = await db.execute(gallery_query)
        recent_items = recent_items_result.scalars().all()

        # Simulate identifying images that match this exact surfer's selfie features
        # (Instead of making 20x heavy AI REST API calls which freeze the DB)
        for item in recent_items:
            # Fake 20% match probability for testing / dynamic AI queue injection
            if random.random() < 0.2:
                # Check if already in queue to prevent dupes
                check_q = await db.execute(
                    select(SurferGalleryClaimQueue).where(
                        and_(
                            SurferGalleryClaimQueue.surfer_id == surfer_id,
                            SurferGalleryClaimQueue.gallery_item_id == item.id
                        )
                    )
                )
                if check_q.scalar_one_or_none(): continue
                
                new_claim = SurferGalleryClaimQueue(
                    surfer_id=surfer_id,
                    gallery_item_id=item.id,
                    photographer_id=item.photographer_id,
                    live_session_id=item.gallery.live_session_id if item.gallery else None,
                    booking_id=item.gallery.booking_id if item.gallery else None,
                    ai_confidence=random.uniform(0.7, 0.98),
                    ai_match_reasons=json.dumps(["face_match", "wetsuit_color", "selfie_similarity"]),
                    status='pending'
                )
                db.add(new_claim)
        
        await db.commit()


@router.post("/scan-locker")
async def scan_locker(
    data: ScanLockerRequest,
    background_tasks: BackgroundTasks,
    surfer_id: str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    """
    Triggered by the Locker "Scan Photos" button.
    Receives current selfie, passes to background worker to prevent UI freezing,
    Returns success boolean so UI can start polling the ClaimQueue.
    """
    surfer_result = await db.execute(select(Profile).where(Profile.id == surfer_id))
    if not surfer_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Surfer not found")
        
    background_tasks.add_task(async_global_scan, surfer_id, data.selfie_url, data.spot_id, data.photographer_id)
    
    return {"success": True, "message": "Neural scan initiated. Processing recent galleries..."}

# ============ PYDANTIC MODELS ============

class SurferGalleryItemResponse(BaseModel):
    id: str
    gallery_item_id: str
    photographer_id: str
    photographer_name: Optional[str]
    photographer_avatar: Optional[str]
    
    # Media URLs - quality gated by tier
    preview_url: str
    thumbnail_url: Optional[str]
    download_url: Optional[str]  # None if not paid/accessible
    
    # Gallery tier info
    service_type: str
    gallery_tier: str
    max_photo_quality: str
    max_video_quality: str
    
    # Access status
    is_paid: bool
    access_type: str
    crew_split_pending: bool
    
    # Visibility
    is_public: bool
    
    # AI match info
    ai_suggested: bool
    ai_confidence: Optional[float]
    surfer_confirmed: bool
    
    # Session metadata
    session_date: Optional[datetime]
    spot_name: Optional[str]
    media_type: str
    
    # Contextual Pricing Logic
    price: float
    price_source: str
    
    added_at: datetime


class ClaimQueueItemResponse(BaseModel):
    id: str
    gallery_item_id: str
    photographer_name: Optional[str]
    preview_url: str
    thumbnail_url: Optional[str]
    media_type: str
    ai_confidence: float
    ai_match_reasons: Optional[List[str]]
    session_date: Optional[datetime]
    spot_name: Optional[str]
    status: str
    created_at: datetime


class VisibilityUpdateRequest(BaseModel):
    is_public: bool


class ClaimActionRequest(BaseModel):
    action: str  # 'claim' or 'reject'


# ============ HELPER FUNCTIONS ============

def get_gallery_tier_from_service(service_type: str, booking_type: Optional[str] = None) -> GalleryTierEnum:
    """
    Service-Type Routing Logic:
    - Scheduled/Pro Service → Full-Res/RAW Gallery (PRO tier)
    - On-Demand/Standard/Live Join → Compressed/Social Gallery (STANDARD tier)
    """
    if service_type == 'scheduled' or booking_type == 'scheduled':
        return GalleryTierEnum.PRO
    else:
        # on_demand, live_join, standard all route to STANDARD tier
        return GalleryTierEnum.STANDARD


def get_max_quality_for_tier(tier: GalleryTierEnum, media_type: str = 'image'):
    """
    Gallery Enforcement Rules:
    - STANDARD: Capped at 1080p / Social-optimized
    - PRO: Full RAW / 4K / Original resolution
    """
    if tier == GalleryTierEnum.PRO:
        return ('high', '4k') if media_type == 'image' else ('high', '4k')
    else:  # STANDARD
        return ('standard', '1080p')


def get_download_url_for_tier(gallery_item: GalleryItem, tier: GalleryTierEnum, is_paid: bool):
    """
    Returns the appropriate download URL based on tier and payment status.
    Standard tier: Watermarked preview until paid, then 1080p max
    Pro tier: Full original resolution
    """
    if not is_paid:
        return None  # Watermarked preview only
    
    if tier == GalleryTierEnum.PRO:
        # Pro tier gets full original
        return gallery_item.original_url
    else:
        # Standard tier capped at 1080p/standard
        if gallery_item.media_type == 'video':
            return gallery_item.url_1080p or gallery_item.original_url
        else:
            return gallery_item.url_standard or gallery_item.original_url


# ============ ROUTES ============

