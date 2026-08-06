"""The horizon scan — "which hour should I surf", not just "how is it at this hour".

`services/weather_pipeline/sim_window.py`. The scan logic is injected with a baseline resolver, so
every rule below is exercised without a network and without the MCP server.

The two things that must not quietly go wrong:
  1. A frame with no forecast must be EXCLUDED from the ranking, never scored as flat — otherwise a
     gap in the data becomes "the surf is bad then", which is a different claim entirely.
  2. A truncated horizon must SAY it was truncated. A ranked answer covering a third of the range
     asked for still reads as "the best window in the next N hours".
"""
import os
import sys
from datetime import datetime, timezone

import pytest

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from services.weather_pipeline import sim_window

NOW = datetime(2026, 7, 30, 12, 0, 0, tzinfo=timezone.utc)
SPOT = {"name": "Mavericks", "latitude": 37.4915, "longitude": -122.5083, "orientation": 225.1}


def _flat_baseline(**over):
    b = {"swell_height_m": 2.0, "swell_period_sec": 14.0, "swell_direction_deg": 225.1,
         "wind_speed_knots": 5.0, "wind_direction_deg": 45.1}
    b.update(over)
    return b


# ── plan_hours: the frame budget ────────────────────────────────────────────────────────────────

def test_plan_hours_walks_forward_on_the_requested_step():
    hours = sim_window.plan_hours(12, 3, now=NOW)
    assert hours == ["2026-07-30T12:00:00Z", "2026-07-30T15:00:00Z", "2026-07-30T18:00:00Z",
                     "2026-07-30T21:00:00Z", "2026-07-31T00:00:00Z"]


def test_plan_hours_snaps_a_part_hour_start_to_the_top_of_the_hour():
    hours = sim_window.plan_hours(3, 3, now=NOW.replace(minute=47, second=31))
    assert hours[0] == "2026-07-30T12:00:00Z"


def test_plan_hours_TRUNCATES_rather_than_widening_the_step(monkeypatch):
    """A caller who asked for 3-hourly resolution and silently got 9-hourly has no way to tell.
    A short answer that reports its own range is self-describing; a re-sampled one is not."""
    monkeypatch.setattr(sim_window, "MAX_FRAMES", 4)
    hours = sim_window.plan_hours(48, 3, now=NOW)
    assert len(hours) == 4
    assert hours[1] == "2026-07-30T15:00:00Z", "the STEP must be unchanged, only the horizon cut"


def test_plan_hours_is_bounded_by_the_horizon_the_app_actually_serves(monkeypatch):
    monkeypatch.setattr(sim_window, "MAX_FRAMES", 999)
    monkeypatch.setattr(sim_window, "MAX_HOURS_AHEAD", 168)
    hours = sim_window.plan_hours(100000, 6, now=NOW)
    assert hours[-1] == "2026-08-06T12:00:00Z"          # +168 h exactly, not +100000


def test_plan_hours_survives_a_nonsense_step():
    assert len(sim_window.plan_hours(12, 0, now=NOW)) >= 1


# ── scan: ranking and honesty ───────────────────────────────────────────────────────────────────

def test_the_best_window_is_the_highest_quality_hour():
    """One hour gets a light offshore wind; the rest get a gale. It must win."""
    good = "2026-07-30T18:00:00Z"

    def baseline_at(spot, hour):
        if hour == good:
            return _flat_baseline(wind_speed_knots=3.0, wind_direction_deg=45.1), "live_forecast", {}
        return _flat_baseline(wind_speed_knots=32.0, wind_direction_deg=225.1), "live_forecast", {}

    out = sim_window.scan(SPOT, baseline_at, sim_window.plan_hours(12, 3, now=NOW), top=3)
    assert out["best_windows"][0]["valid_time"] == good
    assert out["best_windows"][0]["quality_rating"] > out["best_windows"][1]["quality_rating"]
    assert out["scanned"]["frames_resolved"] == 5


def test_size_breaks_a_quality_tie():
    """Wind and period barely move over three hours, so ties are common. The bigger hour is the
    better session."""
    big = "2026-07-30T15:00:00Z"

    def baseline_at(spot, hour):
        h = 3.0 if hour == big else 2.0
        return _flat_baseline(swell_height_m=h), "live_forecast", {}

    out = sim_window.scan(SPOT, baseline_at, sim_window.plan_hours(6, 3, now=NOW), top=3)
    top = out["best_windows"][0]
    assert top["valid_time"] == big
    assert top["breaking_height_ft"] > out["best_windows"][1]["breaking_height_ft"]


