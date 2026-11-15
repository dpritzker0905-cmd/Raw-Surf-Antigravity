"""TIDE_HARMONIC (2026-11-15): NOAA CO-OPS harmonic tide through the one door, eta = tide + model surge (option B).

Plan + pre-registered gate: docs/weather-program/log/2026-11-15-claude-tide-harmonic-plan.md. These pin: station choice
within RADIUS_KM, the surge residual (G9: a planted 0.5 m surge comes back as 0.5 +- 0.02 m), the served shape (level =
the prediction, water_level = level + residual, NOAA's own events), the door (fetch_tide_hourly, tide_norm_at, eta in
sea_inputs), failure -> the model, the kill switch, and that the serve path never calls NOAA (G4).
"""
import asyncio
import math
import os
from datetime import datetime, timedelta, timezone

import pytest

from services.weather_pipeline import tide as T
from services.weather_pipeline import tide_harmonic as H

T0 = datetime(2026, 11, 14, tzinfo=timezone.utc)      # the station file starts "yesterday"
NOW_DAY = T0 + timedelta(days=1)
STATION = {"id": "1612340", "name": "Honolulu", "lat": 21.3067, "lng": -157.867}


def harm_at(t):
    hours = (t - T0).total_seconds() / 3600
    return 0.25 * math.sin(2 * math.pi * hours / 12.42) + 0.05 * math.sin(2 * math.pi * hours / 23.93)


def station_doc(offset=0.54):
    times = [T0 + timedelta(hours=h) for h in range(16 * 24)]
    return {"station": STATION, "series": {"time": [t.strftime("%Y-%m-%dT%H:%MZ") for t in times],
                                           "level": [round(harm_at(t), 4) for t in times]},
            "events": [{"time": (T0 + timedelta(hours=3, minutes=6)).strftime("%Y-%m-%dT%H:%MZ"), "height_m": 0.31,
                        "type": "High"}],
            "model_offset_m": offset}


def model_series(surge=0.0, offset=0.54, tidal_err=0.03):
    """tide.py's local-datum model output: raw = harmonic + offset + surge + a small tidal-band error."""
    times = [NOW_DAY + timedelta(hours=h) for h in range(72)]
    raw = [harm_at(t) + offset + surge + tidal_err * math.sin(2 * math.pi * h / 12.42 + 1.0) for h, t in enumerate(times)]
    out = T.to_local_datum({"time": [t.strftime("%Y-%m-%dT%H:%M") for t in times], "level": raw})
    return out


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    monkeypatch.delenv("TIDE_HARMONIC", raising=False)
    monkeypatch.delenv("TIDE_LOCAL_DATUM", raising=False)
    monkeypatch.setenv("TIDE_SURGE_RESIDUAL", "1")       # the surge tests exercise option B; its default is pinned below
    H._reset_for_tests()
    yield
    H._reset_for_tests()


def _inject(index_stations=None, doc=None, fail=False):
    async def fetch(key):
        if fail:
            raise RuntimeError("storage down")
        if key == H.INDEX_KEY:
            return {"stations": index_stations if index_stations is not None
                    else {STATION["id"]: {"name": STATION["name"], "lat": STATION["lat"], "lng": STATION["lng"]}}}
        return doc if doc is not None else station_doc()
    H._reset_for_tests(fetch)


def test_nearest_station_within_the_radius_only():
    idx = {"stations": {"a": {"name": "A", "lat": 21.30, "lng": -157.87}, "b": {"name": "B", "lat": 21.95, "lng": -159.36}}}
    s = H.nearest_station(idx, 21.32, -157.90)
    assert s["id"] == "a" and s["distance_km"] < 5
    assert H.nearest_station(idx, 30.0, -150.0) is None          # > 100 km from both
    assert H.RADIUS_KM == 100.0                                   # gate G3's pre-registered rule, 2026-11-15


@pytest.mark.parametrize("surge", [0.0, 0.5, -0.3])
def test_g9_a_planted_surge_comes_back(surge):
    m = model_series(surge=surge)
    times = [H._parse(t) for t in m["time"]]
    raw = {t: v + m["datum_offset_m"] for t, v in zip(times, m["level"])}
    harm = {t: harm_at(t) for t in times}
    res = H.lowpass_residual(times, raw, harm, 0.54)
    mid = [v for t, v in res.items() if 12 <= (t - NOW_DAY).total_seconds() / 3600 <= 60]
    assert mid and all(abs(v - surge) <= 0.02 for v in mid)


def test_no_offset_no_residual():
    m = model_series()
    times = [H._parse(t) for t in m["time"]]
    assert H.lowpass_residual(times, {t: 1.0 for t in times}, {t: 0.0 for t in times}, None) == {}


def test_surge_is_held_off_by_default_so_eta_is_the_official_tide(monkeypatch):
    monkeypatch.delenv("TIDE_SURGE_RESIDUAL", raising=False)
    from services import runtime_flags as rf
    assert rf.GUARDED["TIDE_SURGE_RESIDUAL"] == "0" and rf.GUARDED["TIDE_HARMONIC"] == "1"
    out = H.combine(model_series(surge=0.4), station_doc(), dict(STATION, distance_km=2.0))
    assert out["water_level"] == out["level"] and out["surge_hours"] == 0


