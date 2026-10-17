"""The nearshore SURF-ZONE GATE (WS-CAN-0076 follow-up): the judge's report can finally go yellow or red.

Before this gate the 'Nearshore Validation' workflow GRADED the served nearshore height against nearshore
buoys every six hours and only PRINTED the result: no threshold, no warning, no page. These tests pin the
grading rules (nearshore_gate.grade_nearshore_gate) and the CI wrapper (scripts/nearshore_gate_ci.py).

Every report here comes from the REAL report builder (nearshore_validation.build_report), passed through a JSON
round trip as the runner writes it, so a schema drift in the report breaks a test here instead of blinding the gate.
"""
import copy
import inspect
import json
import os
import re
import sys
from datetime import date, datetime, timedelta, timezone

import pytest

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

from services.weather_pipeline import nearshore_gate as G   # noqa: E402
from services.weather_pipeline import nearshore_validation as NV   # noqa: E402

T0 = datetime(2026, 10, 15, 12, 0, tzinfo=timezone.utc)
BEFORE_GRACE = date(2026, 11, 1)        # the default grace is 2026-11-15
AFTER_GRACE = date(2026, 11, 16)


def _rows(station, hours, spots, model, obs):
    """`hours` distinct buoy readings at `station`, each matched by `spots` linked spots (the runner's row shape)."""
    return [{"station": station, "spot": f"{station}-s{k}", "valid_time": "2026-10-15T12:00:00Z",
             "obs_time": (T0 - timedelta(hours=3 * h)).strftime("%Y-%m-%dT%H:%M:%SZ"),
             "model_hs_m": model, "obs_hs_m": obs, "model_hs_spot_geometry_m": model}
            for h in range(hours) for k in range(spots)]


# 4 stations x 10 readings x 2 spots = 80 spot-hours on 40 station-hours; obs/model 1.05 and MAE 0.05 m: healthy.
HEALTHY = {"143p1": (10, 2, 1.0, 1.05), "254p1": (10, 2, 1.0, 1.05),
           "153p1": (10, 2, 1.0, 1.05), "101p1": (10, 2, 1.0, 1.05)}


def make_report(stations=None, floor=None):
    """What the runner writes: build_report on matched rows, then the runner's own additions, as JSON."""
    stations = HEALTHY if stations is None else stations
    matched = [r for st, (h, s, m, o) in stations.items() for r in _rows(st, h, s, m, o)]
    rep = NV.build_report(matched, n_stations=len(stations), n_obs=len(matched), n_preds=len(matched),
                          min_station_hours=NV.GRADED_MIN_STATION_HOURS if floor is None else floor)
    rep["station_probe"] = {"live": sorted(stations), "dead_404": [], "infra": []}
    rep["n_spot_hours"] = len(matched)
    rep["point_api"] = {"base": "x", "calls": len(matched), "failed": 0}
    rep["budget"] = {"wall_s": 1.0}
    return json.loads(json.dumps(rep))


def with_ratio(rep, ratio):
    rep = copy.deepcopy(rep)
    rep["spot_geometry"]["station"]["obs_over_model_median"] = ratio
    rep["obs_over_model"]["median"] = ratio
    return rep


def with_mae(rep, mae):
    """Every station reads this MAE, so the n-weighted aggregate is exactly it."""
    rep = copy.deepcopy(rep)
    for st in rep["stations"].values():
        st["mae_m"] = mae
    return rep


def graded(rep, env=None, today=BEFORE_GRACE):
    return G.grade_nearshore_gate(rep, env=env or {}, today=today)


# ── the schema the gate reads, pinned against the real builder ──────────────────────────────────────────────

def test_the_fixture_is_the_real_builders_report_and_carries_every_key_the_gate_reads():
    rep = make_report()
    assert rep["available"] is True and rep["n_station_hours"] == 40
    assert set(rep["stations"]) == set(HEALTHY)
    for st in rep["stations"].values():
        assert {"n", "mae_m", "bias_m", "obs_over_model_median"} <= set(st)
    assert "obs_over_model_median" in rep["spot_geometry"]["station"]
    assert "median" in rep["obs_over_model"]


def test_the_aggregate_the_gate_grades_is_the_number_the_runner_prints_as_the_GEOMETRY_station_mae():
    """The report has no aggregate MAE field; the gate derives it from the per-station errors. On rows of unequal
    weight that must be the same number the runner's own GEOMETRY line prints (spot_geometry.station.mae_m)."""
    rep = make_report({"a": (12, 2, 1.0, 1.3), "b": (9, 1, 2.0, 1.9), "c": (11, 3, 0.7, 0.5), "d": (8, 2, 1.5, 1.5)})
    printed = rep["spot_geometry"]["station"]["mae_m"]
    line = next(line for line in graded(rep).lines if line.startswith("GATE mae"))
    assert 0.1 < printed < 0.3 and abs(float(re.search(r"GATE mae ([\d.]+) m", line).group(1)) - printed) < 0.0006


