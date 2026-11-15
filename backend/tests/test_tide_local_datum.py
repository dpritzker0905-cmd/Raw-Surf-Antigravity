"""TIDE_LOCAL_DATUM (2026-11-15): tide levels relative to the LOCAL mean sea level, not the model's global reference.

Evidence (docs/weather-program/log/2026-11-15-claude-tide-local-datum.md): Open-Meteo `sea_level_height_msl` vs NOAA
CO-OPS harmonic predictions on the station MSL datum, 25 stations x 14 days: a stable per-place offset (+0.54 m
Hawaii, -0.5 m Northeast, daily sd median 0.048 m); subtracting the mean of the served 72 h series cuts the median
error 0.459 -> 0.117 m. These tests pin the correction, its reach (every consumer reads `fetch_tide_hourly`, eta
included), what it must NOT change (timing, trend, normalized position), the kill switch, and the replay twin the
history filter uses.
"""
import asyncio
import math
from datetime import datetime, timedelta, timezone

import pytest

from services.weather_pipeline import tide as T
from services.weather_pipeline import eval_replay as R

T0 = datetime(2026, 11, 15, tzinfo=timezone.utc)
OFFSET = 0.54   # the Hawaii-like model bias


def _series(hours=72, offset=OFFSET, gaps=()):
    times = [(T0 + timedelta(hours=h)).strftime("%Y-%m-%dT%H:%M") for h in range(hours)]
    levels = [None if h in gaps else offset + 0.4 * math.sin(2 * math.pi * h / 12.42) for h in range(hours)]
    return {"time": times, "level": levels}


@pytest.fixture(autouse=True)
def _flag(monkeypatch):
    monkeypatch.setenv("TIDE_LOCAL_DATUM", "1")       # these exercise the rule; its default is pinned below
    yield


def test_held_off_by_default_after_the_observed_water_check(monkeypatch):
    """2026-11-15: vs OBSERVED water the 72 h de-mean was worse than raw at 9/26 stations (US West Coast)."""
    monkeypatch.delenv("TIDE_LOCAL_DATUM", raising=False)
    from services import runtime_flags as rf
    assert rf.GUARDED["TIDE_LOCAL_DATUM"] == "0"
    s = _series()
    out = T.to_local_datum(s)
    assert out["level"] == s["level"] and out["datum"] == "model_msl"


def test_offset_is_the_mean_of_the_first_72h_and_ignores_gaps():
    s = _series(hours=96, gaps=(5, 6, 7))
    vals = [v for t, v in zip(s["time"][:72], s["level"][:72]) if v is not None]
    assert T.local_datum_offset(s["time"], s["level"]) == pytest.approx(sum(vals) / len(vals))
    # the sine averages to ~0 over 72 h, so the offset recovers the model bias
    assert T.local_datum_offset(s["time"], s["level"]) == pytest.approx(OFFSET, abs=0.03)


def test_too_few_hours_is_not_trusted():
    s = _series(hours=40)
    assert T.local_datum_offset(s["time"], s["level"]) is None
    out = T.to_local_datum(s)
    assert out["level"] == s["level"] and out["datum"] == "model_msl" and out["datum_offset_m"] is None


def test_levels_shift_by_the_offset_and_gaps_stay_gaps():
    s = _series(gaps=(10,))
    out = T.to_local_datum(s)
    off = out["datum_offset_m"]
    assert out["datum"] == "local_msl" and off == pytest.approx(OFFSET, abs=0.03)
    assert out["level"][10] is None
    for raw, new in zip(s["level"], out["level"]):
        if raw is not None:
            assert new == pytest.approx(raw - off, abs=1e-3)
    assert s["level"][0] == pytest.approx(OFFSET)        # the input is not mutated


def test_timing_trend_and_normalized_position_do_not_move():
    s = _series()
    out = T.to_local_datum(s)
    raw_ext = T.tide_extrema(s["time"], s["level"])
    new_ext = T.tide_extrema(out["time"], out["level"])
    assert [(e["type"], e["time"]) for e in raw_ext] == [(e["type"], e["time"]) for e in new_ext]
    for h in (3, 17, 40, 65):
        at = T0 + timedelta(hours=h, minutes=20)
        a = T.tide_state_at(s["time"], s["level"], at)
        b = T.tide_state_at(out["time"], out["level"], at)
        assert a["trend"] == b["trend"] and a["norm"] == b["norm"]
        assert b["height_m"] == pytest.approx(a["height_m"] - out["datum_offset_m"], abs=1e-3)


def test_kill_switch_serves_the_model_level(monkeypatch):
    monkeypatch.setenv("TIDE_LOCAL_DATUM", "0")
    s = _series()
    out = T.to_local_datum(s)
    assert out["level"] == s["level"] and out["datum"] == "model_msl"


def test_every_consumer_gets_it_through_fetch_tide_hourly_including_eta(monkeypatch):
    """fetch_tide_hourly is the one door: /point-tide, /tides, the rating's tide and the eta that moves the
    breaking depth (tide_norm_at -> point_surf_augment) all read through it."""
    async def fake_fetch_point(key, client, forecast_days):
        return _series()
    monkeypatch.setattr(T, "_fetch_point", fake_fetch_point)
    got = asyncio.run(T.fetch_tide_hourly(21.6, -158.1))
    assert got["datum"] == "local_msl" and got["datum_offset_m"] == pytest.approx(OFFSET, abs=0.03)
    state = asyncio.run(T.tide_norm_at(21.6, -158.1, T0 + timedelta(hours=3)))
    raw = T.tide_state_at(_series()["time"], _series()["level"], T0 + timedelta(hours=3))
    assert state["height_m"] == pytest.approx(raw["height_m"] - got["datum_offset_m"], abs=1e-3)
    monkeypatch.setenv("TIDE_LOCAL_DATUM", "0")
    state_off = asyncio.run(T.tide_norm_at(21.6, -158.1, T0 + timedelta(hours=3)))
    assert state_off["height_m"] == raw["height_m"]


def test_replay_twin_matches_production_for_the_serving_day():
    """The history filter scores flags in eval_replay; its tide must take the same datum or the flag looks inert."""
    s = _series(hours=96)
    prod = T.to_local_datum({"time": s["time"][:72], "level": s["level"][:72]})
    replay = R._local_datum_window({"time": [t + "Z" for t in s["time"]], "level": s["level"]},
                                   T0 + timedelta(hours=5), T)
    assert replay["datum_offset_m"] == prod["datum_offset_m"]
    assert replay["level"][:72] == pytest.approx(prod["level"])
