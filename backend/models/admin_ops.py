"""Admin ops: tickets, promos, feature flags, campaigns, system health, platform config."""
from sqlalchemy import Column, String, Integer, Float, Boolean, ForeignKey, DateTime, Date, Enum, Text, Index, JSON
from sqlalchemy.orm import relationship, backref
from database import Base
from datetime import datetime, timezone

from .base import generate_uuid
from .enums import *
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

