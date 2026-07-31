"""The spatial scan — "which SPOT should I surf", the other half of `find_best_window`'s question.

`services/weather_pipeline/sim_compare.py`. The ranking is injected with a baseline resolver and the
geometry is seeded straight into `sim_rating._GEOMETRY_CACHE`, so every rule below is exercised
without a network, without ETOPO and without the MCP server. Seeding the CACHE (rather than
patching `sim_compare.spot_geometry`) is deliberate: `sim_rating.calculate_surf_rating` reads the
same cache, so the height, the score and the readiness verdict in these tests all describe ONE
geometry — patching only the compare module would grade a spot blind while still scoring it with a
bearing.

The three things that must not quietly go wrong:
  1. ⛔ A spot with NO shore normal must never outrank one that has a bearing. `swell_exposure`
     fails OPEN with no normal, so blindness can only push a score UP — measured over 48 catalogue
     spots on four coasts: +8.5 median, +29.8 mean, max +88.6, LEVEL changed at 66.7%. A naive
     ranking recommends the spot it knows least about.
  2. A spot with no forecast must be EXCLUDED and NAMED, never scored as flat.
  3. A winning margin smaller than the geometry's own resolving power must SAY SO rather than
     reading as a verdict.
"""
import os
import sys

import pytest

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from services.weather_pipeline import sim_compare, sim_rating          # noqa: E402
from services.weather_pipeline.surf_point import SurfGeometry          # noqa: E402

HOUR = "2026-07-30T20:00:00Z"          # daylight on the US west coast

# Three coordinates on one coast, far enough apart to be distinct spots and close enough to be
# candidates for the same query.
FULL_SPOT = {"id": "s-full", "name": "Full Geometry Reef", "region": "Test Coast",
             "latitude": 37.50, "longitude": -122.50, "distance_km": 1.0}
COARSE_SPOT = {"id": "s-coarse", "name": "Coarse Bearing Beach", "region": "Test Coast",
               "latitude": 37.60, "longitude": -122.52, "distance_km": 11.0}
BLIND_SPOT = {"id": "s-blind", "name": "No Bearing Cove", "region": "Test Coast",
              "latitude": 37.70, "longitude": -122.54, "distance_km": 22.0}


def _geo(normal, src, break_depth):
    return SurfGeometry(depth_m=100.0, shelf_width_km=40.0, coastal=True,
                        shore_normal_deg=normal, shore_normal_src=src,
                        magnet_factor=1.0, magnet_name=None,
                        break_depth_m=break_depth, nearshore=True)


@pytest.fixture(autouse=True)
def seeded_geometry(monkeypatch):
    """One geometry per test coordinate, shared by the rating and the readiness grader."""
    monkeypatch.setattr(sim_rating, "_GEOMETRY_CACHE", {
        (37.5, -122.5): _geo(225.0, "etopo", 22.0),        # full
        (37.6, -122.52): _geo(225.0, "coarse", None),      # degraded
        (37.7, -122.54): _geo(None, "none", None),         # blind
    })
    yield


def _sea(**over):
    b = {"swell_height_m": 2.0, "swell_period_sec": 14.0, "swell_direction_deg": 225.0,
         "wind_speed_knots": 5.0, "wind_direction_deg": 45.0}
    b.update(over)
    return b


def _baseline(sea_by_name=None, missing=()):
    def baseline_at(spot, hour):
        if spot["name"] in missing:
            return None, "none", {"reason": "no marine data at this coordinate"}
        sea = (sea_by_name or {}).get(spot["name"]) or _sea()
        return sea, "live_forecast", {}
    return baseline_at


# ── haversine / candidate selection ─────────────────────────────────────────────────────────────

def test_haversine_matches_a_known_distance():
    """SFO -> LAX is ~543 km. An equirectangular shortcut is ~1% off here and far worse at high
    latitude, which is why the real great circle is used."""
    d = sim_compare.haversine_km(37.6188, -122.3750, 33.9425, -118.4081)
    assert 540.0 < d < 546.0


