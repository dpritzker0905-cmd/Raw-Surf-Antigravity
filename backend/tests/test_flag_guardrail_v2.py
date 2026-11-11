"""The live guardrail's statistics V2, what it can see, and its controls (2026-11-11, offline and synthetic).

* V2 statistics (guardrail_stats): the Politis-White block is arch 8.0.0's to 1e-12; the t CDF is exact; the
  fixed-smoothing (EWC) DM decides with the circular-bootstrap CI; MSE and CRPS are reported; the kill switch
  GUARDRAIL_STATS_V2=0 is the old rule; the measured AR(1) false-WORSE rate is pinned.
* Coverage (flag_guardrail): every guarded flag says what can see it; a BLIND flag is never replayed (it would read
  NO_CHANGE as the baseline) and is reported BLIND, not "none".
* Controls: the recorded negative control (no exposure) is struck then disabled; the recorded positive control
  (H1/10) is left alone; synthetic analogues at the recorded effect sizes give the same verdicts.
"""
import json
import math
import os
import random
import sys
from datetime import datetime, timedelta, timezone

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "scripts"))

import flag_guardrail as fg  # noqa: E402
import guardrail_null_rate as nr  # noqa: E402
from services import runtime_flags as rf  # noqa: E402
from services.weather_pipeline import guardrail_stats as gs  # noqa: E402

T0 = datetime(2026, 10, 1, tzinfo=timezone.utc)
STATIONS = {"a": {"id": "a", "lat": 33.0, "lng": -117.3}, "b": {"id": "b", "lat": 37.8, "lng": -122.6}}
CONTROLS = json.load(open(os.path.join(HERE, "fixtures", "guardrail_controls_2026-11-11.json"), encoding="utf-8"))

# arch 8.0.0 `_single_optimal_block` circular lengths for AR(1) series drawn below (random.Random(7), unit gaussian).
ARCH_CB = {(0.0, 28): 1.180403580824364, (0.0, 84): 0.23675714046037444, (0.0, 200): 1.9529416805512692,
           (0.0, 600): 0.32897409247025594, (0.3, 28): 10.0, (0.3, 84): 0.8423422181805462,
           (0.3, 200): 5.426707794631343, (0.3, 600): 6.589689224975837, (0.5, 28): 10.0,
           (0.5, 84): 3.6528062513899378, (0.5, 200): 10.01742739195486, (0.5, 600): 8.926363295969455,
           (0.7, 28): 3.133859425384399, (0.7, 84): 10.142652213771093, (0.7, 200): 17.69030384810516,
           (0.7, 600): 13.898615107107744, (0.9, 28): 9.968820809476869, (0.9, 84): 10.764761363409551,
           (0.9, 200): 22.800416890801586, (0.9, 600): 28.41515873899225, (0.95, 28): 2.0664888364250174,
           (0.95, 84): 11.966449035549665, (0.95, 200): 20.054556057486543, (0.95, 600): 38.11514585375569}
# scipy stats.t.cdf reference values (computed with scipy, not typed)
T_CDF = [(-2.5, 3, 0.04385332350403278), (1.9, 5, 0.9420683479493359), (0.0, 1, 0.5),
         (4.0, 17, 0.9995363970135895), (-1.0, 40, 0.16166090587414556)]


@pytest.fixture(autouse=True)
def _v2(monkeypatch):
    monkeypatch.delenv("GUARDRAIL_STATS_V2", raising=False)


def ar1_draws():
    rng = random.Random(7)
    out = {}
    for rho in (0.0, 0.3, 0.5, 0.7, 0.9, 0.95):
        for n in (28, 84, 200, 600):
            x, prev = [], 0.0
            for _ in range(n):
                prev = rho * prev + rng.gauss(0, 1)
                x.append(prev)
            out[(rho, n)] = x
    return out


def items(gain=0.0, n_hours=80, noise=0.08, rho=0.5, seed=1):
    """Pairs at two buoys whose per-hour differential is AR(1) noise + gain (gain > 0 = ON closer)."""
    rng = random.Random(seed)
    d = nr.ar1(rng, n_hours, rho, noise)
    out = []
    for h, e in enumerate(d):
        t = T0 + timedelta(hours=12 * h)
        for b in ("a", "b"):
            out.append({"t": t, "buoy": b, "lead": 24, "obs": 1.0, "f_ref": 1.4, "f_cand": 1.4 - (gain + e)})
    return out


