"""Live sessions, participants, condition reports, and live streams."""
from sqlalchemy import Column, String, Integer, Float, Boolean, ForeignKey, DateTime, Date, Enum, Text, Index, JSON
from sqlalchemy.orm import relationship, backref
from database import Base
from datetime import datetime, timezone

from .base import generate_uuid
from .enums import *
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

