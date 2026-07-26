#!/usr/bin/env python3
"""
build_shore_normals.py — derive a per-spot shore normal from NOAA ETOPO 2022 15s.

WHY
---
`bathymetry.shore_normal_at()` decides which way a beach faces from a 7×7 window on the bundled
0.25° grid — **194.6 km across**. Measured against production 2026-07-26: Pipeline and Sunset both
return 0.0° on a coast that faces ~325-335°; Uluwatu returns 162.5° (the wrong side of the
peninsula). Across 8 test spots the mean angular change from this fix is 70.7°, and the rating cost
is ~0.39 points per degree — mean |score| change 27.6 points, max 70.5.

ETOPO 2022 15s is ~463 m (60× finer) and CC0 public domain — no attribution, no share-alike.

WHAT THIS WRITES
----------------
  services/weather_pipeline/data/shore_normals.json   the runtime asset (gated, see below)
  shore_normal_build_review.csv                       every spot, for the placement review

★ CONFIDENCE GATE. Each spot is fitted at five window sizes (~1.1 km to ~5.0 km). The maximum
pairwise disagreement is the estimator's self-measured confidence, and a spot only enters the asset
when it lands under `MAX_SPREAD_DEG`. Validated: every low-spread spot beat production outright,
while both high-spread spots (Uluwatu 48.1°, Steamer Lane 39.8°) sit where a coastline genuinely
bends and NO single bearing is right. Above the gate we emit nothing and the caller keeps the coarse
value — we do not trade one wrong answer for another. See `shore_normal_fit` for the full table.

The CSV is the by-product that also answers the placement question: `shoreline_km` is the distance
from the spot to the nearest shoreline cell, which is a far more actionable signal than a bare
elevation sample (a spot geocoded to a town centre reads kilometres out).

USAGE
    python scripts/build_shore_normals.py                    # all active spots, from Supabase
    python scripts/build_shore_normals.py --limit 40         # quick sample
    python scripts/build_shore_normals.py --spots-file f.csv # offline: "lat,lng" per line

Env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (read-only; no write grant needed).
"""
import argparse
import concurrent.futures as cf
import csv
import io
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.weather_pipeline.shore_normal_fit import (  # noqa: E402
    MAX_SPREAD_DEG, WINDOW_HALF_DEGS, fit_shore_normal, fronting_water_depth_m,
    nearest_shoreline_km,
)

ERDDAP = "https://coastwatch.pfeg.noaa.gov/erddap/griddap/ETOPO_2022_v1_15s.csv"
FETCH_HALF_DEG = max(WINDOW_HALF_DEGS)      # one fetch per spot; every window is cropped from it
PAGE = 1000                                  # PostgREST silently caps at 1000 AND still returns 200
WORKERS = 6                                  # polite to NOAA; ~1516 spots lands in a few minutes
RETRIES = 3
OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                       "services", "weather_pipeline", "data")
ASSET = os.path.join(OUT_DIR, "shore_normals.json")
# A spot whose nearest shoreline is farther than this is misplaced, not just imprecise — its window
# describes some other piece of coast, so a bearing from it would be confidently wrong.
MAX_SHORELINE_KM = 3.0


def fetch_spots(base, key, limit=None):
    """Paginated. PostgREST silently caps at 1000 rows and still returns 200 — it dropped 516 of
    1516 spots undetected on 2026-07-26. Always paginate; verify against a direct count."""
    import requests
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    out, offset = [], 0
    while True:
        url = (f"{base}/rest/v1/surf_spots?select=id,name,region,latitude,longitude"
               f"&is_active=eq.true&latitude=not.is.null&longitude=not.is.null"
               f"&order=id&limit={PAGE}&offset={offset}")
        r = requests.get(url, headers=headers, timeout=60)
        r.raise_for_status()
        batch = r.json()
        out.extend(batch)
        if limit and len(out) >= limit:
            return out[:limit]
        if len(batch) < PAGE:
            return out
        offset += PAGE


