"""
One-shot dedup script using psycopg2 (synchronous) to avoid Supabase pooler issues.

Usage: python -m scripts.run_dedup_now [--execute]
Default is DRY RUN. Pass --execute to apply changes.
"""
import sys
import os
from pathlib import Path

# Setup
sys.path.insert(0, str(Path(__file__).parent.parent))
os.chdir(str(Path(__file__).parent.parent))

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / '.env')

import psycopg2
from urllib.parse import unquote

DATABASE_URL = os.environ.get('DATABASE_URL')

# FK tables to re-parent before deleting a spot
FK_REFS = [
    ("profiles", "current_spot_id"),
    ("spot_refinements", "spot_id"),
    ("spot_verifications", "spot_id"),
    ("spot_edit_logs", "spot_id"),
    ("spot_of_the_day", "spot_id"),
    ("bookings", "surf_spot_id"),
    ("dispatch_requests", "spot_id"),
    ("posts", "spot_id"),
    ("live_session_participants", "spot_id"),
    ("check_ins", "spot_id"),
    ("surf_reports", "spot_id"),
    ("surf_alerts", "spot_id"),
    ("photographer_requests", "spot_id"),
    ("stories", "spot_id"),
    ("gallery_items", "spot_id"),
    ("surfer_gallery_items", "spot_id"),
    ("live_sessions", "surf_spot_id"),
    ("galleries", "surf_spot_id"),
    ("condition_reports", "spot_id"),
    ("social_live_streams", "spot_id"),
    ("surf_passport_checkins", "spot_id"),
    ("spot_seo_metadata", "spot_id"),
]

# Near-duplicate name mappings: canonical name -> list of duplicated variant names
NEAR_DUPE_MAP = {
    "Jetty Park": ["Jetty Park - Cape Canaveral"],
    "Indialantic": ["Indialantic Boardwalk", "Ocean Avenue (Indialantic)"],
    "Melbourne Beach": ["Melbourne Beach - Ocean Avenue"],
    "Spessard Holland": ["Spessard Holland Park"],
    "Picnic Tables": ["Tables (Picnic Tables)"],
    "10th Street Folly": ["10th Street East Folly"],
    "Hightower Beach": ["Hightower Park"],
}


