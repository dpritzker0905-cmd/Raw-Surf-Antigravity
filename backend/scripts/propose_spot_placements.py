#!/usr/bin/env python3
"""
propose_spot_placements.py — triage misplaced surf spots, and propose a coordinate ONLY where
the geometry can justify one.

WHY NOT JUST SNAP EVERYTHING TO THE NEAREST COAST
-------------------------------------------------
Measured 2026-07-27 on 54 placement-failure spots. Snapping to the nearest shoreline produces a
shore normal that passes the confidence gate 87-94% of the time — but *passing the gate is not
being right*. The gate measures whether the geometry at the snapped point is self-consistent; it
says nothing about whether that point is the correct beach. Two measured examples:

  Twin Rocks (Catanduanes)   13.9 km move, coasts on several sides       -> PASSES the gate
  Iron Bottom Sound          19.6 km move, spot sits in 654 m of water   -> PASSES the gate

Twin Rocks is equidistant from several coasts, so "nearest" is a coin flip; Iron Bottom Sound is a
WWII naval graveyard, not a surf break at all. Auto-snapping those would replace an OBVIOUSLY broken
coordinate with a PLAUSIBLE wrong one, which is strictly worse — a wrong spot that looks right never
gets reported.

So the population splits by how far the water actually is:

    too_few_windows          153 spots   median move 2.49 km   <- proposable
    no_shoreline (near)       86 spots   median move 3.89 km   <- marginal
    no_shoreline (>5 km)      63 spots   median move 8.94 km   <- NOT proposable

The thresholds below come from that measurement, not from taste.

WHAT THIS WRITES
----------------
`spot_placement_proposals.csv` — one row per placement-failure spot, with an ACTION:

  PROPOSE_COORD    move <= MAX_PROPOSE_KM, unambiguous, and the snapped point yields a
                   gate-passing shore normal. Proposed lat/lng included; review then apply.
  AMBIGUOUS        several coasts are equally near — "nearest" is arbitrary. Needs a human.
  TOO_FAR          the water is farther than geometry can justify guessing. Needs the break's
                   real location (a gazetteer or local knowledge), not a snap.
  IMPOSSIBLE_COORD the STORED COORDINATE is in deep open ocean or on high inland terrain, so no
                   break can be there. ⚠️ This does NOT mean the spot is fake: Lakey Peak (Sumbawa)
                   and Tuason Point (Siargao) are world-class breaks whose rows land 337 m up a
                   hillside and in 899 m of water respectively. The COORDINATE is wrong, not the
                   spot — do not delete these rows, relocate them.

★ READ-ONLY. This never writes to the database. Placement is a judgement call ("which named peak on
this beach?") and belongs in the spot editor; the point here is to shrink the manual pass and to say
honestly which spots a machine should not touch.

USAGE
    python scripts/propose_spot_placements.py                # all active spots
    python scripts/propose_spot_placements.py --limit 60     # quick sample
Env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (read-only).
"""
import argparse
import concurrent.futures as cf
import csv
import math
import os
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.weather_pipeline.shore_normal_fit import (  # noqa: E402
    MAX_SPREAD_DEG, fit_shore_normal, nearest_shoreline_km, shoreline_mask,
)
from scripts.build_shore_normals import fetch_spots, fetch_window  # noqa: E402

# A ±15 km window: wide enough to find the coast for a badly geocoded spot, so we can MEASURE how
# far off it is even when we then refuse to propose a move.
FETCH_HALF_DEG = 0.14
# Beyond this the "nearest coast" stops being an inference and becomes a guess (measured: the
# proposable band has a median move of 2.49 km; the refused band 8.94 km).
MAX_PROPOSE_KM = 3.0
# Fraction of comparably-near shoreline cells lying on the OPPOSITE side of the spot. Measured on
# synthetic terrain: straight coast 0.00, coastal corner/bay 0.21, isthmus 0.43. Above this the
# "nearest coast" is a coin flip and we refuse to propose.
MAX_OPPOSED_FRAC = 0.15
DEEP_WATER_M = -200.0     # no break sits in this; the row is probably not a surf spot
HIGH_GROUND_M = 200.0     # nor on a mountain
WORKERS = 5


