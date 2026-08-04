"""backend/scripts/exposure_flip_census.py — IS THE CROSS-MODEL SPREAD MADE BY THE EXPOSURE CLIFF?

THE HYPOTHESIS, AND IT IS A JACOBIAN CLAIM. `surf_rating.swell_exposure` is

    exposure = 0.10 + 0.90 * max(0, cos(dtheta))        dtheta = swell bearing vs shore normal

which is CONTINUOUS in value but DISCONTINUOUS IN SENSITIVITY at dtheta = 90 deg: just inside, the
factor grades smoothly; just outside, it is pinned at the 0.10 floor for the entire remaining
half-plane. Crossing that boundary multiplies the score by ~8x, and `score = 100 * PROD(nine
factors)` so the multiplier lands undamped on the output.

Two independently measured facts make that cliff dangerous:
  * the three models disagree about swell DIRECTION by ordinary amounts (degrees to tens of degrees);
  * the shore normal defining `dtheta` is `degraded`/borrowed for ~38% of served spots, median error
    **29.0 deg** (HANDOFF-2026-08-04 section 4).

If a spot's swell sits within that error of the boundary, which side it lands on is close to
arbitrary -- and the score swings ~8x on it. Observed at Majestics 2026-08-04: EURO limiter
`swell_exposure` at 0.100 -> 5.6, while ICON's `wind_period_blend` 0.793 -> 72.4, on inputs whose
HEIGHTS differ only ~2x. If that shape is general, the exposure cliff -- not the observation gate --
is what makes the served scores unstable, and the gate is only the surface where it becomes visible.

THE TEST. Classify every spot carrying all three lanes by how the exposure floor falls across them:

    FLIP       at least one lane on the floor AND at least one lane off it
    ALL_FLOOR  every lane on the floor          (spot genuinely faces away -- not a boundary case)
    NONE       no lane on the floor

Then compare the cross-model score spread between classes.

  * FLIP spreads >> NONE spreads  -> the cliff manufactures the disagreement. The lever is the
    exposure model and the geometry feeding it, not the confirmation statistic.
  * FLIP spreads ~= NONE spreads  -> the cliff is incidental; the models simply disagree, and this
    hypothesis is DEAD. That outcome is reachable and is the point of measuring.

⚠️ WHAT WOULD MAKE THIS WRONG -- stated before the numbers (rule 16):
  * `limiter` is the ARGMIN over nine factors, so a lane whose exposure sits at 0.10 while some other
    factor is even lower will NOT be labelled here. This census therefore UNDER-counts floored lanes,
    biasing FLIP toward NONE -- i.e. against the hypothesis. It cannot inflate the effect.
  * `limiter_f` is a rounded float; the floor test uses a tolerance rather than equality.
  * `/spot-ratings` caps at limit=200, so a single bbox is a viewport. Eight regions are unioned and
    the distinct-spot count is reported.
  * The lanes may serve different frames. The span is reported and the run VOIDS beyond the
    production join tolerance, because past that a spread measures the clock.

THE CONTROLS. (1) NONE is the known-good background: if it shows the same spread as FLIP there is no
effect. (2) The run VOIDS if no spot lands in FLIP at all -- an empty treatment group cannot support
a conclusion, and silently reporting "no difference" from n=0 is how an instrument reports success
having tested nothing.
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

BASE = "https://raw-surf-antigravity.onrender.com/api/weather/spot-ratings"
MODELS = ("GFS", "ICON", "EURO")
EXPOSURE_FLOOR = 0.10
FLOOR_TOL = 1e-3
CONFIRM_TIME_TOLERANCE_H = 3.0
MIN_SPOTS = 200

REGIONS = {
    "global": "-180,-60,180,70", "NAM-W": "-130,25,-105,50", "NAM-E": "-85,24,-60,46",
    "EUR-ATL": "-15,35,5,60", "OCE": "140,-45,180,-10", "ASIA-SE": "95,-10,145,25",
    "LATAM-PAC": "-95,-40,-68,15", "AFR": "-20,-38,20,15",
}


def _fetch(job):
    bbox, vt, model = job
    url = f"{BASE}?bbox={bbox}&valid_time={vt}&model={model}&limit=200"
    try:
        with urllib.request.urlopen(url, timeout=180) as r:
            return model, json.loads(r.read())
    except Exception as e:                                    # noqa: BLE001
        return model, {"_err": str(e)}


def collect(vt):
    jobs = [(bb, vt, m) for bb in REGIONS.values() for m in MODELS]
    with ThreadPoolExecutor(max_workers=8) as ex:
        out = list(ex.map(_fetch, jobs))
    by_spot, served, errors = {}, set(), 0
    for model, p in out:
        if "_err" in p:
            errors += 1
            continue
        served.add(p.get("served_valid_time"))
        for s in p.get("spots") or []:
            raw = s.get("raw_score") if s.get("raw_score") is not None else s.get("score")
            if raw is None:
                continue
            e = by_spot.setdefault(s["spot_id"], {"name": s.get("name"), "lanes": {}})
            e["lanes"][model] = {
                "raw": float(raw),
                "limiter": s.get("limiter"),
                "limiter_f": s.get("limiter_f"),
                "geometry": s.get("geometry_readiness"),
                "height": s.get("surf_height_m"),
            }
    return by_spot, served, errors


def on_floor(lane):
    return (lane.get("limiter") == "swell_exposure"
            and lane.get("limiter_f") is not None
            and float(lane["limiter_f"]) <= EXPOSURE_FLOOR + FLOOR_TOL)


def pct(xs, q):
    if not xs:
        return None
    s = sorted(xs)
    return round(s[min(len(s) - 1, max(0, int(round(q * (len(s) - 1)))))], 1)


def describe(xs):
    if not xs:
        return "n=0"
    return (f"n={len(xs):>4d}  p25={pct(xs, .25):>6}  p50={pct(xs, .50):>6}  "
            f"p75={pct(xs, .75):>6}  p90={pct(xs, .90):>6}  max={max(xs):>6.1f}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--valid-time", default=None)
    ap.add_argument("--json", default=None)
    a = ap.parse_args()
    vt = a.valid_time or (datetime.now(timezone.utc) + timedelta(hours=1)).strftime("%Y-%m-%dT%H:00:00Z")

    by_spot, served, errors = collect(vt)

    stamps = sorted(s for s in served if s)
    if not stamps:
        print("VOID: no served_valid_time on any response.", file=sys.stderr)
        return 2
    parsed = [datetime.fromisoformat(s.replace("Z", "+00:00")) for s in stamps]
    span_h = (max(parsed) - min(parsed)).total_seconds() / 3600.0
    if span_h > CONFIRM_TIME_TOLERANCE_H:
        print(f"VOID: served frames span {span_h:.1f} h ({stamps}), beyond the {CONFIRM_TIME_TOLERANCE_H} h "
              f"production join tolerance. Past that a spread measures the clock.", file=sys.stderr)
        return 2

    common = {k: v for k, v in by_spot.items() if len(v["lanes"]) == len(MODELS)}
    if len(common) < MIN_SPOTS:
        print(f"VOID: only {len(common)} spots carry all three lanes (need >= {MIN_SPOTS}); "
              f"{errors} fetches failed.", file=sys.stderr)
        return 2

    classes = {"FLIP": [], "ALL_FLOOR": [], "NONE": []}
    for sid, e in common.items():
        floored = [on_floor(l) for l in e["lanes"].values()]
        cls = "ALL_FLOOR" if all(floored) else ("FLIP" if any(floored) else "NONE")
        raws = [l["raw"] for l in e["lanes"].values()]
        e["spread"] = max(raws) - min(raws)
        e["max_raw"] = max(raws)
        e["cls"] = cls
        classes[cls].append(e)

    # --- CONTROL 2: an empty treatment group cannot support a conclusion.
    if not classes["FLIP"]:
        print("VOID: no spot lands in FLIP at this hour, so the cliff hypothesis has an empty "
              "treatment group. Nothing measured.", file=sys.stderr)
        return 2

    print(f"served frames: {stamps}  (span {span_h:.1f} h)")
    print(f"spots carrying all 3 lanes: {len(common)}   failed fetches: {errors}")
    print(f"NOTE: `limiter` is an ARGMIN, so lanes floored on exposure while another factor is lower "
          f"are counted as NOT floored. This UNDER-counts FLIP and biases against the hypothesis.\n")

    print(f"{'class':>10s}  {'spots':>6s}  cross-model score SPREAD")
    for cls in ("FLIP", "ALL_FLOOR", "NONE"):
        xs = [e["spread"] for e in classes[cls]]
        share = len(classes[cls]) / len(common)
        print(f"{cls:>10s}  {len(classes[cls]):>6d}  ({share:>5.1%})  {describe(xs)}")

    flip = [e["spread"] for e in classes["FLIP"]]
    none = [e["spread"] for e in classes["NONE"]]
    if flip and none:
        ratio = statistics.median(flip) / statistics.median(none) if statistics.median(none) else None
        print(f"\n  median spread FLIP / NONE = "
              f"{statistics.median(flip):.1f} / {statistics.median(none):.1f}"
              + (f" = {ratio:.2f}x" if ratio else ""))

    # --- where does the cap actually bite? cross the classes with the high-score population
    high = [e for e in common.values() if e["max_raw"] >= 70.0]
    if high:
        hist = {}
        for e in high:
            hist[e["cls"]] = hist.get(e["cls"], 0) + 1
        print(f"\n  spots with ANY lane >= 70 (where the gate is in play): {len(high)}")
        for cls in ("FLIP", "ALL_FLOOR", "NONE"):
            n = hist.get(cls, 0)
            print(f"    {cls:>10s}: {n:>4d} ({n / len(high):>5.1%})")

    # --- geometry cross-tab: is FLIP concentrated on degraded normals?
    geo = {}
    for e in common.values():
        g = (list(e["lanes"].values())[0] or {}).get("geometry") or "unknown"
        key = (e["cls"], g)
        geo[key] = geo.get(key, 0) + 1
    print("\n  class x geometry_readiness:")
    gnames = sorted({k[1] for k in geo})
    print(f"    {'':>10s} " + " ".join(f"{g:>10s}" for g in gnames))
    for cls in ("FLIP", "ALL_FLOOR", "NONE"):
        row = [geo.get((cls, g), 0) for g in gnames]
        tot = sum(row) or 1
        print(f"    {cls:>10s} " + " ".join(f"{v:>10d}" for v in row)
              + "   " + " ".join(f"{v / tot:>5.0%}" for v in row))

    worst = sorted(classes["FLIP"], key=lambda e: -e["spread"])[:8]
    print("\n  widest FLIP spots (lane: raw / limiter / f):")
    for e in worst:
        print(f"    {str(e['name'])[:26]:<26s} spread={e['spread']:>5.1f}  " + "  ".join(
            f"{m}={e['lanes'][m]['raw']:>5.1f}/{str(e['lanes'][m]['limiter'])[:12]}/"
            f"{e['lanes'][m]['limiter_f']}" for m in MODELS))

    if a.json:
        json.dump({
            "served": vt, "frames": stamps, "n": len(common),
            "classes": {c: [{"name": e["name"], "spread": e["spread"],
                             "max_raw": e["max_raw"]} for e in v] for c, v in classes.items()},
        }, open(a.json, "w", encoding="utf-8"), indent=2)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
