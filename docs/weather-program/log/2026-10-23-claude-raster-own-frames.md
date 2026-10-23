# 2026-10-23 · claude · raster layers from our own frames, phase 1: GFS pressure client (DARK)

Same session as `2026-10-22-claude-raster-instant.md` (the owner's "instant load upon activating the toggle, and instant scrub" for
the seven raster layers), after the owner's "we want free grib data" (2026-10-22 21:35 EDT) and the lead's phase-1 plan (approved
2026-10-23 with two adds: render in MapLibre's shared GL context reusing the engines' helpers; no per-frame synchronous GL reads).
The publisher is the static-frames lane's draft #473 (set `GFS/weather/pressure/global_0p5`, contract in its PR); this is the client.

## What (`claude/raster-own-frames`)
Client only; no served number, palette or legend change. DARK: `window.__RAW_RASTER_OWN_FRAMES__ = true` (or localStorage
`__RAW_RASTER_OWN_FRAMES__` = 'true'). Kills: `__RAW_DISABLE_RASTER_OWN_FRAMES__`, the static-frames global kill, the per-set kill.
- `ownRasterFrames.js` (data): the set is added to `staticFrames.STATIC_SETS` (not a waves set, so the marine frame store never
  takes it); pinned index through `getPinnedIndex`; the frame for an asked time is `pickIndexFrame` (nearest stored within 3 h, NO
  time interpolation); the window is the shown frame + up to 2 ahead in the scrub direction + 1 behind (desktop 4 frames,
  handheld 3), at most 3 loads in flight, and a frame that left the window never starts. LRU of 6 decoded Float32 fields. No idle
  whole-run fill (the egress rule). GFS only: with EURO or ICON selected the .om path draws that model as before.
- `ownRasterLayer.js` (draw): a MapLibre custom layer. One resident R32F texture per frame (cap 6); a scrub step is a texture
  rebind, so the hard cut lands on the first frame the wanted field is resident and the shown frame holds until then. Fragment
  shader: mercator -> lat/lon, bilinear on the 0.5-degree lattice (texelFetch, wraps at the antimeridian), a step LUT of the SAME
  scale the .om path draws (`CUSTOM_COLOR_SCALES.pressure_msl`, theme-applied; the tile library's rule, the colour of the largest
  breakpoint <= value) at the frames' 0.1 hPa codes; opacity = the slot paint's zoom ramp (a test reads MapWebGL to pin it).
  No stored frame within 3 h of the asked time: nothing is drawn (never another hour under the label).
- GL STATE (the lead's add 1, a reasoned deviation): MapLibre 5.24's `drawCustom` calls `context.setDirty()` and
  `painter.setBaseState()` after prerender AND render, so everything MapLibre tracks is re-applied after a custom layer, and
  `captureWebGLState` would cost 7+ synchronous reads a frame for nothing. Reused instead: marineFrameStoreGpu's context-loss
  lesson (calls on dead objects fail silently), driven by the canvas's webglcontextlost / webglcontextrestored events (no
  per-frame polling): every GL object is dropped, and the program, LUT and resident fields are rebuilt from CPU copies.
- The lead's add 2: uniform locations cached at init; no get/is/read/finish call per frame (a test with a recording GL pins it);
  the one status read is the link check at init. Uploads only inside prerender, one per frame, the wanted frame first.
- A device that cannot draw it (no WebGL2, a failed link) reports once and the layer goes back to the .om path.
- ISOBARS: the .om URL asks `contours=true`, but no app layer reads the contour vector tiles, so today's pressure layer has NO
  isobars. Built as a lever, OFF (parity): `window.__RAW_OWN_RASTER_ISOBARS__ = 4` (hPa interval), theme ink. An owner A/B arm.
- Credit: while the layer draws from our frames the legend credit reads "NOAA GFS" (public domain, courtesy link), else
  Open-Meteo's.
