"""Durable checkout identity and frozen creation parameters; never provider secrets."""
from datetime import datetime, timezone
from sqlalchemy import Column, String, Integer, ForeignKey, DateTime, JSON, UniqueConstraint, DDL, event
from database import Base
from .base import generate_uuid


class CheckoutIntent(Base):
    __tablename__ = 'checkout_intents'
    __table_args__ = (UniqueConstraint('user_id', 'request_key', name='uq_checkout_intent_request'),)
    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey('profiles.id'), nullable=False, index=True)
    transaction_id = Column(String(36), ForeignKey('payment_transactions.id'), nullable=False, unique=True)
    booking_id = Column(String(36), ForeignKey('bookings.id'), nullable=True)
    kind = Column(String(30), nullable=False)
    request_key = Column(String(64), nullable=False)
    fingerprint = Column(String(64), nullable=False)
    amount_cents = Column(Integer, nullable=False)
    provider_params = Column(JSON, nullable=False)
    response_data = Column(JSON, nullable=False)
    state = Column(String(30), default='prepared', nullable=False, index=True)
    session_id = Column(String(255), nullable=True, unique=True)
    first_attempt_at = Column(DateTime(timezone=True), nullable=True)
    last_error_type = Column(String(80), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc), nullable=False)


for statement in ('ALTER TABLE %(fullname)s ENABLE ROW LEVEL SECURITY',
                  'REVOKE ALL ON TABLE %(fullname)s FROM anon, authenticated',
                  'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %(fullname)s TO service_role'):
    event.listen(CheckoutIntent.__table__, 'after_create', DDL(statement).execute_if(dialect='postgresql'))
