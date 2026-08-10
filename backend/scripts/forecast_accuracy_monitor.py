"""Forecast ACCURACY monitor -- the first scheduled check that can go red on a wrong forecast.

WHY (MASTER-AUDIT-11.0 SS3.7, 2026-08-08): 0 of 8 scheduled workflows could go red on a
forecast-accuracy regression. Every standing alert was about freshness, presence or drift; the one
continuously computed accuracy number (height_mae_m, 60 buoys/run) had no threshold, no trend
check and no consumer, and both permanent verification archives (residual history, skill scored
segments) had ZERO automated readers. A 10% systematic height error would have shipped silently:
the only exact height anchor sits in the depth-saturated regime where Kr cancels out.

THRESHOLDS ARE MEASURED, NOT TASTE (2026-08-08, the data-health lesson in reverse -- its page
threshold sat 2% above the largest legitimate gap and cry-wolfed). Per-run MAE distribution
extracted from the calibration lane's own Actions logs, n=37 runs spanning 08-05 -> 08-08:
    min 0.148   p50 0.198   p75 0.217   p90 0.241   p95 0.252   p99 0.269   max 0.269 m
  WARN 0.30 m  = observed max + 11%   (worth a look, not a page)
  RED  0.40 m  = 2x the median, 49% over the observed max -- the shipped-a-bad-constant class
                 (the H110-alone flip class measured +25.5%), not sea-state noise.
CAVEAT, encoded as tunables: that frame is 3.4 boreal-summer days and MAE is conditional on sea
state -- a winter season runs higher. Tune via workflow vars, and this script prints the live value
beside its threshold on every run so a future re-tune has provenance.

REFUSE SEMANTICS (house rule: a check that cannot tell "not sampled" from "broken" must REFUSE):
exit 0 = measured healthy (warnings allowed)   exit 1 = RED, a gate fired on a measurement
exit 3 = REFUSED, the monitor is BLIND (report unreachable / n too small) -- never green-when-blind,
and never conflated with a measured breach: the ::error text names which one you are looking at.

SELF-EXPIRING GRACE for the skill-ledger gates: the ledger fix (5e181f69, 2026-08-08) needs one
calibration cron to attach forecast_skill_ops, and ~72 h for the surviving pending cohort's targets
to arrive. Absence pages after OPS_GRACE; scored=0 pages after SCORED_GRACE. No one has to
remember to arm this monitor -- the dates do it.

Usage:
  python scripts/forecast_accuracy_monitor.py                      # against production
  python scripts/forecast_accuracy_monitor.py --base http://localhost:8000
Credential-optional: with SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY it also reads the two archives
(their first automated reader); without them the report gates still carry the paging.
ASCII output only (cp1252 Windows consoles).
"""
import argparse
import json
import os
import sys
import urllib.request
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

OK, RED, REFUSED = 0, 1, 3

OPS_GRACE_DEFAULT = "2026-08-10T12:00:00Z"      # first post-fix calibration cron + margin
SCORED_GRACE_DEFAULT = "2026-08-12T06:00:00Z"   # fix deploy 08-09T00:26Z + 72h recovery + margin


def _parse_iso(v):
    if not v:
        return None
    try:
        dt = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def default_cfg():
    return {
        "red_mae_m": 0.40, "warn_mae_m": 0.30, "min_n": 30, "max_report_age_h": 8.0,
        "ops_grace": _parse_iso(OPS_GRACE_DEFAULT), "scored_grace": _parse_iso(SCORED_GRACE_DEFAULT),
    }


def combine(a, b):
    """RED outranks REFUSED outranks OK: a measured breach beats blindness beats green. Plain
    max() would invert the first pair (REFUSED=3 > RED=1), burying a real breach under a
    side-channel read failure."""
    if RED in (a, b):
        return RED
    if REFUSED in (a, b):
        return REFUSED
    return OK


