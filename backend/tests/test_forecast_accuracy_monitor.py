"""The accuracy monitor must be able to GO RED — and must never be green while blind.

MASTER-AUDIT-11.0 SS3.7: 0 of 8 scheduled workflows could go red on a forecast-accuracy
regression, and the repo's own history is full of guards that could not fire (the sim parity
block validates wiring, the offload guard bans names not shapes). Every gate here is therefore
tested in BOTH directions: the healthy case passes AND the breach case fires. A monitor whose
red path is untested is the same theatre this audit exists to end."""
import json
from datetime import datetime, timedelta, timezone

from scripts.forecast_accuracy_monitor import (
    OK, RED, REFUSED, combine, default_cfg,
    evaluate_report, evaluate_residual_history, evaluate_scored_segment,
)

NOW = datetime(2026, 8, 20, 12, 0, tzinfo=timezone.utc)   # past both self-expiring grace dates
ARMED = datetime(2026, 8, 25, 12, 0, tzinfo=timezone.utc)  # past paired_grace 08-22 as well


def test_empty_scored_archive_refuses_after_grace():
    code, lines = evaluate_scored_segment([], ARMED)
    assert code == REFUSED
    assert any('UNMEASURED' in line for line in lines)


def test_no_pairs_respects_grace_and_disabled_gate():
    assert evaluate_scored_segment([], NOW)[0] == OK
    cfg = default_cfg()
    cfg['paired_gate'] = False
    assert evaluate_scored_segment([], ARMED, cfg=cfg)[0] == OK


def test_future_targets_do_not_count_as_scored_evidence():
    row = {'target_time': (ARMED + timedelta(days=1)).isoformat()}
    code, lines = evaluate_scored_segment([row], ARMED)
    assert code == REFUSED
    assert any('0 with targets' in line for line in lines)


def _report(mae=0.205, n=60, age_h=1.0, ops="healthy", available=True):
    r = {"available": available,
         "generated_at": (NOW - timedelta(hours=age_h)).isoformat(),
         "summary": {"height_mae_m": mae, "height_n": n, "height_bias_m": 0.028}}
    if ops == "healthy":
        r["forecast_skill_ops"] = {"ledgered": 720, "scored": 296,
                                   "pending_kept": 17280, "pending_evicted_cap": 0}
    elif isinstance(ops, dict):
        r["forecast_skill_ops"] = ops
    return r


def test_a_healthy_report_is_green():
    code, lines = evaluate_report(_report(), NOW, default_cfg())
    assert code == OK
    assert not any("::error::" in l for l in lines)


def test_an_mae_breach_goes_red_the_positive_control():
    """THE point of the monitor: a shipped-bad-constant regression (the +25.5% H110 class would
    roughly double MAE) must fire. If this test fails, the monitor is decoration."""
    code, lines = evaluate_report(_report(mae=0.45), NOW, default_cfg())
    assert code == RED
    assert any("ACCURACY RED" in l for l in lines)
    assert any("not a diagnosis" in l for l in lines)
    assert not any("not sea-state noise" in l for l in lines)


def test_the_warn_band_warns_without_paging():
    code, lines = evaluate_report(_report(mae=0.33), NOW, default_cfg())
    assert code == OK
    assert any("::warning::" in l and "warn band" in l for l in lines)


def test_a_thin_sample_REFUSES_instead_of_grading_weather():
    code, lines = evaluate_report(_report(n=12), NOW, default_cfg())
    assert code == REFUSED
    assert any("REFUSES" in l for l in lines)


def test_an_unreachable_report_is_blindness_not_health():
    for broken in (None, {}, {"available": False}):
        code, lines = evaluate_report(broken, NOW, default_cfg())
        assert code == REFUSED, f"{broken} must refuse, got {code}"
        assert any("BLIND" in l for l in lines)


def test_a_stale_report_pages_as_instrument_death():
    code, lines = evaluate_report(_report(age_h=11.0), NOW, default_cfg())
    assert code == RED
    assert any("UNMEASURED" in l for l in lines)


def test_cap_eviction_pages_before_scoring_dies():
    """The precursor the 08-04 outage never surfaced: the cap is sized never to bind, so any
    nonzero eviction count is demand growing without a re-size."""
    ops = {"ledgered": 720, "scored": 200, "pending_kept": 30000, "pending_evicted_cap": 41}
    code, lines = evaluate_report(_report(ops=ops), NOW, default_cfg())
    assert code == RED
    assert any("EVICTING" in l for l in lines)


def test_scored_zero_pages_after_the_recovery_window_and_not_inside_it():
    ops = {"ledgered": 720, "scored": 0, "pending_kept": 17280, "pending_evicted_cap": 0}
    cfg = default_cfg()
    inside = datetime(2026, 8, 10, 0, 0, tzinfo=timezone.utc)      # < scored_grace 08-12T06Z
    code_in, lines_in = evaluate_report(_report(ops=ops), inside, cfg)
    assert code_in == OK and any("recovery window" in l for l in lines_in)
    code_after, lines_after = evaluate_report(_report(ops=ops), NOW, cfg)
    assert code_after == RED and any("SCORED ZERO" in l for l in lines_after)


def test_a_missing_ops_block_pages_after_grace_and_warns_inside_it():
    cfg = default_cfg()
    inside = datetime(2026, 8, 9, 12, 0, tzinfo=timezone.utc)      # < ops_grace 08-10T12Z
    code_in, _ = evaluate_report(_report(ops=None), inside, cfg)
    assert code_in == OK
    code_after, lines_after = evaluate_report(_report(ops=None), NOW, cfg)
    assert code_after == RED and any("LEDGER DEAD" in l for l in lines_after)


