"""
Integration Test Suite for Debug Consciousness Layer (DCL) MCP.
Verifies event trace reconstruction, Root Cause Analysis formatting, system health metrics,
broken flow detection, and linear/branching chain comparisons.
"""
import os
import sys
import json
import sqlite3
import pytest
import uuid
from datetime import datetime, timezone, timedelta

# Add backend directory to sys.path
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

import event_bus_mcp_server
import debug_consciousness_mcp_server

def seed_test_dbs():
    event_bus_mcp_server.init_db()
    debug_consciousness_mcp_server.init_db()
    
    # Clean Event Bus DB
    conn = sqlite3.connect(event_bus_mcp_server.DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    cursor.execute("DELETE FROM event_log")
    cursor.execute("DELETE FROM event_subscriptions")
    cursor.execute("DELETE FROM agent_event_queue")
    conn.commit()
    conn.close()
    
    # Clean DCL Memory DB
    conn = sqlite3.connect(debug_consciousness_mcp_server.DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    cursor.execute("DELETE FROM failure_memory")
    conn.commit()
    conn.close()
    
    event_bus_mcp_server.clear_in_memory_handlers()

def test_dcl_event_trace_reconstruction():
    """Verify get_event_trace handles chronological ordering, latency gaps, and parallel execution branches"""
    seed_test_dbs()
    
    corr_id = f"corr_trace_{uuid.uuid4().hex[:8]}"
    base_time = datetime.now(timezone.utc)
    t1 = (base_time - timedelta(seconds=10)).isoformat().replace("+00:00", "Z")
    t2 = (base_time - timedelta(seconds=5)).isoformat().replace("+00:00", "Z")
    # Parallel events sharing the exact same timestamp (sibling execution)
    t3 = base_time.isoformat().replace("+00:00", "Z")
    t4 = base_time.isoformat().replace("+00:00", "Z")
    
    conn = sqlite3.connect(event_bus_mcp_server.DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO event_log (event_id, event_type, payload, timestamp, source_mcp, correlation_id)
    VALUES 
    ('evt_1', 'booking_created', '{}', ?, 'woocommerce_mcp', ?),
    ('evt_2', 'payment_initiated', '{}', ?, 'calendar_mcp', ?),
    ('evt_3', 'mcp_action_executed', '{}', ?, 'twilio_mcp', ?),
    ('evt_4', 'mcp_action_executed', '{}', ?, 'cloudinary_mcp', ?)
    """, (t1, corr_id, t2, corr_id, t3, corr_id, t4, corr_id))
    conn.commit()
    conn.close()
    
    res = debug_consciousness_mcp_server.get_event_trace(corr_id)
    assert res["correlation_id"] == corr_id
    assert res["event_count"] == 4
    
    events = res["events"]
    # Check ordering
    assert events[0]["event_id"] == "evt_1"
    assert events[1]["event_id"] == "evt_2"
    # Check latency offset calculation
    assert events[1]["latency_offset_ms"] > 4000.0
    
    # Check branching parallel detection
    branches = res["parallel_execution_branches"]
    assert len(branches) == 1
    assert "twilio_mcp" in [e["source_mcp"] for e in events]
    assert "cloudinary_mcp" in [e["source_mcp"] for e in events]
    print("✓ Event trace reconstruction, parallel sibling triggers, and latency offset checks passed")

def test_dcl_failure_detection_and_rca():
    """Verify explain_failure computes precise Root Cause Analysis conforming strictly to required output schema"""
    seed_test_dbs()
    
    corr_id = f"corr_fail_{uuid.uuid4().hex[:8]}"
    t1 = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    
    # Inject a hard payment failure event
    conn = sqlite3.connect(event_bus_mcp_server.DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO event_log (event_id, event_type, payload, timestamp, source_mcp, correlation_id)
    VALUES 
    ('evt_ok', 'booking_created', '{}', ?, 'woocommerce_mcp', ?),
    ('evt_fail', 'payment_failed', '{"error_message": "insufficient_funds"}', ?, 'stripe_mcp', ?)
    """, (t1, corr_id, t1, corr_id))
    conn.commit()
    conn.close()
    
    res = debug_consciousness_mcp_server.explain_failure("evt_fail")
    
    # Assert DCL strict outputs constraints
    assert "Root Cause Summary" in res
    assert "First failing MCP" in res
    assert "First failing event" in res
    assert "Full event chain leading to failure" in res
    assert "Suggested fix" in res
    assert "Confidence score (0-100%)" in res
    assert "failure_id" in res
    
    assert res["First failing MCP"] == "stripe_mcp"
    assert res["First failing event"] == "payment_failed"
    assert "payment_failed" in res["Full event chain leading to failure"]
    assert res["Confidence score (0-100%)"] > 90.0
    
    # Check that failure was written to debug memory
    history = debug_consciousness_mcp_server.get_failure_history(limit=10)
    assert len(history) == 1
    assert history[0]["failure_id"] == res["failure_id"]
    assert history[0]["failing_mcp"] == "stripe_mcp"
    print("✓ RCA failure analysis engine and historical debug memory logs verified")

def test_dcl_system_health_score_calculation():
    """Verify health score is penalized by hard failures, delayed events, and broken event chains"""
    seed_test_dbs()
    
    corr_id = f"corr_health_{uuid.uuid4().hex[:8]}"
    base_time = datetime.now(timezone.utc)
    t1 = (base_time - timedelta(seconds=10)).isoformat().replace("+00:00", "Z")
    t2 = (base_time - timedelta(seconds=9)).isoformat().replace("+00:00", "Z")
    # Soft latency anomaly (>500ms local propagation)
    t3 = base_time.isoformat().replace("+00:00", "Z")
    
    conn = sqlite3.connect(event_bus_mcp_server.DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO event_log (event_id, event_type, payload, timestamp, source_mcp, correlation_id)
    VALUES 
    ('evt_h1', 'booking_created', '{}', ?, 'woocommerce_mcp', ?),
    ('evt_h2', 'payment_initiated', '{}', ?, 'calendar_mcp', ?),
    ('evt_h3', 'mcp_error', '{"error_message": "timeout"}', ?, 'stripe_mcp', ?)
    """, (t1, corr_id, t2, corr_id, t3, corr_id))
    conn.commit()
    conn.close()
    
    res = debug_consciousness_mcp_server.get_system_health_score()
    
    assert res["system_health_score"] < 100.0
    assert res["hard_failures_detected"] == 1
    assert res["latency_anomalies_detected"] == 2
    assert "stripe_mcp" in res["mcp_reliability_scores"]
    assert res["mcp_reliability_scores"]["stripe_mcp"] == 0.0 # because it had a failure!
    print("✓ System health score evaluation indices and MCP reliability scores verified")

def test_dcl_broken_flows_discovery():
    """Verify incomplete/broken workflows are flagged properly"""
    seed_test_dbs()
    
    corr_id = f"corr_broken_{uuid.uuid4().hex[:8]}"
    t1 = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    
    # Inject a booking started event that was never confirmed (stalled booking flow)
    conn = sqlite3.connect(event_bus_mcp_server.DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO event_log (event_id, event_type, payload, timestamp, source_mcp, correlation_id)
    VALUES ('evt_b1', 'booking_created', '{}', ?, 'woocommerce_mcp', ?)
    """, (t1, corr_id))
    conn.commit()
    conn.close()
    
    res = debug_consciousness_mcp_server.find_broken_flows()
    assert res["broken_flows_count"] == 1
    assert res["broken_flows"][0]["correlation_id"] == corr_id
    assert res["broken_flows"][0]["flow_type"] == "Booking Lifecycle"
    assert "booking_confirmed" in res["broken_flows"][0]["missing_steps"]
    print("✓ Broken flows and incomplete sequence discovery verified successfully")

def test_dcl_chain_comparison():
    """Verify event chain diffing and average latency offset metrics comparison works"""
    seed_test_dbs()
    
    corr_a = f"corr_a_{uuid.uuid4().hex[:8]}"
    corr_b = f"corr_b_{uuid.uuid4().hex[:8]}"
    
    t1 = (datetime.now(timezone.utc) - timedelta(seconds=5)).isoformat().replace("+00:00", "Z")
    t2 = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    
    conn = sqlite3.connect(event_bus_mcp_server.DB_PATH)
    cursor = conn.cursor()
    # Flow A has 2 steps
    cursor.execute("""
    INSERT INTO event_log (event_id, event_type, payload, timestamp, source_mcp, correlation_id)
    VALUES 
    ('evt_a1', 'booking_created', '{}', ?, 'woocommerce_mcp', ?),
    ('evt_a2', 'payment_success', '{}', ?, 'stripe_mcp', ?)
    """, (t1, corr_a, t2, corr_a))
    # Flow B has only 1 step
    cursor.execute("""
    INSERT INTO event_log (event_id, event_type, payload, timestamp, source_mcp, correlation_id)
    VALUES 
    ('evt_b1', 'booking_created', '{}', ?, 'woocommerce_mcp', ?)
    """, (t1, corr_b))
    conn.commit()
    conn.close()
    
    res = debug_consciousness_mcp_server.compare_event_chains(corr_a, corr_b)
    
    assert res["comparison_result"] == "analyzed"
    assert res["differences"]["event_count_discrepancy"] == 1
    assert "payment_success" in res["differences"]["missing_in_flow_b"]
    print("✓ Parallel/linear trace comparison and missing node diffing checks passed")

def test_dcl_json_rpc_initialize():
    """Verify standard MCP stdio initialize loop response"""
    input_str = json.dumps({
        "jsonrpc": "2.0",
        "id": 801,
        "method": "initialize",
        "params": {}
    }) + "\n"
    
    old_stdin = sys.stdin
    old_stdout = sys.stdout
    sys.stdin = StringIO(input_str) if 'StringIO' in globals() else io.StringIO(input_str) if 'io' in globals() else io_import_helper(input_str)
    sys.stdout = StringIO() if 'StringIO' in globals() else io.StringIO() if 'io' in globals() else io_stdout_helper()
    
    try:
        debug_consciousness_mcp_server.main()
        output_str = sys.stdout.getvalue()
    finally:
        sys.stdin = old_stdin
        sys.stdout = old_stdout
        
    response = json.loads(output_str.strip())
    assert response["jsonrpc"] == "2.0"
    assert response["id"] == 801
    assert response["result"]["serverInfo"]["name"] == "debug-consciousness-mcp"
    print("✓ JSON-RPC debug-consciousness-mcp Initialize returned correctly")

# Helpers to handle standard IO imports dynamically
import io
def io_import_helper(s):
    return io.StringIO(s)
def io_stdout_helper():
    return io.StringIO()

if __name__ == "__main__":
    pytest.main([__file__, "-v"])
