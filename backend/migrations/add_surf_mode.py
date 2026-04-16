"""Migration using Supabase REST API (pgrest) via requests"""
import requests

SUPABASE_URL = "https://jnfbxcvcbtndtsvscppt.supabase.co"
SUPABASE_KEY = "sb_publishable_JozrdGtw9LTs58w8BAiXKg_k06DoHww"

# Use the Supabase SQL endpoint (requires service role key for DDL)
# We'll use the rpc endpoint with a raw SQL call
headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json"
}

# Test connectivity first
resp = requests.get(f"{SUPABASE_URL}/rest/v1/profiles?select=id&limit=1", headers=headers)
print(f"Connectivity check: {resp.status_code}")

if resp.status_code == 200:
    print("Connected. Column will be added via Supabase dashboard SQL editor.")
    print("SQL to run:")
    print("ALTER TABLE profiles ADD COLUMN IF NOT EXISTS surf_mode VARCHAR(20) DEFAULT 'casual';")
else:
    print(f"Error: {resp.text}")
