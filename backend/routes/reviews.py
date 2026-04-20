"""
Reviews API Routes - Two-Way Review System
Handles surfer-to-photographer and photographer-to-surfer reviews
with AI moderation for vulgarities
"""
import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_, text
from sqlalchemy.orm import selectinload
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime, timezone, timedelta
import re

from database import get_db
from models import Profile, Review, LiveSession, XPTransaction, Badge, LiveSessionParticipant
from services.ai_moderation import moderate_review_content

# Import badge check function
from routes.gamification import check_badge_milestones

router = APIRouter(prefix="/reviews", tags=["reviews"])

logger = logging.getLogger(__name__)
# ============ VULGAR WORD FILTER ============
# Basic list - in production would use a more comprehensive library or AI service
VULGAR_WORDS = [
    'fuck', 'shit', 'ass', 'bitch', 'damn', 'crap', 'bastard', 'dick', 'cock',
    'pussy', 'whore', 'slut', 'fag', 'nigger', 'cunt', 'asshole', 'motherfucker',
    'bullshit', 'piss', 'douche', 'retard', 'idiot', 'stupid', 'dumb'
]

def check_for_vulgarities(text: str) -> List[str]:
    """Check text for vulgar words, return list of found words"""
    if not text:
        return []
    
    text_lower = text.lower()
    found = []
    
    for word in VULGAR_WORDS:
        # Check for word boundaries
        pattern = r'\b' + re.escape(word) + r'\b'
        if re.search(pattern, text_lower):
            found.append(word)
    
    return found


# ============ PYDANTIC MODELS ============

class CreateReviewRequest(BaseModel):
    reviewee_id: str
    # Session linkage — at least one should be provided
    session_type: Optional[str] = None  # 'live', 'on_demand', 'scheduled'
    live_session_id: Optional[str] = None
    booking_id: Optional[str] = None
    dispatch_id: Optional[str] = None
    # Rating
    rating: int = Field(..., ge=1, le=5)
    comment: Optional[str] = None
    # Optional specific ratings
    punctuality_rating: Optional[int] = Field(None, ge=1, le=5)
    communication_rating: Optional[int] = Field(None, ge=1, le=5)
    photo_quality_rating: Optional[int] = Field(None, ge=1, le=5)


class ReviewResponse(BaseModel):
    id: str
    reviewer_id: str
    reviewer_name: str
    reviewer_avatar: Optional[str]
    reviewee_id: str
    reviewee_name: str
    review_type: str
    session_type: Optional[str] = None
    rating: int
    comment: Optional[str]
    punctuality_rating: Optional[int]
    communication_rating: Optional[int]
    photo_quality_rating: Optional[int] = None
    status: str
    created_at: str


class ReviewStatsResponse(BaseModel):
    average_rating: float
    total_reviews: int
    rating_breakdown: dict  # {1: count, 2: count, ...}
    recent_reviews: List[ReviewResponse]


# ============ HELPER FUNCTIONS ============

def is_photographer_role(role):
    """Check if role is a photographer type"""
    if role is None:
        return False
    role_str = role.value if hasattr(role, 'value') else str(role)
    return role_str in ['Photographer', 'Approved Pro', 'Hobbyist', 'Grom Parent']


async def award_xp(db: AsyncSession, user_id: str, amount: int, reason: str, reference_type: str = None, reference_id: str = None, auto_commit: bool = True):
    """Award XP to a user and check for badge awards.
    Set auto_commit=False when caller manages its own transaction."""
    # Create XP transaction
    xp_tx = XPTransaction(
        user_id=user_id,
        amount=amount,
        reason=reason,
        reference_type=reference_type,
        reference_id=reference_id
    )
    db.add(xp_tx)
    
    # ============ BADGE AWARD TRIGGERS ============
    # Auto-check badges after XP is awarded
    await check_badge_milestones(user_id, db)
    
    if auto_commit:
        await db.commit()


# ============ ENDPOINTS ============

