import sys
import json
import sqlite3
import uuid
import os
from datetime import datetime, timezone

# SQLite World Model Caching Path
DB_PATH = "C:\\Users\\dprit\\Raw-Surf\\backend\\world_model_intel.db"

def init_db():
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    
    # 1. Weather and Ocean Data table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS weather_ocean_data (
        spot_name TEXT PRIMARY KEY,
        swell_height_ft REAL NOT NULL,
        swell_period_sec INTEGER NOT NULL,
        swell_direction TEXT NOT NULL,
        wind_speed_mph REAL NOT NULL,
        wind_direction TEXT NOT NULL,
        tide_cycle TEXT NOT NULL, -- 'low', 'rising', 'high', 'falling'
        latitude REAL,
        longitude REAL,
        timestamp TEXT NOT NULL
    )
    """)
    
    # 2. Business Correlation Logs table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS business_correlation_logs (
        log_id TEXT PRIMARY KEY,
        spot_name TEXT NOT NULL,
        bookings_count INTEGER DEFAULT 0,
        cancellations_count INTEGER DEFAULT 0,
        wave_quality_score REAL NOT NULL,
        timestamp TEXT NOT NULL
    )
    """)
    
    conn.commit()
    conn.close()

# Derived metric calculation utility
def calculate_derived_metrics(height, period, wind_dir, tide):
    # 1. Surf Quality Score (0-100)
    score = 50.0
    
    # Swell Height Suitability
    if 3.0 <= height <= 8.0:
        score += 20.0
    elif height > 8.0:
        score += 10.0
    else:
        score -= 20.0
        
    # Swell Period Suitability
    if period >= 14:
        score += 15.0
    elif 10 <= period < 14:
        score += 5.0
    else:
        score -= 10.0
        
    # Wind Direction (Offshore wind is golden)
    w_dir = wind_dir.lower()
    if "offshore" in w_dir:
        score += 15.0
    elif "onshore" in w_dir:
        score -= 25.0
        
    # Tide alignment
    t_cycle = tide.lower()
    if t_cycle in ("rising", "low"):
        score += 10.0
        
    final_score = max(0.0, min(100.0, score))
    
    # 2. Crowd Probability Index ('low', 'medium', 'high')
    if final_score >= 75.0:
        crowd = "high"
    elif 45.0 <= final_score < 75.0:
        crowd = "medium"
    else:
        crowd = "low"
        
    # 3. Session Suitability
    if height >= 7.0:
        suitability = "advanced"
    elif 4.0 <= height < 7.0:
        suitability = "intermediate"
    else:
        suitability = "beginner"
        
    return {
        "surf_quality_score": final_score,
        "crowd_probability_index": crowd,
        "suitability_level": suitability
    }

