"""wave_emos_core.py - L1 probabilistic offshore Hs: NGR/EMOS on log Hs, pure numpy. Serves nothing.

Registration: docs/weather-program/log/2026-11-15-senior-research-lead-sota-plan.md, "L1 PRE-REGISTRATION DRAFT"
(2026-11-16 23:31), amendment 1 (23:58), amendment 2 (2026-11-17 00:08, governs), FIXED 00:33. This module holds the
predictive laws and the rolling fit; wave_l1_score.py holds the gate.

Predictive law (every arm is log-normal in METRES, so CRPS is closed form and computed in metres, never in log space):
  E2 (primary): log Hs ~ N(mu, sigma^2), mu = a + b_g*mean(log GEFS) + b_e*mean(log ECMWF), sigma = |c| + |d|*sd,
      sd = SD of the pooled log members ("the SD is linear in the pooled ensemble SD"). Constant-spread form: d = 0.
  R2 (fair baseline, amendment 2): mu = a + b*log R1, sigma = |c|, same fit rule as E2.
Fitted per 24-h lead bin by minimum mean CRPS (Nelder-Mead from emos_core).

Rolling fit (amendment 2): refit weekly; the refit at time D uses rows whose forecast was PUBLISHED (init + measured
delay) and whose observation is valid before D, in the trailing 90 days, no earlier than FIT_START, restarting at the
latest model-upgrade date inside the window. A forecast published at P uses the latest refit at or before P.
"""
import math
import os
import sys
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from emos_core import nelder_mead, norm_cdf, norm_ppf  # noqa: E402

FIT_START = np.datetime64("2025-10-01T00", "h")       # amendment 2: the trailing window must include a winter
WINDOW_DAYS = 90
REFIT_DAYS = 7
MIN_FIT_ROWS = 200                                    # below this a bin is not fitted; its rows are excluded and counted
LEAD_BIN_H = 24
_SQRT2 = math.sqrt(2.0)
_FLOOR_M = 0.05                                       # Hs floor before the log (calm buoys report 0.0x m)


