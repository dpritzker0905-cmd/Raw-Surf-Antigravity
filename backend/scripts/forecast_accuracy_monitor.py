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

WS-CAN-0026 (2026-08-12) -- THE PAIRED SKILL GATE, and why it was missing for two days. The paired
head-to-head table has been computed and printed since 60f724d0 and graded by NOTHING: scheduled
run 31606511901 printed "WE LOSE" eight times -- including against the persistence baseline -- and
exited 0, because the only gate was absolute MAE (0.176 m vs a 0.40 m bound). Audit 11.1 named the
corrective action on 2026-08-10 ("adding a persistence + Open-Meteo row to the RED criterion is
still unstarted"); it was still unstarted on 08-12. See evaluate_scored_segment for the three
severities and why they differ. THE MARGIN IS NOT TUNED TO PASS: the skill floor sits at 0.0 and
the operational rule requires MAE and win rate to agree. This is not a significance test.

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
SCORING_STALE_H_DEFAULT = 16.0                 # newest scored target older than this = dead (2026-09-29)
# WS-CAN-0026: this file's own §evaluate_scored_segment docstring set the revisit at "~2026-08-22"
# (~2 weeks of post-fix rows). That date now ARMS the gate instead of reminding a person to.
PAIRED_GRACE_DEFAULT = "2026-08-22T00:00:00Z"
PAIRED_WINDOW_DAYS = 7      # the paired gate's trailing window (`evaluate_scored_segment`'s `week`)

# WHICH COMPARISONS MAY PAGE, AND WHY THEY DIFFER (WS-CAN-0026, 2026-08-12)
#   persistence  = THE SKILL FLOOR. "Tomorrow = today" is the reference every operational centre
#                  scores against; a lane that cannot beat it at a lead is adding no value there.
#                  That is a correctness statement about our own forecast, so it PAGES.
#   public refs  = a COMPETITIVE statement, not a correctness one. We have lost to Open-Meteo
#                  continuously since at least 08-10, so gating on the LEVEL would ship a
#                  permanently-red workflow -- and Report 11.0 named that failure mode exactly:
#                  "a permanently-red calibration census is training red-blindness". The level
#                  therefore WARNS on every run and the WIDENING pages.
#   raw_surf:*   = our own alternate lanes. Losing to our own EURO lane is a MODEL-SELECTION
#                  question for the owner, not an accuracy incident. Informational only.
SKILL_FLOOR_SOURCES = ("persistence",)
PUBLIC_REFERENCE_SOURCES = ("open_meteo_marine", "open_meteo:ncep_gfswave025")


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
        # --- WS-CAN-0026, the paired skill gate ---
        # Kill switch: ACCURACY_PAIRED_GATE=0 restores the pre-2026-08-12 behaviour exactly
        # (table printed, nothing graded). This changes a PAGING criterion in production.
        "paired_gate": os.environ.get("ACCURACY_PAIRED_GATE", "1") != "0",
        "paired_grace": _parse_iso(PAIRED_GRACE_DEFAULT),
        # A comparison thinner than this is weather, not skill -- the same reasoning as min_n,
        # scaled to paired keys (measured 2026-08-12: the live rows carry n_paired 371..1963).
        "paired_min_n": 200,
        # THE SKILL FLOOR IS THE SIGN, NOT A TUNED NUMBER. 0.0 = any real loss to persistence
        # counts under this operational rule. Agreement does not remove sample dependence;
        # do not inflate the margin until today's data passes.
        "paired_persistence_margin_m": 0.0,
        # BASIS, stated so a re-tune has provenance: the largest public-reference gap ever recorded
        # is +0.081 m (Audit 11.1, 2026-08-10, n=714..799) and it has since narrowed to +0.063 m
        # (2026-08-12, n=1678..1796). 0.10 is ~1.24x the worst observed -- the same method this
        # file already uses for red_mae_m (2x the p50, 49% over the observed max).
        # ⚠️ This accepts the STANDING gap on purpose. It does not hide it: every losing reference
        # row emits a ::warning:: on every run.
        "paired_reference_margin_m": 0.10,
        # Liveness on the scored archive (2026-09-29): see evaluate_scoring_liveness for the measured basis.
        "scoring_stale_h": SCORING_STALE_H_DEFAULT,
        "liveness_from_archive": False,     # main() sets it when the archive is readable
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
                     "This is an observed threshold breach, not a diagnosis of its cause. "
                     "Compare matched buoy/time/source cohorts and deployment identity before "
                     "attributing it to model constants or sea-state changes." % (mae, cfg["red_mae_m"]))
    elif mae > cfg["warn_mae_m"]:
        lines.append("::warning::height MAE %.3f m exceeds the %.2f m warn band (observed max "
                     "0.269). Repeated warnings require investigation; they do not establish cause."
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
        from services.weather_pipeline.forecast_skill import PENDING_MAX_ENTRIES
        if (ops.get('pending_kept') or 0) > 0.85 * PENDING_MAX_ENTRIES:
            lines.append('::warning::SKILL PENDING CAPACITY -- pending=%s exceeds 85%% of cap=%s.'
                         % (ops['pending_kept'], PENDING_MAX_ENTRIES))
        if (ops.get("pending_evicted_cap") or 0) > 0:
            code = max(code, RED)
            lines.append("::error::SKILL LEDGER EVICTING -- pending_evicted_cap=%s. The cap is "
                         "sized never to bind (30k vs 17,280 steady-state demand); it binding "
                         "means demand grew without a re-size. This is the precursor the 08-04 "
                         "outage never surfaced -- act before scoring dies, not after."
                         % ops.get("pending_evicted_cap"))
        if (ops.get("scored") or 0) == 0:
            if cfg.get("liveness_from_archive"):
                # ONE PASS IS NOT A LIVENESS SIGNAL (2026-09-29). With the archive readable, the verdict is the
                # age of the newest scored target, graded by evaluate_scoring_liveness.
                lines.append("::warning::the latest ledger pass scored 0 -- a pass run minutes after another "
                             "legitimately scores 0; liveness is judged below on the scored archive")
            else:
                zc, zl = scored_zero_verdict(ops, now, cfg)
                code = max(code, zc)
                lines.append(zl)
    return code, lines


def scored_zero_verdict(ops, now, cfg):
    """The single-pass rule, kept for when the archive cannot be read (no credentials, or the read failed):
    then one zero-score pass is the only signal there is. Pure."""
    if (ops or {}).get("scored") or 0:
        return OK, "latest ledger pass scored %s" % ops.get("scored")
    if now > cfg["scored_grace"]:
        return RED, ("::error::SKILL LEDGER SCORED ZERO past the recovery window (%s) -- "
                     "every healthy pre-fan-out run scored >0. The instrument is dead "
                     "again; read the pending object's target spread first."
                     % cfg["scored_grace"].strftime("%Y-%m-%dT%H:%MZ"))
    return OK, ("::warning::scored=0 -- inside the post-fix recovery window (until %s)"
                % cfg["scored_grace"].strftime("%Y-%m-%dT%H:%MZ"))


def evaluate_scoring_liveness(rows, ops, now, cfg):
    """(code, lines): is the skill ledger still SCORING? Judged on the newest scored target in the archive, not
    on the latest pass. Pure.

    WHY (2026-09-29, run 36533043356). This monitor paged RED whenever the LATEST ledger pass scored 0. A pass
    scores a forecast once its buoy observation is in, so a pass run minutes after another has nothing new to
    score. Measured that night, scored vs the gap since the previous pass: 1,282 at 3 h, 36 at 66 min, 651 at
    42 min, 105 at 38 min, 0 at 34 min, 0 at 37 min, then 1,005 at 11:57Z. The 06:48Z page said "the instrument
    is dead" while it was healthy, and back-to-back precomputes (one per `dev` merge since #150) make that the
    common case. A permanently red monitor trains red-blindness.
    THE RULE. Dead = no scored target newer than `scoring_stale_h` (default 16 h). BASIS, measured over the 14
    days to 2026-09-29 (127 successful calibration passes, precompute + core ingest): the gap between passes was
    p50 2.0 h, p90 5.2 h, p99 7.1 h, max 8.6 h; with ~2 h for the observation to arrive the worst healthy age is
    ~10.6 h, and 16 h is ~1.5x that (the method this file uses for red_mae_m and the reference margin). A real
    death is detected within 16 h plus one monitor slot.
    `rows` None (archive unreadable) falls back to the single-pass rule, so the monitor is never blinder than it
    was. Near a month boundary the caller passes the previous month's rows too."""
    if rows is None:
        code, line = scored_zero_verdict(ops, now, cfg)
        return code, ["skill ledger liveness: scored archive unreadable -- falling back to the single-pass rule",
                      line]
    targets = [t for r in rows if (t := _parse_iso(r.get("target_time"))) and t <= now]
    if not targets:
        return RED, ["::error::SKILL LEDGER NOT SCORING -- the scored archive holds no scored target at or "
                     "before now. The instrument is dead (or was never alive); read the pending object's "
                     "target spread first."]
    newest = max(targets)
    age_h = (now - newest).total_seconds() / 3600.0
    line = ("skill ledger liveness: newest scored target %s is %.1f h old (pages past %.0f h)"
            % (newest.strftime("%Y-%m-%dT%H:%MZ"), age_h, cfg["scoring_stale_h"]))
    if age_h > cfg["scoring_stale_h"]:
        return RED, [line, "::error::SKILL LEDGER STOPPED SCORING -- no target scored in %.1f h (bound %.0f h, "
                           "~1.5x the worst healthy age measured). The instrument is dead again; read the "
                           "pending object's target spread first." % (age_h, cfg["scoring_stale_h"])]
    return OK, [line]


def evaluate_residual_history(rows, now):
    """Liveness of the append-only residual history (its first automated reader). Pure."""
    if rows is None:
        return REFUSED, ["::error::ARCHIVE READER BLIND -- credentials present but the residual "
                         "history segment would not load; cannot confirm retention is alive."]
    recent = [r for r in rows if (t := _parse_iso(r.get("buoy_time"))) and now - t <= timedelta(hours=48)]
    span = [t for r in rows if (t := _parse_iso(r.get("buoy_time")))]
    lines = ["residual history: %d archive rows loaded, %d in trailing 48h, span %s -> %s"
             % (len(rows), len(recent),
                min(span).strftime("%m-%dT%H:%MZ") if span else "-",
                max(span).strftime("%m-%dT%H:%MZ") if span else "-")]
    if not recent:
        return RED, lines + [
            "::error::RESIDUAL RETENTION DEAD -- 0 rows added in 48h to an archive that gains "
            "~700/day. The daily roll-up (buoy_residual_retention) or the calibration loop "
            "stopped; every unretained day is unrecoverable."]
    return OK, lines


def _gradeable(c, cfg):
    """Can this paired row carry a verdict? Returns (ok, reason).

    Two independent ways a row is ungradeable, and NEITHER may read as agreement:
      thin      -- n_paired below the floor is weather, not skill (same reasoning as min_n).
      diverged  -- n_paired far below either total means the populations differ, which is the
                   EXACT condition that inverted the sign of this answer on 2026-08-10. Reported
                   by the printer since then; now it also disqualifies the row from grading."""
    if c["n_paired"] < cfg["paired_min_n"]:
        return False, "n_paired=%d < %d" % (c["n_paired"], cfg["paired_min_n"])
    if c["n_paired"] < 0.5 * max(c["n_ours_total"], c["n_theirs_total"]):
        return False, "POPULATIONS DIVERGE (%d paired vs %d/%d totals)" % (
            c["n_paired"], c["n_ours_total"], c["n_theirs_total"])
    return True, ""


def _loses(c, margin):
    """Operational loss criterion. Correlated observations can move both statistics together;
    agreement alone is not proof of statistical significance."""
    return c["delta_m"] > margin and c["win_rate"] < 0.50


def evaluate_scored_segment(rows, now, paired=None, cfg=None):
    """Per-source x lead skill over the trailing 7 days, AND (WS-CAN-0026) the gate on the paired
    head-to-head table.

    ⛔ WHAT THIS FUNCTION USED TO DO, AND WHY IT CHANGED (2026-08-12). It computed the paired
    comparison, printed it, and returned OK unconditionally -- its docstring deferred gating to
    "~2026-08-22". The deferral was sound (you cannot calibrate a threshold on 3.4 days of
    post-outage rows) and its CONSEQUENCE was not: scheduled run 31606511901 printed `WE LOSE`
    eight times and exited 0, including against the persistence floor. Audit 11.1 named the fix on
    2026-08-10; it was still unstarted on 08-12.
    Both concerns are now honoured at once -- the criterion exists TODAY and its RED is
    grace-dated to the file's own 08-22 revisit, so the date arms it rather than a person.

    `paired` injects head_to_head output (tests); production computes it from `rows`."""
    from services.weather_pipeline.forecast_skill import head_to_head, skill_summary
    cfg = cfg or default_cfg()
    armed = cfg["paired_gate"] and now > cfg["paired_grace"]
    if rows is None:
        # Creds-optional by design -- but once the gate is armed, "the archive would not load" means
        # the skill floor is UNMEASURED, and blind is never green (it is REFUSED, not RED).
        line = "scored segment: not readable (missing or no credentials)"
        return (REFUSED, ["::error::SKILL FLOOR UNMEASURED -- " + line + " and the paired gate is "
                          "armed. This is refusal, not health."]) if armed else \
               (OK, [line + " -- informational only"])
    week = [r for r in rows if (t := _parse_iso(r.get("target_time")))
            and timedelta(0) <= now - t <= timedelta(days=PAIRED_WINDOW_DAYS)]
    lines = ["scored archive: %d rows loaded, %d with targets in trailing 7d" % (len(rows), len(week))]
    for s in skill_summary(week):
        lines.append("  %-22s +%dh  n=%-5d mae=%.3f bias=%+.3f"
                     % (s["source"], s["lead_h"], s["n"], s["mae_m"], s["bias_m"]))

    # ⛔ THE COLUMN ABOVE IS PER-SOURCE, NOT A COMPARISON. Each source is summarised over its OWN
    # rows, so reading DOWN it compares different populations -- on 2026-08-10 that read said we
    # lose to persistence (0.268 vs 0.206) when the paired truth was the opposite (0.183 vs 0.206);
    # persistence had 374 rows over SEVEN target times against our 2,825 over 64. The table below
    # is the only one of the two that supports a "we lose" sentence -- and the only one that gates.
    pair_diagnostics = {}
    h2h = head_to_head(week, diagnostics=pair_diagnostics) if paired is None else paired
    for rejected in pair_diagnostics.get("comparisons", []):
        if rejected["n_observation_mismatch"] or rejected["n_observation_missing"]:
            lines.append("  vs %s +%dh observation pairing: %d target matches, %d verified pairs, "
                         "%d mismatched observations, %d missing observation identities" % (
                             rejected["source"], rejected["lead_h"], rejected["n_target_matched"],
                             rejected["n_paired"], rejected["n_observation_mismatch"],
                             rejected["n_observation_missing"]))
    if pair_diagnostics.get("invalid_error_rows"):
        lines.append("  excluded %d rows with missing/non-finite errors" % pair_diagnostics["invalid_error_rows"])
    if not h2h:
        return (REFUSED if armed else OK), lines + [
            ("::error::" if armed else "::warning::")
            + "SKILL FLOOR UNMEASURED -- no paired comparisons in the trailing 7 d."]
    lines.append("  -- PAIRED head-to-head (same buoy x target x lead AND verifying observation) --")
    for c in h2h:
        skew = ""
        if c["n_paired"] < 0.5 * max(c["n_ours_total"], c["n_theirs_total"]):
            skew = "  [POPULATIONS DIVERGE: %d vs %d unpaired]" % (c["n_ours_total"], c["n_theirs_total"])
        lines.append("  vs %-19s +%dh  n=%-5d ours=%.3f theirs=%.3f delta=%+.3f win=%.0f%%  %s%s"
                     % (c["source"], c["lead_h"], c["n_paired"], c["mae_ours_m"],
                        c["mae_theirs_m"], c["delta_m"], 100.0 * c["win_rate"],
                        "WE LOSE" if c["we_lose"] else "we win", skew))
    if not cfg["paired_gate"]:
        return OK, lines + ["::warning::paired skill gate DISABLED (ACCURACY_PAIRED_GATE=0) -- the "
                            "table above is printed and graded by nothing."]

    def _sev(msg):
        """Grace-dated severity, the same self-expiring pattern as the ops/scored gates."""
        if armed:
            return RED, "::error::" + msg
        return OK, "::warning::" + msg + " [pages after %s]" % cfg["paired_grace"].strftime("%Y-%m-%dT%H:%MZ")

    code = OK
    # --- the SKILL FLOOR: absence of a verdict here is blindness, not health -------------------
    floor = [c for c in h2h if c["source"] in SKILL_FLOOR_SOURCES]
    graded = [c for c in floor if _gradeable(c, cfg)[0]]
    for c in floor:
        ok, why = _gradeable(c, cfg)
        if not ok:
            lines.append("  (skill floor +%dh not gradeable: %s)" % (c["lead_h"], why))
    if not graded:
        code = combine(code, REFUSED)
        lines.append("::error::SKILL FLOOR UNMEASURED -- no gradeable `persistence` comparison in "
                     "the trailing 7 d (%d row(s) present, 0 gradeable). A monitor that cannot "
                     "tell 'we beat the trivial baseline' from 'nobody checked' must REFUSE."
                     % len(floor))
    for c in sorted((c for c in graded if _loses(c, cfg["paired_persistence_margin_m"])),
                    key=lambda c: c["lead_h"]):
        sev, msg = _sev(
            "SKILL FLOOR BREACHED at +%dh -- we lose to `%s` on n=%d paired keys: MAE %.3f vs "
            "%.3f (delta %+.3f m) AND win rate %.0f%% < 50%%. This breaches the operational "
            "skill floor; correlated observations mean these statistics alone do not establish "
            "significance." % (c["lead_h"], c["source"], c["n_paired"], c["mae_ours_m"],
                       c["mae_theirs_m"], c["delta_m"], 100.0 * c["win_rate"]))
        code = combine(code, sev)
        lines.append(msg)

    # --- the PUBLIC REFERENCE: the level warns, the WIDENING pages -----------------------------
    refs = [c for c in h2h if c["source"] in PUBLIC_REFERENCE_SOURCES and _gradeable(c, cfg)[0]]
    for c in sorted((c for c in refs if _loses(c, 0.0)), key=lambda c: (c["source"], c["lead_h"])):
        if c["delta_m"] > cfg["paired_reference_margin_m"]:
            sev, msg = _sev(
                "PUBLIC REFERENCE GAP WIDENED at +%dh -- `%s` beats us by %+.3f m on n=%d, past "
                "the %.2f m bound (~1.24x the worst gap ever recorded, +0.081 m on 2026-08-10). "
                "The standing gap is accepted; this size of gap is a regression."
                % (c["lead_h"], c["source"], c["delta_m"], c["n_paired"],
                   cfg["paired_reference_margin_m"]))
            code = combine(code, sev)
            lines.append(msg)
        else:
            lines.append("::warning::PUBLIC REFERENCE ahead at +%dh -- `%s` beats us by %+.3f m "
                         "on n=%d (win rate %.0f%%). Standing product condition, deliberately not "
                         "a page: it has held since 2026-08-10 and a permanently-red workflow "
                         "trains red-blindness. Pages at %+.3f m."
                         % (c["lead_h"], c["source"], c["delta_m"], c["n_paired"],
                            100.0 * c["win_rate"], cfg["paired_reference_margin_m"]))
    return code, lines


def _fetch_json(url, timeout=60):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "raw-surf-accuracy-monitor"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.load(r)
    except Exception as e:
        print("fetch failed: %s -> %s" % (url, e))
        return None


_L2_OBJECT_BYTES = {}
_L2_READ_FAILURES = set()


def _fetch_l2(key, timeout=30):
    """Storage REST GET mirroring buoy_calibration.load_calibration_l2 (stdlib, so this script
    stays runnable with no dependencies). Returns parsed JSON, or None."""
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    tok = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY", "")
    if not base or not tok:
        return None
    _L2_READ_FAILURES.discard(key)
    try:
        req = urllib.request.Request(
            "%s/storage/v1/object/weather-products/%s" % (base, key),
            headers={"Authorization": "Bearer %s" % tok, "apikey": tok})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            from services.weather_pipeline.skill_archive_codec import decode_archive
            content = r.read()
            _L2_OBJECT_BYTES[key] = len(content)
            rows = decode_archive(content)
            if not isinstance(rows, list):
                raise ValueError('archive is not a row list')
            return rows
    except urllib.error.HTTPError as error:
        from types import SimpleNamespace
        from services.weather_pipeline.l2_retry import is_missing_object
        try:
            body = json.loads(error.read())
        except (ValueError, OSError):
            body = None
        if is_missing_object(SimpleNamespace(status_code=error.code, json=lambda: body)):
            return None
        _L2_READ_FAILURES.add(key)
        print('L2 read failed: %s -> HTTP %s' % (key, error.code))
        return None
    except Exception as e:
        _L2_READ_FAILURES.add(key)
        print("L2 read failed: %s -> %s" % (key, e))
        return None


def main():
    _L2_OBJECT_BYTES.clear()
    _L2_READ_FAILURES.clear()
    ap = argparse.ArgumentParser()
    d = default_cfg()
    ap.add_argument("--base", default="https://raw-surf-antigravity.onrender.com")
    ap.add_argument("--red-mae", type=float, default=d["red_mae_m"])
    ap.add_argument("--warn-mae", type=float, default=d["warn_mae_m"])
    ap.add_argument("--min-n", type=int, default=d["min_n"])
    ap.add_argument("--max-report-age-h", type=float, default=d["max_report_age_h"])
    ap.add_argument("--ops-grace", default=OPS_GRACE_DEFAULT)
    ap.add_argument("--scored-grace", default=SCORED_GRACE_DEFAULT)
    # WS-CAN-0026 -- same tunable-with-printed-basis contract as the MAE bounds above.
    ap.add_argument("--paired-grace", default=PAIRED_GRACE_DEFAULT)
    ap.add_argument("--paired-min-n", type=int, default=d["paired_min_n"])
    ap.add_argument("--paired-persistence-margin", type=float,
                    default=d["paired_persistence_margin_m"])
    ap.add_argument("--paired-reference-margin", type=float,
                    default=d["paired_reference_margin_m"])
    ap.add_argument("--scoring-stale-h", type=float, default=d["scoring_stale_h"])
    ap.add_argument("--as-of", default=None, help="Grade as if it were this UTC instant "
                    "(replay/dry-run only; does not change what is read).")
    args = ap.parse_args()
    cfg = {"red_mae_m": args.red_mae, "warn_mae_m": args.warn_mae, "min_n": args.min_n,
           "max_report_age_h": args.max_report_age_h,
           "ops_grace": _parse_iso(args.ops_grace) or d["ops_grace"],
           "scored_grace": _parse_iso(args.scored_grace) or d["scored_grace"],
           "paired_gate": d["paired_gate"],
           "paired_grace": _parse_iso(args.paired_grace) or d["paired_grace"],
           "paired_min_n": args.paired_min_n,
           "paired_persistence_margin_m": args.paired_persistence_margin,
           "paired_reference_margin_m": args.paired_reference_margin,
           "scoring_stale_h": args.scoring_stale_h}
    now = _parse_iso(args.as_of) or datetime.now(timezone.utc)
    if args.as_of:
        print("::warning::REPLAY MODE -- grading as of %s, not now. Not a live verdict." % now)
    month = now.strftime("%Y-%m")

    has_creds = bool(os.environ.get("SUPABASE_URL")) and bool(
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY"))
    cfg["liveness_from_archive"] = has_creds      # the archive, not one pass, then judges scoring liveness
    report = _fetch_json(args.base.rstrip("/") + "/api/weather/buoy-calibration")
    code, lines = evaluate_report(report, now, cfg)
    print("\n".join(lines))

    if has_creds:
        month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        prev_month = (month_start - timedelta(days=1)).strftime('%Y-%m')
        residual_key = 'calibration/history/residuals-%s.json' % month
        residual_rows = _fetch_l2(residual_key)
        if residual_key not in _L2_READ_FAILURES and now - month_start < timedelta(hours=24):
            prev_residual_key = 'calibration/history/residuals-%s.json' % prev_month
            previous = _fetch_l2(prev_residual_key)
            if prev_residual_key in _L2_READ_FAILURES or (previous is None and residual_rows is None):
                residual_rows = None
            else:
                residual_rows = (previous or []) + (residual_rows or [])
        rc, rl = evaluate_residual_history(residual_rows, now)
        print("\n".join(rl))
        code = combine(code, rc)
        scored_key = "calibration/skill/scored-%s.json" % month
        scored_rows = _fetch_l2(scored_key)
        from services.weather_pipeline.skill_archive_codec import archive_size_warning
        size_warning = archive_size_warning(scored_key, _L2_OBJECT_BYTES.get(scored_key))
        if size_warning:
            print(size_warning)
        # THE MONTH SEAM (2026-10-02): the archive is keyed by month but the paired gate grades the
        # TRAILING SEVEN DAYS, so for the first week of a month its window reaches into last month's
        # file. Handing it this month's alone read `n_paired=56 < 200` -> REFUSED on 2026-10-02, a
        # day after every run was green. Fetched ONLY inside that week: the object is ~33 MB.
        window_rows = scored_rows
        if scored_key not in _L2_READ_FAILURES and now - month_start < timedelta(days=PAIRED_WINDOW_DAYS):
            prev_key = "calibration/skill/scored-%s.json" % prev_month
            previous_rows = _fetch_l2(prev_key)
            window_rows = None if prev_key in _L2_READ_FAILURES else (previous_rows or []) + (scored_rows or [])
        sc, sl = evaluate_scored_segment(window_rows, now, cfg=cfg)
        print("\n".join(sl))
        code = combine(code, sc)
        # Liveness keeps its own, shorter seam, unchanged: last month counts only until a fresh
        # scored target is expected in this one.
        live_rows = window_rows if (scored_key not in _L2_READ_FAILURES and now - month_start < timedelta(
            hours=cfg["scoring_stale_h"] + 24)) else scored_rows
        ops = report.get("forecast_skill_ops") if isinstance(report, dict) else None
        lc, ll = evaluate_scoring_liveness(live_rows, ops, now, cfg)
        print("\n".join(ll))
        code = combine(code, lc)
    else:
        print("archive readers skipped (no SUPABASE credentials) -- the report gates above still page")

    print("verdict: %s" % {OK: "OK", RED: "RED", REFUSED: "REFUSED (blind, not healthy)"}[code])
    return code


if __name__ == "__main__":
    sys.exit(main())
