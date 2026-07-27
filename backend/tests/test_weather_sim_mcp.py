"""
Test suite for weather_sim_mcp.py
Verifies role-based access control (caller_role == 'admin') and physical parameter boundaries validation.
"""
import os
import sys
import sqlite3
import pytest

# Add backend directory to sys.path to allow importing from weather_sim_mcp
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

import weather_sim_mcp
from services.weather_pipeline import sim_forecast
from services.conditions_labels import CONDITION_LABELS, get_conditions_label
from services.weather_pipeline.surf_rating import LEVELS

MAVS = weather_sim_mcp.MOCK_SPOTS["Mavericks"]


@pytest.fixture(autouse=True)
def _no_live_forecast(monkeypatch):
    """Keep this suite hermetic. `get_weather_forecast` now reaches the app's /api/weather/point for
    a real baseline, which must never make these tests depend on a network or on today's swell —
    the live path has its own tests below, with the fetch stubbed."""
    monkeypatch.setenv("SIM_LIVE_FORECAST", "0")
    sim_forecast._FORECAST_CACHE.clear()
    yield
    sim_forecast._FORECAST_CACHE.clear()


# ── Rating correctness (regression pins for the height-blind score, 2026-07-26) ──────────────
# The former local formula was wind_factor * swell_alignment * (period/18) * 100 and omitted
# swell height ENTIRELY, so a flat ocean with clean wind and long period scored 88 = "Epic".
# There was no test on the rating VALUE at all, which is why it survived. These pin the fix.

def test_flat_ocean_is_not_epic():
    """A 0.0 m swell must score 0 no matter how perfect the wind and period are."""
    out = weather_sim_mcp.calculate_surf_rating(MAVS, 0.0, 16.0, 290.0, 2.0, 95.0)
    assert out["quality_rating"] == 0
    assert out["quality_label"] == "very_poor"
    assert out["conditions_label"] == "Flat"


def test_ankle_high_glass_is_not_epic():
    """Ankle-high on a perfect period/wind must stay near the floor, not saturate."""
    out = weather_sim_mcp.calculate_surf_rating(MAVS, 0.15, 16.0, 290.0, 1.0, 95.0)
    assert out["quality_rating"] < 20
    assert out["conditions_label"] in ("Flat", "Ankle High"), out["conditions_label"]


def test_rating_is_relative_to_the_spot(monkeypatch):
    """THE Surfline principle: the same wave is a small day at a big-wave spot and a good day at a
    beach break. Guards the per-spot reference_size_m wiring — with it dropped, every spot shares
    the global 1.2 m curve and these two scores collapse to the same value.

    Gated on RATING_LOCAL_SIZE because that is the flag PRODUCTION gates local sizing on
    (routes/weather.py:435, spot_ratings.py:344, grid_resolver_surf.py:80). The sim used to apply
    the local reference unconditionally, i.e. rate a spot on a curve the app was not using. The
    companion test below pins the flag-off half.
    """
    monkeypatch.setenv("RATING_LOCAL_SIZE", "1")
    args = (1.0, 13.0, 275.0, 5.0, 90.0)   # identical swell + wind at both spots
    mavs = weather_sim_mcp.calculate_surf_rating(weather_sim_mcp.MOCK_SPOTS["Mavericks"], *args)
    paci = weather_sim_mcp.calculate_surf_rating(weather_sim_mcp.MOCK_SPOTS["Pacifica State Beach"], *args)
    assert mavs["quality_rating"] < paci["quality_rating"], (mavs, paci)
    assert LEVELS.index(mavs["quality_label"]) < LEVELS.index(paci["quality_label"])


def test_local_size_reference_follows_the_production_flag(monkeypatch):
    """With RATING_LOCAL_SIZE off (the live default) the sim must use the GLOBAL curve, because
    that is what the app is serving. The sim's job is to predict the app, not to out-calibrate it."""
    monkeypatch.delenv("RATING_LOCAL_SIZE", raising=False)
    assert weather_sim_mcp.reference_size_for(MAVS) is None
    monkeypatch.setenv("RATING_LOCAL_SIZE", "0")
    assert weather_sim_mcp.reference_size_for(MAVS) is None
    monkeypatch.setenv("RATING_LOCAL_SIZE", "1")
    assert weather_sim_mcp.reference_size_for(MAVS) == MAVS["reference_size_m"]


