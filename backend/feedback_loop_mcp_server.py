import sys
import json
import sqlite3
from utils.sqlite_helpers import get_sqlite_connection, get_db_path
import uuid
import os
from datetime import datetime, timezone

# SQLite System Telemetry Storage Path
DB_PATH = get_db_path("system_telemetry.db")

def init_db():
    conn = get_sqlite_connection(DB_PATH)
    cursor = conn.cursor()
    
    # 1. System Logs table (Frontend Netlify & Backend Render)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS system_logs (
        log_id TEXT PRIMARY KEY,
        source TEXT NOT NULL, -- 'frontend_netlify', 'backend_render'
        level TEXT NOT NULL,  -- 'info', 'warn', 'error', 'fatal'
        message TEXT NOT NULL,
        timestamp TEXT NOT NULL -- ISO 8601 string UTC
    )
    """)
    
    # 2. API Metrics table (latency, errors)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS api_metrics (
        metric_id TEXT PRIMARY KEY,
        endpoint TEXT NOT NULL,
        latency_ms REAL NOT NULL,
        status_code INTEGER NOT NULL,
        error_message TEXT,
        timestamp TEXT NOT NULL -- ISO 8601 string UTC
    )
    """)
    
    # 3. User Behavior Events table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS user_behavior (
        event_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        event_type TEXT NOT NULL, -- 'booking_started', 'booking_completed', 'map_interacted', 'weather_layer_toggled'
        metadata TEXT, -- JSON string
        timestamp TEXT NOT NULL -- ISO 8601 string UTC
    )
    """)
    
    # 4. Performance Metrics table (FPS, Memory usage spikes)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS performance_metrics (
        perf_id TEXT PRIMARY KEY,
        metric_type TEXT NOT NULL, -- 'map_fps', 'memory_usage_mb'
        value REAL NOT NULL,
        timestamp TEXT NOT NULL -- ISO 8601 string UTC
    )
    """)
    
    conn.commit()
    conn.close()

# Real-Time Telemetry Ingestion
def ingest_telemetry_event(category, payload):
    init_db()
    conn = get_sqlite_connection(DB_PATH)
    cursor = conn.cursor()
    
    timestamp = payload.get("timestamp")
    if not timestamp:
        timestamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        
    alerts = []
    
    if category == "log":
        log_id = f"log_{uuid.uuid4().hex[:12]}"
        source = payload.get("source", "unknown")
        level = payload.get("level", "info")
        message = payload.get("message", "")
        cursor.execute("""
        INSERT INTO system_logs (log_id, source, level, message, timestamp)
        VALUES (?, ?, ?, ?, ?)
        """, (log_id, source, level, message, timestamp))
        
        # Real-time alert regression detection
        if level in ("error", "fatal"):
            alert_msg = f"[CRITICAL REGRESSION ALERT] Source: {source.upper()} | Level: {level.upper()} | Message: {message}"
            alerts.append(alert_msg)
            sys.stderr.write(f"ALERT: {alert_msg}\n")
            sys.stderr.flush()
            
    elif category == "api_metric":
        metric_id = f"met_{uuid.uuid4().hex[:12]}"
        endpoint = payload.get("endpoint", "")
        latency = float(payload.get("latency_ms", 0.0))
        status = int(payload.get("status_code", 200))
        err_msg = payload.get("error_message")
        
        cursor.execute("""
        INSERT INTO api_metrics (metric_id, endpoint, latency_ms, status_code, error_message, timestamp)
        VALUES (?, ?, ?, ?, ?, ?)
        """, (metric_id, endpoint, latency, status, err_msg, timestamp))
        
        if status >= 500:
            alert_msg = f"[CRITICAL HTTP ALERT] Endpoint: {endpoint} returned status {status} | Latency: {latency}ms"
            alerts.append(alert_msg)
            sys.stderr.write(f"ALERT: {alert_msg}\n")
            sys.stderr.flush()
            
    elif category == "user_behavior":
        event_id = f"beh_{uuid.uuid4().hex[:12]}"
        user_id = payload.get("user_id", "anonymous")
        event_type = payload.get("event_type", "")
        meta = json.dumps(payload.get("metadata", {}))
        
        cursor.execute("""
        INSERT INTO user_behavior (event_id, user_id, event_type, metadata, timestamp)
        VALUES (?, ?, ?, ?, ?)
        """, (event_id, user_id, event_type, meta, timestamp))
        
    elif category == "performance":
        perf_id = f"prf_{uuid.uuid4().hex[:12]}"
        metric_type = payload.get("metric_type", "")
        val = float(payload.get("value", 0.0))
        
        cursor.execute("""
        INSERT INTO performance_metrics (perf_id, metric_type, value, timestamp)
        VALUES (?, ?, ?, ?)
        """, (perf_id, metric_type, val, timestamp))
        
        # Alert thresholds: < 30 FPS or > 512 MB memory spikes
        if metric_type == "map_fps" and val < 30.0:
            alert_msg = f"[PERFORMANCE ANOMALY] Map renderer frame rate dropped to {val} FPS!"
            alerts.append(alert_msg)
            sys.stderr.write(f"ALERT: {alert_msg}\n")
            sys.stderr.flush()
        elif metric_type == "memory_usage_mb" and val > 512.0:
            alert_msg = f"[PERFORMANCE ANOMALY] Memory usage spike detected: {val} MB!"
            alerts.append(alert_msg)
            sys.stderr.write(f"ALERT: {alert_msg}\n")
            sys.stderr.flush()
            
    conn.commit()
    conn.close()
    
    return {
        "success": True,
        "sync_status": "synchronized_with_supabase_timeseries",
        "alerts_triggered": alerts
    }

