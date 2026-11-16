"""wind_lr_hindcast.py - offline hindcast for the long-range wind hand-off (ICON 180-336 h, EURO 240-336 h).

Serves nothing; never calls the Raw Surf backend; public data only (ECMWF open data on AWS, NOAA GFS/GEFS on AWS,
NDBC, IEM ASOS). Pre-registered gate: docs/weather-program/log/2026-11-15-wind-long-range.md (21:45Z + amendments).

  python scripts/wind_lr_hindcast.py stations --cache C          # freeze the station list (rule-based)
  python scripts/wind_lr_hindcast.py collect  --cache C --shard 0/24   # model values at stations, per run
  python scripts/wind_lr_hindcast.py score    --cache C --out O   # arms, bins, bootstrap, PASS lines, controls

`collect` keeps the 51 ENS members' station values raw, so the mean, the control and the de-bias are formed at
scoring time from the same numbers (scripts/wind_lr_score.py).
"""
import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.weather_pipeline import ens_wind_core as ec  # noqa: E402
from services.weather_pipeline import ens_wind_fetch as ef  # noqa: E402
from services.weather_pipeline import eval_grib2 as g2  # noqa: E402

import wind_lr_obs as obs  # noqa: E402

# Amendment 2 (2026-11-16 00:10Z): the current ECMWF cycle; the last run's 336 h lead verifies 2026-11-14
WINDOW = (datetime(2026, 9, 1, tzinfo=timezone.utc), datetime(2026, 10, 31, 12, tzinfo=timezone.utc))
OBS_END = WINDOW[1] + timedelta(days=15)
ENS_STEPS = list(range(180, 361, 6))                       # 180/240 bracket the seams; 186..336 scored; to 360 for the lag arms
SCORED_LEADS = list(range(186, 337, 6))
LOOP_DAYS_H = 168                                           # extend_icon_wind_to_14d: whole native days of ~180 h
HRES_LEADS = sorted({L % LOOP_DAYS_H for L in SCORED_LEADS} | {180} | set(range(216, 241, 6)))
GFS_BASE = "https://noaa-gfs-bdp-pds.s3.amazonaws.com"
GEFS_BASE = "https://noaa-gefs-pds.s3.amazonaws.com"


def runs_in_window():
    t, out = WINDOW[0], []
    while t <= WINDOW[1]:
        out.append(t)
        t += timedelta(hours=12)
    return out


def sample_points(stations, land, meta):
    """(lats, lons): station positions; an NDBC station whose 4 surrounding 0.25-degree nodes are not all sea is moved
    to the nearest all-sea node (flagged in the station record)."""
    lats, lons = [], []
    for st in stations:
        la, lo = st["lat"], st["lon"]
        if st["kind"] == "ndbc":
            i, j = g2.index_of(meta, la, lo)
            ring = [(i + a, (j + b) % meta["ni"]) for a in (0, 1) for b in (0, 1)]
            if any(land[r, c] > 0.5 for r, c in ring if 0 <= r < meta["nj"]):
                best = None
                for di in range(-8, 9):
                    for dj in range(-8, 9):
                        r, c = i + di, (j + dj) % meta["ni"]
                        if not (0 <= r < meta["nj"] - 1):
                            continue
                        cells = [(r + a, (c + b) % meta["ni"]) for a in (0, 1) for b in (0, 1)]
                        if all(land[x, y] <= 0.5 for x, y in cells):
                            nla = meta["lat_south"] + (r + 0.5) * meta["dlat"]
                            nlo = meta["lon_west"] + (c + 0.5) * meta["dlon"]
                            d = float(obs.haversine_km(la, lo, nla, nlo))
                            if best is None or d < best[0]:
                                best = (d, nla, nlo)
                if best:
                    st["moved_km"] = round(best[0], 1)
                    la, lo = best[1], ((best[2] + 180.0) % 360.0) - 180.0
        lats.append(la)
        lons.append(lo)
    return np.array(lats), np.array(lons)


