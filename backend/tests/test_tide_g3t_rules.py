"""G3t gate rules (offline; registered in docs/weather-program/log/2026-11-15-claude-tide-m1.md, G3t FINAL b6eb66fa6).
Pins the pure parts (window and held-out weeks, the M/S split and the shift, items 1-5, coverage, verdict precedence, the
datum label, QC, the parity line), the gate's order (preflight before truth, truth last, no score in the log), the
one-shot workflow with scoped credentials, the station lists fixed before truth, and that nothing served imports it."""
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND / "scripts" / "tide_g3t"))
import g3t_rules as R                                    # noqa: E402

GATE = (BACKEND / "scripts" / "tide_g3t" / "g3t_gate.py").read_text(encoding="utf-8")
WF = (BACKEND.parent / ".github" / "workflows" / "tide-g3t-gate.yml").read_text(encoding="utf-8")


def test_served_backend_never_imports_the_g3t_gate():
    pat = re.compile(r"^\s*(from|import)\s+.*\b(tide_g3t|g3t_rules|g3t_gate)\b", re.M)
    served = [BACKEND / "server.py", *(BACKEND / "services").rglob("*.py"), *(BACKEND / "routes").rglob("*.py")]
    assert [p for p in served if p.is_file() and pat.search(p.read_text(encoding="utf-8", errors="ignore"))] == []


