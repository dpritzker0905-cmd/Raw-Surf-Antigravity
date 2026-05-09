"""
Career Hub API Routes
Handles competition results, sponsorships, and career progression
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_, Integer
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone, timedelta, date

from database import get_db
from deps.admin_auth import get_current_admin
from models import (
    Profile, CompetitionResult, Sponsorship, GoldPassBooking,
    EliteTierEnum, XPTransaction, Badge, RoleEnum,
    SponsorshipTransaction, SponsorshipType, CreditTransaction
)
from routes.career_hub.gamification import check_badge_milestones
from utils.parental_alerts import check_and_send_spending_alert

# WebSocket broadcasts for real-time updates
from websocket_manager import broadcast_earnings_update

router = APIRouter(prefix="/career", tags=["career"])


# ============ PYDANTIC MODELS ============

class CompetitionResultCreate(BaseModel):
    event_name: str
    event_date: date
    event_location: Optional[str] = None
    event_tier: Optional[str] = None
    placing: int
    total_competitors: Optional[int] = None
    heat_wins: int = 0
    avg_wave_score: Optional[float] = None
    best_wave_score: Optional[float] = None
    season_points_earned: int = 0
    proof_image_url: Optional[str] = None


class SponsorshipCreate(BaseModel):
    sponsor_name: str
    sponsor_type: str  # 'brand', 'local_shop', 'parent', 'stoke_sponsor'
    sponsor_logo_url: Optional[str] = None
    sponsor_website: Optional[str] = None
    sponsorship_tier: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None


class GoldPassSlotCreate(BaseModel):
    slot_start: datetime
    slot_end: datetime


# ============ COMPETITION RESULTS ============

@router.post("/competition-results")
async def add_competition_result(
    surfer_id: str,
    data: CompetitionResultCreate,
    db: AsyncSession = Depends(get_db)
):
    """Add a competition result (manual entry with optional proof image)"""
    
    # Verify surfer exists
    surfer_result = await db.execute(select(Profile).where(Profile.id == surfer_id))
    surfer = surfer_result.scalar_one_or_none()
    if not surfer:
        raise HTTPException(status_code=404, detail="Surfer not found")
    
    # Create competition result
    result = CompetitionResult(
        surfer_id=surfer_id,
        event_name=data.event_name,
        event_date=data.event_date,
        event_location=data.event_location,
        event_tier=data.event_tier,
        placing=data.placing,
        total_competitors=data.total_competitors,
        heat_wins=data.heat_wins,
        avg_wave_score=data.avg_wave_score,
        best_wave_score=data.best_wave_score,
        season_points_earned=data.season_points_earned,
        proof_image_url=data.proof_image_url,
        external_source='manual',
        verification_status='pending'
    )
    db.add(result)
    await db.commit()
    await db.refresh(result)
    
    return {
        "message": "Competition result added",
        "id": result.id,
        "status": result.verification_status,
        "note": "Submit proof image for Community Verified badge" if not data.proof_image_url else "Pending admin verification"
    }


@router.get("/competition-results/{surfer_id}")
async def get_competition_results(
    surfer_id: str,
    limit: int = 20,
    db: AsyncSession = Depends(get_db)
):
    """Get competition results for a surfer"""
    
    results = await db.execute(
        select(CompetitionResult)
        .where(CompetitionResult.surfer_id == surfer_id)
        .order_by(CompetitionResult.event_date.desc())
        .limit(limit)
    )
    results_list = results.scalars().all()
    
    return {
        "results": [
            {
                "id": r.id,
                "event_name": r.event_name,
                "event_date": r.event_date.isoformat(),
                "event_location": r.event_location,
                "event_tier": r.event_tier,
                "placing": r.placing,
                "total_competitors": r.total_competitors,
                "heat_wins": r.heat_wins,
                "avg_wave_score": r.avg_wave_score,
                "best_wave_score": r.best_wave_score,
                "season_points_earned": r.season_points_earned,
                "verification_status": r.verification_status,
                "proof_image_url": r.proof_image_url,
                "xp_awarded": r.xp_awarded
            }
            for r in results_list
        ]
    }



@router.get("/admin/pending-verifications")
async def get_pending_verifications(
    db: AsyncSession = Depends(get_db)
):
    """Get all pending competition result verifications for admin review"""
    
    # Get all pending results with surfer info
    results = await db.execute(
        select(CompetitionResult)
        .where(CompetitionResult.verification_status == 'pending')
        .order_by(CompetitionResult.created_at.desc())
        .limit(50)
    )
    pending_results = results.scalars().all()
    
    # Get surfer profiles
    surfer_ids = [r.surfer_id for r in pending_results]
    surfers = {}
    if surfer_ids:
        surfer_results = await db.execute(
            select(Profile).where(Profile.id.in_(surfer_ids))
        )
        for s in surfer_results.scalars().all():
            surfers[s.id] = {
                "full_name": s.full_name,
                "avatar_url": s.avatar_url
            }
    
    return {
        "results": [
            {
                "id": r.id,
                "surfer_id": r.surfer_id,
                "surfer_name": surfers.get(r.surfer_id, {}).get("full_name", "Unknown"),
                "surfer_avatar": surfers.get(r.surfer_id, {}).get("avatar_url"),
                "event_name": r.event_name,
                "event_date": r.event_date.isoformat(),
                "event_location": r.event_location,
                "event_tier": r.event_tier,
                "placing": r.placing,
                "total_competitors": r.total_competitors,
                "heat_wins": r.heat_wins,
                "avg_wave_score": r.avg_wave_score,
                "best_wave_score": r.best_wave_score,
                "season_points_earned": r.season_points_earned,
                "proof_image_url": r.proof_image_url,
                "created_at": r.created_at.isoformat()
            }
            for r in pending_results
        ]
    }



@router.post("/competition-results/{result_id}/verify")
async def verify_competition_result(
    result_id: str,
    admin: Profile = Depends(get_current_admin),
    approved: bool = Query(..., description="Whether to approve or reject the result"),
    db: AsyncSession = Depends(get_db)
):
    """Admin/AI verifies a competition result and awards XP"""
    # Get result
    result = await db.execute(select(CompetitionResult).where(CompetitionResult.id == result_id))
    comp_result = result.scalar_one_or_none()
    if not comp_result:
        raise HTTPException(status_code=404, detail="Competition result not found")
    
    if approved:
        comp_result.verification_status = 'community_verified'
        comp_result.verified_by = admin.id
        comp_result.verified_at = datetime.now(timezone.utc)
        
        # Calculate and award XP based on placing
        xp_amount = calculate_competition_xp(comp_result.placing, comp_result.heat_wins, comp_result.event_tier)
        comp_result.xp_awarded = xp_amount
        
        # Award XP to surfer
        xp_tx = XPTransaction(
            user_id=comp_result.surfer_id,
            amount=xp_amount,
            reason=f"Competition result: {comp_result.event_name} - {get_placing_suffix(comp_result.placing)} place",
            reference_type='competition_result',
            reference_id=result_id
        )
        db.add(xp_tx)
        
        # Update surfer's career points
        surfer_result = await db.execute(select(Profile).where(Profile.id == comp_result.surfer_id))
        surfer = surfer_result.scalar_one_or_none()
        if surfer:
            surfer.career_points = (surfer.career_points or 0) + comp_result.season_points_earned
        
        # Check badge milestones
        await check_badge_milestones(comp_result.surfer_id, db)
        
        await db.commit()
        return {"message": "Result verified and XP awarded", "xp_awarded": xp_amount}
    else:
        comp_result.verification_status = 'rejected'
        await db.commit()
        return {"message": "Result rejected"}


def calculate_competition_xp(placing: int, heat_wins: int, event_tier: str) -> int:
    """Calculate XP based on competition results"""
    base_xp = 0
    
    # Base XP for placing
    if placing == 1:
        base_xp = 200  # Event Win
    elif placing <= 3:
        base_xp = 100  # Podium
    elif placing <= 8:
        base_xp = 50   # Quarterfinals+
    else:
        base_xp = 25   # Participation
    
    # Bonus for heat wins
    base_xp += heat_wins * 10
    
    # Tier multiplier
    tier_multipliers = {
        'WSL_CT': 3.0,
        'WSL_QS': 2.0,
        'Regional': 1.5,
        'Local': 1.0,
        'Grom_Series': 1.2
    }
    multiplier = tier_multipliers.get(event_tier, 1.0)
    
    return int(base_xp * multiplier)


def get_placing_suffix(placing: int) -> str:
    """Get ordinal suffix for placing"""
    if 10 <= placing % 100 <= 20:
        suffix = 'th'
    else:
        suffix = {1: 'st', 2: 'nd', 3: 'rd'}.get(placing % 10, 'th')
    return f"{placing}{suffix}"


# ============ CAREER STATS ============

@router.get("/stats/{surfer_id}")
async def get_career_stats(
    surfer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get aggregated career stats for a surfer"""
    
    # Get surfer profile
    surfer_result = await db.execute(select(Profile).where(Profile.id == surfer_id))
    surfer = surfer_result.scalar_one_or_none()
    if not surfer:
        raise HTTPException(status_code=404, detail="Surfer not found")
    
    # Get verified competition results (using string comparison for VARCHAR column)
    results = await db.execute(
        select(CompetitionResult)
        .where(CompetitionResult.surfer_id == surfer_id)
        .where(CompetitionResult.verification_status.in_([
            'community_verified',
            'api_synced'
        ]))
    )
    verified_results = results.scalars().all()
    
    # Calculate stats
    total_events = len(verified_results)
    total_wins = sum(1 for r in verified_results if r.placing == 1)
    total_podiums = sum(1 for r in verified_results if r.placing <= 3)
    total_heat_wins = sum(r.heat_wins for r in verified_results)
    avg_wave_scores = [r.avg_wave_score for r in verified_results if r.avg_wave_score]
    best_wave_scores = [r.best_wave_score for r in verified_results if r.best_wave_score]
    total_season_points = sum(r.season_points_earned for r in verified_results)
    
    # Get total XP
    xp_result = await db.execute(
        select(func.coalesce(func.sum(XPTransaction.amount), 0))
        .where(XPTransaction.user_id == surfer_id)
    )
    total_xp = xp_result.scalar() or 0
    
    # Calculate "Road to the Peak" progress (for Groms)
    road_to_peak_progress = 0
    if surfer.role and surfer.role.value == 'Grom':
        # Progress based on XP (1000 XP = 100%)
        road_to_peak_progress = min(100, int((total_xp / 1000) * 100))
    
    return {
        "surfer_id": surfer_id,
        "elite_tier": surfer.elite_tier if surfer.elite_tier else None,
        "world_ranking": surfer.world_ranking,
        "career_points": surfer.career_points or 0,
        "stats": {
            "total_events": total_events,
            "event_wins": total_wins,
            "podium_finishes": total_podiums,
            "total_heat_wins": total_heat_wins,
            "avg_wave_score": round(sum(avg_wave_scores) / len(avg_wave_scores), 2) if avg_wave_scores else None,
            "best_wave_score": max(best_wave_scores) if best_wave_scores else None,
            "season_points": total_season_points
        },
        "total_xp": int(total_xp),
        "road_to_peak_progress": road_to_peak_progress,
        "verified_results_count": total_events
    }


