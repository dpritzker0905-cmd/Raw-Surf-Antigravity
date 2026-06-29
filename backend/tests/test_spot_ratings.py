"""Unit tests for the P1 per-spot ratings: the shared compute helpers + the precomputed-frame selector
(services/weather_pipeline/spot_ratings.py) and the API response schema (routes/weather.py).

The live endpoint + the cron precompute share spot_ratings.rate_one_spot (the parity rule); the resolve_point
round-trip needs the data stack, so these cover the pure pieces.
"""
import os
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")

import asyncio
from datetime import datetime, timezone

from services.weather_pipeline import spot_ratings as sr
from services.weather_pipeline.spot_ratings import (
    spot_confidence, rating_why, select_precomputed, _lng_in, build_l2_object, SPOT_RATINGS_L2_KEY,
    precompute_spot_ratings,
)
from routes.weather import SpotRatingItem, SpotRatingsResponse


# ── confidence ──
def test_confidence_high_when_verified_peak_or_flag():
    assert spot_confidence("verified", False) == "high"
    assert spot_confidence("unverified", True) == "high"


def test_confidence_low_for_low_accuracy_or_crowdsourced():
    assert spot_confidence("low_accuracy", False) == "low"
    assert spot_confidence("crowdsourced", False) == "low"


def test_confidence_medium_default():
    assert spot_confidence("unverified", False) == "medium"
    assert spot_confidence(None, False) == "medium"   # missing metadata -> medium, not a crash


# ── why ──
def test_why_none_when_nothing_to_rate():
    assert rating_why("unknown", None, None, None, None, None) is None
    assert rating_why("good", None, 12.0, 4.0, 200.0, 90.0) is None  # no surf height


def test_why_offshore_onshore_cross():
    assert "offshore" in rating_why("good", 1.2, 13.0, 5.0, 270.0, 90.0)   # wind FROM 270, seaward 90 -> offshore
    assert "onshore" in rating_why("fair", 1.0, 10.0, 5.0, 90.0, 90.0)     # wind FROM the seaward side -> onshore
    assert "cross-shore" in rating_why("fair", 1.0, 10.0, 5.0, 0.0, 90.0)


def test_why_includes_surf_height_in_feet_and_period():
    s = rating_why("good", 1.2, 14.0, None, None, None)
    assert "ft surf" in s and "14s period" in s


# ── precomputed-frame selector ──
def _obj(frames):
    return build_l2_object(frames)


def test_select_precomputed_none_when_no_object_or_no_frame():
    assert select_precomputed(None, (-82, 24, -79, 28), "GFS", "t0") is None
    assert select_precomputed({}, (-82, 24, -79, 28), "GFS", "t0") is None
    obj = _obj([{"model": "GFS", "valid_time": "t0", "spots": []}])
    assert select_precomputed(obj, (-82, 24, -79, 28), "ICON", "t0") is None  # model mismatch
    assert select_precomputed(obj, (-82, 24, -79, 28), "GFS", "t9") is None   # time mismatch


def test_select_precomputed_filters_to_bbox():
    frame = {"model": "GFS", "valid_time": "t0", "spots": [
        {"spot_id": "in", "latitude": 26.0, "longitude": -80.0, "score": 50, "level": "fair"},
        {"spot_id": "out-lat", "latitude": 40.0, "longitude": -80.0, "score": 50, "level": "fair"},
        {"spot_id": "out-lng", "latitude": 26.0, "longitude": -120.0, "score": 50, "level": "fair"},
    ]}
    sel = select_precomputed(_obj([frame]), (-82, 24, -79, 28), "GFS", "t0")
    assert [s["spot_id"] for s in sel] == ["in"]


def test_select_precomputed_returns_empty_list_not_none_when_frame_matches_but_no_spots_in_bbox():
    frame = {"model": "GFS", "valid_time": "t0", "spots": [
        {"spot_id": "far", "latitude": 1.0, "longitude": 1.0, "score": 10, "level": "poor"},
    ]}
    sel = select_precomputed(_obj([frame]), (-82, 24, -79, 28), "GFS", "t0")
    assert sel == []   # frame exists (don't fall back to live) but nothing in view