def fetch_window(lat, lon, half=FETCH_HALF_DEG):
    """One ETOPO 2022 15s box around a spot -> (elev, lats, lons) with BOTH axes ascending."""
    import numpy as np
    import requests
    q = (f"?z%5B({lat - half:.6f}):1:({lat + half:.6f})%5D"
         f"%5B({lon - half:.6f}):1:({lon + half:.6f})%5D")
    last = None
    for attempt in range(RETRIES):
        try:
            r = requests.get(ERDDAP + q, timeout=90)
            if r.status_code == 200 and r.text:
                break
            last = f"HTTP {r.status_code}"
        except Exception as e:                      # network flake -> back off and retry
            last = str(e)
        time.sleep(1.5 * (attempt + 1))
    else:
        raise RuntimeError(last or "erddap failed")

    pts = []
    for row in list(csv.reader(io.StringIO(r.text)))[2:]:   # [0]=names, [1]=units
        if len(row) < 3:
            continue
        try:
            pts.append((float(row[0]), float(row[1]), float(row[2])))
        except ValueError:
            continue
    if not pts:
        raise RuntimeError("no points")
    lats = sorted({p[0] for p in pts})
    lons = sorted({p[1] for p in pts})
    li = {v: i for i, v in enumerate(lats)}
    lj = {v: j for j, v in enumerate(lons)}
    elev = np.full((len(lats), len(lons)), np.nan)
    for la, lo, z in pts:
        elev[li[la], lj[lo]] = z
    return elev, np.array(lats), np.array(lons)


def measure(spot):
    """Fit one spot. Never raises — a failed spot is reported, not fatal."""
    import numpy as np
    lat, lon = float(spot["latitude"]), float(spot["longitude"])
    out = {"id": spot.get("id"), "name": spot.get("name"), "region": spot.get("region"),
           "lat": lat, "lng": lon, "normal": None, "spread": None, "n_windows": 0,
           "shoreline_km": None, "elev_m": None, "front_depth_m": None, "status": "ok"}
    try:
        elev, lats, lons = fetch_window(lat, lon)
    except Exception as e:
        out["status"] = f"fetch_failed: {e}"
        return out
    elev = np.where(np.isnan(elev), 0.0, elev)
    try:
        i = int(np.argmin(np.abs(lats - lat)))
        j = int(np.argmin(np.abs(lons - lon)))
        out["elev_m"] = round(float(elev[i, j]), 1)
        out["shoreline_km"] = nearest_shoreline_km(elev, lats, lons, lat, lon)
        out["front_depth_m"] = fronting_water_depth_m(elev, lats, lons, lat, lon)
        bearing, spread, n = fit_shore_normal(elev, lats, lons, lat, lon)
        out["normal"] = None if bearing is None else round(bearing, 1)
        out["spread"] = None if spread is None else round(spread, 1)
        out["n_windows"] = n
    except Exception as e:
        out["status"] = f"fit_failed: {e}"
    return out


def accepted(row):
    """The gate. Every clause is a measured failure mode, not a precaution."""
    if row["normal"] is None or row["spread"] is None:
        return False, "no_shoreline_in_window"
    if row["n_windows"] < 3:
        return False, "too_few_windows"
    if row["spread"] > MAX_SPREAD_DEG:
        return False, "ambiguous_coastline"
    if row["shoreline_km"] is not None and row["shoreline_km"] > MAX_SHORELINE_KM:
        return False, "spot_misplaced"
    return True, "accepted"


