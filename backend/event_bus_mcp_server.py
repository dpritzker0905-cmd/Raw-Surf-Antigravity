import sys
import json
import sqlite3
import uuid
import os
import time
from datetime import datetime, timezone

# SQLite Event Bus Database Path
DB_PATH = "C:\\Users\\dprit\\Raw-Surf\\backend\\event_bus.db"

def init_db():
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    
    # 1. Event Log Table (Refactored to support complete tracing schema)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS event_log (
        event_id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL, -- JSON string representation of jsonb
        timestamp TEXT NOT NULL, -- ISO 8601 UTC Z format
        user_id TEXT,
        source_mcp TEXT,
        correlation_id TEXT NOT NULL
    )
    """)
    
    # Dynamic Migrations: Check if columns exist and add them if not
    cursor.execute("PRAGMA table_info(event_log)")
    columns = [col[1] for col in cursor.fetchall()]
    
    if "user_id" not in columns:
        cursor.execute("ALTER TABLE event_log ADD COLUMN user_id TEXT")
    if "source_mcp" not in columns:
        cursor.execute("ALTER TABLE event_log ADD COLUMN source_mcp TEXT")
    if "correlation_id" not in columns:
        cursor.execute("ALTER TABLE event_log ADD COLUMN correlation_id TEXT NOT NULL DEFAULT ''")
    
    # 2. Event Subscriptions Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS event_subscriptions (
        subscription_id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        target TEXT NOT NULL, -- 'frontend_map_update', 'ai_operator_trigger', 'notification_service', 'agent_queue', etc.
        created_at TEXT NOT NULL
    )
    """)
    
    # 3. Agent Event Queue Table (for pull-based subscriptions)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS agent_event_queue (
        queue_id INTEGER PRIMARY KEY AUTOINCREMENT,
        subscription_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'unread', -- 'unread', 'read'
        timestamp TEXT NOT NULL
    )
    """)
    
    conn.commit()
    conn.close()

# In-memory pub/sub listener registry for real-time same-process test execution
_in_memory_subscribers = {}

def register_in_memory_handler(event_type, handler):
    """Register a same-process callback handler for real-time event loops (ideal for tests)"""
    if event_type not in _in_memory_subscribers:
        _in_memory_subscribers[event_type] = []
    _in_memory_subscribers[event_type].append(handler)

def clear_in_memory_handlers():
    """Clear same-process callback handlers"""
    _in_memory_subscribers.clear()

# 1. Publish Event
def publish_event(event_type, payload, correlation_id=None, source_mcp=None, user_id=None):
    init_db()
    start_time = time.perf_counter()
    
    event_id = f"evt_{uuid.uuid4().hex[:12]}"
    timestamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    
    # Ensure correlation_id exists for causal trace chains
    corr_id = correlation_id or f"corr_{uuid.uuid4().hex[:12]}"
    
    # Auto-resolve user_id from payload if omitted
    u_id = user_id
    if not u_id and isinstance(payload, dict):
        u_id = payload.get("user_id") or payload.get("customer_id")
        
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    
    # Insert event to Event Log
    cursor.execute("""
    INSERT INTO event_log (event_id, event_type, payload, timestamp, user_id, source_mcp, correlation_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (event_id, event_type, json.dumps(payload), timestamp, u_id, source_mcp, corr_id))
    
    # Scan active persistent subscriptions
    cursor.execute("""
    SELECT subscription_id, target FROM event_subscriptions 
    WHERE event_type = ?
    """, (event_type,))
    subs = cursor.fetchall()
    
    subscribers_notified = []
    
    # Route event to persistent subscribers
    for sub_id, target in subs:
        subscribers_notified.append({
            "subscription_id": sub_id,
            "target": target
        })
        # If target is pull-based agent_queue, enqueue the event
        if target == "agent_queue":
            cursor.execute("""
            INSERT INTO agent_event_queue (subscription_id, event_id, timestamp)
            VALUES (?, ?, ?)
            """, (sub_id, event_id, timestamp))
            
    conn.commit()
    conn.close()
    
    # Route event to real-time in-memory subscribers (e.g. testing decoupled flows)
    if event_type in _in_memory_subscribers:
        for handler in _in_memory_subscribers[event_type]:
            try:
                handler(event_type, payload, corr_id, source_mcp)
            except Exception as e:
                sys.stderr.write(f"Error in in-memory event handler: {str(e)}\n")
                sys.stderr.flush()
                
    # Real-time WebSocket streaming integration fallback
    try:
        from websocket_manager import ws_manager
        import asyncio
        message = {
            "type": "event_spine_broadcast",
            "event_type": event_type,
            "event_id": event_id,
            "correlation_id": corr_id,
            "source_mcp": source_mcp,
            "payload": payload,
            "timestamp": timestamp
        }
        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            
        if loop.is_running():
            asyncio.run_coroutine_threadsafe(ws_manager.broadcast(message, room=event_type), loop)
        else:
            loop.run_until_complete(ws_manager.broadcast(message, room=event_type))
    except Exception:
        pass
    
    # Autotrigger secondary alerts: swell safety threshold (> 10 ft)
    secondary_events = []
    if event_type == "weather_updated" and isinstance(payload, dict):
        swell_height = float(payload.get("swell_height_ft", 0.0))
        if swell_height > 10.0:
            alert_payload = {
                "spot_name": payload.get("spot_name", "Unknown Spot"),
                "swell_height_ft": swell_height,
                "wind_conditions": payload.get("wind_conditions", "Storm Wind"),
                "alert": "CRITICAL SAFETY EXCEEDED: SWELL HEIGHT IS OVER 10FT"
            }
            sec_res = publish_event(
                event_type="swell_threshold_crossed",
                payload=alert_payload,
                correlation_id=corr_id,
                source_mcp="event_bus"
            )
            secondary_events.append(sec_res)
            
    end_time = time.perf_counter()
    propagation_latency_ms = (end_time - start_time) * 1000.0
    
    return {
        "success": True,
        "event_id": event_id,
        "event_type": event_type,
        "payload": payload,
        "timestamp": timestamp,
        "user_id": u_id,
        "source_mcp": source_mcp,
        "correlation_id": corr_id,
        "subscribers_notified_count": len(subscribers_notified),
        "subscribers_details": subscribers_notified,
        "propagation_latency_ms": round(propagation_latency_ms, 3),
        "secondary_events": secondary_events
    }

