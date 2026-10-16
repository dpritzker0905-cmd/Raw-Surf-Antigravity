# 2026-10-16 — thinned world frames: bounds of the kept cells (branch `claude/thinned-frame-node-bounds`, draft PR #343)

Session: Claude Code (Sonnet 5.5), continuing the takeover of the 2026-10-14/15 repair program. One writer for this file.
Owner's words (2026-10-16 ~15:30Z), after #342 was shown with its hosted CI: "Ok merge it and go with the plan". The plan he approved:
(1) merge #342, (2) reproduce the manifest lost-update offline, (3) thinned-frame bounds: failing test first, then a DARK flag, flipped only
on his word, (4) an instrumented offline scrub replay, (5) a docs-only record. Nothing in THIS change is merged, deployed or flagged on.

## Step 1: #342 merged

Squash `66a320e54dbd6e0520ee3f94be780630c757db90` at 15:37:16Z, on the owner's word above. Not yet read back: the first healthy ledger pass after the
merge (commitment seq 1280, due 2026-10-19). Its E2E run on dev is expected red at the "serve THIS commit" gates (`[skip render] [skip netlify]`),
as after #336-#338; that is not an app regression and was not redeployed.

## Step 2: the manifest lost-update (reproduced offline; NOT proven to be what happened at 13:54Z)

EURO wind `/api/health/data` 503 is entirely the two stale interpolated (estimated) frames: the prune supersedes an estimated frame only by a NEWER
estimated generation in the manifest, and the 14 fresh frames are absent from the served manifest although their objects are in Storage.
`manifest_pointer.publish_run_keyed` reads the pointer at PUBLISH time and CASes from that generation, so a manifest merged from an EARLIER snapshot
passes the CAS and overwrites a writer that published in between. Reproduced with an in-memory chain (local branch `claude/manifest-cas-repro`,
commit `d201fd61a`, NOT pushed): null control (non-overlapping writers keep both) passes, harness control (a head that moves during the publish is
detected) passes, the defect test fails with "the published head lost 14 of core's 14 registered frames". What is NOT shown: that this interleaving
occurred in production at 13:54Z (the core ingest `38906634490` log was not retrievable when checked). No fix is built; it touches the shared
production manifest writer and waits for the owner. Proposal: a dark flag carrying the merge-time generation into the CAS, re-merging on mismatch.

## Step 3: thinned-frame bounds (this change)

Confirmed, measured offline: the client draws sample `i` of `n` at `south + i*(north-south)/(n-1)` (`gridPointRegistration.js`, L-V7). Four sites
thin a frame by keeping cells `0, s, 2s, ...` and leave `bounds` as the ORIGINAL grid's. A 181 x 83 frame (lat -80..84) thinned by 4 keeps rows
-80..80 but says `north = 84`, so every feature is drawn up to 4 deg too far north (+2.4 deg at 16N; the 181 x 80 product in the owner's 2026-10-16
log, +3.8 deg, ~420 km). Worst offset through the real mid-res tier on BOTH its strided read and its legacy path: exactly 4.0 deg, flag off.
Open since 2026-10-10 (PRs #23 and #27 were closed unmerged).

The change: `SERIES_THIN_NODE_BOUNDS` (default `0`, Render env, registered in `_RATING_FLAGS`). On, each site rebinds `bounds` to the extents of the kept
cells (`series_vector_budget.node_extent_bounds`), which refuses (returns its fallback) for no cells, a non-finite cell, an antimeridian-crossing
window or a cell outside the original bounds. Sites: `grid_series_helper._apply_build_stride`, `series_vector_budget._decimate_frame` and
`stride_raw_grid_dicts`, `mid_res_tier._stride_clipped_grid` (also `coverage` and `served_bbox`) and `_identity_clip_bounds`. It moves where a field
is DRAWN, never which cells or values it holds. Flag off is byte-identical.

Whether this is what the owner saw as the hurricane moving between zooms is NOT established: his logs carry dimensions, not bounds or coordinates.

Tests first (`tests/test_series_thin_node_bounds.py`, 20): 17 failed before any production change, 2 passed as flag-off characterizations. Seven mutants
(each site off, strided-lattice extents off, coverage/bbox following bounds off, flag defaulting on) are each killed. 167 neighbouring tests stay green
locally (thinning, strided read, load stride, max thinning, vector budget, flag parity). Floors move in the same commit: guards `197, 2688` and
`_FLOOR_SET_FROM` guards 2694 (chain 2473 and estate 1674 unchanged). Hosted CI "collected N" must read 197 files / 2694 for guards: that is the check.

Local full lane runs (guards, chain) were started on the branch but had not finished when this was written (guards at ~18%); the hosted run is the
authority. This log does not claim them.

## Owed

- Flip `SERIES_THIN_NODE_BOUNDS=1` (Render env) only on the owner's explicit word, with a `SCOREBOARD.md` row; then read back a thinned frame's
  `bounds` against its first/last cell on the live `/grid_series` (ONE short read, `/api/health` probed before and after).
- Manifest CAS-from-merge fix: the owner's approval first (shared production writer).
- Step 4, the instrumented offline scrub replay, in the mock backend only: not started.
