"""Are the raster frame sets that are switched ON actually being refreshed? (2026-11-16; the director: a failed raster publish that
silently keeps the old index must be visible on the data-health monitor.)

A raster publish step runs with continue-on-error, and every failure keeps the published index: an unreachable source (DWD's
0.125-degree weights file, ECMWF, NOAA), a refused coverage, a changed GRIB packing that trips a grid check. The map keeps drawing
the last good run and nothing pages. This reads the PUBLIC latest.json (the same object the client reads; no key) and, for every
raster set whose repo variable is '1', checks that the set is listed and that its run is younger than the set's stale bound.

Usage (data-health-monitor.yml): RASTER_VARS_JSON='${{ toJSON(vars) }}' python scripts/raster_set_freshness.py --base <public frames
URL> [--fail-on-stale]. The public URL is built from SUPABASE_URL in the workflow (by name; never written here).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from services import frame_set as fs  # noqa: E402
from services import frame_set_raster as fsr  # noqa: E402

DEFAULT_STALE_H = 30.0     # 00/12Z (ICON, EURO) and 6-hourly (GFS) runs, published by pilots runs 3 times a day: 30 h = 2 missed runs


def expected_sets(repo_vars):
    """{set name: set key} for the raster sets whose own variable is '1' in the repo variables (default-on sets count too)."""
    out = {}
    for name, spec in fsr.SPECS.items():
        val = repo_vars.get(spec["env"])
        if val == "1" or (val is None and spec.get("default_on")):
            out[name] = fs.set_key(spec["target"])
    return out


def run_age_h(entry, now):
    run = (entry or {}).get("run")
    if not run:
        return None
    try:
        t = datetime.fromisoformat(str(run).replace("Z", "+00:00"))
    except ValueError:
        return None
    return (now - t).total_seconds() / 3600.0


def check(latest, repo_vars, now, stale_h=DEFAULT_STALE_H):
    """[(set name, key, verdict, detail)]; verdict ok | stale | missing."""
    sets = (latest or {}).get("sets") or {}
    rows = []
    for name, key in sorted(expected_sets(repo_vars).items()):
        entry = sets.get(key)
        if entry is None:
            rows.append((name, key, "missing", "switched on but never published"))
            continue
        age = run_age_h(entry, now)
        if age is None:
            rows.append((name, key, "stale", "no run time in latest.json"))
        elif age > stale_h:
            rows.append((name, key, "stale", f"run {entry.get('run')} is {age:.1f} h old (> {stale_h:.0f} h)"))
        else:
            rows.append((name, key, "ok", f"run {entry.get('run')}, {age:.1f} h old"))
    return rows


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--base", required=True, help="the public weather-frames URL (…/storage/v1/object/public/weather-frames)")
    ap.add_argument("--fail-on-stale", action="store_true")
    args = ap.parse_args(argv)
    repo_vars = json.loads(os.environ.get("RASTER_VARS_JSON") or "{}")
    stale_h = float(os.environ.get("RASTER_STALE_HOURS", DEFAULT_STALE_H))
    with urllib.request.urlopen(args.base.rstrip("/") + "/" + fs.LATEST, timeout=60) as r:
        latest = json.loads(r.read())
    rows = check(latest, repo_vars, datetime.now(timezone.utc), stale_h)
    for name, key, verdict, detail in rows:
        print(f"  {verdict:7s} {name:28s} {key:45s} {detail}")
        if verdict != "ok":
            print(f"::error title=Raster set {name} not refreshed::{key}: {detail}. A failed publish keeps the old index; "
                  f"read that set's pilots step log.")
    if not rows:
        print("  (no raster set is switched on)")
    bad = [r for r in rows if r[2] != "ok"]
    return 1 if (bad and args.fail_on_stale) else 0


if __name__ == "__main__":
    sys.exit(main())
