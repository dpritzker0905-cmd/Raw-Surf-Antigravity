# 2026-10-10 · Trails anchored to the map: the wind keeps its flow lines while the map moves

Owner (02:1xZ, with the algorithmic-art skill): "study all of our sub work tree work, then when it is all done with its
sub tasks, work forward on making this state of the art". Written 05:35Z. No request of mine reached the live backend:
every number below is the offline bench (real engine on the GPU, real basemaps) or a static file from Netlify.

## What the side sessions had done (read first, nothing of theirs touched)

| session | result | what it changes |
|---|---|---|
| wind series on pan | #300 merged 01:36Z | client: the latest view owns the series work |
| closed-PR recovery | #301 merged 04:27Z | nightly verdict fix; dropped logs and a lesson restored |
| eye through a zoom | #302 merged | client: a coarser box keeps the finer nodes it overlaps (tier mosaic); ladder bench |
| bounded wind background build | #303 merged | backend, dark flag `WIND_BG_BUILD_BOUNDED` |
| light's fast bands | #304 merged 04:40Z | three palette candidates behind default-off levers, for the owner's A/B |

All five were on dev before this branch was pushed; it was merged with dev at `541117de` (one import-line
conflict in `WebGLWindEngine.js` with #302, both kept) and every check below was re-run on the merged tree.
**Correction (05:45Z):** this log first said the owner merged all five. The ledger records #299 and #300 as merged by
the owner on GitHub; #301-#304 were merged by the light fast-band session, #302-#304 while two slow backend lanes
were still pending (its read-back is in #305, due 07:00Z). I had read the GitHub account name, which every session
shares, as the owner's hand. #305 (their
merge ledger lines) is open, so this branch's ledger lines and its will need a re-chain, whichever merges second
(LESSONS L-P21).

The owner merged #299 (my basemap-mute fix) at 01:29Z. The deployed dev build read `9e11676c` when checked (before 04:35Z) and chunk
`1158.4fed819f` carried #299's `imagery:` read-back and #300's kill switch (static files only). **Still not read on the
deployed build:** `window.__WIND_BASEMAP_MUTE__.layers` (expected 9 in light, 17 in beach with only the wind on).

## Where the wind layer stood against the leaders

Read against the 2026-10-09 research (`research_notes/Wind particle close zoom legibility/industry_zoom_scaling.md`) and
the engine itself. Three candidates, each measured before anything was built:

| candidate | measurement | verdict |
|---|---|---|
| 16-bit wind texture (the field is stored at 8 bits per component) | direction error on the bench fields, 8 bits: median 1.5-2.3 deg at 2-5 kn, 4-7 deg under 2 kn; a floor bias of 0.1-0.2 kn | not worth a change: nobody can see 2 degrees |
| trails that follow the map | a mid-pan bench frame shows speckle where the frame at rest shows flow lines; the trail buffer was a screen-space texture that nothing moved | **built: this log** |
| curves between grid points (Catmull-Rom through every node; the shader draws straight lines) | served 0.25 deg tile decimated to the tiers: the eye drawn from the 0.5 deg grid is 1.74-2.17x its true area with straight lines, 1.03-1.31x with curves; field error within 1.5 deg of the eye 2.92 -> 2.04 kn RMS | next, on #302's ladder bench (its mosaic assumes the shader's straight lines), owner A/B first |

How others handle a moving map, where the 2026-10-09 research read their code: MapTiler clears its screen accumulator
after a move; Mapbox's raster-particle layer keeps its trails in each tile's own texture; WeatherLayers draws trails as
geometry from each particle's history, so they are in map space. What Windy, Ventusky and earth.nullschool do during a
drag was not read.

## The defect

The engine dims and redraws one screen-sized trail buffer every frame (`FADE_FS`, then the marks, then `SCREEN_FS`). The
buffer knew nothing about the map. While the map moved, the ink already in it stayed where the SCREEN had left it:
- a pan turned the field into streaks parallel to the drag;
- a zoom turned it into rays from the focal point (the old clear fired only on a jump of more than 0.15 zoom levels in
  one frame, 9 levels a second, which an ordinary wheel or pinch zoom does not reach);
- a turn smeared it along arcs.

The wind's direction was unreadable exactly while the viewer was searching for it.

## Designed in a lab page first

`reports/anchored-drift.html` (untracked; published to the owner as an artifact): a seeded storm on a coarse lattice, the
engine's own mark, fade and density rules in miniature, and two switches (trails on the screen / anchored; straight
lines / curves). Two first ideas failed there in minutes, before any engine code:
- **Resampling the buffer through the camera change every frame** is correct on paper. In the lab it blurred the trails
  for as long as a zoom lasted (a bilinear resample per frame compounds).
