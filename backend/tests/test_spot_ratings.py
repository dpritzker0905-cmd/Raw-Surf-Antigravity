"""Unit tests for the P1 per-spot ratings endpoint helpers (routes/weather.py).

The endpoint itself wires a DB query + resolve_point ×2 + compute_surf_rating; these cover the pure pieces
(confidence from spot accuracy metadata, the explainability string, and the response schema) without the DB.
"""
import os
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")

from routes.weather import _spot_confidence, _rating_why, SpotRatingItem, SpotRatingsResponse


def _spot(**kw):
    return type("S", (), kw)()


def test_confidence_high_when_verified_peak_or_flag():
    assert _spot_confidence(_spot(accuracy_flag="verified", is_verified_peak=False)) == "high"
    assert _spot_confidence(_spot(accuracy_flag="unverified", is_verified_peak=True)) == "high"


def test_confidence_low_for_low_accuracy_or_crowdsourced():
    assert _spot_confidence(_spot(accuracy_flag="low_accuracy", is_verified_peak=False)) == "low"
    assert _spot_confidence(_spot(accuracy_flag="crowdsourced", is_verified_peak=False)) == "low"


def test_confidence_medium_default():
    assert _spot_confidence(_spot(accuracy_flag="unverified", is_verified_peak=False)) == "medium"
    assert _spot_confidence(_spot()) == "medium"  # missing metadata -> medium, not a crash


def test_why_none_when_nothing_to_rate():
    assert _rating_why("unknown", None, None, None, None, None) is None
    assert _rating_why("good", None, 12.0, 4.0, 200.0, 90.0) is None  # no surf height


def test_why_offshore_onshore_cross():
    # shore-normal points seaward at 90° (E). Wind FROM 270° (W) == blowing toward the sea == OFFSHORE.
    assert "offshore" in _rating_why("good", 1.2, 13.0, 5.0, 270.0, 90.0)
    # Wind FROM 90° (E, the seaward side) == blowing onto the beach == ONSHORE.
    assert "onshore" in _rating_why("fair", 1.0, 10.0, 5.0, 90.0, 90.0)
    # Wind FROM the north, shore-normal E == cross-shore.
    assert "cross-shore" in _rating_why("fair", 1.0, 10.0, 5.0, 0.0, 90.0)


def test_why_includes_surf_height_in_feet_and_period():
    s = _rating_why("good", 1.2, 14.0, None, None, None)
    assert "ft surf" in s and "14s period" in s


def test_response_schema_roundtrips():
    # spot_id is a UUID string (SurfSpot.id), not an int.
    item = SpotRatingItem(spot_id="2c958ffd-8f5f-483c-83bd-63ac79f9ab07", latitude=27.0, longitude=-80.0,
                          score=72.5, level="good", confidence="high", surf_height_m=1.2, period_s=13.0, why="clean")
    resp = SpotRatingsResponse(model="GFS", valid_time="2026-06-28T21:00:00Z", count=1, source="live", spots=[item])
    assert resp.count == 1 and resp.spots[0].level == "good"
    # An unrated spot (no surf) is allowed with score=None / level 'unknown'.
    blank = SpotRatingItem(spot_id="abc-123", latitude=10.0, longitude=20.0)
    assert blank.score is None and blank.level == "unknown"
