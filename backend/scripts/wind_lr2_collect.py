"""wind_lr2_collect.py - collectors for the long-range wind v2 registration: NOAA AIGEFS, NOAA GEFS, ECMWF IFS ENS at the
frozen stations, plus (TEST only) the two served comparators' fields. Serves nothing; never calls the Raw Surf backend.

  python scripts/wind_lr2_collect.py list   --kind fit|test [--freeze-time ISO]      # the registered run list
  python scripts/wind_lr2_collect.py collect --kind fit|test --cache C --shard 0/12  # DISPATCH NEEDS THE OWNER'S WORD
  python scripts/wind_lr2_collect.py snapshot --cache C --stations S.json          # weekly realtime2 snapshot

Sources (amendment 1): AIGEFS `noaa-nws-graphcastgfs-pds` EAGLE_ensemble/aigefs.YYYYMMDD/HH/memNNN (sfc, UGRD/VGRD
10 m, 6-hourly to f384, no gust). GEFS 0.5 deg `noaa-gefs-pds` pgrb2ap5 (UGRD/VGRD 10 m; the 0.25 deg `pgrb2sp25`
files stop at f240, so they cannot serve leads past 240 h) with GUST from pgrb2bp5. IFS ENS through `ens_wind_fetch`.
A run is KEPT only if every step of every system exists; a missing step drops the run and lists why. Never filled.
"""
import argparse
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Callable, Dict, List, Optional

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import wind_lr2_runs as R  # noqa: E402

AIGEFS_BASE = "https://noaa-nws-graphcastgfs-pds.s3.amazonaws.com"
GEFS_BASE = "https://noaa-gefs-pds.s3.amazonaws.com"
AIGEFS_MEMBERS = 31
GEFS_MEMBERS = 31
WORKERS = 6


def aigefs_url(run: datetime, member: int, step: int) -> str:
    d, hh = run.strftime("%Y%m%d"), run.strftime("%H")
    return (f"{AIGEFS_BASE}/EAGLE_ensemble/aigefs.{d}/{hh}/mem{member:03d}/model/atmos/grib2/"
            f"aigefs.t{hh}z.sfc.f{step:03d}.grib2")


def gefs_member_name(member: int) -> str:
    return "gec00" if member == 0 else f"gep{member:02d}"


def gefs_url(run: datetime, member: int, step: int, kind: str = "a") -> str:
    """kind 'a' = pgrb2ap5 (UGRD/VGRD 10 m), 'b' = pgrb2bp5 (GUST)."""
    d, hh = run.strftime("%Y%m%d"), run.strftime("%H")
    nm = gefs_member_name(member)
    return f"{GEFS_BASE}/gefs.{d}/{hh}/atmos/pgrb2{kind}p5/{nm}.t{hh}z.pgrb2{kind}.0p50.f{step:03d}"


def _members_at(read_one: Callable[[int], Dict[str, np.ndarray]], n: int) -> Dict[str, np.ndarray]:
    """Read members 0..n-1 in parallel; {key: [n, nst]}. Any member failing raises (a partial ensemble is never used)."""
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        parts = list(ex.map(read_one, range(n)))
    return {k: np.stack([p[k] for p in parts]).astype(np.float32) for k in parts[0]}


def read_aigefs_step(session, run, step, lats, lons, noaa_read) -> Dict[str, np.ndarray]:
    def one(m):
        r = noaa_read(session, aigefs_url(run, m, step), ["UGRD:10m", "VGRD:10m"], lats, lons)
        return {"u": r["UGRD:10m"], "v": r["VGRD:10m"]}
    return _members_at(one, AIGEFS_MEMBERS)


def read_gefs_step(session, run, step, lats, lons, noaa_read, gust: bool = True) -> Dict[str, np.ndarray]:
    def one(m):
        r = noaa_read(session, gefs_url(run, m, step, "a"), ["UGRD:10m", "VGRD:10m"], lats, lons)
        out = {"u": r["UGRD:10m"], "v": r["VGRD:10m"]}
        if gust:
            out["g"] = noaa_read(session, gefs_url(run, m, step, "b"), ["GUST"], lats, lons)["GUST"]
        return out
    return _members_at(one, GEFS_MEMBERS)


