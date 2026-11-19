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