def test_red_outranks_refused_outranks_ok():
    """Plain max() inverts the first pair (REFUSED=3 > RED=1) and would bury a measured breach
    under a side-channel read failure."""
    assert combine(RED, REFUSED) == RED
    assert combine(REFUSED, RED) == RED
    assert combine(OK, REFUSED) == REFUSED
    assert combine(OK, OK) == OK


def test_residual_history_liveness_both_directions():
    fresh = [{"buoy_id": "46012", "buoy_time": (NOW - timedelta(hours=h)).isoformat()}
             for h in (2, 6, 30)]
    stale = [{"buoy_id": "46012", "buoy_time": (NOW - timedelta(hours=80)).isoformat()}]
    assert evaluate_residual_history(fresh, NOW)[0] == OK
    code, lines = evaluate_residual_history(stale, NOW)
    assert code == RED and any("RETENTION DEAD" in l for l in lines)
    assert evaluate_residual_history(None, NOW)[0] == REFUSED     # creds present, read failed


def test_the_scored_segment_reader_still_reports_the_per_source_column():
    """Renamed from `..._and_never_gates` on 2026-08-12 (WS-CAN-0026). The old name pinned the
    DEFECT: the paired head-to-head was computed, printed, and graded by nothing, so the workflow
    printed `WE LOSE` eight times and exited 0. The per-source column below is still
    report-only -- it compares different populations and must never gate. What now gates is the
    PAIRED table, covered by the WS-CAN-0026 block at the end of this file."""
    rows = [{"source": "raw_surf", "buoy_id": "46012", "lead_h": 24.0, "err_m": 0.2,
             "hs_m": 1.2, "obs_hs_m": 1.0,
             "target_time": (NOW - timedelta(hours=6)).isoformat()}]
    code, lines = evaluate_scored_segment(rows, NOW)
    assert code == OK                     # one source alone => no pairing => nothing to grade
    assert any("raw_surf" in l and "+24h" in l for l in lines)
    assert evaluate_scored_segment(None, NOW)[0] == OK            # informational, creds-optional


# ---------------------------------------------------------------------------------------------
# WS-CAN-0026 -- THE PAIRED SKILL GATE
#
# The defect this closes, measured live on scheduled run 31606511901 (2026-08-12T14:23Z):
#   verdict: OK   ...while the same log printed
#   vs open_meteo_marine +24h n=1770 ours=0.181 theirs=0.143 delta=+0.038 win=41%  WE LOSE
#   vs persistence       +24h n=1790 ours=0.183 theirs=0.176 delta=+0.007 win=46%  WE LOSE
# Audit 11.1 named the corrective action on 2026-08-10 ("adding a persistence + Open-Meteo row to
# the RED criterion is still unstarted"); it was still unstarted 2026-08-12.
#
# Every gate is tested in BOTH directions, and T-POS is the POSITIVE CONTROL: without a fixture
# that must stay green, a criterion that always pages is indistinguishable from one that works.
# ---------------------------------------------------------------------------------------------

def _paired(source, n=800, ours=0.20, theirs=0.18, win=0.45, ours_total=None, theirs_total=None):
    """One row of `head_to_head` output, built to that function's exact contract."""
    return {"source": source, "lead_h": 24, "n_paired": n,
            "n_ours_total": ours_total if ours_total is not None else n,
            "n_theirs_total": theirs_total if theirs_total is not None else n,
            "mae_ours_m": ours, "mae_theirs_m": theirs, "delta_m": round(ours - theirs, 4),
            "win_rate": win, "we_lose": ours > theirs}


def test_T1_losing_to_persistence_must_not_exit_zero():
    """T1 -- TODAY'S PRODUCTION STATE. Persistence is the definitional skill floor: a forecast
    that cannot beat "tomorrow = today" is adding no value at that lead. Before this change the
    monitor printed exactly this and returned OK."""
    code, lines = evaluate_scored_segment([], ARMED, paired=[_paired("persistence",
                                          n=1790, ours=0.183, theirs=0.176, win=0.46)])
    assert code == RED, "the skill floor must page once armed"
    assert any("SKILL FLOOR" in l and "::error::" in l for l in lines)


def test_T1b_beating_persistence_is_green_the_positive_control():
    code, lines = evaluate_scored_segment([], ARMED, paired=[_paired("persistence",
                                          n=1036, ours=0.188, theirs=0.239, win=0.60)])
    assert code == OK
    assert not any("::error::" in l for l in lines)


def test_T1c_a_split_verdict_does_not_page__mae_and_win_rate_must_agree():
    """One storm can move an MAE and cannot move a win rate (head_to_head's own docstring). A row
    that loses on MAE while winning the majority of paired keys is sea state, not lost skill."""
    code, _ = evaluate_scored_segment([], ARMED, paired=[_paired("persistence",
                                      n=1790, ours=0.210, theirs=0.180, win=0.56)])
    assert code == OK


def test_T2_a_thin_pairing_REFUSES_it_does_not_silently_pass():
    """The house rule: a check that cannot tell "not sampled" from "agrees" must REFUSE. A thin
    persistence row leaves the skill floor UNMEASURED, which is blindness, not health."""
    code, lines = evaluate_scored_segment([], ARMED, paired=[_paired("persistence", n=12)])
    assert code == REFUSED
    assert any("REFUSES" in l or "UNMEASURED" in l for l in lines)


def test_T2b_no_persistence_row_at_all_REFUSES():
    """Absence of the baseline is the loudest form of not-sampled. It must never read as OK."""
    code, lines = evaluate_scored_segment([], ARMED, paired=[_paired("open_meteo_marine")])
    assert code == REFUSED
    assert any("SKILL FLOOR UNMEASURED" in l for l in lines)