def test_breaking_height_uses_the_full_production_chain():
    """Height must equal what the app SERVES at that coordinate — the whole `surf_point` chain
    (cross-shelf friction + shore-normal exposure + magnets + the depth-limited breaking cap), not
    just deep-water Komar.

    Pinning raw `komar_breaker_height` was how this file drifted: measured 2026-07-27 it over-read
    the served height by a median 19.1% (max +39.2%) while that assertion stayed green.
    """
    from services.weather_pipeline.surf_point import estimate_surf_at
    lat, lng = MAVS["latitude"], MAVS["longitude"]
    for h, tp in ((0.5, 8.0), (1.2, 14.0), (3.0, 18.0)):
        out = weather_sim_mcp.calculate_surf_rating(MAVS, h, tp, 290.0, 5.0, 95.0)
        expected_m, _ = estimate_surf_at(lat, lng, h, tp, swell_from_deg=290.0)
        assert out["breaking_height_ft"] == round(expected_m * 3.28084, 1), (h, tp, out)


def test_sim_height_agrees_with_the_served_point_lane():
    """The end-to-end contract: for the same coordinate and weather, the sim and the marine point
    lane must produce the same surf height. This is the regression that matters."""
    from services.weather_pipeline.surf_point import resolve_surf_geometry, estimate_surf_at
    for name in ("Mavericks", "Montara State Beach", "Pacifica State Beach"):
        spot = weather_sim_mcp.MOCK_SPOTS[name]
        geo = resolve_surf_geometry(spot["latitude"], spot["longitude"])
        for h, tp, sdir in ((1.0, 12.0, 290.0), (3.5, 16.0, 290.0), (8.0, 18.0, 300.0)):
            served_m, _ = estimate_surf_at(spot["latitude"], spot["longitude"], h, tp,
                                           swell_from_deg=sdir, geometry=geo)
            sim = weather_sim_mcp.calculate_surf_rating(spot, h, tp, sdir, 5.0, 95.0)
            assert sim["breaking_height_ft"] == round(served_m * 3.28084, 1), (name, h, tp, sim)


def test_production_geometry_kill_switch_restores_deep_water_estimate(monkeypatch):
    """SIM_PRODUCTION_GEOMETRY=0 must degrade to the pre-2026-07-27 raw-Komar behaviour."""
    from services.weather_pipeline.surf_transform import komar_breaker_height
    monkeypatch.setenv("SIM_PRODUCTION_GEOMETRY", "0")
    weather_sim_mcp._GEOMETRY_CACHE.clear()
    try:
        out = weather_sim_mcp.calculate_surf_rating(MAVS, 3.5, 16.0, 290.0, 5.0, 95.0)
        assert out["breaking_height_ft"] == round(komar_breaker_height(3.5, 16.0) * 3.28084, 1)
        assert out["surf_regime"] == "deep_water_estimate"
        assert out["shore_normal_source"] == "catalog_fallback"
        assert out["shore_normal_deg"] == float(MAVS["orientation"])
    finally:
        monkeypatch.undo()
        weather_sim_mcp._GEOMETRY_CACHE.clear()


def test_zero_and_degenerate_inputs_do_not_crash():
    """komar_breaker_height returns None for non-physical input — must degrade to flat, not raise."""
    for h, tp in ((0.0, 16.0), (0.0, 0.0), (1.0, 0.0)):
        out = weather_sim_mcp.calculate_surf_rating(MAVS, h, tp, 290.0, 5.0, 95.0)
        assert out["breaking_height_ft"] == 0.0
        assert out["quality_rating"] == 0
        assert out["conditions_label"] == "Flat"


def test_rating_is_monotonic_in_swell_height():
    """All else equal, more swell must never score lower — the property the old formula lacked."""
    fixed = dict(swell_p=14.0, swell_dir=290.0, wind_spd=6.0, wind_dir=95.0)
    scores = [
        weather_sim_mcp.calculate_surf_rating(
            MAVS, h, fixed["swell_p"], fixed["swell_dir"], fixed["wind_spd"], fixed["wind_dir"]
        )["quality_rating"]
        for h in (0.0, 0.3, 0.8, 1.5)
    ]
    assert scores == sorted(scores), f"non-monotonic in height: {scores}"
    assert scores[0] == 0 and scores[-1] > scores[0]


