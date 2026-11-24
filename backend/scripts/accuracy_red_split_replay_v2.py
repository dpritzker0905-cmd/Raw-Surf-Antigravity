"""D-072 v2 replay: rule 1 on CHANGE (the 7-day same-model delta minus its own 28-day trailing median), rule 2 on the
NAMED hole buoys. Pre-registered in docs/weather-program/log/2026-11-16-claude-verifier-d072-v2-prereg.md (section 1,
3c2d6ce1b). Built by pr-verifier; RUN AND SCORED BY THE ADVISOR.

MEASUREMENT ONLY, AGGREGATES ONLY: bounds, per-day statistics, the checks and the verdict. No row, observation series
or credential is printed. Reads the scored segments from private Storage (the monitor's read pair); runs only in the
dispatch-only workflow accuracy-red-split-replay.yml (input version=v2).

    python scripts/accuracy_red_split_replay_v2.py
"""
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.weather_pipeline import accuracy_red_split as A  # noqa: E402

WARMUP_FIRST = "2026-07-18"            # 28 days before the replay, so CHANGE exists from the first replay days
REPLAY_FIRST, REPLAY_LAST, BASIS_LAST = "2026-08-15", "2026-11-14", "2026-10-31"
EPISODE = ("2026-11-10", "2026-11-14")
TEST = ("2026-11-01", "2026-11-14")
SEED_FROM = "2026-11-01"               # the seeded regression is a step that starts with the test window
SEEDS = (0.08, 0.04)                   # +0.08 gates (P2'); +0.04 is the sensitivity
FULL_SEED = ("2026-11-08", "2026-11-14")  # amendment 1a: the days whose whole 7-day window is seeded; P2' gates on these
TRAIL, TRAIL_MIN = 28, 14
GUARD_FAR, GUARD_NEAR = 35, 8          # amendment 1c: the reference is the median of DAILY deltas over targets d-35 .. d-8
DAILY_MIN_N = 30                       # a daily (one target date) delta needs >= 30 pairs to enter the reference
FIRST_FIRE_BY = "2026-11-10"           # amendment 1c: timeliness, first fire <= 3 days after the window is fully seeded
NULL_DRAWS, SEED = 200, 20261116
NULL_MAX_PAGES_30D = 1.0
NAMED_HOLES = ("44090", "46254", "46274", "46285", "51201", "51206", "51208", "LJPC1")   # MEASURED_HOLES - NAMED_PATH_STATIONS
P2_MIN, P3_MIN = 12, 3


def days(first, last):
    d = datetime.fromisoformat(first).replace(tzinfo=timezone.utc)
    end = datetime.fromisoformat(last).replace(tzinfo=timezone.utc)
    while d <= end:
        yield d
        d += timedelta(days=1)


def daily(idx):
    """{day: {(rule, lead): [(|ours|, |theirs|, target_day)]}} for rule 1 (same-model keys), rule 2 v2 (best_match keys at
    the named holes) and rule 3 (best_match keys the same-model control also scores), from WARMUP_FIRST."""
    holes = set(NAMED_HOLES)
    out = {}
    buckets = A.by_day(idx)
    for d in days(WARMUP_FIRST, REPLAY_LAST):
        w = A.window(idx, d, buckets=buckets)
        ours, bm, sm = w[A.OURS], w[A.BEST_MATCH], w[A.SAME_MODEL]
        cell = {}
        for lead in A.LEADS:
            b = lead // 24
            k1 = A.paired_keys(ours, sm, (k for k in ours if k[2] == b))
            k2 = A.paired_keys(ours, bm, (k for k in ours if k[2] == b and k[0] in holes))
            k3 = A.paired_keys(ours, bm, (k for k in ours if k[2] == b and k in bm and k in sm))
            for rule, keys, theirs in ((1, k1, sm), (2, k2, bm), (3, k3, bm)):
                cell[(rule, lead)] = [(abs(ours[k]["err_m"]), abs(theirs[k]["err_m"]), k[1][:10], k) for k in keys]
        out[f"{d:%Y-%m-%d}"] = cell
    return out


