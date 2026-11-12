"""guardrail_stats.py - the statistics shared by the pre-merge history FILTER and the post-ship live GUARDRAIL (D-065).

D-065 (owner, 2026-11-04 ~01:41Z: "make fixes by default so they are visible and on, and have a checker or filter to
see if its working or not"): a fix ships ON. What blocks it, or turns it off, is evidence that it is WORSE. "Not
proven better" never blocks. Both tools ask the same question of the same pairs, so both use this module.

THE TEST (two-way, per family member). Items are gate_v2 pairs {t, buoy, lead, obs, f_ref, f_cand} with
f_ref = the flag OFF and f_cand = the flag ON. Per target hour, d = |f_OFF - obs| - |f_ON - obs| (the panel form,
`gate_v2_stats.differential_series`; positive = ON closer). Then
  * Diebold-Mariano with Newey-West HAC and the HLN factor (`gate_v2_stats.diebold_mariano`), lag and block from
    `gate_v2_stats.dependence`, one-sided both ways (p_worse, p_better);
  * a moving-block bootstrap CI of mean d (`gate_v2_stats.block_bootstrap`, 2000 reps, fixed seed).
A member is WORSE when its Holm-adjusted p_worse < ALPHA, where p_worse tests the margin-shifted null "ON is not
worse by more than the margin" (the Holm family is every testable member), AND the bootstrap CI's upper end sits
below -margin, where margin = max(MARGIN_ABS_M, MARGIN_REL x OFF's MAE). The margin is
the materiality floor: with thousands of pairs a 1 mm loss is "significant" and must not kill a fix or make it flap.
BETTER is the mirror (reported, never required).

THE FAMILY: the pooled pairs, each LEAD (so harm at one lead is not averaged away by the others),
each SEASON (DJF/MAM/JJA/SON by valid month, swapped for a station south of the
equator) and each REGION (a station's `region`, else a 3-degree latitude band and coast side). A stratum under
MIN_HOURS target hours or MIN_PAIRS pairs is UNTESTABLE and leaves the family (it can neither block nor pass).
Holm runs across the testable members, so a fix is not killed by testing many small strata.

VERDICTS: WORSE (blocks a merge / disables a live fix), BETTER (pooled better, no member worse), NOT_WORSE (testable,
neither), NO_CHANGE (ON == OFF at every pair: inert in this window), UNTESTABLE (no member testable).

OVERLAP (named): claude/harness-two-way-gate (b5c1aa08, draft) adds `eval_twoway.py`, a spatial-block (100 km) x
UTC-day bootstrap over >= 14 days, after measuring that station-cluster CIs falsely pass 31-35% of correlated nulls.
`two_way()` here averages buoys within each hour first (the panel form, which absorbs same-hour cross-station
correlation) and block-bootstraps the hour series; it is NOT that estimator. When that branch lands, `two_way()`'s CI
should delegate to eval_twoway so the flip scorecard, this filter and the guardrail give one answer; until then the
guardrail's 14-day window meets its >= 14-day rule and the filter's 10-day cached window does not (a WORSE there is
still reported and blocks; the two-strike rule protects the live path).

STATISTICS V2 (2026-11-11, SOTA researcher topic 5; kill GUARDRAIL_STATS_V2=0 restores the rule above exactly):
  * MEASURED FIRST (`scripts/guardrail_null_rate.py`, AR(1) nulls, 400 sims a cell): the V1 rule and a
    bootstrap-primary rule BOTH call a true no-change WORSE ~20% of the time at rho 0.9 and ~28% at rho 0.95 over a
    28-hour window; doubling the block does not help. Neither the NW-HAC DM p-value nor the block bootstrap holds its
    size when the effective sample is a handful of hours (Coroneo et al. 2024, IJF). The researcher's "bootstrap
    primary" was therefore not adopted as measured; the fix the literature gives for exactly this case is below.
    It roughly halves the false-WORSE rate (2-7% up to rho 0.7, the regime the real loss differentials sit in at the
    guardrail's 12 h step: every recorded member's first insignificant lag was <= 4 at 6 h, rho_6h <~ 0.7). At
    rho >= 0.9 it is still 10-26%: a window that holds about one independent hour cannot be judged by any test. An
    effective-sample guard was tried and REJECTED (it moved the rate < 5 points: EWC with few cosines cannot see the
    slow drift that causes the false kills). The two-strike rule is the remaining protection there.
  * FIXED-SMOOTHING DM DECIDES: the equal-weighted cosine (EWC) long-run variance with nu = floor(0.4 T^(2/3)) cosine
    terms and Student-t(nu) critical values (Lazarus, Lewis, Stock & Watson 2018, JBES; applied to DM by Coroneo &
    Iacone 2020, JAE, which shows correct size with few out-of-sample points). p_worse tests the margin-shifted null
    "ON is not worse by more than the margin"; Holm across the family as before.
  * AND THE BOOTSTRAP CI MUST AGREE: a CIRCULAR block bootstrap with the Politis & White (2004) block, Patton, Politis
    & White (2009) correction (a pure-Python port of `arch.bootstrap.optimal_block_length`, matched to arch 8.0.0 to
    1e-14 in tests); the 95% CI's upper end must sit below -margin. The NW-HAC DM is still computed and reported
    (secondary), with its lag raised to at least the block.
  * MSE BESIDE MAE: each member also reports the squared-loss differential (mean and bootstrap CI, descriptive; Patton
    2011: rankings under an imperfect proxy depend on the loss). CRPS of a POINT forecast is its absolute error, so
    CRPS equals MAE here until the chain emits an ensemble; it is reported under that name for the record.
  * THE FALSE-WORSE RATE on an AR(1) null is measured by `scripts/guardrail_null_rate.py` and pinned in tests.
"""
import math
import os
import random
from typing import Callable, Dict, List, Optional, Sequence

