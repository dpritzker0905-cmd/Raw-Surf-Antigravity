"""
bookings/crew_hub.py — Crew Hub captain command center, crew payments, selfie uploads
Extracted from payments.py (v83 audit) for maintainability.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime, timezone, timedelta
import json
import logging

from database import get_db
from models import (
    Profile, Booking, BookingParticipant,
    Notification, PaymentTransaction
)
from utils.credits import deduct_credits, add_credits, refund_credits
from websocket_manager import broadcast_earnings_update
from core.security import get_user_id_from_jwt_or_query

router = APIRouter()
logger = logging.getLogger(__name__)

# ============================================================
# CREW HUB - CAPTAIN'S COMMAND CENTER
# ============================================================

class CrewHubSplitData(BaseModel):
    participant_id: str
    share_amount: float
    share_percentage: float
    covered_by_captain: bool = False

class CrewHubUpdateSplitsRequest(BaseModel):
    captain_id: str
    splits: List[CrewHubSplitData]
    captain_share: float

class CaptainCoverRequest(BaseModel):
    captain_id: str
    cover_amount: float




@router.get("/bookings/{booking_id}/crew-hub-status")
async def get_crew_hub_status(
    booking_id: str,
    captain_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Get detailed crew status for Captain's Crew Hub dashboard
    Returns granular payment control data for each crew member
    """
    # Get booking with participants
    result = await db.execute(
        select(Booking).where(Booking.id == booking_id)
        .options(
            selectinload(Booking.participants).selectinload(BookingParticipant.participant),
            selectinload(Booking.photographer)
        )
    )
    booking = result.scalar_one_or_none()
    
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    
    # Verify captain
    if booking.creator_id != captain_id:
        raise HTTPException(status_code=403, detail="Only the session captain can access the Crew Hub")
    
    total_crew = len(booking.participants) if booking.participants else 1
    equal_share = booking.total_price / max(total_crew, 1)
    
    crew = []
    for p in booking.participants or []:
        profile = p.participant
        is_captain = p.participant_id == captain_id
        
        crew.append({
            "participant_id": p.participant_id,
            "name": profile.full_name if profile else "Unknown",
            "email": profile.email if profile else None,
            "avatar_url": profile.avatar_url if profile else None,
            "payment_status": p.payment_status,
            "paid_amount": p.paid_amount,
            "share_amount": p.share_amount if p.share_amount > 0 else equal_share,
            "share_percentage": p.share_percentage if p.share_percentage > 0 else (100 / total_crew),
            "covered_by_captain": p.covered_by_captain,
            "covered_amount": p.covered_amount,
            "is_captain": is_captain or p.is_captain,
            "status": p.status
        })
    
    # Calculate totals
    total_paid = sum(p["paid_amount"] for p in crew)
    total_covered = sum(p["covered_amount"] for p in crew if p["covered_by_captain"])
    remaining = booking.total_price - total_paid - total_covered
    
    return {
        "booking_id": booking_id,
        "booking_type": booking.booking_type or "scheduled",
        "total_price": booking.total_price,
        "captain_hold_paid": booking.captain_hold_paid,
        "captain_hold_amount": booking.captain_hold_amount,
        "payment_window_expires_at": booking.payment_window_expires_at.isoformat() if booking.payment_window_expires_at else None,
        "payment_window_expired": booking.payment_window_expired,
        "crew": crew,
        "summary": {
            "total_crew": total_crew,
            "paid_count": len([p for p in crew if p["payment_status"] == "Paid" or p["covered_by_captain"]]),
            "pending_count": len([p for p in crew if p["payment_status"] == "Pending" and not p["covered_by_captain"]]),
            "total_paid": total_paid,
            "total_covered": total_covered,
            "remaining_balance": max(0, remaining)
        }
    }




