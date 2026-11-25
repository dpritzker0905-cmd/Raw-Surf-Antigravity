"""floor_catchup.py: an automatic, fragments-only CI floor catch-up after a green dev run (owner, 2026-11-23).

Pinned here, offline (no network, no real git or gh: both are a recording fake):
  * a stale lane gives exactly the fragment ci_floor_staleness.py prescribes (set-from lands ON the reading);
  * a current tree gives nothing: no branch, no PR;
  * no plan, for any floor/reading pair, lifts a floor above the reading or lowers one;
  * a second run UPDATES the open catch-up PR (same branch, same fragment file, replaced) instead of opening another;
  * a run that finds nothing stale closes an open catch-up PR instead of leaving it to over-lift on merge;
  * only this bot's own fragments may change, and its earlier fragments are never counted twice.
"""
import itertools
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
from scripts import ci_floor_staleness as S    # noqa: E402
from scripts import floor_catchup as C         # noqa: E402

RUN, SHA = 45168429884, "0123456789abcdef0123456789abcdef01234567"


@pytest.fixture
def frag_dir(tmp_path):
    """A private copy of the real fragment directory: the real one is never written."""
    d = tmp_path / "ci-floors.d"
    shutil.copytree(F.FRAG_DIR, d)
    return str(d)


def _floors(frag_dir):
    return S.effective_floors(frag_dir=frag_dir)


def _current(floors):
    """Readings that make every lane exactly current (lag == budget for passed, == 0 for files)."""
    return {lane: (floors[lane]["files"], floors[lane]["passed"] + S.LANES[lane]["passed_budget"])
            for lane in S.LANES}


class FakeShell:
    """Records every git/gh call; answers the few whose output the script reads."""

    def __init__(self, frag_dir, prs=(), branch_extra=()):
        self.frag_dir, self.prs, self.calls = frag_dir, [dict(p) for p in prs], []
        self.branch_extra = list(branch_extra)     # paths a human (or a bad merge) put on the bot branch
        self.snapshot = self._files()
        self.pushed = False

    def _files(self):
        out = {}
        for n in os.listdir(self.frag_dir):
            with open(os.path.join(self.frag_dir, n), encoding="utf-8") as f:
                out[n] = f.read()
        return out

    def __call__(self, cmd, cwd=None, check=True):
        self.calls.append(cmd)
        if cmd[:3] == ["gh", "pr", "list"]:
            return json.dumps(self.prs)
        if cmd[:2] == ["git", "status"]:
            now, then = self._files(), self.snapshot
            return "".join(f" M {C.FRAG_REL}/{n}\n" for n in sorted(set(now) | set(then)) if now.get(n) != then.get(n))
        if cmd[0] == "git" and "commit" in cmd:
            self.snapshot = self._files()
        if cmd[:3] == ["git", "diff", "--name-only"]:   # the branch vs dev at the run's sha: the bot's own fragments
            own = [f"{C.FRAG_REL}/{n}" for n in sorted(self._files()) if n.startswith(F.slug(C.BRANCH_PREFIX))]
            return chr(10).join(own + self.branch_extra)
        if cmd[:2] == ["git", "rev-list"]:
            return "0"
        if cmd[:3] == ["gh", "pr", "create"]:
            self.prs.append({"number": 9001, "headRefName": cmd[cmd.index("--head") + 1]})
        if cmd[:3] == ["gh", "pr", "close"]:
            self.prs = [p for p in self.prs if str(p["number"]) != cmd[3]]
        return ""

    def named(self, *prefix):
        return [c for c in self.calls if c[:len(prefix)] == list(prefix)]


