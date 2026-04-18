"""
bookings/payments.py — Stripe checkout, crew pay, split payments, crew hub, escrow
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, func
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime, timezone, timedelta
import json
import math
import logging
import os
import stripe

from database import get_db
from models import (
    Profile, Booking, BookingParticipant, BookingInvite,
    Notification, RoleEnum, PaymentTransaction,
    Conversation, ConversationParticipant, Message
)
from utils.credits import deduct_credits, add_credits, transfer_credits, refund_credits
from websocket_manager import broadcast_earnings_update

try:
    from services.onesignal_service import onesignal_service
except ImportError:
    onesignal_service = None

router = APIRouter()
logger = logging.getLogger(__name__)

STRIPE_API_KEY = os.environ.get('STRIPE_API_KEY')
if STRIPE_API_KEY:
    stripe.api_key = STRIPE_API_KEY

# ═══ PYDANTIC MODELS (payments domain) ══════════════════════════════════

# Import shared models from crud domain
from .crud import (
    CrewMember,
    CreateUserBookingRequest,
    CreateBookingWithStripeRequest,
    JoinBookingRequest,
    InviteFriendRequest,
    InviteByHandleRequest,
    InviteResponse,
    BookingSettingsUpdate,
    check_time_slot_conflict,
)

# ═══ ROUTES ══════════════════════════════════════════════════════════════

@router.post("/bookings/{booking_id}/send-split-requests")
async def send_split_payment_requests(
    booking_id: str,
    user_id: str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    """
    Send payment split requests to all pending crew members via Messages.
    Creates a payment request message in each crew member's chat.
    """
    from models import Message, Conversation
    
    # Get booking with participants
    result = await db.execute(
        select(Booking).where(Booking.id == booking_id)
        .options(
            selectinload(Booking.photographer),
            selectinload(Booking.participants).selectinload(BookingParticipant.participant)
        )
    )
    booking = result.scalar_one_or_none()
    
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    
    if booking.creator_id != user_id:
        raise HTTPException(status_code=403, detail="Only booking creator can send split requests")
    
    # Get captain's profile
    captain = await db.execute(select(Profile).where(Profile.id == user_id))
    captain = captain.scalar_one_or_none()
    captain_name = captain.full_name if captain else "Your friend"
    
    # Calculate per-person share
    current_participants = len([p for p in booking.participants if p.status in ['pending', 'confirmed']])
    share_amount = booking.total_price / max(current_participants, 1)
    
    sent_count = 0
    session_date = booking.session_date.strftime('%b %d at %I:%M %p')
    
    # Send to each pending participant
    for participant in booking.participants:
        if participant.participant_id == user_id:
            continue  # Skip captain
        
        if participant.payment_status == 'Paid':
            continue  # Already paid
        
        # Find or create conversation between captain and crew member
        conv_result = await db.execute(
            select(Conversation).where(
                ((Conversation.participant_one_id == user_id) & (Conversation.participant_two_id == participant.participant_id)) |
                ((Conversation.participant_one_id == participant.participant_id) & (Conversation.participant_two_id == user_id))
            )
        )
        conversation = conv_result.scalar_one_or_none()
        
        if not conversation:
            conversation = Conversation(
                participant_one_id=user_id,
                participant_two_id=participant.participant_id
            )
            db.add(conversation)
            await db.flush()
        
        # Create payment request message
        message = Message(
            conversation_id=conversation.id,
            sender_id=user_id,
            content=f"💵 Payment Request: ${share_amount:.2f} for surf session at {booking.location} on {session_date}. Tap to pay your share!",
            message_type='payment_request',
            metadata=json.dumps({
                "booking_id": booking_id,
                "share_amount": share_amount,
                "session_date": str(booking.session_date),
                "location": booking.location,
                "photographer_name": booking.photographer.full_name if booking.photographer else None
            })
        )
        db.add(message)
        
        # Update participant status
        participant.share_amount = share_amount
        participant.payment_request_sent = True
        participant.payment_request_sent_at = datetime.now(timezone.utc)
        
        # Create notification
        notification = Notification(
            user_id=participant.participant_id,
            type='payment_request',
            title=f'Payment Request from {captain_name}',
            body=f'Pay ${share_amount:.2f} to join the surf session at {booking.location}',
            data=json.dumps({
                "booking_id": booking_id,
                "conversation_id": str(conversation.id),
                "share_amount": share_amount
            })
        )
        db.add(notification)
        
        sent_count += 1
    
    await db.commit()
    
    return {
        "message": f"Payment requests sent to {sent_count} crew member(s)",
        "sent_count": sent_count,
        "share_amount": share_amount
    }




@router.post("/bookings/create-with-stripe")
async def create_booking_with_stripe(
    user_id: str,
    data: CreateBookingWithStripeRequest,
    db: AsyncSession = Depends(get_db)
):
    """Create a booking with Stripe payment for remaining balance after credits"""
    from routes.push import notify_booking
    
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
    
    # Parse date
    try:
        session_date = datetime.fromisoformat(data.session_date.replace('Z', '+00:00'))
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format")
    
    # Check for time slot conflicts (only for scheduled bookings, not on_demand)
    conflict = await check_time_slot_conflict(
        db=db,
        photographer_id=data.photographer_id,
        session_date=session_date,
        duration=data.duration
    )
    if conflict:
        raise HTTPException(
            status_code=409,
            detail=conflict["message"]
        )
    
    # Calculate price - MUST match frontend calculation
    # For scheduled bookings, use booking_hourly_rate as primary
    hourly_rate = photographer.booking_hourly_rate or photographer.hourly_rate or photographer.session_price or 75.0
    duration_multipliers = {60: 1, 120: 1.8, 180: 2.5, 240: 3, 480: 5}
    multiplier = duration_multipliers.get(data.duration, data.duration / 60)
    total_price = hourly_rate * multiplier
    
    # Validate and apply credits
    credits_applied = 0
    remaining_credits = user.credit_balance or 0
    
    if data.apply_credits and data.apply_credits > 0:
        # Round to 2 decimal places to avoid floating point precision issues
        apply_credits_rounded = round(data.apply_credits, 2)
        total_price_rounded = round(total_price, 2)
        user_balance_rounded = round(user.credit_balance or 0, 2)
        
        if apply_credits_rounded > user_balance_rounded:
            raise HTTPException(status_code=400, detail="Insufficient credit balance")
        
        # Cap credits at total price instead of rejecting (handles rounding differences)
        credits_applied = min(apply_credits_rounded, total_price_rounded)
    
    amount_to_charge = round(total_price - credits_applied, 2)
    
    # Ensure amount_to_charge is never negative
    if amount_to_charge < 0:
        amount_to_charge = 0
    
    if amount_to_charge <= 0:
        raise HTTPException(status_code=400, detail="No amount to charge. Use regular booking endpoint.")
    
    # Create booking with pending_payment status
    import secrets
    import string
    
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
        price_per_person=total_price,
        allow_splitting=data.allow_splitting,
        description=data.description,
        status='Pending Payment'
    )
    db.add(booking)
    await db.flush()
    
    # Create Stripe checkout session
    success_url = f"{data.origin_url}/bookings/success?session_id={{CHECKOUT_SESSION_ID}}&booking_id={booking.id}"
    cancel_url = f"{data.origin_url}/bookings/cancel?booking_id={booking.id}"
    
    session_time_str = session_date.strftime('%b %d at %I:%M %p')
    
    try:
        checkout_session = stripe.checkout.Session.create(
            payment_method_types=['card'],
            line_items=[{
                'price_data': {
                    'currency': 'usd',
                    'unit_amount': int(amount_to_charge * 100),  # Stripe uses cents
                    'product_data': {
                        'name': f'Surf Session with {photographer.full_name}',
                        'description': f'{data.duration} min session at {data.location} on {session_time_str}',
                    },
                },
                'quantity': 1,
            }],
            mode='payment',
            success_url=success_url,
            cancel_url=cancel_url,
            metadata={
                'user_id': user_id,
                'booking_id': booking.id,
                'photographer_id': data.photographer_id,
                'credits_applied': str(credits_applied),
                'type': 'scheduled_booking'
            }
        )
    except stripe.error.StripeError as e:
        logger.error(f"Stripe error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Payment error: {str(e)}")
    
    # Store payment transaction
    transaction = PaymentTransaction(
        user_id=user_id,
        session_id=checkout_session.id,
        amount=amount_to_charge,
        currency="usd",
        payment_status="Pending",
        status="Pending",
        transaction_metadata=json.dumps({
            'booking_id': booking.id,
            'credits_applied': credits_applied,
            'photographer_id': data.photographer_id
        })
    )
    db.add(transaction)
    
    # Add creator as participant with pending status
    participant = BookingParticipant(
        booking_id=booking.id,
        participant_id=user_id,
        invite_type='direct',
        paid_amount=credits_applied,
        payment_status='Pending',
        payment_method='stripe',
        status='pending'
    )
    db.add(participant)
    
    # Deduct credits if applied (pre-authorize)
    if credits_applied > 0:
        success, remaining_credits, error = await deduct_credits(
            user_id=user_id,
            amount=credits_applied,
            transaction_type='booking_payment',
            db=db,
            description=f"Scheduled session with {photographer.full_name} (partial)",
            reference_type='booking',
            reference_id=booking.id,
            counterparty_id=data.photographer_id
        )
        if not success:
            raise HTTPException(status_code=400, detail=error or "Failed to apply credits")
    
    await db.commit()
    
    return {
        "checkout_url": checkout_session.url,
        "session_id": checkout_session.id,
        "booking_id": booking.id,
        "amount_to_charge": amount_to_charge,
        "credits_applied": credits_applied,
        "remaining_credits": remaining_credits
    }




@router.get("/bookings/payment-success")
async def booking_payment_success(
    session_id: str,
    booking_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Handle successful Stripe payment for booking - converts to credits"""
    from routes.push import notify_booking
    
    try:
        checkout_session = stripe.checkout.Session.retrieve(session_id)
        payment_status = checkout_session.payment_status
    except stripe.error.StripeError as e:
        logger.error(f"Stripe error: {str(e)}")
        raise HTTPException(status_code=500, detail="Payment verification error")
    
    if payment_status != 'paid':
        raise HTTPException(status_code=400, detail="Payment not completed")
    
    # Get booking
    booking_result = await db.execute(
        select(Booking).where(Booking.id == booking_id)
        .options(selectinload(Booking.photographer))
    )
    booking = booking_result.scalar_one_or_none()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    
    # Get the booking creator (surfer)
    user_result = await db.execute(select(Profile).where(Profile.id == booking.creator_id))
    user = user_result.scalar_one_or_none()
    
    # Get transaction
    tx_result = await db.execute(
        select(PaymentTransaction).where(PaymentTransaction.session_id == session_id)
    )
    transaction = tx_result.scalar_one_or_none()
    
    if transaction and transaction.payment_status != 'paid':
        transaction.payment_status = 'paid'
        transaction.status = 'completed'
        
        if user:
            # Add card payment amount as credits
            await add_credits(
                user_id=booking.creator_id,
                amount=transaction.amount,
                transaction_type='stripe_topup',
                db=db,
                description=f'Payment for booking with {booking.photographer.full_name}',
                reference_type='booking',
                reference_id=booking.id
            )
            
            # Now deduct those credits for the booking
            await deduct_credits(
                user_id=booking.creator_id,
                amount=transaction.amount,
                transaction_type='booking_payment',
                db=db,
                description=f'Scheduled session with {booking.photographer.full_name}',
                reference_type='booking',
                reference_id=booking.id,
                counterparty_id=booking.photographer_id
            )
    
    # Update booking status
    booking.status = 'Confirmed'
    
    # ESCROW: Hold payment instead of crediting photographer directly
    booking.escrow_amount = booking.total_price * 0.80  # 80% after platform fee
    booking.escrow_status = 'held'
    
    # Update participant status
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
    
    # Note: Photographer will be credited when booking is Completed AND content is delivered
    # This protects both parties
    
    # Create notifications
    session_time_str = booking.session_date.strftime('%b %d at %I:%M %p')
    
    # Notify photographer
    photographer_notification = Notification(
        user_id=booking.photographer_id,
        type='booking_confirmed',
        title='New Booking Confirmed!',
        body=f'{user.full_name if user else "A surfer"} booked a session at {booking.location} on {session_time_str}',
        data=json.dumps({
            "booking_id": booking.id,
            "session_date": booking.session_date.isoformat(),
            "location": booking.location
        })
    )
    db.add(photographer_notification)
    
    # Notify surfer
    surfer_notification = Notification(
        user_id=booking.creator_id,
        type='booking_confirmation',
        title='Session Booked!',
        body=f'Your session with {booking.photographer.full_name} is confirmed for {session_time_str}',
        data=json.dumps({
            "booking_id": booking.id,
            "session_date": booking.session_date.isoformat()
        })
    )
    db.add(surfer_notification)
    
    # Send push notifications
    try:
        await notify_booking(
            user_id=booking.photographer_id,
            title='New Booking Confirmed!',
            message=f'{user.full_name if user else "A surfer"} booked a session on {session_time_str}',
            db=db
        )
        await notify_booking(
            user_id=booking.creator_id,
            title='Session Booked!',
            message=f'Your session with {booking.photographer.full_name} is confirmed',
            db=db
        )
    except Exception as e:
        logger.warning(f"Failed to send push notifications: {e}")
    
    await db.commit()
    
    return {
        "success": True,
        "message": "Booking confirmed!",
        "booking_id": booking.id,
        "status": "Confirmed"
    }