def test_T3_the_public_reference_WARNS_on_the_standing_gap_and_REDS_on_a_material_widening():
    """The standing loss to Open-Meteo is a product condition, not an incident -- and Report 11.0
    named the failure mode of pretending otherwise: "a permanently-red calibration census is
    training red-blindness". So the level warns and the WIDENING pages."""
    standing = [_paired("open_meteo_marine", n=1770, ours=0.181, theirs=0.143, win=0.41)]
    code, lines = evaluate_scored_segment([], ARMED,
                                          paired=standing + [_paired("persistence", ours=0.18,
                                                                     theirs=0.20, win=0.55)])
    assert code == OK, "the standing gap must not page"
    assert any("::warning::" in l and "PUBLIC REFERENCE" in l for l in lines)

    blown = [_paired("open_meteo_marine", n=1770, ours=0.320, theirs=0.143, win=0.22)]
    code, lines = evaluate_scored_segment([], ARMED,
                                          paired=blown + [_paired("persistence", ours=0.18,
                                                                  theirs=0.20, win=0.55)])
    assert code == RED
    assert any("PUBLIC REFERENCE" in l and "::error::" in l for l in lines)


def test_T4_a_diverged_population_cannot_page_on_its_own():
    """`n_paired` far below either total is the exact condition that inverted the sign of this
    answer on 2026-08-10. Such a row is reported and never graded."""
    row = _paired("persistence", n=371, ours=0.227, theirs=0.278, win=0.63,
                  ours_total=1728, theirs_total=371)
    code, lines = evaluate_scored_segment([], ARMED, paired=[row])
    assert code == REFUSED          # diverged => ungradeable => the floor is unmeasured
    assert any("POPULATIONS DIVERGE" in l for l in lines)


def test_T5_our_own_alternate_lanes_are_informational_and_never_gate():
    """Losing to our own EURO lane is a MODEL-SELECTION question for the owner, not an accuracy
    incident. Gating on it would page on a decision nobody has taken."""
    rows = [_paired("raw_surf:EURO", n=1918, ours=0.184, theirs=0.168, win=0.43),
            _paired("raw_surf:ICON", n=1918, ours=0.184, theirs=0.314, win=0.70),
            _paired("persistence", ours=0.18, theirs=0.20, win=0.55)]
    code, lines = evaluate_scored_segment([], ARMED, paired=rows)
    assert code == OK
    assert not any("::error::" in l for l in lines)


def test_T6_the_gate_is_grace_dated_and_arms_itself():
    """Same self-expiring pattern the ops/scored graces already use: the file's own comment set the
    revisit at ~2026-08-22, so the date arms it, not a person's memory."""
    losing = [_paired("persistence", n=1790, ours=0.183, theirs=0.176, win=0.46)]
    inside = datetime(2026, 8, 15, 0, 0, tzinfo=timezone.utc)     # < paired_grace 08-22
    code_in, lines_in = evaluate_scored_segment([], inside, paired=losing)
    assert code_in == OK
    assert any("::warning::" in l and "SKILL FLOOR" in l for l in lines_in)
    assert evaluate_scored_segment([], ARMED, paired=losing)[0] == RED


def test_T7_the_kill_switch_restores_the_previous_behaviour_exactly():
    """This changes a PAGING criterion in production. It must be revocable at runtime."""
    losing = [_paired("persistence", n=1790, ours=0.183, theirs=0.176, win=0.46)]
    cfg = default_cfg()
    cfg["paired_gate"] = False
    code, lines = evaluate_scored_segment([], ARMED, paired=losing, cfg=cfg)
    assert code == OK
    assert not any("::error::" in l for l in lines)
    assert any("WE LOSE" in l for l in lines), "the table must still print when the gate is off"


def test_mismatched_observation_pairs_refuse_and_report_exclusions():
    target = (ARMED - timedelta(days=1)).isoformat()
    common = {"buoy_id": "B1", "target_time": target, "lead_h": 24,
              "hs_m": 1.0, "obs_time": target}
    rows = [{**common, "source": "raw_surf", "obs_hs_m": 1.0, "err_m": 0.0},
            {**common, "source": "persistence", "obs_hs_m": 2.0, "err_m": -1.0}]
    code, lines = evaluate_scored_segment(rows, ARMED)
    assert code == REFUSED
    assert any("1 mismatched observations" in line for line in lines)
    assert any("0 verified pairs" in line for line in lines)
    assert not any("we win" in line for line in lines)


def test_matching_observations_still_allow_the_real_skill_floor_verdict():
    target = (ARMED - timedelta(days=1)).isoformat()
    common = {"buoy_id": "B1", "target_time": target, "lead_h": 24,
              "obs_hs_m": 1.0, "obs_time": target}
    rows = [{**common, "source": "raw_surf", "hs_m": 1.1, "err_m": .1},
            {**common, "source": "persistence", "hs_m": 1.3, "err_m": .3}]
    cfg = default_cfg()
    cfg["paired_min_n"] = 1
    code, lines = evaluate_scored_segment(rows, ARMED, cfg=cfg)
    assert code == OK
    assert any("we win" in line for line in lines)


# ── LIVENESS ON THE ARCHIVE, NOT ON ONE PASS (2026-09-29, run 36533043356) ──────────────────────────────
# The 06:48Z page called a healthy ledger dead: its last two passes ran 34-37 min after the one before and had
# nothing new to score. Both directions are pinned: a zero pass with a fresh archive stays green, a stale archive
# pages, and an unreadable archive keeps the old single-pass rule so the monitor is never blinder than it was.
from scripts.forecast_accuracy_monitor import evaluate_scoring_liveness, scored_zero_verdict  # noqa: E402

_ZERO = {"ledgered": 1017, "scored": 0, "pending_kept": 24957, "pending_evicted_cap": 0}