# ── the plan ─────────────────────────────────────────────────────────────────────────────────────────────────────
def test_a_stale_lane_gives_the_fragment_the_staleness_check_prescribes(frag_dir):
    floors = _floors(frag_dir)
    readings = _current(floors)
    g = floors["guards"]
    readings["guards"] = (g["files"] + 2, g["passed"] + S.LANES["guards"]["passed_budget"] + 17)
    readings["estate"] = (None, floors["estate"]["passed"] + S.LANES["estate"]["passed_budget"] + 5)
    items = C.plan(floors, readings)
    assert [(p["lane"], p["tests"], p["files"]) for p in items] == [("estate", 5, 0), ("guards", 17, 2)]
    for p in items:   # set-from = floor + tests + margin lands EXACTLY on the reading
        assert p["floor_passed"] + p["tests"] + p["budget"] == p["obs_passed"]


def test_a_current_tree_plans_nothing(frag_dir):
    floors = _floors(frag_dir)
    assert C.plan(floors, _current(floors)) == []


def test_lag_within_the_margin_is_not_stale_and_plans_nothing(frag_dir):
    floors = _floors(frag_dir)
    readings = {lane: (floors[lane]["files"], floors[lane]["passed"] + 1) for lane in S.LANES}
    assert C.plan(floors, readings) == []


@pytest.mark.parametrize("dp,df", list(itertools.product([-40, -1, 0, 1, 6, 7, 300], [-3, 0, 1, 9])))
def test_no_plan_ever_lifts_a_floor_above_the_reading_or_lowers_one(frag_dir, dp, df):
    floors = _floors(frag_dir)
    readings = {}
    for lane in S.LANES:
        f = floors[lane]
        readings[lane] = (None if f["files"] is None else max(0, f["files"] + df),
                          max(0, f["passed"] + S.LANES[lane]["passed_budget"] + dp))
    for p in C.plan(floors, readings):
        assert p["tests"] >= 0 and p["files"] >= 0 and (p["tests"] or p["files"])
        if p["tests"]:     # a fragment that moves the pass floor never lifts its set-from past the reading
            assert p["floor_passed"] + p["tests"] + p["budget"] <= p["obs_passed"]
        if p["files"]:
            assert p["floor_files"] + p["files"] <= p["obs_files"]


def test_a_stale_file_count_alone_moves_only_the_file_floor(frag_dir):
    floors = _floors(frag_dir)
    readings = {lane: (floors[lane]["files"], floors[lane]["passed"]) for lane in S.LANES}   # passed AHEAD of set-from
    readings["chain"] = (floors["chain"]["files"] + 1, floors["chain"]["passed"])
    assert [(p["lane"], p["tests"], p["files"]) for p in C.plan(floors, readings)] == [("chain", 0, 1)]


@pytest.mark.parametrize("bad", [{"tests": -1}, {"tests": 99}, {"files": 50}, {"tests": 0, "files": 0}])
def test_check_plan_refuses_a_lowering_an_over_lift_or_an_empty_fragment(bad):
    p = {"lane": "chain", "tests": 3, "files": 1, "floor_passed": 100, "obs_passed": 109,
         "floor_files": 10, "obs_files": 11, "budget": 6}
    p.update(bad)
    with pytest.raises(C.Refusal):
        C.check_plan([p])


def test_only_this_bots_own_fragments_may_change():
    b = "bot/floor-catchup-1"
    C.assert_only_own_fragments([f"{C.FRAG_REL}/bot-floor-catchup-1.chain.json"], b)
    for bad in (".github/workflows/ci.yml", f"{C.FRAG_REL}/claude-other.chain.json",
                f"{C.FRAG_REL}/bot-floor-catchup-1.chain.json/x", "backend/x.py"):
        with pytest.raises(C.Refusal):
            C.assert_only_own_fragments([bad], b)


def test_the_bots_earlier_fragments_are_not_counted_twice(frag_dir):
    base = _floors(frag_dir)
    branch = "bot/floor-catchup-7"
    with open(os.path.join(frag_dir, f"{F.slug(branch)}.chain.json"), "w", encoding="utf-8") as f:
        json.dump({"lane": "chain", "tests": 40, "files": 0, "branch": branch, "date": "2026-11-23"}, f)
    assert _floors(frag_dir)["chain"]["passed"] == base["chain"]["passed"] + 40
    assert C.floors_without(branch, frag_dir) == base


