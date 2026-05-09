"""
Gallery Sync Service
Handles automatic gallery creation and pricing sync for all session types:
- Live Sessions
- On-Demand (Dispatch)
- Regular Bookings
"""

from datetime import datetime, timezone, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from models import (
    Gallery, GalleryItem, Profile, SurfSpot, Booking, DispatchRequest,
    LiveSession, SurferSelectionQuota, SurferGalleryItem, GalleryTierEnum,
    ConditionReport, LiveSessionParticipant, BookingParticipant,
    Notification, SurferGalleryClaimQueue, Surfboard
)
import json as _json
import logging

logger = logging.getLogger(__name__)


async def create_session_gallery(
    db: AsyncSession,
    photographer_id: str,
    session_type: str,  # 'live', 'on_demand', 'booking'
    spot_id: str = None,
    spot_name: str = None,
    booking_id: str = None,
    dispatch_id: str = None,
    live_session_id: str = None,
    session_start: datetime = None,
    participant_ids: list = None,
    cover_image_url: str = None  # Optional cover image (from condition report)
) -> dict:
    """
    Create a gallery for a completed session with proper pricing based on session type.
    
    Pricing logic:
    - Live Session: Uses photographer's live_photo_price and session prices
    - On-Demand: Uses photographer's on_demand_photo_price (premium pricing)
    - Booking: Uses booking-specific prices or photographer's booking prices
    """
    
    # Get photographer with pricing info
    photographer_result = await db.execute(
        select(Profile).where(Profile.id == photographer_id)
    )
    photographer = photographer_result.scalar_one_or_none()
    
    if not photographer:
        logger.error(f"Photographer {photographer_id} not found")
        return {"error": "Photographer not found"}
    
    # Get spot info
    if spot_id and not spot_name:
        spot_result = await db.execute(
            select(SurfSpot).where(SurfSpot.id == spot_id)
        )
        spot = spot_result.scalar_one_or_none()
        spot_name = spot.name if spot else "Unknown Location"
    
    # For live sessions, try to get cover image from condition report if not provided
    if session_type == 'live' and live_session_id and not cover_image_url:
        try:
            condition_result = await db.execute(
                select(ConditionReport).where(
                    ConditionReport.live_session_id == live_session_id,
                    ConditionReport.media_url != "",
                    ConditionReport.media_url.isnot(None)
                ).order_by(ConditionReport.created_at.desc()).limit(1)
            )
            condition_report = condition_result.scalar_one_or_none()
            if condition_report and condition_report.media_url:
                cover_image_url = condition_report.media_url
                logger.info(f"Using condition report media as gallery cover: {cover_image_url}")
        except Exception as e:
            logger.warning(f"Could not fetch condition report for gallery cover: {e}")
    
    # Determine gallery title and pricing based on session type
    # Title format: Date · Time · Location (session type lives as a badge on the folder card)
    # This ordering ensures mobile pill buttons show the date/time first
    now = datetime.now(timezone.utc)
    ts = session_start or now
    try:
        # Linux/macOS: %-I removes leading zero from hour
        date_part = ts.strftime("%b %d, %Y")
        time_part = ts.strftime("%-I:%M %p")
    except ValueError:
        # Windows: %#I removes leading zero
        date_part = ts.strftime("%b %d, %Y")
        time_part = ts.strftime("%#I:%M %p")
    
    if session_type == 'live':
        title = f"{date_part} · {time_part} · {spot_name}"
        description = f"Photos from live surf session at {spot_name}"
        price_web = photographer.live_session_photo_price or photographer.photo_price_web or 3.0
        price_standard = photographer.live_session_photo_price or photographer.photo_price_standard or 5.0
        price_high = photographer.live_session_photo_price or photographer.photo_price_high or 10.0
        gallery_tier = GalleryTierEnum.STANDARD
        
    elif session_type == 'on_demand':
        title = f"{date_part} · {time_part} · {spot_name}"
        description = "Exclusive photos from your private on-demand session"
        # Use independent on-demand resolution pricing (Profile fields added in Iteration 135+)
        # Falls back to legacy on_demand_photo_price, then to general gallery pricing
        price_web = photographer.on_demand_price_web or photographer.on_demand_photo_price or photographer.photo_price_web or 5.0
        price_standard = photographer.on_demand_price_standard or photographer.on_demand_photo_price or photographer.photo_price_standard or 10.0
        price_high = photographer.on_demand_price_high or photographer.on_demand_photo_price or photographer.photo_price_high or 18.0
        gallery_tier = GalleryTierEnum.PRO
        
    elif session_type == 'booking':
        # Try to get booking-specific pricing
        booking = None
        if booking_id:
            booking_result = await db.execute(
                select(Booking).where(Booking.id == booking_id)
            )
            booking = booking_result.scalar_one_or_none()
        
        title = f"{date_part} · {time_part} · {spot_name}"
        description = "Photos from your scheduled surf session"
        
        if booking:
            price_web = booking.booking_price_web or photographer.booking_price_web or 3.0
            price_standard = booking.booking_price_standard or photographer.booking_price_standard or 5.0
            price_high = booking.booking_price_high or photographer.booking_price_high or 10.0
        else:
            price_web = photographer.booking_price_web or photographer.photo_price_web or 3.0
            price_standard = photographer.booking_price_standard or photographer.photo_price_standard or 5.0
            price_high = photographer.booking_price_high or photographer.photo_price_high or 10.0
        
        gallery_tier = GalleryTierEnum.PRO
        
    else:
        # Manual/general gallery - use general pricing
        title = f"{date_part} · {time_part} · {spot_name}" if spot_name else f"{date_part} · {time_part}"
        description = "Surf photography gallery"
        price_web = photographer.photo_price_web or 3.0
        price_standard = photographer.photo_price_standard or 5.0
        price_high = photographer.photo_price_high or 10.0
        gallery_tier = GalleryTierEnum.STANDARD
    
    # Create the gallery with photographer's watermark preference
    show_watermark = photographer.default_watermark_in_selection if photographer.default_watermark_in_selection is not None else True
    
    # Get GENERAL/PUBLIC pricing (for non-participants browsing the gallery)
    # These are the photographer's standard prices for anyone who didn't participate
    general_price_web = photographer.photo_price_web or 3.0
    general_price_standard = photographer.photo_price_standard or 5.0
    general_price_high = photographer.photo_price_high or 10.0
    
    gallery = Gallery(
        photographer_id=photographer_id,
        title=title,
        description=description,
        surf_spot_id=spot_id,
        is_public=True,
        is_for_sale=True,
        default_tier=gallery_tier,
        # Cover image (from condition report or first photo)
        cover_image_url=cover_image_url,
        # GENERAL/PUBLIC pricing (for non-participants)
        price_web=general_price_web,
        price_standard=general_price_standard,
        price_high=general_price_high,
        # PARTICIPANT pricing (locked at session time for participants who paid)
        locked_price_web=price_web,
        locked_price_standard=price_standard,
        locked_price_high=price_high,
        # Session reference
        session_type=session_type,
        booking_id=booking_id if session_type == 'booking' else None,
        dispatch_id=dispatch_id if session_type == 'on_demand' else None,
        live_session_id=live_session_id if session_type == 'live' else None,
        # Watermark setting (inherited from photographer's global setting)
        show_watermark_in_selection=show_watermark,
        # Timestamps
        session_date=session_start or now
    )
    
    db.add(gallery)
    await db.flush()
    
    logger.info(f"Created {session_type} gallery '{title}' (ID: {gallery.id})")
    logger.info(f"  - Participant pricing: web=${price_web}, standard=${price_standard}, high=${price_high}")
    logger.info(f"  - General/Public pricing: web=${general_price_web}, standard=${general_price_standard}, high=${general_price_high}")
    
    # If participants provided, create selection quotas for them
    if participant_ids:
        for surfer_id in participant_ids:
            await create_surfer_selection_quota(
                db=db,
                gallery_id=gallery.id,
                surfer_id=surfer_id,
                session_type=session_type,
                photographer_id=photographer_id,
                booking_id=booking_id,
                dispatch_id=dispatch_id,
                live_session_id=live_session_id
            )
    
    await db.commit()
    
    return {
        "gallery_id": gallery.id,
        "title": title,
        "pricing": {
            "web": price_web,
            "standard": price_standard,
            "high": price_high
        },
        "tier": gallery_tier.value,
        "participants_added": len(participant_ids) if participant_ids else 0
    }


