"""G3 gate rules, as registered (docs/weather-program/log/2026-11-15-claude-tide-m1.md: G3 FINAL 16:2x EST, addendum
af9e7a8a4, clarifications 4668f4c69, storms beab9f76c, closed c0a2a95a4). numpy only; no I/O, so every rule is tested.

Arrays are hourly over the window: obs[g], pred[g] -> shape (H,); arm series per lead bin -> shape (B, H) (B = 3 lead
bins 0-24/24-48/48-72 h; arms without a lead repeat one row). NaN = missing; every comparison uses hours where both
sides are finite.
"""
import math
from datetime import timedelta

import numpy as np

SURGE_M = 0.15
CALM_M = 0.05
EVENT_MIN_H = 12
STORM_LINK_H = 48
MIN_STORMS, MIN_STORM_REGIONS = 3, 2
MIN_SURGE_H, MIN_SURGE_GAUGES = 48, 5
ITEM1_D_MARGIN = -0.02          # P1 - D: interval upper end <= -0.02 m
ITEM2_GAUGE_MAX = 0.05          # per gauge P1 - D <= +0.05 m (point; deliberately strict)
ITEM4_CALM_MAX = 0.01           # P1 - A on calm hours: upper end <= +0.01 m
TIMING_MAX_MIN, MLLW_MAX_M = 20.0, 0.05
POSITIVE_MAX_M, SWAP_MIN_M = 0.01, 0.3
DRAWS, SEED, BLOCK_H = 2000, 20260825, 48
ESTUARY = {"8720030", "8729840", "9435380", "8651370", "8531680", "8723214"}
LOW_POWER = "on 3 storms, low power"


def lowpass25(x):
    """Centred 25-hour running mean; NaN where fewer than 20 of the 25 hours are finite."""
    x = np.asarray(x, dtype=float)
    out = np.full(x.shape, np.nan)
    for i in range(len(x)):
        w = x[max(0, i - 12): i + 13]
        if np.isfinite(w).sum() >= 20:
            out[i] = np.nanmean(w)
    return out


def demeaned_residual(obs_ext, pred_ext, n_pre):
    """Observed - predicted, 25 h low-pass, minus its own mean over the first n_pre hours (the 30 days BEFORE the
    window). Returns (residual over the remaining hours, pre-window mean)."""
    lp = lowpass25(np.asarray(obs_ext, float) - np.asarray(pred_ext, float))
    pre = lp[:n_pre]
    m = float(np.nanmean(pre)) if np.isfinite(pre).sum() >= 24 * 20 else float("nan")
    return lp[n_pre:] - m, m


def events(mask, times):
    """Runs of >= EVENT_MIN_H consecutive True hours -> [(start_index, length)]."""
    out, start = [], None
    for i, v in enumerate(list(mask) + [False]):
        if v and start is None:
            start = i
        elif not v and start is not None:
            if i - start >= EVENT_MIN_H:
                out.append((start, i - start))
            start = None
    return out


def storms(gauge_events, times, region_of):
    """gauge_events: {gauge: [(start_idx, length)]}. Same-region gauge-events that overlap in time or start within 48 h
    of each other (single-linkage) are ONE storm. Returns [{"region", "members": [(gauge, start, length)]}]."""
    out = []
    for reg in sorted({region_of(g) for g in gauge_events}):
        evs = sorted(((g, s, n) for g, es in gauge_events.items() if region_of(g) == reg for s, n in es), key=lambda e: e[1])
        cur, end = [], None
        for g, s, n in evs:
            linked = cur and (s <= end or any(abs((times[s] - times[c[1]]).total_seconds()) <= STORM_LINK_H * 3600 for c in cur))
            if cur and not linked:
                out.append({"region": reg, "members": cur})
                cur, end = [], None
            cur.append((g, s, n))
            end = max(end or 0, s + n)
        if cur:
            out.append({"region": reg, "members": cur})
    return out


def item3_runnable(storm_list, surge_hours_by_gauge):
    regions = {s["region"] for s in storm_list}
    gauges48 = sum(1 for h in surge_hours_by_gauge.values() if h >= MIN_SURGE_H)
    return len(storm_list) >= MIN_STORMS and len(regions) >= MIN_STORM_REGIONS and gauges48 >= MIN_SURGE_GAUGES


