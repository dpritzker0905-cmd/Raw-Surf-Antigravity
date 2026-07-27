#!/usr/bin/env python3
"""
spot_sources.py — open, government-published coastal locations, normalised to one shape.

THE IDEA
--------
Every surf catalogue big enough to matter is closed by terms of use (Wannasurf 9,511, Stormrider
5,000+), and every openly-licensed SURF catalogue is smaller than ours (OSM 539 real breaks,
Wikidata 40). Measured 2026-07-27 — see `RESEARCH-2026-07-27-surf-spot-data-sources.md`.

But surf spots are BEACHES, and governments publish beaches. Exhaustively, with coordinates, under
open licences, because they are legally obliged to: the EU Bathing Water Directive alone makes
every member state publish every coastal bathing site every year.

★ AND THE NAMES MATCH. The worry with a gazetteer is that officialdom says "Ehukai Beach" where a
surfer says "Pipeline". Measured against our own European spots, that worry is misplaced there —
the official beach name IS the surf name:

    Pors Carn        -> PORS CARN            1.97 km
    Carcans          -> CARCANS OCEAN        1.07 km
    Lafitenia        -> LAFITENIA            1.12 km
    Rossnowlagh      -> ROSSNOWLAGH          1.28 km
    Ribeira d'Ilhas  -> RIBEIRA DE ILHAS     1.06 km
    Thurso           -> Thurso               1.21 km

EEA recall against our 133 European spots: 45.9% @1 km, 64.7% @2 km, 77.4% @3 km.

SOURCES AND THEIR LICENCES (all verified 2026-07-27)
  EEA / EMODnet Bathing Waters   CC-BY 4.0        15,091 COASTAL sites in Europe (2024)
  GNIS (USGS)                    U.S. public domain   every named US feature
  NGA GNS                        "no licensing requirements or restrictions"   worldwide

Attribution obligations are carried per row in `licence` and `attribution`, so a downstream
importer can honour them precisely instead of guessing. Nothing here is scraped and nothing here
comes from a source whose terms forbid reuse.

READ-ONLY. Emits a normalised CSV; never touches the database.

USAGE
    python scripts/spot_sources.py --source eea --countries PT,ES,FR,IE,UK --out eu.csv
    python scripts/spot_sources.py --source eea --all-europe --out europe.csv
    python scripts/spot_sources.py --source gnis --gnis-file DomesticNames_FL.zip --out fl.csv
"""
import argparse
import csv
import io
import json
import sys
import urllib.parse
import zipfile

EMODNET_WFS = "https://ows.emodnet-humanactivities.eu/wfs"

# GNIS classes that a surf break is named after. `Cape` is "cape, head, neck, peninsula, point";
# `Bar` is "bar, ledge, reef, sandbar, shoal, spit". `Populated Place` is NOT optional — measured,
# it is the nearest feature for 40 of our 102 Florida spots, more than any landform class, because
# breaks are named after coastal towns (Ormond Beach, Melbourne Beach, Flagler Beach).
GNIS_CLASSES = {"Beach", "Cape", "Bar", "Bay", "Channel", "Island", "Reef", "Pillar",
                "Populated Place", "Civil", "Census", "Park", "Locale"}

FIELDS = ["name", "country", "lat", "lng", "source", "source_id", "licence", "attribution"]


def fetch_eea(countries=None, year=2024, limit=20000):
    """EU Bathing Water Directive coastal sites, via the EMODnet WFS. CC-BY 4.0.

    `bwatercat` distinguishes Coastal / Transitional / Lake / River — we take coastal only, which
    is 15,091 of the 15,436 sites reported for 2024."""
    import requests
    cql = f"bwatercat='Coastal Bathing Water' AND year={int(year)}"
    if countries:
        inlist = ",".join("'" + c.strip().upper() + "'" for c in countries)
        cql += f" AND countrycod IN ({inlist})"
    params = {
        "service": "WFS", "version": "2.0.0", "request": "GetFeature",
        "typeName": "emodnet:bathingwaters", "outputFormat": "application/json",
        "count": str(limit), "CQL_FILTER": cql,
    }
    url = EMODNET_WFS + "?" + urllib.parse.urlencode(params)
    r = requests.get(url, timeout=600)
    r.raise_for_status()
    doc = json.loads(r.content.decode("utf-8"))
    out = []
    for f in doc.get("features", []):
        p = f.get("properties", {})
        try:
            lat, lng = float(p["lat"]), float(p["lon"])
        except (TypeError, ValueError, KeyError):
            continue
        out.append({
            "name": (p.get("bwname") or "").strip(),
            "country": p.get("countrynam") or p.get("countrycod") or "",
            "lat": lat, "lng": lng,
            "source": "eea_bathing_water",
            "source_id": p.get("bwid") or "",
            "licence": "CC-BY 4.0",
            "attribution": "European Environment Agency / EU Bathing Water Directive",
        })
    return out


def fetch_gnis(path):
    """A GNIS state file (.txt or the shipped .zip). U.S. public domain."""
    if path.lower().endswith(".zip"):
        with zipfile.ZipFile(path) as z:
            member = [n for n in z.namelist() if n.lower().endswith(".txt")][0]
            text = z.read(member).decode("utf-8", "replace")
    else:
        with open(path, encoding="utf-8", errors="replace") as fh:
            text = fh.read()
    out = []
    for r in csv.DictReader(io.StringIO(text), delimiter="|"):
        if (r.get("feature_class") or "").strip() not in GNIS_CLASSES:
            continue
        try:
            lat, lng = float(r["prim_lat_dec"]), float(r["prim_long_dec"])
        except (TypeError, ValueError, KeyError):
            continue
        if lat == 0 and lng == 0:
            continue
        out.append({
            "name": (r.get("feature_name") or "").strip(),
            "country": "USA", "lat": lat, "lng": lng,
            "source": "gnis",
            "source_id": (r.get("feature_id") or r.get("﻿feature_id") or "").strip(),
            "licence": "public domain (U.S. Government)",
            "attribution": "U.S. Geological Survey, Geographic Names Information System",
        })
    return out


def main():
    ap = argparse.ArgumentParser(description="Normalise open coastal-location sources (read-only)")
    ap.add_argument("--source", required=True, choices=["eea", "gnis"])
    ap.add_argument("--countries", default=None, help="EEA: comma-separated ISO codes")
    ap.add_argument("--all-europe", action="store_true", help="EEA: every reporting country")
    ap.add_argument("--year", type=int, default=2024)
    ap.add_argument("--gnis-file", default=None)
    ap.add_argument("--out", default="spot_sources.csv")
    args = ap.parse_args()

    if args.source == "eea":
        countries = None if args.all_europe else (args.countries.split(",") if args.countries else None)
        rows = fetch_eea(countries=countries, year=args.year)
    else:
        if not args.gnis_file:
            print("ERROR: --gnis-file is required for --source gnis")
            return 2
        rows = fetch_gnis(args.gnis_file)

    with open(args.out, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=FIELDS)
        w.writeheader()
        for r in rows:
            w.writerow(r)

    import collections
    print(f"{len(rows)} locations -> {args.out}")
    for k, v in collections.Counter(r["country"] for r in rows).most_common(12):
        print(f"  {k:<24}{v:>6}")
    if rows:
        print(f"\nlicence: {rows[0]['licence']}")
        print(f"attribution required: {rows[0]['attribution']}")
    print("\nNOTHING was written to the database.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
