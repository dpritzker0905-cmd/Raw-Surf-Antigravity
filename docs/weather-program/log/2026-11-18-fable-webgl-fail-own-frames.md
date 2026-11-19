# Fable animation lane: the marine WebGL-failure fallback, off Open-Meteo (exit-plan row 12)

Session log, append-only. Branch `fable/webgl-fail-own-frames`. Started 2026-11-18 (evening, EST).
Task from the director (2026-11-18): "Open-Meteo exit row 'WebGL-fail marine tiles'". The governing word is the owner's, as
the director relayed it (about 23:00Z): no Open-Meteo in any user data; internal testing only. Rules of the row (shared
notes, `open-meteo-exit-plan-2026-11-18.md`, section L): REPLACE, ships ON with a kill switch, and the kill's fallback is
an agency source or "unavailable", never Open-Meteo.

## 1. What is there today (read on dev; nothing built, nothing measured)
- **The switch.** `webglMarineFailed` in `MapWebGL.js:106`, set by `useWebGLGuardrail` (12 s under 20 fps), `useMapErrorSurface`
  (a render error) and `useMarineWebglRecovery`; forced for tests by `window.__FORCE_MARINE_FALLBACK__` or the
  `force_marine_fallback` local-storage key. It means OUR marine custom layer failed or is too slow. MapLibre's own GL
  context is still drawing: that is how the fallback tiles get on screen at all.
- **What the user gets when it is true:**
  - the colour field: MapLibre raster sources fed by Open-Meteo `.om` tiles for every marine layer with an `omVariable`
    (`useOpenMeteoTileUrls.js:458-468, 502-509, 616-618`; drawn by `MapWebGL.js:826-894`). Raw wave height, a third party's
    grid, a third party's colours.
  - the motion: `MarineParticleCanvas` (in `GPUMarineLayer.js`) in place of `WebGLMarineLayer` (`MapWebGL.js:1011-1032`),
    fed `marineWindData`: OUR grid for the hour, which the fallback path therefore already holds.
  - a legend row, `marineFallbackNotice.js`: "Simplified wave layer", whose tooltip says "from a third-party source" and that
    the surf-rating band is not drawn.
- **Our own colours in JavaScript:** `marineWavePalette.js` has `sampleMarineWavePalette(height, theme)` for light and beach
  (the tables the shader's GLSL is generated from). Dark's wash exists only in the shader ("dark keeps its own path").
- **A precedent for our own field drawn without the marine engine:** `ownRasterLayer.js` (our raster frames as a MapLibre
  custom layer). It is itself a WebGL custom layer, so it is a precedent for the data, not for a path that survives a
  custom layer failing.

## 2. The design (fixed here so the gate cannot be fitted to it afterwards)
- **One new small module**, `marineFallbackField.js`, and one small component that uses it. No change to the marine engine,
  the fetchers or any served number.
- **What it draws.** When `webglMarineFailed` is true and a marine layer is on: the hour's own grid (`marineWindData.grid`,
  the same object the particle canvas reads) painted into an offscreen 2D canvas, one colour per pixel from the theme's own
  height table, transparent where the grid is not valid (land, no data). The canvas is handed to MapLibre as an `image`
  source with the grid's corner coordinates and drawn by a plain `raster` layer in the slot the `.om` tiles used
  (`beforeId` = the marine anchor), with `raster-resampling: linear` and the zoom opacity ramp the `.om` marine slots used.
  A plain raster layer is MapLibre's own code path, the one already proven to work on a device where our layer failed.
- **Geometry.** An image source is stretched linearly in Web Mercator between its corners; our grid is regular in latitude.
  So the canvas's rows are laid out evenly in MERCATOR y and each row samples the grid at its own latitude (bilinear in the
  grid). The grid's own bounds are used (the world grid stops short of the poles, inside Mercator's range). A box that
  crosses the antimeridian is drawn as the grid states it; a world grid is drawn once (no wrapped copies: recorded as a
  limit, with what it looks like, before deciding whether it matters).
- **Colour.** Light and beach: `sampleMarineWavePalette`. Dark: the shader's dark wash ported to a small JS table in the new
  module, with a unit test that pins it to the shader's own constants so the two cannot drift. The field shows HEIGHT for
  whichever marine layer is on (waves, swell_1, swell_2, wind_waves), from the field the grid carries for that layer; if a
  layer's grid has no height field the module draws nothing for it and the notice says unavailable.
