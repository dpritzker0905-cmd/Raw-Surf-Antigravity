# 2026-10-01 session mid-tier-no-shared-diagnostics: the mid tier's stamp no longer lands in the cached global_mid

Worktree `C:\Users\David\App\raw-surf\.claude\worktrees\ecstatic-knuth-f6d851`, branch
`claude/mid-tier-no-shared-diagnostics` from `origin/dev` at `ac080442` (#207). Owner brief (chat): the same defect
class as PR #211, found 2026-10-01 and not yet fixed. `mid_res_tier.try_serve_mid_res_tier` writes
`grid.diagnostics["mid_res_tier"] = True` into the dict of the L1 `global_mid` entry. The brief asks for a test through
the real ProductStore L1 cache, a copy-before-write fix (reusing #210's pattern), an audit of other serve-time
`grid.diagnostics` writes on shared grids, and a PR against dev that is not merged. Times are clock reads (`date -u`) or
commit timestamps (L-P10).

**No served number changes** (no surf height, rating, glyph score, hub or sim value; the served diagnostics are
byte-identical, pinned by a test). There is no SCOREBOARD row.

## to 00:55:57Z · the defect, measured (RED commit `20faa0c8`)
- Chain: `store_helpers.load_product_helper` returns an L1 hit as `model_copy()` of the product and of its grid, so
  `grid.diagnostics` is the cached dict. `route_helpers.filter_grid_to_bbox` copies the same two containers one level,
  so the clip still holds that dict. Stored grids carry a non-None dict (`normalizer` writes 8 keys, plus 5 for the
  dominant-swell anim channel), so `if diagnostics is None: = {}` never fires and the stamp goes into the cache.
  13 stored keys plus the 6 serve-time keys below give 19, which matches the "~19-key" dict served live on 2026-10-01.
- `#210` (commitment 228) was OPEN at session start (`gh pr list`, before the 01:06:53Z clock read). Its `_stride_clipped_grid` already copies the
  dict before writing `load_stride`, so this fix reuses that pattern rather than inventing a second one.
- New `backend/tests/test_mid_tier_shared_diagnostics.py` (5 tests). The pattern is #211's
  `test_coarse_fill_shared_vectors.py`: a real `ProductStore` over tmp files, wired into `routes.weather.get_grid`, with
  `store.is_test_environment` patched so Step 3.6 runs. The stored `global_mid` has a non-None diagnostics dict, as in
  production. Results before the fix: **5 of 5 RED**.
  - At the tier alone (fed an L1-shaped shallow copy): the cached dict gained `mid_res_tier`.
  - Through `/grid`, for a 20 deg viewport and for the world request: the L1 dict gained **6 keys**. These are
    `mid_res_tier` plus the resolver's own step-4 stamps (`renderable`, `partial_coverage`, `valid_time`,
    `served_valid_time`, `frame_offset_hours`, grid_resolver.py:692-699), which wrote into the same shared dict because
    the mid-tier product carried it.
  - Cross-request: a response from 00Z was **rewritten by a later 01Z request** for the same stored frame
    (`valid_time` 00Z -> 01Z, `frame_offset_hours` 0.0 -> -1.0). Two responses built from one L1 entry held one dict
    object, so a response not yet serialized could carry another request's stamps.

## 00:55:57-01:12:29Z · the fix (commit `37ff0d60`)
- `mid_res_tier.py`: `diagnostics = dict(product.grid.diagnostics or {})`, stamp, rebind on the clip's own grid.
  The clip LRU path was already private (`copy.deepcopy`), and the resolver's later step-4 stamps now land in the
  clip's private dict as well.
- After the fix, the 5 new tests pass. The 31 test files that mention `mid_res_tier`/`global_mid`, plus
  `test_grid_surf_overlay_copies.py`, give **393 passed** (9 min local; this interpreter is not the declared
  environment, so hosted CI is the authority).
- Merge with #210: its change inserts `_strided = ...` above `if product.grid:`, and this one edits the lines inside
  that block. If #210 lands first, its `_stride_clipped_grid` copy plus this one is a second O(keys) dict copy, which
  is harmless.
- CI floor: `--lane chain` claims the new file (guards 0, estate 0). Hosted reading on dev (run 36795274173 @
  `ac080442`): 138 files / 1684. 1684 + 5 = 1689, 1689 - 6 = **1683**, files **139** exact, and
  `_FLOOR_SET_FROM["chain"]` -> 1689 in the same commit. Local `--lane chain` selects 139, and
  `test_ci_floor_staleness.py` passes (22).

## to 01:13:44Z · the audit of serve-time `grid.diagnostics` writes on shared grids
A scratch probe (not committed) used the same real-ProductStore wiring with `MARINE_MID_RES_TIER=0`. It served a
stored EURO `global_coarse` (unclipped global tile) and a regional-tile clip, then compared each L1 entry's dict.

| Site | Writes into | Shared with L1? | Status |
|---|---|---|---|
| `mid_res_tier.py:258-260` `["mid_res_tier"] = True` | the clip's grid | **yes** (measured, 6 keys with step 4) | **fixed here** |
| `grid_resolver.py:692-699` step 4: `renderable`, `partial_coverage`, `valid_time`, `served_valid_time`, `frame_offset_hours` | every served product | **yes on every durable-manifest serve that is not the mid tier**: measured, both the global_coarse tile and the regional clip gained the 5 keys, `shared=True` | **open, same class, broader**: request-dependent values (`valid_time` is the requested hour since `product.valid_time = target_dt` just above) go into the cache and into concurrent responses |
| `grid_resolver.py:514-519` EURO->GFS fallback: `provider`, `stale`, `renderable` | the product `fetch_viewport_grid_upstream` returned | **yes on the in-flight WAITER path** (`viewport_service.py:~278`: `store.load_product` plus an optional clip, with no dict rebind) | open, by reading (not probed): the GFS viewport product's cached dict could say `provider: gfs_estimated_fallback`; the top-level `provider` is unaffected |
| `grid_resolver_surf.py:50/78/187/205` `surf_transform`, `surf_skip_reason` | `_shallow_with_own_diagnostics` copy | no | already correct (2026-08-09, pinned by `test_grid_surf_overlay_copies.py`) |
| `viewport_helper.py:303`, `viewport_service.py:204/569` | `grid.diagnostics = {...}` rebinds on a `load_product` copy's own grid container | no | correct: rebinding the attribute on a copied container never reaches L1 |
| `viewport_helper.py:450`, `viewport_upstream.py:195`, `consensus_serve.py:113`, `consensus_product.py:122/191` | freshly built products, or `dict(...)` copies | no | correct |
| `routes/` | no `grid.diagnostics` writes (grep) | n/a | none |

Recommendation: fix step 4 next, in a separate PR, with one `dict(...)` rebind at the top of
`grid_resolver.py:692` (and at :515). That covers every resolver path at once, including future ones. A mechanized
guard would stop the class recurring (four instances now: the surf overlay in August, #210's `load_stride`, #211's
vectors, this one): for example, an AST check that every `X.grid.diagnostics[...] = ...` in `services/weather_pipeline`
follows a rebind of `X.grid.diagnostics` in the same function.

## Ledger
- seq 239 `finding` (the defect, the fix, the audit above). Open PRs #208, #210 and #211 also hold seq 239+ on their
  branches, so this chain forks with theirs. Whichever merges later takes dev's `ACTIONS.jsonl` byte-for-byte and
  re-appends its own lines after dev's head with `--acted-at` (pr-workflow mechanics, 2026-09-30). `pr_merge #207` is
  #210's seq 239 and is not repeated here.

## 01:14Z on · the machine reset, and what it blocked
- The owner's machine reset mid-session. The WIP commits survived, and so did the uncommitted fix, which was committed
  first. After the reset, `gh auth status` reports the stored token invalid. `~/.gitconfig` routes github.com
  credentials through `gh auth git-credential`, so `git push` fails too ("could not read Username"; exit 128 with
  prompts disabled). The PR waits on the owner's `gh auth login`. seq 240 `memory_write`: that fact added to agent-local
  `pr-workflow-mechanics.md`.
- The step-4 stamping defect from the audit was offered to the owner as a separate task (not in this PR).

## 02:43:59Z · PR #212 opened
- After the owner re-authenticated gh, the branch was pushed and PR #212 opened against dev (not merged). seq 241 is the
  `pr_open` line. Hosted CI is expected to read the chain lane at 139 files and to collect 1689 tests (floor 1683).
