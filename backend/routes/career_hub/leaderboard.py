"""
Sponsorship Leaderboard API

Features:
- Track photographer impact via ImpactLedger
- Monthly rankings by total credits given
- "Grom Guardian" badge for Top 10
- Monthly reset with archiving
- Notifications when entering Top 10
"""

from fastapi import APIRouter, HTTPException, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc, and_
from sqlalchemy.orm import selectinload
from datetime import datetime, timezone
from typing import Optional
import json
import logging

from database import get_db
from models import (
    Profile, ImpactLedger, LeaderboardSnapshot, 
    Notification, RoleEnum
)
from utils.grom_parent import is_grom_parent_eligible

router = APIRouter(prefix="/leaderboard", tags=["Leaderboard"])
logger = logging.getLogger(__name__)


# ============ LEADERBOARD ENDPOINTS ============

@router.get("/top-sponsors")
async def get_top_sponsors(
    limit: int = Query(default=50, le=100),
    period: str = Query(default='monthly', regex='^(monthly|lifetime)$'),
    db: AsyncSession = Depends(get_db)
):
    """
    Get top sponsors leaderboard
    - monthly: Current month's rankings
    - lifetime: All-time rankings
    """
    now = datetime.now(timezone.utc)
    current_month = now.month
    current_year = now.year
    
    if period == 'monthly':
        # Sum credits given this month
        query = (
            select(
                ImpactLedger.photographer_id,
                func.sum(ImpactLedger.amount).label('total_given')
            )
            .where(ImpactLedger.month == current_month)
            .where(ImpactLedger.year == current_year)
            .group_by(ImpactLedger.photographer_id)
            .order_by(desc('total_given'))
            .limit(limit)
        )
    else:
        # Use profile's total_credits_given for lifetime
        query = (
            select(Profile)
            .where(Profile.total_credits_given > 0)
            .order_by(desc(Profile.total_credits_given))
            .limit(limit)
        )
    
    result = await db.execute(query)
    
    if period == 'monthly':
        rankings = result.all()
        
        # Fetch profile details for each
        leaderboard = []
        for rank, row in enumerate(rankings, 1):
            profile_result = await db.execute(
                select(Profile).where(Profile.id == row.photographer_id)
            )
            profile = profile_result.scalar_one_or_none()
            
            if profile:
                leaderboard.append({
                    "rank": rank,
                    "photographer_id": profile.id,
                    "full_name": profile.full_name,
                    "avatar_url": profile.avatar_url,
                    "role": profile.role.value,
                    "monthly_total": row.total_given,
                    "lifetime_total": profile.total_credits_given,
                    "groms_supported": profile.total_groms_supported,
                    "causes_supported": profile.total_causes_supported,
                    "is_grom_guardian": rank <= 10
                })
        
        return {
            "period": period,
            "month": current_month,
            "year": current_year,
            "leaderboard": leaderboard
        }
    else:
        profiles = result.scalars().all()
        leaderboard = []
        for rank, profile in enumerate(profiles, 1):
            leaderboard.append({
                "rank": rank,
                "photographer_id": profile.id,
                "full_name": profile.full_name,
                "avatar_url": profile.avatar_url,
                "role": profile.role.value,
                "monthly_total": 0,  # Would need to calculate separately
                "lifetime_total": profile.total_credits_given,
                "groms_supported": profile.total_groms_supported,
                "causes_supported": profile.total_causes_supported,
                "is_grom_guardian": rank <= 10
            })
        
        return {
            "period": period,
            "leaderboard": leaderboard
        }


