# 2026-11-12 Fable (animation lane): the value blend for own-frames raster layers

The owner, 2026-11-12: "Don't forget to improve the animations that are drawn, themselves" ... "Blend first, but make sure to
take into account each themed mode, beach mode, dark mode, and light mode for their color schemes" ... "Yes, open the blend
draft PR once pressure checks out". Client only; no served surf number moves. Ships ON with a kill switch (a visual change the
owner asked for).

## What changed
- `ownRasterLayer.js`: a step no longer cuts. For `BLEND_MS` (160 ms, smoothstep) the shader mixes the VALUES of the frame that
  was shown and the frame now wanted (`u_field`, `u_field2`, `u_mix`), then does ONE palette lookup. So every in-between pixel
  is a colour of the active theme's own ramp, in dark, light and beach alike; a colour crossfade would draw colours that are on
  no legend. Both frames are already resident textures: one more sampler, no upload.
  - Applies to every own-frames layer (pressure, cloud cover, air temperature, rain behind its lever) and to any model.
  - The wanted frame is still the "shown" frame at once (readout, telemetry, settle time unchanged).
  - Where one frame has no data the other stands. A step taken mid-blend starts from the frame the picture is nearer to. The
    frame being blended from is never evicted.
  - Hard cut, as before: `prefers-reduced-motion`, two frames on different grids, the first frame ever, and the kill
    `window.__RAW_DISABLE_RASTER_VALUE_BLEND__ = true`. `window.__RAW_RASTER_BLEND_MS__` overrides the duration (the lab).
- `usePressureIsobars.js`: the isobar LINES crossfade over the same time (line-opacity transition): the outgoing frame's lines
  fade out as the incoming fade in, never a snap mid-blend. The numbers and H / L markers still switch at once (two sets of
  labels on screen would collide). With no blend the instant switch and its "never a stale line" contract are unchanged.

## Two faults the photographs caught (both fixed before the PR)
1. The incoming lines appeared at full strength at once: a 0 then 1 opacity set in one call is collapsed by the map. Hidden
   buffers now rest at opacity 0, so they rise from nothing.
2. The crossfade never ran in the usual case. When the step lands before the new frame's lines have loaded, the old code hid
   every line and showed the new ones later with nothing to fade from (probe: both line layers at transition duration 0,
   the old one already hidden 200 ms after the step). Now the old lines fade out with the field and the new ones fade in when
   they land. The field itself blended correctly throughout (the layer's own state read t = 0.513 at the half-way mark).

## Measured (offline, built client, real frames in a local stand-in; one +3 h step, the blend held open for 12 s)
Mean absolute RGB difference over the map area between the start, middle and end screenshots:

| layer, theme | start-end | start-middle | middle-end |
|---|---|---|---|
| rain, dark | 5.95 | 3.35 | 3.26 |
| rain, light | 4.68 | 2.48 | 2.47 |
| rain, beach | 4.14 | 2.25 | 2.26 |
| pressure, dark | 6.61 | 3.90 | 2.82 |
| pressure, light | 4.80 | 2.94 | 1.94 |
| pressure, beach | 4.65 | 2.77 | 1.99 |

Rain's middle frame is equally far from both ends in every theme. Pressure's leans to the end because its numbers and H / L
markers switch at once (5.5-8.6 % of changed pixels already equal the end picture); before the two fixes it read 5.89 / 0.84 in
dark. Sheets (three themes, start / middle / end, both layers) sent to the owner.

Cost on the throttled phone (390 x 844, dpr 3, CPU 4x; pressure, 12 scrub steps; the blend against its own kill, same build):
scrub long-frame total 10108 and 9366 ms with the blend, 10302 ms without; blocking 4210 and 3751 against 4407. No cost
visible above the run-to-run scatter (two runs on, one off read at the time of writing).

## Tests
+19 in `ownRasterLayer.test.js` (the step, the kill, reduced motion, different grids, mid-blend steps, eviction, the shader's
order, and for each of dark, light and beach and each of pressure, cloud cover and rain: every blended value draws a colour
of that theme lying between the two frames' colours); +2 in `usePressureIsobars.test.js` (the crossfade; a cut before the
lines have loaded). The existing instant-switch test now runs under the kill, its contract unchanged. Kill in the inventory
(TESTED). The 13 touched suites: 200 passed locally before the last isobar test was added.

## Not measured
A real phone; Safari and Firefox; play mode; the look at the real 160 ms (only photographed held open); memory; EURO's
6-hour steps past 144 h; air temperature and cloud cover were not photographed (same code path, tests only).

## Not done here (the research list this came from)
Motion-compensated blend for rain at 3-hour spacing; bicubic sampling; a theme-varied, colour-blind-safe rain ramp (light rain
is faint on the light and beach basemaps today, in both the present path and ours); bolder index isobars.
