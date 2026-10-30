"""
Challenge Mode API - Weekly competitions for photographers

Features:
- Weekly challenges to support the most Groms
- Trophy badges for top 3 winners
- Real-time leaderboard during challenge
- Auto-creation of new challenges each week
"""

from fastapi import APIRouter, HTTPException, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc, and_
from sqlalchemy.orm import selectinload
from datetime import datetime, timezone, timedelta
from typing import Optional
import logging

from database import get_db
from models import (
    Profile, WeeklyChallenge, ChallengeParticipant, 
    ImpactLedger, Notification
)

router = APIRouter(prefix="/challenges", tags=["Challenge Mode"])
logger = logging.getLogger(__name__)


def get_current_week():
    """Get current ISO week number and year"""
    now = datetime.now(timezone.utc)
    return now.isocalendar()[1], now.year


def get_week_dates(week_number: int, year: int):
    """Get start and end dates for a given week"""
    # First day of the year
    jan1 = datetime(year, 1, 1, tzinfo=timezone.utc)
    # Find first Monday
    days_to_monday = (7 - jan1.weekday()) % 7
    first_monday = jan1 + timedelta(days=days_to_monday)
    
    # Calculate week start (Monday)
    week_start = first_monday + timedelta(weeks=week_number - 1)
    if jan1.weekday() <= 3:  # If Jan 1 is Mon-Thu, week 1 includes it
        week_start = first_monday + timedelta(weeks=week_number - 2)
    
    week_end = week_start + timedelta(days=6, hours=23, minutes=59, seconds=59)
    
    return week_start, week_end


@router.get("/current")
async def get_current_challenge(db: AsyncSession = Depends(get_db)):
    """Get the current active challenge"""
    week, year = get_current_week()
    
    # Find active challenge for this week
    result = await db.execute(
        select(WeeklyChallenge)
        .where(WeeklyChallenge.week_number == week)
        .where(WeeklyChallenge.year == year)
        .where(WeeklyChallenge.status == 'active')
    )
    challenge = result.scalar_one_or_none()
    
    if not challenge:
        # Auto-create challenge for this week
        challenge = await create_weekly_challenge(week, year, db)
    
    # Get top participants
    participants_result = await db.execute(
        select(ChallengeParticipant)
        .where(ChallengeParticipant.challenge_id == challenge.id)
        .options(selectinload(ChallengeParticipant.photographer))
        .order_by(desc(ChallengeParticipant.score))
        .limit(20)
    )
    participants = participants_result.scalars().all()
    
    leaderboard = []
    for rank, p in enumerate(participants, 1):
        leaderboard.append({
            "rank": rank,
            "photographer_id": p.photographer_id,
            "full_name": p.photographer.full_name if p.photographer else "Unknown",
            "avatar_url": p.photographer.avatar_url if p.photographer else None,
            "score": p.score,
            "groms_supported": p.groms_supported,
            "is_trophy_position": rank <= 3
        })
    
    # Calculate time remaining
    now = datetime.now(timezone.utc)
    time_remaining = (challenge.ends_at - now).total_seconds() if challenge.ends_at > now else 0
    
    return {
        "challenge": {
            "id": challenge.id,
            "title": challenge.title,
            "description": challenge.description,
            "challenge_type": challenge.challenge_type,
            "badge_name": challenge.badge_name,
            "badge_emoji": challenge.badge_emoji,
            "week_number": challenge.week_number,
            "year": challenge.year,
            "starts_at": challenge.starts_at.isoformat(),
            "ends_at": challenge.ends_at.isoformat(),
            "status": challenge.status
        },
        "leaderboard": leaderboard,
        "time_remaining_seconds": max(0, int(time_remaining)),
        "total_participants": len(participants)
    }


@router.get("/history")
async def get_challenge_history(
    limit: int = Query(default=10, le=50),
    db: AsyncSession = Depends(get_db)
):
    """Get past challenges and winners"""
    result = await db.execute(
        select(WeeklyChallenge)
        .where(WeeklyChallenge.status == 'completed')
        .order_by(desc(WeeklyChallenge.ends_at))
        .limit(limit)
    )
    challenges = result.scalars().all()
    
    history = []
    for challenge in challenges:
        # Get winners (top 3)
        winners_result = await db.execute(
            select(ChallengeParticipant)
            .where(ChallengeParticipant.challenge_id == challenge.id)
            .where(ChallengeParticipant.earned_trophy.is_(True))
            .options(selectinload(ChallengeParticipant.photographer))
            .order_by(ChallengeParticipant.final_rank)
        )
        winners = winners_result.scalars().all()
        
        history.append({
            "challenge_id": challenge.id,
            "title": challenge.title,
            "week_number": challenge.week_number,
            "year": challenge.year,
            "badge_emoji": challenge.badge_emoji,
            "winners": [{
                "rank": w.final_rank,
                "photographer_id": w.photographer_id,
                "full_name": w.photographer.full_name if w.photographer else "Unknown",
                "avatar_url": w.photographer.avatar_url if w.photographer else None,
                "score": w.score
            } for w in winners]
        })
    
    return {"history": history}


