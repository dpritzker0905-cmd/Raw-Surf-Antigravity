"""
bookings/crew_payments.py — Crew Payment Page deep-link endpoints + crew member payment flow.
Extracted from crew_hub.py (v92 audit) for LOC compliance.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import Optional
import json
import logging

from database import get_db
from core.security import get_user_id_from_jwt_or_query
from models import (
    Profile, Booking, BookingParticipant, Notification
)
from utils.credits import deduct_credits, add_credits
from websocket_manager import broadcast_earnings_update

router = APIRouter()
logger = logging.getLogger(__name__)


# ============================================================
# CREW PAYMENT PAGE - DEEP LINK ENDPOINTS
# ============================================================


@router.get("/bookings/{booking_id}/crew-payment-details")
async def get_crew_payment_details(
    booking_id: str,
    user_id: str = Depends(get_user_id_from_jwt_or_query),
    db: AsyncSession = Depends(get_db)
):
    """
    Get booking details for the crew payment page (deep link destination)
    Returns booking info, captain info, and user's share
    """
    # Get booking with all participants
    result = await db.execute(
        select(Booking).where(Booking.id == booking_id)
        .options(
            selectinload(Booking.participants).selectinload(BookingParticipant.participant),
            selectinload(Booking.photographer),
            selectinload(Booking.creator)
        )
    )
    booking = result.scalar_one_or_none()
    
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    
    # Find user's participation record
    my_share = None
    for p in booking.participants or []:
        if p.participant_id == user_id:
            equal_share = booking.total_price / max(len(booking.participants), 1)
            my_share = {
                "participant_id": p.participant_id,
                "share_amount": p.share_amount if p.share_amount > 0 else equal_share,
                "share_percentage": p.share_percentage if p.share_percentage > 0 else (100 / len(booking.participants)),
                "payment_status": p.payment_status,
                "paid_amount": p.paid_amount,
                "covered_by_captain": p.covered_by_captain,
                "is_captain": p.is_captain
            }
            break
    
    if not my_share:
        raise HTTPException(status_code=403, detail="You are not a participant in this booking")
    
    # Calculate payment progress
    paid_count = sum(1 for p in booking.participants if p.payment_status == 'Paid' or p.covered_by_captain)
    total_count = len(booking.participants) if booking.participants else 1
    payment_progress = (paid_count / total_count) * 100
    
    # Get captain info
    captain_data = None
    if booking.creator:
        captain_data = {
            "id": booking.creator.id,
            "full_name": booking.creator.full_name,
            "avatar_url": booking.creator.avatar_url
        }
    
    return {
        "booking": {
            "id": booking.id,
            "location": booking.location,
            "session_date": booking.session_date.isoformat() if booking.session_date else None,
            "duration": booking.duration,
            "total_price": booking.total_price,
            "status": booking.status,
            "booking_type": booking.booking_type or "scheduled",
            "payment_window_expires_at": booking.payment_window_expires_at.isoformat() if booking.payment_window_expires_at else None,
            "payment_window_expired": booking.payment_window_expired,
            "participant_count": total_count,
            "paid_count": paid_count,
            "payment_progress": payment_progress,
            "photographer_name": booking.photographer.full_name if booking.photographer else None
        },
        "my_share": my_share,
        "captain": captain_data
    }


class CrewPayRequest(BaseModel):
    participant_id: str
    amount: float
    payment_method: str = "credits"  # 'credits' or 'stripe'




@router.post("/bookings/{booking_id}/crew-pay")
async def crew_member_pay(
    booking_id: str,
    data: CrewPayRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Crew member pays their share of the booking
    Deducts from credits and updates payment status
    """
    from routes.notifications.push import notify_crew_payment_received
    
    # Get booking with participants
    result = await db.execute(
        select(Booking).where(Booking.id == booking_id)
        .options(
            selectinload(Booking.participants).selectinload(BookingParticipant.participant),
            selectinload(Booking.creator),
            selectinload(Booking.photographer)
        )
    )
    booking = result.scalar_one_or_none()
    
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    
    if booking.payment_window_expired:
        raise HTTPException(status_code=400, detail="Payment window has expired")
    
    # Find participant record
    participant = None
    for p in booking.participants or []:
        if p.participant_id == data.participant_id:
            participant = p
            break
    
    if not participant:
        raise HTTPException(status_code=403, detail="You are not a participant in this booking")
    
    if participant.payment_status == 'Paid':
        raise HTTPException(status_code=400, detail="Already paid")
    
    # Get payer profile
    payer_result = await db.execute(select(Profile).where(Profile.id == data.participant_id))
    payer = payer_result.scalar_one_or_none()
    
    if not payer:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Deduct credits
    success, new_balance, error = await deduct_credits(
        user_id=data.participant_id,
        amount=data.amount,
        transaction_type='booking_crew_payment',
        db=db,
        description=f"Crew payment for session at {booking.location}",
        reference_type='booking',
        reference_id=booking_id,
        counterparty_id=booking.photographer_id
    )
    
    if not success:
        raise HTTPException(status_code=400, detail=error)
    
    # Update participant record
    participant.paid_amount = data.amount
    participant.payment_status = "Paid"
    participant.payment_method = "credits"
    
    # Calculate remaining balance
    total_paid = sum(p.paid_amount for p in booking.participants or [])
    remaining = booking.total_price - total_paid
    
    # Check if all paid
    all_paid = all(
        p.payment_status == 'Paid' or p.covered_by_captain 
        for p in booking.participants or []
    )
    
    if all_paid:
        # Session fully paid - confirm booking
        booking.status = "Confirmed"
        booking.crew_payment_required = False
        
        # Credit photographer (80% after platform fee)
        await add_credits(
            user_id=booking.photographer_id,
            amount=booking.total_price * 0.80,
            transaction_type='booking_earning',
            db=db,
            description=f"Booking payment for session at {booking.location}",
            reference_type='booking',
            reference_id=booking_id,
            counterparty_id=booking.creator_id
        )
        
        # Notify photographer
        notification = Notification(
            user_id=booking.photographer_id,
            type='booking_confirmed',
            title='Booking Confirmed!',
            body=f'Session at {booking.location} is fully paid and confirmed!',
            data=json.dumps({"booking_id": booking_id})
        )
        db.add(notification)
    
    # Notify captain of payment
    try:
        await notify_crew_payment_received(
            captain_id=booking.creator_id,
            crew_member_name=payer.full_name,
            amount=data.amount,
            booking_id=booking_id,
            remaining_balance=max(0, remaining),
            db=db
        )
    except Exception as e:
        logger.warning(f"Failed to send captain notification: {e}")
    
    await db.commit()
    
    return {
        "success": True,
        "paid_amount": data.amount,
        "new_balance": new_balance,
        "booking_status": booking.status,
        "all_crew_paid": all_paid,
        "message": "Payment successful!" if all_paid else f"Payment received! Remaining: ${remaining:.2f}"
    }




class UpdateParticipantSelfieRequest(BaseModel):
    participant_id: str
    selfie_url: str



@router.patch("/bookings/{booking_id}/participant-selfie")
async def update_participant_selfie(
    booking_id: str,
    data: UpdateParticipantSelfieRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Update a booking participant's selfie for photographer identification.
    This helps photographers identify surfers in their photos.
    """
    # Find participant record
    result = await db.execute(
        select(BookingParticipant)
        .where(BookingParticipant.booking_id == booking_id)
        .where(BookingParticipant.participant_id == data.participant_id)
    )
    participant = result.scalar_one_or_none()
    
    if not participant:
        raise HTTPException(status_code=404, detail="Participant not found in this booking")
    
    participant.selfie_url = data.selfie_url
    await db.commit()
    
    return {
        "success": True,
        "message": "Selfie uploaded! The photographer will use this to identify you."
    }
