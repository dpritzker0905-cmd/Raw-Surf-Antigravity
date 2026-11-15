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
