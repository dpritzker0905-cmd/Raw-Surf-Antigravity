import sys
import json
import sqlite3
from utils.sqlite_helpers import get_sqlite_connection, get_db_path
from datetime import datetime

# SQLite Overrides Path
DB_PATH = get_db_path("pricing_overrides.db")

def init_db():
    conn = get_sqlite_connection(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS pricing_overrides (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        service_type TEXT NOT NULL,
        entity_id TEXT,
        override_type TEXT NOT NULL, -- 'fixed' or 'multiplier'
        value REAL NOT NULL,
        reason TEXT,
        is_active INTEGER DEFAULT 1,
        created_at TEXT NOT NULL
    )
    """)
    conn.commit()
    conn.close()

# Dynamic Pricing Algorithm Core
def calculate_dynamic_pricing(base_price, demand, surf_quality, availability, season, service_type=None, entity_id=None):
    init_db()
    
    # 1. Check for Active Admin Overrides first
    conn = get_sqlite_connection(DB_PATH)
    cursor = conn.cursor()
    
    # Query specific override or service type override
    cursor.execute(
        "SELECT override_type, value, reason FROM pricing_overrides WHERE service_type = ? AND (entity_id = ? OR entity_id IS NULL) AND is_active = 1 ORDER BY entity_id DESC LIMIT 1",
        (service_type or "general", entity_id)
    )
    override = cursor.fetchone()
    conn.close()
    
    if override:
        override_type, value, reason = override
        if override_type == "fixed":
            return {
                "base_price": base_price,
                "dynamic_price": round(value, 2),
                "multiplier": round(value / base_price, 2) if base_price > 0 else 1.0,
                "breakdown": {
                    "admin_override": f"Enforced fixed price: ${value:.2f} ({reason})"
                },
                "surge_status": "Admin Enforced (Fixed)",
                "applied_override": True
            }
        elif override_type == "multiplier":
            dynamic_price = base_price * value
            return {
                "base_price": base_price,
                "dynamic_price": round(dynamic_price, 2),
                "multiplier": round(value, 2),
                "breakdown": {
                    "admin_override": f"Enforced custom multiplier: {value}x ({reason})"
                },
                "surge_status": f"Admin Enforced ({value}x Surge)",
                "applied_override": True
            }
            
    # 2. Execute dynamic pricing logic
    # A. Demand Factor
    demand_multipliers = {
        "low": 0.90,     # 10% discount to spur demand
        "medium": 1.00,  # Neutral
        "high": 1.30,    # 30% surge
        "extreme": 1.50  # 50% surge
    }
    f_demand = demand_multipliers.get(demand.lower(), 1.00)
    
    # B. Surf Quality Factor (1-5 stars)
    if surf_quality <= 2:
        f_surf = 0.90    # Choppy/poor conditions discount
    elif surf_quality == 3:
        f_surf = 1.00    # Neutral average waves
    elif surf_quality == 4:
        f_surf = 1.15    # High-quality premium
    elif surf_quality >= 5:
        f_surf = 1.30    # Epic glassy swell premium
    else:
        f_surf = 1.00
        
    # C. Instructor / Photographer Availability (Scarcity)
    if availability > 5:
        f_avail = 1.00   # Ample supply
    elif 2 <= availability <= 5:
        f_avail = 1.10   # Light scarcity
    elif availability <= 1:
        f_avail = 1.25   # Severe scarcity surge (only 1 left!)
    else:
        f_avail = 1.00
        
    # D. Seasonality
    peak_seasons = ["summer", "winter-swell"]
    shoulder_seasons = ["shoulder", "spring", "autumn"]
    
    if season.lower() in peak_seasons:
        f_season = 1.15  # Peak tourist swell season
    elif season.lower() in shoulder_seasons:
        f_season = 0.95  # Shoulder season discount
    else:
        f_season = 1.00  # Default
        
    # Calculate initial composite multiplier
    multiplier = f_demand * f_surf * f_avail * f_season
    
    # Capping surge prices to protect consumer experience (Max 2.5x base)
    capped = False
    if multiplier > 2.50:
        multiplier = 2.50
        capped = True
        
    dynamic_price = base_price * multiplier
    
    # Determine Status Description
    if multiplier > 1.30:
        status = "Surge Pricing Active (High Demand & Conditions)"
    elif multiplier < 0.95:
        status = "Off-Peak Discount Applied"
    else:
        status = "Standard Rates Active"
        
    if capped:
        status += " [Capped at 2.5x Max]"
        
    return {
        "base_price": base_price,
        "dynamic_price": round(dynamic_price, 2),
        "multiplier": round(multiplier, 3),
        "breakdown": {
            "demand_multiplier": f_demand,
            "surf_quality_multiplier": f_surf,
            "availability_multiplier": f_avail,
            "seasonality_multiplier": f_season,
            "capped": capped
        },
        "surge_status": status,
        "applied_override": False
    }

# Admin Override Register
def set_admin_override(service_type, entity_id, override_type, value, reason):
    init_db()
    created_at = datetime.now().isoformat()
    
    conn = get_sqlite_connection(DB_PATH)
    cursor = conn.cursor()
    # Deactivate existing overrides for same entity
    cursor.execute(
        "UPDATE pricing_overrides SET is_active = 0 WHERE service_type = ? AND (entity_id = ? OR (entity_id IS NULL AND ? IS NULL))",
        (service_type, entity_id, entity_id)
    )
    # Insert new override
    cursor.execute(
        "INSERT INTO pricing_overrides (service_type, entity_id, override_type, value, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (service_type, entity_id, override_type, value, reason, created_at)
    )
    conn.commit()
    conn.close()
    return True

# Admin List Overrides
def list_overrides():
    init_db()
    conn = get_sqlite_connection(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        "SELECT id, service_type, entity_id, override_type, value, reason, is_active, created_at FROM pricing_overrides"
    )
    rows = cursor.fetchall()
    conn.close()
    
    results = []
    for r in rows:
        results.append({
            "id": r[0],
            "service_type": r[1],
            "entity_id": r[2],
            "override_type": r[3],
            "value": r[4],
            "reason": r[5],
            "is_active": bool(r[6]),
            "created_at": r[7]
        })
    return results

# Remove Override
def remove_override(override_id):
    init_db()
    conn = get_sqlite_connection(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("UPDATE pricing_overrides SET is_active = 0 WHERE id = ?", (override_id,))
    conn.commit()
    conn.close()
    return True

# JSON-RPC stdio Interface Loop
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
                            "name": "dynamic-pricing-mcp",
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
                                "name": "calculate_dynamic_price",
                                "description": "Calculate dynamic booking or service price based on demand, surf quality rating, scarcity, and seasonality.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "base_price": {
                                            "type": "number",
                                            "description": "The baseline price of the service (e.g. $75/hour)"
                                        },
                                        "demand": {
                                            "type": "string",
                                            "enum": ["low", "medium", "high", "extreme"],
                                            "description": "Current user demand volume"
                                        },
                                        "surf_quality": {
                                            "type": "integer",
                                            "minimum": 1,
                                            "maximum": 5,
                                            "description": "Surf quality score from 1 (choppy/flat) to 5 (epic glassy swell)"
                                        },
                                        "availability": {
                                            "type": "integer",
                                            "description": "Number of available instructors/photographers at this spot"
                                        },
                                        "season": {
                                            "type": "string",
                                            "enum": ["summer", "winter-swell", "shoulder", "spring", "autumn", "normal"],
                                            "description": "Tourism / swell season profile"
                                        },
                                        "service_type": {
                                            "type": "string",
                                            "description": "Optional service type category (e.g., 'instructor_booking', 'photo_bundle')"
                                        },
                                        "entity_id": {
                                            "type": "string",
                                            "description": "Optional photographer or instructor ID to check specific overrides"
                                        }
                                    },
                                    "required": ["base_price", "demand", "surf_quality", "availability", "season"]
                                }
                            },
                            {
                                "name": "add_admin_override",
                                "description": "Set a custom administrative override price or multiplier for a service or entity.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "service_type": {
                                            "type": "string",
                                            "description": "Target service type (e.g., 'instructor_booking', 'photo_bundle')"
                                        },
                                        "entity_id": {
                                            "type": "string",
                                            "description": "Optional target instructor/photographer ID"
                                        },
                                        "override_type": {
                                            "type": "string",
                                            "enum": ["fixed", "multiplier"],
                                            "description": "Type of override to apply"
                                        },
                                        "value": {
                                            "type": "number",
                                            "description": "Enforced dollar price if 'fixed', or scalar value if 'multiplier'"
                                        },
                                        "reason": {
                                            "type": "string",
                                            "description": "Administrative rationale for this override"
                                        }
                                    },
                                    "required": ["service_type", "override_type", "value", "reason"]
                                }
                            },
                            {
                                "name": "list_admin_overrides",
                                "description": "List all configured administrative pricing overrides.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {}
                                }
                            },
                            {
                                "name": "deactivate_override",
                                "description": "Deactivate an active administrative pricing override by ID.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "override_id": {
                                            "type": "integer",
                                            "description": "ID of the override to deactivate"
                                        }
                                    },
                                    "required": ["override_id"]
                                }
                            }
                        ]
                    }
                }
                
            elif method == "tools/call":
                tool_name = params.get("name")
                args = params.get("arguments", {})
                
                if tool_name == "calculate_dynamic_price":
                    base_price = args.get("base_price")
                    demand = args.get("demand")
                    surf_quality = args.get("surf_quality")
                    availability = args.get("availability")
                    season = args.get("season")
                    service_type = args.get("service_type")
                    entity_id = args.get("entity_id")
                    
                    pricing = calculate_dynamic_pricing(
                        base_price, demand, surf_quality, availability, season, service_type, entity_id
                    )
                    text_out = json.dumps(pricing, indent=2)
                    
                elif tool_name == "add_admin_override":
                    service_type = args.get("service_type")
                    entity_id = args.get("entity_id")
                    override_type = args.get("override_type")
                    value = args.get("value")
                    reason = args.get("reason")
                    
                    set_admin_override(service_type, entity_id, override_type, value, reason)
                    text_out = f"Successfully registered '{override_type}' override of {value} for '{service_type}' (Reason: {reason})."
                    
                elif tool_name == "list_admin_overrides":
                    overrides = list_overrides()
                    text_out = json.dumps(overrides, indent=2)
                    
                elif tool_name == "deactivate_override":
                    override_id = args.get("override_id")
                    remove_override(override_id)
                    text_out = f"Successfully deactivated pricing override #{override_id}."
                    
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
