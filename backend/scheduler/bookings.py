"""Booking-related scheduler tasks.
- Payment window expiry check (5min)
- Payment expiry reminders (5min)
- Session reminders (5min)
- Expire booking invites (5min)
"""
import logging
import json
from datetime import datetime, timezone, timedelta

logger = logging.getLogger(__name__)
async def check_payment_window_expiry_task():
    """
    Check for expired payment windows and handle them:
    - Cancel booking and refund to credit balance
    - Notify captain about expiry
    - Notify crew about cancellation
    
    Triggered every 5 minutes
    """
    from database import async_session_maker
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload
    from models import Booking, BookingParticipant, Notification, Profile
    from routes.notifications.push import notify_crew_session_confirmed
    
    logger.info("[Scheduler] Checking payment window expiry...")
    
    try:
        async with async_session_maker() as db:
            now = datetime.now(timezone.utc)
            
            # Find bookings with expired payment windows that haven't been handled
            result = await db.execute(
                select(Booking).where(
                    Booking.payment_window_expires_at <= now,
                    Booking.payment_window_expired == False,
                    Booking.status == "PendingPayment"
                ).options(
                    selectinload(Booking.participants).selectinload(BookingParticipant.participant),
                    selectinload(Booking.creator)
                )
            )
            expired_bookings = result.scalars().all()
            
            logger.info(f"[Scheduler] Found {len(expired_bookings)} expired payment windows")
            
            for booking in expired_bookings:
                # Mark as expired
                booking.payment_window_expired = True
                
                # Check if there are any unpaid participants
                unpaid = [p for p in booking.participants 
                          if p.payment_status != 'Paid' and not p.covered_by_captain]
                
                if unpaid:
                    # Calculate remaining balance
                    total_paid = sum(p.paid_amount for p in booking.participants)
                    remaining = booking.total_price - total_paid
                    
                    # Notify captain that window expired
                    captain_notification = Notification(
                        user_id=booking.creator_id,
                        type='payment_window_expired',
                        title='Payment Window Expired',
                        body=f'Crew payment window for {booking.location} has expired. Remaining: ${remaining:.2f}. Cover the balance or the session will be cancelled.',
                        data=json.dumps({
                            "booking_id": booking.id,
                            "remaining_amount": remaining,
                            "location": booking.location,
                            "options": ["cover_remaining", "cancel_refund"]
                        })
                    )
                    db.add(captain_notification)
                    
                    logger.info(f"[Scheduler] Notified captain {booking.creator_id} about expired window for booking {booking.id}")
                else:
                    # All paid - confirm booking
                    booking.status = "Confirmed"
                    booking.crew_payment_required = False
                    
                    # Notify all that session is confirmed
                    for p in booking.participants:
                        try:
                            await notify_crew_session_confirmed(
                                participant_id=p.participant_id,
                                captain_name=booking.creator.full_name if booking.creator else "Captain",
                                booking_id=booking.id,
                                location=booking.location,
                                session_date=booking.session_date.isoformat() if booking.session_date else "",
                                db=db
                            )
                        except Exception as e:
                            logger.warning(f"[Scheduler] Failed to notify {p.participant_id}: {e}")
                    
                    logger.info(f"[Scheduler] Booking {booking.id} confirmed - all crew paid")
            
            await db.commit()
            logger.info(f"[Scheduler] Payment expiry check complete")
    
    except Exception as e:
        logger.error(f"[Scheduler] Error in payment expiry check: {str(e)}")


