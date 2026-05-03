"""
Surfer Gallery Review — Match Claims & Identity Confirmation
Handles single/batch match claiming, dismissal, and identity confirmation.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from sqlalchemy.orm import selectinload
from datetime import datetime, timezone
import logging

from database import get_db
from models import Profile, SurferGalleryItem, SurferGalleryClaimQueue
from core.security import get_user_id_from_jwt_or_query
from .schemas import ClaimMatchRequest, ClaimBatchRequest, ConfirmIdentityRequest, _parse_match_reasons
from .entitlements import get_session_entitlements

router = APIRouter(prefix="/surfer-gallery-review", tags=["Surfer Gallery Review"])
logger = logging.getLogger(__name__)


@router.get("/proposed-matches/{session_id}")
async def get_proposed_matches(
    session_id: str,
    user_id: str = Depends(get_user_id_from_jwt_or_query),
    db: AsyncSession = Depends(get_db)
):
    """
    Get AI-proposed matches for a session.
    Returns matches from the SurferGalleryClaimQueue.

    Paid accounts get full preview URLs.
    Free accounts get thumbnail URLs only.
    """
    user_result = await db.execute(
        select(Profile).where(Profile.id == user_id)
    )
    user = user_result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    is_paid_account = not user.is_ad_supported

    result = await db.execute(
        select(SurferGalleryClaimQueue)
        .options(selectinload(SurferGalleryClaimQueue.gallery_item))
        .where(
            and_(
                SurferGalleryClaimQueue.surfer_id == user_id,
                SurferGalleryClaimQueue.live_session_id == session_id,
                SurferGalleryClaimQueue.status == 'pending'
            )
        )
        .order_by(SurferGalleryClaimQueue.ai_confidence.desc())
    )
    queue_items = result.scalars().all()

    # Also check booking_id match
    booking_result = await db.execute(
        select(SurferGalleryClaimQueue)
        .options(selectinload(SurferGalleryClaimQueue.gallery_item))
        .where(
            and_(
                SurferGalleryClaimQueue.surfer_id == user_id,
                SurferGalleryClaimQueue.booking_id == session_id,
                SurferGalleryClaimQueue.status == 'pending'
            )
        )
        .order_by(SurferGalleryClaimQueue.ai_confidence.desc())
    )
    booking_items = booking_result.scalars().all()

    # Combine and deduplicate
    seen_ids = {item.id for item in queue_items}
    for item in booking_items:
        if item.id not in seen_ids:
            queue_items.append(item)

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

        if is_paid_account:
            match_data["preview_url"] = gi.preview_url
            match_data["original_url"] = gi.original_url if gi.url_720p else gi.preview_url
        else:
            match_data["preview_url"] = gi.thumbnail_url

        matches.append(match_data)

    return {
        "matches": matches,
        "total": len(matches),
        "is_paid_account": is_paid_account
    }


@router.post("/claim-match")
async def claim_single_match(
    request: ClaimMatchRequest,
    user_id: str = Depends(get_user_id_from_jwt_or_query),
    db: AsyncSession = Depends(get_db)
):
    """
    Claim a single AI-proposed match.
    Used by Free accounts in sequential mode.
    """
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

    entitlements = await get_session_entitlements(
        request.session_id, user_id, db
    )

    if entitlements["is_all_inclusive"]:
        access_type = "included"
        payment_method = "included"
    elif request.use_credit and entitlements["credits_remaining"] > 0:
        access_type = "included"
        payment_method = "included"
    else:
        user_result = await db.execute(
            select(Profile).where(Profile.id == user_id)
        )
        user = user_result.scalar_one_or_none()

        if not user or user.credit_balance < entitlements["price_per_clip"]:
            raise HTTPException(status_code=402, detail="Insufficient balance")

        user.credit_balance -= entitlements["price_per_clip"]
        access_type = "purchased"
        payment_method = "credits"

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
    user_id: str = Depends(get_user_id_from_jwt_or_query),
    db: AsyncSession = Depends(get_db)
):
    """
    Claim multiple AI-proposed matches at once.
    Used by Paid accounts in batch mode.
    """
    if not request.match_ids:
        raise HTTPException(status_code=400, detail="No matches selected")

    entitlements = await get_session_entitlements(
        request.session_id, user_id, db
    )

    user_result = await db.execute(
        select(Profile).where(Profile.id == user_id)
    )
    user = user_result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    credits_available = entitlements["credits_remaining"]
    is_all_inclusive = entitlements["is_all_inclusive"]
    price_per_clip = entitlements["price_per_clip"]

    claimed_count = 0
    total_cost = 0.0

    for match_id in request.match_ids:
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

        if is_all_inclusive or (request.use_credits and credits_available > 0):
            access_type = "included"
            payment_method = "included"
            if not is_all_inclusive:
                credits_available -= 1
        else:
            if user.credit_balance < price_per_clip:
                logger.warning(f"Insufficient balance for user {user_id}, skipping remaining items")
                break

            user.credit_balance -= price_per_clip
            total_cost += price_per_clip
            access_type = "purchased"
            payment_method = "credits"

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
    user_id: str = Depends(get_user_id_from_jwt_or_query),
    db: AsyncSession = Depends(get_db)
):
    """Dismiss an AI-proposed match (user says 'not me')."""
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
    user_id: str = Depends(get_user_id_from_jwt_or_query),
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
        return {"success": True, "status": "confirmed", "message": "Identity confirmed"}
    else:
        queue_item.status = 'rejected'
        queue_item.rejected_at = datetime.now(timezone.utc)
        await db.commit()

        return {"success": True, "status": "rejected", "message": "Match rejected"}
