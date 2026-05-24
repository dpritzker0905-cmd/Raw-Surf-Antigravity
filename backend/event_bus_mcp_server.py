import sys
import json

# Delegate core operational methods to the modular event_bus_core layer
from event_bus_core import (
    DB_PATH,
    init_db,
    register_in_memory_handler,
    clear_in_memory_handlers,
    publish_event,
    subscribe_to_channel,
    pull_subscribed_events,
    get_recent_events,
    replay_events,
    get_event_flow_trace,
    get_event_bus_metrics,
)

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
                                        "source_mcp": {"type": "string", "description": "Emitting service name (legacy)"},
                                        "source_service": {"type": "string", "description": "Standardized emitting service name"},
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
                    src_mcp = args.get("source_mcp")
                    src_svc = args.get("source_service")
                    u_id = args.get("user_id")
                    res = publish_event(e_type, pay, corr, source_mcp=src_mcp, user_id=u_id, source_service=src_svc)
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
                    start = args.get("start_time")
                    end = args.get("end_time")
                    res = replay_events(e_type, start, end)
                    text_out = json.dumps(res, indent=2)
                    
                elif tool_name == "get_event_flow_trace":
                    corr = args.get("correlation_id")
                    res = get_event_flow_trace(corr)
                    text_out = json.dumps(res, indent=2)
                    
                elif tool_name == "get_event_bus_metrics":
                    res = get_event_bus_metrics()
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
