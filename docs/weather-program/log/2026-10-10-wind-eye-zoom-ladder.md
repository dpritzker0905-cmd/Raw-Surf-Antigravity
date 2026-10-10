# 2026-10-10 · The hurricane eye through a whole zoom: a coarser box no longer replaces the finer one (client), and what is left for the server

Task (from the session that fixed #298): keep the eye at the same place and shape across zoom-in and zoom-out tier
changes. Measure first on the eye bench with a replayed zoom z5.5 → z9 and back, compare four options, recommend one.
Written 01:50Z. No request of mine reached the live backend: every number below is the offline bench or the code.

## What the instrument is (wind bench, ladder mode; README "Ladder mode")

`frontend/scripts/wind-bench/ladder-run.js`: the real engine on the GPU, replayed stop by stop. At each of 15 stops the
engine receives, in order, every grid the client would have committed so far. The grids come from three rules mirrored
in `ladder.js` and pinned to their sources by `windBenchLadder.test.js`:
- the request box is the app's own `clampViewportBbox` (parity-tested against the function itself, 48+ views);
- the tier is `choose_adaptive_resolution` at 400 points (parity with the app's mirror, string pin on the backend);
- the client cache is `windController.fetchWindData`: the exact box, else the FIRST cached box that contains the view
  and is fine enough (1.1x the stop's tier).

**The replayed path** (pane 897 x 914 css px, centre -87.6, 27.8):

| stop | request box | tier | what reaches the engine |
|---|---|---|---|
| z5.5 | -96,20,-79,35 | 1° | the 2° clip (cold), then the 1° box 18x16 |
| z6 | -94,22,-81,34 | 1° | cache: the z5.5 box |
| z6.5 | -93,23,-83,32 | 0.5° | the 2° clip (refused by #298's rule), then the 0.5° box 21x19 |
| z7, z7.5 | | 0.5° | cache: the z6.5 box |
| z8 | -90,25,-85,30 | 0.25° | the 2° clip (refused: it lies inside the 0.5° box), then the 0.25° box 21x21 |
| z8.5, z9 | -90,26,-85,30 | 0.25° | cache: the z8 box |
| out z7.5, z7, z6.5 | | | cache: the z6.5 box (0.5°) |
| out z6, z5.5 | | | cache: the z5.5 box (1°) |

`--fresh` replays the path where every stop gets its own box (a pan, an expired cache). Its summary is identical.

Two things I had to settle before trusting it:
- **The tiers agree at shared nodes.** The lane fixtures (built by the production `apply_wind_lane`): 0.25° tile vs the
  0.5° Open-Meteo box, mean |ΔV| 0.009 kn over 405 shared nodes (max 0.55); vs the 2° tier, 0.000 over 28. Every box is
  snapped to whole degrees, so the lattices nest. The eye moves because a coarser tier is a thinner sampling of the same
  field, not because the tiers disagree. Each bench tier is therefore one field (`eye.truthField`: the served 0.25° tile)
  point-sampled at its lattice.
- **The eye summary read a pocket as the eye.** At 0.25° the eye closes from 26 to 38 kn and opens at 40. A 9-km closed
  pocket 100 km north then counted as "the eye at 40 kn" (nearest enclosed contour within 200 km). Ladder mode requires
  each next contour to be the same eye grown (`eyeSummary(..., { nested: true })`). Eye and lane mode keep their old
  default, so their published numbers stand; lane mode's "40-kn closing T" on the 0.5° boxes is that pocket (the eye
  itself closes to 38 kn). Recorded here, not changed: every row of those modes carries it alike.

Controls, all four passing (exit 0): the truth grid draws the same eye at every zoom (0.0-0.3 km, 0 kn, x1); the
`oneLattice` arm matches the truth at every stop; a mosaic whose fine box lies away from the storm draws the coarse
box's own eye (0.1 km, 0 kn, x1; field 0.07 kn); the `now` arm moves the eye on the way out (positive).

## What dev does today (the `now` arm)

Truth, the 0.25° lattice everywhere: eye at -87.65, 27.64, closed 26-38 kn, r 30 km at 38 kn.

| step | eye, change from the stop before | eye against the truth afterwards |
|---|---|---|
| in z6 → z6.5, 1° → 0.5° | 21.4 km, wall +12 kn, area x0.34 | 0.4 km, 0 kn, x1.72 |
| in z7.5 → z8, 0.5° → 0.25° | 0.4 km, 0 kn, x0.58 | 0.0 km, 0 kn, x1 |
| out z8 → z7.5, 0.25° → 0.5° | 0.4 km, 0 kn, x1.71 | 0.5 km, 0 kn, x1.71 |
| out z6.5 → z6, 0.5° → 1° | 21.4 km, wall -12 kn, x2.94 | 21.1 km, -12 kn, x6.67 |

At 1° the eye is drawn 21 km off, its weakest wall 12 kn lower and its area 6.7 times the truth. At 0.5° the centre is
right and the area is 1.7 times. The z7.5 step on the way out is the client's own doing: its cache hands back the
0.5° box although the 0.25° box it also holds contains the view.

## The four options, on the same instrument

Change from the stop before, worst stop on each leg; the last column is the drawn field against the truth over the
whole view (mean; a second readback, 5-kn bins).

| option | zoom in (2 tier steps) | zoom out (2 tier steps) | field, worst stop on the way out | cost |
|---|---|---|---|---|
| now | 21.4 km, 12 kn, x2.94 | 21.4 km, 12 kn, x2.94 | 1.77 kn | |
| (a) keep the finest while it covers ≥ 70% of the view | the same | 21.3 km, 12 kn, x2.94: each jump comes one stop later | 1.09 kn | ~10 lines, client |
| (a) keep the finest while it holds the view centre | the same | 0.1 km, 0 kn, x1 | **2.09 kn; 9.6% of the view ≥ 10 kn off** (now: 0.9% at that stop) | ~10 lines, client |
| (b) coarser box filed AROUND the finer nodes (a mosaic; a third texture level draws the same picture) | the same | **0.1 km, 0 kn, x1** | **0.88 kn** | one pure module, +0 engine lines net, no shader change |
| (c) one lattice at every zoom (server) | **0.1 km, 0 kn, x1** | **0.1 km, 0 kn, x1** | 0.02 kn or less | see the cost below |
| (d) coarser tiers as area means of the finest (server) | 30.8 km, 8 kn, x4.17 | 30.8 km, 8 kn, x4.24 | 2.80 kn; 12.4% ≥ 10 kn | worse than now |

- **(a) what is lost outside the fine box.** The 2° base draws it. Holding the eye all the way out (the centre rule)
  costs the rest of the picture: at z6.5 the view is 2.09 kn off against 1.09 now, and 9.6% of it is 10 kn or more off
  against 0.9%. The 40-kn area's northern lobe is cut off in the image. The 70% rule keeps the picture and only delays
  each jump by one stop.
- **(b) dominates (a).** It holds the eye at every stop out and the field is closer to the truth than today at every
  stop (z7.5 to z5.5: 0.01 / 0.14 / 0.51 / 0.88 / 0.51 kn against 1.68 / 1.27 / 1.09 / 1.77 / 0.99), because the box
  still draws everything outside the fine nodes.
  - A real third texture level would need a sampler, six uniforms and a blend in three shaders, a texture unit, and
    lines in a file the LOC ratchet only lets shrink. The mosaic draws that picture with one texture.
- **(d) is ruled out by measurement.** The tiers already ARE consistent resamples of the finest lattice (its
  decimation, exact at shared nodes). The other consistent choice, an area mean, averages opposing vectors across the
  eye (LESSONS L-S16): at 1° the eye is 34.9 km off and 15.9 times the truth's area.
- **(c) is the only option that fixes the first zoom-in.** No client rule can: the fine nodes are not on the client
  until z8.

## Shipped in this PR: option (b), client only, default on

`frontend/src/components/map/windTierMosaic.js`, asked by `WebGLWindEngine.setWindData` after the two keep rules:
- a clearly coarser box (1.3x) that is not inside the fine box and is not a base clip is filed as a MOSAIC: the box
  resampled onto the resident fine lattice (bilinear u/v, which is exactly what the shader draws from that box when the
  lattices nest), with the fine nodes kept where the two overlap and blended over two cells at the fine box's inner
  edges, as the shader blends a fine box into the base;
- the mosaic remembers its inner grid, so a second step out (0.5° then 1°) keeps the ORIGINAL 0.25° nodes;
- "inside the fine box" (`noop_coarser_than_fine`) is judged on the truly fine box, so zooming back in over a mosaic
  still files the 0.5° box as the new surround;
- a re-delivery of the same served box over its own mosaic is a no-op (no texture upload);
- `window.__WIND_FINE_OVERLAY__` keeps reporting the SERVED box's lattice, so the commit gate in `WeatherEngine.js`
  decides exactly as before;
- it returns null, and the engine files the box as before, for another model, hour, valid time or model run, stale data
  inside a fresh box, under four cells of overlap, an antimeridian box, a non-finite vector, or more than 40,000 nodes.

No served number moves, no request is added, no shader changes. Kill: `window.__RAW_DISABLE_WIND_TIER_MOSAIC__`.
Console: `window.__WIND_TIER_MOSAIC__` (`built`, `last`). The engine file stays at its ratchet baseline (1095 lines).

**When the fine box does not hold the eye** (its edge cuts the storm; three placements probed): the eye is drawn as
today (21.2-21.4 km, -12 kn at 1°; 0.2 km, x1.72 at 0.5°), and the field is closer to the truth than today in all six
cases (1.20-1.37 kn against 1.77 at 1°; 0.89-1.03 against 1.27 at 0.5°). The images show no line at the fine box's
edges.

**#298's kill switch** (`__RAW_DISABLE_WIND_CLIP_KEEP_FINE__`) no longer brings the z6 swap back on its own: with it
set, the mosaic keeps the finer nodes inside the clip. Both switches together restore the old filing (tested).

Tests: `windTierMosaic.test.js` (16: the values node by node, ladders, every null return, wiring),
`windTwoTexture.test.js` (+7: the engine through 0.5°, 1°, the 2° clip and back; the kill switch; the no-op guard),
`windBenchLadder.test.js` (13: the mirrored rules against their sources, the plan, the field helpers, the nested
summary). Map and legend trees: 294 suites, 3707 tests (run before the last wiring pin was added; its suite re-run alone,
16 passed). `check_eslint.js` and `loc_ratchet.py` pass.

**Scoreboard:** no row. This changes no served number.

## For the owner: the first zoom-in needs the server (design, not built)

After this PR the eye still changes twice the FIRST time a view zooms in on a storm at a given hour: at the 1° → 0.5°
step (21.4 km, +12 kn, area x0.34) and at the 0.5° → 0.25° step (0.4 km, area x0.58). Once the 0.25° box has arrived,
every later zoom out and in holds. To remove the first approach as well, the storm must be on the 0.25° lattice at
every zoom. Three ways, with their cost:

| design | Open-Meteo location-calls for the replayed ladder | CPU on the 1-CPU box | verdict |
|---|---|---|---|
| today | 288 + 399 + 441 = 1,128 (11% of the free 10,000 a day, the figure in `noaa_hrrr_wind_fetcher.py`) | each box: all its forecast hours normalised and written in the background | |
| (c1) every box at 0.25° | 4,209 + 1,517 + 441 = 6,167 (x5.5; 62% of the daily quota for ONE cold ladder). The z5.5 box alone is x14.6, over the 3,000-node cap, and nine 500-point POSTs | x14.6 for that box (1.6 M vectors against 110 k at the 16-day horizon) | no |
| (c2) a 0.25° window (8° x 8°) around the storm inside each wider box | 1,296 + 1,199 + 441 = 2,936 (x2.6; 29% of the quota) | x3.0-4.5 on the wide boxes; needs a mixed-lattice product | no |
| **(c3) storm tiles at ingest** | **0** | **0 at ingest (GitHub Actions); one stored-tile read per storm and hour when viewed** | **recommended** |

**(c3) in one paragraph.** The ingest's regional wind pass already downloads the whole global 0.25° GFS 10 m wind for
every step it reads (`noaa_wind_service.fetch_gfs_wind_regions`: a NOAA byte-range selects a GRIB message, which is the
global field, 1.16 MB a step; 77.7 MB at its 8-day horizon). At ingest, find each step's storms in that field (a closed circulation with 34 kn or more), cut an 8° x 8° tile
at 0.25° on whole degrees (33 x 33 = 1,089 nodes) and store it as a regional product, as `florida_east_coast` is stored
today. List the tiles for the viewed hour on the world-grid response. The client asks for a listed tile when its box is
in view, by the existing stored-tile path (`grid_resolver` Step 3), and files it as the fine overlay; this PR's mosaic
then keeps those nodes under every wider box. The HRRR lane already runs on every GFS wind `/grid` response, so it
covers the tile too.

- **What it costs:** no Open-Meteo call; detection and cropping on GitHub Actions; storage of 1,089 vectors per storm
  per step; on the Render box one extra stored-product read per storm and hour viewed (the size of a pilot-tile read).
- **What it changes:** what `/grid` serves (a new product and a new response field), so it ships dark behind a flag and
  flips on the owner's word (D-001), with its own bench row: the `oneLattice` arm is the target (0.1 km, 0 kn, x1 at
  every stop).
- **Not estimated here:** the detection rule's false positives (a non-tropical 34-kn low gets a tile too, which is
  harmless but costs storage), and the tile count per cycle. Measure both offline on a week of stored cycles before
  building.

**Recommendation: merge this PR, then decide on (c3).** Nothing else on the client is worth doing first: the cache's
insertion-order pick (z7.5 on the way out) is harmless once the mosaic keeps the fine nodes.

## Not verified

- **Not seen in the app.** The bench is the real engine on real served data, not MapLibre with the owner's display. On
  dev after the merge, over a storm: zoom to z8 or closer, wait for the fine box, zoom out by stops. Expect
  `window.__WIND_TIER_MOSAIC__.built` to rise and the eye to hold; `window.__RAW_DISABLE_WIND_TIER_MOSAIC__ = true` and
  a pan bring the old behaviour back.
- **Different GFS runs in one picture.** The mosaic refuses grids that name different model runs, and files them as
  before. Whether the dynamic boxes carry a run time on the client was not checked; when one side does not say, the
  mosaic is built.
- **One storm, one hour, one pane size.** A wider pane asks for wider boxes (the owner's 18x13 box at z6.6), which moves
  the stops at which the tiers change, not the rule.
