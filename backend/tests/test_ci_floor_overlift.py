"""ci_floor_overlift.py: a fragments-only PR may not lift a floor above what dev last observed (advisor, #1227).

Pinned with a real temporary git repository (no network: the hosted reading is patched in):
  * an exact single catch-up passes; the same lag caught up twice (a human's catch-up merged after the reading, then
    the bot's) fails;
  * a feature PR's fragment merged after the reading (it came WITH tests) is not counted against the reading;
  * a PR that is not fragments-only, and a non-PR checkout, are skipped with the reason.
"""
import json
import os
import shutil
import subprocess
import sys

import pytest

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

from scripts import ci_floor_fragments as F    # noqa: E402
from scripts import ci_floor_overlift as OV    # noqa: E402
from scripts import ci_floor_staleness as S    # noqa: E402

REAL_CI = os.path.join(os.path.dirname(BACKEND), ".github", "workflows", "ci.yml")


# ── PURE ────────────────────────────────────────────────────────────────────────────────────────────────────────
def test_fragment_only_detection():
    assert OV.is_fragment_only([".github/ci-floors.d/bot-x.chain.json"])
    assert not OV.is_fragment_only([])
    assert not OV.is_fragment_only([".github/ci-floors.d/bot-x.chain.json", "docs/a.md"])
    assert not OV.is_fragment_only([".github/ci-floors.d/sub/bot-x.chain.json"])
    assert not OV.is_fragment_only([".github/ci-floors.d/README.md"])
    assert OV.lanes_of([".github/ci-floors.d/a.chain.json", ".github/ci-floors.d/b.frontend.json"]) == ["chain"]


def test_violations_exact_passes_one_over_fails():
    floors = {"chain": {"passed": 100, "files": 20}}
    budget = S.LANES["chain"]["passed_budget"]
    assert OV.violations(floors, {"chain": (20, 100 + budget)}, ["chain"]) == []
    assert OV.violations(floors, {"chain": (20, 100 + budget - 1)}, ["chain"])[0][:2] == (
        "chain", "set-from (MIN_PASSED + margin)")
    assert OV.violations(floors, {"chain": (19, 100 + budget)}, ["chain"]) == [("chain", "MIN_FILES", 20, 19)]


# ── a real git history ───────────────────────────────────────────────────────────────────────────────────────────
@pytest.fixture
def repo(tmp_path, monkeypatch):
    for k in ("GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"):
        monkeypatch.delenv(k, raising=False)
    cfg = tmp_path / "gitconfig"
    cfg.write_text("")
    monkeypatch.setenv("GIT_CONFIG_GLOBAL", str(cfg))
    monkeypatch.setenv("GIT_CONFIG_NOSYSTEM", "1")
    for k in ("AUTHOR", "COMMITTER"):
        monkeypatch.setenv(f"GIT_{k}_NAME", "floor-test")
        monkeypatch.setenv(f"GIT_{k}_EMAIL", "floor-test@example.invalid")
    d = tmp_path / "r"
    (d / ".github" / "workflows").mkdir(parents=True)
    shutil.copy(REAL_CI, d / ".github" / "workflows" / "ci.yml")
    shutil.copytree(F.FRAG_DIR, d / ".github" / "ci-floors.d")
    (d / "backend").mkdir()
    (d / "backend" / "x.py").write_text("x = 1\n")
    _git(d, "init", "-q", "-b", "dev")
    _commit(d, "R: the last green dev run")
    return d


def _git(d, *args):
    return subprocess.run(["git", *args], cwd=d, check=True, capture_output=True, text=True).stdout.strip()


def _commit(d, msg):
    _git(d, "add", "-A")
    _git(d, "commit", "-q", "-m", msg)
    return _git(d, "rev-parse", "HEAD")


def _frag(d, name, lane, tests, files=0):
    data = {"lane": lane, "tests": tests, "branch": name, "date": "2026-11-23"}
    if lane != "estate":
        data["files"] = files
    (d / ".github" / "ci-floors.d" / f"{F.slug(name)}.{lane}.json").write_text(json.dumps(data))