@router.post("", response_model=ReviewResponse)
async def create_review(
    request: CreateReviewRequest,
    reviewer_id: str = Query(..., description="ID of the user leaving the review"),
    db: AsyncSession = Depends(get_db)
):
    """Create a new review (surfer→photographer or photographer→surfer) for any session type"""
    
    # Get reviewer and reviewee
    reviewer_result = await db.execute(select(Profile).where(Profile.id == reviewer_id))
    reviewer = reviewer_result.scalar_one_or_none()
    
    if not reviewer:
        raise HTTPException(status_code=404, detail="Reviewer not found")
    
    reviewee_result = await db.execute(select(Profile).where(Profile.id == request.reviewee_id))
    reviewee = reviewee_result.scalar_one_or_none()
    
    if not reviewee:
        raise HTTPException(status_code=404, detail="Reviewee not found")
    
    # Determine review type
    reviewer_is_photographer = is_photographer_role(reviewer.role)
    reviewee_is_photographer = is_photographer_role(reviewee.role)
    
    if reviewer_is_photographer and not reviewee_is_photographer:
        review_type = 'photographer_to_surfer'
    elif not reviewer_is_photographer and reviewee_is_photographer:
        review_type = 'surfer_to_photographer'
    else:
        review_type = 'peer_review'
    
    # Determine session type from provided IDs
    session_type = request.session_type
    if not session_type:
        if request.live_session_id:
            session_type = 'live'
        elif request.dispatch_id:
            session_type = 'on_demand'
        elif request.booking_id:
            session_type = 'scheduled'
    
    # --- Session validation (single query for both checks) ---
    review_window_expires = None
    if request.live_session_id:
        session_result = await db.execute(
            select(LiveSession).where(LiveSession.id == request.live_session_id)
        )
        session = session_result.scalar_one_or_none()
        # 20-minute minimum session length check
        if session and session.duration_mins is not None and session.duration_mins < 20:
            raise HTTPException(
                status_code=400,
                detail="Sessions must be at least 20 minutes before reviews can be submitted"
            )
        # 14-day review window check (reuse same session object)
        if session and session.ended_at:
            review_window_expires = session.ended_at + timedelta(days=14)
            if datetime.now(timezone.utc) > review_window_expires:
                raise HTTPException(
                    status_code=400,
                    detail="The 14-day review window for this session has expired"
                )
    
    # Check for vulgarities and AI moderation
    flagged_words = []
    status = 'approved'  # Default to approved
    moderation_notes = None
    
    if request.comment:
        # First check basic word filter
        flagged_words = check_for_vulgarities(request.comment)
        
        if flagged_words:
            status = 'pending'  # Needs admin review
            moderation_notes = f"Word filter flagged: {', '.join(flagged_words)}"
        else:
            # If passed word filter, run AI moderation
            try:
                ai_result = await moderate_review_content(request.comment)
                if not ai_result.get('approved', True):
                    status = 'pending'
                    moderation_notes = f"AI moderation: {ai_result.get('reason', 'Content flagged')}"
            except Exception as e:
                # If AI moderation fails, allow the review (fail open)
                logger.error(f"AI moderation error: {e}")
    
    # Check for duplicate review — check across all session ID types
    dup_filters = [
        Review.reviewer_id == reviewer_id,
        Review.reviewee_id == request.reviewee_id
    ]
    if request.live_session_id:
        dup_filters.append(Review.live_session_id == request.live_session_id)
    elif request.booking_id:
        dup_filters.append(Review.booking_id == request.booking_id)
    elif request.dispatch_id:
        dup_filters.append(Review.dispatch_id == request.dispatch_id)
    
    existing_result = await db.execute(select(Review).where(and_(*dup_filters)))
    existing = existing_result.scalar_one_or_none()
    
    if existing:
        raise HTTPException(status_code=400, detail="You have already reviewed this user for this session")
    
    # Create review
    review = Review(
        reviewer_id=reviewer_id,
        reviewee_id=request.reviewee_id,
        review_type=review_type,
        session_type=session_type,
        live_session_id=request.live_session_id,
        booking_id=request.booking_id,
        dispatch_id=request.dispatch_id,
        review_window_expires_at=review_window_expires,
        rating=request.rating,
        comment=request.comment,
        punctuality_rating=request.punctuality_rating,
        communication_rating=request.communication_rating,
        photo_quality_rating=request.photo_quality_rating,
        status=status,
        moderation_notes=moderation_notes,
        flagged_words=','.join(flagged_words) if flagged_words else None
    )
    
    db.add(review)
    await db.flush()  # Get review.id without committing
    
    # Award XP in same transaction (atomic with review creation)
    await award_xp(
        db, reviewer_id, 10, 'review_given',
        reference_type='review', reference_id=review.id,
        auto_commit=False
    )
    
    await db.commit()
    await db.refresh(review)
    
    return ReviewResponse(
        id=review.id,
        reviewer_id=review.reviewer_id,
        reviewer_name=reviewer.full_name,
        reviewer_avatar=reviewer.avatar_url,
        reviewee_id=review.reviewee_id,
        reviewee_name=reviewee.full_name,
        review_type=review.review_type,
        session_type=review.session_type,
        rating=review.rating,
        comment=review.comment,
        punctuality_rating=review.punctuality_rating,
        communication_rating=review.communication_rating,
        photo_quality_rating=review.photo_quality_rating,
        status=review.status,
        created_at=review.created_at.isoformat()
    )


