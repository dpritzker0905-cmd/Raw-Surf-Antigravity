"""G3t gate rules, as registered (docs/weather-program/log/2026-11-15-claude-tide-m1.md: G3t FINAL b6eb66fa6, which
consolidates the draft 755115a37 and addenda 9d56192d1 / 24eee6b51 / f1e48bc50 / 08bf79992). numpy only; no I/O, so
every rule is tested (tests/test_tide_g3t_rules.py).

Arrays: obs[g] -> (H,); arm series per lead bin -> (B, H). The gate's lead bins are 24-48 h and 48-72 h (B = 2): P
has no issue time and repeats one row; C and D come from Open-Meteo previous_day1 / previous_day2.
"""
import math
from datetime import datetime, timedelta, timezone

import numpy as np

REGISTRATION = "G3t"
W0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
W1 = datetime(2026, 7, 24, 23, tzinfo=timezone.utc)
HELD_OUT = ((datetime(2026, 3, 15, tzinfo=timezone.utc), datetime(2026, 3, 22, tzinfo=timezone.utc)),
            (datetime(2026, 6, 15, tzinfo=timezone.utc), datetime(2026, 6, 22, tzinfo=timezone.utc)))
BASE = (datetime(2016, 1, 1), datetime(2025, 12, 31))
GATE_BINS = (1, 2)                      # om_runs bins: 1 = previous_day1 (24-48 h), 2 = previous_day2 (48-72 h)
LATEST_BIN = 0                          # Open-Meteo's latest run: REPORTED ("what a user sees today")
ITEM1_D_MARGIN = -0.02
ITEM2_GAUGE_MAX = 0.05
TIMING_MAX_MIN, MLLW_MAX_M = 20.0, 0.05
POSITIVE_MAX_M, SWAP_MIN_M = 0.01, 0.3
COVERAGE_MIN, EXCLUDED_MAX = 0.95, 0.20
ITEM5_COVERAGE_MIN, ITEM5_MIN_GAUGES, ITEM5_MAX_M = 0.80, 5, 0.02
SPIKE_M, SPIKE_HALF_H, FLAT_RUN_H = 0.5, 2, 6
SHIFT_DAYS = 182
DRAWS, SEED = 2000, 20260101
PARITY_MAX_M, PARITY_RMS_M, PARITY_HILO_MIN = 0.010, 0.003, 6.0
DATUM_LABEL = "a datum finding: the level needs a per-place reference"
SCOPE_LABEL = "Tide + seasonal level (no storm surge). Checked against NOAA gauges on US coasts; unverified elsewhere."
SEASON_SCOPE = "seasonal term verified for the months tested (Jan-Jul)"


def window_hours():
    """Hourly UTC over the window, the held-out weeks removed."""
    out, t = [], W0
    while t <= W1:
        if not any(a <= t < b for a, b in HELD_OUT):
            out.append(t)
        t += timedelta(hours=1)
    return out


def segments():
    """[(start, end)] inclusive hourly spans of the window with the held-out weeks cut out: truth is REQUESTED only
    over these, so no held-out hour is ever fetched."""
    out, a = [], W0
    for h0, h1 in HELD_OUT:
        out.append((a, h0 - timedelta(hours=1)))
        a = h1
    out.append((a, W1))
    return out


# ---------------------------------------------------------------- S1 = M + S (addendum 2, change 2)
def split_s1(doy_mean):
    """doy_mean: {day-of-year: m} (the base-period day-of-year mean SLA). Returns (M, S): M = the mean over the year's
    days (one constant: the present mean level against 1993-2012); S = {doy: doy_mean - M} (zero-mean)."""
    vals = [v for v in doy_mean.values() if v is not None and math.isfinite(v)]
    if not vals:
        return float("nan"), {}
    m = float(np.mean(vals))
    return m, {int(k): float(v) - m for k, v in doy_mean.items() if v is not None and math.isfinite(v)}


