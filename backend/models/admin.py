"""Admin: disputes, reports, blocks, audits, fraud, ToS, verification."""
from sqlalchemy import Column, String, Integer, Float, Boolean, ForeignKey, DateTime, Date, Enum, Text, Index, JSON
from sqlalchemy.orm import relationship, backref
from database import Base
from datetime import datetime, timezone

from .base import generate_uuid
from .enums import *
class Dispute(Base):
    """Dispute resolution system for conflicts between users"""
    __tablename__ = 'disputes'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    # Parties involved
    complainant_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    respondent_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Dispute details
    dispute_type = Column(String(30), nullable=False)  # DisputeTypeEnum
    status = Column(String(30), default='open')  # DisputeStatusEnum
    priority = Column(String(20), default='normal')  # low, normal, high, urgent
    
    # Related entities (optional - link to specific transaction)
    booking_id = Column(String(36), ForeignKey('bookings.id', ondelete='SET NULL'), nullable=True)
    live_session_id = Column(String(36), ForeignKey('live_sessions.id', ondelete='SET NULL'), nullable=True)
    gallery_item_id = Column(String(36), nullable=True)
    transaction_id = Column(String(36), ForeignKey('credit_transactions.id', ondelete='SET NULL'), nullable=True)
    
    # Content
    subject = Column(String(200), nullable=False)
    description = Column(Text, nullable=False)
    evidence_urls = Column(JSON, default=list)  # Screenshots, photos as evidence
    
    # Resolution
    amount_disputed = Column(Float, nullable=True)  # Dollar amount in question
    amount_refunded = Column(Float, nullable=True)  # Credit refunded (to account balance)
    amount_stripe_refunded = Column(Float, nullable=True)  # Actual Stripe refund (escalations only)
    resolution_notes = Column(Text, nullable=True)
    resolved_by = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    
    # Auto-created from report?
    source_report_id = Column(String(36), ForeignKey('user_reports.id', ondelete='SET NULL'), nullable=True)
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    
    # Relationships
    complainant = relationship('Profile', foreign_keys=[complainant_id], backref='disputes_filed')
    respondent = relationship('Profile', foreign_keys=[respondent_id], backref='disputes_against')
    resolver = relationship('Profile', foreign_keys=[resolved_by])



class DisputeMessage(Base):
    """Messages within a dispute thread"""
    __tablename__ = 'dispute_messages'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    dispute_id = Column(String(36), ForeignKey('disputes.id', ondelete='CASCADE'), nullable=False, index=True)
    sender_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False)
    
    message = Column(Text, nullable=False)
    attachment_urls = Column(JSON, default=list)
    is_admin = Column(Boolean, default=False)  # True if sent by admin
    is_internal = Column(Boolean, default=False)  # Internal admin notes (not visible to users)
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    # Relationships
    dispute = relationship('Dispute', backref='messages')
    sender = relationship('Profile')



class UserReport(Base):
    """User-submitted reports for content and users"""
    __tablename__ = 'user_reports'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    # Reporter
    reporter_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # What's being reported
    report_type = Column(String(20), nullable=False)  # 'user', 'post', 'photo', 'comment', 'message'
    reported_user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=True, index=True)
    reported_content_id = Column(String(36), nullable=True)  # ID of post/photo/comment
    reported_content_type = Column(String(30), nullable=True)  # 'post', 'gallery_item', 'comment', 'message'
    
    # Report details
    reason = Column(String(30), nullable=False)  # ReportReasonEnum
    description = Column(Text, nullable=True)
    evidence_urls = Column(JSON, default=list)
    
    # Status & resolution
    status = Column(String(20), default='pending')  # ReportStatusEnum
    priority = Column(String(20), default='normal')  # low, normal, high, urgent
    
    # Admin handling
    reviewed_by = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    action_taken = Column(String(50), nullable=True)  # 'warning_sent', 'content_removed', 'user_suspended', 'user_banned', 'no_action'
    admin_notes = Column(Text, nullable=True)
    
    # Auto-escalate to dispute?
    escalated_to_dispute = Column(Boolean, default=False)
    dispute_id = Column(String(36), ForeignKey('disputes.id', ondelete='SET NULL'), nullable=True)
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    
    # Relationships
    reporter = relationship('Profile', foreign_keys=[reporter_id], backref='user_reports_submitted')
    reported_user = relationship('Profile', foreign_keys=[reported_user_id], backref='user_reports_received')
    reviewer = relationship('Profile', foreign_keys=[reviewed_by])



