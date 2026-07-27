#!/usr/bin/env python3
"""
gnis_recall_check.py — can a public-domain gazetteer even FIND the spots we already know about?

★ THIS IS THE CHEAP MEASUREMENT, AND IT SHOULD ALWAYS BE RUN FIRST.
`discover_spots_gnis.py` answers the same question but needs one ETOPO round-trip per candidate —
tens of minutes, and ERDDAP's latency swings 30x through the day. This needs no network at all:
match our existing spots against the gazetteer by proximity, offline, in seconds.

Doing it the expensive way first is exactly how the 2026-07-27 pilot burned an hour to produce
3.9% recall, a number that turned out to be dominated by two design errors and one wrong constant.
Run this, sanity-check the class list, THEN spend the fetches.

WHAT IT MEASURED (Florida, 102 spots, 2 km radius)
    physical classes only ............ 64.7%   pool  4,066
    + Populated Place ................ 90.2%   pool 11,141
    + Civil / Census / Park / Locale .. 92.2%   pool 12,889

The jump is the finding: surf spots are named after coastal TOWNS at least as often as landforms.
For 40 of our 102 Florida spots the nearest GNIS feature of any class is a `Populated Place` —
more than any landform class. Excluding it cost 27.5 points of recall.

USAGE
    python scripts/gnis_recall_check.py --gnis DomesticNames_FL.zip --catalog fl_catalog.csv
    python scripts/gnis_recall_check.py --gnis ... --catalog ... --radius 1.0
"""
import argparse
import csv
import io
import math
import sys
import zipfile
from collections import Counter

LANDFORM = {"Beach", "Cape", "Bar", "Bay", "Channel", "Island", "Reef", "Pillar"}
PLACES = {"Populated Place", "Civil", "Census", "Park", "Locale"}


def haversine_km(lat1, lng1, lat2, lng2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371.0 * math.asin(math.sqrt(a))


def read_gnis(path):
    if path.lower().endswith(".zip"):
        with zipfile.ZipFile(path) as z:
            member = [n for n in z.namelist() if n.lower().endswith(".txt")][0]
            text = z.read(member).decode("utf-8", "replace")
    else:
        with open(path, encoding="utf-8", errors="replace") as fh:
            text = fh.read()
    out = []
    for r in csv.DictReader(io.StringIO(text), delimiter="|"):
        try:
            out.append((r["feature_name"], r["feature_class"],
                        float(r["prim_lat_dec"]), float(r["prim_long_dec"])))
        except (TypeError, ValueError, KeyError):
            continue
    return out


def read_catalog(path):
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


def recall(ours, feats, classes, radius):
    """Fraction of our spots with SOME feature of `classes` within `radius` km."""
    hit = 0
    for _, la, lo in ours:
        d = radius / 111.0 + 0.01
        if any(f[1] in classes and abs(f[2] - la) < d and abs(f[3] - lo) < d
               and haversine_km(la, lo, f[2], f[3]) <= radius for f in feats):
            hit += 1
    return hit


def main():
    ap = argparse.ArgumentParser(description="Offline gazetteer recall check (no network)")
    ap.add_argument("--gnis", required=True)
    ap.add_argument("--catalog", required=True)
    ap.add_argument("--radius", type=float, default=2.0)
    args = ap.parse_args()

    feats = read_gnis(args.gnis)
    ours = read_catalog(args.catalog)
    print(f"gazetteer features: {len(feats)}   our spots: {len(ours)}   radius: {args.radius} km")
    print()

    print(f"{'class set':<34}{'recall':>16}{'pool':>10}")
    print("-" * 60)
    for label, cs in (("landforms only", LANDFORM),
                      ("+ Populated Place", LANDFORM | {"Populated Place"}),
                      ("+ all place classes", LANDFORM | PLACES),
                      ("ANY class (upper bound)", {f[1] for f in feats})):
        h = recall(ours, feats, cs, args.radius)
        pool = sum(1 for f in feats if f[1] in cs)
        print(f"{label:<34}{h:>6}/{len(ours):<4}({h / len(ours) * 100:5.1f}%){pool:>10}")

    print()
    print("nearest feature CLASS, per spot — this is what decides the class list:")
    cnt = Counter()
    d = args.radius / 111.0 + 0.01
    for _, la, lo in ours:
        near = [(haversine_km(la, lo, f[2], f[3]), f[1]) for f in feats
                if abs(f[2] - la) < d and abs(f[3] - lo) < d]
        near = [x for x in near if x[0] <= args.radius]
        if near:
            cnt[min(near)[1]] += 1
    for k, v in cnt.most_common(12):
        print(f"  {k:<20}{v:>4}")
    print()
    # ASCII only: the Windows console is cp1252 and a non-Latin-1 glyph raises
    # UnicodeEncodeError, which would kill the run AFTER all the useful output. Not worth a star.
    print("NOTE: if a class near the top of that list is missing from COASTAL_CLASSES in "
          "discover_spots_gnis.py,")
    print("      recall is being thrown away before a single ETOPO fetch happens.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