def collect_run(session, run: datetime, lats, lons, out_dir: str, io: dict, comparators: bool) -> str:
    """One run -> `<out_dir>/<YYYYMMDDHH>.npz`. `io` carries the readers so tests can inject fakes:
    {'noaa': f(session, url, keys, lats, lons), 'ifs': f(session, run, step, lats, lons) -> {'10u','10v','10fg'},
     'comparators': f(session, run, lats, lons) -> {name: array} (TEST only)}.
    Returns 'ok', 'cached' or 'dropped'. Dropped runs write `<stamp>.dropped.json` with the cause and are never filled."""
    stamp = f"{run:%Y%m%d%H}"
    path = os.path.join(out_dir, f"{stamp}.npz")
    if os.path.exists(path):
        return "cached"
    arrays: Dict[str, np.ndarray] = {}
    causes: List[str] = []
    for step in R.STEPS:
        for name, fn in (("aigefs", lambda: read_aigefs_step(session, run, step, lats, lons, io["noaa"])),
                         ("gefs", lambda: read_gefs_step(session, run, step, lats, lons, io["noaa"])),
                         ("ifs", lambda: io["ifs"](session, run, step, lats, lons))):
            try:
                for k, v in fn().items():
                    arrays[f"{name}_{k}_{step}"] = np.asarray(v, dtype=np.float32)
            except Exception as e:  # noqa: BLE001 - recorded with its cause; the run is dropped, never filled
                causes.append(f"{name} +{step}: {type(e).__name__}: {e}")
    if comparators and not causes:
        try:
            for k, v in io["comparators"](session, run, lats, lons).items():
                arrays[f"cmp_{k}"] = np.asarray(v, dtype=np.float32)
        except Exception as e:  # noqa: BLE001
            causes.append(f"comparators: {type(e).__name__}: {e}")
    if causes:
        json.dump({"run": run.isoformat(), "dropped": causes[:50], "n_causes": len(causes)},
                  open(os.path.join(out_dir, f"{stamp}.dropped.json"), "w"))
        return "dropped"
    np.savez_compressed(path, **arrays)
    return "ok"


def run_list(kind: str, freeze_time: Optional[datetime] = None) -> List[datetime]:
    if kind == "fit":
        return R.fit_runs()
    return R.test_window_runs(freeze_time)


def shard(runs: List[datetime], spec: str) -> List[datetime]:
    i, n = (int(x) for x in spec.split("/"))
    return [r for k, r in enumerate(runs) if k % n == i]


def _live_io():
    """The real readers (imports the existing hindcast instrument; kept out of module scope so tests need no network)."""
    import wind_lr_hindcast as H
    from services.weather_pipeline import ens_wind_core as ec
    from services.weather_pipeline import ens_wind_fetch as ef

    def ifs(session, run, step, lats, lons):
        f, _m = ef.fetch_step(session, run, step, lambda arr, meta: ec.bilinear(arr, meta, lats, lons), base=H.ENS_BASE)
        return {"10u": f["10u"], "10v": f["10v"], "10fg": f["10fg"]}

    def comparators(session, run, lats, lons):
        out = {}
        for step in H.HRES_LEADS:
            for p, v in H._ecmwf_det(session, run, step, lats, lons).items():
                out[f"hres_{p}_{step}"] = v
        d, hh = run.strftime("%Y%m%d"), run.strftime("%H")
        for L in R.SCORED_LEADS:
            g = H._noaa(session, f"{H.GFS_BASE}/gfs.{d}/{hh}/atmos/gfs.t{hh}z.pgrb2.0p25.f{L:03d}",
                        ["UGRD:10m", "VGRD:10m", "GUST"], lats, lons)
            out[f"gfs_u_{L}"], out[f"gfs_v_{L}"], out[f"gfs_g_{L}"] = g["UGRD:10m"], g["VGRD:10m"], g["GUST"]
        return out
    return {"noaa": H._noaa, "ifs": ifs, "comparators": comparators}, H


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["list", "collect", "snapshot"])
    ap.add_argument("--kind", choices=["fit", "test"], default="test")
    ap.add_argument("--stations", default=None, help="snapshot: the frozen station JSON")
    ap.add_argument("--freeze-time", default=None, help="ISO UTC committer timestamp of the freeze commit (test only)")
    ap.add_argument("--cache", default=None)
    ap.add_argument("--shard", default="0/1")
    a = ap.parse_args(argv)
    ft = datetime.fromisoformat(a.freeze_time).astimezone(timezone.utc) if a.freeze_time else None
    runs = run_list(a.kind, ft)
    if a.cmd == "list":
        for r in runs:
            print(r.isoformat())
        print(f"{len(runs)} runs; last valid {R.last_valid(runs).isoformat()}; truth snapshots to {R.snapshot_end(runs):%Y-%m-%d}")
        return 0
    if not a.cache:
        raise SystemExit("--cache is required")
    if a.cmd == "snapshot":
        import requests
        import wind_lr2_truth as T
        doc = json.load(open(a.stations or os.path.join(a.cache, "wind_lr2_stations.json")))
        ids = [x["id"] for x in doc["ndbc"]]
        n = T.save_snapshot(requests.Session(), os.path.join(a.cache, "snapshots"), ids, datetime.now(timezone.utc))
        print(f"snapshot: saved {n} of {len(ids)} stations")
        return 0
    import requests
    import wind_lr_obs as obs
    io, H = _live_io()
    s = requests.Session()
    doc = json.load(open(os.path.join(a.cache, "wind_lr2_stations.json")))
    stations = doc["ndbc"] + doc["asos"]
    land, meta = obs.gfs_land(s, a.cache)
    lats, lons = H.sample_points(stations, land, meta)
    out_dir = os.path.join(a.cache, f"runs_{a.kind}")
    os.makedirs(out_dir, exist_ok=True)
    for r in shard(runs, a.shard):
        print(r.isoformat(), collect_run(s, r, lats, lons, out_dir, io, comparators=(a.kind == "test")), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