- **Re-laying the ink into a wider buffer on a zoom-out** left a visible box where the old buffer had ended.

What survived both: the buffer keeps a camera of its own.

## The fix (client only, default on)

`frontend/src/components/map/windTrailAnchor.js`, asked once per frame by `WebGLWindEngine.render`:
- **Pan:** the fade pass moves the ink by WHOLE pixels (an exact texel copy; nothing is resampled or softened). The
  sub-pixel remainder stays in the buffer's camera, so it never accumulates (120 frames of 3.4 px: the shifts sum to the
  true move within half a pixel; tested).
- **Zoom:** the composite looks at the buffer THROUGH the change of scale: one resample, at display. The ink is re-laid
  only when that magnification passes 1.2x (4 times in 1.2 zoom levels, not 40), when the view starts to outgrow the
  buffer (zoom-out: re-laid 1.15x wider, the old ink feathered toward its old edge), or once the scale has rested 12
  frames.
- **Turn or tilt:** the ink is re-laid every frame through the exact ground-plane homography (the map allows a 60 deg
  pitch).
- **The date line:** the view centre wraps at +-180 and the map's matrix jumps one world in one frame. The buffer's
  camera is read in whichever copy of the world is nearest the view.
- **Marks** are drawn with the buffer's camera: the map's matrix with its ground plane swapped, and the mark sized to the
  buffer's scale.
- **A jump** (more than 2.2x in scale or three screens in one frame) keeps nothing: the buffers are cleared.
- **A still camera is the identity in every pass.** The shader takes its uv transform MINUS identity, so all zeros (an
  unset uniform, the kill switch) are the legacy fetch.

Shader changes: `FADE_FS` and `SCREEN_FS` fetch through `trailTexel` (shared GLSL from the module). Only the uv
arithmetic and its varying are high precision (a whole-pixel shift must land on a texel centre; where a device has no
high-precision fragment floats the anchor stays off); the colour arithmetic keeps each shader's own mediump line.
`DRAW_VS` scales the mark by `u_trail_dk`. `WebGLWindLayer` hands the engine the map's 64-bit matrix before its 32-bit
copy.

- Kill: `window.__RAW_DISABLE_WIND_TRAIL_ANCHOR__` (the screen buffer and its clear on a zoom jump, as before).
- Read-back: `window.__WIND_TRAIL_ANCHOR__` = `{ on, mode, k, modes }` (`modes` counts frames per kind).
- No served number moves, no request is added. **Scoreboard: no row.**
- Line ratchets: engine 1094 -> 1073 after the merge with #302 (baseline 1095), shaders 1028 -> 1028 (baseline 1029).

## The instrument: wind bench, flow mode (README "Flow mode")

`node frontend/scripts/wind-bench/path-run.js --flow`. On the real basemaps and engine, along every camera path:
**the share of the wind's ink that varies ACROSS the served wind direction** (`flow.js`; 1 = every streak runs along the
wind, 0.5 = no direction). The ink is (map + wind) minus (the map alone, same camera, engine not advanced).

Final run, finished 05:24Z, on the merged and reviewed code: 33 run pairs (3 themes x 9 paths; erratic x 3 seeds), AMD Radeon
890M, headless Chromium. Share while the camera moves, ranges over the themes:

