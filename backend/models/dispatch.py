"""On-demand dispatch, photographer requests, and session snapshots."""
from sqlalchemy import Column, String, Integer, Float, Boolean, ForeignKey, DateTime, Date, Enum, Text, Index, JSON
from sqlalchemy.orm import relationship, backref
from database import Base
from datetime import datetime, timezone

from .base import generate_uuid
from .enums import *


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

