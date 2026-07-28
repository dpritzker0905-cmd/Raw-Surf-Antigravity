"""ONE identity per spot name — `services/weather_pipeline/sim_spots.py`.

These pin the 2026-07-28 fix. Measured against the RUNNING MCP server beforehand:

    get_weather_forecast("Mavericks")  ->  37.4952,-122.5028  region "California"
    get_weather_forecast("mavericks")  ->  37.4915,-122.5083  region "Half Moon Bay"

The same spot, asked twice, 637 m apart, because the hand-tuned table was consulted before the
app's own catalogue and its key match was case-SENSITIVE. Alongside that, resolution guessed
between rows sharing a name (`Miramar` twice, 9098 km apart) and reported a name that matched
several rows as "not found in the catalog".
"""
import os
import sys

import pytest

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

import weather_sim_mcp
from services.weather_pipeline import sim_forecast, sim_spots

# A stand-in catalogue with the three shapes that broke: a name the hand-tuned table also carries,
# a name TWO active rows share, and a pair that share a prefix but no exact name.
FAKE_CATALOG = [
    {"id": "uuid-mavs-live-0000000000000000000", "name": "Mavericks",
     "region": "Half Moon Bay", "latitude": 37.4915, "longitude": -122.5083},
    {"id": "uuid-miramar-pt-000000000000000000", "name": "MIRAMAR",
     "region": None, "latitude": 41.06667, "longitude": -8.6575},
    {"id": "uuid-miramar-ni-000000000000000000", "name": "Miramar",
     "region": "Leon", "latitude": 12.458, "longitude": -87.068},
    {"id": "uuid-linda-mar-00000000000000000000", "name": "Pacifica - Linda Mar",
     "region": "San Francisco", "latitude": 37.5958, "longitude": -122.532},
    {"id": "uuid-rockaway-000000000000000000000", "name": "Pacifica - Rockaway",
     "region": "San Mateo", "latitude": 37.608, "longitude": -122.498},
]


@pytest.fixture(autouse=True)
def _catalog(monkeypatch):
    """A deterministic catalogue, no network, no state carried between tests."""
    monkeypatch.setenv("SIM_LIVE_FORECAST", "0")
    monkeypatch.setattr(sim_forecast, "fetch_catalog", lambda: list(FAKE_CATALOG))
    sim_forecast._FORECAST_CACHE.clear()
    weather_sim_mcp._SIM_OVERRIDES.clear()
    yield
    weather_sim_mcp._SIM_OVERRIDES.clear()


# ── The root: the app's catalogue owns identity ───────────────────────────────────────────────

def test_the_live_catalogue_outranks_the_hand_tuned_coordinates():
    """THE defect. `Mavericks` is in both, and production's row must win."""
    spot = sim_spots.resolve("Mavericks").spot
    assert (spot["latitude"], spot["longitude"]) == (37.4915, -122.5083)
    assert spot["region"] == "Half Moon Bay"
    assert spot["id"] == "uuid-mavs-live-0000000000000000000"
    # ...and NOT the hand-tuned pair, which is 637 m away.
    assert spot["latitude"] != sim_spots.CATALOG_DEFAULTS["Mavericks"]["latitude"]


@pytest.mark.parametrize("spelling", ["Mavericks", "mavericks", "MAVERICKS", "  Mavericks  "])
def test_every_spelling_resolves_to_the_same_row(spelling):
    """Capitalisation used to decide WHICH catalogue answered, so it decided the coordinates."""
    spot = sim_spots.resolve(spelling).spot
    assert spot["id"] == "uuid-mavs-live-0000000000000000000"
    assert (spot["latitude"], spot["longitude"]) == (37.4915, -122.5083)


def test_the_baseline_is_grafted_but_the_location_is_not():
    """The hand-tuned rows still contribute what no catalogue row has — and nothing else."""
    spot = sim_spots.resolve("Mavericks").spot
    assert spot["base_swell_height"] == 3.5           # grafted
    assert spot["reference_size_m"] == 4.0            # grafted
    assert spot["latitude"] == 37.4915                # NOT grafted
    # `orientation` is a bearing measured for a DIFFERENT coordinate, and 44.9 deg wrong there.
    assert "orientation" not in spot


def test_a_name_the_catalogue_does_not_carry_falls_back_and_says_so():
    """`Pacifica State Beach` is not in the catalogue. Answering is fine; hiding it is not."""
    found = sim_spots.resolve("Pacifica State Beach")
    assert found.spot["latitude"] == 37.5956          # the hand-tuned coordinate
    assert found.identity_source == "catalog_default"


# ── Ambiguity: report the candidates, never guess, never say "not found" ──────────────────────

def test_a_name_two_rows_share_returns_both_instead_of_guessing():
    """`exact[0]` silently picked one of two spots 9098 km apart."""
    found = sim_spots.resolve("Miramar")
    assert found.spot is None
    assert {c["id"] for c in found.candidates} == {
        "uuid-miramar-pt-000000000000000000", "uuid-miramar-ni-000000000000000000"}
    err = sim_spots.ambiguity_error("Miramar", found.candidates)
    assert "id" in err["detail"]                      # the only way to tell them apart


