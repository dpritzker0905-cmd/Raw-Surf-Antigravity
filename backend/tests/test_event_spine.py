"""
Comprehensive Integration Test Suite for Antigravity 2.0 Event Spine Architecture.
Verifies dynamic SQLite migrations, zero-coupling event routing, causal correlation tracing,
time-range replays, and the 4 critical decoupled flows.
"""
import os
import sys
import json
import sqlite3
import pytest
import uuid
import time
from datetime import datetime, timezone, timedelta

# Add backend directory to sys.path to allow importing event_bus_mcp_server
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

import event_bus_mcp_server

def seed_test_db():
    event_bus_mcp_server.init_db()
    conn = sqlite3.connect(event_bus_mcp_server.DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    cursor.execute("DELETE FROM event_log")
    cursor.execute("DELETE FROM event_subscriptions")
    cursor.execute("DELETE FROM agent_event_queue")
    conn.commit()
    conn.close()
    event_bus_mcp_server.clear_in_memory_handlers()

def test_dynamic_migrations_and_schema():
    """Verify that init_db dynamically updates/creates event_log schema correctly"""
    seed_test_db()
    
    conn = sqlite3.connect(event_bus_mcp_server.DB_PATH)
    cursor = conn.cursor()
    cursor.execute("PRAGMA table_info(event_log)")
    cols = [col[1] for col in cursor.fetchall()]
    conn.close()
    
    assert "event_id" in cols
    assert "event_type" in cols
    assert "payload" in cols
    assert "timestamp" in cols
    assert "user_id" in cols
    assert "source_mcp" in cols
    assert "correlation_id" in cols
    print("✓ Successfully verified SQLite dynamic schema and migrations support")

def test_basic_publish_and_subscriber_routing():
    """Verify standard publishing, metadata resolve, and agent pull-queues"""
    seed_test_db()
    
    # 1. Subscribe to a specific channel
    sub = event_bus_mcp_server.subscribe_to_channel("payment_success", "agent_queue")
    assert sub["success"] is True
    sub_id = sub["subscription_id"]
    
    # 2. Publish event with explicit tracking properties
    payload = {"booking_id": "bk_9011", "customer_id": "usr_surfer_55", "amount": 120.0}
    corr_id = f"corr_{uuid.uuid4().hex[:8]}"
    
    res = event_bus_mcp_server.publish_event(
        event_type="payment_success",
        payload=payload,
        correlation_id=corr_id,
        source_mcp="stripe_mcp"
    )
    
    assert res["success"] is True
    assert res["correlation_id"] == corr_id
    assert res["source_mcp"] == "stripe_mcp"
    assert res["user_id"] == "usr_surfer_55" # Resolved automatically from customer_id!
    assert res["subscribers_notified_count"] == 1
    
    # 3. Pull from mailbox queue and check fields
    pulled = event_bus_mcp_server.pull_subscribed_events(sub_id)
    assert pulled["pulled_count"] == 1
    event = pulled["events"][0]
    assert event["event_type"] == "payment_success"
    assert event["correlation_id"] == corr_id
    assert event["source_mcp"] == "stripe_mcp"
    assert event["user_id"] == "usr_surfer_55"
    assert event["payload"]["amount"] == 120.0
    print("✓ Dynamic metadata resolution, pub/sub, and agent queue pull verified")

def test_flow_1_booking_lifecycle():
    """
    Verify FLOW 1: BOOKING LIFECYCLE (CRITICAL E2E CHAIN)
    booking_created →
      calendar_mcp.reserve_slot →
      stripe_mcp.create_payment →
      payment_success →
      twilio_mcp.send_confirmation →
      cloudinary_mcp.prepare_media →
      memory_mcp.store_session →
      recommendation_mcp.update_profile →
      booking_confirmed
    """
    seed_test_db()
    
    corr_id = f"corr_booking_{uuid.uuid4().hex[:8]}"
    flow_steps = []
    
    # Define decoupled event-driven listeners mimicking each MCP module
    
    def on_booking_created(ev_type, payload, corr, src):
        flow_steps.append("calendar_mcp.reserve_slot")
        # Reserve slot and publish slot_reserved
        event_bus_mcp_server.publish_event(
            event_type="payment_initiated", # maps to slot reserve -> payment initiate
            payload={"booking_id": payload["booking_id"], "customer_id": payload["user_id"]},
            correlation_id=corr,
            source_mcp="calendar_mcp"
        )
        
    def on_payment_initiated(ev_type, payload, corr, src):
        flow_steps.append("stripe_mcp.create_payment")
        # Trigger payment success (simulated card succeeded)
        event_bus_mcp_server.publish_event(
            event_type="payment_success",
            payload={"booking_id": payload["booking_id"], "customer_id": payload["customer_id"], "status": "succeeded"},
            correlation_id=corr,
            source_mcp="stripe_mcp"
        )
        
    def on_payment_success(ev_type, payload, corr, src):
        # payment_success triggers Twain confirmation, Cloudinary media optimization, and Memory storage
        flow_steps.append("payment_success_receivers")
        
        # 1. Twilio
        event_bus_mcp_server.publish_event(
            event_type="mcp_action_executed",
            payload={"booking_id": payload["booking_id"], "action": "twilio_confirmation_sent"},
            correlation_id=corr,
            source_mcp="twilio_mcp"
        )
        
        # 2. Cloudinary
        event_bus_mcp_server.publish_event(
            event_type="mcp_action_executed",
            payload={"booking_id": payload["booking_id"], "action": "cloudinary_media_optimized"},
            correlation_id=corr,
            source_mcp="cloudinary_mcp"
        )
        
        # 3. Semantic Memory
        event_bus_mcp_server.publish_event(
            event_type="user_session_started", # stores decayed session in memory
            payload={"booking_id": payload["booking_id"], "user_id": payload["customer_id"]},
            correlation_id=corr,
            source_mcp="memory_mcp"
        )
        
    def on_session_started(ev_type, payload, corr, src):
        flow_steps.append("memory_mcp.store_session")
        # Store session completed, updates surfer vectors in recommendation profile
        event_bus_mcp_server.publish_event(
            event_type="surf_quality_score_updated", # updates surfer recommendations
            payload={"user_id": payload["user_id"], "updated_preferences": "prime_ swell"},
            correlation_id=corr,
            source_mcp="recommendation_mcp"
        )
        
    def on_surf_quality_updated(ev_type, payload, corr, src):
        # We check if this was triggered during the booking flow or weather flow
        if "booking_" in corr:
            flow_steps.append("recommendation_mcp.update_profile")
            # Profile updated, booking confirmed completed!
            event_bus_mcp_server.publish_event(
                event_type="booking_confirmed",
                payload={"booking_id": "bk_1001", "status": "fully_confirmed"},
                correlation_id=corr,
                source_mcp="event_bus"
            )
            
    def on_booking_confirmed(ev_type, payload, corr, src):
        flow_steps.append("booking_confirmed")
        
    # Register callbacks to central spine
    event_bus_mcp_server.register_in_memory_handler("booking_created", on_booking_created)
    event_bus_mcp_server.register_in_memory_handler("payment_initiated", on_payment_initiated)
    event_bus_mcp_server.register_in_memory_handler("payment_success", on_payment_success)
    event_bus_mcp_server.register_in_memory_handler("user_session_started", on_session_started)
    event_bus_mcp_server.register_in_memory_handler("surf_quality_score_updated", on_surf_quality_updated)
    event_bus_mcp_server.register_in_memory_handler("booking_confirmed", on_booking_confirmed)
    
    # Publish starting trigger event
    event_bus_mcp_server.publish_event(
        event_type="booking_created",
        payload={"booking_id": "bk_1001", "user_id": "usr_surfer_55"},
        correlation_id=corr_id,
        source_mcp="woocommerce_mcp"
    )
    
    # Assert sequence completed
    assert "calendar_mcp.reserve_slot" in flow_steps
    assert "stripe_mcp.create_payment" in flow_steps
    assert "payment_success_receivers" in flow_steps
    assert "memory_mcp.store_session" in flow_steps
    assert "recommendation_mcp.update_profile" in flow_steps
    assert "booking_confirmed" in flow_steps
    
    # Audit chronological event flow trace
    trace = event_bus_mcp_server.get_event_flow_trace(corr_id)
    assert len(trace) >= 7
    for e in trace:
        assert e["correlation_id"] == corr_id
        
    # Chronological checks
    assert trace[0]["event_type"] == "booking_created"
    assert trace[-1]["event_type"] == "booking_confirmed"
    
    print("✓ Flow 1 (Booking Lifecycle Decoupled Event Chain) verified successfully!")

def test_flow_2_weather_intelligence():
    """
    Verify FLOW 2: WEATHER -> BUSINESS INTELLIGENCE
    weather_updated →
      world_model_mcp.compute_surf_score →
      surf_quality_score_updated →
      recommendation_mcp.update_surf_suggestions →
      dynamic_pricing_mcp.suggest_adjustment →
      notification_mcp.alert_users
    """
    seed_test_db()
    corr_id = f"corr_weather_{uuid.uuid4().hex[:8]}"
    flow_steps = []
    
    def on_weather_updated(ev_type, payload, corr, src):
        flow_steps.append("world_model_mcp.compute_surf_score")
        # Computes derived score and publishes score updated
        event_bus_mcp_server.publish_event(
            event_type="surf_quality_score_updated",
            payload={"spot_name": payload["spot_name"], "quality_score": 85.0},
            correlation_id=corr,
            source_mcp="world_model_mcp"
        )
        
    def on_surf_score_updated(ev_type, payload, corr, src):
        # Dispatches updates to Recommendation engine, Dynamic pricing suggestor, and Notification systems
        if "weather_" in corr:
            flow_steps.append("downstream_subscribers")
            # 1. Recommendation suggestions
            event_bus_mcp_server.publish_event(
                event_type="mcp_action_executed",
                payload={"action": "recommendations_updated", "spot_name": payload["spot_name"]},
                correlation_id=corr,
                source_mcp="recommendation_mcp"
            )
            # 2. Dynamic pricing adjustments
            event_bus_mcp_server.publish_event(
                event_type="mcp_action_executed",
                payload={"action": "suggested_pricing_multiplier", "multiplier": 1.25},
                correlation_id=corr,
                source_mcp="pricing_mcp"
            )
            # 3. Notification push triggers
            event_bus_mcp_server.publish_event(
                event_type="mcp_action_executed",
                payload={"action": "user_notified_of_swell"},
                correlation_id=corr,
                source_mcp="notification_mcp"
            )
            
    # Register callbacks
    event_bus_mcp_server.register_in_memory_handler("weather_updated", on_weather_updated)
    event_bus_mcp_server.register_in_memory_handler("surf_quality_score_updated", on_surf_score_updated)
    
    # Start weather update event
    event_bus_mcp_server.publish_event(
        event_type="weather_updated",
        payload={"spot_name": "Windansea", "swell_height_ft": 6.5, "swell_period_sec": 14},
        correlation_id=corr_id,
        source_mcp="world_model_mcp"
    )
    
    assert "world_model_mcp.compute_surf_score" in flow_steps
    assert "downstream_subscribers" in flow_steps
    
    trace = event_bus_mcp_server.get_event_flow_trace(corr_id)
    assert len(trace) >= 5
    assert trace[0]["event_type"] == "weather_updated"
    assert trace[1]["event_type"] == "surf_quality_score_updated"
    print("✓ Flow 2 (Weather to Business Intelligence Decoupled Loop) validated successfully!")

def test_flow_3_user_behavior_loop():
    """
    Verify FLOW 3: USER BEHAVIOR LOOP
    map_interaction →
      analytics_mcp.log_behavior →
      memory_mcp.update_user_profile →
      recommendation_mcp.adjust_results
    """
    seed_test_db()
    corr_id = f"corr_user_{uuid.uuid4().hex[:8]}"
    flow_steps = []
    
    def on_map_interaction(ev_type, payload, corr, src):
        flow_steps.append("analytics_mcp.log_behavior")
        event_bus_mcp_server.publish_event(
            event_type="user_session_ended", # serves as log marker
            payload={"user_id": payload["user_id"], "viewport": payload["viewport"]},
            correlation_id=corr,
            source_mcp="analytics_mcp"
        )
        
    def on_log_completed(ev_type, payload, corr, src):
        flow_steps.append("memory_mcp.update_user_profile")
        event_bus_mcp_server.publish_event(
            event_type="search_performed", # predicted preferences update
            payload={"user_id": payload["user_id"], "profile_preferences": "south_swell"},
            correlation_id=corr,
            source_mcp="memory_mcp"
        )
        
    def on_profile_updated(ev_type, payload, corr, src):
        flow_steps.append("recommendation_mcp.adjust_results")
        
    # Register callbacks
    event_bus_mcp_server.register_in_memory_handler("map_interaction", on_map_interaction)
    event_bus_mcp_server.register_in_memory_handler("user_session_ended", on_log_completed)
    event_bus_mcp_server.register_in_memory_handler("search_performed", on_profile_updated)
    
    # Start map interaction
    event_bus_mcp_server.publish_event(
        event_type="map_interaction",
        payload={"user_id": "usr_surfer_55", "viewport": "San Diego Coastal"},
        correlation_id=corr_id,
        source_mcp="geospatial_mcp"
    )
    
    assert "analytics_mcp.log_behavior" in flow_steps
    assert "memory_mcp.update_user_profile" in flow_steps
    assert "recommendation_mcp.adjust_results" in flow_steps
    print("✓ Flow 3 (User Behavior Logging & Recommendation Adjustment) verified successfully!")

def test_flow_4_qa_loop():
    """
    Verify FLOW 4: QA LOOP
    qa_failure_detected →
      event_bus.log_issue →
      mcp_error_analysis →
      fix_suggestion_generated
    """
    seed_test_db()
    corr_id = f"corr_qa_{uuid.uuid4().hex[:8]}"
    flow_steps = []
    
    def on_qa_failure(ev_type, payload, corr, src):
        flow_steps.append("event_bus.log_issue")
        event_bus_mcp_server.publish_event(
            event_type="mcp_error",
            payload={"error_code": payload["error_code"], "component": payload["component"]},
            correlation_id=corr,
            source_mcp="qa_agent_mcp"
        )
        
    def on_error_logged(ev_type, payload, corr, src):
        flow_steps.append("mcp_error_analysis")
        event_bus_mcp_server.publish_event(
            event_type="system_latency_detected", # diagnosis trace
            payload={"suggested_fix": "add_index_to_bookings_table", "latency_ms": 820.0},
            correlation_id=corr,
            source_mcp="operator_mcp"
        )
        
    def on_analysis_completed(ev_type, payload, corr, src):
        flow_steps.append("fix_suggestion_generated")
        
    # Register callbacks
    event_bus_mcp_server.register_in_memory_handler("qa_failure_detected", on_qa_failure)
    event_bus_mcp_server.register_in_memory_handler("mcp_error", on_error_logged)
    event_bus_mcp_server.register_in_memory_handler("system_latency_detected", on_analysis_completed)
    
    # Start QA failure trigger
    event_bus_mcp_server.publish_event(
        event_type="qa_failure_detected",
        payload={"error_code": "ERR_DATABASE_LOCKED", "component": "bookings_db_writer"},
        correlation_id=corr_id,
        source_mcp="qa_agent_mcp"
    )
    
    assert "event_bus.log_issue" in flow_steps
    assert "mcp_error_analysis" in flow_steps
    assert "fix_suggestion_generated" in flow_steps
    print("✓ Flow 4 (QA Auto-Diagnostic Loop) verified successfully!")

def test_time_range_event_replays():
    """Verify replay_events handles start_time and end_time filtering accurately"""
    seed_test_db()
    
    # Write events spaced by minor sleeping pauses (to guarantee chronological time spacing)
    # We construct ISO timestamps to do exact filtering audits
    
    base_time = datetime.now(timezone.utc)
    t1 = (base_time - timedelta(minutes=10)).isoformat().replace("+00:00", "Z")
    t2 = (base_time - timedelta(minutes=5)).isoformat().replace("+00:00", "Z")
    t3 = base_time.isoformat().replace("+00:00", "Z")
    
    conn = sqlite3.connect(event_bus_mcp_server.DB_PATH)
    cursor = conn.cursor()
    
    cursor.execute("""
    INSERT INTO event_log (event_id, event_type, payload, timestamp, correlation_id)
    VALUES 
    ('evt_101', 'bookings_created', '{"id": 1}', ?, 'corr_rep'),
    ('evt_102', 'weather_updated', '{"id": 2}', ?, 'corr_rep'),
    ('evt_103', 'payment_success', '{"id": 3}', ?, 'corr_rep')
    """, (t1, t2, t3))
    
    conn.commit()
    conn.close()
    
    # Replay all
    all_evts = event_bus_mcp_server.replay_events(event_type=None)
    assert len(all_evts) == 3
    
    # Filter by time range matching t2 only (from 7 mins ago to 3 mins ago)
    filter_start = (base_time - timedelta(minutes=7)).isoformat().replace("+00:00", "Z")
    filter_end = (base_time - timedelta(minutes=3)).isoformat().replace("+00:00", "Z")
    
    replayed = event_bus_mcp_server.replay_events(start_time=filter_start, end_time=filter_end)
    assert len(replayed) == 1
    assert replayed[0]["event_id"] == "evt_102"
    assert replayed[0]["event_type"] == "weather_updated"
    
    # Filter by type and time range
    replayed_type = event_bus_mcp_server.replay_events(event_type="payment_success", start_time=filter_start)
    assert len(replayed_type) == 1
    assert replayed_type[0]["event_id"] == "evt_103"
    
    print("✓ Replay events time-range queries validated successfully!")

if __name__ == "__main__":
    pytest.main([__file__, "-v"])
