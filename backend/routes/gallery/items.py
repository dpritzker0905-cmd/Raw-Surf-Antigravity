"""
Gallery Item CRUD — create, read, update, delete, move, copy, assign items.

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

from routes.gamification import check_badge_milestones
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
from models import PhotoTag

router = APIRouter()

@router.post("/gallery")
async def create_gallery_item(
    photographer_id: str,
    data: GalleryItemCreate,
    db: AsyncSession = Depends(get_db)
):
    """Create a new gallery item"""
    # Verify photographer exists and is a photographer role
    result = await db.execute(select(Profile).where(Profile.id == photographer_id))
    photographer = result.scalar_one_or_none()
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    photographer_roles = [RoleEnum.GROM_PARENT, RoleEnum.HOBBYIST, RoleEnum.PHOTOGRAPHER, RoleEnum.APPROVED_PRO]
    if photographer.role not in photographer_roles:
        raise HTTPException(status_code=403, detail="Only photographers can create gallery items")
    
    # GROM PARENT ISOLATION: Force for_sale=false for personal capture only
    is_grom_parent = is_grom_parent_eligible(photographer)
    effective_for_sale = False if is_grom_parent else data.is_for_sale
    
    # Verify spot if provided
    spot_name = None
    if data.spot_id:
        spot_result = await db.execute(select(SurfSpot).where(SurfSpot.id == data.spot_id))
        spot = spot_result.scalar_one_or_none()
        if spot:
            spot_name = spot.name
    
    item = GalleryItem(
        photographer_id=photographer_id,
        spot_id=data.spot_id,
        session_id=data.session_id,
        original_url=data.original_url,
        preview_url=data.preview_url,
        thumbnail_url=data.thumbnail_url,
        media_type=data.media_type,
        title=data.title,
        description=data.description,
        tags=json.dumps(data.tags) if data.tags else None,
        price=data.price if not is_grom_parent else 0,  # Grom Parent: no pricing
        is_for_sale=effective_for_sale,  # Grom Parent: always false
        tagged_surfer_ids=json.dumps(data.tagged_surfer_ids) if data.tagged_surfer_ids else None,
        shot_at=data.shot_at,
        video_width=data.video_width,
        video_height=data.video_height,
        video_duration=data.video_duration
    )
    
    db.add(item)
    await db.commit()
    await db.refresh(item)
    
    # Notify tagged surfers
    if data.tagged_surfer_ids:
        for surfer_id in data.tagged_surfer_ids:
            notification = Notification(
                user_id=surfer_id,
                type='photo_tagged',
                title=f"{photographer.full_name} tagged you in a {'video' if data.media_type == 'video' else 'photo'}!",
                body=f"Check out the {'video' if data.media_type == 'video' else 'photo'} from {spot_name or 'a surf session'}",
                data=json.dumps({
                    "gallery_item_id": item.id,
                    "photographer_id": photographer_id,
                    "type": "photo_tagged"
                })
            )
            db.add(notification)
        await db.commit()
    
    return {
        "id": item.id,
        "preview_url": item.preview_url,
        "media_type": item.media_type,
        "spot_name": spot_name,
        "message": f"{'Video' if data.media_type == 'video' else 'Photo'} added to gallery!"
    }

@router.get("/gallery/photographer/{photographer_id}")
async def get_photographer_gallery(
    photographer_id: str,
    viewer_id: Optional[str] = None,
    include_in_folders: bool = False,  # If False, only show items not in any folder
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db)
):
    """Get a photographer's gallery. By default excludes items that are in folders.
    
    Privacy: Items from on-demand/booking galleries are PRIVATE and only visible
    to session participants. Live session and manual gallery items are public.
    """
    query = select(GalleryItem)\
        .where(GalleryItem.photographer_id == photographer_id)\
        .where(GalleryItem.is_public == True)\
        .where(GalleryItem.is_deleted == False)
    
    # By default, exclude items that are in folders (gallery_id is not null)
    if not include_in_folders:
        query = query.where(GalleryItem.gallery_id == None)
    else:
        # When including folder items, exclude items from PRIVATE session galleries
        # (on_demand, booking) — those are only visible to session participants.
        # Items with no gallery_id (unfiled), or in live/manual galleries, are public.
        query = query.where(
            (GalleryItem.gallery_id == None) | 
            (~GalleryItem.gallery_id.in_(
                select(Gallery.id)
                .where(Gallery.photographer_id == photographer_id)
                .where(Gallery.session_type.in_(['on_demand', 'booking']))
            ))
        )
    
    query = query.options(selectinload(GalleryItem.photographer), selectinload(GalleryItem.spot))\
        .order_by(GalleryItem.created_at.desc())\
        .offset(offset)\
        .limit(limit)
    
    result = await db.execute(query)
    items = result.scalars().all()
    
    # Check which items the viewer has purchased
    purchased_ids = set()
    if viewer_id:
        purchase_result = await db.execute(
            select(GalleryPurchase.gallery_item_id)
            .where(GalleryPurchase.buyer_id == viewer_id)
        )
        purchased_ids = set(row[0] for row in purchase_result.fetchall())
    
    return [{
        "id": item.id,
        "gallery_id": item.gallery_id,  # Needed for frontend folder filtering
        "photographer_id": item.photographer_id,
        "photographer_name": item.photographer.full_name if item.photographer else None,
        "photographer_avatar": item.photographer.avatar_url if item.photographer else None,
        "spot_id": item.spot_id,
        "spot_name": item.spot.name if item.spot else None,
        "original_url": item.original_url if item.id in purchased_ids else None,  # Only show original if purchased
        "preview_url": item.preview_url,
        "thumbnail_url": item.thumbnail_url,
        "media_type": item.media_type or 'image',
        "title": item.title,
        "description": item.description,
        "tags": json.loads(item.tags) if item.tags else None,
        "price": item.price,
        "custom_price": item.custom_price,  # Dynamic Pricing: Manual override if set
        "is_for_sale": item.is_for_sale,
        "is_public": item.is_public,
        "is_featured": item.is_featured,
        "view_count": item.view_count,
        "purchase_count": item.purchase_count,
        "is_purchased": item.id in purchased_ids,
        "video_width": item.video_width,
        "video_height": item.video_height,
        "video_duration": item.video_duration,
        "created_at": item.created_at.isoformat(),
        "shot_at": item.shot_at.isoformat() if item.shot_at else None
    } for item in items]

@router.get("/gallery/spot/{spot_id}")
async def get_spot_gallery(
    spot_id: str,
    viewer_id: Optional[str] = None,
    limit: int = 50,
    db: AsyncSession = Depends(get_db)
):
    """
    Get all gallery items for a surf spot.
    Includes:
    1. Photographer's original uploads (for sale)
    2. Surfer's public items (from My Gallery with is_public=true)
    
    This implements the "Public → Spot Hub Mirror" per Master Logic Sync.
    """
    # Get photographer's gallery items (for sale)
    photographer_items_result = await db.execute(
        select(GalleryItem)
        .where(GalleryItem.spot_id == spot_id)
        .where(GalleryItem.is_public == True)
        .where(GalleryItem.is_for_sale == True)
        .options(selectinload(GalleryItem.photographer))
        .order_by(GalleryItem.created_at.desc())
        .limit(limit)
    )
    photographer_items = photographer_items_result.scalars().all()
    
    # Get surfer's public gallery items (mirrored to Spot Hub)
    surfer_public_items_result = await db.execute(
        select(SurferGalleryItem)
        .where(SurferGalleryItem.spot_id == spot_id)
        .where(SurferGalleryItem.is_public == True)
        .options(
            selectinload(SurferGalleryItem.gallery_item),
            selectinload(SurferGalleryItem.surfer)
        )
        .order_by(SurferGalleryItem.added_at.desc())
        .limit(limit)
    )
    surfer_public_items = surfer_public_items_result.scalars().all()
    
    purchased_ids = set()
    if viewer_id:
        purchase_result = await db.execute(
            select(GalleryPurchase.gallery_item_id)
            .where(GalleryPurchase.buyer_id == viewer_id)
        )
        purchased_ids = set(row[0] for row in purchase_result.fetchall())
    
    # Combine results
    items_response = []
    
    # Add photographer items (for sale)
    for item in photographer_items:
        items_response.append({
            "id": item.id,
            "type": "photographer_listing",
            "photographer_id": item.photographer_id,
            "photographer_name": item.photographer.full_name if item.photographer else None,
            "preview_url": item.preview_url,
            "thumbnail_url": item.thumbnail_url,
            "title": item.title,
            "price": item.price,
            "is_purchased": item.id in purchased_ids,
            "is_for_sale": True,
            "media_type": item.media_type or 'image',
            "created_at": item.created_at.isoformat() if item.created_at else None
        })
    
    # Add surfer's public items (mirrored from My Gallery)
    for surfer_item in surfer_public_items:
        gi = surfer_item.gallery_item
        if not gi:
            continue
        items_response.append({
            "id": surfer_item.id,
            "type": "surfer_public",
            "surfer_id": surfer_item.surfer_id,
            "surfer_name": surfer_item.surfer.full_name if surfer_item.surfer else None,
            "surfer_avatar": surfer_item.surfer.avatar_url if surfer_item.surfer else None,
            "preview_url": gi.preview_url,
            "thumbnail_url": gi.thumbnail_url,
            "title": f"Wave at {surfer_item.spot_name}" if surfer_item.spot_name else "Surf Session",
            "media_type": gi.media_type or 'image',
            "is_for_sale": False,
            "session_date": surfer_item.session_date.isoformat() if surfer_item.session_date else None,
            "created_at": surfer_item.added_at.isoformat() if surfer_item.added_at else None
        })
    
    # Sort combined results by created_at
    items_response.sort(key=lambda x: x.get('created_at') or '', reverse=True)
    
    return {
        "spot_id": spot_id,
        "items": items_response[:limit],
        "total_photographer_items": len(photographer_items),
        "total_surfer_public_items": len(surfer_public_items)
    }

@router.get("/gallery/item/{item_id}")
async def get_gallery_item(
    item_id: str,
    viewer_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """Get a single gallery item"""
    result = await db.execute(
        select(GalleryItem)
        .where(GalleryItem.id == item_id)
        .options(selectinload(GalleryItem.photographer), selectinload(GalleryItem.spot))
    )
    item = result.scalar_one_or_none()
    
    if not item:
        raise HTTPException(status_code=404, detail="Gallery item not found")
    
    # Increment view count
    item.view_count += 1
    await db.commit()
    
    # Check if viewer purchased
    is_purchased = False
    if viewer_id:
        purchase_result = await db.execute(
            select(GalleryPurchase).where(
                GalleryPurchase.gallery_item_id == item_id,
                GalleryPurchase.buyer_id == viewer_id
            )
        )
        is_purchased = purchase_result.scalar_one_or_none() is not None
    
    return {
        "id": item.id,
        "photographer_id": item.photographer_id,
        "photographer_name": item.photographer.full_name if item.photographer else None,
        "photographer_avatar": item.photographer.avatar_url if item.photographer else None,
        "spot_id": item.spot_id,
        "spot_name": item.spot.name if item.spot else None,
        "original_url": item.original_url if is_purchased else None,
        "preview_url": item.preview_url,
        "title": item.title,
        "description": item.description,
        "tags": json.loads(item.tags) if item.tags else None,
        "price": item.price,
        "is_for_sale": item.is_for_sale,
        "view_count": item.view_count,
        "purchase_count": item.purchase_count,
        "is_purchased": is_purchased,
        "created_at": item.created_at.isoformat()
    }


@router.get("/gallery/item/{item_id}/pricing")
async def get_gallery_item_pricing(
    item_id: str,
    viewer_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """Get pricing tiers for a gallery item (SmugMug-style) with Live Session Override
    
    PRICING PRIORITY (Contextual Pricing Matrix):
    1. If item has locked_price_* values → Use those (set at upload time)
    2. If viewer has locked_price_* from session join → Use participant's locked prices
    3. If session participant → Use session's current prices (session_price_*)
    4. Default → Use photographer's general gallery prices
    
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
    # Check if viewer was a participant in the live session that created this gallery
    session_price_override = None
    is_session_participant = False
    session_photos_included = 0
    photos_already_claimed = 0
    participant_locked_prices = None  # Prices locked at join time
    
    if viewer_id and item.gallery_id:
        # Get the gallery and check if it's from a live session
        gallery = item.gallery
        if gallery and gallery.live_session_id:
            # Check if viewer was a participant in this live session
            participant_result = await db.execute(
                select(LiveSessionParticipant)
                .where(LiveSessionParticipant.live_session_id == gallery.live_session_id)
                .where(LiveSessionParticipant.surfer_id == viewer_id)
                .where(LiveSessionParticipant.status.in_(['active', 'completed']))
            )
            participant = participant_result.scalar_one_or_none()
            
            if participant:
                is_session_participant = True
                
                # PRIORITY: Use participant's locked prices if available
                if participant.locked_price_web or participant.locked_price_standard or participant.locked_price_high:
                    participant_locked_prices = {
                        'web': participant.locked_price_web,
                        'standard': participant.locked_price_standard,
                        'high': participant.locked_price_high
                    }
                
                # Get the live session for session-level data
                session_result = await db.execute(
                    select(LiveSession)
                    .where(LiveSession.id == gallery.live_session_id)
                )
                session = session_result.scalar_one_or_none()
                
                if session:
                    # If no participant locked prices, use session prices
                    if not participant_locked_prices:
                        session_price_override = session.session_photo_price or session.photo_price
                    session_photos_included = session.photos_included or 0
                    
                    # Count how many photos the user has already claimed from this session
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
    
    # Calculate if this photo is free (included in session buy-in)
    is_free_from_session = is_session_participant and photos_already_claimed < session_photos_included
    
    if item.media_type == 'video':
        # Videos don't get session override for now
        pricing = {
            "type": "video",
            "tiers": [
                {
                    "tier": "720p",
                    "label": "HD (720p)",
                    "price": item.price_720p or (photographer.video_price_720p if photographer else 8.0) or 8.0,
                    "is_purchased": "720p" in purchased_tiers
                },
                {
                    "tier": "1080p",
                    "label": "Full HD (1080p)",
                    "price": item.price_1080p or (photographer.video_price_1080p if photographer else 15.0) or 15.0,
                    "is_purchased": "1080p" in purchased_tiers
                },
                {
                    "tier": "4k",
                    "label": "Ultra HD (4K)",
                    "price": item.price_4k or (photographer.video_price_4k if photographer else 30.0) or 30.0,
                    "is_purchased": "4k" in purchased_tiers
                }
            ]
        }
    else:
        # Photos - apply contextual pricing (locked > session > general)
        # PRIORITY ORDER:
        # 1. Item's locked prices (set at upload time for session_origin photos)
        # 2. Participant's locked prices (from when they joined the session)
        # 3. Session override prices
        # 4. Gallery-level snapshot prices (frozen at gallery creation time)
        # 5. General photographer/gallery prices (LIVE — only for non-session items)
        
        # Prefer gallery's snapshotted prices over photographer's live profile prices.
        # This ensures that if a photographer changes rates after a session,
        # the gallery's items still show the prices from when the session occurred.
        gallery_obj = item.gallery if item.gallery_id else None
        
        if gallery_obj and (gallery_obj.price_web or gallery_obj.price_standard or gallery_obj.price_high):
            # Gallery has its own price snapshot — use it as the general/fallback price
            general_price_web = item.price_web or gallery_obj.price_web or (photographer.photo_price_web if photographer else 3.0) or 3.0
            general_price_standard = item.price_standard or gallery_obj.price_standard or (photographer.photo_price_standard if photographer else 5.0) or 5.0
            general_price_high = item.price_high or gallery_obj.price_high or (photographer.photo_price_high if photographer else 10.0) or 10.0
        else:
            # No gallery snapshot — use photographer's live profile prices
            general_price_web = item.price_web or (photographer.photo_price_web if photographer else 3.0) or 3.0
            general_price_standard = item.price_standard or (photographer.photo_price_standard if photographer else 5.0) or 5.0
            general_price_high = item.price_high or (photographer.photo_price_high if photographer else 10.0) or 10.0
        
        # Determine final prices per tier
        if is_free_from_session:
            # Free from buy-in credits
            final_price_web = 0.0
            final_price_standard = 0.0
            final_price_high = 0.0
            price_source = 'free_from_buyin'
        elif item.locked_price_web or item.locked_price_standard or item.locked_price_high:
            # Use item's locked prices (set at upload time)
            final_price_web = item.locked_price_web or general_price_web
            final_price_standard = item.locked_price_standard or general_price_standard
            final_price_high = item.locked_price_high or general_price_high
            price_source = 'item_locked'
        elif participant_locked_prices:
            # Use participant's locked prices (from session join)
            final_price_web = participant_locked_prices.get('web') or general_price_web
            final_price_standard = participant_locked_prices.get('standard') or general_price_standard
            final_price_high = participant_locked_prices.get('high') or general_price_high
            price_source = 'participant_locked'
        elif session_price_override is not None:
            # Use session override (legacy single-price)
            final_price_web = session_price_override
            final_price_standard = session_price_override
            final_price_high = session_price_override
            price_source = 'session_override'
        else:
            # Use general pricing
            final_price_web = general_price_web
            final_price_standard = general_price_standard
            final_price_high = general_price_high
            price_source = 'general'
        
        pricing = {
            "type": "photo",
            "tiers": [
                {
                    "tier": "web",
                    "label": "Web Quality (800px)",
                    "price": final_price_web,
                    "general_price": general_price_web,
                    "is_purchased": "web" in purchased_tiers,
                    "is_session_deal": is_session_participant and price_source != 'general',
                    "price_source": price_source
                },
                {
                    "tier": "standard",
                    "label": "Standard (1920px)",
                    "price": final_price_standard,
                    "general_price": general_price_standard,
                    "is_purchased": "standard" in purchased_tiers,
                    "is_session_deal": is_session_participant and price_source != 'general',
                    "price_source": price_source
                },
                {
                    "tier": "high",
                    "label": "High Resolution (Original)",
                    "price": final_price_high,
                    "general_price": general_price_high,
                    "is_purchased": "high" in purchased_tiers,
                    "is_session_deal": is_session_participant and price_source != 'general',
                    "price_source": price_source
                }
            ]
        }
    
    # ── Subscription quota check (pre-purchase hint for frontend) ──
    subscription_info = {
        "has_quota": False,
        "remaining": 0,
        "subscription_active": False,
        "booking_discount_pct": 0,
        "on_demand_discount_pct": 0,
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
        # Session participant info
        "is_session_participant": is_session_participant,
        "session_photos_included": session_photos_included,
        "photos_already_claimed": photos_already_claimed,
        "is_free_from_session": is_free_from_session,
        "session_price_override": session_price_override,
        "session_origin_mode": item.session_origin_mode,
        "has_locked_pricing": bool(participant_locked_prices or item.locked_price_web or item.locked_price_standard),
        # Subscription info (pre-purchase)
        "subscription": subscription_info,
    }


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
        body=f"Quality: {data.quality_tier.upper()} • You earned ${price * 0.80:.2f} credits",
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
    from models import PhotoTag
    
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
    from fastapi.responses import Response
    from services.watermark import generate_watermarked_preview
    
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
    from fastapi.responses import Response
    
    # Convert style from frontend format to backend watermark service format
    # Frontend uses: 'text', 'logo', 'both'  
    # Backend uses: 'center', 'tiled', 'bottom-right', etc. for position
    # And uses custom_logo_url presence to determine logo vs text
    
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


