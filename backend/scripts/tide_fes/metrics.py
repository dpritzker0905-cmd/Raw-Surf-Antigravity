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


NOAA_TERMS = ("SA", "SSA", "M1", "M3", "S1")


def schureman_astro(t):
    """Mean longitudes (deg) of the moon s, sun h, lunar perigee p and the moon's node N at an aware UTC datetime
    (Schureman 1958, SP 98; T in Julian centuries from 1899-12-31 12:00 UTC)."""
    from datetime import datetime, timezone
    T = (t - datetime(1899, 12, 31, 12, tzinfo=timezone.utc)).total_seconds() / 86400.0 / 36525.0
    return (270.43416 + 481267.88314 * T + 0.00199 * T * T, 279.69668 + 36000.76892 * T + 0.0003025 * T * T,
            334.32956 + 4069.03403 * T - 0.01032 * T * T, 259.18328 - 1934.14201 * T + 0.00208 * T * T)


def sun_mean_longitude_deg(t):
    """The sun's mean longitude h (deg). NOAA publishes SA / SSA phases for the arguments h / 2h."""
    return schureman_astro(t)[1]


def _nodal(N_deg):
    """Schureman's I, nu, xi (radians) from the node longitude."""
    w, i, n = math.radians(23.452), math.radians(5.145), math.radians(N_deg % 360)
    I = math.acos(math.cos(w) * math.cos(i) - math.sin(w) * math.sin(i) * math.cos(n))

    def near(x):                                              # the branch continuous with N/2
        while x - n / 2 > math.pi / 2:
            x -= math.pi
        while x - n / 2 < -math.pi / 2:
            x += math.pi
        return x
    a = near(math.atan(1.01883 * math.tan(n / 2)))            # (N - xi + nu) / 2
    b = near(math.atan(0.64412 * math.tan(n / 2)))            # (N - xi - nu) / 2
    return I, a - b, n - (a + b)


def noaa_year_terms(year):
    """NOAA's predictor convention for the terms pyTMD defines differently: V0 at 00:00 UTC Jan 1, f and u at mid-year.
    M1 is Schureman's: V + u = T - s + h - 90 + xi - nu + Q, f = f(O1) / Ra. M3: 3(T - s + h), u = 3(xi - nu),
    f = cos^6(I/2) / 0.8840. S1: V = T. SA / SSA: V = h / 2h, f = 1, u = 0. Calibrated (P only, calendar 2025, 26
    stations): median 0.0031 m, max 0.0092 m (log 2026-11-16)."""
    from datetime import datetime, timezone
    s, h, p, N = schureman_astro(datetime(year, 1, 1, tzinfo=timezone.utc))
    _, _, pm, Nm = schureman_astro(datetime(year, 7, 2, 12, tzinfo=timezone.utc))
    I, nu, xi = _nodal(Nm)
    P = math.radians(pm % 360) - xi
    cI, c2 = math.cos(I), math.cos(I / 2) ** 2
    inv_ra = math.sqrt(0.25 + 1.5 * (cI / c2) * math.cos(2 * P) + 2.25 * (cI / c2) ** 2)
    Q = math.atan2((5 * cI - 1) * math.sin(P), (7 * cI + 1) * math.cos(P))
    T0 = 180.0                                                # hour angle of the mean sun at 00:00 UTC
    return {
        "M1": (math.sin(I) * c2 / 0.3800 * inv_ra, T0 - s + h - 90 + math.degrees(xi - nu + Q)),
        "M3": (math.cos(I / 2) ** 6 / 0.8840, 3 * (T0 - s + h) + math.degrees(3 * (xi - nu))),
        "S1": (1.0, T0),
        "SA": (1.0, h),
        "SSA": (1.0, 2 * h),
    }


def noaa_terms(harcon, times):
    """Sum of NOAA_TERMS at aware UTC datetimes. harcon: [(num, name, amp_m, G_deg)] or with speed as a 5th item;
    the speed is required for M1/M3/S1/SA/SSA and falls back to NOAA's published speeds."""
    from datetime import datetime, timezone
    speed = {"SA": 0.0410686, "SSA": 0.0821373, "M1": 14.4966939, "M3": 43.4761563, "S1": 15.0}
    terms = [(r[1], r[2], r[3], (r[4] if len(r) > 4 else speed[r[1]])) for r in harcon if r[1] in NOAA_TERMS and r[2] > 0]
    years, out = {}, []
    for t in times:
        if t.year not in years:
            years[t.year] = (noaa_year_terms(t.year), datetime(t.year, 1, 1, tzinfo=timezone.utc))
        yt, t0 = years[t.year]
        hrs = (t - t0).total_seconds() / 3600.0
        out.append(sum(yt[n][0] * a * math.cos(math.radians(sp * hrs + yt[n][1] - g)) for n, a, g, sp in terms))
    return out


def noaa_long_period(harcon, times):
    """Kept for the earlier test: the SA + SSA part only."""
    return noaa_terms([r for r in harcon if r[1] in ("SA", "SSA")], times)


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
