# 2026-11-15 Fable (animation lane): a blend between adjacent hours for the marine colour field (waves, swell_1, swell_2, wind_waves)

Client only, display only. No served number changes. Task from the director (09:38 EST), the researcher's move #1 (#912 section 6.2).
Base: `origin/dev` 9001096dc. Branch `fable/crest-hour-blend`.

## 1. What is there now (read before the gate was written; nothing built, nothing measured yet)
- The marine layers draw a colour field from ONE wave texture (RGBA8: R, G = direction as a unit vector, B = height, A = period),
  read at one place in the colour shader (`WebGLMarineShaders.js:490`, `sampleWaveLandAware`). The moving crests are particles
  drawn in a second pass; they are one set of particles and are carried across a step, they are not a texture that is swapped.
- An hour step overwrites that texture IN PLACE, on two paths: the normal commit (`WebGLMarineTextureEncoder.js:456-461`,
  `updateTexture`) and the scrub fast path (`marineFrameStoreRuntime.js:619-620`, a GPU copy from the frame pool or a byte
  upload; `marineFrameStoreCropShow.js` for cropped sets). After the overwrite the earlier hour is gone from the engine, so the
  next drawn frame shows the new hour whole: the hour pop.
- The scrubber moves in whole steps. There is no fractional time between two hours in the client, so "mixed by the frame-time
  fraction" can only mean a short timed blend at each step, as the own-frame rasters already do (`ownRasterLayer.js:91-105`,
  160 ms, the owner's "Blend first", 2026-11-12). A continuous between-hours interpolation would need a fractional playhead and
  two hours held through the fetch and commit chain; that is a larger change and is NOT this PR.

## 2. The design to be built (fixed here so the gate cannot be fitted to it afterwards)
- Before the wave texture is overwritten, the engine copies it on the GPU into a second texture of the same size (the earlier
  hour). For BLEND_MS the colour shader mixes the two hours' VALUES (direction, height, period), then colours the result as
  now. Smoothstep ease. After BLEND_MS the shader path is the one drawn today: one hour on screen at rest.
- BLEND_MS = 160, the same as the rasters, so every layer steps alike. `window.__RAW_CREST_BLEND_MS__` (a number) overrides it
  for the lab only.
- No blend (the hard swap, as today) when: the kill is set; the visitor prefers reduced motion; the two hours are not on the
  same grid (size or bounds differ); the land / no-data mask of the two hours differs (the fast path's exact-mask case); the
  layer is drawing surf ratings (the score texture is not blended); the step changes model or layer.
- The particles are not changed.
- Kill: `window.__RAW_DISABLE_CREST_HOUR_BLEND__ = true`.
- Truth note for the reviewers: for at most BLEND_MS the screen shows a mix of two served hours while the time label already
  shows the new hour. At rest exactly one served hour is drawn. This is the same trade the rasters made on 2026-11-12.

## 3. THE GATE, written 2026-11-15 before building and before any measurement. Thresholds are the researcher's draft and the director's task; none may move after data.
Instrument: the offline harness only (synthetic backend, built client, Chromium; nothing is asked of the live backend). GFS.
Two arms on the SAME build: A = kill set (hard swap), B = blend on.
**Scrub:** 24 h in 3-hourly steps (8 steps), one step every 600 ms, in each of 10 fixed views:
waves (-158.0, 21.6, z5.0), (-9.5, 39.0, z5.0), (150.0, -34.0, z5.0), (-40.0, 35.0, z2.5), (-140.0, 20.0, z3.0), (20.0, -40.0, z3.5);
swell_1 (-123.0, 37.5, z5.0), (-60.0, 30.0, z3.5); swell_2 (115.0, -10.0, z4.0); wind_waves (-5.0, 50.0, z4.5).
Dark theme, desktop 1280 x 800. 80 hour boundaries per arm.

- **H1 the hour pop.** Every drawn frame of the map canvas is captured around each step. The STEP of a boundary = the largest
  mean absolute change of luminance (Rec. 709, 0-255, over the whole map canvas) between two consecutive drawn frames in the
  800 ms after the step, MINUS the floor = the median of the same measure over the 400 ms before the step (the moving crests).
  Pass: the mean step over all boundaries in arm B is at most **50%** of arm A's, AND no view's mean step is larger in B than in A.
  A view whose arm-A step is below 2 x its floor carries no pop to remove: it is reported and left out of the pooled ratio. If
  more than 3 of the 10 views are left out, the gate is VOID and is registered again on other views before B is looked at.
- **H2 frame time.** GPU time per frame (EXT_disjoint_timer_query_webgl2; if the query is not available, the median interval
  between drawn frames) over the whole scrub. Pass: arm B's median is at most **10%** above arm A's, pooled over the 10 views,
  and separately for the frames inside the blends against arm A's frames in the same windows.
- **H3 served bytes.** After every step in both arms, the engine's wave texture is read back and hashed, together with the
  drawn frame's record (model, layer, hour, valid time, product id). Pass: all 80 hashes and records are identical between A
  and B, and equal to the bytes the frame store / encoder handed over. The blend may change what is drawn for 160 ms and
  nothing else.
- **H4 the end state.** 400 ms after each step (blend over) the blend factor read from the engine is exactly 1 and the earlier
  hour's texture is not sampled. Pass: 80 of 80.
- **H5 no doubled features mid-blend.** With the blend held at 0.5 by the lab override, the drawn frame is compared with the
  frame before the step (f = 0) and after it (f = 1), particles hidden so the colour field alone is scored. EDGES = the number
  of pixels whose Sobel gradient of luminance exceeds 8% of the 99th percentile of the f = 0 frame's gradient. Pass: at every
  boundary EDGES(0.5) <= 1.15 x max(EDGES(0), EDGES(1)), and the pooled mean ratio is <= 1.05. Positive control, run first: the
  average of a frame and the same frame shifted 12 px must FAIL this check (ratio > 1.15); if it does not fail, the check
  cannot see doubling and H5 is void until the instrument is fixed.
  Also read, not gated: the moving crests (particles) counted before, during and after a step, to show they are one set.
- **H6 a fast drag.** The same scrub at one step per 100 ms (steps land inside a running blend). Pass: arm B's mean step
  (H1's measure) is not larger than arm A's. No 50% claim is made for a drag.
- **H7 the off path.** With the kill, and under prefers-reduced-motion, the drawn frames after each step are pixel-identical to
  the build before this change at f = 1, and no second texture is allocated. Unit tests pin the shader source: with the blend
  factor at 1 the earlier hour's sampler is not read.
- If a line fails: the result is recorded as it is; nothing is tuned against the same data without a new dated registration.
  If the plain value mix fails H5, the next candidate (mixing in flow space: each hour's field moved along its own direction
  before the mix) is registered as a separate gate before it is built.
- Reviewed by the advisor before merge. NOT covered by this gate: a real phone, Safari, Firefox, the deployed site, EURO and
  ICON sets, light and beach themes (the blend is before colouring, so the theme does not enter it; one light and one beach
  run are made and reported, not gated).

References read: #912 section 6.2 (the researcher's draft); the Khronos WebGL 2 specification through Context7
(`copyTexSubImage2D` reads the read framebuffer's colour attachment into the bound texture: the GPU copy of the earlier hour);
the Blender manual's Ocean modifier page (its surface is animated by ONE continuous Time value, so a crest moves and is never
cross-faded; that is the visual standard H5 holds the blend to).

## 4. The gate is VOID on the harness's stock data; the data is registered again BEFORE any gate measurement (10:05 EST)
Built first (the code of section 2 and the instrument `frontend/scripts/offline-backend/scn_hour_blend.js`), then ONE shakedown
run of the instrument: view 4 of the list (waves, world, z2.5), arm B only, on the stock synthetic store. What it showed:
- The stock synthetic ocean (`serve_synthetic.py`, `field()`) is the SAME every hour except one slow vortex near 14 N, 106 W and
  the swell_2 pattern. A +3 h step changed the picture by 0.02-0.04 luminance units against a floor of 0.013 (the moving
  crests). 8 of the 10 registered views look at water that does not change at all. By the gate's own rule (a view whose arm-A
  step is below 2 x its floor carries no pop; more than 3 such views void the gate) the gate is void on this data. This is read
  from the generator's code, not from an arm-A run; no arm-A number exists yet.
- The step from the present hour to +3 h changed the engine's grid size in the harness (the resident was reallocated), so it is
  a hard swap by design in both arms (4.3 luminance units in the shakedown). It stays in the count.
- Instrument facts fixed by the shakedown: the GPU timer query is available; frames are drawn at 16.7 ms; the blend started and
  ended on every same-grid step (20 starts, 20 ends, 0 errors); the positive control of H5 FAILS the check as it must (ratio 1.273
  against the 1.15 line), so the check can see doubling.
- Disclosure: this one arm-B view was seen before the re-registration below. Its steps carried no pop, so it says nothing about
  the 50% line either way.

**Registered again, nothing else changed (same 10 views, same thresholds, same arms, same build):**
- Data: the same synthetic backend with a new option, `--moving-swell 0.9`: swell trains of 0.9 m, 14 degrees long, travelling
  0.6 degrees an hour (1.8 degrees per 3 h step) across the whole ocean, so every view's consecutive hours differ. Off by
  default, so no other harness user changes. The void rule still applies to this data.
- Two details of the instrument, fixed here because the first text contradicted itself: (a) a step's window is the 600 ms to
  the next step (the text said 800 ms after a step and one step every 600 ms; the blend is 160 ms, so nothing is cut off);
  for the drag (H6) it is the 100 ms to the next step. (b) H3 compares arm A with arm B (hash of the wave texture read back
  from the GPU after every step, and the drawn record). Arm A is the upload path as it was, so equality with A is equality
  with what was handed over; the handed-over bytes are not hashed a second time on the CPU.
- Every boundary counts in H1, including the ones that are hard swaps by design (a grid change); how many were blended is
  reported beside the result.

## 5. First gate run on the moving-swell data: NOT PASSED, mostly because the instrument was not fit (recorded 10:28 EST)
(Time correction, append-only: section 4's header says 10:05 EST; its commit `3b4b8eb4d` is stamped 09:58:31 EST. The commit is the record.)
Run: arm A 10:00-10:08, arm B 10:08-10:18, then a control, arm A again, 10:18-10:27 (`scn_hour_blend.js`, scored by
`hour_blend_report.js`). As measured, against the gate as registered:
- **H1 VOID.** Views 7-10 (swell_1 x2, swell_2, wind_waves) carried no pop: step 0.007-0.055 against floors 0.009-0.057. Cause,
  found afterwards: the store was built with waves only, so those layers never drew; the engine held waves at hour 0 through the
  whole scrub. 4 of 10 views left out is more than 3, so H1 is void. The six waves views, for the record: pooled step A 7.55 ->
  B 4.88 (65% of A). Inside that: 37 of 48 boundaries were blended, A 6.23 -> B 1.96 (31%); the other 11 were grid swaps
  (the engine alternates between a 46 x 21 world grid and a finer 181 x 83 or regional grid from one step to the next), hard
  swaps by design, with steps of 12-15 in BOTH arms. Those grid swaps are larger than the hour pop itself.
- **H2 FAIL as measured, and the measurement is confounded.** GPU ms per frame, median over views: A 1.95, B 4.10 (+110%).
  Control: arm A run again after B: 3.85, 2.95, 3.61, 4.90, 6.34, 3.99 on the six waves views against B's 3.95, 2.75, 4.11,
  4.50, 5.49, 4.25. So the doubling follows RUN ORDER (the first arm ran on a cold backend and held the coarse grid; warm runs
  hold the finer grid and draw more), not the blend. No statement about the blend's cost can be made from this run.
- **H3 FAIL as measured, same confound.** 64 of 80 hashes equal between A and B. Arm A against arm A (the control): 35 of 48
  equal on the waves views. Which product is resident 420 ms after a step differs from run to run with no change in code, so
  a step-by-step comparison of arms cannot be the test.
- **H4 PASS.** 80 of 80 steps at rest: no blend object, the shader's mix uniform 0.
- **H5 not usable.** Held boundaries: edge ratio worst 1.002, mean 0.879. But the positive control did not trip in every view
  (ratio 0.97-1.46): in textured coastal views 65-80% of all pixels already count as edges at the registered threshold (8% of
  the 99th percentile), so the count is saturated and cannot rise. The check as registered cannot see doubling there.
  Read beside it: the held frame sat 53% of the way from the earlier hour to the new one; particle vertices per frame constant.
- **H6 PASS as measured** (drag: A 4.48, B 3.46), under the same confound as H1.
- A telemetry fault found and fixed (the mix value stayed stale when the earlier-hour texture was freed); it did not enter any gate line.
Nothing in the blend was changed in response to these numbers.

## 6. The instrument, registered again BEFORE it is run (same thresholds, same 10 views, same design under test)
What is wrong is the comparison, so only the comparison changes:
1. **One page, both arms, interleaved.** The kill is read on every step, so each view runs arm A and arm B in the SAME page on
   the same warm backend: for every phase (timing, capture, drag) one scrub with the kill set and one without, A first on even
   views and B first on odd views. A full unmeasured scrub comes first in each view, as before.
2. **The store holds all four layers** (`--layers waves,swell_1,swell_2,wind_waves`, with `--moving-swell 0.9`). A view whose
   drawn record does not name its own layer is an instrument failure and voids the run.
3. **H3 per product.** For every (grid size, valid time) that both arms had resident after a step, the texture hashes must be
   equal; at least 40 such pairs are required. (Which product is resident varies from run to run in arm A alone.)
4. **H5's threshold** is 50% of the 99th percentile of the f = 0 frame's gradient (was 8%, which saturated). A view is scored
   only if ITS positive control exceeds 1.15; fewer than 6 scorable views of 10 voids H5. Pass lines unchanged (1.15, 1.05).
5. **H1 is unchanged**: all boundaries count, grid swaps included; pass = arm B's pooled step at most 50% of arm A's and no view
   worse. The blended-only figure is reported beside it and is not the gate. If H1 fails because of the grid swaps, that is the
   result, and blending across a grid swap is a separate design with its own registration.
6. H2, H4, H6 unchanged, now on interleaved scrubs.

## 7. The registered re-run (10:34-10:47 EST, recorded 10:50 EST): four lines pass, H1 FAILS, H5 is VOID. Nothing tuned.
Instrument as registered in section 6 (commit `c4d672f1a`, before the run). Store: `--layers waves,swell_1,swell_2,wind_waves
--moving-swell 0.9`. Every view drew its own layer in both arms. 80 boundaries per arm, both arms in one page, interleaved.

| view | layer | zoom | A step (hard swap) | B step (blend) | B / A | blended in B |
|---|---|---|---|---|---|---|
| 1 | waves | 5.0 | 13.93 | 10.74 | 0.77 | 4 of 8 |
| 2 | waves | 5.0 | 7.87 | 4.32 | 0.55 | 6 of 8 |
| 3 | waves | 5.0 | 6.44 | 3.75 | 0.58 | 6 of 8 |
| 4 | waves | 2.5 | 10.17 | 6.88 | 0.68 | 4 of 8 |
| 5 | waves | 3.0 | 14.46 | 6.10 | 0.42 | 6 of 8 |
| 6 | waves | 3.5 | 10.18 | 4.39 | 0.43 | 6 of 8 |
| 7 | swell_1 | 5.0 | 5.51 | 3.23 | 0.59 | 6 of 8 |
| 8 | swell_1 | 3.5 | 9.30 | 5.29 | 0.57 | 6 of 8 |
| 9 | swell_2 | 4.0 | 1.72 | 0.68 | 0.40 | 6 of 8 |
| 10 | wind_waves | 4.5 | 1.84 | 0.99 | 0.54 | 6 of 8 |

(Step = luminance units, 0-255, above the floor; floors 0.006-0.029.)
- **H1 FAIL.** Pooled step A 8.14 -> B 4.64: **57.0% of A; the line is 50%.** No view is worse in B. No view left out.
  Why, from the same data: 56 of 80 boundaries were blended, and on those the step fell from 6.24 to 1.24 (**19.9%** of the hard
  swap). The other 24 were GRID SWAPS: the engine changed the grid it holds (a 46 x 21 world grid, a 181 x 83 world grid, a
  regional grid) between one step and the next. The design does not blend those (section 2), and their step is the same in
  both arms: 12.57 against 12.56, twice the hour pop itself. With 30% of boundaries untouched at that size, the pooled figure
  cannot reach 50%. The blended-only figure is NOT the gate and is not offered as a pass.
- **H2 PASS.** GPU ms per frame, median over the 10 views: whole scrub A 3.762, B 3.790 (+0.7%); frames inside the blend
  windows A 3.938, B 3.962 (+0.6%); line +10%. Timer query available. Frame interval 16.7 ms in both arms.
- **H3 PASS.** 80 of 80 (grid, valid time) pairs resident in both arms hold identical wave-texture bytes.
- **H4 PASS.** 80 of 80 steps at rest 420 ms later: no blend object, the shader's mix uniform 0.
- **H5 VOID: the instrument cannot see doubling at all.** With the threshold at 50% of the 99th percentile the positive control
  (a frame averaged with itself moved 12 px) scored 0.39-0.98 in all 10 views, BELOW 1: averaging halves the contrast of every
  edge, so fewer pixels clear the threshold. At 8% (the first run) the count was saturated. Counting edge pixels above a
  threshold is the wrong measure for doubling at either setting. H5 is therefore NOT MEASURED. What can be said without it:
  the blend mixes values before colouring, so one contour moves between its two positions (it is not two contours drawn at
  half strength), and the particles are one set (525,696 or 1,577,088 vertices per frame, constant through every step). That
  is an argument from the design, not a measurement.
- **H6 PASS.** Drag, one step per 100 ms: A 8.12, B 5.41 (66.6% of A).
- **H7:** the unit tests (`marineHourBlend.test.js`, with the three shader pin suites: 106 pass) cover the kill, reduced
  motion, the shader source and the call sites. The pixel-identity check of the off path against the build before this change
  was NOT run.
- Arm B's telemetry over the whole run: 309 blends started, 261 ended, 39 restarted inside a running blend, 0 errors.
- NOT done: the light and beach runs, the phone layout, the whole Jest trees, the lint ratchet, the file-size check, the floor
  fragment, a PR. They wait on the director's decision below.

### What this means, and what is asked of the director
The blend does what it was designed to do on the steps it covers (the pop falls to a fifth, at no measurable GPU cost, with
identical bytes), and the gate as registered is NOT met. Two things stand between this and a pass, and neither is tuning:
1. **Grid swaps during a scrub** are a bigger pop than the hour change and are outside the registered design. Covering them
   means blending two textures on different grids (the earlier hour drawn with its own bounds and its own land flags). That
   is a new design and needs its own registration. Separately: whether production alternates grids like this harness does is
   not known from here (it depends on which products are stored and how fast /grid answers); the harness may overstate it.
2. **A doubling check that works.** Proposal for a new registration: count COLOUR-BAND CROSSINGS along fixed scanlines of the
   colour field (a doubled front crosses each band twice), with the same positive control required to trip first.

## 8. The owner's decision (10:55 EST, in this session: "Yes, extend it") and the second design, registered BEFORE it is built
Asked whether to extend the blend to cover grid swaps under a new registered gate, David answered "Yes, extend it".

### 8a. Design (v2)
- **Grid swaps are blended too.** When a commit replaces the engine's grid with one of another size or bounds (same model, same
  layer, no ratings on either side), the engine keeps the outgoing wave texture and its land-flag texture instead of freeing
  them, with the outgoing grid's bounds, point registration and height scale. For BLEND_MS (160, unchanged) the colour shader
  reads the earlier grid AT ITS OWN PLACE ON THE MAP (its own bounds, its own water-only weights) and mixes the VALUES with the
  new grid's, then colours. Where the earlier grid has no coverage the new one is drawn alone. This covers a swap that also
  changes the hour and a swap inside one hour (the finer grid arriving over the coarse one).
- **Heights are mixed in metres.** A grid's height byte has its own scale (10 m or 16 m per upload); the earlier hour's height
  is rescaled to the new grid's scale before the mix. (This also closes a fault in v1: two hours on one grid with different
  scales would have been mixed as raw bytes. It did not occur in the gate data; v1 was not shipped.)