def test_an_unresolved_frame_is_EXCLUDED_not_scored_flat():
    """A gap in the data must not become 'the surf is bad then'."""
    missing = {"2026-07-30T15:00:00Z", "2026-07-30T18:00:00Z"}

    def baseline_at(spot, hour):
        if hour in missing:
            return None, "none", {"reason": "no marine data at this coordinate"}
        return _flat_baseline(), "live_forecast", {}

    hours = sim_window.plan_hours(12, 3, now=NOW)
    out = sim_window.scan(SPOT, baseline_at, hours, top=5)
    assert out["scanned"]["frames_requested"] == 5
    assert out["scanned"]["frames_resolved"] == 3
    assert sorted(out["scanned"]["unresolved_hours"]) == sorted(missing)
    assert "EXCLUDED from the ranking" in out["note"]
    assert all(w["valid_time"] not in missing for w in out["best_windows"])
    assert all(w["quality_rating"] > 0 for w in out["series"]), \
        "a missing frame must never appear as a zero-quality one"


def test_a_scan_that_resolves_nothing_says_so_instead_of_ranking_an_empty_list():
    out = sim_window.scan(SPOT, lambda s, h: (None, "none", {"reason": "x"}),
                          sim_window.plan_hours(6, 3, now=NOW))
    assert out["best_windows"] == []
    assert "nothing to rank" in out["note"]
    assert sim_window.summarize(out["best_windows"]) is None


def test_the_summary_names_the_hour_it_describes():
    """A caller reading only the summary must not be misled about WHICH window it is about."""
    out = sim_window.scan(SPOT, lambda s, h: (_flat_baseline(), "live_forecast", {}),
                          sim_window.plan_hours(6, 3, now=NOW), top=1)
    line = sim_window.summarize(out["best_windows"])
    assert out["best_windows"][0]["valid_time"] in line
    assert "quality" in line and "ft" in line


def test_the_baseline_sources_are_reported():
    """A scan mixing a staged override with live frames must not present them as one thing."""
    def baseline_at(spot, hour):
        src = "simulated_override" if hour.endswith("12:00:00Z") else "live_forecast"
        return _flat_baseline(), src, {}

    out = sim_window.scan(SPOT, baseline_at, sim_window.plan_hours(6, 3, now=NOW))
    assert out["scanned"]["baseline_sources"] == ["live_forecast", "simulated_override"]


# ── the CLAUDE.md mandate ───────────────────────────────────────────────────────────────────────

def test_geometry_resolves_ONCE_for_the_whole_scan(monkeypatch):
    """CLAUDE.md: resolve geometry ONCE per coordinate and reuse it across forecast hours — the
    correction is arithmetic, not I/O. A 24-frame scan re-resolving bathymetry every frame would be
    24 asset lookups for one coordinate."""
    from services.weather_pipeline import sim_rating
    sim_rating._GEOMETRY_CACHE.clear()
    calls = []
    real = sim_rating.resolve_surf_geometry

    def counted(lat, lng):
        calls.append((lat, lng))
        return real(lat, lng)

    monkeypatch.setattr(sim_rating, "resolve_surf_geometry", counted)
    hours = sim_window.plan_hours(21, 3, now=NOW)
    out = sim_window.scan(SPOT, lambda s, h: (_flat_baseline(), "live_forecast", {}), hours)
    assert out["scanned"]["frames_resolved"] == len(hours) >= 8
    assert len(calls) == 1, f"bathymetry resolved {len(calls)} times for one coordinate"
    sim_rating._GEOMETRY_CACHE.clear()


def test_every_frame_carries_the_same_fields_the_single_hour_answer_does():
    """The scan must not become a second, thinner reading of the same chain."""
    out = sim_window.scan(SPOT, lambda s, h: (_flat_baseline(), "live_forecast", {}),
                          sim_window.plan_hours(6, 3, now=NOW))
    for row in out["series"]:
        for field in ("valid_time", "breaking_height_ft", "quality_rating", "quality_label",
                      "conditions_label", "wind_class", "size_verdict"):
            assert field in row, f"{field} missing from a scanned frame"


