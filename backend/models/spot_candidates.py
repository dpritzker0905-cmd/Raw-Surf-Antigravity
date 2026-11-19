"""The surf-spot HOLDING TABLE (David, 2026-11-18): candidate spots wait here to be reviewed by a person.

    "we should put those spots into a separate holding table that can hold the 23,732 spots to be reviewed"

Nothing in this table is a surf spot. A row here is never read by the map, the forecast, the ratings precompute, search
or any public route. A candidate becomes a spot only when a person promotes it (one candidate, one transaction, in a
later change); nothing here is ever bulk-copied into `surf_spots`, and nothing here overwrites an existing pin.

- The SOURCE fields (`name`, `latitude`, `longitude`, `country`, `source_labels`) are what the source said and are
  never edited. A person's better position goes in `proposed_latitude` / `proposed_longitude`.
- The DUPLICATE fields (`tier`, `nearest_spot_*`, `name_match_spot_*`) are a snapshot from load time, written by
  `services/spot_candidates.classify`. They sort the review queue; promotion re-checks against the live table.
- The spot ids are plain strings, NOT foreign keys, on purpose: `surf_spots` already has 24 referencing tables and
  merge tools that hard-delete rows from a hand-kept list of them. A 25th reference would make those tools fail.

Private: row security on, no anon/authenticated grants, the Supabase service key may only read.
"""
from datetime import datetime, timezone

from sqlalchemy import (JSON, CheckConstraint, Column, DateTime, DDL, Float, Index, String, Text, UniqueConstraint,
                        event)

from database import Base
from .base import generate_uuid

# Duplicate tiers, first that applies (measured on 26,308 Foursquare records, 2026-11-18: A 49, B 444, C 357,
# D 1,460, E 266, F 23,732). A/B/E = probable duplicate, C/D = near neighbour, F = no existing spot nearby.
TIERS = ("A", "B", "C", "D", "E", "F")

# pending: waiting for a person. held: looked at, undecided. rejected: not a surf break. duplicate: an existing spot
# (duplicate_of_spot_id says which). promoted: a person made it a spot (promoted_spot_id says which).
STATUSES = ("pending", "held", "rejected", "duplicate", "promoted")


def _now():
    return datetime.now(timezone.utc)


def _in(column, values):
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


class SurfSpotCandidate(Base):
    __tablename__ = 'surf_spot_candidates'

    id = Column(String(36), primary_key=True, default=generate_uuid)

    # Where the record came from. (source, source_record_id) is the identity: loading a file twice adds nothing.
    source = Column(String(32), nullable=False)
    source_record_id = Column(String(128), nullable=False)
    source_licence = Column(String(64), nullable=False)
    source_attribution = Column(Text, nullable=False)
    batch_id = Column(String(64), nullable=False, index=True)

    # What the source said. Never edited.
    name = Column(String(255), nullable=False)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    country = Column(String(100), nullable=True, index=True)
    source_labels = Column(JSON, nullable=True)

    # Duplicate check against the catalogue at load time (hidden spots included).
    tier = Column(String(1), nullable=False, index=True)
    nearest_spot_id = Column(String(36), nullable=True)
    nearest_spot_name = Column(String(255), nullable=True)
    nearest_spot_km = Column(Float, nullable=True)
    name_match_spot_id = Column(String(36), nullable=True)
    name_match_spot_name = Column(String(255), nullable=True)
    name_match_km = Column(Float, nullable=True)
    shoreline_km = Column(Float, nullable=True)          # distance to the nearest ocean shoreline, when measured

    # The placement helper's SUGGESTION: the nearest ocean shoreline point, worked out offline at load time
    # (scripts/spot_candidate_shoreline.py). A machine's guess; it is never used as a spot's position unless a
    # person takes it.
    suggested_latitude = Column(Float, nullable=True)
    suggested_longitude = Column(Float, nullable=True)
    suggested_method = Column(String(32), nullable=True)  # 'nearest_shoreline'

    # A PERSON's position (they take the suggestion, or drag the pin to the break).
    proposed_latitude = Column(Float, nullable=True)
    proposed_longitude = Column(Float, nullable=True)
    proposed_method = Column(String(32), nullable=True)   # 'shoreline_suggestion' or 'manual'
    proposed_by = Column(String(36), nullable=True)
    proposed_at = Column(DateTime(timezone=True), nullable=True)

    # Review.
    status = Column(String(16), nullable=False, default='pending', index=True)
    review_note = Column(Text, nullable=True)
    reviewed_by = Column(String(36), nullable=True)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    duplicate_of_spot_id = Column(String(36), nullable=True)
    promoted_spot_id = Column(String(36), nullable=True, unique=True)   # one candidate makes at most one spot

    created_at = Column(DateTime(timezone=True), nullable=False, default=_now)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=_now, onupdate=_now)

    __table_args__ = (
        UniqueConstraint('source', 'source_record_id', name='uq_surf_spot_candidates_source_record'),
        CheckConstraint(_in('tier', TIERS), name='ck_surf_spot_candidates_tier'),
        CheckConstraint(_in('status', STATUSES), name='ck_surf_spot_candidates_status'),
        CheckConstraint('latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180',
                        name='ck_surf_spot_candidates_coordinate'),
        CheckConstraint('(proposed_latitude IS NULL) = (proposed_longitude IS NULL)',
                        name='ck_surf_spot_candidates_proposed_pair'),
        CheckConstraint('(suggested_latitude IS NULL) = (suggested_longitude IS NULL)',
                        name='ck_surf_spot_candidates_suggested_pair'),
        # A promoted row names its spot, and only a promoted row does.
        CheckConstraint("(status = 'promoted') = (promoted_spot_id IS NOT NULL)",
                        name='ck_surf_spot_candidates_promoted'),
        Index('ix_surf_spot_candidates_queue', 'status', 'tier', 'country'),
    )


for _statement in (
    'ALTER TABLE %(fullname)s ENABLE ROW LEVEL SECURITY',
    'REVOKE ALL ON TABLE %(fullname)s FROM anon, authenticated, service_role',
    'GRANT SELECT ON TABLE %(fullname)s TO service_role',
):
    event.listen(SurfSpotCandidate.__table__, 'after_create', DDL(_statement).execute_if(dialect='postgresql'))
