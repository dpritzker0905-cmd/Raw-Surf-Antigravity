"""
bookings/crud.py â€” Core booking CRUD: list, get, create, cancel, complete, share, sessions
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
from core.security import get_user_id_from_jwt_or_query, get_optional_user_id_from_jwt_or_query
from models import (
    Profile, Booking, BookingParticipant, BookingInvite,
    Notification, RoleEnum, PaymentTransaction,
    Conversation, ConversationParticipant, Message
)
from utils.credits import deduct_credits, add_credits, transfer_credits, refund_credits
from websocket_manager import broadcast_earnings_update
from models import LiveSessionParticipant, Post

try:
    from services.onesignal_service import onesignal_service
except ImportError:
    onesignal_service = None

router = APIRouter()
logger = logging.getLogger(__name__)

STRIPE_API_KEY = os.environ.get('STRIPE_SECRET_KEY') or os.environ.get('STRIPE_API_KEY')
if STRIPE_API_KEY:
    stripe.api_key = STRIPE_API_KEY

# â•â•â• SHARED HELPERS & MODELS â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

# ============ TIME SLOT CONFLICT VALIDATION ============

async def check_time_slot_conflict(
    db: AsyncSession,
    photographer_id: str,
    session_date: datetime,
    duration: int,
    exclude_booking_id: Optional[str] = None
) -> Optional[dict]:
    """
    Check if the requested time slot conflicts with existing bookings for the photographer.
    Returns conflict details if found, None if time slot is available.
    
    Only checks scheduled bookings (not on_demand) and non-cancelled statuses.
    """
    # Calculate the end time of the requested session
    session_end = session_date + timedelta(minutes=duration)
    
    # Build query for existing bookings
    query = select(Booking).where(
        and_(
            Booking.photographer_id == photographer_id,
            Booking.status.notin_(['Cancelled', 'Pending Payment']),  # Active bookings only
            or_(
                Booking.booking_type.is_(None),
                Booking.booking_type != 'on_demand'  # Only check scheduled bookings
            )
        )
    )
    
    # Exclude specific booking if updating
    if exclude_booking_id:
        query = query.where(Booking.id != exclude_booking_id)
    
    result = await db.execute(query)
    existing_bookings = result.scalars().all()
    
    for booking in existing_bookings:
        # Calculate existing booking's time range
        existing_start = booking.session_date
        existing_end = existing_start + timedelta(minutes=booking.duration)
        
        # Check for overlap: new session overlaps if it starts before existing ends AND ends after existing starts
        if session_date < existing_end and session_end > existing_start:
            return {
                "conflict": True,
                "existing_booking_id": booking.id,
                "existing_start": existing_start.isoformat(),
                "existing_end": existing_end.isoformat(),
                "existing_location": booking.location,
                "message": f"Time slot conflicts with existing booking at {booking.location} ({existing_start.strftime('%I:%M %p')} - {existing_end.strftime('%I:%M %p')})"
            }
    
    return None  # No conflict


# ============ PYDANTIC MODELS (shared across booking modules) ============

# NOTE: CrewMember, CreateUserBookingRequest, CancelBookingRequest live in
# booking_lifecycle.py. Import them from there, NOT from crud.py.

# CreateBookingWithStripeRequest stays here (used by payments.py)
class CrewMember(BaseModel):
    user_id: str
    name: str
    share_amount: float

class CreateBookingWithStripeRequest(BaseModel):
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
    origin_url: str  # For Stripe redirect URLs


class JoinBookingRequest(BaseModel):
    payment_method: str = 'credits'


class InviteFriendRequest(BaseModel):
    friend_id: str
    message: Optional[str] = None


class InviteByHandleRequest(BaseModel):
    """Invite a user by searching their name/handle"""
    handle_query: str  # The name/handle to search for
    message: Optional[str] = None


class InviteResponse(BaseModel):
    booking_id: str
    invite_code: str
    join_url: str


class InviteCrewRequest(BaseModel):
    """Invite multiple friends to a booking/lineup session by user_id"""
    friend_ids: List[str]
    share_amount: Optional[float] = None  # If None, auto-calculated from booking total
    message: Optional[str] = None


# ============ USER BOOKINGS ============


# â•â•â• ROUTES â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

@router.get("/bookings")
async def get_all_bookings(
    user_id: Optional[str] = None,
    status: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """Get all bookings (optionally filtered by user participation)"""
    # Base query for bookings
    query = select(Booking).options(
        selectinload(Booking.photographer),
        selectinload(Booking.participants).selectinload(BookingParticipant.participant)
    )
    
    if user_id:
        # Get bookings where user is a participant
        subquery = select(BookingParticipant.booking_id).where(
            BookingParticipant.participant_id == user_id
        )
        query = query.where(Booking.id.in_(subquery))
    
    if status:
        query = query.where(Booking.status == status)
    
    query = query.order_by(Booking.session_date.desc())
    
    result = await db.execute(query)
    bookings = result.scalars().all()
    
    response = []
    for booking in bookings:
        # Count all participants (pending + confirmed) as spots filled - captain counts even if not paid
        active_participants = [p for p in booking.participants if p.status in ['pending', 'confirmed']]
        current_count = len(active_participants)
        
        # Calculate split price based on confirmed participants for payment purposes
        confirmed_count = len([p for p in booking.participants if p.status == 'confirmed'])
        split_price = booking.price_per_person
        if booking.allow_splitting and confirmed_count > 0:
            split_price = booking.total_price / max(confirmed_count, 1)
        
        # Build participants list with full details for Lineup Manager
        participants_data = []
        for participant in booking.participants:
            participants_data.append({
                "participant_id": participant.participant_id,
                "user_id": participant.participant_id,
                "name": participant.participant.full_name if participant.participant else "Unknown",
                "avatar_url": participant.participant.avatar_url if participant.participant else None,
                "username": participant.participant.username if participant.participant else None,
                "status": participant.status,
                "payment_status": participant.payment_status,
                "paid_amount": participant.paid_amount,
                "selfie_url": participant.selfie_url,  # For photographer identification
                # expires_at is tracked on BookingInvite, not BookingParticipant
                "expires_at": None
            })
        
        response.append({
            "id": booking.id,
            "photographer_id": booking.photographer_id,
            "photographer_name": booking.photographer.full_name if booking.photographer else None,
            "photographer_avatar": booking.photographer.avatar_url if booking.photographer else None,
            "location": booking.location,
            "session_date": booking.session_date.isoformat(),
            "duration": booking.duration,
            "max_participants": booking.max_participants,
            "current_participants": current_count,
            "total_price": booking.total_price,
            "split_price": split_price,
            "price_per_person": booking.price_per_person,
            "allow_splitting": booking.allow_splitting,
            "split_mode": booking.split_mode,
            "status": booking.status,
            "description": booking.description,
            "creator_id": booking.creator_id,
            "invite_code": booking.invite_code,
            # Lineup Manager fields
            "lineup_auto_confirm": booking.lineup_auto_confirm,
            "proximity_radius": booking.proximity_radius,
            "lineup_status": booking.lineup_status or 'open',
            "lineup_closes_at": booking.lineup_closes_at.isoformat() if booking.lineup_closes_at else None,
            "lineup_min_crew": booking.lineup_min_crew,
            "lineup_max_crew": booking.lineup_max_crew or booking.max_participants,
            "participants": participants_data
        })
    
    return response


# ============================================================
# PHOTOGRAPHER DIRECTORY & NEARBY — Extracted to directory.py (v96 audit)
# ============================================================




@router.get("/bookings/user/{user_id}")
async def get_user_bookings(
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get all bookings for a specific user (excludes cancelled/refunded)"""
    # Verify user exists
    user_result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = user_result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Get bookings where user is a participant and booking is not cancelled.
    # IMPORTANT: Exclude bookings where the user IS the photographer â€” those
    # belong in the photographer dashboard, not the surfer booking view.
    result = await db.execute(
        select(BookingParticipant)
        .join(Booking, BookingParticipant.booking_id == Booking.id)
        .where(
            BookingParticipant.participant_id == user_id,
            # Exclude cancelled, completed, and refunded bookings
            ~Booking.status.in_(['Cancelled', 'Refunded']),
            # Don't show bookings where user is the photographer (surfer view only)
            Booking.photographer_id != user_id
        )
        .options(
            selectinload(BookingParticipant.booking).selectinload(Booking.photographer),
            selectinload(BookingParticipant.booking).selectinload(Booking.participants).selectinload(BookingParticipant.participant)
        )
        .order_by(BookingParticipant.joined_at.desc())
    )
    participations = result.scalars().all()
    
    response = []
    for p in participations:
        booking = p.booking
        # Count all participants (pending + confirmed) as spots filled - captain counts even if not paid
        active_count = len([x for x in booking.participants if x.status in ['pending', 'confirmed']])
        
        # Build participants list with full details for Lineup Manager
        participants_data = []
        for participant in booking.participants:
            participants_data.append({
                "participant_id": participant.participant_id,
                "user_id": participant.participant_id,
                "name": participant.participant.full_name if participant.participant else "Unknown",
                "avatar_url": participant.participant.avatar_url if participant.participant else None,
                "username": participant.participant.username if participant.participant else None,
                "status": participant.status,
                "payment_status": participant.payment_status,
                "paid_amount": participant.paid_amount,
                "selfie_url": participant.selfie_url,  # For photographer identification
                # expires_at is tracked on BookingInvite, not BookingParticipant
                "expires_at": None
            })
        
        response.append({
            "id": booking.id,
            "participant_id": p.id,
            "photographer_id": booking.photographer_id,
            "photographer_name": booking.photographer.full_name if booking.photographer else None,
            "photographer_avatar": booking.photographer.avatar_url if booking.photographer else None,
            "location": booking.location,
            "session_date": booking.session_date.isoformat(),
            "duration": booking.duration,
            "status": booking.status,
            "booking_type": booking.booking_type or 'scheduled',  # 'scheduled' | 'on_demand'
            "participant_status": p.status,
            "payment_status": p.payment_status,
            "paid_amount": p.paid_amount,
            "current_participants": active_count,
            "max_participants": booking.max_participants,
            "creator_id": booking.creator_id,
            "invite_code": booking.invite_code,
            # Lineup Manager fields
            "total_price": booking.total_price,
            "price_per_person": booking.price_per_person,
            "allow_splitting": booking.allow_splitting,
            "split_mode": booking.split_mode,
            "lineup_auto_confirm": booking.lineup_auto_confirm,
            "proximity_radius": booking.proximity_radius,
            "lineup_status": booking.lineup_status or 'open',
            "lineup_closes_at": booking.lineup_closes_at.isoformat() if booking.lineup_closes_at else None,
            "lineup_min_crew": booking.lineup_min_crew,
            "lineup_max_crew": booking.lineup_max_crew or booking.max_participants,
            "participants": participants_data
        })
    
    return response


