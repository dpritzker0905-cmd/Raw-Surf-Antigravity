"""Offline validation of a built location_time grid against its OWN inputs (OSM land + timezone-boundary-builder).

Re-runs, on the OSM-based grid, the checks the GLOBE-mask study made (those results do NOT qualify this grid):
  1. reference parity: grid lookup vs timezonefinder at the click point, on seeded samples (land/territorial only,
     because the grid deliberately differs at sea where C' snaps);
  2. policy check at click points: for clicks the reference calls nautical, the expected C' answer computed directly at
     the CLICK (densified-boundary haversine to OSM land, zone at the nearest land point) vs the grid's cell answer;
     disagreements are split into "within the cell-quantisation band of 50 km" and the rest;
  3. named edge places: dateline, small isolated islands, straits, poles.
Prints a JSON report. Build-only dependencies as in build_location_tz_grid.py. Never imported by the server.

Usage: python scripts/validate_location_tz_grid.py --grid-dir data/location_time --osm-dir <land_polygons dir> --spots <cells>
"""
import argparse
import json
import math
import os
import random
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from scripts.build_location_tz_grid import SNAP_KM, exact_nearest, civil_zone_at_coast, load_osm  # noqa: E402
from services.weather_pipeline import location_time as lt  # noqa: E402

EDGES = {
    "Taveuni, Fiji (+179.9)": (-16.85, 179.95), "Rabi, Fiji (-179.97)": (-16.45, -179.97),
    "Kiritimati (+14)": (1.87, -157.40), "Apia": (-13.83, -171.76), "Pago Pago": (-14.28, -170.70),
    "Samoa channel": (-14.05, -171.20), "Big Diomede": (65.78, -169.06), "Little Diomede": (65.75, -168.93),
    "Pitcairn": (-25.07, -130.10), "Clipperton (FR)": (10.30, -109.22), "Midway": (28.21, -177.38),
    "St Helena": (-15.96, -5.71), "Tristan da Cunha": (-37.11, -12.28), "Lord Howe": (-31.55, 159.08),
    "Chatham": (-43.95, -176.55), "Gibraltar": (36.14, -5.35), "Strait of Gibraltar mid": (35.97, -5.60),
    "Tangier": (35.78, -5.81), "Gold Coast QLD/NSW offshore": (-28.17, 153.70), "North Pole": (89.999, 0.0),
    "South Pole": (-89.999, 0.0), "Mid-Pacific": (0.0, -150.0),
}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--grid-dir", required=True)
    ap.add_argument("--osm-dir", required=True)
    ap.add_argument("--spots", required=True, help="semicolon-separated lat,lng spot cells (the 1,731-cell catalogue)")
    ap.add_argument("--out")
    args = ap.parse_args(argv)
    import shapely
    from timezonefinder import TimezoneFinder
    tf = TimezoneFinder()
    lt.reset_for_tests()
    look = lambda a, b: lt.lookup(a, b, args.grid_dir)  # noqa: E731
    civil = lambda z: bool(z) and not z.startswith("Etc/")  # noqa: E731
    spots = [tuple(map(float, c.split(","))) for c in open(args.spots).read().strip().split(";")]
    rng = random.Random(7)
    clicks = [(la + rng.uniform(-.4, .4), lo + rng.uniform(-.4, .4)) for la, lo in spots for _ in range(12)]
    r2 = random.Random(13)
    uniform = [(math.degrees(math.asin(r2.uniform(-1, 1))), r2.uniform(-180, 180)) for _ in range(100_000)]
    report = {"grid_manifest": json.load(open(os.path.join(args.grid_dir, "manifest.json"), encoding="utf-8"))}

    # 1. reference parity where the reference is civil (land + territorial waters)
    for name, pts in (("near_spot_clicks_seed7", clicks), ("uniform_sphere_seed13", uniform)):
        ref = [(a, b, tf.timezone_at(lat=a, lng=b)) for a, b in pts]
        civ = [(a, b, z) for a, b, z in ref if civil(z)]
        bad = sum(1 for a, b, z in civ if look(a, b)["iana"] != z)
        report[f"parity_civil_{name}"] = {"n": len(civ), "zone_differs": bad, "pct": round(100 * bad / max(1, len(civ)), 3)}

    # 2. C' policy at the CLICK for reference-nautical clicks
    osm = load_osm(args.osm_dir, lambda m: print(m, file=sys.stderr))
    tree = shapely.STRtree(osm)
    naut = [(a, b) for a, b in clicks if not civil(tf.timezone_at(lat=a, lng=b))]
    rows = []
    for a, b in naut:
        d, nl, no = exact_nearest(a, b, osm, tree)
        want = civil_zone_at_coast(tf, a, b, nl, no) if d is not None and d <= SNAP_KM else tf.timezone_at(lat=a, lng=b)
        got = look(a, b)
        rows.append({"lat": a, "lng": b, "coast_km": None if d is None else round(d, 3), "want": want, "got": got["iana"],
                     "source": got["source"], "near_border": got["near_border"]})
    differ = [r for r in rows if r["want"] != r["got"]]
    cell_km = 0.01 * 111.19 * math.sqrt(2) / 2                       # half the cell diagonal, at the equator
    in_band = [r for r in differ if r["coast_km"] is not None and abs(r["coast_km"] - SNAP_KM) <= cell_km]
    border = [r for r in differ if r not in in_band and r["near_border"]]
    report["policy_at_click_nautical"] = {
        "n": len(rows), "snapped_expected": sum(1 for r in rows if r["coast_km"] is not None and r["coast_km"] <= SNAP_KM),
        "grid_differs": len(differ), "of_which_within_cell_of_50km": len(in_band), "of_which_flagged_near_border": len(border),
        "unexplained": [r for r in differ if r not in in_band and r not in border][:25],
        "threshold_band_45_55_km": sum(1 for r in rows if r["coast_km"] is not None and 45 <= r["coast_km"] <= 55),
        "cell_quantisation_km": round(cell_km, 3)}
    report["near_border_clicks"] = sum(1 for a, b in clicks if look(a, b)["near_border"])

    # 3. named edges
    report["edges"] = {k: {"ref": tf.timezone_at(lat=a, lng=b), **{x: look(a, b)[x] for x in ("iana", "source", "near_border",
                                                                                              "alt_iana", "coast_km_band")}}
                       for k, (a, b) in EDGES.items()}
    text = json.dumps(report, indent=1, default=str)
    if args.out:
        open(args.out, "w", encoding="utf-8").write(text)
    print(text)


if __name__ == "__main__":
    main()