def evaluate_report(report, now, cfg):
    """Grade the live calibration report. Returns (exit_code, [lines]) -- pure, no network."""
    lines = []
    if not isinstance(report, dict) or report.get("available") is not True:
        return REFUSED, ["::error::ACCURACY MONITOR IS BLIND -- calibration report unreachable or "
                         "unavailable. This is refusal, NOT health and NOT a measured breach: "
                         "the forecast may be fine or broken, nothing can currently say which."]
    gen = _parse_iso(report.get("generated_at"))
    if gen is None:
        return REFUSED, ["::error::ACCURACY MONITOR IS BLIND -- report carries no parseable "
                         "generated_at, so freshness (and therefore every number in it) is unknown."]
    age_h = (now - gen).total_seconds() / 3600.0
    lines.append("report generated_at=%s (age %.1f h)" % (report.get("generated_at"), age_h))
    if age_h > cfg["max_report_age_h"]:
        return RED, lines + [
            "::error::ACCURACY UNMEASURED for %.1f h (bound %.1f h) -- the calibration lane has "
            "stopped producing reports. Not a measured forecast error: the instrument died. "
            "Check forecast-ingest / precompute runs." % (age_h, cfg["max_report_age_h"])]

    summary = report.get("summary") or {}
    mae, n = summary.get("height_mae_m"), summary.get("height_n")
    if not isinstance(mae, (int, float)) or not isinstance(n, int):
        return REFUSED, lines + ["::error::ACCURACY MONITOR IS BLIND -- summary carries no "
                                 "height_mae_m/height_n pair to grade."]
    if n < cfg["min_n"]:
        return REFUSED, lines + [
            "::error::ACCURACY MONITOR REFUSES -- n=%d buoy pairs (< %d) is too thin to grade: "
            "an MAE over a handful of buoys is weather, not skill. If NDBC coverage collapsed, "
            "that is the incident." % (n, cfg["min_n"])]

    code = OK
    lines.append("height MAE %.3f m over n=%d buoys (bias %+.3f m) | warn %.2f red %.2f "
                 "[basis: n=37 runs 08-05..08-08, p50 0.198 max 0.269]"
                 % (mae, n, summary.get("height_bias_m") or 0.0,
                    cfg["warn_mae_m"], cfg["red_mae_m"]))
    if mae > cfg["red_mae_m"]:
        code = RED
        lines.append("::error::FORECAST ACCURACY RED -- height MAE %.3f m breaches the %.2f m bound "
                     "(2x the measured p50, 49%% over the observed max). This is the "
                     "shipped-a-bad-constant class, not sea-state noise: diff the last deploys to "
                     "the height chain before anything else." % (mae, cfg["red_mae_m"]))
    elif mae > cfg["warn_mae_m"]:
        lines.append("::warning::height MAE %.3f m exceeds the %.2f m warn band (observed max "
                     "0.269). Big sea state can do this; two consecutive warns cannot."
                     % (mae, cfg["warn_mae_m"]))

    ops = report.get("forecast_skill_ops")
    if not isinstance(ops, dict):
        if now > cfg["ops_grace"]:
            code = max(code, RED)
            lines.append("::error::SKILL LEDGER DEAD -- a fresh calibration report carries no "
                         "forecast_skill_ops block, so the ledger did not run (the 08-04 outage "
                         "was exactly this, invisible). Grace expired %s."
                         % cfg["ops_grace"].strftime("%Y-%m-%dT%H:%MZ"))
        else:
            lines.append("::warning::no forecast_skill_ops yet (pre-5e181f69 report); pages after "
                         "grace %s" % cfg["ops_grace"].strftime("%Y-%m-%dT%H:%MZ"))
    else:
        lines.append("skill ledger: ledgered=%s scored=%s pending=%s evicted_cap=%s"
                     % (ops.get("ledgered"), ops.get("scored"),
                        ops.get("pending_kept"), ops.get("pending_evicted_cap")))
        if (ops.get("pending_evicted_cap") or 0) > 0:
            code = max(code, RED)
            lines.append("::error::SKILL LEDGER EVICTING -- pending_evicted_cap=%s. The cap is "
                         "sized never to bind (30k vs 17,280 steady-state demand); it binding "
                         "means demand grew without a re-size. This is the precursor the 08-04 "
                         "outage never surfaced -- act before scoring dies, not after."
                         % ops.get("pending_evicted_cap"))
        if (ops.get("scored") or 0) == 0:
            if now > cfg["scored_grace"]:
                code = max(code, RED)
                lines.append("::error::SKILL LEDGER SCORED ZERO past the recovery window (%s) -- "
                             "every healthy pre-fan-out run scored >0. The instrument is dead "
                             "again; read the pending object's target spread first."
                             % cfg["scored_grace"].strftime("%Y-%m-%dT%H:%MZ"))
            else:
                lines.append("::warning::scored=0 -- inside the post-fix recovery window (until %s)"
                             % cfg["scored_grace"].strftime("%Y-%m-%dT%H:%MZ"))
    return code, lines


def evaluate_residual_history(rows, now):
    """Liveness of the append-only residual history (its first automated reader). Pure."""
    if rows is None:
        return REFUSED, ["::error::ARCHIVE READER BLIND -- credentials present but the residual "
                         "history segment would not load; cannot confirm retention is alive."]
    recent = [r for r in rows if (t := _parse_iso(r.get("buoy_time"))) and now - t <= timedelta(hours=48)]
    span = [t for r in rows if (t := _parse_iso(r.get("buoy_time")))]
    lines = ["residual history: %d rows this month, %d in trailing 48h, span %s -> %s"
             % (len(rows), len(recent),
                min(span).strftime("%m-%dT%H:%MZ") if span else "-",
                max(span).strftime("%m-%dT%H:%MZ") if span else "-")]
    if not recent:
        return RED, lines + [
            "::error::RESIDUAL RETENTION DEAD -- 0 rows added in 48h to an archive that gains "
            "~700/day. The daily roll-up (buoy_residual_retention) or the calibration loop "
            "stopped; every unretained day is unrecoverable."]
    return OK, lines


