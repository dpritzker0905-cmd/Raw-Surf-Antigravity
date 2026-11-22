"""wind_lr2_fit.py - calibration fit for the long-range wind v2 registration (section 2). Serves nothing.

For member-pooled mean vector m (mean speed s), climatology vector c (speed c_s), bin b, region r:
  vector  f   = c + alpha * (m - c)          fitted on (o - c) ~ alpha * (m - c), u and v stacked
  speed   f_s = c_s + beta * (s - c_s) + gamma
  gust    = max(f_s, f_s * GF)
Ridge toward the RAW pool (alpha, beta, gamma) = (1, 1, 0), NOT toward climatology (intended; registration section 2).
lambda is dimensionless: the penalty is lambda * Sxx on the squared departure from the target, so lambda = 0 is plain
least squares and lambda = inf is the raw pool. It is chosen by leave-block-out cross-validation INSIDE FIT only (blocks
of 5 valid days, grouped into folds), the grid containing both extremes; a tie goes to the larger lambda.
Coefficients belong to the bin centres (198, 240, 300 h) and are linearly interpolated in lead, flat outside.
"""
import hashlib
import json
import math
from typing import Dict, List, Optional

import numpy as np

from wind_lr2_runs import BINS, CENTRES, bin_of

LAMBDAS = [0.0, 0.01, 0.03, 0.1, 0.3, 1.0, 3.0, 10.0, math.inf]
MIN_STATION_DAYS = 100          # registration section 5: below this a (bin x region) cell borrows the pooled fit
MIN_SPEED_FOR_GF = 3.0          # m/s: the gust factor is read where there is wind to gust in


def _ridge(xtx: np.ndarray, xty: np.ndarray, p_diag: np.ndarray, theta0: np.ndarray, lam: float) -> np.ndarray:
    if math.isinf(lam):
        return theta0.copy()
    a = xtx + lam * np.diag(p_diag)
    b = xty + lam * p_diag * theta0
    try:
        return np.linalg.solve(a, b)
    except np.linalg.LinAlgError:
        return theta0.copy()


def fit_alpha(x: np.ndarray, y: np.ndarray, lam: float) -> float:
    """x = m - c, y = o - c (any shape, stacked). Minimises |y - a x|^2 + lam * Sxx * (a - 1)^2."""
    x, y = np.asarray(x, float).ravel(), np.asarray(y, float).ravel()
    sxx = float(np.dot(x, x))
    if sxx <= 0.0:
        return 1.0
    if math.isinf(lam):
        return 1.0
    return (float(np.dot(x, y)) + lam * sxx) / (sxx * (1.0 + lam))


def fit_beta_gamma(xs: np.ndarray, ys: np.ndarray, lam: float):
    """xs = s - c_s, ys = o_s - c_s. Returns (beta, gamma), shrunk toward (1, 0) with penalty lam * Sxx on both."""
    xs, ys = np.asarray(xs, float), np.asarray(ys, float)
    n = len(xs)
    sxx = float(np.dot(xs, xs))
    if n == 0 or sxx <= 0.0:
        return 1.0, 0.0
    X = np.column_stack([xs, np.ones(n)])
    th = _ridge(X.T @ X, X.T @ ys, np.array([sxx, sxx]), np.array([1.0, 0.0]), lam)
    return float(th[0]), float(th[1])


def _folds(block_ids: np.ndarray, k: int = 5) -> np.ndarray:
    """Fold index per row: distinct blocks sorted, then dealt round-robin (deterministic, no RNG)."""
    uniq = np.unique(block_ids)
    k = max(1, min(k, len(uniq)))
    fold_of = {b: i % k for i, b in enumerate(uniq)}
    return np.array([fold_of[b] for b in block_ids])


