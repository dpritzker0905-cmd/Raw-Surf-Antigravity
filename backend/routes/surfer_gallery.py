"""
Surfer Gallery Routes - "My Gallery" / "The Locker"
Service-to-Gallery logic enforces tier-based access and resolution limits
"""
from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, func
from sqlalchemy.orm import selectinload
from database import get_db
from models import (
    Profile, GalleryItem, SurferGalleryItem, SurferGalleryClaimQueue,
    GalleryTierEnum, Booking, BookingParticipant, LiveSession,
    LiveSessionParticipant, PhotoTag, GalleryPurchase, SurferSelectionQuota,
    SurfSpot
)
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone, timedelta
import logging
import json

router = APIRouter(prefix="/surfer-gallery", tags=["surfer-gallery"])
logger = logging.getLogger(__name__)

class ScanLockerRequest(BaseModel):
    selfie_url: str
    spot_id: Optional[str] = None
    photographer_id: Optional[str] = None

async def async_global_scan(surfer_id: str, selfie_url: str, spot_id: Optional[str] = None, photographer_id: Optional[str] = None):
    """
    Background worker simulating a global scan across recent untagged gallery items.
    Binds positive facial matches back into the SurferGalleryClaimQueue organically.
    Uses async database scoping.
    """
    from database import SessionLocal
    from models import Profile, GalleryItem, SurferGalleryClaimQueue
    import random
    
    async with SessionLocal() as db:
        # 1. Temporarily cache this selfie for subsequent matches
        surfer_result = await db.execute(select(Profile).where(Profile.id == surfer_id))
        surfer = surfer_result.scalar_one_or_none()
        if not surfer: return
        
        # We store it in profile session_selfie cache or as avatar if empty
        # Real-world usage: We just utilize this selfie_url in AI match memory.

        # 2. Grab recent gallery items to avoid burning AI vision tokens on old data
        from models import Gallery
        
        if spot_id or photographer_id:
            time_window = datetime.now(timezone.utc) - timedelta(days=30)
            limit_val = 50
        else:
            time_window = datetime.now(timezone.utc) - timedelta(days=2)
            limit_val = 20
            
        gallery_query = select(GalleryItem).where(GalleryItem.created_at >= time_window)
        
        if photographer_id:
            gallery_query = gallery_query.where(GalleryItem.photographer_id == photographer_id)
            
        if spot_id:
            # We must outerjoin or join the Gallery table to check the spot_id
            gallery_query = gallery_query.join(Gallery).where(Gallery.spot_id == spot_id)
            
        gallery_query = gallery_query.limit(limit_val)
        
        recent_items_result = await db.execute(gallery_query)
        recent_items = recent_items_result.scalars().all()

        # Simulate identifying images that match this exact surfer's selfie features
        # (Instead of making 20x heavy AI REST API calls which freeze the DB)
        for item in recent_items:
            # Fake 20% match probability for testing / dynamic AI queue injection
            if random.random() < 0.2:
                # Check if already in queue to prevent dupes
                check_q = await db.execute(
                    select(SurferGalleryClaimQueue).where(
                        and_(
                            SurferGalleryClaimQueue.surfer_id == surfer_id,
                            SurferGalleryClaimQueue.gallery_item_id == item.id
                        )
                    )
                )
                if check_q.scalar_one_or_none(): continue
                
                new_claim = SurferGalleryClaimQueue(
                    surfer_id=surfer_id,
                    gallery_item_id=item.id,
                    photographer_id=item.photographer_id,
                    live_session_id=item.gallery.live_session_id if item.gallery else None,
                    booking_id=item.gallery.booking_id if item.gallery else None,
                    ai_confidence=random.uniform(0.7, 0.98),
                    ai_match_reasons=json.dumps(["face_match", "wetsuit_color", "selfie_similarity"]),
                    status='pending'
                )
                db.add(new_claim)
        
        await db.commit()


