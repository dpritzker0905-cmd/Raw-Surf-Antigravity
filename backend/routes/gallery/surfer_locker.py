"""
Surfer locker — toggle public, public gallery, recent sessions.

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

# ============ SURFER LOCKER → PUBLIC SESSIONS TAB ============

class TogglePublicRequest(BaseModel):
    is_public: bool


@router.post("/surfer/locker/{item_id}/toggle-public")
async def toggle_surfer_item_public(
    item_id: str,
    surfer_id: str,
    data: TogglePublicRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Toggle a surfer's locker item between private and public.
    Public items appear on the surfer's Sessions tab in their profile.
    Only paid/included items can be made public (no watermarked previews).
    """
    result = await db.execute(
        select(SurferGalleryItem).where(
            SurferGalleryItem.id == item_id,
            SurferGalleryItem.surfer_id == surfer_id
        )
    )
    sgi = result.scalar_one_or_none()
    if not sgi:
        raise HTTPException(status_code=404, detail="Locker item not found")
    
    # Only allow publishing of paid/included items
    if data.is_public and sgi.access_type not in ('included', 'purchased', 'gifted'):
        raise HTTPException(
            status_code=400,
            detail="Only paid or included items can be made public. Purchase this item first."
        )
    
    sgi.is_public = data.is_public
    sgi.visibility_changed_at = datetime.now(timezone.utc)
    
    await db.commit()
    
    action = "published to Sessions" if data.is_public else "moved to private"
    return {
        "message": f"Item {action}",
        "item_id": item_id,
        "is_public": sgi.is_public
    }


@router.get("/surfer/{surfer_id}/public-gallery")
async def get_surfer_public_gallery(
    surfer_id: str,
    limit: int = 30,
    offset: int = 0,
    db: AsyncSession = Depends(get_db)
):
    """
    Get a surfer's public gallery items (for their Sessions tab).
    These are locker items that the surfer has toggled to public.
    """
    result = await db.execute(
        select(SurferGalleryItem)
        .where(
            SurferGalleryItem.surfer_id == surfer_id,
            SurferGalleryItem.is_public == True
        )
        .options(selectinload(SurferGalleryItem.gallery_item))
        .order_by(SurferGalleryItem.session_date.desc().nullslast(), SurferGalleryItem.added_at.desc())
        .offset(offset)
        .limit(limit)
    )
    items = result.scalars().all()
    
    public_items = []
    for sgi in items:
        gi = sgi.gallery_item
        if not gi or gi.is_deleted:
            # Use preserved URLs if original was soft-deleted
            public_items.append({
                "id": sgi.id,
                "gallery_item_id": sgi.gallery_item_id,
                "preview_url": sgi.preserved_preview_url,
                "thumbnail_url": sgi.preserved_thumbnail_url,
                "media_type": sgi.preserved_media_type or "image",
                "spot_name": sgi.spot_name,
                "session_date": sgi.session_date.isoformat() if sgi.session_date else None,
                "photographer_id": sgi.photographer_id,
                "is_favorite": sgi.is_favorite,
            })
        else:
            public_items.append({
                "id": sgi.id,
                "gallery_item_id": gi.id,
                "preview_url": gi.preview_url,
                "thumbnail_url": gi.thumbnail_url,
                "original_url": gi.original_url if sgi.is_paid else None,
                "media_type": gi.media_type,
                "spot_name": sgi.spot_name,
                "session_date": sgi.session_date.isoformat() if sgi.session_date else None,
                "photographer_id": sgi.photographer_id,
                "is_favorite": sgi.is_favorite,
            })
    
    return {
        "surfer_id": surfer_id,
        "public_items": public_items,
        "total": len(public_items)
    }

