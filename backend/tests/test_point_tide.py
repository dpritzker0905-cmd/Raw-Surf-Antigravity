"""GET /api/weather/point-tide: shape, the miss path and units (infobox tide readout, 2026-11-07)."""
import math
import os
import sys
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from routes import weather_point_tide as WPT  # noqa: E402

NOW = datetime(2026, 11, 7, 12, 0, tzinfo=timezone.utc)


def _series(amp=0.6, period_h=12.42, start=NOW - timedelta(hours=24), hours=72):
    times, levels = [], []
    for i in range(hours):
        t = start + timedelta(hours=i)
        times.append(t.strftime("%Y-%m-%dT%H:%M"))
        levels.append(amp * math.sin(2 * math.pi * (t - NOW).total_seconds() / 3600 / period_h))
    return {"time": times, "level": levels}


@pytest.fixture
def client(monkeypatch):
    app = FastAPI()
    app.include_router(WPT.router, prefix="/api")
    return TestClient(app)


def test_shape_and_units(monkeypatch, client):
    async def fake(lat, lng, *a, **k):
        return _series()
    monkeypatch.setattr(WPT._tide, "fetch_tide_hourly", fake)
    monkeypatch.setattr(WPT, "datetime", type("D", (), {"now": staticmethod(lambda tz=None: NOW)}))
    r = client.get("/api/weather/point-tide", params={"lat": 21.6, "lng": -158.0})
    assert r.status_code == 200
    assert r.headers["cache-control"] == "public, max-age=300"
    j = r.json()
    assert j["available"] is True and j["source"] == "model-msl" and j["cell_km"] == 11
    assert j["trend"] in ("rising", "falling", "slack")
    assert abs(j["height_m"]) <= 0.6 + 1e-6            # metres, never feet
    assert j["tz_offset_h"] == -11 and j["tz_approx"] is True
    for k in ("next_high", "next_low"):
        assert j[k]["time"].endswith("Z") and 0.5 < abs(j[k]["height_m"]) <= 0.61
    assert j["next_high"]["height_m"] > 0 > j["next_low"]["height_m"]
    assert j["series"][0]["t"] < j["series"][-1]["t"] and len(j["series"]) == 72
    assert j["rate_m_per_h"] > 0 and j["trend"] == "rising"   # sin() crossing zero upward at NOW


def test_miss_is_200_unavailable(monkeypatch, client):
    async def none(*a, **k):
        return None
    monkeypatch.setattr(WPT._tide, "fetch_tide_hourly", none)
    r = client.get("/api/weather/point-tide", params={"lat": 1, "lng": 2})
    assert r.status_code == 200 and r.json()["available"] is False
    assert r.headers["cache-control"] == "public, max-age=30"


def test_upstream_error_is_unavailable_not_5xx(monkeypatch, client):
    async def boom(*a, **k):
        raise RuntimeError("429 cooldown")
    monkeypatch.setattr(WPT._tide, "fetch_tide_hourly", boom)
    r = client.get("/api/weather/point-tide", params={"lat": 1, "lng": 2})
    assert r.status_code == 200 and r.json()["available"] is False


def test_bad_coordinates_rejected(client):
    assert client.get("/api/weather/point-tide", params={"lat": 91, "lng": 0}).status_code == 422


def test_selected_coverage_gaps_and_nonfinite():
    series = _series()
    series["level"][24] = None
    out = WPT.build_point_tide(series, 0, 0, NOW)
    assert out["selected_time_available"] is False and out["height_m"] is None
    assert out["series"][24]["h"] is None and len(out["coverage"]) == 2
    assert out["datum"] == "MSL" and out["timezone"] == "UTC"
    for invalid in (float("nan"), float("inf"), True, "0.3"):
        series["level"][24] = invalid
        assert WPT.build_point_tide(series, 0, 0, NOW)["height_m"] is None


