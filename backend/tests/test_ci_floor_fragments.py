"""Per-PR CI floor fragments: the effective floor is the ci.yml base plus `.github/ci-floors.d/*.json`, summed by ONE
helper that every reader calls, and a malformed fragment fails closed.

WHY (2026-11-11, owner-approved). Every PR that added tests rewrote ONE running-total line per lane in ci.yml and in
_FLOOR_SET_FROM, so any two open PRs conflicted and each merge re-broke the rest (9 of 10 open PRs that day). A PR now
adds its own file per lane; different files never conflict. These tests pin: the sum is per lane only; every malformed
shape refuses (in the helper, in the staleness checker, and in the CLI CI calls); the ci.yml steps still carry a base
literal the staleness regex finds AND add the fragments through the helper (run for real against a fake junit file);
the frontend step sums through the same helper; and rederive_floor.py writes and compacts fragments.
"""
import json
import os
import re
import shutil
import subprocess
import sys

import pytest

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

from scripts import ci_floor_fragments as F    # noqa: E402
from scripts import ci_floor_staleness as S    # noqa: E402
from scripts import rederive_floor as R        # noqa: E402

REPO = os.path.dirname(BACKEND)
CI_TEXT = open(os.path.join(REPO, ".github", "workflows", "ci.yml"), encoding="utf-8").read()
HELPER = os.path.join(BACKEND, "scripts", "ci_floor_fragments.py")


def _frag(d, name, **data):
    d.mkdir(parents=True, exist_ok=True)
    body = {"branch": "claude/x", "date": "2026-11-11", **data}
    (d / name).write_text(json.dumps(body), encoding="utf-8")


@pytest.fixture
def fdir(tmp_path):
    d = tmp_path / ".github" / "ci-floors.d"
    _frag(d, "claude-a.guards.json", lane="guards", tests=10, files=1)
    _frag(d, "claude-b.guards.json", lane="guards", tests=5)
    _frag(d, "claude-a.chain.json", lane="chain", tests=91, files=2, note="location-time")
    _frag(d, "claude-c.estate.json", lane="estate", tests=7, files=0)
    _frag(d, "claude-d.frontend.json", lane="frontend", tests=12, files=1)
    (d / "README.md").write_text("ignored", encoding="utf-8")
    return d


# ── the sum ──────────────────────────────────────────────────────────────────────────────────────────────────────
def test_fragments_sum_per_lane_only(fdir):
    s = F.sums(str(fdir))
    assert {k: (v["tests"], v["files"], v["n"]) for k, v in s.items()} == {
        "guards": (15, 1, 2), "chain": (91, 2, 1), "estate": (7, 0, 1), "frontend": (12, 1, 1)}
    assert F.floor_pair("guards", 226, 3616, str(fdir)) == (227, 3631)
    assert F.floor_passed("estate", 3430, str(fdir)) == 3437


def test_no_directory_means_no_fragments(tmp_path):
    assert all(v == {"tests": 0, "files": 0, "n": 0} for v in F.sums(str(tmp_path / "absent")).values())


@pytest.mark.parametrize("name,data,why", [
    ("x.guards.json", {"lane": "guards", "tests": -1}, "non-negative"),
    ("x.guards.json", {"lane": "guards", "tests": 1.5}, "non-negative"),
    ("x.guards.json", {"lane": "guards", "tests": True}, "non-negative"),
    ("x.guards.json", {"lane": "guards", "tests": "3"}, "non-negative"),
    ("x.guards.json", {"lane": "guards", "tests": 3, "files": -2}, "non-negative"),
    ("x.guards.json", {"lane": "guards", "tests": 3, "passed": 4}, "unknown key"),
    ("x.guards.json", {"lane": "chain", "tests": 3}, "file name says"),
    ("x.lint.json", {"lane": "lint", "tests": 3}, "named"),
    ("x.estate.json", {"lane": "estate", "tests": 3, "files": 1}, "no file floor"),
    ("x.guards.json", {"tests": 3}, "missing"),
    ("x.guards.json", {"lane": "guards", "tests": 3, "date": "11/11/2026"}, "YYYY-MM-DD"),
    ("x.guards.json", {"lane": "guards", "tests": 3, "note": 5}, "string"),
])
def test_a_malformed_fragment_refuses(tmp_path, name, data, why):
    _frag(tmp_path, name, **data)
    if "tests" not in data:
        body = json.loads((tmp_path / name).read_text(encoding="utf-8"))
        assert "tests" not in body
    with pytest.raises(F.FragmentError, match=why):
        F.sums(str(tmp_path))


@pytest.mark.parametrize("name,content", [("x.guards.json", "{not json"), ("x.guards.json", "[1, 2]"),
                                          ("notes.txt", "hello")])
