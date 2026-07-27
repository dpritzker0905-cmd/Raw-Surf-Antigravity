#!/usr/bin/env python3
"""
find_missing_spots.py — which named surf breaks is the catalogue missing?

SOURCE + LICENCE (this is the whole reason the script looks the way it does)
Wikidata, classes Q3482498 "surf break" and Q2368508 "surf spot". Wikidata structured data is
**CC0 — public domain**: no attribution, no share-alike, so a coordinate taken from it can go into
`surf_spots` safely. That is NOT true of the alternatives:
  * OSM / Nominatim / Overpass — **ODbL share-alike**. `import_global_spots.import_osm_spots` can
    write OSM coordinates into the catalogue and production currently has **zero** spots with an
    `osm_id`, i.e. the table is clean of ODbL data. Keep it that way.
  * Surfline / Wannasurf — terms of use prohibit scraping.

EVERY CANDIDATE IS CROSS-CHECKED AGAINST ETOPO before it is proposed, because a gazetteer hit is
not proof of a surf break — the same discipline that caught GeoNames returning a lagoon for Okanda
and a point 118 km away for Tarimbang. A candidate is only reported as confirmed when ETOPO puts it
within 2 km of a real shoreline.

MEASURED 2026-07-27: Wikidata holds only 40 surf breaks with coordinates, of which 21 are absent
from the catalogue and **14 are ETOPO-confirmed coastal** — including Jaws (Pe'ahi), Cloud 9,
Mavericks, Shipstern Bluff, Belharra and Guincho. So this is a precision tool for famous missing
breaks, NOT a route to bulk expansion: there is no legitimate large-scale source, which is the same
conclusion the 2026-07-26 expansion research reached independently.

READ-ONLY. Writes a review CSV; nothing goes near the database.

USAGE
    python scripts/find_missing_spots.py                       # catalogue from Supabase
    python scripts/find_missing_spots.py --catalog review.csv  # offline (name,lat,lng columns)
"""
import concurrent.futures as cf
import csv
import math
import os
import sys

import requests

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

SPARQL = "https://query.wikidata.org/sparql"
UA = {"User-Agent": "raw-surf-spot-gap-analysis/1.0", "Accept": "application/sparql-results+json"}
NEAR_KM = 2.0            # a Wikidata break within this of one of ours is the SAME break
CONFIRM_SHORE_KM = 2.0   # ETOPO must put the candidate this close to a real shoreline

# No wdt:P279* subclass closure — the transitive walk times the public endpoint out (504), and
# direct P31 on the two classes is what we actually want.
QUERY = """
SELECT ?item ?itemLabel ?lat ?lon ?countryLabel WHERE {
  { ?item wdt:P31 wd:Q3482498 } UNION { ?item wdt:P31 wd:Q2368508 }
  ?item p:P625/psv:P625 ?c .
  ?c wikibase:geoLatitude ?lat ; wikibase:geoLongitude ?lon .
  OPTIONAL { ?item wdt:P17 ?country . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul". }
}
"""


