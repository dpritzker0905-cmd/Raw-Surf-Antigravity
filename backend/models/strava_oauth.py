"""Durable, one-use Strava linking state; stores only a hash of the browser nonce."""
from sqlalchemy import Column, DateTime, DDL, ForeignKey, String, event
from database import Base


class StravaOAuthState(Base):
    __tablename__ = 'strava_oauth_states'
    state_hash = Column(String(64), primary_key=True)
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    expires_at = Column(DateTime(timezone=True), nullable=False, index=True)
    consumed_at = Column(DateTime(timezone=True), nullable=True)


# The existing bootstrap creates missing model tables. Protect this new table in that SAME
# transaction so PostgREST cannot expose states to anon/authenticated clients between steps.
for statement in (
    'ALTER TABLE %(fullname)s ENABLE ROW LEVEL SECURITY',
    'REVOKE ALL ON TABLE %(fullname)s FROM anon, authenticated',
    'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %(fullname)s TO service_role',
):
    event.listen(StravaOAuthState.__table__, 'after_create', DDL(statement).execute_if(dialect='postgresql'))
