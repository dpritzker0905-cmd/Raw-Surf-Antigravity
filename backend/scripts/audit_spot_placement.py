#!/usr/bin/env python3
"""
audit_spot_placement.py — find surf spots that are not in the surf zone.

WHY
---
Measured 2026-07-26 on a 160-spot random sample of production against NOAA ETOPO 2022 15s:

    INLAND (>10 m elevation)   44   27.5%   <- geocoded to a town centre, a clifftop, or a waterfall
    on land (0-10 m)           40   25.0%   <- ambiguous at 463 m; may be shoreline-correct
    surf zone (0 to -50 m)     63   39.4%   <- correctly placed
    shelf (-50 to -200 m)       8    5.0%
    deep ocean (<-200 m)        5    3.1%   <- placed offshore of any break

Worst offenders were unmistakable: Reggae Falls +678 m (a waterfall in the Jamaican interior),
Twin Rocks +301 m, Ao Nang +157 m; Nanumea in 1,230 m of open ocean.

A misplaced spot is not a cosmetic bug. It samples the forecast at the wrong location, and it
poisons the geometry too: `bathymetry.shore_normal_at()` needs a shoreline in its window, so an
inland spot yields a meaningless bearing or None — and a missing shore normal costs ~18 rating
points and 73% level disagreement (measured this session).

WHAT THIS DOES
--------------
Read-only. Classifies every active spot and writes a ranked review list. It NEVER moves a spot:
placement is a judgement call (which named peak on this beach?) and belongs in the spot editor.
The point is to shrink the manual pass from 1516 spots to the few hundred that are actually wrong.

⚠️ INSTRUMENT LIMIT — READ BEFORE TRUSTING A VERDICT
ETOPO 15s is ~463 m per cell. A correctly-placed break sits 50-300 m offshore, so its cell can
straddle beach and land and read slightly POSITIVE. Therefore:
  * z > +10 m  -> unambiguous. Nothing in the surf zone reads 10 m up at this resolution.
  * 0 to +10 m -> SUSPECT, not condemned. Could be a correct shoreline placement.
  * z < -200 m -> unambiguous the other way; no break is in 200 m of water.
Only the unambiguous bands are counted as confirmed defects.

USAGE
    python scripts/audit_spot_placement.py                  # audit all, print + write CSV
    python scripts/audit_spot_placement.py --limit 200      # quick sample
    python scripts/audit_spot_placement.py --out review.csv

Env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_KEY). Read-only — no write grant needed.
"""
import argparse
import concurrent.futures as cf
import csv
import math
import os
import sys
from collections import Counter

ERDDAP = ("https://coastwatch.pfeg.noaa.gov/erddap/griddap/ETOPO_2022_v1_15s.csv"
          "?z%5B({lat}):1:({lat})%5D%5B({lon}):1:({lon})%5D")
PAGE = 1000
INLAND_M = 10.0        # above this, unambiguously not in the surf zone
DEEP_M = -200.0        # below this, unambiguously offshore of any break
NEAR_DUP_M = 50.0      # a genuine duplicate, not an adjacent named peak
WORKERS = 8


def classify(z):
    if z is None:
        return "unknown"
    if z > INLAND_M:
        return "INLAND"
    if z > 0:
        return "on_land_suspect"
    if z >= -50:
        return "surf_zone"
    if z >= DEEP_M:
        return "shelf"
    return "DEEP_OCEAN"


def is_confirmed_defect(band):
    """Only the bands ETOPO's 463 m resolution can decide without ambiguity."""
    return band in ("INLAND", "DEEP_OCEAN")


