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
"""
import math
from typing import Callable, Dict, List, Optional, Sequence

from services.weather_pipeline import gate_v2_stats as st

ALPHA = 0.05
MARGIN_ABS_M = 0.005
MARGIN_REL = 0.01
MIN_HOURS = 20
MIN_PAIRS = 60
REPS = 2000
SEED = 20261104

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
    dm_w = st.diebold_mariano([x + mg for x in d], dep["hac_lag"])
    dm_b = st.diebold_mariano([x - mg for x in d], dep["hac_lag"])
    boot = st.block_bootstrap(d, dep["block"], reps=reps, seed=seed)
    if dm_w is None or dm_b is None or boot is None:
        return out
    out.update({"testable": True, "mean_gain": st.mean(d), "ci": [boot["lo"], boot["hi"]],
                "p_worse": dm_w["p_worse"], "p_better": dm_b["p_better"], "block": dep["block"],
                "hac_lag": dep["hac_lag"]})
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
