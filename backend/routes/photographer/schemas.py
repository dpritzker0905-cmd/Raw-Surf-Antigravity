"""
Photographer package — Pydantic schemas and shared helpers.
"""
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime
import secrets
import string

from models import RoleEnum
from datetime import date


# ============ SHARED HELPERS ============

def generate_invite_code(length: int = 6) -> str:
    """Generate a unique invite code"""
    chars = string.ascii_uppercase + string.digits
    return ''.join(secrets.choice(chars) for _ in range(length))


def is_photographer_role(role: RoleEnum) -> bool:
    """Check if the role is a photographer-type role"""
    return role in [RoleEnum.GROM_PARENT, RoleEnum.HOBBYIST, RoleEnum.PHOTOGRAPHER, RoleEnum.APPROVED_PRO]


# ============ BOOKING SCHEMAS ============

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


# ============ LIVE SESSION SCHEMAS ============

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


class UpdateParticipantNotesRequest(BaseModel):
    notes: Optional[str] = None


class SessionHistoryParticipant(BaseModel):
    id: str
    full_name: Optional[str] = None
    avatar_url: Optional[str] = None
    amount_paid: float = 0.0


class SessionHistoryItem(BaseModel):
    id: str
    location: str
    started_at: datetime
    duration_mins: int
    total_surfers: int
    total_earnings: float
    # Enhanced fields for detail drawer
    session_type: Optional[str] = 'live'
    live_session_id: Optional[str] = None
    gallery_id: Optional[str] = None
    gallery_photo_count: int = 0
    # Pricing snapshot
    buyin_price: Optional[float] = None
    photo_price_web: Optional[float] = None
    photo_price_standard: Optional[float] = None
    photo_price_high: Optional[float] = None
    # Participant roster
    participants: List[SessionHistoryParticipant] = []
    # Review info
    has_pending_reviews: bool = False
    reviews_given: int = 0


# ============ PRICING SCHEMAS ============

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


# ============ EARNINGS SCHEMAS ============

class EarningsBreakdownResponse(BaseModel):
    """Revenue breakdown by stream for earnings dashboard"""
    live_sessions: float = 0.0
    request_pro: float = 0.0
    regular_bookings: float = 0.0
    gallery_sales: float = 0.0
    total: float = 0.0
    # Split booking details
    split_bookings: List[dict] = []


# ============ AVAILABILITY SCHEMAS ============

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


# ============ ON-DEMAND SCHEMAS ============

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
    # Cancellation fee percentage (0-100)
    on_demand_cancellation_fee_pct: Optional[int] = None


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
    on_demand_cancellation_fee_pct: int = 100


# ============ GAMIFICATION SCHEMAS ============

class PhotographerStatsResponse(BaseModel):
    activeSessions: int = 0
    todayEarnings: float = 0
    pendingBookings: int = 0
    galleryPhotos: int = 0
    xp: int = 0
    streak: int = 0
    badges: List[str] = []
    hotStreakMultiplier: float = 1.0


# ============ WATERMARK SCHEMAS ============

class WatermarkSettingsRequest(BaseModel):
    watermark_style: str = 'text'  # 'text', 'logo', 'both'
    watermark_text: Optional[str] = None
    watermark_logo_url: Optional[str] = None
    watermark_opacity: float = 0.5
    watermark_position: str = 'bottom-right'  # 'center', 'bottom-right', 'bottom-left', 'top-right', 'top-left', 'tiled'
    default_watermark_in_selection: Optional[bool] = None  # Show watermarks during surfer selection phase
