"""User profile, auth tokens, and username history."""
from sqlalchemy import Column, String, Integer, Float, Boolean, ForeignKey, DateTime, Date, Enum, Text, Index, JSON
from sqlalchemy.orm import relationship, backref
from database import Base
from datetime import datetime, timezone

from .base import generate_uuid
from .enums import *
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
    
    # ============ STRAVA INTEGRATION ============
    strava_access_token = Column(String(255), nullable=True)
    strava_refresh_token = Column(String(255), nullable=True)
    strava_expires_at = Column(Integer, nullable=True)
    
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
    
    # Gamification - Surf Streak & Badges (Payment â†’ Profile cross-pollination)
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