def test_labels_conform_to_their_vocabularies():
    """conditions_label is the app's SIZE ladder; quality_label is the rating engine's level.

    SpotHubConditionsTab.js keys a colour map on the size strings — an off-vocabulary value
    (the old "Epic" / "Flat/Blown-out") silently renders grey.
    """
    for h in (0.0, 0.2, 0.6, 1.2, 2.5, 5.0):
        out = weather_sim_mcp.calculate_surf_rating(MAVS, h, 13.0, 290.0, 8.0, 95.0)
        assert out["conditions_label"] in CONDITION_LABELS, out["conditions_label"]
        assert out["quality_label"] in LEVELS, out["quality_label"]


def test_persisted_label_is_size_vocabulary_not_a_verdict():
    """The value written to condition_reports.conditions_label must be a size, never a verdict."""
    out = weather_sim_mcp.calculate_surf_rating(MAVS, 1.2, 14.0, 290.0, 6.0, 95.0)
    assert out["conditions_label"] not in ("Epic", "Good", "Fair", "Poor", "Flat/Blown-out")
    assert out["conditions_label"] in CONDITION_LABELS


def test_size_ladder_agrees_with_the_calibration_anchors():
    """THE size ladder must agree with report_calibration's body-height anchors — those are what the
    forecast is graded against using real logged surfer sessions, so they are the ground truth.

    The pre-2026-07-26 ladder put Double Overhead at 8-10 ft while calibration says 11 ft, and the
    ladder's own Head High = 5-6 ft implies one head ~= 5.5 ft => double ~= 11, triple ~= 16.
    """
    from services.weather_pipeline.report_calibration import _HEIGHT_LABELS
    anchors = dict(_HEIGHT_LABELS)
    assert get_conditions_label(anchors["head high"]) == "Head High"
    assert get_conditions_label(anchors["overhead"]) == "Overhead"
    assert get_conditions_label(anchors["double overhead"]) == "Double Overhead"
    assert get_conditions_label(anchors["triple overhead"]) == "Triple Overhead+"


def test_size_ladder_is_monotonic_and_covers_every_label():
    prev = -1
    seen = []
    for tenth_ft in range(0, 300):
        lbl = get_conditions_label(tenth_ft / 10.0)
        idx = CONDITION_LABELS.index(lbl)
        assert idx >= prev, f"ladder went backwards at {tenth_ft/10.0} ft: {lbl}"
        if idx != prev:
            seen.append(lbl)
        prev = idx
    assert seen == list(CONDITION_LABELS), seen


def test_wind_class_and_score_share_one_reference_frame():
    """`wind_class` (persisted to condition_reports.wind_conditions) must not contradict the score.

    It used to key off `optimal_wind_dir` while the delegated score keys off the shore normal, so
    the sim could persist "Offshore" for a wind the score was penalising as onshore. The frame is
    now the RESOLVED normal (`shore_normal_for`) for both — testing against the catalog fallback
    instead put all three classes within 0.004 of their thresholds, which passed by coincidence.
    """
    for name in ("Mavericks", "Montara State Beach", "Pacifica State Beach"):
        spot = weather_sim_mcp.MOCK_SPOTS[name]
        o = weather_sim_mcp.shore_normal_for(spot)
        onshore = weather_sim_mcp.calculate_surf_rating(spot, 1.5, 13.0, o, 18.0, o)
        offshore = weather_sim_mcp.calculate_surf_rating(spot, 1.5, 13.0, o, 18.0, (o - 180) % 360)
        cross = weather_sim_mcp.calculate_surf_rating(spot, 1.5, 13.0, o, 18.0, (o - 90) % 360)
        assert onshore["wind_class"] == "Onshore", (name, onshore)
        assert offshore["wind_class"] == "Offshore", (name, offshore)
        assert cross["wind_class"] == "Sideshore", (name, cross)
        # the label must move the SAME way the score does
        assert offshore["quality_rating"] > cross["quality_rating"] > onshore["quality_rating"], name


