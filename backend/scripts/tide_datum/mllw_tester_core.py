"""tide-mllw-tester-v1 (gates/tide-mllw-tester-v1.md, as amended in sections 10-12): the PURE core of the datum-only
tester for SURF_TIDE_MLLW_US. No I/O here: the runner (mllw_tester_run.py) reads the table and NOAA and calls these.

Per monitor and window (section 4 + s10): e(t) = [displayed(t) - LP_ours(t)] - [NOAA_MLLW(t) - LP_noaa(t)] - m, where
displayed is the served `am` level plus the leave-one-out D, m the block's mean_level_included_m. s = the signed MEAN of
e over the window's hours (MEASURED if >= 90 % of them have both sides). Per stratum F = the MEDIAN of s.

Verdict per build (s5, precedence UNTESTABLE > BREACH > FLEET BREACH > WORSE > NOT_WORSE):
  UNTESTABLE   a stratum with n < 15 MEASURED monitors in W (or the runner's own reasons: stale table, NOAA unreachable,
               the LP-convention self-check failed)
  BREACH (b1)  over W, |s| > 0.05 m at >= min(3, ceil(0.1 n_fleet)) monitors, n_fleet = MEASURED monitors (both strata)
         (b2)  a non-finite displayed value or offset at a monitor key
         (b3)  mean_level_included_m non-finite or |m| > 0.30 m at a monitor key
  FLEET BREACH |F| > 0.03 m over W in some stratum on two consecutive tested builds
  WORSE        |F| > 0.02 m in BOTH W1 and W2 in some stratum
Breaches go in `sanity` (flag_guardrail.decide disables at once on any); WORSE strikes (two builds >= 24 h apart).
"""
from __future__ import annotations

import math
import statistics as st

BAR_F, B1_S, B3_M, FLEET_F = 0.02, 0.05, 0.30, 0.03
MIN_N, MEAS_FRAC = 15, 0.90
SHEET_MAX_PROPOSAL = 0.01          # (p4): <= 1 % of served US keys resolve D through a sheet for a proposal
SHEET_REPORT, SHEET_REPORT_BUILDS = 0.05, 2
UNTESTABLE, WORSE, NOT_WORSE = "UNTESTABLE", "WORSE", "NOT_WORSE"
STRATA = ("HARBOR_BAY", "OPEN_COAST")


def _num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def e_series(displayed, noaa, lp_ours, lp_noaa, m):
    """PURE: [e or None] hour by hour; None wherever any side is missing or non-finite."""
    out = []
    for d, n, lo, ln in zip(displayed, noaa, lp_ours, lp_noaa):
        out.append((d - lo) - (n - ln) - m if all(_num(x) for x in (d, n, lo, ln, m)) else None)
    return out


def window_stat(e, n_hours=None):
    """PURE: {measured, s, n} for one monitor and window. `n_hours` is the window's length (default len(e))."""
    vals = [x for x in e if _num(x)]
    total = n_hours if n_hours is not None else len(e)
    measured = total > 0 and len(vals) >= MEAS_FRAC * total
    return {"measured": measured, "s": round(sum(vals) / len(vals), 9) if vals else None, "n": len(vals)}


def b1_threshold(n_fleet):
    """PURE, s10 item 3: the (b1) count, min(3, ceil(0.1 n_fleet)); 3 at n_fleet >= 21, 2 at 11..20."""
    return min(3, math.ceil(0.10 * n_fleet))


def stratum_f(per, ids, win):
    """PURE: (F, n) for one stratum and window over MEASURED monitors (source drift counts as NOT MEASURED)."""
    ss = [per[i][win]["s"] for i in ids if i in per and not per[i].get("drift") and per[i][win]["measured"]]
    return (st.median(ss) if ss else None), len(ss)


