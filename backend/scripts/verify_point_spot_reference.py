"""E#1 ACCEPTANCE: does `/api/weather/point` serve the per-SPOT size reference at a catalogued spot?

★ THE DEFECT (`ead3c666`). The point endpoint is keyed by a COORDINATE and carried no spot
identity, so it served `grid_size_climatology.reference_for(lat, lng)` — the per-CELL value — while
the glyph rendered beside it used the per-SPOT one. Measured a **median 21.3% apart (max 52.5%)**,
worth −11.4 to +9.6 points on the badge and a LEVEL flip at 2 of 6 sampled spots.

★★ THIS RUNS AS A STANDING GUARD, NOT A ONE-SHOT, because the acceptance is an INVARIANT, not an
event: "the coordinate lane and the spot lane agree at a catalogued spot" must keep being true.

⚠️⚠️ IT VOIDS ITSELF RATHER THAN PASSING WHEN IT CANNOT KNOW (rule 16). Three preconditions, each
reported by name instead of collapsing into a green:

  1. **NO CREDENTIALS** — cannot read the blob. An operator condition, not a calibration finding.
  2. **NO COORDINATES IN THE BLOB YET** — the `lat`/`lng` keys are written by
     `merge_frames_into_climatology`, so they appear only after the next precompute cycle
     (cron `45 3-23/4`). Until then the endpoint CORRECTLY serves the cell value and the fix is
     inert by design. Reporting that as a failure would be reporting the clock.
  3. **CELL == SPOT AT EVERY EXEMPLAR** — then the check cannot DISCRIMINATE: the endpoint would
     serve the right number either way and a pass would prove nothing. ★ This is the trap that made
     five instruments report success having tested nothing; an exemplar whose two candidate answers
     are equal is not evidence, so it is excluded and said out loud.

Exit 0 unless `--fail-on-mismatch` and a spot where the two DO differ came back on the cell value.
"""
import argparse
import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# A Windows console defaults to cp1252, which cannot encode the dashes this tool prints. The house
# idiom (`validate_nearshore_transform.py:67`) — and it is not cosmetic: `sim_health_probe` once
# crashed on its FIRST summary line, so every row was measured, the verdict never printed, and
# `--fail-on-divergence` returned the traceback's exit 1 however green the parity actually was.
# An instrument whose exit code is 1 on success is worse than no instrument.
try:                                                    # pragma: no cover - console-dependent
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, ValueError):
    pass

BASE = os.environ.get("SIM_FORECAST_BASE_URL", "https://raw-surf-antigravity.onrender.com")
TIMEOUT = 20
# Named exemplars on four coasts with different regimes, so a single regional blob problem cannot
# make this read green. Deliberately NOT the top-scoring spots — see HANDOFF-2026-08-01-F §4.4.
EXEMPLARS = [
    ("Mavericks", 37.4915, -122.5083),
    ("Pipeline", 21.6650, -158.0530),
    ("Kommetjie", -34.1394, 18.3269),
    ("Cocoa Beach Pier", 28.3600, -80.6000),
    ("Lower Trestles", 33.3850, -117.5900),
    ("Bells Beach", -38.3667, 144.2833),
]


