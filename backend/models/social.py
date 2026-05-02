"""Social graph: follows, notifications, friends, reviews, privacy."""
from sqlalchemy import Column, String, Integer, Float, Boolean, ForeignKey, DateTime, Date, Enum, Text, Index, JSON
from sqlalchemy.orm import relationship, backref
from database import Base
from datetime import datetime, timezone

from .base import generate_uuid
from .enums import *
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


class Review(Base):
    """Two-way review system for photographers and surfers â€” supports all session types"""
    __tablename__ = 'reviews'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    # Review direction
    reviewer_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    reviewee_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    review_type = Column(String(30), nullable=False)  # 'surfer_to_photographer', 'photographer_to_surfer'
    
    # Session type this review is for
    session_type = Column(String(20), nullable=True)  # 'live', 'on_demand', 'scheduled'
    
    # Link to session â€” supports all 3 session types
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
        # Prevent duplicate reviews â€” uses composite of all session ID columns
        Index('ix_review_unique_v2', 'reviewer_id', 'reviewee_id', 'live_session_id', 'booking_id', 'dispatch_id', unique=True),
    )


# ============ GAMIFICATION ENGINE ============


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