def delta_of(pairs, seed_m=0.0):
    """(n, delta, win) with seed_m added to OUR |error| on pairs whose target day >= SEED_FROM."""
    if not pairs:
        return 0, None, None
    eo = [p[0] + (seed_m if p[2] >= SEED_FROM else 0.0) for p in pairs]
    et = [p[1] for p in pairs]
    n = len(pairs)
    return n, (sum(eo) - sum(et)) / n, sum(1 for a, b in zip(eo, et) if a < b) / n


def daily_targets(dd):
    """{(target date, lead): [(|ours|, |theirs|, date, key)]}: rule-1 pairs grouped by TARGET date, deduplicated across
    the overlapping windows, so each key enters exactly one daily delta (non-overlapping)."""
    out = {}
    for d in dd:
        for lead in A.LEADS:
            for p in dd[d][(1, lead)]:
                out.setdefault((p[2], lead), {})[p[3]] = p
    return {k: list(v.values()) for k, v in out.items()}


def _ref_dates(d):
    base = datetime.fromisoformat(d)
    return [f"{base - timedelta(days=k):%Y-%m-%d}" for k in range(GUARD_NEAR, GUARD_FAR + 1)]


def change_series_v2(dd, dt, seed_m=0.0):
    """{(day, lead): CHANGE} (amendment 1c): the 7-day delta minus the median of the DAILY deltas over targets
    d-35 .. d-8 (>= TRAIL_MIN of them gradeable at n >= DAILY_MIN_N). The reference never overlaps the current window."""
    import statistics
    daily_delta = {}
    for (date, lead), pairs in dt.items():
        n, de, _w = delta_of(pairs, seed_m)
        if n >= DAILY_MIN_N:
            daily_delta[(date, lead)] = de
    out = {}
    for d in dd:
        for lead in A.LEADS:
            n, de, _w = delta_of(dd[d][(1, lead)], seed_m)
            if n < A.MIN_N[1]:
                continue
            ref = [daily_delta[(r, lead)] for r in _ref_dates(d) if (r, lead) in daily_delta]
            if len(ref) >= TRAIL_MIN:
                out[(d, lead)] = de - statistics.median(ref)
    return out


def rule1_null(dd, dt, draws=NULL_DRAWS, seed=SEED):
    """Rule 1's null (amendment 1c): one swap sign per KEY per draw (key-consistent), applied to the 7-day deltas AND the
    daily deltas, with CHANGE recomputed inside each draw from that draw's own guarded reference.
    Returns ({lead: draws x days CHANGE matrix}, the day list)."""
    import numpy as np
    rng = np.random.default_rng(seed)
    dlist = sorted(dd)
    out = {}
    for lead in A.LEADS:
        keys = sorted({p[3] for (date, ld), ps in dt.items() if ld == lead for p in ps})
        pos = {k: j for j, k in enumerate(keys)}
        sign = np.where(rng.random((draws, len(keys))) < 0.5, -1.0, 1.0)
        dates = sorted({date for (date, ld) in dt if ld == lead})
        dcol = {date: j for j, date in enumerate(dates)}
        daily = np.full((draws, len(dates)), np.nan)
        for date in dates:
            ps = dt[(date, lead)]
            if len(ps) >= DAILY_MIN_N:
                idx = [pos[p[3]] for p in ps]
                diff = np.array([p[0] - p[1] for p in ps])
                daily[:, dcol[date]] = (sign[:, idx] * diff).sum(axis=1) / len(ps)
        ch = np.full((draws, len(dlist)), np.nan)
        for i, d in enumerate(dlist):
            ps = dd[d][(1, lead)]
            if len(ps) < A.MIN_N[1]:
                continue
            cols = [dcol[r] for r in _ref_dates(d) if r in dcol]
            if not cols:
                continue
            ref = daily[:, cols]
            if (~np.isnan(ref[0])).sum() < TRAIL_MIN:          # gradeability is the same in every draw
                continue
            idx = [pos[p[3]] for p in ps]
            diff = np.array([p[0] - p[1] for p in ps])
            d7 = (sign[:, idx] * diff).sum(axis=1) / len(ps)
            ch[:, i] = d7 - np.nanmedian(ref, axis=1)
        out[lead] = ch
    return out, dlist


