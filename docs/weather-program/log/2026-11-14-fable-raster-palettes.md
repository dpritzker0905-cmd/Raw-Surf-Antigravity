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

## 00:20 EST. An instrument correction, made AFTER the gates above were written (the gate lines are unchanged)
The baseline table above was measured with a checker that BLENDED between a table's stops. That is not how these tables are
drawn: the tile library colours a value with the last breakpoint at or below it (`findLastIndexLE`), and the own-frames path
builds a step lookup from the same breakpoints (Move 3, 00:07 EST). `check.mjs` now scores every table as the step table it
is. Today's tables re-measured as steps (what a user actually sees):
- water temp: the smallest 1 C step is **0** in every theme (the library's stops are 2 C apart, so neighbouring degrees share
  a colour); mean 1 C step unchanged (2.59 / 2.69 / 3.05).
- air temp: -1 C against +1 C is **23.1-24.8** today, not the 8.8-12.2 printed above (the library's table has a hard change of
  colour at 0 C). The other air temp lines move little (smallest 5 C band 5.4-5.9; worst colour-blind 1.3).
- fog: dense fog over light land **1.0** (was printed 0.9); the other fog numbers move by under 2.
What this means for the gates: none of the thresholds is changed. Line T4 ("at least 6") was written against the wrong
baseline and is far easier than today's real 23-25; to not ship something worse than today on that measure, the design was
pushed until the freezing edge reads 19.7-23.7. That is reported as "close to today, slightly under in 5 of 6 cases", not
as an improvement.

## 00:20 EST. Finding: the three legends cannot match the map today
`MapWeatherControls.js` builds the air temp, water temp and fog legends from hand-written gradients (its own comment: they
"approximate the OM library's registered scale"). They are not computed from the table that is drawn, so the bar and the map
agree only by coincidence, and with ANY change of table they disagree (seen: the new air temp table under the old rainbow
bar, offline app, dark theme). The marine, rain, pressure and wind legends are already computed from their tables.

