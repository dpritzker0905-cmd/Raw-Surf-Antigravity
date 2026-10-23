"""The completeness check sees squash merges, WARNs only after the last fold, and the merges it lacks get recorded.

WHY (2026-10-23). memory_audit's completeness check read only `Merge pull request #N` commits; dev squash-merges, so
from #380 on it saw nothing (56 merges since the ledger began had no `pr_merge` line, and nothing failed). The lead's
option A: backfill those lines, widen the check to squash subjects `(#N)` (a merge newer than the last fold WARNs,
an older one FAILs), and let `fold-pr --record-merges` write the missing lines so unattended auto-merge stays
recorded. These tests pin each half, with the network replaced by a scripted `gh`.
"""
import json
import os
import subprocess
import sys

import pytest

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

from scripts import action_ledger as L        # noqa: E402
from scripts import ledger_fragments as F     # noqa: E402
from scripts import ledger_merges as LM       # noqa: E402
from scripts import memory_audit as M         # noqa: E402
from tests.test_ledger_fragments import (     # noqa: E402,F401 - shared fixtures: a throwaway repo, no user git config
    BASE, LANDED, LEDGER, Repo, frag, isolated_git, merge, repo, state_text)


def squash(r, n, date):
    """A PR squash-merged onto dev: one first-parent commit whose subject ends `(#n)`."""
    r.write(f"work/{n}.txt", f"{n}\n")
    return r.commit(f"feat: change {n} (#{n})", date=date)


class FakeGh:
    """`gh` as GitHub answers it: per PR, merged or not, auto-merge armed or not."""

    def __init__(self, auto=(), unmerged=()):
        self.auto, self.unmerged, self.calls = set(auto), set(unmerged), []

    def __call__(self, args):
        self.calls.append(args)
        if args[:2] == ["repo", "view"]:
            return json.dumps({"owner": {"login": "o"}, "name": "r"})
        if args[:2] == ["pr", "view"]:
            n = int(args[2])
            if n in self.unmerged:
                return json.dumps({"number": n, "state": "OPEN", "mergedAt": None, "mergeCommit": None})
            return json.dumps({"number": n, "title": f"feat: change {n}", "url": f"https://example.invalid/pull/{n}",
                               "state": "MERGED", "mergedAt": "2026-10-22T20:00:00Z", "mergedBy": {"login": "u"},
                               "mergeCommit": {"oid": f"{n:040d}"}, "headRefOid": "b" * 40})
        n = int(next(a for a in args if a.startswith("n="))[2:])
        nodes = [{"__typename": "PullRequestCommit", "commit": {"oid": "a" * 40}}]
        if n in self.auto:
            nodes.append({"__typename": "AutoSquashEnabledEvent", "createdAt": "2026-10-22T19:00:00Z",
                          "actor": {"login": "u"}})
            nodes.append({"__typename": "PullRequestCommit", "commit": {"oid": "b" * 40}})
        nodes.append({"__typename": "MergedEvent", "createdAt": "2026-10-22T20:00:00Z", "actor": {"login": "u"},
                      "commit": {"oid": f"{n:040d}"}})
        return json.dumps({"data": {"repository": {"pullRequest": {"timelineItems": {"nodes": nodes}}}}})


# ── which merges a history holds ─────────────────────────────────────────────────────────────────────────────────
def test_parse_merges_reads_merge_commits_and_squash_subjects_and_nothing_else():
    merges = "m1|2026-10-01T00:00:00+00:00|Merge pull request #10 from o/branch\n" \
             "m2|2026-10-01T01:00:00+00:00|Merge origin/dev into claude/x\n"
    first = "s1|2026-10-05T00:00:00-04:00|feat: x (#12)\n" \
            's2|2026-10-05T01:00:00Z|Revert "feat: x (#12)"\n' \
            "s3|2026-10-05T02:00:00Z|chore: no pull request\n" \
            "s4|2026-10-05T03:00:00Z|fix: y (#13)\n"
    assert LM.parse_merges(merges, first, head_sha="s4") == [(12, "2026-10-05T04:00:00Z"),
                                                             (10, "2026-10-01T00:00:00Z")]