| camera move | trails on the screen (dev) | anchored | at rest |
|---|---|---|---|
| pan (steady drag, z8) | 0.59-0.62 | 0.73-0.78 | 0.76-0.80 |
| fling (2400 px/s into inertia) | 0.51-0.55 | 0.62-0.71 | 0.76-0.80 |
| zoom in, z5 -> z10.5 | 0.54-0.63 | 0.70-0.77 | 0.69-0.74 |
| zoom out, z11 -> z5 | 0.53-0.63 | 0.75-0.77 | 0.72-0.85 |
| pinch (drifting focal point) | 0.57-0.60 | 0.71-0.78 | 0.67-0.71 |
| turn (70 deg there and back; new path) | 0.52-0.53 | 0.69-0.70 | 0.76-0.80 |
| date line (drag across lng 180 at z5; new path) | 0.52-0.53 | 0.68-0.71 | 0.69-0.72 |
| erratic (3 seeds) | 0.52-0.67 | 0.65-0.85 | 0.71-0.76 |
| jitter (2 Hz across 2.2 zoom levels) | 0.57-0.62 | 0.61-0.67 | 0.66-0.71 |

The smallest gain outside jitter is +0.11 (light, fling); jitter gains +0.02 / +0.02 / +0.10 (light / beach / dark).

Controls:
- **Null:** before the camera first moves, both arms lay the same ink: 258 of 258 trail buffers identical (the engine's
  own buffer, hashed; not the canvas, see below).
- **Positive:** dev's engine (`--ref origin/dev`) reads 0.615 on the dark pan in both arms and fails the gate (exit 1).
- **The kill switch is dev's engine, buffer for buffer:** with it on, 232 of 232 trail buffers equal dev's at every
  sample, moving ones included (`--hash-all`; dark and light, pan and zoom out).
- **The gate fires on a non-result:** the same arm run twice fails "anchored against screen" on every path.
- **Nothing cleared:** no path makes the anchored arm clear its buffer (the commit before the date-line fix fails this).
- **Tilt (seen, not scored):** a camera pitched 50 deg, turned 40 deg and panned: no GL error, the marks sit on the
  ground exactly as with the legacy buffer at rest, and the trails keep their lines while it pans.

Tests: `windTrailAnchor.test.js` (26) and `windBenchFlow.test.js` (15). Jest map + `src/tests`: 298 suites, 3797 tests.
Lint ratchet and line ratchets pass; a production build of the final tree passes.
#302's ladder bench still passes on the merged tree (exit 0: the eye results are untouched).

## An independent review before the push: four findings, all acted on

A separate reader was given the diff and seven questions (algebra, GL state, kill switch, lifecycle, world copies,
numerics, tests that pass for the wrong reason). Read only. It found:

1. **Crossing the date line wiped the trails.** The view centre wraps at +-180 (MapLibre, `renderWorldCopies`), so the
   map's matrix jumps one world in X in one frame. The anchor read that as a jump and cleared both buffers; dev shows
   nothing there. Every camera in my tests and my bench had stayed in one copy of the world.
   - Fix: the nearest world copy (above). Tests at z3, z5, z8, the other way and during a zoom; half a world is still a
     jump.
   - Bench: a `dateline` path, and the engine drawn in every visible copy of the world as the app's layer does.
   - **A median could not see it.** The commit before the fix read 0.713 on that path against 0.715 after: one wiped
     frame in ninety. The gate now fails on the engine's own read-back (`jump` on a scripted path), and that commit fails
     it.
2. **A zoom wobble re-laid the ink every frame.** A zoom-out re-laid the ink exactly at the one-to-one cap, so 0.0015 of
   a zoom level back and forth alternated the two re-lays: 30 resamples in 30 frames. The wider buffer is now 1.15x,
   short of the 1.2x cap. Tested with wobbles of 0.0015, 0.005 and 0.02 level: at most one re-lay.
3. **The kill switch was not exact off desktop.** Both trail passes ran at high precision whatever the switch said. They
   keep their mediump line again; only the uv arithmetic is high precision.