async def create_surfer_selection_quota(
    db: AsyncSession,
    gallery_id: str,
    surfer_id: str,
    session_type: str,
    photographer_id: str = None,  # Required - photographer who owns this gallery
    booking_id: str = None,
    dispatch_id: str = None,
    live_session_id: str = None,
    photos_allowed: int = None
):
    """
    Create a selection quota for a surfer in a gallery.
    
    Default photo allowances:
    - Live Session: 3 photos
    - On-Demand: 10 photos
    - Booking: Based on booking.photos_included or 5
    """
    
    # Get photographer_id from gallery if not provided
    if not photographer_id:
        gallery_result = await db.execute(
            select(Gallery).where(Gallery.id == gallery_id)
        )
        gallery = gallery_result.scalar_one_or_none()
        if gallery:
            photographer_id = gallery.photographer_id
    
    if not photographer_id:
        logger.error(f"Cannot create selection quota: photographer_id is required")
        return
    
    videos_allowed = 0  # Default: no videos included
    
    if photos_allowed is None:
        if session_type == 'live':
            photos_allowed = 3  # Default fallback
            # Read actual values from the LiveSession record
            if live_session_id:
                from models import LiveSession as LSModel
                ls_result = await db.execute(
                    select(LSModel).where(LSModel.id == live_session_id)
                )
                ls = ls_result.scalar_one_or_none()
                if ls:
                    photos_allowed = ls.photos_included or 3
                    videos_allowed = ls.videos_included or 0
        elif session_type == 'on_demand':
            photos_allowed = 10
            # Try to get from dispatch if available
            if dispatch_id:
                dispatch_result = await db.execute(
                    select(DispatchRequest).where(DispatchRequest.id == dispatch_id)
                )
                dispatch = dispatch_result.scalar_one_or_none()
                if dispatch:
                    # Could read from dispatch package in future
                    photos_allowed = 10
        elif session_type == 'booking':
            photos_allowed = 5
            if booking_id:
                booking_result = await db.execute(
                    select(Booking).where(Booking.id == booking_id)
                )
                booking = booking_result.scalar_one_or_none()
                if booking and booking.booking_photos_included:
                    photos_allowed = booking.booking_photos_included
        else:
            photos_allowed = 3
    
    # Selection deadline: 10 days from now (industry standard 7-14 days)
    selection_deadline = datetime.now(timezone.utc) + timedelta(days=10)
    
    quota = SurferSelectionQuota(
        gallery_id=gallery_id,
        surfer_id=surfer_id,
        photographer_id=photographer_id,  # Required field
        live_session_id=live_session_id,
        booking_id=booking_id,
        photos_allowed=photos_allowed,
        photos_selected=0,
        videos_allowed=videos_allowed,
        videos_selected=0,
        status='pending_selection',
        selection_deadline=selection_deadline,
        # Auto-selection preference (default: ask user)
        auto_select_on_expiry=None  # None = ask user, True = auto-select, False = forfeit
    )
    
    db.add(quota)
    logger.info(f"Created selection quota for surfer {surfer_id}: {photos_allowed} photos + {videos_allowed} videos, deadline {selection_deadline}")