# ── execute: the side effects ────────────────────────────────────────────────────────────────────────────────────
def _stale_readings(frag_dir, extra=12):
    floors = _floors(frag_dir)
    readings = _current(floors)
    readings["chain"] = (floors["chain"]["files"], floors["chain"]["passed"] + S.LANES["chain"]["passed_budget"] + extra)
    return readings


def test_nothing_stale_and_no_open_pr_does_nothing(frag_dir):
    sh = FakeShell(frag_dir)
    assert C.execute(RUN, SHA, _current(_floors(frag_dir)), run=sh, frag_dir=frag_dir, log=lambda *_: None) == "nothing"
    assert not sh.named("git", "push") and not sh.named("gh", "pr", "create") and not sh.named("git", "commit")
    assert sh._files() == sh.snapshot


def test_a_stale_run_opens_one_pr_with_one_fragment_per_stale_lane(frag_dir):
    sh = FakeShell(frag_dir)
    assert C.execute(RUN, SHA, _stale_readings(frag_dir), run=sh, frag_dir=frag_dir, log=lambda *_: None) == "opened"
    assert len(sh.named("gh", "pr", "create")) == 1
    branch = f"{C.BRANCH_PREFIX}{RUN}"
    assert C.own_fragments(branch, frag_dir) == [f"{F.slug(branch)}.chain.json"]
    with open(os.path.join(frag_dir, f"{F.slug(branch)}.chain.json"), encoding="utf-8") as f:
        assert json.load(f)["tests"] == 12
    push = sh.named("git", "push")
    assert push == [["git", "push", "origin", f"HEAD:refs/heads/{branch}"]]
    assert not any("--force" in c or "-f" in c for c in sh.calls if c[:2] == ["git", "push"])


def test_a_second_run_updates_the_open_pr_instead_of_opening_another(frag_dir):
    sh = FakeShell(frag_dir)
    C.execute(RUN, SHA, _stale_readings(frag_dir, 12), run=sh, frag_dir=frag_dir, log=lambda *_: None)
    first_branch = f"{C.BRANCH_PREFIX}{RUN}"
    # dev grew further: a later green run reads 5 more; the bot's own fragment is still only on its branch
    later = RUN + 1000
    os.remove(os.path.join(frag_dir, f"{F.slug(first_branch)}.chain.json"))     # the dev checkout lacks it ...
    readings = _stale_readings(frag_dir, 17)
    with open(os.path.join(frag_dir, f"{F.slug(first_branch)}.chain.json"), "w", encoding="utf-8") as f:
        json.dump({"lane": "chain", "tests": 12, "files": 0, "branch": first_branch, "date": "2026-11-23"}, f)
    sh.snapshot = sh._files()                                                     # ... the merged branch has it
    assert C.execute(later, SHA, readings, run=sh, frag_dir=frag_dir, log=lambda *_: None) == "updated"
    assert len(sh.named("gh", "pr", "create")) == 1, "a second PR was opened"
    assert len(sh.named("gh", "pr", "edit")) == 1
    assert C.own_fragments(first_branch, frag_dir) == [f"{F.slug(first_branch)}.chain.json"]
    with open(os.path.join(frag_dir, f"{F.slug(first_branch)}.chain.json"), encoding="utf-8") as f:
        assert json.load(f)["tests"] == 17, "replaced to the new reading, not stacked on the old fragment"
    assert sh.named("git", "push")[-1] == ["git", "push", "origin", f"HEAD:refs/heads/{first_branch}"]


def test_the_same_run_twice_pushes_nothing_the_second_time(frag_dir):
    sh = FakeShell(frag_dir)
    readings = _stale_readings(frag_dir)
    C.execute(RUN, SHA, readings, run=sh, frag_dir=frag_dir, log=lambda *_: None)
    pushes = len(sh.named("git", "push"))
    assert C.execute(RUN, SHA, readings, run=sh, frag_dir=frag_dir, log=lambda *_: None) == "unchanged"
    assert len(sh.named("git", "push")) == pushes and len(sh.named("gh", "pr", "create")) == 1