def test_git_merges_sees_squash_merges_newest_first_without_head(repo):
    squash(repo, 5, "2026-10-21T00:00:00Z")
    squash(repo, 6, "2026-10-21T01:00:00Z")
    squash(repo, 7, "2026-10-21T02:00:00Z")          # HEAD: the merge being made on a dev push
    assert LM.git_merges(repo.path, "HEAD") == [(6, "2026-10-21T01:00:00Z"), (5, "2026-10-21T00:00:00Z")]


def test_the_last_fold_point_is_the_landing_then_each_fold(repo):
    assert LM.last_fold_point(repo.path, "dev") == LANDED
    merge(repo, "a", frag({"kind": "finding"}))
    assert LM.last_fold_point(repo.path, "dev") == LANDED
    F.fold(repo.path, "dev")
    repo.commit("fold", date="2026-10-22T18:00:00Z")
    assert LM.last_fold_point(repo.path, "dev") == "2026-10-22T18:00:00Z"


# ── the widened check ────────────────────────────────────────────────────────────────────────────────────────────
ENTRIES = [{"at": "2026-10-20T00:00:00Z", "kind": "finding", "target": "x"},
           {"at": "2026-10-20T01:00:00Z", "kind": "pr_merge", "target": "#4"}]
MERGES = [(9, "2026-10-22T15:00:00Z"), (8, "2026-10-22T13:00:00Z"), (7, "2026-10-22T11:00:00Z"),
          (4, "2026-10-21T00:00:00Z")]


@pytest.mark.parametrize("pending_from,levels", [
    (None, ["WARN", "FAIL", "FAIL"]),                    # no fold yet known: only the newest may wait (as before)
    (LANDED, ["WARN", "WARN", "FAIL"]),                  # #8 merged after the fold point; #7 before it
    ("2026-10-22T10:00:00Z", ["WARN", "WARN", "WARN"]),
])
def test_merges_after_the_last_fold_warn_and_older_ones_fail(pending_from, levels):
    got = M.check_completeness(ENTRIES, MERGES, pending_from)
    assert [lv for lv, _ in got] == levels and all("#4 " not in m for _, m in got)
    if pending_from == LANDED:
        assert "fold-pr --record-merges" in got[1][1] and "#7" in got[2][1]


# ── what a recorded line says ────────────────────────────────────────────────────────────────────────────────────
def test_a_reconstructed_line_names_the_auto_merge_or_the_merger_and_validates():
    auto = LM.merge_fields(5, "claude", gh=FakeGh(auto={5}), today="2026-10-23")
    hand = LM.merge_fields(6, "claude", gh=FakeGh(), today="2026-10-23")
    assert auto["authorized_by"].startswith("reconstructed 2026-10-23; authorizing words not recorded in the ledger")
    assert "auto-merge armed by u at 2026-10-22T19:00:00Z on head aaaaaaaaaaaa" in auto["authorized_by"]
    assert "merged by u at 2026-10-22T20:00:00Z (no auto-merge" in hand["authorized_by"]
    assert (auto["target"], auto["acted_at"], auto["reconstructed"]) == ("#5", "2026-10-22T20:00:00Z", True)
    assert auto["evidence"][0] == "https://example.invalid/pull/5"
    led = [L.canonical(L.make_entry([], kind="finding", at="2026-10-20T00:00:00Z", **BASE))]
    text = "".join(L.canonical(f) + "\n" for f in (auto, hand))
    assert F.fold_entries(led, [("x", text)], "2026-10-23T00:00:00Z")[1] == []


def test_an_unmerged_pr_is_refused():
    with pytest.raises(F.LedgerError, match="not a merged PR"):
        LM.merge_fields(5, "claude", gh=FakeGh(unmerged={5}))


