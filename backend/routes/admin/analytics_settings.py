"""
admin/analytics_settings.py — Platform settings, site access, and feed lineups.
Extracted from analytics.py (v93 audit) for LOC compliance.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone
from database import get_db
from deps.admin_auth import get_current_admin
from models import Profile, Booking
from core.security import get_user_id_from_jwt_or_query

router = APIRouter()


# ===================== PLATFORM SETTINGS =====================

@router.get("/site-access")
async def check_site_access(db: AsyncSession = Depends(get_db)):
    """Public endpoint to check if access code is required (no auth needed)"""
    from models import PlatformSettings
    try:
        result = await db.execute(select(PlatformSettings).limit(1))
        settings = result.scalar_one_or_none()
        if not settings:
            return {"access_code_enabled": False}
        return {
            "access_code_enabled": settings.access_code_enabled if hasattr(settings, 'access_code_enabled') else False
        }
    except Exception:
        return {"access_code_enabled": False}


class VerifyAccessCode(BaseModel):
    code: str

@router.post("/site-access/verify")
async def verify_access_code(data: VerifyAccessCode, db: AsyncSession = Depends(get_db)):
    """Public endpoint to verify an access code (no auth needed)"""
    from models import PlatformSettings
    try:
        result = await db.execute(select(PlatformSettings).limit(1))
        settings = result.scalar_one_or_none()
        if not settings or not settings.access_code_enabled:
            return {"valid": True, "message": "Access code not required"}
        stored_code = settings.access_code if hasattr(settings, 'access_code') else 'SURF2024'
        if data.code.upper().strip() == stored_code.upper().strip():
            return {"valid": True, "message": "Access granted"}
        else:
            return {"valid": False, "message": "Invalid access code"}
    except Exception:
        return {"valid": False, "message": "Error verifying code"}


@router.get("/admin/platform-settings")
async def get_platform_settings(db: AsyncSession = Depends(get_db)):
    """Get current platform settings and feature flags"""
    from models import PlatformSettings
    defaults = {
        "show_lineup_cards_in_feed": True,
        "show_session_logs_in_feed": True,
        "allow_nearby_crew_invites": True,
        "feed_lineup_card_frequency": 5,
        "max_lineup_cards_per_feed": 3,
        "lineup_default_visibility": "friends",
        "lineup_lock_hours_before": 96,
        "lineup_min_crew_default": 2,
        "live_nearby_radius_miles": 10.0,
        "hobbyist_max_bookings_per_week": 3,
        "hobbyist_max_hourly_rate": 40.0,
        "hobbyist_require_conditions_report": True,
        "hobbyist_booking_auto_confirm": False
    }
    try:
        result = await db.execute(select(PlatformSettings).limit(1))
        settings = result.scalar_one_or_none()
        if not settings:
            return defaults
        return {
            "access_code_enabled": settings.access_code_enabled if hasattr(settings, 'access_code_enabled') else False,
            "access_code": settings.access_code if hasattr(settings, 'access_code') else 'SURF2024',
            "show_lineup_cards_in_feed": settings.show_lineup_cards_in_feed,
            "show_session_logs_in_feed": settings.show_session_logs_in_feed,
            "allow_nearby_crew_invites": settings.allow_nearby_crew_invites,
            "feed_lineup_card_frequency": settings.feed_lineup_card_frequency,
            "max_lineup_cards_per_feed": settings.max_lineup_cards_per_feed,
            "lineup_default_visibility": settings.lineup_default_visibility,
            "lineup_lock_hours_before": settings.lineup_lock_hours_before,
            "lineup_min_crew_default": settings.lineup_min_crew_default,
            "live_nearby_radius_miles": settings.live_nearby_radius_miles,
            "hobbyist_max_bookings_per_week": getattr(settings, 'hobbyist_max_bookings_per_week', 3),
            "hobbyist_max_hourly_rate": getattr(settings, 'hobbyist_max_hourly_rate', 40.0),
            "hobbyist_require_conditions_report": getattr(settings, 'hobbyist_require_conditions_report', True),
            "hobbyist_booking_auto_confirm": getattr(settings, 'hobbyist_booking_auto_confirm', False)
        }
    except Exception:
        return defaults


class UpdatePlatformSettingsRequest(BaseModel):
    access_code_enabled: Optional[bool] = None
    access_code: Optional[str] = None
    show_lineup_cards_in_feed: Optional[bool] = None
    show_session_logs_in_feed: Optional[bool] = None
    allow_nearby_crew_invites: Optional[bool] = None
    feed_lineup_card_frequency: Optional[int] = None
    max_lineup_cards_per_feed: Optional[int] = None
    lineup_default_visibility: Optional[str] = None
    lineup_lock_hours_before: Optional[int] = None
    lineup_min_crew_default: Optional[int] = None
    live_nearby_radius_miles: Optional[float] = None
    hobbyist_max_bookings_per_week: Optional[int] = None
    hobbyist_max_hourly_rate: Optional[float] = None
    hobbyist_require_conditions_report: Optional[bool] = None
    hobbyist_booking_auto_confirm: Optional[bool] = None


@router.put("/admin/platform-settings")
async def update_platform_settings(
    data: UpdatePlatformSettingsRequest,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Update platform settings (admin only)"""
    from models import PlatformSettings
    try:
        result = await db.execute(select(PlatformSettings).limit(1))
        settings = result.scalar_one_or_none()
        if not settings:
            settings = PlatformSettings()
            db.add(settings)
        field_map = {
            'access_code_enabled': data.access_code_enabled,
            'access_code': data.access_code,
            'show_lineup_cards_in_feed': data.show_lineup_cards_in_feed,
            'show_session_logs_in_feed': data.show_session_logs_in_feed,
            'allow_nearby_crew_invites': data.allow_nearby_crew_invites,
            'feed_lineup_card_frequency': data.feed_lineup_card_frequency,
            'max_lineup_cards_per_feed': data.max_lineup_cards_per_feed,
            'lineup_default_visibility': data.lineup_default_visibility,
            'lineup_lock_hours_before': data.lineup_lock_hours_before,
            'lineup_min_crew_default': data.lineup_min_crew_default,
            'live_nearby_radius_miles': data.live_nearby_radius_miles,
            'hobbyist_max_bookings_per_week': data.hobbyist_max_bookings_per_week,
            'hobbyist_max_hourly_rate': data.hobbyist_max_hourly_rate,
            'hobbyist_require_conditions_report': data.hobbyist_require_conditions_report,
            'hobbyist_booking_auto_confirm': data.hobbyist_booking_auto_confirm,
        }
        for field, value in field_map.items():
            if value is not None:
                setattr(settings, field, value)
        settings.updated_by = admin.id
        settings.updated_at = datetime.now(timezone.utc)
        await db.commit()
        return {"message": "Platform settings updated", "success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update settings: {str(e)}")


