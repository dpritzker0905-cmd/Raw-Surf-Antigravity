"""backend/scripts/wave_physics_validity_census.py — DOES EVERY SERVED WAVE FIELD OBEY WAVE PHYSICS?

WHY THIS EXISTS. Reading per-lane point samples for an unrelated question surfaced values that cannot
exist:

    EURO / Lakey Peak   swell_1 = 1.171 m at **1.67 s**
    EURO / Lakey Peak   wind_waves = 0.671 m at **0.33 s**

while the SAME lane's total `waves` field read a perfectly sensible 14.54 s. A height/period pair is
not free to be anything: in deep water

    L = g T^2 / (2 pi) = 1.56 T^2          steepness = H / L

and a wave steeper than about **1/7** has already broken (Michell 1893; the limit used operationally
by ECMWF/NOAA). 1.171 m at 1.67 s gives L = 4.35 m and steepness **0.27** -- roughly twice the
physical maximum. Such a sea cannot be observed, so the field is not a period.

⭐ WHY A PHYSICS CHECK RATHER THAN A RANGE CHECK. A hard-coded "period must be 4-25 s" encodes a
guess. Steepness is a LAW: it needs no calibration, it cannot drift with the product, and it flags
exactly the pairs that could not have come from an ocean. It also cannot be satisfied by a plausible
looking wrong number, which a range check can.

WHAT IS CHECKED, per (lane, layer, spot):
  * `impossible`  steepness > 1/7  -> the (H, T) pair cannot coexist. A DEFECT, not a tolerance.
  * `implausible` steepness > 1/10 -> physically possible but at the very edge; reported separately
                  so the headline count stays defensible.
  * `degenerate`  height > 0 with period <= 0, or exactly-zero direction+height+period, which is how
                  an unsupported layer answers with data-shaped nothing.

⚠️ WHAT WOULD MAKE THIS WRONG (stated before the numbers):
  * Shallow water. The deep-water relation over-reads steepness where depth < L/2. These are surf
    spots, so nearshore cells can be shallow -- but the samples are the OFFSHORE model fields, and a
    steepness of 0.27 is not rescued by any depth correction. Marginal flags near the 1/7 line
    should still be treated as suspect-not-proven, which is why 1/10 is reported separately.
  * `point.speed` is the significant wave height for marine layers, NOT the surf height.
  * A layer a model genuinely does not carry (ICON swell_2 -- GWAM has no secondary swell) is
    EXPECTED to be empty; it is counted as `unsupported`, never as a defect.

THE CONTROL. GFS carries true spectral partitions and is the lane with the least reason to be
broken. If GFS shows the same impossible rate as EURO, the fault is in this probe or in the sampling
path, not in a lane -- and the run says so instead of blaming a model.
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

BASE = "https://raw-surf-antigravity.onrender.com/api/weather"
MODELS = ("GFS", "ICON", "EURO")
LAYERS = ("waves", "swell_1", "swell_2", "wind_waves")
STEEP_IMPOSSIBLE = 1.0 / 7.0
STEEP_IMPLAUSIBLE = 1.0 / 10.0
REGIONS = {
    "ASIA-SE": "115,-10,145,25", "EUR-ATL": "-15,35,5,60", "NAM-W": "-130,25,-105,50",
    "OCE": "140,-45,180,-10", "LATAM-PAC": "-95,-40,-68,15",
}


def _get(url):
    try:
        with urllib.request.urlopen(url, timeout=120) as r:
            return json.loads(r.read())
    except Exception as e:                                    # noqa: BLE001
        return {"_err": str(e)[:120]}


def steepness(h, t):
    if h is None or t is None or t <= 0 or h <= 0:
        return None
    return h / (1.56 * t * t)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--per-region", type=int, default=6)
    ap.add_argument("--valid-time", default=None)
    ap.add_argument("--json", default=None)
    a = ap.parse_args()
    vt = a.valid_time or (datetime.now(timezone.utc) + timedelta(hours=1)).strftime("%Y-%m-%dT%H:00:00Z")

    # --- pick spots from the served catalogue so coordinates are real breaks, not random sea
    spots = []
    for rn, bbox in REGIONS.items():
        p = _get(f"{BASE}/spot-ratings?bbox={bbox}&valid_time={vt}&model=GFS&limit=200")
        if "_err" in p:
            continue
        got = [s for s in (p.get("spots") or []) if s.get("latitude") is not None]
        step = max(1, len(got) // max(1, a.per_region))
        for s in got[::step][:a.per_region]:
            spots.append((rn, s.get("name"), s["latitude"], s["longitude"]))
    if len(spots) < 10:
        print(f"VOID: only {len(spots)} spots resolved; too few to characterise a lane.",
              file=sys.stderr)
        return 2

    jobs = [(rn, nm, la, ln, m, ly) for (rn, nm, la, ln) in spots
            for m in MODELS for ly in LAYERS]

    def fetch(j):
        rn, nm, la, ln, m, ly = j
        return j, _get(f"{BASE}/point?model={m}&domain=marine&layer={ly}"
                       f"&lat={la}&lng={ln}&valid_time={vt}")

    with ThreadPoolExecutor(max_workers=10) as ex:
        results = list(ex.map(fetch, jobs))

    stats, examples, errors = {}, [], 0
    for (rn, nm, la, ln, m, ly), r in results:
        key = (m, ly)
        st = stats.setdefault(key, {"n": 0, "impossible": 0, "implausible": 0,
                                    "degenerate": 0, "unsupported": 0, "empty": 0})
        if "_err" in r:
            errors += 1
            continue
        if str(r.get("source")) == "unsupported_model_layer":
            st["unsupported"] += 1
            continue
        pt = r.get("point") or {}
        h, t = pt.get("speed"), pt.get("period")
        st["n"] += 1
        if (h in (None, 0) or h == 0.0) and (t in (None, 0) or t == 0.0):
            st["empty"] += 1
            continue
        if h and h > 0 and (t is None or t <= 0):
            st["degenerate"] += 1
            continue
        s = steepness(h, t)
        if s is None:
            continue
        if s > STEEP_IMPOSSIBLE:
            st["impossible"] += 1
            if len(examples) < 14:
                examples.append((m, ly, rn, nm, h, t, s))
        elif s > STEEP_IMPLAUSIBLE:
            st["implausible"] += 1

    print(f"valid_time {vt}   spots {len(spots)}   samples {len(jobs)}   fetch errors {errors}")
    print(f"deep-water steepness  H / (1.56 T^2);  impossible > 1/7 = {STEEP_IMPOSSIBLE:.3f}\n")
    print(f"{'lane':<6s} {'layer':<11s} {'n':>4s} {'IMPOSSIBLE':>11s} {'implaus':>8s} "
          f"{'degen':>6s} {'empty':>6s} {'unsup':>6s}")
    lane_bad = {}
    for m in MODELS:
        for ly in LAYERS:
            st = stats.get((m, ly))
            if not st:
                continue
            n = st["n"] or 1
            lane_bad[m] = lane_bad.get(m, 0) + st["impossible"]
            print(f"{m:<6s} {ly:<11s} {st['n']:>4d} {st['impossible']:>7d} "
                  f"({st['impossible']/n:>4.0%}) {st['implausible']:>8d} {st['degenerate']:>6d} "
                  f"{st['empty']:>6d} {st['unsupported']:>6d}")

    # --- THE CONTROL: if GFS is as bad as EURO, suspect the probe, not the lane.
    print(f"\nimpossible totals by lane: " + "  ".join(f"{m}={lane_bad.get(m,0)}" for m in MODELS))
    if lane_bad.get("GFS", 0) and lane_bad.get("GFS", 0) >= max(lane_bad.values()):
        print("CONTROL TRIPPED: GFS -- the lane with true spectral partitions and least reason to "
              "be wrong -- has the highest impossible count. Suspect this probe or the sampling "
              "path before blaming any model.", file=sys.stderr)

    if examples:
        print("\nexamples of physically impossible (H, T) pairs:")
        for m, ly, rn, nm, h, t, s in examples:
            L = 1.56 * t * t
            print(f"  {m:<5s} {ly:<11s} {str(nm)[:22]:<22s} {rn:<9s} H={h:>6.3f} m  T={t:>5.2f} s "
                  f"-> L={L:>6.2f} m  steepness={s:>5.2f}")
    if a.json:
        json.dump({"vt": vt, "stats": {f"{k[0]}|{k[1]}": v for k, v in stats.items()},
                   "examples": examples}, open(a.json, "w", encoding="utf-8"), indent=2)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
