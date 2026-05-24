"""
Test suite for semantic_memory_mcp_server.py
Verifies memory indexing, privacy-safe partitioning, time-based exponential decay, preference aggregation, booking predictions, and JSON-RPC.
"""
import os
import sys
import json
import sqlite3
import pytest
from datetime import datetime, timezone, timedelta
from io import StringIO

# Add backend directory to sys.path to allow importing from semantic_memory_mcp_server
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

import semantic_memory_mcp_server

# Initialize database
semantic_memory_mcp_server.init_db()

def seed_test_db():
    conn = sqlite3.connect(semantic_memory_mcp_server.DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    cursor.execute("DELETE FROM semantic_memory")
    conn.commit()
    conn.close()

def test_store_memory_indexing():
    seed_test_db()
    
    # Store a surf history memory
    res = semantic_memory_mcp_server.store_memory(
        user_id="user_surf_101",
        memory_type="surf_history",
        content="Epic morning session at Malibu, clean 5ft glassy peaks with offshore winds.",
        metadata={"spot_name": "Malibu", "rating": 5.0, "swell_height_ft": 5.0}
    )
    assert res["success"] is True
    assert res["user_id"] == "user_surf_101"
    assert res["type"] == "surf_history"
    assert "memory_id" in res
    assert "timestamp" in res
    
    # Verify in DB
    conn = sqlite3.connect(semantic_memory_mcp_server.DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT content, type FROM semantic_memory WHERE user_id = 'user_surf_101'")
    row = cursor.fetchone()
    conn.close()
    assert row is not None
    assert "Malibu" in row[0]
    assert row[1] == "surf_history"
    
    print("✓ Successfully verified store_memory indexing and DB storage")

def test_retrieve_similar_memories_privacy_partition():
    seed_test_db()
    
    # User A stores a memory
    semantic_memory_mcp_server.store_memory(
        user_id="user_A",
        memory_type="surf_history",
        content="Awesome surf session at Huntington Beach",
        metadata={"spot_name": "Huntington Beach"}
    )
    
    # User B stores a memory
    semantic_memory_mcp_server.store_memory(
        user_id="user_B",
        memory_type="surf_history",
        content="Cruising retro fish at Malibu point break",
        metadata={"spot_name": "Malibu"}
    )
    
    # User A retrieves (should only see Huntington Beach, NOT User B's Malibu)
    res_A = semantic_memory_mcp_server.retrieve_similar_memories(
        user_id="user_A",
        query="surf session",
        limit=5
    )
    assert len(res_A) == 1
    assert res_A[0]["metadata"]["spot_name"] == "Huntington Beach"
    
    # User B retrieves (should only see Malibu, NOT User A's Huntington Beach)
    res_B = semantic_memory_mcp_server.retrieve_similar_memories(
        user_id="user_B",
        query="surf session",
        limit=5
    )
    assert len(res_B) == 1
    assert res_B[0]["metadata"]["spot_name"] == "Malibu"
    
    print("✓ Privacy-safe surfer partitioning successfully verified")

def test_time_based_decay():
    seed_test_db()
    
    now_utc = datetime.now(timezone.utc)
    
    # Store old memory (30 days ago) with identical content
    old_time = (now_utc - timedelta(days=30)).isoformat().replace("+00:00", "Z")
    semantic_memory_mcp_server.store_memory(
        user_id="user_decay_test",
        memory_type="surf_history",
        content="Epic Malibu surf session",
        metadata={"session_id": "old_sess"},
        created_at=old_time
    )
    
    # Store recent memory (today) with identical content
    recent_time = now_utc.isoformat().replace("+00:00", "Z")
    semantic_memory_mcp_server.store_memory(
        user_id="user_decay_test",
        memory_type="surf_history",
        content="Epic Malibu surf session",
        metadata={"session_id": "new_sess"},
        created_at=recent_time
    )
    
    # Retrieve similar memories (recent should have higher decayed score than old)
    res = semantic_memory_mcp_server.retrieve_similar_memories(
        user_id="user_decay_test",
        query="Malibu surf",
        limit=5,
        decay_lambda=0.05
    )
    
    assert len(res) == 2
    assert res[0]["metadata"]["session_id"] == "new_sess"
    assert res[1]["metadata"]["session_id"] == "old_sess"
    assert res[0]["decayed_score"] > res[1]["decayed_score"]
    
    # Decay weight check
    assert res[0]["decay_weight"] > 0.99
    assert res[1]["decay_weight"] < 0.25 # exp(-0.05 * 30) = exp(-1.5) approx 0.223
    
    print("✓ Time-based exponential decay weighting calculated correctly")

def test_get_user_preferred_conditions():
    seed_test_db()
    
    # Store high-rated surf sessions (ratings 5.0 and 4.5)
    semantic_memory_mcp_server.store_memory(
        user_id="surfer_12",
        memory_type="surf_history",
        content="Rincon swell was firing, 6ft sets, WNW swell, Rising tide was perfect.",
        metadata={"spot_name": "Rincon", "rating": 5.0, "swell_height_ft": 6.0, "swell_direction": "WNW", "tide_cycle": "Rising"}
    )
    
    semantic_memory_mcp_server.store_memory(
        user_id="surfer_12",
        memory_type="surf_history",
        content="Malibu glassy morning waves, 4ft, Rising tide.",
        metadata={"spot_name": "Rincon", "rating": 4.5, "swell_height_ft": 4.0, "swell_direction": "WNW", "tide_cycle": "Rising"}
    )
    
    # Store poor rated session (should be excluded from preferred conditions)
    semantic_memory_mcp_server.store_memory(
        user_id="surfer_12",
        memory_type="surf_history",
        content="Choppy onshore Huntington beach session",
        metadata={"spot_name": "Huntington Beach", "rating": 2.0, "swell_height_ft": 2.0, "swell_direction": "SW", "tide_cycle": "Falling"}
    )
    
    pref = semantic_memory_mcp_server.get_user_preferred_conditions("surfer_12")
    assert pref["preferred_spot"] == "Rincon"
    assert pref["preferred_swell_direction"] == "WNW"
    assert pref["preferred_tide"] == "Rising"
    # Weighted average swell height between 6.0 and 4.0 should be around 5.0
    assert 4.5 <= pref["preferred_swell_height_ft"] <= 5.5
    assert pref["status"] == "profile_computed"
    
    print("✓ Surfer preference profile successfully aggregated from semantic memories")

def test_predict_repeat_booking():
    seed_test_db()
    
    # User has booked Malibu 3 times and reviewed it as awesome
    semantic_memory_mcp_server.store_memory(
        user_id="surfer_repeat",
        memory_type="booking_history",
        content="Booked session at Malibu",
        metadata={"spot_name": "Malibu", "rating": 5.0}
    )
    semantic_memory_mcp_server.store_memory(
        user_id="surfer_repeat",
        memory_type="booking_history",
        content="Booked second session at Malibu",
        metadata={"spot_name": "Malibu", "rating": 5.0}
    )
    semantic_memory_mcp_server.store_memory(
        user_id="surfer_repeat",
        memory_type="feedback",
        content="Malibu is my absolute favorite spot. Highly repeat!",
        metadata={"spot_name": "Malibu", "rating": 5.0}
    )
    
    prediction = semantic_memory_mcp_server.predict_repeat_booking("surfer_repeat", "Malibu")
    assert prediction["repeat_probability_percentage"] >= 80.0
    assert prediction["total_past_bookings_at_spot"] == 3
    assert "sentiment" in prediction["rationale"]
    
    print("✓ Repeat booking predictions formulated with correct semantic justifications")

def test_json_rpc_initialize():
    # Simulate a JSON-RPC stdio initialization call
    input_str = json.dumps({
        "jsonrpc": "2.0",
        "id": 301,
        "method": "initialize",
        "params": {}
    }) + "\n"
    
    old_stdin = sys.stdin
    old_stdout = sys.stdout
    sys.stdin = StringIO(input_str)
    sys.stdout = StringIO()
    
    try:
        semantic_memory_mcp_server.main()
        output_str = sys.stdout.getvalue()
    finally:
        sys.stdin = old_stdin
        sys.stdout = old_stdout
        
    response = json.loads(output_str.strip())
    assert response["jsonrpc"] == "2.0"
    assert response["id"] == 301
    assert "capabilities" in response["result"]
    assert response["result"]["serverInfo"]["name"] == "semantic-memory-mcp"
    print("✓ JSON-RPC semantic-memory-mcp Initialize returned correctly")

if __name__ == "__main__":
    pytest.main([__file__, "-v"])