# ============ SPONSORSHIPS ============

@router.post("/sponsorships")
async def add_sponsorship(
    surfer_id: str,
    data: SponsorshipCreate,
    db: AsyncSession = Depends(get_db)
):
    """Add a sponsorship for a surfer"""
    
    sponsorship = Sponsorship(
        surfer_id=surfer_id,
        sponsor_name=data.sponsor_name,
        sponsor_type=data.sponsor_type,
        sponsor_logo_url=data.sponsor_logo_url,
        sponsor_website=data.sponsor_website,
        sponsorship_tier=data.sponsorship_tier,
        start_date=data.start_date,
        end_date=data.end_date,
        is_active=True
    )
    db.add(sponsorship)
    await db.commit()
    await db.refresh(sponsorship)
    
    return {
        "message": "Sponsorship added",
        "id": sponsorship.id
    }


@router.get("/sponsorships/{surfer_id}")
async def get_sponsorships(
    surfer_id: str,
    active_only: bool = True,
    db: AsyncSession = Depends(get_db)
):
    """Get sponsorships for a surfer"""
    
    query = select(Sponsorship).where(Sponsorship.surfer_id == surfer_id)
    if active_only:
        query = query.where(Sponsorship.is_active.is_(True))
    query = query.order_by(Sponsorship.sponsorship_tier.desc())
    
    results = await db.execute(query)
    sponsorships = results.scalars().all()
    
    return {
        "sponsorships": [
            {
                "id": s.id,
                "sponsor_name": s.sponsor_name,
                "sponsor_type": s.sponsor_type,
                "sponsor_logo_url": s.sponsor_logo_url,
                "sponsor_website": s.sponsor_website,
                "sponsorship_tier": s.sponsorship_tier,
                "start_date": s.start_date.isoformat() if s.start_date else None,
                "end_date": s.end_date.isoformat() if s.end_date else None,
                "is_active": s.is_active,
                "auto_pay_enabled": s.auto_pay_enabled
            }
            for s in sponsorships
        ]
    }


