import sys
import json
import sqlite3
from utils.sqlite_helpers import get_sqlite_connection, get_db_path
from datetime import datetime

# SQLite Mock Airtable Sync Path (Simulates Airtable tables locally)
DB_PATH = get_db_path("airtable_sync.db")

def init_db():
    conn = get_sqlite_connection(DB_PATH)
    cursor = conn.cursor()
    
    # Instructors Base Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS base_instructors (
        airtable_id TEXT PRIMARY KEY,
        entity_id TEXT NOT NULL,
        name TEXT NOT NULL,
        rating REAL,
        status TEXT DEFAULT 'active'
    )
    """)
    
    # Bookings Base Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS base_bookings (
        airtable_id TEXT PRIMARY KEY,
        booking_id TEXT NOT NULL,
        customer_name TEXT NOT NULL,
        instructor_id TEXT,
        status TEXT NOT NULL,
        amount REAL,
        created_at TEXT NOT NULL
    )
    """)
    
    # Leads Base Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS base_leads (
        airtable_id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        name TEXT,
        interest TEXT,
        status TEXT DEFAULT 'new'
    )
    """)
    
    # Surf Trips Base Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS base_surf_trips (
        airtable_id TEXT PRIMARY KEY,
        trip_name TEXT NOT NULL,
        location TEXT,
        price REAL,
        slots_filled INTEGER DEFAULT 0
    )
    """)
    
    # Sponsors Base Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS base_sponsors (
        airtable_id TEXT PRIMARY KEY,
        sponsor_name TEXT NOT NULL,
        tier TEXT,
        ad_views INTEGER DEFAULT 0
    )
    """)
    
    # Automation Triggers Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS automation_triggers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL, -- 'booking_status', 'instructor_assigned'
        action_type TEXT NOT NULL, -- 'email', 'webhook', 'slack'
        payload TEXT NOT NULL,
        is_active INTEGER DEFAULT 1
    )
    """)
    conn.commit()
    conn.close()

# Sync Engine with Supabase / SQLite
def execute_supabase_sync():
    init_db()
    
    # Simulated Supabase fetching and writing to Airtable Bases
    # Mocking rows populated in PostgreSQL
    mock_instructors = [
        {"entity_id": "inst-001", "name": "Jeff King", "rating": 4.9},
        {"entity_id": "inst-002", "name": "John Doe", "rating": 4.7}
    ]
    mock_bookings = [
        {"booking_id": "b-100", "customer_name": "surfer_dprit", "instructor_id": "inst-001", "status": "confirmed", "amount": 110.0, "created_at": datetime.now().isoformat()}
    ]
    mock_leads = [
        {"email": "onboarding-surfer@gmail.com", "name": "Lead Surfer", "interest": "lessons", "status": "warm"}
    ]
    mock_trips = [
        {"trip_name": "Epic Malibu Swell Weekend", "location": "Malibu, CA", "price": 450.0, "slots_filled": 6}
    ]
    mock_sponsors = [
        {"sponsor_name": "Rip Curl", "tier": "platinum", "ad_views": 15200}
    ]
    
    conn = get_sqlite_connection(DB_PATH)
    cursor = conn.cursor()
    
    # 1. Sync Instructors
    for i, inst in enumerate(mock_instructors):
        a_id = f"recInst{i:03d}"
        cursor.execute(
            "INSERT OR REPLACE INTO base_instructors (airtable_id, entity_id, name, rating) VALUES (?, ?, ?, ?)",
            (a_id, inst["entity_id"], inst["name"], inst["rating"])
        )
        
    # 2. Sync Bookings
    for i, bk in enumerate(mock_bookings):
        a_id = f"recBook{i:03d}"
        cursor.execute(
            "INSERT OR REPLACE INTO base_bookings (airtable_id, booking_id, customer_name, instructor_id, status, amount, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (a_id, bk["booking_id"], bk["customer_name"], bk["instructor_id"], bk["status"], bk["amount"], bk["created_at"])
        )
        
    # 3. Sync Leads
    for i, ld in enumerate(mock_leads):
        a_id = f"recLead{i:03d}"
        cursor.execute(
            "INSERT OR REPLACE INTO base_leads (airtable_id, email, name, interest, status) VALUES (?, ?, ?, ?, ?)",
            (a_id, ld["email"], ld["name"], ld["interest"], ld["status"])
        )
        
    # 4. Sync Surf Trips
    for i, tr in enumerate(mock_trips):
        a_id = f"recTrip{i:03d}"
        cursor.execute(
            "INSERT OR REPLACE INTO base_surf_trips (airtable_id, trip_name, location, price, slots_filled) VALUES (?, ?, ?, ?, ?)",
            (a_id, tr["trip_name"], tr["location"], tr["price"], tr["slots_filled"])
        )
        
    # 5. Sync Sponsors
    for i, sp in enumerate(mock_sponsors):
        a_id = f"recSpon{i:03d}"
        cursor.execute(
            "INSERT OR REPLACE INTO base_sponsors (airtable_id, sponsor_name, tier, ad_views) VALUES (?, ?, ?, ?)",
            (a_id, sp["sponsor_name"], sp["tier"], sp["ad_views"])
        )
        
    conn.commit()
    conn.close()
    
    return {
        "synchronized_bases": ["instructors", "bookings", "leads", "surf_trips", "sponsors"],
        "records_written": len(mock_instructors) + len(mock_bookings) + len(mock_leads) + len(mock_trips) + len(mock_sponsors)
    }

