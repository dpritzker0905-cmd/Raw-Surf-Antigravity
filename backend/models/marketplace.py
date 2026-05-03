"""Marketplace: photographer subscriptions, photo subs, ad config."""
from sqlalchemy import Column, String, Integer, Float, Boolean, ForeignKey, DateTime, Date, Enum, Text, Index, JSON
from sqlalchemy.orm import relationship, backref
from database import Base
from datetime import datetime, timezone

from .base import generate_uuid
from .enums import *
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

    # â”€â”€ Content Quotas (per period) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    photos_included = Column(Integer, default=0)       # Gallery photos included
    videos_included = Column(Integer, default=0)       # Gallery videos included
    live_session_buyins = Column(Integer, default=0)   # Free live-session jump-ins
    sessions_included = Column(Integer, default=0)     # Scheduled booking sessions included

    # â”€â”€ Service Discounts (percentage off regular rates) â”€â”€â”€â”€â”€â”€
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

    # â”€â”€ Snapshot of plan details at time of purchase â”€â”€â”€â”€â”€â”€â”€â”€â”€
    plan_name = Column(String(100), nullable=True)
    plan_interval = Column(String(10), nullable=True)   # 'weekly' or 'monthly'
    plan_price = Column(Float, nullable=True)

    # â”€â”€ Subscription lifecycle â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    status = Column(String(20), default='active')       # active, expired, cancelled
    started_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    expires_at = Column(DateTime(timezone=True), nullable=False)

    # â”€â”€ Remaining quotas (decremented on use) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    photos_remaining = Column(Integer, default=0)
    videos_remaining = Column(Integer, default=0)
    live_session_buyins_remaining = Column(Integer, default=0)
    sessions_remaining = Column(Integer, default=0)

    # â”€â”€ Discount snapshots (locked at purchase) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    booking_discount_pct = Column(Float, default=0.0)
    on_demand_discount_pct = Column(Float, default=0.0)

    # â”€â”€ Payment â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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


# ============================================================
# SURF LOG â€” "BACKPACK" PERSONAL SESSION JOURNAL
# ============================================================


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

