#!/usr/bin/env python3
"""
filter_spot_candidates.py — turn open coastal LOCATIONS into reviewable SURF-SPOT candidates.

`spot_sources.py` pulls locations governments publish (EEA bathing waters CC-BY 4.0, GNIS public
domain, NGA GNS unrestricted). Most are not surf spots. This applies our own physics to say which
plausibly are, and writes the evidence for every decision so a human can audit it.

TWO STAGES, CHEAPEST FIRST — this ordering is the whole point
  1. OFFLINE, free, no network: basin-scale open-water FETCH from the bundled global 0.25° ETOPO
     grid. Discards sheltered estuaries, inner bays and enclosed seas before a single round-trip.
  2. ONLINE, ~1 ERDDAP fetch per survivor: ocean access + shore-normal fit at 463 m.

Stage 1 typically removes most of the pool. Running stage 2 first is how the 2026-07-27 GNIS pilot
spent an hour producing a number that three cheap checks would have invalidated in seconds.

⚠️ FETCH DOES NOT CLEANLY SEPARATE THE MEDITERRANEAN, and the run says so rather than pretending.
Measured against real coasts:

    Atlantic surf   Bundoran 264 · Zarautz 297 · Hossegor 302 · Mundaka 363 · Nazaré 494 · Ericeira 584
    swell-starved   Copenhagen 64 · Thessaloniki 91 · Venice 152 · Rimini 163 · Athens 211 · NAPLES 344

Naples (344 km, Tyrrhenian) sits above Bundoran (264 km, Donegal Bay). One threshold cannot hold
both, because fetch measures geometry and the Mediterranean's real deficit is STORM CLIMATE, not
distance. Scope runs to swell-exposed coasts, or wait for the gridded size climatology
(`grid_size_climatology.py`, live in L2) which measures observed breaking heights directly.

READ-ONLY. Writes a CSV for review; nothing goes near the database.

USAGE
    python scripts/filter_spot_candidates.py --in eu.csv --catalog ours.csv --out reviewed.csv
    python scripts/filter_spot_candidates.py --in eu.csv --offline-only      # stage 1 only
"""
import argparse
import concurrent.futures as cf
import csv
import math
import os
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.weather_pipeline.bathymetry import shore_normal_at  # noqa: E402
from services.weather_pipeline.swell_fetch import open_fetch_km  # noqa: E402

MIN_FETCH_KM = 200.0     # below Bundoran's 264 km, well above Athens/Rimini/Venice
KNOWN_KM = 2.0
DEDUPE_KM = 0.8
WORKERS = 6

OUT_COLS = ["decision", "confidence", "name", "country", "lat", "lng", "fetch_km", "ocean_km",
            "ocean_verdict", "shore_normal_deg", "spread_deg", "elev_m", "break_depth_m",
            "osm_surf_km", "nearest_ours", "nearest_ours_km", "source", "source_id", "licence",
            "attribution", "note"]


def confidence(r):
    """0-100, so the reviewer works the best rows first instead of reading 4,500 alphabetically.

    Built only from signals we measure ourselves. Deliberately NOT from OSM: its 536 named
    `sport=surfing` features include German river waves (Eisbachwelle, Almwelle, blackforestwave)
    and surf clubs, so a nearby OSM feature is a weak positive hint and never a gate. It is
    reported in `osm_surf_km` for the reviewer to weigh, not folded into the score."""
    score = 0.0
    f = r.get("fetch_km")
    if f:                                   # open-ocean exposure, 0-40
        score += 40.0 * min(float(f) / 500.0, 1.0)
    ok = r.get("ocean_km")
    if ok is not None and ok != "":         # sitting ON the water, 0-30
        score += 30.0 * max(0.0, 1.0 - float(ok) / 3.0)
    sp = r.get("spread_deg")
    if sp is not None and sp != "":         # a confident coastal aspect, 0-20
        score += 20.0 * max(0.0, 1.0 - float(sp) / 40.0)
    bd = r.get("break_depth_m")
    if bd is not None and bd != "":         # a plausible surf-zone depth, 0-10
        score += 10.0 if 1.0 <= float(bd) <= 30.0 else 0.0
    return round(score, 1)


