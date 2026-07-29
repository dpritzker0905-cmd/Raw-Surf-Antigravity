"""Can you actually surf that hour?

`services/weather_pipeline/sim_daylight.py` + its use in `sim_window.scan`.

The defect these pin, measured 2026-07-29 against the live app (17 spots, five continents, the
default 48 h / 3 h scan):

    #1 ranked window was in DARKNESS at 9 of 17 spots (52.9%)
    42 of 85 top-5 windows across those spots were in darkness (49.4%)
    and restricting the ranking to surfable light costs a MEDIAN 0.1 quality points

Nazare's answer was 2026-07-29T03:00:00Z — 4 a.m. local, two and a half hours before first light.

The two properties that must not quietly break:
  1. Daylight must NOT change `quality_rating`. CLAUDE.md's ONE FORECAST COMPOSITION rule requires
     the sim's score to stay byte-identical to the map's and the hub's for the same spot-hour, and
     darkness is a property of the observer, not of the swell.
  2. A dark hour must still be RETURNED (in `series`), just never PRESENTED as the best window.
"""
import os
import sys
from datetime import datetime, timezone

import pytest

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from services.weather_pipeline import sim_daylight, sim_window

UTC = timezone.utc

# Real coordinates, and the reference sunrise/sunset below were taken from api.sunrise-sunset.org
# and Open-Meteo on 2026-07-29 — two sources that share no code with ours.
NAZARE = (39.583333, -9.083333)
PIPELINE = (21.6637, -158.0515)
REYKJAVIK = (64.1466, -21.9426)
JBAY = (-34.0507, 24.9281)


# ── the algorithm ───────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("lat,lng,when,expected", [
    # Nazare 2026-07-29: sunrise 05:33Z, sunset 19:52Z (both references agree to 1 min).
    (*NAZARE, datetime(2026, 7, 29, 3, 0, tzinfo=UTC), "dark"),      # THE MEASURED DEFECT
    (*NAZARE, datetime(2026, 7, 29, 12, 0, tzinfo=UTC), "day"),
    (*NAZARE, datetime(2026, 7, 29, 19, 0, tzinfo=UTC), "day"),      # 53 min before sunset
    (*NAZARE, datetime(2026, 7, 29, 22, 0, tzinfo=UTC), "dark"),
    # Pipeline is UTC-10: 03:00Z is 5 p.m. the previous local day, i.e. broad daylight.
    (*PIPELINE, datetime(2026, 7, 29, 3, 0, tzinfo=UTC), "day"),
    (*PIPELINE, datetime(2026, 7, 29, 12, 0, tzinfo=UTC), "dark"),   # 2 a.m. local
    # Reykjavik in late July: the sun barely sets, so local midnight is still twilight, not dark.
    (*REYKJAVIK, datetime(2026, 7, 29, 0, 0, tzinfo=UTC), "twilight"),
    (*REYKJAVIK, datetime(2026, 7, 29, 13, 0, tzinfo=UTC), "day"),
])
def test_light_state_matches_the_independently_referenced_sun(lat, lng, when, expected):
    state, _ = sim_daylight.light_state(lat, lng, when)
    assert state == expected, f"{when} at ({lat},{lng}) read {state}, expected {expected}"


def test_the_southern_hemisphere_is_not_the_northern_one_negated():
    """J-Bay in July is mid-WINTER: a short day. If the declination sign were wrong this would
    read as a long summer day and the whole classification would invert below the equator."""
    _, noon = sim_daylight.light_state(*JBAY, datetime(2026, 7, 29, 10, 0, tzinfo=UTC))
    _, night = sim_daylight.light_state(*JBAY, datetime(2026, 7, 29, 22, 0, tzinfo=UTC))
    assert noon > 0, "local midday must have the sun up"
    assert night < sim_daylight.CIVIL_TWILIGHT_DEG, "local midnight must be dark"
    # Winter: J-Bay's daylight is well under 12 h.
    lit = sum(1 for h in range(24)
              if sim_daylight.light_state(*JBAY, datetime(2026, 7, 29, h, tzinfo=UTC))[0] == "day")
    assert 9 <= lit <= 11, f"J-Bay in July should be a short winter day, got {lit} lit hours"