def test_the_floor_is_the_runners_one_definition_not_a_copy(monkeypatch):
    """GRADED_MIN_STATION_HOURS lives once, in nearshore_validation; the runner imports it and the gate reads it at
    call time. A copy in either would let the gate and the runner disagree about what a grade is."""
    from scripts import run_nearshore_validation as R
    assert NV.GRADED_MIN_STATION_HOURS == R.GRADED_MIN_STATION_HOURS == 30
    assert not re.search(r"^GRADED_MIN_STATION_HOURS\s*=", inspect.getsource(R), re.M)
    rep = make_report()                                    # 40 station-hours
    assert graded(rep).level == G.OK
    monkeypatch.setattr(NV, "GRADED_MIN_STATION_HOURS", 41)
    assert graded(rep).level == G.REFUSE


# ── a healthy report is OK, and says what it measured ───────────────────────────────────────────────────────

def test_a_healthy_report_is_OK_and_exits_zero():
    gate = graded(make_report())
    assert gate.level == G.OK and gate.exit_code == 0 and gate.enabled is True
    assert gate.findings == ()
    assert gate.lines and all(line.startswith("GATE") for line in gate.lines)
    assert gate.lines[-1] == "GATE verdict OK"
    assert "n_station_hours=40" in gate.lines[0] and "stations=4" in gate.lines[0]


def test_output_is_ascii_only_for_cp1252_consoles():
    for rep in (make_report(), None):
        gate = graded(rep)
        assert "".join(gate.lines).isascii() and gate.summary_markdown.isascii()


def test_levels_are_exactly_the_four_named_ones():
    assert (G.OK, G.WARN, G.RED, G.REFUSE) == ("OK", "WARN", "RED", "REFUSE")


# ── REFUSE: a gate that cannot tell 'healthy' from 'not measured' is never green ────────────────────────────

@pytest.mark.parametrize("report", [None, {}, [], "nearshore_report.json", 7])
def test_no_report_REFUSES(report):
    gate = graded(report)
    assert gate.level == G.REFUSE and gate.exit_code == 1
    assert "BLIND" in " ".join(gate.lines) and "not health" in " ".join(gate.lines)
    assert gate.lines[-1] == "GATE verdict REFUSE"


def test_an_unavailable_report_REFUSES_and_carries_the_runners_reason():
    rep = json.loads(json.dumps(NV.build_report([], n_stations=3, n_obs=0, n_preds=5)))
    assert rep["available"] is False
    gate = graded(rep)
    assert gate.level == G.REFUSE and gate.exit_code == 1
    assert "available=false" in " ".join(gate.lines) and "n_matched=0" in " ".join(gate.lines)


@pytest.mark.parametrize("available", [False, None, "true", 1, "yes"])
def test_only_a_literal_true_is_available(available):
    rep = make_report()
    rep["available"] = available
    assert graded(rep).level == G.REFUSE


def test_the_station_hour_floor_is_inclusive_at_30():
    ok = make_report({"143p1": (8, 2, 1.0, 1.05), "254p1": (8, 2, 1.0, 1.05),
                      "153p1": (7, 2, 1.0, 1.05), "101p1": (7, 2, 1.0, 1.05)})
    assert ok["n_station_hours"] == 30 and ok["n_matched"] == 60 and graded(ok).level == G.OK
    thin = copy.deepcopy(ok)
    thin["n_station_hours"] = 29                                             # a report the builder would have refused
    gate = graded(thin)
    assert gate.level == G.REFUSE
    assert "n_station_hours=29" in " ".join(gate.lines) and "floor 30" in " ".join(gate.lines)


@pytest.mark.parametrize("value", [None, "40", 40.5, True, float("nan"), -1])
def test_an_unreadable_station_hour_count_REFUSES(value):
    rep = make_report()
    rep["n_station_hours"] = value
    assert graded(rep).level == G.REFUSE


def test_a_missing_station_hour_count_REFUSES():
    rep = make_report()
    del rep["n_station_hours"]
    assert graded(rep).level == G.REFUSE


@pytest.mark.parametrize("stations", [None, {}, [], "x", {"a": None}, {"a": {"n": 5}}, {"a": {"mae_m": 0.1}},
                                      {"a": {"n": 0, "mae_m": 0.1}}, {"a": {"n": 5, "mae_m": "0.1"}},
                                      {"a": {"n": 5, "mae_m": float("nan")}}, {"a": {"n": True, "mae_m": 0.1}}])
def test_missing_or_malformed_per_station_errors_REFUSE(stations):
    rep = make_report()
    rep["stations"] = stations
    assert graded(rep).level == G.REFUSE


def test_REFUSE_is_not_graced_by_the_grace_date():
    assert graded(None, today=BEFORE_GRACE).level == G.REFUSE
    assert graded(None, today=AFTER_GRACE).level == G.REFUSE


# ── the kill switch restores today's behaviour exactly: no gate output, exit 0 ──────────────────────────────

@pytest.mark.parametrize("report", [None, make_report(), with_mae(make_report(), 9.0)])
def test_NEARSHORE_GATE_0_prints_nothing_and_exits_zero(report):
    gate = graded(report, env={"NEARSHORE_GATE": "0"}, today=AFTER_GRACE)
    assert gate.enabled is False and gate.level == G.OK and gate.exit_code == 0
    assert gate.lines == () and gate.findings == () and gate.summary_markdown == "" and gate.annotations == ()


@pytest.mark.parametrize("value", [None, "", "1", "true", "off"])
def test_anything_but_the_literal_0_leaves_the_gate_on(value):
    env = {} if value is None else {"NEARSHORE_GATE": value}
    assert graded(None, env=env).level == G.REFUSE


