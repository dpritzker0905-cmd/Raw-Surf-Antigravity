import sys
import json
import sqlite3
import uuid
import os
from datetime import datetime, timezone
from utils.sqlite_helpers import get_sqlite_connection, get_db_path

# SQLite Operator Decisions Database Path
DB_PATH = get_db_path("operator_decisions.db")

def init_db():
    conn = get_sqlite_connection(DB_PATH)
    cursor = conn.cursor()
    
    # 1. Operator Decisions Table
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
        correlation_id TEXT,
        recommendation_type TEXT,
        reasoning TEXT,
        supporting_event_trace TEXT,
        expected_outcome TEXT,
        risk_level TEXT,
        confidence_score REAL
    )
    """)
    
    # Dynamic Migrations: Check if columns exist and add them if not
    cursor.execute("PRAGMA table_info(operator_decisions)")
    cols = [col[1] for col in cursor.fetchall()]
    
    migrations = [
        ("correlation_id", "TEXT"),
        ("recommendation_type", "TEXT"),
        ("reasoning", "TEXT"),
        ("supporting_event_trace", "TEXT"),
        ("expected_outcome", "TEXT"),
        ("risk_level", "TEXT"),
        ("confidence_score", "REAL")
    ]
    
    for col_name, col_type in migrations:
        if col_name not in cols:
            cursor.execute(f"ALTER TABLE operator_decisions ADD COLUMN {col_name} {col_type}")
            
    conn.commit()
    conn.close()

# 1. Monitor System State (Enqueues recommendations into the Admin Queue)
def monitor_system_state(spot_name):
    init_db()
    
    # Standard realistic weather defaults
    swell_height = 5.5
    swell_period = 14
    wind_speed = 8.0
    wind_direction = "Light Offshore"
    tide_cycle = "rising"
    corr_id = f"corr_mon_{uuid.uuid4().hex[:8]}"
    
    # PURE EVENT SPINE QUERY
    try:
        import event_bus_mcp_server
        recent_weather = event_bus_mcp_server.get_recent_events(event_type="weather_updated", limit=50)
        spot_weather = next((w for w in recent_weather if w["payload"].get("spot_name") == spot_name), None)
        if spot_weather:
            w_pay = spot_weather["payload"]
            swell_height = float(w_pay.get("swell_height_ft", swell_height))
            swell_period = int(w_pay.get("swell_period_sec", swell_period))
            wind_speed = float(w_pay.get("wind_speed_mph", wind_speed))
            wind_direction = w_pay.get("wind_conditions", wind_direction)
            tide_cycle = w_pay.get("tide_cycle", tide_cycle)
            corr_id = spot_weather.get("correlation_id") or corr_id
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

    photographer_availability = {
        "active_photographers": 3,
        "available_slots": 2,
        "status": "available" if is_prime else "restricted"
    }

    recommendations = []
    
    # 1. Pricing recommendation
    if demand == "high":
        recommendations.append({
            "action": "adjust_pricing",
            "proposed_value": "125.0",
            "proposed_price": 125.0,
            "multiplier": 1.25,
            "rationale": f"High demand and prime swell of {swell_height}ft groom offshore wind peaks.",
            "expected_outcome": "Capture premium value and increase booking margins by 25%.",
            "risk_level": "low",
            "confidence_score": 92.0
        })
    elif demand == "low":
        recommendations.append({
            "action": "adjust_pricing",
            "proposed_value": "85.0",
            "proposed_price": 85.0,
            "multiplier": 0.85,
            "rationale": f"Low demand due to poor {swell_height}ft waves or onshore wind clutter.",
            "expected_outcome": "Stimulate conversion rates with a 15% discount.",
            "risk_level": "low",
            "confidence_score": 80.0
        })
    else:
        recommendations.append({
            "action": "adjust_pricing",
            "proposed_value": "100.0",
            "proposed_price": 100.0,
            "multiplier": 1.0,
            "rationale": "Moderate conditions. Standard baseline pricing recommended.",
            "expected_outcome": "Maintain normal baseline operations.",
            "risk_level": "low",
            "confidence_score": 95.0
        })

    # 2. Booking status recommendation
    if swell_height > 10.0:
        recommendations.append({
            "action": "close_bookings",
            "proposed_value": "close",
            "rationale": f"Severe warning: Swell height is {swell_height}ft which exceeds safe lessons limit of 10ft.",
            "expected_outcome": "Enforce water safety cancellations and prevent student accidents.",
            "risk_level": "high",
            "confidence_score": 99.0
        })
    else:
        recommendations.append({
            "action": "open_bookings",
            "proposed_value": "open",
            "rationale": f"Safe wave heights of {swell_height}ft are ideal for standard lessons.",
            "expected_outcome": "Keep lesson booking calendars open for surfers.",
            "risk_level": "low",
            "confidence_score": 95.0
        })

    # 3. Promotional push recommendation
    if is_prime:
        recommendations.append({
            "action": "promo_push",
            "proposed_value": f"Epic Surf {spot_name}",
            "rationale": "Prime glassy offshore sets matching premium photographer slot availability.",
            "expected_outcome": "Drive booking conversions during peak glassy surf windows.",
            "risk_level": "medium",
            "confidence_score": 85.0
        })

    # Enqueue recommendations in sqlite DB under pending_approval state
    conn = get_sqlite_connection(DB_PATH)
    cursor = conn.cursor()
    
    timestamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    for rec in recommendations:
        dec_id = f"dec_{rec['action']}_{uuid.uuid4().hex[:8]}"
        rec["decision_id"] = dec_id
        
        cursor.execute("""
        SELECT COUNT(*) FROM operator_decisions 
        WHERE spot_name = ? AND type = ? AND proposed_value = ? AND status = 'pending_approval'
        """, (spot_name, rec["action"], rec["proposed_value"]))
        if cursor.fetchone()[0] == 0:
            cursor.execute("""
            INSERT INTO operator_decisions (
                decision_id, type, spot_name, proposed_value, status, explanation, timestamp, correlation_id,
                recommendation_type, reasoning, supporting_event_trace, expected_outcome, risk_level, confidence_score
            ) VALUES (?, ?, ?, ?, 'pending_approval', ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                dec_id,
                rec["action"],
                spot_name,
                rec["proposed_value"],
                rec["rationale"],
                timestamp,
                corr_id,
                rec["action"],
                rec["rationale"],
                corr_id,
                rec["expected_outcome"],
                rec["risk_level"],
                rec["confidence_score"]
            ))
            
    conn.commit()
    conn.close()

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

