"""
bookings/booking_lifecycle.py — Booking write operations: create, cancel, complete,
content delivery, feed sharing, and live session departure.

Extracted from crud.py (v85) to maintain <800 LOC per module.
Read endpoints remain in crud.py.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime, timezone, timedelta
import json
import logging

from database import get_db
from core.security import get_current_user_id
from models import (
    Profile, Booking, BookingParticipant,
    Notification, RoleEnum, Post
)
from utils.credits import deduct_credits, add_credits
from models import LiveSessionParticipant

try:
    from services.onesignal_service import onesignal_service
except ImportError:
    onesignal_service = None

# Import shared helpers from crud
from .crud import check_time_slot_conflict

router = APIRouter()
logger = logging.getLogger(__name__)


# ═══ REQUEST MODELS (lifecycle-specific) ═══════════════════════════════

class CrewMember(BaseModel):
    user_id: str
    name: str
    share_amount: float

class CreateUserBookingRequest(BaseModel):
    photographer_id: str
    location: str
    session_date: str  # ISO format
    duration: int = 60
    max_participants: int = 1
    allow_splitting: bool = False
    split_mode: str = 'friends_only'
    crew_members: Optional[List[CrewMember]] = None
    payment_window_expires: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    description: Optional[str] = None
    apply_credits: Optional[float] = 0
    impact_zone_type: Optional[str] = None
    impact_zone_preset: Optional[str] = None


# ═══ ROUTES ══════════════════════════════════════════════════════════════


@router.post("/bookings/create")
async def create_user_booking(
    data: CreateUserBookingRequest,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """User creates a booking with a photographer - supports account credit application"""
    from routes.notifications.push import notify_booking
    import os
    import stripe

    STRIPE_API_KEY = os.environ.get('STRIPE_SECRET_KEY') or os.environ.get('STRIPE_API_KEY')
    if STRIPE_API_KEY:
        stripe.api_key = STRIPE_API_KEY

    # Verify user
    user_result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = user_result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Verify photographer
    photographer_result = await db.execute(
        select(Profile).where(Profile.id == data.photographer_id)
    )
    photographer = photographer_result.scalar_one_or_none()
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")

    photographer_roles = [RoleEnum.GROM_PARENT, RoleEnum.HOBBYIST, RoleEnum.PHOTOGRAPHER, RoleEnum.APPROVED_PRO]
    if photographer.role not in photographer_roles:
        raise HTTPException(status_code=400, detail="Selected user is not a photographer")

    # Parse date
    try:
        session_date = datetime.fromisoformat(data.session_date.replace('Z', '+00:00'))
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format")

    # Check for time slot conflicts
    conflict = await check_time_slot_conflict(
        db=db,
        photographer_id=data.photographer_id,
        session_date=session_date,
        duration=data.duration
    )
    if conflict:
        raise HTTPException(status_code=409, detail=conflict["message"])

    # Calculate price based on duration
    hourly_rate = photographer.booking_hourly_rate or photographer.hourly_rate or photographer.session_price or 75.0

    # Default: non-Hobbyist bookings auto-confirm on payment
    auto_confirm = True

    # ═══ HOBBYIST BOOKING GUARDRAILS ═══════════════════════════════════════
    if photographer.role == RoleEnum.HOBBYIST:
        from models import PlatformSettings
        settings_result = await db.execute(select(PlatformSettings).limit(1))
        platform_settings = settings_result.scalar_one_or_none()

        max_bookings_per_week = getattr(platform_settings, 'hobbyist_max_bookings_per_week', 3) if platform_settings else 3
        max_hourly_rate = getattr(platform_settings, 'hobbyist_max_hourly_rate', 40.0) if platform_settings else 40.0
        auto_confirm = getattr(platform_settings, 'hobbyist_booking_auto_confirm', False) if platform_settings else False

        if hourly_rate > max_hourly_rate:
            logger.info(f"[Hobbyist Guard] Capping hourly rate from ${hourly_rate} to ${max_hourly_rate} for photographer {photographer.id}")
            hourly_rate = max_hourly_rate

        week_ago = datetime.now(timezone.utc) - timedelta(days=7)
        weekly_count_result = await db.execute(
            select(func.count(Booking.id)).where(
                and_(
                    Booking.photographer_id == photographer.id,
                    Booking.created_at >= week_ago,
                    Booking.status.notin_(['Cancelled'])
                )
            )
        )
        weekly_count = weekly_count_result.scalar() or 0
        if weekly_count >= max_bookings_per_week:
            raise HTTPException(
                status_code=429,
                detail=f"This photographer has reached their weekly booking limit ({max_bookings_per_week}/week). Try again next week."
            )
    # ═══ END HOBBYIST GUARDRAILS ═══════════════════════════════════════════

    duration_multipliers = {60: 1, 120: 1.8, 180: 2.5, 240: 3, 480: 5}
    multiplier = duration_multipliers.get(data.duration, data.duration / 60)
    base_price = hourly_rate * multiplier

    group_discount_percent = 0
    if data.max_participants >= 5 and (photographer.group_discount_5_plus or 0) > 0:
        group_discount_percent = photographer.group_discount_5_plus
    elif data.max_participants >= 3 and (photographer.group_discount_3_plus or 0) > 0:
        group_discount_percent = photographer.group_discount_3_plus
    elif data.max_participants >= 2 and (photographer.group_discount_2_plus or 0) > 0:
        group_discount_percent = photographer.group_discount_2_plus

    discount_amount = (base_price * group_discount_percent) / 100
    total_price = base_price - discount_amount
    price_per_person = total_price / data.max_participants if data.max_participants > 0 else total_price

    # Handle credit application
    credits_applied = 0
    remaining_credits = user.credit_balance or 0
    amount_to_charge = total_price

    if data.apply_credits and data.apply_credits > 0:
        apply_credits_rounded = round(data.apply_credits, 2)
        total_price_rounded = round(total_price, 2)
        user_balance_rounded = round(user.credit_balance or 0, 2)

        logging.info(f"[Credit Application] Requested: {apply_credits_rounded}, Total: {total_price_rounded}, Balance: {user_balance_rounded}")

        if apply_credits_rounded > user_balance_rounded:
            raise HTTPException(status_code=400, detail="Insufficient credit balance")

        credits_applied = min(apply_credits_rounded, total_price_rounded)
        amount_to_charge = round(total_price - credits_applied, 2)

        if amount_to_charge < 0:
            amount_to_charge = 0

        success, remaining_credits, error = await deduct_credits(
            user_id=user_id,
            amount=credits_applied,
            transaction_type='booking_payment',
            db=db,
            description=f"Scheduled session with {photographer.full_name}",
            reference_type='booking',
            reference_id=None,
            counterparty_id=data.photographer_id
        )

        if not success:
            raise HTTPException(status_code=400, detail=error or "Failed to apply credits")

    # Generate invite code if splitting
    import secrets
    import string
    invite_code = None
    if data.allow_splitting:
        chars = string.ascii_uppercase + string.digits
        invite_code = ''.join(secrets.choice(chars) for _ in range(6))

    # Create booking
    booking = Booking(
        photographer_id=data.photographer_id,
        creator_id=user_id,
        location=data.location,
        latitude=data.latitude,
        longitude=data.longitude,
        session_date=session_date,
        duration=data.duration,
        max_participants=data.max_participants,
        total_price=total_price,
        price_per_person=price_per_person,
        allow_splitting=data.allow_splitting,
        split_mode=data.split_mode,
        invite_code=invite_code,
        description=data.description,
        status='Confirmed' if credits_applied >= total_price else ('Pending Acceptance' if photographer.role == RoleEnum.HOBBYIST and not auto_confirm else 'Pending')
    )
    db.add(booking)
    await db.flush()

    # Add creator as first participant
    payment_status = 'Paid' if credits_applied >= total_price else ('Partial' if credits_applied > 0 else 'Pending')
    participant = BookingParticipant(
        booking_id=booking.id,
        participant_id=user_id,
        invite_type='direct',
        paid_amount=credits_applied,
        payment_status=payment_status,
        payment_method='credits' if credits_applied > 0 else None,
        status='confirmed' if credits_applied >= total_price else 'pending'
    )
    db.add(participant)

    # ESCROW: Hold payment until booking completed + content delivered
    if credits_applied >= total_price:
        booking.escrow_amount = total_price * 0.80
        booking.escrow_status = 'held'

    # Notifications
    session_time_str = session_date.strftime('%b %d at %I:%M %p')

    notification = Notification(
        user_id=data.photographer_id,
        type='booking_request' if credits_applied < total_price else 'booking_confirmed',
        title='New Booking!' if credits_applied >= total_price else 'New Booking Request',
        body=f'{user.full_name} booked a session at {data.location} on {session_time_str}',
        data=json.dumps({
            "booking_id": booking.id,
            "user_id": user_id,
            "user_name": user.full_name,
            "session_date": session_date.isoformat(),
            "location": data.location,
            "total_price": total_price,
            "is_paid": credits_applied >= total_price,
            "escrow_status": "held" if credits_applied >= total_price else "pending"
        })
    )
    db.add(notification)

    try:
        await notify_booking(
            user_id=data.photographer_id,
            title='New Booking!' if credits_applied >= total_price else 'New Booking Request',
            message=f'{user.full_name} booked a session on {session_time_str} at {data.location}',
            db=db
        )
    except Exception as e:
        logger.warning(f"Failed to send booking push notification: {e}")

    surfer_notification = Notification(
        user_id=user_id,
        type='booking_confirmation',
        title='Session Booked!',
        body=f'Your session with {photographer.full_name} is confirmed for {session_time_str}',
        data=json.dumps({
            "booking_id": booking.id,
            "photographer_name": photographer.full_name,
            "session_date": session_date.isoformat(),
            "location": data.location
        })
    )
    db.add(surfer_notification)

    try:
        await notify_booking(
            user_id=user_id,
            title='Session Booked!',
            message=f'Your session with {photographer.full_name} is confirmed for {session_time_str}',
            db=db
        )
    except Exception as e:
        logger.warning(f"Failed to send surfer booking push notification: {e}")

    await db.commit()
    await db.refresh(booking)

    return {
        "message": "Booking confirmed!" if credits_applied >= total_price else "Booking request submitted",
        "booking_id": booking.id,
        "invite_code": invite_code,
        "status": booking.status,
        "total_price": total_price,
        "price_per_person": price_per_person,
        "credits_applied": credits_applied,
        "remaining_credits": remaining_credits,
        "amount_to_charge": amount_to_charge,
        "escrow_status": booking.escrow_status,
        "escrow_amount": booking.escrow_amount
    }


@router.post("/bookings/{booking_id}/complete")
async def complete_booking(
    booking_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """
    Mark booking as completed (typically by photographer after session).
    Auto-creates gallery with booking pricing via the gallery sync service.
    """
    from services.gallery_sync import create_session_gallery, check_gallery_exists_for_session
    from .invites import release_escrow

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
    if booking.photographer_id != user_id:
        raise HTTPException(status_code=403, detail="Only photographer can mark booking as completed")
    if booking.status == 'Completed':
        raise HTTPException(status_code=400, detail="Booking already completed")
    if booking.status == 'Cancelled':
        raise HTTPException(status_code=400, detail="Cannot complete a cancelled booking")

    booking.status = 'Completed'

    if booking.content_delivered and booking.escrow_status == 'held':
        await release_escrow(booking, db)

    await db.flush()

    gallery_exists = await check_gallery_exists_for_session(db, booking_id=booking_id)
    participant_ids = [p.participant_id for p in booking.participants if p.has_paid]

    gallery_result = None
    if not gallery_exists and not booking.is_on_demand:
        gallery_result = await create_session_gallery(
            db=db,
            photographer_id=booking.photographer_id,
            session_type='booking',
            spot_id=booking.spot_id,
            spot_name=booking.location_name or booking.location,
            booking_id=booking_id,
            session_start=datetime.combine(booking.scheduled_date, booking.scheduled_time) if booking.scheduled_date else None,
            participant_ids=participant_ids
        )

        if gallery_result and gallery_result.get("gallery_id"):
            gallery_id = gallery_result.get("gallery_id")
            photographer_name = booking.photographer.full_name if booking.photographer else "Your photographer"

            for surfer_id in participant_ids:
                notification = Notification(
                    user_id=surfer_id,
                    type='gallery_ready',
                    title='Your Session Photos Are Ready! 📸',
                    body=f'{photographer_name} has completed your booked session. Your gallery is ready!',
                    action_url=f'/gallery/{gallery_id}',
                    metadata={
                        'gallery_id': gallery_id,
                        'booking_id': booking_id,
                        'photographer_id': booking.photographer_id,
                        'photographer_name': photographer_name,
                        'session_type': 'booking'
                    }
                )
                db.add(notification)

    await db.commit()

    response = {
        "message": "Booking marked as completed",
        "booking_id": booking_id,
        "escrow_status": booking.escrow_status,
        "content_delivered": booking.content_delivered,
        "note": "Escrow will be released once content is delivered via gallery" if not booking.content_delivered else "Escrow released to photographer"
    }

    if gallery_result:
        response["gallery_id"] = gallery_result.get("gallery_id")
        response["gallery_title"] = gallery_result.get("title")
        response["selection_quotas_created"] = gallery_result.get("participants_added", 0)

    return response


@router.post("/bookings/{booking_id}/content-delivered")
async def mark_content_delivered(
    booking_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Mark content as delivered. If booking is completed, triggers escrow release."""
    from .invites import release_escrow

    result = await db.execute(
        select(Booking).where(Booking.id == booking_id)
        .options(selectinload(Booking.photographer))
    )
    booking = result.scalar_one_or_none()

    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    if booking.photographer_id != user_id:
        raise HTTPException(status_code=403, detail="Only photographer can mark content as delivered")

    booking.content_delivered = True
    booking.content_delivered_at = datetime.now(timezone.utc)

    if booking.status == 'Completed' and booking.escrow_status == 'held':
        await release_escrow(booking, db)

    await db.commit()

    return {
        "message": "Content marked as delivered",
        "booking_id": booking_id,
        "escrow_status": booking.escrow_status,
        "escrow_released": booking.escrow_status == 'released',
        "note": "Escrow released to photographer" if booking.escrow_status == 'released' else "Escrow will be released once booking is marked complete"
    }


