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
import logging
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.weather_pipeline.shore_normal_fit import (  # noqa: E402
    MAX_SPREAD_DEG, WINDOW_HALF_DEGS, _wrap360, fit_shore_normal, fronting_water_depth_m,
    nearest_shoreline_km, nearshore_depth_m,
)
from services.weather_pipeline.ocean_access import (  # noqa: E402
    placement_verdict as ocean_placement_verdict,
)

ERDDAP = "https://coastwatch.pfeg.noaa.gov/erddap/griddap/ETOPO_2022_v1_15s.csv"
# ONE fetch per spot; every shore-normal window is CROPPED from it, so enlarging the box cannot
# change a fitted bearing. Grown from max(WINDOW_HALF_DEGS) (~5 km) because that is too small to
# answer the ocean-access question — Bethune Beach's nearest real sea is 5.11 km out and simply
# fell outside it. Accepted spots are unaffected: their nearest shoreline is already inside the
# smaller box and `nearest_shoreline_km` returns the NEAREST, so a bigger box cannot move it.
#
# ⚠️ DO NOT "OPTIMISE" THIS INTO TWO FETCHES. Measured 2026-07-27 on one spot, same instant:
#     0.045 stride 1 =  484 cells -> 22.06 s
#     0.08  stride 4 =  100 cells -> 22.05 s
#     0.08  stride 2 =  400 cells -> 21.69 s
#     0.08  stride 1 = 1600 cells -> 21.83 s
# ERDDAP charges per REQUEST, not per payload — 16x the data is free, a second request doubles the
# build. (A wide-but-coarse ocean window was tried for exactly that reason and was wrong twice:
# it cost the same, and at 1.85 km cells it false-flagged Pipeline, Cocoa Beach, Jeffreys Bay and
# Ponce Inlet as INLAND, because the quantised nearest-deep-cell lands past the 1.5 km cutoff.)
# The build's wall time tracks ERDDAP's mood, not this constant: the same code ran in 3 min at
# 0.7 s/request and >40 min at 22 s/request on the same day.
FETCH_HALF_DEG = 0.08
PAGE = 1000                                  # PostgREST silently caps at 1000 AND still returns 200
WORKERS = 6                                  # polite to NOAA; ~1516 spots lands in a few minutes
RETRIES = 3
OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                       "services", "weather_pipeline", "data")
ASSET = os.path.join(OUT_DIR, "shore_normals.json")
# A spot whose nearest shoreline is farther than this is misplaced, not just imprecise — its window
# describes some other piece of coast, so a bearing from it would be confidently wrong.
MAX_SHORELINE_KM = 3.0
# How many of the four window sizes must produce a bearing. See `accepted()` for the measurement
# that moved this from 3 to 2. Kill: SHORE_NORMAL_MIN_WINDOWS=3 restores the pre-2026-07-27 gate.
MIN_WINDOWS = int(os.environ.get("SHORE_NORMAL_MIN_WINDOWS", "2"))
# Water deeper than this cannot produce a breaking wave: a wave breaks in roughly 1.3x its own
# height, so even a 30 m monster is broken by ~38 m. A pin below it with no land in the window is
# stranded at sea, not merely imprecise. Generous on purpose — a real shallow offshore bank (Cortes
# Bank breaks over a seamount) must NOT be caught by this.
MIN_BREAKABLE_DEPTH_M = float(os.environ.get("SHORE_NORMAL_MIN_BREAKABLE_DEPTH_M", "50"))


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


