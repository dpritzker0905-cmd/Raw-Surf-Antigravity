# HANDOFF 2026-07-20 (eve) — estimator job-killer fixed · F1/F2 closed · queue verified live

Autonomous verification sweep continuing the 07-20 DAY audit queue (`06d1247b`). Every claim
below carries its evidence; every fix tested 3 ways per the standing mandate. Ships `f9c5e59a`.

## 1. NEW BUG — found, rooted, fixed, proven: the extended-estimates job-killer

**What broke.** Core CI run 29724899253 (09:22Z, `abbc9c76`): `estimate_euro_grid` crashed
with `UnboundLocalError: w_gfs_real` at estimator.py:387 (post-loop diagnostics dict) for
global_coarse/waves, EURO anchor 2026-07-30T00Z. Every one of the 629 cells took a `continue`
path, so the loop-local weights were never bound. The caller caught only
`EstimateContractError` → **the whole job died**: the FL/SoCal estimates generated seconds
earlier were never batch-saved (save runs after all regions), and global_mid was never
processed. One bad target hour cost the entire EURO 10→14d extension cycle.

**Forensics.** All four input products AS STORED in L2 are healthy — probed via the live
`/grid` API with a >400° bbox (forces raw global_coarse): EURO anchor 371/629 valid, GFS
anchor/targets 541/629, world bounds, all resamples succeed. Five earlier runs were green and
the very next run's EURO job completed → the trigger was **transient in-process state** (the
class-level `ProductStore._product_cache` shared by all jobs in a CI process is the prime
suspect; the mutator is NOT identified — the instrument below catches it next time).

**The fix (`f9c5e59a`), three layers:**
- estimator: nominal weights bound **before** the loop; `blended_cells == 0` → forensic ERROR
  naming every input grid's id/cols/rows/nvec/bounds + skip-reason counts, then `return None`
  (no garbage all-invalid product). Grep cron logs for **"ZERO blendable cells"**.
- both callers (EURO `scheduler_helpers` + `icon_marine_extension` — they share the same
  estimator): broad per-target `except Exception` — one bad target costs exactly one target.
- 5 regression tests (`test_estimator_zero_blend_guard.py`).

**Tested 3 ways.** (1) 28/28 estimator-family tests then full backend suite **806 passed**;
(2) real-data repro: old code (git HEAD) crashes on the degenerate shape of the REAL fetched
grids, new code blends the same healthy data identically (371/629, weights 0.66/0.34 @+3h)
and skips the degenerate shape with the forensic line (`skipped_gfs_resample=371` — the
production signature); (3) live CI: dispatched core run 29744936166 at `f9c5e59a` (in
progress at handoff time — check `EURO Marine Extended Estimates` completes; the 12:32Z
pre-fix run already re-proved intermittency by succeeding).

**User impact repaired**: EURO estimated products at 07-31/08-01/08-02 serve live again
(est=True, fresh) — the 14-day EURO scrub horizon is whole.

## 2. F1 (CI ingest budget) — CLOSED, premise was stale

The audit's F1 assumed the wind mids joined the CORE lane. Ground truth: `forecast.py` put
all three in **pilot_jobs** from the start (34b17843/d15a6b79). Evidence:
- Pilots run 29722124325 (@`abbc9c76`, all six global-mids + six pilots): **all green,
  138 of 200 min**; the three wind mids cost ~11 min combined (GFS 1.5 + ICON 5.1 + EURO 4.3
  — native byte-range fetches are cheap).
- Core exec: 111 min (scheduled 12:15Z run) / 125-129 min (seed-morning runs) of 165 —
  headroom ≥36 min. The 156-min number in the audit included ~31 min of queue wait.
- Largest core line-items now: EURO Wind Global 22 min, EURO Marine Global 18, GFS Marine 15.

## 3. F2 (stale prod frontend) — RESOLVED, verified 3 ways

