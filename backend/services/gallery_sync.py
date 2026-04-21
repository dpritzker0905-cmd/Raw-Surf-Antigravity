"""
Gallery Sync Service
Handles automatic gallery creation and pricing sync for all session types:
- Live Sessions
- On-Demand (Dispatch)
- Regular Bookings
"""

from datetime import datetime, timezone, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from models import (
    Gallery, GalleryItem, Profile, SurfSpot, Booking, DispatchRequest,
    LiveSession, SurferSelectionQuota, SurferGalleryItem, GalleryTierEnum,
    ConditionReport, LiveSessionParticipant, BookingParticipant,
    Notification, SurferGalleryClaimQueue, Surfboard
)
import json as _json
import logging

logger = logging.getLogger(__name__)


async def create_session_gallery(
    db: AsyncSession,
    photographer_id: str,
    session_type: str,  # 'live', 'on_demand', 'booking'
    spot_id: str = None,
    spot_name: str = None,
    booking_id: str = None,
    dispatch_id: str = None,
    live_session_id: str = None,
    session_start: datetime = None,
    participant_ids: list = None,
    cover_image_url: str = None  # Optional cover image (from condition report)
) -> dict:
    """
    Create a gallery for a completed session with proper pricing based on session type.
    
    Pricing logic:
    - Live Session: Uses photographer's live_photo_price and session prices
    - On-Demand: Uses photographer's on_demand_photo_price (premium pricing)
    - Booking: Uses booking-specific prices or photographer's booking prices
    """
    
    # Get photographer with pricing info
    photographer_result = await db.execute(
        select(Profile).where(Profile.id == photographer_id)
    )
    photographer = photographer_result.scalar_one_or_none()
    
    if not photographer:
        logger.error(f"Photographer {photographer_id} not found")
        return {"error": "Photographer not found"}
    
    # Get spot info
    if spot_id and not spot_name:
        spot_result = await db.execute(
            select(SurfSpot).where(SurfSpot.id == spot_id)
        )
        spot = spot_result.scalar_one_or_none()
        spot_name = spot.name if spot else "Unknown Location"
    
    # For live sessions, try to get cover image from condition report if not provided
    if session_type == 'live' and live_session_id and not cover_image_url:
        try:
            condition_result = await db.execute(
                select(ConditionReport).where(
                    ConditionReport.live_session_id == live_session_id,
                    ConditionReport.media_url != "",
                    ConditionReport.media_url.isnot(None)
                ).order_by(ConditionReport.created_at.desc()).limit(1)
            )
            condition_report = condition_result.scalar_one_or_none()
            if condition_report and condition_report.media_url:
                cover_image_url = condition_report.media_url
                logger.info(f"Using condition report media as gallery cover: {cover_image_url}")
        except Exception as e:
            logger.warning(f"Could not fetch condition report for gallery cover: {e}")
    
    # Determine gallery title and pricing based on session type
    now = datetime.now(timezone.utc)
    try:
        # Linux/macOS: %-I removes leading zero from hour
        date_str = (session_start or now).strftime("%B %d, %Y at %-I:%M %p")
    except ValueError:
        # Windows: %#I removes leading zero
        date_str = (session_start or now).strftime("%B %d, %Y at %#I:%M %p")
    
    if session_type == 'live':
        title = f"Live Session at {spot_name} - {date_str}"
        description = f"Photos from live surf session at {spot_name}"
        price_web = photographer.live_session_photo_price or photographer.photo_price_web or 3.0
        price_standard = photographer.live_session_photo_price or photographer.photo_price_standard or 5.0
        price_high = photographer.live_session_photo_price or photographer.photo_price_high or 10.0
        gallery_tier = GalleryTierEnum.STANDARD
        
    elif session_type == 'on_demand':
        title = f"On-Demand Session at {spot_name} - {date_str}"
        description = "Exclusive photos from your private on-demand session"
        price_web = photographer.on_demand_photo_price or photographer.photo_price_web or 5.0
        price_standard = photographer.on_demand_photo_price or photographer.photo_price_standard or 10.0
        price_high = photographer.on_demand_photo_price * 1.5 if photographer.on_demand_photo_price else photographer.photo_price_high or 15.0
        gallery_tier = GalleryTierEnum.PRO
        
    elif session_type == 'booking':
        # Try to get booking-specific pricing
        booking = None
        if booking_id:
            booking_result = await db.execute(
                select(Booking).where(Booking.id == booking_id)
            )
            booking = booking_result.scalar_one_or_none()
        
        title = f"Booked Session at {spot_name} - {date_str}"
        description = "Photos from your scheduled surf session"
        
        if booking:
            price_web = booking.booking_price_web or photographer.booking_price_web or 3.0
            price_standard = booking.booking_price_standard or photographer.booking_price_standard or 5.0
            price_high = booking.booking_price_high or photographer.booking_price_high or 10.0
        else:
            price_web = photographer.booking_price_web or photographer.photo_price_web or 3.0
            price_standard = photographer.booking_price_standard or photographer.photo_price_standard or 5.0
            price_high = photographer.booking_price_high or photographer.photo_price_high or 10.0
        
        gallery_tier = GalleryTierEnum.PRO
        
    else:
        # Manual/general gallery - use general pricing
        title = f"Session at {spot_name} - {date_str}" if spot_name else f"Gallery - {date_str}"
        description = "Surf photography gallery"
        price_web = photographer.photo_price_web or 3.0
        price_standard = photographer.photo_price_standard or 5.0
        price_high = photographer.photo_price_high or 10.0
        gallery_tier = GalleryTierEnum.STANDARD
    
    # Create the gallery with photographer's watermark preference
    show_watermark = photographer.default_watermark_in_selection if photographer.default_watermark_in_selection is not None else True
    
    # Get GENERAL/PUBLIC pricing (for non-participants browsing the gallery)
    # These are the photographer's standard prices for anyone who didn't participate
    general_price_web = photographer.photo_price_web or 3.0
    general_price_standard = photographer.photo_price_standard or 5.0
    general_price_high = photographer.photo_price_high or 10.0
    
    gallery = Gallery(
        photographer_id=photographer_id,
        title=title,
        description=description,
        surf_spot_id=spot_id,
        is_public=True,
        is_for_sale=True,
        default_tier=gallery_tier,
        # Cover image (from condition report or first photo)
        cover_image_url=cover_image_url,
        # GENERAL/PUBLIC pricing (for non-participants)
        price_web=general_price_web,
        price_standard=general_price_standard,
        price_high=general_price_high,
        # PARTICIPANT pricing (locked at session time for participants who paid)
        locked_price_web=price_web,
        locked_price_standard=price_standard,
        locked_price_high=price_high,
        # Session reference
        session_type=session_type,
        booking_id=booking_id if session_type == 'booking' else None,
        dispatch_id=dispatch_id if session_type == 'on_demand' else None,
        live_session_id=live_session_id if session_type == 'live' else None,
        # Watermark setting (inherited from photographer's global setting)
        show_watermark_in_selection=show_watermark,
        # Timestamps
        session_date=session_start or now
    )
    
    db.add(gallery)
    await db.flush()
    
    logger.info(f"Created {session_type} gallery '{title}' (ID: {gallery.id})")
    logger.info(f"  - Participant pricing: web=${price_web}, standard=${price_standard}, high=${price_high}")
    logger.info(f"  - General/Public pricing: web=${general_price_web}, standard=${general_price_standard}, high=${general_price_high}")
    
    # If participants provided, create selection quotas for them
    if participant_ids:
        for surfer_id in participant_ids:
            await create_surfer_selection_quota(
                db=db,
                gallery_id=gallery.id,
                surfer_id=surfer_id,
                session_type=session_type,
                photographer_id=photographer_id,
                booking_id=booking_id,
                dispatch_id=dispatch_id,
                live_session_id=live_session_id
            )
    
    await db.commit()
    
    return {
        "gallery_id": gallery.id,
        "title": title,
        "pricing": {
            "web": price_web,
            "standard": price_standard,
            "high": price_high
        },
        "tier": gallery_tier.value,
        "participants_added": len(participant_ids) if participant_ids else 0
    }


