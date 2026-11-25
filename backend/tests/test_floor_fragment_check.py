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
    assert run["env"]["FLOOR_FRAGMENT_CHECK"] == "${{ vars.FLOOR_FRAGMENT_CHECK || 'block' }}"   # step b: blocking
    assert '--pr "$PR_NUMBER"' in run["run"] and "gh pr view" in run["run"]           # labels read live
    assert any("requirements.txt" in (s.get("run") or "") for s in steps)


@pytest.mark.parametrize("state", ["ok", "mismatch", "inconclusive", "shrinks", "fragments-only"])
def test_report_only_never_fails(monkeypatch, state):
    row = {"lane": "estate", "state": state, "why": "w", "fix": "f", "delta_tests": 1, "delta_files": 0, "frag_tests": 0,
           "frag_files": 0, "fragments": [], "errors": [], "merge_base": "a" * 40}
    monkeypatch.setattr(ffc, "run", lambda base: [row])
    assert ffc.main(["--report-only"]) == 0
    want = {"ok": 0, "mismatch": 1, "inconclusive": 1, "shrinks": 0, "fragments-only": 0}[state]   # unknown FAILS (after a retry)
    assert ffc.main([]) == want


def test_a_deleted_fragment_is_found_and_warned_never_blocking(tmp_path, monkeypatch, capsys):
    """Advisor L2 on #1277: deleting a fragment lowers a floor; it is WARNED about, and never fails the check."""
    def git(*a):
        subprocess.run(["git", *a], cwd=tmp_path, check=True, capture_output=True)
    git("init", "-q")
    git("config", "user.email", "t@example.invalid")
    git("config", "user.name", "t")
    d = tmp_path / ".github" / "ci-floors.d"
    d.mkdir(parents=True)
    (d / "theirs.estate.json").write_text(json.dumps({"lane": "estate", "tests": 3}), encoding="utf-8")
    git("add", "-A")
    git("commit", "-qm", "base")
    base = subprocess.run(["git", "rev-parse", "HEAD"], cwd=tmp_path, capture_output=True, text=True).stdout.strip()
    (d / "theirs.estate.json").unlink()
    git("add", "-A")
    git("commit", "-qm", "pr deletes a fragment")
    monkeypatch.setattr(ffc, "REPO", tmp_path)
    assert ffc.deleted_fragments(base) == ["theirs.estate.json"]
    row = {"lane": "estate", "state": "ok", "why": "", "delta_tests": 0, "delta_files": 0, "frag_tests": 0,
           "frag_files": 0, "fragments": [], "errors": [], "merge_base": "a" * 40,
           "deleted_fragments": ["theirs.estate.json"]}
    monkeypatch.setattr(ffc, "run", lambda b: [row])
    assert ffc.main([]) == 0                                                   # blocking mode still passes
    out = capsys.readouterr().out
    assert "::warning title=Floor fragment deleted::this PR deletes theirs.estate.json" in out
    assert "**Deleted fragment(s)**" in ffc.report([row])


def test_the_job_sits_above_the_staleness_comment_and_declares_no_permissions():
    """Advisor L3 on #1277: the staleness job's comment block (which says `permissions:` is declared only there) must
    stay attached to that job."""
    text = CI.read_text(encoding="utf-8")
    ours, staleness = text.index("\n  backend-floor-fragment-check:\n"), text.index("\n  backend-floor-staleness:\n")
    between = text[ours:staleness]
    assert "THE RATCHETS ABOVE DO NOT WATCH THEMSELVES" in between                # the staleness comment follows our job
    assert "PR-TIME FLOOR FRAGMENT CHECK" in text[:ours]                          # our comment precedes it
    assert "permissions" not in yaml.safe_load(text)["jobs"]["backend-floor-fragment-check"]


def _decision(pr=1294, why="the parametrized workflow test grew by one; catch-up #1309 already covers it",
              auth="director session local_d6b521eb", kind="decision"):
    return json.dumps({"kind": kind, "target": f"floor-fragment-override #{pr}", "why": why, "authorized_by": auth})


def test_an_override_needs_the_label_and_a_ledgered_reason_authorized_by_david_or_the_director():
    lab = [ffc.OVERRIDE_LABEL]
    assert ffc.override_ok(1294, lab, [_decision()])[0]
    assert ffc.override_ok(1294, lab, [_decision(auth="David (owner), typed in chat")])[0]
    assert not ffc.override_ok(1294, [], [_decision()])[0]                                  # no label
    assert not ffc.override_ok(1294, lab, [])[0]                                            # no ledger line
    assert not ffc.override_ok(1294, lab, [_decision(auth="claude (reliability lane)")])[0]  # the author lane alone
    assert not ffc.override_ok(1294, lab, [_decision(why="ok")])[0]                         # no written reason
    assert not ffc.override_ok(1294, lab, [_decision(pr=1295)])[0]                          # another PR's override
    assert not ffc.override_ok(12945, lab, [_decision(pr=1294)])[0] and not ffc.override_ok(1294, lab, [_decision(pr=12945)])[0]
    assert not ffc.override_ok(1294, lab, [_decision(kind="finding")])[0]
    assert not ffc.override_ok(1294, lab, ["{not json"])[0]