def test_the_switch_tolerates_surrounding_whitespace():
    assert graded(None, env={"NEARSHORE_GATE": " 0 "}).enabled is False


def test_without_an_injected_env_the_gate_has_no_overrides_and_never_reads_the_real_environment(monkeypatch):
    """The function is pure: only the CLI hands it os.environ."""
    monkeypatch.setenv("NEARSHORE_GATE", "0")
    monkeypatch.setenv("NEARSHORE_GATE_MAE_RED", "0.01")
    gate = G.grade_nearshore_gate(make_report(), today=BEFORE_GRACE)
    assert gate.enabled is True and gate.level == G.OK and "red above 0.32 m" in " ".join(gate.lines)


# ── MAE: RED only past the bound AND past the grace date; before it the same breach is a WARN ───────────────

def _mae_findings(gate):
    return [f for f in gate.findings if f.code == "mae"]


def test_the_default_red_bound_is_0_32_m_and_the_comparison_is_strict():
    at = graded(with_mae(make_report(), 0.32), today=AFTER_GRACE)
    assert at.level == G.OK and _mae_findings(at) == []                     # exactly the bound is not a breach
    over = graded(with_mae(make_report(), 0.3201), today=AFTER_GRACE)
    assert over.level == G.RED and over.exit_code == 1 and [f.level for f in _mae_findings(over)] == [G.RED]


def test_before_the_grace_date_the_same_breach_is_a_WARN_that_exits_zero():
    gate = graded(with_mae(make_report(), 0.5), today=BEFORE_GRACE)
    assert gate.level == G.WARN and gate.exit_code == 0
    text = _mae_findings(gate)[0].text
    assert "0.500 m" in text and "0.32 m red bound" in text and "RED after 2026-11-15" in text
    assert any(a.startswith("::warning::GATE WARN") for a in gate.annotations)


def test_the_grace_date_itself_is_still_grace_and_the_day_after_arms_the_gate():
    breach = with_mae(make_report(), 0.5)
    assert graded(breach, today=date(2026, 11, 15)).level == G.WARN
    armed = graded(breach, today=date(2026, 11, 16))
    assert armed.level == G.RED and armed.exit_code == 1
    assert any(a.startswith("::error::GATE RED") for a in armed.annotations)
    assert "not a diagnosis" in _mae_findings(armed)[0].text


@pytest.mark.parametrize("today", ["2026-11-16", "2026-11-16T03:00:00Z", datetime(2026, 11, 16, 1, tzinfo=timezone.utc),
                                   datetime(2026, 11, 16, 1), date(2026, 11, 16),
                                   datetime(2026, 11, 15, 23, 30, tzinfo=timezone(timedelta(hours=-5)))])   # 11-16 04:30Z
def test_today_may_be_a_date_a_datetime_or_an_iso_string(today):
    assert graded(with_mae(make_report(), 0.5), today=today).level == G.RED


def test_an_aware_datetime_is_read_as_its_UTC_date():
    inside = datetime(2026, 11, 15, 20, 0, tzinfo=timezone(timedelta(hours=-5)))                  # 11-16 01:00Z
    still = datetime(2026, 11, 15, 23, 0, tzinfo=timezone(timedelta(hours=+3)))                   # 11-15 20:00Z
    assert graded(with_mae(make_report(), 0.5), today=inside).level == G.RED
    assert graded(with_mae(make_report(), 0.5), today=still).level == G.WARN


def test_without_an_injected_today_the_gate_reads_the_clock():
    assert isinstance(G.grade_nearshore_gate(make_report(), env={}), G.Gate)


def test_the_aggregate_is_weighted_by_spot_hours_not_a_mean_of_station_means():
    rep = make_report()
    rep["stations"] = {"a": {"n": 10, "mae_m": 0.1}, "b": {"n": 10, "mae_m": 0.1}, "c": {"n": 60, "mae_m": 0.5}}
    # weighted 0.4 (over the 0.32 bound); the unweighted mean of the three, 0.2333, would hide it
    gate = graded(rep, today=AFTER_GRACE)
    assert gate.level == G.RED and "0.400 m over n=80 spot-hours" in _mae_findings(gate)[0].text


def test_the_log_prints_the_live_value_beside_its_threshold_and_measured_basis():
    line = next(ln for ln in graded(with_mae(make_report(), 0.162)).lines if ln.startswith("GATE mae"))
    assert "0.162 m over n=80 spot-hours" in line and "red above 0.32 m" in line
    assert "WARN until 2026-11-15" in line and "basis" in line and "38982682625" in line


@pytest.mark.parametrize("value,breaches", [("0.5", False), ("0.3", True)])
def test_the_red_bound_is_tunable_by_NEARSHORE_GATE_MAE_RED(value, breaches):
    gate = graded(with_mae(make_report(), 0.4), env={"NEARSHORE_GATE_MAE_RED": value}, today=AFTER_GRACE)
    assert (gate.level == G.RED) is breaches
    assert f"red above {float(value):g} m" in " ".join(gate.lines)


