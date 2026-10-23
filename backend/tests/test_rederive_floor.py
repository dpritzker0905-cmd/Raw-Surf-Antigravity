"""The floor map merges cleanly across lanes, and rederive_floor.py re-derives one lane from dev the same way every time.

WHY (the lead, 2026-10-23). `_FLOOR_SET_FROM` sat on one line, so any two PRs that moved floors in DIFFERENT lanes
conflicted (#470 estate vs #467 chain, #474 guards vs #467 chain, #475 estate). The map is now one block per lane
with a blank line between lanes: measured, adjacent lines conflict in git and one blank line between them merges
clean. A same-lane collision still conflicts, and is resolved by re-deriving: base = max(dev's last green hosted read,
dev's map), + this PR's new tests, floor = that - the lane's budget, written to ci.yml and the map together. These
tests pin the layout with a real git merge, the derivation, both rewriters on the REAL ci.yml, and the CLI.
"""
import os
import subprocess
import sys

import pytest

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

from scripts import ci_floor_staleness as S   # noqa: E402
from scripts import rederive_floor as R       # noqa: E402

REPO = os.path.dirname(BACKEND)


def _read(rel):
    with open(os.path.join(REPO, *rel.split("/")), encoding="utf-8", newline="") as f:
        return f.read()


MAP_TEXT, CI_TEXT = _read(R.MAP_REL), _read(R.CI_REL)


@pytest.fixture
def isolated_git(monkeypatch, tmp_path):
    for k in ("GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"):
        monkeypatch.delenv(k, raising=False)
    cfg = tmp_path / "gitconfig"
    cfg.write_text("")
    monkeypatch.setenv("GIT_CONFIG_GLOBAL", str(cfg))
    monkeypatch.setenv("GIT_CONFIG_NOSYSTEM", "1")
    for k in ("AUTHOR", "COMMITTER"):
        monkeypatch.setenv(f"GIT_{k}_NAME", "floor-test")
        monkeypatch.setenv(f"GIT_{k}_EMAIL", "floor-test@example.invalid")


# ── the layout ───────────────────────────────────────────────────────────────────────────────────────────────────
def test_the_real_map_is_one_block_per_lane_with_a_blank_line_between_lanes():
    i, j = R.map_block(MAP_TEXT)
    lines = MAP_TEXT[i:j].split("\n")
    keys = [n for n, ln in enumerate(lines) if ln.strip().startswith('"')]
    assert [lines[n].strip().split('"')[1] for n in keys] == sorted(S.LANES, key=list(S.LANES).index)
    for a, b in zip(keys, keys[1:]):
        assert "" in [ln.strip() for ln in lines[a + 1:b]], (
            f"no blank line between {lines[a].strip()} and {lines[b].strip()}: git conflicts on adjacent lines")
    assert R.parse_map(MAP_TEXT) == {k: v for k, v in R.parse_map(MAP_TEXT).items()} and set(R.parse_map(MAP_TEXT)) \
        == set(S.LANES)


def _merge(tmp_path, base, a, b):
    """'clean' or 'conflict' for two branches that each rewrote the map from `base`."""
    d = tmp_path / "m"
    os.makedirs(d)

    def git(*args):
        return subprocess.run(["git", *args], cwd=d, capture_output=True, text=True)
    git("init", "-q", "-b", "main")
    (d / "map.py").write_bytes(base.encode())
    git("add", "-A")
    git("commit", "-qm", "base")
    for name, text in (("a", a), ("b", b)):
        git("switch", "-qc", name, "main")
        (d / "map.py").write_bytes(text.encode())
        git("commit", "-qam", name)
    return "clean" if git("merge", "-q", "--no-edit", "a").returncode == 0 else "conflict"


@pytest.mark.parametrize("lanes,expect", [
    (("chain", "estate"), "clean"), (("guards", "chain"), "clean"), (("guards", "estate"), "clean"),
    (("estate", "estate"), "conflict"),
])
def test_different_lanes_merge_clean_and_the_same_lane_conflicts(isolated_git, tmp_path, lanes, expect):
    va, vb = (R.parse_map(MAP_TEXT)[ln] for ln in lanes)
    a = R.set_map(MAP_TEXT, lanes[0], va + 7, "pr A")
    b = R.set_map(MAP_TEXT, lanes[1], vb + 9, "pr B")
    assert _merge(tmp_path, MAP_TEXT, a, b) == expect


def test_the_old_one_line_map_conflicted_across_lanes(isolated_git, tmp_path):
    """The control: the layout this replaces really did conflict on a different-lane pair."""
    one = 'X = 1\n_FLOOR_SET_FROM = {"guards": 1, "chain": 2, "estate": 3}\nY = 2\n'
    assert _merge(tmp_path, one, one.replace('"chain": 2', '"chain": 20'),
                  one.replace('"estate": 3', '"estate": 30')) == "conflict"