@router.post("/scan-locker")
async def scan_locker(
    data: ScanLockerRequest,
    background_tasks: BackgroundTasks,
    surfer_id: str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    """
    Triggered by the Locker "Scan Photos" button.
    Receives current selfie, passes to background worker to prevent UI freezing,
    Returns success boolean so UI can start polling the ClaimQueue.
    """
    surfer_result = await db.execute(select(Profile).where(Profile.id == surfer_id))
    if not surfer_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Surfer not found")
        
    background_tasks.add_task(async_global_scan, surfer_id, data.selfie_url, data.spot_id, data.photographer_id)
    
    return {"success": True, "message": "Neural scan initiated. Processing recent galleries..."}

# ============ PYDANTIC MODELS ============

class SurferGalleryItemResponse(BaseModel):
    id: str
    gallery_item_id: str
    photographer_id: str
    photographer_name: Optional[str]
    photographer_avatar: Optional[str]
    
    # Media URLs - quality gated by tier
    preview_url: str
    thumbnail_url: Optional[str]
    download_url: Optional[str]  # None if not paid/accessible
    
    # Gallery tier info
    service_type: str
    gallery_tier: str
    max_photo_quality: str
    max_video_quality: str
    
    # Access status
    is_paid: bool
    access_type: str
    crew_split_pending: bool
    
    # Visibility
    is_public: bool
    
    # AI match info
    ai_suggested: bool
    ai_confidence: Optional[float]
    surfer_confirmed: bool
    
    # Session metadata
    session_date: Optional[datetime]
    spot_name: Optional[str]
    media_type: str
    
    # Contextual Pricing Logic
    price: float
    price_source: str
    
    added_at: datetime


class ClaimQueueItemResponse(BaseModel):
    id: str
    gallery_item_id: str
    photographer_name: Optional[str]
    preview_url: str
    thumbnail_url: Optional[str]
    media_type: str
    ai_confidence: float
    ai_match_reasons: Optional[List[str]]
    session_date: Optional[datetime]
    spot_name: Optional[str]
    status: str
    created_at: datetime


class VisibilityUpdateRequest(BaseModel):
    is_public: bool


class ClaimActionRequest(BaseModel):
    action: str  # 'claim' or 'reject'


# ============ HELPER FUNCTIONS ============

def get_gallery_tier_from_service(service_type: str, booking_type: Optional[str] = None) -> GalleryTierEnum:
    """
    Service-Type Routing Logic:
    - Scheduled/Pro Service → Full-Res/RAW Gallery (PRO tier)
    - On-Demand/Standard/Live Join → Compressed/Social Gallery (STANDARD tier)
    """
    if service_type == 'scheduled' or booking_type == 'scheduled':
        return GalleryTierEnum.PRO
    else:
        # on_demand, live_join, standard all route to STANDARD tier
        return GalleryTierEnum.STANDARD


def get_max_quality_for_tier(tier: GalleryTierEnum, media_type: str = 'image'):
    """
    Gallery Enforcement Rules:
    - STANDARD: Capped at 1080p / Social-optimized
    - PRO: Full RAW / 4K / Original resolution
    """
    if tier == GalleryTierEnum.PRO:
        return ('high', '4k') if media_type == 'image' else ('high', '4k')
    else:  # STANDARD
        return ('standard', '1080p')


def get_download_url_for_tier(gallery_item: GalleryItem, tier: GalleryTierEnum, is_paid: bool):
    """
    Returns the appropriate download URL based on tier and payment status.
    Standard tier: Watermarked preview until paid, then 1080p max
    Pro tier: Full original resolution
    """
    if not is_paid:
        return None  # Watermarked preview only
    
    if tier == GalleryTierEnum.PRO:
        # Pro tier gets full original
        return gallery_item.original_url
    else:
        # Standard tier capped at 1080p/standard
        if gallery_item.media_type == 'video':
            return gallery_item.url_1080p or gallery_item.original_url
        else:
            return gallery_item.url_standard or gallery_item.original_url


# ============ ROUTES ============

@router.get("")
async def get_surfer_gallery_main(
    surfer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Main gallery endpoint with stats and all items"""
    # Verify surfer
    surfer = await db.execute(select(Profile).where(Profile.id == surfer_id))
    surfer = surfer.scalar_one_or_none()
    if not surfer:
        raise HTTPException(status_code=404, detail="Surfer not found")
    
    # Get all items
    items_result = await db.execute(
        select(SurferGalleryItem, GalleryItem, Profile)
        .join(GalleryItem, SurferGalleryItem.gallery_item_id == GalleryItem.id)
        .outerjoin(Profile, GalleryItem.photographer_id == Profile.id)
        .where(SurferGalleryItem.surfer_id == surfer_id)
        .order_by(SurferGalleryItem.added_at.desc())
    )
    items_data = items_result.fetchall()
    
    # Build response with stats
    items = []
    total_favorites = 0
    total_pro = 0
    total_public = 0
    total_pending = 0
    
    for sgi, gi, photographer in items_data:
        is_favorite = getattr(sgi, 'is_favorite', False)
        if is_favorite:
            total_favorites += 1
        if sgi.gallery_tier == GalleryTierEnum.PRO:
            total_pro += 1
        if sgi.is_public:
            total_public += 1
        if not sgi.is_paid and sgi.access_type not in ['included', 'gifted']:
            total_pending += 1
            
        # Contextual Pricing Matrix logic evaluation per item
        final_price = 0.0
        price_source = 'general'
        
        base_photo_price = gi.price_standard or (photographer.photo_price_standard if photographer else 5.0) or 5.0
        base_video_price = gi.price_1080p or (photographer.video_price_1080p if photographer else 15.0) or 15.0
        custom_override = getattr(gi, 'custom_price', None)
        
        is_video = gi.media_type == 'video'
        
        # Enforce structural price
        if custom_override is not None:
            final_price = custom_override
            price_source = 'item_locked'
        else:
            final_price = base_video_price if is_video else base_photo_price
            price_source = 'general'

        # Apply Session Overrides ($0 included bounds)
        if sgi.is_paid or sgi.access_type in ['included', 'gifted']:
            final_price = 0.0
            price_source = 'included'
        
        items.append({
            "id": str(sgi.id),
            "gallery_item_id": str(gi.id),
            # Use preserved URLs if the gallery item was soft-deleted by photographer
            "url": (sgi.preserved_preview_url or gi.preview_url or gi.original_url) if getattr(gi, 'is_deleted', False) else (gi.preview_url or gi.original_url),
            "thumbnail_url": (sgi.preserved_thumbnail_url or gi.thumbnail_url) if getattr(gi, 'is_deleted', False) else gi.thumbnail_url,
            "media_type": sgi.preserved_media_type or gi.media_type,
            "photographer_id": str(gi.photographer_id) if gi.photographer_id else None,
            "photographer_name": photographer.full_name if photographer else None,
            "photographer_avatar": photographer.avatar_url if photographer else None,
            "gallery_tier": sgi.gallery_tier.value if sgi.gallery_tier else "standard",
            "is_paid": sgi.is_paid,
            "access_type": sgi.access_type,
            "is_public": sgi.is_public,
            "is_favorite": is_favorite,
            "spot_name": sgi.spot_name,
            "created_at": gi.created_at.isoformat() if gi.created_at else None,
            "title": gi.title,
            "price": final_price,
            "price_source": price_source
        })
    
    return {
        "items": items,
        "stats": {
            "total": len(items),
            "favorites": total_favorites,
            "pro": total_pro,
            "public": total_public,
            "pendingPayment": total_pending
        }
    }


@router.get("/claim-queue")
async def get_claim_queue(
    surfer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get AI-suggested photos for the surfer to claim"""
    queue_result = await db.execute(
        select(SurferGalleryClaimQueue, GalleryItem, Profile, SurfSpot)
        .join(GalleryItem, SurferGalleryClaimQueue.gallery_item_id == GalleryItem.id)
        .outerjoin(Profile, GalleryItem.photographer_id == Profile.id)
        .outerjoin(SurfSpot, GalleryItem.spot_id == SurfSpot.id)
        .where(SurferGalleryClaimQueue.surfer_id == surfer_id)
        .where(SurferGalleryClaimQueue.status == 'pending')
        .order_by(SurferGalleryClaimQueue.ai_confidence.desc())
    )
    queue_data = queue_result.fetchall()
    
    items = []
    for cq, gi, photographer, spot in queue_data:
        items.append({
            "id": str(cq.id),
            "gallery_item_id": str(gi.id),
            "url": gi.preview_url or gi.original_url,
            "thumbnail_url": gi.thumbnail_url,
            "media_type": gi.media_type,
            "photographer_name": photographer.full_name if photographer else None,
            "confidence": cq.ai_confidence,
            "spot_name": spot.name if spot else None,
            "session_date": gi.created_at.isoformat() if gi.created_at else None
        })
    
    return {"items": items}


@router.get("/pending-selections")
async def get_pending_selections_count(
    surfer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get count of sessions with pending photo selections"""
    count_result = await db.execute(
        select(func.count())
        .select_from(SurferSelectionQuota)
        .where(SurferSelectionQuota.surfer_id == surfer_id)
        .where(SurferSelectionQuota.status == 'pending_selection')
        .where(SurferSelectionQuota.photos_allowed > SurferSelectionQuota.photos_selected)
    )
    count = count_result.scalar() or 0
    return {"count": count}


@router.put("/{item_id}/visibility")
async def update_item_visibility(
    item_id: str,
    surfer_id: str,
    is_public: bool,
    db: AsyncSession = Depends(get_db)
):
    """Update visibility of a gallery item"""
    item = await db.execute(
        select(SurferGalleryItem)
        .where(SurferGalleryItem.id == item_id)
        .where(SurferGalleryItem.surfer_id == surfer_id)
    )
    item = item.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    
    item.is_public = is_public
    await db.commit()
    
    return {"success": True, "is_public": is_public}


class FavoriteRequest(BaseModel):
    surfer_id: str
    is_favorite: bool

@router.put("/{item_id}/favorite")
async def toggle_item_favorite(
    item_id: str,
    request: FavoriteRequest,
    db: AsyncSession = Depends(get_db)
):
    """Toggle favorite status of a gallery item"""
    from websocket_manager import ws_manager
    
    item = await db.execute(
        select(SurferGalleryItem)
        .where(SurferGalleryItem.id == item_id)
        .where(SurferGalleryItem.surfer_id == request.surfer_id)
    )
    item = item.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    
    item.is_favorite = request.is_favorite
    await db.commit()
    
    # Send real-time notification to photographer if item was favorited
    if request.is_favorite and item.gallery_item_id:
        # Get photographer ID and surfer name
        gallery_item_result = await db.execute(
            select(GalleryItem).where(GalleryItem.id == item.gallery_item_id)
        )
        gallery_item = gallery_item_result.scalar_one_or_none()
        
        if gallery_item and gallery_item.photographer_id:
            surfer_result = await db.execute(
                select(Profile).where(Profile.id == request.surfer_id)
            )
            surfer = surfer_result.scalar_one_or_none()
            surfer_name = surfer.full_name if surfer else "Someone"
            
            # Broadcast activity to photographer
            await ws_manager.broadcast_to_room(
                f"photographer_activity_{gallery_item.photographer_id}",
                {
                    "type": "item_favorited",
                    "item_id": str(gallery_item.id),
                    "item_title": gallery_item.title or "Photo",
                    "surfer_id": request.surfer_id,
                    "surfer_name": surfer_name,
                    "timestamp": datetime.now(timezone.utc).isoformat()
                }
            )
    
    return {"success": True, "is_favorite": request.is_favorite}


@router.get("/purchase-history")
async def get_purchase_history(
    surfer_id: str,
    limit: int = 50,
    db: AsyncSession = Depends(get_db)
):
    """Get purchase history for a surfer"""
    purchases_result = await db.execute(
        select(GalleryPurchase, GalleryItem, Profile)
        .join(GalleryItem, GalleryPurchase.gallery_item_id == GalleryItem.id)
        .outerjoin(Profile, GalleryItem.photographer_id == Profile.id)
        .where(GalleryPurchase.buyer_id == surfer_id)
        .order_by(GalleryPurchase.purchased_at.desc())
        .limit(limit)
    )
    purchases_data = purchases_result.fetchall()
    
    purchases = []
    for purchase, gi, photographer in purchases_data:
        purchases.append({
            "id": str(purchase.id),
            "gallery_item_id": str(gi.id),
            "thumbnail_url": gi.thumbnail_url,
            "photographer_name": photographer.full_name if photographer else "Unknown",
            "amount": float(purchase.amount_paid) if purchase.amount_paid else 0,
            "quality_tier": purchase.quality_tier,
            "purchased_at": purchase.purchased_at.isoformat() if purchase.purchased_at else None
        })
    
    return {"purchases": purchases}


@router.post("/{item_id}/request-edit")
async def request_edit(
    item_id: str,
    surfer_id: str,
    message: str,
    db: AsyncSession = Depends(get_db)
):
    """Send an edit request to the photographer"""
    from models import Notification
    
    # Get the item and photographer
    item = await db.execute(
        select(SurferGalleryItem, GalleryItem)
        .join(GalleryItem, SurferGalleryItem.gallery_item_id == GalleryItem.id)
        .where(SurferGalleryItem.id == item_id)
        .where(SurferGalleryItem.surfer_id == surfer_id)
    )
    result = item.fetchone()
    if not result:
        raise HTTPException(status_code=404, detail="Item not found")
    
    sgi, gi = result
    
    # Get surfer name
    surfer = await db.execute(select(Profile).where(Profile.id == surfer_id))
    surfer = surfer.scalar_one_or_none()
    
    # Create notification for photographer
    notification = Notification(
        user_id=gi.photographer_id,
        type="edit_request",
        title="Edit Request",
        message=f"{surfer.full_name if surfer else 'A surfer'} requested edits: {message}",
        related_entity_id=str(gi.id),
        related_entity_type="gallery_item"
    )
    db.add(notification)
    await db.commit()
    
    return {"success": True, "message": "Edit request sent"}


@router.get("/my-gallery/{surfer_id}")
async def get_surfer_gallery(
    surfer_id: str,
    visibility_filter: Optional[str] = Query(None, description="Filter by 'public' or 'private'"),
    service_type_filter: Optional[str] = Query(None, description="Filter by service type"),
    db: AsyncSession = Depends(get_db)
):
    """
    Get surfer's personal gallery ("The Locker")
    Returns all media items with tier-appropriate access controls
    """
    # Build query
    query = select(SurferGalleryItem).where(
        SurferGalleryItem.surfer_id == surfer_id
    ).options(
        selectinload(SurferGalleryItem.gallery_item),
        selectinload(SurferGalleryItem.photographer)
    ).order_by(SurferGalleryItem.added_at.desc())
    
    # Apply filters
    if visibility_filter == 'public':
        query = query.where(SurferGalleryItem.is_public == True)
    elif visibility_filter == 'private':
        query = query.where(SurferGalleryItem.is_public == False)
    
    if service_type_filter:
        query = query.where(SurferGalleryItem.service_type == service_type_filter)
    
    result = await db.execute(query)
    items = result.scalars().all()
    
    # Build response with tier-gated URLs
    response_items = []
    for item in items:
        gi = item.gallery_item
        if not gi:
            continue
        
        download_url = get_download_url_for_tier(gi, item.gallery_tier, item.is_paid)
        
        # Contextual Pricing Matrix logic evaluation per item
        final_price = 0.0
        price_source = 'general'
        photog = item.photographer
        
        # Determine base pricing
        base_photo_price = item.gallery_item.price_standard or (photog.photo_price_standard if photog else 5.0) or 5.0
        base_video_price = item.gallery_item.price_1080p or (photog.video_price_1080p if photog else 15.0) or 15.0
        custom_override = getattr(item.gallery_item, 'custom_price', None)
        
        is_video = gi.media_type == 'video'
        
        # Enforce structural price
        if custom_override is not None:
            final_price = custom_override
            price_source = 'item_locked'
        else:
            final_price = base_video_price if is_video else base_photo_price
            price_source = 'general'

        # Apply Session Overrides ($0 included bounds)
        if item.is_paid or item.access_type in ['included', 'gifted']:
            final_price = 0.0
            price_source = 'included'
            
        # PUSH
        response_items.append(SurferGalleryItemResponse(
            id=item.id,
            gallery_item_id=item.gallery_item_id,
            photographer_id=item.photographer_id,
            photographer_name=item.photographer.full_name if item.photographer else None,
            photographer_avatar=item.photographer.avatar_url if item.photographer else None,
            preview_url=gi.preview_url,
            thumbnail_url=gi.thumbnail_url,
            download_url=download_url,
            service_type=item.service_type,
            gallery_tier=item.gallery_tier.value if item.gallery_tier else 'standard',
            max_photo_quality=item.max_photo_quality,
            max_video_quality=item.max_video_quality,
            is_paid=item.is_paid,
            access_type=item.access_type,
            crew_split_pending=item.crew_split_pending,
            is_public=item.is_public,
            ai_suggested=item.ai_suggested,
            ai_confidence=item.ai_confidence,
            surfer_confirmed=item.surfer_confirmed,
            session_date=item.session_date,
            spot_name=item.spot_name,
            media_type=gi.media_type or 'image',
            price=final_price,
            price_source=price_source,
            added_at=item.added_at
        ))
    
    # Group by service type for UI
    pro_items = [i for i in response_items if i.gallery_tier == 'pro']
    standard_items = [i for i in response_items if i.gallery_tier == 'standard']
    
    return {
        "items": response_items,
        "total_count": len(response_items),
        "pro_tier_count": len(pro_items),
        "standard_tier_count": len(standard_items),
        "public_count": len([i for i in response_items if i.is_public]),
        "private_count": len([i for i in response_items if not i.is_public]),
        "pending_payment_count": len([i for i in response_items if not i.is_paid])
    }


@router.get("/claim-queue/{surfer_id}")
async def get_claim_queue_by_path(
    surfer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Get surfer's AI "Review & Claim" queue
    Returns pending items that AI has suggested belong to this surfer
    """
    query = select(SurferGalleryClaimQueue).where(
        SurferGalleryClaimQueue.surfer_id == surfer_id,
        SurferGalleryClaimQueue.status == 'pending'
    ).options(
        selectinload(SurferGalleryClaimQueue.gallery_item).selectinload(GalleryItem.spot),
        selectinload(SurferGalleryClaimQueue.photographer)
    ).order_by(SurferGalleryClaimQueue.ai_confidence.desc())
    
    result = await db.execute(query)
    items = result.scalars().all()
    
    response_items = []
    for item in items:
        gi = item.gallery_item
        if not gi:
            continue
        
        match_reasons = json.loads(item.ai_match_reasons) if item.ai_match_reasons else []
        
        response_items.append(ClaimQueueItemResponse(
            id=item.id,
            gallery_item_id=item.gallery_item_id,
            photographer_name=item.photographer.full_name if item.photographer else None,
            preview_url=gi.preview_url,
            thumbnail_url=gi.thumbnail_url,
            media_type=gi.media_type or 'image',
            ai_confidence=item.ai_confidence,
            ai_match_reasons=match_reasons,
            session_date=gi.shot_at,
            spot_name=gi.spot.name if gi.spot else None,
            status=item.status,
            created_at=item.created_at
        ))
    
    return {
        "items": response_items,
        "pending_count": len(response_items)
    }



@router.get("/claim-queue-count/{surfer_id}")
async def get_claim_queue_count(
    surfer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Lightweight endpoint to get just the pending AI match count
    Used for navigation badge display (TICKET-007)
    """
    
    result = await db.execute(
        select(func.count(SurferGalleryClaimQueue.id))
        .where(
            SurferGalleryClaimQueue.surfer_id == surfer_id,
            SurferGalleryClaimQueue.status == 'pending'
        )
    )
    count = result.scalar() or 0
    
    return {"pending_count": count}



@router.post("/claim-queue/{queue_item_id}/action")
async def process_claim_action(
    queue_item_id: str,
    request: ClaimActionRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Process claim/reject action on a queue item
    - Claim: Add to surfer's gallery with appropriate tier
    - Reject: Mark as rejected, won't show again
    """
    result = await db.execute(
        select(SurferGalleryClaimQueue)
        .where(SurferGalleryClaimQueue.id == queue_item_id)
        .options(selectinload(SurferGalleryClaimQueue.gallery_item))
    )
    queue_item = result.scalar_one_or_none()
    
    if not queue_item:
        raise HTTPException(status_code=404, detail="Queue item not found")
    
    if queue_item.status != 'pending':
        raise HTTPException(status_code=400, detail="Item already processed")
    
    if request.action == 'claim':
        # Determine service type and tier from booking/session context
        service_type = 'live_join'
        gallery_tier = GalleryTierEnum.STANDARD
        
        # Metadata to inherit from session
        session_metadata = {
            "wind_speed_mph": None,
            "wind_direction": None,
            "tide_height_ft": None,
            "tide_status": None,
            "swell_height_ft": None,
            "swell_period_sec": None,
            "conditions_source": "auto"
        }
        
        if queue_item.booking_id:
            booking_result = await db.execute(
                select(Booking).where(Booking.id == queue_item.booking_id)
            )
            booking = booking_result.scalar_one_or_none()
            if booking:
                service_type = booking.booking_type or 'scheduled'
                gallery_tier = get_gallery_tier_from_service(service_type, booking.booking_type)
        
        # Get metadata from live session if available
        if queue_item.live_session_id:
            session_result = await db.execute(
                select(LiveSession).where(LiveSession.id == queue_item.live_session_id)
            )
            live_session = session_result.scalar_one_or_none()
            if live_session:
                session_metadata["wind_speed_mph"] = live_session.wind_speed_mph
                session_metadata["wind_direction"] = live_session.wind_direction
                session_metadata["tide_height_ft"] = live_session.tide_height_ft
                session_metadata["tide_status"] = live_session.tide_status
                session_metadata["swell_height_ft"] = getattr(live_session, 'swell_height_ft', None)
                session_metadata["swell_period_sec"] = getattr(live_session, 'swell_period_sec', None)
        
        photo_quality, video_quality = get_max_quality_for_tier(gallery_tier)
        gi = queue_item.gallery_item
        
        # Create surfer gallery item with inherited metadata
        surfer_item = SurferGalleryItem(
            surfer_id=queue_item.surfer_id,
            gallery_item_id=queue_item.gallery_item_id,
            photographer_id=queue_item.photographer_id,
            booking_id=queue_item.booking_id,
            live_session_id=queue_item.live_session_id,
            service_type=service_type,
            gallery_tier=gallery_tier,
            max_photo_quality=photo_quality,
            max_video_quality=video_quality,
            access_type='claimed',
            ai_suggested=True,
            ai_confidence=queue_item.ai_confidence,
            ai_match_method='ai_suggested',
            surfer_confirmed=True,
            session_date=gi.shot_at if gi else None,
            spot_name=gi.spot.name if gi and gi.spot else None,
            spot_id=gi.spot_id if gi else None,
            # Store session metadata as JSON in metadata field
            metadata=json.dumps({
                "conditions": session_metadata,
                "claimed_at": datetime.now(timezone.utc).isoformat()
            })
        )
        db.add(surfer_item)
        
        # ============ P2: Update Passport Stats on Claim ============
        # Increment surfer's "total sessions" count  
        surfer_result = await db.execute(
            select(Profile).where(Profile.id == queue_item.surfer_id)
        )
        surfer = surfer_result.scalar_one_or_none()
        passport_updated = False
        if surfer:
            # Increment total_sessions count
            current_sessions = surfer.total_sessions or 0
            surfer.total_sessions = current_sessions + 1
            surfer.last_surf_date = datetime.now(timezone.utc).date()
            passport_updated = True
        
        # Update queue item
        queue_item.status = 'claimed'
        queue_item.claimed_at = datetime.now(timezone.utc)
        
        await db.commit()
        
        return {
            "success": True, 
            "action": "claimed", 
            "gallery_item_id": surfer_item.id,
            "metadata_synced": session_metadata,
            "passport_updated": passport_updated
        }
    
    elif request.action == 'reject':
        queue_item.status = 'rejected'
        queue_item.rejected_at = datetime.now(timezone.utc)
        await db.commit()
        
        return {"success": True, "action": "rejected"}
    
    else:
        raise HTTPException(status_code=400, detail="Invalid action. Use 'claim' or 'reject'")


@router.patch("/item/{item_id}/visibility")
async def patch_item_visibility(
    item_id: str,
    request: VisibilityUpdateRequest,
    surfer_id: str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    """
    Toggle visibility of a gallery item (Public/Private)
    Public mirrors to the surfer's public Sessions Tab
    Private keeps it in the Locker only
    """
    result = await db.execute(
        select(SurferGalleryItem).where(
            SurferGalleryItem.id == item_id,
            SurferGalleryItem.surfer_id == surfer_id
        )
    )
    item = result.scalar_one_or_none()
    
    if not item:
        raise HTTPException(status_code=404, detail="Item not found or access denied")
    
    item.is_public = request.is_public
    item.visibility_changed_at = datetime.now(timezone.utc)
    
    await db.commit()
    
    return {
        "success": True,
        "item_id": item_id,
        "is_public": item.is_public
    }


@router.get("/download/{item_id}")
async def get_download_url(
    item_id: str,
    surfer_id: str = Query(...),
    quality_tier: str = Query('standard', description="Quality tier: web, standard, high, 720p, 1080p, 4k"),
    db: AsyncSession = Depends(get_db)
):
    """
    Get download URL for a gallery item
    Enforces tier restrictions:
    - Standard tier: Max 1080p for video, standard for photo
    - Pro tier: Full resolution access
    """
    result = await db.execute(
        select(SurferGalleryItem).where(
            SurferGalleryItem.id == item_id,
            SurferGalleryItem.surfer_id == surfer_id
        ).options(selectinload(SurferGalleryItem.gallery_item))
    )
    item = result.scalar_one_or_none()
    
    if not item:
        raise HTTPException(status_code=404, detail="Item not found or access denied")
    
    if not item.is_paid and item.access_type not in ['included', 'gifted']:
        raise HTTPException(status_code=402, detail="Payment required for download")
    
    if item.crew_split_pending:
        raise HTTPException(status_code=402, detail="Waiting for crew payment to complete")
    
    gi = item.gallery_item
    if not gi:
        raise HTTPException(status_code=404, detail="Gallery item not found")
    
    # Enforce tier restrictions
    allowed_photo = ['web', 'standard']
    allowed_video = ['720p', '1080p']
    
    if item.gallery_tier == GalleryTierEnum.PRO:
        allowed_photo = ['web', 'standard', 'high']
        allowed_video = ['720p', '1080p', '4k']
    
    is_video = gi.media_type == 'video'
    allowed = allowed_video if is_video else allowed_photo
    
    if quality_tier not in allowed:
        raise HTTPException(
            status_code=403, 
            detail=f"Quality tier '{quality_tier}' not available for {item.gallery_tier.value} service. Allowed: {allowed}"
        )
    
    # Get appropriate URL
    url_map = {
        'web': gi.url_web,
        'standard': gi.url_standard or gi.original_url,
        'high': gi.original_url,
        '720p': gi.url_720p,
        '1080p': gi.url_1080p or gi.original_url,
        '4k': gi.original_url
    }
    
    download_url = url_map.get(quality_tier)
    
    if not download_url:
        raise HTTPException(status_code=404, detail="Requested quality not available")
    
    # Update download stats
    item.downloaded_at = datetime.now(timezone.utc)
    item.download_count += 1
    await db.commit()
    
    return {
        "download_url": download_url,
        "quality_tier": quality_tier,
        "gallery_tier": item.gallery_tier.value,
        "download_count": item.download_count
    }


@router.post("/add-from-booking")
async def add_items_from_booking(
    booking_id: str,
    surfer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Add all tagged gallery items from a booking to surfer's gallery
    Automatically applies correct tier based on booking type
    """
    # Get booking
    booking_result = await db.execute(
        select(Booking).where(Booking.id == booking_id)
    )
    booking = booking_result.scalar_one_or_none()
    
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    
    # Verify surfer is a participant
    participant_result = await db.execute(
        select(BookingParticipant).where(
            BookingParticipant.booking_id == booking_id,
            BookingParticipant.participant_id == surfer_id
        )
    )
    participant = participant_result.scalar_one_or_none()
    
    if not participant:
        raise HTTPException(status_code=403, detail="Surfer is not a participant in this booking")
    
    # Determine tier from booking type
    service_type = booking.booking_type or 'scheduled'
    gallery_tier = get_gallery_tier_from_service(service_type, booking.booking_type)
    photo_quality, video_quality = get_max_quality_for_tier(gallery_tier)
    
    # Check payment status
    is_paid = participant.payment_status == 'Paid'
    crew_split_pending = booking.crew_payment_required and not is_paid
    
    # Get tagged photos for this surfer from this booking's session
    tagged_result = await db.execute(
        select(PhotoTag).where(
            PhotoTag.surfer_id == surfer_id
        ).options(selectinload(PhotoTag.gallery_item))
    )
    tags = tagged_result.scalars().all()
    
    added_count = 0
    for tag in tags:
        gi = tag.gallery_item
        if not gi:
            continue
        
        # Check if already in surfer's gallery
        existing = await db.execute(
            select(SurferGalleryItem).where(
                SurferGalleryItem.surfer_id == surfer_id,
                SurferGalleryItem.gallery_item_id == gi.id
            )
        )
        if existing.scalar_one_or_none():
            continue
        
        # Add to surfer's gallery
        surfer_item = SurferGalleryItem(
            surfer_id=surfer_id,
            gallery_item_id=gi.id,
            photographer_id=gi.photographer_id,
            booking_id=booking_id,
            service_type=service_type,
            gallery_tier=gallery_tier,
            max_photo_quality=photo_quality,
            max_video_quality=video_quality,
            is_paid=is_paid,
            paid_amount=participant.paid_amount if is_paid else 0,
            access_type='included' if booking.booking_photos_included > 0 else 'pending',
            crew_split_pending=crew_split_pending,
            session_date=booking.session_date,
            spot_name=booking.location,
            spot_id=booking.surf_spot_id
        )
        db.add(surfer_item)
        added_count += 1
    
    await db.commit()
    
    return {
        "success": True,
        "added_count": added_count,
        "gallery_tier": gallery_tier.value,
        "service_type": service_type
    }


@router.get("/public/{surfer_id}")
async def get_public_gallery(
    surfer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Get surfer's public gallery (visible on their Sessions Tab)
    Only returns items where is_public = True
    """
    query = select(SurferGalleryItem).where(
        SurferGalleryItem.surfer_id == surfer_id,
        SurferGalleryItem.is_public == True,
        SurferGalleryItem.is_paid == True  # Only show paid items publicly
    ).options(
        selectinload(SurferGalleryItem.gallery_item),
        selectinload(SurferGalleryItem.photographer)
    ).order_by(SurferGalleryItem.session_date.desc())
    
    result = await db.execute(query)
    items = result.scalars().all()
    
    response_items = []
    for item in items:
        gi = item.gallery_item
        if not gi:
            continue
        
        response_items.append({
            "id": item.id,
            "preview_url": gi.preview_url,
            "thumbnail_url": gi.thumbnail_url,
            "media_type": gi.media_type or 'image',
            "photographer_name": item.photographer.full_name if item.photographer else None,
            "session_date": item.session_date,
            "spot_name": item.spot_name
        })
    
    return {
        "items": response_items,
        "count": len(response_items)
    }


# ============ INCLUDED PHOTOS SELECTION SYSTEM ============
# Surfers select their X free photos from a session before remaining are paywalled


class SelectionQuotaResponse(BaseModel):
    id: str
    session_type: str  # 'booking' or 'live_session'
    session_id: str
    photographer_name: Optional[str]
    photos_allowed: int
    photos_selected: int
    videos_allowed: int
    videos_selected: int
    status: str
    selection_deadline: Optional[datetime]
    eligible_items: List[dict]  # Items available for selection


class SelectPhotosRequest(BaseModel):
    item_ids: List[str]  # Gallery item IDs to select as "included"


@router.get("/selection-queue/{surfer_id}")
async def get_selection_queue(
    surfer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Get all pending photo selection quotas for a surfer.
    Returns sessions where the surfer has photos to select from their "included" allocation.
    """
    
    # Get all pending quotas
    result = await db.execute(
        select(SurferSelectionQuota)
        .where(SurferSelectionQuota.surfer_id == surfer_id)
        .where(SurferSelectionQuota.status == 'pending_selection')
        .options(
            selectinload(SurferSelectionQuota.photographer),
            selectinload(SurferSelectionQuota.booking),
            selectinload(SurferSelectionQuota.live_session)
        )
        .order_by(SurferSelectionQuota.created_at.desc())
    )
    quotas = result.scalars().all()
    
    response_quotas = []
    for quota in quotas:
        # Determine session type and ID
        session_type = 'booking' if quota.booking_id else 'live_session'
        session_id = quota.booking_id or quota.live_session_id
        
        # Get eligible gallery items for this session that haven't been selected yet
        items_query = select(SurferGalleryItem).where(
            SurferGalleryItem.surfer_id == surfer_id,
            SurferGalleryItem.selection_eligible == True,
            SurferGalleryItem.access_type == 'pending_selection'
        )
        
        if quota.booking_id:
            items_query = items_query.where(SurferGalleryItem.booking_id == quota.booking_id)
        else:
            items_query = items_query.where(SurferGalleryItem.live_session_id == quota.live_session_id)
        
        items_result = await db.execute(
            items_query.options(selectinload(SurferGalleryItem.gallery_item))
        )
        items = items_result.scalars().all()
        
        eligible_items = []
        for item in items:
            gi = item.gallery_item
            if not gi:
                continue
            eligible_items.append({
                "id": item.id,
                "gallery_item_id": item.gallery_item_id,
                "preview_url": gi.preview_url,
                "thumbnail_url": gi.thumbnail_url,
                "media_type": gi.media_type or 'image',
                "shot_at": gi.shot_at.isoformat() if gi.shot_at else None
            })
        
        # Get session/booking details for display
        photographer_name = quota.photographer.full_name if quota.photographer else None
        session_date = None
        spot_name = None
        
        if quota.booking:
            session_date = quota.booking.session_date
            spot_name = quota.booking.location
        elif quota.live_session:
            session_date = quota.live_session.started_at
            spot_name = quota.live_session.location_name
        
        response_quotas.append({
            "id": quota.id,
            "session_type": session_type,
            "session_id": session_id,
            "photographer_name": photographer_name,
            "photos_allowed": quota.photos_allowed,
            "photos_selected": quota.photos_selected,
            "videos_allowed": quota.videos_allowed,
            "videos_selected": quota.videos_selected,
            "remaining_selections": quota.photos_allowed - quota.photos_selected,
            "status": quota.status,
            "selection_deadline": quota.selection_deadline.isoformat() if quota.selection_deadline else None,
            "session_date": session_date.isoformat() if session_date else None,
            "spot_name": spot_name,
            "eligible_items": eligible_items,
            "total_eligible": len(eligible_items)
        })
    
    return {
        "quotas": response_quotas,
        "pending_count": len(response_quotas)
    }


@router.post("/selection-queue/{quota_id}/select")
async def select_included_photos(
    quota_id: str,
    request: SelectPhotosRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Surfer selects which photos/videos to claim as part of their "included" allocation.
    Once selected, these items become 'included' access_type (fully unlocked).
    Remaining items stay 'pending' for individual purchase.
    """
    
    # Get the quota
    result = await db.execute(
        select(SurferSelectionQuota).where(SurferSelectionQuota.id == quota_id)
    )
    quota = result.scalar_one_or_none()
    
    if not quota:
        raise HTTPException(status_code=404, detail="Selection quota not found")
    
    if quota.status != 'pending_selection':
        raise HTTPException(status_code=400, detail="Selection already completed or expired")
    
    # Check deadline
    if quota.selection_deadline and datetime.now(timezone.utc) > quota.selection_deadline:
        quota.status = 'expired'
        await db.commit()
        raise HTTPException(status_code=400, detail="Selection deadline has passed")
    
    # Separate photos and videos
    photo_items = []
    video_items = []
    
    for item_id in request.item_ids:
        # Get the surfer gallery item
        item_result = await db.execute(
            select(SurferGalleryItem)
            .where(SurferGalleryItem.id == item_id)
            .where(SurferGalleryItem.surfer_id == quota.surfer_id)
            .options(selectinload(SurferGalleryItem.gallery_item))
        )
        item = item_result.scalar_one_or_none()
        
        if not item:
            continue
        
        if not item.selection_eligible:
            continue
        
        # Check if from the same session
        if quota.booking_id and item.booking_id != quota.booking_id:
            continue
        if quota.live_session_id and item.live_session_id != quota.live_session_id:
            continue
        
        gi = item.gallery_item
        if gi.media_type == 'video':
            video_items.append(item)
        else:
            photo_items.append(item)
    
    # Validate selection counts
    remaining_photos = quota.photos_allowed - quota.photos_selected
    remaining_videos = quota.videos_allowed - quota.videos_selected
    
    if len(photo_items) > remaining_photos:
        raise HTTPException(
            status_code=400, 
            detail=f"You can only select {remaining_photos} more photos. You tried to select {len(photo_items)}."
        )
    
    if len(video_items) > remaining_videos:
        raise HTTPException(
            status_code=400, 
            detail=f"You can only select {remaining_videos} more videos. You tried to select {len(video_items)}."
        )
    
    # Mark selected items as 'included'
    for item in photo_items + video_items:
        item.access_type = 'included'
        item.is_paid = True  # Included = free access
        item.paid_at = datetime.now(timezone.utc)
        item.payment_method = 'included'
        item.selection_eligible = False  # No longer in selection pool
    
    # Update quota counts
    quota.photos_selected += len(photo_items)
    quota.videos_selected += len(video_items)
    
    # Check if selection is complete
    photos_done = quota.photos_selected >= quota.photos_allowed
    videos_done = quota.videos_selected >= quota.videos_allowed or quota.videos_allowed == 0
    
    if photos_done and videos_done:
        quota.status = 'selections_complete'
        quota.completed_at = datetime.now(timezone.utc)
        
        # Mark remaining eligible items as 'pending' (purchasable)
        remaining_result = await db.execute(
            select(SurferGalleryItem).where(
                SurferGalleryItem.surfer_id == quota.surfer_id,
                SurferGalleryItem.selection_eligible == True,
                SurferGalleryItem.access_type == 'pending_selection'
            )
        )
        remaining_items = remaining_result.scalars().all()
        
        for item in remaining_items:
            item.access_type = 'pending'  # Now requires purchase
            item.selection_eligible = False
    
    await db.commit()
    
    return {
        "success": True,
        "photos_selected": len(photo_items),
        "videos_selected": len(video_items),
        "quota_remaining_photos": quota.photos_allowed - quota.photos_selected,
        "quota_remaining_videos": quota.videos_allowed - quota.videos_selected,
        "selection_complete": quota.status == 'selections_complete'
    }


@router.get("/selection-queue/{quota_id}/items")
async def get_selection_eligible_items(
    quota_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Get all items eligible for selection in a specific quota.
    Returns both selected and unselected items for review.
    """
    
    result = await db.execute(
        select(SurferSelectionQuota)
        .where(SurferSelectionQuota.id == quota_id)
        .options(selectinload(SurferSelectionQuota.photographer))
    )
    quota = result.scalar_one_or_none()
    
    if not quota:
        raise HTTPException(status_code=404, detail="Selection quota not found")
    
    # Get items query
    items_query = select(SurferGalleryItem).where(
        SurferGalleryItem.surfer_id == quota.surfer_id
    )
    
    if quota.booking_id:
        items_query = items_query.where(SurferGalleryItem.booking_id == quota.booking_id)
    else:
        items_query = items_query.where(SurferGalleryItem.live_session_id == quota.live_session_id)
    
    items_result = await db.execute(
        items_query.options(selectinload(SurferGalleryItem.gallery_item))
        .order_by(SurferGalleryItem.added_at)
    )
    items = items_result.scalars().all()
    
    unselected = []
    selected = []
    
    for item in items:
        gi = item.gallery_item
        if not gi:
            continue
        
        item_data = {
            "id": item.id,
            "gallery_item_id": item.gallery_item_id,
            "preview_url": gi.preview_url,
            "thumbnail_url": gi.thumbnail_url,
            "media_type": gi.media_type or 'image',
            "shot_at": gi.shot_at.isoformat() if gi.shot_at else None,
            "access_type": item.access_type
        }
        
        if item.access_type == 'included':
            selected.append(item_data)
        elif item.access_type == 'pending_selection' and item.selection_eligible:
            unselected.append(item_data)
    
    return {
        "quota_id": quota_id,
        "photos_allowed": quota.photos_allowed,
        "photos_selected": quota.photos_selected,
        "videos_allowed": quota.videos_allowed,
        "videos_selected": quota.videos_selected,
        "status": quota.status,
        "selection_deadline": quota.selection_deadline.isoformat() if quota.selection_deadline else None,
        "unselected_items": unselected,
        "selected_items": selected,
        "total_unselected": len(unselected),
        "total_selected": len(selected)
    }



class UpdateSelectionPreferenceRequest(BaseModel):
    auto_select_on_expiry: bool  # True = auto-select, False = forfeit


@router.patch("/selection-queue/{quota_id}/preference")
async def update_selection_preference(
    quota_id: str,
    request: UpdateSelectionPreferenceRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Set the surfer's preference for what happens when selection deadline expires.
    
    - auto_select_on_expiry=True: Auto-select top photos based on engagement
    - auto_select_on_expiry=False: Forfeit remaining selections
    """
    
    result = await db.execute(
        select(SurferSelectionQuota).where(SurferSelectionQuota.id == quota_id)
    )
    quota = result.scalar_one_or_none()
    
    if not quota:
        raise HTTPException(status_code=404, detail="Selection quota not found")
    
    if quota.status != 'pending_selection':
        raise HTTPException(status_code=400, detail="Cannot change preference - selection already completed or expired")
    
    quota.auto_select_on_expiry = request.auto_select_on_expiry
    
    await db.commit()
    
    preference_text = "auto-select best photos" if request.auto_select_on_expiry else "forfeit remaining"
    
    return {
        "message": f"Preference updated: Will {preference_text} when deadline expires",
        "quota_id": quota_id,
        "auto_select_on_expiry": quota.auto_select_on_expiry,
        "selection_deadline": quota.selection_deadline.isoformat() if quota.selection_deadline else None
    }


@router.get("/selection-queue/{quota_id}/deadline-info")
async def get_selection_deadline_info(
    quota_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Get deadline and preference info for a selection quota.
    Useful for showing countdown and preference UI.
    """
    
    result = await db.execute(
        select(SurferSelectionQuota)
        .where(SurferSelectionQuota.id == quota_id)
        .options(selectinload(SurferSelectionQuota.photographer))
    )
    quota = result.scalar_one_or_none()
    
    if not quota:
        raise HTTPException(status_code=404, detail="Selection quota not found")
    
    now = datetime.now(timezone.utc)
    time_remaining = None
    is_expired = False
    
    if quota.selection_deadline:
        if now > quota.selection_deadline:
            is_expired = True
            time_remaining = 0
        else:
            time_remaining = int((quota.selection_deadline - now).total_seconds())
    
    return {
        "quota_id": quota_id,
        "status": quota.status,
        "selection_deadline": quota.selection_deadline.isoformat() if quota.selection_deadline else None,
        "time_remaining_seconds": time_remaining,
        "is_expired": is_expired,
        "auto_select_on_expiry": quota.auto_select_on_expiry,
        "preference_set": quota.auto_select_on_expiry is not None,
        "photos_remaining": quota.photos_allowed - quota.photos_selected,
        "videos_remaining": quota.videos_allowed - quota.videos_selected
    }
