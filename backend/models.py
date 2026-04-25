from sqlalchemy import Column, String, Integer, Float, Boolean, ForeignKey, DateTime, Date, Enum, Text, Index, JSON
from sqlalchemy.orm import relationship, backref
from database import Base
from datetime import datetime, timezone
import enum
import uuid

def generate_uuid():
    return str(uuid.uuid4())

class RoleEnum(enum.Enum):
    GROM = "Grom"
    SURFER = "Surfer"
    COMP_SURFER = "Comp Surfer"
    PRO = "Pro"
    GROM_PARENT = "Grom Parent"
    HOBBYIST = "Hobbyist"
    PHOTOGRAPHER = "Photographer"
    APPROVED_PRO = "Approved Pro"
    SCHOOL = "School"
    COACH = "Coach"
    RESORT = "Resort"
    WAVE_POOL = "Wave Pool"
    SHOP = "Shop"
    SHAPER = "Shaper"
    DESTINATION = "Destination"
    ADMIN = "Admin"

class SubscriptionTierEnum(enum.Enum):
    FREE = "free"
    BASIC = "basic"
    PREMIUM = "premium"


class EliteTierEnum(enum.Enum):
    """Career tier for competitive surfers"""
    PRO_ELITE = "pro_elite"      # ⭐+ Top-tier (world-ranked, major sponsors)
    COMPETITIVE = "competitive"  # 🏄 Rising talent, regional competitors
    GROM_RISING = "grom_rising"  # 🍼 Promising young talent


class VerificationStatusEnum(enum.Enum):
    """Verification status for competition results"""
    PENDING = "pending"
    COMMUNITY_VERIFIED = "community_verified"  # Admin/AI approved manual entry
    API_SYNCED = "api_synced"                  # Auto-synced from LiveHeats/WSL
    REJECTED = "rejected"

class Profile(Base):
    __tablename__ = 'profiles'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), unique=True, nullable=False, index=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=True)  # Hashed password
    full_name = Column(String(255))
    
    # ============ USERNAME (@mention) ============
    username = Column(String(30), unique=True, nullable=True, index=True)  # @username for mentions
    username_changed_at = Column(DateTime(timezone=True), nullable=True)  # Last username change timestamp
    
    role = Column(Enum(RoleEnum), nullable=False, index=True)
    subscription_tier = Column(String(50), nullable=True)
    
    # ============ AD SUPPORT (Free tiers have ads) ============
    # True = user sees ads (free tier), False = ad-free experience (paid tier)
    is_ad_supported = Column(Boolean, default=True)
    
    # ============ CAREER TIER (For Competitive Surfers) ============
    elite_tier = Column(String(50), nullable=True)  # pro_elite, competitive, grom_rising (stored as string)
    world_ranking = Column(Integer, nullable=True)  # Current world/regional ranking
    career_points = Column(Integer, default=0)  # Accumulated career points
    
    # ============ REVENUE ROUTING - CREATOR TIERS ============
    # Legacy field - now split into withdrawable and gear credits
    credit_balance = Column(Float, default=0.0, nullable=False)
    
    # PRO CREDITS: Can be withdrawn to bank/Stripe (Photographers & Approved Pros)
    withdrawable_credits = Column(Float, default=0.0, nullable=False)
    
    # HOBBYIST CREDITS: Can only be used for gear purchases (Grom Parents & Hobbyists)
    gear_only_credits = Column(Float, default=0.0, nullable=False)
    
    # Donation/Impact Settings
    donation_destination_type = Column(String(30), nullable=True)  # 'grom', 'cause', 'surfer', 'gear', 'split'
    donation_destination_id = Column(String(36), nullable=True)  # Profile ID of recipient (if grom/surfer)
    donation_cause_name = Column(String(255), nullable=True)  # Name if it's a cause
    target_gear_item_id = Column(String(36), ForeignKey('gear_catalog.id', ondelete='SET NULL'), nullable=True)  # Gear item Hobbyist is saving for
    
    # Impact Score - tracks total credits given to Groms/Causes
    total_credits_given = Column(Float, default=0.0, nullable=False)
    total_groms_supported = Column(Integer, default=0)
    total_causes_supported = Column(Integer, default=0)
    
    # For Pros: split percentage (e.g., 50% to cause, 50% to gear)
    donation_split_percentage = Column(Integer, default=50)  # Percentage to cause/grom
    
    # Stripe Connect for Pros (for withdrawals)
    stripe_connect_id = Column(String(255), nullable=True)
    stripe_connected = Column(Boolean, default=False)
    
    parent_id = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True)
    
    # ============ GROM SAFETY GATE FIELDS ============
    # Birthdate for age calculation (required for Grom accounts)
    birthdate = Column(Date, nullable=True)
    # Guardian code for parent-grom linking (6-digit code)
    guardian_code = Column(String(10), nullable=True, unique=True)
    # Whether parent link is confirmed/approved
    parent_link_approved = Column(Boolean, default=False)
    # Parent age verification completed
    parent_age_verified = Column(Boolean, default=False)
    # Whether this user has Grom Parent privileges (AND-able with any surfer role)
    # True for: dedicated Grom Parent accounts AND surfers who opt in via Settings
    is_grom_parent = Column(Boolean, default=False, nullable=False)
    
    # ============ PARENTAL CONTROL SETTINGS (JSON) ============
    # Stored as JSON: {"can_post": true, "can_stream": false, "can_message": true, "can_comment": true, "view_only": false}
    parental_controls = Column(JSON, nullable=True)
    
    bio = Column(Text, nullable=True)
    avatar_url = Column(Text, nullable=True)  # Text to support base64 data URLs (~110KB)
    is_logo_avatar = Column(Boolean, default=False)  # True = display as logo (object-contain), False = headshot (object-cover)
    is_verified = Column(Boolean, default=False)
    is_live = Column(Boolean, default=False)
    is_private = Column(Boolean, default=False)
    accepting_lineup_invites = Column(Boolean, default=True)  # Accept invites from nearby public users
    is_approved_pro = Column(Boolean, default=False)
    
    # ============ PINNED POST (Instagram-style) ============
    pinned_post_id = Column(String(36), ForeignKey('posts.id', ondelete='SET NULL'), nullable=True)
    
    location = Column(String(255), nullable=True)
    company_name = Column(String(255), nullable=True)
    portfolio_url = Column(String(500), nullable=True)
    instagram_url = Column(String(500), nullable=True)
    website_url = Column(String(500), nullable=True)
    hourly_rate = Column(Float, nullable=True)
    session_price = Column(Float, default=25.0)  # Default buy-in price for live sessions
    
    # SmugMug-style pricing for live sessions
    live_buyin_price = Column(Float, default=25.0)  # Price to join a live session
    live_photo_price = Column(Float, default=5.0)   # Price per photo after buy-in
    photo_package_size = Column(Integer, default=0)  # Photos included in buy-in (0 = none)
    
    # Booking pricing
    booking_hourly_rate = Column(Float, default=50.0)  # Hourly rate for scheduled sessions
    booking_min_hours = Column(Float, default=1.0)     # Minimum booking duration
    
    # SmugMug-style gallery pricing tiers
    # Photo pricing by quality
    photo_price_web = Column(Float, default=3.0)      # Web quality (800px)
    photo_price_standard = Column(Float, default=5.0)  # Standard quality (1920px)
    photo_price_high = Column(Float, default=10.0)    # High res (4K / original)
    
    # Video pricing by quality
    video_price_720p = Column(Float, default=8.0)     # 720p
    video_price_1080p = Column(Float, default=15.0)   # 1080p Full HD
    video_price_4k = Column(Float, default=30.0)      # 4K Ultra HD
    
    # ============ MULTI-TIERED GALLERY PRICING ============
    # Session-specific pricing (separate from general gallery pricing)
    # On-Demand Photo Price: Per-photo rate for on-demand requests (legacy single-tier)
    on_demand_photo_price = Column(Float, default=10.0)
    # On-Demand Photos Included: Free photos surfers get with on-demand buy-in
    on_demand_photos_included = Column(Integer, default=3)
    on_demand_videos_included = Column(Integer, default=1)
    # On-Demand Full Gallery: All photos included (unlimited) with buy-in
    on_demand_full_gallery = Column(Boolean, default=False)
    # Live Session Photo Price: Per-photo rate for active live sessions (legacy single-tier)
    live_session_photo_price = Column(Float, default=5.0)
    # Photos included in session buy-in (surfers get these free)
    live_session_photos_included = Column(Integer, default=3)
    live_session_videos_included = Column(Integer, default=1)
    # Live Session Full Gallery: All photos included (unlimited) with buy-in
    live_session_full_gallery = Column(Boolean, default=False)

    # ============ ON-DEMAND INDEPENDENT RESOLUTION PRICING ============
    # Fully independent from Gallery and Booking pricing
    on_demand_price_web = Column(Float, default=5.0)       # Web quality (800px) - on-demand rate
    on_demand_price_standard = Column(Float, default=10.0) # Standard (1920px) - on-demand rate
    on_demand_price_high = Column(Float, default=18.0)     # High-res (original) - on-demand rate
    on_demand_video_720p = Column(Float, default=12.0)     # 720p video clip - on-demand rate
    on_demand_video_1080p = Column(Float, default=20.0)    # 1080p Full HD - on-demand rate
    on_demand_video_4k = Column(Float, default=40.0)       # 4K Ultra HD - on-demand rate

    # ============ LIVE SESSION INDEPENDENT RESOLUTION PRICING ============
    # Fully independent from Gallery and On-Demand pricing
    live_price_web = Column(Float, default=3.0)            # Web quality (800px) - live session rate
    live_price_standard = Column(Float, default=6.0)       # Standard (1920px) - live session rate
    live_price_high = Column(Float, default=12.0)          # High-res (original) - live session rate
    live_video_720p = Column(Float, default=8.0)           # 720p video clip - live session rate
    live_video_1080p = Column(Float, default=15.0)         # 1080p Full HD - live session rate
    live_video_4k = Column(Float, default=30.0)            # 4K Ultra HD - live session rate

    # ============ GENERAL BOOKING TIERED PRICING ============
    # Standard scheduled bookings now support resolution tiers like Live/On-Demand
    booking_price_web = Column(Float, default=3.0)       # Web quality price
    booking_price_standard = Column(Float, default=5.0)  # Standard quality price
    booking_price_high = Column(Float, default=10.0)     # High-res quality price
    booking_photos_included = Column(Integer, default=3) # Photos included in booking
    booking_videos_included = Column(Integer, default=1)  # Videos included in booking
    booking_full_gallery = Column(Boolean, default=False) # Full gallery access toggle
    price_per_additional_surfer = Column(Float, default=15.0)  # Crew split: added per extra surfer
    # Booking video tiers (independent from Gallery video pricing)
    booking_video_720p = Column(Float, default=8.0)        # 720p video clip - booking rate
    booking_video_1080p = Column(Float, default=15.0)      # 1080p Full HD - booking rate
    booking_video_4k = Column(Float, default=30.0)         # 4K Ultra HD - booking rate
    
    # ============ GROUP BOOKING DISCOUNTS ============
    # Photographers can set percentage discounts for group bookings
    group_discount_2_plus = Column(Float, default=0.0)   # Discount % for 2+ surfers (e.g., 10 = 10% off)
    group_discount_3_plus = Column(Float, default=0.0)   # Discount % for 3+ surfers
    group_discount_5_plus = Column(Float, default=0.0)   # Discount % for 5+ surfers
    
    # ============ CANCELLATION POLICY SETTINGS ============
    # Photographers can customize their cancellation policy
    cancellation_policy_type = Column(String(30), default='standard')  # 'standard', 'flexible', 'strict'
    # Standard: >48h=90%, 24-48h=50%, <24h=0%
    # Flexible: >24h=100%, 12-24h=50%, <12h=0%
    # Strict: >72h=50%, <72h=0%
    
    # On-Demand Cancellation Fee (photographer-controlled)
    # Percentage of the deposit kept as a cancellation fee when surfer cancels after acceptance.
    # 0 = fully refundable, 100 = non-refundable (legacy default). Typical range: 25-100.
    on_demand_cancellation_fee_pct = Column(Integer, default=100)  # 0-100 percentage
    
    accepts_donations = Column(Boolean, default=False)
    skill_level = Column(String(50), nullable=True)
    stance = Column(String(20), nullable=True)  # 'regular' or 'goofy'
    home_break = Column(String(255), nullable=True)
    surf_mode = Column(String(20), default='casual', nullable=True)  # 'casual', 'competitive', 'pro' (user-selectable). elite_tier='legend' is admin-assigned via verification.
    
    # ============ SURFER IDENTIFICATION (For photographers) ============
    wetsuit_color = Column(String(50), nullable=True)  # e.g., "Black", "Blue/Black", "Full black with red stripe"
    rash_guard_color = Column(String(50), nullable=True)  # e.g., "White", "Red", "Blue with logo"
    
    # Live shooting fields for photographers
    is_shooting = Column(Boolean, default=False)  # Currently working at a spot
    is_streaming = Column(Boolean, default=False)  # Currently streaming live video
    current_spot_id = Column(String(36), ForeignKey('surf_spots.id', ondelete='SET NULL'), nullable=True)
    shooting_started_at = Column(DateTime(timezone=True), nullable=True)
    last_story_url = Column(String(500), nullable=True)  # First 30 sec of last stream
    
    # On-Demand (Reverse Request) Settings - Only Pro and Approved Pro can enable
    is_available_on_demand = Column(Boolean, default=False)  # Can receive on-demand pings
    on_demand_hourly_rate = Column(Float, default=75.0)  # Rate for on-demand sessions
    on_demand_radius_miles = Column(Float, default=10.0)  # Max distance willing to travel
    booking_deposit_pct = Column(Integer, default=25)  # Deposit percentage (0-100)
    
    # ============ WATERMARK SETTINGS (For Photographers) ============
    # Photographers can customize their watermark for Standard tier previews
    watermark_logo_url = Column(String(500), nullable=True)  # Custom logo URL
    watermark_text = Column(String(100), nullable=True)      # Custom text (e.g., "JohnDoe Photography")
    watermark_opacity = Column(Float, default=0.5)           # Opacity 0-1 (default 50%)
    watermark_style = Column(String(20), default='text')     # 'text', 'logo', or 'both'
    watermark_position = Column(String(20), default='bottom-right')  # 'center', 'bottom-right', 'bottom-left', 'top-right', 'top-left', 'tiled'
    # Default: Show watermarks during surfer selection phase (before purchase)
    default_watermark_in_selection = Column(Boolean, default=True)  # Global photographer setting
    
    # ============ SERVICE AREA & TRAVEL SURCHARGES ============
    # Maximum service radius for scheduled bookings (miles)
    service_radius_miles = Column(Float, default=25.0)
    # Base location coordinates (photographer's home base)
    home_latitude = Column(Float, nullable=True)
    home_longitude = Column(Float, nullable=True)
    # Human-readable location name (e.g., "San Diego, CA" or "Uluwatu, Bali")
    home_location_name = Column(String(255), nullable=True)
    # Travel surcharge tiers (JSON format)
    # Example: [{"min_miles": 0, "max_miles": 10, "surcharge": 0}, {"min_miles": 10, "max_miles": 25, "surcharge": 25}]
    travel_surcharges = Column(JSON, nullable=True)
    # Whether photographer charges travel fees
    charges_travel_fees = Column(Boolean, default=False)
    
    # On-Demand GPS tracking (Uber-style)
    on_demand_available = Column(Boolean, default=False)  # Currently active and visible
    on_demand_latitude = Column(Float, nullable=True)
    on_demand_longitude = Column(Float, nullable=True)
    on_demand_city = Column(String(100), nullable=True)
    on_demand_county = Column(String(100), nullable=True)
    on_demand_updated_at = Column(DateTime(timezone=True), nullable=True)
    on_demand_streak = Column(Integer, default=0)  # Consecutive month streak for on-demand
    xp_total = Column(Integer, default=0)  # Total gamification XP
    # Dynamic Pricing
    on_demand_peak_enabled = Column(Boolean, default=False)  # Enable peak/swell pricing
    on_demand_peak_multiplier = Column(Float, default=1.5)  # Peak rate multiplier (e.g., 1.5x, 2.0x)
    on_demand_claimed_spots = Column(Text, nullable=True)  # JSON array of claimed spot IDs
    
    # ============ META GRAPH API CONNECTIONS ============
    # Stores Facebook/Instagram OAuth tokens and connected accounts
    # JSON format: {"access_token": "...", "pages": [...], "instagram_accounts": [...]}
    meta_connections = Column(JSON, nullable=True)
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    
    # Admin & moderation
    is_admin = Column(Boolean, default=False)
    is_suspended = Column(Boolean, default=False)
    suspended_at = Column(DateTime(timezone=True), nullable=True)
    suspended_reason = Column(Text, nullable=True)
    suspension_until = Column(DateTime(timezone=True), nullable=True)  # When suspension ends
    is_banned = Column(Boolean, default=False)
    banned_at = Column(DateTime(timezone=True), nullable=True)
    
    # ToS Strike System
    tos_strike_count = Column(Integer, default=0)  # Total accumulated strikes
    tos_last_violation_at = Column(DateTime(timezone=True), nullable=True)
    
    # Gamification - Surf Streak & Badges (Payment → Profile cross-pollination)
    surf_streak = Column(Integer, default=0)
    last_surf_date = Column(Date, nullable=True)
    total_sessions = Column(Integer, default=0)
    badges = Column(Text, nullable=True)  # JSON array of badge IDs
    
    parent = relationship('Profile', remote_side=[id], backref='children')
    current_spot = relationship('SurfSpot', back_populates='active_photographers')
    board_catalog = relationship('BoardCatalog', back_populates='shaper', cascade='all, delete-orphan')
    bookings_as_photographer = relationship('Booking', back_populates='photographer', foreign_keys='Booking.photographer_id', cascade='all, delete-orphan')
    booking_participants = relationship('BookingParticipant', back_populates='participant', foreign_keys='BookingParticipant.participant_id', cascade='all, delete-orphan')
    payment_transactions = relationship('PaymentTransaction', back_populates='user', cascade='all, delete-orphan')
    posts = relationship('Post', back_populates='author', foreign_keys='Post.author_id', cascade='all, delete-orphan')
    target_gear_item = relationship('GearCatalog', foreign_keys=[target_gear_item_id])



class PasswordResetToken(Base):
    """Password reset tokens with expiration"""
    __tablename__ = 'password_reset_tokens'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    token = Column(String(64), unique=True, nullable=False, index=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    used = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    user = relationship('Profile')


class SurfSpot(Base):
    __tablename__ = 'surf_spots'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    name = Column(String(255), nullable=False, index=True)
    region = Column(String(255), nullable=True)  # e.g., "Central Florida", "South Florida"
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    description = Column(Text, nullable=True)
    difficulty = Column(String(50), nullable=True)  # Beginner, Intermediate, Advanced
    best_tide = Column(String(100), nullable=True)
    best_swell = Column(String(100), nullable=True)
    image_url = Column(String(500), nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    # Global Spot Database fields (P1 - NEW)
    osm_id = Column(String(50), nullable=True, index=True)  # OpenStreetMap node ID for deduplication
    country = Column(String(100), nullable=True, index=True)  # e.g., "USA", "Australia", "Indonesia"
    state_province = Column(String(100), nullable=True)  # e.g., "Florida", "California", "Bali"
    import_tier = Column(Integer, default=1)  # 1=East Coast, 2=West Coast/Hawaii, 3=Global
    wave_type = Column(String(100), nullable=True)  # e.g., "Beach Break", "Point Break", "Reef Break"
    
    # Secondary location fields for granular tagging
    secondary_city = Column(String(100), nullable=True)  # e.g., "Cocoa Beach", "Satellite Beach"
    secondary_area = Column(String(100), nullable=True)  # e.g., "Space Coast", "Treasure Coast"
    
    # Precision Pin fields (Iteration 135 - Peak-First)
    original_latitude = Column(Float, nullable=True)  # Pre-adjustment coordinates
    original_longitude = Column(Float, nullable=True)
    is_verified_peak = Column(Boolean, default=False)  # True if manually verified or snapped to water
    accuracy_flag = Column(String(50), default='unverified')  # 'verified', 'low_accuracy', 'unverified', 'crowdsourced'
    verified_by = Column(String(36), nullable=True)  # Admin who verified
    verified_at = Column(DateTime(timezone=True), nullable=True)
    refinement_count = Column(Integer, default=0)  # Number of photographer refinements
    last_refined_at = Column(DateTime(timezone=True), nullable=True)
    
    # Community Verification (Photographer votes)
    community_verified = Column(Boolean, default=False)  # True if 5+ photographers verified accuracy
    verification_votes_yes = Column(Integer, default=0)  # Count of "Yes, pin is accurate" votes
    verification_votes_no = Column(Integer, default=0)  # Count of "No, needs move" votes
    
    # NOAA Buoy Assignment (Admin can manually link)
    noaa_buoy_id = Column(String(50), nullable=True)  # NOAA buoy station ID for forecast data
    
    # Precision Queue flag
    flagged_for_review = Column(Boolean, default=False)  # True if >150m from water (needs admin review)
    
    active_photographers = relationship('Profile', back_populates='current_spot')



class SpotRefinement(Base):
    """Crowdsourced spot location refinements from photographers"""
    __tablename__ = 'spot_refinements'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    spot_id = Column(String(36), ForeignKey('surf_spots.id', ondelete='CASCADE'), nullable=False, index=True)
    photographer_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False)
    proposed_latitude = Column(Float, nullable=False)
    proposed_longitude = Column(Float, nullable=False)
    status = Column(String(20), default='pending')  # 'pending', 'approved', 'rejected'
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    reviewed_by = Column(String(36), nullable=True)


class SpotVerification(Base):
    """
    Photographer verification votes for spot pin accuracy.
    5+ "Yes" votes from verified photographers = Community Verified badge.
    """
    __tablename__ = 'spot_verifications'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    spot_id = Column(String(36), ForeignKey('surf_spots.id', ondelete='CASCADE'), nullable=False, index=True)
    photographer_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False)
    
    # Verification vote
    is_accurate = Column(Boolean, nullable=False)  # True = "Yes, pin is on peak", False = "No, needs move"
    
    # If not accurate, photographer can suggest new coordinates
    suggested_latitude = Column(Float, nullable=True)
    suggested_longitude = Column(Float, nullable=True)
    suggestion_note = Column(Text, nullable=True)  # Optional note about why pin should move
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    # Relationships
    spot = relationship('SurfSpot')
    photographer = relationship('Profile')


class SpotEditLog(Base):
    """
    Admin audit log for spot edits (create, move, delete).
    Maintains complete history of precision changes.
    """
    __tablename__ = 'spot_edit_logs'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    spot_id = Column(String(36), ForeignKey('surf_spots.id', ondelete='SET NULL'), nullable=True, index=True)
    admin_id = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=False)
    
    # Action type
    action = Column(String(30), nullable=False)  # 'create', 'move', 'delete', 'verify', 'update_buoy'
    
    # Coordinate changes
    old_latitude = Column(Float, nullable=True)
    old_longitude = Column(Float, nullable=True)
    new_latitude = Column(Float, nullable=True)
    new_longitude = Column(Float, nullable=True)
    
    # Metadata changes
    old_name = Column(String(255), nullable=True)
    new_name = Column(String(255), nullable=True)
    old_region = Column(String(255), nullable=True)
    new_region = Column(String(255), nullable=True)
    
    # Water check result
    was_on_land = Column(Boolean, default=False)  # True if pin was placed on land
    override_land_warning = Column(Boolean, default=False)  # True if admin overrode land warning
    
    # NOAA Buoy assignment
    noaa_buoy_id = Column(String(50), nullable=True)  # Assigned buoy for forecast data
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    # Relationships
    admin = relationship('Profile')


