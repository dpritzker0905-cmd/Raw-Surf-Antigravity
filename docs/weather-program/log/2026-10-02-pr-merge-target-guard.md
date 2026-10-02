# 2026-10-02 session pr-merge-target-guard: a `pr_merge` target is exactly `#N`, refused at the write

Worktree `C:\Users\David\App\raw-surf\.claude\worktrees\gracious-mccarthy-c53f90`, branch `claude/pr-merge-target-guard`,
off `dev` @ `ca71acd1` (#223's merge; ledger head seq 300). Owner (chat, 2026-10-02): "Task: make the mismatch
impossible to write silently." Times are clock reads (`date -u`) or platform timestamps (L-P10). **This change moves
no served number**: it touches the ledger tooling and its tests only (README rule 5).

## The defect (14:19:05Z)

`memory_audit.check_completeness` builds `ledgered = {target.strip() for pr_merge lines}` and asks `f"#{n}" in
ledgered`: exact membership, so a merge counts only for a line whose target is `#N`. Seq 294 recorded #219's merge
with target `PR #219 (claude/commitments-182-228 -> dev): ...`, so #219 read as unrecorded: a WARN while it was the
newest merge, a FAIL from the moment #223 merged. Nothing failed when the line was written, so the defect was silent.
#224 works around it (its seq 303 re-records `#219`, `--corrects 294`), and #220, #221 and #222 also carry a `#219`
line. Census of `dev`'s ledger at `ca71acd1`: 59 `pr_merge` lines, 58 with a `#N` target, 1 without (seq 294).

## The fix

- `action_ledger.append` refuses a `pr_merge` whose target does not fullmatch `#[1-9][0-9]*`, with a message naming
  `'#<PR number>'` and saying the branch and title go in `--why` or `--outcome`. `[0-9]`, not `\d`: Python's `\d`
  matches other scripts' digits (`#٢١٩`), and neither those nor a leading zero (`#0219`) are anything `f"#{n}"` can
  produce, so a looser writer would let the same silent miss back in a smaller shape. `verify()` and `check_entry()`
  are unchanged: seq 294 and all history stay valid, and the chain stays append-only (L-P10's refusal is the pattern).
- The audit credits seq 294 as #219 through `LEGACY_PR_MERGES`, keyed by the line's sha256. The owner allowed a
  leading-`PR #N` reading only if it provably could not credit the wrong PR. Over free text it cannot be proven: a
  target like `PR #219's revert, merged as #226` would count as #219's record (a test now pins that shape as
  uncredited). A hash pin is exact by construction: the ledger is append-only and hash-chained, so that line can never
  change, and a copy of its text anywhere else hashes differently (tested). With the pin, this branch's audit is
  0 FAIL without a fifth `#219` line.
- Selftests: `action_ledger selftest` refuses seq 294's real shape, accepts `#219`, and still verifies a titled line
  the old script wrote; its existing `pr_merge` fixture line moved from target `t` to `#2`. `memory_audit --selftest`
  credits a pinned legacy line and refuses the credit to a copy of it.

## Measured

- RED first: `tests/test_action_ledger_pr_merge_target.py` 21 failed / 3 passed before the fix (14 refusals did not
  raise, 6 hit the missing `legacy` parameter, 1 real-history credit was False). The 3 that passed are the
  history-stays-valid guards, which must pass both before and after.
- GREEN: 24 passed; both selftests exit 0; `action_ledger.py verify` 300 entries OK; `memory_audit.py --docs-only`
  with `8c242bbd` at HEAD: 0 FAIL, 1 WARN (#223, the newest merge, pending as designed).
- Mutations (L-P20), each restored byte-exactly, `git status` clean after: M1 rule moved into `check_entry` -> 3 red
  including both history tests, and the real audit FAILs (verify rejects seq 294); M2 regex `#\d+` -> red; M3 append
  check removed -> red, selftest red; M4 pin removed -> 2 red, the real audit FAILs on #219; M5 a leading `PR #N`
  parsed instead of pinned -> 2 red, `memory_audit` selftest red; M6 writer strips whitespace -> red.
- Floors: the new file is claimed by `--lane estate` only (272 -> 273 files; guards 179 and chain 141 unchanged; the
  partition holds). Hosted run 37009550311 (#223, the tree merged as `ca71acd1`) read estate 272 files / 582 passed;
  + 24 = 606 projected. `MIN_PASSED` 580 -> 604 and `_FLOOR_SET_FROM["estate"]` 582 -> 606 in the same commit
  (`8c242bbd`). Hosted CI must confirm 273 files / 606.

## Ledger

This PR appends its own lines only. It does not re-record #219 or #223: four open PRs already carry `#219` and three
carry `#223`, and the newest merge may wait (LESSONS L-P21). Whichever PR merges first keeps seq 301; the others
re-chain onto it.
