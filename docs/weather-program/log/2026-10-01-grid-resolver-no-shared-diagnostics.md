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

## 03:07:44-03:11:04Z · #213 merged on the owner's word; the handoff
- Owner (chat): "merge #213 when it's green then prepare a hand off report". At 03:07:44Z, head `33935bbf` had
  15 checks passing and 3 skipped (Netlify rule checks), mergeStateStatus CLEAN, and `origin/dev` was still `ac080442`.
- The hosted guards lane (run 36807315007, job 110194435189, log read with gh): `collected 2231 tests across 177 files
  -> 2164 passed, 67 skipped, 0 failed, 0 errors`. That equals the projection (2146 + 18), and it confirms the
  2146 baseline taken from the sibling notes.
- `gh pr merge 213 --merge --match-head-commit 33935bbf...`: merged at **03:07:59Z as `454d96cb`** (seq 243, recorded
  on the handoff branch). Backend code changed, so Render redeploys. At 03:09:40Z and 03:10:33Z `/api/health` still
  served `ac080442`; the read-back follows below.
- All four open PRs of the program (#208, #210, #211, #212) went CONFLICTING (they appended to the ledger after seq 238).
  Messaged the #212 session at 03:09Z: on its `dev` merge it must delete the guard's `_KNOWN_UNFIXED` mid-tier entry.
- `HANDOFF-2026-10-01.md` on branch `claude/handoff-2026-10-01-shared-diagnostics`: the defect class, what landed, each
  open PR's job on its `dev` merge, the commitments, the next fixes, owner-only items, tonight's tooling facts, and the
  report audit. STATE points at it.
- A slip, caught before commit: STATE's header first said "03:12Z" against a 03:11:04Z clock read (an L-P10 estimate);
  corrected to 03:11Z.
- **Deploy read-back (seq 244):** `/api/health` at 03:11:40Z: healthy, version ends `454d96cb`, uptime 1 min 10 s.
  `/grid` EURO waves at the world bbox, at 03Z and 04Z (two requests, both done by 03:12:02Z): both served the mid
  tier's clip of `euro_marine_waves_global_mid_20261001T030000Z` (15,023 cells). Each carried its OWN stamps: 04Z read
  `valid_time` 04Z, `served_valid_time` 03Z, offset -1.0. Both had 19 diagnostics keys, as before the fix. The served
  values are unchanged, as designed. The cache's own dict is not visible from outside: the tests carry that claim.
- **#214** (the handoff) opened at 03:13:46Z (seq 245). The #212 session replied: it had merged `dev` (head
  `bb3f9f27`), emptied `_KNOWN_UNFIXED`, and re-chained its lines as seq 243-245. Its mutation check: with dev's
  pre-fix `mid_res_tier.py`, the guard goes RED on exactly `mid_res_tier.py:260`. #212 and #214 now fork at seq 243;
  the second to merge re-chains. HANDOFF §4 and STATE updated to say so.

## 03:29-03:53Z · #214 merged; the open PRs re-chained as a stack and merged in turn; the next fix (#215)
- Owner (chat): "merge #214 and move to the next fix, and merge #208 or anything else needing merging, then push too",
  then mid-turn "#210 has conflicts but needs to be merged as well". In scope: #208, #210, #211 and #212, the program's
  open PRs. Out of scope: the six `codex/*` PRs (#15-#44, from 2026-09-09 to 09-18), not this program's sessions'.
- **#214 merged at 03:29:54Z as `e2fd1d08`** (14 pass, 3 skipped).
- **The plan came from the audit's rule, not habit.** `memory_audit.check_completeness`: on a `dev` push every earlier
  merge needs its `pr_merge` line, except the newest, which may wait (WARN). So each PR only has to record the merge
  BEFORE the previous one. That allows STACKING: each branch merges the previous one's re-chained head, so all CI
  runs at once, and each merges into `dev` cleanly once the one below it has. The cost is one extra docs push per
  PR, to record the merge two places back.
- The #212 and #208 sessions held their pushes and handed their branches over; the #212 session relayed the owner's
  "yes let it merge #212". The helper `rechain_branch.py` (scratchpad) takes the branch's own lines (beyond its merge
  base), drops `pr_merge` duplicates of lines dev has, and re-appends each with `--acted-at`, a RE-SEQUENCED note
  and `fulfills`/`corrects` remapped. It verified that every re-appended field is identical except time.
