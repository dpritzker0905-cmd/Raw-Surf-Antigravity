# Land mask for zoom and pan: measured, split, made cheaper with the same bytes (2026-10-20)

Session opened 2026-10-20T01:23Z, started by the lead session (memory `sota-research-2026-10-20`: an offline CPU profile of
the owner's erratic session put **46% of zoom/pan stall time in the land-mask build**; PR #400, `stall_profile.js`). Task:
design and build a cheaper land mask for zoom and pan **without changing what is drawn**. Branch `claude/viewport-land-mask`
on `dev` a4a020334, worktree `C:/Users/David/App/rs-landmask`. Client and harness only. **No served number changes** (no
SCOREBOARD row): the mask texture the GPU samples is byte-identical (section 4); only the CPU time to build it changes.
Offline throughout: the real backend over synthetic data on :4140 (`serve_synthetic.py --thin-bounds 1 --dynamic 1 --models
GFS,ICON,EURO --layers waves,swell_1,swell_2,wind_waves,wind --regions flagship`), never the live box. Evidence file:
`docs/weather-program/evidence/landmask-fast-2026-10-20.json`.

## 1. Where the mask time goes (before = dev a4a020334, source-mapped build)

New `frontend/scripts/visual-lab/mask_split.js` reads the lab's CPU profile (`LAB_TRACE=1`) and bills every sample inside a
stall (>= 50 ms, stall_profile's definition) to the INNERMOST land-mask frame. Sum over 8 baseline runs (erratic x4,
pan_zoom_future x4), ms inside stalls: **rasterize 3,750 · basemap-water overlay 2,986 · shelter classifier 2,117 · inland
guard 1,395 · upload/glue 596 · feature query 555**. At zoom 8 and pan the overlay + shelter + inland passes dominate;
rasterize dominates the zoom-OUT steps (world-mask rebuilds).

`scn_mask_calls.js` (new; the app's own `cpuPhaseTiming` receipts) says why a pan costs so much: **a pan step runs 4-5
separate basemap-water paints of 55-110 ms each**, and a zoom-8 step 1-3. By trigger: about half are the same-frame re-patch
after a data commit (`commit`), the rest `moveend` / `idle` / `zoomend` re-drives as tiles arrive; at z >= 8 every regional
refresh also paints the viewport overlay (`MIDZOOM_OVERLAY_CARVE_MIN_Z = 8`).

Chrome's 2D canvas RECORDS draw calls and rasterizes them at the next read, so a profile bills raster work to whatever read
follows (`getImageData`, `drawImage` FROM that canvas). To price the real work, `scn_mask_capture.js` (new) records the exact
inputs of every paint in the app (canvas bounds, map bounds, style water layers, every feature MapLibre handed the painter)
per basemap theme, and a replay bench re-runs them outside the app with a flush after each draw op. On the dark capture
(21 paints): **~46,000 `fill()` calls and ~8,700 strokes** (one fill per island hole, a fill + dilation stroke per wetland
polygon from every loaded tile, a fill + stroke per Natural Earth island within the 1-degree pad), and one native call that
should cost nothing, `closePath()`, at **~10% of a paint**: in a path holding many subpaths Chrome makes each close O(path
length) (micro-bench: 400 rings x 800 points, one fill: 100-125 ms with closePath, 8-10 ms without).

## 2. The directions, with numbers

- **(a) one mask per zoom band at world/tile scale, sampled by bounds.** Could only remove the rasterize share (3,750 of
  11,400 ms above, ~33%), and is NOT pixel-identical by construction: the canvas pixel grid follows the bounds (different
  anti-aliased edges, different texel centres), and the shelter classifier defines open water as water that reaches the
  CANVAS BORDER, the inland guard as distance to Natural-Earth water ON the canvas, so a larger canvas changes both verdicts.
- **(c) tile-keyed incremental masks.** Same two problems: inland + shelter are whole-canvas analyses (a strip cannot be
  classified alone), and the overlay canvases are viewport-padded, not tile-aligned, so even the raster would not line up.
- **(d) static precomputed tiles.** Rasterize only (the overlay, inland and shelter passes read live basemap vector tiles,
  which differ per theme and view); same alignment problem as (a); plus a build pipeline.
- **(b) Web Worker + OffscreenCanvas.** Could move nearly all of the mask CPU off the main thread, but makes the paint
  ASYNCHRONOUS. About half the paints are the same-frame re-patch after a commit, which today keeps the Natural-Earth-only
  mask from ever being presented; those must stay synchronous or the bays-flicker class returns for ~a paint's duration. The
  event-driven half could go async: settled masks identical, transient frames show the previous mask for ~70-100 ms longer
  (the same picture the stalled frame shows today). Costs: OffscreenCanvas 2D + willReadFrequently parity (Safari 16.4/17),
  cloning ~2 MB of features per paint, the module-level caches (basin verdicts, shelter cache) moving into the worker, and
  splitting both engine refresh methods (WebGLMarineEngine.js, over the LOC cap) into prepare / commit with staleness checks.
  **Not built here**: it changes transient frames, which the task ruled out; proposed as a follow-up with these numbers.
- **What was built: the same work, done cheaper, byte for byte** (section 3). Ceiling measured on the replay: about 25-35% of
  a paint; the rest is in-view geometry and the classifiers (an exact integral-image / sliding-window rewrite of both
  classifiers was built, proved equal on 85 random grids, and DROPPED: 2% of paint time for the separable version's extra
  allocation, not worth the code).

## 3. The fix: `maskFastPaths.js`, ON, kill `window.__RAW_DISABLE_FAST_LAND_MASK__ = true`

Four paths, each with the reason its bytes cannot change (the file header says the same):
1. **No `closePath()` on fill-only traces** (basemap water white pass, island-hole pass). `fill()` closes open subpaths
   itself and GeoJSON rings are already closed. The wetland trace is STROKED, so it keeps `closePath()` (joins vs caps).
2. **Off-clip cull.** A shape whose projected box, grown by AA + half the stroke width + the miter reach, misses the viewport
   clip (water paint) or the canvas (Natural Earth raster) paints nothing; skipped. Both projectors are separable and
   monotone, so projected corners bound every vertex; a ring that cannot be bounded is never culled; with no copy offset the
   original path state is kept. The wetland pass re-strokes "the current path" when a polygon has no copy in the window (a
   quirk of the original); `curPathCulled` tracks whether that path is a skipped one so the re-stroke stays exact (tested).
   Measured: fills 46,344 -> 19,941, strokes ~8,700 -> ~3,700 on the dark capture.
3. **Sub-rect verdict stamps** (shelter, inland): a source-over stamp's transparent texels change nothing, so only the box
   holding opaque texels is drawn, at the same integer scale, aligned to whole texels (non-integer scale: full draw).
4. **Plausibility verdict from sampled rows**: the open-water damage check sampled ~4,000 points out of a full-canvas copy
   plus two viewport-sized reads (~18 MB each at z8); it now reads only the ~130 rows it samples, the Natural-Earth rows from
   the pristine canvas before the paint, and makes the full copy only when the island re-assert needs it.
`WebGLMarineMaskRenderer.js` stays under the cap (796 lines); `WebGLMarineEngine.js` and `WebGLMarineLayer.js` untouched.

## 4. Same pixels: evidence

- **Replay bench, fixed inputs** (`frontend/scripts/visual-lab/mask_replay.js origin/dev 5 cap-*.json`): every captured paint
  through dev's modules and this branch's, canvases byte-compared. **56 paints (dark 21, light 17, beach 18) identical on all
  5 reps; applied/degraded verdicts identical.** Null control first (identical code both sides): 17/17 identical.
- **In the app, GPU read-back** (`scn_mask_identity.js`): at 7 fixed views (Florida z6, z8, pan z8, z9.5, z8 north; SoCal z8,
  z10), after the mask settles, the resident base and overlay textures are read back and hashed, dev bundle x2 and branch x2
  per theme (+2 more beach). **Dark and light: every overlay hash identical across all 4 runs at all 7 views; every base hash
  identical whenever its bounds are.** Which grid is committed at a view (e.g. a -96..-64 mid clip vs a 4-degree viewport
  grid) is timing-dependent and varies between the two DEV runs as much as between dev and branch (null control). **Beach:**
  branch run 2 differed at every view from z8 on. Control: the DEV bundle with the 10 m land file blocked (`NO10M=1`)
  reproduces run 2's hashes exactly at every view (z8 `bfa708a5/b705279a`, SoCal `2bfbf0a/464898e5`, ...): that run loaded
  without the 10 m land (CDN), and drew what dev draws on that input. Branch runs 3 and 4, with the land-set tag added, match
  dev's runs exactly.

## 5. Cheaper: evidence

- **Replay bench, whole paint** (raster + water paint, medians of 5 fresh-page reps, order alternated): dark 1,686 -> 1,424 ms
  (-15.5%), light 1,376 -> 1,038 (-24.6%), beach 1,633 -> 1,380 (-15.5%); the water-paint part alone -17% to -28%. Machine
  shared with other sessions (CPU 30-80%), so absolute ms drift between runs; the ratios are from interleaved pairs.
- **In the app, per paint** (`scn_mask_calls.js`, 3 interleaved runs per arm, the app's own receipts): **ms per basemap-water
  paint, median 106.5 (106.5 / 85.7 / 108.7) -> 70.8 (70.6 / 83.2 / 70.8), -34%**; total paint ms per scenario 1,491 -> 1,132
  despite 16 paints vs 14; worst long task at the zoom-8 step 519 / 507 / 683 -> 366 / 426 / 374 ms, second pan step
  653 / 206 / 357 -> 169 / 174 / 181 ms.
- **stall_profile stageByStep** (PR #400's tool; dev x4, branch x2 per flow, numbers in the evidence file): too noisy to
  resolve a ~30% per-paint cut. The paint COUNT per step varies with tile arrival and machine load (dev's own zoom-8 land-mask
  stage read 17, 552, 894 and 233 ms over four runs; the branch 1,063 and 147). Two runs per arm cannot show it. A second
  batch with the 10 m land served locally (removing the CDN-arrival variance) is in section 7.

## 6. Tools added (all offline; none can reach the live box)

`visual-lab/mask_split.js` (mask stages per lab step), `visual-lab/mask_replay.js` (REF vs working tree on captured paints:
identity + timing), `offline-backend/scn_mask_calls.js` (paints per step, by trigger), `scn_mask_capture.js` (paint inputs
per theme), `scn_mask_identity.js` (GPU read-back of the resident masks; `NO10M=1` control). Jest: `maskFastPaths.test.js`
(stamp geometry and kill switch, sampled-row verdict = the original loop on random data, cull bounds, closePath only on the
stroked trace, the re-stroke quirk). Jest trees 334 suites / 4,993 tests green before the classifier rewrite was dropped;
ESLint ratchet green. After the last code commit: Jest trees **334 suites / 4,907 tests** green (the 86 classifier-equality
tests left with the dropped rewrite), build green.

## 7. Second in-app batch (10 m land served locally, 4 interleaved runs per arm per flow)

The 18 MB 10 m land file is fetched from a CDN when the bundle serves no local copy, so WHEN it lands differs per run (it
caused the beach outlier above). Both bundles served a local copy (scratch copies only; the repo ships none), then
erratic and pan_zoom_future alternated new/dev, 4 runs each (`stall_profile.js` + `mask_split.js` on every run). Medians
(per-run values in the evidence file, `inAppStallProfile_byStep_localLand`):

| step | land-mask stage, ms (dev -> branch) | worst stall, ms (dev -> branch) |
|---|---|---|
| erratic zoom 8 | 609 -> 373 | 750 -> 586 |
| erratic pan | 567 -> 380 | 542 -> 485 |
| pan_zoom zoom 6 | 166 -> 60 | 358 -> 194 |
| pan_zoom zoom 8 | 466 -> 471 | 703 -> 423 |
| pan_zoom pan east | 317 -> 261 | 506 -> 216 |
| zoom/pan segment, erratic (zoom 8 + pan + zoom out) | 1,357 -> 896 | |
| zoom/pan segment, pan_zoom_future (all five steps) | 1,629 -> 1,093 | |

Run-to-run spread is still wide (erratic zoom 8, dev: 100, 131, 1,087, 1,131 ms), so read the medians as direction and the
per-paint receipts (section 5) as size. **The zoom-OUT steps read higher on the branch** (erratic 69 -> 194, pan_zoom 135
-> 211; all `rasterize`, i.e. the world-mask rebuild). Followed up, not assumed: a direct `renderMaskToCanvas` bench found
the Natural-Earth cull costing **+8% on a world canvas built from the 10 m polygons** (112 -> 122 ms), where it culls
nothing but scanned every vertex's latitude on every rebuild. Fixed after this batch: the cull is skipped for the global
target, and each polygon's latitude range is cached on its coordinate array (as `getPolygonBbox` caches `__bbox`). Re-bench,
20 alternating reps under ~80% background CPU: world 10 m 189 vs 186 ms (that path is now the original code), Florida tile
46 -> 33, SoCal tile 43 -> 35; all byte-identical. Section 8 re-checks the final bundle in the app.

## 8. The final bundle (708acac5b), re-checked in the app and on the replay

- **Replay, final code, 3 reps:** 56/56 paints byte-identical on every rep; applied/degraded verdicts AND the painter's
  receipts (`openWaterVerdict` counts, `inlandWaterGuard`, `islandReassert`) identical. Timing under heavy background load:
  -11% to -16% whole paint.
- **GPU read-back, final bundle, one run per theme, 10 m land served locally** (+ one dev run per theme the same way):
  all 22 read-back runs grouped by (theme, view, texture, bounds): of the 44 groups both bundles reached, ONE hash was
  produced only by the branch, light FL z6 overlay `269b2fc0`, which dev produced for the same view and bounds in dark (dark
  and light draw identical masks at every view: same water source). Dev alone produced 3 alternates (`baseL-dark-1` at FL z6,
  FL z8, SoCal z10): which tiles were queryable when the last paint ran is a run-to-run input, in both bundles.
- **Per paint, paired on the final bundle** (heavy background CPU, both arms slow): 157.8 ms/paint vs dev's 181.8 in the
  same window.

## 9. Not done / follow-ups

- **Async event-driven paints (Worker or time-sliced), owner decision.** The remaining ~70 ms/paint is in-view geometry,
  three downsamples, the LRU copy and the two classifiers. About half of a pan's paints are `moveend` / `idle` / `zoomend`
  re-drives that could leave the critical frame; that changes transient frames (the previous mask shown ~a paint longer),
  which this task ruled out. Numbers in section 2.
- **Exact-repeat paints** (~12% of captured paints: the wide-delegate overlay and the nested overlay repaint the same bounds
  with the same inputs because the combine-mode flag differs). A memo needs a content hash of the features; not built.
- Live read-back after a merge: in the owner's browser, `window.__RAW_GPU__.cpuPhaseTiming.buckets.maskWaterPaint`
  (calls, totalDurationMs) on a zoom/pan session, with and without `window.__RAW_DISABLE_FAST_LAND_MASK__ = true`.