`dev--rawsurf.netlify.app` now serves `main.17c903f7.js` (was `main.9b725b49.js`):
1. bundle hash rotated;
2. chunk `5363.061737d4.chunk.js` contains `__RAW_DISABLE_WIND_HEATMAP_SINGLEPASS__` (the
   audit's specified spot-check) and `wind_viewport_fine_`;
3. the same chunk contains dbd142dc's minify-surviving `150:500` ternary (zoom-out fast lane)
   → the deploy includes the LAST client commit of the arc.
(`windTwoTexture` absent by design — it is a test-suite pin, not shipped code.)
Production users now run the full 07-19/20 client arc: palette v3.22, single-pass composite,
livelock/dedup fixes, fine tier, zoom-out fast lane.

## 4. Queue #3 (native recovery) — ALIVE in prod

Render logs via API (`RENDER_API_KEY`): 100+ `[Wind Native Recovery]` lines, spawns AND
completions — e.g. "GFS recovery COMPLETE … 129 timesteps persisted (fine product now
cached)". The `native_recovery:"none"` observations meant "no recovery was needed", not dead
code. Item closed; no dashboard evening required.

## 5. Queue #4 (EURO/ICON wind global_mid) — VERIFIED, 3 probes

1. **World span**: GFS/ICON/EURO each serve `*_wind_wind_global_mid_20260720T180000Z.json`,
   181×78 = 14,118 vectors @2.00°, fresh.
2. **Regional clip**: 30° span serves the clipped mid (19×13 @2°).
3. **SWR sharpen, per-model isolated**: all three models go mid(2°, `swr_revalidation_pending`)
   → viewport fine (1.00°) within 75 s, on three different oceans (mid-Atlantic, SW Australia,
   Biscay).

⚠️ **Probe discipline learned**: a 3-model back-to-back probe on ONE viewport falsely shows
"GFS never revals / EURO stuck pending" — that is the reval **queue cap 2**
(`MARINE_REVAL_QUEUE_MAX`) plus the **clip-cache early return** freezing the first verdict.
Probe one model at a time on fresh bboxes. Real clients fetch one model — not affected.

