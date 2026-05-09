"""
invite_lifecycle.py — Invite response, crew invites, suggestions, and seat reservations.

Extracted from invites.py (v88 decomposition). Contains:
  - Invite accept/decline with credit processing
  - Crew invite batch endpoint
  - Invite suggestions (mutual friends, nearby users)
  - Poker-style seat reservation system
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime, timezone, timedelta
import json
import logging

from database import get_db
from models import (
    Profile, Booking, BookingParticipant, BookingInvite,
    Notification, RoleEnum
)
from utils.credits import deduct_credits, add_credits
from websocket_manager import broadcast_earnings_update
from core.security import get_user_id_from_jwt_or_query

try:
    from services.onesignal_service import onesignal_service
except ImportError:
    onesignal_service = None

router = APIRouter()
logger = logging.getLogger(__name__)

# Import shared models from crud domain
from .crud import InviteCrewRequest


# ============ INVITE RESPOND ============

@router.post("/bookings/invites/{invite_id}/respond")
async def respond_to_invite(
    invite_id: str, user_id: str, accept: bool,
    db: AsyncSession = Depends(get_db)
):
    """Accept or decline a booking invite - charges credits on accept"""
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

    user_result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = user_result.scalar_one_or_none()

    invite.status = 'accepted' if accept else 'declined'
    invite.responded_at = datetime.now(timezone.utc)

    amount_paid = 0
    new_balance = None

    if accept:
        booking = invite.booking
        split_price = booking.price_per_person or (booking.total_price / booking.max_participants)

        success, new_balance, error = await deduct_credits(
            user_id=user_id, amount=split_price, transaction_type='booking_payment',
            db=db, description=f"Accepted invite to session at {booking.location}",
            reference_type='booking', reference_id=booking.id,
            counterparty_id=booking.photographer_id
        )
        if not success:
            raise HTTPException(status_code=400, detail=error)

        await add_credits(
            user_id=booking.photographer_id, amount=split_price * 0.80,
            transaction_type='booking_earning', db=db,
            description=f"Booking payment from {user.full_name} (via invite)",
            reference_type='booking', reference_id=booking.id, counterparty_id=user_id
        )
        amount_paid = split_price

        participant = BookingParticipant(
            booking_id=invite.booking_id, participant_id=user_id,
            invited_by_id=invite.inviter_id, invite_type='friend_invite',
            paid_amount=split_price, payment_status='Paid',
            payment_method='credits', status='confirmed'
        )
        db.add(participant)

        notification = Notification(
            user_id=invite.inviter_id, type='invite_accepted', title='Invite Accepted',
            body=f'{user.full_name if user else "Someone"} accepted your session invite and paid ${split_price:.2f}!',
            data=json.dumps({"booking_id": invite.booking_id})
        )
        db.add(notification)

        notification = Notification(
            user_id=booking.photographer_id, type='booking_payment_received',
            title='New Booking Payment',
            body=f'{user.full_name} paid ${split_price:.2f} to join your session',
            data=json.dumps({"booking_id": booking.id, "amount": split_price})
        )
        db.add(notification)

        photographer_earnings = split_price * 0.80
        await broadcast_earnings_update(
            user_id=booking.photographer_id, update_type='booking_paid',
            amount=photographer_earnings,
            details={"buyer_name": user.full_name, "booking_location": booking.location,
                     "gross_amount": split_price, "booking_id": booking.id, "source": "invite_accepted"}
        )

    await db.commit()
    return {"message": "Invite accepted" if accept else "Invite declined",
            "status": invite.status, "amount_paid": amount_paid, "new_balance": new_balance}


# ============ CREW INVITE ============

@router.post("/bookings/{booking_id}/invite-crew")
async def invite_crew_to_booking(
    booking_id: str,
    user_id: str = Depends(get_user_id_from_jwt_or_query),
    data: InviteCrewRequest = None,
    db: AsyncSession = Depends(get_db)
):
    """Invite friends to join a booking (Live Now or Lineup)."""
    if data is None:
        raise HTTPException(status_code=400, detail="No invite data provided")

    result = await db.execute(
        select(Booking).where(Booking.id == booking_id)
        .options(selectinload(Booking.photographer), selectinload(Booking.participants))
    )
    booking = result.scalar_one_or_none()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    if booking.creator_id != user_id:
        raise HTTPException(status_code=403, detail="Only booking creator can invite crew")

    inviter = await db.execute(select(Profile).where(Profile.id == user_id))
    inviter = inviter.scalar_one_or_none()
    inviter_name = inviter.full_name if inviter else "Your friend"

    current_crew = len([p for p in booking.participants if p.status in ['pending', 'confirmed']]) + 1
    new_crew = current_crew + len(data.friend_ids)
    share_amount = data.share_amount or (booking.total_price / new_crew)

    invited_count = 0
    already_in = []
    for friend_id in data.friend_ids:
        if any(p.participant_id == friend_id for p in booking.participants):
            already_in.append(friend_id)
            continue
        participant = BookingParticipant(
            booking_id=booking_id, participant_id=friend_id,
            status='invited', payment_status='Pending', share_amount=share_amount
        )
        db.add(participant)
        notification = Notification(
            user_id=friend_id, type='crew_invite', title=f'{inviter_name} invited you!',
            body=data.message or f'Join a surf session at {booking.location} for ${share_amount:.2f}',
            data=json.dumps({"booking_id": booking_id, "inviter_id": user_id,
                             "inviter_name": inviter_name, "share_amount": share_amount,
                             "location": booking.location,
                             "session_date": str(booking.session_date) if booking.session_date else None})
        )
        db.add(notification)
        invited_count += 1

    if booking.lineup_status in ['open', None]:
        booking.lineup_status = 'open'

    await db.commit()
    return {"message": f"Invited {invited_count} friend(s) to the session",
            "invited_count": invited_count, "already_in_session": already_in, "share_amount": share_amount}


# ============ INVITE SUGGESTIONS ============

@router.get("/bookings/{booking_id}/invite-suggestions")
async def get_invite_suggestions(
    booking_id: str,
    user_id: str = Depends(get_user_id_from_jwt_or_query),
    db: AsyncSession = Depends(get_db)
):
    """Get suggested users to invite to a lineup (mutual friends + nearby public)."""
    result = await db.execute(
        select(Booking).where(Booking.id == booking_id)
        .options(selectinload(Booking.participants))
    )
    booking = result.scalar_one_or_none()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")

    current_participant_ids = {booking.creator_id}
    for p in booking.participants:
        current_participant_ids.add(p.participant_id)

    from models import Friend, FriendshipStatusEnum
    friends_result = await db.execute(
        select(Friend).where(and_(
            or_(Friend.requester_id == user_id, Friend.addressee_id == user_id),
            Friend.status == FriendshipStatusEnum.ACCEPTED
        ))
    )
    friends = friends_result.scalars().all()
    mutual_friend_ids = set()
    for f in friends:
        mutual_friend_ids.add(f.addressee_id if f.requester_id == user_id else f.requester_id)
    mutual_friend_ids = mutual_friend_ids - current_participant_ids

    mutual_friends = []
    if mutual_friend_ids:
        profiles_result = await db.execute(select(Profile).where(Profile.id.in_(mutual_friend_ids)))
        for p in profiles_result.scalars().all():
            mutual_friends.append({
                "user_id": str(p.id), "full_name": p.full_name, "avatar_url": p.avatar_url,
                "role": str(p.role.value) if p.role else "Surfer",
                "is_following": True, "is_mutual": True, "suggestion_type": "mutual_friend"
            })

    nearby_public = []
    if booking.location and booking.latitude and booking.longitude:
        from sqlalchemy import func
        lat_range = 0.5
        lon_range = 0.5
        nearby_result = await db.execute(
            select(Profile).where(and_(
                Profile.is_private.is_(False), Profile.accepting_lineup_invites.is_(True),
                Profile.id.notin_(current_participant_ids | mutual_friend_ids),
                Profile.latitude.isnot(None), Profile.longitude.isnot(None),
                Profile.latitude.between(booking.latitude - lat_range, booking.latitude + lat_range),
                Profile.longitude.between(booking.longitude - lon_range, booking.longitude + lon_range)
            )).limit(10)
        )
        for p in nearby_result.scalars().all():
            nearby_public.append({
                "user_id": str(p.id), "full_name": p.full_name, "avatar_url": p.avatar_url,
                "role": str(p.role.value) if p.role else "Surfer",
                "is_following": False, "is_mutual": False,
                "suggestion_type": "nearby_public", "accepting_invites": True
            })

    return {"mutual_friends": mutual_friends, "nearby_public": nearby_public,
            "total_suggestions": len(mutual_friends) + len(nearby_public)}


# ============ POKER-STYLE SEAT RESERVATION SYSTEM ============

class ReservationSettingsUpdate(BaseModel):
    """Update booking reservation/seat settings"""
    invite_expiry_hours: Optional[float] = None
    waitlist_enabled: Optional[bool] = None
    waitlist_claim_minutes: Optional[int] = None
    allow_keep_seat: Optional[bool] = None
    keep_seat_extension_hours: Optional[float] = None
    max_keep_seat_extensions: Optional[int] = None
