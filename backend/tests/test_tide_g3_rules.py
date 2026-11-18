"""G3 gate rules (offline; registered in docs/weather-program/log/2026-11-15-claude-tide-m1.md through c0a2a95a4).
Pins the pure parts: storms, minimums, bootstrap direction, verdict precedence, the datum label, the 24 h shift, and
that a forecast value is never taken from a cycle issued after t - lead. Also: the served backend never imports G3."""
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND / "scripts" / "tide_g3"))
import g3_metrics as G                                   # noqa: E402
import g3_sources as GS                                  # noqa: E402

T0 = datetime(2026, 8, 25, tzinfo=timezone.utc)
HOURS = [T0 + timedelta(hours=k) for k in range(336)]


def test_served_backend_never_imports_the_g3_gate():
    pat = re.compile(r"^\s*(from|import)\s+.*\btide_g3\b", re.M)
    served = [BACKEND / "server.py", *(BACKEND / "services").rglob("*.py"), *(BACKEND / "routes").rglob("*.py")]
    assert [p for p in served if p.is_file() and pat.search(p.read_text(encoding="utf-8", errors="ignore"))] == []


def test_storms_link_same_region_events_within_48h_and_split_regions():
    region = {"a": "Atlantic", "b": "Atlantic", "c": "Atlantic", "p": "Pacific"}.get
    ev = {"a": [(80, 21)], "b": [(200, 26), (233, 20)], "c": [(275, 26)], "p": [(196, 97)]}
    st = G.storms(ev, HOURS, region)
    assert [(s["region"], len(s["members"])) for s in st] == [("Atlantic", 1), ("Atlantic", 3), ("Pacific", 1)]
    assert G.item3_runnable(st, {"a": 21, "b": 46, "c": 26, "p": 97}) is False          # < 5 gauges with >= 48 h
    assert G.item3_runnable(st, {g: 60 for g in "abcpqr"[:5]}) is True
    assert G.item3_runnable(st[:2], {g: 60 for g in "abcde"}) is False                  # 2 storms, 1 region


def test_events_need_12_consecutive_hours():
    m = np.zeros(48, bool)
    m[5:16] = True              # 11 h: not an event
    m[20:33] = True             # 13 h: an event
    assert G.events(m, HOURS[:48]) == [(20, 13)]


def test_paired_bootstrap_direction_and_identity():
    rng = np.random.default_rng(1)
    gauges = [f"g{i}" for i in range(12)]
    obs = {g: rng.normal(0, 0.3, 336) for g in gauges}
    good = {g: np.tile(obs[g] + rng.normal(0, 0.05, 336), (3, 1)) for g in gauges}
    bad = {g: np.tile(obs[g] + rng.normal(0, 0.15, 336), (3, 1)) for g in gauges}
    p, lo, hi, d = G.paired_median_diff(good, bad, obs, gauges, draws=300)
    assert p < -0.05 and hi < 0 and len(d) == 12
    p, lo, hi, _ = G.paired_median_diff(good, good, obs, gauges, draws=100)
    assert p == 0 and lo == 0 and hi == 0
    pairs = [(g, h) for g in gauges for h in range(0, 336, 3)]
    pt, lo, hi = G.pooled_diff(good, bad, obs, pairs, G.calm_units(pairs, 336), draws=200)
    assert pt < 0 and hi < 0


def test_verdict_precedence_and_datum_label():
    ok = {"1": True, "2": True}
    assert G.verdict(ok, {"pos": False, "neg": True}, True) == "VOID"
    assert G.verdict(ok, {"pos": True, "shift": None}, False) == "INCONCLUSIVE"     # item 3 not runnable
    assert G.verdict(ok, {"pos": True}, True) == "PASS"
    assert G.verdict({"1": False, "2": True}, {"pos": True}, True) == "FAIL"
    assert G.datum_label(False, True) == "a datum finding: the level needs a per-place reference"
    assert G.datum_label(True, True) is None and G.datum_label(False, False) is None


def test_shift_and_demeaned_residual():
    x = np.arange(10.0)
    s = G.shift_hours(x, 3)
    assert np.isnan(s[:3]).all() and list(s[3:]) == list(x[:7])
    n_pre = 24 * 30
    obs = np.full(n_pre + 48, 0.30)
    pred = np.zeros(n_pre + 48)
    r, m = G.demeaned_residual(obs, pred, n_pre)
    assert abs(m - 0.30) < 1e-9 and np.nanmax(np.abs(r)) < 1e-9        # a constant offset is not surge