@router.patch("/gallery/item/{item_id}")
async def update_gallery_item(
    item_id: str,
    photographer_id: str,
    data: GalleryItemUpdate,
    db: AsyncSession = Depends(get_db)
):
    """Update gallery item"""
    result = await db.execute(select(GalleryItem).where(GalleryItem.id == item_id))
    item = result.scalar_one_or_none()
    
    if not item:
        raise HTTPException(status_code=404, detail="Gallery item not found")
    
    if item.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    # Check if photographer is Grom Parent (restricted from commerce)
    profile_result = await db.execute(select(Profile).where(Profile.id == photographer_id))
    photographer = profile_result.scalar_one_or_none()
    is_grom_parent = bool(photographer) and is_grom_parent_eligible(photographer)
    
    if data.title is not None:
        item.title = data.title
    if data.description is not None:
        item.description = data.description
    if data.tags is not None:
        item.tags = json.dumps(data.tags)
    if data.price is not None:
        # GROM PARENT ISOLATION: Cannot set prices
        item.price = 0 if is_grom_parent else data.price
    if data.custom_price is not None:
        # Allow setting custom_price to null by passing 0 or negative
        # GROM PARENT: Always null/0
        if is_grom_parent:
            item.custom_price = None
        else:
            item.custom_price = data.custom_price if data.custom_price > 0 else None
    if data.is_for_sale is not None:
        # GROM PARENT ISOLATION: Cannot mark for sale
        item.is_for_sale = False if is_grom_parent else data.is_for_sale
    if data.is_public is not None:
        item.is_public = data.is_public
    if data.is_featured is not None:
        item.is_featured = data.is_featured
    
    await db.commit()
    return {"message": "Gallery item updated", "custom_price": item.custom_price}


