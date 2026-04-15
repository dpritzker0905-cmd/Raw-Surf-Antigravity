from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from pydantic import BaseModel
from typing import List
from datetime import datetime

from database import get_db
from models import Notification

router = APIRouter()

class NotificationResponse(BaseModel):
    id: str
    type: str
    title: str
    body: str | None
    data: str | None
    is_read: bool
    created_at: datetime

@router.get("/notifications/{user_id}", response_model=List[NotificationResponse])
async def get_notifications(user_id: str, limit: int = 50, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Notification)
        .where(Notification.user_id == user_id)
        .order_by(Notification.created_at.desc())
        .limit(limit)
    )
    notifications = result.scalars().all()
    
    return [NotificationResponse(
        id=n.id,
        type=n.type,
        title=n.title,
        body=n.body,
        data=n.data,
        is_read=n.is_read,
        created_at=n.created_at
    ) for n in notifications]

@router.get("/notifications/{user_id}/unread-count")
async def get_unread_notification_count(user_id: str, db: AsyncSession = Depends(get_db)):
    from sqlalchemy import func
    result = await db.execute(
        select(func.count(Notification.id))
        .where(Notification.user_id == user_id)
        .where(Notification.is_read == False)
    )
    count = result.scalar() or 0
    return {"unread_count": count}

@router.post("/notifications/{notification_id}/read")
async def mark_notification_read(notification_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Notification).where(Notification.id == notification_id))
    notification = result.scalar_one_or_none()
    
    if not notification:
        raise HTTPException(status_code=404, detail="Notification not found")
    
    notification.is_read = True
    await db.commit()
    
    return {"message": "Notification marked as read"}

@router.post("/notifications/{user_id}/read-all")
async def mark_all_notifications_read(user_id: str, db: AsyncSession = Depends(get_db)):
    await db.execute(
        update(Notification)
        .where(Notification.user_id == user_id)
        .where(Notification.is_read == False)
        .values(is_read=True)
    )
    await db.commit()
    
    return {"message": "All notifications marked as read"}


class SendNotificationRequest(BaseModel):
    recipient_id: str
    sender_id: str
    type: str
    title: str
    body: str | None = None


class CreateNotificationRequest(BaseModel):
    user_id: str
    type: str
    title: str
    message: str | None = None
    data: dict | None = None


@router.post("/notifications")
async def create_notification(
    request: CreateNotificationRequest,
    db: AsyncSession = Depends(get_db)
):
    """Create a notification for a user (e.g., post reaction, message, etc.)"""
    import json
    
    notification = Notification(
        user_id=request.user_id,
        type=request.type,
        title=request.title,
        body=request.message,
        data=json.dumps(request.data) if request.data else None
    )
    db.add(notification)
    await db.commit()
    
    return {"success": True, "notification_id": notification.id}


@router.post("/notifications/send")
async def send_notification(
    data: SendNotificationRequest,
    db: AsyncSession = Depends(get_db)
):
    """Send a notification from one user to another (e.g., thank you)"""
    import json
    
    notification = Notification(
        user_id=data.recipient_id,
        type=data.type,
        title=data.title,
        body=data.body,
        data=json.dumps({
            "sender_id": data.sender_id,
            "type": data.type
        })
    )
    db.add(notification)
    await db.commit()
    
    return {"success": True, "message": "Notification sent"}


class RealtimeBroadcastRequest(BaseModel):
    channel: str
    event: str
    payload: dict


@router.post("/realtime/broadcast")
async def broadcast_realtime_event(
    data: RealtimeBroadcastRequest
):
    """Broadcast an event via Supabase Realtime for social sync.
    Used for instant updates like reaction changes on posts.
    """
    import httpx
    import os
    
    supabase_url = os.environ.get('SUPABASE_URL')
    supabase_key = os.environ.get('SUPABASE_SERVICE_KEY')
    
    if not supabase_url or not supabase_key:
        # Supabase not configured - skip broadcast silently
        return {"success": False, "reason": "Supabase not configured"}
    
    try:
        # Supabase Realtime broadcast via REST API
        headers = {
            "apikey": supabase_key,
            "Authorization": f"Bearer {supabase_key}",
            "Content-Type": "application/json"
        }
        
        broadcast_payload = {
            "type": "broadcast",
            "event": data.event,
            "payload": data.payload
        }
        
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{supabase_url}/realtime/v1/api/broadcast",
                json={
                    "channel": data.channel,
                    "messages": [broadcast_payload]
                },
                headers=headers,
                timeout=10.0
            )
        
        if response.status_code == 200:
            return {"success": True, "channel": data.channel}
        else:
            return {"success": False, "status": response.status_code}
            
    except Exception as e:
        # Silent fail - broadcast is not critical
        return {"success": False, "error": str(e)}


# ============================================================
# Photographer Availability Alert Subscriptions
# ============================================================

class PhotographerAlertRequest(BaseModel):
    user_id: str
    photographer_id: str
    alert_type: str  # live_shooting, on_demand, scheduled_booking

class PhotographerAlertResponse(BaseModel):
    live_shooting: bool = False
    on_demand: bool = False
    scheduled_booking: bool = False