async def send_payment_expiry_reminders_task():
    """
    Send reminders to crew members 15 minutes before payment window expires.
    
    Triggered every 5 minutes
    """
    from database import async_session_maker
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload
    from models import Booking, BookingParticipant, Notification
    from routes.notifications.push import notify_crew_payment_expiring
    from datetime import timedelta
    
    logger.info("[Scheduler] Checking for payment expiry reminders...")
    
    try:
        async with async_session_maker() as db:
            now = datetime.now(timezone.utc)
            reminder_window_start = now + timedelta(minutes=10)
            reminder_window_end = now + timedelta(minutes=20)
            
            # Find bookings with payment windows expiring in 10-20 minutes
            result = await db.execute(
                select(Booking).where(
                    Booking.payment_window_expires_at >= reminder_window_start,
                    Booking.payment_window_expires_at <= reminder_window_end,
                    Booking.payment_window_expired == False,
                    Booking.status == "PendingPayment"
                ).options(
                    selectinload(Booking.participants).selectinload(BookingParticipant.participant),
                    selectinload(Booking.creator)
                )
            )
            bookings_to_remind = result.scalars().all()
            
            reminders_sent = 0
            
            for booking in bookings_to_remind:
                captain_name = booking.creator.full_name if booking.creator else "Captain"
                
                for p in booking.participants:
                    if p.payment_status != 'Paid' and not p.covered_by_captain:
                        share = p.share_amount if p.share_amount > 0 else (booking.total_price / len(booking.participants))
                        minutes_left = int((booking.payment_window_expires_at - now).total_seconds() / 60)
                        
                        # Send push notification
                        try:
                            await notify_crew_payment_expiring(
                                crew_member_id=p.participant_id,
                                captain_name=captain_name,
                                booking_id=booking.id,
                                share_amount=share,
                                minutes_remaining=minutes_left,
                                db=db
                            )
                            reminders_sent += 1
                        except Exception as e:
                            logger.warning(f"[Scheduler] Failed to send reminder to {p.participant_id}: {e}")
                        
                        # Also create in-app notification
                        notification = Notification(
                            user_id=p.participant_id,
                            type='payment_expiry_reminder',
                            title='⏰ Payment Reminder!',
                            body=f'Only {minutes_left} minutes left to pay ${share:.2f} for {captain_name}\'s session!',
                            data=json.dumps({
                                "booking_id": booking.id,
                                "share_amount": share,
                                "minutes_remaining": minutes_left,
                                "deep_link": f"/bookings/pay/{booking.id}"
                            })
                        )
                        db.add(notification)
            
            await db.commit()
            logger.info(f"[Scheduler] Sent {reminders_sent} payment expiry reminders")
    
    except Exception as e:
        logger.error(f"[Scheduler] Error sending payment reminders: {str(e)}")