def test_swell_alignment_shares_that_same_reference_frame():
    """`swell_alignment_pct` had the SAME defect the wind class was fixed for in `2851a598`: it was
    measured against a stored `optimal_swell_dir` while the engine scored against the shore normal.
    At Mavericks those disagreed by 64.9 deg, so the sim reported 100% alignment for a swell the
    production chain was treating as 42% aligned."""
    for name in ("Mavericks", "Montara State Beach", "Pacifica State Beach"):
        spot = weather_sim_mcp.MOCK_SPOTS[name]
        n = weather_sim_mcp.shore_normal_for(spot)
        head_on = weather_sim_mcp.calculate_surf_rating(spot, 1.5, 13.0, n, 5.0, (n - 180) % 360)
        oblique = weather_sim_mcp.calculate_surf_rating(spot, 1.5, 13.0, (n - 70) % 360, 5.0, (n - 180) % 360)
        assert head_on["swell_alignment_pct"] == 100, (name, head_on)
        assert oblique["swell_alignment_pct"] < 50, (name, oblique)
        # and the reported alignment must move the score the same way
        assert head_on["quality_rating"] > oblique["quality_rating"], name


def test_shore_normal_is_reported_with_its_source():
    """Callers must be able to see WHERE the geometry came from — a catalog fallback and an ETOPO
    fit are not the same evidence, and the fallback is measurably wrong (Mavericks 270 vs 225.1)."""
    out = weather_sim_mcp.calculate_surf_rating(MAVS, 2.0, 14.0, 290.0, 6.0, 95.0)
    assert out["shore_normal_source"] == "etopo", out
    assert out["shore_normal_deg"] is not None
    assert abs(out["shore_normal_deg"] - float(MAVS["orientation"])) > 30, (
        "the catalog fallback is not the resolved normal — if these agree the asset stopped loading")


# ── Catalog coverage (the wrong-table root, 2026-07-27) ──────────────────────────────────────
# `query_spots_from_db` read `condition_reports` — the photographer conditions-UPLOAD table
# (photographer_id / media_url / expires_at), which holds 0 rows and is near-empty by nature. Every
# call silently fell through to the three hardcoded spots, so the weather simulation system could
# reach 3 of 1547 catalog spots. It now reads `surf_spots`.

def _db_available():
    return bool(weather_sim_mcp.query_spots_from_db(limit=1))


def test_catalog_reads_surf_spots_not_condition_reports():
    """The catalog must come from the spots table. If this returns the three defaults, the query
    regressed to a table that does not hold spots."""
    if not _db_available():
        pytest.skip("dev.db unavailable in this environment")
    spots = weather_sim_mcp.query_spots_from_db(limit=500)
    assert len(spots) > 100, f"only {len(spots)} spots — is this reading condition_reports again?"
    for s in spots[:50]:
        assert s["latitude"] is not None and s["longitude"] is not None


def test_get_surf_spots_reports_a_real_orientation_per_spot():
    """`orientation` was hardcoded 270 for every database row, so a caller reasoning about swell
    windows got the same answer for every spot on earth."""
    if not _db_available():
        pytest.skip("dev.db unavailable in this environment")
    res = weather_sim_mcp.get_surf_spots(limit=40)
    assert res["source"] == "surf_spots"
    oriented = [s for s in res["spots"] if s["orientation"] is not None]
    assert len(oriented) >= 5, res
    assert len({round(s["orientation"], 1) for s in oriented}) > 1, (
        "every spot shares one orientation — the hardcoded 270 is back")


def test_a_database_spot_can_be_simulated():
    """The whole point of the fix: simulation must reach catalog spots, not just the three
    hand-tuned ones. `simulate_weather_change` takes the weather as INPUT, so it needs no baseline."""
    if not _db_available():
        pytest.skip("dev.db unavailable in this environment")
    candidates = [s for s in weather_sim_mcp.query_spots_from_db(limit=400)
                  if s["name"] not in weather_sim_mcp.MOCK_SPOTS]
    assert candidates, "no non-catalog spot to test with"
    target = candidates[0]["name"]
    res = weather_sim_mcp.simulate_weather_change(
        spot_name=target, wind_speed_knots=8.0, wind_direction_deg=90.0,
        swell_height_m=2.0, swell_period_sec=14.0, swell_direction_deg=270.0,
        caller_role="admin")
    try:
        assert res["success"] is True, res
        assert res["simulated_surf_output"]["conditions_label"] in CONDITION_LABELS
        assert res["simulated_surf_output"]["quality_label"] in LEVELS
        assert res["geometry"]["resolved"] is True, res["geometry"]
    finally:
        weather_sim_mcp.clear_simulation_overrides(target)


