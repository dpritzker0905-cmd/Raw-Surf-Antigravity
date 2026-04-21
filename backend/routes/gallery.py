from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone, timedelta
import json
import uuid

from database import get_db
from models import Profile, SurfSpot, GalleryItem, GalleryPurchase, Notification, RoleEnum, Gallery, LiveSession, LiveSessionParticipant, XPTransaction, SurferGalleryItem, SurferSelectionQuota, GalleryTierEnum, Booking, BookingParticipant

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
        # 4. General photographer/gallery prices
        
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
        "has_locked_pricing": bool(participant_locked_prices or item.locked_price_web or item.locked_price_standard)
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
    
    # Process payment with credit system
    if data.payment_method == 'credits':
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
        "message": "Purchase successful!",
        "success": True,
        "download_url": download_url,
        "quality_tier": data.quality_tier,
        "amount_paid": price,
        "remaining_credits": new_balance if data.payment_method == 'credits' else buyer.credit_balance,
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
    access_type: str = 'pending_selection'

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
        shot_at=item.shot_at
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
    # Gallery already imported
    
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


@router.get("/galleries/photographer/{photographer_id}")
async def get_photographer_galleries(
    photographer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get all galleries for a photographer"""
    # Gallery already imported
    
    result = await db.execute(
        select(Gallery)
        .where(Gallery.photographer_id == photographer_id)
        .options(
            selectinload(Gallery.surf_spot),
            selectinload(Gallery.live_session),
            selectinload(Gallery.items)
        )
        .order_by(Gallery.created_at.desc())
    )
    galleries = result.scalars().all()
    
    # Auto-heal: if a gallery has items but no cover_image_url, set it from the first item
    needs_commit = False
    gallery_data = []
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
            }
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
    # Gallery already imported
    
    result = await db.execute(
        select(Gallery)
        .where(Gallery.id == gallery_id)
        .options(
            selectinload(Gallery.photographer),
            selectinload(Gallery.surf_spot),
            selectinload(Gallery.items)
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
    
    items = []
    is_owner = viewer_id and viewer_id == gallery.photographer_id
    for item in gallery.items:
        # Gallery owner can always see all items (including private/draft ones)
        # Public viewers only see items marked is_public
        if is_owner or item.is_public:
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
                "is_purchased": item.id in purchased_ids,
                "created_at": item.created_at.isoformat()
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
    # Gallery already imported
    
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


@router.delete("/galleries/{gallery_id}")
async def delete_gallery(
    gallery_id: str,
    photographer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Delete a gallery and its items"""
    # Gallery already imported
    
    result = await db.execute(select(Gallery).where(Gallery.id == gallery_id))
    gallery = result.scalar_one_or_none()
    
    if not gallery:
        raise HTTPException(status_code=404, detail="Gallery not found")
    
    if gallery.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    await db.delete(gallery)
    await db.commit()
    
    return {"message": "Gallery deleted"}


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
    # Gallery already imported
    
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
    if not gallery.cover_image_url and data.media_type == 'image':
        gallery.cover_image_url = data.preview_url
    
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