@router.get("/photographer/{photographer_id}/stats")
async def get_photographer_challenge_stats(
    photographer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get a photographer's challenge participation stats"""
    # Get total challenges participated
    total_result = await db.execute(
        select(func.count(ChallengeParticipant.id))
        .where(ChallengeParticipant.photographer_id == photographer_id)
    )
    total_participated = total_result.scalar() or 0
    
    # Get trophies earned
    trophies_result = await db.execute(
        select(func.count(ChallengeParticipant.id))
        .where(ChallengeParticipant.photographer_id == photographer_id)
        .where(ChallengeParticipant.earned_trophy.is_(True))
    )
    trophies_earned = trophies_result.scalar() or 0
    
    # Get current challenge position
    week, year = get_current_week()
    current_result = await db.execute(
        select(ChallengeParticipant)
        .join(WeeklyChallenge)
        .where(WeeklyChallenge.week_number == week)
        .where(WeeklyChallenge.year == year)
        .where(ChallengeParticipant.photographer_id == photographer_id)
    )
    current_participation = current_result.scalar_one_or_none()
    
    current_rank = None
    if current_participation:
        # Calculate current rank
        rank_result = await db.execute(
            select(func.count(ChallengeParticipant.id))
            .where(ChallengeParticipant.challenge_id == current_participation.challenge_id)
            .where(ChallengeParticipant.score > current_participation.score)
        )
        current_rank = (rank_result.scalar() or 0) + 1
    
    return {
        "photographer_id": photographer_id,
        "total_challenges": total_participated,
        "trophies_earned": trophies_earned,
        "current_challenge": {
            "score": current_participation.score if current_participation else 0,
            "rank": current_rank,
            "groms_supported": current_participation.groms_supported if current_participation else 0
        } if current_participation else None
    }


async def create_weekly_challenge(week: int, year: int, db: AsyncSession) -> WeeklyChallenge:
    """Create a new weekly challenge"""
    start_date, end_date = get_week_dates(week, year)
    
    challenge = WeeklyChallenge(
        week_number=week,
        year=year,
        challenge_type='grom_support',
        title=f"Week {week} Grom Support Challenge",
        description="Support the most Groms this week to earn the Weekly Champion trophy!",
        badge_name="Weekly Champion",
        badge_emoji="🏆",
        status='active',
        starts_at=start_date,
        ends_at=end_date
    )
    db.add(challenge)
    await db.commit()
    await db.refresh(challenge)
    
    logger.info(f"Created weekly challenge for week {week}/{year}")
    return challenge


async def update_challenge_score(
    photographer_id: str,
    amount: float,
    recipient_type: str,
    db: AsyncSession
):
    """Update a photographer's score in the current challenge"""
    week, year = get_current_week()
    
    # Find current challenge
    challenge_result = await db.execute(
        select(WeeklyChallenge)
        .where(WeeklyChallenge.week_number == week)
        .where(WeeklyChallenge.year == year)
        .where(WeeklyChallenge.status == 'active')
    )
    challenge = challenge_result.scalar_one_or_none()
    
    if not challenge:
        return  # No active challenge
    
    # Find or create participant
    participant_result = await db.execute(
        select(ChallengeParticipant)
        .where(ChallengeParticipant.challenge_id == challenge.id)
        .where(ChallengeParticipant.photographer_id == photographer_id)
    )
    participant = participant_result.scalar_one_or_none()
    
    if not participant:
        participant = ChallengeParticipant(
            challenge_id=challenge.id,
            photographer_id=photographer_id,
            score=0,
            groms_supported=0
        )
        db.add(participant)
    
    # Update score
    participant.score += amount
    if recipient_type == 'grom':
        participant.groms_supported += 1
    participant.last_contribution_at = datetime.now(timezone.utc)
    
    # Check if they entered top 3
    rank_result = await db.execute(
        select(func.count(ChallengeParticipant.id))
        .where(ChallengeParticipant.challenge_id == challenge.id)
        .where(ChallengeParticipant.score > participant.score)
    )
    new_rank = (rank_result.scalar() or 0) + 1
    
    if new_rank <= 3:
        # Get photographer name for notification
        profile_result = await db.execute(select(Profile).where(Profile.id == photographer_id))
        profile = profile_result.scalar_one_or_none()
        
        # Could notify followers here
        logger.info(f"Photographer {profile.full_name if profile else photographer_id} is now #{new_rank} in the weekly challenge!")


async def finalize_weekly_challenge(db: AsyncSession):
    """
    Called by scheduler when a challenge ends.
    Sets final ranks and awards trophies.
    """
    week, year = get_current_week()
    
    # Find the challenge that just ended (previous week)
    prev_week = week - 1 if week > 1 else 52
    prev_year = year if week > 1 else year - 1
    
    challenge_result = await db.execute(
        select(WeeklyChallenge)
        .where(WeeklyChallenge.week_number == prev_week)
        .where(WeeklyChallenge.year == prev_year)
        .where(WeeklyChallenge.status == 'active')
    )
    challenge = challenge_result.scalar_one_or_none()
    
    if not challenge:
        return
    
    # Get all participants ranked
    participants_result = await db.execute(
        select(ChallengeParticipant)
        .where(ChallengeParticipant.challenge_id == challenge.id)
        .order_by(desc(ChallengeParticipant.score))
    )
    participants = participants_result.scalars().all()
    
    # Set final ranks and award trophies
    for rank, p in enumerate(participants, 1):
        p.final_rank = rank
        if rank <= 3:
            p.earned_trophy = True
            
            # Add trophy badge to profile
            profile_result = await db.execute(select(Profile).where(Profile.id == p.photographer_id))
            profile = profile_result.scalar_one_or_none()
            if profile:
                badges = profile.badges or []
                badges.append({
                    "type": "weekly_champion",
                    "rank": rank,
                    "week": prev_week,
                    "year": prev_year,
                    "emoji": "🏆" if rank == 1 else ("🥈" if rank == 2 else "🥉")
                })
                profile.badges = badges
    
    # Mark challenge as completed
    challenge.status = 'completed'
    
    await db.commit()
    logger.info(f"Finalized challenge for week {prev_week}/{prev_year}, {len(participants)} participants")