def haversine_m(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = (math.sin((p2 - p1) / 2) ** 2
         + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2)
    return 2 * 6371000.0 * math.asin(math.sqrt(a))


def fetch_spots(base, key, limit=None):
    """Paginated — PostgREST silently caps at 1000 and still returns 200."""
    import requests
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    out, offset = [], 0
    while True:
        url = (f"{base}/rest/v1/surf_spots?select=id,name,region,latitude,longitude"
               f"&is_active=eq.true&latitude=not.is.null&longitude=not.is.null"
               f"&order=id&limit={PAGE}&offset={offset}")
        r = requests.get(url, headers=headers, timeout=60)
        r.raise_for_status()
        batch = r.json()
        out.extend(batch)
        if limit and len(out) >= limit:
            return out[:limit]
        if len(batch) < PAGE:
            return out
        offset += PAGE


def elevation(spot):
    import requests
    lat, lon = float(spot["latitude"]), float(spot["longitude"])
    try:
        r = requests.get(ERDDAP.format(lat=lat, lon=lon), timeout=45)
        if r.status_code != 200:
            return None
        for line in r.text.splitlines():
            if not line or line[0].isalpha():
                continue
            parts = line.split(",")
            if len(parts) >= 3:
                try:
                    return float(parts[2])
                except ValueError:
                    continue
    except Exception:
        return None
    return None


def main():
    ap = argparse.ArgumentParser(description="Audit surf-spot placement against ETOPO bathymetry")
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--out", type=str, default="spot_placement_review.csv")
    args = ap.parse_args()

    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY", "")
    if not base or not key:
        print("ERROR: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required (read-only).")
        return 2

    spots = fetch_spots(base, key, args.limit)
    print(f"Auditing {len(spots)} active spots against ETOPO 2022 15s (~463 m)…")
    if not args.limit and len(spots) % PAGE == 0:
        print(f"  ⚠ count is an exact multiple of {PAGE} — verify against a direct SQL count.")

    zs = [None] * len(spots)
    with cf.ThreadPoolExecutor(max_workers=WORKERS) as ex:
        for i, z in enumerate(ex.map(elevation, spots)):
            zs[i] = z
            if (i + 1) % 200 == 0:
                print(f"  {i+1}/{len(spots)}")

    rows = []
    for sp, z in zip(spots, zs):
        rows.append({**sp, "elev_m": z, "band": classify(z)})

    # near-duplicates (tight — adjacent named peaks like Rincon's five breaks are LEGITIMATE)
    dupes = set()
    for i, a in enumerate(rows):
        for b in rows[i + 1:]:
            if abs(float(a["latitude"]) - float(b["latitude"])) > 0.01:
                continue
            if haversine_m(float(a["latitude"]), float(a["longitude"]),
                           float(b["latitude"]), float(b["longitude"])) < NEAR_DUP_M:
                dupes.add(a["id"]); dupes.add(b["id"])

    counts = Counter(r["band"] for r in rows)
    n = max(1, sum(1 for r in rows if r["elev_m"] is not None))
    print("\nPLACEMENT DISTRIBUTION")
    for k in ("INLAND", "on_land_suspect", "surf_zone", "shelf", "DEEP_OCEAN", "unknown"):
        c = counts.get(k, 0)
        print(f"  {k:<18} {c:>5}  ({100*c/n:5.1f}%)")

    confirmed = [r for r in rows if is_confirmed_defect(r["band"])]
    print(f"\n  CONFIRMED misplaced : {len(confirmed)}  ({100*len(confirmed)/n:.1f}%)")
    print(f"  suspect (0-10 m)    : {counts.get('on_land_suspect',0)}  — 463 m cannot decide these")
    print(f"  near-duplicates <{NEAR_DUP_M:.0f} m: {len(dupes)}")

    print("\nWORST 15 (rank by |distance from the surf zone|):")
    ranked = sorted(confirmed, key=lambda r: -(r["elev_m"] if r["elev_m"] > 0 else -r["elev_m"]))
    for r in ranked[:15]:
        print(f"  {r['name'][:32]:<32} {r['region'] or '-':<18} z={r['elev_m']:+9.1f} m")

    with open(args.out, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["id", "name", "region", "latitude", "longitude", "elev_m", "band", "near_duplicate"])
        for r in sorted(rows, key=lambda r: (not is_confirmed_defect(r["band"]),
                                             -abs(r["elev_m"] or 0))):
            w.writerow([r["id"], r["name"], r["region"], r["latitude"], r["longitude"],
                        r["elev_m"], r["band"], r["id"] in dupes])
    print(f"\nReview list written to {args.out} (worst first).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
