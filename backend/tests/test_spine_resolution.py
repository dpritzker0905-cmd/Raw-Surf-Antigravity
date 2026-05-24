"""
Integration Test Suite verifying the three core Event Spine resolutions.
Tests Decoupled Operator weather lookups, Stripe/Calendar correlation_id propagation,
and non-blocking background-threaded Supabase synchronizer.
"""
import os
import sys
import json
import sqlite3
import pytest
import uuid
import time
from datetime import datetime, timezone

# Add backend directory to sys.path
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

import event_bus_mcp_server
import operator_mcp_server
import stripe_mcp_server
import google_calendar_mcp_server

def seed_test_dbs():
    event_bus_mcp_server.init_db()
    operator_mcp_server.init_db()
    stripe_mcp_server.init_db()
    google_calendar_mcp_server.init_db()
    
    # 1. Clean Event Bus DB
    conn = sqlite3.connect(event_bus_mcp_server.DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    cursor.execute("DELETE FROM event_log")
    conn.commit()
    conn.close()
    
    # 2. Clean Operator Decisions DB
    conn = sqlite3.connect(operator_mcp_server.DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    cursor.execute("DELETE FROM operator_decisions")
    conn.commit()
    conn.close()
    
    # 3. Clean Stripe payments DB
    conn = sqlite3.connect(stripe_mcp_server.DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    cursor.execute("DELETE FROM stripe_payments")
    conn.commit()
    conn.close()

    # 4. Clean Calendar events DB
    conn = sqlite3.connect(google_calendar_mcp_server.DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    cursor.execute("DELETE FROM calendar_events")
    conn.commit()
    conn.close()


def test_decoupled_operator_weather_lookup():
    """Verify that operator monitor_system_state resolves weather from Event Spine events instead of direct SQLite file imports"""
    seed_test_dbs()
    
    # 1. Publish weather_updated on the spine
    spot_name = "Blacks Beach"
    weather_payload = {
        "spot_name": spot_name,
        "swell_height_ft": 8.5,
        "swell_period_sec": 16,
        "wind_speed_mph": 5.0,
        "wind_conditions": "Glassy Offshore",
        "tide_cycle": "rising"
    }
    event_bus_mcp_server.publish_event("weather_updated", weather_payload, source_mcp="world_model_mcp")
    
    # 2. Monitor system state inside the operator - should dynamically fetch weather parameters from the Event Spine!
    state = operator_mcp_server.monitor_system_state(spot_name)
    
    assert state["spot_name"] == spot_name
    assert state["weather_conditions"]["swell_height_ft"] == 8.5
    assert state["weather_conditions"]["swell_period_sec"] == 16
    assert state["weather_conditions"]["wind_speed_mph"] == 5.0
    assert state["booking_demand"] == "HIGH" # because Blacks was prime!
    print("✓ Successfully verified decoupled Operator Event Spine weather resolution")

def test_correlation_propagation_stripe_calendar():
    """Verify correlation_id maps correctly across Stripe and Calendar tool signatures and outputs"""
    seed_test_dbs()
    
    corr_id = f"corr_trace_prop_{uuid.uuid4().hex[:8]}"
    
    # 1. Stripe Checkout Create
    stripe_res = stripe_mcp_server.stripe_create_checkout_session(
        customer_id="cus_beg_01",
        amount=120.0,
        currency="usd",
        success_url="https://success",
        cancel_url="https://cancel",
        correlation_id=corr_id
    )
    assert stripe_res["correlation_id"] == corr_id
    
    # Check Stripe SQL records
    conn = sqlite3.connect(stripe_mcp_server.DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT correlation_id FROM stripe_payments WHERE payment_intent_id = ?", (stripe_res["payment_intent_id"],))
    row = cursor.fetchone()
    conn.close()
    assert row is not None
    assert row[0] == corr_id
    
    # 2. Calendar Booking Create
    cal_res = google_calendar_mcp_server.calendar_create_booking(
        provider_id="prov_coach_01",
        customer_id="cus_beg_01",
        summary="Surf Lesson",
        description="Malibu",
        start_iso="2026-05-24T15:00:00Z",
        end_iso="2026-05-24T16:00:00Z",
        correlation_id=corr_id
    )
    assert cal_res["correlation_id"] == corr_id
    
    # Check Calendar SQL records
    conn = sqlite3.connect(google_calendar_mcp_server.DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT correlation_id FROM calendar_events WHERE event_id = ?", (cal_res["event_id"],))
    row = cursor.fetchone()
    conn.close()
    assert row is not None
    assert row[0] == corr_id
    
    print("✓ Stripe checkout session and Google Calendar bookings correctly propagate correlation_id")

def test_supabase_cloud_sync_bridge(monkeypatch):
    """Verify background threaded non-blocking Supabase cloud bridge gets triggered and executes asynchronously"""
    seed_test_dbs()
    
    # Mock environment variables to activate cloud bridge syncer
    monkeypatch.setenv("SUPABASE_URL", "https://mock.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_KEY", "mock-service-key")
    
    post_requests = []
    
    # Mock httpx.Client.post inside worker thread
    class MockClient:
        def __enter__(self):
            return self
        def __exit__(self, exc_type, exc_val, exc_tb):
            pass
        def post(self, url, json, headers):
            post_requests.append({"url": url, "payload": json, "headers": headers})
            
    import httpx
    monkeypatch.setattr(httpx, "Client", lambda timeout=None: MockClient())
    
    # Publish event
    res = event_bus_mcp_server.publish_event(
        event_type="payment_success",
        payload={"amount": 95.0},
        correlation_id="corr_cloud_sync_99"
    )
    
    # Sleep slightly to allow background daemon thread worker to fire
    time.sleep(0.3)
    
    assert len(post_requests) == 1
    req = post_requests[0]
    assert "mock.supabase.co" in req["url"]
    assert req["payload"]["correlation_id"] == "corr_cloud_sync_99"
    assert req["headers"]["apikey"] == "mock-service-key"
    print("✓ Asynchronous background threaded Supabase cloud synchronizer validated successfully")

if __name__ == "__main__":
    pytest.main([__file__, "-v"])