def test_haversine_is_symmetric_and_zero_at_a_point():
    assert sim_compare.haversine_km(10.0, 20.0, 10.0, 20.0) == pytest.approx(0.0, abs=1e-9)
    a = sim_compare.haversine_km(60.0, -5.0, 61.0, 5.0)
    b = sim_compare.haversine_km(61.0, 5.0, 60.0, -5.0)
    assert a == pytest.approx(b)


def test_nearby_returns_nearest_first_and_reports_what_it_left_out():
    rows = [BLIND_SPOT, FULL_SPOT, COARSE_SPOT]
    got, total = sim_compare.nearby(rows, 37.50, -122.50, radius_km=100.0, cap=2)
    assert [r["name"] for r in got] == ["Full Geometry Reef", "Coarse Bearing Beach"]
    assert total == 3, "the cap must not hide how many candidates were in range"
    assert got[0]["distance_km"] < got[1]["distance_km"]


def test_nearby_excludes_beyond_the_radius_and_rows_without_coordinates():
    rows = [FULL_SPOT, BLIND_SPOT, {"id": "x", "name": "No Coords"}]
    got, total = sim_compare.nearby(rows, 37.50, -122.50, radius_km=5.0)
    assert [r["name"] for r in got] == ["Full Geometry Reef"]
    assert total == 1


def test_parse_centre_reads_a_coordinate_and_refuses_anything_else():
    assert sim_compare.parse_centre("37.5,-122.5") == (37.5, -122.5)
    assert sim_compare.parse_centre(" 37.5 , -122.5 ") == (37.5, -122.5)
    # A name must fall through to name resolution, not be read as half a coordinate.
    assert sim_compare.parse_centre("Mavericks") is None
    assert sim_compare.parse_centre("Playa de las Americas, Tenerife") is None
    assert sim_compare.parse_centre("37.5") is None
    assert sim_compare.parse_centre("37.5,-122.5,3") is None
    assert sim_compare.parse_centre("999,0") is None, "out-of-range latitude is not a coordinate"


# ── ⛔ the geometry gate: the measured reason this tool is not a plain sort ──────────────────────

def test_a_BLIND_spot_never_outranks_a_spot_with_a_bearing_even_scoring_far_higher():
    """THE point of this module. The blind cove is fed a perfect sea and the reef a poor one, so on
    quality alone the blind spot wins by a mile — and it must still be ranked last, because with no
    normal `swell_exposure` scored that perfect sea as arriving head-on when nothing knows which way
    the cove faces."""
    seas = {"No Bearing Cove": _sea(swell_height_m=2.5, swell_period_sec=16.0),
            "Full Geometry Reef": _sea(swell_height_m=0.9, swell_period_sec=8.0,
                                       wind_speed_knots=18.0, wind_direction_deg=225.0)}
    out = sim_compare.scan([BLIND_SPOT, FULL_SPOT], _baseline(seas), HOUR, top=5)

    by_name = {r["spot"]: r for r in out["series"]}
    assert by_name["No Bearing Cove"]["quality_rating"] > by_name["Full Geometry Reef"]["quality_rating"], \
        "precondition: on raw score the blind spot must be winning, or this test proves nothing"
    assert out["best_spots"][0]["spot"] == "Full Geometry Reef"
    assert out["series"][-1]["spot"] == "No Bearing Cove"
    assert by_name["No Bearing Cove"]["geometry_readiness"] == "blind"
    assert "ranked LAST" in out["note"] and "66.7%" in out["note"], \
        "the note must carry the measurement, not just the rule"


def test_a_blind_spot_is_KEPT_in_the_series_not_dropped():
    """Ranking, not filtering — a blind spot is still a real spot a caller may want to see."""
    out = sim_compare.scan([BLIND_SPOT, FULL_SPOT], _baseline(), HOUR, top=1)
    assert {r["spot"] for r in out["series"]} == {"No Bearing Cove", "Full Geometry Reef"}
    assert out["scanned"]["geometry"]["blind"] == 1
    assert out["scanned"]["geometry"]["full"] == 1


def test_when_every_candidate_is_blind_the_summary_says_the_ranking_cannot_judge_them():
    out = sim_compare.scan([BLIND_SPOT], _baseline(), HOUR, top=1)
    line = sim_compare.summarize(out["best_spots"], "somewhere")
    assert "No Bearing Cove" in line
    assert "no spot in range has a resolved shore normal" in line