def shifted(s_doy, days=SHIFT_DAYS):
    """S shifted by `days` (wrapped over 365/366): the value used at doy d is S at d - days."""
    n = 366 if 366 in s_doy else 365
    return {d: s_doy.get(((d - 1 - days) % n) + 1, float("nan")) for d in s_doy}


def trend_carried_m(days_since_base_mid, base_slope_m_per_day, m):
    """REPORTED variant: M carried forward by the base period's linear SLA trend to the window's mid-date."""
    return m + base_slope_m_per_day * days_since_base_mid


def series_on(hours, const=0.0, doy=None, bins=len(GATE_BINS)):
    """An arm row on the window hours: const + doy[day-of-year] (NaN where doy lacks the day), tiled over the bins."""
    v = np.array([const + (doy.get(t.timetuple().tm_yday, np.nan) if doy is not None else 0.0) for t in hours], float)
    return np.tile(v, (bins, 1))


# ---------------------------------------------------------------- coverage (G3b addendum 1, item 4, carried)
def coverage(x):
    x = np.asarray(x, float)
    return float(np.isfinite(x).mean()) if x.size else 0.0


def excluded_gauges(P, D, obs, gauges):
    """{gauge: why} for gauges below 95% coverage on P, D (each gate bin) or observed water."""
    out = {}
    for g in gauges:
        why = []
        if g not in P or min(coverage(r) for r in P[g]) < COVERAGE_MIN:
            why.append("P")
        if g not in D or min(coverage(r) for r in D[g]) < COVERAGE_MIN:
            why.append("D")
        if g not in obs or coverage(obs[g]) < COVERAGE_MIN:
            why.append("observed")
        if why:
            out[g] = "coverage < 95%: " + ", ".join(why)
    return out


def coverage_void(n_excluded, n_total):
    return n_total == 0 or n_excluded / n_total > EXCLUDED_MAX


# ---------------------------------------------------------------- items
def item1(p_minus_d, p_minus_c):
    """(point, lo, hi) each: P - D upper end <= -0.02 m AND P - C upper end < 0."""
    return bool(math.isfinite(p_minus_d[2]) and p_minus_d[2] <= ITEM1_D_MARGIN and math.isfinite(p_minus_c[2])
                and p_minus_c[2] < 0)


def item2(per_gauge_p_minus_d, d_scored, p_scored):
    """{gauge: why} for every gauge worse than D by > 0.05 m (point), plus every gauge D scores and P cannot."""
    bad = {g: round(v, 4) for g, v in per_gauge_p_minus_d.items() if v > ITEM2_GAUGE_MAX}
    for g in d_scored:
        if g not in p_scored:
            bad[g] = "P undefined"
    return bad


def item3(am_minus_a, p_minus_am, shifted_minus_p_point):
    """3a: (A+M) - A upper end < 0. 3b: P - (A+M) upper end < 0 AND the shifted arm's POINT must not beat P (by
    choice, a point value)."""
    a = bool(math.isfinite(am_minus_a[2]) and am_minus_a[2] < 0)
    b = bool(math.isfinite(p_minus_am[2]) and p_minus_am[2] < 0 and math.isfinite(shifted_minus_p_point)
             and shifted_minus_p_point > 0)
    return a, b


def item4(hilo_medians, mllw_abs_errs):
    return bool(hilo_medians and float(np.median(hilo_medians)) <= TIMING_MAX_MIN and mllw_abs_errs
                and float(np.median(mllw_abs_errs)) <= MLLW_MAX_M)


def item5(per_gauge_rmse_p, per_gauge_rmse_c):
    """The beach no-harm guard (point, deliberate). Inputs are per QUALIFYING gauge (open-coast, >= 80% coverage after
    QC, mean-removed). Returns (status, value): ("NOT RUNNABLE", None) below 5 gauges; else (True/False, median)."""
    gs = [g for g in per_gauge_rmse_p if g in per_gauge_rmse_c and math.isfinite(per_gauge_rmse_p[g])
          and math.isfinite(per_gauge_rmse_c[g])]
    if len(gs) < ITEM5_MIN_GAUGES:
        return "NOT RUNNABLE", None
    d = float(np.median([per_gauge_rmse_p[g] - per_gauge_rmse_c[g] for g in gs]))
    return bool(d <= ITEM5_MAX_M), d


