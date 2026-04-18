"""
Surfer Gallery Review API - AI Proposed Matches & Entitlements
Implements the Service-Entitlement & Review Logic:

Account Tier (Paid vs Free) controls the Review UX:
- PAID: Full Session Insight - can preview all clips
- FREE: Sequential Claiming - must claim one-by-one

Entitlement Logic:
- Logic A: All-Inclusive (is_all_inclusive) → All clips unlocked
- Logic B: Partial Inclusion (included_media_count > 0) → Credit-based
- Logic C: Zero Inclusion → Pay-per-clip
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_
from sqlalchemy.orm import selectinload
from typing import Optional, List
from datetime import datetime, timezone
from pydantic import BaseModel
import logging
import json

from database import get_db
from models import (
    Profile, SurferGalleryItem, SurferGalleryClaimQueue, 
    GalleryItem, Booking, LiveSession, BookingParticipant,
    LiveSessionParticipant, DispatchRequest
)

router = APIRouter(prefix="/surfer-gallery-review", tags=["Surfer Gallery Review"])
logger = logging.getLogger(__name__)


class ClaimMatchRequest(BaseModel):
    match_id: str
    session_id: str
    use_credit: bool = True


class ClaimBatchRequest(BaseModel):
    match_ids: List[str]
    session_id: str
    use_credits: bool = True


class ConfirmIdentityRequest(BaseModel):
    match_id: str
    is_confirmed: bool


@router.get("/proposed-matches/{session_id}")
async def get_proposed_matches(
    session_id: str,
    user_id: str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    """
    Get AI-proposed matches for a session.
    Returns matches from the SurferGalleryClaimQueue.
    
    Paid accounts get full preview URLs.
    Free accounts get thumbnail URLs only.
    """
    # Get user account tier
    user_result = await db.execute(
        select(Profile).where(Profile.id == user_id)
    )
    user = user_result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    is_paid_account = not user.is_ad_supported
    
    # Get pending matches from queue
    result = await db.execute(
        select(SurferGalleryClaimQueue)
        .options(selectinload(SurferGalleryClaimQueue.gallery_item))
        .where(
            and_(
                SurferGalleryClaimQueue.surfer_id == user_id,
                or_(
                    SurferGalleryClaimQueue.live_session_id == session_id,
                    SurferGalleryClaimQueue.booking_id == session_id
                ),
                SurferGalleryClaimQueue.status == 'pending'
            )
        )
        .order_by(SurferGalleryClaimQueue.ai_confidence.desc())
    )
    queue_items = result.scalars().all()
    
    matches = []
    for item in queue_items:
        gi = item.gallery_item
        if not gi:
            continue
            
        match_data = {
            "id": item.id,
            "gallery_item_id": gi.id,
            "media_type": gi.media_type,
            "thumbnail_url": gi.thumbnail_url,
            "ai_confidence": item.ai_confidence,
            "ai_match_method": _parse_match_reasons(item.ai_match_reasons),
            "needs_identity_confirmation": item.ai_confidence < 0.8,
            "resolution_tier": "pro" if gi.url_720p else "standard",
            "created_at": item.created_at.isoformat() if item.created_at else None
        }
        
        # Paid accounts get preview URLs
        if is_paid_account:
            match_data["preview_url"] = gi.preview_url
            match_data["original_url"] = gi.original_url if gi.url_720p else gi.preview_url
        else:
            match_data["preview_url"] = gi.thumbnail_url  # Blurred on frontend
            
        matches.append(match_data)
    
    return {
        "matches": matches,
        "total": len(matches),
        "is_paid_account": is_paid_account
    }


def _parse_match_reasons(reasons_json: str) -> str:
    """Parse AI match reasons JSON and return primary method"""
    if not reasons_json:
        return "ai_match"
    try:
        reasons = json.loads(reasons_json)
        if isinstance(reasons, list) and len(reasons) > 0:
            return reasons[0]
        return "ai_match"
    except Exception:
        return "ai_match"


@router.get("/session-entitlements/{session_id}")
async def get_session_entitlements(
    session_id: str,
    user_id: str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    """
    Get entitlement info for a session.
    Returns: is_all_inclusive, included_media_count, claimed_count, price_per_clip
    """
    # Try to find as booking first
    booking_result = await db.execute(
        select(Booking).where(Booking.id == session_id)
    )
    booking = booking_result.scalar_one_or_none()
    
    if booking:
        # Check if user is a participant
        participant_result = await db.execute(
            select(BookingParticipant).where(
                and_(
                    BookingParticipant.booking_id == session_id,
                    BookingParticipant.user_id == user_id
                )
            )
        )
        _ = participant_result.scalar_one_or_none()  # Check if participant exists
        
        # Calculate entitlements from booking
        included_count = booking.booking_photos_included or 0
        is_all_inclusive = booking.booking_full_gallery or False
        price_per_clip = booking.booking_price_standard or 5.0
        
        # Count already claimed items
        claimed_result = await db.execute(
            select(func.count()).select_from(SurferGalleryItem).where(
                and_(
                    SurferGalleryItem.surfer_id == user_id,
                    SurferGalleryItem.booking_id == session_id,
                    SurferGalleryItem.access_type.in_(['included', 'purchased', 'claimed'])
                )
            )
        )
        claimed_count = claimed_result.scalar() or 0
        
        return {
            "session_id": session_id,
            "session_type": "booking",
            "is_all_inclusive": is_all_inclusive,
            "included_media_count": included_count,
            "claimed_count": claimed_count,
            "credits_remaining": max(0, included_count - claimed_count),
            "price_per_clip": price_per_clip,
            "resolution_tier": "pro" if booking.booking_type == "scheduled" else "standard"
        }
    
    # Try as live session
    session_result = await db.execute(
        select(LiveSession).where(LiveSession.id == session_id)
    )
    live_session = session_result.scalar_one_or_none()
    
    if live_session:
        # Get photographer's pricing
        photographer_result = await db.execute(
            select(Profile).where(Profile.id == live_session.broadcaster_id)
        )
        photographer = photographer_result.scalar_one_or_none()
        
        included_count = photographer.photo_package_size if photographer else 0
        price_per_clip = photographer.live_photo_price if photographer else 5.0
        
        # Count claimed
        claimed_result = await db.execute(
            select(func.count()).select_from(SurferGalleryItem).where(
                and_(
                    SurferGalleryItem.surfer_id == user_id,
                    SurferGalleryItem.live_session_id == session_id,
                    SurferGalleryItem.access_type.in_(['included', 'purchased', 'claimed'])
                )
            )
        )
        claimed_count = claimed_result.scalar() or 0
        
        return {
            "session_id": session_id,
            "session_type": "live",
            "is_all_inclusive": False,
            "included_media_count": included_count,
            "claimed_count": claimed_count,
            "credits_remaining": max(0, included_count - claimed_count),
            "price_per_clip": price_per_clip,
            "resolution_tier": "standard"
        }
    
    # Default response
    return {
        "session_id": session_id,
        "session_type": "unknown",
        "is_all_inclusive": False,
        "included_media_count": 0,
        "claimed_count": 0,
        "credits_remaining": 0,
        "price_per_clip": 5.0,
        "resolution_tier": "standard"
    }


@router.post("/claim-match")
async def claim_single_match(
    request: ClaimMatchRequest,
    user_id: str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    """
    Claim a single AI-proposed match.
    Used by Free accounts in sequential mode.
    """
    # Get the queue item
    result = await db.execute(
        select(SurferGalleryClaimQueue)
        .options(selectinload(SurferGalleryClaimQueue.gallery_item))
        .where(
            and_(
                SurferGalleryClaimQueue.id == request.match_id,
                SurferGalleryClaimQueue.surfer_id == user_id,
                SurferGalleryClaimQueue.status == 'pending'
            )
        )
    )
    queue_item = result.scalar_one_or_none()
    
    if not queue_item:
        raise HTTPException(status_code=404, detail="Match not found")
    
    # Get entitlements
    entitlements = await get_session_entitlements(
        request.session_id, user_id, db
    )
    
    # Determine access type
    if entitlements["is_all_inclusive"]:
        access_type = "included"
        payment_method = "included"
    elif request.use_credit and entitlements["credits_remaining"] > 0:
        access_type = "included"
        payment_method = "included"
    else:
        # Deduct from wallet
        user_result = await db.execute(
            select(Profile).where(Profile.id == user_id)
        )
        user = user_result.scalar_one_or_none()
        
        if not user or user.credit_balance < entitlements["price_per_clip"]:
            raise HTTPException(status_code=402, detail="Insufficient balance")
        
        user.credit_balance -= entitlements["price_per_clip"]
        access_type = "purchased"
        payment_method = "credits"
    
    # Create SurferGalleryItem
    surfer_item = SurferGalleryItem(
        surfer_id=user_id,
        gallery_item_id=queue_item.gallery_item_id,
        photographer_id=queue_item.photographer_id,
        booking_id=queue_item.booking_id,
        live_session_id=queue_item.live_session_id,
        is_paid=True,
        paid_amount=entitlements["price_per_clip"] if access_type == "purchased" else 0,
        paid_at=datetime.now(timezone.utc),
        payment_method=payment_method,
        access_type=access_type,
        ai_suggested=True,
        ai_confidence=queue_item.ai_confidence,
        ai_match_method=_parse_match_reasons(queue_item.ai_match_reasons),
        surfer_confirmed=True
    )
    db.add(surfer_item)
    
    # Update queue item status
    queue_item.status = 'claimed'
    queue_item.claimed_at = datetime.now(timezone.utc)
    
    await db.commit()
    
    return {
        "success": True,
        "claimed_item_id": surfer_item.id,
        "access_type": access_type,
        "payment_method": payment_method
    }


@router.post("/claim-matches-batch")
async def claim_matches_batch(
    request: ClaimBatchRequest,
    user_id: str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    """
    Claim multiple AI-proposed matches at once.
    Used by Paid accounts in batch mode.
    """
    if not request.match_ids:
        raise HTTPException(status_code=400, detail="No matches selected")
    
    # Get entitlements
    entitlements = await get_session_entitlements(
        request.session_id, user_id, db
    )
    
    # Get user for wallet deductions
    user_result = await db.execute(
        select(Profile).where(Profile.id == user_id)
    )
    user = user_result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Calculate costs
    credits_available = entitlements["credits_remaining"]
    is_all_inclusive = entitlements["is_all_inclusive"]
    price_per_clip = entitlements["price_per_clip"]
    
    claimed_count = 0
    total_cost = 0.0
    
    for match_id in request.match_ids:
        # Get queue item
        result = await db.execute(
            select(SurferGalleryClaimQueue)
            .options(selectinload(SurferGalleryClaimQueue.gallery_item))
            .where(
                and_(
                    SurferGalleryClaimQueue.id == match_id,
                    SurferGalleryClaimQueue.surfer_id == user_id,
                    SurferGalleryClaimQueue.status == 'pending'
                )
            )
        )
        queue_item = result.scalar_one_or_none()
        if not queue_item:
            continue
        
        # Determine access type
        if is_all_inclusive or (request.use_credits and credits_available > 0):
            access_type = "included"
            payment_method = "included"
            if not is_all_inclusive:
                credits_available -= 1
        else:
            # Check wallet balance
            if user.credit_balance < price_per_clip:
                logger.warning(f"Insufficient balance for user {user_id}, skipping remaining items")
                break
            
            user.credit_balance -= price_per_clip
            total_cost += price_per_clip
            access_type = "purchased"
            payment_method = "credits"
        
        # Create gallery item
        surfer_item = SurferGalleryItem(
            surfer_id=user_id,
            gallery_item_id=queue_item.gallery_item_id,
            photographer_id=queue_item.photographer_id,
            booking_id=queue_item.booking_id,
            live_session_id=queue_item.live_session_id,
            is_paid=True,
            paid_amount=price_per_clip if access_type == "purchased" else 0,
            paid_at=datetime.now(timezone.utc),
            payment_method=payment_method,
            access_type=access_type,
            ai_suggested=True,
            ai_confidence=queue_item.ai_confidence,
            ai_match_method=_parse_match_reasons(queue_item.ai_match_reasons),
            surfer_confirmed=True
        )
        db.add(surfer_item)
        
        # Update queue status
        queue_item.status = 'claimed'
        queue_item.claimed_at = datetime.now(timezone.utc)
        
        claimed_count += 1
    
    await db.commit()
    
    return {
        "success": True,
        "claimed_count": claimed_count,
        "total_cost": total_cost,
        "credits_used": len(request.match_ids) - int(total_cost / price_per_clip) if price_per_clip > 0 else 0
    }


@router.post("/dismiss-match")
async def dismiss_match(
    match_id: str = Query(...),
    session_id: str = Query(...),
    user_id: str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    """
    Dismiss an AI-proposed match (user says "not me").
    """
    result = await db.execute(
        select(SurferGalleryClaimQueue).where(
            and_(
                SurferGalleryClaimQueue.id == match_id,
                SurferGalleryClaimQueue.surfer_id == user_id,
                SurferGalleryClaimQueue.status == 'pending'
            )
        )
    )
    queue_item = result.scalar_one_or_none()
    
    if not queue_item:
        raise HTTPException(status_code=404, detail="Match not found")
    
    queue_item.status = 'rejected'
    queue_item.rejected_at = datetime.now(timezone.utc)
    
    await db.commit()
    
    return {"success": True, "message": "Match dismissed"}


@router.post("/confirm-identity")
async def confirm_identity(
    request: ConfirmIdentityRequest,
    user_id: str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    """
    Confirm or reject AI identity match.
    Helps improve AI matching accuracy.
    """
    result = await db.execute(
        select(SurferGalleryClaimQueue).where(
            and_(
                SurferGalleryClaimQueue.id == request.match_id,
                SurferGalleryClaimQueue.surfer_id == user_id
            )
        )
    )
    queue_item = result.scalar_one_or_none()
    
    if not queue_item:
        raise HTTPException(status_code=404, detail="Match not found")
    
    if request.is_confirmed:
        # User confirmed - keep in queue for claiming
        # Could also auto-claim here if desired
        return {"success": True, "status": "confirmed", "message": "Identity confirmed"}
    else:
        # User rejected - remove from queue
        queue_item.status = 'rejected'
        queue_item.rejected_at = datetime.now(timezone.utc)
        await db.commit()
        
        return {"success": True, "status": "rejected", "message": "Match rejected"}


@router.get("/resolution-upsell/{gallery_item_id}")
async def get_resolution_upsell(
    gallery_item_id: str,
    user_id: str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    """
    Get upsell pricing to upgrade from Social (1080p) to RAW resolution.
    Only available for Standard tier users with Pro-tier content.
    """
    # Get the surfer's gallery item
    result = await db.execute(
        select(SurferGalleryItem)
        .options(selectinload(SurferGalleryItem.gallery_item))
        .where(
            and_(
                SurferGalleryItem.gallery_item_id == gallery_item_id,
                SurferGalleryItem.surfer_id == user_id
            )
        )
    )
    surfer_item = result.scalar_one_or_none()
    
    if not surfer_item:
        raise HTTPException(status_code=404, detail="Item not found")
    
    gi = surfer_item.gallery_item
    
    # Check if upgrade is available
    if surfer_item.gallery_tier == 'pro':
        return {"upgrade_available": False, "reason": "Already at Pro tier"}
    
    if not gi.original_url:
        return {"upgrade_available": False, "reason": "RAW not available for this item"}
    
    # Calculate upgrade price (difference between tiers)
    current_price = gi.price_standard or 5.0
    raw_price = gi.price_high or 10.0
    upgrade_price = raw_price - current_price
    
    return {
        "upgrade_available": True,
        "current_tier": "standard",
        "target_tier": "pro",
        "current_resolution": "1080p",
        "target_resolution": "4K RAW",
        "upgrade_price": max(0, upgrade_price),
        "media_type": gi.media_type
    }


@router.post("/upgrade-resolution/{gallery_item_id}")
async def upgrade_resolution(
    gallery_item_id: str,
    user_id: str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    """
    Upgrade a Standard tier item to Pro tier (RAW resolution).
    Deducts upgrade price from user wallet.
    """
    # Get upsell info
    upsell = await get_resolution_upsell(gallery_item_id, user_id, db)
    
    if not upsell.get("upgrade_available"):
        raise HTTPException(status_code=400, detail=upsell.get("reason", "Upgrade not available"))
    
    # Get user
    user_result = await db.execute(
        select(Profile).where(Profile.id == user_id)
    )
    user = user_result.scalar_one_or_none()
    
    if not user or user.credit_balance < upsell["upgrade_price"]:
        raise HTTPException(status_code=402, detail="Insufficient balance")
    
    # Deduct and upgrade
    user.credit_balance -= upsell["upgrade_price"]
    
    # Update surfer gallery item
    result = await db.execute(
        select(SurferGalleryItem).where(
            and_(
                SurferGalleryItem.gallery_item_id == gallery_item_id,
                SurferGalleryItem.surfer_id == user_id
            )
        )
    )
    surfer_item = result.scalar_one_or_none()
    
    if surfer_item:
        surfer_item.gallery_tier = 'pro'
        surfer_item.max_photo_quality = 'high'
        surfer_item.max_video_quality = '4k'
        surfer_item.paid_amount = (surfer_item.paid_amount or 0) + upsell["upgrade_price"]
    
    await db.commit()
    
    return {
        "success": True,
        "new_tier": "pro",
        "new_resolution": "4K RAW",
        "amount_charged": upsell["upgrade_price"]
    }



@router.get("/ai-sessions")
async def get_ai_sessions(
    surfer_id: str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    """
    Get list of sessions with pending AI-matched clips for a surfer.
    Groups claim queue items by session (booking or live session).
    """
    # Get all pending queue items for this surfer
    result = await db.execute(
        select(SurferGalleryClaimQueue)
        .options(
            selectinload(SurferGalleryClaimQueue.gallery_item),
            selectinload(SurferGalleryClaimQueue.photographer),
            selectinload(SurferGalleryClaimQueue.booking),
            selectinload(SurferGalleryClaimQueue.live_session)
        )
        .where(
            and_(
                SurferGalleryClaimQueue.surfer_id == surfer_id,
                SurferGalleryClaimQueue.status == 'pending'
            )
        )
        .order_by(SurferGalleryClaimQueue.created_at.desc())
    )
    queue_items = result.scalars().all()
    
    # Group by session
    sessions_map = {}
    
    for item in queue_items:
        session_id = item.live_session_id or item.booking_id
        if not session_id:
            continue
            
        if session_id not in sessions_map:
            # Get session details
            if item.live_session_id and item.live_session:
                session = item.live_session
                sessions_map[session_id] = {
                    "id": session_id,
                    "type": "live",
                    "spot_name": getattr(session, 'spot_name', None) or "Live Session",
                    "photographer_name": item.photographer.full_name if item.photographer else None,
                    "photographer_id": item.photographer_id,
                    "created_at": session.created_at.isoformat() if session.created_at else None,
                    "thumbnail_url": None,
                    "pending_count": 0,
                    "total_confidence": 0.0
                }
            elif item.booking_id and item.booking:
                booking = item.booking
                sessions_map[session_id] = {
                    "id": session_id,
                    "type": "booking",
                    "spot_name": getattr(booking, 'booking_title', None) or "Booking Session",
                    "photographer_name": item.photographer.full_name if item.photographer else None,
                    "photographer_id": item.photographer_id,
                    "created_at": booking.created_at.isoformat() if booking.created_at else None,
                    "thumbnail_url": None,
                    "pending_count": 0,
                    "total_confidence": 0.0
                }
            else:
                sessions_map[session_id] = {
                    "id": session_id,
                    "type": "unknown",
                    "spot_name": "Session",
                    "photographer_name": item.photographer.full_name if item.photographer else None,
                    "photographer_id": item.photographer_id,
                    "created_at": item.created_at.isoformat() if item.created_at else None,
                    "thumbnail_url": None,
                    "pending_count": 0,
                    "total_confidence": 0.0
                }
        
        # Update counts and thumbnail
        sessions_map[session_id]["pending_count"] += 1
        sessions_map[session_id]["total_confidence"] += (item.ai_confidence or 0)
        
        # Use first item's thumbnail as session thumbnail
        if not sessions_map[session_id]["thumbnail_url"] and item.gallery_item:
            sessions_map[session_id]["thumbnail_url"] = item.gallery_item.thumbnail_url
    
    # Calculate average confidence and sort by pending count
    sessions = list(sessions_map.values())
    for session in sessions:
        if session["pending_count"] > 0:
            session["ai_confidence"] = session["total_confidence"] / session["pending_count"]
        else:
            session["ai_confidence"] = 0
        del session["total_confidence"]
    
    sessions.sort(key=lambda s: s["pending_count"], reverse=True)
    
    return {
        "sessions": sessions,
        "total_pending": sum(s["pending_count"] for s in sessions)
    }



@router.post("/ai-analyze-photo")
async def ai_analyze_photo_for_surfer(
    photo_url: str = Query(...),
    surfer_id: str = Query(...),
    session_context: Optional[str] = Query(default=None),
    db: AsyncSession = Depends(get_db)
):
    """
    Analyze a photo using AI to determine if it contains a specific surfer.
    Uses face recognition, board colors, and wetsuit matching.
    """
    from services.ai_identity_matching import (
        analyze_image_for_surfer, 
        SurferProfile
    )
    
    # Get surfer profile data
    result = await db.execute(
        select(Profile).where(Profile.id == surfer_id)
    )
    surfer = result.scalar_one_or_none()
    
    if not surfer:
        raise HTTPException(status_code=404, detail="Surfer not found")
    
    # Try to get session selfie from LiveSessionParticipant or DispatchRequest
    session_selfie_url = None
    
    # Check LiveSessionParticipant first
    live_participant_result = await db.execute(
        select(LiveSessionParticipant)
        .where(LiveSessionParticipant.surfer_id == surfer_id)
        .where(LiveSessionParticipant.selfie_url.isnot(None))
        .order_by(LiveSessionParticipant.joined_at.desc())
        .limit(1)
    )
    live_participant = live_participant_result.scalar_one_or_none()
    if live_participant and live_participant.selfie_url:
        session_selfie_url = live_participant.selfie_url
    
    # If no live session selfie, check DispatchRequest
    if not session_selfie_url:
        dispatch_result = await db.execute(
            select(DispatchRequest)
            .where(DispatchRequest.surfer_id == surfer_id)
            .where(DispatchRequest.selfie_url.isnot(None))
            .order_by(DispatchRequest.created_at.desc())
            .limit(1)
        )
        dispatch = dispatch_result.scalar_one_or_none()
        if dispatch and dispatch.selfie_url:
            session_selfie_url = dispatch.selfie_url
    
    # If still no selfie, check BookingParticipant
    if not session_selfie_url:
        booking_participant_result = await db.execute(
            select(BookingParticipant)
            .where(BookingParticipant.participant_id == surfer_id)
            .where(BookingParticipant.selfie_url.isnot(None))
            .order_by(BookingParticipant.joined_at.desc())
            .limit(1)
        )
        booking_participant = booking_participant_result.scalar_one_or_none()
        if booking_participant and booking_participant.selfie_url:
            session_selfie_url = booking_participant.selfie_url
    
    # Build surfer profile for matching with all identification data
    profile = SurferProfile(
        profile_photo_url=surfer.avatar_url,
        session_selfie_url=session_selfie_url,
        board_description=getattr(surfer, 'board_description', None),
        wetsuit_description=surfer.wetsuit_color,
        rash_guard_description=surfer.rash_guard_color,
        stance=surfer.stance,
        tagged_photos=[]  # Could fetch from posts where user is tagged
    )
    
    # Run AI analysis
    match_result = await analyze_image_for_surfer(
        image_url=photo_url,
        surfer_profile=profile,
        additional_context=session_context
    )
    
    return {
        "photo_url": photo_url,
        "surfer_id": surfer_id,
        "is_match": match_result.is_match,
        "confidence": match_result.confidence,
        "match_methods": match_result.match_methods,
        "details": match_result.details
    }


@router.post("/ai-batch-analyze")
async def ai_batch_analyze_session(
    session_id: str = Query(...),
    surfer_id: str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    """
    Batch analyze all photos from a session to find matches for a surfer.
    Populates the SurferGalleryClaimQueue with AI matches.
    """
    from services.ai_identity_matching import (
        batch_analyze_session_photos,
        SurferProfile
    )
    
    # Get surfer profile
    surfer_result = await db.execute(
        select(Profile).where(Profile.id == surfer_id)
    )
    surfer = surfer_result.scalar_one_or_none()
    
    if not surfer:
        raise HTTPException(status_code=404, detail="Surfer not found")
    
    # Get all gallery items from the session
    # Try as booking first, then check session_id
    items_result = await db.execute(
        select(GalleryItem).where(
            GalleryItem.session_id == session_id
        )
    )
    gallery_items = items_result.scalars().all()
    
    if not gallery_items:
        return {"success": False, "message": "No photos found for session"}
    
    # Try to get session selfie from LiveSessionParticipant, DispatchRequest, or BookingParticipant
    session_selfie_url = None
    
    # Check LiveSessionParticipant first
    live_participant_result = await db.execute(
        select(LiveSessionParticipant)
        .where(LiveSessionParticipant.surfer_id == surfer_id)
        .where(LiveSessionParticipant.selfie_url.isnot(None))
        .order_by(LiveSessionParticipant.joined_at.desc())
        .limit(1)
    )
    live_participant = live_participant_result.scalar_one_or_none()
    if live_participant and live_participant.selfie_url:
        session_selfie_url = live_participant.selfie_url
    
    # If no live session selfie, check DispatchRequest
    if not session_selfie_url:
        dispatch_result = await db.execute(
            select(DispatchRequest)
            .where(DispatchRequest.surfer_id == surfer_id)
            .where(DispatchRequest.selfie_url.isnot(None))
            .order_by(DispatchRequest.created_at.desc())
            .limit(1)
        )
        dispatch = dispatch_result.scalar_one_or_none()
        if dispatch and dispatch.selfie_url:
            session_selfie_url = dispatch.selfie_url
    
    # If still no selfie, check BookingParticipant
    if not session_selfie_url:
        booking_participant_result = await db.execute(
            select(BookingParticipant)
            .where(BookingParticipant.participant_id == surfer_id)
            .where(BookingParticipant.selfie_url.isnot(None))
            .order_by(BookingParticipant.joined_at.desc())
            .limit(1)
        )
        booking_participant = booking_participant_result.scalar_one_or_none()
        if booking_participant and booking_participant.selfie_url:
            session_selfie_url = booking_participant.selfie_url
    
    # Build surfer profile with all identification data
    profile = SurferProfile(
        profile_photo_url=surfer.avatar_url,
        session_selfie_url=session_selfie_url,
        board_description=getattr(surfer, 'board_description', None),
        wetsuit_description=surfer.wetsuit_color,  # Use the profile wetsuit color
        rash_guard_description=surfer.rash_guard_color,  # Use the profile rash guard color
        stance=surfer.stance  # 'regular' or 'goofy'
    )
    
    # Get photo URLs
    photo_urls = [item.preview_url or item.original_url for item in gallery_items if item.preview_url or item.original_url]
    
    # Run batch analysis
    results = await batch_analyze_session_photos(
        photo_urls=photo_urls,
        surfer_profile=profile,
        session_context=f"Session ID: {session_id}"
    )
    
    # Create claim queue entries for matches
    matches_created = 0
    for i, result in enumerate(results):
        if result["is_match"] and result["confidence"] >= 0.5:
            # Find corresponding gallery item
            gi = next((item for item in gallery_items if (item.preview_url or item.original_url) == result["photo_url"]), None)
            if not gi:
                continue
            
            # Check if already in queue
            existing = await db.execute(
                select(SurferGalleryClaimQueue).where(
                    and_(
                        SurferGalleryClaimQueue.surfer_id == surfer_id,
                        SurferGalleryClaimQueue.gallery_item_id == gi.id
                    )
                )
            )
            if existing.scalar_one_or_none():
                continue
            
            # Create queue entry
            queue_item = SurferGalleryClaimQueue(
                surfer_id=surfer_id,
                photographer_id=gi.photographer_id,
                gallery_item_id=gi.id,
                booking_id=None,  # Will be set based on session type if needed
                live_session_id=gi.session_id,  # Use session_id from GalleryItem
                ai_confidence=result["confidence"],
                ai_match_reasons=json.dumps(result["match_methods"]),
                status='pending'
            )
            db.add(queue_item)
            matches_created += 1
    
    await db.commit()
    
    return {
        "success": True,
        "total_analyzed": len(results),
        "matches_found": sum(1 for r in results if r["is_match"]),
        "queue_entries_created": matches_created
    }
