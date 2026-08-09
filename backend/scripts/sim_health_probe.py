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

# A Windows console defaults to cp1252, which cannot encode the check/cross marks the summary
# prints. Measured 2026-08-01: the probe completed a clean 6/6 parity run and then died with
# UnicodeEncodeError on the FIRST summary line — so every row was measured, the verdict was
# never printed, and `--fail-on-divergence` returned the traceback's exit 1 no matter how green
# the parity was. ★ An instrument whose exit code is 1 on success is worse than no instrument:
# wired to a gate it is a permanent red, and a permanent red gets switched off.
# Same idiom as validate_nearshore_transform.py:67, which documents the same failure mode.
try:                                                    # pragma: no cover - console-dependent
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, OSError, ValueError, LookupError):
    pass

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
    from services.weather_pipeline import sim_forecast, sim_spots
    from services.weather_pipeline.sim_rating import (
        calculate_surf_rating, geometry_payload, reference_size_for)

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
            # ⚠️ `allow_reference_lookup=True` or this probe measures a DIFFERENT COMPOSITION than
            # the one it is comparing against: the sim would grade the global 1.2 m curve while the
            # served glyph grades against each spot's own good day, and the probe would report that
            # as a parity divergence it created itself.
            # ⛔ NOT `valid_time` — that is the observation gate's join key, and this probe compares
            # `raw_score` deliberately so the gate is not part of the comparison. Conflating the two
            # is the bug this parameter split exists to prevent.
            calc = calculate_surf_rating(
                spot, baseline["swell_height_m"], baseline["swell_period_sec"],
                baseline["swell_direction_deg"], baseline["wind_speed_knots"],
                baseline["wind_direction_deg"], partitions=baseline.get("partitions"),
                allow_reference_lookup=True)
            # ⛔⛔ AND THE COMPOSITION THE TOOLS ACTUALLY PRODUCE, WHICH IS NO LONGER THIS ONE.
            # Since `5f19ac7d` every sim TOOL grades on the size curve the app SERVED — read off the
            # point response — while the call above deliberately resolves the per-SPOT reference
            # through the flag+blob lookup. Those are different numbers: the endpoint sends the
            # per-CELL reference, measured a median 21.3% (max 52.5%) from the per-spot one.
            # ⇒ WITHOUT THIS SECOND CALL THE MONITOR IS A FALSE GREEN ON THE PATH USERS READ: it
            # would compare per-SPOT sim against per-SPOT glyph, read ~0, and stay green while
            # `get_weather_forecast` was up to ~18 points out. That is precisely the hazard recorded
            # against `valid_time`-as-permission, one layer over — and this time I created it.
            # ★ TWO NUMBERS, TWO QUESTIONS (rule 14 — put the discriminator IN the instrument):
            #     d_score         "is the sim's COMPOSITION correct?"   <- what this gate fails on
            #     d_score_served  "is what the USER GETS correct?"      <- reported, attributed
            # A large `d_score_served` beside a small `d_score` is the cell-vs-spot gap (queue E#1),
            # NOT a composition break, and the summary says so by name instead of leaving the reader
            # to guess. Gating on the composition keeps this monitor's original meaning and stops it
            # paging daily on a known, documented, open item.
            served_ref = sim_forecast.served_reference(_prov)
            calc_served = calculate_surf_rating(
                spot, baseline["swell_height_m"], baseline["swell_period_sec"],
                baseline["swell_direction_deg"], baseline["wind_speed_knots"],
                baseline["wind_direction_deg"], partitions=baseline.get("partitions"),
                allow_reference_lookup=True,
                served_reference_size_m=served_ref) if served_ref is not None else calc
            dt = time.time() - t0

            geo = geometry_payload(spot)
            verdict = geo.get("readiness") or ("resolved" if geo.get("resolved") else "blind")
            readiness[verdict] = readiness.get(verdict, 0) + 1
            # ⚠️⚠️ DID THE SIM ACTUALLY GET THE REFERENCE IT CLAIMS TO GRADE AGAINST? With
            # RATING_LOCAL_SIZE=1 but no Supabase credentials the climatology loader returns None,
            # `reference_for_spot` returns None, and the sim silently grades the GLOBAL 1.2 m curve
            # while the served glyph grades locally. That is not a parity finding — it is this
            # probe measuring a composition it built itself. Counted here so the summary can refuse
            # to report a number rather than publish a divergence it manufactured.
            if reference_size_for(spot, True) is not None:
                readiness["_refs_resolved"] = readiness.get("_refs_resolved", 0) + 1

            h_sim = calc["breaking_height_ft"] / 3.28084
            h_srv = item.get("surf_height_m")
            dh = ((h_sim - h_srv) / h_srv * 100.0) if h_srv else None
            # R11-18 (2026-08-09): the comment above ("compares raw_score deliberately so the
            # gate is not part of the comparison") was FALSE — the code compared the sim's
            # ungated score against item["score"], the GATED served number, then neutralized
            # after the fact via attribution. Compare raw-vs-raw when the payload carries it:
            # a gate-only level split now fails the margin test by construction (ds ~ 0) and
            # lands in the straddle notes instead of paging as a fake composition red.
            # d_score_served below keeps the GATED comparison — that is the product number.
            _glyph_ungated = item["raw_score"] if item.get("raw_score") is not None else item["score"]
            ds = calc["quality_rating"] - _glyph_ungated
            row = {
                "region": name, "spot": item.get("name"), "hour": hour,
                "glyph_score": item["score"], "sim_score": calc["quality_rating"], "d_score": ds,
                # THE PRODUCT NUMBER: what a user comparing the sim tool against the map would see.
                # `reference_lane` names WHICH curve produced it, so a null is legible as "the app
                # sent no reference here" rather than read as agreement.
                "sim_score_served": calc_served["quality_rating"],
                "d_score_served": round(calc_served["quality_rating"] - item["score"], 3),
                "served_level_differs": item["level"] != calc_served["quality_label"],
                "reference_lane": "served_cell" if served_ref is not None else "lookup_spot",
                "served_reference_size_m": served_ref,
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
            # ⭐ SELF-DIAGNOSIS ON DIVERGENCE (2026-08-09). Three sessions could not name the
            # mechanism behind the rotating composition reds because the artefact recorded only
            # the VERDICT — diagnosing a conditional red then requires re-running the weather,
            # which has moved. The 08-09 artefact pull killed the leading hypothesis by SIGN
            # alone (tide can only lower the GLYPH; both reds had the SIM lower) but could go no
            # further: neither side's factor vector was recorded. So: on any level split, record
            # both decompositions AT FAILURE TIME. Additive fields only; ~1 KB per diverging row,
            # and a green run adds nothing.
            if row["level_differs"] or row["served_level_differs"]:
                _w = calc.get("why") or {}
                row["glyph_limiter"] = item.get("limiter")
                row["glyph_limiter_f"] = item.get("limiter_f")
                row["glyph_why"] = item.get("why")
                row["sim_limiting_factor"] = _w.get("limiting_factor")
                row["sim_multipliers"] = {m.get("factor"): m.get("value")
                                          for m in (_w.get("multipliers") or [])}
                row["sim_blend"] = _w.get("blend")
                row["sim_inputs"] = {
                    "swell_height_m": baseline.get("swell_height_m"),
                    "swell_period_sec": baseline.get("swell_period_sec"),
                    "swell_direction_deg": baseline.get("swell_direction_deg"),
                    "wind_speed_knots": baseline.get("wind_speed_knots"),
                    "wind_direction_deg": baseline.get("wind_direction_deg"),
                    "engine_inputs": _w.get("inputs"),
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
        # THE PRODUCT SERIES, kept beside the composition one so the artifact can answer both
        # questions later. `served_lane` counts how many rows the app actually sent a reference for
        # — a summary that averaged over rows with no served reference would silently dilute the
        # gap with rows that could not exhibit it.
        served = [r for r in rows if r.get("reference_lane") == "served_cell"]
        if served:
            dss = sorted(abs(r["d_score_served"]) for r in served)
            out["d_score_served"] = {
                "median": round(statistics.median(dss), 3),
                "p90": round(dss[int(0.9 * (len(dss) - 1))], 3), "max": round(dss[-1], 3),
                "n": len(served), "level_differences": sum(1 for r in served
                                                           if r["served_level_differs"])}
        out["served_lane"] = {"served_cell": len(served), "lookup_spot": len(rows) - len(served)}
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
    ap.add_argument("--level-noise-margin", type=float, default=1.0,
                    help="a LEVEL difference with |dScore| at or below this is a "
                         "bucket-edge straddle: reported, not paged (calibrated on the "
                         "0.5-0.9 vs 10.4-31.1 gap measured 2026-08-01)")
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
                  f"{summary['d_score']['p90']}  max {summary['d_score']['max']}"
                  f"   <- COMPOSITION (this is what the gate fails on)")
            # ★ THE PRODUCT NUMBER, PRINTED WHETHER OR NOT IT IS GATED. The gate answers "is the
            # composition correct"; a user comparing the sim tool against the map is looking at
            # this one. Printing only the gated number is how a monitor stays green over an error
            # its own artifact contains.
            if "d_score_served" in summary:
                dss = summary["d_score_served"]
                readiness_refs = summary.get("geometry", {}).get("_refs_resolved", 0)
                print(f"  |dScore| served-curve  median {dss['median']}  p90 {dss['p90']}  "
                      f"max {dss['max']}  (n={dss['n']}, LEVEL differs {dss['level_differences']})"
                      f"   <- WHAT THE TOOLS ACTUALLY RETURN")
                if dss["max"] > summary["d_score"]["max"] + 1.0:
                    print(f"     ATTRIBUTED: the tools diverge MORE than the composition does "
                          f"({dss['max']} vs {summary['d_score']['max']}). That gap is the "
                          f"per-CELL vs per-SPOT size reference — queue item E#1, a known open "
                          f"item — NOT a composition break. The gate below is unaffected.")
                elif summary["d_score"]["max"] > dss["max"] + 1.0:
                    # ★ THE SYMMETRIC CASE, AND IT IS THE MORE COMMON ONE OFF-CI. The composition
                    # arm needs RATING_LOCAL_SIZE=1 *and* Supabase credentials; without either,
                    # `reference_size_for` returns None and that arm silently grades the global
                    # 1.2 m curve — a divergence the PROBE manufactured, which is exactly what
                    # `1fbd5e4e` caught the monitor publishing as a physics finding. The served arm
                    # needs nothing but a reachable app, so when the two disagree THIS WAY the
                    # instrument is the thing that is misconfigured, not the sim.
                    print(f"     ATTRIBUTED: the COMPOSITION arm diverges more than the tools do "
                          f"({summary['d_score']['max']} vs {dss['max']}), and "
                          f"{readiness_refs} of {summary['n']} rows resolved a lookup reference. "
                          f"That points at THIS PROBE's own reference lookup (RATING_LOCAL_SIZE + "
                          f"SUPABASE_*), not at the sim — the tools are within {dss['max']}.")
            if summary.get("served_lane", {}).get("lookup_spot"):
                print(f"  ⚠️ {summary['served_lane']['lookup_spot']} of {summary['n']} rows had NO "
                      f"served reference, so their two numbers are the SAME number by "
                      f"construction — they cannot exhibit the gap either way.")
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
        # ⛔⛔ REFUSE TO REPORT A DIVERGENCE THIS PROBE MANUFACTURED. With RATING_LOCAL_SIZE=1 the
        # sim grades against each spot's own good day, but the reference comes from the size
        # climatology in a PRIVATE bucket. Without SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY the
        # loader returns None and the sim silently falls back to the GLOBAL 1.2 m curve — so every
        # spot "diverges" from a glyph that graded locally. Measured on run 30703622084: 8 of 9
        # differing, |dScore| median 10.7, signed BOTH ways (California +31.1, Florida -10.3)
        # because the two coasts sit on opposite sides of the curve crossover.
        # ★ An instrument that cannot obtain the inputs of the thing it audits must say NOT
        # MEASURED, never publish the gap as a finding about the system.
        if os.environ.get("RATING_LOCAL_SIZE", "0") == "1" and not readiness.get("_refs_resolved"):
            # ★ DIAGNOSE, DO NOT MERELY DECLARE. "Instrument failure" names a class; the operator
            # needs the member. `load_size_climatology_l2` swallows every cause — missing env,
            # non-200, timeout, parse error — into a single None at debug level, so the only way to
            # tell them apart is to re-ask the questions separately and print the answers.
            diag = []
            diag.append(f"SUPABASE_URL set: {bool(os.environ.get('SUPABASE_URL'))}")
            diag.append(f"SUPABASE_SERVICE_ROLE_KEY set: "
                        f"{bool(os.environ.get('SUPABASE_SERVICE_ROLE_KEY') or os.environ.get('SUPABASE_KEY'))}")
            try:
                from services.weather_pipeline.spot_size_climatology import (
                    load_size_climatology_l2_cached, reference_map)
                clim = load_size_climatology_l2_cached()
                diag.append(f"climatology loaded: {clim is not None}")
                if clim is not None:
                    refs = reference_map(clim) or {}
                    diag.append(f"entries: {len(clim.get('spots') or {})}, references: {len(refs)}")
                    sample = [r for r in rows[:3]]
                    for r in sample:
                        sid = r.get("spot_id")
                        diag.append(f"  probe spot {r.get('spot')!r} id={sid!r} "
                                    f"-> ref {refs.get(str(sid)) if sid else None}")
            except Exception as e:
                diag.append(f"climatology probe raised: {type(e).__name__}: {e}")
            print("FAIL: RATING_LOCAL_SIZE=1 but NOT ONE spot resolved a local size "
                  "reference - the sim graded the global 1.2 m curve while the served glyph "
                  "graded locally. This is an INSTRUMENT failure, NOT a composition finding. "
                  "No parity number is reported.", file=sys.stderr)
            for line in diag:
                print(f"  {line}", file=sys.stderr)
            return 1
        # ★ Fail on COMPOSITION, not on provenance. When attribution ran, a divergence the shared-
        # provenance re-check clears is the precompute holding an older model run — real, worth
        # reporting, and not a reason to redden a composition guard. Unattributed still fails: an
        # unexplained divergence is not a cleared one.
        # A LEVEL difference whose SCORE gap is a rounding artefact is a BOUNDARY STRADDLE,
        # not a composition divergence: at a bucket edge an arbitrarily small delta flips the
        # label. Paging on it makes the monitor permanently red over noise, and a permanently
        # red monitor gets muted before the real divergence arrives.
        # ★ The margin is CALIBRATED, not chosen: measured 2026-08-01 the near-ties cluster at
        # |dScore| 0.5-0.9 while every genuine composition divergence read 10.4-31.1. The gap
        # between those populations is an order of magnitude, so 1.0 sits inside a natural
        # gap rather than on a slope. Straddles are still PRINTED - suppressed from the gate,
        # never from the report.
        real = [r for r in rows if r["level_differs"]
                and r.get("attribution") not in ("provenance_only",)
                and abs(r.get("d_score") or 0.0) > args.level_noise_margin]
        straddles = [r for r in rows if r["level_differs"] and r not in real
                     and r.get("attribution") not in ("provenance_only",)]
        for r in straddles:
            # ⚠️ stderr, NOT stdout (2026-08-09): with --json the workflow redirects stdout into
            # parity.json, and this note used to land INSIDE the artefact — the 08-05 red run's
            # parity.json was unparseable-as-JSON for exactly this reason (found the hard way,
            # mid-forensics). stdout is the artefact; prose goes to stderr.
            print(f"  note: {r['spot']} differs in LEVEL on a {abs(r['d_score']):.2f}-point gap "
                  f"({r['glyph_level']} vs {r['sim_level']}) - a bucket-edge straddle, not a "
                  f"composition divergence.", file=sys.stderr)
        if real:
            # R11-18: an UNATTRIBUTED divergence means the +42h live-compute discriminator FAILED
            # (shed/timeout on the 1-CPU box) — that is the instrument unable to attribute, not a
            # measured composition break. Red either way (an unexplained divergence is not a
            # cleared one), but say WHICH red: the run history's instrument-vs-composition
            # decomposition is what let the 08-09 forensics kill a wrong hypothesis in one pull.
            composition = [r for r in real if r.get("attribution") == "composition"]
            unattributed = [r for r in real if r.get("attribution") != "composition"]
            if composition:
                print(f"FAIL: {len(composition)} of {len(rows)} spots differ in LEVEL between the "
                      f"sim and the served glyph: "
                      + ", ".join(f"{r['spot']}={r.get('attribution', 'unattributed')}" for r in composition),
                      file=sys.stderr)
            if unattributed:
                print(f"FAIL (INSTRUMENT): {len(unattributed)} divergence(s) could not be attributed "
                      f"(live-compute discriminator failed) — NOT a measured composition finding: "
                      + ", ".join(f"{r['spot']}" for r in unattributed),
                      file=sys.stderr)
            return 1
        if args.max_score_delta is not None and summary["d_score"]["max"] > args.max_score_delta:
            print(f"FAIL: |dScore| max {summary['d_score']['max']} exceeds "
                  f"{args.max_score_delta}.", file=sys.stderr)
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
