"""
Test suite for qa_agent_mcp_server.py
Verifies user journey simulations, business-impact bug severity sorting, healthy session baseline comparisons, and JSON-RPC stdio.
"""
import os
import sys
import json
import sqlite3
import pytest
from io import StringIO

# Add backend directory to sys.path to allow importing from qa_agent_mcp_server
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

import qa_agent_mcp_server

# Initialize database
qa_agent_mcp_server.init_db()

def seed_test_db():
    conn = sqlite3.connect(qa_agent_mcp_server.DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    
    # Pure clean sweep for test idempotency
    cursor.execute("DELETE FROM qa_sessions")
    cursor.execute("DELETE FROM qa_bug_reports")
    
    conn.commit()
    conn.close()

def test_simulate_booking_lesson_success():
    seed_test_db()
    
    # Simulate completely healthy booking session
    res1 = qa_agent_mcp_server.simulate_user_journey("booking_lesson")
    assert res1["status"] == "success"
    assert res1["performance"]["js_errors"] == 0
    assert res1["performance"]["layout_status"] == "healthy"
    
    # Simulate failed booking session (throws JS exceptions)
    res2 = qa_agent_mcp_server.simulate_user_journey(
        journey_type="booking_lesson",
        simulated_issues={
            "js_errors_count": 3,
            "force_failure": True
        }
    )
    assert res2["status"] == "failure"
    assert res2["performance"]["js_errors"] == 3
    
    # Check that database structured bug reports contains one high severity entry
    bugs = qa_agent_mcp_server.get_recent_bug_reports(min_severity="high")
    assert len(bugs) == 1
    assert bugs[0]["severity"] == "HIGH"
    assert bugs[0]["impact_category"] == "bookings"
    assert "Critical failure" in bugs[0]["description"]
    assert bugs[0]["screenshot_path"].startswith("C:\\Users\\dprit\\Raw-Surf\\.screenshots\\bug_booking")
    
    print("✓ Successfully verified simulated lesson bookings and critical flow tracking")

def test_simulate_map_browsing_slow_fps():
    seed_test_db()
    
    # Simulate slow Map viewport rendering
    res = qa_agent_mcp_server.simulate_user_journey(
        journey_type="map_browsing",
        simulated_issues={
            "rendering_speed": "slow",
            "duration_ms": 1420.0
        }
    )
    assert res["status"] == "success" # Latency doesn't crash the UI, so status is success
    assert res["performance"]["rendering_speed"] == "slow"
    
    # Verify medium severity bug report was logged for map rendering
    bugs = qa_agent_mcp_server.get_recent_bug_reports(min_severity="medium")
    assert len(bugs) == 1
    assert bugs[0]["severity"] == "MEDIUM"
    assert bugs[0]["impact_category"] == "map_rendering"
    assert "Map rendering bottleneck" in bugs[0]["description"]
    assert "bug_map" in bugs[0]["screenshot_path"]
    
    print("✓ Successfully caught viewport rendering frame rate degradations")

def test_get_recent_bug_reports_priority():
    seed_test_db()
    
    # Seed multiple bugs of varying severity:
    # 1. Booking Failure -> HIGH Severity
    # 2. Map Slow -> MEDIUM Severity
    # 3. Marketplace cosmetic -> LOW Severity
    qa_agent_mcp_server.simulate_user_journey("marketplace_listing", {"layout_status": "broken"})
    qa_agent_mcp_server.simulate_user_journey("map_browsing", {"rendering_speed": "slow"})
    qa_agent_mcp_server.simulate_user_journey("booking_lesson", {"js_errors_count": 2})
    
    # Verify sorting orders HIGH first, then MEDIUM, then LOW
    bugs = qa_agent_mcp_server.get_recent_bug_reports()
    assert len(bugs) == 3
    assert bugs[0]["severity"] == "HIGH"
    assert bugs[1]["severity"] == "MEDIUM"
    assert bugs[2]["severity"] == "LOW"
    
    print("✓ Priority matrix sorts issues perfectly by business impact severity")

def test_get_system_health_baseline():
    seed_test_db()
    
    # 1. Seed 9 successes and 1 failure (90% success rate -> Degraded compared to 95% baseline)
    for _ in range(9):
        qa_agent_mcp_server.simulate_user_journey("booking_lesson")
    qa_agent_mcp_server.simulate_user_journey("booking_lesson", {"force_failure": True})
    
    health = qa_agent_mcp_server.get_system_health_baseline()
    assert health["total_simulated_sessions"] == 10
    assert health["session_success_rate"] == 90.00
    assert health["system_status"] == "Degraded - Action Required"
    
    # 2. Seed more successes to raise health back above 95%
    for _ in range(20):
        qa_agent_mcp_server.simulate_user_journey("booking_lesson")
        
    health2 = qa_agent_mcp_server.get_system_health_baseline()
    assert health2["session_success_rate"] >= 95.00
    assert health2["system_status"] == "Optimal System Health"
    
    print("✓ Successfully compared simulated conversions against baseline benchmarks")

def test_json_rpc_initialize():
    # Simulate a JSON-RPC stdio initialization call
    input_str = json.dumps({
        "jsonrpc": "2.0",
        "id": 99,
        "method": "initialize",
        "params": {}
    }) + "\n"
    
    old_stdin = sys.stdin
    old_stdout = sys.stdout
    sys.stdin = StringIO(input_str)
    sys.stdout = StringIO()
    
    try:
        qa_agent_mcp_server.main()
        output_str = sys.stdout.getvalue()
    finally:
        sys.stdin = old_stdin
        sys.stdout = old_stdout
        
    response = json.loads(output_str.strip())
    assert response["jsonrpc"] == "2.0"
    assert response["id"] == 99
    assert "capabilities" in response["result"]
    assert response["result"]["serverInfo"]["name"] == "autonomous-qa-agent-mcp"
    print("✓ JSON-RPC autonomous-qa-agent-mcp Initialize returned correctly")

if __name__ == "__main__":
    pytest.main([__file__, "-v"])
