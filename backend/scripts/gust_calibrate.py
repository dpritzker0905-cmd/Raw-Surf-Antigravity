"""gust_calibrate.py - calibrated gusts (EMOS, a 0-truncated normal per model) fitted and scored OUT OF SAMPLE on the gust
verification record (#1063). Serves nothing: it reads the record's local files and writes a report.

Method (pre-registered BEFORE this file existed): docs/weather-program/log/2026-11-23-claude-gust-calibration.md section 1.
This file implements it and must not drift from it. In short:
  * one calibration per model (GFS / EURO / ICON), never pooled or blended across models (D-076);
  * strata = lead bin x gust window w x land/sea; < 2,000 training rows -> land+sea pooled; still short -> RAW (identity);
  * C: mu = a + b*G + c*W, sigma = exp(d + e*G/10), minimum mean CRPS; served number = the predictive MEDIAN;
  * targets at 10 m (the #1063 log law): GFS the hourly GST; EURO / ICON the DENSE window maximum (sparse = sensitivity);
  * out of sample: weekly rolling origin (train on VALID times before the test week, trailing 45 days, >= 14 days) x 5 folds
    of the D-066 100 km station blocks;
  * gates G1-G6 and controls NULL / POSITIVE 1 / POSITIVE 2 / LEAK, the two-way block x day interval of eval_twoway.

numpy only (scipy is not in backend/requirements.txt): the normal CDF is Numerical Recipes' erfc (fractional error < 1.2e-7
everywhere, tails included), its inverse is Acklam's (relative error < 1.2e-9), and the optimizer is a 5-parameter BFGS.

  python gust_calibrate.py --dir D --out calib_report.json --md calib_table.md [--workers 4]
"""
from __future__ import annotations

import argparse
import json
import math
import os
import random
import sys
from datetime import datetime, timezone

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))

import gust_verify_score as S  # noqa: E402
from services.weather_pipeline import eval_twoway as T  # noqa: E402

KN_PER_MS = 3600.0 / 1852.0
THRESH_KN = (25, 34, 48)
MIN_TRAIN = 2000
TRAIN_DAYS = 45
MIN_TRAIN_DAYS = 14
FOLDS = 5
STORM_KN = 34
STORM_MIN_EVENTS = 50
REPS = 2000
SEED_CI = 20261103
SQ2, SQPI = math.sqrt(2.0), math.sqrt(math.pi)
START = np.array([0.0, 1.0, 0.0, math.log(2.0), 0.0])


def window(model, f):
    """The gust window in hours ending at step f (gust_verify_collect.euro_window / icon_window; GFS 0 = instantaneous)."""
    f = np.asarray(f)
    if model == "EURO":
        return np.where(f <= 90, 1, np.where(f <= 144, 3, 6))
    if model == "ICON":
        return np.where(f <= 78, 1, 3)
    return np.zeros_like(f)


# ---------------------------------------------------------------------------------------------------- normal helpers (numpy)
def erfc(x):
    """Numerical Recipes erfcc: fractional error < 1.2e-7 everywhere."""
    x = np.asarray(x, dtype=float)
    z = np.abs(x)
    t = 1.0 / (1.0 + 0.5 * z)
    r = t * np.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (
        -0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))))
    return np.where(x >= 0, r, 2.0 - r)


def ncdf(x):
    return 0.5 * erfc(-np.asarray(x, dtype=float) / SQ2)


def npdf(x):
    x = np.asarray(x, dtype=float)
    return np.exp(-0.5 * x * x) / math.sqrt(2.0 * math.pi)


_A = (-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02,
      -3.066479806614716e+01, 2.506628277459239e+00)
_B = (-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01,
      -1.328068155288572e+01)
_C = (-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00,
      4.374664141464968e+00, 2.938163982698783e+00)
_D = (7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00)


