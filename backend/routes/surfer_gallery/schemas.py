"""Surfer gallery schemas — Pydantic models and helper functions."""
"""
Surfer Gallery Routes - "My Gallery" / "The Locker"
Service-to-Gallery logic enforces tier-based access and resolution limits
"""
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from database import AsyncSessionLocal
from models import (
    Profile, GalleryItem, SurferGalleryClaimQueue,
    GalleryTierEnum, Gallery
)
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone, timedelta
import logging
import json


logger = logging.getLogger(__name__)

class ScanLockerRequest(BaseModel):
    selfie_url: str
    spot_id: Optional[str] = None
    photographer_id: Optional[str] = None

async def async_global_scan(surfer_id: str, selfie_url: str, spot_id: Optional[str] = None, photographer_id: Optional[str] = None):
    """Compatibility entry point: unavailable matching never reads media or creates claims."""
    return {"analysis_status": "unavailable", "matches": []}




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