async def send_session_reminders_task():
    """
    Send push notification reminders for upcoming scheduled sessions
    - 2 hours before: "Your session is in 2 hours - time to wax up!"
    - 30 minutes before: "Session starting soon - head to [Impact Zone]!"
    Sends to BOTH surfer and photographer
    """
    from database import async_session_maker
    from sqlalchemy import select, and_
    from sqlalchemy.orm import selectinload
    from models import Booking, Profile, Notification
    from routes.notifications.push import send_push_notification
    
    logger.info("[Scheduler] Checking for session reminders...")
    
    try:
        async with async_session_maker() as db:
            now = datetime.now(timezone.utc)
            
            # 2-hour reminder window (1h55m to 2h5m from now)
            two_hour_start = now.replace(second=0, microsecond=0)
            from datetime import timedelta
            two_hour_window_start = two_hour_start + timedelta(hours=1, minutes=55)
            two_hour_window_end = two_hour_start + timedelta(hours=2, minutes=5)
            
            # 30-minute reminder window (25m to 35m from now)
            thirty_min_window_start = two_hour_start + timedelta(minutes=25)
            thirty_min_window_end = two_hour_start + timedelta(minutes=35)
            
            # Get bookings for 2-hour reminder
            two_hour_result = await db.execute(
                select(Booking)
                .where(
                    and_(
                        Booking.status == 'Confirmed',
                        Booking.session_date >= two_hour_window_start,
                        Booking.session_date <= two_hour_window_end
                    )
                )
                .options(
                    selectinload(Booking.photographer),
                    selectinload(Booking.creator)
                )
            )
            two_hour_bookings = two_hour_result.scalars().all()
            
            # Get bookings for 30-minute reminder
            thirty_min_result = await db.execute(
                select(Booking)
                .where(
                    and_(
                        Booking.status == 'Confirmed',
                        Booking.session_date >= thirty_min_window_start,
                        Booking.session_date <= thirty_min_window_end
                    )
                )
                .options(
                    selectinload(Booking.photographer),
                    selectinload(Booking.creator)
                )
            )
            thirty_min_bookings = thirty_min_result.scalars().all()
            
            reminders_sent = 0
            
            # Send 2-hour reminders
            for booking in two_hour_bookings:
                surfer_name = booking.creator.full_name if booking.creator else "Surfer"
                photographer_name = booking.photographer.full_name if booking.photographer else "Photographer"
                location = booking.location or "the beach"
                
                # Notify surfer
                surfer_msg = f"Your session is in 2 hours - time to wax up! Meet {photographer_name} at {location}"
                try:
                    await send_push_notification(
                        user_id=booking.creator_id,
                        title="Session in 2 Hours!",
                        body=surfer_msg,
                        data={"booking_id": booking.id, "type": "session_reminder"},
                        db=db
                    )
                    # Create in-app notification
                    notification = Notification(
                        user_id=booking.creator_id,
                        type='session_reminder',
                        title='Session in 2 Hours!',
                        body=surfer_msg,
                        data=json.dumps({"booking_id": booking.id})
                    )
                    db.add(notification)
                    reminders_sent += 1
                except Exception as e:
                    logger.warning(f"[Scheduler] Failed to send 2hr reminder to surfer: {e}")
                
                # Notify photographer
                photographer_msg = f"Session with {surfer_name} in 2 hours at {location}. Get your gear ready!"
                try:
                    await send_push_notification(
                        user_id=booking.photographer_id,
                        title="Session in 2 Hours!",
                        body=photographer_msg,
                        data={"booking_id": booking.id, "type": "session_reminder"},
                        db=db
                    )
                    notification = Notification(
                        user_id=booking.photographer_id,
                        type='session_reminder',
                        title='Session in 2 Hours!',
                        body=photographer_msg,
                        data=json.dumps({"booking_id": booking.id})
                    )
                    db.add(notification)
                    reminders_sent += 1
                except Exception as e:
                    logger.warning(f"[Scheduler] Failed to send 2hr reminder to photographer: {e}")
            
            # Send 30-minute reminders
            for booking in thirty_min_bookings:
                surfer_name = booking.creator.full_name if booking.creator else "Surfer"
                photographer_name = booking.photographer.full_name if booking.photographer else "Photographer"
                location = booking.location or "the beach"
                
                # Notify surfer
                surfer_msg = f"Session starting soon! Head to {location} now - {photographer_name} is waiting!"
                try:
                    await send_push_notification(
                        user_id=booking.creator_id,
                        title="Session Starting Soon!",
                        body=surfer_msg,
                        data={"booking_id": booking.id, "type": "session_reminder"},
                        db=db
                    )
                    notification = Notification(
                        user_id=booking.creator_id,
                        type='session_reminder',
                        title='Session Starting Soon!',
                        body=surfer_msg,
                        data=json.dumps({"booking_id": booking.id})
                    )
                    db.add(notification)
                    reminders_sent += 1
                except Exception as e:
                    logger.warning(f"[Scheduler] Failed to send 30min reminder to surfer: {e}")
                
                # Notify photographer
                photographer_msg = f"Session with {surfer_name} starting soon at {location}. Time to capture some waves!"
                try:
                    await send_push_notification(
                        user_id=booking.photographer_id,
                        title="Session Starting Soon!",
                        body=photographer_msg,
                        data={"booking_id": booking.id, "type": "session_reminder"},
                        db=db
                    )
                    notification = Notification(
                        user_id=booking.photographer_id,
                        type='session_reminder',
                        title='Session Starting Soon!',
                        body=photographer_msg,
                        data=json.dumps({"booking_id": booking.id})
                    )
                    db.add(notification)
                    reminders_sent += 1
                except Exception as e:
                    logger.warning(f"[Scheduler] Failed to send 30min reminder to photographer: {e}")
            
            await db.commit()
            
            if reminders_sent > 0:
                logger.info(f"[Scheduler] Sent {reminders_sent} session reminders")
    
    except Exception as e:
        logger.error(f"[Scheduler] Error sending session reminders: {str(e)}")