- Wiring (MapWebGL +7): `useOwnRasterFrames` decides engagement synchronously from the levers; while engaged the layer is left out
  of `useOpenMeteoTileUrls`, the temporal preloader and the slot layers (`omLayers`), so Open-Meteo is never asked for it. No
  index: disengage, and the .om path draws it as before. The wind lane's pin of the slot visibility line follows (`omLayers`).

## Measured
Frames: the publisher's REAL GFS 06Z run of 2026-10-23 (#473 made offline; 113 frames, ~181 KB each), served from a local static
host standing in for the CDN at 150 ms per response. For the timing A/B the set is shifted 12 h (`own_frames_shift.js`: index and
frame-header times only) so it lines up with the lab's pinned clock, whose .om arm replays a recording. Paired arms from ONE
build (`om` = lever off, `own` = lever on), GFS, zoom 2/4/6/9, desktop 1280 x 800 and phone 390 x 844 (4x CPU):
| vp | arm | toggle p50 | step p50 / p95 | long jump (+96 h) p50 | stale frames / combo | blank / mixed | bytes toggle / step |
|---|---|---|---|---|---|---|---|
| desktop | om | 2.7 s | 46 / 55 ms | 1.5 s | 104-120 | 0 / 0 | 1.19 MB / 537 KB |
| desktop | own | 0.64 s | 22 / 32 ms | 0.23 s | 16-18 | 0 / 0 | 807 KB / 193 KB |
| phone | om | 4.8 s | 149 / 232 ms | 2.2 s | 96-108 | 0 / 0 | 1.19 MB / 537 KB |
| phone | own | 1.4 s | 91 / 155 ms | 0.39 s | 11-14 | 0 / 0 | 615 KB / 193 KB |
- The frames are 3-hourly, so 6 of 10 one-hour steps keep the same frame (the summary counts them apart). The layer publishes its
  shown and wanted frame to #471's readout, so the line under the timeline says so: read in the browser at +1, +2, +3, +4 and
  +96 h from 6:03 PM: "Showing Thu 8 PM: the nearest stored forecast", nothing (8:03 PM is a frame), "... 8 PM ...",
  "... 11 PM ...", "Showing Mon 5 PM: the nearest stored forecast". The .om publisher no longer clears a record owned by a layer
  drawn from our frames.
- The toggle floor is three sequential round trips (latest.json, the index, the frame). Pinning the index at idle (two small
  JSON reads, no frames) would leave one.
- Open-Meteo requests over a whole session with pressure on: own 0, om 13 (the control).
COLOUR PARITY, live (14:55Z, the published run's f009 = 15Z; Open-Meteo's latest GFS is the same 06Z run at that hour), zoom 3
over the North Atlantic, per-pixel CIEDE2000 over the map area (514,600 pixels; `compare_shots.py`):
| theme | om vs own p50 / p95 / p99 | > 2 / > 5 | null (om twice) | bare map vs om layer p50 / p95 |
|---|---|---|---|---|
| dark | 0 / 1.12 / 2.40 | 2.3% / 0.12% | 0 | 9.8 / 22.4 |
| light | 0 / 0.85 / 1.60 | 0.3% / 0.08% | 0 | 6.4 / 19.5 |
| beach | 0 / 0.64 / 1.49 | 0.4% / 0.06% | 0 | 6.9 / 16.7 |
Under 1 dE00 (invisible) on 94-98% of pixels; the residue sits on palette step edges (0.25-degree .om vs 0.5-degree frames).

## Instruments (frontend/scripts/raster-lab)
`own_frames_fixture.js` (synthetic set to the contract + a CDN stand-in with CORS and immutable headers, `--serve`, `--lat`),
`own_frames_shift.js`, `probe_own_frames.js` (toggle, steps, credit, Open-Meteo request count, screenshots per theme; `LIVE=1`,
`NOLAYER=1` control), `compare_shots.py` (CIEDE2000, `--null`). The lab's own-frames classifier and `OWN_CDN` counting are in #477.