class MoveToFolderRequest(BaseModel):
    target_gallery_id: str

@router.patch("/gallery/item/{item_id}/move")
async def move_item_to_gallery(
    item_id: str,
    photographer_id: str,
    data: MoveToFolderRequest,
    db: AsyncSession = Depends(get_db)
):
    """Move a gallery item to a different gallery/folder"""
    # Get the item
    result = await db.execute(select(GalleryItem).where(GalleryItem.id == item_id))
    item = result.scalar_one_or_none()
    
    if not item:
        raise HTTPException(status_code=404, detail="Gallery item not found")
    
    if item.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    # Verify target gallery exists and is owned by photographer
    target_result = await db.execute(select(Gallery).where(Gallery.id == data.target_gallery_id))
    target_gallery = target_result.scalar_one_or_none()
    
    if not target_gallery:
        raise HTTPException(status_code=404, detail="Target folder not found")
    
    if target_gallery.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized to move to this folder")
    
    # Update item counts on old and new galleries
    if item.gallery_id:
        old_result = await db.execute(select(Gallery).where(Gallery.id == item.gallery_id))
        old_gallery = old_result.scalar_one_or_none()
        if old_gallery:
            old_gallery.item_count = max(0, old_gallery.item_count - 1)
    
    # Move item
    item.gallery_id = data.target_gallery_id
    target_gallery.item_count += 1
    
    # ============ PRICE SNAPSHOT: Inherit gallery's locked prices ============
    # When a photo is moved into a session gallery, it should adopt the pricing
    # that was active at the time of the session — NOT the photographer's current prices.
    # This ensures price consistency even if the photographer changes rates later.
    if target_gallery.locked_price_web is not None:
        item.locked_price_web = target_gallery.locked_price_web
    if target_gallery.locked_price_standard is not None:
        item.locked_price_standard = target_gallery.locked_price_standard
    if target_gallery.locked_price_high is not None:
        item.locked_price_high = target_gallery.locked_price_high
    if target_gallery.session_type:
        item.session_origin_mode = target_gallery.session_type
    
    # Set cover image if target doesn't have one
    if not target_gallery.cover_image_url and item.media_type == 'image':
        target_gallery.cover_image_url = item.preview_url
    
    # AUTO-DISTRIBUTE: If target gallery is session-linked, push to participants' lockers
    distributed = 0
    if target_gallery.live_session_id or target_gallery.booking_id or target_gallery.dispatch_id:
        try:
            distributed = await distribute_gallery_item_to_participants(
                db, item.id, target_gallery
            )
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning(f"Auto-distribution failed for item {item.id}: {e}")
    
    await db.commit()
    return {
        "message": "Item moved to folder", 
        "gallery_id": data.target_gallery_id,
        "distributed_to_surfers": distributed
    }