@router.get("/photographer/{photographer_id}", response_model=List[ReviewResponse])
async def get_photographer_reviews(
    photographer_id: str,
    status: Optional[str] = Query(default='approved', description="Filter by status"),
    limit: int = Query(default=10, le=50),
    db: AsyncSession = Depends(get_db)
):
    """Get reviews for a photographer"""
    
    query = select(Review).options(
        selectinload(Review.reviewer),
        selectinload(Review.reviewee)
    ).where(
        and_(
            Review.reviewee_id == photographer_id,
            Review.review_type == 'surfer_to_photographer'
        )
    )
    
    if status:
        query = query.where(Review.status == status)
    
    query = query.order_by(Review.created_at.desc()).limit(limit)
    
    result = await db.execute(query)
    reviews = result.scalars().all()
    
    # Profiles already eager-loaded via selectinload — no N+1
    responses = []
    for review in reviews:
        responses.append(ReviewResponse(
            id=review.id,
            reviewer_id=review.reviewer_id,
            reviewer_name=review.reviewer.full_name if review.reviewer else 'Unknown',
            reviewer_avatar=review.reviewer.avatar_url if review.reviewer else None,
            reviewee_id=review.reviewee_id,
            reviewee_name=review.reviewee.full_name if review.reviewee else 'Unknown',
            review_type=review.review_type,
            session_type=getattr(review, 'session_type', None),
            rating=review.rating,
            comment=review.comment,
            punctuality_rating=review.punctuality_rating,
            communication_rating=review.communication_rating,
            photo_quality_rating=getattr(review, 'photo_quality_rating', None),
            status=review.status,
            created_at=review.created_at.isoformat()
        ))
    
    return responses


@router.get("/surfer/{surfer_id}", response_model=List[ReviewResponse])
async def get_surfer_reviews(
    surfer_id: str,
    status: Optional[str] = Query(default='approved', description="Filter by status"),
    limit: int = Query(default=10, le=50),
    db: AsyncSession = Depends(get_db)
):
    """Get reviews for a surfer (from photographers)"""
    
    query = select(Review).options(
        selectinload(Review.reviewer),
        selectinload(Review.reviewee)
    ).where(
        and_(
            Review.reviewee_id == surfer_id,
            Review.review_type == 'photographer_to_surfer'
        )
    )
    
    if status:
        query = query.where(Review.status == status)
    
    query = query.order_by(Review.created_at.desc()).limit(limit)
    
    result = await db.execute(query)
    reviews = result.scalars().all()
    
    # Profiles already eager-loaded via selectinload — no N+1
    responses = []
    for review in reviews:
        responses.append(ReviewResponse(
            id=review.id,
            reviewer_id=review.reviewer_id,
            reviewer_name=review.reviewer.full_name if review.reviewer else 'Unknown',
            reviewer_avatar=review.reviewer.avatar_url if review.reviewer else None,
            reviewee_id=review.reviewee_id,
            reviewee_name=review.reviewee.full_name if review.reviewee else 'Unknown',
            review_type=review.review_type,
            session_type=getattr(review, 'session_type', None),
            rating=review.rating,
            comment=review.comment,
            punctuality_rating=review.punctuality_rating,
            communication_rating=review.communication_rating,
            photo_quality_rating=getattr(review, 'photo_quality_rating', None),
            status=review.status,
            created_at=review.created_at.isoformat()
        ))
    
    return responses