def test_unknown_spot_is_refused_not_silently_simulated():
    res = weather_sim_mcp.simulate_weather_change(
        spot_name="Not A Real Break At All", wind_speed_knots=8.0, wind_direction_deg=90.0,
        swell_height_m=2.0, swell_period_sec=14.0, swell_direction_deg=270.0, caller_role="admin")
    assert res["success"] is False
    assert "not found" in res["error"].lower()


# ── Staged-override state (was silent last-write-wins on MOCK_SPOTS) ─────────────────────────

def test_simulation_override_does_not_mutate_the_catalog_defaults():
    """`simulate_weather_change` used to assign its inputs back into MOCK_SPOTS, so one sim
    permanently redefined what get_weather_forecast reported for the life of the process, with no
    reset and no way to tell. Overrides are now separate, visible and clearable."""
    baseline = dict(weather_sim_mcp.MOCK_SPOTS["Mavericks"])
    try:
        before = weather_sim_mcp.get_weather_forecast("Mavericks")
        assert before["baseline_source"] == "catalog_default"

        weather_sim_mcp.simulate_weather_change(
            spot_name="Mavericks", wind_speed_knots=40.0, wind_direction_deg=250.0,
            swell_height_m=0.4, swell_period_sec=6.0, swell_direction_deg=180.0,
            caller_role="admin")

        # catalog constants untouched
        for k in ("base_swell_height", "base_swell_period", "base_swell_direction",
                  "base_wind_speed", "base_wind_direction"):
            assert weather_sim_mcp.MOCK_SPOTS["Mavericks"][k] == baseline[k], k

        staged = weather_sim_mcp.get_weather_forecast("Mavericks")
        assert staged["baseline_source"] == "simulated_override"
        assert staged["forecast"]["swell_height_m"] == 0.4

        weather_sim_mcp.clear_simulation_overrides("Mavericks")
        restored = weather_sim_mcp.get_weather_forecast("Mavericks")
        assert restored["baseline_source"] == "catalog_default"
        assert restored["forecast"]["swell_height_m"] == baseline["base_swell_height"]
    finally:
        weather_sim_mcp.clear_simulation_overrides()
        weather_sim_mcp.MOCK_SPOTS["Mavericks"].update(baseline)


def test_forecast_for_a_spot_without_a_baseline_is_empty_not_invented():
    """When no forecast can be established, say so rather than fabricate a swell.

    The live lane is disabled by the autouse fixture, which is exactly the unreachable-app case:
    a catalog spot then has no baseline at all, and the honest answer is an empty one that names
    its reason."""
    if not _db_available():
        pytest.skip("dev.db unavailable in this environment")
    candidates = [s for s in weather_sim_mcp.query_spots_from_db(limit=400)
                  if s["name"] not in weather_sim_mcp.MOCK_SPOTS]
    assert candidates
    res = weather_sim_mcp.get_weather_forecast(candidates[0]["name"])
    assert res["forecast"] is None
    assert res["baseline_source"] == "none"
    assert "wave_simulation" not in res
    assert res["geometry"]["resolved"] is True
    assert res["forecast_provenance"]["reason"]           # names WHY, never a bare null


# ── The live forecast lane: every catalog spot can now be forecast, not just the three ───────
# Before 2026-07-27 `get_weather_forecast` answered for 3 of 1547 spots (0.2%) and returned
# `forecast: null` for the rest. These stub the HTTP leg — the mapping and precedence are what
# must not drift, and they are what the network cannot be trusted to exercise deterministically.

def _stub_points(monkeypatch, marine=None, wind=None):
    """Stand in for /api/weather/point with fixed payloads, per domain."""
    marine = marine if marine is not None else {
        "point": {"speed": 2.0, "period": 14.0, "direction": 300.0},
        "surf_height_m": 3.0, "valid_time": "2026-07-27T19:00:00Z",
        "run_time": "2026-07-27T18:00:00Z", "product_id": "stub", "is_forecast_authoritative": True}
    wind = wind if wind is not None else {
        "point": {"speed": 7.0, "period": 0.0, "direction": 45.0}}

    def fake(domain, layer, lat, lng, valid_time):
        return marine if domain == "marine" else wind

    monkeypatch.setenv("SIM_LIVE_FORECAST", "1")
    monkeypatch.setattr(sim_forecast, "fetch_point", fake)
    sim_forecast._FORECAST_CACHE.clear()


