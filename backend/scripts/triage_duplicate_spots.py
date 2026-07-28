#!/usr/bin/env python3
"""
triage_duplicate_spots.py — find the duplicates the merge tool cannot see. NEVER WRITES.

WHY THIS EXISTS
---------------
`dedup_surf_spots.py` groups by `SurfSpot.name` with SQL equality, so it only ever finds
BYTE-IDENTICAL names in the same state. The 2026-07-27 sweep found **302 name-matching pairs within
12 km**, and the clearest defect in the whole catalogue is invisible to that tool:

    Teahupo'o   vs   Teahupoo      140 m apart

— an apostrophe variant. `22f84245` fixed apostrophe handling in the duplicate GATE for new imports
but was never applied retroactively to existing rows.

A duplicate is worse than a gap: it permanently splits reports, ratings, favourites and search
across two rows that both look real to a user.

⚠️ WHY THIS DOES NOT MERGE ANYTHING
Discovery must be BROAD; deletion must be NARROW. `dedup_surf_spots.py` re-parents 22 foreign-key
tables before deleting a row, and that is the only safe way to merge — but pointing its destructive
path at a loose name matcher would erase real breaks. `Lower Trestles` and `Upper Trestles` ARE
separate peaks; so are `Ponce Inlet North/South Jetty` and `Rockaway 90th/92nd Street`. So this
emits a REVIEW ARTEFACT and stops, exactly like `propose_spot_corrections.py`.

★ THE DISCRIMINATOR, calibrated against the pairs a human already adjudicated on 2026-07-27:
what matters is not that two names overlap, but WHAT THE DIFFERENCE BETWEEN THEM MEANS. If the
differing tokens are positional (north/south/upper/lower/1st/90th/jetty/pier) the pair is two
peaks on one feature. If they are empty or decorative, it is one break written twice.

USAGE
    python scripts/triage_duplicate_spots.py                 # report to stdout
    python scripts/triage_duplicate_spots.py --csv out.csv   # + a reviewable file
"""
import argparse
import csv
import json
import os
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.spot_duplicates import (  # noqa: E402
    SAME_BREAK_KM, classify, find_pairs, summarise)

BASE_URL = os.environ.get("SIM_FORECAST_BASE_URL",
                          "https://raw-surf-antigravity.onrender.com").rstrip("/")


def fetch_spots():
    req = urllib.request.Request(f"{BASE_URL}/api/surf-spots",
                                 headers={"User-Agent": "raw-surf-duplicate-triage"})
    with urllib.request.urlopen(req, timeout=90) as resp:
        rows = json.loads(resp.read().decode("utf-8"))
    return [r for r in rows
            if r.get("is_active") and r.get("latitude") is not None
            and r.get("longitude") is not None]


def main():
    ap = argparse.ArgumentParser(description="Triage duplicate surf spots. Never writes.")
    ap.add_argument("--csv", help="write the full reviewable table here")
    ap.add_argument("--max-km", type=float, default=SAME_BREAK_KM)
    args = ap.parse_args()

    spots = fetch_spots()
    pairs = find_pairs(spots, args.max_km)
    counts = {}
    for p in pairs:
        counts[p["tier"]] = counts.get(p["tier"], 0) + 1
    print(f"{len(spots)} active spots -> {len(pairs)} name-matching pairs within {args.max_km} km")
    for tier in ("IDENTICAL", "VARIANT", "WEAK", "DISTINCT_PEAKS"):
        print(f"  {tier:<15} {counts.get(tier, 0)}")

    print("\nIDENTICAL — same name after normalisation. These are the merge candidates:")
    for p in [x for x in pairs if x["tier"] == "IDENTICAL"]:
        print(f"  {p['km']:>7.3f} km  {p['name_a']!r} ({p['region_a']}) | "
              f"{p['name_b']!r} ({p['region_b']})")
        print(f"            a={p['id_a']}  b={p['id_b']}")

    print("\nVARIANT — one name contains the other. NEEDS A HUMAN: some are real sub-peaks.")
    for p in [x for x in pairs if x["tier"] == "VARIANT"][:25]:
        print(f"  {p['km']:>7.3f} km  {p['name_a']!r} | {p['name_b']!r}   ({p['why']})")

    if args.csv:
        with open(args.csv, "w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=list(pairs[0].keys()) if pairs else ["tier"])
            w.writeheader()
            w.writerows(pairs)
        print(f"\nwrote {len(pairs)} rows to {args.csv}")

    print("\n⚠️ NOTHING WAS WRITTEN. Merging must go through dedup_surf_spots.py, which re-parents "
          "22 foreign-key tables before deleting a row — deactivating a duplicate instead would "
          "strand every report and rating attached to it.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