- Unchanged from v1: no blend under the kill, reduced motion, ratings, a change of model or layer, an exact-mask show; one
  hour at rest with the earlier textures not read; the particles untouched; the kill `__RAW_DISABLE_CREST_HOUR_BLEND__`.
- The kept textures are freed when the blend ends. Cost while a blend runs: one more wave texture and one more flag texture.

### 8b. Gate (v2). Thresholds as before; H5 is replaced because the edge count could not measure doubling.
Instrument and data as registered in section 6 (one page, both arms interleaved, the four-layer moving-swell store, the same
10 views, 80 boundaries per arm).
- **H1** pooled step of arm B at most 50% of arm A's, every boundary counted, no view worse in B. Unchanged.
- **H2** GPU ms per frame at most +10% (whole scrub, and inside the blend windows). Unchanged.
- **H3** identical wave-texture bytes per (grid, valid time) resident in both arms, at least 40 pairs. Unchanged.
- **H4** at rest 420 ms after each step: no blend, the shader's mix uniform 0. Added: no kept earlier-grid texture remains
  (they are freed when the blend ends).
- **H5 (new): contrast kept through the blend.** A cross-fade of two fields whose features have moved loses contrast in the
  middle (two half-strength copies); a field that merely changes does not. With the particles not drawn and the blend held at
  0.5: RETENTION = the standard deviation of luminance of the held frame divided by the smaller of the standard deviations of
  the frame before (f = 0) and after (f = 1). Pass: retention at least **0.85** at every held boundary, and at least 0.92 on
  average. Positive control per view, from real frames: the average of the view's f = 0 frames 12 h apart (the swell trains
  are then in near-opposite phase) must FAIL (retention below 0.85); a view whose control does not fail is not scorable; fewer
  than 6 scorable views of 10 voids H5.
  What H5 can and cannot say, stated before the data: the blend IS a cross-fade of values, so a feature that moves by more
  than its own width between two hours WOULD show twice at half strength for 160 ms. H5 measures how far this data is from
  that. It says nothing about real model runs with fast, narrow features; that needs real frames and is NOT covered here.
- **H6** drag: arm B's mean step not larger than arm A's. Unchanged.
- **H7** off path: unit tests for the kill, reduced motion and the shader source. Unchanged.
- A failed line is recorded as it is. Nothing is tuned against this data without another dated registration.

