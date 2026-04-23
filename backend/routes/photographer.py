"""
Photographer-specific routes for managing bookings and live sessions
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, func
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime, timezone
import secrets
import string
import json
import logging

logger = logging.getLogger(__name__)

from database import get_db
from models import (
    Profile, Booking, BookingParticipant, BookingInvite,
    LiveSessionParticipant, Notification, SurfSpot, RoleEnum,
    CreditTransaction, GalleryItem, LiveSession, Gallery,
    PhotographerAvailability, Story, Post, ConditionReport
)
from utils.grom_parent import is_grom_parent_eligible

router = APIRouter()


# ============ PYDANTIC MODELS ============

class CreateBookingRequest(BaseModel):
    location: str
    session_date: str  # ISO format
    duration: int = 60
    max_participants: int = 5
    price_per_person: float = 25.0
    description: Optional[str] = None
    allow_splitting: bool = True
    split_mode: str = 'friends_only'  # 'friends_only', 'open_nearby', or 'skill_match'
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    proximity_radius: float = 5.0
    skill_level_filter: Optional[str] = None  # 'Beginner', 'Intermediate', 'Advanced', 'Expert'
    surf_spot_id: Optional[str] = None  # Link to surf spot


class UpdateBookingStatusRequest(BaseModel):
    status: str  # Confirmed, Cancelled


class UpdateBookingDetailsRequest(BaseModel):
    location: Optional[str] = None
    session_date: Optional[str] = None
    duration: Optional[int] = None
    max_participants: Optional[int] = None
    description: Optional[str] = None


class GoLiveRequest(BaseModel):
    location: Optional[str] = None  # Can be derived from spot if not provided
    spot_id: Optional[str] = None
    spot_name: Optional[str] = None  # Spot name for display
    price_per_join: float = 25.0
    max_surfers: int = 10
    auto_accept: bool = True
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    # Hobbyist earnings destination (per-session override)
    earnings_destination_type: Optional[str] = None  # 'grom', 'cause', 'surfer', 'gear'
    earnings_destination_id: Optional[str] = None    # Profile ID or Gear Item ID
    earnings_cause_name: Optional[str] = None        # Name if donating to a cause
    # Live Session Rates (for gallery pricing override & savings display)
    live_photo_price: Optional[float] = None         # Session-specific photo price
    photos_included: Optional[int] = None            # Photos included in buy-in
    general_photo_price: Optional[float] = None      # Reference: photographer's general price
    estimated_duration: Optional[int] = None         # Estimated session duration in hours
    # Resolution-based pricing for Live Sessions (MANDATORY)
    photo_price_web: Optional[float] = None          # Web-res (social media)
    photo_price_standard: Optional[float] = None     # Standard digital delivery
    photo_price_high: Optional[float] = None         # High-res (print quality)
    # Condition capture for Go Live
    # Preferred: pre-uploaded URL from /upload/conditions (avoids large JSON body)
    condition_media_url: Optional[str] = None        # URL from pre-upload step (preferred)
    condition_media_type: Optional[str] = None       # 'image' or 'video'
    # Fallback: Base64 encoded media (legacy, kept for backward compat)
    condition_media: Optional[str] = None            # Base64 encoded media (photo/video)
    spot_notes: Optional[str] = None                 # Notes about current conditions
    is_streaming: Optional[bool] = False             # Whether live streaming is enabled


class BookingResponse(BaseModel):
    id: str
    photographer_id: str
    photographer_name: Optional[str] = None
    creator_id: Optional[str] = None
    creator_name: Optional[str] = None
    surf_spot_id: Optional[str] = None
    surf_spot_name: Optional[str] = None
    location: str
    session_date: datetime
    duration: int
    max_participants: int
    total_price: float
    price_per_person: Optional[float] = None
    allow_splitting: bool
    split_mode: str
    skill_level_filter: Optional[str] = None
    invite_code: Optional[str] = None
    status: str
    current_participants: int = 0
    participants: List[dict] = []
    description: Optional[str] = None
    created_at: datetime
    # Lineup Manager fields
    lineup_status: Optional[str] = 'open'
    lineup_auto_confirm: bool = False
    proximity_radius: float = 5.0
    lineup_closes_at: Optional[datetime] = None
    lineup_min_crew: Optional[int] = None
    lineup_max_crew: Optional[int] = None
    booking_type: Optional[str] = 'scheduled'


class LiveSessionResponse(BaseModel):
    photographer_id: str
    location: str
    spot_id: Optional[str] = None
    spot_name: Optional[str] = None
    price_per_join: float
    active_surfers: int = 0
    views: int = 0
    earnings: float = 0.0
    started_at: Optional[datetime] = None
    participants: List[dict] = []


class SessionHistoryItem(BaseModel):
    id: str
    location: str
    started_at: datetime
    duration_mins: int
    total_surfers: int
    total_earnings: float



class UpdatePricingRequest(BaseModel):
    """SmugMug-style pricing settings"""
    live_buyin_price: Optional[float] = None      # Price to join live session
    live_photo_price: Optional[float] = None      # Price per photo after buy-in
    photo_package_size: Optional[int] = None      # Photos included in buy-in (0 = none)
    booking_hourly_rate: Optional[float] = None   # Hourly rate for scheduled bookings
    booking_min_hours: Optional[float] = None     # Minimum booking duration
    # NEW: Resolution-tiered pricing for General Bookings
    booking_price_web: Optional[float] = None     # Web-res photo price
    booking_price_standard: Optional[float] = None # Standard photo price
    booking_price_high: Optional[float] = None    # High-res photo price
    booking_photos_included: Optional[int] = None # Photos included in booking
    booking_full_gallery: Optional[bool] = None   # Full gallery access toggle
    price_per_additional_surfer: Optional[float] = None  # Crew split pricing
    # Group discounts
    group_discount_2_plus: Optional[float] = None  # Discount % for 2+ surfers
    group_discount_3_plus: Optional[float] = None  # Discount % for 3+ surfers
    group_discount_5_plus: Optional[float] = None  # Discount % for 5+ surfers
    # Service Area & Travel Fees (Photographer-controlled for scheduled bookings)
    service_radius_miles: Optional[float] = None   # Max travel distance
    home_latitude: Optional[float] = None          # Base location lat
    home_longitude: Optional[float] = None         # Base location lng
    home_location_name: Optional[str] = None       # Human-readable location name
    charges_travel_fees: Optional[bool] = None     # Enable travel fees
    travel_surcharges: Optional[List[dict]] = None # Distance-based surcharge tiers


class PricingResponse(BaseModel):
    live_buyin_price: float
    live_photo_price: float
    photo_package_size: int
    booking_hourly_rate: float
    booking_min_hours: float
    # NEW: Resolution-tiered pricing for General Bookings
    booking_price_web: float = 3.0
    booking_price_standard: float = 5.0
    booking_price_high: float = 10.0
    booking_photos_included: int = 3
    booking_full_gallery: bool = False
    # Group discounts
    group_discount_2_plus: float = 0.0
    group_discount_3_plus: float = 0.0
    group_discount_5_plus: float = 0.0
    price_per_additional_surfer: float = 15.0
    # Service Area & Travel Fees
    service_radius_miles: float = 25.0
    home_latitude: Optional[float] = None
    home_longitude: Optional[float] = None
    home_location_name: Optional[str] = None
    charges_travel_fees: bool = False
    travel_surcharges: Optional[List[dict]] = None


# ============ AVAILABILITY MODELS ============

class CreateAvailabilityRequest(BaseModel):
    dates: Optional[List[str]] = []  # ISO date strings
    time_preset: str = 'custom'  # morning, afternoon, evening, all_day, custom
    start_time: str = '07:00'
    end_time: str = '17:00'
    is_recurring: bool = False
    recurring_days: Optional[List[int]] = []  # 0=Sun, 1=Mon, etc.


class AvailabilityWindowUpdate(BaseModel):
    windows: List[dict]  # [{day: 0-6, enabled: bool, start: str, end: str}]


class BlockDateRequest(BaseModel):
    date: str  # ISO date string YYYY-MM-DD


class AvailabilityResponse(BaseModel):
    id: str
    photographer_id: str
    date: Optional[str] = None
    is_recurring: bool = False
    recurring_days: Optional[List[int]] = None
    start_time: str
    end_time: str
    time_preset: str


# ============ HELPER FUNCTIONS ============

def generate_invite_code(length: int = 6) -> str:
    """Generate a unique invite code"""
    chars = string.ascii_uppercase + string.digits
    return ''.join(secrets.choice(chars) for _ in range(length))


def is_photographer_role(role: RoleEnum) -> bool:
    """Check if the role is a photographer-type role"""
    return role in [RoleEnum.GROM_PARENT, RoleEnum.HOBBYIST, RoleEnum.PHOTOGRAPHER, RoleEnum.APPROVED_PRO]



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
    db: AsyncSession = Depends(get_db)
):
    """Update photographer's SmugMug-style pricing settings"""
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


# ============ AVAILABILITY CALENDAR ENDPOINTS ============