def evaluate_scored_segment(rows, now):
    """Report (not gate) per-source x lead skill over the trailing 7 days -- the scored archive's
    first automated reader. No accuracy gate yet ON PURPOSE: the only baseline predates the 08-04
    outage, and gating fresh post-fix data against a pre-outage frame would page on the weather.
    Revisit once ~2 weeks of post-fix rows exist (after ~2026-08-22)."""
    from services.weather_pipeline.forecast_skill import head_to_head, skill_summary
    if rows is None:
        return OK, ["scored segment: not readable (missing or no credentials) -- informational only"]
    week = [r for r in rows if (t := _parse_iso(r.get("target_time"))) and now - t <= timedelta(days=7)]
    lines = ["scored archive: %d rows this month, %d with targets in trailing 7d" % (len(rows), len(week))]
    for s in skill_summary(week):
        lines.append("  %-22s +%dh  n=%-5d mae=%.3f bias=%+.3f"
                     % (s["source"], s["lead_h"], s["n"], s["mae_m"], s["bias_m"]))

    # ⛔ THE COLUMN ABOVE IS PER-SOURCE, NOT A COMPARISON. Each source is summarised over its OWN
    # rows, so reading DOWN it compares different populations -- on 2026-08-10 that read said we
    # lose to persistence (0.268 vs 0.206) when the paired truth was the opposite (0.183 vs 0.206);
    # persistence had 374 rows over SEVEN target times against our 2,825 over 64. The table below
    # is the only one of the two that supports a "we lose" sentence.
    h2h = head_to_head(week)
    if h2h:
        lines.append("  -- PAIRED head-to-head (same buoy x target x lead; the comparable one) --")
        for c in h2h:
            skew = ""
            if c["n_paired"] < 0.5 * max(c["n_ours_total"], c["n_theirs_total"]):
                skew = "  [POPULATIONS DIVERGE: %d vs %d unpaired]" % (c["n_ours_total"], c["n_theirs_total"])
            lines.append("  vs %-19s +%dh  n=%-5d ours=%.3f theirs=%.3f delta=%+.3f win=%.0f%%  %s%s"
                         % (c["source"], c["lead_h"], c["n_paired"], c["mae_ours_m"],
                            c["mae_theirs_m"], c["delta_m"], 100.0 * c["win_rate"],
                            "WE LOSE" if c["we_lose"] else "we win", skew))
    return OK, lines


def _fetch_json(url, timeout=60):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "raw-surf-accuracy-monitor"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.load(r)
    except Exception as e:
        print("fetch failed: %s -> %s" % (url, e))
        return None


def _fetch_l2(key, timeout=30):
    """Storage REST GET mirroring buoy_calibration.load_calibration_l2 (stdlib, so this script
    stays runnable with no dependencies). Returns parsed JSON, or None."""
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    tok = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY", "")
    if not base or not tok:
        return None
    try:
        req = urllib.request.Request(
            "%s/storage/v1/object/weather-products/%s" % (base, key),
            headers={"Authorization": "Bearer %s" % tok, "apikey": tok})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.load(r)
    except Exception as e:
        print("L2 read failed: %s -> %s" % (key, e))
        return None


def main():
    ap = argparse.ArgumentParser()
    d = default_cfg()
    ap.add_argument("--base", default="https://raw-surf-antigravity.onrender.com")
    ap.add_argument("--red-mae", type=float, default=d["red_mae_m"])
    ap.add_argument("--warn-mae", type=float, default=d["warn_mae_m"])
    ap.add_argument("--min-n", type=int, default=d["min_n"])
    ap.add_argument("--max-report-age-h", type=float, default=d["max_report_age_h"])
    ap.add_argument("--ops-grace", default=OPS_GRACE_DEFAULT)
    ap.add_argument("--scored-grace", default=SCORED_GRACE_DEFAULT)
    args = ap.parse_args()
    cfg = {"red_mae_m": args.red_mae, "warn_mae_m": args.warn_mae, "min_n": args.min_n,
           "max_report_age_h": args.max_report_age_h,
           "ops_grace": _parse_iso(args.ops_grace) or d["ops_grace"],
           "scored_grace": _parse_iso(args.scored_grace) or d["scored_grace"]}
    now = datetime.now(timezone.utc)
    month = now.strftime("%Y-%m")

    report = _fetch_json(args.base.rstrip("/") + "/api/weather/buoy-calibration")
    code, lines = evaluate_report(report, now, cfg)
    print("\n".join(lines))

    has_creds = bool(os.environ.get("SUPABASE_URL")) and bool(
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY"))
    if has_creds:
        rc, rl = evaluate_residual_history(_fetch_l2("calibration/history/residuals-%s.json" % month), now)
        print("\n".join(rl))
        code = combine(code, rc)
        sc, sl = evaluate_scored_segment(_fetch_l2("calibration/skill/scored-%s.json" % month), now)
        print("\n".join(sl))
        code = combine(code, sc)
    else:
        print("archive readers skipped (no SUPABASE credentials) -- the report gates above still page")

    print("verdict: %s" % {OK: "OK", RED: "RED", REFUSED: "REFUSED (blind, not healthy)"}[code])
    return code


if __name__ == "__main__":
    sys.exit(main())