class SpotOfTheDay(Base):
    """
    Spot of the Day - Social Discovery Engine
    Highlights best nearby spots based on photographer activity and conditions
    """
    __tablename__ = 'spot_of_the_day'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    spot_id = Column(String(36), ForeignKey('surf_spots.id', ondelete='CASCADE'), nullable=False, index=True)
    region = Column(String(100), nullable=False, index=True)  # e.g., "Space Coast", "Gold Coast"
    date = Column(Date, nullable=False, index=True)
    
    # Reason for selection
    reason = Column(String(50), nullable=False)  # 'epic_conditions', 'high_activity', 'pro_shooter', 'trending'
    rating = Column(String(20), nullable=True)  # 'FLAT', 'POOR', 'POOR_TO_FAIR', 'FAIR', 'FAIR_TO_GOOD', 'GOOD', 'EPIC'
    
    # Featured photo from the photographer that triggered this
    featured_photo_url = Column(String(500), nullable=True)
    featured_photographer_id = Column(String(36), ForeignKey('profiles.id'), nullable=True)
    
    # Metrics at time of selection
    active_photographers = Column(Integer, default=0)
    wave_height = Column(String(20), nullable=True)  # e.g., "3-4 ft"
    wind_conditions = Column(String(50), nullable=True)  # e.g., "8kts E"
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    expires_at = Column(DateTime(timezone=True), nullable=True)
    
    # Relationships
    spot = relationship('SurfSpot')
    featured_photographer = relationship('Profile')


class BoardCatalog(Base):
    __tablename__ = 'board_catalog'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    shaper_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    model = Column(String(255), nullable=False)
    length = Column(Float, nullable=False)
    volume = Column(Float, nullable=False)
    price = Column(Float, nullable=False)
    description = Column(Text, nullable=True)
    image_url = Column(String(500), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    shaper = relationship('Profile', back_populates='board_catalog')


class Booking(Base):
    __tablename__ = 'bookings'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    photographer_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    creator_id = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True, index=True)  # User who initiated
    surf_spot_id = Column(String(36), ForeignKey('surf_spots.id', ondelete='SET NULL'), nullable=True, index=True)  # Linked surf spot
    
    # Session details
    max_participants = Column(Integer, default=5, nullable=False)
    location = Column(String(255), nullable=False)
    latitude = Column(Float, nullable=True)  # For proximity matching
    longitude = Column(Float, nullable=True)
    session_date = Column(DateTime(timezone=True), nullable=False)
    duration = Column(Integer, default=60, nullable=False)  # Duration in minutes
    description = Column(Text, nullable=True)
    
    # Pricing
    total_price = Column(Float, nullable=False)  # Total session price
    price_per_person = Column(Float, nullable=True)  # Calculated based on participants
    
    # ============ RESOLUTION-TIERED PRICING (Parity with On-Demand/Live) ============
    # General Bookings now support the same contextual pricing depth as On-Demand/Live
    booking_price_web = Column(Float, default=3.0)       # Web quality price per photo
    booking_price_standard = Column(Float, default=5.0)  # Standard quality price per photo
    booking_price_high = Column(Float, default=10.0)     # High-res quality price per photo
    booking_photos_included = Column(Integer, default=3) # Photos included in booking buy-in
    booking_full_gallery = Column(Boolean, default=False) # Full gallery access toggle
    
    # Splitting options
    allow_splitting = Column(Boolean, default=True)
    split_mode = Column(String(30), default='friends_only')  # 'friends_only', 'open_nearby', or 'skill_match'
    invite_code = Column(String(10), unique=True, nullable=True)  # For friends to join
    proximity_radius = Column(Float, default=5.0)  # Miles for open_nearby mode
    
    # Skill-based matching
    skill_level_filter = Column(String(50), nullable=True)  # 'Beginner', 'Intermediate', 'Advanced', 'Expert', or null for all
    
    # Status tracking - includes PENDING_PAYMENT for crew split logic
    # Status flow: Pending -> PendingPayment (if crew) -> Confirmed -> Completed / Cancelled
    status = Column(String(50), default='Pending', nullable=False, index=True)
    
    # Crew payment tracking
    crew_payment_required = Column(Boolean, default=False)  # True if waiting for crew to pay
    crew_paid_count = Column(Integer, default=0)  # Number of crew members who have paid
    host_notified_of_payment_issue = Column(Boolean, default=False)  # True if host was alerted
    
    # ============ CREW HUB: HOLD & NOTIFICATION PATTERN ============
    # Booking type: 'on_demand' (60min window) or 'scheduled' (24hr window)
    booking_type = Column(String(30), default='scheduled')  # 'on_demand', 'scheduled'
    
    # Captain's hold payment (locks the slot)
    captain_hold_amount = Column(Float, default=0.0)  # Amount Captain paid to hold
    captain_hold_paid = Column(Boolean, default=False)  # Whether Captain has paid their share
    captain_hold_at = Column(DateTime(timezone=True), nullable=True)  # When Captain paid hold
    
    # Payment window expiry
    payment_window_expires_at = Column(DateTime(timezone=True), nullable=True)  # Crew must pay by this time
    payment_window_expired = Column(Boolean, default=False)  # True if window has expired
    
    # Expiry action taken
    expiry_action = Column(String(30), nullable=True)  # 'cancelled_refunded', 'captain_covered', None
    
    # ============ THE LINEUP: SURF SESSION LOBBY SYSTEM ============
    # Like a poker lobby - surfers wait for crew to join before session locks
    lineup_status = Column(String(30), default='closed')  # 'open', 'filling', 'ready', 'locked', 'confirmed', 'closed'
    lineup_open_at = Column(DateTime(timezone=True), nullable=True)  # When lineup opened
    lineup_closes_at = Column(DateTime(timezone=True), nullable=True)  # 96hrs before session = auto-lock
    lineup_visibility = Column(String(30), default='friends')  # 'friends' (mutual followers), 'area' (nearby surfers), 'both'
    lineup_min_crew = Column(Integer, default=2)  # Minimum crew size to proceed (default 2 for shared session)
    lineup_max_crew = Column(Integer, nullable=True)  # Max crew size (uses max_participants if null)
    lineup_message = Column(Text, nullable=True)  # Captain's message to potential crew
    lineup_auto_confirm = Column(Boolean, default=False)  # Auto-confirm when min_crew reached
    
    # ============ POKER-STYLE SEAT RESERVATION SYSTEM ============
    # Configurable invite/reservation window (like poker seat timeout)
    invite_expiry_hours = Column(Float, default=24.0)  # How long invites last before expiring (1, 4, 12, 24, 48, or custom)
    
    # Waitlist system (auto-fill when spots open)
    waitlist_enabled = Column(Boolean, default=True)  # Allow waitlist for full sessions
    waitlist_claim_minutes = Column(Integer, default=30)  # How long waitlisted user has to claim open spot
    
    # "Keep my seat" feature (extend reservation)
    allow_keep_seat = Column(Boolean, default=True)  # Allow pending surfers to extend their hold
    keep_seat_extension_hours = Column(Float, default=2.0)  # How many hours each extension adds
    max_keep_seat_extensions = Column(Integer, default=2)  # Max number of extensions allowed
    
    # ============ ESCROW & CANCELLATION POLICY ============
    # Escrow: Funds held until booking completed + content delivered
    escrow_amount = Column(Float, default=0.0)  # Total amount held in escrow
    escrow_status = Column(String(30), default='none')  # 'none', 'held', 'released', 'refunded'
    escrow_released_at = Column(DateTime(timezone=True), nullable=True)  # When funds released to photographer
    content_delivered = Column(Boolean, default=False)  # True when photographer uploads content to gallery
    content_delivered_at = Column(DateTime(timezone=True), nullable=True)
    
    # Cancellation Policy: >48hrs=90% refund, 24-48hrs=50% refund, <24hrs=0% refund
    cancellation_policy = Column(String(50), default='standard')  # 'standard', 'flexible', 'strict'
    cancelled_at = Column(DateTime(timezone=True), nullable=True)
    cancellation_reason = Column(Text, nullable=True)
    refund_amount = Column(Float, default=0.0)  # Actual refund amount after policy applied
    refund_percentage = Column(Float, default=0.0)  # Percentage refunded (90, 50, or 0)
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    
    photographer = relationship('Profile', back_populates='bookings_as_photographer', foreign_keys=[photographer_id])
    creator = relationship('Profile', foreign_keys=[creator_id])
    surf_spot = relationship('SurfSpot', backref='bookings')
    participants = relationship('BookingParticipant', back_populates='booking', cascade='all, delete-orphan')


class BookingParticipant(Base):
    __tablename__ = 'booking_participants'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    booking_id = Column(String(36), ForeignKey('bookings.id', ondelete='CASCADE'), nullable=False, index=True)
    participant_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Invitation tracking
    invited_by_id = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True)
    invite_type = Column(String(30), default='direct')  # 'direct', 'friend_invite', 'open_nearby'
    
    # ============ CREW HUB PAYMENT CONTROL ============
    # Payment
    paid_amount = Column(Float, default=0.0, nullable=False)
    payment_status = Column(String(50), default='Pending', nullable=False)  # Pending, Paid, Refunded
    payment_method = Column(String(30), nullable=True)  # 'credits', 'stripe', 'captain_covered'
    
    # Crew Hub: Custom share amount (Captain can set different amounts per member)
    share_amount = Column(Float, default=0.0, nullable=False)  # Custom amount this member owes
    share_percentage = Column(Float, default=0.0, nullable=False)  # Percentage of total (0-100)
    
    # Crew Hub: "Paid by Captain" toggle
    covered_by_captain = Column(Boolean, default=False)  # Captain is paying for this member
    covered_amount = Column(Float, default=0.0, nullable=False)  # Amount captain is covering
    
    # Payment request tracking (for split payments via Messages)
    payment_request_sent = Column(Boolean, default=False)  # True if payment request sent
    payment_request_sent_at = Column(DateTime(timezone=True), nullable=True)
    
    # Is this participant the Captain (session initiator)?
    is_captain = Column(Boolean, default=False)
    
    # Status
    status = Column(String(30), default='pending')  # pending, confirmed, declined, cancelled
    
    # Selfie for photographer identification
    selfie_url = Column(Text, nullable=True)  # Surfer's selfie with board for identification
    
    joined_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    booking = relationship('Booking', back_populates='participants')
    participant = relationship('Profile', back_populates='booking_participants', foreign_keys=[participant_id])
    invited_by = relationship('Profile', foreign_keys=[invited_by_id])


class BookingInvite(Base):
    """Tracks invitations to join a booking"""
    __tablename__ = 'booking_invites'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    booking_id = Column(String(36), ForeignKey('bookings.id', ondelete='CASCADE'), nullable=False, index=True)
    inviter_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    invitee_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    status = Column(String(30), default='pending')  # pending, accepted, declined, expired
    message = Column(Text, nullable=True)
    
    # Countdown timer - invite expires after this time
    expires_at = Column(DateTime(timezone=True), nullable=True)  # Default 24 hours from creation
    
    # For nearby invites
    invite_source = Column(String(30), default='direct')  # 'direct', 'nearby', 'broadcast'
    distance_miles = Column(Float, nullable=True)  # Distance from session location when invited
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    responded_at = Column(DateTime(timezone=True), nullable=True)
    
    booking = relationship('Booking')
    inviter = relationship('Profile', foreign_keys=[inviter_id])
    invitee = relationship('Profile', foreign_keys=[invitee_id])


class BookingWaitlist(Base):
    """
    Waitlist for booking sessions - like a poker tournament waitlist.
    When a spot opens up (invite expires/declines), next person is auto-notified.
    """
    __tablename__ = 'booking_waitlist'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    booking_id = Column(String(36), ForeignKey('bookings.id', ondelete='CASCADE'), nullable=False, index=True)
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Position in waitlist (1 = first in line)
    position = Column(Integer, nullable=False)
    
    # Status tracking
    status = Column(String(30), default='waiting')  # waiting, notified, claimed, expired, left
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    notified_at = Column(DateTime(timezone=True), nullable=True)  # When notified of open spot
    claim_expires_at = Column(DateTime(timezone=True), nullable=True)  # Deadline to claim spot
    claimed_at = Column(DateTime(timezone=True), nullable=True)  # When they claimed the spot
    
    # Distance for sorting (nearby users get priority)
    distance_miles = Column(Float, nullable=True)
    
    booking = relationship('Booking', backref='waitlist_entries')
    user = relationship('Profile')
    
    __table_args__ = (
        Index('idx_booking_waitlist_booking', 'booking_id'),
        Index('idx_booking_waitlist_user', 'user_id'),
        Index('idx_booking_waitlist_position', 'booking_id', 'position'),
    )


class BookingKeepSeatLog(Base):
    """
    Track "keep my seat" extensions for pending participants.
    Like poker's time bank - limited extensions to hold your spot.
    """
    __tablename__ = 'booking_keep_seat_logs'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    booking_id = Column(String(36), ForeignKey('bookings.id', ondelete='CASCADE'), nullable=False, index=True)
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    invite_id = Column(String(36), ForeignKey('booking_invites.id', ondelete='CASCADE'), nullable=True)
    
    # Extension details
    extension_number = Column(Integer, nullable=False)  # 1st, 2nd, etc.
    hours_extended = Column(Float, nullable=False)  # How many hours added
    old_expires_at = Column(DateTime(timezone=True), nullable=False)
    new_expires_at = Column(DateTime(timezone=True), nullable=False)
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    booking = relationship('Booking')
    user = relationship('Profile')


class PhotographerAvailability(Base):
    """Photographer's availability schedule for booking requests"""
    __tablename__ = 'photographer_availability'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    photographer_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Date-specific or recurring
    date = Column(Date, nullable=True)  # Specific date (null if recurring)
    is_recurring = Column(Boolean, default=False)
    recurring_days = Column(JSON, nullable=True)  # [0,1,2...6] for Sun-Sat
    
    # Time range
    start_time = Column(String(10), nullable=False)  # HH:MM format
    end_time = Column(String(10), nullable=False)
    
    # Metadata
    time_preset = Column(String(30), default='custom')  # morning, afternoon, evening, all_day, custom
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    
    photographer = relationship('Profile')


class DispatchRequestStatusEnum(enum.Enum):
    PENDING_PAYMENT = "pending_payment"
    SEARCHING_FOR_PRO = "searching_for_pro"
    ACCEPTED = "accepted"
    EN_ROUTE = "en_route"
    ARRIVED = "arrived"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    NO_PRO_FOUND = "no_pro_found"
    REFUNDED = "refunded"


class DispatchRequest(Base):
    """On-Demand photographer dispatch - Uber-style reverse requests"""
    __tablename__ = 'dispatch_requests'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    # Requester info
    requester_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Location (where surfer wants photographer)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    location_name = Column(String(255), nullable=True)  # Friendly name of location
    spot_id = Column(String(36), ForeignKey('surf_spots.id', ondelete='SET NULL'), nullable=True)
    
    # Session details
    estimated_duration_hours = Column(Float, default=1.0)
    requested_start_time = Column(DateTime(timezone=True), nullable=True)  # For scheduled requests
    is_immediate = Column(Boolean, default=True)  # True = on-demand now, False = scheduled
    arrival_window_minutes = Column(Integer, default=30)  # 30, 60, or 90 minutes from request time
    
    # Status tracking
    status = Column(Enum(DispatchRequestStatusEnum), default=DispatchRequestStatusEnum.PENDING_PAYMENT, index=True)
    status_changed_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    # Dispatch stages
    dispatch_stage = Column(Integer, default=0)  # 0=none, 1=approved_pros, 2=all_pros
    stage_1_started_at = Column(DateTime(timezone=True), nullable=True)
    stage_2_started_at = Column(DateTime(timezone=True), nullable=True)
    search_radius_miles = Column(Float, default=5.0)
    
    # Assigned photographer (after acceptance)
    photographer_id = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True, index=True)
    target_photographer_id = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True, index=True)  # For Quick Book - specific photographer requested
    accepted_at = Column(DateTime(timezone=True), nullable=True)
    
    # GPS Tracking
    photographer_lat = Column(Float, nullable=True)
    photographer_lng = Column(Float, nullable=True)
    photographer_last_update = Column(DateTime(timezone=True), nullable=True)
    requester_lat = Column(Float, nullable=True)
    requester_lng = Column(Float, nullable=True)
    requester_last_update = Column(DateTime(timezone=True), nullable=True)
    estimated_arrival_minutes = Column(Integer, nullable=True)
    
    # Arrival & Completion
    arrived_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    
    # Pricing & Payment
    hourly_rate = Column(Float, nullable=False)  # Pro's rate at time of request
    estimated_total = Column(Float, nullable=False)  # hourly_rate * duration
    deposit_pct = Column(Integer, default=25)
    deposit_amount = Column(Float, nullable=False)
    
    # Stripe payment
    stripe_payment_intent_id = Column(String(255), nullable=True)
    stripe_checkout_session_id = Column(String(255), nullable=True)  # For Stripe Checkout redirect flow
    deposit_paid = Column(Boolean, default=False)
    deposit_paid_at = Column(DateTime(timezone=True), nullable=True)
    pending_payment_expires_at = Column(DateTime(timezone=True), nullable=True)  # For client-side countdown & auto-cleanup
    
    # Shared/Split request
    is_shared = Column(Boolean, default=False)
    max_participants = Column(Integer, default=1)
    captain_share_amount = Column(Float, nullable=True)  # Captain's portion to pay (can be 0 if covering none)
    all_participants_paid = Column(Boolean, default=False)  # True when all crew members have paid
    all_participants_paid_at = Column(DateTime(timezone=True), nullable=True)  # Timestamp when fully funded
    
    # Converted booking (after completion)
    booking_id = Column(String(36), ForeignKey('bookings.id', ondelete='SET NULL'), nullable=True)
    
    # Cancellation & Refund
    cancelled_at = Column(DateTime(timezone=True), nullable=True)
    cancelled_by = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True)
    cancellation_reason = Column(Text, nullable=True)
    refund_amount = Column(Float, nullable=True)
    refund_type = Column(String(20), nullable=True)  # 'full', 'half', 'none'
    
    # Surfer Identification
    selfie_url = Column(Text, nullable=True)  # Surfer's selfie with board for Pro to identify them (base64 can be large)
    
    # Cached captain metadata for photographer dashboard (written atomically with payment)
    captain_name = Column(String(255), nullable=True)
    captain_username = Column(String(100), nullable=True)
    captain_avatar_url = Column(Text, nullable=True)
    
    # Boost Priority (paid feature to jump queue)
    boost_priority = Column(Integer, default=0)  # 0=none, 1-3=boosted levels
    boost_expires_at = Column(DateTime(timezone=True), nullable=True)
    boost_credits_spent = Column(Float, default=0.0)
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    
    # Relationships
    requester = relationship('Profile', foreign_keys=[requester_id])
    photographer = relationship('Profile', foreign_keys=[photographer_id])
    target_photographer = relationship('Profile', foreign_keys=[target_photographer_id])
    cancelled_by_user = relationship('Profile', foreign_keys=[cancelled_by])
    spot = relationship('SurfSpot')
    booking = relationship('Booking')


class DispatchRequestParticipant(Base):
    """Participants in a shared dispatch request (for split cost)"""
    __tablename__ = 'dispatch_request_participants'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    dispatch_request_id = Column(String(36), ForeignKey('dispatch_requests.id', ondelete='CASCADE'), nullable=False, index=True)
    participant_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Individual payment
    share_amount = Column(Float, nullable=False)  # Their share of the deposit
    paid = Column(Boolean, default=False)
    paid_at = Column(DateTime(timezone=True), nullable=True)
    stripe_payment_intent_id = Column(String(255), nullable=True)
    
    # Selfie for identification
    selfie_url = Column(Text, nullable=True)
    
    # Cached profile metadata for dashboard sync (written atomically with payment)
    payer_name = Column(String(255), nullable=True)
    payer_username = Column(String(100), nullable=True)
    payer_avatar_url = Column(Text, nullable=True)
    
    # Status
    status = Column(String(30), default='invited')  # invited, confirmed, cancelled, paid
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    dispatch_request = relationship('DispatchRequest')
    participant = relationship('Profile')


class CancellationExceptionRequest(Base):
    """
    Emergency cancellation waiver requests from surfers.
    When a photographer charges a cancellation fee, surfers can submit an
    emergency exception request explaining why they need a full refund.
    The photographer reviews and approves/denies on their On-Demand dashboard.
    """
    __tablename__ = 'cancellation_exception_requests'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    dispatch_request_id = Column(String(36), ForeignKey('dispatch_requests.id', ondelete='CASCADE'), nullable=False, index=True)
    requester_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    photographer_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Exception details
    reason = Column(Text, nullable=False)  # Surfer's explanation (e.g. "Family emergency", "Injury")
    category = Column(String(50), default='other')  # 'emergency', 'weather', 'injury', 'other'
    
    # Financial context (snapshot at time of request)
    deposit_amount = Column(Float, nullable=False)  # Original deposit
    fee_amount = Column(Float, nullable=False)  # Cancellation fee that would be charged
    refund_requested = Column(Float, nullable=False)  # Amount surfer is requesting back (typically full deposit)
    
    # Resolution
    status = Column(String(20), default='pending')  # 'pending', 'approved', 'denied'
    resolution_note = Column(Text, nullable=True)  # Photographer's response message
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    
    # Refund outcome (only set after resolution)
    final_refund_amount = Column(Float, nullable=True)  # Actual refund given (could be partial)
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    # Relationships
    dispatch_request = relationship('DispatchRequest')
    requester = relationship('Profile', foreign_keys=[requester_id])
    photographer_profile = relationship('Profile', foreign_keys=[photographer_id])


class SessionSnapshot(Base):
    """
    Frozen snapshot of participant data when session goes ARRIVED.
    DATA INTEGRITY: Prevents mid-session mutations from affecting active sessions.
    Once a session starts, this snapshot is used for all participant lookups.
    """
    __tablename__ = 'session_snapshots'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    dispatch_request_id = Column(String(36), ForeignKey('dispatch_requests.id', ondelete='CASCADE'), nullable=False, index=True)
    booking_id = Column(String(36), ForeignKey('bookings.id', ondelete='SET NULL'), nullable=True, index=True)
    
    # Frozen participant data as JSON
    snapshot_data = Column(JSON, nullable=False)  # {captain: {...}, crew: [{...}]}
    
    # Metadata
    snapshot_type = Column(String(50), default='arrived')  # 'arrived', 'completed'
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    # Relationships
    dispatch_request = relationship('DispatchRequest')
    booking = relationship('Booking')


class DispatchNotification(Base):
    """Tracks which photographers were notified for a dispatch"""
    __tablename__ = 'dispatch_notifications'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    dispatch_request_id = Column(String(36), ForeignKey('dispatch_requests.id', ondelete='CASCADE'), nullable=False, index=True)
    photographer_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Notification details
    dispatch_stage = Column(Integer, nullable=False)  # Which stage this notification was in
    distance_miles = Column(Float, nullable=True)  # Distance from photographer to request location
    
    # Response
    seen_at = Column(DateTime(timezone=True), nullable=True)
    response = Column(String(20), nullable=True)  # 'accepted', 'declined', 'expired'
    responded_at = Column(DateTime(timezone=True), nullable=True)
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    dispatch_request = relationship('DispatchRequest')
    photographer = relationship('Profile')


class PaymentTransaction(Base):
    __tablename__ = 'payment_transactions'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    session_id = Column(String(255), unique=True, nullable=False, index=True)
    amount = Column(Float, nullable=False)
    currency = Column(String(10), default='usd', nullable=False)
    payment_status = Column(String(50), default='Pending', nullable=False, index=True)
    status = Column(String(50), default='Pending', nullable=False)
    transaction_metadata = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    
    user = relationship('Profile', back_populates='payment_transactions')


