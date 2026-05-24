"""
Integration Test Suite verifying the System Sync & Admin Control Layer Alignment requirements.
Tests the automated weather business loop, session completion flows, admin override/rejections,
and full end-to-end traceability.
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

def seed_sync_dbs():
    event_bus_mcp_server.init_db()
    operator_mcp_server.init_db()
    
    # 1. Clean Event Bus
    conn = sqlite3.connect(event_bus_mcp_server.DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    cursor.execute("DELETE FROM event_log")
    conn.commit()
    conn.close()
    
    # 2. Clean Operator Decisions
    conn = sqlite3.connect(operator_mcp_server.DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    cursor.execute("DELETE FROM operator_decisions")
    conn.commit()
    conn.close()

def test_weather_business_loop_triggers():
    """Verify weather_updated automatically spawns derived surf_quality_updated and alert proposals"""
    seed_sync_dbs()
    
    corr_id = f"corr_w_loop_{uuid.uuid4().hex[:8]}"
    spot = "Rincon"
    
    # 1. Publish weather_updated (Prime conditions)
    weather_payload = {
        "spot_name": spot,
        "swell_height_ft": 7.5,
        "swell_period_sec": 15,
        "wind_conditions": "Glassy Offshore",
        "tide_cycle": "rising"
    }
    event_bus_mcp_server.publish_event(
        event_type="weather_updated",
        payload=weather_payload,
        correlation_id=corr_id,
        source_mcp="world_model_mcp"
    )
    
    # 2. Verify that derived surf_quality_updated event was enqueued on the Event Spine
    recent_events = event_bus_mcp_server.get_recent_events(limit=10)
    
    quality_evt = next((e for e in recent_events if e["event_type"] == "surf_quality_updated"), None)
    assert quality_evt is not None
    assert quality_evt["correlation_id"] == corr_id
    assert quality_evt["payload"]["spot_name"] == spot
    assert quality_evt["payload"]["surf_quality_score"] >= 70.0
    
    # 3. Verify that a "Swell Prime Alert Campaign" was enqueued in the Admin Queue
    conn = sqlite3.connect(operator_mcp_server.DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
    SELECT decision_id, type, status, risk_level, expected_outcome, supporting_event_trace
    FROM operator_decisions WHERE type = 'promo_push'
    """)
    rows = cursor.fetchall()
    conn.close()
    
    assert len(rows) > 0
    alert_dec = rows[0]
    assert alert_dec[2] == "pending_approval"
    assert alert_dec[3] == "low"
    assert "photographer slots" in alert_dec[4]
    assert alert_dec[5] == corr_id
    
    print("✓ Derived Surf Quality calculation and Admin alert queueing verified successfully")

