#!/usr/bin/env python3
"""wind_lead_skill.py - MEASURE 10 m wind forecast skill by lead (0-72 h) and regime at real pier anemometers.

Offline tool. Never the app, never storage, never the live backend. Two steps:

    python scripts/wind_lead_skill.py fetch --cache C:/t/wind-skill --model gfs --jobs 16 \
        --window 2024-09-19:2024-11-03:0,6,12,18 --window 2024-04-08:2024-05-05:0,12
    python scripts/wind_lead_skill.py score --cache C:/t/wind-skill --out skill.json

TRUTH: NOAA ISD global-hourly (AWS Open Data `noaa-global-hourly-pds`), which carries the NDBC C-MAN pier
anemometers (FM-13 reports) near surf spots, incl. the three the alert replay uses (TRDF1, LJPC1, DUKN7). NDBC's own
stdmet host is not reachable from every sandbox; ISD carries the same anemometer's hourly report (quality-coded).

FORECASTS (archived, AWS Open Data, byte-range reads of the 10 m U/V messages only):
  gfs    NOAA GFS 0.25 pgrb2 UGRD/VGRD 10 m: the lane served ratings (and so alerts) read
         (noaa_gfs_wind_fetcher -> rate_one_spot; the alert default lane is the first SPOT_RATINGS_PRECOMPUTE_MODELS).
  ecmwf  ECMWF IFS 0.25 open data 10u/10v (the EURO lane's model family; the Google Cloud mirror: the AWS copy
         answers 503 SlowDown at ~1 request/s).
  hrrr   NOAA HRRR CONUS 3 km UGRD/VGRD 10 m, rotated to earth. MAP-ONLY: wind_lane.py blends it into served wind
         tiles, never into ratings, so it is measured for comparison and does not drive the alert model.
Each (model, cycle, lead) is decoded once (pygrib) and sampled at every station (bilinear on lat/lon grids, nearest
cell on HRRR's Lambert grid), then dropped: the cache holds one JSONL row per file, a few hundred bytes.

Pure scoring lives in services/weather_pipeline/wind_lead_skill.py (unit-tested).
"""
import argparse
import json
import math
import os
import sys
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

from services.weather_pipeline import wind_lead_skill as S  # noqa: E402

GFS = "https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.{d}/{hh}/atmos/gfs.t{hh}z.pgrb2.0p25.f{fh:03d}"
HRRR = "https://noaa-hrrr-bdp-pds.s3.amazonaws.com/hrrr.{d}/conus/hrrr.t{hh}z.wrfsfcf{fh:02d}.grib2"
ECMWF = "https://storage.googleapis.com/ecmwf-open-data/{d}/{hh}z/ifs/0p25/oper/{d}{hh}0000-{fh}h-oper-fc"
ISD = "https://noaa-global-hourly-pds.s3.amazonaws.com/{y}/{usaf}99999.csv"
MAX_LEAD = {"gfs": 72, "ecmwf": 72, "hrrr": 48}
_lock = threading.Lock()


def _get(url, rng=None, timeout=90):
    req = urllib.request.Request(url, headers={"Range": "bytes=%d-%d" % rng} if rng else {})
    for attempt in range(6):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception:  # noqa: BLE001 - retried with backoff (S3 answers 503 SlowDown under load), then raised
            if attempt == 5:
                raise
            time.sleep(2 ** attempt)
    return b""


def _grib_ranges(model, cycle, fh):
    d, hh = cycle.strftime("%Y%m%d"), cycle.strftime("%H")
    if model == "ecmwf":
        base = ECMWF.format(d=d, hh=hh, fh=fh)
        rows = [json.loads(x) for x in _get(base + ".index").decode().splitlines() if x.strip()]
        out = []
        for p in ("10u", "10v"):
            r = next(x for x in rows if x.get("param") == p)
            out.append((base + ".grib2", (r["_offset"], r["_offset"] + r["_length"] - 1)))
        return out
    url = (GFS if model == "gfs" else HRRR).format(d=d, hh=hh, fh=fh)
    idx = _get(url + ".idx").decode().splitlines()
    i = next(k for k, line in enumerate(idx) if ":UGRD:10 m above ground:" in line)
    if ":VGRD:10 m above ground:" not in idx[i + 1]:
        raise ValueError("U/V 10 m not adjacent in " + url)
    lo, hi = int(idx[i].split(":")[1]), int(idx[i + 2].split(":")[1]) - 1
    return [(url, (lo, hi))]


_GRID = {}


