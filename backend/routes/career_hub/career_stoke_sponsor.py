"""
career_stoke_sponsor.py — Stoke Sponsor system (Photographer → Surfer support).

Extracted from career.py (v88 decomposition). Contains:
  - Stoke Sponsor contribution endpoint
  - Eligible surfers listing
  - Photographer contributions history
  - Surfer income history
  - Stoke Sponsor leaderboard
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, Integer
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone, timedelta

from database import get_db
from models import (
    Profile, Sponsorship, XPTransaction, RoleEnum,
    SponsorshipTransaction, SponsorshipType, CreditTransaction
)
from websocket_manager import broadcast_earnings_update

router = APIRouter(prefix="/career", tags=["career"])


# ============ PYDANTIC MODELS ============

class StokeSponsorCreate(BaseModel):
    """Create a stoke sponsorship from photographer to surfer"""
    surfer_id: str
    amount: float
    message: Optional[str] = None
    is_recurring: bool = False
    recurring_frequency: Optional[str] = None  # 'weekly', 'monthly'


class StokeSponsorSettings(BaseModel):
    """Photographer's stoke sponsor settings"""
    is_stoke_sponsor: bool = False
    monthly_budget: Optional[float] = None
    auto_sponsor_tiers: Optional[List[str]] = None
    preferred_categories: Optional[List[str]] = None


# ============ STOKE SPONSOR CONTRIBUTION ============

@router.post("/stoke-sponsor/contribute")
async def create_stoke_sponsorship(
    photographer_id: str,
    data: StokeSponsorCreate,
    db: AsyncSession = Depends(get_db)
):
    """
    Photographer contributes to a surfer's career (Stoke Sponsor flow)
    - Deducts from photographer's withdrawable_credits
    - Adds to surfer's withdrawable_credits
    - Creates sponsorship record for tracking
    - Awards XP to both parties
    """
    photo_result = await db.execute(select(Profile).where(Profile.id == photographer_id))
    photographer = photo_result.scalar_one_or_none()
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    if photographer.withdrawable_credits < data.amount:
        raise HTTPException(status_code=400, detail=f"Insufficient credits. Available: {photographer.withdrawable_credits}")

    surfer_result = await db.execute(select(Profile).where(Profile.id == data.surfer_id))
    surfer = surfer_result.scalar_one_or_none()
    if not surfer:
        raise HTTPException(status_code=404, detail="Surfer not found")

    is_grom = surfer.role and surfer.role.value == 'Grom'
    platform_fee_rate = 0.05 if is_grom else 0.10
    platform_fee = round(data.amount * platform_fee_rate, 2)
    net_amount = round(data.amount - platform_fee, 2)
    recipient_type = 'grom' if is_grom else 'surfer'

    sponsorship_tx = SponsorshipTransaction(
        donor_id=photographer_id, recipient_id=data.surfer_id,
        amount=data.amount, platform_fee=platform_fee, net_amount=net_amount,
        sponsorship_type=SponsorshipType.PRO_SPONSORSHIP,
        recipient_type=recipient_type, source_transaction_type='stoke_sponsor', status='completed'
    )
    db.add(sponsorship_tx)

    photographer.withdrawable_credits -= data.amount
    photo_credit_tx = CreditTransaction(
        user_id=photographer_id, amount=-data.amount,
        balance_before=photographer.withdrawable_credits + data.amount,
        balance_after=photographer.withdrawable_credits,
        transaction_type='stoke_sponsor_contribution',
        reference_type='sponsorship_transaction', reference_id=sponsorship_tx.id,
        counterparty_id=data.surfer_id,
        description=f"Stoke sponsor contribution to {surfer.full_name or 'surfer'}"
    )
    db.add(photo_credit_tx)

    surfer.withdrawable_credits = (surfer.withdrawable_credits or 0) + net_amount
    surfer_credit_tx = CreditTransaction(
        user_id=data.surfer_id, amount=net_amount,
        balance_before=(surfer.withdrawable_credits or 0) - net_amount,
        balance_after=surfer.withdrawable_credits,
        transaction_type='stoke_sponsor_income',
        reference_type='sponsorship_transaction', reference_id=sponsorship_tx.id,
        counterparty_id=photographer_id,
        description=f"Stoke sponsor support from {photographer.full_name or 'photographer'}"
    )
    db.add(surfer_credit_tx)

    photographer.total_credits_given = (photographer.total_credits_given or 0) + data.amount
    if is_grom:
        photographer.total_groms_supported = (photographer.total_groms_supported or 0) + 1

    photo_xp = XPTransaction(
        user_id=photographer_id, amount=int(data.amount * 2),
        reason=f"Stoke sponsor: {surfer.full_name or 'surfer'}",
        reference_type='sponsorship_transaction', reference_id=sponsorship_tx.id
    )
    db.add(photo_xp)

    surfer_xp = XPTransaction(
        user_id=data.surfer_id, amount=int(net_amount),
        reason=f"Stoke sponsor support from {photographer.full_name or 'photographer'}",
        reference_type='sponsorship_transaction', reference_id=sponsorship_tx.id
    )
    db.add(surfer_xp)

    stoke_sponsorship = Sponsorship(
        surfer_id=data.surfer_id,
        sponsor_name=photographer.full_name or photographer.email,
        sponsor_type='stoke_sponsor', sponsor_profile_id=photographer_id,
        sponsorship_tier='stoke', is_active=True
    )
    db.add(stoke_sponsorship)
    await db.commit()

    await broadcast_earnings_update(
        user_id=data.surfer_id, update_type='tip_received', amount=net_amount,
        details={"donor_name": photographer.full_name or "A supporter",
                 "gross_amount": data.amount, "platform_fee": platform_fee,
                 "sponsorship_type": "stoke_sponsor"}
    )

    return {
        "message": "Stoke sponsorship created successfully!",
        "transaction_id": sponsorship_tx.id,
        "amount": data.amount, "platform_fee": platform_fee,
        "net_amount_to_surfer": net_amount,
        "photographer_xp_earned": int(data.amount * 2),
        "surfer_xp_earned": int(net_amount)
    }


