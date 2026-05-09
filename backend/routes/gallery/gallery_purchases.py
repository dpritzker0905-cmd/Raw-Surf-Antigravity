"""
Gallery Purchases — purchase, claim, download, and watermark operations.

Extracted from items.py (v86) to keep each module under 800 LOC.
"""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone
import json
import logging

gallery_logger = logging.getLogger("routes.gallery")

from database import get_db
from models import (
    Profile, GalleryItem, GalleryPurchase, Notification,
    Gallery, XPTransaction, PhotoTag
)

from routes.career_hub.gamification import check_badge_milestones
from websocket_manager import broadcast_earnings_update
from services.watermark import generate_watermarked_preview

from .schemas import PurchaseRequest, get_quality_price

router = APIRouter()


@router.post("/gallery/item/{item_id}/purchase")
async def purchase_gallery_item(
    item_id: str,
    buyer_id: str,
    data: PurchaseRequest,
    db: AsyncSession = Depends(get_db)
):
    """Purchase a gallery item with SmugMug-style quality tiers"""
    from utils.credits import deduct_credits, add_credits
    
    # Get item with photographer
    item_result = await db.execute(
        select(GalleryItem)
        .where(GalleryItem.id == item_id)
        .options(selectinload(GalleryItem.photographer))
    )
    item = item_result.scalar_one_or_none()
    
    if not item:
        raise HTTPException(status_code=404, detail="Gallery item not found")
    
    if not item.is_for_sale:
        raise HTTPException(status_code=400, detail="This item is not for sale")
    
    photographer = item.photographer
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    # Validate quality tier
    valid_photo_tiers = ['web', 'standard', 'high']
    valid_video_tiers = ['720p', '1080p', '4k']
    
    if item.media_type == 'video' and data.quality_tier not in valid_video_tiers:
        raise HTTPException(status_code=400, detail=f"Invalid video quality tier. Choose from: {valid_video_tiers}")
    elif item.media_type != 'video' and data.quality_tier not in valid_photo_tiers:
        raise HTTPException(status_code=400, detail=f"Invalid photo quality tier. Choose from: {valid_photo_tiers}")
    
    # Check if already purchased this quality tier
    existing = await db.execute(
        select(GalleryPurchase).where(
            GalleryPurchase.gallery_item_id == item_id,
            GalleryPurchase.buyer_id == buyer_id,
            GalleryPurchase.quality_tier == data.quality_tier
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail=f"Already purchased this item at {data.quality_tier} quality")
    
    # Get buyer
    buyer_result = await db.execute(select(Profile).where(Profile.id == buyer_id))
    buyer = buyer_result.scalar_one_or_none()
    if not buyer:
        raise HTTPException(status_code=404, detail="Buyer not found")
    
    # Get price for quality tier
    price, download_url = get_quality_price(item, photographer, data.quality_tier)
    
    # Check if subscription quota covers this purchase (photo or video)
    from routes.photo_subscriptions import try_use_subscription_quota
    quota_type = 'video' if item.media_type == 'video' else 'photo'
    sub_quota_result = await try_use_subscription_quota(
        db, buyer_id, item.photographer_id, quota_type
    )
    subscription_covered = sub_quota_result.get("used", False)
    
    if subscription_covered:
        # Subscription covers this — no charge
        price = 0.0
        new_balance = buyer.credit_balance or 0
    elif data.payment_method == 'credits':
        # Process payment with credit system
        success, new_balance, error = await deduct_credits(
            user_id=buyer_id,
            amount=price,
            transaction_type='gallery_purchase',
            db=db,
            description=f"Gallery purchase: {item.title or 'Photo'} ({data.quality_tier})",
            reference_type='gallery_item',
            reference_id=item_id,
            counterparty_id=item.photographer_id
        )
        
        if not success:
            raise HTTPException(status_code=400, detail=error)
        
        # Credit photographer (80% cut)
        photographer_cut = price * 0.80
        await add_credits(
            user_id=item.photographer_id,
            amount=photographer_cut,
            transaction_type='gallery_sale',
            db=db,
            description=f"Gallery sale to {buyer.full_name} ({data.quality_tier})",
            reference_type='gallery_item',
            reference_id=item_id,
            counterparty_id=buyer_id
        )
    
    # Create purchase record
    purchase = GalleryPurchase(
        gallery_item_id=item_id,
        buyer_id=buyer_id,
        photographer_id=item.photographer_id,
        amount_paid=price,
        payment_method=data.payment_method,
        quality_tier=data.quality_tier
    )
    db.add(purchase)
    
    # Update item stats
    item.purchase_count += 1
    
    # Notify photographer
    notification = Notification(
        user_id=item.photographer_id,
        type='photo_purchased',
        title=f"{buyer.full_name} purchased your {'video' if item.media_type == 'video' else 'photo'}!",
        body=f"Quality: {data.quality_tier.upper()} \u2022 You earned ${price * 0.80:.2f} credits",
        data=json.dumps({
            "gallery_item_id": item_id,
            "buyer_id": buyer_id,
            "amount": price,
            "quality_tier": data.quality_tier,
            "type": "photo_purchased"
        })
    )
    db.add(notification)
    
    # ============ GAMIFICATION: Award XP ============
    # Buyer gets XP for purchasing (10 XP)
    buyer_xp = XPTransaction(
        user_id=buyer_id,
        amount=10,
        reason='Purchased a photo',
        reference_type='gallery_purchase',
        reference_id=item_id
    )
    db.add(buyer_xp)
    
    # Photographer gets XP for sale (20 XP)
    photographer_xp = XPTransaction(
        user_id=item.photographer_id,
        amount=20,
        reason='Photo sold',
        reference_type='gallery_purchase',
        reference_id=item_id
    )
    db.add(photographer_xp)
    
    # ============ BADGE AWARD TRIGGERS ============
    # Auto-check badges after XP is awarded
    await check_badge_milestones(buyer_id, db)
    await check_badge_milestones(item.photographer_id, db)
    
    await db.commit()
    
    # Broadcast earnings update to photographer via WebSocket
    photographer_cut = price * 0.80
    await broadcast_earnings_update(
        user_id=item.photographer_id,
        update_type='new_sale',
        amount=photographer_cut,
        details={
            "item_title": item.title or "Photo",
            "buyer_name": buyer.full_name,
            "quality_tier": data.quality_tier,
            "gross_amount": price
        }
    )
    
    return {
        "message": "Included with subscription!" if subscription_covered else "Purchase successful!",
        "success": True,
        "download_url": download_url,
        "quality_tier": data.quality_tier,
        "amount_paid": price,
        "subscription_covered": subscription_covered,
        "remaining_credits": new_balance if (subscription_covered or data.payment_method == 'credits') else buyer.credit_balance,
        "download_link": f"/api/gallery/download/{item_id}?buyer_id={buyer_id}&quality={data.quality_tier}"
    }


@router.post("/gallery/items/{item_id}/claim")
async def claim_free_photo(
    item_id: str,
    user_id: str,
    tag_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """
    Claim a photo that is free (session participant with $0 per-photo price).
    This adds it to the user's gallery without payment.
    """
    # Verify the user has access (through PhotoTag with access_granted=True or is_gift=True)
    if tag_id:
        tag_result = await db.execute(
            select(PhotoTag)
            .where(PhotoTag.id == tag_id)
            .where(PhotoTag.surfer_id == user_id)
        )
        tag = tag_result.scalar_one_or_none()
    else:
        tag_result = await db.execute(
            select(PhotoTag)
            .where(PhotoTag.gallery_item_id == item_id)
            .where(PhotoTag.surfer_id == user_id)
        )
        tag = tag_result.scalar_one_or_none()
    
    if not tag:
        raise HTTPException(status_code=404, detail="You are not tagged in this photo")
    
    # Check if eligible for free claim
    if not tag.access_granted and not tag.is_gift:
        if tag.session_photo_price is None or tag.session_photo_price > 0:
            raise HTTPException(status_code=400, detail="This photo requires purchase")
    
    # Get the item
    item_result = await db.execute(select(GalleryItem).where(GalleryItem.id == item_id))
    item = item_result.scalar_one_or_none()
    
    if not item:
        raise HTTPException(status_code=404, detail="Photo not found")
    
    # Create a "free" purchase record (amount_paid=0)
    purchase = GalleryPurchase(
        gallery_item_id=item_id,
        buyer_id=user_id,
        photographer_id=item.photographer_id,
        amount_paid=0,
        payment_method='claimed',
        quality_tier='high'  # Give full quality for claimed photos
    )
    db.add(purchase)
    
    # Update tag as claimed
    tag.claimed_at = datetime.now(timezone.utc)
    if not tag.access_granted:
        tag.access_granted = True
    
    # Update item stats
    item.purchase_count += 1
    
    await db.commit()
    
    return {
        "success": True,
        "message": "Photo added to your gallery!",
        "download_link": f"/api/gallery/download/{item_id}?buyer_id={user_id}&quality=high"
    }


@router.get("/gallery/download/{item_id}")
async def download_gallery_item(
    item_id: str,
    buyer_id: str,
    quality: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """Get download link for purchased item at purchased quality"""
    # Verify purchase - if quality specified, check for that tier
    if quality:
        purchase_result = await db.execute(
            select(GalleryPurchase)
            .where(GalleryPurchase.gallery_item_id == item_id)
            .where(GalleryPurchase.buyer_id == buyer_id)
            .where(GalleryPurchase.quality_tier == quality)
        )
    else:
        # Get highest quality purchase
        purchase_result = await db.execute(
            select(GalleryPurchase)
            .where(GalleryPurchase.gallery_item_id == item_id)
            .where(GalleryPurchase.buyer_id == buyer_id)
            .order_by(GalleryPurchase.amount_paid.desc())
        )
    
    purchase = purchase_result.scalar_one_or_none()
    
    if not purchase:
        raise HTTPException(status_code=403, detail="Not purchased at this quality tier")
    
    if purchase.download_count >= purchase.max_downloads:
        raise HTTPException(status_code=400, detail="Download limit reached")
    
    # Get item with photographer for quality URL lookup
    item_result = await db.execute(
        select(GalleryItem)
        .where(GalleryItem.id == item_id)
        .options(selectinload(GalleryItem.photographer))
    )
    item = item_result.scalar_one_or_none()
    
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    
    # Get URL for purchased quality tier
    _, download_url = get_quality_price(item, item.photographer, purchase.quality_tier)
    
    # Increment download count
    purchase.download_count += 1
    await db.commit()
    
    return {
        "download_url": download_url,
        "quality_tier": purchase.quality_tier,
        "downloads_remaining": purchase.max_downloads - purchase.download_count
    }


@router.get("/gallery/watermarked-preview/{item_id}")
async def get_watermarked_preview(
    item_id: str,
    viewer_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """
    Get a watermarked preview of a gallery item for Standard tier / unpaid items.
    
    Service-to-Gallery Tier Logic:
    - Standard tier: Returns watermarked 1080p preview
    - Pro tier: Returns watermarked preview only if not purchased
    - Purchased items: Returns direct URL (no watermark)
    
    The watermark uses:
    1. Photographer's custom logo (if set)
    2. Default "RAW SURF" centered text at 50% opacity
    """
    # Get the item with photographer info
    result = await db.execute(
        select(GalleryItem)
        .where(GalleryItem.id == item_id)
        .options(selectinload(GalleryItem.photographer))
    )
    item = result.scalar_one_or_none()
    
    if not item:
        raise HTTPException(status_code=404, detail="Gallery item not found")
    
    # Check if viewer has purchased this item
    is_purchased = False
    if viewer_id:
        purchase_result = await db.execute(
            select(GalleryPurchase).where(
                GalleryPurchase.gallery_item_id == item_id,
                GalleryPurchase.buyer_id == viewer_id
            )
        )
        is_purchased = purchase_result.scalar_one_or_none() is not None
    
    # If purchased, return original preview URL (no watermark)
    if is_purchased:
        return {
            "preview_url": item.preview_url,
            "is_watermarked": False,
            "access_type": "purchased"
        }
    
    # Get photographer's watermark settings if available
    photographer = item.photographer
    custom_logo_url = None
    watermark_text = "RAW SURF"
    opacity = 0.5  # 50% opacity as user specified
    watermark_style = 'center'  # Default to single centered logo
    
    # Check for photographer's custom watermark settings
    if photographer:
        if photographer.watermark_logo_url:
            custom_logo_url = photographer.watermark_logo_url
        if photographer.watermark_text:
            watermark_text = photographer.watermark_text
        if photographer.watermark_opacity is not None:
            opacity = photographer.watermark_opacity
        if photographer.watermark_style:
            watermark_style = photographer.watermark_style
    
    # Generate watermarked preview
    image_url = item.preview_url or item.original_url
    if not image_url:
        raise HTTPException(status_code=404, detail="No preview image available")
    
    watermarked_bytes = await generate_watermarked_preview(
        original_url=image_url,
        max_dimension=1080,  # Standard tier max
        watermark_text=watermark_text,
        opacity=opacity,
        custom_logo_url=custom_logo_url,
        watermark_style=watermark_style
    )
    
    if not watermarked_bytes:
        raise HTTPException(status_code=500, detail="Failed to generate watermarked preview")
    
    # Return the watermarked image directly
    return Response(
        content=watermarked_bytes,
        media_type="image/jpeg",
        headers={
            "Content-Disposition": f"inline; filename=preview_{item_id}.jpg",
            "Cache-Control": "public, max-age=3600"  # Cache for 1 hour
        }
    )


class GenerateWatermarkPreviewRequest(BaseModel):
    photographer_id: str
    sample_image_url: str
    watermark_style: str = 'text'  # 'text', 'logo', 'both'
    watermark_text: Optional[str] = None
    watermark_logo_url: Optional[str] = None
    watermark_opacity: float = 0.5
    watermark_position: str = 'bottom-right'


@router.post("/gallery/generate-watermark-preview")
async def generate_watermark_preview_endpoint(
    data: GenerateWatermarkPreviewRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Generate a watermark preview for the photographer's settings UI.
    Takes a sample image and applies watermark with specified settings.
    Returns base64 encoded image.
    """
    import base64
    
    # Convert style from frontend format to backend watermark service format
    watermark_text = data.watermark_text or 'Watermark'
    custom_logo_url = data.watermark_logo_url if data.watermark_style in ['logo', 'both'] else None
    
    # Map frontend position to backend style
    position = data.watermark_position  # 'center', 'bottom-right', etc.
    
    # Generate watermarked preview
    watermarked_bytes = await generate_watermarked_preview(
        original_url=data.sample_image_url,
        max_dimension=800,  # Smaller for preview
        watermark_text=watermark_text,
        opacity=data.watermark_opacity,
        custom_logo_url=custom_logo_url,
        watermark_style=position
    )
    
    if not watermarked_bytes:
        raise HTTPException(status_code=500, detail="Failed to generate watermark preview")
    
    # Return as base64 data URL
    base64_image = base64.b64encode(watermarked_bytes).decode('utf-8')
    
    return {
        "success": True,
        "preview_url": f"data:image/jpeg;base64,{base64_image}"
    }


@router.get("/gallery/my-purchases/{buyer_id}")
async def get_my_purchases(buyer_id: str, db: AsyncSession = Depends(get_db)):
    """Get all photos purchased by a user"""
    result = await db.execute(
        select(GalleryPurchase)
        .where(GalleryPurchase.buyer_id == buyer_id)
        .options(
            selectinload(GalleryPurchase.gallery_item).selectinload(GalleryItem.photographer)
        )
        .order_by(GalleryPurchase.purchased_at.desc())
    )
    purchases = result.scalars().all()
    
    return [{
        "id": p.id,
        "gallery_item_id": p.gallery_item_id,
        "original_url": p.gallery_item.original_url if p.gallery_item else None,
        "preview_url": p.gallery_item.preview_url if p.gallery_item else None,
        "title": p.gallery_item.title if p.gallery_item else None,
        "photographer_name": p.gallery_item.photographer.full_name if p.gallery_item and p.gallery_item.photographer else None,
        "amount_paid": p.amount_paid,
        "downloads_remaining": p.max_downloads - p.download_count,
        "purchased_at": p.purchased_at.isoformat()
    } for p in purchases]


