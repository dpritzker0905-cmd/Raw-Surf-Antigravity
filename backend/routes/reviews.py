"""
Reviews API Routes - Two-Way Review System
Handles surfer-to-photographer and photographer-to-surfer reviews
with AI moderation for vulgarities
"""
import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime, timezone
import re

from database import get_db
from models import Profile, Review, LiveSession, XPTransaction, Badge
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
    live_session_id: Optional[str] = None
    rating: int = Field(..., ge=1, le=5)
    comment: Optional[str] = None
    # Optional specific ratings for photographer-to-surfer
    punctuality_rating: Optional[int] = Field(None, ge=1, le=5)
    communication_rating: Optional[int] = Field(None, ge=1, le=5)


class ReviewResponse(BaseModel):
    id: str
    reviewer_id: str
    reviewer_name: str
    reviewer_avatar: Optional[str]
    reviewee_id: str
    reviewee_name: str
    review_type: str
    rating: int
    comment: Optional[str]
    punctuality_rating: Optional[int]
    communication_rating: Optional[int]
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


async def award_xp(db: AsyncSession, user_id: str, amount: int, reason: str, reference_type: str = None, reference_id: str = None):
    """Award XP to a user and check for badge awards"""
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
    
    await db.commit()


# ============ ENDPOINTS ============

@router.post("", response_model=ReviewResponse)
async def create_review(
    request: CreateReviewRequest,
    reviewer_id: str = Query(..., description="ID of the user leaving the review"),
    db: AsyncSession = Depends(get_db)
):
    """Create a new review (surfer→photographer or photographer→surfer)"""
    
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
    
    # Check for duplicate review
    existing_result = await db.execute(
        select(Review).where(
            and_(
                Review.reviewer_id == reviewer_id,
                Review.reviewee_id == request.reviewee_id,
                Review.live_session_id == request.live_session_id if request.live_session_id else True
            )
        )
    )
    existing = existing_result.scalar_one_or_none()
    
    if existing:
        raise HTTPException(status_code=400, detail="You have already reviewed this user for this session")
    
    # Create review
    review = Review(
        reviewer_id=reviewer_id,
        reviewee_id=request.reviewee_id,
        review_type=review_type,
        live_session_id=request.live_session_id,
        rating=request.rating,
        comment=request.comment,
        punctuality_rating=request.punctuality_rating,
        communication_rating=request.communication_rating,
        status=status,
        moderation_notes=moderation_notes,
        flagged_words=','.join(flagged_words) if flagged_words else None
    )
    
    db.add(review)
    await db.commit()
    await db.refresh(review)
    
    # Award XP for leaving a review
    await award_xp(
        db, reviewer_id, 10, 'review_given',
        reference_type='review', reference_id=review.id
    )
    
    return ReviewResponse(
        id=review.id,
        reviewer_id=review.reviewer_id,
        reviewer_name=reviewer.full_name,
        reviewer_avatar=reviewer.avatar_url,
        reviewee_id=review.reviewee_id,
        reviewee_name=reviewee.full_name,
        review_type=review.review_type,
        rating=review.rating,
        comment=review.comment,
        punctuality_rating=review.punctuality_rating,
        communication_rating=review.communication_rating,
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
    
    query = select(Review).where(
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
    
    # Fetch reviewer profiles
    responses = []
    for review in reviews:
        reviewer_result = await db.execute(select(Profile).where(Profile.id == review.reviewer_id))
        reviewer = reviewer_result.scalar_one_or_none()
        
        reviewee_result = await db.execute(select(Profile).where(Profile.id == review.reviewee_id))
        reviewee = reviewee_result.scalar_one_or_none()
        
        responses.append(ReviewResponse(
            id=review.id,
            reviewer_id=review.reviewer_id,
            reviewer_name=reviewer.full_name if reviewer else 'Unknown',
            reviewer_avatar=reviewer.avatar_url if reviewer else None,
            reviewee_id=review.reviewee_id,
            reviewee_name=reviewee.full_name if reviewee else 'Unknown',
            review_type=review.review_type,
            rating=review.rating,
            comment=review.comment,
            punctuality_rating=review.punctuality_rating,
            communication_rating=review.communication_rating,
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
    
    query = select(Review).where(
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
    
    responses = []
    for review in reviews:
        reviewer_result = await db.execute(select(Profile).where(Profile.id == review.reviewer_id))
        reviewer = reviewer_result.scalar_one_or_none()
        
        reviewee_result = await db.execute(select(Profile).where(Profile.id == review.reviewee_id))
        reviewee = reviewee_result.scalar_one_or_none()
        
        responses.append(ReviewResponse(
            id=review.id,
            reviewer_id=review.reviewer_id,
            reviewer_name=reviewer.full_name if reviewer else 'Unknown',
            reviewer_avatar=reviewer.avatar_url if reviewer else None,
            reviewee_id=review.reviewee_id,
            reviewee_name=reviewee.full_name if reviewee else 'Unknown',
            review_type=review.review_type,
            rating=review.rating,
            comment=review.comment,
            punctuality_rating=review.punctuality_rating,
            communication_rating=review.communication_rating,
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
    
    # Get rating breakdown
    breakdown = {}
    for star in range(1, 6):
        count_result = await db.execute(
            select(func.count(Review.id))
            .where(
                and_(
                    Review.reviewee_id == photographer_id,
                    Review.review_type == 'surfer_to_photographer',
                    Review.status == 'approved',
                    Review.rating == star
                )
            )
        )
        breakdown[str(star)] = count_result.scalar() or 0
    
    # Get recent reviews (top 5)
    recent_result = await db.execute(
        select(Review)
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
    
    recent_responses = []
    for review in recent_reviews:
        reviewer_result = await db.execute(select(Profile).where(Profile.id == review.reviewer_id))
        reviewer = reviewer_result.scalar_one_or_none()
        
        reviewee_result = await db.execute(select(Profile).where(Profile.id == review.reviewee_id))
        reviewee = reviewee_result.scalar_one_or_none()
        
        recent_responses.append(ReviewResponse(
            id=review.id,
            reviewer_id=review.reviewer_id,
            reviewer_name=reviewer.full_name if reviewer else 'Unknown',
            reviewer_avatar=reviewer.avatar_url if reviewer else None,
            reviewee_id=review.reviewee_id,
            reviewee_name=reviewee.full_name if reviewee else 'Unknown',
            review_type=review.review_type,
            rating=review.rating,
            comment=review.comment,
            punctuality_rating=review.punctuality_rating,
            communication_rating=review.communication_rating,
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
        select(Review)
        .where(Review.status == 'pending')
        .order_by(Review.created_at.asc())
        .limit(limit)
    )
    reviews = result.scalars().all()
    
    responses = []
    for review in reviews:
        reviewer_result = await db.execute(select(Profile).where(Profile.id == review.reviewer_id))
        reviewer = reviewer_result.scalar_one_or_none()
        
        reviewee_result = await db.execute(select(Profile).where(Profile.id == review.reviewee_id))
        reviewee = reviewee_result.scalar_one_or_none()
        
        responses.append(ReviewResponse(
            id=review.id,
            reviewer_id=review.reviewer_id,
            reviewer_name=reviewer.full_name if reviewer else 'Unknown',
            reviewer_avatar=reviewer.avatar_url if reviewer else None,
            reviewee_id=review.reviewee_id,
            reviewee_name=reviewee.full_name if reviewee else 'Unknown',
            review_type=review.review_type,
            rating=review.rating,
            comment=review.comment,
            punctuality_rating=review.punctuality_rating,
            communication_rating=review.communication_rating,
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
