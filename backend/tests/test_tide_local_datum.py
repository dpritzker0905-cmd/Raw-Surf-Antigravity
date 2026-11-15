"""TIDE_LOCAL_DATUM (2026-11-15): tide levels minus the model's own 1-year mean per 0.1-degree cell (tide_datum.py).

Evidence (docs/weather-program/log/2026-11-15-claude-tide-local-datum.md): the model's level sits a stable per-place
offset from the local mean sea level; a 72 h de-mean was tried first and REJECTED against OBSERVED water (it removed real
seasonal water on the US West Coast); the 1-year model mean passed a pre-registered held-out test (26 NOAA stations x 4
weeks, median 0.414 -> 0.177 m, West Coast within +0.015 m of raw). These pin the lookup, the shift, its reach (every
consumer reads fetch_tide_hourly, eta included), what it must NOT change, the fallbacks and the kill switch.
"""
import asyncio
import math
from datetime import datetime, timedelta, timezone

import pytest

from services.weather_pipeline import tide as T
from services.weather_pipeline import tide_datum as D

T0 = datetime(2026, 11, 15, tzinfo=timezone.utc)
OFFSET = 0.567   # Honolulu's 1-year model mean
TABLE = {"cells": {"21.3,-157.9": {"mean_m": OFFSET, "hours": 8760}, "40.5,-74.0": {"mean_m": -0.507, "hours": 8760}}}


def _series(hours=72, offset=OFFSET, gaps=()):
    times = [(T0 + timedelta(hours=h)).strftime("%Y-%m-%dT%H:%M") for h in range(hours)]
    levels = [None if h in gaps else offset + 0.4 * math.sin(2 * math.pi * h / 12.42) for h in range(hours)]
    return {"time": times, "level": levels}


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    monkeypatch.delenv("TIDE_LOCAL_DATUM", raising=False)

    async def fetch():
        return TABLE
    D._reset_for_tests(fetch)
    yield
    D._reset_for_tests()


def test_ships_on_after_the_held_out_test():
    from services import runtime_flags as rf
    assert rf.GUARDED["TIDE_LOCAL_DATUM"] == "1"


def test_lookup_exact_cell_then_nearest_within_half_a_degree_else_none():
    assert D.lookup(TABLE, 21.31, -157.87) == OFFSET                    # same 0.1-degree cell
    assert D.lookup(TABLE, 21.6, -158.1) == OFFSET                      # North Shore: nearest cell, ~0.3 deg away
    assert D.lookup(TABLE, 30.0, -150.0) is None                        # nothing within 0.5 deg
    assert D.lookup(None, 21.3, -157.9) is None


def test_levels_shift_by_the_cell_mean_and_gaps_stay_gaps():
    s = _series(gaps=(10,))
    out = T.to_local_datum(s, OFFSET)
    assert out["datum"] == "model_mean_365d" and out["datum_offset_m"] == OFFSET
    assert out["level"][10] is None
    for raw, new in zip(s["level"], out["level"]):
        if raw is not None:
            assert new == pytest.approx(raw - OFFSET, abs=1e-9)
    assert s["level"][0] == pytest.approx(OFFSET)                       # the input is not mutated


def test_no_fixed_datum_falls_back_to_the_72h_window_and_says_so():
    s = _series()
    out = T.to_local_datum(s, None)
    assert out["datum"] == "window_72h" and out["datum_offset_m"] == pytest.approx(OFFSET, abs=0.03)
    assert T.to_local_datum(_series(hours=40), None)["datum"] == "model_msl"   # too short for a window


def test_timing_trend_and_normalized_position_do_not_move():
    s = _series()
    out = T.to_local_datum(s, OFFSET)
    raw_ext = T.tide_extrema(s["time"], s["level"])
    new_ext = T.tide_extrema(out["time"], out["level"])
    assert [(e["type"], e["time"]) for e in raw_ext] == [(e["type"], e["time"]) for e in new_ext]
    for h in (3, 17, 40, 65):
        at = T0 + timedelta(hours=h, minutes=20)
        a = T.tide_state_at(s["time"], s["level"], at)
        b = T.tide_state_at(out["time"], out["level"], at)
        assert a["trend"] == b["trend"] and a["norm"] == b["norm"]
        assert b["height_m"] == pytest.approx(a["height_m"] - OFFSET, abs=1e-3)


def test_every_consumer_gets_it_through_fetch_tide_hourly_including_eta(monkeypatch):
    async def fake_fetch_point(key, client, forecast_days):
        return _series()
    monkeypatch.setattr(T, "_fetch_point", fake_fetch_point)
    got = asyncio.run(T.fetch_tide_hourly(21.31, -157.87))
    assert got["datum"] == "model_mean_365d" and got["datum_offset_m"] == OFFSET
    at = T0 + timedelta(hours=3)
    state = asyncio.run(T.tide_norm_at(21.31, -157.87, at))
    raw = T.tide_state_at(_series()["time"], _series()["level"], at)
    assert state["height_m"] == pytest.approx(raw["height_m"] - OFFSET, abs=1e-3)


def test_kill_switch_serves_the_model_level(monkeypatch):
    async def fake_fetch_point(key, client, forecast_days):
        return _series()
    monkeypatch.setattr(T, "_fetch_point", fake_fetch_point)
    monkeypatch.setenv("TIDE_LOCAL_DATUM", "0")
    got = asyncio.run(T.fetch_tide_hourly(21.31, -157.87))
    assert got["level"] == _series()["level"] and got["datum"] == "model_msl"
    assert T.to_local_datum(_series(), OFFSET)["datum"] == "model_msl"


def test_storage_failure_serves_the_model_level(monkeypatch):
    async def broken():
        raise RuntimeError("storage down")
    D._reset_for_tests(broken)

    async def fake_fetch_point(key, client, forecast_days):
        return _series()
    monkeypatch.setattr(T, "_fetch_point", fake_fetch_point)
    got = asyncio.run(T.fetch_tide_hourly(21.31, -157.87))
    assert got["datum"] == "window_72h"                                      # storage down: the 72 h fallback


def test_point_tide_reports_the_datum_basis(monkeypatch):
    from fastapi import Response
    from routes.weather_point_tide import get_point_tide

    async def fake_fetch_point(key, client, forecast_days):
        return _series()
    monkeypatch.setattr(T, "_fetch_point", fake_fetch_point)
    out = asyncio.run(get_point_tide(Response(), lat=21.31, lng=-157.87))
    assert out["datum_basis"] == "model_mean_365d" and out["datum_offset_m"] == OFFSET


def test_ingest_refreshes_missing_cells_first_then_the_oldest():
    from scripts.tide_datum_ingest import plan_refresh
    today = datetime(2026, 11, 15, tzinfo=timezone.utc)
    table = {"cells": {"a": {"built": (today - timedelta(days=9)).isoformat()},
                       "b": {"built": (today - timedelta(days=2)).isoformat()},
                       "c": {"built": (today - timedelta(days=20)).isoformat()}}}
    assert plan_refresh(["a", "b", "c", "d"], table, today, 7, 10) == ["d", "c", "a"]
    assert plan_refresh(["a", "b", "c", "d"], table, today, 7, 2) == ["d", "c"]
