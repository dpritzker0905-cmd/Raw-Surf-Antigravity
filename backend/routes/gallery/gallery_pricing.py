"""
Gallery Pricing — pricing tier calculation and custom price overrides.

Extracted from gallery_purchases.py (v101) to keep each module under 800 LOC.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import Optional
import logging

gallery_logger = logging.getLogger("routes.gallery")

from database import get_db
from models import (
    Profile, GalleryItem, GalleryPurchase,
    Gallery, LiveSession, LiveSessionParticipant,
)

from .schemas import get_quality_price

router = APIRouter()


@router.get("/gallery/item/{item_id}/pricing")
async def get_gallery_item_pricing(
    item_id: str,
    viewer_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """Get pricing tiers for a gallery item (SmugMug-style) with Live Session Override

    PRICING PRIORITY (Contextual Pricing Matrix):
    1. If item has locked_price_* values -> Use those (set at upload time)
    2. If viewer has locked_price_* from session join -> Use participant's locked prices
    3. If session participant -> Use session's current prices (session_price_*)
    4. Default -> Use photographer's general gallery prices

    This ensures On-Demand rates persist even if photographer changes settings later.
    """
    result = await db.execute(
        select(GalleryItem)
        .where(GalleryItem.id == item_id)
        .options(selectinload(GalleryItem.photographer))
        .options(selectinload(GalleryItem.gallery))
    )
    item = result.scalar_one_or_none()

    if not item:
        raise HTTPException(status_code=404, detail="Gallery item not found")

    photographer = item.photographer

    # ============ CONTEXTUAL PRICING LOOKUP ============
    session_price_override = None
    is_session_participant = False
    session_photos_included = 0
    photos_already_claimed = 0
    participant_locked_prices = None

    if viewer_id and item.gallery_id:
        gallery = item.gallery
        if gallery and gallery.live_session_id:
            participant_result = await db.execute(
                select(LiveSessionParticipant)
                .where(LiveSessionParticipant.live_session_id == gallery.live_session_id)
                .where(LiveSessionParticipant.surfer_id == viewer_id)
                .where(LiveSessionParticipant.status.in_(['active', 'completed']))
            )
            participant = participant_result.scalar_one_or_none()

            if participant:
                is_session_participant = True

                if participant.locked_price_web or participant.locked_price_standard or participant.locked_price_high:
                    participant_locked_prices = {
                        'web': participant.locked_price_web,
                        'standard': participant.locked_price_standard,
                        'high': participant.locked_price_high
                    }

                session_result = await db.execute(
                    select(LiveSession)
                    .where(LiveSession.id == gallery.live_session_id)
                )
                session = session_result.scalar_one_or_none()

                if session:
                    if not participant_locked_prices:
                        session_price_override = session.session_photo_price or session.photo_price
                    session_photos_included = session.photos_included or 0

                    claimed_result = await db.execute(
                        select(func.count(GalleryPurchase.id))
                        .join(GalleryItem, GalleryPurchase.gallery_item_id == GalleryItem.id)
                        .where(GalleryItem.gallery_id == gallery.id)
                        .where(GalleryPurchase.buyer_id == viewer_id)
                    )
                    photos_already_claimed = claimed_result.scalar() or 0

    # Check what viewer has already purchased
    purchased_tiers = set()
    if viewer_id:
        purchases_result = await db.execute(
            select(GalleryPurchase.quality_tier)
            .where(GalleryPurchase.gallery_item_id == item_id)
            .where(GalleryPurchase.buyer_id == viewer_id)
        )
        purchased_tiers = set(row[0] for row in purchases_result.fetchall())

    pricing = {}
    is_free_from_session = is_session_participant and photos_already_claimed < session_photos_included

    if item.media_type == 'video':
        pricing = {
            "type": "video",
            "tiers": [
                {
                    "tier": "720p", "label": "HD (720p)",
                    "price": item.price_720p or (photographer.video_price_720p if photographer else 8.0) or 8.0,
                    "is_purchased": "720p" in purchased_tiers
                },
                {
                    "tier": "1080p", "label": "Full HD (1080p)",
                    "price": item.price_1080p or (photographer.video_price_1080p if photographer else 15.0) or 15.0,
                    "is_purchased": "1080p" in purchased_tiers
                },
                {
                    "tier": "4k", "label": "Ultra HD (4K)",
                    "price": item.price_4k or (photographer.video_price_4k if photographer else 30.0) or 30.0,
                    "is_purchased": "4k" in purchased_tiers
                }
            ]
        }
    else:
        gallery_obj = item.gallery if item.gallery_id else None

        if gallery_obj and (gallery_obj.price_web or gallery_obj.price_standard or gallery_obj.price_high):
            general_price_web = item.price_web or gallery_obj.price_web or (photographer.photo_price_web if photographer else 3.0) or 3.0
            general_price_standard = item.price_standard or gallery_obj.price_standard or (photographer.photo_price_standard if photographer else 5.0) or 5.0
            general_price_high = item.price_high or gallery_obj.price_high or (photographer.photo_price_high if photographer else 10.0) or 10.0
        else:
            general_price_web = item.price_web or (photographer.photo_price_web if photographer else 3.0) or 3.0
            general_price_standard = item.price_standard or (photographer.photo_price_standard if photographer else 5.0) or 5.0
            general_price_high = item.price_high or (photographer.photo_price_high if photographer else 10.0) or 10.0

        if is_free_from_session:
            final_price_web = final_price_standard = final_price_high = 0.0
            price_source = 'free_from_buyin'
        elif item.locked_price_web or item.locked_price_standard or item.locked_price_high:
            final_price_web = item.locked_price_web or general_price_web
            final_price_standard = item.locked_price_standard or general_price_standard
            final_price_high = item.locked_price_high or general_price_high
            price_source = 'item_locked'
        elif participant_locked_prices:
            final_price_web = participant_locked_prices.get('web') or general_price_web
            final_price_standard = participant_locked_prices.get('standard') or general_price_standard
            final_price_high = participant_locked_prices.get('high') or general_price_high
            price_source = 'participant_locked'
        elif session_price_override is not None:
            final_price_web = final_price_standard = final_price_high = session_price_override
            price_source = 'session_override'
        else:
            final_price_web = general_price_web
            final_price_standard = general_price_standard
            final_price_high = general_price_high
            price_source = 'general'

        pricing = {
            "type": "photo",
            "tiers": [
                {
                    "tier": "web", "label": "Web Quality (800px)",
                    "price": final_price_web, "general_price": general_price_web,
                    "is_purchased": "web" in purchased_tiers,
                    "is_session_deal": is_session_participant and price_source != 'general',
                    "price_source": price_source
                },
                {
                    "tier": "standard", "label": "Standard (1920px)",
                    "price": final_price_standard, "general_price": general_price_standard,
                    "is_purchased": "standard" in purchased_tiers,
                    "is_session_deal": is_session_participant and price_source != 'general',
                    "price_source": price_source
                },
                {
                    "tier": "high", "label": "High Resolution (Original)",
                    "price": final_price_high, "general_price": general_price_high,
                    "is_purchased": "high" in purchased_tiers,
                    "is_session_deal": is_session_participant and price_source != 'general',
                    "price_source": price_source
                }
            ]
        }

    # Subscription quota check (pre-purchase hint for frontend)
    subscription_info = {
        "has_quota": False, "remaining": 0, "subscription_active": False,
        "booking_discount_pct": 0, "on_demand_discount_pct": 0,
    }
    if viewer_id and item.photographer_id:
        from routes.photo_subscriptions import check_quota_inline
        quota_type = 'video' if item.media_type == 'video' else 'photo'
        subscription_info = await check_quota_inline(
            db, viewer_id, item.photographer_id, quota_type
        )

    return {
        "item_id": item_id,
        "media_type": item.media_type,
        "pricing": pricing,
        "preview_url": item.preview_url,
        "is_session_participant": is_session_participant,
        "session_photos_included": session_photos_included,
        "photos_already_claimed": photos_already_claimed,
        "is_free_from_session": is_free_from_session,
        "session_price_override": session_price_override,
        "session_origin_mode": item.session_origin_mode,
        "has_locked_pricing": bool(participant_locked_prices or item.locked_price_web or item.locked_price_standard),
        "subscription": subscription_info,
    }


# ============================================================
# CUSTOM PRICE OVERRIDE (moved from items.py v86)
# ============================================================

class SetCustomPriceRequest(BaseModel):
    custom_price: Optional[float] = None

@router.patch("/gallery/item/{item_id}/custom-price")
async def set_item_custom_price(
    item_id: str,
    photographer_id: str,
    data: SetCustomPriceRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Quick-set custom price for a gallery item (used in thumbnail quick-edit).
    Pass custom_price=0 or null to clear the override and revert to general pricing.
    """
    from models import Profile as ProfileModel
    result = await db.execute(select(GalleryItem).where(GalleryItem.id == item_id))
    item = result.scalar_one_or_none()

    if not item:
        raise HTTPException(status_code=404, detail="Gallery item not found")

    if item.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized")

    if data.custom_price is None or data.custom_price <= 0:
        item.custom_price = None
    else:
        item.custom_price = data.custom_price

    await db.commit()

    result = await db.execute(select(ProfileModel).where(ProfileModel.id == photographer_id))
    photographer = result.scalar_one_or_none()

    base_price = photographer.photo_price_standard if item.media_type == 'image' else photographer.video_price_1080p

    return {
        "message": "Custom price updated",
        "item_id": item_id,
        "custom_price": item.custom_price,
        "base_price": base_price,
        "display_price": item.custom_price if item.custom_price else base_price,
        "has_override": item.custom_price is not None
    }