def judge(per, strata, prev_fleet_over=None, reasons=None):
    """PURE: the build verdict. per[sid] = {"W1","W2","W": window_stat, "drift": bool, "nonfinite": bool, "m": float}.
    strata = {name: [monitor ids]}. prev_fleet_over = {stratum: bool} from the previous TESTED build.
    Returns {verdict, sanity, F, n, fleet_over, exceed, reasons}."""
    reasons = list(reasons or [])
    F = {k: {w: stratum_f(per, ids, w) for w in ("W1", "W2", "W")} for k, ids in strata.items()}
    n = {k: F[k]["W"][1] for k in strata}
    out = {"F": {k: {w: F[k][w][0] for w in F[k]} for k in F}, "n": n, "sanity": [], "fleet_over": {}, "exceed": []}
    thin = [k for k in strata if n[k] < MIN_N]
    if thin:
        return dict(out, verdict=UNTESTABLE, reasons=reasons + [f"n < {MIN_N} MEASURED in {', '.join(thin)}"])
    ids_all = [i for ids in strata.values() for i in ids if i in per]
    meas = [i for i in ids_all if not per[i].get("drift") and per[i]["W"]["measured"]]
    exceed = sorted(i for i in meas if abs(per[i]["W"]["s"]) > B1_S)
    out["exceed"] = exceed
    if len(exceed) >= b1_threshold(len(meas)):
        out["sanity"].append(f"b1: |s| > {B1_S} m at {len(exceed)} of {len(meas)} monitors "
                             f"(threshold {b1_threshold(len(meas))}): {', '.join(exceed)}")
    bad2 = sorted(i for i in ids_all if per[i].get("nonfinite"))
    if bad2:
        out["sanity"].append(f"b2: non-finite displayed value or offset at {', '.join(bad2)}")
    bad3 = sorted(i for i in ids_all if not _num(per[i].get("m")) or abs(per[i]["m"]) > B3_M)
    if bad3:
        out["sanity"].append(f"b3: mean_level_included_m non-finite or |m| > {B3_M} m at {', '.join(bad3)}")
    for k in strata:
        fw = out["F"][k]["W"]
        out["fleet_over"][k] = fw is not None and abs(fw) > FLEET_F
        if out["fleet_over"][k] and (prev_fleet_over or {}).get(k):
            out["sanity"].append(f"FLEET BREACH: |F| > {FLEET_F} m over W in {k} on two consecutive tested builds "
                                 f"(F = {fw:+.4f} m)")
    worse = [k for k in strata if all(out["F"][k][w] is not None and abs(out["F"][k][w]) > BAR_F for w in ("W1", "W2"))]
    if worse:
        reasons.append("WORSE: |F| > %.2f m in both halves in %s" % (BAR_F, ", ".join(
            f"{k} (W1 {out['F'][k]['W1']:+.4f}, W2 {out['F'][k]['W2']:+.4f})" for k in worse)))
    return dict(out, verdict=WORSE if worse else NOT_WORSE, reasons=reasons)


def pool29(builds):
    """PURE: {sid: e list} pooled over builds (oldest first): each target hour is taken from the most recent build
    that serves it (s4's 29-day view). builds = [{"stamp": str, "e": {sid: {hour_iso: e}}}]."""
    latest = {}
    for b in builds:                                       # later builds overwrite earlier ones
        for sid, hours in (b.get("e") or {}).items():
            latest.setdefault(sid, {}).update(hours)
    return {sid: [v for _, v in sorted(h.items())] for sid, h in latest.items()}


def proposal(history, view_per, strata, sheet_shares, days=14):
    """PURE, s5 (p1)-(p4): (ok, reasons). history = the last `days` daily records [{"tested", "verdict", "sanity"}];
    view_per = {sid: {"W": window_stat, "drift": bool}} for the 29-day view; sheet_shares = the builds' SHEET shares."""
    why = []
    recent = history[-days:]
    tested = [h for h in recent if h.get("tested")]
    if len(recent) < days or len(tested) < days - 2:
        why.append(f"(p1) {len(tested)} of the last {len(recent)} daily builds tested (needs >= {days - 2} of {days})")
    bad = [h for h in tested if h.get("verdict") != NOT_WORSE or h.get("sanity")]
    if bad:
        why.append(f"(p2) {len(bad)} tested build(s) not NOT_WORSE or with a breach")
    for k, ids in strata.items():
        f, n = stratum_f(view_per, ids, "W")
        if n < MIN_N:
            why.append(f"(p3) {k} is thin in the 29-day view (n = {n} < {MIN_N})")
        elif abs(f) > BAR_F:
            why.append(f"(p3) {k} 29-day |F| = {abs(f):.4f} m > {BAR_F} m")
    meas = [i for ids in strata.values() for i in ids if i in view_per and not view_per[i].get("drift")
            and view_per[i]["W"]["measured"]]
    exceed = [i for i in meas if abs(view_per[i]["W"]["s"]) > B1_S]
    if meas and len(exceed) >= b1_threshold(len(meas)):
        why.append(f"(p3) a (b1) condition in the 29-day view ({len(exceed)} monitors over {B1_S} m)")
    over = [s for s in sheet_shares[-days:] if s is None or s > SHEET_MAX_PROPOSAL]
    if over or len(sheet_shares[-days:]) < days - 2:
        why.append(f"(p4) the SHEET share exceeded {SHEET_MAX_PROPOSAL:.0%} (or was unknown) on {len(over)} build(s)")
    return (not why), why


def sheet_report(shares):
    """PURE: True when the SHEET share is above 5 % on SHEET_REPORT_BUILDS consecutive builds (an owner report, never
    a disable; s11)."""
    tail = shares[-SHEET_REPORT_BUILDS:]
    return len(tail) == SHEET_REPORT_BUILDS and all(s is not None and s > SHEET_REPORT for s in tail)
