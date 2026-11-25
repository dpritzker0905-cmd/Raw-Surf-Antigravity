"""tide-mllw-tester-v1 (gates/tide-mllw-tester-v1.md, amendments s10-s12): the datum-only tester for SURF_TIDE_MLLW_US.

T1 / T2 are D-090 rule 2's two tests through flag_guardrail.decide() (two WORSE builds >= 24 h apart disable; a breach
disables at once). T3 pins the transitions and every pre-registered boundary. T4's machinery runs on a synthetic set
(the gate's real-table T4 runs in the job). T5 the network guard, T6 the kill switch. Also the build's am_lp self-check
(the advisor's carry (ii)) and the frozen station list's shape."""
import json
import math
import os
import sys
from datetime import datetime, timedelta, timezone

import pytest

from scripts import flag_guardrail as fg
from scripts import flag_guardrail_tide_datum as TDG
from services import runtime_flags as rf

HERE = os.path.dirname(os.path.abspath(__file__))
for sub in ("tide_datum", "tide_own", "tide_fes"):
    sys.path.insert(0, os.path.join(HERE, "..", "scripts", sub))
import mllw_tester_core as C  # noqa: E402
import mllw_tester_run as R  # noqa: E402
import mllw_lp as ML  # noqa: E402

FLAG = "SURF_TIDE_MLLW_US"
NOW = datetime(2026, 12, 1, 12, tzinfo=timezone.utc)
ON = {"schema": rf.SCHEMA, "flags": {FLAG: {"state": "on"}}}
STRATA = {"HARBOR_BAY": [f"H{i}" for i in range(20)], "OPEN_COAST": [f"O{i}" for i in range(20)]}


@pytest.fixture(autouse=True)
def released(monkeypatch):
    monkeypatch.setenv(TDG.RELEASE_ENV, "1")


def _stat(s, measured=True):
    return {"measured": measured, "s": s, "n": 336}


def _per(s_by_id=None, s=0.0, w1=None, w2=None, m=0.08, drift=(), nonfinite=()):
    per = {}
    for ids in STRATA.values():
        for i in ids:
            v = (s_by_id or {}).get(i, s)
            per[i] = {"W1": _stat(v if w1 is None else w1), "W2": _stat(v if w2 is None else w2), "W": _stat(v),
                      "m": m, "drift": i in drift, "nonfinite": i in nonfinite}
    return per


# ---- the core statistic ---------------------------------------------------------------------------------------------
def test_e_is_the_long_period_free_difference_minus_the_disclosed_rise():
    e = C.e_series([1.10, None, 0.5], [1.00, 0.9, 0.4], [0.02, 0.0, 0.01], [0.03, 0.0, 0.02], 0.08)
    assert e[0] == pytest.approx((1.10 - 0.02) - (1.00 - 0.03) - 0.08) and e[1] is None
    assert C.e_series([1.0], [1.0], [0.0], [0.0], float("nan")) == [None]


def test_measured_needs_90_percent_of_the_hours_and_s_is_the_mean():
    assert C.window_stat([0.01] * 90 + [None] * 10)["measured"]
    assert not C.window_stat([0.01] * 89 + [None] * 11)["measured"]
    assert C.window_stat([0.0, 0.02, 0.04])["s"] == pytest.approx(0.02)        # the MEAN (s10 review), not a median


@pytest.mark.parametrize("n,thr", [(40, 3), (21, 3), (20, 2), (15, 2), (11, 2)])
def test_b1_threshold_counts_measured_monitors(n, thr):
    assert C.b1_threshold(n) == thr


# ---- verdicts and boundaries (T3) -----------------------------------------------------------------------------------
@pytest.mark.parametrize("f,verdict", [(0.019, C.NOT_WORSE), (0.021, C.WORSE), (-0.021, C.WORSE)])
def test_worse_boundary_at_0_02_in_both_halves(f, verdict):
    assert C.judge(_per(s=f), STRATA)["verdict"] == verdict


