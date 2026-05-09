"""Push notification core — OneSignal integration, subscription management, and send API.

Domain-specific notification helper functions are in push_payloads.py (v88).
"""
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


# Domain-specific notification helpers moved to push_payloads.py (v88)
# Import them from there: from routes.notifications.push_payloads import notify_*
