"""
Surfer Gallery Review â€” AI Session Matching
Handles AI-powered photo analysis and batch session matching.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from sqlalchemy.orm import selectinload
from typing import Optional
import logging

from database import get_db
from models import SurferGalleryClaimQueue
from core.security import get_current_user_id
from services.ai_identity_matching import MATCHING_UNAVAILABLE_MESSAGE

router = APIRouter(prefix="/surfer-gallery", tags=["Surfer Gallery Review"])
logger = logging.getLogger(__name__)


@router.get("/ai-sessions")
async def get_ai_sessions(
    surfer_id: str = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user_id: str = Depends(get_current_user_id)
):
    """
    Get list of sessions with pending AI-matched clips for a surfer.
    Groups claim queue items by session (booking or live session).
    """
    if surfer_id != current_user_id:
        raise HTTPException(status_code=403, detail="Cannot view another account's AI sessions")
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
async def ai_analyze_photo_for_surfer(photo_url: str = Query(...), surfer_id: str = Query(...),
                                     session_context: Optional[str] = Query(default=None),
                                     current_user_id: str = Depends(get_current_user_id)):
    if surfer_id != current_user_id:
        raise HTTPException(status_code=403, detail="Cannot analyze photos for another account")
    raise HTTPException(status_code=503, detail=MATCHING_UNAVAILABLE_MESSAGE)


@router.post("/ai-batch-analyze")
async def ai_batch_analyze_session(session_id: str = Query(...), surfer_id: str = Query(...),
                                   current_user_id: str = Depends(get_current_user_id)):
    if surfer_id != current_user_id:
        raise HTTPException(status_code=403, detail="Cannot analyze photos for another account")
    raise HTTPException(status_code=503, detail=MATCHING_UNAVAILABLE_MESSAGE)
