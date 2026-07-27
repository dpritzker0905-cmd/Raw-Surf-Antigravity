#!/usr/bin/env python3
"""
import_reviewed_spots.py — the import path the admin button never had.

WHY THIS EXISTS
---------------
`import_curated_spots` reads 358 hardcoded `CURATED_SPOTS` and skips anything already present, and
the catalogue already contains all 358. A correct run adds ZERO. The admin Import button was
structurally incapable of adding a spot — it had no source of new ones. This gives it one.

The source is `filter_spot_candidates.py`, which turns government-published coastal locations
(EEA bathing waters CC-BY 4.0, GNIS public domain, NGA GNS unrestricted) into candidates our own
physics has validated. Nothing here is scraped and nothing comes from a source whose terms forbid
reuse.

THE RULES THIS ENFORCES, all of them learned the hard way this week
  * DRY RUN BY DEFAULT. Writing requires --commit. The catalogue has been damaged by confident
    automation before; 158 spots were flagged misplaced on 2026-07-27 and three were shipping shore
    normals fitted to a lagoon.
  * ONLY `decision == NEW` rows. KNOWN and DUPLICATE_CLUSTER are refusals, not filters to override.
  * PROXIMITY DEDUPE AGAINST LIVE PRODUCTION at insert time, not just against the CSV's snapshot —
    the catalogue may have moved since the review.
  * NEVER `is_verified_peak`. That flag was false for 1256 spots because bulk importers hardcoded
    it True; these rows are machine-proposed and unverified by definition. They land
    `accuracy_flag='unverified'` and `flagged_for_review=true` so they enter the Precision Queue
    for a human, exactly like any other unreviewed placement.
  * PROVENANCE IS WRITTEN, NOT IMPLIED. `description` carries the source, its licence and the
    required attribution, so a CC-BY obligation travels with the row instead of living in a
    runbook nobody reads.
  * `osm_id` IS NEVER SET. Production carries zero OSM-derived rows and that is deliberate — OSM is
    ODbL share-alike. None of these sources is OSM; the column stays null so that remains true and
    auditable.

USAGE
    python scripts/import_reviewed_spots.py --in reviewed.csv                 # dry run
    python scripts/import_reviewed_spots.py --in reviewed.csv --limit 50 --commit
Env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
"""
import argparse
import csv
import math
import os
import sys
import uuid
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

DEDUPE_KM = 2.0
PAGE = 1000


def haversine_km(lat1, lng1, lat2, lng2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371.0 * math.asin(math.sqrt(a))


def fetch_live_spots(base, key):
    """Paginated — PostgREST silently caps at 1000 rows and still returns 200. It dropped 516 of
    1516 spots undetected on 2026-07-26."""
    import requests
    out, offset = [], 0
    while True:
        r = requests.get(
            f"{base}/rest/v1/surf_spots",
            headers={"apikey": key, "Authorization": f"Bearer {key}",
                     "Range-Unit": "items", "Range": f"{offset}-{offset + PAGE - 1}"},
            params={"select": "id,name,latitude,longitude,country"}, timeout=60)
        r.raise_for_status()
        batch = r.json()
        out.extend(batch)
        if len(batch) < PAGE:
            return out
        offset += PAGE


def main():
    ap = argparse.ArgumentParser(description="Import reviewed spot candidates (dry run by default)")
    ap.add_argument("--in", dest="inp", required=True)
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--commit", action="store_true", help="actually write; omit for a dry run")
    ap.add_argument("--min-fetch", type=float, default=200.0)
    args = ap.parse_args()

    with open(args.inp, encoding="utf-8", errors="replace") as fh:
        rows = list(csv.DictReader(fh))
    new = [r for r in rows if (r.get("decision") or "") == "NEW"]
    print(f"{len(rows)} reviewed rows, {len(new)} marked NEW")
    for k, v in Counter(r.get("decision") for r in rows).most_common():
        print(f"  {k:<24}{v:>6}")

    keep = []
    for r in new:
        try:
            lat, lng = float(r["lat"]), float(r["lng"])
            fetch_km = float(r["fetch_km"]) if r.get("fetch_km") else None
        except (TypeError, ValueError):
            continue
        if not (r.get("name") or "").strip():
            continue
        if fetch_km is not None and fetch_km < args.min_fetch:
            continue
        keep.append(dict(r, lat=lat, lng=lng))
    print(f"{len(keep)} pass the import gate (named, NEW, fetch >= {args.min_fetch:.0f} km)")

    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY", "")
    if not base or not key:
        print("\nERROR: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required.")
        return 2

    live = fetch_live_spots(base, key)
    print(f"live catalogue: {len(live)} spots (deduping against production, not the CSV snapshot)")
    live_pts = [(s.get("name") or "", s.get("latitude"), s.get("longitude"))
                for s in live if s.get("latitude") is not None]

    payload, skipped = [], 0
    for r in keep:
        clash = next((n for n, la, lo in live_pts
                      if abs(la - r["lat"]) < 0.05 and abs(lo - r["lng"]) < 0.06
                      and haversine_km(r["lat"], r["lng"], la, lo) <= DEDUPE_KM), None)
        if clash:
            skipped += 1
            continue
        src = r.get("source") or "open-data"
        lic = r.get("licence") or ""
        att = r.get("attribution") or ""
        payload.append({
            "id": str(uuid.uuid4()),
            "name": r["name"].strip(),
            "country": (r.get("country") or "").strip() or None,
            "latitude": r["lat"], "longitude": r["lng"],
            "original_latitude": r["lat"], "original_longitude": r["lng"],
            "is_active": True,
            # machine-proposed => unverified and queued for a human, never verified-peak
            "is_verified_peak": False,
            "accuracy_flag": "unverified",
            "flagged_for_review": True,
            "description": (f"Imported from {src} ({lic}). Attribution: {att}. "
                            f"Machine-proposed from open government data and validated against "
                            f"ETOPO 2022 bathymetry; placement not yet human-verified."),
        })
    print(f"{skipped} skipped as already within {DEDUPE_KM} km of a live spot")
    if args.limit:
        payload = payload[:args.limit]
    print(f"{len(payload)} would be inserted")

    if payload:
        print("\nfirst 10:")
        for p in payload[:10]:
            print(f"  {p['name'][:38]:<40}{p['country'] or '':<16}"
                  f"{p['latitude']:.4f},{p['longitude']:.4f}")

    if not args.commit:
        print("\nDRY RUN — nothing written. Re-run with --commit to insert.")
        return 0
    if not payload:
        print("\nNothing to insert.")
        return 0

    import requests
    inserted = 0
    for i in range(0, len(payload), 200):
        chunk = payload[i:i + 200]
        r = requests.post(f"{base}/rest/v1/surf_spots",
                          headers={"apikey": key, "Authorization": f"Bearer {key}",
                                   "Content-Type": "application/json",
                                   "Prefer": "return=minimal"},
                          json=chunk, timeout=120)
        if r.status_code >= 300:
            print(f"  insert failed at row {i}: HTTP {r.status_code} {r.text[:200]}")
            break
        inserted += len(chunk)
        print(f"  inserted {inserted}/{len(payload)}")
    print(f"\nInserted {inserted}. Every row is flagged_for_review — work them in the "
          f"Precision Queue, then re-run the shore-normal build so they get geometry.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