def choose_lambda(fit_fn, pred_err_fn, rows: Dict[str, np.ndarray], block_ids: np.ndarray, k: int = 5) -> float:
    """Leave-block-out CV. fit_fn(rows_subset, lam) -> params; pred_err_fn(params, rows_subset) -> summed squared error.
    Tie -> larger lambda (more shrinkage)."""
    n = len(block_ids)
    if n == 0:
        return math.inf
    fold = _folds(block_ids, k)
    if len(np.unique(fold)) < 2:
        return math.inf             # one block: nothing to validate on, so no move away from the raw pool
    best, best_sse = math.inf, None
    for lam in LAMBDAS:
        sse = 0.0
        for f in np.unique(fold):
            tr, te = fold != f, fold == f
            params = fit_fn({kk: v[tr] for kk, v in rows.items()}, lam)
            sse += pred_err_fn(params, {kk: v[te] for kk, v in rows.items()})
        if best_sse is None or sse < best_sse - 1e-12 or (abs(sse - best_sse) <= 1e-12 and lam > best):
            best, best_sse = lam, sse
    return best


def _vec_fit(r, lam):
    return fit_alpha(np.concatenate([r["xu"], r["xv"]]), np.concatenate([r["yu"], r["yv"]]), lam)


def _vec_err(a, r):
    return float(np.sum((r["yu"] - a * r["xu"]) ** 2 + (r["yv"] - a * r["xv"]) ** 2))


def _spd_fit(r, lam):
    return fit_beta_gamma(r["xs"], r["ys"], lam)


def _spd_err(p, r):
    return float(np.sum((r["ys"] - (p[0] * r["xs"] + p[1])) ** 2))


def fit_cell(rows: Dict[str, np.ndarray]) -> dict:
    """rows: m_u, m_v, s, c_u, c_v, c_s, o_u, o_v, o_s, o_gust (NaN allowed), block (valid-date 5-day block id).
    Returns {alpha, beta, gamma, gf, lambda_vec, lambda_spd, n}."""
    n = len(rows["s"])
    vec = {"xu": rows["m_u"] - rows["c_u"], "xv": rows["m_v"] - rows["c_v"],
           "yu": rows["o_u"] - rows["c_u"], "yv": rows["o_v"] - rows["c_v"]}
    spd = {"xs": rows["s"] - rows["c_s"], "ys": rows["o_s"] - rows["c_s"]}
    blk = rows["block"]
    lam_v = choose_lambda(_vec_fit, _vec_err, vec, blk)
    lam_s = choose_lambda(_spd_fit, _spd_err, spd, blk)
    alpha = _vec_fit(vec, lam_v)
    beta, gamma = _spd_fit(spd, lam_s)
    fs = np.maximum(rows["c_s"] + beta * (rows["s"] - rows["c_s"]) + gamma, 0.0)
    ok = np.isfinite(rows["o_gust"]) & (fs >= MIN_SPEED_FOR_GF)
    gf = float(np.median(rows["o_gust"][ok] / fs[ok])) if ok.any() else 1.0
    return {"alpha": float(alpha), "beta": float(beta), "gamma": float(gamma), "gf": max(gf, 1.0),
            "lambda_vec": "inf" if math.isinf(lam_v) else lam_v, "lambda_spd": "inf" if math.isinf(lam_s) else lam_s,
            "n": int(n)}


def _station_days(rows: Dict[str, np.ndarray]) -> int:
    return len({(int(a), int(b)) for a, b in zip(rows["station"], rows["day"])})