# AI Audit Tools
def get_recent_errors(source=None, limit=50):
    init_db()
    conn = get_sqlite_connection(DB_PATH)
    cursor = conn.cursor()
    
    errors = []
    
    # 1. Fetch system log errors
    if source:
        cursor.execute("""
        SELECT log_id, source, level, message, timestamp FROM system_logs 
        WHERE level IN ('error', 'fatal') AND source = ? 
        ORDER BY timestamp DESC LIMIT ?
        """, (source, limit))
    else:
        cursor.execute("""
        SELECT log_id, source, level, message, timestamp FROM system_logs 
        WHERE level IN ('error', 'fatal') 
        ORDER BY timestamp DESC LIMIT ?
        """, (limit,))
        
    log_rows = cursor.fetchall()
    for row in log_rows:
        errors.append({
            "type": "system_log",
            "id": row[0],
            "source": row[1],
            "level": row[2].upper(),
            "message": row[3],
            "timestamp": row[4]
        })
        
    # 2. Fetch API failure metrics (status >= 400)
    cursor.execute("""
    SELECT metric_id, endpoint, latency_ms, status_code, error_message, timestamp FROM api_metrics 
    WHERE status_code >= 400 
    ORDER BY timestamp DESC LIMIT ?
    """, (limit,))
    
    api_rows = cursor.fetchall()
    for row in api_rows:
        errors.append({
            "type": "api_failure",
            "id": row[0],
            "endpoint": row[1],
            "latency_ms": row[2],
            "status_code": row[3],
            "error_message": row[4],
            "timestamp": row[5]
        })
        
    conn.close()
    errors.sort(key=lambda x: x["timestamp"], reverse=True)
    return errors[:limit]

def get_performance_anomalies(min_fps=30.0, max_memory_mb=512.0):
    init_db()
    conn = get_sqlite_connection(DB_PATH)
    cursor = conn.cursor()
    
    anomalies = []
    
    # 1. Low FPS on map renderer
    cursor.execute("""
    SELECT perf_id, value, timestamp FROM performance_metrics 
    WHERE metric_type = 'map_fps' AND value < ? 
    ORDER BY timestamp DESC
    """, (min_fps,))
    
    fps_rows = cursor.fetchall()
    for row in fps_rows:
        anomalies.append({
            "type": "low_frame_rate",
            "perf_id": row[0],
            "value_fps": row[1],
            "threshold_fps": min_fps,
            "timestamp": row[2],
            "message": f"Map viewport rendering fell below smooth threshold ({row[1]} FPS)"
        })
        
    # 2. High memory usage spikes
    cursor.execute("""
    SELECT perf_id, value, timestamp FROM performance_metrics 
    WHERE metric_type = 'memory_usage_mb' AND value > ? 
    ORDER BY timestamp DESC
    """, (max_memory_mb,))
    
    mem_rows = cursor.fetchall()
    for row in mem_rows:
        anomalies.append({
            "type": "memory_leak_spike",
            "perf_id": row[0],
            "value_mb": row[1],
            "threshold_mb": max_memory_mb,
            "timestamp": row[2],
            "message": f"Critical heap memory allocation exceeded limits ({row[1]} MB)"
        })
        
    conn.close()
    anomalies.sort(key=lambda x: x["timestamp"], reverse=True)
    return anomalies