async def create_surfer_selection_quota(
    db: AsyncSession,
    gallery_id: str,
    surfer_id: str,
    session_type: str,
    photographer_id: str = None,  # Required - photographer who owns this gallery
    booking_id: str = None,
    dispatch_id: str = None,
    live_session_id: str = None,
    photos_allowed: int = None
):
    """
    Create a selection quota for a surfer in a gallery.
    
    Default photo allowances:
    - Live Session: 3 photos
    - On-Demand: 10 photos
    - Booking: Based on booking.photos_included or 5
    """
    
    # Get photographer_id from gallery if not provided
    if not photographer_id:
        gallery_result = await db.execute(
            select(Gallery).where(Gallery.id == gallery_id)
        )
        gallery = gallery_result.scalar_one_or_none()
        if gallery:
            photographer_id = gallery.photographer_id
    
    if not photographer_id:
        logger.error(f"Cannot create selection quota: photographer_id is required")
        return
    
    if photos_allowed is None:
        if session_type == 'live':
            photos_allowed = 3
        elif session_type == 'on_demand':
            photos_allowed = 10
            # Try to get from dispatch if available
            if dispatch_id:
                dispatch_result = await db.execute(
                    select(DispatchRequest).where(DispatchRequest.id == dispatch_id)
                )
                dispatch = dispatch_result.scalar_one_or_none()
                if dispatch:
                    # Could read from dispatch package in future
                    photos_allowed = 10
        elif session_type == 'booking':
            photos_allowed = 5
            if booking_id:
                booking_result = await db.execute(
                    select(Booking).where(Booking.id == booking_id)
                )
                booking = booking_result.scalar_one_or_none()
                if booking and booking.booking_photos_included:
                    photos_allowed = booking.booking_photos_included
        else:
            photos_allowed = 3
    
    # Selection deadline: 10 days from now (industry standard 7-14 days)
    selection_deadline = datetime.now(timezone.utc) + timedelta(days=10)
    
    quota = SurferSelectionQuota(
        gallery_id=gallery_id,
        surfer_id=surfer_id,
        photographer_id=photographer_id,  # Required field
        live_session_id=live_session_id,
        booking_id=booking_id,
        photos_allowed=photos_allowed,
        photos_selected=0,
        status='pending_selection',
        selection_deadline=selection_deadline,
        # Auto-selection preference (default: ask user)
        auto_select_on_expiry=None  # None = ask user, True = auto-select, False = forfeit
    )
    
    db.add(quota)
    logger.info(f"Created selection quota for surfer {surfer_id}: {photos_allowed} photos, deadline {selection_deadline}")


