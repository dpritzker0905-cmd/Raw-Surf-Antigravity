"""Execute the workflow's own gate; skipped validation must never imply a grade.

No server imports, credentials, checkout, dependency installation, or network calls.
The tiny expression evaluator covers only this workflow's literal string comparisons
and boolean operators, not arbitrary GitHub Actions expression semantics.
"""
import ast
import json
from pathlib import Path
import re
import textwrap

import pytest


WORKFLOW = Path(__file__).resolve().parents[2] / ".github/workflows/nearshore-validation.yml"


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
