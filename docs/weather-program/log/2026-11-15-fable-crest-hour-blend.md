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