def ninv(p):
    """Acklam's inverse normal CDF, p in (0, 1)."""
    p = np.clip(np.asarray(p, dtype=float), 1e-300, 1 - 1e-16)
    out = np.empty_like(p)
    lo, hi = p < 0.02425, p > 1 - 0.02425
    mid = ~(lo | hi)

    def tail(q):
        return (((((_C[0] * q + _C[1]) * q + _C[2]) * q + _C[3]) * q + _C[4]) * q + _C[5]) / \
               ((((_D[0] * q + _D[1]) * q + _D[2]) * q + _D[3]) * q + 1)
    q = np.sqrt(-2 * np.log(p[lo]))
    out[lo] = tail(q)
    q = np.sqrt(-2 * np.log(1 - p[hi]))
    out[hi] = -tail(q)
    q = p[mid] - 0.5
    r = q * q
    out[mid] = (((((_A[0] * r + _A[1]) * r + _A[2]) * r + _A[3]) * r + _A[4]) * r + _A[5]) * q / \
               (((((_B[0] * r + _B[1]) * r + _B[2]) * r + _B[3]) * r + _B[4]) * r + 1)
    return out


# ---------------------------------------------------------------------------------------------------- the 0-truncated normal
def crps_tn0(mu, sig, y):
    """CRPS of N(mu, sig^2) truncated below at 0 (Thorarinsdottir & Gneiting 2010)."""
    p = np.maximum(ncdf(mu / sig), 1e-12)
    z = (y - mu) / sig
    return sig / p ** 2 * (z * p * (2 * ncdf(z) + p - 2) + 2 * npdf(z) * p - ncdf(SQ2 * mu / sig) / SQPI)


def median_tn0(mu, sig):
    return np.maximum(0.0, mu + sig * ninv(0.5 + 0.5 * ncdf(-mu / sig)))


def exceed_tn0(mu, sig, t):
    """P(Y >= t) for t >= 0."""
    return np.clip(ncdf((mu - t) / sig) / np.maximum(ncdf(mu / sig), 1e-12), 0.0, 1.0)


def musig(theta, G, W):
    a, b, c, d, e = theta
    return a + b * G + c * W, np.exp(np.clip(d + e * G / 10.0, -5.0, 5.0))


def mean_crps(theta, G, W, y):
    mu, sig = musig(theta, G, W)
    return float(np.mean(crps_tn0(mu, sig, y)))


def grad_crps(theta, G, W, y):
    """Gradient of the mean CRPS: per-row central differences in (mu, sigma), then the chain rule to the 5 parameters."""
    mu, sig = musig(theta, G, W)
    hm = 1e-5 * (1.0 + np.abs(mu))
    hs = 1e-5 * sig
    dmu = (crps_tn0(mu + hm, sig, y) - crps_tn0(mu - hm, sig, y)) / (2 * hm)
    dsg = (crps_tn0(mu, sig + hs, y) - crps_tn0(mu, sig - hs, y)) / (2 * hs) * sig
    return np.array([dmu.mean(), (dmu * G).mean(), (dmu * W).mean(), dsg.mean(), (dsg * G / 10.0).mean()])


def fit_emos(G, W, y, theta0=START, iters=200):
    """Minimum mean CRPS by BFGS with Armijo backtracking (5 parameters)."""
    th = np.array(theta0, dtype=float)
    f, g = mean_crps(th, G, W, y), grad_crps(th, G, W, y)
    H = np.eye(5)
    for _ in range(iters):
        p = -H @ g
        if g @ p >= 0:
            H, p = np.eye(5), -g
        step = 1.0
        while step > 1e-10:
            th2 = th + step * p
            f2 = mean_crps(th2, G, W, y)
            if np.isfinite(f2) and f2 <= f + 1e-4 * step * (g @ p):
                break
            step *= 0.5
        else:
            break
        g2 = grad_crps(th2, G, W, y)
        s, yk = th2 - th, g2 - g
        sy = s @ yk
        if sy > 1e-12:
            rho = 1.0 / sy
            V = np.eye(5) - rho * np.outer(s, yk)
            H = V @ H @ V.T + rho * np.outer(s, s)
        done = abs(f - f2) < 1e-10 * max(1.0, abs(f)) or np.linalg.norm(g2) < 1e-7
        th, f, g = th2, f2, g2
        if done:
            break
    return th