def fetch_window(lat, lon, half=FETCH_HALF_DEG, stride=1):
    """One ETOPO 2022 15s box around a spot -> (elev, lats, lons) with BOTH axes ascending.

    ``stride`` subsamples the grid server-side. Cost is quadratic in half/stride, and ERDDAP is far
    more sensitive to payload than to request count: widening the box to 0.08 at stride 1 took the
    full build from ~3 min to >40 min (it hit the 45 min timeout). The ocean-access test only needs
    to resolve ~1.5 km, so it takes its own wide-but-coarse window instead."""
    import numpy as np
    import requests
    q = (f"?z%5B({lat - half:.6f}):{stride}:({lat + half:.6f})%5D"
         f"%5B({lon - half:.6f}):{stride}:({lon + half:.6f})%5D")
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
           "shoreline_km": None, "elev_m": None, "front_depth_m": None,
           "break_depth_m": None, "ocean_km": None, "ocean_verdict": None,
           "ocean_lat": None, "ocean_lng": None, "status": "ok"}
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
        # ★ `shoreline_km` counts the LAGOON bank as shore. New Smyrna's Flagler Avenue reads
        # 0.24 km from "shore" while sitting +1.5 m up in the town, 3.3 km from the Atlantic across
        # the Indian River AND the barrier island — and it was ACCEPTED, contributing a shore normal
        # of 84.8 deg fitted to the lagoon bank (its correctly-placed neighbours read 50-65 deg).
        # ocean_access asks the question that actually matters: how far to water swell can reach.
        oa = ocean_placement_verdict(elev, lats, lons, lat, lon)
        out["ocean_km"] = oa["ocean_km"]
        out["ocean_verdict"] = oa["verdict"]
        out["ocean_lat"], out["ocean_lng"] = oa["ocean_lat"], oa["ocean_lng"]
        out["front_depth_m"] = fronting_water_depth_m(elev, lats, lons, lat, lon)
        bd = nearshore_depth_m(elev, lats, lons, lat, lon)
        out["break_depth_m"] = None if bd is None else round(bd, 1)
        bearing, spread, n = fit_shore_normal(elev, lats, lons, lat, lon)
        # ⚠️ WRAP **AFTER** ROUNDING — rounding is what breaks the [0, 360) contract in practice.
        # `round(359.97, 1)` is `360.0`, so a perfectly legal bearing becomes an illegal one purely
        # by being stored. Wrapping inside `fit_shore_normal` (2026-07-27) fixed the arithmetic and
        # missed this, and this is the instance that actually fired: 359.97 is far more likely than
        # the -1e-17 atan2 case. The invariant has to be the LAST thing applied, not an earlier one.
        out["normal"] = None if bearing is None else _wrap360(round(bearing, 1))
        out["spread"] = None if spread is None else round(spread, 1)
        out["n_windows"] = n
    except Exception as e:
        out["status"] = f"fit_failed: {e}"
    return out


REVIEW_COLUMNS = ["id", "name", "region", "lat", "lng", "normal_deg", "spread_deg",
                  "n_windows", "shoreline_km", "ocean_km", "ocean_verdict",
                  "ocean_lat", "ocean_lng", "elev_m", "front_depth_m", "break_depth_m",
                  "verdict", "status"]


def review_row(r):
    """One review-CSV row. Shared by the streaming writer and the final sorted rewrite, so a
    timeout-truncated file has the same shape as a complete one."""
    return [r["id"], r["name"], r["region"], r["lat"], r["lng"], r["normal"],
            r["spread"], r["n_windows"], r["shoreline_km"], r["ocean_km"],
            r["ocean_verdict"], r["ocean_lat"], r["ocean_lng"], r["elev_m"],
            r["front_depth_m"], r["break_depth_m"], r.get("verdict"), r["status"]]


