"""
bookings/stripe_checkout.py — Stripe checkout session creation, payment success,
                               and crew payment management endpoints.

Extracted from payments.py (v90) to comply with <800 LOC governance.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import List
from datetime import datetime, timezone, timedelta
import json
import logging
import os
import stripe
from starlette.concurrency import run_in_threadpool

from database import get_db
from models import (
    Profile, Booking, BookingParticipant,
    Notification, PaymentTransaction
)
from utils.credits import deduct_credits
from utils.scheduled_booking_payment import cents, fulfill_scheduled_booking
from utils.checkout_persistence import commit_checkout
from utils.payment_reconciliation import PaymentNeedsReconciliation, record_case
from core.security import get_current_user_id

from .crud import (
    CreateBookingWithStripeRequest,
    check_time_slot_conflict,
)

router = APIRouter()
logger = logging.getLogger(__name__)

STRIPE_API_KEY = os.environ.get('STRIPE_SECRET_KEY') or os.environ.get('STRIPE_API_KEY')
if STRIPE_API_KEY:
    stripe.api_key = STRIPE_API_KEY


# ═══ PYDANTIC MODELS ═══════════════════════════════════════════════════════

class UpdateSplitRequest(BaseModel):
    participant_id: str
    share_amount: float

class UpdateSplitsRequest(BaseModel):
    splits: List[UpdateSplitRequest]


# ═══ STRIPE CHECKOUT ROUTES ════════════════════════════════════════════════

@router.post("/bookings/create-with-stripe")
async def create_booking_with_stripe(
    data: CreateBookingWithStripeRequest,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Create a booking with Stripe payment for remaining balance after credits"""
    if not STRIPE_API_KEY:
        raise HTTPException(status_code=503, detail='Payment processing not configured')
    if data.duration <= 0:
        raise HTTPException(status_code=400, detail='Invalid duration')
    cents(data.apply_credits or 0)

    user_result = await db.execute(select(Profile).where(Profile.id == user_id).with_for_update())
    user = user_result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    photographer_result = await db.execute(
        select(Profile).where(Profile.id == data.photographer_id)
    )
    photographer = photographer_result.scalar_one_or_none()
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    try:
        session_date = datetime.fromisoformat(data.session_date.replace('Z', '+00:00'))
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format")
    
    conflict = await check_time_slot_conflict(
        db=db, photographer_id=data.photographer_id,
        session_date=session_date, duration=data.duration
    )
    if conflict:
        raise HTTPException(status_code=409, detail=conflict["message"])
    
    hourly_rate = photographer.booking_hourly_rate or photographer.hourly_rate or photographer.session_price or 75.0
    duration_multipliers = {60: 1, 120: 1.8, 180: 2.5, 240: 3, 480: 5}
    multiplier = duration_multipliers.get(data.duration, data.duration / 60)
    total_price = cents(hourly_rate * multiplier) / 100
    
    credits_applied = 0
    remaining_credits = user.credit_balance or 0
    
    if data.apply_credits and data.apply_credits > 0:
        apply_credits_rounded = round(data.apply_credits, 2)
        total_price_rounded = round(total_price, 2)
        user_balance_rounded = round(user.credit_balance or 0, 2)
        
        if apply_credits_rounded > user_balance_rounded:
            raise HTTPException(status_code=400, detail="Insufficient credit balance")
        credits_applied = min(apply_credits_rounded, total_price_rounded)
    
    amount_to_charge = round(total_price - credits_applied, 2)
    if amount_to_charge < 0:
        amount_to_charge = 0
    if amount_to_charge <= 0:
        raise HTTPException(status_code=400, detail="No amount to charge. Use regular booking endpoint.")
    
    booking = Booking(
        photographer_id=data.photographer_id, creator_id=user_id,
        location=data.location, latitude=data.latitude, longitude=data.longitude,
        session_date=session_date, duration=data.duration,
        max_participants=data.max_participants, total_price=total_price,
        price_per_person=total_price, allow_splitting=data.allow_splitting,
        description=data.description, status='Pending Payment',
        pending_payment_expires_at=datetime.now(timezone.utc) + timedelta(minutes=30)
    )
    db.add(booking)
    await db.flush()
    
    success_url = f"{data.origin_url}/bookings/success?session_id={{CHECKOUT_SESSION_ID}}&booking_id={booking.id}"
    cancel_url = f"{data.origin_url}/bookings/cancel?booking_id={booking.id}"

    if credits_applied > 0:
        success, remaining_credits, error = await deduct_credits(
            user_id=user_id, amount=credits_applied,
            transaction_type='booking_payment', db=db,
            description=f"Scheduled session with {photographer.full_name} (partial)",
            reference_type='booking', reference_id=booking.id,
            counterparty_id=data.photographer_id
        )
        if not success:
            raise HTTPException(status_code=400, detail=error or "Failed to apply credits")
    
    metadata = {
        'type': 'scheduled_booking', 'user_id': user_id, 'booking_id': str(booking.id),
        'photographer_id': data.photographer_id, 'credits_applied': str(credits_applied),
    }
    try:
        checkout_session = await run_in_threadpool(
            stripe.checkout.Session.create,
            api_key=STRIPE_API_KEY, payment_method_types=['card'], mode='payment',
            customer_email=user.email, client_reference_id=str(booking.id),
            line_items=[{'price_data': {'currency': 'usd', 'unit_amount': cents(amount_to_charge),
                                      'product_data': {'name': 'Scheduled surf session'}}, 'quantity': 1}],
            success_url=success_url, cancel_url=cancel_url, metadata=metadata,
            idempotency_key=f'scheduled-booking:{booking.id}',
            expires_at=int((datetime.now(timezone.utc) + timedelta(minutes=31)).timestamp()),
        )
        # Match the provider deadline (31 minutes gives its 30-minute minimum a
        # transport margin) rather than cancelling a still-open checkout at 30m.
        expiry = getattr(checkout_session, 'expires_at', None)
        if expiry:
            booking.pending_payment_expires_at = datetime.fromtimestamp(expiry, timezone.utc)
    except stripe.error.StripeError as exc:
        await db.rollback()
        logger.warning('Scheduled checkout provider creation failed: %s', type(exc).__name__)
        raise HTTPException(status_code=502, detail='Payment provider unavailable') from exc

    transaction = PaymentTransaction(
        user_id=user_id, session_id=checkout_session.id,
        amount=amount_to_charge, currency="usd",
        payment_status="Pending", status="Pending",
        transaction_metadata=json.dumps(metadata)
    )
    db.add(transaction)
    
    participant = BookingParticipant(
        booking_id=booking.id, participant_id=user_id,
        invite_type='direct', paid_amount=credits_applied,
        payment_status='Pending', payment_method='stripe', status='pending'
    )
    db.add(participant)
    
    await commit_checkout(db, checkout_session, STRIPE_API_KEY)
    
    return {
        "checkout_url": checkout_session.url, "session_id": checkout_session.id,
        "booking_id": booking.id, "amount_to_charge": amount_to_charge,
        "credits_applied": credits_applied, "remaining_credits": remaining_credits
    }


