"""
User booking routes - joining sessions, inviting friends, managing bookings
Credit system: 1 Credit = $1
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

# WebSocket broadcasts for real-time updates
from websocket_manager import broadcast_earnings_update

# OneSignal push notifications
try:
    from services.onesignal_service import onesignal_service
except ImportError:
    onesignal_service = None

router = APIRouter()
logger = logging.getLogger(__name__)

STRIPE_API_KEY = os.environ.get('STRIPE_SECRET_KEY') or os.environ.get('STRIPE_API_KEY')
if STRIPE_API_KEY:
    stripe.api_key = STRIPE_API_KEY


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


# ============ USER BOOKINGS ============

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
    photographer_roles = [RoleEnum.HOBBYIST, RoleEnum.PHOTOGRAPHER, RoleEnum.APPROVED_PRO]
    
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
    
    # Calculate group-discounted total
    discount_amount = (base_price * group_discount_percent) / 100
    total_price = base_price - discount_amount
    
    # Apply photographer-specific subscription discount (stacks with group discount, capped at 50%)
    from routes.photo_subscriptions import get_subscription_discount, try_use_subscription_quota
    subscription_discount_pct = await get_subscription_discount(
        db, user_id, data.photographer_id, service_type='booking'
    )
    subscription_covered = False
    if subscription_discount_pct > 0:
        # Cap combined discount at 50% of base price
        max_sub_discount = (base_price * 0.50) - discount_amount
        sub_discount = min((base_price * subscription_discount_pct / 100), max(max_sub_discount, 0))
        total_price = total_price - sub_discount
    
    # Try to use subscription session quota (free booking if quota available)
    sub_quota_result = await try_use_subscription_quota(
        db, user_id, data.photographer_id, 'session'
    )
    if sub_quota_result.get("used", False):
        subscription_covered = True
        total_price = 0.0
    
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
        status='Confirmed' if credits_applied >= total_price else 'Pending'
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
        "escrow_amount": booking.escrow_amount,
        "subscription_discount_pct": subscription_discount_pct,
        "subscription_covered": subscription_covered,
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


@router.post("/bookings/{booking_id}/request-join")
async def request_join_session(
    booking_id: str,
    user_id: str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    """
    Request to join a session from the Feed.
    Creates a join request notification for the session captain.
    """
    # Get booking
    result = await db.execute(
        select(Booking).where(Booking.id == booking_id)
        .options(selectinload(Booking.participants))
    )
    booking = result.scalar_one_or_none()
    
    if not booking:
        raise HTTPException(status_code=404, detail="Session not found")
    
    if booking.creator_id == user_id:
        raise HTTPException(status_code=400, detail="You're already the captain of this session")
    
    # Check if already a participant
    existing = next((p for p in booking.participants if p.participant_id == user_id), None)
    if existing:
        raise HTTPException(status_code=400, detail="You're already part of this session")
    
    # Check spots available
    current_participants = len([p for p in booking.participants if p.status in ['pending', 'confirmed']])
    if current_participants >= booking.max_participants:
        raise HTTPException(status_code=400, detail="This session is full")
    
    # Get requester profile
    requester = await db.execute(select(Profile).where(Profile.id == user_id))
    requester = requester.scalar_one_or_none()
    requester_name = requester.full_name if requester else "Someone"
    
    # Add as pending participant
    participant = BookingParticipant(
        booking_id=booking_id,
        participant_id=user_id,
        status='pending',
        payment_status='Pending',
        share_amount=booking.price_per_person or 0
    )
    db.add(participant)
    
    # Create notification for captain
    notification = Notification(
        user_id=booking.creator_id,
        type='join_request',
        title='Join Request',
        body=f'{requester_name} wants to join your surf session at {booking.location}',
        data=json.dumps({
            "booking_id": booking_id,
            "requester_id": user_id,
            "requester_name": requester_name,
            "share_amount": booking.price_per_person
        })
    )
    db.add(notification)
    
    await db.commit()
    
    return {
        "message": "Join request sent to session captain",
        "booking_id": booking_id,
        "status": "pending"
    }


async def release_escrow(booking: Booking, db: AsyncSession):
    """
    Internal helper to release escrow funds to photographer.
    Called when: booking is Completed AND content is delivered.
    """
    if booking.escrow_status != 'held' or booking.escrow_amount <= 0:
        return
    
    # Credit photographer
    await add_credits(
        user_id=booking.photographer_id,
        amount=booking.escrow_amount,
        transaction_type='booking_earning',
        db=db,
        description="Escrow released for completed booking",
        reference_type='booking',
        reference_id=booking.id,
        counterparty_id=booking.creator_id
    )
    
    booking.escrow_status = 'released'
    booking.escrow_released_at = datetime.now(timezone.utc)
    
    # Notify photographer
    notification = Notification(
        user_id=booking.photographer_id,
        type='escrow_released',
        title='Payment Released!',
        body=f'${booking.escrow_amount:.2f} has been added to your account for completed booking.',
        data=json.dumps({
            "booking_id": booking.id,
            "amount": booking.escrow_amount
        })
    )
    db.add(notification)


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
    
    # Apply photographer-specific subscription discount for Stripe quick-book
    from routes.photo_subscriptions import get_subscription_discount, try_use_subscription_quota
    subscription_discount_pct = await get_subscription_discount(
        db, user_id, data.photographer_id, service_type='booking'
    )
    if subscription_discount_pct > 0:
        effective_discount = min(subscription_discount_pct / 100.0, 0.50)
        total_price = total_price * (1 - effective_discount)
    
    # Try subscription session quota (free booking if available)
    sub_quota_result = await try_use_subscription_quota(
        db, user_id, data.photographer_id, 'session'
    )
    if sub_quota_result.get("used", False):
        total_price = 0.0
    
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


@router.post("/bookings/{booking_id}/invite")
async def invite_friend_to_booking(
    booking_id: str,
    user_id: str,
    data: InviteFriendRequest,
    db: AsyncSession = Depends(get_db)
):
    """Invite a friend to join the booking"""
    # Verify user is a participant
    participant_result = await db.execute(
        select(BookingParticipant)
        .where(BookingParticipant.booking_id == booking_id)
        .where(BookingParticipant.participant_id == user_id)
    )
    participant = participant_result.scalar_one_or_none()
    if not participant:
        raise HTTPException(status_code=403, detail="You are not a participant in this booking")
    
    # Verify friend exists
    friend_result = await db.execute(select(Profile).where(Profile.id == data.friend_id))
    friend = friend_result.scalar_one_or_none()
    if not friend:
        raise HTTPException(status_code=404, detail="Friend not found")
    
    # Get booking
    booking_result = await db.execute(
        select(Booking).where(Booking.id == booking_id)
        .options(selectinload(Booking.participants))
    )
    booking = booking_result.scalar_one_or_none()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    
    if not booking.allow_splitting:
        raise HTTPException(status_code=400, detail="This booking does not allow splitting")
    
    # Check if friend is already invited or a participant
    existing = [p for p in booking.participants if p.participant_id == data.friend_id]
    if existing:
        raise HTTPException(status_code=400, detail="Friend is already a participant")
    
    # Check for existing invite
    existing_invite = await db.execute(
        select(BookingInvite)
        .where(BookingInvite.booking_id == booking_id)
        .where(BookingInvite.invitee_id == data.friend_id)
        .where(BookingInvite.status == 'pending')
    )
    if existing_invite.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Friend already has a pending invite")
    
    # Get inviter info
    inviter_result = await db.execute(select(Profile).where(Profile.id == user_id))
    inviter = inviter_result.scalar_one_or_none()
    
    # Create invite
    invite = BookingInvite(
        booking_id=booking_id,
        inviter_id=user_id,
        invitee_id=data.friend_id,
        message=data.message
    )
    db.add(invite)
    
    # Notify friend
    notification = Notification(
        user_id=data.friend_id,
        type='booking_invite',
        title='Session Invite',
        body=f'{inviter.full_name if inviter else "Someone"} invited you to split a surf session!',
        data=json.dumps({
            "booking_id": booking_id,
            "invite_id": invite.id,
            "inviter_name": inviter.full_name if inviter else None,
            "location": booking.location,
            "session_date": booking.session_date.isoformat()
        })
    )
    db.add(notification)
    
    await db.commit()
    
    return {
        "message": f"Invite sent to {friend.full_name}",
        "invite_id": invite.id
    }


class SendCrewRequestsPayload(BaseModel):
    crew_members: List[CrewMember]
    price_per_person: float
    payment_deadline: Optional[str] = None
    session_date: str
    photographer_name: str


@router.post("/bookings/{booking_id}/send-crew-requests")
async def send_crew_payment_requests(
    booking_id: str,
    user_id: str,
    data: SendCrewRequestsPayload,
    db: AsyncSession = Depends(get_db)
):
    """
    Send payment requests to crew members for a split booking.
    Creates notifications and optionally a group chat thread.
    """
    # Verify booking exists and user is the creator
    booking_result = await db.execute(
        select(Booking).where(Booking.id == booking_id)
        .options(selectinload(Booking.photographer), selectinload(Booking.participants))
    )
    booking = booking_result.scalar_one_or_none()
    
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    
    if booking.creator_id != user_id:
        raise HTTPException(status_code=403, detail="Only the booking creator can send crew requests")
    
    # Get creator's profile
    creator_result = await db.execute(select(Profile).where(Profile.id == user_id))
    creator = creator_result.scalar_one_or_none()
    
    sent_to = []
    
    for crew_member in data.crew_members:
        # Create booking participant if not exists
        existing_participant = next(
            (p for p in booking.participants if p.participant_id == crew_member.user_id),
            None
        )
        
        if not existing_participant:
            participant = BookingParticipant(
                booking_id=booking_id,
                participant_id=crew_member.user_id,
                status='invited',
                payment_status='Pending',
                share_amount=crew_member.share_amount
            )
            db.add(participant)
        
        # Create payment request notification
        notification = Notification(
            user_id=crew_member.user_id,
            type='crew_payment_request',
            title='Crew Payment Request',
            body=f'{creator.full_name if creator else "Your friend"} invited you to a surf session. Pay ${crew_member.share_amount:.2f} to join!',
            data=json.dumps({
                "booking_id": booking_id,
                "captain_id": user_id,
                "captain_name": creator.full_name if creator else None,
                "share_amount": crew_member.share_amount,
                "payment_deadline": data.payment_deadline,
                "session_date": data.session_date,
                "photographer_name": data.photographer_name,
                "location": booking.location
            })
        )
        db.add(notification)
        sent_to.append(crew_member.name)
    
    # Create or get group chat for this booking
    try:
        # Check if conversation already exists
        existing_conv_result = await db.execute(
            select(Conversation).where(Conversation.booking_id == booking_id)
        )
        conversation = existing_conv_result.scalar_one_or_none()
        
        if not conversation:
            # Create new group conversation
            conversation = Conversation(
                booking_id=booking_id,
                is_group=True,
                name=f"Session at {booking.location}"
            )
            db.add(conversation)
            await db.flush()
            
            # Add captain as participant
            captain_participant = ConversationParticipant(
                conversation_id=conversation.id,
                user_id=user_id
            )
            db.add(captain_participant)
            
            # Add photographer if exists
            if booking.photographer_id:
                photographer_participant = ConversationParticipant(
                    conversation_id=conversation.id,
                    user_id=booking.photographer_id
                )
                db.add(photographer_participant)
            
            # Add all crew members
            for crew_member in data.crew_members:
                crew_participant = ConversationParticipant(
                    conversation_id=conversation.id,
                    user_id=crew_member.user_id
                )
                db.add(crew_participant)
            
            # Send initial message
            initial_message = Message(
                conversation_id=conversation.id,
                sender_id=user_id,
                content=f"🏄 Session booked! {data.photographer_name} will be shooting at {booking.location} on {data.session_date}. Crew members: please pay your share (${data.crew_members[0].share_amount:.2f} each) to confirm your spot!"
            )
            db.add(initial_message)
    except Exception as e:
        logging.warning(f"Failed to create group chat: {e}")
    
    # Update booking with payment window
    if data.payment_deadline:
        booking.payment_window_expires_at = datetime.fromisoformat(data.payment_deadline.replace('Z', '+00:00'))
    
    await db.commit()
    
    return {
        "success": True,
        "message": f"Payment requests sent to {len(sent_to)} crew members",
        "sent_to": sent_to,
        "conversation_id": conversation.id if conversation else None
    }


@router.get("/bookings/{booking_id}/search-users")
async def search_users_for_invite(
    booking_id: str,
    query: str,
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Search users by name/handle for booking invite (autocomplete).
    Returns users matching the query, prioritizing followers and friends.
    """
    from models import Follow
    
    if not query or len(query) < 2:
        return []
    
    # Verify user is part of this booking
    booking_result = await db.execute(
        select(Booking).where(Booking.id == booking_id)
        .options(selectinload(Booking.participants))
    )
    booking = booking_result.scalar_one_or_none()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    
    is_participant = any(p.participant_id == user_id for p in booking.participants)
    is_creator = booking.creator_id == user_id
    if not is_participant and not is_creator:
        raise HTTPException(status_code=403, detail="You are not part of this booking")
    
    query_lower = query.lower().strip()
    results = []
    existing_participant_ids = {p.participant_id for p in booking.participants}
    existing_participant_ids.add(user_id)  # Exclude current user
    
    # Priority 1: Search users the current user follows
    # Remove @ if present for username matching
    clean_query = query_lower.lstrip('@')
    
    follows_result = await db.execute(
        select(Profile).join(
            Follow, Follow.following_id == Profile.id
        ).where(
            Follow.follower_id == user_id,
            Profile.id.notin_(existing_participant_ids),
            or_(
                Profile.full_name.ilike(f'%{query_lower}%'),
                Profile.username.ilike(f'%{clean_query}%')
            )
        ).limit(5)
    )
    for user_profile in follows_result.scalars().all():
        results.append({
            'user_id': user_profile.id,
            'full_name': user_profile.full_name,
            'username': user_profile.username,  # Use actual username from DB
            'avatar_url': user_profile.avatar_url,
            'handle': f"@{user_profile.username}" if user_profile.username else user_profile.full_name,
            'is_following': True
        })
    
    # Priority 2: Search all users if need more results
    if len(results) < 8:
        remaining = 8 - len(results)
        existing_ids = {r['user_id'] for r in results} | existing_participant_ids
        
        all_result = await db.execute(
            select(Profile).where(
                Profile.id.notin_(existing_ids),
                or_(
                    Profile.full_name.ilike(f'%{query_lower}%'),
                    Profile.username.ilike(f'%{clean_query}%')
                )
            ).limit(remaining)
        )
        for user_profile in all_result.scalars().all():
            results.append({
                'user_id': user_profile.id,
                'full_name': user_profile.full_name,
                'username': user_profile.username,  # Use actual username from DB
                'avatar_url': user_profile.avatar_url,
                'handle': f"@{user_profile.username}" if user_profile.username else user_profile.full_name,
                'is_following': False
            })
    
    return results