# ============ MANUAL SURFER ASSIGNMENT (Photographer Fallback) ============

class AssignSurferRequest(BaseModel):
    photographer_id: str
    surfer_id: str
    access_type: str = 'pending_selection'  # 'pending_selection', 'included', 'gifted'

@router.post("/gallery/item/{item_id}/assign-surfer")
async def assign_item_to_surfer(
    item_id: str,
    data: AssignSurferRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Manual photographer fallback: assign a specific item to a specific surfer's locker.
    Also records the assignment as AI training data for future matching.
    
    access_type:
    - 'pending_selection': Surfer sees watermarked, must select or purchase
    - 'included': Free — counts toward session allocation
    - 'gifted': Photographer gift — free download
    """
    # Verify photographer owns the item
    item_result = await db.execute(select(GalleryItem).where(GalleryItem.id == item_id))
    item = item_result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Gallery item not found")
    if item.photographer_id != data.photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    # Verify surfer exists
    surfer_result = await db.execute(select(Profile).where(Profile.id == data.surfer_id))
    if not surfer_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Surfer not found")
    
    result = await manually_assign_item_to_surfer(
        db=db,
        gallery_item_id=item_id,
        surfer_id=data.surfer_id,
        photographer_id=data.photographer_id,
        access_type=data.access_type
    )
    
    if "error" in result and not result.get("already_exists"):
        raise HTTPException(status_code=400, detail=result["error"])
    
    await db.commit()
    return result


class BulkAssignRequest(BaseModel):
    photographer_id: str
    surfer_id: str
    item_ids: Optional[List[str]] = None  # If None, assigns all items in gallery
    access_type: str = 'included'  # Default to 'included' for session-purchased content

@router.post("/gallery/{gallery_id}/assign-all-to-surfer")
async def bulk_assign_to_surfer(
    gallery_id: str,
    data: BulkAssignRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Bulk assign multiple gallery items to a surfer's locker.
    If item_ids not provided, assigns ALL items in the gallery.
    """
    # Verify gallery ownership
    gallery_result = await db.execute(select(Gallery).where(Gallery.id == gallery_id))
    gallery = gallery_result.scalar_one_or_none()
    if not gallery:
        raise HTTPException(status_code=404, detail="Gallery not found")
    if gallery.photographer_id != data.photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    # Verify surfer exists
    surfer_result = await db.execute(select(Profile).where(Profile.id == data.surfer_id))
    if not surfer_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Surfer not found")
    
    # Get items to assign
    if data.item_ids:
        items_result = await db.execute(
            select(GalleryItem).where(
                GalleryItem.id.in_(data.item_ids),
                GalleryItem.gallery_id == gallery_id
            )
        )
    else:
        items_result = await db.execute(
            select(GalleryItem).where(
                GalleryItem.gallery_id == gallery_id,
                GalleryItem.is_deleted == False
            )
        )
    
    items = items_result.scalars().all()
    
    assigned_count = 0
    skipped_count = 0
    
    for item in items:
        result = await manually_assign_item_to_surfer(
            db=db,
            gallery_item_id=item.id,
            surfer_id=data.surfer_id,
            photographer_id=data.photographer_id,
            access_type=data.access_type,
            gallery=gallery
        )
        if result.get("success"):
            assigned_count += 1
        else:
            skipped_count += 1
    
    await db.commit()
    return {
        "message": f"Assigned {assigned_count} items to surfer's locker",
        "assigned": assigned_count,
        "skipped": skipped_count,
        "total_items": len(items)
    }


@router.post("/gallery/item/{item_id}/copy")
async def copy_item_to_gallery(
    item_id: str,
    photographer_id: str,
    data: MoveToFolderRequest,
    db: AsyncSession = Depends(get_db)
):
    """Copy a gallery item to a folder (keeps original in main gallery)"""
    # Get the original item
    result = await db.execute(select(GalleryItem).where(GalleryItem.id == item_id))
    item = result.scalar_one_or_none()
    
    if not item:
        raise HTTPException(status_code=404, detail="Gallery item not found")
    
    if item.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    # Verify target gallery exists and is owned by photographer
    target_result = await db.execute(select(Gallery).where(Gallery.id == data.target_gallery_id))
    target_gallery = target_result.scalar_one_or_none()
    
    if not target_gallery:
        raise HTTPException(status_code=404, detail="Target folder not found")
    
    if target_gallery.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized to copy to this folder")
    
    # Create a copy of the item in the target folder
    new_item = GalleryItem(
        id=str(uuid.uuid4()),
        photographer_id=item.photographer_id,
        spot_id=item.spot_id,
        gallery_id=data.target_gallery_id,
        original_url=item.original_url,
        preview_url=item.preview_url,
        thumbnail_url=item.thumbnail_url,
        media_type=item.media_type,
        title=item.title,
        description=item.description,
        tags=item.tags,
        price=item.price,
        custom_price=item.custom_price,
        is_for_sale=item.is_for_sale,
        is_public=item.is_public,
        is_featured=item.is_featured,
        video_width=item.video_width,
        video_height=item.video_height,
        video_duration=item.video_duration,
        shot_at=item.shot_at,
        # ============ PRICE SNAPSHOT: Inherit gallery's locked prices ============
        # Copy inherits the session-time pricing from the target gallery so
        # future photographer price changes don't retroactively affect this gallery.
        locked_price_web=target_gallery.locked_price_web,
        locked_price_standard=target_gallery.locked_price_standard,
        locked_price_high=target_gallery.locked_price_high,
        session_origin_mode=target_gallery.session_type,
    )
    db.add(new_item)
    
    # Update target gallery count
    target_gallery.item_count += 1
    
    # Set cover image if target doesn't have one
    if not target_gallery.cover_image_url and item.media_type == 'image':
        target_gallery.cover_image_url = item.preview_url
    
    await db.commit()
    return {"message": "Item copied to folder", "gallery_id": data.target_gallery_id, "new_item_id": new_item.id}


class SetCustomPriceRequest(BaseModel):
    custom_price: Optional[float] = None  # Set to null or <= 0 to clear the custom price

@router.patch("/gallery/item/{item_id}/custom-price")
async def set_item_custom_price(
    item_id: str,
    photographer_id: str,
    data: SetCustomPriceRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Quick-set custom price for a gallery item (used in thumbnail quick-edit).
    Dynamic Pricing Rule 1: If custom_price is set, it takes priority over all other pricing.
    Pass custom_price=0 or null to clear the override and revert to general pricing.
    """
    result = await db.execute(select(GalleryItem).where(GalleryItem.id == item_id))
    item = result.scalar_one_or_none()
    
    if not item:
        raise HTTPException(status_code=404, detail="Gallery item not found")
    
    if item.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    # Set or clear custom price
    if data.custom_price is None or data.custom_price <= 0:
        item.custom_price = None
    else:
        item.custom_price = data.custom_price
    
    await db.commit()
    
    # Fetch photographer's base pricing for response
    result = await db.execute(select(Profile).where(Profile.id == photographer_id))
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


@router.delete("/gallery/item/{item_id}")
async def delete_gallery_item(
    item_id: str,
    photographer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Delete gallery item (soft-deletes if surfers have paid for it)"""
    result = await safe_delete_gallery_item(db, item_id, photographer_id)
    
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    
    await db.commit()
    return result

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

