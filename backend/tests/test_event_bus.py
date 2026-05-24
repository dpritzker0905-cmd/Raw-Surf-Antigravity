"""
Test suite for event_bus_mcp_server.py
Verifies event publication, subscriber queues, swell threshold safety triggers, low latency propagation metrics, and JSON-RPC initialize standard.
"""
import os
import sys
import json
import sqlite3
import pytest
from io import StringIO

# Add backend directory to sys.path to allow importing from event_bus_mcp_server
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

import event_bus_mcp_server

# Initialize database
event_bus_mcp_server.init_db()

def seed_test_db():
    conn = sqlite3.connect(event_bus_mcp_server.DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    cursor.execute("DELETE FROM event_log")
    cursor.execute("DELETE FROM event_subscriptions")
    cursor.execute("DELETE FROM agent_event_queue")
    conn.commit()
    conn.close()

def test_publish_event_stores_and_logs():
    seed_test_db()
    
    payload = {"user_id": "surfer_44", "amount_paid": 99.0, "status": "completed"}
    res = event_bus_mcp_server.publish_event("payment_success", payload)
    
    assert res["success"] is True
    assert res["event_type"] == "payment_success"
    assert "event_id" in res
    assert res["subscribers_notified_count"] == 0 # no subs yet
    
    # Check DB state
    conn = sqlite3.connect(event_bus_mcp_server.DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT event_type, payload FROM event_log WHERE event_id = ?", (res["event_id"],))
    row = cursor.fetchone()
    conn.close()
    
    assert row is not None
    assert row[0] == "payment_success"
    assert json.loads(row[1])["user_id"] == "surfer_44"
    
    print("✓ Successfully verified publish_event logs and SQLite persistence")

def test_subscription_routing_and_pull():
    seed_test_db()
    
    # 1. Subscribe to bookings_created targeting agent_queue
    sub = event_bus_mcp_server.subscribe_to_channel("bookings_created", "agent_queue")
    assert sub["success"] is True
    sub_id = sub["subscription_id"]
    
    # 2. Publish bookings_created event
    booking_pay = {"booking_id": "bk_9901", "spot_name": "Malibu", "photographer_id": "ph_10"}
    pub_res = event_bus_mcp_server.publish_event("bookings_created", booking_pay)
    assert pub_res["success"] is True
    assert pub_res["subscribers_notified_count"] == 1
    
    # 3. Pull subscribed events (should pull the new event and mark as read)
    pulled = event_bus_mcp_server.pull_subscribed_events(sub_id)
    assert pulled["pulled_count"] == 1
    assert pulled["events"][0]["payload"]["booking_id"] == "bk_9901"
    
    # 4. Pull again (should return 0 enqueued events)
    pulled_again = event_bus_mcp_server.pull_subscribed_events(sub_id)
    assert pulled_again["pulled_count"] == 0
    
    print("✓ Dynamic subscriber routing and pull queue mailbox loops validated successfully")

def test_swell_threshold_crossing_autotrigger():
    seed_test_db()
    
    # 1. Subscribe to swell_threshold_crossed (so we can count notifies)
    sub = event_bus_mcp_server.subscribe_to_channel("swell_threshold_crossed", "agent_queue")
    sub_id = sub["subscription_id"]
    
    # 2. Publish weather_updated with large swell (12.5ft) -> should auto-trigger safety crossed event
    weather_payload = {
        "spot_name": "Malibu Reef",
        "swell_height_ft": 12.5,
        "wind_conditions": "18mph Onshore"
    }
    res = event_bus_mcp_server.publish_event("weather_updated", weather_payload)
    
    assert res["success"] is True
    # The secondary event should have published successfully
    sec_event = next((e for e in res["secondary_events"] if e["event_type"] == "swell_threshold_crossed"), None)
    assert sec_event is not None
    assert "SAFETY EXCEEDED" in sec_event["payload"]["alert"]
    
    # Pull the safety alert event
    pulled = event_bus_mcp_server.pull_subscribed_events(sub_id)
    assert pulled["pulled_count"] == 1
    assert "SAFETY EXCEEDED" in pulled["events"][0]["payload"]["alert"]
    
    print("✓ Intelligent swell safety threshold auto-trigger successfully audited")

def test_low_latency_propagation_benchmarking():
    seed_test_db()
    
    # Register multiple subscribers to simulate routing load
    event_bus_mcp_server.subscribe_to_channel("user_checked_map", "agent_queue")
    event_bus_mcp_server.subscribe_to_channel("user_checked_map", "agent_queue")
    event_bus_mcp_server.subscribe_to_channel("user_checked_map", "agent_queue")
    
    res = event_bus_mcp_server.publish_event("user_checked_map", {"user_id": "surf_88", "viewport": "SoCal"})
    assert res["success"] is True
    # Latency should easily measure < 500ms constraint (typically < 5ms locally)
    assert res["propagation_latency_ms"] < 500.0
    print(f"✓ Local event bus latency benchmark: {res['propagation_latency_ms']} ms")

def test_json_rpc_initialize():
    # Simulate a JSON-RPC stdio initialization call
    input_str = json.dumps({
        "jsonrpc": "2.0",
        "id": 401,
        "method": "initialize",
        "params": {}
    }) + "\n"
    
    old_stdin = sys.stdin
    old_stdout = sys.stdout
    sys.stdin = StringIO(input_str)
    sys.stdout = StringIO()
    
    try:
        event_bus_mcp_server.main()
        output_str = sys.stdout.getvalue()
    finally:
        sys.stdin = old_stdin
        sys.stdout = old_stdout
        
    response = json.loads(output_str.strip())
    assert response["jsonrpc"] == "2.0"
    assert response["id"] == 401
    assert "capabilities" in response["result"]
    assert response["result"]["serverInfo"]["name"] == "realtime-event-bus-mcp"
    print("✓ JSON-RPC realtime-event-bus-mcp Initialize returned correctly")

if __name__ == "__main__":
    pytest.main([__file__, "-v"])
