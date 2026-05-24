"""
Test suite for operator_mcp_server.py
Verifies monitoring recommendations, pricing proposals with safe boundaries, admin approval Gates, safety validations, and JSON-RPC stdio.
"""
import os
import sys
import json
import sqlite3
import pytest
from io import StringIO

# Add backend directory to sys.path to allow importing from operator_mcp_server
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

import operator_mcp_server

# Initialize database
operator_mcp_server.init_db()

def seed_test_db():
    conn = sqlite3.connect(operator_mcp_server.DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    cursor.execute("DELETE FROM operator_decisions")
    conn.commit()
    conn.close()

def test_monitor_system_state_generates_recommendations():
    # Test monitoring Malibu conditions
    res = operator_mcp_server.monitor_system_state("Malibu")
    assert res["spot_name"] == "Malibu"
    assert "weather_conditions" in res
    assert "booking_demand" in res
    assert "photographer_availability" in res
    assert len(res["recommendations"]) > 0
    
    # Verify we get the expected actions in recommendations
    actions = [rec["action"] for rec in res["recommendations"]]
    assert "adjust_pricing" in actions
    assert "open_bookings" in actions or "close_bookings" in actions
    
    print("✓ Successfully verified system state monitoring recommendations")

def test_propose_pricing_change_gate():
    seed_test_db()
    
    # 1. Propose valid pricing adjustment ($120.0)
    res = operator_mcp_server.propose_pricing_change("Malibu", 120.0, "High demand peak surge multiplier")
    assert res["success"] is True
    assert res["status"] == "pending_approval"
    assert res["proposed_price"] == 120.0
    
    # 2. Propose price too high (out of bounds)
    res_high = operator_mcp_server.propose_pricing_change("Malibu", 250.0, "Grom extreme surge price")
    assert res_high["success"] is False
    assert "out of safe operational bounds" in res_high["error"]
    
    # 3. Propose price too low (out of bounds)
    res_low = operator_mcp_server.propose_pricing_change("Malibu", 20.0, "Heavy discount")
    assert res_low["success"] is False
    assert "out of safe operational bounds" in res_low["error"]

    print("✓ Pricing proposal bounds properly enforced")

def test_execute_decision_admin_success():
    seed_test_db()
    
    # Propose pricing change
    prop = operator_mcp_server.propose_pricing_change("Malibu", 115.0, "Dynamic pricing adjustments")
    decision_id = prop["decision_id"]
    
    # Admin role attempts execution (Should succeed)
    exec_res = operator_mcp_server.execute_decision(decision_id, "admin")
    assert exec_res["success"] is True
    assert exec_res["status"] == "executed"
    assert exec_res["caller_role"] == "admin"
    assert "execution_timestamp" in exec_res
    
    # Verify DB state
    history = operator_mcp_server.get_operator_decision_history()
    assert len(history) == 1
    assert history[0]["status"] == "executed"
    assert history[0]["caller_role"] == "admin"
    assert history[0]["execution_result"]["stripe_sync"]["status"] == "synchronized"
    
    print("✓ Admin approval gate success and system sync completed")

def test_execute_decision_unauthorized():
    seed_test_db()
    
    # Propose pricing change
    prop = operator_mcp_server.propose_pricing_change("Malibu", 115.0, "Dynamic pricing adjustments")
    decision_id = prop["decision_id"]
    
    # Moderator attempts execution (Should be rejected)
    exec_res = operator_mcp_server.execute_decision(decision_id, "moderator")
    assert exec_res["success"] is False
    assert "Unauthorized" in exec_res["error"]
    
    # User attempts execution (Should be rejected)
    exec_res_user = operator_mcp_server.execute_decision(decision_id, "user")
    assert exec_res_user["success"] is False
    assert "Unauthorized" in exec_res_user["error"]
    
    print("✓ Non-admin roles strictly rejected by Gate")

def test_propose_cancellation_safety_check():
    seed_test_db()
    
    # 1. Propose safety cancellation under normal conditions (swell = 5.5ft) -> should be rejected
    res_normal = operator_mcp_server.propose_cancellation("evt_101", "Routine cancel", swell_height_ft=5.5)
    assert res_normal["success"] is False
    assert "below the critical 10.0ft safety limit" in res_normal["error"]
    
    # 2. Propose safety cancellation under extreme conditions (swell = 12.0ft) -> should pass validation
    res_extreme = operator_mcp_server.propose_cancellation("evt_102", "Dangerous storm warning swell", swell_height_ft=12.0)
    assert res_extreme["success"] is True
    assert res_extreme["status"] == "pending_approval"
    assert res_extreme["safety_threshold_validated"] is True
    
    # 3. Admin executes the validated cancellation
    decision_id = res_extreme["decision_id"]
    exec_res = operator_mcp_server.execute_decision(decision_id, "admin")
    assert exec_res["success"] is True
    assert exec_res["status"] == "executed"
    assert "canceled" in exec_res["execution_result"]["calendar_sync"]["message"]
    
    print("✓ Swell height safety threshold cancellation checks verified")

def test_json_rpc_initialize():
    # Simulate a JSON-RPC stdio initialization call
    input_str = json.dumps({
        "jsonrpc": "2.0",
        "id": 201,
        "method": "initialize",
        "params": {}
    }) + "\n"
    
    old_stdin = sys.stdin
    old_stdout = sys.stdout
    sys.stdin = StringIO(input_str)
    sys.stdout = StringIO()
    
    try:
        operator_mcp_server.main()
        output_str = sys.stdout.getvalue()
    finally:
        sys.stdin = old_stdin
        sys.stdout = old_stdout
        
    response = json.loads(output_str.strip())
    assert response["jsonrpc"] == "2.0"
    assert response["id"] == 201
    assert "capabilities" in response["result"]
    assert response["result"]["serverInfo"]["name"] == "autonomous-operator-mcp"
    print("✓ JSON-RPC autonomous-operator-mcp Initialize returned correctly")

if __name__ == "__main__":
    pytest.main([__file__, "-v"])
