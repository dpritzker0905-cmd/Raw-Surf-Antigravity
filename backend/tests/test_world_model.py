"""
Test suite for world_model_mcp_server.py
Verifies weather/ocean ingestion, derived quality scoring, photography windows, business cancellation loops, MapLibre layers GeoJSON, and JSON-RPC stdio.
"""
import os
import sys
import json
import sqlite3
import pytest
from io import StringIO

# Add backend directory to sys.path to allow importing from world_model_mcp_server
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

import world_model_mcp_server

# Initialize database
world_model_mcp_server.init_db()

def seed_test_db():
    conn = sqlite3.connect(world_model_mcp_server.DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    
    # Pure clean sweep for test idempotency
    cursor.execute("DELETE FROM weather_ocean_data")
    cursor.execute("DELETE FROM business_correlation_logs")
    
    conn.commit()
    conn.close()

def test_ingest_weather_ocean_data():
    seed_test_db()
    
    # Ingest prime offshore Malibu conditions
    res1 = world_model_mcp_server.ingest_weather_ocean_data(
        spot_name="Malibu",
        swell_height_ft=5.5,
        swell_period_sec=14,
        swell_direction="S",
        wind_speed_mph=8.0,
        wind_direction="Light Offshore",
        tide_cycle="rising",
        latitude=34.0381,
        longitude=-118.6923
    )
    assert res1["success"] is True
    assert res1["derived_insights"]["surf_quality_score"] == 100.0  # Perfect combination!
    assert res1["derived_insights"]["crowd_probability_index"] == "high"
    assert res1["derived_insights"]["suitability_level"] == "intermediate"
    
    # Check that business correlation was logged
    assert res1["business_correlation"]["bookings_simulated"] >= 20
    assert res1["business_correlation"]["cancellations_simulated"] == 0
    
    # Ingest poor onshore Huntington conditions
    res2 = world_model_mcp_server.ingest_weather_ocean_data(
        spot_name="Huntington Beach",
        swell_height_ft=1.5,
        swell_period_sec=8,
        swell_direction="SW",
        wind_speed_mph=18.0,
        wind_direction="Heavy Onshore",
        tide_cycle="falling",
        latitude=33.6595,
        longitude=-117.9988
    )
    assert res2["success"] is True
    assert res2["derived_insights"]["surf_quality_score"] <= 20.0
    assert res2["derived_insights"]["crowd_probability_index"] == "low"
    assert res2["business_correlation"]["cancellations_simulated"] >= 5
    
    print("✓ Successfully verified weather parameters ingestion and business correlations")

def test_get_surf_spot_insights_scoring():
    seed_test_db()
    
    # Ingest Malibu
    world_model_mcp_server.ingest_weather_ocean_data("Malibu", 5.5, 14, "S", 8.0, "Light Offshore", "rising", 34.0381, -118.6923)
    
    # Check insights for beginner surfer (should return warning)
    insights = world_model_mcp_server.get_surf_spot_insights("Malibu", "beginner")
    assert insights["spot_name"] == "Malibu"
    assert insights["derived_insights"]["ideal_skill_level"] == "INTERMEDIATE"
    assert insights["derived_insights"]["skill_compatibility"]["is_compatible"] is True # Compatible but warning
    
    print("✓ Successfully calculated derived surf scores and crowd indexes")

def test_get_best_surf_spots_24h():
    seed_test_db()
    
    # Seed multiple spots
    world_model_mcp_server.ingest_weather_ocean_data("Malibu", 5.5, 14, "S", 8.0, "Light Offshore", "rising", 34.0381, -118.6923)
    world_model_mcp_server.ingest_weather_ocean_data("Huntington Beach", 1.5, 8, "SW", 18.0, "Heavy Onshore", "falling", 33.6595, -117.9988)
    
    recs = world_model_mcp_server.get_best_surf_spots_24h("intermediate")
    assert len(recs) == 2
    assert recs[0]["spot_name"] == "Malibu"
    assert recs[0]["surf_quality_score"] == 100.0
    
    print("✓ Spot recommendation insights sorted correctly over the next 24 hours")

def test_get_optimal_photography_windows():
    seed_test_db()
    
    # Seed Malibu with offshore wind
    world_model_mcp_server.ingest_weather_ocean_data("Malibu", 5.5, 14, "S", 8.0, "Light Offshore", "rising", 34.0381, -118.6923)
    
    photos = world_model_mcp_server.get_optimal_photography_windows("Malibu")
    assert photos["wave_quality_score"] == 100.0
    assert len(photos["photography_suitability_windows"]) == 2
    assert photos["photography_suitability_windows"][0]["suitability"] == "PRIME"
    assert "golden morning lighting" in photos["photography_suitability_windows"][0]["reason"]
    
    print("✓ Identified optimal golden hour photography timing windows")

def test_generate_maplibre_weather_geojson():
    seed_test_db()
    
    # Seed multiple spots
    world_model_mcp_server.ingest_weather_ocean_data("Malibu", 5.5, 14, "S", 8.0, "Light Offshore", "rising", 34.0381, -118.6923)
    world_model_mcp_server.ingest_weather_ocean_data("Huntington Beach", 1.5, 8, "SW", 18.0, "Heavy Onshore", "falling", 33.6595, -117.9988)
    
    geojson = world_model_mcp_server.generate_maplibre_weather_geojson()
    assert geojson["type"] == "FeatureCollection"
    assert len(geojson["features"]) == 2
    
    feat = geojson["features"][0]
    assert feat["type"] == "Feature"
    assert feat["geometry"]["type"] == "Point"
    assert len(feat["geometry"]["coordinates"]) == 2
    assert feat["properties"]["spot_name"] == "Malibu"
    assert feat["properties"]["marker_color"] == "#FF4500" # Orange-red for prime quality
    
    print("✓ Generated and formatted clean MapLibre GeoJSON weather overlays")

def test_json_rpc_initialize():
    # Simulate a JSON-RPC stdio initialization call
    input_str = json.dumps({
        "jsonrpc": "2.0",
        "id": 101,
        "method": "initialize",
        "params": {}
    }) + "\n"
    
    old_stdin = sys.stdin
    old_stdout = sys.stdout
    sys.stdin = StringIO(input_str)
    sys.stdout = StringIO()
    
    try:
        world_model_mcp_server.main()
        output_str = sys.stdout.getvalue()
    finally:
        sys.stdin = old_stdin
        sys.stdout = old_stdout
        
    response = json.loads(output_str.strip())
    assert response["jsonrpc"] == "2.0"
    assert response["id"] == 101
    assert "capabilities" in response["result"]
    assert response["result"]["serverInfo"]["name"] == "world-model-mcp"
    print("✓ JSON-RPC world-model-mcp Initialize returned correctly")

if __name__ == "__main__":
    pytest.main([__file__, "-v"])