from services.weather_pipeline import gate_v2_stats as st

ALPHA = 0.05
MARGIN_ABS_M = 0.005
MARGIN_REL = 0.01
MIN_HOURS = 20
MIN_PAIRS = 60
REPS = 2000
SEED = 20261104
STATS_V2_DEFAULT = "1"


def stats_v2() -> bool:
    """Bootstrap-primary verdict with the Politis-White block (default ON); GUARDRAIL_STATS_V2=0 is the pre-2026-11-11
    rule."""
    return os.environ.get("GUARDRAIL_STATS_V2", STATS_V2_DEFAULT) != "0"


def optimal_block(x: Sequence[float]) -> Optional[float]:
    """Politis & White (2004) optimal CIRCULAR-block-bootstrap length with the Patton-Politis-White (2009) correction.
    A line-for-line port of `arch.bootstrap.base._single_optimal_block` (arch 8.0.0): flat-top lag window, m-hat from
    the first run of K_N insignificant autocorrelations (band 2 sqrt(log10 n / n)), capped at min(3 sqrt n, n / 3).
    None for a series too short or flat to estimate."""
    n = len(x)
    if n < 8:
        return None
    mu = sum(x) / n
    e = [v - mu for v in x]
    b_max = math.ceil(min(3 * math.sqrt(n), n / 3))
    kn = max(5, int(math.log10(n)))
    m_max = int(math.ceil(math.sqrt(n))) + kn
    cv = 2 * math.sqrt(math.log10(n) / n)
    acv, abs_acorr, opt_m = [0.0] * (m_max + 1), [0.0] * (m_max + 1), None
    for i in range(min(m_max, n - 2) + 1):
        v1 = sum(v * v for v in e[i + 1:])
        v2 = sum(v * v for v in e[:n - (i + 1)])
        cross = sum(e[i + j] * e[j] for j in range(n - i))
        acv[i] = cross / n
        abs_acorr[i] = abs(cross) / math.sqrt(v1 * v2) if v1 > 0 and v2 > 0 else 0.0
        if i >= kn and opt_m is None and all(a < cv for a in abs_acorr[i - kn:i]):
            opt_m = i - kn
    if acv[0] <= 0:
        return None
    m = min(2 * max(opt_m, 1) if opt_m is not None else m_max, m_max)
    g, lr = 0.0, acv[0]
    for k in range(1, min(m, len(acv) - 1) + 1):
        lam = 1.0 if k / m <= 0.5 else 2.0 * (1.0 - k / m)
        g += 2 * lam * k * acv[k]
        lr += 2 * lam * acv[k]
    if lr == 0:
        return None
    b_cb = ((2 * g * g) / (4.0 / 3.0 * lr * lr)) ** (1.0 / 3.0) * n ** (1.0 / 3.0)
    return min(b_cb, b_max)


