"""E2E waits for the backend to serve THIS commit AND finish its first L2 restore (2026-09-29).

Run 36505096034 started its tests the second /api/health reported the new SHA and failed its first spot-hub load
while the fresh box was still restoring the L2 manifest (memory 365 -> 915 MB from 00:54 to 00:58Z); the re-run on a
restored box passed in 10 s. `restore_status` reads "pending" until the first restore finishes, so it can gate.
"""
import importlib.util
from pathlib import Path

import pytest
import yaml

_ROOT = Path(__file__).resolve().parents[2]
SHA = "c" * 40
OTHER = "d" * 40


def _mod():
    spec = importlib.util.spec_from_file_location("e2e_backend_ready",
                                                  _ROOT / "backend" / "scripts" / "e2e_backend_ready.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _health(sha=SHA, status="complete", **wr):
    return {"version": f"2.0.0-stage-6f-v1-{sha}", "weather_readiness": {"restore_status": status,
                                                                          "product_count": 13126, **wr}}


def test_ready_only_when_serving_the_commit_and_restored():
    ok, why = _mod().readiness(_health(), SHA)
    assert ok and "restore complete" in why and "13126" in why


@pytest.mark.parametrize("health,expect", [
    (_health(sha=OTHER), "serving dddddddd, not cccccccc"),
    (_health(status="pending"), "L2 restore is pending"),
    (_health(status="empty"), "L2 restore is empty"),
    ({"version": f"x-{SHA}", "weather_readiness": {"error": "manifest boom"}}, "failing: manifest boom"),
    ({"version": f"x-{SHA}"}, "unreported"),
    ({"version": "no-sha-here"}, "<unknown version>"),
    (None, "<unknown version>"),
])
def test_not_ready_says_which_half_is_missing(health, expect):
    ok, why = _mod().readiness(health, SHA)
    assert not ok and expect in why


def test_the_loop_waits_through_deploy_and_restore_then_passes(capsys):
    answers = [ConnectionError("down"), _health(sha=OTHER), _health(status="pending"), _health()]
    calls = []

    def fetch(url):
        calls.append(url)
        a = answers[len(calls) - 1]
        if isinstance(a, Exception):
            raise a
        return a

    assert _mod().main([SHA, "https://api.example/", "10", "15"], fetch=fetch, sleep=lambda s: None) == 0
    out = capsys.readouterr().out
    assert len(calls) == 4 and calls[0] == "https://api.example/api/health"
    assert "backend unreachable (ConnectionError)" in out and "L2 restore is pending" in out
    assert "ready after ~45s" in out


def test_never_ready_fails_with_the_last_reason(capsys):
    code = _mod().main([SHA, "https://api.example", "3", "15"], fetch=lambda url: _health(status="pending"),
                       sleep=lambda s: None)
    out = capsys.readouterr().out
    assert code == 1 and "::error::" in out and "L2 restore is pending" in out.splitlines()[-2]


def test_the_e2e_workflow_gates_on_the_script():
    doc = yaml.safe_load((_ROOT / ".github" / "workflows" / "e2e-tests.yml").read_text(encoding="utf-8"))
    steps = [s for job in doc["jobs"].values() for s in job.get("steps", [])]
    gate = next(s for s in steps if "e2e_backend_ready.py" in str(s.get("run", "")))
    tests = next(i for i, s in enumerate(steps) if s.get("name") == "Run E2E tests")
    assert steps.index(gate) < tests, "the gate must run before the tests"
    assert '"$(git rev-parse HEAD)"' in gate["run"] and gate.get("if") == "github.event_name == 'push'"
