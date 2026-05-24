import sys
import json
import sqlite3
import re
from datetime import datetime

# SQLite Reputation DB Path
DB_PATH = "C:\\Users\\dprit\\Raw-Surf\\backend\\reputation_trust.db"

def init_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Moderation Queue Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS moderation_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT NOT NULL, -- 'photographer', 'instructor', 'surfer'
        entity_id TEXT NOT NULL,
        reporter_id TEXT,
        content TEXT NOT NULL,
        spam_score REAL NOT NULL,
        status TEXT DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
        reason TEXT,
        created_at TEXT NOT NULL
    )
    """)
    
    # Reliability Metrics Cache Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS reliability_metrics (
        entity_id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        total_bookings INTEGER DEFAULT 0,
        completed_bookings INTEGER DEFAULT 0,
        cancellations INTEGER DEFAULT 0,
        response_times_sum INTEGER DEFAULT 0, -- in minutes
        response_count INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )
    """)
    conn.commit()
    conn.close()

# Spam / Fraud Detection Engine
def analyze_spam_fraud(content, rating=5, history_checks=None):
    score = 0.0
    reasons = []
    
    # 1. Length checks (too short or empty)
    if len(content.strip()) < 5:
        score += 0.40
        reasons.append("Review content is extremely short.")
        
    # 2. CAPSLOCK checks (screaming reviews)
    uppercase_ratio = sum(1 for c in content if c.isupper()) / (len(content) + 1)
    if uppercase_ratio > 0.60 and len(content) > 10:
        score += 0.30
        reasons.append("Screaming review (excessive uppercase letters).")
        
    # 3. Repeated characters or words (spammy patterns)
    repeated_chars = re.search(r'(.)\1{4,}', content)
    if repeated_chars:
        score += 0.35
        reasons.append("Repeated sequential characters (gibberish/spam).")
        
    # 4. Marketing/Spam keyword alerts
    spam_keywords = ["buy now", "click here", "discount link", "make money", "free crypto", "casino", "follow me"]
    content_lower = content.lower()
    for kw in spam_keywords:
        if kw in content_lower:
            score += 0.50
            reasons.append(f"Spam keyword detected: '{kw}'")
            
    # 5. Rating correlation (perfect reviews with 0 content)
    if rating == 5 and len(content.strip()) < 10 and uppercase_ratio == 0:
        score += 0.20
        reasons.append("Suspiciously short positive rating.")
        
    # Cap score at 1.0
    score = min(1.0, score)
    return {
        "spam_score": round(score, 3),
        "reasons": reasons,
        "is_suspicious": score >= 0.70
    }