def write_is_safe(new_count, asset_path):
    """May a build with `new_count` entries overwrite the asset at `asset_path`? (ok, reason).

    ★★ 2026-07-28 a build emitted **0 of 1820** because every ERDDAP fetch failed, and NOTHING
    stopped it: `test_shipped_asset_respects_its_own_gate` passed VACUOUSLY (an empty entry list
    satisfies "every entry is legal"), the commit step committed the empty file, and only a
    `git push` race — unrelated commits landing first — kept it out of `dev`. An empty asset
    silently reverts every spot to the coarse 0.25 deg / 194.6 km grid while the build still looks
    like it ran. **Production was saved by luck, once.** Same shape as `17d831cc`, where a timed-out
    build lost every fitted row.

    The floor is measured against the asset ALREADY ON DISK, which in CI is the committed one.
    Kill: SHORE_NORMAL_ALLOW_SHRINK=1 for a deliberate catalogue shrink.
    """
    if new_count == 0:
        return False, ("an EMPTY asset — every spot would fall back to the coarse 0.25 deg grid. "
                       "This is what a total fetch failure looks like. Re-run.")
    previous = 0
    try:
        with open(asset_path) as fh:
            previous = int(json.load(fh).get("count") or 0)
    except Exception:
        previous = 0
    if os.environ.get("SHORE_NORMAL_ALLOW_SHRINK", "0") == "1" or not previous:
        return True, "ok"
    floor = int(previous * float(os.environ.get("SHORE_NORMAL_MIN_RETAIN", "0.8")))
    if new_count < floor:
        return False, (f"{new_count} entries would replace {previous} (floor {floor}). The asset on "
                       f"disk is better than what this run produced. Re-run; set "
                       f"SHORE_NORMAL_ALLOW_SHRINK=1 only if the catalogue genuinely shrank.")
    return True, "ok"