def test_no_extrapolation_or_reordering():
    series = _series(hours=3)
    out = WPT.build_point_tide(series, 0, 0, NOW)
    assert out["selected_time_available"] is False and out["height_m"] is None
    series["time"][1] = series["time"][0]
    assert WPT.build_point_tide(series, 0, 0, NOW) is None


def test_interpolation_and_missing_hour():
    series = {"time": ["2026-11-07T12:00", "2026-11-07T13:00", "2026-11-07T15:00", "2026-11-07T16:00"],
              "level": [0, 1, 2, 3]}
    assert WPT.build_point_tide(series, 0, 0, NOW + timedelta(minutes=30))["height_m"] == 0.5
    out = WPT.build_point_tide(series, 0, 0, NOW + timedelta(hours=2))
    assert out["height_m"] is None and len(out["coverage"]) == 2


# --- 2026-11-08 contract fixes (Claude): plateaus, bad samples, gaps, offsets, headers -------------------------

def _hourly(levels, start="2026-11-07T00:00"):
    t0 = datetime.fromisoformat(start)
    return {"time": [(t0 + timedelta(hours=i)).strftime("%Y-%m-%dT%H:%M") for i in range(len(levels))],
            "level": list(levels)}


def _extrema(levels):
    s = _hourly(levels)
    return WPT._tide.tide_extrema(s["time"], s["level"])


def test_rise_plateau_rise_is_not_a_high():
    assert _extrema([0.0, 0.5, 1.0, 1.0, 1.5, 2.0]) == []


def test_fall_plateau_fall_is_not_a_low():
    assert _extrema([2.0, 1.5, 1.0, 1.0, 0.5, 0.0]) == []


def test_true_plateau_peak_is_one_high_at_the_midpoint():
    even = _extrema([0.0, 1.0, 2.0, 2.0, 1.0, 0.0])
    assert [(e["type"], e["level_m"]) for e in even] == [("High", 2.0)]
    assert even[0]["time"] == datetime(2026, 11, 7, 2, 30, tzinfo=timezone.utc)
    odd = _extrema([0.0, 1.0, 2.0, 2.0, 2.0, 1.0, 0.0])
    assert [e["type"] for e in odd] == ["High"]
    assert odd[0]["time"] == datetime(2026, 11, 7, 3, 0, tzinfo=timezone.utc)
    low = _extrema([2.0, 1.0, 0.0, 0.0, 1.0, 2.0])
    assert [e["type"] for e in low] == ["Low"]


def test_pointed_peak_still_uses_the_parabola():
    out = _extrema([0.0, 1.0, 1.5, 1.0, 0.0])
    assert len(out) == 1 and out[0]["type"] == "High" and out[0]["time"].hour == 2 and out[0]["time"].minute == 0


def test_duplicate_timestamp_is_skipped_as_a_gap_not_the_whole_cell():
    s = _series(hours=30)
    s["time"].insert(10, s["time"][9])   # an exact duplicate
    s["level"].insert(10, 99.0)
    out = WPT.build_point_tide(s, 0, 0, NOW)
    assert out is not None and len(out["series"]) == 30
    assert len(out["coverage"]) == 2 and out["series"][9]["h"] != 99.0
    assert all(p["h"] != 99.0 for p in out["series"])


def test_unparsable_timestamp_is_skipped_as_a_gap():
    s = _series(hours=30)
    s["time"][10] = "not-a-time"
    out = WPT.build_point_tide(s, 0, 0, NOW)
    assert out is not None and len(out["series"]) == 29 and len(out["coverage"]) == 2


def test_non_hourly_step_breaks_the_segment():
    s = {"time": ["2026-11-07T10:00", "2026-11-07T11:00", "2026-11-07T11:30", "2026-11-07T12:30", "2026-11-07T13:30"],
         "level": [0.0, 1.0, 2.0, 3.0, 4.0]}
    out = WPT.build_point_tide(s, 0, 0, NOW)
    assert [(c["start"], c["end"]) for c in out["coverage"]] == [
        ("2026-11-07T10:00:00Z", "2026-11-07T11:00:00Z"), ("2026-11-07T11:30:00Z", "2026-11-07T13:30:00Z")]
    assert out["height_m"] == 2.5   # interpolated inside the second segment, never across the 30-minute step