# ============ GOLD-PASS BOOKING ============

@router.post("/gold-pass/create-slot")
async def create_gold_pass_slot(
    photographer_id: str,
    data: GoldPassSlotCreate,
    db: AsyncSession = Depends(get_db)
):
    """Photographer creates a time slot with 2-hour Gold-Pass window for Pro-Elite"""
    
    # Verify photographer is vetted
    photo_result = await db.execute(select(Profile).where(Profile.id == photographer_id))
    photographer = photo_result.scalar_one_or_none()
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    # Calculate gold pass expiry (24 hours from now - priority booking window)
    gold_pass_expires = datetime.now(timezone.utc) + timedelta(hours=24)
    
    slot = GoldPassBooking(
        photographer_id=photographer_id,
        slot_start=data.slot_start,
        slot_end=data.slot_end,
        gold_pass_expires_at=gold_pass_expires,
        is_gold_pass_active=True
    )
    db.add(slot)
    await db.commit()
    await db.refresh(slot)
    
    # TODO: Send push notification to Pro-Elite surfers
    
    return {
        "message": "Gold-Pass slot created",
        "id": slot.id,
        "gold_pass_expires_at": gold_pass_expires.isoformat(),
        "note": "Pro-Elite surfers have 24-hour exclusive booking window"
    }


