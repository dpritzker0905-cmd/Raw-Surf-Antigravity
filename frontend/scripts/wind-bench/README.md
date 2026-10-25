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

### The style columns (`style.js`): what do the marks look like against what they sit on?

```bash
node scripts/wind-bench/map-run.js --themes dark,light,beach --zooms 6,8          # the second table is the style table
node scripts/wind-bench/map-run.js --themes light,beach --zooms 6,8 --arms '{"before":{"__RAW_DISABLE_WIND_GLOW__":true},"glow":{},"ink":{"__RAW_WIND_INK__":true}}'
node scripts/wind-bench/map-run.js --crop 900x640            # also write a centre crop of every shot at DEVICE resolution (PNG)
node scripts/wind-bench/map-run.js --crop 900x640:jpeg       # the same as JPEG, for a page that embeds many of them
node scripts/wind-bench/map-run.js --lng -90.1 --lat 29.9    # another camera
node scripts/wind-bench/map-run.js --offline --gl swiftshader # no token, no network: a synthetic basemap (below)
```

"Dark looks great, light and beach look pale" is a statement about the streaks, so map mode reads them directly. A MARK
pixel is one the particles changed by more than 4 dE76 against the field-only frame from the same camera, tiles and
seed. Over the mark pixels of each surface, at device resolution (a streak is 1.5-4 CSS px wide):

| column | meaning |
|---|---|
| `cover` | share of the surface's pixels that are mark pixels |
| `dL med [p10, p90]` | signed L* of a mark pixel against the field under it (+ = lighter than its ground) |
| `\|dL\|` | mean \|dL\|: how hard a mark stands off its ground |
| `strong` | share of mark pixels at least 15 L* off the ground |
| `lighter` | share of mark pixels lighter than their ground: 1 = light on dark, 0 = ink on paper, in between = a mark whose halves cancel |
| `L f>mark` | median L* of the field under the marks, then of the marks |
| `C* f>mark` | median chroma of the field under the marks, then of the marks: does the mark carry colour or wash it out? |
| `dh` | median hue difference, mark against field, where both are chromatic |
| `wash` | `cover` × `dL`: the lightness the marks add to the whole surface |
| `darker` | share of mark pixels darker than their ground: what gives a mark an edge on a pale ground |
| `end` | field L* + `wash`: about where the picture ends up once the marks are on it. The row ends with the verdict, `ok` or `wash` |

**The wash (LESSONS L-V28).** Light under dark's streak method was picked from still crops and seen live to wash the picture out. The
plain product (`wash`) cannot be the bar: on the offline map at z6 dark adds the most (+7.8 over land) and beach, liked live, more than
the failure (+6.6 against +3.3). What separates them is where the picture ends: the failure at L* 74 with no mark darker than its
ground, beach at 68, dark at 32. A surface reads `wash` when it ends above `WASH_BAR.end` (71) AND fewer than `WASH_BAR.darker` (15%) of
its mark pixels are darker than the ground (`style.js`). Two live anchors make it provisional: re-anchor it on the real basemap.

- **What dark reads** (Mobile Bay, served strength, land): `lighter` 0.97-1.00, `dL` +9.5 to +14.5, chroma kept or raised,
  `dh` 3-4 degrees. A streak is one polarity and a brighter shade of the colour it rides on.
- **What light and beach read today:** `lighter` 0.63-0.91, `dL` +2.5 to +5.5, chroma lowered. A black rim, a white ring
  and a dark core share two or three pixels and cancel.
- **`--crop`** exists because the 448 px contact sheet turns 1 px streaks into texture. Judge a look on the crop.
- **`--offline`** runs map mode with no token and no network (2026-10-10, a cloud session without `REACT_APP_MAPBOX_TOKEN`): a
  synthetic style with each theme's measured land and water colours (the palette checker's), a rough Gulf and Atlantic coast, a road
  lattice on the land and the `admin-` anchor (`map-entry.js` `OFFLINE`). The mute, the water mask, the style and wash columns and the
  crops run as on the real styles. No labels, no coastline stroke, no terrain: compare arms within one offline run, not with a Mapbox
  run. Its control (light at z6, today against glow) read +6.0 / 0.72 lighter and +8.0 / 1.00, against the Mapbox run's +5.0 / 0.64 and
  +7.0 / 0.98: the same order, about 1 L* high. In a container without a GPU add `--gl swiftshader` (about 5 minutes a shot).
- **The land mask** (2026-10-11, dark's rules, DECISIONS D-020). Light and beach pick each mark's streak row by the land under it
  (`src/components/map/windLandMask.js`), from a land file the engine fetches at the page's origin. `map-run.js` serves it: the
  app's own Natural Earth file on the real basemaps, and the OFFLINE basemap's own coast with `--offline` (`page/offline-coast.js`:
  the offline map is not the Earth, and a mark over its land must not draw a sea row where the real Gulf is). The page waits for
  the mask to settle before a mark is scored. The MARKS table ends with what the mark shader was told on the shot's last frame:
  `mask 1` = it read the mask; `mask 0` = every mark drew its land row (dark, the kill, an engine before the mask, or a file that
  failed, which it says). **`--no-land-file` is the mask's control:** no file is served, the fetch fails, every mark draws its land
  row. On 2026-10-11 (z6, served strength) the LAND columns were identical with and without the file, and the WATER step fell from
  +17.5 to +12.5 (light) and +18.5 to +14.5 (beach) with it, the sea's streaks nearly twice as colourful (C* 32.5 → 53.5,
  40.0 → 55.0): the mask is aligned and does what it was solved to do. `path-run.js` serves the app's file too and ends each run's
  line with `mask 0` / `mask 1`. The scanner, eye, ladder, land and lane runners have no coast and serve none: their marks draw
  their land rows. **The file is answered by each run's own server (`serve.js` `serveDir(..., { land })`), never left in the shared
  `out/` folder:** the first version wrote it there, and the next runner served the last runner's coast (LESSONS L-V38).
- **The marks' table has two rows** (land, sea) since the same change. The eye and ladder modes swap a threshold ramp into it, and
  must replace the WHOLE table (`texImage2D`, not a one-row `texSubImage2D`): with a sub-image the second row kept the palette,
  dark's field read the mean of both, and every row read "no closed eye" with no GL error. Check after any change to a table's
  shape: `eye-run.js` against `eye-run.js --ref <the commit before>` must print the same lines.
- **Dark's rules are the default in light and beach**, so `candidate` and an empty arm draw them. Their kill is the arm to compare
  against: `--arms '{"today":{"__RAW_DISABLE_WIND_DARK_RULES__":true},"rules":{}}'` in map mode, `--variants
  candidate,before-rules` for the scanner. Control for the kill on the GPU: `--ref <the commit before>` with an empty arm reads
  the same on every metric as the working tree under the kill (2026-10-11: light, beach and dark at z6, identical).
- **Since the white streak (2026-10-11, D-021) `candidate` and an empty arm draw dark's rules with dark's own ring**, and light
  draws its deeper field under it. The arm to compare against is that change's kill:
  `--arms '{"before":{"__RAW_DISABLE_WIND_WHITE_STREAK__":true},"white":{}}'` in map mode, `--variants candidate,before-white` for
  the scanner. On dev's own code the same look is `{"__RAW_WIND_LIGHT_LOOK__":"deep","__RAW_WIND_GLOW_RING__":1}` (light) and
  `{"__RAW_WIND_GLOW_RING__":1}` (beach).