# ---- V2 statistics ----------------------------------------------------------------------------------------------
def test_the_block_is_arch_politis_white_to_machine_precision():
    for key, x in ar1_draws().items():
        assert gs.optimal_block(x) == pytest.approx(ARCH_CB[key], abs=1e-9), key


@pytest.mark.parametrize("t,nu,want", T_CDF)
def test_the_t_cdf_is_scipy_s(t, nu, want):
    assert gs.t_cdf(t, nu) == pytest.approx(want, abs=1e-9)


def test_v2_member_decides_by_fixed_smoothing_and_reports_mse_crps_and_block():
    m = gs.two_way(items(gain=-0.05))
    assert m["testable"] and m["test"].startswith("fixed-smoothing DM (EWC")
    assert m["ewc_nu"] == gs.ewc_nu(m["T"]) and m["hac_lag"] >= m["block"] >= 1
    assert m["mse"]["on"] > m["mse"]["off"] and m["crps"]["on"] == m["on_mae"]
    assert m["dm_p_worse"] is not None and m["p_worse"] < 0.05


def test_the_kill_switch_is_the_old_rule(monkeypatch):
    monkeypatch.setenv("GUARDRAIL_STATS_V2", "0")
    m = gs.two_way(items(gain=-0.05))
    assert "test" not in m and "mse" not in m and m["testable"]


def test_the_measured_ar1_false_worse_rate_is_pinned():
    """The published number (`scripts/guardrail_null_rate.py`, evidence 2026-11-11-guardrail-null-rate.json), small:
    at rho 0.5 over 56 hours V2 stays near its 5% size and below V1; at rho 0.9 it stays below V1 (still high: named)."""
    def rate(rule, rho):
        return nr.rate(rule, rho, 56, 0.0, sims=120, reps=200, seed=20261111)["rate"]
    v2_mid, v1_mid = rate("v2", 0.5), rate("v1", 0.5)
    assert v2_mid <= 0.06 and v2_mid <= v1_mid + 0.02
    assert rate("v2", 0.9) <= rate("v1", 0.9)


@pytest.mark.parametrize("seed", [3, 4, 5])
def test_v2_still_finds_real_harm_and_real_gain(seed):
    assert gs.verdict(items(gain=-0.08, noise=0.05, seed=seed), STATIONS)["verdict"] == gs.WORSE
    assert gs.verdict(items(gain=+0.08, noise=0.05, seed=seed), STATIONS)["verdict"] == gs.BETTER


# ---- controls ---------------------------------------------------------------------------------------------------
def _result(member):
    worse = member["p_worse_holm"] < gs.ALPHA and member["ci"][1] < -member["margin"]
    better = member["p_better_holm"] < gs.ALPHA and member["ci"][0] > member["margin"]
    v = gs.WORSE if worse else (gs.BETTER if better else gs.NOT_WORSE)
    return {"verdict": v, "reasons": [f"recorded hb_proxy pooled: gain {member['mean_gain']:.3f} m"], "sanity": []}


def test_the_recorded_negative_control_is_struck_then_disabled(monkeypatch):
    monkeypatch.setitem(rf.GUARDED, "SURF_V3_EXPOSURE", "1")
    r = _result(CONTROLS["negative"]["hb_proxy"])
    assert r["verdict"] == gs.WORSE
    now = T0
    d1 = fg.decide("SURF_V3_EXPOSURE", r, fg.empty_manifest(), "v", now)
    assert d1["action"] == "strike"
    m = dict(fg.empty_manifest(), watch={"SURF_V3_EXPOSURE": d1["watch"]})
    d2 = fg.decide("SURF_V3_EXPOSURE", r, m, "v", now + timedelta(hours=fg.STRIKE_SPAN_H))
    assert d2["action"] == "disable" and d2["entry"]["state"] == "off"


def test_the_recorded_positive_control_is_left_alone(monkeypatch):
    monkeypatch.setitem(rf.GUARDED, "SURF_HEIGHT_H110", "1")
    r = _result(CONTROLS["positive"]["hb_proxy"])
    assert r["verdict"] == gs.BETTER
    assert fg.decide("SURF_HEIGHT_H110", r, fg.empty_manifest(), "v", T0)["action"] == "none"


def _noise_like(member, rho):
    """The marginal s.d. of AR(1)(rho) differentials whose mean has the recorded CI's standard error, x 1.5
    (conservative): SE = half-width / 1.96; long-run s.d. = SE sqrt(T); marginal = long-run / sqrt((1+rho)/(1-rho))."""
    se = (member["ci"][1] - member["ci"][0]) / (2 * 1.96)
    return 1.5 * se * math.sqrt(member["T"]) / math.sqrt((1 + rho) / (1 - rho))