class BookingSettingsUpdate(BaseModel):
    """Update booking settings like split mode and auto-confirm"""
    split_mode: Optional[str] = None  # 'solo', 'friends_only', 'open_nearby'
    lineup_auto_confirm: Optional[bool] = None
    proximity_radius: Optional[float] = None




@router.patch("/bookings/{booking_id}")
async def update_booking_settings(
    booking_id: str,
    user_id: str,
    data: BookingSettingsUpdate,
    db: AsyncSession = Depends(get_db)
):
    """Update booking settings (split mode, auto-confirm, etc.)"""
    # Get booking
    result = await db.execute(
        select(Booking).where(Booking.id == booking_id)
    )
    booking = result.scalar_one_or_none()
    
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    
    # Check authorization - only creator or photographer can update
    if booking.creator_id != user_id and booking.photographer_id != user_id:
        raise HTTPException(status_code=403, detail="Not authorized to update this booking")
    
    # Update fields if provided
    if data.split_mode is not None:
        booking.split_mode = data.split_mode
    
    if data.lineup_auto_confirm is not None:
        booking.lineup_auto_confirm = data.lineup_auto_confirm
    
    if data.proximity_radius is not None:
        booking.proximity_radius = data.proximity_radius
    
    await db.commit()
    await db.refresh(booking)
    
    return {
        "success": True,
        "split_mode": booking.split_mode,
        "lineup_auto_confirm": booking.lineup_auto_confirm,
        "proximity_radius": booking.proximity_radius
    }



