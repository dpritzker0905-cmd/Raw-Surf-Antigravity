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
import math
import os
import stripe
import stripe_mcp_server
import sqlite3

from database import get_db
from models import (
    Profile, Booking, BookingParticipant,
    Notification, PaymentTransaction
)
from utils.credits import deduct_credits, add_credits
from core.security import get_current_user_id

from .split_lock import enforce_paid_shares, locked_share
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


class NudgeRequest(BaseModel):
    participant_id: str


# ═══ STRIPE CHECKOUT ROUTES ════════════════════════════════════════════════

@router.post("/bookings/create-with-stripe")
async def create_booking_with_stripe(
    data: CreateBookingWithStripeRequest,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Create a booking with Stripe payment for remaining balance after credits"""
    from routes.notifications.push_payloads import notify_booking
    
    user_result = await db.execute(select(Profile).where(Profile.id == user_id))
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
    total_price = round(hourly_rate * multiplier, 2)
    if not math.isfinite(total_price) or total_price <= 0:
        raise HTTPException(status_code=400, detail="This booking has no valid price")

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
    
    import secrets
    import string
    
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
    session_time_str = session_date.strftime('%b %d at %I:%M %p')
    
    # Get or create stripe customer ID mapping in stripe-mcp cache
    customer_id = None
    try:
        conn = sqlite3.connect(stripe_mcp_server.DB_PATH, timeout=10.0)
        cursor = conn.cursor()
        cursor.execute("SELECT customer_id FROM stripe_customers WHERE supabase_user_id = ?", (user_id,))
        row = cursor.fetchone()
        if row:
            customer_id = row[0]
        else:
            import uuid
            customer_id = f"cus_test_{uuid.uuid4().hex[:12]}"
            cursor.execute(
                "INSERT INTO stripe_customers (customer_id, email, name, supabase_user_id, subscription_status, created_at) VALUES (?, ?, ?, ?, 'inactive', datetime('now'))",
                (customer_id, user.email, user.full_name, user_id)
            )
            conn.commit()
        conn.close()
    except Exception as e:
        logger.error(f"Failed to lookup/create stripe customer mapping: {e}")
        customer_id = f"cus_test_fallback_{user_id[:8]}"

    try:
        # Route checkout session creation through stripe-mcp server tool function
        checkout_session = stripe_mcp_server.stripe_create_checkout_session(
            customer_id=customer_id,
            amount=amount_to_charge,
            currency="usd",
            success_url=success_url,
            cancel_url=cancel_url,
            metadata_dict={
                'user_id': user_id,
                'booking_id': str(booking.id),
                'photographer_id': data.photographer_id,
                'credits_applied': str(credits_applied),
                'type': 'scheduled_booking'
            }
        )
    except Exception as e:
        logger.error(f"Stripe MCP error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Payment error: {str(e)}")
    
    transaction = PaymentTransaction(
        user_id=user_id, session_id=checkout_session["checkout_session_id"],
        amount=amount_to_charge, currency="usd",
        payment_status="Pending", status="Pending",
        transaction_metadata=json.dumps({
            'booking_id': booking.id, 'credits_applied': credits_applied,
            'photographer_id': data.photographer_id
        })
    )
    db.add(transaction)
    
    participant = BookingParticipant(
        booking_id=booking.id, participant_id=user_id,
        invite_type='direct', paid_amount=credits_applied,
        payment_status='Pending', payment_method='stripe', status='pending'
    )
    db.add(participant)
    
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
    
    await db.commit()
    
    return {
        "checkout_url": checkout_session["url"], "session_id": checkout_session["checkout_session_id"],
        "booking_id": booking.id, "amount_to_charge": amount_to_charge,
        "credits_applied": credits_applied, "remaining_credits": remaining_credits
    }


def _booking_session_matches(checkout_session, booking_id: str, user_id: str, owed: float) -> bool:
    """A paid session confirms a booking only if it was created for THAT booking, by its creator,
    for the amount on the transaction record (Stripe totals are integer cents)."""
    metadata = getattr(checkout_session, 'metadata', None) or {}
    amount_total = getattr(checkout_session, 'amount_total', None)
    return (
        metadata.get('type') == 'scheduled_booking'
        and metadata.get('booking_id') == booking_id
        and metadata.get('user_id') == user_id
        and isinstance(amount_total, int)
        and abs(amount_total - float(owed or 0) * 100) < 1
    )


@router.get("/bookings/payment-success")
async def booking_payment_success(
    session_id: str, booking_id: str,
    current_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Confirm a scheduled booking once its checkout is paid.

    Only the booking's creator may confirm it, only with the checkout session recorded for that
    booking, and only after the payment is verified. Both are checked before any provider call or
    write. The local checkout emulator stands in for Stripe only where checkout_emulation_allowed()
    (a process that identifies itself as local or test, never with a live key).
    """
    from routes.sessions.payments import checkout_emulation_allowed

    # Row lock: two concurrent confirmations of one session must not both see it unpaid.
    tx_result = await db.execute(
        select(PaymentTransaction).where(PaymentTransaction.session_id == session_id).with_for_update()
    )
    transaction = tx_result.scalar_one_or_none()
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")
    if transaction.user_id != current_user_id:
        raise HTTPException(status_code=403, detail="Cannot confirm another user's payment")
    try:
        recorded_booking_id = json.loads(transaction.transaction_metadata or "{}").get("booking_id")
    except (TypeError, ValueError, AttributeError):
        recorded_booking_id = None
    if recorded_booking_id is None or str(recorded_booking_id) != str(booking_id):
        raise HTTPException(status_code=400, detail="Payment does not match this booking")

    booking_result = await db.execute(
        select(Booking).where(Booking.id == booking_id)
        .options(selectinload(Booking.photographer))
    )
    booking = booking_result.scalar_one_or_none()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    if booking.creator_id != current_user_id:
        raise HTTPException(status_code=403, detail="Cannot confirm another user's booking")

    # Confirmation happens once, from Pending Payment. A replayed or late call writes nothing:
    # replaying a paid session used to re-confirm a cancelled booking, re-hold its escrow and
    # re-mark its participant paid, so a second cancellation refunded twice.
    if transaction.payment_status == 'paid':
        return {"success": True, "message": "Booking already confirmed", "booking_id": booking.id,
                "status": booking.status}
    if booking.status not in ('Pending Payment', 'PendingPayment'):
        raise HTTPException(status_code=409, detail="This booking is not awaiting payment")

    if session_id.startswith("cs_test_") and checkout_emulation_allowed():
        # Emulate checkout retrieve through mock stripe-mcp server tool path
        payment_status = 'paid'
        try:
            conn = sqlite3.connect(stripe_mcp_server.DB_PATH, timeout=10.0)
            cursor = conn.cursor()
            # Transition mock payment intent status to succeeded
            cursor.execute("SELECT payment_intent_id, metadata FROM stripe_payments WHERE status = 'requires_payment_method'")
            pending_payments = cursor.fetchall()
            for pi_id, meta_str in pending_payments:
                meta = json.loads(meta_str or "{}")
                if str(meta.get("booking_id")) == str(booking_id):
                    cursor.execute("UPDATE stripe_payments SET status = 'succeeded' WHERE payment_intent_id = ?", (pi_id,))
                    conn.commit()
                    break
            conn.close()
        except Exception as e:
            logger.error(f"Failed to auto-succeed mock stripe payment in cache: {e}")
    else:
        try:
            checkout_session = stripe.checkout.Session.retrieve(session_id)
            payment_status = checkout_session.payment_status
        except stripe.error.StripeError as e:
            logger.error(f"Stripe error: {str(e)}")
            raise HTTPException(status_code=500, detail="Payment verification error")
        if payment_status == 'paid' and not _booking_session_matches(
            checkout_session, str(booking_id), current_user_id, transaction.amount
        ):
            raise HTTPException(status_code=400, detail="Payment does not match this booking")

    if payment_status != 'paid':
        raise HTTPException(status_code=400, detail="Payment not completed")

    user_result = await db.execute(select(Profile).where(Profile.id == booking.creator_id))
    user = user_result.scalar_one_or_none()

    if transaction.payment_status != 'paid':
        transaction.payment_status = 'paid'
        transaction.status = 'completed'
        
        if user:
            await add_credits(
                user_id=booking.creator_id, amount=transaction.amount,
                transaction_type='stripe_topup', db=db,
                description=f'Payment for booking with {booking.photographer.full_name}',
                reference_type='booking', reference_id=booking.id
            )
            await deduct_credits(
                user_id=booking.creator_id, amount=transaction.amount,
                transaction_type='booking_payment', db=db,
                description=f'Scheduled session with {booking.photographer.full_name}',
                reference_type='booking', reference_id=booking.id,
                counterparty_id=booking.photographer_id
            )
    
    booking.status = 'Confirmed'
    booking.escrow_amount = booking.total_price * 0.80
    booking.escrow_status = 'held'
    
    participant_result = await db.execute(
        select(BookingParticipant).where(
            and_(
                BookingParticipant.booking_id == booking_id,
                BookingParticipant.participant_id == booking.creator_id
            )
        )
    )
    participant = participant_result.scalar_one_or_none()
    if participant:
        participant.payment_status = 'Paid'
        participant.status = 'confirmed'
        participant.paid_amount = booking.total_price
    
    session_time_str = booking.session_date.strftime('%b %d at %I:%M %p')
    
    photographer_notification = Notification(
        user_id=booking.photographer_id, type='booking_confirmed',
        title='New Booking Confirmed!',
        body=f'{user.full_name if user else "A surfer"} booked a session at {booking.location} on {session_time_str}',
        data=json.dumps({"booking_id": booking.id, "session_date": booking.session_date.isoformat(), "location": booking.location})
    )
    db.add(photographer_notification)
    
    surfer_notification = Notification(
        user_id=booking.creator_id, type='booking_confirmation',
        title='Session Booked!',
        body=f'Your session with {booking.photographer.full_name} is confirmed for {session_time_str}',
        data=json.dumps({"booking_id": booking.id, "session_date": booking.session_date.isoformat()})
    )
    db.add(surfer_notification)
    
    try:
        # Imported here, inside the guard: the helper is missing from this module (LA-PAY-08), and
        # a failed push must not undo a verified payment.
        from routes.notifications.push_payloads import notify_booking
        await notify_booking(
            user_id=booking.photographer_id, title='New Booking Confirmed!',
            message=f'{user.full_name if user else "A surfer"} booked a session on {session_time_str}', db=db
        )
        await notify_booking(
            user_id=booking.creator_id, title='Session Booked!',
            message=f'Your session with {booking.photographer.full_name} is confirmed', db=db
        )
    except Exception as e:
        logger.warning(f"Failed to send push notifications: {e}")
    
    await db.commit()
    
    return {"success": True, "message": "Booking confirmed!", "booking_id": booking.id, "status": "Confirmed"}


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
            # a member who has paid shows the share they are locked at (the editor refuses to change it)
            "share_amount": (locked_share(p) if locked_share(p) is not None
                             else p.share_amount or (booking.total_price / max(booking.max_participants, 1))),
            "share_locked": locked_share(p) is not None,
            "joined_at": p.joined_at.isoformat() if p.joined_at else None
        })
    
    return {
        "booking_id": booking_id, "total_price": booking.total_price,
        "status": booking.status, "crew_payment_required": booking.crew_payment_required or False,
        "crew_paid_count": len([c for c in crew if c["payment_status"] == "Paid"]),
        "total_crew": len(crew), "crew": crew
    }


