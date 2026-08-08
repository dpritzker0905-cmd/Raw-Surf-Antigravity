"""A GitHub annotation printed to stdout lands INSIDE the JSON artifact that captured stdout.

THE DEFECT (measured 2026-08-08 over the 90-day retained artifact series of the Forecast Calibration
Census). `climatology_drift_census.py` prints its report with `print(json.dumps(report))` and then,
on the same stream, prints `::warning::` GitHub workflow commands. The workflow captures that stream
with `> drift.json`. So the retained artifact is valid JSON only on runs where nothing was flagged:

    retained runs           25
    drift.json INVALID      13  (52%)
    freshness.json INVALID   0  (its warn condition has not fired -- LATENT, not absent)

    contingency, 24 runs with both signals readable:
      valid  & no warning : 11
      valid  & warning    :  0      <- would refute
      INVALID & warning   : 13
      INVALID & no warning:  0      <- would refute
      concordant 24/24 (100%)

⭐ THE SHAPE IS WHAT MAKES IT WORTH A GUARD: the artifact is machine-unreadable EXACTLY on the runs
that carry a signal. A clean week parses perfectly, so the defect is invisible until the moment
somebody needs the data. The census workflow's own comment says "the series is the deliverable, not
the pass/fail bit" -- and the series is the half that breaks.

⚠️ SCOPE, MEASURED RATHER THAN ASSUMED. The `::warning::` still reaches the Actions UI: the workflow
runs each census twice, and the second (non-`--json`) invocation sends it to the log where the runner
renders it. Verified on run 31263397122 -- the annotation is present. So this costs the ARTIFACT, not
the alert. That is the honest severity, and it is why this guard bans the shape rather than claiming
a missed page.

WHY A CLASS GUARD AND NOT TWO ONE-LINE FIXES. The repo's recurring lesson is that a fix applied at
the site of an incident is not a fix applied to the class (the disclosure that reached 1 of 4
renderers, `f1bd00bd`; the salvage that reached 1 of 7 GRIB fetchers). Here the second instance was
already latent when the first was found. So the rule is discovered from the WORKFLOWS -- any script
whose stdout a workflow captures into a .json artifact -- and a script added tomorrow is covered
without editing this file.

⭐ THE AST SIGNATURE IS A NEEDLE ONLY THE DEFECT PRODUCES. A substring scan for "::warning::" matches
docstrings, comments and the prose above (this very file would trip it). The real signature is a
`print()` Call whose first positional argument is a string -- Constant or f-string JoinedStr --
beginning with `::`, and which carries no `file=` keyword. `sim_health_probe.py` is the in-repo
counter-example that proves the detector discriminates: `sim-parity-monitor.yml` redirects stderr
separately (`> parity.json 2> parity.err`), so annotations there cannot reach the artifact.
"""
import ast
import os
import pathlib
import re

import pytest

_REPO = pathlib.Path(__file__).resolve().parents[2]
_WORKFLOWS = _REPO / ".github" / "workflows"
_BACKEND = _REPO / "backend"

# `python3 scripts/x.py --flags > out.json` -- stdout captured into a JSON artifact.
_REDIRECT = re.compile(r"python3?\s+(\S+\.py)((?:(?!\n)[^>])*)>\s*(\S+\.json)")


def _capture_sites():
    """Every (workflow, script, artifact, stderr_redirected) a workflow captures stdout from.

    Discovered from the YAML, never hard-coded, so a new census script is covered on the day it is
    wired rather than on the day someone remembers to extend this list.
    """
    sites = []
    for wf in sorted(_WORKFLOWS.glob("*.yml")):
        text = wf.read_text(encoding="utf-8", errors="replace")
        for line in text.splitlines():
            m = _REDIRECT.search(line)
            if not m:
                continue
            script, artifact = m.group(1), m.group(3)
            tail = line[m.end(3):]
            # `2> parity.err` sends annotations somewhere the artifact cannot see.
            stderr_split = bool(re.search(r"\b2>", tail) or re.search(r"\b2>", m.group(2)))
            path = (_BACKEND / script)
            if not path.exists():
                path = _REPO / script
            sites.append((wf.name, script, artifact, stderr_split, path))
    return sites