# NOTE: create_user_booking, cancel_booking, complete_booking,
# mark_content_delivered, and share_booking_to_feed have been
# extracted to booking_lifecycle.py (v85 decomposition).



# â•â•â• LIFECYCLE ENDPOINTS (extracted to booking_lifecycle.py v85) â•â•â•
# create_user_booking, cancel_booking, complete_booking,
# mark_content_delivered, share_booking_to_feed, leave_live_session
# â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• 


# share_booking_to_feed â†’ booking_lifecycle.py
# (original code removed â€” see booking_lifecycle.py)

@router.get("/bookings/{booking_id}/share-link")
async def get_booking_share_link(
    booking_id: str,
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Generate a shareable invite link for DMs (Booking â†’ Messaging cross-pollination).
    This link can be shared in messages to invite others to split the booking.
    """
    # Verify user is a participant or creator
    booking_result = await db.execute(
        select(Booking)
        .where(Booking.id == booking_id)
        .options(
            selectinload(Booking.photographer),
            selectinload(Booking.participants)
        )
    )
    booking = booking_result.scalar_one_or_none()
    
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    
    # Check if user is creator or participant
    is_participant = any(p.participant_id == user_id for p in booking.participants)
    is_creator = booking.creator_id == user_id
    
    if not is_participant and not is_creator:
        raise HTTPException(status_code=403, detail="You are not part of this booking")
    
    if not booking.allow_splitting:
        raise HTTPException(status_code=400, detail="This booking does not allow splitting")
    
    if not booking.invite_code:
        raise HTTPException(status_code=400, detail="No invite code available for this booking")
    
    # Generate shareable link data
    current_participants = len([p for p in booking.participants if p.status in ['pending', 'confirmed']])
    spots_left = booking.max_participants - current_participants
    split_price = booking.total_price / max(current_participants + 1, 1)
    
    # Format date nicely
    session_date = booking.session_date
    date_str = session_date.strftime('%b %d at %I:%M %p') if session_date else 'TBD'
    
    # Generate message text for DMs
    share_message = (
        f"ðŸ„ Join my surf session!\n"
        f"ðŸ“ {booking.location}\n"
        f"ðŸ“… {date_str}\n"
        f"ðŸ“¸ {booking.photographer.full_name if booking.photographer else 'Photographer'}\n"
        f"ðŸ’° ${split_price:.0f}/person ({spots_left} spots left)\n\n"
        f"Use code: {booking.invite_code}"
    )
    
    return {
        "invite_code": booking.invite_code,
        "share_message": share_message,
        "booking_details": {
            "location": booking.location,
            "session_date": session_date.isoformat() if session_date else None,
            "photographer_name": booking.photographer.full_name if booking.photographer else None,
            "split_price": split_price,
            "spots_left": spots_left,
            "total_spots": booking.max_participants,
            "skill_level_filter": booking.skill_level_filter
        }
    }




# nearby bookings → directory.py (v96 audit)



@router.get("/sessions/user/{user_id}")
async def get_user_live_sessions(
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get live sessions user is currently part of"""
    from models import LiveSessionParticipant
    
    result = await db.execute(
        select(LiveSessionParticipant)
        .where(LiveSessionParticipant.surfer_id == user_id)
        .where(LiveSessionParticipant.status == 'active')
        .options(
            selectinload(LiveSessionParticipant.photographer),
            selectinload(LiveSessionParticipant.spot)
        )
    )
    participants = result.scalars().all()
    
    sessions = []
    for p in participants:
        sessions.append({
            "id": p.id,
            "photographer_id": p.photographer_id,
            "photographer_name": p.photographer.full_name if p.photographer else None,
            "photographer_username": p.photographer.username if p.photographer else None,
            "photographer_avatar": p.photographer.avatar_url if p.photographer else None,
            "location": p.spot.name if p.spot else (p.photographer.location if p.photographer else "Unknown"),
            "amount_paid": p.amount_paid,
            "joined_at": p.joined_at.isoformat()
        })
    
    return sessions


@router.get("/sessions/user/{user_id}/history")
async def get_user_session_history(
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get past live sessions user participated in (completed or left).
    
    Returns session history in the same shape as booking data so the
    frontend PastTab can render them alongside scheduled booking history.
    """
    from models import LiveSessionParticipant
    
    result = await db.execute(
        select(LiveSessionParticipant)
        .where(LiveSessionParticipant.surfer_id == user_id)
        .where(LiveSessionParticipant.status.in_(['completed', 'left']))
        .options(
            selectinload(LiveSessionParticipant.photographer),
            selectinload(LiveSessionParticipant.spot)
        )
        .order_by(LiveSessionParticipant.completed_at.desc().nullslast())
        .limit(50)  # Cap to recent history
    )
    participants = result.scalars().all()
    
    sessions = []
    for p in participants:
        sessions.append({
            "id": p.id,
            "live_session_id": p.live_session_id,
            "photographer_id": p.photographer_id,
            "photographer_name": p.photographer.full_name if p.photographer else None,
            "photographer_avatar": p.photographer.avatar_url if p.photographer else None,
            "location": p.spot.name if p.spot else (p.photographer.location if p.photographer else "Unknown"),
            "session_date": (p.joined_at or p.completed_at).isoformat() if (p.joined_at or p.completed_at) else None,
            "duration": None,  # Live sessions don't have a pre-set duration
            "status": "Completed",  # All history entries are past
            "booking_type": "live",  # Differentiate from scheduled bookings
            "session_type": "live",
            "paid_amount": p.amount_paid,
            "amount_paid": p.amount_paid,
            "joined_at": p.joined_at.isoformat() if p.joined_at else None,
            "completed_at": p.completed_at.isoformat() if p.completed_at else None,
            "_source": "live_session",  # Frontend can use this to distinguish data origin
        })
    
    return sessions



# leave_live_session â†’ booking_lifecycle.py