def test_combine_serves_the_prediction_and_adds_surge_only_to_water_level():
    out = H.combine(model_series(surge=0.4), station_doc(), dict(STATION, distance_km=2.0))
    assert out["source"] == H.SOURCE and out["station"]["id"] == "1612340" and out["datum"] == "station_msl"
    assert out["level"] == station_doc()["series"]["level"]                  # displayed = NOAA, untouched
    i = 24 + 36                                                              # NOW_DAY + 36 h: inside the model
    assert out["water_level"][i] == pytest.approx(out["level"][i] + 0.4, abs=0.02)
    j = 24 * 10                                                              # day 10: past the model
    assert out["water_level"][j] == out["level"][j]
    assert out["events"][0]["type"] == "High" and out["events"][0]["level_m"] == 0.31
    assert len(out["time"]) == 16 * 24                                       # the full scrubber horizon and more


def _fake_model(monkeypatch, surge=0.0):
    raw = model_series(surge=surge)
    raw_levels = [v + raw["datum_offset_m"] for v in raw["level"]]

    async def fake_fetch_point(key, client, forecast_days):
        return {"time": raw["time"], "level": raw_levels}
    monkeypatch.setattr(T, "_fetch_point", fake_fetch_point)


def test_the_door_serves_harmonic_and_eta_is_tide_plus_surge(monkeypatch):
    _fake_model(monkeypatch, surge=0.5)
    _inject()
    got = asyncio.run(T.fetch_tide_hourly(21.31, -157.87))
    assert got["source"] == H.SOURCE
    at = NOW_DAY + timedelta(hours=30)
    st = asyncio.run(T.tide_norm_at(21.31, -157.87, at))
    assert st["source"] == H.SOURCE
    assert st["height_m"] == pytest.approx(harm_at(at), abs=0.01)
    assert st["water_level_m"] == pytest.approx(st["height_m"] + 0.5, abs=0.03)


def test_sea_inputs_eta_reads_water_level(monkeypatch):
    from services.weather_pipeline import sea_inputs

    async def fake_tide(lat, lng, vt, client=None):
        return {"height_m": 0.2, "water_level_m": 0.7, "norm": 0.5, "trend": "rising"}
    monkeypatch.setattr(T, "tide_norm_at", fake_tide)
    eta, _ = asyncio.run(sea_inputs.resolve(21.3, -157.9, "2026-11-15T12:00:00Z", None))
    assert eta == pytest.approx(0.7)


def test_far_from_any_station_serves_the_model(monkeypatch):
    _fake_model(monkeypatch)
    _inject(index_stations={"x": {"name": "Far", "lat": 40.0, "lng": -70.0}})
    got = asyncio.run(T.fetch_tide_hourly(21.31, -157.87))
    assert got["source"] == "model_local_msl" and "water_level" not in got


def test_storage_failure_serves_the_model(monkeypatch):
    _fake_model(monkeypatch)
    _inject(fail=True)
    assert asyncio.run(T.fetch_tide_hourly(21.31, -157.87))["source"] == "model_local_msl"


def test_kill_switch(monkeypatch):
    _fake_model(monkeypatch)
    _inject()
    monkeypatch.setenv("TIDE_HARMONIC", "0")
    assert asyncio.run(T.fetch_tide_hourly(21.31, -157.87))["source"] == "model_local_msl"


def test_g4_the_serve_path_never_calls_noaa():
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    for rel in ("services/weather_pipeline/tide_harmonic.py", "services/weather_pipeline/tide.py",
                "routes/weather_point_tide.py"):
        with open(os.path.join(here, rel), encoding="utf-8") as fh:
            assert "api.tidesandcurrents" not in fh.read(), f"{rel} must only READ the bucket"


def test_point_tide_uses_noaa_events_and_names_the_source(monkeypatch):
    from routes.weather_point_tide import build_point_tide
    _fake_model(monkeypatch)
    _inject()
    series = asyncio.run(T.fetch_tide_hourly(21.31, -157.87))
    out = build_point_tide(series, 21.31, -157.87, NOW_DAY + timedelta(hours=1))
    assert out["tide_source"] == H.SOURCE and out["provider"] == "NOAA CO-OPS"
    assert out["quantity"] == "predicted_tide" and out["station"]["name"] == "Honolulu"
    assert any(e["time"] == "2026-11-14T03:06:00Z" and e["type"] == "High" for e in out["events"])


def test_ingest_picks_each_spots_nearest_station_within_the_radius():
    from scripts.tide_harmonic_ingest import stations_for_spots
    stations = [{"id": "a", "lat": 21.30, "lng": -157.87}, {"id": "b", "lat": 21.95, "lng": -159.36},
                {"id": "c", "lat": 21.31, "lng": -157.86}]
    spots = [{"latitude": 21.312, "longitude": -157.858}, {"latitude": 45.0, "longitude": -30.0}]
    assert set(stations_for_spots(stations, spots)) == {"c"}