def test_select_precomputed_tolerant_nearest_time_match():
    # The precompute keyed the frame at 21:00Z; a request 40 min later should still hit it (within 2h).
    frame = {"model": "GFS", "valid_time": "2026-06-28T21:00:00Z", "spots": [
        {"spot_id": "in", "latitude": 26.0, "longitude": -80.0, "score": 50, "level": "fair"},
    ]}
    sel = select_precomputed(_obj([frame]), (-82, 24, -79, 28), "GFS", "2026-06-28T21:40:00Z")
    assert sel is not None and [s["spot_id"] for s in sel] == ["in"]


def test_select_precomputed_outside_tolerance_falls_back():
    # A request 5h away from the only frame → no match → None (caller falls back to live).
    frame = {"model": "GFS", "valid_time": "2026-06-28T21:00:00Z", "spots": [
        {"spot_id": "in", "latitude": 26.0, "longitude": -80.0, "score": 50, "level": "fair"},
    ]}
    assert select_precomputed(_obj([frame]), (-82, 24, -79, 28), "GFS", "2026-06-29T02:00:00Z") is None


# ── antimeridian-aware longitude test ──
def test_lng_in_normal_and_wrapped():
    assert _lng_in(-80, -82, -79) is True
    assert _lng_in(-100, -82, -79) is False
    # wrapped bbox west=170 east=-170 (crosses the dateline)
    assert _lng_in(175, 170, -170) is True
    assert _lng_in(-175, 170, -170) is True
    assert _lng_in(0, 170, -170) is False


# ── API schema ──
def test_response_schema_roundtrips():
    item = SpotRatingItem(spot_id="2c958ffd-8f5f-483c-83bd-63ac79f9ab07", latitude=27.0, longitude=-80.0,
                          score=72.5, level="good", confidence="high", surf_height_m=1.2, period_s=13.0, why="clean")
    resp = SpotRatingsResponse(model="GFS", valid_time="2026-06-28T21:00:00Z", count=1, source="precomputed", spots=[item])
    assert resp.count == 1 and resp.spots[0].level == "good" and resp.source == "precomputed"
    blank = SpotRatingItem(spot_id="abc-123", latitude=10.0, longitude=20.0)
    assert blank.score is None and blank.level == "unknown"


def test_l2_object_shape():
    obj = build_l2_object([{"model": "GFS", "valid_time": "t0", "spots": []}])
    assert obj["version"] == 1 and "generated_at" in obj and len(obj["frames"]) == 1
    assert SPOT_RATINGS_L2_KEY.endswith(".json")


# ── precompute → L2 object → endpoint selector round-trip (increment 3) ──
def test_precompute_round_trips_through_select(monkeypatch):
    """The CI precompute (precompute_spot_ratings) must build frames the live endpoint's selector reads back —
    same model, tolerant valid_time, bbox-filtered. Mocks rate_one_spot so it needs no data stack."""
    spots = [
        {"id": "a", "name": "A", "latitude": 26.0, "longitude": -80.0, "accuracy_flag": "verified", "is_verified_peak": True},
        {"id": "b", "name": "B", "latitude": 40.0, "longitude": -80.0, "accuracy_flag": None, "is_verified_peak": False},  # outside the FL bbox
    ]

    async def fake_rate(resolver, spot, model, valid_time):
        return {
            "spot_id": str(spot["id"]), "name": spot["name"],
            "latitude": spot["latitude"], "longitude": spot["longitude"],
            "score": 55.0, "level": "fair", "confidence": "high",
            "surf_height_m": 1.0, "period_s": 12.0, "why": "x",
        }

    monkeypatch.setattr(sr, "rate_one_spot", fake_rate)
    base = datetime(2026, 6, 28, 21, 0, 0, tzinfo=timezone.utc)
    obj = asyncio.run(precompute_spot_ratings(None, spots, ["GFS"], [0], base_dt=base))

    assert obj["version"] == 1 and len(obj["frames"]) == 1
    fr = obj["frames"][0]
    assert fr["model"] == "GFS" and fr["valid_time"] == "2026-06-28T21:00:00Z" and len(fr["spots"]) == 2

    # The endpoint reads it back: 20-min-off request still hits (tolerant), filtered to the FL bbox (a in, b out).
    sel = select_precomputed(obj, (-82, 24, -79, 28), "GFS", "2026-06-28T21:20:00Z")
    assert sel is not None and [s["spot_id"] for s in sel] == ["a"]
    # An hour with no frame falls back to live (None).
    assert select_precomputed(obj, (-82, 24, -79, 28), "GFS", "2026-06-29T05:00:00Z") is None