def test_an_open_catchup_pr_is_closed_when_nothing_is_stale_any_more(frag_dir):
    branch = f"{C.BRANCH_PREFIX}{RUN}"
    with open(os.path.join(frag_dir, f"{F.slug(branch)}.chain.json"), "w", encoding="utf-8") as f:   # committed on the branch
        json.dump({"lane": "chain", "tests": 12, "files": 0, "branch": branch, "date": "2026-11-23"}, f)
    sh = FakeShell(frag_dir, prs=[{"number": 77, "headRefName": branch}])
    base = C.floors_without(branch, frag_dir)
    assert C.execute(RUN + 5, SHA, _current(base), run=sh, frag_dir=frag_dir, log=lambda *_: None) == "closed"
    assert sh.named("gh", "pr", "close")[0][:4] == ["gh", "pr", "close", "77"]
    assert not sh.named("git", "push") and not sh.named("gh", "pr", "create")


def test_a_dry_run_touches_nothing(frag_dir):
    sh = FakeShell(frag_dir)
    assert C.execute(RUN, SHA, _stale_readings(frag_dir), run=sh, frag_dir=frag_dir, dry_run=True,
                     log=lambda *_: None) == "dry-run"
    assert [c[:3] for c in sh.calls] == [["gh", "pr", "list"]]
    assert sh._files() == sh.snapshot


def test_pr_writes_use_the_pat_and_reads_keep_github_token(monkeypatch):
    seen = {}

    def fake_run(cmd, **kw):
        seen[cmd[1]] = (kw.get("env") or os.environ).get("GH_TOKEN")

        class P:
            returncode, stdout, stderr = 0, "", ""
        return P()
    monkeypatch.setenv("GH_TOKEN", "read-token")
    monkeypatch.setenv("PR_TOKEN", "pat-token")
    monkeypatch.setattr(C.subprocess, "run", fake_run)
    C._run(["gh", "pr", "create"])
    C._run(["gh", "run", "view"])
    assert seen == {"pr": "pat-token", "run": "read-token"}


def test_a_human_edit_on_the_bot_branch_is_refused_and_nothing_is_pushed(frag_dir):
    branch = f"{C.BRANCH_PREFIX}{RUN}"
    sh = FakeShell(frag_dir, prs=[{"number": 77, "headRefName": branch}], branch_extra=["backend/server.py"])
    with pytest.raises(C.Refusal, match="outside this bot"):
        C.execute(RUN + 5, SHA, _stale_readings(frag_dir), run=sh, frag_dir=frag_dir, log=lambda *_: None)
    assert not sh.named("git", "push") and not sh.named("gh", "pr", "edit")


def test_a_newer_green_run_appearing_mid_plan_stops_the_push(frag_dir):
    sh = FakeShell(frag_dir)
    with pytest.raises(C.Refusal, match="newer green dev run"):
        C.execute(RUN, SHA, _stale_readings(frag_dir), run=sh, frag_dir=frag_dir, log=lambda *_: None,
                  still_newest=lambda: False)
    assert not sh.named("git", "push") and not sh.named("gh", "pr", "create")


def test_duplicate_catchup_prs_are_closed_and_only_the_oldest_is_updated(frag_dir):
    sh = FakeShell(frag_dir, prs=[{"number": 80, "headRefName": f"{C.BRANCH_PREFIX}2"},
                                  {"number": 79, "headRefName": f"{C.BRANCH_PREFIX}1"},
                                  {"number": 81, "headRefName": "claude/unrelated"}])
    assert C.execute(RUN, SHA, _stale_readings(frag_dir), run=sh, frag_dir=frag_dir, log=lambda *_: None) == "updated"
    assert [c[3] for c in sh.named("gh", "pr", "close")] == ["80"]
    assert [c[3] for c in sh.named("gh", "pr", "edit")] == ["79"] and not sh.named("gh", "pr", "create")


