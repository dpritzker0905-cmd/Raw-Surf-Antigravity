"""Condition reports schemas — Pydantic models and constants."""
"""
Condition Reports API - Professional condition reports from photographers
Feeds into the Conditions Explorer tab in the Explore page
"""
from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, desc
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timedelta, timezone

from database import get_db
from models import Profile, SurfSpot, ConditionReport, Story, Post, LiveSession, RoleEnum, Gallery, GalleryItem
from websocket_manager import broadcast_new_condition_report

import logging
cr_logger = logging.getLogger(__name__)

router = APIRouter()

# Report duration - 24 hours (like stories)
REPORT_DURATION_HOURS = 24


def _is_broken_url(url: Optional[str]) -> bool:
    """Check if a URL is a broken local/ephemeral path that won't resolve in production."""
    if not url or not url.strip():
        return True
    return url.startswith('/api/uploads/') or url.startswith('/uploads/')


def _is_watermarked_url(url: Optional[str]) -> bool:
    """Check if a URL points to a watermarked preview image.
    Watermarked previews typically contain '_preview' in the filename.
    Condition reports are free public content and must never show watermarks."""
    if not url:
        return False
    return '_preview' in url.lower()


async def _auto_heal_report_media(report: ConditionReport, db) -> bool:
    """
    Auto-heal broken or watermarked media URLs on condition reports.
    
    Condition reports are FREE public content — they must NEVER show watermarks.
    This function fixes two classes of bad URLs:
    1. Broken local paths (e.g. /api/uploads/...)
    2. Watermarked preview URLs (containing '_preview' in the filename)
    
    Resolution strategy:
    1. Find the matching gallery item by media URL similarity
    2. Find gallery items linked via live_session_id
    3. Find latest gallery item for this photographer+spot
    4. Fall back to any recent gallery item from this photographer
    
    Returns True if any URLs were healed.
    Wrapped in try/except — MUST NEVER crash the parent endpoint.
    """
    try:
        media_broken = _is_broken_url(report.media_url)
        thumb_broken = _is_broken_url(report.thumbnail_url)
        media_watermarked = _is_watermarked_url(report.media_url)
        thumb_watermarked = _is_watermarked_url(report.thumbnail_url)
        
        needs_heal = media_broken or thumb_broken or media_watermarked or thumb_watermarked
        
        # If both URLs are valid and unwatermarked, nothing to do
        if not needs_heal:
            return False
        
        healed = False
        valid_url = None
        
        # Strategy 1: Match gallery item by URL pattern
        # If the media_url is a watermarked _preview, try to find the same
        # gallery item and use its original_url instead
        if media_watermarked and report.media_url:
            # Strip '_preview' suffix to find the base filename pattern
            base_pattern = report.media_url.replace('_preview', '').rsplit('.', 1)[0]
            if base_pattern:
                item_result = await db.execute(
                    select(GalleryItem).where(
                        GalleryItem.photographer_id == report.photographer_id,
                        GalleryItem.is_deleted == False,
                        GalleryItem.original_url.ilike(f"%{base_pattern.split('/')[-1]}%")
                    ).limit(1)
                )
                item = item_result.scalar_one_or_none()
                if item:
                    candidate = item.original_url or item.url_standard or item.url_web
                    if candidate and candidate.startswith('https://'):
                        valid_url = candidate
        
        # Strategy 2: Find gallery linked by live_session_id
        if not valid_url and report.live_session_id:
            # Try to find gallery items from the linked session
            item_result = await db.execute(
                select(GalleryItem).join(Gallery).where(
                    Gallery.live_session_id == report.live_session_id,
                    GalleryItem.photographer_id == report.photographer_id,
                    GalleryItem.is_deleted == False
                ).order_by(GalleryItem.created_at.desc()).limit(1)
            )
            item = item_result.scalar_one_or_none()
            if item:
                candidate = item.original_url or item.url_standard or item.url_web
                if candidate and candidate.startswith('https://'):
                    valid_url = candidate
            
            # Fall back to gallery cover
            if not valid_url:
                gallery_result = await db.execute(
                    select(Gallery).where(
                        Gallery.live_session_id == report.live_session_id,
                        Gallery.photographer_id == report.photographer_id
                    ).limit(1)
                )
                gallery = gallery_result.scalar_one_or_none()
                if gallery and gallery.cover_image_url and gallery.cover_image_url.startswith('https://'):
                    # Only use cover if it's not watermarked
                    if not _is_watermarked_url(gallery.cover_image_url):
                        valid_url = gallery.cover_image_url
        
        # Strategy 3: Find gallery items by photographer+spot
        if not valid_url and report.spot_id:
            item_result = await db.execute(
                select(GalleryItem).join(Gallery).where(
                    Gallery.surf_spot_id == report.spot_id,
                    GalleryItem.photographer_id == report.photographer_id,
                    GalleryItem.is_deleted == False
                ).order_by(GalleryItem.created_at.desc()).limit(1)
            )
            item = item_result.scalar_one_or_none()
            if item:
                candidate = item.original_url or item.url_standard or item.url_web
                if candidate and candidate.startswith('https://'):
                    valid_url = candidate
        
        # Strategy 4: Find any recent gallery item from this photographer
        if not valid_url:
            item_result = await db.execute(
                select(GalleryItem).where(
                    GalleryItem.photographer_id == report.photographer_id,
                    GalleryItem.is_deleted == False
                ).order_by(GalleryItem.created_at.desc()).limit(1)
            )
            item = item_result.scalar_one_or_none()
            if item:
                candidate = item.original_url or item.url_standard or item.url_web
                if candidate and candidate.startswith('https://'):
                    valid_url = candidate
        
        # Apply the healed URL
        if valid_url:
            if media_broken or media_watermarked:
                report.media_url = valid_url
                healed = True
            if thumb_broken or thumb_watermarked:
                report.thumbnail_url = valid_url
                healed = True
            
            if healed:
                cr_logger.info(
                    f"Auto-healed condition report {report.id}: "
                    f"resolved {'watermarked' if (media_watermarked or thumb_watermarked) else 'broken'} "
                    f"URLs to {valid_url[:60]}..."
                )
        
        return healed
    except Exception as e:
        cr_logger.warning(f"Auto-heal failed for report {report.id}: {e}")
        return False