def _ecmwf_det(session, run, step, lats, lons, params=("10u", "10v", "10fg"), stream="oper", typ="fc"):
    """HRES (oper fc) station values {param: [nst]}."""
    url = ef.ef_url(ef.AWS_BASE, run, step, "index", stream=stream, typ=typ)
    r = ef._get(session, url)
    if r.status_code != 200:
        raise FileNotFoundError(url)
    ent = [e for e in ec.parse_ecmwf_index(r.text) if e.get("param") in params and e.get("levtype", "sfc") == "sfc"
           and int(e.get("step", -1)) == step]
    out = {}
    for e in ent:
        off, ln = int(e["_offset"]), int(e["_length"])
        buf = ef._get(session, url.replace(".index", ".grib2"), headers={"Range": f"bytes={off}-{off + ln - 1}"}).content
        arr, meta = g2.decode_span(buf, [e["param"]], [e["param"]])[e["param"]]
        out[e["param"]] = ec.bilinear(arr, meta, lats, lons)
    missing = [p for p in ("10u", "10v") if p not in out]
    if missing:
        raise ValueError(f"HRES {run:%Y%m%d%H} +{step}: missing {missing}")
    if "10fg" not in out:  # step 0 carries no 10fg (a max since the previous step): the gust is missing, not filled
        out["10fg"] = np.full(len(lats), np.nan)
    return out


def _noaa(session, url, wanted, lats, lons):
    """{key: [nst]} from a NOAA GRIB2 + .idx (GFS pgrb2.0p25 / GEFS pgrb2a.0p50)."""
    r = ef._get(session, url + ".idx")
    if r.status_code != 200:
        raise FileNotFoundError(url + ".idx")
    idx = g2.parse_idx(r.text)
    out = {}
    for key in wanted:
        k = next((n for n, (_, kk) in enumerate(idx) if kk == key), None)
        if k is None:
            raise ValueError(f"{key} not in {url}")
        lo = idx[k][0]
        hi = idx[k + 1][0] - 1 if k + 1 < len(idx) else None
        rng = f"bytes={lo}-{hi}" if hi is not None else f"bytes={lo}-"
        buf = ef._get(session, url, headers={"Range": rng}).content
        arr, meta = g2.decode_span(buf, [key], [key])[key]
        out[key] = ec.bilinear(arr, meta, lats, lons)
    return out


def collect_run(session, run, lats, lons, out_dir):
    path = os.path.join(out_dir, f"{run:%Y%m%d%H}.npz")
    if os.path.exists(path):
        return "cached"
    if not ef.run_available(session, run, 336):
        json.dump({"run": run.isoformat(), "missing": "enfo 336 h index"}, open(path + ".missing.json", "w"))
        return "missing"

    def at_stations(arr, meta):
        return ec.bilinear(arr, meta, lats, lons)
    arrays, notes = {}, {"run": run.isoformat(), "errors": []}
    for step in ENS_STEPS:
        f, _meta = ef.fetch_step(session, run, step, at_stations)
        for p in ef.PARAMS:
            arrays[f"ens_{p}_{step}"] = f[p].astype(np.float32)         # [51, nst]
    for step in HRES_LEADS:
        try:
            h = _ecmwf_det(session, run, step, lats, lons)
            for p, v in h.items():
                arrays[f"hres_{p}_{step}"] = v.astype(np.float32)
        except Exception as e:  # noqa: BLE001 - a missing deterministic arm is recorded, never filled
            notes["errors"].append(f"hres +{step}: {e}")
    d, hh = run.strftime("%Y%m%d"), run.strftime("%H")
    for L in SCORED_LEADS:
        try:
            g = _noaa(session, f"{GFS_BASE}/gfs.{d}/{hh}/atmos/gfs.t{hh}z.pgrb2.0p25.f{L:03d}",
                      ["UGRD:10m", "VGRD:10m", "GUST"], lats, lons)
            arrays[f"gfs_u_{L}"], arrays[f"gfs_v_{L}"], arrays[f"gfs_g_{L}"] = (
                g["UGRD:10m"].astype(np.float32), g["VGRD:10m"].astype(np.float32), g["GUST"].astype(np.float32))
        except Exception as e:  # noqa: BLE001
            notes["errors"].append(f"gfs +{L}: {e}")
        try:
            m = _noaa(session, f"{GEFS_BASE}/gefs.{d}/{hh}/atmos/pgrb2ap5/geavg.t{hh}z.pgrb2a.0p50.f{L:03d}",
                      ["UGRD:10m", "VGRD:10m"], lats, lons)
            arrays[f"gefs_u_{L}"], arrays[f"gefs_v_{L}"] = m["UGRD:10m"].astype(np.float32), m["VGRD:10m"].astype(np.float32)
        except Exception as e:  # noqa: BLE001
            notes["errors"].append(f"gefs +{L}: {e}")
    for L in SCORED_LEADS:                     # the reported AIFS-ENS arm (amendment 2): 51 members, 10u/10v only
        try:
            f, _m = ef.fetch_step(session, run, L, at_stations, params=("10u", "10v"), model="aifs-ens",
                                  file_types=("cf", "pf"))
            arrays[f"aifs_10u_{L}"], arrays[f"aifs_10v_{L}"] = f["10u"].astype(np.float32), f["10v"].astype(np.float32)
        except Exception as e:  # noqa: BLE001 - a reported arm; its gap is logged, the run is kept
            notes["errors"].append(f"aifs +{L}: {e}")
    np.savez_compressed(path, **arrays)
    json.dump(notes, open(path + ".json", "w"))
    return "ok"


