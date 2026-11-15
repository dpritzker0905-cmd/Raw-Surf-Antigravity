"""D-072 replay: are the three RED rules fit to page? Pre-registered in
docs/weather-program/log/2026-11-15-claude-verifier-d072-red-split.md (section 1, committed before any row is read).

MEASUREMENT ONLY, AGGREGATES ONLY: one simulated monitor run per day (00:00Z, the trailing 7-day paired window), the
three rules per lead, the bounds from the pre-onset basis days, the four pre-registered checks, and the hole-buoy audit
(per buoy, pre-onset vs November: MAE, duplicates, frozen predictions, observation anomalies). No row, observation
series or credential is printed. Reads the scored segments from private Storage (the monitor's read pair); runs only in
the dispatch-only workflow accuracy-red-split-replay.yml.

    python scripts/accuracy_red_split_replay.py
"""
import os
import random
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.weather_pipeline import accuracy_red_split as A  # noqa: E402

REPLAY_FIRST, REPLAY_LAST = "2026-08-15", "2026-11-14"
BASIS_LAST = "2026-10-31"          # pre-onset: the bounds never see November
EPISODE = ("2026-11-10", "2026-11-14")
SEEDED = ("2026-11-01", "2026-11-14")
SEED_M = 0.08
SEED = 20261115
NAMED_HOLES = ("44090", "46254", "46267", "46274", "46285", "51201", "51206", "51208", "LJPC1")


def days(first, last):
    d = datetime.fromisoformat(first).replace(tzinfo=timezone.utc)
    end = datetime.fromisoformat(last).replace(tzinfo=timezone.utc)
    while d <= end:
        yield d
        d += timedelta(days=1)


def replay(idx, seed_m=0.0, null_seed=None):
    """{day: {(rule, lead): stat}} for every replay day; null_seed re-draws the per-key swap on every day."""
    out = {}
    buckets = A.by_day(idx)
    for d in days(REPLAY_FIRST, REPLAY_LAST):
        rng = random.Random(f"{null_seed}-{d:%Y%m%d}") if null_seed is not None else None
        out[f"{d:%Y-%m-%d}"] = A.rule_stats(A.window(idx, d, buckets=buckets), seed_m=seed_m, swap_rng=rng)
    return out


def fired(daily, bounds, rule, day_set):
    """Days in day_set on which `rule` fired at >= 1 lead."""
    return sorted(d for d in day_set if any(A.fires(daily[d].get((rule, lead)), rule, bounds[rule])
                                            for lead in A.LEADS))


def checks(idx):
    """The pre-registered verdict: (bounds, results dict, verdict string)."""
    daily = replay(idx)
    basis = [d for d in daily if d <= BASIS_LAST]
    bounds = A.bounds_from_basis(daily, basis)
    episode = [d for d in daily if EPISODE[0] <= d <= EPISODE[1]]
    seeded_days = [d for d in daily if SEEDED[0] <= d <= SEEDED[1]]
    seeded = replay(idx, seed_m=SEED_M)
    null = replay(idx, null_seed=SEED)
    res = {
        "P1_rule1_silent_on_episode": fired(daily, bounds, 1, episode),
        "P2_rule1_fires_on_seeded": fired(seeded, bounds, 1, seeded_days),
        "P3_rule2_fires_on_episode": fired(daily, bounds, 2, episode),
        "P4_null_fires": {r: fired(null, bounds, r, list(daily)) for r in (1, 2, 3)},
        "n_episode": len(episode), "n_seeded": len(seeded_days),
    }
    ok = (not res["P1_rule1_silent_on_episode"]
          and len(res["P2_rule1_fires_on_seeded"]) >= 0.8 * len(seeded_days)
          and len(res["P3_rule2_fires_on_episode"]) >= 3
          and not any(res["P4_null_fires"].values()))
    gradeable_basis = sum(1 for d in basis for (r, _), s in daily[d].items() if s and s["n"] >= A.MIN_N[r])
    if gradeable_basis == 0:
        return bounds, res, daily, "VOID (no gradeable basis day)"
    return bounds, res, daily, ("PASS" if ok else "FAIL")