async def check_gallery_exists_for_session(
    db: AsyncSession,
    booking_id: str = None,
    dispatch_id: str = None,
    live_session_id: str = None
) -> bool:
    """Check if a gallery already exists for a given session."""
    
    if booking_id:
        result = await db.execute(
            select(Gallery).where(Gallery.booking_id == booking_id)
        )
    elif dispatch_id:
        result = await db.execute(
            select(Gallery).where(Gallery.dispatch_id == dispatch_id)
        )
    elif live_session_id:
        result = await db.execute(
            select(Gallery).where(Gallery.live_session_id == live_session_id)
        )
    else:
        return False
    
    return result.scalar_one_or_none() is not None


# ============================================================
# DISTRIBUTION — Heavy distribution logic extracted to gallery_distribution.py (v95 audit)
# ============================================================
from .gallery_distribution import distribute_gallery_item_to_participants  # noqa: F401
from .gallery_distribution import manually_assign_item_to_surfer  # noqa: F401


async def safe_delete_gallery_item(
    db: AsyncSession,
    gallery_item_id: str,
    photographer_id: str
) -> dict:
    """
    Safely delete a gallery item, protecting paid surfer locker items.
    
    Logic:
    - If any surfer has is_paid=True or access_type in ('included', 'purchased', 'gifted'):
      → SOFT DELETE: hide from photographer, preserve URLs for surfers
    - Otherwise:
      → HARD DELETE: remove entirely
    """
    item_result = await db.execute(
        select(GalleryItem).where(
            GalleryItem.id == gallery_item_id,
            GalleryItem.photographer_id == photographer_id
        )
    )
    item = item_result.scalar_one_or_none()
    if not item:
        return {"error": "Gallery item not found or not authorized"}
    
    # Check if any surfer has paid for this item
    paid_surfers = await db.execute(
        select(SurferGalleryItem).where(
            SurferGalleryItem.gallery_item_id == gallery_item_id,
            SurferGalleryItem.access_type.in_(['included', 'purchased', 'gifted'])
        )
    )
    paid_items = paid_surfers.scalars().all()
    
    if paid_items:
        # SOFT DELETE: Preserve media URLs in each paid surfer's locker item
        for paid_item in paid_items:
            paid_item.preserved_original_url = item.original_url
            paid_item.preserved_preview_url = item.preview_url
            paid_item.preserved_thumbnail_url = item.thumbnail_url
            paid_item.preserved_media_type = item.media_type
        
        # Mark as soft-deleted (hidden from photographer's gallery)
        item.is_deleted = True
        item.deleted_at = datetime.now(timezone.utc)
        item.is_public = False
        
        # Delete unpaid surfer items (they never paid, no obligation)
        unpaid_result = await db.execute(
            select(SurferGalleryItem).where(
                SurferGalleryItem.gallery_item_id == gallery_item_id,
                SurferGalleryItem.access_type.in_(['pending', 'pending_selection'])
            )
        )
        for unpaid_item in unpaid_result.scalars().all():
            await db.delete(unpaid_item)
        
        await db.flush()
        logger.info(
            f"Soft-deleted gallery item {gallery_item_id} "
            f"(preserved for {len(paid_items)} paid surfers)"
        )
        return {
            "deleted": True, 
            "soft_delete": True, 
            "preserved_for_surfers": len(paid_items),
            "message": f"Item hidden from your gallery. {len(paid_items)} surfer(s) who paid still have access."
        }
    else:
        # HARD DELETE: No paid surfers, safe to remove entirely
        # Delete all unpaid surfer items first
        unpaid_result = await db.execute(
            select(SurferGalleryItem).where(
                SurferGalleryItem.gallery_item_id == gallery_item_id
            )
        )
        for surfer_item in unpaid_result.scalars().all():
            await db.delete(surfer_item)
        
        # Update gallery item count
        if item.gallery_id:
            gallery_result = await db.execute(
                select(Gallery).where(Gallery.id == item.gallery_id)
            )
            gallery = gallery_result.scalar_one_or_none()
            if gallery:
                gallery.item_count = max(0, (gallery.item_count or 0) - 1)
        
        await db.delete(item)
        await db.flush()
        logger.info(f"Hard-deleted gallery item {gallery_item_id} (no paid surfers)")
        return {"deleted": True, "soft_delete": False, "message": "Item permanently deleted."}


