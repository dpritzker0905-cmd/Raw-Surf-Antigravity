"""directional_conflict_reach_census.py — does the size/quality contradiction REACH the user?

THE QUESTION (MASTER-AUDIT-2.0 §2, the arc's #1 critical): one physical quantity — how much swell
energy is aimed at this coast — is modelled TWICE with floors 5.95x apart (quality `swell_exposure`
floors at 0.100, height `_height_exposure_factor` at 0.595). `dd972351` shipped a
`directional_conflict` disclosure so a payload SAYS SO when the two contradict. That disclosure
landed on `sim_rating` only. This census asks whether the surfaces a user actually reads — the map
glyphs served by `/spot-ratings` — carry it too, and on how many spots it WOULD bind.

WHY A LOWER BOUND, STATED HONESTLY: `/spot-ratings` publishes `limiter` (the ARGMIN factor) and
`limiter_f`, not the swell bearing. A spot can sit on the exposure floor while some OTHER factor is
lower still, in which case `limiter` names that other factor and this census cannot see it. So the
floor count here UNDERCOUNTS the true binding population, and the miss is one-directional. Spots in
the 75.7-90 deg band bind too (ratio 1.5..3.54) and are likewise invisible. Quote this as ">=", never
as "=".

THE ARITHMETIC IT IS COUNTING (measured, not asserted — see the table this script prints):
  the ratio h^2/q crosses DIRECTIONAL_CONFLICT_MIN=1.5 at dtheta = 75.73 deg, and SATURATES at
  3.54x for every dtheta >= 90 deg, because past 90 deg BOTH factors are flat on their floors.

CONTROLS (either can exonerate the suspect):
  C1 the limiter field must show MORE THAN ONE value across the population, else we are reading a
     constant rather than a distribution and the census means nothing.
  C2 `model_agreement` — a sibling disclosure shipped in the SAME arc (`dfaebc9f`) — must be PRESENT
     on the served spots. If it is absent too, the finding is "this payload carries no disclosures",
     which is a different (and smaller) claim than "this one disclosure was missed".
  Both are asserted, not merely printed: a census that cannot fail has tested nothing.

Usage (from backend/):
  python scripts/directional_conflict_reach_census.py
  python scripts/directional_conflict_reach_census.py --model EURO
"""
import argparse
import collections
import datetime
import json
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

BASE = "https://raw-surf-antigravity.onrender.com/api/weather/spot-ratings"
EXPOSURE_FLOOR = 0.1
MIN_SPOTS = 200          # below this a bbox union is a viewport, not a distribution

# Union of viewports: /spot-ratings caps at limit=200 against ~1,773 spots, so ONE bbox is a
# viewport sample whose limiter histogram swings wildly by region (measured 2026-08-03:
# size_gate 21%->68% between regions). The union is the only honest population.
REGIONS = {
    "NAM-W": "-130,25,-105,50", "NAM-E": "-85,24,-60,46", "EUR-ATL": "-15,35,5,60",
    "OCE": "140,-45,180,-10", "ASIA-SE": "95,-10,145,25", "LATAM-PAC": "-95,-40,-68,15",
    "AFR": "-20,-38,20,15", "PAC-IS": "-180,-25,-130,25",
}