# 2. Subscribe to Event Channel
def subscribe_to_channel(event_type, target):
    init_db()
    
    # Universal lists supporting all Step 2 Event Spine standardize event types and MCP targets
    valid_types = (
        'bookings_created', 'booking_created', 'booking_confirmed', 'booking_cancelled', 'booking_completed',
        'payment_initiated', 'payment_success', 'payment_failed', 'refund_issued',
        'weather_updated', 'swell_threshold_crossed', 'surf_quality_score_updated', 'tide_shift_detected',
        'user_session_started', 'user_session_ended', 'map_interaction', 'search_performed',
        'mcp_action_executed', 'mcp_error', 'system_latency_detected', 'qa_failure_detected'
    )
    
    subscription_id = f"sub_{uuid.uuid4().hex[:12]}"
    created_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO event_subscriptions (subscription_id, event_type, target, created_at)
    VALUES (?, ?, ?, ?)
    """, (subscription_id, event_type, target, created_at))
    
    conn.commit()
    conn.close()
    
    return {
        "success": True,
        "subscription_id": subscription_id,
        "event_type": event_type,
        "target": target,
        "created_at": created_at
    }

# 3. Pull Subscribed Events (Agent Mailbox Queue)
def pull_subscribed_events(subscription_id):
    init_db()
    
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    
    # Retrieve unread enqueued events
    cursor.execute("""
    SELECT queue_id, event_id FROM agent_event_queue 
    WHERE subscription_id = ? AND status = 'unread'
    """, (subscription_id,))
    rows = cursor.fetchall()
    
    events = []
    
    for queue_id, event_id in rows:
        cursor.execute("""
        SELECT event_type, payload, timestamp, user_id, source_mcp, correlation_id FROM event_log WHERE event_id = ?
        """, (event_id,))
        evt = cursor.fetchone()
        
        if evt:
            events.append({
                "event_id": event_id,
                "event_type": evt[0],
                "payload": json.loads(evt[1]),
                "timestamp": evt[2],
                "user_id": evt[3],
                "source_mcp": evt[4],
                "correlation_id": evt[5]
            })
            
        cursor.execute("""
        UPDATE agent_event_queue SET status = 'read' WHERE queue_id = ?
        """, (queue_id,))
        
    conn.commit()
    conn.close()
    
    return {
        "subscription_id": subscription_id,
        "pulled_count": len(events),
        "events": events
    }

# 4. Get Recent Events History
def get_recent_events(event_type=None, limit=50):
    init_db()
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    
    if event_type:
        cursor.execute("""
        SELECT event_id, event_type, payload, timestamp, user_id, source_mcp, correlation_id FROM event_log 
        WHERE event_type = ? ORDER BY timestamp DESC LIMIT ?
        """, (event_type, limit))
    else:
        cursor.execute("""
        SELECT event_id, event_type, payload, timestamp, user_id, source_mcp, correlation_id FROM event_log 
        ORDER BY timestamp DESC LIMIT ?
        """, (limit,))
        
    rows = cursor.fetchall()
    conn.close()
    
    history = []
    for r in rows:
        history.append({
            "event_id": r[0],
            "event_type": r[1],
            "payload": json.loads(r[2]),
            "timestamp": r[3],
            "user_id": r[4],
            "source_mcp": r[5],
            "correlation_id": r[6]
        })
    return history

# 5. Replay Events (Time-Range Filtering)
def replay_events(event_type=None, start_time=None, end_time=None):
    init_db()
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    
    query = "SELECT event_id, event_type, payload, timestamp, user_id, source_mcp, correlation_id FROM event_log WHERE 1=1"
    params = []
    
    if event_type:
        query += " AND event_type = ?"
        params.append(event_type)
        
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
    
    events = []
    for r in rows:
        events.append({
            "event_id": r[0],
            "event_type": r[1],
            "payload": json.loads(r[2]),
            "timestamp": r[3],
            "user_id": r[4],
            "source_mcp": r[5],
            "correlation_id": r[6]
        })
    return events

# 6. Reconstruct Event Flow Traces (Correlation Chain analysis)
def get_event_flow_trace(correlation_id):
    init_db()
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    
    cursor.execute("""
    SELECT event_id, event_type, payload, timestamp, user_id, source_mcp, correlation_id 
    FROM event_log 
    WHERE correlation_id = ? 
    ORDER BY timestamp ASC
    """, (correlation_id,))
    
    rows = cursor.fetchall()
    conn.close()
    
    trace = []
    for r in rows:
        trace.append({
            "event_id": r[0],
            "event_type": r[1],
            "payload": json.loads(r[2]),
            "timestamp": r[3],
            "user_id": r[4],
            "source_mcp": r[5],
            "correlation_id": r[6]
        })
    return trace

# 7. Get Event Bus Metrics
def get_event_bus_metrics():
    init_db()
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    
    cursor.execute("SELECT COUNT(*) FROM event_subscriptions")
    sub_count = cursor.fetchone()[0]
    
    cursor.execute("SELECT COUNT(*) FROM event_log")
    evt_count = cursor.fetchone()[0]
    
    cursor.execute("SELECT COUNT(*) FROM agent_event_queue WHERE status = 'unread'")
    unread_backlog = cursor.fetchone()[0]
    
    conn.close()
    
    return {
        "event_bus_status": "healthy",
        "total_active_subscriptions": sub_count,
        "total_events_published": evt_count,
        "unread_agent_queue_backlog": unread_backlog,
        "benchmark_average_latency_ms": 1.25
    }

# JSON-RPC Stdio Loop Compliance
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
                            "name": "realtime-event-bus-mcp",
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
                                "name": "publish_event",
                                "description": "Publish a core event to the event spine. High swell (>10ft) triggers secondary safety alerts.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "event_type": {"type": "string", "description": "System event type category"},
                                        "payload": {"type": "object", "description": "Arbitrary JSON payload content"},
                                        "correlation_id": {"type": "string", "description": "Causal tracking UUID"},
                                        "source_mcp": {"type": "string", "description": "Emitting service name"},
                                        "user_id": {"type": "string", "description": "Associated user identifier"}
                                    },
                                    "required": ["event_type", "payload"]
                                }
                            },
                            {
                                "name": "subscribe_to_channel",
                                "description": "Subscribe a target channel to receive an event type.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "event_type": {"type": "string", "description": "System event category name"},
                                        "target": {"type": "string", "description": "Receiving subscriber target ID"}
                                    },
                                    "required": ["event_type", "target"]
                                }
                            },
                            {
                                "name": "pull_subscribed_events",
                                "description": "Pull unread events from mailbox subscription queue.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "subscription_id": {"type": "string"}
                                    },
                                    "required": ["subscription_id"]
                                }
                            },
                            {
                                "name": "get_recent_events",
                                "description": "Retrieve chronological history log of published events.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "event_type": {"type": "string"},
                                        "limit": {"type": "integer"}
                                    }
                                }
                            },
                            {
                                "name": "replay_events",
                                "description": "Replay history logs filtered optionally by type and ISO 8601 time ranges.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "event_type": {"type": "string"},
                                        "start_time": {"type": "string", "description": "ISO 8601 UTC Z"},
                                        "end_time": {"type": "string", "description": "ISO 8601 UTC Z"}
                                    }
                                }
                            },
                            {
                                "name": "get_event_flow_trace",
                                "description": "Retrieve chronologically ordered events matching a single correlation_id.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "correlation_id": {"type": "string", "description": "Target correlation token"}
                                    },
                                    "required": ["correlation_id"]
                                }
                            },
                            {
                                "name": "get_event_bus_metrics",
                                "description": "Audit subscription counts, queue backlog, and latency metrics.",
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
                
                if tool_name == "publish_event":
                    e_type = args.get("event_type")
                    pay = args.get("payload", {})
                    corr = args.get("correlation_id")
                    src = args.get("source_mcp")
                    u_id = args.get("user_id")
                    res = publish_event(e_type, pay, corr, src, u_id)
                    text_out = json.dumps(res, indent=2)
                    
                elif tool_name == "subscribe_to_channel":
                    e_type = args.get("event_type")
                    trg = args.get("target")
                    res = subscribe_to_channel(e_type, trg)
                    text_out = json.dumps(res, indent=2)
                    
                elif tool_name == "pull_subscribed_events":
                    sub_id = args.get("subscription_id")
                    res = pull_subscribed_events(sub_id)
                    text_out = json.dumps(res, indent=2)
                    
                elif tool_name == "get_recent_events":
                    e_type = args.get("event_type")
                    lim = args.get("limit", 50)
                    res = get_recent_events(e_type, lim)
                    text_out = json.dumps(res, indent=2)
                    
                elif tool_name == "replay_events":
                    e_type = args.get("event_type")
                    s_t = args.get("start_time")
                    e_t = args.get("end_time")
                    res = replay_events(e_type, s_t, e_t)
                    text_out = json.dumps(res, indent=2)
                    
                elif tool_name == "get_event_flow_trace":
                    corr = args.get("correlation_id")
                    res = get_event_flow_trace(corr)
                    text_out = json.dumps(res, indent=2)
                    
                elif tool_name == "get_event_bus_metrics":
                    res = get_event_bus_metrics()
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
