"""
Admin User Journey Timeline — user activity tracking and journey summaries.

Extracted from p1.py (v87) to keep modules under 800 LOC.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_, desc
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

from database import get_db
from deps.admin_auth import get_current_admin
from models import Profile, UserActivityLog

router = APIRouter()


# ============ USER JOURNEY TIMELINE ============

@router.get("/admin/user-journey/{user_id}")
async def get_user_journey(
    user_id: str,
    admin: Profile = Depends(get_current_admin),
    activity_type: Optional[str] = None,
    category: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
    db: AsyncSession = Depends(get_db)
):
    """Get complete user journey timeline for support debugging"""
    
    # Get user info
    user_result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = user_result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Build activity query
    query = select(UserActivityLog).where(UserActivityLog.user_id == user_id)
    
    if activity_type:
        query = query.where(UserActivityLog.activity_type == activity_type)
    if category:
        query = query.where(UserActivityLog.activity_category == category)
    if start_date:
        query = query.where(UserActivityLog.created_at >= datetime.fromisoformat(start_date))
    if end_date:
        query = query.where(UserActivityLog.created_at <= datetime.fromisoformat(end_date))
    
    query = query.order_by(desc(UserActivityLog.created_at)).limit(limit).offset(offset)
    
    result = await db.execute(query)
    activities = result.scalars().all()
    
    # Get activity type counts
    type_counts = await db.execute(
        select(UserActivityLog.activity_category, func.count(UserActivityLog.id))
        .where(UserActivityLog.user_id == user_id)
        .group_by(UserActivityLog.activity_category)
    )
    
    return {
        "user": {
            "id": user.id,
            "full_name": user.full_name,
            "email": user.email,
            "avatar_url": user.avatar_url,
            "role": user.role.value if user.role else None,
            "created_at": user.created_at.isoformat() if user.created_at else None,
            "is_suspended": user.is_suspended
        },
        "activity_counts": {row[0]: row[1] for row in type_counts},
        "activities": [{
            "id": a.id,
            "activity_type": a.activity_type,
            "activity_category": a.activity_category,
            "description": a.description,
            "related_type": a.related_type,
            "related_id": a.related_id,
            "ip_address": a.ip_address,
            "extra_data": a.extra_data,
            "created_at": a.created_at.isoformat() if a.created_at else None
        } for a in activities]
    }


@router.get("/admin/user-journey/{user_id}/summary")
async def get_user_journey_summary(
    user_id: str,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Get quick summary of user's journey for support"""
    
    # Get user with related data
    user_result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = user_result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Get various counts
    from models import Post, Booking, CreditTransaction, Dispute, UserReport
    
    posts_count = (await db.execute(
        select(func.count(Post.id)).where(Post.author_id == user_id)
    )).scalar() or 0
    
    bookings_count = (await db.execute(
        select(func.count(Booking.id)).where(
            or_(Booking.surfer_id == user_id, Booking.photographer_id == user_id)
        )
    )).scalar() or 0
    
    transactions_count = (await db.execute(
        select(func.count(CreditTransaction.id)).where(CreditTransaction.profile_id == user_id)
    )).scalar() or 0
    
    disputes_count = (await db.execute(
        select(func.count(Dispute.id)).where(
            or_(Dispute.complainant_id == user_id, Dispute.respondent_id == user_id)
        )
    )).scalar() or 0
    
    reports_count = (await db.execute(
        select(func.count(UserReport.id)).where(UserReport.reported_user_id == user_id)
    )).scalar() or 0
    
    # Get recent activity
    recent_activity = await db.execute(
        select(UserActivityLog)
        .where(UserActivityLog.user_id == user_id)
        .order_by(desc(UserActivityLog.created_at))
        .limit(5)
    )
    recent = recent_activity.scalars().all()
    
    return {
        "user": {
            "id": user.id,
            "full_name": user.full_name,
            "email": user.email,
            "role": user.role.value if user.role else None,
            "created_at": user.created_at.isoformat() if user.created_at else None,
            "credit_balance": user.credit_balance,
            "is_suspended": user.is_suspended,
            "is_approved_pro": user.is_approved_pro
        },
        "stats": {
            "posts": posts_count,
            "bookings": bookings_count,
            "transactions": transactions_count,
            "disputes": disputes_count,
            "reports_against": reports_count
        },
        "recent_activity": [{
            "activity_type": a.activity_type,
            "description": a.description,
            "created_at": a.created_at.isoformat() if a.created_at else None
        } for a in recent]
    }


# ============ HELPER: Log User Activity ============

async def log_user_activity(
    db: AsyncSession,
    user_id: str,
    activity_type: str,
    category: str,
    description: str,
    related_type: str = None,
    related_id: str = None,
    ip_address: str = None,
    extra_data: dict = None
):
    """Helper function to log user activity for journey tracking"""
    activity = UserActivityLog(
        user_id=user_id,
        activity_type=activity_type,
        activity_category=category,
        description=description,
        related_type=related_type,
        related_id=related_id,
        ip_address=ip_address,
        extra_data=extra_data or {}
    )
    db.add(activity)
    return activity
