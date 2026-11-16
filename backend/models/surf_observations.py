"""Blind surf-height observations (T1 crowd truth, P1) and the server's own record of uploaded report media.

Both tables are PRIVATE: row-level security on, no grants to anon/authenticated, so PostgREST cannot expose them.
Only the backend (service role) reads or writes them. Nothing here is served to other users.

`surf_observations` is the truth stream for the surf science. Every column that decides whether a row is trustworthy
is set by the SERVER: `source`, `forecast_shown_before`, `received_at`, the scale default, the face-metre conversion,
and every provenance check. The client supplies only what the surfer saw (number or range, unit, scale, typical vs
sets) and which screen they used.
"""
from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, DDL, Float, ForeignKey, Index, String, Text, UniqueConstraint, event

from database import Base
from .base import generate_uuid


def _now():
    return datetime.now(timezone.utc)


class SurfObservation(Base):
    __tablename__ = 'surf_observations'

    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    spot_id = Column(String(36), ForeignKey('surf_spots.id', ondelete='SET NULL'), nullable=True, index=True)

    # Who: 'anchor' (a named trusted observer, server allowlist), 'photographer' or 'surfer' (from the profile role).
    observer_role = Column(String(16), nullable=False)

    # Where it was entered and which parent row it belongs to ('checkin' | 'condition_report' | 'surf_report').
    # `flow` names the capture path: 'blind_v1' for this form. Legacy rows imported later get 'legacy_report' or
    # 'legacy_composer' (never truth: the composer could prefill OUR forecast).
    flow = Column(String(24), nullable=False, default='blind_v1')
    surface = Column(String(32), nullable=False)
    entry_screen = Column(String(48), nullable=False)
    ref_id = Column(String(36), nullable=True, index=True)

    # What the observer entered, exactly.
    height_value = Column(Float, nullable=True)
    height_unit = Column(String(4), nullable=True)
    height_bucket = Column(String(16), nullable=True)
    height_scale = Column(String(16), nullable=False)
    set_or_avg = Column(String(16), nullable=False)

    # Server-derived. face_m* is the entry converted to metres of FACE height in the observer's DECLARED scale and
    # sense (typical or sets), with no typical-to-H1/10 factor and no scale uncertainty applied: those are model terms
    # in the offline aggregator (P4), which reads the raw columns above. `normalization_version` names the rule.
    scale_default = Column(String(16), nullable=False)
    scale_overridden = Column(Boolean, nullable=False, default=False)
    normalization_version = Column(String(16), nullable=False)
    face_m = Column(Float, nullable=False)
    face_m_low = Column(Float, nullable=False)
    face_m_high = Column(Float, nullable=True)
    input_kind = Column(String(8), nullable=False)
    source = Column(String(16), nullable=False, default='observed')
    forecast_shown_before = Column(Boolean, nullable=True)
    received_at = Column(DateTime(timezone=True), nullable=False, default=_now, index=True)  # authoritative time
    observed_at_device = Column(DateTime(timezone=True), nullable=True)  # the device clock's word; never trusted alone

    # Provenance (server-checked).
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    gps_distance_m = Column(Float, nullable=True)
    gps_check = Column(String(16), nullable=False)
    media_url = Column(String(500), nullable=True)
    media_sha256 = Column(String(64), nullable=True, index=True)
    exif_distance_m = Column(Float, nullable=True)
    exif_age_s = Column(Float, nullable=True)
    exif_check = Column(String(16), nullable=False)
    duplicate_of = Column(String(36), nullable=True)
    flags = Column(Text, nullable=False, default='')  # comma-separated, sorted

    # One observation per parent report, enforced by the database too (the route's read-then-insert can race).
    # A NULL ref_id (a check-in observation made after today's check-in already existed) is not constrained.
    __table_args__ = (Index('ix_surf_observations_spot_received', 'spot_id', 'received_at'),
                      UniqueConstraint('surface', 'ref_id', name='uq_surf_observations_surface_ref'))


class ObservationMedia(Base):
    """What the server itself read from an uploaded report photo, BEFORE storage: its hash and EXIF position/time.

    Written by the upload route; looked up by (user_id, media_url) when an observation references the media, so the
    EXIF numbers are read by the server and cannot be sent as JSON. LIMIT: EXIF lives inside the file, and anyone who
    edits a file's EXIF before uploading can forge it. These checks catch carelessness and casual reuse (a photo from
    another beach or another day, the same photo twice); they are a consistency check, not proof of place or time.
    """
    __tablename__ = 'observation_media'

    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey('profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    media_url = Column(String(500), nullable=False, index=True)
    media_type = Column(String(16), nullable=False)
    sha256 = Column(String(64), nullable=False, index=True)
    exif_latitude = Column(Float, nullable=True)
    exif_longitude = Column(Float, nullable=True)
    exif_taken_at = Column(DateTime(timezone=True), nullable=True)
    uploaded_at = Column(DateTime(timezone=True), nullable=False, default=_now)


# The startup bootstrap creates missing model tables; lock each new table in that SAME transaction so PostgREST
# never exposes it to anon/authenticated clients between steps (the strava_oauth_states pattern).
for _table in (SurfObservation.__table__, ObservationMedia.__table__):
    for _statement in (
        'ALTER TABLE %(fullname)s ENABLE ROW LEVEL SECURITY',
        'REVOKE ALL ON TABLE %(fullname)s FROM anon, authenticated',
        'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %(fullname)s TO service_role',
    ):
        event.listen(_table, 'after_create', DDL(_statement).execute_if(dialect='postgresql'))
