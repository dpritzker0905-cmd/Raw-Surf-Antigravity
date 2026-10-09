# Wind bench

An offline, repeatable check of the wind particle layer. It renders the **real**
`src/components/map/WebGLWindEngine.js` on this machine's GPU, on a synthetic storm, across the
zoom × theme matrix. It also runs a significance-tested scanner that finds holes, blobs, diamonds
and rectangles the wind field does not explain.

It never calls the backend (the 1-CPU production box) and is never part of the app. It is bundled
by the app's own webpack into `scripts/wind-bench/out/` (gitignored), not into `public/`.

## Run it

From `frontend/`:

```bash
node scripts/wind-bench/run.js --control
node scripts/wind-bench/run.js
node scripts/wind-bench/run.js --ref origin/dev --themes dark
node scripts/wind-bench/run.js --serve
```

| command | what it does | time |
|---|---|---|
| `--control` | the positive control only (2 renders) | ~10 s |
| *(no flags)* | the full matrix: 13 views × 3 themes × 2 variants, plus the control | ~5 min |
| `--seeds 3` | every configuration three times; only artifacts that recur count (see Replicates) | ~14 min |
| `--ref <git-ref>` | bundle the engine from that commit instead of the working tree, without checking it out | +5 s once per commit |
| `--serve` | serve the page and print its URL, for a browser tab (Claude's browser pane: `preview_start` with that URL) | |

It prints a table, the control verdict and the path of a static `contact-sheet.html`. That sheet
has every view with its variants side by side, and views with artifacts are outlined. The served
page shows the same sheet live: pick a matrix and press **Run**, or add `?auto=control`, `?auto=dark`
or `?auto=full` to the URL.

Other options: `--seed <n>` (start seed),
`--views fine-z8,fine-z9`, `--themes dark,light`, `--variants shipped,candidate`,
`--frames 180`, `--res 192` (the phone particle pool; desktop is 384), `--real-clock`,
`--gl swiftshader`, `--headed`, `--json <file>`, `--strict` (exit 1 if the candidate has any
artifact anywhere), `--no-control`, `--port`, `--out`.

Exit codes: `0` control PASS, `1` control FAIL, `2` BLIND, a GL error or a crash.

## Eye mode (`eye-run.js`): does the hurricane eye hold still?

```bash
node scripts/wind-bench/eye-run.js
node scripts/wind-bench/eye-run.js --ref origin/dev --json out/eye.json
```

It asks one question: with the hour fixed, does the drawn eye keep its place, size and shape when
only the regional grid under it, or the zoom, changes? It takes about 2 minutes.

- **Field:** the page draws one heatmap frame through the real engine for each threshold from 30 to
  50 kn (2-kn steps). The colour LUT is swapped for a ramp that is white below T and black above, so
  the readback is the eye's T-kn contour exactly as the shader samples it: point registration,
  bilinear filtering, and the base+fine composite with its feather. `eye.js` takes each enclosed
  contour near the storm (one that touches the edge is an OPEN eye) and reports:
  - the lowest T that closes it (its centre is about where the drawn wind is lowest);
  - the highest T it stays closed to (the eyewall's weakest point);
  - the radius and aspect at that T.
- **Grids:** `fixtures/eye-2026-10-09-*.json` are the two products the owner's zoom stops swapped
  between (2026-10-09 15Z, Gulf). One is NOAA GFS from the native recovery; the other is Open-Meteo
  `gfs_seamless`, which is HRRR inside HRRR's domain. A third holds Open-Meteo `gfs_global` on the
  second box. The world base is 2° and copies those nodes.
- **Null controls:** the same data cropped to the other box, and the same grid at z5.5-7. Both must
  draw the same eye (≤ 5 km, the same closing T, area within 10%).
- **Positive control:** a 2° clip of the base as the overlay must change the eye.
- **Particles:** after 180 real frames, the trail ink inside the eye (≤ 25 km) over the ink on its
  wall (50-90 km), for two seeds. This shows whether the zoom-dependent respawn and density levers
  reshape the eye while the grid is fixed.

Exit codes: `0` when both controls hold, `2` when either fails.

## Land mode (`land-run.js`): how much land does the wind hide?

```bash
node scripts/wind-bench/land-run.js
node scripts/wind-bench/land-run.js --themes light --zooms 6,9,11 --levers '{"__RAW_WIND_CLOSE_LAND_OPACITY__":0.8}'
```

`ink` measures the trail buffer, not what reaches the screen. A light-theme mark composites
premultiplied at full opacity and hides what it covers, while a dark mark of the same ink is
translucent. Land mode measures the screen instead. It takes about 3 minutes for all three themes.

- **Basemap:** each frame is cleared to the theme's land colour (light `236,236,232`, beach
  `222,208,180`, dark `0.07,0.08,0.10`). A 1-css-px line grid stands in for roads, rivers and coasts,
  in each basemap's own road polarity: 55% of the land colour in light and beach, and lighter than the
  land in dark, as navigation-night draws its roads. The first version drew dark's lines darker than its
  land, and dark read a false 0.00 at z6.
- **Render:** the real engine draws on top for 180 frames.
- **Measure:** every vertical line pixel is paired with the background 6 css px to its right.
  - `retain`: their L* difference over the same on the bare basemap.
  - `lost`: the share of pairs below half their contrast.
  - `sal`: the mean |dL*| the particles add over the field alone (their visual signal).
  - `cover`: the share of pixels they move by more than 5 L*. `sal / cover` is the contrast per
    marked pixel, which is what separates a thin crisp mark from a faint wide one.
- **Runs:** each zoom runs twice, once with the field alone (a 2×2 particle pool) and once with the
  desktop pool.
  - `parts` = 1 − full/field: the share of the field-only contrast that the particles take away.
- **View:** 28-38 kn air north-east of the bench storm. Because the line grid is the same at every zoom,
  this mode is the one to compare ZOOMS with (the real map's content changes with the camera).

`parts` on 2026-10-09 (AMD Radeon 890M), before and after `WIND_CLOSE_LAND` (light 0.65, beach 0.65, dark 0.8):

| parts | z6 | z7 | z8 | z9 | z10 | z11 |
|---|---|---|---|---|---|---|
| light, `dev` before #291 | 0.40 | 0.58 | 0.64 | 0.60 | 0.53 | 0.54 |
| light, 0.65 | 0.40 | 0.43 | 0.43 | 0.40 | 0.35 | 0.36 |
| beach, before | 0.25 | 0.37 | 0.40 | 0.37 | 0.33 | 0.35 |
| beach, 0.65 | 0.25 | 0.27 | 0.26 | 0.25 | 0.21 | 0.23 |
| dark, before | 0.24 | 0.31 | 0.34 | 0.29 | 0.25 | 0.26 |
| dark, 0.8 | 0.25 | 0.27 | 0.28 | 0.24 | 0.21 | 0.22 |

The field alone keeps about 0.80 in light and beach and 0.49 in dark, at every zoom.

## Map mode (`map-run.js`): the owner's real basemaps

```bash
node scripts/wind-bench/map-run.js                      # served strength, all themes, z6-11
node scripts/wind-bench/map-run.js --scale 2.3          # storm strength (Mobile Bay median ~30 kn)
node scripts/wind-bench/map-run.js --themes dark --zooms 8,9 --arms '{"now":{},"thin":{"__RAW_WIND_CLOSE_THIN__":2}}'
```

Land mode answers "how does the cost move with zoom" on fixed content. Map mode answers "what does
the owner actually see":

- **Basemap:** the Mapbox styles the app loads (navigation-day-v1, outdoors-v11,
  navigation-night-v1) in MapLibre 5.
- **Engine:** the real engine as a custom layer at the app's slot, under borders and labels, with the
  app's coastline above it.
- **Data:** a served grid, `fixtures/eye-2026-10-09-gfs-native.json` (GFS, 0.25°), over a 2° world
  base, viewed at Mobile Bay, the owner's view.
- **Token:** it needs `REACT_APP_MAPBOX_TOKEN` (the app's public token) from the environment or
  `frontend/.env`. The runner hands it to the page in memory and never writes or prints it. A run
  costs a few hundred Mapbox tile requests.

Each camera is shot three ways from the same tiles and particle seed: `off` (no wind), `field` (a
2×2 pool) and `full` (scored at 5 moments 0.2 s apart; medians). The metrics are computed at CSS-pixel
scale over the basemap's own EDGE pixels (gradient ≥ 0.04 with the wind off), each scored between
that line's own line pixel and ground pixel as found on the bare basemap:

| column | meaning |
|---|---|
| `retF` / `retP` | share of each line's bare-basemap L* contrast kept under the field / field + particles |
| `pLoss` | the particles' share: 1 − retP/retF (the twin of land mode's `parts`) |
| `lostP` | share of lines under half their contrast |
| `3:1F` / `3:1P` | share of the basemap's ≥ 3:1 lines still ≥ 3:1 (WCAG 1.4.11) |
| `gsP` | a GMSD-style gradient similarity, as a cross-check; it cannot tell whose edge it is |
| `sal` | mean \|dL*\| the particles add over the field alone |

Score each line between its own two pixels. The first version took a 5×5 min/max AFTER compositing,
so a particle's bright ring counted as line contrast, and lines read as more legible with particles
on (85% → 94% at 3:1). It also writes `out/map-sheet.html` (off | field | full per arm), which is how
the owner sees an A/B without a deploy.

Instrument choices and their sources: `reports/Wind particle close zoom legibility.md`.

## Path mode (`path-run.js`): wind colour vs map colour, through every kind of camera move

```bash
node scripts/wind-bench/path-run.js                                   # light, beach, dark; every path
node scripts/wind-bench/path-run.js --themes beach --paths erratic --seeds 1,2,3
node scripts/wind-bench/path-run.js --field --paths erratic,jitter    # the colour field alone: glued to the map?
node scripts/wind-bench/path-run.js --arms '{"off":{"__RAW_DISABLE_WIND_BASEMAP_MUTE__":true},"mute":{}}'
```

The owner asked for tests "through zooms and pans of all types, even erratic", after reporting "ambiguity to the wind
color vs the color of the map". Same basemaps, engine, data and token as map mode.

**Paths** (`paths.js`). A virtual 60 Hz camera, at rest before and after each path:
- `pan`: steady drag at z8;
- `fling`: release into inertia;
- `zoomIn` z5 → z10.5 and `zoomOut` z11 → z5;
- `pinch`: an off-centre focal point that drifts;
- `jitter`: z5.7-7.9 at 2 Hz across the close-zoom ramp, with a circling pan;
- `erratic`: a seeded random walk with bursts to 2500 px/s and 4 z/s, pauses and one-frame jumps (3 seeds span
  z4.5-11).

**Two passes, so no paint change happens mid-path.**
1. At rest at every sample camera: the original map, its water mask and its line work.
2. The path flown with the basemap mute as the app sets it. Each sample is captured twice without advancing the
   engine: wind on, and the map alone as shown.

MapLibre fades paint over 300 ms and re-parses tiles in a worker for data-driven colours, so the bench sets the
transition to 0 and settles before reading (LESSONS L-V19).

**Metrics** (`ambiguity.js`, half CSS-pixel scale, CIEDE2000):

| column | meaning |
|---|---|
| `hue30` | wind-coloured pixels whose hue sits > 30° off the legend colour for the TRUE speed under them (the served grid, sampled per pixel). The ground bending the wind into another band's colour; dark's alpha-over is the null control |
| `conv` / `mapLk` | wind-touched pixels within 5 ΔE00 of another map feature's colour: the style's own area palette (convention) / the colours on screen |
| `windLk` | map area painted in legend colours (C* ≥ 10, within 8 ΔE00) |
| `coast/bare` | ΔE00 across every coastline crossing (water 2 px in, land 3 px in, past the stroke), under the wind / on the original map |
| `keptMp` / `keptCm` | the original map's colour edges (ΔE00 ≥ 8, hue-only edges included) kept in the map as shown / under the wind |
| `retL` / `retW` | map mode's L* line retention, land / water, against the original map |
| `cover`, `pops` | pixels the wind visibly changes; flash or drop-out samples |
| `warpW` / `warpM` | `--field` only: the previous sample warped by the exact camera change, wind on / map alone. The excess is the field's own swimming or popping |

It writes `out/<tag>-sheet.html`, every sampled frame with its numbers.

## Lane mode (`lane-run.js`): the HRRR wind lane across tiers, pans, upstreams and zooms

```bash
node scripts/wind-bench/lane-run.js
node scripts/wind-bench/lane-run.js --images out/lane-images --json out/lane.json
```

The same instrument as eye mode, on the tiers AS `/grid` SERVES THEM after the HRRR wind lane (backend
`weather_pipeline/wind_lane.py`, D-017). `fixtures/lane-*.json` and `fixtures/gfs-*.json` are built by
`backend/scripts/wind_lane_bench_fixtures.py`, which runs the production `apply_wind_lane` on 2026-10-09 15Z tiers:
- NOAA GFS 12Z f003;
- Open-Meteo `gfs_global`;
- the HRRR 12Z lane, f00-f08.

The tiers:
- the 2-degree world tier;
- a 0.25-degree tile;
- Open-Meteo dynamic boxes A and B;
- NOAA native-recovery boxes A, C and D;
- the 3 h taper's steps;
- the `florida_east_coast` tile with and without the lane.

Rows:
- **Null (gated):**
  - tier/pan: four boxes, two GFS upstreams, vs box B;
  - zoom: z5.5-7;
  - upstream: the same box from Open-Meteo and from the NOAA recovery, i.e. the breaker/cache order.
- **Positive (gated):** the old mixed pair (eye-mode fixtures A and B) must not be the same eye.
- **Reported:**
  - the lattice (0.25 vs 0.5 deg);
  - the eye through the taper.

Exit `0` when every null holds and the positive control fails, `2` otherwise. `--images` writes PNGs of the drawn
field with the 30-kn (eye) or 15-kn (coast) contour in white. They come from `eyeShot` in the page.

2026-10-09 (AMD 890M, D3D11):
- every null row: 0.0-0.2 km, the same 40-kn closing T, area x1.00;
- positive: 38.3 km;
- lattice: 0.5 km, area x0.30;
- taper steps: 6.5-10.2 km per hour.

See `docs/weather-program/log/2026-10-09-hrrr-wind-lane.md` §5.

## What it renders

- **Canvas:** 897 × 914 css px (the owner's map pane) at a fixed DPR 2, WebGL2. The camera is
  MapLibre-equivalent Mercator with 512 css px per world tile (`camera.js`).
- **Field** (`field.js`): a climatology of trades, westerlies and smooth perturbations, plus a
  Holland-profile hurricane (vmax 52 kn, rm 0.45°, B 1.6) at -89.5, 25.5. It is point-registered
  at 2° over the world, at 0.25° over -100..-78 / 16..36, and as a 2° clip of that same box.
- **Load order:** the world grid first, then the view's regional grid, as the app does.
- **Frames:** 180 per configuration. The final frame's trail buffer (`engine.screenA.fbo`) is
  read back and scanned.
- **Deterministic:** `Math.random` is seeded per view, theme and `--seed`. A virtual clock advances exactly
  one 60 Hz frame per draw, because `frameTimeScale` reads `performance.now()` and rAF jitter
  otherwise makes every run differ. Both variants of a pair therefore start from the same
  particles, and the same tree gives the same numbers on every run.
  - If two variants come out identical in every view, the table says so. That means the engine
    reads none of the levers that tell them apart: e.g. #281's kill switches on a tree older than
    #281.

## What the columns mean

| column | meaning |
|---|---|
| `ink` | mean max(R,G,B) of the trail buffer, 0-255. The legacy composite's alpha is brightness, so this is what the eye sees. The approved look is about 150. |
| `sat` | share of pixels above 200 (a saturated carpet reads high) |
| `st/sl` | lit-pixel (> 32) brightness of the fastest 5-kn band on screen over the slowest non-calm one. Lit pixels only, so it compares how bright a fast mark is with a slow one, not how many there are. |
| `art` | significant non-calm clusters / their blocks |
| `ms` | mean rAF interval (16.7 = holding 60 fps) |

## The scanner (`scanner.js` and `replicates.js`, tested by `src/components/map/windBenchScanner.test.js`)

1. **Blocks:** cut the trail buffer into 32 css px blocks. Ink is the mean max-RGB.
2. **Residual:** each block's ink over the median of the blocks 2-4 away (a square ring). The
   near ring is left out so a shape a few blocks wide cannot hide inside its own reference.
3. **Clusters:** residual < 0.72 (HOLE) or > 1.38 (BLOB), joined 4-connected with others of the
   same sign.
4. **Null:** shuffle the same ink across the same blocks 30 times (seeded). The 95th percentile of
   each shuffle's largest cluster is what chance makes, so only bigger clusters are significant.
   Without this, a sparse z10 field showed fake artifacts, and two identical renders disagreed
   (4 vs 7).
5. Clusters slower than 5 kn are **calm** (thin slow air is patchy by nature). Every other
   significant cluster is an **artifact**.

## Replicates (`--seeds N`)

One render is one draw of the particle lottery. On 2026-10-09 the same PR #281 engine scored 6,
12 and 11 candidate artifacts on seeds 0, 1 and 2. The large shapes recurred every time, while
1-4 block clusters at the null floor came and went. Two cases dominate the flicker:

- the null measured chance as 0 blocks, so one block at residual 0.71 counted;
- holes at 5.0-5.8 kn, just above the calm cutoff.

With `--seeds N`, every configuration renders N times (seeds n, n+1, ...):

- An artifact **counts** only if the same kind, centred within reach (2 blocks, or half the shape's
  width when that is larger), appears in a **majority** of seeds. The rest are reported as
  `flickering`, not counted.
- `ink`, `sat`, `st/sl` and `ms` are seed means.
- The positive control must hold in **every** seed. One blind seed makes the run BLIND.

**Quote artifact counts from `--seeds 3`.** A single seed is fine for the control and for ink.

## The positive control

A bench that cannot see a known defect proves nothing when it sees none. Before #281, the casing
pole was applied per pixel on a bilinear grid, so it traced each top-speed contour: inside it,
marks went dark (a HOLE near 44 kn here); just outside it, a ring over-inked (a BLOB near 34 kn).
`__RAW_DISABLE_WIND_FIXED_CASING__` brings that back. Its status is decided at dark z8 on the
0.25° grid:

- **BLIND:** `shipped` lacks either shape (±5 kn), so the scanner is blind and the run is invalid.
- **FAIL:** `candidate` still shows either shape.
- **PASS:** `shipped` shows both shapes and `candidate` shows neither.

The control runs its own arms, `controlShipped` and `controlCandidate`: the pair above with the
dark palette PINNED (`__RAW_DISABLE_WIND_DARK_CVD__`). #292's colour-blind dark palette made the HOLE
too faint to score, and the control went BLIND on a healthy scanner. The field still crosses the casing
pole at about 41 kn, but the warm bands above it are lighter. A control must not depend on the palette
of the day. The full matrix still renders the shipped palette, and on a tree without the lever the pin
is simply unread. On 2026-10-09 it read PASS on `dev` (HOLE 41 blocks @ 44.1 kn, BLOB 35 @ 35 kn) and
on the merged close-zoom work (HOLE 47 @ 44 kn, BLOB 42 @ 34.3 kn).

### Baseline, 2026-10-09 (AMD Radeon 890M, D3D11, headless Chromium)

| engine | shipped | candidate | verdict |
|---|---|---|---|
| `dev` with #281 (`9ef7a3c0`; `frontend/src` identical to the #281 head `ad228735`) | HOLE 41 blocks @ 44.1 kn, BLOB 35 @ 35 kn (in each of 3 seeds) | none | **PASS** |
| `dev` before #281 (`f364efce`) | HOLE 41 @ 44.1 kn, BLOB 35 @ 35 kn | the same, plus the "rendered IDENTICALLY" warning (that tree has no kill switches) | **FAIL** |

Full matrix on PR #281 with `--seeds 3`:

- **Recurring artifacts:** shipped 12 in 8 of 39 views; candidate 9 in 6 of 39 views.
- **Dark ink:** 67-133 shipped, 99-159 candidate.
- **Frame time:** 16.7 ms everywhere.
- **Every shipped shape of 10+ blocks above 7 kn is gone in the candidate.** The largest was a
  60-block hole at 47 kn at z7.
- **What the candidate still shows:**
  - world-z4 holes at 5.1-5.4 kn, at the same places as shipped's (pre-existing, just above the
    calm cutoff);
  - a 3-4 block blob at the storm's eye at z6.5-7, where shipped had 12 blocks;
  - one 4-block hole in a screen corner at z6.5.

## Adding a variant

A variant is a set of window levers applied before the engine is created (`matrix.js`):

```js
const VARIANTS = Object.freeze({
  shipped: { label: '...', levers: { __RAW_DISABLE_WIND_SPEED_KEEP__: true, /* ... */ } },
  candidate: { label: 'engine as written', levers: {} },
  noWideTrails: { label: 'candidate without wide-zoom trails', levers: { __RAW_DISABLE_WIND_WIDE_TRAILS__: true } },
});
```

Then run `node scripts/wind-bench/run.js --variants candidate,noWideTrails`. The page deletes
every `__RAW_*` window key between configurations, so levers never leak.

- **Check the engine reads the lever** (`git grep <lever> frontend/src`). An unread lever is a
  silent no-op, which the "rendered identically" warning catches.
- **To compare two commits** rather than two lever sets, run `--ref` twice. The table rows line up.
- **A new defect class needs its own positive control.** Re-create it with a kill switch, add its
  expected shapes next to `POSITIVE_CONTROL`, and check the shipped side is not BLIND before
  trusting a clean candidate.
- **Changing the field, the canvas or the scanner thresholds starts a new baseline.** Say so in
  the PR.

## Limits

- Numbers repeat exactly for one browser on one GPU, not across them. On 2026-10-09 the in-app
  browser pane read candidate ink 165 where headless Chromium read 159 for the same commit.
  Compare variants within one run, or two `--ref` runs on the same machine.
- The in-tab page is driven by requestAnimationFrame, which a hidden tab or pane pauses. Keep it
  visible while it runs, or use the headless runner.
- It is the engine on a synthetic field, not the app. MapLibre, the basemap tiles, real served
  grids and the owner's display are outside it, so a visual change still needs the owner's eyes
  in their browser before it ships.
- `ms` from headless Chromium on a desktop GPU is not a phone. Use `--res 192` for the phone pool,
  but not for phone frame times.
- `--gl swiftshader` (or a machine without a GPU) renders correctly but slowly, and `ms` is then
  meaningless.
