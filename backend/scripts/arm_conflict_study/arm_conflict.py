"""Why does the #773 arm read MOP-fitted exposure normals as WORSE? Offline tests of hypotheses (a) and (c).

(a) LOCATION: the arm's truth is the CDIP STATION's own Hs (1.5-10 km from the anchor spot), which carries the station's
    exposure, not the spot's. Fit an effective normal to the STATION's response (station Hs / offshore Hs vs offshore
    direction) exactly as the spot fit was done, and score the chain factor under each normal against BOTH truths.
(c) SEASON: re-score the spot hold-out (2024-01..2025-03) on SON hours only (the arm's window is late October).
Data: CDIP archives (stations + offshore buoys) and MOP v1.1 alongshore hindcast, 2022-01..2025-03, every 2nd hour.
"""
import json
import os
import sys

import numpy as np

S = os.environ.get("SEN_WORK_DIR", "sen_work/").rstrip("/") + "/"
J = os.environ.get("JAC1_MOP_DIR", "jac1_mop_work/").rstrip("/") + "/"
sys.path.insert(0, S)
NPZ = [J + "dl/npz/", S + "ext/npz/", S + "arm/npz/"]
os.makedirs(S + "arm/npz/", exist_ok=True)
T0, T1 = 1640995200, 1743465600
SPLIT = 1704067200
edges = np.arange(0, 181, 10)
cent = edges[:-1] + 5
MINN = 30
ANCHORS = [  # station, anchor spot (in fit_all.json), offshore driver buoy
    ("103p1", "Topanga", "067p1"), ("142p1", "Rodeo Beach", "029p1"), ("153p1", "Blacks Beach", "067p1"),
    ("201p1", "La Jolla Shores", "067p1"), ("264p1", "San Onofre", "067p1"), ("284p1", "Upper Trestles", "067p1"),
    ("285p1", "Pismo Beach Pier", "071p1"),
]


def fetch_buoy(i):
    import netCDF4
    f = S + f"arm/npz/{i}.npz"
    if any(os.path.exists(d + f"{i}.npz") for d in NPZ):
        return True
    try:
        d = netCDF4.Dataset(f"https://thredds.cdip.ucsd.edu/thredds/dodsC/cdip/archive/{i}/{i}_historic.nc")
        t = np.asarray(d["waveTime"][:])
        i0, i1 = int(np.searchsorted(t, T0)), int(np.searchsorted(t, T1))
        np.savez(f, t=t[i0:i1], hs=np.ma.filled(d["waveHs"][i0:i1], np.nan), dp=np.ma.filled(d["waveDp"][i0:i1], np.nan),
                 tp=np.ma.filled(d["waveTp"][i0:i1], np.nan), fl=np.ma.filled(d["waveFlagPrimary"][i0:i1], 9))
        d.close()
        return True
    except Exception as e:
        print("fetch failed", i, str(e)[:100])
        return False


def npz(i):
    for d in NPZ:
        if os.path.exists(d + f"{i}.npz"):
            return np.load(d + f"{i}.npz")
    raise FileNotFoundError(i)


def fchain(th):
    th = np.asarray(th, float)
    return 0.55 + 0.45 * (0.10 + 0.90 * np.maximum(0, np.cos(np.radians(th))))


def wrap(a):
    return np.abs((a + 180) % 360 - 180)


def pair(target, off, is_buoy_target):
    """Matched (ratio target/offshore, offshore Dp, time) on hours both have (2-hourly MOP grid or buoy times)."""
    a, b = npz(target), npz(off)
    okb = (b["fl"] == 1) & np.isfinite(b["hs"]) & np.isfinite(b["dp"])
    idx = {int(t) - int(t) % 3600: i for i, t in enumerate(b["t"].astype(np.int64)) if okb[i]}
    ta = a["t"].astype(np.int64)
    oka = np.isfinite(a["hs"]) & (a["hs"] > 0)
    if is_buoy_target:
        oka &= a["fl"] == 1
    rows = [(j, idx[int(t) - int(t) % 3600]) for j, t in enumerate(ta) if oka[j] and int(t) - int(t) % 3600 in idx]
    if not rows:
        return None
    jj = np.array([r[0] for r in rows])
    ii = np.array([r[1] for r in rows])
    hb = b["hs"][ii]
    g = hb >= 0.5
    return a["hs"][jj][g] / hb[g], b["dp"][ii][g], ta[jj][g]


def mse(r, dp, normal):
    th = wrap(dp - normal)
    k = np.clip(np.digitize(th, edges) - 1, 0, 17)
    ref = th < 30
    if ref.sum() < MINN:
        ref = th < 60
    if ref.sum() < MINN:
        return None
    rr, fr = float(np.median(r[ref])), float(np.mean(fchain(th[ref])))
    w, a, p = [], [], []
    for i in range(18):
        sel = k == i
        if sel.sum() >= MINN:
            w.append(sel.sum())
            a.append(float(np.median(r[sel])) / rr * fr)
            p.append(float(fchain(cent[i])))
    if not w:
        return None
    w, a, p = np.array(w, float), np.array(a), np.array(p)
    return float(np.sum(w * (a - p) ** 2) / np.sum(w))


def fit(r, dp):
    c = [(mse(r, dp, n), n) for n in range(360)]
    c = [x for x in c if x[0] is not None]
    return min(c)[1] if c else None


fits = {x["name"]: x for x in json.load(open(S + "ext/fit_all.json"))}
out = []
for st, spot, off in ANCHORS:
    if not fetch_buoy(st):
        continue
    f = fits[spot]
    stp = pair(st, off, True)
    mop = pair(f["mop"], off, False)
    if stp is None or mop is None:
        print(st, "no overlap")
        continue
    r_s, dp_s, t_s = stp
    r_m, dp_m, t_m = mop
    tr_s, te_s = t_s < SPLIT, t_s >= SPLIT
    n_station = fit(r_s[tr_s], dp_s[tr_s])
    son_m = np.isin(((t_m // 86400 + 3) // 30.44 % 12).astype(int), [8, 9, 10])   # approx Sep-Nov by day-of-year
    te_m = t_m >= SPLIT
    rec = {"station": st, "spot": spot, "chain": f["chain_normal"], "spot_fit": f["fit_normal"], "station_fit": n_station,
           "n_station_hours": int(len(r_s)),
           # (a): each normal scored against the STATION truth (what the arm sees) and the MOP SPOT truth (held-out)
           "station_truth": {k: mse(r_s[te_s], dp_s[te_s], v) for k, v in
                             (("chain", f["chain_normal"]), ("spot_fit", f["fit_normal"]), ("station_fit", n_station))},
           "mop_spot_truth": {k: mse(r_m[te_m], dp_m[te_m], v) for k, v in
                              (("chain", f["chain_normal"]), ("spot_fit", f["fit_normal"]))},
           # (c): the spot hold-out on autumn hours only
           "mop_spot_truth_SON": {k: mse(r_m[te_m & son_m], dp_m[te_m & son_m], v) for k, v in
                                  (("chain", f["chain_normal"]), ("spot_fit", f["fit_normal"]))}}
    out.append(rec)
    print(json.dumps(rec))
json.dump(out, open(S + "arm/arm_conflict.json", "w"), indent=1)
