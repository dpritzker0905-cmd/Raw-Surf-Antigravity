"""wind_lr_mirror_check.py - the sameness control for a second-mirror fill (advisor 2026-11-18 00:00Z, condition 4).

Compares the second mirror against what was ALREADY HELD from the S3 copy, not against a fresh S3 read (addendum
2026-11-18, option b: S3 answered 503 to the first live comparison, run 44264197330, so S3 is taken out of the check).
For run 2026-10-02 00Z (held by run 43952101715, not one of the twelve):

1. the 336 h ENS `ef` `.index` read from the mirror must equal the hand measurement of 2026-11-17 20:10 EST, where
   both mirrors served the same 2,012,998 bytes (sha256 below);
2. the station values decoded from the mirror must EQUAL the station values held in that run's file, element for
   element (float32, NaN = NaN), through the same decoder the collection uses: ENS 10u/10v/10fg at 180 and 336 h,
   HRES 10u/10v at 240 h, AIFS-ENS 10u/10v at 336 h.

The run file keeps decoded station values only, not raw GRIB bytes, so (2) is a decoded-value comparison: identical
bytes give identical values; a different field gives different values. Any difference exits 1 (stop, no collection,
no score). Anything that keeps the comparison from completing (a read error, a missing held file or key) exits 2:
NOT COMPLETED is never a pass. Reads public ECMWF open data only; serves nothing.
"""
import argparse
import glob
import hashlib
import json
import os
import sys
from datetime import datetime, timezone

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from services.weather_pipeline import ens_wind_fetch as ef  # noqa: E402

GCS = "https://storage.googleapis.com/ecmwf-open-data"
CHECK_RUN = datetime(2026, 10, 2, 0, tzinfo=timezone.utc)      # held from S3 by run 43952101715 (not in the 12)
HAND_INDEX_BYTES = 2012998                                      # 336 h ef .index, measured 2026-11-17 20:10 EST
HAND_INDEX_SHA256 = "b42b52eaf9a58d3e4c66432b07faddd85f913a58624da984913a7fc399d90d34"  # 64 hex; see addendum


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def find_held(prior_dir: str, run=CHECK_RUN) -> str:
    """Path of the held run file; raises if the reused run's artifacts do not carry it."""
    hits = sorted(glob.glob(os.path.join(prior_dir, "**", f"{run:%Y%m%d%H}.npz"), recursive=True))
    if not hits:
        raise FileNotFoundError(f"no held {run:%Y%m%d%H}.npz under {prior_dir}")
    return hits[0]


def same_values(a, b) -> bool:
    a, b = np.asarray(a, dtype=np.float32), np.asarray(b, dtype=np.float32)
    return a.shape == b.shape and bool(np.array_equal(a, b, equal_nan=True))


def max_abs_diff(a, b) -> float:
    a, b = np.asarray(a, dtype=np.float64), np.asarray(b, dtype=np.float64)
    if a.shape != b.shape:
        return float("inf")
    d = np.abs(a - b)
    return float(np.nanmax(d)) if np.isfinite(d).any() else 0.0


def index_row(session, run=CHECK_RUN, base=GCS):
    """('ens ef 336 index vs hand measurement', expected, got); raises when the read does not complete."""
    r = ef._get(session, ef.ef_url(base, run, 336, "index"))
    if r.status_code != 200:
        raise RuntimeError(f"336 h index: HTTP {r.status_code} from {base}")
    got = f"{len(r.content)} bytes {sha(r.content)}"
    return ("ens ef 336 index vs hand measurement", f"{HAND_INDEX_BYTES} bytes {HAND_INDEX_SHA256}", got)


def mirror_values(session, run, lats, lons, base=GCS):
    """{held key: station values} decoded from `base` through the collection's own readers."""
    import wind_lr_hindcast as H
    from services.weather_pipeline import ens_wind_core as ec
    if H.ENS_BASE != base:
        raise RuntimeError(f"WLR_ENS_BASE is {H.ENS_BASE}, not {base}: the check would not read the mirror")

    def at_stations(arr, meta):
        return ec.bilinear(arr, meta, lats, lons)
    out = {}
    for step in (180, 336):
        f, _m = ef.fetch_step(session, run, step, at_stations, base=base)
        for p in ef.PARAMS:
            out[f"ens_{p}_{step}"] = f[p].astype(np.float32)
    h = H._ecmwf_det(session, run, 240, lats, lons)
    for p in ("10u", "10v"):
        out[f"hres_{p}_240"] = h[p].astype(np.float32)
    f, _m = ef.fetch_step(session, run, 336, at_stations, params=("10u", "10v"), model="aifs-ens",
                          file_types=("cf", "pf"), base=base)
    for p in ("10u", "10v"):
        out[f"aifs_{p}_336"] = f[p].astype(np.float32)
    return out


def value_rows(held: dict, got: dict):
    """[(key, same, max_abs_diff)]; raises KeyError when the held file lacks a compared key."""
    rows = []
    for k, v in got.items():
        if k not in held:
            raise KeyError(f"held run file has no {k}")
        rows.append((k, same_values(held[k], v), max_abs_diff(held[k], v)))
    return rows


def main(argv=None):
    """A failed or throttled fetch, or a missing held file, is NOT a pass: it exits 2 and the collection never starts
    without a completed comparison (advisor 2026-11-18 01:30Z, edit 1)."""
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", required=True, help="holds wind_lr_stations.json and gfs_land.npy (this run's freeze)")
    ap.add_argument("--prior", required=True, help="the reused run's run files (wind-lr-runs-* of 43952101715)")
    a = ap.parse_args(argv)
    try:
        import requests
        import wind_lr_hindcast as H
        import wind_lr_obs as obs
        s = requests.Session()
        held_path = find_held(a.prior)
        held = dict(np.load(held_path))
        doc = json.load(open(os.path.join(a.cache, "wind_lr_stations.json")))
        land, meta = obs.gfs_land(s, a.cache)
        lats, lons = H.sample_points(doc["ndbc"] + doc["asos"], land, meta)
        idx = index_row(s)
        rows = value_rows(held, mirror_values(s, CHECK_RUN, lats, lons))
    except Exception as e:  # noqa: BLE001 - every error path is a stop, never "no difference found"
        print(f"sameness control on {CHECK_RUN:%Y%m%d%H}: NOT COMPLETED ({e}) - stop; retry later")
        return 2
    print(f"held file: {held_path} ({len(lats)} stations)")
    print(f"{'SAME' if idx[1] == idx[2] else 'DIFFERENT'}  {idx[0]}  expected {idx[1]}  mirror {idx[2]}")
    for k, ok, d in rows:
        print(f"{'SAME' if ok else 'DIFFERENT'}  {k} (held S3 vs mirror)  max |diff| {d:.6g}")
    same = idx[1] == idx[2] and all(ok for _, ok, _ in rows)
    print(f"sameness control on {CHECK_RUN:%Y%m%d%H}: {'PASS' if same else 'FAIL - stop, no collection, no score'}")
    return 0 if same else 1


if __name__ == "__main__":
    sys.exit(main())