@pytest.mark.parametrize("bad", ["abc", "-1", "0", "nan", "inf", "0,5"])
def test_a_bad_bound_falls_back_to_the_default_and_says_so_never_silently(bad):
    gate = graded(with_mae(make_report(), 0.4), env={"NEARSHORE_GATE_MAE_RED": bad}, today=AFTER_GRACE)
    assert gate.level == G.RED and "red above 0.32 m" in " ".join(gate.lines)            # the default, not the typo
    config = [f for f in gate.findings if f.code == "config"]
    assert len(config) == 1 and config[0].level == G.WARN
    assert "NEARSHORE_GATE_MAE_RED" in config[0].text and repr(bad) in config[0].text


def test_an_unset_or_blank_variable_is_no_override_and_raises_no_config_finding():
    gate = graded(make_report(), env={"NEARSHORE_GATE_MAE_RED": "  ", "NEARSHORE_GATE_GRACE": ""})
    assert gate.level == G.OK and gate.findings == ()


def test_the_grace_date_is_tunable_by_NEARSHORE_GATE_GRACE():
    breach = with_mae(make_report(), 0.5)
    env = {"NEARSHORE_GATE_GRACE": "2026-12-01"}
    assert graded(breach, env=env, today=date(2026, 12, 1)).level == G.WARN
    assert graded(breach, env=env, today=date(2026, 12, 2)).level == G.RED
    assert graded(breach, env={"NEARSHORE_GATE_GRACE": "2026-12-01T00:00:00Z"}, today=date(2026, 12, 2)).level == G.RED
    assert "RED after 2026-12-01" in " ".join(graded(breach, env=env, today=date(2026, 12, 1)).lines)


@pytest.mark.parametrize("bad", ["soon", "2026-13-45", "11/15/2026", "0"])
def test_a_bad_grace_date_falls_back_to_the_default_date_and_says_so(bad):
    gate = graded(with_mae(make_report(), 0.5), env={"NEARSHORE_GATE_GRACE": bad}, today=date(2026, 11, 16))
    assert gate.level == G.RED                                  # armed by the DEFAULT 2026-11-15, not extended by a typo
    assert [f.code for f in gate.findings if f.code == "config"] == ["config"]


# ── RATIO: the standing 'the surf runs low/high' fact (WARN, a product fact, not a page) ────────────────────

def _ratio_findings(gate):
    return [f for f in gate.findings if f.code == "ratio"]


# 4 stations, 96 station-hours, 172 spot-hours: the shape of the live run (183 / 96) on the real builder's rows
LIVE = {"254p1": (30, 2, 0.8, 1.0), "143p1": (28, 2, 0.6, 0.75), "153p1": (20, 1, 0.44, 0.55), "101p1": (18, 2, 0.9, 1.125)}


def test_the_LIVE_case_ratio_1_25_is_a_standing_WARN_that_says_plainly_how_low_the_surf_runs():
    rep = with_ratio(make_report(LIVE), 1.2496)
    assert (rep["n_station_hours"], rep["n_matched"]) == (96, 172)
    gate = graded(rep, today=AFTER_GRACE)                      # even after the grace date: a standing fact never pages
    assert gate.level == G.WARN and gate.exit_code == 0 and [f.level for f in _ratio_findings(gate)] == [G.WARN]
    text = _ratio_findings(gate)[0].text
    assert "the served surf height runs 20 percent low against nearshore buoys" in text
    assert "n=172 spot-hours" in text and "96 station-hours" in text and "1.250" in text
    assert "not an incident" in text and "deliberately not a page" in text
    assert gate.annotations and gate.annotations[0].startswith("::warning::GATE WARN ratio:")


def test_a_ratio_below_one_says_the_surf_runs_HIGH():
    text = _ratio_findings(graded(with_ratio(make_report(), 0.8)))[0].text
    assert "the served surf height runs 25 percent high against nearshore buoys" in text


@pytest.mark.parametrize("ratio,level", [(1.0, G.OK), (1.15, G.OK), (1.1501, G.WARN), (0.85, G.OK), (0.8499, G.WARN)])
def test_the_standing_warn_band_is_0_85_to_1_15_inclusive(ratio, level):
    assert graded(with_ratio(make_report(), ratio)).level == level


@pytest.mark.parametrize("ratio", [1.6, 0.6, 1.3, 0.7])
def test_inside_the_red_band_the_ratio_never_pages_even_after_grace(ratio):
    gate = graded(with_ratio(make_report(), ratio), today=AFTER_GRACE)
    assert gate.level == G.WARN and gate.exit_code == 0


@pytest.mark.parametrize("ratio,word", [(1.6001, "low"), (3.0, "low"), (0.5999, "high"), (0.2, "high")])
def test_beyond_a_plausible_standing_bias_it_is_a_WARN_in_grace_and_RED_after(ratio, word):
    rep = with_ratio(make_report(), ratio)
    inside = graded(rep, today=BEFORE_GRACE)
    assert inside.level == G.WARN and inside.exit_code == 0
    assert "RED after 2026-11-15" in _ratio_findings(inside)[0].text
    armed = graded(rep, today=AFTER_GRACE)
    assert armed.level == G.RED and armed.exit_code == 1
    text = _ratio_findings(armed)[0].text
    assert f"percent {word} against nearshore buoys" in text and "beyond a plausible standing bias" in text
    assert armed.annotations[0].startswith("::error::GATE RED ratio:")


