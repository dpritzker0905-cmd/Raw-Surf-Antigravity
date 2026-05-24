import sys
import json
import sqlite3
from utils.sqlite_helpers import get_sqlite_connection, get_db_path
import uuid
import os
import time
from datetime import datetime, timezone

DB_PATH = get_db_path("debug_consciousness.db")
EVENT_BUS_DB = "C:\\Users\\dprit\\Raw-Surf\\backend\\event_bus.db"

def init_db():
    conn = get_sqlite_connection(DB_PATH)
    cursor = conn.cursor()
    
    # 1. Failure Memory Table (DCL Debug Memory Layer)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS failure_memory (
        failure_id TEXT PRIMARY KEY,
        correlation_id TEXT NOT NULL,
        event_id TEXT,
        event_type TEXT,
        failing_mcp TEXT,
        full_chain TEXT, -- JSON string list of events
        suggested_fix TEXT,
        confidence_score REAL,
        timestamp TEXT NOT NULL
    )
    """)
    conn.commit()
    conn.close()

# 1. Get Event Trace with branch and latency mapping
def get_event_trace(correlation_id):
    init_db()
    if not os.path.exists(EVENT_BUS_DB):
        return {"success": False, "error": "Event Bus DB not found."}
        
    conn = sqlite3.connect(EVENT_BUS_DB, timeout=10.0)
    cursor = conn.cursor()
    cursor.execute("""
    SELECT event_id, event_type, payload, timestamp, user_id, source_mcp, correlation_id
    FROM event_log WHERE correlation_id = ? ORDER BY timestamp ASC
    """, (correlation_id,))
    rows = cursor.fetchall()
    conn.close()
    
    events = []
    prev_time = None
    
    for r in rows:
        evt_time = datetime.fromisoformat(r[3].replace("Z", "+00:00"))
        latency_ms = 0.0
        if prev_time:
            latency_ms = (evt_time - prev_time).total_seconds() * 1000.0
            
        events.append({
            "event_id": r[0],
            "event_type": r[1],
            "payload": json.loads(r[2]),
            "timestamp": r[3],
            "user_id": r[4],
            "source_mcp": r[5],
            "correlation_id": r[6],
            "latency_offset_ms": round(latency_ms, 2)
        })
        prev_time = evt_time
        
    # Analyze branching flows (parallel execution is indicated by near-zero latency offset between sibling events)
    branches = []
    current_branch = []
    
    for idx, evt in enumerate(events):
        if idx == 0:
            current_branch.append(evt["event_type"])
            continue
            
        # Sibling events occurring within 5ms of each other indicate parallel triggers
        if evt["latency_offset_ms"] <= 5.0:
            current_branch.append(evt["event_type"])
        else:
            if len(current_branch) > 1:
                branches.append(current_branch)
            current_branch = [evt["event_type"]]
            
    if len(current_branch) > 1:
        branches.append(current_branch)
        
    return {
        "correlation_id": correlation_id,
        "event_count": len(events),
        "events": events,
        "parallel_execution_branches": branches
    }

# 2. Root Cause Analysis Engine
def explain_failure(event_id):
    init_db()
    if not os.path.exists(EVENT_BUS_DB):
        return {"success": False, "error": "Event Bus DB not found."}
        
    conn = sqlite3.connect(EVENT_BUS_DB, timeout=10.0)
    cursor = conn.cursor()
    cursor.execute("""
    SELECT event_id, event_type, payload, timestamp, user_id, source_mcp, correlation_id
    FROM event_log WHERE event_id = ?
    """, (event_id,))
    row = cursor.fetchone()
    conn.close()
    
    if not row:
        return {"success": False, "error": f"Event {event_id} not found."}
        
    evt_id, evt_type, payload_str, ts, u_id, source_mcp, corr_id = row
    payload = json.loads(payload_str)
    
    # Trace the full chain to find root causality
    trace_res = get_event_trace(corr_id)
    chain_events = trace_res["events"]
    
    root_cause_summary = "An unknown failure occurred."
    failing_mcp = source_mcp or "unknown_mcp"
    first_failing_event = evt_type
    suggested_fix = "Verify system logs and add general exception handlers."
    confidence = 50.0
    
    chain_types = [e["event_type"] for e in chain_events]
    
    # 1. Hard Failure: payment failed
    if "payment_failed" in chain_types:
        failing_mcp = "stripe_mcp"
        first_failing_event = "payment_failed"
        root_cause_summary = "Payment transaction failed due to processor decline or insufficient funds."
        suggested_fix = "Configure active n8n webhook retries and alert surfer to update payment card details."
        confidence = 98.0
        
    # 2. Hard Failure: qa failure detected
    elif "qa_failure_detected" in chain_types:
        failing_mcp = "qa_agent_mcp"
        first_failing_event = "qa_failure_detected"
        root_cause_summary = "Autonomous browser simulation encountered a critical UI exception or database lock."
        suggested_fix = "Investigate SQLite thread locks and increase database timeout limit threshold to 15.0 seconds."
        confidence = 95.0
        
    # 3. Hard Failure: system latency detected or mcp error
    elif "mcp_error" in chain_types:
        failing_evt = next(e for e in chain_events if e["event_type"] == "mcp_error")
        failing_mcp = failing_evt["source_mcp"] or "unknown_mcp"
        first_failing_event = "mcp_error"
        root_cause_summary = f"MCP server {failing_mcp} crashed due to internal execution error: {failing_evt['payload'].get('error_message', 'unknown exception')}"
        suggested_fix = f"Implement robust try-except bounds validation in {failing_mcp} tool actions."
        confidence = 92.0
        
    # 4. Soft Failure: incomplete booking flow (broken chain)
    elif "booking_created" in chain_types and "booking_confirmed" not in chain_types:
        failing_mcp = "calendar_mcp"
        first_failing_event = "booking_created"
        root_cause_summary = "Booking flow stalled. Reserve slot succeeded, but payment intent was not created."
        suggested_fix = "Verify the stripe checkout session generation hook registers slot reservation callbacks."
        confidence = 85.0
        
    # Save diagnosed failure to debug memory layer
    conn = get_sqlite_connection(DB_PATH)
    cursor = conn.cursor()
    failure_id = f"fail_{uuid.uuid4().hex[:8]}"
    cursor.execute("""
    INSERT INTO failure_memory (failure_id, correlation_id, event_id, event_type, failing_mcp, full_chain, suggested_fix, confidence_score, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    """, (failure_id, corr_id, evt_id, evt_type, failing_mcp, json.dumps(chain_types), suggested_fix, confidence))
    conn.commit()
    conn.close()
    
    return {
        "Root Cause Summary": root_cause_summary,
        "First failing MCP": failing_mcp,
        "First failing event": first_failing_event,
        "Full event chain leading to failure": chain_types,
        "Suggested fix": suggested_fix,
        "Confidence score (0-100%)": confidence,
        "failure_id": failure_id
    }

# 3. Compute System Health Score
def get_system_health_score():
    init_db()
    if not os.path.exists(EVENT_BUS_DB):
        return {"system_health_score": 100.0, "status": "healthy", "error": "Event Bus DB not found."}
        
    conn = sqlite3.connect(EVENT_BUS_DB, timeout=10.0)
    cursor = conn.cursor()
    cursor.execute("""
    SELECT event_id, event_type, timestamp, source_mcp, correlation_id FROM event_log
    ORDER BY timestamp DESC LIMIT 200
    """)
    rows = cursor.fetchall()
    conn.close()
    
    if not rows:
        return {"system_health_score": 100.0, "status": "healthy", "message": "No events found to analyze."}
        
    # Health computation
    score = 100.0
    hard_failures = 0
    soft_failures = 0
    latency_anomalies = 0
    total_events = len(rows)
    
    mcp_successes = {}
    mcp_totals = {}
    
    # Sort chronological
    rows_chrono = sorted(rows, key=lambda x: x[2])
    prev_time = None
    prev_corr = None
    
    for r in rows_chrono:
        evt_type = r[1]
        mcp_name = r[3] or "unknown_mcp"
        corr_id = r[4]
        
        # Track counts per MCP
        mcp_totals[mcp_name] = mcp_totals.get(mcp_name, 0) + 1
        if evt_type not in ("payment_failed", "mcp_error", "qa_failure_detected"):
            mcp_successes[mcp_name] = mcp_successes.get(mcp_name, 0) + 1
            
        # 1. Penalize Hard failures
        if evt_type in ("payment_failed", "mcp_error", "qa_failure_detected"):
            hard_failures += 1
            score -= 15.0
            
        # 2. Penalize Latency anomalies (>500ms local propagation)
        evt_time = datetime.fromisoformat(r[2].replace("Z", "+00:00"))
        if prev_time and prev_corr == corr_id:
            latency_ms = (evt_time - prev_time).total_seconds() * 1000.0
            if latency_ms > 500.0:
                latency_anomalies += 1
                score -= 5.0
                
        prev_time = evt_time
        prev_corr = corr_id
        
    # Check broken chains
    broken_res = find_broken_flows()
    broken_count = len(broken_res.get("broken_flows", []))
    score -= (broken_count * 10.0)
    
    # Bounded score
    score = max(0.0, min(100.0, score))
    
    # Compute reliability per MCP
    reliability = {}
    for mcp in mcp_totals:
        succ = mcp_successes.get(mcp, 0)
        tot = mcp_totals[mcp]
        reliability[mcp] = round((succ / tot) * 100.0, 1)
        
    status = "healthy"
    if score < 70.0:
        status = "degraded"
    if score < 40.0:
        status = "critical"
        
    return {
        "system_health_score": round(score, 1),
        "status": status,
        "total_analyzed_events": total_events,
        "hard_failures_detected": hard_failures,
        "soft_failures_detected": broken_count,
        "latency_anomalies_detected": latency_anomalies,
        "mcp_reliability_scores": reliability
    }

# 4. Find Incomplete/Broken Event Flows
def find_broken_flows():
    init_db()
    if not os.path.exists(EVENT_BUS_DB):
        return {"broken_flows": []}
        
    conn = sqlite3.connect(EVENT_BUS_DB, timeout=10.0)
    cursor = conn.cursor()
    cursor.execute("""
    SELECT event_type, correlation_id FROM event_log ORDER BY timestamp ASC
    """)
    rows = cursor.fetchall()
    conn.close()
    
    flows = {}
    for ev_type, corr_id in rows:
        if corr_id not in flows:
            flows[corr_id] = []
        flows[corr_id].append(ev_type)
        
    broken_flows = []
    
    for corr_id, evts in flows.items():
        # Check Flow 1: Booking started but never confirmed/cancelled
        if "booking_created" in evts and "booking_confirmed" not in evts and "booking_cancelled" not in evts:
            broken_flows.append({
                "correlation_id": corr_id,
                "flow_type": "Booking Lifecycle",
                "missing_steps": ["booking_confirmed"],
                "last_step_reached": evts[-1]
            })
        # Check Flow 2: Weather started but never alerted/completed
        elif "weather_updated" in evts and "users_alerted" not in evts and "mcp_action_executed" not in evts:
            # Weather events are complete if they update scores or suggestions
            if "surf_quality_score_updated" not in evts:
                broken_flows.append({
                    "correlation_id": corr_id,
                    "flow_type": "Weather Intelligence",
                    "missing_steps": ["surf_quality_score_updated"],
                    "last_step_reached": evts[-1]
                })
                
    return {
        "broken_flows_count": len(broken_flows),
        "broken_flows": broken_flows
    }

# 5. Compare two Event Chains
def compare_event_chains(flow_a, flow_b):
    init_db()
    trace_a = get_event_trace(flow_a)
    trace_b = get_event_trace(flow_b)
    
    if "error" in trace_a or "error" in trace_b:
        return {"success": False, "error": "One of the target correlation IDs was not found."}
        
    evts_a = [e["event_type"] for e in trace_a["events"]]
    evts_b = [e["event_type"] for e in trace_b["events"]]
    
    missing_in_b = [e for e in evts_a if e not in evts_b]
    missing_in_a = [e for e in evts_b if e not in evts_a]
    
    # Calculate average latency offsets
    avg_lat_a = 0.0
    if len(trace_a["events"]) > 1:
        avg_lat_a = sum(e["latency_offset_ms"] for e in trace_a["events"][1:]) / (len(trace_a["events"]) - 1)
        
    avg_lat_b = 0.0
    if len(trace_b["events"]) > 1:
        avg_lat_b = sum(e["latency_offset_ms"] for e in trace_b["events"][1:]) / (len(trace_b["events"]) - 1)
        
    return {
        "comparison_result": "analyzed",
        "flow_a": {
            "correlation_id": flow_a,
            "event_count": len(evts_a),
            "event_sequence": evts_a,
            "average_step_latency_ms": round(avg_lat_a, 2)
        },
        "flow_b": {
            "correlation_id": flow_b,
            "event_count": len(evts_b),
            "event_sequence": evts_b,
            "average_step_latency_ms": round(avg_lat_b, 2)
        },
        "differences": {
            "missing_in_flow_b": missing_in_b,
            "missing_in_flow_a": missing_in_a,
            "event_count_discrepancy": len(evts_a) - len(evts_b),
            "latency_offset_discrepancy_ms": round(avg_lat_a - avg_lat_b, 2)
        }
    }

# 6. Detect Latency and Sequence Anomalies
def detect_anomalies(start_time=None, end_time=None):
    init_db()
    if not os.path.exists(EVENT_BUS_DB):
        return {"anomalies": []}
        
    conn = sqlite3.connect(EVENT_BUS_DB, timeout=10.0)
    cursor = conn.cursor()
    
    query = "SELECT event_id, event_type, payload, timestamp, source_mcp, correlation_id FROM event_log WHERE 1=1"
    params = []
    
    if start_time:
        query += " AND timestamp >= ?"
        params.append(start_time)
    if end_time:
        query += " AND timestamp <= ?"
        params.append(end_time)
        
    query += " ORDER BY timestamp ASC"
    
    cursor.execute(query, params)
    rows = cursor.fetchall()
    conn.close()
    
    anomalies = []
    prev_time = None
    prev_corr = None
    
    for r in rows:
        evt_id, evt_type, pay, ts, mcp, corr = r
        evt_time = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        
        # 1. Check Latency spikes (time gap > 500ms inside same correlation chain)
        if prev_time and prev_corr == corr:
            gap_ms = (evt_time - prev_time).total_seconds() * 1000.0
            if gap_ms > 500.0:
                anomalies.append({
                    "type": "latency_spike",
                    "event_id": evt_id,
                    "correlation_id": corr,
                    "source_mcp": mcp,
                    "description": f"Propagation latency between steps spiked to {round(gap_ms, 2)} ms."
                })
                
        # 2. Check failure events
        if evt_type in ("payment_failed", "mcp_error", "qa_failure_detected"):
            anomalies.append({
                "type": "hard_failure",
                "event_id": evt_id,
                "correlation_id": corr,
                "source_mcp": mcp,
                "description": f"Hard system exception event '{evt_type}' detected."
            })
            
        prev_time = evt_time
        prev_corr = corr
        
    return {
        "total_anomalies_detected": len(anomalies),
        "anomalies": anomalies
    }

# 7. Get Diagnostic historical logs from memory
def get_failure_history(limit=50):
    init_db()
    conn = get_sqlite_connection(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
    SELECT failure_id, correlation_id, event_id, event_type, failing_mcp, full_chain, suggested_fix, confidence_score, timestamp
    FROM failure_memory ORDER BY timestamp DESC LIMIT ?
    """, (limit,))
    rows = cursor.fetchall()
    conn.close()
    
    history = []
    for r in rows:
        history.append({
            "failure_id": r[0],
            "correlation_id": r[1],
            "event_id": r[2],
            "event_type": r[3],
            "failing_mcp": r[4],
            "full_chain": json.loads(r[5]),
            "suggested_fix": r[6],
            "confidence_score": r[7],
            "timestamp": r[8]
        })
    return history

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
                            "name": "debug-consciousness-mcp",
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
                                "name": "get_event_trace",
                                "description": "Reconstruct full chronological trace with latency metrics and branching flows.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "correlation_id": {"type": "string"}
                                    },
                                    "required": ["correlation_id"]
                                }
                            },
                            {
                                "name": "explain_failure",
                                "description": "Perform causal Root Cause Analysis (RCA) on a failure event.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "event_id": {"type": "string"}
                                    },
                                    "required": ["event_id"]
                                }
                            },
                            {
                                "name": "get_system_health_score",
                                "description": "Continuously compute system health score, anomaly frequencies, and MCP reliability index.",
                                "inputSchema": {
                                    "type": "object"
                                }
                            },
                            {
                                "name": "find_broken_flows",
                                "description": "Scan and locate broken or stalled event chains.",
                                "inputSchema": {
                                    "type": "object"
                                }
                            },
                            {
                                "name": "compare_event_chains",
                                "description": "Compare sequences and average step latencies between two event chains.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "flow_a": {"type": "string"},
                                        "flow_b": {"type": "string"}
                                    },
                                    "required": ["flow_a", "flow_b"]
                                }
                            },
                            {
                                "name": "detect_anomalies",
                                "description": "Audit system logs for propagation latencies and sequence anomalies.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "start_time": {"type": "string"},
                                        "end_time": {"type": "string"}
                                    }
                                }
                            },
                            {
                                "name": "get_failure_history",
                                "description": "Query historical diagnostic failures committed to debug memory.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "limit": {"type": "integer"}
                                    }
                                }
                            }
                        ]
                    }
                }
                
            elif method == "tools/call":
                tool_name = params.get("name")
                args = params.get("arguments", {})
                
                if tool_name == "get_event_trace":
                    corr = args.get("correlation_id")
                    res = get_event_trace(corr)
                    text_out = json.dumps(res, indent=2)
                    
                elif tool_name == "explain_failure":
                    ev = args.get("event_id")
                    res = explain_failure(ev)
                    text_out = json.dumps(res, indent=2)
                    
                elif tool_name == "get_system_health_score":
                    res = get_system_health_score()
                    text_out = json.dumps(res, indent=2)
                    
                elif tool_name == "find_broken_flows":
                    res = find_broken_flows()
                    text_out = json.dumps(res, indent=2)
                    
                elif tool_name == "compare_event_chains":
                    fa = args.get("flow_a")
                    fb = args.get("flow_b")
                    res = compare_event_chains(fa, fb)
                    text_out = json.dumps(res, indent=2)
                    
                elif tool_name == "detect_anomalies":
                    st = args.get("start_time")
                    et = args.get("end_time")
                    res = detect_anomalies(st, et)
                    text_out = json.dumps(res, indent=2)
                    
                elif tool_name == "get_failure_history":
                    lim = args.get("limit", 50)
                    res = get_failure_history(lim)
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
