"""Booking system: sessions, participants, invites, waitlist."""
from sqlalchemy import Column, String, Integer, Float, Boolean, ForeignKey, DateTime, Date, Enum, Text, Index, JSON
from sqlalchemy.orm import relationship, backref
from database import Base
from datetime import datetime, timezone

from .base import generate_uuid
from .enums import *
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

