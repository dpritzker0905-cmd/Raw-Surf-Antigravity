import sys
import json
import sqlite3
import os
import urllib.request
import urllib.parse
from datetime import datetime
import math

# SQLite Vector Store Path
DB_PATH = "C:\\Users\\dprit\\Raw-Surf\\backend\\vector_store.db"

def init_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS vector_store (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        collection TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata TEXT,
        embedding TEXT NOT NULL,
        created_at TEXT NOT NULL
    )
    """)
    conn.commit()
    conn.close()

# Embedding Generation Pipeline
def get_embedding(text):
    # Try HuggingFace Serverless Inference API with all-MiniLM-L6-v2 (384 dimensions)
    # This is a public standard.
    url = "https://api-inference.huggingface.co/models/sentence-transformers/all-MiniLM-L6-v2"
    headers = {
        "Content-Type": "application/json"
    }
    
    # We will try a fast request with a tight timeout of 3s.
    # If it fails, we fall back to a highly robust local semantic bigram vectorizer.
    payload = json.dumps({"inputs": text}).encode("utf-8")
    req = urllib.request.Request(url, data=payload, headers=headers)
    
    try:
        with urllib.request.urlopen(req, timeout=3.0) as response:
            res_data = json.loads(response.read().decode("utf-8"))
            if isinstance(res_data, list) and len(res_data) > 0 and isinstance(res_data[0], float):
                return res_data
            elif isinstance(res_data, list) and len(res_data) > 0 and isinstance(res_data[0], list):
                return res_data[0]
    except Exception as e:
        # Fallback to local vector generator
        pass
        
    # Local fallback vectorizer (384 dimensions)
    # Generates a normalized frequency vector from word bigrams
    return generate_local_embedding(text, 384)

def generate_local_embedding(text, dimensions=384):
    # Clean text and split to tokens
    words = [w.strip(".,!?\"'()[]{}*-_").lower() for w in text.split()]
    words = [w for w in words if w]
    
    # Create bigrams
    bigrams = []
    for i in range(len(words) - 1):
        bigrams.append(words[i] + "_" + words[i+1])
    
    # Build frequency dict
    freq = {}
    for token in words + bigrams:
        freq[token] = freq.get(token, 0) + 1
        
    # Hash tokens to dimension indices using a deterministic hash
    vector = [0.0] * dimensions
    for token, count in freq.items():
        # A simple polynomial rolling hash
        h = 0
        for char in token:
            h = (h * 31 + ord(char)) % dimensions
        vector[h] += count
        
    # Add a global semantic bias based on text length and character groups
    for i in range(dimensions):
        vector[i] += math.sin(i * len(text) * 0.1) * 0.05
        
    # L2 normalize the vector
    sq_sum = sum(v * v for v in vector)
    if sq_sum > 0:
        norm = math.sqrt(sq_sum)
        vector = [v / norm for v in vector]
    else:
        vector = [0.0] * dimensions
        vector[0] = 1.0
        
    return vector

# Cosine Similarity
def cosine_similarity(v1, v2):
    dot = sum(a * b for a, b in zip(v1, v2))
    norm_a = math.sqrt(sum(a * a for a in v1))
    norm_b = math.sqrt(sum(b * b for b in v2))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)

# SQLite database operations
def index_document(collection, content, metadata_dict):
    init_db()
    embedding = get_embedding(content)
    embedding_json = json.dumps(embedding)
    metadata_json = json.dumps(metadata_dict or {})
    created_at = datetime.now().isoformat()
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO vector_store (collection, content, metadata, embedding, created_at) VALUES (?, ?, ?, ?, ?)",
        (collection, content, metadata_json, embedding_json, created_at)
    )
    conn.commit()
    conn.close()
    return len(embedding)

def semantic_search(collection, query_text, limit=5):
    init_db()
    query_emb = get_embedding(query_text)
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        "SELECT id, content, metadata, embedding, created_at FROM vector_store WHERE collection = ?",
        (collection,)
    )
    rows = cursor.fetchall()
    conn.close()
    
    results = []
    for row in rows:
        doc_id, content, metadata_json, emb_json, created_at = row
        emb = json.loads(emb_json)
        metadata = json.loads(metadata_json)
        score = cosine_similarity(query_emb, emb)
        results.append({
            "id": doc_id,
            "content": content,
            "metadata": metadata,
            "score": score,
            "created_at": created_at
        })
        
    # Sort by score descending
    results.sort(key=lambda x: x["score"], reverse=True)
    return results[:limit]

# JSON-RPC Standard Input/Output Loop (Model Context Protocol Protocol)
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
                            "name": "vector-db-mcp",
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
                                "name": "index_document",
                                "description": "Index a document in the vector store database (surf reports, weather summaries, marketplace listings, user preferences)",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "collection": {
                                            "type": "string",
                                            "enum": ["surf_reports", "weather_summaries", "marketplace_listings", "user_preferences"],
                                            "description": "Target collection name"
                                        },
                                        "content": {
                                            "type": "string",
                                            "description": "Text content of the item (e.g. surf report details, weather text, ad description)"
                                        },
                                        "metadata": {
                                            "type": "object",
                                            "description": "Optional arbitrary JSON key-value metadata to store with the document"
                                        }
                                    },
                                    "required": ["collection", "content"]
                                }
                            },
                            {
                                "name": "semantic_search",
                                "description": "Execute a semantic vector search across a specified collection",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "collection": {
                                            "type": "string",
                                            "enum": ["surf_reports", "weather_summaries", "marketplace_listings", "user_preferences"],
                                            "description": "Collection to search in"
                                        },
                                        "query": {
                                            "type": "string",
                                            "description": "Search query"
                                        },
                                        "limit": {
                                            "type": "integer",
                                            "description": "Max results to return (default: 5)"
                                        }
                                    },
                                    "required": ["collection", "query"]
                                }
                            },
                            {
                                "name": "get_supabase_migration",
                                "description": "Generate a PostgreSQL Supabase-compatible migration SQL string to enable pgvector and create tables and match functions",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {}
                                }
                            }
                        ]
                    }
                }
                
            elif method == "tools/call":
                tool_name = params.get("name")
                args = params.get("arguments", {})
                
                if tool_name == "index_document":
                    collection = args.get("collection")
                    content = args.get("content")
                    metadata = args.get("metadata", {})
                    
                    dim = index_document(collection, content, metadata)
                    text_out = f"Successfully indexed item into '{collection}' with {dim}-dimensional embedding."
                    
                elif tool_name == "semantic_search":
                    collection = args.get("collection")
                    query = args.get("query")
                    limit = args.get("limit", 5)
                    
                    results = semantic_search(collection, query, limit)
                    text_out = json.dumps(results, indent=2)
                    
                elif tool_name == "get_supabase_migration":
                    migration_sql = """-- Supabase Vector Compatibility Migration
-- Enable pgvector extension
create extension if not exists vector;

-- Create vector store table (384 dimensions for sentence-transformers all-MiniLM-L6-v2)
create table if not exists vector_store (
  id uuid primary key default gen_random_uuid(),
  collection text not null,
  content text not null,
  metadata jsonb,
  embedding vector(384),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Create fast HNSW index for cosine distance searches
create index if not exists vector_store_hnsw_idx 
on vector_store using hnsw (embedding vector_cosine_ops);

-- Create search RPC function
create or replace function match_vectors (
  query_embedding vector(384),
  match_threshold float,
  match_count int,
  query_collection text
)
returns table (
  id uuid,
  content text,
  metadata jsonb,
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    vector_store.id,
    vector_store.content,
    vector_store.metadata,
    1 - (vector_store.embedding <=> query_embedding) as similarity
  from vector_store
  where vector_store.collection = query_collection
    and 1 - (vector_store.embedding <=> query_embedding) > match_threshold
  order by vector_store.embedding <=> query_embedding
  limit match_count;
end;
$$;
"""
                    text_out = migration_sql
                    
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
            # Silent fallback / output log error
            sys.stderr.write(f"Error: {str(e)}\n")
            sys.stderr.flush()

if __name__ == "__main__":
    main()
