import sys
import json
import sqlite3
import uuid
import os
from datetime import datetime, timezone

# SQLite Operator Decisions Database Path
DB_PATH = "C:\\Users\\dprit\\Raw-Surf\\backend\\operator_decisions.db"

def init_db():
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    
    # 1. Operator Decisions Table (Refactored to track correlation_id)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS operator_decisions (
        decision_id TEXT PRIMARY KEY,
        type TEXT NOT NULL, -- 'pricing_adjustment', 'booking_status', 'promo_push', 'cancellation'
        spot_name TEXT,
        proposed_value TEXT,
        status TEXT NOT NULL, -- 'pending_approval', 'approved', 'rejected', 'executed'
        explanation TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        caller_role TEXT,
        execution_timestamp TEXT,
        execution_result TEXT, -- JSON string with details of Stripe/Calendar/Supabase integrations
        correlation_id TEXT
    )
    """)
    
    # Dynamic Migrations
    cursor.execute("PRAGMA table_info(operator_decisions)")
    cols = [col[1] for col in cursor.fetchall()]
    if "correlation_id" not in cols:
        cursor.execute("ALTER TABLE operator_decisions ADD COLUMN correlation_id TEXT")
        
    conn.commit()
    conn.close()

# 1. Monitor System State
def monitor_system_state(spot_name):
    # Standard realistic weather defaults
    swell_height = 5.5
    swell_period = 14
    wind_speed = 8.0
    wind_direction = "Light Offshore"
    tide_cycle = "rising"
    
    # PURE EVENT SPINE QUERY: completely decoupled, no raw world model SQLite DB connection
    try:
        import event_bus_mcp_server
        recent_weather = event_bus_mcp_server.get_recent_events(event_type="weather_updated", limit=50)
        # Find matching weather for the target spot
        spot_weather = next((w for w in recent_weather if w["payload"].get("spot_name") == spot_name), None)
        if spot_weather:
            w_pay = spot_weather["payload"]
            swell_height = float(w_pay.get("swell_height_ft", swell_height))
            swell_period = int(w_pay.get("swell_period_sec", swell_period))
            wind_speed = float(w_pay.get("wind_speed_mph", wind_speed))
            wind_direction = w_pay.get("wind_conditions", wind_direction)
            tide_cycle = w_pay.get("tide_cycle", tide_cycle)
    except Exception as e:
        sys.stderr.write(f"Warning querying event bus for weather: {str(e)}\n")
        sys.stderr.flush()

    # Determine booking demand based on surf quality indicators
    is_prime = (swell_height >= 4.0 and swell_period >= 12 and "offshore" in wind_direction.lower())
    is_poor = (swell_height < 3.0 or "onshore" in wind_direction.lower())
    
    if is_prime:
        demand = "high"
    elif is_poor:
        demand = "low"
    else:
        demand = "medium"

    # Photographer availability (simulated slots)
    photographer_availability = {
        "active_photographers": 3,
        "available_slots": 2,
        "status": "available" if is_prime else "restricted"
    }

    # Recommendations lists
    recommendations = []
    
    # Pricing recommendation
    if demand == "high":
        recommendations.append({
            "action": "adjust_pricing",
            "multiplier": 1.25,
            "proposed_price": 125.0,
            "rationale": f"High demand and prime swell of {swell_height}ft groom offshore wind peaks."
        })
    elif demand == "low":
        recommendations.append({
            "action": "adjust_pricing",
            "multiplier": 0.85,
            "proposed_price": 85.0,
            "rationale": f"Low demand due to poor {swell_height}ft waves or onshore wind clutter."
        })
    else:
        recommendations.append({
            "action": "adjust_pricing",
            "multiplier": 1.0,
            "proposed_price": 100.0,
            "rationale": "Moderate conditions. Standard baseline pricing recommended."
        })

    # Booking status recommendation
    if swell_height > 10.0:
        recommendations.append({
            "action": "close_bookings",
            "rationale": f"Severe warning: Swell height is {swell_height}ft which exceeds safe lessons limit of 10ft."
        })
    else:
        recommendations.append({
            "action": "open_bookings",
            "rationale": f"Safe wave heights of {swell_height}ft are ideal for standard lessons."
        })

    # Promotional push recommendation
    if is_prime:
        recommendations.append({
            "action": "promo_push",
            "campaign": f"Epic Surf {spot_name}",
            "rationale": "Prime glassy offshore sets matching premium photographer slot availability."
        })

    return {
        "spot_name": spot_name,
        "weather_conditions": {
            "swell_height_ft": swell_height,
            "swell_period_sec": swell_period,
            "wind_speed_mph": wind_speed,
            "wind_direction": wind_direction,
            "tide_cycle": tide_cycle
        },
        "booking_demand": demand.upper(),
        "photographer_availability": photographer_availability,
        "recommendations": recommendations
    }

# 2. Propose Pricing Change
def propose_pricing_change(spot_name, proposed_price, explanation, correlation_id=None):
    init_db()
    
    price_val = float(proposed_price)
    if price_val < 30.0 or price_val > 200.0:
        return {
            "success": False,
            "error": "Proposed price out of safe operational bounds ($30.0 - $200.0)."
        }

    decision_id = f"dec_price_{uuid.uuid4().hex[:8]}"
    timestamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO operator_decisions (decision_id, type, spot_name, proposed_value, status, explanation, timestamp, correlation_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (decision_id, "pricing_adjustment", spot_name, str(price_val), "pending_approval", explanation, timestamp, correlation_id))
    
    conn.commit()
    conn.close()
    
    return {
        "success": True,
        "decision_id": decision_id,
        "status": "pending_approval",
        "explanation_logged": True,
        "proposed_price": price_val,
        "correlation_id": correlation_id
    }

# 3. Propose Safety Cancellation
def propose_cancellation(event_id, explanation, swell_height_ft=None, correlation_id=None):
    init_db()
    
    s_height = swell_height_ft
    if s_height is None:
        s_height = 5.5 # default moderate
        # Decoupled weather lookup via Event Spine
        try:
            import event_bus_mcp_server
            recent = event_bus_mcp_server.get_recent_events(event_type="weather_updated", limit=1)
            if recent:
                s_height = float(recent[0]["payload"].get("swell_height_ft", 5.5))
        except:
            pass
                
    # Safety Threshold Validation Check
    if s_height <= 10.0:
        return {
            "success": False,
            "error": f"Safety cancellation rejected: Swell height ({s_height}ft) is below the critical 10.0ft safety limit."
        }

    decision_id = f"dec_cancel_{uuid.uuid4().hex[:8]}"
    timestamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO operator_decisions (decision_id, type, proposed_value, status, explanation, timestamp, correlation_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (decision_id, "cancellation", str(event_id), "pending_approval", f"[SAFETY VALIDATED - Swell: {s_height}ft] {explanation}", timestamp, correlation_id))
    
    conn.commit()
    conn.close()
    
    return {
        "success": True,
        "decision_id": decision_id,
        "status": "pending_approval",
        "explanation_logged": True,
        "safety_threshold_validated": True,
        "correlation_id": correlation_id
    }

# 4. Execute approved decision with Gates
def execute_decision(decision_id, caller_role, correlation_id=None):
    init_db()
    
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    cursor.execute("""
    SELECT decision_id, type, spot_name, proposed_value, status, explanation, timestamp 
    FROM operator_decisions WHERE decision_id = ?
    """, (decision_id,))
    row = cursor.fetchone()
    
    if not row:
        conn.close()
        return {"success": False, "error": f"Decision {decision_id} not found."}
        
    dec_id, dec_type, spot, value, status, explanation, ts = row
    
    if status != "pending_approval":
        conn.close()
        return {"success": False, "error": f"Decision is already in '{status}' status."}
        
    # GATES ENFORCEMENT
    if dec_type == "pricing_adjustment" and caller_role != "admin":
        conn.close()
        return {
            "success": False,
            "error": "Unauthorized execution attempt: Pricing changes require admin approval."
        }
        
    # Execute and sync with simulated integrations (Stripe, Calendar, Supabase)
    exec_ts = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    
    integration_results = {
        "stripe_sync": {
            "status": "synchronized",
            "message": "Stripe checkout pricing multipliers applied." if dec_type == "pricing_adjustment" else "Stripe customer booking fee refunded."
        },
        "calendar_sync": {
            "status": "synchronized",
            "message": "Google Calendar slot reservation updated." if dec_type == "pricing_adjustment" else "Google Calendar photographer booking slot canceled."
        },
        "supabase_sync": {
            "status": "synchronized",
            "message": f"Supabase sync: Operator decision trail successfully committed. Audit: {explanation}"
        }
    }
    
    cursor.execute("""
    UPDATE operator_decisions 
    SET status = 'executed', caller_role = ?, execution_timestamp = ?, execution_result = ?, correlation_id = ?
    WHERE decision_id = ?
    """, (caller_role, exec_ts, json.dumps(integration_results), correlation_id, decision_id))
    
    conn.commit()
    conn.close()
    
    return {
        "success": True,
        "decision_id": decision_id,
        "status": "executed",
        "caller_role": caller_role,
        "execution_timestamp": exec_ts,
        "execution_result": integration_results,
        "correlation_id": correlation_id
    }

# 5. Query decision history
def get_operator_decision_history():
    init_db()
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    cursor.execute("""
    SELECT decision_id, type, spot_name, proposed_value, status, explanation, timestamp, caller_role, execution_timestamp, execution_result, correlation_id 
    FROM operator_decisions ORDER BY timestamp DESC
    """)
    rows = cursor.fetchall()
    conn.close()
    
    history = []
    for r in rows:
        exec_res = None
        if r[9]:
            try:
                exec_res = json.loads(r[9])
            except:
                pass
        history.append({
            "decision_id": r[0],
            "type": r[1],
            "spot_name": r[2],
            "proposed_value": r[3],
            "status": r[4],
            "explanation": r[5],
            "timestamp": r[6],
            "caller_role": r[7],
            "execution_timestamp": r[8],
            "execution_result": exec_res,
            "correlation_id": r[10]
        })
    return history

# JSON-RPC MCP stdio loop
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
                            "name": "autonomous-operator-mcp",
                            "version": "2.0.0"
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
                                "name": "monitor_system_state",
                                "description": "Monitor weather conditions, demand, and photographer availability to formulate recommendations.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "spot_name": {"type": "string", "description": "Target beach spot name"}
                                    },
                                    "required": ["spot_name"]
                                }
                            },
                            {
                                "name": "propose_pricing_change",
                                "description": "Propose a dynamic price adjustment. Proposed value must be within safe bounds ($30.0 - $200.0) and requires explanation logs.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "spot_name": {"type": "string"},
                                        "proposed_price": {"type": "number"},
                                        "explanation": {"type": "string"},
                                        "correlation_id": {"type": "string", "description": "Causal trace correlation UUID"}
                                    },
                                    "required": ["spot_name", "proposed_price", "explanation"]
                                }
                            },
                            {
                                "name": "propose_cancellation",
                                "description": "Propose a booking cancellation. Validates swell height (> 10.0ft safety limits required) and records logs.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "event_id": {"type": "string"},
                                        "explanation": {"type": "string"},
                                        "swell_height_ft": {"type": "number", "description": "Optional swell height to validate. If omitted, uses world model lookup."},
                                        "correlation_id": {"type": "string", "description": "Causal trace correlation UUID"}
                                    },
                                    "required": ["event_id", "explanation"]
                                }
                            },
                            {
                                "name": "execute_decision",
                                "description": "Execute an enqueued decision under strict safety/role verification gates. Pricing requires caller_role = admin.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "decision_id": {"type": "string"},
                                        "caller_role": {"type": "string", "enum": ["admin", "moderator", "user"]},
                                        "correlation_id": {"type": "string", "description": "Causal trace correlation UUID"}
                                    },
                                    "required": ["decision_id", "caller_role"]
                                }
                            },
                            {
                                "name": "get_operator_decision_history",
                                "description": "Query detailed decision audits history logs.",
                                "inputSchema": {
                                    "type": "object"
                                }
                            }
                        ]
                    }
                }
                
            elif method == "tools/call":
                tool_name = params.get("name")
                args = params.get("arguments", {})
                
                if tool_name == "monitor_system_state":
                    spot = args.get("spot_name")
                    res = monitor_system_state(spot)
                    text_out = json.dumps(res, indent=2)
                    
                elif tool_name == "propose_pricing_change":
                    spot = args.get("spot_name")
                    price = args.get("proposed_price")
                    expl = args.get("explanation")
                    corr = args.get("correlation_id")
                    res = propose_pricing_change(spot, price, expl, corr)
                    text_out = json.dumps(res, indent=2)
                    
                elif tool_name == "propose_cancellation":
                    ev_id = args.get("event_id")
                    expl = args.get("explanation")
                    sh = args.get("swell_height_ft")
                    corr = args.get("correlation_id")
                    res = propose_cancellation(ev_id, expl, sh, corr)
                    text_out = json.dumps(res, indent=2)
                    
                elif tool_name == "execute_decision":
                    dec = args.get("decision_id")
                    role = args.get("caller_role")
                    corr = args.get("correlation_id")
                    res = execute_decision(dec, role, corr)
                    text_out = json.dumps(res, indent=2)
                    
                elif tool_name == "get_operator_decision_history":
                    res = get_operator_decision_history()
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
