"""
Static analysis audit of all seed scripts to find potential duplicate FL spots.
This does NOT require database access.
"""
import re
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

scripts_dir = os.path.dirname(os.path.abspath(__file__))

# Collect ALL spots from all seed scripts
all_spots = defaultdict(list)  # name -> list of {source, region, lat, lon}


def parse_florida_seed():
    """Parse seed_missing_florida_spots.py"""
    fpath = os.path.join(scripts_dir, "seed_missing_florida_spots.py")
    with open(fpath, "r") as f:
        content = f.read()
    
    # Match tuples: ("name", lat, lon, "region", ...)
    pattern = r'\("([^"]+)",\s*([\d.-]+),\s*([\d.-]+),\s*"([^"]+)"'
    matches = re.findall(pattern, content)
    for name, lat, lon, region in matches:
        all_spots[name].append({
            "source": "seed_missing_florida_spots.py",
            "region": region,
            "state": "Florida",
            "lat": float(lat),
            "lon": float(lon),
        })


def parse_global_expansion(filename):
    """Parse global expansion scripts for any spots"""
    fpath = os.path.join(scripts_dir, filename)
    if not os.path.exists(fpath):
        return
    
    with open(fpath, "r") as f:
        content = f.read()
    
    # Pattern 1: dict-style {"name": "X", "region": "Y", "state_province": "Z", ...}
    # Pattern 2: tuple-style ("name", lat, lon, "region", ...)
    
    # Try dict pattern
    dict_pattern = r'"name":\s*"([^"]+)"[^}]*?"region":\s*"([^"]+)"[^}]*?"state_province":\s*"([^"]+)"'
    for match in re.finditer(dict_pattern, content, re.DOTALL):
        name, region, state = match.groups()
        all_spots[name].append({
            "source": filename,
            "region": region,
            "state": state,
        })
    
    # Try simpler dict pattern (name before state_province)
    dict_pattern2 = r'"name":\s*"([^"]+)"[^}]*?"lat":\s*([\d.-]+)[^}]*?"lon":\s*([\d.-]+)[^}]*?"state_province":\s*"([^"]+)"'
    for match in re.finditer(dict_pattern2, content, re.DOTALL):
        name, lat, lon, state = match.groups()
        # Check if already found
        already = any(e["source"] == filename for e in all_spots.get(name, []))
        if not already:
            all_spots[name].append({
                "source": filename,
                "state": state,
                "lat": float(lat),
                "lon": float(lon),
            })

    # Also try the compact format used in some scripts
    # {"name": "X", "region": "Y", "lat": N, "lon": N, "difficulty": "Z"}
    compact = r'\{\s*"name":\s*"([^"]+)"[^}]*?"region":\s*"([^"]+)"[^}]*?"lat":\s*([\d.-]+)\s*,\s*"lon":\s*([\d.-]+)'
    for match in re.finditer(compact, content):
        name, region, lat, lon = match.groups()
        already = any(e["source"] == filename for e in all_spots.get(name, []))
        if not already:
            all_spots[name].append({
                "source": filename,
                "region": region,
                "lat": float(lat),
                "lon": float(lon),
            })


def parse_spot_sync():
    """Parse spot_sync_april_2026.py"""
    fpath = os.path.join(scripts_dir, "spot_sync_april_2026.py")
    if not os.path.exists(fpath):
        return
    
    with open(fpath, "r") as f:
        content = f.read()
    
    compact = r'\{\s*"name":\s*"([^"]+)"[^}]*?"region":\s*"([^"]+)"[^}]*?"lat":\s*([\d.-]+)\s*,\s*"lon":\s*([\d.-]+)'
    for match in re.finditer(compact, content):
        name, region, lat, lon = match.groups()
        all_spots[name].append({
            "source": "spot_sync_april_2026.py",
            "region": region,
            "lat": float(lat),
            "lon": float(lon),
        })


def base_name(n):
    """Extract base location from a spot name"""
    n = n.lower().strip()
    for sep in [" - ", " -- "]:
        if sep in n:
            n = n.split(sep)[0]
    return n.strip()


