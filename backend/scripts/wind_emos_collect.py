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

import wind_lr_hindcast as H  # noqa: E402
import wind_lr_obs as obs  # noqa: E402

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


def daily_target(session, now: datetime):
    """(run, base) for the daily job: today's or yesterday's 00Z run, from data.ecmwf.int first (it keeps the newest
    runs) and the AWS mirror second. A throttled or failing check is not a crash: (None, None) means no run today, and
    a later backfill slice collects the day (it skips runs already stored)."""
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    for run in (today, today - timedelta(days=1)):
        for base in (ef.ECMWF_BASE, ef.AWS_BASE):
            try:
                if ef.run_available(session, run, max(LEADS), base=base):
                    return run, base
            except Exception as e:  # noqa: BLE001 - class only; the next source is tried
                print(f"daily: {run:%Y%m%d}00 on {'ecmwf' if base == ef.ECMWF_BASE else 'aws'}: {type(e).__name__}")
    return None, None


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
    base = ef.AWS_BASE
    if a.cmd == "daily":
        run, base = daily_target(s, datetime.now(timezone.utc))
        runs = [run] if run else []
        if not runs:
            print("daily: no complete 00Z run reachable (throttled or not yet published); a later backfill slice collects it")
    else:
        start = datetime.fromisoformat(a.start).replace(tzinfo=timezone.utc)
        end = datetime.fromisoformat(a.end).replace(tzinfo=timezone.utc)
        runs = shard(runs_between(max(start, PERIOD[0]), end), a.shard)
    done = existing_runs(a.cache)
    report = {"runs": [], "dropped": [], "skipped": [], "stations": len(stations), "leads": list(LEADS)}
    for r in runs:
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
    return 0


if __name__ == "__main__":
    sys.exit(main())
