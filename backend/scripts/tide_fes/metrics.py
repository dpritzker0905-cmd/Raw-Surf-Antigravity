"""PURE gate arithmetic for the M1 tide gate (standard library only, so it is unit-tested without PyFES/pyTMD).

The rules are the RECONCILED pre-registration in docs/weather-program/log/2026-11-15-claude-tide-m1.md (22:25 EST):
median RMSE <= 0.08 m and below arm C; no station worse than arm C by > 0.05 m; median High/Low time error <= 20 min;
median |MSL-MLLW offset error| <= 0.05 m; three controls, any misbehaving control makes the result VOID.
"""
import math
import random
import statistics as st
from datetime import timedelta

RMSE_MAX_M = 0.08
STATION_MARGIN_M = 0.05
TIMING_MAX_MIN = 20.0
MLLW_MAX_M = 0.05
POSITIVE_MAX_M = 0.01
NEGATIVE_SWAP_MIN_M = 0.3
DERANGEMENTS = 200
MATCH_WINDOW_H = 3.0
TIDAL_DAY_H = 24.8412
TIE_M = 0.01
GULF = {"8726724", "8729840", "8771510"}


def rmse(x, y):
    return math.sqrt(sum((p - q) ** 2 for p, q in zip(x, y)) / len(x))


def stratum(sid):
    if sid.startswith("16"):
        return "Hawaii"
    if sid.startswith("94"):
        return "Pacific"
    if sid.startswith("97"):
        return "PR"
    return "Gulf" if sid in GULF else "Atlantic"


def extrema(times, vals):
    """Local max/min with a parabolic refinement of the time. Returns [(time, 'H'|'L')]."""
    out = []
    for i in range(1, len(vals) - 1):
        a, b, c = vals[i - 1], vals[i], vals[i + 1]
        if (b > a and b >= c) or (b < a and b <= c):
            den = a - 2 * b + c
            off = 0.5 * (a - c) / den if den else 0.0
            step = (times[i + 1] - times[i]).total_seconds()
            out.append((times[i] + timedelta(seconds=off * step), "H" if b > a else "L"))
    return out


def hilo_errors(truth_events, arm_events):
    """Minutes from each truth High/Low to the nearest arm extremum of the same type within +/-3 h.
    An event with no match counts as +inf (stricter than dropping it)."""
    errs = []
    win = MATCH_WINDOW_H * 60.0
    for t0, kind in truth_events:
        cand = [abs((t - t0).total_seconds()) / 60.0 for t, k in arm_events if k == kind]
        best = min(cand) if cand else math.inf
        errs.append(best if best <= win else math.inf)
    return errs


def median_or_none(vals):
    v = [x for x in vals if x is not None]
    return st.median(v) if v else None


def mllw_offset(values, step_h):
    """MSL minus MLLW (m) of a uniformly sampled series: the series mean minus the mean of each FULL tidal day's lowest
    value (NOAA's MLLW: the mean of the lower low water of each tidal day)."""
    n_day = TIDAL_DAY_H / step_h
    lows, k = [], 0
    while (k + 1) * n_day <= len(values):
        lows.append(min(values[int(round(k * n_day)):int(round((k + 1) * n_day))]))
        k += 1
    if not lows:
        return None
    return st.mean(values) - st.mean(lows)


def derangements(n, count=DERANGEMENTS, seed=20261015):
    """`count` distinct random permutations of range(n) with no fixed point (deterministic seed)."""
    rng, seen, out = random.Random(seed), set(), []
    while len(out) < count:
        p = list(range(n))
        rng.shuffle(p)
        if any(i == v for i, v in enumerate(p)) or tuple(p) in seen:
            continue
        seen.add(tuple(p))
        out.append(p)
    return out


def arm_verdict(arm, base_c):
    """arm / base_c: {sid: {"rmse": m, "hilo_med": min or inf/None, "mllw_err": m or None}}. Returns the four items."""
    rm = median_or_none([r.get("rmse") for r in arm.values()])
    rc = median_or_none([r.get("rmse") for r in base_c.values()])
    worse = []
    for sid, c in base_c.items():
        if c.get("rmse") is None:
            continue
        a = (arm.get(sid) or {}).get("rmse")
        if a is None or a - c["rmse"] > STATION_MARGIN_M:  # a station C scores but this arm cannot counts against it
            worse.append(sid)
    hm = median_or_none([r.get("hilo_med") for r in arm.values()])
    me = median_or_none([abs(r["mllw_err"]) if r.get("mllw_err") is not None else None for r in arm.values()])
    items = {
        "1_rmse": rm is not None and rc is not None and rm <= RMSE_MAX_M and rm < rc,
        "2_no_station_worse_than_C": not worse,
        "3_timing": hm is not None and hm <= TIMING_MAX_MIN,
        "4_mllw": me is not None and me <= MLLW_MAX_M,
    }
    return {"median_rmse_m": rm, "median_rmse_C_m": rc, "stations_worse_than_C": worse, "median_hilo_min": hm,
            "median_abs_mllw_err_m": me, "items": items, "pass": all(items.values())}


def choose(verdicts):
    """verdicts: {"A": v, "B": v}. Passing arms first; lower median RMSE; within 0.01 m, A. None if nothing scored."""
    scored = {k: v for k, v in verdicts.items() if v and v.get("median_rmse_m") is not None}
    if not scored:
        return None
    pool = {k: v for k, v in scored.items() if v["pass"]} or scored
    best = min(pool, key=lambda k: pool[k]["median_rmse_m"])
    if "A" in pool and best != "A" and pool["A"]["median_rmse_m"] - pool[best]["median_rmse_m"] <= TIE_M:
        return "A"
    return best


def controls_ok(positive_median_m, swap_median_m, shifted_hilo_median_min):
    """The three pre-registered controls. All must behave, else the gate result is VOID."""
    c = {
        "positive_synthesis": positive_median_m is not None and positive_median_m <= POSITIVE_MAX_M,
        "negative_label_swap": swap_median_m is not None and swap_median_m > NEGATIVE_SWAP_MIN_M,
        "negative_6h_shift_fails_timing": shifted_hilo_median_min is None or shifted_hilo_median_min > TIMING_MAX_MIN,
    }
    return c, all(c.values())


def final(verdicts, controls_all_ok):
    chosen = choose(verdicts)
    if not controls_all_ok:
        return chosen, "VOID"
    return chosen, "PASS" if chosen and verdicts[chosen]["pass"] else "FAIL"