def _fetch(job):
    bbox, vt, model = job
    url = f"{BASE}?bbox={bbox}&valid_time={vt}&model={model}&limit=200"
    try:
        with urllib.request.urlopen(url, timeout=180) as r:
            return json.loads(r.read())
    except Exception as e:                                        # noqa: BLE001
        return {"_err": str(e)}


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", default="GFS", choices=["GFS", "ICON", "EURO"])
    args = ap.parse_args()

    vt = (datetime.datetime.now(datetime.UTC)
          .replace(minute=0, second=0, microsecond=0).strftime("%Y-%m-%dT%H:00:00Z"))

    # --- the arithmetic, from the SHIPPED functions (never from a docstring) ---------------
    from services.weather_pipeline.surf_rating import swell_exposure
    from services.weather_pipeline.surf_transform import _height_exposure_factor
    from services.weather_pipeline.wave_physics import DIRECTIONAL_CONFLICT_MIN
    lo, hi = 0.0, 180.0
    for _ in range(60):
        mid = (lo + hi) / 2.0
        q, h = swell_exposure(0.0, mid), _height_exposure_factor(0.0, mid)
        if (h * h) / q < DIRECTIONAL_CONFLICT_MIN:
            lo = mid
        else:
            hi = mid
    q90, h90 = swell_exposure(0.0, 90.0), _height_exposure_factor(0.0, 90.0)
    print(f"binding threshold dtheta = {hi:.2f} deg   saturation ratio = {(h90*h90)/q90:.2f}x "
          f"(q={q90:.3f} h={h90:.3f} h^2={h90*h90:.3f})")

    jobs = [(bb, vt, args.model) for bb in REGIONS.values()]
    with ThreadPoolExecutor(max_workers=8) as ex:
        payloads = list(ex.map(_fetch, jobs))

    spots, served, errors = {}, set(), 0
    for p in payloads:
        if "_err" in p:
            errors += 1
            continue
        served.add(p.get("served_valid_time"))
        for row in p.get("spots") or []:
            sid = row.get("spot_id")
            if sid and sid not in spots:
                spots[sid] = row

    n = len(spots)
    print(f"requested {vt}  served frames {sorted(x for x in served if x)}  "
          f"fetch errors {errors}/{len(jobs)}  distinct spots {n}")

    if n < MIN_SPOTS:
        print(f"VOID: {n} spots < {MIN_SPOTS} — a viewport, not a distribution. Nothing claimed.")
        return 1

    limiters = collections.Counter(r.get("limiter") or "none" for r in spots.values())
    at_floor = [r for r in spots.values()
                if r.get("limiter") == "swell_exposure"
                and isinstance(r.get("limiter_f"), (int, float))
                and abs(r["limiter_f"] - EXPOSURE_FLOOR) < 1e-6]
    has_conflict = [r for r in spots.values() if r.get("directional_conflict")]
    has_agreement = [r for r in spots.values() if r.get("model_agreement")]

    print("\nlimiter histogram (argmin factor):")
    for k, v in limiters.most_common():
        print(f"  {k:<22} {v:>4}  {100.0*v/n:5.1f}%")

    print(f"\nAT THE EXPOSURE FLOOR (limiter=swell_exposure, f=0.100): {len(at_floor)}/{n} = "
          f"{100.0*len(at_floor)/n:.1f}%  -- a LOWER BOUND on where the conflict binds")
    print(f"CARRYING `directional_conflict`: {len(has_conflict)}/{n}")
    print(f"CARRYING `model_agreement`    : {len(has_agreement)}/{n}")

    # --- controls: assert, never merely print ------------------------------------------------
    failures = []
    if len(limiters) < 2:
        failures.append("C1 the limiter field is a CONSTANT across the population — reading noise")
    if not has_agreement:
        failures.append("C2 `model_agreement` is ALSO absent — the claim is 'this payload carries "
                        "no disclosures', not 'this disclosure was missed'")
    if failures:
        print("\n*** CONTROL FAILED — no finding claimed ***")
        for f in failures:
            print(f"  {f}")
        return 1
    print(f"\nCONTROL OK: C1 {len(limiters)} distinct limiters (a distribution); "
          f"C2 model_agreement present on {len(has_agreement)}/{n} (the payload DOES carry "
          f"disclosures shipped in this arc)")

    if at_floor:
        w = sorted(at_floor, key=lambda r: -(r.get("surf_height_m") or 0))[:5]
        print("\nworst failing instances (biggest height served while exposure says 'blocked'):")
        for r in w:
            print(f"  {r.get('name','?')[:34]:<34} {(r.get('surf_height_m') or 0)*3.28084:5.1f} ft  "
                  f"score {r.get('score')}  {r.get('level')}  geom={r.get('geometry_readiness')}  "
                  f"conflict={'YES' if r.get('directional_conflict') else 'ABSENT'}")

    verdict = "REACHES the user" if has_conflict else "DOES NOT REACH the user"
    print(f"\nVERDICT: the size/quality contradiction {verdict} on /spot-ratings.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