def test_blocking_mode_fails_a_mismatch_unless_overridden(monkeypatch, capsys):
    row = {"lane": "estate", "state": "mismatch", "why": "w", "fix": "f", "delta_tests": 5, "delta_files": 0,
           "frag_tests": 4, "frag_files": 0, "fragments": [], "errors": [], "merge_base": "a" * 40}
    monkeypatch.setattr(ffc, "run", lambda b: [row])
    monkeypatch.setattr(ffc, "_pr_ledger_lines", lambda b: [_decision()])
    assert ffc.main(["--pr", "1294"]) == 1                                                  # no label: red
    assert "::error title=Floor fragment mismatch" in capsys.readouterr().out
    assert ffc.main(["--pr", "1294", "--labels", "bug," + ffc.OVERRIDE_LABEL]) == 0          # label + ledger: green
    out = capsys.readouterr().out
    assert "::warning title=Floor fragment override::overridden" in out and "::error" not in out
    assert ffc.main(["--pr", "1294", "--labels", ffc.OVERRIDE_LABEL, "--report-only"]) == 0


def test_the_authorizer_must_start_with_david_or_the_director():
    """Advisor limit 2 on #1311: a mention anywhere is not an authorization."""
    lab = [ffc.OVERRIDE_LABEL]
    for auth in ("not the director", "claude (reliability lane), asked the director", "per David's lane", "directorate"):
        assert not ffc.override_ok(1294, lab, [_decision(auth=auth)])[0], auth
    for auth in ("director session local_d6b521eb", "Director", "  David (owner), typed in chat", "david"):
        assert ffc.override_ok(1294, lab, [_decision(auth=auth)])[0], auth


# ---- David's "Yes, block + fix" (SubQ + Reflection: fail-open on unknown was a loophole): unknown retries once, then
# fails through the SAME override path as a mismatch. ----

def _row(state, lane="estate"):
    return {"lane": lane, "state": state, "why": "w", "fix": "f", "delta_tests": 0, "delta_files": 0, "frag_tests": 0,
            "frag_files": 0, "fragments": [], "errors": [], "merge_base": "a" * 40}


def _sequence(monkeypatch, *outcomes):
    """run() returns/raises each outcome in turn; counts the calls."""
    calls = {"n": 0}

    def fake(base):
        o = outcomes[min(calls["n"], len(outcomes) - 1)]
        calls["n"] += 1
        if isinstance(o, Exception):
            raise o
        return o
    monkeypatch.setattr(ffc, "run", fake)
    monkeypatch.setattr(ffc, "_pr_ledger_lines", lambda b: [_decision()])
    return calls


def test_unknown_then_success_passes_after_one_retry(monkeypatch, capsys):
    calls = _sequence(monkeypatch, RuntimeError("collection crashed"), [_row("ok")])
    assert ffc.main(["--pr", "1294"]) == 0 and calls["n"] == 2
    assert "::notice title=Floor fragment check retry" in capsys.readouterr().out
    calls = _sequence(monkeypatch, [_row("inconclusive")], [_row("ok")])                 # an inconclusive lane too
    assert ffc.main(["--pr", "1294"]) == 0 and calls["n"] == 2


def test_unknown_twice_fails_and_says_so(monkeypatch, capsys):
    calls = _sequence(monkeypatch, RuntimeError("boom"), RuntimeError("boom again"))
    assert ffc.main(["--pr", "1294"]) == 1 and calls["n"] == 2                          # exactly one retry
    out = capsys.readouterr().out
    assert "::error title=Floor fragment check unknown after one retry::RuntimeError: boom again" in out
    # the message names BOTH escapes, so a repo-wide breakage cannot deadlock every PR (advisor, #1311)
    assert f"for THIS PR, the {ffc.OVERRIDE_LABEL} label + a ledger decision line" in out
    assert "REPO-WIDE breakage" in out and "FLOOR_FRAGMENT_CHECK=report" in out
    calls = _sequence(monkeypatch, [_row("inconclusive")], [_row("inconclusive")])
    assert ffc.main(["--pr", "1294"]) == 1 and calls["n"] == 2


def test_unknown_with_a_valid_override_passes(monkeypatch, capsys):
    _sequence(monkeypatch, RuntimeError("boom"), RuntimeError("boom"))
    assert ffc.main(["--pr", "1294", "--labels", ffc.OVERRIDE_LABEL]) == 0
    assert "::warning title=Floor fragment override::overridden" in capsys.readouterr().out
    _sequence(monkeypatch, RuntimeError("boom"), RuntimeError("boom"))
    assert ffc.main(["--pr", "1294", "--report-only"]) == 0                              # FLOOR_FRAGMENT_CHECK=report


def test_no_relevant_change_passes_without_a_retry(monkeypatch):
    calls = _sequence(monkeypatch, [_row("ok", lane) for lane in ("guards", "chain", "estate")])
    assert ffc.main(["--pr", "1294"]) == 0 and calls["n"] == 1
    calls = _sequence(monkeypatch, [_row("fragments-only", lane) for lane in ("guards", "chain", "estate")])
    assert ffc.main(["--pr", "1294"]) == 0 and calls["n"] == 1
