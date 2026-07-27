#!/usr/bin/env python3
"""
discover_spots_gnis.py — GENERATE surf-spot candidates instead of copying them.

WHY THIS EXISTS
---------------
Surveyed 2026-07-27, every surf-spot catalogue big enough to grow ours is closed by terms of use
(Wannasurf 9,511 spots / 6,262 GPS waypoints, Stormrider 5,000+, Windy.app), and every openly
licensed one is SMALLER than the 1,516 we already have (surfing-waves 1,378, SwellArchive 1,000+,
OSM ~555 real surf features, Wikidata 40). See
`docs/runbooks/RESEARCH-2026-07-27-surf-spot-data-sources.md`.

So we do not copy a catalogue. We build one, from inputs nobody owns:

  1. GNIS (USGS) — "in the U.S. public domain", every named physical feature in the United States.
     Its worldwide counterpart is NGA GNS: "There are no licensing requirements or restrictions in
     place for the use of the GNS data." Between them they cover the planet.
  2. ETOPO 2022 15s (NOAA, CC0) — the bathymetry we already use for shore normals.
  3. Our own physics — `ocean_access` and `shore_normal_fit`.

Surf breaks are overwhelmingly named after coastal features that are ALREADY in these gazetteers
as place names: Pe'ahi, Uluwatu, Jeffreys Bay, Hossegor, Bells Beach. Nobody owns the fact that a
headland exists and has a name.

★ AND IT IS MORE ACCURATE THAN COPYING, not merely safer. Measured 2026-07-27, two independent
catalogues disagree about the SAME named break by a median 3.38 km (Jaws 5.13 km, El Médano
18.73 km) — worse than our own error budget, and neither says which is right. A candidate produced
here is ETOPO-validated by construction, by the same chain that rates it.

WHAT IT DOES NOT DO
-------------------
It does not decide that a beach is a surf spot. It produces geometrically plausible CANDIDATES with
their resolved geometry, tagged KNOWN (already in the catalogue) or NEW. A human — or the
crowdsourced `refinements.py` flow — decides. Nothing is written to the database.

USAGE
    python scripts/discover_spots_gnis.py --gnis DomesticNames_FL.txt --catalog review.csv
    python scripts/discover_spots_gnis.py --gnis DomesticNames_FL.txt --limit 200   # smoke test
"""
import argparse
import concurrent.futures as cf
import csv
import io
import math
import os
import sys
import zipfile
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.weather_pipeline.ocean_access import placement_verdict  # noqa: E402
from services.weather_pipeline.shore_normal_fit import (  # noqa: E402
    MAX_SPREAD_DEG, fit_shore_normal, nearshore_depth_m)
from scripts.build_shore_normals import FETCH_HALF_DEG, fetch_window  # noqa: E402

# GNIS feature classes a surf break gets named after.
#
# `Cape` is GNIS's class for "projecting point of land: cape, head, neck, peninsula, point" — every
# point break. `Bar` is "bar, ledge, reef, sandbar, shoal, spit" — every reef and sandbar.
#
# ★★ `Populated Place` IS NOT OPTIONAL, AND LEAVING IT OUT WAS THE BUG. Surf spots are named after
# coastal TOWNS at least as often as after landforms — Ormond Beach, Melbourne Beach, Atlantic
# Beach, Flagler Beach, New Smyrna Beach, Delray Beach, Ponte Vedra. Measured against our 102
# Florida spots, the nearest GNIS feature is a `Populated Place` for 40 of them, more than any
# landform class. Recall at 2 km:
#
#     physical classes only ............ 64.7%   (pool  4,066)
#     + Populated Place ................ 90.2%   (pool 11,141)
#     + Civil / Census / Park / Locale .. 92.2%   (pool 12,889)
#
# Dropping the place classes costs 27.5 points of recall. The extra pool is not a problem: these
# are CANDIDATES, and `ocean_access` plus the shore-normal gate discard the inland ones — an inland
# town fails the ocean test by construction.
COASTAL_CLASSES = {
    # landforms
    "Beach", "Cape", "Bar", "Bay", "Channel", "Island", "Reef", "Pillar",
    # the places surfers actually name breaks after
    "Populated Place", "Civil", "Census", "Park", "Locale",
}