- **Updates.** Redrawn when the grid object or the theme changes (an hour step, a model change, a pan that brings a new
  grid): `source.updateImage`. No animation loop of its own. Target: a redraw of the world grid (181 x 82 nodes into a
  canvas of at most 1024 x 512) under 8 ms on a mid phone, measured, not assumed.
- **When there is no grid of ours to draw:** nothing is drawn and the legend row reads "Wave layer unavailable on this
  device" (a real text row, `role="status"`, the three themes' own classes). Never a third party's tiles.
- **The notice text changes with it.** The row keeps "Simplified wave layer" and that the rating band and animated crests
  are not drawn; "from a third-party source" and "not this app's own forecast" go, because they stop being true. What it
  shows is this app's own wave HEIGHT, not surf quality: the tooltip says that.
- **Open-Meteo leaves this path entirely.** `useOpenMeteoTileUrls` and `MapWebGL`'s raster slots stop including marine
  layers whether or not `webglMarineFailed` is set (the `type === 'marine' && webglMarineFailed` terms are removed), so no
  marine `.om` URL is ever built. The raster layers that still use `.om` (other rows of the exit plan) are untouched.
- **Kill switch:** `window.__RAW_DISABLE_OWN_MARINE_FALLBACK__ = true` (read per draw). Killed means: no field drawn and the
  "unavailable" row. It does NOT bring the `.om` tiles back; that path is gone in the same change. Listed in
  `killSwitch.inventory.test.js`.
- **Not in this change:** the surf-rating band in fallback mode; crest marks; wind's own fallback (`webglWindFailed`, a
  different row if it reaches Open-Meteo at all: to be checked and reported, not fixed here); removing the `.om` protocol
  code (exit-plan row 17).

## 3. THE GATE, written before building and before any measurement. No threshold moves after data.
All offline (built client over the synthetic backend and the frame stand-in that holds wave frames, `wave_frames_fixture.js`).
The fallback is forced with `window.__FORCE_MARINE_FALLBACK__ = true`. Three themes; desktop 1280 x 800 and phone 390 x 844.
- **F1 no Open-Meteo, the reason for the change.** With the fallback forced and each of waves, swell_1, swell_2, wind_waves on
  in turn, five views, six hour steps each: ZERO requests to any Open-Meteo host, to the `weather-proxy` function or with an
  `om://` marine URL, counted from the browser's own request log. **Control (must FAIL the same counter):** the same run on
  dev's build shows at least one such request per layer. If dev's build shows none, the counter is blind and F1 is void.
- **F2 the picture is our field.** At 200 sampled grid nodes per view (on the node, away from coast), the canvas pixel's
  colour equals `the theme's table at that node's height` within 2 of 255 per channel; and the drawn map picture at those
  nodes, un-composited against the basemap by the layer's own opacity, within 6. **Control:** the grid's heights shuffled
  among nodes before drawing must put under 20% of nodes inside the tolerance.
- **F3 land and no-data are transparent.** Every sampled node the grid marks invalid has alpha 0 in the canvas (all of
  them); and with the field on, the map picture over land equals the picture with the field off within 2.
- **F4 it follows the hour.** After each of six +3 h steps the canvas is redrawn from the grid whose valid time is the new
  hour (the drawn grid's stamp equals the engine-independent `marineWindData` stamp), within 500 ms of that grid arriving;
  6 of 6 in every view.
- **F5 geometry.** A synthetic grid with one hot node at a known latitude and longitude (three latitudes: 0, 40, 70) draws
  its peak within one grid cell of that point on screen at zooms 2, 4 and 6. **Control:** rows laid out evenly in latitude
  instead of Mercator y must miss at latitude 70 by more than one cell.
- **F6 nothing to draw, and the kill.** With no marine grid available, and separately with the kill set: no raster field in
  the picture (equal to the field-off picture within 2), the legend row present with the "unavailable" text and
  `role="status"`, in all three themes and both layouts; and F1 still holds.
- **F7 cost.** Redraw time for the world grid, median over 30 redraws: at most 8 ms desktop and 16 ms on the phone profile
  (4x CPU throttle); no long task over 50 ms attributable to it. Reported as measured; a miss is a fail, not a note.
- **F8 the normal path is untouched.** With the fallback NOT forced: the request list, the engine's grid and the picture are
  the same as dev's over one scripted scrub (bytes of the engine's wave texture equal; no new source or layer on the map).
