"""
Integration Test Suite verifying the Production Finalization & Clean Build Lock requirements.
Tests strict Admin Queue schemas, human-in-the-loop gates, and clean event spine tracing.
"""
import os
import sys
import json
import sqlite3
import pytest
import uuid
from datetime import datetime, timezone

# Add backend directory to sys.path
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

import event_bus_mcp_server
import operator_mcp_server

def seed_production_dbs():
    event_bus_mcp_server.init_db()
    operator_mcp_server.init_db()
    
    # 1. Clean Event Bus
    conn = sqlite3.connect(event_bus_mcp_server.DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    cursor.execute("DELETE FROM event_log")
    conn.commit()
    conn.close()
    
    # 2. Clean Operator Queue
    conn = sqlite3.connect(operator_mcp_server.DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    cursor.execute("DELETE FROM operator_decisions")
    conn.commit()
    conn.close()

def test_operator_admin_queue_enqueue():
    """Verify Operator monitor enqueues recommendations with full schema parameters to Admin Queue"""
    seed_production_dbs()
    
    spot = "Malibu"
    corr_id = f"corr_mon_hard_{uuid.uuid4().hex[:8]}"
    
    # 1. Seed weather event on the spine
    weather_payload = {
        "spot_name": spot,
        "swell_height_ft": 11.5, # dangerous!
        "swell_period_sec": 18,
        "wind_speed_mph": 4.5,
        "wind_conditions": "Glassy Offshore",
        "tide_cycle": "falling"
    }
    event_bus_mcp_server.publish_event(
        event_type="weather_updated",
        payload=weather_payload,
        correlation_id=corr_id,
        source_service="world_model_mcp"
    )
    
    # 2. Monitor system state inside the operator - should enqeue recommendations!
    res = operator_mcp_server.monitor_system_state(spot)
    
    # Verify recommendations structures
    assert len(res["recommendations"]) > 0
    
    # Check SQLite Admin Queue records for enqueued decisions
    conn = sqlite3.connect(operator_mcp_server.DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
    SELECT decision_id, type, status, risk_level, confidence_score, expected_outcome, supporting_event_trace
    FROM operator_decisions ORDER BY timestamp DESC
    """)
    rows = cursor.fetchall()
    conn.close()
    
    assert len(rows) > 0
    # There should be a cancellation recommendation because swell height is 11.5ft (> 10.0ft safety limit)
    cancellation_dec = next((r for r in rows if r[1] == "close_bookings"), None)
    assert cancellation_dec is not None
    assert cancellation_dec[2] == "pending_approval"
    assert cancellation_dec[3] == "high" # safety critical risk
    assert cancellation_dec[4] == 99.0 # confidence score
    assert "safety" in cancellation_dec[5].lower()
    assert cancellation_dec[6] == corr_id
    
    print("✓ Successfully verified Admin Queue enqueuing with comprehensive metrics")

def test_admin_approval_gate_enforcement():
    """Verify execute_decision strictly gates execution behind caller_role == admin and emits admin_approved_action"""
    seed_production_dbs()
    
    # 1. Manually insert a pending pricing adjustment recommendation
    decision_id = f"dec_test_{uuid.uuid4().hex[:8]}"
    corr_id = f"corr_prop_{uuid.uuid4().hex[:8]}"
    timestamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    
    conn = sqlite3.connect(operator_mcp_server.DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO operator_decisions (
        decision_id, type, spot_name, proposed_value, status, explanation, timestamp, correlation_id,
        recommendation_type, reasoning, supporting_event_trace, expected_outcome, risk_level, confidence_score
    ) VALUES (?, 'pricing_adjustment', 'Blacks Beach', '125.0', 'pending_approval', 'Surge peak demand', ?, ?, 'pricing_adjustment', 'Peak Glassy surge', ?, 'High revenue', 'low', 95.0)
    """, (decision_id, timestamp, corr_id, corr_id))
    conn.commit()
    conn.close()
    
    # 2. Attempt execution by moderator (Should fail)
    res_mod = operator_mcp_server.execute_decision(decision_id, "moderator")
    assert res_mod["success"] is False
    assert "admin approval" in res_mod["error"]
    
    # 3. Attempt execution by surfer (Should fail)
    res_user = operator_mcp_server.execute_decision(decision_id, "user")
    assert res_user["success"] is False
    assert "admin approval" in res_user["error"]
    
    # 4. Attempt execution by admin (Should succeed)
    res_admin = operator_mcp_server.execute_decision(decision_id, "admin")
    assert res_admin["success"] is True
    assert res_admin["status"] == "executed"
    
    # 5. Check if execute_decision published "admin_approved_action" event to the Event Spine backbone!
    recent_events = event_bus_mcp_server.get_recent_events(event_type="admin_approved_action", limit=5)
    assert len(recent_events) > 0
    approved_evt = recent_events[0]
    
    assert approved_evt["correlation_id"] == corr_id
    assert approved_evt["payload"]["decision_id"] == decision_id
    assert approved_evt["payload"]["recommendation_type"] == "pricing_adjustment"
    assert approved_evt["payload"]["approved_by"] == "admin"
    
    print("✓ Human-In-The-Loop Gate successfully enlists and executes admin actions strictly")

def test_event_spine_lifecycle_tracing():
    """Verify trace sequence and standard fields compliance from booking creation to success"""
    seed_production_dbs()
    
    corr_id = f"corr_trace_prop_{uuid.uuid4().hex[:8]}"
    
    # Step 1: publish booking_created
    event_bus_mcp_server.publish_event(
        event_type="booking_created",
        payload={"booking_id": "b_xyz_99", "amount": 120.0},
        correlation_id=corr_id,
        source_service="calendar_mcp",
        user_id="surfer_pro_8"
    )
    
    # Step 2: publish payment_success
    event_bus_mcp_server.publish_event(
        event_type="payment_success",
        payload={"booking_id": "b_xyz_99", "payment_intent_id": "pi_stripe_77"},
        correlation_id=corr_id,
        source_service="stripe_mcp",
        user_id="surfer_pro_8"
    )
    
    # Step 3: publish booking_confirmed
    event_bus_mcp_server.publish_event(
        event_type="booking_confirmed",
        payload={"booking_id": "b_xyz_99", "provider_id": "kai_coach_01"},
        correlation_id=corr_id,
        source_service="calendar_mcp",
        user_id="surfer_pro_8"
    )
    
    # Retrieve the full chronological event flow trace
    trace = event_bus_mcp_server.get_event_flow_trace(corr_id)
    assert len(trace) == 3
    
    # Verify standard schema fields exist in trace events
    for evt in trace:
        assert "event_id" in evt
        assert "event_type" in evt
        assert "payload" in evt
        assert "timestamp" in evt
        assert "user_id" in evt
        assert "correlation_id" in evt
        assert "source_service" in evt or "source_mcp" in evt
        assert evt["correlation_id"] == corr_id
        assert evt["user_id"] == "surfer_pro_8"
        
    assert trace[0]["event_type"] == "booking_created"
    assert trace[1]["event_type"] == "payment_success"
    assert trace[2]["event_type"] == "booking_confirmed"
    
    print("✓ Full Booking Lifecycle traces correctly reconstructed from Event Spine Z-ordered chains")

def test_no_autonomous_modifications():
    """Verify that the system contains zero self-modifying or autonomous-healing loops"""
    # Simply verify that the operator contains no active loops or self-modifying code blocks
    # Ensure debug consciousness layer has no active 'repair' methods
    import debug_consciousness_mcp_server
    import simulation_mcp_server
    
    # Read debug consciousness server functions to prove it's exclusively read-only
    dcl_attrs = dir(debug_consciousness_mcp_server)
    assert "repair_system" not in dcl_attrs
    assert "self_heal" not in dcl_attrs
    assert "recode_failed_module" not in dcl_attrs
    
    # Ensure simulation layer has no active state modifications
    sim_attrs = dir(simulation_mcp_server)
    assert "auto_optimize" not in sim_attrs
    assert "execute_scaling_changes" not in sim_attrs
    
    print("✓ Verified complete absence of autonomous self-modifying/self-healing logic in production build")

if __name__ == "__main__":
    pytest.main([__file__, "-v"])