# Available regions for filtering
SURF_REGIONS = [
    "North Shore",
    "South Shore",
    "East Coast",
    "West Coast",
    "Gold Coast",
    "SoCal",
    "NorCal",
    "Baja",
    "Central America",
    "Hawaii",
    "Caribbean",
    "Europe",
    "Indonesia",
    "Australia",
    "Japan",
    "Other"
]


class ConditionReportCreate(BaseModel):
    media_url: str
    media_type: str = 'image'
    thumbnail_url: Optional[str] = None
    caption: Optional[str] = None
    spot_id: Optional[str] = None
    spot_name: Optional[str] = None
    region: Optional[str] = None
    wave_height_ft: Optional[float] = None
    conditions_label: Optional[str] = None
    wind_conditions: Optional[str] = None
    crowd_level: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None


class ConditionReportResponse(BaseModel):
    id: str
    photographer_id: str
    photographer_name: Optional[str]
    photographer_avatar: Optional[str]
    photographer_role: str
    spot_id: Optional[str]
    spot_name: Optional[str]
    region: Optional[str]
    media_url: str
    media_type: str
    thumbnail_url: Optional[str]
    caption: Optional[str]
    wave_height_ft: Optional[float]
    conditions_label: Optional[str]
    wind_conditions: Optional[str]
    crowd_level: Optional[str]
    view_count: int
    is_active: bool
    is_photographer_live: bool = False  # True ONLY when photographer has an active live session right now
    created_at: datetime
    expires_at: datetime
    time_ago: str


def get_time_ago(created_at: datetime) -> str:
    """Convert datetime to human-readable time ago string"""
    now = datetime.now(timezone.utc)
    diff = now - created_at
    
    if diff.total_seconds() < 60:
        return "Just now"
    elif diff.total_seconds() < 3600:
        minutes = int(diff.total_seconds() / 60)
        return f"{minutes}m ago"
    elif diff.total_seconds() < 86400:
        hours = int(diff.total_seconds() / 3600)
        return f"{hours}h ago"
    else:
        days = int(diff.total_seconds() / 86400)
        return f"{days}d ago"


