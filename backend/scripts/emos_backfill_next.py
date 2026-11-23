"""emos_backfill_next.py - which monthly slice the scheduled EMOS backfill collects next. Standard library only (it runs as
`python3 -I -S` in the keyed plan job, beside emos_bucket_io.py, and reads only that script's existing_runs.json listing).

WHY: David, 2026-11-23 (director session): "Recover + backfill (Recommended)" = backfill the wind EMOS record one month per
day, off-peak, through 2026-10, without anyone dispatching 16 slices by hand.

THE RULE (the cursor is the stored record itself: no extra object, nothing to drift):
  next month = the month AFTER the newest month in [first, last] that has at least one stored run; `first` if none does.
  Past `last` -> nothing to do (go=false): the schedule then no-ops every day.
  Days a slice dropped (503s) are never revisited, as with every manual slice (recorded, never filled).
  A slice that stores NO run leaves the cursor where it was, so the next day retries it; the workflow fails that run loudly,
  so a month that keeps storing nothing shows as a red run every day instead of passing quietly.
  REFUSES (exit 2) when the fetch looks unread: no frozen stations file, or no stored run BEFORE `first` (June 2025 is
  stored). A rejected key lists nothing (2026-11-19: HTTP 401 read as "absent"), which would otherwise restart the backfill.

  python3 -I -S emos_backfill_next.py --existing D/existing_runs.json --stations D/emos_stations.json --first 2025-07 --last 2026-10
prints `go=true|false`, `start=YYYY-MM-DD`, `end=YYYY-MM-DD`, `month=YYYY-MM` (and appends them to $GITHUB_OUTPUT when set).
"""
from __future__ import annotations

import argparse
import calendar
import json
import os
import sys


def _ym(s):
    y, m = s.split("-")
    return int(y), int(m)


def _next(y, m):
    return (y + 1, 1) if m == 12 else (y, m + 1)


def stored_months(names):
    """{(y, m)} of the stored run files (`YYYYMMDDHH.npz`); anything else is ignored."""
    out = set()
    for n in names:
        base = n.rsplit("/", 1)[-1]
        if base.endswith(".npz") and len(base) == 14 and base[:10].isdigit():
            out.add((int(base[:4]), int(base[4:6])))
    return out


class Unread(RuntimeError):
    pass


def plan(names, first, last, stations_present=True):
    lo, hi = _ym(first), _ym(last)
    if not stations_present or not any(ym < lo for ym in stored_months(names)):
        raise Unread("the stored-state fetch looks unread (no stations file, or no run before the range): refusing to plan")
    have = [ym for ym in stored_months(names) if lo <= ym <= hi]
    y, m = _next(*max(have)) if have else lo
    if (y, m) > hi:
        return {"go": "false", "start": "", "end": "", "month": ""}
    return {"go": "true", "start": f"{y:04d}-{m:02d}-01", "end": f"{y:04d}-{m:02d}-{calendar.monthrange(y, m)[1]:02d}",
            "month": f"{y:04d}-{m:02d}"}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--existing", required=True)
    ap.add_argument("--first", required=True)
    ap.add_argument("--last", required=True)
    ap.add_argument("--stations", required=True, help="the fetched emos_stations.json (must exist)")
    a = ap.parse_args(argv)
    names = json.load(open(a.existing)) if os.path.exists(a.existing) else None
    if names is None:
        raise SystemExit("no existing_runs.json: the stored-state fetch did not run")
    try:
        p = plan(names, a.first, a.last, os.path.exists(a.stations))
    except Unread as e:
        print(f"REFUSED: {e}")
        return 2
    lines = [f"{k}={v}" for k, v in p.items()]
    print("\n".join(lines))
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a") as fh:
            fh.write("\n".join(lines) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
