"""No fail-green (reliability lane, 2026-11-24): an ingest run whose continue-on-error publish step failed ends RED,
and the marine / wind / rated frame sets get a report-only freshness check.

Pins: the gate's rule (outcome failure + conclusion success = masked); report-only mode; every continue-on-error step
of both ingest jobs carries an id (an un-id'd step is invisible to `toJSON(steps)`); the gate is each job's last step,
runs unless cancelled, and reads only `toJSON(steps)`; the freshness check's bounds, rated-vs-marine lag and that it
skips the raster sets (raster_set_freshness.py owns those) and stays report-only in the monitor."""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest
import yaml

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "scripts"))

import frame_set_freshness as fsf  # noqa: E402
import publish_outcome_gate as gate  # noqa: E402

WF = HERE.parents[1] / ".github" / "workflows"
JOBS = [("forecast-ingest-pilots.yml", "ingest-pilots"), ("forecast-ingest.yml", "ingest")]


def test_masked_failure_rule():
    steps = {"a": {"outcome": "failure", "conclusion": "success"},      # continue-on-error masked it
             "b": {"outcome": "success", "conclusion": "success"},
             "c": {"outcome": "skipped", "conclusion": "skipped"},
             "d": {"outcome": "failure", "conclusion": "failure"}}      # a real failure: the run is red anyway
    assert gate.masked_failures(steps) == ["a"]


def test_the_gate_fails_red_and_report_only_warns(capsys):
    js = json.dumps({"rated_publish": {"outcome": "failure", "conclusion": "success"}})
    assert gate.main({"STEPS_JSON": js}) == 1
    assert "::error title=Masked publish failure::step 'rated_publish'" in capsys.readouterr().out
    assert gate.main({"STEPS_JSON": js, "REPORT_ONLY": "1"}) == 0
    assert "::warning" in capsys.readouterr().out
    assert gate.main({"STEPS_JSON": json.dumps({"x": {"outcome": "success", "conclusion": "success"}})}) == 0
    assert gate.main({"STEPS_JSON": "{not json"}) == 0                  # an unreadable context never fails the run


def test_report_only_steps_warn_and_never_turn_the_run_red(capsys):
    """#1228's `budget` gate and #1264's `frame_physics` check are report-only (advisor, 2026-11-24)."""
    assert gate.REPORT_ONLY_STEP_IDS == {"budget", "frame_physics"}
    js = json.dumps({s: {"outcome": "failure", "conclusion": "success"} for s in ("budget", "frame_physics")})
    assert gate.main({"STEPS_JSON": js}) == 0
    out = capsys.readouterr().out
    assert "::warning title=Report-only step failed::step 'budget'" in out and "::error" not in out
    both = json.dumps({"budget": {"outcome": "failure", "conclusion": "success"},
                       "rated_publish": {"outcome": "failure", "conclusion": "success"}})
    assert gate.main({"STEPS_JSON": both}) == 1                          # a publish failure still turns it red


def _gate_index(steps):
    return next(i for i, s in enumerate(steps) if s.get("name", "").startswith("No fail-green"))


@pytest.mark.parametrize("wf,job", JOBS)
def test_every_continue_on_error_step_is_visible_to_the_gate(wf, job):
    steps = yaml.safe_load((WF / wf).read_text(encoding="utf-8"))["jobs"][job]["steps"]
    coe = [s["name"] for s in steps if s.get("continue-on-error") and "id" not in s]
    assert not coe, f"{wf}: continue-on-error steps without an id (the gate cannot see them): {coe}"
    g = _gate_index(steps)
    gate_step = steps[g]
    assert gate_step["if"] == "${{ !cancelled() }}"
    assert gate_step["env"]["STEPS_JSON"] == "${{ toJSON(steps) }}" and "publish_outcome_gate.py" in gate_step["run"]
    assert set(gate_step["env"]) == {"STEPS_JSON", "REPORT_ONLY"}
    # the gate runs AFTER every publish (continue-on-error, not report-only) step; report-only steps may follow it
    late = [s["id"] for s in steps[g + 1:] if s.get("continue-on-error") and s["id"] not in gate.REPORT_ONLY_STEP_IDS]
    assert not late, f"{wf}: publish steps after the gate (it cannot see their outcome): {late}"