def _rows(*hours_old):
    return [{"target_time": (NOW - timedelta(hours=h)).isoformat()} for h in hours_old]


def test_the_0648z_replay__a_zero_pass_with_the_archive_readable_does_not_page():
    cfg = {**default_cfg(), "liveness_from_archive": True}
    code, lines = evaluate_report(_report(ops=_ZERO), NOW, cfg)
    assert code == OK and not any("::error::" in l for l in lines)
    assert any("judged below on the scored archive" in l for l in lines)
    live_code, live = evaluate_scoring_liveness(_rows(1.5, 3, 30), _ZERO, NOW, cfg)
    assert live_code == OK and "1.5 h old" in live[0]


def test_a_stale_archive_pages_and_a_fresh_one_does_not__both_directions():
    cfg = default_cfg()
    assert evaluate_scoring_liveness(_rows(10.6), _ZERO, NOW, cfg)[0] == OK        # the worst healthy age
    code, lines = evaluate_scoring_liveness(_rows(16.5, 40), {"scored": 500}, NOW, cfg)
    assert code == RED and any("STOPPED SCORING" in l for l in lines)             # even if a pass says 500


def test_the_bound_is_the_measured_basis_and_is_tunable():
    cfg = default_cfg()
    assert cfg["scoring_stale_h"] == 16.0
    assert evaluate_scoring_liveness(_rows(12), None, NOW, {**cfg, "scoring_stale_h": 11})[0] == RED


def test_an_empty_archive_is_a_dead_ledger_not_a_quiet_one():
    code, lines = evaluate_scoring_liveness([], _ZERO, NOW, default_cfg())
    assert code == RED and any("NOT SCORING" in l for l in lines)


def test_future_targets_are_not_evidence_of_scoring():
    future = [{"target_time": (NOW + timedelta(hours=5)).isoformat()}]
    assert evaluate_scoring_liveness(future, _ZERO, NOW, default_cfg())[0] == RED


def test_an_unreadable_archive_falls_back_to_the_single_pass_rule():
    cfg = default_cfg()
    code, lines = evaluate_scoring_liveness(None, _ZERO, NOW, cfg)
    assert code == RED and any("SCORED ZERO" in l for l in lines) and "unreadable" in lines[0]
    assert evaluate_scoring_liveness(None, {"scored": 12}, NOW, cfg)[0] == OK
    assert scored_zero_verdict(_ZERO, datetime(2026, 8, 10, tzinfo=timezone.utc), cfg)[0] == OK   # grace


def test_without_credentials_the_report_keeps_the_old_rule():
    code, lines = evaluate_report(_report(ops=_ZERO), NOW, default_cfg())      # liveness_from_archive False
    assert code == RED and any("SCORED ZERO" in l for l in lines)


def test_main_reads_last_months_archive_across_a_month_boundary(monkeypatch, capsys):
    """00:30Z on the 1st: this month's archive is empty, last month's has a target scored 2.5 h ago."""
    import scripts.forecast_accuracy_monitor as fam
    now = datetime(2026, 10, 1, 0, 30, tzinfo=timezone.utc)
    report = {**_report(ops=_ZERO), "generated_at": (now - timedelta(hours=1)).isoformat()}
    l2 = {"calibration/skill/scored-2026-10.json": [],
          "calibration/skill/scored-2026-09.json": [{"target_time": (now - timedelta(hours=2.5)).isoformat()}],
          "calibration/history/residuals-2026-10.json": []}
    monkeypatch.setenv("SUPABASE_URL", "https://storage.example.invalid")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-not-a-key")
    monkeypatch.setattr(fam, "_fetch_json", lambda url, timeout=60: report)
    monkeypatch.setattr(fam, "_fetch_l2", lambda key, timeout=30: l2.get(key, fam.ABSENT))
    monkeypatch.setattr("sys.argv", ["forecast_accuracy_monitor.py", "--as-of", now.isoformat()])
    fam.main()
    out = capsys.readouterr().out
    assert "newest scored target 2026-09-30T22:00Z is 2.5 h old" in out
    assert "STOPPED SCORING" not in out and "NOT SCORING" not in out and "SCORED ZERO" not in out


# ---------------------------------------------------------------------------------------------
# THE MONTH SEAM (2026-10-02). The scored archive is keyed by month, the paired skill gate grades the
# TRAILING SEVEN DAYS, and `main` handed it only THIS month's file -- so for the first week of every
# month the gate saw a fraction of its window. Scheduled runs 36976044116 (06:57Z, 2026-10-02) said
# `skill floor +48h not gradeable: n_paired=56 < 200` -> REFUSED, one day after every run through
# 2026-09-30 was green on the same code. The liveness check already merged last month's file; the
# paired gate did not. Both directions: it must see last month INSIDE the first week, and must NOT
# fetch a 33 MB file for the other three weeks (the null control).
# ---------------------------------------------------------------------------------------------

def _pair_rows(n, first_target, tag):
    """`n` buoy-target keys for `raw_surf` and `persistence` carrying the same verifying observation;
    ours is the better forecast, so a graded floor reads `we win` (the positive control)."""
    rows = []
    for i in range(n):
        target = (first_target + timedelta(minutes=30 * i)).isoformat()
        for source, err in (("raw_surf", 0.15), ("persistence", 0.35)):
            rows.append({"source": source, "buoy_id": "%s%03d" % (tag, i % 40), "target_time": target,
                         "lead_h": 48.0, "err_m": err, "hs_m": 1.2, "obs_hs_m": 1.0, "obs_time": target})
    return rows