def test_the_graded_geometry_block_is_the_ratio_and_the_overall_median_is_only_a_fallback():
    rep = make_report()
    rep["spot_geometry"]["station"]["obs_over_model_median"] = 1.3
    rep["obs_over_model"]["median"] = 1.0
    assert "1.300" in _ratio_findings(graded(rep))[0].text
    no_geometry = copy.deepcopy(rep)
    del no_geometry["spot_geometry"]
    no_geometry["obs_over_model"]["median"] = 1.3
    gate = graded(no_geometry)
    assert gate.level == G.WARN and "1.300" in _ratio_findings(gate)[0].text
    assert any("all-rows median" in line for line in gate.lines)
    assert graded(with_ratio(make_report(), 1.0)).level == G.OK


@pytest.mark.parametrize("junk", [None, float("nan"), 0, -1.2, True, "1.2", float("inf")])
def test_an_unreadable_ratio_is_a_named_WARN_never_a_green(junk):
    rep = make_report()
    rep["spot_geometry"]["station"]["obs_over_model_median"] = junk
    rep["obs_over_model"]["median"] = junk
    gate = graded(rep)
    assert gate.level == G.WARN and "unreadable" in _ratio_findings(gate)[0].text
    del rep["spot_geometry"], rep["obs_over_model"]
    assert graded(rep).level == G.WARN


def _worst_line(gate):
    return next(line for line in gate.lines if line.startswith("GATE stations worst first"))


def test_worst_stations_are_ranked_by_distance_from_one_in_either_direction_with_a_stable_tiebreak():
    rep = make_report({n: (10, 2, 1.0, 1.05) for n in ("a", "e", "c", "d", "b", "f")})      # e before b: the tie must sort
    ratios = {"a": 1.2, "b": 1.6, "c": 0.5, "d": 1.05, "e": 1.6, "f": None}
    for name, r in ratios.items():
        if r is None:
            del rep["stations"][name]["obs_over_model_median"]
        else:
            rep["stations"][name]["obs_over_model_median"] = r
    rep["stations"]["f"]["bias_m"] = -9.0                      # the biggest bias, but no ratio: ranked after all ratios
    rep = with_ratio(rep, 1.3)
    line = _worst_line(graded(rep))
    assert re.findall(r"(\w) x", line) == ["c", "b", "e"]      # 0.5 (|ln| .69) > 1.6 twice (.47, tie -> name order)
    assert "c x0.500 (n=20, bias" in line and "f x" not in line
    text = _ratio_findings(graded(rep))[0].text
    assert "worst stations: c x0.500" in text


def test_a_station_without_a_ratio_ranks_after_those_with_one_by_bias():
    rep = make_report({n: (10, 2, 1.0, 1.05) for n in ("a", "b", "c", "d")})
    for name in ("a", "b"):
        del rep["stations"][name]["obs_over_model_median"]
    rep["stations"]["a"]["bias_m"], rep["stations"]["b"]["bias_m"] = 0.1, -0.4
    rep["stations"]["c"]["obs_over_model_median"], rep["stations"]["d"]["obs_over_model_median"] = 1.0, 1.01
    assert re.findall(r"(\w) x", _worst_line(graded(with_ratio(rep, 1.3)))) == ["d", "c", "b"]


def test_the_live_ratio_is_printed_beside_its_bands_and_measured_basis():
    line = next(ln for ln in graded(with_ratio(make_report(), 1.2496)).lines if ln.startswith("GATE ratio"))
    assert "1.250" in line and "graded geometry" in line and "warn outside 0.85-1.15" in line
    assert "red outside 0.60-1.60 after 2026-11-15" in line and "1.2496" in line and "provisional" in line


# ── the fewest instruments a verdict may rest on ────────────────────────────────────────────────────────────

def _stations_findings(gate):
    return [f for f in gate.findings if f.code == "stations"]


def test_fewer_than_three_graded_stations_is_a_WARN_and_exactly_three_is_not():
    three = make_report({n: (10, 1, 1.0, 1.05) for n in ("a", "b", "c")})
    assert graded(three).level == G.OK
    two = make_report({n: (15, 1, 1.0, 1.05) for n in ("a", "b")})
    gate = graded(two, today=AFTER_GRACE)
    assert gate.level == G.WARN and gate.exit_code == 0
    assert "only 2 distinct station(s) graded (floor 3)" in _stations_findings(gate)[0].text


def test_the_station_floor_is_tunable_by_NEARSHORE_GATE_MIN_STATIONS():
    assert graded(make_report(), env={"NEARSHORE_GATE_MIN_STATIONS": "4"}).level == G.OK
    gate = graded(make_report(), env={"NEARSHORE_GATE_MIN_STATIONS": "5"})
    assert gate.level == G.WARN and "(floor 5)" in _stations_findings(gate)[0].text


@pytest.mark.parametrize("bad", ["0", "-2", "x", "2.5", "nan"])
def test_a_bad_station_floor_falls_back_to_three_and_says_so(bad):
    two = make_report({n: (15, 1, 1.0, 1.05) for n in ("a", "b")})
    gate = graded(two, env={"NEARSHORE_GATE_MIN_STATIONS": bad})
    assert "(floor 3)" in _stations_findings(gate)[0].text
    assert [f.code for f in gate.findings if f.code == "config"] == ["config"]