@router.get("/photographer/{photographer_id}/rank")
async def get_photographer_rank(
    photographer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get a specific photographer's current leaderboard position"""
    now = datetime.now(timezone.utc)
    current_month = now.month
    current_year = now.year
    
    # Get this photographer's monthly total
    result = await db.execute(
        select(func.sum(ImpactLedger.amount))
        .where(ImpactLedger.photographer_id == photographer_id)
        .where(ImpactLedger.month == current_month)
        .where(ImpactLedger.year == current_year)
    )
    monthly_total = result.scalar() or 0
    
    # Get rank (count how many have more)
    rank_result = await db.execute(
        select(func.count())
        .select_from(
            select(
                ImpactLedger.photographer_id,
                func.sum(ImpactLedger.amount).label('total')
            )
            .where(ImpactLedger.month == current_month)
            .where(ImpactLedger.year == current_year)
            .group_by(ImpactLedger.photographer_id)
            .having(func.sum(ImpactLedger.amount) > monthly_total)
            .subquery()
        )
    )
    rank = (rank_result.scalar() or 0) + 1
    
    # Get profile info
    profile_result = await db.execute(select(Profile).where(Profile.id == photographer_id))
    profile = profile_result.scalar_one_or_none()
    
    if not profile:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    return {
        "photographer_id": photographer_id,
        "rank": rank if monthly_total > 0 else None,
        "monthly_total": monthly_total,
        "lifetime_total": profile.total_credits_given,
        "is_grom_guardian": rank <= 10 and monthly_total > 0,
        "groms_supported": profile.total_groms_supported,
        "causes_supported": profile.total_causes_supported
    }


@router.get("/photographer/{photographer_id}/details")
async def get_photographer_impact_details(
    photographer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get detailed impact info for quick card (bottom sheet)"""
    now = datetime.now(timezone.utc)
    current_month = now.month
    current_year = now.year
    
    # Get profile
    profile_result = await db.execute(select(Profile).where(Profile.id == photographer_id))
    profile = profile_result.scalar_one_or_none()
    
    if not profile:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    # Get monthly total
    monthly_result = await db.execute(
        select(func.sum(ImpactLedger.amount))
        .where(ImpactLedger.photographer_id == photographer_id)
        .where(ImpactLedger.month == current_month)
        .where(ImpactLedger.year == current_year)
    )
    monthly_total = monthly_result.scalar() or 0
    
    # Get recent groms supported (from ImpactLedger)
    groms_result = await db.execute(
        select(
            ImpactLedger.recipient_id,
            func.sum(ImpactLedger.amount).label('total')
        )
        .where(ImpactLedger.photographer_id == photographer_id)
        .where(ImpactLedger.recipient_type == 'grom')
        .group_by(ImpactLedger.recipient_id)
        .order_by(desc('total'))
        .limit(5)
    )
    groms = groms_result.all()
    
    # Fetch grom profiles
    supported_athletes = []
    for grom_row in groms:
        if grom_row.recipient_id:
            grom_profile_result = await db.execute(
                select(Profile).where(Profile.id == grom_row.recipient_id)
            )
            grom_profile = grom_profile_result.scalar_one_or_none()
            if grom_profile:
                supported_athletes.append({
                    "id": grom_profile.id,
                    "full_name": grom_profile.full_name,
                    "avatar_url": grom_profile.avatar_url,
                    "total_given": grom_row.total
                })
    
    # Get causes supported
    causes_result = await db.execute(
        select(
            ImpactLedger.cause_name,
            func.sum(ImpactLedger.amount).label('total')
        )
        .where(ImpactLedger.photographer_id == photographer_id)
        .where(ImpactLedger.recipient_type == 'cause')
        .group_by(ImpactLedger.cause_name)
        .order_by(desc('total'))
        .limit(5)
    )
    causes = causes_result.all()
    
    supported_causes = [
        {"name": c.cause_name, "total_given": c.total}
        for c in causes if c.cause_name
    ]
    
    return {
        "photographer_id": photographer_id,
        "full_name": profile.full_name,
        "avatar_url": profile.avatar_url,
        "role": profile.role.value,
        "bio": profile.bio,
        "location": profile.location,
        "monthly_total": monthly_total,
        "lifetime_total": profile.total_credits_given,
        "total_groms_supported": profile.total_groms_supported,
        "total_causes_supported": profile.total_causes_supported,
        "supported_athletes": supported_athletes,
        "supported_causes": supported_causes
    }


# ============ HELPER: Record Impact ============

async def record_impact(
    photographer_id: str,
    recipient_type: str,
    amount: float,
    db: AsyncSession,
    recipient_id: str = None,
    cause_name: str = None,
    source_type: str = 'manual',
    source_id: str = None
):
    """Record a credit contribution to the impact ledger"""
    now = datetime.now(timezone.utc)
    
    ledger_entry = ImpactLedger(
        photographer_id=photographer_id,
        recipient_type=recipient_type,
        recipient_id=recipient_id,
        cause_name=cause_name,
        amount=amount,
        source_type=source_type,
        source_id=source_id,
        month=now.month,
        year=now.year
    )
    db.add(ledger_entry)
    
    # Check if this pushes them into Top 10 and notify
    await check_and_notify_top10(photographer_id, db)
    
    return ledger_entry


async def check_and_notify_top10(
    photographer_id: str,
    db: AsyncSession
):
    """Check if photographer just entered Top 10 and notify followers"""
    now = datetime.now(timezone.utc)
    current_month = now.month
    current_year = now.year
    
    # Get current rankings
    rankings_result = await db.execute(
        select(
            ImpactLedger.photographer_id,
            func.sum(ImpactLedger.amount).label('total')
        )
        .where(ImpactLedger.month == current_month)
        .where(ImpactLedger.year == current_year)
        .group_by(ImpactLedger.photographer_id)
        .order_by(desc('total'))
        .limit(15)  # Get a few more to check transitions
    )
    rankings = rankings_result.all()
    
    # Find this photographer's rank
    rank = None
    for i, row in enumerate(rankings, 1):
        if row.photographer_id == photographer_id:
            rank = i
            break
    
    if rank and rank <= 10:
        # Get photographer profile
        profile_result = await db.execute(select(Profile).where(Profile.id == photographer_id))
        profile = profile_result.scalar_one_or_none()
        
        if profile:
            # Check if they already have a Top 10 notification this month
            # (to avoid spamming)
            # For now, we'll just update the profile badge
            # TODO: Notify followers when following system supports batch notifications
            pass
    
    return rank


# ============ MONTHLY RESET JOB ============

async def monthly_leaderboard_reset(db: AsyncSession):
    """
    Called by scheduler on 1st of each month.
    Archives current month's data and prepares for new month.
    """
    now = datetime.now(timezone.utc)
    
    # We're resetting for the PREVIOUS month
    if now.month == 1:
        archive_month = 12
        archive_year = now.year - 1
    else:
        archive_month = now.month - 1
        archive_year = now.year
    
    logger.info(f"Running monthly leaderboard reset for {archive_month}/{archive_year}")
    
    # Get final rankings for the month
    rankings_result = await db.execute(
        select(
            ImpactLedger.photographer_id,
            func.sum(ImpactLedger.amount).label('total')
        )
        .where(ImpactLedger.month == archive_month)
        .where(ImpactLedger.year == archive_year)
        .group_by(ImpactLedger.photographer_id)
        .order_by(desc('total'))
    )
    rankings = rankings_result.all()
    
    # Archive each photographer's stats
    for rank, row in enumerate(rankings, 1):
        snapshot = LeaderboardSnapshot(
            photographer_id=row.photographer_id,
            month=archive_month,
            year=archive_year,
            monthly_total=row.total,
            rank=rank,
            earned_grom_guardian=(rank <= 10)
        )
        db.add(snapshot)
        
        # Award Grom Guardian badge to Top 10
        if rank <= 10:
            profile_result = await db.execute(
                select(Profile).where(Profile.id == row.photographer_id)
            )
            profile = profile_result.scalar_one_or_none()
            if profile:
                # Add badge to profile
                badges = profile.badges or []
                grom_guardian_badge = {
                    "type": "grom_guardian",
                    "month": archive_month,
                    "year": archive_year,
                    "rank": rank
                }
                badges.append(grom_guardian_badge)
                profile.badges = badges
    
    await db.commit()
    
    logger.info(f"Archived {len(rankings)} photographers for {archive_month}/{archive_year}")
    
    return {"archived": len(rankings), "month": archive_month, "year": archive_year}



# ============================================================
# ELITE GROMS LEADERBOARD
# ============================================================

@router.get("/elite-groms")
async def get_elite_groms_leaderboard(
    limit: int = Query(default=50, le=100),
    elite_only: bool = Query(default=False, description="Filter to show only elite tier Groms"),
    db: AsyncSession = Depends(get_db)
):
    """
    Get Elite Groms Leaderboard
    
    Filters:
    - age < 18 (Grom role)
    - elite_tier = 'grom_rising' (competitive Groms)
    
    Ranking metrics:
    - Sponsorship Points (total_credits_given received)
    - Community Stoke (XP / engagement)
    - Competition flag (elite_tier)
    """
    # Base query for Groms
    query = select(Profile).where(Profile.role == RoleEnum.GROM)
    
    # Filter for elite tier if requested
    if elite_only:
        query = query.where(Profile.elite_tier == 'grom_rising')
    
    # Order by XP (gamification), then by credits received (sponsorship)
    query = query.order_by(
        desc(Profile.xp_total),
        desc(Profile.total_credits_given)
    ).limit(limit)
    
    result = await db.execute(query)
    groms = result.scalars().all()
    
    leaderboard = []
    for rank, grom in enumerate(groms, 1):
        # Calculate sponsorship points (credits received as a Grom)
        sponsorship_points = grom.total_credits_given or 0
        
        # Community stoke is XP-based
        community_stoke = grom.xp_total or 0
        
        leaderboard.append({
            "rank": rank,
            "grom_id": grom.id,
            "full_name": grom.full_name,
            "avatar_url": grom.avatar_url,
            "elite_tier": grom.elite_tier,
            "is_competitive": grom.elite_tier == 'grom_rising',
            "subscription_tier": grom.subscription_tier,
            "sponsorship_points": sponsorship_points,
            "community_stoke": community_stoke,
            "total_xp": grom.xp_total or 0,
            "parent_id": grom.parent_id,
            # Composite score for ranking display
            "overall_score": community_stoke + (sponsorship_points * 10),
            # Badges
            "badges": grom.badges or []
        })
    
    return {
        "leaderboard": leaderboard,
        "total_count": len(leaderboard),
        "elite_only_filter": elite_only,
        "ranking_criteria": [
            "Community Stoke (XP)",
            "Sponsorship Points"
        ]
    }


@router.get("/grom-hq/{parent_id}/elite-rankings")
async def get_parent_grom_elite_rankings(
    parent_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Get elite rankings for a parent's linked Groms
    Displayed in the Grom HQ Dashboard
    """
    # Verify parent
    parent_result = await db.execute(select(Profile).where(Profile.id == parent_id))
    parent = parent_result.scalar_one_or_none()
    if not parent:
        raise HTTPException(status_code=404, detail="Parent not found")
    
    if not is_grom_parent_eligible(parent):
        raise HTTPException(status_code=403, detail="Only Grom Parents can view this")
    
    # Get linked Groms
    groms_result = await db.execute(
        select(Profile).where(
            Profile.parent_id == parent_id,
            Profile.role == RoleEnum.GROM
        )
    )
    groms = groms_result.scalars().all()
    
    # For each Grom, calculate their rank in the elite leaderboard
    elite_rankings = []
    for grom in groms:
        # Count how many Groms have higher XP
        rank_result = await db.execute(
            select(func.count())
            .select_from(Profile)
            .where(Profile.role == RoleEnum.GROM)
            .where(Profile.xp_total > (grom.xp_total or 0))
        )
        rank = (rank_result.scalar() or 0) + 1
        
        # Total Groms count
        total_result = await db.execute(
            select(func.count())
            .select_from(Profile)
            .where(Profile.role == RoleEnum.GROM)
        )
        total_groms = total_result.scalar() or 1
        
        elite_rankings.append({
            "grom_id": grom.id,
            "grom_name": grom.full_name,
            "avatar_url": grom.avatar_url,
            "elite_tier": grom.elite_tier,
            "is_competitive": grom.elite_tier == 'grom_rising',
            "current_rank": rank,
            "total_groms": total_groms,
            "percentile": round((1 - (rank / total_groms)) * 100, 1),
            "xp_total": grom.xp_total or 0,
            "sponsorship_points": grom.total_credits_given or 0,
            "subscription_tier": grom.subscription_tier,
            "badges": grom.badges or []
        })
    
    return {
        "parent_id": parent_id,
        "linked_groms": elite_rankings,
        "total_linked": len(elite_rankings)
    }