def annotate_osm(rows, osm_csv):
    """Distance to the nearest OSM `sport=surfing` feature — a hint, never a filter."""
    try:
        osm = read_csv(osm_csv)
    except Exception:
        return
    pts = []
    for o in osm:
        try:
            pts.append((float(o["lat"]), float(o["lng"])))
        except (TypeError, ValueError, KeyError):
            continue
    for r in rows:
        la, lo = r.get("lat"), r.get("lng")
        if la is None:
            continue
        near = [haversine_km(la, lo, a, b) for a, b in pts
                if abs(a - la) < 0.2 and abs(b - lo) < 0.25]
        r["osm_surf_km"] = round(min(near), 2) if near else None


def haversine_km(lat1, lng1, lat2, lng2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371.0 * math.asin(math.sqrt(a))


def read_csv(path):
    with open(path, encoding="utf-8", errors="replace") as fh:
        return list(csv.DictReader(fh))


def stage1_offline(rows, min_fetch):
    """Basin-scale fetch. Free, offline, and it does most of the work."""
    out = []
    for r in rows:
        try:
            la, lo = float(r["lat"]), float(r["lng"])
        except (TypeError, ValueError):
            continue
        sn = None
        try:
            sn = shore_normal_at(la, lo)
        except Exception:
            pass
        f = open_fetch_km(la, lo, sn)
        r = dict(r, lat=la, lng=lo, coarse_normal=sn,
                 fetch_km=None if f is None else round(f, 1))
        if f is None:
            r["decision"], r["note"] = "REJECT_NO_GEOMETRY", "no coarse shore normal"
        elif f < min_fetch:
            r["decision"] = "REJECT_SHELTERED"
            r["note"] = f"open-water fetch {f:.0f} km < {min_fetch:.0f} km"
        else:
            r["decision"], r["note"] = "PASS_FETCH", ""
        out.append(r)
    return out


def stage2_online(row):
    """One ETOPO window: is it on open sea, and does the coast have a confident aspect?"""
    import numpy as np
    from scripts.build_shore_normals import FETCH_HALF_DEG, fetch_window
    from services.weather_pipeline.ocean_access import placement_verdict
    from services.weather_pipeline.shore_normal_fit import (
        MAX_SPREAD_DEG, fit_shore_normal, nearshore_depth_m)
    la, lo = row["lat"], row["lng"]
    try:
        elev, lats, lons = fetch_window(la, lo, FETCH_HALF_DEG)
        elev = np.where(np.isnan(elev), 0.0, elev)
    except Exception as e:
        return dict(row, decision="FETCH_FAILED", note=str(e)[:80])

    v = placement_verdict(elev, lats, lons, la, lo)
    row = dict(row, ocean_km=v["ocean_km"], ocean_verdict=v["verdict"], elev_m=v["elev_m"])
    if v["verdict"] != "ON_OCEAN":
        return dict(row, decision="REJECT_NOT_ON_OCEAN",
                    note=f"nearest open sea {v['ocean_km']} km")

    b, s, n = fit_shore_normal(elev, lats, lons, la, lo)
    row["shore_normal_deg"] = None if b is None else round(b, 1)
    row["spread_deg"] = None if s is None else round(s, 1)
    if s is None or n < 3 or s > MAX_SPREAD_DEG:
        return dict(row, decision="REJECT_NO_GEOMETRY",
                    note="coast has no confident aspect here")
    bd = nearshore_depth_m(elev, lats, lons, la, lo)
    row["break_depth_m"] = None if bd is None else round(bd, 1)
    return dict(row, decision="CANDIDATE", note=f"faces {b:.0f} deg (spread {s:.0f})")


def main():
    ap = argparse.ArgumentParser(description="Filter open coastal locations to surf candidates")
    ap.add_argument("--in", dest="inp", required=True)
    ap.add_argument("--catalog", default=None, help="our spots, to mark KNOWN vs NEW")
    ap.add_argument("--out", default="spot_candidates_reviewed.csv")
    ap.add_argument("--min-fetch", type=float, default=MIN_FETCH_KM)
    ap.add_argument("--offline-only", action="store_true")
    ap.add_argument("--osm", default=None,
                    help="CSV of OSM sport=surfing features (name,lat,lng) — reported as a hint "
                         "in osm_surf_km, never used as a gate")
    ap.add_argument("--limit", type=int, default=None)
    args = ap.parse_args()

    rows = read_csv(args.inp)
    print(f"input locations: {len(rows)}")

    rows = stage1_offline(rows, args.min_fetch)
    for k, v in Counter(r["decision"] for r in rows).most_common():
        print(f"  stage1 {k:<22}{v:>6}")
    passed = [r for r in rows if r["decision"] == "PASS_FETCH"]
    rejected = [r for r in rows if r["decision"] != "PASS_FETCH"]
    print(f"  -> {len(passed)} survive the offline fetch filter "
          f"({len(passed) / max(len(rows), 1) * 100:.1f}%)")

    if args.limit:
        passed = passed[:args.limit]
        print(f"  limited to {len(passed)} for this run")

    if not args.offline_only and passed:
        print(f"\nstage2: {len(passed)} ETOPO windows...")
        done = []
        with cf.ThreadPoolExecutor(max_workers=WORKERS) as ex:
            for i, r in enumerate(ex.map(stage2_online, passed)):
                done.append(r)
                if (i + 1) % 100 == 0:
                    print(f"  {i + 1}/{len(passed)}")
        passed = done
        for k, v in Counter(r["decision"] for r in passed).most_common():
            print(f"  stage2 {k:<22}{v:>6}")

    ours = []
    if args.catalog:
        for r in read_csv(args.catalog):
            try:
                ours.append((r.get("name") or "", float(r.get("lat") or r.get("latitude")),
                             float(r.get("lng") or r.get("longitude"))))
            except (TypeError, ValueError):
                continue

    kept = []
    for r in passed:
        if r["decision"] != "CANDIDATE":
            kept.append(r)
            continue
        best = None
        for name, la, lo in ours:
            km = haversine_km(r["lat"], r["lng"], la, lo)
            if best is None or km < best[0]:
                best = (km, name)
        r["nearest_ours_km"] = None if best is None else round(best[0], 2)
        r["nearest_ours"] = None if best is None else best[1]
        r["decision"] = "KNOWN" if (best and best[0] <= KNOWN_KM) else "NEW"
        # GNIS and EEA both name the same beach more than once; keep one per cluster.
        if r["decision"] == "NEW" and any(
                k.get("decision") == "NEW" and haversine_km(r["lat"], r["lng"], k["lat"], k["lng"])
                <= DEDUPE_KM for k in kept):
            r["decision"] = "DUPLICATE_CLUSTER"
        kept.append(r)

    if args.osm:
        annotate_osm(kept, args.osm)
    for r in kept:
        r["confidence"] = confidence(r)

    print()
    for k, v in Counter(r["decision"] for r in kept).most_common():
        print(f"  {k:<22}{v:>6}")
    news = [r for r in kept if r["decision"] == "NEW"]
    if news:
        news.sort(key=lambda r: -r["confidence"])
        print(f"\ntop 10 NEW by confidence (review these first):")
        for r in news[:10]:
            print(f"  {r['confidence']:>5.1f}  {r['name'][:34]:<36}{(r.get('country') or '')[:14]:<16}"
                  f"fetch {r.get('fetch_km')} km  spread {r.get('spread_deg')}")

    with open(args.out, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(OUT_COLS)
        # Best-first, so the reviewer's time goes to the rows most likely to be real.
        order = {"NEW": 0, "KNOWN": 1, "DUPLICATE_CLUSTER": 2}
        for r in sorted(kept + rejected,
                        key=lambda r: (order.get(r["decision"], 9), -(r.get("confidence") or 0))):
            w.writerow([r.get(c) for c in OUT_COLS])
    print(f"\nWrote {args.out}. NOTHING was written to the database.")
    print("Review the NEW rows, then import with scripts/import_reviewed_spots.py.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