def test_a_dirty_checkout_is_refused_before_anything_is_written(frag_dir):
    sh = FakeShell(frag_dir)
    with open(os.path.join(frag_dir, "claude-left-behind.chain.json"), "w", encoding="utf-8") as f:
        json.dump({"lane": "chain", "tests": 1, "files": 0, "branch": "claude/left-behind", "date": "2026-11-23"}, f)
    before = sh._files()
    with pytest.raises(C.Refusal, match="not clean"):
        C.execute(RUN, SHA, _stale_readings(frag_dir), run=sh, frag_dir=frag_dir, log=lambda *_: None)
    assert sh._files() == before and not sh.named("git", "push")


def test_the_workflow_acts_only_on_green_dev_pushes_of_this_repository():
    import yaml
    with open(os.path.join(os.path.dirname(BACKEND), ".github", "workflows", "floor-catchup.yml"), encoding="utf-8") as f:
        wf = yaml.safe_load(f)
    cond = wf["jobs"]["catchup"]["if"]
    for needle in ("conclusion == 'success'", "event == 'push'", "head_branch == 'dev'",
                   "head_repository.full_name == github.repository"):
        assert needle in cond
    assert wf["concurrency"]["cancel-in-progress"] is False
    assert "secrets.FLOOR_CATCHUP_PR_TOKEN" in json.dumps(wf) and "ghp_" not in json.dumps(wf)


def test_every_committing_git_call_carries_the_bot_identity(frag_dir):
    branch = f"{C.BRANCH_PREFIX}{RUN}"
    sh = FakeShell(frag_dir, prs=[{"number": 77, "headRefName": branch}])
    C.execute(RUN + 9, SHA, _stale_readings(frag_dir), run=sh, frag_dir=frag_dir, log=lambda *_: None)
    committing = [c for c in sh.calls if c[0] == "git" and ("merge" in c or "commit" in c)]
    assert len(committing) == 2, committing          # the update's merge AND the fragment commit
    for c in committing:
        assert c[1:5] == C.IDENT, c


def test_the_bots_merge_command_works_with_no_git_identity_configured(tmp_path, monkeypatch):
    """A fresh runner has no user.name/email: the real merge must still succeed (advisor, #1227 at 45cdbbf52)."""
    for k in ("GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL",
              "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL", "EMAIL"):
        monkeypatch.delenv(k, raising=False)
    cfg = tmp_path / "empty-gitconfig"
    cfg.write_text("")
    monkeypatch.setenv("GIT_CONFIG_GLOBAL", str(cfg))
    monkeypatch.setenv("GIT_CONFIG_NOSYSTEM", "1")
    d = tmp_path / "r"
    d.mkdir()

    def g(*a):
        return subprocess.run(["git", *a], cwd=d, capture_output=True, text=True)
    g("init", "-q", "-b", "dev")
    ident = C.IDENT
    (d / "a.txt").write_text("a")
    g(*ident, "add", "a.txt")
    assert g(*ident, "commit", "-q", "-m", "base").returncode == 0
    g("checkout", "-q", "-b", "bot")
    (d / "b.txt").write_text("b")
    g("add", "b.txt")
    g(*ident, "commit", "-q", "-m", "bot fragment")
    g("checkout", "-q", "dev")
    (d / "c.txt").write_text("c")
    g("add", "c.txt")
    g(*ident, "commit", "-q", "-m", "dev moved")
    dev_sha = g("rev-parse", "HEAD").stdout.strip()
    g("checkout", "-q", "bot")
    without = g("merge", "--no-edit", "-m", "no identity", dev_sha)
    if without.returncode == 0:                      # this machine has a fallback identity: undo, the point stands below
        g("reset", "-q", "--hard", "HEAD~1")
    merged = subprocess.run(C.merge_cmd(RUN, dev_sha, "bot"), cwd=d, capture_output=True, text=True)
    assert merged.returncode == 0, merged.stderr
    assert g("log", "-1", "--format=%cn").stdout.strip() == "github-actions[bot]"


