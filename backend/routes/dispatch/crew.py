"""
Crew management -- invites, decline, crew pay, crew checkout, tracking.

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

@router.get("/user/{user_id}/crew-invites")
async def get_crew_invites(
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get pending crew invites for a user (shared session invitations)"""
    # Find all dispatch participants where user is invited but hasn't paid
    result = await db.execute(
        select(DispatchRequestParticipant)
        .where(
            DispatchRequestParticipant.participant_id == user_id,
            DispatchRequestParticipant.status.in_(['invited', 'pending'])
        )
        .options(selectinload(DispatchRequestParticipant.dispatch_request))
    )
    participants = result.scalars().all()
    
    invites = []
    for participant in participants:
        dispatch = participant.dispatch_request
        if not dispatch or dispatch.status in [
            DispatchRequestStatusEnum.COMPLETED,
            DispatchRequestStatusEnum.CANCELLED
        ]:
            continue
        
        # Get captain info
        captain_result = await db.execute(
            select(Profile).where(Profile.id == dispatch.requester_id)
        )
        captain = captain_result.scalar_one_or_none()
        
        # Get photographer info if assigned
        photographer = None
        if dispatch.target_photographer_id:
            photo_result = await db.execute(
                select(Profile).where(Profile.id == dispatch.target_photographer_id)
            )
            photographer = photo_result.scalar_one_or_none()
        
        invites.append({
            "id": participant.id,
            "dispatch_id": dispatch.id,
            "captain": {
                "id": captain.id if captain else None,
                "name": captain.full_name if captain else "Unknown",
                "avatar_url": captain.avatar_url if captain else None
            },
            "photographer": {
                "id": photographer.id if photographer else None,
                "name": photographer.full_name if photographer else None,
                "avatar_url": photographer.avatar_url if photographer else None
            } if photographer else None,
            "location_name": dispatch.location_name,
            "estimated_duration_hours": dispatch.estimated_duration_hours,
            "your_share": participant.share_amount,
            "status": participant.status,
            "dispatch_status": dispatch.status.value,
            "created_at": dispatch.created_at.isoformat()
        })
    
    return {"crew_invites": invites}