def main():
    print("")
    print("=" * 70)
    print("  SURF SPOT DUPLICATE AUDIT (Static Analysis of Seed Scripts)")
    print("=" * 70)
    print("")

    # Parse all seed scripts
    parse_florida_seed()
    
    for fname in sorted(os.listdir(scripts_dir)):
        if fname.endswith(".py") and ("expansion" in fname or "global" in fname or "sync" in fname):
            parse_global_expansion(fname)
    
    parse_spot_sync()

    # Total spots found
    total_entries = sum(len(v) for v in all_spots.values())
    print(f"Total spot entries across all seed scripts: {total_entries}")
    print(f"Total unique spot names: {len(all_spots)}")
    print("")

    # ============================================================
    # 1. EXACT DUPLICATE NAMES (same name seeded from multiple scripts)
    # ============================================================
    print("-" * 70)
    print("  1. EXACT DUPLICATE NAMES (seeded from multiple scripts)")
    print("-" * 70)

    exact_dupes = {k: v for k, v in all_spots.items() if len(v) > 1}
    if exact_dupes:
        print(f"  Found {len(exact_dupes)} spots seeded from multiple scripts:")
        for name, entries in sorted(exact_dupes.items()):
            print(f"\n  \"{name}\" ({len(entries)} entries):")
            for e in entries:
                region = e.get("region", "?")
                state = e.get("state", "?")
                lat = e.get("lat", "?")
                lon = e.get("lon", "?")
                print(f"    [{e['source']}]  region=\"{region}\"  state=\"{state}\"  ({lat}, {lon})")
    else:
        print("  [OK] No exact duplicate names found across scripts.")

    # ============================================================
    # 2. SIMILAR NAME CLUSTERS (variants of the same spot)
    # ============================================================
    print("")
    print("-" * 70)
    print("  2. SIMILAR NAME CLUSTERS (potential duplicates)")
    print("-" * 70)

    base_groups = defaultdict(list)
    for name in all_spots:
        base_groups[base_name(name)].append(name)

    clusters = {k: v for k, v in base_groups.items() if len(v) > 1}
    
    # Separate intentional variants from likely duplicates
    intentional = []
    likely_dupes = []
    
    for base, names in sorted(clusters.items()):
        # If all variants have the same base but different suffixes (e.g., "- North Jetty", "- South Jetty")
        # these are likely INTENTIONAL (separate breaks at same location)
        suffixes = [n.lower().replace(base, "").strip(" -") for n in names]
        has_directional = any(s in ["north", "south", "north jetty", "south jetty", 
                                     "first peak", "second peak", "monster hole",
                                     "north side", "south side"] for s in suffixes)
        
        if has_directional:
            intentional.append((base, names))
        else:
            likely_dupes.append((base, names))

    if likely_dupes:
        print(f"\n  LIKELY DUPLICATES ({len(likely_dupes)} clusters):")
        for base, names in likely_dupes:
            print(f"\n  Base: \"{base}\"")
            for n in sorted(names):
                entries = all_spots[n]
                regions = list(set(e.get("region", "?") for e in entries))
                sources = list(set(e["source"] for e in entries))
                print(f"    -> \"{n}\"  regions={regions}  sources={sources}")

    if intentional:
        print(f"\n  INTENTIONAL VARIANTS ({len(intentional)} clusters - no action needed):")
        for base, names in intentional:
            print(f"    \"{base}\": {names}")

    # ============================================================
    # 3. FLORIDA REGION ANALYSIS
    # ============================================================
    print("")
    print("-" * 70)
    print("  3. FLORIDA REGION ANALYSIS")
    print("-" * 70)

    fl_spots = {}
    for name, entries in all_spots.items():
        fl_entries = [e for e in entries if e.get("state") == "Florida"]
        if fl_entries:
            fl_spots[name] = fl_entries

    fl_regions = defaultdict(int)
    for name, entries in fl_spots.items():
        for e in entries:
            fl_regions[e.get("region", "Unknown")] += 1

    print(f"\n  Florida spots: {len(fl_spots)}")
    print(f"  Regions used:")
    for region, count in sorted(fl_regions.items(), key=lambda x: -x[1]):
        print(f"    \"{region}\": {count} spots")

    # ============================================================
    # 4. CROSS-SCRIPT COORDINATE CHECK
    # ============================================================
    print("")
    print("-" * 70)
    print("  4. COORDINATE CONFLICTS (same name, different coordinates)")
    print("-" * 70)

    coord_conflicts = []
    for name, entries in all_spots.items():
        coords = [(e.get("lat"), e.get("lon")) for e in entries if e.get("lat") and e.get("lon")]
        if len(coords) > 1:
            # Check if coordinates differ significantly
            lats = [c[0] for c in coords]
            lons = [c[1] for c in coords]
            lat_spread = max(lats) - min(lats)
            lon_spread = max(lons) - min(lons)
            if lat_spread > 0.001 or lon_spread > 0.001:  # ~100m difference
                coord_conflicts.append((name, entries))

    if coord_conflicts:
        print(f"  Found {len(coord_conflicts)} spots with conflicting coordinates:")
        for name, entries in sorted(coord_conflicts):
            print(f"\n  \"{name}\":")
            for e in entries:
                print(f"    [{e['source']}]  ({e.get('lat', '?')}, {e.get('lon', '?')})  region=\"{e.get('region', '?')}\"")
    else:
        print("  [OK] No coordinate conflicts found.")

    # ============================================================
    # 5. RECOMMENDED ACTIONS
    # ============================================================
    print("")
    print("-" * 70)
    print("  5. RECOMMENDED MERGE ACTIONS")
    print("-" * 70)

    print("""
  The dedup_surf_spots.py script handles EXACT name duplicates automatically.
  Run it against the live database:

    python scripts/dedup_surf_spots.py          # Dry run (preview)
    python scripts/dedup_surf_spots.py --execute # Apply merges

  For near-duplicates and region conflicts, manual review is recommended
  via the admin endpoint: PATCH /surf-spots/admin/update-spot
    """)

    print("=" * 70)
    print("  AUDIT COMPLETE")
    print("=" * 70)
    print("")


if __name__ == "__main__":
    main()
