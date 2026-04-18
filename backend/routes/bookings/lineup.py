"""
bookings/lineup.py — Lineup: open, join, leave, lock, close, status, remove, reservation settings
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