def audit(idx):
    """Per hole buoy (data-derived: best_match rows with no same-model row), pre-onset vs November aggregates."""
    ours, bm, sm = idx[A.OURS], idx[A.BEST_MATCH], idx[A.SAME_MODEL]
    holes = sorted({k[0] for k in bm if k not in sm and k in ours})
    lines = ["-- hole-buoy audit (data-derived holes: %d; named: %s)" % (len(holes), ",".join(NAMED_HOLES)),
             "   buoy   period  n    MAE ours  MAE bm   obs<=0.05 obs>15  frozen-pred  dup-keys"]
    for b in holes:
        for label, lo, hi in (("pre", "2026-08-15", "2026-10-31T23:59Z"), ("nov", "2026-11-01", "2026-11-14T23:59Z")):
            keys = [k for k in ours if k[0] == b and k in bm and lo <= k[1] <= hi and A._same_obs(ours[k], bm[k])]
            if not keys:
                continue
            n = len(keys)
            mo = sum(abs(ours[k]["err_m"]) for k in keys) / n
            mb = sum(abs(bm[k]["err_m"]) for k in keys) / n
            obs = [ours[k].get("obs_hs_m") for k in keys]
            low = sum(1 for o in obs if o is not None and o <= 0.05)
            high = sum(1 for o in obs if o is not None and o > 15)
            preds = [(k[2], k[1], round((ours[k]["err_m"] or 0) + (ours[k].get("obs_hs_m") or 0), 3)) for k in keys]
            preds.sort()
            frozen = sum(1 for a, c in zip(preds, preds[1:]) if a[0] == c[0] and a[2] == c[2])
            dup = n - len({(k[0], k[1], k[2]) for k in keys})
            flag = " " + ("*" if b in NAMED_HOLES else " ")
            lines.append("  %s%-6s %-4s %5d  %.3f     %.3f    %4d      %4d    %5d        %d"
                         % (flag, b, label, n, mo, mb, low, high, frozen, dup))
    return lines


def lines_for(bounds, res, daily, verdict):
    out = ["== D-072 three-rule replay (pre-registered; aggregates only), %s..%s, bounds from days <= %s"
           % (REPLAY_FIRST, REPLAY_LAST, BASIS_LAST),
           "-- bounds (1.24 x basis max, floor %.2f m): rule1 %+.2f  rule2 %+.2f  rule3 %+.2f m"
           % (A.BOUND_FLOOR_M, bounds[1], bounds[2], bounds[3]),
           "-- per day (episode and November), delta [n, win%] per lead:"]
    for d in sorted(daily):
        if d < "2026-11-01" and d not in ("2026-08-15", "2026-09-15", "2026-10-15", "2026-10-31"):
            continue
        cells = []
        for rule in (1, 2, 3):
            parts = []
            for lead in A.LEADS:
                s = daily[d].get((rule, lead))
                parts.append("n/a" if not s else "%+.3f[%d,%.0f%%]%s" % (
                    s["delta"], s["n"], 100 * s["win"], "!" if A.fires(s, rule, bounds[rule]) else ""))
            cells.append("r%d %s" % (rule, " ".join(parts)))
        out.append("  %s  %s" % (d, " | ".join(cells)))
    out += ["-- checks",
            "  P1 rule 1 silent on the 11-10 episode: fired on %s" % (res["P1_rule1_silent_on_episode"] or "none"),
            "  P2 rule 1 fires on +%.2f m seeded, %d days: fired on %d (need >= 80%%)"
            % (SEED_M, res["n_seeded"], len(res["P2_rule1_fires_on_seeded"])),
            "  P3 rule 2 fires on the episode: %d of %d days (need >= 3)" % (len(res["P3_rule2_fires_on_episode"]),
                                                                            res["n_episode"]),
            "  P4 per-key swap null (re-drawn daily) fired: %s" % {r: len(v) for r, v in res["P4_null_fires"].items()},
            "== VERDICT: %s" % verdict]
    return out


def main():
    from scripts.forecast_accuracy_monitor import _fetch_scored_month
    through = (datetime.now(timezone.utc) + timedelta(days=1)).date()
    rows = []
    for m in ("2026-08", "2026-09", "2026-10", "2026-11"):
        got = _fetch_scored_month(m, through)
        if got is None:
            print("REFUSED: scored month %s could not be read (blind is not empty)" % m)
            return 3
        rows += got
    idx = A.index_rows(rows)
    bounds, res, daily, verdict = checks(idx)
    print("\n".join(lines_for(bounds, res, daily, verdict) + audit(idx)))
    return 0 if verdict == "PASS" else 2


if __name__ == "__main__":
    sys.exit(main())