def snap_target(elev, lats, lons, lat, lon):
    """Nearest shoreline cell, plus how ambiguous that choice is.

    Returns (slat, slon, km, opposed_frac) or None.

    `opposed_frac` is the fraction of comparably-near shoreline cells lying more than 90° away from
    the direction of the nearest one — i.e. how much coast sits on the OTHER side of the spot.
    0.0 means every candidate is the same shore and "nearest" is a safe inference; a large value
    means the spot is between two coasts and nearest is a coin flip (the Twin Rocks case).

    Deliberately NOT the circular concentration of the candidate bearings: on a long straight coast
    the candidates fan out ALONG the shore, which drags concentration down (a synthetic straight
    coast measures 0.85) even though the choice is completely unambiguous. Opposition is the thing
    that actually makes a snap arbitrary, so measure that and nothing else."""
    import numpy as np
    sh = np.argwhere(shoreline_mask(elev))
    if len(sh) == 0:
        return None
    d_north = (lats[sh[:, 0]] - lat) * 111320.0
    d_east = (lons[sh[:, 1]] - lon) * 111320.0 * math.cos(math.radians(lat))
    dist = np.hypot(d_north, d_east)
    k = int(np.argmin(dist))
    near = dist <= max(dist[k] * 1.5, dist[k] + 1000.0)
    brs = np.degrees(np.arctan2(d_east[near], d_north[near])) % 360.0
    b0 = math.degrees(math.atan2(float(d_east[k]), float(d_north[k]))) % 360.0
    delta = np.abs((brs - b0 + 180.0) % 360.0 - 180.0)
    opposed = float((delta > 90.0).mean())
    return float(lats[sh[k, 0]]), float(lons[sh[k, 1]]), float(dist[k] / 1000.0), opposed


def assess(spot):
    """Classify one spot. Never raises."""
    import numpy as np
    lat, lon = float(spot["latitude"]), float(spot["longitude"])
    out = {"id": spot.get("id"), "name": spot.get("name"), "region": spot.get("region"),
           "lat": lat, "lng": lon, "elev_m": None, "shoreline_km": None,
           "proposed_lat": None, "proposed_lng": None, "move_km": None,
           "opposed_frac": None, "new_normal_deg": None, "new_spread_deg": None,
           "action": "UNKNOWN", "note": ""}
    try:
        elev, lats, lons = fetch_window(lat, lon, FETCH_HALF_DEG)
    except Exception as e:
        out["action"] = "FETCH_FAILED"
        out["note"] = str(e)[:120]
        return out
    elev = np.where(np.isnan(elev), 0.0, elev)
    i = int(np.argmin(np.abs(lats - lat)))
    j = int(np.argmin(np.abs(lons - lon)))
    z = float(elev[i, j])
    out["elev_m"] = round(z, 1)
    out["shoreline_km"] = nearest_shoreline_km(elev, lats, lons, lat, lon)

    if z < DEEP_WATER_M or z > HIGH_GROUND_M:
        out["action"] = "IMPOSSIBLE_COORD"
        out["note"] = (("stored coordinate is in %.0f m of open water" % -z) if z < 0
                       else ("stored coordinate is on %.0f m of inland terrain" % z)
                       ) + " — relocate the row, do NOT delete it"
        return out

    snap = snap_target(elev, lats, lons, lat, lon)
    if snap is None:
        out["action"] = "TOO_FAR"
        out["note"] = "no coastline within ~15 km"
        return out
    slat, slon, km, opposed = snap
    out["move_km"] = round(km, 2)
    out["opposed_frac"] = round(opposed, 2)

    if km > MAX_PROPOSE_KM:
        out["action"] = "TOO_FAR"
        out["note"] = f"water is {km:.1f} km away — needs the break's real location, not a snap"
        return out
    if opposed > MAX_OPPOSED_FRAC:
        out["action"] = "AMBIGUOUS"
        out["note"] = (f"{opposed:.0%} of nearby coast is on the opposite side — "
                       f"'nearest' is arbitrary here")
        return out

    bearing, spread, nw = fit_shore_normal(elev, lats, lons, slat, slon)
    out["new_normal_deg"] = None if bearing is None else round(bearing, 1)
    out["new_spread_deg"] = None if spread is None else round(spread, 1)
    if spread is None or nw < 3 or spread > MAX_SPREAD_DEG:
        out["action"] = "AMBIGUOUS"
        out["note"] = "snapped point still has no well-defined shore normal"
        return out
    out["proposed_lat"] = round(slat, 5)
    out["proposed_lng"] = round(slon, 5)
    out["action"] = "PROPOSE_COORD"
    out["note"] = f"move {km:.2f} km; shore normal {bearing:.0f}° (spread {spread:.0f}°)"
    return out