@router.get("/feed/lineups")
async def get_feed_lineups(
    user_id: str = Depends(get_user_id_from_jwt_or_query),
    limit: int = Query(3, ge=1, le=10),
    db: AsyncSession = Depends(get_db)
):
    """Get open lineups to display in the feed."""
    from models import PlatformSettings, Friend, FriendshipStatusEnum
    import math

    try:
        settings_result = await db.execute(select(PlatformSettings).limit(1))
        settings = settings_result.scalar_one_or_none()
        if settings and not settings.show_lineup_cards_in_feed:
            return []
    except Exception:
        pass

    user_result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = user_result.scalar_one_or_none()
    if not user:
        return []

    friends_result = await db.execute(
        select(Friend).where(
            and_(
                or_(Friend.requester_id == user_id, Friend.addressee_id == user_id),
                Friend.status == FriendshipStatusEnum.ACCEPTED
            )
        )
    )
    friend_ids = set()
    for f in friends_result.scalars().all():
        if f.requester_id == user_id:
            friend_ids.add(f.addressee_id)
        else:
            friend_ids.add(f.requester_id)

    lineups_result = await db.execute(
        select(Booking).where(
            and_(
                Booking.lineup_status.in_(['open', 'filling']),
                Booking.creator_id != user_id
            )
        ).options(
            selectinload(Booking.creator),
            selectinload(Booking.photographer),
            selectinload(Booking.participants)
        ).order_by(Booking.session_date.asc()).limit(limit * 3)
    )
    all_lineups = lineups_result.scalars().all()

    visible_lineups = []
    for lineup in all_lineups:
        if any(p.participant_id == user_id for p in lineup.participants):
            continue
        is_visible = False
        if lineup.lineup_visibility in ['friends', 'both']:
            if lineup.creator_id in friend_ids:
                is_visible = True
        if lineup.lineup_visibility in ['area', 'both'] and not is_visible:
            if user.latitude and user.longitude and lineup.latitude and lineup.longitude:
                lat_diff = abs(user.latitude - lineup.latitude)
                lon_diff = abs(user.longitude - lineup.longitude)
                distance_miles = math.sqrt((lat_diff * 69)**2 + (lon_diff * 69 * math.cos(math.radians(user.latitude)))**2)
                if distance_miles <= (lineup.proximity_radius or 10):
                    is_visible = True
        if is_visible:
            visible_lineups.append(lineup)
            if len(visible_lineups) >= limit:
                break

    return [
        {
            "id": str(lineup.id),
            "creator_id": lineup.creator_id,
            "creator_name": lineup.creator.full_name if lineup.creator else None,
            "creator_avatar_url": lineup.creator.avatar_url if lineup.creator else None,
            "photographer_id": lineup.photographer_id,
            "photographer_name": lineup.photographer.full_name if lineup.photographer else None,
            "location": lineup.location,
            "latitude": lineup.latitude,
            "longitude": lineup.longitude,
            "session_date": lineup.session_date.isoformat() if lineup.session_date else None,
            "total_price": lineup.total_price,
            "max_participants": lineup.max_participants,
            "lineup_status": lineup.lineup_status,
            "lineup_closes_at": lineup.lineup_closes_at.isoformat() if lineup.lineup_closes_at else None,
            "lineup_visibility": lineup.lineup_visibility,
            "lineup_min_crew": lineup.lineup_min_crew,
            "lineup_max_crew": lineup.lineup_max_crew,
            "lineup_message": lineup.lineup_message,
            "participants": [
                {"participant_id": p.participant_id, "status": p.status}
                for p in lineup.participants
            ]
        }
        for lineup in visible_lineups
    ]
