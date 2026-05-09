"""
Reviews — Pending Review Discovery & Stats
Handles pending-for-user discovery and surfer review stats.
Extracted from reviews.py (v97 audit) for pre-emptive LOC governance.
"""
import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_
from sqlalchemy.orm import selectinload
from typing import Optional, List
from datetime import datetime, timezone, timedelta

from database import get_db
from models import Profile, Review, LiveSession, LiveSessionParticipant
from core.security import get_user_id_from_jwt_or_query

router = APIRouter(prefix="/reviews", tags=["reviews"])

logger = logging.getLogger(__name__)


def is_photographer_role(role):
    """Check if role is a photographer type"""
    if role is None:
        return False
    role_str = role.value if hasattr(role, 'value') else str(role)
    return role_str in ['Photographer', 'Approved Pro', 'Hobbyist', 'Grom Parent']


# ============ REVIEW CHECK & PENDING ENDPOINTS ============

@router.get("/check")
async def check_review_status(
    reviewer_id: str = Query(..., description="User checking if they've reviewed"),
    live_session_id: Optional[str] = Query(None),
    booking_id: Optional[str] = Query(None),
    dispatch_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db)
):
    """Check if a user has already reviewed a specific session"""
    
    filters = [Review.reviewer_id == reviewer_id]
    if live_session_id:
        filters.append(Review.live_session_id == live_session_id)
    elif booking_id:
        filters.append(Review.booking_id == booking_id)
    elif dispatch_id:
        filters.append(Review.dispatch_id == dispatch_id)
    else:
        return {"has_reviewed": False, "review_id": None}
    
    result = await db.execute(select(Review).where(and_(*filters)))
    review = result.scalar_one_or_none()
    
    return {
        "has_reviewed": review is not None,
        "review_id": review.id if review else None,
        "rating": review.rating if review else None
    }