async def expire_booking_invites_task():
    """
    Expire pending booking invites that have passed their expiration time.
    When an invite expires, notify the next person on the waitlist.
    Runs every 5 minutes to check for expired invites.
    """
    from database import async_session_maker
    from sqlalchemy import select, update
    from sqlalchemy.orm import selectinload
    from models import BookingInvite, Notification, Booking, Profile, BookingWaitlist
    
    logger.info("[Scheduler] Checking for expired booking invites...")
    
    try:
        async with async_session_maker() as db:
            now = datetime.now(timezone.utc)
            
            # Find all pending invites that have expired
            result = await db.execute(
                select(BookingInvite)
                .where(BookingInvite.status == 'pending')
                .where(BookingInvite.expires_at != None)
                .where(BookingInvite.expires_at < now)
            )
            expired_invites = result.scalars().all()
            
            expired_count = 0
            waitlist_notified = 0
            
            for invite in expired_invites:
                # Update status to expired
                invite.status = 'expired'
                invite.responded_at = now
                expired_count += 1
                
                # Get booking info
                booking_result = await db.execute(
                    select(Booking).where(Booking.id == invite.booking_id)
                    .options(selectinload(Booking.participants))
                )
                booking = booking_result.scalar_one_or_none()
                
                inviter_result = await db.execute(
                    select(Profile).where(Profile.id == invite.inviter_id)
                )
                inviter = inviter_result.scalar_one_or_none()
                
                # Notify the inviter that the invite expired
                if booking and inviter:
                    notification = Notification(
                        user_id=invite.inviter_id,
                        type='invite_expired',
                        title='Invite Expired',
                        body=f'Your crew invite for the session at {booking.location} has expired.',
                        data=json.dumps({
                            "booking_id": invite.booking_id,
                            "invite_id": invite.id,
                            "deep_link": f"/bookings?highlight={invite.booking_id}"
                        })
                    )
                    db.add(notification)
                    
                    # WAITLIST AUTO-FILL: Notify next person on waitlist if enabled
                    if booking.waitlist_enabled:
                        # Find next waiting person
                        waitlist_result = await db.execute(
                            select(BookingWaitlist)
                            .where(BookingWaitlist.booking_id == invite.booking_id)
                            .where(BookingWaitlist.status == 'waiting')
                            .order_by(BookingWaitlist.position.asc())
                            .limit(1)
                        )
                        next_in_line = waitlist_result.scalar_one_or_none()
                        
                        if next_in_line:
                            # Set claim window
                            claim_minutes = booking.waitlist_claim_minutes or 30
                            next_in_line.status = 'notified'
                            next_in_line.notified_at = now
                            next_in_line.claim_expires_at = now + timedelta(minutes=claim_minutes)
                            
                            # Send notification
                            waitlist_notification = Notification(
                                user_id=next_in_line.user_id,
                                type='waitlist_spot_open',
                                title='🎉 Spot Available!',
                                body=f'A spot opened up for {booking.location}! Claim it within {claim_minutes} minutes.',
                                data=json.dumps({
                                    "booking_id": invite.booking_id,
                                    "claim_expires_at": next_in_line.claim_expires_at.isoformat(),
                                    "deep_link": f"/bookings?claim={invite.booking_id}"
                                })
                            )
                            db.add(waitlist_notification)
                            waitlist_notified += 1
                            logger.info(f"[Scheduler] Notified waitlist user {next_in_line.user_id} for booking {invite.booking_id}")
            
            # Also check for expired waitlist claim windows
            expired_claims_result = await db.execute(
                select(BookingWaitlist)
                .where(BookingWaitlist.status == 'notified')
                .where(BookingWaitlist.claim_expires_at != None)
                .where(BookingWaitlist.claim_expires_at < now)
            )
            expired_claims = expired_claims_result.scalars().all()
            
            for claim in expired_claims:
                claim.status = 'expired'
                
                # Notify next person in line
                booking_result = await db.execute(
                    select(Booking).where(Booking.id == claim.booking_id)
                )
                booking = booking_result.scalar_one_or_none()
                
                if booking and booking.waitlist_enabled:
                    next_result = await db.execute(
                        select(BookingWaitlist)
                        .where(BookingWaitlist.booking_id == claim.booking_id)
                        .where(BookingWaitlist.status == 'waiting')
                        .order_by(BookingWaitlist.position.asc())
                        .limit(1)
                    )
                    next_person = next_result.scalar_one_or_none()
                    
                    if next_person:
                        claim_minutes = booking.waitlist_claim_minutes or 30
                        next_person.status = 'notified'
                        next_person.notified_at = now
                        next_person.claim_expires_at = now + timedelta(minutes=claim_minutes)
                        
                        waitlist_notification = Notification(
                            user_id=next_person.user_id,
                            type='waitlist_spot_open',
                            title='🎉 Spot Available!',
                            body=f'A spot opened up for {booking.location}! Claim it within {claim_minutes} minutes.',
                            data=json.dumps({
                                "booking_id": claim.booking_id,
                                "claim_expires_at": next_person.claim_expires_at.isoformat(),
                                "deep_link": f"/bookings?claim={claim.booking_id}"
                            })
                        )
                        db.add(waitlist_notification)
                        waitlist_notified += 1
            
            if expired_count > 0 or waitlist_notified > 0:
                await db.commit()
                logger.info(f"[Scheduler] Expired {expired_count} booking invites, notified {waitlist_notified} waitlist users")
    
    except Exception as e:
        logger.error(f"[Scheduler] Error expiring booking invites: {str(e)}")