@router.post("/bookings/{booking_id}/join")
async def join_booking(
    booking_id: str,
    user_id: str,
    data: JoinBookingRequest,
    db: AsyncSession = Depends(get_db)
):
    """User joins an existing booking (for split bookings) - charges credits immediately"""
    # Verify user
    user_result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = user_result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Get booking with photographer info
    booking_result = await db.execute(
        select(Booking).where(Booking.id == booking_id)
        .options(
            selectinload(Booking.participants),
            selectinload(Booking.photographer)
        )
    )
    booking = booking_result.scalar_one_or_none()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    
    if not booking.allow_splitting:
        raise HTTPException(status_code=400, detail="This booking does not allow splitting")
    
    if booking.status not in ['Pending', 'Confirmed']:
        raise HTTPException(status_code=400, detail="This booking is no longer accepting participants")
    
    # Check if already a participant
    existing = [p for p in booking.participants if p.participant_id == user_id]
    if existing:
        raise HTTPException(status_code=400, detail="Already joined this booking")
    
    # Check max participants
    confirmed_count = len([p for p in booking.participants if p.status in ['pending', 'confirmed']])
    if confirmed_count >= booking.max_participants:
        raise HTTPException(status_code=400, detail="Booking is full")
    
    # Calculate split price (price per person stays the same, everyone pays their share)
    split_price = booking.price_per_person or (booking.total_price / booking.max_participants)
    
    # Process payment
    if data.payment_method == 'credits':
        success, new_balance, error = await deduct_credits(
            user_id=user_id,
            amount=split_price,
            transaction_type='booking_payment',
            db=db,
            description=f"Joined booking at {booking.location}",
            reference_type='booking',
            reference_id=booking_id,
            counterparty_id=booking.photographer_id
        )
        
        if not success:
            raise HTTPException(status_code=400, detail=error)
        
        # Credit photographer (80% after platform fee)
        await add_credits(
            user_id=booking.photographer_id,
            amount=split_price * 0.80,
            transaction_type='booking_earning',
            db=db,
            description=f"Booking payment from {user.full_name}",
            reference_type='booking',
            reference_id=booking_id,
            counterparty_id=user_id
        )
    
    # Add participant
    participant = BookingParticipant(
        booking_id=booking_id,
        participant_id=user_id,
        invite_type='direct',
        paid_amount=split_price,
        payment_status='Paid',
        payment_method=data.payment_method,
        status='confirmed'  # Auto-confirm since they paid
    )
    db.add(participant)
    
    # Notify other participants about new member
    for p in booking.participants:
        if p.participant_id != user_id:
            notification = Notification(
                user_id=p.participant_id,
                type='booking_participant_joined',
                title='Someone Joined Your Session',
                body=f'{user.full_name} joined the session at {booking.location}!',
                data=json.dumps({"booking_id": booking_id})
            )
            db.add(notification)
    
    # Notify photographer
    notification = Notification(
        user_id=booking.photographer_id,
        type='booking_payment_received',
        title='New Booking Payment',
        body=f'{user.full_name} paid ${split_price:.2f} to join your session',
        data=json.dumps({"booking_id": booking_id, "amount": split_price})
    )
    db.add(notification)
    
    # Broadcast real-time earnings update to photographer
    photographer_earnings = split_price * 0.80
    await broadcast_earnings_update(
        user_id=booking.photographer_id,
        update_type='booking_paid',
        amount=photographer_earnings,
        details={
            "buyer_name": user.full_name,
            "booking_location": booking.location,
            "gross_amount": split_price,
            "booking_id": booking_id
        }
    )
    
    await db.commit()
    
    return {
        "message": "Successfully joined booking",
        "booking_id": booking_id,
        "amount_paid": split_price,
        "new_balance": new_balance if data.payment_method == 'credits' else None,
        "participants": confirmed_count + 1
    }