@router.get("/pending-for-user")
async def get_pending_reviews_for_user(
    user_id: str = Depends(get_user_id_from_jwt_or_query),
    limit: int = Query(default=10, le=50),
    db: AsyncSession = Depends(get_db)
):
    """
    Get sessions where the user hasn't left a review yet.
    Returns completed sessions (from last 14 days) that still need a review.
    Minimum 20 minute session length required.
    """
    
    # Get user
    user_result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = user_result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    cutoff = datetime.now(timezone.utc) - timedelta(days=14)
    user_is_photographer = is_photographer_role(user.role)
    
    pending_reviews = []
    
    if user_is_photographer:
        # Photographer: find ended sessions they ran where they haven't reviewed each surfer
        sessions_result = await db.execute(
            select(LiveSession).where(
                and_(
                    LiveSession.photographer_id == user_id,
                    LiveSession.status == 'ended',
                    LiveSession.ended_at >= cutoff,
                    or_(
                        LiveSession.duration_mins >= 20,
                        LiveSession.duration_mins.is_(None)  # Allow if duration unknown
                    )
                )
            ).order_by(LiveSession.ended_at.desc()).limit(limit)
        )
        sessions = sessions_result.scalars().all()
        
        if sessions:
            session_ids = [s.id for s in sessions]
            session_map = {s.id: s for s in sessions}
            
            # Batch-load all completed participants for these sessions,
            # eagerly loading surfer profiles to avoid N+1
            participants_result = await db.execute(
                select(LiveSessionParticipant)
                .options(selectinload(LiveSessionParticipant.surfer))
                .where(
                    and_(
                        LiveSessionParticipant.session_id.in_(session_ids),
                        LiveSessionParticipant.status == 'completed'
                    )
                )
            )
            all_participants = participants_result.scalars().all()
            
            # Batch-load all existing reviews by this user for these sessions
            existing_reviews_result = await db.execute(
                select(Review.reviewee_id, Review.live_session_id).where(
                    and_(
                        Review.reviewer_id == user_id,
                        Review.live_session_id.in_(session_ids)
                    )
                )
            )
            reviewed_pairs = set(
                (row[0], row[1]) for row in existing_reviews_result.all()
            )
            
            for p in all_participants:
                if (p.surfer_id, p.session_id) not in reviewed_pairs:
                    session = session_map.get(p.session_id)
                    surfer = p.surfer
                    pending_reviews.append({
                        "session_id": p.session_id,
                        "session_type": "live",
                        "counterpart_id": p.surfer_id,
                        "counterpart_name": surfer.full_name if surfer else "Surfer",
                        "counterpart_avatar": surfer.avatar_url if surfer else None,
                        "session_date": session.ended_at.isoformat() if session and session.ended_at else None,
                        "location": session.location_name or "Session" if session else "Session"
                    })
    else:
        # Surfer: find completed live sessions they participated in,
        # eagerly loading photographer profiles
        participations_result = await db.execute(
            select(LiveSessionParticipant)
            .options(selectinload(LiveSessionParticipant.photographer))
            .where(
                and_(
                    LiveSessionParticipant.surfer_id == user_id,
                    LiveSessionParticipant.status == 'completed',
                    LiveSessionParticipant.completed_at >= cutoff
                )
            ).order_by(LiveSessionParticipant.completed_at.desc()).limit(limit)
        )
        participations = participations_result.scalars().all()
        
        if participations:
            session_ids = [p.session_id for p in participations]
            
            # Batch-load sessions (for duration check and location name)
            sessions_result = await db.execute(
                select(LiveSession).where(LiveSession.id.in_(session_ids))
            )
            session_map = {s.id: s for s in sessions_result.scalars().all()}
            
            # Batch-load existing reviews
            existing_reviews_result = await db.execute(
                select(Review.reviewee_id, Review.live_session_id).where(
                    and_(
                        Review.reviewer_id == user_id,
                        Review.live_session_id.in_(session_ids)
                    )
                )
            )
            reviewed_pairs = set(
                (row[0], row[1]) for row in existing_reviews_result.all()
            )
            
            for p in participations:
                session = session_map.get(p.session_id)
                
                # Skip sessions under 20 minutes
                if session and session.duration_mins is not None and session.duration_mins < 20:
                    continue
                
                if (p.photographer_id, p.session_id) not in reviewed_pairs:
                    photographer = p.photographer
                    pending_reviews.append({
                        "session_id": p.session_id,
                        "session_type": "live",
                        "counterpart_id": p.photographer_id,
                        "counterpart_name": photographer.full_name if photographer else "Photographer",
                        "counterpart_avatar": photographer.avatar_url if photographer else None,
                        "session_date": p.completed_at.isoformat() if p.completed_at else None,
                        "location": session.location_name if session else "Session"
                    })
    
    return pending_reviews[:limit]


@router.get("/surfer/{surfer_id}/stats")
async def get_surfer_review_stats(
    surfer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get aggregated review statistics for a surfer (reviews from photographers)"""
    
    avg_result = await db.execute(
        select(func.avg(Review.rating), func.count(Review.id))
        .where(
            and_(
                Review.reviewee_id == surfer_id,
                Review.review_type == 'photographer_to_surfer',
                Review.status == 'approved'
            )
        )
    )
    avg_row = avg_result.first()
    avg_rating = float(avg_row[0]) if avg_row[0] else 0.0
    total_reviews = avg_row[1] or 0
    
    # Get recent reviews (top 3) — eagerly load reviewer profile to avoid N+1
    recent_result = await db.execute(
        select(Review)
        .options(selectinload(Review.reviewer))
        .where(
            and_(
                Review.reviewee_id == surfer_id,
                Review.review_type == 'photographer_to_surfer',
                Review.status == 'approved'
            )
        )
        .order_by(Review.created_at.desc())
        .limit(3)
    )
    recent_reviews = recent_result.scalars().all()
    
    recent_responses = []
    for review in recent_reviews:
        reviewer = review.reviewer
        
        recent_responses.append({
            "id": review.id,
            "reviewer_name": reviewer.full_name if reviewer else "Unknown",
            "reviewer_avatar": reviewer.avatar_url if reviewer else None,
            "rating": review.rating,
            "comment": review.comment,
            "created_at": review.created_at.isoformat()
        })
    
    return {
        "average_rating": round(avg_rating, 1),
        "total_reviews": total_reviews,
        "recent_reviews": recent_responses
    }
