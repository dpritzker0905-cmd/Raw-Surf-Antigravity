"""
Test suite for google_maps_mcp_server.py
Verifies geospatial search, routing calculations, parking lookups, reverse geocoding, and JSON-RPC stdio protocol.
"""
import os
import sys
import json
import sqlite3
import pytest
from io import StringIO

# Add backend directory to sys.path to allow importing from google_maps_mcp_server
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

import google_maps_mcp_server

# Initialize database once before running tests
google_maps_mcp_server.init_db()

def test_haversine_distance():
    # Malibu Pier to Zuma Beach (approx 11.4 km)
    dist = google_maps_mcp_server.haversine_distance(34.0381, -118.6923, 34.0220, -118.8150)
    assert 10.0 <= dist <= 15.0
    print(f"✓ Geospatial Haversine calculation: {dist:.2f} km")

def test_nearby_surf_spots():
    # Malibu Coordinates
    spots = google_maps_mcp_server.get_nearby_spots(34.0381, -118.6923, radius_km=10.0)
    assert len(spots) >= 1
    assert spots[0]["name"] == "Malibu Surfrider Beach"
    assert "distance_km" in spots[0]
    assert "forecast" in spots[0]
    print(f"✓ Spot lookup returned {len(spots)} spots within radius")

def test_nearby_instructors():
    # Malibu Coordinates
    coaches = google_maps_mcp_server.get_nearby_instructors(34.0381, -118.6923, radius_km=15.0)
    assert len(coaches) >= 2
    names = [c["instructor_name"] for c in coaches]
    assert "Kai Surf-Master" in names
    assert "Alana Coast-Coach" in names
    print(f"✓ Instructor search returned {len(coaches)} active local coaches")

def test_calculate_travel_time():
    # Malibu Surfrider Beach to Rincon Point (approx 82 km)
    travel_driving = google_maps_mcp_server.calc_travel_time(34.0381, -118.6923, 34.3725, -119.4772, mode="driving")
    assert travel_driving["distance_km"] > 75.0
    assert travel_driving["duration_minutes"] > 60
    assert travel_driving["travel_mode"] == "DRIVING"
    
    travel_walking = google_maps_mcp_server.calc_travel_time(34.0381, -118.6923, 34.0355, -118.6850, mode="walking")
    assert travel_walking["travel_mode"] == "WALKING"
    assert travel_walking["duration_minutes"] > 0
    print(f"✓ Routing calculations compile: {travel_driving['formatted_summary']}")

def test_parking_lookup():
    # Exact spot name lookup
    parking_info = google_maps_mcp_server.get_parking_lookup("Malibu Surfrider Beach")
    assert len(parking_info["parking_options"]) >= 2
    assert parking_info["associated_surf_spot"] == "Malibu Surfrider Beach"
    
    # Coordinate lookup fallback
    coord_parking = google_maps_mcp_server.get_parking_lookup(None, 34.0381, -118.6923)
    assert len(coord_parking["parking_options"]) >= 2
    assert coord_parking["associated_surf_spot"] == "Malibu Surfrider Beach"
    print(f"✓ Parking lookup mapped {len(parking_info['parking_options'])} options near Malibu")

def test_reverse_geocode():
    # Malibu Coordinates
    res = google_maps_mcp_server.get_reverse_geocode(34.0381, -118.6923)
    assert "Malibu" in res["formatted_address"]
    assert "proximity_description" in res
    print(f"✓ Reverse geocoding resolved address: {res['formatted_address']}")

def test_weather_overlay():
    res = google_maps_mcp_server.get_weather_overlay(34.0381, -118.6923)
    assert "wind" in res["overlay_layers"]
    assert "swell" in res["overlay_layers"]
    assert "temperature" in res["overlay_layers"]
    assert res["maplibre_gl_compatibility"]["source_type"] == "geojson"
    print("✓ Weather NOAA overlay layer data structure maps correctly to MapLibre GL")

def test_json_rpc_initialize():
    # Simulate a JSON-RPC stdio initialization call
    input_str = json.dumps({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {}
    }) + "\n"
    
    # Capture standard streams
    old_stdin = sys.stdin
    old_stdout = sys.stdout
    sys.stdin = StringIO(input_str)
    sys.stdout = StringIO()
    
    try:
        google_maps_mcp_server.main()
        output_str = sys.stdout.getvalue()
    finally:
        sys.stdin = old_stdin
        sys.stdout = old_stdout
        
    response = json.loads(output_str.strip())
    assert response["jsonrpc"] == "2.0"
    assert response["id"] == 1
    assert "capabilities" in response["result"]
    assert response["result"]["serverInfo"]["name"] == "google-maps-mcp"
    print("✓ JSON-RPC Google Maps Initialize method returns correct protocol metadata")

if __name__ == "__main__":
    pytest.main([__file__, "-v"])
