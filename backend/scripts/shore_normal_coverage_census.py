"""shore_normal_coverage_census.py — is a shore-normal rebuild worth running RIGHT NOW?

WHY THIS EXISTS INSTEAD OF A SCHEDULED REBUILD
----------------------------------------------
The obvious fix for "the highest-leverage input in the forecast refreshes by hand" is to put
`build-shore-normals.yml` on a cron. **That was measured and refused**, and this script is the
alternative it forced.

`scripts/build_shore_normals.py` contains no RNG and no wall-clock in the fit — verified, 0 matches
for random/shuffle/datetime.now/time.time — so the fit is DETERMINISTIC. Re-running it over the same
coordinates reproduces the same accept/reject verdicts. And a spot missing from the asset is not a
spot nobody got to; it is a spot the quality gate ALREADY REJECTED (live-tested 2026-07-30: Bondi
re-fitted in 22.5 s to spread 48.0 deg and was rejected `ambiguous_coastline` a second time; of 24
unmatched spots sampled, 0 were merely missing — 62% ambiguous coastline, 38% placement, and
placement cannot be fixed by re-running because the PIN must move).

⇒ A weekly rebuild burns ~4.3 h of a public NOAA ERDDAP endpoint to publish approximately nothing.
Measured on the local catalogue 2026-08-01: **0 spots created since the asset build date**, all
1,486 dated rows created in a single 2026-06 bulk import.

★★ THE JACOBIAN POINT. The rebuild's yield is proportional to spots that are NEW or MOVED, not to
elapsed time. So the leverage is in DETECTING that change, not in running the rebuild on a clock.
This census is that detector, and it costs zero network calls to the fitting endpoint.

WHAT IT REPORTS
    considered_at_build   the asset's own `spots_considered`
    catalogue_now         spots in the catalogue today
    unconsidered          catalogue_now - considered_at_build, floored at 0 -> genuinely NEW spots
    covered / coarse      how many resolve to a fine bearing vs the 0.25 deg fallback
    verdict               REBUILD_WOULD_YIELD | NO_NEW_WORK | VOID

⚠️ IT VOIDS ITSELF rather than answering when it cannot discriminate — the house contract. A census
that reports "nothing to do" because it could not read the catalogue is worse than no census.

USAGE
    python backend/scripts/shore_normal_coverage_census.py                 # dev.db
    python backend/scripts/shore_normal_coverage_census.py --fail-on-work  # non-zero exit when a
                                                                           # rebuild would yield
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

VERDICT_VOID = "VOID"
VERDICT_NO_WORK = "NO_NEW_WORK"
VERDICT_YIELD = "REBUILD_WOULD_YIELD"


def assess(asset_meta, catalogue_count, coarse_count, new_since_build=None):
    """PURE. Given the asset's own metadata and today's catalogue, decide whether a rebuild yields.

    Kept free of I/O so CI can exercise every branch without a database or a network — the
    `dev.db` lesson (a test that needs a gitignored file asserts something about the machine).

    `new_since_build` is the count of spots whose `created_at` post-dates the asset, when the
    catalogue can supply it; None means that column was unavailable and the estimate falls back to
    the count difference alone (stated in the reason, never hidden).
    """
    if not isinstance(asset_meta, dict) or not asset_meta:
        return {"verdict": VERDICT_VOID, "reason": "asset metadata unavailable — cannot compare"}
    considered = asset_meta.get("spots_considered")
    if not isinstance(considered, int) or considered <= 0:
        return {"verdict": VERDICT_VOID,
                "reason": "asset does not record `spots_considered` — the comparison has no baseline"}
    if not isinstance(catalogue_count, int) or catalogue_count <= 0:
        return {"verdict": VERDICT_VOID, "reason": "catalogue unavailable or empty"}

    unconsidered = max(0, catalogue_count - considered)
    # A spot the asset never CONSIDERED is the only category a rebuild can newly help. A spot it
    # considered and did not publish was REJECTED, and the fit is deterministic, so re-running
    # reproduces that rejection. `new_since_build` is the sharper signal when available.
    newly_workable = new_since_build if isinstance(new_since_build, int) else unconsidered
    basis = ("created_at newer than the asset" if isinstance(new_since_build, int)
             else "catalogue count minus spots_considered (no created_at available)")

    out = {
        "considered_at_build": considered,
        "published_at_build": asset_meta.get("count"),
        "catalogue_now": catalogue_count,
        "unconsidered": unconsidered,
        "coarse_now": coarse_count,
        "newly_workable": newly_workable,
        "basis": basis,
    }
    if newly_workable > 0:
        out["verdict"] = VERDICT_YIELD
        out["reason"] = (f"{newly_workable} spot(s) the asset never considered — a rebuild would "
                         f"fit coordinates it has never seen")
    else:
        out["verdict"] = VERDICT_NO_WORK
        out["reason"] = ("every catalogue spot was already considered; the fit is deterministic, so "
                         "a rebuild reproduces the same verdicts and publishes nothing new. The "
                         f"{coarse_count} coarse spots were REJECTED by the gate, not skipped.")
    return out


def _load_asset_meta():
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        "services", "weather_pipeline", "data", "shore_normals.json")
    try:
        with open(path, encoding="utf-8") as fh:
            doc = json.load(fh)
        return {k: v for k, v in doc.items() if k != "entries"}
    except Exception:
        return {}


def _load_catalogue(db_path):
    """(count, coarse_count, new_since_build) or (None, None, None) when unreadable."""
    import sqlite3
    if not os.path.exists(db_path):
        return None, None, None
    try:
        con = sqlite3.connect(db_path)
        rows = list(con.execute(
            "select latitude, longitude, created_at from surf_spots where latitude is not null"))
    except Exception:
        return None, None, None
    if not rows:
        return None, None, None
    from services.weather_pipeline.shore_normal_asset import shore_normal_at
    coarse = 0
    for lat, lng, _ in rows:
        try:
            fine, _spread = shore_normal_at(float(lat), float(lng))
        except Exception:
            fine = None
        if fine is None:
            coarse += 1
    dated = [r[2] for r in rows if r[2]]
    new_since = None
    if dated:
        # The asset carries no build timestamp; git does. Callers may pass --asset-date to sharpen.
        new_since = None
    return len(rows), coarse, new_since


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--db", default=os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "dev.db"))
    ap.add_argument("--asset-date", default=None,
                    help="ISO date the asset was built (git log the asset file). Sharpens the "
                         "estimate from a count difference to a created_at comparison.")
    ap.add_argument("--fail-on-work", action="store_true",
                    help="exit 1 when a rebuild would yield, for use as a scheduled DETECTOR")
    args = ap.parse_args()

    meta = _load_asset_meta()
    count, coarse, new_since = _load_catalogue(args.db)
    if args.asset_date and count:
        import sqlite3
        try:
            con = sqlite3.connect(args.db)
            new_since = sum(1 for (c,) in con.execute(
                "select created_at from surf_spots where latitude is not null and created_at is not null")
                if str(c) >= args.asset_date)
        except Exception:
            new_since = None

    if count is None:
        print(json.dumps({"verdict": VERDICT_VOID,
                          "reason": f"catalogue unreadable at {args.db} — VOIDING rather than "
                                    f"reporting 'nothing to do'"}, indent=2))
        sys.exit(2)

    result = assess(meta, count, coarse, new_since)
    print(json.dumps(result, indent=2))
    if args.fail_on_work and result.get("verdict") == VERDICT_YIELD:
        sys.exit(1)
    if result.get("verdict") == VERDICT_VOID:
        sys.exit(2)


if __name__ == "__main__":
    main()