def _pr(d, base_sha, setup):
    """Build a PR merge checkout: branch from base_sha, apply setup, merge into the current dev tip (HEAD^1)."""
    dev_tip = _git(d, "rev-parse", "HEAD")
    _git(d, "checkout", "-q", "-b", "pr", base_sha)
    setup()
    _commit(d, "PR")
    _git(d, "checkout", "-q", "--detach", dev_tip)
    _git(d, "merge", "-q", "--no-ff", "--no-edit", "pr")


def _patch(monkeypatch, r_sha, reading):
    monkeypatch.setattr(S, "last_green_run", lambda branch, now=None: (999, r_sha, "2026-11-23T00:00:00Z"))
    monkeypatch.setattr(S, "observed", lambda run_id, lane: reading[lane])


def _reading_with_lag(d, r_sha, lane, lag_tests):
    """What lane `lane` 'observed' at R: its floor at R + margin + lag (so a catch-up of `lag_tests` is exact)."""
    floors = OV.floors_at(r_sha, [], "HEAD", cwd=str(d))
    reading = {ln: (floors[ln]["files"], floors[ln]["passed"] + S.LANES[ln]["passed_budget"]) for ln in S.LANES}
    files, passed = reading[lane]
    reading[lane] = (files, passed + lag_tests)
    return reading


def test_an_exact_single_catchup_passes(repo, monkeypatch):
    r = _git(repo, "rev-parse", "HEAD")
    _patch(monkeypatch, r, _reading_with_lag(repo, r, "chain", 9))
    _pr(repo, r, lambda: _frag(repo, "bot/floor-catchup-1", "chain", 9))
    assert OV.judge(cwd=str(repo), branch="dev", log=lambda *_: None) == 0


def test_a_double_catchup_fails(repo, monkeypatch):
    r = _git(repo, "rev-parse", "HEAD")
    _patch(monkeypatch, r, _reading_with_lag(repo, r, "chain", 9))
    _frag(repo, "claude/chain-floor-catchup", "chain", 9)          # a human's catch-up merged after the reading
    _commit(repo, "human catch-up (fragments only)")
    _pr(repo, r, lambda: _frag(repo, "bot/floor-catchup-1", "chain", 9))
    msgs = []
    assert OV.judge(cwd=str(repo), branch="dev", log=msgs.append) == 1
    assert any("::error::chain" in m for m in msgs)


def test_an_over_lift_in_the_pr_alone_fails(repo, monkeypatch):
    r = _git(repo, "rev-parse", "HEAD")
    _patch(monkeypatch, r, _reading_with_lag(repo, r, "estate", 4))
    _pr(repo, r, lambda: _frag(repo, "bot/floor-catchup-1", "estate", 5))
    assert OV.judge(cwd=str(repo), branch="dev", log=lambda *_: None) == 1


def test_a_feature_prs_fragment_after_the_reading_is_not_counted(repo, monkeypatch):
    r = _git(repo, "rev-parse", "HEAD")
    _patch(monkeypatch, r, _reading_with_lag(repo, r, "chain", 9))
    _frag(repo, "claude/feature-with-tests", "chain", 30)           # came WITH tests the reading has not seen
    (repo / "backend" / "x.py").write_text("x = 2\n")
    _commit(repo, "feature PR: code + its fragment")
    _pr(repo, r, lambda: _frag(repo, "bot/floor-catchup-1", "chain", 9))
    assert OV.judge(cwd=str(repo), branch="dev", log=lambda *_: None) == 0


def test_a_pr_that_is_not_fragments_only_is_skipped(repo, monkeypatch):
    r = _git(repo, "rev-parse", "HEAD")
    _patch(monkeypatch, r, _reading_with_lag(repo, r, "chain", 0))

    def setup():
        _frag(repo, "claude/feature", "chain", 500)
        (repo / "backend" / "x.py").write_text("x = 3\n")
    _pr(repo, r, setup)
    msgs = []
    assert OV.judge(cwd=str(repo), branch="dev", log=msgs.append) == 0
    assert "not a fragments-only PR" in msgs[0]


def test_a_non_pr_checkout_is_skipped(repo):
    msgs = []
    assert OV.judge(cwd=str(repo), branch="dev", log=msgs.append) == 0
    assert "not a PR merge checkout" in msgs[0]
