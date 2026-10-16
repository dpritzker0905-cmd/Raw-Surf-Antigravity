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

## Hosted CI, first head (closes commitment seq 1286)

CI run 38928415298 on code head `dcc46b733`: 12 of 12 jobs green. Guards `collected 2761 tests across 197 files -> 2694 passed, 67 skipped, 0 failed`;
chain `collected 2473 tests across 164 files -> 2473 passed`. Both equal the projection. (Local chain lane also 2473; the local guards lane was stopped at ~28%
with no failure and is not claimed.)

## Owner's word, and why only half of it was acted on

Owner, 2026-10-16 12:32 EDT: "Flip and merge if its the best path forward". Merge: yes, once the review's test gaps are closed. Flip: HELD, for these reasons
(all measured or read from code; none is a render):

1. **Production shares the flag and does not get the benefit.** Production's frontend is frozen at `fc140024`, which does NOT contain #279 (`bfcfb8762`,
   `git merge-base --is-ancestor` says so): it reads `bounds` as cell EDGES (texel i at south + (i+0.5) span/n), not as point-registered extents. By arithmetic on
   the real shapes the flag leaves that client where it was (181 x 83 stride 4: worst 3.90 -> 3.81 deg, mean 2.00 -> 2.00; 181 x 80: worst 3.95 -> 3.80, mean
   3.00 -> 2.00; a stride-3 frame mean 1.25 -> 1.50). One Render env var serves dev AND production, so production would take any side effect for no gain.
2. **Independent review (a fresh reviewer, given the diff and the intent, not my conclusion).** Flag OFF is byte-identical to dev; flag ON is right at all four
   sites for every input probed. It then found client-side consequences of a SHORTER north edge that nobody has measured (all REASONED from the client code, not run):
   (a) `bboxContains(entry.bounds, viewport)` (`marineGridSeries.js:586,632`): a viewport whose north edge falls in (80, 84] goes from series hit to miss, and
   `useMarineScrubSettle.js:468-486` then fetches `/grid` per hour instead of committing the warmed frame; (b) point sampling above the new north edge returns null
   (`forecastHelpers.js:385`, `useSpotRatings.js:70`); (c) `WebGLMarineTextureEncoder.js:567-573` compares mask bounds field by field, so every thinned <-> exact swap
   (the two frames now differ) rebuilds the world mask, which used to be reused; (d) the overlay mask mode, mask retain, stale stamp and arbiter coverage also read
   bounds. Longitude-based "world" tests (>= 340/350/359) are unaffected for the 181-column world at strides 2-4 and would flip only for odd grid/stride pairs.
3. **The fix is aimed at the dev client**, where it removes a 4-6 deg draw offset and plausibly the "apparent position alternates with resolution" report (a thinned
   frame is drawn 2-4 deg north of an exact one). That link is still NOT established.

