"""Execute the workflow's own gate; skipped validation must never imply a grade.

No server imports, credentials, checkout, dependency installation, or network calls.
The tiny expression evaluator covers only this workflow's literal string comparisons
and boolean operators, not arbitrary GitHub Actions expression semantics.
"""
import ast
from datetime import datetime, timedelta, timezone
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import textwrap
import urllib.error
import urllib.request

import pytest


WORKFLOW = Path(__file__).resolve().parents[2] / ".github/workflows/nearshore-validation.yml"
GRADED_TITLE = "Nearshore requested - see validation verdict"


class _Resp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


def _history(runs=(), error=None, calls=None):
    """A stand-in for GitHub's list-workflow-runs answer (the gate's only network read)."""
    def urlopen(req, timeout=None):
        if calls is not None:
            calls.append(req.full_url)
        if error is not None:
            raise error
        return _Resp(json.dumps({"total_count": len(runs), "workflow_runs": list(runs)}).encode())
    return urlopen


def _run(hours_ago, title=GRADED_TITLE, conclusion="success"):
    created = datetime.now(timezone.utc) - timedelta(hours=hours_ago)
    return {"id": 7, "display_title": title, "conclusion": conclusion, "created_at": created.strftime("%Y-%m-%dT%H:%M:%SZ")}


def _job(text, name):
    match = re.search(rf"^  {name}:\n(.*?)(?=^  [\w-]+:|\Z)", text, re.M | re.S)
    assert match, f"missing job: {name}"
    return match.group(1)


def _scalar(text, name, indent):
    match = re.search(rf"^{' ' * indent}{re.escape(name)}: (.+)$", text, re.M)
    assert match, f"missing {name} at indentation {indent}"
    return match.group(1)


def _first_run(text):
    match = re.search(r"^        run: \|\n((?:^          .*\n|^\n)+)", text, re.M)
    assert match, "missing executable run block"
    return textwrap.dedent(match.group(1))


def _expression(source, context):
    source = source.removeprefix("${{").removesuffix("}}").strip()
    source = re.sub(r"\b(?:github|vars|needs)\.[\w.]+", lambda m: repr(context[m[0]]), source)
    source = source.replace("&&", " and ").replace("||", " or ")
    tree = ast.parse(source, mode="eval")
    allowed = (ast.Expression, ast.Constant, ast.BoolOp, ast.And, ast.Or,
               ast.Compare, ast.Eq, ast.NotEq)
    assert all(isinstance(node, allowed) for node in ast.walk(tree))
    return eval(compile(tree, "workflow expression", "eval"), {"__builtins__": {}})


def _assert_eligibility(text, event, flag, expected, tmp_path, monkeypatch):
    gate = _job(text, "eligibility")
    assert "uses:" not in gate, "eligibility must not install or fetch anything"
    assert _scalar(gate, "shell", 8) == "python"
    assert _scalar(gate, "NEARSHORE_VAL_ENABLED", 10) == "${{ vars.NEARSHORE_VAL_ENABLED }}"
    assert _scalar(gate, "eligible", 6) == "${{ steps.gate.outputs.eligible }}"
    output, summary = tmp_path / "output", tmp_path / "summary"
    monkeypatch.setenv("GITHUB_EVENT_NAME", event)
    monkeypatch.setenv("NEARSHORE_VAL_ENABLED", flag)
    monkeypatch.setenv("GITHUB_OUTPUT", str(output))
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(summary))
    monkeypatch.setenv("GH_TOKEN", "t")
    monkeypatch.setenv("GITHUB_REPOSITORY", "o/r")
    monkeypatch.setattr(urllib.request, "urlopen", _history([_run(10)]))   # graded recently: no armed-off WARN
    exec(compile(_first_run(gate), str(WORKFLOW), "exec"), {})
    outputs = dict(line.split("=", 1) for line in output.read_text(encoding="utf-8").splitlines())
    validate = _job(text, "validate")
    assert _scalar(validate, "needs", 4) == "eligibility"
    # Evaluate the ACTUAL job-level condition against the ACTUAL output emitted by
    # the workflow's Python, so step-level skipping cannot masquerade as a job gate.
    scheduled = _expression(_scalar(validate, "if", 4), {
        "needs.eligibility.outputs.eligible": outputs["eligible"],
    })
    assert bool(scheduled) is expected
    title = _expression(_scalar(text, "run-name", 0), {
        "github.event_name": event, "vars.NEARSHORE_VAL_ENABLED": flag,
    })
    recorded = summary.read_text(encoding="utf-8")
    if expected:
        assert "requested" in title
        assert "**REQUESTED**" in recorded
        assert "not a forecast verdict" in recorded
    else:
        assert "NOT GRADED" in title and "ARMED OFF" in title
        assert "**NOT GRADED — ARMED OFF**" in recorded
        assert "scientific validation job is skipped" in recorded