def test_a_coarse_bearing_still_ranks_normally_but_is_labelled():
    """A wrong bearing is bad, no bearing is far worse (mean level error 1.04 vs 4.12) — so coarse
    geometry is ranked, not gated. It must still be visible in the payload."""
    seas = {"Coarse Bearing Beach": _sea(swell_height_m=2.6, swell_period_sec=16.0),
            "Full Geometry Reef": _sea(swell_height_m=0.8, swell_period_sec=7.0)}
    out = sim_compare.scan([FULL_SPOT, COARSE_SPOT], _baseline(seas), HOUR, top=2)
    assert out["best_spots"][0]["spot"] == "Coarse Bearing Beach"
    assert out["best_spots"][0]["geometry_readiness"] == "degraded"
    assert "coarse bearing" in sim_compare.summarize(out["best_spots"])


# ── ranking, daylight, honesty ──────────────────────────────────────────────────────────────────

def test_the_best_spot_is_the_highest_quality_one_at_equal_readiness():
    seas = {"Full Geometry Reef": _sea(wind_speed_knots=30.0, wind_direction_deg=225.0)}
    other = dict(FULL_SPOT, id="s-full2", name="Second Reef", latitude=37.5, longitude=-122.5)
    out = sim_compare.scan([FULL_SPOT, other], _baseline(seas), HOUR, top=2)
    assert out["best_spots"][0]["spot"] == "Second Reef"
    assert out["best_spots"][0]["quality_rating"] > out["best_spots"][1]["quality_rating"]


def test_darkness_outranks_quality_exactly_as_the_hour_scan_ranks_it():
    """Same rule as `sim_window`: a dark spot is a real forecast, it just must not be PRESENTED as
    where to go. Ranked below any lit spot, kept in the series."""
    night = "2026-07-31T10:00:00Z"        # ~02:00 local on the US west coast
    seas = {"Full Geometry Reef": _sea(swell_height_m=2.5, swell_period_sec=16.0),
            "Coarse Bearing Beach": _sea(swell_height_m=1.2, swell_period_sec=11.0)}
    lit = dict(COARSE_SPOT, name="Coarse Bearing Beach", longitude=-122.52)
    out = sim_compare.scan([FULL_SPOT, lit], _baseline(seas), night, top=2, light_hour=night)
    if all(r.get("surfable_light") is False for r in out["series"]):
        assert out["scanned"]["all_spots_dark"] is True
        assert "darkness" in out["note"]
    else:                                   # one lit, one dark -> the lit one must lead
        assert out["best_spots"][0]["surfable_light"] is True


def test_a_spot_with_no_forecast_is_EXCLUDED_and_NAMED_not_scored_flat():
    out = sim_compare.scan([FULL_SPOT, COARSE_SPOT, BLIND_SPOT],
                           _baseline(missing={"Coarse Bearing Beach"}), HOUR, top=5)
    assert out["scanned"]["spots_requested"] == 3
    assert out["scanned"]["spots_resolved"] == 2
    assert out["scanned"]["unresolved_spots"] == ["Coarse Bearing Beach"]
    assert "EXCLUDED from the ranking" in out["note"]
    assert all(r["spot"] != "Coarse Bearing Beach" for r in out["series"]), \
        "a missing forecast must never appear as a zero-quality spot"


def test_a_scan_that_resolves_nothing_says_so_instead_of_ranking_an_empty_list():
    out = sim_compare.scan([FULL_SPOT], _baseline(missing={"Full Geometry Reef"}), HOUR)
    assert out["best_spots"] == []
    assert "nothing to rank" in out["note"]
    assert sim_compare.summarize(out["best_spots"]) is None


