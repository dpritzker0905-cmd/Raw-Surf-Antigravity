"""Anchor observers for surf truth (David's yes, 2026-11-16 09:16 EST): trusted observers whose reports set the
scale everyone else is calibrated against. Replaces the SURF_TRUTH_ANCHOR_IDS environment variable.

- `surf_truth_anchors`: one row per anchor, with its CURRENT status: 'active' (sets the scale), 'probation' (recorded,
  watched, does not set the scale) or 'suspended' (treated as an ordinary observer).
- `surf_truth_anchor_events`: the append-only log of every appointment and status change, with who did it and why.
  On Postgres, triggers refuse UPDATE and DELETE (row level) and TRUNCATE (statement level) for EVERY role, the
  database owner the backend connects as included; the Supabase service key (service_role) is also granted only
  SELECT and INSERT. Exactly what remains possible: an owner or superuser acting OUTSIDE the app could drop the
  triggers (or run with triggers disabled) and then rewrite it. No code path in the app does either.

Both tables are private (RLS on, no anon/authenticated grants). Status changes go only through
services/surf_truth_anchors.set_status, which writes the row and its log line together.
"""
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, DDL, ForeignKey, String, Text, event

from database import Base
from .base import generate_uuid


def _now():
    return datetime.now(timezone.utc)


class SurfTruthAnchor(Base):
    __tablename__ = 'surf_truth_anchors'

    profile_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), primary_key=True)
    status = Column(String(16), nullable=False)
    status_since = Column(DateTime(timezone=True), nullable=False, default=_now)
    appointed_at = Column(DateTime(timezone=True), nullable=False, default=_now)
    appointed_by = Column(String(36), nullable=True)


class SurfTruthAnchorEvent(Base):
    __tablename__ = 'surf_truth_anchor_events'

    id = Column(String(36), primary_key=True, default=generate_uuid)
    profile_id = Column(String(36), nullable=False, index=True)  # no FK: the log outlives a deleted profile
    from_status = Column(String(16), nullable=True)               # None for an appointment
    to_status = Column(String(16), nullable=False)
    actor_id = Column(String(36), nullable=False)
    reason = Column(Text, nullable=False)
    at = Column(DateTime(timezone=True), nullable=False, default=_now, index=True)


_LOCKS = {
    SurfTruthAnchor.__table__: 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %(fullname)s TO service_role',
    # The log: read and append only, even for the backend's own role.
    SurfTruthAnchorEvent.__table__: 'GRANT SELECT, INSERT ON TABLE %(fullname)s TO service_role',
}
for _table, _grant in _LOCKS.items():
    for _statement in (
        'ALTER TABLE %(fullname)s ENABLE ROW LEVEL SECURITY',
        'REVOKE ALL ON TABLE %(fullname)s FROM anon, authenticated, service_role',
        _grant,
    ):
        event.listen(_table, 'after_create', DDL(_statement).execute_if(dialect='postgresql'))

# Append-only, enforced by the database: any UPDATE, DELETE or TRUNCATE on the log raises (TRUNCATE does not fire
# row-level triggers, so it has its own statement-level one).
APPEND_ONLY_FUNCTION = (
    "CREATE OR REPLACE FUNCTION surf_truth_anchor_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ "
    "BEGIN RAISE EXCEPTION 'surf_truth_anchor_events is append-only'; END; $$"
)
APPEND_ONLY_TRIGGER = (
    "CREATE TRIGGER surf_truth_anchor_events_no_rewrite BEFORE UPDATE OR DELETE ON %(fullname)s "
    "FOR EACH ROW EXECUTE FUNCTION surf_truth_anchor_events_append_only()"
)
NO_TRUNCATE_TRIGGER = (
    "CREATE TRIGGER surf_truth_anchor_events_no_truncate BEFORE TRUNCATE ON %(fullname)s "
    "FOR EACH STATEMENT EXECUTE FUNCTION surf_truth_anchor_events_append_only()"
)
for _statement in (APPEND_ONLY_FUNCTION, APPEND_ONLY_TRIGGER, NO_TRUNCATE_TRIGGER):
    event.listen(SurfTruthAnchorEvent.__table__, 'after_create', DDL(_statement).execute_if(dialect='postgresql'))
