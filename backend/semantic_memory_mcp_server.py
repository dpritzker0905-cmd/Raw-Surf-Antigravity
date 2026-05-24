import sys
import json
import sqlite3
import uuid
import os
import urllib.request
import urllib.parse
from datetime import datetime, timezone
import math

# SQLite Semantic Memory DB Path
DB_PATH = "C:\\Users\\dprit\\Raw-Surf\\backend\\semantic_memory.db"

def init_db():
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    
    # 1. Semantic Memory Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS semantic_memory (
        memory_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL, -- 'surf_history', 'booking_history', 'wave_conditions', 'feedback'
        content TEXT NOT NULL,
        metadata TEXT, -- JSON key-value properties
        embedding TEXT NOT NULL, -- JSON list of 384 elements
        created_at TEXT NOT NULL -- ISO 8601 UTC
    )
    """)
    
    # Privacy safe partitioning index
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_semantic_memory_user_id ON semantic_memory(user_id)")
    
    conn.commit()
    conn.close()

# Deterministic / HF Vectorizer (384 Dimensions)
def get_embedding(text):
    url = "https://api-inference.huggingface.co/models/sentence-transformers/all-MiniLM-L6-v2"
    headers = {"Content-Type": "application/json"}
    payload = json.dumps({"inputs": text}).encode("utf-8")
    req = urllib.request.Request(url, data=payload, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=3.0) as response:
            res_data = json.loads(response.read().decode("utf-8"))
            if isinstance(res_data, list) and len(res_data) > 0 and isinstance(res_data[0], float):
                return res_data
            elif isinstance(res_data, list) and len(res_data) > 0 and isinstance(res_data[0], list):
                return res_data[0]
    except:
        pass
    return generate_local_embedding(text, 384)

def generate_local_embedding(text, dimensions=384):
    words = [w.strip(".,!?\"'()[]{}*-_").lower() for w in text.split()]
    words = [w for w in words if w]
    bigrams = []
    for i in range(len(words) - 1):
        bigrams.append(words[i] + "_" + words[i+1])
    
    freq = {}
    for token in words + bigrams:
        freq[token] = freq.get(token, 0) + 1
        
    vector = [0.0] * dimensions
    for token, count in freq.items():
        h = 0
        for char in token:
            h = (h * 31 + ord(char)) % dimensions
        vector[h] += count
        
    for i in range(dimensions):
        vector[i] += math.sin(i * len(text) * 0.1) * 0.05
        
    sq_sum = sum(v * v for v in vector)
    if sq_sum > 0:
        norm = math.sqrt(sq_sum)
        vector = [v / norm for v in vector]
    else:
        vector = [0.0] * dimensions
        vector[0] = 1.0
    return vector

def cosine_similarity(v1, v2):
    dot = sum(a * b for a, b in zip(v1, v2))
    norm_a = math.sqrt(sum(a * a for a in v1))
    norm_b = math.sqrt(sum(b * b for b in v2))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)

# 1. Store Memory
def store_memory(user_id, memory_type, content, metadata=None, created_at=None):
    init_db()
    
    if not created_at:
        created_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        
    memory_id = f"mem_{uuid.uuid4().hex[:12]}"
    emb = get_embedding(content)
    
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO semantic_memory (memory_id, user_id, type, content, metadata, embedding, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (memory_id, user_id, memory_type, content, json.dumps(metadata or {}), json.dumps(emb), created_at))
    
    conn.commit()
    conn.close()
    
    return {
        "success": True,
        "memory_id": memory_id,
        "user_id": user_id,
        "type": memory_type,
        "timestamp": created_at
    }

# 2. Retrieve Similar Memories (Time-Decayed & Partitioned)
def retrieve_similar_memories(user_id, query, memory_type=None, limit=5, decay_lambda=0.05):
    init_db()
    query_emb = get_embedding(query)
    
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    
    if memory_type:
        cursor.execute("""
        SELECT memory_id, type, content, metadata, embedding, created_at 
        FROM semantic_memory WHERE user_id = ? AND type = ?
        """, (user_id, memory_type))
    else:
        cursor.execute("""
        SELECT memory_id, type, content, metadata, embedding, created_at 
        FROM semantic_memory WHERE user_id = ?
        """, (user_id,))
        
    rows = cursor.fetchall()
    conn.close()
    
    now = datetime.now(timezone.utc)
    results = []
    
    for row in rows:
        mem_id, m_type, content, meta_json, emb_json, created_str = row
        meta = json.loads(meta_json)
        emb = json.loads(emb_json)
        
        # Calculate raw cosine similarity
        raw_score = cosine_similarity(query_emb, emb)
        
        # Calculate age in days for decay weighting
        try:
            created_dt = datetime.fromisoformat(created_str.replace("Z", "+00:00"))
            age_days = (now - created_dt).total_seconds() / 86400.0
            age_days = max(0.0, age_days)
        except Exception:
            age_days = 0.0
            
        # Apply exponential decay: score = raw * exp(-lambda * days)
        decay_weight = math.exp(-decay_lambda * age_days)
        decayed_score = raw_score * decay_weight
        
        results.append({
            "memory_id": mem_id,
            "type": m_type,
            "content": content,
            "metadata": meta,
            "raw_score": raw_score,
            "decayed_score": decayed_score,
            "age_days": round(age_days, 2),
            "decay_weight": round(decay_weight, 4),
            "created_at": created_str
        })
        
    # Sort descending by decayed score
    results.sort(key=lambda x: x["decayed_score"], reverse=True)
    return results[:limit]

# 3. Connect Memory to Recommendation Engine: preferred wave/surf conditions per user
def get_user_preferred_conditions(user_id):
    init_db()
    
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    cursor.execute("""
    SELECT metadata, created_at FROM semantic_memory 
    WHERE user_id = ? AND type IN ('surf_history', 'feedback')
    """, (user_id,))
    rows = cursor.fetchall()
    conn.close()
    
    now = datetime.now(timezone.utc)
    spots = {}
    swell_directions = {}
    tide_cycles = {}
    swell_heights = []
    
    # Process positive sessions (rating >= 4 or positive description context)
    for meta_json, created_str in rows:
        meta = json.loads(meta_json)
        rating = float(meta.get("rating", 5.0))
        
        # We only aggregate preferred settings from highly positive experiences (rating >= 4.0)
        if rating < 4.0:
            continue
            
        try:
            created_dt = datetime.fromisoformat(created_str.replace("Z", "+00:00"))
            age_days = (now - created_dt).total_seconds() / 86400.0
            age_days = max(0.0, age_days)
        except:
            age_days = 0.0
            
        # Apply decay weight to votes/frequencies
        weight = math.exp(-0.03 * age_days) # slower decay for long term preferences
        
        # Spot frequency
        spot = meta.get("spot_name")
        if spot:
            spots[spot] = spots.get(spot, 0.0) + weight
            
        # Swell direction
        s_dir = meta.get("swell_direction")
        if s_dir:
            swell_directions[s_dir] = swell_directions.get(s_dir, 0.0) + weight
            
        # Tide cycle
        tide = meta.get("tide_cycle")
        if tide:
            tide_cycles[tide] = tide_cycles.get(tide, 0.0) + weight
            
        # Swell heights list
        s_height = meta.get("swell_height_ft")
        if s_height is not None:
            swell_heights.append((float(s_height), weight))
            
    # Calculate weighted metrics
    pref_spot = max(spots, key=spots.get) if spots else "Malibu"
    pref_swell_dir = max(swell_directions, key=swell_directions.get) if swell_directions else "S"
    pref_tide = max(tide_cycles, key=tide_cycles.get) if tide_cycles else "Rising"
    
    avg_swell_height = 5.0
    if swell_heights:
        tot_w = sum(w for h, w in swell_heights)
        if tot_w > 0:
            avg_swell_height = sum(h * w for h, w in swell_heights) / tot_w
            
    return {
        "user_id": user_id,
        "preferred_spot": pref_spot,
        "preferred_swell_direction": pref_swell_dir,
        "preferred_tide": pref_tide,
        "preferred_swell_height_ft": round(avg_swell_height, 2),
        "total_sessions_analyzed": len(rows),
        "status": "profile_computed" if len(swell_heights) > 0 else "baseline_defaults"
    }

# 4. Predict Repeat Booking
def predict_repeat_booking(user_id, spot_name):
    init_db()
    
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    cursor.execute("""
    SELECT metadata, created_at, content FROM semantic_memory 
    WHERE user_id = ? AND type IN ('booking_history', 'feedback')
    """, (user_id,))
    rows = cursor.fetchall()
    conn.close()
    
    now = datetime.now(timezone.utc)
    spot_bookings_count = 0
    sentiment_score = 0.0
    sentiment_count = 0
    recency_bonus = 0.0
    
    for meta_json, created_str, content in rows:
        meta = json.loads(meta_json)
        meta_spot = meta.get("spot_name")
        if not meta_spot or meta_spot.lower() != spot_name.lower():
            continue
            
        spot_bookings_count += 1
        
        # Calculate recency bonus
        try:
            created_dt = datetime.fromisoformat(created_str.replace("Z", "+00:00"))
            age_days = (now - created_dt).total_seconds() / 86400.0
            age_days = max(0.0, age_days)
        except:
            age_days = 100.0
            
        if age_days < 10.0:
            recency_bonus += 15.0
        elif age_days < 30.0:
            recency_bonus += 5.0
            
        # Rating extraction
        rating = float(meta.get("rating", 5.0))
        sentiment_score += (rating - 3.0) * 20.0 # Map 1-5 stars to -40 to +40 sentiment points
        sentiment_count += 1
        
    # Baseline probability is 30% if they know the spot
    if spot_bookings_count == 0:
        return {
            "user_id": user_id,
            "spot_name": spot_name,
            "repeat_probability_percentage": 10.0,
            "rationale": f"No past session bookings or feedback found for {spot_name} in user semantic memory."
        }
        
    avg_sentiment = (sentiment_score / sentiment_count) if sentiment_count > 0 else 0.0
    frequency_bonus = min(30.0, spot_bookings_count * 10.0)
    
    final_probability = 40.0 + avg_sentiment + frequency_bonus + recency_bonus
    final_probability = max(5.0, min(98.0, final_probability))
    
    rationale = (
        f"Surfer has booked {spot_bookings_count} sessions at {spot_name}. "
        f"Feedback shows an average satisfaction sentiment of {avg_sentiment:+.1f} points, "
        f"with a recency score bonus of {recency_bonus:+.1f}% based on booking gaps."
    )
    
    return {
        "user_id": user_id,
        "spot_name": spot_name,
        "repeat_probability_percentage": round(final_probability, 1),
        "total_past_bookings_at_spot": spot_bookings_count,
        "rationale": rationale
    }

# 5. Retrieve Decayed surfs vector profile
def get_surfer_memory_profile(user_id):
    init_db()
    
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    cursor = conn.cursor()
    cursor.execute("""
    SELECT embedding, created_at FROM semantic_memory 
    WHERE user_id = ? AND type IN ('surf_history', 'feedback')
    """, (user_id,))
    rows = cursor.fetchall()
    conn.close()
    
    if not rows:
        # Default mock 384 dimensional vector
        default_vector = [0.0] * 384
        default_vector[0] = 1.0
        return {
            "user_id": user_id,
            "decayed_profile_vector": default_vector,
            "total_memories_counted": 0
        }
        
    now = datetime.now(timezone.utc)
    accumulated_vector = [0.0] * 384
    total_weight = 0.0
    
    for emb_json, created_str in rows:
        emb = json.loads(emb_json)
        try:
            created_dt = datetime.fromisoformat(created_str.replace("Z", "+00:00"))
            age_days = (now - created_dt).total_seconds() / 86400.0
            age_days = max(0.0, age_days)
        except:
            age_days = 0.0
            
        # Apply exponential decay decay_lambda=0.05
        weight = math.exp(-0.05 * age_days)
        
        for i in range(384):
            accumulated_vector[i] += emb[i] * weight
        total_weight += weight
        
    # Re-normalize the aggregated preference vector
    if total_weight > 0:
        sq_sum = sum(v * v for v in accumulated_vector)
        if sq_sum > 0:
            norm = math.sqrt(sq_sum)
            accumulated_vector = [v / norm for v in accumulated_vector]
            
    return {
        "user_id": user_id,
        "decayed_profile_vector": accumulated_vector,
        "total_memories_counted": len(rows),
        "accumulated_weight": round(total_weight, 4)
    }

# JSON-RPC Model Context Protocol Handshake loop
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
                            "name": "semantic-memory-mcp",
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
                                "name": "store_memory",
                                "description": "Index user-specific surf history, booking info, wave conditions, or feedback with 384 dimensional embeddings.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "user_id": {"type": "string", "description": "Target surfer unique ID"},
                                        "type": {
                                            "type": "string", 
                                            "enum": ["surf_history", "booking_history", "wave_conditions", "feedback"]
                                        },
                                        "content": {"type": "string", "description": "Raw text summary description"},
                                        "metadata": {"type": "object", "description": "JSON metadata dict"},
                                        "created_at": {"type": "string", "description": "Optional ISO 8601 string for backdating tests"}
                                    },
                                    "required": ["user_id", "type", "content"]
                                }
                            },
                            {
                                "name": "retrieve_similar_memories",
                                "description": "Query time-decayed similar sessions or reviews strictly partitioned to a specific user_id.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "user_id": {"type": "string"},
                                        "query": {"type": "string"},
                                        "type": {"type": "string", "enum": ["surf_history", "booking_history", "wave_conditions", "feedback"]},
                                        "limit": {"type": "integer"},
                                        "decay_lambda": {"type": "number", "description": "Exponential time decay rate (default: 0.05)"}
                                    },
                                    "required": ["user_id", "query"]
                                }
                            },
                            {
                                "name": "get_user_preferred_conditions",
                                "description": "Aggregate a surfer's highest rated surf histories to output preferred spots, tides, and swell directions.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "user_id": {"type": "string"}
                                    },
                                    "required": ["user_id"]
                                }
                            },
                            {
                                "name": "predict_repeat_booking",
                                "description": "Calculate dynamic probability rate showing likelihood of a repeat booking reservation based on booking frequency and feedback ratings.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "user_id": {"type": "string"},
                                        "spot_name": {"type": "string"}
                                    },
                                    "required": ["user_id", "spot_name"]
                                }
                            },
                            {
                                "name": "get_surfer_memory_profile",
                                "description": "Build a time-decayed 384 dimensional preference vector to connect directly with the recommendation engine.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "user_id": {"type": "string"}
                                    },
                                    "required": ["user_id"]
                                }
                            }
                        ]
                    }
                }
                
            elif method == "tools/call":
                tool_name = params.get("name")
                args = params.get("arguments", {})
                
                if tool_name == "store_memory":
                    u_id = args.get("user_id")
                    m_type = args.get("type")
                    cnt = args.get("content")
                    meta = args.get("metadata", {})
                    ts = args.get("created_at")
                    res = store_memory(u_id, m_type, cnt, meta, ts)
                    text_out = json.dumps(res, indent=2)
                    
                elif tool_name == "retrieve_similar_memories":
                    u_id = args.get("user_id")
                    qry = args.get("query")
                    m_type = args.get("type")
                    lim = args.get("limit", 5)
                    lam = args.get("decay_lambda", 0.05)
                    res = retrieve_similar_memories(u_id, qry, m_type, lim, lam)
                    text_out = json.dumps(res, indent=2)
                    
                elif tool_name == "get_user_preferred_conditions":
                    u_id = args.get("user_id")
                    res = get_user_preferred_conditions(u_id)
                    text_out = json.dumps(res, indent=2)
                    
                elif tool_name == "predict_repeat_booking":
                    u_id = args.get("user_id")
                    spot = args.get("spot_name")
                    res = predict_repeat_booking(u_id, spot)
                    text_out = json.dumps(res, indent=2)
                    
                elif tool_name == "get_surfer_memory_profile":
                    u_id = args.get("user_id")
                    res = get_surfer_memory_profile(u_id)
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
