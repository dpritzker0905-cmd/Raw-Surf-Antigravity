"""Per-buoy split of the Forecast Accuracy Monitor's paired gaps (2026-11-12). MEASUREMENT ONLY: prints aggregates.

WHY. The monitor has been RED since 2026-11-10 on the `open_meteo_marine` (Open-Meteo best_match) paired gap. Its logs
carry pooled numbers only, so the diagnosis in `docs/weather-program/log/2026-11-12-fable-accuracy-monitor-red.md` had to
ESTIMATE the share sitting on the buoys where GFS-Wave 0.25 deg has no wet cell, and D-072 (proposed) rests on that
estimate. This job replaces the estimate with the exact numbers, computed where the scored rows live (Actions holds the
read key; the owner approved running it there, 2026-11-12 17:54 EST: "Yes, run it there").

WHAT IT PRINTS (aggregates only: no row, no observation series, no credential ever reaches the log):
  1. per buoy x lead (24/48/72 h), the last WINDOW_DAYS: paired gap vs best_match, n, a day-block bootstrap 95% interval,
     the hole buoys marked;
  2. the same against the same-model control (`open_meteo:ncep_gfswave025`), plus the check that the control's paired key
     set is a subset of best_match's (the estimate assumed it);
  3. best_match's OWN MAE on the hole keys (the estimate had to assume it);
  4. a WIRING check (+0.05 m on our absolute error at one buoy comes back exactly there and nowhere else: arithmetic, it
     proves buoys do not leak into each other) and a DETECTION control (+0.05 m seeded into every served err_m BEFORE
     pairing: does the pooled +72 h interval exclude the unseeded gap?);
  5. the pooled gap per lead with 1-day and 3-day block intervals, and the same over the monitor's own 7-day window, so
     +0.111 against the 0.10 m bound can be read against noise on the window that paged.

PAIRING is the monitor's own (`forecast_skill.head_to_head`): the same (buoy, target hour, lead bucket) AND the same
verifying observation (time and height). A key whose observation identity differs or is missing is excluded and counted.

Kill switch: the workflow is dispatch-only, so not running it is the switch. Nothing here is imported by the serve path.
"""
import argparse
import os
import random
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

PRIMARY = "raw_surf"
BEST_MATCH = "open_meteo_marine"
SAME_MODEL = "open_meteo:ncep_gfswave025"
LEADS = (24, 48, 72)
WINDOW_DAYS = 14
BOOT_DRAWS = 2000      # 400 put the 2.5% bound on the 10th value (advisor, 2026-11-12)
BOOT_SEED = 20261112
POSITIVE_CONTROL_M = 0.05
GATE_WINDOW_DAYS = 7   # the monitor's paired gate grades a trailing 7 days; printed beside the longer window
# Measured 2026-11-12 (one batched Open-Meteo call at NDBC coordinates): `ncep_gfswave025` returns null or 0.0 at all
# 96 hours at these 9 buoys. Printed beside the DATA-DERIVED hole set (buoys with best_match pairs and no same-model
# pairs), so a disagreement between the two shows on the page instead of being assumed away.
MEASURED_HOLES = ("44090", "46254", "46267", "46274", "46285", "51201", "51206", "51208", "LJPC1")