def _betacf(a: float, b: float, x: float) -> float:
    """Continued fraction for the regularized incomplete beta (modified Lentz)."""
    qab, qap, qam = a + b, a + 1.0, a - 1.0
    c, d = 1.0, 1.0 - qab * x / qap
    d = 1.0 / (d if abs(d) > 1e-300 else 1e-300)
    h = d
    for m in range(1, 300):
        m2 = 2 * m
        aa = m * (b - m) * x / ((qam + m2) * (a + m2))
        d = 1.0 + aa * d
        d = 1.0 / (d if abs(d) > 1e-300 else 1e-300)
        c = 1.0 + aa / c if abs(1.0 + aa / c) > 1e-300 else 1e-300
        h *= d * c
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
        d = 1.0 + aa * d
        d = 1.0 / (d if abs(d) > 1e-300 else 1e-300)
        c = 1.0 + aa / c if abs(1.0 + aa / c) > 1e-300 else 1e-300
        dl = d * c
        h *= dl
        if abs(dl - 1.0) < 1e-14:
            break
    return h


def _betainc(a: float, b: float, x: float) -> float:
    if x <= 0.0:
        return 0.0
    if x >= 1.0:
        return 1.0
    lbt = math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b) + a * math.log(x) + b * math.log(1.0 - x)
    if x < (a + 1.0) / (a + b + 2.0):
        return math.exp(lbt) * _betacf(a, b, x) / a
    return 1.0 - math.exp(lbt) * _betacf(b, a, 1.0 - x) / b


def t_cdf(t: float, nu: float) -> float:
    """Student-t CDF (pure Python; the backend carries no scipy)."""
    x = nu / (nu + t * t)
    tail = 0.5 * _betainc(nu / 2.0, 0.5, x)
    return 1.0 - tail if t > 0 else tail


def ewc_nu(n: int) -> int:
    """LLSW (2018) rule: nu = 0.4 T^(2/3) cosine terms, at least 1."""
    return max(1, int(math.floor(0.4 * n ** (2.0 / 3.0))))


def ewc_test(d: Sequence[float], shift: float = 0.0) -> Optional[dict]:
    """Fixed-smoothing DM on the loss differential d (+ shift): EWC long-run variance from nu type-II cosine
    projections, statistic sqrt(T) mean / sqrt(lrv) ~ t(nu). Returns {stat, nu, p_better, p_worse} (one-sided)."""
    n = len(d)
    if n < 8:
        return None
    x = [v + shift for v in d]
    mu = sum(x) / n
    nu = ewc_nu(n)
    lrv = 0.0
    for j in range(1, nu + 1):
        lam = math.sqrt(2.0 / n) * sum(math.cos(math.pi * j * (t + 0.5) / n) * (x[t] - mu) for t in range(n))
        lrv += lam * lam
    lrv /= nu
    if lrv <= 0:
        return None
    stat = math.sqrt(n) * mu / math.sqrt(lrv)
    c = t_cdf(stat, nu)
    return {"stat": stat, "nu": nu, "lrv": lrv, "p_better": 1.0 - c, "p_worse": c}


