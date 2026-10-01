# 2026-10-01 session grid-resolver-no-shared-diagnostics: the resolver's stamps no longer land in cached products

Worktree `C:\Users\David\App\raw-surf\.claude\worktrees\strange-snyder-982d2a`, branch
`claude/grid-resolver-no-shared-diagnostics` from `origin/dev` at `ac080442` (#207). Owner brief (chat): same class as
#211 and the mid-tier fix (branch `claude/mid-tier-no-shared-diagnostics`). `grid_resolver.py` step 4 ("Set diagnostics
renderable property explicitly") writes `renderable`, `partial_coverage`, `valid_time`, `served_valid_time` and
`frame_offset_hours` into `product.grid.diagnostics` in place. The EURO -> GFS fallback (~514-519) writes `provider`,
`stale` and `renderable` the same way. The brief asks for: a test through the real L1 cache for the coarse-tile and
regional-clip paths; one `dict(...)` rebind before each write block, served diagnostics unchanged; ledger lines; CI
floors; a mechanized guard to consider; and a PR against dev that is not merged. Times are clock reads (`date -u`) or
commit timestamps (L-P10). The machine reset once mid-session (about 01:30Z); the WIP commits survived, and the one
mutation left applied in the tree was finished and restored after the reset.

**No served number changes** (no surf height, rating, glyph score, hub or sim value). The served `grid.diagnostics`
dicts are key-for-key what they were, which a test pins. The frontend reads only `surf_transform` and `gridMode` from
`grid.diagnostics` (`backendCopernicusServiceClient.js`, `backendWeatherServiceClient*.js`), and these writes touch
neither. `grid_series` frames are built from product attributes, not from this dict. What was wrong is metadata and
provenance in the `/grid` payload, and the cache it was written into. There is no SCOREBOARD row.

## 01:18-01:26:36Z · the defect, measured (RED; WIP `cd2350e3`, squashed into `7da3367b`)
- New `backend/tests/test_grid_resolver_shared_diagnostics.py`. The pattern is #211's `test_coarse_fill_shared_vectors.py`
  and the mid-tier branch's test: a real `ProductStore` over tmp files, wired into `routes.weather.get_grid`, with
  `store.is_test_environment` patched to False and `MARINE_MID_RES_TIER=0` (the brief's probe settings). Every stored
  grid carries a non-None diagnostics dict, as in production. Three scenarios:
  - `coarse_world`: an unclipped EURO `global_coarse` tile for a world bbox (Step 3, `global_tile`).
  - `regional_clip`: a EURO regional tile clipped to a 4-degree viewport (Step 3 + `filter_grid_to_bbox`).
  - `gfs_fallback`: EURO's upstream raises, and GFS answers as `viewport_service`'s in-flight WAITER does: the real
    `store.load_product` of the fetcher's product, then the real `filter_grid_to_bbox`. This turns the brief's
    reading-only claim into a measurement.
- Results before the fix: **7 of 16 RED**, each for the stated reason.
  - All three scenarios: the response's dict **was** the L1 entry's dict.
  - All three: a later request at 01Z, served from the same stored 00Z frame, **rewrote the earlier response**
    (`valid_time` 00Z -> 01Z).
  - The guard (below) named the 8 writes, `grid_resolver.py:517-519` and `:695-699`.
  - The 3 served-value pins passed on the pre-fix code, as designed: they pin WHAT is served, which the fix must not
    change.

## 01:26:36-01:27:20Z · the fix (WIP `717b6bda`, squashed into `7da3367b`)
- `grid_resolver.py`: `product.grid.diagnostics = dict(product.grid.diagnostics or {})` replaces the
  `if ... is None: = {}` guard, once before the fallback's writes and once before step 4's. The grid container is
  already the request's own on every lane: `load_product`, `filter_grid_to_bbox`, the dynamic-cache helpers
  (`viewport_helper.py`) and the far-edge hold all go through `store.load_product`, which copies product and grid one
  level. So rebinding the attribute never reaches L1.
- After the fix: 16 of 16 pass.
- **Mutation checks** (each applied to the committed fix, run, then restored with `git checkout HEAD --`):
  - Fallback rebind reverted to the old None-guard: `gfs_fallback`'s cached-dict test goes RED, and the GFS viewport
    product's L1 entry gains `['provider', 'renderable', 'stale']`. **The brief's by-reading claim is confirmed by
    execution.** The guard is also RED.
  - Step-4 rebind reverted: 4 RED (coarse and regional: the cached dict, and the later-hour rewrite). The fallback
    scenario stays green, correctly, because its own rebind already made the dict private. **But the first guard stayed
    GREEN.** That is the next section.

## 01:27-01:37:28Z · the guard, and what its own mutation check taught it (WIP `9949e92f`, squashed into `7da3367b`)
- Section 4 of the same test file scans `services/` and `routes/` with `ast`. Every `X.grid.diagnostics[k] = v` (also
  `+=`, `del`, and `.update/.setdefault/.pop/.popitem/.clear`) must be preceded, in the same function, by a COPY of
  that dict. A copy is `dict(...)`, `copy.copy`, `copy.deepcopy` or `{**...}`, or `X = helper(...)` where the helper
  copies its own parameter's dict (`grid_resolver_surf._shallow_with_own_diagnostics`). `if X.grid.diagnostics is None:
  X.grid.diagnostics = {}` is deliberately not a copy: it is the pattern that shipped.
- **The first version used line order, and the step-4 mutation passed it.** The fallback's copy at ~517, inside its own
  branch, "covered" step 4's writes at ~700. The rule is now structural dominance: the copy must be an earlier
  statement of the write's own block or of an enclosing block. Under the same mutation, the guard now names all five
  step-4 writes. ⇒ A guard needs the same mutation check as the fix it protects (LESSONS-worthy; see the end).
- Controls (7): the pre-fix shape, a copy after the write, a copy of another object's dict, and a copy on another
  branch are all flagged. The fixed shape, a copy in an enclosing block over if/try/except, and the surf helper shape
  all pass.
- Lists, each ratcheted (an entry that stops violating fails the test until it is deleted):
  - `_EXEMPT`: `grid_resolver_surf.apply_surf_overlay`'s `surf_skip_reason` write in the except handler. The structural
    rule cannot prove it safe, but it is: it copies under `if not _copied:`, and every try-body copy sets `_copied`.
  - `_KNOWN_UNFIXED`: `mid_res_tier.try_serve_mid_res_tier`'s `mid_res_tier` stamp, which the mid-tier branch fixes.
    Whichever of the two PRs merges second deletes the entry (the ledger re-chain forces that PR to re-run CI, and the
    ratchet's message names the entry). #210 (`claude/c228-world-series`) keeps that stamp as is and writes
    `load_stride` through a local variable, so it is consistent with every merge order.
- What the guard cannot see (stated in the file): aliases (`d = X.grid.diagnostics; d[k] = v`), nested-dict writes,
  and a non-dominating copy made sufficient by an early return.
- LESSONS **L-P20** (mutate the fix and watch the guard). Numbered past #210's L-P19; #210 and #211 both claim L-F8,
  so whichever of them merges second renumbers.

## 01:37:28-01:43:28Z · the wider run, the floors, the squash
- The 38 test files that name `resolve_grid`, `get_grid` or `grid_resolver`, plus `test_ci_floor_staleness.py`: **413
  passed, 1 failed**, 4 skipped, 2 xfailed (3 min 59 s). The one failure,
  `test_weather_sim_mcp.py::test_database_update_propagation`, is `sqlite3.OperationalError: no such table:
  condition_reports`, and it fails identically with dev's `grid_resolver.py` restored: pre-existing and environmental
  (a local DB), not this change. This interpreter is not the declared environment, so hosted CI is the authority.
- CI floor: `--lane guards` claims the new file (chain 0, estate 0); the lane selects **177** files. Hosted reading on
  dev `ac080442`: run 36795274173 (verified through the public API: `CI`, push, `head_sha` ac080442, success). The
  176 files / 2146 passed are as read by #211 and the mid-tier branch: the job log needs a token (HTTP 403 without one).
  2146 + 18 = 2164, 2164 - 6 = **2158**; files **177** exact; `_FLOOR_SET_FROM["guards"]` -> 2164. Floor and lane tests:
  51 passed, `--assert-partition` OK. #211 moves the same guards block and `_FLOOR_SET_FROM["guards"]`, so the second of
  the two to merge re-derives from the hosted reading (L-P2).
- WIP commits squashed onto `ac080442` (still `origin/dev` at the 01:43:28Z fetch) as **`7da3367b`**: fix, test, floors.

## 01:43:59Z · ledger
- seq 239 `pr_merge #207` (reconstructed from the merge commit: `ac080442` at 2026-10-01T00:15:39Z, head `73736cc5`,
  docs only). No local session branch recorded it. `gh pr view` could not be run.
  - ⚠️ **CORRECTED 2026-10-01 ~02:45Z (seq 241):** wrong. The check covered five branches but not
    `claude/c228-world-series` (#210), which records the same merge as ITS seq 239 (00:20:28Z, session c188, the
    merging session). `gh pr diff` on every open PR, run once gh worked, found it. Both lines stay; whichever of #210
    and this PR merges second drops its duplicate when it re-chains.
- seq 240 `finding`: this defect, the fix, the guard.

## The PR: blocked on the gh token
`gh auth status`: "The token in default is invalid". `~/.gitconfig` sends github.com credentials through `gh auth
git-credential`, so `git push` fails as well (pr-workflow-mechanics memory, 2026-10-01). Only the owner can run
`gh auth login`. Everything else is committed on the branch; push, open the PR (`pr_open` line), and set STATE's PR
number once the token works.

## 02:43:12-02:44:38Z · pushed; #213 opened
- The owner re-authenticated (`gh auth status` at 02:43:12Z: logged in; scopes `gist`, `read:org`, `repo`,
  `workflow`). The first browser attempt hit a GitHub 404 page; the `-p https -w -s workflow` login worked.
- `gh pr diff` on every open PR before pushing found #210's own `pr_merge #207` (seq 241 corrects seq 239's claim).
- Pushed `ae0b8c3c`; **#213** opened against dev at 02:44:38Z (seq 242), bound in the app's PR bar with 18 checks
  pending. Not merged: the owner's word.

