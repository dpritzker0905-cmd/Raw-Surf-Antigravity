"""Tests for scripts/gate_order_check.py. Real git repos in temp dirs; seeded violations must FAIL."""
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "scripts"))
import gate_order_check as G  # noqa: E402

GOOD_GATE = "\n".join([
    "Stamp: 2026-11-17T10:00Z", "Candidate: x", "Metric: bytes", "Pass threshold: <= 0.8",
    "Controls: null", "Decision rule: both", "Unmeasured items: phone decode",
])


def _repo():
    d = tempfile.mkdtemp()
    subprocess.run(["git", "init", "-q", d], check=True)
    return d


def _commit(repo, rel, text, msg):
    p = os.path.join(repo, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        f.write(text)
    subprocess.run(["git", "-C", repo, "add", rel], check=True)
    subprocess.run(["git", "-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", msg], check=True)


def test_gate_then_result_passes():
    r = _repo()
    _commit(r, "docs/weather-program/gates/c1.md", GOOD_GATE, "gate")
    _commit(r, "docs/weather-program/results/c1.md", "result", "result")
    assert G.check(r, "docs/weather-program/gates", "docs/weather-program/results") == []


def test_mutation_result_before_gate_fails():
    r = _repo()
    _commit(r, "docs/weather-program/results/c1.md", "result", "result")
    _commit(r, "docs/weather-program/gates/c1.md", GOOD_GATE, "gate")
    errs = G.check(r, "docs/weather-program/gates", "docs/weather-program/results")
    assert errs and "strictly before" in errs[0]


def test_mutation_gate_and_result_same_commit_fails():
    r = _repo()
    p1 = os.path.join(r, "docs/weather-program/gates/c1.md")
    p2 = os.path.join(r, "docs/weather-program/results/c1.md")
    for p, t in ((p1, GOOD_GATE), (p2, "result")):
        os.makedirs(os.path.dirname(p), exist_ok=True)
        open(p, "w", encoding="utf-8").write(t)
    subprocess.run(["git", "-C", r, "add", "."], check=True)
    subprocess.run(["git", "-C", r, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "both"], check=True)
    errs = G.check(r, "docs/weather-program/gates", "docs/weather-program/results")
    assert errs and "strictly before" in errs[0]


def test_mutation_result_without_gate_fails():
    r = _repo()
    _commit(r, "docs/weather-program/results/c1.md", "result", "result")
    errs = G.check(r, "docs/weather-program/gates", "docs/weather-program/results")
    assert errs and "no gate file" in errs[0]


def test_mutation_gate_missing_required_field_fails():
    r = _repo()
    _commit(r, "docs/weather-program/gates/c1.md", GOOD_GATE.replace("Controls: null\n", ""), "gate")
    _commit(r, "docs/weather-program/results/c1.md", "result", "result")
    errs = G.check(r, "docs/weather-program/gates", "docs/weather-program/results")
    assert errs and "missing required fields" in errs[0] and "Controls:" in errs[0]


def test_no_results_dir_passes():
    r = _repo()
    _commit(r, "README.txt", "x", "init")
    assert G.check(r, "docs/weather-program/gates", "docs/weather-program/results") == []
