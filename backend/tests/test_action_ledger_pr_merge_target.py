"""A `pr_merge` ledger line's target is exactly `#N`: the form the completeness audit counts.

WHY (2026-10-02). `memory_audit.check_completeness` credits a PR merge only to a `pr_merge` line whose target is
`#N`. Seq 294 recorded #219's merge as "PR #219 (claude/commitments-182-228 -> dev): ...", so #219 read as unrecorded,
and nothing failed when that line was written: the audit only WARNs about the NEWEST merge, and FAILs once a newer one
exists. `action_ledger.append` now refuses any other target for a `pr_merge`. History stays valid (`verify` is
unchanged, and the chain is append-only). Existing historical merge corrections are preserved.
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


def _credited(entries, n):
    """Does the audit count PR #n as ledgered? #n is placed SECOND newest, where a missing line FAILs."""
    merges = [(n + 1, "2026-10-02T12:00:00Z"), (n, "2026-10-02T11:00:00Z")]
    return not any(f"PR #{n} " in msg for _, msg in M.check_completeness(entries, merges))


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
    "#", "#0", "#-219", "#+219", "##219",
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
    assert _credited(entries, n)


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




def test_cli_refusal_preserves_existing_bytes(monkeypatch, tmp_path):
    p = tmp_path / 'actions.jsonl'
    _append(p, 'finding', 'existing')
    before = p.read_bytes()
    monkeypatch.setattr(L, 'LEDGER', str(p))
    args = ['append', '--actor', 'codex', '--kind', 'pr_merge', '--target', 'PR #219',
            '--why', 'fixture', '--authorized-by', 'fixture', '--evidence', 'fixture',
            '--outcome', 'fixture', '--verified', 'fixture readback', '--rollback', 'delete fixture']
    with pytest.raises(ValueError, match='pr_merge target'):
        L.main(args)
    assert p.read_bytes() == before


def test_append_preserves_valid_legacy_prefix(tmp_path):
    p = tmp_path / 'actions.jsonl'
    old = _old_script_line([], kind='pr_merge', target=SEQ_294_TARGET, at='2026-10-02T01:00:00Z')
    p.write_bytes((old + '\n').encode('utf-8'))
    before = p.read_bytes()
    _append(p, 'pr_merge', '#220', at='2026-10-02T02:00:00Z')
    assert p.read_bytes().startswith(before)
    assert L.verify(L.read_lines(str(p))) == []
