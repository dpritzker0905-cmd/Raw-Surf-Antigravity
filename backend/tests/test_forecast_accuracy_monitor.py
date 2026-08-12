"""The accuracy monitor must be able to GO RED — and must never be green while blind.

MASTER-AUDIT-11.0 SS3.7: 0 of 8 scheduled workflows could go red on a forecast-accuracy
regression, and the repo's own history is full of guards that could not fire (the sim parity
block validates wiring, the offload guard bans names not shapes). Every gate here is therefore
tested in BOTH directions: the healthy case passes AND the breach case fires. A monitor whose
red path is untested is the same theatre this audit exists to end."""
from datetime import datetime, timedelta, timezone

from scripts.forecast_accuracy_monitor import (
    OK, RED, REFUSED, combine, default_cfg,
    evaluate_report, evaluate_residual_history, evaluate_scored_segment,
)

NOW = datetime(2026, 8, 20, 12, 0, tzinfo=timezone.utc)   # past both self-expiring grace dates
ARMED = datetime(2026, 8, 25, 12, 0, tzinfo=timezone.utc)  # past paired_grace 08-22 as well


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
