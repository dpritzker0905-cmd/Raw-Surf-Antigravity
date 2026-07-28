"""The forecast-anchored what-if: omit an input, hold the real forecast's value for it.

`simulate_weather_change` used to require all five weather inputs. That made "what if the wind
swings offshore at dawn on Thursday" — the question a surfer actually asks — unanswerable without
first calling `get_weather_forecast`, reading five numbers off it and retyping four of them
unchanged. Retyping four values by hand is not a neutral act: a transcription slip produces a
DIFFERENT sea state than the one being asked about, and the answer looks equally confident either
way. It also had no `valid_time` at all, so every what-if was implicitly about right now.

Omitted inputs now come from the same baseline `get_weather_forecast` reports, and the response
carries `baseline_delta` — what changed, and what it did to the rating.

⚠️ THE INVARIANT THESE TESTS EXIST FOR: with all five supplied and no hour named, this tool does
ZERO network I/O, exactly as before. Putting an unconditional fetch on a handler that had none is
the regression `576dcbdd` fixed — measured 42.2 s of blocking, past where an MCP client reports a
TIMEOUT instead of an answer, which is indistinguishable from "the sim is broken".
"""
import os
import sys

import pytest

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

import weather_sim_mcp
from services.weather_pipeline import sim_forecast

SIM = getattr(weather_sim_mcp.simulate_weather_change, "fn",
              weather_sim_mcp.simulate_weather_change)

SPOT = "Mavericks"
# A vector unlike any plausible forecast, so "held from the forecast" and "supplied" never collide.
FULL = dict(wind_speed_knots=7.0, wind_direction_deg=45.0, swell_height_m=3.5,
            swell_period_sec=16.0, swell_direction_deg=290.0)
# What the stubbed app "forecasts": deliberately different in every field.
BASE = {"swell_height_m": 1.6, "swell_period_sec": 11.0, "swell_direction_deg": 265.0,
        "wind_speed_knots": 18.0, "wind_direction_deg": 200.0}


@pytest.fixture(autouse=True)
def _hermetic(monkeypatch):
    monkeypatch.setenv("SIM_LIVE_CATALOG", "0")
    sim_forecast._FORECAST_CACHE.clear()
    sim_forecast._CATALOG_CACHE.clear()
    weather_sim_mcp._SIM_OVERRIDES.clear()
    yield
    sim_forecast._FORECAST_CACHE.clear()
    sim_forecast._CATALOG_CACHE.clear()
    weather_sim_mcp._SIM_OVERRIDES.clear()


@pytest.fixture
def counted_fetch(monkeypatch):
    """Stub the HTTP leg AND count it. The count is the assertion in the invariant tests."""
    calls = []

    def _fake(lat, lng, valid_time=None):
        calls.append((lat, lng, valid_time))
        return dict(BASE), {"model": "GFS", "valid_time": valid_time or "2026-07-30T12:00:00Z",
                            "served_surf_height_m": 2.0, "url": "stub"}

    monkeypatch.setenv("SIM_LIVE_FORECAST", "1")
    monkeypatch.setattr(sim_forecast, "fetch_live_forecast", _fake)
    monkeypatch.setattr(weather_sim_mcp.sim_forecast, "fetch_live_forecast", _fake)
    return calls


# ── THE INVARIANT ───────────────────────────────────────────────────────────────────────────────

def test_all_five_supplied_and_no_hour_makes_ZERO_network_calls(counted_fetch):
    """The pre-existing call shape must keep its pre-existing latency contract."""
    out = SIM(SPOT, **FULL)
    assert out["success"] is True
    assert counted_fetch == [], (
        f"simulate_weather_change dialled {len(counted_fetch)} time(s) for a fully-specified "
        f"what-if. That is the `576dcbdd` regression: this handler had no network dependency.")


def test_the_old_positional_call_still_means_what_it_meant(counted_fetch):
    """Back-compat: the five inputs were positional and required. Same order, same answer."""
    positional = SIM(SPOT, 7.0, 45.0, 3.5, 16.0, 290.0)
    keyword = SIM(SPOT, **FULL)
    assert positional["simulated_surf_output"] == keyword["simulated_surf_output"]
    assert counted_fetch == []