- **F9 tests and hygiene.** Unit tests for the module (palette lookup, the Mercator row map, validity, the dark table pinned
  to the shader); the notice's text; the kill in the inventory; both Jest trees, the ESLint ratchet and the file-size rule
  green; frontend floor fragment added with the counts the script prints. `MapWebGL.js` may only shrink (it is over the
  800-line ratchet): the change must remove more lines from it than it adds.
- **Not gated, said now:** how the simplified field LOOKS next to the real layer (it has no crests, no rating band and a
  flatter wash by design). That is a look for the owner if he wants one, not a line.
- A failed or void line is recorded as it is. Heads go to the director and the advisor before any merge.

## 4. Open points for the director and the advisor (before I build)
1. Is "our own HEIGHT wash, no rating band" the right content for the fallback, or should the fallback show nothing unless
   it can show the rating band too? (My pick: the height wash. It is honest, it is ours, and the row says what is missing.)
2. Dark has no JS table today. Porting the shader's dark wash to JS with a pin test adds a second copy of dark's colours.
   Acceptable, or should dark show "unavailable" until one source of truth exists? (My pick: port and pin.)
3. The row's rule says "parity vs observed truth". No served number moves here (a colour field of data we already serve),
   so I have written picture-against-our-own-grid lines instead (F2, F3). Say if a truth line is still wanted.
4. A world grid is drawn once, not repeated across the antimeridian. Acceptable for a fallback?

## 5. The director's answers to section 4 (received 2026-11-18, after 19:55 EST). Nothing built yet
A peer session's rulings, recorded as they came; the build waits for the advisor's read.
1. **Content: our own HEIGHT wash, without the rating band.** The legend must say, in text and in all three themes, that the
   rating band and the crests are not drawn on this device.
2. **Dark: port the shader's dark wash to JS.** ONE test must hold the JS table and the shader's dark wash in parity at the
   same heights, so the two cannot drift (one test, both sources).
3. **No truth line.** No served number moves, so "parity vs observed truth" (exit plan section L; the director cites D-080)
   does not apply; F2 and F3, the picture against our own grid with the shuffled control, are the gate for this row.
4. **A world grid drawn once, not repeated across the antimeridian, is acceptable for a fallback**, recorded as a known
   limit here AND in the legend's notes, not silently. (Section 2 said it would be recorded "before deciding whether it
   matters"; it is now decided: accepted, and disclosed.)
- Also confirmed: the marine `.om` terms are removed in the same change; the kill lands on "unavailable", never Open-Meteo;
  `MapWebGL.js` must shrink; the head goes to the director, and this lane never merges it.
- **Gate changes that follow from these answers, made BEFORE any build:**
  - F6 gains: the legend row's tooltip names the antimeridian limit (text present, three themes).
  - F9's dark pin is ONE test that evaluates the JS table and the shader's own dark anchors at the same heights (the
    anchors read from the shader source text, not copied by hand into the test).
  - No other line changes.

## 6. The advisor's read (received 2026-11-18, about 20:15 EST), and the gate as amended BEFORE any build
The advisor answered from my summary and has not read this file; the PR gets its full read. Every point is taken. Where a
line below differs from section 3, THIS section is the gate.
- **F1 is rewritten: count below the browser.** A page-level request log can miss requests made inside the map library's
  workers and anything a protocol handler fetches itself. So the lab's browser is given a local proxy that DENIES every
  outbound host by default except an allow-list, and records every host asked for, allowed or refused. Allow-list: the
  local page server, the synthetic backend, the local frame stand-in, and the basemap's own tile host (without it no map
  draws; named in the report). F1 passes when the proxy's record shows ZERO requests, allowed or refused, to any Open-Meteo
  host or to the `weather-proxy` function, across the same runs as before (fallback forced; waves, swell_1, swell_2,
  wind_waves; five views; six hour steps; three themes; desktop and phone).
  **Positive control, per ROUTE:** dev's build under the SAME proxy must show at least one request by EACH route: the
  `om://` handler's fetches, the `weather-proxy` function, and a direct Open-Meteo host. A route that shows none on dev
  cannot be seen by the counter, and F1 is void for that route (said by name; if dev simply does not use a route, that is
  shown from the code and the route is dropped with the reason).
