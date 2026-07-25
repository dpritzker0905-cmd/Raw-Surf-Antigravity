"""Booking cancellation and refund policy routes."""
from __future__ import annotations

from datetime import datetime, timezone
import json
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core.security import get_current_user_id
from database import get_db
from models import Booking, Notification
from utils.credits import add_credits


router = APIRouter()
logger = logging.getLogger(__name__)

class CancelBookingRequest(BaseModel):
    reason: str | None = None

@router.post("/bookings/{booking_id}/cancel")
async def cancel_booking(
    booking_id: str,
    data: CancelBookingRequest,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """
    Cancel a booking with refund based on cancellation policy:
    - >48 hours before session: 90% refund
    - 24-48 hours before session: 50% refund
    - <24 hours before session: 0% refund (no refund)
    """
    from routes.notifications.push import notify_booking

    result = await db.execute(
        select(Booking).where(Booking.id == booking_id)
        .options(
            selectinload(Booking.photographer),
            selectinload(Booking.participants)
        )
    )
    booking = result.scalar_one_or_none()

    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    if booking.creator_id != user_id and booking.photographer_id != user_id:
        raise HTTPException(status_code=403, detail="Not authorized to cancel this booking")
    if booking.status in ['Cancelled', 'Completed']:
        raise HTTPException(status_code=400, detail=f"Booking already {booking.status.lower()}")

    now = datetime.now(timezone.utc)
    session_time = booking.session_date
    if session_time.tzinfo is None:
        session_time = session_time.replace(tzinfo=timezone.utc)

    hours_until_session = (session_time - now).total_seconds() / 3600

    is_photographer_cancelling = (booking.photographer_id == user_id)

    # Bad weather check (credited to wallet to reschedule later)
    is_bad_weather = False
    if not is_photographer_cancelling and data.reason:
        reason_lower = data.reason.lower()
        if any(keyword in reason_lower for keyword in ["weather", "storm", "rain", "lightning", "hurricane", "gale", "thunderstorm"]):
            is_bad_weather = True

    total_paid = sum(p.paid_amount or 0 for p in booking.participants)
    retained_amount = 0.0

    if is_photographer_cancelling:
        refund_percentage = 100
        refund_amount = total_paid
    elif is_bad_weather:
        # Surfer cancels due to bad weather -> full refund of session
        # BUT photographer retains the travel surcharge fee for gas costs if they charge travel fees!
        travel_surcharge = 0.0
        photographer = booking.photographer
        if photographer and photographer.charges_travel_fees and photographer.travel_surcharges:
            if booking.latitude is not None and booking.longitude is not None:
                if photographer.home_latitude is not None and photographer.home_longitude is not None:
                    try:
                        from utils.geo import haversine_distance
                        distance = haversine_distance(
                            photographer.home_latitude, photographer.home_longitude,
                            booking.latitude, booking.longitude
                        )
                        tiers = photographer.travel_surcharges or []
                        if isinstance(tiers, str):
                            tiers = json.loads(tiers)
                        for tier in tiers:
                            min_m = tier.get("min_miles", 0)
                            max_m = tier.get("max_miles", 999999)
                            if min_m <= distance <= max_m:
                                travel_surcharge = float(tier.get("surcharge", 0.0))
                                break
                    except Exception as e:
                        logger.warning(f"Error calculating travel surcharge: {e}")

        # Retained travel surcharge (capped at total_paid)
        retained_amount = min(travel_surcharge, total_paid)
        refund_amount = total_paid - retained_amount
        refund_percentage = (refund_amount / total_paid * 100) if total_paid > 0 else 0.0

        if retained_amount > 0:
            # Transfer the retained travel surcharge directly to the photographer's wallet balance for gas
            await add_credits(
                user_id=booking.photographer_id,
                amount=retained_amount,
                transaction_type='booking_earning',
                db=db,
                description=f"Retained travel surcharge fee for gas costs (cancelled booking {booking_id})",
                reference_type='booking',
                reference_id=booking_id,
                counterparty_id=booking.creator_id
            )
            logger.info(f"Bad weather cancellation: Surfer refunded ${refund_amount:.2f}, photographer retains travel fee of ${retained_amount:.2f} for gas costs.")
        else:
            logger.info(f"Bad weather cancellation: Surfer fully refunded ${refund_amount:.2f}.")
    else:
        # Standard cancellation policy
        if hours_until_session > 48:
            refund_percentage = 90
        elif hours_until_session > 24:
            refund_percentage = 50
        else:
            refund_percentage = 0
        refund_amount = (total_paid * refund_percentage) / 100

    booking.status = 'Cancelled'
    booking.cancelled_at = now
    booking.cancellation_reason = data.reason
    booking.refund_amount = refund_amount
    booking.refund_percentage = refund_percentage

    if booking.escrow_status == 'held':
        booking.escrow_status = 'refunded'

    if refund_amount > 0:
        for participant in booking.participants:
            if participant.paid_amount and participant.paid_amount > 0:
                participant_refund = (participant.paid_amount * refund_percentage) / 100
                await add_credits(
                    user_id=participant.participant_id,
                    amount=participant_refund,
                    transaction_type='booking_refund',
                    db=db,
                    description=f"Refund for cancelled booking ({refund_percentage}%)",
                    reference_type='booking',
                    reference_id=booking_id,
                    counterparty_id=booking.photographer_id
                )
                participant.payment_status = 'Refunded'

    photographer_name = booking.photographer.full_name if booking.photographer else "Photographer"
    session_time_str = booking.session_date.strftime('%b %d at %I:%M %p')

    if is_photographer_cancelling:
        for participant in booking.participants:
            notification = Notification(
                user_id=participant.participant_id,
                type='booking_cancelled',
                title='Session Cancelled',
                body=f'{photographer_name} cancelled your session on {session_time_str}. Full refund credited to your account.',
                data=json.dumps({
                    "booking_id": booking_id,
                    "refund_amount": refund_amount,
                    "refund_percentage": 100
                })
            )
            db.add(notification)
    else:
        notification = Notification(
            user_id=booking.photographer_id,
            type='booking_cancelled',
            title='Session Cancelled',
            body=f'Your session on {session_time_str} was cancelled by the surfer.',
            data=json.dumps({
                "booking_id": booking_id,
                "cancelled_by": user_id
            })
        )
        db.add(notification)

    await db.commit()

    return {
        "message": "Booking cancelled",
        "booking_id": booking_id,
        "refund_amount": refund_amount,
        "refund_percentage": refund_percentage,
        "refund_policy": f"{'Full refund (photographer cancelled)' if is_photographer_cancelling else f'{refund_percentage}% refund ({hours_until_session:.0f}hrs before session)'}"
    }