def _stdout_workflow_commands(path: pathlib.Path):
    """`print()` of a `::command::` string with no `file=` keyword, by AST. Returns [(lineno, text)]."""
    tree = ast.parse(path.read_text(encoding="utf-8", errors="replace"))
    out = []
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
                and node.func.id == "print" and node.args):
            continue
        if any(kw.arg == "file" for kw in node.keywords):
            continue                      # explicitly routed somewhere; stdout is not the target
        first = node.args[0]
        if isinstance(first, ast.Constant) and isinstance(first.value, str):
            head = first.value
        elif isinstance(first, ast.JoinedStr) and first.values and isinstance(
                first.values[0], ast.Constant) and isinstance(first.values[0].value, str):
            head = first.values[0].value
        else:
            continue
        if head.startswith("::"):
            out.append((node.lineno, head[:60]))
    return out


def test_the_scan_can_see_its_own_subject():
    """A guard that cannot tell "clean" from "not sampled" must refuse, not pass.

    Three positive controls: the workflows yield capture sites at all; the scripts resolve on disk;
    and the AST detector fires on a planted violation while ignoring the shapes that are fine.
    """
    sites = _capture_sites()
    assert sites, ("found no stdout->.json capture sites in .github/workflows — the discovery regex "
                   "has gone stale, so a pass here would mean 'not sampled', not 'clean'")
    resolved = [s for s in sites if s[4].exists()]
    assert resolved, f"none of the {len(sites)} discovered scripts resolve on disk: {sites}"

    planted = ast.parse(
        'import sys\n'
        'print("::warning::plain string")\n'                 # violation
        'print(f"::error::{x} interpolated")\n'               # violation
        'print("::notice::routed", file=sys.stderr)\n'        # fine — explicitly routed
        'print("ordinary line")\n'                            # fine — not a workflow command
        'log("::warning::not a print")\n'                     # fine — not print()
    )
    tmp = _BACKEND / "tests" / "_planted_control.py"
    tmp.write_text(ast.unparse(planted), encoding="utf-8")
    try:
        hits = _stdout_workflow_commands(tmp)
    finally:
        tmp.unlink(missing_ok=True)
    assert len(hits) == 2, f"detector must find exactly the 2 planted violations, found {hits}"


def test_no_captured_script_prints_a_workflow_command_to_stdout():
    """The rule. A `::` annotation on stdout corrupts whatever JSON artifact captured that stdout."""
    offenders = []
    for wf, script, artifact, stderr_split, path in _capture_sites():
        if not path.exists() or stderr_split:
            continue
        for lineno, text in _stdout_workflow_commands(path):
            offenders.append(f"{script}:{lineno} -> {artifact} (via {wf}): {text}")
    assert not offenders, (
        "these scripts print a GitHub workflow command to stdout while a workflow captures that "
        "stdout into a JSON artifact, so the artifact is invalid JSON exactly on the runs that have "
        "something to report. Route them to stderr (the runner still renders the annotation):\n  "
        + "\n  ".join(offenders))


def test_stderr_redirected_sites_are_exempt_and_the_exemption_is_real():
    """`sim_health_probe.py` proves the exemption arm is exercised, not dead code.

    Without a real site taking the `stderr_split` branch, that branch would be an untested
    always-false condition and the guard would silently be narrower than it reads.
    """
    sites = _capture_sites()
    split = [s for s in sites if s[3]]
    assert split, ("no capture site redirects stderr separately — the exemption branch in this "
                   "guard is then unreachable and must not be trusted")
    assert any("sim" in s[1] for s in split), f"expected the sim parity probe among {split}"


@pytest.mark.parametrize("script", ["climatology_drift_census.py", "served_freshness_census.py"])
def test_the_two_known_census_scripts_are_covered_by_the_scan(script):
    """Pin the specific instances this guard was written for, so a workflow edit that silently drops
    a census from the census workflow is visible as a test failure rather than as a quiet gap."""
    scripts = {s[1].rsplit("/", 1)[-1] for s in _capture_sites()}
    assert script in scripts, (
        f"{script} is no longer a stdout->json capture site; if that is intentional remove it here, "
        f"but do not let the guard quietly stop watching it. Seen: {sorted(scripts)}")
