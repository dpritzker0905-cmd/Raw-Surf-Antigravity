"""Bounded payment recovery evidence, separate from immutable money ledgers."""
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, DDL, ForeignKey, Integer, String, event

from database import Base
from .base import generate_uuid


class PaymentReconciliationCase(Base):
    __tablename__ = 'payment_reconciliation_cases'

    id = Column(String(36), primary_key=True, default=generate_uuid)
    transaction_id = Column(String(36), ForeignKey('payment_transactions.id'), nullable=False, unique=True)
    session_id = Column(String(255), nullable=False, unique=True)
    payment_intent_id = Column(String(255), nullable=True)
    amount_cents = Column(Integer, nullable=False)
    currency = Column(String(10), nullable=False)
    reason = Column(String(80), nullable=False)
    state = Column(String(30), nullable=False, default='open', index=True)
    refund_id = Column(String(255), nullable=True)
    refund_started_at = Column(DateTime(timezone=True), nullable=True)
    last_error_type = Column(String(100), nullable=True)
    resolved_by = Column(String(36), ForeignKey('profiles.id'), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc), nullable=False)


for statement in (
    'ALTER TABLE %(fullname)s ENABLE ROW LEVEL SECURITY',
    'REVOKE ALL ON TABLE %(fullname)s FROM anon, authenticated',
    'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %(fullname)s TO service_role',
):
    event.listen(PaymentReconciliationCase.__table__, 'after_create', DDL(statement).execute_if(dialect='postgresql'))