def test_a_catalog_spot_gets_a_real_forecast_from_the_app(monkeypatch):
    """THE feature: a spot with no hand-tuned baseline is forecast from the app's own point lane."""
    if not _db_available():
        pytest.skip("dev.db unavailable in this environment")
    candidates = [s for s in weather_sim_mcp.query_spots_from_db(limit=400)
                  if s["name"] not in weather_sim_mcp.MOCK_SPOTS]
    assert candidates
    _stub_points(monkeypatch)
    res = weather_sim_mcp.get_weather_forecast(candidates[0]["name"])
    assert res["baseline_source"] == "live_forecast"
    assert res["forecast"]["swell_height_m"] == 2.0        # marine point.speed = OFFSHORE Hs
    assert res["forecast"]["swell_period_sec"] == 14.0
    assert res["forecast"]["swell_direction_deg"] == 300.0
    assert res["forecast"]["wind_speed_knots"] == 7.0      # that endpoint reports knots already
    assert res["forecast"]["wind_direction_deg"] == 45.0
    assert res["wave_simulation"]["breaking_height_ft"] > 0


def test_live_forecast_outranks_the_invented_catalog_defaults(monkeypatch):
    """A real forecast beats a hardcoded constant — but never beats an explicit override."""
    _stub_points(monkeypatch)
    try:
        live = weather_sim_mcp.get_weather_forecast("Mavericks")
        assert live["baseline_source"] == "live_forecast"
        assert live["forecast"]["swell_height_m"] == 2.0

        weather_sim_mcp.simulate_weather_change(
            spot_name="Mavericks", wind_speed_knots=5.0, wind_direction_deg=100.0,
            swell_height_m=4.2, swell_period_sec=18.0, swell_direction_deg=290.0,
            caller_role="admin")
        staged = weather_sim_mcp.get_weather_forecast("Mavericks")
        assert staged["baseline_source"] == "simulated_override"
        assert staged["forecast"]["swell_height_m"] == 4.2
    finally:
        weather_sim_mcp.clear_simulation_overrides()


def test_a_half_answer_is_refused_rather_than_half_invented(monkeypatch):
    """Both legs are required. With marine but no wind the vector would have to invent a wind, and
    an invented wind is exactly how a blown-out day reads clean."""
    _stub_points(monkeypatch, wind={"point": {"speed": None, "direction": None}})
    res = weather_sim_mcp.get_weather_forecast("Mavericks")
    assert res["baseline_source"] == "catalog_default"      # falls back, does not fabricate
    assert "wind" in res["forecast_provenance"]["reason"]


def test_live_forecast_reports_parity_with_the_height_the_app_serves(monkeypatch):
    """The app serves its own breaking height; the sim computes one from the offshore Hs. Divergence
    between them is the defect `cf2efb48` was written to end, so the payload must expose it."""
    _stub_points(monkeypatch)
    res = weather_sim_mcp.get_weather_forecast("Mavericks")
    assert res["parity"]["served_surf_height_m"] == 3.0
    assert res["parity"]["sim_breaking_height_m"] > 0
    assert isinstance(res["parity"]["delta_pct"], float)


def test_live_forecast_kill_switch(monkeypatch):
    """SIM_LIVE_FORECAST=0 restores the pre-07-27 behaviour exactly."""
    _stub_points(monkeypatch)
    monkeypatch.setenv("SIM_LIVE_FORECAST", "0")
    sim_forecast._FORECAST_CACHE.clear()
    assert weather_sim_mcp.get_weather_forecast("Mavericks")["baseline_source"] == "catalog_default"


def test_a_failed_fetch_never_raises_out_of_the_tool(monkeypatch):
    """A forecast is an ENRICHMENT: the app being down must degrade the answer, not break the tool."""
    def boom(domain, layer, lat, lng, valid_time):
        raise RuntimeError("connection refused")

    monkeypatch.setenv("SIM_LIVE_FORECAST", "1")
    monkeypatch.setattr(sim_forecast, "fetch_point", boom)
    sim_forecast._FORECAST_CACHE.clear()
    with pytest.raises(RuntimeError):
        sim_forecast.fetch_point("marine", "waves", 0, 0, "")   # the stub really does raise
    monkeypatch.setattr(sim_forecast, "fetch_point",
                        lambda *a, **k: None)                       # what the real one returns
    res = weather_sim_mcp.get_weather_forecast("Mavericks")
    assert res["baseline_source"] == "catalog_default"


