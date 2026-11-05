#!/usr/bin/env python3
"""alert_replay_inputs.py - build an ARCHIVED --data dir for scripts/alert_window_replay.py from sources an
offline sandbox can reach (AWS Open Data only). Never the app, never storage, never the live backend.

    python scripts/alert_replay_inputs.py --out C:/t/alert-2024 --start 2024-09-19 --end 2024-11-06 \
        --wind-cache C:/t/wind-skill

It writes the files the replay already reads, in their own formats:
  <buoy>.txt     NDBC-stdmet-shaped WVHT/DPD/MWD, from the GFS-Wave 0.25 ANALYSIS hours (f000-f005 of each 6-hourly
                 cycle) at the nearest wet cell to the replay's buoy. ⚠️ A model analysis, not the buoy: the sea state
                 is plausible OFFSHORE Hs (which is what the served chain is written for), but it is not measured.
  <wind>.txt     NDBC-stdmet-shaped WDIR/WSPD, from the REAL pier anemometer (ISD global-hourly, the same C-MAN
                 station #712/#718 read from NDBC realtime2). Calm hours carry the last measured direction.
  tide_<st>.json a CO-OPS-shaped hourly series. ⚠️ SYNTHETIC astronomical tide (M2 S2 N2 K1 O1 at their true speeds,
                 coast-typical amplitudes, zero Greenwich phase): CO-OPS is not reachable here. Truth and forecast
                 share it (tides are predictions in both), so it only decides which hours are mid/high.
Use #712's own NDBC realtime2 + CO-OPS dir instead whenever it is available: the replay reads either.
"""
import argparse
import json
import math
import os
import sys
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
for p in (HERE, BACKEND):
    if p not in sys.path:
        sys.path.insert(0, p)

import wind_lead_skill as WS  # noqa: E402
from services.weather_pipeline import wind_lead_skill as S  # noqa: E402

WAVE = "https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.{d}/{hh}/wave/gridded/gfswave.t{hh}z.global.0p25.f{fh:03d}.grib2"
BUOYS = {"41113": (28.400, -80.534), "46254": (32.868, -117.267), "44100": (36.258, -75.593)}
WINDS = {"TRDF1": "997354", "LJPC1": "994018", "DUKN7": "998209"}
TIDES = {  # station: (coast-typical amplitudes, m) - SYNTHETIC, see the module docstring
    "8721604": {"M2": 0.50, "S2": 0.08, "N2": 0.11, "K1": 0.08, "O1": 0.06},
    "9410230": {"M2": 0.50, "S2": 0.20, "N2": 0.12, "K1": 0.34, "O1": 0.22},
    "8651370": {"M2": 0.45, "S2": 0.08, "N2": 0.10, "K1": 0.07, "O1": 0.05},
}
SPEED_DEG_H = {"M2": 28.9841042, "S2": 30.0, "N2": 28.4397295, "K1": 15.0410686, "O1": 13.9430356}
EPOCH = datetime(2000, 1, 1, tzinfo=timezone.utc)


def synthetic_tide(amps, t):
    h = (t - EPOCH).total_seconds() / 3600.0
    return sum(a * math.cos(math.radians(SPEED_DEG_H[c] * h)) for c, a in amps.items())


_CELLS = {}


def _cells(msg):
    """Nearest wet cell to each buoy (searched once per grid, then reused for every file)."""
    import numpy as np
    key = (msg.Ni, msg.Nj)
    if key not in _CELLS:
        lats, lons = msg.latlons()
        hs = np.ma.masked_invalid(np.ma.asarray(msg.values))
        cells = {}
        for b, (la, lo_) in BUOYS.items():
            j0 = int(round((la - lats[0, 0]) / (lats[1, 0] - lats[0, 0])))
            i0 = int(round(((lo_ - lons[0, 0]) % 360) / (lons[0, 1] - lons[0, 0])))
            best = None
            for dj in range(-4, 5):
                for di in range(-4, 5):
                    j, i = j0 + dj, i0 + di
                    if not (0 <= j < hs.shape[0] and 0 <= i < hs.shape[1]) or np.ma.is_masked(hs[j, i]):
                        continue
                    if best is None or dj * dj + di * di < best[0]:
                        best = (dj * dj + di * di, j, i)
            if best:
                cells[b] = best[1:]
        _CELLS[key] = cells
    return _CELLS[key]


