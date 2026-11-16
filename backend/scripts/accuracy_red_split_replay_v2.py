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


def change_series(dd, seed_m=0.0):
    """{(day, lead): CHANGE} where defined: delta minus the median of the previous TRAIL days' gradeable deltas."""
    import numpy as np
    dlist = sorted(dd)
    out = {}
    for lead in A.LEADS:
        vals = []
        for d in dlist:
            n, de, _w = delta_of(dd[d][(1, lead)], seed_m)
            vals.append(de if (n >= A.MIN_N[1] and de is not None) else np.nan)
        arr = np.array(vals, dtype=float)
        for i, d in enumerate(dlist):
            past = arr[max(0, i - TRAIL):i]
            if np.isnan(arr[i]) or np.sum(~np.isnan(past)) < TRAIL_MIN:
                continue
            out[(d, lead)] = float(arr[i] - np.nanmedian(past))
    return out


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
    basis_days = [d for d in dd if REPLAY_FIRST <= d <= BASIS_LAST]
    ch = change_series(dd)
    basis_ch = [v for (d, _l), v in ch.items() if d in basis_days]
    # rules 2 and 3: v1's bound method on their keys, from the basis days only
    b23 = {}
    for rule in (2, 3):
        worst = [delta_of(dd[d][(rule, lead)])[1] for d in basis_days for lead in A.LEADS
                 if len(dd[d][(rule, lead)]) >= A.MIN_N[rule]]
        if not worst:                                  # section 1: VOID when no basis day is gradeable for a rule
            return None, None, {}, "VOID (rule %d has no gradeable basis day)" % rule
        b23[rule] = round(max(A.BOUND_FACTOR * max(worst), A.BOUND_FLOOR_M) + 0.0049, 2)
    _rates0, basis_null = null_draws(dd, None, b23, draws=NULL_DRAWS, basis_only=True)
    if not basis_ch or not basis_null:
        return None, None, {}, "VOID (B1 cannot be computed)"
    b1 = round(max(float(np.percentile(basis_ch, 99)), float(np.percentile(basis_null, 99))) + 0.00049, 3)
    rates, _ = null_draws(dd, b1, b23, draws=NULL_DRAWS, seed=SEED + 1)
    rates_key, _ = null_draws(dd, b1, b23, draws=NULL_DRAWS, seed=SEED + 2, key_consistent=True)

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
    seeded = {s: change_series(dd, seed_m=s) for s in SEEDS}
    res = {"B1": b1, "B2": b23[2], "B3": b23[3],
           "P1_rule1_on_episode": fired1(ch, *EPISODE),
           "rule1_unseeded_pre_episode": fired1(ch, TEST[0], "2026-11-09"),
           "P2_seeded": {s: fired1(seeded[s], *TEST) for s in SEEDS},
           "P2_full_days": {s: fired1(seeded[s], *FULL_SEED) for s in SEEDS}, "n_full": len(full_days),
           "null_key_consistent": rates_key,
           "P3_rule2_on_episode": fired_rule(2, *EPISODE),
           "null_pages_per_30d": rates, "n_test": len(test_days),
           "basis_change_p99": float(np.percentile(basis_ch, 99)), "basis_null_p99": float(np.percentile(basis_null, 99))}
    ok = (not res["P1_rule1_on_episode"] and len(res["P2_full_days"][SEEDS[0]]) == len(full_days)
          and len(res["P3_rule2_on_episode"]) >= P3_MIN and all(v <= NULL_MAX_PAGES_30D for v in rates.values()))
    return dd, ch, res, ("PASS" if ok else "FAIL")


def lines_for(dd, ch, res, verdict):
    if dd is None:
        return ["== D-072 v2 replay", "== VERDICT: %s" % verdict]
    out = ["== D-072 v2 replay (pre-registered 3c2d6ce1b; aggregates only), %s..%s, basis <= %s"
           % (REPLAY_FIRST, REPLAY_LAST, BASIS_LAST),
           "-- B1 %+.3f m = max(basis CHANGE p99 %+.3f, swap-null p99 %+.3f) | B2 %+.2f | B3 %+.2f"
           % (res["B1"], res["basis_change_p99"], res["basis_null_p99"], res["B2"], res["B3"]),
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
            "  P2' +%.2f m seeded from %s: rule 1 v2 fired on %d of %d fully seeded days %s..%s (need all, amendment 1a)"
            % (s0, SEED_FROM, len(res["P2_full_days"][s0]), res["n_full"], FULL_SEED[0], FULL_SEED[1]),
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
    through = (datetime.now(timezone.utc) + timedelta(days=1)).date()
    rows = []
    for m in ("2026-08", "2026-09", "2026-10", "2026-11"):      # the archive starts in August; warm-up days before it are empty
        got = _fetch_scored_month(m, through)
        if got is None:
            print("REFUSED: scored month %s could not be read (blind is not empty)" % m)
            return 3
        rows += got
    dd, ch, res, verdict = checks(A.index_rows(rows))
    print("\n".join(lines_for(dd, ch, res, verdict)))
    return 0 if verdict == "PASS" else 2


if __name__ == "__main__":
    sys.exit(main())