async def check_gallery_exists_for_session(
    db: AsyncSession,
    booking_id: str = None,
    dispatch_id: str = None,
    live_session_id: str = None
) -> bool:
    """Check if a gallery already exists for a given session."""
    
    if booking_id:
        result = await db.execute(
            select(Gallery).where(Gallery.booking_id == booking_id)
        )
    elif dispatch_id:
        result = await db.execute(
            select(Gallery).where(Gallery.dispatch_id == dispatch_id)
        )
    elif live_session_id:
        result = await db.execute(
            select(Gallery).where(Gallery.live_session_id == live_session_id)
        )
    else:
        return False
    
    return result.scalar_one_or_none() is not None


async def distribute_gallery_item_to_participants(
    db: AsyncSession,
    gallery_item_id: str,
    gallery: Gallery
) -> int:
    """
    Auto-distribute a gallery item to all session participants' lockers.
    
    Creates SurferGalleryItem entries for each participant with:
    - Pricing locked from their session join time
    - Gallery tier based on session type
    - Watermarked/pending until they select or purchase
    
    Returns number of surfers distributed to.
    """
    if not gallery:
        return 0
    
    # Determine session type and find participants
    participants = []
    session_type = gallery.session_type or 'manual'
    
    if gallery.live_session_id:
        # Live session participants — include 'confirmed' to catch pre-start joins
        result = await db.execute(
            select(LiveSessionParticipant)
            .where(LiveSessionParticipant.live_session_id == gallery.live_session_id)
            .where(LiveSessionParticipant.status.in_(['active', 'completed', 'confirmed']))
        )
        participants = result.scalars().all()
        
    elif gallery.booking_id:
        # Booking participants
        result = await db.execute(
            select(BookingParticipant)
            .where(BookingParticipant.booking_id == gallery.booking_id)
            .where(BookingParticipant.status.in_(['confirmed', 'completed']))
        )
        booking_participants = result.scalars().all()
        # BookingParticipant uses participant_id, not surfer_id — normalize
        class BookingPseudo:
            def __init__(self, bp):
                self.surfer_id = bp.participant_id
                self.locked_price_web = None
                self.locked_price_standard = None
                self.locked_price_high = None
        participants = [BookingPseudo(bp) for bp in booking_participants]
        
    elif gallery.dispatch_id:
        # On-demand: get the requester from DispatchRequest
        dispatch_result = await db.execute(
            select(DispatchRequest).where(DispatchRequest.id == gallery.dispatch_id)
        )
        dispatch = dispatch_result.scalar_one_or_none()
        if dispatch and dispatch.requester_id:
            # Create a pseudo-participant object for uniform handling
            class PseudoParticipant:
                def __init__(self, surfer_id, locked_web=None, locked_std=None, locked_high=None):
                    self.surfer_id = surfer_id
                    self.locked_price_web = locked_web
                    self.locked_price_standard = locked_std
                    self.locked_price_high = locked_high
            participants = [PseudoParticipant(dispatch.requester_id)]
    
    if not participants:
        logger.info(f"No participants found for gallery {gallery.id} (session_type={session_type})")
        return 0
    
    # Get the gallery item
    item_result = await db.execute(
        select(GalleryItem).where(GalleryItem.id == gallery_item_id)
    )
    gallery_item = item_result.scalar_one_or_none()
    if not gallery_item:
        logger.error(f"Gallery item {gallery_item_id} not found for distribution")
        return 0
    
    # Determine gallery tier based on session type
    if session_type in ('booking', 'on_demand'):
        gallery_tier = GalleryTierEnum.PRO
        max_photo_quality = 'high'
        max_video_quality = '4k'
    else:  # live, manual, general
        gallery_tier = GalleryTierEnum.STANDARD
        max_photo_quality = 'standard'
        max_video_quality = '1080p'
    
    # Get live session for metadata if available
    live_session = None
    if gallery.live_session_id:
        ls_result = await db.execute(
            select(LiveSession).where(LiveSession.id == gallery.live_session_id)
        )
        live_session = ls_result.scalar_one_or_none()
    
    # Get spot name
    spot_name = None
    if gallery.surf_spot_id:
        spot_result = await db.execute(
            select(SurfSpot).where(SurfSpot.id == gallery.surf_spot_id)
        )
        spot = spot_result.scalar_one_or_none()
        spot_name = spot.name if spot else None
    
    distributed_count = 0
    
    for participant in participants:
        surfer_id = participant.surfer_id
        
        # Skip if already distributed (idempotent)
        existing = await db.execute(
            select(SurferGalleryItem).where(
                SurferGalleryItem.surfer_id == surfer_id,
                SurferGalleryItem.gallery_item_id == gallery_item_id
            )
        )
        if existing.scalar_one_or_none():
            continue
        
        # ============ AI IDENTIFICATION DATA GATHERING ============
        # Collect all available identification signals for this surfer
        identification_signals = []
        ai_match_reasons = []
        
        # 1. Session selfie (highest priority — taken specifically for this session)
        participant_selfie = getattr(participant, 'selfie_url', None)
        if participant_selfie:
            identification_signals.append('selfie')
            ai_match_reasons.append('session_selfie_available')
        
        # 2. Profile data (avatar, wetsuit, rash guard, social)
        profile_result = await db.execute(
            select(Profile).where(Profile.id == surfer_id)
        )
        surfer_profile = profile_result.scalar_one_or_none()
        
        if surfer_profile:
            if surfer_profile.avatar_url:
                identification_signals.append('avatar')
                ai_match_reasons.append('profile_avatar_available')
            if surfer_profile.wetsuit_color:
                identification_signals.append('wetsuit')
                ai_match_reasons.append(f'wetsuit_color:{surfer_profile.wetsuit_color}')
            if surfer_profile.rash_guard_color:
                identification_signals.append('rash_guard')
                ai_match_reasons.append(f'rash_guard_color:{surfer_profile.rash_guard_color}')
            if surfer_profile.instagram_url:
                identification_signals.append('social')
                ai_match_reasons.append('instagram_profile_linked')
        
        # 3. Surfboard data (board color/type for visual matching)
        boards_result = await db.execute(
            select(Surfboard).where(Surfboard.user_id == surfer_id)
        )
        user_boards = boards_result.scalars().all()
        if user_boards:
            identification_signals.append('board')
            board_types = [b.board_type for b in user_boards if b.board_type]
            if board_types:
                ai_match_reasons.append(f'board_types:{"|".join(board_types)}')
            boards_with_photos = [b for b in user_boards if b.photo_urls]
            if boards_with_photos:
                ai_match_reasons.append(f'board_photos:{len(boards_with_photos)}')
        
        # AI confidence baseline: session participant = 0.7, with boosts per signal
        ai_confidence = 0.7
        if participant_selfie:
            ai_confidence += 0.15  # Selfie is strongest signal
        if surfer_profile and surfer_profile.avatar_url:
            ai_confidence += 0.05
        if user_boards:
            ai_confidence += 0.05
        ai_confidence = min(ai_confidence, 0.95)  # Cap below face-match threshold
        
        logger.info(
            f"Surfer {surfer_id} identification signals: {identification_signals} "
            f"(confidence={ai_confidence:.2f})"
        )
        
        # Create the locker item with AI metadata
        surfer_item = SurferGalleryItem(
            surfer_id=surfer_id,
            gallery_item_id=gallery_item_id,
            photographer_id=gallery.photographer_id,
            live_session_id=gallery.live_session_id,
            booking_id=gallery.booking_id,
            service_type=session_type,
            gallery_tier=gallery_tier,
            max_photo_quality=max_photo_quality,
            max_video_quality=max_video_quality,
            # Not paid yet — watermarked until selected or purchased
            is_paid=False,
            access_type='pending_selection',
            selection_eligible=True,
            # AI identification metadata
            ai_suggested=True,
            ai_confidence=ai_confidence,
            ai_match_method='session_participant',
            # Session metadata
            session_date=gallery.session_date or (live_session.started_at if live_session else None),
            spot_name=spot_name,
            spot_id=gallery.surf_spot_id,
        )
        
        db.add(surfer_item)
        distributed_count += 1
        
        # Also populate the AI Claim Queue for surfer review
        try:
            claim_entry = SurferGalleryClaimQueue(
                surfer_id=surfer_id,
                gallery_item_id=gallery_item_id,
                photographer_id=gallery.photographer_id,
                ai_confidence=ai_confidence,
                ai_match_reasons=_json.dumps(ai_match_reasons),
                passport_board_color=None,  # Will be populated by vision service
                passport_wetsuit_color=surfer_profile.wetsuit_color if surfer_profile else None,
                live_session_id=gallery.live_session_id,
                booking_id=gallery.booking_id,
                status='pending',
            )
            db.add(claim_entry)
        except Exception as claim_err:
            logger.warning(f"Failed to create claim queue entry for surfer {surfer_id}: {claim_err}")
        
        logger.info(
            f"Distributed gallery item {gallery_item_id} to surfer {surfer_id} "
            f"(session_type={session_type}, tier={gallery_tier.value}, "
            f"ai_confidence={ai_confidence:.2f}, signals={identification_signals})"
        )
    
    # Send notification to participants about new content
    if distributed_count > 0:
        photographer_result = await db.execute(
            select(Profile).where(Profile.id == gallery.photographer_id)
        )
        photographer = photographer_result.scalar_one_or_none()
        photographer_name = photographer.full_name if photographer else "Your photographer"
        
        media_word = "video" if gallery_item.media_type == 'video' else "photo"
        
        for participant in participants:
            try:
                notification = Notification(
                    user_id=participant.surfer_id,
                    type='gallery_item_added',
                    title=f"New {media_word} from your session!",
                    body=f"{photographer_name} uploaded a {media_word} from {spot_name or 'your session'}. Check your Locker to review!",
                    data='{"type": "gallery_item_added", "gallery_id": "' + str(gallery.id) + '"}'
                )
                db.add(notification)
            except Exception as e:
                logger.warning(f"Failed to notify surfer {participant.surfer_id}: {e}")
    
    await db.flush()
    logger.info(f"Distributed {distributed_count} locker items for gallery item {gallery_item_id}")
    return distributed_count


