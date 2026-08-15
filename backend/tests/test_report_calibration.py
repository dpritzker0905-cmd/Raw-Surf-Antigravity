"""
Unit tests for services/weather_pipeline/report_calibration.py — forward rating-vs-report calibration.
Pure helpers: height/label parsing, score→stars, report normalize, match, compare, aggregate, prune.
"""
from datetime import datetime, timezone, timedelta
import pytest

from services.weather_pipeline import report_calibration as rc


def test_parse_observed_height_m_numeric_and_labels():
    assert rc.parse_observed_height_m("3-4ft") == pytest.approx(3.5 / rc.FT_PER_M, abs=1e-3)
    assert rc.parse_observed_height_m("2ft") == pytest.approx(2.0 / rc.FT_PER_M, abs=1e-3)
    assert rc.parse_observed_height_m("3-4") == pytest.approx(3.5 / rc.FT_PER_M, abs=1e-3)  # default feet
    assert rc.parse_observed_height_m("1.5m") == pytest.approx(1.5, abs=1e-3)               # already metres
    assert rc.parse_observed_height_m("Waist High") == pytest.approx(3.0 / rc.FT_PER_M, abs=1e-3)
    assert rc.parse_observed_height_m("Overhead") == pytest.approx(7.0 / rc.FT_PER_M, abs=1e-3)
    assert rc.parse_observed_height_m("head high") == pytest.approx(5.5 / rc.FT_PER_M, abs=1e-3)
    assert rc.parse_observed_height_m("flat") == 0.0
    assert rc.parse_observed_height_m("") is None and rc.parse_observed_height_m(None) is None
    assert rc.parse_observed_height_m("glassy fun") is None


def test_score_to_stars():
    assert rc.score_to_stars(0) == 1.0
    assert rc.score_to_stars(50) == 3.0
    assert rc.score_to_stars(100) == 5.0
    assert rc.score_to_stars(None) is None


def test_report_datetime_combines_date_and_time():
    dt = rc.report_datetime("2026-06-28", "06:30")
    assert dt.year == 2026 and dt.hour == 6 and dt.minute == 30 and dt.tzinfo is not None
    midday = rc.report_datetime("2026-06-28", None)
    assert midday.hour == 12                                  # missing time -> midday
    assert rc.report_datetime(None, "06:30") is None


def test_normalize_report():
    r = rc.normalize_report({"spot_id": "s1", "session_date": "2026-06-28", "session_time": "07:00",
                             "conditions_rating": 4, "wave_height": "3-4ft"})
    assert r["spot_id"] == "s1" and r["observed_rating"] == 4.0
    assert r["observed_height_m"] == pytest.approx(3.5 / rc.FT_PER_M, abs=1e-3)
    # no spot, or neither rating nor height -> dropped
    assert rc.normalize_report({"spot_id": None, "session_date": "2026-06-28"}) is None
    assert rc.normalize_report({"spot_id": "s1", "session_date": "2026-06-28",
                                "conditions_rating": None, "wave_height": None}) is None
    # rating out of range ignored, but a height keeps it
    r2 = rc.normalize_report({"spot_id": "s1", "session_date": "2026-06-28", "conditions_rating": 9,
                              "wave_height": "2ft"})
    assert r2["observed_rating"] is None and r2["observed_height_m"] is not None


def test_match_reports_nearest_within_tolerance():
    base = datetime(2026, 6, 28, 12, 0, tzinfo=timezone.utc)
    archive = [
        {"spot_id": "s1", "valid_time": base.isoformat(), "score": 60, "surf_height_m": 1.2},
        {"spot_id": "s1", "valid_time": (base + timedelta(hours=5)).isoformat(), "score": 30, "surf_height_m": 0.6},
        {"spot_id": "s2", "valid_time": base.isoformat(), "score": 80, "surf_height_m": 2.0},
    ]
    reports = [
        {"spot_id": "s1", "time": base + timedelta(hours=1), "observed_rating": 3, "observed_height_m": 1.0},
        {"spot_id": "s2", "time": base + timedelta(hours=20), "observed_rating": 4, "observed_height_m": 2.1},  # >6h → no match
        {"spot_id": "s3", "time": base, "observed_rating": 2, "observed_height_m": 0.5},                        # no archive
    ]
    pairs = rc.match_reports(reports, archive)
    assert len(pairs) == 1
    r, p = pairs[0]
    assert r["spot_id"] == "s1" and p["score"] == 60        # nearest (1h) not the 4h-away one


