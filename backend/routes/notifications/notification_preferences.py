from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone

from database import get_db
from models import NotificationPreferences, Profile

router = APIRouter()


class NotificationPreferencesResponse(BaseModel):
    # Push notifications
    push_messages: bool = True
    push_reactions: bool = True
    push_follows: bool = True
    push_mentions: bool = True
    push_dispatch: bool = True
    push_bookings: bool = True
    push_payments: bool = True
    push_marketing: bool = False
    
    # Email notifications
    email_messages: bool = False
    email_digest: bool = True
    email_bookings: bool = True
    email_payments: bool = True
    
    # Quiet hours
    quiet_hours_enabled: bool = False
    quiet_hours_start: str = "22:00"
    quiet_hours_end: str = "07:00"


class NotificationPreferencesUpdate(BaseModel):
    push_messages: Optional[bool] = None
    push_reactions: Optional[bool] = None
    push_follows: Optional[bool] = None
    push_mentions: Optional[bool] = None
    push_dispatch: Optional[bool] = None
    push_bookings: Optional[bool] = None
    push_payments: Optional[bool] = None
    push_marketing: Optional[bool] = None
    
    email_messages: Optional[bool] = None
    email_digest: Optional[bool] = None
    email_bookings: Optional[bool] = None
    email_payments: Optional[bool] = None
    
    quiet_hours_enabled: Optional[bool] = None
    quiet_hours_start: Optional[str] = None
    quiet_hours_end: Optional[str] = None
    
    # Sound & Haptics
    sound_enabled: Optional[bool] = None
    vibration_enabled: Optional[bool] = None
    
    # Digest Mode
    digest_enabled: Optional[bool] = None
    digest_frequency: Optional[str] = None


@router.get("/notifications/preferences/{user_id}")
async def get_notification_preferences(user_id: str, db: AsyncSession = Depends(get_db)):
    """Get user's notification preferences"""
    # Verify user exists
    user_result = await db.execute(select(Profile).where(Profile.id == user_id))
    if not user_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="User not found")
    
    # Get or create preferences
    result = await db.execute(
        select(NotificationPreferences).where(NotificationPreferences.user_id == user_id)
    )
    prefs = result.scalar_one_or_none()
    
    if not prefs:
        # Create default preferences
        prefs = NotificationPreferences(user_id=user_id)
        db.add(prefs)
        await db.commit()
        await db.refresh(prefs)
    
    return {
        "push_messages": prefs.push_messages,
        "push_reactions": prefs.push_reactions,
        "push_follows": prefs.push_follows,
        "push_mentions": prefs.push_mentions,
        "push_dispatch": prefs.push_dispatch,
        "push_bookings": prefs.push_bookings,
        "push_payments": prefs.push_payments,
        "push_marketing": prefs.push_marketing,
        "email_messages": prefs.email_messages,
        "email_digest": prefs.email_digest,
        "email_bookings": prefs.email_bookings,
        "email_payments": prefs.email_payments,
        "quiet_hours_enabled": prefs.quiet_hours_enabled,
        "quiet_hours_start": prefs.quiet_hours_start,
        "quiet_hours_end": prefs.quiet_hours_end,
        # Sound & Haptics
        "sound_enabled": getattr(prefs, 'sound_enabled', True),
        "vibration_enabled": getattr(prefs, 'vibration_enabled', True),
        # Digest Mode
        "digest_enabled": getattr(prefs, 'digest_enabled', False),
        "digest_frequency": getattr(prefs, 'digest_frequency', 'daily')
    }


@router.put("/notifications/preferences/{user_id}")
async def update_notification_preferences(
    user_id: str, 
    data: NotificationPreferencesUpdate,
    db: AsyncSession = Depends(get_db)
):
    """Update user's notification preferences"""
    # Verify user exists
    user_result = await db.execute(select(Profile).where(Profile.id == user_id))
    if not user_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="User not found")
    
    # Get or create preferences
    result = await db.execute(
        select(NotificationPreferences).where(NotificationPreferences.user_id == user_id)
    )
    prefs = result.scalar_one_or_none()
    
    if not prefs:
        prefs = NotificationPreferences(user_id=user_id)
        db.add(prefs)
    
    # Update only provided fields
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        if value is not None:
            setattr(prefs, field, value)
    
    prefs.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(prefs)
    
    return {
        "status": "success",
        "message": "Notification preferences updated",
        "preferences": {
            "push_messages": prefs.push_messages,
            "push_reactions": prefs.push_reactions,
            "push_follows": prefs.push_follows,
            "push_mentions": prefs.push_mentions,
            "push_dispatch": prefs.push_dispatch,
            "push_bookings": prefs.push_bookings,
            "push_payments": prefs.push_payments,
            "push_marketing": prefs.push_marketing,
            "email_messages": prefs.email_messages,
            "email_digest": prefs.email_digest,
            "email_bookings": prefs.email_bookings,
            "email_payments": prefs.email_payments,
            "quiet_hours_enabled": prefs.quiet_hours_enabled,
            "quiet_hours_start": prefs.quiet_hours_start,
            "quiet_hours_end": prefs.quiet_hours_end
        }
    }


# Helper function to check if user wants a specific notification type
async def should_send_notification(user_id: str, notification_type: str, db: AsyncSession) -> bool:
    """Check if user has enabled a specific notification type"""
    result = await db.execute(
        select(NotificationPreferences).where(NotificationPreferences.user_id == user_id)
    )
    prefs = result.scalar_one_or_none()
    
    if not prefs:
        # Default to True for most notifications
        return notification_type not in ['push_marketing', 'email_messages']
    
    # Map notification type to preference field
    type_map = {
        'messages': 'push_messages',
        'reactions': 'push_reactions',
        'follows': 'push_follows',
        'mentions': 'push_mentions',
        'dispatch': 'push_dispatch',
        'bookings': 'push_bookings',
        'payments': 'push_payments',
        'marketing': 'push_marketing'
    }
    
    pref_field = type_map.get(notification_type, 'push_messages')
    return getattr(prefs, pref_field, True)
