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

# ── NGA GNS: the WORLDWIDE gazetteer, and the one source that serves both jobs ────────────────
# 144 of our 164 misplaced spots are outside the US and Europe (Indonesia 23, Chile 12, Philippines
# 11, Mexico 9, Sri Lanka 8), so GNIS and EEA cannot reach them. GNS covers everywhere outside the
# US, is US-Government PUBLIC DOMAIN (no attribution burden, no ODbL contamination), and it is the
# same gazetteer that grows the catalogue globally — one fetcher, two jobs.
#
# Queried through the ArcGIS REST service rather than the ~400 MB bulk download, because both jobs
# are LOCAL questions ("what is officially named near this coordinate?"), and a bbox query answers
# them without moving the whole planet.
GNS_QUERY = ("https://geonames.nga.mil/geon-ags/rest/services/RESEARCH/GIS_OUTPUT/"
             "MapServer/0/query")

# ⚠️⚠️ GNS IS A CORRECTION SOURCE, NOT A DISCOVERY SOURCE — measured 2026-07-27, and this corrects
# an optimistic claim of mine ("global expansion now uses the same fetcher").
# Calibrated the way the PT/IE pilot was: point it at regions where we already hold spots and ask
# whether it can rediscover them. Recall of our own catalogue, by GNS coastal landforms:
#     Bali / Java            6.1% @1 km   48.5% @3 km
#     SoCal                  0.0%         0.0%
#     SW France / N Spain    3.4%        55.2%
#     Sri Lanka south       35.7%        57.1%
#     Nicaragua / Costa Rica 6.2%        37.5%
#     (EEA bathing waters   45.9%        77.4%  — the bar to beat)
# TWO STRUCTURAL FACTS behind those numbers:
#   * ★ GNS EXCLUDES THE UNITED STATES. It is the FOREIGN names database; US names are in GNIS.
#     SoCal returned 44 features for the entire box, which is why its recall is a flat zero.
#   * The service caps at 3000 records per query and three of the five boxes hit it, so those
#     figures are LOWER BOUNDS — a real sweep must tile, not widen the box.
# It is excellent at the job it was added for: anchored NAME lookup near a known coordinate gave
# 75 of 164 corrections, 9 of them high-confidence. As a primary discovery source it would surface
# mostly non-surf coastal features while missing half the real breaks. Use EEA where it reaches.

# ⚠️ THE DESIGNATION FILTER IS NOT COSMETIC — it is what stops a confidently wrong proposal.
# Measured 2026-07-27 on 20 misplaced spots, an unfiltered name match returned:
#     Manzanillo        -> Manzanillo [FRM]  18.41 km   a FARM
#     Salalah - Fizayah -> Salalah    [ADM2] 14.11 km   an ADMINISTRATIVE DIVISION
# Both look like clean matches and would move a pin to somewhere with the right name and the wrong
# meaning. A surf break is named after a coastal FEATURE or a coastal TOWN, never after a district.
GNS_DESIGNATIONS = {
    # coastal landforms — the strongest evidence a break is here
    "BCH", "BCHS", "CAPE", "PT", "PTS", "BAY", "BAYS", "COVE", "COVES", "RF", "RFS",
    "ISL", "ISLS", "ISLET", "SPIT", "PEN", "CST", "HDLD", "ANCH", "SHOL", "BAR", "LGN",
    # and coastal TOWNS: `Populated Place` is not optional. Measured on GNIS, excluding it cost
    # 27.5 points of recall — breaks are named after the town (Ormond Beach, Flagler Beach).
    "PPL", "PPLA", "PPLA2", "PPLA3", "PPLC", "PPLL", "PPLQ", "PPLS", "PPLX",
    # a named stretch of coast
    "AREA", "LCTY", "RGN",
}

FIELDS = ["name", "country", "lat", "lng", "source", "source_id", "licence", "attribution"]


def fetch_gns(lat, lng, box_deg=0.25, timeout=120):
    """Officially named features near a coordinate, from NGA GNS. Never raises; [] on failure.

    `box_deg` is a HALF-box: 0.25 deg is about 28 km, comfortably wider than the worst misplacement
    measured (12.01 km) while staying inside the service's 3000-record page."""
    import ssl
    import urllib.request
    try:
        import certifi
        ctx = ssl.create_default_context(cafile=certifi.where())
    except Exception:
        ctx = ssl.create_default_context()
    params = {
        "f": "json", "where": "1=1",
        "geometry": json.dumps({"xmin": lng - box_deg, "ymin": lat - box_deg,
                                "xmax": lng + box_deg, "ymax": lat + box_deg}),
        "geometryType": "esriGeometryEnvelope", "inSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": "full_name,full_nm_nd,lat_dd,long_dd,desig_cd,fc,cc_ft",
        "returnGeometry": "false", "resultRecordCount": "3000",
    }
    try:
        req = urllib.request.Request(GNS_QUERY, data=urllib.parse.urlencode(params).encode(),
                                     headers={"User-Agent": "raw-surf-spot-sources/1.0"})
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
            payload = json.loads(r.read().decode("utf-8"))
    except Exception as e:
        print(f"  GNS query failed at ({lat},{lng}): {e}", file=sys.stderr)
        return []
    out = []
    for f in payload.get("features", []):
        a = f.get("attributes") or {}
        if a.get("desig_cd") not in GNS_DESIGNATIONS:
            continue
        name = a.get("full_nm_nd") or a.get("full_name")
        if not name or a.get("lat_dd") is None:
            continue
        out.append({"name": name, "country": a.get("cc_ft") or "", "lat": float(a["lat_dd"]),
                    "lng": float(a["long_dd"]), "source": f"gns:{a.get('desig_cd')}",
                    "source_id": a.get("ufi") or "", "licence": "public domain",
                    "attribution": "NGA GEOnet Names Server (US Government, public domain)"})
    return out


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