## 9. The advisor's finding on the gate (11:12 EST, relayed by the director) and two lines added BEFORE they are measured
State when this was written: the v2 run registered in section 8 had been started at 11:08 and was still running; no v2 number
had been seen. That run is scored under section 8 as registered and is disclosed as started before this section.
**The finding, accepted:** H1 cannot fail on its own. Any cross-fade spreads a step over several frames, so the largest
frame-to-frame change falls whatever is drawn in between; and nothing in sections 3-8 compares the blended picture with
what the model actually says for the time in between. H1 measures smoothness, not truth. Two lines are added; no existing
threshold changes.
- **H8 (new): the hidden middle hour.** The store has a real frame every 3 h. For hours h, h+3, h+6: the engine shows h, then
  steps straight to h+6 with the blend HELD at 0.5 (the picture half-way between h and h+6, particles not drawn), and that
  picture is compared with the REAL frame of h+3 drawn at rest, which the blend never saw. ERROR(blend) = mean absolute
  difference of luminance between the held picture and the real h+3 picture. ERROR(cut) = the smaller of the same measure for
  the real h picture and the real h+6 picture against the real h+3 picture (a hard cut shows the nearest hour). Four triples
  per view (h = 0, 3, 6, 9 h from the first step), the same 10 views, same-grid triples only (a triple in which the engine
  changed grid is repeated once, then left out and counted).
  Pass: pooled ERROR(blend) at most **60%** of pooled ERROR(cut), AND no view where the blend's error exceeds the cut's. At
  least 30 of the 40 triples must be scored, or H8 is void.
  Why 60%: for a field that changes evenly the half-way mix is exact (0%); for the moving swell of this store the half-way
  mix of two trains 92 degrees of phase apart keeps 69% of the amplitude at the right phase, an expected error near 40% of the
  cut's. 60% leaves room for the colour ramp's non-linearity and fails a blend that is no better than the nearest hour.
- **H5 (section 8b) stands as the ghosting line**, with its positive control: the plain average of the same view's real
  frames 12 h apart (the trains in near-opposite phase: a cross-fade of a feature that has moved) must FAIL the retention line
  for the view to be scored. Added to H5: retention is ALSO taken for H8's held picture (h against h+6, a 6 h jump, twice the
  motion of a normal step) and reported beside the 3 h figure; it is not gated, because a 6 h jump is not what a step draws.
- What H8 does NOT show: the blend lasts 160 ms at a step and is not a continuous interpolation between hours, so H8 scores
  the mix as an interpolant at its mid-point only; and the store is synthetic. Real model runs are not covered.
- The gate text of sections 8b and 9 is sent to the advisor before H8 is run.

## 10. Five additions from the advisor's review of the gate text, registered BEFORE H8 is run and before any v2 number is read (11:18 EST)
The advisor read sections 8b and 9 (nothing run) and asked for these; none changes an existing threshold. State: the v2 run
of section 8 has finished or is finishing; its output has NOT been opened.
1. **H5 read two-sided, against an exact reference.** The store fixes what a correct value mix must give. For the moving
   train alone: a 3 h step is 46 degrees of phase, so a half-way mix keeps cos(23 deg) = **0.92** of its amplitude; H8's 6 h
   picture keeps cos(46 deg) = **0.69**; the 12 h control keeps |cos(92.6 deg)| = **0.05**. (The whole field also has parts
   that do not move, so a view's figure sits above these; they are the floor for the moving part, written down before data.)
   Because 0.92 is exactly the registered average line, pass or fail by 0.01 would say nothing about the implementation. So:
   for every held same-grid picture a REFERENCE picture is drawn: the exact arithmetic average of the two hours' texture
   bytes, written into the wave texture by the lab and drawn at rest through the unchanged path. The held picture must match
   it: mean absolute luminance difference at most **0.5** (of 255), and its retention within **+-0.03** of the reference's.
   Lower retention than the reference = extra blur or misregistration; higher = the values are not being mixed.
2. **H8 gets a floor.** Pass stays at most 60% of the cut's error; **below 25% the line is VOID** (the held picture is not at
   0.5, or the hidden hour leaked into it). For every triple the valid times of the two textures the shader mixed are recorded
   (the kept one and the resident one): they must be h and h+6, never h+3.
3. **A flat control for H8.** Mean absolute error rewards a washed-out picture. The view's 12 h-apart average (H5's control
   frame, nearly flat in the moving part) is scored against the real h+3 the same way. If that washed-out picture also comes
   in under 60% of the cut, H8 cannot be read alone and its verdict is stated jointly with the retention of the same held
   picture against the real middle hour.
4. **H9 (new): truth for the grid-swap blend.** A grid swap INSIDE one hour (the coarse grid, then the finer grid, same valid
   time), blend held at 0.5, compared with the finer grid's picture at rest. Pass: at every swap the held picture's error
   against the fine picture is no larger than the coarse picture's error against it, and pooled it is **35% to 65%** of the
   coarse picture's error (a correct half-way mix gives about half; a shifted or mis-scaled earlier grid does not). At least 12
   swaps over the 10 views must be scored or H9 is void (the harness decides when a finer grid arrives).
5. **Value space beside luminance.** H8 and H9 are also reported on the decoded values read back from the textures (height in
   metres, direction as mean angular error): the mix of the two hours' values against the real middle hour's values, and the
   nearest hour's. The gate stays on luminance as registered; both are reported.