def circular_bootstrap(x: Sequence[float], block: int, reps: int = REPS, seed: int = SEED) -> List[float]:
    """Sorted resampled means of x under a circular block bootstrap (fixed blocks that wrap, so no hour is
    under-sampled at the ends; the length `optimal_block` is derived for)."""
    n = len(x)
    block = max(1, min(int(block), n))
    rng = random.Random(seed)
    xx = list(x) + list(x[:block])
    out = []
    for _ in range(reps):
        tot, got = 0.0, 0
        while got < n:
            s = rng.randrange(n)
            take = min(block, n - got)
            tot += sum(xx[s:s + take])
            got += take
        out.append(tot / n)
    out.sort()
    return out


def _ci(vals: List[float], level: float = 0.95) -> List[float]:
    a, r = (1.0 - level) / 2.0, len(vals)
    return [vals[max(0, int(math.floor(a * r)))], vals[min(r - 1, int(math.ceil((1.0 - a) * r)) - 1)]]


WORSE, BETTER, NOT_WORSE, NO_CHANGE, UNTESTABLE = "WORSE", "BETTER", "NOT_WORSE", "NO_CHANGE", "UNTESTABLE"

_NORTH = {12: "DJF", 1: "DJF", 2: "DJF", 3: "MAM", 4: "MAM", 5: "MAM", 6: "JJA", 7: "JJA", 8: "JJA",
          9: "SON", 10: "SON", 11: "SON"}
_SWAP = {"DJF": "JJA", "JJA": "DJF", "MAM": "SON", "SON": "MAM"}


def season_of(t, lat: Optional[float] = None) -> str:
    s = _NORTH[t.month]
    return _SWAP[s] if (lat is not None and lat < 0) else s


def region_of(station: dict) -> str:
    if station.get("region"):
        return str(station["region"])
    lat, lng = float(station["lat"]), float(station["lng"])
    band = int(math.floor(lat / 3.0)) * 3
    return f"lat {band}..{band + 3} {'W' if lng < 0 else 'E'}"


def _mae(items, field):
    return st.mean([abs(i[field] - i["obs"]) for i in items]) if items else None


def two_way(items: Sequence[dict], reps: int = REPS, seed: int = SEED) -> dict:
    """One member's two-way test. Returns {n, T, testable, no_change, mean_gain, ci, p_worse, p_better,
    off_mae, on_mae, margin, block, hac_lag}; mean_gain > 0 = ON better."""
    items = [i for i in items if all(isinstance(i.get(k), (int, float)) and math.isfinite(i[k])
                                     for k in ("obs", "f_ref", "f_cand"))]
    out = {"n": len(items), "T": len({i["t"] for i in items}), "testable": False,
           "no_change": bool(items) and all(abs(i["f_ref"] - i["f_cand"]) < 1e-12 for i in items),
           "off_mae": _mae(items, "f_ref"), "on_mae": _mae(items, "f_cand")}
    out["margin"] = max(MARGIN_ABS_M, MARGIN_REL * (out["off_mae"] or 0.0))
    if out["n"] < MIN_PAIRS or out["T"] < MIN_HOURS or out["no_change"]:
        return out
    d = st.differential_series(items, "abs")
    dep = st.dependence(d)
    mg = out["margin"]
    # The nulls carry the margin (Reflection review 2026-11-04): p_worse tests H0 "mean d >= -margin" (ON is not
    # materially worse), p_better tests H0 "mean d <= +margin"; the DM statistic is shift-equivariant, so shifting the
    # series is that test exactly. The CI stays on d itself.
    if stats_v2():
        return _two_way_v2(items, d, dep, out, reps, seed)
    dm_w = st.diebold_mariano([x + mg for x in d], dep["hac_lag"])
    dm_b = st.diebold_mariano([x - mg for x in d], dep["hac_lag"])
    boot = st.block_bootstrap(d, dep["block"], reps=reps, seed=seed)
    if dm_w is None or dm_b is None or boot is None:
        return out
    out.update({"testable": True, "mean_gain": st.mean(d), "ci": [boot["lo"], boot["hi"]],
                "p_worse": dm_w["p_worse"], "p_better": dm_b["p_better"], "block": dep["block"],
                "hac_lag": dep["hac_lag"]})
    return out