def _wave_point(cycle, fh, hs_only=False):
    import pygrib
    url = WAVE.format(d=cycle.strftime("%Y%m%d"), hh=cycle.strftime("%H"), fh=fh)
    idx = WS._get(url + ".idx").decode().splitlines()
    i = next(k for k, line in enumerate(idx) if ":HTSGW:surface:" in line)
    lo, hi = int(idx[i].split(":")[1]), int(idx[i + (1 if hs_only else 3)].split(":")[1]) - 1
    msgs = [pygrib.fromstring(m) for m in S.split_grib2(WS._get(url, (lo, hi)))]
    vals = {m.shortName: m.values for m in msgs}
    cells = _cells(msgs[0])
    out = {}
    for b, (j, i) in cells.items():
        out[b] = tuple(float(vals[k][j, i]) for k in (("swh",) if hs_only else ("swh", "perpw", "dirpw")))
    return cycle + timedelta(hours=fh), out


def _wave_job(job):
    try:
        return _wave_point(*job)
    except Exception as e:  # noqa: BLE001 - a missing archive file is recorded, not fatal
        return job[0] + timedelta(hours=job[1]), {"error": str(e)[:200]}


def hs_persistence(a):
    t0 = datetime.strptime(a.start, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    t1 = datetime.strptime(a.end, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    jobs, c = [], t0
    while c < t1:
        jobs += [(c, fh) for fh in range(0, 73, 6)]   # 6-hourly leads: lag 6 h and runs 6 h apart line up
        c += timedelta(hours=6)

    from multiprocessing import Pool
    with Pool(a.jobs) as pool, open(a.hs_persistence, "w", encoding="utf-8") as fh:
        for job, (_v, pts) in zip(jobs, pool.imap(_wave_job, [(c, f, True) for c, f in jobs], chunksize=8)):
            row = {"cycle": job[0].strftime("%Y-%m-%dT%HZ"), "lead": job[1]}
            row.update({"error": pts["error"]} if "error" in pts else {"hs": {b: v[0] for b, v in pts.items()}})
            fh.write(json.dumps(row) + "\n")
    print(f"wrote {a.hs_persistence}: {len(jobs)} files")


def write_stdmet(path, cols, rows):
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("#YY  MM DD hh mm " + " ".join(cols) + "\n#yr  mo dy hr mn " + " ".join("-" for _ in cols) + "\n")
        for t in sorted(rows, reverse=True):
            fh.write(f"{t:%Y %m %d %H %M} " + " ".join(f"{v:.2f}" if isinstance(v, float) else str(v)
                                                       for v in rows[t]) + "\n")


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--start", required=True)
    ap.add_argument("--end", required=True)
    ap.add_argument("--wind-cache", required=True, help="wind_lead_skill.py cache (holds the ISD csv files)")
    ap.add_argument("--jobs", type=int, default=16)
    ap.add_argument("--hs-persistence", metavar="JSONL",
                    help="instead: fetch GFS-Wave FORECAST Hs at the buoys (cycles 00/06/12/18, leads 0-72 every 6 h) "
                         "into JSONL, to measure the Hs error's persistence against the analysis")
    a = ap.parse_args(argv)
    if a.hs_persistence:
        return hs_persistence(a)
    os.makedirs(a.out, exist_ok=True)
    t0 = datetime.strptime(a.start, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    t1 = datetime.strptime(a.end, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    jobs, c = [], t0
    while c < t1:
        jobs += [(c, fh) for fh in range(6)]
        c += timedelta(hours=6)
    from multiprocessing import Pool
    with Pool(a.jobs) as pool:
        got = [g for g in pool.imap(_wave_job, jobs, chunksize=8) if "error" not in g[1]]
    for b in BUOYS:
        rows = {t: (pts[b][0], pts[b][1], pts[b][2]) for t, pts in got if b in pts}
        write_stdmet(os.path.join(a.out, f"{b}.txt"), ("WVHT", "DPD", "MWD"), rows)
    for sid, usaf in WINDS.items():
        obs = S.read_isd(os.path.join(a.wind_cache, f"isd_{usaf}_{t0.year}.csv"))
        rows, last_dir = {}, 0.0
        for t in sorted(obs):
            if t0 <= t < t1:
                spd, d = obs[t]
                last_dir = d if d is not None else last_dir
                rows[t] = (int(round(last_dir)) % 360, float(spd))
        write_stdmet(os.path.join(a.out, f"{sid}.txt"), ("WDIR", "WSPD"), rows)
    for st, amps in TIDES.items():
        preds, t = [], t0 - timedelta(days=1)
        while t <= t1 + timedelta(days=1):
            preds.append({"t": t.strftime("%Y-%m-%d %H:%M"), "v": f"{synthetic_tide(amps, t):.3f}"})
            t += timedelta(hours=1)
        with open(os.path.join(a.out, f"tide_{st}.json"), "w", encoding="utf-8") as fh:
            json.dump({"predictions": preds, "note": "SYNTHETIC astronomical tide (alert_replay_inputs.py)"}, fh)
    print(f"wrote {a.out}: {len(got)} wave hours")


if __name__ == "__main__":
    main()