@router.post("/bookings/{booking_id}/crew-hub/update-splits")
async def update_crew_hub_splits(
    booking_id: str,
    data: CrewHubUpdateSplitsRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Captain updates custom payment splits with granular control
    Supports: custom percentages, "Paid by Me" toggles
    """
    # Get booking
    result = await db.execute(
        select(Booking).where(Booking.id == booking_id)
        .options(selectinload(Booking.participants))
    )
    booking = result.scalar_one_or_none()
    
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    
    # Verify captain
    if booking.creator_id != data.captain_id:
        raise HTTPException(status_code=403, detail="Only the session captain can update splits")
    
    # Validate total equals booking price
    total_splits = sum(s.share_amount for s in data.splits) + data.captain_share
    if abs(total_splits - booking.total_price) > 0.01:
        raise HTTPException(
            status_code=400, 
            detail=f"Split total (${total_splits:.2f}) must equal booking price (${booking.total_price:.2f})"
        )
    
    # Update each participant's share
    for split in data.splits:
        for p in booking.participants or []:
            if str(p.participant_id) == split.participant_id:
                p.share_amount = split.share_amount
                p.share_percentage = split.share_percentage
                p.covered_by_captain = split.covered_by_captain
                
                # If captain is covering, mark as paid
                if split.covered_by_captain:
                    p.covered_amount = split.share_amount
                    p.payment_status = "Paid"
                    p.payment_method = "captain_covered"
                break
    
    # Update captain's hold amount
    booking.captain_hold_amount = data.captain_share
    
    await db.commit()
    
    return {"success": True, "message": "Crew Hub splits updated"}




@router.post("/bookings/{booking_id}/crew-hub/captain-hold")
async def captain_pay_hold(
    booking_id: str,
    captain_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Captain pays their share to "Hold" the time slot
    Sets payment window expiry based on booking type:
    - On-Demand: 60 minutes
    - Scheduled: 24 hours
    """
    from datetime import timedelta
    
    # Get booking with captain's profile
    result = await db.execute(
        select(Booking).where(Booking.id == booking_id)
        .options(
            selectinload(Booking.participants).selectinload(BookingParticipant.participant)
        )
    )
    booking = result.scalar_one_or_none()
    
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    
    if booking.creator_id != captain_id:
        raise HTTPException(status_code=403, detail="Only the session captain can pay the hold")
    
    if booking.captain_hold_paid:
        raise HTTPException(status_code=400, detail="Hold already paid")
    
    # Get captain's profile
    captain_result = await db.execute(select(Profile).where(Profile.id == captain_id))
    captain = captain_result.scalar_one_or_none()
    
    if not captain:
        raise HTTPException(status_code=404, detail="Captain not found")
    
    # Calculate captain's share (if not already set, use equal split)
    total_crew = len(booking.participants) if booking.participants else 1
    captain_share = booking.captain_hold_amount if booking.captain_hold_amount > 0 else (booking.total_price / total_crew)
    
    # Deduct credits from captain
    success, new_balance, error = await deduct_credits(
        user_id=captain_id,
        amount=captain_share,
        transaction_type='booking_hold',
        db=db,
        description=f"Captain hold for session at {booking.location}",
        reference_type='booking',
        reference_id=booking_id,
        counterparty_id=booking.photographer_id
    )
    
    if not success:
        raise HTTPException(status_code=400, detail=error)
    
    # Update booking
    now = datetime.now(timezone.utc)
    booking.captain_hold_paid = True
    booking.captain_hold_at = now
    booking.captain_hold_amount = captain_share
    booking.status = "PendingPayment"  # Waiting for crew
    
    # Set payment window expiry
    if booking.booking_type == 'on_demand':
        booking.payment_window_expires_at = now + timedelta(minutes=60)
    else:
        booking.payment_window_expires_at = now + timedelta(hours=24)
    
    # Mark captain's participant record
    for p in booking.participants or []:
        if p.participant_id == captain_id:
            p.is_captain = True
            p.paid_amount = captain_share
            p.payment_status = "Paid"
            p.share_amount = captain_share
            break
    
    # Notify crew members via OneSignal push + in-app notification
    from routes.notifications.push import notify_crew_payment_request
    
    for p in booking.participants or []:
        if p.participant_id != captain_id:
            share = p.share_amount if p.share_amount > 0 else (booking.total_price / total_crew)
            
            # In-app notification
            notification = Notification(
                user_id=p.participant_id,
                type='crew_payment_request',
                title="You've Been Added to a Crew!",
                body=f"You've been added to {captain.full_name}'s session at {booking.location}. Your share: ${share:.2f}. Tap to pay.",
                data=json.dumps({
                    "booking_id": booking_id,
                    "captain_name": captain.full_name,
                    "location": booking.location,
                    "share_amount": share,
                    "expires_at": booking.payment_window_expires_at.isoformat(),
                    "deep_link": f"/bookings/pay/{booking_id}"
                })
            )
            db.add(notification)
            
            # OneSignal push notification with deep link
            try:
                await notify_crew_payment_request(
                    crew_member_id=p.participant_id,
                    captain_name=captain.full_name,
                    captain_avatar=captain.avatar_url or "",
                    booking_id=booking_id,
                    location=booking.location,
                    share_amount=share,
                    expires_at=booking.payment_window_expires_at.isoformat(),
                    booking_type=booking.booking_type or "scheduled",
                    db=db
                )
            except Exception as e:
                logger.warning(f"Failed to send push to {p.participant_id}: {e}")
    
    await db.commit()
    
    return {
        "success": True,
        "captain_share_paid": captain_share,
        "new_balance": new_balance,
        "payment_window_expires_at": booking.payment_window_expires_at.isoformat(),
        "message": f"Hold paid! Crew has {60 if booking.booking_type == 'on_demand' else 24 * 60} minutes to pay."
    }




@router.post("/bookings/{booking_id}/crew-hub/captain-cover-remaining")
async def captain_cover_remaining(
    booking_id: str,
    data: CaptainCoverRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Captain covers the remaining unpaid balance for crew members
    Used when payment window is about to expire or captain wants to proceed
    """
    # Get booking
    result = await db.execute(
        select(Booking).where(Booking.id == booking_id)
        .options(selectinload(Booking.participants))
    )
    booking = result.scalar_one_or_none()
    
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    
    if booking.creator_id != data.captain_id:
        raise HTTPException(status_code=403, detail="Only the session captain can cover remaining balance")
    
    # Calculate remaining
    total_paid = sum(p.paid_amount for p in booking.participants or [])
    remaining = booking.total_price - total_paid
    
    if remaining <= 0:
        raise HTTPException(status_code=400, detail="No remaining balance to cover")
    
    if abs(data.cover_amount - remaining) > 0.01:
        raise HTTPException(status_code=400, detail=f"Cover amount must equal remaining balance: ${remaining:.2f}")
    
    # Get captain
    captain_result = await db.execute(select(Profile).where(Profile.id == data.captain_id))
    captain = captain_result.scalar_one_or_none()
    
    if not captain:
        raise HTTPException(status_code=404, detail="Captain not found")
    
    # Deduct credits from captain
    success, new_balance, error = await deduct_credits(
        user_id=data.captain_id,
        amount=remaining,
        transaction_type='booking_cover',
        db=db,
        description=f"Captain covered remaining balance for session at {booking.location}",
        reference_type='booking',
        reference_id=booking_id,
        counterparty_id=booking.photographer_id
    )
    
    if not success:
        raise HTTPException(status_code=400, detail=error)
    
    # Credit photographer (80% after platform fee)
    await add_credits(
        user_id=booking.photographer_id,
        amount=remaining * 0.80,
        transaction_type='booking_earning',
        db=db,
        description=f"Booking payment from {captain.full_name} (crew coverage)",
        reference_type='booking',
        reference_id=booking_id,
        counterparty_id=data.captain_id
    )
    
    # Mark all unpaid participants as covered
    for p in booking.participants or []:
        if p.payment_status != "Paid":
            p.covered_by_captain = True
            p.covered_amount = p.share_amount if p.share_amount > 0 else 0
            p.payment_status = "Paid"
            p.payment_method = "captain_covered"
    
    # Confirm booking
    booking.status = "Confirmed"
    booking.crew_payment_required = False
    booking.expiry_action = "captain_covered"
    
    # Notify photographer
    notification = Notification(
        user_id=booking.photographer_id,
        type='booking_confirmed',
        title='Booking Confirmed!',
        body=f'{captain.full_name}\'s session at {booking.location} is fully paid and confirmed!',
        data=json.dumps({"booking_id": booking_id})
    )
    db.add(notification)
    
    await db.commit()
    
    return {
        "success": True,
        "covered_amount": remaining,
        "new_balance": new_balance,
        "booking_status": "Confirmed",
        "message": "You covered the remaining balance! Session is now confirmed."
    }




@router.post("/bookings/{booking_id}/crew-hub/handle-expiry")
async def handle_payment_window_expiry(
    booking_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Handle payment window expiry
    Called by scheduler when payment window expires
    Options: Cancel with refund OR notify captain to cover
    """
    # Get booking
    result = await db.execute(
        select(Booking).where(Booking.id == booking_id)
        .options(selectinload(Booking.participants))
    )
    booking = result.scalar_one_or_none()
    
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    
    if booking.payment_window_expired:
        return {"message": "Expiry already handled"}
    
    now = datetime.now(timezone.utc)
    if booking.payment_window_expires_at and now < booking.payment_window_expires_at:
        return {"message": "Payment window not yet expired"}
    
    # Mark as expired
    booking.payment_window_expired = True
    
    # Calculate unpaid amount
    total_paid = sum(p.paid_amount for p in booking.participants or [])
    remaining = booking.total_price - total_paid
    
    if remaining <= 0:
        # All paid - confirm booking
        booking.status = "Confirmed"
        await db.commit()
        return {"message": "All payments received, booking confirmed"}
    
    # Notify captain about expiry
    captain_id = booking.creator_id
    notification = Notification(
        user_id=captain_id,
        type='payment_window_expired',
        title='Payment Window Expired',
        body=f'The payment window for your session at {booking.location} has expired. Remaining: ${remaining:.2f}. Cover the balance or cancel for a refund.',
        data=json.dumps({
            "booking_id": booking_id,
            "remaining_amount": remaining,
            "options": ["cover_remaining", "cancel_refund"]
        })
    )
    db.add(notification)
    
    await db.commit()
    
    return {
        "expired": True,
        "remaining_amount": remaining,
        "message": "Payment window expired. Captain notified."
    }




@router.post("/bookings/{booking_id}/crew-hub/cancel-refund")
async def cancel_and_refund(
    booking_id: str,
    captain_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Cancel booking and refund all payments to credit balances
    Used when crew fails to pay within window
    """
    # Get booking
    result = await db.execute(
        select(Booking).where(Booking.id == booking_id)
        .options(selectinload(Booking.participants))
    )
    booking = result.scalar_one_or_none()
    
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    
    if booking.creator_id != captain_id:
        raise HTTPException(status_code=403, detail="Only the session captain can cancel")
    
    if booking.status == "Confirmed":
        raise HTTPException(status_code=400, detail="Cannot cancel a confirmed booking")
    
    # Refund all participants
    refunds = []
    for p in booking.participants or []:
        if p.paid_amount > 0:
            # Refund to credit balance (refund_credits uses 'refund' as transaction_type internally)
            success, new_balance, _ = await refund_credits(
                user_id=p.participant_id,
                amount=p.paid_amount,
                db=db,
                description=f"Refund for cancelled session at {booking.location}",
                reference_type='booking',
                reference_id=booking_id
            )
            
            if success:
                refunds.append({
                    "participant_id": p.participant_id,
                    "refunded_amount": p.paid_amount,
                    "new_balance": new_balance
                })
                
                # Notify participant
                notification = Notification(
                    user_id=p.participant_id,
                    type='booking_refund',
                    title='Booking Cancelled - Refund Issued',
                    body=f'The session at {booking.location} was cancelled. ${p.paid_amount:.2f} has been refunded to your credit balance.',
                    data=json.dumps({
                        "booking_id": booking_id,
                        "refund_amount": p.paid_amount
                    })
                )
                db.add(notification)
            
            # Reset payment
            p.paid_amount = 0
            p.payment_status = "Refunded"
    
    # Update booking status
    booking.status = "Cancelled"
    booking.expiry_action = "cancelled_refunded"
    
    await db.commit()
    
    return {
        "success": True,
        "booking_status": "Cancelled",
        "refunds": refunds,
        "message": "Booking cancelled. All payments refunded to credit balances."
    }




# ============================================================
# RE-EXPORTS - Extracted to crew_payments.py (v92 audit)
# These re-exports ensure backward compatibility for any imports.
# ============================================================
from .crew_payments import (
    get_crew_payment_details,
    crew_member_pay,
    update_participant_selfie,
    CrewPayRequest,
    UpdateParticipantSelfieRequest,
)
