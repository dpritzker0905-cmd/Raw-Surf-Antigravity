"""E2E waits for the Netlify build a commit actually ships in (2026-11-25, director at David's request: false reds).

Netlify never builds a dev commit whose message carries `[skip netlify]` / `[skip ci]`, so the lane waited 20 min for a
build that could not exist and failed (runs 45470009231, 45501339887, 45510009683). Pins: the verdict rule, the build
path list equals netlify-ignore.cjs's, the real-git behaviour on a throwaway repo (head / earlier / skip), and that the
workflow gates every later step on the verdict so a skip never runs against a stale bundle."""
import re
import subprocess
import sys
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "scripts"))

import e2e_frontend_target as eft  # noqa: E402

ROOT = HERE.parents[1]
WF = ROOT / ".github" / "workflows" / "e2e-tests.yml"
H, E = "b" * 40, "a" * 40


def test_decide():
    assert eft.decide(H, H, [])["verdict"] == "head"
    assert eft.decide(H, "", [])["verdict"] == "head"                                   # shallow history: as before
    d = eft.decide(H, E, ["backend/services/x.py", "docs/a.md"])
    assert (d["verdict"], d["target"], d["skip"]) == ("earlier", E, False)
    d = eft.decide(H, E, ["frontend/src/App.js", "backend/x.py"])
    assert (d["verdict"], d["skip"]) == ("skip", True) and "frontend/src/App.js" in d["reason"]


def test_the_build_path_list_equals_netlify_ignore():
    src = (ROOT / "frontend" / "scripts" / "netlify-ignore.cjs").read_text(encoding="utf-8")
    prefixes = re.findall(r"path\.startsWith\('([^']+)'\)", src)
    files = re.findall(r"'([^']+)'", src[src.index("["):src.index("].includes")])
    assert sorted(prefixes) == sorted(eft.BUILD_PREFIXES)
    assert sorted(files) == sorted(eft.BUILD_FILES)
    for p, want in (("frontend/a.js", True), ("netlify/functions/f.js", True), ("package.json", True),
                    ("backend/a.py", False), ("docs/x.md", False)):
        assert eft.needs_build([p]) is want, p


def _repo(tmp_path):
    def git(*a):
        return subprocess.run(["git", *a], cwd=tmp_path, check=True, capture_output=True, text=True).stdout.strip()
    git("init", "-q")
    git("config", "user.email", "t@example.invalid")
    git("config", "user.name", "t")
    return git


def _commit(git, tmp_path, path, msg):
    f = tmp_path / path
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(msg, encoding="utf-8")
    git("add", "-A")
    git("commit", "-qm", msg)
    return git("rev-parse", "HEAD")


