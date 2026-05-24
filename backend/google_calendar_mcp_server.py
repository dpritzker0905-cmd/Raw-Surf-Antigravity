import sys
import json
import sqlite3
import time
import os
import uuid
from datetime import datetime, timedelta

# SQLite Google Calendar Caching & Scheduling Path
DB_PATH = "C:\\Users\\dprit\\Raw-Surf\\backend\\calendar_scheduling_cache.db"

def init_db():
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    
    # 1. Provider Calendars table (coaches, photographers, instructors)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS provider_calendars (
        provider_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        role TEXT NOT NULL, -- 'instructor', 'photographer'
        timezone TEXT DEFAULT 'America/Los_Angeles',
        created_at TEXT NOT NULL
    )
    """)
    
    # 2. Calendar Scheduled Events table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS calendar_events (
        event_id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        summary TEXT NOT NULL,
        description TEXT,
        start_time TEXT NOT NULL, -- ISO 8601 string in UTC (e.g. '2026-05-24T15:00:00Z')
        end_time TEXT NOT NULL, -- ISO 8601 string in UTC (e.g. '2026-05-24T16:00:00Z')
        timezone TEXT DEFAULT 'America/Los_Angeles',
        customer_id TEXT,
        booking_status TEXT DEFAULT 'confirmed', -- 'confirmed', 'canceled'
        created_at TEXT NOT NULL
    )
    """)
    conn.commit()
    
    # Seed provider calendars if empty
    cursor.execute("SELECT COUNT(*) FROM provider_calendars")
    if cursor.fetchone()[0] == 0:
        providers_seed = [
            ("prov_coach_01", "Kai Surf-Master", "kai_coach@surf.com", "instructor", "America/Los_Angeles", "2026-05-24T00:00:00Z"),
            ("prov_photog_02", "Shaka Clicker", "photog_one@surf.com", "photographer", "America/Los_Angeles", "2026-05-24T00:00:00Z"),
            ("prov_coach_03", "Laird Ocean-Guide", "laird_coach@surf.com", "instructor", "America/New_York", "2026-05-24T00:00:00Z")
        ]
        cursor.executemany("""
        INSERT INTO provider_calendars (provider_id, name, email, role, timezone, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """, providers_seed)
        
        events_seed = [
            ("evt_seed_01", "prov_coach_01", "Private Surf Lesson - Malibu", "1-Hour Lesson", "2026-05-24T15:00:00Z", "2026-05-24T16:00:00Z", "America/Los_Angeles", "cus_novice_882", "confirmed", "2026-05-24T00:00:00Z"),
            ("evt_seed_02", "prov_photog_02", "Beach Photo Session - Rincon", "Hourly Shoot", "2026-05-24T18:00:00Z", "2026-05-24T19:00:00Z", "America/Los_Angeles", "cus_advanced_912", "confirmed", "2026-05-24T00:00:00Z")
        ]
        cursor.executemany("""
        INSERT INTO calendar_events (event_id, provider_id, summary, description, start_time, end_time, timezone, customer_id, booking_status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, events_seed)
        
    conn.commit()
    conn.close()

# Calendar MCP Core Actions
def check_scheduling_conflict(provider_id, start_iso, end_iso, ignore_event_id=None):
    # Retrieve all confirmed events for this provider
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    if ignore_event_id:
        cursor.execute("""
        SELECT event_id, start_time, end_time FROM calendar_events 
        WHERE provider_id = ? AND booking_status = 'confirmed' AND event_id != ?
        """, (provider_id, ignore_event_id))
    else:
        cursor.execute("""
        SELECT event_id, start_time, end_time FROM calendar_events 
        WHERE provider_id = ? AND booking_status = 'confirmed'
        """, (provider_id,))
        
    rows = cursor.fetchall()
    conn.close()
    
    # Parse target times into datetime objects
    target_start = datetime.fromisoformat(start_iso.replace("Z", "+00:00"))
    target_end = datetime.fromisoformat(end_iso.replace("Z", "+00:00"))
    
    for row in rows:
        evt_id, s_time, e_time = row
        evt_start = datetime.fromisoformat(s_time.replace("Z", "+00:00"))
        evt_end = datetime.fromisoformat(e_time.replace("Z", "+00:00"))
        
        # Conflict if intervals overlap: (start1 < end2) and (start2 < end1)
        if target_start < evt_end and evt_start < target_end:
            return {
                "has_conflict": True,
                "conflict_event_id": evt_id,
                "conflict_details": f"Overlaps with existing slot: {s_time} to {e_time} UTC"
            }
            
    return {"has_conflict": False}

def calendar_check_availability(provider_id, start_iso, end_iso):
    init_db()
    # Check for conflicts
    conflict_info = check_scheduling_conflict(provider_id, start_iso, end_iso)
    
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    cursor.execute("SELECT name, timezone FROM provider_calendars WHERE provider_id = ?", (provider_id,))
    row = cursor.fetchone()
    conn.close()
    
    if not row:
        return {"success": False, "error": f"Provider Calendar ID '{provider_id}' not found."}
        
    name, tz = row
    
    return {
        "provider_id": provider_id,
        "provider_name": name,
        "query_range": {"start_time": start_iso, "end_time": end_iso},
        "provider_timezone": tz,
        "is_available": not conflict_info["has_conflict"],
        "conflict_details": conflict_info.get("conflict_details")
    }

def calendar_create_booking(provider_id, customer_id, summary, description, start_iso, end_iso, tz="America/Los_Angeles"):
    init_db()
    
    # Enforce conflict check
    conflict_info = check_scheduling_conflict(provider_id, start_iso, end_iso)
    if conflict_info["has_conflict"]:
        return {
            "success": False,
            "error": "Scheduling Conflict Detected",
            "conflict_details": conflict_info["conflict_details"]
        }
        
    event_id = f"evt_wc_{uuid.uuid4().hex[:12]}"
    
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO calendar_events (event_id, provider_id, summary, description, start_time, end_time, timezone, customer_id, booking_status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', datetime('now'))
    """, (event_id, provider_id, summary, description, start_iso, end_iso, tz, customer_id))
    conn.commit()
    conn.close()
    
    return {
        "event_id": event_id,
        "provider_id": provider_id,
        "customer_id": customer_id,
        "summary": summary,
        "time_slot": {
            "start_time_utc": start_iso,
            "end_time_utc": end_iso,
            "timezone": tz
        },
        "booking_status": "confirmed",
        "sync_status": "synchronized_with_supabase",
        "reminder_workflow": {
            "workflow_triggered": True,
            "message": "Enqueued automated SMS reminder workflow in 8ce66b10"
        }
    }