@router.get("/bookings/payment-success")
async def booking_payment_success(
    session_id: str, booking_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Verify an owner's provider session, then apply the shared atomic fulfillment."""
    if not STRIPE_API_KEY:
        raise HTTPException(status_code=503, detail='Payment processing not configured')
    transaction = (await db.scalars(select(PaymentTransaction).where(
        PaymentTransaction.session_id == session_id))).one_or_none()
    if transaction is None:
        raise HTTPException(status_code=404, detail='Transaction not found')
    if transaction.user_id != user_id:
        raise HTTPException(status_code=403, detail="Cannot confirm another user's payment")
    try:
        session = await run_in_threadpool(stripe.checkout.Session.retrieve, session_id, api_key=STRIPE_API_KEY)
        booking, _ = await fulfill_scheduled_booking(db, transaction, session, booking_id)
        await db.commit()
        return {'success': True, 'message': 'Booking confirmed!', 'booking_id': booking.id, 'status': booking.status}
    except PaymentNeedsReconciliation as problem:
        raise HTTPException(status_code=409, detail=await record_case(db, problem)) from problem
    except stripe.error.StripeError as exc:
        await db.rollback()
        logger.warning('Scheduled checkout verification failed: %s', type(exc).__name__)
        raise HTTPException(status_code=502, detail='Payment verification unavailable') from exc
    except HTTPException:
        await db.rollback()
        raise
    except Exception as exc:
        await db.rollback()
        logger.exception('Scheduled booking fulfillment failed')
        raise HTTPException(status_code=500, detail='Payment processing failed') from exc


# ═══ CREW PAYMENT MANAGEMENT ═══════════════════════════════════════════════

@router.get("/bookings/{booking_id}/crew-status")
async def get_crew_status(booking_id: str, db: AsyncSession = Depends(get_db)):
    """Get real-time crew payment status for Host Surfer dashboard"""
    result = await db.execute(
        select(Booking).where(Booking.id == booking_id)
        .options(selectinload(Booking.participants))
    )
    booking = result.scalar_one_or_none()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    
    crew = []
    for p in booking.participants or []:
        profile_result = await db.execute(select(Profile).where(Profile.id == p.participant_id))
        profile = profile_result.scalar_one_or_none()
        crew.append({
            "participant_id": str(p.participant_id),
            "name": profile.full_name if profile else "Unknown",
            "email": profile.email if profile else None,
            "avatar_url": profile.avatar_url if profile else None,
            "payment_status": p.payment_status or "Pending",
            "amount_paid": p.amount_paid or 0,
            "share_amount": p.share_amount or (booking.total_price / max(booking.max_participants, 1)),
            "joined_at": p.joined_at.isoformat() if p.joined_at else None
        })
    
    return {
        "booking_id": booking_id, "total_price": booking.total_price,
        "status": booking.status, "crew_payment_required": booking.crew_payment_required or False,
        "crew_paid_count": len([c for c in crew if c["payment_status"] == "Paid"]),
        "total_crew": len(crew), "crew": crew
    }


@router.post("/bookings/{booking_id}/nudge")
async def nudge_crew_member(booking_id: str, participant_id: str, db: AsyncSession = Depends(get_db)):
    """Send payment reminder to a specific crew member"""
    result = await db.execute(select(Booking).where(Booking.id == booking_id))
    booking = result.scalar_one_or_none()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    
    profile_result = await db.execute(select(Profile).where(Profile.id == participant_id))
    profile = profile_result.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="Crew member not found")
    
    notification = Notification(
        user_id=participant_id, type="payment_reminder", title="Payment Reminder",
        message=f"Your crew payment for the session at {booking.location} is pending. Please complete payment to confirm your spot!",
        data={"booking_id": booking_id, "amount_due": booking.total_price / max(booking.max_participants, 1)}
    )
    db.add(notification)
    await db.commit()
    return {"success": True, "message": "Reminder sent"}