def test_a_partial_name_matching_several_rows_is_not_reported_as_missing():
    """`Pacifica` matched 2 rows and the tool answered 'not found in the catalog'."""
    found = sim_spots.resolve("Pacifica")
    assert found.spot is None
    assert len(found.candidates) == 2
    res = weather_sim_mcp.get_weather_forecast("Pacifica")
    assert res["error"] == "ambiguous_spot_name"
    assert len(res["candidates"]) == 2
    assert "not found" not in str(res).lower()


def test_an_id_resolves_an_ambiguous_name():
    """The escape hatch, and the only one that works when two rows share a name."""
    spot = sim_spots.resolve("uuid-miramar-ni-000000000000000000").spot
    assert spot["region"] == "Leon"


def test_a_partial_name_matching_exactly_one_row_still_resolves():
    """Ambiguity handling must not cost the unambiguous substring case."""
    assert sim_spots.resolve("Linda Mar").spot["id"] == "uuid-linda-mar-00000000000000000000"


def test_an_unknown_name_is_still_not_found():
    found = sim_spots.resolve("Nowhere At All")
    assert found.spot is None and not found.candidates


# ── The offline path, and the index that must not go stale ────────────────────────────────────

def test_the_defaults_answer_when_the_catalogue_is_unavailable(monkeypatch):
    """The hand-tuned rows are the OFFLINE identity — that is what their coordinates are for."""
    monkeypatch.setattr(sim_forecast, "fetch_catalog", lambda: None)
    monkeypatch.setenv("SIM_SPOT_CATALOG", "0")       # and no dev.db either
    found = sim_spots.resolve("Mavericks")
    assert found.identity_source == "catalog_default"
    assert found.spot["latitude"] == 37.4952


def test_a_default_added_at_runtime_is_visible_immediately():
    """`CATALOG_DEFAULTS` is public and mutable, so a cached index of it desyncs. It did — the
    suite's own DB-propagation test injects an entry and stopped resolving."""
    sim_spots.CATALOG_DEFAULTS["Runtime Spot"] = {
        "id": 999, "name": "Runtime Spot", "region": "Test", "latitude": 37.5,
        "longitude": -122.5, "orientation": 270, "base_swell_height": 2.0,
        "base_swell_period": 10.0, "base_wind_speed": 10.0, "base_wind_direction": 90}
    try:
        assert sim_spots.resolve("Runtime Spot").spot["id"] == 999
    finally:
        sim_spots.CATALOG_DEFAULTS.pop("Runtime Spot", None)


# ── Staged overrides must be clearable by the name they were staged with ──────────────────────

@pytest.mark.parametrize("stage_as,clear_as", [
    ("mavericks", "mavericks"), ("MAVERICKS", "Mavericks"), ("Mavericks", "mavericks")])
def test_an_override_clears_under_the_spelling_it_was_staged_with(stage_as, clear_as):
    """Staging resolves the name, clearing used to pop the literal string — so
    `clear_simulation_overrides("mavericks")` reported `success: true, cleared: 0` and LEFT the
    override in place, where it outranked the live forecast on every later read."""
    staged = weather_sim_mcp.simulate_weather_change(
        spot_name=stage_as, wind_speed_knots=8.0, wind_direction_deg=45.0,
        swell_height_m=3.0, swell_period_sec=16.0, swell_direction_deg=225.0,
        caller_role="admin")
    assert staged["success"] is True
    assert weather_sim_mcp._SIM_OVERRIDES                      # something really is staged
    cleared = weather_sim_mcp.clear_simulation_overrides(clear_as)
    assert cleared["cleared"] == 1
    assert not weather_sim_mcp._SIM_OVERRIDES


def test_clearing_nothing_says_so_rather_than_implying_success():
    out = weather_sim_mcp.clear_simulation_overrides("Mavericks")
    assert out["cleared"] == 0
    assert "note" in out


# ── The tools must not regress to guessing ────────────────────────────────────────────────────

def test_the_forecast_tool_reports_which_catalogue_answered():
    res = weather_sim_mcp.get_weather_forecast("Mavericks")
    assert res["spot_source"] == "live_catalog"
    assert res["coordinates"] == {"lat": 37.4915, "lng": -122.5083}


def test_simulating_an_ambiguous_name_refuses_instead_of_picking_one():
    res = weather_sim_mcp.simulate_weather_change(
        spot_name="Miramar", wind_speed_knots=8.0, wind_direction_deg=45.0,
        swell_height_m=3.0, swell_period_sec=16.0, swell_direction_deg=225.0,
        caller_role="admin")
    assert res["success"] is False
    assert res["error"] == "ambiguous_spot_name"
    assert not weather_sim_mcp._SIM_OVERRIDES                  # and nothing was staged


def test_the_advisor_prompt_does_not_brief_about_a_different_spot():
    """It ended `or MOCK_SPOTS["Mavericks"]`, so an unknown name produced a confident briefing
    about a Californian big-wave break without ever saying the name was unknown."""
    text = weather_sim_mcp.get_surf_advisor_prompt("Nowhere At All")
    assert "Nowhere At All" in text
    assert "Mavericks" not in text
    ambiguous = weather_sim_mcp.get_surf_advisor_prompt("Miramar")
    assert "Leon" in ambiguous and "do not pick one" in ambiguous
