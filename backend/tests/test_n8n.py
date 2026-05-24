"""
Test suite for n8n_mcp_server.py
Verifies workflow configuration, automatic trigger execution, retry recovery handling, dashboard monitoring, and JSON-RPC stdio protocol.
"""
import os
import sys
import json
import sqlite3
import pytest
from io import StringIO

# Add backend directory to sys.path to allow importing from n8n_mcp_server
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

import n8n_mcp_server

# Initialize database once before running tests
n8n_mcp_server.init_db()

def test_create_workflow():
    # Delete existing newsletter workflow to keep test fully idempotent
    conn = sqlite3.connect(n8n_mcp_server.DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    cursor.execute("DELETE FROM n8n_workflows WHERE name = 'custom_newsletter'")
    conn.commit()
    conn.close()
    
    res = n8n_mcp_server.add_workflow(
        name="custom_newsletter",
        nodes_list=["Supabase_Query_Users", "Twilio_SMS_Newsletter"],
        max_retries=3,
        backoff=2.0
    )
    assert res["success"] is True
    assert res["workflow_name"] == "custom_newsletter"
    print("✓ Custom workflow created successfully")

def test_trigger_workflow_success():
    payload = {"user_id": "usr_99", "amount": 120.00, "phone": "+1 (555) 123-4567"}
    res = n8n_mcp_server.run_workflow("booking_flow", payload)
    assert res["execution_status"] == "SUCCESS"
    assert res["retry_attempts_recorded"] == 0
    assert len(res["execution_logs"]) == 4
    print("✓ Triggered successful booking workflow")

def test_trigger_workflow_retry_recovery():
    # Simulate a failed invoice that recovers on retry
    payload = {"booking_id": "bk_404", "trigger_fail": True, "phone": "+1 (555) 777-8888"}
    res = n8n_mcp_server.run_workflow("failed_payment_recovery", payload)
    assert res["execution_status"] == "SUCCESS"
    assert res["retry_attempts_recorded"] == 1
    # Check that it recorded failure log and success retry log
    logs = res["execution_logs"]
    assert logs[0]["step"] == "Stripe_Payment_Webhook"
    assert logs[0]["status"] == "FAILED"
    assert logs[1]["step"] == "Retry_1"
    assert logs[1]["status"] == "SUCCESS"
    print("✓ Verified automatic workflow retry and recovery flow")

def test_trigger_workflow_permanent_failure():
    # Simulate a failed webhook that fails even on retry
    payload = {"booking_id": "bk_500", "trigger_fail": True, "permanent_fail": True}
    res = n8n_mcp_server.run_workflow("failed_payment_recovery", payload)
    assert res["execution_status"] == "FAILED"
    assert res["retry_attempts_recorded"] == 1
    assert "Exceeded" in res["error_message"]
    print("✓ Verified permanent failure limits checking")

def test_get_executions():
    execs = n8n_mcp_server.get_executions(limit=5)
    assert len(execs) >= 3
    assert execs[0]["execution_id"].startswith("exec_")
    print(f"✓ Retrieved {len(execs)} workflow execution logs")

def test_get_dashboard_metrics():
    dash = n8n_mcp_server.get_dashboard_metrics()
    summary = dash["dashboard_summary"]
    assert summary["total_executions"] >= 4
    assert "success_rate_percentage" in summary
    assert len(dash["visual_metrics_curve"]) > 0
    print(f"✓ Dashboard monitoring metrics compiled. Success Rate: {summary['success_rate_percentage']}%")

def test_update_retry_policy():
    res = n8n_mcp_server.update_retry_policy("booking_flow", max_retries=5, backoff=4.5)
    assert res["success"] is True
    assert res["configured_max_retries"] == 5
    assert res["configured_backoff_factor"] == 4.5
    print("✓ Retry recovery policy updated in cache")

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
        n8n_mcp_server.main()
        output_str = sys.stdout.getvalue()
    finally:
        sys.stdin = old_stdin
        sys.stdout = old_stdout
        
    response = json.loads(output_str.strip())
    assert response["jsonrpc"] == "2.0"
    assert response["id"] == 1
    assert "capabilities" in response["result"]
    assert response["result"]["serverInfo"]["name"] == "n8n-mcp"
    print("✓ JSON-RPC n8n Initialize method returns correct protocol metadata")

if __name__ == "__main__":
    pytest.main([__file__, "-v"])