- **F2 no longer un-composites.** (a) The bitmap handed to the map is compared DIRECTLY with the field mapped through the
  theme's table, with no map involved: every pixel within 1 of 255 per channel of the table's colour at the height that
  pixel's own latitude and longitude interpolate to. (b) In the page, with the basemap hidden over a known flat colour and
  the layer's opacity forced to 1, the colour read at 200 map coordinates over open water is within 4 of the table's.
  (c) The full map picture is used only as a last check that the field is on screen (the picture with the field differs
  from the picture without it over open water). The shuffled-heights control stays, on (a) and (b).
- **F5 gains four traps:** (a) a grid that runs past about 85.05 degrees is clipped there, and the test says where;
  (b) the image's corners are the outer cell EDGES, not the cell centres (a hot node must peak on its own coordinate, not
  half a cell off); (c) a box that crosses the antimeridian (a case across 180 is added); (d) row order, north first. Cases
  now: latitudes 0, 40, 70 and 85 N, and one box across 180. The even-latitude control stays.
- **How every picture line is scored (the trap of section 14 of the wind log, named before it can bite):** the particle
  canvas off; the raster fade duration zero or the read taken after it completes; the device pixel ratio fixed, or samples
  taken by map coordinate, never by pixel; samples over open water, away from labels and the land mask.
- **Limits written in from the start, and each gets its line in F6:**
  - what the user sees when our own data has no frame for the hour: nothing drawn, and the "unavailable" row;
  - that NO path falls back to Open-Meteo in ANY state: forced fallback, real engine failure, no grid, the kill set, a
    failed redraw. F1's proxy runs over each of those states too.
- **Said in the PR, as the advisor asks:** if the failure is a lost GL context the map itself is gone and nothing draws.
  This fallback covers failures of the marine ENGINE (a shader that will not compile, missing float-texture support, the
  frame-rate guard), not of the map.
- F3, F4, F6 (plus the above), F7, F8 and F9 stand as amended by section 5.