class CreditTransaction(Base):
    """Track all credit movements - 1 credit = $1"""
    __tablename__ = 'credit_transactions'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Transaction details
    amount = Column(Float, nullable=False)  # Positive = credit, Negative = debit
    balance_before = Column(Float, nullable=False)  # Balance before transaction
    balance_after = Column(Float, nullable=False)   # Balance after transaction
    
    # Transaction type
    transaction_type = Column(String(50), nullable=False)  
    # Types: 'purchase', 'live_session_buyin', 'live_photo_purchase', 'booking_payment',
    #        'booking_refund', 'photographer_earning', 'gallery_purchase', 'gallery_sale',
    #        'refund', 'admin_adjustment', 'stripe_topup'
    
    # ============ REVENUE STREAM CATEGORIZATION ============
    # Four distinct streams for Unified Earnings Dashboard:
    # 1. 'live_session' - Buy-ins + photo sales at session rate
    # 2. 'request_pro' - Uber-style on-demand bookings
    # 3. 'regular_booking' - Scheduled appointments
    # 4. 'gallery_sale' - Passive sales at general gallery rate
    revenue_stream = Column(String(30), nullable=True)  # For earnings categorization
    
    # Reference IDs (optional, based on type)
    reference_type = Column(String(50), nullable=True)  # 'booking', 'live_session', 'gallery_item', etc.
    reference_id = Column(String(36), nullable=True)
    
    # For transfers between users (e.g., photographer earnings)
    counterparty_id = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True)
    
    # Split booking tracking
    is_split_payment = Column(Boolean, default=False)  # True if part of a split
    split_group_id = Column(String(36), nullable=True)  # Groups split payments together
    
    description = Column(String(500), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    
    # Index for reference integrity checks (no FK due to polymorphic references)
    __table_args__ = (
        Index('idx_credit_tx_reference', 'reference_type', 'reference_id'),
    )
    
    user = relationship('Profile', foreign_keys=[user_id], backref='credit_transactions')
    counterparty = relationship('Profile', foreign_keys=[counterparty_id])




class Post(Base):
    __tablename__ = 'posts'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    author_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    media_url = Column(Text, nullable=True)  # Optional for check-ins - TEXT for base64 selfies
    media_type = Column(String(20), default='image')  # 'image', 'video', or 'check_in'
    thumbnail_url = Column(Text, nullable=True)  # For video thumbnails - TEXT for flexibility
    caption = Column(Text, nullable=True)
    location = Column(String(255), nullable=True)
    likes_count = Column(Integer, default=0)
    comments_count = Column(Integer, default=0)  # Track comment count
    
    # ============================================================
    # WAVES FEATURE - Short-form vertical video
    # ============================================================
    content_type = Column(String(20), default='post', index=True)  # 'post' or 'wave'
    aspect_ratio = Column(String(10), nullable=True)  # '9:16', '16:9', '1:1', '4:5'
    view_count = Column(Integer, default=0)  # For Waves engagement tracking
    
    # Video metadata
    video_width = Column(Integer, nullable=True)
    video_height = Column(Integer, nullable=True)
    video_duration = Column(Float, nullable=True)
    was_transcoded = Column(Boolean, default=False)
    
    # Check-in fields (for Map → Feed cross-pollination)
    is_check_in = Column(Boolean, default=False, index=True)
    spot_id = Column(String(36), ForeignKey('surf_spots.id', ondelete='SET NULL'), nullable=True)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    check_in_photographer_id = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True)
    check_in_session_price = Column(Float, nullable=True)
    
    # ============================================================
    # SESSION LOG METADATA (P1 - Session-Based Social Feed)
    # ============================================================
    
    # Session timing
    session_date = Column(DateTime(timezone=True), nullable=True)  # When the session happened
    session_start_time = Column(String(10), nullable=True)  # "06:45" format
    session_end_time = Column(String(10), nullable=True)    # "08:45" format
    session_label = Column(String(50), nullable=True)       # "Dawn Patrol", "Sunset Session", etc.
    
    # Conditions (auto-filled from forecast, user can override)
    wave_height_ft = Column(Float, nullable=True)           # e.g., 4.5
    wave_period_sec = Column(Integer, nullable=True)        # e.g., 12
    wave_direction = Column(String(10), nullable=True)      # "N", "NE", "E", "SE", "S", "SW", "W", "NW"
    wave_direction_degrees = Column(Float, nullable=True)   # e.g., 90 (for visualization)
    wind_speed_mph = Column(Float, nullable=True)           # e.g., 8.0
    wind_direction = Column(String(10), nullable=True)      # "N", "NE", "E", "SE", "S", "SW", "W", "NW"
    tide_height_ft = Column(Float, nullable=True)           # e.g., 2.3
    tide_status = Column(String(20), nullable=True)         # "Rising", "Falling", "High", "Low"
    conditions_source = Column(String(20), default='manual')  # 'auto', 'manual', 'edited'
    
    # Booking/Gallery link (for photographer posts)
    booking_id = Column(String(36), ForeignKey('bookings.id', ondelete='SET NULL'), nullable=True)
    gallery_id = Column(String(36), nullable=True)          # Link to photographer's gallery
    is_highlight_post = Column(Boolean, default=False)      # Photographer highlight carousel
    
    # Session Log sharing (from Scheduled Tab)
    is_session_log = Column(Boolean, default=False)         # True if shared from booking
    session_invite_open = Column(Boolean, default=False)    # True if friends can join
    session_spots_left = Column(Integer, nullable=True)     # Available spots for crew
    session_price_per_person = Column(Float, nullable=True) # Cost per person to join
    
    # Carousel support (multiple media items)
    is_carousel = Column(Boolean, default=False)
    carousel_media = Column(JSON, default=list)  # [{"url": "...", "type": "image/video", "thumbnail": "..."}]
    
    # Post Settings (user preferences)
    hide_like_count = Column(Boolean, default=False)   # Hide likes from others
    comments_disabled = Column(Boolean, default=False)  # Disable commenting
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    
    author = relationship('Profile', back_populates='posts', foreign_keys=[author_id])
    likes = relationship('PostLike', back_populates='post', cascade='all, delete-orphan')
    comments = relationship('Comment', back_populates='post', order_by='Comment.created_at', cascade='all, delete-orphan')
    reactions = relationship('PostReaction', back_populates='post', cascade='all, delete-orphan')
    spot = relationship('SurfSpot', backref='check_in_posts')
    check_in_photographer = relationship('Profile', foreign_keys=[check_in_photographer_id])
    collaborators = relationship('PostCollaboration', back_populates='post', foreign_keys='PostCollaboration.post_id', cascade='all, delete-orphan')
    hashtags = relationship('Hashtag', secondary='post_hashtags', back_populates='posts')


class PostCollaboration(Base):
    """
    "I Was There" Collaboration System
    Allows users to collaborate on posts by linking their presence at a session.
    Supports: Invite, Request, Accept, Deny, Untag
    """
    __tablename__ = 'post_collaborations'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    post_id = Column(String(36), ForeignKey('posts.id', ondelete='CASCADE'), nullable=False, index=True)
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Who initiated: 'author' (post owner invited), 'user' (user requested to join)
    initiated_by = Column(String(10), default='author')  # 'author' or 'user'
    
    # Status flow: pending → accepted/denied, or accepted → untagged
    status = Column(String(20), default='pending')  # 'pending', 'accepted', 'denied', 'untagged'
    
    # Optional: User's own media for this session (their clips from same session)
    linked_media_url = Column(Text, nullable=True)
    linked_media_type = Column(String(20), nullable=True)  # 'image', 'video'
    
    # GPS verification (optional)
    verified_by_gps = Column(Boolean, default=False)
    verification_latitude = Column(Float, nullable=True)
    verification_longitude = Column(Float, nullable=True)
    
    # Community flagging
    is_flagged = Column(Boolean, default=False)
    flag_count = Column(Integer, default=0)
    flag_reasons = Column(JSON, default=list)  # ["wasn't there", "fake", etc.]
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    responded_at = Column(DateTime(timezone=True), nullable=True)
    
    # Relationships
    post = relationship('Post', back_populates='collaborators', foreign_keys=[post_id])
    user = relationship('Profile', backref='post_collaborations')
    
    __table_args__ = (
        # One collaboration per user per post
        Index('ix_post_collab_post_user', 'post_id', 'user_id', unique=True),
    )


class PostLike(Base):
    """Track post likes"""
    __tablename__ = 'post_likes'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    post_id = Column(String(36), ForeignKey('posts.id', ondelete='CASCADE'), nullable=False, index=True)
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    post = relationship('Post', back_populates='likes')
    user = relationship('Profile')
    
    __table_args__ = (
        # Unique constraint: one like per user per post
        Index('ix_post_likes_post_user', 'post_id', 'user_id', unique=True),
    )


class Comment(Base):
    """Comments on posts - supports nested replies via parent_id"""
    __tablename__ = 'comments'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    post_id = Column(String(36), ForeignKey('posts.id', ondelete='CASCADE'), nullable=False, index=True)
    author_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    parent_id = Column(String(36), ForeignKey('comments.id', ondelete='CASCADE'), nullable=True, index=True)  # For replies
    content = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    
    # Edit tracking (Instagram-style "edited" label)
    edited_at = Column(DateTime(timezone=True), nullable=True)  # Timestamp of last edit
    is_edited = Column(Boolean, default=False)  # Quick flag for UI to show "edited" label
    
    post = relationship('Post', back_populates='comments')
    author = relationship('Profile')
    reactions = relationship('CommentReaction', back_populates='comment', cascade='all, delete-orphan')
    # Self-referential relationship for replies
    replies = relationship('Comment', backref=backref('parent', remote_side=[id]), cascade='all, delete-orphan')


class CommentReaction(Base):
    """Emoji reactions to comments (likes, hearts, etc.)"""
    __tablename__ = 'comment_reactions'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    comment_id = Column(String(36), ForeignKey('comments.id', ondelete='CASCADE'), nullable=False, index=True)
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Emoji reaction - same as post reactions: 🤙 Shaka, 🌊 Wave, ❤️ Heart, 🔥 Fire
    emoji = Column(String(10), nullable=False, default='❤️')
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    comment = relationship('Comment', back_populates='reactions')
    user = relationship('Profile')
    
    __table_args__ = (
        # Unique constraint: one reaction per user per comment
        Index('ix_comment_reactions_comment_user', 'comment_id', 'user_id', unique=True),
    )


class PostReaction(Base):
    """Emoji reactions to feed posts (Shaka, Wave, Heart, Fire)"""
    __tablename__ = 'post_reactions'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    post_id = Column(String(36), ForeignKey('posts.id', ondelete='CASCADE'), nullable=False, index=True)
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Emoji reaction - surf-themed: 🤙 Shaka, 🌊 Wave, ❤️ Heart, 🔥 Fire
    emoji = Column(String(10), nullable=False)
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    post = relationship('Post', back_populates='reactions')
    user = relationship('Profile')
    
    __table_args__ = (
        # Unique constraint: one reaction type per user per post
        Index('ix_post_reactions_post_user_emoji', 'post_id', 'user_id', 'emoji', unique=True),
    )


class SavedPost(Base):
    """Saved/bookmarked posts"""
    __tablename__ = 'saved_posts'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    post_id = Column(String(36), ForeignKey('posts.id', ondelete='CASCADE'), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    user = relationship('Profile')
    post = relationship('Post')
    
    __table_args__ = (
        # Unique constraint: one save per user per post
        {'sqlite_autoincrement': True},
    )


class TaggedMedia(Base):
    """Track users tagged in posts or gallery items"""
    __tablename__ = 'tagged_media'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    tagged_user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Can be tagged in a post or gallery item
    post_id = Column(String(36), ForeignKey('posts.id', ondelete='CASCADE'), nullable=True, index=True)
    gallery_item_id = Column(String(36), ForeignKey('gallery_items.id', ondelete='CASCADE'), nullable=True, index=True)
    
    # Who tagged them
    tagged_by_id = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True)
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    tagged_user = relationship('Profile', foreign_keys=[tagged_user_id])
    tagged_by = relationship('Profile', foreign_keys=[tagged_by_id])
    post = relationship('Post')
    gallery_item = relationship('GalleryItem')



class UserMedia(Base):
    """User's personal media collection (separate from photographer galleries)"""
    __tablename__ = 'user_media'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Media info
    media_url = Column(String(500), nullable=False)
    media_type = Column(String(20), default='image')  # 'image' or 'video'
    thumbnail_url = Column(String(500), nullable=True)
    
    # Source tracking
    source_type = Column(String(30), default='user_upload')  # 'user_upload' or 'photographer_transfer'
    source_photographer_id = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True)
    source_gallery_item_id = Column(String(36), ForeignKey('gallery_items.id', ondelete='SET NULL'), nullable=True)
    
    # Metadata
    title = Column(String(255), nullable=True)
    description = Column(Text, nullable=True)
    
    # Video metadata (for user uploads, capped at 1080p)
    video_width = Column(Integer, nullable=True)
    video_height = Column(Integer, nullable=True)
    video_duration = Column(Float, nullable=True)
    was_transcoded = Column(Boolean, default=False)
    
    # If transferred from photographer, preserve original resolution
    original_width = Column(Integer, nullable=True)
    original_height = Column(Integer, nullable=True)
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    
    user = relationship('Profile', foreign_keys=[user_id], backref='user_media')
    source_photographer = relationship('Profile', foreign_keys=[source_photographer_id])
    source_gallery_item = relationship('GalleryItem')


class LiveSessionParticipant(Base):
    """
    Unified Participant Model for CaptureSession.
    
    Participant Roles:
    - 'participant': Regular surfer being photographed
    - 'grom_buyer': Grom Parent acting as buyer on behalf of their child
    
    Grom Parent Logic:
    - Grom Parents CAN participate (buy photos, join sessions)
    - They CANNOT create sessions (that's handled in go_live permission check)
    """
    __tablename__ = 'live_session_participants'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    photographer_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    surfer_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    spot_id = Column(String(36), ForeignKey('surf_spots.id', ondelete='SET NULL'), nullable=True)
    live_session_id = Column(String(36), ForeignKey('live_sessions.id', ondelete='SET NULL'), nullable=True, index=True)
    selfie_url = Column(Text, nullable=True)  # Surfer's selfie for identification (base64 can be large)
    amount_paid = Column(Float, default=0.0)
    payment_method = Column(String(50), nullable=True)  # 'credits', 'card', 'subscription'
    status = Column(String(50), default='active')  # active, completed, cancelled
    joined_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    completed_at = Column(DateTime(timezone=True), nullable=True)
    
    # ============ CAPTURE SESSION UNIFIED FIELDS ============
    # Participant role in the session context
    participant_role = Column(String(30), default='participant')  # 'participant', 'grom_buyer'
    
    # Photos credit: Track how many "free" photos participant has from their buy-in
    photos_credit_remaining = Column(Integer, default=0)
    videos_credit_remaining = Column(Integer, default=0)
    
    # Resolution preference: What resolution tier the participant prefers
    resolution_preference = Column(String(20), default='standard')  # 'web', 'standard', 'high'
    
    # ============ LOCKED PRICING (Captures rates at join time) ============
    # These fields lock the pricing the surfer agreed to when joining the session
    # Used for gallery checkout to ensure On-Demand rates persist even if photographer changes settings
    locked_price_web = Column(Float, nullable=True)      # Web resolution price at join time
    locked_price_standard = Column(Float, nullable=True) # Standard resolution price at join time
    locked_price_high = Column(Float, nullable=True)     # High resolution price at join time
    
    # Grom Parent support: When a parent purchases on behalf of their Grom child
    parent_buyer_id = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True)
    
    # ============ REVENUE STREAM TRACKING ============
    # Revenue stream categorization for Unified Earnings Dashboard
    revenue_stream = Column(String(30), default='live_session')  # 'live_session', 'request_pro', 'regular_booking', 'gallery_sale'
    
    # Split Booking Tracking
    is_split_payment = Column(Boolean, default=False)  # True if this was part of a split booking
    split_group_id = Column(String(36), nullable=True)  # Groups multiple surfers who split a session
    split_contribution = Column(Float, nullable=True)  # Individual's contribution in a split
    total_split_amount = Column(Float, nullable=True)  # Total session cost being split
    split_participants_count = Column(Integer, nullable=True)  # How many surfers split this session
    
    # ============ PHOTOGRAPHER NOTES (For surfer identification) ============
    # Photographers can add quick notes to help identify surfers in photos
    photographer_notes = Column(Text, nullable=True)  # e.g., "Red fins, goofy stance, staying near pier"
    
    photographer = relationship('Profile', foreign_keys=[photographer_id], backref='session_participants_as_photographer')
    surfer = relationship('Profile', foreign_keys=[surfer_id], backref='session_participations')
    parent_buyer = relationship('Profile', foreign_keys=[parent_buyer_id], backref='grom_session_purchases')
    spot = relationship('SurfSpot')


class Conversation(Base):
    """Direct message conversations between two users"""
    __tablename__ = 'conversations'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    participant_one_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    participant_two_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Instagram-style inbox logic
    # 'primary' = accepted conversation (follows or replied)
    # 'request' = message request (from non-follower, not yet accepted)
    status_for_one = Column(String(20), default='primary')  # primary, request, hidden
    status_for_two = Column(String(20), default='request')  # primary, request, hidden
    
    # Conversation controls per participant
    is_pinned_for_one = Column(Boolean, default=False)
    is_pinned_for_two = Column(Boolean, default=False)
    is_muted_for_one = Column(Boolean, default=False)
    is_muted_for_two = Column(Boolean, default=False)
    is_unread_for_one = Column(Boolean, default=False)  # Manually marked as unread
    is_unread_for_two = Column(Boolean, default=False)
    
    last_message_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    last_message_preview = Column(String(200), nullable=True)
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    participant_one = relationship('Profile', foreign_keys=[participant_one_id], backref='conversations_as_one')
    participant_two = relationship('Profile', foreign_keys=[participant_two_id], backref='conversations_as_two')
    messages = relationship('Message', back_populates='conversation', cascade='all, delete-orphan', order_by='Message.created_at')


class Message(Base):
    """Individual messages within a conversation"""
    __tablename__ = 'messages'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    conversation_id = Column(String(36), ForeignKey('conversations.id', ondelete='CASCADE'), nullable=False, index=True)
    sender_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    content = Column(Text, nullable=False)
    message_type = Column(String(20), default='text')  # text, image, video, voice_note, session_invite
    is_read = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    
    # Rich Media Support
    media_url = Column(String(500), nullable=True)  # URL to photo/video/voice note
    media_thumbnail_url = Column(String(500), nullable=True)  # Thumbnail for videos
    
    # Threaded Replies
    reply_to_id = Column(String(36), ForeignKey('messages.id', ondelete='SET NULL'), nullable=True)
    
    # Voice Note Metadata
    voice_duration_seconds = Column(Integer, nullable=True)
    
    conversation = relationship('Conversation', back_populates='messages')
    sender = relationship('Profile', backref='sent_messages')
    reply_to = relationship('Message', remote_side=[id], backref='replies')


class Follow(Base):
    """Follow relationships between users"""
    __tablename__ = 'follows'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    follower_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    following_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    follower = relationship('Profile', foreign_keys=[follower_id], backref='following_relations')
    following = relationship('Profile', foreign_keys=[following_id], backref='follower_relations')


class Notification(Base):
    """User notifications"""
    __tablename__ = 'notifications'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    type = Column(String(50), nullable=False, index=True)  # session_join, new_message, new_follower, etc.
    title = Column(String(255), nullable=False)
    body = Column(Text, nullable=True)
    data = Column(Text, nullable=True)  # JSON string with additional data
    is_read = Column(Boolean, default=False, index=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    
    user = relationship('Profile', backref='notifications')


class CheckIn(Base):
    """Daily check-ins at surf spots for streak tracking"""
    __tablename__ = 'check_ins'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    spot_id = Column(String(36), ForeignKey('surf_spots.id', ondelete='SET NULL'), nullable=True, index=True)
    spot_name = Column(String(255), nullable=True)  # Denormalized for quick access
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    notes = Column(Text, nullable=True)
    conditions = Column(String(100), nullable=True)  # e.g., "Clean", "Choppy", "Glassy"
    wave_height = Column(String(50), nullable=True)  # e.g., "2-3ft", "4-6ft"
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    
    user = relationship('Profile', backref='check_ins')
    spot = relationship('SurfSpot', backref='check_ins')


class UserStreak(Base):
    """Tracks user surf streaks"""
    __tablename__ = 'user_streaks'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, unique=True, index=True)
    current_streak = Column(Integer, default=0)
    longest_streak = Column(Integer, default=0)
    last_check_in_date = Column(DateTime(timezone=True), nullable=True)  # Date only, no time
    total_check_ins = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    
    user = relationship('Profile', backref='streak')


