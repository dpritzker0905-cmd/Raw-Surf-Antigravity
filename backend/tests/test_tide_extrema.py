"""High/low water derivation from the global hourly tide series.

WHY: `/tides/{spot_id}` served NOAA CO-OPS station 8721604 — Trident Pier, Port Canaveral FL — to
1,743 of 1,773 active spots (98.3%), because REGION_TIDE_STATIONS held five Florida regions and
everything else fell to the default. `tide.py` already existed to replace exactly that path. These
pin the pure event derivation so the endpoint can use the global source.
"""
import math
from datetime import datetime, timedelta, timezone

import pytest

from services.weather_pipeline.tide import tide_extrema, tide_trend_at

M2 = 12.4206                                   # the principal lunar semidiurnal period, hours


def _series(hours=72, period_h=M2, amp=1.5, phase=0.0, start=None, mean=0.0):
    """A synthetic semidiurnal tide sampled hourly, with a known analytic answer."""
    t0 = start or datetime(2026, 7, 28, 0, 0, tzinfo=timezone.utc)
    times, levels = [], []
    for i in range(hours):
        t = t0 + timedelta(hours=i)
        times.append(t.strftime("%Y-%m-%dT%H:%M"))
        levels.append(mean + amp * math.sin(2 * math.pi * (i - phase) / period_h))
    return times, levels


def test_a_semidiurnal_day_yields_about_two_highs_and_two_lows():
    times, levels = _series(hours=25)
    ev = tide_extrema(times, levels)
    highs = [e for e in ev if e["type"] == "High"]
    lows = [e for e in ev if e["type"] == "Low"]
    assert 1 <= len(highs) <= 2 and 1 <= len(lows) <= 2, ev
    assert len(ev) >= 3


def test_events_alternate_high_low_and_are_time_ordered():
    times, levels = _series(hours=96)
    ev = tide_extrema(times, levels)
    assert len(ev) >= 12
    for a, b in zip(ev, ev[1:]):
        assert b["time"] > a["time"], "events out of order"
        assert a["type"] != b["type"], f"two {a['type']}s in a row: {a} {b}"


def test_spacing_matches_the_semidiurnal_period():
    """Consecutive highs must be ~12.42 h apart — the physics, not a fitted constant."""
    times, levels = _series(hours=120)
    highs = [e for e in tide_extrema(times, levels) if e["type"] == "High"]
    gaps = [(b["time"] - a["time"]).total_seconds() / 3600.0 for a, b in zip(highs, highs[1:])]
    assert gaps, "no consecutive highs"
    assert all(abs(g - M2) < 0.6 for g in gaps), gaps


def test_parabolic_refinement_beats_hourly_quantisation():
    """The true turn rarely lands on the hour. Refined times must not all be whole hours, and the
    recovered amplitude must be closer to the true peak than the sampled maximum is."""
    times, levels = _series(hours=96, phase=0.37)
    ev = tide_extrema(times, levels)
    assert any(e["time"].minute != 0 for e in ev), "every event snapped to a whole hour"
    highs = [e for e in ev if e["type"] == "High"]
    assert highs
    best_sample = max(levels)
    assert max(h["level_m"] for h in highs) >= best_sample - 1e-9


def test_a_flat_series_has_no_events():
    times, _ = _series(hours=48)
    assert tide_extrema(times, [0.0] * 48) == []


def test_degenerate_input_returns_empty_and_never_raises():
    assert tide_extrema(None, None) == []
    assert tide_extrema([], []) == []
    assert tide_extrema(["2026-07-28T00:00"], [1.0]) == []
    assert tide_extrema(["a", "b", "c"], [1.0, 2.0, 1.0]) == []          # unparseable times
    times, levels = _series(hours=12)
    assert tide_extrema(times, levels[:-1]) == []                        # length mismatch
    holey = list(levels)
    holey[5] = None
    assert isinstance(tide_extrema(times, holey), list)                  # a hole must not raise


def test_close_same_type_turns_collapse_to_the_more_extreme():
    """A flat-topped tide can wobble into two adjacent 'highs'; keep the bigger one."""
    t0 = datetime(2026, 7, 28, tzinfo=timezone.utc)
    times = [(t0 + timedelta(hours=i)).strftime("%Y-%m-%dT%H:%M") for i in range(7)]
    levels = [0.0, 1.0, 0.9, 1.2, 0.8, 0.0, -1.0]      # two highs 2 h apart
    ev = tide_extrema(times, levels, min_separation_h=4.0)
    highs = [e for e in ev if e["type"] == "High"]
    assert len(highs) == 1
    assert highs[0]["level_m"] >= 1.2 - 1e-9, highs


def test_trend_is_rising_into_a_high_and_falling_into_a_low():
    times, levels = _series(hours=72)
    ev = tide_extrema(times, levels)
    first = ev[0]
    before = first["time"] - timedelta(hours=1)
    assert tide_trend_at(ev, before) == ("Rising" if first["type"] == "High" else "Falling")
    # Immediately after the last event there is no future turn — say nothing rather than guess.
    assert tide_trend_at(ev, ev[-1]["time"] + timedelta(hours=1)) is None
    assert tide_trend_at([], datetime.now(timezone.utc)) is None
    assert tide_trend_at(ev, None) is None


def test_amplitude_is_preserved_so_macrotidal_coasts_read_macrotidal():
    """Thurso-class range (~4 m) must survive the derivation — tide is first-order at ~27% of the
    catalogue and a flattened amplitude would silently erase that."""
    times, levels = _series(hours=96, amp=2.0)         # 4 m peak-to-peak
    ev = tide_extrema(times, levels)
    hi = max(e["level_m"] for e in ev if e["type"] == "High")
    lo = min(e["level_m"] for e in ev if e["type"] == "Low")
    assert (hi - lo) == pytest.approx(4.0, abs=0.05)