@router.get("/stoke-sponsor/eligible-surfers")
async def get_eligible_surfers_for_sponsorship(
    photographer_id: str,
    tier_filter: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """Get list of surfers eligible for stoke sponsorship."""
    query = (
        select(Profile)
        .where(Profile.role.in_([RoleEnum.GROM, RoleEnum.SURFER, RoleEnum.COMP_SURFER, RoleEnum.PRO]))
        .where(Profile.id != photographer_id)
        .order_by(Profile.created_at.desc()).limit(50)
    )
    if tier_filter:
        query = query.where(Profile.elite_tier == tier_filter)

    results = await db.execute(query)
    surfers = results.scalars().all()

    return {
        "eligible_surfers": [
            {"id": s.id, "full_name": s.full_name, "avatar_url": s.avatar_url,
             "role": s.role.value if s.role else None,
             "elite_tier": s.elite_tier if s.elite_tier else None,
             "bio": s.bio, "skill_level": s.skill_level,
             "home_break": s.home_break, "career_points": s.career_points or 0}
            for s in surfers
        ]
    }


@router.get("/stoke-sponsor/my-contributions/{photographer_id}")
async def get_photographer_contributions(
    photographer_id: str, db: AsyncSession = Depends(get_db)
):
    """Get all stoke sponsor contributions made by a photographer."""
    results = await db.execute(
        select(SponsorshipTransaction)
        .where(SponsorshipTransaction.donor_id == photographer_id)
        .where(SponsorshipTransaction.source_transaction_type == 'stoke_sponsor')
        .order_by(SponsorshipTransaction.created_at.desc()).limit(50)
    )
    contributions = results.scalars().all()
    total_contributed = sum(c.amount for c in contributions)
    total_to_groms = sum(c.amount for c in contributions if c.recipient_type == 'grom')

    return {
        "total_contributed": total_contributed, "total_to_groms": total_to_groms,
        "contribution_count": len(contributions),
        "contributions": [
            {"id": c.id, "recipient_id": c.recipient_id, "recipient_type": c.recipient_type,
             "amount": c.amount, "net_amount": c.net_amount,
             "created_at": c.created_at.isoformat(), "shaka_sent": c.shaka_sent}
            for c in contributions
        ]
    }


@router.get("/stoke-sponsor/income/{surfer_id}")
async def get_surfer_stoke_income(
    surfer_id: str, db: AsyncSession = Depends(get_db)
):
    """Get all stoke sponsor income received by a surfer."""
    results = await db.execute(
        select(SponsorshipTransaction)
        .where(SponsorshipTransaction.recipient_id == surfer_id)
        .where(SponsorshipTransaction.source_transaction_type == 'stoke_sponsor')
        .order_by(SponsorshipTransaction.created_at.desc()).limit(50)
    )
    income_records = results.scalars().all()
    donor_ids = [i.donor_id for i in income_records if i.donor_id]
    donors = {}
    if donor_ids:
        donor_results = await db.execute(select(Profile).where(Profile.id.in_(donor_ids)))
        for d in donor_results.scalars().all():
            donors[d.id] = {"full_name": d.full_name, "avatar_url": d.avatar_url}

    total_received = sum(i.net_amount for i in income_records)
    return {
        "total_received": total_received,
        "supporter_count": len(set(i.donor_id for i in income_records if i.donor_id)),
        "income_records": [
            {"id": i.id, "donor_id": i.donor_id,
             "donor_name": donors.get(i.donor_id, {}).get("full_name", "Anonymous"),
             "donor_avatar": donors.get(i.donor_id, {}).get("avatar_url"),
             "amount": i.amount, "net_amount": i.net_amount,
             "created_at": i.created_at.isoformat(), "shaka_sent": i.shaka_sent}
            for i in income_records
        ]
    }


# ============ STOKE SPONSOR LEADERBOARD ============

@router.get("/stoke-sponsor/leaderboard")
async def get_stoke_sponsor_leaderboard(
    time_range: Optional[str] = 'all',
    db: AsyncSession = Depends(get_db)
):
    """Get the Stoke Sponsor leaderboard - top photographers ranked by contributions."""
    now = datetime.now(timezone.utc)
    if time_range == 'week':
        date_filter = now - timedelta(days=7)
    elif time_range == 'month':
        date_filter = now - timedelta(days=30)
    else:
        date_filter = None

    query = (
        select(
            SponsorshipTransaction.donor_id,
            func.sum(SponsorshipTransaction.amount).label('total_contributed'),
            func.count(SponsorshipTransaction.id).label('contribution_count'),
            func.sum(
                func.cast(SponsorshipTransaction.recipient_type == 'grom', Integer)
                * SponsorshipTransaction.amount
            ).label('total_to_groms')
        )
        .where(SponsorshipTransaction.source_transaction_type == 'stoke_sponsor')
        .where(SponsorshipTransaction.status == 'completed')
        .group_by(SponsorshipTransaction.donor_id)
        .order_by(func.sum(SponsorshipTransaction.amount).desc())
        .limit(50)
    )
    if date_filter:
        query = query.where(SponsorshipTransaction.created_at >= date_filter)

    results = await db.execute(query)
    leaderboard_data = results.all()

    donor_ids = [row[0] for row in leaderboard_data if row[0]]
    photographers = {}
    if donor_ids:
        photo_results = await db.execute(select(Profile).where(Profile.id.in_(donor_ids)))
        for p in photo_results.scalars().all():
            photographers[p.id] = {
                "full_name": p.full_name, "avatar_url": p.avatar_url,
                "is_verified": p.is_verified,
                "total_credits_given": p.total_credits_given or 0,
                "total_groms_supported": p.total_groms_supported or 0
            }

    leaderboard = []
    for i, row in enumerate(leaderboard_data):
        donor_id, total, count, to_groms = row
        if donor_id and donor_id in photographers:
            leaderboard.append({
                "rank": i + 1, "photographer_id": donor_id,
                "full_name": photographers[donor_id]["full_name"],
                "avatar_url": photographers[donor_id]["avatar_url"],
                "is_verified": photographers[donor_id]["is_verified"],
                "total_contributed": float(total or 0),
                "contribution_count": int(count or 0),
                "total_to_groms": float(to_groms or 0),
                "grom_percentage": round((float(to_groms or 0) / float(total or 1)) * 100, 1)
            })

    total_contributed_all = sum(entry["total_contributed"] for entry in leaderboard)
    total_to_groms_all = sum(entry["total_to_groms"] for entry in leaderboard)

    return {
        "time_range": time_range,
        "stats": {"total_contributed": total_contributed_all,
                  "total_to_groms": total_to_groms_all, "total_sponsors": len(leaderboard)},
        "leaderboard": leaderboard
    }
