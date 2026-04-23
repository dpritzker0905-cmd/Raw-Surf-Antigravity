"""
bookings/crud.py — Core booking CRUD: list, get, create, cancel, complete, share, sessions
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

STRIPE_API_KEY = os.environ.get('STRIPE_SECRET_KEY') or os.environ.get('STRIPE_API_KEY')
if STRIPE_API_KEY:
    stripe.api_key = STRIPE_API_KEY

# ═══ SHARED HELPERS & MODELS ═══════════════════════════════════════════

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


# ============ PYDANTIC MODELS ============

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
    # New fields for scheduled booking flow
    apply_credits: Optional[float] = 0  # Amount of credits to apply
    impact_zone_type: Optional[str] = None  # 'gps', 'preset', 'manual'
    impact_zone_preset: Optional[str] = None  # 'home', 'parking', 'pier'


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


# ═══ ROUTES ══════════════════════════════════════════════════════════════

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


# ============ PHOTOGRAPHER DIRECTORY ============



@router.get("/photographers/directory")
async def get_photographer_directory(
    region: Optional[str] = None,
    gear_type: Optional[str] = None,
    skill_level: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = 50,
    db: AsyncSession = Depends(get_db)
):
    """
    Get list of photographers for the booking directory.
    Supports filtering by region, gear type, skill level, and search by name/username.
    """
    # Build query for photographer roles
    # Hobbyists are NOT listed in directory — they're found organically (profile visits, existing conversations)
    photographer_roles = [RoleEnum.PHOTOGRAPHER, RoleEnum.APPROVED_PRO]
    
    query = select(Profile).where(Profile.role.in_(photographer_roles))
    
    # Apply skill level filter
    if skill_level and skill_level != 'all':
        role_map = {
            'hobbyist': RoleEnum.HOBBYIST,
            'photographer': RoleEnum.PHOTOGRAPHER,
            'approved_pro': RoleEnum.APPROVED_PRO
        }
        if skill_level in role_map:
            query = query.where(Profile.role == role_map[skill_level])
    
    # Apply search filter - search by name, username, or home_break
    if search:
        search_lower = f"%{search.lower()}%"
        query = query.where(
            or_(
                func.lower(Profile.full_name).like(search_lower),
                func.lower(Profile.username).like(search_lower),
                func.lower(Profile.home_break).like(search_lower),
                func.lower(Profile.location).like(search_lower)
            )
        )
    
    # Apply region filter (if home_break contains region info)
    if region and region != 'all':
        region_keywords = {
            'ny': ['new york', 'ny', 'long island', 'rockaway'],
            'fl': ['florida', 'fl', 'cocoa', 'jacksonville', 'miami'],
            'ca': ['california', 'ca', 'huntington', 'malibu', 'san diego', 'santa cruz'],
            'hi': ['hawaii', 'hi', 'oahu', 'maui', 'pipeline', 'north shore'],
            'cr': ['costa rica', 'tamarindo', 'nosara', 'pavones'],
            'pr': ['puerto rico', 'rincon', 'aguadilla'],
            'mx': ['mexico', 'baja', 'puerto escondido', 'sayulita'],
            'id': ['indonesia', 'bali', 'mentawai', 'lombok'],
            'au': ['australia', 'gold coast', 'byron', 'sydney', 'bells']
        }
        if region in region_keywords:
            region_conditions = [
                func.lower(Profile.home_break).like(f"%{kw}%") for kw in region_keywords[region]
            ] + [
                func.lower(Profile.location).like(f"%{kw}%") for kw in region_keywords[region]
            ]
            query = query.where(or_(*region_conditions))
    
    # Order by: real users first (have username), then approved pros, then verified
    query = query.order_by(
        Profile.username.isnot(None).desc(),  # Users with usernames first
        Profile.is_approved_pro.desc(),
        Profile.is_verified.desc(),
        Profile.full_name.asc()
    ).limit(limit)
    
    result = await db.execute(query)
    photographers = result.scalars().all()
    
    # Build response
    directory = []
    for p in photographers:
        # Default gear types (will be enhanced later when fields are added to Profile)
        gear_types = ['land']  # Default assumption
        
        directory.append({
            "id": p.id,
            "full_name": p.full_name,
            "username": p.username,  # Added username for @handle display
            "avatar_url": p.avatar_url,
            "role": p.role.value if p.role else None,
            "is_approved_pro": p.is_approved_pro or False,
            "is_verified": p.is_verified or False,
            "home_break": p.home_break or p.location,
            "location": p.location,
            "region": None,  # Will be parsed from home_break
            "gear_types": gear_types,
            "avg_rating": 4.8,  # Will be calculated from reviews
            "total_sessions": 0,  # Will be calculated from bookings
            # Use booking rate hierarchy: booking_hourly_rate > hourly_rate > session_price
            "session_rate": p.booking_hourly_rate or p.hourly_rate or p.session_price,
            "hourly_rate": p.booking_hourly_rate or p.hourly_rate,
            "is_available": True,
            "is_shooting": p.is_shooting or False
        })
    
    return directory




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
    
    # Get bookings where user is a participant and booking is not cancelled
    result = await db.execute(
        select(BookingParticipant)
        .join(Booking, BookingParticipant.booking_id == Booking.id)
        .where(
            BookingParticipant.participant_id == user_id,
            # Exclude cancelled, completed, and refunded bookings
            ~Booking.status.in_(['Cancelled', 'Refunded'])
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




@router.post("/bookings/create")
async def create_user_booking(
    user_id: str,
    data: CreateUserBookingRequest,
    db: AsyncSession = Depends(get_db)
):
    """User creates a booking with a photographer - supports account credit application"""
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
    
    photographer_roles = [RoleEnum.GROM_PARENT, RoleEnum.HOBBYIST, RoleEnum.PHOTOGRAPHER, RoleEnum.APPROVED_PRO]
    if photographer.role not in photographer_roles:
        raise HTTPException(status_code=400, detail="Selected user is not a photographer")
    
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
    
    # Calculate price based on duration - MUST match frontend calculation
    # For scheduled bookings, use booking_hourly_rate as primary
    hourly_rate = photographer.booking_hourly_rate or photographer.hourly_rate or photographer.session_price or 75.0
    
    # Default: non-Hobbyist bookings auto-confirm on payment
    auto_confirm = True
    
    # ═══ HOBBYIST BOOKING GUARDRAILS ═══════════════════════════════════════
    if photographer.role == RoleEnum.HOBBYIST:
        # Load admin-adjustable settings from PlatformSettings
        from models import PlatformSettings
        settings_result = await db.execute(select(PlatformSettings).limit(1))
        platform_settings = settings_result.scalar_one_or_none()
        
        max_bookings_per_week = getattr(platform_settings, 'hobbyist_max_bookings_per_week', 3) if platform_settings else 3
        max_hourly_rate = getattr(platform_settings, 'hobbyist_max_hourly_rate', 40.0) if platform_settings else 40.0
        auto_confirm = getattr(platform_settings, 'hobbyist_booking_auto_confirm', False) if platform_settings else False
        
        # 1. Price cap: silently cap to admin-configured maximum
        if hourly_rate > max_hourly_rate:
            logger.info(f"[Hobbyist Guard] Capping hourly rate from ${hourly_rate} to ${max_hourly_rate} for photographer {photographer.id}")
            hourly_rate = max_hourly_rate
        
        # 2. Weekly booking limit
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
    # Use duration multipliers for better pricing (same as frontend)
    duration_multipliers = {60: 1, 120: 1.8, 180: 2.5, 240: 3, 480: 5}
    multiplier = duration_multipliers.get(data.duration, data.duration / 60)
    base_price = hourly_rate * multiplier
    
    # Apply group discount based on number of participants
    group_discount_percent = 0
    if data.max_participants >= 5 and (photographer.group_discount_5_plus or 0) > 0:
        group_discount_percent = photographer.group_discount_5_plus
    elif data.max_participants >= 3 and (photographer.group_discount_3_plus or 0) > 0:
        group_discount_percent = photographer.group_discount_3_plus
    elif data.max_participants >= 2 and (photographer.group_discount_2_plus or 0) > 0:
        group_discount_percent = photographer.group_discount_2_plus
    
    # Calculate discounted total
    discount_amount = (base_price * group_discount_percent) / 100
    total_price = base_price - discount_amount
    price_per_person = total_price / data.max_participants if data.max_participants > 0 else total_price
    
    # Handle credit application
    credits_applied = 0
    remaining_credits = user.credit_balance or 0
    amount_to_charge = total_price
    
    if data.apply_credits and data.apply_credits > 0:
        # Round to 2 decimal places to avoid floating point precision issues
        apply_credits_rounded = round(data.apply_credits, 2)
        total_price_rounded = round(total_price, 2)
        user_balance_rounded = round(user.credit_balance or 0, 2)
        
        # Log for debugging
        import logging
        logging.info(f"[Credit Application] Requested: {apply_credits_rounded}, Total: {total_price_rounded}, Balance: {user_balance_rounded}")
        
        # Validate user has enough credits
        if apply_credits_rounded > user_balance_rounded:
            raise HTTPException(status_code=400, detail="Insufficient credit balance")
        
        # INSTEAD of rejecting, cap credits at total price (handles rounding differences)
        credits_applied = min(apply_credits_rounded, total_price_rounded)
        amount_to_charge = round(total_price - credits_applied, 2)
        
        # Ensure amount_to_charge is never negative
        if amount_to_charge < 0:
            amount_to_charge = 0
        
        # Deduct credits from user
        success, remaining_credits, error = await deduct_credits(
            user_id=user_id,
            amount=credits_applied,
            transaction_type='booking_payment',
            db=db,
            description=f"Scheduled session with {photographer.full_name}",
            reference_type='booking',
            reference_id=None,  # Will update after booking created
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
    # DO NOT credit photographer immediately - funds go to escrow
    if credits_applied >= total_price:
        booking.escrow_amount = total_price * 0.80  # 80% after platform fee
        booking.escrow_status = 'held'
        # Note: Photographer will be credited when:
        # 1. Booking status changes to 'Completed'
        # 2. content_delivered = True (photographer uploads to gallery)
    
    # Format session time for notifications
    session_time_str = session_date.strftime('%b %d at %I:%M %p')
    
    # Create in-app notification for photographer
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
    
    # Send push notification to photographer
    try:
        await notify_booking(
            user_id=data.photographer_id,
            title='New Booking!' if credits_applied >= total_price else 'New Booking Request',
            message=f'{user.full_name} booked a session on {session_time_str} at {data.location}',
            db=db
        )
    except Exception as e:
        logger.warning(f"Failed to send booking push notification: {e}")
    
    # Create confirmation notification for surfer
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
    
    # Send push notification to surfer
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


class CancelBookingRequest(BaseModel):
    reason: Optional[str] = None




@router.post("/bookings/{booking_id}/cancel")
async def cancel_booking(
    booking_id: str,
    user_id: str,
    data: CancelBookingRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Cancel a booking with refund based on cancellation policy:
    - >48 hours before session: 90% refund
    - 24-48 hours before session: 50% refund
    - <24 hours before session: 0% refund (no refund)
    
    Refund goes to user's Account Credit balance.
    """
    from routes.push import notify_booking
    
    # Get booking
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
    
    # Verify user is the creator or photographer
    if booking.creator_id != user_id and booking.photographer_id != user_id:
        raise HTTPException(status_code=403, detail="Not authorized to cancel this booking")
    
    if booking.status in ['Cancelled', 'Completed']:
        raise HTTPException(status_code=400, detail=f"Booking already {booking.status.lower()}")
    
    # Calculate time until session
    now = datetime.now(timezone.utc)
    session_time = booking.session_date
    if session_time.tzinfo is None:
        session_time = session_time.replace(tzinfo=timezone.utc)
    
    hours_until_session = (session_time - now).total_seconds() / 3600
    
    # Determine refund percentage based on cancellation policy
    if hours_until_session > 48:
        refund_percentage = 90
    elif hours_until_session > 24:
        refund_percentage = 50
    else:
        refund_percentage = 0
    
    # Calculate refund amount
    # If photographer cancels, surfer gets full refund
    is_photographer_cancelling = (booking.photographer_id == user_id)
    if is_photographer_cancelling:
        refund_percentage = 100  # Full refund if photographer cancels
    
    # Find total amount paid by surfer(s)
    total_paid = sum(p.paid_amount or 0 for p in booking.participants)
    refund_amount = (total_paid * refund_percentage) / 100
    
    # Update booking status
    booking.status = 'Cancelled'
    booking.cancelled_at = now
    booking.cancellation_reason = data.reason
    booking.refund_amount = refund_amount
    booking.refund_percentage = refund_percentage
    
    # Release escrow (funds were never sent to photographer)
    if booking.escrow_status == 'held':
        booking.escrow_status = 'refunded'
    
    # Refund to surfer's credit balance
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
    
    # Notify parties
    photographer_name = booking.photographer.full_name if booking.photographer else "Photographer"
    session_time_str = booking.session_date.strftime('%b %d at %I:%M %p')
    
    if is_photographer_cancelling:
        # Notify surfer that photographer cancelled
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
        # Notify photographer that surfer cancelled
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