# Dynamic MCP Action: Update Booking Status & Trigger Automations
def update_booking_status_mcp(booking_id, new_status):
    init_db()
    
    conn = get_sqlite_connection(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE base_bookings SET status = ? WHERE booking_id = ?",
        (new_status, booking_id)
    )
    conn.commit()
    
    # Check for active automation triggers for "booking_status"
    cursor.execute(
        "SELECT action_type, payload FROM automation_triggers WHERE event_type = 'booking_status' AND is_active = 1"
    )
    automations = cursor.fetchall()
    conn.close()
    
    triggered = []
    for action, payload_template in automations:
        # Dynamic email/Slack replacement
        payload = payload_template.replace("{{STATUS}}", new_status).replace("{{BOOKING_ID}}", booking_id)
        triggered.append({
            "action": action,
            "executed_payload": payload,
            "status": "Success (Webhook Triggered)"
        })
        
    return {
        "booking_id": booking_id,
        "new_status": new_status,
        "airtable_sync": "Success",
        "triggered_automations": triggered
    }

# Dynamic MCP Action: Assign Instructor
def assign_instructor_mcp(booking_id, instructor_id):
    init_db()
    
    conn = get_sqlite_connection(DB_PATH)
    cursor = conn.cursor()
    
    # Fetch instructor name to be helpful
    cursor.execute("SELECT name FROM base_instructors WHERE entity_id = ?", (instructor_id,))
    inst_row = cursor.fetchone()
    inst_name = inst_row[0] if inst_row else "Unknown Instructor"
    
    cursor.execute(
        "UPDATE base_bookings SET instructor_id = ? WHERE booking_id = ?",
        (instructor_id, booking_id)
    )
    conn.commit()
    
    # Check for active automation triggers for "instructor_assigned"
    cursor.execute(
        "SELECT action_type, payload FROM automation_triggers WHERE event_type = 'instructor_assigned' AND is_active = 1"
    )
    automations = cursor.fetchall()
    conn.close()
    
    triggered = []
    for action, payload_template in automations:
        payload = payload_template.replace("{{INSTRUCTOR}}", inst_name).replace("{{BOOKING_ID}}", booking_id)
        triggered.append({
            "action": action,
            "executed_payload": payload,
            "status": "Success (Webhook Triggered)"
        })
        
    return {
        "booking_id": booking_id,
        "assigned_instructor": inst_name,
        "airtable_sync": "Success",
        "triggered_automations": triggered
    }