@pytest.mark.parametrize("event,flag,expected", [
    ("schedule", "", False),
    ("schedule", "0", False),
    ("schedule", "1", True),
    ("schedule", "true", False),
    ("schedule", "01", False),
    ("workflow_dispatch", "", True),
    ("workflow_dispatch", "0", True),
    ("workflow_dispatch", "1", True),
    ("push", "1", False),
])
def test_actual_gate_controls_job_and_visible_title(event, flag, expected, tmp_path, monkeypatch):
    _assert_eligibility(WORKFLOW.read_text(encoding="utf-8"), event, flag, expected, tmp_path, monkeypatch)


@pytest.mark.parametrize("before,after", [
    ("    needs: eligibility\n", ""),
    ("    if: needs.eligibility.outputs.eligible == 'true'", "    if: 'true'"),
])
def test_missing_or_bypassed_job_gate_is_rejected(before, after, tmp_path, monkeypatch):
    original = WORKFLOW.read_text(encoding="utf-8")
    assert before in original
    with pytest.raises(AssertionError):
        _assert_eligibility(original.replace(before, after), "schedule", "0", False, tmp_path, monkeypatch)


def _arms(text, event, inputs):
    """Which arms the runner receives, from the validate job's ACTUAL env expressions."""
    validate = _job(text, "validate")
    ctx = {"github.event_name": event,
           **{f"github.event.inputs.{k}": inputs.get(k) for k in ("mop", "nwps", "mop_grid", "trains", "backfill_hours")}}
    env = {k: _expression(_scalar(validate, f"NEARSHORE_VAL_{k.upper()}", 10), ctx)
           for k in ("mop", "nwps", "trains", "mop_grid_dir", "backfill_h")}
    fetch = validate.split("      - name: Fetch the archived MOP grid runs", 1)[1]
    env["fetches_archive"] = bool(_expression(_scalar(fetch, "if", 8), ctx))
    return env


@pytest.mark.parametrize("event,inputs,want", [
    # An armed slot grades every cheap arm (2026-09-28) over the last 24 h (VA-03, 2026-10-08): one hour
    # matched 7 station-hours, under the 30 a grade needs; the 24 h backfills matched 24-98.
    ("schedule", {}, {"mop": "1", "nwps": "1", "trains": "0", "mop_grid_dir": "../mop_archive",
                      "fetches_archive": True, "backfill_h": "24"}),
    ("workflow_dispatch", {"mop": "0", "nwps": "0", "mop_grid": "0", "trains": "0", "backfill_hours": "0"},
     {"mop": "0", "nwps": "0", "trains": "0", "mop_grid_dir": "", "fetches_archive": False, "backfill_h": "0"}),
    ("workflow_dispatch", {"mop": "1", "nwps": "1", "mop_grid": "1", "trains": "1", "backfill_hours": "48"},
     {"mop": "1", "nwps": "1", "trains": "1", "mop_grid_dir": "../mop_archive", "fetches_archive": True,
      "backfill_h": "48"}),
])
def test_an_armed_slot_grades_the_cheap_arms_and_a_dispatch_grades_what_it_asks(event, inputs, want):
    assert _arms(WORKFLOW.read_text(encoding="utf-8"), event, inputs) == want


