"""Fit a per-spot EFFECTIVE exposure normal to CDIP MOP's response, and test it out of sample (temporal hold-out).

For each JAC-1 study spot: n* = the bearing (1-deg grid) minimising the count-weighted MSE between the chain's own height
factor f(theta) and MOP's normalised attenuation A(theta) over all 10-deg bins (n >= 30), fitted on 2022-01..2023-12 and
scored on 2024-01..2025-03 against the chain normal and MOP's metaShoreNormal on the SAME held-out hours.
"""
import json
import os

import numpy as np

B = os.environ.get("JAC1_MOP_DIR", "jac1_mop_work/")
OUT = os.environ.get("NORMALS_DIR", "normals_work/")
spots = json.load(open(os.path.join(B, "spots.json")))
edges = np.arange(0, 181, 10)
cent = edges[:-1] + 5
MINN = 30
SPLIT = 1704067200          # 2024-01-01T00:00Z


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
    hm, hb, dp, tt = m["hs"][J], b["hs"][Ii], b["dp"][Ii], m["t"][J].astype(np.int64)
    g = np.isfinite(hm) & (hm > 0) & (hb >= 0.5)
    return hm[g] / hb[g], dp[g], tt[g]


def mse(r, dp, normal):
    th = wrap(dp - normal)
    k = np.clip(np.digitize(th, edges) - 1, 0, 17)
    ref_sel = th < 30
    if ref_sel.sum() < MINN:
        ref_sel = th < 60
    if ref_sel.sum() < MINN:
        return None
    ref, fref = float(np.median(r[ref_sel])), float(np.mean(fchain(th[ref_sel])))
    w, a, p = [], [], []
    for i in range(18):
        sel = k == i
        if sel.sum() >= MINN:
            w.append(sel.sum())
            a.append(float(np.median(r[sel])) / ref * fref)
            p.append(float(fchain(cent[i])))
    if not w:
        return None
    w, a, p = np.array(w, float), np.array(a), np.array(p)
    return float(np.sum(w * (a - p) ** 2) / np.sum(w))


rows = []
for s in spots:
    r, dp, tt = load(s)
    tr, te = tt < SPLIT, tt >= SPLIT
    cands = [(mse(r[tr], dp[tr], n), n) for n in range(0, 360)]
    cands = [c for c in cands if c[0] is not None]
    fit = min(cands)[1]
    mop_n = s["mop_meta"]["metaShoreNormal"]
    rec = {"name": s["name"], "chain": s["normal"], "mop": mop_n, "fit": fit, "n_test": int(te.sum()),
           "test_chain": mse(r[te], dp[te], s["normal"]), "test_mop": mse(r[te], dp[te], mop_n),
           "test_fit": mse(r[te], dp[te], fit)}
    rows.append(rec)
    print(f"{rec['name'][:22]:22s} chain {rec['chain']:6.1f} mop {rec['mop']:6.1f} FIT {fit:4d} | held-out MSE "
          f"chain {rec['test_chain']:.4f} mop {rec['test_mop']:.4f} fit {rec['test_fit']:.4f} (n {rec['n_test']})")
ok = [x for x in rows if None not in (x["test_chain"], x["test_mop"], x["test_fit"])]
w = np.array([x["n_test"] for x in ok], float)
for k in ("test_chain", "test_mop", "test_fit"):
    print(k, round(float(np.sum(w * np.array([x[k] for x in ok])) / w.sum()), 4))
print("fit beats chain out of sample at", sum(x["test_fit"] < x["test_chain"] for x in ok), "of", len(ok))
# bootstrap CI (spot resampling) of the pooled improvement chain - fit
rng = np.random.default_rng(7)
d = np.array([x["test_chain"] - x["test_fit"] for x in ok])
boot = [float(np.sum(w[i] * d[i]) / w[i].sum()) for i in (rng.integers(0, len(ok), len(ok)) for _ in range(5000))]
print("pooled improvement chain-fit:", round(float(np.sum(w * d) / w.sum()), 4), "95% CI", np.round(np.percentile(boot, [2.5, 97.5]), 4))
json.dump(rows, open(os.path.join(OUT, "fit.json"), "w"), indent=1)