def main():
    ap = argparse.ArgumentParser(description="Derive per-spot shore normals from ETOPO 2022 15s")
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--spots-file", type=str, default=None,
                    help="offline input: 'lat,lng' per line (skips Supabase)")
    ap.add_argument("--out-csv", type=str, default="shore_normal_build_review.csv")
    ap.add_argument("--asset", type=str, default=ASSET)
    args = ap.parse_args()

    if args.spots_file:
        spots = []
        with open(args.spots_file) as fh:
            for n, line in enumerate(fh):
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                la, lo = line.split(",")[:2]
                spots.append({"id": f"file:{n}", "name": None, "region": None,
                              "latitude": float(la), "longitude": float(lo)})
        if args.limit:
            spots = spots[:args.limit]
    else:
        base = os.environ.get("SUPABASE_URL", "").rstrip("/")
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY", "")
        if not base or not key:
            print("ERROR: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required (read-only).")
            return 2
        spots = fetch_spots(base, key, args.limit)
        if not args.limit and len(spots) % PAGE == 0:
            print(f"  ⚠ spot count is an exact multiple of {PAGE} — verify against a direct count.")

    print(f"Fitting {len(spots)} spots against ETOPO 2022 15s (~463 m), "
          f"windows {[round(h * 111.32, 1) for h in WINDOW_HALF_DEGS]} km half-width…")
    rows = []
    with cf.ThreadPoolExecutor(max_workers=WORKERS) as ex:
        for i, row in enumerate(ex.map(measure, spots)):
            rows.append(row)
            if (i + 1) % 100 == 0:
                print(f"  {i + 1}/{len(spots)}")

    entries, reasons = [], {}
    for row in rows:
        ok, why = accepted(row)
        row["verdict"] = why
        reasons[why] = reasons.get(why, 0) + 1
        if ok:
            entries.append([round(row["lat"], 5), round(row["lng"], 5),
                            row["normal"], row["spread"]])

    n_fetch_fail = sum(1 for r in rows if r["status"].startswith("fetch_failed"))
    print(f"\nVERDICTS ({len(rows)} spots)")
    for k, v in sorted(reasons.items(), key=lambda kv: -kv[1]):
        print(f"  {k:<26} {v:>5}  ({100 * v / max(len(rows), 1):5.1f}%)")
    if n_fetch_fail:
        print(f"  ⚠ {n_fetch_fail} spots failed to fetch — rerun to fill them in.")

    asset = {
        "source": "NOAA ETOPO 2022 v1 15s via ERDDAP (CC0 public domain, ~463 m)",
        "method": ("coast-PCA fitted at 5 window sizes, circular mean; gated on the maximum "
                   "pairwise spread across windows (the estimator's self-measured confidence)"),
        "max_spread_deg": MAX_SPREAD_DEG,
        "max_shoreline_km": MAX_SHORELINE_KM,
        "windows_half_deg": list(WINDOW_HALF_DEGS),
        "spots_considered": len(rows),
        "count": len(entries),
        "entries": entries,
    }
    os.makedirs(os.path.dirname(args.asset), exist_ok=True)
    with open(args.asset, "w") as fh:
        json.dump(asset, fh, separators=(",", ":"))
    print(f"\nAsset: {len(entries)}/{len(rows)} spots -> {args.asset} "
          f"({os.path.getsize(args.asset) / 1024:.0f} KB)")

    with open(args.out_csv, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["id", "name", "region", "lat", "lng", "normal_deg", "spread_deg",
                    "n_windows", "shoreline_km", "elev_m", "front_depth_m", "verdict", "status"])
        for r in sorted(rows, key=lambda r: -(r["shoreline_km"] or 0)):
            w.writerow([r["id"], r["name"], r["region"], r["lat"], r["lng"], r["normal"],
                        r["spread"], r["n_windows"], r["shoreline_km"], r["elev_m"],
                        r["front_depth_m"], r["verdict"], r["status"]])
    print(f"Review CSV (worst placement first): {args.out_csv}")

    misplaced = [r for r in rows if (r["shoreline_km"] or 0) > MAX_SHORELINE_KM]
    if misplaced:
        print(f"\nWORST 15 PLACEMENTS of {len(misplaced)} beyond {MAX_SHORELINE_KM} km:")
        for r in sorted(misplaced, key=lambda r: -(r["shoreline_km"] or 0))[:15]:
            print(f"  {(r['name'] or '?')[:34]:<34} {(r['region'] or '-')[:16]:<16} "
                  f"{r['shoreline_km']:7.2f} km from shore, z={r['elev_m']:+8.1f} m")
    return 0


if __name__ == "__main__":
    sys.exit(main())