@router.get("/photographer/{photographer_id}/recent-sessions")
async def get_photographer_recent_sessions(
    photographer_id: str,
    limit: int = 10,
    db: AsyncSession = Depends(get_db)
):
    """
    Get recent linkable sessions for a photographer.
    Returns live sessions, bookings, and dispatch requests
    so any gallery can be manually linked to any past session type.
    """
    session_list = []
    
    # ── 1. Live Sessions ──
    result = await db.execute(
        select(LiveSession)
        .where(LiveSession.photographer_id == photographer_id)
        .order_by(LiveSession.started_at.desc())
        .limit(limit)
    )
    for s in result.scalars().all():
        gallery_result = await db.execute(
            select(Gallery.id).where(Gallery.live_session_id == s.id)
        )
        linked_gallery = gallery_result.scalar_one_or_none()
        
        part_count_result = await db.execute(
            select(func.count(LiveSessionParticipant.id))
            .where(LiveSessionParticipant.live_session_id == s.id)
        )
        part_count = part_count_result.scalar() or 0
        
        session_list.append({
            "id": s.id,
            "session_type": "live",
            "link_key": "live_session_id",
            "location_name": s.location_name or "Live Session",
            "started_at": s.started_at.isoformat() if s.started_at else None,
            "ended_at": s.ended_at.isoformat() if s.ended_at else None,
            "status": s.status,
            "participant_count": part_count,
            "total_earnings": s.total_earnings or 0,
            "linked_gallery_id": linked_gallery,
            "is_available": linked_gallery is None
        })
    
    # ── 2. Bookings ──
    try:
        bk_result = await db.execute(
            select(Booking)
            .where(Booking.photographer_id == photographer_id)
            .order_by(Booking.session_date.desc())
            .limit(limit)
        )
        for bk in bk_result.scalars().all():
            gallery_result = await db.execute(
                select(Gallery.id).where(Gallery.booking_id == bk.id)
            )
            linked_gallery = gallery_result.scalar_one_or_none()
            
            # Count participants
            bp_count_result = await db.execute(
                select(func.count(BookingParticipant.id))
                .where(BookingParticipant.booking_id == bk.id)
            )
            bp_count = bp_count_result.scalar() or 0
            
            session_list.append({
                "id": bk.id,
                "session_type": "booking",
                "link_key": "booking_id",
                "location_name": bk.location or "Scheduled Booking",
                "started_at": bk.session_date.isoformat() if bk.session_date else (bk.created_at.isoformat() if bk.created_at else None),
                "ended_at": None,
                "status": bk.status or "completed",
                "participant_count": bp_count,
                "total_earnings": bk.total_price or 0,
                "linked_gallery_id": linked_gallery,
                "is_available": linked_gallery is None
            })
    except Exception as e:
        gallery_logger.warning(f"Could not load bookings for recent-sessions: {e}")
    
    # ── 3. Dispatch (On-Demand) Requests ──
    try:
        dp_result = await db.execute(
            select(DispatchRequest)
            .where(DispatchRequest.photographer_id == photographer_id)
            .order_by(DispatchRequest.created_at.desc())
            .limit(limit)
        )
        for dp in dp_result.scalars().all():
            gallery_result = await db.execute(
                select(Gallery.id).where(Gallery.dispatch_id == dp.id)
            )
            linked_gallery = gallery_result.scalar_one_or_none()
            
            session_list.append({
                "id": dp.id,
                "session_type": "on_demand",
                "link_key": "dispatch_id",
                "location_name": dp.location_name or "On-Demand Request",
                "started_at": dp.created_at.isoformat() if dp.created_at else None,
                "ended_at": None,
                "status": (dp.status.value if hasattr(dp.status, 'value') else str(dp.status)) if dp.status else "completed",
                "participant_count": 1,
                "total_earnings": dp.deposit_amount or 0,
                "linked_gallery_id": linked_gallery,
                "is_available": linked_gallery is None
            })
    except Exception as e:
        gallery_logger.warning(f"Could not load dispatch requests for recent-sessions: {e}")
    
    # Sort all by most recent first
    session_list.sort(key=lambda x: x.get("started_at") or "", reverse=True)
    
    return session_list[:limit * 2]  # Return up to 2x limit since we merged 3 sources

