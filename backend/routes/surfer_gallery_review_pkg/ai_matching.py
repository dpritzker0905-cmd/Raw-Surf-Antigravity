"""
Surfer Gallery Review — AI Session Matching
Handles AI-powered photo analysis and batch session matching.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from sqlalchemy.orm import selectinload
from typing import Optional
from datetime import datetime, timezone
import logging
import json

from database import get_db
from models import (
    Profile, SurferGalleryClaimQueue, GalleryItem,
    LiveSessionParticipant, BookingParticipant, DispatchRequest
)
from core.security import get_user_id_from_jwt_or_query

router = APIRouter(prefix="/surfer-gallery", tags=["Surfer Gallery Review"])
logger = logging.getLogger(__name__)


async def _get_session_selfie(surfer_id: str, db: AsyncSession) -> Optional[str]:
    """Get the most recent session selfie for a surfer from any source."""
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
        return live_participant.selfie_url

    # Check DispatchRequest
    dispatch_result = await db.execute(
        select(DispatchRequest)
        .where(DispatchRequest.surfer_id == surfer_id)
        .where(DispatchRequest.selfie_url.isnot(None))
        .order_by(DispatchRequest.created_at.desc())
        .limit(1)
    )
    dispatch = dispatch_result.scalar_one_or_none()
    if dispatch and dispatch.selfie_url:
        return dispatch.selfie_url

    # Check BookingParticipant
    booking_participant_result = await db.execute(
        select(BookingParticipant)
        .where(BookingParticipant.participant_id == surfer_id)
        .where(BookingParticipant.selfie_url.isnot(None))
        .order_by(BookingParticipant.joined_at.desc())
        .limit(1)
    )
    booking_participant = booking_participant_result.scalar_one_or_none()
    if booking_participant and booking_participant.selfie_url:
        return booking_participant.selfie_url

    return None


@router.get("/ai-sessions")
async def get_ai_sessions(
    surfer_id: str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    """
    Get list of sessions with pending AI-matched clips for a surfer.
    Groups claim queue items by session (booking or live session).
    """
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

    sessions_map = {}

    for item in queue_items:
        session_id = item.live_session_id or item.booking_id
        if not session_id:
            continue

        if session_id not in sessions_map:
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

        sessions_map[session_id]["pending_count"] += 1
        sessions_map[session_id]["total_confidence"] += (item.ai_confidence or 0)

        if not sessions_map[session_id]["thumbnail_url"] and item.gallery_item:
            sessions_map[session_id]["thumbnail_url"] = item.gallery_item.thumbnail_url

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

    result = await db.execute(
        select(Profile).where(Profile.id == surfer_id)
    )
    surfer = result.scalar_one_or_none()

    if not surfer:
        raise HTTPException(status_code=404, detail="Surfer not found")

    session_selfie_url = await _get_session_selfie(surfer_id, db)

    profile = SurferProfile(
        profile_photo_url=surfer.avatar_url,
        session_selfie_url=session_selfie_url,
        board_description=getattr(surfer, 'board_description', None),
        wetsuit_description=surfer.wetsuit_color,
        rash_guard_description=surfer.rash_guard_color,
        stance=surfer.stance,
        tagged_photos=[]
    )

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

    surfer_result = await db.execute(
        select(Profile).where(Profile.id == surfer_id)
    )
    surfer = surfer_result.scalar_one_or_none()

    if not surfer:
        raise HTTPException(status_code=404, detail="Surfer not found")

    items_result = await db.execute(
        select(GalleryItem).where(
            GalleryItem.session_id == session_id
        )
    )
    gallery_items = items_result.scalars().all()

    if not gallery_items:
        return {"success": False, "message": "No photos found for session"}

    session_selfie_url = await _get_session_selfie(surfer_id, db)

    profile = SurferProfile(
        profile_photo_url=surfer.avatar_url,
        session_selfie_url=session_selfie_url,
        board_description=getattr(surfer, 'board_description', None),
        wetsuit_description=surfer.wetsuit_color,
        rash_guard_description=surfer.rash_guard_color,
        stance=surfer.stance
    )

    photo_urls = [item.preview_url or item.original_url for item in gallery_items if item.preview_url or item.original_url]

    results = await batch_analyze_session_photos(
        photo_urls=photo_urls,
        surfer_profile=profile,
        session_context=f"Session ID: {session_id}"
    )

    matches_created = 0
    for i, result in enumerate(results):
        if result["is_match"] and result["confidence"] >= 0.5:
            gi = next((item for item in gallery_items if (item.preview_url or item.original_url) == result["photo_url"]), None)
            if not gi:
                continue

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

            queue_item = SurferGalleryClaimQueue(
                surfer_id=surfer_id,
                photographer_id=gi.photographer_id,
                gallery_item_id=gi.id,
                booking_id=None,
                live_session_id=gi.session_id,
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