# Ingest and correlate weather/ocean parameters
def ingest_weather_ocean_data(spot_name, swell_height_ft, swell_period_sec, swell_direction, wind_speed_mph, wind_direction, tide_cycle, latitude=34.0, longitude=-118.0):
    init_db()
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    
    timestamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    
    cursor.execute("""
    INSERT OR REPLACE INTO weather_ocean_data (spot_name, swell_height_ft, swell_period_sec, swell_direction, wind_speed_mph, wind_direction, tide_cycle, latitude, longitude, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (spot_name, swell_height_ft, swell_period_sec, swell_direction, wind_speed_mph, wind_direction, tide_cycle, latitude, longitude, timestamp))
    
    # Generate business correlation data
    log_id = f"cor_{uuid.uuid4().hex[:12]}"
    insights = calculate_derived_metrics(swell_height_ft, swell_period_sec, wind_direction, tide_cycle)
    q_score = insights["surf_quality_score"]
    
    # High wave quality = high bookings & near zero cancellations
    # Low wave quality = low bookings & high cancellations
    if q_score >= 70:
        bookings = int(10 + (q_score - 70) * 0.5)
        cancels = int(max(0, 2 - (q_score - 70) * 0.1))
    else:
        bookings = int(max(1, int(q_score / 6)))
        cancels = int(int((70 - q_score) / 8))
        
    cursor.execute("""
    INSERT INTO business_correlation_logs (log_id, spot_name, bookings_count, cancellations_count, wave_quality_score, timestamp)
    VALUES (?, ?, ?, ?, ?, ?)
    """, (log_id, spot_name, bookings, cancels, q_score, timestamp))
    
    conn.commit()
    conn.close()
    
    return {
        "success": True,
        "spot_name": spot_name,
        "derived_insights": insights,
        "business_correlation": {
            "bookings_simulated": bookings,
            "cancellations_simulated": cancels
        }
    }

# Derived insights tool
def get_surf_spot_insights(spot_name, user_skill):
    init_db()
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    cursor.execute("""
    SELECT swell_height_ft, swell_period_sec, swell_direction, wind_speed_mph, wind_direction, tide_cycle, latitude, longitude 
    FROM weather_ocean_data WHERE spot_name = ?
    """, (spot_name,))
    row = cursor.fetchone()
    conn.close()
    
    if not row:
        return {"success": False, "error": f"Spot '{spot_name}' weather details not found."}
        
    height, period, swell_dir, wind_spd, wind_dir, tide, lat, lon = row
    metrics = calculate_derived_metrics(height, period, wind_dir, tide)
    
    # Evaluate skill suitability Warning
    u_skill = user_skill.lower()
    s_level = metrics["suitability_level"]
    compatible = True
    warning = None
    
    if u_skill == "beginner" and s_level == "advanced":
        compatible = False
        warning = "Danger! Swells exceed safe beginner thresholds."
    elif u_skill == "advanced" and s_level == "beginner":
        warning = "Notice: Soft/small waves may feel slow for advanced surfers."
        
    return {
        "spot_name": spot_name,
        "coordinates": {"latitude": lat, "longitude": lon},
        "raw_conditions": {
            "swell_height_ft": height,
            "swell_period_sec": period,
            "swell_direction": swell_dir,
            "wind_speed_mph": wind_spd,
            "wind_direction": wind_dir,
            "tide_cycle": tide
        },
        "derived_insights": {
            "surf_quality_score": metrics["surf_quality_score"],
            "crowd_probability_index": metrics["crowd_probability_index"].upper(),
            "ideal_skill_level": s_level.upper(),
            "skill_compatibility": {
                "user_skill": u_skill.upper(),
                "is_compatible": compatible,
                "warning_message": warning
            }
        }
    }

# Best surf spots next 24h
def get_best_surf_spots_24h(user_skill):
    init_db()
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    cursor.execute("""
    SELECT spot_name, swell_height_ft, swell_period_sec, swell_direction, wind_speed_mph, wind_direction, tide_cycle 
    FROM weather_ocean_data
    """)
    rows = cursor.fetchall()
    conn.close()
    
    spots_recs = []
    for row in rows:
        name, height, period, swell_dir, wind_spd, wind_dir, tide = row
        metrics = calculate_derived_metrics(height, period, wind_dir, tide)
        
        # Unsafe skill filter
        s_level = metrics["suitability_level"]
        if user_skill.lower() == "beginner" and s_level == "advanced":
            continue
            
        spots_recs.append({
            "spot_name": name,
            "surf_quality_score": metrics["surf_quality_score"],
            "crowd_probability_index": metrics["crowd_probability_index"].upper(),
            "suitability": s_level.upper()
        })
        
    spots_recs.sort(key=lambda x: x["surf_quality_score"], reverse=True)
    return spots_recs

# Crowd level predictions
def get_expected_crowds_by_beach():
    init_db()
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    cursor.execute("SELECT spot_name, swell_height_ft, swell_period_sec, wind_direction, tide_cycle FROM weather_ocean_data")
    rows = cursor.fetchall()
    conn.close()
    
    crowd_report = []
    for row in rows:
        name, height, period, wind_dir, tide = row
        metrics = calculate_derived_metrics(height, period, wind_dir, tide)
        crowd_report.append({
            "spot_name": name,
            "expected_crowd_level": metrics["crowd_probability_index"].upper(),
            "surf_quality_score": metrics["surf_quality_score"]
        })
    return crowd_report

# Photography windows
def get_optimal_photography_windows(spot_name):
    init_db()
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    cursor.execute("SELECT swell_height_ft, swell_period_sec, wind_direction, tide_cycle FROM weather_ocean_data WHERE spot_name = ?", (spot_name,))
    row = cursor.fetchone()
    conn.close()
    
    if not row:
        return {"success": False, "error": f"Spot '{spot_name}' weather details not found."}
        
    height, period, wind_dir, tide = row
    metrics = calculate_derived_metrics(height, period, wind_dir, tide)
    q_score = metrics["surf_quality_score"]
    
    windows = []
    if "offshore" in wind_dir.lower() and q_score >= 60.0:
        windows.append({
            "time_window": "Golden Hour Morning (06:00 - 08:30)",
            "suitability": "PRIME",
            "reason": f"Perfect golden morning lighting aligning with offshore winds grooming {height}ft swells."
        })
        windows.append({
            "time_window": "Golden Hour Sunset (17:30 - 19:30)",
            "suitability": "PRIME",
            "reason": "Glassy evening wind peaks framing beautiful side-lit breaking sets."
        })
    else:
        windows.append({
            "time_window": "Midday Window (11:00 - 14:00)",
            "suitability": "STANDARD",
            "reason": "Standard direct vertical lighting. Glass waves but minimal side cast shadows."
        })
        
    return {
        "spot_name": spot_name,
        "wave_quality_score": q_score,
        "photography_suitability_windows": windows
    }

# MapLibre GeoJSON layer exporter
def generate_maplibre_weather_geojson():
    init_db()
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    cursor.execute("SELECT spot_name, swell_height_ft, wind_speed_mph, wind_direction, tide_cycle, latitude, longitude FROM weather_ocean_data")
    rows = cursor.fetchall()
    conn.close()
    
    features = []
    for row in rows:
        name, height, wind_spd, wind_dir, tide, lat, lon = row
        metrics = calculate_derived_metrics(height, 12, wind_dir, tide)
        
        features.append({
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [lon, lat]
            },
            "properties": {
                "spot_name": name,
                "swell_height_ft": height,
                "wind_conditions": f"{wind_spd}mph {wind_dir}",
                "tide_cycle": tide.upper(),
                "surf_quality_score": metrics["surf_quality_score"],
                "crowd_probability": metrics["crowd_probability_index"].upper(),
                "marker_color": "#FF4500" if metrics["surf_quality_score"] >= 70.0 else "#FFD700" if metrics["surf_quality_score"] >= 45.0 else "#1E90FF"
            }
        })
        
    return {
        "type": "FeatureCollection",
        "metadata": {
            "title": "Raw Surf MapLibre Weather Intelligence Layer",
            "generated_at": datetime.now(timezone.utc).isoformat()
        },
        "features": features
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
                            "name": "world-model-mcp",
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
                                "name": "ingest_weather_ocean_data",
                                "description": "Ingest weather/ocean parameters (swell, wind, tide, coordinates) for a beach spot and calculate derived correlation metrics.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "spot_name": {"type": "string"},
                                        "swell_height_ft": {"type": "number"},
                                        "swell_period_sec": {"type": "integer"},
                                        "swell_direction": {"type": "string"},
                                        "wind_speed_mph": {"type": "number"},
                                        "wind_direction": {"type": "string"},
                                        "tide_cycle": {"type": "string", "enum": ["low", "rising", "high", "falling"]},
                                        "latitude": {"type": "number"},
                                        "longitude": {"type": "number"}
                                    },
                                    "required": ["spot_name", "swell_height_ft", "swell_period_sec", "swell_direction", "wind_speed_mph", "wind_direction", "tide_cycle"]
                                }
                            },
                            {
                                "name": "get_surf_spot_insights",
                                "description": "Calculate derived surf scores, crowd index, session suitability levels, and skills compatibility checks.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "spot_name": {"type": "string"},
                                        "user_skill": {"type": "string", "enum": ["beginner", "intermediate", "advanced"]}
                                    },
                                    "required": ["spot_name", "user_skill"]
                                }
                            },
                            {
                                "name": "get_best_surf_spots_24h",
                                "description": "Retrieve optimal surf spots sorted by derived surf quality over the next 24 hours.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "user_skill": {"type": "string", "enum": ["beginner", "intermediate", "advanced"]}
                                    },
                                    "required": ["user_skill"]
                                }
                            },
                            {
                                "name": "get_expected_crowds_by_beach",
                                "description": "Query expected surfer crowd density predictions across all beach locations.",
                                "inputSchema": {
                                    "type": "object"
                                }
                            },
                            {
                                "name": "get_optimal_photography_windows",
                                "description": "Identify prime golden hour morning and evening camera shooting windows at a surf spot.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "spot_name": {"type": "string"}
                                    },
                                    "required": ["spot_name"]
                                }
                            },
                            {
                                "name": "generate_maplibre_weather_geojson",
                                "description": "Export weather intelligence coordinates, scores, and marker color hex properties formatted in MapLibre GeoJSON format.",
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
                
                if tool_name == "ingest_weather_ocean_data":
                    name = args.get("spot_name")
                    height = args.get("swell_height_ft")
                    period = args.get("swell_period_sec")
                    s_dir = args.get("swell_direction")
                    w_spd = args.get("wind_speed_mph")
                    w_dir = args.get("wind_direction")
                    tide = args.get("tide_cycle")
                    lat = args.get("latitude", 34.0)
                    lon = args.get("longitude", -118.0)
                    res = ingest_weather_ocean_data(name, height, period, s_dir, w_spd, w_dir, tide, lat, lon)
                    text_out = json.dumps(res, indent=2)
                    
                elif tool_name == "get_surf_spot_insights":
                    name = args.get("spot_name")
                    skill = args.get("user_skill")
                    res = get_surf_spot_insights(name, skill)
                    text_out = json.dumps(res, indent=2)
                    
                elif tool_name == "get_best_surf_spots_24h":
                    skill = args.get("user_skill")
                    res = get_best_surf_spots_24h(skill)
                    text_out = json.dumps(res, indent=2)
                    
                elif tool_name == "get_expected_crowds_by_beach":
                    res = get_expected_crowds_by_beach()
                    text_out = json.dumps(res, indent=2)
                    
                elif tool_name == "get_optimal_photography_windows":
                    name = args.get("spot_name")
                    res = get_optimal_photography_windows(name)
                    text_out = json.dumps(res, indent=2)
                    
                elif tool_name == "generate_maplibre_weather_geojson":
                    res = generate_maplibre_weather_geojson()
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
