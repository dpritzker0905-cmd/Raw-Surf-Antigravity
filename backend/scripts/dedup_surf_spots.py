"""
Surf Spot Deduplication Script
==============================
Identifies duplicate surf spots (same name, same state/country) and merges them.

Strategy:
  1. Find spots with the same name within the same state_province.
  2. For each group, pick the "survivor" (prefer the row with:
     - A more specific region name (e.g., "Space Coast" > "Central Florida")
     - More verification data
     - Non-null coordinates closest to water).
  3. Re-parent ALL foreign key references from duplicate rows to the survivor.
  4. Delete the duplicate rows.

Usage:
  # Dry run (default) -- prints what would happen, no changes
  python scripts/dedup_surf_spots.py

  # Live run -- actually performs the merge
  python scripts/dedup_surf_spots.py --execute

Requires DATABASE_URL environment variable (loaded from .env).
"""

import asyncio
import sys
import os

# Add backend root to path so we can import database/models
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select, update, func, text, delete
from sqlalchemy.ext.asyncio import AsyncSession
from database import AsyncSessionLocal
from models import SurfSpot


# -- FK tables that reference surf_spots.id --
# Each entry: (table_name, column_name)
FK_REFERENCES = [
    ("profiles",                 "current_spot_id"),
    ("spot_refinements",         "spot_id"),
    ("spot_verifications",       "spot_id"),
    ("spot_edit_logs",           "spot_id"),
    ("spot_of_the_day",          "spot_id"),
    ("bookings",                 "surf_spot_id"),
    ("dispatch_requests",        "spot_id"),
    ("posts",                    "spot_id"),
    ("live_session_participants", "spot_id"),
    ("check_ins",                "spot_id"),
    ("surf_reports",             "spot_id"),
    ("surf_alerts",              "spot_id"),
    ("photographer_requests",    "spot_id"),
    ("stories",                  "spot_id"),
    ("gallery_items",            "spot_id"),
    ("surfer_gallery_items",     "spot_id"),
    ("live_sessions",            "surf_spot_id"),
    ("galleries",                "surf_spot_id"),
    ("condition_reports",        "spot_id"),
    ("social_live_streams",      "spot_id"),
    ("surf_passport_checkins",   "spot_id"),
    ("spot_seo_metadata",        "spot_id"),
]


# -- Region specificity scoring --
# More specific regions get higher scores. Generic/broad regions score lower.
BROAD_REGIONS = {
    "central florida", "south florida", "north florida",
    "east coast", "west coast", "southeast", "northeast",
    "california coast", "atlantic coast", "pacific coast",
}

def region_specificity(region):
    """Score how specific a region name is. Higher = more specific."""
    if not region:
        return 0
    lower = region.strip().lower()
    if lower in BROAD_REGIONS:
        return 1  # Broad region
    return 2  # Specific sub-region (e.g., "Space Coast", "Gold Coast")


def pick_survivor(spots):
    """
    Given a list of duplicate spot dicts, pick the best one to keep.
    Returns (survivor_dict, list_of_duplicate_dicts).
    
    Priority:
      1. Most specific region name
      2. Is verified peak
      3. Has community verification votes
      4. Most refinement count
      5. Earliest created_at (original record)
    """
    def score(s):
        return (
            region_specificity(s["region"]),
            1 if s.get("is_verified_peak") else 0,
            (s.get("verification_votes_yes") or 0),
            (s.get("refinement_count") or 0),
            # Negative timestamp so earlier records score higher as tiebreaker
            -(s["created_at"].timestamp() if s.get("created_at") else 0),
        )
    
    ranked = sorted(spots, key=score, reverse=True)
    return ranked[0], ranked[1:]


async def find_duplicates(db):
    """Find all spot groups where the same name appears >1 time within the same state."""
    # Group by name + state_province, find groups with count > 1
    result = await db.execute(
        select(
            SurfSpot.name,
            SurfSpot.state_province,
            SurfSpot.country,
            func.count(SurfSpot.id).label("cnt")
        )
        .where(SurfSpot.is_active.is_(True))
        .group_by(SurfSpot.name, SurfSpot.state_province, SurfSpot.country)
        .having(func.count(SurfSpot.id) > 1)
        .order_by(SurfSpot.name)
    )
    groups = result.all()
    
    duplicate_groups = []
    for group in groups:
        name, state, country, count = group
        # Fetch all spots in this duplicate group
        spots_result = await db.execute(
            select(SurfSpot).where(
                SurfSpot.name == name,
                SurfSpot.state_province == state,
                SurfSpot.is_active.is_(True)
            ).order_by(SurfSpot.created_at)
        )
        spots = spots_result.scalars().all()
        
        spot_dicts = [{
            "id": s.id,
            "name": s.name,
            "region": s.region,
            "state_province": s.state_province,
            "country": s.country,
            "latitude": s.latitude,
            "longitude": s.longitude,
            "is_verified_peak": s.is_verified_peak,
            "verification_votes_yes": s.verification_votes_yes,
            "refinement_count": s.refinement_count,
            "created_at": s.created_at,
        } for s in spots]
        
        duplicate_groups.append({
            "name": name,
            "state": state,
            "country": country,
            "count": count,
            "spots": spot_dicts,
        })
    
    return duplicate_groups