def _rmse(a, b):
    m = np.isfinite(a) & np.isfinite(b)
    return float(np.sqrt(np.mean((a[m] - b[m]) ** 2))) if m.sum() else float("nan")


def per_gauge_rmse(arm, obs, gauges, hours_idx=None):
    """arm[g]: (B, H); obs[g]: (H,). Pooled over lead bins on the given hours."""
    out = {}
    for g in gauges:
        a, o = arm[g], obs[g]
        if hours_idx is not None:
            a, o = a[:, hours_idx], o[hours_idx]
        out[g] = _rmse(a.ravel(), np.broadcast_to(o, a.shape).ravel())
    return out


def bias_sd(arm_g, obs_g):
    a = np.asarray(arm_g, float).ravel()
    o = np.broadcast_to(obs_g, np.shape(arm_g)).ravel()
    m = np.isfinite(a) & np.isfinite(o)
    d = a[m] - o[m]
    return (float(d.mean()), float(d.std())) if m.sum() else (float("nan"), float("nan"))


def demean_arm(arm, obs):
    """Mean-removed versions (each side minus its own window mean, per gauge and lead bin): the reported score."""
    a2, o2 = {}, {}
    for g in arm:
        a = arm[g] - np.nanmean(arm[g], axis=1, keepdims=True)
        a2[g] = a
        o2[g] = obs[g] - np.nanmean(obs[g])
    return a2, o2


def _blocks(H, block_h=BLOCK_H):
    return [np.arange(s, min(s + block_h, H)) for s in range(0, H, block_h)]


def _sq(arm_g, ref_g, obs_g, idx):
    """Per hour in idx: summed squared error of arm and ref over lead bins, and the count, on hours/bins where arm, ref
    and observed are ALL finite (a paired comparison)."""
    a, r = arm_g[:, idx], ref_g[:, idx]
    o = np.broadcast_to(obs_g[idx], a.shape)
    m = np.isfinite(a) & np.isfinite(r) & np.isfinite(o)
    sa = np.where(m, (a - o) ** 2, 0.0).sum(axis=0)
    sr = np.where(m, (r - o) ** 2, 0.0).sum(axis=0)
    return sa, sr, m.sum(axis=0)


def paired_median_diff(arm, ref, obs, gauges, draws=DRAWS, seed=SEED, hours_idx=None):
    """Median over gauges of RMSE(arm) - RMSE(ref) vs observed (paired hours), with a 95% bootstrap interval that
    resamples gauges and 2-day blocks. Returns (point, lo, hi, per_gauge_diffs)."""
    gauges = [g for g in gauges if g in arm and g in ref and g in obs]
    if not gauges:
        return float("nan"), float("nan"), float("nan"), {}
    H = len(obs[gauges[0]])
    base = np.arange(H) if hours_idx is None else np.asarray(hours_idx)
    blocks = _blocks(len(base))
    SA, SR, N = (np.zeros((len(gauges), len(blocks))) for _ in range(3))
    for i, g in enumerate(gauges):
        sa, sr, n = _sq(arm[g], ref[g], obs[g], base)
        for j, blk in enumerate(blocks):
            SA[i, j], SR[i, j], N[i, j] = sa[blk].sum(), sr[blk].sum(), n[blk].sum()

    def diffs_for(w_blocks):
        na = N @ w_blocks
        with np.errstate(invalid="ignore", divide="ignore"):
            return np.where(na > 0, np.sqrt((SA @ w_blocks) / na) - np.sqrt((SR @ w_blocks) / na), np.nan)
    d0 = diffs_for(np.ones(len(blocks)))
    diffs = {g: float(d0[i]) for i, g in enumerate(gauges) if np.isfinite(d0[i])}
    if not diffs:
        return float("nan"), float("nan"), float("nan"), diffs
    point = float(np.median(list(diffs.values())))
    rng, stats = np.random.default_rng(seed), []
    for _ in range(draws):
        w = np.bincount(rng.integers(0, len(blocks), len(blocks)), minlength=len(blocks)).astype(float)
        d = diffs_for(w)[rng.integers(0, len(gauges), len(gauges))]
        d = d[np.isfinite(d)]
        if d.size:
            stats.append(float(np.median(d)))
    return point, float(np.percentile(stats, 2.5)), float(np.percentile(stats, 97.5)), diffs


