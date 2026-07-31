#!/usr/bin/env python3
"""sim_health_probe.py — does the weather sim still agree with the app it mirrors?

    python scripts/sim_health_probe.py                       # measure and print
    python scripts/sim_health_probe.py --fail-on-divergence  # non-zero exit if a LEVEL differs
    python scripts/sim_health_probe.py --regions california,florida --per-region 8

WHY THIS IS A COMMITTED SCRIPT AND NOT A SCRATCH FILE
-----------------------------------------------------
CLAUDE.md's first invariant is ONE FORECAST COMPOSITION: the sim
(`sim_rating.calculate_surf_rating`) must return the number the map glyph shows for the same spot
and hour. `tests/test_rating_composition_parity.py` pins that STRUCTURALLY — every surface declares
a position on every optional engine input — but a structural guard cannot see a divergence that
lives in the DATA: a different geometry resolution, a stale cache, a provider change, a serve-box
flag that is set on Render and unset in the ingest lane.

That half has been measured by hand twice (2026-07-30, 2026-07-31) and the instrument thrown away
both times. ★ When a class keeps recurring the missing thing is an INSTRUMENT, not a fix.

⚠️⚠️ THE TRAP THIS PROBE EXISTS TO AVOID, AND WHY IT MUST BE SAID OUT LOUD
`/api/weather/spot-ratings` serves a PRECOMPUTED frame through a stale ladder: when the cron lane
has drifted it returns the nearest frame within 6 h and labels it `precomputed_stale`, while
`valid_time` echoes the hour that was ASKED FOR. So a naive comparison scores a rating from 09:00
against a sim forecast for 15:00 and calls the difference a composition bug. That is exactly the
artifact that had the observation gate capping 59.9% of good/epic verdicts on a cross-model
`valid_time` mismatch:

    ★★ A CHECK WHOSE TWO SIDES DO NOT SHARE A `valid_time` IS MEASURING THE CLOCK, NOT THE PHYSICS.

This probe reads `served_valid_time` off the response and re-runs the sim at THAT hour, so both
sides always describe the same moment. If the field is missing (an older deploy) it says so and
refuses to report a parity number rather than reporting a wrong one.

WHAT IT MEASURES
    geometry     resolution rate + the readiness census (full / degraded / blind)
    HEIGHT       sim breaking height vs the served `surf_height_m`, % error
    SCORE        sim quality vs the served glyph rating, and LEVEL differences — the half that had
                 no committed guard, and the one that matters: a 2-point score gap is noise, a
                 level gap is two different answers to "should I paddle out?"
    latency      per spot, cold and warm

Reference measurement, 2026-07-31 (dev @ 8ef6d8a0): 8 spots on 4 continents, 0/8 level
differences, |dScore| median 0.00 max 0.50, |dHeight| median 0.71%.
"""
import argparse
import json
import os
import statistics
import sys
import time
import urllib.request

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

BASE = os.environ.get("RAW_SURF_BASE_URL", "https://raw-surf-antigravity.onrender.com")

# Viewports, not spot names. ★ Names drift (a catalogue rename silently empties a hardcoded list and
# the probe reports "all green" over nothing); a bbox keeps measuring whatever is actually there.
REGIONS = {
    "california": (-123.2, 36.5, -121.5, 38.2),
    "socal": (-118.2, 33.2, -117.2, 33.8),
    "florida": (-80.9, 27.8, -79.9, 29.4),
    "hawaii": (-158.3, 21.5, -157.9, 21.8),
    "portugal": (-9.6, 38.9, -8.6, 39.9),
    "france": (-2.4, 43.3, -1.2, 44.2),
    "australia": (143.4, -39.2, 145.2, -37.8),
    "south_africa": (24.2, -34.4, 25.6, -33.4),
}


