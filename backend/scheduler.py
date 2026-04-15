"""
Background task scheduler for Raw Surf OS
Handles:
- Surf alert checking (every 15 minutes)
- Story expiration cleanup (every hour)
- Push notification delivery
"""
import asyncio
import logging
from datetime import datetime, timezone, timedelta
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from apscheduler.triggers.cron import CronTrigger
import httpx
import json
import os

logger = logging.getLogger(__name__)

# VAPID keys for push notifications
VAPID_PRIVATE_KEY = os.environ.get('VAPID_PRIVATE_KEY', 'your-private-key')
VAPID_PUBLIC_KEY = os.environ.get('VAPID_PUBLIC_KEY', 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U')
VAPID_CLAIMS = {"sub": "mailto:alerts@rawsurfos.com"}

# Initialize scheduler
scheduler = AsyncIOScheduler()

async def check_surf_alerts_task():
    """
    Check all active surf alerts against current conditions
    Triggered every 15 minutes
    """
    from database import async_session_maker
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload
    from models import SurfAlert, Notification, PushSubscription
    
    logger.info("[Scheduler] Running surf alert check...")
    
    OPEN_METEO_MARINE_URL = "https://marine-api.open-meteo.com/v1/marine"
    
    try:
        async with async_session_maker() as db:
            # Get all active alerts with spot data
            result = await db.execute(
                select(SurfAlert)
                .where(SurfAlert.is_active == True)
                .options(selectinload(SurfAlert.spot), selectinload(SurfAlert.user))
            )
            alerts = result.scalars().all()
            
            logger.info(f"[Scheduler] Checking {len(alerts)} active alerts")
            
            triggered_count = 0
            
            async with httpx.AsyncClient(timeout=10.0) as client:
                # Group alerts by spot to reduce API calls
                spot_alerts = {}
                for alert in alerts:
                    if alert.spot:
                        if alert.spot.id not in spot_alerts:
                            spot_alerts[alert.spot.id] = {
                                "spot": alert.spot,
                                "alerts": []
                            }
                        spot_alerts[alert.spot.id]["alerts"].append(alert)
                
                for spot_id, data in spot_alerts.items():
                    spot = data["spot"]
                    spot_alerts_list = data["alerts"]
                    
                    try:
                        # Fetch current conditions
                        response = await client.get(OPEN_METEO_MARINE_URL, params={
                            "latitude": spot.latitude,
                            "longitude": spot.longitude,
                            "current": "wave_height",
                            "timezone": "America/New_York"
                        })
                        
                        if response.status_code != 200:
                            continue
                        
                        wave_data = response.json()
                        wave_height_m = wave_data.get("current", {}).get("wave_height", 0)
                        wave_height_ft = wave_height_m * 3.28084 if wave_height_m else 0
                        
                        # Check each alert for this spot
                        for alert in spot_alerts_list:
                            matches = True
                            
                            if alert.min_wave_height and wave_height_ft < alert.min_wave_height:
                                matches = False
                            if alert.max_wave_height and wave_height_ft > alert.max_wave_height:
                                matches = False
                            
                            if matches:
                                # Update alert tracking
                                alert.trigger_count += 1
                                alert.last_triggered = datetime.now(timezone.utc)
                                
                                # Create in-app notification
                                notification = Notification(
                                    user_id=alert.user_id,
                                    type="surf_alert",
                                    title=f"🌊 {spot.name} is firing!",
                                    body=f"Waves are {wave_height_ft:.1f}ft - perfect conditions!",
                                    data=json.dumps({
                                        "spot_id": spot.id,
                                        "spot_name": spot.name,
                                        "wave_height_ft": round(wave_height_ft, 1),
                                        "alert_id": alert.id,
                                        "type": "surf_alert"
                                    })
                                )
                                db.add(notification)
                                
                                # Send push notification if enabled
                                if alert.notify_push:
                                    await send_push_notification(
                                        db,
                                        alert.user_id,
                                        title=f"🌊 {spot.name} is firing!",
                                        body=f"Waves are {wave_height_ft:.1f}ft - Go get some!",
                                        data={
                                            "type": "surf_alert",
                                            "spot_id": spot.id
                                        }
                                    )
                                
                                triggered_count += 1
                                logger.info(f"[Scheduler] Alert triggered for user {alert.user_id} at {spot.name}")
                    
                    except Exception as e:
                        logger.error(f"[Scheduler] Error checking spot {spot.name}: {str(e)}")
            
            await db.commit()
            logger.info(f"[Scheduler] Alert check complete. Triggered {triggered_count} alerts")
    
    except Exception as e:
        logger.error(f"[Scheduler] Error in surf alert task: {str(e)}")

async def send_push_notification(db, user_id: str, title: str, body: str, data: dict = None):
    """Send push notification to a user's subscribed devices"""
    from sqlalchemy import select
    from models import PushSubscription
    
    try:
        from pywebpush import webpush, WebPushException
        
        result = await db.execute(
            select(PushSubscription)
            .where(PushSubscription.user_id == user_id)
            .where(PushSubscription.is_active == True)
        )
        subscriptions = result.scalars().all()
        
        payload = json.dumps({
            "title": title,
            "body": body,
            "icon": "https://customer-assets.emergentagent.com/job_raw-surf-os/artifacts/9llcl5mg_Rawig6-500x500.png",
            "badge": "https://customer-assets.emergentagent.com/job_raw-surf-os/artifacts/9llcl5mg_Rawig6-500x500.png",
            "data": data or {},
            "tag": "surf-alert",
            "requireInteraction": True
        })
        
        for sub in subscriptions:
            try:
                webpush(
                    subscription_info={
                        "endpoint": sub.endpoint,
                        "keys": {
                            "p256dh": sub.p256dh_key,
                            "auth": sub.auth_key
                        }
                    },
                    data=payload,
                    vapid_private_key=VAPID_PRIVATE_KEY,
                    vapid_claims=VAPID_CLAIMS
                )
                logger.info(f"[Push] Sent notification to user {user_id}")
            except WebPushException as e:
                if e.response and e.response.status_code == 410:
                    # Subscription expired, mark as inactive
                    sub.is_active = False
                    logger.info(f"[Push] Subscription expired for user {user_id}")
                else:
                    logger.error(f"[Push] Error sending to user {user_id}: {str(e)}")
    
    except ImportError:
        logger.warning("[Push] pywebpush not installed, skipping push notification")
    except Exception as e:
        logger.error(f"[Push] Error: {str(e)}")

async def cleanup_expired_stories_task():
    """
    Mark expired stories as expired
    Triggered every hour
    """
    from database import async_session_maker
    from sqlalchemy import select
    from models import Story
    
    logger.info("[Scheduler] Running story cleanup...")
    
    try:
        async with async_session_maker() as db:
            now = datetime.now(timezone.utc)
            
            result = await db.execute(
                select(Story).where(
                    Story.expires_at <= now,
                    Story.is_expired == False
                )
            )
            expired_stories = result.scalars().all()
            
            for story in expired_stories:
                story.is_expired = True
            
            await db.commit()
            logger.info(f"[Scheduler] Cleaned up {len(expired_stories)} expired stories")
    
    except Exception as e:
        logger.error(f"[Scheduler] Error in story cleanup: {str(e)}")


async def monthly_leaderboard_reset_task():
    """
    Archive leaderboard data and reset for new month.
    Runs on the 1st of each month at 00:05 UTC.
    """
    from database import async_session_maker
    from routes.leaderboard import monthly_leaderboard_reset
    
    logger.info("[Scheduler] Running monthly leaderboard reset...")
    
    try:
        async with async_session_maker() as db:
            result = await monthly_leaderboard_reset(db)
            logger.info(f"[Scheduler] Leaderboard reset complete: {result}")
    except Exception as e:
        logger.error(f"[Scheduler] Error in leaderboard reset: {str(e)}")


async def weekly_grom_report_task():
    """
    Send weekly Grom activity reports to parents every Sunday at 9am EST.
    Aggregates: Waves caught, Earnings, Highlights, Posts, Badges earned.
    """
    from database import async_session_maker
    from sqlalchemy import select, func
    from models import Profile, RoleEnum, Post, PhotoTag
    from datetime import timedelta
    import resend
    import os
    
    logger.info("[Scheduler] Running weekly Grom report generation...")
    
    RESEND_API_KEY = os.environ.get('RESEND_API_KEY')
    if not RESEND_API_KEY:
        logger.warning("[Scheduler] RESEND_API_KEY not set, skipping weekly Grom reports")
        return
    
    resend.api_key = RESEND_API_KEY
    
    try:
        async with async_session_maker() as db:
            # Get all Grom Parents with linked Groms
            parent_result = await db.execute(
                select(Profile).where(Profile.role == RoleEnum.GROM_PARENT)
            )
            parents = parent_result.scalars().all()
            
            reports_sent = 0
            week_ago = datetime.now(timezone.utc) - timedelta(days=7)
            
            for parent in parents:
                linked_groms = parent.linked_grom_ids or []
                if not linked_groms:
                    continue
                
                # Get grom data
                grom_result = await db.execute(
                    select(Profile).where(Profile.id.in_(linked_groms))
                )
                groms = grom_result.scalars().all()
                
                if not groms:
                    continue
                
                # Build report for each grom
                grom_reports = []
                for grom in groms:
                    # Count posts this week
                    post_count = await db.execute(
                        select(func.count(Post.id)).where(
                            Post.user_id == grom.id,
                            Post.created_at >= week_ago
                        )
                    )
                    posts_this_week = post_count.scalar() or 0
                    
                    # Count highlights (tags) this week
                    highlight_count = await db.execute(
                        select(func.count(PhotoTag.id)).where(
                            PhotoTag.tagged_user_id == grom.id,
                            PhotoTag.created_at >= week_ago
                        )
                    )
                    highlights_this_week = highlight_count.scalar() or 0
                    
                    grom_reports.append({
                        "name": grom.full_name,
                        "posts": posts_this_week,
                        "highlights": highlights_this_week,
                        "xp": grom.total_xp or 0,
                        "level": grom.surf_level or "Beginner"
                    })
                
                # Generate email HTML
                grom_html = ""
                for gr in grom_reports:
                    grom_html += f"""
                    <div style="background: #1f1f1f; padding: 16px; border-radius: 12px; margin-bottom: 12px;">
                        <h3 style="color: #ffffff; margin: 0 0 8px 0;">{gr['name']}</h3>
                        <div style="display: flex; gap: 24px; color: #a1a1aa;">
                            <span>📝 {gr['posts']} Posts</span>
                            <span>📸 {gr['highlights']} Highlights</span>
                            <span>⭐ {gr['xp']} XP</span>
                        </div>
                        <p style="color: #facc15; margin: 8px 0 0 0; font-size: 14px;">Level: {gr['level']}</p>
                    </div>
                    """
                
                email_html = f"""
                <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #0a0a0a; color: #ffffff;">
                    <div style="text-align: center; margin-bottom: 24px;">
                        <h1 style="color: #facc15; margin: 0;">🏄 Weekly Grom Report</h1>
                        <p style="color: #a1a1aa; margin-top: 8px;">Here's what your Groms have been up to!</p>
                    </div>
                    
                    {grom_html}
                    
                    <div style="text-align: center; margin-top: 24px;">
                        <a href="https://raw-surf-os.preview.emergentagent.com/grom-hq" 
                           style="display: inline-block; background: linear-gradient(to right, #facc15, #f97316); 
                                  color: #000; padding: 12px 24px; text-decoration: none; 
                                  border-radius: 50px; font-weight: bold;">
                            View Full Activity in Grom HQ
                        </a>
                    </div>
                    
                    <hr style="border: none; border-top: 1px solid #333; margin: 24px 0;">
                    <p style="color: #6b7280; font-size: 12px; text-align: center;">
                        Raw Surf OS - Keeping parents connected 🤙
                    </p>
                </div>
                """
                
                try:
                    resend.Emails.send({
                        "from": "Raw Surf <noreply@raw.surf>",
                        "to": [parent.email],
                        "subject": f"🏄 Weekly Grom Report - {datetime.now().strftime('%B %d')}",
                        "html": email_html
                    })
                    reports_sent += 1
                except Exception as e:
                    logger.error(f"[Scheduler] Failed to send weekly report to {parent.email}: {e}")
            
            logger.info(f"[Scheduler] Sent {reports_sent} weekly Grom reports")
    
    except Exception as e:
        logger.error(f"[Scheduler] Error in weekly Grom report: {str(e)}")


# ============================================================
# CREW HUB: PAYMENT WINDOW EXPIRY SCHEDULER
# ============================================================

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
    from routes.push import notify_crew_session_confirmed
    
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
    from routes.push import notify_crew_payment_expiring
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


async def aggregate_platform_metrics_task():
    """
    Aggregate platform metrics every 6 hours for fast Admin Dashboard loading.
    This prevents recalculating millions of rows on every page refresh.
    """
    logger.info("[Scheduler] Starting platform metrics aggregation...")
    
    try:
        from database import async_session_maker
        async with async_session_maker() as db:
            from sqlalchemy import func, select
            from models import Profile, Booking, PaymentTransaction, CreditTransaction, PlatformMetrics, RoleEnum
            from datetime import datetime, timezone, timedelta
            import json
            
            # 1. FINANCIAL METRICS
            # Total credit liability
            liability = await db.execute(select(func.sum(Profile.credit_balance)))
            total_liability = liability.scalar() or 0
            
            # Revenue last 30 days
            thirty_days_ago = datetime.now(timezone.utc) - timedelta(days=30)
            revenue = await db.execute(
                select(func.sum(PaymentTransaction.amount))
                .where(PaymentTransaction.payment_status == 'completed')
                .where(PaymentTransaction.created_at >= thirty_days_ago)
            )
            total_revenue = revenue.scalar() or 0
            
            # 2. ECOSYSTEM METRICS
            # Role distribution
            role_counts = {}
            for role in RoleEnum:
                count = await db.execute(
                    select(func.count(Profile.id)).where(Profile.role == role)
                )
                role_counts[role.value] = count.scalar() or 0
            
            # Booking efficiency
            ondemand = await db.execute(
                select(func.count(Booking.id)).where(Booking.booking_type == 'request_pro')
            )
            scheduled = await db.execute(
                select(func.count(Booking.id)).where(Booking.booking_type != 'request_pro')
            )
            
            metrics_data = {
                "financial": {
                    "total_credit_liability": round(total_liability, 2),
                    "revenue_30d": round(total_revenue, 2)
                },
                "ecosystem": {
                    "role_distribution": role_counts,
                    "booking_efficiency": {
                        "on_demand": ondemand.scalar() or 0,
                        "scheduled": scheduled.scalar() or 0
                    }
                },
                "computed_at": datetime.now(timezone.utc).isoformat()
            }
            
            # Store in cache table
            try:
                cache_entry = PlatformMetrics(
                    metric_type="platform_overview",
                    data=json.dumps(metrics_data),
                    computed_at=datetime.now(timezone.utc)
                )
                db.add(cache_entry)
                await db.commit()
                logger.info(f"[Scheduler] Platform metrics aggregated: liability=${total_liability:.2f}, revenue=${total_revenue:.2f}")
            except Exception as e:
                logger.warning(f"[Scheduler] Could not cache metrics (table may not exist): {e}")
                # Still log success for the computation
                logger.info(f"[Scheduler] Platform metrics computed (not cached): liability=${total_liability:.2f}")
    
    except Exception as e:
        logger.error(f"[Scheduler] Error aggregating platform metrics: {str(e)}")


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
    from routes.push import send_push_notification
    
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


async def auto_release_escrow_task():
    """
    Automatically release escrow to photographers 7 days after session
    if they haven't uploaded content yet.
    
    This prevents funds from being stuck indefinitely.
    Runs daily at 3am UTC.
    """
    from database import async_session_maker
    from sqlalchemy import select, and_
    from sqlalchemy.orm import selectinload
    from models import Booking, Profile, Notification
    from utils.credits import add_credits
    
    logger.info("[Scheduler] Checking for auto escrow release (7 days after session)...")
    
    try:
        async with async_session_maker() as db:
            now = datetime.now(timezone.utc)
            from datetime import timedelta
            seven_days_ago = now - timedelta(days=7)
            
            # Find bookings that:
            # 1. Status is 'Confirmed' or 'Completed' (session happened)
            # 2. Session date was 7+ days ago
            # 3. Escrow is still held
            # 4. Content NOT delivered (photographer didn't upload)
            result = await db.execute(
                select(Booking)
                .where(
                    and_(
                        Booking.status.in_(['Confirmed', 'Completed']),
                        Booking.session_date <= seven_days_ago,
                        Booking.escrow_status == 'held',
                        Booking.escrow_amount > 0
                    )
                )
                .options(
                    selectinload(Booking.photographer),
                    selectinload(Booking.creator)
                )
            )
            bookings = result.scalars().all()
            
            released_count = 0
            
            for booking in bookings:
                try:
                    # Release escrow to photographer
                    await add_credits(
                        user_id=booking.photographer_id,
                        amount=booking.escrow_amount,
                        transaction_type='escrow_auto_release',
                        db=db,
                        description=f"Auto-released 7 days after session (content not required)",
                        reference_type='booking',
                        reference_id=booking.id,
                        counterparty_id=booking.creator_id
                    )
                    
                    booking.escrow_status = 'released'
                    booking.escrow_released_at = now
                    
                    # Mark booking as completed if not already
                    if booking.status == 'Confirmed':
                        booking.status = 'Completed'
                    
                    # Notify photographer
                    photographer_name = booking.photographer.full_name if booking.photographer else "Photographer"
                    notification = Notification(
                        user_id=booking.photographer_id,
                        type='escrow_auto_released',
                        title='Payment Released!',
                        body=f'${booking.escrow_amount:.2f} auto-released for session on {booking.session_date.strftime("%b %d")}',
                        data=json.dumps({
                            "booking_id": booking.id,
                            "amount": booking.escrow_amount,
                            "reason": "auto_7_days"
                        })
                    )
                    db.add(notification)
                    
                    # Notify surfer that payment was released
                    surfer_notification = Notification(
                        user_id=booking.creator_id,
                        type='escrow_released_to_photographer',
                        title='Session Payment Released',
                        body=f'Payment for your session with {photographer_name} has been released.',
                        data=json.dumps({
                            "booking_id": booking.id,
                            "photographer_name": photographer_name
                        })
                    )
                    db.add(surfer_notification)
                    
                    released_count += 1
                    logger.info(f"[Scheduler] Auto-released escrow for booking {booking.id}: ${booking.escrow_amount}")
                    
                except Exception as e:
                    logger.error(f"[Scheduler] Failed to auto-release escrow for booking {booking.id}: {e}")
            
            await db.commit()
            
            if released_count > 0:
                logger.info(f"[Scheduler] Auto-released escrow for {released_count} bookings")
    
    except Exception as e:
        logger.error(f"[Scheduler] Error in auto escrow release: {str(e)}")


async def process_selection_deadline_expiry_task():
    """
    Process expired surfer selection deadlines.
    - If auto_select_on_expiry=True: Auto-select top photos based on view count/favorites
    - If auto_select_on_expiry=False: Forfeit selection (photographer keeps photos)
    - If auto_select_on_expiry=None and not set: Send reminder notification
    
    Runs daily at 4am UTC.
    """
    from database import async_session_maker
    from sqlalchemy import select
    from models import (
        SurferSelectionQuota, Gallery, GalleryItem, SurferGalleryItem,
        Profile, Notification
    )
    
    logger.info("[Scheduler] Processing selection deadline expiry...")
    
    try:
        async with async_session_maker() as db:
            now = datetime.now(timezone.utc)
            
            # Find expired quotas that haven't been processed
            expired_quotas_result = await db.execute(
                select(SurferSelectionQuota)
                .where(SurferSelectionQuota.selection_deadline <= now)
                .where(SurferSelectionQuota.status == 'pending_selection')
            )
            expired_quotas = expired_quotas_result.scalars().all()
            
            logger.info(f"[Scheduler] Found {len(expired_quotas)} expired selection quotas")
            
            processed_count = 0
            auto_selected_count = 0
            forfeited_count = 0
            reminded_count = 0
            
            for quota in expired_quotas:
                try:
                    surfer_id = quota.surfer_id
                    gallery_id = quota.gallery_id
                    
                    # Get surfer info
                    surfer_result = await db.execute(
                        select(Profile).where(Profile.id == surfer_id)
                    )
                    surfer = surfer_result.scalar_one_or_none()
                    
                    if not surfer:
                        continue
                    
                    # Get gallery info
                    gallery_result = await db.execute(
                        select(Gallery).where(Gallery.id == gallery_id)
                    )
                    gallery = gallery_result.scalar_one_or_none()
                    
                    if not gallery:
                        continue
                    
                    if quota.auto_select_on_expiry is True:
                        # AUTO-SELECT: Pick top photos based on engagement
                        remaining_picks = quota.photos_allowed - quota.photos_selected
                        
                        if remaining_picks > 0:
                            # Get gallery items not yet selected, sorted by engagement
                            available_items_result = await db.execute(
                                select(GalleryItem)
                                .where(GalleryItem.gallery_id == gallery_id)
                                .where(GalleryItem.is_selected_by_surfer == False)
                                .order_by(
                                    GalleryItem.is_favorite.desc(),
                                    GalleryItem.view_count.desc()
                                )
                                .limit(remaining_picks)
                            )
                            items_to_select = available_items_result.scalars().all()
                            
                            for item in items_to_select:
                                # Create surfer gallery item (selection)
                                surfer_item = SurferGalleryItem(
                                    surfer_id=surfer_id,
                                    gallery_item_id=item.id,
                                    selection_type='auto_selected',
                                    selected_at=now
                                )
                                db.add(surfer_item)
                                item.is_selected_by_surfer = True
                                quota.photos_selected += 1
                            
                            quota.status = 'auto_completed'
                            auto_selected_count += 1
                            
                            # Notify surfer
                            notification = Notification(
                                user_id=surfer_id,
                                type='selection_auto_completed',
                                title='Photos Auto-Selected',
                                body=f"Your selection deadline expired. We auto-selected {len(items_to_select)} photos from '{gallery.title}' based on your viewing history.",
                                data={"gallery_id": gallery_id, "count": len(items_to_select)}
                            )
                            db.add(notification)
                        else:
                            quota.status = 'completed'
                    
                    elif quota.auto_select_on_expiry is False:
                        # FORFEIT: User chose to lose remaining selections
                        quota.status = 'forfeited'
                        forfeited_count += 1
                        
                        # Notify surfer
                        notification = Notification(
                            user_id=surfer_id,
                            type='selection_forfeited',
                            title='Selection Period Ended',
                            body=f"Your selection period for '{gallery.title}' has ended. Remaining picks were forfeited.",
                            data={"gallery_id": gallery_id}
                        )
                        db.add(notification)
                    
                    else:
                        # UNDECIDED: Send reminder and extend by 3 days (once)
                        if not quota.expiry_reminder_sent:
                            quota.expiry_reminder_sent = True
                            quota.selection_deadline = now + timedelta(days=3)  # Grace period
                            reminded_count += 1
                            
                            # Notify surfer to make a choice
                            notification = Notification(
                                user_id=surfer_id,
                                type='selection_expiry_warning',
                                title='Selection Deadline Extended',
                                body=f"You have 3 more days to select your photos from '{gallery.title}'. Please choose: auto-select or forfeit.",
                                data={
                                    "gallery_id": gallery_id,
                                    "remaining_picks": quota.photos_allowed - quota.photos_selected,
                                    "action_required": True
                                }
                            )
                            db.add(notification)
                        else:
                            # Already reminded once, force auto-select
                            quota.auto_select_on_expiry = True
                            # Will be processed in next run
                    
                    processed_count += 1
                    
                except Exception as e:
                    logger.error(f"[Scheduler] Error processing quota {quota.id}: {str(e)}")
                    continue
            
            await db.commit()
            
            if processed_count > 0:
                logger.info(f"[Scheduler] Processed {processed_count} expired quotas: {auto_selected_count} auto-selected, {forfeited_count} forfeited, {reminded_count} reminded")
    
    except Exception as e:
        logger.error(f"[Scheduler] Error in selection deadline expiry: {str(e)}")


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


async def send_weekly_sales_reports_task():
    """
    Send weekly sales report emails to photographers.
    Runs every Monday at 9am UTC.
    """
    from database import async_session_maker
    from sqlalchemy import select, func, text
    from models import Profile, GalleryPurchase, GalleryItem, CreditTransaction, Notification
    from datetime import timedelta
    
    logger.info("[Scheduler] Sending weekly sales reports to photographers...")
    
    try:
        async with async_session_maker() as db:
            # Get all photographers with sales activity
            week_ago = datetime.now(timezone.utc) - timedelta(days=7)
            
            # Find photographers with any gallery sales or earnings in the past week
            raw_query = text("""
                SELECT DISTINCT p.id, p.email, p.full_name
                FROM profiles p
                WHERE p.role IN ('photographer', 'pro_photographer', 'approved_pro_photographer')
                AND EXISTS (
                    SELECT 1 FROM credit_transactions ct 
                    WHERE ct.user_id = p.id 
                    AND ct.amount > 0 
                    AND ct.created_at >= :week_ago
                )
            """)
            
            result = await db.execute(raw_query, {"week_ago": week_ago})
            photographers = result.fetchall()
            
            logger.info(f"[Scheduler] Found {len(photographers)} photographers with activity")
            
            reports_sent = 0
            
            for photographer in photographers:
                photographer_id = photographer.id
                photographer_email = photographer.email
                photographer_name = photographer.full_name or "Photographer"
                
                try:
                    # Get this week's earnings breakdown
                    earnings_query = text("""
                        SELECT 
                            SUM(CASE WHEN transaction_type IN ('gallery_sale', 'gallery_purchase') THEN amount ELSE 0 END) as gallery_sales,
                            SUM(CASE WHEN transaction_type IN ('live_session_buyin', 'live_session_earning', 'live_photo_purchase') THEN amount ELSE 0 END) as live_sessions,
                            SUM(CASE WHEN transaction_type IN ('booking_earning', 'booking_payment') THEN amount ELSE 0 END) as bookings,
                            SUM(amount) as total
                        FROM credit_transactions 
                        WHERE user_id = :photographer_id 
                        AND amount > 0 
                        AND created_at >= :week_ago
                    """)
                    
                    earnings_result = await db.execute(
                        earnings_query, 
                        {"photographer_id": photographer_id, "week_ago": week_ago}
                    )
                    earnings = earnings_result.fetchone()
                    
                    total_earnings = float(earnings.total or 0)
                    gallery_sales = float(earnings.gallery_sales or 0)
                    live_sessions = float(earnings.live_sessions or 0)
                    bookings = float(earnings.bookings or 0)
                    
                    if total_earnings <= 0:
                        continue  # Skip if no actual earnings
                    
                    # Get top selling items
                    top_items_query = text("""
                        SELECT gi.id, gi.title, gi.thumbnail_url, COUNT(gp.id) as sales
                        FROM gallery_items gi
                        JOIN gallery_purchases gp ON gi.id = gp.gallery_item_id
                        WHERE gi.photographer_id = :photographer_id
                        AND gp.purchased_at >= :week_ago
                        GROUP BY gi.id, gi.title, gi.thumbnail_url
                        ORDER BY sales DESC
                        LIMIT 3
                    """)
                    
                    top_items_result = await db.execute(
                        top_items_query,
                        {"photographer_id": photographer_id, "week_ago": week_ago}
                    )
                    top_items = top_items_result.fetchall()
                    
                    # Create in-app notification with summary
                    summary_text = f"Weekly earnings: ${total_earnings:.2f}"
                    if gallery_sales > 0:
                        summary_text += f" (Gallery: ${gallery_sales:.2f})"
                    if live_sessions > 0:
                        summary_text += f" (Live: ${live_sessions:.2f})"
                    if bookings > 0:
                        summary_text += f" (Bookings: ${bookings:.2f})"
                    
                    if top_items:
                        summary_text += f". Top seller: {top_items[0].title or 'Untitled'}"
                    
                    notification = Notification(
                        user_id=photographer_id,
                        type='weekly_sales_report',
                        title='Weekly Sales Report',
                        body=summary_text,
                        data=json.dumps({
                            "total_earnings": total_earnings,
                            "gallery_sales": gallery_sales,
                            "live_sessions": live_sessions,
                            "bookings": bookings,
                            "top_items": [{"id": str(item.id), "title": item.title, "sales": item.sales} for item in top_items],
                            "week_ending": datetime.now(timezone.utc).strftime("%Y-%m-%d")
                        })
                    )
                    db.add(notification)
                    
                    # Send email via Resend if configured
                    RESEND_API_KEY = os.environ.get('RESEND_API_KEY')
                    if RESEND_API_KEY and photographer_email:
                        try:
                            import resend
                            resend.api_key = RESEND_API_KEY
                            
                            # Build top items HTML
                            top_items_html = ""
                            if top_items:
                                top_items_html = "<h3 style='margin-top:20px;'>Top Sellers This Week</h3><ul>"
                                for item in top_items:
                                    top_items_html += f"<li>{item.title or 'Untitled'} - {item.sales} sales</li>"
                                top_items_html += "</ul>"
                            
                            html_content = f"""
                            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                                <h1 style="color: #06b6d4;">Weekly Sales Report</h1>
                                <p>Hi {photographer_name},</p>
                                <p>Here's your earnings summary for the past week:</p>
                                
                                <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
                                    <h2 style="color: #10b981; margin-top: 0;">Total Earnings: ${total_earnings:.2f}</h2>
                                    <ul style="list-style: none; padding: 0;">
                                        <li>Gallery Sales: ${gallery_sales:.2f}</li>
                                        <li>Live Sessions: ${live_sessions:.2f}</li>
                                        <li>Bookings: ${bookings:.2f}</li>
                                    </ul>
                                </div>
                                
                                {top_items_html}
                                
                                <p style="margin-top: 30px;">
                                    <a href="https://raw-surf-os.preview.emergentagent.com/dashboard" 
                                       style="background: #06b6d4; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
                                        View Full Dashboard
                                    </a>
                                </p>
                                
                                <p style="color: #6b7280; font-size: 12px; margin-top: 30px;">
                                    You're receiving this because you have earnings activity on Raw Surf OS.
                                </p>
                            </div>
                            """
                            
                            resend.Emails.send({
                                "from": "Raw Surf OS <noreply@rawsurfos.com>",
                                "to": [photographer_email],
                                "subject": f"Weekly Earnings Report: ${total_earnings:.2f}",
                                "html": html_content
                            })
                            logger.info(f"[Scheduler] Sent email to {photographer_email}")
                        except Exception as email_err:
                            logger.warning(f"[Scheduler] Failed to send email: {email_err}")
                    
                    reports_sent += 1
                    logger.info(f"[Scheduler] Sent weekly report to {photographer_name}: ${total_earnings:.2f}")
                    
                except Exception as e:
                    logger.error(f"[Scheduler] Failed to send weekly report to photographer {photographer_id}: {e}")
            
            await db.commit()
            logger.info(f"[Scheduler] Sent {reports_sent} weekly sales reports")
    
    except Exception as e:
        logger.error(f"[Scheduler] Error in weekly sales reports: {str(e)}")


async def cleanup_abandoned_stripe_sessions_task():
    """
    Cleanup abandoned Stripe checkout sessions.
    Marks PaymentTransactions as 'Abandoned' if older than 30 minutes and still 'Pending'.
    Also resets dispatch requests that were waiting for payment.
    
    DATA INTEGRITY: This prevents orphaned pending records from accumulating
    when users abandon Stripe checkout.
    """
    from database import async_session_maker
    from sqlalchemy import select, update
    from models import PaymentTransaction, DispatchRequest, DispatchRequestStatusEnum
    import stripe
    import os
    
    stripe.api_key = os.environ.get("STRIPE_SECRET_KEY")
    
    logger.info("[Scheduler] Running abandoned Stripe session cleanup...")
    
    try:
        async with async_session_maker() as db:
            cutoff_time = datetime.now(timezone.utc) - timedelta(minutes=30)
            
            # Find pending payment transactions older than 30 minutes
            result = await db.execute(
                select(PaymentTransaction)
                .where(
                    PaymentTransaction.payment_status == 'Pending',
                    PaymentTransaction.created_at < cutoff_time
                )
            )
            abandoned_transactions = result.scalars().all()
            
            cleaned_count = 0
            dispatch_reset_count = 0
            
            for tx in abandoned_transactions:
                try:
                    # Check actual Stripe session status
                    if stripe.api_key and tx.session_id:
                        try:
                            stripe_session = stripe.checkout.Session.retrieve(tx.session_id)
                            if stripe_session.payment_status == 'paid':
                                # Actually paid - update our record
                                tx.payment_status = 'Completed'
                                tx.status = 'Completed'
                                logger.info(f"[Scheduler] Found completed payment: {tx.session_id}")
                                continue
                            elif stripe_session.status == 'expired':
                                tx.payment_status = 'Expired'
                                tx.status = 'Expired'
                            else:
                                tx.payment_status = 'Abandoned'
                                tx.status = 'Abandoned'
                        except stripe.error.InvalidRequestError:
                            # Session doesn't exist in Stripe
                            tx.payment_status = 'Abandoned'
                            tx.status = 'Abandoned'
                    else:
                        tx.payment_status = 'Abandoned'
                        tx.status = 'Abandoned'
                    
                    # Parse metadata to find related dispatch
                    if tx.transaction_metadata:
                        try:
                            metadata = json.loads(tx.transaction_metadata)
                            dispatch_id = metadata.get('dispatch_id')
                            
                            if dispatch_id:
                                # Reset dispatch back to pending payment
                                dispatch_result = await db.execute(
                                    select(DispatchRequest)
                                    .where(
                                        DispatchRequest.id == dispatch_id,
                                        DispatchRequest.status == DispatchRequestStatusEnum.PENDING_PAYMENT
                                    )
                                )
                                dispatch = dispatch_result.scalar_one_or_none()
                                
                                if dispatch:
                                    # Mark dispatch as cancelled due to payment timeout
                                    dispatch.status = DispatchRequestStatusEnum.CANCELLED
                                    dispatch.status_changed_at = datetime.now(timezone.utc)
                                    dispatch_reset_count += 1
                                    logger.info(f"[Scheduler] Cancelled dispatch {dispatch_id} due to payment timeout")
                        except json.JSONDecodeError:
                            pass
                    
                    cleaned_count += 1
                    
                except Exception as e:
                    logger.error(f"[Scheduler] Error cleaning up transaction {tx.id}: {e}")
            
            await db.commit()
            
            if cleaned_count > 0 or dispatch_reset_count > 0:
                logger.info(f"[Scheduler] Cleaned up {cleaned_count} abandoned payment transactions, cancelled {dispatch_reset_count} dispatches")
            else:
                logger.info("[Scheduler] No abandoned Stripe sessions found")
    
    except Exception as e:
        logger.error(f"[Scheduler] Error in abandoned Stripe session cleanup: {str(e)}")


async def check_credit_transaction_integrity_task():
    """
    Periodic integrity check for credit transactions.
    Identifies orphaned records where reference_id points to non-existent entities.
    DATA INTEGRITY: Logs warnings for manual review, doesn't auto-delete.
    """
    from database import async_session_maker
    from sqlalchemy import select, text
    from models import CreditTransaction, DispatchRequest, Booking
    
    logger.info("[Scheduler] Running credit transaction integrity check...")
    
    try:
        async with async_session_maker() as db:
            # Check for orphaned dispatch references
            orphaned_dispatch_count = 0
            result = await db.execute(text('''
                SELECT COUNT(*) FROM credit_transactions ct
                WHERE ct.reference_type = 'dispatch_request'
                AND ct.reference_id IS NOT NULL
                AND NOT EXISTS (
                    SELECT 1 FROM dispatch_requests dr WHERE dr.id = ct.reference_id
                )
            '''))
            orphaned_dispatch_count = result.scalar() or 0
            
            # Check for orphaned booking references
            orphaned_booking_count = 0
            result = await db.execute(text('''
                SELECT COUNT(*) FROM credit_transactions ct
                WHERE ct.reference_type = 'booking'
                AND ct.reference_id IS NOT NULL
                AND NOT EXISTS (
                    SELECT 1 FROM bookings b WHERE b.id = ct.reference_id
                )
            '''))
            orphaned_booking_count = result.scalar() or 0
            
            if orphaned_dispatch_count > 0 or orphaned_booking_count > 0:
                logger.warning(f"[Scheduler] INTEGRITY CHECK: Found {orphaned_dispatch_count} orphaned dispatch refs, {orphaned_booking_count} orphaned booking refs in credit_transactions")
            else:
                logger.info("[Scheduler] Credit transaction integrity check passed - no orphaned records")
    
    except Exception as e:
        logger.error(f"[Scheduler] Error in credit transaction integrity check: {str(e)}")


def start_scheduler():
    """Start the background scheduler"""
    # Check surf alerts every 15 minutes
    scheduler.add_job(
        check_surf_alerts_task,
        IntervalTrigger(minutes=15),
        id='check_surf_alerts',
        name='Check surf alerts against conditions',
        replace_existing=True
    )
    
    # Clean up expired stories every hour
    scheduler.add_job(
        cleanup_expired_stories_task,
        IntervalTrigger(hours=1),
        id='cleanup_stories',
        name='Clean up expired stories',
        replace_existing=True
    )
    
    # Monthly leaderboard reset - 1st of each month at 00:05 UTC
    scheduler.add_job(
        monthly_leaderboard_reset_task,
        CronTrigger(day=1, hour=0, minute=5),
        id='monthly_leaderboard_reset',
        name='Monthly leaderboard reset and archive',
        replace_existing=True
    )
    
    # Weekly Grom Report - Every Sunday at 9am EST (14:00 UTC)
    scheduler.add_job(
        weekly_grom_report_task,
        CronTrigger(day_of_week='sun', hour=14, minute=0),
        id='weekly_grom_report',
        name='Weekly Grom activity report to parents',
        replace_existing=True
    )
    
    # ============ CREW HUB: PAYMENT WINDOW EXPIRY CHECK ============
    # Check every 5 minutes for expired payment windows
    scheduler.add_job(
        check_payment_window_expiry_task,
        IntervalTrigger(minutes=5),
        id='check_payment_expiry',
        name='Check crew payment window expiry',
        replace_existing=True
    )
    
    # Payment expiry reminder - 15 minutes before expiry
    scheduler.add_job(
        send_payment_expiry_reminders_task,
        IntervalTrigger(minutes=5),
        id='payment_expiry_reminders',
        name='Send payment expiry reminders',
        replace_existing=True
    )
    
    scheduler.add_job(
        aggregate_platform_metrics_task,
        IntervalTrigger(hours=6),
        id='platform_metrics_aggregation',
        name='Aggregate platform metrics for admin dashboard',
        replace_existing=True
    )
    
    # Session reminders - check every 5 minutes for upcoming sessions
    scheduler.add_job(
        send_session_reminders_task,
        IntervalTrigger(minutes=5),
        id='session_reminders',
        name='Send session reminder notifications',
        replace_existing=True
    )
    
    # Auto-release escrow - daily at 3am UTC for sessions 7+ days old
    scheduler.add_job(
        auto_release_escrow_task,
        CronTrigger(hour=3, minute=0),
        id='auto_escrow_release',
        name='Auto-release escrow 7 days after session',
        replace_existing=True
    )
    
    # Selection deadline expiry - daily at 4am UTC
    scheduler.add_job(
        process_selection_deadline_expiry_task,
        CronTrigger(hour=4, minute=0),
        id='selection_deadline_expiry',
        name='Process expired surfer selection deadlines',
        replace_existing=True
    )
    
    # Weekly sales reports - Every Monday at 9am UTC
    scheduler.add_job(
        send_weekly_sales_reports_task,
        CronTrigger(day_of_week='mon', hour=9, minute=0),
        id='weekly_sales_reports',
        name='Send weekly sales reports to photographers',
        replace_existing=True
    )
    
    # Expire pending booking invites - every 5 minutes
    scheduler.add_job(
        expire_booking_invites_task,
        IntervalTrigger(minutes=5),
        id='expire_booking_invites',
        name='Expire pending booking invites after 24 hours',
        replace_existing=True
    )
    
    # Cleanup abandoned Stripe checkout sessions - every 30 minutes
    scheduler.add_job(
        cleanup_abandoned_stripe_sessions_task,
        IntervalTrigger(minutes=30),
        id='cleanup_stripe_sessions',
        name='Cleanup abandoned Stripe checkout sessions older than 30 min',
        replace_existing=True
    )
    
    # Credit transaction integrity check - daily at 5 AM
    scheduler.add_job(
        check_credit_transaction_integrity_task,
        CronTrigger(hour=5, minute=0),
        id='credit_integrity_check',
        name='Check credit transactions for orphaned references',
        replace_existing=True
    )
    
    scheduler.start()
    logger.info("[Scheduler] Background scheduler started")
    logger.info("[Scheduler] Jobs: surf_alerts (15min), story_cleanup (1hr), leaderboard_reset (monthly), grom_report (weekly), payment_expiry (5min), platform_metrics (6hr), session_reminders (5min), auto_escrow_release (daily 3am), selection_deadline_expiry (daily 4am), weekly_sales_reports (Monday 9am), expire_booking_invites (5min), cleanup_stripe_sessions (30min), credit_integrity_check (daily 5am)")

def stop_scheduler():
    """Stop the background scheduler"""
    if scheduler.running:
        scheduler.shutdown()
        logger.info("[Scheduler] Background scheduler stopped")