@router.post("/bookings/{booking_id}/complete")
async def complete_booking(
    booking_id: str,
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Mark booking as completed (typically by photographer after session).
    Auto-creates gallery with booking pricing via the gallery sync service.
    Content must be delivered before escrow is released.
    """
    from services.gallery_sync import create_session_gallery, check_gallery_exists_for_session
    
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
    
    # Only photographer can mark as completed
    if booking.photographer_id != user_id:
        raise HTTPException(status_code=403, detail="Only photographer can mark booking as completed")
    
    if booking.status == 'Completed':
        raise HTTPException(status_code=400, detail="Booking already completed")
    
    if booking.status == 'Cancelled':
        raise HTTPException(status_code=400, detail="Cannot complete a cancelled booking")
    
    booking.status = 'Completed'
    
    # Check if content is already delivered - if so, release escrow
    if booking.content_delivered and booking.escrow_status == 'held':
        await release_escrow(booking, db)
    
    await db.flush()
    
    # Check if gallery already exists for this booking (idempotency)
    gallery_exists = await check_gallery_exists_for_session(db, booking_id=booking_id)
    
    # Collect participant IDs
    participant_ids = [p.participant_id for p in booking.participants if p.has_paid]
    
    # Auto-create Gallery with booking-specific pricing
    gallery_result = None
    if not gallery_exists and not booking.is_on_demand:  # On-demand sessions create gallery via dispatch route
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
        
        # Notify all participants that their gallery is ready
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
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Mark content as delivered (photographer uploaded to gallery).
    If booking is completed, this triggers escrow release.
    """
    result = await db.execute(
        select(Booking).where(Booking.id == booking_id)
        .options(selectinload(Booking.photographer))
    )
    booking = result.scalar_one_or_none()
    
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    
    # Only photographer can mark content as delivered
    if booking.photographer_id != user_id:
        raise HTTPException(status_code=403, detail="Only photographer can mark content as delivered")
    
    booking.content_delivered = True
    booking.content_delivered_at = datetime.now(timezone.utc)
    
    # If booking is completed and content delivered, release escrow
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
    user_id: str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    """
    Share a scheduled booking as a Session Log in the feed.
    Allows friends to join/split the session directly from the feed.
    """
    from models import Post
    
    # Get booking with creator and photographer info
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
    
    # Check if already shared
    existing_post = await db.execute(
        select(Post).where(
            Post.author_id == user_id,
            Post.booking_id == booking_id
        )
    )
    if existing_post.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Session already posted to feed")
    
    # Get creator profile
    creator = await db.execute(select(Profile).where(Profile.id == user_id))
    creator = creator.scalar_one_or_none()
    
    # Create session log post
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




@router.get("/bookings/{booking_id}/share-link")
async def get_booking_share_link(
    booking_id: str,
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Generate a shareable invite link for DMs (Booking → Messaging cross-pollination).
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
        f"🏄 Join my surf session!\n"
        f"📍 {booking.location}\n"
        f"📅 {date_str}\n"
        f"📸 {booking.photographer.full_name if booking.photographer else 'Photographer'}\n"
        f"💰 ${split_price:.0f}/person ({spots_left} spots left)\n\n"
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




@router.get("/bookings/nearby")
async def get_nearby_open_bookings(
    latitude: float,
    longitude: float,
    radius: float = Query(default=5.0, description="Radius in miles"),
    skill_level: Optional[str] = Query(default=None, description="Filter by skill level (Beginner, Intermediate, Advanced, Expert)"),
    user_id: Optional[str] = Query(default=None, description="User ID for skill matching"),
    db: AsyncSession = Depends(get_db)
):
    """Find open bookings nearby that allow strangers to join, optionally filtered by skill level"""
    # Get user skill level if user_id provided
    user_skill = None
    if user_id:
        user_result = await db.execute(select(Profile).where(Profile.id == user_id))
        user = user_result.scalar_one_or_none()
        if user:
            user_skill = user.skill_level
    
    # Get bookings with open_nearby or skill_match mode
    result = await db.execute(
        select(Booking)
        .where(Booking.allow_splitting.is_(True))
        .where(Booking.split_mode.in_(['open_nearby', 'skill_match']))
        .where(Booking.status.in_(['Pending', 'Confirmed']))
        .where(Booking.session_date > datetime.now(timezone.utc))
        .options(
            selectinload(Booking.photographer),
            selectinload(Booking.participants).selectinload(BookingParticipant.participant),
            selectinload(Booking.creator)
        )
    )
    bookings = result.scalars().all()
    
    nearby_bookings = []
    for booking in bookings:
        if not booking.latitude or not booking.longitude:
            continue
        
        # Calculate distance
        lat_diff = abs(latitude - booking.latitude) * 69
        lon_diff = abs(longitude - booking.longitude) * 69 * math.cos(math.radians(latitude))
        distance = math.sqrt(lat_diff**2 + lon_diff**2)
        
        # Check if within radius and booking's proximity radius
        max_radius = min(radius, booking.proximity_radius or 5.0)
        if distance > max_radius:
            continue
        
        # Skill level filtering
        # If booking has a skill filter, only show to matching skill levels
        if booking.skill_level_filter:
            # If user skill doesn't match booking filter, skip
            if skill_level and skill_level != booking.skill_level_filter:
                continue
            if user_skill and user_skill != booking.skill_level_filter:
                continue
        
        # If explicit skill_level param is provided, filter bookings
        if skill_level:
            # Show bookings that either have no filter or match the requested skill
            if booking.skill_level_filter and booking.skill_level_filter != skill_level:
                continue
        
        # Check if has room
        confirmed_count = len([p for p in booking.participants if p.status in ['pending', 'confirmed']])
        if confirmed_count >= booking.max_participants:
            continue
        
        split_price = booking.total_price / (confirmed_count + 1)
        
        # Get participant skill levels for display
        participant_skills = []
        for p in booking.participants:
            if p.status in ['pending', 'confirmed'] and p.participant:
                participant_skills.append({
                    "name": p.participant.full_name,
                    "skill_level": p.participant.skill_level or "Unknown",
                    "avatar_url": p.participant.avatar_url
                })
        
        # Get creator skill level
        creator_skill = booking.creator.skill_level if booking.creator else None
        
        nearby_bookings.append({
            "id": booking.id,
            "photographer_name": booking.photographer.full_name if booking.photographer else None,
            "photographer_avatar": booking.photographer.avatar_url if booking.photographer else None,
            "creator_name": booking.creator.full_name if booking.creator else None,
            "creator_skill": creator_skill,
            "location": booking.location,
            "session_date": booking.session_date.isoformat(),
            "distance": round(distance, 1),
            "current_participants": confirmed_count,
            "max_participants": booking.max_participants,
            "split_price": split_price,
            "description": booking.description,
            "skill_level_filter": booking.skill_level_filter,
            "participant_skills": participant_skills,
            "split_mode": booking.split_mode
        })
    
    # Sort by distance
    nearby_bookings.sort(key=lambda x: x["distance"])
    
    return nearby_bookings




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




@router.post("/sessions/leave/{session_id}")
async def leave_live_session(
    session_id: str,
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Allow user to leave a live session early. Auto-refund if within 10 minutes."""
    from models import LiveSessionParticipant, Profile
    
    result = await db.execute(
        select(LiveSessionParticipant)
        .where(LiveSessionParticipant.id == session_id)
        .where(LiveSessionParticipant.surfer_id == user_id)
        .where(LiveSessionParticipant.status == 'active')
    )
    participant = result.scalar_one_or_none()
    
    if not participant:
        raise HTTPException(status_code=404, detail="Session not found or already ended")
    
    # Check if within 10 minute refund window
    now = datetime.now(timezone.utc)
    joined_at = participant.joined_at
    if joined_at.tzinfo is None:
        joined_at = joined_at.replace(tzinfo=timezone.utc)
    
    time_in_session = (now - joined_at).total_seconds() / 60  # minutes
    
    refund_amount = 0
    refund_applied = False
    
    # Auto-refund if left within 10 minutes
    if time_in_session < 10 and participant.amount_paid and participant.amount_paid > 0:
        refund_amount = participant.amount_paid
        
        # Get surfer profile and add credits back
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
        # Refresh to get updated balance
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


