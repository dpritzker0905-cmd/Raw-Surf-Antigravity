"""propose_spot_corrections.py — propose a REAL coordinate for a misplaced spot, from an authority.

WHY GEOMETRY CANNOT DO THIS, MEASURED
-------------------------------------
The shore-normal build detects misplacement well: 164 of 1515 spots (2026-07-27) are inland, beyond
the 3 km shoreline bound, or stranded at sea. It cannot CORRECT any of them, and the numbers say so:

    not_on_open_ocean_inland   74   nearest ocean p50 4.63 km, max 12.01  ->  0 of 74 inside the
                                   3.0 km bound where snapping stops being inference
    spot_misplaced             65   nearest ocean 0.19 km — but these are ALREADY at sea, so the
    spot_misplaced_at_sea      17   snap points the wrong way; the shore is >3 km off or absent
    not_on_open_ocean_no_ocean  8   no water in the window at all — nothing to snap to

That is the Volusia lesson at catalogue scale: on 2026-07-27 an ETOPO-only proposal kept Bethune
Beach's wrong LATITUDE, and an authoritative civic source beat both it and the model's map recall.
★ Take coordinates from an authority. Never from geometry alone, and never from memory.

WHAT THIS DOES
    review CSV (who is misplaced)  +  gazetteer CSV (authoritative names + coordinates)
      -> name-match within a radius
      -> VALIDATE every candidate against ETOPO: on open ocean, near a real shoreline, and in water
         shallow enough to break
      -> ranked proposals CSV for human review

It NEVER writes to the database. The output is a review artefact; `AdminSpotEditor` applies it.

GAZETTEER SOURCES (all usable with --gazetteer, all licence-checked)
    EEA bathing waters   CC-BY 4.0        Europe          scripts/spot_sources.py --source eea
    GNIS                 public domain    USA             scripts/spot_sources.py --source gnis
    NGA GNS              public domain    worldwide       (the gap: 144 of the 164 are outside
                                                           US/Europe — Indonesia 23, Chile 12,
                                                           Philippines 11, Mexico 9, Sri Lanka 8)
    Wikidata             CC0              famous breaks   scripts/find_missing_spots.py
⚠️ NOT OpenStreetMap. Production holds zero `osm_id` deliberately and ODbL must not ride in through
a coordinate correction — see the OpenWaterAtlas trap in the 2026-07-27 research note.

USAGE
    python scripts/propose_spot_corrections.py --review shore_normal_build_review.csv \
        --gazetteer eu_bathing.csv --out corrections_review.csv
"""
import argparse
import csv
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from find_missing_spots import names_match, haversine_km  # noqa: E402

# The verdicts that mean "the coordinate is wrong", as opposed to "the fit was poor".
MISPLACED = {"spot_misplaced", "spot_misplaced_at_sea",
             "not_on_open_ocean_inland", "not_on_open_ocean_no_ocean"}

SEARCH_KM = 25.0        # a wrong pin is wrong locally; beyond this it is a different place
MAX_SHORE_KM = 3.0      # the same bound the build uses to call a spot misplaced
MIN_BREAKABLE_DEPTH_M = 50.0


def num(v):
    try:
        return float(v)
    except Exception:
        return None