def test_the_schedule_fires_every_6_hours_off_the_ingest_hours():
    """A 24 h backfill costs 314-802 /point calls (measured on the 09-27..29 dispatches) on the shared 1-CPU box, so
    it cannot run hourly. Six-hourly at :20 past 03/09/15/21 stays off the core ingest (:15 past every 4th hour)
    and the precompute (:45 past 07/15/23); GitHub drops most slots of a 6-hourly cron (MOP ingest: 75%)."""
    crons = re.findall(r"^    - cron: '([^']+)'", WORKFLOW.read_text(encoding="utf-8"), re.M)
    assert crons == ["20 3,9,15,21 * * *"]


# ── VA-03: the verdict owns the run's status ────────────────────────────────────────────────────

def _bash():
    if os.name == "nt":
        for p in (r"C:\Program Files\Git\bin\bash.exe", r"C:\Program Files\Git\usr\bin\bash.exe"):
            if os.path.exists(p):
                return p
    return shutil.which("bash")


@pytest.mark.parametrize("rc,line,want_rc,annotation", [
    (0, "VERDICT GRADED n_matched=60 (spot-hours 60, station-hours 30)", 0, None),
    (1, "REFUSED: no usable nearshore evidence: station-hours=7 (min 30)", 1, "::error::REFUSED"),
    (2, "INFRA: pair table unreadable", 2, "::error::INFRA"),
])
def test_the_verdict_sets_the_run_status(rc, line, want_rc, annotation, tmp_path):
    """Executes the step's own bash (GitHub's `bash --noprofile --norc -eo pipefail`) with the runner stubbed to each
    exit code. Before VA-03 a REFUSED verdict exited 0, so a run that graded nothing showed green."""
    bash = _bash()
    if bash is None:
        pytest.skip("no bash on this machine (CI runs this on ubuntu)")
    validate = _job(WORKFLOW.read_text(encoding="utf-8"), "validate")
    block = _first_run(validate.split("      - name: Run the nearshore outcome loop\n", 1)[1])
    assert "python3 scripts/run_nearshore_validation.py" in block and "${{ steps.warm.outputs.awake }}" in block
    block = block.replace("python3 scripts/run_nearshore_validation.py", "runner").replace("${{ steps.warm.outputs.awake }}", "1")
    (tmp_path / "step.sh").write_text(f"runner() {{ echo '{line}'; return {rc}; }}\n{block}", encoding="utf-8", newline="\n")
    done = subprocess.run([bash, "--noprofile", "--norc", "-eo", "pipefail", "step.sh"], cwd=tmp_path,
                          capture_output=True, text=True, timeout=60)
    assert done.returncode == want_rc, done.stdout + done.stderr
    if annotation:
        assert annotation in done.stdout
    else:
        assert "::error::" not in done.stdout


# ── VA-03: an armed-off judge says how long it has graded nothing ───────────────────────────────

def _gate(event, flag, urlopen, tmp_path, monkeypatch, capsys):
    gate = _job(WORKFLOW.read_text(encoding="utf-8"), "eligibility")
    output, summary = tmp_path / "output", tmp_path / "summary"
    for key, value in {"GITHUB_EVENT_NAME": event, "NEARSHORE_VAL_ENABLED": flag, "GITHUB_OUTPUT": str(output),
                       "GITHUB_STEP_SUMMARY": str(summary), "GH_TOKEN": "t", "GITHUB_REPOSITORY": "o/r"}.items():
        monkeypatch.setenv(key, value)
    monkeypatch.setattr(urllib.request, "urlopen", urlopen)
    exec(compile(_first_run(gate), str(WORKFLOW), "exec"), {})
    return summary.read_text(encoding="utf-8"), capsys.readouterr().out