def test_two_sample_segment_is_usable_and_has_no_events():
    s = {"time": ["2026-11-07T12:00", "2026-11-07T13:00"], "level": [0.0, 1.0]}
    out = WPT.build_point_tide(s, 0, 0, NOW + timedelta(minutes=30))
    assert out["height_m"] == 0.5 and out["trend"] == "rising" and out["events"] == []
    assert out["next_high"] is None and out["next_low"] is None


def test_single_sample_island_is_not_coverage():
    s = {"time": ["2026-11-07T09:00", "2026-11-07T12:00", "2026-11-07T13:00", "2026-11-07T14:00"],
         "level": [5.0, 0.0, 1.0, 0.5]}
    out = WPT.build_point_tide(s, 0, 0, NOW)
    assert out["coverage"] == [{"start": "2026-11-07T12:00:00Z", "end": "2026-11-07T14:00:00Z"}]
    assert len(out["series"]) == 4   # the island is still shown as a point, but never as coverage
    only = {"time": ["2026-11-07T12:00"], "level": [1.0]}
    assert WPT.build_point_tide(only, 0, 0, NOW) is None


def test_request_exactly_at_the_last_sample_before_a_gap():
    s = {"time": ["2026-11-07T10:00", "2026-11-07T11:00", "2026-11-07T12:00", "2026-11-07T15:00", "2026-11-07T16:00"],
         "level": [0.0, 1.0, 2.0, 3.0, 4.0]}
    at_end = WPT.build_point_tide(s, 0, 0, NOW)   # NOW == 12:00, the last sample of segment one
    assert at_end["selected_time_available"] is True and at_end["height_m"] == 2.0
    after = WPT.build_point_tide(s, 0, 0, NOW + timedelta(minutes=1))
    assert after["selected_time_available"] is False and after["height_m"] is None


def test_request_just_before_the_first_sample_is_not_extrapolated():
    s = _hourly([0.0, 1.0, 0.5], start="2026-11-07T12:00")
    out = WPT.build_point_tide(s, 0, 0, NOW - timedelta(seconds=1))
    assert out["selected_time_available"] is False and out["height_m"] is None
    assert out["next_high"] is None


def test_non_utc_offset_input_is_normalised_to_z():
    s = {"time": ["2026-11-07T14:00:00+02:00", "2026-11-07T15:00:00+02:00", "2026-11-07T16:00:00+02:00",
                  "2026-11-07T17:00:00+02:00"],
         "level": [0.0, 1.0, 2.0, 1.0]}
    out = WPT.build_point_tide(s, 0, 0, NOW)
    assert [p["t"] for p in out["series"]][0] == "2026-11-07T12:00:00Z"
    assert out["coverage"] == [{"start": "2026-11-07T12:00:00Z", "end": "2026-11-07T15:00:00Z"}]
    assert out["height_m"] == 0.0 and out["events"][0]["time"].endswith("Z")
    assert out["events"][0]["time"] == "2026-11-07T14:00:00Z"


def test_coverage_timestamps_use_z_not_an_offset():
    out = WPT.build_point_tide(_series(hours=30), 0, 0, NOW)
    for c in out["coverage"]:
        assert c["start"].endswith("Z") and c["end"].endswith("Z") and "+" not in c["start"] + c["end"]


def test_cache_headers_on_success_with_a_gap(monkeypatch, client):
    gap = _series()
    gap["level"][24] = None

    async def fake(lat, lng, *a, **k):
        return gap
    monkeypatch.setattr(WPT._tide, "fetch_tide_hourly", fake)
    r = client.get("/api/weather/point-tide", params={"lat": 1, "lng": 2})
    assert r.status_code == 200 and r.json()["available"] is True and len(r.json()["coverage"]) == 2
    assert r.headers["cache-control"] == "public, max-age=300"