@router.post("/bookings/{booking_id}/nudge-all")
async def nudge_all_pending(booking_id: str, db: AsyncSession = Depends(get_db)):
    """Send payment reminders to all pending crew members"""
    result = await db.execute(
        select(Booking).where(Booking.id == booking_id)
        .options(selectinload(Booking.participants))
    )
    booking = result.scalar_one_or_none()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    
    pending_count = 0
    for p in booking.participants or []:
        if p.payment_status != "Paid":
            notification = Notification(
                user_id=str(p.participant_id), type="payment_reminder", title="Payment Reminder",
                message=f"Your crew payment for the session at {booking.location} is pending. Please complete payment to confirm your spot!",
                data={"booking_id": booking_id, "amount_due": p.share_amount or (booking.total_price / max(booking.max_participants, 1))}
            )
            db.add(notification)
            pending_count += 1
    
    await db.commit()
    return {"success": True, "reminders_sent": pending_count}


@router.post("/bookings/{booking_id}/update-splits")
async def update_payment_splits(booking_id: str, data: UpdateSplitsRequest, db: AsyncSession = Depends(get_db)):
    """Update custom payment split amounts for crew members"""
    result = await db.execute(
        select(Booking).where(Booking.id == booking_id)
        .options(selectinload(Booking.participants))
    )
    booking = result.scalar_one_or_none()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    
    total_splits = sum(s.share_amount for s in data.splits)
    if abs(total_splits - booking.total_price) > 0.01:
        raise HTTPException(
            status_code=400,
            detail=f"Split total (${total_splits:.2f}) must equal booking price (${booking.total_price:.2f})"
        )
    
    for split in data.splits:
        for p in booking.participants or []:
            if str(p.participant_id) == split.participant_id:
                p.share_amount = split.share_amount
                break
    
    await db.commit()
    return {"success": True, "message": "Payment splits updated"}