Not in this run, and owed before the blend is ON by default (the advisor's condition, accepted): **H8 on real frames**, replayed
offline with the middle frame hidden. A synthetic store's answer is fixed by its phase speed.

## 11. The v2 run of section 8's lines (11:08-11:21 EST, recorded 11:25 EST; its output was first opened after section 10 was committed)
Build `f20875f3a`. Both arms interleaved in one page, the four-layer moving-swell store, every view drew its own layer.
| view | layer | zoom | A step (hard swap) | B step (blend) | B / A | blended in B |
|---|---|---|---|---|---|---|
| 1 | waves | 5.0 | 14.14 | 2.87 | 0.20 | 8 of 8 |
| 2 | waves | 5.0 | 7.86 | 1.58 | 0.20 | 8 of 8 |
| 3 | waves | 5.0 | 6.44 | 1.24 | 0.19 | 8 of 8 |
| 4 | waves | 2.5 | 7.29 | 1.28 | 0.18 | 8 of 8 |
| 5 | waves | 3.0 | 11.52 | 2.50 | 0.22 | 8 of 8 |
| 6 | waves | 3.5 | 7.88 | 1.90 | 0.24 | 8 of 8 |
| 7 | swell_1 | 5.0 | 7.51 | 1.85 | 0.25 | 8 of 8 |
| 8 | swell_1 | 3.5 | 15.83 | 4.77 | 0.30 | 8 of 8 |
| 9 | swell_2 | 4.0 | 1.85 | 0.49 | 0.26 | 8 of 8 |
| 10 | wind_waves | 4.5 | 2.60 | 0.56 | 0.22 | 8 of 8 |
- **H1 PASS** as registered: pooled step A 8.29 -> B 1.90, **23.0%** of A (line 50%); no view worse; all 80 boundaries blended
  (142 of arm B's 436 blends over the whole run were grid swaps). Read with section 9: this line measures smoothness only.
- **H2 PASS.** GPU ms per frame, median over views: whole scrub A 4.105, B 4.090 (-0.4%); inside the blend windows A 4.232,
  B 4.374 (+3.4%); line +10%. Per view the two arms differ by -47% to +31% (which grid is resident varies), so the medians
  carry the result and single views do not.
- **H3 PASS.** 80 of 80 (grid, valid time) pairs identical. **H4 PASS.** 80 of 80 at rest, no kept texture.
- **H5 VOID.** The positive control (the average of a view's real pictures 12 h apart) had to fall below 0.85 and did so in 1
  view of 10 (0.82, 0.92, 0.95, 0.94, 0.86, 0.89, 0.94, 0.92, 1.04, 1.00). The standard deviation of whole-frame luminance is
  carried by what does not move (the basemap, land, the still part of the field), so it barely notices the moving trains
  cancelling. The held pictures read 0.95-1.00, which therefore means nothing. Luminance contrast of the whole frame is the
  wrong domain for this check; section 10's exact-reference comparison and the value-space figures replace it in what follows.
- **H6 PASS.** Drag: A 8.28, B 3.44 (41.5%). 0 page errors, 0 blend errors, 436 blends started and 369 ended (66 restarted).

## 12. The truth lines, run 11:28-11:46 EST (recorded 11:48 EST): none passes as registered. Nothing tuned.
Build `e2c6b7ebb`. Instruments `scn_hour_blend_mid.js`, `hour_blend_mid_report.js`. Sent to the advisor first (section 9);
the advisor's five additions registered first (section 10). Every view drew its own layer. 0 page errors.
- **H8 (hidden middle hour): VOID. 22 of 40 triples scored; 30 were required.** 18 triples were left out because the engine's
  grid at rest differed among the frames of the triple (the four coastal zoom-5 views and the swell_2 and wind_waves views
  gave 1 scorable triple each; the world and mid-zoom views gave 4 each). On the 22 scored, for the record and NOT as a pass:
  ERROR(blend) 4.67 against ERROR(cut) 10.20 luminance units = **45.8%** (band: at most 60%, void below 25%); no view where the
  blend is worse than the cut; per view 35-51%, except swell_2 at 2% (its synthetic pattern changes almost evenly in time, so
  the half-way mix is nearly exact there). The two textures mixed were h and h+6 in all 22.
  - Flat control: the 12 h-apart average scored **119.6%** of the cut, so mean absolute error does not reward a washed-out
    picture in this data and H8 could be read alone, had it been valid.
  - Value space, the same 22 triples, from the texture bytes: height error of the mix 0.153 m against the nearest hour's
    0.377 m = **40.5%** (the store predicts about 40%); direction error 0.02 degrees for both (the synthetic direction hardly
    changes); height contrast of the mix against the real middle hour 0.914 on average (minimum 0.907).
- **H5 against the exact reference: FAIL.** 22 held pictures against the exact average of the two hours' bytes drawn at rest.
  Retention agrees (largest difference 0.017; line 0.03; both 1.009 on average). But the mean absolute luminance difference
  is 0.32-0.49 in 19 pictures, 0.51 in one and **0.81** in one (line 0.5; mean 0.40). Two of 22 are over the line. The cause is
  NOT established. Candidates, none tested: the reference's bytes are rounded to whole steps while the shader mixes unrounded
  values, which moves pixels across colour-band edges; or a real difference in how the held picture is drawn. Until one is
  shown, this line stands as failed.
- **H9 (truth for a grid swap): VOID. 0 of 40 scored; 12 were required.** With the kill set, no step in this harness produced
  a coarse grid followed by a finer grid of the SAME hour (38 of 40: no such swap within 4 s; 2: the finer grid came first).
  The grid swaps seen in the scrub runs are swaps that come WITH an hour change, not a sharpening inside one hour. So the
  grid-swap blend, the new part of v2, still has no truth line: it is smooth (section 11, H1) and nothing here shows it is
  registered correctly on the map.

### Where the gate stands after sections 11 and 12
Passed as registered: H1 (smoothness, 23%), H2 (GPU time), H3 (bytes), H4 (at rest), H6 (drag).
Not passed: H5 (void in luminance; its exact-reference form fails by up to 0.31 units in 2 of 22), H8 (void: 22 of 30
triples; 45.8% and 40.5% in value space on those), H9 (void: not measurable this way).
Owed before any PR is called ready, each needing a registration first:
1. H8 with enough valid triples: either world and mid-zoom views only, or triples scored across a grid change.
2. H9 with a FORCED swap: the lab commits a coarser copy of the resident grid and then the fine one, so the test does not
   wait on the harness; plus a shifted-bounds positive control that must fail.
3. The cause of the 0.3-0.8 unit difference from the exact reference.
4. The advisor's condition for ON by default: H8 on real frames replayed offline.
Also not done: the whole Jest trees, lint ratchet, file size, floor fragment, light and beach, the phone layout, LongCat.

## 13. The owner's word (11:53 EST, in this session: "Yes, rerun first") and the three reruns, registered BEFORE they are run
Asked whether to register and rerun the three truth tests before starting wind, David answered "Yes, rerun first".
Thresholds are the ones already registered; what changes is how each test gets valid data.
1. **H8 again, on views that keep one grid.** Section 12 showed that above zoom 3.5 the engine's grid at rest changes from hour
   to hour, so a same-grid triple does not exist there. Ten views at zoom 3.5 or lower, four layers:
   waves (-40.0, 35.0, z2.5), (-140.0, 20.0, z3.0), (20.0, -40.0, z3.5), (150.0, -20.0, z3.0); swell_1 (-60.0, 30.0, z3.5),
   (-150.0, 35.0, z3.0), (60.0, -30.0, z3.5); swell_2 (115.0, -10.0, z3.0), (-30.0, 0.0, z3.0); wind_waves (-5.0, 50.0, z3.5).
   Same lines: pooled ERROR(blend) at most 60% of ERROR(cut), void below 25%, no view worse, at least 30 of 40 triples, the two
   mixed textures h and h+6. The flat control and the value-space figures are reported as before.
   Stated limit: H8 then says nothing about coastal zooms, where a step is a grid change; that case is H9's.
2. **H9 with a FORCED earlier grid.** The harness gives no same-hour swap, so the lab makes one, in each of the same ten views
   and at four hours each (40 swaps): with the fine grid at rest (picture FINE), the lab builds a COARSER copy of the resident
   wave texture (every 2nd to 5th sample on each axis, chosen so the sample extents, and so the bounds, are unchanged), and
   hands it to the blend as the earlier field with those bounds, its own size, its own point registration (-1/n, 0.5/n, the
   formula of gridPointRegistration.js) and the same height scale. Held at 0 the shader draws the coarse field alone (COARSE);
   held at 0.5 it draws the half-way mix (HELD).
   Pass, as registered in section 10: at every swap mean |HELD - FINE| is no larger than mean |COARSE - FINE|, and pooled it is
   35% to 65% of it; at least 12 swaps scored.
   **Positive control, required:** the same HELD picture with the earlier grid's bounds moved one coarse cell east. Its error
   against FINE must exceed the unshifted HELD error by at least 25% in at least 80% of the swaps; otherwise H9 cannot see a
   misregistration and is void.
   Stated limit: this exercises the shader's reading of an earlier grid at its own place. The keeping and freeing of the real
   outgoing texture is exercised by the scrub runs (142 grid swaps, 0 errors, no kept texture at rest) and the unit tests.
3. **The difference from the exact reference: a diagnosis, not a new line.** The 0.5 line of section 10 stands, and the two
   pictures over it stay recorded as failures. To find the cause, three more pictures per held triple: the reference drawn from
   bytes rounded DOWN and from bytes rounded UP (if rounding is the cause, the held picture lies between the two and the two
   differ by about as much as the held picture differs from either), and the same real hour read twice at rest (the noise of
   reading a picture). Reported; no verdict is drawn from it without the advisor.

## 14. The three reruns (11:56-12:11 EST, recorded 12:13 EST): the reference line and H9 PASS; H8 is VOID again, by 3 triples
Build `e2c6b7ebb`, instrument `a569d5a84`, registered in section 13 (`be76d3ed2`). Every view drew its own layer; 0 page errors.
- **H8 VOID: 27 of 40 triples scored, 30 required.** Views 8 (swell_2, -30, 0, z3.0... listed as the first swell_2 view, 115, -10)
  and 10 (wind_waves, -5, 50, z3.5) gave no triple at all and two others lost 5: the engine's grid at rest still changed from
  hour to hour there. On the 27, for the record and NOT as a pass: ERROR(blend) 4.66 against ERROR(cut) 9.98 = **46.7%**
  (first run: 45.8% on 22); no view worse than the cut; per view 43-53% and 26% for swell_2. Flat control 113% of the cut (so
  the measure does not reward a washed-out picture here). Value space: height error 0.139 m against 0.342 m = **40.5%** (the
  first run gave 40.5% too; the store predicts about 40%); height contrast against the real middle hour 0.921.
  Correction of the line above: the two views with no triple were the eighth in the list (swell_2 at 115, -10) and the tenth.
- **H5 against the exact reference: PASS.** 27 held pictures: largest mean absolute luminance difference 0.487 (line 0.5), mean
  0.385; largest retention difference 0.0045 (line 0.03). Section 12's two failures (0.51, 0.81) were in coastal views not in
  this set; they stay on record.
  Diagnosis (section 13.3): the held picture differs from the reference rounded DOWN by 0.384 and from the one rounded UP by
  0.385, and those two references differ from each other by 0.756. The same picture read twice at rest differs by 0.000. So
  the held picture sits half-way between the two roundings: the difference is the size of byte rounding in the lab's
  reference, and the reading itself adds none. This explains the size; it is not a proof that nothing else contributes.
- **H9 PASS (forced earlier grid).** 40 of 40 swaps scored. HELD against FINE 4.47, COARSE against FINE 7.85 = **57.0%** (band
  35% to 65%); per swap 46-64%; in no swap is HELD further from FINE than COARSE. Positive control (the earlier grid moved one
  coarse cell east): error 8.81; at least 25% above the unshifted HELD in **32 of 40** swaps, exactly the 80% required. The 8
  that did not trip are the two swell_2 views, whose synthetic pattern does not vary from west to east at all, so an eastward
  shift cannot change it (shifted and unshifted errors are equal to four digits). Grids: 16 x 6 over 46 x 21, and 46 x 42 over
  181 x 83. FINE read again after the lab: differs by 0.000.
  Limits as registered: this is the shader's reading of an earlier grid at its own place, on a lab-made coarse copy.

## 15. H8 a third time: the view selection rule, registered BEFORE the run
H8 has been void twice for the same reason: not enough views keep one grid at rest. The errors measured so far play no part in
what follows; the selection is by grid stability only, decided before any blend picture of a view is taken.
- Candidates, in this order per layer; waves: (-40, 35, z2.5), (-140, 20, z3.0), (20, -40, z3.5), (150, -20, z3.0), (-100, -30,
  z2.5); swell_1: (-60, 30, z3.5), (-150, 35, z3.0), (60, -30, z3.5), (-20, -20, z2.5); swell_2: (-30, 0, z3.0), (115, -10,
  z2.5), (-150, 0, z2.5), (60, 10, z2.5); wind_waves: (-5, 50, z2.5), (-140, 40, z2.5), (80, -30, z2.5), (-30, 20, z3.0).
- A candidate is USED if, with the kill set, the engine's grid at rest is the same at all 8 hours of the real-frame pass;
  otherwise it is skipped (and listed). Quota: 4 waves, 3 swell_1, 2 swell_2, 1 wind_waves = 10 views, 40 triples.
- H8's lines are unchanged: at most 60% pooled, void below 25%, no view worse, at least 30 triples, mixed textures h and h+6.
- Only H8 is scored from this run. Section 14's reference and H9 results stand and are not run again.

## 16. The advisor's second review (12:20 EST; it read sections 10-13 at `a569d5a84`, before section 14's results existed)
The advisor agreed with the verdicts of rounds 1 and 2 and asked for three things before the reruns of section 13 were run.
The message arrived AFTER those reruns had been run and recorded (section 14) and while section 15's third H8 run was in
progress; that order is stated here and nothing is back-dated. What is accepted, and when it is registered:
1. **H8c, the common case: accepted, registered now, not yet run.** Above zoom 3.5 the grid at rest changes from hour to hour,
   so at coastal zooms, where surfers look, nearly every step is a grid-change blend; neither H8 on low-zoom views nor the
   forced H9 tests an HOUR change that comes WITH a grid change against truth. H8c: the ORIGINAL ten views of section 3 (six
   of them at zoom 4.0 to 5.0), four triples each, scored REGARDLESS of grid, luminance only: the held half-way picture of h
   and h+6 against the real h+3 picture at rest, whatever grid drew each. Same lines as H8: pooled at most 60% of the cut,
   void below 25%, no view worse than the cut, at least 30 of 40 triples; a triple still needs the two mixed fields to be h
   and h+6 and one blend. The flat control is reported the same way, and the grids each triple used are listed.
2. **H9's signal floor: accepted, applied after the fact, and said to be so.** The rule: a swap is scored only if mean
   |COARSE - FINE| is at least 3 luminance units. H9 had already been run (section 14) when this arrived. Applied to that run
   as it stands: 34 of 40 swaps clear the floor (the six that do not are swell_2 swaps, 0.16-0.33); on the 34, HELD is 57% of
   COARSE pooled, never above it, and the shifted control trips in 32 of 34. Because the floor was applied after the data,
   section 14's unfiltered result (40 swaps, 32 of 40) remains the registered one; the filtered figures are a reading.
   The land flags, as asked: the lab's coarse copy carries NONE. Water-only weighting is opt-in in this build
   (`__RAW_ENABLE_LAND_AWARE_FETCH__`, default off), so both grids are fetched plainly and H9 did NOT test water-only
   weighting at the coast. That part of the blend is untested against truth.
3. **A grey-ramp picture for the reference difference: accepted, registered now, not yet run.** The held picture and the exact
   reference are both drawn with the colour table replaced by the raw height value as grey (a debug view added to the colour
   shader for this, `window.__GPU_DEBUG__.mode = 'value'`), so no colour-band edge can move a pixel. Reading: if the two then
   agree to within 0.15 luminance units on average, the 0.3-0.8 difference of sections 12 and 14 belongs to band edges and
   rounding; a larger remaining difference is a real drawing difference and is reported as one. Twelve pictures, the first
   three one-grid waves views of section 15.
Still owed before ON by default: H8 on real frames from the public CDN, replayed offline.

## 17. The advisor's third review (12:23 EST; it read sections 14-15) and what is registered from it, BEFORE the next runs
The advisor's reading, accepted: the blend is shown to do correct arithmetic on low-zoom, world-grid steps; it is not shown
at coastal zooms, where one failure is still unexplained; not ready for default ON. Its four points:
1. **The reference line at the coast stands FAILED, cause unknown.** Section 14's pass was on views at zoom 3.5 or lower; the
   two failures (0.51, 0.81) were coastal. Rounding explains about 0.38, not 0.81. Registered: the coastal views
   (-158.0, 21.6, z5.0), (150.0, -34.0, z5.0), (-9.5, 39.0, z5.0) are taken again with the rounded-down and rounded-up
   references, and in the grey view of section 16.3, together with the three low-zoom waves views. Line (colour): 0.5 as before.
   Reading (grey): agreement within 0.15 on average means band edges and rounding; more is a real drawing difference.
2. **H9 again, in the grey (value) view, on those six views.** The control moves the earlier grid one coarse cell east AND one
   north (an eastward shift alone had no power where the field does not vary west to east). The coarse copy is made by
   resampling the resident field to about a third of its resolution on the same sample extents (bilinear), so regional grids
   of any size can be used, not only world grids. Four hours per view, 24 swaps.
   Pass: HELD against FINE pooled **45% to 55%** of COARSE against FINE (in the value view a correct half-way mix gives 50%), in
   no swap above it; the control at least 25% above the unshifted HELD in at least 80% of the swaps; a swap is scored only if
   COARSE against FINE is at least 1.0 grey unit; at least 12 swaps scored or void.
   Still not covered: water-only weighting (off by default in this build).
3. H8 on low-zoom views has been seen twice (46-47% in luminance, 40.5% in metres); a third run "adds a tick, not information".
   Section 15's run was already under way when this arrived. It is recorded as it ends and no weight is put on it.
4. **H8c** (section 16.1) is the informative test and runs next.

## 18. Section 15's third H8 run (12:16-12:27 EST, recorded 12:30 EST): VOID, 2 triples
Of 17 candidate views 16 were skipped by the registered rule: with the kill set, the engine held the 46 x 21 grid at some of
the 8 hours and the 181 x 83 grid at others. The one view used gave 2 triples (53% and 49% of the cut). The same views held
one grid through section 14's run an hour earlier, so which grid is at rest 600 ms after a step differs from run to run in
this harness. A same-grid H8 cannot be made to hold still here; no weight is put on this run, as the advisor said beforehand.

## 19. The advisor on section 18 (12:41 EST), and what is added. H8c (section 16.1) had been running since 12:31 when this arrived.
1. **The skipped views of section 15's run, as owed** (layer@lng,lat,zoom: the grids seen at rest over the 8 hours):
   waves@-140,20,z3:46x21/181x83; waves@20,-40,z3.5:46x21/181x83; waves@150,-20,z3:46x21/181x83; waves@-100,-30,z2.5:46x21/181x83; swell_1@-60,30,z3.5:181x83/46x21; swell_1@-150,35,z3:181x83/46x21; swell_1@60,-30,z3.5:181x83/46x21; swell_1@-20,-20,z2.5:181x83/46x21; swell_2@-30,0,z3:46x21/181x83; swell_2@115,-10,z2.5:46x21/181x83; swell_2@-150,0,z2.5:46x21/181x83; swell_2@60,10,z2.5:46x21/181x83; wind_waves@-5,50,z2.5:181x83/46x21; wind_waves@-140,40,z2.5:181x83/46x21; wind_waves@80,-30,z2.5:181x83/46x21; wind_waves@-30,20,z3:181x83/46x21.
2. **Stated plainly: H8 has been void three times** (22, 27 and 2 triples against 30). The claim that the blend is right on
   same-grid steps rests on the exact reference (section 14, low zoom) and the forced H9, NOT on H8. The 46-47% readings come
   from void runs.
3. **Which grid is at rest 600 ms after a step differs from run to run on the same views.** Whether this is the harness (settle
   time, the mock backend's latency) or the engine is NOT known. If the engine does it in the app, a user sees the grid change
   at rest, which would be a defect of its own and not the blend's. It is owed an answer and is listed as a follow-up.
   Registered for a REPEAT of H8c (the run in progress cannot be changed and is scored as section 16.1 registered it): the real
   h+3 picture is taken twice per triple, before and after the held picture; their difference is the noise floor, reported with
   the grid each used; a triple whose two truth pictures differ by more than the gap between the cut's and the blend's errors is
   listed and not scored.
4. **Reading rule for H8c, fixed before its result is opened:** the pooled result is also reported split into triples with the
   same grid on all three real pictures and triples with mixed grids (the scorer committed in `1c1a13f28`, before the run,
   prints this split). A pass that comes only from the mixed-grid triples is not a pass: both parts must be at most 60%.
Standing, as the advisor has it: not ready for default ON. Owed: H8c, the coastal reference retake, the grey-view H9 with the
two-axis control, H8 on real frames, water-only weighting.

## 20. H8c and the grey-view runs (12:31-12:50 EST, recorded 12:53 EST). H8c FAILS as registered. Grey-view H9 PASSES. Nothing tuned.
Build `1c1a13f28`. Registered in sections 16, 17 and 19 (reading rule fixed before the results were opened). 0 page errors.

### H8c, the coastal case, scored regardless of grid: FAIL
40 of 40 triples scored. ERROR(blend) 5.24 against ERROR(cut) 7.80 luminance units = **67.1%** (line 60%). The blend is worse
than the hard cut in 4 views (the three coastal waves views and wind_waves: 125%, 108%, 101%, 142%). By section 19's rule both
parts must be at most 60%:
| part | triples | blend / cut |
|---|---|---|
| the same grid in all five places (three real pictures, two fields mixed) | 25 | **45.4%** (zoom 4 and above: 40.4% on 9; below: 46.7% on 16) |
| a grid differs somewhere | 15 | **152.3%** |
| of those: the three REAL pictures share a grid, but the blend mixed a field on another grid | 10 | 170.5% |
What the 15 show, and what they do not: in 10 of them the real pictures of h, h+3 and h+6 were all drawn on one grid (the
46 x 21 world grid) while, in the held pass minutes later, the engine was holding hour h on a DIFFERENT grid (a regional
24 x 21, 25 x 20 or 30 x 21 grid, or the 181 x 83 one). The held picture then mixes a fine regional field with a coarse world
field and is compared with a coarse truth picture; the difference between a regional and a world picture of the same hour is
in the error. The instrument cannot separate that from an error of the blend: the noise floor the advisor asked for (the
truth picture taken twice, with its grid) was registered in section 19 but is not in this run. So: **the blend is NOT shown
to be right on a step that changes grid, and by the registered rule H8c fails.** The flat control scored 130% of the cut.
Value space on the 35 triples whose texture sizes allowed it: 0.143 m against 0.353 m = 40.6%.

### The reference at the coast (section 17.1)
- Colour view (H8c run), triples with the same grid in all five places: 25 pictures, mean difference 0.394, largest **0.638**
  (line 0.5); 2 of the 9 coastal ones are over the line (0.638, 0.508), none of the 16 low-zoom ones (largest 0.488). Reading
  the same picture twice: 0.000. The held picture is 0.397 from the reference rounded down and 0.394 from the one rounded up,
  and those two are 0.778 apart: half-way between, as in section 14. The 0.81 of section 12 did not recur on a same-grid triple.
- Where the grids differ (9 pictures) the reference is not a reference: it averages bytes of grids the blend did not mix
  (mean 5.1, largest 11.9). Those pictures say nothing about the blend and are excluded from the line.
- Grey view (the registered diagnosis), same-grid triples: 15 pictures, mean **0.278**, largest 0.321 grey units; 0.278 from each
  rounding, the two roundings 0.556 apart. By the reading registered in section 16.3 (within 0.15 = band edges and rounding;
  more = a real drawing difference) this is OVER 0.15. But that reading was badly set: the grey view removes colour-band edges,
  not the rounding of the reference's bytes, and the held picture again sits exactly half-way between the two roundings. What
  the evidence supports: the difference is the reference's own rounding. What it does not do: meet the number I registered.
  The colour line (0.5) stands failed at the coast by up to 0.14 units in 2 of 9 pictures.
- In the grey run one coastal picture read twice at rest differed by 11.4 units: the engine changed what it drew between two
  reads with nothing asked of it. That is the grid-at-rest instability of section 19 seen directly.

### H9 in the value view, with the two-axis control (section 17.2): PASS
23 of 24 forced swaps scored (one left out: the engine changed grid during it). HELD against FINE 3.124, COARSE against FINE
6.251 grey units = **50.0%** (band 45% to 55%), and 50% in every single swap; in no swap is HELD further from FINE than COARSE.
The control (the earlier grid moved one coarse cell east and one north): 10.93, at least 25% above the unshifted HELD in 23 of
23. Grids: 9 x 8 over 24 x 21, 9 x 7 over 25 x 20 (regional), 16 x 8 over 46 x 21, 61 x 28 over 181 x 83.
So the shader reads an earlier grid at its own place correctly, regional grids included, and a one-cell misplacement is seen.

### Where the marine hour blend stands
| line | state |
|---|---|
| H1 smoothness, H2 GPU time, H3 bytes, H4 at rest, H6 drag | pass (section 11) |
| H9 an earlier grid at its own place (forced; value view, two-axis control) | pass |
| exact reference, low zoom | pass (largest 0.488 of 0.5) |
| exact reference, coast, same-grid triples | FAIL in 2 of 9 (0.638, 0.508); the evidence points to rounding, the line is not met |
| H8 hidden middle hour, same grid | void three times; 40-47% on every same-grid subset measured (22, 27, 25, 15 triples) |
| H8c hidden middle hour at the coast, any grid | FAIL: 67.1% pooled, 152% where a grid differs |
| water-only weighting; real frames | not tested |
**Not ready for a PR, and not ready to be ON.** What blocks it is no longer the blend's arithmetic, which every same-grid and
forced test agrees on. It is that the engine holds different grids for the same hour and view from one pass to the next, so
at the coast neither the truth picture nor the blend's inputs hold still. Owed next, in this order:
1. Find out whether the grid at rest changing by itself is the harness (settle time, the mock backend) or the engine. If it is
   the engine, it is a user-visible defect on its own and should be fixed before any blend is judged at the coast.
2. H8c again with the truth picture taken twice and its grid recorded (registered in section 19).
3. H8 on real frames replayed offline.

## 21. Why the grid "at rest" differed from run to run: measured (13:04 EST). It is the two-stage draw plus the cache, not a fault.
Asked by the advisor (section 19.3) and by David in this session ("Yes, investigate"). Instrument:
`frontend/scripts/offline-backend/scn_grid_at_rest.js` (blend killed; after each +3 h step the engine's grid is sampled every
40 ms for 8 s, beside the /api/weather requests of that window; the same hours stepped through twice). Three views.
| view | FIRST visit to an hour | SECOND visit (same session) |
|---|---|---|
| waves, coast, z5.0 | the 46 x 21 world grid at 41-48 ms, then the regional 24 x 21 grid at 2.2-2.7 s | the 24 x 21 grid at 40-49 ms; no request |
| waves, world, z2.5 | 46 x 21 at 43-48 ms, then 181 x 83 at 1.4-3.3 s | 181 x 83 at 53-57 ms; no request |
| wind_waves, coast, z4.5 | 46 x 21 at 41-47 ms, then the regional 30 x 21 at 1.6-4.2 s | 30 x 21 at 46-52 ms; no request |
- On a first visit the engine draws the coarse world grid at once and replaces it with the finer grid when that grid's own
  request returns. The request is SENT about 1.5 s after the step (0.4-1.6 s) and takes 0.4-3.3 s on the offline backend.
  On a later visit the finer grid is in the client's cache and is drawn at once.
- In no case did the grid go back from fine to coarse by itself, and nothing changed after the fine grid arrived.
- So the "grid at rest 600 ms after a step" of sections 12-20 was the coarse stand-in on a first visit and the cached fine grid
  on a later one. The instruments' warm-up pass stepped every 700 ms, too fast for the fine grid of each hour to arrive, so
  which hours were cached depended on timing. That is the whole of the run-to-run difference. It is a fault of the
  instruments' waiting times, not of the engine and not of the blend.
- What a user gets: the first time through, every step shows the coarse grid for about 1.5 to 4 s and then sharpens. That
  sharpening is a grid swap inside one hour, which the v2 blend covers. Whether about 1.5 s before the request is even sent is
  intended is NOT examined here (it is outside this lane); it is listed as a follow-up for the director.
- Consequence for section 20: its "a grid differs somewhere" triples (152%) compared pictures taken in different cache
  states. They do not show a blend error. They do not show the blend right either.

## 22. H8c again, with the cache settled: registered BEFORE the run
- The same ten views as H8c (section 16.1). In each view every hour used is first visited with **5 s** of settling per step,
  so each hour's fine grid is cached; then, as before, the real pictures (now 900 ms after a step that lands on the cached
  fine grid) and the held pictures.
- **The truth picture twice** (section 19.3a): after each held picture the engine returns to hour h+3 and its picture is read
  again; the difference from the first reading is the triple's noise floor, recorded with its grid. A triple whose noise
  floor exceeds the gap between the cut's and the blend's errors is listed and not scored.
- Lines unchanged: pooled ERROR(blend) at most **60%** of ERROR(cut), void below 25%, no view worse than the cut, at least 30
  of 40 triples scored, the two mixed fields h and h+6; reported split into same-grid and mixed-grid triples, both of which
  must be at most 60% (if the cache is settled no mixed-grid triple is expected; any that occur are listed).
- The reference comparison is taken again on the same triples (line 0.5 in colour, as before).
- Not covered, stated before the run: the FIRST-visit step (fine grid of hour h to the coarse stand-in of hour h+3). There is no
  truth picture for a mix of a fine field and a coarse stand-in of another hour other than the forced test H9, which passed.

## 23. The advisor on sections 19-22 (13:24 EST). Section 22's run had been going since 13:06 and its result is NOT opened yet.
The advisor's verdict, accepted: H8c stands FAILED; section 21 is a credible measured cause, post hoc, three views, offline
latency, and it does not turn the 152% into a pass; the "40-47%" figures are subsets of void or failed runs and stay labelled
so. Section 22 as registered covers only REPEAT visits. Registered now, for runs after the one in progress:
1. **H8f, the FIRST visit: what every user sees the first time they scrub, and the case that scored 152-170%.** The cache state
   is controllable (section 21), so there IS a fair test. Per triple: hours h and h+3 are settled on their fine grid; h+6 has
   not been visited. Truth = the fine h+3 picture at rest, read twice (before and after). The engine shows fine h, then steps
   straight to h+6 with the blend held at 0.5: the held picture mixes the fine field of h with the COARSE STAND-IN of h+6, as a
   first-time scrub does. Still inside the stand-in's lifetime, the blend is then held at 1 to read the stand-in alone.
   ERROR(blend) = held against truth. ERROR(cut) = the smaller of fine h against truth and the stand-in of h+6 against truth
   (what a hard cut shows). A triple is scored only if the resident was still the stand-in when both pictures were read.
   Lines as H8c: pooled at most **60%**, void below 25%, no view worse than the cut, at least 30 of 40 triples, noise-floor rule.
   If it fails, the honest product answer may be: blend only when both fields are on the same grid, cut otherwise. That
   would be a change of design with its own registration.
2. **A rounding-proof reference line, in the grey view.** (One correction for the record: the lab's reference averages the two
   hours' BYTES and draws them through the same shader; it does not average colours. The advisor's remedy stands all the
   same.) Per pixel, the held picture's grey value must lie inside the bracket made by the reference rounded down and the
   reference rounded up, widened by one grey level for the 8-bit read-back. Line: at most **1%** of pixels outside, in every
   same-grid held picture. 0.638 and 0.508 stay on record as failed against the old 0.5 line.
3. **Settling on a condition, not a fixed time**: an hour counts as settled when the engine's grid has not changed for 1.5 s and
   at least 2 s have passed since the step (10 s limit; an hour that does not settle is listed).
4. **What the flat control should score, said before more data:** the 12 h-apart average has the moving trains nearly cancelled.
   Against the real middle hour its error is about the train's full amplitude, while the nearest hour is off by 46 degrees of
   phase, 2 sin(23 deg) = 0.78 of the amplitude. So the flat picture should score about **128%** of the cut. Section 20's 130%
   and section 14's 113-120% are that: a washed-out picture is WORSE than a hard cut by this measure here, so the measure
   does not reward blur and H8-type results can be read alone.
5. Passed to the director by the advisor: the fine grid's request goes out about 1.5 s after a step.

## 24. Section 22's run (13:06-13:27 EST) and three diagnoses of the reference difference (recorded 13:50 EST). Nothing tuned.
### H8c with the cache settled: the hidden-middle-hour line PASSES as registered; the reference line FAILS on regional grids
Build `1c1a13f28`, instrument `fc1b32bef`, registered in section 22. Section 23's additions (H8f, the bracket line,
condition-based settling) arrived during this run and are not in it. Every view drew its own layer; 0 page errors.
- **H8 (coastal views, settled cache): PASS.** 40 of 40 triples. ERROR(blend) 5.57 against ERROR(cut) 11.82 luminance units =
  **47.1%** (line 60%, floor 25%); no view worse than the cut (per view 42, 51, 49, 51, 43, 43, 47, 49, 14, 77%). The same grid
  in all five places in all 40 (regional 24 x 21, 25 x 20, 24 x 20, 30 x 21 at the coast; 181 x 83 elsewhere), so the
  mixed-grid part is empty. The truth picture read twice: difference 0.000 in all 40. The two fields mixed were h and h+6.
  Flat control 122% of the cut (section 23.4 expected about 128%). Value space: 0.139 m against 0.344 m = 40.5%.
  This is the REPEAT-visit case only (section 23.1).
- **Reference line: FAIL.** 40 held pictures: the 20 on the world grid differ from the exact reference by 0.23-0.49 (as
  before); the 20 on REGIONAL grids by **2.2 to 4.7**, with the held picture's contrast 4-10% below the reference's.

### Why regional grids differ from the reference: three diagnoses, each a measurement
1. **The earlier field is read at exactly the right place.** The lab gave the blend an exact copy of the CURRENT field as the
   earlier one (16 cases: regional 24 x 21 and 25 x 20, and 181 x 83). Held at 0 and at 0.5 the picture is the picture at
   rest: difference **0.000** in all 16. Moved one cell: 7.8-16.3. A mix of a field with itself can only reproduce the
   picture if bounds, registration and sampling are exact, so this is a zero-tolerance registration check, stronger than H9
   (whose 50% is guaranteed by the arithmetic wherever the earlier grid is placed; noted here against section 20).
2. **The shader mixes exactly the bytes the reference averages.** Read back during 8 held pictures on two coastal views: the
   kept texture against hour h's bytes, 0 bytes differ; the resident against hour h+6's, 0 differ; height scale 10 for both;
   bounds and size identical.
3. **A 6-hour jump itself draws a regional grid differently for a while, with the blend KILLED.** Four cases, coastal waves
   view, 24 x 21: after the jump the picture differs from the SAME hour at rest by **4.08-4.11** at 250 ms and at 900 ms, and
   by **0.000** at 2.5 s and 5 s. Same grid, same valid time, no blend. The held pictures were read 900 ms after such a jump
   and the reference pictures seconds later, so the reference comparison at the coast was comparing a picture inside this
   transient with one after it. That is the size of the difference (4.4-4.7 against 4.1 plus rounding).
   What is still in the picture during those 2.5 s is NOT identified (the wave texture is the new hour's; something else the
   colour pass draws lags). It is the engine's, it exists without this change, and a user who scrubs several hours at once
   at a coastal zoom sees a late correction of about 4 luminance units. Follow-up for the director; not fixed here.
Consequence: section 20's and this section's reference failures on regional grids are an instrument fault (the held picture
was read too early), and H8's coastal figures above carry the same transient inside the blend's error, which counts AGAINST
the blend, not for it.

## 25. Registered BEFORE the next three runs
1. **The held picture is read 3 s after the jump** (the blend stays held), past the transient of section 24.3; everything else
   as section 22 (cache settled by the condition of section 23.3, the truth picture twice). Scored: H8 again (same lines), the
   reference line (0.5, colour, same-grid pictures), and, in the grey view on the six views of section 17, the bracket line of
   section 23.2 (at most 1% of pixels outside, every same-grid held picture).
2. **H8f** as registered in section 23.1, unchanged. Its two pictures are read inside the stand-in's lifetime (within about
   0.3 s of the jump) and so inside the transient, both of them alike.
3. The self-mix check of section 24.1 is kept as a standing line: difference at most 0.01 in every case.

## 26. The advisor on the settle condition (13:56 EST): fixed BEFORE the runs of section 25 (they were stopped a minute in and restarted)
- Section 23.3's condition (grid unchanged for 1.5 s and at least 2 s since the step) is true at 2.0 s on a first visit while
  the coarse stand-in is still showing. Corrected: an hour is settled when the engine's grid is NOT the stand-in's (46 x 21)
  and has not changed for 1.5 s; 10 s limit; an hour that does not settle is listed.
- The bracket line is also reported WITHOUT the one-level widening, so the widening is seen not to carry a pass.
- H8f records the grid of all four pictures per triple.
- The flat control's expected 128% (section 23.4) was derived AFTER 130% had been seen: it is post hoc and labelled so.

## 27. The advisor on section 24 (13:58 EST): PASS WITH LIMITS, repeat visits only. What is answered from data in hand, and what is registered for the runs now in progress (restarted 13:57, results not opened)
1. **Are the truth and cut pictures inside the transient?** The advisor's point: truth read twice at the same delay proves
   nothing, because both readings would share a transient. Evidence already recorded, for what it covers: in section 24.3 the
   6-hour jump's picture was compared with the picture of the SAME hour taken in the real pass, 600 ms after a +3 h step. At
   2.5 s and at 5 s after the jump the difference was 0.000 in all four cases. A picture taken 600 ms after a +3 h step is
   therefore identical to that hour seconds after everything has stopped: the +3 h step pictures (truth and cut) were OUTSIDE
   the transient, and the held picture alone was inside it. So in section 24 the transient was in the blend's error only, and
   47.1% does not flatter the blend. Limits: four cases, one view (waves, coast, 24 x 21).
   Registered for the run in progress: its "the hour at rest ... against the first reading of it" figure now compares every
   triple's h+6 picture read 600 ms after a +3 h step with the same hour read more than 4 s after the jump, on all ten views.
   If that is not 0 on a view, that view's truth or cut pictures carry a transient and the view's result is not quoted.
2. **The run in progress** reads the held picture 3 s after the jump and settles by section 26's corrected rule.
3. **How H8f will be read, written before it runs.** Its held and stand-in pictures are read about 0.3 s after a 6-hour jump,
   inside the window in which section 24.3 saw the transient on a regional grid; its truth and its fine-h cut picture are
   outside. Whether the transient exists when the resident is the stand-in is not known. So: a PASS is a pass with the
   transient counted against the blend (it can only raise the blend's error). A FAIL does not show the blend wrong until the
   transient is identified or measured in that state; it will be recorded as "fails, cause not separated from the transient".
4. **Scope of the transient, for the director:** seen on a 6-hour jump (six one-hour key steps in one task) at one coastal view
   on a regional 24 x 21 grid, four cases: about 4.1 luminance units at 250 ms and 900 ms, 0 at 2.5 s. NOT seen 600 ms after a
   +3 h step (same four cases). One-hour steps, other views and the world grids are not measured. What lags is not identified
   (the held picture's contrast was 4-10% low; a late range or scale value is one guess, untested).
5. The two per-view extremes of section 24: 14% is swell_2 at (115, -10, z4.0), whose synthetic pattern changes almost evenly
   in time; 77% is wind_waves at (-5, 50, z4.5).

## 28. The three runs of section 25 (13:57-14:45 EST, recorded 14:47 EST). Repeat visits pass; the first visit does not. Nothing tuned.
Build `1c1a13f28`, instrument `c3fa7d8bf`. Registered in sections 23, 25, 26, 27. 0 page errors in all three.

### 1. Coastal views, cache settled, held picture read 3 s after the jump (colour view)
- **H8 PASS.** 40 of 40 triples; ERROR(blend) 5.48 against ERROR(cut) 11.81 = **46.4%** (line 60%, floor 25%); no view worse than
  the cut; per view 46, 47, 50, 51, 43, 43, 46, 49, 14, 47%. One grid in all five places in all 40. Value space 40.5%.
  The wind_waves view that read 77% in section 24 reads 47% now: that 77% was the jump's transient in the held picture.
- **The truth and cut pictures are clean on all ten views** (section 27.1): each h+6 picture read 600 ms after a +3 h step
  against the same hour read more than 4 s after the jump: **0.000** in all 40. The truth read twice: 0.000.
- **Reference line (0.5, colour): FAIL on one picture.** Regional grids now read 0.29-0.40 like the world grids (so sections 20
  and 24 were the transient), but one picture in the coastal waves view (-158, 21.6) reads **0.795**; mean 0.385; retention
  agrees to 0.017. This is the view that gave 0.81 in section 12.
- Bracket, colour view (not the registered view): 0.1% of pixels outside with the one-level widening, up to **9.4%** without.
  In the colour view the widening carries it, as the advisor warned.

### 2. The grey (value) view, six views, 24 held pictures: the registered rounding-proof line
- **BRACKET PASS.** The share of pixels whose value lies outside [reference rounded down, reference rounded up]: **0.00%** in all
  24 pictures, WITH the one-level widening and WITHOUT it. Regional grids included (24 x 21, 25 x 20), and the coastal view
  that fails the colour line included.
- Reference difference in the grey view: 0.25-0.35 (largest 0.349; the old line 0.5 is met here); 0.284 from each rounding, the
  two roundings 0.568 apart.
- So at every pixel the value the shader draws lies between the two roundings of the exact average: the mix is the exact
  average. The one colour picture at 0.795 is where the colour table turns that sub-step difference into a larger luminance
  difference. The colour line as registered is failed by that picture; the value line registered to replace it is passed.

### 3. H8f, the FIRST visit: VOID (15 of 40 triples; 30 required), and not good where it could be scored
- 25 triples were not scorable: in the world and mid-zoom views the jump landed on the fine grid directly (no stand-in was
  showing when the pictures were read), and in two coastal views the stand-in state did not meet every condition of the rule.
  Which grids each triple used is in the run's record.
- On the 15 scored (waves at -158; swell_1 at -123; swell_2; wind_waves), NOT as a result: ERROR(blend) 6.51 against
  ERROR(cut) 7.22 = **90.1%**; the blend is WORSE than the hard cut in two views (swell_2 141%, wind_waves 110%), 85% and 91%
  in the other two. Pooled, fine h alone is 7.51 from the truth and the stand-in of h+6 alone 9.73; the half-way mix, 6.51,
  is better than either alone on average but not better than the nearer of the two in each triple.
- Read as registered in section 27.3: void; and the scored part shows no truth gain from mixing a fine field with the coarse
  stand-in of another hour. The transient may be in those figures (not separated).

### Standing after section 28
| line | state |
|---|---|
| H1 smoothness (23%), H2 GPU time, H3 bytes, H4 at rest, H6 drag | pass (section 11) |
| self-mix: the earlier field at its own place, exact | pass, 0.000 in 16 cases (section 24.1) |
| H8 hidden middle hour, REPEAT visits, coastal and world | pass twice as registered: 47.1%, 46.4%; truth and cut pictures clean |
| value line (bracket, grey view) | pass, 0.00% of pixels outside |
| colour reference line (0.5) | failed by one picture (0.795); explained by the value line, not met |
| H8f, FIRST visit (fine field mixed with the coarse stand-in of another hour) | void; 90% where scored; worse than a cut in 2 of 4 views |
| water-only weighting; real frames | not tested |
**Not ready for a PR.** The same-grid blend is shown correct and truthful. The blend of a fine field with the stand-in of
ANOTHER hour is smooth and shows no truth gain. The advisor's product answer applies: decide whether to blend only where both
fields are true to their own hour on comparable grids (the same grid; and the stand-in sharpening into the fine grid of the
SAME hour) and cut on a step that changes hour and grid together. That is a change of design and needs the owner's word and
its own registration.

## 29. The advisor on section 28 (14:53 EST): a correction to the first-visit baseline, and H8f registered again BEFORE it is run
The advisor accepts the repeat-visit pass and the value bracket, keeps the colour line failed on its one picture, and corrects
its own earlier advice on H8f, which this log had followed:
- **ERROR(cut) as the SMALLER of "fine h" and "the stand-in of h+6" is an oracle no hard cut can be.** A real hard cut on a first
  visit shows the stand-in of the new hour. Section 28.3's scored part, with both baselines (15 triples, a void run):
  | view | held mix | real cut (stand-in of h+6) | fine h | mix / real cut | mix / oracle |
  |---|---|---|---|---|---|
  | waves (-158, 21.6, z5.0) | 17.16 | 24.55 | 20.25 | 70% | 85% |
  | swell_1 (-123, 37.5, z5.0) | 8.04 | 13.11 | 8.84 | 61% | 91% |
  | swell_2 (115, -10, z4.0) | 0.66 | 0.47 | 1.57 | 141% | 141% |
  | wind_waves (-5, 50, z4.5) | 2.83 | 4.49 | 2.58 | 63% | 110% |
  | pooled | 6.51 | 9.73 | 7.51 | **67%** | 90% |
  So "worse than a cut in 2 of 4 views" (section 28.3) holds against the oracle only. Against what a cut actually displays the
  mix is closer to the truth in three of the four views and further in one (swell_2, where the stand-in happens to sit within
  half a unit of the truth). The run is void either way.
- **Consequence for what was put to the owner:** the recommendation to narrow the design (cut when hour and grid change
  together) rested on the oracle baseline. On this evidence the narrowing is NOT forced; it is an option. That is said to the
  owner in this session at once.
- The two coastal views rejected in section 28.3: when the pictures were read, 250 ms after the six key steps, the engine had
  reached only h+3 (it was showing the stand-in of the hidden hour). The rule rejected them correctly; the reading was too early.

### H8f again: registered before the run
- Views: only where a stand-in appears (zoom 4 and above). waves (-158.0, 21.6, z5.0), (-9.5, 39.0, z5.0), (150.0, -34.0, z5.0),
  (-122.0, 36.0, z5.0), (115.0, -9.0, z5.0); swell_1 (-123.0, 37.5, z5.0), (-70.0, 40.0, z5.0), (18.0, -35.0, z5.0); swell_2
  (115.0, -10.0, z4.0); wind_waves (-5.0, 50.0, z4.5). Four triples each.
- The held and stand-in pictures are read as soon as the engine shows the stand-in of h+6 (polled, up to 1.2 s after the key
  steps), not at a fixed 250 ms. Everything else as section 23.1 (h and h+3 settled on the fine grid by section 26's rule,
  truth read twice, a triple scored only while the stand-in is resident for both pictures).
- **The baseline that DECIDES is the real cut: the stand-in of h+6 against the truth.** Lines unchanged: pooled ERROR(blend) at
  most **60%** of it, void below 25%, no view where the blend is worse than it, at least 30 of 40 triples. The oracle (the
  smaller of the two inputs) and fine h alone are reported beside it and decide nothing.
- Reading, as section 27.3: the transient of section 24.3 may sit in both first-visit pictures alike.

## 30. H8f, the first visit, run as registered in section 29 (14:56-15:13 EST, recorded 15:15 EST): a valid run, and it FAILS its line
Build `1c1a13f28`, instrument `ce99db80e`. 0 page errors. 35 of 40 triples scored (30 required). Not scored: one waves view
(-122, 36) whose four jumps landed on the fine grid directly (no stand-in showed), and one swell_2 triple whose first hour had
not settled on the fine grid. The truth read twice: 0.000 in all 35. The two fields mixed were h and h+6 in all 35; the resident
was the 46 x 21 stand-in for both pictures in all 35.
| view | held mix | REAL CUT: stand-in of h+6 | fine h alone | mix / real cut |
|---|---|---|---|---|
| waves (-158, 21.6, z5) | 17.72 | 25.33 | 20.36 | 70% |
| waves (-9.5, 39, z5) | 9.46 | 15.29 | 11.01 | 62% |
| waves (150, -34, z5) | 11.01 | 15.09 | 12.99 | 73% |
| waves (115, -9, z5) | 19.81 | 25.43 | 21.05 | 78% |
| swell_1 (-123, 37.5, z5) | 8.03 | 13.11 | 8.84 | 61% |
| swell_1 (-70, 40, z5) | 10.49 | 14.92 | 10.44 | 70% |
| swell_1 (18, -35, z5) | 11.17 | 16.17 | 13.82 | 69% |
| swell_2 (115, -10, z4) | 0.63 | 0.48 | 1.47 | **133%** |
| wind_waves (-5, 50, z4.5) | 2.81 | 4.47 | 2.57 | 63% |
| pooled | 10.40 | 14.88 | 11.68 | **69.9%** |
- **By the registered lines (the real cut decides): FAIL.** 69.9% pooled against a line of 60%; and one view where the blend is
  worse than the cut (swell_2, by 0.15 luminance units on pictures that differ from the truth by about half a unit).
- Beside it, deciding nothing: against fine h alone 89%; against the oracle (the smaller of the two inputs) 90%.
- What the numbers say in plain terms: on a first visit the half-way mix of the fine field with the coarse stand-in of the next
  hours is closer to the truth than what a hard cut puts on screen in 8 of 9 views (61-78% of its error), and it is not as good
  as the same blend between two fine fields (46%). It cannot be: one of its two inputs is the stand-in.
- What it means for the design choice of section 28: cutting on a step that changes hour and grid would put the stand-in on
  screen at once, which is the "real cut" column. On this measure that is WORSE than the mix in 8 of 9 views. So narrowing the
  design is not supported by the truth figures either; the cure for the first visit is not to have a stand-in (the fine grid's
  request leaves about 1.5 s after the step; section 21), which is outside this change.
- The transient of section 24.3 may sit in both first-visit pictures alike (section 27.3); not separated.

### Standing after section 30
| line | state |
|---|---|
| H1 smoothness (23%), H2 GPU time, H3 bytes, H4 at rest, H6 drag | pass |
| self-mix (the earlier field at its own place) | pass, exact |
| H8, repeat visits | pass twice (47.1%, 46.4%) |
| value bracket (grey view) | pass, 0.00% outside |
| colour reference line (0.5) | failed by one picture (0.795); the value bracket explains it; the hypothesis that those pixels sit at colour-band edges is not yet checked |
| H8f, first visit | **FAIL as registered**: 69.9% against 60%, one view worse than the cut; better than the cut in 8 of 9 views |
| water-only weighting; real frames | not tested |
Not ready to be ON by default (the advisor's standing condition: real frames). Whether a PR is opened with the first-visit line
recorded as failed is the owner's decision.

## 31. The advisor on section 30 (15:22 EST): the fail stands; four readings added, none changes a verdict
1. The 60% line for H8f was carried over from the same-grid test without thought for a mix that has one coarse input; it cannot
   be reached. It stays failed. It is not evidence of harm: the direction is the same in 8 of 9 views (61-78% of a real cut's
   error).
2. The one worse view (swell_2: 0.63 against 0.48) is a difference of 0.15 units on pictures half a unit from the truth, below
   the 0.38 rounding scale measured in section 14. H8f should have carried a signal floor like H9's. That is said POST HOC; the
   view is not dropped and the "no view worse" line stays failed.
3. **What a user gets on a first visit:** the blend is a 160 ms transition. After it, blend and hard cut show the SAME stand-in
   until the fine grid arrives 1.5 to 4 s later. So on a first visit the blend changes 160 ms of picture, and the truth figures
   say those 160 ms are not worse than a cut. The cure for the first visit is the fine grid's delay, which is another lane's.
4. The transient of section 24.3, if it sits in both first-visit pictures and not in the truth, raises both errors and pulls
   the ratio toward 100%, against the blend. A likely direction, not shown.
Still owed before the blend may be ON by default: H8 on real frames, water-only weighting, the colour-band-edge check for the
one picture over the colour line, and the owner seeing blend and cut moving side by side.

## 32. The draft PR (16:07 EST), opened at the owner's word in this session ("Yes, open draft")
- **The shader text is now added by a wrapper** (`marineHourBlendGLSL.js`, `withHourBlend`), not written into the colour shader:
  two suites pin that shader byte for byte against an older baseline, and the repo's rule is that a later addition vanishes
  under its kill at load. With the kill set before the shaders load, the colour shader is the text it was. The code the wrapper
  inserts is the code the gate build (`1c1a13f28`) ran: 41 of its 43 added lines are found verbatim in the wrapper; the two
  that differ are comments. The gate was NOT run again on the restructured build.
- Tests: `marineHourBlend.test.js`, 51 tests (floor fragment +51 tests, +1 suite); the kill is in the kill-switch inventory.
- The whole map and tests trees, locally, twice: 7,163 of 7,165 pass on the second run. The two that fail are timeouts
  ("Exceeded timeout of 5000 ms") in `marineFrameStoreCrop.test.js` and `marineFrameStoreRegional.test.js`; both suites pass
  when run alone, three times of three (72 tests), on a machine running several hundred other processes. Hosted CI decides.
- Lint ratchet: passes. File-size check: 0 violations.
- NOT done: light and beach themes, the phone layout, the LongCat review, anything on a real device or the deployed site.

## 33. The owner's decision, and the blend made OPT-IN (18:05 EST). No new measurement in this section.
**The owner (relayed by the director, 16:14 EST):** "The hour blend is ONE behaviour everywhere, and it stays OFF until both of
these are done": (1) a hidden-hour test on REAL forecast frames from the public CDN, replayed offline: the blend's error
against the real frame at most the hard swap's, ghosting no worse; negative control, a corrupted middle frame must fail;
positive control, identical neighbours give zero error; (2) a blinded 5-minute look by the owner, 10 randomized pairs of hard
cut against cross-fade. The director: this PR must not turn the blend on by merging; a string-identity test against the gate
build's shader and a self-mix re-check before any merge; light, beach and phone; the real-frame run held to a quiet window.
- **Now OFF by default.** The blend runs only with `window.__RAW_ENABLE_HOUR_BLEND__ === true` set before the app loads (the
  same name as the wind blend: one behaviour). Unset, `withHourBlend` returns the colour shader as it came (the same string),
  `crestBlendMs()` is 0, no texture is copied or kept, and setting the opt-in later in the console starts nothing (the shader
  text was not loaded). The kill `__RAW_DISABLE_CREST_HOUR_BLEND__` stays and wins. **Merging this PR turns nothing on.**
- **Gate identity, closed.** Today's composed shader against the gate build's (`1c1a13f28`, its `WebGLMarineShaders.js` loaded
  and composed the same way in Jest): 733 lines each, two lines differed, both comments ("field" for "hour"). The two words
  are restored. The enabled shader is now the gate build's string for string: length 46,424, sha256 `d9336568...fb915`, pinned
  in `marineHourBlend.test.js` ("GATE IDENTITY"). So the shader the gate measured is the shader that ships under the opt-in.
  The ENGINE-side edits made after the gate runs (hooks, uniform setter) are not covered by this pin: the self-mix re-check
  on this build is still owed and is not run here (a browser job; the machine is being kept quiet for another lane).
- Tests: `marineHourBlend.test.js` 55 (floor fragment now +55 tests, +1 suite). With the two shader-pin suites and the
  kill-switch inventory: 4 suites, 91 tests pass. Lint ratchet passes. The whole trees are NOT re-run on this commit (owed).
- The lab instruments set the opt-in in their init script; both arms load the blended shader and arm A is the kill at run
  time, as in every gate run so far (the gate build had the text in the shader unconditionally).
- A device note: the blend uses fragment texture unit 7; WebGL guarantees 8 fragment units, so no limit check is needed for
  the colour shader. A driver that refuses the blended shader fails the engine's init as any shader error does; with the
  blend off by default no user is exposed to that. A fall-back to the bare shader is owed before the default flips.
- Still owed before the default may flip: the self-mix re-check on this build; light and beach themes and the phone layout;
  the real-frame hidden-hour test with its two controls; the owner's blinded look; the whole-tree run on `dev` for the two
  frame-store timeouts; the colour-band-edge check; water-only weighting; the LongCat review.

## 34. THE REAL-FRAME HIDDEN-HOUR TEST, registered before the instrument is written and before any frame is fetched (18:12 EST)
The owner's test (section 33). No threshold moves after data; a failed or void line is recorded as it is.
**Instrument:** `frontend/scripts/offline-backend/real_frames_hidden_hour.mjs`, Node only, no browser, no GPU. Step 1 fetches
frames ONCE from the public frame CDN (static files in the public bucket, not the backend), one request at a time with a
pause, into a local folder with a manifest. Step 2 scores from that folder, offline. Nothing is asked of the live backend.
**What it measures and what it rests on:** it works in VALUE space on the frame's own grid (the 2-degree world field the app
draws at world zoom). It computes the mix the shader computes (height in metres averaged; direction as unit vectors
averaged; period averaged). That the shader DRAWS that mix was measured on synthetic fields (the grey-view bracket,
0.00% of pixels outside, section 30) and is not re-measured here. It does not cover the first-visit coarse stand-in, regional
grids or a real phone.
**Data, fixed now:** GFS sets `waves`, `swell_1`, `swell_2`, `wind_waves` (the four layers the blend applies to), world
`global_mid`. Triples (h, h+3, h+6) for h = 0, 6, ... 114 of each run index available, using only frames the index does not
mark estimated; at least 2 model runs (the CDN keeps the current and the previous index; if only one is there, a second
fetch after the next run, and the result is NOT reported until both are in). Nodes: those with a value in all three frames.
- **R1 truth, height (the deciding line).** Per triple: E(blend) = mean |0.5 (H(h) + H(h+6)) - H(h+3)| in metres;
  E(cut) = the SMALLER of mean |H(h) - H(h+3)| and mean |H(h+6) - H(h+3)| (a hard swap shows one of the two; both are
  printed). Pass, per set and pooled: pooled E(blend) at most **100%** of pooled E(cut) (the owner's line: not worse than the
  hard swap), AND E(blend) <= E(cut) in at least **80%** of triples. Also reported, no line: the same on the tenth of nodes
  where |H(h+6) - H(h)| is largest (where the sea is moving).
- **R2 ghosting no worse.** A cross-fade of a moving front shows it twice at half strength. Measure: the L1 error of the
  height GRADIENT field (central differences, both axes) against the real h+3 gradient, per triple, for the blend and for
  each end hour. Pass: pooled gradient error of the blend at most **100%** of the smaller end hour's, per set and pooled.
  Stated before data: for two well-separated sharp fronts this measure is EQUAL for blend and cut, so it can fail only if the
  blend adds structure the cut does not have; it is a "not worse" line, not evidence the blend looks better.
- **R3 direction and period**, reported with R1's two lines (direction: mean angle in degrees between the mixed unit vector
  and the real one, on nodes above 0.25 m; period: mean |difference| in seconds). A set where the blend is worse than the cut
  pooled on either is recorded as a failed R3 for that set.
- **Negative controls: the test must be able to fail.** The owner's words are "a corrupted middle frame must fail". Read two
  ways, both run, and the reading is put to the director:
  **N1, a wrong truth:** scored against the frame 48 h later in place of the real h+3, E(blend) must be at least **2 x** its
  value against the real h+3 in at least 90% of triples. (Why not "R1 must fail": an average of two fields is usually closer
  to an UNRELATED field than either one is, so R1's ratio alone would still read under 100% against a wrong truth. Stated
  before data; if N1 does not hold, R1 cannot tell a right middle from a wrong one and is VOID.)
  **N2, a wrong blend:** the mix built from h and h+54 in place of h+6 must FAIL R1 against the real h+3 (pooled above 100%).
  If it passes, R1 is VOID.
- **Positive control P:** with h+6 replaced by a copy of h and the middle by the same frame, E(blend), E(cut) and both gradient
  errors are exactly 0 for every triple.
- **To be run only in the quiet window the director names** (22:00-00:30 EST), or earlier at the director's word.
- Built 18:20 EST: `real_frames_hidden_hour.mjs` (fetch / score / `--selftest`). Only its self-test has been run (the scorer's
  arithmetic on made-up fields: a field moving linearly in time is recovered exactly by the mix; identical frames give zero).
  No frame has been fetched and no result exists.

## 35. THE OWNER'S BLINDED LOOK, registered before any clip is recorded (18:32 EST)
The owner's second condition (section 33): "a blinded 5-minute look by David: 10 randomized pairs of hard cut vs cross-fade".
**Built, not run:** `scn_blend_look.js` (recorder), `blend_look.html` (the page he uses), `blend_look_score.js` (unblinding).
The recorder is a browser job and has NOT been run; only syntax and the unblinding arithmetic were checked.
- **What a pair is.** The app itself, offline, in one page loaded with the opt-in. The cache is settled by two silent passes.
  The SAME 8-step scrub (700 ms a step) is then recorded twice from the compositor's own frames: once with the kill set (hard
  cut), once without (cross-fade); which is recorded first alternates by pair. A clip is used only if it is what it claims:
  the hard-cut clip started 0 blends and the cross-fade clip started at least one per step (read from the blend's own
  counters); otherwise the pair is listed as not usable and recorded again.
- **The ten, fixed now:** waves at (-140, 20, z3) dark; (-158, 21.6, z5) dark; (-9.5, 39, z5) light; (150, -34, z5) beach on
  the phone layout (390 x 844); swell_1 at (-40, 35, z2.5) dark; (-123, 37.5, z5) beach; wind at (-140, 20, z3) dark;
  (-5, 50, z4.5) light; (-106, 14, z4) dark on the phone layout; (150, -20, z3) beach. Desktop 1280 x 800 unless said.
  Six marine, four wind: this needs ONE local build holding both blends (the two branches merged locally, never pushed), on
  the moving synthetic ocean and wind (`--moving-swell 0.9`, `--moving-wind 8`) so that a step changes the picture.
- **Blinding.** For each pair a random draw decides which clip is stored as "x"; a second draw decides which side "x" is shown
  on; a third shuffles the order of the pairs. The page and the file it loads hold only x / y and the frames. Which is the
  hard cut is written only to `key.json`, outside the folder the page is opened from. I will not open `key.json` between
  recording and receiving his answers, and the answers come back as a code of slots (for example `p03:x`), not of treatments.
- **What he is asked:** per pair, "Left looks better", "Right looks better" or "No difference". He may pause or play at half
  speed. Nothing tells him what differs.
- **How it is read, fixed now:** the cross-fade is PREFERRED at 8 or more of 10; the hard cut is PREFERRED at 8 or more of
  10; anything else is NO CLEAR PREFERENCE (by chance alone, 8 or more of 10 for one named side happens about 5% of the time;
  "no difference" counts for neither). The count is reported by layer, theme and layout as well, without a line. His answer
  is the result; this reading only names it. A hard-cut preference or no clear preference means the blend stays off.
- **Not covered, said before he looks:** the ocean and wind are synthetic and move more evenly than real weather; the clips
  are recordings at up to 960 px wide, not the live app on his device; a recording drops some frames of a 160 ms blend (the
  page plays each frame at its recorded time).