def fit_factor(W, y):
    """k minimising mean |y - k W| (a weighted median of y / W, weights W)."""
    ok = W > 0
    if not ok.any():
        return 1.0
    r, w = y[ok] / W[ok], W[ok]
    o = np.argsort(r)
    cw = np.cumsum(w[o])
    return float(r[o][np.searchsorted(cw, 0.5 * cw[-1])])


# ---------------------------------------------------------------------------------------------------- the record
def load(d, models=S.MODELS):
    """Per model: numpy columns of every pair with G, W and the target present (pre-registration section 1)."""
    stations, pairs, cycles, _ = S.build_pairs(d)
    land = np.array([1 if s.get("land") == 1 else 0 for s in stations])
    out = {}
    for m in models:
        P = pairs[m]
        if len(P) == 0:
            continue
        c = {k: np.frombuffer(P.c[k], dtype=np.float32 if k in P.COLS_F else np.int32).astype(float)
             for k in P.COLS_F + P.COLS_I}
        tgt = (c["ob"] if m == "GFS" else c["dense"]) * c["adj"]
        keep = np.isfinite(c["fc"]) & np.isfinite(c["wind"]) & np.isfinite(tgt)
        st = c["st"][keep].astype(int)
        f = c["f"][keep].astype(int)
        out[m] = {"G": c["fc"][keep], "W": c["wind"][keep], "y": tgt[keep], "y_sparse": (c["ob"] * c["adj"])[keep],
                  "f": f, "w": window(m, f), "bin": np.array([S.BINS.index(_bin(x)) for x in f]),
                  "land": land[st], "st": st, "v": c["v"][keep].astype(int), "cycle": c["cycle"][keep].astype(int),
                  "n_cycles": len(set(cycles[m]))}
    return stations, out


def _bin(f):
    for lo, hi in S.BINS:
        if lo <= f <= hi:
            return (lo, hi)
    raise ValueError(f)


def station_folds(stations, folds=FOLDS):
    """(block name per station index, fold per station index): D-066 blocks dealt round robin in sorted-name order."""
    coords = {s["id"]: (s["lat"], s["lon"]) for s in stations}
    blk = T.spatial_blocks(coords)
    names = sorted(set(blk.values()))
    fold_of = {b: i % folds for i, b in enumerate(names)}
    return [blk[s["id"]] for s in stations], np.array([fold_of[blk[s["id"]]] for s in stations])


def weeks(D):
    """[(start hour, end hour)] of the test weeks: the first starts once 14 days of training valid times exist."""
    day0 = int(D["cycle"].min()) // 24
    last = int(D["cycle"].max()) // 24
    out, s = [], day0 + MIN_TRAIN_DAYS
    while s <= last:
        out.append((s * 24, (s + 7) * 24))
        s += 7
    return out


# ---------------------------------------------------------------------------------------------------- out-of-sample run
_JOB = {}                                   # (D, fold) for the worker processes (fork inherits it; nothing is pickled back but rows)
WORKERS = 1


def _arm_inputs(D, arm):
    G = D["G"] + (1.0 if arm == "pos1" else 0.0)
    y = D["y_sparse"] if arm == "sparse" else D["y"]
    return G, y