def _require_captain(booking, current_user_id: str) -> None:
    """Crew money tools belong to the session captain (the booking's creator) and nobody else."""
    if booking.creator_id != current_user_id:
        raise HTTPException(status_code=403, detail="Only the session captain can do this")


def _payment_reminder(user_id: str, booking, amount_due: float) -> Notification:
    return Notification(
        user_id=user_id, type="payment_reminder", title="Payment Reminder",
        body=f"Your crew payment for the session at {booking.location} is pending. Please complete payment to confirm your spot!",
        data=json.dumps({"booking_id": booking.id, "amount_due": amount_due})
    )


@router.post("/bookings/{booking_id}/nudge")
async def nudge_crew_member(
    booking_id: str,
    data: NudgeRequest,
    current_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Send payment reminder to a specific crew member (captain only, and only to a member of this booking)"""
    result = await db.execute(
        select(Booking).where(Booking.id == booking_id)
        .options(selectinload(Booking.participants))
    )
    booking = result.scalar_one_or_none()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    _require_captain(booking, current_user_id)

    member = next((p for p in booking.participants or [] if str(p.participant_id) == data.participant_id), None)
    if member is None:
        raise HTTPException(status_code=404, detail="Crew member not found")

    db.add(_payment_reminder(
        data.participant_id, booking,
        member.share_amount or (booking.total_price / max(booking.max_participants, 1))))
    await db.commit()
    return {"success": True, "message": "Reminder sent"}


@router.post("/bookings/{booking_id}/nudge-all")
async def nudge_all_pending(
    booking_id: str,
    current_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Send payment reminders to all pending crew members (captain only)"""
    result = await db.execute(
        select(Booking).where(Booking.id == booking_id)
        .options(selectinload(Booking.participants))
    )
    booking = result.scalar_one_or_none()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    _require_captain(booking, current_user_id)

    pending_count = 0
    for p in booking.participants or []:
        if p.payment_status != "Paid":
            db.add(_payment_reminder(
                str(p.participant_id), booking,
                p.share_amount or (booking.total_price / max(booking.max_participants, 1))))
            pending_count += 1

    await db.commit()
    return {"success": True, "reminders_sent": pending_count}


@router.post("/bookings/{booking_id}/update-splits")
async def update_payment_splits(
    booking_id: str,
    data: UpdateSplitsRequest,
    current_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Update custom payment split amounts for crew members (captain only; the total is preserved)"""
    result = await db.execute(
        select(Booking).where(Booking.id == booking_id)
        .options(selectinload(Booking.participants))
    )
    booking = result.scalar_one_or_none()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    _require_captain(booking, current_user_id)

    # Every figure must be a real, non-negative amount for a distinct member of THIS booking. A NaN would
    # sail through the total check below (abs(nan - x) > 0.01 is False) and a stranger's id would be ignored
    # while its amount still counted toward the total.
    members = {str(p.participant_id): p for p in booking.participants or []}
    seen = set()
    for split in data.splits:
        if not math.isfinite(split.share_amount) or split.share_amount < 0:
            raise HTTPException(status_code=400, detail="Split amounts must be non-negative numbers")
        if split.participant_id not in members or split.participant_id in seen:
            raise HTTPException(status_code=400, detail="Splits must name each crew member of this booking once")
        seen.add(split.participant_id)
    # The new shares replace the old ones as a set, so together they are the whole booking price. Leaving a
    # member out would keep a stale share and push the real total away from the booking price.
    if seen != set(members):
        raise HTTPException(status_code=400, detail="Splits must name each crew member of this booking once")

    enforce_paid_shares(members, data.splits)

    total_splits = sum(s.share_amount for s in data.splits)
    if abs(total_splits - booking.total_price) > 0.01:
        raise HTTPException(
            status_code=400,
            detail=f"Split total (${total_splits:.2f}) must equal booking price (${booking.total_price:.2f})"
        )

    for split in data.splits:
        members[split.participant_id].share_amount = split.share_amount

    await db.commit()
    return {"success": True, "message": "Payment splits updated"}