class SurfReport(Base):
    """User-generated surf condition reports"""
    __tablename__ = 'surf_reports'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    spot_id = Column(String(36), ForeignKey('surf_spots.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Conditions
    wave_height = Column(String(50), nullable=True)  # e.g., "2-3ft", "4-6ft"
    conditions = Column(String(100), nullable=True)  # Glassy, Clean, Choppy, Messy, Blown Out
    wind_direction = Column(String(50), nullable=True)  # Offshore, Onshore, Cross-shore
    crowd_level = Column(String(50), nullable=True)  # Empty, Light, Moderate, Packed
    water_temp = Column(String(50), nullable=True)  # e.g., "72°F", "Cold", "Warm"
    
    # Tide info
    tide_height = Column(String(50), nullable=True)  # e.g., "3.2ft"
    tide_status = Column(String(50), nullable=True)  # Rising, Falling, High, Low
    
    # Report content
    notes = Column(Text, nullable=True)
    rating = Column(Integer, nullable=True)  # 1-5 stars
    photo_url = Column(String(500), nullable=True)
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    
    user = relationship('Profile', backref='surf_reports')
    spot = relationship('SurfSpot', backref='surf_reports')


class SurfAlert(Base):
    """User surf condition alerts"""
    __tablename__ = 'surf_alerts'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    spot_id = Column(String(36), ForeignKey('surf_spots.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Alert conditions
    min_wave_height = Column(Float, nullable=True)  # Minimum wave height in feet
    max_wave_height = Column(Float, nullable=True)  # Maximum wave height in feet
    preferred_conditions = Column(JSON, nullable=True)  # Array: ["glassy", "offshore", "hollow", etc.]
    time_windows = Column(JSON, nullable=True)  # Array: ["dawn", "morning", "afternoon", "evening"]
    tide_states = Column(JSON, nullable=True)   # Array: ["low", "mid", "high", "rising", "falling"]
    
    # Alert settings
    is_active = Column(Boolean, default=True)
    notify_push = Column(Boolean, default=True)
    notify_email = Column(Boolean, default=False)
    
    # Tracking
    last_triggered = Column(DateTime(timezone=True), nullable=True)
    trigger_count = Column(Integer, default=0)
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    user = relationship('Profile', backref='surf_alerts')
    spot = relationship('SurfSpot', backref='surf_alerts')


class PushSubscription(Base):
    """Web push notification subscriptions"""
    __tablename__ = 'push_subscriptions'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Push subscription data
    endpoint = Column(Text, nullable=False)
    p256dh_key = Column(String(255), nullable=False)
    auth_key = Column(String(255), nullable=False)
    
    # Device info
    user_agent = Column(String(500), nullable=True)
    
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    user = relationship('Profile', backref='push_subscriptions')


class NotificationPreferences(Base):
    """User notification preferences for push/email notifications"""
    __tablename__ = 'notification_preferences'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, unique=True, index=True)
    
    # Push notification toggles
    push_messages = Column(Boolean, default=True)  # New messages
    push_reactions = Column(Boolean, default=True)  # Post reactions (Shaka, Fire, etc.)
    push_follows = Column(Boolean, default=True)  # New followers
    push_mentions = Column(Boolean, default=True)  # @mentions in posts/comments
    push_dispatch = Column(Boolean, default=True)  # Photographer dispatch alerts
    push_bookings = Column(Boolean, default=True)  # Booking confirmations
    push_payments = Column(Boolean, default=True)  # Payment notifications
    push_marketing = Column(Boolean, default=False)  # Marketing/promo (opt-in)
    
    # NEW: Sound & Haptics
    sound_enabled = Column(Boolean, default=True)  # Notification sounds
    vibration_enabled = Column(Boolean, default=True)  # Vibration for notifications
    
    # NEW: Digest Mode
    digest_enabled = Column(Boolean, default=False)  # Batch notifications
    digest_frequency = Column(String(20), default='daily')  # hourly, daily, weekly
    
    # Email notification toggles
    email_messages = Column(Boolean, default=False)  # Email for messages (opt-in)
    email_digest = Column(Boolean, default=True)  # Weekly digest
    email_bookings = Column(Boolean, default=True)  # Booking confirmations
    email_payments = Column(Boolean, default=True)  # Payment receipts
    
    # Quiet hours (don't send push during these times)
    quiet_hours_enabled = Column(Boolean, default=False)
    quiet_hours_start = Column(String(5), default="22:00")  # HH:MM format
    quiet_hours_end = Column(String(5), default="07:00")
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    
    user = relationship('Profile', backref='notification_prefs_rel')


class PhotographerRequestStatusEnum(enum.Enum):
    """Status for photographer coverage requests"""
    PENDING = "pending"
    ACCEPTED = "accepted"
    DECLINED = "declined"
    EXPIRED = "expired"
    CANCELLED = "cancelled"


class PhotographerRequest(Base):
    """Requests from surfers for photographer coverage at a spot"""
    __tablename__ = 'photographer_requests'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    # Who is requesting
    requester_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Which spot
    spot_id = Column(String(36), ForeignKey('surf_spots.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Request details
    urgency = Column(String(20), default='flexible')  # 'now', 'today', 'flexible'
    preferred_time = Column(String(50), nullable=True)  # e.g., "Dawn Patrol", "Morning", "Sunset"
    duration_hours = Column(Float, default=2.0)
    notes = Column(Text, nullable=True)
    max_budget = Column(Float, nullable=True)  # Optional budget cap
    
    # Status tracking
    status = Column(Enum(PhotographerRequestStatusEnum), default=PhotographerRequestStatusEnum.PENDING, index=True)
    
    # Response tracking
    accepted_by_id = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True)
    response_note = Column(Text, nullable=True)
    
    # Counts
    notified_count = Column(Integer, default=0)  # How many photographers were notified
    view_count = Column(Integer, default=0)  # How many photographers viewed
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    expires_at = Column(DateTime(timezone=True), nullable=True)  # When request expires
    responded_at = Column(DateTime(timezone=True), nullable=True)
    
    # Relationships
    requester = relationship('Profile', foreign_keys=[requester_id], backref='photographer_requests_made')
    accepted_by = relationship('Profile', foreign_keys=[accepted_by_id], backref='photographer_requests_accepted')
    spot = relationship('SurfSpot', backref='photographer_requests')
    
    __table_args__ = (
        Index('idx_photographer_requests_status_created', 'status', 'created_at'),
    )


class Story(Base):
    """Stories - ephemeral content from photographers and surfers"""
    __tablename__ = 'stories'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    author_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    spot_id = Column(String(36), ForeignKey('surf_spots.id', ondelete='SET NULL'), nullable=True, index=True)
    
    # Content
    media_url = Column(String(500), nullable=False)  # Image or video URL
    media_type = Column(String(20), default='image')  # 'image' or 'video'
    caption = Column(Text, nullable=True)
    
    # Story type - differentiate photographers from surfers
    story_type = Column(String(20), default='surf')  # 'photographer' (live report) or 'surf' (surfer story)
    
    # Location info (for photographer stories)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    location_name = Column(String(255), nullable=True)  # Spot name or custom location
    
    # Linked to live session (for photographer stories)
    is_live_report = Column(Boolean, default=False)  # True if posted during active shooting
    
    # Engagement
    view_count = Column(Integer, default=0)
    
    # Stories expire after 24 hours
    expires_at = Column(DateTime(timezone=True), nullable=False)
    is_expired = Column(Boolean, default=False)
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    
    author = relationship('Profile', backref='stories')
    spot = relationship('SurfSpot', backref='stories')
    views = relationship('StoryView', back_populates='story', cascade='all, delete-orphan')


class StoryView(Base):
    """Tracks who has viewed a story"""
    __tablename__ = 'story_views'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    story_id = Column(String(36), ForeignKey('stories.id', ondelete='CASCADE'), nullable=False, index=True)
    viewer_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    viewed_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    story = relationship('Story', back_populates='views')
    viewer = relationship('Profile', backref='story_views')


class GalleryItem(Base):
    """Photographer gallery items with SmugMug-style quality tiers"""
    __tablename__ = 'gallery_items'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    photographer_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    gallery_id = Column(String(36), ForeignKey('galleries.id', ondelete='SET NULL'), nullable=True, index=True)  # Parent gallery
    spot_id = Column(String(36), ForeignKey('surf_spots.id', ondelete='SET NULL'), nullable=True, index=True)
    session_id = Column(String(36), nullable=True)  # Legacy - Linked to a live session
    
    # Media URLs for different quality levels
    original_url = Column(String(500), nullable=False)  # High-res original (4K for photos, 4K for videos)
    preview_url = Column(String(500), nullable=False)   # Watermarked preview
    thumbnail_url = Column(String(500), nullable=True)  # Small thumbnail
    
    # Additional quality URLs (generated on upload)
    url_web = Column(String(500), nullable=True)        # 800px web quality
    url_standard = Column(String(500), nullable=True)   # 1920px standard
    url_720p = Column(String(500), nullable=True)       # 720p video
    url_1080p = Column(String(500), nullable=True)      # 1080p video
    
    media_type = Column(String(20), default='image')  # 'image' or 'video'
    
    # Video metadata (for 4K videos from paid photographers)
    video_width = Column(Integer, nullable=True)
    video_height = Column(Integer, nullable=True)
    video_duration = Column(Float, nullable=True)
    
    # Photo metadata
    photo_width = Column(Integer, nullable=True)
    photo_height = Column(Integer, nullable=True)
    
    # Metadata
    title = Column(String(255), nullable=True)
    description = Column(Text, nullable=True)
    tags = Column(Text, nullable=True)  # JSON array of tags
    
    # ============ DYNAMIC PRICING ENGINE ============
    # Custom price: Manual override set by photographer for premium shots
    # If set, this takes priority over ALL other pricing logic
    custom_price = Column(Float, nullable=True)  # Fixed price override for this specific item
    
    # Default pricing (uses gallery or photographer's settings if not set)
    price = Column(Float, default=5.0)  # Legacy - base price in credits
    price_web = Column(Float, nullable=True)       # Override for web quality
    price_standard = Column(Float, nullable=True)  # Override for standard
    price_high = Column(Float, nullable=True)      # Override for high res
    price_720p = Column(Float, nullable=True)      # Override for 720p video
    price_1080p = Column(Float, nullable=True)     # Override for 1080p video
    price_4k = Column(Float, nullable=True)        # Override for 4K video
    
    # ============ SESSION ORIGIN PRICING (Locks price at upload) ============
    # These fields ensure a surfer's gallery checkout prices match what they agreed to
    # at the time of session join, even if photographer changes rates later
    session_origin_mode = Column(String(30), nullable=True)  # 'live_join', 'on_demand', 'scheduled', null=gallery upload
    locked_price_web = Column(Float, nullable=True)          # Price for web quality locked at session time
    locked_price_standard = Column(Float, nullable=True)     # Price for standard locked at session time  
    locked_price_high = Column(Float, nullable=True)         # Price for high-res locked at session time
    
    is_for_sale = Column(Boolean, default=True)
    
    # Stats
    view_count = Column(Integer, default=0)
    purchase_count = Column(Integer, default=0)
    
    # Surfer tagging
    tagged_surfer_ids = Column(Text, nullable=True)  # JSON array of surfer IDs
    
    # Status
    is_public = Column(Boolean, default=True)
    is_featured = Column(Boolean, default=False)
    
    # Soft-delete: When photographer "deletes" an item that surfers have paid for,
    # we hide it from photographer's gallery but keep media alive for paid locker items
    is_deleted = Column(Boolean, default=False)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    shot_at = Column(DateTime(timezone=True), nullable=True)  # When the photo was taken
    
    photographer = relationship('Profile', backref='gallery_items')
    gallery = relationship('Gallery', back_populates='items')
    spot = relationship('SurfSpot', backref='gallery_items')


class GalleryPurchase(Base):
    """Tracks gallery item purchases with quality tier"""
    __tablename__ = 'gallery_purchases'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    gallery_item_id = Column(String(36), ForeignKey('gallery_items.id', ondelete='CASCADE'), nullable=False, index=True)
    buyer_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    photographer_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False)
    
    amount_paid = Column(Float, nullable=False)
    payment_method = Column(String(20), default='credits')  # 'credits' or 'stripe'
    
    # Quality tier purchased
    quality_tier = Column(String(20), default='standard')  # 'web', 'standard', 'high', '720p', '1080p', '4k'
    
    # Download tracking
    download_count = Column(Integer, default=0)
    max_downloads = Column(Integer, default=5)
    
    purchased_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    gallery_item = relationship('GalleryItem', backref='purchases')
    buyer = relationship('Profile', foreign_keys=[buyer_id], backref='gallery_purchases')


class PhotoTag(Base):
    """Tracks surfer tags on photos with viewing/claiming status"""
    __tablename__ = 'photo_tags'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    gallery_item_id = Column(String(36), ForeignKey('gallery_items.id', ondelete='CASCADE'), nullable=False, index=True)
    surfer_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    photographer_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    live_session_id = Column(String(36), ForeignKey('live_sessions.id', ondelete='SET NULL'), nullable=True, index=True)
    
    # Was surfer a participant in the live session?
    was_session_participant = Column(Boolean, default=False)
    
    # Pricing context at time of tagging
    session_photo_price = Column(Float, nullable=True)  # Price from live session (0 = no extra charge)
    
    # Access status
    access_granted = Column(Boolean, default=False)  # True if no extra charge or purchased
    is_gift = Column(Boolean, default=False)  # Photographer explicitly gifted this
    
    # Tracking timestamps
    tagged_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    viewed_at = Column(DateTime(timezone=True), nullable=True)  # First time surfer viewed it
    claimed_at = Column(DateTime(timezone=True), nullable=True)  # When added to their collection
    
    # Relationships
    gallery_item = relationship('GalleryItem', backref='photo_tags')
    surfer = relationship('Profile', foreign_keys=[surfer_id], backref='tagged_photos')
    photographer = relationship('Profile', foreign_keys=[photographer_id])
    live_session = relationship('LiveSession', backref='photo_tags')



# ============ SURFER GALLERY SYSTEM ============
# "My Gallery" / "The Locker" - Surfer's private media collection

class GalleryTierEnum(enum.Enum):
    """Service-to-Gallery tier mapping based on booking type"""
    STANDARD = "standard"      # On-Demand/Standard: 1080p max, watermarked until paid
    PRO = "pro"                # Scheduled/Pro: Full RAW/4K/Original resolution


class SurferGalleryItem(Base):
    """
    Surfer's personal gallery item - "The Locker"
    Each item links a surfer to a photographer's gallery item with service-tier restrictions
    """
    __tablename__ = 'surfer_gallery_items'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    surfer_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    gallery_item_id = Column(String(36), ForeignKey('gallery_items.id', ondelete='CASCADE'), nullable=False, index=True)
    photographer_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Source context - what booking/session this came from
    booking_id = Column(String(36), ForeignKey('bookings.id', ondelete='SET NULL'), nullable=True, index=True)
    live_session_id = Column(String(36), ForeignKey('live_sessions.id', ondelete='SET NULL'), nullable=True, index=True)
    
    # ============ SERVICE-TO-GALLERY TIER MAPPING ============
    # The service type at booking determines gallery features
    service_type = Column(String(30), default='standard')  # 'on_demand', 'scheduled', 'live_join'
    gallery_tier = Column(Enum(GalleryTierEnum), default=GalleryTierEnum.STANDARD)  # Locked by service type
    
    # Quality access - what resolutions this surfer can download
    # Standard tier: max 1080p/Social | Pro tier: Full RAW/4K
    max_photo_quality = Column(String(20), default='standard')  # 'web', 'standard', 'high'
    max_video_quality = Column(String(20), default='1080p')     # '720p', '1080p', '4k'
    
    # ============ PAYMENT & ACCESS STATUS ============
    # Watermarked until paid (for Standard tier)
    is_paid = Column(Boolean, default=False)
    paid_amount = Column(Float, default=0.0)
    paid_at = Column(DateTime(timezone=True), nullable=True)
    payment_method = Column(String(30), nullable=True)  # 'credits', 'stripe', 'crew_split', 'included'
    
    # Access granted via different methods
    # 'pending' = Not yet paid/selected
    # 'pending_selection' = Session has included photos, surfer must select which ones to claim
    # 'purchased' = Surfer paid for this item
    # 'included' = Part of the session's included photo allocation (surfer selected it)
    # 'gifted' = Photographer gifted this item
    # 'crew_split' = Paid via crew split arrangement
    access_type = Column(String(30), default='pending')
    
    # ============ INCLUDED PHOTOS SELECTION TRACKING ============
    # For sessions with "included photos" (e.g., $100 session + 5 free photos)
    # Surfers must select which photos they want before the rest are paywalled
    selection_eligible = Column(Boolean, default=False)  # True if part of "included photos" pool
    selection_deadline = Column(DateTime(timezone=True), nullable=True)  # When selection window closes
    
    # Crew split tracking (media held until crew payment requirements met)
    crew_split_pending = Column(Boolean, default=False)  # True if waiting for crew payment
    crew_split_resolved_at = Column(DateTime(timezone=True), nullable=True)
    
    # ============ VISIBILITY CONTROLS ("The Locker" Logic) ============
    # Private by default - toggling to Public mirrors to public Sessions Tab
    is_public = Column(Boolean, default=False)  # False = Private Locker, True = Public Sessions Tab
    is_favorite = Column(Boolean, default=False)  # Surfer's favorite items
    visibility_changed_at = Column(DateTime(timezone=True), nullable=True)
    
    # ============ AI LINEUP MATCH METADATA ============
    # AI-suggested tag (surfer can confirm/reject)
    ai_suggested = Column(Boolean, default=False)  # True if AI matched this surfer
    ai_confidence = Column(Float, nullable=True)   # 0-1 confidence score
    ai_match_method = Column(String(50), nullable=True)  # 'face_match', 'board_color', 'wetsuit', 'manual'
    surfer_confirmed = Column(Boolean, default=False)  # True if surfer confirmed the AI suggestion
    surfer_rejected = Column(Boolean, default=False)   # True if surfer rejected the suggestion
    
    # ============ SESSION METADATA (from Passport sync) ============
    # These sync to surfer's Passport regardless of tier
    session_date = Column(DateTime(timezone=True), nullable=True)
    spot_name = Column(String(255), nullable=True)
    spot_id = Column(String(36), ForeignKey('surf_spots.id', ondelete='SET NULL'), nullable=True)
    
    # Surgical Peak conditions at time of shot
    wind_direction = Column(String(20), nullable=True)
    wind_speed = Column(Float, nullable=True)
    swell_height = Column(Float, nullable=True)
    swell_period = Column(Float, nullable=True)
    swell_direction = Column(String(20), nullable=True)
    tide_height = Column(Float, nullable=True)
    
    # ============ PRESERVED MEDIA URLs ============
    # When a photographer deletes a GalleryItem, these URLs are baked in
    # so surfers never lose access to media they've paid for
    preserved_original_url = Column(String(500), nullable=True)
    preserved_preview_url = Column(String(500), nullable=True)
    preserved_thumbnail_url = Column(String(500), nullable=True)
    preserved_media_type = Column(String(20), nullable=True)
    
    # Timestamps
    added_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    viewed_at = Column(DateTime(timezone=True), nullable=True)
    downloaded_at = Column(DateTime(timezone=True), nullable=True)
    download_count = Column(Integer, default=0)
    
    # Relationships
    surfer = relationship('Profile', foreign_keys=[surfer_id], backref='surfer_gallery_items')
    gallery_item = relationship('GalleryItem', backref='surfer_items')
    photographer = relationship('Profile', foreign_keys=[photographer_id])
    booking = relationship('Booking', backref='gallery_items_for_surfers')
    live_session = relationship('LiveSession', backref='surfer_gallery_items')
    spot = relationship('SurfSpot')
    
    # Unique constraint - one surfer can only have one instance of each gallery item
    __table_args__ = (
        Index('ix_surfer_gallery_unique', 'surfer_id', 'gallery_item_id', unique=True),
    )


class SurferGalleryClaimQueue(Base):
    """
    AI "Review & Claim" queue - pending items for surfer to review
    AI cross-references surfer's Passport (board color, wetsuit, profile photo) to suggest tags
    """
    __tablename__ = 'surfer_gallery_claim_queue'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    surfer_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    gallery_item_id = Column(String(36), ForeignKey('gallery_items.id', ondelete='CASCADE'), nullable=False, index=True)
    photographer_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False)
    
    # AI analysis results
    ai_confidence = Column(Float, nullable=False)  # 0-1 confidence this is the surfer
    ai_match_reasons = Column(Text, nullable=True)  # JSON: ["board_color_match", "wetsuit_pattern", "face_detected"]
    
    # Passport data used for matching
    passport_board_color = Column(String(50), nullable=True)
    passport_wetsuit_color = Column(String(50), nullable=True)
    
    # Session context
    live_session_id = Column(String(36), ForeignKey('live_sessions.id', ondelete='SET NULL'), nullable=True)
    booking_id = Column(String(36), ForeignKey('bookings.id', ondelete='SET NULL'), nullable=True)
    
    # Status
    status = Column(String(30), default='pending')  # 'pending', 'claimed', 'rejected', 'expired'
    claimed_at = Column(DateTime(timezone=True), nullable=True)
    rejected_at = Column(DateTime(timezone=True), nullable=True)
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    expires_at = Column(DateTime(timezone=True), nullable=True)  # Auto-expire after 7 days
    
    # Relationships
    surfer = relationship('Profile', foreign_keys=[surfer_id])
    gallery_item = relationship('GalleryItem')
    photographer = relationship('Profile', foreign_keys=[photographer_id])
    live_session = relationship('LiveSession')
    booking = relationship('Booking')


class SurferSelectionQuota(Base):
    """
    Tracks "Included Photos" selection quotas per surfer per session.
    When a photographer sets a session price that includes X photos,
    each surfer gets a quota to select their favorites from the uploaded burst.
    """
    __tablename__ = 'surfer_selection_quotas'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    surfer_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    photographer_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False)
    
    # Session context (one of these should be set)
    booking_id = Column(String(36), ForeignKey('bookings.id', ondelete='CASCADE'), nullable=True, index=True)
    live_session_id = Column(String(36), ForeignKey('live_sessions.id', ondelete='CASCADE'), nullable=True, index=True)
    gallery_id = Column(String(36), ForeignKey('galleries.id', ondelete='CASCADE'), nullable=True, index=True)
    
    # Selection quota
    photos_allowed = Column(Integer, nullable=False)  # How many photos surfer can select for free
    photos_selected = Column(Integer, default=0)      # How many they've selected so far
    videos_allowed = Column(Integer, default=0)       # Videos included (if any)
    videos_selected = Column(Integer, default=0)
    
    # Status
    status = Column(String(30), default='pending_selection')  # 'pending_selection', 'selections_complete', 'expired'
    selection_deadline = Column(DateTime(timezone=True), nullable=True)  # 10 days to select (industry standard)
    
    # Expiration behavior (surfer choice)
    # None = not yet chosen, True = auto-select best rated, False = forfeit remaining
    auto_select_on_expiry = Column(Boolean, nullable=True)
    expiry_reminder_sent = Column(Boolean, default=False)  # 3-day warning sent
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    completed_at = Column(DateTime(timezone=True), nullable=True)  # When surfer finished selecting
    
    # Relationships
    surfer = relationship('Profile', foreign_keys=[surfer_id])
    photographer = relationship('Profile', foreign_keys=[photographer_id])
    booking = relationship('Booking')
    live_session = relationship('LiveSession')
    gallery = relationship('Gallery')
    
    __table_args__ = (
        # One quota per surfer per session
        Index('ix_selection_quota_booking', 'surfer_id', 'booking_id', unique=True),
        Index('ix_selection_quota_session', 'surfer_id', 'live_session_id', unique=True),
    )


class AnalyticsEvent(Base):
    """Company analytics tracking"""
    __tablename__ = 'analytics_events'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    event_type = Column(String(50), nullable=False, index=True)  # 'photo_tagged', 'photo_viewed', 'photo_claimed', etc.
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True, index=True)
    
    # Event context
    entity_type = Column(String(50), nullable=True)  # 'gallery_item', 'live_session', 'booking', etc.
    entity_id = Column(String(36), nullable=True)
    
    # Additional data
    event_data = Column(Text, nullable=True)  # JSON with event-specific data
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    
    user = relationship('Profile', backref='analytics_events')


class AdminLog(Base):
    """Admin action logging"""
    __tablename__ = 'admin_logs'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    admin_id = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True, index=True)
    action = Column(String(50), nullable=False)  # 'suspend_user', 'verify_user', 'delete_post', etc.
    target_type = Column(String(50), nullable=False)  # 'user', 'post', 'gallery_item', etc.
    target_id = Column(String(36), nullable=True)
    details = Column(Text, nullable=True)  # JSON with action details
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    
    admin = relationship('Profile', backref='admin_logs')


class SessionModeEnum(enum.Enum):
    """Session mode for unified CaptureSession model"""
    LIVE_JOIN = "live_join"      # Mode A: Live session at spot
    ON_DEMAND = "on_demand"      # Mode B: On-Demand photographer request
    SCHEDULED = "scheduled"      # Mode C: Pre-scheduled booking


class LiveSession(Base):
    """
    Unified CaptureSession Core - Tracks all photographer sessions.
    
    Roles:
    - Creator (Photographer): The one capturing media
    - Participant (Surfer/Buyer): Those being photographed or purchasing
    
    Modes:
    - LIVE_JOIN: Entry Fee + Resolution-based photo price
    - ON_DEMAND: Booking Fee + Resolution-based photo price
    - SCHEDULED: Standard Resolution-based pricing
    """
    __tablename__ = 'live_sessions'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    photographer_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    surf_spot_id = Column(String(36), ForeignKey('surf_spots.id', ondelete='SET NULL'), nullable=True, index=True)
    
    # ============ UNIFIED SESSION MODE ============
    session_mode = Column(String(30), default='live_join')  # 'live_join', 'on_demand', 'scheduled'
    
    # Cross-reference to originating request/booking
    dispatch_request_id = Column(String(36), ForeignKey('dispatch_requests.id', ondelete='SET NULL'), nullable=True)
    booking_id = Column(String(36), ForeignKey('bookings.id', ondelete='SET NULL'), nullable=True)
    
    # Session details
    status = Column(String(20), default='active')  # 'active', 'ended', 'cancelled'
    location_name = Column(String(255), nullable=True)  # Display name (from spot or custom)
    
    # Pricing (inherited from photographer settings at session start)
    buyin_price = Column(Float, default=25.0)
    photo_price = Column(Float, default=5.0)
    
    # ============ DYNAMIC PRICING ENGINE - Session-specific prices ============
    # These prices apply to photos/videos taken DURING this session
    # If set, they override the photographer's general gallery pricing for session content
    session_photo_price = Column(Float, nullable=True)  # Photo price for this session's content
    session_video_price = Column(Float, nullable=True)  # Video price for this session's content
    
    # Resolution-based pricing for this session (all workflows)
    session_price_web = Column(Float, nullable=True)       # Web-res (social media optimized)
    session_price_standard = Column(Float, nullable=True)  # Standard digital delivery
    session_price_high = Column(Float, nullable=True)      # High-res (print quality)
    
    # Live Session Rates (for Live Savings display)
    photos_included = Column(Integer, default=3)        # Photos included in buy-in
    videos_included = Column(Integer, default=1)        # Videos included in buy-in
    general_photo_price = Column(Float, nullable=True)  # Photographer's general gallery price (for comparison)
    max_surfers = Column(Integer, default=10)           # Max capacity for session
    estimated_duration_hours = Column(Integer, nullable=True)  # Estimated session length
    
    # Hobbyist Earnings Destination (per-session override)
    # Allows hobbyists to pick where THIS session's earnings go
    earnings_destination_type = Column(String(30), nullable=True)  # 'grom', 'cause', 'surfer', 'gear'
    earnings_destination_id = Column(String(36), nullable=True)  # Profile ID or Gear Item ID
    earnings_cause_name = Column(String(255), nullable=True)  # If donating to a cause
    
    # Stats
    participant_count = Column(Integer, default=0)
    total_earnings = Column(Float, default=0.0)
    
    # Timing
    started_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    ended_at = Column(DateTime(timezone=True), nullable=True)
    duration_mins = Column(Integer, nullable=True)
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    photographer = relationship('Profile', backref='live_sessions_hosted')
    surf_spot = relationship('SurfSpot', backref='live_sessions')
    gallery = relationship('Gallery', back_populates='live_session', uselist=False)