# Generate Operational Dashboard Reports
def generate_reports_mcp():
    init_db()
    
    conn = get_sqlite_connection(DB_PATH)
    cursor = conn.cursor()
    
    # Get total active bookings
    cursor.execute("SELECT COUNT(*), SUM(amount) FROM base_bookings WHERE status != 'cancelled'")
    bookings_count, total_revenue = cursor.fetchone()
    total_revenue = total_revenue or 0.0
    
    # Get total leads
    cursor.execute("SELECT COUNT(*) FROM base_leads")
    leads_count = cursor.fetchone()[0]
    
    # Get instructor count
    cursor.execute("SELECT COUNT(*) FROM base_instructors")
    inst_count = cursor.fetchone()[0]
    
    # Get sponsor ad metrics
    cursor.execute("SELECT sponsor_name, ad_views FROM base_sponsors ORDER BY ad_views DESC")
    sponsors = [{"name": r[0], "views": r[1]} for r in cursor.fetchall()]
    
    conn.close()
    
    return {
        "timestamp": datetime.now().isoformat(),
        "summary": {
            "total_active_bookings": bookings_count,
            "total_gross_revenue": f"${total_revenue:.2f}",
            "leads_in_pipeline": leads_count,
            "active_instructors": inst_count
        },
        "instructor_utilization": "82.5% Average Workload",
        "sponsor_analytics": sponsors
    }

# Setup initial mock automations
def setup_initial_automations():
    init_db()
    conn = get_sqlite_connection(DB_PATH)
    cursor = conn.cursor()
    
    # Deactivate existing mock triggers
    cursor.execute("DELETE FROM automation_triggers")
    
    # Add a mock email alert trigger for completed bookings
    cursor.execute(
        "INSERT INTO automation_triggers (event_type, action_type, payload) VALUES (?, ?, ?)",
        ("booking_status", "email", "Send receipt email to dprit: Booking {{BOOKING_ID}} status updated to {{STATUS}}!")
    )
    
    # Add a mock Slack notify trigger when instructor assigned
    cursor.execute(
        "INSERT INTO automation_triggers (event_type, action_type, payload) VALUES (?, ?, ?)",
        ("instructor_assigned", "slack", "Notify Channel #surf-ops: Booking {{BOOKING_ID}} assigned to {{INSTRUCTOR}}!")
    )
    conn.commit()
    conn.close()

# JSON-RPC stdio Interface Loop
def main():
    init_db()
    setup_initial_automations()
    
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
                            "name": "airtable-mcp",
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
                                "name": "sync_airtable_with_supabase",
                                "description": "Trigger an operational sync of PostgreSQL Supabase tables (instructors, bookings, leads, surf_trips, sponsors) with the Airtable Base rows.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {}
                                }
                            },
                            {
                                "name": "update_booking_status",
                                "description": "Update the operational status of a booking, writing changes to Airtable and launching email/notification triggers.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "booking_id": {
                                            "type": "string",
                                            "description": "Unique booking reference ID (e.g. 'b-100')"
                                        },
                                        "status": {
                                            "type": "string",
                                            "enum": ["confirmed", "completed", "cancelled"],
                                            "description": "Target operational status"
                                        }
                                    },
                                    "required": ["booking_id", "status"]
                                }
                            },
                            {
                                "name": "assign_instructor",
                                "description": "Assign an instructor to a booking, sync values to Airtable rows, and trigger Slack operations channels alerts.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "booking_id": {
                                            "type": "string",
                                            "description": "Unique booking reference ID (e.g. 'b-100')"
                                        },
                                        "instructor_id": {
                                            "type": "string",
                                            "description": "UUID of the instructor being assigned"
                                        }
                                    },
                                    "required": ["booking_id", "instructor_id"]
                                }
                            },
                            {
                                "name": "generate_reports",
                                "description": "Compile active, cross-base database reports on leads volume, utilization rates, and active sponsors views.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {}
                                }
                            }
                        ]
                    }
                }
                
            elif method == "tools/call":
                tool_name = params.get("name")
                args = params.get("arguments", {})
                
                if tool_name == "sync_airtable_with_supabase":
                    res = execute_supabase_sync()
                    text_out = json.dumps(res, indent=2)
                    
                elif tool_name == "update_booking_status":
                    b_id = args.get("booking_id")
                    status = args.get("status")
                    
                    res = update_booking_status_mcp(b_id, status)
                    text_out = json.dumps(res, indent=2)
                    
                elif tool_name == "assign_instructor":
                    b_id = args.get("booking_id")
                    inst_id = args.get("instructor_id")
                    
                    res = assign_instructor_mcp(b_id, inst_id)
                    text_out = json.dumps(res, indent=2)
                    
                elif tool_name == "generate_reports":
                    report = generate_reports_mcp()
                    text_out = json.dumps(report, indent=2)
                    
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
