"""wind_emos_collect.py - the matched-data record for long-range wind calibration (EMOS). GitHub Actions only.

Pre-registration: docs/weather-program/log/2026-11-16-wind-emos-preregistration.md (+ amendments 1-2). David
2026-11-15 22:04 EST: "Start it, off-peak daily, but use historical data to help us eliminate wait time for
calibrations". Reads PUBLIC data only (ECMWF open data on AWS, NDBC, IEM ASOS). It never calls the Raw Surf backend
and writes no manifest or product: only namespaced objects under `calibration/emos/` in the weather bucket.

  python scripts/wind_emos_collect.py stations --cache C                     # freeze the station list once
  python scripts/wind_emos_collect.py backfill --cache C --start 2025-06-01 --end 2025-06-30 [--shard 0/4]
  python scripts/wind_emos_collect.py daily    --cache C                      # the newest complete 00Z run

NO CREDENTIAL (advisor condition on #951): this process never touches the bucket. A storage-only step
(`python3 -I -S scripts/emos_bucket_io.py fetch`) first puts emos_stations.json and existing_runs.json in the cache;
this script writes `<cache>/runs/<run>.npz.new` (and `emos_stations.json.new` when it freezes the list); a second
storage-only step uploads those, create-only.

Per run it keeps ONLY the station values of the 51 IFS ENS members (10u, 10v, 10fg) at the six registered leads:
`{run}.npz` with arrays u_<L>, v_<L>, g_<L> shaped [51, stations]. About 1.3 GB of byte ranges are read per run.
"""
import argparse
import io
import json
import os
import sys
from datetime import datetime, timedelta, timezone

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.weather_pipeline import ens_wind_core as ec  # noqa: E402
from services.weather_pipeline import ens_wind_fetch as ef  # noqa: E402
from services import buoy_holdout  # noqa: E402

import wind_lr_hindcast as H  # noqa: E402
import wind_lr_obs as obs  # noqa: E402

buoy_holdout.declare_collector(__name__, "archives IFS ENS member values at every frozen station; scores nothing")

LEADS = (192, 210, 228, 252, 288, 324)          # amendment 2: two per lead bin
PERIOD = (datetime(2025, 6, 1, tzinfo=timezone.utc), datetime(2026, 10, 31, tzinfo=timezone.utc))
NDBC_COVER = (datetime(2026, 1, 1, tzinfo=timezone.utc), datetime(2026, 8, 31, 23, tzinfo=timezone.utc))
ASOS_COVER = (datetime(2026, 1, 1, tzinfo=timezone.utc), datetime(2026, 10, 31, 23, tzinfo=timezone.utc))
NDBC_MONTHS = tuple((2026, m) for m in range(1, 9))
PREFIX = "calibration/emos"


def runs_between(start: datetime, end: datetime):
    """00Z runs, inclusive (amendment 2: 00Z only)."""
    t = start.replace(hour=0, minute=0, second=0, microsecond=0)
    out = []
    while t <= end:
        out.append(t)
        t += timedelta(days=1)
    return out


def shard(items, spec: str):
    i, n = (int(x) for x in spec.split("/"))
    return [x for k, x in enumerate(items) if k % n == i]


def pack_run(fields_by_lead: dict, has_cf: bool = True) -> bytes:
    arrays = {"has_cf": np.array(1 if has_cf else 0, dtype=np.int8)}     # 51 members if 1, else 50 (amendment 5)
    for L, f in fields_by_lead.items():
        arrays[f"u_{L}"] = f["10u"].astype(np.float32)
        arrays[f"v_{L}"] = f["10v"].astype(np.float32)
        arrays[f"g_{L}"] = f["10fg"].astype(np.float32)
    buf = io.BytesIO()
    np.savez_compressed(buf, **arrays)
    return buf.getvalue()


def collect_run(session, run: datetime, lats, lons, leads=LEADS, base: str = ef.AWS_BASE) -> bytes:
    """All six leads of one run, or raise (a run with a missing lead is dropped, never filled)."""
    def at_stations(arr, meta):
        return ec.bilinear(arr, meta, lats, lons)
    out, has_cf = {}, []
    for L in leads:
        f, fmeta = ef.fetch_step(session, run, L, at_stations, base=base)
        out[L] = f
        has_cf.append(bool(fmeta.get("has_cf")))
    return pack_run(out, has_cf=all(has_cf))


PROBE_WAITS = (5, 15, 45)   # seconds between availability probes (the AWS mirror answers 503 under load)


def _probe(session, run, waits):
    """The first source that has the run complete, asked again after each wait; None if neither ever does."""
    import time
    for wait in (0,) + tuple(waits):
        time.sleep(wait)
        for base in (ef.ECMWF_BASE, ef.AWS_BASE):
            try:
                if ef.run_available(session, run, max(LEADS), base=base):
                    return base
            except Exception as e:  # noqa: BLE001 - class only; the next source / probe is tried
                print(f"daily: {run:%Y%m%d}00 on {'ecmwf' if base == ef.ECMWF_BASE else 'aws'}: {type(e).__name__}")
    return None