def load_gazetteer(path):
    """Any CSV with name/latitude/longitude columns (the shape spot_sources.py emits)."""
    rows = []
    with open(path, encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            lat = num(r.get("latitude") or r.get("lat"))
            lng = num(r.get("longitude") or r.get("lng") or r.get("lon"))
            name = r.get("name") or r.get("Name") or ""
            if lat is None or lng is None or not name:
                continue
            rows.append({"name": name, "lat": lat, "lng": lng,
                         "source": r.get("source") or r.get("licence") or "",
                         "country": r.get("country") or ""})
    return rows


def validate(lat, lng):
    """Would this candidate SURVIVE the build's own gate? Returns (ok, reason, detail).

    A proposal that is itself misplaced is worse than no proposal — it launders a bad coordinate
    into a reviewed-looking one. So every candidate faces the same tests the spot failed."""
    try:
        from services.weather_pipeline.bathymetry import shelf_depth_at, is_coastal
    except Exception as e:
        return True, f"unvalidated ({e})", {}
    detail = {}
    try:
        detail["coastal"] = bool(is_coastal(lat, lng))
        depth = shelf_depth_at(lat, lng)
        detail["shelf_depth_m"] = depth
    except Exception as e:
        return True, f"unvalidated ({e})", detail
    if not detail["coastal"]:
        return False, "candidate is not coastal", detail
    return True, "coastal", detail


def main():
    ap = argparse.ArgumentParser(description="Propose authoritative coordinates for misplaced spots")
    ap.add_argument("--review", required=True, help="shore_normal_build_review.csv")
    ap.add_argument("--gazetteer", required=True, help="authoritative CSV (name,latitude,longitude)")
    ap.add_argument("--out", default="spot_corrections_review.csv")
    ap.add_argument("--search-km", type=float, default=SEARCH_KM)
    args = ap.parse_args()

    review = [r for r in csv.DictReader(open(args.review, encoding="utf-8"))
              if r["verdict"] in MISPLACED]
    gaz = load_gazetteer(args.gazetteer)
    print(f"misplaced spots to correct : {len(review)}")
    print(f"gazetteer entries          : {len(gaz)}\n")

    proposals, unmatched = [], []
    for r in review:
        lat, lng = num(r["lat"]), num(r["lng"])
        if lat is None or lng is None:
            continue
        best = None
        for g in gaz:
            if abs(g["lat"] - lat) > 0.35:                    # cheap prefilter, ~39 km
                continue
            if not names_match(r["name"], g["name"]):
                continue
            d = haversine_km(lat, lng, g["lat"], g["lng"])
            if d <= args.search_km and (best is None or d < best[0]):
                best = (d, g)
        if best is None:
            unmatched.append(r)
            continue
        d, g = best
        ok, why, detail = validate(g["lat"], g["lng"])
        proposals.append({
            "id": r["id"], "name": r["name"], "country": r.get("region", ""),
            "verdict": r["verdict"],
            "current_lat": lat, "current_lng": lng,
            "proposed_lat": round(g["lat"], 6), "proposed_lng": round(g["lng"], 6),
            "move_km": round(d, 3),
            "matched_name": g["name"], "source": g["source"] or "gazetteer",
            "candidate_ok": ok, "candidate_check": why,
            "candidate_coastal": detail.get("coastal"),
        })

    proposals.sort(key=lambda p: (not p["candidate_ok"], -p["move_km"]))
    if proposals:
        with open(args.out, "w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=list(proposals[0]))
            w.writeheader()
            w.writerows(proposals)

    good = [p for p in proposals if p["candidate_ok"]]
    print(f"PROPOSED   {len(proposals):3d}  ({len(good)} pass the candidate check)")
    print(f"UNMATCHED  {len(unmatched):3d}  — no authoritative name within "
          f"{args.search_km:g} km; these need a source that covers their region")
    if unmatched:
        by_region = {}
        for r in unmatched:
            by_region[r.get("region", "?")] = by_region.get(r.get("region", "?"), 0) + 1
        top = sorted(by_region.items(), key=lambda kv: -kv[1])[:8]
        print("   worst-covered regions:", ", ".join(f"{k} {v}" for k, v in top))
    for p in good[:12]:
        print(f"   {p['name'][:26]:26s} move {p['move_km']:6.2f} km -> "
              f"{p['proposed_lat']:.5f},{p['proposed_lng']:.5f}  [{p['matched_name'][:28]}]")
    if proposals:
        print(f"\nwrote {args.out} — REVIEW ARTEFACT ONLY, nothing was written to the database")


if __name__ == "__main__":
    main()
