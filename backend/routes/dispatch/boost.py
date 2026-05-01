"""
Request boost and photographer on-demand stats/history.

Part of the dispatch package -- extracted from dispatch.py monolith.
"""
import logging
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Body
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, func
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone, timedelta
import math
import os
import json
import stripe
from utils.geo import haversine_distance

from database import get_db
from models import (
    Profile, DispatchRequest, DispatchRequestParticipant,
    DispatchNotification, DispatchRequestStatusEnum, SurfSpot,
    Booking, BookingParticipant, CreditTransaction, RoleEnum, Notification,
    PaymentTransaction, SessionSnapshot, CancellationExceptionRequest,
    Surfboard
)
from utils.parental_alerts import check_and_send_spending_alert
from services.onesignal_service import onesignal_service

from .schemas import (
    CreateDispatchRequest, AcceptDispatchRequest, UpdateGPSLocation,
    CancelDispatchRequest, UpdateSessionLocationRequest, UpdateSelfieRequest,
    BoostRequestCreate, DispatchCheckoutRequest, ExceptionRequestBody,
    ExceptionResolveBody, CrewPaymentRequest, CrewCheckoutRequest,
    CoverRemainingRequest, RemindCrewRequest,
    get_available_pros, _get_surfer_board_description
)

logger = logging.getLogger("routes.dispatch")
stripe.api_key = os.environ.get("STRIPE_SECRET_KEY") or os.environ.get("STRIPE_API_KEY")

router = APIRouter(prefix="/dispatch", tags=["dispatch"])

# ============ BOOST REQUEST FEATURE ============