# The only step outputs allowed in these jobs (toJSON(steps) lands in a PUBLIC log): #1228's budget gate, exactly these.
ALLOWED_OUTPUTS = {"budget": {"go", "elapsed_min", "remaining_min"}}


@pytest.mark.parametrize("wf,job", JOBS)
def test_only_the_budget_step_writes_outputs_and_only_its_three(wf, job):
    """toJSON(steps) lands in a PUBLIC log: ids, outcomes and conclusions, plus only the budget gate's three numbers."""
    import re
    steps = yaml.safe_load((WF / wf).read_text(encoding="utf-8"))["jobs"][job]["steps"]
    for s in steps:
        run = s.get("run") or ""
        sources = [run] + [(HERE.parents[1] / "backend" / m).read_text(encoding="utf-8")
                           for m in re.findall(r"(scripts/[\w./-]+\.py)", run) if (HERE.parents[1] / "backend" / m).exists()]
        writes = any("GITHUB_OUTPUT" in src for src in sources)
        if not writes:
            continue
        assert s.get("id") in ALLOWED_OUTPUTS, f"{wf}: step {s.get('name')!r} writes step outputs"
        # EXACTLY the allowed names: every `name={` written on a line that mentions GITHUB_OUTPUT (ci_job_budget.py writes
        # f"go={...}\nelapsed_min={...}\nremaining_min={...}\n" there)
        written = set()
        for src in sources:
            for line in src.splitlines():
                if "GITHUB_OUTPUT" in line:
                    written |= set(re.findall(r'(?:^|\\n|["\'])(\w+)=\{', line))
        assert written == ALLOWED_OUTPUTS[s["id"]], f"{s['id']} writes {sorted(written)}"


NOW = datetime(2026, 11, 24, 3, 10, tzinfo=timezone.utc)


def _latest():
    return {"sets": {
        "GFS/marine/waves/hawaii": {"run": "2026-11-23T12:00:00Z"},              # 15.2 h: ok (GFS bound 18)
        "GFS/marine/waves/hawaii_rated": {"run": "2026-11-23T00:00:00Z"},        # 27.2 h: stale, 12 h behind
        "ICON/marine/waves/global_mid": {"run": "2026-11-23T00:00:00Z"},         # 27.2 h: ok (30)
        "GFS/wind/wind/global_mid": {"run": None},                               # no run recorded
        "GFS/weather/pressure/global": {"run": "2026-11-01T00:00:00Z"},          # raster: not this check's
    }}


def test_freshness_bounds_lag_and_raster_skip():
    rows = {r["key"]: r for r in fsf.check(_latest(), NOW, env={})}
    assert "GFS/weather/pressure/global" not in rows
    assert rows["GFS/marine/waves/hawaii"]["verdict"] == "ok"
    r = rows["GFS/marine/waves/hawaii_rated"]
    assert (r["verdict"], r["family"], r["behind_h"]) == ("stale", "rated", 12.0)
    assert rows["ICON/marine/waves/global_mid"]["verdict"] == "ok"
    assert rows["GFS/wind/wind/global_mid"]["verdict"] == "no_run"
    rows = {r["key"]: r for r in fsf.check(_latest(), NOW, env={"FRAME_STALE_HOURS_GFS": "30"})}
    assert rows["GFS/marine/waves/hawaii_rated"]["verdict"] == "ok"   # the bound is a variable, not code


def test_freshness_cli_is_report_only_unless_asked(tmp_path, capsys):
    p = tmp_path / "latest.json"
    p.write_text(json.dumps(_latest()), encoding="utf-8")
    assert fsf.main(["--latest", str(p)]) == 0
    out = capsys.readouterr().out
    assert "::warning title=Frame sets stale: GFS rated::" in out and "| GFS | rated | 1 | 1 |" in out
    assert fsf.main(["--latest", str(p), "--fail-on-stale"]) == 1


def test_the_monitor_runs_the_freshness_check_report_only():
    doc = yaml.safe_load((WF / "data-health-monitor.yml").read_text(encoding="utf-8"))
    step = next(s for s in doc["jobs"]["check"]["steps"] if s.get("name", "").startswith("Marine / wind / rated"))
    assert "frame_set_freshness.py" in step["run"] and "--fail-on-stale" not in step["run"]