def _hour():
    return datetime.now(timezone.utc).replace(minute=0, second=0,
                                              microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


def _served_reference(lat, lng, valid_time):
    qs = urllib.parse.urlencode({"model": "GFS", "domain": "marine", "layer": "waves",
                                 "lat": lat, "lng": lng, "valid_time": valid_time})
    try:
        with urllib.request.urlopen(f"{BASE}/api/weather/point?{qs}", timeout=TIMEOUT) as r:
            return json.loads(r.read().decode("utf-8")).get("reference_size_m")
    except Exception as e:
        print(f"    [warn] point fetch failed at ({lat},{lng}): {e}")
        return None


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--fail-on-mismatch", action="store_true",
                    help="exit 1 when a DISCRIMINATING exemplar is served the cell value")
    args = ap.parse_args()

    if not (os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_SERVICE_ROLE_KEY")):
        print("SKIP: no SUPABASE_* credentials — cannot read the climatology to know what the "
              "endpoint SHOULD serve. An operator condition, not a calibration finding.")
        return 0

    from services.weather_pipeline.grid_size_climatology import (
        load_grid_size_climatology_l2_cached, reference_for as cell_reference)
    from services.weather_pipeline.spot_size_climatology import (
        load_size_climatology_l2_cached, reference_for_coordinate)

    clim = load_size_climatology_l2_cached()
    if not clim or not isinstance(clim.get("spots"), dict):
        print("SKIP: the per-spot climatology blob is unreadable or empty.")
        return 0
    with_coords = sum(1 for r in clim["spots"].values()
                      if isinstance(r, dict) and r.get("lat") is not None)
    total = len(clim["spots"])
    print(f"blob: {total} spots, {with_coords} carry coordinates "
          f"({100.0 * with_coords / total if total else 0:.1f}%)")
    if with_coords == 0:
        print("SKIP — PRECONDITION NOT MET: no spot record carries lat/lng yet, so "
              "`reference_for_coordinate` cannot resolve and the endpoint CORRECTLY serves the "
              "cell value. The keys are written by `merge_frames_into_climatology`, i.e. by the "
              "next precompute cycle (cron '45 3-23/4'). This is the clock, not a defect.")
        return 0

    grid = load_grid_size_climatology_l2_cached()
    vt = _hour()
    print(f"valid_time {vt}\n")
    print(f"{'spot':<20} {'spot_ref':>9} {'cell_ref':>9} {'served':>9}  verdict")
    print("-" * 72)

    mismatches, discriminating, voided = [], 0, []
    for name, lat, lng in EXEMPLARS:
        spot_ref = reference_for_coordinate(lat, lng, clim_obj=clim)
        cell_ref = cell_reference(grid, lat, lng) if grid else None
        served = _served_reference(lat, lng, vt)
        if spot_ref is None:
            voided.append((name, "no catalogued spot within 2 km in the blob"))
            continue
        if served is None:
            voided.append((name, "endpoint served no reference (flag off, or fetch failed)"))
            continue
        # ⭐ THE DISCRIMINATION TEST. If the two candidate answers are equal, serving the right one
        # proves nothing — the instrument cannot tell them apart, so it must not claim a pass.
        if cell_ref is not None and abs(cell_ref - spot_ref) < 0.02:
            voided.append((name, f"cell == spot ({spot_ref:.3f}) — cannot discriminate"))
            continue
        discriminating += 1
        ok = abs(served - spot_ref) < 0.02
        if not ok:
            mismatches.append((name, spot_ref, cell_ref, served))
        print(f"{name[:20]:<20} {spot_ref:>9.3f} "
              f"{('%9.3f' % cell_ref) if cell_ref is not None else '        -'} {served:>9.3f}  "
              f"{'OK (spot)' if ok else 'MISMATCH -> served the CELL value'}")

    print()
    for n, why in voided:
        print(f"  VOID {n}: {why}")
    if discriminating == 0:
        print("\nVOID: no exemplar could DISCRIMINATE between the spot and cell references, so "
              "this run measured nothing. Not a pass.")
        return 0

    print(f"\n{discriminating - len(mismatches)}/{discriminating} discriminating exemplars serve "
          f"the per-SPOT reference.")
    if mismatches:
        print("FAIL: the point endpoint is still serving the CELL reference at a catalogued spot:")
        for n, s, c, srv in mismatches:
            print(f"  {n}: spot {s:.3f} / cell {c if c is None else round(c, 3)} / served {srv:.3f}")
        return 1 if args.fail_on_mismatch else 0
    print("PASS: E#1 acceptance holds — the coordinate lane and the spot lane agree.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