def test_a_cached_forecast_is_PEEKED_not_refetched(counted_fetch):
    """When the answer does not depend on the forecast we still enrich it if it is already in hand
    — but only from cache. This is what makes the delta free on the common flow."""
    spot = weather_sim_mcp.resolve_spot(SPOT)
    key = (round(float(spot["latitude"]), 4), round(float(spot["longitude"]), 4),
           sim_forecast.current_valid_time())
    sim_forecast._remember(key, (dict(BASE), {"model": "GFS", "valid_time": key[2]}))
    out = SIM(SPOT, **FULL)
    assert counted_fetch == [], "a cache peek must never dial"
    assert out["baseline_delta"]["baseline_source"] == "live_forecast"
    assert out["baseline_delta"]["held_from_forecast"] == []


# ── THE FEATURE ─────────────────────────────────────────────────────────────────────────────────

def test_omitting_an_input_holds_the_forecasts_value_for_it(counted_fetch):
    """The point of the change: change ONE thing and hold the rest of the real sea state."""
    out = SIM(SPOT, wind_speed_knots=4.0, wind_direction_deg=45.0)
    assert out["success"] is True
    ip = out["input_parameters"]
    assert ip["wind_speed_knots"] == 4.0                    # supplied
    assert ip["wind_direction_deg"] == 45.0                 # supplied
    assert ip["swell_height_m"] == BASE["swell_height_m"]   # held
    assert ip["swell_period_sec"] == BASE["swell_period_sec"]
    assert ip["swell_direction_deg"] == BASE["swell_direction_deg"]
    assert set(out["baseline_delta"]["held_from_forecast"]) == {
        "swell_height_m", "swell_period_sec", "swell_direction_deg"}
    assert len(counted_fetch) == 1


def test_omitting_everything_is_just_the_forecast_and_reports_no_change(counted_fetch):
    out = SIM(SPOT)
    assert out["input_parameters"]["swell_height_m"] == BASE["swell_height_m"]
    d = out["baseline_delta"]
    assert d["changed"] == {}
    assert d["verdict"] == "no change"
    assert d["quality_rating"]["delta"] == 0.0
    assert d["breaking_height_ft"]["delta"] == 0.0


def test_the_delta_says_what_changed_and_what_it_did(counted_fetch):
    """A what-if that reports only its absolute outcome makes the caller re-derive their own
    question. Swinging 18 kt onshore round to 4 kt offshore must read as an improvement."""
    spot = weather_sim_mcp.resolve_spot(SPOT)
    normal = weather_sim_mcp.shore_normal_for(spot)
    out = SIM(SPOT, wind_speed_knots=4.0, wind_direction_deg=(normal - 180) % 360)
    d = out["baseline_delta"]
    assert set(d["changed"]) == {"wind_speed_knots", "wind_direction_deg"}
    assert d["changed"]["wind_speed_knots"] == {"from": 18.0, "to": 4.0}
    assert d["quality_rating"]["delta"] > 0, "offshore and light must beat 18 kt onshore"
    assert d["verdict"] == "better"
    assert d["quality_rating"]["from"] != d["quality_rating"]["to"]


def test_a_worse_change_is_named_worse(counted_fetch):
    spot = weather_sim_mcp.resolve_spot(SPOT)
    normal = weather_sim_mcp.shore_normal_for(spot)
    out = SIM(SPOT, wind_speed_knots=35.0, wind_direction_deg=normal)   # a gale straight onshore
    assert out["baseline_delta"]["verdict"] == "worse"
    assert out["baseline_delta"]["quality_rating"]["delta"] < 0


def test_valid_time_anchors_the_whatif_to_that_hour(counted_fetch):
    out = SIM(SPOT, wind_speed_knots=4.0, valid_time="2026-07-31T15:00:00Z")
    assert out["requested_valid_time"] == "2026-07-31T15:00:00Z"
    assert counted_fetch[0][2] == "2026-07-31T15:00:00Z", "the hour must reach the forecast fetch"


def test_a_sub_hour_valid_time_snaps_and_says_so(counted_fetch):
    out = SIM(SPOT, wind_speed_knots=4.0, valid_time="2026-07-31T15:47:00Z")
    assert out["requested_valid_time"] == "2026-07-31T15:00:00Z"


