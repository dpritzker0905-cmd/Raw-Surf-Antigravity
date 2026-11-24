"""The PR-time floor fragment check (advisor's cause walk, 2026-11-24): a PR's own ci-floors.d fragments must equal the
tests (and files) it actually adds to each backend lane, measured by COLLECTING head and merge base.

Pre-tested by hand before merge: against #1228's head (719df1b4a, base f37de972a) it reported estate +15 tests with NO
fragment and printed `rederive_floor.py --lane estate --add 15`; against #1268 it found chain +7 tests / +1 FILE where
the fragment declared 0 files (fixed in #1268). These pin the pure parts and the CI wiring."""
import json
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "scripts"))

import floor_fragment_check as ffc  # noqa: E402

CI = HERE.parents[1] / ".github" / "workflows" / "ci.yml"


def test_parse_collect_counts_nodes_per_file():
    out = "\n".join(["tests/test_a.py::test_one", "tests/test_a.py::test_two[1]", "tests/test_a.py::test_two[2]",
                     "tests/test_b.py::TestX::test_y", "", "4 tests collected in 0.5s",
                     "tests\\test_c.py::test_windows_path"])
    assert ffc.parse_collect(out) == {"tests/test_a.py": 3, "tests/test_b.py": 1, "tests/test_c.py": 1}


def _side(tests, files, errors=()):
    return {"tests": tests, "files": files, "errors": list(errors)}


def _frag(tests=0, files=0):
    return {"tests": tests, "files": files, "names": ["x.estate.json"] if tests or files else []}


def test_the_1228_case_is_a_mismatch_with_the_exact_fix():
    v = ffc.verdict("estate", _side(4229 + 15, 300), _side(4229, 300), _frag())
    assert v["state"] == "mismatch" and v["delta_tests"] == 15
    assert v["fix"] == 'python backend/scripts/rederive_floor.py --lane estate --add 15 --note "<what the tests are>"'


def test_a_missing_file_count_is_caught_on_a_files_lane_but_never_on_estate():
    v = ffc.verdict("chain", _side(107, 21), _side(100, 20), _frag(7, 0))       # the #1268 case
    assert v["state"] == "mismatch" and "--add 7 --add-files 1" in v["fix"]
    assert ffc.verdict("chain", _side(107, 21), _side(100, 20), _frag(7, 1))["state"] == "ok"
    assert ffc.verdict("estate", _side(107, 21), _side(100, 20), _frag(7, 0))["state"] == "ok"   # no estate file floor


def test_over_declaring_is_a_mismatch_too():
    v = ffc.verdict("guards", _side(100, 10), _side(100, 10), _frag(5, 0))
    assert v["state"] == "mismatch" and "--add 0" in v["fix"]


def test_a_shrinking_lane_is_reported_never_fixed_with_a_negative_fragment():
    v = ffc.verdict("chain", _side(95, 20), _side(100, 20), _frag())
    assert v["state"] == "shrinks" and "fix" not in v


def test_a_collection_error_is_inconclusive_not_a_pass():
    v = ffc.verdict("estate", _side(100, 10, ["tests/test_x.py"]), _side(100, 10), _frag())
    assert v["state"] == "inconclusive" and "tests/test_x.py" in v["why"]


def test_a_fragments_only_catch_up_pr_is_not_checked():
    assert ffc.fragments_only([".github/ci-floors.d/claude-chain-floor-catchup-1124.chain.json"])
    assert not ffc.fragments_only([".github/ci-floors.d/a.chain.json", "backend/tests/test_a.py"])
    assert not ffc.fragments_only([])


def test_own_fragments_reads_only_what_the_pr_added_or_changed(tmp_path, monkeypatch):
    """A throwaway git repo: a fragment already on the base is not the PR's; the PR's new one is."""
    def git(*a):
        subprocess.run(["git", *a], cwd=tmp_path, check=True, capture_output=True)
    git("init", "-q")
    git("config", "user.email", "t@example.invalid")
    git("config", "user.name", "t")
    d = tmp_path / ".github" / "ci-floors.d"
    d.mkdir(parents=True)
    (d / "old.chain.json").write_text(json.dumps({"lane": "chain", "tests": 4, "files": 1}), encoding="utf-8")
    git("add", "-A")
    git("commit", "-qm", "base")
    base = subprocess.run(["git", "rev-parse", "HEAD"], cwd=tmp_path, capture_output=True, text=True).stdout.strip()
    (d / "mine.estate.json").write_text(json.dumps({"lane": "estate", "tests": 15}), encoding="utf-8")
    (d / "mine.frontend.json").write_text(json.dumps({"lane": "frontend", "tests": 9, "files": 1}), encoding="utf-8")
    git("add", "-A")
    git("commit", "-qm", "pr")
    monkeypatch.setattr(ffc, "REPO", tmp_path)
    got = ffc.own_fragments(base)
    assert got["estate"]["tests"] == 15 and got["chain"] == {"tests": 0, "files": 0, "names": []}
    assert "frontend" not in got                                              # Jest: not this check's


def test_the_report_names_the_fix():
    rows = [dict(ffc.verdict("estate", _side(115, 0), _side(100, 0), _frag()), merge_base="f37de972a" * 4)]
    text = ffc.report(rows)
    assert "| estate | 15 | 0 | 0 | 0 | mismatch |" in text and "rederive_floor.py --lane estate --add 15" in text


def test_ci_runs_it_on_pull_requests_report_only_with_full_history_and_the_deps():
    doc = yaml.safe_load(CI.read_text(encoding="utf-8"))
    job = doc["jobs"]["backend-floor-fragment-check"]
    assert "pull_request" in job["if"] and "docs_only" in job["if"]
    steps = job["steps"]
    assert steps[0]["with"]["fetch-depth"] == 0
    run = next(s for s in steps if "floor_fragment_check.py" in (s.get("run") or ""))
    assert "--base \"origin/$BASE_REF\"" in run["run"] and "FLOOR_FRAGMENT_CHECK" in run["run"]
    assert run["env"]["FLOOR_FRAGMENT_CHECK"] == "${{ vars.FLOOR_FRAGMENT_CHECK || 'report' }}"
    assert any("requirements.txt" in (s.get("run") or "") for s in steps)


@pytest.mark.parametrize("state", ["ok", "mismatch", "inconclusive", "shrinks", "fragments-only"])
def test_report_only_never_fails(monkeypatch, state):
    row = {"lane": "estate", "state": state, "why": "w", "fix": "f", "delta_tests": 1, "delta_files": 0, "frag_tests": 0,
           "frag_files": 0, "fragments": [], "errors": [], "merge_base": "a" * 40}
    monkeypatch.setattr(ffc, "run", lambda base: [row])
    assert ffc.main(["--report-only"]) == 0
    want = {"ok": 0, "mismatch": 1, "inconclusive": 3, "shrinks": 0, "fragments-only": 0}[state]
    assert ffc.main([]) == want
