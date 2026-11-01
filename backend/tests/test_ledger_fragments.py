"""Per-PR ledger fragments, the fold in merge order, and the PR guard (D-0XX).

WHY (owner, 2026-10-22 23:11 EDT): "Yes: build the per-PR ledger fragments (ledger.d/<pr>.jsonl folded into
ACTIONS.jsonl in merge order) so PRs stop colliding and auto-merge runs unattended. Keep the hash chain intact."
These tests pin the properties that make that safe: a PR's lines go to its fragment and never touch ACTIONS.jsonl;
references resolve to the right seq (in the same fragment, across fragments, after a fragment is folded and gone);
the fold follows the order fragments were MERGED, not their names; the chain verifies and the anchor moves; a fold
PR must equal the fold recomputed from dev; direct edits, edited or deleted merged fragments and reused names fail;
PRs opened before the protocol landed keep the old way. Each guard is shown failing on a mutant (reversed order, a
dropped line, a skipped fragment, an edited line) so a green run means the guard is live.

Every git test runs in a throwaway repository under tmp_path with the user's git config switched off.
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
from scripts import memory_audit as M         # noqa: E402

BASE = dict(actor="test", target="t", why="w", authorized_by="a", outcome="o", verified="v", rollback="r",
            evidence=["e"])
LANDED = "2026-10-22T12:00:00Z"            # when the fixture's ledger.d/README.md lands on dev
LEDGER, STATE = F.LEDGER_REL, F.STATE_REL


@pytest.fixture(autouse=True)
def isolated_git(monkeypatch, tmp_path):
    """No user/system git config (signing, hooks, autocrlf) and no GIT_DIR from a calling hook."""
    for k in ("GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_COMMON_DIR"):
        monkeypatch.delenv(k, raising=False)
    cfg = tmp_path / "gitconfig"
    cfg.write_text("")
    monkeypatch.setenv("GIT_CONFIG_GLOBAL", str(cfg))
    monkeypatch.setenv("GIT_CONFIG_NOSYSTEM", "1")
    for k in ("AUTHOR", "COMMITTER"):
        monkeypatch.setenv(f"GIT_{k}_NAME", "ledger-test")
        monkeypatch.setenv(f"GIT_{k}_EMAIL", "ledger-test@example.invalid")


class Repo:
    def __init__(self, path):
        self.path = str(path)

    def git(self, *args, date=None):
        env = {**os.environ, **({"GIT_COMMITTER_DATE": date, "GIT_AUTHOR_DATE": date} if date else {})}
        r = subprocess.run(["git", *args], cwd=self.path, capture_output=True, text=True, env=env)
        assert r.returncode == 0, f"git {args}: {r.stderr}"
        return r.stdout

    def path_of(self, rel):
        return os.path.join(self.path, *rel.split("/"))

    def write(self, rel, text):
        os.makedirs(os.path.dirname(self.path_of(rel)), exist_ok=True)
        with open(self.path_of(rel), "w", encoding="utf-8", newline="") as f:
            f.write(text)

    def read(self, rel):
        with open(self.path_of(rel), encoding="utf-8", newline="") as f:
            return f.read()

    def exists(self, rel):
        return os.path.exists(self.path_of(rel))

    def commit(self, msg, date=None):
        self.git("add", "-A")
        self.git("commit", "-q", "-m", msg, date=date)
        return self.git("rev-parse", "HEAD").strip()

    def lines(self):
        return L.read_lines(self.path_of(LEDGER))


def frag(*entries, acted_at="2026-10-21T00:00:00Z"):
    return "".join(L.canonical({**BASE, "acted_at": acted_at, **e}) + "\n" for e in entries)


def state_text(lines):
    return f"# STATE\n\n**Updated 2026-10-20 00:00Z**\n\n**{L.head(lines)}**\n\n## Next\n"


@pytest.fixture
def repo(tmp_path):
    """dev: a two-line ledger (a commitment, a finding), STATE with its anchor, then the protocol landing."""
    r = Repo(tmp_path / "repo")
    os.makedirs(r.path)
    r.git("init", "-q", "-b", "dev")
    lines = []
    lines.append(L.canonical(L.make_entry(lines, kind="commitment", due_at="2026-10-30T00:00:00Z", check="c",
                                          at="2026-10-20T01:00:00Z", **BASE)))
    lines.append(L.canonical(L.make_entry(lines, kind="finding", at="2026-10-20T02:00:00Z", **BASE)))
    r.write(LEDGER, "".join(x + "\n" for x in lines))
    r.write(STATE, state_text(lines))
    r.write("other.txt", "x\n")
    r.commit("base", date="2026-10-20T03:00:00Z")
    r.write(F.SENTINEL_REL, "# ledger.d\n")
    r.commit("the fragment protocol lands", date=LANDED)
    return r


def merge(r, name, text, date="2026-10-22T13:00:00Z"):
    """A PR that adds one fragment, squash-merged onto dev (one first-parent commit)."""
    r.write(f"{F.FRAG_DIR_REL}/{name}.jsonl", text)
    return r.commit(f"pr adding {name}", date=date)


def fragment_lines(r, name):
    return F.split_lines(r.read(f"{F.FRAG_DIR_REL}/{name}.jsonl"))


# ── names ────────────────────────────────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("branch,name", [
    ("claude/clever-wozniak-c0485c", "claude--clever-wozniak-c0485c"),
    ("Codex/Fix Thing#2", "codex--fix-thing-2"),
    ("ledger-fold/20261023T030000Z", "ledger-fold--20261023t030000z"),
])
def test_slug_is_a_valid_fragment_name(branch, name):
    assert F.slug(branch) == name and F.NAME_RE.fullmatch(name)


def test_default_name_never_reuses_a_name_already_on_the_base(repo):
    repo.git("switch", "-q", "-c", "claude/x")
    assert F.default_name(repo.path, "dev") == "claude--x"
    repo.git("switch", "-q", "dev")
    merge(repo, "claude--x", frag({"kind": "finding"}))           # an earlier PR from a branch of the same name
    repo.git("switch", "-q", "-C", "claude/x", "dev")               # the branch name is used again
    assert F.default_name(repo.path, "dev") == "claude--x-2"


def test_a_detached_head_must_name_its_fragment(repo):
    repo.git("checkout", "-q", "--detach")
    with pytest.raises(F.LedgerError, match="--fragment"):
        F.default_name(repo.path, "dev")


# ── append ───────────────────────────────────────────────────────────────────────────────────────────────────────
def test_append_writes_the_branch_fragment_and_leaves_the_ledger_and_anchor_alone(repo):
    repo.git("switch", "-q", "-c", "claude/x")
    before = (repo.read(LEDGER), repo.read(STATE))
    name, n, entry = F.append_fragment(repo.path, {**BASE, "kind": "finding"}, base_ref="dev")
    name2, n2, _ = F.append_fragment(repo.path, {**BASE, "kind": "finding", "fulfills": 1}, base_ref="dev")
    assert (name, n, name2, n2) == ("claude--x", 1, "claude--x", 2)
    assert (repo.read(LEDGER), repo.read(STATE)) == before
    first = json.loads(fragment_lines(repo, name)[0])
    assert not set(F.FOLD_ONLY_KEYS) & set(first) and L.AT_RE.match(first["acted_at"])
    assert fragment_lines(repo, name)[0] == L.canonical(first)


def test_cli_append_defaults_to_the_fragment_and_direct_writes_the_ledger(repo, monkeypatch):
    repo.git("switch", "-q", "-c", "claude/x")
    monkeypatch.setattr(L, "ROOT", repo.path)
    monkeypatch.setattr(L, "LEDGER", repo.path_of(LEDGER))
    args = ["append", "--actor", "codex", "--kind", "finding", "--target", "t", "--why", "w", "--authorized-by", "a",
            "--evidence", "e", "--outcome", "o", "--verified", "v", "--rollback", "r"]
    before = repo.read(LEDGER)
    assert L.main(args + ["--base", "dev"]) == 0
    assert repo.read(LEDGER) == before and len(fragment_lines(repo, "claude--x")) == 1
    assert L.main(args + ["--direct"]) == 0
    assert len(repo.lines()) == 3 and len(fragment_lines(repo, "claude--x")) == 1
    with pytest.raises(ValueError, match="--acted-at"):
        L.main(args + ["--base", "dev", "--at", "2026-10-22T00:00:00Z"])


def test_cli_append_without_an_actor_writes_no_fragment(repo, monkeypatch):
    repo.git("switch", "-q", "-c", "claude/x")
    monkeypatch.setattr(L, "ROOT", repo.path)
    with pytest.raises(SystemExit):
        L.main(["append", "--kind", "finding", "--target", "t", "--why", "w", "--authorized-by", "a",
                "--evidence", "e", "--outcome", "o", "--verified", "v", "--rollback", "r"])
    assert not repo.exists(f"{F.FRAG_DIR_REL}/claude--x.jsonl")


@pytest.mark.parametrize("fields,expect", [
    ({"kind": "pr_merge", "target": "PR #9"}, "pr_merge target"),
    ({"kind": "correction"}, "must name what it corrects"),
    ({"kind": "finding", "verified": "read at ~02:21Z"}, "estimated time"),
    ({"kind": "finding", "fulfills": "@frag:1"}, "EARLIER line"),
    ({"kind": "finding", "fulfills": 3}, "already in ACTIONS.jsonl"),
    ({"kind": "finding", "fulfills": 2}, "not a commitment"),
    ({"kind": "finding", "fulfills": "@frag:elsewhere:1"}, "not on dev"),
    ({"kind": "finding", "corrects": "@frag:x"}, "is not '@frag:N'"),
    ({"kind": "finding", "seq": 3}, "only the fold writes"),
    ({"kind": "commitment", "check": "c"}, "due_at"),
])
def test_append_refuses_what_the_ledger_refuses_and_writes_nothing(repo, fields, expect):
    repo.git("switch", "-q", "-c", "claude/x")
    with pytest.raises(ValueError, match=expect):
        F.append_fragment(repo.path, {**BASE, **fields}, base_ref="dev")
    assert not repo.exists(f"{F.FRAG_DIR_REL}/claude--x.jsonl")


# ── fold ─────────────────────────────────────────────────────────────────────────────────────────────────────────
def test_fold_follows_merge_order_not_name_order_and_keeps_the_chain(repo):
    merge(repo, "zeta", frag({"kind": "finding", "target": "z1"}, {"kind": "finding", "target": "z2"}),
          date="2026-10-22T13:00:00Z")
    merge(repo, "alpha", frag({"kind": "finding", "target": "a1"}), date="2026-10-22T14:00:00Z")
    pending = F.pending_on_ref(repo.path, "dev")
    assert [n for n, _ in pending] == ["zeta", "alpha"]
    s = F.fold(repo.path, "dev")
    lines = repo.lines()
    assert [json.loads(x).get("fragment") for x in lines[2:]] == ["zeta:1", "zeta:2", "alpha:1"]
    assert [json.loads(x)["target"] for x in lines[2:]] == ["z1", "z2", "a1"]
    assert (s["first_seq"], s["last_seq"]) == (3, 5)
    assert L.verify(lines, anchor=L.read_anchor(repo.path_of(STATE)), base=lines[:2]) == []
    assert L.read_anchor(repo.path_of(STATE)) == (5, L.line_hash(lines[-1]))
    assert F.content_mismatches(lines, pending) == []
    assert not repo.exists(f"{F.FRAG_DIR_REL}/zeta.jsonl") and not repo.exists(f"{F.FRAG_DIR_REL}/alpha.jsonl")
    assert repo.exists(F.SENTINEL_REL)
    # The mutant: the same fragments folded in NAME order give a different chain, and the content check says so.
    by_name, _ = F.fold_entries(lines[:2], sorted(pending), json.loads(lines[2])["at"])
    assert by_name != lines[2:]
    assert any("out of merge order" in p for p in F.content_mismatches(lines, sorted(pending)))


def test_fold_resolves_local_cross_fragment_and_already_folded_references(repo):
    merge(repo, "a", frag({"kind": "commitment", "due_at": "2026-10-30T00:00:00Z", "check": "c"},
                          {"kind": "finding", "fulfills": "@frag:1"}))
    merge(repo, "b", frag({"kind": "correction", "corrects": "@frag:a:2"}), date="2026-10-22T14:00:00Z")
    F.fold(repo.path, "dev")
    repo.commit("fold 1")
    merge(repo, "c", frag({"kind": "finding", "fulfills": "@frag:a:1"}, {"kind": "correction",
                                                                         "corrects": "@frag:b:1"}),
          date="2026-10-22T15:00:00Z")
    F.fold(repo.path, "dev")
    by = {json.loads(x).get("fragment"): json.loads(x) for x in repo.lines()}
    assert by["a:2"]["fulfills"] == by["a:1"]["seq"] == 3
    assert by["b:1"]["corrects"] == by["a:2"]["seq"] == 4
    assert by["c:1"]["fulfills"] == 3 and by["c:2"]["corrects"] == 5      # a and b were already folded and deleted
    assert L.verify(repo.lines(), anchor=L.read_anchor(repo.path_of(STATE))) == []


def test_fold_in_a_mixed_state_appends_after_legacy_direct_lines(repo):
    merge(repo, "new-pr", frag({"kind": "finding", "fulfills": 1}))
    lines = repo.lines()                                     # a legacy PR merges next: two direct lines + the anchor
    lines.append(L.canonical(L.make_entry(lines, kind="pr_open", at="2026-10-22T15:00:00Z", **BASE)))
    lines.append(L.canonical(L.make_entry(lines, kind="commitment", due_at="2026-10-30T00:00:00Z", check="c",
                                          at="2026-10-22T15:00:00Z", **BASE)))
    repo.write(LEDGER, "".join(x + "\n" for x in lines))
    repo.write(STATE, state_text(lines))
    repo.commit("legacy pr", date="2026-10-22T15:30:00Z")
    merge(repo, "later", frag({"kind": "finding", "fulfills": 4}), date="2026-10-22T16:00:00Z")
    F.fold(repo.path, "dev")
    out = repo.lines()
    assert [json.loads(x).get("fragment") for x in out] == [None] * 4 + ["new-pr:1", "later:1"]
    assert json.loads(out[5])["fulfills"] == 4
    assert L.verify(out, anchor=L.read_anchor(repo.path_of(STATE)), base=lines) == []


@pytest.mark.parametrize("bad", [
    '{"kind":"finding"}\n',                                                     # hand-written, no fields
    L.canonical({**BASE, "kind": "finding"}) + "\n",                            # no acted_at
    frag({"kind": "finding", "fulfills": "@frag:nowhere:1"}),                   # a reference that resolves nowhere
])
def test_fold_refuses_a_bad_fragment_and_changes_nothing(repo, bad):
    merge(repo, "good", frag({"kind": "finding"}))
    merge(repo, "bad", bad, date="2026-10-22T14:00:00Z")
    before = (repo.read(LEDGER), repo.read(STATE))
    with pytest.raises(F.LedgerError, match="refusing the fold"):
        F.fold(repo.path, "dev")
    assert (repo.read(LEDGER), repo.read(STATE)) == before
    assert repo.exists(f"{F.FRAG_DIR_REL}/good.jsonl") and repo.exists(f"{F.FRAG_DIR_REL}/bad.jsonl")


def test_fold_refuses_a_checkout_that_is_not_the_base(repo):
    merge(repo, "a", frag({"kind": "finding"}))
    repo.write(LEDGER, repo.read(LEDGER) + "local edit\n")
    with pytest.raises(F.LedgerError, match="differs from"):
        F.fold(repo.path, "dev")


def test_a_fragment_name_added_twice_is_refused(repo):
    merge(repo, "x", frag({"kind": "finding"}))
    F.fold(repo.path, "dev")
    repo.commit("fold")
    merge(repo, "x", frag({"kind": "finding"}), date="2026-10-22T15:00:00Z")
    with pytest.raises(F.LedgerError, match="more than once"):
        F.pending_on_ref(repo.path, "dev")


def test_nothing_to_fold_changes_nothing(repo):
    before = (repo.read(LEDGER), repo.read(STATE))
    assert F.fold(repo.path, "dev")["folded"] == []
    assert (repo.read(LEDGER), repo.read(STATE)) == before


def test_the_fold_selftests_catch_every_mutant():
    assert F.selftest() == []
    assert L.main(["selftest"]) == 0


# ── check-pr: the guard ──────────────────────────────────────────────────────────────────────────────────────────
def pr(r, branch="claude/pr"):
    r.git("switch", "-q", "-c", branch, "dev")


def check(r, created=LANDED.replace("12:", "13:"), head_ref="claude/pr"):
    return F.check_pr(r.path, "dev", "HEAD", pr_created_at=created, head_ref=head_ref)


def test_a_pr_adding_a_valid_fragment_passes(repo):
    pr(repo)
    F.append_fragment(repo.path, {**BASE, "kind": "finding"}, base_ref="dev")
    repo.commit("work")
    problems, notes = check(repo)
    assert problems == [] and any("claude--pr" in n for n in notes)


@pytest.mark.parametrize("created,legacy", [("2026-10-22T11:59:00Z", True), ("2026-10-22T12:01:00Z", False)])
def test_a_direct_ledger_edit_fails_unless_the_pr_predates_the_protocol(repo, created, legacy):
    pr(repo)
    lines = repo.lines()
    lines.append(L.canonical(L.make_entry(lines, kind="finding", at="2026-10-22T13:00:00Z", **BASE)))
    repo.write(LEDGER, "".join(x + "\n" for x in lines))
    repo.write(STATE, state_text(lines))
    repo.commit("direct append")
    problems, notes = check(repo, created=created)
    assert (problems == []) is legacy, problems
    assert legacy == any("LEGACY" in n for n in notes)
    if not legacy:
        assert any("edits ACTIONS.jsonl" in p for p in problems)


def test_moving_only_the_anchor_fails(repo):
    pr(repo)
    repo.write(STATE, repo.read(STATE).replace("seq 2,", "seq 1,"))
    repo.commit("anchor")
    assert any("moves the STATE anchor" in p for p in check(repo)[0])


@pytest.mark.parametrize("change,expect", [
    ("edit", "immutable"), ("delete", "only a fold removes"),
])
def test_a_merged_fragment_is_immutable(repo, change, expect):
    merge(repo, "merged", frag({"kind": "finding"}))
    pr(repo)
    if change == "edit":
        repo.write(f"{F.FRAG_DIR_REL}/merged.jsonl", frag({"kind": "finding", "outcome": "rewritten"}))
    else:
        os.remove(repo.path_of(f"{F.FRAG_DIR_REL}/merged.jsonl"))
    repo.commit(change)
    assert any(expect in p for p in check(repo)[0])


def test_a_reused_fragment_name_fails(repo):
    merge(repo, "claude--pr", frag({"kind": "finding"}))
    F.fold(repo.path, "dev")
    repo.commit("fold")
    pr(repo)
    repo.write(f"{F.FRAG_DIR_REL}/claude--pr.jsonl", frag({"kind": "finding"}))
    repo.commit("reuse")
    assert any("DUPLICATE" in p for p in check(repo)[0])


@pytest.mark.parametrize("bad,expect", [
    (frag({"kind": "finding", "seq": 3}), "only the fold writes"),
    ('{"kind": "finding"}\n', "not canonical"),
    (frag({"kind": "finding", "fulfills": "@frag:gone:1"}), "does not resolve"),
])
def test_an_invalid_fragment_line_fails(repo, bad, expect):
    pr(repo)
    repo.write(f"{F.FRAG_DIR_REL}/claude--pr.jsonl", bad)
    repo.commit("bad")
    assert any(expect in p for p in check(repo)[0])


def test_a_stray_file_in_ledger_d_fails(repo):
    pr(repo)
    repo.write(f"{F.FRAG_DIR_REL}/Notes.txt", "x\n")
    repo.commit("stray")
    assert any("only <name>.jsonl" in p for p in check(repo)[0])


def _two_merged(repo):
    merge(repo, "first", frag({"kind": "finding", "target": "f1"}, {"kind": "finding", "target": "f2"}))
    merge(repo, "second", frag({"kind": "finding", "target": "s1"}), date="2026-10-22T14:00:00Z")


def _fold_branch(repo, mutate=None, branch="ledger-fold/t", message="chore(ledger): fold\n\nLedger-Fold: 2"):
    """A fold PR made by F.fold, then optionally tampered with by `mutate(repo)` before the commit."""
    pr(repo, branch)
    F.fold(repo.path, "dev")
    if mutate:
        mutate(repo)
    repo.commit(message)


def test_a_true_fold_pr_passes(repo):
    _two_merged(repo)
    _fold_branch(repo)
    problems, notes = check(repo, head_ref="ledger-fold/t")
    assert problems == [] and any("FOLD PR folding 2" in n for n in notes)


def test_a_fold_is_recognised_by_its_trailer_on_any_branch(repo):
    _two_merged(repo)
    _fold_branch(repo, branch="claude/other")
    assert check(repo, head_ref="claude/other")[0] == []


def _rewrite(repo, folded):
    """ACTIONS.jsonl = the base's lines + `folded` renumbered and re-chained, anchor moved: a mutant that VERIFIES
    on its own, so only the fold check can catch it."""
    base = L.read_lines(repo.path_of(LEDGER))[:2]
    renumbered = [L.canonical({**json.loads(x), "seq": i}) for i, x in enumerate(folded, len(base) + 1)]
    lines = L.rechain(base + renumbered)
    repo.write(LEDGER, "".join(x + "\n" for x in lines))
    repo.write(STATE, state_text(lines))


@pytest.mark.parametrize("mutant,expect", [
    ("reversed", "not the fold"),            # the merge order reversed
    ("dropped", "not the fold"),             # a fragment line left out
    ("edited", "not the fold"),              # a folded line's content changed
])
def test_a_tampered_fold_pr_fails(repo, mutant, expect):
    _two_merged(repo)

    def tamper(r):
        folded = r.lines()[2:]
        folded = {"reversed": folded[::-1], "dropped": folded[:1] + folded[2:],
                  "edited": [folded[0].replace('"outcome":"o"', '"outcome":"x"')] + folded[1:]}[mutant]
        _rewrite(r, folded)
    _fold_branch(repo, tamper)
    assert L.verify(repo.lines(), anchor=L.read_anchor(repo.path_of(STATE))) == [], "the mutant must verify"
    assert any(expect in p for p in check(repo, head_ref="ledger-fold/t")[0])


def test_a_fold_that_skips_the_oldest_fragment_fails(repo):
    _two_merged(repo)
    pr(repo, "ledger-fold/t")
    pending = F.pending_on_ref(repo.path, "dev")
    new, _ = F.fold_entries(repo.lines(), pending[1:], "2026-10-23T00:00:00Z")
    _rewrite(repo, new)
    os.remove(repo.path_of(f"{F.FRAG_DIR_REL}/second.jsonl"))
    repo.commit("fold the second only\n\nLedger-Fold: 1")
    assert any("OLDEST" in p for p in check(repo, head_ref="ledger-fold/t")[0])


def test_check_pr_cli_passes_an_untouched_pr_before_any_ledger_logic_and_fails_closed_otherwise(repo, monkeypatch):
    monkeypatch.setattr(L, "ROOT", repo.path)

    def broken(*a, **k):
        raise RuntimeError("a checker bug")
    monkeypatch.setattr(F, "check_pr", broken)
    pr(repo)
    repo.write("other.txt", "y\n")
    repo.commit("unrelated")
    assert L.main(["check-pr", "--base", "dev"]) == 0
    F.append_fragment(repo.path, {**BASE, "kind": "finding"}, base_ref="dev")
    repo.commit("ledger work")
    assert L.main(["check-pr", "--base", "dev"]) == 1


# ── fold-pr: the lead's command, against a real remote ──────────────────────────────────────────────────────────
def test_fold_pr_dry_run_then_push_then_replace(repo, tmp_path):
    remote = tmp_path / "remote.git"
    subprocess.run(["git", "init", "-q", "--bare", "-b", "dev", str(remote)], check=True)
    repo.git("remote", "add", "origin", str(remote))
    _two_merged(repo)
    repo.git("push", "-q", "origin", "dev")
    said = []
    s = F.fold_pr(repo.path, dry_run=True, out=said.append)
    assert [n for n, _, _ in s["folded"]] == ["first", "second"] and "dry run" in said[-1]
    assert repo.git("ls-remote", "--heads", "origin", "ledger-fold/*") == ""
    assert repo.git("status", "--porcelain") == "" and len(repo.git("worktree", "list").splitlines()) == 1
    s = F.fold_pr(repo.path, open_pr=False, co_authors=["Tester <t@example.invalid>"], out=said.append)
    branch = s["branch"]
    assert branch.startswith("ledger-fold/") and repo.git("ls-remote", "--heads", "origin", branch)
    repo.git("fetch", "-q", "origin")
    msg = repo.git("log", "-1", "--format=%B", f"origin/{branch}")
    assert "Ledger-Fold: 2 fragments, seq 3-5" in msg and "Co-Authored-By: Tester" in msg
    repo.git("switch", "-q", "--detach", f"origin/{branch}")
    assert F.check_pr(repo.path, "origin/dev", "HEAD", head_ref=branch)[0] == []
    # A legacy PR lands on dev first: the fold conflicts, and --replace recomputes it from the new dev.
    repo.git("switch", "-q", "dev")
    lines = repo.lines()
    lines.append(L.canonical(L.make_entry(lines, kind="finding", at="2026-10-22T20:00:00Z", **BASE)))
    repo.write(LEDGER, "".join(x + "\n" for x in lines))
    repo.write(STATE, state_text(lines))
    repo.commit("legacy pr")
    repo.git("push", "-q", "origin", "dev")
    s = F.fold_pr(repo.path, replace=branch, open_pr=False, out=said.append)
    assert (s["first_seq"], s["last_seq"]) == (4, 6)
    repo.git("fetch", "-q", "origin")
    repo.git("switch", "-q", "--detach", f"origin/{branch}")
    assert F.check_pr(repo.path, "origin/dev", "HEAD", head_ref=branch)[0] == []


# ── memory_audit: the virtual fold ──────────────────────────────────────────────────────────────────────────────
def _docs(tmp_path):
    src = os.path.join(os.path.dirname(BACKEND), "docs", "weather-program")
    d = tmp_path / "docs"
    os.makedirs(d / "ledger.d")
    for name in M.REQUIRED_DOCS:
        with open(os.path.join(src, name), encoding="utf-8", newline="") as f:
            (d / name).write_bytes(f.read().encode("utf-8"))
    return d


def test_audit_fails_an_invalid_fragment_and_a_stray_file_and_passes_a_valid_one(tmp_path):
    d = _docs(tmp_path)
    (d / "ledger.d" / "good.jsonl").write_bytes(frag({"kind": "finding"}, acted_at="2026-10-23T00:00:00Z").encode())
    assert not [m for lv, m in M.audit_docs(str(d)) if lv == "FAIL"]
    (d / "ledger.d" / "bad.jsonl").write_bytes(frag({"kind": "finding", "seq": 9}).encode())
    (d / "ledger.d" / "notes.txt").write_text("x")
    fails = [m for lv, m in M.audit_docs(str(d)) if lv == "FAIL"]
    assert any("ledger.d/bad.jsonl:1" in m and "only the fold writes" in m for m in fails), fails
    assert any("ledger.d/notes.txt" in m for m in fails), fails


def test_the_repos_own_fragments_chain_cleanly_onto_its_ledger():
    """The dogfood: every fragment committed here (this PR's own first) folds without an error."""
    texts, problems = F.read_dir_fragments(M.DOCS)
    order = F.working_order(M.ROOT, list(texts))
    _, labels, errs = F.virtual_ledger(L.read_lines(L.LEDGER), [(n, texts[n]) for n in order])
    assert problems == [] and errs == []
    assert os.path.exists(os.path.join(M.DOCS, "ledger.d", "README.md")), "the landing sentinel is missing"
