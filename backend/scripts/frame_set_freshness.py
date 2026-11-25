"""frame_set_freshness.py - are the marine, wind and RATED static frame sets being refreshed? REPORT-ONLY (2026-11-24).

The raster sets have a freshness check (raster_set_freshness.py); the marine, wind and rated sets had none, and the
client has no age check of its own (inspection 2026-11-23, finding 5). A publish that fails keeps the old index, so
the map draws the last good run with no label.

This reads the PUBLIC `v1/latest.json` (the object the client reads; no key). It reports every non-raster set whose
RUN is older than its model's bound, and every rated set whose run trails the marine set it rates. It prints a
table for the step summary and an ::warning per family. It exits 0 unless --fail-on-stale; the monitor runs it
without the flag (report only).

First read (2026-11-24 03:10Z, 259 sets, 221 checked): GFS and ICON marine runs were 15.2 h old; GFS rated sets were
15.2-27.2 h old (median 21.2), trailing their own marine sets by up to 12 h.

Bounds (hours since the model's run time), from cycle + publication delay + our 2-4 h share (inspection item 10):
GFS 6-hourly 18 h; EURO / ICON / ECMWF_ENS 12-hourly 30 h; CMEMS daily 48 h; anything else 30 h. Override any
of them with FRAME_STALE_HOURS_<MODEL> (e.g. FRAME_STALE_HOURS_GFS=24).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request
from datetime import datetime, timezone

BOUNDS_H = {"GFS": 18.0, "EURO": 30.0, "ICON": 30.0, "ECMWF_ENS": 30.0, "CMEMS": 48.0}
DEFAULT_BOUND_H = 30.0
RATED = "_rated"
RETIRED = "partition_height_only"   # frame_set_rating.retired_record's `retired` tag: the only record exempt from staleness
RASTER_FAMILY = "weather"          # raster sets: raster_set_freshness.py owns them


def _age_h(iso, now):
    try:
        return (now - datetime.fromisoformat(str(iso).replace("Z", "+00:00"))).total_seconds() / 3600.0
    except (TypeError, ValueError):
        return None


def bound_h(model: str, env=None) -> float:
    env = os.environ if env is None else env
    try:
        return float(env.get(f"FRAME_STALE_HOURS_{model}", BOUNDS_H.get(model, DEFAULT_BOUND_H)))
    except ValueError:
        return BOUNDS_H.get(model, DEFAULT_BOUND_H)


def family(key: str) -> str:
    parts = key.split("/")
    if key.endswith(RATED):
        return "rated"
    return parts[1] if len(parts) > 1 else "?"


def check(latest: dict, now: datetime, env=None) -> list:
    """[{key, model, family, run_age_h, bound_h, verdict, behind_h}] for every non-raster set. verdict: ok | stale |
    no_run | empty (a RETIRED rated record, frame_set_rating.retired_record; never stale; any other empty record reads
    no_run). behind_h: for a rated set, how far its run trails the marine set it rates (None when not comparable)."""
    sets = (latest or {}).get("sets") or {}
    rows = []
    for key, e in sorted(sets.items()):
        fam = family(key)
        if fam == RASTER_FAMILY:
            continue
        model = key.split("/")[0]
        if (e or {}).get("retired") == RETIRED:   # a rated set the publisher retired (frame_set_rating.retired_record): never stale
            rows.append({"key": key, "model": model, "family": fam, "run_age_h": None, "bound_h": bound_h(model, env),
                         "verdict": "empty", "behind_h": None})
            continue
        age, bound = _age_h((e or {}).get("run"), now), bound_h(model, env)
        behind = None
        if fam == "rated":
            sib = sets.get(key[: -len(RATED)])
            sib_age = _age_h((sib or {}).get("run"), now)
            if age is not None and sib_age is not None:
                behind = round(age - sib_age, 1)
        verdict = "no_run" if age is None else ("stale" if age > bound else "ok")
        rows.append({"key": key, "model": model, "family": fam, "run_age_h": None if age is None else round(age, 1),
                     "bound_h": bound, "verdict": verdict, "behind_h": behind})
    return rows


BAD = ("stale", "no_run")   # "empty" = a RETIRED rated record only; a bundle's explicit empty still reads no_run, as before


def summary(rows: list) -> list:
    """Markdown lines: one line per (model, family), then each stale or lagging set (at most 40)."""
    by = {}
    for r in rows:
        by.setdefault((r["model"], r["family"]), []).append(r)
    out = ["| model | family | sets | stale | empty (retired) | oldest run (h) | bound (h) | rated behind marine, max (h) |",
           "|---|---|---|---|---|---|---|---|"]
    for (m, f), rs in sorted(by.items()):
        ages = [r["run_age_h"] for r in rs if r["run_age_h"] is not None]
        behind = [r["behind_h"] for r in rs if r["behind_h"] is not None]
        out.append(f"| {m} | {f} | {len(rs)} | {sum(r['verdict'] in BAD for r in rs)} | {sum(r['verdict'] == 'empty' for r in rs)} | "
                   f"{max(ages) if ages else '-'} | {rs[0]['bound_h']:g} | {max(behind) if behind else '-'} |")
    bad = [r for r in rows if r["verdict"] in BAD or (r["behind_h"] or 0) > 0]
    if bad:
        out += ["", "Stale or trailing sets:", ""]
        out += [f"- `{r['key']}`: run {r['run_age_h']} h old ({r['verdict']}, bound {r['bound_h']:g} h)"
                + (f", {r['behind_h']} h behind its marine set" if r["behind_h"] else "") for r in bad[:40]]
        if len(bad) > 40:
            out.append(f"- ... and {len(bad) - 40} more")
    return out


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--base", help="public weather-frames base URL (built from SUPABASE_URL by the workflow)")
    p.add_argument("--latest", help="a local latest.json instead of --base (tests, offline)")
    p.add_argument("--fail-on-stale", action="store_true")
    a = p.parse_args(argv)
    if a.latest:
        with open(a.latest, encoding="utf-8") as fh:
            latest = json.load(fh)
    else:
        with urllib.request.urlopen(f"{a.base.rstrip('/')}/v1/latest.json", timeout=60) as r:   # noqa: S310 - our bucket
            latest = json.loads(r.read().decode("utf-8"))
    rows = check(latest, datetime.now(timezone.utc))
    lines = summary(rows)
    print("\n".join(lines))
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        with open(path, "a", encoding="utf-8") as fh:
            fh.write("### Marine / wind / rated frame-set freshness (report only)\n\n" + "\n".join(lines) + "\n")
    stale = {}
    for r in rows:
        if r["verdict"] in BAD:
            stale.setdefault(f"{r['model']} {r['family']}", []).append(r["key"])
    for fam, keys in sorted(stale.items()):
        print(f"::warning title=Frame sets stale: {fam}::{len(keys)} set(s) past the bound, e.g. {keys[0]}")
    return 1 if (stale and a.fail_on_stale) else 0


if __name__ == "__main__":
    sys.exit(main())
