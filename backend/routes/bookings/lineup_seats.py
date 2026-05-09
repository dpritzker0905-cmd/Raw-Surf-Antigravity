"""
bookings/lineup_seats.py — Seat management: status toggle, remove members, reservation settings.

Extracted from lineup.py (v90) to comply with <800 LOC governance.
Contains: set_lineup_status, remove_crew_member, reservation settings CRUD
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime, timezone
import json
import logging

from database import get_db
from models import (
    Profile, Booking, BookingParticipant,
    Notification,
)
from core.security import get_user_id_from_jwt_or_query

router = APIRouter()
logger = logging.getLogger(__name__)


# ═══ PYDANTIC MODELS ══════════════════════════════════════════════════════

class SetLineupStatusRequest(BaseModel):
    status: str  # 'open' or 'closed'


class RemoveCrewMemberRequest(BaseModel):
    member_id: str


class InviteCrewRequest(BaseModel):
    """Request to invite friends to a booking"""
    friend_ids: List[str]
    share_amount: Optional[float] = None
    message: Optional[str] = None


class ReservationSettingsUpdate(BaseModel):
    """Update booking reservation/seat settings"""
    invite_expiry_hours: Optional[float] = None
    waitlist_enabled: Optional[bool] = None
    waitlist_claim_minutes: Optional[int] = None
    allow_keep_seat: Optional[bool] = None
    keep_seat_extension_hours: Optional[float] = None
    max_keep_seat_extensions: Optional[int] = None


# ═══ ROUTES ══════════════════════════════════════════════════════════════


@router.post("/bookings/{booking_id}/lineup/status")
async def set_lineup_status(
    booking_id: str,
    user_id: str = Depends(get_user_id_from_jwt_or_query),
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


@router.post("/bookings/{booking_id}/lineup/remove-member")
async def remove_crew_member(
    booking_id: str,
    user_id: str = Depends(get_user_id_from_jwt_or_query),
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


@router.patch("/bookings/{booking_id}/reservation-settings")
async def update_reservation_settings(
    booking_id: str,
    user_id: str = Depends(get_user_id_from_jwt_or_query),
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
    user_id: str = Depends(get_user_id_from_jwt_or_query),
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