def lead_bin(lead_h) -> np.ndarray:
    """24-h lead bins labelled by their start: 24-47 h -> 24, ..., 216-239 h -> 216; 240 h joins 216."""
    lead = np.asarray(lead_h, dtype=int)
    return np.where(lead == 240, 216, (lead // LEAD_BIN_H) * LEAD_BIN_H).astype(int)


def safe_log(x):
    return np.log(np.maximum(np.asarray(x, dtype=float), _FLOOR_M))


def crps_lognormal(mu, sigma, y):
    """CRPS (metres) of LN(mu, sigma^2) at y >= 0 (Baran & Lerch 2015, eq. 3)."""
    mu, sigma, y = (np.asarray(v, dtype=float) for v in (mu, sigma, y))
    sigma = np.maximum(sigma, 1e-6)
    z = (np.log(np.maximum(y, 1e-9)) - mu) / sigma
    return y * (2.0 * norm_cdf(z) - 1.0) - 2.0 * np.exp(mu + 0.5 * sigma * sigma) * (
        norm_cdf(z - sigma) + norm_cdf(sigma / _SQRT2) - 1.0)


def quantile_lognormal(mu, sigma, q):
    return np.exp(np.asarray(mu, dtype=float) + np.asarray(sigma, dtype=float) * norm_ppf(q))


def exceed_lognormal(mu, sigma, thr):
    return 1.0 - norm_cdf((safe_log(thr) - np.asarray(mu, dtype=float)) / np.maximum(np.asarray(sigma, float), 1e-6))


def crps_weighted_ensemble(members, weights, y):
    """CRPS of a weighted empirical ensemble, members on axis 1: sum w|x-y| - 0.5 sum_ij w_i w_j |x_i-x_j|.
    E1 weights each MODEL equally (draft: "equal weight per model"): GEFS members 0.5/31, ECMWF 0.5/50."""
    X = np.asarray(members, dtype=float)
    ok = np.isfinite(X)
    w = np.where(ok, np.broadcast_to(np.asarray(weights, dtype=float), X.shape), 0.0)
    w = w / w.sum(axis=1, keepdims=True)
    Xf = np.where(ok, X, 0.0)
    t1 = np.sum(w * np.abs(Xf - np.asarray(y, float)[:, None]), axis=1)
    order = np.argsort(np.where(ok, X, np.inf), axis=1)
    xs = np.take_along_axis(Xf, order, axis=1)
    ws = np.take_along_axis(w, order, axis=1)
    below = np.cumsum(ws, axis=1) - ws                      # weight strictly before each sorted member
    above = 1.0 - below - ws
    t2 = np.sum(ws * xs * (below - above), axis=1)          # = 0.5 sum_ij w_i w_j |x_i - x_j|
    return t1 - t2


# ---------------------------------------------------------------- features and laws

def ens_features(gefs, ecmwf) -> Dict[str, np.ndarray]:
    """Per row: mean log of each model's members, and the SD of the pooled log members (equal weight per model)."""
    lg, le = safe_log(gefs), safe_log(ecmwf)
    mg, me = np.nanmean(lg, axis=1), np.nanmean(le, axis=1)
    pm = 0.5 * (mg + me)
    var = 0.5 * np.nanmean((lg - pm[:, None]) ** 2, axis=1) + 0.5 * np.nanmean((le - pm[:, None]) ** 2, axis=1)
    return {"mg": mg, "me": me, "sd": np.sqrt(var)}


def law_e2(theta, f, models=("g", "e")) -> Tuple[np.ndarray, np.ndarray]:
    """theta = (a, b_g, b_e, c, d); a single-model arm (reported) drops the other model's term."""
    a, bg, be, c, d = theta
    mu = a + (bg * f["mg"] if "g" in models else 0.0) + (be * f["me"] if "e" in models else 0.0)
    return mu, np.abs(c) + np.abs(d) * f["sd"]


def law_r2(theta, f) -> Tuple[np.ndarray, np.ndarray]:
    a, b, c = theta
    return a + b * f["lr1"], np.full_like(f["lr1"], abs(c))


def _fit(obj, x0) -> np.ndarray:
    th, _ = nelder_mead(obj, x0, step=0.3, iters=2000, tol=1e-9)
    th, _ = nelder_mead(obj, th, step=0.1, iters=2000, tol=1e-10)    # one restart: Nelder-Mead stalls on ridges
    return th


def fit_arm(arm: str, f: Dict[str, np.ndarray], y: np.ndarray, spread: str = "fitted",
            models=("g", "e")) -> Optional[np.ndarray]:
    """Minimum-CRPS fit of one arm on the given rows; None when fewer than MIN_FIT_ROWS finite rows."""
    keys = ("lr1",) if arm == "R2" else tuple({"g": "mg", "e": "me"}[m] for m in models) + ("sd",)
    ok = np.isfinite(y) & np.all([np.isfinite(f[k]) for k in keys], axis=0)
    if ok.sum() < MIN_FIT_ROWS:
        return None
    ff = {k: np.asarray(v)[ok] for k, v in f.items()}
    yy = y[ok]
    if arm == "R2":
        return _fit(lambda t: float(np.mean(crps_lognormal(*law_r2(t, ff), yy))), (0.0, 1.0, 0.3))
    if spread == "constant":
        t = _fit(lambda t: float(np.mean(crps_lognormal(*law_e2((t[0], t[1], t[2], t[3], 0.0), ff, models), yy))),
                 (0.0, 0.5, 0.5, 0.3))
        return np.array([t[0], t[1], t[2], t[3], 0.0])
    return _fit(lambda t: float(np.mean(crps_lognormal(*law_e2(t, ff, models), yy))), (0.0, 0.5, 0.5, 0.15, 0.8))


# ---------------------------------------------------------------- rolling schedule

def refit_times(first, last) -> List[np.datetime64]:
    """Weekly refit instants from `first` through `last` inclusive."""
    t, out = np.datetime64(first, "h"), []
    while t <= np.datetime64(last, "h"):
        out.append(t)
        t = t + np.timedelta64(REFIT_DAYS * 24, "h")
    return out


def training_mask(D, valid, published, upgrades: Sequence = ()) -> np.ndarray:
    """Rows usable by the refit at D: published AND valid before D, inside the trailing window, after FIT_START and
    after the latest upgrade at or before D (a window that spans an upgrade is refit from the upgrade date)."""
    D = np.datetime64(D, "h")
    start = max(D - np.timedelta64(WINDOW_DAYS * 24, "h"), FIT_START)
    ups = [np.datetime64(u, "h") for u in upgrades if np.datetime64(u, "h") <= D]
    if ups:
        start = max(start, max(ups))
    valid, published = np.asarray(valid, "datetime64[h]"), np.asarray(published, "datetime64[h]")
    return (valid >= start) & (valid < D) & (published < D)


def rolling_predict(arm, f, y, valid, published, lbin, refits, test_mask, upgrades=(), spread="fitted",
                    models=("g", "e"), sd_override=None):
    """(mu, sigma) for the test rows, NaN where no fit exists (excluded and counted by the scorer). Each test row uses
    the latest refit at or before its publication time, fitted per lead bin. sd_override replaces f["sd"] everywhere
    (the shuffled-spread report)."""
    if sd_override is not None:
        f = dict(f, sd=sd_override)
    n = len(y)
    mu, sig = np.full(n, np.nan), np.full(n, np.nan)
    published = np.asarray(published, "datetime64[h]")
    refits = np.array(sorted(np.datetime64(r, "h") for r in refits), dtype="datetime64[h]")
    which = np.searchsorted(refits, published, side="right") - 1
    for k, D in enumerate(refits):
        rows_k = test_mask & (which == k)
        if not rows_k.any():
            continue
        tm = training_mask(D, valid, published, upgrades)
        for b in np.unique(lbin[rows_k]):
            th = fit_arm(arm, {kk: v[tm & (lbin == b)] for kk, v in f.items()}, y[tm & (lbin == b)], spread, models)
            if th is None:
                continue
            sel = rows_k & (lbin == b)
            fs = {kk: v[sel] for kk, v in f.items()}
            mu[sel], sig[sel] = law_r2(th, fs) if arm == "R2" else law_e2(th, fs, models)
    return mu, sig


def frozen_predict(arm, f, y, lbin, train_mask, test_mask, spread="fitted", models=("g", "e")):
    """The reported frozen-TRAIN fit: one fit per lead bin on train_mask rows, applied to the test rows."""
    n = len(y)
    mu, sig = np.full(n, np.nan), np.full(n, np.nan)
    for b in np.unique(lbin[test_mask]):
        th = fit_arm(arm, {k: v[train_mask & (lbin == b)] for k, v in f.items()}, y[train_mask & (lbin == b)],
                     spread, models)
        if th is None:
            continue
        sel = test_mask & (lbin == b)
        fs = {k: v[sel] for k, v in f.items()}
        mu[sel], sig[sel] = law_r2(th, fs) if arm == "R2" else law_e2(th, fs, models)
    return mu, sig


def _doy(t) -> np.ndarray:
    t = np.asarray(t, "datetime64[D]")
    return (t - t.astype("datetime64[Y]")).astype(int)


def climatology_samples(buoy_hist: Dict[str, Tuple[np.ndarray, np.ndarray]], buoy: Iterable[str], valid,
                        half_window_days: int = 15) -> List[np.ndarray]:
    """Arm C (reported): per row, the buoy's pre-TEST observations within +-15 days of the row's day of year."""
    out, cache = [], {}
    for b, d in zip(buoy, _doy(valid)):
        if b not in cache:
            t, obs = buoy_hist.get(b, (np.array([], "datetime64[h]"), np.array([])))
            cache[b] = (_doy(t), np.asarray(obs, dtype=float))
        dd, obs = cache[b]
        gap = np.abs(dd - d)
        out.append(obs[np.minimum(gap, 365 - gap) <= half_window_days])
    return out