def test_a_malformed_valid_time_fails_FAST_without_dialling(counted_fetch):
    """A bad hour interpolated into a URL would spend the whole timeout coming back empty —
    indistinguishable from 'no data at this spot'."""
    out = SIM(SPOT, valid_time="next tuesday")
    assert out["success"] is False
    assert "ISO-8601" in out["error"]
    assert counted_fetch == []


def test_naming_an_hour_fetches_even_when_every_input_is_supplied(counted_fetch):
    """An hour is the caller opting in to the forecast-anchored mode, so the delta is about THAT
    hour rather than silently about now."""
    SIM(SPOT, valid_time="2026-07-31T15:00:00Z", **FULL)
    assert len(counted_fetch) == 1
    assert counted_fetch[0][2] == "2026-07-31T15:00:00Z"


# ── HONESTY WHEN THERE IS NO FORECAST ───────────────────────────────────────────────────────────

def test_an_unfillable_omission_names_the_fields_and_the_reason(monkeypatch):
    """Never invent a value for a missing field. An invented wind is exactly how a blown-out day
    reads clean."""
    monkeypatch.setenv("SIM_LIVE_FORECAST", "0")
    out = SIM("Pipeline", wind_speed_knots=4.0)
    assert out["success"] is False
    assert "swell_height_m" in out["error"] and "swell_period_sec" in out["error"]
    assert "hint" in out
    assert "simulated_surf_output" not in out, "must not answer with a partially-invented sea state"


def test_with_no_forecast_a_fully_specified_whatif_still_works(monkeypatch):
    """The self-contained what-if must not become dependent on an app that may be unreachable."""
    monkeypatch.setenv("SIM_LIVE_FORECAST", "0")
    out = SIM("Pipeline", **FULL)
    assert out["success"] is True
    assert out["simulated_surf_output"]["breaking_height_ft"] > 0
    assert "baseline_delta" not in out, "no baseline in hand -> no delta claimed"


# ── RANGES, ON THE RESOLVED VALUE ───────────────────────────────────────────────────────────────

def test_a_supplied_value_out_of_range_is_still_rejected(counted_fetch):
    out = SIM(SPOT, wind_speed_knots=999.0)
    assert out["success"] is False and "wind speed" in out["error"]


def test_a_forecast_filled_value_out_of_range_says_where_it_came_from(monkeypatch):
    """Range checks moved onto the RESOLVED vector — a forecast-filled field is as capable of being
    out of range as a typed one, and the caller must not be told they typed it."""
    bad = dict(BASE, swell_period_sec=44.0)

    def _fake(lat, lng, valid_time=None):
        return dict(bad), {"model": "GFS"}

    monkeypatch.setenv("SIM_LIVE_FORECAST", "1")
    monkeypatch.setattr(weather_sim_mcp.sim_forecast, "fetch_live_forecast", _fake)
    out = SIM(SPOT, wind_speed_knots=4.0)
    assert out["success"] is False
    assert "swell period" in out["error"]
    assert "from the forecast" in out.get("note", "")


# ── THE OVERRIDE PRECEDENCE STILL HOLDS ─────────────────────────────────────────────────────────

def test_a_staged_override_is_the_baseline_a_whatif_is_measured_against(counted_fetch):
    """An override is the caller's explicit 'pretend the weather is this', so it outranks the live
    forecast here exactly as it does in get_weather_forecast — and costs no network."""
    spot = weather_sim_mcp.resolve_spot(SPOT)
    weather_sim_mcp._SIM_OVERRIDES[spot["name"]] = dict(BASE, swell_height_m=5.0)
    out = SIM(SPOT, **FULL)
    assert out["baseline_delta"]["baseline_source"] == "simulated_override"
    assert out["baseline_delta"]["changed"]["swell_height_m"]["from"] == 5.0
    assert counted_fetch == []


def test_admin_stages_the_RESOLVED_vector_not_the_partial_input(counted_fetch):
    """Staging half a vector would make every later read of that spot a mix of a staged scenario and
    a silently-dropped forecast."""
    out = SIM(SPOT, wind_speed_knots=4.0, caller_role="admin")
    assert out["persisted"] is True
    staged = weather_sim_mcp._SIM_OVERRIDES[weather_sim_mcp.resolve_spot(SPOT)["name"]]
    assert staged["wind_speed_knots"] == 4.0
    assert staged["swell_height_m"] == BASE["swell_height_m"]
    assert None not in staged.values()