class Gallery(Base):
    """A gallery (collection of items) created after a live session or manually"""
    __tablename__ = 'galleries'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    photographer_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    live_session_id = Column(String(36), ForeignKey('live_sessions.id', ondelete='SET NULL'), nullable=True, index=True)
    surf_spot_id = Column(String(36), ForeignKey('surf_spots.id', ondelete='SET NULL'), nullable=True, index=True)
    
    # Session reference fields for different session types
    booking_id = Column(String(36), ForeignKey('bookings.id', ondelete='SET NULL'), nullable=True, index=True)
    dispatch_id = Column(String(36), ForeignKey('dispatch_requests.id', ondelete='SET NULL'), nullable=True, index=True)
    session_type = Column(String(30), nullable=True)  # 'live', 'on_demand', 'booking', 'manual'
    
    # Gallery info
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    cover_image_url = Column(String(500), nullable=True)
    
    # Gallery-specific pricing (overrides photographer defaults)
    price_web = Column(Float, nullable=True)
    price_standard = Column(Float, nullable=True)
    price_high = Column(Float, nullable=True)
    price_720p = Column(Float, nullable=True)
    price_1080p = Column(Float, nullable=True)
    price_4k = Column(Float, nullable=True)
    
    # Locked prices at session time (for participant checkout)
    locked_price_web = Column(Float, nullable=True)
    locked_price_standard = Column(Float, nullable=True)
    locked_price_high = Column(Float, nullable=True)
    
    # Default tier for gallery
    default_tier = Column(Enum(GalleryTierEnum), default=GalleryTierEnum.STANDARD)
    
    # Stats
    item_count = Column(Integer, default=0)
    view_count = Column(Integer, default=0)
    purchase_count = Column(Integer, default=0)
    
    # Status
    is_public = Column(Boolean, default=True)
    is_featured = Column(Boolean, default=False)
    is_for_sale = Column(Boolean, default=True)
    
    # Photographer settings for this gallery
    show_watermark_in_selection = Column(Boolean, default=True)  # Whether selection preview shows watermark
    
    # Session date (from live session)
    session_date = Column(DateTime(timezone=True), nullable=True)
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    
    photographer = relationship('Profile', backref='galleries')
    live_session = relationship('LiveSession', back_populates='gallery')
    surf_spot = relationship('SurfSpot', backref='galleries')
    items = relationship('GalleryItem', back_populates='gallery', cascade='all, delete-orphan')


# ============ GEAR HUB AFFILIATE ENGINE ============

class GearCategory(enum.Enum):
    CAMERA = 'camera'
    LENS = 'lens'
    HOUSING = 'housing'
    DRONE = 'drone'
    ACCESSORIES = 'accessories'
    SURFBOARD = 'surfboard'
    WETSUIT = 'wetsuit'
    SURF_ACCESSORIES = 'surf_accessories'


class GearCatalog(Base):
    """Curated gear catalog for affiliate purchases (Hobbyists use Gear Credits here)"""
    __tablename__ = 'gear_catalog'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    # Product info
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    image_url = Column(String(500), nullable=True)
    category = Column(Enum(GearCategory), nullable=False)
    brand = Column(String(100), nullable=True)
    
    # Pricing
    price_credits = Column(Float, nullable=False)  # Price in Gear Credits
    retail_price_usd = Column(Float, nullable=True)  # For display
    
    # Affiliate links (B&H, Adorama, etc.)
    affiliate_partner = Column(String(50), nullable=False)  # 'bh', 'adorama', 'amazon'
    affiliate_url = Column(String(1000), nullable=False)
    affiliate_commission_rate = Column(Float, default=0.05)  # Platform's commission (5%)
    
    # Status
    is_active = Column(Boolean, default=True)
    is_featured = Column(Boolean, default=False)
    stock_status = Column(String(30), default='in_stock')  # 'in_stock', 'low_stock', 'out_of_stock'
    
    # Stats
    purchase_count = Column(Integer, default=0)
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class GearPurchase(Base):
    """Tracks gear purchases made with Gear Credits"""
    __tablename__ = 'gear_purchases'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    gear_item_id = Column(String(36), ForeignKey('gear_catalog.id', ondelete='SET NULL'), nullable=True, index=True)
    
    # Purchase details
    credits_spent = Column(Float, nullable=False)
    affiliate_url_used = Column(String(1000), nullable=True)
    affiliate_partner = Column(String(50), nullable=True)
    
    # Status
    status = Column(String(30), default='pending')  # 'pending', 'clicked', 'completed'
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    user = relationship('Profile', backref='gear_purchases')
    gear_item = relationship('GearCatalog', backref='purchases')


# ============ SPONSORSHIP & IMPACT DONATIONS ============

class SponsorshipType(enum.Enum):
    PRO_SPONSORSHIP = 'pro_sponsorship'  # From Pro photographer
    IMPACT_DONATION = 'impact_donation'  # From Hobbyist


class SponsorshipTransaction(Base):
    """Tracks donations/sponsorships from photographers to Groms/Causes"""
    __tablename__ = 'sponsorship_transactions'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    # Participants
    donor_id = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True, index=True)
    recipient_id = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True, index=True)
    
    # Transaction details
    amount = Column(Float, nullable=False)
    platform_fee = Column(Float, nullable=False)  # 5% for grom, 10% for surfer
    net_amount = Column(Float, nullable=False)  # Amount recipient gets
    
    # Type info
    sponsorship_type = Column(Enum(SponsorshipType), nullable=False)
    recipient_type = Column(String(30), nullable=False)  # 'grom', 'cause', 'surfer'
    cause_name = Column(String(255), nullable=True)  # If recipient_type is 'cause'
    
    # Source transaction (where the money came from)
    source_transaction_type = Column(String(50), nullable=True)  # 'live_session', 'gallery_sale', etc.
    source_transaction_id = Column(String(36), nullable=True)
    
    # Status
    status = Column(String(30), default='completed')
    shaka_sent = Column(Boolean, default=False)  # Whether recipient sent Shaka back
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    
    donor = relationship('Profile', foreign_keys=[donor_id], backref='sponsorships_given')
    recipient = relationship('Profile', foreign_keys=[recipient_id], backref='sponsorships_received')


# ============ SHAKA FEEDBACK SYSTEM ============

class ShakaMessage(Base):
    """Thank you 'Shaka' messages sent in response to sponsorships"""
    __tablename__ = 'shaka_messages'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    # Participants
    sender_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    recipient_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    sponsorship_id = Column(String(36), ForeignKey('sponsorship_transactions.id', ondelete='SET NULL'), nullable=True)
    
    # Message content
    message_type = Column(String(30), default='animation')  # 'animation', 'video', 'text'
    message_text = Column(Text, nullable=True)
    video_url = Column(String(500), nullable=True)  # If recorded video
    animation_id = Column(String(50), nullable=True)  # Pre-made animation ID
    
    # Visibility
    is_public = Column(Boolean, default=True)  # Posted to feed if True
    post_id = Column(String(36), ForeignKey('posts.id', ondelete='SET NULL'), nullable=True)  # Link to feed post
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    sender = relationship('Profile', foreign_keys=[sender_id], backref='shakas_sent')
    recipient = relationship('Profile', foreign_keys=[recipient_id], backref='shakas_received')
    sponsorship = relationship('SponsorshipTransaction', backref='shaka_response')




# ============ VERIFIED CAUSES ============

class VerifiedCause(Base):
    """Pre-defined verified causes for donations"""
    __tablename__ = 'verified_causes'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    # Cause info
    name = Column(String(255), nullable=False, unique=True)
    description = Column(Text, nullable=True)
    logo_url = Column(String(500), nullable=True)
    website_url = Column(String(500), nullable=True)
    
    # Category
    category = Column(String(50), nullable=False)  # 'ocean_conservation', 'youth_surfing', 'environmental', 'community'
    
    # Status
    is_active = Column(Boolean, default=True)
    is_featured = Column(Boolean, default=False)
    
    # Stats
    total_donations = Column(Float, default=0.0)
    donor_count = Column(Integer, default=0)
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


# ============ INSTANT SHAKA VIDEO ============

class InstantShakaVideo(Base):
    """5-second thank you videos from Groms to sponsors"""
    __tablename__ = 'instant_shaka_videos'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    # Participants
    sender_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    recipient_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    sponsorship_id = Column(String(36), ForeignKey('sponsorship_transactions.id', ondelete='SET NULL'), nullable=True)
    
    # Video content
    video_url = Column(String(500), nullable=False)
    thumbnail_url = Column(String(500), nullable=True)
    duration_seconds = Column(Float, default=5.0)  # Max 5 seconds
    
    # Status
    is_viewed = Column(Boolean, default=False)
    viewed_at = Column(DateTime(timezone=True), nullable=True)
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


# ============ IMPACT LEDGER (for Leaderboard) ============

class ImpactLedger(Base):
    """Tracks every credit a photographer directs to a Grom or Cause for leaderboard ranking"""
    __tablename__ = 'impact_ledger'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    # Donor (photographer)
    photographer_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Recipient
    recipient_type = Column(String(20), nullable=False)  # 'grom', 'cause', 'surfer'
    recipient_id = Column(String(36), nullable=True)  # Profile ID for grom/surfer
    cause_name = Column(String(255), nullable=True)  # For cause donations
    
    # Amount
    amount = Column(Float, nullable=False)
    
    # Source
    source_type = Column(String(50), nullable=False)  # 'live_session', 'gallery_sale', 'booking'
    source_id = Column(String(36), nullable=True)
    
    # Period tracking (for monthly reset)
    month = Column(Integer, nullable=False)  # 1-12
    year = Column(Integer, nullable=False)
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    photographer = relationship('Profile', foreign_keys=[photographer_id])


class LeaderboardSnapshot(Base):
    """Monthly archives of leaderboard data"""
    __tablename__ = 'leaderboard_snapshots'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    photographer_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Period
    month = Column(Integer, nullable=False)
    year = Column(Integer, nullable=False)
    
    # Stats for this period
    monthly_total = Column(Float, default=0.0)
    rank = Column(Integer, nullable=True)  # Final rank for the month
    
    # Badge earned
    earned_grom_guardian = Column(Boolean, default=False)  # Was in top 10
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    photographer = relationship('Profile', foreign_keys=[photographer_id])



# ============ CHALLENGE MODE ============

class WeeklyChallenge(Base):
    """Weekly challenge competitions for photographers"""
    __tablename__ = 'weekly_challenges'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    # Challenge period
    week_number = Column(Integer, nullable=False)  # ISO week number (1-52)
    year = Column(Integer, nullable=False)
    
    # Challenge type
    challenge_type = Column(String(50), default='grom_support')  # 'grom_support', 'cause_support', 'total_impact'
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    
    # Prize/Badge
    badge_name = Column(String(100), default='Weekly Champion')
    badge_emoji = Column(String(10), default='🏆')
    
    # Status
    status = Column(String(20), default='active')  # 'upcoming', 'active', 'completed'
    
    # Timing
    starts_at = Column(DateTime(timezone=True), nullable=False)
    ends_at = Column(DateTime(timezone=True), nullable=False)
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class ChallengeParticipant(Base):
    """Tracks photographer participation in weekly challenges"""
    __tablename__ = 'challenge_participants'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    challenge_id = Column(String(36), ForeignKey('weekly_challenges.id', ondelete='CASCADE'), nullable=False, index=True)
    photographer_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Score for this challenge
    score = Column(Float, default=0.0)  # Credits given during challenge period
    groms_supported = Column(Integer, default=0)
    
    # Final rank (set when challenge ends)
    final_rank = Column(Integer, nullable=True)
    earned_trophy = Column(Boolean, default=False)  # Top 3 get trophy
    
    # Tracking
    last_contribution_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    challenge = relationship('WeeklyChallenge', backref='participants')
    photographer = relationship('Profile', foreign_keys=[photographer_id])


# ============ SOCIAL PROXIMITY - FRIENDS ============

class FriendshipStatusEnum(enum.Enum):
    PENDING = "pending"
    ACCEPTED = "accepted"
    BLOCKED = "blocked"


class Friend(Base):
    """Two-way friend relationships"""
    __tablename__ = 'friends'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    # The user who sent the request
    requester_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # The user who received the request
    addressee_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Status
    status = Column(Enum(FriendshipStatusEnum), default=FriendshipStatusEnum.PENDING, index=True)
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    accepted_at = Column(DateTime(timezone=True), nullable=True)
    
    requester = relationship('Profile', foreign_keys=[requester_id])
    addressee = relationship('Profile', foreign_keys=[addressee_id])
    
    __table_args__ = (
        Index('ix_friends_pair', 'requester_id', 'addressee_id', unique=True),
    )


class PrivacySetting(Base):
    """User privacy settings for location sharing"""
    __tablename__ = 'privacy_settings'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, unique=True, index=True)
    
    # Map visibility: 'public', 'friends', 'none'
    map_visibility = Column(String(20), default='friends')
    
    # Ghost mode - completely hide from map
    is_ghost_mode = Column(Boolean, default=False)
    
    # Proximity pings - allow friends to ping you
    allow_proximity_pings = Column(Boolean, default=True)
    
    # Online status visibility
    show_online_status = Column(Boolean, default=True)
    
    # Last seen visibility
    show_last_seen = Column(Boolean, default=True)
    
    # GPS coordinates (updated when app is open)
    gps_latitude = Column(Float, nullable=True)
    gps_longitude = Column(Float, nullable=True)
    gps_updated_at = Column(DateTime(timezone=True), nullable=True)
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    
    user = relationship('Profile')


# ============ MESSENGER 2.0 EXTENSIONS ============
# (Extends existing Conversation and Message tables)

class ConversationParticipant(Base):
    """Participants in a group conversation (for group chats)"""
    __tablename__ = 'conversation_participants'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    conversation_id = Column(String(36), ForeignKey('conversations.id', ondelete='CASCADE'), nullable=False, index=True)
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Role in group (for groups)
    role = Column(String(20), default='member')  # 'admin', 'member'
    
    # Notification settings
    is_muted = Column(Boolean, default=False)
    muted_until = Column(DateTime(timezone=True), nullable=True)
    
    # Read status
    last_read_at = Column(DateTime(timezone=True), nullable=True)
    unread_count = Column(Integer, default=0)
    
    # Timestamps
    joined_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    left_at = Column(DateTime(timezone=True), nullable=True)
    
    user = relationship('Profile')
    
    __table_args__ = (
        Index('ix_conv_participants_pair', 'conversation_id', 'user_id', unique=True),
    )


class MessageReaction(Base):
    """Emoji reactions to messages"""
    __tablename__ = 'message_reactions'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    message_id = Column(String(36), ForeignKey('messages.id', ondelete='CASCADE'), nullable=False, index=True)
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Emoji reaction
    emoji = Column(String(10), nullable=False)  # Unicode emoji
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    user = relationship('Profile')
    
    __table_args__ = (
        Index('ix_msg_reactions_pair', 'message_id', 'user_id', 'emoji', unique=True),
    )


class MessageReadReceipt(Base):
    """Read receipts for messages"""
    __tablename__ = 'message_read_receipts'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    message_id = Column(String(36), ForeignKey('messages.id', ondelete='CASCADE'), nullable=False, index=True)
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    read_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    user = relationship('Profile')
    
    __table_args__ = (
        Index('ix_msg_read_pair', 'message_id', 'user_id', unique=True),
    )


class TypingIndicator(Base):
    """Typing status (ephemeral - clean up old records)"""
    __tablename__ = 'typing_indicators'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    conversation_id = Column(String(36), ForeignKey('conversations.id', ondelete='CASCADE'), nullable=False, index=True)
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    started_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    __table_args__ = (
        Index('ix_typing_pair', 'conversation_id', 'user_id', unique=True),
    )


class VoiceNote(Base):
    """Voice note attachments for messages"""
    __tablename__ = 'voice_notes'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    message_id = Column(String(36), ForeignKey('messages.id', ondelete='CASCADE'), nullable=False, unique=True, index=True)
    
    # Supabase storage URL
    audio_url = Column(String(500), nullable=False)
    duration_seconds = Column(Integer, nullable=False)
    waveform_data = Column(Text, nullable=True)  # JSON array of amplitude values
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))



# ============ TWO-WAY REVIEW SYSTEM ============

class ReviewStatusEnum(enum.Enum):
    PENDING = "pending"       # Awaiting moderation
    APPROVED = "approved"     # Visible to public
    REJECTED = "rejected"     # Flagged by AI/admin
    HIDDEN = "hidden"         # Hidden by user request

class Review(Base):
    """Two-way review system for photographers and surfers — supports all session types"""
    __tablename__ = 'reviews'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    # Review direction
    reviewer_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    reviewee_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    review_type = Column(String(30), nullable=False)  # 'surfer_to_photographer', 'photographer_to_surfer'
    
    # Session type this review is for
    session_type = Column(String(20), nullable=True)  # 'live', 'on_demand', 'scheduled'
    
    # Link to session — supports all 3 session types
    live_session_id = Column(String(36), ForeignKey('live_sessions.id', ondelete='SET NULL'), nullable=True, index=True)
    booking_id = Column(String(36), nullable=True, index=True)      # For scheduled bookings
    dispatch_id = Column(String(36), nullable=True, index=True)     # For on-demand dispatch sessions
    
    # Review window: 14 days after session ends
    review_window_expires_at = Column(DateTime(timezone=True), nullable=True)
    
    # Review content
    rating = Column(Integer, nullable=False)  # 1-5 stars
    comment = Column(Text, nullable=True)
    
    # Specific rating categories
    punctuality_rating = Column(Integer, nullable=True)  # 1-5
    communication_rating = Column(Integer, nullable=True)  # 1-5
    photo_quality_rating = Column(Integer, nullable=True)  # 1-5 (surfer rates photographer's photos)
    
    # Moderation
    status = Column(String(20), default='pending')  # pending, approved, rejected, hidden
    moderation_notes = Column(Text, nullable=True)  # AI or admin notes
    flagged_words = Column(Text, nullable=True)  # JSON array of flagged words
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    
    # Relationships
    reviewer = relationship('Profile', foreign_keys=[reviewer_id], backref='reviews_given')
    reviewee = relationship('Profile', foreign_keys=[reviewee_id], backref='reviews_received')
    
    __table_args__ = (
        # Prevent duplicate reviews — uses composite of all session ID columns
        Index('ix_review_unique_v2', 'reviewer_id', 'reviewee_id', 'live_session_id', 'booking_id', 'dispatch_id', unique=True),
    )


# ============ GAMIFICATION ENGINE ============

class BadgeTypeEnum(enum.Enum):
    THE_PATRON = "the_patron"           # Hobbyist/Parent funding sessions
    THE_WORKHORSE = "the_workhorse"     # Pro with consistent sessions
    THE_SHARPSHOOTER = "the_sharpshooter"  # High gallery conversion
    THE_BENEFACTOR = "the_benefactor"   # Total contribution milestones

class Badge(Base):
    """Gamification badges for users"""
    __tablename__ = 'badges'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    badge_type = Column(String(50), nullable=False)  # the_patron, the_workhorse, etc.
    tier = Column(String(20), default='bronze')  # bronze, silver, gold, platinum
    
    # Progress tracking
    xp_earned = Column(Integer, default=0)
    xp_threshold = Column(Integer, nullable=True)  # XP needed for next tier
    
    # Specific metrics
    sessions_funded = Column(Integer, default=0)  # For patron
    sessions_completed = Column(Integer, default=0)  # For workhorse
    conversion_rate = Column(Float, nullable=True)  # For sharpshooter
    total_contributed = Column(Float, default=0.0)  # For benefactor
    
    earned_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    
    user = relationship('Profile', backref='earned_badges')
    
    __table_args__ = (
        Index('ix_badge_user_type', 'user_id', 'badge_type', unique=True),
    )


class XPTransaction(Base):
    """Track XP gains for gamification"""
    __tablename__ = 'xp_transactions'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    amount = Column(Integer, nullable=False)  # XP amount
    reason = Column(String(100), nullable=False)  # 'session_buyin', 'photo_purchase', 'review_given', etc.
    reference_type = Column(String(50), nullable=True)  # 'live_session', 'gallery_purchase', 'review'
    reference_id = Column(String(36), nullable=True)
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    
    user = relationship('Profile', backref='xp_transactions')



# ============ CAREER HUB MODELS ============

class CompetitionResult(Base):
    """Track competition results for surfers (manual entry + future API sync)"""
    __tablename__ = 'competition_results'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    surfer_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Event Details
    event_name = Column(String(255), nullable=False)
    event_date = Column(Date, nullable=False)
    event_location = Column(String(255), nullable=True)
    event_tier = Column(String(50), nullable=True)  # 'WSL_CT', 'WSL_QS', 'Regional', 'Local', 'Grom_Series'
    
    # Results
    placing = Column(Integer, nullable=False)  # 1st, 2nd, 3rd, etc.
    total_competitors = Column(Integer, nullable=True)
    heat_wins = Column(Integer, default=0)
    avg_wave_score = Column(Float, nullable=True)
    best_wave_score = Column(Float, nullable=True)
    season_points_earned = Column(Integer, default=0)
    
    # Verification - using String to match database VARCHAR column
    verification_status = Column(String(50), default='pending')  # 'pending', 'community_verified', 'api_synced', 'rejected'
    proof_image_url = Column(String(500), nullable=True)  # Photo of trophy/bracket for manual entry
    verified_by = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True)
    verified_at = Column(DateTime(timezone=True), nullable=True)
    
    # API Sync (for future LiveHeats/WSL integration)
    external_event_id = Column(String(100), nullable=True)  # ID from LiveHeats or WSL
    external_source = Column(String(50), nullable=True)  # 'liveheats', 'wsl', 'manual'
    last_synced_at = Column(DateTime(timezone=True), nullable=True)
    
    # XP awarded for this result
    xp_awarded = Column(Integer, default=0)
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    
    surfer = relationship('Profile', foreign_keys=[surfer_id], backref='competition_results')
    verifier = relationship('Profile', foreign_keys=[verified_by])


class Sponsorship(Base):
    """Track sponsorships for surfers (Brands for Pros, Stoke Sponsors for Groms)"""
    __tablename__ = 'sponsorships'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    surfer_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Sponsor Details
    sponsor_name = Column(String(255), nullable=False)
    sponsor_type = Column(String(50), nullable=False)  # 'brand', 'local_shop', 'parent', 'stoke_sponsor'
    sponsor_logo_url = Column(String(500), nullable=True)
    sponsor_website = Column(String(255), nullable=True)
    
    # For brands with Business persona on platform
    sponsor_profile_id = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True)
    
    # Sponsorship Details
    sponsorship_tier = Column(String(50), nullable=True)  # 'title', 'major', 'supporting', 'stoke'
    start_date = Column(Date, nullable=True)
    end_date = Column(Date, nullable=True)
    is_active = Column(Boolean, default=True)
    
    # Auto-Pay feature (Brand can auto-pay session fees)
    auto_pay_enabled = Column(Boolean, default=False)
    auto_pay_limit_per_month = Column(Float, nullable=True)
    auto_pay_used_this_month = Column(Float, default=0.0)
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    
    surfer = relationship('Profile', foreign_keys=[surfer_id], backref='sponsorships')
    sponsor_profile = relationship('Profile', foreign_keys=[sponsor_profile_id])