def null_draws(dd, b1, bounds23, draws=NULL_DRAWS, seed=SEED, basis_only=False, key_consistent=False):
    """Per rule: (pages per 30 replay days, mean over draws; rule-1 swap-null deltas over the basis for B1's floor).
    The registered null re-signs every pair on every day. key_consistent (amendment 1a, REPORTED): one swap sign per key
    per draw, reused on every day the key appears, so the null keeps the windows' autocorrelation. Rule 1's CHANGE uses
    each draw's own trailing median either way."""
    import numpy as np
    rng = np.random.default_rng(seed)
    ksign, kpos = {}, {}
    if key_consistent:
        for rl in [(r, lead) for r in (1, 2, 3) for lead in A.LEADS]:
            keys = sorted({p[3] for d in dd for p in dd[d][rl]})
            kpos[rl] = {k: j for j, k in enumerate(keys)}
            ksign[rl] = rng.random((draws, len(keys))) < 0.5
    dlist = sorted(dd)
    replay = [i for i, d in enumerate(dlist) if REPLAY_FIRST <= d <= REPLAY_LAST]
    basis = [i for i, d in enumerate(dlist) if REPLAY_FIRST <= d <= BASIS_LAST]
    paged = {r: np.zeros((draws, len(dlist)), dtype=bool) for r in (1, 2, 3)}
    basis_null = []
    for lead in A.LEADS:
        deltas = np.full((draws, len(dlist)), np.nan)
        for i, d in enumerate(dlist):
            for rule in ((1,) if (basis_only or d < REPLAY_FIRST) else (1, 2, 3)):
                if basis_only and i not in basis and d < REPLAY_FIRST:
                    continue
                pairs = dd[d][(rule, lead)]
                n = len(pairs)
                if n < A.MIN_N[rule]:
                    continue
                a = np.fromiter((p[0] for p in pairs), float, n)
                b = np.fromiter((p[1] for p in pairs), float, n)
                if key_consistent:
                    swap = ksign[(rule, lead)][:, [kpos[(rule, lead)][p[3]] for p in pairs]]
                else:
                    swap = rng.random((draws, n)) < 0.5
                de = np.where(swap, b - a, a - b).sum(axis=1) / n
                if rule == 1:
                    deltas[:, i] = de
                    if i in basis:
                        basis_null.extend(de.tolist())
                else:
                    wi = np.where(swap, b < a, a < b).sum(axis=1) / n
                    paged[rule][:, i] |= (de > bounds23[rule]) & (wi < 0.50)
        if b1 is not None:
            for i in replay:
                past = deltas[:, max(0, i - TRAIL):i]
                ok = (~np.isnan(past)).sum(axis=1) >= TRAIL_MIN
                ch = deltas[:, i] - np.nanmedian(np.where(ok[:, None], past, 0.0), axis=1)
                paged[1][:, i] |= ok & ~np.isnan(deltas[:, i]) & (ch > b1)
    rates = {r: float(paged[r][:, replay].sum(axis=1).mean()) * 30.0 / max(len(replay), 1) for r in (1, 2, 3)}
    return rates, basis_null