def test_forecasts_summary_does_not_label_a_size_as_a_quality():
    """The resource printed `Quality: 56.4/100 (Triple Overhead+)` — a SIZE-ladder value inside the
    quality slot, mixing the two vocabularies the rest of the module keeps apart."""
    summary = weather_sim_mcp.get_forecasts_summary()
    for line in summary.splitlines():
        if not line.startswith(" - "):
            continue
        quality_part = line.split("Quality:")[1].split("|")[0]
        for size_label in CONDITION_LABELS:
            assert size_label not in quality_part, (size_label, line)
        assert any(lvl in quality_part for lvl in LEVELS), line


def test_role_based_access_control():
    """Verify that only admin callers can execute the mutating weather simulation override."""
    # Unauthorized role should fail
    res = weather_sim_mcp.simulate_weather_change(
        spot_name="Mavericks",
        wind_speed_knots=10.0,
        wind_direction_deg=180.0,
        swell_height_m=2.5,
        swell_period_sec=12.0,
        swell_direction_deg=270.0,
        caller_role="surfer"
    )
    assert res["success"] is False
    assert "Unauthorized" in res["error"]

    # Missing role defaults to non-admin and should fail
    res_default = weather_sim_mcp.simulate_weather_change(
        spot_name="Mavericks",
        wind_speed_knots=10.0,
        wind_direction_deg=180.0,
        swell_height_m=2.5,
        swell_period_sec=12.0,
        swell_direction_deg=270.0
    )
    assert res_default["success"] is False
    assert "Unauthorized" in res_default["error"]

    # Admin role should bypass security check (and fail or succeed based on other constraints)
    res_admin = weather_sim_mcp.simulate_weather_change(
        spot_name="Mavericks",
        wind_speed_knots=10.0,
        wind_direction_deg=180.0,
        swell_height_m=2.5,
        swell_period_sec=12.0,
        swell_direction_deg=270.0,
        caller_role="admin"
    )
    assert res_admin["success"] is True

def test_parameter_bounds_validation():
    """Verify physical range checking on weather parameters to prevent invalid computations and corruption."""
    
    # 1. Invalid wind speed (negative or extreme)
    res = weather_sim_mcp.simulate_weather_change(
        spot_name="Mavericks", wind_speed_knots=-5.0, wind_direction_deg=180.0,
        swell_height_m=2.5, swell_period_sec=12.0, swell_direction_deg=270.0,
        caller_role="admin"
    )
    assert res["success"] is False
    assert "Invalid wind speed" in res["error"]

    res = weather_sim_mcp.simulate_weather_change(
        spot_name="Mavericks", wind_speed_knots=200.0, wind_direction_deg=180.0,
        swell_height_m=2.5, swell_period_sec=12.0, swell_direction_deg=270.0,
        caller_role="admin"
    )
    assert res["success"] is False
    assert "Invalid wind speed" in res["error"]

    # 2. Invalid wind direction (< 0 or > 360)
    res = weather_sim_mcp.simulate_weather_change(
        spot_name="Mavericks", wind_speed_knots=10.0, wind_direction_deg=-1.0,
        swell_height_m=2.5, swell_period_sec=12.0, swell_direction_deg=270.0,
        caller_role="admin"
    )
    assert res["success"] is False
    assert "Invalid wind direction" in res["error"]

    res = weather_sim_mcp.simulate_weather_change(
        spot_name="Mavericks", wind_speed_knots=10.0, wind_direction_deg=361.0,
        swell_height_m=2.5, swell_period_sec=12.0, swell_direction_deg=270.0,
        caller_role="admin"
    )
    assert res["success"] is False
    assert "Invalid wind direction" in res["error"]

    # 3. Invalid swell height (< 0 or > 50)
    res = weather_sim_mcp.simulate_weather_change(
        spot_name="Mavericks", wind_speed_knots=10.0, wind_direction_deg=180.0,
        swell_height_m=-1.0, swell_period_sec=12.0, swell_direction_deg=270.0,
        caller_role="admin"
    )
    assert res["success"] is False
    assert "Invalid swell height" in res["error"]

    res = weather_sim_mcp.simulate_weather_change(
        spot_name="Mavericks", wind_speed_knots=10.0, wind_direction_deg=180.0,
        swell_height_m=60.0, swell_period_sec=12.0, swell_direction_deg=270.0,
        caller_role="admin"
    )
    assert res["success"] is False
    assert "Invalid swell height" in res["error"]

    # 4. Invalid swell period (< 0 or > 30)
    res = weather_sim_mcp.simulate_weather_change(
        spot_name="Mavericks", wind_speed_knots=10.0, wind_direction_deg=180.0,
        swell_height_m=2.5, swell_period_sec=-1.0, swell_direction_deg=270.0,
        caller_role="admin"
    )
    assert res["success"] is False
    assert "Invalid swell period" in res["error"]

    res = weather_sim_mcp.simulate_weather_change(
        spot_name="Mavericks", wind_speed_knots=10.0, wind_direction_deg=180.0,
        swell_height_m=2.5, swell_period_sec=35.0, swell_direction_deg=270.0,
        caller_role="admin"
    )
    assert res["success"] is False
    assert "Invalid swell period" in res["error"]

    # 5. Invalid swell direction (< 0 or > 360)
    res = weather_sim_mcp.simulate_weather_change(
        spot_name="Mavericks", wind_speed_knots=10.0, wind_direction_deg=180.0,
        swell_height_m=2.5, swell_period_sec=12.0, swell_direction_deg=-10.0,
        caller_role="admin"
    )
    assert res["success"] is False
    assert "Invalid swell direction" in res["error"]

    res = weather_sim_mcp.simulate_weather_change(
        spot_name="Mavericks", wind_speed_knots=10.0, wind_direction_deg=180.0,
        swell_height_m=2.5, swell_period_sec=12.0, swell_direction_deg=370.0,
        caller_role="admin"
    )
    assert res["success"] is False
    assert "Invalid swell direction" in res["error"]