@router.get("/photographer/{photographer_id}/bookings-calendar")
async def get_photographer_bookings_calendar(
    photographer_id: str,
    start: str,
    end: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Get photographer's bookings for calendar display.
    Also returns blocked dates and availability windows.
    """
    result = await db.execute(select(Profile).where(Profile.id == photographer_id))
    photographer = result.scalar_one_or_none()
    
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    # Parse date range
    try:
        start_date = datetime.fromisoformat(start.replace('Z', '+00:00'))
        end_date = datetime.fromisoformat(end.replace('Z', '+00:00'))
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format")
    
    # Get bookings in range
    bookings_result = await db.execute(
        select(Booking)
        .where(
            and_(
                Booking.photographer_id == photographer_id,
                Booking.session_date >= start_date,
                Booking.session_date <= end_date,
                Booking.status.in_(['Pending', 'Confirmed', 'Completed'])
            )
        )
        .options(
            selectinload(Booking.creator),
            selectinload(Booking.participants)
        )
    )
    bookings = bookings_result.scalars().all()
    
    # Transform bookings for calendar
    calendar_bookings = []
    for b in bookings:
        confirmed_count = 0
        if b.participants:
            # Count all participants (pending + confirmed) as spots filled
            active_count = len([p for p in b.participants if p.status in ['pending', 'confirmed']])
        calendar_bookings.append({
            "id": b.id,
            "session_date": b.session_date.isoformat() if b.session_date else None,
            "status": b.status,
            "location": b.location,
            "duration": b.duration,
            "surfer_name": b.creator.full_name if b.creator else None,
            "current_participants": active_count
        })
    
    # Get availability windows (recurring schedule)
    availability_result = await db.execute(
        select(PhotographerAvailability)
        .where(
            and_(
                PhotographerAvailability.photographer_id == photographer_id,
                PhotographerAvailability.is_recurring == True
            )
        )
    )
    availability_records = availability_result.scalars().all()
    
    # Build weekly windows from DB or use defaults
    windows = []
    for day in range(7):
        day_record = next((a for a in availability_records if day in (a.recurring_days or [])), None)
        if day_record:
            windows.append({
                "day": day,
                "enabled": True,
                "start": day_record.start_time,
                "end": day_record.end_time
            })
        else:
            # Default: Mon-Sat 6am-6pm, Sunday off
            windows.append({
                "day": day,
                "enabled": day != 0,
                "start": "06:00",
                "end": "18:00"
            })
    
    # Get blocked dates
    blocked_result = await db.execute(
        select(PhotographerAvailability)
        .where(
            and_(
                PhotographerAvailability.photographer_id == photographer_id,
                PhotographerAvailability.is_recurring == False,
                PhotographerAvailability.date != None
            )
        )
    )
    blocked_records = blocked_result.scalars().all()
    blocked_dates = [str(b.date) for b in blocked_records if b.start_time == '00:00' and b.end_time == '00:00']
    
    return {
        "bookings": calendar_bookings,
        "availability_windows": windows,
        "blocked_dates": blocked_dates
    }


@router.put("/photographer/{photographer_id}/availability-windows")
async def update_availability_windows(
    photographer_id: str,
    data: AvailabilityWindowUpdate,
    db: AsyncSession = Depends(get_db)
):
    """Update photographer's weekly availability windows"""
    result = await db.execute(select(Profile).where(Profile.id == photographer_id))
    photographer = result.scalar_one_or_none()
    
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    # Delete existing recurring availability
    await db.execute(
        select(PhotographerAvailability).where(
            and_(
                PhotographerAvailability.photographer_id == photographer_id,
                PhotographerAvailability.is_recurring == True
            )
        )
    )
    # Note: Actually delete them
    from sqlalchemy import delete
    await db.execute(
        delete(PhotographerAvailability).where(
            and_(
                PhotographerAvailability.photographer_id == photographer_id,
                PhotographerAvailability.is_recurring == True
            )
        )
    )
    
    # Create new recurring availability for enabled days
    for window in data.windows:
        if window.get('enabled'):
            avail = PhotographerAvailability(
                photographer_id=photographer_id,
                is_recurring=True,
                recurring_days=[window['day']],
                start_time=window.get('start', '06:00'),
                end_time=window.get('end', '18:00'),
                time_preset='custom'
            )
            db.add(avail)
    
    await db.commit()
    
    return {"message": "Availability updated successfully"}


@router.post("/photographer/{photographer_id}/block-date")
async def block_date(
    photographer_id: str,
    data: BlockDateRequest,
    db: AsyncSession = Depends(get_db)
):
    """Block a specific date - surfers cannot book this day"""
    result = await db.execute(select(Profile).where(Profile.id == photographer_id))
    photographer = result.scalar_one_or_none()
    
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    # Parse date
    try:
        block_date = datetime.strptime(data.date, '%Y-%m-%d').date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")
    
    # Check if already blocked
    existing = await db.execute(
        select(PhotographerAvailability).where(
            and_(
                PhotographerAvailability.photographer_id == photographer_id,
                PhotographerAvailability.date == block_date,
                PhotographerAvailability.is_recurring == False
            )
        )
    )
    if existing.scalar_one_or_none():
        return {"message": "Date already blocked"}
    
    # Create block record (start/end 00:00 indicates blocked)
    block = PhotographerAvailability(
        photographer_id=photographer_id,
        date=block_date,
        is_recurring=False,
        start_time='00:00',
        end_time='00:00',
        time_preset='blocked'
    )
    db.add(block)
    await db.commit()
    
    return {"message": f"Date {data.date} blocked successfully"}


@router.post("/photographer/{photographer_id}/unblock-date")
async def unblock_date(
    photographer_id: str,
    data: BlockDateRequest,
    db: AsyncSession = Depends(get_db)
):
    """Unblock a specific date"""
    result = await db.execute(select(Profile).where(Profile.id == photographer_id))
    photographer = result.scalar_one_or_none()
    
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    # Parse date
    try:
        unblock_date = datetime.strptime(data.date, '%Y-%m-%d').date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")
    
    # Delete block record
    from sqlalchemy import delete
    await db.execute(
        delete(PhotographerAvailability).where(
            and_(
                PhotographerAvailability.photographer_id == photographer_id,
                PhotographerAvailability.date == unblock_date,
                PhotographerAvailability.is_recurring == False
            )
        )
    )
    await db.commit()
    
    return {"message": f"Date {data.date} unblocked successfully"}


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


class UpdateGalleryPricingRequest(BaseModel):
    # Gallery pricing (general)
    photo_price_web: Optional[float] = None
    photo_price_standard: Optional[float] = None
    photo_price_high: Optional[float] = None
    video_price_720p: Optional[float] = None
    video_price_1080p: Optional[float] = None
    video_price_4k: Optional[float] = None
    # Legacy session pricing (single-tier, kept for backward compat)
    on_demand_photo_price: Optional[float] = None
    on_demand_photos_included: Optional[int] = None
    live_session_photo_price: Optional[float] = None
    live_session_photos_included: Optional[int] = None
    # On-Demand independent resolution pricing
    on_demand_price_web: Optional[float] = None
    on_demand_price_standard: Optional[float] = None
    on_demand_price_high: Optional[float] = None
    on_demand_video_720p: Optional[float] = None
    on_demand_video_1080p: Optional[float] = None
    on_demand_video_4k: Optional[float] = None
    # Live Session independent resolution pricing
    live_price_web: Optional[float] = None
    live_price_standard: Optional[float] = None
    live_price_high: Optional[float] = None
    live_video_720p: Optional[float] = None
    live_video_1080p: Optional[float] = None
    live_video_4k: Optional[float] = None
    # Booking video pricing (photo tiers already exist)
    booking_video_720p: Optional[float] = None
    booking_video_1080p: Optional[float] = None
    booking_video_4k: Optional[float] = None
    # On-Demand hourly rate
    on_demand_hourly_rate: Optional[float] = None


@router.put("/photographer/{photographer_id}/gallery-pricing")
async def update_gallery_pricing(
    photographer_id: str,
    data: UpdateGalleryPricingRequest,
    db: AsyncSession = Depends(get_db)
):
    """Update photographer's SmugMug-style gallery pricing tiers (all session types independent)"""
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


@router.get("/photographer/{photographer_id}/live-participants")
async def get_live_session_participants(
    photographer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get list of users currently in photographer's live session with full identification info"""
    # Check if photographer is shooting
    photographer_result = await db.execute(
        select(Profile).where(Profile.id == photographer_id)
        .options(selectinload(Profile.current_spot))
    )
    photographer = photographer_result.scalar_one_or_none()
    
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    if not photographer.is_shooting:
        return {
            "is_live": False,
            "participants": [],
            "total_participants": 0,
            "total_earnings": 0
        }
    
    # Get active participants with full surfer info
    result = await db.execute(
        select(LiveSessionParticipant)
        .where(LiveSessionParticipant.photographer_id == photographer_id)
        .where(LiveSessionParticipant.status == 'active')
        .options(selectinload(LiveSessionParticipant.surfer))
        .order_by(LiveSessionParticipant.joined_at.desc())
    )
    participants = result.scalars().all()
    
    total_earnings = sum(p.amount_paid for p in participants)
    
    participants_data = []
    for p in participants:
        surfer = p.surfer
        participants_data.append({
            "id": p.id,
            "surfer_id": p.surfer_id,
            "name": surfer.full_name if surfer else "Unknown",
            "username": surfer.username if surfer else None,
            "avatar_url": surfer.avatar_url if surfer else None,
            "selfie_url": p.selfie_url,
            "role": surfer.role.value if surfer and surfer.role else None,
            "amount_paid": p.amount_paid,
            "joined_at": p.joined_at.isoformat(),
            # Identification fields
            "stance": surfer.stance if surfer else None,  # 'regular' or 'goofy'
            "wetsuit_color": surfer.wetsuit_color if surfer else None,
            "rash_guard_color": surfer.rash_guard_color if surfer else None,
            "skill_level": surfer.skill_level if surfer else None,
            # Photographer's notes for this surfer
            "photographer_notes": p.photographer_notes
        })
    
    return {
        "is_live": True,
        "location": photographer.location or (photographer.current_spot.name if photographer.current_spot else None),
        "spot_name": photographer.current_spot.name if photographer.current_spot else None,
        "started_at": photographer.shooting_started_at.isoformat() if photographer.shooting_started_at else None,
        "participants": participants_data,
        "total_participants": len(participants_data),
        "total_earnings": total_earnings
    }



class UpdateParticipantNotesRequest(BaseModel):
    notes: Optional[str] = None

@router.patch("/photographer/{photographer_id}/participant/{participant_id}/notes")
async def update_participant_notes(
    photographer_id: str,
    participant_id: str,
    data: UpdateParticipantNotesRequest,
    db: AsyncSession = Depends(get_db)
):
    """Update photographer's notes for a session participant (for identification)"""
    # Verify the participant belongs to this photographer's session
    result = await db.execute(
        select(LiveSessionParticipant)
        .where(LiveSessionParticipant.id == participant_id)
        .where(LiveSessionParticipant.photographer_id == photographer_id)
    )
    participant = result.scalar_one_or_none()
    
    if not participant:
        raise HTTPException(status_code=404, detail="Participant not found in your session")
    
    participant.photographer_notes = data.notes
    await db.commit()
    
    return {"success": True, "notes": data.notes}


# ============ BOOKING MANAGEMENT ============

@router.get("/photographer/{photographer_id}/bookings", response_model=List[BookingResponse])
async def get_photographer_bookings(
    photographer_id: str,
    status: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """Get all bookings for a photographer"""
    # Verify photographer exists and has photographer role
    photographer_result = await db.execute(
        select(Profile).where(Profile.id == photographer_id)
    )
    photographer = photographer_result.scalar_one_or_none()
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    if not is_photographer_role(photographer.role):
        raise HTTPException(status_code=403, detail="User is not a photographer")
    
    # Build query
    query = select(Booking).where(Booking.photographer_id == photographer_id)
    
    if status:
        query = query.where(Booking.status == status)
    
    query = query.options(
        selectinload(Booking.participants).selectinload(BookingParticipant.participant),
        selectinload(Booking.creator)
    ).order_by(Booking.session_date.desc())
    
    result = await db.execute(query)
    bookings = result.scalars().all()
    
    response = []
    for booking in bookings:
        participants_data = []
        for p in booking.participants:
            participants_data.append({
                "id": p.id,
                "participant_id": p.participant_id,
                "name": p.participant.full_name if p.participant else None,
                "avatar_url": p.participant.avatar_url if p.participant else None,
                "status": p.status,
                "payment_status": p.payment_status,
                "paid_amount": p.paid_amount
            })
        
        response.append(BookingResponse(
            id=booking.id,
            photographer_id=booking.photographer_id,
            photographer_name=photographer.full_name,
            creator_id=booking.creator_id,
            creator_name=booking.creator.full_name if booking.creator else None,
            location=booking.location,
            session_date=booking.session_date,
            duration=booking.duration,
            max_participants=booking.max_participants,
            total_price=booking.total_price,
            price_per_person=booking.price_per_person,
            allow_splitting=booking.allow_splitting,
            split_mode=booking.split_mode,
            invite_code=booking.invite_code,
            status=booking.status,
            # Count all participants (pending + confirmed) as spots filled - captain counts even if not paid
            current_participants=len([p for p in booking.participants if p.status in ['pending', 'confirmed']]),
            participants=participants_data,
            description=booking.description,
            created_at=booking.created_at,
            # Lineup Manager fields
            lineup_status=booking.lineup_status or 'open',
            lineup_auto_confirm=booking.lineup_auto_confirm or False,
            proximity_radius=booking.proximity_radius or 5.0,
            lineup_closes_at=booking.lineup_closes_at,
            lineup_min_crew=booking.lineup_min_crew,
            lineup_max_crew=booking.lineup_max_crew or booking.max_participants,
            booking_type=booking.booking_type or 'scheduled'
        ))
    
    return response


@router.get("/photographer/{photographer_id}/booked-slots")
async def get_booked_slots(
    photographer_id: str,
    date: str,
    db: AsyncSession = Depends(get_db)
):
    """Get booked time slots for a specific date - used for calendar gray-out logic"""
    # Parse the date
    try:
        target_date = datetime.fromisoformat(date).date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")
    
    # Get all bookings for this photographer on this date
    start_of_day = datetime.combine(target_date, datetime.min.time())
    end_of_day = datetime.combine(target_date, datetime.max.time())
    
    result = await db.execute(
        select(Booking).where(
            Booking.photographer_id == photographer_id,
            Booking.session_date >= start_of_day,
            Booking.session_date <= end_of_day,
            Booking.status.in_(['Pending', 'Confirmed'])
        )
    )
    bookings = result.scalars().all()
    
    # Extract booked time slots
    booked_slots = []
    for booking in bookings:
        time_str = booking.session_date.strftime("%H:%M")
        booked_slots.append({
            "date": date,
            "time": time_str,
            "booking_id": booking.id,
            "duration": booking.duration
        })
    
    return booked_slots


# ============ AVAILABILITY MANAGEMENT ============

@router.get("/photographer/{photographer_id}/availability")
async def get_photographer_availability(
    photographer_id: str,
    viewer_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """
    Get photographer's availability schedule
    
    Gold-Pass Logic:
    - tier_3 (Gold-Pass) users see ALL available slots
    - Non-Gold users see slots locked for 2 hours after creation (120 min time-gate)
    """
    from datetime import timedelta
    from routes.subscriptions import GOLD_PASS_BOOKING_WINDOW_HOURS
    
    result = await db.execute(
        select(PhotographerAvailability).where(
            PhotographerAvailability.photographer_id == photographer_id
        ).order_by(PhotographerAvailability.created_at.desc())
    )
    availability = result.scalars().all()
    
    # Check viewer's subscription tier for Gold-Pass
    has_gold_pass = False
    if viewer_id:
        viewer_result = await db.execute(select(Profile).where(Profile.id == viewer_id))
        viewer = viewer_result.scalar_one_or_none()
        if viewer:
            # tier_3 = Premium with Gold-Pass
            has_gold_pass = viewer.subscription_tier == 'premium'
    
    now = datetime.now(timezone.utc)
    gold_pass_window = timedelta(hours=GOLD_PASS_BOOKING_WINDOW_HOURS)
    
    slots = []
    for a in availability:
        slot_data = {
            "id": a.id,
            "photographer_id": a.photographer_id,
            "date": a.date.isoformat() if a.date else None,
            "is_recurring": a.is_recurring,
            "recurring_days": a.recurring_days,
            "start_time": a.start_time,
            "end_time": a.end_time,
            "time_preset": a.time_preset,
            "created_at": a.created_at.isoformat() if a.created_at else None
        }
        
        # Gold-Pass time-gate logic
        if has_gold_pass:
            # Gold-Pass users see everything unlocked
            slot_data["is_locked"] = False
            slot_data["unlock_time"] = None
            slot_data["unlock_minutes_remaining"] = 0
        else:
            # Check if slot was created within the last 2 hours
            if a.created_at:
                time_since_creation = now - a.created_at.replace(tzinfo=timezone.utc)
                if time_since_creation < gold_pass_window:
                    # Slot is locked for non-Gold users
                    slot_data["is_locked"] = True
                    unlock_time = a.created_at + gold_pass_window
                    slot_data["unlock_time"] = unlock_time.isoformat()
                    remaining = (gold_pass_window - time_since_creation).total_seconds() / 60
                    slot_data["unlock_minutes_remaining"] = max(0, int(remaining))
                else:
                    slot_data["is_locked"] = False
                    slot_data["unlock_time"] = None
                    slot_data["unlock_minutes_remaining"] = 0
            else:
                slot_data["is_locked"] = False
                slot_data["unlock_time"] = None
                slot_data["unlock_minutes_remaining"] = 0
        
        slots.append(slot_data)
    
    return {
        "slots": slots,
        "viewer_has_gold_pass": has_gold_pass,
        "gold_pass_window_hours": GOLD_PASS_BOOKING_WINDOW_HOURS
    }


@router.post("/photographer/{photographer_id}/availability")
async def create_availability(
    photographer_id: str,
    data: CreateAvailabilityRequest,
    db: AsyncSession = Depends(get_db)
):
    """Create availability slots for photographer"""
    # Verify photographer
    result = await db.execute(select(Profile).where(Profile.id == photographer_id))
    photographer = result.scalar_one_or_none()
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    if not is_photographer_role(photographer.role):
        raise HTTPException(status_code=403, detail="User is not a photographer")
    
    created_slots = []
    
    if data.is_recurring:
        # Create a single recurring availability
        availability = PhotographerAvailability(
            photographer_id=photographer_id,
            is_recurring=True,
            recurring_days=data.recurring_days,
            start_time=data.start_time,
            end_time=data.end_time,
            time_preset=data.time_preset
        )
        db.add(availability)
        created_slots.append(availability)
    else:
        # Create individual date slots
        from datetime import date as date_type
        for date_str in data.dates:
            try:
                parsed_date = date_type.fromisoformat(date_str.split('T')[0])
            except ValueError:
                continue
            
            availability = PhotographerAvailability(
                photographer_id=photographer_id,
                date=parsed_date,
                is_recurring=False,
                start_time=data.start_time,
                end_time=data.end_time,
                time_preset=data.time_preset
            )
            db.add(availability)
            created_slots.append(availability)
    
    await db.commit()
    
    return {
        "message": f"Created {len(created_slots)} availability slot(s)",
        "count": len(created_slots)
    }


@router.delete("/photographer/{photographer_id}/availability/{availability_id}")
async def delete_availability(
    photographer_id: str,
    availability_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Delete a specific availability slot"""
    result = await db.execute(
        select(PhotographerAvailability).where(
            PhotographerAvailability.id == availability_id,
            PhotographerAvailability.photographer_id == photographer_id
        )
    )
    availability = result.scalar_one_or_none()
    
    if not availability:
        raise HTTPException(status_code=404, detail="Availability not found")
    
    await db.delete(availability)
    await db.commit()
    
    return {"message": "Availability deleted"}


@router.get("/photographer/{photographer_id}/available-slots")
async def get_available_slots_for_surfer(
    photographer_id: str,
    date: str,
    db: AsyncSession = Depends(get_db)
):
    """Get available time slots for a specific date (used by surfers booking)
    
    Returns slots based on:
    1. Photographer's set availability (recurring or date-specific)
    2. Minus any already booked slots
    """
    from datetime import date as date_type
    
    try:
        target_date = date_type.fromisoformat(date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")
    
    day_of_week = target_date.weekday()  # 0=Monday
    # Convert to our format (0=Sunday)
    day_index = (day_of_week + 1) % 7
    
    # Get photographer's availability for this date - separate queries for date-specific and recurring
    date_specific_result = await db.execute(
        select(PhotographerAvailability).where(
            PhotographerAvailability.photographer_id == photographer_id,
            PhotographerAvailability.date == target_date
        )
    )
    
    recurring_result = await db.execute(
        select(PhotographerAvailability).where(
            PhotographerAvailability.photographer_id == photographer_id,
            PhotographerAvailability.is_recurring == True
        )
    )
    
    date_availabilities = date_specific_result.scalars().all()
    recurring_availabilities = recurring_result.scalars().all()
    
    # Filter recurring by day of week
    matching_recurring = [
        a for a in recurring_availabilities 
        if a.recurring_days and day_index in a.recurring_days
    ]
    
    availabilities = list(date_availabilities) + matching_recurring
    
    if not availabilities:
        return {"available_slots": [], "message": "No availability set for this date"}
    
    # Get already booked slots for this date
    start_of_day = datetime.combine(target_date, datetime.min.time())
    end_of_day = datetime.combine(target_date, datetime.max.time())
    
    booked_result = await db.execute(
        select(Booking).where(
            Booking.photographer_id == photographer_id,
            Booking.session_date >= start_of_day,
            Booking.session_date <= end_of_day,
            Booking.status.in_(['Pending', 'Confirmed'])
        )
    )
    booked = booked_result.scalars().all()
    booked_times = [b.session_date.strftime("%H:%M") for b in booked]
    
    # Generate available slots based on photographer's availability
    available_slots = []
    for avail in availabilities:
        start_hour, start_min = map(int, avail.start_time.split(':'))
        end_hour, end_min = map(int, avail.end_time.split(':'))
        
        current_hour = start_hour
        current_min = start_min
        
        while (current_hour < end_hour) or (current_hour == end_hour and current_min < end_min):
            time_str = f"{current_hour:02d}:{current_min:02d}"
            
            if time_str not in booked_times:
                time_label = datetime.strptime(time_str, "%H:%M").strftime("%I:%M %p").lstrip('0')
                available_slots.append({
                    "time": time_str,
                    "label": time_label,
                    "available": True
                })
            
            # Increment by 30 minutes
            current_min += 30
            if current_min >= 60:
                current_min = 0
                current_hour += 1
    
    # Remove duplicates and sort
    seen = set()
    unique_slots = []
    for slot in available_slots:
        if slot["time"] not in seen:
            seen.add(slot["time"])
            unique_slots.append(slot)
    
    unique_slots.sort(key=lambda x: x["time"])
    
    return {
        "available_slots": unique_slots,
        "date": date,
        "photographer_id": photographer_id
    }


@router.post("/photographer/{photographer_id}/bookings", response_model=BookingResponse)
async def create_booking(
    photographer_id: str,
    data: CreateBookingRequest,
    db: AsyncSession = Depends(get_db)
):
    """Create a new booking/session (photographer creating their own availability)"""
    # Verify photographer
    photographer_result = await db.execute(
        select(Profile).where(Profile.id == photographer_id)
    )
    photographer = photographer_result.scalar_one_or_none()
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    if not is_photographer_role(photographer.role):
        raise HTTPException(status_code=403, detail="User is not a photographer")
    
    # Parse session date
    try:
        session_date = datetime.fromisoformat(data.session_date.replace('Z', '+00:00'))
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format")
    
    # Calculate total price
    total_price = data.price_per_person * data.max_participants
    
    # Generate invite code if splitting is allowed
    invite_code = None
    if data.allow_splitting:
        invite_code = generate_invite_code()
        # Ensure uniqueness
        while True:
            existing = await db.execute(
                select(Booking).where(Booking.invite_code == invite_code)
            )
            if not existing.scalar_one_or_none():
                break
            invite_code = generate_invite_code()
    
    booking = Booking(
        photographer_id=photographer_id,
        creator_id=photographer_id,  # Photographer is the creator
        surf_spot_id=data.surf_spot_id,
        location=data.location,
        latitude=data.latitude,
        longitude=data.longitude,
        session_date=session_date,
        duration=data.duration,
        max_participants=data.max_participants,
        total_price=total_price,
        price_per_person=data.price_per_person,
        allow_splitting=data.allow_splitting,
        split_mode=data.split_mode,
        invite_code=invite_code,
        proximity_radius=data.proximity_radius,
        skill_level_filter=data.skill_level_filter,
        description=data.description,
        status='Confirmed'  # Photographer-created sessions are auto-confirmed
    )
    
    db.add(booking)
    await db.commit()
    await db.refresh(booking)
    
    return BookingResponse(
        id=booking.id,
        photographer_id=booking.photographer_id,
        photographer_name=photographer.full_name,
        creator_id=booking.creator_id,
        creator_name=photographer.full_name,
        location=booking.location,
        session_date=booking.session_date,
        duration=booking.duration,
        max_participants=booking.max_participants,
        total_price=booking.total_price,
        price_per_person=booking.price_per_person,
        allow_splitting=booking.allow_splitting,
        split_mode=booking.split_mode,
        skill_level_filter=booking.skill_level_filter,
        invite_code=booking.invite_code,
        status=booking.status,
        current_participants=0,
        participants=[],
        description=booking.description,
        created_at=booking.created_at
    )


@router.patch("/bookings/{booking_id}/status")
async def update_booking_status(
    booking_id: str,
    data: UpdateBookingStatusRequest,
    db: AsyncSession = Depends(get_db)
):
    """Update booking status (confirm, cancel)"""
    result = await db.execute(
        select(Booking).where(Booking.id == booking_id)
        .options(selectinload(Booking.participants))
    )
    booking = result.scalar_one_or_none()
    
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    
    valid_statuses = ['Pending', 'Confirmed', 'Completed', 'Cancelled']
    if data.status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of: {valid_statuses}")
    
    booking.status = data.status
    booking.updated_at = datetime.now(timezone.utc)
    
    # If cancelling, notify participants
    if data.status == 'Cancelled':
        for participant in booking.participants:
            notification = Notification(
                user_id=participant.participant_id,
                type='booking_cancelled',
                title='Booking Cancelled',
                body=f'The session at {booking.location} has been cancelled.',
                data=json.dumps({"booking_id": booking_id})
            )
            db.add(notification)
    
    await db.commit()
    
    return {"message": f"Booking {data.status.lower()}", "status": data.status}


@router.patch("/bookings/{booking_id}")
async def update_booking_details(
    booking_id: str,
    data: UpdateBookingDetailsRequest,
    db: AsyncSession = Depends(get_db)
):
    """Update booking details (location, date, duration, etc.)"""
    from routes.push import notify_booking
    
    result = await db.execute(
        select(Booking).where(Booking.id == booking_id)
        .options(
            selectinload(Booking.participants),
            selectinload(Booking.photographer),
            selectinload(Booking.creator)
        )
    )
    booking = result.scalar_one_or_none()
    
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    
    # Track what changed for notifications
    changes = []
    
    # Update fields if provided
    if data.location is not None and data.location != booking.location:
        changes.append(f"Location: {data.location}")
        booking.location = data.location
    
    if data.session_date is not None:
        try:
            new_date = datetime.fromisoformat(data.session_date.replace('Z', '+00:00'))
            if new_date != booking.session_date:
                changes.append(f"Date/Time: {new_date.strftime('%b %d at %I:%M %p')}")
                booking.session_date = new_date
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format")
    
    if data.duration is not None and data.duration != booking.duration:
        changes.append(f"Duration: {data.duration} minutes")
        booking.duration = data.duration
    
    if data.max_participants is not None and data.max_participants != booking.max_participants:
        changes.append(f"Max participants: {data.max_participants}")
        booking.max_participants = data.max_participants
    
    if data.description is not None:
        booking.description = data.description
    
    booking.updated_at = datetime.now(timezone.utc)
    
    # Notify participants if there were changes
    if changes and booking.status == 'Confirmed':
        change_summary = ", ".join(changes)
        for participant in booking.participants:
            if participant.participant_id != booking.photographer_id:  # Don't notify the one who made changes
                notification = Notification(
                    user_id=participant.participant_id,
                    type='booking_updated',
                    title='Booking Updated',
                    body=f'Your session at {booking.location} has been updated: {change_summary}',
                    data=json.dumps({"booking_id": booking_id, "changes": changes})
                )
                db.add(notification)
                
                try:
                    await notify_booking(
                        user_id=participant.participant_id,
                        title='Booking Updated',
                        message=f'Session updated: {change_summary}',
                        db=db
                    )
                except Exception:
                    pass  # Push notifications are best-effort
        
        # Also notify the creator if not the photographer
        if booking.creator_id and booking.creator_id != booking.photographer_id:
            notification = Notification(
                user_id=booking.creator_id,
                type='booking_updated',
                title='Booking Updated',
                body=f'Your session at {booking.location} has been updated: {change_summary}',
                data=json.dumps({"booking_id": booking_id, "changes": changes})
            )
            db.add(notification)
    
    await db.commit()
    
    return {
        "message": "Booking updated successfully",
        "booking_id": booking_id,
        "changes": changes
    }


@router.get("/bookings/{booking_id}")
async def get_booking_details(
    booking_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get detailed booking information"""
    result = await db.execute(
        select(Booking).where(Booking.id == booking_id)
        .options(
            selectinload(Booking.photographer),
            selectinload(Booking.creator),
            selectinload(Booking.participants).selectinload(BookingParticipant.participant)
        )
    )
    booking = result.scalar_one_or_none()
    
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    
    participants_data = []
    for p in booking.participants:
        participants_data.append({
            "id": p.id,
            "participant_id": p.participant_id,
            "name": p.participant.full_name if p.participant else None,
            "avatar_url": p.participant.avatar_url if p.participant else None,
            "status": p.status,
            "payment_status": p.payment_status,
            "paid_amount": p.paid_amount,
            "invite_type": p.invite_type
        })
    
    return {
        "id": booking.id,
        "photographer_id": booking.photographer_id,
        "photographer_name": booking.photographer.full_name if booking.photographer else None,
        "photographer_avatar": booking.photographer.avatar_url if booking.photographer else None,
        "creator_id": booking.creator_id,
        "creator_name": booking.creator.full_name if booking.creator else None,
        "location": booking.location,
        "latitude": booking.latitude,
        "longitude": booking.longitude,
        "session_date": booking.session_date.isoformat(),
        "duration": booking.duration,
        "max_participants": booking.max_participants,
        "total_price": booking.total_price,
        "price_per_person": booking.price_per_person,
        "allow_splitting": booking.allow_splitting,
        "split_mode": booking.split_mode,
        "invite_code": booking.invite_code,
        "proximity_radius": booking.proximity_radius,
        "status": booking.status,
        "description": booking.description,
        # Count all participants (pending + confirmed) as spots filled - captain counts even if not paid
        "current_participants": len([p for p in booking.participants if p.status in ['pending', 'confirmed']]),
        "participants": participants_data,
        "created_at": booking.created_at.isoformat()
    }


# ============ LIVE SESSION MANAGEMENT ============

@router.get("/photographer/{photographer_id}/active-session")
async def get_active_session(
    photographer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get photographer's current active live session"""
    # Get photographer
    photographer_result = await db.execute(
        select(Profile).where(Profile.id == photographer_id)
        .options(selectinload(Profile.current_spot))
    )
    photographer = photographer_result.scalar_one_or_none()
    
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    if not photographer.is_shooting:
        return None
    
    # Get active participants
    participants_result = await db.execute(
        select(LiveSessionParticipant)
        .where(LiveSessionParticipant.photographer_id == photographer_id)
        .where(LiveSessionParticipant.status == 'active')
        .options(selectinload(LiveSessionParticipant.surfer))
    )
    participants = participants_result.scalars().all()
    
    # Calculate earnings
    total_earnings = sum(p.amount_paid for p in participants)
    
    participants_data = []
    for p in participants:
        participants_data.append({
            "id": p.id,
            "surfer_id": p.surfer_id,
            "name": p.surfer.full_name if p.surfer else None,
            "avatar_url": p.surfer.avatar_url if p.surfer else None,
            "selfie_url": p.selfie_url,
            "amount_paid": p.amount_paid,
            "joined_at": p.joined_at.isoformat()
        })
    
    return LiveSessionResponse(
        photographer_id=photographer.id,
        location=photographer.location or "Unknown",
        spot_id=photographer.current_spot_id,
        spot_name=photographer.current_spot.name if photographer.current_spot else None,
        price_per_join=photographer.session_price or 25.0,
        active_surfers=len(participants),
        views=0,  # Could track views separately
        earnings=total_earnings,
        started_at=photographer.shooting_started_at,
        participants=participants_data
    )


@router.post("/photographer/{photographer_id}/go-live")
async def go_live(
    photographer_id: str,
    data: GoLiveRequest,
    db: AsyncSession = Depends(get_db)
):
    """Start a live shooting session"""
    photographer_result = await db.execute(
        select(Profile).where(Profile.id == photographer_id)
    )
    photographer = photographer_result.scalar_one_or_none()
    
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    if not is_photographer_role(photographer.role):
        raise HTTPException(status_code=403, detail="User is not a photographer")
    
    # ============ ROLE-BASED PERMISSION CHECK ============
    # Grom Parent: NO Live Sessions, NO On-Demand
    if is_grom_parent_eligible(photographer):
        raise HTTPException(
            status_code=403, 
            detail="Grom Parents cannot start Live Sessions. Gallery and Bookings access only."
        )
    
    # Hobbyist: Can do Live Sessions ONLY if no other photographers are nearby (0.1 mile radius)
    if photographer.role == RoleEnum.HOBBYIST:
        if data.latitude and data.longitude:
            # Check for Photographer/Pro types within 0.1 mile range
            # Haversine approximation: 1 degree lat ≈ 69 miles, 1 degree lon ≈ 69 * cos(lat) miles
            import math
            mile_threshold = 0.1  # 0.1 mile = ~528 feet
            lat_range = mile_threshold / 69.0  # Convert miles to degrees latitude
            lon_range = mile_threshold / (69.0 * math.cos(math.radians(data.latitude)))  # Adjust for longitude
            
            nearby_query = await db.execute(
                select(Profile).where(
                    and_(
                        Profile.is_shooting.is_(True),
                        Profile.role.in_([RoleEnum.PHOTOGRAPHER, RoleEnum.APPROVED_PRO]),
                        Profile.id != photographer_id,
                        Profile.on_demand_latitude.isnot(None),
                        Profile.on_demand_longitude.isnot(None)
                    )
                )
            )
            nearby_photographers = nearby_query.scalars().all()
            
            # Check distance for each active photographer
            for nearby_pro in nearby_photographers:
                if nearby_pro.on_demand_latitude and nearby_pro.on_demand_longitude:
                    lat_diff = abs(data.latitude - nearby_pro.on_demand_latitude)
                    lon_diff = abs(data.longitude - nearby_pro.on_demand_longitude)
                    
                    # Simple distance check using lat/lon ranges
                    if lat_diff <= lat_range and lon_diff <= lon_range:
                        raise HTTPException(
                            status_code=403,
                            detail="A Pro photographer is active within 0.1 miles of your location. Hobbyists can only go live when no Pro photographers are nearby."
                        )
    
    if photographer.is_shooting:
        # ── STALE SESSION RECOVERY ──
        # If shooting_started_at is more than 12 hours ago, the session is stale
        # (from a previous crash/incomplete end-session). Auto-reset instead of blocking.
        stale_threshold_hours = 12
        if photographer.shooting_started_at:
            started = photographer.shooting_started_at
            if started.tzinfo is None:
                started = started.replace(tzinfo=timezone.utc)
            hours_elapsed = (datetime.now(timezone.utc) - started).total_seconds() / 3600
            if hours_elapsed > stale_threshold_hours:
                logger.warning(
                    f"[go-live] Auto-resetting stale session for {photographer_id} "
                    f"(started {hours_elapsed:.1f}h ago)"
                )
                photographer.is_shooting = False
                photographer.current_spot_id = None
                photographer.shooting_started_at = None
                # Also end any lingering LiveSession records
                stale_sessions = await db.execute(
                    select(LiveSession).where(
                        LiveSession.photographer_id == photographer_id,
                        LiveSession.status == 'active'
                    )
                )
                for stale_session in stale_sessions.scalars().all():
                    stale_session.status = 'ended'
                    stale_session.ended_at = datetime.now(timezone.utc)
                await db.flush()
            else:
                raise HTTPException(status_code=400, detail="Already in a live session")
        else:
            # No timestamp — stale state, reset it
            logger.warning(f"[go-live] Resetting is_shooting with no timestamp for {photographer_id}")
            photographer.is_shooting = False
            photographer.current_spot_id = None
            await db.flush()
    
    # Check mutual exclusivity: cannot go live if On-Demand is active
    if photographer.on_demand_available:
        # Auto-disable On-Demand instead of blocking — the frontend already tries
        # to do this but may fail if state is out of sync
        logger.warning(f"[go-live] Auto-disabling stale on_demand_available for {photographer_id}")
        photographer.on_demand_available = False
        photographer.on_demand_latitude = None
        photographer.on_demand_longitude = None
        await db.flush()
    
    # Find or verify spot and derive location
    spot_id = data.spot_id
    spot_name = data.location or data.spot_name or "Unknown Location"
    if spot_id:
        spot_result = await db.execute(select(SurfSpot).where(SurfSpot.id == spot_id))
        spot = spot_result.scalar_one_or_none()
        if spot:
            spot_name = spot.name
        else:
            spot_id = None
    
    # Use resolution pricing from request, or fall back to photographer's gallery pricing
    session_photo_price_web = data.photo_price_web or photographer.photo_price_web or 3.0
    session_photo_price_standard = data.photo_price_standard or photographer.photo_price_standard or 5.0
    session_photo_price_high = data.photo_price_high or photographer.photo_price_high or 10.0
    
    # Create LiveSession record at the START of session
    # This allows us to track earnings destination from the beginning
    try:
        live_session = LiveSession(
            photographer_id=photographer_id,
            surf_spot_id=spot_id,
            location_name=spot_name,
            buyin_price=data.price_per_join,
            photo_price=photographer.live_photo_price or 5.0,
            # Session-specific pricing (for Live Savings display)
            session_photo_price=data.live_photo_price or photographer.live_photo_price or 5.0,
            photos_included=data.photos_included or 3,
            general_photo_price=data.general_photo_price or photographer.photo_price_standard or 10.0,
            # Resolution-based pricing for this session
            session_price_web=session_photo_price_web,
            session_price_standard=session_photo_price_standard,
            session_price_high=session_photo_price_high,
            max_surfers=data.max_surfers or 10,
            estimated_duration_hours=data.estimated_duration or 2,
            participant_count=0,
            total_earnings=0.0,
            started_at=datetime.now(timezone.utc),
            status='active',
            # Store per-session earnings destination (for Hobbyists)
            earnings_destination_type=data.earnings_destination_type,
            earnings_destination_id=data.earnings_destination_id,
            earnings_cause_name=data.earnings_cause_name
        )
    except Exception as ls_err:
        # Fallback: create without resolution pricing columns (handles unmigrated DBs)
        logger.warning(f"LiveSession resolution pricing columns missing, using fallback: {ls_err}")
        live_session = LiveSession(
            photographer_id=photographer_id,
            surf_spot_id=spot_id,
            location_name=spot_name,
            buyin_price=data.price_per_join,
            photo_price=photographer.live_photo_price or 5.0,
            session_photo_price=data.live_photo_price or photographer.live_photo_price or 5.0,
            photos_included=data.photos_included or 3,
            general_photo_price=data.general_photo_price or photographer.photo_price_standard or 10.0,
            max_surfers=data.max_surfers or 10,
            estimated_duration_hours=data.estimated_duration or 2,
            participant_count=0,
            total_earnings=0.0,
            started_at=datetime.now(timezone.utc),
            status='active',
            earnings_destination_type=data.earnings_destination_type,
            earnings_destination_id=data.earnings_destination_id,
            earnings_cause_name=data.earnings_cause_name
        )
    db.add(live_session)
    await db.flush()
    
    # ============ MULTI-POST PIPELINE ============
    # When photographer goes live, automatically create:
    # 1. Map Pin (via live_session with spot_id)
    # 2. User Story (with BLUE ring) 
    # 3. Profile Feed post
    # 4. Condition Report (for Spot Hub & Conditions Explorer)
    
    # Set 24-hour expiration for stories and condition reports
    from datetime import timedelta
    expires_at = datetime.now(timezone.utc) + timedelta(hours=24)
    
    # Create a Story (BLUE ring for condition report)
    # Use a default live status image or photographer's avatar
    default_live_media = photographer.avatar_url or "https://raw-surf-os.preview.emergentagent.com/api/static/live-status-default.png"
    
    story = Story(
        author_id=photographer_id,
        spot_id=spot_id,
        media_url=default_live_media,  # Required field - use avatar or default
        media_type='image',
        caption=f"Now shooting at {spot_name}",
        story_type='photographer',
        is_live_report=True,
        latitude=data.latitude,
        longitude=data.longitude,
        location_name=spot_name,
        expires_at=expires_at
    )
    db.add(story)
    await db.flush()
    
    # NOTE: We no longer create a feed Post for "Going live" - photographers use Stories only
    # The Sessions tab will show their shooting sessions from ConditionReport + Gallery
    
    # Create Condition Report (appears in Spot Hub & Conditions Explorer)
    # Use condition media from request if provided, otherwise leave empty
    # Condition media - prefer pre-uploaded URL, fall back to base64
    condition_media_url = ""
    condition_media_type = "status"

    if data.condition_media_url:
        # ✅ Best path: media was pre-uploaded via /upload/conditions → just use the URL
        condition_media_url = data.condition_media_url
        condition_media_type = data.condition_media_type or "image"
        # Also update the story with the condition media
        story.media_url = condition_media_url
        story.media_type = condition_media_type
    elif data.condition_media:
        # Fallback: legacy base64 path (only used if condition_media_url not provided)
        try:
            import base64
            import uuid
            from services.media_upload import upload_to_supabase_storage

            media_bytes = base64.b64decode(data.condition_media)
            file_ext = "mp4" if data.condition_media_type == "video" else "jpg"
            filename = f"conditions/{photographer_id}/{uuid.uuid4()}.{file_ext}"

            condition_media_url = await upload_to_supabase_storage(
                media_bytes,
                filename,
                content_type=f"{'video' if data.condition_media_type == 'video' else 'image'}/{file_ext}"
            )
            condition_media_type = data.condition_media_type or "image"

            story.media_url = condition_media_url
            story.media_type = condition_media_type
        except Exception as e:
            logger.warning(f"Failed to upload condition media (base64 path): {e}")
    
    condition_report = ConditionReport(
        photographer_id=photographer_id,
        spot_id=spot_id,
        media_url=condition_media_url,
        media_type=condition_media_type,
        caption=f"Live at {spot_name}",
        spot_name=spot_name,
        region=spot.region if spot_id and spot else None,
        latitude=data.latitude,
        longitude=data.longitude,
        story_id=story.id,
        post_id=None,  # No longer creating feed posts for go-live
        live_session_id=live_session.id,
        expires_at=expires_at,
        is_active=True
    )
    db.add(condition_report)
    
    # Update photographer status
    # Note: is_shooting = professional work at spot, is_live = social broadcasting to followers
    # These are separate: photographer can be shooting without broadcasting
    photographer.is_shooting = True
    # Don't automatically enable is_live - that's for social broadcasting
    # photographer.is_live = True  <- Removed: social live should be separate action
    photographer.shooting_started_at = datetime.now(timezone.utc)
    photographer.current_spot_id = spot_id
    photographer.location = spot_name
    photographer.session_price = data.price_per_join
    
    await db.commit()
    await db.refresh(photographer)
    
    return {
        "message": "You are now live!",
        "photographer_id": photographer.id,
        "live_session_id": live_session.id,
        "location": photographer.location,
        "session_price": photographer.session_price,
        "started_at": photographer.shooting_started_at.isoformat(),
        # Live Session Rates for checkout/gallery (Resolution-based)
        "live_session_rates": {
            "buyin_price": live_session.buyin_price,
            "live_photo_price": live_session.session_photo_price,
            "photos_included": live_session.photos_included,
            "general_photo_price": live_session.general_photo_price,
            "savings_per_photo": (live_session.general_photo_price or 10.0) - (live_session.session_photo_price or 5.0),
            "max_surfers": live_session.max_surfers,
            # Resolution pricing for surfer checkout
            "resolution_pricing": {
                "web": session_photo_price_web,
                "standard": session_photo_price_standard,
                "high": session_photo_price_high
            }
        },
        "earnings_destination": {
            "type": data.earnings_destination_type,
            "id": data.earnings_destination_id,
            "cause_name": data.earnings_cause_name
        } if data.earnings_destination_type else None
    }


@router.post("/photographer/{photographer_id}/end-session")
async def end_live_session(
    photographer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """End the current live session, auto-create Gallery via sync service, and route earnings"""
    from utils.revenue_routing import process_creator_earnings
    from services.gallery_sync import create_session_gallery, check_gallery_exists_for_session
    
    photographer_result = await db.execute(
        select(Profile).where(Profile.id == photographer_id)
        .options(selectinload(Profile.current_spot))
    )
    photographer = photographer_result.scalar_one_or_none()
    
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    if not photographer.is_shooting:
        raise HTTPException(status_code=400, detail="No active session to end")
    
    # Find the active LiveSession created during go-live
    # Use .first() to handle multiple active sessions gracefully (take most recent)
    active_session_result = await db.execute(
        select(LiveSession)
        .where(LiveSession.photographer_id == photographer_id)
        .where(LiveSession.status == 'active')
        .order_by(LiveSession.started_at.desc())
    )
    live_session = active_session_result.scalars().first()
    
    # Mark all active participants as completed
    participants_result = await db.execute(
        select(LiveSessionParticipant)
        .where(LiveSessionParticipant.photographer_id == photographer_id)
        .where(LiveSessionParticipant.status == 'active')
    )
    participants = participants_result.scalars().all()
    
    total_earnings = 0
    participant_ids = []
    for p in participants:
        p.status = 'completed'
        p.completed_at = datetime.now(timezone.utc)
        total_earnings += p.amount_paid
        participant_ids.append(p.surfer_id)
    
    # Calculate session duration
    duration_mins = 0
    started_at = photographer.shooting_started_at
    if started_at:
        if started_at.tzinfo is None:
            started_at = started_at.replace(tzinfo=timezone.utc)
        duration = datetime.now(timezone.utc) - started_at
        duration_mins = int(duration.total_seconds() / 60)
    
    # Store session info before reset
    spot_id = photographer.current_spot_id
    spot_name = photographer.current_spot.name if photographer.current_spot else photographer.location
    session_date = photographer.shooting_started_at or datetime.now(timezone.utc)
    
    # If no active LiveSession found (legacy support), create one
    if not live_session:
        live_session = LiveSession(
            photographer_id=photographer_id,
            surf_spot_id=spot_id,
            location_name=spot_name or "Live Session",
            buyin_price=photographer.live_buyin_price or 25.0,
            photo_price=photographer.live_photo_price or 5.0,
            participant_count=len(participants),
            total_earnings=total_earnings,
            started_at=session_date,
            ended_at=datetime.now(timezone.utc),
            duration_mins=duration_mins,
            status='ended'
        )
        db.add(live_session)
    else:
        # Update existing session
        live_session.status = 'ended'
        live_session.ended_at = datetime.now(timezone.utc)
        live_session.duration_mins = duration_mins
        live_session.participant_count = len(participants)
        live_session.total_earnings = total_earnings
    
    await db.flush()
    
    # Auto-create Gallery using the unified sync service
    # Check if gallery already exists for this session (idempotency)
    gallery_exists = await check_gallery_exists_for_session(db, live_session_id=live_session.id)
    
    gallery_result = None
    if not gallery_exists:
        gallery_result = await create_session_gallery(
            db=db,
            photographer_id=photographer_id,
            session_type='live',
            spot_id=spot_id,
            spot_name=spot_name,
            live_session_id=live_session.id,
            session_start=session_date,
            participant_ids=participant_ids
        )
        
        # Notify all participants that their gallery is ready
        if gallery_result and gallery_result.get("gallery_id"):
            gallery_id = gallery_result.get("gallery_id")
            
            for surfer_id in participant_ids:
                import json
                notification_data = json.dumps({
                    'gallery_id': gallery_id,
                    'live_session_id': live_session.id,
                    'photographer_id': photographer_id,
                    'photographer_name': photographer.full_name,
                    'session_type': 'live',
                    'action_url': f'/gallery/{gallery_id}'
                })
                notification = Notification(
                    user_id=surfer_id,
                    type='gallery_ready',
                    title='Your Photos Are Ready!',
                    body=f'{photographer.full_name} has finished shooting. Check out your photos!',
                    data=notification_data
                )
                db.add(notification)
            
            # ═══ CONDITIONS REPORT → GALLERY THUMBNAIL ═══════════════════
            # Auto-set gallery cover image from conditions report media
            # This ensures condition photos/videos become the gallery thumbnail
            try:
                from models import ConditionReport, Gallery
                cr_result = await db.execute(
                    select(ConditionReport).where(
                        and_(
                            ConditionReport.live_session_id == live_session.id,
                            ConditionReport.media_url.isnot(None),
                            ConditionReport.media_url != ""
                        )
                    ).order_by(ConditionReport.created_at.desc())
                )
                conditions_report = cr_result.scalars().first()
                
                if conditions_report and conditions_report.media_url:
                    gallery_obj_result = await db.execute(
                        select(Gallery).where(Gallery.id == gallery_id)
                    )
                    gallery_obj = gallery_obj_result.scalar_one_or_none()
                    if gallery_obj and not gallery_obj.cover_image_url:
                        gallery_obj.cover_image_url = conditions_report.media_url
                        logger.info(f"[Gallery] Auto-set cover image from conditions report for gallery {gallery_id}")
            except Exception as e:
                logger.warning(f"[Gallery] Failed to set conditions thumbnail: {e}")
            # ═══ END CONDITIONS REPORT → GALLERY THUMBNAIL ═══════════════
    
    # Reset photographer status (only reset is_shooting, not is_live)
    # is_live is for social broadcasting and should be separate
    photographer.is_shooting = False
    # Don't touch is_live here - social broadcasting is independent
    photographer.current_spot_id = None
    photographer.shooting_started_at = None
    
    await db.commit()
    
    # ═══ SESSION RECAP EMAILS (async, non-blocking) ═══════════════════════
    # Send recap emails to all participants after session ends
    try:
        from services.email_service import send_session_recap_email
        
        # Get photo count for the gallery
        recap_photo_count = 0
        if gallery_result and gallery_result.get("gallery_id"):
            try:
                from models import GalleryItem
                photo_count_result = await db.execute(
                    select(func.count(GalleryItem.id)).where(
                        GalleryItem.gallery_id == gallery_result["gallery_id"]
                    )
                )
                recap_photo_count = photo_count_result.scalar() or 0
            except Exception:
                pass
        
        for surfer_id in participant_ids:
            try:
                surfer_result = await db.execute(
                    select(Profile).where(Profile.id == surfer_id)
                )
                surfer = surfer_result.scalar_one_or_none()
                if surfer and surfer.email:
                    await send_session_recap_email(
                        to_email=surfer.email,
                        photographer_name=photographer.full_name or "Photographer",
                        spot_name=spot_name or "Session",
                        duration_mins=duration_mins,
                        photo_count=recap_photo_count,
                        gallery_id=gallery_result.get("gallery_id") if gallery_result else None,
                        live_session_id=live_session.id
                    )
            except Exception as email_err:
                logger.warning(f"[SessionRecap] Failed to email {surfer_id}: {email_err}")
    except Exception as recap_err:
        logger.warning(f"[SessionRecap] Email service error: {recap_err}")
    # ═══ END SESSION RECAP EMAILS ═════════════════════════════════════════
    
    return {
        "message": "Session ended - Gallery created for your photos!",
        "total_surfers": len(participants),
        "total_earnings": total_earnings,
        "duration_mins": duration_mins,
        "gallery_id": gallery_result.get("gallery_id") if gallery_result else None,
        "gallery_title": gallery_result.get("title") if gallery_result else "Gallery already exists",
        "live_session_id": live_session.id,
        "selection_quotas_created": gallery_result.get("participants_added", 0) if gallery_result else 0
    }


@router.get("/photographer/{photographer_id}/session-history", response_model=List[SessionHistoryItem])
async def get_session_history(
    photographer_id: str,
    limit: int = Query(default=20, le=100),
    db: AsyncSession = Depends(get_db)
):
    """Get photographer's past live session history"""
    # Get completed sessions grouped by approximate time windows
    # For simplicity, we'll aggregate completed participants by date
    result = await db.execute(
        select(LiveSessionParticipant)
        .where(LiveSessionParticipant.photographer_id == photographer_id)
        .where(LiveSessionParticipant.status == 'completed')
        .options(selectinload(LiveSessionParticipant.spot))
        .order_by(LiveSessionParticipant.completed_at.desc())
        .limit(limit * 10)  # Get more to aggregate
    )
    participants = result.scalars().all()
    
    if not participants:
        return []
    
    # Group by date and spot to create "sessions"
    sessions_map = {}
    for p in participants:
        # Use date as key
        if p.completed_at:
            date_key = p.completed_at.date().isoformat()
            location = p.spot.name if p.spot else "Unknown location"
            key = f"{date_key}_{location}"
            
            if key not in sessions_map:
                sessions_map[key] = {
                    "id": p.id,
                    "location": location,
                    "started_at": p.joined_at,
                    "completed_at": p.completed_at,
                    "surfers": [],
                    "earnings": 0
                }
            
            sessions_map[key]["surfers"].append(p.surfer_id)
            sessions_map[key]["earnings"] += p.amount_paid
    
    # Convert to response
    history = []
    for session_data in list(sessions_map.values())[:limit]:
        duration_mins = 60  # Default duration
        if session_data["completed_at"] and session_data["started_at"]:
            duration = session_data["completed_at"] - session_data["started_at"]
            duration_mins = max(int(duration.total_seconds() / 60), 1)
        
        history.append(SessionHistoryItem(
            id=session_data["id"],
            location=session_data["location"],
            started_at=session_data["started_at"],
            duration_mins=duration_mins,
            total_surfers=len(session_data["surfers"]),
            total_earnings=session_data["earnings"]
        ))
    
    return history


# ============ LIVE PHOTOGRAPHERS (PUBLIC) ============

@router.get("/photographers/live")
async def get_live_photographers(
    latitude: Optional[float] = None,
    longitude: Optional[float] = None,
    radius: float = Query(default=5.0, description="Radius in miles"),
    db: AsyncSession = Depends(get_db)
):
    """Get all photographers currently shooting live"""
    query = select(Profile).where(
        and_(
            Profile.is_shooting.is_(True),
            Profile.role.in_([RoleEnum.GROM_PARENT, RoleEnum.HOBBYIST, RoleEnum.PHOTOGRAPHER, RoleEnum.APPROVED_PRO])
        )
    ).options(selectinload(Profile.current_spot))
    
    result = await db.execute(query)
    photographers = result.scalars().all()
    
    response = []
    for p in photographers:
        # Count active participants
        participants_result = await db.execute(
            select(func.count(LiveSessionParticipant.id))
            .where(LiveSessionParticipant.photographer_id == p.id)
            .where(LiveSessionParticipant.status == 'active')
        )
        active_count = participants_result.scalar() or 0
        
        photographer_data = {
            "id": p.id,
            "full_name": p.full_name,
            "avatar_url": p.avatar_url,
            "location": p.location or (p.current_spot.name if p.current_spot else None),
            "spot_name": p.current_spot.name if p.current_spot else None,
            "session_price": p.session_price or 25.0,
            "active_participants": active_count,
            "is_verified": p.is_verified,
            "distance": None  # Calculate if coordinates provided
        }
        
        # Calculate distance if coordinates provided
        if latitude and longitude and p.current_spot:
            # Simple distance calculation (not accounting for earth curvature)
            # For production, use proper haversine formula
            import math
            spot_lat = p.current_spot.latitude
            spot_lon = p.current_spot.longitude
            if spot_lat and spot_lon:
                lat_diff = abs(latitude - spot_lat) * 69  # Approximate miles per degree
                lon_diff = abs(longitude - spot_lon) * 69 * math.cos(math.radians(latitude))
                distance = math.sqrt(lat_diff**2 + lon_diff**2)
                photographer_data["distance"] = round(distance, 1)
                
                # Filter by radius
                if distance > radius:
                    continue
        
        response.append(photographer_data)
    
    return response



# NOTE: /photographers/directory endpoint is defined in bookings.py to avoid duplication


@router.get("/photographers/featured")
async def get_featured_photographers(
    limit: int = Query(default=10, le=50),
    db: AsyncSession = Depends(get_db)
):
    """
    Get featured photographers based on earnings and activity.
    Combines top earners with most active photographers.
    """
    from sqlalchemy import desc
    
    # Hobbyists are NOT featured — organic discovery only
    photographer_roles = [RoleEnum.PHOTOGRAPHER, RoleEnum.APPROVED_PRO]
    
    # Get photographers with their stats
    photographers_result = await db.execute(
        select(Profile)
        .where(Profile.role.in_(photographer_roles))
        .options(selectinload(Profile.current_spot))
    )
    photographers = photographers_result.scalars().all()
    
    featured = []
    for p in photographers:
        # Count total earnings from credit transactions
        earnings_result = await db.execute(
            select(func.sum(CreditTransaction.amount))
            .where(CreditTransaction.user_id == p.id)
            .where(CreditTransaction.transaction_type.in_([
                'live_session_earning', 'booking_earning', 'gallery_sale'
            ]))
        )
        total_earnings = earnings_result.scalar() or 0
        
        # Count total sessions
        sessions_result = await db.execute(
            select(func.count(LiveSessionParticipant.id))
            .where(LiveSessionParticipant.photographer_id == p.id)
            .where(LiveSessionParticipant.status == 'completed')
        )
        total_sessions = sessions_result.scalar() or 0
        
        # Count gallery items
        gallery_result = await db.execute(
            select(func.count(GalleryItem.id))
            .where(GalleryItem.photographer_id == p.id)
        )
        gallery_count = gallery_result.scalar() or 0
        
        # Calculate score (weighted by earnings, sessions, and gallery)
        score = (total_earnings * 2) + (total_sessions * 10) + (gallery_count * 5)
        
        # Extra boost if currently live
        if p.is_shooting:
            score += 100
        
        featured.append({
            "id": p.id,
            "full_name": p.full_name,
            "avatar_url": p.avatar_url,
            "role": p.role.value,
            "is_verified": p.is_verified,
            "is_live": p.is_shooting,
            "location": p.location or (p.current_spot.name if p.current_spot else None),
            "current_spot": p.current_spot.name if p.current_spot else None,
            "session_price": p.live_buyin_price or p.session_price or 25.0,
            "total_earnings": total_earnings,
            "total_sessions": total_sessions,
            "gallery_count": gallery_count,
            "score": score
        })
    
    # Sort by score descending
    featured.sort(key=lambda x: x["score"], reverse=True)
    
    return featured[:limit]


# ============ UNIFIED EARNINGS DASHBOARD ============

class EarningsBreakdownResponse(BaseModel):
    """Revenue breakdown by stream for earnings dashboard"""
    live_sessions: float = 0.0
    request_pro: float = 0.0
    regular_bookings: float = 0.0
    gallery_sales: float = 0.0
    total: float = 0.0
    # Split booking details
    split_bookings: List[dict] = []


@router.get("/photographer/{photographer_id}/earnings-breakdown", response_model=EarningsBreakdownResponse)
async def get_earnings_breakdown(
    photographer_id: str,
    days: int = Query(default=30, le=365),
    db: AsyncSession = Depends(get_db)
):
    """Get photographer's earnings breakdown by revenue stream for the Unified Earnings Dashboard"""
    from datetime import timedelta
    from sqlalchemy import text
    
    # Verify photographer
    result = await db.execute(select(Profile).where(Profile.id == photographer_id))
    photographer = result.scalar_one_or_none()
    
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    if not is_photographer_role(photographer.role):
        raise HTTPException(status_code=403, detail="User is not a photographer")
    
    # Calculate date range
    cutoff_date = datetime.now(timezone.utc) - timedelta(days=days)
    
    # Use raw SQL to fetch only base columns (works without new schema columns)
    # This ensures backward compatibility with existing databases
    raw_query = text("""
        SELECT id, user_id, amount, transaction_type, counterparty_id, created_at
        FROM credit_transactions 
        WHERE user_id = :photographer_id 
        AND amount > 0 
        AND created_at >= :cutoff_date
    """)
    
    transactions_result = await db.execute(
        raw_query,
        {"photographer_id": photographer_id, "cutoff_date": cutoff_date}
    )
    transactions = transactions_result.fetchall()
    
    # Initialize breakdown
    breakdown = {
        'live_sessions': 0.0,
        'request_pro': 0.0,
        'regular_bookings': 0.0,
        'gallery_sales': 0.0,
        'split_bookings': []
    }
    
    for tx in transactions:
        # Infer revenue stream from transaction_type (backward compatible)
        tx_type = tx.transaction_type
        if tx_type in ['live_session_buyin', 'live_session_earning', 'live_photo_purchase', 'photographer_earning']:
            breakdown['live_sessions'] += tx.amount
        elif tx_type in ['dispatch_earning', 'request_pro_earning']:
            breakdown['request_pro'] += tx.amount
        elif tx_type in ['booking_earning', 'booking_payment']:
            breakdown['regular_bookings'] += tx.amount
        elif tx_type in ['gallery_sale', 'gallery_purchase']:
            breakdown['gallery_sales'] += tx.amount
        else:
            # Default unclassified earnings to live_sessions
            breakdown['live_sessions'] += tx.amount
    
    return EarningsBreakdownResponse(
        live_sessions=breakdown['live_sessions'],
        request_pro=breakdown['request_pro'],
        regular_bookings=breakdown['regular_bookings'],
        gallery_sales=breakdown['gallery_sales'],
        total=breakdown['live_sessions'] + breakdown['request_pro'] + breakdown['regular_bookings'] + breakdown['gallery_sales'],
        split_bookings=breakdown['split_bookings']
    )


@router.get("/photographer/{photographer_id}/earnings-history")
async def get_earnings_history(
    photographer_id: str,
    months: int = Query(default=12, le=24),
    db: AsyncSession = Depends(get_db)
):
    """
    Get photographer's earnings history by month for trend analysis.
    Returns monthly totals for the last N months.
    """
    from datetime import timedelta
    from sqlalchemy import text, extract
    
    # Verify photographer
    result = await db.execute(select(Profile).where(Profile.id == photographer_id))
    photographer = result.scalar_one_or_none()
    
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    if not is_photographer_role(photographer.role):
        raise HTTPException(status_code=403, detail="User is not a photographer")
    
    # Calculate date range
    end_date = datetime.now(timezone.utc)
    start_date = end_date - timedelta(days=months * 31)  # Approximate
    
    # Fetch monthly aggregates
    raw_query = text("""
        SELECT 
            EXTRACT(YEAR FROM created_at) as year,
            EXTRACT(MONTH FROM created_at) as month,
            SUM(CASE WHEN transaction_type IN ('live_session_buyin', 'live_session_earning', 'live_photo_purchase', 'photographer_earning') THEN amount ELSE 0 END) as live_sessions,
            SUM(CASE WHEN transaction_type IN ('dispatch_earning', 'request_pro_earning') THEN amount ELSE 0 END) as request_pro,
            SUM(CASE WHEN transaction_type IN ('booking_earning', 'booking_payment') THEN amount ELSE 0 END) as regular_bookings,
            SUM(CASE WHEN transaction_type IN ('gallery_sale', 'gallery_purchase') THEN amount ELSE 0 END) as gallery_sales,
            SUM(amount) as total
        FROM credit_transactions 
        WHERE user_id = :photographer_id 
        AND amount > 0 
        AND created_at >= :start_date
        GROUP BY EXTRACT(YEAR FROM created_at), EXTRACT(MONTH FROM created_at)
        ORDER BY year DESC, month DESC
    """)
    
    result = await db.execute(
        raw_query,
        {"photographer_id": photographer_id, "start_date": start_date}
    )
    rows = result.fetchall()
    
    # Format response
    history = []
    for row in rows:
        history.append({
            "year": int(row.year),
            "month": int(row.month),
            "month_name": datetime(int(row.year), int(row.month), 1).strftime("%b %Y"),
            "live_sessions": float(row.live_sessions or 0),
            "request_pro": float(row.request_pro or 0),
            "regular_bookings": float(row.regular_bookings or 0),
            "gallery_sales": float(row.gallery_sales or 0),
            "total": float(row.total or 0)
        })
    
    # Calculate trends
    total_all_time = sum(h["total"] for h in history)
    avg_monthly = total_all_time / len(history) if history else 0
    
    # Current month vs previous month
    current_month_total = history[0]["total"] if history else 0
    prev_month_total = history[1]["total"] if len(history) > 1 else 0
    month_over_month_change = ((current_month_total - prev_month_total) / prev_month_total * 100) if prev_month_total > 0 else 0
    
    return {
        "history": history,
        "summary": {
            "total_earnings": total_all_time,
            "avg_monthly": avg_monthly,
            "current_month": current_month_total,
            "previous_month": prev_month_total,
            "month_over_month_change": round(month_over_month_change, 1),
            "best_month": max(history, key=lambda x: x["total"]) if history else None
        }
    }


# ============ ON-DEMAND & GAMIFICATION ENDPOINTS ============

class OnDemandToggleRequest(BaseModel):
    is_available: bool
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    spot_id: Optional[str] = None
    spot_name: Optional[str] = None


class OnDemandStatusResponse(BaseModel):
    is_available: bool
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    city: Optional[str] = None
    county: Optional[str] = None
    spot_id: Optional[str] = None
    spot_name: Optional[str] = None


class PhotographerStatsResponse(BaseModel):
    activeSessions: int = 0
    todayEarnings: float = 0
    pendingBookings: int = 0
    galleryPhotos: int = 0
    xp: int = 0
    streak: int = 0
    badges: List[str] = []
    hotStreakMultiplier: float = 1.0


@router.get("/photographers/on-demand")
async def get_on_demand_photographers(
    latitude: Optional[float] = None,
    longitude: Optional[float] = None,
    radius: float = 25.0,  # Default 25 mile radius
    db: AsyncSession = Depends(get_db)
):
    """
    Get all photographers available for on-demand requests.
    - Filters for on_demand_available = True
    - Sorts by role priority: Approved Pro > Pro > Photographer
    - Includes resolution-based pricing and photos included
    """
    import math
    
    # Query photographers who are available on-demand
    # Must be Photographer, Pro, or Approved Pro (NOT Hobbyist/Grom Parent)
    query = select(Profile).where(
        and_(
            Profile.on_demand_available.is_(True),
            Profile.role.in_([
                RoleEnum.PHOTOGRAPHER,
                RoleEnum.PRO,
                RoleEnum.APPROVED_PRO
            ])
        )
    )
    
    result = await db.execute(query)
    photographers = result.scalars().all()
    
    # Calculate distance and filter by radius if location provided
    available_pros = []
    for p in photographers:
        photographer_data = {
            "id": p.id,
            "full_name": p.full_name,
            "avatar_url": p.avatar_url,
            "role": p.role.value if p.role else "Photographer",
            "on_demand_hourly_rate": p.on_demand_hourly_rate or 75.0,
            "on_demand_photos_included": p.on_demand_photos_included or 3,
            "photo_price_web": p.photo_price_web or 3.0,
            "photo_price_standard": p.photo_price_standard or 5.0,
            "photo_price_high": p.photo_price_high or 10.0,
            "on_demand_latitude": p.on_demand_latitude,
            "on_demand_longitude": p.on_demand_longitude,
            "on_demand_city": p.on_demand_city,
            "on_demand_county": p.on_demand_county,
            "rating": getattr(p, 'rating', None) or 4.5,  # Default rating if not set
            "total_reviews": getattr(p, 'total_reviews', 0) or 0,
            "distance": None
        }
        
        # Calculate distance if both user and photographer have coordinates
        if latitude and longitude and p.on_demand_latitude and p.on_demand_longitude:
            # Haversine formula for distance in miles
            lat1, lon1 = math.radians(latitude), math.radians(longitude)
            lat2, lon2 = math.radians(p.on_demand_latitude), math.radians(p.on_demand_longitude)
            
            dlat = lat2 - lat1
            dlon = lon2 - lon1
            
            a = math.sin(dlat/2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon/2)**2
            c = 2 * math.asin(math.sqrt(a))
            distance_miles = 3956 * c  # Earth radius in miles
            
            photographer_data["distance"] = round(distance_miles, 1)
            
            # Filter by radius
            if distance_miles > radius:
                continue
        
        available_pros.append(photographer_data)
    
    # Sort by role priority: Approved Pro first, then Pro, then Photographer
    priority_order = {"Approved Pro": 0, "Pro": 1, "Photographer": 2}
    available_pros.sort(key=lambda x: (priority_order.get(x["role"], 99), x.get("distance") or 999))
    
    return available_pros


@router.get("/photographer/{photographer_id}/on-demand-status")
async def get_on_demand_status(
    photographer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get photographer's On-Demand availability status with selected spot"""
    result = await db.execute(
        select(Profile).where(Profile.id == photographer_id)
    )
    profile = result.scalar_one_or_none()
    
    if not profile:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    # Check if Photographer/Approved Pro (photographer roles that can use On-Demand)
    if profile.role not in [RoleEnum.PHOTOGRAPHER, RoleEnum.PRO, RoleEnum.APPROVED_PRO]:
        return OnDemandStatusResponse(is_available=False)
    
    # Get spot name if linked to a spot
    spot_name = profile.on_demand_city  # We store spot name here
    if profile.current_spot_id and not spot_name:
        spot_result = await db.execute(
            select(SurfSpot).where(SurfSpot.id == profile.current_spot_id)
        )
        spot = spot_result.scalar_one_or_none()
        if spot:
            spot_name = spot.name
    
    return OnDemandStatusResponse(
        is_available=profile.on_demand_available or False,
        latitude=profile.on_demand_latitude,
        longitude=profile.on_demand_longitude,
        city=spot_name,
        county=profile.on_demand_county,
        spot_id=profile.current_spot_id,
        spot_name=spot_name
    )


@router.get("/photographer/{photographer_id}/status")
async def get_photographer_status(
    photographer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get photographer's overall status including live session info"""
    result = await db.execute(
        select(Profile).where(Profile.id == photographer_id)
    )
    profile = result.scalar_one_or_none()
    
    if not profile:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    # Get current spot name if shooting
    current_spot_name = None
    if profile.current_spot_id:
        spot_result = await db.execute(
            select(SurfSpot).where(SurfSpot.id == profile.current_spot_id)
        )
        spot = spot_result.scalar_one_or_none()
        if spot:
            current_spot_name = spot.name
    
    # Fallback to on_demand_city (where we store spot name)
    if not current_spot_name and profile.on_demand_city:
        current_spot_name = profile.on_demand_city
    
    return {
        "is_shooting": profile.is_shooting or False,
        "on_demand_available": profile.on_demand_available or False,
        "current_spot_id": profile.current_spot_id,
        "current_spot_name": current_spot_name,
        "latitude": profile.on_demand_latitude,
        "longitude": profile.on_demand_longitude
    }


@router.post("/photographer/{photographer_id}/on-demand-toggle")
async def toggle_on_demand(
    photographer_id: str,
    data: OnDemandToggleRequest,
    db: AsyncSession = Depends(get_db)
):
    """Toggle On-Demand availability for Pro photographers with spot selection"""
    result = await db.execute(
        select(Profile).where(Profile.id == photographer_id)
    )
    profile = result.scalar_one_or_none()
    
    if not profile:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    # Check if Photographer/Approved Pro (photographer roles that can use On-Demand)
    if profile.role not in [RoleEnum.PHOTOGRAPHER, RoleEnum.PRO, RoleEnum.APPROVED_PRO]:
        raise HTTPException(status_code=403, detail="On-Demand is only available for Pro photographers")
    
    # Check mutual exclusivity: cannot enable On-Demand if currently live shooting
    if data.is_available and profile.is_shooting:
        raise HTTPException(
            status_code=400, 
            detail="Cannot enable On-Demand while in an active live session. Please end your session first."
        )
    
    # Update availability
    profile.on_demand_available = data.is_available
    
    if data.is_available:
        # Store spot info when activating
        if data.spot_id:
            profile.current_spot_id = data.spot_id
        if data.latitude and data.longitude:
            profile.on_demand_latitude = data.latitude
            profile.on_demand_longitude = data.longitude
        # Store spot name in city field (or create a new field)
        if data.spot_name:
            profile.on_demand_city = data.spot_name
        profile.on_demand_updated_at = datetime.now(timezone.utc)
    else:
        # Clear location data when disabling
        profile.on_demand_latitude = None
        profile.on_demand_longitude = None
        profile.on_demand_city = None
        profile.on_demand_county = None
        profile.current_spot_id = None
    
    await db.commit()
    
    return {
        "success": True,
        "is_available": profile.on_demand_available,
        "spot_name": profile.on_demand_city if data.is_available else None,
        "message": f"On-Demand enabled at {data.spot_name}" if data.is_available else "On-Demand disabled"
    }


@router.get("/photographer/{photographer_id}/stats", response_model=PhotographerStatsResponse)
async def get_photographer_stats(
    photographer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get photographer's dashboard stats including gamification data"""
    result = await db.execute(
        select(Profile).where(Profile.id == photographer_id)
    )
    profile = result.scalar_one_or_none()
    
    if not profile:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    # Count active sessions
    active_sessions_result = await db.execute(
        select(func.count(LiveSession.id)).where(
            and_(
                LiveSession.photographer_id == photographer_id,
                LiveSession.status == 'active'
            )
        )
    )
    active_sessions = active_sessions_result.scalar() or 0
    
    # Today's earnings - use counterparty_id (photographer receives credits from counterparty)
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    earnings_result = await db.execute(
        select(func.sum(CreditTransaction.amount)).where(
            and_(
                CreditTransaction.user_id == photographer_id,
                CreditTransaction.created_at >= today_start,
                CreditTransaction.amount > 0,
                CreditTransaction.transaction_type.in_(['photographer_earning', 'gallery_sale', 'live_session_buyin'])
            )
        )
    )
    today_earnings = earnings_result.scalar() or 0
    
    # Pending bookings
    pending_bookings_result = await db.execute(
        select(func.count(Booking.id)).where(
            and_(
                Booking.photographer_id == photographer_id,
                Booking.status == 'pending'
            )
        )
    )
    pending_bookings = pending_bookings_result.scalar() or 0
    
    # Gallery photos count
    gallery_photos_result = await db.execute(
        select(func.count(GalleryItem.id)).where(
            GalleryItem.photographer_id == photographer_id
        )
    )
    gallery_photos = gallery_photos_result.scalar() or 0
    
    # Gamification stats (stored on profile or computed)
    xp = profile.xp_total or 0
    streak = profile.on_demand_streak or 0
    
    # Parse badges from JSON field or default
    badges = []
    if profile.badges:
        try:
            badges = json.loads(profile.badges) if isinstance(profile.badges, str) else profile.badges
        except (ValueError, TypeError):
            badges = []
    
    # Hot streak multiplier (3+ requests in a day = 2x)
    hot_streak_multiplier = 2.0 if streak >= 3 else 1.0
    
    return PhotographerStatsResponse(
        activeSessions=active_sessions,
        todayEarnings=float(today_earnings),
        pendingBookings=pending_bookings,
        galleryPhotos=gallery_photos,
        xp=xp,
        streak=streak,
        badges=badges,
        hotStreakMultiplier=hot_streak_multiplier
    )


@router.post("/photographer/{photographer_id}/award-xp")
async def award_xp(
    photographer_id: str,
    xp_amount: int = 10,
    reason: str = "activity",
    db: AsyncSession = Depends(get_db)
):
    """Award XP to photographer (called internally after successful actions)"""
    result = await db.execute(
        select(Profile).where(Profile.id == photographer_id)
    )
    profile = result.scalar_one_or_none()
    
    if not profile:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    # Apply hot streak multiplier
    multiplier = 2.0 if (profile.on_demand_streak or 0) >= 3 else 1.0
    final_xp = int(xp_amount * multiplier)
    
    # Update XP
    profile.xp_total = (profile.xp_total or 0) + final_xp
    
    await db.commit()
    
    return {
        "success": True,
        "xp_awarded": final_xp,
        "multiplier": multiplier,
        "new_total": profile.xp_total,
        "reason": reason
    }


# ============ ON-DEMAND SETTINGS ENDPOINTS ============

class OnDemandSettingsRequest(BaseModel):
    base_rate: float = 75.0
    peak_pricing_enabled: bool = False
    peak_multiplier: float = 1.5
    claimed_spots: List[str] = []
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    on_demand_photos_included: Optional[int] = None
    on_demand_full_gallery: Optional[bool] = None
    # Independent resolution pricing for On-Demand sessions
    on_demand_price_web: Optional[float] = None
    on_demand_price_standard: Optional[float] = None
    on_demand_price_high: Optional[float] = None
    on_demand_video_720p: Optional[float] = None
    on_demand_video_1080p: Optional[float] = None
    on_demand_video_4k: Optional[float] = None


class OnDemandSettingsResponse(BaseModel):
    base_rate: float
    peak_pricing_enabled: bool
    peak_multiplier: float
    claimed_spots: List[str]
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    on_demand_photos_included: int = 3
    on_demand_full_gallery: bool = False
    on_demand_price_web: float = 5.0
    on_demand_price_standard: float = 10.0
    on_demand_price_high: float = 18.0
    on_demand_video_720p: float = 12.0
    on_demand_video_1080p: float = 20.0
    on_demand_video_4k: float = 40.0


@router.get("/photographer/{photographer_id}/on-demand-settings")
async def get_on_demand_settings(
    photographer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get photographer's On-Demand settings"""
    result = await db.execute(
        select(Profile).where(Profile.id == photographer_id)
    )
    profile = result.scalar_one_or_none()
    
    if not profile:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    # Parse claimed spots from JSON field
    claimed_spots = []
    if profile.on_demand_claimed_spots:
        try:
            claimed_spots = json.loads(profile.on_demand_claimed_spots) if isinstance(profile.on_demand_claimed_spots, str) else profile.on_demand_claimed_spots
        except (ValueError, TypeError):
            claimed_spots = []
    
    return {
        "base_rate": profile.on_demand_hourly_rate or 75.0,
        "peak_pricing_enabled": profile.on_demand_peak_enabled or False,
        "peak_multiplier": profile.on_demand_peak_multiplier or 1.5,
        "claimed_spots": claimed_spots,
        "latitude": profile.on_demand_latitude,
        "longitude": profile.on_demand_longitude,
        "on_demand_photos_included": profile.on_demand_photos_included or 3,
        "on_demand_full_gallery": profile.on_demand_full_gallery or False,
        # Independent resolution pricing
        "on_demand_price_web": profile.on_demand_price_web or 5.0,
        "on_demand_price_standard": profile.on_demand_price_standard or 10.0,
        "on_demand_price_high": profile.on_demand_price_high or 18.0,
        "on_demand_video_720p": profile.on_demand_video_720p or 12.0,
        "on_demand_video_1080p": profile.on_demand_video_1080p or 20.0,
        "on_demand_video_4k": profile.on_demand_video_4k or 40.0,
    }


@router.post("/photographer/{photographer_id}/on-demand-settings")
async def save_on_demand_settings(
    photographer_id: str,
    data: OnDemandSettingsRequest,
    db: AsyncSession = Depends(get_db)
):
    """Save photographer's On-Demand settings"""
    result = await db.execute(
        select(Profile).where(Profile.id == photographer_id)
    )
    profile = result.scalar_one_or_none()
    
    if not profile:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    # Check if Photographer/Pro/Approved Pro (NOT Hobbyist/Grom Parent)
    if profile.role not in [RoleEnum.PHOTOGRAPHER, RoleEnum.PRO, RoleEnum.APPROVED_PRO]:
        raise HTTPException(status_code=403, detail="On-Demand settings are only available for photographers")
    
    # Update settings
    profile.on_demand_hourly_rate = data.base_rate
    profile.on_demand_peak_enabled = data.peak_pricing_enabled
    profile.on_demand_peak_multiplier = data.peak_multiplier
    profile.on_demand_claimed_spots = json.dumps(data.claimed_spots)

    if data.on_demand_photos_included is not None:
        profile.on_demand_photos_included = max(0, data.on_demand_photos_included)
    if data.on_demand_full_gallery is not None:
        profile.on_demand_full_gallery = data.on_demand_full_gallery

    # Independent resolution pricing for on-demand sessions
    if data.on_demand_price_web is not None:
        profile.on_demand_price_web = max(0, data.on_demand_price_web)
    if data.on_demand_price_standard is not None:
        profile.on_demand_price_standard = max(0, data.on_demand_price_standard)
    if data.on_demand_price_high is not None:
        profile.on_demand_price_high = max(0, data.on_demand_price_high)
    if data.on_demand_video_720p is not None:
        profile.on_demand_video_720p = max(0, data.on_demand_video_720p)
    if data.on_demand_video_1080p is not None:
        profile.on_demand_video_1080p = max(0, data.on_demand_video_1080p)
    if data.on_demand_video_4k is not None:
        profile.on_demand_video_4k = max(0, data.on_demand_video_4k)

    if data.latitude and data.longitude:
        profile.on_demand_latitude = data.latitude
        profile.on_demand_longitude = data.longitude
    
    await db.commit()
    
    return {
        "success": True,
        "message": "On-Demand settings saved successfully"
    }


# ============ WATERMARK SETTINGS ============


class WatermarkSettingsRequest(BaseModel):
    watermark_style: str = 'text'  # 'text', 'logo', 'both'
    watermark_text: Optional[str] = None
    watermark_logo_url: Optional[str] = None
    watermark_opacity: float = 0.5
    watermark_position: str = 'bottom-right'  # 'center', 'bottom-right', 'bottom-left', 'top-right', 'top-left', 'tiled'
    default_watermark_in_selection: Optional[bool] = None  # Show watermarks during surfer selection phase


@router.put("/photographer/{photographer_id}/watermark-settings")
async def update_watermark_settings(
    photographer_id: str,
    data: WatermarkSettingsRequest,
    db: AsyncSession = Depends(get_db)
):
    """Update photographer's watermark customization settings"""
    result = await db.execute(
        select(Profile).where(Profile.id == photographer_id)
    )
    profile = result.scalar_one_or_none()
    
    if not profile:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    if profile.role not in [RoleEnum.PHOTOGRAPHER, RoleEnum.PRO, RoleEnum.APPROVED_PRO]:
        raise HTTPException(status_code=403, detail="Only photographers can set watermark settings")
    
    # Validate watermark style
    if data.watermark_style not in ['text', 'logo', 'both']:
        raise HTTPException(status_code=400, detail="Invalid watermark style")
    
    # Validate position
    valid_positions = ['center', 'bottom-right', 'bottom-left', 'top-right', 'top-left', 'tiled']
    if data.watermark_position not in valid_positions:
        raise HTTPException(status_code=400, detail="Invalid watermark position")
    
    # Validate opacity
    if not 0.1 <= data.watermark_opacity <= 1.0:
        raise HTTPException(status_code=400, detail="Opacity must be between 0.1 and 1.0")
    
    # Update settings
    profile.watermark_style = data.watermark_style
    profile.watermark_text = data.watermark_text or profile.full_name
    profile.watermark_logo_url = data.watermark_logo_url
    profile.watermark_opacity = data.watermark_opacity
    profile.watermark_position = data.watermark_position
    
    # Update selection phase watermark preference
    if data.default_watermark_in_selection is not None:
        profile.default_watermark_in_selection = data.default_watermark_in_selection
    
    await db.commit()
    
    return {
        "success": True,
        "message": "Watermark settings saved successfully",
        "settings": {
            "watermark_style": profile.watermark_style,
            "watermark_text": profile.watermark_text,
            "watermark_logo_url": profile.watermark_logo_url,
            "watermark_opacity": profile.watermark_opacity,
            "watermark_position": profile.watermark_position,
            "default_watermark_in_selection": profile.default_watermark_in_selection
        }
    }


@router.get("/photographer/{photographer_id}/watermark-settings")
async def get_watermark_settings(
    photographer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get photographer's watermark customization settings"""
    result = await db.execute(
        select(Profile).where(Profile.id == photographer_id)
    )
    profile = result.scalar_one_or_none()
    
    if not profile:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    return {
        "watermark_style": profile.watermark_style or 'text',
        "watermark_text": profile.watermark_text or profile.full_name or 'Watermark',
        "watermark_logo_url": profile.watermark_logo_url,
        "watermark_opacity": profile.watermark_opacity or 0.5,
        "watermark_position": profile.watermark_position or 'bottom-right',
        "default_watermark_in_selection": profile.default_watermark_in_selection if profile.default_watermark_in_selection is not None else True
    }