def _job(args):
    """One (test week, station fold): fit each stratum on the training rows, predict that week's held-out rows."""
    arm, wi, ws, we, j = args
    D, fold = _JOB["D"], _JOB["fold"]
    G, y = _arm_inputs(D, arm)
    ok = np.isfinite(y)
    sf = fold[D["st"]]
    rng = np.random.default_rng([3, wi, j]) if arm == "null" else None     # the registered seed 3, one stream per job
    tr = (D["cycle"] < ws) & (D["v"] < ws) & (D["v"] >= ws - TRAIN_DAYS * 24) & ok & (sf != j)
    te = (D["cycle"] >= ws) & (D["cycle"] < we) & ok & (sf == j)
    if arm == "leak":
        tr = tr | te
    idx = np.flatnonzero(te)
    med, crps, fac = np.full(len(idx), np.nan), np.full(len(idx), np.nan), np.full(len(idx), np.nan)
    pex = {t: np.full(len(idx), np.nan) for t in THRESH_KN}
    fitted = np.zeros(len(idx), dtype=bool)
    cache = {}
    for b, w, la in sorted({(b, w, la) for b, w, la in zip(D["bin"][idx], D["w"][idx], D["land"][idx])}):
        r = (D["bin"][idx] == b) & (D["w"][idx] == w) & (D["land"][idx] == la)
        rows = idx[r]
        trk = tr & (D["bin"] == b) & (D["w"] == w)
        own = trk & (D["land"] == la)
        pooled = own.sum() < MIN_TRAIN
        src = trk if pooled else own
        if src.sum() < MIN_TRAIN:                                            # RAW: the identity
            med[r], crps[r], fac[r] = G[rows], np.abs(G[rows] - y[rows]), G[rows]
            for t in THRESH_KN:
                pex[t][r] = (G[rows] >= t / KN_PER_MS).astype(float)
            continue
        ck = (b, w, None if pooled else la)
        if ck not in cache:
            yt = rng.permutation(y[src]) if rng is not None else y[src]
            cache[ck] = (fit_emos(G[src], D["W"][src], yt), fit_factor(D["W"][src], yt))
        th, k = cache[ck]
        mu, sig = musig(th, G[rows], D["W"][rows])
        med[r], crps[r], fac[r] = median_tn0(mu, sig), crps_tn0(mu, sig, y[rows]), k * D["W"][rows]
        for t in THRESH_KN:
            pex[t][r] = exceed_tn0(mu, sig, t / KN_PER_MS)
        fitted[r] = True
    return idx, med, crps, fac, pex, fitted


def run_arm(D, fold, arm):
    """Score every test row once. arm: real | null | pos1 | leak | sparse. Returns columns over the test rows."""
    G, y = _arm_inputs(D, arm)
    n = len(G)
    med, crps, fac = np.full(n, np.nan), np.full(n, np.nan), np.full(n, np.nan)
    pex = {t: np.full(n, np.nan) for t in THRESH_KN}
    fitted = np.zeros(n, dtype=bool)
    tested = np.zeros(n, dtype=bool)
    _JOB.update(D=D, fold=fold)
    jobs = [(arm, wi, ws, we, j) for wi, (ws, we) in enumerate(weeks(D)) for j in range(FOLDS)]
    if WORKERS > 1:
        import multiprocessing as mp
        with mp.get_context("fork").Pool(WORKERS) as pool:
            results = pool.map(_job, jobs)
    else:
        results = [_job(a) for a in jobs]
    for idx, m_, c_, f_, p_, fit_ in results:
        med[idx], crps[idx], fac[idx], fitted[idx], tested[idx] = m_, c_, f_, fit_, True
        for t in THRESH_KN:
            pex[t][idx] = p_[t]
    sel = tested
    return {"sel": sel, "med": med[sel], "crps": crps[sel], "fac": fac[sel], "G": G[sel], "y": y[sel],
            "W": D["W"][sel], "pex": {t: v[sel] for t, v in pex.items()}, "fitted": int(fitted.sum()), "fit": fitted[sel],
            "st": D["st"][sel], "v": D["v"][sel], "bin": D["bin"][sel], "land": D["land"][sel]}