def _run_main_at(monkeypatch, capsys, now, l2):
    import scripts.forecast_accuracy_monitor as fam
    fetched = []
    report = {**_report(), "generated_at": (now - timedelta(hours=1)).isoformat()}

    def fake_l2(key, timeout=30):
        fetched.append(key)
        return l2.get(key, fam.ABSENT)      # an object that was never written answers "absent"; None = unreadable
    monkeypatch.setenv("SUPABASE_URL", "https://storage.example.invalid")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-not-a-key")
    monkeypatch.setattr(fam, "_fetch_json", lambda url, timeout=60: report)
    monkeypatch.setattr(fam, "_fetch_l2", fake_l2)
    monkeypatch.setattr("sys.argv", ["forecast_accuracy_monitor.py", "--as-of", now.isoformat()])
    fam.main()
    return capsys.readouterr().out, fetched


def test_the_paired_gate_sees_last_month_inside_the_first_week(monkeypatch, capsys):
    now = datetime(2026, 10, 2, 7, 0, tzinfo=timezone.utc)
    l2 = {"calibration/skill/scored-2026-10.json": _pair_rows(28, now - timedelta(hours=20), "O"),
          "calibration/skill/scored-2026-09.json": _pair_rows(260, datetime(2026, 9, 26, 0, 0, tzinfo=timezone.utc), "S"),
          "calibration/history/residuals-2026-10.json": []}
    out, fetched = _run_main_at(monkeypatch, capsys, now, l2)
    assert "calibration/skill/scored-2026-09.json" in fetched
    assert "SKILL FLOOR UNMEASURED" not in out and "not gradeable" not in out, out
    assert any(l.startswith("  vs persistence") and "+48h" in l and "we win" in l for l in out.splitlines()), out


def test_the_paired_gate_does_not_fetch_last_month_after_the_first_week(monkeypatch, capsys):
    """THE NULL CONTROL: mid-month the window lies wholly inside this month's file, so the 33 MB
    previous-month object must not be downloaded (nothing downstream would read it)."""
    now = datetime(2026, 10, 20, 7, 0, tzinfo=timezone.utc)
    l2 = {"calibration/skill/scored-2026-10.json": _pair_rows(260, now - timedelta(days=6), "O"),
          "calibration/skill/scored-2026-09.json": _pair_rows(5, datetime(2026, 9, 26, tzinfo=timezone.utc), "S"),
          "calibration/history/residuals-2026-10.json": []}
    out, fetched = _run_main_at(monkeypatch, capsys, now, l2)
    assert "calibration/skill/scored-2026-09.json" not in fetched, fetched
    assert any(l.startswith("  vs persistence") and "we win" in l for l in out.splitlines()), out


# ---------------------------------------------------------------------------------------------
# DAY OBJECTS (2026-10-16). `scored-2026-10.json` reached Storage's 50 MiB object limit and 49 ledger passes
# failed on it, so from October new scored rows are one object per UTC day and the monthly object is frozen.
# The monitor must read the frozen month AND the days, and keep the rule it had: an object it could not read
# is a blind archive (REFUSED), never an empty one. A missing day object is normal; an unreadable one is not.
# ---------------------------------------------------------------------------------------------

def test_liveness_sees_rows_scored_into_day_objects(monkeypatch, capsys):
    now = datetime(2026, 10, 20, 7, 0, tzinfo=timezone.utc)
    l2 = {"calibration/skill/scored-2026-10.json": [{"target_time": datetime(2026, 10, 10, tzinfo=timezone.utc).isoformat()}],
          "calibration/skill/scored-2026-10-20.json": [{"target_time": (now - timedelta(hours=2)).isoformat()}],
          "calibration/history/residuals-2026-10.json": []}
    out, _ = _run_main_at(monkeypatch, capsys, now, l2)
    assert "newest scored target 2026-10-20T05:00Z is 2.0 h old" in out, out
    assert "STOPPED SCORING" not in out


def test_an_unreadable_day_object_is_blind_not_quiet(monkeypatch, capsys):
    now = datetime(2026, 10, 20, 7, 0, tzinfo=timezone.utc)
    l2 = {"calibration/skill/scored-2026-10.json": [{"target_time": (now - timedelta(hours=2)).isoformat()}],
          "calibration/skill/scored-2026-10-20.json": None,          # None = the read failed
          "calibration/history/residuals-2026-10.json": []}
    out, _ = _run_main_at(monkeypatch, capsys, now, l2)
    # The line that only prints when the rows are UNREAD (not merely few): the combined verdict is RED here
    # because this fixture's empty residual history is RED, and RED outranks REFUSED.
    assert "scored segment: not readable" in out, out


def test_a_month_with_only_day_objects_grades_normally(monkeypatch, capsys):
    """From November there is no monthly object. Its absence must not blind the monitor."""
    now = datetime(2026, 11, 20, 7, 0, tzinfo=timezone.utc)
    l2 = {"calibration/skill/scored-2026-11-15.json": _pair_rows(260, now - timedelta(days=5), "N"),
          "calibration/skill/scored-2026-11-20.json": [{"target_time": (now - timedelta(hours=2)).isoformat()}],
          "calibration/history/residuals-2026-11.json": []}
    out, _ = _run_main_at(monkeypatch, capsys, now, l2)
    assert "REFUSED" not in out and "UNMEASURED" not in out and "STOPPED SCORING" not in out, out
    assert any(l.startswith("  vs persistence") and "we win" in l for l in out.splitlines()), out


def test_a_pre_switch_month_with_no_monthly_object_is_still_blind(monkeypatch, capsys):
    """September's archive is one frozen object; if it is gone, that is a lost archive, not a quiet month."""
    now = datetime(2026, 9, 20, 7, 0, tzinfo=timezone.utc)
    out, _ = _run_main_at(monkeypatch, capsys, now, {"calibration/history/residuals-2026-09.json": []})
    assert "scored segment: not readable" in out, out


