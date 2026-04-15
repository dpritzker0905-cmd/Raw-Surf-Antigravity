"""Gamification API endpoints for badges and XP"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

from database import get_db
from models import Badge, XPTransaction, Profile

router = APIRouter()


class BadgeResponse(BaseModel):
    id: str
    badge_type: str
    tier: str
    xp_earned: int
    sessions_funded: Optional[int] = 0
    sessions_completed: Optional[int] = 0
    conversion_rate: Optional[float] = None
    total_contributed: Optional[float] = 0.0
    earned_at: datetime


class GamificationStatsResponse(BaseModel):
    total_xp: int
    badges: List[BadgeResponse]
    recent_xp_transactions: List[dict]


@router.get("/gamification/user/{user_id}")
async def get_user_gamification_stats(
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get gamification stats for a user including badges and XP"""
    
    # Get total XP
    xp_result = await db.execute(
        select(func.coalesce(func.sum(XPTransaction.amount), 0))
        .where(XPTransaction.user_id == user_id)
    )
    total_xp = xp_result.scalar() or 0
    
    # Get badges
    badges_result = await db.execute(
        select(Badge)
        .where(Badge.user_id == user_id)
        .order_by(Badge.earned_at.desc())
    )
    badges = badges_result.scalars().all()
    
    # Get recent XP transactions (last 10)
    xp_trans_result = await db.execute(
        select(XPTransaction)
        .where(XPTransaction.user_id == user_id)
        .order_by(XPTransaction.created_at.desc())
        .limit(10)
    )
    xp_transactions = xp_trans_result.scalars().all()
    
    return {
        "total_xp": int(total_xp),
        "badges": [
            {
                "id": b.id,
                "badge_type": b.badge_type,
                "tier": b.tier,
                "xp_earned": b.xp_earned or 0,
                "sessions_funded": b.sessions_funded or 0,
                "sessions_completed": b.sessions_completed or 0,
                "conversion_rate": b.conversion_rate,
                "total_contributed": b.total_contributed or 0.0,
                "earned_at": b.earned_at.isoformat() if b.earned_at else None
            }
            for b in badges
        ],
        "recent_xp_transactions": [
            {
                "id": t.id,
                "amount": t.amount,
                "reason": t.reason,
                "reference_type": t.reference_type,
                "created_at": t.created_at.isoformat() if t.created_at else None
            }
            for t in xp_transactions
        ]
    }