def daily_plan(session, now: datetime, done: set, report: dict, waits=None):
    """[(run, base)] for the daily job: today's 00Z run if it is not stored and reachable (data.ecmwf.int first, the AWS
    mirror second; probed again after each wait). Otherwise today is recorded as UNAVAILABLE, and yesterday is collected
    only if it is not stored and still reachable. A day that is missed is never quietly skipped: the job ends red (main),
    and a backfill slice (which skips stored runs) recovers it from the AWS mirror.
    2026-11-16: a 503 from the mirror lost that day, and the old fallback to a stored yesterday would have hidden it."""
    waits = PROBE_WAITS if waits is None else waits
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    if f"{today:%Y%m%d%H}.npz" in done:
        report["skipped"].append(f"{today:%Y%m%d%H}.npz")
        return []
    base = _probe(session, today, waits)
    if base:
        return [(today, base)]
    report["unavailable"].append(f"{today:%Y%m%d%H}")
    y = today - timedelta(days=1)
    if f"{y:%Y%m%d%H}.npz" in done:
        report["skipped"].append(f"{y:%Y%m%d%H}.npz")
        return []
    base = _probe(session, y, waits)
    return [(y, base)] if base else []


def existing_runs(cache: str) -> set:
    """Run files already stored (written by the storage-only fetch step); empty when absent."""
    p = os.path.join(cache, "existing_runs.json")
    return set(json.load(open(p))) if os.path.exists(p) else set()


def load_stations(cache: str):
    path = os.path.join(cache, "emos_stations.json")
    if not os.path.exists(path):
        raise SystemExit("no frozen EMOS station list: run `stations` first")
    doc = json.load(open(path))
    return doc["ndbc"] + doc["asos"]


def main(argv=None) -> int:
    import requests
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["stations", "backfill", "daily"])
    ap.add_argument("--cache", required=True)
    ap.add_argument("--start")
    ap.add_argument("--end")
    ap.add_argument("--shard", default="0/1")
    a = ap.parse_args(argv)
    os.makedirs(os.path.join(a.cache, "runs"), exist_ok=True)
    s = requests.Session()
    if a.cmd == "stations":
        if os.path.exists(os.path.join(a.cache, "emos_stations.json")):
            print("EMOS stations already frozen; not re-selected")
            return 0
        path = os.path.join(a.cache, "emos_stations.json.new")
        doc = obs.select_stations(s, a.cache, PERIOD[0], PERIOD[1], path, cover=NDBC_COVER, ndbc_months=NDBC_MONTHS,
                                  asos_cover=ASOS_COVER)
        print(f"EMOS stations frozen: {len(doc['ndbc'])} NDBC/C-MAN, {len(doc['asos'])} ASOS")
        return 0
    stations = load_stations(a.cache)
    land, meta = obs.gfs_land(s, a.cache)
    lats, lons = H.sample_points(stations, land, meta)
    done = existing_runs(a.cache)
    report = {"runs": [], "dropped": [], "skipped": [], "unavailable": [], "stations": len(stations), "leads": list(LEADS)}
    if a.cmd == "daily":
        plan = daily_plan(s, datetime.now(timezone.utc), done, report)
        if not plan and report["unavailable"]:
            print("daily: today's 00Z run not reachable after retries; recorded as unavailable (a backfill slice recovers it)")
    else:
        start = datetime.fromisoformat(a.start).replace(tzinfo=timezone.utc)
        end = datetime.fromisoformat(a.end).replace(tzinfo=timezone.utc)
        plan = [(r, ef.AWS_BASE) for r in shard(runs_between(max(start, PERIOD[0]), end), a.shard)]
    for r, base in plan:
        name = f"{r:%Y%m%d%H}.npz"
        if name in done:
            report["skipped"].append(name)
            continue
        try:
            blob = collect_run(s, r, lats, lons, base=base)
        except Exception as e:  # noqa: BLE001 - dropped and logged, never filled
            report["dropped"].append({"run": name, "why": str(e)[:200]})
            print(f"{name}: DROPPED {e}", flush=True)
            continue
        open(os.path.join(a.cache, "runs", name + ".new"), "wb").write(blob)     # the storage step uploads it
        report["runs"].append(name)
        print(f"{name}: ok ({len(blob) / 1e6:.1f} MB)", flush=True)
    report["retries"] = dict(ef.RETRY_STATS)
    json.dump(report, open(os.path.join(a.cache, f"collect_report_{a.cmd}_{a.shard.replace('/', 'of')}.json"), "w"), indent=1)
    print(json.dumps({k: (len(v) if isinstance(v, list) else v) for k, v in report.items()}))
    return daily_status(report) if a.cmd == "daily" else 0


def daily_status(report: dict) -> int:
    """3 (red) when the daily job missed a run, unreachable or dropped; 0 otherwise. Loud AFTER the run files are written,
    so the workflow's upload step (which runs on failure too) still stores what was collected."""
    if report["unavailable"] or report["dropped"]:
        print(f"::error::daily EMOS run not collected: unavailable {report['unavailable']}, dropped "
              f"{[d['run'] for d in report['dropped']]}", flush=True)
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(main())