def test_window_removes_the_held_out_weeks_and_truth_requests_skip_them():
    hrs = R.window_hours()
    assert hrs[0] == R.W0 and hrs[-1] == R.W1
    for a, b in R.HELD_OUT:
        assert not any(a <= t < b for t in hrs)
    full = int((R.W1 - R.W0).total_seconds() // 3600) + 1
    assert len(hrs) == full - 2 * 7 * 24
    segs = R.segments()
    assert len(segs) == 3 and segs[0][0] == R.W0 and segs[-1][1] == R.W1
    for a, b in segs:
        assert not any(h0 <= a < h1 or h0 <= b < h1 for h0, h1 in R.HELD_OUT)


def test_s1_split_into_mean_level_and_zero_mean_seasonal_anomaly_and_the_shift():
    doy = {d: 0.10 + 0.05 * np.cos(2 * np.pi * (d - 270) / 365.0) for d in range(1, 366)}
    m, s = R.split_s1(doy)
    assert abs(m - 0.10) < 1e-3 and abs(np.mean(list(s.values()))) < 1e-9
    sh = R.shifted(s)
    assert abs(sh[270] - s[((270 - 1 - 182) % 365) + 1]) < 1e-12           # S at d - 182
    assert np.corrcoef([s[d] for d in range(1, 366)], [sh[d] for d in range(1, 366)])[0, 1] < -0.99


def test_items_lines_are_read_from_the_interval_end():
    assert R.item1((-0.05, -0.07, -0.019), (-0.1, -0.2, -0.01)) is False      # P - D upper end above -0.02
    assert R.item1((-0.05, -0.07, -0.02), (-0.1, -0.2, -0.001)) is True
    assert R.item2({"a": 0.06, "b": 0.01}, ["a", "b", "c"], {"a", "b"}) == {"a": 0.06, "c": "P undefined"}
    assert R.item3((-0.1, -0.2, -0.01), (-0.01, -0.02, -0.001), 0.003) == (True, True)
    assert R.item3((-0.1, -0.2, -0.01), (-0.01, -0.02, -0.001), -0.001) == (True, False)   # shifted beats P: 3b fails
    assert R.item3((-0.1, -0.2, 0.0), (-0.01, -0.02, 0.001), 0.003) == (False, False)
    assert R.item4([7.0, 9.0], [0.01, 0.02]) is True and R.item4([25.0], [0.01]) is False


def test_item5_guard_is_not_runnable_below_five_gauges_and_can_only_fail():
    assert R.item5({"a": 0.1, "b": 0.1}, {"a": 0.1, "b": 0.1}) == ("NOT RUNNABLE", None)
    p = {g: 0.10 for g in "abcde"}
    assert R.item5(p, {g: 0.09 for g in "abcde"})[0] is True                 # +0.01 <= 0.02
    assert R.item5(p, {g: 0.07 for g in "abcde"})[0] is False                # +0.03
    items = {"1": True, "5": "NOT RUNNABLE"}
    assert R.verdict(items, {"pos": True}, False) == "PASS"                   # a not-runnable guard does not block
    assert R.verdict({"1": True, "5": False}, {"pos": True}, False) == "FAIL"


def test_only_positive_control_label_swap_and_coverage_can_void():
    assert R.controls_ok(0.004, 0.5) == {"positive_noaa_constants": True, "negative_label_swap": True}
    assert R.verdict({"1": True}, R.controls_ok(0.02, 0.5), False) == "VOID"
    assert R.verdict({"1": True}, R.controls_ok(0.004, 0.2), False) == "VOID"
    assert R.verdict({"1": True}, R.controls_ok(0.004, 0.5), True) == "VOID"
    assert R.coverage_void(6, 26) is True and R.coverage_void(5, 26) is False
    # the six-month-shifted arm is NOT a control: it lives only inside item 3b
    assert "shift" not in " ".join(R.controls_ok(0.004, 0.5))


def test_coverage_exclusion_and_datum_label():
    good, bad = np.ones((2, 100)), np.ones((2, 100))
    bad[0, :10] = np.nan
    obs = {"a": np.ones(100), "b": np.ones(100)}
    ex = R.excluded_gauges({"a": good, "b": bad}, {"a": good, "b": good}, obs, ["a", "b", "c"])
    assert set(ex) == {"b", "c"} and "P" in ex["b"]
    assert R.datum_label(False, True) == R.DATUM_LABEL
    assert R.datum_label(True, True) is None and R.datum_label(False, False) is None


def test_qc_removes_spikes_and_flat_lines():
    t = np.arange(200.0)
    x = 1.5 * np.sin(2 * np.pi * t / 12.42)              # a 3 m range tide must survive QC
    x[50] += 2.0
    x[100:108] = 0.123
    q = R.qc_series(x)
    assert np.isnan(q[50]) and np.isnan(q[100:108]).all() and np.isfinite(q[:40]).all()


def test_parity_line_for_the_served_path():
    g = np.sin(np.arange(500) / 10.0)
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    ok, v = R.parity(g + 0.002, g, [t0], [t0 + timedelta(minutes=5)])
    assert ok and v["max_m"] <= R.PARITY_MAX_M
    assert not R.parity(g + 0.02, g)[0]                                        # max 0.02 > 0.010
    assert not R.parity(g, g, [t0], [t0 + timedelta(minutes=7)])[0]            # High/Low 7 min > 6


def test_gate_order_preflight_first_truth_last_and_no_scores_in_the_log():
    i_pre = GATE.index("GS.s1_preflight(")
    i_nov = GATE.index('"NO VERDICT"')
    i_fes = GATE.index("arms.fes_eval(")
    i_ref = GATE.index("references(allpts, hours)")
    i_truth = GATE.index("oo, pp = coops_obs_pred(")
    i_score = GATE.index("report = score(")
    assert i_pre < i_nov < i_fes < i_ref < i_truth < i_score
    for line in GATE.splitlines():
        t = line.strip()
        if t.startswith("log(") or t.startswith("stage(") or " log(f" in line:
            assert not re.search(r"rmse|verdict|P_minus|median|swap|i1d|item\d|control_values", t, re.I), t


def test_g3t_workflow_is_one_shot_with_scoped_credentials_and_pins():
    block = re.search(r"(?ms)^on:\n(.*?)^\S", WF).group(1)
    lines = [ln.strip() for ln in block.splitlines() if ln.strip() and not ln.strip().startswith("#")]
    assert lines == ["workflow_dispatch:", "push:", "tags: [tide-gate-G3t]"], lines
    steps = re.split(r"\n      - ", WF)
    aviso = [s for s in steps if "AVISO_PASSWORD" in s]
    cm = [s for s in steps if "COPERNICUSMARINE_SERVICE_PASSWORD" in s]
    assert len(aviso) == 1 and "--download-fes-only" in aviso[0]
    assert len(cm) == 1 and "Run the G3t gate" in cm[0]
    for pin in ('"pyfes==2026.5.2"', '"pyTMD==3.1.0"', '"timescale==0.1.3"', '"copernicusmarine==2.4.1"'):
        assert pin in WF, pin
    assert "echo" not in WF.lower().replace("# ", "")
    assert "fail-on-cache-miss: true" in WF and "needs: download" in WF


def test_station_lists_are_fixed_before_truth():
    st = json.loads((BACKEND / "scripts" / "tide_g3t" / "g3t_stations.json").read_text(encoding="utf-8"))
    hoh = st["ioos_hohonu"]
    assert hoh and all(x["exposure"] in ("open", "sheltered", "excluded") for x in hoh)   # nothing left unclassified
    assert all(x["why"] for x in hoh)
    uh = st["uhslc_non_us"]
    assert len(uh) == len({x["country"] for x in uh}) and "United States of America" not in {x["country"] for x in uh}
