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
    action_url: Optional[str] = None
) -> Dict:
    """Send push notification to user via OneSignal using external_id targeting"""
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
    from routes.notification_preferences import should_send_notification
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
    from routes.notification_preferences import should_send_notification
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
    from routes.notification_preferences import should_send_notification
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
    from routes.notification_preferences import should_send_notification
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
    from routes.notification_preferences import should_send_notification
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
