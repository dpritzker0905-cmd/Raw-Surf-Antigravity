"""
Gallery schemas — Pydantic models and shared helpers for the gallery domain.

Extracted from the gallery.py monolith to support the decomposed package structure.
"""

from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


# ─── Pydantic Request/Response Models ────────────────────────────────────────

class GalleryItemCreate(BaseModel):
    original_url: str
    preview_url: str
    thumbnail_url: Optional[str] = None
    media_type: str = 'image'  # 'image' or 'video'
    spot_id: Optional[str] = None
    session_id: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    tags: Optional[List[str]] = None
    price: float = 5.0
    is_for_sale: bool = True
    tagged_surfer_ids: Optional[List[str]] = None
    shot_at: Optional[datetime] = None
    # Video metadata
    video_width: Optional[int] = None
    video_height: Optional[int] = None
    video_duration: Optional[float] = None

class GalleryItemUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    tags: Optional[List[str]] = None
    price: Optional[float] = None
    custom_price: Optional[float] = None  # Dynamic pricing: manual override for premium shots
    is_for_sale: Optional[bool] = None
    is_public: Optional[bool] = None
    is_featured: Optional[bool] = None

class GalleryItemResponse(BaseModel):
    id: str
    photographer_id: str
    photographer_name: Optional[str]
    photographer_avatar: Optional[str]
    spot_id: Optional[str]
    spot_name: Optional[str]
    original_url: str
    preview_url: str
    thumbnail_url: Optional[str]
    media_type: str
    title: Optional[str]
    description: Optional[str]
    tags: Optional[List[str]]
    price: float
    custom_price: Optional[float] = None  # Dynamic pricing: manual override if set
    display_price: Optional[float] = None  # Calculated price for display
    is_for_sale: bool
    is_public: bool
    is_featured: bool
    view_count: int
    purchase_count: int
    is_purchased: bool = False
    video_width: Optional[int]
    video_height: Optional[int]
    video_duration: Optional[float]
    created_at: datetime
    shot_at: Optional[datetime]

class PurchaseRequest(BaseModel):
    payment_method: str = 'credits'
    quality_tier: str = 'standard'  # 'web', 'standard', 'high' for images; '720p', '1080p', '4k' for videos

class GalleryCreate(BaseModel):
    title: str
    description: Optional[str] = None
    surf_spot_id: Optional[str] = None
    cover_image_url: Optional[str] = None
    # Session linking at creation (Phase 5 — eliminates orphaned galleries)
    session_type: Optional[str] = None  # 'live', 'on_demand', 'booking', 'manual'
    live_session_id: Optional[str] = None
    booking_id: Optional[str] = None
    dispatch_id: Optional[str] = None
    # Per-gallery pricing (optional)
    price_web: Optional[float] = None
    price_standard: Optional[float] = None
    price_high: Optional[float] = None
    price_720p: Optional[float] = None
    price_1080p: Optional[float] = None
    price_4k: Optional[float] = None


class GalleryUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    cover_image_url: Optional[str] = None
    is_public: Optional[bool] = None
    is_featured: Optional[bool] = None
    # Per-gallery pricing
    price_web: Optional[float] = None
    price_standard: Optional[float] = None
    price_high: Optional[float] = None
    price_720p: Optional[float] = None
    price_1080p: Optional[float] = None
    price_4k: Optional[float] = None


# ─── Shared Helper Functions ─────────────────────────────────────────────────

def get_quality_price(item, photographer, quality_tier: str) -> tuple:
    """
    Get price for a quality tier, using item override or photographer default.
    Returns (price, download_url)
    """
    if item.media_type == 'video':
        if quality_tier == '720p':
            price = item.price_720p or photographer.video_price_720p or 8.0
            url = item.url_720p or item.preview_url
        elif quality_tier == '1080p':
            price = item.price_1080p or photographer.video_price_1080p or 15.0
            url = item.url_1080p or item.original_url
        elif quality_tier == '4k':
            price = item.price_4k or photographer.video_price_4k or 30.0
            url = item.original_url
        else:
            price = item.price or photographer.video_price_1080p or 15.0
            url = item.original_url
    else:
        if quality_tier == 'web':
            price = item.price_web or photographer.photo_price_web or 3.0
            url = item.url_web or item.preview_url
        elif quality_tier == 'standard':
            price = item.price_standard or photographer.photo_price_standard or 5.0
            url = item.url_standard or item.original_url
        elif quality_tier == 'high':
            price = item.price_high or photographer.photo_price_high or 10.0
            url = item.original_url
        else:
            price = item.price or photographer.photo_price_standard or 5.0
            url = item.original_url
    
    return price, url