@pytest.mark.parametrize("seed", [11, 12, 13, 14, 15])
def test_synthetic_controls_at_the_recorded_effect_sizes(seed):
    """Recorded effects: negative -0.103 m, positive +0.265 m (hb_proxy pooled, T 40). Rebuilt on AR(1) rho 0.7
    differentials at 1.5x the uncertainty the recorded CIs imply: the verdicts must match the real runs."""
    n, p = CONTROLS["negative"]["hb_proxy"], CONTROLS["positive"]["hb_proxy"]
    neg = gs.verdict(items(gain=n["mean_gain"], n_hours=n["T"], noise=_noise_like(n, 0.7), rho=0.7, seed=seed),
                     STATIONS)
    pos = gs.verdict(items(gain=p["mean_gain"], n_hours=p["T"], noise=_noise_like(p, 0.7), rho=0.7, seed=seed),
                     STATIONS)
    assert neg["verdict"] == gs.WORSE
    assert pos["verdict"] != gs.WORSE and pos["verdict"] == gs.BETTER


# ---- coverage -----------------------------------------------------------------------------------------------------
def test_every_guarded_flag_says_what_can_see_it():
    missing = [f for f in rf.GUARDED if fg.coverage(f) is None]
    assert not missing, f"declare COVERAGE in flag_guardrail.py for {missing}"


def test_a_blind_flag_is_never_replayed_and_reads_blind(monkeypatch):
    calls = []

    def replay(flag, ctx):
        calls.append((flag, ctx))
        return {"flag": flag, "verdict": "SKIPPED" if ctx is None else gs.NO_CHANGE, "reasons": [], "sanity": []}

    out = fg.score_flags(["SURF_NEARSHORE_MOP", "SURF_TIDE_DEPTH"], T0, "cache", "out",
                         stage=lambda *a, **k: {"ctx": 1}, replay=replay)
    assert ("SURF_NEARSHORE_MOP", None) in calls and ("SURF_TIDE_DEPTH", {"ctx": 1}) in calls
    mop = out["SURF_NEARSHORE_MOP"]
    assert mop["coverage"] == fg.BLIND and mop["verdict"] == gs.UNTESTABLE and mop["reasons"][0].startswith("BLIND")
    assert "nearshore-validation.yml" in mop["reasons"][0]
    assert "inert in this window" in " ".join(out["SURF_TIDE_DEPTH"]["reasons"])


def test_a_nearshore_only_worse_strikes(monkeypatch):
    """hs_station cannot see a breaking-height regression; hb_proxy can, and WORSE on either strikes."""
    import default_on_filter as dof
    assert dof.combine(gs.NO_CHANGE, gs.WORSE) == gs.WORSE
    r = {"verdict": dof.combine(gs.NO_CHANGE, gs.WORSE), "reasons": ["hb_proxy: worse"], "sanity": []}
    assert fg.decide("SURF_TIDE_DEPTH", r, fg.empty_manifest(), "v", T0)["action"] == "strike"


def test_the_report_names_blind_flags_and_per_quantity_verdicts():
    report = {"mode": "dry-run", "decisions": {"SURF_NEARSHORE_MOP": {"action": "none", "reason": "UNTESTABLE"},
                                               "SURF_TIDE_DEPTH": {"action": "none", "reason": "NO_CHANGE"}},
              "results": {"SURF_NEARSHORE_MOP": {"coverage": fg.BLIND},
                          "SURF_TIDE_DEPTH": {"coverage": fg.REPLAY,
                                              "quantities": {"hs_station": {"verdict": "NO_CHANGE"},
                                                             "hb_proxy": {"verdict": "NO_CHANGE"}},
                                              "rating_census": {"n": 960, "score_changed": 0, "level_changed": 0}}}}
    md = fg.markdown(report)
    assert "| `SURF_NEARSHORE_MOP` | blind |" in md and "BLIND to the replay" in md
    assert "| `SURF_TIDE_DEPTH` | NO_CHANGE | NO_CHANGE |" in md


def test_the_null_rate_script_needs_no_network(monkeypatch):
    import socket
    monkeypatch.setattr(socket, "socket", lambda *a, **k: (_ for _ in ()).throw(AssertionError("network")))
    r = nr.rate("v2", 0.5, 28, 0.0, sims=5, reps=50, seed=1)
    assert r["sims"] == 5 and 0.0 <= r["rate"] <= 1.0 and not math.isnan(r["mc_se"])