def _finite(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and v not in (float("inf"), float("-inf"))


def _bucket(lead_h):
    return int(round((lead_h or 0) / 24.0))


def index_rows(rows, now, window_days=WINDOW_DAYS):
    """{source: {(buoy, target_time, bucket): row}} for rows with a finite err_m and a target inside the window."""
    lo = now - timedelta(days=window_days)
    out = {}
    for r in rows or []:
        if not _finite(r.get("err_m")):
            continue
        t = _parse(r.get("target_time"))
        if t is None or not (lo <= t <= now + timedelta(days=1)):
            continue
        key = (str(r.get("buoy_id")).upper(), r.get("target_time"), _bucket(r.get("lead_h")))
        out.setdefault(r.get("source"), {})[key] = r
    return out


def _parse(v):
    if not isinstance(v, str):
        return None
    try:
        t = datetime.fromisoformat(v.replace("Z", "+00:00"))
    except ValueError:
        return None
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


def paired(ours, theirs):
    """Keys present in both with the SAME verifying observation (head_to_head's rule). Returns (keys, n_mismatch, n_missing)."""
    keys, mismatch, missing = [], 0, 0
    for k in ours:
        if k not in theirs:
            continue
        a, b = ours[k], theirs[k]
        ta, tb = _parse(a.get("obs_time")), _parse(b.get("obs_time"))
        ha, hb = a.get("obs_hs_m"), b.get("obs_hs_m")
        if ta is None or tb is None or not _finite(ha) or not _finite(hb):
            missing += 1
        elif ta != tb or ha != hb:
            mismatch += 1
        else:
            keys.append(k)
    return keys, mismatch, missing


def gap(keys, ours, theirs, extra=None):
    """(n, mae_ours, mae_theirs, delta, win_rate). `extra` maps buoy -> metres added to OUR absolute error (the control)."""
    if not keys:
        return 0, None, None, None, None
    extra = extra or {}
    mo = [abs(ours[k]["err_m"]) + extra.get(k[0], 0.0) for k in keys]
    mt = [abs(theirs[k]["err_m"]) for k in keys]
    n = len(keys)
    wins = sum(1 for a, b in zip(mo, mt) if a < b)
    return n, sum(mo) / n, sum(mt) / n, sum(mo) / n - sum(mt) / n, wins / n


def day_block_interval(keys, ours, theirs, draws=BOOT_DRAWS, seed=BOOT_SEED, extra=None, block_days=1):
    """95% interval of the paired gap, resampling whole blocks of `block_days` consecutive target days (errors within a
    day share the weather, so key resampling would understate the spread; a storm lasting several days makes even
    1-day blocks understate it, hence the 3-day option). None when fewer than 3 blocks carry pairs."""
    first = min((k[1][:10] for k in keys), default=None)
    by_day = {}
    for k in keys:
        offset = (datetime.fromisoformat(k[1][:10]) - datetime.fromisoformat(first)).days
        by_day.setdefault(offset // block_days, []).append(k)
    days = sorted(by_day)
    if len(days) < 3:
        return None
    rng = random.Random(seed)
    stats = []
    for _ in range(draws):
        sample = [k for _d in range(len(days)) for k in by_day[days[rng.randrange(len(days))]]]
        stats.append(gap(sample, ours, theirs, extra)[3])
    stats.sort()
    return stats[int(0.025 * draws)], stats[min(draws - 1, int(0.975 * draws))]


def split(idx, reference, leads=LEADS):
    """Per (buoy, lead) and pooled per lead, against one reference source."""
    ours, theirs = idx.get(PRIMARY) or {}, idx.get(reference) or {}
    out = {"pooled": {}, "by_buoy": {}, "excluded": {}}
    for lead in leads:
        b = lead // 24
        o = {k: v for k, v in ours.items() if k[2] == b}
        t = {k: v for k, v in theirs.items() if k[2] == b}
        keys, mm, miss = paired(o, t)
        out["excluded"][lead] = (mm, miss)
        out["pooled"][lead] = gap(keys, o, t) + (day_block_interval(keys, o, t),
                                                 day_block_interval(keys, o, t, block_days=3))
        for buoy in sorted({k[0] for k in keys}):
            bk = [k for k in keys if k[0] == buoy]
            out["by_buoy"][(buoy, lead)] = gap(bk, o, t) + (day_block_interval(bk, o, t),)
    return out


def key_sets(idx, lead):
    """(best_match paired keys, same-model paired keys) at one lead, both against the served lane."""
    b = lead // 24
    ours = {k: v for k, v in (idx.get(PRIMARY) or {}).items() if k[2] == b}
    bm = paired(ours, {k: v for k, v in (idx.get(BEST_MATCH) or {}).items() if k[2] == b})[0]
    sm = paired(ours, {k: v for k, v in (idx.get(SAME_MODEL) or {}).items() if k[2] == b})[0]
    return set(bm), set(sm)


def hole_keys_view(idx, lead):
    """Keys best_match pairs and the same-model control does not: the served and best_match MAE on them, the share of
    the pooled best_match gap they carry, and the buoys they come from (the DATA-derived hole set)."""
    bm, sm = key_sets(idx, lead)
    extra = sorted(bm - sm)
    b = lead // 24
    ours = {k: v for k, v in (idx.get(PRIMARY) or {}).items() if k[2] == b}
    theirs = {k: v for k, v in (idx.get(BEST_MATCH) or {}).items() if k[2] == b}
    n, mo, mt, d, w = gap(extra, ours, theirs)
    pooled = gap(sorted(bm), ours, theirs)
    share = (n * d) / (pooled[0] * pooled[3]) if n and pooled[0] and pooled[3] else None
    return {"n": n, "mae_ours": mo, "mae_best_match": mt, "delta": d, "win": w,
            "interval": day_block_interval(extra, ours, theirs),
            "share_of_pooled_gap": share, "subset": sm <= bm, "n_same_model_not_in_best_match": len(sm - bm),
            "buoys": sorted({k[0] for k in extra})}


def wiring_check(idx, buoy, lead=72, seeded=POSITIVE_CONTROL_M):
    """Add `seeded` to OUR absolute error at one buoy only and re-split. Returns (recovered at that buoy, max |change|
    anywhere else). A split that cannot return its own seed cannot be trusted with the real answer."""
    b = lead // 24
    ours = {k: v for k, v in (idx.get(PRIMARY) or {}).items() if k[2] == b}
    theirs = {k: v for k, v in (idx.get(BEST_MATCH) or {}).items() if k[2] == b}
    keys = paired(ours, theirs)[0]
    if not any(k[0] == buoy for k in keys):
        return None, None
    worst_other = 0.0
    recovered = None
    for bu in sorted({k[0] for k in keys}):
        bk = [k for k in keys if k[0] == bu]
        before = gap(bk, ours, theirs)[3]
        after = gap(bk, ours, theirs, extra={buoy: seeded})[3]
        if bu == buoy:
            recovered = after - before
        else:
            worst_other = max(worst_other, abs(after - before))
    return recovered, worst_other


def detection_control(rows, now, days, lead=72, seeded=POSITIVE_CONTROL_M):
    """THE DETECTION TEST (advisor, 2026-11-12). Seed +`seeded` m into EVERY served err_m BEFORE indexing and pairing,
    re-split, and report whether the seeded pooled interval at `lead` excludes the unseeded gap. Unlike the wiring check
    this is not arithmetic: |err + 0.05| moves a row by anything from -0.05 to +0.05 depending on the sign and size of its
    error, so whether the split NOTICES a 0.05 m shift depends on the data and the noise.
    Returns (unseeded gap, seeded gap, seeded 1-day interval, excludes or None when thin)."""
    seeded_rows = [{**r, "err_m": r["err_m"] + seeded} if r.get("source") == PRIMARY and _finite(r.get("err_m")) else r
                   for r in rows or []]
    base = split(index_rows(rows, now, days), BEST_MATCH, leads=(lead,))["pooled"][lead]
    hit = split(index_rows(seeded_rows, now, days), BEST_MATCH, leads=(lead,))["pooled"][lead]
    iv = hit[5]
    excludes = None if (iv is None or base[3] is None) else not (iv[0] <= base[3] <= iv[1])
    return base[3], hit[3], iv, excludes


def _fmt(v, sign=True):
    return "-" if v is None else (("%+.3f" if sign else "%.3f") % v)


def _ci(iv):
    return "[%+.3f, %+.3f]" % iv if iv else "[thin: < 3 days]"


def report_lines(idx, now, days=WINDOW_DAYS, rows=None):
    lines = ["per-buoy split, %d days to %s, paired as head_to_head (same buoy x target x lead x observation)"
             % (days, now.strftime("%Y-%m-%dT%H:%MZ")),
             "measured hole list (9): %s" % ", ".join(MEASURED_HOLES)]
    for ref, label in ((BEST_MATCH, "vs best_match"), (SAME_MODEL, "vs same-model control")):
        s = split(idx, ref)
        lines.append("== %s: pooled" % label)
        for lead in LEADS:
            n, mo, mt, d, w, iv, iv3 = s["pooled"][lead]
            mm, miss = s["excluded"][lead]
            lines.append("  +%dh n=%d ours=%s theirs=%s gap=%s 1-day %s 3-day %s win=%s  (excluded: %d obs mismatch, "
                         "%d obs missing)"
                         % (lead, n, _fmt(mo, False), _fmt(mt, False), _fmt(d), _ci(iv), _ci(iv3),
                            "-" if w is None else "%.0f%%" % (100 * w), mm, miss))
        lines.append("== %s: by buoy (gap, n, 95%% day-block interval; * = measured hole)" % label)
        for buoy in sorted({b for b, _l in s["by_buoy"]}):
            cells = []
            for lead in LEADS:
                c = s["by_buoy"].get((buoy, lead))
                cells.append("+%dh -" % lead if not c else "+%dh %s n=%d %s" % (lead, _fmt(c[3]), c[0], _ci(c[5])))
            lines.append("  %-6s%s %s" % (buoy, "*" if buoy in MEASURED_HOLES else " ", " | ".join(cells)))
    lines.append("== keys best_match pairs and the same-model control does not (the data-derived holes)")
    for lead in LEADS:
        h = hole_keys_view(idx, lead)
        lines.append("  +%dh n=%d ours=%s best_match=%s gap=%s %s share_of_pooled_gap=%s subset=%s (%d control keys "
                     "outside best_match) buoys=%s"
                     % (lead, h["n"], _fmt(h["mae_ours"], False), _fmt(h["mae_best_match"], False), _fmt(h["delta"]),
                        _ci(h["interval"]), "-" if h["share_of_pooled_gap"] is None else "%.0f%%" % (100 * h["share_of_pooled_gap"]),
                        h["subset"], h["n_same_model_not_in_best_match"], ",".join(h["buoys"]) or "-"))
        unmeasured = sorted(set(h["buoys"]) - set(MEASURED_HOLES))
        missing = sorted(set(MEASURED_HOLES) - set(h["buoys"]))
        if unmeasured or missing:
            lines.append("    hole sets disagree: in data not measured=%s, measured not in data=%s"
                         % (",".join(unmeasured) or "-", ",".join(missing) or "-"))
    probe = next(iter(sorted({k[0] for k in (idx.get(PRIMARY) or {})})), None)
    rec, other = wiring_check(idx, probe) if probe else (None, None)
    ok = rec is not None and abs(rec - POSITIVE_CONTROL_M) < 1e-9 and other is not None and other < 1e-9
    lines.append("wiring check (arithmetic, not detection): +%.2f m on our abs error at %s (+72h) -> recovered %s, max "
                 "change elsewhere %s: %s"
                 % (POSITIVE_CONTROL_M, probe or "-", _fmt(rec), _fmt(other, False), "PASS" if ok else "FAIL"))
    if rows is not None:
        base, hit, iv, excl = detection_control(rows, now, days)
        lines.append("detection control: +%.2f m seeded into every served err_m before pairing -> pooled +72h gap %s -> %s, "
                     "seeded 1-day interval %s %s the unseeded gap"
                     % (POSITIVE_CONTROL_M, _fmt(base), _fmt(hit), _ci(iv),
                        "EXCLUDES" if excl else ("does NOT exclude" if excl is False else "cannot judge (thin)")))
    return lines, ok


def gate_window_lines(rows, now, days=GATE_WINDOW_DAYS):
    """The pooled gaps over the monitor's own 7-day window, so +0.111 is read against noise on the window that paged.
    Per-buoy cells are not printed here: 7 days gives too few 3-day blocks for a per-buoy interval."""
    idx = index_rows(rows, now, days)
    lines = ["== gate window: pooled, %d days (the monitor's paired window; per-buoy intervals are thin here)" % days]
    for ref, label in ((BEST_MATCH, "best_match"), (SAME_MODEL, "same-model control")):
        s = split(idx, ref)
        for lead in LEADS:
            n, mo, mt, d, w, iv, iv3 = s["pooled"][lead]
            lines.append("  vs %-18s +%dh n=%d gap=%s 1-day %s 3-day %s" % (label, lead, n, _fmt(d), _ci(iv), _ci(iv3)))
    return lines


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--days", type=int, default=WINDOW_DAYS)
    args = ap.parse_args()
    from scripts.forecast_accuracy_monitor import _fetch_scored_month
    now = datetime.now(timezone.utc)
    through = (now + timedelta(days=1)).date()
    months = sorted({(now - timedelta(days=d)).strftime("%Y-%m") for d in range(max(args.days, GATE_WINDOW_DAYS) + 1)})
    rows = []
    for m in months:
        got = _fetch_scored_month(m, through)
        if got is None:
            print("REFUSED: scored month %s could not be read (blind is not empty)" % m)
            return 3
        rows += got
    idx = index_rows(rows, now, args.days)
    lines, ok = report_lines(idx, now, args.days, rows=rows)
    if args.days != GATE_WINDOW_DAYS:
        lines += gate_window_lines(rows, now)
    print("\n".join(lines))
    return 0 if ok else 2


if __name__ == "__main__":
    sys.exit(main())