@router.get("/photographer/{photographer_id}/stats", response_model=ReviewStatsResponse)
async def get_photographer_review_stats(
    photographer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get aggregated review statistics for a photographer"""
    
    # Get average rating
    avg_result = await db.execute(
        select(func.avg(Review.rating), func.count(Review.id))
        .where(
            and_(
                Review.reviewee_id == photographer_id,
                Review.review_type == 'surfer_to_photographer',
                Review.status == 'approved'
            )
        )
    )
    avg_row = avg_result.first()
    avg_rating = float(avg_row[0]) if avg_row[0] else 0.0
    total_reviews = avg_row[1] or 0
    
    # Get rating breakdown in a single grouped query (replaces 5 individual queries)
    breakdown_result = await db.execute(
        select(Review.rating, func.count(Review.id))
        .where(
            and_(
                Review.reviewee_id == photographer_id,
                Review.review_type == 'surfer_to_photographer',
                Review.status == 'approved'
            )
        )
        .group_by(Review.rating)
    )
    breakdown = {str(star): 0 for star in range(1, 6)}
    for rating, count in breakdown_result.all():
        breakdown[str(rating)] = count
    
    # Get recent reviews (top 5) with eager-loaded profiles
    recent_result = await db.execute(
        select(Review).options(
            selectinload(Review.reviewer),
            selectinload(Review.reviewee)
        )
        .where(
            and_(
                Review.reviewee_id == photographer_id,
                Review.review_type == 'surfer_to_photographer',
                Review.status == 'approved'
            )
        )
        .order_by(Review.created_at.desc())
        .limit(5)
    )
    recent_reviews = recent_result.scalars().all()
    
    # Profiles already eager-loaded via selectinload — no N+1
    recent_responses = []
    for review in recent_reviews:
        recent_responses.append(ReviewResponse(
            id=review.id,
            reviewer_id=review.reviewer_id,
            reviewer_name=review.reviewer.full_name if review.reviewer else 'Unknown',
            reviewer_avatar=review.reviewer.avatar_url if review.reviewer else None,
            reviewee_id=review.reviewee_id,
            reviewee_name=review.reviewee.full_name if review.reviewee else 'Unknown',
            review_type=review.review_type,
            session_type=getattr(review, 'session_type', None),
            rating=review.rating,
            comment=review.comment,
            punctuality_rating=review.punctuality_rating,
            communication_rating=review.communication_rating,
            photo_quality_rating=getattr(review, 'photo_quality_rating', None),
            status=review.status,
            created_at=review.created_at.isoformat()
        ))
    
    return ReviewStatsResponse(
        average_rating=round(avg_rating, 1),
        total_reviews=total_reviews,
        rating_breakdown=breakdown,
        recent_reviews=recent_responses
    )


@router.get("/pending", response_model=List[ReviewResponse])
async def get_pending_reviews(
    admin_id: str = Query(..., description="Admin user ID for authorization"),
    limit: int = Query(default=20, le=100),
    db: AsyncSession = Depends(get_db)
):
    """Get reviews pending moderation (admin only)"""
    
    # Verify admin
    admin_result = await db.execute(select(Profile).where(Profile.id == admin_id))
    admin = admin_result.scalar_one_or_none()
    
    if not admin or not admin.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    result = await db.execute(
        select(Review).options(
            selectinload(Review.reviewer),
            selectinload(Review.reviewee)
        )
        .where(Review.status == 'pending')
        .order_by(Review.created_at.asc())
        .limit(limit)
    )
    reviews = result.scalars().all()
    
    # Profiles already eager-loaded via selectinload — no N+1
    responses = []
    for review in reviews:
        responses.append(ReviewResponse(
            id=review.id,
            reviewer_id=review.reviewer_id,
            reviewer_name=review.reviewer.full_name if review.reviewer else 'Unknown',
            reviewer_avatar=review.reviewer.avatar_url if review.reviewer else None,
            reviewee_id=review.reviewee_id,
            reviewee_name=review.reviewee.full_name if review.reviewee else 'Unknown',
            review_type=review.review_type,
            session_type=getattr(review, 'session_type', None),
            rating=review.rating,
            comment=review.comment,
            punctuality_rating=review.punctuality_rating,
            communication_rating=review.communication_rating,
            photo_quality_rating=getattr(review, 'photo_quality_rating', None),
            status=review.status,
            created_at=review.created_at.isoformat()
        ))
    
    return responses


@router.put("/{review_id}/moderate")
async def moderate_review(
    review_id: str,
    admin_id: str = Query(..., description="Admin user ID"),
    action: str = Query(..., description="approve or reject"),
    db: AsyncSession = Depends(get_db)
):
    """Approve or reject a pending review (admin only)"""
    
    # Verify admin
    admin_result = await db.execute(select(Profile).where(Profile.id == admin_id))
    admin = admin_result.scalar_one_or_none()
    
    if not admin or not admin.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    # Get review
    review_result = await db.execute(select(Review).where(Review.id == review_id))
    review = review_result.scalar_one_or_none()
    
    if not review:
        raise HTTPException(status_code=404, detail="Review not found")
    
    if action not in ['approve', 'reject']:
        raise HTTPException(status_code=400, detail="Action must be 'approve' or 'reject'")
    
    review.status = 'approved' if action == 'approve' else 'rejected'
    review.moderation_notes = f"{review.moderation_notes or ''}\nAdmin {action}d on {datetime.now(timezone.utc).isoformat()}"
    
    await db.commit()
    
    return {"success": True, "status": review.status}


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
    user_id: str = Query(..., description="User to check for unreviewed sessions"),
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
