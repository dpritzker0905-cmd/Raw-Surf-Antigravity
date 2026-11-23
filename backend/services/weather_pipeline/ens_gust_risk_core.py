"""ens_gust_risk_core.py - the numeric core of the ensemble gust-risk product: P(gust >= 25 / 34 / 48 kn).

Pre-registered gate: docs/weather-program/gates/gust-ens-risk-v1.md. PURE numpy, no I/O, so the hindcast
(scripts/gust_ens_risk_hindcast.py) and the publisher (scripts/publish_gust_risk_frames.py) run the SAME arithmetic.

Source: ECMWF open-data IFS ENS member files (`enfo`/`ef`), 50 perturbed members (the control left the open-data ef
files on 2026-05-13). The gust parameter and its window depend on the step (decoded from GRIB headers 2026-11-23):
  steps 3-90 h     `10fg`  max over the last 1 h
  steps 93-144 h   `10fg3` max over the last 3 h
  steps 150-360 h  `10fg`  max over the last 6 h
The probability is the plain member fraction k / n (ECMWF EFI/SOT-style exceedance), uncalibrated.
"""
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

import numpy as np

KN_TO_MS = 1852.0 / 3600.0
THRESHOLDS_KN = (25, 34, 48)
THRESHOLDS_MS = tuple(round(k * KN_TO_MS, 3) for k in THRESHOLDS_KN)     # 12.861, 17.491, 24.693
MEMBERS = 50


# ---------------------------------------------------------------------------------------------- the ENS lattice
def gust_param(step: int) -> str:
    """The open-data parameter that carries the gust at `step`."""
    return "10fg3" if 93 <= int(step) <= 144 else "10fg"


def gust_window_h(step: int) -> int:
    """Hours in the gust window ending at `step` (measured; the collector checks every message against this)."""
    s = int(step)
    if s <= 0:
        raise ValueError("step 0 has no gust")
    return 1 if s <= 90 else (3 if s <= 144 else 6)


def native_steps(max_h: int = 360) -> List[int]:
    """Every ENS step that carries a gust: 3-144 h by 3, 150-`max_h` by 6."""
    return list(range(3, 145, 3)) + list(range(150, int(max_h) + 1, 6))


# ---------------------------------------------------------------------------------------------- exceedance
def exceed_counts(members: np.ndarray, thresholds_ms: Sequence[float] = THRESHOLDS_MS) -> np.ndarray:
    """members [n, ...] gust in m/s -> uint8 [len(thresholds), ...]: members with gust >= threshold. A NaN member never
    counts (a partial ensemble is refused upstream, so NaN here is the sea/land mask of a field, if any)."""
    g = np.asarray(members, dtype=np.float32)
    if g.ndim < 1 or g.shape[0] < 1 or g.shape[0] > 255:
        raise ValueError(f"members axis {g.shape}")
    with np.errstate(invalid="ignore"):
        return np.stack([(g >= np.float32(t)).sum(axis=0) for t in thresholds_ms]).astype(np.uint8)


def prob(counts: np.ndarray, n_members: int = MEMBERS) -> np.ndarray:
    return np.asarray(counts, dtype=np.float64) / float(n_members)


# ---------------------------------------------------------------------------------------------- scoring
def brier(p: np.ndarray, o: np.ndarray) -> float:
    p, o = np.asarray(p, float), np.asarray(o, float)
    return float(np.mean((p - o) ** 2)) if p.size else float("nan")


PROB_EDGES = (0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0)


def prob_bin(p: np.ndarray) -> np.ndarray:
    """0 for p == 0, then (0, .1] -> 1, ..., (.9, 1] -> 10 (11 bins, the gate's section 4)."""
    p = np.asarray(p, float)
    b = np.ceil(np.round(p * 10.0, 9)).astype(int)
    return np.clip(b, 0, 10)


def murphy(p: np.ndarray, o: np.ndarray) -> dict:
    """Murphy decomposition BS ~ REL - RES + UNC over the 11 bins, and the reliability diagram rows."""
    p, o = np.asarray(p, float), np.asarray(o, float)
    n = p.size
    obar = float(o.mean()) if n else float("nan")
    rel = res = 0.0
    rows = []
    b = prob_bin(p)
    for k in range(11):
        m = b == k
        nk = int(m.sum())
        if not nk:
            continue
        pk, ok = float(p[m].mean()), float(o[m].mean())
        rel += nk * (pk - ok) ** 2
        res += nk * (ok - obar) ** 2
        rows.append({"bin": k, "n": nk, "mean_p": round(pk, 4), "obs_freq": round(ok, 4)})
    return {"rel": rel / n if n else float("nan"), "res": res / n if n else float("nan"),
            "unc": obar * (1 - obar) if n else float("nan"), "obar": obar, "mean_p": float(p.mean()) if n else float("nan"),
            "diagram": rows}