@router.post("/bookings/{booking_id}/enable-splitting")
async def enable_splitting_and_generate_code(
    booking_id: str,
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Enable splitting on an existing booking and generate an invite code.
    Only the booking creator can do this.
    """
    import secrets
    import string
    
    # Get booking
    booking_result = await db.execute(
        select(Booking).where(Booking.id == booking_id)
    )
    booking = booking_result.scalar_one_or_none()
    
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    
    # Verify user is the creator
    if booking.creator_id != user_id:
        raise HTTPException(status_code=403, detail="Only the booking creator can enable splitting")
    
    if booking.status not in ['Pending', 'Confirmed']:
        raise HTTPException(status_code=400, detail="Cannot enable splitting on this booking")
    
    # Generate invite code if not exists
    if not booking.invite_code:
        chars = string.ascii_uppercase + string.digits
        booking.invite_code = ''.join(secrets.choice(chars) for _ in range(6))
    
    booking.allow_splitting = True
    
    # Open the lineup for this booking so it shows in The Lineup tab
    if booking.max_participants > 1:
        from datetime import datetime, timedelta, timezone
        booking.lineup_status = 'open'
        booking.lineup_open_at = datetime.now(timezone.utc)
        # Lock window: 96 hours before session
        if booking.session_date:
            booking.lineup_closes_at = booking.session_date - timedelta(hours=96)
        booking.lineup_visibility = booking.lineup_visibility or 'friends'
        booking.lineup_min_crew = booking.lineup_min_crew or 2
        booking.lineup_max_crew = booking.max_participants
    
    await db.commit()
    
    return {
        "success": True,
        "invite_code": booking.invite_code,
        "lineup_status": booking.lineup_status,
        "message": "Splitting enabled! Your session is now in The Lineup."
    }




@router.post("/bookings/join-by-code")
async def join_by_invite_code(
    user_id: str,
    invite_code: str,
    db: AsyncSession = Depends(get_db)
):
    """Join a booking using an invite code"""
    # Find booking by invite code
    booking_result = await db.execute(
        select(Booking).where(Booking.invite_code == invite_code.upper())
        .options(selectinload(Booking.participants))
    )
    booking = booking_result.scalar_one_or_none()
    
    if not booking:
        raise HTTPException(status_code=404, detail="Invalid invite code")
    
    if not booking.allow_splitting:
        raise HTTPException(status_code=400, detail="This booking does not allow joining")
    
    if booking.status not in ['Pending', 'Confirmed']:
        raise HTTPException(status_code=400, detail="This booking is no longer accepting participants")
    
    # Use the join booking logic
    return await join_booking(booking.id, user_id, JoinBookingRequest(), db)




@router.get("/bookings/invites/{user_id}")
async def get_user_invites(
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get pending booking invites for a user"""
    result = await db.execute(
        select(BookingInvite)
        .where(BookingInvite.invitee_id == user_id)
        .where(BookingInvite.status == 'pending')
        .options(
            selectinload(BookingInvite.booking).selectinload(Booking.photographer),
            selectinload(BookingInvite.inviter)
        )
        .order_by(BookingInvite.created_at.desc())
    )
    invites = result.scalars().all()
    
    return [
        {
            "id": inv.id,
            "booking_id": inv.booking_id,
            "inviter_name": inv.inviter.full_name if inv.inviter else None,
            "inviter_avatar": inv.inviter.avatar_url if inv.inviter else None,
            "location": inv.booking.location if inv.booking else None,
            "session_date": inv.booking.session_date.isoformat() if inv.booking else None,
            "photographer_name": inv.booking.photographer.full_name if inv.booking and inv.booking.photographer else None,
            "message": inv.message,
            "created_at": inv.created_at.isoformat()
        }
        for inv in invites
    ]



# ============ CREW PAYMENT MANAGEMENT ============

class UpdateSplitRequest(BaseModel):
    participant_id: str
    share_amount: float

class UpdateSplitsRequest(BaseModel):
    splits: List[UpdateSplitRequest]




@router.get("/bookings/{booking_id}/crew-status")
async def get_crew_status(
    booking_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get real-time crew payment status for Host Surfer dashboard"""
    result = await db.execute(
        select(Booking).where(Booking.id == booking_id)
        .options(selectinload(Booking.participants))
    )
    booking = result.scalar_one_or_none()
    
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    
    # Get all participants with their payment status
    crew = []
    for p in booking.participants or []:
        # Get participant profile info
        profile_result = await db.execute(
            select(Profile).where(Profile.id == p.participant_id)
        )
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
        "booking_id": booking_id,
        "total_price": booking.total_price,
        "status": booking.status,
        "crew_payment_required": booking.crew_payment_required or False,
        "crew_paid_count": len([c for c in crew if c["payment_status"] == "Paid"]),
        "total_crew": len(crew),
        "crew": crew
    }




@router.post("/bookings/{booking_id}/nudge")
async def nudge_crew_member(
    booking_id: str,
    participant_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Send payment reminder to a specific crew member"""
    result = await db.execute(
        select(Booking).where(Booking.id == booking_id)
    )
    booking = result.scalar_one_or_none()
    
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    
    # Get participant profile
    profile_result = await db.execute(
        select(Profile).where(Profile.id == participant_id)
    )
    profile = profile_result.scalar_one_or_none()
    
    if not profile:
        raise HTTPException(status_code=404, detail="Crew member not found")
    
    # Create notification for the crew member
    notification = Notification(
        user_id=participant_id,
        type="payment_reminder",
        title="Payment Reminder",
        message=f"Your crew payment for the session at {booking.location} is pending. Please complete payment to confirm your spot!",
        data={
            "booking_id": booking_id,
            "amount_due": booking.total_price / max(booking.max_participants, 1)
        }
    )
    db.add(notification)
    await db.commit()
    
    return {"success": True, "message": "Reminder sent"}




@router.post("/bookings/{booking_id}/nudge-all")
async def nudge_all_pending(
    booking_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Send payment reminders to all pending crew members"""
    result = await db.execute(
        select(Booking).where(Booking.id == booking_id)
        .options(selectinload(Booking.participants))
    )
    booking = result.scalar_one_or_none()
    
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    
    # Find all pending participants
    pending_count = 0
    for p in booking.participants or []:
        if p.payment_status != "Paid":
            notification = Notification(
                user_id=str(p.participant_id),
                type="payment_reminder",
                title="Payment Reminder",
                message=f"Your crew payment for the session at {booking.location} is pending. Please complete payment to confirm your spot!",
                data={
                    "booking_id": booking_id,
                    "amount_due": p.share_amount or (booking.total_price / max(booking.max_participants, 1))
                }
            )
            db.add(notification)
            pending_count += 1
    
    await db.commit()
    
    return {"success": True, "reminders_sent": pending_count}




@router.post("/bookings/{booking_id}/update-splits")
async def update_payment_splits(
    booking_id: str,
    data: UpdateSplitsRequest,
    db: AsyncSession = Depends(get_db)
):
    """Update custom payment split amounts for crew members"""
    result = await db.execute(
        select(Booking).where(Booking.id == booking_id)
        .options(selectinload(Booking.participants))
    )
    booking = result.scalar_one_or_none()
    
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    
    # Validate total equals booking price
    total_splits = sum(s.share_amount for s in data.splits)
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
                break
    
    await db.commit()
    
    return {"success": True, "message": "Payment splits updated"}



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
    from routes.push import notify_crew_payment_request
    
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
# CREW PAYMENT PAGE - DEEP LINK ENDPOINTS
# ============================================================



@router.get("/bookings/{booking_id}/crew-payment-details")
async def get_crew_payment_details(
    booking_id: str,
    user_id: str,
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
    from routes.push import notify_crew_payment_received
    
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



# ============ THE LINEUP: SURF SESSION LOBBY SYSTEM ============
# Like an online poker lobby - surfers wait for crew to join before session locks

class OpenLineupRequest(BaseModel):
    """Request to open a lineup for a booking"""
    visibility: str = 'friends'  # 'friends', 'area', 'both'
    min_crew: int = 2
    max_crew: Optional[int] = None
    message: Optional[str] = None
    auto_confirm: bool = False


