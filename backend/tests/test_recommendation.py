"""
Test suite for recommendation_mcp_server.py
Verifies multi-factor matching, vector similarity heuristics, and JSON-RPC stdio protocol.
"""
import os
import sys
import json
import sqlite3
import pytest
from io import StringIO

# Add backend directory to sys.path to allow importing from recommendation_mcp_server
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

import recommendation_mcp_server

def test_haversine_distance():
    # Malibu (34.0381, -118.6923) to Rincon (34.3725, -119.4772)
    dist = recommendation_mcp_server.haversine_distance(34.0381, -118.6923, 34.3725, -119.4772)
    # Distance should be around 82 km
    assert 78.0 <= dist <= 86.0
    print(f"✓ Haversine distance calculated: {dist:.2f} km")

def test_cosine_similarity():
    v1 = [1.0, 0.0, 1.0, 0.0]
    v2 = [1.0, 0.0, 1.0, 0.0]
    sim1 = recommendation_mcp_server.cosine_similarity(v1, v2)
    assert pytest.approx(sim1) == 1.0
    
    v3 = [0.0, 1.0, 0.0, 1.0]
    sim2 = recommendation_mcp_server.cosine_similarity(v1, v3)
    assert pytest.approx(sim2) == 0.0
    
    print("✓ Cosine similarity functions perfectly")

def test_generate_mock_embedding():
    emb = recommendation_mcp_server.generate_mock_embedding("retro fish twin fin")
    assert len(emb) == 384
    # L2 normalized vector should have length 1.0 (or close to it due to float precision)
    magnitude = sum(x*x for x in emb)
    assert pytest.approx(magnitude) == 1.0
    print("✓ Deterministic mock embedding generator operates as expected")

def test_recommend_spots():
    # Setup test spots list
    spots = [
        {
            "name": "Malibu",
            "region": "SoCal",
            "latitude": 34.0381,
            "longitude": -118.6923,
            "difficulty": "beginner",
            "best_swell": "S",
            "best_tide": "Rising"
        },
        {
            "name": "Rincon",
            "region": "Santa Barbara",
            "latitude": 34.3725,
            "longitude": -119.4772,
            "difficulty": "advanced",
            "best_swell": "WNW",
            "best_tide": "Low"
        },
        {
            "name": "Huntington Beach",
            "region": "Orange County",
            "latitude": 33.6595,
            "longitude": -117.9988,
            "difficulty": "intermediate",
            "best_swell": "SW",
            "best_tide": "Rising"
        }
    ]
    
    # 1. Beginner Surfer in Santa Monica (34.0194, -118.4912)
    recs_beg = recommendation_mcp_server.recommend_spots(
        user_skill="beginner",
        user_lat=34.0194,
        user_lon=-118.4912,
        spots_list=spots,
        current_swell="S",
        current_tide="Rising"
    )
    
    assert len(recs_beg) == 3
    # Malibu should be the top match because:
    # - Malibu difficulty is beginner (+20.0 bonus)
    # - Distance is short (~19 km)
    # - Current swell matches "S" (+15.0 bonus)
    # - Current tide matches "Rising" (+10.0 bonus)
    # Rincon should have a massive penalty (-60.0 points) because it's advanced.
    assert recs_beg[0]["name"] == "Malibu"
    assert recs_beg[-1]["name"] == "Rincon"
    assert recs_beg[-1]["match_score"] < 40.0
    
    # 2. Advanced Surfer close to Rincon (34.35, -119.45)
    recs_adv = recommendation_mcp_server.recommend_spots(
        user_skill="advanced",
        user_lat=34.35,
        user_lon=-119.45,
        spots_list=spots,
        current_swell="WNW",
        current_tide="Low"
    )
    # Rincon should rank top
    assert recs_adv[0]["name"] == "Rincon"
    
    print("✓ Spot recommendations match correct skill sets and swell profiles")

def test_recommend_equipment():
    boards = [
        {
            "model": "High-Volume Softboard",
            "shaper": "Raw Surf Custom",
            "volume": 52.0,
            "price": 350.0,
            "description": "Thick, high-volume soft foam board designed for learning to stand up and catching small waves."
        },
        {
            "model": "Al Merrick Twin Fin Fish",
            "shaper": "Channel Islands",
            "volume": 31.5,
            "price": 850.0,
            "description": "Retro swallow tail twin fin surfboard perfect for speed and cruising on small to medium point breaks."
        },
        {
            "model": "Performance Thruster",
            "shaper": "Lost Surfboards",
            "volume": 28.0,
            "price": 799.0,
            "description": "Aggressive outline thruster with triple fins for advanced surfers looking for deep carves and vertical turns."
        }
    ]
    
    # 1. Beginner surfer asking for learning board
    recs_beg = recommendation_mcp_server.recommend_equipment(
        user_preferences="foam learning softboard",
        user_skill="beginner",
        boards_list=boards
    )
    # "High-Volume Softboard" should be the top match
    assert recs_beg[0]["model"] == "High-Volume Softboard"
    
    # 2. Advanced surfer asking for twin fin point break board
    recs_adv = recommendation_mcp_server.recommend_equipment(
        user_preferences="retro swallow tail twin fin point break",
        user_skill="advanced",
        boards_list=boards
    )
    # "Al Merrick Twin Fin Fish" should be the top match
    assert recs_adv[0]["model"] == "Al Merrick Twin Fin Fish"
    
    print("✓ Equipment recommendations successfully perform vector similarity matching")

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
        # Run one loop iteration by mock-breaking main
        # To prevent endless loop, we feed EOF after first line (which StringIO does automatically)
        recommendation_mcp_server.main()
        output_str = sys.stdout.getvalue()
    finally:
        sys.stdin = old_stdin
        sys.stdout = old_stdout
        
    response = json.loads(output_str.strip())
    assert response["jsonrpc"] == "2.0"
    assert response["id"] == 1
    assert "capabilities" in response["result"]
    assert response["result"]["serverInfo"]["name"] == "recommendation-engine-mcp"
    print("✓ JSON-RPC Initialize method returns correct protocol metadata")

if __name__ == "__main__":
    pytest.main([__file__, "-v"])