# ── the ratio bands are tunable, and an inconsistent set is refused as a set ────────────────────────────────

def test_the_ratio_bands_are_tunable():
    rep = with_ratio(make_report(), 1.25)
    assert graded(rep, env={"NEARSHORE_GATE_RATIO_WARN_HIGH": "1.3"}).level == G.OK
    assert graded(rep, env={"NEARSHORE_GATE_RATIO_RED_HIGH": "1.2"}, today=AFTER_GRACE).level == G.RED
    assert graded(with_ratio(make_report(), 0.9), env={"NEARSHORE_GATE_RATIO_WARN_LOW": "0.95"}).level == G.WARN
    assert graded(with_ratio(make_report(), 0.7), env={"NEARSHORE_GATE_RATIO_RED_LOW": "0.75"},
                  today=AFTER_GRACE).level == G.RED


@pytest.mark.parametrize("env", [{"NEARSHORE_GATE_RATIO_WARN_HIGH": "1.7"},          # above the red high bound
                                 {"NEARSHORE_GATE_RATIO_WARN_LOW": "0.5"},           # below the red low bound
                                 {"NEARSHORE_GATE_RATIO_RED_HIGH": "1.1"},           # inside the warn band
                                 {"NEARSHORE_GATE_RATIO_WARN_LOW": "1.2", "NEARSHORE_GATE_RATIO_WARN_HIGH": "1.1"}])
def test_an_inconsistent_set_of_bands_falls_back_to_the_defaults_as_a_set(env):
    gate = graded(with_ratio(make_report(), 1.25), env=env, today=AFTER_GRACE)
    assert gate.level == G.WARN                                  # the default bands: 1.25 is warn, not red
    config = [f for f in gate.findings if f.code == "config"]
    assert len(config) == 1 and "ratio bands" in config[0].text and "defaults" in config[0].text


@pytest.mark.parametrize("name", ["WARN_LOW", "WARN_HIGH", "RED_LOW", "RED_HIGH"])
def test_a_garbled_band_is_named_and_the_default_used(name):
    gate = graded(make_report(), env={"NEARSHORE_GATE_RATIO_" + name: "wide"})
    assert gate.level == G.WARN and "NEARSHORE_GATE_RATIO_" + name in gate.findings[0].text


# ── only the BULK arm: the gate reads what every report has and ignores every optional arm ──────────────────

def test_a_bulk_only_report_is_graded_and_arm_blocks_never_move_the_verdict():
    rep = make_report()
    assert not [k for k in rep if k.endswith("_ab")]             # the fixture really is bulk-only
    armed = copy.deepcopy(rep)
    for arm in ("mop_ab", "mop_grid_ab", "nwps_ab", "consensus_ab", "shadow_ab", "pair_ab", "trains_ab"):
        armed[arm] = {"n": 5, "bulk": {"mae_m": 9.9, "bias_m": 9.9}, "arm": {"mae_m": 9.9, "bias_m": 9.9}}
    armed["member_ab"] = {"EURO": {"n": 5}}
    assert graded(armed).lines == graded(rep).lines and graded(rep).level == G.OK


# ── what reaches the log, the annotations and the step summary ──────────────────────────────────────────────

def _with_station_named(rep, name):
    rep = copy.deepcopy(rep)
    rep["stations"][name] = rep["stations"].pop("143p1")
    return rep


def _every_kind_of_gate():
    live = with_ratio(make_report(LIVE), 1.2496)
    return [graded(make_report()), graded(live), graded(with_mae(make_report(), 0.5), today=AFTER_GRACE),
            graded(with_ratio(make_report(), 3.0), today=AFTER_GRACE), graded(None),
            graded(make_report(), env={"NEARSHORE_GATE_MAE_RED": "50%\n::error::x", "NEARSHORE_GATE_GRACE": "dat\u00e9"}),
            graded({**make_report(), "n_station_hours": "40%\n"}),
            graded({**make_report(), "stations": {"a%\n\u00e9": {"n": "bad"}}}),
            graded({**make_report(), "available": False, "reason": "100% \u00e9\n::error::x"}),
            graded(_with_station_named(with_ratio(make_report(), 1.3), "z%\u00e9"))]


def test_no_line_annotation_or_summary_holds_a_percent_sign_a_newline_or_a_non_ascii_character():
    """GitHub workflow commands decode '%' sequences and end at a newline; cp1252 consoles choke on non-ASCII. The
    overrides come from repo variables, so they are sanitised too."""
    for gate in _every_kind_of_gate():
        for text in (*gate.lines, *gate.annotations):
            assert "%" not in text and "\n" not in text and text.isascii(), text
        assert "%" not in gate.summary_markdown and gate.summary_markdown.isascii()
        assert all(line.startswith("GATE") for line in gate.lines)


def test_the_step_summary_names_the_verdict_the_numbers_and_the_kill_switch():
    md = graded(with_ratio(make_report(LIVE), 1.2496)).summary_markdown
    assert md.startswith("### Nearshore surf-zone gate: **WARN**")
    assert "n_station_hours=96" in md and "red above 0.32 m" in md and "20 percent low" in md
    assert "NEARSHORE_GATE=0" in md and "GATE verdict" not in md
    refused = graded(None).summary_markdown
    assert refused.startswith("### Nearshore surf-zone gate: **REFUSE**") and "BLIND" in refused


