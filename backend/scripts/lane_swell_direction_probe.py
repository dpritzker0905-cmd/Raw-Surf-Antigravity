"""backend/scripts/lane_swell_direction_probe.py — DO THE THREE LANES DISAGREE ABOUT SWELL DIRECTION,
OR ABOUT SOMETHING ELSE?

THE OBSERVATION TO ATTRIBUTE. At spots like Majestics the served `swell_exposure` is 0.100 (the
floor) in the EURO lane and >= 0.79 in the ICON lane, at the same spot and hour. Since

    swell_exposure = 0.10 + 0.90 * max(0, cos(swell_from - shore_normal))

and the shore normal is a FIXED property of the spot (same for every lane), an exposure of 0.100
implies |dtheta| >= 90 deg while 0.79 implies |dtheta| <= 40 deg. **That is a >= 50 deg difference in
effective swell direction between two lanes** — far too large to be a boundary-straddle, so the
"models land on opposite sides of the 90 deg cutoff by a few degrees" story cannot be the mechanism.

⭐ THE KEY PROPERTY OF THIS PROBE: the disagreement between lanes can be measured WITHOUT knowing the
shore normal. Direction is read straight off `/api/weather/point`, so no geometry assumption enters.

RIVAL CAUSES, and they demand different fixes:
  A. THE MODELS GENUINELY DISAGREE about swell direction by tens of degrees. Then the exposure
     function is innocent, and the lever is model selection / the ensemble.
  B. THE LANES RUN DIFFERENT EXPOSURE MODELS. `rating_factors` uses the energy-weighted
     `effective_swell_exposure` when `partitions` are present and the single-ray `swell_exposure`
     otherwise. GFS Wave carries partitions; ECMWF WAM does not. If partitions were live, two lanes
     would be answering two different questions. ⚠️ `SURF_PARTITIONS` defaults to "0", which should
     make this cause IMPOSSIBLE — this probe checks that rather than trusting the comment
     (a flag's value is a fact about the environment, not about the source).
  C. THE LANES SAMPLE DIFFERENT HOURS. `/spot-ratings` serves each model its nearest frame, so a
     "disagreement" can be a clock difference. The served frame is reported for every lane.

WHAT WOULD MAKE THIS WRONG (state it before quoting it):
  * `/point` sampling and the precompute's sampling may differ; the reported `source`/`product_id`
    makes that visible. If they disagree the probe says so rather than pretending.
  * A direction is circular: differences are folded to [0, 180].
  * A near-zero swell height makes its direction meaningless. Heights are printed beside every
    bearing so a reader can discount a direction attached to nothing.

THE CONTROL. A spot where the three lanes AGREED on score (measured: Ekas Bay, spread ~1.2) is run
through the identical path. If the control ALSO shows a 50 deg directional spread, then large
directional disagreement is the normal background here and it cannot explain the divergent spots.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

BASE = "https://raw-surf-antigravity.onrender.com/api/weather"
MODELS = ("GFS", "ICON", "EURO")
LAYERS = ("waves", "swell_1", "swell_2", "wind_waves")


def _get(url):
    try:
        with urllib.request.urlopen(url, timeout=120) as r:
            return json.loads(r.read())
    except Exception as e:                                    # noqa: BLE001
        return {"_err": str(e)[:160]}


def ang_diff(a, b):
    """Smallest absolute circular difference in degrees, folded to [0, 180]."""
    if a is None or b is None:
        return None
    return abs((a - b + 180.0) % 360.0 - 180.0)


def spot_coords(bbox, vt, names):
    p = _get(f"{BASE}/spot-ratings?bbox={bbox}&valid_time={vt}&model=GFS&limit=200")
    if "_err" in p:
        return {}, p["_err"]
    out = {}
    for s in p.get("spots") or []:
        nm = (s.get("name") or "")
        for want in names:
            if want.lower() in nm.lower() and want not in out:
                out[want] = (nm, s.get("latitude"), s.get("longitude"))
    return out, None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bbox", default="115,-10,145,25")
    ap.add_argument("--valid-time", default=None)
    ap.add_argument("--subjects", default="Majestics,Twin Rocks,Cloud 9")
    ap.add_argument("--controls", default="Ekas Bay")
    a = ap.parse_args()
    vt = a.valid_time or (datetime.now(timezone.utc) + timedelta(hours=1)).strftime("%Y-%m-%dT%H:00:00Z")

    subjects = [s.strip() for s in a.subjects.split(",") if s.strip()]
    controls = [s.strip() for s in a.controls.split(",") if s.strip()]
    coords, err = spot_coords(a.bbox, vt, subjects + controls)
    if err:
        print(f"VOID: could not fetch spot coordinates: {err}", file=sys.stderr)
        return 2
    missing = [n for n in subjects if n not in coords]
    if missing:
        print(f"VOID: subject(s) {missing} not served in this bbox/hour.", file=sys.stderr)
        return 2
    if not any(n in coords for n in controls):
        print("VOID: no control spot resolved. A directional spread with no background is not "
              "evidence.", file=sys.stderr)
        return 2

    # --- cause B check: is the partition path even reachable in production?
    caps = _get(f"{BASE}/capabilities")
    flags = json.dumps(caps)[:4000] if "_err" not in caps else caps["_err"]
    print(f"requested valid_time: {vt}")
    print(f"capabilities probe: {'SURF_PARTITIONS' in flags and 'mentions SURF_PARTITIONS' or 'no SURF_PARTITIONS key exposed'}")

    jobs = []
    for label, group in (("SUBJECT", subjects), ("CONTROL", controls)):
        for nm in group:
            if nm not in coords:
                continue
            _n, lat, lng = coords[nm]
            for m in MODELS:
                for ly in LAYERS:
                    jobs.append((label, nm, lat, lng, m, ly))

    def fetch(j):
        label, nm, lat, lng, m, ly = j
        url = (f"{BASE}/point?model={m}&domain=marine&layer={ly}"
               f"&lat={lat}&lng={lng}&valid_time={vt}")
        return j, _get(url)

    with ThreadPoolExecutor(max_workers=8) as ex:
        results = list(ex.map(fetch, jobs))

    by = {}
    for (label, nm, lat, lng, m, ly), r in results:
        by.setdefault((label, nm), {}).setdefault(m, {})[ly] = r

    # --- REFUSAL: if no bearing was parsed anywhere, the reader is broken, not the world.
    # An earlier revision of this probe read `direction` off the top level instead of `point`
    # and would have printed "n/a" for every pair -- i.e. reported "no disagreement" having
    # measured nothing. A run that parses zero bearings must VOID, never conclude.
    parsed = sum(1 for (_l, _n, _la, _ln, _m, ly), r in results
                 if ly == "waves" and isinstance(r.get("point"), dict)
                 and r["point"].get("direction") is not None)
    if parsed == 0:
        print("VOID: parsed ZERO `waves` bearings across every lane and spot. That is a reader "
              "or contract failure, not an absence of disagreement -- check "
              "NormalizedPointResponse.point.direction.", file=sys.stderr)
        return 2

    for (label, nm), lanes in by.items():
        print(f"\n=== {label}: {nm}  ({coords[nm][1]}, {coords[nm][2]}) ===")
        print(f"  {'lane':<6s} {'layer':<11s} {'dir':>7s} {'height':>8s} {'period':>7s}  "
              f"{'valid':<22s} source")
        dirs_waves = {}
        for m in MODELS:
            for ly in LAYERS:
                r = (lanes.get(m) or {}).get(ly) or {}
                if "_err" in r:
                    print(f"  {m:<6s} {ly:<11s} {'ERR':>7s}  {str(r['_err'])[:60]}")
                    continue
                # ⚠️ The values live on `point`, NOT at the top level (NormalizedPointDetail).
                # An earlier revision read the top level, got None everywhere, and would have
                # reported "no directional disagreement" having measured nothing at all.
                # ⚠️ For marine layers `point.speed` is the OFFSHORE significant wave height --
                # never the surf height. It is shown here only to weight the bearing.
                pt = r.get("point") or {}
                d = pt.get("direction")
                h = pt.get("speed")
                per = pt.get("period")
                if ly == "waves":
                    dirs_waves[m] = d
                print(f"  {m:<6s} {ly:<11s} {str(d):>7s} {str(h):>8s} {str(per):>7s}  "
                      f"{str(r.get('valid_time'))[:22]:<22s} {str(r.get('source'))[:26]}")
        # the headline number: pairwise directional disagreement on the TOTAL field
        pairs = [(x, y) for i, x in enumerate(MODELS) for y in MODELS[i + 1:]]
        print("  pairwise |d direction| on `waves` (the field production actually rates):")
        for x, y in pairs:
            dd = ang_diff(dirs_waves.get(x), dirs_waves.get(y))
            print(f"    {x}-{y}: {('%.1f deg' % dd) if dd is not None else 'n/a'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
