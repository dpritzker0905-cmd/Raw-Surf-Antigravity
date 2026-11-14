# 2026-11-14 Fable (animation lane): #892's light and beach results were scored on the wrong map colours; and a swatch behind the three legend bars

Client only, no served number. Follow-up to #892 (merged 09:04Z). Two things, kept apart below.

## 1. Finding (05:15 EST): the checker's light and beach basemap colours were the WIND-MUTED ones
`scripts/raster-color/check.mjs` took its light and beach basemap colours from `scripts/wind-color/check.mjs`. Those describe
the map as it is muted under the wind layer. Fog, air temp and water temp are drawn over the map as it is. Sampled now in the
offline app, no weather layer on (the most common pixel of a 550 x 400 patch: open ocean for water, 96-97% of the patch; the
Sahara for land, 72-74%):

| theme | water, real | water, checker had | land, real | land, checker had |
|---|---|---|---|---|
| light | [144, 223, 254] | [168, 214, 222] | [252, 252, 252] | [236, 236, 232] |
| beach | [117, 207, 240] | [150, 190, 200] | [239, 233, 225] | [222, 208, 180] |
| dark | [93, 117, 126] | the same | [66, 77, 92] | the same |

Every gate line of `2026-11-14-fable-raster-palettes.md`, unchanged, re-run on the MERGED tables with the real colours:
**7 lines fail** (all in light or beach; every dark line and every fog line passes):
- T1 air temp 5 C band step (>= 4.5): light water 4.06, beach water 4.11
- T2 -10 C vs +10 C, colour-blind (>= 20): light water 17.8, beach water 16.2
- W2 water temp 1 C step, normal (>= 1.5): light 1.35, beach 1.27
- B1 against the bare map, colour-blind (>= 3.0): air temp over beach land at 0 C = 1.96

So #892's statement "every gate line passes" was true only for the wrong map colours in light and beach. These are misses of
margin, not a broken picture, and against the tables drawn before #892 the new ones are still better on most of these
measures; but the claim was wrong and is corrected here. Reported to the director at 05:15 EST.

**What will be done about it (this PR):** the checker gets the measured colours; only the failing ends of the tables are
re-tuned until every UNCHANGED gate line passes on the real colours; every line is reported again with before and after.

## 2. The legend swatch
Seen in the offline app: in the beach theme the fog legend bar is slate fading to clear on the theme's near-black weather panel,
so the bar is hard to see although it matches the map. The bars will be drawn over a swatch of the map's own colour.
- Swatch = the theme's WATER colour (real, table above), for all three layers: it is the surface a surf map always shows, and a
  land swatch would be white on the light theme's white panel.
- Where: the bar's CSS background gains a second, solid layer under the gradient (`linear-gradient(...), rgb(...)`), computed in
  `rasterPalettes.rasterLegend`. No element, attribute, label or handler is added or changed; every layout draws the same string.
