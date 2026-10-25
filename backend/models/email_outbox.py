"""Transactional email outbox + suppression list (email service foundation).

Render runs uvicorn only and never runs Alembic, so these tables are created by the startup self-heal
(`server.ensure_database_tables` -> `Base.metadata.create_all`); the Alembic revision exists so a
migrated database converges on the same shape.

PRIVACY: `recipient_hash` is what every lookup uses (suppression, rate limits). `recipient_address` and
`payload` exist ONLY so a queued message can be retried; the worker clears both once the message reaches a
terminal state, so a delivered row keeps no address and no token.
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, Index, Integer, JSON, String

from database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


class EmailOutbox(Base):
    __tablename__ = "email_outbox"

    id = Column(String(36), primary_key=True, default=_uuid)
    template = Column(String(64), nullable=False)
    recipient_hash = Column(String(64), nullable=False, index=True)
    recipient_address = Column(String(320), nullable=True)   # cleared at a terminal state
    payload = Column(JSON(none_as_null=True), nullable=True)                   # template params; cleared at a terminal state
    status = Column(String(16), nullable=False, default="queued")  # queued | sent | failed | suppressed
    attempts = Column(Integer, nullable=False, default=0)
    idempotency_key = Column(String(200), nullable=False, unique=True)
    provider_message_id = Column(String(128), nullable=True)
    last_error = Column(String(64), nullable=True)           # a short code, never an address or a body
    claimed_until = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=_now, index=True)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=_now, onupdate=_now)

    __table_args__ = (Index("ix_email_outbox_status_created", "status", "created_at"),)


class EmailSuppression(Base):
    __tablename__ = "email_suppressions"

    id = Column(String(36), primary_key=True, default=_uuid)
    recipient_hash = Column(String(64), nullable=False, unique=True)
    reason = Column(String(16), nullable=False)              # bounce | complaint | manual
    created_at = Column(DateTime(timezone=True), nullable=False, default=_now)
