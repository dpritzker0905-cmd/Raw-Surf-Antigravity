"""Surfer gallery claims — claim queue actions, downloads, booking additions, public gallery."""
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


