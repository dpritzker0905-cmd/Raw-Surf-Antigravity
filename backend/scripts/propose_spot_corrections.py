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


def strict_names_match(spot_name, candidate_name):
    """A STRICTER match than the duplicate gate's, because the two jobs differ.

    `find_missing_spots.names_match` is deliberately loose: it must catch a duplicate, and a missed
    duplicate is worse than a false one. Here a false match MOVES A REAL SPOT, so the trade runs the
    other way.

    ⚠️ The specific failure this exists to stop, measured 2026-07-27 against NGA GNS: our
    "Playa Hermosa (Nicaragua)" matched a feature simply called "Nicaragua" 11.33 km away, because
    the parenthetical DISAMBIGUATOR is a token like any other. Requiring a token from the name
    OUTSIDE the brackets kills that while keeping `Jaws (Peahi)` -> `Peahi` working in the
    duplicate gate, which still uses the loose matcher and must keep doing so.
    """
    import re
    if not names_match(spot_name, candidate_name):
        return False
    primary = re.sub(r"\([^)]*\)", " ", spot_name or "")
    from find_missing_spots import normalise_name
    outer, cand = normalise_name(primary), normalise_name(candidate_name)
    return bool(outer & cand)


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


# ⚠️ A NAME MATCH IS NOT A COORDINATE. Measured 2026-07-27 against NGA GNS, the largest proposed
# moves were the least trustworthy, and all in the same way — the authority names a PLACE, and the
# place is not the break:
#     Margaret River -> Margaret River   14.05 km   the TOWN, ~10 km inland of Surfers Point
#     Same           -> Same Adentro     20.87 km   "adentro" is Spanish for INLAND
#     Chiba          -> Chiba Peninsula  20.63 km   a peninsula CENTROID
# A coastal town passes `is_coastal` happily while sitting kilometres from any surf. So proposals
# are TIERED by how directly the matched feature evidences a break, and the tier is in the output —
# an unranked list invites applying a 20 km move to a town alongside a 2 km move to a named beach.
COASTAL_STRONG = {"BCH", "BCHS", "CAPE", "PT", "PTS", "RF", "RFS", "COVE", "COVES",
                  "SPIT", "HDLD", "ANCH", "BAR", "BAY", "BAYS", "LGN", "SHOL"}
PLACE_LIKE = {"PPL", "PPLA", "PPLA2", "PPLA3", "PPLC", "PPLL", "PPLQ", "PPLS", "PPLX", "LCTY"}


def confidence_of(desig, move_km):
    """How much the match evidences THIS BREAK's position. Measured tiers, not taste."""
    d = (desig or "").replace("gns:", "").strip().upper()
    if d in COASTAL_STRONG and move_km <= 5.0:
        return "high", "a named coastal feature, close by"
    if d in COASTAL_STRONG and move_km <= 12.0:
        return "medium", "a named coastal feature, but a long move"
    if d in PLACE_LIKE and move_km <= 5.0:
        return "medium", "a settlement, close by — the break is named after the town"
    if move_km > 12.0:
        return "low", "a long move to a place-name; the place is probably not the break"
    return "low", "weak evidence — review against an independent source"


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
    ap.add_argument("--gazetteer", help="authoritative CSV (name,latitude,longitude)")
    ap.add_argument("--gns", action="store_true",
                    help="query NGA GNS per spot (worldwide, public domain) instead of a CSV")
    ap.add_argument("--limit", type=int, default=0, help="only the first N misplaced spots")
    ap.add_argument("--out", default="spot_corrections_review.csv")
    ap.add_argument("--search-km", type=float, default=SEARCH_KM)
    args = ap.parse_args()

    if not (args.gazetteer or args.gns):
        print("ERROR: pass --gazetteer <csv> or --gns")
        return 2
    review = [r for r in csv.DictReader(open(args.review, encoding="utf-8"))
              if r["verdict"] in MISPLACED]
    if args.limit:
        review = review[:args.limit]
    gaz = load_gazetteer(args.gazetteer) if args.gazetteer else []
    print(f"misplaced spots to correct : {len(review)}")
    print(f"gazetteer entries          : {len(gaz) if gaz else 'per-spot GNS query'}\n")

    proposals, unmatched = [], []
    for i, r in enumerate(review, 1):
        lat, lng = num(r["lat"]), num(r["lng"])
        if lat is None or lng is None:
            continue
        candidates = gaz
        if args.gns:
            from spot_sources import fetch_gns
            candidates = fetch_gns(lat, lng)
            if i % 20 == 0:
                print(f"   ...{i}/{len(review)}", flush=True)
        best = None
        for g in candidates:
            if abs(g["lat"] - lat) > 0.35:                    # cheap prefilter, ~39 km
                continue
            if not strict_names_match(r["name"], g["name"]):
                continue
            d = haversine_km(lat, lng, g["lat"], g["lng"])
            if d <= args.search_km and (best is None or d < best[0]):
                best = (d, g)
        if best is None:
            unmatched.append(r)
            continue
        d, g = best
        ok, why, detail = validate(g["lat"], g["lng"])
        conf, conf_why = confidence_of(g.get("source", ""), d)
        proposals.append({
            "confidence": conf, "confidence_why": conf_why,
            "id": r["id"], "name": r["name"], "country": r.get("region", ""),
            "verdict": r["verdict"],
            "current_lat": lat, "current_lng": lng,
            "proposed_lat": round(g["lat"], 6), "proposed_lng": round(g["lng"], 6),
            "move_km": round(d, 3),
            "matched_name": g["name"], "source": g["source"] or "gazetteer",
            "candidate_ok": ok, "candidate_check": why,
            "candidate_coastal": detail.get("coastal"),
        })

    rank = {"high": 0, "medium": 1, "low": 2}
    proposals.sort(key=lambda p: (not p["candidate_ok"], rank[p["confidence"]], p["move_km"]))
    if proposals:
        with open(args.out, "w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=list(proposals[0]))
            w.writeheader()
            w.writerows(proposals)

    good = [p for p in proposals if p["candidate_ok"]]
    tiers = {t: sum(1 for p in good if p["confidence"] == t) for t in ("high", "medium", "low")}
    print(f"PROPOSED   {len(proposals):3d}  ({len(good)} pass the candidate check)")
    print(f"   by evidence: HIGH {tiers['high']}  MEDIUM {tiers['medium']}  LOW {tiers['low']}"
          f"   <- apply HIGH first; LOW needs an independent source before it is trusted")
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