# ── loud failure (director GO, 2026-11-25): 16 silent `gh pr create` refusals and 16 orphan branches ─────────────────
def test_a_blocked_pr_create_refuses_before_writing_or_pushing_anything(frag_dir):
    sh = FakeShell(frag_dir)
    before = sh._files()
    with pytest.raises(C.Blocked, match="nothing was pushed"):
        C.execute(RUN, SHA, _stale_readings(frag_dir), run=sh, frag_dir=frag_dir, log=lambda *_: None,
                  pr_blocker=lambda: "no PAT")
    assert sh._files() == before
    assert not sh.named("git", "push") and not sh.named("git", "commit") and not sh.named("gh", "pr", "create")


def test_the_blocker_is_not_consulted_when_an_open_pr_is_only_updated(frag_dir):
    branch = f"{C.BRANCH_PREFIX}{RUN}"
    sh = FakeShell(frag_dir, prs=[{"number": 77, "headRefName": branch}])
    assert C.execute(RUN + 5, SHA, _stale_readings(frag_dir), run=sh, frag_dir=frag_dir, log=lambda *_: None,
                     pr_blocker=lambda: "no PAT") == "updated"


def _setting_shell(answer):
    calls = []

    def run(cmd, cwd=None, check=True):
        calls.append(cmd)
        return answer
    return run, calls


@pytest.mark.parametrize("env,answer,blocked", [
    ({}, "", False),                                                                      # local: nothing assumed
    ({"TOKEN_NAME": "FLOOR_CATCHUP_PR_TOKEN", "PR_TOKEN": "x"}, "", False),               # a PAT
    ({"TOKEN_NAME": "GITHUB_TOKEN", "GITHUB_REPOSITORY": "o/r"},
     '{"default_workflow_permissions":"read","can_approve_pull_request_reviews":false}', True),   # 11-23..25
    ({"TOKEN_NAME": "GITHUB_TOKEN", "GITHUB_REPOSITORY": "o/r"}, '{"message":"Resource not accessible"}', True),
    ({"TOKEN_NAME": "GITHUB_TOKEN", "GITHUB_REPOSITORY": "o/r"}, "not json", True),       # unreadable: fail closed
    ({"TOKEN_NAME": "GITHUB_TOKEN", "GITHUB_REPOSITORY": "o/r"}, '{"can_approve_pull_request_reviews":true}', False),
])
def test_pr_create_blocker_reads_the_token_and_the_repo_setting(env, answer, blocked):
    run, _ = _setting_shell(answer)
    reason = C.pr_create_blocker(env, run)
    assert bool(reason) is blocked
    if blocked:
        assert "FLOOR_CATCHUP_PR_TOKEN" in reason


class IssueShell:
    def __init__(self, open_issues=()):
        self.open, self.calls = [{"number": n} for n in open_issues], []

    def __call__(self, cmd, cwd=None, check=True):
        self.calls.append(cmd)
        if cmd[:3] == ["gh", "issue", "list"]:
            return json.dumps(self.open)
        return ""

    def named(self, *prefix):
        return [c for c in self.calls if c[:len(prefix)] == list(prefix)]


def test_a_refusal_opens_one_labelled_issue_assigned_to_the_owner():
    sh = IssueShell()
    assert C.alert(C.Blocked("no PAT"), RUN, sh, {"OWNER": "the-owner", "GITHUB_REPOSITORY": "o/r",
                                                  "GITHUB_RUN_ID": "5"}) == "opened"
    (create,) = sh.named("gh", "issue", "create")
    assert create[create.index("--label") + 1] == C.ALERT_LABEL
    assert create[create.index("--assignee") + 1] == "the-owner"
    body = create[create.index("--body") + 1]
    assert C.PR_BLOCKED in body and "Blocked" in body and str(RUN) in body and "o/r/actions/runs/5" in body


