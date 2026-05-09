"""
Gallery Distribution Service
Handles automatic and manual distribution of gallery items to surfer lockers.
Extracted from gallery_sync.py (v95 audit) for LOC governance.
"""

from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from models import (
    Gallery, GalleryItem, Profile, SurfSpot, DispatchRequest,
    LiveSession, SurferGalleryItem, GalleryTierEnum,
    LiveSessionParticipant, BookingParticipant,
    Notification, SurferGalleryClaimQueue, Surfboard
)
import json as _json
import logging

logger = logging.getLogger(__name__)


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