def _run(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    out = subprocess.run([sys.executable, str(HERE.parent / "scripts" / "e2e_frontend_target.py"), "HEAD"],
                         capture_output=True, text=True, check=True).stdout
    return dict(line.split("=", 1) for line in out.strip().split("\n"))


def test_real_git_the_three_cases(tmp_path, monkeypatch):
    git = _repo(tmp_path)
    built = _commit(git, tmp_path, "frontend/a.js", "feat: a frontend change")
    assert _run(tmp_path, monkeypatch) == {"target": built, "verdict": "head", "skip": "false",
                                           "reason": "HEAD is a Netlify build: wait for it"}
    # the false-red case: a backend-only commit tagged [skip netlify] -> wait for the last BUILT commit
    _commit(git, tmp_path, "backend/b.py", "fix(backend): x [skip render] [skip netlify]")
    got = _run(tmp_path, monkeypatch)
    assert (got["target"], got["verdict"], got["skip"]) == (built, "earlier", "false")
    # a skipped commit that changes a built file -> skip, never test the stale bundle
    _commit(git, tmp_path, "frontend/c.js", "feat(ui): y [skip ci]")
    got = _run(tmp_path, monkeypatch)
    assert (got["verdict"], got["skip"]) == ("skip", "true") and "frontend/c.js" in got["reason"]
    # the next built commit ships everything: HEAD again
    head = _commit(git, tmp_path, "frontend/d.js", "feat(ui): z")
    assert _run(tmp_path, monkeypatch)["target"] == head


def test_the_kill_switch_restores_wait_for_head(tmp_path, monkeypatch):
    git = _repo(tmp_path)
    _commit(git, tmp_path, "frontend/a.js", "feat: a")
    head = _commit(git, tmp_path, "backend/b.py", "fix: b [skip netlify]")
    monkeypatch.setenv("E2E_NETLIFY_TARGET", "0")
    got = _run(tmp_path, monkeypatch)
    assert (got["target"], got["verdict"]) == (head, "head")


def test_the_workflow_waits_for_the_target_and_gates_every_later_step():
    doc = yaml.safe_load(WF.read_text(encoding="utf-8"))
    steps = doc["jobs"]["e2e"]["steps"]
    names = [s.get("name") or s.get("uses") for s in steps]
    k = next(i for i, s in enumerate(steps) if s.get("id") == "netlify_target")
    assert "e2e_frontend_target.py" in steps[k]["run"] and steps[k]["if"] == "github.event_name == 'push'"
    wait = steps[k + 1]
    assert wait["name"].startswith("Wait for the Netlify dev preview")
    assert wait["env"]["TARGET"] == "${{ steps.netlify_target.outputs.target }}"
    assert 'full="${TARGET:-$(git rev-parse HEAD)}"' in wait["run"]
    gate = "steps.netlify_target.outputs.skip != 'true'"
    ungated = [names[i] for i in range(k + 1, len(steps)) if gate not in str(steps[i].get("if", ""))]
    assert not ungated, f"steps that would run on a skip (a stale bundle): {ungated}"
    assert "Run E2E tests" in names[k + 1:]


def test_only_the_two_documented_markers_as_written_are_skips(tmp_path, monkeypatch):
    """Advisor CHANGE on #1312: Netlify documents only "[skip ci]" and "[skip netlify]" (docs.netlify.com, "Skip a
    deploy"). Honouring a marker Netlify ignores would SKIP E2E while the change is live, so reversed order and other
    case are NOT skips: such a commit is treated as built (wait for it; worst case a false red, never a stale green)."""
    assert eft.SKIP_MARKERS == ("[skip netlify]", "[skip ci]")
    git = _repo(tmp_path)
    _commit(git, tmp_path, "frontend/a.js", "feat: a")
    for msg in ("fix: b [ci skip]", "fix: c [netlify skip]", "fix: d [SKIP CI]", "fix: e [Skip Netlify]"):
        head = _commit(git, tmp_path, f"backend/{msg[5]}.py", msg)
        got = _run(tmp_path, monkeypatch)
        assert (got["target"], got["verdict"]) == (head, "head"), msg


def test_a_frontend_change_under_a_skip_marker_warns_on_stderr_only(tmp_path, monkeypatch):
    """Advisor nit after #1300: the skip path names the undeployed built files in a ::warning, on STDERR (stdout is
    appended to $GITHUB_OUTPUT, where a non key=value line would break the step)."""
    git = _repo(tmp_path)
    _commit(git, tmp_path, "frontend/a.js", "feat: a")
    _commit(git, tmp_path, "frontend/b.js", "feat(ui): b [skip netlify]")
    monkeypatch.chdir(tmp_path)
    r = subprocess.run([sys.executable, str(HERE.parent / "scripts" / "e2e_frontend_target.py"), "HEAD"],
                       capture_output=True, text=True, check=True)
    assert "::warning title=Frontend change not deployed (Netlify skip marker)::" in r.stderr
    assert "frontend/b.js" in r.stderr
    assert all("=" in line and not line.startswith("::") for line in r.stdout.strip().split("\n"))
    _commit(git, tmp_path, "backend/c.py", "fix: c")                                   # a built HEAD: no warning
    r = subprocess.run([sys.executable, str(HERE.parent / "scripts" / "e2e_frontend_target.py"), "HEAD"],
                       capture_output=True, text=True, check=True)
    assert "::warning" not in r.stderr