- Kill: `window.__RAW_DISABLE_RASTER_LEGEND_SWATCH__ = true` (the bar on the panel, as merged in #892).

### Legend contrast gate, written at 05:20 EST BEFORE measuring it
Instrument: `check.mjs` (CIEDE2000). The bar's colour at a value = the table's colour at its own alpha over the swatch. Panel
backgrounds sampled from app screenshots (the most common colour of the panel area that is not a button): light
[249, 253, 255], dark [28, 29, 32], beach [11, 16, 24]. Measured at each tick value of each bar (air temp: -10, 10, 32, 50, 70,
90, 110 F; water temp: 35, 45, 55, 65, 75, 85 F; fog: 100 m, 300 m, 1 km, 3 km, 10 km), in light, dark and beach.
- **LG1 (the bar against its own panel):** at EVERY tick, at least **10** in normal vision. This includes fog's clear end, where
  the bar is the swatch itself.
- **LG2 (the bar against its swatch):** at every tick where the table's alpha is above 0, at least **5** in normal vision and at
  least **3** in each colour-blind view (the same thresholds as B1, since the swatch is the bare map's colour).
- Both are also measured WITHOUT the swatch (the bar straight on the panel) so the before is on record; no threshold applies to
  that row.
- If a line fails, the swatch or the failing table end is changed and every gate line (palette and legend) is re-run.
- The advisor reviews this gate's result independently before merge (Reflection's condition, relayed by the director).

## 3. Results (05:55 EST). Instrument: `node scripts/raster-color/design.mjs --all` (CIEDE2000, tables scored as the step tables they are)
The director's decision (05:48 EST): #892 is not reverted, since on the real colours its tables still beat the ones before it on
the failing measures; continue with the plan above.

### 3a. The palette gates on the REAL map colours: before (the tables merged in #892) and after (this PR). No gate line was changed.
| line | threshold | #892 tables | this PR |
|---|---|---|---|
| T1 air temp 5 C step, light water | >= 4.5 | 4.06 FAIL | 5.37 |
| T1 air temp 5 C step, beach water | >= 4.5 | 4.11 FAIL | 5.48 |
| T2 -10 vs +10 C, colour-blind, light water | >= 20 | 17.8 FAIL | 23.3 |
| T2 -10 vs +10 C, colour-blind, beach water | >= 20 | 16.2 FAIL | 20.9 |
| W2 water temp 1 C step, normal, light | >= 1.5 | 1.35 FAIL | 1.64 |
| W2 water temp 1 C step, normal, beach | >= 1.5 | 1.27 FAIL | 1.52 |
| B1 air temp vs bare beach land, colour-blind | >= 3.0 | 1.96 FAIL | 5.06 |

Every other line passes in both. Worst values after, over all themes and surfaces: T1 normal 5.37, colour-blind 3.34 (light
land, tritan); T2 normal 44.3, colour-blind 20.9; T3 no lightness reversal; T4 17.5 to 26.6; W1 0 reversals; W2 normal 1.52,
colour-blind 1.32; W3 mean step 2.80 / 2.82 / 3.24 against 2.69 / 2.60 / 3.05 before #892; F1 22.1; F3 4.4; B1 normal 5.21
(air temp, beach land, 0 C), colour-blind 3.09 (water temp, dark water, 16 C, protan).
**Thin margins, stated plainly:** W2 beach 1.52 on a line of 1.5; T2 beach water colour-blind 20.9 on 20; B1 3.09 and 3.10 on 3.0.

What changed in the tables: air temp, the stops from -40 to +15 C (found by a random search with refinement over the anchor
lightness, chroma and hue, after hand tuning did not converge; the first colour above freezing is now a pale apricot rather
than cream, because cream sank into beach land); water temp, the three coldest anchors (-2, 4, 8 C). Fog is unchanged.

### 3b. The legend gate (written at 05:20 EST, first measured at 05:40 EST)
First measurement, with the re-tuned tables of 3a: 17 of 18 lines passed; **LG1 water temp, beach, FAILED: 8.9 at 35 F** (line:
10). The cold end of the water temp bar is a near-black violet on beach's near-black panel; the swatch cannot help there
because the temperature tables are opaque (the swatch shows only through fog's alpha). As the gate said, the failing table end
was changed (water temp -2 C lightness 0.10 -> 0.115, 4 C 0.165 -> 0.185) and every palette and legend line was run again. Two
lighter tries (0.125 / 0.195 and 0.135 / 0.205) passed LG1 but failed W2 beach (1.39), so they were not used.

Final, all 18 pass (minimum over the ticks; "bare" = the same bar without the swatch, no threshold):
| bar | theme | LG1 bar vs panel (>= 10) | bare | LG2 bar vs swatch, normal (>= 5) | LG2 colour-blind (>= 3) |
|---|---|---|---|---|---|
| air temp | light | 16.6 | 16.6 | 32.4 | 30.4 |
| air temp | beach | 20.8 | 20.8 | 34.0 | 32.0 |
| air temp | dark | 22.2 | 22.2 | 16.3 | 13.0 |
| water temp | light | 21.9 | 21.9 | 35.1 | 21.2 |
| water temp | beach | 12.1 | 12.1 | 32.1 | 19.0 |
| water temp | dark | 13.7 | 13.7 | 17.4 | 4.5 |
| fog | light | 19.3 | **0.0** | 7.5 | 7.2 |
| fog | beach | 10.8 | **0.0** | 6.8 | 6.5 |
| fog | dark | 29.7 | **0.0** | 9.9 | 9.7 |

What the swatch does and does not do: it changes the FOG bar only (its clear end was the panel itself, 0.0; it is now the map's
water colour). The air temp and water temp bars are opaque, so the swatch is under them and not seen; their numbers are the
same with and without it. Thin margin: fog beach LG1 10.8 on a line of 10 (the dense end, slate on a near-black panel).

### Lesson (for LESSONS.md when the director batches it)
**Verify an instrument's constants against the real rendering surface before a gate is trusted.** The palette checker borrowed
its basemap colours from the wind checker; they described a different surface (the map as muted under wind). Every light and
beach number in #892 was computed correctly and was about the wrong map. One sample of the bare map in the app would have
caught it before the gate was written.

## 4. In the app, and tests (06:05 EST)
Offline harness only (synthetic backend, built client; nothing asked of the live backend). The legend bar as the browser draws
it, read from computed style, for fog, air temp and water temp x light, dark, beach x desktop (1280 x 800) and phone
(390 x 844, in the weather sheet): 18 of 18 bars have one gradient layer over a background colour equal to that theme's water
colour (light rgb(144, 223, 254), dark rgb(93, 117, 126), beach rgb(117, 207, 240)); the bar has no child element, no role and
no aria attribute, and its tick labels are unchanged. With `window.__RAW_DISABLE_RASTER_LEGEND_SWATCH__ = true` and a layer
toggle, the fog bar's background colour is transparent again in all six theme and layout cases (the bar as merged in #892).
Seen by eye on the beach phone sheet: the fog bar now runs from slate to the map's water blue; with the kill it fades into the
panel as before.

Tests: `rasterPalettes.test.js` 39 -> 46 (floor fragment +7 tests, no new suite); the kill is in
`killSwitch.inventory.test.js`. The whole map and tests trees pass locally: 7,106 tests. Lint ratchet and file-size check pass.

NOT verified: a real phone, Safari, Firefox, the deployed site, and the own-frames drawing path (#889), which reads the same
tables through `rasterScaleFor`. The palettes were not looked at again by eye on the map after the re-tune beyond the legend
shots; the numbers in section 3 are the evidence for the map itself.