def main(argv=None):
    import requests
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["stations", "collect", "obs", "score"])
    ap.add_argument("--cache", required=True)
    ap.add_argument("--shard", default="0/1")
    ap.add_argument("--out", default=None)
    ap.add_argument("--stations", default=None, help="frozen station JSON (default <cache>/wind_lr_stations.json)")
    a = ap.parse_args(argv)
    os.makedirs(a.cache, exist_ok=True)
    s = requests.Session()
    st_path = a.stations or os.path.join(a.cache, "wind_lr_stations.json")
    if a.cmd == "stations":
        if os.path.exists(st_path):             # the committed frozen list wins: a rerun never re-selects stations
            print(f"stations already frozen: {st_path}")
            obs.gfs_land(s, a.cache)
            return 0
        doc = obs.select_stations(s, a.cache, WINDOW[0], OBS_END, st_path)
        print(f"stations frozen: {len(doc['ndbc'])} NDBC/C-MAN, {len(doc['asos'])} ASOS -> {st_path}")
        return 0
    doc = json.load(open(st_path))
    stations = doc["ndbc"] + doc["asos"]
    if a.cmd == "collect":
        land, meta = obs.gfs_land(s, a.cache)
        lats, lons = sample_points(stations, land, meta)
        i, n = (int(x) for x in a.shard.split("/"))
        runs = [r for k, r in enumerate(runs_in_window()) if k % n == i]
        out_dir = os.path.join(a.cache, "runs")
        os.makedirs(out_dir, exist_ok=True)
        failed = []
        for attempt in (1, 2):                  # a run that fails is retried once at the end, never filled
            for r in (runs if attempt == 1 else failed[:]):
                try:
                    print(r.isoformat(), collect_run(s, r, lats, lons, out_dir), flush=True)
                    if r in failed:
                        failed.remove(r)
                except Exception as e:  # noqa: BLE001 - recorded per run; the shard goes on
                    print(r.isoformat(), f"FAILED attempt {attempt}: {e}", flush=True)
                    if r not in failed:
                        failed.append(r)
        for r in failed:
            json.dump({"run": r.isoformat(), "failed": "collect raised twice"},
                      open(os.path.join(out_dir, f"{r:%Y%m%d%H}.npz.failed.json"), "w"))
        json.dump({"shard": a.shard, "runs": len(runs), "failed": [r.isoformat() for r in failed],
                   "retries": dict(ef.RETRY_STATS)}, open(os.path.join(out_dir, f"shard_{i}_of_{n}.retries.json"), "w"))
        print(f"shard {a.shard}: retries by cause {dict(ef.RETRY_STATS)}; failed runs {len(failed)}", flush=True)
        return 0
    import wind_lr_score as score
    return score.main_score(s, a.cache, stations, a.out or os.path.join(a.cache, "report"))


if __name__ == "__main__":
    sys.exit(main())
