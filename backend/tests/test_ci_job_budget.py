"""Job time-left gate for forecast-ingest-pilots.yml (scripts/ci_job_budget.py) and its wiring in the workflow.

The pilots job (300-min timeout) ran 140-238 min in 2026-11-20..23; a '287 min' run was 91 min of queue plus a 195 min job.
The raster block is the optional tail; the gate lets it skip cleanly when little time is left, never touching core publishing.
"""
import importlib.util
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github" / "workflows" / "forecast-ingest-pilots.yml"


def _load():
    spec = importlib.util.spec_from_file_location("_t_ci_job_budget", ROOT / "backend" / "scripts" / "ci_job_budget.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


MIN = 60.0


@pytest.mark.parametrize("elapsed_min,go", [(0, True), (200, True), (254.9, True), (255, True), (255.1, False), (299, False), (400, False)])
def test_decide_threshold_is_the_reserve(elapsed_min, go):
    assert _load().decide(1000.0, 1000.0 + elapsed_min * MIN, 300, 45)[0] is go


@pytest.mark.parametrize("t0", ["", None, "abc", "9999999999999"])
def test_unknown_or_future_clock_never_blocks(t0):
    assert _load().decide(t0, 1_700_000_000.0, 300, 45)[0] is True


def test_kill_switch_always_goes():
    assert _load().decide(0, 400 * MIN, 300, 45, enabled=False)[0] is True


def test_main_writes_outputs_and_exits_zero(monkeypatch, tmp_path):
    mod = _load()
    out, summ = tmp_path / "out", tmp_path / "sum"
    monkeypatch.setenv("GITHUB_OUTPUT", str(out))
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(summ))
    monkeypatch.delenv("JOB_BUDGET_GATE", raising=False)
    monkeypatch.setattr(mod.time, "time", lambda: 10_000_000.0)
    assert mod.main(["--t0", str(10_000_000.0 - 280 * MIN)]) == 0
    assert "go=false" in out.read_text()
    monkeypatch.setenv("JOB_BUDGET_GATE", "0")
    assert mod.main(["--t0", str(10_000_000.0 - 280 * MIN)]) == 0
    assert out.read_text().count("go=true") == 1


def _job():
    return yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))["jobs"]["ingest-pilots"]["steps"]


def test_every_raster_and_offset_step_is_gated_and_core_steps_are_not():
    steps = _job()
    names = [s.get("name", "") for s in steps]
    gate = next(i for i, s in enumerate(steps) if s.get("id") == "budget")
    clock = next(i for i, n in enumerate(names) if n == "Start the job clock")
    ingest = next(i for i, n in enumerate(names) if n.startswith("Run regional-pilot ingestion"))
    assert clock < ingest < gate
    gated = 0
    for i, s in enumerate(steps):
        n, cond = s.get("name", ""), str(s.get("if", ""))
        is_tail = n.startswith("Publish raster static frames") or n.startswith("Publish the temperature downscale") \
            or n.startswith("Publish the gap-fill")
        if is_tail:
            assert i > gate, n
            assert "steps.budget.outputs.go != 'false'" in cond, n
            gated += 1
        elif n.startswith("Publish static forecast frames") or n.startswith("Publish rated static frames") or "ingestion" in n:
            assert "steps.budget" not in cond, f"core step must never be gated: {n}"
    assert gated >= 25


def test_gate_step_cannot_fail_the_job_and_reads_the_kill_variable():
    g = next(s for s in _job() if s.get("id") == "budget")
    assert g.get("continue-on-error") is True
    assert "JOB_BUDGET_GATE" in str(g.get("env"))
    assert "ci_job_budget.py" in g["run"]