def test_unreadable_or_stray_files_refuse(tmp_path, name, content):
    (tmp_path / name).write_text(content, encoding="utf-8")
    with pytest.raises(F.FragmentError):
        F.load(str(tmp_path))


def test_the_cli_ci_calls_sums_and_fails_closed(fdir, tmp_path):
    ok = subprocess.run([sys.executable, HELPER, "--sum", "frontend", "--dir", str(fdir)], capture_output=True,
                        text=True)
    assert ok.returncode == 0 and json.loads(ok.stdout) == {"tests": 12, "files": 1}
    _frag(fdir, "bad.chain.json", lane="chain", tests=-4)
    bad = subprocess.run([sys.executable, HELPER, "--sum", "frontend", "--dir", str(fdir)], capture_output=True,
                         text=True)
    assert bad.returncode == 1 and "malformed CI floor fragment" in bad.stderr


def test_the_repos_own_fragments_are_valid():
    F.load()


def test_slug_turns_a_branch_into_a_file_stem():
    assert F.slug("claude/location-time-phase1") == "claude-location-time-phase1"
    with pytest.raises(F.FragmentError):
        F.slug("//")


# ── the staleness checker reads the EFFECTIVE floor ──────────────────────────────────────────────────────────────
def test_the_staleness_checker_compares_base_plus_fragments(fdir):
    base, eff = S.read_floors(), S.effective_floors(frag_dir=str(fdir))
    assert eff["guards"] == {"files": base["guards"]["files"] + 1, "passed": base["guards"]["passed"] + 15}
    assert eff["chain"] == {"files": base["chain"]["files"] + 2, "passed": base["chain"]["passed"] + 91}
    assert eff["estate"] == {"files": None, "passed": base["estate"]["passed"] + 7}
    # A reading at the base would look current against the base, and is correctly STALE-free against the effective
    # floor (one-sided); a reading 7 above the effective guards floor is stale by more than its budget of 6.
    readings = {lane: (None if f["files"] is None else f["files"], f["passed"] + 7) for lane, f in eff.items()}
    stale = {(lane, kind) for lane, kind, *_ in S.evaluate(eff, readings)}
    assert ("guards", "MIN_PASSED") in stale and ("estate", "MIN_PASSED") in stale


def test_the_staleness_checker_refuses_on_a_malformed_fragment(tmp_path):
    _frag(tmp_path, "x.chain.json", lane="estate", tests=1)
    with pytest.raises(S.Refusal, match="malformed"):
        S.effective_floors(frag_dir=str(tmp_path))


# ── the ci.yml steps ─────────────────────────────────────────────────────────────────────────────────────────────
def _step(anchor):
    """The inline python of the backend lane step whose floor is anchored on `anchor`, dedented."""
    blocks = re.findall(r"python - <<'PY'\n(.*?)\n\s*PY\n", CI_TEXT, re.S)
    hit = [b for b in blocks if f"ET.parse('{anchor}')" in b and "MIN_PASSED" in b]
    assert len(hit) == 1, f"{len(hit)} steps carry the {anchor} floor"
    return "\n".join(ln[10:] for ln in hit[0].split("\n")) + "\n"


@pytest.mark.parametrize("lane,call", [("guards", "floor_pair"), ("chain", "floor_pair"), ("estate", "floor_passed")])
def test_each_backend_step_keeps_its_base_literal_and_adds_the_fragments(lane, call):
    code = _step(S.LANES[lane]["anchor"])
    assert S.read_floors()[lane]["passed"] > 0
    assert f"run_path('scripts/ci_floor_fragments.py')['{call}']('{lane}', " in code


def _junit(path, n_files, n_passed, extra=()):
    cases = [f'<testcase classname="tests.test_f{i % n_files}" name="t{i}"/>' for i in range(n_passed)]
    cases += [f'<testcase classname="{c}" name="x{i}"/>' for i, c in enumerate(extra)]
    path.write_text(f'<testsuite tests="{len(cases)}" failures="0" errors="0" skipped="0">{"".join(cases)}'
                    f'</testsuite>', encoding="utf-8")


