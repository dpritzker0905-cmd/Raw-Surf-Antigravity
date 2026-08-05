"""Is the permanent forecast<->buoy history STILL GROWING, and how far is it from a per-site fit?

WHY THIS EXISTS (2026-08-05)
----------------------------
The largest uncancelled error in the displayed surf height is that the offshore input COMPRESSES:
measured over 6,274 hot-archive rows / 60 buoys, +0.387 m at 0-0.5 m and -0.409 m at 2.5-10 m,
while the aggregate (+0.015 m) hides all of it.

The obvious remedy -- a global quantile map -- was BUILT, and the repo's own fitter REFUSES it:

    2 of 5 bands REGRESS on MAE, and 57.7% of residual variance is BETWEEN-BUOY.
    VERDICT: NO-GO for a global map. The defect is WHERE you are, not a global curve.

The prescribed path is therefore a PER-SITE correction, and that is gated on one resource: the
append-only monthly history under `calibration/history/residuals-YYYY-MM.json`. Measured today, the
bands with the LARGEST bias have only 3 buoys deep enough to fit, and they accrue slowly because
big seas are rare. So the fix is not blocked on cleverness; it is blocked on ACCRUAL.

    *** AND NOTHING WATCHED THE ACCRUAL. ***

`test_buoy_residual_retention.py` tests the roll-up LOGIC in isolation. No CI job and no monitor
read the history objects, so if the roll-up silently stopped, the only path to correcting the
largest height error would stop with it and we would find out in months. That is the same shape as
every reach defect this codebase keeps producing: the mechanism exists, is tested, and nothing
verifies that it RUNS.

WHAT THIS REPORTS
-----------------
  * every history segment, its row count and its age
  * per-band, per-buoy readiness against MIN_ROWS_TO_FIT -- i.e. how close a per-site fit is
  * the accrual rate, and whether the newest segment is being updated at all

⚠️ TWO SCHEMAS FOR THE SAME DATA. The hot archive nests the comparison under `residual`; the
history segments are FLAT (`buoy_wvht_m` at top level). Read both -- assuming one silently reports
zero rows, which is exactly how this script's first draft reported 0/0 across every band.

Usage (from backend/):
  python scripts/residual_accrual_census.py                  # report
  python scripts/residual_accrual_census.py --fail-on-stall  # exit 1 if the history stopped growing

Credentials: production Supabase via RENDER_API_KEY in backend/.env, the same path as
local_size_gonogo.py -- backend/.env's own SUPABASE_* point at DEV, which holds no archive.
"""
import argparse
import collections
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.weather_pipeline.buoy_calibration import (  # noqa: E402
    HEIGHT_BANDS, MIN_ROWS_TO_FIT,
)

HISTORY_PREFIX = "calibration/history/"
# A roll-up runs once per UTC day. Two full days with no growth is a stall, not a missed window.
STALL_HOURS = 48.0


def _observed(entry):
    """The buoy height, from EITHER schema. Returns None when the row carries no observation."""
    v = entry.get("buoy_wvht_m")
    if v is None:
        v = (entry.get("residual") or {}).get("buoy_wvht_m")
    return v


def _band_of(obs):
    for lo, hi in HEIGHT_BANDS:
        if lo <= obs < hi:
            return (lo, hi)
    return None


def readiness(rows):
    """buoys with >= MIN_ROWS_TO_FIT rows IN a band -- the per-site fit precondition."""
    per = collections.defaultdict(collections.Counter)
    used = 0
    for e in rows:
        obs, bid = _observed(e), e.get("buoy_id")
        if obs is None or bid is None:
            continue
        b = _band_of(obs)
        if b:
            per[bid][b] += 1
            used += 1
    return per, used


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--fail-on-stall", action="store_true",
                    help="exit 1 when the newest history segment has not grown in %g h" % STALL_HOURS)
    args = ap.parse_args(argv)

    import requests
    from scripts.local_size_gonogo import _prod_credentials

    session = requests.Session()
    url, svc, _env = _prod_credentials(session)
    hdr = {"Authorization": "Bearer " + svc, "apikey": svc}

    listing = session.post(url + "/storage/v1/object/list/weather-products", headers=hdr,
                           json={"prefix": HISTORY_PREFIX, "limit": 200}, timeout=90)
    objs = listing.json() if listing.status_code == 200 else []
    # ★ REFUSE rather than report a confident zero -- an empty listing and a broken credential
    #   look identical from here, and reporting "0 segments" would read as "retention is dead".
    if not objs:
        print("REFUSING TO REPORT: the history prefix listed 0 objects. That is either a dead "
              "roll-up or a credential/permission failure, and this script cannot tell them "
              "apart. Check `calibration/history/` by hand before believing retention stopped.")
        return 2

    now = datetime.now(timezone.utc)
    rows, newest_age = [], None
    print("history segments under %s" % HISTORY_PREFIX)
    for o in sorted(objs, key=lambda x: x.get("name", "")):
        name = o.get("name")
        got = session.get(url + "/storage/v1/object/weather-products/" + HISTORY_PREFIX + name,
                          headers=hdr, timeout=180)
        seg = got.json() if got.status_code == 200 else []
        seg = seg if isinstance(seg, list) else []
        rows += seg
        upd = (o.get("updated_at") or "")[:19]
        age_h = None
        if upd:
            try:
                age_h = (now - datetime.fromisoformat(upd).replace(tzinfo=timezone.utc)).total_seconds() / 3600
            except ValueError:
                age_h = None
            if newest_age is None or (age_h is not None and age_h < newest_age):
                newest_age = age_h
        print("  %-30s %6d rows   updated %s (%s)"
              % (name, len(seg), upd or "?",
                 ("%.1f h ago" % age_h) if age_h is not None else "age unknown"))

    per, used = readiness(rows)
    print("\n  TOTAL %d rows, %d usable, %d buoys" % (len(rows), used, len(per)))
    if used == 0 and rows:
        print("  REFUSING TO REPORT readiness: %d rows carry no parseable observation -- the "
              "schema changed. Both known shapes are handled; a third has appeared." % len(rows))
        return 2

    print("\n  PER-SITE FIT READINESS (needs >= %d rows IN a band, per buoy)" % MIN_ROWS_TO_FIT)
    print("  %-14s %8s %8s" % ("band", "ready", "has any"))
    for band in HEIGHT_BANDS:
        ready = sum(1 for b in per if per[b][band] >= MIN_ROWS_TO_FIT)
        anyb = sum(1 for b in per if per[b][band] > 0)
        print("  %-14s %8d %8d" % ("%.1f-%.1f m" % band, ready, anyb))
    print("\n  ⚠ The bands with the LARGEST bias (0-0.5 m at +0.387, 2.5-10 m at -0.409) are the")
    print("    slowest to fill, because those sea states are rare. Readiness there is the gate.")

    stalled = newest_age is not None and newest_age > STALL_HOURS
    if stalled:
        print("\n::error::RESIDUAL ACCRUAL STALLED — newest history segment last updated %.1f h ago "
              "(> %g h). The daily roll-up is not running. Every day not retained is "
              "UNRECOVERABLE, and the per-site height correction is gated on this."
              % (newest_age, STALL_HOURS))
        if args.fail_on_stall:
            return 1
    else:
        print("\n  accrual OK — newest segment updated %s"
              % (("%.1f h ago" % newest_age) if newest_age is not None else "at an unknown time"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