async def count_fk_references(db, spot_id):
    """Count how many FK references exist for a given spot_id."""
    counts = {}
    for table, column in FK_REFERENCES:
        try:
            result = await db.execute(
                text(f"SELECT COUNT(*) FROM {table} WHERE {column} = :spot_id"),
                {"spot_id": spot_id}
            )
            cnt = result.scalar() or 0
            if cnt > 0:
                counts[f"{table}.{column}"] = cnt
        except Exception:
            # Table might not exist in this DB version
            pass
    return counts


async def reparent_references(db, old_id, new_id, dry_run):
    """Move all FK references from old_id to new_id."""
    moved = {}
    for table, column in FK_REFERENCES:
        try:
            if dry_run:
                result = await db.execute(
                    text(f"SELECT COUNT(*) FROM {table} WHERE {column} = :old_id"),
                    {"old_id": old_id}
                )
                cnt = result.scalar() or 0
            else:
                # For spot_seo_metadata, it has a UNIQUE constraint on spot_id
                # We need to handle potential conflicts
                if table == "spot_seo_metadata":
                    # Check if survivor already has SEO metadata
                    existing = await db.execute(
                        text(f"SELECT COUNT(*) FROM {table} WHERE {column} = :new_id"),
                        {"new_id": new_id}
                    )
                    has_existing = (existing.scalar() or 0) > 0
                    if has_existing:
                        # Delete the duplicate's SEO metadata instead of moving
                        result = await db.execute(
                            text(f"DELETE FROM {table} WHERE {column} = :old_id"),
                            {"old_id": old_id}
                        )
                        cnt = result.rowcount or 0
                        if cnt > 0:
                            moved[f"{table}.{column}"] = f"{cnt} deleted (survivor has existing)"
                        continue
                
                result = await db.execute(
                    text(f"UPDATE {table} SET {column} = :new_id WHERE {column} = :old_id"),
                    {"new_id": new_id, "old_id": old_id}
                )
                cnt = result.rowcount or 0
            
            if cnt > 0:
                moved[f"{table}.{column}"] = cnt
        except Exception as e:
            # Table might not exist, or column mismatch
            moved[f"{table}.{column}"] = f"ERROR: {e}"
    return moved


async def run_dedup(execute=False):
    """Main deduplication logic."""
    mode = "** LIVE EXECUTION **" if execute else "[DRY RUN] (no changes)"
    print("")
    print("=" * 60)
    print(f"  Surf Spot Deduplication -- {mode}")
    print("=" * 60)
    print("")
    
    async with AsyncSessionLocal() as db:
        # Find duplicates
        groups = await find_duplicates(db)
        
        if not groups:
            print("[OK] No duplicate spots found! Database is clean.")
            return
        
        total_dupes = sum(g["count"] - 1 for g in groups)
        print(f"Found {len(groups)} duplicate groups ({total_dupes} rows to merge):")
        print("")
        
        for i, group in enumerate(groups, 1):
            name = group["name"]
            state = group["state"] or "Unknown"
            print(f"  {i}. \"{name}\" ({state}) -- {group['count']} copies")
            
            survivor, duplicates = pick_survivor(group["spots"])
            
            print(f"     [KEEP]  id={survivor['id'][:8]}... region=\"{survivor['region']}\"")
            for dup in duplicates:
                print(f"     [MERGE] id={dup['id'][:8]}... region=\"{dup['region']}\"")
                
                # Count FK references
                refs = await count_fk_references(db, dup["id"])
                if refs:
                    print(f"        FK refs to move: {refs}")
                else:
                    print(f"        FK refs to move: (none)")
                
                if execute:
                    # Re-parent all FK references
                    moved = await reparent_references(db, dup["id"], survivor["id"], dry_run=False)
                    if moved:
                        print(f"        -> Moved: {moved}")
                    
                    # Delete the duplicate spot
                    await db.execute(
                        text("DELETE FROM surf_spots WHERE id = :dup_id"),
                        {"dup_id": dup["id"]}
                    )
                    print(f"        -> Deleted duplicate row")
                else:
                    # Dry run -- just show what would move
                    moved = await reparent_references(db, dup["id"], survivor["id"], dry_run=True)
                    if moved:
                        print(f"        Would move: {moved}")
            
            print("")
        
        if execute:
            await db.commit()
            print(f"[OK] Committed! Merged {total_dupes} duplicate(s) across {len(groups)} groups.")
        else:
            print(f"[INFO] Dry run complete. Run with --execute to apply changes.")
            print(f"   Command: python scripts/dedup_surf_spots.py --execute")


if __name__ == "__main__":
    execute = "--execute" in sys.argv
    asyncio.run(run_dedup(execute=execute))