def test_one_half_worse_is_not_a_build_worse():
    assert C.judge(_per(s=0.01, w1=0.03, w2=0.01), STRATA)["verdict"] == C.NOT_WORSE


@pytest.mark.parametrize("n_fleet,exceed,breach", [(20, 1, False), (20, 2, True), (15, 1, False), (15, 2, True),
                                                   (40, 2, False), (40, 3, True)])
def test_b1_boundary_counts(monkeypatch, n_fleet, exceed, breach):
    """(b1) at n_fleet MEASURED monitors (s10 item 3): threshold 2 at 20 and 15, 3 at 40. MIN_N is lowered so a fleet of
    15 or 20 is judged (in the gate those sizes arise across strata of >= 15 with drift / missing monitors)."""
    monkeypatch.setattr(C, "MIN_N", 1)
    ids = [i for v in STRATA.values() for i in v][:n_fleet]
    strata = {"HARBOR_BAY": ids[: n_fleet // 2], "OPEN_COAST": ids[n_fleet // 2:]}
    per = {i: p for i, p in _per(s_by_id={ids[j]: 0.051 for j in range(exceed)}).items() if i in ids}
    r = C.judge(per, strata)
    assert any(x.startswith("b1") for x in r["sanity"]) is breach


def test_b1_boundary_at_0_05():
    assert not C.judge(_per(s_by_id={"H0": 0.049, "H1": 0.049, "H2": 0.049}), STRATA)["sanity"]
    assert C.judge(_per(s_by_id={"H0": 0.051, "H1": 0.051, "H2": 0.051}), STRATA)["sanity"]


@pytest.mark.parametrize("m,breach", [(0.299, False), (0.301, True), (-0.301, True), (float("nan"), True)])
def test_b3_wiring_bound_on_the_mean_term(m, breach):
    assert any(x.startswith("b3") for x in C.judge(_per(m=m), STRATA)["sanity"]) is breach


def test_fleet_breach_needs_two_consecutive_builds_over_0_03():
    first = C.judge(_per(s=0.031, w1=0.01, w2=0.031), STRATA)       # one half within the bar: not WORSE
    assert first["verdict"] == C.NOT_WORSE and not first["sanity"] and first["fleet_over"]["HARBOR_BAY"]
    second = C.judge(_per(s=0.031, w1=0.01, w2=0.031), STRATA, prev_fleet_over=first["fleet_over"])
    assert any(x.startswith("FLEET BREACH") for x in second["sanity"])
    assert not C.judge(_per(s=0.029, w1=0.01, w2=0.029), STRATA, prev_fleet_over=first["fleet_over"])["sanity"]


def test_thin_stratum_is_untestable_and_source_drift_is_not_measured():
    drift = tuple(STRATA["HARBOR_BAY"][:6])                         # 14 left < 15
    r = C.judge(_per(drift=drift), STRATA)
    assert r["verdict"] == C.UNTESTABLE and r["n"]["HARBOR_BAY"] == 14


def test_non_finite_values_breach():
    assert any(x.startswith("b2") for x in C.judge(_per(nonfinite=("O3",)), STRATA)["sanity"])


# ---- the proposal (p1)-(p4) and the sheet report ---------------------------------------------------------------------
def _hist(n=14, verdict=C.NOT_WORSE, tested=True):
    return [{"tested": tested, "verdict": verdict, "sanity": []} for _ in range(n)]


def test_proposal_passes_only_with_all_four_conditions():
    view = _per(s=0.005)
    ok, why = C.proposal(_hist(), view, STRATA, [0.0] * 14)
    assert ok and not why
    assert not C.proposal(_hist()[:11] + _hist(3, tested=False), view, STRATA, [0.0] * 14)[0]       # (p1)
    assert not C.proposal(_hist(13) + _hist(1, verdict=C.WORSE), view, STRATA, [0.0] * 14)[0]       # (p2)
    assert not C.proposal(_hist(), _per(s=0.025), STRATA, [0.0] * 14)[0]                            # (p3)
    assert not C.proposal(_hist(), view, STRATA, [0.0] * 13 + [0.02])[0]                            # (p4)


def test_sheet_share_report_after_two_builds_over_5_percent():
    assert C.sheet_report([0.01, 0.06, 0.07]) and not C.sheet_report([0.06, 0.04])


def test_pool29_takes_each_hour_from_the_most_recent_build():
    pooled = C.pool29([{"stamp": "a", "e": {"X": {"t1": 1.0, "t2": 1.0}}}, {"stamp": "b", "e": {"X": {"t2": 2.0, "t3": 2.0}}}])
    assert pooled == {"X": [1.0, 2.0, 2.0]}


# ---- T1 / T2 / T3 through flag_guardrail.decide() ------------------------------------------------------------------
def _decide(verdict, now, watch=None, sanity=()):
    r = TDG.report_only(TDG.result_from({"verdict": verdict, "sanity": list(sanity), "reasons": ["x"], "build": "b"}))
    return fg.decide(FLAG, r, dict(ON, watch=watch or {}), "v1", now)


def test_t1_two_worse_builds_24h_apart_disable():
    first = _decide(C.WORSE, NOW)
    assert first["action"] == "strike"
    second = _decide(C.WORSE, NOW + timedelta(hours=25), fg.next_watch({}, FLAG, first))
    assert second["action"] == "disable" and "WORSE" in second["reason"]


def test_t2_a_breach_and_a_fleet_breach_each_disable_at_once():
    assert _decide(C.NOT_WORSE, NOW, sanity=["b1: |s| > 0.05 m at 3 of 40 monitors"])["action"] == "disable"
    assert _decide(C.NOT_WORSE, NOW, sanity=["FLEET BREACH: |F| > 0.03 m"])["action"] == "disable"


def test_t3_transitions():
    first = _decide(C.WORSE, NOW)
    assert _decide(C.WORSE, NOW + timedelta(hours=6), fg.next_watch({}, FLAG, first))["action"] == "strike"   # < 24 h
    w = fg.next_watch({}, FLAG, first)
    d = _decide(C.UNTESTABLE, NOW + timedelta(hours=6), w)
    assert d["action"] == "none" and d["keep_watch"] == w[FLAG]                        # neither strike nor reset
    cached = TDG.result_from({"verdict": C.WORSE, "sanity": [], "build": "b"}, cached=True)
    dc = fg.decide(FLAG, cached, dict(ON, watch=w), "v1", NOW + timedelta(hours=7))
    assert dc["action"] == "none" and dc["keep_watch"] == w[FLAG]                      # the same build: no new strike
    d = _decide(C.NOT_WORSE, NOW + timedelta(hours=6), w)
    assert FLAG not in fg.next_watch(w, FLAG, d)                                       # NOT_WORSE resets


def test_report_only_until_released(monkeypatch):
    monkeypatch.setenv(TDG.RELEASE_ENV, "0")
    r = TDG.report_only(TDG.result_from({"verdict": C.WORSE, "sanity": ["b1: x"], "build": "b"}))
    assert r["verdict"] == C.UNTESTABLE and not r["sanity"] and r["report_only"]


def test_nothing_reenables_and_off_is_never_watched():
    off = {"schema": rf.SCHEMA, "flags": {}}
    assert rf.GUARDED[FLAG] == "0"                                                    # held OFF (decision A)
    d = fg.decide(FLAG, TDG.result_from({"verdict": C.NOT_WORSE, "sanity": []}), dict(off, watch={}), "v1", NOW)
    assert d["action"] == "none"


# ---- T4's machinery on a synthetic set ------------------------------------------------------------------------------
def _inputs(amp=0.5, m=0.10, d=1.0, noise=0.0):
    hours = 24 * 14
    out = {}
    for j, sid in enumerate(i for v in STRATA.values() for i in v):
        noaa = [amp * math.sin(2 * math.pi * (t + j) / 12.42) for t in range(hours)]
        lp = [0.01 * math.sin(2 * math.pi * t / (24 * 13.66)) for t in range(hours)]
        out[sid] = {"disp": [n + m + noise for n in noaa], "noaa": noaa, "lp_o": list(lp), "lp_n": list(lp),
                    "m": m, "d": d, "source": "model", "nonfinite": False}
    return out


def test_t4_every_planted_control_gives_its_required_verdict_on_a_synthetic_set():
    inp = _inputs()
    r, per, _ = R.score(inp, STRATA, {})
    assert r["verdict"] == C.NOT_WORSE and not r["sanity"]
    res = R.planted(inp, STRATA, per, r["verdict"])
    assert set(res) == set(R.CONTROLS) and len(res) == 15
    assert all(v["pass"] for v in res.values()), {k: v for k, v in res.items() if not v["pass"]}


def test_t4_a_wrong_tester_fails_its_controls():
    inp = _inputs()
    r, per, _ = R.score(inp, STRATA, {})
    real = C.BAR_F
    try:
        C.BAR_F = 0.5                                                  # a tester that cannot see 0.03 m
        res = R.planted(inp, STRATA, per, r["verdict"])
    finally:
        C.BAR_F = real
    assert not res["b_plus_0.03"]["pass"] and not res["c_minus_0.03"]["pass"]


# ---- T5, T6 ---------------------------------------------------------------------------------------------------------
def test_t5_the_runner_runs_inside_the_read_only_guard_with_coops_only():
    src = open(R.__file__, encoding="utf-8").read()
    assert "with T.guarded():" in src and R.COOPS_HOST == "api.tidesandcurrents.noaa.gov"
    assert "onrender" not in src and "RENDER" not in src


def test_t6_the_kill_switch_serves_msl():
    from services.weather_pipeline import tide_datum as TD
    series = {"source": "am", "mean_level_m": 0.08, "model_d_ntde_m": 0.9}
    assert TD.datum_for(33.7, -118.3, series, enabled=False, stations=[])["datum"] == "MSL"
    assert TD.datum_for(33.7, -118.3, series, enabled=True, stations=[])["datum"] == "MLLW"


# ---- the build's am_lp (carry (ii)) and the frozen stations --------------------------------------------------------
def test_am_lp_is_a_minus_short_period_and_the_check_catches_a_mismatch():
    a, sp, m = [1.000, 0.500, -0.25], [0.980, 0.470, -0.30], 0.08
    lp = ML.lp_mm(a, sp)
    assert lp == [20, 30, 50]
    am = [int(round((x + m) * 1000)) for x in a]
    spl = [int(round((x + m) * 1000)) for x in sp]
    ok, detail = ML.check(am, lp, spl, a, a)
    assert ok and detail["worst_mm"] <= 1
    assert not ML.check(am, [x + 5 for x in lp], spl, a, a)[0]                          # a different LP part
    assert not ML.check(am, lp, spl, a, [x + 0.01 for x in a])[0]                     # a different FES evaluation


def test_the_frozen_monitors_are_80_type_r_keys():
    spots = ML.monitor_spots()
    assert len(spots) == 80
    doc = json.load(open(ML.MLLW_STATIONS, encoding="utf-8"))
    assert doc["schema"].endswith("/2") and all(len(v["monitor"]) == 20 and len(v["reserve"]) == 20
                                                for v in doc["strata"].values())


# ---- REQ-1 (carry (i) upgraded) and REQ-2 ----------------------------------------------------------------------------
def test_req1_is_a_one_off_calibration_never_run_per_build():
    """The advisor's amended REQ-1: the reproduction is instrument calibration, not a per-build gate (a build can never be
    UNTESTABLE because of it)."""
    src = open(R.__file__, encoding="utf-8").read()
    assert "ref_check" not in src and "REF_STATIONS" not in src
    import mllw_tester_ref_calibration as CAL
    assert CAL.STATIONS == ("9440422", "9491873") and CAL.BAR_M == 0.003 and CAL.YEAR == 2025
    assert CAL.WINDOWS_H == {"14d": 336, "29d": 696}


def test_req1_running_means_judge_the_convention_and_rms_is_only_a_diagnostic():
    import mllw_tester_ref_calibration as CAL
    hours = 24 * 60
    noaa = [math.sin(2 * math.pi * t / 12.42) for t in range(hours)]
    # a +-0.02 m semidiurnal mismatch: large hourly RMS, but its running means cancel -> PASS
    ours = [n + 0.02 * math.sin(2 * math.pi * t / 12.0) for t, n in zip(range(hours), noaa)]
    j = CAL.judge(noaa, ours)
    assert j["pass"] and j["rms_m"] > 0.01
    # a 1-degree-like SA phase error: a slow drift of a few mm -> FAIL
    year = 24 * 365
    noaa_y = [math.sin(2 * math.pi * t / 12.42) for t in range(year)]
    slow = [n + 0.0075 * math.sin(2 * math.pi * t / year) for t, n in zip(range(year), noaa_y)]
    assert not CAL.judge(noaa_y, slow)["pass"]
    # the same with SA/SSA removed from both sides: the correction is subtracted from NOAA before comparing
    assert CAL.judge([n + 0.3 for n in noaa], noaa, [0.3] * hours)["pass"]
    assert CAL.running_max([1.0, -1.0, 1.0, -1.0], 2) == 0.0 and CAL.running_max([1.0], 2) is None


def test_req2_atka_has_no_mf_mm_so_lp_noaa_is_sa_ssa_only(monkeypatch):
    lp = json.load(open(os.path.join(HERE, "..", "..", "docs", "weather-program", "research",
                                     "tide-mllw-tester-v1-lp-noaa.json"), encoding="utf-8"))["stations"]
    assert set(lp["9461710"]["lp"]) == {"SA", "SSA"}
    import arms
    import metrics

    def boom(*a, **k):
        raise AssertionError("harcon_eval must not run without MF/MM rows")
    monkeypatch.setattr(arms, "harcon_eval", boom)
    monkeypatch.setattr(metrics, "noaa_long_period", lambda hc, hours: [0.02 * len(hc) for _ in hours])
    hours = [NOW + timedelta(hours=i) for i in range(3)]
    rows = [("1", "SA", 0.058, 10.0, 0.041), ("2", "SSA", 0.028, 20.0, 0.082), ("3", "M2", 1.0, 0.0, 28.98)]
    assert R.lp_noaa(rows, hours) == pytest.approx([0.04, 0.04, 0.04])


def test_the_first_table_record_is_inputs_only_and_counts_model_vs_not_measured():
    strata = {"HARBOR_BAY": ["A", "B"], "OPEN_COAST": ["C"]}
    reserve = {"HARBOR_BAY": ["D"], "OPEN_COAST": []}
    keys = {"A": (30.0, -80.0), "B": (31.0, -80.0), "C": (32.0, -80.0), "D": (33.0, -80.0)}
    doc = {"generated_at": "2026-12-01T00:00:00Z", "m": {"30.0,-80.0": 0.1, "31.0,-80.0": 0.1, "33.0,-80.0": 0.1},
           "d": {"30.0,-80.0": 0.9, "31.0,-80.0": None, "33.0,-80.0": 0.8},
           "am_lp_amp": {"30.0,-80.0": {"Sa": 0.05, "Ssa": 0.01, "Mf": 0.0, "Mm": 0.0}}}
    rec = R.inputs_record(doc, (strata, reserve, keys))
    assert rec["inputs_only"] and rec["counts"] == {"HARBOR_BAY": {"MODEL": 1, "NOT_MEASURED": 1},
                                                    "OPEN_COAST": {"MODEL": 0, "NOT_MEASURED": 1}}
    assert rec["stations"]["A"]["fes_lp_amp_m"]["Sa"] == 0.05 and rec["stations"]["D"]["role"] == "reserve"
    src = open(R.__file__, encoding="utf-8").read()
    i0, i1 = src.index("def inputs_record"), src.index("def monitor_series")
    assert "noaa" not in src[i0:i1].lower().replace("never noaa", "")          # the record never reads a prediction


# ---- the monitor keys are an AVAILABILITY change (the advisor's (a)-(d)) ---------------------------------------------
def test_b_prior_keys_are_byte_equal_with_and_without_the_monitor_keys():
    """(b): adding the tester's keys changes no existing key's am / m / d. Keys are per 0.1-degree cell, evaluated at the
    key itself, and every series is computed per key, so the prior table entries are identical."""
    import own_rules as OR
    spots = [[33.71, -118.29], [21.66, -158.05], [40.57, -73.97]]
    base = OR.keys_from_spots(spots)
    full = OR.keys_from_spots(spots + ML.monitor_spots())
    assert {k: full[k] for k in base} == base and list(full)[:len(base)] == list(base)   # same points, same order
    rnd = __import__("random").Random(7)
    series = {k: [rnd.randint(-900, 900) for _ in range(6)] for k in full}
    cache = {k: {"m": rnd.random(), "d_ntde": rnd.random()} for k in full}
    t = datetime(2026, 12, 1, tzinfo=timezone.utc)
    a = OR.table(t, t, 6, {k: series[k] for k in base}, cache)
    b = OR.table(t, t, 6, series, cache)
    for field in ("keys", "m", "d"):
        assert json.dumps({k: b[field][k] for k in a[field]}, sort_keys=True) == json.dumps(a[field], sort_keys=True)
    assert len(b["keys"]) > len(a["keys"])                                            # the new cells exist


def test_d_the_kill_env_omits_the_monitor_keys(monkeypatch):
    monkeypatch.delenv(ML.KILL_ENV, raising=False)
    assert ML.keys_enabled()
    monkeypatch.setenv(ML.KILL_ENV, "0")
    assert not ML.keys_enabled()
    src = open(os.path.join(HERE, "..", "scripts", "tide_own", "build_series.py"), encoding="utf-8").read()
    assert "if tester_keys:" in src and "NEW cells" in src and "already keyed" in src                    # (a) logged
    wf = open(os.path.join(HERE, "..", "..", ".github", "workflows", "tide-own-series.yml"), encoding="utf-8").read()
    assert "TIDE_MLLW_TESTER_KEYS: ${{ vars.TIDE_MLLW_TESTER_KEYS || '1' }}" in wf


def test_validate_drops_am_lp_so_it_is_never_served():
    import own_rules as OR
    from services.weather_pipeline import tide_own as TO
    t = datetime(2026, 12, 1, tzinfo=timezone.utc)
    doc = OR.table(t, t, 4, {"30.0,-80.0": [1, 2, 3, 4]}, {"30.0,-80.0": {"m": 0.1}})
    doc["am_lp"], doc["am_lp_check"], doc["am_lp_amp"] = {"30.0,-80.0": [5, 6, 7, 8]}, {"ok": True}, {}
    v = TO.validate(json.loads(json.dumps(OR.encode_table(doc))))
    assert v is not None and "am_lp" not in v and "am_lp_check" not in v and "am_lp_amp" not in v


# ---- NOAA's long-period convention (REQ-1's fix) and the calibration record ----------------------------------------
def test_noaa_lp3_is_zero_without_rows_and_msf_uses_the_compound_s2_m2_convention():
    import noaa_lp
    import metrics
    t = [NOW + timedelta(hours=i) for i in range(3)]
    assert noaa_lp.lp3([("1", "M2", 1.0, 0.0, 28.98)], t) == [0.0, 0.0, 0.0]
    yt = noaa_lp.year_terms(2025)
    _, _, _, n_mid = metrics.schureman_astro(datetime(2025, 7, 2, 12, tzinfo=timezone.utc))
    i, nu, xi = metrics._nodal(n_mid)
    assert yt["MSF"][0] == pytest.approx(math.cos(i / 2) ** 4 / 0.9154)              # f(M2), not the Mm-type factor
    assert yt["MM"][0] == pytest.approx((2 / 3 - math.sin(i) ** 2) / 0.5021)
    one = noaa_lp.lp3([("1", "MSF", 0.139, 37.6, 1.0158958)], t)
    assert all(abs(x) <= 0.139 * 1.1 for x in one)


def test_the_committed_ref_calibration_passes_and_the_first_failure_is_kept():
    base = os.path.join(HERE, "..", "..", "docs", "weather-program", "research")
    ok = json.load(open(os.path.join(base, "tide-mllw-tester-v1-ref-calibration.json"), encoding="utf-8"))
    bad = json.load(open(os.path.join(base, "tide-mllw-tester-v1-ref-calibration-1-fail.json"), encoding="utf-8"))
    assert ok["pass"] and not bad["pass"] and ok["bar_m"] == bad["bar_m"] == 0.003            # the convention, not the bar
    lv = ok["stations"]["9440422"]
    assert lv["with_sa_ssa"]["max_running_14d_m"] <= 0.003 and lv["without_sa_ssa"]["max_running_29d_m"] <= 0.003


# An INDEPENDENT implementation's node factors (the advisor: noaa_lp against an independent Schureman table value):
# pyTMD 3.1.0 constituents.nodal_modulation(N, p, ["mm", "mf", "m2"], corrections="OTIS") at mid-year (July 2, 12 UTC),
# computed once on 2026-11-25 and pinned here (pyTMD is not installed in the test lanes). OTIS uses Schureman's
# series to a truncated order, so agreement is to about 0.005; the tolerance is 0.01.
INDEPENDENT_F = {2006: {"MM": 0.8700, "MF": 1.4570, "M2": 0.9632}, 2015: {"MM": 1.1295, "MF": 0.6308, "M2": 1.0377}}


@pytest.mark.parametrize("year", sorted(INDEPENDENT_F))
def test_noaa_lp_node_factors_match_an_independent_implementation(year):
    import noaa_lp
    yt, ref = noaa_lp.year_terms(year), INDEPENDENT_F[year]
    assert yt["MM"][0] == pytest.approx(ref["MM"], abs=0.01)
    assert yt["MF"][0] == pytest.approx(ref["MF"], abs=0.01)
    assert yt["MSF"][0] == pytest.approx(ref["M2"], abs=0.01)                  # MSF carries f(M2) (the compound S2 - M2)


def test_the_msf_spotcheck_record_is_constants_only():
    d = json.load(open(os.path.join(HERE, "..", "..", "docs", "weather-program", "research",
                                    "tide-mllw-tester-v1-msf-spotcheck.json"), encoding="utf-8"))
    assert d["inputs_only"] and len(d["lp3_by_station"]) == 80 and d["largest_msf_station"] not in ("9440422", "9491873")
    assert d["spotcheck"]["noaa_minus_pytmd_max_abs_m"] <= 0.003


def test_a_key_with_no_fes_never_crashes_the_build_count():
    """Build 45678981191 (2026-11-25) crashed after writing the table: a monitor key where FES has no value has series
    None (levels_mm), and the final served count iterated it. Nothing was published that day."""
    import own_rules as OR
    out_keys = {"a": [1, None, 3], "b": None, "c": [None, None], "d": OR.levels_mm(None, 0.1)}
    assert OR.served_count(out_keys) == 1
    src = open(os.path.join(HERE, "..", "scripts", "tide_own", "build_series.py"), encoding="utf-8").read()
    assert "served = OR.served_count(out_keys)" in src and "for vals in out_keys.values())" not in src