def test_civil_twilight_counts_as_surfable_and_night_does_not():
    assert sim_daylight.is_surfable("day")
    assert sim_daylight.is_surfable("twilight"), "dawn patrol is ordinary surfing"
    assert not sim_daylight.is_surfable("dark")


def test_an_unreadable_stamp_degrades_the_annotation_not_the_forecast():
    assert sim_daylight.parse_hour("not-a-time") is None
    assert sim_daylight.annotate(39.5, -9.0, "not-a-time") == {}
    assert sim_daylight.annotate(None, None, "2026-07-29T03:00:00Z") == {}


def test_the_kill_switch_makes_it_inert(monkeypatch):
    monkeypatch.setenv("SIM_WINDOW_DAYLIGHT", "0")
    assert not sim_daylight.enabled()
    assert sim_daylight.annotate(*NAZARE, "2026-07-29T03:00:00Z") == {}


# ── the scan's ranking ──────────────────────────────────────────────────────────────────────────

NAZARE_SPOT = {"name": "Nazaré", "latitude": NAZARE[0], "longitude": NAZARE[1],
               "orientation": 296.5}
# 03:00Z is dark at Nazare, 12:00Z is broad daylight. Both are real frames the scan produces.
DARK_HOUR = "2026-07-29T03:00:00Z"
LIT_HOUR = "2026-07-29T12:00:00Z"
HOURS = [DARK_HOUR, "2026-07-29T06:00:00Z", "2026-07-29T09:00:00Z", LIT_HOUR]


def _baseline(**over):
    b = {"swell_height_m": 2.0, "swell_period_sec": 14.0, "swell_direction_deg": 296.5,
         "wind_speed_knots": 8.0, "wind_direction_deg": 116.5}
    b.update(over)
    return b


def _favour_the_dark_hour(spot, hour):
    """The dark hour gets the best sea state — exactly the case that produced the live defect,
    because the wind drops overnight and the rating weights wind heavily."""
    wind = 2.0 if hour == DARK_HOUR else 18.0
    return _baseline(wind_speed_knots=wind), "live_forecast", {}


def test_the_best_window_is_not_one_nobody_can_surf():
    """THE REGRESSION THIS FILE EXISTS FOR. The dark hour has the best sea state and must still
    lose the #1 slot to a surfable one."""
    out = sim_window.scan(NAZARE_SPOT, _favour_the_dark_hour, HOURS, top=4)
    assert out["best_windows"][0]["valid_time"] != DARK_HOUR
    assert out["best_windows"][0]["surfable_light"] is True


def test_the_dark_hour_is_still_returned_and_labelled_never_hidden():
    """Ranking, not filtering: a caller may legitimately want the night frame."""
    out = sim_window.scan(NAZARE_SPOT, _favour_the_dark_hour, HOURS, top=4)
    by_hour = {r["valid_time"]: r for r in out["series"]}
    assert DARK_HOUR in by_hour, "a dark hour must not be dropped from the series"
    assert by_hour[DARK_HOUR]["light"] == "dark"
    assert by_hour[DARK_HOUR]["surfable_light"] is False
    assert by_hour[LIT_HOUR]["light"] == "day"
    # It still ranks — last, behind every surfable hour.
    assert out["best_windows"][-1]["valid_time"] == DARK_HOUR


