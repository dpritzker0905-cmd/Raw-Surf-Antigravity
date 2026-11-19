"""Consent to use a person's surf observations to improve Raw Surf's forecasts (T1 P3).

`surf_truth_consent_events` is the append-only history of every grant and withdrawal: who, on or off, which wording
(`version`), from where, and when. The CURRENT consent is the newest event; no event means no consent (opt-in).
The history is the proof of consent, so it is kept after an account deletion, like ToS acknowledgements.

On Postgres, triggers refuse UPDATE, DELETE and TRUNCATE for every role (the anchor-event pattern), and the service
key is granted only SELECT and INSERT. Private: RLS on, no anon/authenticated grants.
"""
from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, DDL, String, event

from database import Base
from .base import generate_uuid


def _now():
    return datetime.now(timezone.utc)


class SurfTruthConsentEvent(Base):
    __tablename__ = 'surf_truth_consent_events'

    id = Column(String(36), primary_key=True, default=generate_uuid)
    profile_id = Column(String(36), nullable=False, index=True)  # no FK: proof of consent outlives the profile
    granted = Column(Boolean, nullable=False)
    version = Column(String(32), nullable=False)                 # which wording the person saw
    source = Column(String(32), nullable=False)                  # the screen that recorded it
    at = Column(DateTime(timezone=True), nullable=False, default=_now, index=True)


for _statement in (
    'ALTER TABLE %(fullname)s ENABLE ROW LEVEL SECURITY',
    'REVOKE ALL ON TABLE %(fullname)s FROM anon, authenticated, service_role',
    'GRANT SELECT, INSERT ON TABLE %(fullname)s TO service_role',
    "CREATE OR REPLACE FUNCTION surf_truth_consent_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ "
    "BEGIN RAISE EXCEPTION 'surf_truth_consent_events is append-only'; END; $$",
    "CREATE TRIGGER surf_truth_consent_events_no_rewrite BEFORE UPDATE OR DELETE ON %(fullname)s "
    "FOR EACH ROW EXECUTE FUNCTION surf_truth_consent_events_append_only()",
    "CREATE TRIGGER surf_truth_consent_events_no_truncate BEFORE TRUNCATE ON %(fullname)s "
    "FOR EACH STATEMENT EXECUTE FUNCTION surf_truth_consent_events_append_only()",
):
    event.listen(SurfTruthConsentEvent.__table__, 'after_create', DDL(_statement).execute_if(dialect='postgresql'))