class GoldPassBooking(Base):
    """Track Gold-Pass exclusive booking windows for Pro-Elite surfers"""
    __tablename__ = 'gold_pass_bookings'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    photographer_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Time slot details
    slot_start = Column(DateTime(timezone=True), nullable=False)
    slot_end = Column(DateTime(timezone=True), nullable=False)
    
    # Gold-Pass window (2-hour exclusive access for Pro-Elite)
    gold_pass_expires_at = Column(DateTime(timezone=True), nullable=False)
    is_gold_pass_active = Column(Boolean, default=True)
    
    # Booking status
    booked_by = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True)
    booked_at = Column(DateTime(timezone=True), nullable=True)
    was_gold_pass_booking = Column(Boolean, default=False)  # True if booked during gold window
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    photographer = relationship('Profile', foreign_keys=[photographer_id])
    booker = relationship('Profile', foreign_keys=[booked_by])



class ConditionReport(Base):
    """Professional condition reports from photographers - feeds into Conditions Explorer"""
    __tablename__ = 'condition_reports'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    photographer_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    spot_id = Column(String(36), ForeignKey('surf_spots.id', ondelete='SET NULL'), nullable=True, index=True)
    
    # Content
    media_url = Column(String(500), nullable=False)
    media_type = Column(String(20), default='image')  # 'image' or 'video'
    thumbnail_url = Column(String(500), nullable=True)
    caption = Column(Text, nullable=True)
    
    # Conditions data
    wave_height_ft = Column(Float, nullable=True)
    conditions_label = Column(String(50), nullable=True)  # "Head High", "Chest High", etc.
    wind_conditions = Column(String(50), nullable=True)  # "Offshore", "Onshore", "Glass"
    crowd_level = Column(String(20), nullable=True)  # "Empty", "Light", "Moderate", "Crowded"
    
    # Location info
    spot_name = Column(String(255), nullable=True)
    region = Column(String(100), nullable=True, index=True)  # For regional filtering
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    
    # Link to related content
    story_id = Column(String(36), ForeignKey('stories.id', ondelete='SET NULL'), nullable=True)
    post_id = Column(String(36), ForeignKey('posts.id', ondelete='SET NULL'), nullable=True)
    live_session_id = Column(String(36), ForeignKey('live_sessions.id', ondelete='SET NULL'), nullable=True)
    
    # Engagement & status
    view_count = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)  # False when photographer ends session
    
    # 24-hour expiration (like stories)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    is_expired = Column(Boolean, default=False)
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    
    photographer = relationship('Profile', backref='condition_reports')
    spot = relationship('SurfSpot', backref='condition_reports')
    story = relationship('Story', backref='condition_reports')
    post = relationship('Post', backref='condition_reports')
    live_session = relationship('LiveSession', backref='condition_reports')


class SocialLiveStream(Base):
    """Social Go Live broadcasts - separate from Active Duty (commerce)"""
    __tablename__ = 'social_live_streams'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    broadcaster_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Stream metadata
    title = Column(String(255), nullable=True)
    stream_url = Column(String(500), nullable=True)  # HLS playback URL from Mux
    thumbnail_url = Column(String(500), nullable=True)
    
    # Mux integration
    mux_stream_id = Column(String(100), nullable=True)  # Mux live stream ID
    mux_playback_id = Column(String(100), nullable=True)  # Mux playback ID
    
    # Status
    status = Column(String(20), default='live')  # 'live', 'ended', 'archived'
    viewer_count = Column(Integer, default=0)
    peak_viewers = Column(Integer, default=0)
    
    # Location
    spot_id = Column(String(36), ForeignKey('surf_spots.id', ondelete='SET NULL'), nullable=True)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    location_name = Column(String(255), nullable=True)
    
    # Archive
    archive_url = Column(String(500), nullable=True)  # Saved VOD after stream ends
    duration_seconds = Column(Integer, default=0)
    
    started_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    ended_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    broadcaster = relationship('Profile', backref='social_live_streams')
    spot = relationship('SurfSpot', backref='social_live_streams')




class GlobalPricingConfig(Base):
    """
    Global Pricing Configuration - Single Source of Truth
    Admin-editable pricing grid for all roles and tiers
    """
    __tablename__ = 'global_pricing_config'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    # The pricing data stored as JSON
    # Structure: { "surfer": {...}, "grom": {...}, "photographer": {...}, "grom_parent": {...}, "hobbyist": {...} }
    pricing_data = Column(JSON, nullable=False)
    
    # Metadata
    version = Column(Integer, default=1)  # Increment on each update
    updated_by = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    # Only one active config at a time
    is_active = Column(Boolean, default=True)
    
    updater = relationship('Profile', backref='pricing_updates')



class SavedCrew(Base):
    """
    Saved Crew Presets - Quick-start feature for Pro/Comp surfers
    Allows users to save their frequent surf buddies for instant crew selection
    """
    __tablename__ = 'saved_crews'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    owner_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Preset metadata
    name = Column(String(100), nullable=False)  # e.g., "Dawn Patrol Crew", "Competition Squad"
    is_default = Column(Boolean, default=False)  # Auto-load this crew for On-Demand sessions
    
    # Crew members stored as JSON array
    # Structure: [{"user_id": "...", "name": "...", "email": "...", "avatar_url": "..."}, ...]
    members = Column(JSON, nullable=False, default=list)
    
    # Usage tracking
    times_used = Column(Integer, default=0)
    last_used_at = Column(DateTime(timezone=True), nullable=True)
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    owner = relationship('Profile', backref='saved_crews')



# ============================================================
# CREW CHAT - BOOKING-LINKED MESSAGING
# ============================================================

class CrewChatMessage(Base):
    """
    Crew Chat Messages - Real-time messaging linked to bookings.
    Allows Captains, Crew members, and Photographers to coordinate
    gear, meeting spots, and session details before a shoot.
    """
    __tablename__ = 'crew_chat_messages'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    booking_id = Column(String(36), ForeignKey('bookings.id', ondelete='CASCADE'), nullable=False, index=True)
    sender_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Message content
    content = Column(Text, nullable=False)
    message_type = Column(String(20), default='text')  # 'text', 'image', 'voice', 'system'
    
    # Media attachment (optional)
    media_url = Column(String(500), nullable=True)
    media_thumbnail_url = Column(String(500), nullable=True)
    
    # Voice note metadata
    voice_duration_seconds = Column(Integer, nullable=True)
    
    # System message data (for auto-generated messages)
    # e.g., "Sarah paid their share" or "Session confirmed!"
    system_data = Column(JSON, nullable=True)
    
    # Read tracking per participant (JSON: {"user_id": timestamp, ...})
    read_by = Column(JSON, default=dict)
    
    # Reactions (JSON: {"emoji": ["user_id1", "user_id2"], ...})
    reactions = Column(JSON, default=dict)
    
    # Threaded replies
    reply_to_id = Column(String(36), ForeignKey('crew_chat_messages.id', ondelete='SET NULL'), nullable=True)
    
    # @Mentions (JSON array: [{"user_id": "...", "username": "...", "start": 0, "end": 10}, ...])
    mentions = Column(JSON, default=list)
    
    # Soft delete
    is_deleted = Column(Boolean, default=False)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    
    # Relationships
    booking = relationship('Booking', backref='chat_messages')
    sender = relationship('Profile', backref='crew_chat_messages')


# ============================================================
# CREW LEADERBOARD - STATS & BADGES
# ============================================================

class CrewBadgeTypeEnum(enum.Enum):
    """Badge types for crew achievements"""
    # Frequency Badges
    FREQUENT_FLYERS = "frequent_flyers"        # 10+ sessions together
    DAWN_PATROL = "dawn_patrol"                # 5+ sunrise sessions
    SUNSET_CREW = "sunset_crew"                # 5+ evening sessions
    WEEKEND_WARRIORS = "weekend_warriors"      # 10+ weekend sessions
    
    # Size Badges
    SQUAD_GOALS = "squad_goals"                # 5+ person crew
    DYNAMIC_DUO = "dynamic_duo"                # Regular 2-person crew
    WOLF_PACK = "wolf_pack"                    # 4+ person crew 5+ times
    
    # Loyalty Badges
    RIDE_OR_DIE = "ride_or_die"                # Same crew 10+ times
    VARIETY_PACK = "variety_pack"             # Surfed with 20+ different people
    LOCAL_LEGENDS = "local_legends"            # Same spot 10+ times together
    
    # Savings Badges
    SMART_SPLITTERS = "smart_splitters"        # Saved $500+ via splits
    BUDGET_BOSSES = "budget_bosses"            # Saved $1000+ via splits


class CrewStats(Base):
    """
    Crew Statistics - Tracks metrics for crew leaderboard
    Represents a unique pair/group of surfers who session together
    """
    __tablename__ = 'crew_stats'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    # Crew identification - sorted user IDs to ensure uniqueness
    # For pairs: "user_id_1,user_id_2" (alphabetically sorted)
    # For groups: stored in members_hash for efficiency
    crew_hash = Column(String(128), unique=True, nullable=False, index=True)
    
    # Member list (JSON array of user_ids)
    member_ids = Column(JSON, nullable=False, default=list)
    crew_size = Column(Integer, default=2)
    
    # Crew name (optional, user-defined)
    name = Column(String(100), nullable=True)
    
    # Privacy setting
    is_public = Column(Boolean, default=True)  # Configurable per crew
    
    # Core metrics
    total_sessions = Column(Integer, default=0)
    total_waves_caught = Column(Integer, default=0)
    total_money_saved = Column(Float, default=0.0)
    total_photos_shared = Column(Integer, default=0)
    
    # Time-based metrics
    sunrise_sessions = Column(Integer, default=0)      # Sessions before 8 AM
    sunset_sessions = Column(Integer, default=0)       # Sessions after 5 PM
    weekend_sessions = Column(Integer, default=0)      # Saturday/Sunday sessions
    
    # Spot tracking (JSON: {"spot_id": count, ...})
    spot_frequency = Column(JSON, default=dict)
    favorite_spot_id = Column(String(36), nullable=True)
    
    # Streak tracking
    current_streak = Column(Integer, default=0)        # Consecutive weeks surfing together
    longest_streak = Column(Integer, default=0)
    
    # Timestamps
    first_session_at = Column(DateTime(timezone=True), nullable=True)
    last_session_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class CrewBadge(Base):
    """
    Crew Badges - Achievements earned by crews
    """
    __tablename__ = 'crew_badges'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    crew_stats_id = Column(String(36), ForeignKey('crew_stats.id', ondelete='CASCADE'), nullable=False, index=True)
    
    badge_type = Column(Enum(CrewBadgeTypeEnum), nullable=False)
    
    # Badge metadata
    tier = Column(Integer, default=1)  # Bronze=1, Silver=2, Gold=3
    progress = Column(Integer, default=0)  # Current progress toward next tier
    target = Column(Integer, default=0)    # Target for next tier
    
    earned_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    # Relationship
    crew_stats = relationship('CrewStats', backref='badges')


class UserCrewStats(Base):
    """
    Individual user's crew statistics - for profile display
    """
    __tablename__ = 'user_crew_stats'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, unique=True, index=True)
    
    # Aggregate stats
    total_crew_sessions = Column(Integer, default=0)
    total_unique_buddies = Column(Integer, default=0)
    total_saved_via_splits = Column(Float, default=0.0)
    
    # Personal badges earned (JSON array)
    badges_earned = Column(JSON, default=list)
    
    # Favorite crew (most sessions with)
    favorite_crew_hash = Column(String(128), nullable=True)
    favorite_buddy_id = Column(String(36), nullable=True)
    
    # Timestamps
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    # Relationship
    user = relationship('Profile', backref='crew_stats_summary')



class PlatformMetrics(Base):
    """
    Cached platform metrics for fast Admin Dashboard loading.
    Computed every 6 hours by background scheduler.
    """
    __tablename__ = 'platform_metrics'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    metric_type = Column(String(50), nullable=False, index=True)  # 'platform_overview', 'financial', 'ecosystem'
    data = Column(JSON, nullable=False)  # Aggregated metrics JSON
    computed_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)


class PlatformSettings(Base):
    """
    Platform-wide settings and feature flags.
    Admin-editable configuration for app behavior.
    """
    __tablename__ = 'platform_settings'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    # Site Access Control
    access_code_enabled = Column(Boolean, default=False)  # Enable access code gate
    access_code = Column(String(50), default='SURF2024')  # The access code
    
    # Feature Flags
    show_lineup_cards_in_feed = Column(Boolean, default=True)  # Show session lineup cards in feed
    show_session_logs_in_feed = Column(Boolean, default=True)  # Show session log posts in feed
    allow_nearby_crew_invites = Column(Boolean, default=True)  # Allow "Invite Nearby Crew" popup
    
    # Feed Settings
    feed_lineup_card_frequency = Column(Integer, default=5)  # Show lineup card every N posts
    max_lineup_cards_per_feed = Column(Integer, default=3)  # Max lineup cards shown per feed load
    
    # Lineup Settings
    lineup_default_visibility = Column(String(30), default='friends')  # Default: 'friends', 'area', 'both'
    lineup_lock_hours_before = Column(Integer, default=96)  # Hours before session to auto-lock lineup
    lineup_min_crew_default = Column(Integer, default=2)  # Default minimum crew size
    
    # Live Now Settings
    live_nearby_radius_miles = Column(Float, default=10.0)  # Radius for "nearby" crew invites
    
    # Hobbyist Booking Guardrails (admin-adjustable)
    hobbyist_max_bookings_per_week = Column(Integer, default=3)  # Max scheduled bookings per week
    hobbyist_max_hourly_rate = Column(Float, default=40.0)  # Max hourly rate cap ($)
    hobbyist_require_conditions_report = Column(Boolean, default=True)  # Must submit conditions before going active
    hobbyist_booking_auto_confirm = Column(Boolean, default=False)  # False = must manually accept
    
    # Metadata
    updated_by = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))



class AdConfig(Base):
    """
    Ad Configuration - Stores ad variants and settings
    Admin-editable ad configuration for the Self-Serve Ad Engine
    """
    __tablename__ = 'ad_config'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    # The ad config data stored as JSON
    # Structure: { "variants": [...], "frequency": 6, "analytics": {...} }
    config_data = Column(JSON, nullable=False)
    
    # Metadata
    version = Column(Integer, default=1)
    updated_by = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    # Only one active config at a time
    is_active = Column(Boolean, default=True)



# =============================================================================
# SURF PASSPORT - GPS Check-In Gamification System
# =============================================================================

class SurfPassportCheckIn(Base):
    """
    Surf Passport: GPS-verified check-ins at surf spots.
    Users collect virtual stamps for spots they've surfed.
    Requires GPS verification within proximity of spot coordinates.
    """
    __tablename__ = 'surf_passport_checkins'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    spot_id = Column(String(36), ForeignKey('surf_spots.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # GPS Verification
    checkin_latitude = Column(Float, nullable=False)  # User's GPS at check-in
    checkin_longitude = Column(Float, nullable=False)
    distance_from_spot_meters = Column(Float, nullable=False)  # Calculated distance from spot
    is_verified = Column(Boolean, default=False)  # True if within allowed radius
    
    # Check-in details
    checkin_time = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    conditions_label = Column(String(50), nullable=True)  # Wave conditions at check-in (e.g., "Waist High")
    wave_height_ft = Column(Float, nullable=True)  # Recorded wave height
    session_duration_minutes = Column(Integer, nullable=True)  # Optional session length
    notes = Column(Text, nullable=True)  # User notes about the session
    photo_url = Column(String(500), nullable=True)  # Optional session photo
    
    # Achievements
    is_first_visit = Column(Boolean, default=False)  # First time at this spot
    earned_xp = Column(Integer, default=0)  # XP earned from this check-in
    badge_earned = Column(String(100), nullable=True)  # Badge ID if earned
    
    # Country/Region tracking for passport stats
    spot_country = Column(String(100), nullable=True)
    spot_region = Column(String(100), nullable=True)
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    # Relationships
    user = relationship('Profile', backref='passport_checkins')
    spot = relationship('SurfSpot', backref='passport_checkins')
    
    # Indexes for performance
    __table_args__ = (
        Index('idx_passport_user_spot', 'user_id', 'spot_id'),
        Index('idx_passport_user_time', 'user_id', 'checkin_time'),
        Index('idx_passport_country', 'spot_country'),
    )


class SurfPassportStats(Base):
    """
    Aggregated passport statistics per user.
    Updated on each check-in for fast lookups.
    """
    __tablename__ = 'surf_passport_stats'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, unique=True, index=True)
    
    # Total counts
    total_checkins = Column(Integer, default=0)
    unique_spots_visited = Column(Integer, default=0)
    unique_countries_visited = Column(Integer, default=0)
    unique_regions_visited = Column(Integer, default=0)
    
    # Streaks
    current_streak_days = Column(Integer, default=0)
    longest_streak_days = Column(Integer, default=0)
    last_checkin_date = Column(Date, nullable=True)
    
    # Achievements
    total_xp_earned = Column(Integer, default=0)
    badges_earned = Column(Text, nullable=True)  # JSON array of badge IDs
    passport_level = Column(Integer, default=1)  # Level based on total XP
    
    # Country breakdown (JSON: {"USA": 50, "Australia": 10, ...})
    countries_breakdown = Column(Text, nullable=True)
    
    # Featured achievements
    rarest_spot_visited = Column(String(36), nullable=True)  # Spot ID
    most_visited_spot = Column(String(36), nullable=True)  # Spot ID
    most_visited_spot_count = Column(Integer, default=0)
    
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    # Relationships
    user = relationship('Profile', backref='passport_stats')



class UserNote(Base):
    """
    Instagram-style Notes feature
    Short text updates that appear above user avatars in messages
    Notes auto-expire after 24 hours
    """
    __tablename__ = 'user_notes'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Note content (max 60 chars like Instagram)
    content = Column(String(60), nullable=False)
    
    # Optional emoji reaction from viewers
    emoji = Column(String(10), nullable=True)  # Primary emoji for the note
    
    # Visibility
    is_active = Column(Boolean, default=True)  # False if manually deleted
    
    # Engagement
    view_count = Column(Integer, default=0)
    reply_count = Column(Integer, default=0)
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    expires_at = Column(DateTime(timezone=True), nullable=False)  # 24 hours from creation
    
    # Relationships
    user = relationship('Profile', backref='notes')
    
    __table_args__ = (
        Index('idx_user_notes_active', 'user_id', 'is_active'),
        Index('idx_user_notes_expires', 'expires_at'),
    )


class NoteReply(Base):
    """
    Replies to user notes
    Creates a direct message thread when someone replies to a note
    """
    __tablename__ = 'note_replies'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    note_id = Column(String(36), ForeignKey('user_notes.id', ondelete='CASCADE'), nullable=False, index=True)
    replier_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False)
    
    # Reply can be text or just an emoji reaction
    reply_text = Column(String(500), nullable=True)
    reply_emoji = Column(String(10), nullable=True)
    
    # Link to the conversation created by this reply
    conversation_id = Column(String(36), ForeignKey('conversations.id', ondelete='SET NULL'), nullable=True)
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    # Relationships
    note = relationship('UserNote', backref='replies')
    replier = relationship('Profile', backref='note_replies')



class NoteReaction(Base):
    """
    Emoji reactions to notes (like Instagram's note reactions)
    Multiple users can react with different emojis
    """
    __tablename__ = 'note_reactions'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    note_id = Column(String(36), ForeignKey('user_notes.id', ondelete='CASCADE'), nullable=False, index=True)
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False)
    emoji = Column(String(10), nullable=False)  # The emoji reaction
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    # Relationships
    note = relationship('UserNote', backref='reactions')
    user = relationship('Profile', backref='note_reactions_given')
    
    __table_args__ = (
        # One reaction per user per note
        Index('idx_note_reaction_unique', 'note_id', 'user_id', unique=True),
    )


class PhotographerAlertSubscription(Base):
    """Subscription for photographer availability alerts"""
    __tablename__ = 'photographer_alert_subscriptions'
    
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False)
    photographer_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False)
    alert_type = Column(String(30), nullable=False)  # live_shooting, on_demand, scheduled_booking
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    last_notified_at = Column(DateTime(timezone=True), nullable=True)
    
    # Relationships
    user = relationship('Profile', foreign_keys=[user_id], backref='photographer_alert_subscriptions')
    photographer = relationship('Profile', foreign_keys=[photographer_id], backref='alert_subscribers')
    
    __table_args__ = (
        # One subscription per user per photographer per alert type
        Index('idx_photographer_alert_unique', 'user_id', 'photographer_id', 'alert_type', unique=True),
    )


class PostReport(Base):
    """Report a post for policy violation"""
    __tablename__ = 'post_reports'
    
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    post_id = Column(String(36), ForeignKey('posts.id', ondelete='CASCADE'), nullable=False)
    reporter_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False)
    reason = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    status = Column(String(20), default='pending')  # pending, reviewed, dismissed, actioned
    reviewed_by = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    
    # Relationships - use passive_deletes to let DB handle CASCADE
    post = relationship('Post', backref=backref('reports', passive_deletes=True))
    reporter = relationship('Profile', foreign_keys=[reporter_id], backref='reports_submitted')
    reviewer = relationship('Profile', foreign_keys=[reviewed_by], backref='reports_reviewed')


class UserFavorite(Base):
    """User's saved/favorited posts"""
    __tablename__ = 'user_favorites'
    
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False)
    post_id = Column(String(36), ForeignKey('posts.id', ondelete='CASCADE'), nullable=False)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    
    # Relationships - use passive_deletes to let DB handle CASCADE
    user = relationship('Profile', backref='favorites')
    post = relationship('Post', backref=backref('favorited_by', passive_deletes=True))
    
    __table_args__ = (
        Index('idx_user_favorite_unique', 'user_id', 'post_id', unique=True),
    )


class Surfboard(Base):
    """User's surfboard collection - photos, specs, and future marketplace listing"""
    __tablename__ = 'surfboards'
    
    id = Column(String, primary_key=True, default=generate_uuid)
    user_id = Column(String, ForeignKey('profiles.id'), nullable=False)
    
    # Board Details
    name = Column(String(100), nullable=True)  # Custom name for the board
    brand = Column(String(100), nullable=True)  # Shaper/brand name
    model = Column(String(100), nullable=True)  # Model name
    
    # Dimensions
    length_feet = Column(Integer, nullable=True)
    length_inches = Column(Integer, nullable=True)
    width_inches = Column(Float, nullable=True)
    thickness_inches = Column(Float, nullable=True)
    volume_liters = Column(Float, nullable=True)
    
    # Board Type & Construction
    board_type = Column(String(50), nullable=True)  # shortboard, longboard, funboard, fish, gun, etc
    fin_setup = Column(String(50), nullable=True)  # thruster, quad, twin, single, etc
    tail_shape = Column(String(50), nullable=True)  # squash, swallow, round, pin, etc
    construction = Column(String(100), nullable=True)  # PU/Poly, EPS/Epoxy, etc
    
    # Description & Condition
    description = Column(Text, nullable=True)
    condition = Column(String(50), nullable=True)  # mint, good, fair, needs_repair
    year_acquired = Column(Integer, nullable=True)
    purchase_price = Column(Float, nullable=True)
    
    # Photos (up to 5)
    photo_urls = Column(JSON, default=list)  # Array of photo URLs
    primary_photo_index = Column(Integer, default=0)
    
    # Marketplace (for future use)
    is_for_sale = Column(Boolean, default=False)
    sale_price = Column(Float, nullable=True)
    sale_description = Column(Text, nullable=True)
    sale_status = Column(String(20), default='not_listed')  # not_listed, active, pending, sold
    
    # Metadata
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    
    # Relationships
    owner = relationship("Profile", backref=backref("surfboards", lazy="dynamic"))
    
    __table_args__ = (
        Index('idx_surfboard_user', 'user_id'),
        Index('idx_surfboard_for_sale', 'is_for_sale', 'sale_status'),
    )



# ============ P0 ADMIN FEATURES ============

