"""Native GFS-Wave R1/R2 (read-only, NOAA public AWS). Is the served GFS energy-closure failure physics or our pipeline?

Same rule as backend/services/frame_physics_check.py: cells with total > 0.25 m and a valid partition;
R1 max(p) > H + 0.05; R2 sum(p^2) > 1.1 H^2. Partitions = the layers we serve (swell_1, swell_2, wind_waves),
and, as a second arm, all four GFS partitions (+ swell_3).
"""
import json
import sys
import urllib.request

import numpy as np
from gribberish import parse_grib_message

BASE = "https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.{d}/{c}/wave/gridded/gfswave.t{c}z.global.0p25.f{f:03d}.grib2"
WANT = {("HTSGW", "surface"): "H", ("WVHGT", "surface"): "ww", ("SWELL", "1 in sequence"): "s1",
        ("SWELL", "2 in sequence"): "s2", ("SWELL", "3 in sequence"): "s3"}


def get(url, rng=None):
    req = urllib.request.Request(url, headers={"Range": f"bytes={rng[0]}-{rng[1]}"} if rng else {})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def fields(d, c, f):
    url = BASE.format(d=d, c=c, f=f)
    rows = [ln.split(":") for ln in get(url + ".idx").decode().splitlines() if ln]
    out = {}
    for i, r in enumerate(rows):
        key = (r[3], r[4])
        if key in WANT:
            start = int(r[1])
            end = int(rows[i + 1][1]) - 1 if i + 1 < len(rows) else None
            raw = get(url, (start, end))
            msg = parse_grib_message(raw, 0)
            a = np.asarray(msg.data(), dtype=float)
            a = a.reshape(721, 1440) if a.size == 721 * 1440 else a
            a[(a > 1e10) | (a < -1e10)] = np.nan
            out[WANT[key]] = a
    return out


def rules(H, parts, tag):
    P = np.stack(parts)
    pv = np.isfinite(P)
    cells = np.isfinite(H) & (H > 0.25) & pv.any(axis=0)
    Pz = np.where(pv, P, 0.0)
    n = int(cells.sum())
    r1 = cells & (Pz.max(axis=0) > H + 0.05)
    s2 = (Pz ** 2).sum(axis=0)
    r2 = cells & (s2 > 1.1 * H ** 2)
    r2_strict = cells & (s2 > 1.0 * H ** 2 + 1e-6)
    ratio = np.where(cells, s2 / np.maximum(H ** 2, 1e-12), np.nan)
    return {"arm": tag, "cells": n, "r1": int(r1.sum()), "r1_rate": round(r1.sum() / n, 4),
            "r2": int(r2.sum()), "r2_rate": round(r2.sum() / n, 4), "r2_strict_rate": round(r2_strict.sum() / n, 4),
            "ratio_p50": round(float(np.nanmedian(ratio)), 3), "ratio_p99": round(float(np.nanpercentile(ratio, 99)), 3),
            "ratio_max": round(float(np.nanmax(ratio)), 3)}


def block(a, k, how):
    r, c = (a.shape[0] // k) * k, (a.shape[1] // k) * k
    b = a[:r, :c].reshape(r // k, k, c // k, k)
    if how == "mean":
        return np.nanmean(b, axis=(1, 3))
    return b[:, k // 2, :, k // 2]          # centre point


if __name__ == "__main__":
    d, c = sys.argv[1], sys.argv[2]
    res = []
    for f in [int(x) for x in sys.argv[3].split(",")]:
        F = fields(d, c, f)
        H = F["H"]
        served = [F["s1"], F["s2"], F["ww"]]
        allp = served + [F["s3"]]
        res.append(dict(rules(H, served, "native 0.25 served layers"), lead=f))
        res.append(dict(rules(H, allp, "native 0.25 all 4 partitions"), lead=f))
        for how in ("mean", "centre"):
            import warnings
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                res.append(dict(rules(block(H, 8, how), [block(p, 8, how) for p in served], f"2-deg {how} of each layer"), lead=f))
        # mixed: total centre-point, partitions block-mean (a method mismatch)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            res.append(dict(rules(block(H, 8, "centre"), [block(p, 8, "mean") for p in served], "2-deg H centre, p mean"), lead=f))
        print(json.dumps(res[-5:]), flush=True)
    json.dump(res, open(sys.argv[4], "w"), indent=1)
