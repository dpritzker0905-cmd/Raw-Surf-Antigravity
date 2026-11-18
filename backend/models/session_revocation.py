"""One row per account whose sessions were revoked: every token ISSUED at or before `revoked_at` is refused.

Tokens are stateless JWTs that live 30 days (core/security.ACCESS_TOKEN_EXPIRE_DAYS). Without this, a deleted account's
token kept working for up to a month (advisor limit on #1022). See core/session_revocation for how it is checked.
"""
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, String

from database import Base


def _now():
    return datetime.now(timezone.utc)


class SessionRevocation(Base):
    __tablename__ = 'session_revocations'
    profile_id = Column(String(36), primary_key=True)          # no FK: the cutoff must outlive any profile change
    revoked_at = Column(DateTime(timezone=True), nullable=False, default=_now, index=True)
    reason = Column(String(40), nullable=False, default='account_deleted')