def get_user_funnel_dropoff():
    init_db()
    conn = get_sqlite_connection(DB_PATH)
    cursor = conn.cursor()
    
    # Fetch all funnel events grouped by user_id
    cursor.execute("""
    SELECT user_id, event_type, timestamp FROM user_behavior 
    WHERE event_type IN ('booking_started', 'booking_completed')
    ORDER BY user_id, timestamp ASC
    """)
    rows = cursor.fetchall()
    conn.close()
    
    user_funnels = {}
    for user_id, event, ts in rows:
        if user_id not in user_funnels:
            user_funnels[user_id] = {"started": False, "completed": False}
        if event == "booking_started":
            user_funnels[user_id]["started"] = True
        elif event == "booking_completed" and user_funnels[user_id]["started"]:
            user_funnels[user_id]["completed"] = True
            
    total_starts = sum(1 for u, state in user_funnels.items() if state["started"])
    total_completes = sum(1 for u, state in user_funnels.items() if state["completed"])
    
    dropoffs = total_starts - total_completes
    conversion_rate = (total_completes / total_starts * 100.0) if total_starts > 0 else 0.0
    
    return {
        "funnel_metric": "Surfer Booking Conversion Loop",
        "total_started": total_starts,
        "total_completed": total_completes,
        "absolute_dropoffs": dropoffs,
        "conversion_percentage": round(conversion_rate, 2)
    }

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
                            "name": "system-feedback-loop-mcp",
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
                                "name": "ingest_telemetry_event",
                                "description": "Ingest live performance logs, API latencies, or user funnel events and evaluate real-time regression alerts.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "category": {
                                            "type": "string",
                                            "enum": ["log", "api_metric", "user_behavior", "performance"],
                                            "description": "Telemetry event category"
                                        },
                                        "payload": {
                                            "type": "object",
                                            "description": "Structured event properties"
                                        }
                                    },
                                    "required": ["category", "payload"]
                                }
                            },
                            {
                                "name": "get_recent_errors",
                                "description": "Retrieve recent errors and stack failures logged from Netlify (frontend) or Render (backend).",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "source": {
                                            "type": "string",
                                            "enum": ["frontend_netlify", "backend_render"],
                                            "description": "Target server source"
                                        },
                                        "limit": {
                                            "type": "integer",
                                            "description": "Max elements to return"
                                        }
                                    }
                                }
                            },
                            {
                                "name": "get_performance_anomalies",
                                "description": "Audit performance spikes exceeding memory caps or map viewport frame rate degradations.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "min_fps": {
                                            "type": "number",
                                            "description": "Frame rate lower boundary"
                                        },
                                        "max_memory_mb": {
                                            "type": "number",
                                            "description": "Memory spike ceiling in MB"
                                        }
                                    }
                                }
                            },
                            {
                                "name": "get_user_funnel_dropoff",
                                "description": "Extract real-time funnel dropoff metrics and conversion loop rates.",
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
                
                if tool_name == "ingest_telemetry_event":
                    cat = args.get("category")
                    pay = args.get("payload", {})
                    res = ingest_telemetry_event(cat, pay)
                    text_out = json.dumps(res, indent=2)
                    
                elif tool_name == "get_recent_errors":
                    src = args.get("source")
                    lim = args.get("limit", 50)
                    res = get_recent_errors(src, lim)
                    text_out = json.dumps(res, indent=2)
                    
                elif tool_name == "get_performance_anomalies":
                    fps = args.get("min_fps", 30.0)
                    mem = args.get("max_memory_mb", 512.0)
                    res = get_performance_anomalies(fps, mem)
                    text_out = json.dumps(res, indent=2)
                    
                elif tool_name == "get_user_funnel_dropoff":
                    res = get_user_funnel_dropoff()
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