@pytest.mark.parametrize("runs", [
    [],                                                        # nothing at all in the window
    [_run(2, title="Nearshore NOT GRADED - ARMED OFF")],       # only armed-off runs (the 85 green ones)
    [_run(5, conclusion="failure")],                           # a requested run that REFUSED or hit INFRA
    [_run(100)],                                               # a graded run, but older than 72 h
])
def test_armed_off_with_no_graded_run_in_72_h_WARNS(runs, tmp_path, monkeypatch, capsys):
    summary, out = _gate("schedule", "", _history(runs), tmp_path, monkeypatch, capsys)
    assert "**WARN" in summary and "72 h" in summary
    assert "::warning::" in out and "72 h" in out


def test_a_graded_run_inside_72_h_raises_no_warn(tmp_path, monkeypatch, capsys):
    summary, out = _gate("schedule", "", _history([_run(10)]), tmp_path, monkeypatch, capsys)
    assert "WARN" not in summary and "::warning::" not in out
    assert "last graded" in summary   # the age is still recorded


def test_an_unreadable_history_is_a_named_warning_never_silence(tmp_path, monkeypatch, capsys):
    summary, out = _gate("schedule", "0", _history(error=urllib.error.URLError("refused")), tmp_path, monkeypatch, capsys)
    assert "history unreadable" in summary and "::warning::" in out and "URLError" in out


def test_the_history_read_asks_github_for_this_workflows_successful_runs_of_the_last_72_h(tmp_path, monkeypatch, capsys):
    calls = []
    _gate("schedule", "", _history([_run(10)], calls=calls), tmp_path, monkeypatch, capsys)
    assert len(calls) == 1
    url = calls[0]
    assert url.startswith("https://api.github.com/repos/o/r/actions/workflows/nearshore-validation.yml/runs?")
    assert "status=success" in url
    since = datetime.strptime(re.search(r"created=%3E%3D([0-9T:%A-Z-]+)", url)[1].replace("%3A", ":"), "%Y-%m-%dT%H:%M:%SZ")
    assert abs((datetime.now(timezone.utc).replace(tzinfo=None) - since) - timedelta(hours=72)) < timedelta(minutes=5)


def test_a_requested_run_reads_no_history(tmp_path, monkeypatch, capsys):
    """CONTROL: an eligible run is graded by its own validate job; the gate makes no extra request."""
    calls = []
    summary, out = _gate("workflow_dispatch", "", _history(calls=calls), tmp_path, monkeypatch, capsys)
    assert calls == [] and "WARN" not in summary


def test_runner_and_artifact_are_only_in_gated_job():
    text = WORKFLOW.read_text(encoding="utf-8")
    assert re.findall(r"^  ([\w-]+):$", text, re.M)[-2:] == ["eligibility", "validate"]
    validate = _job(text, "validate")
    assert "python3 scripts/run_nearshore_validation.py" in validate
    assert "actions/upload-artifact@" in validate
    assert "actions/checkout@" in validate
    assert "ARMED_OFF" not in validate  # Eligibility is owned by the dependency, not step drift.


@pytest.mark.parametrize("available,label", [(True, "GRADED"), (False, "REFUSED")])
def test_actual_report_summary_preserves_scientific_verdict(available, label, tmp_path, monkeypatch, capsys):
    report = {
        "available": available, "n_stations": 1,
        "station_probe": {"dead_404": [], "infra": []},
        "n_preds": 1, "n_obs": 1, "n_matched": 1,
        "reason": "insufficient held-out observations", "stations": {},
        "budget": {"wall_s": 1}, "point_api": {"calls": 1, "failed": 0},
    }
    (tmp_path / "nearshore_report.json").write_text(json.dumps(report), encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    validate = _job(WORKFLOW.read_text(encoding="utf-8"), "validate")
    summary_step = validate.split("      - name: Summary\n", 1)[1]
    script = _first_run(summary_step).rstrip().splitlines()[1:-1]  # Existing Python heredoc.
    exec(compile("\n".join(script), "workflow summary", "exec"), {})
    assert f"**{label}**" in capsys.readouterr().out
