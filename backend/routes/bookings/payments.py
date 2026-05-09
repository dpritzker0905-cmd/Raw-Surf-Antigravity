"""
bookings/payments.py — Split payment requests, crew hub escrow.

Stripe checkout, payment success, crew-status, nudge, and split management
have been extracted to stripe_checkout.py (v90 decomposition).
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

# ═══ PYDANTIC MODELS (payments domain) ═══════════════════════════════════

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

# ═══ STRIPE CHECKOUT (extracted to stripe_checkout.py in v90) ═══════════
# Re-exported for backward compatibility
from .stripe_checkout import (
    create_booking_with_stripe,
    booking_payment_success,
    get_crew_status,
    nudge_crew_member,
    nudge_all_pending,
    update_payment_splits,
    UpdateSplitRequest,
    UpdateSplitsRequest,
)

# ═══ ROUTES ══════════════════════════════════════════════════════════════

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