class UserBlock(Base):
    """
    User blocking system - when a user blocks another user:
    - Blocked user cannot message the blocker
    - Blocked user cannot see blocker's posts/content
    - Blocked user cannot follow/interact with blocker
    - Mutual blocks prevent all interaction
    
    Integrates with TOS violation system for repeated harassment
    """
    __tablename__ = 'user_blocks'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    # Who is blocking whom
    blocker_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    blocked_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Reason for blocking (optional, helps with TOS integration)
    reason = Column(String(50), nullable=True)  # harassment, spam, inappropriate, scam, other
    notes = Column(Text, nullable=True)  # User's private notes about why they blocked
    
    # Auto-report to admin if block reason is severe
    auto_reported = Column(Boolean, default=False)
    report_id = Column(String(36), ForeignKey('user_reports.id', ondelete='SET NULL'), nullable=True)
    
    # Admin review (for patterns of blocking - user being blocked by many people)
    admin_reviewed = Column(Boolean, default=False)
    admin_notes = Column(Text, nullable=True)
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    
    # Relationships
    blocker = relationship('Profile', foreign_keys=[blocker_id], backref='blocks_created')
    blocked = relationship('Profile', foreign_keys=[blocked_id], backref='blocks_received')
    
    # Unique constraint - can only block someone once
    __table_args__ = (
        Index('ix_user_blocks_blocker_blocked', 'blocker_id', 'blocked_id', unique=True),
    )



class PayoutHold(Base):
    """Holds on photographer payouts for fraud protection"""
    __tablename__ = 'payout_holds'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    photographer_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Hold details
    amount = Column(Float, nullable=False)  # Amount being held
    reason = Column(String(30), nullable=False)  # PayoutHoldReasonEnum
    description = Column(Text, nullable=True)
    
    # Related entities
    dispute_id = Column(String(36), ForeignKey('disputes.id', ondelete='SET NULL'), nullable=True)
    transaction_id = Column(String(36), ForeignKey('credit_transactions.id', ondelete='SET NULL'), nullable=True)
    
    # Status
    is_active = Column(Boolean, default=True)
    released_at = Column(DateTime(timezone=True), nullable=True)
    released_by = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True)
    release_notes = Column(Text, nullable=True)
    
    # Auto-release after X days?
    auto_release_date = Column(DateTime(timezone=True), nullable=True)
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    created_by = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True)
    
    # Relationships
    photographer = relationship('Profile', foreign_keys=[photographer_id], backref='payout_holds')
    creator = relationship('Profile', foreign_keys=[created_by])
    releaser = relationship('Profile', foreign_keys=[released_by])



class AuditLog(Base):
    """Comprehensive audit log for all platform actions"""
    __tablename__ = 'audit_logs'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    # Who performed the action
    actor_id = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True, index=True)
    actor_email = Column(String(255), nullable=True)  # Stored separately in case user is deleted
    actor_role = Column(String(50), nullable=True)
    is_admin_action = Column(Boolean, default=False)
    is_system_action = Column(Boolean, default=False)  # Automated system actions
    
    # What happened
    category = Column(String(30), nullable=False)  # AuditLogCategoryEnum
    action = Column(String(100), nullable=False)  # e.g., 'user_banned', 'refund_issued', 'content_removed'
    description = Column(Text, nullable=True)
    
    # Target of the action
    target_type = Column(String(50), nullable=True)  # 'user', 'post', 'dispute', 'payout', etc.
    target_id = Column(String(36), nullable=True)
    target_email = Column(String(255), nullable=True)  # For user targets
    
    # Changes made (JSON diff)
    old_value = Column(JSON, nullable=True)
    new_value = Column(JSON, nullable=True)
    
    # Context
    ip_address = Column(String(50), nullable=True)
    user_agent = Column(String(500), nullable=True)
    request_id = Column(String(36), nullable=True)  # For correlating related actions
    
    # Extra context data
    extra_data = Column(JSON, default=dict)  # Any additional context
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    
    # Relationships
    actor = relationship('Profile', backref='audit_logs')
    
    __table_args__ = (
        Index('ix_audit_category_created', 'category', 'created_at'),
        Index('ix_audit_target', 'target_type', 'target_id'),
        Index('ix_audit_actor_created', 'actor_id', 'created_at'),
    )



# ============ P1 ADMIN FEATURES ============