class DisputeStatusEnum(enum.Enum):
    OPEN = "open"
    UNDER_REVIEW = "under_review"
    AWAITING_RESPONSE = "awaiting_response"
    RESOLVED_REFUND = "resolved_refund"
    RESOLVED_NO_ACTION = "resolved_no_action"
    RESOLVED_PARTIAL = "resolved_partial"
    ESCALATED = "escalated"
    CLOSED = "closed"

class DisputeTypeEnum(enum.Enum):
    PAYMENT = "payment"              # Refund requests, billing issues
    SERVICE_QUALITY = "service_quality"  # Blurry photos, incomplete delivery
    NO_SHOW = "no_show"              # Photographer/surfer didn't show up
    HARASSMENT = "harassment"        # Behavioral issues
    FRAUD = "fraud"                  # Fake profiles, scams
    OTHER = "other"

class Dispute(Base):
    """Dispute resolution system for conflicts between users"""
    __tablename__ = 'disputes'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    # Parties involved
    complainant_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    respondent_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Dispute details
    dispute_type = Column(String(30), nullable=False)  # DisputeTypeEnum
    status = Column(String(30), default='open')  # DisputeStatusEnum
    priority = Column(String(20), default='normal')  # low, normal, high, urgent
    
    # Related entities (optional - link to specific transaction)
    booking_id = Column(String(36), ForeignKey('bookings.id', ondelete='SET NULL'), nullable=True)
    live_session_id = Column(String(36), ForeignKey('live_sessions.id', ondelete='SET NULL'), nullable=True)
    gallery_item_id = Column(String(36), nullable=True)
    transaction_id = Column(String(36), ForeignKey('credit_transactions.id', ondelete='SET NULL'), nullable=True)
    
    # Content
    subject = Column(String(200), nullable=False)
    description = Column(Text, nullable=False)
    evidence_urls = Column(JSON, default=list)  # Screenshots, photos as evidence
    
    # Resolution
    amount_disputed = Column(Float, nullable=True)  # Dollar amount in question
    amount_refunded = Column(Float, nullable=True)  # Credit refunded (to account balance)
    amount_stripe_refunded = Column(Float, nullable=True)  # Actual Stripe refund (escalations only)
    resolution_notes = Column(Text, nullable=True)
    resolved_by = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    
    # Auto-created from report?
    source_report_id = Column(String(36), ForeignKey('user_reports.id', ondelete='SET NULL'), nullable=True)
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    
    # Relationships
    complainant = relationship('Profile', foreign_keys=[complainant_id], backref='disputes_filed')
    respondent = relationship('Profile', foreign_keys=[respondent_id], backref='disputes_against')
    resolver = relationship('Profile', foreign_keys=[resolved_by])


class DisputeMessage(Base):
    """Messages within a dispute thread"""
    __tablename__ = 'dispute_messages'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    dispute_id = Column(String(36), ForeignKey('disputes.id', ondelete='CASCADE'), nullable=False, index=True)
    sender_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False)
    
    message = Column(Text, nullable=False)
    attachment_urls = Column(JSON, default=list)
    is_admin = Column(Boolean, default=False)  # True if sent by admin
    is_internal = Column(Boolean, default=False)  # Internal admin notes (not visible to users)
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    # Relationships
    dispute = relationship('Dispute', backref='messages')
    sender = relationship('Profile')


class ReportReasonEnum(enum.Enum):
    SPAM = "spam"
    INAPPROPRIATE_CONTENT = "inappropriate_content"
    HARASSMENT = "harassment"
    FRAUD = "fraud"
    FAKE_PROFILE = "fake_profile"
    COPYRIGHT = "copyright"
    UNDERAGE = "underage"
    DANGEROUS_BEHAVIOR = "dangerous_behavior"
    OTHER = "other"

class ReportStatusEnum(enum.Enum):
    PENDING = "pending"
    UNDER_REVIEW = "under_review"
    ACTION_TAKEN = "action_taken"
    NO_VIOLATION = "no_violation"
    DISMISSED = "dismissed"

class UserReport(Base):
    """User-submitted reports for content and users"""
    __tablename__ = 'user_reports'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    # Reporter
    reporter_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # What's being reported
    report_type = Column(String(20), nullable=False)  # 'user', 'post', 'photo', 'comment', 'message'
    reported_user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=True, index=True)
    reported_content_id = Column(String(36), nullable=True)  # ID of post/photo/comment
    reported_content_type = Column(String(30), nullable=True)  # 'post', 'gallery_item', 'comment', 'message'
    
    # Report details
    reason = Column(String(30), nullable=False)  # ReportReasonEnum
    description = Column(Text, nullable=True)
    evidence_urls = Column(JSON, default=list)
    
    # Status & resolution
    status = Column(String(20), default='pending')  # ReportStatusEnum
    priority = Column(String(20), default='normal')  # low, normal, high, urgent
    
    # Admin handling
    reviewed_by = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    action_taken = Column(String(50), nullable=True)  # 'warning_sent', 'content_removed', 'user_suspended', 'user_banned', 'no_action'
    admin_notes = Column(Text, nullable=True)
    
    # Auto-escalate to dispute?
    escalated_to_dispute = Column(Boolean, default=False)
    dispute_id = Column(String(36), ForeignKey('disputes.id', ondelete='SET NULL'), nullable=True)
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    
    # Relationships
    reporter = relationship('Profile', foreign_keys=[reporter_id], backref='user_reports_submitted')
    reported_user = relationship('Profile', foreign_keys=[reported_user_id], backref='user_reports_received')
    reviewer = relationship('Profile', foreign_keys=[reviewed_by])


class UserBlock(Base):
    """
    User blocking system - when a user blocks another user:
    - Blocked user cannot message the blocker
    - Blocked user cannot see blocker's posts/content
    - Blocked user cannot follow/interact with blocker
    - Mutual blocks prevent all interaction
    
    Integrates with TOS violation system for repeated harassment
    """
    __tablename__ = 'user_blocks'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    # Who is blocking whom
    blocker_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    blocked_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Reason for blocking (optional, helps with TOS integration)
    reason = Column(String(50), nullable=True)  # harassment, spam, inappropriate, scam, other
    notes = Column(Text, nullable=True)  # User's private notes about why they blocked
    
    # Auto-report to admin if block reason is severe
    auto_reported = Column(Boolean, default=False)
    report_id = Column(String(36), ForeignKey('user_reports.id', ondelete='SET NULL'), nullable=True)
    
    # Admin review (for patterns of blocking - user being blocked by many people)
    admin_reviewed = Column(Boolean, default=False)
    admin_notes = Column(Text, nullable=True)
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    
    # Relationships
    blocker = relationship('Profile', foreign_keys=[blocker_id], backref='blocks_created')
    blocked = relationship('Profile', foreign_keys=[blocked_id], backref='blocks_received')
    
    # Unique constraint - can only block someone once
    __table_args__ = (
        Index('ix_user_blocks_blocker_blocked', 'blocker_id', 'blocked_id', unique=True),
    )


class PayoutHoldReasonEnum(enum.Enum):
    DISPUTE_PENDING = "dispute_pending"
    FRAUD_INVESTIGATION = "fraud_investigation"
    CHARGEBACK = "chargeback"
    QUALITY_REVIEW = "quality_review"
    NEW_ACCOUNT = "new_account"  # First 30 days
    MANUAL_REVIEW = "manual_review"
    OTHER = "other"

class PayoutHold(Base):
    """Holds on photographer payouts for fraud protection"""
    __tablename__ = 'payout_holds'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    photographer_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Hold details
    amount = Column(Float, nullable=False)  # Amount being held
    reason = Column(String(30), nullable=False)  # PayoutHoldReasonEnum
    description = Column(Text, nullable=True)
    
    # Related entities
    dispute_id = Column(String(36), ForeignKey('disputes.id', ondelete='SET NULL'), nullable=True)
    transaction_id = Column(String(36), ForeignKey('credit_transactions.id', ondelete='SET NULL'), nullable=True)
    
    # Status
    is_active = Column(Boolean, default=True)
    released_at = Column(DateTime(timezone=True), nullable=True)
    released_by = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True)
    release_notes = Column(Text, nullable=True)
    
    # Auto-release after X days?
    auto_release_date = Column(DateTime(timezone=True), nullable=True)
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    created_by = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True)
    
    # Relationships
    photographer = relationship('Profile', foreign_keys=[photographer_id], backref='payout_holds')
    creator = relationship('Profile', foreign_keys=[created_by])
    releaser = relationship('Profile', foreign_keys=[released_by])


class AuditLogCategoryEnum(enum.Enum):
    AUTH = "auth"                    # Login, logout, password changes
    USER_MANAGEMENT = "user_mgmt"    # Bans, suspensions, role changes
    FINANCIAL = "financial"          # Refunds, payouts, holds
    CONTENT = "content"              # Content removal, approval
    DISPUTE = "dispute"              # Dispute actions
    REPORT = "report"                # Report handling
    SETTINGS = "settings"            # Platform settings changes
    ADMIN = "admin"                  # Admin-specific actions

class AuditLog(Base):
    """Comprehensive audit log for all platform actions"""
    __tablename__ = 'audit_logs'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    # Who performed the action
    actor_id = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True, index=True)
    actor_email = Column(String(255), nullable=True)  # Stored separately in case user is deleted
    actor_role = Column(String(50), nullable=True)
    is_admin_action = Column(Boolean, default=False)
    is_system_action = Column(Boolean, default=False)  # Automated system actions
    
    # What happened
    category = Column(String(30), nullable=False)  # AuditLogCategoryEnum
    action = Column(String(100), nullable=False)  # e.g., 'user_banned', 'refund_issued', 'content_removed'
    description = Column(Text, nullable=True)
    
    # Target of the action
    target_type = Column(String(50), nullable=True)  # 'user', 'post', 'dispute', 'payout', etc.
    target_id = Column(String(36), nullable=True)
    target_email = Column(String(255), nullable=True)  # For user targets
    
    # Changes made (JSON diff)
    old_value = Column(JSON, nullable=True)
    new_value = Column(JSON, nullable=True)
    
    # Context
    ip_address = Column(String(50), nullable=True)
    user_agent = Column(String(500), nullable=True)
    request_id = Column(String(36), nullable=True)  # For correlating related actions
    
    # Extra context data
    extra_data = Column(JSON, default=dict)  # Any additional context
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    
    # Relationships
    actor = relationship('Profile', backref='audit_logs')
    
    __table_args__ = (
        Index('ix_audit_category_created', 'category', 'created_at'),
        Index('ix_audit_target', 'target_type', 'target_id'),
        Index('ix_audit_actor_created', 'actor_id', 'created_at'),
    )



# ============ P1 ADMIN FEATURES ============

class VerificationTypeEnum(enum.Enum):
    PRO_SURFER = "pro_surfer"           # WSL verification
    APPROVED_PRO_PHOTOGRAPHER = "approved_pro_photographer"  # Media/social verification
    COMP_SURFER = "comp_surfer"         # Competition surfer verification
    BUSINESS = "business"               # Business verification

class IdentityVerificationStatusEnum(enum.Enum):
    """Status for identity verification requests"""
    PENDING = "pending"
    UNDER_REVIEW = "under_review"
    APPROVED = "approved"
    REJECTED = "rejected"
    MORE_INFO_NEEDED = "more_info_needed"

class VerificationRequest(Base):
    """Identity verification requests for Pro Surfers and Approved Pro Photographers"""
    __tablename__ = 'verification_requests'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    verification_type = Column(String(50), nullable=False)  # VerificationTypeEnum
    status = Column(String(30), default='pending')  # VerificationStatusEnum
    
    # Pro Surfer specific fields
    wsl_athlete_id = Column(String(100), nullable=True)
    wsl_profile_url = Column(String(500), nullable=True)
    competition_history_urls = Column(JSON, default=list)  # List of competition result URLs
    
    # Pro Photographer specific fields
    instagram_url = Column(String(500), nullable=True)
    portfolio_website = Column(String(500), nullable=True)
    other_social_urls = Column(JSON, default=list)  # Twitter, YouTube, etc.
    media_mentions = Column(JSON, default=list)  # Articles, publications featuring their work
    professional_equipment = Column(Text, nullable=True)  # Description of gear
    years_experience = Column(Integer, nullable=True)
    business_registration = Column(String(500), nullable=True)  # Business license URL if applicable
    
    # Common fields
    photo_id_url = Column(String(500), nullable=True)  # Government ID for identity match
    additional_notes = Column(Text, nullable=True)  # User's additional info
    sample_work_urls = Column(JSON, default=list)  # Portfolio samples
    
    # Admin review fields
    reviewed_by = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    admin_notes = Column(Text, nullable=True)  # Internal admin notes
    rejection_reason = Column(Text, nullable=True)  # Reason shown to user if rejected
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    
    # Relationships
    user = relationship('Profile', foreign_keys=[user_id], backref='verification_requests')
    reviewer = relationship('Profile', foreign_keys=[reviewed_by])


class ImpersonationSession(Base):
    """Audit trail for admin impersonation sessions"""
    __tablename__ = 'impersonation_sessions'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    admin_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    target_user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Session details
    reason = Column(Text, nullable=True)  # Why admin is impersonating
    started_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    ended_at = Column(DateTime(timezone=True), nullable=True)
    
    # Actions taken during impersonation (for audit)
    actions_log = Column(JSON, default=list)  # List of actions performed
    is_read_only = Column(Boolean, default=True)  # Whether write actions were allowed
    
    # Context
    ip_address = Column(String(50), nullable=True)
    user_agent = Column(String(500), nullable=True)
    
    # Relationships
    admin = relationship('Profile', foreign_keys=[admin_id], backref='impersonation_sessions_as_admin')
    target_user = relationship('Profile', foreign_keys=[target_user_id], backref='impersonation_sessions_as_target')


class FraudAlertTypeEnum(enum.Enum):
    LOCATION_SPOOFING = "location_spoofing"
    FAKE_REVIEWS = "fake_reviews"
    CHARGEBACK_PATTERN = "chargeback_pattern"
    SUSPICIOUS_SIGNUPS = "suspicious_signups"
    MULTIPLE_ACCOUNTS = "multiple_accounts"
    PAYMENT_FRAUD = "payment_fraud"
    IDENTITY_MISMATCH = "identity_mismatch"
    BOT_BEHAVIOR = "bot_behavior"

class FraudAlert(Base):
    """Fraud detection alerts for suspicious user behavior"""
    __tablename__ = 'fraud_alerts'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    alert_type = Column(String(50), nullable=False)  # FraudAlertTypeEnum
    severity = Column(String(20), default='medium')  # low, medium, high, critical
    
    # Alert details
    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=False)
    evidence = Column(JSON, default=dict)  # Supporting data for the alert
    
    # Risk scoring
    risk_score = Column(Integer, default=50)  # 0-100 score
    
    # Resolution
    status = Column(String(30), default='open')  # open, investigating, resolved, false_positive
    resolved_by = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    resolution_notes = Column(Text, nullable=True)
    action_taken = Column(String(50), nullable=True)  # none, warning, suspended, banned
    
    # Auto-generated or manual
    is_automated = Column(Boolean, default=True)
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    
    # Relationships
    user = relationship('Profile', foreign_keys=[user_id], backref='fraud_alerts')
    resolver = relationship('Profile', foreign_keys=[resolved_by])


# ============ TOS COMPLIANCE & STRIKE SYSTEM ============

class TosViolationTypeEnum(enum.Enum):
    """Types of Terms of Service violations"""
    LOCATION_FRAUD = "location_fraud"           # Fake GPS coordinates
    FAKE_REVIEWS = "fake_reviews"               # Creating fake reviews
    HARASSMENT = "harassment"                    # Harassing other users
    INAPPROPRIATE_CONTENT = "inappropriate"      # Posting inappropriate content
    SPAM = "spam"                                # Spamming
    SCAM = "scam"                                # Attempting to scam users
    MULTIPLE_ACCOUNTS = "multiple_accounts"      # Operating multiple accounts
    CHARGEBACKS = "chargebacks"                  # Repeated chargebacks
    UNDERAGE = "underage"                        # Underage user without grom link
    IMPERSONATION = "impersonation"              # Impersonating others
    OTHER = "other"                              # Other violations


class TosViolation(Base):
    """
    Terms of Service violations with progressive strike system.
    Strike thresholds:
    - 1 strike: Warning
    - 2 strikes: 7-day suspension
    - 3 strikes: 30-day suspension  
    - 4+ strikes: Permanent ban
    """
    __tablename__ = 'tos_violations'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Violation details
    violation_type = Column(String(50), nullable=False)  # TosViolationTypeEnum
    severity = Column(String(20), default='minor')       # minor, moderate, severe, critical
    strike_points = Column(Integer, default=1)           # Points added (minor=1, moderate=2, severe=3, critical=5)
    
    # Evidence
    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=False)
    evidence = Column(JSON, default=dict)  # Screenshots, GPS logs, etc.
    
    # Related entities (if applicable)
    related_type = Column(String(50), nullable=True)  # booking, post, review, dispatch
    related_id = Column(String(36), nullable=True)
    
    # Location data (for location fraud)
    claimed_latitude = Column(Float, nullable=True)
    claimed_longitude = Column(Float, nullable=True)
    actual_latitude = Column(Float, nullable=True)
    actual_longitude = Column(Float, nullable=True)
    distance_discrepancy_miles = Column(Float, nullable=True)
    
    # Action taken
    action_taken = Column(String(50), default='warning')  # warning, suspension_7d, suspension_30d, permanent_ban
    suspension_until = Column(DateTime(timezone=True), nullable=True)
    
    # Audit
    reported_by = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True)  # User who reported
    reviewed_by = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True)  # Admin who reviewed
    
    # Appeal
    is_appealed = Column(Boolean, default=False)
    appeal_text = Column(Text, nullable=True)
    appeal_status = Column(String(20), nullable=True)  # pending, approved, denied
    appeal_reviewed_by = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True)
    appeal_reviewed_at = Column(DateTime(timezone=True), nullable=True)
    
    # Status
    status = Column(String(20), default='active')  # active, appealed, overturned, expired
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    
    # Relationships
    user = relationship('Profile', foreign_keys=[user_id], backref='tos_violations')
    reporter = relationship('Profile', foreign_keys=[reported_by])
    reviewer = relationship('Profile', foreign_keys=[reviewed_by])
    appeal_reviewer = relationship('Profile', foreign_keys=[appeal_reviewed_by])


class TosAcknowledgement(Base):
    """
    Track when users acknowledge/accept ToS updates.
    Required before using features that changed in ToS.
    """
    __tablename__ = 'tos_acknowledgements'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    tos_version = Column(String(20), nullable=False)  # e.g., "2.0", "2.1"
    
    # What was acknowledged
    section = Column(String(100), nullable=True)  # e.g., "location_verification", "gallery_pricing"
    
    # Context
    ip_address = Column(String(50), nullable=True)
    user_agent = Column(String(500), nullable=True)
    
    acknowledged_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    # Relationships
    user = relationship('Profile', backref='tos_acknowledgements')
    
    __table_args__ = (
        Index('ix_tos_ack_user_version', 'user_id', 'tos_version'),
    )


class UserActivityLog(Base):
    """Comprehensive user activity tracking for journey timeline"""
    __tablename__ = 'user_activity_logs'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Activity details
    activity_type = Column(String(50), nullable=False)  # signup, login, post, booking, purchase, etc.
    activity_category = Column(String(30), nullable=False)  # auth, content, financial, social, settings
    description = Column(String(500), nullable=False)
    
    # Related entities
    related_type = Column(String(50), nullable=True)  # post, booking, transaction, etc.
    related_id = Column(String(36), nullable=True)
    
    # Context
    ip_address = Column(String(50), nullable=True)
    user_agent = Column(String(500), nullable=True)
    location_lat = Column(Float, nullable=True)
    location_lng = Column(Float, nullable=True)
    
    # Metadata
    extra_data = Column(JSON, default=dict)
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    
    # Relationships
    user = relationship('Profile', backref='activity_logs')
    
    __table_args__ = (
        Index('ix_activity_user_created', 'user_id', 'created_at'),
        Index('ix_activity_type_created', 'activity_type', 'created_at'),
    )



# ============ P2 ADMIN FEATURES ============

class PromoCodeTypeEnum(enum.Enum):
    PERCENTAGE = "percentage"       # e.g., 20% off
    FIXED_AMOUNT = "fixed_amount"   # e.g., $10 off
    FREE_CREDITS = "free_credits"   # e.g., 50 free credits
    FIRST_BOOKING = "first_booking" # First booking discount

class PromoCode(Base):
    """Promotional codes for marketing campaigns"""
    __tablename__ = 'promo_codes'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    code = Column(String(50), unique=True, nullable=False, index=True)  # e.g., "SUMMER2026"
    
    # Promo details
    code_type = Column(String(30), nullable=False)  # PromoCodeTypeEnum
    discount_value = Column(Float, nullable=False)  # Percentage (0-100) or fixed amount
    
    # Usage limits
    max_uses = Column(Integer, nullable=True)  # Total uses allowed (null = unlimited)
    max_uses_per_user = Column(Integer, default=1)  # Uses per user
    current_uses = Column(Integer, default=0)
    
    # Validity
    is_active = Column(Boolean, default=True)
    valid_from = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    valid_until = Column(DateTime(timezone=True), nullable=True)
    
    # Targeting
    min_purchase_amount = Column(Float, nullable=True)  # Minimum purchase to apply
    applicable_to = Column(JSON, default=list)  # List of product types: ['photo', 'subscription', 'booking']
    target_user_roles = Column(JSON, default=list)  # List of roles that can use this code
    target_user_ids = Column(JSON, default=list)  # Specific user IDs (for exclusive codes)
    
    # Campaign tracking
    campaign_name = Column(String(100), nullable=True)
    campaign_source = Column(String(50), nullable=True)  # email, social, partner, etc.
    
    # Metadata
    created_by = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    
    # Relationships
    creator = relationship('Profile', backref='created_promo_codes')


class PromoCodeRedemption(Base):
    """Track promo code redemptions"""
    __tablename__ = 'promo_code_redemptions'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    promo_code_id = Column(String(36), ForeignKey('promo_codes.id', ondelete='CASCADE'), nullable=False, index=True)
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Redemption details
    discount_applied = Column(Float, nullable=False)  # Actual discount amount
    original_amount = Column(Float, nullable=True)  # Original purchase amount
    transaction_id = Column(String(36), nullable=True)  # Related transaction
    
    redeemed_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    # Relationships
    promo_code = relationship('PromoCode', backref='redemptions')
    user = relationship('Profile', backref='promo_redemptions')


class FeatureFlag(Base):
    """Dynamic feature flags with rollout control"""
    __tablename__ = 'feature_flags'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    key = Column(String(100), unique=True, nullable=False, index=True)  # e.g., "new_booking_flow"
    name = Column(String(200), nullable=False)  # Human readable name
    description = Column(Text, nullable=True)
    
    # Flag status
    is_enabled = Column(Boolean, default=False)
    
    # Rollout control
    rollout_percentage = Column(Integer, default=0)  # 0-100, percentage of users
    
    # Targeting
    target_roles = Column(JSON, default=list)  # Specific roles to enable for
    target_user_ids = Column(JSON, default=list)  # Specific users (beta testers)
    exclude_user_ids = Column(JSON, default=list)  # Users to exclude
    
    # A/B Testing
    is_experiment = Column(Boolean, default=False)
    experiment_variants = Column(JSON, default=list)  # [{"name": "control", "weight": 50}, {"name": "variant_a", "weight": 50}]
    
    # Kill switch
    kill_switch_enabled = Column(Boolean, default=False)  # Emergency off switch
    
    # Metadata
    category = Column(String(50), nullable=True)  # UI, Backend, Payment, etc.
    created_by = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class NotificationCampaign(Base):
    """Scheduled push notification campaigns"""
    __tablename__ = 'notification_campaigns'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    name = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    
    # Notification content
    title = Column(String(200), nullable=False)
    body = Column(Text, nullable=False)
    image_url = Column(String(500), nullable=True)
    action_url = Column(String(500), nullable=True)  # Deep link or URL
    
    # Targeting
    target_all_users = Column(Boolean, default=False)
    target_roles = Column(JSON, default=list)  # List of roles
    target_user_ids = Column(JSON, default=list)  # Specific users
    target_segments = Column(JSON, default=list)  # Custom segments: ['inactive_30d', 'never_booked', etc.]
    
    # Exclude users
    exclude_user_ids = Column(JSON, default=list)
    
    # Scheduling
    status = Column(String(30), default='draft')  # draft, scheduled, sending, sent, cancelled
    scheduled_at = Column(DateTime(timezone=True), nullable=True)
    sent_at = Column(DateTime(timezone=True), nullable=True)
    
    # Stats
    total_targeted = Column(Integer, default=0)
    total_sent = Column(Integer, default=0)
    total_delivered = Column(Integer, default=0)
    total_opened = Column(Integer, default=0)
    total_clicked = Column(Integer, default=0)
    
    # Metadata
    created_by = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    
    # Relationships
    creator = relationship('Profile', backref='notification_campaigns')