def test_daylight_does_NOT_change_the_quality_score(monkeypatch):
    """CLAUDE.md ONE FORECAST COMPOSITION: the sim's number must stay byte-identical to the one the
    map and the hub show for the same spot-hour. Darkness is a property of the OBSERVER."""
    lit = sim_window.scan(NAZARE_SPOT, _favour_the_dark_hour, HOURS, top=4)
    monkeypatch.setenv("SIM_WINDOW_DAYLIGHT", "0")
    off = sim_window.scan(NAZARE_SPOT, _favour_the_dark_hour, HOURS, top=4)
    a = {r["valid_time"]: r["quality_rating"] for r in lit["series"]}
    b = {r["valid_time"]: r["quality_rating"] for r in off["series"]}
    assert a == b, "the daylight annotation changed a quality score"
    c = {r["valid_time"]: r["breaking_height_ft"] for r in lit["series"]}
    d = {r["valid_time"]: r["breaking_height_ft"] for r in off["series"]}
    assert c == d, "the daylight annotation changed a breaking height"


def test_the_kill_switch_restores_the_old_ranking(monkeypatch):
    monkeypatch.setenv("SIM_WINDOW_DAYLIGHT", "0")
    out = sim_window.scan(NAZARE_SPOT, _favour_the_dark_hour, HOURS, top=4)
    assert out["best_windows"][0]["valid_time"] == DARK_HOUR, \
        "with the switch off, the pre-2026-07-29 pure-quality ranking must return"
    assert "light" not in out["series"][0]
    assert "surfable_light_frames" not in out["scanned"]


def test_quality_still_decides_AMONG_surfable_hours():
    """Daylight is a gate on usability, not a re-ranking of the surf. Two lit hours must still be
    ordered by quality."""
    best_lit = "2026-07-29T09:00:00Z"

    def baseline_at(spot, hour):
        wind = 2.0 if hour == best_lit else 18.0
        return _baseline(wind_speed_knots=wind), "live_forecast", {}

    out = sim_window.scan(NAZARE_SPOT, baseline_at, HOURS, top=4)
    assert out["best_windows"][0]["valid_time"] == best_lit


def test_a_horizon_entirely_in_darkness_still_answers_and_says_so():
    """Polar night, or a short horizon inside one night. Failing OPEN matters: an empty
    `best_windows` reads as 'there is no surf', which is a different claim from 'you cannot see'."""
    night = ["2026-07-29T01:00:00Z", "2026-07-29T02:00:00Z", "2026-07-29T03:00:00Z"]
    out = sim_window.scan(NAZARE_SPOT, lambda s, h: (_baseline(), "live_forecast", {}),
                          night, top=3)
    assert out["best_windows"], "a fully dark horizon must still rank something"
    assert out["scanned"]["all_frames_dark"] is True
    assert out["scanned"]["surfable_light_frames"] == 0
    assert "darkness" in out["note"]


def test_the_surfable_frame_count_is_reported():
    out = sim_window.scan(NAZARE_SPOT, lambda s, h: (_baseline(), "live_forecast", {}),
                          HOURS, top=4)
    # 03:00Z dark; 06:00Z is ~27 min after sunrise; 09:00Z and 12:00Z lit.
    assert out["scanned"]["surfable_light_frames"] == 3
    assert "all_frames_dark" not in out["scanned"]


def test_the_summary_names_the_light():
    out = sim_window.scan(NAZARE_SPOT, _favour_the_dark_hour, HOURS, top=4)
    line = sim_window.summarize(out["best_windows"])
    assert "daylight" in line or "twilight" in line
    assert out["best_windows"][0]["valid_time"] in line


def test_both_notes_survive_together():
    """A scan can be both partly unresolved AND entirely dark. The earlier version assigned
    `out["note"]` twice and the second silently overwrote the first."""
    night = ["2026-07-29T01:00:00Z", "2026-07-29T02:00:00Z", "2026-07-29T03:00:00Z"]

    def baseline_at(spot, hour):
        if hour == "2026-07-29T02:00:00Z":
            return None, "none", {"reason": "no marine data"}
        return _baseline(), "live_forecast", {}

    out = sim_window.scan(NAZARE_SPOT, baseline_at, night, top=3)
    assert "darkness" in out["note"]
    assert "EXCLUDED from the ranking" in out["note"]