class VerificationRequest(Base):
    """Identity verification requests for Pro Surfers and Approved Pro Photographers"""
    __tablename__ = 'verification_requests'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    verification_type = Column(String(50), nullable=False)  # VerificationTypeEnum
    status = Column(String(30), default='pending')  # VerificationStatusEnum
    
    # Pro Surfer specific fields
    wsl_athlete_id = Column(String(100), nullable=True)
    wsl_profile_url = Column(String(500), nullable=True)
    competition_history_urls = Column(JSON, default=list)  # List of competition result URLs
    
    # Pro Photographer specific fields
    instagram_url = Column(String(500), nullable=True)
    portfolio_website = Column(String(500), nullable=True)
    other_social_urls = Column(JSON, default=list)  # Twitter, YouTube, etc.
    media_mentions = Column(JSON, default=list)  # Articles, publications featuring their work
    professional_equipment = Column(Text, nullable=True)  # Description of gear
    years_experience = Column(Integer, nullable=True)
    business_registration = Column(String(500), nullable=True)  # Business license URL if applicable
    
    # Common fields
    photo_id_url = Column(String(500), nullable=True)  # Government ID for identity match
    additional_notes = Column(Text, nullable=True)  # User's additional info
    sample_work_urls = Column(JSON, default=list)  # Portfolio samples
    
    # Admin review fields
    reviewed_by = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    admin_notes = Column(Text, nullable=True)  # Internal admin notes
    rejection_reason = Column(Text, nullable=True)  # Reason shown to user if rejected
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    
    # Relationships
    user = relationship('Profile', foreign_keys=[user_id], backref='verification_requests')
    reviewer = relationship('Profile', foreign_keys=[reviewed_by])



class ImpersonationSession(Base):
    """Audit trail for admin impersonation sessions"""
    __tablename__ = 'impersonation_sessions'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    admin_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    target_user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Session details
    reason = Column(Text, nullable=True)  # Why admin is impersonating
    started_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    ended_at = Column(DateTime(timezone=True), nullable=True)
    
    # Actions taken during impersonation (for audit)
    actions_log = Column(JSON, default=list)  # List of actions performed
    is_read_only = Column(Boolean, default=True)  # Whether write actions were allowed
    
    # Context
    ip_address = Column(String(50), nullable=True)
    user_agent = Column(String(500), nullable=True)
    
    # Relationships
    admin = relationship('Profile', foreign_keys=[admin_id], backref='impersonation_sessions_as_admin')
    target_user = relationship('Profile', foreign_keys=[target_user_id], backref='impersonation_sessions_as_target')



class FraudAlert(Base):
    """Fraud detection alerts for suspicious user behavior"""
    __tablename__ = 'fraud_alerts'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    alert_type = Column(String(50), nullable=False)  # FraudAlertTypeEnum
    severity = Column(String(20), default='medium')  # low, medium, high, critical
    
    # Alert details
    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=False)
    evidence = Column(JSON, default=dict)  # Supporting data for the alert
    
    # Risk scoring
    risk_score = Column(Integer, default=50)  # 0-100 score
    
    # Resolution
    status = Column(String(30), default='open')  # open, investigating, resolved, false_positive
    resolved_by = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    resolution_notes = Column(Text, nullable=True)
    action_taken = Column(String(50), nullable=True)  # none, warning, suspended, banned
    
    # Auto-generated or manual
    is_automated = Column(Boolean, default=True)
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    
    # Relationships
    user = relationship('Profile', foreign_keys=[user_id], backref='fraud_alerts')
    resolver = relationship('Profile', foreign_keys=[resolved_by])


# ============ TOS COMPLIANCE & STRIKE SYSTEM ============


