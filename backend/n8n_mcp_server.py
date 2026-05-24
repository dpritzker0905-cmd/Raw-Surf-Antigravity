import sys
import json
import sqlite3
from utils.sqlite_helpers import get_sqlite_connection, get_db_path
import time
import random
from datetime import datetime

# SQLite Workflow Caching & Storage Path
DB_PATH = get_db_path("n8n_workflow_store.db")

def init_db():
    conn = get_sqlite_connection(DB_PATH)
    cursor = conn.cursor()
    
    # 1. Workflows definition table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS n8n_workflows (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        nodes TEXT NOT NULL, -- JSON array of node types (e.g. ["Supabase", "Stripe", "Twilio"])
        max_retries INTEGER DEFAULT 3,
        backoff_factor REAL DEFAULT 2.0,
        active INTEGER DEFAULT 1, -- 0 or 1
        created_at TEXT NOT NULL
    )
    """)
    
    # 2. Workflow executions history table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS n8n_executions (
        id TEXT PRIMARY KEY,
        workflow_name TEXT NOT NULL,
        status TEXT NOT NULL, -- 'SUCCESS', 'FAILED', 'RETRYING'
        execution_logs TEXT NOT NULL, -- JSON array of steps
        retry_attempts INTEGER DEFAULT 0,
        error_msg TEXT,
        started_at TEXT NOT NULL,
        completed_at TEXT
    )
    """)
    conn.commit()
    
    # Seed workflows if empty
    cursor.execute("SELECT COUNT(*) FROM n8n_workflows")
    if cursor.fetchone()[0] == 0:
        workflows_seed = [
            ("booking_flow", json.dumps(["Supabase_Create_Booking", "Weather_API_Check", "Stripe_Create_Invoice", "Twilio_SMS_Confirm"]), 3, 2.0, 1),
            ("failed_payment_recovery", json.dumps(["Stripe_Payment_Webhook", "WooCommerce_Check_Locker", "Twilio_SMS_Alert", "Supabase_Flag_User"]), 5, 3.0, 1),
            ("surf_alerts", json.dumps(["Weather_API_Poll", "Supabase_Query_Preferences", "Twilio_SMS_Broadcast"]), 2, 1.5, 1),
            ("onboarding_flow", json.dumps(["Supabase_New_Surfer", "WooCommerce_Sync_Account", "Twilio_SMS_Welcome"]), 3, 2.0, 1),
            ("review_request_flow", json.dumps(["Supabase_Query_Finished", "Stripe_Confirm_Payment", "Twilio_SMS_Review"]), 3, 2.0, 1)
        ]
        cursor.executemany("""
        INSERT INTO n8n_workflows (name, nodes, max_retries, backoff_factor, active, created_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
        """, workflows_seed)
        
        # Seed some mock executions for the monitoring dashboard
        executions_seed = [
            ("exec_01", "booking_flow", "SUCCESS", json.dumps([
                {"step": "Supabase_Create_Booking", "status": "OK", "timestamp": "2026-05-24T01:00:00Z"},
                {"step": "Weather_API_Check", "status": "OK", "timestamp": "2026-05-24T01:00:01Z", "data": "SSW 4.5ft"},
                {"step": "Stripe_Create_Invoice", "status": "OK", "timestamp": "2026-05-24T01:00:02Z", "invoice": "in_18294"},
                {"step": "Twilio_SMS_Confirm", "status": "OK", "timestamp": "2026-05-24T01:00:03Z"}
            ]), 0, None, "2026-05-24T01:00:00Z", "2026-05-24T01:00:03Z"),
            
            ("exec_02", "failed_payment_recovery", "RETRYING", json.dumps([
                {"step": "Stripe_Payment_Webhook", "status": "FAILED", "timestamp": "2026-05-24T01:05:00Z", "error": "Network Timeout"}
            ]), 1, "Network Timeout on Stripe Webhook Connection", "2026-05-24T01:05:00Z", None),
            
            ("exec_03", "surf_alerts", "SUCCESS", json.dumps([
                {"step": "Weather_API_Poll", "status": "OK", "timestamp": "2026-05-24T01:10:00Z", "data": "WNW 6.0ft - High wave advisory"},
                {"step": "Supabase_Query_Preferences", "status": "OK", "timestamp": "2026-05-24T01:10:01Z", "users_matched": 42},
                {"step": "Twilio_SMS_Broadcast", "status": "OK", "timestamp": "2026-05-24T01:10:03Z"}
            ]), 0, None, "2026-05-24T01:10:00Z", "2026-05-24T01:10:03Z"),
            
            ("exec_04", "failed_payment_recovery", "FAILED", json.dumps([
                {"step": "Stripe_Payment_Webhook", "status": "FAILED", "timestamp": "2026-05-24T01:12:00Z", "error": "Invalid API Key"},
                {"step": "Retry_1", "status": "FAILED", "timestamp": "2026-05-24T01:12:03Z", "error": "Invalid API Key"}
            ]), 2, "Authentication Failure on Stripe Credentials", "2026-05-24T01:12:00Z", "2026-05-24T01:12:03Z")
        ]
        cursor.executemany("""
        INSERT INTO n8n_executions (id, workflow_name, status, execution_logs, retry_attempts, error_msg, started_at, completed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, executions_seed)
        
    conn.commit()
    conn.close()

# Core Actions
def add_workflow(name, nodes_list, max_retries=3, backoff=2.0, active=True):
    init_db()
    conn = get_sqlite_connection(DB_PATH)
    cursor = conn.cursor()
    nodes_json = json.dumps(nodes_list)
    act_val = 1 if active else 0
    try:
        cursor.execute("""
        INSERT INTO n8n_workflows (name, nodes, max_retries, backoff_factor, active, created_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
        """, (name, nodes_json, max_retries, backoff, act_val))
        conn.commit()
        res = {"success": True, "workflow_name": name, "nodes": nodes_list, "status": "registered"}
    except sqlite3.IntegrityError:
        res = {"success": False, "error": f"Workflow with name '{name}' already exists."}
    conn.close()
    return res

def run_workflow(name, payload):
    init_db()
    conn = get_sqlite_connection(DB_PATH)
    cursor = conn.cursor()
    
    # 1. Fetch workflow definition
    cursor.execute("SELECT nodes, max_retries, backoff_factor, active FROM n8n_workflows WHERE name = ?", (name,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        return {"success": False, "error": f"Workflow '{name}' not found."}
        
    nodes_json, max_retries, backoff, active = row
    if not active:
        conn.close()
        return {"success": False, "error": f"Workflow '{name}' is currently inactive/disabled."}
        
    nodes = json.loads(nodes_json)
    conn.close()
    
    exec_id = f"exec_{int(time.time() * 1000)}_{random.randint(100000, 999999)}_{name[:4]}"
    started_at = datetime.now().isoformat()
    logs = []
    
    # Simulate step-by-step workflow triggers & connection calls
    status = "SUCCESS"
    err_msg = None
    retry_count = 0
    
    for node in nodes:
        node_type = node.split("_")[0]
        step_log = {"step": node, "timestamp": datetime.now().isoformat()}
        
        # Simulating external connections
        if node_type == "Supabase":
            step_log["status"] = "OK"
            step_log["details"] = f"Queried and synced database fields successfully for payload ID: {payload.get('user_id', payload.get('booking_id', 'generic'))}"
        elif node_type == "Weather":
            step_log["status"] = "OK"
            step_log["details"] = "Fetched active swell advisories and offshore wind vectors."
            step_log["forecast_data"] = {"swell": "SSW 4.5ft", "wind": "Offshore 8.5kt"}
        elif node_type == "Stripe":
            # Simulate Stripe failed payment recovery or success invoice
            if name == "failed_payment_recovery" and payload.get("trigger_fail", False):
                step_log["status"] = "FAILED"
                step_log["error"] = "Card Declined - Scarcity Overdraw"
                status = "RETRYING"
                err_msg = "Card Declined - Scarcity Overdraw"
                logs.append(step_log)
                break
            else:
                step_log["status"] = "OK"
                step_log["details"] = f"Created invoice balance sheet. Amount: ${payload.get('amount', 75.0)}"
                step_log["invoice_token"] = "in_stripe_mock_token_abc"
        elif node_type == "Twilio":
            step_log["status"] = "OK"
            step_log["details"] = f"Dispatched text confirmation alert to phone: {payload.get('phone', '+1 (555) 987-6543')}"
        elif node_type == "WooCommerce":
            step_log["status"] = "OK"
            step_log["details"] = "Synchronized locker inventory profile catalog."
        else:
            step_log["status"] = "OK"
            step_log["details"] = "Generic Node Completed."
            
        logs.append(step_log)
        
    # Handle error retries if workflow entered RETRYING status
    if status == "RETRYING":
        retry_count = 1
        # Simulate a quick exponential backoff retry attempt
        retry_log = {
            "step": f"Retry_1",
            "timestamp": datetime.now().isoformat(),
            "status": "SUCCESS" if not payload.get("permanent_fail", False) else "FAILED",
            "error": None if not payload.get("permanent_fail", False) else "Scarcity Limits Exceeded"
        }
        logs.append(retry_log)
        if retry_log["status"] == "SUCCESS":
            status = "SUCCESS"
            err_msg = None
        else:
            status = "FAILED"
            err_msg = "Scarcity Limits Exceeded after retry backoff factor."
            
    completed_at = datetime.now().isoformat()
    
    # Save execution log in database
    conn = get_sqlite_connection(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO n8n_executions (id, workflow_name, status, execution_logs, retry_attempts, error_msg, started_at, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (exec_id, name, status, json.dumps(logs), retry_count, err_msg, started_at, completed_at))
    conn.commit()
    conn.close()
    
    return {
        "execution_id": exec_id,
        "workflow_name": name,
        "nodes_processed_count": len(logs),
        "execution_status": status,
        "retry_attempts_recorded": retry_count,
        "error_message": err_msg,
        "execution_logs": logs,
        "started_at": started_at,
        "completed_at": completed_at
    }

def get_executions(workflow_name=None, limit=10):
    init_db()
    conn = get_sqlite_connection(DB_PATH)
    cursor = conn.cursor()
    
    if workflow_name:
        cursor.execute("""
        SELECT id, workflow_name, status, execution_logs, retry_attempts, error_msg, started_at, completed_at
        FROM n8n_executions WHERE workflow_name = ? ORDER BY started_at DESC LIMIT ?
        """, (workflow_name, limit))
    else:
        cursor.execute("""
        SELECT id, workflow_name, status, execution_logs, retry_attempts, error_msg, started_at, completed_at
        FROM n8n_executions ORDER BY started_at DESC LIMIT ?
        """, (limit,))
        
    rows = cursor.fetchall()
    conn.close()
    
    executions = []
    for row in rows:
        exec_id, name, status, logs_json, retries, err, start, end = row
        executions.append({
            "execution_id": exec_id,
            "workflow_name": name,
            "status": status,
            "logs": json.loads(logs_json),
            "retry_attempts": retries,
            "error_msg": err,
            "started_at": start,
            "completed_at": end
        })
    return executions

def get_dashboard_metrics():
    init_db()
    conn = get_sqlite_connection(DB_PATH)
    cursor = conn.cursor()
    
    cursor.execute("SELECT status FROM n8n_executions")
    rows = cursor.fetchall()
    conn.close()
    
    total = len(rows)
    success = sum(1 for r in rows if r[0] == "SUCCESS")
    failed = sum(1 for r in rows if r[0] == "FAILED")
    retrying = sum(1 for r in rows if r[0] == "RETRYING")
    
    success_rate = (success / total * 100.0) if total > 0 else 100.0
    
    # Real-time curve data points for visual dashboard
    hourly_curve = [
        {"hour": "18:00", "success": 12, "failed": 0},
        {"hour": "19:00", "success": 15, "failed": 1},
        {"hour": "20:00", "success": 18, "failed": 0},
        {"hour": "21:00", "success": 24, "failed": 1}
    ]
    
    return {
        "dashboard_summary": {
            "total_executions": total,
            "success_rate_percentage": round(success_rate, 2),
            "total_successful_runs": success,
            "total_failed_runs": failed,
            "total_active_retries": retrying
        },
        "system_status": "Healthy" if success_rate >= 85.0 else "Attention Required (High Failures)",
        "visual_metrics_curve": hourly_curve,
        "n8n_modular_integrations": ["Supabase", "Stripe", "WooCommerce", "Twilio", "Weather_APIs"]
    }

def update_retry_policy(name, max_retries, backoff):
    init_db()
    conn = get_sqlite_connection(DB_PATH)
    cursor = conn.cursor()
    
    cursor.execute("SELECT id FROM n8n_workflows WHERE name = ?", (name,))
    if not cursor.fetchone():
        conn.close()
        return {"success": False, "error": f"Workflow '{name}' does not exist."}
        
    cursor.execute("""
    UPDATE n8n_workflows SET max_retries = ?, backoff_factor = ? WHERE name = ?
    """, (max_retries, backoff, name))
    conn.commit()
    conn.close()
    
    return {
        "success": True,
        "workflow_name": name,
        "configured_max_retries": max_retries,
        "configured_backoff_factor": backoff,
        "status": "retry_policy_updated"
    }

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
                            "name": "n8n-mcp",
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
                                "name": "create_workflow",
                                "description": "Configure a new modular automation workflow with custom triggers and connections (e.g. Supabase, Stripe, WooCommerce, Twilio, Weather APIs).",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "name": {"type": "string", "description": "Unique workflow name (e.g. 'onboarding_flow')"},
                                        "nodes": {
                                            "type": "array", 
                                            "items": {"type": "string"},
                                            "description": "List of node triggers/actions in execution order (e.g., ['Supabase_New_Surfer', 'Twilio_SMS_Welcome'])"
                                        },
                                        "max_retries": {"type": "integer", "description": "Workflow maximum recovery retry limit (default: 3)"},
                                        "backoff_factor": {"type": "number", "description": "Exponential backoff recovery factor (default: 2.0)"}
                                    },
                                    "required": ["name", "nodes"]
                                }
                            },
                            {
                                "name": "trigger_workflow",
                                "description": "Trigger an automated workflow execution with retry limits and automated connection error recovery.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "workflow_name": {"type": "string", "description": "Name of workflow to trigger"},
                                        "payload": {
                                            "type": "object",
                                            "description": "JSON payload containing dynamic variables (e.g. amount, user_id, phone, trigger_fail)"
                                        }
                                    },
                                    "required": ["workflow_name", "payload"]
                                }
                            },
                            {
                                "name": "get_workflow_executions",
                                "description": "Retrieve past executed workflows, detailed node logs, starting timestamps, and recovery attempts.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "workflow_name": {"type": "string", "description": "Optional workflow name filter"},
                                        "limit": {"type": "integer", "description": "Limit counts (default: 10)"}
                                    }
                                }
                            },
                            {
                                "name": "get_monitoring_dashboard",
                                "description": "Obtain real-time system metrics, visual hourly curves, and connection health states for workflow automation dashboard overlays.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {}
                                }
                            },
                            {
                                "name": "configure_retry_policy",
                                "description": "Update maximum retry attempts and recovery backoff multipliers for a specific workflow.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "workflow_name": {"type": "string", "description": "Target workflow name"},
                                        "max_retries": {"type": "integer", "description": "New maximum retries"},
                                        "backoff_factor": {"type": "number", "description": "New backoff recovery multiplier"}
                                    },
                                    "required": ["workflow_name", "max_retries", "backoff_factor"]
                                }
                            }
                        ]
                    }
                }
                
            elif method == "tools/call":
                tool_name = params.get("name")
                args = params.get("arguments", {})
                
                if tool_name == "create_workflow":
                    name = args.get("name")
                    nodes = args.get("nodes")
                    retries = args.get("max_retries", 3)
                    backoff = args.get("backoff_factor", 2.0)
                    res = add_workflow(name, nodes, retries, backoff)
                    text_out = json.dumps(res, indent=2)
                    
                elif tool_name == "trigger_workflow":
                    name = args.get("workflow_name")
                    payload = args.get("payload", {})
                    res = run_workflow(name, payload)
                    text_out = json.dumps(res, indent=2)
                    
                elif tool_name == "get_workflow_executions":
                    name = args.get("workflow_name")
                    limit = args.get("limit", 10)
                    res = get_executions(name, limit)
                    text_out = json.dumps(res, indent=2)
                    
                elif tool_name == "get_monitoring_dashboard":
                    res = get_dashboard_metrics()
                    text_out = json.dumps(res, indent=2)
                    
                elif tool_name == "configure_retry_policy":
                    name = args.get("workflow_name")
                    retries = args.get("max_retries")
                    backoff = args.get("backoff_factor")
                    res = update_retry_policy(name, retries, backoff)
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