@router.get("/notifications/photographer-alerts/{photographer_id}", response_model=PhotographerAlertResponse)
async def get_photographer_alert_subscriptions(
    photographer_id: str,
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get user's alert subscriptions for a specific photographer"""
    from models import PhotographerAlertSubscription
    
    result = await db.execute(
        select(PhotographerAlertSubscription)
        .where(PhotographerAlertSubscription.user_id == user_id)
        .where(PhotographerAlertSubscription.photographer_id == photographer_id)
        .where(PhotographerAlertSubscription.is_active == True)
    )
    subscriptions = result.scalars().all()
    
    response = PhotographerAlertResponse()
    for sub in subscriptions:
        if sub.alert_type == 'live_shooting':
            response.live_shooting = True
        elif sub.alert_type == 'on_demand':
            response.on_demand = True
        elif sub.alert_type == 'scheduled_booking':
            response.scheduled_booking = True
    
    return response

@router.post("/notifications/photographer-alerts")
async def subscribe_photographer_alert(
    request: PhotographerAlertRequest,
    db: AsyncSession = Depends(get_db)
):
    """Subscribe to photographer availability alerts"""
    from models import PhotographerAlertSubscription, Profile
    import uuid
    
    # Verify both users exist
    user_result = await db.execute(select(Profile).where(Profile.id == request.user_id))
    if not user_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="User not found")
    
    photographer_result = await db.execute(select(Profile).where(Profile.id == request.photographer_id))
    if not photographer_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    # Check if subscription already exists
    existing = await db.execute(
        select(PhotographerAlertSubscription)
        .where(PhotographerAlertSubscription.user_id == request.user_id)
        .where(PhotographerAlertSubscription.photographer_id == request.photographer_id)
        .where(PhotographerAlertSubscription.alert_type == request.alert_type)
    )
    existing_sub = existing.scalar_one_or_none()
    
    if existing_sub:
        # Reactivate if inactive
        existing_sub.is_active = True
        await db.commit()
        return {"success": True, "message": "Subscription reactivated"}
    
    # Create new subscription
    subscription = PhotographerAlertSubscription(
        id=str(uuid.uuid4()),
        user_id=request.user_id,
        photographer_id=request.photographer_id,
        alert_type=request.alert_type,
        is_active=True
    )
    db.add(subscription)
    await db.commit()
    
    return {"success": True, "message": "Subscribed to alerts"}

@router.delete("/notifications/photographer-alerts/{photographer_id}")
async def unsubscribe_photographer_alert(
    photographer_id: str,
    user_id: str,
    alert_type: str,
    db: AsyncSession = Depends(get_db)
):
    """Unsubscribe from photographer availability alerts"""
    from models import PhotographerAlertSubscription
    
    result = await db.execute(
        select(PhotographerAlertSubscription)
        .where(PhotographerAlertSubscription.user_id == user_id)
        .where(PhotographerAlertSubscription.photographer_id == photographer_id)
        .where(PhotographerAlertSubscription.alert_type == alert_type)
    )
    subscription = result.scalar_one_or_none()
    
    if not subscription:
        raise HTTPException(status_code=404, detail="Subscription not found")
    
    subscription.is_active = False
    await db.commit()
    
    return {"success": True, "message": "Unsubscribed from alerts"}

@router.post("/notifications/photographer-alerts/trigger")
async def trigger_photographer_alert(
    photographer_id: str,
    alert_type: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Trigger notifications for all subscribers when photographer becomes available.
    Called internally when photographer goes live, activates on-demand, etc.
    """
    from models import PhotographerAlertSubscription, Profile
    import os
    import httpx
    
    # Get photographer name
    photographer_result = await db.execute(select(Profile).where(Profile.id == photographer_id))
    photographer = photographer_result.scalar_one_or_none()
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    # Get all active subscribers for this alert type
    result = await db.execute(
        select(PhotographerAlertSubscription)
        .where(PhotographerAlertSubscription.photographer_id == photographer_id)
        .where(PhotographerAlertSubscription.alert_type == alert_type)
        .where(PhotographerAlertSubscription.is_active == True)
    )
    subscribers = result.scalars().all()
    
    if not subscribers:
        return {"success": True, "notifications_sent": 0}
    
    # Prepare notification content
    titles = {
        'live_shooting': f'{photographer.full_name} is now live!',
        'on_demand': f'{photographer.full_name} is available for on-demand!',
        'scheduled_booking': f'{photographer.full_name} opened booking slots!'
    }
    bodies = {
        'live_shooting': 'Watch their live session now',
        'on_demand': 'Request them to come shoot you',
        'scheduled_booking': 'Book your next session'
    }
    
    title = titles.get(alert_type, f'{photographer.full_name} is available!')
    body = bodies.get(alert_type, 'Check out their availability')
    
    # Send OneSignal notifications
    onesignal_app_id = os.environ.get('ONESIGNAL_APP_ID')
    onesignal_api_key = os.environ.get('ONESIGNAL_API_KEY')
    
    if onesignal_app_id and onesignal_api_key:
        user_ids = [sub.user_id for sub in subscribers]
        
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    'https://onesignal.com/api/v1/notifications',
                    headers={
                        'Authorization': f'Basic {onesignal_api_key}',
                        'Content-Type': 'application/json'
                    },
                    json={
                        'app_id': onesignal_app_id,
                        'include_aliases': {
                            'external_id': user_ids
                        },
                        'target_channel': 'push',
                        'headings': {'en': title},
                        'contents': {'en': body},
                        'data': {
                            'type': 'photographer_available',
                            'photographer_id': photographer_id,
                            'alert_type': alert_type
                        }
                    }
                )
                
                # Update last_notified_at for all subscribers
                from datetime import datetime, timezone
                for sub in subscribers:
                    sub.last_notified_at = datetime.now(timezone.utc)
                await db.commit()
                
                return {
                    "success": True, 
                    "notifications_sent": len(subscribers),
                    "onesignal_response": response.status_code
                }
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    return {"success": True, "notifications_sent": 0, "message": "OneSignal not configured"}

