"""
bookings/payments.py â€” Stripe checkout, crew pay, split payments, crew hub, escrow
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
from core.security import get_user_id_from_jwt_or_query

try:
    from services.onesignal_service import onesignal_service
except ImportError:
    onesignal_service = None

router = APIRouter()
logger = logging.getLogger(__name__)

STRIPE_API_KEY = os.environ.get('STRIPE_SECRET_KEY') or os.environ.get('STRIPE_API_KEY')
if STRIPE_API_KEY:
    stripe.api_key = STRIPE_API_KEY

# â•â•â• PYDANTIC MODELS (payments domain) â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

# Import shared models from crud domain
from .crud import (
    CrewMember,
    CreateBookingWithStripeRequest,
    JoinBookingRequest,
    InviteFriendRequest,
    InviteByHandleRequest,
    InviteResponse,
    BookingSettingsUpdate,
    check_time_slot_conflict,
)

# â•â•â• ROUTES â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

@router.post("/bookings/{booking_id}/send-split-requests")
async def send_split_payment_requests(
    booking_id: str,
    user_id: str = Depends(get_user_id_from_jwt_or_query),
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
            content=f"ðŸ’µ Payment Request: ${share_amount:.2f} for surf session at {booking.location} on {session_date}. Tap to pay your share!",
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
    from routes.notifications.push import notify_booking
    
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
    from routes.notifications.push import notify_booking
    
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