## 00:20 EST. Legend gate, written BEFORE the legend block is edited
Codex's two UI PRs (#825, #874) are merged; the director's board records the edit as approved (04:52Z) with these conditions:
only the legend block, the same tables the map draws, all three layouts and themes, ARIA intact, a kill switch, and a re-read
for new reservations before pushing. One old Codex draft (#755, 2026-11-09) still touches the file; flagged to the director.
- L1. For air temp, water temp and fog, in light, beach and dark: every colour stop of the legend bar is the drawn table's
  colour at that value (within 2/255; a test). The bar may blend between stops (the table's stops are dense); it may not
  show a colour the table does not hold.
- L2. Every tick sits at its value's position on the bar (a test), and no two ticks are closer than 12% of the bar.
- L3. One legend configuration feeds every layout (read in the code and pinned by a test), and the bar is seen in the app
  on desktop and on the phone layout in each theme.
- L4. The diff removes no `aria-*` attribute, button or label, and adds no interactive element.
- L5. Kill: `window.__RAW_DISABLE_RASTER_LEGENDS__ = true` gives the three hand-written bars back. A layer whose PALETTE is
  under its kill also gets its old bar back, so the bar describes what is drawn in every combination (a test).
- L6. No number changes: the same units and labels as today for temperature (deg F ticks); fog gains distance ticks in metres
  and kilometres in place of "<1km / 5km / 10km / 20km", because the table ends at 10 km (the old bar named 20 km, a value the
  table never coloured).

## 01:45 EST. Results against the gates (tables scored as the step tables they are drawn as)
Design: `scripts/raster-color/design.mjs` builds each table from OKLCH anchors (interpolated in OKLab, chroma held inside the
sRGB gamut). It took seven rounds to pass every line; the anchors were tuned AGAINST the gate measures, which is the point of
writing the gates first, and means the tables are fitted to this instrument and its flat basemap colours.

| gate | result | worst case over themes and surfaces | today, for comparison |
|---|---|---|---|
| T1 air temp 5 C band step (>= 4.5 normal, >= 3.0 colour-blind) | PASS | 5.63 normal; 3.25 colour-blind | 5.4 normal; 1.3 colour-blind |
| T2 -10 C vs +10 C (>= 30 normal, >= 20 colour-blind) | PASS | 31.2 normal; 24.3 colour-blind | 50 normal; 16 colour-blind |
| T3 palest at 0 C, lightness one way on each side | PASS | palest at 0 C; no reversal | palest at -2 C |
| T4 -1 C vs +1 C (>= 6) | PASS | 19.7 (range 19.7-23.7) | 23.1-24.8 (about equal; slightly under in 5 of 6) |
| W1 water temp lightness monotone, 4..30 C | PASS | 0 reversals | not monotone |
| W2 smallest 1 C step (>= 1.5 normal, >= 1.2 colour-blind) | PASS | 1.74 normal; 1.32 colour-blind | 0 (stops 2 C apart) |
| W3 mean 1 C step not below today's | PASS | 2.92 / 2.99 / 3.19 | 2.60 / 2.69 / 3.05 |
| F1 dense fog vs bare map (>= 15) | PASS | 22.1 | 1.0 (light land) |
| F2 800 m >= 10; mist 3 km between 2 and 8; clear = 0 | PASS | 15.0; 3.2-6.2; 0 | 0.8 (light land) |
| F3 dense vs 800 m (>= 4) | PASS | 4.4 | 0.2 (light land) |

Note on T2: the new air temp table keeps cold and warm apart for every colour-blind view (24.3 against today's 16.3) but in
NORMAL vision -10 C against +10 C is 31-39 where today's rainbow gives 50. It passes the line; it is lower than today.

- **C1 (legend = table): PASS.** `rasterLegend` samples the drawn table; tests pin every colour stop of each bar against the
  table in the three themes, the tick positions, and a 12% minimum gap. L1, L2, L5 are those tests.
- **C2 (no frame-time regression): PASS, with wide spread.** `scn_gpu_cost.js`, desktop, three page loads per arm, GPU time per
  drawn frame while scrubbing (the layers draw no frame when the map is still, in either arm): air temp 0.41 / 0.41 / 0.79 ms
  new against 0.42 / 0.72 / 0.72 kill; water temp 0.93 / 1.32 / 2.54 against 1.34 / 0.93 / 1.87; fog 0.43 / 0.40 / 0.42
  against 0.40 / 0.38 / 0.71. Medians 0.41 vs 0.72, 1.32 vs 1.34, 0.42 vs 0.40 (+5%). Frame interval 16.7 ms in every run.
  The load-to-load spread is larger than any difference; the tables are the same kind of lookup, so none was expected.
- **C3 (no served number): PASS.** The diff holds colour tables, legend data and their wiring; no value, unit or readout.
- **C4 / L3 (seen in the app): PASS for the offline harness.** Light, dark and beach, desktop 1280x800 and the phone layout
  (390x844, dpr 3): the three layers draw with 0 page errors and the registered tables are the generated ones. Desktop: the bar
  and ticks beside the map match. Phone: the legend is in the weather sheet ("Weather layers" button); opened in all three
  themes, the bar is 350 px wide with the computed gradient and ticks ("<100 m 300 m 1 km 3 km Clear", "-10 ... 110+",
  "35 ... 85+"). With the kills set (light, desktop) the old tables and the old bars come back; dense fog over land is then
  invisible, as the baseline said.
- **L4 (ARIA): PASS.** The legend block's diff is 7 lines in, 8 out, inside the legend configuration; it contains no
  `aria-*`, button or label change. **L6:** temperature bars keep deg F ticks; fog names distances to 10 km.
- Tests: +33 in `rasterPalettes.test.js` (+1 suite); the four kills are in the inventory. The whole map and tests trees pass
  locally: 511 suites, 7,048 tests. Lint ratchet and file-size check pass.

## What this does NOT show
- A real phone, Safari, Firefox. Real basemap texture: the instrument uses one flat colour per surface, one zoom's opacity,
  and simulated colour blindness.
- The own-frames path for fog and water temp (Move 3's #889 is not merged); its hook will call `rasterScaleFor(layerId,
  theme)` so that a theme change cannot leave the previous theme's fog colours in place.
- Whether people prefer it. The new fog is a strong slate veil and blocky where the data is coarse; that is a taste call for
  the owner, with `__RAW_DISABLE_FOG_PALETTE__` as the way back.
- Opacity was not touched (`MapWebGL.js` owns it), so each palette is seen through the layer's existing 38-65% opacity.

## Coordination
Codex's own entry (coordination file in the main checkout, 03:44Z): "No Codex source file reservations remain for this
completed batch." Re-read at 01:45 EST before pushing: nothing newer than the director's 04:52Z notice. #755 is a stale Codex
draft superseded by #874 (the director, 00:40 EST).

## 03:05 EST. The advisor's red team: PASS WITH LIMITS. Two fixes before merge
**A (a defect).** The legend's memo does not depend on the palette kills, and the tables are re-registered only when the
theme changes. So a kill set in the console does not move the bar and the map together. Fix: one key holding the four kill
states, in the legend memo's dependencies AND in the effect that registers the tables, with a test and a mutant.

**B (a missing gate).** No line checks a table against the BARE map. Air temp is palest at 0 C over the pale light map, and
cold water is near-black over the dark map: either could sink into the basemap.

### Gate B1, written at 03:05 EST BEFORE measuring it (same instrument, tables scored as steps)
- For every theme, and every surface the layer covers, the drawn colour differs from that surface's bare colour by
  **at least 5.0 in normal vision and at least 3.0 in each colour-blind view**, at each of these values:
  air temp -30, -20, -10, -5, -1, 0, 1, 5, 10, 20, 30, 40 C; water temp 4, 8, 12, 16, 20, 24, 28, 30 C.
  (Fog already has its own lines against the bare map, F1 and F2.)
- 5.0 because it is a tint a viewer sees without looking for it (about five just-noticeable differences); it is fixed here and
  not moved after the measurement.
- If a value fails: change only the failing end of that table, then re-run EVERY gate line (T, W, F, B) and report all of
  them again, including any that got worse.
- What I expect before measuring, so it cannot be dressed up afterwards: the air temp table's neutral stop at 0 C over the
  light map's land is the likeliest failure.

## 03:40 EST. After the red team: gate B1 measured, the tables adjusted, and fix A (which needed two rounds)
### B1: FAILED at four places as first measured (after the threshold was fixed at 03:05), then passes
| where | measured | cause |
|---|---|---|
| air temp, light land, 0 C | 0.93 | the near-white neutral stop sank into the pale map (the failure I wrote down beforehand) |
| air temp, light water, -1 C | 3.53 normal; 2.52 colour-blind at -5 C | pale ice blue over the map's pale blue water |
| air temp, beach water, -5 C | 3.96 normal; 2.86 colour-blind | the same |
| water temp, dark water, 16 C | 3.52 | the grey-blue middle stop matched the dark map's own water |

Changed, only at those ends: no neutral stop at 0 C (0 C is the first, palest warm colour; the freezing line is the blue /
cream edge itself); the cold side near freezing bluer and darker; water temp's 16 C stop given more colour. The first attempt
broke T1 (5 C bands down to 1.5-2.0), so the cold side's lightness was re-spread down to a darker end: five rounds in all.

**Every gate line re-run on the final tables (all pass):**
| gate | worst case now | before the red team | today |
|---|---|---|---|
| T1 5 C band step (>= 4.5 / >= 3.0) | 4.57 normal (beach land); 3.25 colour-blind | 5.63; 3.25 | 5.4; 1.3 |
| T2 -10 vs +10 C (>= 30 / >= 20) | 39.5 normal; 25.8 colour-blind | 31.2; 24.3 | 50; 16 |
| T3 palest at 0 C, lightness one way | at 0 C, no reversal | same | at -2 C |
| T4 -1 vs +1 C (>= 6) | 24.1 (range 24.1-28.1) | 19.7 | 23.1-24.8 |
| W1 lightness monotone | 0 reversals | same | not monotone |
| W2 1 C step (>= 1.5 / >= 1.2) | 1.74; 1.37 | 1.74; 1.32 | 0 |
| W3 mean 1 C step not below today's | 2.89 / 2.96 / 3.15 | 2.92 / 2.99 / 3.19 | 2.60 / 2.69 / 3.05 |
| F1-F3 fog | unchanged (fog was not touched) | | |
| B1 vs the bare map (>= 5.0 / >= 3.0) | 5.13 normal (air, beach land, 0 C); 3.09 colour-blind (water, dark, 16 C) | 0.93 | - |

What got worse: T1's margin is now thin (4.57 against 4.5) and W3 slipped a little (still above today). What got better
without being aimed at: the freezing edge is now at or above today's, and cold-against-warm in normal vision is closer to
today's. Margins this thin on a simulated instrument are not a guarantee on a real screen.

### Fix A: the bar and the map must follow a kill together. It took two rounds, and the app run found the second
1. Round one: a key of the four kill states (`rasterPaletteKey`) in the dependencies of the legend's memo and of the effect that
   registers the tables. Tests, and two mutants caught (the key removed from either list fails two tests each).
2. The offline app then showed that was NOT enough: with a kill set in the console and the layer toggled, the registry and
   the bar went back to the old table but **the map kept the new colours**. The tile library colours a tile when it decodes it
   and the map keeps the coloured tile by URL; registering another table repaints nothing. (So my earlier note that a kill
   "takes effect at the next layer toggle" was wrong for the map.)
3. Round two: the tile URL of the three variables carries which table coloured the tile (`rasterPaletteUrlTag`: `&rp=p` or
   `&rp=o`, and for fog the theme, because fog's colour is per theme while the URL's own `dark=true` is shared by dark and
   beach), and the effect that builds the URLs re-runs on the key. A third mutant (the tag removed) is caught.
4. Offline app, light theme, air temp, after round two: palette on -> kill set in the console (nothing changes until a render)
   -> layer toggled: registry = the library's 46-stop table, bar = the old rainbow with its old ticks, and 90.2% of the map's
   pixels change by more than 12/255 (Texas [245, 225, 168] -> [147, 212, 144]); kill cleared and toggled: all three back, 2.5%
   of pixels differ from the first frame.
   NOT run in the app: the fog kill, the water temp kill, and a dark <-> beach theme switch with fog on (unit tests only).
- One existing wind test pinned the legend memo's exact dependency list and failed in the full run; it now requires the wind
  key and accepts further keys after it.

### Tests and checks after these changes
`rasterPalettes.test.js`: 39 tests (floor fragment +39, +1 suite). The whole map and tests trees pass locally: 511 suites,
7,057 tests. Lint ratchet and file-size check pass. The three themes redrawn on desktop with 0 page errors.
NOT redone after the table changes: the phone layout draw and the frame-time check (the tables are the same size and kind; the
earlier results are in the 01:45 section).