def test_every_variable_the_gate_reads_is_listed_and_every_listed_variable_is_read():
    """ENV_VARS is what the workflow wires from repo variables; a variable the gate reads but the list lacks would be
    untunable, and one the list names but the gate ignores would be a dead knob."""
    assert set(G.ENV_VARS) == {"NEARSHORE_GATE", "NEARSHORE_GATE_MAE_RED", "NEARSHORE_GATE_GRACE",
                               "NEARSHORE_GATE_MIN_STATIONS", "NEARSHORE_GATE_RATIO_RED_LOW",
                               "NEARSHORE_GATE_RATIO_WARN_LOW", "NEARSHORE_GATE_RATIO_WARN_HIGH",
                               "NEARSHORE_GATE_RATIO_RED_HIGH"}
    for name in G.ENV_VARS:
        if name == "NEARSHORE_GATE":
            continue
        gate = graded(make_report(), env={name: "garbled"})
        assert [f.code for f in gate.findings] == ["config"] and name in gate.findings[0].text, name


def test_the_defaults_are_the_documented_ones():
    assert (G.DEFAULT_MAE_RED_M, G.DEFAULT_GRACE, G.DEFAULT_MIN_STATIONS) == (0.32, "2026-11-15", 3)
    assert G.DEFAULT_RATIO_BANDS == (0.6, 0.85, 1.15, 1.6)


# ── the CI wrapper: scripts/nearshore_gate_ci.py ────────────────────────────────────────────────────────────

from scripts import nearshore_gate_ci as C   # noqa: E402


def _write(tmp_path, report, name="nearshore_report.json"):
    path = tmp_path / name
    path.write_text(report if isinstance(report, str) else json.dumps(report), encoding="utf-8")
    return str(path)


def _cli(tmp_path, report, argv=(), env=None, capsys=None):
    rc = C.main(["--report", _write(tmp_path, report), *argv], env=env or {})
    return rc, capsys.readouterr().out


def test_cli_a_healthy_report_prints_the_gate_lines_and_exits_zero(tmp_path, capsys):
    rc, out = _cli(tmp_path, make_report(), capsys=capsys)
    assert rc == 0 and "GATE verdict OK" in out and "::" not in out


def test_cli_a_warn_emits_a_warning_annotation_and_still_exits_zero(tmp_path, capsys):
    rc, out = _cli(tmp_path, with_ratio(make_report(LIVE), 1.2496), argv=["--as-of", "2026-12-01"], capsys=capsys)
    assert rc == 0 and "::warning::GATE WARN ratio:" in out and "::error::" not in out
    assert "the served surf height runs 20 percent low against nearshore buoys" in out
    assert "GATE note replay mode" in out and "2026-12-01" in out


def test_cli_a_red_after_the_grace_date_emits_an_error_annotation_and_exits_one(tmp_path, capsys):
    report = with_mae(make_report(), 0.5)
    rc, out = _cli(tmp_path, report, argv=["--as-of", "2026-11-16"], capsys=capsys)
    assert rc == 1 and "::error::GATE RED mae:" in out and "GATE verdict RED" in out
    rc, out = _cli(tmp_path, report, argv=["--as-of", "2026-11-15"], capsys=capsys)       # the same breach inside grace
    assert rc == 0 and "::warning::GATE WARN mae:" in out and "::error::" not in out


def test_cli_the_grace_date_arms_it_with_no_person_involved(tmp_path, capsys, monkeypatch):
    """Without --as-of the wrapper grades against the real clock: a breach is RED now exactly when the clock is past
    the grace date. The clock is pinned here, the CLI's own default is what is exercised."""
    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return cls(2026, 11, 16, 0, 5, tzinfo=tz or timezone.utc)
    monkeypatch.setattr(G, "datetime", Clock)
    rc, out = _cli(tmp_path, with_mae(make_report(), 0.5), capsys=capsys)
    assert rc == 1 and "::error::GATE RED mae:" in out


@pytest.mark.parametrize("report", ["{not json", "[]", "7", "", "null"])
def test_cli_an_unreadable_or_non_object_report_REFUSES_and_exits_one(tmp_path, capsys, report):
    rc, out = _cli(tmp_path, report, capsys=capsys)
    assert rc == 1 and "::error::GATE REFUSE report: BLIND" in out and "GATE verdict REFUSE" in out


def test_cli_a_missing_report_file_REFUSES_and_exits_one(tmp_path, capsys):
    rc = C.main(["--report", str(tmp_path / "absent.json")], env={})
    out = capsys.readouterr().out
    assert rc == 1 and "::error::GATE REFUSE report: BLIND" in out


def test_cli_the_kill_switch_prints_nothing_writes_nothing_and_exits_zero_even_with_no_report(tmp_path, capsys):
    summary = tmp_path / "summary.md"
    env = {"NEARSHORE_GATE": "0", "GITHUB_STEP_SUMMARY": str(summary)}
    assert C.main(["--report", str(tmp_path / "absent.json")], env=env) == 0
    assert capsys.readouterr().out == "" and not summary.exists()
    assert C.main(["--report", _write(tmp_path, with_mae(make_report(), 9.0)), "--as-of", "2030-01-01"], env=env) == 0
    assert capsys.readouterr().out == ""


