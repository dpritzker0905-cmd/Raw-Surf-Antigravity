"""Second-factor state: one row per enrolled user, single-use recovery codes, and login challenges.

Nothing here is ever sent to a client. The TOTP secret is stored encrypted (core/mfa_secrets.py), recovery codes and
challenge tokens only as keyed / plain hashes. See docs/runbooks/MFA-DESIGN.md.
"""
from datetime import datetime, timezone

from sqlalchemy import BigInteger, Column, DateTime, DDL, ForeignKey, Integer, String, Text, event

from database import Base
from .base import generate_uuid


def _now():
    return datetime.now(timezone.utc)


class UserMfa(Base):
    __tablename__ = 'user_mfa'
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), primary_key=True)
    totp_secret_enc = Column(Text, nullable=True)  # Fernet token; never the plain secret
    totp_confirmed_at = Column(DateTime(timezone=True), nullable=True)  # NULL = enrolment started, not finished
    totp_last_step = Column(BigInteger, nullable=True)  # newest accepted 30 s step: replay guard
    totp_failed_count = Column(Integer, nullable=True, default=0)  # wrong codes in the current window
    totp_failed_window_start = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now)
    updated_at = Column(DateTime(timezone=True), default=_now, onupdate=_now)


class MfaRecoveryCode(Base):
    __tablename__ = 'mfa_recovery_codes'
    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    code_hash = Column(String(64), nullable=False)  # HMAC-SHA256 hex
    used_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now)


class MfaChallenge(Base):
    """The bridge between 'password accepted' and 'session issued'. Single use, short lived, attempt counted."""
    __tablename__ = 'mfa_challenges'
    token_hash = Column(String(64), primary_key=True)  # SHA-256 of the opaque token handed to the client
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    purpose = Column(String(16), nullable=False, default='login')
    expires_at = Column(DateTime(timezone=True), nullable=False, index=True)
    attempts = Column(Integer, nullable=False, default=0)
    consumed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now)


# The bootstrap creates missing model tables. Lock these down in the SAME transaction so PostgREST cannot expose
# secrets or hashes to anon/authenticated clients between steps (same pattern as StravaOAuthState).
for _model in (UserMfa, MfaRecoveryCode, MfaChallenge):
    for _statement in (
        'ALTER TABLE %(fullname)s ENABLE ROW LEVEL SECURITY',
        'REVOKE ALL ON TABLE %(fullname)s FROM anon, authenticated',
        'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %(fullname)s TO service_role',
    ):
        event.listen(_model.__table__, 'after_create', DDL(_statement).execute_if(dialect='postgresql'))