def _fetch(url, timeout=120):
    req = urllib.request.Request(url, headers={"User-Agent": "sim-health-probe/1"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def _top_of_hour_utc():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:00:00Z")


def probe(regions, per_region, valid_time, model="GFS", verbose=True, allow_unknown_hour=False):
    from weather_sim_mcp import _baseline_with_source
    from services.weather_pipeline import sim_spots
    from services.weather_pipeline.sim_rating import calculate_surf_rating, geometry_payload

    rows, skipped, unresolved = [], [], []
    readiness = {}
    for name in regions:
        bbox = REGIONS.get(name)
        if bbox is None:
            skipped.append((name, "unknown region"))
            continue
        url = (f"{BASE}/api/weather/spot-ratings?bbox={','.join(str(x) for x in bbox)}"
               f"&valid_time={valid_time}&model={model}&limit=40")
        try:
            served = _fetch(url)
        except Exception as e:
            skipped.append((name, f"spot-ratings fetch failed: {e}"))
            continue

        # ⚠️ BOTH SIDES MUST DESCRIBE THE SAME HOUR. See the module docstring.
        hour = served.get("served_valid_time")
        hour_verified = hour is not None
        if hour is None:
            src = served.get("source", "")
            if src.startswith("precomputed") and not allow_unknown_hour:
                bound = "2 h" if src == "precomputed" else "6 h"
                skipped.append((name, f"response carries no `served_valid_time` — this deploy "
                                      f"cannot say which hour its {src} frame describes (bounded "
                                      f"at ±{bound}), so a parity number here could be a time "
                                      f"offset wearing a composition bug's clothes. "
                                      f"--allow-unknown-hour to measure anyway, labelled."))
                continue
            hour = served.get("valid_time") or valid_time      # live path: computed at the request
            hour_verified = not src.startswith("precomputed")
        offset = served.get("frame_offset_hours")

        rated = [s for s in served.get("spots", []) if s.get("score") is not None]
        rated.sort(key=lambda s: -(s.get("score") or 0))
        if verbose:
            print(f"\n=== {name}: {len(rated)} rated · source={served.get('source')} · "
                  f"asked {valid_time} · served {hour}"
                  f"{f' ({offset:+g} h)' if offset else ''} ===")
        for item in rated[:per_region]:
            spot = sim_spots.resolve(str(item.get("spot_id"))).spot
            if spot is None:
                unresolved.append(item.get("name") or item.get("spot_id"))
                continue
            t0 = time.time()
            baseline, source, _prov = _baseline_with_source(spot, hour)
            if baseline is None:
                unresolved.append(f"{spot.get('name')} (no baseline, {source})")
                continue
            calc = calculate_surf_rating(
                spot, baseline["swell_height_m"], baseline["swell_period_sec"],
                baseline["swell_direction_deg"], baseline["wind_speed_knots"],
                baseline["wind_direction_deg"], partitions=baseline.get("partitions"))
            dt = time.time() - t0

            geo = geometry_payload(spot)
            verdict = geo.get("readiness") or ("resolved" if geo.get("resolved") else "blind")
            readiness[verdict] = readiness.get(verdict, 0) + 1

            h_sim = calc["breaking_height_ft"] / 3.28084
            h_srv = item.get("surf_height_m")
            dh = ((h_sim - h_srv) / h_srv * 100.0) if h_srv else None
            ds = calc["quality_rating"] - item["score"]
            row = {
                "region": name, "spot": item.get("name"), "hour": hour,
                "glyph_score": item["score"], "sim_score": calc["quality_rating"], "d_score": ds,
                "glyph_level": item["level"], "sim_level": calc["quality_label"],
                "level_differs": item["level"] != calc["quality_label"],
                "h_served_m": h_srv, "h_sim_m": round(h_sim, 4), "d_height_pct": dh,
                "lat": spot.get("latitude"), "lng": spot.get("longitude"),
                "spot_id": item.get("spot_id"),
                # WHICH FORECAST each side ran on. None on an older frame — `attribute()` then
                # falls back to the live-compute discriminator.
                "served_run_time": item.get("run_time"),
                "served_wind_run_time": item.get("wind_run_time"),
                "sim_run_time": (_prov or {}).get("run_time"),
                "sim_wind_run_time": (_prov or {}).get("wind_run_time"),
                # The serving lane capped a Good/Epic this sim reports ungated — a composition
                # asymmetry, not a physics one. Read off the payload, never off a local env var:
                # RATING_OBS_GATE has a value PER LANE.
                "gate_capped": (item.get("raw_score") is not None
                                and float(item["score"]) < float(item["raw_score"])),
                "geometry": verdict, "baseline_source": source,
                "partitions": len(baseline.get("partitions") or []), "seconds": round(dt, 2),
                "confirmed": item.get("confirmed"), "raw_score": item.get("raw_score"),
                # False = the two sides MAY describe different hours. Carried per row so a JSON
                # consumer cannot read a caveated number as a clean one.
                "hour_verified": hour_verified,
            }
            rows.append(row)
            if verbose:
                print(f"  {(row['spot'] or '')[:28]:30s} glyph={row['glyph_score']:6.1f} "
                      f"sim={row['sim_score']:6.1f} d={ds:+6.2f} "
                      f"{row['glyph_level']:11s}|{row['sim_level']:11s} "
                      f"dh={('%+.2f%%' % dh) if dh is not None else '   n/a':>8s} "
                      f"geo={verdict:9s} {dt:4.1f}s"
                      f"{'  ⛔ LEVEL' if row['level_differs'] else ''}")
    return rows, skipped, unresolved, readiness


def attribute(rows, model="GFS"):
    """For each LEVEL difference, decide whether the COMPOSITION diverges or only the PROVENANCE.

    ★ WHY THIS IS NOT OPTIONAL POLISH. A raw divergence count is unattributable, and the first
    honest run proved it: 4 LEVEL differences, of which exactly 1 was real. The other 3 were the
    precomputed frame having been built from an OLDER model run than the sim's live point call —
    the same hour, a different forecast. The glyph payload carries no `run_time`, so nothing in it
    can tell those apart. (Same class as products carrying no builder SHA: "is this the same
    build?" is unanswerable from the artifact.)

    THE DISCRIMINATOR: ask the endpoint for an hour far enough out that no precomputed frame exists
    within the stale bound. It then computes LIVE, on the SAME products the sim's point call reads,
    and the provenance difference disappears by construction. If the two still agree there, the
    composition is sound and the gap was staleness; if they still differ, it is real.

    ⚠️ A live compute is 7.5-8.6 s on the 1-CPU box and load-shed at 2 concurrent, so this runs ONLY
    for spots that already diverged — never as a sweep. Verdicts:
        `observation_gate`      the served payload capped a Good/Epic the sim reports ungated
        `provenance_only`       same composition on the live path; the frame was from an older run
        `composition`           the divergence survives a shared-provenance comparison — a real bug
        `unattributed`          the live probe could not be run (shed, unreachable, no rated row)
    """
    from datetime import datetime, timedelta, timezone
    from weather_sim_mcp import _baseline_with_source
    from services.weather_pipeline import sim_spots
    from services.weather_pipeline.sim_rating import calculate_surf_rating

    # +42 h: past the precompute's own frame ladder, so the stale rung (±6 h) cannot catch it.
    far = (datetime.now(timezone.utc) + timedelta(hours=42)).strftime("%Y-%m-%dT%H:00:00Z")
    for r in [x for x in rows if x["level_differs"]]:
        if r.get("gate_capped"):
            r["attribution"] = "observation_gate"
            continue

        # ★ THE CHEAP DISCRIMINATOR FIRST. Once the payload names its own model run there is
        # nothing to discover: if the glyph and the sim ran on different runs, the divergence is
        # provenance and no live compute can add to that. Only when the payload cannot say (an
        # older frame, pre-2026-07-31) do we spend 7.5-8.6 s of 1-CPU serve box to find out.
        # ⚠️ BOTH domains. Marine and wind come from different ingest jobs and shared a run at 0 of
        # 4 spots measured — comparing only the marine one would call a wind-run difference a
        # composition bug.
        served_runs = (r.get("served_run_time"), r.get("served_wind_run_time"))
        sim_runs = (r.get("sim_run_time"), r.get("sim_wind_run_time"))
        if any(served_runs) and any(sim_runs):
            differing = [d for d, a, b in (("marine", served_runs[0], sim_runs[0]),
                                           ("wind", served_runs[1], sim_runs[1]))
                         if a and b and a != b]
            if differing:
                r["attribution"] = "provenance_only"
                r["attribution_note"] = (f"{'/'.join(differing)} run differs: served "
                                         f"{served_runs} vs sim {sim_runs}")
                continue
            if all(a and b for a, b in zip(served_runs, sim_runs)):
                # Same runs in both domains: the inputs are identical, so a LEVEL difference can
                # only be the composition. No live compute needed to say so.
                r["attribution"] = "composition"
                r["attribution_note"] = "identical marine and wind runs — inputs are the same"
                continue

        lat, lng = r.get("lat"), r.get("lng")
        if lat is None or lng is None:
            r["attribution"] = "unattributed"
            continue
        pad = 0.02
        url = (f"{BASE}/api/weather/spot-ratings?bbox={lng-pad},{lat-pad},{lng+pad},{lat+pad}"
               f"&valid_time={far}&model={model}&limit=10")
        try:
            live = _fetch(url, timeout=180)
        except Exception as e:
            r["attribution"], r["attribution_note"] = "unattributed", str(e)[:120]
            continue
        if live.get("source") != "live":
            # It found a frame after all — the discriminator did not discriminate. Say so rather
            # than reading a precomputed comparison as a live one.
            r["attribution"] = "unattributed"
            r["attribution_note"] = f"wanted a live compute, got {live.get('source')}"
            continue
        match = next((s for s in live.get("spots", [])
                      if str(s.get("spot_id")) == str(r.get("spot_id")) and s.get("score") is not None),
                     None)
        spot = sim_spots.resolve(str(r.get("spot_id"))).spot if match else None
        if not match or spot is None:
            r["attribution"] = "unattributed"
            continue
        b, _src, _prov = _baseline_with_source(spot, far)
        if b is None:
            r["attribution"] = "unattributed"
            continue
        c = calculate_surf_rating(spot, b["swell_height_m"], b["swell_period_sec"],
                                  b["swell_direction_deg"], b["wind_speed_knots"],
                                  b["wind_direction_deg"], partitions=b.get("partitions"))
        r["shared_provenance_delta"] = round(c["quality_rating"] - match["score"], 2)
        r["attribution"] = ("provenance_only" if c["quality_label"] == match["level"]
                            else "composition")
    return rows


def summarize(rows, skipped, unresolved, readiness):
    out = {"n": len(rows), "level_differences": sum(1 for r in rows if r["level_differs"]),
           "geometry": readiness, "skipped": skipped, "unresolved": unresolved,
           "hour_unverified": sum(1 for r in rows if not r.get("hour_verified", True))}
    if rows:
        ds = sorted(abs(r["d_score"]) for r in rows)
        dh = sorted(abs(r["d_height_pct"]) for r in rows if r["d_height_pct"] is not None)
        lat = sorted(r["seconds"] for r in rows)
        out["d_score"] = {"median": round(statistics.median(ds), 3),
                          "p90": round(ds[int(0.9 * (len(ds) - 1))], 3), "max": round(ds[-1], 3)}
        if dh:
            out["d_height_pct"] = {"median": round(statistics.median(dh), 3),
                                   "p90": round(dh[int(0.9 * (len(dh) - 1))], 3),
                                   "max": round(dh[-1], 3)}
        out["seconds"] = {"median": round(statistics.median(lat), 2), "max": round(lat[-1], 2)}
        out["worst"] = sorted(rows, key=lambda r: -abs(r["d_score"]))[0]
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--regions", default=",".join(REGIONS),
                    help=f"comma-separated: {', '.join(REGIONS)}")
    ap.add_argument("--per-region", type=int, default=6)
    ap.add_argument("--valid-time", default="", help="ISO-8601 UTC hour; empty = now")
    ap.add_argument("--model", default="GFS")
    ap.add_argument("--fail-on-divergence", action="store_true",
                    help="exit 1 if any LEVEL differs, or if nothing could be compared")
    ap.add_argument("--max-score-delta", type=float, default=None,
                    help="also exit 1 if |dScore| exceeds this at any spot")
    ap.add_argument("--json", dest="as_json", action="store_true")
    ap.add_argument("--attribute", action="store_true",
                    help="for each LEVEL difference, re-compare on the LIVE path (shared model run) "
                         "to separate a real COMPOSITION divergence from precompute staleness. One "
                         "live compute per diverging spot only — 7-8 s each on the 1-CPU box.")
    ap.add_argument("--allow-unknown-hour", action="store_true",
                    help="measure even when the deploy cannot report `served_valid_time`. Every "
                         "affected row is labelled `hour_verified: false` and the summary says so "
                         "— the number may include a time offset of up to the stale bound.")
    args = ap.parse_args()

    vt = args.valid_time or _top_of_hour_utc()
    regions = [r.strip() for r in args.regions.split(",") if r.strip()]
    rows, skipped, unresolved, readiness = probe(
        regions, args.per_region, vt, args.model, verbose=not args.as_json,
        allow_unknown_hour=args.allow_unknown_hour)
    if args.attribute and any(r["level_differs"] for r in rows):
        attribute(rows, args.model)
    summary = summarize(rows, skipped, unresolved, readiness)

    if args.as_json:
        print(json.dumps({"valid_time": vt, "model": args.model, "summary": summary, "rows": rows},
                         indent=2, default=str))
    else:
        print("\n" + "=" * 78)
        print(f"N={summary['n']}  LEVEL differences: {summary['level_differences']}"
              f"{'  ⛔' if summary['level_differences'] else '  ✅'}")
        if rows:
            print(f"  |dScore|  median {summary['d_score']['median']}  p90 "
                  f"{summary['d_score']['p90']}  max {summary['d_score']['max']}")
            if "d_height_pct" in summary:
                print(f"  |dHeight| median {summary['d_height_pct']['median']}%  p90 "
                      f"{summary['d_height_pct']['p90']}%  max {summary['d_height_pct']['max']}%")
            print(f"  latency   median {summary['seconds']['median']}s  max "
                  f"{summary['seconds']['max']}s")
            w = summary["worst"]
            print(f"  worst     {w['spot']} ({w['region']}) glyph {w['glyph_score']} vs sim "
                  f"{w['sim_score']}  geo={w['geometry']}")
        print(f"  geometry  {readiness}")
        for r in [x for x in rows if x["level_differs"]]:
            note = f" ({r['attribution_note']})" if r.get("attribution_note") else ""
            shared = (f", shared-provenance delta {r['shared_provenance_delta']:+g}"
                      if r.get("shared_provenance_delta") is not None else "")
            print(f"  ⛔ {r['spot']} ({r['region']}): {r['glyph_level']} vs {r['sim_level']} "
                  f"— {r.get('attribution', 'not attributed; pass --attribute')}{shared}{note}")
        if summary["hour_unverified"]:
            print(f"  ⚠️ {summary['hour_unverified']} of {summary['n']} rows compared against a "
                  f"frame whose hour the deploy could not report — those numbers may include a "
                  f"time offset. Redeploy for `served_valid_time` and re-run without "
                  f"--allow-unknown-hour.")
        for name, why in skipped:
            print(f"  ⚠️ SKIPPED {name}: {why}")
        if unresolved:
            print(f"  ⚠️ {len(unresolved)} spots could not be scored by the sim: {unresolved[:5]}")

    if args.fail_on_divergence:
        if not rows:
            print("FAIL: nothing was comparable — an empty probe is not a green one.",
                  file=sys.stderr)
            return 1
        # ★ Fail on COMPOSITION, not on provenance. When attribution ran, a divergence the shared-
        # provenance re-check clears is the precompute holding an older model run — real, worth
        # reporting, and not a reason to redden a composition guard. Unattributed still fails: an
        # unexplained divergence is not a cleared one.
        real = [r for r in rows if r["level_differs"]
                and r.get("attribution") not in ("provenance_only",)]
        if real:
            print(f"FAIL: {len(real)} of {len(rows)} spots differ in LEVEL between the sim and the "
                  f"served glyph: "
                  + ", ".join(f"{r['spot']}={r.get('attribution', 'unattributed')}" for r in real),
                  file=sys.stderr)
            return 1
        if args.max_score_delta is not None and summary["d_score"]["max"] > args.max_score_delta:
            print(f"FAIL: |dScore| max {summary['d_score']['max']} exceeds "
                  f"{args.max_score_delta}.", file=sys.stderr)
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