def test_compare_and_aggregate():
    base = datetime(2026, 6, 28, 12, 0, tzinfo=timezone.utc)
    pairs = [
        ({"spot_id": "s1", "time": base, "observed_rating": 3, "observed_height_m": 1.0},
         {"score": 75, "surf_height_m": 1.3}),     # pred 4★ vs 3 → +1; height +0.3
        ({"spot_id": "s2", "time": base, "observed_rating": 5, "observed_height_m": 2.0},
         {"score": 50, "surf_height_m": 1.5}),     # pred 3★ vs 5 → -2; height -0.5
    ]
    c = rc.compare_pair(*pairs[0])
    assert c["star_err"] == pytest.approx(1.0) and c["height_err_m"] == pytest.approx(0.3)
    agg = rc.aggregate_pairs(pairs)
    assert agg["n_matched"] == 2
    assert agg["star_mae"] == pytest.approx((1.0 + 2.0) / 2, abs=1e-3)
    assert agg["star_bias"] == pytest.approx((1.0 - 2.0) / 2, abs=1e-3)   # net model slightly LOW here
    assert agg["height_mae_m"] == pytest.approx((0.3 + 0.5) / 2, abs=1e-3)
    assert agg["height_n"] == 2


def test_aggregate_empty():
    agg = rc.aggregate_pairs([])
    assert agg["n_matched"] == 0 and agg["star_mae"] is None and agg["height_mae_m"] is None


def test_prune_archive_age_and_cap():
    now = datetime(2026, 6, 28, 12, 0, tzinfo=timezone.utc)
    old = (now - timedelta(days=30)).isoformat()
    recent = [{"spot_id": f"s{i}", "valid_time": (now - timedelta(hours=i)).isoformat(), "score": 50}
              for i in range(5)]
    entries = recent + [{"spot_id": "old", "valid_time": old, "score": 10}]
    pruned = rc.prune_archive(entries, now=now)
    assert all(e["spot_id"] != "old" for e in pruned)        # >21d dropped
    assert len(pruned) == 5
    capped = rc.prune_archive(recent, now=now, max_entries=2)
    assert len(capped) == 2                                  # keeps the 2 most recent


# ── the route's availability claim (2026-08-15, Master Codex MC-03) ─────────────────────────────
# Live production evidence 2026-08-15T03:17Z: {"available": true, "n_archive": 60000,
# "n_reports": 0, "summary": {"n_matched": 0, ...all null}} — the archive at its cap, ZERO matched
# observations, and the route still said AVAILABLE. Availability meant "an L2 file exists", not
# "there is usable evidence". Measure-or-refuse (the WS-CAN-0010 pattern): an instrument with no
# matched outcomes must SAY SO on the wire, while keeping the evidence counters readable.

def _route_with(monkeypatch, report):
    import asyncio
    import routes.weather as rw
    monkeypatch.setattr(rc, "load_report_calibration_cached", lambda: report)
    return asyncio.run(rw.get_report_calibration())


def _report(n_matched, n_reports=0):
    return {"version": 1, "generated_at": "2026-08-15T00:00:00Z", "model": "GFS",
            "n_reports": n_reports, "n_archive": 60000,
            "summary": {"n_matched": n_matched, "star_mae": None, "star_bias": None, "star_n": 0,
                        "height_mae_m": None, "height_bias_m": None, "height_n": 0,
                        "height_mae_ft": None},
            "residuals": []}


def test_an_empty_calibration_report_is_NOT_available(monkeypatch):
    """THE DEFECT: 60,000 predictions, 0 reports, 0 matches — and 'available: true'."""
    out = _route_with(monkeypatch, _report(n_matched=0))
    assert out["available"] is False, "zero matched observations must not read as available"
    assert "n_matched=0" in out.get("reason", ""), "the refusal must say WHY"
    assert out["n_archive"] == 60000, "refusing must not hide the evidence counters"


def test_a_matched_report_IS_available__THE_CONTROL(monkeypatch):
    """Without this the guard above passes on a route that refuses everything."""
    out = _route_with(monkeypatch, _report(n_matched=3, n_reports=5))
    assert out["available"] is True
    assert out["summary"]["n_matched"] == 3


def test_no_report_at_all_stays_unavailable__THE_CONTROL(monkeypatch):
    out = _route_with(monkeypatch, None)
    assert out["available"] is False


def test_the_minimum_matched_threshold_is_tunable(monkeypatch):
    """REPORT_CAL_MIN_MATCHED (default 1 = refuse only at zero): the owner can demand a real
    sample before the instrument may call itself available."""
    monkeypatch.setenv("REPORT_CAL_MIN_MATCHED", "5")
    out = _route_with(monkeypatch, _report(n_matched=3))
    assert out["available"] is False and "min 5" in out.get("reason", "")
    out = _route_with(monkeypatch, _report(n_matched=5))
    assert out["available"] is True
