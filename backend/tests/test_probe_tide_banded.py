"""Commitment 203: W-30's evidence lane. The S4 parity probe grades the sim with the glyph's own tide (the same reader
the forecast tool uses) and can sample every spot whose `best_tide` parses to a band, the only spots SIM_SERVED_TIDE
can move. A monitor dispatch with SIM_SERVED_TIDE 1 vs 0 and tide_banded=true is the flip's A/B. These pin the
target set, the summary block that keeps banded rows apart, the shared reader on both composition calls, and the
dispatch wiring.
"""
import ast
import importlib.util
import os

import pytest

from services.weather_pipeline import sim_observed

_BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_PROBE_PATH = os.path.join(_BACKEND, "scripts", "sim_health_probe.py")
_WORKFLOW = os.path.join(os.path.dirname(_BACKEND), ".github", "workflows", "sim-parity-monitor.yml")


def _probe_module():
    spec = importlib.util.spec_from_file_location("sim_health_probe_under_test", _PROBE_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_the_targets_are_exactly_the_spots_tide_can_move():
    probe = _probe_module()
    catalog = [
        {"id": 1, "name": "Low Reef", "latitude": 21.5, "longitude": -158.2, "best_tide": "Low"},
        {"id": 2, "name": "Mid Point", "latitude": 33.0, "longitude": -118.0, "best_tide": "Mid tide"},
        {"id": 3, "name": "Any", "latitude": 34.0, "longitude": -119.0, "best_tide": "All tides"},
        {"id": 4, "name": "Rising", "latitude": 35.0, "longitude": -120.0, "best_tide": "Incoming"},
        {"id": 5, "name": "None", "latitude": 36.0, "longitude": -121.0, "best_tide": None},
        {"id": 6, "name": "No coords", "latitude": None, "longitude": -122.0, "best_tide": "Low"},
    ]
    got = probe._tide_banded_targets(catalog)
    assert [(n, sid) for n, _, sid in got] == [("tide:Low Reef", "1"), ("tide:Mid Point", "2")]
    w, s, e, n = got[0][1]
    assert (w, s, e, n) == pytest.approx((-158.22, 21.48, -158.18, 21.52))
    assert probe._tide_banded_targets(None) == []


def _row(tide_band, d, applied, level_differs=False, norm=0.9):
    return {"d_score": d, "level_differs": level_differs, "d_height_pct": 1.0, "seconds": 1.0,
            "tide_band": tide_band, "sim_tide_applied": applied, "glyph_tide_norm": norm}


def test_the_summary_grades_the_banded_rows_apart():
    probe = _probe_module()
    rows = [_row(False, 0.1, False), _row(False, 0.2, False),
            _row(True, 30.0, False, level_differs=True), _row(True, 0.4, True), _row(True, 0.2, True, norm=None)]
    tb = probe.summarize(rows, [], [], {})["tide_banded"]
    assert tb == {"n": 3, "sim_tide_applied": 2, "glyph_carried_tide": 2,
                  "d_score": {"median": 0.4, "max": 30.0}, "level_differences": 1}
    assert "tide_banded" not in probe.summarize(rows[:2], [], [], {}), "absent, not empty, with no banded row"


def test_both_composition_calls_grade_with_the_shared_tide_reader():
    tree = ast.parse(open(_PROBE_PATH, encoding="utf-8").read())
    fn = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == "probe")
    calls = [n for n in ast.walk(fn) if isinstance(n, ast.Call)
             and getattr(n.func, "id", getattr(n.func, "attr", None)) == "calculate_surf_rating"]
    assert len(calls) == 2
    for c in calls:
        kw = {k.arg: k.value for k in c.keywords if k.arg}
        assert isinstance(kw.get("served_tide"), ast.Name) and kw["served_tide"].id == "_tide"
    src = ast.get_source_segment(open(_PROBE_PATH, encoding="utf-8").read(), fn)
    assert "_tide = sim_observed.glyph_tide(item)" in src
    # a tide pseudo-region measures its own spot, never the neighbour its 0.02-degree box also catches
    assert 'rated = [s for s in rated if str(s.get("spot_id")) == only_id]' in src
    assert "targets += _tide_banded_targets(sim_forecast.fetch_catalog())" in src
    main = open(_PROBE_PATH, encoding="utf-8").read().split("def main():", 1)[1]
    assert "tide_banded=args.tide_banded" in main, "the CLI flag must reach probe()"


def test_the_shared_reader_is_gated_and_sanitises(monkeypatch):
    item = {"tide": {"norm": 0.3, "trend": "falling", "height_m": 0.2}}
    monkeypatch.delenv("SIM_SERVED_TIDE", raising=False)
    assert sim_observed.glyph_tide(item) is None
    monkeypatch.setenv("SIM_SERVED_TIDE", "1")
    assert sim_observed.glyph_tide(item) == {"norm": 0.3, "trend": "falling", "height_m": 0.2,
                                             "source": "served_glyph"}
    assert sim_observed.glyph_tide({"tide": {"norm": float("nan")}}) is None
    assert sim_observed.glyph_tide(None) is None


def test_the_monitor_dispatch_carries_the_ab_and_the_cron_stays_tide_blind():
    wf = open(_WORKFLOW, encoding="utf-8").read()
    assert "SIM_SERVED_TIDE: ${{ github.event.inputs.sim_served_tide || '0' }}" in wf
    assert "TIDE_BANDED: ${{ github.event.inputs.tide_banded || 'false' }}" in wf
    assert 'if [ "$TIDE_BANDED" = "true" ]; then ARGS="$ARGS --tide-banded"; fi' in wf
