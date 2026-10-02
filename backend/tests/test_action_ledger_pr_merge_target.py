"""A `pr_merge` ledger line's target is exactly `#N`: the form the completeness audit counts.

WHY (2026-10-02). `memory_audit.check_completeness` credits a PR merge only to a `pr_merge` line whose target is
`#N`. Seq 294 recorded #219's merge as "PR #219 (claude/commitments-182-228 -> dev): ...", so #219 read as unrecorded,
and nothing failed when that line was written: the audit only WARNs about the NEWEST merge, and FAILs once a newer one
exists. `action_ledger.append` now refuses any other target for a `pr_merge`. History stays valid (`verify` is
unchanged, and the chain is append-only), and the audit credits seq 294 by its exact hash, never by parsing its text.
"""
import json
import os
import sys

import pytest

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

from scripts import action_ledger as L  # noqa: E402
from scripts import memory_audit as M   # noqa: E402

SEQ_294_TARGET = ("PR #219 (claude/commitments-182-228 -> dev): the W-23 label stays out of the cached product and "
                  "is logged; commitments 182 (partial) and 228")
BASE = dict(actor="test", why="w", authorized_by="a", outcome="o", verified="v", rollback="r", evidence=["e"])


def _append(path, kind, target, at="2026-10-02T01:00:00Z"):
    return L.append(str(path), kind=kind, target=target, at=at, **BASE)


def _credited(entries, n, **kw):
    """Does the audit count PR #n as ledgered? #n is placed SECOND newest, where a missing line FAILs."""
    merges = [(n + 1, "2026-10-02T12:00:00Z"), (n, "2026-10-02T11:00:00Z")]
    return not any(f"PR #{n} " in msg for _, msg in M.check_completeness(entries, merges, **kw))


def _old_script_line(lines, **fields):
    """A line as the pre-rule `append` wrote it: canonical and chained, with no target check."""
    return L.canonical(L.make_entry(lines, **{**BASE, **fields}))


# ── the refusal ───────────────────────────────────────────────────────────────────────────────────────────────────
def test_append_refuses_the_seq_294_target_and_names_the_required_form(tmp_path):
    p = tmp_path / "ACTIONS.jsonl"
    _append(p, "pr_open", "#219")
    before = p.read_bytes()
    with pytest.raises(ValueError) as ex:
        _append(p, "pr_merge", SEQ_294_TARGET, at="2026-10-02T03:43:27Z")
    assert "'#<PR number>'" in str(ex.value) and "--why" in str(ex.value), (
        f"the refusal must name the required form and where the title goes; got {ex.value}")
    assert p.read_bytes() == before, "a refused pr_merge line was written anyway"


@pytest.mark.parametrize("target", [
    "PR #219", "219", "#0219", " #219", "#219 ", "#219\n", "#219 (claude/x -> dev)", "#219, #220",
    "#٢١٩",   # Arabic-Indic 219: `\d` matches it, int() reads it, and f"#{n}" never equals it
    "#", "#-219", "#+219", "##219",
])
def test_append_refuses_every_target_but_exactly_hash_n(tmp_path, target):
    with pytest.raises(ValueError, match="pr_merge target"):
        _append(tmp_path / "ACTIONS.jsonl", "pr_merge", target)


@pytest.mark.parametrize("n", [1, 219, 100000])
def test_every_pr_merge_append_accepts_is_one_the_audit_credits(tmp_path, n):
    """The writer may be stricter than the reader, never looser: what `append` takes, the audit must count."""
    p = tmp_path / "ACTIONS.jsonl"
    _append(p, "pr_merge", f"#{n}")
    entries = [json.loads(x) for x in L.read_lines(str(p))]
    assert _credited(entries, n, legacy={})


def test_other_kinds_keep_a_free_target(tmp_path):
    e = _append(tmp_path / "ACTIONS.jsonl", "pr_open", SEQ_294_TARGET)
    assert e["target"] == SEQ_294_TARGET


# ── history stays valid ───────────────────────────────────────────────────────────────────────────────────────────
def test_verify_still_accepts_a_titled_pr_merge_line_the_old_append_wrote():
    lines = [_old_script_line([], kind="pr_open", target="#219", at="2026-10-02T01:00:00Z")]
    lines.append(_old_script_line(lines, kind="pr_merge", target=SEQ_294_TARGET, at="2026-10-02T03:43:27Z"))
    assert L.verify(lines) == []


def test_the_real_history_through_seq_294_still_verifies():
    lines = L.read_lines(L.LEDGER)[:294]
    e = json.loads(lines[293])
    # The control: the shape this protects is really in history, or the test proves nothing.
    assert (e["seq"], e["kind"]) == (294, "pr_merge") and e["target"].startswith("PR #219 ("), e
    assert L.verify(lines) == []


# ── the audit's credit for seq 294 ────────────────────────────────────────────────────────────────────────────────
def test_the_audit_credits_seq_294_as_219_on_the_real_history():
    """Through seq 294 the only record of #219's merge is the titled line itself."""
    entries = [json.loads(x) for x in L.read_lines(L.LEDGER)[:294]]
    assert _credited(entries, 219)


def test_the_legacy_credit_is_one_line_pinned_by_its_hash():
    line_294 = L.read_lines(L.LEDGER)[293]
    assert M.LEGACY_PR_MERGES == {L.line_hash(line_294): 219}


def test_a_copy_of_the_titled_line_cannot_borrow_its_credit():
    """The same text at another position hashes differently, so it stays uncredited and the merge FAILs."""
    lines = [_old_script_line([], kind="pr_open", target="#219", at="2026-10-02T01:00:00Z")]
    lines.append(_old_script_line(lines, kind="pr_merge", target=SEQ_294_TARGET, at="2026-10-02T03:43:27Z"))
    entries = [json.loads(x) for x in lines]
    assert _credited(entries, 219, legacy={L.line_hash(lines[1]): 219})
    moved = [lines[0]]
    moved.append(_old_script_line(moved, kind="finding", target="x", at="2026-10-02T02:00:00Z"))
    moved.append(_old_script_line(moved, kind="pr_merge", target=SEQ_294_TARGET, at="2026-10-02T03:43:27Z"))
    assert json.loads(moved[2])["target"] == json.loads(lines[1])["target"]
    assert not _credited([json.loads(x) for x in moved], 219, legacy={L.line_hash(lines[1]): 219})


def test_a_titled_target_is_not_read_for_its_leading_number():
    """Why the credit is pinned, not parsed: a leading `PR #N` need not be the PR that merged."""
    lines = [_old_script_line([], kind="pr_merge", target="PR #219's revert, merged as #226",
                              at="2026-10-02T03:43:27Z")]
    entries = [json.loads(x) for x in lines]
    assert not _credited(entries, 219, legacy={}) and not _credited(entries, 226, legacy={})
