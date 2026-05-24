import sys
import json
import sqlite3
import math
from datetime import datetime

# SQLite Recommendation Storage Path
DB_PATH = "C:\\Users\\dprit\\Raw-Surf\\backend\\recommendations_store.db"

def init_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Store profiles/embeddings for recommendation caching
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS surfer_recommendation_profiles (
        user_id TEXT PRIMARY KEY,
        skill_level TEXT NOT NULL, -- 'beginner', 'intermediate', 'advanced'
        preferred_board_type TEXT,
        preferred_region TEXT,
        latitude REAL,
        longitude REAL,
        embedding TEXT, -- JSON array (vector(384))
        updated_at TEXT NOT NULL
    )
    """)
    conn.commit()
    conn.close()

# Great Circle Haversine Distance helper
def haversine_distance(lat1, lon1, lat2, lon2):
    R = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    
    a = math.sin(delta_phi := d_phi / 2) ** 2 + \
        math.cos(phi1) * math.cos(phi2) * \
        math.sin(delta_lon := d_lon / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

# Vector Similarity Scoring (Cosine Similarity)
def cosine_similarity(v1, v2):
    dot = sum(a * b for a, b in zip(v1, v2))
    norm_a = math.sqrt(sum(a * a for a in v1))
    norm_b = math.sqrt(sum(b * b for b in v2))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)

# Standard mock embeddings mapping (L2-Normalized Deterministic hashes)
def generate_mock_embedding(text, dimensions=384):
    words = [w.strip(".,!?").lower() for w in text.split()]
    vector = [0.0] * dimensions
    for word in words:
        h = sum(ord(c) for c in word) % dimensions
        vector[h] += 1.0
    
    sq_sum = sum(v * v for v in vector)
    if sq_sum > 0:
        norm = math.sqrt(sq_sum)
        vector = [v / norm for v in vector]
    else:
        vector[0] = 1.0
    return vector

# Core AI Recommendation Algorithms
def recommend_spots(user_skill, user_lat, user_lon, spots_list, current_swell="SSW", current_tide="Rising"):
    recommended = []
    
    for spot in spots_list:
        spot_name = spot.get("name")
        spot_lat = spot.get("latitude")
        spot_lon = spot.get("longitude")
        spot_diff = spot.get("difficulty", "intermediate").lower()
        best_swell = spot.get("best_swell", "S").lower()
        best_tide = spot.get("best_tide", "Rising").lower()
        
        # Calculate geographic distance
        dist = haversine_distance(user_lat, user_lon, spot_lat, spot_lon)
        
        # Score calculation (starts at 100)
        score = 100.0
        
        # 1. Geographic distance penalty (-2 points per 10km, max -30 points)
        score -= min(30.0, (dist / 10.0) * 2.0)
        
        # 2. Skill-level matching (Beginner / Intermediate / Advanced compatibility)
        u_skill = user_skill.lower()
        if u_skill == "beginner":
            if spot_diff == "advanced":
                score -= 60.0  # Massive penalty - too dangerous!
            elif spot_diff == "intermediate":
                score -= 15.0  # Moderate penalty
            elif spot_diff == "beginner":
                score += 20.0  # Match bonus!
        elif u_skill == "advanced":
            if spot_diff == "beginner":
                score -= 20.0  # Too boring for advanced surfer
            elif spot_diff == "advanced":
                score += 25.0  # Epic challenges!
        else: # Intermediate surfer
            if spot_diff == "intermediate":
                score += 20.0
                
        # 3. Surf Conditions Match (Swell direction & Tide alignment)
        if current_swell.lower() in best_swell:
            score += 15.0  # Conditions match bonus!
        if current_tide.lower() in best_tide:
            score += 10.0  # Tide match bonus!
            
        recommended.append({
            "name": spot_name,
            "region": spot.get("region"),
            "difficulty": spot_diff.upper(),
            "distance_km": round(dist, 1),
            "match_score": max(0.0, round(score, 1)),
            "reason": f"Excellent {spot_diff} peak aligning perfectly with your {u_skill} skills."
        })
        
    recommended.sort(key=lambda x: x["match_score"], reverse=True)
    return recommended

def recommend_equipment(user_preferences, user_skill, boards_list):
    # Vector semantic matching between user preferences and board metadata
    user_vector = generate_mock_embedding(user_preferences + " " + user_skill)
    
    recommended = []
    for board in boards_list:
        board_desc = f"{board['model']} {board.get('description', '')} {board.get('volume', 30)}L"
        board_vector = generate_mock_embedding(board_desc)
        
        score = cosine_similarity(user_vector, board_vector)
        
        # Skill-based volume adjustment (Beginners need more volume, Advanced need less)
        volume = board.get("volume", 30.0)
        u_skill = user_skill.lower()
        
        suitability_bonus = 0.0
        if u_skill == "beginner" and volume >= 40.0:
            suitability_bonus = 0.15 # High volume bonus for beginners
        elif u_skill == "advanced" and volume <= 32.0:
            suitability_bonus = 0.15 # Low volume bonus for advanced
            
        composite_score = score + suitability_bonus
        
        recommended.append({
            "model": board["model"],
            "shaper": board.get("shaper", "Al Merrick"),
            "volume_L": volume,
            "price": board.get("price"),
            "similarity_score": round(score, 4),
            "composite_score": round(composite_score, 4),
            "suitability": "Ideal" if composite_score >= 0.25 else "Standard"
        })
        
    recommended.sort(key=lambda x: x["composite_score"], reverse=True)
    return recommended

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
                            "name": "recommendation-engine-mcp",
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
                                "name": "recommend_surf_spots",
                                "description": "Generate dynamic surf spot recommendations matching the surfer's skill level, geographic location coordinates, and swell/tide conditions.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "user_skill": {
                                            "type": "string",
                                            "enum": ["beginner", "intermediate", "advanced"],
                                            "description": "Surfer experience skill level"
                                        },
                                        "user_latitude": {
                                            "type": "number",
                                            "description": "Surfer latitude"
                                        },
                                        "user_longitude": {
                                            "type": "number",
                                            "description": "Surfer longitude"
                                        },
                                        "spots": {
                                            "type": "array",
                                            "items": {
                                                "type": "object",
                                                "properties": {
                                                    "name": {"type": "string"},
                                                    "region": {"type": "string"},
                                                    "latitude": {"type": "number"},
                                                    "longitude": {"type": "number"},
                                                    "difficulty": {"type": "string"},
                                                    "best_swell": {"type": "string"},
                                                    "best_tide": {"type": "string"}
                                                },
                                                "required": ["name", "latitude", "longitude"]
                                            }
                                        },
                                        "current_swell": {
                                            "type": "string",
                                            "description": "Swell direction parameter (e.g. 'SSW')"
                                        },
                                        "current_tide": {
                                            "type": "string",
                                            "description": "Tide status parameter (e.g. 'Rising')"
                                        }
                                    },
                                    "required": ["user_skill", "user_latitude", "user_longitude", "spots"]
                                }
                            },
                            {
                                "name": "recommend_surf_boards",
                                "description": "Generate personalized board recommendations using vector semantic searches between preferences and shaper catalog items.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "user_preferences": {
                                            "type": "string",
                                            "description": "Surfer preference notes (e.g., 'Retro swallow tail fish twin fin')"
                                        },
                                        "user_skill": {
                                            "type": "string",
                                            "enum": ["beginner", "intermediate", "advanced"],
                                            "description": "Surfer skill level"
                                        },
                                        "boards": {
                                            "type": "array",
                                            "items": {
                                                "type": "object",
                                                "properties": {
                                                    "model": {"type": "string"},
                                                    "shaper": {"type": "string"},
                                                    "volume": {"type": "number"},
                                                    "price": {"type": "number"},
                                                    "description": {"type": "string"}
                                                },
                                                "required": ["model", "volume"]
                                            }
                                        }
                                    },
                                    "required": ["user_preferences", "user_skill", "boards"]
                                }
                            }
                        ]
                    }
                }
                
            elif method == "tools/call":
                tool_name = params.get("name")
                args = params.get("arguments", {})
                
                if tool_name == "recommend_surf_spots":
                    skill = args.get("user_skill")
                    lat = args.get("user_latitude")
                    lon = args.get("user_longitude")
                    spots = args.get("spots")
                    swell = args.get("current_swell", "SSW")
                    tide = args.get("current_tide", "Rising")
                    
                    recs = recommend_spots(skill, lat, lon, spots, swell, tide)
                    text_out = json.dumps(recs, indent=2)
                    
                elif tool_name == "recommend_surf_boards":
                    prefs = args.get("user_preferences")
                    skill = args.get("user_skill")
                    boards = args.get("boards")
                    
                    recs = recommend_equipment(prefs, skill, boards)
                    text_out = json.dumps(recs, indent=2)
                    
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
