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

## Afternoon, second half (14:00 to 15:00 EDT): #345 and #346 merged, the mask cost attacked, the manifest lane reviewed again

Owner, 14:06 EDT (dictated): "go ahead and merge the 345 and the 346. Once their CI is green, and do whatever else is state-of-the-art". Both merged on a green CI of the CORRECTED heads: #346 `9a5d0c0ff` 18:43:09Z, #345 `2232545a0` 18:44:04Z (ledger 1299, 1300). #345's first green run was on the head that still had the bad fixture; I did not merge that head, pushed the fix, and merged after the re-run.

**World-mask cost, first half fixed (#347, draft, ledger 1302).** `maskCoverReuse.js`: a cached WORLD mask whose bounds cover an incoming world frame is reused (world frames only, all four edges, density at least a rebuild's; kill `__RAW_DISABLE_MASK_COVER_REUSE__`). 17 tests red first, 29 neighbouring suites green, encoder 788/800 lines. With the server flag on, harness acceptance: timeline mask rebuilds 15 -> 1, mask-sized uploads 23 -> 13 (flag off: 3). Not closed: the coarse-base pass (`_captureCoarseBase`) shares a world mask only with an EXACT-bounds match and samples it by the base's own data bounds (`_drawCoarseBasePass`: `u_maskBounds = base.bounds`), so a thinned (north 80) and an exact (north 84) base each rasterize their own: about 2 per forward jump. Sharing there needs a separate mask-bounds field in `WebGLMarineEngine.js` (over the LOC cap, cannot grow). So the server flag stays held: this makes it cheaper, not free, and production's frozen build does not have it.

**A real, small finding about the app's own bookkeeping (ledger 1304; harness PR #348).** With live-like latency (series pages 8 s, `/grid` 3 s), after a +72 scrub and Home the ENGINE holds hour 0 within 0.8 s (grid `hourOffset` 0, truth tag `2026-10-16T18:00Z`, upload content hash identical to the original hour-0 upload), but `__MARINE_RENDER_HOUR_PARITY__` reads requested 0 / rendered 72 / parity false and `__MARINE_HEATMAP_STATUS__` says `retained_previous_hour` for 15+ s. The parity effect in `WebGLMarineLayer` is keyed on `[timeOffsetHours, revision, active, activeModel]`; it runs before the upload that updates `lastUploadedGridRef` and nothing re-runs it. The scrub-settle check printed no phantom gap (its rendered hour comes from React `marineData`), so this is NOT shown to be what the owner's `[SCRUB-SETTLE] rendered hour=293` lines are. Consumer: `MapForecastOverlay.js:164` requires `parity === true` for a selected point's grid fallback. Not measured: the selected-point card. At zero latency every forward jump renders in 2.4 to 4.3 s and Home recovers in 23 to 109 ms, so the stale record needs latency.

**The manifest lane, second review (ledger 1303).** The rework (`095378d60`, 86 tests, 20 mutants killed) fixed F2, F4, F5; F1 and F3 only partly. CONFIRMED: an UNSEEN head move (a transient pointer-read failure while core publishes; five create-only uploads failing with 429) still hands the old path a fresh pointer read and a deterministic name, losing 14 of 14 frames; the guards floor was not moved for the rework (86 collected, projected 2789 vs floor 2738); the own-publish skip trusts generation numbers only; a prune followed by an ordinary save while the prune upload is queued brings the pruned entry back (also under flag off). Cost: a failed attempt leaves a 15.6 MB unique object for at least 1 h (about 1.5 GB/h at 100 publishes/h against ~78 MB for the five-copy ring); worst case ~6.5 min per snapshot on the executor. Two rounds found fewer and smaller defects each time, but each round also finds a new "fall back to the old path" corner: the old publish path is the wrong place to patch. #344 stays WIP and dark.

## Owed (replaces the earlier list where it differs)
- Commitment 1280: the Forecast Accuracy Monitor runs about every 5 to 6 hours (17:20, 12:18, 05:46Z...); read the first run after 17:53Z (expected ~22:30 to 23:00Z). I did not dispatch it (a dispatch needs the owner's word).
- Commitment 1289: the held flip. Position is fixed by the flag; the world-mask cost is down 23 -> 13 with #347 but not zero; production's frozen build lacks the client change. Needs the coarse-base share, #347 on production, and the owner's word.
- #344: decide between a third rework (fix the unseen-move fallback by retrying a None pointer read and handing over only with the basis generation and a unique name; floors; a generation-to-key own-publish record; a tombstone set for queued prunes; faster retention) and a different shape (re-reconcile on the executor thread right before the PUT, or one writer).
- #347, #348: the owner's word to merge.

## Update, later the same day (ledger 1305-1313)

**Merged on the owner's word:** #347 (client world-mask cover-reuse, ledger 1305), #348 (harness latency + Home scenario, 1306), #349 (docs, 1307). **Closed:** #344 as superseded by #350 (1309); its branch is kept, its local-only rework commit was never pushed.

**Manifest, third review of #350's first cut (1310).** Flag off clean and the publish protocol held (no unmerged publish, unique create-only keys, coalescing, exclusions carried). Confirmed integration defects: the caller's in-memory manifest no longer absorbs the head (prunes then delete another writer's fresher object stored under the same key, because `product_id` is the filename); exclusions outlive their publish; an exhausted publish is never retried at exit; CAS on generation alone allows ABA after a rolled-back pointer; a missing head object wedges the lane; `store.py` `get_manifest`'s cleaned resave is a seventh unconverted write path; the 1211-line test file breaks the LOC ratchet; and `prune_immutable_copies` keeps every copy younger than an hour, which at one publish every few seconds is gigabytes against about 80 MB for the old ring. Round 4 (same builder, resumed) carries the fixes; a fourth independent review follows before the PR leaves WIP. Merging and setting the flag in the L2 writers' workflow env are separate owner words.

**ICON far hours (ledger 1312; PR #351).** The harness store now carries ICON (native to hour 168, `estimated` beyond, production's provider fields). `scn_icon_far.js` scrubbed ICON +96, +192, +288, Home, +288 on two bundles over the same backend. With `REACT_APP_ICON_STORED_TAIL=true` (netlify.toml sets it for the dev branch deploy only) +192 is drawn (engine `hourOffset` 192, provider `estimated`). Without it, the client builds a `gfs_trend` grid for hours up to 240, the layer's whitelist does not include that provider, `__SWELL2_LAST_DROP__` reads `provider_not_whitelisted gfs_trend/waves` and the engine stays at hour 120. Hours above 240 draw in both (`gfs_euro_blend` is whitelisted). Not a live defect: a latent release risk for whoever promotes the dev code, and the frozen production bundle was not measured.

**The stale parity record is pervasive (ledger 1313).** 4 of 7 steps on each build read parity false for the full 24 s window; on the stored-tail build the engine held the requested hour in all four (stale records), on the no-flag build in three of four (the fourth is the genuine +192 miss above). A fix is in progress on `claude/render-parity-after-upload`: extract the effect body into a pure module, republish from the upload path, kill switch `__RAW_DISABLE_PARITY_REPUBLISH__`; it changes no served number, ships ON, and merges only on the owner's word.

**Owed now (replaces the earlier Owed list where it differs).**
- Commitment 1280: read the first Forecast Accuracy Monitor run after 17:53Z. Not dispatched; a dispatch needs the owner's word.
- Commitment 1289: the held flip of `SERIES_THIN_NODE_BOUNDS`. Needs the coarse-base mask share, #347 reaching production, and the owner's word.
- #350: round 4 result, my own re-run of its gates, floors redone for the final test-file list, review 4, then the owner's word to merge and, separately, to set the flag in the L2 writers' env.
- The parity fix: build, harness acceptance (parity true shortly after the upload in `scn_home_latency.js` and `scn_icon_far.js`), independent review, then the owner's word to merge.
- #347's frontend change has not been validated by a completed dev E2E run (the run was cancelled); a rerun is about 40 minutes against the live backend and needs the owner's word.
- #351: the owner's word to merge.

## Update, evening (ledger 1314-1320)

**Asked by the owner (16:45 EDT):** merge what waits, rerun the dev E2E, dispatch the monitor, hold the flip unless not holding is better.

- **#351 MERGED** (a74bf1f83, ledger 1316). #352 (this record) stays open until the last line of the day is in it.
- **Monitor dispatched and GREEN** (run 38965380539, ledger 1314-1315): verdict OK, height MAE 0.219 m over 60 buoys, skill ledger newest scored target 2.9 h old. Commitment 1280 closed (checks 1 and 2 were read at ledger 1291).
- **Dev E2E rerun** (run 38966429678, ledger 1317, 1319): 67 passed, 9 skipped, 0 failed on the #347 build. The 9 are the lane's refusals: the executed-GL pixel test is skipped on all four projects (so CI never executed the GL assertion), render-continuity on Mobile Safari and Firefox, one Firefox model-switch test. The #347 mask effect rests on the harness, not on this run. The push-run for #351's merge was superseded by the dispatch through the lane's concurrency group (it would have waited 20 minutes for a Netlify build that `[skip netlify]` never makes; every `[skip netlify]` push to dev fails this lane for that reason, which is why the lane showed red on four of today's merges).
- **The flip (ledger 1318).** The hold I had written down (the frozen production client misreading thinned bounds) is not real: production serves `fc140024`, which has no reference to `grid_series` or `series_stride`; the flag is read only on the series-stride paths; `/grid` over the synthetic store is identical with the flag off and on (world and three regional boxes) except a one-second timestamp. What the flip changes is `/grid_series` for series clients (the dev site, the main preview). Costs: mask-sized uploads over the scrub replay 13 with #347 (23 without) versus 3 flag-off, and a Render deploy of the shared box (worth timing for a quiet moment and after any E2E). Benefit: the measured 2.04 deg northward draw of thinned world frames goes to 0. Left for the owner's explicit word (D-001 asks for it; the delegation was conditional).
- **Parity-record fix = draft #353** (ledger 1320). Review 1 of the first commit found one MEDIUM (a clear wrote the stale-hour status; the overlay memo then kept the badge after the next good frame); fixed in the second commit, 47 mutations killed. Harness acceptance: 7 of 7 steps read parity true at the upload (before, 4 of 7 read false for 24 s). A stale badge after the right frame in a plain scrub is PRE-EXISTING (the overlay memo is keyed before the effects) and is not fixed.

**Owed now (replaces the previous Owed list where it differs).**
- The owner's word to flip `SERIES_THIN_NODE_BOUNDS` (commitment 1289, due 2026-10-19).
- #353: the owner's word to merge (ships ON, kill `__RAW_DISABLE_PARITY_REPUBLISH__`).
- #350: round 4 result, my own re-run of its gates, floors redone for the final test-file list, review 4, then the owner's word to merge and, separately, to set the flag in the L2 writers' env.
- #352: merge after the last line of the day is in it.
- Known gap: CI never executes the GL pixel assertion (skipped on every project); a lane that can run GL would close it.

## Update, the flip (ledger 1321-1322)

**Done on the owner's word (17:23 EDT): `SERIES_THIN_NODE_BOUNDS=1` on Render.** One thing I had not known when I asked: Render was still running the 03:13Z build (db45393), because every commit since carried `[skip render]` (the service's events list `commit_ignored` for each), so #343's code was not on the box at all. The environment-variable call itself triggered a deploy of the dev tip (a74bf1f83): the only backend difference between the two builds is #342 (a CI-side path) and #343 (this flag), 12 files. Health read 38 s after the new build started, `restore_status` complete (13167 restored) at 47 s, 0.24 to 0.76 s around the reads, except 2.2 s right after the first (cold) world page. I should have told the owner a deploy was part of the flip before asking; it is recorded in the ledger line instead.

**What I could and could not read live.** Two light world `grid_series` reads (1 frame, then 6 frames = stride 2) show bounds equal to the node extent, which does not discriminate (stride 2 keeps the last row of an 83-row grid, so flag-off bounds are identical). The discriminating read is a stride-4 page (the app's 48-frame pages): north 80 instead of 84. My 24-frame request for stride 3 was refused by the permission classifier as load on the live box; I did not retry or work around it. The read-back is commitment 1322 (due 2026-10-19), to be taken from a normal dev-site load, with the owner's eye on the hurricane position.

**#350, round 4 (the builder's report; my re-run).** Three commits on top of the first cut: the pure split (same 123 tests), the fixes (absorb the head on the caller thread, spent exclusions as {id: sequence}, an atexit flush with a loud annotation, CAS on generation AND key, a legacy fallback on a definite missing head only, the lane's own count-based retention ring, the cleaned-resave path routed through the helper), and a strengthening commit after five mutation survivors. 188 tests in 7 files, every file under 800 lines. I re-ran: the 188 pass; the partition check says every tracked backend test file is claimed by exactly one lane (guards 204); flake8 gate 0; file-size gate 0 violations; `loc_ratchet.py` New 0 Regressed 0; the floor and flag-parity tests pass. Floors moved in the same branch to 204 files / 2886 (`_FLOOR_SET_FROM` 2892); hosted CI is the authority. NOT run by me: the builder's 872-test wide regression (21 minutes), nothing against real Supabase. Independent review 4 is running.

**Owed now (replaces the previous Owed list where it differs).**
- Commitment 1322: the stride-4 read-back and the owner's eye on the dev site (due 2026-10-19).
- #353: the owner's word to merge (ships ON, kill `__RAW_DISABLE_PARITY_REPUBLISH__`).
- #350: review 4's verdict, the hosted floor reading (must be 204 files / 2892), a merge of dev into the branch, then the owner's word to merge and, separately, to set the flag in the L2 writers' env.
- #352: merge after the last line of the day is in it.

## Update, the owner's 19:24 ask (ledger 1325-1330)

**Asked:** merge the parity fix and take the flip read-back, then test visually for jumping on pan or zoom.

- **#353 MERGED** (f274fc793, ledger 1325); the dev site served it within minutes. Its push-triggered E2E failed at the Render wait (Render ignores `[skip render]` commits, so the backend never serves the commit and the lane gives up after 15 minutes): no test ran. A dispatch (38983302256) ran the lane: 65 passed, 2 flaky (booking-flow, Desktop Chrome, auth gating and spot-detail recovery, passed on retry), 9 skipped, 0 failed, 18.4 minutes (ledger 1326-1327). The box answered slowly for about three minutes after (health 3.6 to 8.2 s), then recovered.
- **The dev site is behind the access-code screen,** which I cannot pass, so the visual test ran a local build of the same client against the real backend through a new opt-in harness mode (`AB_LIVE=1`, draft #354), read-only weather GETs, three scripted loads in about ten minutes, health probed before and after each (0.4 to 1.3 s, all 200).
- **Read-back (ledger 1328).** The two 48-frame world pages the box serves now are stride 4 with `bounds.north` 80, equal to the last kept row; flag off would say 84. Thinned versus exact at the same hour and camera registers at 0 px live; the replay with the merged client and the flag off reads 30 px = 2.11 deg and with it on 0 px. Frozen-camera windows on real data (settle, one-stop zoom, 4-degree pan) show no redraw and at most 2 px (0.05 deg). The overlay image (thinned red, exact cyan; flag off, flag on, live) was sent to the owner. Limits: the flag-off value was not measured live, nor mask-sized upload counts, nor the owner's own look; commitment 1322 stays open for those.
- **My first live scenario reached no thinned stage** (it pressed the scrub before the 48-frame page had landed) and recorded only the series bounds; the scenario now waits for the page. I note the extra live load it cost.
- **#350, review 5 of round 5 (ledger 1330):** approve with changes; the stricter 404 standard must key off the lane being active, not the raw flag; a late-landing earlier unknown swap is forgotten; a head that parses but breaks reconcile never self-heals; two bookkeeping nits; the PostgREST missing-table answer (404 PGRST205) is documented as a limit. Round 6 is with the builder; the PR stays draft.

**Owed now (replaces the previous Owed list where it differs).**
- Commitment 1322 (due 2026-10-19): the owner's own look on the dev site for the position jump, and live mask-sized upload counts.
- #354: the owner's word to merge (tooling only).
- #350: round 6, my re-run, floors, the hosted reading, a merge of dev into the branch, then the owner's word to merge and, separately, to set the flag in the L2 writers' env.
- The docs PR carrying ledger 1323-1330 (this one): merge once its checks are green.

## Update, the owner's 20:27 to 21:39 EDT directions (ledger 1331-1343)

- **Merged on the owner's word:** #355 (the evening record) and #354 (harness live mode) at 00:43Z; #356 (the evidence log) and #357 (the one-off scored-rows gate file) at 01:33Z. #357 was merged ONLY so a dispatch-only workflow exists on the default branch; nothing has run and the Storage read is a separate owner word (commitment 1335).
- **'Are we on the path to state of the art?' answered with the day's monitor numbers (offshore buoys, about 3,000 pairs per lead):** served 0.299/0.320/0.363 m, beats persistence by 0.22 to 0.32 m, trails the Open-Meteo references by 0.00 to 0.053 m and its own scalar lane by about 0.018 m; strengths are the nearshore chain, the 14-day three-model horizon and the measurement discipline; the gaps are accuracy, pipeline fragility this week and CI never executing the GL pixel assertion. The owner chose: close the gap, figure out a recommendation, finish the manifest lane, add a surf-zone check (ledger 1333).
- **The evidence session (a separate session, log #356).** Scalar lane beats served in 36 of 36 lead-reads; the gain is structural, not an offset (2.2 to 4.6 times the MAE per metre of bias moved of the ledger's MOS); big swells untouched; the built CONSENSUS shadow differs from the computed equal mean by a median 0.126/0.132 m at +48/+72 h (one-sided high, since the first rows on 2026-10-03), so the monitor's 0.362/0.380 are a construction defect, not evidence against D-006. Proposed order: scalar flip (after the row-level gate), scalar shadow lanes for EURO and ICON, a monitor check on shadow-minus-equal, then the consensus flip. It made one outbound request (a cached public GET of the buoy-calibration report, health 0.96 s before and 0.40 s after) and recorded it. Commitments 1335 (row-level gate, due 2026-10-19) and 1336 (the construction defect, due 2026-10-24).
- **The one-off row read (#357).** The owner chose a CI job that already holds the key over a local download. It is dispatch-only, GET-only (enforced by wrapping http.client; any other method, any body or any host but the Supabase project raises a BaseException), prints aggregates only (cells under n=10 print n<10, no artifact), and carries its own removal plan. I read the workflow, the script, the renderer and the planted-id tests, and moved the chain floor.
- **Surf-zone gate (#358, draft).** The nearshore judge already grades the served breaking height against nearshore buoys every six hours (graded n_matched=183 on run 38982682625: MAE 0.162 m, observed/modelled 1.25, which is the model 20 percent below the observation; I first wrote 25 and corrected it, ledger 1339) but nothing could warn or fail. The gate adds REFUSE (blind, never graced), a standing WARN outside 0.85 to 1.15, and RED only after the grace date 2026-11-15; kill switch NEARSHORE_GATE=0; thresholds provisional from ONE reading. Merging it after #357 meant re-deriving the chain floor: the second PR to merge always does.
- **Manifest one-step lane (#350, default off).** Round 6 (verified, floors 206/3037, pushed) went to a sixth independent review, which returned DO NOT APPROVE: round 6's move of 'remember the attempted swap' to after the swap returns means a save that arrives during a swap carries an empty memory, and the schedule 'A's swap answer lost, B submitted during it, A's swap lands late, W re-registers X, B runs' erases W's X; no test submitted during a swap. Round 7 (memory kept in the slot or handed over in _settle, a head-moved marker after adoption, a parseable head sanitized and any other merge exception failing closed with ::error:: instead of falling back to a stale legacy file) is with the builder. The lane stays default-off and draft; merging it and setting its flag in the L2 writers' env are two separate owner words.
- **Housekeeping I owe a note on:** a stray temporary file and folder of mine landed in another session's scratchpad directory (a glob picked the wrong one); I removed both. A monitor-side check for the consensus construction defect (WARN only, kill switch, ledger candidate B) is being built on branch claude/monitor-consensus-gate.

**Owed now (replaces the previous Owed list where it differs).**
- The owner's word to DISPATCH 'Scored Rows Gate (ONE-OFF)' (commitment 1335, due 2026-10-19); then, only if its gate sentence says yes, the owner's explicit word to flip SAMPLER_SCALAR_HEIGHT (three workflow files and the Render env, together).
- #358: merge after its checks (floors re-derived on top of #357); #350: round 7, my re-run, floors, the hosted reading, then the owner's word; commitment 1322 (the owner's own look at the flip) and 1336 (the construction defect).
- The ICON far-hour release risk (ledger 1312): decide before the dev code is promoted whether production builds carry REACT_APP_ICON_STORED_TAIL or whether the layer whitelists gfs_trend.