@router.post("/bookings/{booking_id}/invite-by-handle")
async def invite_user_by_handle(
    booking_id: str,
    user_id: str,
    data: InviteByHandleRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Invite a user to a booking by searching their name/handle.
    Sends an in-app notification with a link to the booking details page.
    """
    # Verify user is a participant or creator
    booking_result = await db.execute(
        select(Booking).where(Booking.id == booking_id)
        .options(selectinload(Booking.participants))
    )
    booking = booking_result.scalar_one_or_none()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    
    is_participant = any(p.participant_id == user_id for p in booking.participants)
    is_creator = booking.creator_id == user_id
    if not is_participant and not is_creator:
        raise HTTPException(status_code=403, detail="You are not a participant in this booking")
    
    if not booking.allow_splitting:
        raise HTTPException(status_code=400, detail="This booking does not allow splitting")
    
    # Search for user by full_name OR username
    query_lower = data.handle_query.lower().strip()
    # Remove @ if present for username matching
    clean_query = query_lower.lstrip('@')
    
    friend_result = await db.execute(
        select(Profile).where(
            or_(
                Profile.full_name.ilike(f'%{query_lower}%'),
                Profile.username.ilike(f'%{clean_query}%')
            )
        ).limit(1)
    )
    friend = friend_result.scalar_one_or_none()
    
    if not friend:
        raise HTTPException(status_code=404, detail=f"No user found matching '{data.handle_query}'")
    
    # Check if friend is already a participant
    existing = [p for p in booking.participants if p.participant_id == friend.id]
    if existing:
        raise HTTPException(status_code=400, detail="This user is already a participant")
    
    # Check for existing pending invite
    existing_invite = await db.execute(
        select(BookingInvite)
        .where(BookingInvite.booking_id == booking_id)
        .where(BookingInvite.invitee_id == friend.id)
        .where(BookingInvite.status == 'pending')
    )
    if existing_invite.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="This user already has a pending invite")
    
    # Get inviter info
    inviter_result = await db.execute(select(Profile).where(Profile.id == user_id))
    inviter = inviter_result.scalar_one_or_none()
    
    # Create invite record with 24-hour expiration
    invite_expires = datetime.now(timezone.utc) + timedelta(hours=24)
    
    invite = BookingInvite(
        booking_id=booking_id,
        inviter_id=user_id,
        invitee_id=friend.id,
        message=data.message,
        expires_at=invite_expires,
        invite_source='direct'
    )
    db.add(invite)
    
    # Create in-app notification with deep link to booking
    notification = Notification(
        user_id=friend.id,
        type='booking_invite',
        title='Session Invite',
        body=f'{inviter.full_name if inviter else "Someone"} invited you to join a surf session at {booking.location}!',
        data=json.dumps({
            "booking_id": booking_id,
            "invite_id": invite.id,
            "inviter_name": inviter.full_name if inviter else None,
            "inviter_avatar": inviter.avatar_url if inviter else None,
            "location": booking.location,
            "session_date": booking.session_date.isoformat() if booking.session_date else None,
            "message": data.message,
            "deep_link": f"/bookings?highlight={booking_id}"
        })
    )
    db.add(notification)
    
    await db.commit()
    
    # Send push notification via OneSignal
    if onesignal_service and friend.id:
        try:
            await onesignal_service.send_notification(
                external_user_ids=[friend.id],
                title="🏄 Session Invite!",
                message=f'{inviter.full_name if inviter else "Someone"} invited you to join a surf session at {booking.location}!',
                data={
                    "type": "booking_invite",
                    "booking_id": booking_id,
                    "invite_id": invite.id,
                    "deep_link": f"/bookings?highlight={booking_id}"
                }
            )
        except Exception as e:
            logger.error(f"Failed to send push notification for invite: {e}")
    
    # Also send a direct message to the invitee with the invite
    try:
        # Find existing conversation between inviter and invitee
        conv_result = await db.execute(
            select(Conversation)
            .where(
                or_(
                    and_(
                        Conversation.participant_one_id == user_id,
                        Conversation.participant_two_id == friend.id
                    ),
                    and_(
                        Conversation.participant_one_id == friend.id,
                        Conversation.participant_two_id == user_id
                    )
                )
            )
        )
        conversation = conv_result.scalar_one_or_none()
        
        if not conversation:
            # Create new conversation
            conversation = Conversation(
                participant_one_id=user_id,
                participant_two_id=friend.id,
                status_for_one='primary',
                status_for_two='primary'
            )
            db.add(conversation)
            await db.flush()
        
        # Create the invite message
        invite_message = f"🏄 I'm inviting you to join my surf session!\n\n📍 {booking.location}\n📅 {booking.session_date.strftime('%B %d, %Y') if booking.session_date else 'TBD'}"
        if data.message:
            invite_message += f"\n\n💬 {data.message}"
        invite_message += "\n\n👆 Tap the notification or check your Bookings to respond!"
        
        message = Message(
            conversation_id=conversation.id,
            sender_id=user_id,
            content=invite_message,
            message_type='text'
        )
        db.add(message)
        
        # Update conversation last message
        conversation.last_message_at = datetime.now(timezone.utc)
        conversation.last_message_preview = "🏄 Session invite"
        
        await db.commit()
        logger.info(f"DM sent to {friend.full_name} for booking invite")
    except Exception as e:
        logger.error(f"Failed to send DM for booking invite: {e}")
    
    return {
        "success": True,
        "message": f"Invite sent to {friend.full_name}",
        "invite_id": invite.id,
        "invitee": {
            "id": friend.id,
            "full_name": friend.full_name,
            "avatar_url": friend.avatar_url
        }
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


@router.post("/bookings/invites/{invite_id}/respond")
async def respond_to_invite(
    invite_id: str,
    user_id: str,
    accept: bool,
    db: AsyncSession = Depends(get_db)
):
    """Accept or decline a booking invite - charges credits on accept"""
    # Get invite
    invite_result = await db.execute(
        select(BookingInvite).where(BookingInvite.id == invite_id)
        .options(
            selectinload(BookingInvite.booking).selectinload(Booking.photographer),
            selectinload(BookingInvite.booking).selectinload(Booking.participants)
        )
    )
    invite = invite_result.scalar_one_or_none()
    
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found")
    
    if invite.invitee_id != user_id:
        raise HTTPException(status_code=403, detail="This invite is not for you")
    
    if invite.status != 'pending':
        raise HTTPException(status_code=400, detail="This invite has already been responded to")
    
    # Get user
    user_result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = user_result.scalar_one_or_none()
    
    invite.status = 'accepted' if accept else 'declined'
    invite.responded_at = datetime.now(timezone.utc)
    
    amount_paid = 0
    new_balance = None
    
    if accept:
        booking = invite.booking
        
        # Calculate price per person
        split_price = booking.price_per_person or (booking.total_price / booking.max_participants)
        
        # Process payment
        success, new_balance, error = await deduct_credits(
            user_id=user_id,
            amount=split_price,
            transaction_type='booking_payment',
            db=db,
            description=f"Accepted invite to session at {booking.location}",
            reference_type='booking',
            reference_id=booking.id,
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
            description=f"Booking payment from {user.full_name} (via invite)",
            reference_type='booking',
            reference_id=booking.id,
            counterparty_id=user_id
        )
        
        amount_paid = split_price
        
        # Add as participant
        participant = BookingParticipant(
            booking_id=invite.booking_id,
            participant_id=user_id,
            invited_by_id=invite.inviter_id,
            invite_type='friend_invite',
            paid_amount=split_price,
            payment_status='Paid',
            payment_method='credits',
            status='confirmed'
        )
        db.add(participant)
        
        # Notify inviter
        notification = Notification(
            user_id=invite.inviter_id,
            type='invite_accepted',
            title='Invite Accepted',
            body=f'{user.full_name if user else "Someone"} accepted your session invite and paid ${split_price:.2f}!',
            data=json.dumps({"booking_id": invite.booking_id})
        )
        db.add(notification)
        
        # Notify photographer
        notification = Notification(
            user_id=booking.photographer_id,
            type='booking_payment_received',
            title='New Booking Payment',
            body=f'{user.full_name} paid ${split_price:.2f} to join your session',
            data=json.dumps({"booking_id": booking.id, "amount": split_price})
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
                "booking_id": booking.id,
                "source": "invite_accepted"
            }
        )
    
    await db.commit()
    
    return {
        "message": "Invite accepted" if accept else "Invite declined",
        "status": invite.status,
        "amount_paid": amount_paid,
        "new_balance": new_balance
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


@router.get("/bookings/lineups")
async def get_user_lineups(
    user_id: str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    """
    Get all lineups relevant to the user:
    - Lineups they created (as captain)
    - Lineups they've joined
    - Open lineups from friends or nearby
    """
    # Get user's location for nearby lineups
    user_result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = user_result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Get user's friends (mutual followers)
    from models import Friend, FriendshipStatusEnum
    friends_result = await db.execute(
        select(Friend.requester_id, Friend.addressee_id).where(
            and_(
                or_(Friend.requester_id == user_id, Friend.addressee_id == user_id),
                Friend.status == FriendshipStatusEnum.ACCEPTED
            )
        )
    )
    friend_ids = set()
    for row in friends_result:
        if row.requester_id == user_id:
            friend_ids.add(row.addressee_id)
        else:
            friend_ids.add(row.requester_id)
    
    # Query bookings that can be lineups:
    # 1. Any booking with lineup_status in ['open', 'filling', 'ready']
    # 2. OR any booking created by user with max_participants > 1 and crew-splittable
    lineup_query = select(Booking).where(
        and_(
            Booking.status.in_(['Pending', 'PendingPayment', 'Confirmed']),
            or_(
                # Traditional lineup statuses
                Booking.lineup_status.in_(['open', 'filling', 'ready']),
                # OR: User's own bookings with crew split enabled (max > 1 and invite code exists)
                and_(
                    Booking.creator_id == user_id,
                    Booking.max_participants > 1,
                    Booking.invite_code.isnot(None)
                )
            )
        )
    ).options(
        selectinload(Booking.photographer),
        selectinload(Booking.participants).selectinload(BookingParticipant.participant),
        selectinload(Booking.creator)
    ).order_by(Booking.session_date.asc())
    
    result = await db.execute(lineup_query)
    all_lineups = result.scalars().all()
    
    # Filter to relevant lineups
    relevant_lineups = []
    for lineup in all_lineups:
        # Always show own lineups
        if lineup.creator_id == user_id:
            relevant_lineups.append(lineup)
            continue
        
        # Show lineups user has joined
        if any(p.participant_id == user_id for p in lineup.participants):
            relevant_lineups.append(lineup)
            continue
        
        # Show open lineups based on visibility
        if lineup.lineup_visibility == 'friends' or lineup.lineup_visibility == 'both':
            if lineup.creator_id in friend_ids:
                relevant_lineups.append(lineup)
                continue
        
        if lineup.lineup_visibility == 'area' or lineup.lineup_visibility == 'both':
            # Check if user is within proximity radius
            if user.latitude and user.longitude and lineup.latitude and lineup.longitude:
                # Simple distance check (not great for production, but works)
                lat_diff = abs(user.latitude - lineup.latitude)
                lon_diff = abs(user.longitude - lineup.longitude)
                # Rough approximation: 1 degree ≈ 69 miles
                distance_miles = math.sqrt(lat_diff**2 + lon_diff**2) * 69
                if distance_miles <= (lineup.proximity_radius or 10):
                    relevant_lineups.append(lineup)
                    continue
    
    # Serialize response
    return [
        {
            "id": str(lineup.id),
            "creator_id": lineup.creator_id,
            "creator_name": lineup.creator.full_name if lineup.creator else None,
            "photographer_id": lineup.photographer_id,
            "photographer_name": lineup.photographer.full_name if lineup.photographer else None,
            "location": lineup.location,
            "session_date": lineup.session_date.isoformat() if lineup.session_date else None,
            "session_time": lineup.session_date.strftime('%I:%M %p') if lineup.session_date else None,
            "total_price": lineup.total_price,
            "max_participants": lineup.max_participants,
            "lineup_status": lineup.lineup_status,
            "lineup_open_at": lineup.lineup_open_at.isoformat() if lineup.lineup_open_at else None,
            "lineup_closes_at": lineup.lineup_closes_at.isoformat() if lineup.lineup_closes_at else None,
            "lineup_visibility": lineup.lineup_visibility,
            "lineup_min_crew": lineup.lineup_min_crew,
            "lineup_max_crew": lineup.lineup_max_crew,
            "lineup_message": lineup.lineup_message,
            "participants": [
                {
                    "participant_id": p.participant_id,
                    "name": p.participant.full_name if p.participant else None,
                    "avatar_url": p.participant.avatar_url if p.participant else None,
                    "status": p.status,
                    "payment_status": p.payment_status
                }
                for p in lineup.participants
            ],
            "invite_code": lineup.invite_code
        }
        for lineup in relevant_lineups
    ]


@router.post("/bookings/{booking_id}/lineup/open")
async def open_lineup(
    booking_id: str,
    user_id: str = Query(...),
    data: OpenLineupRequest = None,
    db: AsyncSession = Depends(get_db)
):
    """
    Open a lineup for a booking.
    Lineup stays open until 96 hours before session, then auto-locks.
    """
    if data is None:
        data = OpenLineupRequest()
    
    result = await db.execute(
        select(Booking).where(Booking.id == booking_id)
        .options(selectinload(Booking.participants))
    )
    booking = result.scalar_one_or_none()
    
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    
    if booking.creator_id != user_id:
        raise HTTPException(status_code=403, detail="Only booking creator can open lineup")
    
    if booking.lineup_status not in ['closed', None]:
        raise HTTPException(status_code=400, detail="Lineup already open")
    
    # Calculate lineup close time (96 hours before session)
    if booking.session_date:
        from datetime import timedelta
        lineup_closes = booking.session_date - timedelta(hours=96)
        
        # Don't allow opening if less than 96 hours until session
        if datetime.now(timezone.utc) >= lineup_closes:
            raise HTTPException(status_code=400, detail="Cannot open lineup less than 96 hours before session")
    else:
        lineup_closes = None
    
    # Update booking with lineup settings
    booking.lineup_status = 'open'
    booking.lineup_open_at = datetime.now(timezone.utc)
    booking.lineup_closes_at = lineup_closes
    booking.lineup_visibility = data.visibility
    booking.lineup_min_crew = data.min_crew
    booking.lineup_max_crew = data.max_crew
    booking.lineup_message = data.message
    booking.lineup_auto_confirm = data.auto_confirm
    
    await db.commit()
    
    return {
        "message": "Lineup opened! Friends can now join.",
        "booking_id": booking_id,
        "lineup_status": "open",
        "lineup_closes_at": lineup_closes.isoformat() if lineup_closes else None,
        "visibility": data.visibility
    }


@router.post("/bookings/{booking_id}/lineup/join")
async def join_lineup(
    booking_id: str,
    user_id: str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    """
    Join an open lineup.
    User is added as a pending participant.
    """
    result = await db.execute(
        select(Booking).where(Booking.id == booking_id)
        .options(
            selectinload(Booking.participants),
            selectinload(Booking.creator)
        )
    )
    booking = result.scalar_one_or_none()
    
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    
    if booking.creator_id == user_id:
        raise HTTPException(status_code=400, detail="You're already the captain of this lineup")
    
    if booking.lineup_status not in ['open', 'filling']:
        raise HTTPException(status_code=400, detail="Lineup is not open for joining")
    
    # Check if already a participant
    existing = next((p for p in booking.participants if p.participant_id == user_id), None)
    if existing:
        raise HTTPException(status_code=400, detail="You're already in this lineup")
    
    # Check max crew
    current_crew = len([p for p in booking.participants if p.status in ['pending', 'confirmed']]) + 1
    max_crew = booking.lineup_max_crew or booking.max_participants or 10
    if current_crew >= max_crew:
        raise HTTPException(status_code=400, detail="Lineup is full")
    
    # Get joiner profile
    joiner = await db.execute(select(Profile).where(Profile.id == user_id))
    joiner = joiner.scalar_one_or_none()
    
    # Calculate share amount
    total_crew = current_crew + 1
    share_amount = booking.total_price / total_crew
    
    # Add as participant
    participant = BookingParticipant(
        booking_id=booking_id,
        participant_id=user_id,
        status='pending',
        payment_status='Pending',
        share_amount=share_amount
    )
    db.add(participant)
    
    # Update lineup status based on crew count
    new_crew_count = current_crew + 1
    min_crew = booking.lineup_min_crew or 2
    if new_crew_count >= min_crew:
        booking.lineup_status = 'ready'
    else:
        booking.lineup_status = 'filling'
    
    # Notify captain
    notification = Notification(
        user_id=booking.creator_id,
        type='lineup_join',
        title='New Crew Member!',
        body=f'{joiner.full_name if joiner else "Someone"} joined your lineup for {booking.location}',
        data=json.dumps({
            "booking_id": booking_id,
            "user_id": user_id,
            "user_name": joiner.full_name if joiner else None
        })
    )
    db.add(notification)
    
    await db.commit()
    
    # Broadcast real-time update to all lineup participants
    from websocket_manager import broadcast_lineup_update
    await broadcast_lineup_update(booking_id, 'crew_joined', {
        "user_id": user_id,
        "user_name": joiner.full_name if joiner else "New crew member",
        "avatar_url": joiner.avatar_url if joiner else None,
        "current_crew": new_crew_count,
        "max_crew": max_crew,
        "lineup_status": booking.lineup_status,
        "share_amount": share_amount
    })
    
    return {
        "message": "Joined lineup!",
        "booking_id": booking_id,
        "lineup_status": booking.lineup_status,
        "current_crew": new_crew_count,
        "share_amount": share_amount
    }


@router.post("/bookings/{booking_id}/lineup/leave")
async def leave_lineup(
    booking_id: str,
    user_id: str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    """Leave a lineup you've joined."""
    result = await db.execute(
        select(Booking).where(Booking.id == booking_id)
        .options(
            selectinload(Booking.participants).selectinload(BookingParticipant.participant),
            selectinload(Booking.creator)
        )
    )
    booking = result.scalar_one_or_none()
    
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    
    if booking.lineup_status == 'locked':
        raise HTTPException(status_code=400, detail="Lineup is locked, cannot leave")
    
    # Find participant
    participant = next((p for p in booking.participants if p.participant_id == user_id), None)
    if not participant:
        raise HTTPException(status_code=400, detail="You're not in this lineup")
    
    if participant.payment_status == 'Paid':
        raise HTTPException(status_code=400, detail="Cannot leave after payment. Request refund from captain.")
    
    # Get leaving user's name for notification
    leaving_user = await db.execute(select(Profile).where(Profile.id == user_id))
    leaving_user = leaving_user.scalar_one_or_none()
    leaving_name = leaving_user.full_name if leaving_user else "A crew member"
    
    # Remove participant
    await db.delete(participant)
    
    # Update lineup status
    remaining_participants = [p for p in booking.participants if p.status in ['pending', 'confirmed'] and p.participant_id != user_id]
    current_crew = len(remaining_participants) + 1  # +1 for captain
    min_crew = booking.lineup_min_crew or 2
    max_crew = booking.lineup_max_crew or booking.max_participants or 10
    spots_open = max_crew - current_crew
    
    if current_crew < min_crew:
        booking.lineup_status = 'filling' if current_crew > 1 else 'open'
    
    # Notify remaining crew members about the dropout
    crew_ids = [p.participant_id for p in remaining_participants]
    crew_ids.append(booking.creator_id)  # Include captain
    
    for crew_id in crew_ids:
        notification = Notification(
            user_id=crew_id,
            type='lineup_crew_left',
            title='Crew Member Left',
            body=f'{leaving_name} left the lineup for {booking.location}. {spots_open} spot(s) now open.',
            data=json.dumps({
                "booking_id": booking_id,
                "left_user_id": user_id,
                "left_user_name": leaving_name,
                "spots_open": spots_open,
                "lineup_status": booking.lineup_status
            })
        )
        db.add(notification)
    
    await db.commit()
    
    # Broadcast real-time update to all lineup participants
    from websocket_manager import broadcast_lineup_update, notify_lineup_participants
    await broadcast_lineup_update(booking_id, 'crew_left', {
        "user_id": user_id,
        "user_name": leaving_name,
        "current_crew": current_crew,
        "max_crew": max_crew,
        "spots_open": spots_open,
        "lineup_status": booking.lineup_status,
        "replacement_needed": current_crew < min_crew,
        "min_crew": min_crew
    })
    
    # Send personal notifications to remaining crew
    await notify_lineup_participants(crew_ids, 'crew_dropout', {
        "booking_id": booking_id,
        "location": booking.location,
        "left_user_name": leaving_name,
        "spots_open": spots_open,
        "session_date": booking.session_date.isoformat() if booking.session_date else None
    })
    
    return {
        "message": "Left lineup",
        "booking_id": booking_id,
        "lineup_status": booking.lineup_status,
        "spots_open": spots_open
    }


@router.post("/bookings/{booking_id}/lineup/lock")
async def lock_lineup(
    booking_id: str,
    user_id: str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    """
    Captain locks the lineup - no more changes allowed.
    Triggers payment collection from all crew members.
    """
    result = await db.execute(
        select(Booking).where(Booking.id == booking_id)
        .options(selectinload(Booking.participants))
    )
    booking = result.scalar_one_or_none()
    
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    
    if booking.creator_id != user_id:
        raise HTTPException(status_code=403, detail="Only captain can lock lineup")
    
    if booking.lineup_status not in ['open', 'filling', 'ready']:
        raise HTTPException(status_code=400, detail="Lineup cannot be locked")
    
    # Check minimum crew requirement
    current_crew = len([p for p in booking.participants if p.status in ['pending', 'confirmed']]) + 1
    min_crew = booking.lineup_min_crew or 2
    if current_crew < min_crew:
        raise HTTPException(status_code=400, detail=f"Need at least {min_crew} crew members to lock lineup")
    
    # Lock the lineup
    booking.lineup_status = 'locked'
    
    # Recalculate shares based on final crew count
    share_amount = booking.total_price / current_crew
    for p in booking.participants:
        if p.status in ['pending', 'confirmed']:
            p.share_amount = share_amount
    
    # Send payment requests to all crew
    captain = await db.execute(select(Profile).where(Profile.id == user_id))
    captain = captain.scalar_one_or_none()
    
    for p in booking.participants:
        if p.status in ['pending', 'confirmed'] and p.payment_status != 'Paid':
            notification = Notification(
                user_id=p.participant_id,
                type='lineup_payment_due',
                title='Lineup Locked - Payment Due!',
                body=f'Pay ${share_amount:.2f} to confirm your spot in {booking.location}',
                data=json.dumps({
                    "booking_id": booking_id,
                    "share_amount": share_amount,
                    "captain_name": captain.full_name if captain else None
                })
            )
            db.add(notification)
    
    await db.commit()
    
    # Broadcast real-time update to all lineup participants
    from websocket_manager import broadcast_lineup_update
    await broadcast_lineup_update(booking_id, 'lineup_locked', {
        "captain_id": user_id,
        "captain_name": captain.full_name if captain else "Captain",
        "crew_count": current_crew,
        "share_per_person": share_amount,
        "location": booking.location,
        "session_date": booking.session_date.isoformat() if booking.session_date else None
    })
    
    return {
        "message": "Lineup locked! Payment requests sent to crew.",
        "booking_id": booking_id,
        "lineup_status": "locked",
        "crew_count": current_crew,
        "share_per_person": share_amount
    }


@router.post("/bookings/{booking_id}/lineup/close")
async def close_lineup(
    booking_id: str,
    user_id: str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    """Captain closes the lineup (cancels it before locking)."""
    result = await db.execute(
        select(Booking).where(Booking.id == booking_id)
        .options(selectinload(Booking.participants).selectinload(BookingParticipant.participant))
    )
    booking = result.scalar_one_or_none()
    
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    
    if booking.creator_id != user_id:
        raise HTTPException(status_code=403, detail="Only captain can close lineup")
    
    if booking.lineup_status == 'locked':
        raise HTTPException(status_code=400, detail="Cannot close locked lineup. Use cancel instead.")
    
    # Get participant IDs before closing
    participant_ids = [p.participant_id for p in booking.participants if p.status in ['pending', 'confirmed']]
    
    # Notify all participants that lineup is cancelled
    for participant_id in participant_ids:
        notification = Notification(
            user_id=participant_id,
            type='lineup_cancelled',
            title='Lineup Cancelled',
            body=f'The lineup for {booking.location} has been cancelled by the captain.',
            data=json.dumps({
                "booking_id": booking_id,
                "location": booking.location
            })
        )
        db.add(notification)
    
    booking.lineup_status = 'closed'
    await db.commit()
    
    # Broadcast real-time update
    from websocket_manager import broadcast_lineup_update
    await broadcast_lineup_update(booking_id, 'lineup_cancelled', {
        "location": booking.location,
        "session_date": booking.session_date.isoformat() if booking.session_date else None
    })
    
    return {
        "message": "Lineup closed",
        "booking_id": booking_id,
        "lineup_status": "closed"
    }


class SetLineupStatusRequest(BaseModel):
    status: str  # 'open' or 'closed'


@router.post("/bookings/{booking_id}/lineup/status")
async def set_lineup_status(
    booking_id: str,
    user_id: str = Query(...),
    data: SetLineupStatusRequest = None,
    db: AsyncSession = Depends(get_db)
):
    """
    Toggle lineup status between open and closed.
    - Open: New surfers can discover and join via The Lineup
    - Closed: Only existing participants, no new joins allowed
    
    Captain (surfer) or Photographer can toggle this.
    """
    if not data:
        raise HTTPException(status_code=400, detail="No status data provided")
    
    if data.status not in ['open', 'closed']:
        raise HTTPException(status_code=400, detail="Status must be 'open' or 'closed'")
    
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
    
    # Allow both captain (creator) and photographer to toggle status
    if booking.creator_id != user_id and booking.photographer_id != user_id:
        raise HTTPException(status_code=403, detail="Only captain or photographer can change session status")
    
    if booking.lineup_status == 'locked':
        raise HTTPException(status_code=400, detail="Cannot change status of a locked session")
    
    # Update the status
    if data.status == 'open':
        # Re-calculate based on current participants
        current_crew = len([p for p in booking.participants if p.status in ['confirmed', 'pending']])
        min_crew = booking.lineup_min_crew or 2
        if current_crew >= min_crew:
            booking.lineup_status = 'ready'
        elif current_crew > 0:
            booking.lineup_status = 'filling'
        else:
            booking.lineup_status = 'open'
        booking.allow_splitting = True
    else:
        booking.lineup_status = 'closed'
        booking.allow_splitting = False
    
    await db.commit()
    
    # Get session details for notification
    session_name = f"{booking.location} - {booking.session_date.strftime('%b %d')}"
    changed_by_name = booking.creator.full_name if booking.creator_id == user_id else (
        booking.photographer.full_name if booking.photographer_id == user_id else "Unknown"
    )
    
    # Broadcast real-time update to all participants
    from websocket_manager import broadcast_lineup_update, broadcast_to_user
    await broadcast_lineup_update(booking_id, 'status_changed', {
        "new_status": booking.lineup_status,
        "session_name": session_name,
        "location": booking.location,
        "changed_by": user_id,
        "changed_by_name": changed_by_name
    })
    
    # Also notify all participants individually
    for participant in booking.participants:
        if participant.participant_id != user_id:
            await broadcast_to_user(participant.participant_id, 'lineup_notification', {
                "notification_type": "lineup_status_changed",
                "new_status": booking.lineup_status,
                "session_name": session_name,
                "location": booking.location,
                "changed_by_name": changed_by_name,
                "booking_id": booking_id
            })
    
    return {
        "message": f"Session {data.status}",
        "booking_id": booking_id,
        "lineup_status": booking.lineup_status,
        "allow_splitting": booking.allow_splitting
    }


class RemoveCrewMemberRequest(BaseModel):
    member_id: str


@router.post("/bookings/{booking_id}/lineup/remove-member")
async def remove_crew_member(
    booking_id: str,
    user_id: str = Query(...),
    data: RemoveCrewMemberRequest = None,
    db: AsyncSession = Depends(get_db)
):
    """
    Captain removes a crew member from the lineup.
    The spot opens up for someone else to join.
    """
    if not data:
        raise HTTPException(status_code=400, detail="No member data provided")
    
    result = await db.execute(
        select(Booking).where(Booking.id == booking_id)
        .options(
            selectinload(Booking.participants).selectinload(BookingParticipant.participant),
            selectinload(Booking.creator)
        )
    )
    booking = result.scalar_one_or_none()
    
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    
    if booking.creator_id != user_id:
        raise HTTPException(status_code=403, detail="Only captain can remove crew members")
    
    if booking.lineup_status not in ['open', 'filling']:
        raise HTTPException(status_code=400, detail="Cannot remove members from locked lineup")
    
    # Find the participant to remove
    participant = next((p for p in booking.participants if p.participant_id == data.member_id), None)
    if not participant:
        raise HTTPException(status_code=404, detail="Crew member not found in this lineup")
    
    if participant.payment_status == 'Paid':
        raise HTTPException(status_code=400, detail="Cannot remove crew member who has already paid")
    
    # Get removed user's name for notification
    removed_user_name = participant.participant.full_name if participant.participant else "Crew member"
    
    # Notify the removed user
    notification = Notification(
        user_id=data.member_id,
        type='lineup_removed',
        title='Removed from Lineup',
        body=f'You have been removed from the lineup for {booking.location}',
        data=json.dumps({
            "booking_id": booking_id,
            "location": booking.location
        })
    )
    db.add(notification)
    
    # Remove participant
    await db.delete(participant)
    
    # Update lineup status
    remaining_participants = [p for p in booking.participants if p.participant_id != data.member_id and p.status in ['pending', 'confirmed']]
    current_crew = len(remaining_participants) + 1  # +1 for captain
    min_crew = booking.lineup_min_crew or 2
    max_crew = booking.lineup_max_crew or booking.max_participants or 10
    spots_open = max_crew - current_crew
    
    if current_crew < min_crew:
        booking.lineup_status = 'filling' if current_crew > 1 else 'open'
    
    await db.commit()
    
    # Broadcast real-time update
    from websocket_manager import broadcast_lineup_update
    await broadcast_lineup_update(booking_id, 'crew_removed', {
        "removed_user_id": data.member_id,
        "removed_user_name": removed_user_name,
        "current_crew": current_crew,
        "max_crew": max_crew,
        "spots_open": spots_open,
        "lineup_status": booking.lineup_status
    })
    
    return {
        "message": f"{removed_user_name} removed from lineup",
        "booking_id": booking_id,
        "lineup_status": booking.lineup_status,
        "spots_open": spots_open
    }





class InviteCrewRequest(BaseModel):
    """Request to invite friends to a booking"""
    friend_ids: List[str]
    share_amount: Optional[float] = None
    message: Optional[str] = None


@router.post("/bookings/{booking_id}/invite-crew")
async def invite_crew_to_booking(
    booking_id: str,
    user_id: str = Query(...),
    data: InviteCrewRequest = None,
    db: AsyncSession = Depends(get_db)
):
    """
    Invite friends to join a booking (Live Now or Lineup).
    Sends notifications to all invited friends.
    """
    if data is None:
        raise HTTPException(status_code=400, detail="No invite data provided")
    
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
        raise HTTPException(status_code=403, detail="Only booking creator can invite crew")
    
    # Get inviter profile
    inviter = await db.execute(select(Profile).where(Profile.id == user_id))
    inviter = inviter.scalar_one_or_none()
    inviter_name = inviter.full_name if inviter else "Your friend"
    
    # Calculate share amount if not provided
    current_crew = len([p for p in booking.participants if p.status in ['pending', 'confirmed']]) + 1
    new_crew = current_crew + len(data.friend_ids)
    share_amount = data.share_amount or (booking.total_price / new_crew)
    
    invited_count = 0
    already_in = []
    
    for friend_id in data.friend_ids:
        # Check if already a participant
        if any(p.participant_id == friend_id for p in booking.participants):
            already_in.append(friend_id)
            continue
        
        # Add as pending participant
        participant = BookingParticipant(
            booking_id=booking_id,
            participant_id=friend_id,
            status='invited',
            payment_status='Pending',
            share_amount=share_amount
        )
        db.add(participant)
        
        # Send notification
        notification = Notification(
            user_id=friend_id,
            type='crew_invite',
            title=f'{inviter_name} invited you!',
            body=data.message or f'Join a surf session at {booking.location} for ${share_amount:.2f}',
            data=json.dumps({
                "booking_id": booking_id,
                "inviter_id": user_id,
                "inviter_name": inviter_name,
                "share_amount": share_amount,
                "location": booking.location,
                "session_date": str(booking.session_date) if booking.session_date else None
            })
        )
        db.add(notification)
        
        invited_count += 1
    
    # Update lineup status if applicable
    if booking.lineup_status in ['open', None]:
        booking.lineup_status = 'open'
    
    await db.commit()
    
    return {
        "message": f"Invited {invited_count} friend(s) to the session",
        "invited_count": invited_count,
        "already_in_session": already_in,
        "share_amount": share_amount
    }



@router.get("/bookings/{booking_id}/invite-suggestions")
async def get_invite_suggestions(
    booking_id: str,
    user_id: str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    """
    Get suggested users to invite to a lineup.
    Returns:
    1. Mutual followers (friends you follow and who follow you back)
    2. Nearby public users accepting lineup invites (if location-based)
    """
    # Get the booking
    result = await db.execute(
        select(Booking).where(Booking.id == booking_id)
        .options(selectinload(Booking.participants))
    )
    booking = result.scalar_one_or_none()
    
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    
    # Get current participants to exclude
    current_participant_ids = {booking.creator_id}
    for p in booking.participants:
        current_participant_ids.add(p.participant_id)
    
    # Get mutual followers (friends)
    from models import Friend, FriendshipStatusEnum
    friends_result = await db.execute(
        select(Friend).where(
            and_(
                or_(Friend.requester_id == user_id, Friend.addressee_id == user_id),
                Friend.status == FriendshipStatusEnum.ACCEPTED
            )
        )
    )
    friends = friends_result.scalars().all()
    
    mutual_friend_ids = set()
    for f in friends:
        if f.requester_id == user_id:
            mutual_friend_ids.add(f.addressee_id)
        else:
            mutual_friend_ids.add(f.requester_id)
    
    # Remove current participants from suggestions
    mutual_friend_ids = mutual_friend_ids - current_participant_ids
    
    # Get profiles of mutual friends
    mutual_friends = []
    if mutual_friend_ids:
        profiles_result = await db.execute(
            select(Profile).where(Profile.id.in_(mutual_friend_ids))
        )
        profiles = profiles_result.scalars().all()
        for p in profiles:
            mutual_friends.append({
                "user_id": str(p.id),
                "full_name": p.full_name,
                "avatar_url": p.avatar_url,
                "role": str(p.role.value) if p.role else "Surfer",
                "is_following": True,
                "is_mutual": True,
                "suggestion_type": "mutual_friend"
            })
    
    # Get nearby public users accepting invites (if booking has location)
    nearby_public = []
    if booking.location and booking.latitude and booking.longitude:
        # Find public users within ~50km who accept lineup invites
        from sqlalchemy import func
        
        # Simple bounding box for nearby (roughly 50km = 0.5 degrees)
        lat_range = 0.5
        lon_range = 0.5
        
        nearby_result = await db.execute(
            select(Profile).where(
                and_(
                    Profile.is_private.is_(False),
                    Profile.accepting_lineup_invites.is_(True),
                    Profile.id.notin_(current_participant_ids | mutual_friend_ids),
                    Profile.latitude.isnot(None),
                    Profile.longitude.isnot(None),
                    Profile.latitude.between(booking.latitude - lat_range, booking.latitude + lat_range),
                    Profile.longitude.between(booking.longitude - lon_range, booking.longitude + lon_range)
                )
            ).limit(10)
        )
        nearby_profiles = nearby_result.scalars().all()
        
        for p in nearby_profiles:
            nearby_public.append({
                "user_id": str(p.id),
                "full_name": p.full_name,
                "avatar_url": p.avatar_url,
                "role": str(p.role.value) if p.role else "Surfer",
                "is_following": False,
                "is_mutual": False,
                "suggestion_type": "nearby_public",
                "accepting_invites": True
            })
    
    return {
        "mutual_friends": mutual_friends,
        "nearby_public": nearby_public,
        "total_suggestions": len(mutual_friends) + len(nearby_public)
    }



# ============ POKER-STYLE SEAT RESERVATION SYSTEM ============
# Waitlist, Keep-Seat extensions, and Reservation Settings

class ReservationSettingsUpdate(BaseModel):
    """Update booking reservation/seat settings"""
    invite_expiry_hours: Optional[float] = None
    waitlist_enabled: Optional[bool] = None
    waitlist_claim_minutes: Optional[int] = None
    allow_keep_seat: Optional[bool] = None
    keep_seat_extension_hours: Optional[float] = None
    max_keep_seat_extensions: Optional[int] = None


@router.patch("/bookings/{booking_id}/reservation-settings")
async def update_reservation_settings(
    booking_id: str,
    user_id: str = Query(...),
    data: ReservationSettingsUpdate = None,
    db: AsyncSession = Depends(get_db)
):
    """
    Update seat reservation settings for a booking.
    Available to booking creator or photographer.
    """
    result = await db.execute(
        select(Booking).where(Booking.id == booking_id)
    )
    booking = result.scalar_one_or_none()
    
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    
    # Check permission - creator or photographer
    if booking.creator_id != user_id and booking.photographer_id != user_id:
        raise HTTPException(status_code=403, detail="Only booking creator or photographer can update settings")
    
    # Update fields if provided
    if data.invite_expiry_hours is not None:
        if data.invite_expiry_hours < 0.5 or data.invite_expiry_hours > 168:  # 30 min to 7 days
            raise HTTPException(status_code=400, detail="Invite expiry must be between 0.5 and 168 hours")
        booking.invite_expiry_hours = data.invite_expiry_hours
    
    if data.waitlist_enabled is not None:
        booking.waitlist_enabled = data.waitlist_enabled
    
    if data.waitlist_claim_minutes is not None:
        if data.waitlist_claim_minutes < 5 or data.waitlist_claim_minutes > 120:
            raise HTTPException(status_code=400, detail="Claim window must be between 5 and 120 minutes")
        booking.waitlist_claim_minutes = data.waitlist_claim_minutes
    
    if data.allow_keep_seat is not None:
        booking.allow_keep_seat = data.allow_keep_seat
    
    if data.keep_seat_extension_hours is not None:
        if data.keep_seat_extension_hours < 0.5 or data.keep_seat_extension_hours > 24:
            raise HTTPException(status_code=400, detail="Extension hours must be between 0.5 and 24")
        booking.keep_seat_extension_hours = data.keep_seat_extension_hours
    
    if data.max_keep_seat_extensions is not None:
        if data.max_keep_seat_extensions < 0 or data.max_keep_seat_extensions > 5:
            raise HTTPException(status_code=400, detail="Max extensions must be between 0 and 5")
        booking.max_keep_seat_extensions = data.max_keep_seat_extensions
    
    await db.commit()
    
    return {
        "success": True,
        "invite_expiry_hours": booking.invite_expiry_hours,
        "waitlist_enabled": booking.waitlist_enabled,
        "waitlist_claim_minutes": booking.waitlist_claim_minutes,
        "allow_keep_seat": booking.allow_keep_seat,
        "keep_seat_extension_hours": booking.keep_seat_extension_hours,
        "max_keep_seat_extensions": booking.max_keep_seat_extensions
    }


@router.get("/bookings/{booking_id}/reservation-settings")
async def get_reservation_settings(
    booking_id: str,
    user_id: str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    """Get current reservation settings for a booking."""
    result = await db.execute(
        select(Booking).where(Booking.id == booking_id)
    )
    booking = result.scalar_one_or_none()
    
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    
    return {
        "invite_expiry_hours": booking.invite_expiry_hours or 24.0,
        "waitlist_enabled": booking.waitlist_enabled if booking.waitlist_enabled is not None else True,
        "waitlist_claim_minutes": booking.waitlist_claim_minutes or 30,
        "allow_keep_seat": booking.allow_keep_seat if booking.allow_keep_seat is not None else True,
        "keep_seat_extension_hours": booking.keep_seat_extension_hours or 2.0,
        "max_keep_seat_extensions": booking.max_keep_seat_extensions or 2
    }


@router.post("/bookings/{booking_id}/waitlist/join")
async def join_booking_waitlist(
    booking_id: str,
    user_id: str = Query(...),
    user_lat: Optional[float] = Query(None),
    user_lon: Optional[float] = Query(None),
    db: AsyncSession = Depends(get_db)
):
    """
    Join the waitlist for a full booking session.
    Position is assigned based on order joined (FIFO).
    """
    from models import BookingWaitlist
    
    result = await db.execute(
        select(Booking).where(Booking.id == booking_id)
        .options(selectinload(Booking.participants))
    )
    booking = result.scalar_one_or_none()
    
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    
    if not booking.waitlist_enabled:
        raise HTTPException(status_code=400, detail="Waitlist is not enabled for this session")
    
    # Check if session is actually full
    active_count = len([p for p in booking.participants if p.status in ['pending', 'confirmed']])
    if active_count < booking.max_participants:
        raise HTTPException(status_code=400, detail="Session has open spots - no need to waitlist")
    
    # Check if already on waitlist
    existing = await db.execute(
        select(BookingWaitlist).where(
            BookingWaitlist.booking_id == booking_id,
            BookingWaitlist.user_id == user_id,
            BookingWaitlist.status == 'waiting'
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Already on waitlist")
    
    # Check if already a participant
    is_participant = any(p.participant_id == user_id for p in booking.participants)
    if is_participant:
        raise HTTPException(status_code=400, detail="Already a participant in this session")
    
    # Get next position
    max_pos_result = await db.execute(
        select(func.max(BookingWaitlist.position))
        .where(BookingWaitlist.booking_id == booking_id)
    )
    max_pos = max_pos_result.scalar() or 0
    
    # Calculate distance if coordinates provided
    distance = None
    if user_lat and user_lon and booking.latitude and booking.longitude:
        # Haversine formula
        from math import radians, cos, sin, asin, sqrt
        lat1, lon1, lat2, lon2 = map(radians, [user_lat, user_lon, booking.latitude, booking.longitude])
        dlat = lat2 - lat1
        dlon = lon2 - lon1
        a = sin(dlat/2)**2 + cos(lat1) * cos(lat2) * sin(dlon/2)**2
        c = 2 * asin(sqrt(a))
        distance = c * 3956  # Earth radius in miles
    
    # Create waitlist entry
    waitlist_entry = BookingWaitlist(
        booking_id=booking_id,
        user_id=user_id,
        position=max_pos + 1,
        status='waiting',
        distance_miles=distance
    )
    db.add(waitlist_entry)
    await db.commit()
    
    return {
        "success": True,
        "position": max_pos + 1,
        "message": f"You are #{max_pos + 1} on the waitlist"
    }


@router.get("/bookings/{booking_id}/waitlist")
async def get_booking_waitlist(
    booking_id: str,
    user_id: str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    """Get waitlist for a booking session."""
    from models import BookingWaitlist
    
    result = await db.execute(
        select(Booking).where(Booking.id == booking_id)
    )
    booking = result.scalar_one_or_none()
    
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    
    # Get waitlist entries
    waitlist_result = await db.execute(
        select(BookingWaitlist)
        .where(BookingWaitlist.booking_id == booking_id)
        .where(BookingWaitlist.status.in_(['waiting', 'notified']))
        .order_by(BookingWaitlist.position.asc())
    )
    waitlist = waitlist_result.scalars().all()
    
    # Get user profiles for waitlist
    entries = []
    user_position = None
    for entry in waitlist:
        profile_result = await db.execute(
            select(Profile).where(Profile.id == entry.user_id)
        )
        profile = profile_result.scalar_one_or_none()
        
        entries.append({
            "position": entry.position,
            "user_id": entry.user_id,
            "name": profile.full_name if profile else "Unknown",
            "avatar_url": profile.avatar_url if profile else None,
            "status": entry.status,
            "joined_at": entry.created_at.isoformat(),
            "claim_expires_at": entry.claim_expires_at.isoformat() if entry.claim_expires_at else None
        })
        
        if entry.user_id == user_id:
            user_position = entry.position
    
    return {
        "waitlist": entries,
        "total_waiting": len(entries),
        "user_position": user_position,
        "waitlist_enabled": booking.waitlist_enabled,
        "claim_window_minutes": booking.waitlist_claim_minutes
    }


@router.delete("/bookings/{booking_id}/waitlist/leave")
async def leave_booking_waitlist(
    booking_id: str,
    user_id: str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    """Leave the waitlist for a booking."""
    from models import BookingWaitlist
    
    result = await db.execute(
        select(BookingWaitlist).where(
            BookingWaitlist.booking_id == booking_id,
            BookingWaitlist.user_id == user_id,
            BookingWaitlist.status.in_(['waiting', 'notified'])
        )
    )
    entry = result.scalar_one_or_none()
    
    if not entry:
        raise HTTPException(status_code=404, detail="Not on waitlist")
    
    entry.status = 'left'
    await db.commit()
    
    return {"success": True, "message": "Left the waitlist"}


@router.post("/bookings/{booking_id}/waitlist/claim")
async def claim_waitlist_spot(
    booking_id: str,
    user_id: str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    """
    Claim an open spot from the waitlist.
    Only works if user was notified and within claim window.
    """
    from models import BookingWaitlist
    
    result = await db.execute(
        select(BookingWaitlist).where(
            BookingWaitlist.booking_id == booking_id,
            BookingWaitlist.user_id == user_id,
            BookingWaitlist.status == 'notified'
        )
    )
    entry = result.scalar_one_or_none()
    
    if not entry:
        raise HTTPException(status_code=404, detail="No open spot to claim")
    
    # Check if claim window expired
    now = datetime.now(timezone.utc)
    if entry.claim_expires_at and entry.claim_expires_at < now:
        entry.status = 'expired'
        await db.commit()
        raise HTTPException(status_code=400, detail="Claim window has expired")
    
    # Get booking
    booking_result = await db.execute(
        select(Booking).where(Booking.id == booking_id)
        .options(selectinload(Booking.participants), selectinload(Booking.photographer))
    )
    booking = booking_result.scalar_one_or_none()
    
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    
    # Verify spot is still available
    active_count = len([p for p in booking.participants if p.status in ['pending', 'confirmed']])
    if active_count >= booking.max_participants:
        raise HTTPException(status_code=400, detail="Spot is no longer available")
    
    # Add user as participant
    participant = BookingParticipant(
        booking_id=booking_id,
        participant_id=user_id,
        status='pending',
        payment_status='Pending',
        paid_amount=0
    )
    db.add(participant)
    
    # Mark waitlist entry as claimed
    entry.status = 'claimed'
    entry.claimed_at = now
    
    await db.commit()
    
    return {
        "success": True,
        "message": "Spot claimed! Complete payment to confirm your spot.",
        "booking_id": booking_id
    }


@router.post("/bookings/{booking_id}/keep-seat")
async def keep_seat_extension(
    booking_id: str,
    user_id: str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    """
    Extend your pending invite - like poker's "time bank".
    Limited number of extensions allowed per booking.
    """
    from models import BookingKeepSeatLog
    
    # Get booking
    result = await db.execute(
        select(Booking).where(Booking.id == booking_id)
    )
    booking = result.scalar_one_or_none()
    
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    
    if not booking.allow_keep_seat:
        raise HTTPException(status_code=400, detail="Keep seat extensions not allowed for this session")
    
    # Find user's pending invite
    invite_result = await db.execute(
        select(BookingInvite).where(
            BookingInvite.booking_id == booking_id,
            BookingInvite.invitee_id == user_id,
            BookingInvite.status == 'pending'
        )
    )
    invite = invite_result.scalar_one_or_none()
    
    if not invite:
        raise HTTPException(status_code=404, detail="No pending invite found")
    
    if not invite.expires_at:
        raise HTTPException(status_code=400, detail="Invite has no expiry to extend")
    
    # Count existing extensions
    ext_count_result = await db.execute(
        select(func.count(BookingKeepSeatLog.id))
        .where(
            BookingKeepSeatLog.booking_id == booking_id,
            BookingKeepSeatLog.user_id == user_id
        )
    )
    ext_count = ext_count_result.scalar() or 0
    
    max_extensions = booking.max_keep_seat_extensions or 2
    if ext_count >= max_extensions:
        raise HTTPException(
            status_code=400, 
            detail=f"Maximum {max_extensions} extensions reached"
        )
    
    # Create extension
    extension_hours = booking.keep_seat_extension_hours or 2.0
    old_expires = invite.expires_at
    new_expires = old_expires + timedelta(hours=extension_hours)
    
    # Update invite
    invite.expires_at = new_expires
    
    # Log extension
    log = BookingKeepSeatLog(
        booking_id=booking_id,
        user_id=user_id,
        invite_id=invite.id,
        extension_number=ext_count + 1,
        hours_extended=extension_hours,
        old_expires_at=old_expires,
        new_expires_at=new_expires
    )
    db.add(log)
    
    await db.commit()
    
    return {
        "success": True,
        "extensions_used": ext_count + 1,
        "extensions_remaining": max_extensions - ext_count - 1,
        "new_expires_at": new_expires.isoformat(),
        "hours_extended": extension_hours
    }


@router.get("/bookings/{booking_id}/keep-seat-status")
async def get_keep_seat_status(
    booking_id: str,
    user_id: str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    """Get keep-seat extension status for a user."""
    from models import BookingKeepSeatLog
    
    result = await db.execute(
        select(Booking).where(Booking.id == booking_id)
    )
    booking = result.scalar_one_or_none()
    
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    
    # Count extensions used
    ext_count_result = await db.execute(
        select(func.count(BookingKeepSeatLog.id))
        .where(
            BookingKeepSeatLog.booking_id == booking_id,
            BookingKeepSeatLog.user_id == user_id
        )
    )
    ext_count = ext_count_result.scalar() or 0
    
    max_extensions = booking.max_keep_seat_extensions or 2
    
    return {
        "allow_keep_seat": booking.allow_keep_seat if booking.allow_keep_seat is not None else True,
        "extension_hours": booking.keep_seat_extension_hours or 2.0,
        "extensions_used": ext_count,
        "extensions_remaining": max(0, max_extensions - ext_count),
        "max_extensions": max_extensions
    }
