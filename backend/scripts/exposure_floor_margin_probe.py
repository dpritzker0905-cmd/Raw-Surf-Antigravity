"""exposure_floor_margin_probe.py — CAN A BETTER SHORE NORMAL LIFT THE EXPOSURE FLOOR AT ALL?

THE QUESTION
------------
`surf_rating.swell_exposure(swell_from, shore_normal) = clamp(0.10 + 0.90*max(0, cos dtheta))`
floors an ENTIRE HALF-PLANE at 0.10. MASTER AUDIT 1.0 §8.0 proposed fixing shore normals as the
top-priority lever against that floor.

That lever only works on a spot within a PLAUSIBLE BEARING ERROR of the dtheta = 90 boundary.
Graded against OSM coastline winding, the served bearing is p50 ~12.6 deg off. So the question is
not "is the bearing wrong" — it is a DISTRIBUTION:

    for spots the app is actually flooring, how far past 90 deg is dtheta?

A spot 40 deg past the boundary cannot be rescued by a 12 deg correction, however wrong its
bearing is. That makes this a Jacobian question (sensitivity x uncertainty), and it is answerable
from the served payload plus the production geometry chain — no CDS, no campaign.

⚠️⚠️ READ THE RIGHT LAYER. `spot_ratings` feeds `swell_exposure` from
`resolve_point(layer="waves").point.direction` — the TOTAL wave direction, NOT `swell_1`. The
first run of this probe queried `swell_1` and produced FIVE floored spots with dtheta < 90, i.e.
an arithmetic impossibility that was really a layer mismatch in the instrument. Fixing the layer
cut it to two and moved the median from 23.5 to 37.2 deg. ★ A contradiction between a served
verdict and a recomputed one is the instrument's problem until proven otherwise.

THE CONTROL (this probe is refutable)
-------------------------------------
Spots the app did NOT floor must come back with dtheta < 90 BY CONSTRUCTION. If they do not, the
probe is measuring a frame or convention error in itself rather than a property of the population,
and its floored numbers mean nothing. Measured 2026-08-03: 0 of 24 controls violated it.

⚠️ SCOPE, stated rather than implied. `/api/weather/spot-ratings` caps at `limit=200` against a
1,773-spot catalogue, so this is a VIEWPORT SAMPLE at ONE valid_time — never quote it as a
catalogue rate. The served payload is `precomputed`; a small residual disagreement with a live
point query is expected (2 of 32 on the reference run) because the precompute and the probe can
land on different model runs. Quote the shape, not the third decimal.

USAGE
    python scripts/exposure_floor_margin_probe.py
    python scripts/exposure_floor_margin_probe.py --limit 200 --max-floored 60 --json out.json
"""
import argparse
import json
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

DEFAULT_BASE = "https://raw-surf-antigravity.onrender.com"
FLOOR = 0.10
# The OSM-graded p50 error of a BORROWED served bearing. The honest "could a geometry fix reach
# this spot?" threshold — see shore_normal_asset.py for the hold-out that produced it.
PLAUSIBLE_BEARING_ERR_DEG = 13.0
# How far a control may sit past dtheta=90 before it stops being explainable as precompute-vs-live
# model-run drift. Inside this, the two frames legitimately disagree about a boundary-adjacent
# spot; outside it, the probe's own convention is suspect.
FRAME_DRIFT_TOL_DEG = 10.0


def _get(url, timeout=120):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return json.load(r)


def _pctl(vals, p):
    s = sorted(vals)
    return s[min(len(s) - 1, int(p / 100 * len(s)))]


