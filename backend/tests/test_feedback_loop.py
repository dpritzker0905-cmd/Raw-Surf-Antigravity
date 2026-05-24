"""
Test suite for feedback_loop_mcp_server.py
Verifies telemetry event ingestion, error filtering, Map FPS and memory usage anomalies, user funnel conversions, and JSON-RPC stdio.
"""
import os
import sys
import json
import sqlite3
import pytest
from io import StringIO

# Add backend directory to sys.path to allow importing from feedback_loop_mcp_server
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

import feedback_loop_mcp_server

# Initialize database
feedback_loop_mcp_server.init_db()

def seed_test_db():
    conn = sqlite3.connect(feedback_loop_mcp_server.DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    
    # Pure clean sweep for test idempotency
    cursor.execute("DELETE FROM system_logs")
    cursor.execute("DELETE FROM api_metrics")
    cursor.execute("DELETE FROM user_behavior")
    cursor.execute("DELETE FROM performance_metrics")
    
    conn.commit()
    conn.close()

def test_ingest_telemetry_logs_and_metrics():
    seed_test_db()
    
    # Ingest frontend log
    res1 = feedback_loop_mcp_server.ingest_telemetry_event(
        category="log",
        payload={
            "source": "frontend_netlify",
            "level": "info",
            "message": "Rendered MapLibre map canvas container successfully."
        }
    )
    assert res1["success"] is True
    assert res1["sync_status"] == "synchronized_with_supabase_timeseries"
    
    # Ingest critical backend log (should trigger warning/alert in console)
    res2 = feedback_loop_mcp_server.ingest_telemetry_event(
        category="log",
        payload={
            "source": "backend_render",
            "level": "error",
            "message": "Database pool connection timeout on fetch spots."
        }
    )
    assert res2["success"] is True
    assert len(res2["alerts_triggered"]) == 1
    assert "Database pool connection timeout" in res2["alerts_triggered"][0]
    
    # Ingest high latency API metric (status 200)
    res3 = feedback_loop_mcp_server.ingest_telemetry_event(
        category="api_metric",
        payload={
            "endpoint": "/api/spots/explore",
            "latency_ms": 320.5,
            "status_code": 200
        }
    )
    assert res3["success"] is True
    
    # Ingest HTTP 500 error metric
    res4 = feedback_loop_mcp_server.ingest_telemetry_event(
        category="api_metric",
        payload={
            "endpoint": "/api/bookings/create",
            "latency_ms": 1205.1,
            "status_code": 500,
            "error_message": "Internal Server Error during transaction write."
        }
    )
    assert res4["success"] is True
    assert len(res4["alerts_triggered"]) == 1
    assert "CRITICAL HTTP ALERT" in res4["alerts_triggered"][0]
    
    print("✓ Telemetry ingestion correctly routes and evaluates regression alert boundaries")

def test_get_recent_errors_filtering():
    seed_test_db()
    
    # Populate mix of healthy and error events
    feedback_loop_mcp_server.ingest_telemetry_event("log", {"source": "frontend_netlify", "level": "info", "message": "Standard log."})
    feedback_loop_mcp_server.ingest_telemetry_event("log", {"source": "frontend_netlify", "level": "error", "message": "Failed to resolve spot overlay."})
    feedback_loop_mcp_server.ingest_telemetry_event("log", {"source": "backend_render", "level": "fatal", "message": "Out of memory crash."})
    
    feedback_loop_mcp_server.ingest_telemetry_event("api_metric", {"endpoint": "/api/weather", "latency_ms": 50.0, "status_code": 200})
    feedback_loop_mcp_server.ingest_telemetry_event("api_metric", {"endpoint": "/api/stripe/charge", "latency_ms": 400.0, "status_code": 402, "error_message": "Card Declined"})
    
    errors = feedback_loop_mcp_server.get_recent_errors(limit=10)
    
    # We should have exactly 3 error entries: Netlify error, Render fatal, Stripe HTTP 402
    assert len(errors) == 3
    assert errors[0]["type"] in ("system_log", "api_failure")
    print(f"✓ Retrieved {len(errors)} structured critical error events successfully")

def test_get_performance_anomalies():
    seed_test_db()
    
    # Seed healthy performance metrics
    feedback_loop_mcp_server.ingest_telemetry_event("performance", {"metric_type": "map_fps", "value": 59.8})
    feedback_loop_mcp_server.ingest_telemetry_event("performance", {"metric_type": "memory_usage_mb", "value": 240.2})
    
    # Seed anomaly performance metrics (FPS drop and memory spike)
    feedback_loop_mcp_server.ingest_telemetry_event("performance", {"metric_type": "map_fps", "value": 18.5})
    feedback_loop_mcp_server.ingest_telemetry_event("performance", {"metric_type": "memory_usage_mb", "value": 612.4})
    
    anomalies = feedback_loop_mcp_server.get_performance_anomalies(min_fps=30.0, max_memory_mb=512.0)
    
    assert len(anomalies) == 2
    # Verify low FPS details
    fps_anomaly = next(a for a in anomalies if a["type"] == "low_frame_rate")
    assert fps_anomaly["value_fps"] == 18.5
    
    # Verify memory leak details
    mem_anomaly = next(a for a in anomalies if a["type"] == "memory_leak_spike")
    assert mem_anomaly["value_mb"] == 612.4
    
    print("✓ Successfully identified frame rate drops and memory allocation leaks")

def test_get_user_funnel_dropoff():
    seed_test_db()
    
    # Seed behavior logs representing:
    # - User 1: Starts and completes booking (Converted)
    # - User 2: Starts booking but drops off (Dropoff)
    # - User 3: Starts and completes booking (Converted)
    feedback_loop_mcp_server.ingest_telemetry_event("user_behavior", {"user_id": "usr_surf_01", "event_type": "booking_started"})
    feedback_loop_mcp_server.ingest_telemetry_event("user_behavior", {"user_id": "usr_surf_01", "event_type": "booking_completed"})
    
    feedback_loop_mcp_server.ingest_telemetry_event("user_behavior", {"user_id": "usr_surf_02", "event_type": "booking_started"})
    
    feedback_loop_mcp_server.ingest_telemetry_event("user_behavior", {"user_id": "usr_surf_03", "event_type": "booking_started"})
    feedback_loop_mcp_server.ingest_telemetry_event("user_behavior", {"user_id": "usr_surf_03", "event_type": "booking_completed"})
    
    funnel = feedback_loop_mcp_server.get_user_funnel_dropoff()
    
    assert funnel["total_started"] == 3
    assert funnel["total_completed"] == 2
    assert funnel["absolute_dropoffs"] == 1
    assert funnel["conversion_percentage"] == 66.67
    
    print("✓ Verified surfer funnel conversions and dropoff percentage metrics")

def test_json_rpc_initialize():
    # Simulate a JSON-RPC stdio initialization call
    input_str = json.dumps({
        "jsonrpc": "2.0",
        "id": 88,
        "method": "initialize",
        "params": {}
    }) + "\n"
    
    old_stdin = sys.stdin
    old_stdout = sys.stdout
    sys.stdin = StringIO(input_str)
    sys.stdout = StringIO()
    
    try:
        feedback_loop_mcp_server.main()
        output_str = sys.stdout.getvalue()
    finally:
        sys.stdin = old_stdin
        sys.stdout = old_stdout
        
    response = json.loads(output_str.strip())
    assert response["jsonrpc"] == "2.0"
    assert response["id"] == 88
    assert "capabilities" in response["result"]
    assert response["result"]["serverInfo"]["name"] == "system-feedback-loop-mcp"
    print("✓ JSON-RPC system-feedback-loop-mcp Initialize returned correctly")

if __name__ == "__main__":
    pytest.main([__file__, "-v"])
