# 2026-10-01 session coarse-fill-shared-vectors: the serve-time marine fill wrote into the cached product

Worktree `C:\Users\David\App\raw-surf\.claude\worktrees\heuristic-hodgkin-ef9cd8`, branch
`claude/coarse-fill-no-shared-mutation` from `origin/dev` at `ac080442` (#207). Owner brief (chat, 2026-10-01): a
suspected defect found while working on commitment 228 (#210), not yet fixed: `coarse_gulf_fill.
fill_coarse_enclosed_sea_from_gfs_served` mutates vector objects in place and stamps `coarse_fill` only on the served
product, while since MARINE_MID_RES_MAX_SPAN=400 a WORLD request is a 360-degree clip of `global_mid` built over the
SAME vector objects the L1 cache holds. "Prove or refute it with a test ... If confirmed, fix the fill so it never
mutates shared vectors ... Keep the served values and the `coarse_fill` stamp identical ... Open a PR against dev; do
not merge it." Times are clock reads (`date -u`) or platform timestamps (L-P10).

## 1. Proof by test (RED on `ac080442`)

`backend/tests/test_coarse_fill_shared_vectors.py` drives the REAL `ProductStore` L1 cache (tmp files, class cache
isolated) through the REAL `/grid` route function (`routes.weather.get_grid`: `resolve_grid`, then the fill), so the
composition that leaks is what runs. Fixture: a EURO `waves` product with three masked Gulf cells and open-ocean cells
at both longitude ends (so the stored lattice spans >= 350 degrees like the real full-lattice `global_mid`), and a GFS
`global_coarse` donor. Committed RED first (`0e65e188`, 00:32:24Z). On the unfixed fill:
- world request served by the mid tier: the CACHED `global_mid` cell (26, -90) read `is_valid=True, speed=1.1` (the
  GFS donor value) after the request;
- a later Gulf request (`-98,18,-80,31`, mid-tier clip, span < 350 so never filled) served that cell as EURO
  `is_valid=True, speed=1.1` with `coarse_fill=None`;
- coarse tier (10-degree product served unclipped as the L1 shallow copy): the first request was stamped
  `cells_filled 3`, the second identical request `coarse_fill=None` (nothing masked left in L1);
- control: the world response's own values and stamp were correct (passes before and after the fix).

## 2. Live reproduction on production (read-only GETs to `/api/weather/grid`, EURO marine)

Six to eight requests in total, 00:37:27Z to 00:39:30Z, spaced by the response times (L-O4: no burst).
- **Stamp loss, coarse tier.** World `swell_1` and `wind_waves` at 2026-10-01T00Z, 26 s apart (00:37:27Z, 00:37:53Z):
  identical cells (629/629; 517 and 543 valid), first response `coarse_fill.cells_filled` **95** and **123**, second
  response **`coarse_fill: None`**. World `waves` (the mid tier) kept its stamp on the repeat (`cells_filled 2465` of
  4689 masked of 15023) because the clip LRU hands back a deep copy taken before the fill.
- **The fill on the 2-degree world clip reaches inland.** In the world `waves` response, (32, -96) near Dallas, (34,
  -90) north Mississippi, (32, -84) Georgia are valid at 1.07 / 0.81 / 0.68 m; each carries a 5-field (speed,
  direction, period, u, v) tuple shared by 20 / 11 / 7 cells, the signature of one GFS 10-degree donor cell copied
  onto every 2-degree cell within reach. 2605 world cells sit in shared tuples against the stamp's 2465 filled.
- **The leak into a later reader, A/B at a far hour (2026-10-05T06Z, nobody else's world view likely).** Regional
  clip A `-100,24,-80,40` at 00:39:17Z (before any world request): (34,-90), (32,-84), (32,-96), (30,-100), (34,-92)
  all **masked**, 158 of 399 valid. World request at 00:39:29Z: stamped, 2465 filled. Regional clip B
  `-101,23,-79,41` at 00:39:30Z (a different snap, so the clip LRU cannot answer it; same L1 product): those cells
  **valid at 0.899 / 0.86 / 1.002 / 1.002 / 0.899 m**, `coarse_fill: None`. **119 of the 399 common cells flipped
  masked -> valid; 0 natively valid cells changed value.** Every EURO marine reader of the L1 entry inside its 5-minute
  TTL after anyone's world view got these cells as EURO, unlabelled.

## 3. The fix (`coarse_gulf_fill.py`)

The masked set is a list of INDICES; the fill builds `vectors = list(grid.vectors)`, replaces each filled index with
`copy.copy(v)` (`BaseModel.__copy__` is `model_copy()`) carrying the same assignments as before, and, only when
something was filled, returns `copy.copy(product)` with `grid = copy.copy(grid)` and `grid.vectors = vectors`, the
stamp written on that copy. Nothing it is handed (product, grid, list, vector) is written; native cells stay the same
objects. Guard misses and "nothing filled" still return the input unchanged. The span-gate comment that said
"Regional/mid grids are fine" is corrected in place (the 2-degree world clip is filled; viewport clips are not).

Tests: the 5 new tests pass; `test_coarse_fill_layers.py` asserted the OLD contract (the input hole object flips to
valid), so its positive test now reads the served output AND asserts the input is untouched, and its six negative
tests (wind layer, missing donor, GFS recipient, regional span, kill switch, no donor nearby) moved from the input
hole to the served output: after the fix the input stays masked whatever happens, so the old assertions would have
passed vacuously. 49 tests across the fill + mid-tier files pass; `test_ci_floor_staleness.py` 22 pass.

Mutations (cwd=backend, against the three fill test files, 28 tests): M1 the old in-place write -> 9 failed (all 5
new tests); M2 copy written back into the input list -> 2; M3 list rebound on the input grid -> 1; M4 GFS as a
recipient -> 2; M5 no span gate -> 3; M6 kill switch ignored -> 2. **M7 (distance cap removed) SURVIVES**, before
and after this change: the 2-degree bucket window (+-2 buckets) bounds the search before the 8-degree cap binds, so
no fixture can tell the cap is there. Pre-existing; not in scope.

## 4. Served numbers: what changes

- **The world response: no change** (same values, same stamp; test-proven both ways).
- **Coarse-tier repeat requests: same values, the stamp comes back** (metadata, not a number).
- **Readers of the EURO/ICON L1 entry after a world request: change**, from GFS-filled cells to the model's own mask
  (live: 119 of 399 cells in a 40-degree US-Southeast clip). That is the contamination removed, and it is a served
  number, so SCOREBOARD gets an S11 "before" row now; the "after" row is the post-deploy read-back (commitment in the
  ledger). ⚠️ The brief expected no served-number change; the live A/B says otherwise for the contaminated path.
  `/point` and the live `/spot-ratings` fallback (`routes/weather.py` `_rate` -> `rate_one_spot`) run on Render
  over the same class-level L1 (`ProductStore._product_cache` is shared by every store instance in the process),
  so they could have read a filled cell the same way: plausible, unmeasured. The
  precomputed ratings run in Actions processes where `/grid` does not run.

## 5. Leads, not fixed here

1. **The 8-degree reach on the 2-degree world clip paints GFS wave heights inland** (Dallas, Memphis, central
   Mexico). The response is stamped (provenance holds), but the reach was sized for 10-degree cells; the docstring
   that called a no-donor hole "genuine land" is only true at 10 degrees. Narrowing it changes a served number: the
   owner's call.
2. **`mid_res_tier` writes `grid.diagnostics["mid_res_tier"] = True` into the dict shared with L1** (the clip copies
   the grid container one level; the live stored grid carries a ~19-key `diagnostics`). Same class; likely benign
   since only the mid tier serves `global_mid`. #210's `_stride_clipped_grid` already copies the dict for its own key.
3. **Interaction with #210**: it stops caching world clips (> 5,000 vectors), so every world request would re-clip
   L1, and the in-place fill would then have dropped the `waves` stamp on repeats as well;
   `test_the_world_serve_itself_is_unchanged_by_the_fix` clears the clip LRU before a third request to pin that.
   Both PRs move `_FLOOR_SET_FROM` (one line) and append to `ACTIONS.jsonl`: the second to merge re-derives.

## 6. Process

- **L-P16 repeated.** The mutation harness restored the module with `write_text` (CRLF on Windows); `git status`
  caught it and the module was restored from the committed WIP; no verdict is affected. Checking the hazard showed
  L-P16 overstates it here: `.gitattributes` is `* text=auto eol=lf`, so a CRLF restore cannot be committed as churn;
  the cost is a working tree that reads modified. Dated note added under L-P16 (ledger `correction`).
- CI floor, guards lane: hosted dev `ac080442` (run 36795274173) read 176 files / 2146 passed; the new file adds 5:
  2151 - 6 = **2145**, files **177** exact; `_FLOOR_SET_FROM["guards"]` -> 2151. Confirm on the hosted run.

## 7. Ledger and PR

- seq 239 `finding` (the confirmation, test and live; acted 00:39:30Z), seq 240 `correction` (L-P16's churn claim).
- Commits: `0e65e188` (the RED test), `ea3aa78d` (the fix, the reworked layer tests, the guards floor).
- PR #211 opened 00:49:38Z (seq 241 `pr_open`); commitment seq 242 (due 2026-10-04 18Z): the S11 "after" row once
  #211 is deployed. #207's `pr_merge` line is carried by #210 (its seq 239), so it is not duplicated here; the audit's
  WARN for it clears when #210 merges. #208, #210 and #211 all append from seq 239: the second to merge re-chains.
