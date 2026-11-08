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