def accepted(row):
    """The gate. Every clause is a measured failure mode, not a precaution.

    ★ PLACEMENT IS TESTED BEFORE FIT QUALITY, and the order is the point. These clauses answer two
    different questions — "is this coordinate a surf spot at all?" and "is the fit trustworthy?" —
    and only the first is actionable by a human. Checking fit first made the diagnosis lie in
    exactly the worst cases: a badly misplaced pin has no coastline in its window, so it failed the
    FIT clause and short-circuited the placement check.

    Measured 2026-07-27: `spot_misplaced` fired on **0 of 1515 spots** while **133 were provably
    beyond MAX_SHORELINE_KM** — Manzanillo 12.01 km from shore at +79.9 m, Nihiwatu 10.58 km at
    +264 m — every one of them reported as `no_shoreline_in_window`, a fitting failure. ★ The worse
    the misplacement, the less likely it was called one. The review CSV is what a human works from,
    so a wrong label there is the difference between a fixable coordinate and an unexplained gap.

    Reordering CANNOT change which spots are accepted — every clause here is a rejection, so the
    shipped asset is unaffected and only the reported reason changes.
    """
    # ── 1. Is the coordinate physically a surf spot? Actionable: move the pin. ──
    # A pin on the bank of an enclosed lagoon satisfies every fit-quality clause below — all three
    # spots the owner reported inland in Volusia County (2026-07-27) passed them and shipped a shore
    # normal fitted to the Intracoastal. A bearing from the wrong body of water is worse than no
    # bearing: a miss falls back to the coarse grid, a confident wrong answer is used as-is.
    if row.get("ocean_verdict") in ("INLAND", "NO_OCEAN"):
        return False, f"not_on_open_ocean_{(row.get('ocean_verdict') or '').lower()}"
    # The seaward mirror of that test. `ocean_verdict` only asks whether swell can REACH the pin, so
    # a spot stranded in open water passes it — this is the clause that catches those.
    if row["shoreline_km"] is not None and row["shoreline_km"] > MAX_SHORELINE_KM:
        return False, "spot_misplaced"
    # ★ AND THE WORST CASE OF ALL, which the clause above CANNOT see. `shoreline_km` is None when
    # there is no shoreline anywhere in the fetched window (~±0.08 deg, about 18 km across) — so the
    # further out to sea a pin is, the more certainly it escapes a bound expressed in km-from-shore.
    # The same "worse error, weaker diagnosis" shape as the ordering bug above, one level deeper.
    #
    # Measured 2026-07-27: 25 spots have no shoreline measurement at all. They split cleanly by the
    # sign of the pin elevation — 8 are ABOVE sea level and were already caught as
    # `not_on_open_ocean_no_ocean`, while 17 are UNDERWATER and were reported as a FITTING failure:
    # Telescopes -1778 m, Macaronis -1686 m, Scorpion Bay Second Point -1677 m, Iron Bottom Sound
    # -654 m. World-famous breaks whose stored pin sits in over a kilometre of water.
    #
    # The bound is physics, not a percentile: a wave breaks in roughly 1.3x its own height, so even
    # a 30 m monster breaks by ~38 m. Below MIN_BREAKABLE_DEPTH_M nothing can break, so a pin there
    # with no land in sight is not a surf break — while a genuine shallow offshore bank (Cortes Bank
    # breaks over a seamount) reads far shallower and is deliberately NOT caught.
    if row["shoreline_km"] is None and (row.get("elev_m") is not None
                                        and row["elev_m"] < -MIN_BREAKABLE_DEPTH_M):
        return False, "spot_misplaced_at_sea"

    # ── 2. Is the fit trustworthy? Not actionable by a human; it describes the data. ──
    if row["normal"] is None or row["spread"] is None:
        return False, "no_shoreline_in_window"
    # ★ TWO AGREEING WINDOWS ARE ENOUGH — the SPREAD does the confidence work, not the count.
    # This clause read `< 3` and threw away 153 spots, 133 of them ON_OCEAN a median 0.21 km from
    # open water, whose two fitted windows agreed to a median of 5.5 deg. It was also stricter than
    # `fit_shore_normal`'s own contract, which returns a bearing at two windows and None below that.
    # Every rejected spot fell back to the coarse 0.25 deg grid — a bearing decided from a 194.6 km
    # window, i.e. the least trustworthy answer available.
    #
    # Measured 2026-07-27 against the LOCAL ACCEPTED CONSENSUS (accepted spots within 15 km, which
    # were OSM-validated as a class at median 6.4 deg). The instrument reproduces that control at
    # median 6.2 deg leave-one-out, so it is measuring the same thing:
    #     accepted (control, n=176) ETOPO  6.2 deg vs coarse 14.6 deg, ETOPO wins 70%
    #     2-window (n=41 gradeable) ETOPO 10.1 deg vs coarse 17.4 deg, ETOPO wins 68%
    # The 2-window fits are barely behind the ones already shipped and clearly ahead of the fallback
    # they get today. Win rate is flat at ~74% out to spread 25 and 68% at 40, so the EXISTING
    # single spread gate is kept rather than inventing a second threshold for a 7-spot difference.
    # Expected effect: +129 spots (948 -> ~1077 of 1515, 62.6% -> 71.1%).
    # ⚠️ 88 of the 129 had too few coherent neighbours to grade — the mechanism generalises but that
    # portion is inference, not measurement. Kill: SHORE_NORMAL_MIN_WINDOWS=3.
    if row["n_windows"] < MIN_WINDOWS:
        return False, "too_few_windows"
    if row["spread"] > MAX_SPREAD_DEG:
        return False, "ambiguous_coastline"
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
    # Rows are STREAMED to the review CSV as they complete, not written at the end. The fit is
    # ~1516 ERDDAP round-trips and ERDDAP's latency is wildly variable (measured the same day:
    # 0.7 s/request -> a 3 min build; 22 s/request -> killed by the job timeout). The 2026-07-27
    # run that hit the timeout lost EVERY fitted row, because the CSV had not been opened yet —
    # the `if: always()` artifact upload correctly ran and found no file. Partial data beats none.
    rows = []
    with open(args.out_csv, "w", newline="", encoding="utf-8") as _fh:
        _w = csv.writer(_fh)
        _w.writerow(REVIEW_COLUMNS)
        with cf.ThreadPoolExecutor(max_workers=WORKERS) as ex:
            for i, row in enumerate(ex.map(measure, spots)):
                rows.append(row)
                _w.writerow(review_row(row))
                if (i + 1) % 100 == 0:
                    _fh.flush()
                    print(f"  {i + 1}/{len(spots)}")

    entries, reasons = [], {}
    for row in rows:
        ok, why = accepted(row)
        row["verdict"] = why
        reasons[why] = reasons.get(why, 0) + 1
        if ok:
            entries.append([round(row["lat"], 5), round(row["lng"], 5),
                            row["normal"], row["spread"], row["break_depth_m"]])

    n_fetch_fail = sum(1 for r in rows if r["status"].startswith("fetch_failed"))
    print(f"\nVERDICTS ({len(rows)} spots)")
    for k, v in sorted(reasons.items(), key=lambda kv: -kv[1]):
        print(f"  {k:<26} {v:>5}  ({100 * v / max(len(rows), 1):5.1f}%)")
    if n_fetch_fail:
        print(f"  ⚠ {n_fetch_fail} spots failed to fetch — rerun to fill them in.")

    asset = {
        "source": "NOAA ETOPO 2022 v1 15s via ERDDAP (CC0 public domain, ~463 m)",
        "method": ("coast-PCA fitted at 4 window sizes, circular mean; gated on the maximum "
                   "pairwise spread across windows (the estimator's self-measured confidence). "
                   "entry = [lat, lng, shore_normal_deg, spread_deg, nearshore_break_depth_m]"),
        "max_spread_deg": MAX_SPREAD_DEG,
        "max_shoreline_km": MAX_SHORELINE_KM,
        "windows_half_deg": list(WINDOW_HALF_DEGS),
        "spots_considered": len(rows),
        "count": len(entries),
        "entries": entries,
    }
    # ★★ REFUSE TO OVERWRITE A GOOD ASSET WITH A COLLAPSED ONE.
    # 2026-07-28 this build emitted **0 of 1820** entries because every ERDDAP fetch failed, and
    # NOTHING STOPPED IT: `test_shipped_asset_respects_its_own_gate` passed VACUOUSLY (an empty
    # entry list satisfies "every entry is legal"), the commit step committed the empty file, and
    # only a `git push` race — unrelated commits landing first — kept it out of `dev`. An empty
    # asset silently reverts every spot to the coarse 0.25 deg grid, which is a 194.6 km window,
    # while the build still looks like it ran. Production was saved by luck, once.
    # This is the same shape as `17d831cc`, where a timed-out build lost every fitted row.
    # The floor is measured against the asset ALREADY ON DISK, which in CI is the committed one.
    # Kill: SHORE_NORMAL_ALLOW_SHRINK=1 (for a deliberate catalogue shrink).
    ok, why = write_is_safe(len(entries), args.asset)
    if not ok:
        print(f"\n⛔ REFUSING TO WRITE — {why}")
        return 1

    os.makedirs(os.path.dirname(args.asset), exist_ok=True)
    with open(args.asset, "w") as fh:
        json.dump(asset, fh, separators=(",", ":"))
    print(f"\nAsset: {len(entries)}/{len(rows)} spots -> {args.asset} "
          f"({os.path.getsize(args.asset) / 1024:.0f} KB)")

    # Rewrite the streamed CSV now that every row has a verdict, sorted by OCEAN distance rather
    # than shoreline distance — sorting by shoreline_km put the lagoon-bank spots at the BOTTOM,
    # looking fine, which is exactly how they went unnoticed.
    with open(args.out_csv, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(REVIEW_COLUMNS)
        for r in sorted(rows, key=lambda r: -(r["ocean_km"] or 0)):
            w.writerow(review_row(r))
    print(f"Review CSV (worst OCEAN ACCESS first): {args.out_csv}")

    misplaced = [r for r in rows if (r["shoreline_km"] or 0) > MAX_SHORELINE_KM]
    if misplaced:
        print(f"\nWORST 15 PLACEMENTS of {len(misplaced)} beyond {MAX_SHORELINE_KM} km:")
        for r in sorted(misplaced, key=lambda r: -(r["shoreline_km"] or 0))[:15]:
            print(f"  {(r['name'] or '?')[:34]:<34} {(r['region'] or '-')[:16]:<16} "
                  f"{r['shoreline_km']:7.2f} km from shore, z={r['elev_m']:+8.1f} m")
    return 0


if __name__ == "__main__":
    sys.exit(main())