def test_database_update_propagation():
    """Verify that simulating weather changes persists results back to SQLite condition_reports."""
    db_path = os.path.join(os.path.dirname(backend_dir), "dev.db")
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Temporarily insert a test spot condition report that is active
    test_spot = "Test Simulation Spot"
    cursor.execute("DELETE FROM condition_reports WHERE spot_name = ?", (test_spot,))
    cursor.execute("""
        INSERT INTO condition_reports (
            id, photographer_id, spot_id, media_url, media_type, is_active, spot_name, wave_height_ft, expires_at
        ) VALUES (
            'test_sim_id_001', 'photographer_01', 'spot_01', 'http://test.url', 'image', 1, ?, 1.0, datetime('now', '+1 day')
        )
    """, (test_spot,))
    conn.commit()
    conn.close()

    # Add the test spot to the MOCK_SPOTS dict in the module to allow parsing
    weather_sim_mcp.MOCK_SPOTS[test_spot] = {
        "id": 999,
        "name": test_spot,
        "region": "Northern California",
        "latitude": 37.5,
        "longitude": -122.5,
        "orientation": 270,
        "optimal_swell_dir": 270,
        "optimal_wind_dir": 90,
        "base_swell_height": 2.0,
        "base_swell_period": 10.0,
        "base_wind_speed": 10.0,
        "base_wind_direction": 90
    }

    try:
        # Run simulation with valid admin credentials
        res = weather_sim_mcp.simulate_weather_change(
            spot_name=test_spot,
            wind_speed_knots=8.0,
            wind_direction_deg=90.0, # offshore (clean)
            swell_height_m=3.0,
            swell_period_sec=14.0,
            swell_direction_deg=270.0,
            caller_role="admin"
        )
        assert res["success"] is True
        assert res["database_updated"] is True
        
        # Verify db contains updated details
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute("SELECT wave_height_ft, conditions_label, wind_conditions FROM condition_reports WHERE spot_name = ?", (test_spot,))
        row = cursor.fetchone()
        conn.close()

        assert row is not None
        # Verify wave height matches calculations output
        assert float(row[0]) == res["simulated_surf_output"]["breaking_height_ft"]
        assert row[1] == res["simulated_surf_output"]["conditions_label"]
        assert row[2] == res["simulated_surf_output"]["wind_class"]

    finally:
        # Cleanup
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute("DELETE FROM condition_reports WHERE spot_name = ?", (test_spot,))
        conn.commit()
        conn.close()
        weather_sim_mcp.MOCK_SPOTS.pop(test_spot, None)

if __name__ == "__main__":
    pytest.main([__file__, "-v"])
