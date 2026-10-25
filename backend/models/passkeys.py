"""Passkeys: registered credentials and short-lived ceremonies (the server-side half of a WebAuthn challenge).

A credential row holds only the PUBLIC key. A ceremony row holds the challenge it issued, the relying-party id and
origin it was opened with (verification uses these, never the request's), and is single use. See
docs/runbooks/MFA-DESIGN.md.
"""
from datetime import datetime, timezone

from sqlalchemy import BigInteger, Column, DateTime, DDL, ForeignKey, String, Text, event

from database import Base
from .base import generate_uuid


def _now():
    return datetime.now(timezone.utc)


class WebauthnCredential(Base):
    __tablename__ = 'webauthn_credentials'
    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    credential_id = Column(String(1024), nullable=False, unique=True)  # base64url, as the browser reports it
    public_key = Column(Text, nullable=False)  # base64url COSE key
    sign_count = Column(BigInteger, nullable=False, default=0)
    rp_id = Column(String(255), nullable=False)  # the relying party it was created for; dev and prod differ
    name = Column(String(80), nullable=False, default='Passkey')
    transports = Column(Text, nullable=True)  # JSON list, a hint for the browser's picker
    created_at = Column(DateTime(timezone=True), default=_now)
    last_used_at = Column(DateTime(timezone=True), nullable=True)


class WebauthnCeremony(Base):
    __tablename__ = 'webauthn_ceremonies'
    token_hash = Column(String(64), primary_key=True)  # SHA-256 of the opaque ceremony id given to the client
    purpose = Column(String(16), nullable=False)  # register | login | mfa
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=True, index=True)
    challenge = Column(String(256), nullable=False)  # base64url
    rp_id = Column(String(255), nullable=False)
    origin = Column(String(255), nullable=False)
    mfa_challenge_hash = Column(String(64), nullable=True)  # purpose=mfa: the sign-in challenge it belongs to
    expires_at = Column(DateTime(timezone=True), nullable=False, index=True)
    consumed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now)


for _model in (WebauthnCredential, WebauthnCeremony):
    for _statement in (
        'ALTER TABLE %(fullname)s ENABLE ROW LEVEL SECURITY',
        'REVOKE ALL ON TABLE %(fullname)s FROM anon, authenticated',
        'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %(fullname)s TO service_role',
    ):
        event.listen(_model.__table__, 'after_create', DDL(_statement).execute_if(dialect='postgresql'))
