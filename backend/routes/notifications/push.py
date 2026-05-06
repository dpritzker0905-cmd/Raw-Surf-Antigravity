from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional, Dict
from datetime import datetime, timezone
import httpx
import os
import logging

from database import get_db
from models import PushSubscription

router = APIRouter()
logger = logging.getLogger(__name__)

# OneSignal Configuration
ONESIGNAL_APP_ID = os.environ.get('ONESIGNAL_APP_ID')
ONESIGNAL_REST_API_KEY = os.environ.get('ONESIGNAL_REST_API_KEY')
ONESIGNAL_API_URL = "https://api.onesignal.com"


class PushSubscriptionCreate(BaseModel):
    endpoint: str
    p256dh_key: str
    auth_key: str
    user_agent: Optional[str] = None


class OneSignalSubscription(BaseModel):
    user_id: str
    subscription_id: str
    token: Optional[str] = None


class PushNotificationPayload(BaseModel):
    user_id: str
    title: str
    message: str
    event_type: str = "general"
    data: Dict = {}
    action_url: Optional[str] = None


@router.post("/push/subscribe")
async def subscribe_push(user_id: str, data: PushSubscriptionCreate, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(
        select(PushSubscription).where(
            PushSubscription.user_id == user_id,
            PushSubscription.endpoint == data.endpoint
        )
    )
    if existing.scalar_one_or_none():
        return {"message": "Already subscribed", "status": "existing"}
    
    subscription = PushSubscription(
        user_id=user_id,
        endpoint=data.endpoint,
        p256dh_key=data.p256dh_key,
        auth_key=data.auth_key,
        user_agent=data.user_agent
    )
    db.add(subscription)
    await db.commit()
    
    return {"message": "Subscribed to push notifications", "status": "new"}


@router.post("/push/onesignal/subscribe")
async def subscribe_onesignal(data: OneSignalSubscription, db: AsyncSession = Depends(get_db)):
    """Save OneSignal subscription ID for a user"""
    try:
        # Check if exists
        existing = await db.execute(
            select(PushSubscription).where(
                PushSubscription.user_id == data.user_id,
                PushSubscription.endpoint == f"onesignal:{data.subscription_id}"
            )
        )
        sub = existing.scalar_one_or_none()
        
        if sub:
            sub.auth_key = data.token or ""
            sub.user_agent = "OneSignal"
        else:
            subscription = PushSubscription(
                user_id=data.user_id,
                endpoint=f"onesignal:{data.subscription_id}",
                p256dh_key=data.subscription_id,
                auth_key=data.token or "",
                user_agent="OneSignal"
            )
            db.add(subscription)
        
        await db.commit()
        return {"status": "success", "message": "OneSignal subscription saved"}
    except Exception as e:
        logger.error(f"Error saving OneSignal subscription: {e}")
        raise HTTPException(status_code=500, detail="Failed to save subscription")


@router.delete("/push/unsubscribe")
async def unsubscribe_push(user_id: str, endpoint: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(PushSubscription).where(
            PushSubscription.user_id == user_id,
            PushSubscription.endpoint == endpoint
        )
    )
    subscription = result.scalar_one_or_none()
    if subscription:
        await db.delete(subscription)
        await db.commit()
    
    return {"message": "Unsubscribed from push notifications"}


@router.get("/push/vapid-key")
async def get_vapid_public_key():
    vapid_public_key = os.environ.get('VAPID_PUBLIC_KEY', 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U')
    return {"public_key": vapid_public_key}


@router.get("/push/onesignal/config")
async def get_onesignal_config():
    """Return OneSignal App ID for frontend initialization"""
    return {
        "app_id": ONESIGNAL_APP_ID,
        "enabled": bool(ONESIGNAL_APP_ID and ONESIGNAL_REST_API_KEY)
    }


# OneSignal Push Notification Sending
async def send_push_notification(
    user_id: str,
    title: str,
    message: str,
    data: Dict = {},
    action_url: Optional[str] = None,
    urgent: bool = True
) -> Dict:
    """
    Send push notification to user via OneSignal using external_id targeting.
    
    Args:
        urgent: If False, use timezone-aware delivery (OneSignal sends at 9:00 AM
                in the user's timezone). Default True = send immediately.
    """
    if not ONESIGNAL_APP_ID or not ONESIGNAL_REST_API_KEY:
        logger.warning("OneSignal not configured - skipping push notification")
        return {"status": "skipped", "reason": "OneSignal not configured"}
    
    headers = {
        "Authorization": f"Key {ONESIGNAL_REST_API_KEY}",
        "Content-Type": "application/json; charset=utf-8"
    }
    
    payload = {
        "app_id": ONESIGNAL_APP_ID,
        "include_aliases": {
            "external_id": [user_id]
        },
        "target_channel": "push",
        "headings": {"en": title},
        "contents": {"en": message},
        "data": data
    }
    
    # Smart scheduling: non-urgent notifications respect timezone
    if not urgent:
        payload["delayed_option"] = "timezone"
        payload["delivery_time_of_day"] = "9:00AM"
    
    if action_url:
        payload["web_url"] = action_url
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{ONESIGNAL_API_URL}/notifications",
                json=payload,
                headers=headers,
                timeout=30.0
            )
        
        if response.status_code == 200:
            result = response.json()
            logger.info(f"Push sent to {user_id}: {result.get('id')}")
            return {"status": "success", "notification_id": result.get("id")}
        else:
            logger.error(f"OneSignal error: {response.text}")
            return {"status": "error", "detail": response.text}
    
    except Exception as e:
        logger.error(f"Push notification error: {e}")
        return {"status": "error", "detail": str(e)}


@router.post("/push/send")
async def send_push_endpoint(payload: PushNotificationPayload):
    """API endpoint to send a push notification"""
    result = await send_push_notification(
        user_id=payload.user_id,
        title=payload.title,
        message=payload.message,
        data=payload.data,
        action_url=payload.action_url
    )
    return result


# Helper functions for specific notification types
async def notify_new_message(recipient_id: str, sender_name: str, preview: str, db: AsyncSession = None):
    """Push notification for new message - checks user preferences"""
    from routes.notifications.notification_preferences import should_send_notification
    from database import AsyncSessionLocal
    
    # Create session if not provided
    close_session = False
    if db is None:
        db = AsyncSessionLocal()
        close_session = True
    
    try:
        # Check if user wants message notifications
        if not await should_send_notification(recipient_id, 'messages', db):
            logger.info(f"Skipping message push for {recipient_id} - disabled in preferences")
            return {"status": "skipped", "reason": "user_preference"}
        
        return await send_push_notification(
            user_id=recipient_id,
            title=f"New message from {sender_name}",
            message=preview[:100] + "..." if len(preview) > 100 else preview,
            data={"type": "new_message", "sender_name": sender_name},
            action_url="/messages"
        )
    finally:
        if close_session:
            await db.close()


async def notify_dispatch_alert(photographer_id: str, spot_name: str, surfer_name: str, db: AsyncSession = None):
    """Push notification for dispatch request - checks user preferences"""
    from routes.notifications.notification_preferences import should_send_notification
    from database import AsyncSessionLocal
    
    close_session = False
    if db is None:
        db = AsyncSessionLocal()
        close_session = True
    
    try:
        if not await should_send_notification(photographer_id, 'dispatch', db):
            logger.info(f"Skipping dispatch push for {photographer_id} - disabled in preferences")
            return {"status": "skipped", "reason": "user_preference"}
        
        return await send_push_notification(
            user_id=photographer_id,
            title="New Photo Request!",
            message=f"{surfer_name} wants photos at {spot_name}",
            data={"type": "dispatch_alert", "spot_name": spot_name},
            action_url="/map"
        )
    finally:
        if close_session:
            await db.close()


async def notify_post_reaction(author_id: str, reactor_name: str, emoji: str, db: AsyncSession = None):
    """Push notification for post reaction - checks user preferences"""
    from routes.notifications.notification_preferences import should_send_notification
    from database import AsyncSessionLocal
    
    close_session = False
    if db is None:
        db = AsyncSessionLocal()
        close_session = True
    
    try:
        if not await should_send_notification(author_id, 'reactions', db):
            logger.info(f"Skipping reaction push for {author_id} - disabled in preferences")
            return {"status": "skipped", "reason": "user_preference"}
        
        return await send_push_notification(
            user_id=author_id,
            title=f"{reactor_name} reacted {emoji}",
            message=f"{reactor_name} reacted to your post",
            data={"type": "post_reaction", "emoji": emoji},
            action_url="/feed"
        )
    finally:
        if close_session:
            await db.close()


async def notify_new_follower(user_id: str, follower_name: str, db: AsyncSession = None):
    """Push notification for new follower - checks user preferences"""
    from routes.notifications.notification_preferences import should_send_notification
    from database import AsyncSessionLocal
    
    close_session = False
    if db is None:
        db = AsyncSessionLocal()
        close_session = True
    
    try:
        if not await should_send_notification(user_id, 'follows', db):
            logger.info(f"Skipping follow push for {user_id} - disabled in preferences")
            return {"status": "skipped", "reason": "user_preference"}
        
        return await send_push_notification(
            user_id=user_id,
            title="New Follower!",
            message=f"{follower_name} started following you",
            data={"type": "new_follower", "follower_name": follower_name},
            action_url="/profile"
        )
    finally:
        if close_session:
            await db.close()


async def notify_booking(user_id: str, title: str, message: str, db: AsyncSession = None):
    """Push notification for booking updates - checks user preferences"""
    from routes.notifications.notification_preferences import should_send_notification
    from database import AsyncSessionLocal
    
    close_session = False
    if db is None:
        db = AsyncSessionLocal()
        close_session = True
    
    try:
        if not await should_send_notification(user_id, 'bookings', db):
            logger.info(f"Skipping booking push for {user_id} - disabled in preferences")
            return {"status": "skipped", "reason": "user_preference"}
        
        return await send_push_notification(
            user_id=user_id,
            title=title,
            message=message,
            data={"type": "booking"},
            action_url="/bookings"
        )
    finally:
        if close_session:
            await db.close()


# ============ LIVE SESSION PUSH NOTIFICATIONS ============

async def notify_session_join(photographer_id: str, surfer_name: str, amount: float, spot_name: str, db: AsyncSession = None):
    """Push notification to photographer when surfer joins their live session - checks user preferences"""
    from routes.notifications.notification_preferences import should_send_notification
    from database import AsyncSessionLocal
    
    close_session = False
    if db is None:
        db = AsyncSessionLocal()
        close_session = True
    
    try:
        # Live session joins fall under the 'bookings' notification category
        if not await should_send_notification(photographer_id, 'bookings', db):
            logger.info(f"Skipping session join push for {photographer_id} - disabled in preferences")
            return {"status": "skipped", "reason": "user_preference"}
        
        return await send_push_notification(
            user_id=photographer_id,
            title=f"{surfer_name} joined your session!",
            message=f"${amount:.2f} \u2022 {spot_name}",
            data={"type": "session_join", "surfer_name": surfer_name, "amount": amount},
            action_url="/bookings"
        )
    finally:
        if close_session:
            await db.close()


# ============ GROM-SPECIFIC PUSH NOTIFICATIONS ============

async def notify_grom_activity(parent_id: str, grom_name: str, activity_type: str, detail: str = "", db: AsyncSession = None):
    """
    Push notification to parent when their Grom has activity.
    Activity types: 'post', 'live', 'session', 'achievement'
    """
    from database import AsyncSessionLocal
    
    close_session = False
    if db is None:
        db = AsyncSessionLocal()
        close_session = True
    
    try:
        titles = {
            'post': f"{grom_name} posted!",
            'live': f"{grom_name} went live!",
            'session': f"{grom_name} logged a surf session",
            'achievement': f"{grom_name} earned a badge!"
        }
        messages = {
            'post': f"{grom_name} shared a new post. Tap to see.",
            'live': f"{grom_name} is streaming live right now!",
            'session': detail or f"{grom_name} finished a surf session.",
            'achievement': detail or f"{grom_name} unlocked a new achievement!"
        }
        
        return await send_push_notification(
            user_id=parent_id,
            title=titles.get(activity_type, f"{grom_name} has new activity"),
            message=messages.get(activity_type, detail or "Check your Grom HQ for details."),
            data={"type": "grom_activity", "activity_type": activity_type, "grom_name": grom_name},
            action_url="/grom-hq"
        )
    finally:
        if close_session:
            await db.close()


async def notify_grom_safety_alert(parent_id: str, grom_name: str, alert_type: str, detail: str, db: AsyncSession = None):
    """
    Push notification to parent for safety-related Grom events.
    Alert types: 'dm_attempt', 'blocked_content', 'location_change', 'unverified_contact'
    """
    from database import AsyncSessionLocal
    
    close_session = False
    if db is None:
        db = AsyncSessionLocal()
        close_session = True
    
    try:
        titles = {
            'dm_attempt': f"Safety Alert: Message to {grom_name}",
            'blocked_content': f"Content blocked for {grom_name}",
            'location_change': f"{grom_name}'s location changed",
            'unverified_contact': f"Unverified user contacted {grom_name}"
        }
        
        return await send_push_notification(
            user_id=parent_id,
            title=titles.get(alert_type, f"Safety Alert: {grom_name}"),
            message=detail,
            data={"type": "grom_safety_alert", "alert_type": alert_type, "grom_name": grom_name},
            action_url="/grom-hq"
        )
    finally:
        if close_session:
            await db.close()


async def notify_grom_link_request(parent_id: str, grom_name: str, grom_email: str, db: AsyncSession = None):
    """
    Push notification to parent when a Grom requests to link.
    """
    from database import AsyncSessionLocal
    
    close_session = False
    if db is None:
        db = AsyncSessionLocal()
        close_session = True
    
    try:
        return await send_push_notification(
            user_id=parent_id,
            title=f"Grom Link Request",
            message=f"{grom_name} ({grom_email}) wants to link to your account. Tap to review.",
            data={"type": "grom_link_request", "grom_name": grom_name, "grom_email": grom_email},
            action_url="/grom-hq"
        )
    finally:
        if close_session:
            await db.close()


# ============ CREW HUB PUSH NOTIFICATIONS ============

async def notify_crew_payment_request(
    crew_member_id: str,
    captain_name: str,
    captain_avatar: str,
    booking_id: str,
    location: str,
    share_amount: float,
    expires_at: str,
    booking_type: str = "scheduled",
    db: AsyncSession = None
):
    """
    Push notification to crew member when added to a session.
    Deep links directly to the payment drawer for that booking.
    """
    from database import AsyncSessionLocal
    
    close_session = False
    if db is None:
        db = AsyncSessionLocal()
        close_session = True
    
    try:
        window_text = "60 minutes" if booking_type == "on_demand" else "24 hours"
        
        return await send_push_notification(
            user_id=crew_member_id,
            title=f"You're in {captain_name}'s Crew!",
            message=f"Your share: ${share_amount:.2f} at {location}. Pay within {window_text} to lock your spot.",
            data={
                "type": "crew_payment_request",
                "booking_id": booking_id,
                "captain_name": captain_name,
                "captain_avatar": captain_avatar,
                "location": location,
                "share_amount": share_amount,
                "expires_at": expires_at,
                "booking_type": booking_type,
                "deep_link": f"/bookings/pay/{booking_id}"
            },
            action_url=f"/bookings/pay/{booking_id}"
        )
    finally:
        if close_session:
            await db.close()


async def notify_crew_payment_received(
    captain_id: str,
    crew_member_name: str,
    amount: float,
    booking_id: str,
    remaining_balance: float,
    db: AsyncSession = None
):
    """
    Push notification to Captain when a crew member pays their share.
    """
    from database import AsyncSessionLocal
    
    close_session = False
    if db is None:
        db = AsyncSessionLocal()
        close_session = True
    
    try:
        if remaining_balance <= 0:
            message = f"{crew_member_name} paid ${amount:.2f}. All crew paid - session confirmed!"
        else:
            message = f"{crew_member_name} paid ${amount:.2f}. Remaining: ${remaining_balance:.2f}"
        
        return await send_push_notification(
            user_id=captain_id,
            title="Crew Payment Received!",
            message=message,
            data={
                "type": "crew_payment_received",
                "booking_id": booking_id,
                "crew_member_name": crew_member_name,
                "amount": amount,
                "remaining_balance": remaining_balance,
                "deep_link": f"/bookings/pay/{booking_id}"
            },
            action_url=f"/bookings/pay/{booking_id}"
        )
    finally:
        if close_session:
            await db.close()


async def notify_crew_payment_expiring(
    crew_member_id: str,
    captain_name: str,
    booking_id: str,
    share_amount: float,
    minutes_remaining: int,
    db: AsyncSession = None
):
    """
    Push notification reminder when payment window is about to expire.
    Sent at 15 minutes remaining.
    """
    from database import AsyncSessionLocal
    
    close_session = False
    if db is None:
        db = AsyncSessionLocal()
        close_session = True
    
    try:
        return await send_push_notification(
            user_id=crew_member_id,
            title="Payment Reminder!",
            message=f"Only {minutes_remaining} min left to pay ${share_amount:.2f} for {captain_name}'s session!",
            data={
                "type": "crew_payment_expiring",
                "booking_id": booking_id,
                "share_amount": share_amount,
                "minutes_remaining": minutes_remaining,
                "deep_link": f"/bookings/pay/{booking_id}"
            },
            action_url=f"/bookings/pay/{booking_id}"
        )
    finally:
        if close_session:
            await db.close()


async def notify_crew_session_confirmed(
    participant_id: str,
    captain_name: str,
    booking_id: str,
    location: str,
    session_date: str,
    db: AsyncSession = None
):
    """
    Push notification to all crew members when session is fully confirmed.
    """
    from database import AsyncSessionLocal
    
    close_session = False
    if db is None:
        db = AsyncSessionLocal()
        close_session = True
    
    try:
        return await send_push_notification(
            user_id=participant_id,
            title="Session Confirmed!",
            message=f"All set! {captain_name}'s session at {location} is confirmed. See you there!",
            data={
                "type": "crew_session_confirmed",
                "booking_id": booking_id,
                "captain_name": captain_name,
                "location": location,
                "session_date": session_date
            },
            action_url=f"/bookings"
        )
    finally:
        if close_session:
            await db.close()


# ============ NEW NOTIFICATION TRIGGERS (v2) ============


async def notify_photographer_arrived(
    surfer_id: str,
    photographer_name: str,
    dispatch_id: str,
    db: AsyncSession = None
):
    """Push notification when photographer arrives at the meeting point."""
    from routes.notifications.notification_preferences import should_send_notification
    from database import AsyncSessionLocal

    close_session = False
    if db is None:
        db = AsyncSessionLocal()
        close_session = True

    try:
        if not await should_send_notification(surfer_id, 'dispatch', db):
            return {"status": "skipped", "reason": "user_preference"}

        return await send_push_notification(
            user_id=surfer_id,
            title=f"{photographer_name} has arrived! 📸",
            message="Your photographer is at the meeting point. Time to shred!",
            data={
                "type": "photographer_arrived",
                "dispatch_id": dispatch_id,
                "photographer_name": photographer_name
            },
            action_url=f"/dispatch/{dispatch_id}/lobby"
        )
    finally:
        if close_session:
            await db.close()


async def notify_session_completed(
    surfer_id: str,
    photographer_name: str,
    dispatch_id: str,
    duration_mins: int,
    gallery_id: str = None,
    db: AsyncSession = None
):
    """Push notification when session is marked complete."""
    from routes.notifications.notification_preferences import should_send_notification
    from database import AsyncSessionLocal

    close_session = False
    if db is None:
        db = AsyncSessionLocal()
        close_session = True

    try:
        if not await should_send_notification(surfer_id, 'dispatch', db):
            return {"status": "skipped", "reason": "user_preference"}

        dur_text = f"{duration_mins} min session" if duration_mins else "session"
        deep_link = f"/gallery/{gallery_id}" if gallery_id else "/my-gallery"

        return await send_push_notification(
            user_id=surfer_id,
            title="Session Complete! 🤙",
            message=f"{photographer_name} finished your {dur_text}. Your gallery is being prepared!",
            data={
                "type": "session_completed",
                "dispatch_id": dispatch_id,
                "gallery_id": gallery_id,
                "duration_mins": duration_mins
            },
            action_url=deep_link
        )
    finally:
        if close_session:
            await db.close()


async def notify_photos_ready(
    surfer_id: str,
    photographer_name: str,
    gallery_id: str,
    photo_count: int = 0,
    db: AsyncSession = None
):
    """Push notification when gallery photos are uploaded and ready for selection."""
    from routes.notifications.notification_preferences import should_send_notification
    from database import AsyncSessionLocal

    close_session = False
    if db is None:
        db = AsyncSessionLocal()
        close_session = True

    try:
        if not await should_send_notification(surfer_id, 'gallery', db):
            return {"status": "skipped", "reason": "user_preference"}

        count_text = f"{photo_count} photos" if photo_count else "Your photos"

        return await send_push_notification(
            user_id=surfer_id,
            title="Your Photos Are Ready! 📸",
            message=f"{photographer_name} uploaded {count_text}. Check them out!",
            data={
                "type": "photos_ready",
                "gallery_id": gallery_id,
                "photo_count": photo_count
            },
            action_url=f"/gallery/{gallery_id}"
        )
    finally:
        if close_session:
            await db.close()


async def notify_photos_found_ai(
    surfer_id: str,
    gallery_id: str,
    match_count: int,
    spot_name: str = "",
    db: AsyncSession = None
):
    """Push notification after AI Find-Me scan discovers photos of the user."""
    from routes.notifications.notification_preferences import should_send_notification
    from database import AsyncSessionLocal

    close_session = False
    if db is None:
        db = AsyncSessionLocal()
        close_session = True

    try:
        if not await should_send_notification(surfer_id, 'gallery', db):
            return {"status": "skipped", "reason": "user_preference"}

        location_text = f" from your session at {spot_name}" if spot_name else ""

        return await send_push_notification(
            user_id=surfer_id,
            title=f"We found {match_count} photos of you! 🤖📸",
            message=f"AI matched {match_count} photos{location_text}. Tap to view!",
            data={
                "type": "photos_found_ai",
                "gallery_id": gallery_id,
                "match_count": match_count
            },
            action_url=f"/gallery/{gallery_id}"
        )
    finally:
        if close_session:
            await db.close()


async def notify_new_comment(
    author_id: str,
    commenter_name: str,
    post_id: str,
    preview: str = "",
    db: AsyncSession = None
):
    """Push notification for new comment on a post."""
    from routes.notifications.notification_preferences import should_send_notification
    from database import AsyncSessionLocal

    close_session = False
    if db is None:
        db = AsyncSessionLocal()
        close_session = True

    try:
        if not await should_send_notification(author_id, 'social', db):
            return {"status": "skipped", "reason": "user_preference"}

        msg = f'"{preview[:80]}..."' if len(preview) > 80 else f'"{preview}"' if preview else "on your post"

        return await send_push_notification(
            user_id=author_id,
            title=f"{commenter_name} commented",
            message=f"{commenter_name} commented {msg}",
            data={
                "type": "new_comment",
                "post_id": post_id,
                "commenter_name": commenter_name
            },
            action_url=f"/post/{post_id}",
            urgent=False  # Non-urgent: smart-scheduled
        )
    finally:
        if close_session:
            await db.close()


async def notify_mention(
    mentioned_user_id: str,
    mentioner_name: str,
    post_id: str,
    db: AsyncSession = None
):
    """Push notification when a user is @mentioned in a post or comment."""
    from routes.notifications.notification_preferences import should_send_notification
    from database import AsyncSessionLocal

    close_session = False
    if db is None:
        db = AsyncSessionLocal()
        close_session = True

    try:
        if not await should_send_notification(mentioned_user_id, 'social', db):
            return {"status": "skipped", "reason": "user_preference"}

        return await send_push_notification(
            user_id=mentioned_user_id,
            title=f"{mentioner_name} mentioned you",
            message=f"{mentioner_name} mentioned you in a post. Tap to see!",
            data={
                "type": "mention",
                "post_id": post_id,
                "mentioner_name": mentioner_name
            },
            action_url=f"/post/{post_id}"
        )
    finally:
        if close_session:
            await db.close()


async def notify_surf_alert_triggered(
    user_id: str,
    spot_name: str,
    spot_id: str,
    alert_summary: str,
    db: AsyncSession = None
):
    """Push notification when a user's surf alert conditions are met."""
    from routes.notifications.notification_preferences import should_send_notification
    from database import AsyncSessionLocal

    close_session = False
    if db is None:
        db = AsyncSessionLocal()
        close_session = True

    try:
        if not await should_send_notification(user_id, 'alerts', db):
            return {"status": "skipped", "reason": "user_preference"}

        return await send_push_notification(
            user_id=user_id,
            title=f"🌊 Surf Alert: {spot_name}",
            message=alert_summary,
            data={
                "type": "surf_alert",
                "spot_id": spot_id,
                "spot_name": spot_name
            },
            action_url=f"/spot-hub/{spot_id}"
        )
    finally:
        if close_session:
            await db.close()


async def notify_booking_reminder(
    user_id: str,
    photographer_name: str,
    booking_id: str,
    location: str,
    time_until: str,
    db: AsyncSession = None
):
    """Push notification for upcoming booking reminder (1hr / 24hr before)."""
    from routes.notifications.notification_preferences import should_send_notification
    from database import AsyncSessionLocal

    close_session = False
    if db is None:
        db = AsyncSessionLocal()
        close_session = True

    try:
        if not await should_send_notification(user_id, 'bookings', db):
            return {"status": "skipped", "reason": "user_preference"}

        return await send_push_notification(
            user_id=user_id,
            title=f"Session in {time_until}! 🏄",
            message=f"Your session with {photographer_name} at {location} starts in {time_until}.",
            data={
                "type": "booking_reminder",
                "booking_id": booking_id,
                "time_until": time_until
            },
            action_url="/bookings"
        )
    finally:
        if close_session:
            await db.close()


async def notify_gallery_purchase(
    photographer_id: str,
    buyer_name: str,
    gallery_id: str,
    item_count: int,
    amount: float,
    db: AsyncSession = None
):
    """Push notification to photographer when someone purchases gallery items."""
    from routes.notifications.notification_preferences import should_send_notification
    from database import AsyncSessionLocal

    close_session = False
    if db is None:
        db = AsyncSessionLocal()
        close_session = True

    try:
        if not await should_send_notification(photographer_id, 'gallery', db):
            return {"status": "skipped", "reason": "user_preference"}

        items_text = f"{item_count} photo{'s' if item_count != 1 else ''}"

        return await send_push_notification(
            user_id=photographer_id,
            title=f"New Sale! 💰 ${amount:.2f}",
            message=f"{buyer_name} purchased {items_text} from your gallery!",
            data={
                "type": "gallery_purchase",
                "gallery_id": gallery_id,
                "buyer_name": buyer_name,
                "amount": amount
            },
            action_url=f"/gallery/{gallery_id}",
            urgent=False  # Non-urgent: smart-scheduled
        )
    finally:
        if close_session:
            await db.close()


async def notify_review_received(
    photographer_id: str,
    reviewer_name: str,
    rating: float,
    db: AsyncSession = None
):
    """Push notification to photographer when they receive a new review."""
    from routes.notifications.notification_preferences import should_send_notification
    from database import AsyncSessionLocal

    close_session = False
    if db is None:
        db = AsyncSessionLocal()
        close_session = True

    try:
        if not await should_send_notification(photographer_id, 'social', db):
            return {"status": "skipped", "reason": "user_preference"}

        stars = "⭐" * int(rating)

        return await send_push_notification(
            user_id=photographer_id,
            title=f"New Review! {stars}",
            message=f"{reviewer_name} left you a {rating:.1f}-star review. Nice work!",
            data={
                "type": "review_received",
                "reviewer_name": reviewer_name,
                "rating": rating
            },
            action_url="/profile",
            urgent=False  # Non-urgent: smart-scheduled
        )
    finally:
        if close_session:
            await db.close()