@router.post("/gamification/award-xp")
async def award_xp(
    user_id: str,
    amount: int,
    reason: str,
    reference_type: Optional[str] = None,
    reference_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """Award XP to a user for an action"""
    import uuid
    
    # Create XP transaction
    xp_transaction = XPTransaction(
        id=str(uuid.uuid4()),
        user_id=user_id,
        amount=amount,
        reason=reason,
        reference_type=reference_type,
        reference_id=reference_id
    )
    db.add(xp_transaction)
    
    # Check and award badges based on XP milestones
    await check_badge_milestones(user_id, db)
    
    await db.commit()
    
    return {"message": "XP awarded", "amount": amount, "reason": reason}


@router.post("/gamification/check-badges/{user_id}")
async def check_and_award_badges(
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Check and award any earned badges based on current stats"""
    badges_awarded = await check_badge_milestones(user_id, db)
    await db.commit()
    return {"badges_awarded": badges_awarded}


async def check_badge_milestones(user_id: str, db: AsyncSession):
    """Check all badge milestones and award any earned badges"""
    import uuid
    from sqlalchemy import func
    from models import LiveSessionParticipant, CreditTransaction, GalleryItem
    
    badges_awarded = []
    
    # Get total XP
    xp_result = await db.execute(
        select(func.coalesce(func.sum(XPTransaction.amount), 0))
        .where(XPTransaction.user_id == user_id)
    )
    total_xp = xp_result.scalar() or 0
    
    # THE PATRON - Sessions funded by hobbyists/parents
    sessions_funded_result = await db.execute(
        select(func.count(LiveSessionParticipant.id))
        .where(LiveSessionParticipant.surfer_id == user_id)
        .where(LiveSessionParticipant.status.in_(['active', 'completed']))
    )
    sessions_funded = sessions_funded_result.scalar() or 0
    
    if sessions_funded >= 1:
        await upsert_badge(
            user_id=user_id,
            badge_type="the_patron",
            tier=get_tier(sessions_funded, [1, 5, 15, 30]),
            xp_earned=sessions_funded * 10,
            sessions_funded=sessions_funded,
            db=db
        )
        badges_awarded.append("the_patron")
    
    # THE WORKHORSE - Consistent session shooter (for photographers)
    from models import LiveSession
    sessions_completed_result = await db.execute(
        select(func.count(LiveSession.id))
        .where(LiveSession.photographer_id == user_id)
        .where(LiveSession.status == 'completed')
    )
    sessions_completed = sessions_completed_result.scalar() or 0
    
    if sessions_completed >= 5:
        await upsert_badge(
            user_id=user_id,
            badge_type="the_workhorse",
            tier=get_tier(sessions_completed, [5, 20, 50, 100]),
            xp_earned=sessions_completed * 15,
            sessions_completed=sessions_completed,
            db=db
        )
        badges_awarded.append("the_workhorse")
    
    # THE BENEFACTOR - Total credits spent
    total_given_result = await db.execute(
        select(func.coalesce(func.sum(CreditTransaction.amount), 0))
        .where(CreditTransaction.user_id == user_id)
        .where(CreditTransaction.transaction_type.in_(['gallery_purchase', 'live_session_buyin', 'booking_payment']))
    )
    total_contributed = abs(total_given_result.scalar() or 0)
    
    if total_contributed >= 50:
        await upsert_badge(
            user_id=user_id,
            badge_type="the_benefactor",
            tier=get_tier(total_contributed, [50, 200, 500, 1000]),
            xp_earned=int(total_contributed),
            total_contributed=total_contributed,
            db=db
        )
        badges_awarded.append("the_benefactor")
    
    return badges_awarded


def get_tier(value: int, thresholds: list) -> str:
    """Determine tier based on value and thresholds [bronze, silver, gold, platinum]"""
    if value >= thresholds[3]:
        return "platinum"
    elif value >= thresholds[2]:
        return "gold"
    elif value >= thresholds[1]:
        return "silver"
    return "bronze"


async def upsert_badge(user_id: str, badge_type: str, tier: str, xp_earned: int, db: AsyncSession, **kwargs):
    """Create or update a badge for a user"""
    import uuid
    
    # Check if badge exists
    existing_result = await db.execute(
        select(Badge)
        .where(Badge.user_id == user_id)
        .where(Badge.badge_type == badge_type)
    )
    existing_badge = existing_result.scalar_one_or_none()
    
    if existing_badge:
        # Update existing badge
        existing_badge.tier = tier
        existing_badge.xp_earned = xp_earned
        for key, value in kwargs.items():
            if hasattr(existing_badge, key):
                setattr(existing_badge, key, value)
    else:
        # Create new badge
        new_badge = Badge(
            id=str(uuid.uuid4()),
            user_id=user_id,
            badge_type=badge_type,
            tier=tier,
            xp_earned=xp_earned,
            **kwargs
        )
        db.add(new_badge)


@router.get("/gamification/leaderboard")
async def get_xp_leaderboard(
    time_range: str = "all",  # 'week', 'month', 'all'
    category: str = "all",  # 'all', 'patrons', 'workhorses'
    limit: int = 20,
    db: AsyncSession = Depends(get_db)
):
    """Get XP leaderboard with optional time range and category filters"""
    from datetime import timedelta, timezone
    from sqlalchemy.orm import selectinload
    
    # Build the base query
    query = (
        select(
            Profile.id,
            Profile.full_name,
            Profile.avatar_url,
            func.coalesce(func.sum(XPTransaction.amount), 0).label('total_xp')
        )
        .outerjoin(XPTransaction, XPTransaction.user_id == Profile.id)
        .group_by(Profile.id, Profile.full_name, Profile.avatar_url)
    )
    
    # Apply time range filter
    now = datetime.now(timezone.utc)
    if time_range == 'week':
        query = query.where(XPTransaction.created_at >= now - timedelta(days=7))
    elif time_range == 'month':
        query = query.where(XPTransaction.created_at >= now - timedelta(days=30))
    
    # Apply category filter by filtering XP transaction reasons
    if category == 'patrons':
        query = query.where(XPTransaction.reason.ilike('%session%'))
    elif category == 'workhorses':
        query = query.where(XPTransaction.reason.ilike('%photo%'))
    
    # Order by XP and limit
    query = query.order_by(func.coalesce(func.sum(XPTransaction.amount), 0).desc()).limit(limit)
    
    result = await db.execute(query)
    rows = result.fetchall()
    
    # Get badges for each user
    leaderboard = []
    for i, row in enumerate(rows):
        user_id, name, avatar, xp = row
        
        # Get user's top badge
        badge_result = await db.execute(
            select(Badge)
            .where(Badge.user_id == user_id)
            .order_by(Badge.xp_earned.desc())
            .limit(1)
        )
        badge = badge_result.scalar_one_or_none()
        
        leaderboard.append({
            "id": user_id,
            "name": name,
            "avatar": avatar,
            "xp": int(xp),
            "rank": i + 1,
            "badge": badge.badge_type if badge else None,
            "badge_tier": badge.tier if badge else None
        })
    
    return {
        "leaderboard": leaderboard,
        "time_range": time_range,
        "category": category,
        "total_count": len(leaderboard)
    }

