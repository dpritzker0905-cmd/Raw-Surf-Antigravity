"""
bookings/invites.py — Crew invites, join-by-code, invite-by-handle, respond
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

# Import shared models from crud domain
from .crud import (
    InviteFriendRequest,
    InviteByHandleRequest,
    InviteResponse,
    check_time_slot_conflict,
)

# ═══ ROUTES ══════════════════════════════════════════════════════════════

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


