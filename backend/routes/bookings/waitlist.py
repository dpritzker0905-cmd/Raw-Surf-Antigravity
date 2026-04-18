"""
bookings/waitlist.py — Waitlist: join, leave, claim, keep-seat
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

# ═══ ROUTES ══════════════════════════════════════════════════════════════

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
