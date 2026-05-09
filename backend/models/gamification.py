"""Gamification: badges, XP, challenges, leaderboards, sponsorships, surf passport."""
from sqlalchemy import Column, String, Integer, Float, Boolean, ForeignKey, DateTime, Date, Enum, Text, Index, JSON
from sqlalchemy.orm import relationship, backref
from database import Base
from datetime import datetime, timezone

from .base import generate_uuid
from .enums import *
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
    badge_emoji = Column(String(10), default='ðŸ†')
    
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
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    
    # Relationships
    owner = relationship("Profile", backref=backref("surfboards", lazy="dynamic"))
    
    __table_args__ = (
        Index('idx_surfboard_user', 'user_id'),
        Index('idx_surfboard_for_sale', 'is_for_sale', 'sale_status'),
    )



# ============ P0 ADMIN FEATURES ============


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




class SurfLogEntry(Base):
    """
    Personal surf journal entry.
    Users can log sessions manually or auto-generate from completed bookings/dispatches.
    """
    __tablename__ = 'surf_log_entries'

    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)

    # When / Where
    session_date = Column(Date, nullable=False, index=True)
    session_time = Column(String(20), nullable=True)  # e.g., "06:30" (dawn patrol)
    duration_minutes = Column(Integer, nullable=True)
    spot_id = Column(String(36), ForeignKey('surf_spots.id', ondelete='SET NULL'), nullable=True)
    spot_name = Column(String(255), nullable=True)  # Denormalized â€” persists even if spot deleted
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)

    # Conditions
    wave_height = Column(String(50), nullable=True)   # e.g., "3-4ft"
    wind_direction = Column(String(50), nullable=True) # "Offshore", "Cross-shore", etc.
    tide_status = Column(String(50), nullable=True)    # "Rising", "Falling", "High", "Low"
    water_temp = Column(String(30), nullable=True)     # "72Â°F" or "Warm"
    crowd_level = Column(String(30), nullable=True)    # "Empty", "Light", "Moderate", "Packed"
    conditions_rating = Column(Integer, nullable=True) # 1-5 stars for overall conditions

    # Gear
    board_model = Column(String(255), nullable=True)    # "5'10 Lost Puddle Jumper"
    board_id = Column(String(36), nullable=True)        # FK to board catalog (optional)
    wetsuit = Column(String(100), nullable=True)        # "3/2mm Fullsuit" or "Boardshorts"
    fin_setup = Column(String(50), nullable=True)       # "Thruster", "Quad", "Twin"

    # Personal notes
    notes = Column(Text, nullable=True)        # Freeform journal text
    mood = Column(String(30), nullable=True)   # "stoked", "chill", "frustrated", "epic"
    personal_rating = Column(Integer, nullable=True)  # 1-5 stars for personal performance

    # Media attachments (JSON array of URLs)
    photo_urls = Column(JSON, nullable=True)  # ["https://...", ...]

    # Linkage to platform sessions (auto-populate when available)
    booking_id = Column(String(36), ForeignKey('bookings.id', ondelete='SET NULL'), nullable=True)
    dispatch_id = Column(String(36), nullable=True)       # Not FK â€” dispatch may be deleted
    live_session_id = Column(String(36), nullable=True)    # Not FK â€” session may be deleted
    gallery_id = Column(String(36), nullable=True)         # Linked gallery if photos were purchased

    # Source of entry
    source = Column(String(30), default='manual')  # 'manual', 'auto_booking', 'auto_dispatch', 'auto_checkin'

    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))

    # Relationships
    user = relationship('Profile', backref='surf_log_entries')
    spot = relationship('SurfSpot')
    booking = relationship('Booking')

    __table_args__ = (
        Index('ix_surf_log_user_date', 'user_id', 'session_date'),
    )

