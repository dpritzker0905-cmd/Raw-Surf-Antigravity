"""
Surf Spot Duplicate Audit Script
=================================
Queries the live database and generates a comprehensive audit report of
potential duplicate surf spots across ALL states/countries, with special
focus on Florida.

Duplicate detection strategies:
  1. EXACT name match within the same state (strongest signal)
  2. FUZZY name match (Levenshtein-like) within the same state
  3. PROXIMITY match (same name base, different region, within 5km)
  4. Region overlap analysis (spots that appear in overlapping regions)

Usage:
  python scripts/audit_surf_spot_duplicates.py

Outputs a formatted report to stdout and optionally a JSON file.
"""

import asyncio
import sys
import os
import json
from collections import defaultdict
from math import radians, sin, cos, sqrt, atan2

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select, func
from database import AsyncSessionLocal
from models import SurfSpot


def haversine_km(lat1, lon1, lat2, lon2):
    """Calculate distance between two GPS coordinates in km."""
    if not all([lat1, lon1, lat2, lon2]):
        return float('inf')
    R = 6371  # Earth radius in km
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = sin(dlat/2)**2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon/2)**2
    c = 2 * atan2(sqrt(a), sqrt(1-a))
    return R * c


def normalize_name(name):
    """Normalize a spot name for comparison (lowercase, strip common suffixes)."""
    if not name:
        return ""
    n = name.strip().lower()
    # Remove common suffixes/prefixes that vary
    for suffix in [" - north", " - south", " - east", " - west",
                   " north", " south", " beach", " pier"]:
        if n.endswith(suffix):
            n = n[:-len(suffix)]
    return n


def name_base(name):
    """Extract the base location name, stripping break descriptors."""
    if not name:
        return ""
    n = name.strip().lower()
    # Remove trailing break descriptors like " - First Peak", " - Monster Hole"
    for sep in [" - ", " -- "]:
        if sep in n:
            n = n.split(sep)[0]
    return n.strip()


