import sys
import json

# Delegate core operational methods to the modular operator_core layer
from operator_core import (
    DB_PATH,
    init_db,
    monitor_system_state,
    propose_pricing_change,
    propose_cancellation,
    execute_decision,
    get_operator_decision_history,
    reject_decision,
    propose_booking_override,
)

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
                                "name": "reject_decision",
                                "description": "Reject a pending decision under strict admin approval gates, enlisting details and emitting event.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "decision_id": {"type": "string"},
                                        "caller_role": {"type": "string", "enum": ["admin", "moderator", "user"]},
                                        "explanation": {"type": "string"},
                                        "correlation_id": {"type": "string", "description": "Causal trace correlation UUID"}
                                    },
                                    "required": ["decision_id", "caller_role", "explanation"]
                                }
                            },
                            {
                                "name": "propose_booking_override",
                                "description": "Propose or execute a booking capacity/availability override.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "booking_id": {"type": "string"},
                                        "new_capacity": {"type": "integer"},
                                        "caller_role": {"type": "string", "enum": ["admin", "moderator", "user"]},
                                        "explanation": {"type": "string"},
                                        "correlation_id": {"type": "string", "description": "Causal trace correlation UUID"}
                                    },
                                    "required": ["booking_id", "new_capacity", "caller_role", "explanation"]
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
                    s_height = args.get("swell_height_ft")
                    corr = args.get("correlation_id")
                    res = propose_cancellation(ev_id, expl, s_height, corr)
                    text_out = json.dumps(res, indent=2)
                    
                elif tool_name == "execute_decision":
                    dec_id = args.get("decision_id")
                    role = args.get("caller_role")
                    corr = args.get("correlation_id")
                    res = execute_decision(dec_id, role, corr)
                    text_out = json.dumps(res, indent=2)
                    
                elif tool_name == "reject_decision":
                    dec_id = args.get("decision_id")
                    role = args.get("caller_role")
                    expl = args.get("explanation")
                    corr = args.get("correlation_id")
                    res = reject_decision(dec_id, role, expl, corr)
                    text_out = json.dumps(res, indent=2)
                    
                elif tool_name == "propose_booking_override":
                    bk_id = args.get("booking_id")
                    cap = args.get("new_capacity")
                    role = args.get("caller_role")
                    expl = args.get("explanation")
                    corr = args.get("correlation_id")
                    res = propose_booking_override(bk_id, cap, role, expl, corr)
                    text_out = json.dumps(res, indent=2)
                    
                elif tool_name == "get_operator_decision_history":
                    res = get_operator_decision_history()
                    text_out = json.dumps(res, indent=2)
                    
                else:
                    raise Exception(f"Unknown tool: {tool_name}")
                    
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
                raise Exception(f"Unknown method: {method}")
                
            sys.stdout.write(json.dumps(response) + "\n")
            sys.stdout.flush()
            
        except Exception as e:
            err_resp = {
                "jsonrpc": "2.0",
                "id": req_id if 'req_id' in locals() else None,
                "error": {
                    "code": -32603,
                    "message": str(e)
                }
            }
            sys.stdout.write(json.dumps(err_resp) + "\n")
            sys.stdout.flush()

if __name__ == "__main__":
    main()