def haversine_km(lat1, lng1, lat2, lng2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lng2 - lng1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371.0 * math.asin(math.sqrt(h))


def fetch_wikidata():
    r = requests.post(SPARQL, data={"query": QUERY, "format": "json"}, headers=UA, timeout=180)
    r.raise_for_status()
    out = []
    for b in r.json()["results"]["bindings"]:
        try:
            out.append({"qid": b["item"]["value"].rsplit("/", 1)[-1],
                        "name": b.get("itemLabel", {}).get("value", ""),
                        "lat": float(b["lat"]["value"]), "lng": float(b["lon"]["value"]),
                        "country": b.get("countryLabel", {}).get("value", "")})
        except (KeyError, TypeError, ValueError):
            continue
    return out


def load_catalog(path=None):
    """Spots from Supabase (paginated), or from a build-review CSV when ``path`` is given."""
    if path:
        out = []
        with open(path, encoding="utf-8") as fh:
            for r in csv.DictReader(fh):
                lat = r.get("lat") or r.get("latitude")
                lng = r.get("lng") or r.get("longitude")
                try:
                    out.append((r.get("name"), float(lat), float(lng)))
                except (TypeError, ValueError):
                    continue
        return out
    from scripts.build_shore_normals import fetch_spots
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY", "")
    if not base or not key:
        raise SystemExit("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required, or --catalog CSV")
    return [(s["name"], float(s["latitude"]), float(s["longitude"]))
            for s in fetch_spots(base, key)]


def verify_against_etopo(cand):
    """A gazetteer hit is a claim, not evidence. ETOPO is the independent check."""
    import numpy as np
    from scripts.build_shore_normals import fetch_window
    from services.weather_pipeline.shore_normal_fit import (
        MAX_SPREAD_DEG, fit_shore_normal, nearest_shoreline_km)
    try:
        elev, lats, lons = fetch_window(cand["lat"], cand["lng"], 0.045)
    except Exception:
        return cand, None
    elev = np.where(np.isnan(elev), 0.0, elev)
    bearing, spread, n = fit_shore_normal(elev, lats, lons, cand["lat"], cand["lng"])
    return cand, {"shore_km": nearest_shoreline_km(elev, lats, lons, cand["lat"], cand["lng"]),
                  "normal": bearing, "spread": spread,
                  "ok": bool(spread is not None and spread <= MAX_SPREAD_DEG and n >= 3)}


def main():
    path = None
    if "--catalog" in sys.argv:
        path = sys.argv[sys.argv.index("--catalog") + 1]
    ours = load_catalog(path)
    print(f"catalogue: {len(ours)} spots")
    wd = fetch_wikidata()
    print(f"Wikidata surf breaks/spots with coordinates: {len(wd)}")

    missing = []
    for w in wd:
        best = None
        for name, lat, lng in ours:
            if abs(lat - w["lat"]) > 0.05:          # cheap prefilter before the haversine
                continue
            km = haversine_km(w["lat"], w["lng"], lat, lng)
            if best is None or km < best[0]:
                best = (km, name)
        if best is None or best[0] > NEAR_KM:
            w["nearest_ours_km"] = None if best is None else round(best[0], 2)
            w["nearest_ours"] = None if best is None else best[1]
            missing.append(w)
    print(f"absent from the catalogue (no spot within {NEAR_KM} km): {len(missing)}")

    rows = []
    with cf.ThreadPoolExecutor(max_workers=4) as ex:
        for cand, chk in ex.map(verify_against_etopo, missing):
            rows.append((cand, chk))

    good = [(c, k) for c, k in rows
            if k and k["shore_km"] is not None and k["shore_km"] <= CONFIRM_SHORE_KM]
    print(f"ETOPO confirms {len(good)} are within {CONFIRM_SHORE_KM} km of a real shoreline\n")
    print(f"{'name':<32}{'country':<18}{'shore_km':>9}{'normal':>8}  qid")
    for c, k in sorted(good, key=lambda x: x[1]["shore_km"]):
        nrm = "  n/a" if k["normal"] is None else f"{k['normal']:6.1f}"
        print(f"{(c['name'] or '?')[:31]:<32}{(c['country'] or '')[:17]:<18}"
              f"{k['shore_km']:>9.2f}{nrm:>8}  {c['qid']}")

    out = "missing_spots_wikidata.csv"
    with open(out, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["name", "country", "latitude", "longitude", "wikidata_qid",
                    "etopo_shore_km", "etopo_shore_normal_deg", "etopo_spread_deg",
                    "nearest_existing_spot", "nearest_existing_km", "source_licence"])
        for c, k in sorted(rows, key=lambda x: (x[1] is None,
                                                (x[1] or {}).get("shore_km") or 9e9)):
            w.writerow([c["name"], c["country"], c["lat"], c["lng"], c["qid"],
                        None if not k or k["shore_km"] is None else round(k["shore_km"], 2),
                        None if not k or k["normal"] is None else round(k["normal"], 1),
                        None if not k or k["spread"] is None else round(k["spread"], 1),
                        c.get("nearest_ours"), c.get("nearest_ours_km"), "Wikidata CC0"])
    print(f"\nwrote {out} — review before importing; nothing was written to the database.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
