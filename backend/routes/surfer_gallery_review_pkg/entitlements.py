"""
Surfer Gallery Review — Entitlements & Resolution Upsell
Handles session entitlement checks and resolution tier upgrades.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_
from sqlalchemy.orm import selectinload
import logging

from database import get_db
from models import (
    Profile, SurferGalleryItem, GalleryItem,
    Booking, LiveSession, BookingParticipant
)
from core.security import get_user_id_from_jwt_or_query

router = APIRouter(prefix="/surfer-gallery", tags=["Surfer Gallery Review"])
logger = logging.getLogger(__name__)


@router.get("/session-entitlements/{session_id}")
async def get_session_entitlements(
    session_id: str,
    user_id: str = Depends(get_user_id_from_jwt_or_query),
    db: AsyncSession = Depends(get_db)
):
    """
    Get entitlement info for a session.
    Returns: is_all_inclusive, included_media_count, claimed_count, price_per_clip
    """
    # Try to find as booking first
    booking_result = await db.execute(
        select(Booking).where(Booking.id == session_id)
    )
    booking = booking_result.scalar_one_or_none()

    if booking:
        # Check if user is a participant
        participant_result = await db.execute(
            select(BookingParticipant).where(
                and_(
                    BookingParticipant.booking_id == session_id,
                    BookingParticipant.user_id == user_id
                )
            )
        )
        _ = participant_result.scalar_one_or_none()

        # Calculate entitlements from booking
        included_count = booking.booking_photos_included or 0
        is_all_inclusive = booking.booking_full_gallery or False
        price_per_clip = booking.booking_price_standard or 5.0

        # Count already claimed items
        claimed_result = await db.execute(
            select(func.count()).select_from(SurferGalleryItem).where(
                and_(
                    SurferGalleryItem.surfer_id == user_id,
                    SurferGalleryItem.booking_id == session_id,
                    SurferGalleryItem.access_type.in_(['included', 'purchased', 'claimed'])
                )
            )
        )
        claimed_count = claimed_result.scalar() or 0

        return {
            "session_id": session_id,
            "session_type": "booking",
            "is_all_inclusive": is_all_inclusive,
            "included_media_count": included_count,
            "claimed_count": claimed_count,
            "credits_remaining": max(0, included_count - claimed_count),
            "price_per_clip": price_per_clip,
            "resolution_tier": "pro" if booking.booking_type == "scheduled" else "standard"
        }

    # Try as live session
    session_result = await db.execute(
        select(LiveSession).where(LiveSession.id == session_id)
    )
    live_session = session_result.scalar_one_or_none()

    if live_session:
        # Get photographer's pricing
        photographer_result = await db.execute(
            select(Profile).where(Profile.id == live_session.broadcaster_id)
        )
        photographer = photographer_result.scalar_one_or_none()

        included_count = photographer.photo_package_size if photographer else 0
        price_per_clip = photographer.live_photo_price if photographer else 5.0

        # Count claimed
        claimed_result = await db.execute(
            select(func.count()).select_from(SurferGalleryItem).where(
                and_(
                    SurferGalleryItem.surfer_id == user_id,
                    SurferGalleryItem.live_session_id == session_id,
                    SurferGalleryItem.access_type.in_(['included', 'purchased', 'claimed'])
                )
            )
        )
        claimed_count = claimed_result.scalar() or 0

        return {
            "session_id": session_id,
            "session_type": "live",
            "is_all_inclusive": False,
            "included_media_count": included_count,
            "claimed_count": claimed_count,
            "credits_remaining": max(0, included_count - claimed_count),
            "price_per_clip": price_per_clip,
            "resolution_tier": "standard"
        }

    # Default response
    return {
        "session_id": session_id,
        "session_type": "unknown",
        "is_all_inclusive": False,
        "included_media_count": 0,
        "claimed_count": 0,
        "credits_remaining": 0,
        "price_per_clip": 5.0,
        "resolution_tier": "standard"
    }


@router.get("/resolution-upsell/{gallery_item_id}")
async def get_resolution_upsell(
    gallery_item_id: str,
    user_id: str = Depends(get_user_id_from_jwt_or_query),
    db: AsyncSession = Depends(get_db)
):
    """
    Get upsell pricing to upgrade from Social (1080p) to RAW resolution.
    Only available for Standard tier users with Pro-tier content.
    """
    result = await db.execute(
        select(SurferGalleryItem)
        .options(selectinload(SurferGalleryItem.gallery_item))
        .where(
            and_(
                SurferGalleryItem.gallery_item_id == gallery_item_id,
                SurferGalleryItem.surfer_id == user_id
            )
        )
    )
    surfer_item = result.scalar_one_or_none()

    if not surfer_item:
        raise HTTPException(status_code=404, detail="Item not found")

    gi = surfer_item.gallery_item

    if surfer_item.gallery_tier == 'pro':
        return {"upgrade_available": False, "reason": "Already at Pro tier"}

    if not gi.original_url:
        return {"upgrade_available": False, "reason": "RAW not available for this item"}

    current_price = gi.price_standard or 5.0
    raw_price = gi.price_high or 10.0
    upgrade_price = raw_price - current_price

    return {
        "upgrade_available": True,
        "current_tier": "standard",
        "target_tier": "pro",
        "current_resolution": "1080p",
        "target_resolution": "4K RAW",
        "upgrade_price": max(0, upgrade_price),
        "media_type": gi.media_type
    }


@router.post("/upgrade-resolution/{gallery_item_id}")
async def upgrade_resolution(
    gallery_item_id: str,
    user_id: str = Depends(get_user_id_from_jwt_or_query),
    db: AsyncSession = Depends(get_db)
):
    """
    Upgrade a Standard tier item to Pro tier (RAW resolution).
    Deducts upgrade price from user wallet.
    """
    upsell = await get_resolution_upsell(gallery_item_id, user_id, db)

    if not upsell.get("upgrade_available"):
        raise HTTPException(status_code=400, detail=upsell.get("reason", "Upgrade not available"))

    user_result = await db.execute(
        select(Profile).where(Profile.id == user_id)
    )
    user = user_result.scalar_one_or_none()

    if not user or user.credit_balance < upsell["upgrade_price"]:
        raise HTTPException(status_code=402, detail="Insufficient balance")

    user.credit_balance -= upsell["upgrade_price"]

    result = await db.execute(
        select(SurferGalleryItem).where(
            and_(
                SurferGalleryItem.gallery_item_id == gallery_item_id,
                SurferGalleryItem.surfer_id == user_id
            )
        )
    )
    surfer_item = result.scalar_one_or_none()

    if surfer_item:
        surfer_item.gallery_tier = 'pro'
        surfer_item.max_photo_quality = 'high'
        surfer_item.max_video_quality = '4k'
        surfer_item.paid_amount = (surfer_item.paid_amount or 0) + upsell["upgrade_price"]

    await db.commit()

    return {
        "success": True,
        "new_tier": "pro",
        "new_resolution": "4K RAW",
        "amount_charged": upsell["upgrade_price"]
    }
