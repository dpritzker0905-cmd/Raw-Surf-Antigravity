"""Payment transactions, credit tracking, and pricing config."""
from sqlalchemy import Column, String, Integer, Float, Boolean, ForeignKey, DateTime, Date, Enum, Text, Index, JSON
from sqlalchemy.orm import relationship, backref
from database import Base
from datetime import datetime, timezone

from .base import generate_uuid
from .enums import *
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

