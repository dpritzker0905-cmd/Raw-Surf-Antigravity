"""Surfer gallery core — locker scanning, gallery listing, visibility, favorites."""
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



