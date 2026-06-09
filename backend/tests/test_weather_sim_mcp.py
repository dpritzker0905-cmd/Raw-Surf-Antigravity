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
    conn = sqlite3.connect("c:/Users/dprit/Raw-Surf/dev.db")
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
        conn = sqlite3.connect("c:/Users/dprit/Raw-Surf/dev.db")
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
        conn = sqlite3.connect("c:/Users/dprit/Raw-Surf/dev.db")
        cursor = conn.cursor()
        cursor.execute("DELETE FROM condition_reports WHERE spot_name = ?", (test_spot,))
        conn.commit()
        conn.close()
        weather_sim_mcp.MOCK_SPOTS.pop(test_spot, None)

if __name__ == "__main__":
    pytest.main([__file__, "-v"])
