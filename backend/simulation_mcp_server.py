import sys
import json
import sqlite3
import uuid
import os
import time
from datetime import datetime, timezone
import math

# SQLite Simulation Layer DB Path
DB_PATH = "C:\\Users\\dprit\\Raw-Surf\\backend\\simulation_layer.db"

def init_db():
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    
    # 1. Simulated Scenarios Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS simulated_scenarios (
        scenario_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        user_behavior TEXT NOT NULL, -- JSON string
        environmental_conditions TEXT NOT NULL, -- JSON string
        system_stress TEXT NOT NULL, -- JSON string
        evaluation_result TEXT NOT NULL, -- JSON string
        optimization_suggestions TEXT NOT NULL, -- JSON string list
        timestamp TEXT NOT NULL -- ISO 8601 UTC
    )
    """)
    conn.commit()
    conn.close()

# Core Simulation Solver Heuristics
def solve_simulation(name, user_preset, env_preset, stress_preset):
    # Default Baseline values
    booking_surge = 1.0
    cancellation_ratio = 0.1
    browse_frequency = 3.0
    
    wave_quality = 'perfect'
    swell_height = 5.0
    storm_active = 0
    
    api_failure = 0.0
    db_latency = 15.0
    traffic_rpm = 500.0
    
    # 1. Resolve User Behavior Presets
    if user_preset == 'booking_surge':
        booking_surge, cancellation_ratio, browse_frequency = 3.5, 0.05, 4.0
    elif user_preset == 'heavy_cancellations':
        booking_surge, cancellation_ratio, browse_frequency = 0.3, 0.85, 2.0
    elif user_preset == 'heavy_map_browsing':
        booking_surge, cancellation_ratio, browse_frequency = 1.2, 0.1, 12.0
    elif user_preset == 'normal':
        booking_surge, cancellation_ratio, browse_frequency = 1.0, 0.1, 3.0
        
    # 2. Resolve Environmental Presets
    if env_preset == 'storm':
        wave_quality, swell_height, storm_active = 'storm', 14.5, 1
    elif env_preset == 'flat_spell':
        wave_quality, swell_height, storm_active = 'flat', 1.5, 0
    elif env_preset == 'perfect_window':
        wave_quality, swell_height, storm_active = 'perfect', 6.5, 0
        
    # 3. Resolve System Stress Presets
    if stress_preset == 'api_failures_high':
        api_failure, db_latency, traffic_rpm = 0.25, 45.0, 1200.0
    elif stress_preset == 'db_latency_heavy':
        api_failure, db_latency, traffic_rpm = 0.02, 350.0, 1500.0
    elif stress_preset == 'traffic_spike_mega':
        api_failure, db_latency, traffic_rpm = 0.05, 95.0, 8000.0
    elif stress_preset == 'none':
        api_failure, db_latency, traffic_rpm = 0.0, 15.0, 500.0

    # Calculate Response Latencies
    # Base response is 80ms + db latency + traffic RPM factors
    base_res = 80.0 + db_latency + (traffic_rpm / 1000.0) * 15.0
    if booking_surge > 2.0:
        base_res += 45.0
    response_time = round(base_res, 2)
    
    # Calculate UX Quality Score (0-100)
    ux_score = 100.0
    ux_score -= api_failure * 200.0
    if db_latency > 150.0:
        ux_score -= (db_latency - 150.0) * 0.15
    if storm_active:
        ux_score -= 15.0
    if response_time > 300.0:
        ux_score -= (response_time - 300.0) * 0.1
    ux_score = max(5.0, min(100.0, round(ux_score, 2)))
    
    # Calculate Booking Dropoff rates (0-100)
    dropoff = 20.0
    dropoff += api_failure * 150.0
    if db_latency > 100.0:
        dropoff += (db_latency - 100.0) * 0.08
    if storm_active:
        dropoff += 40.0
    elif wave_quality == 'flat':
        dropoff += 25.0
    dropoff = max(5.0, min(95.0, round(dropoff, 2)))
    
    # Calculate CPU load
    cpu = 15.0 + (traffic_rpm / 100.0) + (browse_frequency * 2.0) + (booking_surge * 4.0)
    cpu = max(5.0, min(100.0, round(cpu, 2)))
    
    # Generate optimization recommendations
    suggestions = []
    if db_latency > 200.0:
        suggestions.append("DB_LATENCY: Implement a high-performance cache layer for spot details overlays to reduce direct SQLite queries.")
    if api_failure > 0.15:
        suggestions.append("API_RESILIENCE: Deploy circuit breakers on external payment/WooCommerce endpoints and configure retry workflows.")
    if traffic_rpm > 5000.0:
        suggestions.append("EDGE_SCALE: Integrate rate-limiting guards at the Netlify gateway and enable horizontal autoscaling.")
    if storm_active:
        suggestions.append("CANCELLATIONS: Ensure the Autonomous Operator safety threshold is enabled, and trigger automated Stripe refund loops.")
    if wave_quality == 'perfect' and booking_surge > 2.0:
        suggestions.append("SURGE_OPTIMIZATION: Enable dynamic pricing multipliers (+25%) to capture peak demand without overloading calendar schedules.")
        
    if not suggestions:
        suggestions.append("SYSTEM_HEALTHY: No critical scaling vulnerabilities discovered. System operates well within safety parameters.")
        
    user_behavior = {
        "booking_surge_factor": booking_surge,
        "cancellation_ratio": cancellation_ratio,
        "map_browsing_frequency": browse_frequency
    }
    
    environmental_conditions = {
        "wave_quality_type": wave_quality,
        "swell_height_ft": swell_height,
        "storm_active": storm_active
    }
    
    system_stress = {
        "api_failure_ratio": api_failure,
        "db_latency_ms": db_latency,
        "traffic_spikes_rpm": traffic_rpm
    }
    
    evaluation_result = {
        "response_time_ms": response_time,
        "ux_quality_score": ux_score,
        "booking_dropoff_rate": dropoff,
        "cpu_load_percentage": cpu
    }
    
    return {
        "name": name,
        "user_behavior": user_behavior,
        "environmental_conditions": environmental_conditions,
        "system_stress": system_stress,
        "evaluation_result": evaluation_result,
        "optimization_suggestions": suggestions
    }

# 1. Run Simulation
def run_system_simulation(name, user_behavior_preset, environmental_preset, system_stress_preset):
    init_db()
    
    sim_data = solve_simulation(name, user_behavior_preset, environmental_preset, system_stress_preset)
    scenario_id = f"scen_{uuid.uuid4().hex[:12]}"
    timestamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO simulated_scenarios (
        scenario_id, name, user_behavior, environmental_conditions, system_stress, evaluation_result, optimization_suggestions, timestamp
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        scenario_id,
        sim_data["name"],
        json.dumps(sim_data["user_behavior"]),
        json.dumps(sim_data["environmental_conditions"]),
        json.dumps(sim_data["system_stress"]),
        json.dumps(sim_data["evaluation_result"]),
        json.dumps(sim_data["optimization_suggestions"]),
        timestamp
    ))
    
    conn.commit()
    conn.close()
    
    return {
        "success": True,
        "scenario_id": scenario_id,
        "timestamp": timestamp,
        "evaluation": sim_data
    }

# 2. Get Simulation History
def get_simulation_history(limit=50):
    init_db()
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    cursor.execute("""
    SELECT scenario_id, name, user_behavior, environmental_conditions, system_stress, evaluation_result, optimization_suggestions, timestamp 
    FROM simulated_scenarios ORDER BY timestamp DESC LIMIT ?
    """, (limit,))
    rows = cursor.fetchall()
    conn.close()
    
    history = []
    for r in rows:
        history.append({
            "scenario_id": r[0],
            "name": r[1],
            "user_behavior": json.loads(r[2]),
            "environmental_conditions": json.loads(r[3]),
            "system_stress": json.loads(r[4]),
            "evaluation_result": json.loads(r[5]),
            "optimization_suggestions": json.loads(r[6]),
            "timestamp": r[7]
        })
    return history

# 3. Evaluate Stress Vulnerability Analysis
def evaluate_stress_vulnerability():
    init_db()
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    cursor.execute("SELECT system_stress, evaluation_result, optimization_suggestions FROM simulated_scenarios")
    rows = cursor.fetchall()
    conn.close()
    
    if not rows:
        return {
            "status": "insufficient_data",
            "vulnerability_index": "unknown",
            "primary_bottleneck": "none",
            "recommendation": "Run at least 2 simulation scenarios under varying stress configurations."
        }
        
    total_latency = 0.0
    total_failures = 0.0
    bottleneck_db_count = 0
    bottleneck_api_count = 0
    bottleneck_scale_count = 0
    
    for stress_json, result_json, suggestions_json in rows:
        stress = json.loads(stress_json)
        result = json.loads(result_json)
        sugs = json.loads(suggestions_json)
        
        total_latency += result.get("response_time_ms", 0.0)
        total_failures += stress.get("api_failure_ratio", 0.0)
        
        for s in sugs:
            if "DB_LATENCY" in s:
                bottleneck_db_count += 1
            if "API_RESILIENCE" in s:
                bottleneck_api_count += 1
            if "EDGE_SCALE" in s:
                bottleneck_scale_count += 1
                
    count = len(rows)
    avg_latency = total_latency / count
    avg_failures = total_failures / count
    
    # Determine main vulnerability
    bottlenecks = {
        "Database Latency Constraints": bottleneck_db_count,
        "API Third-Party Resilience": bottleneck_api_count,
        "Edge Horizontal Scale Gateway": bottleneck_scale_count
    }
    
    primary = max(bottlenecks, key=bottlenecks.get)
    if bottlenecks[primary] == 0:
        primary = "None - System is safe"
        vulnerability_level = "LOW"
    else:
        vulnerability_level = "HIGH" if avg_latency > 250.0 or avg_failures > 0.1 else "MEDIUM"
        
    return {
        "scenarios_analyzed": count,
        "average_response_time_ms": round(avg_latency, 2),
        "average_api_failure_ratio": round(avg_failures, 4),
        "primary_bottleneck": primary,
        "vulnerability_index": vulnerability_level,
        "scaling_priorities": {
            "database_cache_multiplier": 1.5 if bottleneck_db_count > 0 else 1.0,
            "circuit_breaker_resilience": "recommended" if bottleneck_api_count > 0 else "optional",
            "horizontal_autoscaling": "required" if bottleneck_scale_count > 0 else "standard"
        }
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
                            "name": "simulation-layer-mcp",
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
                                "name": "run_system_simulation",
                                "description": "Simulate platform user patterns, storms, and traffic stress configurations to evaluate UX dropoffs and output dynamic scaling suggestions.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "name": {"type": "string", "description": "Scenario simulation trial name"},
                                        "user_behavior_preset": {
                                            "type": "string",
                                            "enum": ["booking_surge", "heavy_cancellations", "heavy_map_browsing", "normal"]
                                        },
                                        "environmental_preset": {
                                            "type": "string",
                                            "enum": ["storm", "flat_spell", "perfect_window"]
                                        },
                                        "system_stress_preset": {
                                            "type": "string",
                                            "enum": ["api_failures_high", "db_latency_heavy", "traffic_spike_mega", "none"]
                                        }
                                    },
                                    "required": ["name", "user_behavior_preset", "environmental_preset", "system_stress_preset"]
                                }
                            },
                            {
                                "name": "get_simulation_history",
                                "description": "Retrieve historic system stress scenario runs and metrics.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "limit": {"type": "integer"}
                                    }
                                }
                            },
                            {
                                "name": "evaluate_stress_vulnerability",
                                "description": "Audit across simulation runs to identify database, API, and scale bottlenecks.",
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
                
                if tool_name == "run_system_simulation":
                    nm = args.get("name")
                    u_preset = args.get("user_behavior_preset")
                    e_preset = args.get("environmental_preset")
                    s_preset = args.get("system_stress_preset")
                    res = run_system_simulation(nm, u_preset, e_preset, s_preset)
                    text_out = json.dumps(res, indent=2)
                    
                elif tool_name == "get_simulation_history":
                    lim = args.get("limit", 50)
                    res = get_simulation_history(lim)
                    text_out = json.dumps(res, indent=2)
                    
                elif tool_name == "evaluate_stress_vulnerability":
                    res = evaluate_stress_vulnerability()
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