def _two_way_v2(items, d, dep, out, reps, seed) -> dict:
    """The V2 member test: circular-block bootstrap (Politis-White block) decides; DM is secondary; MSE reported."""
    mg = out["margin"]
    b = optimal_block(d)
    block = max(1, int(math.ceil(b))) if b is not None else dep["block"]
    hac = min(max(dep["hac_lag"], block), max(0, len(d) - 2))
    vals = circular_bootstrap(d, block, reps, seed)
    ew_w, ew_b = ewc_test(d, +mg), ewc_test(d, -mg)               # H0 mean d >= -margin / H0 mean d <= +margin
    if ew_w is None or ew_b is None:
        return out
    p_w, p_b = ew_w["p_worse"], ew_b["p_better"]
    dm_w = st.diebold_mariano([x + mg for x in d], hac)
    dm_b = st.diebold_mariano([x - mg for x in d], hac)
    sq = st.differential_series(items, "sq")
    sq_vals = circular_bootstrap(sq, block, reps, seed + 1)
    out.update({"testable": True, "mean_gain": st.mean(d), "ci": _ci(vals), "p_worse": p_w, "p_better": p_b,
                "test": "fixed-smoothing DM (EWC, t(nu)) AND circular block bootstrap CI; NW-HAC DM secondary",
                "ewc_nu": ew_w["nu"], "block": block,
                "block_rule": "Politis-White 2004 / Patton-Politis-White 2009 (circular)", "hac_lag": hac,
                "dm_p_worse": dm_w["p_worse"] if dm_w else None, "dm_p_better": dm_b["p_better"] if dm_b else None,
                "mse": {"off": st.mean([(i["f_ref"] - i["obs"]) ** 2 for i in items]),
                        "on": st.mean([(i["f_cand"] - i["obs"]) ** 2 for i in items]),
                        "mean_gain": st.mean(sq), "ci": _ci(sq_vals)},
                "crps": {"off": out["off_mae"], "on": out["on_mae"],
                         "note": "point forecast: CRPS equals absolute error"}})
    return out


def family(items: Sequence[dict], stations: Dict[str, dict]) -> Dict[str, List[dict]]:
    """{member name: items}: pooled, by season, by region."""
    fam: Dict[str, List[dict]] = {"pooled": list(items)}
    for i in items:
        fam.setdefault(f"lead +{i['lead']} h", []).append(i)
        s = stations.get(i["buoy"]) or {}
        fam.setdefault(f"season {season_of(i['t'], s.get('lat'))}", []).append(i)
        if s:
            fam.setdefault(f"region {region_of(s)}", []).append(i)
    return fam


