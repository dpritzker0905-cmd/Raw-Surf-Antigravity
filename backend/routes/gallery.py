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

gallery_logger = logging.getLogger(__name__)

from database import get_db
from models import Profile, SurfSpot, GalleryItem, GalleryPurchase, Notification, RoleEnum, Gallery, LiveSession, LiveSessionParticipant, XPTransaction, SurferGalleryItem, SurferSelectionQuota, GalleryTierEnum, Booking, BookingParticipant, DispatchRequest, ConditionReport

# Import badge check function
from routes.gamification import check_badge_milestones

# Import gallery sync services for auto-distribution & safe deletion
from services.gallery_sync import (
    distribute_gallery_item_to_participants,
    manually_assign_item_to_surfer,
    safe_delete_gallery_item
)

# Import WebSocket broadcast for real-time earnings updates
from websocket_manager import broadcast_earnings_update

# Import watermark service
from services.watermark import watermark_image_from_url, generate_watermarked_preview
from utils.grom_parent import is_grom_parent_eligible

router = APIRouter()



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


def get_quality_price(item: 'GalleryItem', photographer: 'Profile', quality_tier: str) -> tuple[float, str]:
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
    """Get a photographer's gallery. By default excludes items that are in folders."""
    query = select(GalleryItem)\
        .where(GalleryItem.photographer_id == photographer_id)\
        .where(GalleryItem.is_public == True)\
        .where(GalleryItem.is_deleted == False)
    
    # By default, exclude items that are in folders (gallery_id is not null)
    if not include_in_folders:
        query = query.where(GalleryItem.gallery_id == None)
    
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


# ============ GALLERY COLLECTION MANAGEMENT ============

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


@router.post("/galleries")
async def create_gallery(
    photographer_id: str,
    data: GalleryCreate,
    db: AsyncSession = Depends(get_db)
):
    """Create a new gallery (collection)"""
    
    # Verify photographer
    result = await db.execute(select(Profile).where(Profile.id == photographer_id))
    photographer = result.scalar_one_or_none()
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    photographer_roles = [RoleEnum.GROM_PARENT, RoleEnum.HOBBYIST, RoleEnum.PHOTOGRAPHER, RoleEnum.APPROVED_PRO]
    if photographer.role not in photographer_roles:
        raise HTTPException(status_code=403, detail="Only photographers can create galleries")
    
    gallery = Gallery(
        photographer_id=photographer_id,
        title=data.title,
        description=data.description,
        surf_spot_id=data.surf_spot_id,
        cover_image_url=data.cover_image_url,
        # Phase 5: Session linking at creation — prevent orphaned galleries
        session_type=data.session_type or 'manual',
        live_session_id=data.live_session_id,
        booking_id=data.booking_id,
        dispatch_id=data.dispatch_id,
        price_web=data.price_web,
        price_standard=data.price_standard,
        price_high=data.price_high,
        price_720p=data.price_720p,
        price_1080p=data.price_1080p,
        price_4k=data.price_4k
    )
    
    db.add(gallery)
    await db.commit()
    await db.refresh(gallery)
    
    return {
        "id": gallery.id,
        "title": gallery.title,
        "message": "Gallery created successfully"
    }

def _build_session_settings(gallery):
    """
    Build session-level content settings (photos/videos included)
    from the linked LiveSession, Booking, or Dispatch.
    """
    settings = {
        "session_type": gallery.session_type or "manual",
        "photos_included": 3,
        "videos_included": 0,
        "buyin_price": 0,
        "full_gallery": False
    }
    
    if gallery.live_session_id and gallery.live_session:
        ls = gallery.live_session
        settings["photos_included"] = getattr(ls, 'photos_included', 3) or 3
        raw_vid = getattr(ls, 'videos_included', None)
        settings["videos_included"] = raw_vid if raw_vid and raw_vid > 0 else 0
        settings["buyin_price"] = getattr(ls, 'buyin_price', 25.0) or 25.0
        settings["session_type"] = "live"
    elif gallery.booking_id:
        # Pull from photographer profile defaults for bookings
        if gallery.photographer:
            p = gallery.photographer
            settings["photos_included"] = getattr(p, 'booking_photos_included', 3) or 3
            settings["videos_included"] = getattr(p, 'booking_videos_included', 0) or 0
            settings["buyin_price"] = getattr(p, 'booking_hourly_rate', 50.0) or 50.0
            settings["full_gallery"] = getattr(p, 'booking_full_gallery', False) or False
        settings["session_type"] = "booking"
    elif gallery.dispatch_id:
        if gallery.photographer:
            p = gallery.photographer
            settings["photos_included"] = getattr(p, 'on_demand_photos_included', 3) or 3
            settings["videos_included"] = getattr(p, 'on_demand_videos_included', 0) or 0
            settings["full_gallery"] = getattr(p, 'on_demand_full_gallery', False) or False
        settings["session_type"] = "on_demand"
    
    return settings


def _build_photographer_pricing(photographer):
    """
    Build full photographer pricing config across all 3 service types.
    Powers the expanded gallery pricing card showing per-tier rates + included content.
    """
    if not photographer:
        return None
    
    p = photographer
    return {
        "live_session": {
            "photos_included": getattr(p, 'live_session_photos_included', 3) or 3,
            "videos_included": getattr(p, 'live_session_videos_included', 1) or 0,
            "full_gallery": getattr(p, 'live_session_full_gallery', False) or False,
            "buyin_price": getattr(p, 'live_buyin_price', 25.0) or 25.0,
            "photo": {
                "web": getattr(p, 'live_price_web', 3.0),
                "standard": getattr(p, 'live_price_standard', 6.0),
                "high": getattr(p, 'live_price_high', 12.0)
            },
            "video": {
                "720p": getattr(p, 'live_video_720p', 8.0),
                "1080p": getattr(p, 'live_video_1080p', 15.0),
                "4k": getattr(p, 'live_video_4k', 30.0)
            }
        },
        "booking": {
            "photos_included": getattr(p, 'booking_photos_included', 3) or 3,
            "videos_included": getattr(p, 'booking_videos_included', 1) or 0,
            "full_gallery": getattr(p, 'booking_full_gallery', False) or False,
            "hourly_rate": getattr(p, 'booking_hourly_rate', 50.0) or 50.0,
            "photo": {
                "web": getattr(p, 'booking_price_web', 3.0),
                "standard": getattr(p, 'booking_price_standard', 5.0),
                "high": getattr(p, 'booking_price_high', 10.0)
            },
            "video": {
                "720p": getattr(p, 'booking_video_720p', 8.0),
                "1080p": getattr(p, 'booking_video_1080p', 15.0),
                "4k": getattr(p, 'booking_video_4k', 30.0)
            }
        },
        "on_demand": {
            "photos_included": getattr(p, 'on_demand_photos_included', 3) or 3,
            "videos_included": getattr(p, 'on_demand_videos_included', 1) or 0,
            "full_gallery": getattr(p, 'on_demand_full_gallery', False) or False,
            "photo": {
                "web": getattr(p, 'on_demand_price_web', 5.0),
                "standard": getattr(p, 'on_demand_price_standard', 10.0),
                "high": getattr(p, 'on_demand_price_high', 18.0)
            },
            "video": {
                "720p": getattr(p, 'on_demand_video_720p', 12.0),
                "1080p": getattr(p, 'on_demand_video_1080p', 20.0),
                "4k": getattr(p, 'on_demand_video_4k', 40.0)
            }
        },
        "gallery": {
            "photo": {
                "web": getattr(p, 'photo_price_web', 3.0),
                "standard": getattr(p, 'photo_price_standard', 5.0),
                "high": getattr(p, 'photo_price_high', 10.0)
            },
            "video": {
                "720p": getattr(p, 'video_price_720p', 8.0),
                "1080p": getattr(p, 'video_price_1080p', 15.0),
                "4k": getattr(p, 'video_price_4k', 30.0)
            }
        }
    }


def _build_session_roster(gallery, live_map, booking_map, dispatch_map, dist_map):
    """
    Build a unified session roster for a gallery folder.
    Returns a list of surfer objects with delivery progress data.
    Differentiates between photo and video credits/delivery.
    Works across Live Sessions, Regular Bookings, and On-Demand Dispatch.
    """
    participants = []
    
    # Get the right participant list based on session type
    if gallery.live_session_id and gallery.live_session_id in live_map:
        participants = live_map[gallery.live_session_id]
        photos_included = 3
        # Default videos_included to 0 until photographer explicitly sets it
        # The old photos_included covers ALL content types pre-migration
        videos_included = 0
        if gallery.live_session:
            photos_included = getattr(gallery.live_session, 'photos_included', 3) or 3
            # Only use videos_included if column exists and was explicitly set (> 0)
            raw_vid = getattr(gallery.live_session, 'videos_included', None)
            videos_included = raw_vid if raw_vid and raw_vid > 0 else 0
        for p in participants:
            p["photos_included"] = photos_included
            p["videos_included"] = videos_included
    
    elif gallery.booking_id and gallery.booking_id in booking_map:
        participants = booking_map[gallery.booking_id]
        for p in participants:
            p["photos_included"] = p.get("photos_included", 3)
            p["videos_included"] = p.get("videos_included", 0)
    
    elif gallery.dispatch_id and gallery.dispatch_id in dispatch_map:
        participants = dispatch_map[gallery.dispatch_id]
        for p in participants:
            p["photos_included"] = 3
            p["videos_included"] = 0
    
    else:
        return []
    
    # Merge distribution progress data (now split by photo/video)
    gallery_dist = dist_map.get(gallery.id, {})
    roster = []
    for p in participants:
        surfer_id = p["surfer_id"]
        empty_dist = {
            "total": 0, "included": 0,
            "photos_total": 0, "videos_total": 0,
            "photos_included": 0, "videos_included": 0
        }
        dist_data = gallery_dist.get(surfer_id, empty_dist)
        
        ph_included = p.get("photos_included", 3)
        vid_included = p.get("videos_included", 0)
        total_included_slots = ph_included + vid_included
        
        photos_delivered = dist_data.get("photos_total", 0)
        videos_delivered = dist_data.get("videos_total", 0)
        photos_included_used = dist_data.get("photos_included", 0)
        videos_included_used = dist_data.get("videos_included", 0)
        total_delivered = dist_data.get("total", 0)
        
        # Credit calculation: When videos_included=0, photos_included covers ALL
        # content types (photos + videos from a unified pool). When videos_included > 0,
        # photos and videos have separate credit pools.
        if vid_included == 0:
            # Unified pool: photos_included covers ALL items (photos + videos)
            total_from_pool = photos_delivered + videos_delivered
            photos_credits_left = max(0, ph_included - total_from_pool)
            videos_credits_left = 0
        else:
            # Separate pools: photos and videos have independent credit allocations
            photos_credits_left = max(0, ph_included - photos_delivered)
            videos_credits_left = max(0, vid_included - videos_delivered)
        total_credits_left = photos_credits_left + videos_credits_left
        
        progress = min(100, int((total_delivered / total_included_slots * 100) if total_included_slots > 0 else 0))
        
        roster.append({
            "surfer_id": surfer_id,
            "full_name": p["full_name"],
            "username": p["username"],
            "avatar_url": p["avatar_url"],
            "selfie_url": p.get("selfie_url"),
            "amount_paid": p["amount_paid"],
            "payment_method": p.get("payment_method"),
            # Photo credits
            "photos_included": ph_included,
            "photos_delivered": photos_delivered,
            "photos_credits_remaining": photos_credits_left,
            # Video credits
            "videos_included": vid_included,
            "videos_delivered": videos_delivered,
            "videos_credits_remaining": videos_credits_left,
            # Totals (backward compat)
            "items_delivered": total_delivered,
            "credits_remaining": total_credits_left,
            "progress_pct": progress
        })
    
    return roster