Bonus: wind SERIES payload (the audit's unmeasured coupling) — 6 frames × 221 vectors at
30×20° = **27 KB gzipped**; world 3-frame = 808 KB gz (rare path, acceptable).

## 6. Loose ends / next

- **Dispatched run 29744936166** (at `f9c5e59a`): confirm `EURO Marine Extended Estimates`
  completes green; that is the fix's third leg. Next scheduled cores run the fix from 16:15Z.
- **Phantom manifest entries**: the failing window also showed
  `icon_marine_waves_global_coarse_20260730T000000Z_estimated.json` in the manifest with a
  404 file in L2 (stale entry, pruned file). Self-healed later in-run this time; candidates
  for the l2-orphan-sweep to also sweep the reverse direction (entry-without-file).
- **React Scan pass** (queue #5): needs a VISIBLE tab (hidden-tab rAF throttling falsifies
  FPS) — user-driven, post-deploy conditions are now met since F2 shipped.
- **Then**: marine debt bank (ARBITER stateful harness first) → vortex second sample.
- LOC watch: `scheduler_helpers.py` at 761/800.

## 7. SESSION CONTINUATION (same day) — re-verification, ARBITER harness, bug-class sweep

**Re-verification of §1-§5 from fresh angles, all green:** the dispatched fix-commit run
29744936166 finished 11/11 jobs, zero error lines, 114 min (fastest core run of the day);
the served 08-01 EURO estimate's `estimate_basis` anchors on TODAY's
`euro_..._20260730T000000Z.json` (the fix-run's 362-file batch is live in serving);
`grid.diagnostics.weights` has ZERO consumers repo-wide (the nominal-weights change cannot
regress anything).

**ARBITER stateful sequence harness SHIPPED (`86979a94`)** — the named flip gate from 07-18
EVE-3 §8. `marineCommitArbiter.sequence.test.js`: 37,268 enumerated interleavings × both
modes through the REAL `decideMarineCommit` (synthetic clock, per-frame self-heal, per-mode
grace singletons) → **0 trajectory divergences, 0 bounces, engagement exact
(120,147/120,147)**, three outage anchors (§4f interlude, bounded grace, 07-03 wedge).
Teeth proven: resurrecting the unscoped `flavor_downgrade` fails the harness with 2,468
divergences in 12 classes that read as the wedge. Suite 1300/1300.
**The arbiter default flip is now gated ONLY on the live protocol** (zoomlab ladder + eye
pass, three themes, rating ON/OFF) — one evening with a visible tab.

**Marine debt bank items 2+3 AUDITED CLEAN:** mappers propagate `stale`/`staleReason` on both
marine lanes (helpers:268/319, copernicus:72/118); `fallbackReason:null` sites are telemetry
success-path defaults, not mappers; `windGridSeries stale:false` is a default for a field the
series schema lacks (schema-verified live — becomes the wind-bug shape only if the backend
adds per-frame stale); `partial_coverage` is sent but consumed by NOBODY (opportunity, not
defect). Series cache is span-aware at all three lookup layers; coarse-base LRU is role-scoped
coarse-only; the engine choke is the structural backstop wind lacked.

**Bug-class sweep (workflow, 4 finders + 2-skeptic adversarial verify) found 3 CONFIRMED
shape-B siblings of the estimator bug** — filed as tasks #6-#8: `normalize_and_save_loop`
per-timestep parse outside the per-item try (shared by ALL wind/pressure/mid ingestion jobs);
`save_products_batch_helper` per-item loop with NO try/except (an escaping error mid-batch
loses the rest AND skips the manifest write — the orphan/phantom-entry shape);
`run_report_calibration` bare gather without return_exceptions.

## 8. ALL THREE SIBLINGS FIXED (`be8771c3`) — tasks #6-#8 closed

Per-item isolation shipped for all three surfaces, same rigor as f9c5e59a:
- `normalize_and_save_loop`: parse inside the per-item guard; the blind Z-append no longer
  breaks VALID offset-suffixed ISO-8601; error log carries the raw string. One degenerate
  `hourly.time` entry now costs one timestep, not a completed fetch.
- `save_products_batch_helper`: per-item try + failure tally; the manifest write and cache
  invalidation are always reached (the live trigger was executor shutdown on a cancelled CI
  run — it orphaned already-uploaded files). Writing the test exposed a SECOND latent defect:
  the post-save invalidation loop did direct `product.product_id` access over all items — an
  exception there skipped remaining invalidations (stale L1 copies up to TTL). Now
  getattr-defensive.
- `_gather_snapshot`: `asyncio.wait` with the deadline INSIDE — one raising spot costs one
  spot, and a budget timeout keeps completed partials (the old outer `wait_for` cancelled
  everything: zero, not the "partial archive" the budget comment promises).

Tests: `test_batch_blast_radius_isolation.py` 5/5 (each confirmed failure mode reproduced) ·
ingestion/store/calibration subsets 73 green · full backend suite **811 green**.
LOC watch: scheduler_helpers.py now 774/800.

## 9. VORTEX R-GATE SECOND SAMPLE — the 0.5/1.2 window is now a CONTRACT

Queue item closed with live data (2026-07-20T18Z field, 1° SWR fine tier, the analyzer's
exact formula: R = |curl|·dyKm/(speed+2), central differences, cosLat-floored km spacing):

| frame | speed p50 | R p50 | R p90 | R p99 | cores |
|---|---|---|---|---|---|
| SH winter cyclone 42S/132W (14×10°) | 28.9 kn | 0.246 | 0.950 | 3.32 | **3.49, 1.60** |
| Pacific trades control (14×10°) | 13.4 kn | 0.073 | 0.183 | 0.28 | none |
| Atlantic trades control (14×10°) | 13.1 kn | 0.077 | 0.228 | 0.77 | none |

Verdict vs the abbc9c76 calibration (FL Gulf low: cores 1.4-2.2, ambient p90 0.59):
- **Cores of a hemisphere-different, type-different system saturate the 1.2 ceiling** (1.60,
  3.49) exactly like the calibrating invest — full vortex treatment engages on real cores.
- **Calm air stays below the 0.5 floor across two ocean basins** (p90 ≤ 0.23) — the
  no-particle-budget-tax property holds; today's calm frames are cleaner than the FL
  "ambient" (which included Gulf periphery).
- Storm annulus p90 0.95 mid-ramp = partial engagement inside the circulation, by design.
Two distinct real systems + two calm controls = the window graduates from calibration to
contract. Provenance: `wind-vortex-out/sh_storm_42S132W_fine_20260720.json` (API response
form; an engine-dumped fixture via probe_wind_vortex_dump on a visible session remains the
gold format if a committed fixture #2 is wanted).

## 10. ARBITER FLIP — LIVE BATTERY COMPLETE ×2 PASSES; ONLY THE USER EYE PASS REMAINS

Server: `frontend-arb` on :3011 (session preview). Every leg = `ZL_BASE=http://localhost:3011`,
arbiter legs add `ZL_FLAGS="__RAW_MARINE_ARBITER__"`; every run ended with zoomlab-verdict.

| leg | mode | verdict | engagement (decisions / notable rules) |
|---|---|---|---|
| staircase p1 | arbiter | PASS 0 | 69 / tier_downgrade 55 |
| staircase RATED p1 | arbiter | PASS 0 | 78 / flavor_downgrade 22, rated_uncovering_release 2 |
| scrub p1 | arbiter | 1 SETTLED_STEP −16.7 z7.2 | 148 / hour_change 11 |
| scrub control | guards | SAME class −16.3 z7.2 | 0 (kill verified) |
| pan_coverage p1 | arbiter | 1 SETTLED_STEP −18.4 z7.0 | 83 |
| pan_coverage control | guards | SAME class −17.1 z7.0 | 0 |
| staircase p2 | arbiter | PASS 0 | 74 |
| staircase RATED p2 | arbiter | PASS 0 | 40 / rated_uncovering_release 1 |
| staircase LIGHT theme | arbiter | PASS 0 | 89 |
| staircase BEACH theme | arbiter | PASS 0 | 68 |

**Zero arbiter-attributable findings**: both SETTLED_STEPs reproduce in guard mode at the same
zoom with matched magnitude (hour/pan content luminance change — the documented harness class),
and the guard controls double as the kill-switch check (mode=guards, decisions=0).

### THE USER EYE PASS — the last gate before the default flip (10-15 min)

Setup: open **http://localhost:3011/map** (if the server died, restart the `frontend-arb`
launch config). DevTools console: `window.__RAW_MARINE_ARBITER__ = true` (instant, no reload).
Instant revert at ANY time: `window.__RAW_DISABLE_MARINE_ARBITER__ = true`.

Do each numbered item; anything on the SUSPECT list = stop and report the number + what you saw:
1. **Zoom ladder, waves layer, dark theme**: z10 → z3 → z10, smooth continuous wheel.
   WATCH DURING the gesture (not after): the heatmap must only ever COARSEN or SHARPEN.
   SUSPECT: any full clear to basemap, any blocky world-grid flash mid-band (z6-8), any
   frame where animations freeze while color remains.
2. **Same ladder with Surf Rating ON**: toggle the rating band on first.
   SUSPECT: the colored band BLINKING OFF then back on during a zoom transition (§4f shape);
   a rated band lingering over a viewport you have clearly panned away from >5 s
   (stranded-rectangle shape).
3. **Rating toggle interlude**: at z7-8 over Florida, toggle rating ON→OFF→ON while the map
   is settled. SUSPECT: after toggling OFF, score-colored (rainbow-ish) cells persisting
   >2 s instead of honest heights returning.
4. **Pan sweep at z7**: grab the map over the Gulf and pan west→east across ~30° in one drag.
   SUSPECT: a rectangular seam where fine data ends and NOTHING fills behind it (the fill
   must be coarse wash, never blank).
5. **Hour scrub**: hold the forecast wheel through ~12 hours at z7.
   SUSPECT: the field freezing on one hour while the wheel advances, or flashing blank
   between hours. (A legitimate brightness change hour-to-hour is EXPECTED — that is the
   SETTLED_STEP the instruments flagged in BOTH modes.)
6. **Layer rotation**: waves → swell 1 → swell 2 → wind waves at z7.
   SUSPECT: any layer arriving as the 10° world lattice and STAYING blocky >5 s while
   zoomed in.
7. **Themes**: repeat #1 briefly in light and beach.
   SUSPECT: theme-specific clearing (the commit layer is theme-blind; any difference
   between themes is itself a finding).
8. **Engagement check**: console `window.__RAW_ARBITER_LIVE__` — `n` must be climbing and
   `byRule` non-empty. If `n` is 0 after all of the above, the flag did not take: report it
   (that would have made your whole pass vacuous).

**If all 8 clean** → the flip lands: default arbiter ON in `decideMarineCommit`
(`__RAW_DISABLE_MARINE_ARBITER__` stays the wholesale kill), plus the mode-plumbing update in
the three arbiter test files (Q1/guard legs must PIN guard mode via the disable flag once the
default flips), suite ×3, push. **If anything on a SUSPECT list appeared** → report the item
number; the ring buffer + `__RAW_ARBITER_LIVE__.last` carry the rule that decided the frame.

## 11. DEBT-BANK AUDIT RESULTS (items #4/#5/#7) — 8 confirmed findings, 2 tooling fixes shipped

Workflow wf_af7a2e23-a4f: 3 finders → 11 candidates → 2-skeptic adversarial verify → 8
confirmed (full verifier evidence: the workflow output file + tasks #10-#12).

**Refs-not-locals (item #4): CLEAN** — its one candidate (`wasScrubbingRef` effect-local in
useMarineScrubSettle) was refuted on materialization (timer-cancel and settle-check are
mutually exclusive).

**Bounds-blind warm commits (item #7): FIVE confirmed** — the wind-arc class, alive in marine:
1. scrub-cache instant commit containment-blind at zoomed-IN views (isContained computed then
   never consulted; non-covering exact-tile hit preempts the containment-proven series frame);
2. handleCooldownFallback commits on vectors.length alone (no containment, no __staleHour
   skip, bypasses the choke; cooldown suppresses the healing fetch);
3. getMarineSeriesFrame proves containment against entry.bounds (first frame's) while served
   frames can be narrower — per-frame bounds unchecked (the wind series bug one level down);
4. reactivate_refeed / initial_onAdd re-feed the OLD viewport's grid into an empty engine
   unchecked (floating rectangle after toggle-off→pan→toggle-on past the hold TTL);
5. non-backend remap lanes (flag-gated reachability) — bounds-blind AND they poison the fetch
   dedup hash after committing stale data.
The engine choke does NOT backstop these (empty_resident/hour_change/layer_switch commit
before any coverage rule, in BOTH modes) — the fix belongs at the warm sources, mirroring the
orchestrator's `regionalValidInPlace` containment predicate. Tasks #10 (cluster), #11
(re-feeds), #12 (non-backend + tooling), each demanding kill switch + A/B + zoomlab legs.

**Zoomlab SUM thresholds (item #5): three confirmed; two fixed now, one documented:**
- `probe_wind_finegrid_visual.js` → TH_SUM=20 SHIPPED (regime-matched to zoomclamp's measured
  wash calibration — same static base-vs-ON comparison; validated verdict-preserving on the
  committed off/fine_A_padded pair: coverage 0.9968→0.9946).
- `probe_wind_vortex_visual.js` → conversion REJECTED BY MEASUREMENT and reverted: offline
  validation on the committed vx_levers_* frames showed SUM=20 makes the frame-pair motion
  metric WORSE (OFF-leg spread 0.0022→0.0185; lever verdict flips 1.202→0.952). The frame-pair
  regime ≠ the wash regime — zoomclamp's constant does not transplant. Per-channel kept with a
  loud measured-flakiness warning + ≥3-leg median protocol; metric re-architecture in task #12.
- `zoomlab-diff.js` ANIM_RATIO_MAX=1.6 sits exactly AT the measured legitimate light-vs-dark
  ratio with zero margin (documented in the code-audit evidence; task #12).