def verdict(items: Sequence[dict], stations: Dict[str, dict], alpha: float = ALPHA,
            test: Callable[[Sequence[dict]], dict] = two_way) -> dict:
    """The filter/guardrail verdict for one flag on one window: {verdict, reasons, members}."""
    members = {name: test(its) for name, its in family(items, stations).items()}
    names = [n for n, m in members.items() if m["testable"]]
    if not names:
        pooled = members["pooled"]
        v = NO_CHANGE if pooled.get("no_change") else UNTESTABLE
        why = ("ON equals OFF at every pair in this window (the flag is inert here)" if v == NO_CHANGE else
               f"no member is testable (pooled n {pooled['n']}, {pooled['T']} hours; needs "
               f">= {MIN_PAIRS} pairs and >= {MIN_HOURS} hours)")
        return {"verdict": v, "reasons": [why], "members": members}
    adj_w = st.holm([members[n]["p_worse"] for n in names])
    adj_b = st.holm([members[n]["p_better"] for n in names])
    worse, better = [], []
    for n, pw, pb in zip(names, adj_w, adj_b):
        m = members[n]
        m["p_worse_holm"], m["p_better_holm"] = pw, pb
        m["worse"] = pw < alpha and m["ci"][1] < -m["margin"]
        m["better"] = pb < alpha and m["ci"][0] > m["margin"]
        if m["worse"]:
            worse.append(f"{n}: ON is worse by {-m['mean_gain']:.4f} m MAE (CI of the loss "
                         f"[{-m['ci'][1]:.4f}, {-m['ci'][0]:.4f}], margin {m['margin']:.4f}; p_worse Holm {pw:.3g} "
                         f"across {len(names)} members; n {m['n']}, {m['T']} hours)")
        elif m["better"]:
            better.append(n)
    if worse:
        return {"verdict": WORSE, "reasons": worse, "members": members}
    if members["pooled"].get("better"):
        return {"verdict": BETTER, "reasons": [f"pooled better, no member worse ({', '.join(better)})"],
                "members": members}
    return {"verdict": NOT_WORSE, "reasons": [f"no member significantly worse after Holm across {len(names)}"],
            "members": members}


# ---- sanity bounds (both tools; a breach is a kill on its own, statistics or not) ---------------------------------
SURF_H_MAX_M = 30.5          # ~100 ft: beyond the depth-limited ceiling the pipeline sweep measures (29.5 ft = 9 m)
SCORE_RANGE = (0.0, 100.0)
MONO_TOL_M = 0.01            # a bigger swell may not give a smaller surf by more than 1 cm (the MC-01 cap-seam rule)


def sanity_rows(rows_on: Sequence[dict], rows_off: Optional[Sequence[dict]] = None) -> List[str]:
    """Range breaches in the ON arm's replayed outputs that the OFF arm does not already have. Rows carry
    outputs.surf_height_m and outputs.score (eval_replay rows)."""
    def bad(r):
        o = r.get("outputs") or {}
        h, s = o.get("surf_height_m"), o.get("score")
        out = []
        if h is not None and (not math.isfinite(h) or h < 0 or h > SURF_H_MAX_M):
            out.append(f"surf_height_m {h}")
        if s is not None and (not math.isfinite(s) or not SCORE_RANGE[0] <= s <= SCORE_RANGE[1]):
            out.append(f"score {s}")
        return out
    off_bad = {(r.get("spot"), r.get("valid"), r.get("lead_h")) for r in (rows_off or []) if bad(r)}
    msgs = []
    for r in rows_on:
        b = bad(r)
        if b and (r.get("spot"), r.get("valid"), r.get("lead_h")) not in off_bad:
            msgs.append(f"{r.get('spot')} {r.get('valid')} +{r.get('lead_h')} h: {', '.join(b)}")
    return msgs


def monotone_breaches(sweep: Sequence[tuple], tol: float = MONO_TOL_M) -> List[str]:
    """[(swell_hs_m, surf_h_m)] sorted by swell; a breach is a drop larger than tol between neighbours."""
    pts = sorted((a, b) for a, b in sweep if b is not None)
    return [f"swell {a0:.2f} -> {a1:.2f} m: surf {b0:.3f} -> {b1:.3f} m" for (a0, b0), (a1, b1) in zip(pts, pts[1:])
            if b1 < b0 - tol]


def volume_breaches(daily_counts: Dict[str, int], cap: int) -> List[str]:
    """{recipient-day: count} over the cap (alerts and anything else that sends to users)."""
    return [f"{k}: {v} > cap {cap}" for k, v in sorted(daily_counts.items()) if v > cap]
