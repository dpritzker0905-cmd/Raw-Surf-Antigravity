"""Anchor observers for surf truth (David's yes, 2026-11-16 09:16 EST): trusted observers whose reports set the
scale everyone else is calibrated against. Replaces the SURF_TRUTH_ANCHOR_IDS environment variable.

- `surf_truth_anchors`: one row per anchor, with its CURRENT status: 'active' (sets the scale), 'probation' (recorded,
  watched, does not set the scale) or 'suspended' (treated as an ordinary observer).
- `surf_truth_anchor_events`: the append-only log of every appointment and status change, with who did it and why.
  On Postgres a trigger refuses UPDATE and DELETE on it, so the history cannot be rewritten even by the backend.

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


for _table in (SurfTruthAnchor.__table__, SurfTruthAnchorEvent.__table__):
    for _statement in (
        'ALTER TABLE %(fullname)s ENABLE ROW LEVEL SECURITY',
        'REVOKE ALL ON TABLE %(fullname)s FROM anon, authenticated',
        'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %(fullname)s TO service_role',
    ):
        event.listen(_table, 'after_create', DDL(_statement).execute_if(dialect='postgresql'))

# Append-only, enforced by the database: any UPDATE or DELETE on the log raises.
APPEND_ONLY_FUNCTION = (
    "CREATE OR REPLACE FUNCTION surf_truth_anchor_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ "
    "BEGIN RAISE EXCEPTION 'surf_truth_anchor_events is append-only'; END; $$"
)
APPEND_ONLY_TRIGGER = (
    "CREATE TRIGGER surf_truth_anchor_events_no_rewrite BEFORE UPDATE OR DELETE ON %(fullname)s "
    "FOR EACH ROW EXECUTE FUNCTION surf_truth_anchor_events_append_only()"
)
for _statement in (APPEND_ONLY_FUNCTION, APPEND_ONLY_TRIGGER):
    event.listen(SurfTruthAnchorEvent.__table__, 'after_create', DDL(_statement).execute_if(dialect='postgresql'))