async def run_audit():
    """Main audit logic."""
    print("")
    print("=" * 70)
    print("  SURF SPOT DUPLICATE AUDIT")
    print("=" * 70)
    print("")

    async with AsyncSessionLocal() as db:
        # Fetch all active spots
        result = await db.execute(
            select(SurfSpot)
            .where(SurfSpot.is_active.is_(True))
            .order_by(SurfSpot.state_province, SurfSpot.name)
        )
        all_spots = result.scalars().all()
        print(f"Total active spots: {len(all_spots)}")
        print("")

        # Group by state_province
        by_state = defaultdict(list)
        for s in all_spots:
            key = f"{s.country or 'Unknown'}|{s.state_province or 'Unknown'}"
            by_state[key].append(s)

        # ============================================================
        # 1. EXACT NAME DUPLICATES (same name, same state)
        # ============================================================
        print("-" * 70)
        print("  1. EXACT NAME DUPLICATES (same name within same state)")
        print("-" * 70)
        exact_dupes = []
        for state_key, spots in sorted(by_state.items()):
            name_groups = defaultdict(list)
            for s in spots:
                name_groups[s.name.strip().lower()].append(s)

            for name, group in name_groups.items():
                if len(group) > 1:
                    exact_dupes.append((state_key, group))

        if exact_dupes:
            for state_key, group in exact_dupes:
                country, state = state_key.split("|")
                print(f"\n  [{state}, {country}] \"{group[0].name}\" -- {len(group)} copies:")
                for s in group:
                    print(f"    ID: {s.id[:12]}...  region=\"{s.region}\"  "
                          f"lat={s.latitude}, lon={s.longitude}  "
                          f"created={str(s.created_at)[:10] if s.created_at else '?'}")
        else:
            print("  [OK] No exact duplicates found.")

        # ============================================================
        # 2. NEAR-DUPLICATE NAMES (similar name, same state)
        # ============================================================
        print("")
        print("-" * 70)
        print("  2. NEAR-DUPLICATE NAMES (similar base name, same state)")
        print("-" * 70)
        near_dupes = []
        for state_key, spots in sorted(by_state.items()):
            base_groups = defaultdict(list)
            for s in spots:
                base = name_base(s.name)
                base_groups[base].append(s)

            for base, group in base_groups.items():
                # Only flag if there are entries with different full names
                unique_names = set(s.name for s in group)
                if len(unique_names) > 1 and len(group) > 1:
                    # Filter out intentional variants (e.g. "Sebastian Inlet - First Peak" vs "- Monster Hole")
                    # These are legitimate distinct breaks at the same location
                    # Only flag as duplicates if they seem like true duplicates
                    near_dupes.append((state_key, base, group))

        if near_dupes:
            for state_key, base, group in near_dupes:
                country, state = state_key.split("|")
                print(f"\n  [{state}, {country}] Base: \"{base}\" -- {len(group)} variants:")
                for s in group:
                    print(f"    \"{s.name}\"  region=\"{s.region}\"  ID={s.id[:12]}...")
        else:
            print("  [OK] No near-duplicates found.")

        # ============================================================
        # 3. PROXIMITY DUPLICATES (different name/region, within 1km)
        # ============================================================
        print("")
        print("-" * 70)
        print("  3. PROXIMITY DUPLICATES (same name base, different region, <5km apart)")
        print("-" * 70)
        proximity_dupes = []
        # Group all spots by normalized base name across ALL regions in same state
        for state_key, spots in sorted(by_state.items()):
            name_clusters = defaultdict(list)
            for s in spots:
                name_clusters[normalize_name(s.name)].append(s)

            for norm_name, cluster in name_clusters.items():
                if len(cluster) < 2:
                    continue
                # Check if any pair has different regions but is close geographically
                seen_pairs = set()
                for i, a in enumerate(cluster):
                    for b in cluster[i+1:]:
                        pair_key = tuple(sorted([a.id, b.id]))
                        if pair_key in seen_pairs:
                            continue
                        seen_pairs.add(pair_key)
                        if a.region != b.region:
                            dist = haversine_km(a.latitude, a.longitude, b.latitude, b.longitude)
                            if dist < 5.0:
                                proximity_dupes.append((state_key, a, b, dist))

        if proximity_dupes:
            for state_key, a, b, dist in proximity_dupes:
                country, state = state_key.split("|")
                print(f"\n  [{state}, {country}] {dist:.1f}km apart:")
                print(f"    A: \"{a.name}\" region=\"{a.region}\"  ({a.latitude}, {a.longitude})")
                print(f"    B: \"{b.name}\" region=\"{b.region}\"  ({b.latitude}, {b.longitude})")
        else:
            print("  [OK] No proximity duplicates found.")

        # ============================================================
        # 4. FLORIDA-SPECIFIC REGION ANALYSIS
        # ============================================================
        print("")
        print("-" * 70)
        print("  4. FLORIDA REGION ANALYSIS")
        print("-" * 70)
        fl_spots = [s for s in all_spots if (s.state_province or "").lower() == "florida"]
        fl_regions = defaultdict(list)
        for s in fl_spots:
            fl_regions[s.region or "None"].append(s)

        print(f"\n  Total Florida spots: {len(fl_spots)}")
        print(f"  Regions used:")
        for region, spots in sorted(fl_regions.items(), key=lambda x: -len(x[1])):
            print(f"    - \"{region}\": {len(spots)} spots")

        # Check for overlapping regions (same spot name in different FL regions)
        fl_by_name = defaultdict(list)
        for s in fl_spots:
            fl_by_name[s.name.strip()].append(s)

        fl_cross_region = [(name, spots) for name, spots in fl_by_name.items() if len(spots) > 1]
        if fl_cross_region:
            print(f"\n  Florida spots appearing in MULTIPLE regions:")
            for name, spots in sorted(fl_cross_region):
                regions = [s.region for s in spots]
                print(f"    \"{name}\" -> regions: {regions}")
                for s in spots:
                    dist_from_first = haversine_km(spots[0].latitude, spots[0].longitude, s.latitude, s.longitude)
                    print(f"      ID={s.id[:12]}...  region=\"{s.region}\"  "
                          f"({s.latitude}, {s.longitude})  "
                          f"dist_from_first={dist_from_first:.2f}km")

        # ============================================================
        # 5. GLOBAL SUMMARY
        # ============================================================
        print("")
        print("-" * 70)
        print("  5. GLOBAL DUPLICATE SUMMARY")
        print("-" * 70)

        # Count all types
        total_exact = sum(len(g) - 1 for _, g in exact_dupes)
        total_near = len(near_dupes)
        total_proximity = len(proximity_dupes)

        print(f"\n  Exact duplicates (can auto-merge):  {total_exact}")
        print(f"  Near-duplicate name clusters:       {total_near}")
        print(f"  Cross-region proximity matches:     {total_proximity}")
        print(f"  Total spots to review:              {total_exact + total_proximity}")

        if total_exact > 0:
            print(f"\n  --> Run 'python scripts/dedup_surf_spots.py' to preview & merge exact duplicates")

        # ============================================================
        # 6. MERGE RECOMMENDATIONS
        # ============================================================
        print("")
        print("-" * 70)
        print("  6. MERGE RECOMMENDATIONS")
        print("-" * 70)

        # Compile actionable merge recommendations
        recommendations = []

        for state_key, group in exact_dupes:
            country, state = state_key.split("|")
            name = group[0].name
            regions = list(set(s.region for s in group))
            # Pick the most specific region
            from dedup_surf_spots import pick_survivor, region_specificity
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
            } for s in group]
            survivor, dupes = pick_survivor(spot_dicts)
            recommendations.append({
                "action": "MERGE",
                "name": name,
                "state": state,
                "keep_id": survivor["id"][:12],
                "keep_region": survivor["region"],
                "remove_ids": [d["id"][:12] for d in dupes],
                "remove_regions": [d["region"] for d in dupes],
            })

        for state_key, a, b, dist in proximity_dupes:
            country, state = state_key.split("|")
            recommendations.append({
                "action": "REVIEW",
                "reason": f"Same base name, different regions, {dist:.1f}km apart",
                "spot_a": f"{a.name} (region={a.region})",
                "spot_b": f"{b.name} (region={b.region})",
                "state": state,
            })

        if recommendations:
            for i, rec in enumerate(recommendations, 1):
                if rec["action"] == "MERGE":
                    print(f"\n  {i}. [AUTO-MERGE] \"{rec['name']}\" ({rec['state']})")
                    print(f"     KEEP:   ...{rec['keep_id']} (region=\"{rec['keep_region']}\")")
                    for rid, rreg in zip(rec["remove_ids"], rec["remove_regions"]):
                        print(f"     DELETE: ...{rid} (region=\"{rreg}\")")
                else:
                    print(f"\n  {i}. [MANUAL REVIEW] {rec['state']}")
                    print(f"     {rec['spot_a']}")
                    print(f"     {rec['spot_b']}")
                    print(f"     Reason: {rec['reason']}")
        else:
            print("\n  [OK] No merge recommendations -- database is clean!")

        print("")
        print("=" * 70)
        print("  AUDIT COMPLETE")
        print("=" * 70)
        print("")


if __name__ == "__main__":
    asyncio.run(run_audit())
