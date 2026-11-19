"""One row per account whose sessions were revoked: every token ISSUED at or before `revoked_at` is refused.

Tokens are stateless JWTs that live 30 days (core/security.ACCESS_TOKEN_EXPIRE_DAYS). Without this, a deleted account's
token kept working for up to a month (advisor limit on #1022). See core/session_revocation for how it is checked.
"""
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, DDL, String, event

from database import Base


def _now():
    return datetime.now(timezone.utc)


import core.session_revocation  # noqa: E402,F401 - registers the revoke-on-change database hook with the models


class SessionRevocation(Base):
    __tablename__ = 'session_revocations'
    profile_id = Column(String(36), primary_key=True)          # no FK: the cutoff must outlive any profile change
    revoked_at = Column(DateTime(timezone=True), nullable=False, default=_now, index=True)
    reason = Column(String(40), nullable=False, default='account_deleted')


# Locked like the MFA tables (advisor hold on #1057): the browser holds a Supabase client, so without this a row written
# from outside the backend could end anyone's sessions, or a deleted row revive a revoked one. Only the backend's
# service role may read or write; created in the same transaction as the table.
for _statement in (
    'ALTER TABLE %(fullname)s ENABLE ROW LEVEL SECURITY',
    'REVOKE ALL ON TABLE %(fullname)s FROM anon, authenticated',
    'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %(fullname)s TO service_role',
):
    event.listen(SessionRevocation.__table__, 'after_create', DDL(_statement).execute_if(dialect='postgresql'))