## 7. HANDOFF at the wind-down (2026-11-18, about 20:45 EST). The build was started and is NOT finished, NOT tested, NOT gated
The director relayed the owner's wind-down (about 01:35Z: near the week's usage limit): do not start the row 12 build, make
sure the design note is pushed with the four answers, write a handoff, stop. The answers are in section 5 and the advisor's
gate changes in section 6, both pushed (`9320be8b1`) before any build. **The message arrived AFTER the build had begun**
(the director had said "build once the advisor has read it", and the advisor's read came at about 20:15). So this section
records honestly where the code stands, and the code is saved as ONE work-in-progress commit so nothing is lost.

**STATE OF THE CODE: written, never run.** No unit test has executed (see the blocker below), no build, no lint, no gate
line. Nothing here may be merged or treated as working.
- New: `marineFallbackField.js` (the pure picture: extent with cell-edge corners, the 85.05 clip, Mercator rows north first,
  the antimeridian, bilinear height over ocean nodes only, a colour lookup table per theme, the kill),
  `MarineFallbackFieldLayer.js` (a MapLibre `canvas` source + `raster` layer, `animate: false`, re-read by play/pause on a
  redraw; `MarineEngineFallback` = that plus the existing particle canvas; state published on
  `window.__RAW_OWN_MARINE_FALLBACK__` and the `rawsurf:marine-fallback-field` event), and their two test files.
- Changed: `MapWebGL.js` (the two marine `.om` terms removed; `MarineEngineFallback` mounted in the failed branch; the file
  shrinks), `useOpenMeteoTileUrls.js` (no marine tile URL is built in any state; the `webglMarineFailed` argument and the
  `webgl_fallback=true` tag are gone), `marineFallbackNotice.js` + test (no "third-party"; the rating band and crests not
  drawn on this device, in text; the date-line limit in the tooltip; an "unavailable" state; a hook for the field state),
  `legendTicks.js` (passes the field state), `killSwitch.inventory.test.js` (`__RAW_DISABLE_OWN_MARINE_FALLBACK__`).

**THREE THINGS THE BUILD FOUND THAT THE DESIGN DID NOT HAVE. None is measured; each needs the director's and advisor's eye:**
1. **No new dark table.** `colorScales.js` already has `getThemedWaveColorJS`, a JS mirror of the shader's height wash for all
   three themes. The fallback uses it. The director's "one test, both sources" is written against it: the test READS the
   dark anchors out of `WebGLMarineShaders.js` and compares them with the JS at the anchor heights. (Written, not run.)
2. **A surf-rating grid cannot be drawn as height.** With the rating toggle on, the grid's height field carries SCORES and the
   open ocean is masked. The fallback draws nothing for it (reason `rating_grid`) and the row says unavailable. Before this
   change a user with the rating toggle on fell to the provider's height tiles; now they would see no field. That is a real
   change in what those users see and is the owner's call if it matters.
3. **The BLANK GUARD reasoned about the provider.** `marineGuardrailRules.marineFallbackDrawable` decided whether the
   frame-rate guard may trip by asking whether Open-Meteo's model carried the layer's variable (EURO swell: no trip, "the sea
   would be blank"). With our own field that question is wrong in both directions, so it is rewritten: the fallback can draw
   any grid the engine holds, except a rating grid or under its own kill, and for those two the guard REFUSES the trip and
   keeps the engine (the owner's rule recorded in that guard: never a blank frame). Consequences, both behaviour changes:
   EURO and ICON swell now DO fall back on a slow device (to our own picture); a slow device with the rating toggle on stays
   on the slow engine. `useWebGLGuardrail.js` and `useWebGLGuardrail.blankAndLoad.test.js` are changed for it.
   **This needs a line in the gate (an F10) written before anything is measured. It is not written yet.**

**EXISTING TESTS CHANGED: the part a reviewer must read first.**
- `useWebGLGuardrail.blankAndLoad.test.js`: the tests that pinned the provider's variable lists (what the raster can draw;
  EURO + Swell does not trip; ICON Swell 2; "live metadata decides") are REPLACED by tests of the new rule. The original
  incident's test now asserts the opposite outcome (it trips), for the reason in item 3.
- `src/tests/om-metadata-demand.test.js`: "marine fallback still requests its required metadata" is INVERTED (a failed
  engine must request nothing marine). The cold-metadata test reached its rule through the failed-marine path, which no
  longer exists; it is PORTED to a plain raster layer (`stormfuel` / `cape`, added to that file's mocked registry) with the
  same axes and assertions. A blind port: it has not run.

**BLOCKER, unsolved: Jest finds no tests in this worktree.** The worktree is under `.claude/`, and the runner's file matcher
skips dot-directories ("No tests found", three attempts, including from a `subst` drive letter, which Jest resolved back
to the real path; the drive mapping is removed). The note in memory says to run Jest from a detached worktree outside
`.claude` with a `node_modules` junction. That was not done. Until it is, nothing in this change is verified.

**WHAT IS LEFT, in order:**
1. Run the tests (a worktree outside `.claude`): the four touched suites first, then both Jest trees; fix what fails.
2. Write F10 (item 3) into the gate, and get the director's word on items 2 and 3, BEFORE any gate measurement.
3. `npm run build`, the ESLint ratchet, the file-size rule (`MapWebGL.js` must have shrunk; unused imports in
   `marineGuardrailRules.js` and `useOpenMeteoTileUrls.js` are likely after the removals and are not checked).
4. Check `ForecastTimeStatus.js` (it reads the failed flag and says "no frame of ours is drawn": with our own field drawn
   that sentence is now wrong) and `openMeteoProtocol.js:794` (reads `webgl_fallback=true`, now never sent).
5. The lab: the deny-by-default proxy counter for F1 (not written), the scenario for F2 to F8 (not written), with
   `wave_frames_fixture.js` from PR #1052 (not yet on dev).
6. Floors (`rederive_floor.py --lane frontend`), the SCOREBOARD is not needed (no served number), the ledger line, the PR,
   heads to the director and the advisor. This lane never merges it.

**Elsewhere at the wind-down:** PR #1052 (first-visit record and lab) is open with Auto-fix on, in the director's merge
loop. The wind blend is closed out on `fable/wind-hour-blend` (`24c4c4592`), OFF, no PR. Local harness servers (page server
3198, synthetic backend 4205) may still be running; they are offline fixtures and safe to stop.