def _http_error(code, body):
    import io
    import urllib.error
    return urllib.error.HTTPError("https://storage.example.invalid/x", code, "err", {},
                                  io.BytesIO(json.dumps(body).encode()))


NO_SUCH_KEY = {"statusCode": "404", "code": "NoSuchKey", "error": "not_found", "message": "Object not found"}


def test_fetch_l2_tells_an_absent_object_from_an_unreadable_one(monkeypatch):
    import urllib.error
    import scripts.forecast_accuracy_monitor as fam
    monkeypatch.setenv("SUPABASE_URL", "https://storage.example.invalid")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-not-a-key")
    unreadable = [
        _http_error(503, {}),
        _http_error(400, {"statusCode": "400", "code": "InvalidJWT", "message": "Invalid JWT"}),
        _http_error(400, {"statusCode": "404", "code": "NoSuchBucket", "error": "Bucket not found"}),
        urllib.error.URLError("synthetic connection failure"),
    ]

    def answer(exc):
        def urlopen(req, timeout=30):
            raise exc
        monkeypatch.setattr(fam.urllib.request, "urlopen", urlopen)
        return fam._fetch_l2("calibration/skill/scored-2026-10-20.json")

    assert answer(_http_error(400, NO_SUCH_KEY)) is fam.ABSENT
    assert [answer(exc) for exc in unreadable] == [None] * len(unreadable)


def _assert_loaded_archive_label_with_verdict(ours, theirs, win, expected):
    from scripts import forecast_accuracy_monitor as monitor

    now = datetime(2026, 10, 3, 23, 0, tzinfo=timezone.utc)
    rows = [
        {'source': 'raw_surf', 'buoy_id': 'fixture_a', 'lead_h': 24, 'hs_m': 1.2,
         'obs_hs_m': 1.0, 'err_m': 0.2, 'target_time': '2026-09-30T23:00:00Z'},
        {'source': 'raw_surf', 'buoy_id': 'fixture_b', 'lead_h': 24, 'hs_m': 1.2,
         'obs_hs_m': 1.0, 'err_m': 0.2, 'target_time': '2026-10-03T22:00:00Z'},
        {'source': 'raw_surf', 'buoy_id': 'fixture_c', 'lead_h': 24, 'hs_m': 1.2,
         'obs_hs_m': 1.0, 'err_m': 0.2, 'target_time': '2026-10-04T00:00:00Z'},
    ]
    code, lines = monitor.evaluate_scored_segment(
        rows, now, paired=[_paired('persistence', ours=ours, theirs=theirs, win=win)])
    assert code == expected
    assert lines[0] == 'scored archive: 3 rows loaded, 2 with targets in trailing 7d'


def test_two_month_archive_label_preserves_healthy_verdict():
    _assert_loaded_archive_label_with_verdict(0.1, 0.2, 0.7, OK)


def test_two_month_archive_label_preserves_measured_loss_verdict():
    _assert_loaded_archive_label_with_verdict(0.3, 0.2, 0.3, RED)


# ---------------------------------------------------------------------------------------------
# THE CONSENSUS CONSTRUCTION CONTROL (2026-10-17). The BUILT shadow lane (raw_surf:CONSENSUS) is DEFINED as the equal
# GFS/EURO/ICON mean the ledger computes, and `forecast_skill_consensus.shadow.by_lead[*].shadow_minus_equal_m` is that
# definition's own check. On the pass of 2026-10-16T23:20Z it read median 0.003 m at +24 h and 0.126 / 0.132 m at +48 / +72 h
# (docs/weather-program/log/2026-10-17-served-height-gap.md, Table 7c), and nothing graded the +48/+72 h reads: the control
# was only ever read at +24 h. This gate WARNS, never pages (a product-readiness fact, not an incident), and a missing or
# thin read is an explicit NOT MEASURED line, never silence.
# ---------------------------------------------------------------------------------------------
import pytest  # noqa: E402
from pathlib import Path  # noqa: E402

from scripts.forecast_accuracy_monitor import _parse_iso, evaluate_consensus_construction  # noqa: E402
from services.weather_pipeline.skill_consensus import MEMBERS, SHADOW, shadow_report  # noqa: E402

LIVE = ((24, 2712, 0.003, -0.007), (48, 2784, 0.126, 0.093), (72, 2863, 0.132, 0.084))   # Table 7c: lead, n, median, bias
GRACE = datetime(2026, 11, 15, tzinfo=timezone.utc)
AFTER_GRACE = GRACE + timedelta(seconds=1)


def _lead_entry(lead_h, median, n=2800, bias=0.09, **over):
    """One `shadow.by_lead` entry in skill_consensus.shadow_report's exact shape (its keys, not invented ones)."""
    return {"lead_h": lead_h, "n": n, "status": "scored",
            "shadow": {"mae_m": 0.3, "bias_m": bias}, "equal": {"mae_m": 0.28, "bias_m": -0.03},
            "served": {"mae_m": 0.3, "bias_m": -0.1},
            "shadow_minus_equal_m": {"median": median, "p90": 0.4},
            "shadow_over_served": {"p10": 0.9, "median": 1.1, "p90": 1.6}, "shadow_beats_served": False, **over}


def _consensus_report(*entries):
    return {**_report(), "forecast_skill_consensus": {"members": list(MEMBERS), "by_lead": [], "shadow": {
        "source": SHADOW, "members": list(MEMBERS), "holdout_days": 7, "by_lead": list(entries), "by_region": {}}}}


def _live(order=1):
    return _consensus_report(*[_lead_entry(lead, med, n, bias) for lead, n, med, bias in LIVE[::order]])


