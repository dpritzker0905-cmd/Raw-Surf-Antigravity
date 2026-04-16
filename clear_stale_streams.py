import psycopg2
from datetime import datetime, timezone

# Connect directly to Supabase Postgres
conn = psycopg2.connect(
    "postgresql://postgres.jnfbxcvcbtndtsvscppt:TahwPfXZyTt8L8Rr@aws-0-us-east-2.pooler.supabase.com:6543/postgres",
    connect_timeout=10
)
conn.autocommit = True
cur = conn.cursor()

# First, show what stale streams exist
cur.execute("""
    SELECT id, broadcaster_id, status, started_at, title
    FROM social_live_streams
    WHERE status = 'live'
    ORDER BY started_at DESC
""")
rows = cur.fetchall()
print(f"Found {len(rows)} live stream(s) in DB:")
for r in rows:
    print(f"  id={r[0]}  broadcaster={r[1]}  status={r[2]}  started={r[3]}  title={r[4]}")

# Force-end ALL stuck 'live' streams now
cur.execute("""
    UPDATE social_live_streams
    SET status = 'ended',
        ended_at = NOW()
    WHERE status = 'live'
""")
print(f"\nCleared all stale live streams.")

# Also reset is_live flag on all profiles
cur.execute("""
    UPDATE profiles
    SET is_live = false
    WHERE is_live = true
""")
print("Reset is_live flag on all profiles.")

cur.close()
conn.close()
print("\nDone. You can now go live.")