def checks(idx):
    import numpy as np
    dd = daily(idx)
    dt = daily_targets(dd)
    basis_days = [d for d in dd if REPLAY_FIRST <= d <= BASIS_LAST]
    ch = change_series_v2(dd, dt)
    basis_ch = [v for (d, _l), v in ch.items() if d in basis_days]
    # rules 2 and 3: v1's bound method on their keys, from the basis days only
    b23 = {}
    for rule in (2, 3):
        worst = [delta_of(dd[d][(rule, lead)])[1] for d in basis_days for lead in A.LEADS
                 if len(dd[d][(rule, lead)]) >= A.MIN_N[rule]]
        if not worst:                                  # section 1: VOID when no basis day is gradeable for a rule
            return None, None, {}, "VOID (rule %d has no gradeable basis day)" % rule
        b23[rule] = round(max(A.BOUND_FACTOR * max(worst), A.BOUND_FLOOR_M) + 0.0049, 2)
    nul, dlist = rule1_null(dd, dt, draws=NULL_DRAWS, seed=SEED)
    basis_cols = [i for i, d in enumerate(dlist) if d in basis_days]
    basis_null = np.concatenate([nul[lead][:, basis_cols].ravel() for lead in A.LEADS])
    basis_null = basis_null[~np.isnan(basis_null)]
    if not basis_ch or basis_null.size == 0:
        return None, None, {}, "VOID (B1 cannot be computed)"
    b1 = round(max(float(np.percentile(basis_ch, 99)), float(np.percentile(basis_null, 99))) + 0.00049, 3)
    replay_cols = [i for i, d in enumerate(dlist) if REPLAY_FIRST <= d <= REPLAY_LAST]

    def pages_per_30d(m):
        paged = np.zeros((NULL_DRAWS, len(replay_cols)), dtype=bool)
        for lead in A.LEADS:
            paged |= np.nan_to_num(m[lead][:, replay_cols], nan=-1.0) > b1
        return float(paged.sum(axis=1).mean()) * 30.0 / max(len(replay_cols), 1)

    rule1_same_draws = pages_per_30d(nul)                    # 1d: reported only; these draws set B1
    nul_ind, _ = rule1_null(dd, dt, draws=NULL_DRAWS, seed=SEED + 3)                         # 1d: independent draws
    rates, _ = null_draws(dd, None, b23, draws=NULL_DRAWS, seed=SEED + 1)                    # rules 2 and 3 (registered)
    rates_key, _ = null_draws(dd, None, b23, draws=NULL_DRAWS, seed=SEED + 2, key_consistent=True)
    rates[1] = rates_key[1] = pages_per_30d(nul_ind)

    def fired1(series, day_lo, day_hi):
        return sorted({d for (d, _l), v in series.items() if day_lo <= d <= day_hi and v > b1})

    def fired_rule(rule, day_lo, day_hi):
        out = set()
        for d in dd:
            if not (day_lo <= d <= day_hi):
                continue
            for lead in A.LEADS:
                n, de, wi = delta_of(dd[d][(rule, lead)])
                if n >= A.MIN_N[rule] and de > b23[rule] and wi < 0.50:
                    out.add(d)
        return sorted(out)

    test_days = [d for d in dd if TEST[0] <= d <= TEST[1]]
    full_days = [d for d in dd if FULL_SEED[0] <= d <= FULL_SEED[1]]
    seeded = {s: change_series_v2(dd, dt, seed_m=s) for s in SEEDS}
    res = {"B1": b1, "B2": b23[2], "B3": b23[3],
           "P1_rule1_on_episode": fired1(ch, *EPISODE),
           "rule1_unseeded_pre_episode": fired1(ch, TEST[0], "2026-11-09"),
           "P2_seeded": {s: fired1(seeded[s], *TEST) for s in SEEDS},
           "P2_full_days": {s: fired1(seeded[s], *FULL_SEED) for s in SEEDS}, "n_full": len(full_days),
           "null_key_consistent": rates_key, "basis_change_n": len(basis_ch),
           "first_fire": (fired1(seeded[SEEDS[0]], *TEST) or [None])[0],
           "P3_rule2_on_episode": fired_rule(2, *EPISODE),
           "null_pages_per_30d": rates, "n_test": len(test_days),
           "basis_change_p99": float(np.percentile(basis_ch, 99)), "basis_null_p99": float(np.percentile(basis_null, 99)),
           "rule1_same_draw_pages": rule1_same_draws,                                          # 1d (1)
           "basis_change_median": float(np.median(basis_ch)), "basis_null_median": float(np.median(basis_null))}  # 1d (2)
    ok = (not res["P1_rule1_on_episode"] and len(res["P2_full_days"][SEEDS[0]]) >= len(full_days) - 1   # 1b: all but one
          and res["first_fire"] is not None and res["first_fire"] <= FIRST_FIRE_BY                    # 1c: timeliness
          and len(res["P3_rule2_on_episode"]) >= P3_MIN and all(v <= NULL_MAX_PAGES_30D for v in rates.values()))
    return dd, ch, res, ("PASS" if ok else "FAIL")