@router.get("/galleries/photographer/{photographer_id}")
async def get_photographer_galleries(
    photographer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get all galleries for a photographer"""
    
    result = await db.execute(
        select(Gallery)
        .where(Gallery.photographer_id == photographer_id)
        .options(
            selectinload(Gallery.surf_spot),
            selectinload(Gallery.live_session),
            selectinload(Gallery.items),
            selectinload(Gallery.photographer)
        )
        .order_by(Gallery.created_at.desc())
    )
    galleries = result.scalars().all()
    
    # Auto-heal: if a gallery has items but no cover_image_url, set it from the first item
    needs_commit = False
    gallery_data = []
    
    # ── Session Roster: Batch-load participants for all galleries ──
    # This powers the "surfer delivery progress" cards on each folder
    gallery_ids = [g.id for g in galleries]
    
    # Build maps of session references for batch queries
    live_session_ids = [g.live_session_id for g in galleries if g.live_session_id]
    booking_ids = [g.booking_id for g in galleries if g.booking_id]
    dispatch_ids = [g.dispatch_id for g in galleries if g.dispatch_id]
    
    # ── Live Session Participants ──
    live_participants_map = {}  # live_session_id -> [participants]
    if live_session_ids:
        try:
            # Primary query: participants linked by live_session_id
            lsp_result = await db.execute(
                select(LiveSessionParticipant, Profile)
                .join(Profile, LiveSessionParticipant.surfer_id == Profile.id)
                .where(LiveSessionParticipant.live_session_id.in_(live_session_ids))
            )
            rows = lsp_result.all()
            gallery_logger.info(f"Session Roster: Found {len(rows)} live participants by session_id for {len(live_session_ids)} sessions")
            
            for row in rows:
                lsp, profile = row[0], row[1]
                sid = lsp.live_session_id
                if sid not in live_participants_map:
                    live_participants_map[sid] = []
                live_participants_map[sid].append({
                    "surfer_id": profile.id,
                    "full_name": profile.full_name,
                    "username": profile.username,
                    "avatar_url": profile.avatar_url,
                    "selfie_url": lsp.selfie_url,
                    "amount_paid": lsp.amount_paid or 0,
                    "photos_credit_remaining": lsp.photos_credit_remaining or 0,
                    "payment_method": lsp.payment_method
                })
            
            # ── FALLBACK: Query by photographer_id for sessions with no matched participants ──
            # This handles the case where participants joined the photographer
            # but their live_session_id was NULL at join time
            missing_session_ids = [sid for sid in live_session_ids if sid not in live_participants_map]
            if missing_session_ids:
                gallery_logger.info(f"Session Roster: {len(missing_session_ids)} sessions have 0 participants, trying photographer_id fallback")
                for missing_sid in missing_session_ids:
                    # Find the gallery for this session to get the photographer_id and session date
                    matching_gallery = next((g for g in galleries if g.live_session_id == missing_sid), None)
                    if not matching_gallery:
                        continue
                    
                    # Query participants linked to the photographer around the session time
                    session_date = matching_gallery.session_date
                    fallback_query = (
                        select(LiveSessionParticipant, Profile)
                        .join(Profile, LiveSessionParticipant.surfer_id == Profile.id)
                        .where(LiveSessionParticipant.photographer_id == photographer_id)
                        .where(LiveSessionParticipant.live_session_id == None)
                    )
                    # Narrow by time window if session_date available
                    if session_date:
                        time_before = session_date - timedelta(hours=2)
                        time_after = session_date + timedelta(hours=6)
                        fallback_query = fallback_query.where(
                            LiveSessionParticipant.joined_at.between(time_before, time_after)
                        )
                    
                    fb_result = await db.execute(fallback_query)
                    fb_rows = fb_result.all()
                    
                    if fb_rows:
                        gallery_logger.info(f"Session Roster FALLBACK: Found {len(fb_rows)} orphaned participants for session {missing_sid}")
                        live_participants_map[missing_sid] = []
                        for row in fb_rows:
                            lsp, profile = row[0], row[1]
                            live_participants_map[missing_sid].append({
                                "surfer_id": profile.id,
                                "full_name": profile.full_name,
                                "username": profile.username,
                                "avatar_url": profile.avatar_url,
                                "selfie_url": lsp.selfie_url,
                                "amount_paid": lsp.amount_paid or 0,
                                "photos_credit_remaining": lsp.photos_credit_remaining or 0,
                                "payment_method": lsp.payment_method
                            })
                            
                            # AUTO-HEAL: Update the participant's live_session_id for future queries
                            lsp.live_session_id = missing_sid
                        
                        needs_commit = True
        except Exception as e:
            gallery_logger.error(f"Session Roster live query error: {e}")
    
    # ── Booking Participants ──
    booking_participants_map = {}  # booking_id -> [participants]
    booking_settings_map = {}  # booking_id -> {photos_included}
    if booking_ids:
        # Load booking settings for photos_included
        bk_result = await db.execute(
            select(Booking).where(Booking.id.in_(booking_ids))
        )
        for bk in bk_result.scalars().all():
            booking_settings_map[bk.id] = {
                "photos_included": bk.booking_photos_included or 3
            }
        
        try:
            bp_result = await db.execute(
                select(BookingParticipant, Profile)
                .join(Profile, BookingParticipant.participant_id == Profile.id)
                .where(BookingParticipant.booking_id.in_(booking_ids))
            )
            for row in bp_result.all():
                bp, profile = row[0], row[1]
                bid = bp.booking_id
                if bid not in booking_participants_map:
                    booking_participants_map[bid] = []
                bk_settings = booking_settings_map.get(bid, {})
                booking_participants_map[bid].append({
                    "surfer_id": profile.id,
                    "full_name": profile.full_name,
                    "username": profile.username,
                    "avatar_url": profile.avatar_url,
                    "selfie_url": bp.selfie_url,
                    "amount_paid": bp.paid_amount or 0,
                    "photos_credit_remaining": 0,
                    "payment_method": bp.payment_method,
                    "photos_included": bk_settings.get("photos_included", 3)
                })
        except Exception as e:
            gallery_logger.error(f"Session Roster booking query error: {e}")
    
    # ── On-Demand (Dispatch) Participants ──
    from models import DispatchRequestParticipant
    dispatch_participants_map = {}  # dispatch_id -> [participants]
    if dispatch_ids:
        # Get dispatch requests to find requesters
        try:
            dr_result = await db.execute(
                select(DispatchRequest, Profile)
                .join(Profile, DispatchRequest.requester_id == Profile.id)
                .where(DispatchRequest.id.in_(dispatch_ids))
            )
            for row in dr_result.all():
                dr, profile = row[0], row[1]
                did = dr.id
                if did not in dispatch_participants_map:
                    dispatch_participants_map[did] = []
                dispatch_participants_map[did].append({
                    "surfer_id": profile.id,
                    "full_name": profile.full_name,
                    "username": profile.username,
                    "avatar_url": profile.avatar_url,
                    "selfie_url": dr.selfie_url,
                    "amount_paid": dr.deposit_amount or 0,
                    "photos_credit_remaining": 0,
                    "payment_method": "card"
                })
        except Exception as e:
            gallery_logger.error(f"Session Roster dispatch query error: {e}")
        # Also get additional crew participants
        try:
            drp_result = await db.execute(
                select(DispatchRequestParticipant, Profile)
                .join(Profile, DispatchRequestParticipant.participant_id == Profile.id)
                .where(DispatchRequestParticipant.dispatch_request_id.in_(dispatch_ids))
                .where(DispatchRequestParticipant.paid == True)
            )
            for row in drp_result.all():
                drp, profile = row[0], row[1]
                did = drp.dispatch_request_id
                if did not in dispatch_participants_map:
                    dispatch_participants_map[did] = []
                # Avoid duplicates
                existing_ids = [p["surfer_id"] for p in dispatch_participants_map[did]]
                if profile.id not in existing_ids:
                    dispatch_participants_map[did].append({
                        "surfer_id": profile.id,
                        "full_name": profile.full_name,
                        "username": profile.username,
                        "avatar_url": profile.avatar_url,
                        "selfie_url": drp.selfie_url,
                        "amount_paid": drp.share_amount or 0,
                        "photos_credit_remaining": 0,
                        "payment_method": "card"
                    })
        except Exception:
            pass  # DispatchRequestParticipant may not exist yet
    
    # ── Distribution counts per surfer per gallery (for progress bars) ──
    dist_per_surfer_map = {}  # gallery_id -> {surfer_id -> {photos_total, videos_total, ...}}
    if gallery_ids:
        # Get all item IDs for these galleries + media type lookup
        all_item_ids = []
        gallery_item_map = {}  # gallery_id -> [item_ids]
        item_media_type = {}   # item_id -> 'image' | 'video'
        for g in galleries:
            g_item_ids = [item.id for item in (g.items or [])]
            all_item_ids.extend(g_item_ids)
            gallery_item_map[g.id] = g_item_ids
            for item in (g.items or []):
                item_media_type[item.id] = item.media_type or 'image'
        
        if all_item_ids:
            dist_result = await db.execute(
                select(
                    SurferGalleryItem.gallery_item_id,
                    SurferGalleryItem.surfer_id,
                    SurferGalleryItem.access_type
                ).where(SurferGalleryItem.gallery_item_id.in_(all_item_ids))
            )
            # Build reverse lookup: item_id -> gallery_id
            item_to_gallery = {}
            for gid, item_ids in gallery_item_map.items():
                for iid in item_ids:
                    item_to_gallery[iid] = gid
            
            for row in dist_result.all():
                gid = item_to_gallery.get(row[0])
                if gid:
                    if gid not in dist_per_surfer_map:
                        dist_per_surfer_map[gid] = {}
                    sid = row[1]
                    if sid not in dist_per_surfer_map[gid]:
                        dist_per_surfer_map[gid][sid] = {
                            "total": 0, "included": 0,
                            "photos_total": 0, "videos_total": 0,
                            "photos_included": 0, "videos_included": 0
                        }
                    dist_per_surfer_map[gid][sid]["total"] += 1
                    is_video = item_media_type.get(row[0], 'image') == 'video'
                    if is_video:
                        dist_per_surfer_map[gid][sid]["videos_total"] += 1
                    else:
                        dist_per_surfer_map[gid][sid]["photos_total"] += 1
                    if row[2] == 'included':
                        dist_per_surfer_map[gid][sid]["included"] += 1
                        if is_video:
                            dist_per_surfer_map[gid][sid]["videos_included"] += 1
                        else:
                            dist_per_surfer_map[gid][sid]["photos_included"] += 1
    for g in galleries:
        cover_url = g.cover_image_url
        
        # If no cover but has items, use the first item's preview/thumbnail
        if not cover_url and g.items:
            for item in sorted(g.items, key=lambda i: i.created_at or datetime.min):
                candidate = item.preview_url or item.thumbnail_url
                if candidate:
                    cover_url = candidate
                    # Persist so this only needs to compute once
                    g.cover_image_url = cover_url
                    needs_commit = True
                    break
        
        # Also fix accurate item_count while we're here
        actual_count = len(g.items) if g.items else 0
        if g.item_count != actual_count:
            g.item_count = actual_count
            needs_commit = True
        
        # Compute a fallback preview from items for frontend
        first_item_preview = None
        if g.items:
            for item in sorted(g.items, key=lambda i: i.created_at or datetime.min):
                candidate = item.preview_url or item.thumbnail_url
                if candidate:
                    first_item_preview = candidate
                    break
        
        gallery_data.append({
            "id": g.id,
            "title": g.title,
            "description": g.description,
            "cover_image_url": cover_url,
            "first_item_preview": first_item_preview,
            "surf_spot_id": g.surf_spot_id,
            "surf_spot_name": g.surf_spot.name if g.surf_spot else None,
            "live_session_id": g.live_session_id,
            "booking_id": g.booking_id,
            "dispatch_id": g.dispatch_id,
            "session_type": g.session_type or ("live" if g.live_session_id else "manual"),
            "item_count": actual_count,
            "view_count": g.view_count,
            "purchase_count": g.purchase_count,
            "is_public": g.is_public,
            "is_featured": g.is_featured,
            "session_date": g.session_date.isoformat() if g.session_date else None,
            "created_at": g.created_at.isoformat(),
            "pricing": {
                "photo": {
                    "web": g.price_web,
                    "standard": g.price_standard,
                    "high": g.price_high
                },
                "video": {
                    "720p": g.price_720p,
                    "1080p": g.price_1080p,
                    "4k": g.price_4k
                }
            },
            "session_settings": _build_session_settings(g),
            "photographer_pricing": _build_photographer_pricing(g.photographer) if g.photographer else None,
            # ── SESSION ROSTER: Surfer delivery progress ──
            "session_roster": _build_session_roster(
                g, live_participants_map, booking_participants_map,
                dispatch_participants_map, dist_per_surfer_map
            )
        })
    
    if needs_commit:
        await db.commit()
    
    return gallery_data


@router.get("/galleries/{gallery_id}")
async def get_gallery(
    gallery_id: str,
    viewer_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """Get a single gallery with items"""
    
    result = await db.execute(
        select(Gallery)
        .where(Gallery.id == gallery_id)
        .options(
            selectinload(Gallery.photographer),
            selectinload(Gallery.surf_spot),
            selectinload(Gallery.items),
            selectinload(Gallery.live_session)
        )
    )
    gallery = result.scalar_one_or_none()
    
    if not gallery:
        raise HTTPException(status_code=404, detail="Gallery not found")
    
    # Increment view count
    gallery.view_count += 1
    await db.commit()
    
    # Get purchased item IDs for viewer
    purchased_ids = set()
    if viewer_id:
        purchase_result = await db.execute(
            select(GalleryPurchase.gallery_item_id)
            .where(GalleryPurchase.buyer_id == viewer_id)
        )
        purchased_ids = set(row[0] for row in purchase_result.fetchall())
    
    
    # Phase 4: Pre-fetch per-item distribution counts for status badges
    is_owner = viewer_id and viewer_id == gallery.photographer_id
    item_ids = [item.id for item in gallery.items]
    distribution_map = {}  # item_id -> {count, has_ai_suggestion}
    if item_ids and is_owner:
        dist_result = await db.execute(
            select(
                SurferGalleryItem.gallery_item_id,
                func.count(SurferGalleryItem.id).label('count'),
                func.sum(case((SurferGalleryItem.ai_suggested == True, 1), else_=0)).label('ai_count'),
                func.sum(case((SurferGalleryItem.surfer_confirmed == True, 1), else_=0)).label('confirmed_count')
            )
            .where(SurferGalleryItem.gallery_item_id.in_(item_ids))
            .group_by(SurferGalleryItem.gallery_item_id)
        )
        for row in dist_result.fetchall():
            distribution_map[row[0]] = {
                "distributed_count": row[1],
                "ai_suggested_count": row[2],
                "confirmed_count": row[3]
            }
    
    # Batch-load tagged surfer profiles for avatar chips on grid
    tagged_surfers_map = {}
    if is_owner and item_ids:
        tagged_result = await db.execute(
            select(SurferGalleryItem.gallery_item_id, SurferGalleryItem.surfer_id, 
                   SurferGalleryItem.access_type, Profile.full_name, Profile.avatar_url)
            .join(Profile, SurferGalleryItem.surfer_id == Profile.id)
            .where(SurferGalleryItem.gallery_item_id.in_(item_ids))
        )
        for row in tagged_result.fetchall():
            item_id = row[0]
            if item_id not in tagged_surfers_map:
                tagged_surfers_map[item_id] = []
            tagged_surfers_map[item_id].append({
                "surfer_id": row[1],
                "access_type": row[2],
                "full_name": row[3],
                "avatar_url": row[4]
            })
    
    items = []
    for item in gallery.items:
        # Gallery owner can always see all items (including private/draft ones)
        # Public viewers only see items marked is_public
        if is_owner or item.is_public:
            item_dist = distribution_map.get(item.id, {})
            item_tagged = tagged_surfers_map.get(item.id, [])
            items.append({
                "id": item.id,
                "preview_url": item.preview_url,
                "thumbnail_url": item.thumbnail_url,
                "media_type": item.media_type or "image",
                "title": item.title,
                "description": item.description,
                "tags": item.tags,
                "price": item.price,
                "custom_price": item.custom_price,
                "is_for_sale": item.is_for_sale,
                "is_public": item.is_public,
                "is_featured": item.is_featured,
                "view_count": item.view_count,
                "purchase_count": item.purchase_count,
                "tagged_surfer_ids": item.tagged_surfer_ids,
                "tagged_surfers": item_tagged,  # Full surfer profiles for avatar chips
                "is_purchased": item.id in purchased_ids,
                "created_at": item.created_at.isoformat(),
                # Phase 4: Distribution status per item
                "distributed_count": item_dist.get('distributed_count', 0),
                "ai_suggested_count": item_dist.get('ai_suggested_count', 0),
                "confirmed_count": item_dist.get('confirmed_count', 0)
            })
    
    return {
        "id": gallery.id,
        "photographer_id": gallery.photographer_id,
        "photographer_name": gallery.photographer.full_name if gallery.photographer else None,
        "photographer_avatar": gallery.photographer.avatar_url if gallery.photographer else None,
        "title": gallery.title,
        "description": gallery.description,
        "cover_image_url": gallery.cover_image_url,
        "surf_spot_name": gallery.surf_spot.name if gallery.surf_spot else None,
        "item_count": len(items),
        "view_count": gallery.view_count,
        "purchase_count": gallery.purchase_count,
        "is_public": gallery.is_public,
        "session_date": gallery.session_date.isoformat() if gallery.session_date else None,
        "session_type": gallery.session_type,
        "live_session_id": gallery.live_session_id,
        "booking_id": gallery.booking_id,
        "dispatch_id": gallery.dispatch_id,
        "created_at": gallery.created_at.isoformat(),
        "pricing": {
            "photo": {
                "web": gallery.price_web,
                "standard": gallery.price_standard,
                "high": gallery.price_high
            },
            "video": {
                "720p": gallery.price_720p,
                "1080p": gallery.price_1080p,
                "4k": gallery.price_4k
            }
        },
        "session_settings": _build_session_settings(gallery),
        "photographer_pricing": _build_photographer_pricing(gallery.photographer) if gallery.photographer else None,
        "items": items
    }


@router.put("/galleries/{gallery_id}")
async def update_gallery(
    gallery_id: str,
    photographer_id: str,
    data: GalleryUpdate,
    db: AsyncSession = Depends(get_db)
):
    """Update gallery details and pricing"""
    
    result = await db.execute(select(Gallery).where(Gallery.id == gallery_id))
    gallery = result.scalar_one_or_none()
    
    if not gallery:
        raise HTTPException(status_code=404, detail="Gallery not found")
    
    if gallery.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    # Update fields
    if data.title is not None:
        gallery.title = data.title
    if data.description is not None:
        gallery.description = data.description
    if data.cover_image_url is not None:
        gallery.cover_image_url = data.cover_image_url
    if data.is_public is not None:
        gallery.is_public = data.is_public
    if data.is_featured is not None:
        gallery.is_featured = data.is_featured
    
    # Update pricing
    if data.price_web is not None:
        gallery.price_web = data.price_web
    if data.price_standard is not None:
        gallery.price_standard = data.price_standard
    if data.price_high is not None:
        gallery.price_high = data.price_high
    if data.price_720p is not None:
        gallery.price_720p = data.price_720p
    if data.price_1080p is not None:
        gallery.price_1080p = data.price_1080p
    if data.price_4k is not None:
        gallery.price_4k = data.price_4k
    
    await db.commit()
    
    return {
        "message": "Gallery updated",
        "pricing": {
            "photo": {
                "web": gallery.price_web,
                "standard": gallery.price_standard,
                "high": gallery.price_high
            },
            "video": {
                "720p": gallery.price_720p,
                "1080p": gallery.price_1080p,
                "4k": gallery.price_4k
            }
        }
    }


@router.patch("/galleries/{gallery_id}/session-settings")
async def update_session_settings(
    gallery_id: str,
    photographer_id: str,
    body: dict = Body(...),
    db: AsyncSession = Depends(get_db)
):
    """
    Update session-level content settings (photos/videos included).
    For live sessions → updates the LiveSession record directly.
    For bookings/on-demand → updates the photographer profile defaults.
    """
    result = await db.execute(
        select(Gallery)
        .where(Gallery.id == gallery_id)
        .options(selectinload(Gallery.live_session), selectinload(Gallery.photographer))
    )
    gallery = result.scalar_one_or_none()
    
    if not gallery:
        raise HTTPException(status_code=404, detail="Gallery not found")
    if gallery.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    photos_included = body.get("photos_included")
    videos_included = body.get("videos_included")
    
    updated_target = "unknown"
    
    if gallery.live_session_id and gallery.live_session:
        # Update the actual LiveSession record
        ls = gallery.live_session
        if photos_included is not None:
            ls.photos_included = int(photos_included)
        if videos_included is not None:
            ls.videos_included = int(videos_included)
        updated_target = "live_session"
    elif gallery.booking_id and gallery.photographer:
        p = gallery.photographer
        if photos_included is not None:
            p.booking_photos_included = int(photos_included)
        if videos_included is not None:
            p.booking_videos_included = int(videos_included)
        updated_target = "booking_profile"
    elif gallery.dispatch_id and gallery.photographer:
        p = gallery.photographer
        if photos_included is not None:
            p.on_demand_photos_included = int(photos_included)
        if videos_included is not None:
            p.on_demand_videos_included = int(videos_included)
        updated_target = "on_demand_profile"
    else:
        raise HTTPException(status_code=400, detail="No linked session to update")
    
    await db.commit()
    
    return {
        "message": "Session settings updated",
        "updated_target": updated_target,
        "photos_included": photos_included,
        "videos_included": videos_included
    }


@router.delete("/galleries/{gallery_id}")
async def delete_gallery(
    gallery_id: str,
    photographer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Delete a gallery and its items, plus any linked condition reports"""
    
    result = await db.execute(select(Gallery).where(Gallery.id == gallery_id))
    gallery = result.scalar_one_or_none()
    
    if not gallery:
        raise HTTPException(status_code=404, detail="Gallery not found")
    
    if gallery.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    # Cascade: delete linked condition reports
    deleted_reports = 0
    if gallery.live_session_id:
        # Delete all condition reports linked to this live session
        cr_result = await db.execute(
            select(ConditionReport).where(ConditionReport.live_session_id == gallery.live_session_id)
        )
        for cr in cr_result.scalars().all():
            await db.delete(cr)
            deleted_reports += 1
    
    # Also clean up any condition reports from this photographer at this spot
    # that were created around the same time as the gallery (within 24 hours)
    if gallery.surf_spot_id:
        from datetime import timedelta
        window_start = gallery.created_at - timedelta(hours=1) if gallery.created_at else None
        window_end = gallery.created_at + timedelta(hours=24) if gallery.created_at else None
        if window_start and window_end:
            cr_spot_result = await db.execute(
                select(ConditionReport).where(
                    ConditionReport.photographer_id == photographer_id,
                    ConditionReport.spot_id == gallery.surf_spot_id,
                    ConditionReport.created_at >= window_start,
                    ConditionReport.created_at <= window_end
                )
            )
            for cr in cr_spot_result.scalars().all():
                await db.delete(cr)
                deleted_reports += 1
    
    await db.delete(gallery)
    await db.commit()
    
    return {"message": "Gallery deleted", "condition_reports_deleted": deleted_reports}


@router.get("/galleries/{gallery_id}/items")
async def get_gallery_items(
    gallery_id: str,
    viewer_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """Get all items in a gallery"""
    # Verify gallery exists
    result = await db.execute(select(Gallery).where(Gallery.id == gallery_id))
    gallery = result.scalar_one_or_none()
    
    if not gallery:
        raise HTTPException(status_code=404, detail="Gallery not found")
    
    # Get items in this gallery
    result = await db.execute(
        select(GalleryItem)
        .where(GalleryItem.gallery_id == gallery_id)
        .where(GalleryItem.is_public == True)
        .where(GalleryItem.is_deleted == False)
        .options(selectinload(GalleryItem.photographer), selectinload(GalleryItem.spot))
        .order_by(GalleryItem.created_at.desc())
    )
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
        "photographer_id": item.photographer_id,
        "photographer_name": item.photographer.full_name if item.photographer else None,
        "spot_id": item.spot_id,
        "spot_name": item.spot.name if item.spot else None,
        "original_url": item.original_url if item.id in purchased_ids else None,
        "preview_url": item.preview_url,
        "thumbnail_url": item.thumbnail_url,
        "media_type": item.media_type or 'image',
        "title": item.title,
        "description": item.description,
        "tags": json.loads(item.tags) if item.tags else None,
        "price": item.price,
        "custom_price": item.custom_price,
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


@router.post("/galleries/{gallery_id}/items")
async def add_item_to_gallery(
    gallery_id: str,
    photographer_id: str,
    data: GalleryItemCreate,
    db: AsyncSession = Depends(get_db)
):
    """Add an item to a specific gallery"""
    
    # Verify gallery ownership
    result = await db.execute(select(Gallery).where(Gallery.id == gallery_id))
    gallery = result.scalar_one_or_none()
    
    if not gallery:
        raise HTTPException(status_code=404, detail="Gallery not found")
    
    if gallery.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    # Get photographer profile to check role
    profile_result = await db.execute(select(Profile).where(Profile.id == photographer_id))
    photographer = profile_result.scalar_one_or_none()
    
    # GROM PARENT ISOLATION: Force for_sale=false for personal capture only
    is_grom_parent = bool(photographer) and is_grom_parent_eligible(photographer)
    effective_for_sale = False if is_grom_parent else data.is_for_sale
    effective_price = 0 if is_grom_parent else data.price
    
    # Create item linked to gallery
    item = GalleryItem(
        photographer_id=photographer_id,
        gallery_id=gallery_id,
        spot_id=gallery.surf_spot_id or data.spot_id,
        original_url=data.original_url,
        preview_url=data.preview_url,
        thumbnail_url=data.thumbnail_url,
        media_type=data.media_type,
        title=data.title,
        description=data.description,
        tags=json.dumps(data.tags) if data.tags else None,
        price=effective_price,
        is_for_sale=effective_for_sale,
        tagged_surfer_ids=json.dumps(data.tagged_surfer_ids) if data.tagged_surfer_ids else None,
        shot_at=data.shot_at,
        video_width=data.video_width,
        video_height=data.video_height,
        video_duration=data.video_duration
    )
    
    db.add(item)
    
    # Update gallery stats
    gallery.item_count += 1
    
    # Auto-thumbnail sync logic:
    # 1. If gallery has no cover yet, set from this item
    # 2. If gallery is linked to an active live session, always update cover
    #    to the latest item (keeps conditions report / latest media as thumbnail)
    item_thumbnail = data.preview_url or data.thumbnail_url
    if item_thumbnail:
        if not gallery.cover_image_url:
            gallery.cover_image_url = item_thumbnail
        elif gallery.live_session_id:
            # Live session galleries: always update cover to latest upload
            # This ensures conditions report photos sync as the folder thumbnail
            try:
                ls_result = await db.execute(
                    select(LiveSession).where(LiveSession.id == gallery.live_session_id)
                )
                live_session = ls_result.scalar_one_or_none()
                if live_session and live_session.status in ('active', 'shooting', 'live'):
                    gallery.cover_image_url = item_thumbnail
                    gallery_logger.info(
                        f"Live session auto-thumbnail sync: gallery {gallery_id} cover updated to latest upload"
                    )
            except Exception as e:
                gallery_logger.warning(f"Live session thumbnail sync check failed: {e}")
    
    await db.commit()
    await db.refresh(item)
    
    # Notify tagged surfers
    if data.tagged_surfer_ids:
        for surfer_id in data.tagged_surfer_ids:
            notification = Notification(
                user_id=surfer_id,
                type='photo_tagged',
                title='You were tagged in a photo!',
                body=f'Check out the photo in {gallery.title}',
                data=json.dumps({
                    "gallery_item_id": item.id,
                    "gallery_id": gallery_id,
                    "photographer_id": photographer_id
                })
            )
            db.add(notification)
        await db.commit()
    
    return {
        "id": item.id,
        "gallery_id": gallery_id,
        "preview_url": item.preview_url,
        "message": "Item added to gallery"
    }



@router.delete("/galleries/{gallery_id}/items/{item_id}")
async def remove_item_from_gallery(
    gallery_id: str,
    item_id: str,
    photographer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Delete an item from a gallery (photographer only)"""
    # Verify gallery ownership
    result = await db.execute(select(Gallery).where(Gallery.id == gallery_id))
    gallery = result.scalar_one_or_none()
    
    if not gallery:
        raise HTTPException(status_code=404, detail="Gallery not found")
    
    if gallery.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized to modify this gallery")
    
    # Verify item exists in this gallery
    item_check = await db.execute(
        select(GalleryItem).where(
            GalleryItem.id == item_id,
            GalleryItem.gallery_id == gallery_id
        )
    )
    item = item_check.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found in this gallery")
    
    # Safe delete (protects paid surfer locker items)
    result = await safe_delete_gallery_item(db, item_id, photographer_id)
    
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    
    # Update gallery stats
    gallery.item_count = max(0, gallery.item_count - 1)
    
    await db.commit()
    
    return {**result, "gallery_id": gallery_id, "item_id": item_id}


# ============ CROSS-PROFILE TAGGING (Parent → Grom) ============

class GromTagRequest(BaseModel):
    gallery_item_id: str
    grom_id: str


@router.post("/gallery/tag-grom")
async def tag_grom_in_photo(
    data: GromTagRequest,
    parent_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Allow a Grom Parent to tag their linked Grom in a photo.
    Creates a PhotoTag record for cross-profile sync.
    """
    from models import PhotoTag
    from sqlalchemy.orm.attributes import flag_modified
    
    # Verify parent is a Grom Parent
    parent_result = await db.execute(select(Profile).where(Profile.id == parent_id))
    parent = parent_result.scalar_one_or_none()
    
    if not parent:
        raise HTTPException(status_code=404, detail="Parent profile not found")
    
    if not is_grom_parent_eligible(parent):
        raise HTTPException(status_code=403, detail="Only Grom Parents can tag Groms in photos")
    
    # Get linked Grom and verify it's the parent's linked Grom
    grom_result = await db.execute(select(Profile).where(Profile.id == data.grom_id))
    grom = grom_result.scalar_one_or_none()
    
    if not grom:
        raise HTTPException(status_code=404, detail="Grom profile not found")
    
    if grom.parent_id != parent_id:
        raise HTTPException(status_code=403, detail="You can only tag your linked Grom")
    
    if grom.role != RoleEnum.GROM:
        raise HTTPException(status_code=400, detail="Target user is not a Grom")
    
    # Get the gallery item and verify parent owns it
    item_result = await db.execute(select(GalleryItem).where(GalleryItem.id == data.gallery_item_id))
    item = item_result.scalar_one_or_none()
    
    if not item:
        raise HTTPException(status_code=404, detail="Photo not found")
    
    if item.photographer_id != parent_id:
        raise HTTPException(status_code=403, detail="You can only tag Groms in your own photos")
    
    # Check if already tagged
    existing_tag_result = await db.execute(
        select(PhotoTag).where(
            PhotoTag.gallery_item_id == data.gallery_item_id,
            PhotoTag.surfer_id == data.grom_id
        )
    )
    existing_tag = existing_tag_result.scalar_one_or_none()
    
    if existing_tag:
        raise HTTPException(status_code=400, detail="Grom is already tagged in this photo")
    
    # Create PhotoTag for cross-profile sync
    photo_tag = PhotoTag(
        gallery_item_id=data.gallery_item_id,
        surfer_id=data.grom_id,
        photographer_id=parent_id,
        access_granted=True,  # Parents give free access to their Grom
        is_gift=True,  # Mark as gift (no charge)
        session_photo_price=0.0  # No charge for Grom
    )
    db.add(photo_tag)
    
    # Also update the tagged_surfer_ids on the gallery item
    tagged_ids = json.loads(item.tagged_surfer_ids) if item.tagged_surfer_ids else []
    if data.grom_id not in tagged_ids:
        tagged_ids.append(data.grom_id)
        item.tagged_surfer_ids = json.dumps(tagged_ids)
    
    # Create notification for Grom
    notification = Notification(
        user_id=data.grom_id,
        type='grom_highlight',
        title="Your parent tagged you in a photo!",
        body=f"{parent.full_name} added a photo to your Grom Highlights",
        data=json.dumps({
            "gallery_item_id": data.gallery_item_id,
            "photographer_id": parent_id,
            "type": "grom_highlight"
        })
    )
    db.add(notification)
    
    await db.commit()
    
    return {
        "message": "Grom tagged successfully",
        "gallery_item_id": data.gallery_item_id,
        "grom_id": data.grom_id,
        "grom_name": grom.full_name
    }


@router.delete("/gallery/untag-grom/{gallery_item_id}/{grom_id}")
async def untag_grom_from_photo(
    gallery_item_id: str,
    grom_id: str,
    parent_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Remove Grom tag from a photo"""
    from models import PhotoTag
    
    # Verify parent owns the photo
    item_result = await db.execute(select(GalleryItem).where(GalleryItem.id == gallery_item_id))
    item = item_result.scalar_one_or_none()
    
    if not item:
        raise HTTPException(status_code=404, detail="Photo not found")
    
    if item.photographer_id != parent_id:
        raise HTTPException(status_code=403, detail="You can only untag from your own photos")
    
    # Find and delete the tag
    tag_result = await db.execute(
        select(PhotoTag).where(
            PhotoTag.gallery_item_id == gallery_item_id,
            PhotoTag.surfer_id == grom_id
        )
    )
    tag = tag_result.scalar_one_or_none()
    
    if tag:
        await db.delete(tag)
    
    # Update tagged_surfer_ids
    tagged_ids = json.loads(item.tagged_surfer_ids) if item.tagged_surfer_ids else []
    if grom_id in tagged_ids:
        tagged_ids.remove(grom_id)
        item.tagged_surfer_ids = json.dumps(tagged_ids) if tagged_ids else None
    
    await db.commit()
    
    return {"message": "Grom tag removed", "gallery_item_id": gallery_item_id}


@router.get("/gallery/grom-highlights/{parent_id}")
async def get_grom_highlights(
    parent_id: str,
    grom_id: Optional[str] = None,
    limit: int = 20,
    offset: int = 0,
    db: AsyncSession = Depends(get_db)
):
    """
    Get photos tagged with a parent's linked Grom(s).
    Used for the "Grom Highlights" section in parent's gallery.
    """
    from models import PhotoTag
    
    # Verify parent is a Grom Parent
    parent_result = await db.execute(select(Profile).where(Profile.id == parent_id))
    parent = parent_result.scalar_one_or_none()
    
    if not parent:
        raise HTTPException(status_code=404, detail="Parent profile not found")
    
    if not is_grom_parent_eligible(parent):
        raise HTTPException(status_code=403, detail="Only Grom Parents can view Grom Highlights")
    
    # If specific grom_id provided, use that; otherwise get all linked Groms
    if grom_id:
        # Verify grom is linked to this parent
        grom_result = await db.execute(select(Profile).where(Profile.id == grom_id, Profile.parent_id == parent_id))
        grom = grom_result.scalar_one_or_none()
        if not grom:
            raise HTTPException(status_code=403, detail="Grom is not linked to this parent")
        grom_ids = [grom_id]
    else:
        # Get all linked Groms
        groms_result = await db.execute(select(Profile).where(Profile.parent_id == parent_id, Profile.role == RoleEnum.GROM))
        groms = groms_result.scalars().all()
        grom_ids = [g.id for g in groms]
    
    if not grom_ids:
        return {"items": [], "total": 0, "groms": []}
    
    # Get tagged photos for these Groms
    query = (
        select(GalleryItem, PhotoTag)
        .join(PhotoTag, PhotoTag.gallery_item_id == GalleryItem.id)
        .where(PhotoTag.surfer_id.in_(grom_ids))
        .order_by(PhotoTag.tagged_at.desc())
        .limit(limit)
        .offset(offset)
    )
    
    result = await db.execute(query)
    rows = result.all()
    
    # Count total
    count_query = (
        select(func.count())
        .select_from(PhotoTag)
        .where(PhotoTag.surfer_id.in_(grom_ids))
    )
    count_result = await db.execute(count_query)
    total = count_result.scalar() or 0
    
    # Get grom info
    groms_info = []
    if not grom_id:
        groms_result = await db.execute(select(Profile).where(Profile.parent_id == parent_id, Profile.role == RoleEnum.GROM))
        groms = groms_result.scalars().all()
        groms_info = [{"id": g.id, "name": g.full_name, "avatar": g.avatar_url} for g in groms]
    
    # Build response
    items = []
    for item, tag in rows:
        items.append({
            "id": item.id,
            "original_url": item.original_url,
            "preview_url": item.preview_url,
            "thumbnail_url": item.thumbnail_url,
            "media_type": item.media_type,
            "title": item.title,
            "grom_id": tag.surfer_id,
            "tagged_at": tag.tagged_at.isoformat() if tag.tagged_at else None,
            "created_at": item.created_at.isoformat() if item.created_at else None
        })
    
    return {
        "items": items,
        "total": total,
        "groms": groms_info
    }


@router.get("/gallery/grom-profile-photos/{grom_id}")
async def get_grom_profile_photos(
    grom_id: str,
    viewer_id: Optional[str] = None,
    limit: int = 20,
    offset: int = 0,
    db: AsyncSession = Depends(get_db)
):
    """
    Get photos that a Grom is tagged in.
    This powers the "Tagged Photos" section on a Grom's profile.
    Only accessible by the Grom themselves, their linked parent, or admins.
    """
    from models import PhotoTag
    
    # Get the Grom
    grom_result = await db.execute(select(Profile).where(Profile.id == grom_id))
    grom = grom_result.scalar_one_or_none()
    
    if not grom:
        raise HTTPException(status_code=404, detail="Grom profile not found")
    
    if grom.role != RoleEnum.GROM:
        raise HTTPException(status_code=400, detail="Profile is not a Grom")
    
    # Check viewer authorization
    is_authorized = False
    if viewer_id:
        viewer_result = await db.execute(select(Profile).where(Profile.id == viewer_id))
        viewer = viewer_result.scalar_one_or_none()
        
        if viewer:
            is_authorized = (
                viewer.is_admin or
                viewer_id == grom_id or
                viewer_id == grom.parent_id
            )
    
    if not is_authorized:
        raise HTTPException(status_code=403, detail="Not authorized to view Grom's tagged photos")
    
    # Get tagged photos
    query = (
        select(GalleryItem, PhotoTag, Profile)
        .join(PhotoTag, PhotoTag.gallery_item_id == GalleryItem.id)
        .join(Profile, Profile.id == PhotoTag.photographer_id)
        .where(PhotoTag.surfer_id == grom_id, PhotoTag.access_granted.is_(True))
        .order_by(PhotoTag.tagged_at.desc())
        .limit(limit)
        .offset(offset)
    )
    
    result = await db.execute(query)
    rows = result.all()
    
    # Build response
    items = []
    for item, tag, photographer in rows:
        items.append({
            "id": item.id,
            "original_url": item.original_url,
            "preview_url": item.preview_url,
            "thumbnail_url": item.thumbnail_url,
            "media_type": item.media_type,
            "title": item.title,
            "photographer_id": photographer.id,
            "photographer_name": photographer.full_name,
            "photographer_avatar": photographer.avatar_url,
            "tagged_at": tag.tagged_at.isoformat() if tag.tagged_at else None,
            "is_gift": tag.is_gift
        })
    
    return {"items": items, "grom_name": grom.full_name}


@router.get("/gallery/linked-groms/{parent_id}")
async def get_linked_groms(
    parent_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Get all Groms linked to a parent.
    Used for the tagging dropdown in parent's gallery.
    """
    # Verify parent
    parent_result = await db.execute(select(Profile).where(Profile.id == parent_id))
    parent = parent_result.scalar_one_or_none()
    
    if not parent:
        raise HTTPException(status_code=404, detail="Parent profile not found")
    
    if not is_grom_parent_eligible(parent):
        raise HTTPException(status_code=403, detail="Only Grom Parents can view linked Groms")
    
    # Get linked Groms
    result = await db.execute(
        select(Profile)
        .where(Profile.parent_id == parent_id, Profile.role == RoleEnum.GROM)
        .order_by(Profile.full_name)
    )
    groms = result.scalars().all()
    
    return {
        "groms": [
            {
                "id": g.id,
                "name": g.full_name,
                "avatar": g.avatar_url,
                "is_approved": g.parent_link_approved
            }
            for g in groms
        ]
    }


# ============ AI LINEUP MATCH & INCLUDED PHOTOS INTEGRATION ============


class TriggerAIMatchRequest(BaseModel):
    gallery_id: Optional[str] = None
    booking_id: Optional[str] = None
    live_session_id: Optional[str] = None


@router.post("/gallery/trigger-ai-match")
async def trigger_ai_lineup_match(
    photographer_id: str,
    data: TriggerAIMatchRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Trigger AI lineup matching for a session's gallery items.
    Called after photographer finishes uploading photos to a session.
    
    This will:
    1. Run Vision API analysis on uploaded photos
    2. Match photos to session participants based on board/wetsuit/face
    3. Create SurferGalleryItems for each match
    4. Create selection quotas based on photographer's "photos included" setting
    """
    from services.ai_lineup_match import trigger_lineup_match_for_session
    
    # Verify photographer owns this gallery/session
    if data.gallery_id:
        gallery_result = await db.execute(
            select(Gallery)
            .where(Gallery.id == data.gallery_id)
            .options(selectinload(Gallery.live_session))
        )
        gallery = gallery_result.scalar_one_or_none()
        
        if not gallery or gallery.photographer_id != photographer_id:
            raise HTTPException(status_code=403, detail="Not authorized to access this gallery")
        
        session_id = gallery.live_session_id
        session_type = 'live_session'
        booking_id = None
        live_session = gallery.live_session
    elif data.booking_id:
        booking_result = await db.execute(
            select(Booking).where(Booking.id == data.booking_id)
        )
        booking = booking_result.scalar_one_or_none()
        
        if not booking or booking.photographer_id != photographer_id:
            raise HTTPException(status_code=403, detail="Not authorized to access this booking")
        
        session_id = data.booking_id
        session_type = 'booking'
        booking_id = data.booking_id
        live_session = None
    elif data.live_session_id:
        session_result = await db.execute(
            select(LiveSession).where(LiveSession.id == data.live_session_id)
        )
        live_session = session_result.scalar_one_or_none()
        
        if not live_session or live_session.photographer_id != photographer_id:
            raise HTTPException(status_code=403, detail="Not authorized to access this session")
        
        session_id = data.live_session_id
        session_type = 'live_session'
        booking_id = None
    else:
        raise HTTPException(status_code=400, detail="Must provide gallery_id, booking_id, or live_session_id")
    
    # Get photographer settings for "photos included"
    photographer_result = await db.execute(select(Profile).where(Profile.id == photographer_id))
    photographer = photographer_result.scalar_one_or_none()
    
    # Determine photos included based on session type
    photos_included = 0
    gallery_tier = GalleryTierEnum.STANDARD
    
    if session_type == 'booking' and booking_id:
        booking_result = await db.execute(select(Booking).where(Booking.id == booking_id))
        booking = booking_result.scalar_one_or_none()
        if booking:
            photos_included = booking.booking_photos_included or photographer.booking_photos_included or 0
            gallery_tier = GalleryTierEnum.PRO if booking.booking_type == 'scheduled' else GalleryTierEnum.STANDARD
    elif live_session:
        photos_included = live_session.photos_included or photographer.live_session_photos_included or 0
        gallery_tier = GalleryTierEnum.STANDARD  # Live sessions are always standard tier
    
    # Trigger AI matching
    ai_result = await trigger_lineup_match_for_session(session_id, session_type, db)
    
    if not ai_result.get('success'):
        # Continue without AI - will use manual tagging
        pass
    
    # Get participants to create selection quotas for
    participants = []
    if session_type == 'booking':
        part_result = await db.execute(
            select(BookingParticipant)
            .where(BookingParticipant.booking_id == booking_id)
            .options(selectinload(BookingParticipant.participant))
        )
        participants = [(p.participant_id, p.participant) for p in part_result.scalars().all() if p.participant]
    else:
        part_result = await db.execute(
            select(LiveSessionParticipant)
            .where(LiveSessionParticipant.live_session_id == session_id)
            .options(selectinload(LiveSessionParticipant.surfer))
        )
        participants = [(p.surfer_id, p.surfer) for p in part_result.scalars().all() if p.surfer]
    
    # Create selection quotas if photos_included > 0
    quotas_created = 0
    surfer_items_created = 0
    
    if photos_included > 0:
        selection_deadline = datetime.now(timezone.utc) + timedelta(days=7)
        
        for surfer_id, surfer in participants:
            # Check if quota already exists
            existing_quota = None
            if booking_id:
                existing_result = await db.execute(
                    select(SurferSelectionQuota).where(
                        SurferSelectionQuota.surfer_id == surfer_id,
                        SurferSelectionQuota.booking_id == booking_id
                    )
                )
                existing_quota = existing_result.scalar_one_or_none()
            else:
                existing_result = await db.execute(
                    select(SurferSelectionQuota).where(
                        SurferSelectionQuota.surfer_id == surfer_id,
                        SurferSelectionQuota.live_session_id == session_id
                    )
                )
                existing_quota = existing_result.scalar_one_or_none()
            
            if not existing_quota:
                quota = SurferSelectionQuota(
                    surfer_id=surfer_id,
                    photographer_id=photographer_id,
                    booking_id=booking_id if session_type == 'booking' else None,
                    live_session_id=session_id if session_type == 'live_session' else None,
                    photos_allowed=photos_included,
                    photos_selected=0,
                    videos_allowed=0,  # Future: could add video quota
                    videos_selected=0,
                    status='pending_selection',
                    selection_deadline=selection_deadline
                )
                db.add(quota)
                quotas_created += 1
    
    # Get gallery items from this session to create surfer gallery items
    if data.gallery_id:
        items_result = await db.execute(
            select(GalleryItem).where(GalleryItem.gallery_id == data.gallery_id)
        )
    elif booking_id:
        # Get items linked to this booking
        items_result = await db.execute(
            select(GalleryItem).where(GalleryItem.session_id == booking_id)
        )
    else:
        items_result = await db.execute(
            select(GalleryItem).where(GalleryItem.session_id == session_id)
        )
    
    gallery_items = items_result.scalars().all()
    
    # Create surfer gallery items for each participant
    for surfer_id, surfer in participants:
        for gi in gallery_items:
            # Check if already exists
            existing_item = await db.execute(
                select(SurferGalleryItem).where(
                    SurferGalleryItem.surfer_id == surfer_id,
                    SurferGalleryItem.gallery_item_id == gi.id
                )
            )
            if existing_item.scalar_one_or_none():
                continue
            
            # Determine access type based on photos_included
            if photos_included > 0:
                access_type = 'pending_selection'
                selection_eligible = True
            else:
                access_type = 'pending'
                selection_eligible = False
            
            # Determine quality limits
            max_photo_quality = 'high' if gallery_tier == GalleryTierEnum.PRO else 'standard'
            max_video_quality = '4k' if gallery_tier == GalleryTierEnum.PRO else '1080p'
            
            surfer_item = SurferGalleryItem(
                surfer_id=surfer_id,
                gallery_item_id=gi.id,
                photographer_id=photographer_id,
                booking_id=booking_id if session_type == 'booking' else None,
                live_session_id=session_id if session_type == 'live_session' else None,
                service_type=session_type,
                gallery_tier=gallery_tier,
                max_photo_quality=max_photo_quality,
                max_video_quality=max_video_quality,
                access_type=access_type,
                selection_eligible=selection_eligible,
                selection_deadline=datetime.now(timezone.utc) + timedelta(days=7) if selection_eligible else None,
                is_paid=False,
                ai_suggested=False,  # Will be updated by AI match results
                surfer_confirmed=False,
                spot_id=gi.spot_id
            )
            db.add(surfer_item)
            surfer_items_created += 1
    
    await db.commit()
    
    return {
        "success": True,
        "ai_match_result": ai_result,
        "quotas_created": quotas_created,
        "surfer_items_created": surfer_items_created,
        "photos_included_per_surfer": photos_included,
        "gallery_tier": gallery_tier.value
    }




# ============================================================
# PHASE 3: SALES INTELLIGENCE ENDPOINTS
# ============================================================

@router.get("/galleries/{gallery_id}/sales-dashboard")
async def get_gallery_sales_dashboard(
    gallery_id: str,
    photographer_id: str,
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db)
):
    """
    Get detailed sales data for a gallery.
    Returns: purchases with buyer info, quality tier, date, amount
    """
    # Verify ownership
    gallery = await db.execute(
        select(Gallery).where(Gallery.id == gallery_id).where(Gallery.photographer_id == photographer_id)
    )
    gallery = gallery.scalar_one_or_none()
    if not gallery:
        raise HTTPException(status_code=404, detail="Gallery not found")
    
    # Get all purchases for items in this gallery
    purchases_result = await db.execute(
        select(GalleryPurchase, GalleryItem, Profile)
        .join(GalleryItem, GalleryPurchase.gallery_item_id == GalleryItem.id)
        .join(Profile, GalleryPurchase.buyer_id == Profile.id)
        .where(GalleryItem.gallery_id == gallery_id)
        .order_by(GalleryPurchase.purchased_at.desc())
        .offset(offset)
        .limit(limit)
    )
    purchases = purchases_result.fetchall()
    
    # Get total revenue
    revenue_result = await db.execute(
        select(func.sum(GalleryPurchase.amount_paid))
        .join(GalleryItem, GalleryPurchase.gallery_item_id == GalleryItem.id)
        .where(GalleryItem.gallery_id == gallery_id)
    )
    total_revenue = revenue_result.scalar() or 0
    
    # Get total purchase count
    count_result = await db.execute(
        select(func.count())
        .select_from(GalleryPurchase)
        .join(GalleryItem, GalleryPurchase.gallery_item_id == GalleryItem.id)
        .where(GalleryItem.gallery_id == gallery_id)
    )
    total_purchases = count_result.scalar() or 0
    
    # Format response
    sales = []
    for purchase, item, buyer in purchases:
        sales.append({
            "id": str(purchase.id),
            "item_id": str(item.id),
            "item_thumbnail": item.thumbnail_url,
            "item_title": item.title,
            "buyer_id": str(buyer.id),
            "buyer_name": buyer.full_name,
            "buyer_avatar": buyer.avatar_url,
            "quality_tier": purchase.quality_tier,
            "amount": float(purchase.amount_paid),
            "purchased_at": purchase.purchased_at.isoformat() if purchase.purchased_at else None
        })
    
    return {
        "sales": sales,
        "stats": {
            "total_revenue": float(total_revenue),
            "total_purchases": total_purchases,
            "avg_sale": float(total_revenue / total_purchases) if total_purchases > 0 else 0
        },
        "pagination": {
            "offset": offset,
            "limit": limit,
            "has_more": len(sales) == limit
        }
    }


@router.get("/galleries/{gallery_id}/client-activity")
async def get_gallery_client_activity(
    gallery_id: str,
    photographer_id: str,
    limit: int = 50,
    db: AsyncSession = Depends(get_db)
):
    """
    Get client activity data for a gallery.
    Returns: unique viewers, who favorited items, recent activity
    """
    # Verify ownership
    gallery = await db.execute(
        select(Gallery).where(Gallery.id == gallery_id).where(Gallery.photographer_id == photographer_id)
    )
    gallery = gallery.scalar_one_or_none()
    if not gallery:
        raise HTTPException(status_code=404, detail="Gallery not found")
    
    # Get all gallery item IDs
    items_result = await db.execute(
        select(GalleryItem.id).where(GalleryItem.gallery_id == gallery_id)
    )
    item_ids = [row[0] for row in items_result.fetchall()]
    
    if not item_ids:
        return {
            "clients": [],
            "stats": {"unique_viewers": 0, "total_favorites": 0, "total_purchases": 0}
        }
    
    # Get surfer gallery items that reference these gallery items (viewers/buyers)
    surfer_items_result = await db.execute(
        select(SurferGalleryItem, Profile)
        .join(Profile, SurferGalleryItem.surfer_id == Profile.id)
        .where(SurferGalleryItem.gallery_item_id.in_(item_ids))
        .limit(limit)
    )
    surfer_items = surfer_items_result.fetchall()
    
    # Aggregate by client
    client_map = {}
    for sgi, profile in surfer_items:
        client_id = str(profile.id)
        if client_id not in client_map:
            client_map[client_id] = {
                "id": client_id,
                "name": profile.full_name,
                "avatar": profile.avatar_url,
                "items_count": 0,
                "favorites_count": 0,
                "purchased_count": 0,
                "last_activity": None
            }
        
        client_map[client_id]["items_count"] += 1
        if sgi.is_favorite:
            client_map[client_id]["favorites_count"] += 1
        if sgi.is_paid:
            client_map[client_id]["purchased_count"] += 1
        
        # Use paid_at as last activity indicator
        if sgi.paid_at:
            paid_at_str = sgi.paid_at.isoformat()
            if not client_map[client_id]["last_activity"] or paid_at_str > client_map[client_id]["last_activity"]:
                client_map[client_id]["last_activity"] = paid_at_str
    
    # Sort by activity
    clients = sorted(client_map.values(), key=lambda x: x["last_activity"] or "", reverse=True)
    
    # Calculate stats
    total_favorites = sum(c["favorites_count"] for c in clients)
    total_purchases = sum(c["purchased_count"] for c in clients)
    
    return {
        "clients": clients,
        "stats": {
            "unique_viewers": len(clients),
            "total_favorites": total_favorites,
            "total_purchases": total_purchases
        }
    }


@router.get("/photographer/{photographer_id}/sales-summary")
async def get_photographer_sales_summary(
    photographer_id: str,
    days: int = 30,
    db: AsyncSession = Depends(get_db)
):
    """
    Get overall sales summary for a photographer across all galleries.
    """
    # Verify photographer exists
    photographer = await db.execute(
        select(Profile).where(Profile.id == photographer_id)
    )
    photographer = photographer.scalar_one_or_none()
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    # Get sales from the last N days
    since_date = datetime.now(timezone.utc) - timedelta(days=days)
    
    # Total revenue
    revenue_result = await db.execute(
        select(func.sum(GalleryPurchase.amount_paid))
        .join(GalleryItem, GalleryPurchase.gallery_item_id == GalleryItem.id)
        .where(GalleryItem.photographer_id == photographer_id)
        .where(GalleryPurchase.purchased_at >= since_date)
    )
    period_revenue = revenue_result.scalar() or 0
    
    # All-time revenue
    all_time_result = await db.execute(
        select(func.sum(GalleryPurchase.amount_paid))
        .join(GalleryItem, GalleryPurchase.gallery_item_id == GalleryItem.id)
        .where(GalleryItem.photographer_id == photographer_id)
    )
    all_time_revenue = all_time_result.scalar() or 0
    
    # Purchase count for period
    count_result = await db.execute(
        select(func.count())
        .select_from(GalleryPurchase)
        .join(GalleryItem, GalleryPurchase.gallery_item_id == GalleryItem.id)
        .where(GalleryItem.photographer_id == photographer_id)
        .where(GalleryPurchase.purchased_at >= since_date)
    )
    period_purchases = count_result.scalar() or 0
    
    # Top selling items
    top_items_result = await db.execute(
        select(GalleryItem, func.count(GalleryPurchase.id).label('sales'))
        .join(GalleryPurchase, GalleryItem.id == GalleryPurchase.gallery_item_id)
        .where(GalleryItem.photographer_id == photographer_id)
        .group_by(GalleryItem.id)
        .order_by(func.count(GalleryPurchase.id).desc())
        .limit(5)
    )
    top_items = [
        {
            "id": str(item.id),
            "title": item.title,
            "thumbnail": item.thumbnail_url,
            "sales_count": sales
        }
        for item, sales in top_items_result.fetchall()
    ]
    
    return {
        "period_days": days,
        "period_revenue": float(period_revenue),
        "period_purchases": period_purchases,
        "all_time_revenue": float(all_time_revenue),
        "avg_sale_value": float(period_revenue / period_purchases) if period_purchases > 0 else 0,
        "top_items": top_items
    }



# ===================== TICKET-005: Bulk Purchase Endpoint =====================

class BulkPurchaseRequest(BaseModel):
    item_ids: List[str]
    quality_tiers: dict  # {item_id: tier_name}
    buyer_id: str


# Default discount tiers (can be overridden by photographer settings)
DEFAULT_DISCOUNT_TIERS = [
    {"min_items": 3, "discount": 0.10},
    {"min_items": 5, "discount": 0.15},
    {"min_items": 10, "discount": 0.20}
]


def calculate_bulk_discount(item_count: int, tiers: list = None) -> float:
    """Calculate discount percentage based on item count"""
    if tiers is None:
        tiers = DEFAULT_DISCOUNT_TIERS
    
    # Sort by min_items descending
    sorted_tiers = sorted(tiers, key=lambda x: x.get("min_items", 0), reverse=True)
    
    for tier in sorted_tiers:
        if item_count >= tier.get("min_items", 0):
            return tier.get("discount", 0)
    
    return 0


@router.post("/gallery/bulk-purchase")
async def bulk_purchase_items(
    data: BulkPurchaseRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Purchase multiple gallery items at once with volume discount.
    
    Discount tiers:
    - 3+ items: 10% off
    - 5+ items: 15% off
    - 10+ items: 20% off
    
    Atomic transaction: all items succeed or none.
    """
    from models import CreditTransaction
    
    if not data.item_ids:
        raise HTTPException(status_code=400, detail="No items selected")
    
    # Get buyer
    buyer_result = await db.execute(
        select(Profile).where(Profile.id == data.buyer_id)
    )
    buyer = buyer_result.scalar_one_or_none()
    
    if not buyer:
        raise HTTPException(status_code=404, detail="Buyer not found")
    
    # Get all items
    items_result = await db.execute(
        select(GalleryItem)
        .where(GalleryItem.id.in_(data.item_ids))
        .options(selectinload(GalleryItem.photographer))
    )
    items = items_result.scalars().all()
    
    if len(items) != len(data.item_ids):
        found_ids = {item.id for item in items}
        missing = [id for id in data.item_ids if id not in found_ids]
        raise HTTPException(status_code=404, detail=f"Items not found: {missing}")
    
    # Check if any already purchased
    for item in items:
        existing = await db.execute(
            select(GalleryPurchase)
            .where(
                GalleryPurchase.item_id == item.id,
                GalleryPurchase.buyer_id == data.buyer_id
            )
        )
        if existing.scalar_one_or_none():
            raise HTTPException(
                status_code=400, 
                detail=f"Item already purchased: {item.title or item.id[:8]}"
            )
    
    # Calculate base total
    base_total = 0
    item_prices = {}
    
    for item in items:
        # Get tier price
        tier = data.quality_tiers.get(item.id, 'standard')
        
        if item.media_type == 'video':
            tier_prices = {
                '720p': item.price_720p or 8,
                '1080p': item.price_1080p or 15,
                '4k': item.price_4k or 30
            }
        else:
            tier_prices = {
                'web': item.price_web or 3,
                'standard': item.price_standard or item.price or 5,
                'high': item.price_high or 10
            }
        
        price = tier_prices.get(tier, item.price or 5)
        
        # Apply custom price if set
        if item.custom_price is not None:
            price = item.custom_price
        
        item_prices[item.id] = {
            "price": price,
            "tier": tier,
            "photographer_id": item.photographer_id
        }
        base_total += price
    
    # Calculate discount
    discount_rate = calculate_bulk_discount(len(items))
    discount_amount = base_total * discount_rate
    final_total = base_total - discount_amount
    
    # Check buyer credits
    if (buyer.credit_balance or 0) < final_total:
        raise HTTPException(
            status_code=400,
            detail=f"Insufficient credits. Need ${final_total:.2f}, have ${buyer.credit_balance or 0:.2f}"
        )
    
    # Atomic transaction
    try:
        # Deduct buyer credits
        buyer.credit_balance = (buyer.credit_balance or 0) - final_total
        
        # Create purchases and credit photographers
        purchases = []
        photographer_earnings = {}  # {photographer_id: total_earnings}
        
        for item in items:
            item_info = item_prices[item.id]
            price = item_info["price"]
            tier = item_info["tier"]
            photographer_id = item_info["photographer_id"]
            
            # Calculate photographer share (80%)
            photographer_share = price * 0.8
            
            # Create purchase record
            purchase = GalleryPurchase(
                id=str(uuid.uuid4()),
                item_id=item.id,
                buyer_id=data.buyer_id,
                photographer_id=photographer_id,
                price_paid=price,
                quality_tier=tier,
                platform_fee=price * 0.2,
                photographer_earnings=photographer_share,
                purchased_at=datetime.now(timezone.utc)
            )
            db.add(purchase)
            purchases.append(purchase)
            
            # Track photographer earnings
            if photographer_id not in photographer_earnings:
                photographer_earnings[photographer_id] = 0
            photographer_earnings[photographer_id] += photographer_share
            
            # Update item stats
            item.purchase_count = (item.purchase_count or 0) + 1
        
        # Credit photographers
        for photographer_id, earnings in photographer_earnings.items():
            photographer = await db.execute(
                select(Profile).where(Profile.id == photographer_id)
            )
            photographer = photographer.scalar_one_or_none()
            
            if photographer:
                photographer.credit_balance = (photographer.credit_balance or 0) + earnings
                
                # Create credit transaction
                credit_tx = CreditTransaction(
                    user_id=photographer_id,
                    amount=earnings,
                    transaction_type='bulk_gallery_sale',
                    description=f"Bulk sale: {len([p for p in purchases if p.photographer_id == photographer_id])} items",
                    reference_type='bulk_purchase',
                    reference_id=purchases[0].id,  # Reference first purchase
                    balance_after=photographer.credit_balance
                )
                db.add(credit_tx)
                
                # Broadcast earnings update
                await broadcast_earnings_update(
                    photographer_id,
                    {
                        "type": "bulk_sale",
                        "amount": earnings,
                        "item_count": len([p for p in purchases if p.photographer_id == photographer_id]),
                        "buyer_name": buyer.full_name or buyer.username
                    }
                )
        
        # Create buyer credit transaction
        buyer_tx = CreditTransaction(
            user_id=data.buyer_id,
            amount=-final_total,
            transaction_type='bulk_purchase',
            description=f"Bulk purchase: {len(items)} items ({discount_rate * 100:.0f}% discount)",
            reference_type='bulk_purchase',
            reference_id=purchases[0].id,
            balance_after=buyer.credit_balance
        )
        db.add(buyer_tx)
        
        await db.commit()
        
        return {
            "success": True,
            "purchase_count": len(purchases),
            "base_total": base_total,
            "discount_rate": discount_rate,
            "discount_amount": discount_amount,
            "final_total": final_total,
            "new_balance": buyer.credit_balance,
            "purchases": [
                {
                    "item_id": p.item_id,
                    "tier": p.quality_tier,
                    "price": p.price_paid
                }
                for p in purchases
            ]
        }
        
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Bulk purchase failed: {str(e)}")


@router.get("/gallery/item/{item_id}/quality-previews")
async def get_quality_previews(
    item_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Get preview URLs at different quality tiers for comparison.
    Used by QualityComparisonModal (TICKET-004).
    """
    result = await db.execute(
        select(GalleryItem).where(GalleryItem.id == item_id)
    )
    item = result.scalar_one_or_none()
    
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    
    # Build preview URLs for each tier
    # Note: In production, these would be pre-generated scaled versions
    previews = {}
    
    if item.media_type == 'video':
        previews = {
            '720p': {
                'url': item.preview_url or item.original_url,
                'resolution': '1280x720',
                'file_size': '~50MB/min'
            },
            '1080p': {
                'url': item.original_url,
                'resolution': '1920x1080', 
                'file_size': '~150MB/min'
            },
            '4k': {
                'url': item.url_4k or item.original_url,
                'resolution': '3840x2160',
                'file_size': '~400MB/min'
            }
        }
    else:
        previews = {
            'web': {
                'url': item.url_web or item.thumbnail_url or item.preview_url,
                'dimensions': '800px max',
                'file_size': '~200KB'
            },
            'standard': {
                'url': item.url_standard or item.preview_url or item.original_url,
                'dimensions': '1920px max',
                'file_size': '~800KB'
            },
            'high': {
                'url': item.url_high or item.original_url,
                'dimensions': 'Full resolution',
                'file_size': '~2-5MB'
            }
        }
    
    return {
        "item_id": item_id,
        "media_type": item.media_type,
        "previews": previews
    }


# ============ OPERATIONAL ENDPOINTS ============

@router.post("/gallery/{gallery_id}/distribute")
async def trigger_gallery_distribution(
    gallery_id: str,
    photographer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Manually trigger distribution of all items in a gallery to session participants.
    Used for:
    - Re-running distribution after fixing participant status issues
    - Verifying the auto-distribution pipeline works end-to-end
    - Backfilling locker items for galleries uploaded before distribution was wired
    
    Idempotent: won't create duplicate SurferGalleryItems.
    """
    # Verify gallery exists and belongs to photographer
    result = await db.execute(
        select(Gallery).where(Gallery.id == gallery_id)
    )
    gallery = result.scalar_one_or_none()
    
    if not gallery:
        raise HTTPException(status_code=404, detail="Gallery not found")
    if gallery.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    # Must be a session-linked gallery
    if not gallery.live_session_id and not gallery.booking_id and not gallery.dispatch_id:
        raise HTTPException(
            status_code=400, 
            detail="Gallery is not linked to a session. Distribution only works for session galleries."
        )
    
    # Get all items in this gallery
    items_result = await db.execute(
        select(GalleryItem).where(
            GalleryItem.gallery_id == gallery_id,
            GalleryItem.is_deleted == False
        )
    )
    items = items_result.scalars().all()
    
    if not items:
        return {
            "message": "No items to distribute",
            "gallery_id": gallery_id,
            "total_items": 0,
            "total_distributed": 0
        }
    
    total_distributed = 0
    distribution_details = []
    
    for item in items:
        try:
            count = await distribute_gallery_item_to_participants(db, item.id, gallery)
            total_distributed += count
            distribution_details.append({
                "item_id": item.id,
                "media_type": item.media_type,
                "distributed_to": count
            })
        except Exception as e:
            gallery_logger.warning(f"Distribution failed for item {item.id}: {e}")
            distribution_details.append({
                "item_id": item.id,
                "error": str(e)
            })
    
    await db.commit()
    
    return {
        "message": f"Distributed {total_distributed} locker items across {len(items)} gallery items",
        "gallery_id": gallery_id,
        "session_type": gallery.session_type,
        "live_session_id": gallery.live_session_id,
        "total_items": len(items),
        "total_distributed": total_distributed,
        "details": distribution_details
    }


@router.get("/gallery/{gallery_id}/session-participants")
async def get_gallery_session_participants(
    gallery_id: str,
    photographer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Get all session participants for a gallery's linked session.
    Returns participant profiles with distribution status for each.
    Used by the photographer's distribution UI.
    """
    result = await db.execute(
        select(Gallery).where(Gallery.id == gallery_id)
    )
    gallery = result.scalar_one_or_none()
    
    if not gallery:
        raise HTTPException(status_code=404, detail="Gallery not found")
    if gallery.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    participants = []
    session_info = {
        "session_type": gallery.session_type,
        "live_session_id": gallery.live_session_id,
        "booking_id": gallery.booking_id,
        "dispatch_id": gallery.dispatch_id,
        "session_date": gallery.session_date.isoformat() if gallery.session_date else None,
        "is_linked": bool(gallery.live_session_id or gallery.booking_id or gallery.dispatch_id)
    }
    
    if gallery.live_session_id:
        # Get live session participants with profiles
        # Try matching by live_session_id first
        part_result = await db.execute(
            select(LiveSessionParticipant, Profile)
            .join(Profile, LiveSessionParticipant.surfer_id == Profile.id)
            .where(LiveSessionParticipant.live_session_id == gallery.live_session_id)
            .where(LiveSessionParticipant.status.notin_(['cancelled', 'refunded']))
        )
        rows = part_result.fetchall()
        
        # FALLBACK: If no participants found by live_session_id, some may have been
        # created via card payment path which doesn't set live_session_id.
        # Fall back to matching by photographer_id + approximate time window.
        if not rows:
            # Get the live session to find the photographer and time range
            from models import LiveSession as LS
            ls_result = await db.execute(
                select(LS).where(LS.id == gallery.live_session_id)
            )
            live_session = ls_result.scalar_one_or_none()
            
            if live_session:
                from datetime import timedelta
                # Look for participants of this photographer around the session time
                session_start = live_session.created_at
                if session_start:
                    time_start = session_start - timedelta(hours=1)
                    time_end = (live_session.ended_at or session_start) + timedelta(hours=6)
                    
                    part_result = await db.execute(
                        select(LiveSessionParticipant, Profile)
                        .join(Profile, LiveSessionParticipant.surfer_id == Profile.id)
                        .where(LiveSessionParticipant.photographer_id == live_session.photographer_id)
                        .where(LiveSessionParticipant.status.notin_(['cancelled', 'refunded']))
                        .where(LiveSessionParticipant.joined_at >= time_start)
                        .where(LiveSessionParticipant.joined_at <= time_end)
                    )
                    rows = part_result.fetchall()
        
        seen_surfer_ids = set()
        for participant, profile in rows:
            if profile.id in seen_surfer_ids:
                continue  # Skip duplicates
            seen_surfer_ids.add(profile.id)
            # Count how many items are distributed to this surfer from this gallery
            dist_count_result = await db.execute(
                select(func.count(SurferGalleryItem.id))
                .where(
                    SurferGalleryItem.surfer_id == profile.id,
                    SurferGalleryItem.gallery_item_id.in_(
                        select(GalleryItem.id).where(GalleryItem.gallery_id == gallery_id)
                    )
                )
            )
            distributed_count = dist_count_result.scalar() or 0
            
            # Retroactive credit fix: if 0 but participant paid, calculate from session
            effective_credits = participant.photos_credit_remaining or 0
            if effective_credits == 0 and participant.amount_paid and participant.amount_paid > 0:
                # Count ALL included items (photos + videos) since photos_included
                # covers all content types when videos_included is 0
                included_dist_result = await db.execute(
                    select(func.count(SurferGalleryItem.id)).where(
                        SurferGalleryItem.surfer_id == profile.id,
                        SurferGalleryItem.photographer_id == gallery.photographer_id,
                        SurferGalleryItem.access_type == 'included'
                    )
                )
                already_included = included_dist_result.scalar() or 0
                photos_included_setting = 3  # default
                videos_included_setting = 0  # default
                if gallery.live_session_id:
                    ls_result2 = await db.execute(
                        select(LiveSession).where(LiveSession.id == gallery.live_session_id)
                    )
                    ls2 = ls_result2.scalar_one_or_none()
                    if ls2:
                        photos_included_setting = ls2.photos_included or 3
                        raw_vid = getattr(ls2, 'videos_included', None)
                        videos_included_setting = raw_vid if raw_vid and raw_vid > 0 else 0
                # When videos_included=0, photos_included is a unified pool
                total_pool = photos_included_setting + videos_included_setting
                effective_credits = max(0, total_pool - already_included)
                # Repair the record
                if effective_credits > 0:
                    participant.photos_credit_remaining = effective_credits
            
            participants.append({
                "surfer_id": profile.id,
                "full_name": profile.full_name,
                "username": profile.username,
                "avatar_url": profile.avatar_url,
                "selfie_url": participant.selfie_url,
                "amount_paid": participant.amount_paid,
                "joined_at": participant.joined_at.isoformat() if participant.joined_at else None,
                "status": participant.status,
                "items_distributed": distributed_count,
                "photos_credit_remaining": effective_credits,
                "resolution_preference": participant.resolution_preference or 'standard',
                "payment_method": participant.payment_method
            })
    
    elif gallery.booking_id:
        part_result = await db.execute(
            select(BookingParticipant, Profile)
            .join(Profile, BookingParticipant.participant_id == Profile.id)
            .where(BookingParticipant.booking_id == gallery.booking_id)
            .where(BookingParticipant.status.in_(['confirmed', 'completed']))
        )
        for participant, profile in part_result.fetchall():
            dist_count_result = await db.execute(
                select(func.count(SurferGalleryItem.id))
                .where(
                    SurferGalleryItem.surfer_id == profile.id,
                    SurferGalleryItem.gallery_item_id.in_(
                        select(GalleryItem.id).where(GalleryItem.gallery_id == gallery_id)
                    )
                )
            )
            distributed_count = dist_count_result.scalar() or 0
            
            participants.append({
                "surfer_id": profile.id,
                "full_name": profile.full_name,
                "username": profile.username,
                "avatar_url": profile.avatar_url,
                "selfie_url": None,
                "amount_paid": getattr(participant, 'amount_paid', 0),
                "joined_at": participant.created_at.isoformat() if hasattr(participant, 'created_at') and participant.created_at else None,
                "status": participant.status,
                "items_distributed": distributed_count
            })
    
    elif gallery.dispatch_id:
        dispatch_result = await db.execute(
            select(DispatchRequest, Profile)
            .join(Profile, DispatchRequest.requester_id == Profile.id)
            .where(DispatchRequest.id == gallery.dispatch_id)
        )
        row = dispatch_result.first()
        if row:
            dispatch, profile = row
            dist_count_result = await db.execute(
                select(func.count(SurferGalleryItem.id))
                .where(
                    SurferGalleryItem.surfer_id == profile.id,
                    SurferGalleryItem.gallery_item_id.in_(
                        select(GalleryItem.id).where(GalleryItem.gallery_id == gallery_id)
                    )
                )
            )
            distributed_count = dist_count_result.scalar() or 0
            
            participants.append({
                "surfer_id": profile.id,
                "full_name": profile.full_name,
                "username": profile.username,
                "avatar_url": profile.avatar_url,
                "selfie_url": None,
                "amount_paid": getattr(dispatch, 'price', 0),
                "joined_at": dispatch.created_at.isoformat() if dispatch.created_at else None,
                "status": dispatch.status,
                "items_distributed": distributed_count
            })
    
    # Get total gallery items for distribution progress calculation
    item_count_result = await db.execute(
        select(func.count(GalleryItem.id)).where(
            GalleryItem.gallery_id == gallery_id,
            GalleryItem.is_deleted == False
        )
    )
    total_items = item_count_result.scalar() or 0
    
    return {
        "session": session_info,
        "participants": participants,
        "total_gallery_items": total_items
    }


class LinkSessionRequest(BaseModel):
    live_session_id: Optional[str] = None
    booking_id: Optional[str] = None
    dispatch_id: Optional[str] = None


@router.post("/gallery/{gallery_id}/link-session")
async def link_gallery_to_session(
    gallery_id: str,
    photographer_id: str,
    data: LinkSessionRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Retroactively link a gallery to a session (live, booking, or dispatch).
    This enables auto-distribution for galleries that were created manually
    or whose session link was lost.
    """
    result = await db.execute(
        select(Gallery).where(Gallery.id == gallery_id)
    )
    gallery = result.scalar_one_or_none()
    
    if not gallery:
        raise HTTPException(status_code=404, detail="Gallery not found")
    if gallery.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    if not data.live_session_id and not data.booking_id and not data.dispatch_id:
        raise HTTPException(status_code=400, detail="Must provide live_session_id, booking_id, or dispatch_id")
    
    # Validate the session exists and belongs to this photographer
    if data.live_session_id:
        ls_result = await db.execute(
            select(LiveSession).where(
                LiveSession.id == data.live_session_id,
                LiveSession.photographer_id == photographer_id
            )
        )
        ls = ls_result.scalar_one_or_none()
        if not ls:
            raise HTTPException(status_code=404, detail="Live session not found or not yours")
        gallery.live_session_id = data.live_session_id
        gallery.session_type = 'live'
        if ls.surf_spot_id and not gallery.surf_spot_id:
            gallery.surf_spot_id = ls.surf_spot_id
        if ls.started_at and not gallery.session_date:
            gallery.session_date = ls.started_at
    
    elif data.booking_id:
        bk_result = await db.execute(
            select(Booking).where(
                Booking.id == data.booking_id,
                Booking.photographer_id == photographer_id
            )
        )
        bk = bk_result.scalar_one_or_none()
        if not bk:
            raise HTTPException(status_code=404, detail="Booking not found or not yours")
        gallery.booking_id = data.booking_id
        gallery.session_type = 'booking'
    
    elif data.dispatch_id:
        dp_result = await db.execute(
            select(DispatchRequest).where(
                DispatchRequest.id == data.dispatch_id,
                DispatchRequest.photographer_id == photographer_id
            )
        )
        dp = dp_result.scalar_one_or_none()
        if not dp:
            raise HTTPException(status_code=404, detail="Dispatch request not found or not yours")
        gallery.dispatch_id = data.dispatch_id
        gallery.session_type = 'on_demand'
    
    await db.commit()
    
    return {
        "message": "Gallery linked to session successfully",
        "gallery_id": gallery_id,
        "session_type": gallery.session_type,
        "live_session_id": gallery.live_session_id,
        "booking_id": gallery.booking_id,
        "dispatch_id": gallery.dispatch_id
    }


class DistributeToSurferRequest(BaseModel):
    surfer_id: str
    access_type: str = 'pending_selection'  # 'pending_selection', 'included', 'gifted'


@router.post("/gallery/{gallery_id}/distribute-to-surfer")
async def distribute_gallery_to_surfer(
    gallery_id: str,
    photographer_id: str,
    data: DistributeToSurferRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Distribute ALL items in a gallery to a specific surfer's locker.
    Used for manual assignment when photographers want to push entire gallery
    contents to a surfer who was in the session.
    
    Idempotent: won't create duplicates for already-distributed items.
    """
    from services.gallery_sync import manually_assign_item_to_surfer
    
    result = await db.execute(
        select(Gallery).where(Gallery.id == gallery_id)
    )
    gallery = result.scalar_one_or_none()
    
    if not gallery:
        raise HTTPException(status_code=404, detail="Gallery not found")
    if gallery.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    # Verify surfer exists
    surfer_result = await db.execute(select(Profile).where(Profile.id == data.surfer_id))
    surfer = surfer_result.scalar_one_or_none()
    if not surfer:
        raise HTTPException(status_code=404, detail="Surfer not found")
    
    # Get all items in the gallery
    items_result = await db.execute(
        select(GalleryItem).where(
            GalleryItem.gallery_id == gallery_id,
            GalleryItem.is_deleted == False
        )
    )
    items = items_result.scalars().all()
    
    if not items:
        return {
            "message": "No items to distribute",
            "gallery_id": gallery_id,
            "surfer_id": data.surfer_id,
            "items_distributed": 0
        }
    
    distributed_count = 0
    skipped_count = 0
    included_count = 0
    preview_count = 0
    
    # ── Credit-aware distribution ──
    # Look up participant's credit pool to determine access_type per item
    participant = None
    photos_included_setting = 3
    videos_included_setting = 0
    
    # Check if surfer is a session participant
    for Model, session_id_field in [
        (LiveSessionParticipant, 'live_session_id'),
        (BookingParticipant, 'booking_id'),
    ]:
        session_id = getattr(gallery, session_id_field, None)
        if session_id:
            p_result = await db.execute(
                select(Model).where(
                    Model.session_id == session_id if hasattr(Model, 'session_id') else getattr(Model, session_id_field.replace('_id', '_id')) == session_id,
                    Model.surfer_id == data.surfer_id
                )
            )
            participant = p_result.scalar_one_or_none()
            if participant:
                break
    
    # Get session settings for credit pool
    if gallery.live_session_id:
        ls_result = await db.execute(
            select(LiveSession).where(LiveSession.id == gallery.live_session_id)
        )
        ls = ls_result.scalar_one_or_none()
        if ls:
            photos_included_setting = ls.photos_included or 3
            raw_vid = getattr(ls, 'videos_included', None)
            videos_included_setting = raw_vid if raw_vid and raw_vid > 0 else 0
    
    total_credit_pool = photos_included_setting + videos_included_setting
    
    # Count already-included items for this surfer
    already_included_result = await db.execute(
        select(func.count(SurferGalleryItem.id)).where(
            SurferGalleryItem.surfer_id == data.surfer_id,
            SurferGalleryItem.photographer_id == photographer_id,
            SurferGalleryItem.access_type == 'included'
        )
    )
    already_included_count = already_included_result.scalar() or 0
    credits_available = max(0, total_credit_pool - already_included_count) if participant else 0
    
    for item in items:
        # Check if already distributed
        existing = await db.execute(
            select(SurferGalleryItem).where(
                SurferGalleryItem.surfer_id == data.surfer_id,
                SurferGalleryItem.gallery_item_id == item.id
            )
        )
        if existing.scalar_one_or_none():
            skipped_count += 1
            continue
        
        # Determine access_type based on remaining credits
        if credits_available > 0:
            item_access_type = 'included'
            credits_available -= 1
            included_count += 1
        else:
            item_access_type = data.access_type  # fallback to request default (pending_selection)
            preview_count += 1
        
        try:
            result = await manually_assign_item_to_surfer(
                db=db,
                gallery_item_id=item.id,
                surfer_id=data.surfer_id,
                photographer_id=photographer_id,
                access_type=item_access_type,
                gallery=gallery
            )
            distributed_count += 1
        except Exception as e:
            gallery_logger.warning(f"Failed to distribute item {item.id} to surfer {data.surfer_id}: {e}")
    
    await db.commit()
    
    # Send notification
    try:
        photographer_result = await db.execute(select(Profile).where(Profile.id == photographer_id))
        photographer = photographer_result.scalar_one_or_none()
        photographer_name = photographer.full_name if photographer else "Your photographer"
        
        notification = Notification(
            user_id=data.surfer_id,
            type='gallery_distributed',
            title=f'{distributed_count} new photos in your Locker!',
            body=f'{photographer_name} shared {distributed_count} photos/videos from your session. Check your Locker!',
            data=json.dumps({
                "type": "gallery_distributed",
                "gallery_id": gallery_id,
                "photographer_id": photographer_id,
                "items_count": distributed_count
            })
        )
        db.add(notification)
        await db.commit()
    except Exception as e:
        gallery_logger.warning(f"Failed to send distribution notification: {e}")
    
    return {
        "message": f"Distributed {distributed_count} items to {surfer.full_name}'s Locker ({included_count} included, {preview_count} preview)",
        "gallery_id": gallery_id,
        "surfer_id": data.surfer_id,
        "surfer_name": surfer.full_name,
        "items_distributed": distributed_count,
        "items_included": included_count,
        "items_preview": preview_count,
        "items_skipped": skipped_count,
        "total_items": len(items)
    }


class TagItemToSurferRequest(BaseModel):
    surfer_id: str
    item_id: str


@router.post("/gallery/{gallery_id}/tag-item")
async def tag_single_item_to_surfer(
    gallery_id: str,
    photographer_id: str,
    data: TagItemToSurferRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Tag a single gallery item to a specific surfer's locker.
    
    Access type is determined automatically based on payment:
    - If surfer has remaining photos_credit from buy-in → 'included' (full-res)
    - Otherwise → 'pending_selection' (watermarked preview, purchase to unlock)
    
    Idempotent: won't create duplicates.
    """
    from services.gallery_sync import manually_assign_item_to_surfer
    
    # Verify gallery ownership
    result = await db.execute(select(Gallery).where(Gallery.id == gallery_id))
    gallery = result.scalar_one_or_none()
    if not gallery:
        raise HTTPException(status_code=404, detail="Gallery not found")
    if gallery.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    # Verify item belongs to gallery
    item_result = await db.execute(
        select(GalleryItem).where(
            GalleryItem.id == data.item_id,
            GalleryItem.gallery_id == gallery_id
        )
    )
    item = item_result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found in this gallery")
    
    # Check if already tagged
    existing_result = await db.execute(
        select(SurferGalleryItem).where(
            SurferGalleryItem.surfer_id == data.surfer_id,
            SurferGalleryItem.gallery_item_id == data.item_id
        )
    )
    existing_item = existing_result.scalar_one_or_none()
    if existing_item:
        is_delivered = existing_item.access_type in ('included', 'purchased', 'gifted')
        return {
            "message": "Already delivered to this surfer" if is_delivered else "Already tagged to this surfer",
            "item_id": data.item_id,
            "surfer_id": data.surfer_id,
            "already_tagged": True,
            "is_delivered": is_delivered,
            "access_type": existing_item.access_type
        }
    
    # Determine access_type based on payment credits
    # Use the correct credit pool: photos vs videos
    access_type = 'pending_selection'  # default: watermarked preview
    is_video = item.media_type == 'video'
    
    # Check if surfer has credits from their session buy-in
    participant_result = await db.execute(
        select(LiveSessionParticipant).where(
            LiveSessionParticipant.surfer_id == data.surfer_id,
            LiveSessionParticipant.photographer_id == photographer_id,
            LiveSessionParticipant.status.notin_(['cancelled', 'refunded'])
        ).order_by(LiveSessionParticipant.joined_at.desc()).limit(1)
    )
    participant = participant_result.scalar_one_or_none()
    
    credits_remaining = 0
    if participant:
        if is_video:
            credits_remaining = participant.videos_credit_remaining or 0
        else:
            credits_remaining = participant.photos_credit_remaining or 0
        
        # Retroactive fix: if credits are 0 but participant paid and no items distributed yet,
        # calculate from session's photos/videos_included (handles legacy records)
        if credits_remaining == 0 and participant.amount_paid and participant.amount_paid > 0:
            # Count ALL already-included items (unified pool approach)
            dist_count_result = await db.execute(
                select(func.count(SurferGalleryItem.id))
                .where(
                    SurferGalleryItem.surfer_id == data.surfer_id,
                    SurferGalleryItem.photographer_id == photographer_id,
                    SurferGalleryItem.access_type == 'included'
                )
            )
            already_included_total = dist_count_result.scalar() or 0
            
            # Get included counts from session settings
            photos_included_setting = 3  # default
            videos_included_setting = 0  # default
            if gallery.live_session_id:
                ls_result = await db.execute(
                    select(LiveSession).where(LiveSession.id == gallery.live_session_id)
                )
                ls = ls_result.scalar_one_or_none()
                if ls:
                    photos_included_setting = getattr(ls, 'photos_included', 3) or 3
                    raw_vid = getattr(ls, 'videos_included', None)
                    videos_included_setting = raw_vid if raw_vid and raw_vid > 0 else 0
            
            # When videos_included=0, photos_included is a unified pool for all content
            total_pool = photos_included_setting + videos_included_setting
            retroactive_credits = max(0, total_pool - already_included_total)
            if retroactive_credits > 0:
                credits_remaining = retroactive_credits
                # Repair the record for future calls
                participant.photos_credit_remaining = credits_remaining
    
    if credits_remaining > 0:
        access_type = 'included'  # Full resolution — covered by buy-in
        # Decrement the correct credit pool
        if participant:
            if is_video:
                participant.videos_credit_remaining = max(0, credits_remaining - 1)
            else:
                participant.photos_credit_remaining = max(0, credits_remaining - 1)
    
    try:
        await manually_assign_item_to_surfer(
            db=db,
            gallery_item_id=data.item_id,
            surfer_id=data.surfer_id,
            photographer_id=photographer_id,
            access_type=access_type,
            gallery=gallery
        )
        
        # Update tagged_surfer_ids on the GalleryItem for grid display
        tagged_ids = json.loads(item.tagged_surfer_ids) if item.tagged_surfer_ids else []
        if data.surfer_id not in tagged_ids:
            tagged_ids.append(data.surfer_id)
            item.tagged_surfer_ids = json.dumps(tagged_ids)
        
        await db.commit()
        
        # Get surfer profile for response
        surfer_result = await db.execute(select(Profile).where(Profile.id == data.surfer_id))
        surfer = surfer_result.scalar_one_or_none()
        
        return {
            "message": f"Tagged to surfer as {access_type}",
            "item_id": data.item_id,
            "surfer_id": data.surfer_id,
            "surfer_name": surfer.full_name if surfer else "Unknown",
            "surfer_avatar": surfer.avatar_url if surfer else None,
            "access_type": access_type,
            "credits_remaining": participant.photos_credit_remaining if participant else 0,
            "already_tagged": False
        }
    except Exception as e:
        gallery_logger.error(f"Failed to tag item {data.item_id} to surfer {data.surfer_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to tag item: {str(e)}")



@router.get("/gallery/{gallery_id}/surfer-items/{surfer_id}")
async def get_surfer_tagged_items(
    gallery_id: str,
    surfer_id: str,
    photographer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Get all items tagged/distributed to a specific surfer in a gallery.
    Returns thumbnails, access_type, and surfer_gallery_item IDs for untag support.
    """
    # Verify gallery ownership
    result = await db.execute(select(Gallery).where(Gallery.id == gallery_id))
    gallery = result.scalar_one_or_none()
    if not gallery:
        raise HTTPException(status_code=404, detail="Gallery not found")
    if gallery.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    # Get all gallery items for this gallery
    items_result = await db.execute(
        select(GalleryItem).where(
            GalleryItem.gallery_id == gallery_id,
            GalleryItem.is_deleted == False
        )
    )
    gallery_items = items_result.scalars().all()
    gallery_item_ids = [i.id for i in gallery_items]
    gallery_item_lookup = {i.id: i for i in gallery_items}
    
    if not gallery_item_ids:
        return {"gallery_id": gallery_id, "surfer_id": surfer_id, "tagged_items": []}
    
    # Get all SurferGalleryItem records for this surfer in this gallery
    sgi_result = await db.execute(
        select(SurferGalleryItem).where(
            SurferGalleryItem.surfer_id == surfer_id,
            SurferGalleryItem.gallery_item_id.in_(gallery_item_ids)
        )
    )
    surfer_items = sgi_result.scalars().all()
    
    tagged_items = []
    for sgi in surfer_items:
        gi = gallery_item_lookup.get(sgi.gallery_item_id)
        if gi:
            tagged_items.append({
                "surfer_gallery_item_id": sgi.id,
                "gallery_item_id": gi.id,
                "preview_url": gi.preview_url,
                "thumbnail_url": gi.thumbnail_url,
                "original_url": gi.original_url,
                "media_type": gi.media_type,
                "access_type": sgi.access_type,
                "ai_suggested": sgi.ai_suggested,
                "surfer_confirmed": sgi.surfer_confirmed,
                "added_at": sgi.added_at.isoformat() if sgi.added_at else None
            })
    
    return {
        "gallery_id": gallery_id,
        "surfer_id": surfer_id,
        "tagged_items": tagged_items
    }


class UntagItemRequest(BaseModel):
    surfer_id: str
    item_id: str


@router.post("/gallery/{gallery_id}/untag-item")
async def untag_item_from_surfer(
    gallery_id: str,
    photographer_id: str,
    data: UntagItemRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Remove a tagged item from a surfer's locker.
    Restores the surfer's photo credit if the item was 'included' access.
    Also removes the surfer from the item's tagged_surfer_ids JSON.
    """
    # Verify gallery ownership
    result = await db.execute(select(Gallery).where(Gallery.id == gallery_id))
    gallery = result.scalar_one_or_none()
    if not gallery:
        raise HTTPException(status_code=404, detail="Gallery not found")
    if gallery.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    # Find the SurferGalleryItem
    sgi_result = await db.execute(
        select(SurferGalleryItem).where(
            SurferGalleryItem.surfer_id == data.surfer_id,
            SurferGalleryItem.gallery_item_id == data.item_id
        )
    )
    sgi = sgi_result.scalar_one_or_none()
    if not sgi:
        raise HTTPException(status_code=404, detail="Item not tagged to this surfer")
    
    was_included = sgi.access_type == 'included'
    
    # Delete the SurferGalleryItem
    await db.delete(sgi)
    
    # Remove surfer from tagged_surfer_ids on GalleryItem
    item_result = await db.execute(
        select(GalleryItem).where(GalleryItem.id == data.item_id)
    )
    item = item_result.scalar_one_or_none()
    if item and item.tagged_surfer_ids:
        tagged_ids = json.loads(item.tagged_surfer_ids)
        if data.surfer_id in tagged_ids:
            tagged_ids.remove(data.surfer_id)
            item.tagged_surfer_ids = json.dumps(tagged_ids) if tagged_ids else None
    
    # Restore credit if the item was 'included' (covered by buy-in)
    # Use the correct credit pool: photo vs video
    credits_restored = False
    is_video = item.media_type == 'video' if item else False
    if was_included:
        participant_result = await db.execute(
            select(LiveSessionParticipant).where(
                LiveSessionParticipant.surfer_id == data.surfer_id,
                LiveSessionParticipant.photographer_id == photographer_id,
                LiveSessionParticipant.status.notin_(['cancelled', 'refunded'])
            ).order_by(LiveSessionParticipant.joined_at.desc()).limit(1)
        )
        participant = participant_result.scalar_one_or_none()
        if participant:
            if is_video:
                participant.videos_credit_remaining = (participant.videos_credit_remaining or 0) + 1
            else:
                participant.photos_credit_remaining = (participant.photos_credit_remaining or 0) + 1
            credits_restored = True
    
    await db.commit()
    
    return {
        "message": "Item untagged from surfer",
        "item_id": data.item_id,
        "surfer_id": data.surfer_id,
        "credit_restored": credits_restored,
        "was_included": was_included
    }


@router.get("/gallery/{gallery_id}/distribution-status")
async def get_gallery_distribution_status(
    gallery_id: str,
    photographer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Get per-item distribution status for all items in a gallery.
    Shows how many surfers each item has been distributed to.
    """
    result = await db.execute(
        select(Gallery).where(Gallery.id == gallery_id)
    )
    gallery = result.scalar_one_or_none()
    
    if not gallery:
        raise HTTPException(status_code=404, detail="Gallery not found")
    if gallery.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    # Get all items with their distribution counts
    items_result = await db.execute(
        select(GalleryItem).where(
            GalleryItem.gallery_id == gallery_id,
            GalleryItem.is_deleted == False
        )
    )
    items = items_result.scalars().all()
    
    item_statuses = []
    for item in items:
        # Count distributions for this item
        dist_result = await db.execute(
            select(
                func.count(SurferGalleryItem.id),
                func.count(case(
                    (SurferGalleryItem.ai_suggested == True, 1),
                    else_=None
                )),
                func.count(case(
                    (SurferGalleryItem.surfer_confirmed == True, 1),
                    else_=None
                ))
            )
            .where(SurferGalleryItem.gallery_item_id == item.id)
        )
        row = dist_result.first()
        total_dist = row[0] if row else 0
        ai_suggested = row[1] if row else 0
        confirmed = row[2] if row else 0
        
        # Get surfer names who received this item
        surfers_result = await db.execute(
            select(SurferGalleryItem.surfer_id, Profile.full_name, Profile.avatar_url)
            .join(Profile, SurferGalleryItem.surfer_id == Profile.id)
            .where(SurferGalleryItem.gallery_item_id == item.id)
        )
        surfer_list = [
            {"surfer_id": r[0], "name": r[1], "avatar_url": r[2]}
            for r in surfers_result.fetchall()
        ]
        
        # Determine distribution status
        if total_dist == 0:
            status = "unassigned"
        elif confirmed > 0:
            status = "confirmed"
        elif ai_suggested > 0:
            status = "ai_suggested"
        else:
            status = "distributed"
        
        # Check tagged_surfer_ids for tag info
        tagged_ids = json.loads(item.tagged_surfer_ids) if item.tagged_surfer_ids else []
        
        item_statuses.append({
            "item_id": item.id,
            "media_type": item.media_type,
            "preview_url": item.preview_url,
            "status": status,
            "distributed_to": total_dist,
            "ai_suggested": ai_suggested,
            "confirmed": confirmed,
            "tagged_surfer_ids": tagged_ids,
            "surfers": surfer_list
        })
    
    return {
        "gallery_id": gallery_id,
        "session_type": gallery.session_type,
        "is_linked": bool(gallery.live_session_id or gallery.booking_id or gallery.dispatch_id),
        "items": item_statuses
    }


# ============ PUBLISH GALLERY TO PUBLIC ============

class PublishGalleryRequest(BaseModel):
    is_published: bool = True  # True to publish, False to unpublish


@router.post("/gallery/{gallery_id}/publish")
async def publish_gallery_to_public(
    gallery_id: str,
    photographer_id: str,
    data: PublishGalleryRequest = PublishGalleryRequest(),
    db: AsyncSession = Depends(get_db)
):
    """
    Publish or unpublish a gallery to the photographer's public profile.
    Published galleries appear on the Sessions tab of the photographer's profile
    and in the public gallery system for users to browse.
    """
    result = await db.execute(select(Gallery).where(Gallery.id == gallery_id))
    gallery = result.scalar_one_or_none()
    if not gallery:
        raise HTTPException(status_code=404, detail="Gallery not found")
    if gallery.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    gallery.is_public = data.is_published
    gallery.is_featured = data.is_published  # Mark as featured when published
    
    await db.commit()
    
    action = "published" if data.is_published else "unpublished"
    gallery_logger.info(f"Gallery {gallery_id} {action} by photographer {photographer_id}")
    
    return {
        "message": f"Gallery {action} successfully",
        "gallery_id": gallery_id,
        "is_public": gallery.is_public,
        "is_featured": gallery.is_featured
    }


@router.get("/photographer/{photographer_id}/public-galleries")
async def get_photographer_public_galleries(
    photographer_id: str,
    limit: int = 20,
    offset: int = 0,
    db: AsyncSession = Depends(get_db)
):
    """
    Get all published/public galleries for a photographer's profile.
    These show on the photographer's Sessions tab and are browsable by users.
    Returns gallery metadata, cover images, item counts, and session info.
    """
    result = await db.execute(
        select(Gallery)
        .where(
            Gallery.photographer_id == photographer_id,
            Gallery.is_public == True
        )
        .order_by(Gallery.session_date.desc().nullslast(), Gallery.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    galleries = result.scalars().all()
    
    public_galleries = []
    for g in galleries:
        # Get first few preview items for thumbnails
        items_result = await db.execute(
            select(GalleryItem)
            .where(GalleryItem.gallery_id == g.id, GalleryItem.is_deleted == False)
            .order_by(GalleryItem.created_at.asc())
            .limit(6)
        )
        preview_items = items_result.scalars().all()
        
        public_galleries.append({
            "id": g.id,
            "title": g.title,
            "description": g.description,
            "cover_image_url": g.cover_image_url or (preview_items[0].preview_url if preview_items else None),
            "session_type": g.session_type,
            "session_date": g.session_date.isoformat() if g.session_date else None,
            "item_count": g.item_count or len(preview_items),
            "is_featured": g.is_featured,
            "preview_items": [
                {
                    "id": item.id,
                    "preview_url": item.preview_url,
                    "thumbnail_url": item.thumbnail_url,
                    "media_type": item.media_type,
                }
                for item in preview_items
            ],
            "created_at": g.created_at.isoformat() if g.created_at else None,
        })
    
    return {
        "photographer_id": photographer_id,
        "galleries": public_galleries,
        "total": len(public_galleries)
    }


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


@router.delete("/gallery/cleanup-empty")
async def cleanup_empty_galleries(
    photographer_id: str,
    protect_gallery_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """
    Delete all empty galleries (item_count=0) for a photographer.
    Protects any gallery specified by protect_gallery_id.
    
    Designed to clean up leftover test galleries from development.
    """
    # Verify photographer exists
    profile_result = await db.execute(select(Profile).where(Profile.id == photographer_id))
    photographer = profile_result.scalar_one_or_none()
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    # Find all empty galleries for this photographer
    query = select(Gallery).where(
        Gallery.photographer_id == photographer_id,
        Gallery.item_count == 0
    )
    
    result = await db.execute(query)
    empty_galleries = result.scalars().all()
    
    deleted_ids = []
    protected_ids = []
    
    for gallery in empty_galleries:
        # Protect specified gallery
        if protect_gallery_id and gallery.id == protect_gallery_id:
            protected_ids.append(gallery.id)
            continue
        
        deleted_ids.append({
            "id": gallery.id,
            "title": gallery.title,
            "created_at": gallery.created_at.isoformat() if gallery.created_at else None
        })
        await db.delete(gallery)
    
    await db.commit()
    
    return {
        "message": f"Deleted {len(deleted_ids)} empty galleries",
        "deleted": deleted_ids,
        "protected": protected_ids,
        "remaining_empty": len(protected_ids)
    }


@router.post("/gallery/{gallery_id}/heal-urls")
async def heal_gallery_item_urls(
    gallery_id: str,
    photographer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Re-upload gallery items with ephemeral local URLs (/api/uploads/...) to Supabase.
    Fixes items that were uploaded before Supabase integration was working or
    when Supabase was temporarily unavailable.
    
    For each item with a local URL:
    1. Read the file from local disk (if it still exists)
    2. Upload to Supabase storage
    3. Update the GalleryItem URLs to point to Supabase
    """
    import os
    from pathlib import Path
    
    # Verify gallery ownership
    result = await db.execute(select(Gallery).where(Gallery.id == gallery_id))
    gallery = result.scalar_one_or_none()
    if not gallery:
        raise HTTPException(status_code=404, detail="Gallery not found")
    if gallery.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    # Get all items with local URLs
    items_result = await db.execute(
        select(GalleryItem).where(
            GalleryItem.gallery_id == gallery_id,
            GalleryItem.is_deleted == False
        )
    )
    items = items_result.scalars().all()
    
    # Try to import Supabase upload function
    try:
        from routes.uploads import upload_to_supabase_storage, UPLOAD_DIR
    except ImportError:
        raise HTTPException(status_code=500, detail="Supabase upload not available")
    
    healed = []
    failed = []
    skipped = []
    
    for item in items:
        # Check if URLs are local (ephemeral)
        urls_to_heal = {}
        if item.original_url and item.original_url.startswith('/api/uploads/'):
            urls_to_heal['original_url'] = item.original_url
        if item.preview_url and item.preview_url.startswith('/api/uploads/'):
            urls_to_heal['preview_url'] = item.preview_url
        if item.thumbnail_url and item.thumbnail_url.startswith('/api/uploads/'):
            urls_to_heal['thumbnail_url'] = item.thumbnail_url
        
        if not urls_to_heal:
            skipped.append({"item_id": item.id, "reason": "Already using persistent URLs"})
            continue
        
        item_healed = {"item_id": item.id, "healed_urls": {}}
        item_failed = False
        
        for field, local_url in urls_to_heal.items():
            # Convert API URL to filesystem path
            # /api/uploads/gallery/USER_ID/filename -> UPLOAD_DIR/gallery/USER_ID/filename
            relative_path = local_url.replace('/api/uploads/', '')
            local_path = UPLOAD_DIR / relative_path
            
            if not local_path.exists():
                failed.append({
                    "item_id": item.id,
                    "field": field,
                    "reason": f"Local file not found: {relative_path}"
                })
                item_failed = True
                continue
            
            # Determine content type
            ext = local_path.suffix.lower()
            content_types = {
                '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
                '.png': 'image/png', '.webp': 'image/webp',
                '.gif': 'image/gif', '.mp4': 'video/mp4',
                '.mov': 'video/mp4', '.webm': 'video/webm'
            }
            content_type = content_types.get(ext, 'application/octet-stream')
            
            # Upload to Supabase
            supabase_url = upload_to_supabase_storage(
                local_path, 'gallery',
                relative_path.replace('gallery/', '', 1) if relative_path.startswith('gallery/') else relative_path,
                content_type=content_type
            )
            
            if supabase_url:
                setattr(item, field, supabase_url)
                item_healed["healed_urls"][field] = supabase_url
            else:
                failed.append({
                    "item_id": item.id,
                    "field": field,
                    "reason": "Supabase upload failed"
                })
                item_failed = True
        
        if item_healed["healed_urls"]:
            healed.append(item_healed)
    
    # Also heal gallery cover image if it's local
    if gallery.cover_image_url and gallery.cover_image_url.startswith('/api/uploads/'):
        relative_path = gallery.cover_image_url.replace('/api/uploads/', '')
        local_path = UPLOAD_DIR / relative_path
        
        if local_path.exists():
            ext = local_path.suffix.lower()
            ct = 'image/jpeg' if ext in ('.jpg', '.jpeg') else 'image/png'
            supabase_url = upload_to_supabase_storage(
                local_path, 'conditions',
                relative_path.replace('conditions/', '', 1) if relative_path.startswith('conditions/') else relative_path,
                content_type=ct
            )
            if supabase_url:
                gallery.cover_image_url = supabase_url
                healed.append({"field": "gallery_cover", "healed_url": supabase_url})
    
    await db.commit()
    
    return {
        "message": f"Healed {len(healed)} items, {len(failed)} failed, {len(skipped)} already persistent",
        "gallery_id": gallery_id,
        "healed": healed,
        "failed": failed,
        "skipped": skipped
    }


@router.delete("/surfer-gallery/item/{surfer_gallery_item_id}")
async def remove_surfer_gallery_item(
    surfer_gallery_item_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Admin: Remove a specific item from a surfer's locker by its surfer_gallery_item ID."""
    result = await db.execute(
        select(SurferGalleryItem).where(SurferGalleryItem.id == surfer_gallery_item_id)
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Surfer gallery item not found")
    
    await db.delete(item)
    await db.commit()
    return {"deleted": True, "surfer_gallery_item_id": surfer_gallery_item_id}


@router.post("/gallery/{gallery_id}/recalculate-counts")
async def recalculate_gallery_counts(
    gallery_id: str,
    fix_cover: bool = True,
    db: AsyncSession = Depends(get_db)
):
    """Admin: Recalculate the cached item_count column and optionally fix the cover image.
    Use this when items were deleted but the count wasn't decremented.
    Also cleans up stale items with broken local/ephemeral URLs."""
    try:
        gallery = await db.get(Gallery, gallery_id)
        if not gallery:
            raise HTTPException(status_code=404, detail="Gallery not found")
        
        # Find and delete stale items with ephemeral local URLs
        from sqlalchemy import func, delete
        all_items_result = await db.execute(
            select(GalleryItem).where(GalleryItem.gallery_id == gallery_id)
        )
        all_items = all_items_result.scalars().all()
        
        stale_ids = []
        for item in all_items:
            has_supabase_thumb = item.thumbnail_url and item.thumbnail_url.startswith('https://')
            has_supabase_preview = item.preview_url and item.preview_url.startswith('https://')
            if not has_supabase_thumb and not has_supabase_preview:
                stale_ids.append(item.id)
        
        stale_count = 0
        delete_errors = []
        for item_id in stale_ids:
            try:
                await db.execute(
                    delete(GalleryItem).where(GalleryItem.id == item_id)
                )
                stale_count += 1
            except Exception as del_err:
                delete_errors.append(f"{item_id[:8]}: {str(del_err)[:50]}")
        
        if stale_count > 0:
            await db.flush()
        
        # Count actual remaining items
        count_result = await db.execute(
            select(func.count(GalleryItem.id)).where(GalleryItem.gallery_id == gallery_id)
        )
        actual_count = count_result.scalar() or 0
        old_count = gallery.item_count
        gallery.item_count = actual_count
        
        cover_fixed = False
        old_cover = gallery.cover_image_url
        
        # Fix cover image if it's a local path
        if fix_cover and (
            not gallery.cover_image_url or 
            gallery.cover_image_url.startswith('/api/uploads/')
        ):
            first_item_result = await db.execute(
                select(GalleryItem)
                .where(GalleryItem.gallery_id == gallery_id)
                .order_by(GalleryItem.created_at.desc())
                .limit(1)
            )
            first_item = first_item_result.scalar_one_or_none()
            if first_item:
                cover_url = first_item.thumbnail_url or first_item.preview_url
                if cover_url and cover_url.startswith('https://'):
                    gallery.cover_image_url = cover_url
                    cover_fixed = True
        
        await db.commit()
        
        result = {
            "gallery_id": gallery_id,
            "old_item_count": old_count,
            "new_item_count": actual_count,
            "stale_items_purged": stale_count,
            "cover_fixed": cover_fixed,
            "old_cover": old_cover,
            "new_cover": gallery.cover_image_url
        }
        if delete_errors:
            result["delete_errors"] = delete_errors
        return result
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        return {"error": str(e), "traceback": traceback.format_exc()}


# ═══════════════════════════════════════════════════════════════════
# ADMIN: Correct Session Content Settings
# ═══════════════════════════════════════════════════════════════════

class UpdateSessionSettingsRequest(BaseModel):
    photos_included: Optional[int] = None
    videos_included: Optional[int] = None


@router.patch("/gallery/{gallery_id}/session-settings")
async def update_session_settings(
    gallery_id: str,
    photographer_id: str = Query(..., description="Photographer ID for authorization"),
    data: UpdateSessionSettingsRequest = Body(...),
    db: AsyncSession = Depends(get_db)
):
    """
    Correct the photos_included / videos_included for a session's gallery.
    Updates the linked LiveSession, Booking, or DispatchRequest record.
    Only the gallery owner (photographer) can do this.
    """
    gallery_result = await db.execute(
        select(Gallery)
        .where(Gallery.id == gallery_id)
        .options(selectinload(Gallery.live_session))
    )
    gallery = gallery_result.scalar_one_or_none()
    
    if not gallery:
        raise HTTPException(status_code=404, detail="Gallery not found")
    if gallery.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    updated = {}
    
    if gallery.live_session_id and gallery.live_session:
        ls = gallery.live_session
        if data.photos_included is not None:
            old_val = ls.photos_included
            ls.photos_included = data.photos_included
            updated["photos_included"] = {"old": old_val, "new": data.photos_included}
        if data.videos_included is not None:
            old_val = ls.videos_included
            ls.videos_included = data.videos_included
            updated["videos_included"] = {"old": old_val, "new": data.videos_included}
    elif gallery.booking_id:
        bk_result = await db.execute(
            select(Booking).where(Booking.id == gallery.booking_id)
        )
        booking = bk_result.scalar_one_or_none()
        if booking and data.photos_included is not None:
            old_val = booking.booking_photos_included
            booking.booking_photos_included = data.photos_included
            updated["photos_included"] = {"old": old_val, "new": data.photos_included}
    else:
        raise HTTPException(status_code=400, detail="No linked session to update")
    
    if not updated:
        return {"message": "No changes made", "gallery_id": gallery_id}
    
    await db.commit()
    
    gallery_logger.info(
        f"Updated session settings for gallery {gallery_id}: {updated}"
    )
    
    return {
        "success": True,
        "gallery_id": gallery_id,
        "updated": updated,
        "message": "Session content settings updated. Roster will reflect changes on next load."
    }


class SetThumbnailRequest(BaseModel):
    item_id: Optional[str] = None
    thumbnail_url: Optional[str] = None  # Direct URL override (for conditions report sync)


@router.patch("/galleries/{gallery_id}/set-thumbnail")
async def set_gallery_thumbnail(
    gallery_id: str,
    photographer_id: str,
    data: SetThumbnailRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Manually set a gallery's cover thumbnail.
    
    Accepts either:
    - item_id: Use that item's preview/thumbnail as the cover
    - thumbnail_url: Direct URL to use as the cover
    
    This gives photographers full control over which image
    represents their session folder in the gallery hub.
    """
    result = await db.execute(
        select(Gallery).where(Gallery.id == gallery_id)
    )
    gallery = result.scalar_one_or_none()
    
    if not gallery:
        raise HTTPException(status_code=404, detail="Gallery not found")
    if gallery.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    new_cover_url = None
    
    if data.item_id:
        # Find the item and use its preview URL
        item_result = await db.execute(
            select(GalleryItem).where(
                GalleryItem.id == data.item_id,
                GalleryItem.photographer_id == photographer_id
            )
        )
        item = item_result.scalar_one_or_none()
        if not item:
            raise HTTPException(status_code=404, detail="Gallery item not found")
        
        new_cover_url = item.preview_url or item.thumbnail_url or item.original_url
    elif data.thumbnail_url:
        new_cover_url = data.thumbnail_url
    else:
        raise HTTPException(
            status_code=400, 
            detail="Must provide either item_id or thumbnail_url"
        )
    
    if not new_cover_url:
        raise HTTPException(status_code=400, detail="No valid thumbnail URL found for this item")
    
    old_cover = gallery.cover_image_url
    gallery.cover_image_url = new_cover_url
    
    # Sync to linked condition reports — when the gallery thumbnail changes,
    # any condition report linked via the same live_session_id should also update.
    # This prevents blank/broken photos on SpotHub's condition reports section.
    # DEFENSIVE: wrap in try/except so CR sync issues never block cover photo updates.
    synced_reports = 0
    try:
        if gallery.live_session_id:
            linked_reports = await db.execute(
                select(ConditionReport).where(
                    ConditionReport.live_session_id == gallery.live_session_id,
                    ConditionReport.photographer_id == photographer_id
                )
            )
            for report in linked_reports.scalars().all():
                report.thumbnail_url = new_cover_url
                # If media_url is broken (local path), also update it
                if report.media_url and report.media_url.startswith('/api/uploads/'):
                    report.media_url = new_cover_url
                synced_reports += 1
        
        # Also check if there are condition reports by this photographer at the same spot
        # that were created around the same time as the gallery
        if synced_reports == 0 and gallery.surf_spot_id:
            spot_reports = await db.execute(
                select(ConditionReport).where(
                    ConditionReport.photographer_id == photographer_id,
                    ConditionReport.spot_id == gallery.surf_spot_id,
                    ConditionReport.is_active.is_(True)
                ).order_by(ConditionReport.created_at.desc()).limit(1)
            )
            latest_report = spot_reports.scalar_one_or_none()
            if latest_report:
                latest_report.thumbnail_url = new_cover_url
                if latest_report.media_url and latest_report.media_url.startswith('/api/uploads/'):
                    latest_report.media_url = new_cover_url
                synced_reports += 1
    except Exception as sync_err:
        gallery_logger.warning(
            f"Gallery {gallery_id} cover updated but CR sync failed: {sync_err}"
        )
    
    await db.commit()
    
    gallery_logger.info(
        f"Gallery {gallery_id} thumbnail manually set: {old_cover} -> {new_cover_url}"
        + (f" (synced {synced_reports} condition reports)" if synced_reports > 0 else "")
    )
    
    return {
        "success": True,
        "gallery_id": gallery_id,
        "cover_image_url": new_cover_url,
        "condition_reports_synced": synced_reports,
        "message": "Gallery thumbnail updated successfully"
    }


@router.patch("/galleries/{gallery_id}/clear-thumbnail")
async def clear_gallery_thumbnail(
    gallery_id: str,
    photographer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Clear a gallery's manually-set cover thumbnail.
    The auto-heal logic will select a new one from gallery items on next load.
    """
    result = await db.execute(
        select(Gallery).where(Gallery.id == gallery_id)
    )
    gallery = result.scalar_one_or_none()
    
    if not gallery:
        raise HTTPException(status_code=404, detail="Gallery not found")
    if gallery.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    gallery.cover_image_url = None
    await db.commit()
    
    gallery_logger.info(f"Gallery {gallery_id} thumbnail cleared — will auto-select on next load")
    
    return {
        "success": True,
        "gallery_id": gallery_id,
        "message": "Thumbnail cleared. Auto-selection will apply on next page load."
    }


# ============ PUSH CONDITIONS REPORT TO SPOT HUB ============

class PushConditionsRequest(BaseModel):
    caption: Optional[str] = None
    media_item_id: Optional[str] = None  # Specific gallery item to use as media


@router.post("/galleries/{gallery_id}/push-conditions")
async def push_conditions_to_spot_hub(
    gallery_id: str,
    photographer_id: str,
    data: PushConditionsRequest = PushConditionsRequest(),
    db: AsyncSession = Depends(get_db)
):
    """
    Manually push/sync a conditions report from a gallery to the linked spot hub.
    
    This is a photographer failsafe for when:
    - A gallery was deleted and re-created (orphaning the original CR)
    - A condition report had bad media and needs replacing
    - The auto-sync from set-thumbnail failed
    - The photographer wants to manually refresh their spot hub presence
    
    Behavior:
    - If an existing CR is found for this gallery's session/spot → UPDATE it
      (refresh media, reset 24h expiry, reactivate)
    - If no CR exists → CREATE a new one
    """
    from models import ConditionReport, SurfSpot, GalleryItem, Profile, Story
    
    # Load gallery with relationships
    result = await db.execute(
        select(Gallery).where(Gallery.id == gallery_id)
        .options(
            selectinload(Gallery.surf_spot),
            selectinload(Gallery.items)
        )
    )
    gallery = result.scalar_one_or_none()
    
    if not gallery:
        raise HTTPException(status_code=404, detail="Gallery not found")
    if gallery.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    # Must have a surf spot to push to
    if not gallery.surf_spot_id:
        raise HTTPException(
            status_code=400, 
            detail="This gallery has no linked surf spot. Link a session or assign a spot first."
        )
    
    # Resolve media URL to use for the condition report
    media_url = None
    media_type = 'image'
    
    # Option 1: Use a specific gallery item
    if data.media_item_id:
        item_result = await db.execute(
            select(GalleryItem).where(
                GalleryItem.id == data.media_item_id,
                GalleryItem.gallery_id == gallery_id
            )
        )
        item = item_result.scalar_one_or_none()
        if item:
            media_url = item.preview_url or item.thumbnail_url or item.original_url
            media_type = item.media_type or 'image'
    
    # Option 2: Use gallery cover image
    if not media_url and gallery.cover_image_url:
        media_url = gallery.cover_image_url
    
    # Option 3: Use first gallery item
    if not media_url and gallery.items:
        sorted_items = sorted(gallery.items, key=lambda i: i.created_at or datetime.min)
        for item in sorted_items:
            candidate = item.preview_url or item.thumbnail_url or item.original_url
            if candidate:
                media_url = candidate
                media_type = item.media_type or 'image'
                break
    
    if not media_url:
        raise HTTPException(
            status_code=400, 
            detail="No media available in this gallery to use for the condition report."
        )
    
    # Get spot info
    spot = gallery.surf_spot
    spot_name = spot.name if spot else None
    region = spot.region if spot else None
    latitude = spot.latitude if spot else None
    longitude = spot.longitude if spot else None
    
    # Get photographer info
    prof_result = await db.execute(select(Profile).where(Profile.id == photographer_id))
    photographer = prof_result.scalar_one_or_none()
    
    # Look for an existing condition report to update
    existing_cr = None
    
    # Strategy 1: Find by live_session_id (most precise link)
    if gallery.live_session_id:
        cr_result = await db.execute(
            select(ConditionReport).where(
                ConditionReport.live_session_id == gallery.live_session_id,
                ConditionReport.photographer_id == photographer_id
            ).order_by(ConditionReport.created_at.desc())
        )
        existing_cr = cr_result.scalars().first()
    
    # Strategy 2: Find by photographer + spot (within last 48h)
    if not existing_cr and gallery.surf_spot_id:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=48)
        cr_result = await db.execute(
            select(ConditionReport).where(
                ConditionReport.photographer_id == photographer_id,
                ConditionReport.spot_id == gallery.surf_spot_id,
                ConditionReport.created_at > cutoff
            ).order_by(ConditionReport.created_at.desc())
        )
        existing_cr = cr_result.scalars().first()
    
    # Caption
    caption = data.caption or (gallery.title if gallery.title else f"Conditions at {spot_name or 'surf spot'}")
    
    # Set expiration to 24 hours from now
    expires_at = datetime.now(timezone.utc) + timedelta(hours=24)
    
    action = "updated"
    
    if existing_cr:
        # UPDATE existing condition report
        existing_cr.media_url = media_url
        existing_cr.media_type = media_type
        existing_cr.caption = caption
        existing_cr.expires_at = expires_at
        existing_cr.is_expired = False
        existing_cr.is_active = True
        
        # Update thumbnail_url if the field exists
        try:
            existing_cr.thumbnail_url = media_url
        except Exception:
            pass
        
        condition_report_id = existing_cr.id
        gallery_logger.info(
            f"Push-conditions: UPDATED CR {existing_cr.id} for gallery {gallery_id} → spot {spot_name}"
        )
    else:
        # CREATE new condition report
        action = "created"
        cr_kwargs = dict(
            photographer_id=photographer_id,
            spot_id=gallery.surf_spot_id,
            media_url=media_url,
            media_type=media_type,
            caption=caption,
            spot_name=spot_name,
            region=region,
            latitude=latitude,
            longitude=longitude,
            live_session_id=gallery.live_session_id,
            expires_at=expires_at,
            is_active=True,
        )
        # Only set optional fields if model supports them
        try:
            cr_kwargs['is_expired'] = False
            cr_kwargs['thumbnail_url'] = media_url
        except Exception:
            pass
        
        new_cr = ConditionReport(**cr_kwargs)
        db.add(new_cr)
        await db.flush()
        condition_report_id = new_cr.id
        
        gallery_logger.info(
            f"Push-conditions: CREATED new CR {new_cr.id} for gallery {gallery_id} → spot {spot_name}"
        )
    
    await db.commit()
    
    return {
        "success": True,
        "action": action,
        "condition_report_id": condition_report_id,
        "spot_name": spot_name,
        "spot_id": gallery.surf_spot_id,
        "media_url": media_url,
        "expires_at": expires_at.isoformat(),
        "message": f"Conditions report {action} for {spot_name or 'spot hub'}! Visible for 24 hours."
    }


@router.get("/galleries/{gallery_id}/conditions-status")
async def get_gallery_conditions_status(
    gallery_id: str,
    photographer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Check if a condition report already exists for this gallery's linked spot.
    Returns status info so the frontend can show the right button label.
    """
    from models import ConditionReport
    
    result = await db.execute(
        select(Gallery).where(Gallery.id == gallery_id)
    )
    gallery = result.scalar_one_or_none()
    
    if not gallery:
        raise HTTPException(status_code=404, detail="Gallery not found")
    if gallery.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    if not gallery.surf_spot_id:
        return {
            "has_spot": False,
            "has_active_report": False,
            "report_id": None,
            "expires_at": None,
            "is_expired": True
        }
    
    # Look for existing CR
    existing_cr = None
    
    if gallery.live_session_id:
        cr_result = await db.execute(
            select(ConditionReport).where(
                ConditionReport.live_session_id == gallery.live_session_id,
                ConditionReport.photographer_id == photographer_id
            ).order_by(ConditionReport.created_at.desc())
        )
        existing_cr = cr_result.scalars().first()
    
    if not existing_cr:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=48)
        cr_result = await db.execute(
            select(ConditionReport).where(
                ConditionReport.photographer_id == photographer_id,
                ConditionReport.spot_id == gallery.surf_spot_id,
                ConditionReport.created_at > cutoff
            ).order_by(ConditionReport.created_at.desc())
        )
        existing_cr = cr_result.scalars().first()
    
    now = datetime.now(timezone.utc)
    
    if existing_cr:
        expires = existing_cr.expires_at
        if expires and expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        is_expired = getattr(existing_cr, 'is_expired', False) or (expires and expires < now)
        return {
            "has_spot": True,
            "has_active_report": not is_expired,
            "report_id": existing_cr.id,
            "expires_at": expires.isoformat() if expires else None,
            "is_expired": is_expired,
            "media_url": existing_cr.media_url
        }
    
    return {
        "has_spot": True,
        "has_active_report": False,
        "report_id": None,
        "expires_at": None,
        "is_expired": True
    }