# ---------------------------------------------------------------------------------------------------- scoring
def two_way(R, gain, blocks, mask=None):
    """eval_twoway's binding interval of the mean gain (cells by 100 km block x UTC valid day)."""
    m = np.ones(len(gain), dtype=bool) if mask is None else mask
    cells = {}
    for st, v, g in zip(R["st"][m], R["v"][m], gain[m]):
        k = (blocks[int(st)], int(v) // 24)
        c = cells.setdefault(k, [0.0, 0])
        c[0] += float(g)
        c[1] += 1
    days = len({d for _, d in cells})
    if days < T.MIN_DAYS:
        return {"computable": False, "days": days, "n": int(m.sum()), "mean": float(gain[m].mean()) if m.any() else None}
    r = T._cells_ci({k: (v[0], v[1]) for k, v in cells.items()}, REPS, random.Random(SEED_CI))
    return {"computable": True, "days": days, "n": int(m.sum()), "mean": r["mean"], "ci": r["ci"], "blocks": r["blocks"]}


def summary(R):
    e = R["med"] - R["y"]
    out = {"n": int(len(e)), "bias": float(e.mean()), "mae": float(np.abs(e).mean()),
           "mae_raw": float(np.abs(R["G"] - R["y"]).mean()), "bias_raw": float((R["G"] - R["y"]).mean()),
           "mae_x140": float(np.abs(1.4 * R["W"] - R["y"]).mean()), "mae_factor": float(np.abs(R["fac"] - R["y"]).mean()),
           "crps": float(R["crps"].mean())}
    for t in THRESH_KN:
        tm = t / KN_PER_MS
        o = (R["y"] >= tm).astype(float)
        bs = float(np.mean((R["pex"][t] - o) ** 2))
        bs_raw = float(np.mean(((R["G"] >= tm) - o) ** 2))
        bs_x = float(np.mean(((1.4 * R["W"] >= tm) - o) ** 2))
        ev = o > 0
        pod = lambda f: float((f[ev] >= tm).mean()) if ev.any() else None  # noqa: E731
        far = lambda f: float((~ev[f >= tm]).mean()) if (f >= tm).any() else None  # noqa: E731
        rel = []
        for lo in np.arange(0, 1, 0.1):
            k = (R["pex"][t] >= lo) & (R["pex"][t] < lo + 0.1 if lo < 0.9 else R["pex"][t] <= 1.0)
            rel.append([round(float(lo), 1), int(k.sum()), float(o[k].mean()) if k.any() else None])
        out[f"{t}kn"] = {"events": int(ev.sum()), "brier": bs, "brier_raw": bs_raw, "brier_x140": bs_x,
                         "bss_vs_raw": (1 - bs / bs_raw) if bs_raw > 0 else None, "pod": pod(R["med"]), "pod_raw": pod(R["G"]),
                         "far": far(R["med"]), "far_raw": far(R["G"]), "reliability": rel}
    return out


def _sub(R, m):
    return {k: (v[m] if isinstance(v, np.ndarray) and v.shape == m.shape else ({t: a[m] for t, a in v.items()} if isinstance(v, dict) else v))
            for k, v in R.items() if k != "sel"}


def verdict(model, R, blocks, controls, n_cycles):
    g_raw = np.abs(R["G"] - R["y"]) - np.abs(R["med"] - R["y"])
    g_crps = np.abs(R["G"] - R["y"]) - R["crps"]
    g_x = np.abs(1.4 * R["W"] - R["y"]) - np.abs(R["med"] - R["y"])
    s = summary(R)
    gates = {}
    ci1 = two_way(R, g_raw, blocks)
    gates["G1"] = {"ci": ci1, "pass": bool(ci1["computable"] and ci1["ci"][0] > 0)}
    strata, worse = [], []
    for bi, (lo, hi) in enumerate(S.BINS):
        for la in (0, 1):
            m = (R["bin"] == bi) & (R["land"] == la)
            if not m.any():
                continue
            ci = two_way(R, g_raw, blocks, m)
            row = {"bin": f"{lo}-{hi}", "land": la, **summary(_sub(R, m)), "gain_ci": ci}
            strata.append(row)
            if ci["computable"] and ci["ci"][1] < 0:
                worse.append(f"{lo}-{hi}/{'land' if la else 'sea'}")
    gates["G2"] = {"worse": worse, "pass": not worse}
    gates["G3"] = {"mae": s["mae"], "mae_x140": s["mae_x140"], "ci_vs_x140": two_way(R, g_x, blocks),
                   "pass": s["mae"] <= s["mae_x140"]}
    ci4 = two_way(R, g_crps, blocks)
    b25, b34 = s["25kn"]["bss_vs_raw"], s["34kn"]["bss_vs_raw"]
    gates["G4"] = {"ci": ci4, "bss_25": b25, "bss_34": b34,
                   "pass": bool(ci4["computable"] and ci4["ci"][0] > 0 and (b25 or -1) > 0 and (b34 or -1) > 0)}
    st = s[f"{STORM_KN}kn"]
    under = st["events"] < STORM_MIN_EVENTS
    gates["G5"] = {"events": st["events"], "pod": st["pod"], "pod_raw": st["pod_raw"], "underpowered": under,
                   "pass": (not under) and st["pod"] >= st["pod_raw"] - 0.05}
    gates["G6"] = {"bias": s["bias"], "pass": abs(s["bias"]) <= 0.25}
    void = [k for k, c in controls.items() if not c.get("pass", True)]
    if void:
        v = "VOID"
    elif under:
        v = "HOLD (storm guard underpowered)"
    elif not ci1["computable"]:
        v = "NOT_READ (fewer than 14 UTC test days)"
    else:
        v = "PASS" if all(g["pass"] for g in gates.values()) else "FAIL"
    return {"model": model, "cycles": n_cycles, "verdict": v, "summary": s, "gates": gates, "strata": strata,
            "controls": controls}


def recovery_control(D, seed=4):
    """POSITIVE 2: synthetic y = max(0, 0.5 + 0.7G + 0.4W + N(0, 1.2^2)) on GFS 0-23 h pairs; fit must recover it."""
    m = D["bin"] == 0
    rng = np.random.default_rng(seed)
    G, W = D["G"][m], D["W"][m]
    y = np.maximum(0.0, 0.5 + 0.7 * G + 0.4 * W + rng.normal(0, 1.2, len(G)))
    th = fit_emos(G, W, y)
    ok = abs(th[0] - 0.5) <= 0.1 and abs(th[1] - 0.7) <= 0.1 and abs(th[2] - 0.4) <= 0.1 and abs(math.exp(th[3]) / 1.2 - 1) <= 0.10
    return {"theta": [round(float(x), 4) for x in th], "n": int(m.sum()), "pass": bool(ok)}


def coefficients(D):
    """What a served calibration would use: per stratum, fitted on ALL stations over the trailing 45 days of valid time."""
    end = int(D["v"].max())
    tr = (D["v"] > end - TRAIN_DAYS * 24) & np.isfinite(D["y"])
    out = {}
    for b, w in sorted({(b, w) for b, w in zip(D["bin"], D["w"])}):
        for la in (0, 1, None):
            m = tr & (D["bin"] == b) & (D["w"] == w)
            if la is not None:
                m &= D["land"] == la
            if m.sum() >= MIN_TRAIN:
                lo, hi = S.BINS[b]
                out[f"{lo}-{hi}|w{w}|{'pooled' if la is None else ('land' if la else 'sea')}"] = {
                    "theta": [round(float(x), 5) for x in fit_emos(D["G"][m], D["W"][m], D["y"][m])], "n": int(m.sum())}
    return out


def calibrate(d, models=S.MODELS):
    stations, data = load(d, models)
    blocks, fold = station_folds(stations)
    rep = {"generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "stations": len(stations),
           "blocks": len(set(blocks)), "models": {}}
    for m in models:
        D = data.get(m)
        if D is None or not weeks(D):
            rep["models"][m] = {"model": m, "verdict": "NOT_READ (no test week)", "cycles": D["n_cycles"] if D else 0}
            continue
        real = run_arm(D, fold, "real")
        mae = float(np.abs(real["med"] - real["y"]).mean())
        null = run_arm(D, fold, "null")
        pos1 = run_arm(D, fold, "pos1")
        leak = run_arm(D, fold, "leak")
        mae_null = float(np.abs(null["med"] - null["y"]).mean())
        both = real["fit"] & pos1["fit"]            # amendment 1: a RAW (identity) stratum cannot absorb a bias by design
        mae_f = float(np.abs(real["med"] - real["y"])[both].mean())
        mae_p1 = float(np.abs(pos1["med"] - pos1["y"])[both].mean())
        raw_f = float(np.abs(real["G"] - real["y"])[both].mean())
        raw_p1 = float(np.abs(pos1["G"] - pos1["y"])[both].mean())
        mae_leak = float(np.abs(leak["med"] - leak["y"]).mean())
        controls = {
            "null": {"mae_null": mae_null, "ratio": mae_null / mae, "pass": mae_null >= 1.10 * mae},
            "pos1": {"rows": int(both.sum()), "mae_shift": mae_p1 - mae_f, "raw_shift": raw_p1 - raw_f,
                     "pass": abs(mae_p1 - mae_f) <= 0.02 and raw_p1 - raw_f >= 0.3},
            "leak": {"mae_leak": mae_leak, "mae_oos": mae, "pass": mae_leak <= mae},
        }
        if m == "GFS":
            controls["pos2"] = recovery_control(D)
        out = verdict(m, real, blocks, controls, D["n_cycles"])
        out["fitted_rows"] = real["fitted"]
        if m != "GFS":
            sp = run_arm(D, fold, "sparse")
            out["sensitivity_sparse"] = summary(sp)
        out["coefficients"] = coefficients(D)
        rep["models"][m] = out
    return rep


def markdown(rep):
    L = [f"Stations {rep['stations']}, blocks {rep['blocks']}. m/s. Out of sample (weekly origin x 5 station-block folds).", "",
         "| model | cycles | verdict | n | bias C / raw | MAE C / raw / wind x1.40 / k*W | CRPS C | G1 gain CI | BSS 25 / 34 kn | "
         "POD 34 kn C / raw (events) |", "|---|---|---|---|---|---|---|---|---|---|"]
    for m, r in rep["models"].items():
        if "summary" not in r:
            L.append(f"| {m} | {r.get('cycles')} | {r['verdict']} | | | | | | | |")
            continue
        s, g = r["summary"], r["gates"]
        ci = g["G1"]["ci"]
        cis = f"{ci['mean']:+.3f} [{ci['ci'][0]:+.3f}, {ci['ci'][1]:+.3f}]" if ci.get("computable") else f"{ci['days']} days"
        L.append(f"| {m} | {r['cycles']} | {r['verdict']} | {s['n']} | {s['bias']:+.2f} / {s['bias_raw']:+.2f} | "
                 f"{s['mae']:.3f} / {s['mae_raw']:.3f} / {s['mae_x140']:.3f} / {s['mae_factor']:.3f} | {s['crps']:.3f} | {cis} | "
                 f"{_n(s['25kn']['bss_vs_raw'])} / {_n(s['34kn']['bss_vs_raw'])} | {_n(s['34kn']['pod'])} / "
                 f"{_n(s['34kn']['pod_raw'])} ({s['34kn']['events']}) |")
    for m, r in rep["models"].items():
        if "gates" not in r:
            continue
        L += ["", f"**{m}** gates: " + ", ".join(f"{k} {'PASS' if v['pass'] else 'FAIL'}" for k, v in r["gates"].items())
              + "; controls: " + ", ".join(f"{k} {'PASS' if v['pass'] else 'FAIL'}" for k, v in r["controls"].items()), "",
              "| lead | land | n | bias C / raw | MAE C / raw / x1.40 | gain CI |", "|---|---|---|---|---|---|"]
        for s in r["strata"]:
            ci = s["gain_ci"]
            cis = f"[{ci['ci'][0]:+.3f}, {ci['ci'][1]:+.3f}]" if ci.get("computable") else f"{ci['days']} days"
            L.append(f"| {s['bin']} | {'land' if s['land'] else 'sea'} | {s['n']} | {s['bias']:+.2f} / {s['bias_raw']:+.2f} | "
                     f"{s['mae']:.3f} / {s['mae_raw']:.3f} / {s['mae_x140']:.3f} | {cis} |")
    return "\n".join(L) + "\n"


def _n(x):
    return "-" if x is None else f"{x:.3f}"


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--md")
    ap.add_argument("--models", default=",".join(S.MODELS))
    ap.add_argument("--workers", type=int, default=1)
    a = ap.parse_args(argv)
    global WORKERS
    WORKERS = a.workers
    rep = calibrate(a.dir, tuple(a.models.split(",")))
    json.dump(rep, open(a.out, "w"), indent=1, default=float)
    if a.md:
        open(a.md, "w", encoding="utf-8").write(markdown(rep))
    print(markdown(rep))
    return 0


if __name__ == "__main__":
    sys.exit(main())
