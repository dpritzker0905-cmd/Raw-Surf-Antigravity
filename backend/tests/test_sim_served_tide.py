"""W-30: the weather sim grades tide exactly as the glyph does, from the glyph's OWN served tide state.

`rate_one_spot` applies `tide_fit` (the tide level against the spot's `best_tide` prior) under RATING_TIDE,
'1' in the precompute lanes; the sim had no tide path, so at a spot with a usable tide band it could read up to
x2 the served quality (log 2026-09-29-sim-works-plan F8). The fix reads the tide the glyph graded with off the
/spot-ratings response `sim_observed.parity` already fetches: an OBSERVATION, not this process's env (the sim
runs with none), and zero new I/O. Gated SIM_SERVED_TIDE (default '0', dark). These pin: the gate, the
sanity checks on a remote payload, the one-fetch invariant, the composition on a "Low tide" spot, the
explanation reconciling, and the wiring in the forecast tool.
"""
import inspect
import io
import json
import math

import pytest

from services.weather_pipeline import sim_observed, sim_rating
from services.weather_pipeline import surf_rating as SR

SPOT = {"id": "s-low", "name": "Test Low Reef", "latitude": 21.5, "longitude": -158.2, "orientation": 250.0,
        "best_tide": "Low"}
PROV = {"served_surf_height_m": 1.4, "valid_time": "2026-09-30T18:00:00Z"}


def _payload(tide):
    return {"source": "precomputed", "spots": [{"spot_id": "s-low", "name": "Test Low Reef", "latitude": 21.5,
                                                 "longitude": -158.2, "score": 40.0, "level": "fair",
                                                 "raw_score": 40.0, "tide": tide}]}


@pytest.fixture
def served(monkeypatch):
    """A fake app: counts every request, answers with a glyph whose tide state the test sets."""
    calls = []
    box = {"tide": {"height_m": 1.1, "norm": 0.95, "trend": "rising"}}

    def urlopen(req, timeout=None):
        calls.append(req.full_url)
        return io.BytesIO(json.dumps(_payload(box["tide"])).encode())

    monkeypatch.setattr(sim_observed.urllib.request, "urlopen", urlopen)
    monkeypatch.setattr(sim_observed, "_cache", {})
    monkeypatch.setenv("SIM_OBSERVED", "1")
    monkeypatch.setenv("SIM_SERVED_TIDE", "1")
    monkeypatch.setenv("SIM_PRODUCTION_GEOMETRY", "0")      # no bathymetry: the catalog orientation frames it
    monkeypatch.delenv("RATING_LOCAL_SIZE", raising=False)
    return calls, box


def _rate(served_tide):
    return sim_rating.calculate_surf_rating(SPOT, 2.0, 14.0, 250.0, 4.0, 70.0, served_tide=served_tide)


def test_dark_by_default_and_no_request_is_made(served, monkeypatch):
    calls, _ = served
    monkeypatch.delenv("SIM_SERVED_TIDE")
    assert sim_observed.served_tide(SPOT, PROV, "live_forecast", "2026-09-30T18:00:00Z") is None
    assert calls == [], "off means no fetch at all"


def test_only_a_live_baseline_with_a_served_height_asks(served):
    """Flag ON: a what-if or a catalogue default describes a sea the app never rated, and without a served
    height parity never fetches either, so none of these may ask."""
    calls, _ = served
    for source, prov in (("override", PROV), ("catalog_default", PROV), ("live_forecast", {})):
        assert sim_observed.served_tide(SPOT, prov, source, None) is None
    assert calls == []


def test_the_glyphs_tide_is_read_and_labelled(served):
    got = sim_observed.served_tide(SPOT, PROV, "live_forecast", None)
    assert got == {"norm": 0.95, "trend": "rising", "height_m": 1.1, "source": "served_glyph"}


@pytest.mark.parametrize("bad", [None, {}, {"norm": float("nan")}, {"norm": 1.7}, {"norm": -0.1},
                                 {"norm": "0.5"}, {"norm": True}, "high"])
def test_a_bad_remote_tide_never_reaches_tide_fit(served, bad):
    _, box = served
    box["tide"] = bad
    assert sim_observed.served_tide(SPOT, PROV, "live_forecast", None) is None


def test_the_tide_rides_on_the_fetch_parity_already_makes(served):
    """The zero-new-I/O invariant: the forecast tool asks for the tide BEFORE rating and parity asks for the
    served rating AFTER, with the same arguments; the second must be the first one's cache hit."""
    calls, _ = served
    tide = sim_observed.served_tide(SPOT, PROV, "live_forecast", None)      # "now": the hour is the provenance's
    sim = _rate(tide)
    out = sim_observed.parity(sim, SPOT, PROV, "live_forecast", None)
    assert out and "quality" in out
    assert len(calls) == 1, f"one request for tide AND parity, got {len(calls)}"


def test_a_low_tide_spot_at_high_water_rates_as_the_glyph_would(served):
    """THE PARITY TEST ON A 'Low tide' SPOT: at norm 0.95 the glyph multiplies by tide_fit(0.95, Low); the sim
    must too, and nothing else may move."""
    tide = sim_observed.served_tide(SPOT, PROV, "live_forecast", None)
    without, with_tide = _rate(None), _rate(tide)
    fit = SR.tide_fit(0.95, SR.parse_best_tide("Low"))
    assert 0.5 <= fit < 1.0, "a Low spot at high water is penalised, floored at 0.5"
    assert with_tide["quality_raw"] == pytest.approx(without["quality_raw"] * fit, abs=0.1)
    assert with_tide["breaking_height_ft"] == without["breaking_height_ft"], "tide grades quality, not size here"
    assert with_tide["tide"] == {**tide, "best_tide": "Low"} and "tide" not in without
    why = with_tide.get("why") or {}
    assert abs(why["reconstruction_error"]) <= 0.15 and "warning" not in why, (
        "the explanation must carry the same tide as the score")
    assert why["limiting_factor"]["factor"] == "tide_fit"


def test_a_spot_without_a_usable_band_is_unchanged(served):
    spot = {**SPOT, "best_tide": "All tides"}
    tide = sim_observed.served_tide(spot, PROV, "live_forecast", None)
    a = sim_rating.calculate_surf_rating(spot, 2.0, 14.0, 250.0, 4.0, 70.0)
    b = sim_rating.calculate_surf_rating(spot, 2.0, 14.0, 250.0, 4.0, 70.0, served_tide=tide)
    assert math.isclose(a["quality_raw"], b["quality_raw"]) and a["quality_label"] == b["quality_label"]


def test_the_forecast_tool_passes_the_served_tide():
    import weather_sim_mcp
    src = inspect.getsource(weather_sim_mcp)
    assert "served_tide=sim_observed.served_tide(spot, provenance, source, hour)" in src