async def manually_assign_item_to_surfer(
    db: AsyncSession,
    gallery_item_id: str,
    surfer_id: str,
    photographer_id: str,
    access_type: str = 'pending_selection',
    gallery: Gallery = None
) -> dict:
    """
    Manual photographer fallback: assign a specific item to a specific surfer.
    Also records the assignment as AI training data for future matching.
    
    access_type options:
    - 'pending_selection': Surfer must select/purchase (watermarked)
    - 'included': Free — part of session allocation
    - 'gifted': Photographer gift — free download
    """
    # Check if already assigned
    existing = await db.execute(
        select(SurferGalleryItem).where(
            SurferGalleryItem.surfer_id == surfer_id,
            SurferGalleryItem.gallery_item_id == gallery_item_id
        )
    )
    if existing.scalar_one_or_none():
        return {"error": "Item already assigned to this surfer", "already_exists": True}
    
    # Get gallery item
    item_result = await db.execute(
        select(GalleryItem).where(GalleryItem.id == gallery_item_id)
    )
    gallery_item = item_result.scalar_one_or_none()
    if not gallery_item:
        return {"error": "Gallery item not found"}
    
    # Get gallery for session context
    if not gallery and gallery_item.gallery_id:
        gal_result = await db.execute(
            select(Gallery).where(Gallery.id == gallery_item.gallery_id)
        )
        gallery = gal_result.scalar_one_or_none()
    
    session_type = gallery.session_type if gallery else 'manual'
    
    # Determine tier
    if session_type in ('booking', 'on_demand'):
        gallery_tier = GalleryTierEnum.PRO
        max_photo = 'high'
        max_video = '4k'
    else:
        gallery_tier = GalleryTierEnum.STANDARD
        max_photo = 'standard'
        max_video = '1080p'
    
    is_paid = access_type in ('included', 'gifted')
    
    # Get spot name
    spot_name = None
    if gallery and gallery.surf_spot_id:
        spot_result = await db.execute(
            select(SurfSpot).where(SurfSpot.id == gallery.surf_spot_id)
        )
        spot = spot_result.scalar_one_or_none()
        spot_name = spot.name if spot else None
    
    surfer_item = SurferGalleryItem(
        surfer_id=surfer_id,
        gallery_item_id=gallery_item_id,
        photographer_id=photographer_id,
        live_session_id=gallery.live_session_id if gallery else None,
        booking_id=gallery.booking_id if gallery else None,
        service_type=session_type,
        gallery_tier=gallery_tier,
        max_photo_quality=max_photo,
        max_video_quality=max_video,
        is_paid=is_paid,
        access_type=access_type,
        selection_eligible=(access_type == 'pending_selection'),
        session_date=gallery.session_date if gallery else None,
        spot_name=spot_name,
        spot_id=gallery.surf_spot_id if gallery else None,
        # Mark as manual (not AI) so the system knows
        ai_suggested=False,
        ai_match_method='manual_photographer',
        surfer_confirmed=True,  # Photographer manually assigned = confirmed
    )
    db.add(surfer_item)
    
    # Record as AI training data — manual assignments teach the AI
    import json
    training_entry = SurferGalleryClaimQueue(
        surfer_id=surfer_id,
        gallery_item_id=gallery_item_id,
        photographer_id=photographer_id,
        live_session_id=gallery.live_session_id if gallery else None,
        booking_id=gallery.booking_id if gallery else None,
        ai_confidence=1.0,  # Manual = 100% confidence
        ai_match_reasons=json.dumps(['manual_photographer_assignment']),
        status='claimed',
        claimed_at=datetime.now(timezone.utc)
    )
    db.add(training_entry)
    
    # Update tagged_surfer_ids on the gallery item
    import json as _json
    tagged_ids = _json.loads(gallery_item.tagged_surfer_ids) if gallery_item.tagged_surfer_ids else []
    if surfer_id not in tagged_ids:
        tagged_ids.append(surfer_id)
        gallery_item.tagged_surfer_ids = _json.dumps(tagged_ids)
    
    # Notify surfer
    photographer_result = await db.execute(
        select(Profile).where(Profile.id == photographer_id)
    )
    photographer = photographer_result.scalar_one_or_none()
    media_word = "video" if gallery_item.media_type == 'video' else "photo"
    
    notification = Notification(
        user_id=surfer_id,
        type='gallery_item_tagged',
        title=f"You were tagged in a {media_word}!",
        body=f"{photographer.full_name if photographer else 'A photographer'} tagged you in a {media_word} from {spot_name or 'a session'}.",
        data='{"type": "gallery_item_tagged", "gallery_item_id": "' + str(gallery_item_id) + '"}'
    )
    db.add(notification)
    
    await db.flush()
    
    logger.info(f"Manually assigned item {gallery_item_id} to surfer {surfer_id} (access={access_type})")
    return {"success": True, "surfer_gallery_item_id": surfer_item.id}