# ── recording the missing ones ───────────────────────────────────────────────────────────────────────────────────
def test_record_merges_writes_only_the_missing_ones_oldest_first_and_once(repo):
    for n, h in ((5, "00"), (6, "01"), (7, "02")):
        squash(repo, n, f"2026-10-21T{h}:00:00Z")
    repo.write("other.txt", "head\n")
    repo.commit("an unrelated HEAD", date="2026-10-21T03:00:00Z")
    repo.git("switch", "-q", "-c", "claude/x")
    lines = repo.lines()
    lines.append(L.canonical(L.make_entry(lines, kind="pr_merge", at="2026-10-21T04:00:00Z", **{**BASE,
                                                                                              "target": "#5"})))
    gh, said = FakeGh(auto={7}), []
    assert LM.record_merges(repo.path, "dev", lines, "claude", gh=gh, out=said.append) == [6, 7]
    got = [json.loads(x) for x in F.split_lines(repo.read(f"{F.FRAG_DIR_REL}/claude--x.jsonl"))]
    assert [e["target"] for e in got] == ["#6", "#7"] and all(e["reconstructed"] for e in got)
    assert LM.record_merges(repo.path, "dev", LM.ledger_as_it_will_be(repo.path) + lines[2:], "claude", gh=gh,
                            out=said.append) == []


def test_cli_record_merges_appends_to_the_branch_fragment(repo, monkeypatch):
    squash(repo, 5, "2026-10-21T00:00:00Z")
    repo.write("other.txt", "head\n")
    repo.commit("an unrelated HEAD", date="2026-10-21T03:00:00Z")
    repo.git("switch", "-q", "-c", "claude/x")
    monkeypatch.setattr(L, "ROOT", repo.path)
    monkeypatch.setattr(LM, "run_gh", FakeGh())
    assert L.main(["record-merges", "--actor", "claude", "--base", "dev"]) == 0
    assert [json.loads(x)["target"] for x in F.split_lines(repo.read(f"{F.FRAG_DIR_REL}/claude--x.jsonl"))] == ["#5"]
    assert repo.lines() == L.read_lines(repo.path_of(LEDGER))


def test_fold_pr_record_merges_keeps_auto_merges_recorded_and_the_fold_exact(repo, tmp_path):
    remote = tmp_path / "remote.git"
    subprocess.run(["git", "init", "-q", "--bare", "-b", "dev", str(remote)], check=True)
    repo.git("remote", "add", "origin", str(remote))
    merge(repo, "a", frag({"kind": "finding"}))
    squash(repo, 8, "2026-10-22T14:00:00Z")
    squash(repo, 9, "2026-10-22T15:00:00Z")
    repo.write("other.txt", "head\n")
    repo.commit("an unrelated HEAD", date="2026-10-22T16:00:00Z")
    repo.git("push", "-q", "origin", "dev")
    s = F.fold_pr(repo.path, open_pr=False, record_actor="claude", gh=FakeGh(auto={9}), out=lambda *_: None)
    assert s["recorded"] == [8, 9] and [n for n, _, _ in s["folded"]] == ["a"]
    repo.git("fetch", "-q", "origin")
    repo.git("switch", "-q", "--detach", f"origin/{s['branch']}")
    rec = F.split_lines(repo.read(f"{F.FRAG_DIR_REL}/{F.slug(s['branch'])}.jsonl"))
    assert [json.loads(x)["target"] for x in rec] == ["#8", "#9"]
    assert "record 2 pr_merge line(s)" in repo.git("log", "-1", "--format=%B")
    assert F.check_pr(repo.path, "origin/dev", "HEAD", head_ref=s["branch"])[0] == []


def test_fold_pr_with_only_merges_to_record_still_opens_a_branch(repo, tmp_path):
    remote = tmp_path / "remote.git"
    subprocess.run(["git", "init", "-q", "--bare", "-b", "dev", str(remote)], check=True)
    repo.git("remote", "add", "origin", str(remote))
    squash(repo, 8, "2026-10-22T14:00:00Z")
    repo.write("other.txt", "head\n")
    repo.commit("an unrelated HEAD", date="2026-10-22T16:00:00Z")
    repo.git("push", "-q", "origin", "dev")
    s = F.fold_pr(repo.path, open_pr=False, record_actor="claude", gh=FakeGh(), out=lambda *_: None)
    assert s["folded"] == [] and s["recorded"] == [8] and s["branch"].startswith("ledger-fold/")
    before = F.fold_pr(repo.path, dry_run=True, out=lambda *_: None)
    assert before["folded"] == []
