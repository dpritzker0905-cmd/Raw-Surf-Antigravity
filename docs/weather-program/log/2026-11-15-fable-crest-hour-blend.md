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