async def safe_delete_gallery_item(
    db: AsyncSession,
    gallery_item_id: str,
    photographer_id: str
) -> dict:
    """
    Safely delete a gallery item, protecting paid surfer locker items.
    
    Logic:
    - If any surfer has is_paid=True or access_type in ('included', 'purchased', 'gifted'):
      → SOFT DELETE: hide from photographer, preserve URLs for surfers
    - Otherwise:
      → HARD DELETE: remove entirely
    """
    item_result = await db.execute(
        select(GalleryItem).where(
            GalleryItem.id == gallery_item_id,
            GalleryItem.photographer_id == photographer_id
        )
    )
    item = item_result.scalar_one_or_none()
    if not item:
        return {"error": "Gallery item not found or not authorized"}
    
    # Check if any surfer has paid for this item
    paid_surfers = await db.execute(
        select(SurferGalleryItem).where(
            SurferGalleryItem.gallery_item_id == gallery_item_id,
            SurferGalleryItem.access_type.in_(['included', 'purchased', 'gifted'])
        )
    )
    paid_items = paid_surfers.scalars().all()
    
    if paid_items:
        # SOFT DELETE: Preserve media URLs in each paid surfer's locker item
        for paid_item in paid_items:
            paid_item.preserved_original_url = item.original_url
            paid_item.preserved_preview_url = item.preview_url
            paid_item.preserved_thumbnail_url = item.thumbnail_url
            paid_item.preserved_media_type = item.media_type
        
        # Mark as soft-deleted (hidden from photographer's gallery)
        item.is_deleted = True
        item.deleted_at = datetime.now(timezone.utc)
        item.is_public = False
        
        # Delete unpaid surfer items (they never paid, no obligation)
        unpaid_result = await db.execute(
            select(SurferGalleryItem).where(
                SurferGalleryItem.gallery_item_id == gallery_item_id,
                SurferGalleryItem.access_type.in_(['pending', 'pending_selection'])
            )
        )
        for unpaid_item in unpaid_result.scalars().all():
            await db.delete(unpaid_item)
        
        await db.flush()
        logger.info(
            f"Soft-deleted gallery item {gallery_item_id} "
            f"(preserved for {len(paid_items)} paid surfers)"
        )
        return {
            "deleted": True, 
            "soft_delete": True, 
            "preserved_for_surfers": len(paid_items),
            "message": f"Item hidden from your gallery. {len(paid_items)} surfer(s) who paid still have access."
        }
    else:
        # HARD DELETE: No paid surfers, safe to remove entirely
        # Delete all unpaid surfer items first
        unpaid_result = await db.execute(
            select(SurferGalleryItem).where(
                SurferGalleryItem.gallery_item_id == gallery_item_id
            )
        )
        for surfer_item in unpaid_result.scalars().all():
            await db.delete(surfer_item)
        
        # Update gallery item count
        if item.gallery_id:
            gallery_result = await db.execute(
                select(Gallery).where(Gallery.id == item.gallery_id)
            )
            gallery = gallery_result.scalar_one_or_none()
            if gallery:
                gallery.item_count = max(0, (gallery.item_count or 0) - 1)
        
        await db.delete(item)
        await db.flush()
        logger.info(f"Hard-deleted gallery item {gallery_item_id} (no paid surfers)")
        return {"deleted": True, "soft_delete": False, "message": "Item permanently deleted."}
