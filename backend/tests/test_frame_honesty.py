"""Goldens for stamp_frame_honesty — the §0c serving-honesty fields (2026-07-14).

Contract under test: /grid's `valid_time` keeps ECHOING the ask (load-bearing frontend
contract), while served_valid_time / frame_offset_hours / frame_substituted carry the truth
about which frame actually served. The frame-skew postmortem showed a ±3h substitution serving
as if exact for hours because no field carried the served frame's time.
"""
from datetime import datetime, timezone
from types import SimpleNamespace

from services.weather_pipeline.grid_resolver import stamp_frame_honesty


def make_product(frame_dt):
    return SimpleNamespace(
        valid_time=frame_dt,
        product_id="euro_marine_waves_florida_east_coast_20260714T090000Z.json",
        served_valid_time=None,
        frame_offset_hours=0.0,
        frame_substituted=False,
    )


ASK = datetime(2026, 7, 14, 12, 0, tzinfo=timezone.utc)


def test_substituted_frame_reports_truth():
    # The live skew shape: T09 frame served for a 12Z ask.
    p = make_product(datetime(2026, 7, 14, 9, 0, tzinfo=timezone.utc))
    stamp_frame_honesty(p, ASK, "2026-07-14T12:00:00Z")
    assert p.served_valid_time == "2026-07-14T09:00:00Z"
    assert p.frame_offset_hours == -3.0
    assert p.frame_substituted is True


def test_exact_frame_is_not_flagged():
    p = make_product(ASK)
    stamp_frame_honesty(p, ASK, "2026-07-14T12:00:00Z")
    assert p.served_valid_time == "2026-07-14T12:00:00Z"
    assert p.frame_offset_hours == 0.0
    assert p.frame_substituted is False


def test_sub_30min_offset_not_flagged_but_reported():
    # Small snapping offsets are normal — reported honestly, not flagged as substitution.
    p = make_product(datetime(2026, 7, 14, 12, 20, tzinfo=timezone.utc))
    stamp_frame_honesty(p, ASK, "2026-07-14T12:00:00Z")
    assert p.frame_offset_hours == 0.33
    assert p.frame_substituted is False


def test_future_frame_offset_is_signed_positive():
    p = make_product(datetime(2026, 7, 14, 15, 0, tzinfo=timezone.utc))
    stamp_frame_honesty(p, ASK, "2026-07-14T12:00:00Z")
    assert p.frame_offset_hours == 3.0
    assert p.frame_substituted is True


def test_never_raises_on_naive_aware_mismatch_or_missing_time():
    # A naive frame datetime against an aware ask must not fail the serve — defaults survive.
    p = make_product(datetime(2026, 7, 14, 9, 0))  # naive
    stamp_frame_honesty(p, ASK, "2026-07-14T12:00:00Z")
    assert p.frame_substituted is False and p.served_valid_time is None
    p2 = make_product(None)
    stamp_frame_honesty(p2, ASK, "2026-07-14T12:00:00Z")
    assert p2.served_valid_time is None