# 2. Propose Pricing Change (Non-autonomous proposal)
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
    corr_id = correlation_id or f"corr_p_{uuid.uuid4().hex[:8]}"
    
    conn = get_sqlite_connection(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO operator_decisions (
        decision_id, type, spot_name, proposed_value, status, explanation, timestamp, correlation_id,
        recommendation_type, reasoning, supporting_event_trace, expected_outcome, risk_level, confidence_score
    ) VALUES (?, 'pricing_adjustment', ?, ?, 'pending_approval', ?, ?, ?, 'pricing_adjustment', ?, ?, ?, 'medium', 95.0)
    """, (
        decision_id,
        spot_name,
        str(price_val),
        explanation,
        timestamp,
        corr_id,
        explanation,
        corr_id,
        f"Enforce dynamic pricing shift to ${price_val} for {spot_name}."
    ))
    
    conn.commit()
    conn.close()
    
    return {
        "success": True,
        "decision_id": decision_id,
        "status": "pending_approval",
        "explanation_logged": True,
        "proposed_price": price_val,
        "correlation_id": corr_id
    }

# 3. Propose Safety Cancellation (Non-autonomous proposal)
def propose_cancellation(event_id, explanation, swell_height_ft=None, correlation_id=None):
    init_db()
    
    s_height = swell_height_ft
    if s_height is None:
        s_height = 5.5
        try:
            import event_bus_mcp_server
            recent = event_bus_mcp_server.get_recent_events(event_type="weather_updated", limit=1)
            if recent:
                s_height = float(recent[0]["payload"].get("swell_height_ft", 5.5))
        except:
            pass
                
    if s_height <= 10.0:
        return {
            "success": False,
            "error": f"Safety cancellation rejected: Swell height ({s_height}ft) is below the critical 10.0ft safety limit."
        }

    decision_id = f"dec_cancel_{uuid.uuid4().hex[:8]}"
    timestamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    corr_id = correlation_id or f"corr_c_{uuid.uuid4().hex[:8]}"
    
    conn = get_sqlite_connection(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO operator_decisions (
        decision_id, type, proposed_value, status, explanation, timestamp, correlation_id,
        recommendation_type, reasoning, supporting_event_trace, expected_outcome, risk_level, confidence_score
    ) VALUES (?, 'cancellation', ?, 'pending_approval', ?, ?, ?, 'cancellation', ?, ?, ?, 'high', 99.0)
    """, (
        decision_id,
        str(event_id),
        f"[SAFETY VALIDATED - Swell: {s_height}ft] {explanation}",
        timestamp,
        corr_id,
        explanation,
        corr_id,
        f"Enforce safety cancellation for booking event {event_id}."
    ))
    
    conn.commit()
    conn.close()
    
    return {
        "success": True,
        "decision_id": decision_id,
        "status": "pending_approval",
        "explanation_logged": True,
        "safety_threshold_validated": True,
        "correlation_id": corr_id
    }