# Reputation Score & Trust Badges Generator
def calculate_reputation(entity_id):
    init_db()
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        "SELECT total_bookings, completed_bookings, cancellations, response_times_sum, response_count FROM reliability_metrics WHERE entity_id = ?",
        (entity_id,)
    )
    row = cursor.fetchone()
    conn.close()
    
    if not row:
        # Default / New member stats
        return {
            "entity_id": entity_id,
            "trust_score": 85.0, # High default trust to avoid cold-start penalties
            "metrics": {
                "total_bookings": 0,
                "completion_rate": 100.0,
                "cancellation_rate": 0.0,
                "average_response_time_mins": 15
            },
            "badges": ["Marketplace Pioneer"],
            "status": "New Trust Profile (Pristine Standings)"
        }
        
    total_bookings, completed, cancellations, response_sum, response_count = row
    
    # Calculations
    completion_rate = (completed / total_bookings * 100.0) if total_bookings > 0 else 100.0
    cancellation_rate = (cancellations / total_bookings * 100.0) if total_bookings > 0 else 0.0
    avg_response = (response_sum / response_count) if response_count > 0 else 15
    
    # Trust Score Formula (0 to 100)
    # Starts at 100, decrements for cancellations (-3 per cancel), poor completion, and slow responses
    trust_score = 100.0
    
    # Cancellation penalty
    trust_score -= (cancellations * 5.0)
    
    # Response time penalty (if average response > 60 mins, lose 0.1 points per extra minute, max 15 points)
    if avg_response > 60:
        extra_mins = avg_response - 60
        trust_score -= min(15.0, extra_mins * 0.1)
        
    trust_score = max(10.0, min(100.0, trust_score))
    
    # Dynamic Trust Badges
    badges = []
    if completion_rate >= 98.0 and total_bookings >= 15:
        badges.append("Pristine Completion")
    if avg_response <= 10 and response_count >= 10:
        badges.append("Super Responder")
    if total_bookings >= 30 and trust_score >= 95.0:
        badges.append("Trusted Veteran")
    if len(badges) == 0:
        badges.append("Verified Member")
        
    status = "Outstanding Reputation"
    if trust_score < 70.0:
        status = "Reputation Watchlist (High Cancellations)"
    elif trust_score < 85.0:
        status = "Good Standing"
        
    return {
        "entity_id": entity_id,
        "trust_score": round(trust_score, 1),
        "metrics": {
            "total_bookings": total_bookings,
            "completion_rate": round(completion_rate, 1),
            "cancellation_rate": round(cancellation_rate, 1),
            "average_response_time_mins": int(round(avg_response))
        },
        "badges": badges,
        "status": status
    }

# Moderation Queue CRUD
def add_to_moderation(entity_type, entity_id, reporter_id, content, rating=5):
    init_db()
    analysis = analyze_spam_fraud(content, rating)
    spam_score = analysis["spam_score"]
    created_at = datetime.now().isoformat()
    
    # Automatically set status to approved if clean, otherwise pending
    status = "pending" if spam_score >= 0.70 else "approved"
    reason = "Flagged by AI Spam Engine" if spam_score >= 0.70 else "Auto-approved by AI Clean Check"
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO moderation_queue (entity_type, entity_id, reporter_id, content, spam_score, status, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (entity_type, entity_id, reporter_id, content, spam_score, status, reason, created_at)
    )
    conn.commit()
    conn.close()
    return {
        "spam_analysis": analysis,
        "moderation_status": status,
        "flagged": status == "pending"
    }

def update_moderation_status(review_id, caller_role, action, reason=""):
    init_db()
    # 5. Preserve existing user permissions
    # Strict rule: Only user role 'admin' can execute moderation status updates!
    if caller_role.lower() != "admin":
        raise PermissionError("Access Denied: Only users with 'admin' roles can moderate review queues.")
        
    status = "approved" if action == "approve" else "rejected"
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE moderation_queue SET status = ?, reason = ? WHERE id = ?",
        (status, f"Moderated by Admin: {reason}", review_id)
    )
    conn.commit()
    conn.close()
    return True

# Seed initial reliability metrics
def seed_reliability_metrics(entity_id, entity_type, total, completed, cancels, resp_sum, resp_count):
    init_db()
    now = datetime.now().isoformat()
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        "INSERT OR REPLACE INTO reliability_metrics (entity_id, entity_type, total_bookings, completed_bookings, cancellations, response_times_sum, response_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (entity_id, entity_type, total, completed, cancels, resp_sum, resp_count, now, now)
    )
    conn.commit()
    conn.close()