- **Since dark's white by the ground (2026-10-12, D-022) `candidate` and an empty arm lay the white streak at full strength over land
  and at a share of it over the sea** (`DARK_WHITE`: 0.55 in light and in beach; beach's was 0.77 until 2026-10-12), picked by the
  land mask. The arm to compare
  against is its kill: `--arms '{"full":{"__RAW_DISABLE_WIND_DARK_WHITE__":true},"now":{}}'` in map and motion mode. **It needs a land
  file:** with none (the scanner's page, `--no-land-file`) every mark is laid as over land and the two arms are the same picture, by
  construction (`--variants candidate,full-white` in the scanner reads equal for that reason, not because the change is safe).
  Read it with `mirror-run.js --at`, land and sea apart (below).
- **To ask "are these two arms the same pixels", use `--offline --crop WxH:png` and compare the crops by hash.** The offline
  basemap is the same pixels every run (2026-10-11: 108 of 108 crops identical between dev's code with those levers and the
  built default, zooms 4 to 10 and storm strength). The Mapbox basemap is not: its bare-map shot, with no wind at all, differed
  between two runs at zooms 6, 8 and 10, and the line-survival columns moved with it by up to 0.003 in dark, whose code had not
  changed. On Mapbox tiles compare the style columns, and read a difference that size in the line columns as the basemap's.
- **Light's look A/B** (`window.__RAW_WIND_LIGHT_LOOK__`, `WindColorRamp.js`): the scanner names it `--variants
  candidate,light-moderate,light-deep,light-ink`.
- The two models built on these columns are in `windInk.js`. Glow is the default in light and beach since 2026-10-10
  (D-019; kill `__RAW_DISABLE_WIND_GLOW__` draws the marks before it); ink is a lever (`__RAW_WIND_INK__`), default
  off. The artifact scanner can name them: `node scripts/wind-bench/run.js --seeds 3 --themes light,beach --variants candidate,glow,ink`.
  They stay out of the default matrix.

## Motion and mirror modes (`motion-run.js`, `compose-video.js`, `mirror-run.js`, `page/mirror-probe.js`): how far is a theme from dark, in motion?

Dark is the model (owner, 2026-10-11). Two looks passed the still-frame columns above and were rejected on the owner's screen
(DECISIONS D-020, D-021), so these modes read the MOVING picture, and read it with a probe that also runs in the deployed app.

```bash
node scripts/wind-bench/motion-run.js --runs runs.json --out scripts/wind-bench/out/motion.json --dpr 1.5     # every 60 Hz frame, a still camera
node scripts/wind-bench/mirror-run.js --motion scripts/wind-bench/out/motion.json --at 0.5,0.12 --size 360   # each run beside dark's: here, the land
node scripts/wind-bench/mirror-run.js --motion scripts/wind-bench/out/motion.json --at 0.5,0.9 --size 360    # and the sea
node scripts/wind-bench/compose-video.js scripts/wind-bench/out/videos/side.webm 3 500 60 2 "title" "DARK=run-a" "BEFORE=run-b" "NOW=run-c"
```

- **Paths are read from where you stand** (`frontend/`), so write them out as above: the first version of this block said
  `out/motion.json`, which is `frontend/out/`, not the bench's own `out/` (the frames always go to the bench's
  `out/motion/<name>/`). **Every number recorded from this mode was read with `--size 360`** (the crop's side in CSS pixels;
  the default is 420, and a different crop reads a different lift): pass it to compare with a recorded number.

- `runs.json`: `[{ name, theme, z, scale?, levers?, frames?, lng?, lat?, behind?, res?, force? }]` (`res` and `force`: Truth mode, below); frames land in `out/motion/<name>/`. `--dpr` is the device
  pixel ratio the page renders at: the owner's laptop is 1.5, every other mode here runs at 1. Needs the Mapbox token as map mode does.
- **`page/mirror-probe.js` is ONE file with two entries:** `capture()` on a live canvas (paste the file into the deployed app's
  console, or run it through a browser connector, then `await __mirrorProbe.capture({ at: [0.3, 0.6] })`) and `fromImages()` on saved
  frames (`mirror-run.js`). Per pixel it keeps the darkest moment (the ground), the lightest (a streak's core) and the mean. Columns:
  `ground`, `picture` and **`lift`** = picture - ground (how far the streaks raise the whole picture; dark's lift is the bar), `peak` and
  `step` (a core against the ground under the same pixel), `kept` (core chroma / ground chroma: 1.0 is the ground's own colour made
  lighter, dark's relation; near 0 with `peak` 100 is paper white), `cover` and `reach`, `flicker`.
- **Read land and sea apart** (`--at`). Dark's map is light's and beach's turned over (a near-black land and a slate sea; theirs a
  pale land and a deep sea), so one number over a mixed crop can read "equal to dark" while both grounds are wrong: on 2026-10-11
  the centre crop read 1.05 of dark's lift where the land read 0.85 and the sea 1.62 (LESSONS L-V43).
- `compose-video.js` plays runs side by side as one WebM through the ffmpeg Playwright installs (there is no system ffmpeg).
- Baseline, 2026-10-12, D-022 built (Mobile Bay, served wind, dpr 1.5; lift against dark's at zooms 6 / 4 / 9): over the sea light
  1.03 / 1.22 / 1.07 and beach 1.01 / 1.34 / 0.91; over land light 0.85 / 0.74 / 0.26 and beach 0.93 / 0.80 / 0.69.
- **Baseline since beach's sea strength is 0.55** (2026-10-12, D-022 amended; same view, same crops): over the sea beach
  0.80 / 1.19 / 0.74 (its kill 1.23 / 1.46 / 1.06, light 1.03 at zoom 6, dark's lift 12.6 / 10.4 / 6.9: the numbers before, to the
  digit); over land 0.93 / 0.80 / 0.69, unchanged.
- **THE FIXTURE IS A HURRICANE, and a crop's wind is read from the fixture, not from this page** (LESSONS L-V50). At zoom 6 the
  sea crop (`--at 0.5,0.9 --size 360`: 26.6 to 29.7 N, 89.8 to 86.3 W) holds a 42 kn field (quartiles 36 and 47, top 77); the land crop
  (`--at 0.5,0.12`) lies mostly NORTH of the fixture's box (25 to 32 N), where the bench draws its own light climatology, which a
  run's `scale` does not touch. `"scale": 2.3` is a 95 kn sea (`map-entry.js` describes it by the bay's own median).
  **Sweep the wind with `scale`:** the lift against dark's is not one number per theme. Zoom 6, the sea, the crop's median
  8 / 17 / 42 / 95 kn (`scale` 0.2 / 0.4 / 1 / 2.3): beach at 0.55 reads 1.10 / 0.96 / 0.80 / 1.07 (its kill 1.57 / 1.23 / 1.70 from
  17 kn), light at 0.55 1.11 / 1.05 / 1.03 / 1.23 (its kill 1.72 at 17 kn), dark's own lift 7.3 / 9.6 / 12.6 / 11.8. The low reading is
  the band where beach's field is pale (27 to 40 kn). The device pixel ratio moves it little (`--dpr 3` at 42 kn: beach 0.84,
  its kill 1.35, light 0.98).
- **A frame pixel is not a map pixel.** The bench's map is 897 x 914 CSS px (`page/map.html`), drawn at a map pixel ratio of 2
  whatever `--dpr` says (that flag sets the PAGE's ratio; `--map-dpr` sets the map's), and a motion frame is that view scaled to
  1000 x 1019. To turn a crop into a place, multiply frame pixels by 0.897 before Mercator: the zoom 6 view spans 92.98 to 83.12 W,
  not 11 degrees. The first reading of this page's crops skipped that and placed every crop about 11% too wide (the sea crop
  read 39 kn where it holds 42; found by the simplification lane, PR #317).

### The page behind the map, and the canvas's alpha (2026-10-12, D-027)

- **Every frame these modes save is laid over the page the app lays behind the map:** near white (`#f9fafb`, Tailwind gray-50) in
  light, black in dark and beach (`page/map-entry.js` `APP_PAGE`, pinned against `MapPage.js` by `windCanvasAlpha.test.js`).
  `motion-run.js --behind <css colour>` (or a run's own `behind`) lays another; a string that is not a CSS colour stops the run.
  Until this date every saved frame was taken from the BARE canvas. That is not the screen over any page: an encoder
  un-premultiplies a pixel (clamped at 255) and fills with black, so a pixel held min(channel, alpha): the brightest streak cores
  clipped darker in every theme, and in light the page's white left out (`page-colour.js`; LESSONS L-V72). Numbers read from
  saved frames before this date are not exact, the D-022 baseline above included.
- **Each motion run prints the map canvas's own alpha** (`canvas alpha min .. mean .. over N frames`: the least over every sampled
  frame). 1 and 1 means the page cannot matter. Every canvas read carries its alpha, and `map-run.js` and `path-run.js` print a
  WARNING when a scored read was taken on a see-through canvas (an older `--ref`, or the kill): their scored columns read the
  canvas's own colour, which is the screen over a BLACK page. `run.js`, `ladder-run.js` and `lane-run.js` (`page/bench-entry.js`)
  still save the bare canvas: right on a built engine, clipped on an older `--ref` or under the kill. Baseline (Mobile Bay, wind x0.4, zoom 6, page and map at 1.5): built, 1 / 1 in
  all three themes; under `__RAW_DISABLE_WIND_OPAQUE_CANVAS__` (dev's blends) dark 0.608 / 0.685, light 0.749 / 0.900, beach
  0.749 / 0.895.
- **Compare two arms at the same position in runs files that are otherwise alike.** A theme's first run on a fresh map and its second differ in 15 of
  90 frames (frames 1 to 39, beach; the same 15 on a repeat), whichever arm is which; two runs at the same position are the same
  bytes, 90 of 90 (the null control). What the page ran before counts too: light after two dark runs and light alone in a page
  differed in all 90. Read with a hash of each frame.
- **A run may draw the colour field ALONE:** `"res": 2` in runs.json (the particle pool's side; 384 by default). The mean
  picture minus the same crop drawn with the field alone is the light a streak ADDS, and it is the measure to compare themes by:
  the probe's own `lift` (the mean over each pixel's darkest moment) reads dark high and light and beach low (LESSONS L-V73).
  `--crop WxH --crop-fmt png` keeps the crops lossless: read a claim about a 1 px line there, the JPEG rings.
- `mirror-probe.js` `capture()` on a live canvas was not checked for this. On a build whose canvas alpha is under 1 (every
  deployed build before D-027) treat its light-mode numbers as unverified: the screen showed the page through the canvas.

## Truth mode (`truth-run.js`, `truth.js`, `force-uniforms.js`): what do the streaks do to the picture, against the field alone?

The mirror probe guesses the ground from the picture itself (each pixel's darkest moment). That reads a theme whose trails
DARKEN the field low and a theme whose trails never leave it high, both at once (LESSONS L-V73). Truth mode guesses nothing:
the ground is the SAME crop drawn with the colour field alone, and every pixel of every frame is read against it.

```bash
# runs.json: the streaks first (the first run on a fresh map), then the field alone ("res": 2) on the same map
#   [ { "name": "low-light", "theme": "light", "z": 6 }, { "name": "low-light-field", "theme": "light", "z": 6, "frames": 12, "res": 2 } ]
node scripts/wind-bench/ramp-fixture.js scripts/wind-bench/out/ramp-low.json --from 2 --to 30
node scripts/wind-bench/motion-run.js --runs runs.json --fixture scripts/wind-bench/out/ramp-low.json --dpr 1.5 --map-dpr 1.5 \
  --crop 240x330 --crop-fmt png --at "0.143,0.85;0.475,0.85;0.857,0.85;0.143,0.2;0.475,0.2;0.857,0.2" --trail --out scripts/wind-bench/out/truth.json
node scripts/wind-bench/truth-run.js "sea15=low-light@0.475_0.85:low-light-field@0.475_0.85" "land15=low-light@0.475_0.2:low-light-field@0.475_0.2"
node scripts/wind-bench/truth-run.js --law --level 0.7416 --check 1,0.505 "sea15=low-light@0.475_0.85:low-light-field@0.475_0.85"
node scripts/wind-bench/truth-run.js --same "low-light@0.475_0.85:again-light@0.475_0.85"     # the null control: the same bytes?
node scripts/wind-bench/truth-run.js --diff "low-light@0.475_0.2:again-light@0.475_0.2"       # or how far apart, CIE76 a pixel
```

- **Take the frames lossless, at device resolution, with the page and the map at the owner's pixel ratio** (`--crop WxH
  --crop-fmt png --dpr 1.5 --map-dpr 1.5`). A JPEG rings round a 1 px streak: on 1000 px JPEG frames dark's dip under its field over land at
  15.3 kn read 2.0 L* where the lossless crop reads 0.6 (log `2026-10-12-wind-canvas-alpha`). `truth-run.js` refuses a see-through frame (one an older bench
  saved from the bare canvas; `--clamp` counts what such frames lost, L-V72).
- **`--at` takes several centres** (`"fx,fy;fx,fy"`): every centre is cropped from the SAME frames, so the same particles are
  read at each place, and each crop is a run of its own named `<name>@<fx>_<fy>` for every reader of `out/motion/`. On a speed
  ramp a crop's centre is a speed: `from + (to - from) x fx` (the ramp spans the view's own edges; these crops are in canvas
  pixels, not the 1000 px frame's, so `ramp-fixture.js` `speedAt` does not apply). At zoom 6 `fy` 0.85 is the open Gulf and 0.2 is land.
- **The columns** (`truth.js` `watch`; all in CIELAB L* against the field alone; a pixel-instant is one pixel in one frame):
  `added` and `taken` (the light the streaks add, and take where a pixel is under the field), `over` (share of pixel-instants
  3 L* or more over the field: how much of the picture is lit at an instant), `under` (1.5 or more under it), `at field` (within
  1.5 of it), `back` (share of PIXELS that came back to the field at least once), **`darkest`** (a pixel's darkest moment
  against the field, median and the deepest tenth: under 0 means the trails dip under the field between streaks, over 0 means
  they never come back to it), `core` (its lightest moment: a streak's height), `weber`, `flicker`.
- **`--law` reads the composite's own arithmetic off the screen.** `motion-run.js --trail` saves, beside each frame's crop, the
  same crop of the engine's own trail buffer (`tNNN.png`: the ink before it met the map). With c the buffer's colour, b its
  strongest channel and g the field alone, a channel at a time, both branches of `SCREEN_FS` are members of one family:
  `screen - g = p x (b c - b^2 g) - q x b' (1 - b') g`, `b' = min(1, b / level)`. The first term is LIGHT, the second a VEIL
  (a black of alpha `q b' (1 - b')`). `truth-run.js --law` fits p and q by least squares and prints the residual in 8-bit
  levels beside each pure law at its own best strength. Dark's branch is `p = q = its opacity`; the glow branch is `q = 0`.
  `empty` is the screen's distance from the field where the buffer holds nothing: 0 says the three crops are the same pixels.
  **Read the law over the SEA.** Over land the map draws its own lines and names ABOVE the wind, and a pixel under one obeys no
  law of the wind's: `--check p,q` prints the share of pixel-channels a given law explains to 1.5 levels (88% to 93% over land,
  99.9% over the sea).
- **One variable at a time: a run's `force`** (`force-uniforms.js`). A lever in the app usually moves several things together
  (the white streak's kill also moves the field, the land's depth and both paths). `"force": { "screen.u_glow@map": 0 }` holds
  the real engine, its shaders and every default as they are and replaces ONE uniform on its way to the GPU: `<program>.<uniform>`
  with an optional `@map` (only while the map's framebuffer is bound: the composite, not the buffer's copy) or `@buffer`; a
  number, or two to four. The result keeps how often each fired, and a force that never fired stops the run and removes its
  frames (a misspelt uniform would otherwise be a run that measured the default). Bench only: nothing under `src/` reads it.
  Two limits: the pass is judged when the value is SENT (true of the screen, fade and draw programs; the advect program sends its
  uniforms before it binds its buffer, so it takes no suffix), and a forced value stays in its program until the engine sends that
  uniform again (the buffer's copy re-sends `u_opacity`, `u_glow` and `u_ink_cap`, not `u_premul`, `u_ink` or `u_trail_veil`).
- **Compare runs of EQUAL length.** `darkest`, `core`, `back` and `reach` are extremes over a run: a longer run reads a deeper
  darkest moment. `truth-run.js` says so when the runs it is given differ, and `--diff` when one run is longer than the other.
- **A saved run is reused only if it is this run** (`crops.js` `sameRun`): the same wind, page, levers, forced uniforms and crop,
  with the trail buffer if it is asked for. Where a crop is, and which crop of a frame goes to which run, is `crops.js` too.
- **Compare arms at the same run position, with a null control.** A second invocation of the same arm is the same bytes over
  the sea (90 of 90) and NOT over land: the map does not place its names to the bit (mean 0.04 to 0.10 CIE76 a pixel, 1% to 3%
  of pixels over 1). Read a claim of "the same picture" over the sea by hash, and over land by `--diff` beside that null.
- **The statistics are tested on frames with a known answer** (`src/components/map/windBenchTruth.test.js`): a streak that
  lingers over the field and one that comes back and dips under it, each alone; the law's fit on screens drawn by each branch;
  a buffer one pixel off and a map line above the wind as positive controls; the forced uniforms on a recording context.
- Baseline, 2026-10-12, dev `a022b398` (the low ramp, zoom 6, the sea; `darkest` / `over` / `added` at 6, 15.3 and 26 kn):
  dark -2.1, -2.2, -0.2 / 0.38, 0.58, 0.78 / 5.2, 8.2, 11.5; the law by `--law`: dark p 0.505, q 0.505; light and beach
  p 0.999, q 0.000, each to 0.3 to 0.45 of a level. Light, beach and the veil that followed (D-029: with it light and beach read
  p 0.999, q 0.505 at `--level 0.7416`): log `2026-10-12-wind-trails-linger`.

## Border mode (`border-run.js`, `page/border-probe.js`): can the borders and place names be read under the wind?

The owner, 2026-10-12: "the labels and borders need to be more visible. In dark mode they are white boarders and labels." Dark is
the bar. Map mode's line columns score every edge of the bare basemap (roads, coasts, rivers, label strokes); the political
borders are a few of them, and a theme whose borders had vanished read level with dark there. This mode reads the borders alone.

```bash
node scripts/wind-bench/border-run.js                                   # dark, light, beach at zooms 4, 6, 8; the tree as it is
node scripts/wind-bench/border-run.js --themes light,beach --arms '{"before":{"levers":{"__RAW_DISABLE_WIND_BORDER_INK__":true}},"ink":{}}'
node scripts/wind-bench/border-run.js --arms '{"now":{},"try":{"ink":"rgba(27, 30, 45, 0.85)"}}'    # a candidate before any code draws it
node scripts/wind-bench/border-run.js --arms '{"now":{},"top":{"windOnTop":true}}'                  # the control for the layer order
node scripts/wind-bench/border-run.js --inventory --crop 900x600 --at 0.5,0.3                       # each style's layers and paint; PNG crops
```

- **The lines come from the style, not from the picture.** Every layer is hidden but the border lines (line layers named `admin-*`,
  their casings `*-bg` apart), painted white on black: each device pixel then carries the line's own coverage. The place names
  (`state-`, `country-`, `settlement-*-label`) are found the same way. A RIDGE pixel is a land pixel on a line's centre, away from
  any label; its GROUND is the ring 1.5 to 2.75 CSS px from it that no border covers (the pale casing the styles draw under a
  border included: it is what the line sits on).
- **Four pictures of one camera:** `bare` (the theme's own map, wind off), `off` (the map as the app restyles it under the wind:
  the mute, the border ink; wind hidden), `field` (a 2 x 2 particle pool), `full` (field and particles, at 6 moments 0.2 s apart).
- **Columns**, medians over the ridge pixels: `dL bare / off / field / full` = |L*| of the line against its ground; `p25`; `sign`
  (+1 the line is lighter than its ground, dark's; -1 darker, ink); `retF` / `retP` / `lostP` = map mode's own columns over the
  border lines (each line's BARE contrast kept; above 1 = more than the bare map had); `weak` = share of (pixel, moment) pairs under
  5 L*; `3:1` = share at 3:1 or better against the ground (a new line counts, unlike map mode's `3:1P`).
- **`names moved` / `solid moved`** = the largest L* change of a pixel a glyph (or a border) covers whole, between the map alone
  and any moment under the wind. 0 means it is drawn ABOVE the wind. `windOnTop` is the control: 2026-10-12, dark at zoom 6 read
  0.00 in the app's slot and 41.0 with the wind forced on top, and the border's contrast fell from 20.9 to 10.4.
- **`--dpr`** (default 1.5, the owner's laptop) is the MAP's device pixels a CSS pixel as well as the page's: a 0.5 px border is
  0.75 of a device pixel there, and this mode scores at device resolution. An arm is `{ levers, paint, ink, windOnTop }`; `paint` and
  `ink` are laid after the app's own sync and lifted after the arm.
- **Baseline, 2026-10-12** (Mobile Bay, served wind, pixel ratio 1.5; `dL full` at zooms 4 / 6 / 8): dark 11.9 / 20.9 / 28.5.
  Before the ink: light 7.6 / 2.8 / 5.8 (`weak` 0.28 / 0.73 / 0.39), beach 4.0 / 4.7 / 3.0 (`weak` 0.59 / 0.51 / 0.76). With it
  (`rgba(27, 30, 45, 0.7)`): light 39.9 / 36.5 / 35.0, beach 38.9 / 34.4 / 31.6, `weak` 0.000 to 0.005. The kill arm reads the
  numbers before, to the digit. Names moved 0.00 (dark) to 0.27 L* (one 8-bit step) in every arm.
- **`wind under the lines`** is the served speed (kn, median and quartiles) under the ridge pixels: the wind the lines were read
  in. The fixture is a hurricane box over a 2-degree base and the land of this view is mostly outside it: 15 kn at zoom 4, 9 at
  zoom 6, 12 at zoom 9, and `--scale` moves it only inside the box. **Across the wind** (`--scale 0.4 | 1 | 2.3`, zooms 4, 6, 9):
  dark's line runs from 11.9 to 41.7 L* (weakest far out and under strong wind, where streaks pass under a light line; strongest
  close in and in calm air) while the inked line holds 30 to 46 in all 18 cells. So the ink is 3.2 to 3.4 times dark's at zoom
  4, 1.2 to 2.5 at zoom 6, and at zoom 9 from 1.71 down to **0.85** (beach, 4.7 kn): no one strength mirrors dark's line.
- **The last column is the restore, read from the library:** every paint value of every layer of the style (`getStyle()`), with
  the wind off before the arms and again after each. `exact` or `NOT EXACT` (exit 2); `(nothing moved)` when the arm restyled
  nothing. A fake map can only assume this; 2026-10-12, exact in all six rows at zoom 6.
- **Read the numbers as they are.** A ridge pixel is a local maximum of the line's coverage, so `dL` is the line at its
  best-covered pixels: an upper estimate of a typical pixel of it. Arms and themes compare fairly (the styles draw these lines
  the same width). Only state, country and settlement names are masked. A `windOnTop` arm lays the arm's restyle first and moves
  the wind after: it is the control for the order, not a picture of the app under its under-labels kill.
- **Two limits of the older modes, found here and NOT changed in them** (their numbers were taken this way):
  - `map-run.js` draws the wind over the style's OWN colours: its `shoot` never ran the app's restyle (the mute of #296 went into
    path and motion modes only). `--app-sync` runs it; the default is as it was.
  - The engine sizes a mark by the PAGE's device pixel ratio, and the map's canvas was always 2 device px a CSS px: at the default
    (page ratio 1) and at `motion-run.js --dpr 1.5` alike a mark is drawn smaller against the canvas than on any real screen.
    `motion-run.js --map-dpr 1.5` (with `--dpr 1.5`) draws the map at the owner's ratio; `--crop WxH --at fx,fy` keeps device
    pixels, so a 0.5 px line is not scaled away. The along-the-wind score is not taken off the canvas's own 2.
  - **What the two gaps did to recorded numbers (measured 2026-10-12, zooms 6 and 4; no verdict or chosen number moved):**
    without the mute, map mode's LAND rows are the same to 0.5 L* (beach's field over land reads C\* 32.5 instead of 23.5) and
    its SEA rows for light and beach sit on a sea 2 to 7 L* too light with a step 1 to 2 L* too small. With the canvas at 2
    instead of 1.5 the lift against dark's is off by 0.00 to 0.03 over the sea in the served wind and below it, by up to 0.09
    with the fixture scaled 2.3 times, and by 0.02 to 0.08 over land. The old way read D-022's recorded lifts to the digit.

### The coastline stroke (`--lines coast`, 2026-10-12, D-028)

```bash
node scripts/wind-bench/border-run.js --lines coast --zooms 4,6,8,10                                         # dark is the bar
node scripts/wind-bench/border-run.js --lines coast --themes light,beach --arms '{"ink":{},"kill":{"levers":{"__RAW_DISABLE_WIND_COAST_INK__":true}}}'
```

The wind layer lays a coastline stroke above itself (`WebGLWindUtils.js` `WIND_COASTLINE`, layer `wind-coastline`). `--lines coast`
runs the same probe on that one layer instead of the `admin-*` lines. A ridge pixel may lie on the sea and its ground is the ring on
BOTH sides of the line, so a land-sea step under the stroke is part of what it is read against. An arm's `paint` can restyle the
stroke before any product code does (`{"id":"wind-coastline","prop":"line-opacity","value":0.75}`); the `drawn` column is the
stroke's own read-back, `window.__WIND_COAST_INK__`.

- **Read, 2026-10-12** (L\* under field + streaks, zooms 4 / 6 / 8 / 10): dark 17.1 / 24.5 / 23.9 / 21.1 (a pale line). Light and
  beach in the borders' ink: 31.8 / 39.1 / 32.2 / 28.4 and 29.7 / 37.1 / 29.4 / 25.0; under the kill (the slate stroke of
  2026-10-09) 16.9 / 21.0 / 15.5 / 12.6 and 11.8 / 14.9 / 9.9 / 8.2.
- **This column alone would have kept the old stroke** (LESSONS L-V74): light's slate line read level with dark's pale one and
  Florida was not on the map at zoom 4. A dark hairline among white streaks does not carry like a pale one. Read `--crop` beside
  dark, on a land the eye has to find, before the number.

## Speed ramp (`ramp-fixture.js`, `motion-run.js --fixture`): one scene with clean axes

```bash
node scripts/wind-bench/ramp-fixture.js scripts/wind-bench/out/ramp-low.json --from 2 --to 30        # everyday winds
node scripts/wind-bench/ramp-fixture.js scripts/wind-bench/out/ramp-high.json --from 6.85 --to 60.6  # to a storm
node scripts/wind-bench/motion-run.js --fixture scripts/wind-bench/out/ramp-low.json --runs runs.json --out scripts/wind-bench/out/ramp.json --dpr 1.5
node scripts/wind-bench/mirror-run.js --motion scripts/wind-bench/out/ramp.json --at 0.33,0.2 --size 110     # land, 11.8 kn
node scripts/wind-bench/mirror-run.js --motion scripts/wind-bench/out/ramp.json --at 0.33,0.85 --size 110    # sea, the same speed
```

The hurricane fixture moves the wind's speed, the place and the zoom together: on it three lanes each solved a number that
failed in the next scene (DECISIONS D-022 and its amendment, LESSONS L-V50, L-V61). The ramp fixture blows due north everywhere
with a speed that rises with longitude, `--from` knots at the view's west edge to `--to` at its east edge (Mobile Bay, zoom 6), so
a column of the picture is ONE speed over land and over sea, a streak stays in its column, and every speed is on screen at once.

- **Where a crop sits is the bench's geometry, not the frame's.** The map is 897 CSS px wide and a frame is that view scaled to
  1000: the zoom 6 view spans 92.98 to 83.12 W. `ramp-fixture.js` prints the speed at the centre of each `--at x --size 110` crop
  (`speedAt`; the probe puts the crop's left edge at `round((1000 - size) * x)`), and `src/components/map/windBenchRamp.test.js`
  pins it against `page/map-entry.js` and `page/mirror-probe.js`. With the two fixtures above a 110 px crop spans 3.1 and 5.9 kn.
- **Along a ramp the place changes with the speed.** Compare two arms at the SAME crop; read a row along speed only over the
  open sea, where one crop is like the next. Land crops are different land (the 8.5 kn crop of the low ramp is the Mississippi
  valley).
- **A lever given to a run is named `__RAW_...`.** `page/map-entry.js` `clearLevers()` deletes only `window` keys that start with
  `__RAW_`; any other name leaks into every later run in the same page (found 2026-10-12: two "before" runs drew a prototype arm).
- Baseline, 2026-10-12, the land at the sea's depth built (D-026; this branch: light's sea strength 0.55, beach's 0.77, no other
  lane merged; lift against dark's at the same crop): see the log `2026-10-12-wind-land-depth` for the table.

## Ground mode (`ground-run.js`, `page/ground-probe.js`): what IS the map the wind is laid on?

Every lane's arithmetic starts from a land colour and a water colour a theme, and on 2026-10-12 the instruments held three
different sets of them (`check.mjs` and `mirror-model.mjs`, `windDarkRules.js` `BASE`, this bench's offline style). This mode reads
them from the two sources that cannot disagree with the app: the style as the library loaded it, and the pixels it then draws.

```bash
node scripts/wind-bench/ground-run.js                        # dark, light, beach at zooms 4, 6, 9: the land and the sea as drawn
node scripts/wind-bench/ground-run.js --areas                # also every area layer under the wind: its paint, own and muted
node scripts/wind-bench/ground-run.js --scale 2.3 --zooms 6  # the ground under a stronger wind
```

- **One row a surface:** `own` (the style's own map, wind off), `muted` (as the app restyles it under the wind, wind hidden), and
  `under the field` (that map under the colour field alone, a 2 x 2 particle pool: the ground a streak is laid on); each the median
  `[r, g, b]`, L\*, C\* and hue of the land or of the sea of the view. `wind` is the served speed under that surface (median and
  quartiles, kn): the bench's fixture is a hurricane box over a 2-degree base, and the land of the Mobile Bay view lies mostly
  outside the box.
- **`--areas`** lists every `background`, `fill`, `fill-extrusion` and `hillshade` layer under the wind in draw order, with the
  paint the style gives it and the paint the mute gives it, and names any such layer ABOVE the wind (none in the three styles).
- **Read, 2026-10-12** (Mobile Bay, served wind, page and map at 1.5):

  | | the style's own value | rendered, zoom 6 | after the mute | under the field |
  |---|---|---|---|---|
  | dark land | `land` `hsl(214, 17%, 31%)` = [66, 77, 92] | [58, 71, 79], L\* 29.3 (`landcover` below z7) | no mute | L\* 33.5 |
  | dark sea | `water` `hsl(197, 15%, 43%)` = [93, 117, 126] | the same, L\* 47.7 | no mute | L\* 42.5 |
  | light land | `land` `hsl(60, 0%, 99%)` = [252, 252, 252] | [247, 249, 244], L\* 97.7 | [249, 249, 248], L\* 97.9 | L\* 63.2 |
  | light sea | `water` `hsl(197, 98%, 78%)` = [144, 223, 254] | the same, L\* 84.9 | [174, 184, 189], L\* 74.2 | L\* 45.9 |
  | beach land | `land` `hsl(35, 32%, 91%)` = [239, 233, 225] | [228, 235, 194], L\* 91.6 (`landcover` to z12) | [230, 231, 226], L\* 91.4 | L\* 56.8 |
  | beach sea | `water` `hsl(196, 80%, 70%)` = [117, 207, 240] | the same, L\* 78.9 | [168, 180, 185], L\* 72.5 | L\* 50.2 |

  The mute takes the land's chroma and leaves its lightness; it darkens the sea by 10.7 L\* in light and 6.4 in beach. The wind
  under this view: 8.2 kn over the land (quartiles 5 and 11.5) and 25.9 over the sea (14.1 and 37.2) at zoom 6.
- **The ground moves with the wind, and not the same way in each theme** (`--scale`, zoom 6, the ground under the field, land /
  sea, L\*): at x0.4 (4.9 kn over the land, 10.5 over the sea) dark 29.6 / 44.2, light 68.6 / 46.6, beach 64.4 / 45.0; as served
  dark 33.5 / 42.5, light 63.2 / 45.9, beach 56.8 / 50.2; at x2.3 (12.5 and 59.7 kn; the sea's quartiles 33 and 86) dark 35.3 /
  42.8, light 62.4 / **29.9**, beach 59.4 / 38.8. Dark's sea holds within 2 L\* across the three; light's falls 16 under the
  strong field. A scene is its `--scale` AND the speed read under the surface: name both, never a round number of knots.
- **What it corrects in the other instruments' models (not changed here):** dark's land [18, 20, 26] is this bench's OFFLINE
  basemap, not the style (real L\* 28 to 32, not 6); `windDarkRules.js` `BASE.dark` (land [28, 37, 48], water [11, 29, 46]) is
  neither the style's land nor its water; light's modelled water [168, 214, 222] is 9 L\* lighter and far more chromatic than
  the muted sea; beach's modelled land [222, 208, 180] is a tan 7 L\* darker than the muted land of this view.

### How much of the map comes through (`--fixture`, `--strips`, `--full`, `--arms`; 2026-10-12, D-028)

```bash
node scripts/wind-bench/ramp-fixture.js scripts/wind-bench/out/ramp-low.json --from 2 --to 30
node scripts/wind-bench/ground-run.js --fixture scripts/wind-bench/out/ramp-low.json --strips 12 --full 60 --zooms 6
node scripts/wind-bench/ground-run.js --fixture <ramp> --strips 12 --arms '{"now":{},"before":{"__RAW_DISABLE_WIND_LAND_DEPTH__":true}}' --crop 900x640:jpeg
```

The owner, 2026-10-12: "I still cannot see the map as well through the wind animations on light or beach modes. Dark mode I can see
the map underneath it, better." A layer is seen through when the map's own contrasts survive under it with their sign (Metelli 1974;
Singh and Anderson 2002), and the map's largest is the land against the sea.

- **`--fixture <ramp>` and `--strips n`:** on the hurricane the sea is windier than the land, so the field's own difference reads
  as the map's. On a ramp a column is one speed over land and over sea: the picture is cut into n column bands and the land is read
  against the sea INSIDE each. The `equal wind` line gives the median over the bands (and the least and the most) as L\*, and
  `kept`: the share of the own map's land-sea Michelson contrast (on luminance) still there.
- **`--full N`:** also the picture WITH the streaks, the mean of N frames at 60 Hz in linear light; `adds` is its L\* over the
  field alone (the light the streaks add to that ground, LESSONS L-V73).
- **`--arms`:** a row set an arm; a lever is a `window.__RAW_...__` name. `--crop` saves own | muted | field | full an arm.
- **Read, 2026-10-12** (zoom 6, 3.2 to 28.8 kn; land minus sea): dark own -18.4, under the field -9.4 (kept 0.52), with the streaks
  -5.4 (0.25). Light own +12.7, as restyled +2.1 (0.19), under the field +1.1 (0.14); beach +12.7, +2.7 (0.24), +1.9 (0.23). With
  the land depth killed: light +23.7 restyled and +16.0 under the field (1.83), beach +18.9 and +12.3 (1.43). Light's and beach's
  field is a multiply and passes the map through: it is the restyle (the sea darkened, then the land to it, D-026) that flattens it.

- **Read after the land a step above the sea** (D-026 amended, 2026-10-12; the same ramp; `--arms '{"now":{},"before":{"__RAW_DISABLE_WIND_LAND_STEP__":true}}'`):
  light +12.5 restyled and +8.3 under the field (kept 1.03), a streak adding +14.5 L\* over land; beach +12.2, +8.0 (0.97), +14.7.
  Under the kill the lines above (+1.1 and +12.8; +1.7 and +12.2). Dark: -9.4, and its streaks add +11.8 over land and +8.4 over
  the sea. With the tail's veil on, light and beach add +11.7 and +12.0 over land.
- **The step's kill is read at the next SYNC, land and streak together** (`__WIND_BASEMAP_MUTE__.landStep` says which rule drew
  the land): a bench arm that sets `__RAW_DISABLE_WIND_LAND_STEP__` after the map is up must sync before it reads
  (`map-entry.js` syncs each arm; `--app-sync` runs the layer's own handler). `__RAW_WIND_BASEMAP_LAND_L__` sets a land that
  keeps the SEA's streak strength at every factor; pair it with `__RAW_WIND_WHITE_LAND__` to try another.
- **A phone's size and pixel ratio:** `--css 390x844 --dpr 3` in `anatomy-run.js` and `ground-run.js` (`--css 390x844 --map-dpr 3`
  in `motion-run.js`). The map is by default the owner's desktop pane, 897 x 914 CSS px, which every scored column and the ramp
  fixture's geometry assume: at 390 px wide a zoom-6 view spans 8.6 degrees, so a ramp shows a slice of its speeds (move the
  view with `--lng` for the slow end). It is the size and the pixel ratio only: the GPU and its shader precision are the bench
  machine's, not a phone's.
- **Near-calm air** (`windCalmAir.js`, D-030): read it on a slow ramp, `ramp-fixture.js <out> --from 0.4 --to 9`, then
  `anatomy-run.js --fixture <ramp> --arms '{"now":{},"off":{"__RAW_DISABLE_WIND_CALM_AIR__":true}}'` at zoom 6 (the ramp spans
  1 to 8.6 kn across the view there); at zooms 8 and 10 the view is one speed, so move it (`--lng -94.9 --lat 29.3` is a coast
  at 1 kn). At zoom 4 and out the ramp does not fill the view: film the hurricane slowed instead (`motion-run.js`, a run's
  `"scale": 0.3`). The lever `__RAW_WIND_CALM_LEVEL__ = [land, sea, from kn, full kn]` is laid as given at every zoom. **Its
  gauge has a cliff:** under a level of about 0.70 the marks fall under the 4 dE76 that makes a pixel a mark, and the count
  drops to a tenth; a count that matches dark's near that cliff is not a match (LESSONS L-V83).
- **A change that rides the mute's read-back does not draw in `map-run.js` without `--app-sync`** (the land's step and its
  streak strength, near-calm air): the plain run never syncs the basemap, so `__WIND_BASEMAP_MUTE__` is never written. An
  identity run without it compares two pictures of the build before (LESSONS L-V84).
- **Read `adds` from `--json`** (`rows[].land.full.L - rows[].land.field.L`), not from a printed row by column: dark's row ends in
  a shorter mute cell, and its field's chroma (14.8) was once taken for its `adds` (LESSONS L-V81).
- **The far-out zooms are read with this mode, not with the coast's line:** at zooms 2 and 3 (the app's far end is 2) the inked
  coast stroke read 1.6 times dark's (`border-run.js --lines coast --zooms 2,3`: dark 15.4 / 16.9, light 25.9 / 27.4) and the
  continents could not be found. A stroke is 0.4 px wide there; a land is seen by its tone (LESSONS L-V80).

## Anatomy mode (`anatomy-run.js`, `page/anatomy-probe.js`): what IS a streak at each wind speed?

```bash
node scripts/wind-bench/anatomy-run.js --fixture scripts/wind-bench/out/ramp-low.json                       # dark, light, beach at zoom 6
node scripts/wind-bench/anatomy-run.js --fixture <ramp> --themes light --arms '{"now":{},"try":{"__RAW_X__":1}}' --json out/anatomy.json
```

The owner, 2026-10-12, watching dark beside light and beach: "lighter moving air/wind in dark mode is almost transparent, or even
smaller animations than in beach or light mode. You need to really compare deeply each aspect". The other modes read a streak one
way each and as medians over a view that mixes every speed. This reads every aspect the eye uses, by speed, with dark's beside it.

- **It needs a speed ramp:** the wind due north, one speed a column. A MARK pixel is one the particles moved by more than 4 dE76
  against the field-only frame (map mode's definition). The CORE is the top tenth of a band's mark pixels by lift; a streak's BODY
  is every mark pixel at least half the core's lift.
- **Tables, a row a theme and a column a band:** the field under the marks (L\*, C\*); `COVER` (share of the surface a mark
  touches), `BODY` (share in a bright body), `STREAKS met` per 1000 CSS px along the wind; the `MEDIAN` mark pixel's and the
  `CORE`'s L\* over the field; the core's chroma minus the field's (0 = the colour made lighter, negative = white laid over it);
  the body's length along the wind (median and 90th percentile) and width across it; the whole mark's length with its tail. Each
  `vs dark` row is the ratio (for chroma, the difference) to dark's same band: the mirror is read there.
- **Read, 2026-10-12** (dev `b764797b`, zoom 6, 3.2 to 28.8 kn): light's and beach's cores stand 0.73 to 1.13 of dark's over the sea
  and their width is dark's to 24 kn; their bright bodies cover 1.2 to 2.3 times dark's area and run 1.2 to 2.4 times as long (90th
  percentile), most in light air and in a gale; at 3.2 kn twice as many are met. Dark's shape over land at 3.2 / 5.5 / 7.8 kn: a core
  38 / 32 / 29 L\* over the field against a median mark pixel of 9 / 14 / 14: a bright head and a tail that is gone.
- **Why** (`WebGLWindShaders.js` `SCREEN_FS`): dark lays a trail as `rgb x a` over `(1 - a) x map` with the trail's own faded rgb,
  which is zero once the trail's brightness falls to the ground's level and negative under it; the glow composite of light and
  beach lays full-light colour at the brightness squared and never reaches zero.
- **Limits:** the size columns assume the wind due north (a ramp); the body's threshold is half the band's own core, so a theme
  with a lower core is measured against its own; no null control is wired in (run it on a 2 x 2 pool by hand before trusting a
  new column).

## Switch mode (`switch-run.js`, `page/switch-probe.js`): after a theme change, is the new theme restyled?

Every other mode builds a fresh map a theme, so none of them can see a theme change, and a theme change is how the owner compares
themes. The app does not build a fresh map: react-maplibre calls `map.setStyle(url, { diff: true })`, which FETCHES the new style
and diffs it into the old one, while the wind keeps the map repainting. This mode replays the app's own sequence on the real
library and styles: the `setStyle`, the layer's `once('idle')` re-sync, its `styledata` / `style.load` handler.

```bash
node scripts/wind-bench/switch-run.js                                  # light>beach, beach>light, dark>light, light>dark; both orders
node scripts/wind-bench/switch-run.js --wirings dev,app                # the layer's handler before 2026-10-12, then the app's
node scripts/wind-bench/switch-run.js --pairs "light>beach" --events   # one change, with every event and its time
node scripts/wind-bench/switch-run.js --ref origin/dev --wirings dev   # dev as it was: its module and its handler
```

- **Columns:** `style` (a diff: the style object survived; or a rebuild), `wind layer` (kept or re-added), `re-sync` (whether the
  layer's idle re-sync ran BEFORE the new style arrived), `inked` / `muted` (the border's and the water's paint as the library
  holds them once the map has settled: the new theme's own colours restyled, or left as the style draws them), and what the two
  read-backs claim at that moment. Exit 1 when a theme that should be restyled is not, under the last wiring named.
- **Two orders, and both must end restyled.** `natural` leaves the re-sync to the map's own idle: a style already in the
  browser's cache arrives first, one fetched over the network arrives after the re-sync. `resync-first` forces the order a
  fetched style gives.
- **What it found, 2026-10-12** (an independent review read it in the code first): with the handler dev had, a change into a
  restyled theme in the fetched-style order ended UNMUTED and un-inked in 3 of 3, the read-backs saying `applied` (once with the
  other theme's layer count). The re-sync had restyled the OLD style under the new theme's name, the diff wrote the new style's
  colours over it, and the stale check compares the record, not the paint. On `origin/dev` the same for the mute alone, since
  #299. The layer now syncs on every `style.load`: 3 of 3 in both orders.
- **The handler in the probe is the app's**, pinned to `WebGLWindLayer.js` by `windBasemapMute.test.js` ("a style that has just
  LOADED ..."). It is not React: the order in a real browser depends on its cache and its connection.
- In the fetched-style order, dark to light restyles DARK's map as light for the length of the fetch (about 100 ms here).

- **The coastline through a theme change (2026-10-12, D-028).** The `coastline` column says whether the wind's coastline stroke is
  still on the map after the change and, in light and beach, whether it is in the borders' ink. Wiring `nocoast` is the layer's
  handler before D-028: the stroke was added only together with the wind layer, and a diffed theme change keeps the custom wind
  layer and drops the stroke (a style layer the new style does not name). `node scripts/wind-bench/switch-run.js --wirings
  nocoast,app`: GONE in 8 of 8 changes under `nocoast` (into dark too), there in 8 of 8 under `app`. Exit 1 also when the stroke is
  gone or un-inked under the last wiring.

## Path mode (`path-run.js`): wind colour vs map colour, through every kind of camera move

```bash
node scripts/wind-bench/path-run.js                                   # light, beach, dark; every path
node scripts/wind-bench/path-run.js --themes beach --paths erratic --seeds 1,2,3
node scripts/wind-bench/path-run.js --field --paths erratic,jitter    # the colour field alone: glued to the map?
node scripts/wind-bench/path-run.js --arms '{"off":{"__RAW_DISABLE_WIND_BASEMAP_MUTE__":true},"mute":{}}'
node scripts/wind-bench/path-run.js --bare                            # the basemap alone, without the app's own layers
```

The owner asked for tests "through zooms and pans of all types, even erratic", after reporting "ambiguity to the wind
color vs the color of the map". Same basemaps, engine, data and token as map mode.

**The map carries the app's layer stack** (`page/map-entry.js` `addAppStack`; LESSONS L-V21). The app keeps a satellite
photo and 18 weather-wash slots mounted and hidden under the wind layer, and draws radar frames above it. The first
version of this bench drew the basemap alone: a mute that stood down for any raster layer measured 38% → 3% here and
never ran in the app (live dev read `layers: 0`). Each run's line ends with what the mute did (`muted N layers`, or
`NOT muted (imagery:<layer>)`). `--ref <commit>` with the stack is the positive control for a rule that reads the style.

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

### Flow mode (`path-run.js --flow`): do the streaks still run along the wind while the camera moves?

```bash
node scripts/wind-bench/path-run.js --flow                              # light, beach, dark; every path, `turn` and `dateline`; both arms
node scripts/wind-bench/path-run.js --flow --themes dark --paths pan,zoomOut
node scripts/wind-bench/path-run.js --flow --ref origin/dev             # an engine without the anchor: both arms smear
node scripts/wind-bench/path-run.js --flow --hash-all --json a.json     # hash the trail buffer at EVERY sample, to compare two engines exactly
```

The instrument behind `windTrailAnchor.js` (trails anchored to the map). A trail is drawn along the air's path, so the
wind's ink should vary across the wind and hardly along it. A trail buffer that stays on the screen smears every trail
along the camera's motion instead: a pan turns the field into streaks parallel to the drag, a zoom into rays from the
focal point.

- **`flow`** (`flow.js`): the share of the ink's gradient energy that lies ACROSS the served wind direction.
  - The ink is (map + wind) minus (the map alone, same camera, engine not advanced), in L* at CSS-pixel scale.
  - The wind's direction comes from the served grid, per 16 px block. 1 = every streak runs along the wind, 0.5 = no
    direction, 0 = every streak runs across it. A dash has two ends, so a field at rest reads 0.66-0.85, not 1.
  - Blocks are left out where the map has line work (its residue under a tint would read as ink), where the wind is
    under 5 kn, or where there is almost no ink.
- **Arms.** `anchored` (the default engine) and `screen` (`__RAW_DISABLE_WIND_TRAIL_ANCHOR__`).
- **Columns.** Medians over the samples at rest, while the camera moves (p10 in brackets), and in the second after it
  stops; then what the trail buffer did, counted per frame (`pan`: whole-pixel shifts, `view`: looked at through a zoom,
  `relay`: ink re-laid, `turn`: re-laid for a turn or tilt, `jump`: cleared, `off`: the screen buffer).
- **Two flow-only paths.**
  - `turn`: a two-finger turn of the map, 70° there and back (`flow.js` `turned` scores a turned map).
  - `dateline`: a steady drag east across the 180th meridian at z5. The view centre wraps there, so the map's matrix
    jumps one world in one frame; its frames carry the wrapped longitude, as the map reports it.
  - Frames may also carry a `pitch`; a tilted map is drawn and captured but not scored.
- **The engine is drawn in every visible copy of the world**, as the app's layer computes them (`worldOffsets`: `[0]`
  away from the date line, so no other mode's picture changes).

**Gates** (`FLOW_GATE`, exit 1), set at about a third of what the first full run measured:

| check | rule |
|---|---|
| positive control | on `pan`, the `screen` arm falls at least 0.08 below its own rest reading |
| null control | before the camera first moves, both arms lay the SAME ink: the engine's trail buffer is hashed, sample for sample |
| the result | while moving, `anchored` beats `screen` by 0.05 on every path (no worse than -0.01 on `jitter`); on `pan` it stays within 0.05 of its rest reading |
| nothing cleared | the `anchored` arm never clears its buffer (`jump`) on a scripted path |

Three limits to read the table with:
- **A zoom path's rest reading is taken at its first zoom only**, and the reading changes with zoom (the marks do), so
  nothing is gated on it there.
- **Ground that has just come into view has no trail history yet.** A fling or a fast zoom-out shows marks without
  their tails for the first half second, anchored or not, so `anchored` reads below its rest level on those paths. It
  still reads well above `screen`, whose tails point the wrong way.
- **A median cannot see one bad frame.** Before its fix, the date line cleared the trails once per crossing and moved
  the pan's median from 0.715 to 0.713. That is why "nothing cleared" is its own gate, read from the engine's
  read-back.

**The engine's random stream is its own.** The engine draws from `Math.random` every frame (the respawn seed) and
MapLibre draws from it too (an id per worker request). A tile that happened to load mid-run shifted every later
respawn, so the same seed laid different ink depending on which run came before. `page/map-entry.js` now swaps the
seeded stream in for the engine's frame only. Found by the null control above; it applies to map and path mode too
(their seeded runs no longer depend on the run before).

It writes `out/<tag>-flow-sheet.html`, every sampled frame with its reading.

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

## Ladder mode (`ladder-run.js`): the eye through a whole zoom, z5.5 → z9 and back

```bash
node scripts/wind-bench/ladder-run.js
node scripts/wind-bench/ladder-run.js --fresh --json out/ladder.json --images out/ladder-images
node scripts/wind-bench/ladder-run.js --arms now,mosaic
```

Eye mode compares two grids. Ladder mode replays a zoom: at each of 15 stops (z5.5, 6, … 9, then back out) the real
engine receives, in order, every grid the client would have committed so far, and the eye is measured against the stop
before it and against the truth. It takes about 4 minutes, 8 with `--fresh`.

- **What arrives at each stop** (`ladder.js`, pinned to its sources by `src/components/map/windBenchLadder.test.js`):
  - the request box: the app's own `clampViewportBbox` (pad up to 1°, snapped to whole degrees);
  - the tier: `choose_adaptive_resolution`: 0.25° up to 25 deg², 0.5° up to 100, 1° up to 400;
  - the server's two answers to a box it has not built: the 2° world clip first (stale, sharpen pending), then the box;
  - the client cache: the exact box, else the FIRST cached box that contains the view and is fine enough. With it, three
    boxes reach the server (z5.5 at 1°, z6.5 at 0.5°, z8 at 0.25°). On the way out z7.5 is handed the 0.5° box although
    the 0.25° box also contains it. `--fresh` adds the path where every stop gets its own box.
- **One field for every tier** (`eye.truthField`): the served 0.25° tile `fixtures/lane-tile025.json` (HRRR lane
  included), with the 2° world tier beyond its box. Each tier is that field point-sampled at its lattice, as the server's
  tiers are: the fixtures agree at shared nodes (0.25° vs 0.5°: mean |ΔV| 0.009 kn over 405 nodes; vs 2°: 0.000).
- **Truth:** the 0.25° lattice over the widest box, drawn at each stop's zoom.
- **Eye columns:** centre shift, weakest-wall change and area ratio, as in eye mode, with one change: each next contour
  must be the same eye grown (`eyeSummary(..., { nested: true })`). Without it, once the eye opens at 40 kn, a 9-km
  closed pocket 100 km north counted as "the eye at 40 kn".
- **Field column:** a second readback bins the drawn speed in 5-kn steps over the whole view (every 8th device pixel).
  It reports the mean difference from the truth and the share of the view 10 kn or more off, so an option that holds
  the eye by giving up the rest of the picture shows.
- **z9** is drawn through the z8.5 camera: the 38-kn contour does not fit the z9 pane (±60 km). Both views lie inside
  every box resident there, so the engine composes the same field.

Arms (`--arms`):

| arm | what it is |
|---|---|
| `now` | the mosaic's kill switch: a coarser covering box replaces the finer one |
| `keep70`, `keepCentre` | option (a), emulated in the page: the finest overlay is kept while it covers ≥ 70% of the view, or its centre; the 2° base draws the rest |
| `mosaic` | the engine as written (`windTierMosaic.js`): the coarser box is filed around the finer nodes. A third texture level would draw this same picture |
| `oneLattice` | option (c): the server answers every box at 0.25° |
| `meanTiers` | option (d): the coarser tiers as area means of the finest |

Controls (exit `0` when all hold, `2` otherwise):
- **null, zoom:** the truth grid draws the same eye at every zoom;
- **null, lattice:** the `oneLattice` arm matches the truth at every stop;
- **null, resampling:** a mosaic whose fine box lies away from the storm draws the eye of the coarse box alone;
- **positive:** the `now` arm must move the eye on the way out.
- **engaged:** the `mosaic` arm must really draw mosaics. Every bench grid is stamped as `/grid` serves a dynamic box (a
  distinct ingest `run_time`, one known `model_run_time`), because a merge rule that reads those fields is otherwise
  invisible here: the first version compared `run_time` and would never have fired in the app.
- **particles (reported, not gated):** the trail ink in the eye over the ink on its wall, for a storm in a mosaic's
  resampled surround against the same storm on the plain coarse box. The drawn field is the same; the vortex gate reads
  the overlay's cell size. 2026-10-10: 1.118 against 1.050 (wall ink -7%).

2026-10-10 (AMD 890M, D3D11), change from the stop before (centre, weakest wall, area). Truth: eye at -87.65, 27.64,
closed 26-38 kn, r 30 km.

| stop, tier change | `now` | `keep70` | `keepCentre` | `mosaic` | `oneLattice` | `meanTiers` |
|---|---|---|---|---|---|---|
| in z6.5, 1° → 0.5° | 21.4 km, +12 kn, x0.34 | same | same | same | 0.1 km, 0, x1 | 30.8 km, +8 kn, x0.24 |
| in z8, 0.5° → 0.25° | 0.4 km, 0, x0.58 | same | same | same | 0.1 km, 0, x1 | 6.1 km, +4 kn, x0.33 |
| out z7.5, 0.25° → 0.5° | 0.4 km, 0, x1.71 | held | held | 0.1 km, 0, x1 | 0.1 km, 0, x1 | 6.1 km, -4 kn, x3.02 |
| out z6.5 | none | 0.4 km, 0, x1.72 | held | 0.0 km, 0, x1 | 0.0 km, 0, x1 | none |
| out z6, 0.5° → 1° | 21.4 km, -12 kn, x2.94 | held | held | 0.1 km, 0, x1 | 0.1 km, 0, x1 | 30.8 km, -8 kn, x4.24 |
| out z5.5 | none | 21.3 km, -12 kn, x2.94 | held | 0.1 km, 0, x1 | 0.1 km, 0, x1 | none |

Drawn field against the truth on the way out (mean kn; share of the view ≥ 10 kn off):

| arm | z7.5 | z7 | z6.5 | z6 | z5.5 |
|---|---|---|---|---|---|
| `now` | 1.68; 3.0% | 1.27; 1.5% | 1.09; 0.9% | 1.77; 4.7% | 0.99; 2.3% |
| `keep70` | 0.00; 0.0% | 0.64; 1.3% | 1.09; 0.9% | 0.73; 0.4% | 0.99; 2.3% |
| `keepCentre` | 0.01; 0.0% | 0.64; 1.3% | 2.09; 9.6% | 1.90; 6.6% | 1.18; 3.5% |
| `mosaic` | 0.01; 0.0% | 0.14; 0.0% | 0.51; 0.1% | 0.88; 1.5% | 0.51; 0.8% |
| `meanTiers` | 2.80; 12.4% | 1.96; 6.2% | 1.46; 3.1% | 2.08; 5.9% | 1.21; 2.9% |

Both paths give the same summary. See `docs/weather-program/log/2026-10-10-wind-eye-zoom-ladder.md`.

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
    #281. **Or the levers move only a mark's hue or saturation.** Every number the scanner prints is read
    from max(R,G,B), and a full-brightness colour's strongest channel does not move when its share of
    white does: a default against the kill of a rule that changed only that (2026-10-11, never merged)
    read identical on every number in all 26 views while all 26 image pairs in the contact sheet
    differed. So the warning names both causes; the images tell them apart (LESSONS L-V40).

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

- **The served-grid fixture is a hurricane, and its box is small.** `fixtures/eye-2026-10-09-gfs-native.json` covers 25 to 32 N,
  90 to 78 W; everything else is the bench's own 2-degree base, which `--scale` does not touch. In the Mobile Bay view the sea
  is mostly inside the box and the land mostly outside it: as served the wind is 25.9 kn (median) over the sea and 8.2 over the
  land at zoom 6, and scaling the fixture 2.3 times makes that 59.7 and 12.5. No mode reads the land under a gale. `ground-run.js`
  and `border-run.js` print the speed under what they score; the other modes do not.
- **`clearLevers()` in `page/map-entry.js` deletes only `window` keys that start with `__RAW_`.** A lever of any other name set
  by a run stays set for every later run in the same page (it cost the lead session two runs on 2026-10-12). Name a bench lever
  `__RAW_...`, or delete it yourself. The read-backs (`__WIND_BASEMAP_MUTE__`, `__WIND_BORDER_INK__`, `__WIND_LAND_MASK__`) are
  not levers and persist too, until the next sync or mask load rewrites them.
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