def _gate(report, now=NOW, **cfg):
    """Lines of the gate. Every call also pins the invariants: it never pages or refuses, and no line can break out of
    a GitHub workflow command (a '%' or a newline)."""
    code, lines = evaluate_consensus_construction(report, now, {**default_cfg(), **cfg})
    assert code == OK, "WARN only: this control must never page or refuse"
    assert all("%" not in l and "\n" not in l and "\r" not in l for l in lines), lines
    return lines


def _gaps(lines):
    return [l for l in lines if l.startswith("::warning::consensus construction GAP")]


def _not_measured(lines):
    return [l for l in lines if l.startswith("::warning::consensus construction: NOT MEASURED (")]


def test_the_live_case_warns_at_48_and_72_and_not_at_24():
    lines = _gate(_live())
    gaps = _gaps(lines)
    assert len(gaps) == 2 and "+48h" in gaps[0] and "+72h" in gaps[1] and "0.126 m" in gaps[0] and "0.132 m" in gaps[1]
    assert "consensus construction +24h: median |shadow - equal| 0.003 m (n 2,712), shadow bias -0.007 m [basis: " in lines[0]
    assert any(l.startswith("consensus construction +48h: median |shadow - equal| 0.126 m (n 2,784), shadow bias "
                            "+0.093 m [basis: ") and "warn above 0.020 m" in l for l in lines)
    assert not _not_measured(lines) and _gate(_live(order=-1)) == lines          # the order of the leads is not the output's


def test_a_correct_build_is_quiet_the_positive_control():
    lines = _gate(_consensus_report(_lead_entry(24, 0.003), _lead_entry(48, 0.004), _lead_entry(72, 0.005)))
    assert len(lines) == 3 and not any(l.startswith("::") for l in lines)


def test_the_gate_reads_the_producers_own_output():
    """Rows -> skill_consensus.shadow_report -> the gate: pins the key names against the code that writes them."""
    def ledger(lead_h, offset, n=250):
        rows = []
        for i in range(n):
            key = {"buoy_id": "46%03d" % i, "lead_h": lead_h, "obs_hs_m": 1.0,
                   "target_time": (NOW - timedelta(hours=1 + i % 100)).isoformat()}
            hs = {"raw_surf": 1.0, "raw_surf:ICON": 1.3, "raw_surf:EURO": 1.1}
            rows += [{**key, "source": s, "hs_m": h} for s, h in hs.items()]
            rows.append({**key, "source": SHADOW, "hs_m": sum(hs.values()) / 3 + offset})
        return rows
    report = {**_report(), "forecast_skill_consensus": {"shadow": shadow_report(ledger(24, 0.0) + ledger(48, 0.126), NOW)}}
    lines = _gate(report)
    assert len(_gaps(lines)) == 1 and "+48h" in _gaps(lines)[0]
    assert any(l.startswith("consensus construction +24h: median |shadow - equal| 0.000 m (n 250)") for l in lines)


@pytest.mark.parametrize("report", [
    None, _report(), {**_report(), "forecast_skill_consensus": "garbage"},
    {**_report(), "forecast_skill_consensus": {"by_lead": []}},                       # no shadow block
    _consensus_report(),                                                              # shadow block, no leads
    {**_report(), "forecast_skill_consensus": {"shadow": {"by_lead": {"24": 1}}}},    # by_lead is not a list
], ids=["no-report", "no-block", "garbage-block", "no-shadow", "no-leads", "by-lead-not-a-list"])
def test_an_absent_block_is_NOT_MEASURED_never_silent(report):
    lines = _gate(report)
    assert len(lines) == 1 and _not_measured(lines)


def test_thin_leads_are_not_graded_and_the_gate_says_NOT_MEASURED():
    lines = _gate(_consensus_report(_lead_entry(24, 0.5, n=150), _lead_entry(48, 0.6, n=199),
                                    {"lead_h": 72, "n": 5, "status": "insufficient"}))
    assert not _gaps(lines) and len(_not_measured(lines)) == 1 and "200" in _not_measured(lines)[0]
    assert sum("not graded" in l for l in lines) == 3


def test_a_thin_lead_beside_a_graded_one_is_not_a_blind_gate():
    lines = _gate(_consensus_report(_lead_entry(24, 0.5, n=150), _lead_entry(48, 0.126)))
    assert len(_gaps(lines)) == 1 and "+48h" in _gaps(lines)[0] and not _not_measured(lines)


@pytest.mark.parametrize("median, n, warns", [(0.020, 200, False), (0.021, 200, True), (0.5, 200, True), (0.5, 199, False)])
def test_the_boundaries_are_strict_on_the_gap_and_inclusive_on_n(median, n, warns):
    lines = _gate(_consensus_report(_lead_entry(48, median, n=n)))
    assert bool(_gaps(lines)) is warns and bool(_not_measured(lines)) is (n == 199)


def test_the_thresholds_are_tunable():
    assert not _gaps(_gate(_live(), consensus_construction_warn_m=0.2))
    assert _not_measured(_gate(_live(), consensus_construction_min_n=5000))


def test_the_defaults_are_the_pinned_basis(monkeypatch):
    monkeypatch.delenv("ACCURACY_CONSENSUS_CONSTRUCTION", raising=False)
    cfg = default_cfg()
    assert (cfg["consensus_construction"], cfg["consensus_construction_warn_m"], cfg["consensus_construction_min_n"],
            cfg["consensus_construction_grace"]) == (True, 0.02, 200, GRACE)