@router.get("/gold-pass/available")
async def get_gold_pass_slots(
    surfer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get available booking slots - Premium subscribers (tier_3) get Gold-Pass early access"""
    
    # Get surfer
    surfer_result = await db.execute(select(Profile).where(Profile.id == surfer_id))
    surfer = surfer_result.scalar_one_or_none()
    if not surfer:
        raise HTTPException(status_code=404, detail="Surfer not found")
    
    # Gold Pass = Premium subscription (tier_3) for ANY role
    has_gold_pass = surfer.subscription_tier == 'tier_3'
    now = datetime.now(timezone.utc)
    
    # Query available slots
    query = (
        select(GoldPassBooking)
        .where(GoldPassBooking.booked_by.is_(None))
        .where(GoldPassBooking.slot_start > now)
    )
    
    # Gold Pass holders see ALL slots, others only see unlocked slots
    if not has_gold_pass:
        query = query.where(GoldPassBooking.gold_pass_expires_at < now)
    
    query = query.order_by(GoldPassBooking.slot_start)
    
    results = await db.execute(query)
    slots = results.scalars().all()
    
    # Get photographer info for each slot
    photographer_ids = list(set(s.photographer_id for s in slots))
    photographers = {}
    if photographer_ids:
        photo_result = await db.execute(
            select(Profile.id, Profile.full_name, Profile.avatar_url)
            .where(Profile.id.in_(photographer_ids))
        )
        for p in photo_result.fetchall():
            photographers[p[0]] = {"name": p[1], "avatar": p[2]}
    
    return {
        "has_gold_pass": has_gold_pass,
        "subscription_tier": surfer.subscription_tier,
        "slots": [
            {
                "id": s.id,
                "photographer_id": s.photographer_id,
                "photographer_name": photographers.get(s.photographer_id, {}).get("name", "Unknown"),
                "photographer_avatar": photographers.get(s.photographer_id, {}).get("avatar"),
                "slot_start": s.slot_start.isoformat(),
                "slot_end": s.slot_end.isoformat(),
                "start_time": s.slot_start.strftime("%H:%M"),
                "end_time": s.slot_end.strftime("%H:%M"),
                "date": s.slot_start.strftime("%Y-%m-%d"),
                "is_locked": s.gold_pass_expires_at > now and not has_gold_pass,
                "is_gold_pass_active": s.gold_pass_expires_at > now,
                "gold_pass_expires_at": s.gold_pass_expires_at.isoformat(),
                "unlock_minutes_remaining": max(0, int((s.gold_pass_expires_at - now).total_seconds() / 60)) if s.gold_pass_expires_at > now else 0
            }
            for s in slots
        ]
    }


@router.post("/gold-pass/{slot_id}/book")
async def book_gold_pass_slot(
    slot_id: str,
    surfer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Book a gold-pass slot (Premium subscribers only during gold window)"""
    
    # Get surfer
    surfer_result = await db.execute(select(Profile).where(Profile.id == surfer_id))
    surfer = surfer_result.scalar_one_or_none()
    if not surfer:
        raise HTTPException(status_code=404, detail="Surfer not found")
    
    # Get slot
    slot_result = await db.execute(select(GoldPassBooking).where(GoldPassBooking.id == slot_id))
    slot = slot_result.scalar_one_or_none()
    if not slot:
        raise HTTPException(status_code=404, detail="Slot not found")
    
    if slot.booked_by:
        raise HTTPException(status_code=400, detail="Slot already booked")
    
    now = datetime.now(timezone.utc)
    is_gold_pass_active = slot.gold_pass_expires_at > now
    has_gold_pass = surfer.subscription_tier == 'tier_3'
    
    # Check if non-premium user trying to book during gold window
    if is_gold_pass_active and not has_gold_pass:
        minutes_remaining = int((slot.gold_pass_expires_at - now).total_seconds() / 60)
        raise HTTPException(
            status_code=403,
            detail=f"Gold-Pass exclusive window active. Upgrade to Premium or wait {minutes_remaining} minutes."
        )
    
    # Book the slot
    slot.booked_by = surfer_id
    slot.booked_at = now
    slot.was_gold_pass_booking = is_gold_pass_active and has_gold_pass
    
    await db.commit()
    
    return {
        "message": "Slot booked successfully",
        "was_gold_pass_booking": slot.was_gold_pass_booking,
        "slot_start": slot.slot_start.isoformat(),
        "slot_end": slot.slot_end.isoformat()
    }


# ============ ELITE TALENT FEED ============

@router.get("/elite-photographers")
async def get_elite_photographers(
    db: AsyncSession = Depends(get_db)
):
    """Get photographers who have history shooting world-class talent"""
    
    # For MVP: Return photographers who are 'Approved Pro' type
    # Future: Track actual elite shoots and rank accordingly
    
    results = await db.execute(
        select(Profile)
        .where(Profile.role.in_([RoleEnum.APPROVED_PRO, RoleEnum.PHOTOGRAPHER]))
        .where(Profile.is_verified.is_(True))
        .order_by(Profile.created_at.desc())
        .limit(20)
    )
    photographers = results.scalars().all()
    
    return {
        "elite_photographers": [
            {
                "id": p.id,
                "full_name": p.full_name,
                "avatar_url": p.avatar_url,
                "bio": p.bio,
                "is_verified": p.is_verified,
                "portfolio_url": p.portfolio_url,
                "instagram_url": p.instagram_url
            }
            for p in photographers
        ]
    }


# Stoke Sponsor system moved to career_stoke_sponsor.py (v88)