def main():
    execute = "--execute" in sys.argv
    mode = "EXECUTE" if execute else "DRY RUN"
    print(f"\n{'='*60}")
    print(f"  SURF SPOT DEDUP - {mode}")
    print(f"{'='*60}\n")

    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    try:
        # ===== Step 1: Exact-name duplicates (same name + same state) =====
        print("Step 1: Finding exact-name duplicates...\n")
        cur.execute("""
            SELECT name, state_province, COUNT(*) as cnt, 
                   array_agg(id::text ORDER BY created_at) as ids,
                   array_agg(region ORDER BY created_at) as regions
            FROM surf_spots 
            WHERE is_active = true
            GROUP BY name, state_province
            HAVING COUNT(*) > 1
            ORDER BY cnt DESC
        """)
        
        exact_dupes = []
        for name, state, cnt, ids, regions in cur.fetchall():
            exact_dupes.append({
                'name': name, 'state': state,
                'survivor_id': ids[0], 'dup_ids': ids[1:],
                'regions': regions
            })
            print(f"  EXACT DUPE: '{name}' in {state} - {cnt} copies")
            print(f"    Keep:   {ids[0]} (region: {regions[0]})")
            for i, did in enumerate(ids[1:]):
                print(f"    Delete: {did} (region: {regions[i+1]})")
        
        if not exact_dupes:
            print("  No exact-name duplicates found.\n")
        
        # ===== Step 2: Near-name duplicates =====
        print("\nStep 2: Finding near-name duplicates...\n")
        
        near_dupes = []
        for survivor_name, dup_names in NEAR_DUPE_MAP.items():
            cur.execute(
                "SELECT id::text, name, region FROM surf_spots "
                "WHERE name = %s AND is_active = true ORDER BY created_at LIMIT 1",
                (survivor_name,)
            )
            survivor = cur.fetchone()
            if not survivor:
                print(f"  SKIP: '{survivor_name}' not found")
                continue
            
            for dup_name in dup_names:
                cur.execute(
                    "SELECT id::text, name, region FROM surf_spots "
                    "WHERE name = %s AND is_active = true",
                    (dup_name,)
                )
                for dup in cur.fetchall():
                    near_dupes.append({
                        'survivor_id': survivor[0], 'survivor_name': survivor[1],
                        'dup_id': dup[0], 'dup_name': dup[1], 'dup_region': dup[2],
                    })
                    print(f"  NEAR DUPE: '{dup[1]}' ({dup[2]}) -> merge into '{survivor[1]}' ({survivor[2]})")
        
        if not near_dupes:
            print("  No near-name duplicates found.\n")
        
        # ===== Step 3: Cross-region duplicates =====
        print("\nStep 3: Finding cross-region duplicates...\n")
        
        cur.execute("""
            SELECT name, COUNT(*) as cnt,
                   array_agg(id::text ORDER BY created_at) as ids,
                   array_agg(region ORDER BY created_at) as regions,
                   array_agg(COALESCE(state_province, '') ORDER BY created_at) as states
            FROM surf_spots WHERE is_active = true
            GROUP BY name HAVING COUNT(*) > 1
            ORDER BY cnt DESC
        """)
        
        cross_dupes = []
        for name, cnt, ids, regions, states in cur.fetchall():
            # Already caught?
            if any(d['name'] == name for d in exact_dupes):
                continue
            if any(d['dup_id'] in ids[1:] for d in near_dupes):
                continue
            
            # Different states = genuinely different spots
            unique_states = set(s for s in states if s)
            if len(unique_states) > 1:
                print(f"  SKIP (different states): '{name}' in {list(unique_states)}")
                continue
            
            cross_dupes.append({
                'name': name, 'survivor_id': ids[0],
                'dup_ids': ids[1:], 'regions': regions,
            })
            print(f"  CROSS-REGION: '{name}' - {cnt} copies across: {regions}")
            for i, did in enumerate(ids[1:]):
                print(f"    Delete: {did} (region: {regions[i+1]})")
        
        if not cross_dupes:
            print("  No cross-region duplicates to merge.\n")
        
        # ===== Build merge list =====
        all_merges = []
        for d in exact_dupes:
            for dup_id in d['dup_ids']:
                all_merges.append((d['survivor_id'], dup_id, d['name']))
        for d in near_dupes:
            all_merges.append((d['survivor_id'], d['dup_id'], f"{d['dup_name']} -> {d['survivor_name']}"))
        for d in cross_dupes:
            for dup_id in d['dup_ids']:
                all_merges.append((d['survivor_id'], dup_id, d['name']))
        
        print(f"\n{'='*60}")
        print(f"  TOTAL MERGES: {len(all_merges)}")
        print(f"{'='*60}\n")
        
        if not all_merges:
            print("Database is clean! No duplicates found.")
            return
        
        # ===== Execute merges =====
        for survivor_id, dup_id, label in all_merges:
            print(f"\n  {'MERGING' if execute else 'WOULD MERGE'}: {label}")
            print(f"    Keep:   {survivor_id}")
            print(f"    Delete: {dup_id}")
            
            total_moved = 0
            for tbl, col in FK_REFS:
                try:
                    if execute:
                        if tbl == "spot_seo_metadata":
                            cur.execute(f"SELECT COUNT(*) FROM {tbl} WHERE {col} = %s", (survivor_id,))
                            if (cur.fetchone()[0] or 0) > 0:
                                cur.execute(f"DELETE FROM {tbl} WHERE {col} = %s", (dup_id,))
                                if cur.rowcount:
                                    print(f"    {tbl}: {cur.rowcount} deleted")
                                    total_moved += cur.rowcount
                                continue
                        
                        cur.execute(f"UPDATE {tbl} SET {col} = %s WHERE {col} = %s", (survivor_id, dup_id))
                        if cur.rowcount:
                            print(f"    {tbl}: {cur.rowcount} re-parented")
                            total_moved += cur.rowcount
                    else:
                        cur.execute(f"SELECT COUNT(*) FROM {tbl} WHERE {col} = %s", (dup_id,))
                        cnt = cur.fetchone()[0] or 0
                        if cnt > 0:
                            print(f"    {tbl}: {cnt} refs to move")
                            total_moved += cnt
                except Exception as e:
                    if "does not exist" not in str(e):
                        print(f"    {tbl}: WARN - {e}")
                    conn.rollback()  # Clear failed transaction state
            
            if execute:
                cur.execute("DELETE FROM surf_spots WHERE id = %s", (dup_id,))
                print(f"    ✅ DELETED ({total_moved} FK refs moved)")
        
        if execute:
            conn.commit()
            print(f"\n{'='*60}")
            print(f"  ✅ COMMITTED - {len(all_merges)} duplicates removed")
            print(f"{'='*60}\n")
        else:
            print(f"\n{'='*60}")
            print(f"  DRY RUN COMPLETE - {len(all_merges)} duplicates found")
            print(f"  Run: python -m scripts.run_dedup_now --execute")
            print(f"{'='*60}\n")
    
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    main()
