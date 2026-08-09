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


def test_the_scored_segment_reader_reports_and_never_gates():
    rows = [{"source": "raw_surf", "buoy_id": "46012", "lead_h": 24.0, "err_m": 0.2,
             "hs_m": 1.2, "obs_hs_m": 1.0,
             "target_time": (NOW - timedelta(hours=6)).isoformat()}]
    code, lines = evaluate_scored_segment(rows, NOW)
    assert code == OK
    assert any("raw_surf" in l and "+24h" in l for l in lines)
    assert evaluate_scored_segment(None, NOW)[0] == OK            # informational, creds-optional