class TosViolation(Base):
    """
    Terms of Service violations with progressive strike system.
    Strike thresholds:
    - 1 strike: Warning
    - 2 strikes: 7-day suspension
    - 3 strikes: 30-day suspension  
    - 4+ strikes: Permanent ban
    """
    __tablename__ = 'tos_violations'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Violation details
    violation_type = Column(String(50), nullable=False)  # TosViolationTypeEnum
    severity = Column(String(20), default='minor')       # minor, moderate, severe, critical
    strike_points = Column(Integer, default=1)           # Points added (minor=1, moderate=2, severe=3, critical=5)
    
    # Evidence
    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=False)
    evidence = Column(JSON, default=dict)  # Screenshots, GPS logs, etc.
    
    # Related entities (if applicable)
    related_type = Column(String(50), nullable=True)  # booking, post, review, dispatch
    related_id = Column(String(36), nullable=True)
    
    # Location data (for location fraud)
    claimed_latitude = Column(Float, nullable=True)
    claimed_longitude = Column(Float, nullable=True)
    actual_latitude = Column(Float, nullable=True)
    actual_longitude = Column(Float, nullable=True)
    distance_discrepancy_miles = Column(Float, nullable=True)
    
    # Action taken
    action_taken = Column(String(50), default='warning')  # warning, suspension_7d, suspension_30d, permanent_ban
    suspension_until = Column(DateTime(timezone=True), nullable=True)
    
    # Audit
    reported_by = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True)  # User who reported
    reviewed_by = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True)  # Admin who reviewed
    
    # Appeal
    is_appealed = Column(Boolean, default=False)
    appeal_text = Column(Text, nullable=True)
    appeal_status = Column(String(20), nullable=True)  # pending, approved, denied
    appeal_reviewed_by = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True)
    appeal_reviewed_at = Column(DateTime(timezone=True), nullable=True)
    
    # Status
    status = Column(String(20), default='active')  # active, appealed, overturned, expired
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    
    # Relationships
    user = relationship('Profile', foreign_keys=[user_id], backref='tos_violations')
    reporter = relationship('Profile', foreign_keys=[reported_by])
    reviewer = relationship('Profile', foreign_keys=[reviewed_by])
    appeal_reviewer = relationship('Profile', foreign_keys=[appeal_reviewed_by])



class TosAcknowledgement(Base):
    """
    Track when users acknowledge/accept ToS updates.
    Required before using features that changed in ToS.
    """
    __tablename__ = 'tos_acknowledgements'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    tos_version = Column(String(20), nullable=False)  # e.g., "2.0", "2.1"
    
    # What was acknowledged
    section = Column(String(100), nullable=True)  # e.g., "location_verification", "gallery_pricing"
    
    # Context
    ip_address = Column(String(50), nullable=True)
    user_agent = Column(String(500), nullable=True)
    
    acknowledged_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    # Relationships
    user = relationship('Profile', backref='tos_acknowledgements')
    
    __table_args__ = (
        Index('ix_tos_ack_user_version', 'user_id', 'tos_version'),
    )



class UserActivityLog(Base):
    """Comprehensive user activity tracking for journey timeline"""
    __tablename__ = 'user_activity_logs'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Activity details
    activity_type = Column(String(50), nullable=False)  # signup, login, post, booking, purchase, etc.
    activity_category = Column(String(30), nullable=False)  # auth, content, financial, social, settings
    description = Column(String(500), nullable=False)
    
    # Related entities
    related_type = Column(String(50), nullable=True)  # post, booking, transaction, etc.
    related_id = Column(String(36), nullable=True)
    
    # Context
    ip_address = Column(String(50), nullable=True)
    user_agent = Column(String(500), nullable=True)
    location_lat = Column(Float, nullable=True)
    location_lng = Column(Float, nullable=True)
    
    # Metadata
    extra_data = Column(JSON, default=dict)
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
    
    # Relationships
    user = relationship('Profile', backref='activity_logs')
    
    __table_args__ = (
        Index('ix_activity_user_created', 'user_id', 'created_at'),
        Index('ix_activity_type_created', 'activity_type', 'created_at'),
    )


class TosContent(Base):
    """
    Admin-managed Terms of Service and Privacy Policy content.
    Stored in Supabase so admins can edit without code deploys.
    Each row is a versioned document (tos or privacy).
    """
    __tablename__ = 'tos_content'
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    
    # Document type: 'tos' or 'privacy'
    doc_type = Column(String(20), nullable=False, index=True)
    
    # Versioning
    version = Column(String(20), nullable=False)  # e.g., "1.0", "2.0"
    
    # Content stored as JSON array of sections: [{title, body}]
    sections = Column(JSON, nullable=False, default=list)
    
    # Metadata
    effective_date = Column(String(50), nullable=True)  # e.g., "May 2026"
    is_active = Column(Boolean, default=False, index=True)  # Only one active per doc_type
    
    # Audit
    created_by = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True)
    updated_by = Column(String(36), ForeignKey('profiles.id', ondelete='SET NULL'), nullable=True)
    
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    
    # Relationships
    creator = relationship('Profile', foreign_keys=[created_by])
    updater = relationship('Profile', foreign_keys=[updated_by])
    
    __table_args__ = (
        Index('ix_tos_content_type_version', 'doc_type', 'version', unique=True),
        Index('ix_tos_content_active', 'doc_type', 'is_active'),
    )



# ============ P2 ADMIN FEATURES ============