# ── the rewriters ────────────────────────────────────────────────────────────────────────────────────────────────
def test_parse_map_reads_both_forms():
    assert R.parse_map('_FLOOR_SET_FROM = {"guards": 1, "chain": 2, "estate": 3}\n') == \
        {"guards": 1, "chain": 2, "estate": 3}
    assert R.parse_map(MAP_TEXT)["estate"] > 0


def test_set_map_replaces_the_value_and_its_one_provenance_line():
    out = R.set_map(MAP_TEXT, "estate", 9999, "set from 9999 by the test")
    again = R.set_map(out, "estate", 9998, "set from 9998 by the test")
    assert R.parse_map(again)["estate"] == 9998 and R.parse_map(again)["chain"] == R.parse_map(MAP_TEXT)["chain"]
    assert again.count("# estate:") == 1 and "9998 by the test" in again and "9999 by the test" not in again
    assert again.count("\n") == MAP_TEXT.count("\n")


@pytest.mark.parametrize("text,expect", [
    ('_FLOOR_SET_FROM = {"guards": 1, "chain": 2, "estate": 3}\n', "one line"),
    ('_FLOOR_SET_FROM = {\n    "guards": 1,\n}\n', "0 `"),
])
def test_set_map_refuses_the_one_line_form_and_a_missing_lane(text, expect):
    with pytest.raises(R.Refusal, match=expect):
        R.set_map(text, "estate", 5, "x")


@pytest.mark.parametrize("lane", sorted(S.LANES))
def test_set_ci_floor_rewrites_the_real_ci_yml_where_the_staleness_check_reads_it(tmp_path, lane):
    files, passed = R.floor_values(CI_TEXT, lane)
    new_files = None if files is None else files + 1
    out = R.set_ci_floor(CI_TEXT, lane, new_files, passed + 11, ["# note one (rederive_floor.py, b1)", "#   two"],
                         "b1")
    p = tmp_path / "ci.yml"
    p.write_bytes(out.encode())
    floors = S.read_floors(str(p))
    assert floors[lane] == {"files": new_files, "passed": passed + 11}
    assert all(floors[o] == S.read_floors(os.path.join(REPO, *R.CI_REL.split("/")))[o] for o in S.LANES if o != lane)
    again = R.set_ci_floor(out, lane, new_files, passed + 12, ["# note one (rederive_floor.py, b1)", "#   two"], "b1")
    assert again.count("(rederive_floor.py, b1)") == 1 and again.count("\n") == out.count("\n")
    other = R.set_ci_floor(again, lane, new_files, passed + 13, ["# note (rederive_floor.py, b2)", "#   x"], "b2")
    assert other.count("(rederive_floor.py, b1)") == 1 and other.count("(rederive_floor.py, b2)") == 1


# ── the derivation ───────────────────────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("hosted,map_dev,base_from", [(2392, 2405, "dev's map"), (2410, 2405, "hosted read")])
def test_the_base_is_the_higher_of_the_hosted_read_and_devs_map(hosted, map_dev, base_from):
    d = R.derive("estate", hosted, None, map_dev, None, 7, 0)
    assert (d["base"], d["base_from"], d["set_from"], d["floor"]) == (max(hosted, map_dev), base_from,
                                                                     max(hosted, map_dev) + 7,
                                                                     max(hosted, map_dev) + 7 - 2)


def test_files_floors_are_exact_and_negative_counts_are_refused():
    d = R.derive("chain", 2865, 174, 2873, 175, 8, 1)
    assert (d["set_from"], d["floor"], d["files"]) == (2881, 2875, 176)
    with pytest.raises(R.Refusal):
        R.derive("estate", 1, None, 1, None, -1, 0)


# ── the CLI ──────────────────────────────────────────────────────────────────────────────────────────────────────
@pytest.fixture
def checkout(tmp_path, monkeypatch):
    """A copy of the two files under tmp_path, a hosted read of 2392 and dev's own map/ci as the base."""
    for rel, text in ((R.CI_REL, CI_TEXT), (R.MAP_REL, MAP_TEXT)):
        p = tmp_path.joinpath(*rel.split("/"))
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(text.encode())
    monkeypatch.setattr(R, "REPO", str(tmp_path))
    monkeypatch.setattr(R, "base_text", lambda rel, ref: {R.CI_REL: CI_TEXT, R.MAP_REL: MAP_TEXT}[rel])
    monkeypatch.setattr(S, "last_green_run", lambda branch, now=None: (123, "sha", "2026-10-23T00:00:00Z"))
    monkeypatch.setattr(S, "observed", lambda run, lane: (None, 2392) if lane == "estate" else (175, 2873))
    return tmp_path


def test_cli_rederives_both_files_and_the_pair_keeps_the_lane_budget(checkout):
    assert R.main(["--lane", "estate", "--add", "5"]) == 0
    ci = str(checkout.joinpath(*R.CI_REL.split("/")))
    mp = R.parse_map(checkout.joinpath(*R.MAP_REL.split("/")).read_text(encoding="utf-8"))
    base = max(2392, R.parse_map(MAP_TEXT)["estate"])
    assert mp["estate"] == base + 5 and S.read_floors(ci)["estate"]["passed"] == base + 5 - 2
    assert mp["estate"] - S.read_floors(ci)["estate"]["passed"] == S.LANES["estate"]["passed_budget"]
    first = checkout.joinpath(*R.CI_REL.split("/")).read_bytes()
    assert R.main(["--lane", "estate", "--add", "5"]) == 0                   # idempotent: same numbers, one note
    assert checkout.joinpath(*R.CI_REL.split("/")).read_bytes() == first


