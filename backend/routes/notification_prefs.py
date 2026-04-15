"""
Notification Preferences API Routes
Provides endpoints for managing user notification settings including:
- Push notification type toggles
- Sound and vibration settings
- Digest mode configuration
- Email preferences
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Optional
from datetime import datetime, timezone
from pydantic import BaseModel
import logging

from database import get_db
from models import Profile, NotificationPreferences

router = APIRouter()
logger = logging.getLogger(__name__)


class NotificationPreferenceUpdate(BaseModel):
    """Partial update model for notification preferences"""
    # Push toggles
    push_messages: Optional[bool] = None
    push_reactions: Optional[bool] = None
    push_follows: Optional[bool] = None
    push_mentions: Optional[bool] = None
    push_dispatch: Optional[bool] = None
    push_bookings: Optional[bool] = None
    push_payments: Optional[bool] = None
    push_marketing: Optional[bool] = None
    # Sound settings
    sound_enabled: Optional[bool] = None
    vibration_enabled: Optional[bool] = None
    # Digest mode
    digest_enabled: Optional[bool] = None
    digest_frequency: Optional[str] = None
    # Email preferences
    email_messages: Optional[bool] = None
    email_digest: Optional[bool] = None
    email_bookings: Optional[bool] = None
    email_payments: Optional[bool] = None
    # Quiet hours
    quiet_hours_enabled: Optional[bool] = None
    quiet_hours_start: Optional[str] = None
    quiet_hours_end: Optional[str] = None


@router.get("/notifications/preferences")
async def get_notification_preferences(
    user_id: str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    """
    Get notification preferences for a user.
    Returns default values if no preferences exist.
    """
    try:
        result = await db.execute(
            select(NotificationPreferences).where(NotificationPreferences.user_id == user_id)
        )
        prefs = result.scalar_one_or_none()
        
        if not prefs:
            # Return defaults
            return {
                "push_messages": True,
                "push_reactions": True,
                "push_follows": True,
                "push_mentions": True,
                "push_dispatch": True,
                "push_bookings": True,
                "push_payments": True,
                "push_marketing": False,
                "sound_enabled": True,
                "vibration_enabled": True,
                "digest_enabled": False,
                "digest_frequency": "daily",
                "email_messages": False,
                "email_digest": True,
                "email_bookings": True,
                "email_payments": True,
                "quiet_hours_enabled": False,
                "quiet_hours_start": "22:00",
                "quiet_hours_end": "07:00"
            }
        
        return {
            "push_messages": prefs.push_messages,
            "push_reactions": prefs.push_reactions,
            "push_follows": prefs.push_follows,
            "push_mentions": prefs.push_mentions,
            "push_dispatch": prefs.push_dispatch,
            "push_bookings": prefs.push_bookings,
            "push_payments": prefs.push_payments,
            "push_marketing": prefs.push_marketing,
            "sound_enabled": getattr(prefs, 'sound_enabled', True),
            "vibration_enabled": getattr(prefs, 'vibration_enabled', True),
            "digest_enabled": getattr(prefs, 'digest_enabled', False),
            "digest_frequency": getattr(prefs, 'digest_frequency', 'daily'),
            "email_messages": prefs.email_messages,
            "email_digest": prefs.email_digest,
            "email_bookings": prefs.email_bookings,
            "email_payments": prefs.email_payments,
            "quiet_hours_enabled": prefs.quiet_hours_enabled,
            "quiet_hours_start": prefs.quiet_hours_start,
            "quiet_hours_end": prefs.quiet_hours_end
        }
    except Exception as e:
        logger.error(f"Error fetching notification preferences: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch preferences")


@router.put("/notifications/preferences")
async def update_notification_preferences(
    updates: NotificationPreferenceUpdate,
    user_id: str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    """
    Update notification preferences for a user.
    Creates new record if none exists.
    """
    try:
        # Get existing preferences
        result = await db.execute(
            select(NotificationPreferences).where(NotificationPreferences.user_id == user_id)
        )
        prefs = result.scalar_one_or_none()
        
        if not prefs:
            # Create new preferences record
            prefs = NotificationPreferences(user_id=user_id)
            db.add(prefs)
        
        # Update only provided fields
        update_data = updates.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            if hasattr(prefs, field) and value is not None:
                setattr(prefs, field, value)
        
        prefs.updated_at = datetime.now(timezone.utc)
        
        await db.commit()
        
        return {"success": True, "message": "Preferences updated"}
    except Exception as e:
        await db.rollback()
        logger.error(f"Error updating notification preferences: {e}")
        raise HTTPException(status_code=500, detail="Failed to update preferences")


@router.post("/notifications/preferences/reset")
async def reset_notification_preferences(
    user_id: str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    """
    Reset all notification preferences to defaults.
    """
    try:
        result = await db.execute(
            select(NotificationPreferences).where(NotificationPreferences.user_id == user_id)
        )
        prefs = result.scalar_one_or_none()
        
        if prefs:
            # Reset to defaults
            prefs.push_messages = True
            prefs.push_reactions = True
            prefs.push_follows = True
            prefs.push_mentions = True
            prefs.push_dispatch = True
            prefs.push_bookings = True
            prefs.push_payments = True
            prefs.push_marketing = False
            prefs.sound_enabled = True
            prefs.vibration_enabled = True
            prefs.digest_enabled = False
            prefs.digest_frequency = "daily"
            prefs.email_messages = False
            prefs.email_digest = True
            prefs.email_bookings = True
            prefs.email_payments = True
            prefs.quiet_hours_enabled = False
            prefs.quiet_hours_start = "22:00"
            prefs.quiet_hours_end = "07:00"
            prefs.updated_at = datetime.now(timezone.utc)
            
            await db.commit()
        
        return {"success": True, "message": "Preferences reset to defaults"}
    except Exception as e:
        await db.rollback()
        logger.error(f"Error resetting notification preferences: {e}")
        raise HTTPException(status_code=500, detail="Failed to reset preferences")
