"""
reviews_pkg/review_moderation.py — Review reporting and moderation stats.
Extracted from reviews.py (v93 audit) for LOC compliance.
"""
import os
import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_
from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime, timezone

from deps.admin_auth import get_current_admin
from database import get_db
from models import Profile, Review
from services.ai_moderation import moderate_review_content

router = APIRouter(prefix="/reviews", tags=["reviews"])
logger = logging.getLogger(__name__)


class ReportReviewRequest(BaseModel):
    reporter_id: str
    reason: str = Field(..., description="inappropriate, spam, harassment, fake_review, or other")
    description: Optional[str] = None


@router.post("/{review_id}/report")
async def report_review(
    review_id: str,
    request: ReportReviewRequest,
    db: AsyncSession = Depends(get_db)
):
    """Report a review for moderation."""
    reporter_result = await db.execute(select(Profile).where(Profile.id == request.reporter_id))
    reporter = reporter_result.scalar_one_or_none()
    if not reporter:
        raise HTTPException(status_code=404, detail="Reporter not found")

    review_result = await db.execute(select(Review).where(Review.id == review_id))
    review = review_result.scalar_one_or_none()
    if not review:
        raise HTTPException(status_code=404, detail="Review not found")

    if review.reviewer_id == request.reporter_id:
        raise HTTPException(status_code=400, detail="You cannot report your own review")

    valid_reasons = ['inappropriate', 'spam', 'harassment', 'fake_review', 'other']
    if request.reason not in valid_reasons:
        raise HTTPException(status_code=400, detail=f"Reason must be one of: {', '.join(valid_reasons)}")

    ai_verdict = None
    if review.comment:
        try:
            ai_verdict = await moderate_review_content(review.comment)
        except Exception as e:
            logger.error(f"AI re-moderation error on reported review {review_id}: {e}")

    timestamp = datetime.now(timezone.utc).isoformat()
    report_note = (
        f"\n[REPORT {timestamp}] "
        f"Reported by {reporter.full_name} ({request.reporter_id}) — "
        f"Reason: {request.reason}"
    )
    if request.description:
        report_note += f" — Details: {request.description}"
    if ai_verdict and not ai_verdict.get('approved', True):
        report_note += f" — AI re-scan FLAGGED: {ai_verdict.get('reason', 'Content flagged')}"
    elif ai_verdict and ai_verdict.get('approved', True):
        report_note += " — AI re-scan: content appears clean"

    review.moderation_notes = (review.moderation_notes or '') + report_note
    review.status = 'pending'
    await db.commit()

    return {
        "success": True,
        "message": "Review has been reported and queued for moderation",
        "ai_flagged": not ai_verdict.get('approved', True) if ai_verdict else None
    }


@router.get("/moderation-stats")
async def get_moderation_stats(
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Get moderation dashboard statistics (admin only)."""
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)

    result = await db.execute(
        select(
            func.count(Review.id).filter(Review.status == 'pending').label('pending_reviews'),
            func.count(Review.id).filter(
                and_(Review.status == 'pending', Review.updated_at >= today_start)
            ).label('flagged_today'),
            func.count(Review.id).filter(Review.status == 'approved').label('total_approved'),
            func.count(Review.id).filter(Review.status == 'rejected').label('total_rejected'),
        )
    )
    row = result.first()

    return {
        "pending_reviews": row.pending_reviews or 0,
        "flagged_today": row.flagged_today or 0,
        "total_approved": row.total_approved or 0,
        "total_rejected": row.total_rejected or 0,
        "ai_moderation_active": bool(os.environ.get('OPENAI_API_KEY')),
    }