def test_cli_the_step_summary_is_appended_not_overwritten(tmp_path, capsys):
    summary = tmp_path / "summary.md"
    summary.write_text("### earlier step\n", encoding="utf-8")
    rc, _ = _cli(tmp_path, with_ratio(make_report(LIVE), 1.2496), env={"GITHUB_STEP_SUMMARY": str(summary)}, capsys=capsys)
    text = summary.read_text(encoding="utf-8")
    assert rc == 0 and text.startswith("### earlier step\n") and "**WARN**" in text and text.count("### ") == 2


def test_cli_reads_the_overrides_from_the_environment_it_is_given(tmp_path, capsys):
    rc, out = _cli(tmp_path, with_mae(make_report(), 0.5), argv=["--as-of", "2026-12-01"],
                   env={"NEARSHORE_GATE_MAE_RED": "0.6"}, capsys=capsys)
    assert rc == 0 and "red above 0.6 m" in out and "::" not in out


def test_cli_a_crash_inside_the_gate_is_a_named_failure_not_a_green_and_not_a_bare_traceback(tmp_path, capsys, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("synthetic")
    monkeypatch.setattr(C, "grade_nearshore_gate", boom)
    rc, out = _cli(tmp_path, make_report(), capsys=capsys)
    assert rc == 1 and "::error::GATE REFUSE internal: BLIND" in out and "RuntimeError" in out and "NEARSHORE_GATE=0" in out


def test_cli_runs_as_a_script_from_backend_exactly_as_the_workflow_runs_it(tmp_path):
    """python3 scripts/nearshore_gate_ci.py from backend/: the sys.path insert and the __main__ guard."""
    import subprocess
    summary = tmp_path / "summary.md"
    env = {**os.environ, "GITHUB_STEP_SUMMARY": str(summary), "NEARSHORE_GATE": "", "PYTHONIOENCODING": "utf-8"}
    for key in G.ENV_VARS:
        env.pop(key, None)
    done = subprocess.run([sys.executable, "scripts/nearshore_gate_ci.py", "--report", _write(tmp_path, make_report()),
                           "--as-of", "2026-10-16"], cwd=BACKEND, env=env, capture_output=True, text=True, timeout=120)
    assert done.returncode == 0, done.stdout + done.stderr
    assert "GATE verdict OK" in done.stdout and "**OK**" in summary.read_text(encoding="utf-8")
    missing = subprocess.run([sys.executable, "scripts/nearshore_gate_ci.py", "--report", str(tmp_path / "none.json")],
                             cwd=BACKEND, env=env, capture_output=True, text=True, timeout=120)
    assert missing.returncode == 1 and "::error::GATE REFUSE" in missing.stdout


# ── the workflow step, executed: the real bash against the real wrapper ─────────────────────────────────────

WORKFLOW = os.path.join(os.path.dirname(BACKEND), ".github", "workflows", "nearshore-validation.yml")


def _gate_step_block():
    text = open(WORKFLOW, encoding="utf-8").read()
    step = text.split("      - name: Surf-zone gate", 1)[1].split("\n      - name:", 1)[0]
    run = re.search(r"^        run: \|\n((?:^          .*\n?)+)", step, re.M)
    assert run, "the gate step has no run block"
    return "\n".join(line[10:] for line in run.group(1).splitlines()) + "\n", step


@pytest.mark.parametrize("report,env_extra,want_rc", [
    (make_report(), {}, 0),
    (with_ratio(make_report(LIVE), 1.2496), {}, 0),                                    # a standing WARN does not fail the run
    (with_mae(make_report(), 0.5), {"NEARSHORE_GATE_GRACE": "2026-01-01"}, 1),         # armed RED fails it
    (with_mae(make_report(), 0.5), {"NEARSHORE_GATE_GRACE": "2026-01-01", "NEARSHORE_GATE": "0"}, 0),   # the kill switch
    (None, {}, 1),                                                                     # a missing report fails it
])
def test_the_workflow_steps_own_bash_sets_the_run_status(tmp_path, report, env_extra, want_rc):
    import shutil
    import subprocess
    bash = next((p for p in (r"C:\Program Files\Git\bin\bash.exe", shutil.which("bash")) if p and os.path.exists(p)), None)
    if bash is None:
        pytest.skip("no bash on this machine (CI runs this on ubuntu)")
    block, _ = _gate_step_block()
    assert "python3 scripts/nearshore_gate_ci.py" in block
    path = _write(tmp_path, report) if report is not None else str(tmp_path / "absent.json")
    block = block.replace("python3", f'"{sys.executable}"'.replace("\\", "/")).replace("nearshore_report.json", path.replace("\\", "/"))
    (tmp_path / "step.sh").write_text(block, encoding="utf-8", newline="\n")
    env = {k: v for k, v in os.environ.items() if k not in G.ENV_VARS}
    env.update(env_extra)
    done = subprocess.run([bash, "--noprofile", "--norc", "-eo", "pipefail", str(tmp_path / "step.sh").replace("\\", "/")],
                          cwd=BACKEND, env=env, capture_output=True, text=True, timeout=120)
    assert done.returncode == want_rc, done.stdout + done.stderr
