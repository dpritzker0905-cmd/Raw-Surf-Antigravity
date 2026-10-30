"""
Gallery Pricing — pricing tier calculation and custom price overrides.

Extracted from gallery_purchases.py (v101) to keep each module under 800 LOC.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import Optional
import logging

gallery_logger = logging.getLogger("routes.gallery")

from database import get_db
from core.security import get_optional_user_id
from .ownership import verified_viewer
from models import GalleryItem, GalleryPurchase

from .pricing_resolver import resolve_item_pricing

router = APIRouter()


@router.get("/gallery/item/{item_id}/pricing")
async def get_gallery_item_pricing(
    item_id: str,
    viewer_id: Optional[str] = None,
    token_user_id: Optional[str] = Depends(get_optional_user_id),
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
    viewer_id = verified_viewer(viewer_id, token_user_id)  # a query claim alone is anonymous
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

    # Check what viewer has already purchased
    purchased_tiers = set()
    if viewer_id:
        purchases_result = await db.execute(
            select(GalleryPurchase.quality_tier)
            .where(GalleryPurchase.gallery_item_id == item_id)
            .where(GalleryPurchase.buyer_id == viewer_id)
        )
        purchased_tiers = set(row[0] for row in purchases_result.fetchall())

    resolved = await resolve_item_pricing(item, photographer, db, viewer_id, purchased_tiers)

    # Subscription quota check (pre-purchase hint for frontend)
    subscription_info = {
        "has_quota": False, "remaining": 0, "subscription_active": False,
        "booking_discount_pct": 0, "on_demand_discount_pct": 0,
    }
    if viewer_id and item.photographer_id:
        from routes.subscriptions_billing.photo_sub_helpers import check_quota_inline
        quota_type = 'video' if item.media_type == 'video' else 'photo'
        subscription_info = await check_quota_inline(
            db, viewer_id, item.photographer_id, quota_type
        )

    return {
        "item_id": item_id,
        "media_type": item.media_type,
        **resolved,
        "preview_url": item.preview_url,
        "session_origin_mode": item.session_origin_mode,
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
