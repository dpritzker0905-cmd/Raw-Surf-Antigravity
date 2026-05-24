"""
Test suite for google_calendar_mcp_server.py
Verifies provider calendars seeding, availability slot checks, interval conflict overlap prevention, booking creation, cancellation, rescheduling, and JSON-RPC stdio.
"""
import os
import sys
import json
import sqlite3
import pytest
from io import StringIO

# Add backend directory to sys.path to allow importing from google_calendar_mcp_server
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

import google_calendar_mcp_server

# Initialize database
google_calendar_mcp_server.init_db()

def seed_test_db():
    conn = sqlite3.connect(google_calendar_mcp_server.DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    # Clear test rows to maintain absolute idempotency
    cursor.execute("DELETE FROM provider_calendars WHERE provider_id IN ('prov_coach_01', 'prov_photog_02')")
    cursor.execute("DELETE FROM calendar_events WHERE provider_id IN ('prov_coach_01', 'prov_photog_02')")
    
    # Insert provider calendars
    providers_seed = [
        ("prov_coach_01", "Kai Surf-Master", "kai_coach@surf.com", "instructor", "America/Los_Angeles", "2026-05-24T00:00:00Z"),
        ("prov_photog_02", "Shaka Clicker", "photog_one@surf.com", "photographer", "America/Los_Angeles", "2026-05-24T00:00:00Z")
    ]
    cursor.executemany("""
    INSERT INTO provider_calendars (provider_id, name, email, role, timezone, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    """, providers_seed)
    
    # Insert one pre-existing event for Kai
    events_seed = [
        ("evt_test_01", "prov_coach_01", "Private Surf Lesson - Malibu", "1-Hour Lesson", "2026-05-24T15:00:00Z", "2026-05-24T16:00:00Z", "America/Los_Angeles", "cus_novice_882", "confirmed", "2026-05-24T00:00:00Z")
    ]
    cursor.executemany("""
    INSERT INTO calendar_events (event_id, provider_id, summary, description, start_time, end_time, timezone, customer_id, booking_status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, events_seed)
    
    conn.commit()
    conn.close()

def test_check_availability_no_conflict():
    seed_test_db()
    
    # Slot starting right after the seeded event (No Conflict)
    res = google_calendar_mcp_server.calendar_check_availability(
        provider_id="prov_coach_01",
        start_iso="2026-05-24T16:00:00Z",
        end_iso="2026-05-24T17:00:00Z"
    )
    assert res["is_available"] is True
    assert res["provider_id"] == "prov_coach_01"
    print("✓ Successfully checked availability with no conflict")

def test_check_availability_has_conflict():
    seed_test_db()
    
    # Slot overlapping with the seeded event (15:00 to 16:00 UTC)
    res = google_calendar_mcp_server.calendar_check_availability(
        provider_id="prov_coach_01",
        start_iso="2026-05-24T15:30:00Z",
        end_iso="2026-05-24T16:30:00Z"
    )
    assert res["is_available"] is False
    assert "conflict_details" in res
    assert "Overlaps with existing slot" in res["conflict_details"]
    print("✓ Successfully prevented conflict overlap via availability checker")

def test_create_booking_success():
    seed_test_db()
    
    res = google_calendar_mcp_server.calendar_create_booking(
        provider_id="prov_coach_01",
        customer_id="cus_surf_new",
        summary="Advanced Surf Coaching",
        description="2-Hour Intermediate Session",
        start_iso="2026-05-24T17:00:00Z",
        end_iso="2026-05-24T19:00:00Z",
        tz="America/Los_Angeles"
    )
    
    assert "event_id" in res
    assert res["booking_status"] == "confirmed"
    assert res["sync_status"] == "synchronized_with_supabase"
    assert res["reminder_workflow"]["workflow_triggered"] is True
    
    # Double check that database contains this event now
    conn = sqlite3.connect(google_calendar_mcp_server.DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    cursor.execute("SELECT customer_id, summary FROM calendar_events WHERE event_id = ?", (res["event_id"],))
    row = cursor.fetchone()
    conn.close()
    
    assert row is not None
    assert row[0] == "cus_surf_new"
    assert row[1] == "Advanced Surf Coaching"
    print("✓ Successfully created booking and verified Supabase/SQLite sync")

def test_create_booking_conflict():
    seed_test_db()
    
    # Attempt to create booking on an overlapping slot (15:15 to 15:45 UTC)
    res = google_calendar_mcp_server.calendar_create_booking(
        provider_id="prov_coach_01",
        customer_id="cus_surf_bad",
        summary="Double Book Session",
        description="Should Fail",
        start_iso="2026-05-24T15:15:00Z",
        end_iso="2026-05-24T15:45:00Z",
        tz="America/Los_Angeles"
    )
    
    assert res["success"] is False
    assert res["error"] == "Scheduling Conflict Detected"
    print("✓ Successfully blocked conflict booking creation")

def test_cancel_booking():
    seed_test_db()
    
    res = google_calendar_mcp_server.calendar_cancel_booking("evt_test_01")
    assert res["booking_status"] == "canceled"
    assert res["event_id"] == "evt_test_01"
    
    # Ensure availability check is now free for this slot
    avail = google_calendar_mcp_server.calendar_check_availability(
        provider_id="prov_coach_01",
        start_iso="2026-05-24T15:00:00Z",
        end_iso="2026-05-24T16:00:00Z"
    )
    assert avail["is_available"] is True
    print("✓ Successfully canceled booking and freed up the slot")

def test_reschedule_booking():
    seed_test_db()
    
    # Reschedule evt_test_01 from (15-16 UTC) to (20-21 UTC)
    res = google_calendar_mcp_server.calendar_reschedule_booking(
        event_id="evt_test_01",
        new_start_iso="2026-05-24T20:00:00Z",
        new_end_iso="2026-05-24T21:00:00Z"
    )
    assert res["booking_status"] == "rescheduled"
    assert res["new_time_slot"]["start_time_utc"] == "2026-05-24T20:00:00Z"
    
    # Old slot should now be available
    avail = google_calendar_mcp_server.calendar_check_availability(
        provider_id="prov_coach_01",
        start_iso="2026-05-24T15:00:00Z",
        end_iso="2026-05-24T16:00:00Z"
    )
    assert avail["is_available"] is True
    print("✓ Successfully rescheduled booking and freed the old slot")

def test_get_provider_schedule():
    seed_test_db()
    
    schedule = google_calendar_mcp_server.get_provider_events("prov_coach_01")
    assert len(schedule) == 1
    assert schedule[0]["event_id"] == "evt_test_01"
    assert schedule[0]["summary"] == "Private Surf Lesson - Malibu"
    print("✓ Successfully queried active provider schedules")

def test_json_rpc_initialize():
    # Simulate a JSON-RPC stdio initialization and tools/list protocol trace
    input_str = json.dumps({
        "jsonrpc": "2.0",
        "id": 42,
        "method": "initialize",
        "params": {}
    }) + "\n"
    
    old_stdin = sys.stdin
    old_stdout = sys.stdout
    sys.stdin = StringIO(input_str)
    sys.stdout = StringIO()
    
    try:
        google_calendar_mcp_server.main()
        output_str = sys.stdout.getvalue()
    finally:
        sys.stdin = old_stdin
        sys.stdout = old_stdout
        
    response = json.loads(output_str.strip())
    assert response["jsonrpc"] == "2.0"
    assert response["id"] == 42
    assert "capabilities" in response["result"]
    assert response["result"]["serverInfo"]["name"] == "google-calendar-mcp"
    print("✓ JSON-RPC google-calendar-mcp Initialize verified successfully")

if __name__ == "__main__":
    pytest.main([__file__, "-v"])