def _angular(a, b):
    return abs((a - b + 180.0) % 360.0 - 180.0)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--base", default=DEFAULT_BASE)
    ap.add_argument("--limit", type=int, default=200, help="server caps this at 200")
    ap.add_argument("--max-floored", type=int, default=60)
    ap.add_argument("--max-control", type=int, default=25)
    ap.add_argument("--json", default="")
    args = ap.parse_args()

    from services.weather_pipeline.surf_point import resolve_surf_geometry

    vt = datetime.now(timezone.utc).replace(
        minute=0, second=0, microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")
    rat = _get(f"{args.base}/api/weather/spot-ratings?bbox=-180,-70,180,80"
               f"&valid_time={vt}&limit={args.limit}")
    spots = rat.get("spots") or []
    if not spots or rat.get("source") == "disabled":
        raise SystemExit("VOID: no spots served (or ratings disabled) — nothing to measure.")
    print(f"served n={len(spots)}  source={rat.get('source')}  valid_time={vt}")

    floored = [s for s in spots
               if s.get("limiter") == "swell_exposure"
               and isinstance(s.get("limiter_f"), (int, float)) and s["limiter_f"] <= FLOOR + 1e-4]
    control = [s for s in spots if s.get("limiter") != "swell_exposure"]
    if not floored:
        raise SystemExit("VOID: nothing is floored in this viewport — the question is undefined.")
    print(f"floored by swell_exposure at {FLOOR}: {len(floored)} = "
          f"{100 * len(floored) / len(spots):.1f}% of the sample")

    def wave_dir(s):
        # ⚠️ layer=waves, matching `spot_ratings.py`'s own resolve_point call. Not swell_1.
        try:
            d = _get(f"{args.base}/api/weather/point?model=GFS&domain=marine&layer=waves"
                     f"&lat={s['latitude']}&lng={s['longitude']}&valid_time={vt}", timeout=60)
            return (d.get("point") or d).get("direction")
        except Exception:
            return None

    def rows_for(group, cap):
        sample = group[:cap]
        with ThreadPoolExecutor(max_workers=8) as ex:
            dirs = list(ex.map(wave_dir, sample))
        out = []
        for s, sd in zip(sample, dirs):
            g = resolve_surf_geometry(float(s["latitude"]), float(s["longitude"]))
            if sd is None or g.shore_normal_deg is None:
                continue
            dth = _angular(sd, g.shore_normal_deg)
            out.append({"name": s["name"], "dtheta": round(dth, 1),
                        "past_90": round(dth - 90.0, 1), "normal": g.shore_normal_deg,
                        "wave_dir": sd, "src": g.shore_normal_src, "score": s.get("score")})
        return out, len(sample)

    def report(rows, n_asked, label):
        print(f"\n=== {label}: {len(rows)}/{n_asked} resolved ===")
        if not rows:
            print("  VOID — nothing resolved")
            return
        v = [r["past_90"] for r in rows]
        print(f"  dtheta - 90 :  min {min(v):7.1f}   p25 {_pctl(v,25):7.1f}   "
              f"MEDIAN {_pctl(v,50):7.1f}   p75 {_pctl(v,75):7.1f}   max {max(v):7.1f}")
        for t in (5, PLAUSIBLE_BEARING_ERR_DEG, 25, 45):
            share = 100 * sum(1 for x in v if x <= t) / len(v)
            mark = "  <- a plausible bearing fix reaches only these" if t == PLAUSIBLE_BEARING_ERR_DEG else ""
            print(f"      dtheta-90 <= {t:4.0f} deg : {share:5.1f}%{mark}")

    fl, n_fl = rows_for(floored, args.max_floored)
    ct, n_ct = rows_for(control, args.max_control)
    report(fl, n_fl, f"FLOORED (limiter=swell_exposure, f={FLOOR})")
    report(ct, n_ct, "CONTROL (not floored - must be dtheta < 90)")

    # ★ THE CONTROL NEEDS A TOLERANCE, AND THE TOLERANCE IS THE WHOLE POINT.
    # The served ratings are PRECOMPUTED; this probe re-queries the point lane live, so the two can
    # land on different model runs and a spot sitting within a degree or two of dtheta = 90 can
    # legitimately fall on opposite sides in the two frames. A binary "any violation = broken"
    # therefore condemns the instrument on ordinary frame drift (measured: one control at +1.5).
    # A violation DEEP past the boundary is a different animal — that is a convention or frame
    # error, and no amount of run drift explains it.
    near, deep = [], []
    for r in ct:
        if r["past_90"] > 0:
            (deep if r["past_90"] > FRAME_DRIFT_TOL_DEG else near).append(r)
    print(f"\n  CONTROL CHECK: {len(deep)}/{len(ct)} non-floored spots are MORE than "
          f"{FRAME_DRIFT_TOL_DEG:.0f} deg past the boundary -> "
          f"{'PROBE IS SOUND' if not deep else 'PROBE MAY BE MEASURING ITS OWN FRAME ERROR'}")
    if near:
        print(f"    ({len(near)} within {FRAME_DRIFT_TOL_DEG:.0f} deg of the boundary — "
              f"precompute-vs-live run drift, not a frame error)")
    impossible = [r for r in fl if r["past_90"] < 0]
    print(f"  RESIDUAL: {len(impossible)}/{len(fl)} floored spots recompute to dtheta < 90 — same "
          f"cause. Quote the SHAPE of the distribution, never a third decimal.")

    if fl:
        print("\n  --- floored, closest to the boundary first ---")
        for r in sorted(fl, key=lambda x: x["past_90"])[:8]:
            print(f"    {r['name'][:30]:30s} normal {r['normal']:6.1f}  wave {r['wave_dir']:6.1f}"
                  f"  dtheta {r['dtheta']:6.1f} ({r['past_90']:+6.1f} past floor)  {r['src']}")

    if args.json:
        json.dump({"valid_time": vt, "n_served": len(spots), "floored": fl, "control": ct},
                  open(args.json, "w", encoding="utf-8"), indent=1)
        print(f"\nwrote {args.json}")


if __name__ == "__main__":
    main()