def roc_auc(p: np.ndarray, o: np.ndarray) -> float:
    """Area under the ROC curve from every distinct probability level (trapezoid; ties count half): equals the
    Mann-Whitney probability that an event row has a higher p than a non-event row."""
    p, o = np.asarray(p, float), np.asarray(o, bool)
    n1, n0 = int(o.sum()), int((~o).sum())
    if not n1 or not n0:
        return float("nan")
    _u, inv, cnt = np.unique(p, return_inverse=True, return_counts=True)     # average ranks for ties, vectorised
    first = np.cumsum(cnt) - cnt                                              # 0-based rank of each level's first row
    ranks = (first + (cnt + 1) / 2.0)[inv]
    return float((ranks[o].sum() - n1 * (n1 + 1) / 2.0) / (n1 * n0))


def block_ids(days: Sequence, block_days: int = 1) -> np.ndarray:
    """Valid-day ordinals -> block ids of `block_days` consecutive days."""
    d = np.asarray(days, dtype=np.int64)
    return d // int(block_days) if block_days > 1 else d


def block_ci_mean(diff: np.ndarray, days: Sequence, reps: int = 2000, seed: int = 20261122, block_days: int = 1
                  ) -> Tuple[float, float, float]:
    """(mean, lo, hi): 95% percentile CI of the mean of `diff`, resampling whole day blocks."""
    diff = np.asarray(diff, float)
    ok = np.isfinite(diff)
    diff, blk = diff[ok], block_ids(np.asarray(days)[ok], block_days)
    if not diff.size:
        return (float("nan"),) * 3
    uniq, inv = np.unique(blk, return_inverse=True)
    sums = np.bincount(inv, weights=diff, minlength=len(uniq))
    cnts = np.bincount(inv, minlength=len(uniq)).astype(float)
    pick = np.random.default_rng(seed).integers(0, len(uniq), size=(reps, len(uniq)))
    boot = sums[pick].sum(axis=1) / cnts[pick].sum(axis=1)
    return float(diff.mean()), float(np.percentile(boot, 2.5)), float(np.percentile(boot, 97.5))


def block_ci_auc(p: np.ndarray, o: np.ndarray, days: Sequence, reps: int = 2000, seed: int = 20261122,
                 block_days: int = 1) -> Tuple[float, float, float]:
    p, o = np.asarray(p, float), np.asarray(o, bool)
    blk = block_ids(days, block_days)
    uniq, inv = np.unique(blk, return_inverse=True)
    groups = [np.where(inv == k)[0] for k in range(len(uniq))]
    rng = np.random.default_rng(seed)
    boot = []
    for _ in range(reps):
        idx = np.concatenate([groups[k] for k in rng.integers(0, len(groups), size=len(groups))])
        a = roc_auc(p[idx], o[idx])
        if a == a:
            boot.append(a)
    if not boot:
        return roc_auc(p, o), float("nan"), float("nan")
    return roc_auc(p, o), float(np.percentile(boot, 2.5)), float(np.percentile(boot, 97.5))


def loo_day_climatology(station: np.ndarray, day: np.ndarray, o: np.ndarray, min_n: int = 20) -> np.ndarray:
    """CLIM (gate section 4): per row, the station's event frequency over its OTHER days' rows; a station with fewer
    than `min_n` rows left gets the pooled frequency over every other day's rows (all stations)."""
    station, day, o = np.asarray(station), np.asarray(day), np.asarray(o, float)
    out = np.empty(o.size, float)
    tot_n, tot_e = o.size, o.sum()
    day_n: Dict = {}
    day_e: Dict = {}
    for d in np.unique(day):
        m = day == d
        day_n[d], day_e[d] = int(m.sum()), float(o[m].sum())
    for s in np.unique(station):
        ms = station == s
        sn, se = int(ms.sum()), float(o[ms].sum())
        for d in np.unique(day[ms]):
            m = ms & (day == d)
            n_left, e_left = sn - int(m.sum()), se - float(o[m].sum())
            if n_left >= min_n:
                out[m] = e_left / n_left
            else:
                out[m] = (tot_e - day_e[d]) / max(1, tot_n - day_n[d])
    return out


def cell_verdict(n_events: int, event_days: int, g1: Optional[bool], g1_5d: Optional[bool], g2: Optional[bool],
                 g2_5d: Optional[bool], g3: bool, g4: bool, events_min: int = 30, days_min: int = 10) -> str:
    """Gate sections 5-6: UNDERPOWERED / FRAGILE / PASS / FAIL. g2 None = not applicable (B4)."""
    if n_events < events_min or event_days < days_min:
        return "UNDERPOWERED"
    lines_1d = [g1, g3, g4] + ([g2] if g2 is not None else [])
    if all(lines_1d):
        if not g1_5d or (g2 is not None and not g2_5d):
            return "FRAGILE"
        return "PASS"
    return "FAIL"


