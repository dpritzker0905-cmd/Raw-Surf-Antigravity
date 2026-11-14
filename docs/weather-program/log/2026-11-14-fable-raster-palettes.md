# 2026-11-14 Fable (animation lane): air temp, water temp and fog palettes. Baseline and gates, written before any design

Owner, 2026-11-13 23:35 EST (relayed by the director): "improve the fog, air temp, and water temp along with the others, so
that all lanes are upgrades and instant." This lane: the visual part. Client only; no served number changes (the readouts
are not touched). Each palette ships ON with its own kill switch.

## How the three layers are drawn today (read in the code)
- Air temp (`temperature_2m`) and water temp (`surface_temperature`, aliased to the library's sea-surface scale) use the tile
  library's OWN default scale: one rainbow-like table from -80 to 50 C for both, alpha 1, the same in every theme.
- Fog (`visibility`) uses an app scale in `colorScales.js`: near-white greys, alpha 0.85 below 500 m falling to 0 at 5 km.
- Each is alpha-blended over the basemap at the layer's raster opacity (zoom 5: temp 0.44, water temp 0.52, fog 0.52;
  `MapWebGL.js`). Water temp is drawn under the land fill, so it shows over water only.
- The three legends are hand-written gradients in `MapWeatherControls.js` (lines 198-226), not derived from the drawn scale.

## Instrument: `frontend/scripts/raster-color/check.mjs`
Composites a scale over each theme's basemap water and land at the layer's zoom-5 opacity and measures CIEDE2000 distances in
normal vision and under simulated protanopia, deuteranopia and tritanopia (culori). Basemap colours: light / beach / dark
water from `scripts/wind-color/check.mjs`; dark land sampled from an app screenshot ([66, 77, 92]). Limits: flat basemap
colours (no labels, roads or relief), one zoom's opacity, simulated colour blindness, sRGB blending as the raster layer does.

## Baseline (today's scales, as drawn), measured 2026-11-14 00:05 EST
| layer | measure | light | beach | dark |
|---|---|---|---|---|
| air temp | smallest step between 5 C bands (-30..40), normal vision, water / land | 5.4 / 5.1 | 5.8 / 5.5 | 5.4 / 4.8 |
| air temp | the same, worst colour-blind view | 1.3 / 1.3 (protan, at -25 C) | 1.3 / 1.4 | 1.3 / 1.2 |
| air temp | -10 C against +10 C, normal / worst colour-blind | 50 / 16 (tritan) | 50 / 17 | 52 / 20 |
| air temp | the palest (least chromatic) point of the table | -2 C | -2 C | -2 C |
| air temp | -1 C against +1 C | 11.0 / 10.1 | 11.3 / 8.8 | 11.4 / 12.2 |
| water temp | smallest 1 C step (4..30 C), normal / worst colour-blind | 1.25 / 0.85 | 1.31 / 0.85 | 1.25 / 0.85 |
| water temp | mean 1 C step | 2.60 | 2.69 | 3.05 |
| water temp | lightness reversals across 4..30 C | 2 | 2 | 2 |
| fog | dense fog (200 m) against the bare map, water / land | 5.7 / **0.9** | 7.4 / 5.1 | 18.6 / 26.3 |
| fog | fog (800 m) against the bare map, water / land | 3.9 / 0.9 | 5.2 / 3.8 | 13.8 / 17.8 |
| fog | dense (200 m) against fog (800 m), water / land | 1.9 / 0.3 | 2.2 / 1.3 | 4.9 / 7.3 |

Reading: in the light theme dense fog over land is 0.9 from the bare map, i.e. not visible. Air temp bands merge for a
red-blind viewer around -25 C. Water temp is not monotone in lightness and its 1 C steps drop under 1 for a blue-blind viewer.

## Gates. Written from the baseline above, BEFORE any new palette exists. Every line is per theme and, where a layer covers
both, per surface. A palette that fails any line of its own block does not ship; the lines are not moved afterwards.
**Air temp (diverging around 0 C / 32 F)**
- T1. Smallest step between 5 C bands, -30..40 C: at least 4.5 in normal vision AND at least 3.0 in each colour-blind view.
- T2. -10 C against +10 C: at least 30 in normal vision AND at least 20 in each colour-blind view.
- T3. Diverging: the least chromatic point of the table lies within 1 C of 0 C, and the drawn lightness moves one way from 0 C
  to -30 C and one way from 0 C to 40 C (no reversal larger than 0.5 L*).
- T4. -1 C against +1 C: at least 6 (the freezing line stays readable).
**Water temp (sequential)**
- W1. Drawn lightness monotone across 4..30 C: 0 reversals larger than 0.3 L*.
- W2. Smallest 1 C step, 4..30 C: at least 1.5 in normal vision AND at least 1.2 in each colour-blind view.
- W3. Mean 1 C step not below today's (light 2.60, beach 2.69, dark 3.05).
**Fog (low-visibility emphasis)**
- F1. Dense fog (200 m) against the bare map: at least 15, every theme, water and land, every view.
- F2. Fog (800 m) against the bare map: at least 10. Mist (3 km): between 2 and 8. Clear (10 km and more): 0.
- F3. Dense (200 m) against fog (800 m): at least 4.
**All three**
- C1. The legend data (gradient and tick values) is computed from the same table that is drawn; a test pins it.
- C2. No frame-time regression: the tables are the same size and are only read as a lookup, so none is expected; checked
  with `scn_gpu_cost.js` on the layer, new against kill, three page loads each, median GPU frame time not more than 10% worse.
- C3. No served number: no readout, value or unit is changed (the diff touches colour tables and legend data only).
- C4. Drawn in the app in light, dark and beach, on desktop and phone, before the PR is marked ready.

## Open questions sent out (00:00 EST), not yet answered
- Director: is `MapWeatherControls.js` still reserved to Codex? The legend hookup lives there.
- Move 3: which layer ids and units its frame sets for fog and water temp will use; who edits the scale maps in
  `useOwnRasterFrames.js`.
