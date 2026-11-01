"""
Photographer pricing management — SmugMug-style pricing + gallery pricing + earnings dashboard.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func
from typing import List
from datetime import datetime, timezone
import logging

logger = logging.getLogger(__name__)

from database import get_db
from core.security import get_current_user_id
from models import Profile, CreditTransaction, RoleEnum
from .schemas import (
    UpdatePricingRequest, PricingResponse,
    UpdateGalleryPricingRequest,
    EarningsBreakdownResponse,
    is_photographer_role,
)

router = APIRouter()


# ============ PRICING MANAGEMENT ============

@router.get("/photographer/{photographer_id}/pricing", response_model=PricingResponse)
async def get_photographer_pricing(
    photographer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get photographer's SmugMug-style pricing settings"""
    result = await db.execute(select(Profile).where(Profile.id == photographer_id))
    photographer = result.scalar_one_or_none()
    
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    if not is_photographer_role(photographer.role):
        raise HTTPException(status_code=403, detail="User is not a photographer")
    
    return PricingResponse(
        live_buyin_price=photographer.live_buyin_price or 25.0,
        live_photo_price=photographer.live_photo_price or 5.0,
        photo_package_size=photographer.photo_package_size or 0,
        booking_hourly_rate=photographer.booking_hourly_rate or 50.0,
        booking_min_hours=photographer.booking_min_hours or 1.0,
        # Resolution-tiered pricing for General Bookings
        booking_price_web=photographer.booking_price_web or 3.0,
        booking_price_standard=photographer.booking_price_standard or 5.0,
        booking_price_high=photographer.booking_price_high or 10.0,
        booking_photos_included=photographer.booking_photos_included or 3,
        booking_full_gallery=photographer.booking_full_gallery or False,
        price_per_additional_surfer=photographer.price_per_additional_surfer or 15.0,
        # Group discounts
        group_discount_2_plus=photographer.group_discount_2_plus or 0.0,
        group_discount_3_plus=photographer.group_discount_3_plus or 0.0,
        group_discount_5_plus=photographer.group_discount_5_plus or 0.0,
        # Service Area & Travel Fees
        service_radius_miles=photographer.service_radius_miles or 25.0,
        home_latitude=photographer.home_latitude,
        home_longitude=photographer.home_longitude,
        home_location_name=photographer.home_location_name,
        charges_travel_fees=photographer.charges_travel_fees or False,
        travel_surcharges=photographer.travel_surcharges
    )