# A gazetteer feature this far from the sea is not a surf break, whatever it is called. Same
# threshold the placement detector uses, and calibrated the same way.
MAX_OCEAN_KM = 3.0
# Two candidates closer than this are the same headland under two names — GNIS is dense.
DEDUPE_KM = 0.8
# A catalogue spot within this of a candidate means we already have it.
KNOWN_KM = 2.0
WORKERS = 6


def haversine_km(lat1, lng1, lat2, lng2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371.0 * math.asin(math.sqrt(a))


def read_gnis(path):
    """Parse a GNIS pipe-delimited state file, from .txt or the shipped .zip."""
    if path.lower().endswith(".zip"):
        with zipfile.ZipFile(path) as z:
            member = [n for n in z.namelist() if n.lower().endswith(".txt")][0]
            text = z.read(member).decode("utf-8", "replace")
    else:
        with open(path, encoding="utf-8", errors="replace") as fh:
            text = fh.read()
    rows = []
    reader = csv.DictReader(io.StringIO(text), delimiter="|")
    for r in reader:
        # the first column carries a UTF-8 BOM
        cls = (r.get("feature_class") or "").strip()
        if cls not in COASTAL_CLASSES:
            continue
        try:
            lat = float(r["prim_lat_dec"])
            lng = float(r["prim_long_dec"])
        except (TypeError, ValueError, KeyError):
            continue
        if lat == 0 and lng == 0:
            continue
        rows.append({"name": (r.get("feature_name") or "").strip(), "feature_class": cls,
                     "county": (r.get("county_name") or "").strip(), "lat": lat, "lng": lng})
    return rows


def read_catalog(path):
    """Our existing spots, from any CSV with name + lat/lng columns."""
    out = []
    with open(path, encoding="utf-8", errors="replace") as fh:
        for r in csv.DictReader(fh):
            lat = r.get("lat") or r.get("latitude")
            lng = r.get("lng") or r.get("longitude")
            try:
                out.append((r.get("name") or "", float(lat), float(lng)))
            except (TypeError, ValueError):
                continue
    return out


def dedupe(rows, km=DEDUPE_KM):
    """GNIS names the same headland several ways; keep the first of each cluster."""
    kept = []
    for r in rows:
        if not any(haversine_km(r["lat"], r["lng"], k["lat"], k["lng"]) <= km for k in kept):
            kept.append(r)
    return kept


def assess(row):
    """Resolve a candidate's geometry. Never raises."""
    out = dict(row, ocean_km=None, verdict="FETCH_FAILED", elev_m=None,
               shore_normal_deg=None, spread_deg=None, n_windows=0, break_depth_m=None,
               decision="SKIP", note="")
    try:
        import numpy as np
        elev, lats, lons = fetch_window(row["lat"], row["lng"], FETCH_HALF_DEG)
        elev = np.where(np.isnan(elev), 0.0, elev)
    except Exception as e:
        out["note"] = str(e)[:90]
        return out

    v = placement_verdict(elev, lats, lons, row["lat"], row["lng"])
    out.update(ocean_km=v["ocean_km"], verdict=v["verdict"], elev_m=v["elev_m"])
    if v["verdict"] != "ON_OCEAN":
        out["decision"] = "REJECT_NOT_ON_OCEAN"
        out["note"] = f"nearest sea {v['ocean_km']} km"
        return out

    bearing, spread, n = fit_shore_normal(elev, lats, lons, row["lat"], row["lng"])
    out["shore_normal_deg"] = None if bearing is None else round(bearing, 1)
    out["spread_deg"] = None if spread is None else round(spread, 1)
    out["n_windows"] = n
    if spread is None or n < 3 or spread > MAX_SPREAD_DEG:
        out["decision"] = "REJECT_NO_GEOMETRY"
        out["note"] = "no confident shore normal — the coast here is not resolvable"
        return out

    bd = nearshore_depth_m(elev, lats, lons, row["lat"], row["lng"])
    out["break_depth_m"] = None if bd is None else round(bd, 1)
    out["decision"] = "CANDIDATE"
    out["note"] = f"faces {bearing:.0f}° (spread {spread:.0f}°)"
    return out


def main():
    ap = argparse.ArgumentParser(description="Discover surf-spot candidates from GNIS (read-only)")
    ap.add_argument("--gnis", required=True, help="GNIS state .txt or .zip")
    ap.add_argument("--catalog", default=None, help="CSV of our existing spots (name,lat,lng)")
    ap.add_argument("--bbox", default=None,
                    help="min_lat,max_lat,min_lng,max_lng — REQUIRED for a meaningful recall "
                         "number: recall is only interpretable when the candidate pool and the "
                         "ground truth cover the SAME coast.")
    ap.add_argument("--limit", type=int, default=None,
                    help="cap AFTER shuffling. ⚠️ GNIS files are sorted by feature name, so an "
                         "un-shuffled cap samples the ALPHABET, not the coast — the 2026-07-27 "
                         "pilot's first run returned only A- and B- names and its recall number "
                         "was meaningless.")
    ap.add_argument("--seed", type=int, default=17, help="shuffle seed, so runs are reproducible")
    ap.add_argument("--out", default="gnis_spot_candidates.csv")
    args = ap.parse_args()

    feats = read_gnis(args.gnis)
    print(f"GNIS coastal-class features: {len(feats)}")
    for k, v in Counter(f["feature_class"] for f in feats).most_common():
        print(f"  {k:<12} {v:>6}")

    if args.bbox:
        a, b, c, d = (float(x) for x in args.bbox.split(","))
        feats = [f for f in feats if a <= f["lat"] <= b and c <= f["lng"] <= d]
        print(f"inside bbox {args.bbox}: {len(feats)}")
    else:
        print("⚠️ no --bbox: any recall number below is NOT interpretable")

    feats = dedupe(feats)
    print(f"after {DEDUPE_KM} km dedupe: {len(feats)}")
    if args.limit and args.limit < len(feats):
        import random
        random.Random(args.seed).shuffle(feats)
        feats = feats[:args.limit]
        print(f"shuffled (seed {args.seed}) and limited to {len(feats)}")

    rows = []
    with cf.ThreadPoolExecutor(max_workers=WORKERS) as ex:
        for i, r in enumerate(ex.map(assess, feats)):
            rows.append(r)
            if (i + 1) % 100 == 0:
                print(f"  {i + 1}/{len(feats)}")

    ours = read_catalog(args.catalog) if args.catalog else []
    for r in rows:
        if r["decision"] != "CANDIDATE":
            continue
        best = None
        for name, lat, lng in ours:
            km = haversine_km(r["lat"], r["lng"], lat, lng)
            if best is None or km < best[0]:
                best = (km, name)
        r["nearest_ours_km"] = None if best is None else round(best[0], 2)
        r["nearest_ours"] = None if best is None else best[1]
        r["decision"] = "KNOWN" if (best and best[0] <= KNOWN_KM) else "NEW"

    print()
    for k, v in Counter(r["decision"] for r in rows).most_common():
        print(f"  {k:<22} {v:>5}")

    # ── RECALL: of OUR spots on this coast, how many did the pipeline rediscover? ──
    if ours:
        cands = [r for r in rows if r["decision"] in ("KNOWN", "NEW")]
        hit = sum(1 for _, lat, lng in ours
                  if any(haversine_km(lat, lng, c["lat"], c["lng"]) <= KNOWN_KM for c in cands))
        print()
        print(f"RECALL: rediscovered {hit}/{len(ours)} of our existing spots "
              f"({hit / len(ours) * 100:.1f}%) within {KNOWN_KM} km")
        print("  (a low number means the gazetteer does not name what surfers name — "
              "the honest failure mode for this method)")

    cols = ["decision", "name", "feature_class", "county", "lat", "lng", "ocean_km", "verdict",
            "elev_m", "shore_normal_deg", "spread_deg", "n_windows", "break_depth_m",
            "nearest_ours", "nearest_ours_km", "note"]
    with open(args.out, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(cols)
        order = {"NEW": 0, "KNOWN": 1, "REJECT_NO_GEOMETRY": 2, "REJECT_NOT_ON_OCEAN": 3}
        for r in sorted(rows, key=lambda r: (order.get(r["decision"], 9), r.get("ocean_km") or 9e9)):
            w.writerow([r.get(c) for c in cols])
    print(f"\nWrote {args.out}. NOTHING was written to the database.")
    print("Source: GNIS (USGS) — U.S. public domain. Bathymetry: ETOPO 2022 15s (NOAA, CC0).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