4. **Marks still go through a 32-bit matrix** (not a regression). At 1440 css px and DPR 2 the rounding of the buffer
   camera's translation is 0.24 device px at z14, 1.0 at z16 and 4.2 at z18, and it changes every pan frame, so a new
   mark can land that far from its exactly-carried ink. Stated as a limit below; the layer's comment no longer says
   "pixel-exact".

Tests it named as passing for the wrong reason, now strict:
- the wiring test pinned substrings; it now pins the program in use, the texture bound and the order at each of the
  three sites (three deliberate wiring mistakes each turn it red);
- the draw matrix was compared to five digits; it is compared exactly;
- a shader test matched `precision mediump float;` inside the new `#else` branch; the real line is back.

Seven deliberate breaks of the module (no nearest world copy, widen equal to the cap, the shift's sign, the remainder
dropped, no settle, the depth row kept, the marks' plane not swapped) each turn at least one test red.

## Limits, stated

- **Ground that has just come into view has no trail history.** A fling or a fast zoom-out shows marks without their
  tails for the first half second, anchored or not. That is why the anchored fling reads 0.62-0.71 against 0.76-0.80 at
  rest. It still reads 0.11-0.16 above the screen buffer, whose tails point along the drag.
- **Jitter is hardly better** in light and beach (+0.02). A 2 Hz zoom across 2.2 levels re-lays the ink every other
  frame (86 times in 180 frames). No hand does this; it is the stress case.
- **A zoom path's rest reading is taken at its first zoom only**, and the reading changes with zoom, so the gate compares
  the two arms there, not either one to rest.
- **A tilted map re-lays its ink every frame** (a resample per frame while it pans or zooms), and a tilted zoom-out gets
  no wider buffer. Seen working; softer than the flat case.
- **At z14 and beyond** a new mark can land a fraction of a pixel (z14) to a few pixels (z18) from its carried ink while
  panning. Not measured on the bench (its paths stop at z11).
- **Devices without high-precision fragment floats keep the screen buffer** (not measured: none here).
- **Not seen in the app.** The bench drives the engine through the same custom-layer call the app makes, on the app's
  layer stack, but the app's own layer file was read, not run.

## Found on the way: the bench's seeded runs depended on the run before

The first full run failed its null control on the new `turn` path only, and only when another path had run first.
- Two runs of the SAME arm agreed, so it was the order, not the arms.
- The engine draws from `Math.random` every frame (`u_rand_seed`, the respawn seed), and MapLibre draws from it too (an
  id per worker request). A tile that happened to load mid-run shifted every later respawn.
- `page/map-entry.js` now swaps the seeded stream in for the engine's frame only. After that: every pair identical.

Map mode and path mode share that page, so their seeded runs no longer depend on the run before either. Their published
medians came from runs with the shared stream; a re-run can differ by the seed-to-seed spread.

The first version of the null control hashed the CANVAS and failed on 16 of 27 pairs for another reason: the basemap
under the wind (label placement, tile arrival) is not bit-stable between runs. It hashes the engine's trail buffer now.

## What is next (ranked; none started)

1. **Read #299 and this change on the deployed build**: `window.__WIND_BASEMAP_MUTE__.layers` and
   `window.__WIND_TRAIL_ANCHOR__.modes` after a drag and a zoom.
2. **Curves between grid points**, on #302's ladder bench, behind a lever, for the owner's A/B. The offline estimate
   above is the case for it.
3. **Trail history for ground that has just come into view** (the fling's remaining gap). Not designed.
4. **Marks at z14 and beyond**: fold the tile origin into the matrix in 64 bits, so the shader multiplies small numbers.

Records: PR #306; LESSONS L-V24; ledger seq 1011-1013 (1013 is the live read-back, due 2026-10-17); the lab `reports/anchored-drift.html` and its philosophy
`reports/Anchored Drift.md` (both untracked); frames `reports/wind-trail-anchor-ab.html` (untracked).
