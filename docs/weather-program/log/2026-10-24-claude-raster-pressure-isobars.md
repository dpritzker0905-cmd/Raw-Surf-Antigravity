# 2026-10-24 · claude · per-model pressure: labelled isobars + H/L (dark), and the antimeridian stripe

The owner, 2026-10-23 20:13 EDT: "Yes start it" (per-model pressure, after "We want each models pressure showing"). The lead's
route, step 3: "the colour field plus labelled isobars every 4 hPa (bold every 20) plus H/L markers; compute contours in a worker
per frame and cache them, never on the scrub path; three themes; not colour-only; kill switches". Matrix (lead, 2026-10-24):
the raster lane owns cell 11 (isobars and H/L per model) and cells 6/7 for pressure (antimeridian seam, poles).

## What
DARK with the field (only while `__RAW_RASTER_OWN_FRAMES__` draws pressure). Kill: `window.__RAW_DISABLE_RASTER_ISOBARS__ = true`.
- `isobarContours.js` (pure): one 3 x 3 smoothing pass for the lines only (raw 0.5-degree MSLP over steep terrain draws
  saw-teeth; the colour field keeps the raw values); marching squares for ALL levels in ONE pass over the cells (a cell meets
  only the levels between its corners' min and max), numeric edge keys, segments stitched into lines, continuous across the
  antimeridian; H / L where a cell is the max / min of a ~10-degree neighbourhood on a 2-degree lattice and stands >= 4 hPa from
  its mean, |lat| <= 80. A real GFS frame: 263 lines, 40 centres worldwide, 39-63 ms in Node once warm.
- `isobarWorker.js` + `isobarStore.js`: a module worker per page, products cached per frame path (12); asked as a frame LANDS in
  the window (useOwnRasterFrames' pump), never inside a step.
- `usePressureIsobars.js`: lines (0.8 px, 1.6 px every 20 hPa), hPa labels along them and "H 1032" / "L 984" markers, in each
  theme's ink with a halo, on the basemap's own font. NEVER A STALE LINE: two buffers; the wanted frame's lines load into the
  hidden one when a step picks it; at the cut (inside MapLibre's render, the same frame the colours change) a loaded buffer
  becomes visible; if none holds the new frame, no lines until it loads. Not colour-only: every line and centre is labelled.
- FIX (found by matrix cell 6, Fiji): the field drew a violet one-cell stripe on the antimeridian. The wrap took the next column
  as `int(mod(x0 + 1.0, 720.0))`, which can round to 720, and a texelFetch past the last column reads 0 (the palette's
  bottom). Integer modulo now (pinned by a test). Present in the dark #481/#526 client only (never served).

## Measured (the dark client, local CDN stand-in of real runs: GFS 06Z, EURO 12Z, ICON 00Z; per-animation-frame sampler)
| cell | place, zoom | models x themes | stale isobar frames | frames without lines (during 300 ms steps + a 96 h jump) | worker ms per frame |
|---|---|---|---|---|---|
| 11 | N. Atlantic (-35, 42) z5 | GFS, EURO, ICON x dark, light, beach | 0 (9 runs) | 6-22 % | 55-270 (first call up to 780) |
| 6 | Fiji (179.5, -17) z5 | GFS dark, EURO light | 0 | 6-14 % | 41-213 |
| 7 | Norway (6, 70) z5; S. Ocean (0, -62) z5 | GFS dark/light, EURO beach | 0 | 8-10 % | 77-293 |
- Cell 6 after the fix: the field and the isobars are continuous across 180 (no stripe, no line break; isobars also pinned by a
  unit test that closes a ring around a low centred on 180).
- Cell 7: no polar artefact in the field; labels and markers are screen-sized (symbol layers), so Mercator stretch never
  enlarges them; "L 971" drawn in the Southern Ocean.
- Frames without lines are the worker's catch-up while the scrub outruns it (mostly the first, cold calls); never a stale line.
