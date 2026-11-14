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