def _sample(model, msgs, stations):
    import pygrib  # noqa: F401 - imported lazily: only the fetch step needs it
    u = v = None
    grids = []
    for m in msgs:
        name = m.shortName
        vals = m.values
        if name in ("10u", "u10", "u"):
            u = vals
        elif name in ("10v", "v10", "v"):
            v = vals
        grids.append(m)
    m0 = grids[0]
    key = (model, m0.Ni, m0.Nj)
    with _lock:
        if key not in _GRID:
            lats, lons = m0.latlons()
            _GRID[key] = S.station_weights(model, lats, lons, stations)
            if model == "hrrr":
                _GRID[key + ("rot",)] = {sid: S.lambert_rotation_deg(lon, m0.LoVInDegrees, m0.Latin1InDegrees)
                                         for sid, (_la, lon) in stations.items()}
    weights = _GRID[key]
    out = {}
    for sid, w in weights.items():
        uu = sum(wt * float(u[j, i]) for (j, i), wt in w)
        vv = sum(wt * float(v[j, i]) for (j, i), wt in w)
        if model == "hrrr":
            uu, vv = S.rotate_to_earth(uu, vv, _GRID[key + ("rot",)][sid])
        if math.isfinite(uu) and math.isfinite(vv):
            out[sid] = [round(uu, 3), round(vv, 3)]
    return out


def fetch_one(model, cycle, fh, stations):
    import pygrib
    msgs = []
    for url, rng in _grib_ranges(model, cycle, fh):
        raw = _get(url, rng)
        for part in S.split_grib2(raw):
            msgs.append(pygrib.fromstring(part))
    return {"model": model, "cycle": cycle.strftime("%Y-%m-%dT%HZ"), "lead": fh,
            "uv": _sample(model, msgs, stations)}