def test_a_second_refusal_comments_on_the_open_issue_instead_of_opening_another():
    sh = IssueShell(open_issues=[42])
    assert C.alert(C.Blocked("no PAT"), RUN, sh, {}) == "commented"
    assert not sh.named("gh", "issue", "create") and sh.named("gh", "issue", "comment")[0][3] == "42"


def test_a_normal_run_closes_the_open_alert_and_does_nothing_when_there_is_none():
    sh = IssueShell(open_issues=[42])
    assert C.clear_alert("nothing", RUN, sh) is True and sh.named("gh", "issue", "close")[0][3] == "42"
    quiet = IssueShell()
    assert C.clear_alert("nothing", RUN, quiet) is False and not quiet.named("gh", "issue", "close")


def test_a_superseded_run_is_a_refusal_but_opens_no_alert(frag_dir, monkeypatch):
    assert issubclass(C.Superseded, C.Refusal)
    sh = FakeShell(frag_dir)
    with pytest.raises(C.Superseded):
        C.execute(RUN, SHA, _stale_readings(frag_dir), run=sh, frag_dir=frag_dir, log=lambda *_: None,
                  still_newest=lambda: False)
    alerts = []
    monkeypatch.setattr(C, "superseded", lambda run_id: None)
    monkeypatch.setattr(C, "_run", lambda cmd, cwd=None, check=True: SHA)
    monkeypatch.setattr(C.S, "observed", lambda run_id, lane: (None, 0))
    monkeypatch.setattr(C, "execute", lambda *a, **k: (_ for _ in ()).throw(C.Superseded("newer run")))
    monkeypatch.setattr(C, "alert", lambda *a, **k: alerts.append(a) or "opened")
    assert C.main(["--run", str(RUN)]) == 1 and alerts == []
    monkeypatch.setattr(C, "execute", lambda *a, **k: (_ for _ in ()).throw(C.Refusal("no PAT")))
    assert C.main(["--run", str(RUN)]) == 1 and len(alerts) == 1


def test_the_workflow_grants_issues_write_and_names_the_owner_variable():
    import yaml
    with open(os.path.join(os.path.dirname(BACKEND), ".github", "workflows", "floor-catchup.yml"), encoding="utf-8") as f:
        wf = yaml.safe_load(f)
    assert wf["permissions"]["issues"] == "write"
    assert "vars.REPO_OWNER_LOGIN" in json.dumps(wf)


# A FAKE, planted token (not a real credential) in each shape the advisor named on #1321.
_FAKE_PAT = "ghp_" + "Z" * 36
_PLANTED = (f"`gh pr create` failed: remote: https://x-access-token:{_FAKE_PAT}@github.com/o/r.git "
            f"github_pat_{'Q' * 30} gho_{'R' * 30} ghs_{'S' * 30} ghr_{'T' * 30} "
            f"eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig PR_TOKEN=planted-pat-value")


@pytest.mark.parametrize("exc", [C.Refusal(_PLANTED), C.Blocked(_PLANTED), C.S.Refusal(_PLANTED),
                                 C.F.FragmentError(_PLANTED)])
@pytest.mark.parametrize("open_issues", [(), (42,)])
def test_no_refusal_text_ever_reaches_the_public_issue(exc, open_issues):
    """Advisor CHANGE on #1321: GitHub masks secrets in logs, not in issue bodies. Whatever a refusal's text carries
    (a planted fake PAT, a credentialled URL, a JWT, an env value), no gh call alert() makes contains any of it."""
    sh = IssueShell(open_issues=open_issues)
    C.alert(exc, RUN, sh, {"OWNER": "o", "GITHUB_REPOSITORY": "o/r", "GITHUB_RUN_ID": "5",
                           "PR_TOKEN": "planted-pat-value"})
    sent = json.dumps(sh.calls)
    for needle in (_FAKE_PAT, "ghp_", "github_pat_", "gho_", "ghs_", "ghr_", "eyJ", "x-access-token",
                   "planted-pat-value", "@github.com", "gh pr create"):
        assert needle not in sent, needle
    assert sh.named("gh", "issue", "comment" if open_issues else "create")

