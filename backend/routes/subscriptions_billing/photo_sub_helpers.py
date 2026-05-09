"""
subscriptions_billing/photo_sub_helpers.py — Standalone subscription helpers.
Extracted from photo_subscriptions.py (v94 audit) for LOC compliance.

These are non-endpoint helper functions called by other services
(gallery, bookings, etc.) to check/use subscription quota.
"""
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from datetime import datetime, timezone

from models import SurferPhotoSubscription


async def try_use_subscription_quota(
    db: AsyncSession,
    surfer_id: str,
    photographer_id: str,
    quota_type: str,  # 'photo', 'video', 'live_buyin', 'session'
    quantity: int = 1,
) -> dict:
    """
    Check if surfer has an active subscription with photographer and decrement quota.
    Returns {"used": True, "remaining": N} if quota was consumed,
    or {"used": False} if no active subscription or no quota remaining.
    Does NOT commit — caller is responsible for committing the transaction.

    Usage from gallery.py:
        from routes.subscriptions_billing.photo_sub_helpers import try_use_subscription_quota
        result = await try_use_subscription_quota(db, buyer_id, photographer_id, 'photo')
        if result["used"]:
            # Photo is free for subscriber — skip credit deduction
    """
    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(SurferPhotoSubscription).where(and_(
            SurferPhotoSubscription.surfer_id == surfer_id,
            SurferPhotoSubscription.photographer_id == photographer_id,
            SurferPhotoSubscription.status == 'active',
            SurferPhotoSubscription.expires_at > now,
        ))
    )
    sub = result.scalar_one_or_none()
    if not sub:
        return {"used": False, "subscription_active": False}

    field_map = {
        'photo': 'photos_remaining',
        'video': 'videos_remaining',
        'live_buyin': 'live_session_buyins_remaining',
        'session': 'sessions_remaining',
    }
    field = field_map.get(quota_type)
    if not field:
        return {"used": False, "reason": "invalid_type"}

    current = getattr(sub, field, 0)
    if current < quantity:
        return {"used": False, "remaining": current, "subscription_active": True}

    setattr(sub, field, current - quantity)
    return {
        "used": True,
        "remaining": current - quantity,
        "subscription_id": sub.id,
        "subscription_active": True,
        "booking_discount_pct": sub.booking_discount_pct,
        "on_demand_discount_pct": sub.on_demand_discount_pct,
    }


async def get_subscription_discount(
    db: AsyncSession,
    surfer_id: str,
    photographer_id: str,
    service_type: str = 'booking',  # 'booking' or 'on_demand'
) -> float:
    """
    Get the active subscription discount percentage for a surfer-photographer pair.
    Returns 0.0 if no active subscription or no discount configured.
    """
    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(SurferPhotoSubscription).where(and_(
            SurferPhotoSubscription.surfer_id == surfer_id,
            SurferPhotoSubscription.photographer_id == photographer_id,
            SurferPhotoSubscription.status == 'active',
            SurferPhotoSubscription.expires_at > now,
        ))
    )
    sub = result.scalar_one_or_none()
    if not sub:
        return 0.0
    if service_type == 'on_demand':
        return sub.on_demand_discount_pct or 0.0
    return sub.booking_discount_pct or 0.0


async def check_quota_inline(
    db: AsyncSession,
    surfer_id: str,
    photographer_id: str,
    quota_type: str,  # 'photo', 'video', 'live_buyin', 'session'
) -> dict:
    """
    Read-only subscription quota check (does NOT decrement).
    Used by pricing endpoints to hint subscription coverage to the frontend.
    """
    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(SurferPhotoSubscription).where(and_(
            SurferPhotoSubscription.surfer_id == surfer_id,
            SurferPhotoSubscription.photographer_id == photographer_id,
            SurferPhotoSubscription.status == 'active',
            SurferPhotoSubscription.expires_at > now,
        ))
    )
    sub = result.scalar_one_or_none()
    if not sub:
        return {
            "has_quota": False,
            "remaining": 0,
            "subscription_active": False,
            "booking_discount_pct": 0,
            "on_demand_discount_pct": 0,
        }

    field_map = {
        'photo': 'photos_remaining',
        'video': 'videos_remaining',
        'live_buyin': 'live_session_buyins_remaining',
        'session': 'sessions_remaining',
    }
    field = field_map.get(quota_type, 'photos_remaining')
    remaining = getattr(sub, field, 0)

    return {
        "has_quota": remaining > 0,
        "remaining": remaining,
        "subscription_active": True,
        "booking_discount_pct": sub.booking_discount_pct or 0,
        "on_demand_discount_pct": sub.on_demand_discount_pct or 0,
        "plan_name": sub.plan_name,
    }