@router.post("/crew-invite/{participant_id}/decline")
async def decline_crew_invite(
    participant_id: str,
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Crew member declines a shared session invite.
    Sets the participant status to 'declined' and notifies the captain.
    """
    # Find the participant record
    result = await db.execute(
        select(DispatchRequestParticipant)
        .where(DispatchRequestParticipant.id == participant_id)
        .options(selectinload(DispatchRequestParticipant.dispatch_request))
    )
    participant = result.scalar_one_or_none()

    if not participant:
        raise HTTPException(status_code=404, detail="Invite not found")

    if participant.participant_id != user_id:
        raise HTTPException(status_code=403, detail="You can only decline your own invites")

    if participant.status == 'paid':
        raise HTTPException(status_code=400, detail="Cannot decline — you've already paid")

    if participant.status == 'declined':
        return {"success": True, "message": "Already declined"}

    dispatch = participant.dispatch_request
    if dispatch and dispatch.status in [
        DispatchRequestStatusEnum.COMPLETED,
        DispatchRequestStatusEnum.CANCELLED
    ]:
        raise HTTPException(status_code=400, detail="Session is no longer active")

    # Mark as declined
    participant.status = 'declined'

    # Notify the captain that a crew member declined
    if dispatch:
        # Look up the declining user's name
        decliner_result = await db.execute(
            select(Profile).where(Profile.id == user_id)
        )
        decliner = decliner_result.scalar_one_or_none()
        decliner_name = decliner.full_name if decliner else "A crew member"

        notification = Notification(
            user_id=dispatch.requester_id,
            type='crew_invite_declined',
            title='Crew Member Declined',
            body=f'{decliner_name} declined your session invite',
            data=json.dumps({
                'dispatch_id': dispatch.id,
                'participant_id': participant_id,
                'decliner_name': decliner_name,
                'action': 'crew_declined'
            })
        )
        db.add(notification)

    await db.commit()

    return {
        "success": True,
        "message": "Invite declined",
        "participant_id": participant_id
    }


class CrewPaymentRequest(BaseModel):
    selfie_url: Optional[str] = None
    require_selfie: bool = False  # If true, payment will fail without selfie


@router.post("/crew-invite/{participant_id}/pay")
async def pay_crew_share(
    participant_id: str,
    payer_id: str,
    payment_data: Optional[CrewPaymentRequest] = Body(default=None),
    db: AsyncSession = Depends(get_db)
):
    """
    Crew member pays their share of a shared session.
    
    ATOMIC TRANSACTION: This endpoint ensures that:
    1. User profile metadata is ALWAYS written to participant record
    2. Payment and metadata updates happen in the same transaction
    3. If metadata write fails, payment is rolled back
    """
    # Find the participant record
    result = await db.execute(
        select(DispatchRequestParticipant)
        .where(DispatchRequestParticipant.id == participant_id)
        .options(selectinload(DispatchRequestParticipant.dispatch_request))
    )
    participant = result.scalar_one_or_none()
    
    if not participant:
        raise HTTPException(status_code=404, detail="Invite not found")
    
    if participant.participant_id != payer_id:
        raise HTTPException(status_code=403, detail="You can only pay for your own share")
    
    if participant.status == 'paid':
        raise HTTPException(status_code=400, detail="Already paid")
    
    dispatch = participant.dispatch_request
    if dispatch.status in [DispatchRequestStatusEnum.COMPLETED, DispatchRequestStatusEnum.CANCELLED]:
        raise HTTPException(status_code=400, detail="Session is no longer active")
    
    # Get payer's profile - REQUIRED for metadata injection
    payer_result = await db.execute(select(Profile).where(Profile.id == payer_id))
    payer = payer_result.scalar_one_or_none()
    
    if not payer:
        raise HTTPException(status_code=404, detail="User not found")
    
    # DATA INTEGRITY CHECK: Validate selfie if required or if session is in active state
    selfie_url = payment_data.selfie_url if payment_data else None
    
    # If dispatch is already accepted/en_route, selfie is highly recommended
    if dispatch.status in [DispatchRequestStatusEnum.ACCEPTED, DispatchRequestStatusEnum.EN_ROUTE]:
        if not selfie_url and not participant.selfie_url:
            # Return a "needs_selfie" response instead of failing
            return {
                "success": False,
                "needs_selfie": True,
                "message": "The photographer is already on their way! Please add a selfie so they can find you.",
                "dispatch_status": dispatch.status.value
            }
    
    # Check if payer has enough credits
    if payer.credit_balance < participant.share_amount:
        raise HTTPException(
            status_code=400, 
            detail=f"Insufficient credits. You need ${participant.share_amount:.2f} but have ${payer.credit_balance:.2f}"
        )
    
    # ============ ATOMIC TRANSACTION START ============
    # All updates happen together or none at all
    
    try:
        # 1. Deduct credits
        old_balance = payer.credit_balance
        payer.credit_balance -= participant.share_amount
        
        # 2. Record transaction
        tx = CreditTransaction(
            user_id=payer_id,
            amount=-participant.share_amount,
            balance_before=old_balance,
            balance_after=payer.credit_balance,
            transaction_type='crew_session_payment',
            reference_type='dispatch_participant',
            reference_id=participant_id
        )
        db.add(tx)
        
        # 3. CRITICAL: Update participant with ALL metadata atomically
        participant.status = 'paid'
        participant.paid = True
        participant.paid_at = datetime.now(timezone.utc)
        
        # Store selfie URL if provided
        if selfie_url:
            participant.selfie_url = selfie_url
        
        # 4. METADATA INJECTION: Store profile data for dashboard sync
        # This ensures photographer dashboard has immediate access to surfer info
        # even if profile lookup fails later
        participant.payer_name = payer.full_name
        participant.payer_username = payer.username
        participant.payer_avatar_url = payer.avatar_url
        
        # 5. CHECK IF ALL CREW MEMBERS PAID (triggers "2/2 complete" state)
        # Query all participants in this dispatch to check completion
        all_participants_result = await db.execute(
            select(DispatchRequestParticipant)
            .where(DispatchRequestParticipant.dispatch_request_id == dispatch.id)
        )
        all_participants = all_participants_result.scalars().all()
        
        total_crew = len(all_participants)
        paid_crew = sum(1 for p in all_participants if p.paid or p.id == participant_id)
        all_crew_paid = paid_crew >= total_crew
        
        # 6. If all crew paid AND captain has paid, dispatch is fully funded
        dispatch_fully_funded = all_crew_paid and dispatch.deposit_paid
        
        if dispatch_fully_funded:
            # Mark dispatch as ready for notification
            dispatch.all_participants_paid = True
            dispatch.all_participants_paid_at = datetime.now(timezone.utc)
        
        # Commit all changes atomically
        await db.commit()
        
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=500, 
            detail=f"Payment failed - transaction rolled back. Please try again. Error: {str(e)}"
        )
    
    # ============ ATOMIC TRANSACTION END ============
    
    # Calculate crew payment status for response
    all_participants_result = await db.execute(
        select(DispatchRequestParticipant)
        .where(DispatchRequestParticipant.dispatch_request_id == dispatch.id)
    )
    all_participants = all_participants_result.scalars().all()
    total_crew = len(all_participants)
    paid_crew = sum(1 for p in all_participants if p.paid)
    
    return {
        "success": True,
        "message": "Payment successful! You're in the session.",
        "remaining_credits": payer.credit_balance,
        "participant_id": participant_id,
        "dispatch_id": dispatch.id,
        "has_selfie": bool(participant.selfie_url),
        "crew_payment_status": {
            "paid_count": paid_crew,
            "total_count": total_crew,
            "all_paid": paid_crew >= total_crew,
            "captain_paid": dispatch.deposit_paid,
            "fully_funded": dispatch.deposit_paid and paid_crew >= total_crew
        }
    }


class CrewCheckoutRequest(BaseModel):
    selfie_url: Optional[str] = None
    origin_url: str = "https://dev--rawsurf.netlify.app"


@router.post("/crew-invite/{participant_id}/checkout")
async def crew_invite_checkout(
    participant_id: str,
    payer_id: str,
    checkout_data: CrewCheckoutRequest,
    db: AsyncSession = Depends(get_db)\
):
    """
    Create a Stripe Checkout session for a crew member to pay their share by card.
    On payment success, the Stripe webhook marks the participant as paid.
    """
    import stripe as _stripe
    import os

    # Resolve participant
    result = await db.execute(
        select(DispatchRequestParticipant)
        .where(DispatchRequestParticipant.id == participant_id)
        .options(selectinload(DispatchRequestParticipant.dispatch_request))
    )
    participant = result.scalar_one_or_none()

    if not participant:
        raise HTTPException(status_code=404, detail="Invite not found")
    if participant.participant_id != payer_id:
        raise HTTPException(status_code=403, detail="You can only pay for your own share")
    if participant.status == 'paid':
        raise HTTPException(status_code=400, detail="Already paid")

    dispatch = participant.dispatch_request
    if dispatch.status in [DispatchRequestStatusEnum.COMPLETED, DispatchRequestStatusEnum.CANCELLED]:
        raise HTTPException(status_code=400, detail="Session is no longer active")

    # Get payer profile for metadata
    payer_result = await db.execute(select(Profile).where(Profile.id == payer_id))
    payer = payer_result.scalar_one_or_none()
    if not payer:
        raise HTTPException(status_code=404, detail="User not found")

    # Store selfie if supplied before redirect
    if checkout_data.selfie_url and not participant.selfie_url:
        participant.selfie_url = checkout_data.selfie_url
        await db.commit()

    # Create Stripe Checkout session
    stripe_key = (
        os.environ.get("STRIPE_API_KEY") or
        os.environ.get("STRIPE_SECRET_KEY") or
        ""
    )
    # Guard: never use live key
    if stripe_key.startswith("sk_live_"):
        raise HTTPException(status_code=500, detail="Stripe live key detected — refusing to process. Set a test key in STRIPE_API_KEY.")
    if not stripe_key:
        raise HTTPException(status_code=500, detail="Stripe API key not configured. Set STRIPE_API_KEY in environment.")

    _stripe.api_key = stripe_key

    amount_cents = int(participant.share_amount * 100)
    origin = checkout_data.origin_url.rstrip("/")

    try:
        session = _stripe.checkout.Session.create(
            payment_method_types=["card"],
            line_items=[{
                "price_data": {
                    "currency": "usd",
                    "product_data": {
                        "name": f"Crew Session Share — {dispatch.location_name or 'On-Demand'}",
                        "description": (
                            f"Your share of a {dispatch.estimated_duration_hours}h surf session "
                            f"with captain {payer.full_name or 'Unknown'}"
                        ),
                    },
                    "unit_amount": amount_cents,
                },
                "quantity": 1,
            }],
            mode="payment",
            success_url=f"{origin}/bookings?tab=scheduled&crew_paid=1&participant={participant_id}",
            cancel_url=f"{origin}/bookings?tab=scheduled&crew_cancelled=1",
            metadata={
                "type": "crew_share",
                "participant_id": participant_id,
                "dispatch_id": dispatch.id,
                "payer_id": payer_id,
                "payer_name": payer.full_name or "",
                "payer_username": payer.username or "",
                "payer_avatar_url": payer.avatar_url or "",
                "share_amount": str(participant.share_amount),
            },
            customer_email=payer.email if hasattr(payer, "email") else None,
        )
    except Exception as e:
        logger.error(f"[CrewCheckout] Stripe error: {e}")
        raise HTTPException(status_code=500, detail=f"Payment session failed: {str(e)}")

    return {"checkout_url": session.url, "session_id": session.id}

