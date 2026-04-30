"""
One-time cleanup: Authenticate via Supabase Auth REST API, then call the
admin cleanup endpoint on the deployed backend to remove orphaned CRs.
"""
import requests
import sys
import io
import json

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

SUPABASE_URL = "https://jnfbxcvcbtndtsvscppt.supabase.co"
SUPABASE_KEY = "sb_publishable_JozrdGtw9LTs58w8BAiXKg_k06DoHww"
BACKEND_URL = "https://raw-surf-antigravity.onrender.com"

# Admin credentials — used once for this cleanup
ADMIN_EMAIL = input("Enter admin email: ").strip()
ADMIN_PASSWORD = input("Enter admin password: ").strip()

def main():
    # Step 1: Authenticate via Supabase Auth
    print("\n[1] Authenticating via Supabase Auth...")
    auth_resp = requests.post(
        f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
        headers={
            "apikey": SUPABASE_KEY,
            "Content-Type": "application/json"
        },
        json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        }
    )
    
    if auth_resp.status_code != 200:
        print(f"[FAIL] Auth failed: {auth_resp.status_code}")
        print(auth_resp.text[:500])
        return
    
    auth_data = auth_resp.json()
    token = auth_data.get("access_token")
    user_id = auth_data.get("user", {}).get("id")
    print(f"[OK] Authenticated as user: {user_id}")
    
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    
    # Step 2: Dry run
    print("\n[2] Running dry run cleanup...")
    dry_resp = requests.delete(
        f"{BACKEND_URL}/api/admin/condition-reports/cleanup-orphaned-sessions",
        headers=headers,
        params={"dry_run": "true"}
    )
    
    print(f"    Status: {dry_resp.status_code}")
    if dry_resp.status_code == 200:
        dry_data = dry_resp.json()
        print(f"    Would delete: {dry_data.get('would_delete', '?')}")
        preview = dry_data.get('preview', [])
        for item in preview[:20]:
            print(f"      - {item.get('id','?')[:8]}... | {item.get('spot_name','?'):20s} | {item.get('created_at','?')[:16]} | {item.get('caption','?')}")
        
        count = dry_data.get('would_delete', 0)
        if count == 0:
            print("\n[DONE] No orphaned reports found. Database is already clean!")
            return
        
        # Step 3: Actual delete
        print(f"\n[3] Deleting {count} orphaned condition reports...")
        del_resp = requests.delete(
            f"{BACKEND_URL}/api/admin/condition-reports/cleanup-orphaned-sessions",
            headers=headers,
            params={"dry_run": "false"}
        )
        
        print(f"    Status: {del_resp.status_code}")
        if del_resp.status_code == 200:
            del_data = del_resp.json()
            print(f"    Deleted: {del_data.get('deleted', '?')}")
            print(f"    Message: {del_data.get('message', '')}")
        else:
            print(f"    [FAIL] {del_resp.text[:500]}")
    else:
        print(f"    [FAIL] {dry_resp.text[:500]}")
    
    print("\n[DONE] Cleanup complete.")

if __name__ == "__main__":
    main()