# 4. Execute approved decision with strict human-in-the-loop Gate
def execute_decision(decision_id, caller_role, correlation_id=None, real_integration_results=None):
    init_db()
    
    conn = get_sqlite_connection(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
    SELECT decision_id, type, spot_name, proposed_value, status, explanation, timestamp, correlation_id 
    FROM operator_decisions WHERE decision_id = ?
    """, (decision_id,))
    row = cursor.fetchone()
    
    if not row:
        conn.close()
        return {"success": False, "error": f"Decision {decision_id} not found."}
        
    dec_id, dec_type, spot, value, status, explanation, ts, corr_id = row
    
    if status != "pending_approval":
        conn.close()
        return {"success": False, "error": f"Decision is already in '{status}' status."}
        
    if caller_role != "admin":
        conn.close()
        return {
            "success": False,
            "error": "Unauthorized execution attempt: All operator decisions require explicit admin approval."
        }
        
    exec_ts = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    c_id = correlation_id or corr_id or f"corr_exec_{uuid.uuid4().hex[:8]}"
    
    approved_payload = {
        "decision_id": decision_id,
        "recommendation_type": dec_type,
        "spot_name": spot,
        "proposed_value": value,
        "explanation": explanation,
        "approved_by": caller_role,
        "timestamp": exec_ts
    }
    
    event_publish_succeeded = False
    try:
        import event_bus_mcp_server
        event_bus_mcp_server.publish_event(
            event_type="admin_approved_action",
            payload=approved_payload,
            correlation_id=c_id,
            source_mcp="operator_mcp",
            source_service="operator_mcp"
        )
        event_bus_mcp_server.publish_event(
            event_type="admin_action_approved",
            payload=approved_payload,
            correlation_id=c_id,
            source_mcp="operator_mcp",
            source_service="operator_mcp"
        )
        event_publish_succeeded = True
    except Exception as e:
        sys.stderr.write(f"Warning: Failed publishing admin approved events: {str(e)}\n")
        sys.stderr.flush()

    if real_integration_results is not None:
        # Caller (the HTTP route, which has DB access) already performed the real
        # side effect (e.g. an actual booking refund) and is reporting the true outcome.
        integration_results = real_integration_results
    else:
        # No real side effect was performed by the caller for this decision type.
        # Report that truthfully instead of claiming external systems were synced.
        integration_results = {
            "internal_record": {
                "status": "recorded",
                "message": f"Recorded as an internal operator decision (type={dec_type}). No external payment system was called for this decision type."
            },
            "calendar_sync": {
                "status": "not_integrated",
                "message": "Google Calendar integration is not yet built for this app."
            }
        }

    integration_results["event_spine_sync"] = {
        "status": "synchronized" if event_publish_succeeded else "failed",
        "message": (
            f"Event spine notified (admin_approved_action, type={dec_type})."
            if event_publish_succeeded else
            "Failed to publish to the event spine — event bus was unreachable. Decision was still recorded."
        )
    }
    
    cursor.execute("""
    UPDATE operator_decisions 
    SET status = 'executed', caller_role = ?, execution_timestamp = ?, execution_result = ?, correlation_id = ?
    WHERE decision_id = ?
    """, (caller_role, exec_ts, json.dumps(integration_results), c_id, decision_id))
    
    conn.commit()
    conn.close()
    
    return {
        "success": True,
        "decision_id": decision_id,
        "status": "executed",
        "caller_role": caller_role,
        "execution_timestamp": exec_ts,
        "execution_result": integration_results,
        "correlation_id": c_id
    }

# 5. Query decision history
def get_operator_decision_history():
    init_db()
    conn = get_sqlite_connection(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
    SELECT decision_id, type, spot_name, proposed_value, status, explanation, timestamp, caller_role, execution_timestamp, execution_result, correlation_id,
           recommendation_type, reasoning, supporting_event_trace, expected_outcome, risk_level, confidence_score
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
            except (json.JSONDecodeError, TypeError):
                # execution_result was stored as a plain string (e.g. by
                # propose_booking_override), not JSON - surface it as-is
                # rather than silently discarding it.
                exec_res = r[9]
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
            "correlation_id": r[10],
            "recommendation_type": r[11],
            "reasoning": r[12],
            "supporting_event_trace": r[13],
            "expected_outcome": r[14],
            "risk_level": r[15],
            "confidence_score": r[16]
        })
    return history

# 6. Reject decision
def reject_decision(decision_id, caller_role, explanation, correlation_id=None):
    init_db()
    
    conn = get_sqlite_connection(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
    SELECT decision_id, type, spot_name, proposed_value, status, correlation_id 
    FROM operator_decisions WHERE decision_id = ?
    """, (decision_id,))
    row = cursor.fetchone()
    
    if not row:
        conn.close()
        return {"success": False, "error": f"Decision {decision_id} not found."}
        
    dec_id, dec_type, spot, value, status, corr_id = row
    
    if status != "pending_approval":
        conn.close()
        return {"success": False, "error": f"Decision is already in '{status}' status."}
        
    if caller_role != "admin":
        conn.close()
        return {
            "success": False,
            "error": "Unauthorized execution attempt: Rejects require explicit admin approval."
        }
        
    exec_ts = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    c_id = correlation_id or corr_id or f"corr_rej_{uuid.uuid4().hex[:8]}"
    
    rejected_payload = {
        "decision_id": decision_id,
        "recommendation_type": dec_type,
        "spot_name": spot,
        "proposed_value": value,
        "explanation": explanation,
        "rejected_by": caller_role,
        "timestamp": exec_ts
    }
    
    try:
        import event_bus_mcp_server
        event_bus_mcp_server.publish_event(
            event_type="admin_action_rejected",
            payload=rejected_payload,
            correlation_id=c_id,
            source_mcp="operator_mcp",
            source_service="operator_mcp"
        )
    except Exception as e:
        sys.stderr.write(f"Warning: Failed publishing admin_action_rejected: {str(e)}\n")
        sys.stderr.flush()
        
    cursor.execute("""
    UPDATE operator_decisions 
    SET status = 'rejected', caller_role = ?, execution_timestamp = ?, execution_result = ?, correlation_id = ?
    WHERE decision_id = ?
    """, (caller_role, exec_ts, f"Rejected by admin: {explanation}", c_id, decision_id))
    
    conn.commit()
    conn.close()
    
    return {
        "success": True,
        "decision_id": decision_id,
        "status": "rejected",
        "caller_role": caller_role,
        "execution_timestamp": exec_ts,
        "correlation_id": c_id
    }

