#!/usr/bin/env python3
"""Give newly-pinned spots their own geometry — the runnable half of `resolve_spot_geometry`.

    python scripts/resolve_new_spot_geometry.py --dry-run          # who needs geometry, no network
    python scripts/resolve_new_spot_geometry.py --limit 20         # fit up to 20 and publish
    python scripts/resolve_new_spot_geometry.py --spot "Pipeline"  # one named spot

WHY A SCRIPT AND NOT A SCHEDULER TICK
-------------------------------------
⛔ The app's APScheduler runs ON the FastAPI event loop. One ERDDAP round trip is ~22 s, so a
scheduled tick would freeze every request for that long — up to 279 s for a backlog. This is a
plain blocking program: run it from CI, a cron container, or by hand. It must never be imported
into an async handler and awaited.

⚠️ It is deliberately NOT wired into the ingest workflow yet. The right cadence and host for it is
an operational decision with a real cost (~22 s a spot against a public NOAA endpoint), and
`--dry-run` is here so that decision can be made from a measured backlog rather than a guess.

WHAT IT CANNOT DO
-----------------
Of 24 randomly sampled unmatched spots, ZERO were merely missing — every one had been DELIBERATELY
REJECTED by the quality gate: 62% `ambiguous_coastline`, 38% PLACEMENT (inland, >3 km from shore,
or in deep water). Re-running repairs NONE of the placement group. The pin has to move. That is why
`--dry-run` and the run summary both print the rejection REASONS: the reason is the actionable half,
and until now it existed only in a CI review CSV that never reached the product.
"""
import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.weather_pipeline import resolve_spot_geometry as R          # noqa: E402
from services.weather_pipeline import shore_normal_asset                  # noqa: E402
from services.weather_pipeline.spot_geometry_readiness import (           # noqa: E402
    assess_at, readiness_counts)


def fetch_spots():
    """The LIVE catalogue, via the same PostgREST read the build script uses. Never a local
    snapshot — `dev.db` has drifted to wrong COORDINATES (Bethune Beach was 7 km out), and a
    geometry fit taken at the wrong point is confidently wrong rather than missing."""
    base = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY")
    if not base or not key:
        raise SystemExit("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_KEY) are required")
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import build_shore_normals as b
    return b.fetch_spots(base, key)


def main():
    # ⚠️ NOT `description=__doc__`: this docstring carries ⛔/⚠️ and argparse renders help straight
    # to stdout, which is cp1252 on a Windows console — `--help` then dies with UnicodeEncodeError
    # before printing anything. An unreadable --help is a broken tool.
    ap = argparse.ArgumentParser(
        description="Fit and publish per-spot shore geometry for newly-pinned spots. "
                    "See the module docstring for why this is a script and not a scheduler tick.")
    ap.add_argument("--limit", type=int, default=R.MAX_PER_RUN,
                    help=f"max spots to FIT this run (default {R.MAX_PER_RUN}; ~22 s each)")
    ap.add_argument("--spot", help="resolve one spot by exact name")
    ap.add_argument("--dry-run", action="store_true",
                    help="report the backlog and readiness mix; NO network fitting")
    ap.add_argument("--no-persist", action="store_true",
                    help="keep results in memory only (they are lost when the process exits)")
    args = ap.parse_args()

    spots = fetch_spots()
    if args.spot:
        spots = [s for s in spots if (s.get("name") or "").strip().lower() == args.spot.strip().lower()]
        if not spots:
            raise SystemExit(f"no spot named {args.spot!r} in the live catalogue")

    # ── The zero-network half: who needs geometry at all, and what are they living on? ──
    needing = [s for s in spots if R.needs_geometry(s)]
    assessments = []
    for s in spots:
        if s.get("latitude") is None or s.get("longitude") is None:
            continue
        assessments.append(assess_at(float(s["latitude"]), float(s["longitude"])))
    print(f"catalogue        : {len(spots)} active spots")
    print(f"readiness        : {json.dumps(readiness_counts(assessments))}")
    print(f"need geometry    : {len(needing)}  ({100.0 * len(needing) / max(1, len(spots)):.1f}%)")
    if args.dry_run:
        for s in needing[:20]:
            a = assess_at(float(s["latitude"]), float(s["longitude"]))
            print(f"   {(s.get('name') or '?')[:34]:34s} {str(a.get('verdict')):9s} "
                  f"{', '.join(a.get('missing', []))}")
        if len(needing) > 20:
            print(f"   ... and {len(needing) - 20} more")
        print(f"\nDRY RUN — nothing fitted. ~{len(needing) * 22 / 60:.0f} min of ERDDAP to clear "
              f"this backlog sequentially.")
        return 0

    t0 = time.time()
    out = R.resolve_many(needing, limit=args.limit,
                         on_result=lambda r: print(
                             f"   {(r['name'] or '?')[:34]:34s} {r['status']:10s} "
                             f"{r['reason'] or ''}"))
    print(f"\ncounts           : {json.dumps(out['counts'])}")
    if out.get("reasons"):
        # ★ The REASON, not just the count: a placement rejection needs the pin moved and no amount
        # of re-running fixes it; an ambiguous coastline is simply hard geometry.
        print(f"rejection reasons: {json.dumps(out['reasons'], indent=18)}")
    print(f"elapsed          : {time.time() - t0:.0f}s")

    if out["counts"].get("published") and not args.no_persist:
        n = R.persist_overlay()
        print(f"overlay persisted: {n} entries -> {shore_normal_asset._OVERLAY}")
        print("⚠️  The overlay is a CACHE, not a source of record — an ephemeral filesystem loses "
              "it on redeploy\n    and those spots fall back to the coarse normal. Run the full "
              "build and commit the asset for a\n    durable fix; this closes the window until then.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