def fit_all(rows: Dict[str, np.ndarray], system: str = "") -> dict:
    """rows additionally carry: lead, region (array of str), station (int id), day (valid-date ordinal).
    Fits per (bin x region); a cell below MIN_STATION_DAYS borrows the bin's pooled fit (flagged)."""
    out = {"system": system, "bins": {}, "lambdas": ["inf" if math.isinf(x) else x for x in LAMBDAS]}
    bins = np.array([bin_of(L) or "" for L in rows["lead"]])
    for b in BINS:
        sel = bins == b
        sub = {k: v[sel] for k, v in rows.items()}
        pooled = fit_cell(sub) if sel.any() else {"alpha": 1.0, "beta": 1.0, "gamma": 0.0, "gf": 1.0,
                                                  "lambda_vec": "inf", "lambda_spd": "inf", "n": 0}
        regs = {"POOLED": dict(pooled, borrowed=False)}
        for r in sorted({str(x) for x in sub["region"]}) if sel.any() else []:
            m = sub["region"] == r
            cell = {k: v[m] for k, v in sub.items()}
            if _station_days(cell) >= MIN_STATION_DAYS:
                regs[r] = dict(fit_cell(cell), borrowed=False)
            else:
                regs[r] = dict(pooled, borrowed=True, n=int(m.sum()))
        out["bins"][b] = {"center": CENTRES[b], "regions": regs}
    return out


def coef_at(coefs: dict, region: str, lead: float) -> dict:
    """Linear interpolation in lead between bin centres, flat outside (no step at 216 h or 264 h)."""
    pts = []
    for b in BINS:
        regs = coefs["bins"][b]["regions"]
        c = regs.get(region) or regs["POOLED"]
        pts.append((coefs["bins"][b]["center"], c))
    pts.sort(key=lambda t: t[0])
    if lead <= pts[0][0]:
        return dict(pts[0][1])
    if lead >= pts[-1][0]:
        return dict(pts[-1][1])
    for (l0, c0), (l1, c1) in zip(pts, pts[1:]):
        if l0 <= lead <= l1:
            w = (lead - l0) / (l1 - l0)
            return {k: (1 - w) * float(c0[k]) + w * float(c1[k]) for k in ("alpha", "beta", "gamma", "gf")}
    raise AssertionError("unreachable")


def apply_cal(m_u, m_v, s, c_u, c_v, c_s, k: dict):
    """(u, v, speed, gust) for the calibrated field. Direction from f; zero f gives zero wind."""
    m_u, m_v, s = (np.asarray(a, float) for a in (m_u, m_v, s))
    c_u, c_v, c_s = (np.asarray(a, float) for a in (c_u, c_v, c_s))
    fu = c_u + k["alpha"] * (m_u - c_u)
    fv = c_v + k["alpha"] * (m_v - c_v)
    fs = np.maximum(c_s + k["beta"] * (s - c_s) + k["gamma"], 0.0)
    mag = np.hypot(fu, fv)
    scale = np.divide(fs, mag, out=np.zeros_like(fs), where=mag > 0)
    return fu * scale, fv * scale, fs, np.maximum(fs, fs * k["gf"])


# ---------------------------------------------------------------------------------------------- hashes (freeze)
def canonical_json(doc) -> bytes:
    return json.dumps(doc, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def sha256_doc(doc) -> str:
    return hashlib.sha256(canonical_json(doc)).hexdigest()


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def freeze_manifest(coef_by_arm: Dict[str, dict], files: Dict[str, str]) -> dict:
    """The freeze record committed BEFORE the first TEST init: sha256 of every coefficient set (canonical JSON) and of
    each named file (ERA5 climatology, station list, pairing table)."""
    return {"coefficients": {arm: sha256_doc(c) for arm, c in sorted(coef_by_arm.items())},
            "files": {name: sha256_file(p) for name, p in sorted(files.items())}}


def verify_freeze(manifest: dict, coef_by_arm: Dict[str, dict], files: Dict[str, str]) -> List[str]:
    """Mismatches (empty = ok). The scorer refuses to run on any."""
    now = freeze_manifest(coef_by_arm, files)
    bad = []
    for sect in ("coefficients", "files"):
        for k in sorted(set(manifest.get(sect, {})) | set(now[sect])):
            if manifest.get(sect, {}).get(k) != now[sect].get(k):
                bad.append(f"{sect}:{k}")
    return bad
