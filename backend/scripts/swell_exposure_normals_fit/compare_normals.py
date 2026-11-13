"""Which shore normal makes the chain's angular height factor track CDIP MOP? Chain (ETOPO/coarse) vs MOP metaShoreNormal.

Uses the JAC-1 study's matched MOP/buoy subsets (JAC1_MOP_DIR/dl/npz, spots.json). For each spot and each normal:
  metric 1: count-weighted MSE between the chain's own factor f(theta) and MOP's attenuation A(theta) over ALL 10-deg bins
            with n >= 30 (A normalised to the head-on reference exactly as the JAC-1 study did);
  metric 2: the empirical head-on bearing: the swell-from direction (5-deg bins, n >= 30) where MOP's Hs ratio peaks,
            and each normal's angular distance to it.
"""
import json
import os

import numpy as np

B = os.environ.get("JAC1_MOP_DIR", "jac1_mop_work/")
spots = json.load(open(os.path.join(B, "spots.json")))
edges = np.arange(0, 181, 10)
cent = edges[:-1] + 5
MINN = 30


def fchain(th):
    th = np.asarray(th, float)
    return 0.55 + 0.45 * (0.10 + 0.90 * np.maximum(0, np.cos(np.radians(th))))


def wrap(a):
    return np.abs((a + 180) % 360 - 180)


def load(s):
    m = np.load(os.path.join(B, "dl", "npz", f"{s['mop']}.npz"))
    b = np.load(os.path.join(B, "dl", "npz", f"{s['buoy']}.npz"))
    ok = (b["fl"] == 1) & np.isfinite(b["hs"]) & np.isfinite(b["dp"])
    idx = {int(t): i for i, t in enumerate(b["t"].astype(np.int64)) if ok[i]}
    sel = [(j, idx[int(t)]) for j, t in enumerate(m["t"].astype(np.int64)) if int(t) in idx]
    J = np.array([a for a, _ in sel])
    Ii = np.array([c for _, c in sel])
    hm, hb, dp = m["hs"][J], b["hs"][Ii], b["dp"][Ii]
    g = np.isfinite(hm) & (hm > 0) & (hb >= 0.5)
    return hm[g] / hb[g], dp[g]


def mse_all(r, dp, normal):
    th = wrap(dp - normal)
    k = np.clip(np.digitize(th, edges) - 1, 0, 17)
    mm = th < 30
    if mm.sum() < MINN:
        mm = th < 60
    if mm.sum() < MINN:
        return None, 0
    ref, fref = float(np.median(r[mm])), float(np.mean(fchain(th[mm])))
    w, a, p = [], [], []
    for i in range(18):
        sel = k == i
        if sel.sum() >= MINN:
            w.append(sel.sum())
            a.append(float(np.median(r[sel])) / ref * fref)
            p.append(float(fchain(cent[i])))
    w, a, p = np.array(w, float), np.array(a), np.array(p)
    return float(np.sum(w * (a - p) ** 2) / np.sum(w)), int(w.sum())


def peak_bearing(r, dp):
    bins = np.arange(0, 361, 5)
    k = np.clip(np.digitize(dp % 360, bins) - 1, 0, 71)
    best, bv = None, -1
    for i in range(72):
        sel = k == i
        if sel.sum() >= MINN:
            v = float(np.median(r[sel]))
            if v > bv:
                best, bv = bins[i] + 2.5, v
    return best


rows = []
for s in spots:
    r, dp = load(s)
    mop_n = s["mop_meta"]["metaShoreNormal"]
    mc, n = mse_all(r, dp, s["normal"])
    mm, _ = mse_all(r, dp, mop_n)
    pk = peak_bearing(r, dp)
    rows.append({"name": s["name"], "chain": s["normal"], "mop": mop_n, "n": n, "mse_chain": mc, "mse_mop": mm, "peak": pk,
                 "chain_to_peak": None if pk is None else float(wrap(s["normal"] - pk)),
                 "mop_to_peak": None if pk is None else float(wrap(mop_n - pk))})
    x = rows[-1]
    print(f"{x['name'][:22]:22s} chain {x['chain']:6.1f} mop {x['mop']:6.1f} peak {x['peak']} | MSE chain {x['mse_chain']:.4f} "
          f"mop {x['mse_mop']:.4f} | to peak: chain {x['chain_to_peak']:.0f} mop {x['mop_to_peak']:.0f}")
w = np.array([x["n"] for x in rows], float)
mc = np.array([x["mse_chain"] for x in rows])
mm = np.array([x["mse_mop"] for x in rows])
print(f"POOLED count-weighted MSE over all angles: chain {np.sum(w * mc) / w.sum():.4f}  mop {np.sum(w * mm) / w.sum():.4f}; "
      f"mop better at {int((mm < mc).sum())}/{len(rows)} spots")
cp = [x["chain_to_peak"] for x in rows if x["peak"] is not None]
mp = [x["mop_to_peak"] for x in rows if x["peak"] is not None]
print(f"distance to MOP's empirical head-on bearing: chain median {np.median(cp):.1f} deg, mop median {np.median(mp):.1f} deg")
json.dump(rows, open(os.path.join(os.environ.get("NORMALS_DIR", "normals_work/"), "compare.json"), "w"), indent=1)