def test_surf_session_completion_flow():
    """Verify surf_session_completed enqueues gallery preparation, social content, and admin reviews"""
    seed_sync_dbs()
    
    corr_id = f"corr_session_comp_{uuid.uuid4().hex[:8]}"
    booking_id = "bk_surf_909"
    
    # 1. Publish surf_session_completed
    event_bus_mcp_server.publish_event(
        event_type="surf_session_completed",
        payload={"booking_id": booking_id, "photographer_id": "photo_john_01"},
        correlation_id=corr_id,
        source_mcp="calendar_mcp"
    )
    
    # 2. Verify downstream events published
    recent_events = event_bus_mcp_server.get_recent_events(limit=10)
    
    gallery_evt = next((e for e in recent_events if e["event_type"] == "photo_gallery_ready"), None)
    assert gallery_evt is not None
    assert gallery_evt["correlation_id"] == corr_id
    assert gallery_evt["payload"]["booking_id"] == booking_id
    
    social_evt = next((e for e in recent_events if e["event_type"] == "social_content_queued"), None)
    assert social_evt is not None
    assert social_evt["correlation_id"] == corr_id
    assert social_evt["payload"]["booking_id"] == booking_id
    
    review_evt = next((e for e in recent_events if e["event_type"] == "admin_review_requested"), None)
    assert review_evt is not None
    assert review_evt["correlation_id"] == corr_id
    
    # 3. Verify admin queue has "Social Gallery Post Approval" enqueued
    conn = sqlite3.connect(operator_mcp_server.DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
    SELECT decision_id, type, proposed_value, status, risk_level, expected_outcome, supporting_event_trace, recommendation_type
    FROM operator_decisions WHERE recommendation_type = 'social_post_approval'
    """)
    row = cursor.fetchone()
    conn.close()
    
    assert row is not None
    assert row[2] == booking_id
    assert row[3] == "pending_approval"
    assert row[4] == "low"
    assert "premium surfer highlight" in row[5].lower()
    assert row[6] == corr_id
    
    print("✓ Surf Session completed downstream automation pipeline verified successfully")

def test_admin_override_and_rejection_events():
    """Verify reject_decision and propose_booking_override tools emit exact production events"""
    seed_sync_dbs()
    
    corr_id = f"corr_admin_act_{uuid.uuid4().hex[:8]}"
    
    # 1. Propose and Execute Booking Override by Admin -> Should succeed and publish events
    override_res = operator_mcp_server.propose_booking_override(
        booking_id="bk_lesson_55",
        new_capacity=15,
        caller_role="admin",
        explanation="Peak glass wind crowd swell surge demand",
        correlation_id=corr_id
    )
    assert override_res["success"] is True
    assert override_res["status"] == "executed"
    
    # 2. Propose pricing adjustment to test rejection
    prop_res = operator_mcp_server.propose_pricing_change(
        spot_name="Malibu",
        proposed_price=135.0,
        explanation="Dynamic pricing shift",
        correlation_id=corr_id
    )
    decision_id = prop_res["decision_id"]
    
    # Reject the pricing adjustment by Admin -> Should succeed and publish event
    reject_res = operator_mcp_server.reject_decision(
        decision_id=decision_id,
        caller_role="admin",
        explanation="Price too high, reject for user conversion protection",
        correlation_id=corr_id
    )
    assert reject_res["success"] is True
    assert reject_res["status"] == "rejected"
    
    # 3. Query all enqueued events on Event Spine
    recent_events = event_bus_mcp_server.get_recent_events(limit=20)
    
    # Check overrides
    override_proposed_evt = next((e for e in recent_events if e["event_type"] == "admin_booking_override_event"), None)
    assert override_proposed_evt is not None
    assert override_proposed_evt["correlation_id"] == corr_id
    assert override_proposed_evt["payload"]["booking_id"] == "bk_lesson_55"
    assert override_proposed_evt["payload"]["proposed_capacity"] == 15
    
    override_exec_evt = next((e for e in recent_events if e["event_type"] == "admin_override_executed"), None)
    assert override_exec_evt is not None
    assert override_exec_evt["correlation_id"] == corr_id
    assert override_exec_evt["payload"]["booking_id"] == "bk_lesson_55"
    assert override_exec_evt["payload"]["new_capacity"] == 15
    
    # Check rejections
    rejection_evt = next((e for e in recent_events if e["event_type"] == "admin_action_rejected"), None)
    assert rejection_evt is not None
    assert rejection_evt["correlation_id"] == corr_id
    assert rejection_evt["payload"]["decision_id"] == decision_id
    assert rejection_evt["payload"]["recommendation_type"] == "pricing_adjustment"
    assert rejection_evt["payload"]["rejected_by"] == "admin"
    
    print("✓ Granular admin overrides and rejections events fully mapped and published")

def test_e2e_traceability_correlation():
    """Verify full booking -> payment -> session -> media -> social -> engagement correlation chain"""
    seed_sync_dbs()
    
    corr_id = f"corr_e2e_flow_{uuid.uuid4().hex[:8]}"
    booking_id = "b_e2e_100"
    user_id = "usr_surfer_pro"
    
    # Step 1: User Books Lesson -> Emit booking_created
    event_bus_mcp_server.publish_event(
        event_type="booking_created",
        payload={"booking_id": booking_id, "amount": 120.0},
        correlation_id=corr_id,
        source_service="woocommerce_mcp",
        user_id=user_id
    )
    
    # Step 2: Stripe Payment Success -> Emit payment_success
    event_bus_mcp_server.publish_event(
        event_type="payment_success",
        payload={"booking_id": booking_id, "payment_intent_id": "pi_strip_882"},
        correlation_id=corr_id,
        source_service="stripe_mcp",
        user_id=user_id
    )
    
    # Step 3: Google Calendar Reservation -> Emit booking_confirmed
    event_bus_mcp_server.publish_event(
        event_type="booking_confirmed",
        payload={"booking_id": booking_id, "start_time": "2026-05-24T15:00:00Z"},
        correlation_id=corr_id,
        source_service="google_calendar_mcp",
        user_id=user_id
    )
    
    # Step 4: Surf Session Completed -> Emit surf_session_completed
    # This WILL automatically trigger gallery, social enqueuing and admin review request!
    event_bus_mcp_server.publish_event(
        event_type="surf_session_completed",
        payload={"booking_id": booking_id},
        correlation_id=corr_id,
        source_service="google_calendar_mcp",
        user_id=user_id
    )
    
    # Step 5: Admin Approves social post -> Emit admin_action_approved
    conn = sqlite3.connect(operator_mcp_server.DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT decision_id FROM operator_decisions WHERE proposed_value = ? AND recommendation_type = 'social_post_approval'", (booking_id,))
    row = cursor.fetchone()
    conn.close()
    
    assert row is not None
    decision_id = row[0]
    
    operator_mcp_server.execute_decision(
        decision_id=decision_id,
        caller_role="admin",
        correlation_id=corr_id
    )
    
    # Retrieve the complete chronological event flow trace
    trace = event_bus_mcp_server.get_event_flow_trace(corr_id)
    
    event_types_sequence = [evt["event_type"] for evt in trace]
    
    assert "booking_created" in event_types_sequence
    assert "payment_success" in event_types_sequence
    assert "booking_confirmed" in event_types_sequence
    assert "surf_session_completed" in event_types_sequence
    assert "photo_gallery_ready" in event_types_sequence
    assert "social_content_queued" in event_types_sequence
    assert "admin_review_requested" in event_types_sequence
    assert "admin_action_approved" in event_types_sequence
    
    # Chronological checks
    assert event_types_sequence[0] == "booking_created"
    assert event_types_sequence[-1] in ("admin_approved_action", "admin_action_approved")
    
    print("✓ Full End-To-End Traceability (Booking -> Payment -> Completion -> Media -> Social) successfully mapped!")

if __name__ == "__main__":
    pytest.main([__file__, "-v"])