Recommendation recorded: merge flag-off; measure (a) and (c) on the dev client in the offline mock (step 4's harness doubles as this A/B); flip when production's
client reads bounds like dev's (#279 shipped) or when the flag is request-scoped, whichever comes first, on the owner's word.

## Review gaps closed in this PR (tests only, no production change)

Mutation runs by the reviewer showed 20 tests passed against: a fix that moves only the NORTH edge, a mid-tier fix that drops the longitude slice, and the switch forced on
in the two dict sites alone. Added 10 cases (same file): east edge when the width does not divide the stride at all four sites; the same fixture with the flag OFF at all
four sites; the strided read vs the legacy path at stride 7 (181 columns -> 26, east 170). Now killed: north-only (5 tests fail), longitudes dropped (1), dict sites forced
on (2), always on (6), helper returns its fallback (16), identity no-op (3). The control (no mutant) passes. One mutant survives by construction: deleting the explicit
`west > east` guard (the containment check refuses those cells on its own); the test comment says so. Floors move in the same commit: guards MIN_PASSED 2688 -> 2698,
`_FLOOR_SET_FROM` guards 2704 (reading 2704 on 197 files). Not fixed, harmless: top-level `resp["bounds"]` is not rebound (the client never reads it), and
`_apply_build_stride` leaves `product.coverage`/`served_bbox` at the old values on hour 0 (series frames do not serialise them).

SCOREBOARD: new instrument S21 plus BEFORE and AFTER (offline) rows. The live read-back row follows a flip.

## Later the same day (13:00 to 14:00 EDT): #343 merged, #342 read back, the manifest review, the offline harness

Owner, 13:02 EDT: "Move forward on the best path toward state of the art". Read as a general go-ahead inside the standing limits (no flag flipped, no deploy, no live load), not as a word to merge anything new.

**#343 merged** 17:07:11Z as `7b06900ad`, flag off, `[skip render] [skip netlify]` (ledger 1290). Hosted CI on the hardened head: guards collected 2771 across 197 files, 2704 passed; chain 2473 across 164. The held flip (commitment 1289) stands.

**#342 read back (ledger 1291).** The first post-merge precompute pass (run 38937167877, 17:53:24Z) wrote `calibration/skill/scored-2026-10-16.json` (258,235 B) and `pending.json`, then `ledgered=1383 scored=892 pending=38323`, no `EntityTooLarge`. The monitor's 17:20Z run predates that pass and was still RED; commitment 1280 stays open until a later monitor run is read. EURO wind's `/api/health/data` also cleared by itself between 15:25Z (503, 27.4 h) and 17:02Z (200, 17.1 h, status `warn` on two "model cycle unverified: conflicting" marine lanes, an intentional provenance label from `cycle_provenance.py`).

**The manifest lane failed its independent review (ledger 1293).** #344 carries `MANIFEST_MERGE_AT_COMMIT` (dark): basis + 3-way merge at commit, built by a subagent from my design, then changed by me (basis registry 8 -> 256, one basis per head generation, merged stamp never backwards), then attacked by a fresh reviewer who was given the diff and the intent but not my conclusion. Verdict: do not approve, five confirmed findings: deterministic run-keyed names (a CAS loser's PUT overwrites the winner's object; the test (f) passed only because my harness named the foreign object uniquely), `exclude_keys` ignored for the process's own queued snapshots, every fallback after a moved head publishes the unmerged snapshot (three tests asserted that erasure as correct), bases never released plus self-backlog re-merges, both-changed entries letting the older run win. Lesson: **my design brief itself carried findings 1-3**; a builder's green tests proved only that the code did what the brief said. A rework against the findings is dispatched (unique create-only keys following `manifest_immutable`, tombstones, own-publish skip, no unmerged CAS, released bases, prefer-newer, production-faithful harness naming); #344 stays draft and is relabelled WIP until a second independent review passes.

**The offline harness (#345, ledger 1294).** `frontend/scripts/offline-backend/`: the production FastAPI app over a synthetic `ProductStore` (2-deg `global_mid` 181 x 83 and 10-deg `global_coarse`, a vortex at a known position), plus a Playwright driver on the built client. Disclosed in ledger 1295: the first ~10 runs did not block WebSockets and made a few rejected handshakes to the production API host (403) and the production Supabase realtime socket (anon key; nothing read or written); fixed with `page.routeWebSocket`.

**RETRACTED (ledger 1297, correcting 1296): the "stuck forward scrub" lead.** I first reported, for about an hour, that after a +24 h scrub the engine stayed on the previous hour (`retained_previous_hour`, one WebGL upload, 35+ s, identical for both flag states) as a possible lead for the owner's rendered/requested gaps. It was my fixture. The synthetic products said `provider: "noaa"`; production's GFS waves are `provider: "open-meteo"` (`upstream_provider: "noaa"`, `source_dataset: "ncep_gfswave025"`, read from the real manifest). `WebGLMarineLayer` silently drops a frame whose grid provider is not whitelisted and keeps the previous hour; the layer's own record said `provider_not_whitelisted`. The tell I should have chased first: it was identical for both flag states and the app's gating code names providers. With the fixture fixed a +24 h scrub renders in 2.4 to 4.3 s. The owner's gaps are NOT explained by the harness.

**What the corrected harness measured (ledger 1298), flag off = port 4100, on = 4101:**
- POSITION, real GPU renderer, same hour and camera, zoom 2.6 over 45N, luminance-row cross-correlation: flag off draws the thinned world frame **29 px = 2.04 deg (227 km) north** of the exact frame (corr 0.973); flag on 0 px (0.996); null control (exact vs exact across the two servers) 0 px. That is the position-alternates-with-resolution mechanism on the dev client, and the flag removes it.
- COST, scrub replay +24, +72, Home, +144, +288, Home: identical uploads (22), dims sequence and time-to-parity (2.4 to 4.3 s), but world-mask-sized texture uploads **3 off vs 23 on**: 4 to 8 extra 4096 x 2048 world-mask rebuilds per forward jump with the flag on, none with it off. Cause: the thinned (north 80) and exact (north 84) frames differ in bounds and `WebGLMarineTextureEncoder`'s mask cache compares them strictly. The engine samples the mask by its own cached bounds (`u_maskBounds`), so reusing a mask whose bounds cover the frame is geometrically safe; that client change is NOT built.
- NOT measured: the rebuild cost on a phone GPU; the effect on production's frozen build (its mask cache is probably the same strict compare, so flipping the shared flag would impose the rebuilds on production users for no position benefit); the reviewer's other consumers (overlay mask mode, retain, arbiter).

Measured while deciding the held flip: the frozen production build `fc140024` predates #279 (`bfcfb8762`), so it reads `bounds` as cell edges; for stride-4 frames the flag leaves it at worst 3.90 -> 3.81 deg. Viewports that lose their warmed-series hit under a shorter north edge are Arctic only (zoom >= 4 centred above ~76N, or zoom 2 centred 55-70N). Not measured: the world-mask rebuild on every thinned/exact swap.

## Owed
- Commitment 1280: read the next Forecast Accuracy Monitor run after 17:53Z; close when it is green.
- Commitment 1289: the held flip. Position is fixed by the flag and the cost is now measured (3 vs 23 mask-sized uploads). Needed before a flip: a client mask-cache reuse change (kill switch, harness acceptance: no extra uploads with the flag on), shipped to PRODUCTION's build too (the owner's Netlify step), and the owner's word.
- #344: the rework, then a second independent review, then the owner's word to merge, then a SEPARATE word to put `MANIFEST_MERGE_AT_COMMIT=1` in the L2 writers' workflow env.
- #345: the owner's word to merge (tooling only).
