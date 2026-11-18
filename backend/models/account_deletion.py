"""A deletion request with a 30-day restore window (David, 2026-11-18: "hold a deleted account ... eligible for a restore,
for 30 days"). One row per account; services/account_deletion.py owns the rules."""
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, String

from database import Base


def _now():
    return datetime.now(timezone.utc)


class AccountDeletion(Base):
    __tablename__ = 'account_deletions'
    profile_id = Column(String(36), primary_key=True)
    status = Column(String(12), nullable=False, default='pending', index=True)   # pending | restored | purged
    requested_at = Column(DateTime(timezone=True), nullable=False, default=_now)
    purge_after = Column(DateTime(timezone=True), nullable=False, index=True)
    restore_token_hash = Column(String(64), nullable=True)        # SHA-256 of the emailed token; never the token
    restored_at = Column(DateTime(timezone=True), nullable=True)
    purged_at = Column(DateTime(timezone=True), nullable=True)
