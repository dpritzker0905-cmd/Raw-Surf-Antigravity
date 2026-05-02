"""
Base scheduler module — shared scheduler instance and push notification helper.
"""
import logging
import json
import os
from apscheduler.schedulers.asyncio import AsyncIOScheduler

logger = logging.getLogger(__name__)

# VAPID keys for push notifications
VAPID_PRIVATE_KEY = os.environ.get('VAPID_PRIVATE_KEY', 'your-private-key')
VAPID_PUBLIC_KEY = os.environ.get('VAPID_PUBLIC_KEY', 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U')
VAPID_CLAIMS = {"sub": "mailto:alerts@rawsurfos.com"}

# Initialize scheduler — singleton used by all task modules
scheduler = AsyncIOScheduler()


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
