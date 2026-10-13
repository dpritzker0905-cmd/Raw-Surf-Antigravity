# 2026-10-02 session cached-product-guard: one guard on the invariant, not on the last attribute

Worktree `C:\Users\David\App\raw-surf\.claude\worktrees\ledger-month-rollover`, branch `claude/cached-product-guard`,
stacked on #219 (`claude/commitments-182-228` @ `4d3848ce`), so this branch's ledger lines follow #219's seq 293 (LESSONS
L-P21). Owner (chat, 2026-10-02): "go, build the cached-product guard, pay attention to the concurrent models audits".
Times are clock reads (`date -u`) or platform timestamps (L-P10). **This change moves no served number**: it is a
test-side guard (README rule 5).

## Why (03:50:32Z)

`store_helpers.load_product_helper` hands out ONE-LEVEL copies of the L1 entry (`product.model_copy()` plus
`grid.model_copy()`), so `vectors`, `diagnostics`, `warnings` and every other nested object are the cache's own. Four
serve paths shipped writes into them: the coarse gulf fill (#211, fix `ea3aa78d`), the mid-res tier's diagnostics
(#212, `a0f88ef0`), the resolver's step-4 stamps (#213, `7da3367b`) and the W-23 label (#219, `67c7a588`, found
after this session's read-only W-23 log count showed the label is response-only). Each fix added a guard keyed to ONE
attribute (`test_grid_vector_shared_writes.py` for `.vectors`, `test_grid_resolver_shared_diagnostics.py` for
diagnostics); the W-23 bug wrote a third attribute (`warnings`) and passed both. The hazard was known since
2026-08-08 (the surf overlay pinned its own no-mutation contract, `test_grid_surf_overlay_copies.py`) and is still
guarded only in prose in `grid_series_helper.py` and `series_vector_budget.py`.

Correction to my own count, made before it reached any tracked file's final text: I first called the surf overlay a
fifth shipped instance. It was not: `7dea8ff7` (2026-08-08) dropped a wasted deepcopy and pinned the contract; no
mutation shipped there. The class has four shipped instances.

## The guard

- `backend/tests/l1_product_guard.py` (test-side, no production code): `install(monkeypatch)` wraps
  `store_helpers.load_product_helper`, the one function that fills `ProductStore._product_cache` and hands out
  copies. After every call it looks up the entry under that call's cache key in whatever dict is current (two tests
  swap the dict, among them `test_l2_read_refusal.py`, where #219's bug lived), and the first time it meets a product
  object it keeps the object and its JSON. `changes()` re-serializes every kept product and names the first differing
  paths (e.g. `p.json: grid.vectors[2].speed 3.0 -> 9.5`). Keyed to the invariant, so it also covers fields nobody has
  broken yet. Limits are written in its docstring.
- `backend/tests/conftest.py`: an autouse fixture installs it for EVERY backend test and fails the test at teardown
  if a cached product changed; `@pytest.mark.l1_mutation_expected` stands it down for a test that mutates on purpose.
- `backend/tests/test_l1_cached_product_guard.py` (14 tests): a positive control per historical mutation shape
  (vector attribute, diagnostics key, warnings append, vectors grow and shrink), null controls (read-only use, a cache
  hit, and each fix's rebind shape), the report format, and the cases a dict-keyed guard would miss (an entry a test
  inserted directly, a swapped cache dict, a strided key, a mutation after eviction), plus a tripwire that the autouse
  guard is installed.
- TDD: the test module failed first (`No module named 'tests.l1_product_guard'`), then 14 passed.

## The sweep: every existing backend test as a probe

With the autouse guard on, each CI lane was run locally (lane lists from `scripts/ci_test_lanes.py`):
- chain: 1751 passed, 0 failed, 0 guard errors (3 deselected, see below; 1751 + 3 = 1754 = the projected 1740 + 14).
- estate: 580 passed, 1 failed, 0 guard errors. The failure is `test_password_hashing_py313.py::test_the_simulation_is_only_a_simulation_below_3_13`, the known local-environment gap (hosted CI reads 582 passed).
- guards (four parallel chunks, `--timeout=600`): 621 + 616 + 474 + 470 = 2181 passed, 0 failed, 0 guard errors
  (hosted CI reads 2183; this venv lacks two declared packages, the known 2-test gap).

So about 4,510 existing tests ran with the guard watching every product they received from the L1 cache, and none
changed one: the four fixes hold, and no fifth instance hides in a tested path. A null result means something only
if the guard can see these bugs, so the next section re-introduces them.

## Positive controls: the four real bugs, re-introduced one at a time

Each fix was reversed in the source (`git apply -R` of its own hunk; #212's by exact string, since #210 moved its
lines), the tests run, and the source restored and checked byte-identical. Two measurements per bug:
(a) SENSITIVITY, the bug's per-site test with the generic guard on, counting the GUARD's teardown errors separately
from that test's own assertion failures; (b) INDEPENDENCE, every test that can observe a cached product (117 files
touching the store, the weather routes or the serve modules) with every per-site and attribute-keyed AST guard removed.

| Bug | (a) guard errors in the per-site test (its own failures) | (b) guard errors in general tests |
|---|---|---|
| #211 gulf fill writes cached vectors | 4 (5) | 0 |
| #212 mid tier stamps cached diagnostics | 4 (4) | 0 |
| #213 resolver step-4 stamps cached diagnostics | 9 (7) | 16: `test_capabilities_contract.py` (6), `test_euro_estimator.py` and others |
| #219 W-23 label appends to cached warnings | 1 (2) | 0 |

Reading:
- **Sensitivity is 4 of 4**: the guard sees each real bug wherever its path runs, and in #213's file it flags 9 tests
  where the file's own assertions caught 7.
- **Independent coverage is 1 of 4**: only the resolver path (#213) is exercised through the store by general tests.
  The other three paths run only in their per-site tests, so for them the guard adds no reach yet. Detection is
  sensitivity times path coverage; the gap is now measured instead of assumed.
- **The choke-point design was necessary**: `test_capabilities_contract.py` swaps the cache dict
  (`monkeypatch.setattr(ProductStore, "_product_cache", {})`), and 6 of #213's 16 catches came from it. A guard built
  as a dict subclass would have been blind there.
- Next step (a commitment below): one scenario test that drives the real serve chain over a populated L1 through all
  four paths, so (b) reads 4 of 4.

Two runner defects of mine were caught and fixed before any number above was taken: a text-mode pipe on Windows
turned the patches' `\n` into `\r\n`, so three reversals "did not apply" (patches now go to git as bytes); and my first
count parsed pytest's short summary, which prints teardown errors without their message, so it read 0 guard errors
while the guard had fired (counts now come from the guard's own `E   AssertionError:` line).

## CI floor

Chain lane `MIN_FILES` 140 -> 141, `MIN_PASSED` 1734 -> 1748, `_FLOOR_SET_FROM["chain"]` 1740 -> 1754: the hosted
reading of 140 files / 1740 (#219's run 36959067942, confirmed on dev `c4a59c01` by run 36961412429) plus the new file's
14 tests, minus the 6-test margin. #220 (PR C) moves the same lines and re-derives from the hosted reading after this
PR merges (agreed with its session: 142 / 1777 expected).

## Coordination with the concurrent sessions

- The #219 session: this branch was stacked on #219's head; #219 merged unchanged as `c4a59c01`; agreed that this PR
  records `pr_merge #219` (seq 294) and that session records #219's deploy read-back on its next branch.
- The PR C session (#220): agreed order guard -> #220 -> far-zoom re-chain; it re-chains its seq 294-295 after this PR
  and runs its tests under this conftest before pushing.
- The far-zoom session: its backend changes run clean under the guard (scratch export, never its worktree).

## Ledger

seq 294 (pr_merge #219), seq 295 (finding: the measurements above), seq 296 (decision: the guard), seq 297
(correction: four shipped instances, not five), seq 298 (commitment: lift independent coverage to 4 of 4, due
2026-10-09) and seq 299 (commitment: hosted read-back and the guard's CI cost, due 2026-10-04).

## PR #223 opened (12:53:04Z)

The owner paused before the push, then said "push it and open the PR". dev was unchanged (`c4a59c01`, ledger head
293), so no re-chain was needed. Pushed `claude/cached-product-guard` at `f1159411`, opened #223 against dev, ledger
seq 300 (pr_open). Nothing is merged. Meanwhile #222 (the #219 session's commitment-228 branch) opened with its own
seq 294-298, including its own `pr_merge #219`. Agreed with that session: whichever of #222 and #223 reaches dev
second drops its `pr_merge #219` when it re-chains.

Two local-only obstacles, recorded rather than fixed here:
1. **A non-hermetic test path.** `scheduler._cleanup_and_pause` reaches `sim_forecast.fetch_catalog` (line 191), a live HTTP
   call with no timeout. On this machine DNS for the fake test host blocks for minutes (CI's network answers), so
   `tests/test_all_wind_pilots_multi_bbox.py::test_one_pass_covers_every_region` (3 parametrizations, deselected) and
   `tests/test_ecmwf_euro.py` hung the first sweeps. The later sweeps loaded a local-only pytest plugin that fails
   any non-local DNS lookup at once (never committed).
2. **A half-second budget that flakes under load.** `series_source_policy` wraps `store.get_manifest` in
   `asyncio.wait_for(..., timeout=0.5)`. With three lane sweeps loading the machine,
   `test_series_source_policy.py::test_exact_stored_coverage_serves_stored_frames_without_a_live_fetch` failed once.
   An A/B on the same 21 files under equal load passed with the guard on and with it off (328 passed each), so the
   guard is not involved.

The concurrent far-zoom branch's backend changes (`grid_series_helper.py`, `mid_res_tier.py`,
`series_vector_budget.py`, `tests/test_series_max_thinning.py`, overlaid in a scratch export, never in its worktree)
run clean under the guard: 0 guard errors, 328 passed.
