"""EURO scalar-height shadow read: is raw_surf:EURO_SCALAR at least as accurate as raw_surf:EURO (the D-073 gate)?

Pre-registered in docs/weather-program/log/2026-11-15-claude-verifier-euro-scalar-read.md (section 1, commit 5098df3c8,
written before any row was read). MEASUREMENT ONLY, AGGREGATES ONLY: it prints per-lead and per-region-x-lead n, MAE,
bias, the paired MAE difference and its day-block interval, and the controls. No row, observation series or credential
reaches stdout. It reads the scored ledger segments from private Storage (the monitor's read pair) and never calls the
serve box; it runs only in the dispatch-only workflow euro-scalar-shadow-read.yml.

    python scripts/euro_scalar_shadow_read.py [--since 2026-11-02]
"""
import argparse
import os
import random
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scripts.accuracy_per_buoy_split import _finite, _parse, _bucket, paired  # noqa: E402
from services.weather_pipeline.skill_consensus import region_of  # noqa: E402

VECTOR = "raw_surf:EURO"
SCALAR = "raw_surf:EURO_SCALAR"
LEADS = (24, 48, 72)
SINCE = "2026-11-02"
DRAWS = 2000
SEED = 20261115
PLANT_M = 0.05
REGION_MIN_PAIRS, REGION_MIN_DAYS = 100, 7
POOLED_MIN_PAIRS, POOLED_MIN_BUOYS = 300, 10
ALPHA = 0.05
BIAS_FLAG_M = 0.10


def index_rows(rows, since, now):
    """{source: {(BUOY, target_time, bucket): row}} for the two lanes, finite err_m, target in [since, now + 1 d]."""
    out = {VECTOR: {}, SCALAR: {}}
    for r in rows or []:
        src = r.get("source")
        if src not in out or not _finite(r.get("err_m")):
            continue
        t = _parse(r.get("target_time"))
        if t is None or not (since <= t <= now + timedelta(days=1)):
            continue
        out[src][(str(r.get("buoy_id")).upper(), r.get("target_time"), _bucket(r.get("lead_h")))] = r
    return out


def stats(keys, v, s, swap=None, plant=0.0):
    """(n, mae_v, mae_s, bias_v, bias_s, dmae, s_closer). swap: set of keys whose lanes trade places (the null)."""
    if not keys:
        return 0, None, None, None, None, None, None
    ev, es = [], []
    for k in keys:
        a, b = v[k]["err_m"], s[k]["err_m"]
        if swap and k in swap:
            a, b = b, a
        ev.append(a)
        es.append(b)
    n = len(keys)
    mv = sum(abs(x) for x in ev) / n
    ms = sum(abs(x) + plant for x in es) / n
    closer = sum(1 for a, b in zip(ev, es) if abs(b) + plant < abs(a)) / n
    return n, mv, ms, sum(ev) / n, sum(es) / n, ms - mv, closer