# 7. Propose Booking Override
def propose_booking_override(booking_id, new_capacity, caller_role, explanation, correlation_id=None, real_update_result=None):
    init_db()
    
    decision_id = f"dec_override_{uuid.uuid4().hex[:8]}"
    timestamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    c_id = correlation_id or f"corr_o_{uuid.uuid4().hex[:8]}"
    
    conn = get_sqlite_connection(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO operator_decisions (
        decision_id, type, spot_name, proposed_value, status, explanation, timestamp, correlation_id,
        recommendation_type, reasoning, supporting_event_trace, expected_outcome, risk_level, confidence_score
    ) VALUES (?, 'booking_override', 'Global', ?, 'pending_approval', ?, ?, ?, 'booking_override', ?, ?, ?, 'medium', 95.0)
    """, (
        decision_id,
        str(new_capacity),
        explanation,
        timestamp,
        c_id,
        explanation,
        c_id,
        f"Override booking capacity/availability for lesson {booking_id} to {new_capacity}."
    ))
    conn.commit()
    conn.close()
    
    try:
        import event_bus_mcp_server
        override_payload = {
            "booking_id": booking_id,
            "proposed_capacity": new_capacity,
            "explanation": explanation,
            "caller_role": caller_role,
            "timestamp": timestamp,
            "decision_id": decision_id
        }
        event_bus_mcp_server.publish_event(
            event_type="admin_booking_override_event",
            payload=override_payload,
            correlation_id=c_id,
            source_mcp="operator_mcp",
            source_service="operator_mcp"
        )
    except Exception as e:
        sys.stderr.write(f"Warning: Failed publishing admin_booking_override_event: {str(e)}\n")
        sys.stderr.flush()
        
    if caller_role == "admin":
        exec_ts = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        conn = get_sqlite_connection(DB_PATH)
        cursor = conn.cursor()
        
        exec_payload = {
            "booking_id": booking_id,
            "new_capacity": new_capacity,
            "explanation": explanation,
            "approved_by": caller_role,
            "timestamp": exec_ts
        }
        
        try:
            import event_bus_mcp_server
            event_bus_mcp_server.publish_event(
                event_type="admin_override_executed",
                payload=exec_payload,
                correlation_id=c_id,
                source_mcp="operator_mcp",
                source_service="operator_mcp"
            )
        except Exception as e:
            sys.stderr.write(f"Warning: Failed publishing admin_override_executed: {str(e)}\n")
            sys.stderr.flush()
            
        result_message = real_update_result or (
            "No booking record was updated — the caller did not report performing a real database update."
        )
        cursor.execute("""
        UPDATE operator_decisions
        SET status = 'executed', caller_role = ?, execution_timestamp = ?, execution_result = ?
        WHERE decision_id = ?
        """, (caller_role, exec_ts, result_message, decision_id))
        
        conn.commit()
        conn.close()
        
        return {
            "success": True,
            "decision_id": decision_id,
            "status": "executed",
            "caller_role": caller_role,
            "proposed_capacity": new_capacity,
            "correlation_id": c_id
        }
        
    return {
        "success": True,
        "decision_id": decision_id,
        "status": "pending_approval",
        "proposed_capacity": new_capacity,
        "correlation_id": c_id
    }