def needs_review(row):
    """The placement-failure population: no usable shoreline geometry at the stored coordinate."""
    return (row.get("shoreline_km") is None or row["shoreline_km"] > 1.5)


def main():
    ap = argparse.ArgumentParser(description="Triage misplaced surf spots (read-only)")
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--out", type=str, default="spot_placement_proposals.csv")
    ap.add_argument("--spots-csv", type=str, default=None,
                    help="offline input: any CSV with id,name,region,lat,lng columns "
                         "(e.g. the shore-normal build review). Skips Supabase.")
    args = ap.parse_args()

    if args.spots_csv:
        spots = []
        with open(args.spots_csv, encoding="utf-8") as fh:
            for r in csv.DictReader(fh):
                try:
                    spots.append({"id": r.get("id"), "name": r.get("name"),
                                  "region": r.get("region"),
                                  "latitude": float(r["lat"]), "longitude": float(r["lng"])})
                except (KeyError, TypeError, ValueError):
                    continue
        if args.limit:
            spots = spots[:args.limit]
    else:
        base = os.environ.get("SUPABASE_URL", "").rstrip("/")
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY", "")
        if not base or not key:
            print("ERROR: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required (read-only), "
                  "or pass --spots-csv.")
            return 2
        spots = fetch_spots(base, key, args.limit)
    print(f"Assessing {len(spots)} spots against ETOPO 2022 15s "
          f"(propose only when move <= {MAX_PROPOSE_KM} km and opposed_frac <= "
          f"{MAX_OPPOSED_FRAC})…")

    rows = []
    with cf.ThreadPoolExecutor(max_workers=WORKERS) as ex:
        for i, r in enumerate(ex.map(assess, spots)):
            rows.append(r)
            if (i + 1) % 100 == 0:
                print(f"  {i + 1}/{len(spots)}")

    review = [r for r in rows if needs_review(r)]
    counts = Counter(r["action"] for r in review)
    print(f"\n{len(review)} spots need placement review (of {len(rows)} assessed)")
    for k in ("PROPOSE_COORD", "AMBIGUOUS", "TOO_FAR", "IMPOSSIBLE_COORD", "FETCH_FAILED",
              "UNKNOWN"):
        if counts.get(k):
            print(f"  {k:<16} {counts[k]:>5}")
    print(f"\n  -> {counts.get('PROPOSE_COORD', 0)} have a defensible proposed coordinate; "
          f"the rest are flagged for a human, which is the honest answer for them.")

    with open(args.out, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["action", "id", "name", "region", "current_lat", "current_lng",
                    "proposed_lat", "proposed_lng", "move_km", "opposed_frac",
                    "new_normal_deg", "new_spread_deg", "elev_m", "shoreline_km", "note"])
        order = {"PROPOSE_COORD": 0, "AMBIGUOUS": 1, "TOO_FAR": 2, "IMPOSSIBLE_COORD": 3}
        for r in sorted(review, key=lambda r: (order.get(r["action"], 9), -(r["move_km"] or 0))):
            w.writerow([r["action"], r["id"], r["name"], r["region"], r["lat"], r["lng"],
                        r["proposed_lat"], r["proposed_lng"], r["move_km"], r["opposed_frac"],
                        r["new_normal_deg"], r["new_spread_deg"], r["elev_m"],
                        None if r["shoreline_km"] is None else round(r["shoreline_km"], 2),
                        r["note"]])
    print(f"\nWrote {args.out} (proposals first). NOTHING was written to the database.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