def interval(keys, v, s, block_days, swap=None, plant=0.0, draws=DRAWS, seed=SEED):
    """(lo, hi, p_le0): 95% day-block bootstrap of dMAE and the share of draws with dMAE <= 0. None if < 3 blocks."""
    if not keys:
        return None
    first = min(k[1][:10] for k in keys)
    blocks = {}
    for k in keys:
        off = (datetime.fromisoformat(k[1][:10]) - datetime.fromisoformat(first)).days
        blocks.setdefault(off // block_days, []).append(k)
    ids = sorted(blocks)
    if len(ids) < 3:
        return None
    rng = random.Random(seed)
    out = []
    for _ in range(draws):
        sample = [k for _i in ids for k in blocks[ids[rng.randrange(len(ids))]]]
        out.append(stats(sample, v, s, swap, plant)[5])
    out.sort()
    return out[int(0.025 * draws)], out[min(draws - 1, int(0.975 * draws))], sum(1 for x in out if x <= 0) / draws


def holm(pvals, alpha=ALPHA):
    """{name: rejected} for one-sided p-values, Holm step-down."""
    order = sorted(pvals, key=lambda kv: kv[1])
    m, out, stop = len(order), {}, False
    for i, (name, p) in enumerate(order):
        rej = (not stop) and p <= alpha / (m - i)
        stop = stop or not rej
        out[name] = rej
    return out


def read(idx, seed=SEED):
    """Everything the pre-registration asks for, as a dict of aggregates (no row content)."""
    v, s = idx[VECTOR], idx[SCALAR]
    rng = random.Random(seed)
    res = {"pooled": {}, "regions": {}, "controls": {}, "coverage": {}}
    for lead in LEADS:
        b = lead // 24
        vv = {k: r for k, r in v.items() if k[2] == b}
        ss = {k: r for k, r in s.items() if k[2] == b}
        keys, mismatch, missing = paired(vv, ss)
        keys.sort()
        swap = {k for k in keys if rng.random() < 0.5}
        res["coverage"][lead] = {"pairs": len(keys), "buoys": len({k[0] for k in keys}), "obs_mismatch": mismatch,
                                 "obs_missing": missing, "days": len({k[1][:10] for k in keys})}
        res["pooled"][lead] = {"stats": stats(keys, vv, ss), "i1": interval(keys, vv, ss, 1),
                               "i3": interval(keys, vv, ss, 3)}
        res["controls"][lead] = {
            "c0_identity": stats(keys, vv, vv)[5],
            "c1_null_i3": interval(keys, vv, ss, 3, swap=swap),
            "c2_plant_i3": interval(keys, vv, ss, 3, plant=PLANT_M),
        }
        by_region = {}
        for k in keys:
            by_region.setdefault(region_of(k[0]), []).append(k)
        for reg, rk in sorted(by_region.items()):
            days = len({k[1][:10] for k in rk})
            testable = len(rk) >= REGION_MIN_PAIRS and days >= REGION_MIN_DAYS
            res["regions"][(reg, lead)] = {"stats": stats(rk, vv, ss), "days": days, "testable": testable,
                                           "i3": interval(rk, vv, ss, 3) if testable else None}
    return res


def verdict(res):
    """(valid, reasons, verdict, holm_rejected) by the pre-registered rule."""
    reasons = []
    for lead in LEADS:
        c, cov = res["controls"][lead], res["coverage"][lead]
        if c["c0_identity"] not in (0, 0.0):
            reasons.append("C0 fails at +%dh" % lead)
        n1 = c["c1_null_i3"]
        if n1 is None or not (n1[0] <= 0 <= n1[1]):
            reasons.append("C1 fails at +%dh" % lead)
        p = c["c2_plant_i3"]
        if p is None or not (p[0] > 0):
            reasons.append("C2 fails at +%dh" % lead)
        if cov["pairs"] < POOLED_MIN_PAIRS or cov["buoys"] < POOLED_MIN_BUOYS:
            reasons.append("coverage short at +%dh (%d pairs, %d buoys)" % (lead, cov["pairs"], cov["buoys"]))
    if reasons:
        return False, reasons, "VOID", {}
    pooled_worse = [lead for lead in LEADS if res["pooled"][lead]["i3"] and res["pooled"][lead]["i3"][0] > 0]
    # one-sided p for "the scalar is worse" (dMAE > 0): the share of bootstrap draws with dMAE <= 0
    rej = holm([(f"{reg} +{lead}h", c["i3"][2]) for (reg, lead), c in res["regions"].items()
                if c["testable"] and c["i3"]])
    worse_regions = [name for name, r in rej.items() if r]
    if pooled_worse or worse_regions:
        return True, ["pooled worse at %s" % pooled_worse if pooled_worse else "",
                      "regions worse after Holm: %s" % worse_regions if worse_regions else ""], "AGAINST", rej
    return True, [], "SUPPORTS", rej


def _f(x, w=7):
    return ("%+.3f" % x).rjust(w) if isinstance(x, float) else str(x).rjust(w)


def _i(t):
    return "n/a" if not t else "[%+.3f, %+.3f]" % (t[0], t[1])


def lines(res):
    valid, reasons, call, rej = verdict(res)
    out = ["== EURO scalar shadow read (pre-registered; aggregates only). dMAE = MAE(scalar) - MAE(vector), m",
           "-- coverage"]
    for lead in LEADS:
        c = res["coverage"][lead]
        out.append("  +%dh pairs=%d buoys=%d days=%d obs_mismatch=%d obs_missing=%d"
                   % (lead, c["pairs"], c["buoys"], c["days"], c["obs_mismatch"], c["obs_missing"]))
    out.append("-- controls (3-day blocks)")
    for lead in LEADS:
        c = res["controls"][lead]
        out.append("  +%dh C0 identity dMAE=%s  C1 null %s  C2 plant +%.2f m %s"
                   % (lead, c["c0_identity"], _i(c["c1_null_i3"]), PLANT_M, _i(c["c2_plant_i3"])))
    out.append("-- pooled: n | MAE vec / scal | bias vec / scal | dMAE [1-day] [3-day] | scalar closer")
    for lead in LEADS:
        n, mv, ms, bv, bs, d, cl = res["pooled"][lead]["stats"]
        if not n:
            out.append("  +%dh no pairs" % lead)
            continue
        out.append("  +%dh %5d | %.3f / %.3f | %+.3f / %+.3f | %s %s %s | %.1f%%"
                   % (lead, n, mv, ms, bv, bs, _f(d), _i(res["pooled"][lead]["i1"]), _i(res["pooled"][lead]["i3"]),
                      100 * cl))
    out.append("-- region x lead (testable: >= %d pairs on >= %d days)" % (REGION_MIN_PAIRS, REGION_MIN_DAYS))
    for (reg, lead), c in sorted(res["regions"].items()):
        n, mv, ms, bv, bs, d, cl = c["stats"]
        tag = ("Holm-worse " if rej.get(f"{reg} +{lead}h") else "") + ("" if c["testable"] else "UNTESTABLE ")
        out.append("  %-12s +%dh %5d %2dd | %.3f / %.3f | %+.3f / %+.3f | %s %s %s"
                   % (reg, lead, n, c["days"], mv, ms, bv, bs, _f(d), _i(c["i3"]), tag.strip()))
    bias_flag = [lead for lead in LEADS if (res["pooled"][lead]["stats"][4] or 0) > BIAS_FLAG_M]
    out.append("== VERDICT: %s%s" % (call, ("" if valid else " (" + "; ".join(reasons) + ")")))
    if valid and call == "AGAINST":
        out.append("   " + "; ".join(r for r in reasons if r))
    if bias_flag:
        out.append("   bias flag: scalar pooled bias > +%.2f m at %s (watch after a flip)" % (BIAS_FLAG_M, bias_flag))
    better = [lead for lead in LEADS if res["pooled"][lead]["i3"] and res["pooled"][lead]["i3"][1] < 0]
    out.append("   better (3-day upper < 0) at %s; reported, not required" % better)
    return out, valid, call


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--since", default=SINCE)
    args = ap.parse_args()
    from scripts.forecast_accuracy_monitor import _fetch_scored_month
    from services import buoy_holdout      # the LOCKED final buoy holdout (#1199)
    now = datetime.now(timezone.utc)
    since = datetime.fromisoformat(args.since).replace(tzinfo=timezone.utc)
    through = (now + timedelta(days=1)).date()
    months, d = [], since
    while d <= now:
        months.append(d.strftime("%Y-%m"))
        d = (d.replace(day=1) + timedelta(days=32)).replace(day=1)
    rows = []
    for m in sorted(set(months)):
        got = _fetch_scored_month(m, through)
        if got is None:
            print("REFUSED: scored month %s could not be read (blind is not empty)" % m)
            return 3
        rows += buoy_holdout.drop(got, "buoy_id")
    out, valid, call = lines(read(index_rows(rows, since, now)))
    print("\n".join(out))
    return 0 if valid else 2


if __name__ == "__main__":
    sys.exit(main())