def fair_brier_rows(p: np.ndarray, o: np.ndarray, m: int = MEMBERS) -> np.ndarray:
    """Per-row fair (ensemble-adjusted) Brier score for a member fraction p = k / m (amendment 2 B1):
    (p - o)^2 - p (1 - p) / (m - 1). Its mean is unbiased for the Brier score of the infinite ensemble."""
    p, o = np.asarray(p, float), np.asarray(o, float)
    return (p - o) ** 2 - p * (1.0 - p) / (m - 1.0)


def crossed_boot(diff: np.ndarray, station: Sequence, day: Sequence, reps: int = 10000, seed: int = 20261122,
                 block_days: int = 3) -> Tuple[float, float, float, float]:
    """(mean, lo, hi, p_one_sided) of the mean of a paired per-row difference under ONE two-way clustered bootstrap
    (amendment 2 B2): stations and `block_days`-day blocks are resampled independently each replicate; a row's weight is
    (draws of its station) x (draws of its block). p = (1 + #{replicate >= 0}) / (reps + 1): small when diff < 0."""
    d = np.asarray(diff, float)
    ok = np.isfinite(d)
    d = d[ok]
    if not d.size:
        return (float("nan"),) * 4
    su, si = np.unique(np.asarray(station)[ok], return_inverse=True)
    bu, bi = np.unique(block_ids(np.asarray(day)[ok], block_days), return_inverse=True)
    S = np.zeros((len(bu), len(su)))
    N = np.zeros((len(bu), len(su)))
    np.add.at(S, (bi, si), d)
    np.add.at(N, (bi, si), 1.0)
    rng = np.random.default_rng(seed)
    cb = rng.multinomial(len(bu), np.full(len(bu), 1.0 / len(bu)), size=reps).astype(float)
    cs = rng.multinomial(len(su), np.full(len(su), 1.0 / len(su)), size=reps).astype(float)
    num = np.einsum("rb,bs,rs->r", cb, S, cs)
    den = np.einsum("rb,bs,rs->r", cb, N, cs)
    boot = num[den > 0] / den[den > 0]
    p_one = (1.0 + float(np.sum(boot >= 0.0))) / (boot.size + 1.0)
    return float(d.mean()), float(np.percentile(boot, 2.5)), float(np.percentile(boot, 97.5)), p_one


def holm(pvals: Dict[str, float]) -> Dict[str, float]:
    """Holm step-down adjusted p-values (monotone, capped at 1) for one family."""
    items = sorted(pvals.items(), key=lambda kv: kv[1])
    n, out, run = len(items), {}, 0.0
    for i, (k, p) in enumerate(items):
        run = max(run, min(1.0, (n - i) * p))
        out[k] = run
    return out


def calibration_fit(p: np.ndarray, o: np.ndarray, m: int = MEMBERS, iters: int = 50) -> Tuple[float, float]:
    """(intercept a, slope b) of logit P(o=1) = a + b logit(p'), p' = p clipped to [1/(2m), 1 - 1/(2m)], by Newton-Raphson
    maximum likelihood (amendment 2 B4). NaN when o is constant or the fit does not converge."""
    o = np.asarray(o, float)
    if o.size == 0 or o.min() == o.max():
        return float("nan"), float("nan")
    lo = 1.0 / (2.0 * m)
    pc = np.clip(np.asarray(p, float), lo, 1.0 - lo)
    X = np.column_stack([np.ones_like(pc), np.log(pc / (1.0 - pc))])
    beta = np.zeros(2)
    for _ in range(iters):
        eta = X @ beta
        mu = 1.0 / (1.0 + np.exp(-eta))
        w = mu * (1.0 - mu)
        H = X.T @ (X * w[:, None])
        g = X.T @ (o - mu)
        try:
            step = np.linalg.solve(H, g)
        except np.linalg.LinAlgError:
            return float("nan"), float("nan")
        beta = beta + step
        if np.max(np.abs(step)) < 1e-9:
            return float(beta[0]), float(beta[1])
    return float("nan"), float("nan")


def window_max(times_min: np.ndarray, values: np.ndarray, end_min: int, window_h: int) -> float:
    """Largest value whose time (epoch minutes, SORTED ascending) lies in (end - window, end]; NaN when none."""
    t = np.asarray(times_min)
    a = np.searchsorted(t, end_min - 60 * window_h, side="right")
    b = np.searchsorted(t, end_min, side="right")
    v = np.asarray(values, float)[a:b]
    v = v[np.isfinite(v)]
    return float(v.max()) if v.size else float("nan")


def iter_cells(thresholds_kn: Iterable[int] = THRESHOLDS_KN):
    for t in thresholds_kn:
        yield t, round(t * KN_TO_MS, 3)
