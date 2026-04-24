"""Call the production API to dedup spots."""
import requests
import json

BASE = 'https://raw-surf-antigravity.onrender.com/api'

def run_dedup(endpoint, label, execute=False):
    url = f"{BASE}/{endpoint}"
    if execute:
        url += "?execute=true"
    
    print(f"\n{'='*60}")
    print(f"  {label} - {'EXECUTE' if execute else 'DRY RUN'}")
    print(f"  {url}")
    print(f"{'='*60}")
    
    try:
        r = requests.post(url, timeout=120)
        print(f"Status: {r.status_code}")
        
        if r.status_code == 200:
            data = r.json()
            print(f"Mode: {data.get('mode', 'N/A')}")
            print(f"Total merges: {data.get('total_merged', 0)}")
            print(f"Message: {data.get('message', '')}")
            
            for m in data.get('merges', []):
                survivor = m.get('survivor', {})
                deleted = m.get('deleted', m.get('duplicate', {}))
                action = m.get('action', 'N/A')
                print(f"  {action}: Keep '{survivor.get('name')}' ({survivor.get('region')}) <- Delete '{deleted.get('name')}' ({deleted.get('region')})")
                fk = m.get('fk_refs_moved', m.get('fk_references_moved', {}))
                if fk:
                    print(f"    FK refs: {fk}")
            
            for s in data.get('skipped', []):
                print(f"  SKIP: {s}")
            
            for e in data.get('errors', []):
                print(f"  ERROR: {e}")
        elif r.status_code == 404:
            print("Endpoint not found - backend may not have redeployed yet")
        elif r.status_code == 405:
            print("Method not allowed - endpoint exists but doesn't accept POST")
        else:
            print(f"Response: {r.text[:500]}")
    except requests.exceptions.ConnectionError:
        print("Connection error - server may be sleeping, try again in 30s")
    except requests.exceptions.Timeout:
        print("Timeout - server may be waking up")
    except Exception as e:
        print(f"Error: {e}")


if __name__ == "__main__":
    import sys
    execute = "--execute" in sys.argv
    
    # Step 1: Exact-name dedup
    run_dedup("surf-spots/admin/dedup", "EXACT-NAME DEDUP", execute)
    
    # Step 2: Near-name dedup
    run_dedup("surf-spots/admin/merge-near-dupes", "NEAR-NAME MERGE", execute)
