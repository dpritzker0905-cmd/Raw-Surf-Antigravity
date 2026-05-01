"""
Crew payment progress -- cover remaining, remind crew.

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

# ===================== TICKET-003: Crew Payment Progress Endpoints =====================

class CoverRemainingRequest(BaseModel):
    captain_id: str


class RemindCrewRequest(BaseModel):
    captain_id: str
    member_id: str


@router.post("/{dispatch_id}/cover-remaining")
async def captain_cover_remaining(
    dispatch_id: str,
    data: CoverRemainingRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Captain pays remaining unpaid crew shares to unlock media immediately.
    Deducts from captain's credit balance and marks all crew as paid.
    """
    # Get dispatch
    result = await db.execute(
        select(DispatchRequest)
        .where(DispatchRequest.id == dispatch_id)
        .options(selectinload(DispatchRequest.requester))
    )
    dispatch = result.scalar_one_or_none()
    
    if not dispatch:
        raise HTTPException(status_code=404, detail="Dispatch not found")
    
    # Verify captain
    if dispatch.requester_id != data.captain_id:
        raise HTTPException(status_code=403, detail="Only the captain can cover remaining shares")
    
    # Get unpaid crew members
    crew_result = await db.execute(
        select(DispatchRequestParticipant)
        .where(
            DispatchRequestParticipant.dispatch_request_id == dispatch_id,
            DispatchRequestParticipant.paid == False
        )
    )
    unpaid_crew = crew_result.scalars().all()
    
    if not unpaid_crew:
        return {"success": True, "message": "All crew members already paid", "amount_covered": 0}
    
    # Calculate total unpaid amount
    total_unpaid = sum(cp.share_amount or 0 for cp in unpaid_crew)
    
    if total_unpaid <= 0:
        return {"success": True, "message": "No outstanding balance", "amount_covered": 0}
    
    # Check captain's credit balance
    captain_result = await db.execute(
        select(Profile).where(Profile.id == data.captain_id)
    )
    captain = captain_result.scalar_one_or_none()
    
    if not captain:
        raise HTTPException(status_code=404, detail="Captain profile not found")
    
    if (captain.credit_balance or 0) < total_unpaid:
        raise HTTPException(
            status_code=400, 
            detail=f"Insufficient credits. Need ${total_unpaid:.2f}, have ${captain.credit_balance or 0:.2f}"
        )
    
    # Atomic transaction: deduct credits and mark all as paid
    try:
        # Deduct from captain's balance
        captain.credit_balance = (captain.credit_balance or 0) - total_unpaid
        
        # Mark all unpaid crew as paid
        for cp in unpaid_crew:
            cp.paid = True
            cp.paid_at = datetime.now(timezone.utc)
            cp.status = 'paid'
            # Store who covered the payment
            if not cp.payer_name:
                cp.payer_name = f"Covered by {captain.full_name}"
        
        # Update dispatch flags
        dispatch.all_participants_paid = True
        dispatch.all_participants_paid_at = datetime.now(timezone.utc)
        
        # Create credit transaction
        credit_tx = CreditTransaction(
            user_id=data.captain_id,
            amount=-total_unpaid,
            transaction_type='crew_cover',
            description=f"Covered ${total_unpaid:.2f} for {len(unpaid_crew)} crew members",
            reference_type='dispatch',
            reference_id=dispatch_id,
            balance_after=captain.credit_balance
        )
        db.add(credit_tx)
        
        await db.commit()
        
        return {
            "success": True,
            "amount_covered": total_unpaid,
            "crew_covered": len(unpaid_crew),
            "new_balance": captain.credit_balance
        }
        
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to cover remaining: {str(e)}")


@router.post("/{dispatch_id}/remind-crew")
async def send_crew_reminder(
    dispatch_id: str,
    data: RemindCrewRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db)
):
    """
    Send a payment reminder push notification to an unpaid crew member.
    Only the captain can send reminders.
    """
    # Get dispatch
    result = await db.execute(
        select(DispatchRequest)
        .where(DispatchRequest.id == dispatch_id)
        .options(selectinload(DispatchRequest.requester))
    )
    dispatch = result.scalar_one_or_none()
    
    if not dispatch:
        raise HTTPException(status_code=404, detail="Dispatch not found")
    
    # Verify captain
    if dispatch.requester_id != data.captain_id:
        raise HTTPException(status_code=403, detail="Only the captain can send reminders")
    
    # Get the crew member
    crew_result = await db.execute(
        select(DispatchRequestParticipant)
        .where(
            DispatchRequestParticipant.dispatch_request_id == dispatch_id,
            DispatchRequestParticipant.participant_id == data.member_id
        )
    )
    crew_member = crew_result.scalar_one_or_none()
    
    if not crew_member:
        raise HTTPException(status_code=404, detail="Crew member not found in this dispatch")
    
    if crew_member.paid:
        return {"success": True, "message": "Crew member has already paid"}
    
    # Get crew member profile for push
    member_result = await db.execute(
        select(Profile).where(Profile.id == data.member_id)
    )
    member = member_result.scalar_one_or_none()
    
    if not member:
        raise HTTPException(status_code=404, detail="Member profile not found")
    
    # Send push notification
    captain_name = dispatch.captain_name or dispatch.requester.full_name if dispatch.requester else "Your captain"
    
    background_tasks.add_task(
        onesignal_service.send_to_user,
        user_id=data.member_id,
        title="Payment Reminder",
        message=f"{captain_name} is waiting for your payment (${crew_member.share_amount:.2f}) to start the session!",
        data={
            "type": "crew_payment_reminder",
            "dispatch_id": dispatch_id,
            "amount": crew_member.share_amount
        }
    )
    
    # Also create an in-app notification
    notification = Notification(
        user_id=data.member_id,
        type='crew_payment_reminder',
        title='Payment Reminder',
        message=f"{captain_name} is waiting for your payment of ${crew_member.share_amount:.2f}",
        data={
            "dispatch_id": dispatch_id,
            "amount": crew_member.share_amount,
            "captain_id": data.captain_id
        }
    )
    db.add(notification)
    await db.commit()
    
    return {"success": True, "message": "Reminder sent"}