- **#212** `bc9ce329`: its 3 lines -> seq 246-248; seq 249 `pr_merge #214`. Hosted chain lane 139 files / 1689 =
  projection. **Merged at 03:48:58Z as `a8c90a42`**. Render served it by 03:51:36Z (uptime 28 s at 03:52:04Z).
- **#208** `b92286c7`, stacked on #212: its 10 lines -> 250-259, its `pr_merge #213` dropped (dev seq 243). STATE took
  dev's, plus its two logs and the anchor. Its own audit: 0 FAIL and the NOTE of 7 corrected headers, as its session
  predicted. **Merged at 03:50:34Z as `c60d5bcd`**.
- **#210**, stacked on #208 (`b2677cf4`, then `cb6e6f62`):
  - `mid_res_tier.py` and `grid_resolver.py` auto-merged. Checked by hand: #210's `_stride_clipped_grid` runs before
    #212's copy-then-stamp, and #213's two copies sit beside #210's `series_stride` and truthTag changes.
  - The chain floor was COMBINED: #212's +5 and #210's +31 on #213's hosted reading of 138 files / 1684 (read from run
    36807315007, not assumed) give 1720, floor 1714, 140 files.
  - Ledger: its finding and `pr_open` -> 260-261; its duplicate `pr_merge #207` dropped; seq 262 `pr_merge #212`. STATE's
    root-cause paragraph now cites seq 260. Its log and SCOREBOARD rows still say seq 240 (append-only): read 240 as 260
    and 241 as 261.
  - Locally: 363 passed across its 23 related test files.
- **#211**, stacked on #210 (`833fdb05`, one merge commit built with `git commit-tree`; gitleaks run by hand since that
  skips the hook):
  - The guards floor was combined: 2164 + 5 = 2169, floor 2163, 178 files.
  - **Two numbering collisions with #210**, resolved in #211 as the second to land: SCOREBOARD instrument S11 -> **S12**,
    LESSONS L-F8 -> **L-F9** (both noted in place).
  - Ledger: 263-266 its lines (commitment 242 -> **266**), 267 `pr_merge #208`, 268 a correction for the renumbering.
  - Locally: both guards plus #211's tests, 54 passed.
- **The next fix: #215** (03:52:55Z), the vector half of the shared-L1-object guard (HANDOFF §6.3):
  - Built and measured before #211 landed. On the tree WITHOUT #211's fix it flags exactly the six writes #211 fixed
    (`coarse_gulf_fill.py:134-143`) and nothing else; it goes green with #211's file.
  - Mutation: deleting `grid_resolver_surf`'s per-vector copy flags both mutator calls.
  - 12 controls; it reuses #213's dominance helpers.
  - Floor 179 / 2177, projected from #211's 2169: to be confirmed on #215's hosted run.
- Slips, each caught before anything was pushed:
  - An `authorized_by` with "03:3xZ" in it. The tool checks only `verified`, so I caught it on re-read and re-wrote the
    unpushed line with a bound.
  - A second worktree for #215, which the session's hook refused to write into. It was removed, and the work was done
    in this worktree.


## 03:53-04:18Z · #210 and #211 merged; #215's docs push
- Owner (chat): "yes merge #215 too when it's green, and 210, and 212, make sure everything needing merging is merged".
  #212 had merged at 03:48:58Z.
- At 04:12:17Z #210 (`cb6e6f62`), #211 (`833fdb05`) and #215 (`355ccac0`) were each 15 pass / 3 skipped, CLEAN. The
  hosted readings EQUAL every projection, read from the job logs:
  - #210: chain **140 / 1720**, guards 177 / 2164.
  - #211: guards **178 / 2169**, chain 140 / 1720.
  - #215: guards **179 / 2183**.
- **#210 merged at 04:12:51Z as `33364453`; #211 at 04:13:07Z as `49e1d62d`** (both pinned to their heads). Nothing of
  this program's is left open but #215. The six `codex/*` PRs stay out of scope.
- #215's docs push: seq 270 `pr_merge #210`, 271 `pr_merge #211`, 272 `pr_open #215`, 269 the memory mirror of L-P21.
  It also carries STATE (`dev` = `49e1d62d`, floors, open PRs) and HANDOFF-2026-10-01 §10 (§4's queue merged; S12/L-F9;
  commitment 266).
- Deploys read back (seq 273): `33364453` (#210) live from 04:15:20Z, `49e1d62d` (#211) from 04:18:00Z (health only;
  commitments 228 and 266 measure the served effects).
- L-P21 was first written as "merged within one CI window", before #210/#211 had merged. It was re-worded to what
  happened (two CI windows for four PRs) before the push.