# ── the ranking must be able to explain itself ──────────────────────────────────────────────────
#
# Measured 2026-08-06 at Pipeline: 08-06T02Z scored 2.2 and 08-07T11Z scored 7.2 at the SAME
# 3.5 ft, ~11 kt and a similar period. The driver was swell direction — 73.8 deg against a 325 deg
# shore normal, 10% alignment — and NOT ONE published field carried direction, alignment or the
# limiting factor. `calc` knew all three; the row dropped them. A reader with the source could not
# attribute a 3x score difference from the payload, which is this house's "a divergence count is
# not a finding, an attribution is" showing up on the product surface.

def _oblique(**over):
    """135 deg against this spot's 225.1 shore normal: 10% alignment, and the size/quality
    exposure disagreement fires at 3.54x. Measured, not assumed."""
    return _flat_baseline(swell_direction_deg=135.0, **over)


def test_a_frame_publishes_WHY_it_ranked_where_it_did():
    def baseline_at(spot, hour):
        return _oblique(), "live_forecast", {}

    out = sim_window.scan(SPOT, baseline_at, sim_window.plan_hours(6, 3, now=NOW), top=3)
    row = out["series"][0]
    assert row["swell_alignment_pct"] == 10.0, "alignment is the driver and must be published"
    assert row["limiting_factor"] == "swell_exposure"


def test_a_frame_whose_size_and_quality_DISAGREE_says_so_on_the_frame():
    """⛔ THE DISCLOSURE THAT REACHED EVERY SURFACE BUT THIS ONE. routes/weather.py,
    spot_conditions, spot_ratings, point_surf_augment and admin/surf_forecast all publish
    `directional_conflict`; the window scan — the one view a surfer uses to PICK an hour — dropped
    it, so the height it recommends never said it was an upper bound."""
    def baseline_at(spot, hour):
        return _oblique(), "live_forecast", {}

    out = sim_window.scan(SPOT, baseline_at, sim_window.plan_hours(6, 3, now=NOW), top=3)
    conflict = out["series"][0]["directional_conflict"]
    assert conflict["energy_disagreement"] == 3.54
    assert conflict["quality_exposure"] < conflict["height_exposure_factor"], \
        "the SIZE is the more generous of the two — that asymmetry is the whole warning"
    assert "means" not in conflict, "the prose is hoisted to `note`, never repeated per frame"


def test_the_conflict_PROSE_is_carried_ONCE_not_per_frame():
    """At hours_ahead=168/step=1 the series runs to 168 frames; repeating a ~200-char explanation
    on each would add ~34 KB to a payload whose own docstring budgets frames."""
    def baseline_at(spot, hour):
        return _oblique(), "live_forecast", {}

    out = sim_window.scan(SPOT, baseline_at, sim_window.plan_hours(24, 3, now=NOW), top=3)
    assert out["scanned"]["directional_conflict_frames"] == len(out["series"])
    assert out["note"].count("upper bound") == 1
    assert "of 9 frames disagree about swell exposure" in out["note"]


def test_the_SUMMARY_names_the_upper_bound():
    """One sentence deep, not one field deep — the same lesson the daylight defect taught. A caller
    who reads only the summary must not take a known-generous height as settled."""
    def baseline_at(spot, hour):
        return _oblique(), "live_forecast", {}

    out = sim_window.scan(SPOT, baseline_at, sim_window.plan_hours(6, 3, now=NOW), top=3)
    summary = sim_window.summarize(out["best_windows"])
    assert "upper bound" in summary
    assert "3.54x" in summary
    assert all(ord(c) < 128 for c in summary.replace("—", "-")), \
        "ASCII only apart from the pre-existing em dash: a caller may print this to a cp1252 console"


def test_an_ALIGNED_swell_carries_no_conflict_and_no_caveat():
    """The control. A gate that fires on everything says nothing — 225.1 deg is dead-on this
    spot's shore normal (100% alignment) and must produce neither the frame block nor the caveat."""
    def baseline_at(spot, hour):
        return _flat_baseline(), "live_forecast", {}

    out = sim_window.scan(SPOT, baseline_at, sim_window.plan_hours(6, 3, now=NOW), top=3)
    assert out["series"][0]["swell_alignment_pct"] == 100.0
    assert "directional_conflict" not in out["series"][0]
    assert out["scanned"].get("directional_conflict_frames") is None
    assert "upper bound" not in (sim_window.summarize(out["best_windows"]) or "")
    assert "upper bound" not in (out.get("note") or "")