def cmd_fetch(a):
    os.makedirs(a.cache, exist_ok=True)
    stations = {s["id"]: (s["lat"], s["lon"]) for s in S.STATIONS}
    path = os.path.join(a.cache, f"fc_{a.model}.jsonl")
    done = set()
    if os.path.exists(path):
        for line in open(path, encoding="utf-8"):
            r = json.loads(line)
            done.add((r["cycle"], r["lead"]))
    jobs = []
    for w in a.window:
        start, end, hours = w.split(":")
        day = datetime.strptime(start, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        last = datetime.strptime(end, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        while day <= last:
            for hh in (int(h) for h in hours.split(",")):
                c = day + timedelta(hours=hh)
                for fh in range(0, MAX_LEAD[a.model] + 1, a.lead_step):
                    if (c.strftime("%Y-%m-%dT%HZ"), fh) not in done:
                        jobs.append((c, fh))
            day += timedelta(days=1)
    print(f"{a.model}: {len(jobs)} files to fetch ({len(done)} cached)", flush=True)
    n = [0]

    def run(job):
        try:
            row = fetch_one(a.model, job[0], job[1], stations)
        except Exception as e:  # noqa: BLE001 - a missing archive file is recorded, not fatal
            row = {"model": a.model, "cycle": job[0].strftime("%Y-%m-%dT%HZ"), "lead": job[1], "error": str(e)[:200]}
        with _lock:
            with open(path, "a", encoding="utf-8") as fh:
                fh.write(json.dumps(row) + "\n")
            n[0] += 1
            if n[0] % 200 == 0:
                print(f"  {n[0]}/{len(jobs)}", flush=True)
    with ThreadPoolExecutor(a.jobs) as ex:
        list(ex.map(run, jobs))


def cmd_obs(a):
    os.makedirs(a.cache, exist_ok=True)
    for s in S.STATIONS:
        for y in a.years:
            p = os.path.join(a.cache, f"isd_{s['usaf']}_{y}.csv")
            if not os.path.exists(p):
                with open(p, "wb") as fh:
                    fh.write(_get(ISD.format(y=y, usaf=s["usaf"])))
    print("obs cached")


def load_obs(cache, years):
    obs = {}
    for s in S.STATIONS:
        rows = {}
        for y in years:
            p = os.path.join(cache, f"isd_{s['usaf']}_{y}.csv")
            if os.path.exists(p):
                rows.update(S.read_isd(p))
        obs[s["id"]] = rows
    return obs


def load_fc(cache, model):
    out = []
    p = os.path.join(cache, f"fc_{model}.jsonl")
    if not os.path.exists(p):
        return out
    for line in open(p, encoding="utf-8"):
        r = json.loads(line)
        if "uv" in r:
            out.append(r)
    return out


def write_replay_model(a, result, pairs_by_model):
    """The replay's measured error model (scripts/alert_window_replay.py --error-model-file): the GFS lane's and
    the ECMWF peer's per-station fits, their error correlation, and the measured Hs error persistence."""
    import alert_replay_inputs as ARI
    cm = result["gfs_ecmwf"]
    analysis = {}
    for b in ARI.BUOYS:
        rows = {}
        with open(os.path.join(a.hs_anl_dir, f"{b}.txt"), encoding="utf-8") as fh:
            for line in fh:
                if line.startswith("#"):
                    continue
                p = line.split()
                t = datetime(int(p[0]), int(p[1]), int(p[2]), int(p[3]), tzinfo=timezone.utc)
                rows[t] = float(p[5])
        analysis[b] = rows
    hs_rows = [json.loads(x) for x in open(a.hs_fc, encoding="utf-8")]
    hs = S.hs_persistence(hs_rows, analysis)
    out = {"schema": "raw-surf/alert-replay-error-model/1",
           "source": "scripts/wind_lead_skill.py score (ISD pier anemometers vs archived GFS 0.25 / ECMWF IFS 0.25 10 m "
                     "wind, 2024 windows) + GFS-Wave forecast vs analysis Hs persistence",
           "gfs": result["models"]["gfs"]["error_model"], "ecmwf": result["models"]["ecmwf"]["error_model"],
           "gfs_ecmwf": {"speed_err_corr": cm["pooled_speed_err_corr"], "dir_err_corr": cm["pooled_dir_err_corr"]},
           "hs": {"rho_h": hs["rho_h"], "cross_cycle_6h": hs["cross_cycle_6h"], "detail": hs}}
    with open(a.model_out, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(out, fh, indent=1, sort_keys=True)
    print("replay error model ->", a.model_out, json.dumps(out["gfs_ecmwf"]), json.dumps(hs)[:300])


def cmd_score(a):
    obs = load_obs(a.cache, a.years)
    from services.weather_pipeline.surf_point import resolve_surf_geometry
    normals = {}
    for st in S.STATIONS:   # the served chain's own seaward shore normal at the anemometer (flip rates use it)
        try:
            normals[st["id"]] = resolve_surf_geometry(st["lat"], st["lon"]).shore_normal_deg
        except Exception:  # noqa: BLE001 - a station without geometry simply gets no direction flips
            normals[st["id"]] = None
    result = {"schema": "raw-surf/wind-lead-skill/1", "stations": S.STATIONS, "shore_normals": normals, "models": {}}
    pairs_by_model = {}
    for model in a.models:
        fc = load_fc(a.cache, model)
        pairs = S.pair(fc, obs)
        pairs_by_model[model] = pairs
        result["models"][model] = {"files": len(fc), "pairs": len(pairs), "table": S.skill_table(pairs, normals),
                                   "regimes": S.regime_tables(pairs, normals), "error_model": S.fit_error_model(pairs)}
        print(f"{model}: {len(fc)} files, {len(pairs)} pairs", flush=True)
    if "gfs" in pairs_by_model and "ecmwf" in pairs_by_model:
        result["gfs_ecmwf"] = S.cross_model(pairs_by_model["gfs"], pairs_by_model["ecmwf"])
    if a.model_out:
        write_replay_model(a, result, pairs_by_model)
    with open(a.out, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(result, fh, indent=1, sort_keys=True)
    print(S.markdown(result))


def main(argv=None):
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("fetch")
    f.add_argument("--cache", required=True)
    f.add_argument("--model", choices=sorted(MAX_LEAD), required=True)
    f.add_argument("--window", action="append", required=True, help="YYYY-MM-DD:YYYY-MM-DD:h1,h2 (cycle hours)")
    f.add_argument("--lead-step", type=int, default=3)
    f.add_argument("--jobs", type=int, default=16)
    o = sub.add_parser("obs")
    o.add_argument("--cache", required=True)
    o.add_argument("--years", nargs="+", default=["2024"])
    s = sub.add_parser("score")
    s.add_argument("--cache", required=True)
    s.add_argument("--models", nargs="+", default=["gfs", "ecmwf", "hrrr"])
    s.add_argument("--years", nargs="+", default=["2024"])
    s.add_argument("--out", required=True)
    s.add_argument("--model-out", help="also write the replay's measured error model here")
    s.add_argument("--hs-fc", help="alert_replay_inputs.py --hs-persistence JSONL (with --model-out)")
    s.add_argument("--hs-anl-dir", help="alert_replay_inputs.py --out dir (the analysis buoy files)")
    a = ap.parse_args(argv)
    {"fetch": cmd_fetch, "obs": cmd_obs, "score": cmd_score}[a.cmd](a)


if __name__ == "__main__":
    main()
