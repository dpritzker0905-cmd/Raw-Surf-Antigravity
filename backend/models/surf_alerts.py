"""Surf reports, alerts, push subscriptions, notification preferences."""
from sqlalchemy import Column, String, Integer, Float, Boolean, ForeignKey, DateTime, Date, Enum, Text, Index, JSON
from sqlalchemy.orm import relationship, backref
from database import Base
from datetime import datetime, timezone

from .base import generate_uuid
from .enums import *
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
    water_temp = Column(String(50), nullable=True)  # e.g., "72Â°F", "Cold", "Warm"
    
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

