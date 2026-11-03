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
import hashlib
import logging

from database import get_db
from models import (
    Profile, Booking, BookingParticipant, BookingInvite,
    Notification, RoleEnum
)
from utils.credits import deduct_credits, add_credits, clean_amount
from websocket_manager import broadcast_earnings_update
from core.security import get_current_user_id, get_user_id_from_jwt_or_query

try:
    from services.onesignal_service import onesignal_service
except ImportError:
    onesignal_service = None

router = APIRouter()
logger = logging.getLogger(__name__)

# Import shared models from crud domain
from .crud import InviteCrewRequest


# ============ INVITE READ / RESPOND ============

@router.get("/bookings/invites/{user_id}")
async def get_user_invites(
    user_id: str,
    auth_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Read the authenticated recipient's pending invites without changing them."""
    if user_id != auth_user_id:
        raise HTTPException(status_code=403, detail="Cannot read another user's invites")

    result = await db.execute(
        select(BookingInvite)
        .where(BookingInvite.invitee_id == auth_user_id, BookingInvite.status == 'pending')
        .options(
            selectinload(BookingInvite.booking).selectinload(Booking.photographer),
            selectinload(BookingInvite.inviter)
        )
        .order_by(BookingInvite.created_at.desc())
    )
    invites = []
    for invite in result.scalars().all():
        booking = invite.booking
        inviter = invite.inviter
        photographer = booking.photographer if booking else None
        invites.append({
            "id": str(invite.id),
            "booking_id": str(invite.booking_id),
            "inviter_name": inviter.full_name if inviter else None,
            "inviter_avatar": inviter.avatar_url if inviter else None,
            "location": booking.location if booking else None,
            "session_date": booking.session_date.isoformat() if booking and booking.session_date else None,
            "photographer_name": photographer.full_name if photographer else None,
            "message": invite.message,
            "created_at": invite.created_at.isoformat() if invite.created_at else None,
        })
    return invites

def _invite_consent_terms(invite, booking, user_id):
    """Bind exact stored terms; this public fingerprint is consent, never authorization."""
    try:
        split_price = booking.price_per_person or (booking.total_price / booking.max_participants)
        charge = clean_amount(split_price)
        if charge is None:
            raise ValueError("Invalid amount")
        terms = ["booking-invite-v1", user_id, invite.id, booking.id, booking.photographer_id,
                 None if booking.price_per_person is None else float(booking.price_per_person).hex(),
                 float(booking.total_price).hex(), booking.max_participants, float(split_price).hex()]
    except (AttributeError, TypeError, ValueError, ZeroDivisionError, OverflowError) as exc:
        raise HTTPException(status_code=400, detail="Invite price is unavailable") from exc
    fingerprint = hashlib.sha256(json.dumps(terms, separators=(',', ':')).encode()).hexdigest()
    return {"invite_id": str(invite.id), "booking_id": str(booking.id),
            "amount_credits": format(charge, '.2f'), "unit": "credits", "quote": fingerprint}


@router.get("/bookings/invites/{invite_id}/accept-quote")
async def get_invite_accept_quote(
    invite_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Read a recipient's current charge; never reserve, accept or charge an invite."""
    result = await db.execute(select(BookingInvite).where(BookingInvite.id == invite_id)
                              .execution_options(populate_existing=True))
    invite = result.scalar_one_or_none()
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found")
    if invite.invitee_id != user_id:
        raise HTTPException(status_code=403, detail="This invite is not for you")
    if invite.status != 'pending':
        raise HTTPException(status_code=400, detail="This invite has already been responded to")
    result = await db.execute(select(Booking).where(Booking.id == invite.booking_id)
                              .execution_options(populate_existing=True))
    booking = result.scalar_one_or_none()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    return _invite_consent_terms(invite, booking, user_id)


@router.post("/bookings/invites/{invite_id}/respond")
async def respond_to_invite(
    invite_id: str, accept: bool,
    user_id: str = Depends(get_user_id_from_jwt_or_query),
    db: AsyncSession = Depends(get_db),
    consent_quote: Optional[str] = None
):
    """Accept or decline a booking invite - charges credits on accept"""
    # Serialize responses to the same invite, including a competing decline.
    statement = (select(BookingInvite).where(BookingInvite.id == invite_id)
                 .with_for_update().execution_options(populate_existing=True))
    invite_result = await db.execute(statement)
    invite = invite_result.scalar_one_or_none()
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found")
    if invite.invitee_id != user_id:
        raise HTTPException(status_code=403, detail="This invite is not for you")
    if invite.status != 'pending':
        raise HTTPException(status_code=400, detail="This invite has already been responded to")

    if accept:
        # Hold both current rows until the existing final commit / session rollback.
        booking_result = await db.execute(select(Booking).where(Booking.id == invite.booking_id)
                                          .with_for_update().execution_options(populate_existing=True))
        booking = booking_result.scalar_one_or_none()
        if not booking:
            raise HTTPException(status_code=404, detail="Booking not found")
        quote = _invite_consent_terms(invite, booking, user_id)
        if not consent_quote or consent_quote != quote['quote']:
            raise HTTPException(status_code=409, detail="Invite price changed or confirmation is missing. Review again.")

    user_result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = user_result.scalar_one_or_none()

    invite.status = 'accepted' if accept else 'declined'
    invite.responded_at = datetime.now(timezone.utc)

    amount_paid = 0
    new_balance = None

    if accept:
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
            "status": invite.status, "amount_paid": amount_paid, "new_balance": new_balance,
            "amount_paid_credits": quote['amount_credits'] if accept else None}


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
