# -*- coding: utf-8 -*-
"""RV-12 -- PRICE THE 0.25 deg TILE-COVERAGE EXPANSION.

RV-11 measured the benefit side on the accuracy axis for the first time: the served lane runs at
MAE 0.30-0.32 on coarse global coverage and 0.177 where a regional tile exists. This prices the
other side: WHICH spots are uncovered, WHERE they cluster, and what a region costs.

⭐ THE COST STRUCTURE CHANGED IN 2026-07-31 AND THAT IS THE WHOLE POINT. Before multi-bbox, ingest
cost was proportional to forecast-hours x REGIONS -- each region did its own download pass (run
29265599972: 48.5 min = 4 regions x ~11.5 min, and a 672-pt bbox took the same time as a 5760-pt
one, the tell that the bbox never reached the wire). Multi-bbox removed the x REGIONS term: ONE
pass per horizon group now covers every region, and the marine download fell 276 -> 138 steps.
So adding a region is nearly free on download. What it still costs is products-per-fire and,
critically, CADENCE.

Demand is computed offline from the production spot catalogue -- no API load.
ASCII stdout only (cp1252).
"""
import json
import math
import os
import sys
from collections import defaultdict

#
# ⛔⛔ CORRECTION -- MY FIRST RUN USED ONLY `WORLDWIDE_COASTAL_REGIONS` AND WAS WRONG.
# There are TWO tile sets, on TWO cadences:
#   REGIONAL_CONFIGS (2)          -- florida_east_coast, us_west_coast_socal. The CORE lane. Every
#                                    fire, not rotating.
#   WORLDWIDE_COASTAL_REGIONS(12) -- rotating, 3 per fire, 32 h per region.
# Using only the second reported 52.7% uncovered and ranked Florida (124 spots) and California
# (78) as the top two gaps -- both of which are ALREADY COVERED, by the core lane. The first row
# of my own price table was re-proposing regions that exist.
# ⭐ Third time this session that "grep for an existing one before proposing a new one" would have
# caught an error. Both sets are now used, and the cadence difference is carried through.
#
sys.path.insert(0, r"C:\Users\dprit\Raw-Surf\backend")
from services.weather_pipeline.pilot_regions import (            # noqa: E402
    WORLDWIDE_COASTAL_REGIONS as W, REGIONAL_CONFIGS as CORE,
)

SPOTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir,
                     "runtime-verification", "RV-12_spot_catalogue_20260812.json")
PER_CYCLE = 3
FIRES_PER_DAY = 3
ALL = {**{("core:" + k): v for k, v in CORE.items()},
       **{("ww:" + k): v for k, v in W.items()}}


def inside(lat, lng, r):
    return r["west"] <= lng <= r["east"] and r["south"] <= lat <= r["north"]


def main():
    d = json.load(open(SPOTS, encoding="utf-8"))
    spots = [s for s in (d if isinstance(d, list) else d.get("spots", []))
             if isinstance(s.get("latitude"), (int, float))
             and isinstance(s.get("longitude"), (int, float))]

    covered, uncovered = [], []
    per_region = defaultdict(int)
    for s in spots:
        hit = next((k for k, r in ALL.items() if inside(s["latitude"], s["longitude"], r)), None)
        if hit:
            per_region[hit] += 1
            covered.append(s)
        else:
            uncovered.append(s)

    print("=" * 98)
    print("RV-12  TILE-COVERAGE PRICING")
    print("=" * 98)
    print("catalogue: %d spots with coordinates | %d regions, %d per fire, %d fires/day"
          % (len(spots), len(ALL), PER_CYCLE, FIRES_PER_DAY))
    print()
    print("COVERED   %5d spots (%.1f%%)" % (len(covered), 100 * len(covered) / len(spots)))
    print("UNCOVERED %5d spots (%.1f%%)  <- served from the coarse global grid"
          % (len(uncovered), 100 * len(uncovered) / len(spots)))

    print("\n--- demand actually served by each existing region ---")
    print("  %-28s %7s %9s %9s %12s" % ("region", "spots", "deg^2", "cells", "spots/1k cells"))
    for k, r in sorted(ALL.items(), key=lambda kv: -per_region[kv[0]]):
        a = abs(r["east"] - r["west"]) * abs(r["north"] - r["south"])
        c = a / (r.get("resolution", 0.25) ** 2)
        print("  %-28s %7d %9.1f %9.0f %12.1f"
              % (k, per_region[k], a, c, 1000 * per_region[k] / c if c else 0))

    # ---- where the uncovered demand clusters: 5-degree bins ----
    bins = defaultdict(list)
    for s in uncovered:
        bins[(int(math.floor(s["latitude"] / 5) * 5), int(math.floor(s["longitude"] / 5) * 5))].append(s)
    ranked = sorted(bins.items(), key=lambda kv: -len(kv[1]))

    print("\n--- WHERE THE UNCOVERED DEMAND IS (5deg x 5deg bins, top 15) ---")
    print("  %-18s %7s %9s %-28s %s" % ("bin (S,W)", "spots", "cells", "example spot", "country/region"))
    cum = 0
    for (la, lo), items in ranked[:15]:
        cum += len(items)
        ex = items[0]
        print("  %-18s %7d %9d %-28s %s"
              % ("%+d,%+d" % (la, lo), len(items), int(25 / 0.0625), (ex.get("name") or "")[:28],
                 (ex.get("state_province") or ex.get("country") or ex.get("region") or "")[:22]))
    print("  ---> top 15 bins hold %d of %d uncovered spots (%.1f%%)"
          % (cum, len(uncovered), 100 * cum / len(uncovered)))

    # ---- what closing the top-N bins would cost ----
    print("\n" + "=" * 98)
    print("THE PRICE: closing the top-N uncovered bins as new 5deg regions")
    print("=" * 98)
    cells_per_bin = 25 / (0.25 ** 2)
    existing_cells = sum(abs(r["east"] - r["west"]) * abs(r["north"] - r["south"])
                         / (r.get("resolution", 0.25) ** 2) for r in W.values())
    print("  existing estate: %d core (every fire) + %d worldwide (3/fire, 32 h), %.0f cells total"
          % (len(CORE), len(W), existing_cells))
    print()
    print("  %5s %8s %10s %9s %11s %9s %s"
          % ("new", "spots", "cum cover", "cells", "regions", "per_cycle", "cadence h"))
    print("  %5s %8s %10s %9s %11s %9s %s"
          % ("new", "closed", "of all", "added", "total", "needed", "(<=32 required)"))
    for n in (3, 5, 8, 10, 15):
        got = sum(len(v) for _, v in ranked[:n])
        tot_regions = len(W) + n
        need = math.ceil(tot_regions / 4)          # <=4 fires to cover, 8 h apart
        cadence = math.ceil(tot_regions / need) * 8
        print("  %5d %8d %9.1f%% %9.0f %11d %9d %d"
              % (n, got, 100 * (len(covered) + got) / len(spots), n * cells_per_bin,
                 tot_regions, need, cadence))
    return 0


if __name__ == "__main__":
    sys.exit(main())