def controls_ok(positive_median_m, swap_median_m):
    return {"positive_noaa_constants": bool(math.isfinite(positive_median_m) and positive_median_m <= POSITIVE_MAX_M),
            "negative_label_swap": bool(math.isfinite(swap_median_m) and swap_median_m > SWAP_MIN_M)}


def verdict(items, controls, coverage_is_void):
    """VOID (a control, or coverage) > PASS / FAIL. An item whose value is "NOT RUNNABLE" (item 5) does not count."""
    if coverage_is_void or any(v is False for v in controls.values()):
        return "VOID"
    decided = [v for v in items.values() if v != "NOT RUNNABLE"]
    return "PASS" if all(v is True for v in decided) else "FAIL"


def datum_label(raw_1_2_pass, demeaned_1_2_pass):
    """Addendum 2, change 4: a raw FAIL of item 1 or 2 beside a mean-removed PASS is named; the verdict stays raw."""
    return DATUM_LABEL if (not raw_1_2_pass and demeaned_1_2_pass) else None


# ---------------------------------------------------------------- QC for independent gauges (item 5, reported rows)
def qc_series(x):
    """Spikes (|x - centred 5 h median| > 0.5 m; short enough that a smooth tide is never flagged) and flat lines
    (>= 6 identical consecutive hours) become NaN."""
    x = np.asarray(x, float).copy()
    n = len(x)
    med = np.full(n, np.nan)
    for i in range(SPIKE_HALF_H, n - SPIKE_HALF_H):         # centred windows only: a one-sided edge window on a steep
        w = x[i - SPIKE_HALF_H: i + SPIKE_HALF_H + 1]          # tide would flag good values
        w = w[np.isfinite(w)]
        if w.size >= 3:
            med[i] = np.median(w)
    spike = np.isfinite(x) & np.isfinite(med) & (np.abs(x - med) > SPIKE_M)
    flat = np.zeros(n, bool)
    i = 0
    while i < n:
        j = i
        while j + 1 < n and np.isfinite(x[i]) and x[j + 1] == x[i]:
            j += 1
        if j - i + 1 >= FLAT_RUN_H:
            flat[i:j + 1] = True
        i = j + 1
    x[spike | flat] = np.nan
    return x


def demeaned(x):
    x = np.asarray(x, float)
    return x - np.nanmean(x, axis=-1, keepdims=True) if np.isfinite(x).any() else x


# ---------------------------------------------------------------- parity (addendum 2, change 5): a merge CI line
def parity(served, gated, served_hilo_times=(), gated_hilo_times=()):
    """served / gated: the level at one gauge position on the window hours (m). High/Low times: datetimes, paired in
    order. Returns (ok, {max, rms, hilo_max_min})."""
    s, g = np.asarray(served, float), np.asarray(gated, float)
    m = np.isfinite(s) & np.isfinite(g)
    d = s[m] - g[m]
    mx = float(np.max(np.abs(d))) if d.size else float("inf")
    rms = float(np.sqrt(np.mean(d ** 2))) if d.size else float("inf")
    hilo = [abs((a - b).total_seconds()) / 60.0 for a, b in zip(served_hilo_times, gated_hilo_times)]
    hm = max(hilo) if hilo else 0.0
    ok = bool(m.sum() and mx <= PARITY_MAX_M and rms <= PARITY_RMS_M and hm <= PARITY_HILO_MIN
              and len(served_hilo_times) == len(gated_hilo_times))
    return ok, {"max_m": mx, "rms_m": rms, "hilo_max_min": hm}