@router.post("/bookings/{booking_id}/share-to-feed")
async def share_booking_to_feed(
    booking_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Share a scheduled booking as a Session Log in the feed."""
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
    if booking.creator_id != user_id:
        raise HTTPException(status_code=403, detail="Only booking creator can share to feed")

    existing_post = await db.execute(
        select(Post).where(
            Post.author_id == user_id,
            Post.booking_id == booking_id
        )
    )
    if existing_post.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Session already posted to feed")

    creator = await db.execute(select(Profile).where(Profile.id == user_id))
    creator = creator.scalar_one_or_none()

    session_date = booking.session_date.strftime('%b %d at %I:%M %p')
    photographer_name = booking.photographer.full_name if booking.photographer else "a photographer"
    current_participants = len([p for p in booking.participants if p.status in ['pending', 'confirmed']])
    spots_left = booking.max_participants - current_participants

    caption = f"🏄 Surf session booked! {booking.location} on {session_date} with {photographer_name}. "
    if spots_left > 0:
        caption += f"{spots_left} spot{'s' if spots_left > 1 else ''} available - join my crew! 🤙"
    else:
        caption += "Crew is full - stoked!"

    post = Post(
        author_id=user_id,
        caption=caption,
        location=booking.location,
        media_type='session_log',
        booking_id=booking_id,
        is_session_log=True,
        session_invite_open=spots_left > 0,
        session_spots_left=spots_left,
        session_price_per_person=booking.price_per_person
    )
    db.add(post)

    await db.commit()
    await db.refresh(post)

    return {
        "message": "Session posted to feed",
        "post_id": str(post.id),
        "spots_left": spots_left
    }


@router.post("/sessions/leave/{session_id}")
async def leave_live_session(
    session_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Allow user to leave a live session early. Auto-refund if within 10 minutes."""
    result = await db.execute(
        select(LiveSessionParticipant)
        .where(LiveSessionParticipant.id == session_id)
        .where(LiveSessionParticipant.surfer_id == user_id)
        .where(LiveSessionParticipant.status == 'active')
    )
    participant = result.scalar_one_or_none()

    if not participant:
        raise HTTPException(status_code=404, detail="Session not found or already ended")

    now = datetime.now(timezone.utc)
    joined_at = participant.joined_at
    if joined_at.tzinfo is None:
        joined_at = joined_at.replace(tzinfo=timezone.utc)

    time_in_session = (now - joined_at).total_seconds() / 60

    refund_amount = 0
    refund_applied = False

    if time_in_session < 10 and participant.amount_paid and participant.amount_paid > 0:
        refund_amount = participant.amount_paid

        surfer_result = await db.execute(
            select(Profile).where(Profile.id == user_id)
        )
        surfer = surfer_result.scalar_one_or_none()

        if surfer:
            surfer.credit_balance = (surfer.credit_balance or 0) + refund_amount
            refund_applied = True

    participant.status = 'left'
    participant.left_at = now

    await db.commit()

    if refund_applied:
        await db.refresh(surfer)
        return {
            "message": f"Left session early - ${refund_amount:.2f} refunded to your credits",
            "session_id": session_id,
            "refunded": True,
            "refund_amount": refund_amount,
            "new_balance": surfer.credit_balance,
            "time_in_session_minutes": round(time_in_session, 1)
        }

    return {
        "message": "Successfully left the session",
        "session_id": session_id,
        "refunded": False,
        "time_in_session_minutes": round(time_in_session, 1)
    }
