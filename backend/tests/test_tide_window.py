"""The tide must not freeze past the fetched window (SURF_TIDE_WINDOW_FIX, 2026-11-23).

Bug (found in the research lead's bug hunt, verified): `tide_norm_at` fetched the default 3 days from 00Z today and
`tide_state_at` took the NEAREST sample with no maximum distance, so every valid time past ~49-72 h got the LAST sample's
height. With SURF_TIDE_DEPTH on that stale height fed the depth-limited cap (/point, the precompute, the hub's 14-day plan)
and the rating's tide_fit.

Fix (flag SURF_TIDE_WINDOW_FIX; D-065 ON, owner 2026-11-23 "Yes, turn it on"; kill "0"): request a window that covers
the valid time (tide_own publishes ~90 days), and refuse a sample farther than 1.5 h from the valid time (None: the
caller's neutral eta = 0), never a stale one.
"""
import asyncio
import math
from datetime import datetime, timedelta, timezone

import pytest

from services.weather_pipeline import tide as T

PERIOD_H = 12.42


def _truth(h):
    return round(1.5 * math.sin(2 * math.pi * h / PERIOD_H), 3)


def _day0():
    return datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)


def _fake_fetch(calls):
    async def fake(lat, lng, client=None, forecast_days=3):
        calls.append(forecast_days)
        d0 = _day0()
        n = 24 * int(forecast_days)
        return {"time": [(d0 + timedelta(hours=i)).strftime("%Y-%m-%dT%H:00") for i in range(n)],
                "level": [_truth(i) for i in range(n)], "source": "am"}
    return fake


def _at(h):
    return (_day0() + timedelta(hours=h)).strftime("%Y-%m-%dT%H:00:00Z")


@pytest.mark.parametrize("h", [80, 120, 200, 330])
def test_fix_on_tide_follows_the_valid_time_past_three_days(monkeypatch, h):
    calls = []
    monkeypatch.setattr(T, "fetch_tide_hourly", _fake_fetch(calls))
    monkeypatch.setenv("SURF_TIDE_WINDOW_FIX", "1")
    st = asyncio.run(T.tide_norm_at(21.6, -158.05, _at(h)))
    assert st is not None and st["height_m"] == pytest.approx(_truth(h), abs=1e-3)
    assert calls and calls[-1] * 24 > h                      # the window asked for covers the valid time


def test_kill_switch_restores_the_old_frozen_last_sample(monkeypatch):
    """Kill '0': the served value is exactly the pre-fix one (the last of 72 samples)."""
    calls = []
    monkeypatch.setattr(T, "fetch_tide_hourly", _fake_fetch(calls))
    monkeypatch.setenv("SURF_TIDE_WINDOW_FIX", "0")
    st = asyncio.run(T.tide_norm_at(21.6, -158.05, _at(120)))
    assert calls == [3] and st["height_m"] == pytest.approx(_truth(71), abs=1e-3)


def test_state_refuses_a_sample_farther_than_max_gap():
    d0 = datetime(2026, 11, 23, tzinfo=timezone.utc)
    times = [(d0 + timedelta(hours=i)).strftime("%Y-%m-%dT%H:00") for i in range(72)]
    levels = [_truth(i) for i in range(72)]
    for h in (-3, 74, 80, 200):                               # before the series, just past it, far past it
        assert T.tide_state_at(times, levels, d0 + timedelta(hours=h), max_gap_h=1.5) is None
    inside = T.tide_state_at(times, levels, d0 + timedelta(hours=40, minutes=20), max_gap_h=1.5)
    assert inside is not None and inside["height_m"] == pytest.approx(_truth(40), abs=1e-3)
    edge = T.tide_state_at(times, levels, d0 + timedelta(hours=72, minutes=30), max_gap_h=1.5)   # 1.5 h from 71:00
    assert edge is not None and edge["height_m"] == pytest.approx(_truth(71), abs=1e-3)
    # default (no max_gap_h): today's nearest-sample behaviour, unchanged
    assert T.tide_state_at(times, levels, d0 + timedelta(hours=200))["height_m"] == pytest.approx(_truth(71), abs=1e-3)


def test_fix_on_past_the_published_table_is_none_not_stale(monkeypatch):
    """A valid time the table does not reach gives None (eta neutral), never the last sample."""
    async def short(lat, lng, client=None, forecast_days=3):
        d0 = _day0()
        return {"time": [(d0 + timedelta(hours=i)).strftime("%Y-%m-%dT%H:00") for i in range(72)],
                "level": [_truth(i) for i in range(72)], "source": "am"}
    monkeypatch.setattr(T, "fetch_tide_hourly", short)
    monkeypatch.setenv("SURF_TIDE_WINDOW_FIX", "1")
    assert asyncio.run(T.tide_norm_at(21.6, -158.05, _at(200))) is None


def test_days_needed_covers_the_valid_time_and_is_bounded():
    now = datetime(2026, 11, 23, 13, 0, tzinfo=timezone.utc)
    assert T._days_covering(now, now + timedelta(hours=1)) == 3                 # never less than today's 3
    assert T._days_covering(now, datetime(2026, 11, 26, 5, tzinfo=timezone.utc)) == 4
    assert T._days_covering(now, now + timedelta(days=14)) == 15
    assert T._days_covering(now, now + timedelta(days=400)) == T.TIDE_MAX_DAYS
    assert T._days_covering(now, None) == 3


def test_flag_registered_on_by_owner_word_with_parity(monkeypatch):
    """D-065 ON: the owner, 2026-11-23, typed in the director session: "Yes, turn it on"."""
    from services.runtime_flags import GUARDED, on
    from routes.admin.surf_forecast import _RATING_FLAGS
    from scripts.flag_guardrail import COVERAGE, NEVER_AUTO_DISABLE
    assert GUARDED["SURF_TIDE_WINDOW_FIX"] == "1"
    assert _RATING_FLAGS["SURF_TIDE_WINDOW_FIX"][0] == "1"
    assert "SURF_TIDE_WINDOW_FIX" in COVERAGE and "SURF_TIDE_WINDOW_FIX" not in NEVER_AUTO_DISABLE
    monkeypatch.delenv("SURF_TIDE_WINDOW_FIX", raising=False)
    assert on("SURF_TIDE_WINDOW_FIX")


def test_default_on_follows_the_valid_time(monkeypatch):
    calls = []
    monkeypatch.setattr(T, "fetch_tide_hourly", _fake_fetch(calls))
    monkeypatch.delenv("SURF_TIDE_WINDOW_FIX", raising=False)
    st = asyncio.run(T.tide_norm_at(21.6, -158.05, _at(120)))
    assert st["height_m"] == pytest.approx(_truth(120), abs=1e-3)
