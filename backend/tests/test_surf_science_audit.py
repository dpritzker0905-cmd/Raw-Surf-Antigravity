"""The audit must RUN — on any console, in CI, on a laptop.

`surf_science_audit.py` exists so nobody has to re-derive the state of the forecast science from
commit messages again. That promise is only worth something if the command completes. It did not:
on a Windows console Python hands the process a cp1252 stdout, and the report's arrows and stars
are unencodable there, so the run died with a UnicodeEncodeError at its SECOND row — after
printing one flag and before printing a single finding. It looked like a crashing tool, not like
a report with three failures in it.

These tests pin the properties that make it a usable instrument, deliberately asserting on
STRUCTURE rather than on the exact glyphs, so a wording or emoji change cannot make them red:

  1. it reaches its last line under a console that cannot encode its own output
  2. it exits non-zero when checks fail, so CI can gate on it
  3. --json stays machine-readable and carries the citation for every check
"""
import json
import os
import subprocess
import sys

import pytest

SCRIPT = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts", "surf_science_audit.py"
)


def _run(*args, encoding=None):
    env = dict(os.environ)
    if encoding:
        env["PYTHONIOENCODING"] = encoding
    return subprocess.run(
        [sys.executable, SCRIPT, *args],
        capture_output=True, text=True, encoding="utf-8", errors="replace", env=env, timeout=300,
    )


# cp1252 is what a Windows console actually gives you, and is the case that broke. ascii is the
# harsher version of the same failure — if the transliteration layer is wrong, this catches it.
@pytest.mark.parametrize("console", ["cp1252", "ascii", "utf-8"])
def test_audit_completes_on_a_console_that_cannot_encode_its_output(console):
    proc = _run(encoding=console)

    assert "Traceback" not in proc.stderr, (
        f"audit crashed under {console}:\n{proc.stderr[-2000:]}"
    )
    assert "UnicodeEncodeError" not in proc.stderr
    # The summary is the LAST thing printed. Reaching it proves every row rendered.
    assert "failing" in proc.stdout and "passing" in proc.stdout, (
        f"audit did not reach its summary line under {console}; got:\n{proc.stdout[-2000:]}"
    )


def test_audit_exit_code_is_gateable():
    """Non-zero when something fails, so CI can depend on it. A tool that always exits 0 cannot
    fail a build, and a report nobody is forced to read is the state this script was written to end."""
    proc = _run()
    n_fail = sum(1 for r in json.loads(_run("--json").stdout)["results"] if r["status"] == "FAIL")
    assert proc.returncode == (1 if n_fail else 0)


def test_json_mode_is_parseable_and_every_finding_cites_a_source():
    """★ The house rule for this script: a check that cannot say where its expectation came from is
    an opinion. Enforced here rather than left to review."""
    payload = json.loads(_run("--json").stdout)
    results = payload["results"]
    assert results, "audit produced no checks at all"

    uncited = [
        r["check"] for r in results
        if r["status"] in ("FAIL", "OPEN") and not r.get("source")
    ]
    assert not uncited, f"failing/open checks with no citation: {uncited}"