@router.put("/photographer/{photographer_id}/pricing")
async def update_photographer_pricing(
    photographer_id: str,
    data: UpdatePricingRequest,
    current_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Update photographer's SmugMug-style pricing settings"""
    if photographer_id != current_user_id:
        raise HTTPException(status_code=403, detail="Cannot act on behalf of another user")
    result = await db.execute(select(Profile).where(Profile.id == photographer_id))
    photographer = result.scalar_one_or_none()
    
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    if not is_photographer_role(photographer.role):
        raise HTTPException(status_code=403, detail="User is not a photographer")
    
    # Update only provided fields
    if data.live_buyin_price is not None:
        if data.live_buyin_price < 0:
            raise HTTPException(status_code=400, detail="Buy-in price cannot be negative")
        photographer.live_buyin_price = data.live_buyin_price
        photographer.session_price = data.live_buyin_price  # Keep in sync
    
    if data.live_photo_price is not None:
        if data.live_photo_price < 0:
            raise HTTPException(status_code=400, detail="Photo price cannot be negative")
        photographer.live_photo_price = data.live_photo_price
    
    if data.photo_package_size is not None:
        if data.photo_package_size < 0:
            raise HTTPException(status_code=400, detail="Package size cannot be negative")
        photographer.photo_package_size = data.photo_package_size
    
    if data.booking_hourly_rate is not None:
        if data.booking_hourly_rate < 0:
            raise HTTPException(status_code=400, detail="Hourly rate cannot be negative")
        photographer.booking_hourly_rate = data.booking_hourly_rate
        photographer.hourly_rate = data.booking_hourly_rate  # Keep in sync
    
    if data.booking_min_hours is not None:
        if data.booking_min_hours < 0.5:
            raise HTTPException(status_code=400, detail="Minimum booking must be at least 30 minutes")
        photographer.booking_min_hours = data.booking_min_hours
    
    # NEW: Resolution-tiered pricing for General Bookings
    if data.booking_price_web is not None:
        photographer.booking_price_web = data.booking_price_web
    
    if data.booking_price_standard is not None:
        photographer.booking_price_standard = data.booking_price_standard
    
    if data.booking_price_high is not None:
        photographer.booking_price_high = data.booking_price_high
    
    if data.booking_photos_included is not None:
        photographer.booking_photos_included = data.booking_photos_included
    
    if data.booking_full_gallery is not None:
        photographer.booking_full_gallery = data.booking_full_gallery
    
    if data.price_per_additional_surfer is not None:
        photographer.price_per_additional_surfer = data.price_per_additional_surfer
    
    # Group discounts
    if data.group_discount_2_plus is not None:
        photographer.group_discount_2_plus = max(0, min(50, data.group_discount_2_plus))
    
    if data.group_discount_3_plus is not None:
        photographer.group_discount_3_plus = max(0, min(50, data.group_discount_3_plus))
    
    if data.group_discount_5_plus is not None:
        photographer.group_discount_5_plus = max(0, min(50, data.group_discount_5_plus))
    
    # Service Area & Travel Fees
    if data.service_radius_miles is not None:
        photographer.service_radius_miles = max(5, min(200, data.service_radius_miles))
    
    if data.home_latitude is not None:
        photographer.home_latitude = data.home_latitude
    
    if data.home_longitude is not None:
        photographer.home_longitude = data.home_longitude
    
    if data.home_location_name is not None:
        photographer.home_location_name = data.home_location_name
    
    if data.charges_travel_fees is not None:
        photographer.charges_travel_fees = data.charges_travel_fees
    
    if data.travel_surcharges is not None:
        photographer.travel_surcharges = data.travel_surcharges
    
    await db.commit()
    await db.refresh(photographer)
    
    return {
        "message": "Pricing updated successfully",
        "pricing": {
            "live_buyin_price": photographer.live_buyin_price,
            "live_photo_price": photographer.live_photo_price,
            "photo_package_size": photographer.photo_package_size,
            "booking_hourly_rate": photographer.booking_hourly_rate,
            "booking_min_hours": photographer.booking_min_hours,
            "booking_price_web": photographer.booking_price_web,
            "booking_price_standard": photographer.booking_price_standard,
            "booking_price_high": photographer.booking_price_high,
            "booking_photos_included": photographer.booking_photos_included,
            "booking_full_gallery": photographer.booking_full_gallery,
            "price_per_additional_surfer": photographer.price_per_additional_surfer,
            "group_discount_2_plus": photographer.group_discount_2_plus or 0,
            "group_discount_3_plus": photographer.group_discount_3_plus or 0,
            "group_discount_5_plus": photographer.group_discount_5_plus or 0,
            "service_radius_miles": photographer.service_radius_miles or 25,
            "home_latitude": photographer.home_latitude,
            "home_longitude": photographer.home_longitude,
            "home_location_name": photographer.home_location_name,
            "charges_travel_fees": photographer.charges_travel_fees or False,
            "travel_surcharges": photographer.travel_surcharges
        }
    }


# ============ GALLERY PRICING ============

@router.get("/photographer/{photographer_id}/gallery-pricing")
async def get_gallery_pricing(
    photographer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get photographer's SmugMug-style gallery pricing tiers"""
    result = await db.execute(select(Profile).where(Profile.id == photographer_id))
    photographer = result.scalar_one_or_none()
    
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    if not is_photographer_role(photographer.role):
        raise HTTPException(status_code=403, detail="User is not a photographer")
    
    return {
        "photo_pricing": {
            "web": photographer.photo_price_web or 3.0,
            "standard": photographer.photo_price_standard or 5.0,
            "high": photographer.photo_price_high or 10.0
        },
        "video_pricing": {
            "720p": photographer.video_price_720p or 8.0,
            "1080p": photographer.video_price_1080p or 15.0,
            "4k": photographer.video_price_4k or 30.0
        },
        "session_pricing": {
            "on_demand_photo_price": photographer.on_demand_photo_price or 10.0,
            "on_demand_photos_included": photographer.on_demand_photos_included or 3,
            "on_demand_videos_included": photographer.on_demand_videos_included or 0,
            "live_session_photo_price": photographer.live_session_photo_price or 5.0,
            "live_session_photos_included": photographer.live_session_photos_included or 3,
            "live_session_videos_included": photographer.live_session_videos_included or 0,
            "live_buyin_price": photographer.live_buyin_price or 25.0,
            "booking_hourly_rate": photographer.booking_hourly_rate or 50.0,
            "booking_photos_included": photographer.booking_photos_included or 3,
            "booking_videos_included": photographer.booking_videos_included or 0,
            "booking_full_gallery": photographer.booking_full_gallery or False,
            "on_demand_full_gallery": photographer.on_demand_full_gallery or False,
            "live_session_full_gallery": photographer.live_session_full_gallery or False,
            "on_demand_hourly_rate": photographer.on_demand_hourly_rate or 75.0,
            # Booking advanced settings (display-only in Gallery Hub)
            "booking_min_hours": photographer.booking_min_hours or 1.0,
            "charges_travel_fees": photographer.charges_travel_fees or False,
            "service_radius_miles": photographer.service_radius_miles or 25.0,
            "group_discount_2_plus": photographer.group_discount_2_plus or 0.0,
            "group_discount_3_plus": photographer.group_discount_3_plus or 0.0,
            "group_discount_5_plus": photographer.group_discount_5_plus or 0.0,
        },
        # Independent per-session-type resolution pricing
        "on_demand_pricing": {
            "photo_web": photographer.on_demand_price_web or 5.0,
            "photo_standard": photographer.on_demand_price_standard or 10.0,
            "photo_high": photographer.on_demand_price_high or 18.0,
            "video_720p": photographer.on_demand_video_720p or 12.0,
            "video_1080p": photographer.on_demand_video_1080p or 20.0,
            "video_4k": photographer.on_demand_video_4k or 40.0,
        },
        "live_session_pricing": {
            "photo_web": photographer.live_price_web or 3.0,
            "photo_standard": photographer.live_price_standard or 6.0,
            "photo_high": photographer.live_price_high or 12.0,
            "video_720p": photographer.live_video_720p or 8.0,
            "video_1080p": photographer.live_video_1080p or 15.0,
            "video_4k": photographer.live_video_4k or 30.0,
        },
        "booking_pricing": {
            "photo_web": photographer.booking_price_web or 3.0,
            "photo_standard": photographer.booking_price_standard or 5.0,
            "photo_high": photographer.booking_price_high or 10.0,
            "video_720p": photographer.booking_video_720p or 8.0,
            "video_1080p": photographer.booking_video_1080p or 15.0,
            "video_4k": photographer.booking_video_4k or 30.0,
        }
    }


@router.put("/photographer/{photographer_id}/gallery-pricing")
async def update_gallery_pricing(
    photographer_id: str,
    data: UpdateGalleryPricingRequest,
    current_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Update photographer's SmugMug-style gallery pricing tiers (all session types independent)"""
    if photographer_id != current_user_id:
        raise HTTPException(status_code=403, detail="Cannot act on behalf of another user")
    result = await db.execute(select(Profile).where(Profile.id == photographer_id))
    photographer = result.scalar_one_or_none()

    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")

    if not is_photographer_role(photographer.role):
        raise HTTPException(status_code=403, detail="User is not a photographer")

    # Gallery pricing
    if data.photo_price_web is not None:
        photographer.photo_price_web = max(0, data.photo_price_web)
    if data.photo_price_standard is not None:
        photographer.photo_price_standard = max(0, data.photo_price_standard)
    if data.photo_price_high is not None:
        photographer.photo_price_high = max(0, data.photo_price_high)
    if data.video_price_720p is not None:
        photographer.video_price_720p = max(0, data.video_price_720p)
    if data.video_price_1080p is not None:
        photographer.video_price_1080p = max(0, data.video_price_1080p)
    if data.video_price_4k is not None:
        photographer.video_price_4k = max(0, data.video_price_4k)

    # Legacy session pricing
    if data.on_demand_photo_price is not None:
        photographer.on_demand_photo_price = max(0, data.on_demand_photo_price)
    if data.on_demand_photos_included is not None:
        photographer.on_demand_photos_included = max(0, data.on_demand_photos_included)
    if data.live_session_photo_price is not None:
        photographer.live_session_photo_price = max(0, data.live_session_photo_price)
    if data.live_session_photos_included is not None:
        photographer.live_session_photos_included = max(0, data.live_session_photos_included)

    # On-Demand independent resolution pricing
    if data.on_demand_price_web is not None:
        photographer.on_demand_price_web = max(0, data.on_demand_price_web)
    if data.on_demand_price_standard is not None:
        photographer.on_demand_price_standard = max(0, data.on_demand_price_standard)
    if data.on_demand_price_high is not None:
        photographer.on_demand_price_high = max(0, data.on_demand_price_high)
    if data.on_demand_video_720p is not None:
        photographer.on_demand_video_720p = max(0, data.on_demand_video_720p)
    if data.on_demand_video_1080p is not None:
        photographer.on_demand_video_1080p = max(0, data.on_demand_video_1080p)
    if data.on_demand_video_4k is not None:
        photographer.on_demand_video_4k = max(0, data.on_demand_video_4k)

    # Live Session independent resolution pricing
    if data.live_price_web is not None:
        photographer.live_price_web = max(0, data.live_price_web)
    if data.live_price_standard is not None:
        photographer.live_price_standard = max(0, data.live_price_standard)
    if data.live_price_high is not None:
        photographer.live_price_high = max(0, data.live_price_high)
    if data.live_video_720p is not None:
        photographer.live_video_720p = max(0, data.live_video_720p)
    if data.live_video_1080p is not None:
        photographer.live_video_1080p = max(0, data.live_video_1080p)
    if data.live_video_4k is not None:
        photographer.live_video_4k = max(0, data.live_video_4k)

    # Booking video pricing
    if data.booking_video_720p is not None:
        photographer.booking_video_720p = max(0, data.booking_video_720p)
    if data.booking_video_1080p is not None:
        photographer.booking_video_1080p = max(0, data.booking_video_1080p)
    if data.booking_video_4k is not None:
        photographer.booking_video_4k = max(0, data.booking_video_4k)

    # On-Demand hourly rate
    if data.on_demand_hourly_rate is not None:
        photographer.on_demand_hourly_rate = max(0, data.on_demand_hourly_rate)

    await db.commit()
    await db.refresh(photographer)

    return {
        "message": "Gallery pricing updated",
        "photo_pricing": {
            "web": photographer.photo_price_web,
            "standard": photographer.photo_price_standard,
            "high": photographer.photo_price_high
        },
        "video_pricing": {
            "720p": photographer.video_price_720p,
            "1080p": photographer.video_price_1080p,
            "4k": photographer.video_price_4k
        },
        "on_demand_pricing": {
            "photo_web": photographer.on_demand_price_web,
            "photo_standard": photographer.on_demand_price_standard,
            "photo_high": photographer.on_demand_price_high,
            "video_720p": photographer.on_demand_video_720p,
            "video_1080p": photographer.on_demand_video_1080p,
            "video_4k": photographer.on_demand_video_4k,
        },
        "live_session_pricing": {
            "photo_web": photographer.live_price_web,
            "photo_standard": photographer.live_price_standard,
            "photo_high": photographer.live_price_high,
            "video_720p": photographer.live_video_720p,
            "video_1080p": photographer.live_video_1080p,
            "video_4k": photographer.live_video_4k,
        },
        "booking_pricing": {
            "photo_web": photographer.booking_price_web,
            "photo_standard": photographer.booking_price_standard,
            "photo_high": photographer.booking_price_high,
            "video_720p": photographer.booking_video_720p,
            "video_1080p": photographer.booking_video_1080p,
            "video_4k": photographer.booking_video_4k,
        }
    }


# ============ UNIFIED EARNINGS DASHBOARD ============

# Seller credits are already net of the platform fee. Customer payments, wallet
# funding, refunds, sponsorship support and unknown movements are not revenue.
EARNING_STREAMS = {
    'live_session_earning': 'live_sessions',
    'photographer_earning': 'live_sessions',  # Historical seller earnings.
    'dispatch_earning': 'request_pro',
    'request_pro_earning': 'request_pro',
    'booking_earning': 'regular_bookings',
    'gallery_sale': 'gallery_sales',
    'bulk_gallery_sale': 'gallery_sales',
    'photo_subscription_earning': 'photo_subscriptions',
}
STREAM_KEYS = ('live_sessions', 'request_pro', 'regular_bookings', 'gallery_sales', 'photo_subscriptions')


async def _recorded_earnings(photographer_id, cutoff, db):
    result = await db.execute(select(CreditTransaction).where(
        CreditTransaction.user_id == photographer_id,
        CreditTransaction.amount > 0,
        CreditTransaction.transaction_type.in_(EARNING_STREAMS),
        CreditTransaction.created_at >= cutoff))
    return result.scalars().all()


def _stream_totals(transactions):
    totals = dict.fromkeys(STREAM_KEYS, 0.0)
    for transaction in transactions:
        totals[EARNING_STREAMS[transaction.transaction_type]] += transaction.amount
    totals = {key: round(value, 2) for key, value in totals.items()}
    return {**totals, 'total': round(sum(totals.values()), 2)}


async def _earnings_profile(photographer_id, current_user_id, db):
    if current_user_id != photographer_id:
        raise HTTPException(status_code=403, detail="Cannot act on behalf of another user")
    result = await db.execute(select(Profile).where(Profile.id == photographer_id))
    photographer = result.scalar_one_or_none()
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    if not is_photographer_role(photographer.role):
        raise HTTPException(status_code=403, detail="User is not a photographer")
    return photographer


@router.get("/photographer/{photographer_id}/earnings-breakdown", response_model=EarningsBreakdownResponse)
async def get_earnings_breakdown(
    photographer_id: str,
    days: int = Query(default=30, ge=1, le=365),
    current_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Recorded seller credits after fees, with current wallet cash separately."""
    from datetime import timedelta
    photographer = await _earnings_profile(photographer_id, current_user_id, db)
    transactions = await _recorded_earnings(
        photographer_id, datetime.now(timezone.utc) - timedelta(days=days), db)
    balance = max(0.0, photographer.credit_balance or 0)
    cash_cap = max(0.0, balance - (photographer.spend_only_credits or 0))
    cash_available = max(0.0, min(photographer.withdrawable_credits or 0, cash_cap))
    return EarningsBreakdownResponse(
        **_stream_totals(transactions), wallet_balance=round(balance, 2),
        cash_available=round(cash_available, 2), split_bookings=[])


@router.get("/photographer/{photographer_id}/earnings-history")
async def get_earnings_history(
    photographer_id: str,
    months: int = Query(default=12, ge=1, le=24),
    current_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Calendar-month history of the same recorded net seller credits."""
    await _earnings_profile(photographer_id, current_user_id, db)
    now = datetime.now(timezone.utc)
    month_index = now.year * 12 + now.month - 1
    buckets = []
    for offset in range(months):
        year, month_zero = divmod(month_index - offset, 12)
        buckets.append((year, month_zero + 1))
    first_year, first_month = buckets[-1]
    transactions = await _recorded_earnings(
        photographer_id, datetime(first_year, first_month, 1, tzinfo=timezone.utc), db)
    grouped = {key: [] for key in buckets}
    for transaction in transactions:
        created = transaction.created_at
        if created.tzinfo is not None:
            created = created.astimezone(timezone.utc)
        key = (created.year, created.month)
        if key in grouped:
            grouped[key].append(transaction)
    history = [{
        'year': year, 'month': month,
        'month_name': datetime(year, month, 1).strftime('%b %Y'),
        **_stream_totals(grouped[(year, month)]),
    } for year, month in buckets]
    total = round(sum(row['total'] for row in history), 2)
    current = history[0]['total']
    previous = history[1]['total'] if len(history) > 1 else 0
    change = (current - previous) / previous * 100 if previous > 0 else 0
    return {
        'history': history,
        'summary': {
            'total_earnings': total, 'avg_monthly': round(total / months, 2),
            'current_month': current, 'previous_month': previous,
            'month_over_month_change': round(change, 1),
            'best_month': max(history, key=lambda row: row['total']),
        },
    }