@pytest.mark.parametrize("lane", ["guards", "chain"])
def test_the_real_step_enforces_base_plus_fragments(tmp_path, lane):
    """Runs the step's own python against a fake junit file: exactly the effective floor passes, one short fails."""
    root = tmp_path / "repo"
    (root / "backend" / "scripts").mkdir(parents=True)
    shutil.copy(HELPER, root / "backend" / "scripts")
    _frag(root / ".github" / "ci-floors.d", f"pr.{lane}.json", lane=lane, tests=9, files=1)
    files, passed = S.read_floors()[lane]["files"] + 1, S.read_floors()[lane]["passed"] + 9
    script = root / "backend" / "step.py"
    script.write_text(_step(S.LANES[lane]["anchor"]), encoding="utf-8")
    extra = ["tests.test_spot_condition_report_routes"] * 24 if lane == "guards" else []
    results = []
    for n in (passed, passed - 1):
        reported = n - len(extra)
        _junit(root / "backend" / S.LANES[lane]["anchor"], files - (1 if extra else 0), reported, extra)
        r = subprocess.run([sys.executable, str(script)], cwd=root / "backend", capture_output=True, text=True,
                           encoding="utf-8", env={**os.environ, "PYTHONIOENCODING": "utf-8"})   # Windows: the "—"s
        results.append((r.returncode, r.stdout))
    assert results[0][0] == 0, results[0][1]
    assert results[1][0] == 1 and f"floor is {passed}" in results[1][1], results[1][1]


def test_the_frontend_step_sums_through_the_same_helper():
    js = CI_TEXT[CI_TEXT.index("const FRONTEND_BASE_SUITES"):]
    js = js[:js.index("console.log(`floor")]
    assert len(R.FRONT_RE.findall(CI_TEXT)) == 1 and R.frontend_values(CI_TEXT)[0] > 0
    assert "execFileSync('python3', ['../backend/scripts/ci_floor_fragments.py', '--sum', 'frontend']" in js
    assert "MIN_SUITES = FRONTEND_BASE_SUITES + FRAG.files, MIN_TESTS = FRONTEND_BASE_TESTS + FRAG.tests" in js


# ── rederive_floor.py writes and compacts fragments ─────────────────────────────────────────────────────────────
@pytest.fixture
def checkout(tmp_path, monkeypatch):
    for rel in (R.CI_REL, R.MAP_REL):
        p = tmp_path.joinpath(*rel.split("/"))
        p.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(os.path.join(REPO, *rel.split("/")), p)
    d = tmp_path / ".github" / "ci-floors.d"
    monkeypatch.setattr(R, "REPO", str(tmp_path))
    monkeypatch.setattr(F, "FRAG_DIR", str(d))
    return tmp_path, d


def test_the_default_writes_a_fragment_and_edits_neither_base(checkout, capsys):
    root, d = checkout
    before = [root.joinpath(*r.split("/")).read_bytes() for r in (R.CI_REL, R.MAP_REL)]
    assert R.main(["--lane", "chain", "--add", "91", "--add-files", "2", "--branch-name", "claude/loc-time"]) == 0
    frag = json.loads((d / "claude-loc-time.chain.json").read_text(encoding="utf-8"))
    assert (frag["lane"], frag["tests"], frag["files"], frag["branch"]) == ("chain", 91, 2, "claude/loc-time")
    assert [root.joinpath(*r.split("/")).read_bytes() for r in (R.CI_REL, R.MAP_REL)] == before
    e = R.effective("chain", before[0].decode("utf-8"), before[1].decode("utf-8"), str(d))
    assert f"This PR must read {e['set_from'] + 91} passed" in capsys.readouterr().out
    assert R.main(["--lane", "estate", "--add", "3", "--add-files", "1", "--branch-name", "b"]) == 1
    assert R.main(["--lane", "frontend", "--add", "auto", "--branch-name", "b"]) == 1


def test_compact_folds_every_fragment_into_the_bases_and_keeps_the_effective_floor(checkout):
    root, d = checkout
    for args in (["--lane", "guards", "--add", "4", "--add-files", "1", "--branch-name", "a"],
                 ["--lane", "guards", "--add", "6", "--branch-name", "b"],
                 ["--lane", "estate", "--add", "2", "--branch-name", "a"],
                 ["--lane", "frontend", "--add", "12", "--add-files", "1", "--branch-name", "a"]):
        assert R.main(args) == 0
    ci, mp = (root.joinpath(*r.split("/")).read_text(encoding="utf-8") for r in (R.CI_REL, R.MAP_REL))
    want = {lane: R.effective(lane, ci, mp, str(d)) for lane in F.LANES}
    assert R.main(["--compact"]) == 0
    assert not [n for n in os.listdir(d) if n.endswith(".json")]
    ci2, mp2 = (root.joinpath(*r.split("/")).read_text(encoding="utf-8") for r in (R.CI_REL, R.MAP_REL))
    for lane in F.LANES:
        got = R.effective(lane, ci2, mp2, str(d))
        assert (got["files"], got["passed"], got["set_from"]) == (want[lane]["eff_files"], want[lane]["eff_passed"],
                                                                  want[lane]["eff_set_from"]), lane
    assert ci2.count("(rederive_floor.py, compact ") == 3            # one line per lane that had fragments
    assert R.main(["--compact"]) == 0 and root.joinpath(*R.CI_REL.split("/")).read_text(encoding="utf-8") == ci2
