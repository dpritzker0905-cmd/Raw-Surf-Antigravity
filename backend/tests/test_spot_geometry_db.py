"""Geometry-as-DB-state (2026-07-30, owner-approved schema): the staleness contract.

Pins the two behaviors that make the columns safe: only FINE sources are frozen into rows (a
coarse bearing is runtime-derivable and median-22.3° wrong — freezing it would outlive the coarse
grid's own improvements), and a moved pin invalidates its own fit while a gate-REJECTED pin does
NOT re-queue (re-running reproduces the rejection, measured 24/24 — the pin must move first)."""
from datetime import datetime, timezone

from services.weather_pipeline.spot_geometry_db import (
    MOVED_THRESHOLD_M, geometry_row_from_resolution, needs_geometry_refresh,
)

NOW = datetime(2026, 7, 30, 22, 0, tzinfo=timezone.utc)


def test_fine_sources_freeze_coarse_and_none_do_not():
    row = geometry_row_from_resolution(27.862, -80.4464, 68.2, "etopo", 12.5, 5.6, now=NOW)
    assert row["shore_normal_deg"] == 68.2
    assert row["shore_normal_spread_deg"] == 12.5
    assert row["break_depth_m"] == 5.6
    assert row["geometry_source"] == "etopo"
    assert row["geometry_lat"] == 27.862 and row["geometry_lng"] == -80.4464
    ov = geometry_row_from_resolution(21.66, -158.05, 325.0, "override:North Shore", None, 8.0, now=NOW)
    assert ov["geometry_source"].startswith("override")
    assert geometry_row_from_resolution(1.0, 2.0, 111.5, "coarse", None, None, now=NOW) is None
    assert geometry_row_from_resolution(1.0, 2.0, None, "none", None, None, now=NOW) is None
    assert geometry_row_from_resolution(1.0, 2.0, None, "etopo", None, 5.0, now=NOW) is None


def test_never_resolved_and_moved_requeue_but_rejected_does_not():
    base = {"latitude": 27.862, "longitude": -80.4464}
    assert needs_geometry_refresh({**base, "geometry_resolved_at": None}) == "never_resolved"
    # rejected pins wait for a HUMAN to move them — re-running reproduces the rejection
    assert needs_geometry_refresh({**base, "geometry_resolved_at": None,
                                   "geometry_reject_reason": "spot_misplaced_inland"}) is None
    current = {**base, "geometry_resolved_at": "2026-07-30T22:00:00Z",
               "geometry_lat": 27.862, "geometry_lng": -80.4464}
    assert needs_geometry_refresh(current) is None
    # a ~100 m nudge stays current; a real move re-queues
    assert needs_geometry_refresh({**current, "latitude": 27.8629}) is None
    moved = {**current, "latitude": 27.9, "longitude": -80.5}
    assert needs_geometry_refresh(moved) == "moved"
    # resolved_at without the anchor coordinates cannot prove currency -> re-resolve
    assert needs_geometry_refresh({**base, "geometry_resolved_at": "2026-07-30T22:00:00Z",
                                   "geometry_lat": None, "geometry_lng": None}) == "never_resolved"


def test_threshold_is_metres_not_degrees():
    lat = 27.862
    current = {"latitude": lat, "longitude": -80.4464,
               "geometry_resolved_at": "2026-07-30T22:00:00Z",
               "geometry_lat": lat, "geometry_lng": -80.4464}
    # ~0.001 deg latitude = ~111 m < threshold; ~0.002 deg = ~222 m > threshold
    assert MOVED_THRESHOLD_M == 150.0
    assert needs_geometry_refresh({**current, "latitude": lat + 0.001}) is None
    assert needs_geometry_refresh({**current, "latitude": lat + 0.002}) == "moved"