def test_forecast_values_come_only_from_cycles_issued_at_or_before_t_minus_lead():
    t_valid = T0 + timedelta(hours=60)
    cycles = [T0 + timedelta(hours=6 * k) for k in range(12)]           # 00Z .. 66Z
    data = {c: {"s": ([c + timedelta(hours=h) for h in range(-6, 181)],
                      np.full(187, float(c.hour + 24 * (c.day - T0.day))))} for c in cycles}
    hours = [t_valid]
    out = GS.as_issued(data, "s", hours, (0, 24, 48))
    # lead 0: latest cycle <= 60 h is 60 h; lead 24: <= 36 h -> 36 h; lead 48: <= 12 h -> 12 h (value = issue hour)
    assert list(out[:, 0]) == [60.0, 36.0, 12.0]
    assert all(v <= 60.0 - L for v, L in zip(out[:, 0], (0, 24, 48)))


def test_g3_workflow_is_one_shot_with_scoped_credentials_and_pins():
    wf = (BACKEND.parent / ".github" / "workflows" / "tide-g3-gate.yml").read_text(encoding="utf-8")
    block = re.search(r"(?ms)^on:\n(.*?)^\S", wf).group(1)
    lines = [ln.strip() for ln in block.splitlines() if ln.strip() and not ln.strip().startswith("#")]
    assert lines == ["push:", "tags: [tide-gate-G3]"], lines   # tag only (scored, final)
    steps = re.split(r"\n      - ", wf)
    aviso = [s for s in steps if "AVISO_PASSWORD" in s]
    cm = [s for s in steps if "COPERNICUSMARINE_SERVICE_PASSWORD" in s]
    assert len(aviso) == 1 and "--download-fes-only" in aviso[0]            # AVISO only on the FES download
    assert len(cm) == 1 and "Run the G3 gate" in cm[0]                       # Copernicus only on the gate
    for pin in ('"pyfes==2026.5.2"', '"pyTMD==3.1.0"', '"timescale==0.1.3"', '"copernicusmarine==2.4.1"'):
        assert pin in wf, pin
    assert "echo" not in wf.lower().replace("# ", "")                        # nothing echoes a secret


def test_g3_gate_preflights_before_truth_and_logs_no_scores():
    src = (BACKEND / "scripts" / "tide_g3" / "g3_gate.py").read_text(encoding="utf-8")
    assert src.index("GS.s1_preflight(") < src.index("obs_pred(sid, ext[0]") < src.index("score(locals_for_score(")
    for line in src.splitlines():
        t = line.strip()
        if t.startswith("log(") or t.startswith("stage(") or " log(f" in line:
            assert not re.search(r"rmse|score\[|items\[|verdict|\bi1d\b|P1_minus", t), t


def test_amendment_a_shift_is_not_a_void_control_and_constant_is_pooled():
    """Owner 21:37 EST ("Amend them"): the +24 h shift check can only make item 3 inconclusive; the constant check
    reads pooled gauge-hours; positive and label swap stay VOID controls."""
    src = (BACKEND / "scripts" / "tide_g3" / "g3_gate.py").read_text(encoding="utf-8")
    block = src[src.index("    controls = {"): src.index("    # AMENDMENT A: a failed")]
    assert "shift" not in block and "positive_noaa_constants" in block and "negative_label_swap" in block
    assert "G.pooled_diff(const, P1, obs, all_pairs" in src and "G.verdict(items, controls, item3_effective)" in src
    assert G.verdict({"1": True}, {"pos": True, "swap": True, "const": True}, False) == "INCONCLUSIVE"


def test_netcdf_reads_are_serialised_across_fetch_threads():
    """G3 run 44011150843 aborted with "double free or corruption" from concurrent netCDF4/HDF5 reads in the fetch
    threads. Every station-file read goes through one lock; downloads may stay parallel."""
    import threading
    assert isinstance(GS._NC_LOCK, type(threading.Lock()))
    src = (BACKEND / "scripts" / "tide_g3" / "g3_sources.py").read_text(encoding="utf-8")
    assert "with _NC_LOCK:" in src and "return _nc_points_locked(" in src
