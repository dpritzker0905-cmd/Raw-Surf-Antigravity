"""The >90 deg height floor against CDIP MOP, with the coastline normals (served today) and with the fitted exposure normals.

Per spot: MOP's normalised attenuation A(theta) in the >=90 deg bins (n >= 30), exactly as the JAC-1 study normalises it.
The floor estimate is the count-weighted mean of A over those bins. Held-out spots: 5-fold spot cross-validation of the pooled
floor (fit on 4/5 of the spots, score the MSE of a constant floor on the held-out fifth vs today's 0.595), plus a 5000-draw
spot bootstrap 95% CI of the pooled floor itself. Run with JAC1_MOP_DIR and SEN_WORK_DIR set (npz from both studies).
"""
import json
import os

import numpy as np

J = os.environ.get("JAC1_MOP_DIR", "jac1_mop_work/")
W = os.environ.get("SEN_WORK_DIR", "sen_work/")
recs = json.load(open(os.path.join(W, "ext", "fit_all.json")))
edges = np.arange(0, 181, 10)
cent = edges[:-1] + 5
MINN = 30
FLOOR_TODAY = 0.595


def fchain(th):
    th = np.asarray(th, float)
    return 0.55 + 0.45 * (0.10 + 0.90 * np.maximum(0, np.cos(np.radians(th))))


def wrap(a):
    return np.abs((a + 180) % 360 - 180)


def npz(i):
    for d in (os.path.join(J, "dl", "npz"), os.path.join(W, "ext", "npz")):
        p = os.path.join(d, f"{i}.npz")
        if os.path.exists(p):
            return np.load(p)
    raise FileNotFoundError(i)


def load(r):
    m, b = npz(r["mop"]), npz(r["buoy"])
    ok = (b["fl"] == 1) & np.isfinite(b["hs"]) & np.isfinite(b["dp"])
    idx = {int(t): i for i, t in enumerate(b["t"].astype(np.int64)) if ok[i]}
    sel = [(j, idx[int(t)]) for j, t in enumerate(m["t"].astype(np.int64)) if int(t) in idx]
    J_ = np.array([a for a, _ in sel])
    I_ = np.array([c for _, c in sel])
    hm, hb, dp = m["hs"][J_], b["hs"][I_], b["dp"][I_]
    g = np.isfinite(hm) & (hm > 0) & (hb >= 0.5)
    return hm[g] / hb[g], dp[g]


def beyond90(r_, dp, normal):
    th = wrap(dp - normal)
    ref = th < 30
    if ref.sum() < MINN:
        ref = th < 60
    if ref.sum() < MINN:
        return []
    rr, fr = float(np.median(r_[ref])), float(np.mean(fchain(th[ref])))
    k = np.clip(np.digitize(th, edges) - 1, 0, 17)
    out = []
    for i in range(9, 18):
        sel = k == i
        if sel.sum() >= MINN:
            out.append((int(sel.sum()), float(np.median(r_[sel])) / rr * fr))
    return out


def study(normal_key):
    per = []
    for r in recs:
        try:
            r_, dp = load(r)
        except FileNotFoundError:
            continue
        bins = beyond90(r_, dp, float(r[normal_key]))
        if bins:
            per.append((r["name"], bins))
    allb = [b for _, bs in per for b in bs]
    w = np.array([n for n, _ in allb], float)
    a = np.array([x for _, x in allb])
    pooled = float(np.sum(w * a) / w.sum())
    rng = np.random.default_rng(7)
    boots = []
    for _ in range(5000):
        pick = rng.integers(0, len(per), len(per))
        bs = [b for i in pick for b in per[i][1]]
        ww = np.array([n for n, _ in bs], float)
        aa = np.array([x for _, x in bs])
        boots.append(float(np.sum(ww * aa) / ww.sum()))
    ci = np.percentile(boots, [2.5, 97.5])
    folds = np.array_split(rng.permutation(len(per)), 5)
    cv_new, cv_old = [], []
    for f in folds:
        tr = [b for i in range(len(per)) if i not in set(f) for b in per[i][1]]
        te = [b for i in f for b in per[i][1]]
        fl = sum(n * x for n, x in tr) / sum(n for n, _ in tr)
        tw = sum(n for n, _ in te)
        cv_new.append(sum(n * (x - fl) ** 2 for n, x in te) / tw)
        cv_old.append(sum(n * (x - FLOOR_TODAY) ** 2 for n, x in te) / tw)
    return {"normals": normal_key, "spots_with_bins": len(per), "bins": len(allb), "hours": int(w.sum()),
            "pooled_floor": round(pooled, 4), "ci95": [round(float(ci[0]), 4), round(float(ci[1]), 4)],
            "cv_mse_refit": round(float(np.mean(cv_new)), 4), "cv_mse_today": round(float(np.mean(cv_old)), 4)}


for key in ("chain_normal", "fit_normal"):
    print(json.dumps(study(key)))