@router.post("/request/{request_id}/boost")
async def boost_dispatch_request(
    request_id: str,
    data: BoostRequestCreate,
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Boost a dispatch request to elevate priority in the queue.
    Costs credits based on duration: 5/10/20 credits for 1/2/4 hours.
    """
    # Validate boost hours
    if data.boost_hours not in [1, 2, 4]:
        raise HTTPException(status_code=400, detail="Boost hours must be 1, 2, or 4")
    
    # Get the dispatch request
    result = await db.execute(
        select(DispatchRequest)
        .where(DispatchRequest.id == request_id)
        .options(selectinload(DispatchRequest.requester))
    )
    dispatch = result.scalar_one_or_none()
    
    if not dispatch:
        raise HTTPException(status_code=404, detail="Dispatch request not found")
    
    # Verify user owns this request
    if dispatch.requester_id != user_id:
        raise HTTPException(status_code=403, detail="You can only boost your own requests")
    
    # Verify request is still searching for a pro
    if dispatch.status != DispatchRequestStatusEnum.SEARCHING_FOR_PRO:
        raise HTTPException(status_code=400, detail="Can only boost requests that are actively searching")
    
    # Calculate cost
    pricing = {1: 5, 2: 10, 4: 20}
    cost = pricing[data.boost_hours]
    
    # Get user profile and check credits
    user_result = await db.execute(select(Profile).where(Profile.id == user_id))
    user_profile = user_result.scalar_one_or_none()
    
    if not user_profile:
        raise HTTPException(status_code=404, detail="User profile not found")
    
    if (user_profile.credit_balance or 0) < cost:
        raise HTTPException(
            status_code=402, 
            detail=f"Insufficient credits. Boost costs {cost} credits, you have {user_profile.credit_balance or 0}"
        )
    
    # Deduct credits
    user_profile.credit_balance = (user_profile.credit_balance or 0) - cost
    
    # Apply boost
    dispatch.boost_priority = 10  # Max priority for boosted requests
    dispatch.boost_expires_at = datetime.now(timezone.utc) + timedelta(hours=data.boost_hours)
    dispatch.boost_credits_spent = (dispatch.boost_credits_spent or 0) + cost
    
    await db.commit()
    
    return {
        "success": True,
        "message": f"Request boosted for {data.boost_hours} hour(s)!",
        "boost_expires_at": dispatch.boost_expires_at.isoformat(),
        "credits_spent": cost,
        "remaining_credits": user_profile.credit_balance
    }


@router.get("/request/{request_id}/boost-status")
async def get_boost_status(
    request_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get the current boost status of a dispatch request"""
    result = await db.execute(
        select(DispatchRequest).where(DispatchRequest.id == request_id)
    )
    dispatch = result.scalar_one_or_none()
    
    if not dispatch:
        raise HTTPException(status_code=404, detail="Dispatch request not found")
    
    # Check if boost is still active
    is_boosted = False
    time_remaining = None
    
    if dispatch.boost_priority > 0 and dispatch.boost_expires_at:
        if dispatch.boost_expires_at > datetime.now(timezone.utc):
            is_boosted = True
            time_remaining = (dispatch.boost_expires_at - datetime.now(timezone.utc)).total_seconds() / 60  # minutes
        else:
            # Boost expired, reset priority
            dispatch.boost_priority = 0
            await db.commit()
    
    return {
        "request_id": request_id,
        "is_boosted": is_boosted,
        "boost_priority": dispatch.boost_priority,
        "boost_expires_at": dispatch.boost_expires_at.isoformat() if dispatch.boost_expires_at else None,
        "time_remaining_minutes": round(time_remaining) if time_remaining else 0,
        "total_credits_spent": dispatch.boost_credits_spent or 0
    }



# ============ ON-DEMAND STATS FOR PHOTOGRAPHERS ============

@router.get("/photographer/{photographer_id}/stats")
async def get_photographer_on_demand_stats(
    photographer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Get on-demand statistics for a photographer.
    Includes today's earnings, session counts, streak info, etc.
    """
    from datetime import date
    
    # Verify photographer exists
    result = await db.execute(select(Profile).where(Profile.id == photographer_id))
    photographer = result.scalar_one_or_none()
    
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    today = date.today()
    week_start = today - timedelta(days=today.weekday())
    month_start = today.replace(day=1)
    
    # Get completed dispatches for this photographer
    completed_result = await db.execute(
        select(DispatchRequest)
        .where(
            DispatchRequest.photographer_id == photographer_id,
            DispatchRequest.status == DispatchRequestStatusEnum.COMPLETED
        )
    )
    completed_dispatches = completed_result.scalars().all()
    
    # Calculate stats
    earnings_today = 0.0
    sessions_today = 0
    sessions_week = 0
    sessions_month = 0
    total_earnings = 0.0
    
    for dispatch in completed_dispatches:
        earnings = dispatch.estimated_total or 0
        total_earnings += earnings
        
        if dispatch.completed_at:
            dispatch_date = dispatch.completed_at.date()
            
            if dispatch_date == today:
                earnings_today += earnings
                sessions_today += 1
            
            if dispatch_date >= week_start:
                sessions_week += 1
            
            if dispatch_date >= month_start:
                sessions_month += 1
    
    # Get streak from profile
    streak = photographer.on_demand_streak or 0
    
    return {
        "earnings_today": round(earnings_today, 2),
        "earnings_total": round(total_earnings, 2),
        "sessions_today": sessions_today,
        "sessions_week": sessions_week,
        "sessions_month": sessions_month,
        "total_sessions": len(completed_dispatches),
        "streak": streak,
        "is_hot_streak": streak >= 3,
        "xp_multiplier": 2.0 if streak >= 3 else 1.0
    }


@router.get("/photographer/{photographer_id}/history")
async def get_photographer_session_history(
    photographer_id: str,
    limit: int = 20,
    offset: int = 0,
    db: AsyncSession = Depends(get_db)
):
    """
    Get on-demand session history for a photographer.
    """
    result = await db.execute(
        select(DispatchRequest)
        .where(
            DispatchRequest.photographer_id == photographer_id,
            DispatchRequest.status == DispatchRequestStatusEnum.COMPLETED
        )
        .options(
            selectinload(DispatchRequest.requester),
            selectinload(DispatchRequest.participants).selectinload(DispatchRequestParticipant.participant_profile)
        )
        .order_by(DispatchRequest.completed_at.desc())
        .offset(offset)
        .limit(limit)
    )
    dispatches = result.scalars().all()
    
    history = []
    for d in dispatches:
        # Build participant roster
        participants = []
        for p in (d.participants or []):
            profile = p.participant_profile if hasattr(p, 'participant_profile') else None
            participants.append({
                "id": p.participant_id,
                "full_name": p.payer_name or (profile.full_name if profile else "Surfer"),
                "avatar_url": p.payer_avatar_url or (profile.avatar_url if profile else None),
                "amount_paid": float(p.share_amount or 0) if p.paid else 0,
                "paid": p.paid or False,
            })

        history.append({
            "id": d.id,
            "requester_id": d.requester_id,
            "requester_name": d.requester.full_name if d.requester else "Unknown",
            "requester_avatar": d.requester.avatar_url if d.requester else None,
            "location_name": d.location_name or "Unknown Location",
            "date": d.completed_at.isoformat() if d.completed_at else (d.created_at.isoformat() if d.created_at else None),
            "duration_hours": d.estimated_duration_hours,
            "earnings": d.estimated_total or 0,
            "hourly_rate": d.hourly_rate or 75,
            "participant_count": len(participants) + 1,  # +1 for captain/requester
            "participants": participants,
            "photo_count": 0,
            "gallery_id": None,
        })
    
    return {
        "history": history,
        "total": len(history),
        "offset": offset,
        "limit": limit
    }