def pooled_diff(arm, ref, obs, pairs, units, draws=DRAWS, seed=SEED):
    """Pooled RMSE(arm) - RMSE(ref) over (gauge, hour) pairs (paired hours); bootstrap by resampling `units` (lists of
    pairs: storms for item 3, gauge x 2-day block cells for item 4). Returns (point, lo, hi)."""
    def sums(ps):
        sa = sr = n = 0.0
        by_g = {}
        for g, h in ps:
            by_g.setdefault(g, []).append(h)
        for g, hs in by_g.items():
            if g in arm and g in ref and g in obs:
                a, r, c = _sq(arm[g], ref[g], obs[g], np.asarray(hs))
                sa, sr, n = sa + a.sum(), sr + r.sum(), n + c.sum()
        return sa, sr, n

    def stat(sa, sr, n):
        return float(math.sqrt(sa / n) - math.sqrt(sr / n)) if n else float("nan")
    point = stat(*sums(pairs))
    if not units:
        return point, float("nan"), float("nan")
    U = np.array([sums(u) for u in units])
    rng, stats = np.random.default_rng(seed), []
    for _ in range(draws):
        w = np.bincount(rng.integers(0, len(units), len(units)), minlength=len(units)).astype(float)
        v = stat(*(U.T @ w))
        if math.isfinite(v):
            stats.append(v)
    return point, float(np.percentile(stats, 2.5)), float(np.percentile(stats, 97.5))


def calm_units(pairs, H, block_h=BLOCK_H):
    """Item 4's bootstrap units: (gauge, 2-day block) cells."""
    cells = {}
    for g, h in pairs:
        cells.setdefault((g, h // block_h), []).append((g, h))
    return list(cells.values())


def derangements(n, count=200, seed=SEED):
    rng, seen, out = np.random.default_rng(seed), set(), []
    while len(out) < count and n > 1:
        p = rng.permutation(n)
        if (p == np.arange(n)).any() or tuple(p) in seen:
            continue
        seen.add(tuple(p))
        out.append(p)
    return out


def label_swap(arm, obs, gauges):
    """Median over derangements of the median over gauges of RMSE(arm at g_i vs observed at g_perm(i))."""
    gs = [g for g in gauges if g in arm and g in obs]
    meds = []
    for p in derangements(len(gs)):
        vals = [_rmse(arm[gs[i]].ravel(), np.broadcast_to(obs[gs[j]], arm[gs[i]].shape).ravel()) for i, j in enumerate(p)]
        vals = [v for v in vals if math.isfinite(v)]
        if vals:
            meds.append(float(np.median(vals)))
    return float(np.median(meds)) if meds else float("nan")


def verdict(items, controls, item3_ok):
    """items: {name: bool}; controls: {name: bool or None (not runnable)}. VOID > INCONCLUSIVE > PASS/FAIL."""
    if any(v is False for v in controls.values()):
        return "VOID"
    if not item3_ok:
        return "INCONCLUSIVE"
    return "PASS" if all(items.values()) else "FAIL"


def datum_label(item1_raw_pass, item1_demeaned_pass):
    if not item1_raw_pass and item1_demeaned_pass:
        return "a datum finding: the level needs a per-place reference"
    return None


def shift_hours(x, k):
    """x shifted LATER by k hours (value at t = x at t - k); the first k hours become NaN."""
    x = np.asarray(x, float)
    out = np.full(x.shape, np.nan)
    out[..., k:] = x[..., :-k] if k else x
    return out


def hour_index(times, t):
    return int(round((t - times[0]).total_seconds() / 3600))


def window_hours(start, end):
    return [start + timedelta(hours=k) for k in range(int((end - start).total_seconds() // 3600) + 1)]