def test_a_margin_inside_the_geometrys_resolving_power_is_declared_not_presented_as_a_verdict():
    """22.3 deg of shore-normal error is ~6 rating points, and a coarse bearing is a median 22.3 deg
    off. A 1-point win between two such spots is false precision."""
    seas = {"Coarse Bearing Beach": _sea(swell_height_m=2.02)}
    near_tie = dict(COARSE_SPOT, id="s-c2", name="Other Coarse Beach")
    out = sim_compare.scan([COARSE_SPOT, near_tie], _baseline(seas), HOUR, top=2)
    margin = out["series"][0]["quality_rating"] - out["series"][1]["quality_rating"]
    assert margin < sim_compare.RESOLVING_POWER_PTS
    assert out["scanned"]["within_resolving_power"] is True
    assert "not distinguishable" in out["note"]


def test_two_full_geometry_spots_in_a_near_tie_do_NOT_raise_the_resolving_power_caveat():
    """The caveat is about the COARSE bearing's error bar. Measured geometry does not carry it, so
    firing there would train callers to ignore the note."""
    other = dict(FULL_SPOT, id="s-full2", name="Second Reef")
    out = sim_compare.scan([FULL_SPOT, other], _baseline({"Second Reef": _sea(swell_height_m=2.02)}),
                           HOUR, top=2)
    assert "within_resolving_power" not in out["scanned"]


def test_a_swell_from_behind_the_coast_discloses_the_MISSING_REFRACTION_rather_than_hiding_it():
    """`swell_exposure` floors at 0.10 once the swell is 90°+ off the shore normal, and the chain
    carries no Kr term — so a point break that surfs on wrapping swell reads worst exactly when it
    is working. Burying a famous point under a beach break is the one thing a RANKING can get wrong
    that a single-spot answer never could, so it must be said out loud."""
    behind = _sea(swell_direction_deg=45.0)          # shore normal is 225 -> 180 deg off
    out = sim_compare.scan([FULL_SPOT], _baseline({"Full Geometry Reef": behind}), HOUR, top=1)
    row = out["series"][0]
    assert row["exposure_floored"] is True
    assert row["swell_exposure"] == pytest.approx(0.10, abs=1e-6)
    assert "no refraction term" in out["note"] and "WRAPPING" in out["note"]


def test_a_head_on_swell_does_not_raise_the_refraction_caveat():
    out = sim_compare.scan([FULL_SPOT], _baseline(), HOUR, top=1)
    assert "exposure_floored" not in out["series"][0]
    assert "refraction" not in (out.get("note") or "")


def test_every_row_carries_its_limiting_factor_so_the_ranking_says_WHY():
    out = sim_compare.scan([FULL_SPOT], _baseline(), HOUR, top=1)
    row = out["best_spots"][0]
    assert row["limiting_factor"]["factor"]
    assert row["limiting_factor"]["means"]


def test_the_score_is_the_one_the_rest_of_the_app_would_show(monkeypatch):
    """ONE FORECAST COMPOSITION: the compared score must be `calculate_surf_rating`'s, not a second
    opinion computed for this screen."""
    sea = _sea()
    out = sim_compare.scan([FULL_SPOT], _baseline({"Full Geometry Reef": sea}), HOUR, top=1)
    direct = sim_rating.calculate_surf_rating(
        FULL_SPOT, sea["swell_height_m"], sea["swell_period_sec"], sea["swell_direction_deg"],
        sea["wind_speed_knots"], sea["wind_direction_deg"])
    assert out["best_spots"][0]["quality_rating"] == direct["quality_rating"]
    assert out["best_spots"][0]["breaking_height_ft"] == direct["breaking_height_ft"]


def test_the_summary_names_the_spot_and_how_far_away_it_is():
    out = sim_compare.scan([FULL_SPOT], _baseline(), HOUR, top=1)
    line = sim_compare.summarize(out["best_spots"], "Half Moon Bay")
    assert "Full Geometry Reef" in line and "Half Moon Bay" in line
    assert "km away" in line and "quality" in line and "ft" in line


def test_the_baseline_sources_are_reported():
    """A scan mixing a staged override with live spots must not present them as one thing."""
    def baseline_at(spot, hour):
        src = "simulated_override" if spot["name"] == "Full Geometry Reef" else "live_forecast"
        return _sea(), src, {}

    out = sim_compare.scan([FULL_SPOT, COARSE_SPOT], baseline_at, HOUR)
    assert out["scanned"]["baseline_sources"] == ["live_forecast", "simulated_override"]