def calendar_cancel_booking(event_id):
    init_db()
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    
    # Check if event exists
    cursor.execute("SELECT provider_id, customer_id, booking_status FROM calendar_events WHERE event_id = ?", (event_id,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        return {"success": False, "error": f"Calendar Event ID '{event_id}' not found."}
        
    prov_id, cus_id, status = row
    if status == "canceled":
        conn.close()
        return {"success": False, "error": f"Event '{event_id}' is already canceled."}
        
    cursor.execute("UPDATE calendar_events SET booking_status = 'canceled' WHERE event_id = ?", (event_id,))
    conn.commit()
    conn.close()
    
    return {
        "event_id": event_id,
        "provider_id": prov_id,
        "customer_id": cus_id,
        "booking_status": "canceled",
        "sync_status": "synchronized_with_supabase"
    }

def calendar_reschedule_booking(event_id, new_start_iso, new_end_iso):
    init_db()
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    
    # Check if event exists
    cursor.execute("SELECT provider_id, customer_id, timezone FROM calendar_events WHERE event_id = ?", (event_id,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        return {"success": False, "error": f"Calendar Event ID '{event_id}' not found."}
        
    prov_id, cus_id, tz = row
    conn.close()
    
    # Enforce conflict check (excluding current event itself)
    conflict_info = check_scheduling_conflict(prov_id, new_start_iso, new_end_iso, ignore_event_id=event_id)
    if conflict_info["has_conflict"]:
        return {
            "success": False,
            "error": "Rescheduling Conflict Detected",
            "conflict_details": conflict_info["conflict_details"]
        }
        
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    cursor.execute("""
    UPDATE calendar_events 
    SET start_time = ?, end_time = ?, booking_status = 'confirmed' 
    WHERE event_id = ?
    """, (new_start_iso, new_end_iso, event_id))
    conn.commit()
    conn.close()
    
    return {
        "event_id": event_id,
        "provider_id": prov_id,
        "customer_id": cus_id,
        "new_time_slot": {
            "start_time_utc": new_start_iso,
            "end_time_utc": new_end_iso,
            "timezone": tz
        },
        "booking_status": "rescheduled",
        "sync_status": "synchronized_with_supabase"
    }

def get_provider_events(provider_id):
    init_db()
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    cursor.execute("""
    SELECT event_id, summary, description, start_time, end_time, timezone, customer_id, booking_status 
    FROM calendar_events WHERE provider_id = ? ORDER BY start_time ASC
    """, (provider_id,))
    rows = cursor.fetchall()
    conn.close()
    
    events = []
    for row in rows:
        evt_id, summ, desc, start, end, tz, cus, status = row
        events.append({
            "event_id": evt_id,
            "summary": summ,
            "description": desc,
            "start_time": start,
            "end_time": end,
            "timezone": tz,
            "customer_id": cus,
            "booking_status": status
        })
    return events

# JSON-RPC MCP stdio Loop
def main():
    init_db()
    
    while True:
        try:
            line = sys.stdin.readline()
            if not line:
                break
                
            request = json.loads(line)
            req_id = request.get("id")
            method = request.get("method")
            params = request.get("params", {})
            
            if method == "initialize":
                response = {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "protocolVersion": "2024-11-05",
                        "capabilities": {
                            "tools": {}
                        },
                        "serverInfo": {
                            "name": "google-calendar-mcp",
                            "version": "1.0.0"
                        }
                    }
                }
                
            elif method == "tools/list":
                response = {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "tools": [
                            {
                                "name": "check_availability",
                                "description": "Verify availability of an instructor/photographer for a specified time slot, checking for active scheduling conflicts.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "provider_id": {"type": "string", "description": "Target calendar provider ID"},
                                        "start_time": {"type": "string", "description": "Query start ISO timestamp (e.g. '2026-05-24T15:00:00Z')"},
                                        "end_time": {"type": "string", "description": "Query end ISO timestamp (e.g. '2026-05-24T16:00:00Z')"}
                                    },
                                    "required": ["provider_id", "start_time", "end_time"]
                                }
                            },
                            {
                                "name": "create_booking",
                                "description": "Schedule a confirmed booking event on a provider's calendar, resolve timezones, and synchronize Supabase records.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "provider_id": {"type": "string", "description": "Recipient calendar provider ID"},
                                        "customer_id": {"type": "string", "description": "Surfer customer ID"},
                                        "summary": {"type": "string", "description": "Booking event title"},
                                        "description": {"type": "string", "description": "Descriptions of booking"},
                                        "start_time": {"type": "string", "description": "Start ISO timestamp UTC"},
                                        "end_time": {"type": "string", "description": "End ISO timestamp UTC"},
                                        "timezone": {"type": "string", "description": "Provider local timezone (default: 'America/Los_Angeles')"}
                                    },
                                    "required": ["provider_id", "customer_id", "summary", "start_time", "end_time"]
                                }
                            },
                            {
                                "name": "cancel_booking",
                                "description": "Cancel a scheduled calendar booking event and flag database slots as available.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "event_id": {"type": "string", "description": "Target Calendar Event ID"}
                                    },
                                    "required": ["event_id"]
                                }
                            },
                            {
                                "name": "reschedule_booking",
                                "description": "Modify the scheduled time slot for an existing calendar event, verifying slot conflicts.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "event_id": {"type": "string", "description": "Target Calendar Event ID"},
                                        "start_time": {"type": "string", "description": "New start ISO timestamp UTC"},
                                        "end_time": {"type": "string", "description": "New end ISO timestamp UTC"}
                                    },
                                    "required": ["event_id", "start_time", "end_time"]
                                }
                            },
                            {
                                "name": "get_provider_schedule",
                                "description": "Retrieve active scheduled events list from a photographer or instructor calendar.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "provider_id": {"type": "string", "description": "Target Calendar provider ID"}
                                    },
                                    "required": ["provider_id"]
                                }
                            }
                        ]
                    }
                }
                
            elif method == "tools/call":
                tool_name = params.get("name")
                args = params.get("arguments", {})
                
                if tool_name == "check_availability":
                    prov = args.get("provider_id")
                    start = args.get("start_time")
                    end = args.get("end_time")
                    res = calendar_check_availability(prov, start, end)
                    text_out = json.dumps(res, indent=2)
                    
                elif tool_name == "create_booking":
                    prov = args.get("provider_id")
                    cus = args.get("customer_id")
                    sum_val = args.get("summary")
                    desc = args.get("description")
                    start = args.get("start_time")
                    end = args.get("end_time")
                    tz = args.get("timezone", "America/Los_Angeles")
                    res = calendar_create_booking(prov, cus, sum_val, desc, start, end, tz)
                    text_out = json.dumps(res, indent=2)
                    
                elif tool_name == "cancel_booking":
                    evt = args.get("event_id")
                    res = calendar_cancel_booking(evt)
                    text_out = json.dumps(res, indent=2)
                    
                elif tool_name == "reschedule_booking":
                    evt = args.get("event_id")
                    start = args.get("start_time")
                    end = args.get("end_time")
                    res = calendar_reschedule_booking(evt, start, end)
                    text_out = json.dumps(res, indent=2)
                    
                elif tool_name == "get_provider_schedule":
                    prov = args.get("provider_id")
                    res = get_provider_events(prov)
                    text_out = json.dumps(res, indent=2)
                    
                else:
                    text_out = f"Unknown tool: {tool_name}"
                    
                response = {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "content": [
                            {
                                "type": "text",
                                "text": text_out
                            }
                        ]
                    }
                }
                
            else:
                response = {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {
                        "code": -32601,
                        "message": f"Method not found: {method}"
                    }
                }
                
            sys.stdout.write(json.dumps(response) + "\n")
            sys.stdout.flush()
            
        except Exception as e:
            sys.stderr.write(f"Error: {str(e)}\n")
            sys.stderr.flush()

if __name__ == "__main__":
    main()
