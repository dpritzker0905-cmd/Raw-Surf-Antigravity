"""wind_emos_collect.py - the matched-data record for long-range wind calibration (EMOS). GitHub Actions only.

Pre-registration: docs/weather-program/log/2026-11-16-wind-emos-preregistration.md (+ amendments 1-2). David
2026-11-15 22:04 EST: "Start it, off-peak daily, but use historical data to help us eliminate wait time for
calibrations". Reads PUBLIC data only (ECMWF open data on AWS, NDBC, IEM ASOS). It never calls the Raw Surf backend
and writes no manifest or product: only namespaced objects under `calibration/emos/` in the weather bucket.

  python scripts/wind_emos_collect.py stations --cache C [--upload]           # freeze the station list once
  python scripts/wind_emos_collect.py backfill --cache C --start 2025-06-01 --end 2025-06-30 [--shard 0/4] [--upload]
  python scripts/wind_emos_collect.py daily    --cache C [--upload]           # the newest complete 00Z run

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


def pack_run(fields_by_lead: dict) -> bytes:
    arrays = {}
    for L, f in fields_by_lead.items():
        arrays[f"u_{L}"] = f["10u"].astype(np.float32)
        arrays[f"v_{L}"] = f["10v"].astype(np.float32)
        arrays[f"g_{L}"] = f["10fg"].astype(np.float32)
    buf = io.BytesIO()
    np.savez_compressed(buf, **arrays)
    return buf.getvalue()


def collect_run(session, run: datetime, lats, lons, leads=LEADS) -> bytes:
    """All six leads of one run, or raise (a run with a missing lead is dropped, never filled)."""
    def at_stations(arr, meta):
        return ec.bilinear(arr, meta, lats, lons)
    out = {}
    for L in leads:
        f, _m = ef.fetch_step(session, run, L, at_stations)
        out[L] = f
    return pack_run(out)


def _store():
    from services.weather_pipeline.store import ProductStore
    return ProductStore()


def _bucket_keys(prefix: str):
    """Names already stored under `prefix` (for skip-if-done)."""
    try:
        from services.weather_pipeline.store import WEATHER_BUCKET, _get_supabase_storage
        sb = _get_supabase_storage()
        if sb is None:
            return set()
        names, offset = set(), 0
        while True:
            page = sb.storage.from_(WEATHER_BUCKET).list(prefix, {"limit": 1000, "offset": offset})
            names |= {p["name"] for p in page or []}
            if not page or len(page) < 1000:
                return names
            offset += 1000
    except Exception as e:  # noqa: BLE001 - listing failure only costs a re-read
        print(f"bucket listing failed ({e}); nothing skipped")
        return set()


def _download(key: str):
    from services.weather_pipeline.store import WEATHER_BUCKET, _get_supabase_storage
    sb = _get_supabase_storage()
    return None if sb is None else sb.storage.from_(WEATHER_BUCKET).download(key)


def load_stations(cache: str, use_bucket: bool):
    path = os.path.join(cache, "emos_stations.json")
    if not os.path.exists(path) and use_bucket:
        b = _download(f"{PREFIX}/stations.json")
        if b:
            open(path, "wb").write(b)
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
    ap.add_argument("--upload", action="store_true")
    a = ap.parse_args(argv)
    os.makedirs(a.cache, exist_ok=True)
    s = requests.Session()
    if a.cmd == "stations":
        path = os.path.join(a.cache, "emos_stations.json")
        if a.upload and _download_safe(f"{PREFIX}/stations.json"):
            print("EMOS stations already frozen in the bucket; not re-selected")
            return 0
        doc = obs.select_stations(s, a.cache, PERIOD[0], PERIOD[1], path, cover=NDBC_COVER, ndbc_months=NDBC_MONTHS,
                                  asos_cover=ASOS_COVER)
        print(f"EMOS stations frozen: {len(doc['ndbc'])} NDBC/C-MAN, {len(doc['asos'])} ASOS")
        if a.upload:
            _store()._upload_to_supabase(f"{PREFIX}/stations.json", open(path, "rb").read(), strict=True)
        return 0
    stations = load_stations(a.cache, a.upload)
    land, meta = obs.gfs_land(s, a.cache)
    lats, lons = H.sample_points(stations, land, meta)
    if a.cmd == "daily":
        run = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        runs = [r for r in (run, run - timedelta(days=1)) if ef.run_available(s, r, max(LEADS))][:1]
    else:
        start = datetime.fromisoformat(a.start).replace(tzinfo=timezone.utc)
        end = datetime.fromisoformat(a.end).replace(tzinfo=timezone.utc)
        runs = shard(runs_between(max(start, PERIOD[0]), end), a.shard)
    done = _bucket_keys(f"{PREFIX}/runs") if a.upload else set()
    st = _store() if a.upload else None
    report = {"runs": [], "dropped": [], "skipped": [], "stations": len(stations), "leads": list(LEADS)}
    for r in runs:
        name = f"{r:%Y%m%d%H}.npz"
        if name in done:
            report["skipped"].append(name)
            continue
        try:
            blob = collect_run(s, r, lats, lons)
        except Exception as e:  # noqa: BLE001 - dropped and logged, never filled
            report["dropped"].append({"run": name, "why": str(e)[:200]})
            print(f"{name}: DROPPED {e}", flush=True)
            continue
        open(os.path.join(a.cache, name), "wb").write(blob)
        if st:
            st._upload_to_supabase(f"{PREFIX}/runs/{name}", blob, strict=True, timeout=120)
        report["runs"].append(name)
        print(f"{name}: ok ({len(blob) / 1e6:.1f} MB)", flush=True)
    report["retries"] = dict(ef.RETRY_STATS)
    json.dump(report, open(os.path.join(a.cache, f"collect_report_{a.cmd}_{a.shard.replace('/', 'of')}.json"), "w"), indent=1)
    print(json.dumps({k: (len(v) if isinstance(v, list) else v) for k, v in report.items()}))
    return 0


def _download_safe(key):
    try:
        return _download(key)
    except Exception:  # noqa: BLE001 - absent object
        return None


if __name__ == "__main__":
    sys.exit(main())