def lines_for(dd, ch, res, verdict):
    if dd is None:
        return ["== D-072 v2 replay", "== VERDICT: %s" % verdict]
    out = ["== D-072 v2 replay (pre-registered 3c2d6ce1b; aggregates only), %s..%s, basis <= %s"
           % (REPLAY_FIRST, REPLAY_LAST, BASIS_LAST),
           "-- B1 %+.3f m = max(basis CHANGE p99 %+.3f over n=%d day-leads, key-consistent null CHANGE p99 %+.3f)"
           " | B2 %+.2f | B3 %+.2f" % (res["B1"], res["basis_change_p99"], res["basis_change_n"], res["basis_null_p99"],
                                      res["B2"], res["B3"]),
           "-- rule-1 reference (1c): median of DAILY deltas over targets d-%d..d-%d (never the current window)"
           % (GUARD_FAR, GUARD_NEAR),
           "-- 1d: basis CHANGE median %+.3f vs null CHANGE median %+.3f (mean-vs-median offset); rule-1 pages/30d on"
           " the draws that set B1 %.2f (reported), on independent draws %.2f (gating)"
           % (res["basis_change_median"], res["basis_null_median"], res["rule1_same_draw_pages"],
              res["null_pages_per_30d"][1]),
           "-- November: rule-1 CHANGE per lead (! = fires) | rule-2 v2 delta [n, win%] per lead"]
    for d in sorted(dd):
        if d < TEST[0]:
            continue
        c1 = " ".join("n/a" if (d, lead) not in ch else "%+.3f%s" % (ch[(d, lead)], "!" if ch[(d, lead)] > res["B1"] else "")
                      for lead in A.LEADS)
        c2 = []
        for lead in A.LEADS:
            n, de, wi = delta_of(dd[d][(2, lead)])
            c2.append("n/a" if n < A.MIN_N[2] else "%+.3f[%d,%.0f%%]" % (de, n, 100 * wi))   # never below the floor
        out.append("  %s  r1 %s | r2 %s" % (d, c1, " ".join(c2)))
    s0, s1 = SEEDS
    out += ["-- checks",
            "  P1  rule 1 v2 on the unseeded episode: fired on %s" % (res["P1_rule1_on_episode"] or "none"),
            "  P2' +%.2f m seeded from %s: rule 1 v2 fired on %d of %d fully seeded days %s..%s (need all but one, 1b)"
            % (s0, SEED_FROM, len(res["P2_full_days"][s0]), res["n_full"], FULL_SEED[0], FULL_SEED[1]),
            "      timeliness (1c): first fire %s (need <= %s)" % (res["first_fire"] or "none", FIRST_FIRE_BY),
            "      diagnostic, partial-window days 11-01..11-07 fired: %s" % (
                [d for d in res["P2_seeded"][s0] if d < FULL_SEED[0]] or "none"),
            "      reported: %d of %d test days (the original >= %d line); first fire %s"
            % (len(res["P2_seeded"][s0]), res["n_test"], P2_MIN, (res["P2_seeded"][s0] or ["none"])[0]),
            "      sensitivity +%.2f m: %d of %d fully seeded days, %d of %d test days; first fire %s"
            % (s1, len(res["P2_full_days"][s1]), res["n_full"], len(res["P2_seeded"][s1]), res["n_test"],
               (res["P2_seeded"][s1] or ["none"])[0]),
            "  reported: rule 1 v2 on the UNSEEDED pre-episode test days 11-01..11-09 (out of sample): fired on %s"
            % (res["rule1_unseeded_pre_episode"] or "none"),
            "  P3  rule 2 v2 (named holes) on the episode: %d of 5 days (need >= %d)"
            % (len(res["P3_rule2_on_episode"]), P3_MIN),
            "  Null  %d draws, false pages per 30 days: %s (need <= %.1f)"
            % (NULL_DRAWS, {r: "%.2f" % v for r, v in res["null_pages_per_30d"].items()}, NULL_MAX_PAGES_30D),
            "  reported: key-consistent null (one sign per key, reused across days): %s per 30 days"
            % {r: "%.2f" % v for r, v in res["null_key_consistent"].items()},
            "== VERDICT: %s" % verdict]
    return out


def main():
    from scripts.forecast_accuracy_monitor import _fetch_scored_month
    from services import buoy_holdout      # the LOCKED final buoy holdout (#1199)
    through = (datetime.now(timezone.utc) + timedelta(days=1)).date()
    rows = []
    for m in ("2026-08", "2026-09", "2026-10", "2026-11"):      # the archive starts in August; warm-up days before it are empty
        got = _fetch_scored_month(m, through)
        if got is None:
            print("REFUSED: scored month %s could not be read (blind is not empty)" % m)
            return 3
        rows += buoy_holdout.drop(got, "buoy_id")
    dd, ch, res, verdict = checks(A.index_rows(rows))
    print("\n".join(lines_for(dd, ch, res, verdict)))
    return 0 if verdict == "PASS" else 2


if __name__ == "__main__":
    sys.exit(main())
