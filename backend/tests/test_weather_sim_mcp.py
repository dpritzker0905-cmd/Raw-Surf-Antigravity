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
from services.conditions_labels import CONDITION_LABELS, get_conditions_label
from services.weather_pipeline.surf_rating import LEVELS

MAVS = weather_sim_mcp.MOCK_SPOTS["Mavericks"]


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


def test_rating_is_relative_to_the_spot():
    """THE Surfline principle: the same wave is a small day at a big-wave spot and a good day at a
    beach break. Guards the per-spot reference_size_m wiring — with it dropped, every spot shares
    the global 1.2 m curve and these three scores collapse to the same value."""
    args = (1.0, 13.0, 275.0, 5.0, 90.0)   # identical swell + wind at all three spots
    mavs = weather_sim_mcp.calculate_surf_rating(weather_sim_mcp.MOCK_SPOTS["Mavericks"], *args)
    paci = weather_sim_mcp.calculate_surf_rating(weather_sim_mcp.MOCK_SPOTS["Pacifica State Beach"], *args)
    # same breaking height, materially different quality
    assert mavs["breaking_height_ft"] == paci["breaking_height_ft"]
    assert mavs["quality_rating"] < paci["quality_rating"], (mavs, paci)
    assert LEVELS.index(mavs["quality_label"]) < LEVELS.index(paci["quality_label"])


def test_breaking_height_uses_the_production_transform():
    """Height must come from surf_transform.komar_breaker_height, not a local approximation."""
    from services.weather_pipeline.surf_transform import komar_breaker_height
    for h, tp in ((0.5, 8.0), (1.2, 14.0), (3.0, 18.0)):
        out = weather_sim_mcp.calculate_surf_rating(MAVS, h, tp, 290.0, 5.0, 95.0)
        assert out["breaking_height_ft"] == round(komar_breaker_height(h, tp) * 3.28084, 1)


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