# JSON-RPC Loop
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
                            "name": "reputation-trust-mcp",
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
                                "name": "calculate_reputation_score",
                                "description": "Retrieve comprehensive reliability index, completion rates, response speeds, and active trust badges for a photographer/instructor.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "entity_id": {
                                            "type": "string",
                                            "description": "Photographer or Instructor profile UUID"
                                        }
                                    },
                                    "required": ["entity_id"]
                                }
                            },
                            {
                                "name": "add_marketplace_review",
                                "description": "Publish a marketplace review through the AI Spam/Fraud scanner, auto-routing spam triggers to the admin moderation queue.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "entity_type": {
                                            "type": "string",
                                            "enum": ["photographer", "instructor"],
                                            "description": "Category being reviewed"
                                        },
                                        "entity_id": {
                                            "type": "string",
                                            "description": "UUID of the profile being reviewed"
                                        },
                                        "reviewer_id": {
                                            "type": "string",
                                            "description": "Surfer UUID publishing the review"
                                        },
                                        "content": {
                                            "type": "string",
                                            "description": "Textual review narrative"
                                        },
                                        "rating": {
                                            "type": "integer",
                                            "minimum": 1,
                                            "maximum": 5,
                                            "description": "Rating score from 1 to 5 stars"
                                        }
                                    },
                                    "required": ["entity_type", "entity_id", "reviewer_id", "content", "rating"]
                                }
                            },
                            {
                                "name": "get_moderation_queue",
                                "description": "Retrieve reviews flagged for administrative moderation (Requires admin credentials).",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "caller_role": {
                                            "type": "string",
                                            "description": "Access role profile of the calling user ('admin', 'surfer', 'photographer')"
                                        }
                                    },
                                    "required": ["caller_role"]
                                }
                            },
                            {
                                "name": "admin_moderate_review",
                                "description": "Moderate a pending review by approving or rejecting it (Requires strict admin permissions).",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "review_id": {
                                            "type": "integer",
                                            "description": "Moderation ID of the review"
                                        },
                                        "caller_role": {
                                            "type": "string",
                                            "description": "Caller user role (Must be 'admin')"
                                        },
                                        "action": {
                                            "type": "string",
                                            "enum": ["approve", "reject"],
                                            "description": "Moderation decision"
                                        },
                                        "reason": {
                                            "type": "string",
                                            "description": "Moderation rationale notes"
                                        }
                                    },
                                    "required": ["review_id", "caller_role", "action", "reason"]
                                }
                            }
                        ]
                    }
                }
                
            elif method == "tools/call":
                tool_name = params.get("name")
                args = params.get("arguments", {})
                
                if tool_name == "calculate_reputation_score":
                    ent_id = args.get("entity_id")
                    rep = calculate_reputation(ent_id)
                    text_out = json.dumps(rep, indent=2)
                    
                elif tool_name == "add_marketplace_review":
                    e_type = args.get("entity_type")
                    e_id = args.get("entity_id")
                    rev_id = args.get("reviewer_id")
                    content = args.get("content")
                    rating = args.get("rating")
                    
                    res = add_to_moderation(e_type, e_id, rev_id, content, rating)
                    text_out = json.dumps(res, indent=2)
                    
                elif tool_name == "get_moderation_queue":
                    caller_role = args.get("caller_role", "surfer")
                    if caller_role.lower() != "admin":
                        text_out = "Access Denied: Only users with 'admin' roles can read moderation queues."
                    else:
                        conn = sqlite3.connect(DB_PATH)
                        cursor = conn.cursor()
                        cursor.execute("SELECT id, entity_type, entity_id, reporter_id, content, spam_score, status, reason FROM moderation_queue WHERE status = 'pending'")
                        rows = cursor.fetchall()
                        conn.close()
                        
                        queue = []
                        for r in rows:
                            queue.append({
                                "id": r[0], "entity_type": r[1], "entity_id": r[2], 
                                "reporter_id": r[3], "content": r[4], "spam_score": r[5], 
                                "status": r[6], "reason": r[7]
                            })
                        text_out = json.dumps(queue, indent=2)
                        
                elif tool_name == "admin_moderate_review":
                    rev_id = args.get("review_id")
                    caller_role = args.get("caller_role")
                    action = args.get("action")
                    reason = args.get("reason")
                    
                    try:
                        update_moderation_status(rev_id, caller_role, action, reason)
                        text_out = f"Review #{rev_id} successfully moderated: {action.upper()}ED."
                    except Exception as err:
                        text_out = f"Error: {str(err)}"
                        
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