def _one_line(block_text):
    """The map as it was before the block layout: one line, same values."""
    i, j = R.map_block(block_text)
    vals = R.parse_map(block_text)
    return block_text[:i] + "_FLOOR_SET_FROM = {" + ", ".join(f'"{k}": {v}' for k, v in vals.items()) + "}" + \
        block_text[j:]


def test_add_auto_re_lays_an_old_one_line_prs_own_lane_change_into_the_block_layout(isolated_git, tmp_path,
                                                                                      monkeypatch):
    """The lead's case (2026-10-23): a PR that moved chain +9 tests / +1 file on the OLD one-line map conflicts with
    dev's block layout. Take dev's side of both files, then `--add auto` reads the PR's own change (HEAD vs merge
    base) and writes it into the chain block, keeping dev's other lanes."""
    repo = tmp_path / "r"
    os.makedirs(repo)

    def git(*args):
        r = subprocess.run(["git", *args], cwd=repo, capture_output=True, text=True)
        return r

    def put(rel, text):
        p = repo.joinpath(*rel.split("/"))
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(text.encode())
    vals = R.parse_map(MAP_TEXT)
    files, passed = R.floor_values(CI_TEXT, "chain")
    git("init", "-q", "-b", "dev")
    put(R.MAP_REL, _one_line(MAP_TEXT))
    put(R.CI_REL, CI_TEXT)
    git("add", "-A")
    git("commit", "-qm", "base: the old one-line map")
    git("switch", "-qc", "pr")                                      # the PR: chain +9 tests, +1 file, old layout
    put(R.MAP_REL, _one_line(MAP_TEXT).replace(f'"chain": {vals["chain"]}', f'"chain": {vals["chain"] + 9}'))
    put(R.CI_REL, R.set_ci_floor(CI_TEXT, "chain", files + 1, passed + 9, ["# pr (rederive_floor.py, pr)", "#  x"], "pr"))
    git("commit", "-qam", "pr: chain +9")
    git("switch", "-q", "dev")                      # dev: the block layout, and chain +4, estate +5 meanwhile (so a delta
    moved = R.set_map(MAP_TEXT, "estate", vals["estate"] + 5, "dev moved estate")      # read against dev itself, not
    put(R.MAP_REL, R.set_map(moved, "chain", vals["chain"] + 4, "dev moved chain"))   # the merge base, reads 5, not 9)
    git("commit", "-qam", "dev: block layout")
    git("switch", "-q", "pr")
    assert git("merge", "--no-edit", "dev").returncode != 0, "the old-map PR should conflict with the block layout"
    git("checkout", "--theirs", "--", R.MAP_REL, R.CI_REL)
    monkeypatch.setattr(R, "REPO", str(repo))
    monkeypatch.setattr(S, "last_green_run", lambda branch, now=None: (7, "sha", "2026-10-23T00:00:00Z"))
    monkeypatch.setattr(S, "observed", lambda run, lane: (files, vals["chain"]) if lane == "chain" else (None, 1))
    assert R.own_delta("chain", "dev") == (9, 1)
    assert R.main(["--lane", "chain", "--add", "auto", "--base", "dev"]) == 0
    out = repo.joinpath(*R.MAP_REL.split("/")).read_text(encoding="utf-8")
    # base = max(hosted read, dev's map chain + 4) = chain + 4; + the PR's own 9.
    assert R.parse_map(out) == {**vals, "chain": vals["chain"] + 13, "estate": vals["estate"] + 5}
    assert "\n" in out[R.map_block(out)[0]:R.map_block(out)[1]], "the map must stay in the block layout"
    ci = str(repo.joinpath(*R.CI_REL.split("/")))
    assert S.read_floors(ci)["chain"] == {"files": files + 1, "passed": vals["chain"] + 13 - 6}


def test_a_bad_add_is_refused(checkout):
    assert R.main(["--lane", "estate", "--add", "lots"]) == 1
    assert R.main(["--lane", "chain", "--add", "3", "--add-files", "x"]) == 1


def test_cli_dry_run_and_a_refused_read_write_nothing(checkout, monkeypatch):
    before = [checkout.joinpath(*r.split("/")).read_bytes() for r in (R.CI_REL, R.MAP_REL)]
    assert R.main(["--lane", "chain", "--add", "3", "--add-files", "1", "--dry-run"]) == 0

    def refuse(run, lane):
        raise S.Refusal("no reading")
    monkeypatch.setattr(S, "observed", refuse)
    assert R.main(["--lane", "chain", "--add", "3"]) == 1
    assert [checkout.joinpath(*r.split("/")).read_bytes() for r in (R.CI_REL, R.MAP_REL)] == before