class CohortAnalysis(Base):
    """Pre-computed cohort analysis data for performance"""
    __tablename__ = 'cohort_analysis'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    cohort_month = Column(String(7), nullable=False, index=True)  # e.g., "2026-01"
    cohort_type = Column(String(30), nullable=False)  # 'signup', 'first_booking', 'first_purchase'
    
    # Cohort size
    cohort_size = Column(Integer, default=0)
    
    # Retention by month (JSON: {"month_0": 100, "month_1": 75, ...})
    retention_data = Column(JSON, default=dict)
    
    # Revenue by month (JSON: {"month_0": 1500, "month_1": 1200, ...})
    revenue_data = Column(JSON, default=dict)
    
    # Last computed
    computed_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))



# ============ ADMIN CONSOLE ENHANCED MODELS ============

# --- SUPPORT TICKETING SYSTEM ---
class TicketCategoryEnum(enum.Enum):
    BILLING = "billing"
    TECHNICAL = "technical"
    ACCOUNT = "account"
    BOOKING = "booking"
    PAYOUT = "payout"
    CONTENT = "content"
    VERIFICATION = "verification"
    OTHER = "other"

class TicketPriorityEnum(enum.Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    URGENT = "urgent"

class TicketStatusEnum(enum.Enum):
    OPEN = "open"
    IN_PROGRESS = "in_progress"
    WAITING_USER = "waiting_user"
    WAITING_INTERNAL = "waiting_internal"
    RESOLVED = "resolved"
    CLOSED = "closed"

class SupportTicket(Base):
    __tablename__ = 'support_tickets'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    ticket_number = Column(String(20), unique=True, nullable=False, index=True)  # e.g., "TKT-00001"
    
    # User who created the ticket
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Assigned admin
    assigned_to = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True, index=True)
    
    # Ticket details
    subject = Column(String(255), nullable=False)
    description = Column(Text, nullable=False)
    category = Column(Enum(TicketCategoryEnum), default=TicketCategoryEnum.OTHER, index=True)
    priority = Column(Enum(TicketPriorityEnum), default=TicketPriorityEnum.MEDIUM, index=True)
    status = Column(Enum(TicketStatusEnum), default=TicketStatusEnum.OPEN, index=True)
    
    # Related entities
    related_booking_id = Column(String(36), ForeignKey('bookings.id', ondelete='SET NULL'), nullable=True)
    related_transaction_id = Column(String(36), nullable=True)
    
    # SLA tracking
    sla_due_at = Column(DateTime(timezone=True), nullable=True)
    first_response_at = Column(DateTime(timezone=True), nullable=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    
    # CSAT
    csat_rating = Column(Integer, nullable=True)  # 1-5
    csat_feedback = Column(Text, nullable=True)
    
    # Tags for filtering
    tags = Column(JSON, default=list)  # ["refund", "urgent", etc.]
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    
    # Relationships
    user = relationship('Profile', foreign_keys=[user_id])
    assignee = relationship('Profile', foreign_keys=[assigned_to])
    messages = relationship('TicketMessage', back_populates='ticket', cascade='all, delete-orphan')

class TicketMessage(Base):
    __tablename__ = 'ticket_messages'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    ticket_id = Column(String(36), ForeignKey('support_tickets.id', ondelete='CASCADE'), nullable=False, index=True)
    sender_id = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True)
    
    message = Column(Text, nullable=False)
    is_internal_note = Column(Boolean, default=False)  # Admin-only notes
    attachments = Column(JSON, default=list)  # List of attachment URLs
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    ticket = relationship('SupportTicket', back_populates='messages')
    sender = relationship('Profile')


# --- CONTENT MODERATION QUEUE ---
class ContentModerationStatusEnum(enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    ESCALATED = "escalated"

class ContentModerationItem(Base):
    __tablename__ = 'content_moderation_items'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    # Content reference
    content_type = Column(String(50), nullable=False, index=True)  # 'gallery_item', 'post', 'avatar', 'bio'
    content_id = Column(String(36), nullable=False, index=True)
    content_url = Column(String(500), nullable=True)  # Direct URL for quick review
    content_preview = Column(Text, nullable=True)  # Text preview or thumbnail URL
    
    # Owner
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Moderation status
    status = Column(Enum(ContentModerationStatusEnum), default=ContentModerationStatusEnum.PENDING, index=True)
    
    # AI analysis results (if available)
    ai_flagged = Column(Boolean, default=False)
    ai_confidence = Column(Float, nullable=True)  # 0-1
    ai_categories = Column(JSON, default=list)  # ["nudity", "violence", etc.]
    
    # Manual review
    reviewed_by = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    rejection_reason = Column(Text, nullable=True)
    
    # Source (how it was flagged)
    flagged_by = Column(String(50), default='auto')  # 'auto', 'user_report', 'admin'
    flag_count = Column(Integer, default=1)
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    user = relationship('Profile', foreign_keys=[user_id])
    reviewer = relationship('Profile', foreign_keys=[reviewed_by])


# --- COMMUNICATION CENTER ---
class AnnouncementTypeEnum(enum.Enum):
    BANNER = "banner"
    MODAL = "modal"
    TOAST = "toast"
    EMAIL = "email"

class Announcement(Base):
    __tablename__ = 'announcements'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    title = Column(String(255), nullable=False)
    message = Column(Text, nullable=False)
    announcement_type = Column(Enum(AnnouncementTypeEnum), default=AnnouncementTypeEnum.BANNER)
    
    # Targeting
    target_roles = Column(JSON, default=list)  # Empty = all users
    target_user_ids = Column(JSON, default=list)  # Specific users
    
    # Display settings
    is_active = Column(Boolean, default=True)
    is_dismissible = Column(Boolean, default=True)
    action_url = Column(String(500), nullable=True)
    action_text = Column(String(100), nullable=True)
    
    # Scheduling
    start_at = Column(DateTime(timezone=True), nullable=True)
    end_at = Column(DateTime(timezone=True), nullable=True)
    
    # Tracking
    views_count = Column(Integer, default=0)
    clicks_count = Column(Integer, default=0)
    dismissals_count = Column(Integer, default=0)
    
    created_by = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

class MessageTemplate(Base):
    __tablename__ = 'message_templates'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    name = Column(String(100), nullable=False, unique=True)
    subject = Column(String(255), nullable=True)  # For emails
    body = Column(Text, nullable=False)
    template_type = Column(String(50), default='email')  # 'email', 'push', 'in_app'
    
    # Variables available (for reference)
    variables = Column(JSON, default=list)  # ["user_name", "booking_id", etc.]
    
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

class BulkMessageCampaign(Base):
    __tablename__ = 'bulk_message_campaigns'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    name = Column(String(255), nullable=False)
    message_type = Column(String(50), nullable=False)  # 'email', 'push', 'in_app'
    
    subject = Column(String(255), nullable=True)
    body = Column(Text, nullable=False)
    
    # Targeting
    target_segment = Column(String(100), nullable=True)  # 'all', 'photographers', 'surfers', 'inactive', etc.
    target_roles = Column(JSON, default=list)
    target_filters = Column(JSON, default=dict)  # {"min_bookings": 5, "location": "Florida"}
    
    # Status
    status = Column(String(50), default='draft')  # 'draft', 'scheduled', 'sending', 'sent', 'cancelled'
    scheduled_at = Column(DateTime(timezone=True), nullable=True)
    sent_at = Column(DateTime(timezone=True), nullable=True)
    
    # Stats
    total_recipients = Column(Integer, default=0)
    sent_count = Column(Integer, default=0)
    delivered_count = Column(Integer, default=0)
    opened_count = Column(Integer, default=0)
    clicked_count = Column(Integer, default=0)
    bounced_count = Column(Integer, default=0)
    
    created_by = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


# --- SYSTEM HEALTH MONITORING ---
class SystemHealthMetric(Base):
    __tablename__ = 'system_health_metrics'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    metric_name = Column(String(100), nullable=False, index=True)
    metric_type = Column(String(50), nullable=False)  # 'api', 'database', 'job', 'external'
    
    # Values
    value = Column(Float, nullable=False)
    unit = Column(String(50), nullable=True)  # 'ms', 'percent', 'count'
    
    # Thresholds
    warning_threshold = Column(Float, nullable=True)
    critical_threshold = Column(Float, nullable=True)
    
    status = Column(String(20), default='healthy')  # 'healthy', 'warning', 'critical'
    
    recorded_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)

class ScheduledJobStatus(Base):
    __tablename__ = 'scheduled_job_statuses'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    job_name = Column(String(100), nullable=False, unique=True, index=True)
    job_description = Column(String(255), nullable=True)
    schedule = Column(String(100), nullable=True)  # e.g., "Every 15 minutes"
    
    # Last run info
    last_run_at = Column(DateTime(timezone=True), nullable=True)
    last_run_duration_ms = Column(Integer, nullable=True)
    last_run_status = Column(String(50), default='unknown')  # 'success', 'failed', 'running', 'unknown'
    last_run_error = Column(Text, nullable=True)
    
    # Next run
    next_run_at = Column(DateTime(timezone=True), nullable=True)
    
    # Stats
    total_runs = Column(Integer, default=0)
    success_count = Column(Integer, default=0)
    failure_count = Column(Integer, default=0)
    
    is_enabled = Column(Boolean, default=True)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

class SystemAlert(Base):
    __tablename__ = 'system_alerts'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    alert_type = Column(String(50), nullable=False, index=True)  # 'api_degraded', 'job_failed', 'high_error_rate'
    severity = Column(String(20), nullable=False)  # 'info', 'warning', 'critical'
    
    title = Column(String(255), nullable=False)
    message = Column(Text, nullable=False)
    
    # Related metric/job
    related_metric_id = Column(String(36), nullable=True)
    related_job_name = Column(String(100), nullable=True)
    
    # Status
    is_acknowledged = Column(Boolean, default=False)
    acknowledged_by = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True)
    acknowledged_at = Column(DateTime(timezone=True), nullable=True)
    
    is_resolved = Column(Boolean, default=False)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)


# --- FINANCIAL OPERATIONS ---
class RefundStatusEnum(enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    PROCESSING = "processing"
    COMPLETED = "completed"
    REJECTED = "rejected"
    FAILED = "failed"

class RefundRequest(Base):
    __tablename__ = 'refund_requests'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    # User and transaction
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    transaction_id = Column(String(36), ForeignKey('credit_transactions.id', ondelete='SET NULL'), nullable=True)
    booking_id = Column(String(36), ForeignKey('bookings.id', ondelete='SET NULL'), nullable=True)
    
    # Amount
    amount = Column(Float, nullable=False)
    currency = Column(String(10), default='USD')
    
    # Reason
    reason = Column(Text, nullable=False)
    reason_category = Column(String(50), nullable=True)  # 'service_issue', 'cancelled', 'duplicate', 'fraud'
    
    # Status
    status = Column(Enum(RefundStatusEnum), default=RefundStatusEnum.PENDING, index=True)
    
    # Processing
    processed_by = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True)
    processed_at = Column(DateTime(timezone=True), nullable=True)
    rejection_reason = Column(Text, nullable=True)
    
    # Stripe refund ID if applicable
    stripe_refund_id = Column(String(100), nullable=True)
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    user = relationship('Profile', foreign_keys=[user_id])
    processor = relationship('Profile', foreign_keys=[processed_by])

class PayoutBatch(Base):
    __tablename__ = 'payout_batches'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    batch_number = Column(String(20), unique=True, nullable=False)  # e.g., "PAY-2026-001"
    
    # Totals
    total_amount = Column(Float, default=0)
    total_recipients = Column(Integer, default=0)
    currency = Column(String(10), default='USD')
    
    # Status
    status = Column(String(50), default='pending')  # 'pending', 'processing', 'completed', 'failed', 'partial'
    
    # Processing
    initiated_by = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True)
    initiated_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    
    # Results
    successful_count = Column(Integer, default=0)
    failed_count = Column(Integer, default=0)
    failed_details = Column(JSON, default=list)  # [{user_id, amount, error}]
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

class FailedPayment(Base):
    __tablename__ = 'failed_payments'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Payment details
    amount = Column(Float, nullable=False)
    currency = Column(String(10), default='USD')
    payment_type = Column(String(50), nullable=True)  # 'subscription', 'booking', 'credits'
    
    # Failure info
    stripe_payment_intent_id = Column(String(100), nullable=True)
    failure_code = Column(String(100), nullable=True)
    failure_message = Column(Text, nullable=True)
    
    # Recovery
    recovery_attempts = Column(Integer, default=0)
    last_attempt_at = Column(DateTime(timezone=True), nullable=True)
    recovered = Column(Boolean, default=False)
    recovered_at = Column(DateTime(timezone=True), nullable=True)
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    
    user = relationship('Profile')


# --- CONTENT MANAGEMENT ---
class FeaturedContent(Base):
    __tablename__ = 'featured_content'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    content_type = Column(String(50), nullable=False, index=True)  # 'photographer', 'spot', 'gallery_item', 'post'
    content_id = Column(String(36), nullable=False, index=True)
    
    # Display info
    title = Column(String(255), nullable=True)
    subtitle = Column(String(255), nullable=True)
    image_url = Column(String(500), nullable=True)
    
    # Placement
    placement = Column(String(50), default='homepage')  # 'homepage', 'explore', 'spot_hub'
    position = Column(Integer, default=0)  # Order in the list
    
    # Scheduling
    is_active = Column(Boolean, default=True)
    start_at = Column(DateTime(timezone=True), nullable=True)
    end_at = Column(DateTime(timezone=True), nullable=True)
    
    created_by = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

class HomepageBanner(Base):
    __tablename__ = 'homepage_banners'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    title = Column(String(255), nullable=False)
    subtitle = Column(String(255), nullable=True)
    
    # Media
    image_url = Column(String(500), nullable=True)
    video_url = Column(String(500), nullable=True)
    background_color = Column(String(20), nullable=True)
    
    # CTA
    cta_text = Column(String(100), nullable=True)
    cta_url = Column(String(500), nullable=True)
    
    # Display
    position = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
    
    # Targeting
    target_roles = Column(JSON, default=list)  # Empty = all
    
    # Scheduling
    start_at = Column(DateTime(timezone=True), nullable=True)
    end_at = Column(DateTime(timezone=True), nullable=True)
    
    # Stats
    impressions = Column(Integer, default=0)
    clicks = Column(Integer, default=0)
    
    created_by = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

class SpotSEOMetadata(Base):
    __tablename__ = 'spot_seo_metadata'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    spot_id = Column(String(36), ForeignKey('surf_spots.id', ondelete='CASCADE'), nullable=False, unique=True, index=True)
    
    # SEO fields
    meta_title = Column(String(70), nullable=True)  # Max 60-70 chars
    meta_description = Column(String(160), nullable=True)  # Max 150-160 chars
    og_title = Column(String(100), nullable=True)
    og_description = Column(String(200), nullable=True)
    og_image_url = Column(String(500), nullable=True)
    
    # Structured data
    schema_markup = Column(JSON, default=dict)
    
    # Keywords
    keywords = Column(JSON, default=list)
    
    updated_by = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


# --- ADMIN TOOLS ---
class AutomatedReport(Base):
    __tablename__ = 'automated_reports'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    name = Column(String(100), nullable=False)
    report_type = Column(String(50), nullable=False)  # 'daily_summary', 'weekly_metrics', 'monthly_revenue'
    
    # Schedule
    schedule = Column(String(50), nullable=False)  # 'daily', 'weekly', 'monthly'
    schedule_time = Column(String(10), default='09:00')  # Time of day
    schedule_day = Column(Integer, nullable=True)  # Day of week (0-6) or month (1-31)
    
    # Recipients
    recipient_emails = Column(JSON, default=list)
    
    # Configuration
    config = Column(JSON, default=dict)  # Report-specific settings
    
    # Status
    is_active = Column(Boolean, default=True)
    last_sent_at = Column(DateTime(timezone=True), nullable=True)
    last_error = Column(Text, nullable=True)
    
    created_by = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

class APIKey(Base):
    __tablename__ = 'api_keys'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    name = Column(String(100), nullable=False)
    key_prefix = Column(String(10), nullable=False)  # First 8 chars for display
    key_hash = Column(String(255), nullable=False)  # Hashed full key
    
    # Permissions
    permissions = Column(JSON, default=list)  # ['read:profiles', 'write:bookings']
    
    # Rate limits
    rate_limit = Column(Integer, default=1000)  # Requests per hour
    
    # Status
    is_active = Column(Boolean, default=True)
    last_used_at = Column(DateTime(timezone=True), nullable=True)
    usage_count = Column(Integer, default=0)
    
    # Expiry
    expires_at = Column(DateTime(timezone=True), nullable=True)
    
    created_by = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

class ChangelogEntry(Base):
    __tablename__ = 'changelog_entries'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    version = Column(String(20), nullable=False)  # e.g., "2.4.0"
    title = Column(String(255), nullable=False)
    
    # Content
    summary = Column(Text, nullable=True)
    changes = Column(JSON, default=list)  # [{type: 'feature'/'fix'/'improvement', description: '...'}]
    
    # Display
    is_published = Column(Boolean, default=False)
    is_major = Column(Boolean, default=False)  # Show prominently
    
    # Media
    image_url = Column(String(500), nullable=True)
    video_url = Column(String(500), nullable=True)
    
    published_at = Column(DateTime(timezone=True), nullable=True)
    created_by = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))



# ============ USERNAME HISTORY (for @mention system) ============

class UsernameHistory(Base):
    """
    Tracks username changes to prevent reclaiming old usernames.
    Once a user changes their username, the old one becomes available to others.
    If someone else takes it, the original user cannot reclaim it.
    """
    __tablename__ = 'username_history'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    # The username that was released
    username = Column(String(30), nullable=False, index=True)
    
    # User who previously owned this username
    previous_owner_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # User who claimed this username (null if still available)
    claimed_by_id = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True)
    
    # Timestamps
    released_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    claimed_at = Column(DateTime(timezone=True), nullable=True)
    
    # Relationships
    previous_owner = relationship('Profile', foreign_keys=[previous_owner_id])
    claimed_by = relationship('Profile', foreign_keys=[claimed_by_id])



# ============ HASHTAG SYSTEM ============

class Hashtag(Base):
    """
    Stores unique hashtags used across posts.
    Tracks usage count for trending calculations.
    """
    __tablename__ = 'hashtags'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    tag = Column(String(50), unique=True, nullable=False, index=True)  # Lowercase, no # prefix
    post_count = Column(Integer, default=0)  # Number of posts using this hashtag
    last_used = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    # Relationship to posts via junction table
    posts = relationship('Post', secondary='post_hashtags', back_populates='hashtags')


class PostHashtag(Base):
    """
    Junction table linking posts to their hashtags.
    Enables many-to-many relationship.
    """
    __tablename__ = 'post_hashtags'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    post_id = Column(String(36), ForeignKey('posts.id', ondelete='CASCADE'), nullable=False, index=True)
    hashtag_id = Column(String(36), ForeignKey('hashtags.id', ondelete='CASCADE'), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    # Unique constraint to prevent duplicate links
    __table_args__ = (
        Index('ix_post_hashtag_unique', 'post_id', 'hashtag_id', unique=True),
    )


# ============================================================
# PHOTOGRAPHER SUBSCRIPTION PLANS & SURFER SUBSCRIPTIONS
# Photographers offer recurring weekly/monthly bundles.
# Surfers subscribe and get quotas for photos, videos,
# live session buy-ins, and discounts on bookings/on-demand.
# ============================================================

class PhotographerSubscriptionPlan(Base):
    """
    Plans a photographer offers to surfers (weekly/monthly bundles).
    Each plan defines what's included per billing period.
    Minimum price: $5/week.
    """
    __tablename__ = 'photographer_subscription_plans'

    id = Column(String(36), primary_key=True, default=generate_uuid)
    photographer_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)

    # Plan configuration
    name = Column(String(100), nullable=False)       # e.g., "Weekly Basic", "Monthly Pro"
    interval = Column(String(10), nullable=False)     # 'weekly' or 'monthly'
    price = Column(Float, nullable=False)             # Credits/$  (min $5/week enforced in API)
    is_active = Column(Boolean, default=True)

    # ── Content Quotas (per period) ──────────────────────────
    photos_included = Column(Integer, default=0)       # Gallery photos included
    videos_included = Column(Integer, default=0)       # Gallery videos included
    live_session_buyins = Column(Integer, default=0)   # Free live-session jump-ins
    sessions_included = Column(Integer, default=0)     # Scheduled booking sessions included

    # ── Service Discounts (percentage off regular rates) ──────
    booking_discount_pct = Column(Float, default=0.0)    # % off regular booking hourly rate
    on_demand_discount_pct = Column(Float, default=0.0)  # % off regular on-demand hourly rate

    # Metadata
    description = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))

    photographer = relationship('Profile', foreign_keys=[photographer_id],
                                backref='subscription_plans_offered')

    __table_args__ = (
        Index('ix_photo_sub_plan_photographer', 'photographer_id'),
    )


class SurferPhotoSubscription(Base):
    """
    Active subscription a surfer holds with a specific photographer.
    Tracks remaining quotas; reverts to regular rates when expired.
    """
    __tablename__ = 'surfer_photo_subscriptions'

    id = Column(String(36), primary_key=True, default=generate_uuid)
    surfer_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    photographer_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    plan_id = Column(String(36), ForeignKey('photographer_subscription_plans.id', ondelete='SET NULL'), nullable=True)

    # ── Snapshot of plan details at time of purchase ─────────
    plan_name = Column(String(100), nullable=True)
    plan_interval = Column(String(10), nullable=True)   # 'weekly' or 'monthly'
    plan_price = Column(Float, nullable=True)

    # ── Subscription lifecycle ───────────────────────────────
    status = Column(String(20), default='active')       # active, expired, cancelled
    started_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    expires_at = Column(DateTime(timezone=True), nullable=False)

    # ── Remaining quotas (decremented on use) ────────────────
    photos_remaining = Column(Integer, default=0)
    videos_remaining = Column(Integer, default=0)
    live_session_buyins_remaining = Column(Integer, default=0)
    sessions_remaining = Column(Integer, default=0)

    # ── Discount snapshots (locked at purchase) ──────────────
    booking_discount_pct = Column(Float, default=0.0)
    on_demand_discount_pct = Column(Float, default=0.0)

    # ── Payment ──────────────────────────────────────────────
    amount_paid = Column(Float, nullable=False)
    payment_method = Column(String(20), nullable=True)   # 'credits' or 'card'
    stripe_session_id = Column(String(255), nullable=True)

    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    surfer = relationship('Profile', foreign_keys=[surfer_id], backref='photo_subscriptions')
    photographer = relationship('Profile', foreign_keys=[photographer_id],
                                backref='subscriber_subscriptions')
    plan = relationship('PhotographerSubscriptionPlan')

    __table_args__ = (
        Index('ix_surfer_photo_sub_surfer', 'surfer_id'),
        Index('ix_surfer_photo_sub_photographer', 'photographer_id'),
        Index('ix_surfer_photo_sub_status', 'status'),
    )
