"""wind_lr2_descr.py - four DESCRIPTIVE checks on the FIT rows for the long-range wind v2 registration (amendment 2).

Reported outputs only: no gate, no p-value, no effect on any verdict, never used to change a coefficient. They answer, in
leave-block-out cross-validation on FIT, the research lead's four questions (the form is a shrunk-mean MOS):
  1. L1 vs L2: the ridge fits squared error, the gate scores MAE. Does an L1 (median) speed map score better on MAE?
  2. Winter-only coefficients: FIT is mostly non-winter, TEST is Dec-Jan. Do winter-only fits score better on winter rows?
  3. Per-system spread-skill before pooling: member spread against the error of that system's mean.
  4. A one-alpha damped baseline: f = c + a (m - c) with ONE a per lead bin and no speed map, against the full form.
"""
from datetime import timedelta
from typing import Callable, Dict, Optional, Sequence

import numpy as np

import wind_lr2_fit as F
import wind_lr2_rows as W
import wind_lr2_runs as R

WINTER_MONTHS = (11, 12, 1, 2, 3)


def _sub(rows: Dict[str, np.ndarray], m: np.ndarray) -> Dict[str, np.ndarray]:
    return {k: v[m] for k, v in rows.items()}


def cv_speed_mae(rows: Dict[str, np.ndarray], fit_predict: Callable, test_mask: Optional[np.ndarray] = None,
                 train_mask: Optional[np.ndarray] = None, k: int = 5) -> dict:
    """Leave-block-out CV speed MAE. `fit_predict(train_rows, test_rows) -> predicted speed for test rows`. The folds are
    whole 5-day blocks dealt round-robin (as in the fit). `test_mask` restricts what is scored, `train_mask` what may train."""
    fold = F._folds(rows["block"], k)
    n_all = len(rows["s"])
    tm = np.ones(n_all, bool) if test_mask is None else test_mask
    rm = np.ones(n_all, bool) if train_mask is None else train_mask
    err, n = 0.0, 0
    for f in np.unique(fold):
        te, tr = (fold == f) & tm, (fold != f) & rm
        if not te.any() or tr.sum() < 20:
            continue
        pred = fit_predict(_sub(rows, tr), _sub(rows, te))
        e = np.abs(pred - rows["o_s"][te])
        err += float(np.nansum(e))
        n += int(np.isfinite(e).sum())
    return {"mae": err / n if n else float("nan"), "n": n}


def _predict_l2(train, test):
    c = F.fit_cell(train)
    return np.maximum(test["c_s"] + c["beta"] * (test["s"] - test["c_s"]) + c["gamma"], 0.0)


def fit_l1_speed(xs: np.ndarray, ys: np.ndarray, iters: int = 30):
    """(beta, gamma) minimising sum |ys - beta xs - gamma| by iteratively reweighted least squares (no shrinkage)."""
    X = np.column_stack([xs, np.ones(len(xs))])
    th = np.linalg.lstsq(X, ys, rcond=None)[0]
    for _ in range(iters):
        w = 1.0 / np.maximum(np.abs(ys - X @ th), 1e-3)
        A = X.T @ (X * w[:, None])
        th = np.linalg.solve(A + 1e-9 * np.eye(2), X.T @ (w * ys))
    return float(th[0]), float(th[1])


def _predict_l1(train, test):
    b, g = fit_l1_speed(train["s"] - train["c_s"], train["o_s"] - train["c_s"])
    return np.maximum(test["c_s"] + b * (test["s"] - test["c_s"]) + g, 0.0)


def _predict_one_alpha(train, test):
    x = np.concatenate([train["m_u"] - train["c_u"], train["m_v"] - train["c_v"]])
    y = np.concatenate([train["o_u"] - train["c_u"], train["o_v"] - train["c_v"]])
    a = F.fit_alpha(x, y, 0.0)
    return np.hypot(test["c_u"] + a * (test["m_u"] - test["c_u"]), test["c_v"] + a * (test["m_v"] - test["c_v"]))


def descriptive_report(rows: Dict[str, np.ndarray]) -> dict:
    """Checks 1, 2 and 4 on one arm's FIT rows, per lead bin. Lower MAE is better; nothing here is a test."""
    out: dict = {"label": "DESCRIPTIVE: reported only, no gate, no effect on any verdict", "bins": {}}
    bins = np.array([R.bin_of(L) or "" for L in rows["lead"]])
    for b in R.BINS:
        m = bins == b
        if m.sum() < 50:
            out["bins"][b] = {"n": int(m.sum()), "note": "too few rows"}
            continue
        sub = _sub(rows, m)
        w = np.isin(sub["month"], WINTER_MONTHS)
        out["bins"][b] = {
            "n": int(m.sum()), "n_winter": int(w.sum()),
            "l2_ridge": cv_speed_mae(sub, _predict_l2),
            "l1": cv_speed_mae(sub, _predict_l1),
            "one_alpha_damped": cv_speed_mae(sub, _predict_one_alpha),
            "raw_pool": cv_speed_mae(sub, lambda tr, te: te["s"]),
            "climatology": cv_speed_mae(sub, lambda tr, te: te["c_s"]),
            "winter_rows_all_year_fit": cv_speed_mae(sub, _predict_l2, test_mask=w),
            "winter_rows_winter_only_fit": cv_speed_mae(sub, _predict_l2, test_mask=w, train_mask=w),
        }
    return out


def spread_skill(runs: Dict, stations: Sequence[dict], truth_fn: Callable) -> dict:
    """Check 3, per system and lead bin, BEFORE pooling: mean member spread (SD of member speeds) against the RMSE of the
    system's mean speed, and their ratio (about 1 for a reliable ensemble; > 1 over-dispersed, < 1 under-dispersed)."""
    acc: Dict[tuple, list] = {}
    for init, z in runs.items():
        for step in R.SCORED_LEADS:
            b = R.bin_of(step)
            valid = init + timedelta(hours=step)
            for system in W.SYSTEMS:
                ku, kv = W.ifs_keys(step) if system == "ifs" else (f"{system}_u_{step}", f"{system}_v_{step}")
                sp = np.hypot(np.asarray(z[ku], float), np.asarray(z[kv], float))
                spread, mean = sp.std(axis=0, ddof=1), sp.mean(axis=0)
                for i in range(len(stations)):
                    tr = truth_fn(i, valid)
                    if tr is not None:
                        acc.setdefault((system, b), []).append((spread[i], (mean[i] - tr[2]) ** 2))
    out = {}
    for (system, b), v in sorted(acc.items()):
        a = np.array(v)
        spr, rmse = float(a[:, 0].mean()), float(np.sqrt(a[:, 1].mean()))
        out[f"{system}|{b}"] = {"spread": spr, "rmse_of_mean": rmse, "ratio": spr / rmse if rmse > 0 else float("nan"), "n": len(a)}
    return {"label": "DESCRIPTIVE: reported only", "cells": out}