def test_the_grace_expires_by_date_and_stays_a_warning():
    """Self-expiring like the other graces, but nothing here ever becomes a RED: a level that has held since the first
    rows would be the permanently-red workflow Report 11.0 named. After the date the WARN says so, and still only warns."""
    for now in (NOW, GRACE):                                  # on the instant itself the grace still holds
        gaps = _gaps(_gate(_live(), now=now))
        assert len(gaps) == 2 and all("grace until 2026-11-15T00:00Z" in g and "expired" not in g for g in gaps)
    gaps = _gaps(_gate(_live(), now=AFTER_GRACE))
    assert len(gaps) == 2 and all("grace expired 2026-11-15T00:00Z" in g for g in gaps)


@pytest.mark.parametrize("value, enabled", [("0", False), ("1", True), ("", True), ("false", True), (" 0", True)])
def test_the_kill_switch_is_the_exact_string_zero(monkeypatch, value, enabled):
    monkeypatch.setenv("ACCURACY_CONSENSUS_CONSTRUCTION", value)
    cfg = default_cfg()
    assert cfg["consensus_construction"] is enabled
    assert (evaluate_consensus_construction(_live(), NOW, cfg)[1] == []) is (not enabled)


def test_the_kill_switch_removes_every_line_including_NOT_MEASURED(monkeypatch):
    monkeypatch.setenv("ACCURACY_CONSENSUS_CONSTRUCTION", "0")
    assert evaluate_consensus_construction(_report(), NOW, default_cfg()) == (OK, [])


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), -0.01, True, "0.5", None], ids=repr)
def test_an_unusable_median_is_never_read_as_a_pass(bad):
    lines = _gate(_consensus_report(_lead_entry(48, bad)))
    assert not _gaps(lines) and len(_not_measured(lines)) == 1


@pytest.mark.parametrize("bad_n", [True, "2800", 2800.5, None, -1], ids=repr)
def test_an_unusable_n_is_never_graded(bad_n):
    lines = _gate(_consensus_report(_lead_entry(48, 0.5, n=bad_n)), consensus_construction_min_n=1)   # any accepted n would grade
    assert not _gaps(lines) and len(_not_measured(lines)) == 1


def test_report_text_never_reaches_the_log():
    """The block is aggregate and only numbers are printed: a hostile label or lead cannot inject a workflow command."""
    hostile = "24\n::error::pwned 100%"
    lines = _gate(_consensus_report(_lead_entry(hostile, 0.5), _lead_entry(24, None, status=hostile),
                                    _lead_entry(48, 0.126, status=hostile, source=hostile)))
    assert "pwned" not in "\n".join(lines) and len(_gaps(lines)) == 1


def _main(monkeypatch, capsys, report, *argv, env=None):
    import scripts.forecast_accuracy_monitor as fam
    for k in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_KEY", "ACCURACY_CONSENSUS_CONSTRUCTION"):
        monkeypatch.delenv(k, raising=False)
    for k, v in (env or {}).items():
        monkeypatch.setenv(k, v)
    monkeypatch.setattr(fam, "_fetch_json", lambda url, timeout=60: report)
    monkeypatch.setattr("sys.argv", ["forecast_accuracy_monitor.py", "--as-of", NOW.isoformat(), *argv])
    code = fam.main()
    return code, capsys.readouterr().out


def test_main_prints_the_lines_and_the_exit_code_stays_green(monkeypatch, capsys):
    code, out = _main(monkeypatch, capsys, _live())
    assert code == OK and "verdict: OK" in out
    assert out.count("::warning::consensus construction GAP") == 2 and out.count("consensus construction +") >= 3


@pytest.mark.parametrize("argv, env, expect", [
    (("--consensus-construction-warn-m", "0.2"), None, lambda o: "GAP" not in o and "warn above 0.200 m" in o),
    (("--consensus-construction-min-n", "5000"), None, lambda o: "NOT MEASURED" in o and "GAP" not in o),
    (("--consensus-construction-grace", "2026-01-01"), None, lambda o: "grace expired 2026-01-01T00:00Z" in o),
    ((), {"ACCURACY_CONSENSUS_CONSTRUCTION": "0"}, lambda o: "consensus construction" not in o),
], ids=["warn-m", "min-n", "grace", "kill-switch"])
def test_main_wires_every_flag_into_the_gate(monkeypatch, capsys, argv, env, expect):
    code, out = _main(monkeypatch, capsys, _live(), *argv, env=env)
    assert code == OK and expect(out), out


def test_main_says_NOT_MEASURED_when_the_report_has_no_block(monkeypatch, capsys):
    code, out = _main(monkeypatch, capsys, _report())
    assert code == OK and out.count("::warning::consensus construction: NOT MEASURED (") == 1


def test_the_workflow_wires_the_variables_and_its_defaults_are_the_scripts():
    yml = (Path(__file__).resolve().parents[2] / ".github" / "workflows" / "forecast-accuracy-monitor.yml").read_text(encoding="utf-8")
    cfg = default_cfg()
    assert "ACCURACY_CONSENSUS_CONSTRUCTION: ${{ vars.ACCURACY_CONSENSUS_CONSTRUCTION || '1' }}" in yml
    for flag, var, default, expect in (
            ("--consensus-construction-warn-m", "ACCURACY_CONSENSUS_CONSTRUCTION_WARN_M", "0.02", cfg["consensus_construction_warn_m"]),
            ("--consensus-construction-min-n", "ACCURACY_CONSENSUS_CONSTRUCTION_MIN_N", "200", cfg["consensus_construction_min_n"]),
            ("--consensus-construction-grace", "ACCURACY_CONSENSUS_CONSTRUCTION_GRACE", "2026-11-15T00:00:00Z", cfg["consensus_construction_grace"])):
        assert '%s "${{ vars.%s || \'%s\' }}"' % (flag, var, default) in yml
        assert (_parse_iso(default) if "grace" in flag else type(expect)(default)) == expect
