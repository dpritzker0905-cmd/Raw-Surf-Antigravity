/**
 * windLightPath.js — light's wind field in dark's ORDER, in light's own key (owner, 2026-10-12; DECISIONS D-024).
 *
 * The owner: "Dark mode is the model. It needs to be copied, but with the proper colors to match the themes and the maps underneath";
 * on the plan for this change: "you need to double check all this. The light and beach modes need to make sense logically. It could
 * be the way it is, or it could not be. It all has to make sense to match dark mode, but [in] their colors and maps"; and, shown a
 * first candidate moving beside dark with what it cost the streaks over land: "option 2, give the streaks their ground back".
 *
 * THE CHECK (scripts/wind-color/light-path-solve.mjs and mirror-model.mjs: each field as drawn over its own map, knot by knot). Dark
 * carries speed in the ORDER of its hues: one way round the wheel with speed (magenta, violet, blue, aqua, green, yellow-green, yellow,
 * orange, red), never turning back over its land. Light already ran that order at calm, 3, 6 and 16 kn and from 33 kn up. It broke it
 * twice:
 *   10 kn  an orchid (CIELAB hue 318), the colour dark gives CALM air: the hue ran backwards from 6 kn's periwinkle (291);
 *   21 kn  a teal (162) behind 16 kn's green (129), and LIGHTER than it (L* 61.4 against 57.1): a fresh breeze read as less wind.
 * Both were chosen to keep the wind off the colour of light's cyan sea, before the map was greyed under the wind (windBasemapMute.js),
 * and were then held in place by the colour-blind passes. Between them the field swung through 188 degrees of hue in six knots, the
 * hardest edge any theme draws (16.0 dE00 from 11 to 12 kn; dark's hardest is 8.9).
 *
 * WHAT THIS DRAWS. Rows 1 to 32 kn of light's field under the white streak (WindColorRamp.js LIGHT_LOOK_FIELD.deep) are replaced by a
 * row a knot, solved with the colour-blind floor as a constraint (LESSONS L-V45). Calm, and every row from 33 kn, are the rows before.
 * The field ON SCREEN over light's muted land, L* / C* / hue, with dark's hue at that speed (over dark's land, by the engine's own law:
 * its field lands at alpha SQUARED over its map):
 *    3 kn  71.9 / 21.6 / 299  violet        (299)         6 kn  65.2 / 28.0 / 276  blue-violet   (256)
 *   10 kn  64.9 / 30.3 / 197  cyan          (177)        16 kn  60.1 / 32.1 / 165  sea green     (153)
 *   21 kn  60.1 / 36.3 / 138  green         (132)        27 kn  60.1 / 42.5 / 107  yellow-green  ( 97)
 *   - the hue never turns back from calm to 60 kn (it did four times) and sits within 20 degrees of dark's at every Beaufort stop from
 *     3 to 21 kn (dark's own field differs by 8 to 13 degrees between its land and its sea);
 *   - lightness never rises from calm to 33 kn (it rose 4.3 L* from 16 to 21 kn);
 *   - TWO LEVELS, for the white streak: 6 to 10 kn at L* 65, 16 to 27 kn at L* 60. A white streak needs a ground deeper than itself, and
 *     the first candidate (one level, L* 64 from 6 to 21 kn) cost the streaks a quarter of their lift over land;
 *   - neighbouring Beaufort stops stay 5.1 dE2000 or more apart for protan, deutan and tritan viewers, over land AND sea (5.5 before);
 *   - no knot steps further than 7.9 dE00 (16.0 before; dark's hardest is 8.9).
 * WHAT IT COSTS, said plainly:
 *   - the 6 to 16 kn bands are less colourful (C* 28 to 32 against 45 to 47): a cyan or a blue this deep cannot hold more under a
 *     multiply tint. It is still more colour than dark's own field shows there (C* 18 to 21 on screen);
 *   - 10 kn is 5.8 L* lighter and 16 kn 3.0 lighter than before (21 kn is 1.3 deeper): the cyan band stays light in every solve;
 *   - 3 kn is a shade less colourful (C* 21.6 against 26.4), which is what separates it from the new 6 kn for a protan viewer;
 *   - the weakest NORMAL-vision neighbours are 8.0 dE00 apart (27 to 33 kn over the sea); the field's weakest was 9.0 (47 to 55 kn,
 *     kept). Dark's own weakest is 5.5 over its land and 5.1 over its sea;
 *   - a hue match held to 8 degrees was solved too: it keeps the floor with 6 kn 6 to 7 L* lighter and 16 to 21 kn 2 to 5 lighter than this.
 * Each streak's colour core follows the field's hue (the rule light's streak row was built by: the field's own hue at full brightness,
 * 14 L* above the field over the land).
 *
 * THE LEGEND MOVES WITH IT (the field and the legend move together or not at all: LESSONS L-V45). `legend` below is the bar's 3 to 27 kn
 * rows (scripts/wind-color/light-path-legend.mjs): each within 6.5 degrees of the hue the field draws over the land at that stop (13 over
 * the sea), and the bar within 17 degrees of the field at every half knot from 3 to 40 kn (the palette checker's line asks for 30). Neighbouring rows
 * from calm to 33 kn are 12.0 dE2000 apart or more in normal vision (9.3 before) and 5.4 for protan, deutan and tritan (5.2 before);
 * lightness never rises along the bar (it turned back twice). Calm (cloud white) and the rows from 33 kn (gold) are the legend's own.
 * These rows are drawn ONLY on the bar: with the path on, the streaks take `marks` above; with it off, every row is the one before.
 *
 * Where the path meets the rows it keeps, a streak's colour core steps 12.8 dE00 from calm to 1 kn and 8.1 from 32 to 33 kn (4.2 and 4.8
 * before): the core is a pixel under the white ring, and the FIELD's own step there is unchanged.
 *
 * THE MARGIN (2026-10-13, DECISIONS D-031; the owner: "option 1, merge as shown and add the pin", then "the small colour-blind tweak to
 * lights colors"). The numbers above are the path as it merged (PR #318). On the table it held 5.1; AS DRAWN it did not: the engine uploads
 * the field as a 256-texel, 8-bit texture for the data's own maximum (10 to 80 kn), and through it (the GPU's lookup, `check.mjs
 * --as-uploaded 10-80:0.25`) the weakest pair over the SEA read 4.93, under 5.0 at 32 of the 281 maxima, whatever the land. The `field`
 * below is that field moved by the smallest step that holds 5.0 as drawn at every maximum (scripts/wind-color/light-margin-solve.mjs):
 *   - over the sea 5.03 as drawn (5.16 on the table); over the land as it draws a step above the sea (D-026 amended) 5.20 (5.18 before);
 *   - no knot moves further than 0.11 dE00 on screen (10 kn), 2.1 dE00 summed over 37 rows: not a step the eye finds side by side. The
 *     hue order, the two levels, the edge, the legend bar and each streak's colour core are re-read on these rows and held; lightness
 *     rises by at most 0.05 L* from calm to 33 kn (0.02 as merged): at its bar;
 *   - the rows from 33 to 63 kn, which the path first kept, take a step too (27-33 kn is one of the sea's weak pairs): the field owns 1
 *     to 63 kn (`fieldTo`). The streak row and the legend bar are NOT moved;
 *   - under the land step's kill (the land at the sea's depth, PR #320's) the line over the LAND is still short as drawn (4.94, under 5.0
 *     at 68 of 281 maxima; 4.85 and 123 before): a kill's picture, read and not solved for.
 * "AS DRAWN" HERE IS THE TEXTURE AND THE GPU'S LOOKUP. The screen rounds each pixel to 8 bits once more, and no instrument here models that.
 * A crude model of it (the independent review of this change: one flat ground colour, each tinted pixel rounded to a byte) moves a pair by
 * several times this margin and reads the sea's 3-6 kn pair under 5.0 at some maxima before the margin and with it (153 and 80 of 281).
 * There is no second kill: the path's own kill below restores light before the path, as it did. The path's rows as PR #318 merged them
 * are scripts/wind-color/light-path-318.json (the solver's reference, and the tests' control).
 *
 * Kill: window.__RAW_DISABLE_WIND_LIGHT_PATH__ = true (light's field, streak row and legend as they drew before it, byte for byte; the
 * engine rebuilds its tables at once, the legend bar at its next render: MapWeatherControls keys its memo on the look key). ON only
 * where the white streak draws as D-022 lays it (WindColorRamp.js windLightPathOn), so every lever and older kill that stands the
 * white streak down, and D-022's own kill, still draw exactly what they drew. Not under the Canvas2D fallback. Beach and dark are not touched.
 *   - D-022's kill (__RAW_DISABLE_WIND_DARK_WHITE__) restores D-021's picture: full white over the tables THAT picture was drawn on. An
 *     older kill keeps its meaning (LESSONS L-V25), so it steps back past the path first.
 *   - The Canvas2D fallback (WindParticleOverlay.js) draws its marks from the particle ramp, so the bar must stay that ramp there. The
 *     streaks under the path are white light over the field and take no colour from the particle ramp, which is why the bar can follow the field.
 */
const rows = (list) => Object.freeze(list.map((r) => Object.freeze(r)));
export const LIGHT_PATH = Object.freeze({
  from: 1,    // the first knot it owns: light's calm row stays the deeper field's own
  to: 32,     // the last knot the STREAK ROW owns (every row from 33 kn is the deeper marks' own)
  fieldTo: 63,   // the last knot the FIELD owns since the margin (2026-10-13): the rows it first kept from 33 kn take a small step too; 75 kn is the deeper field's own
  field: rows([
    [1, 0.664, 0.243, 0.573, 0.73], [2, 0.561, 0.309, 0.683, 0.74], [3, 0.468, 0.399, 0.770, 0.75], [4, 0.447, 0.458, 0.805, 0.76],
    [5, 0.412, 0.498, 0.825, 0.77], [6, 0.353, 0.518, 0.832, 0.78], [7, 0.215, 0.564, 0.834, 0.785], [8, 0.069, 0.590, 0.793, 0.79],
    [9, 0.000, 0.607, 0.719, 0.795], [10, 0.000, 0.617, 0.619, 0.8], [11, 0.000, 0.604, 0.577, 0.803], [12, 0.000, 0.591, 0.534, 0.807],
    [13, 0.009, 0.578, 0.491, 0.81], [14, 0.026, 0.563, 0.446, 0.813], [15, 0.046, 0.549, 0.402, 0.817], [16, 0.068, 0.534, 0.358, 0.82],
    [17, 0.098, 0.532, 0.323, 0.824], [18, 0.131, 0.530, 0.288, 0.828], [19, 0.167, 0.527, 0.252, 0.832], [20, 0.203, 0.523, 0.217, 0.836],
    [21, 0.241, 0.518, 0.182, 0.84], [22, 0.275, 0.513, 0.148, 0.843], [23, 0.311, 0.507, 0.114, 0.847], [24, 0.348, 0.501, 0.082, 0.85],
    [25, 0.385, 0.493, 0.052, 0.853], [26, 0.424, 0.485, 0.024, 0.857], [27, 0.463, 0.475, 0.000, 0.86], [28, 0.463, 0.452, 0.000, 0.862],
    [29, 0.462, 0.428, 0.000, 0.863], [30, 0.460, 0.406, 0.000, 0.865], [31, 0.455, 0.384, 0.000, 0.867], [32, 0.450, 0.361, 0.000, 0.868],
    [33, 0.442, 0.340, 0.000, 0.87], [40, 0.392, 0.211, 0.000, 0.88], [47, 0.515, 0.162, 0.137, 0.9], [55, 0.451, 0.001, 0.113, 0.91],
    [63, 0.356, 0.004, 0.281, 0.93],
  ]),
  marks: rows([
    [1, 1.000, 0.850, 0.967, 0.73], [2, 0.950, 0.830, 1.000, 0.74], [3, 0.858, 0.820, 1.000, 0.75], [4, 0.800, 0.802, 1.000, 0.76],
    [5, 0.730, 0.786, 1.000, 0.77], [6, 0.650, 0.774, 1.000, 0.78], [7, 0.530, 0.796, 1.000, 0.785], [8, 0.310, 0.825, 1.000, 0.79],
    [9, 0.000, 0.892, 1.000, 0.795], [10, 0.000, 1.000, 1.000, 0.8], [11, 0.000, 1.000, 0.962, 0.803], [12, 0.010, 1.000, 0.926, 0.807],
    [13, 0.000, 1.000, 0.888, 0.81], [14, 0.010, 1.000, 0.843, 0.813], [15, 0.010, 1.000, 0.794, 0.817], [16, 0.000, 1.000, 0.737, 0.82],
    [17, 0.030, 1.000, 0.669, 0.824], [18, 0.000, 1.000, 0.587, 0.828], [19, 0.000, 1.000, 0.483, 0.832], [20, 0.000, 1.000, 0.350, 0.836],
    [21, 0.000, 1.000, 0.100, 0.84], [22, 0.317, 1.000, 0.000, 0.843], [23, 0.517, 1.000, 0.000, 0.847], [24, 0.646, 1.000, 0.000, 0.85],
    [25, 0.750, 1.000, 0.000, 0.853], [26, 0.846, 1.000, 0.000, 0.857], [27, 0.929, 1.000, 0.000, 0.86], [28, 0.967, 1.000, 0.000, 0.862],
    [29, 1.000, 0.996, 0.000, 0.863], [30, 1.000, 0.958, 0.000, 0.865], [31, 1.000, 0.925, 0.000, 0.867], [32, 1.000, 0.892, 0.000, 0.868],
  ]),
  // by the legend's own row index (as the PRE_* tables in WindColorRamp.js): violet, blue-violet, cyan, sea green, green, yellow-green
  legend: Object.freeze({ 1: Object.freeze([3, 0.816, 0.720, 0.999, 0.75]), 2: Object.freeze([6, 0.555, 0.663, 0.939, 0.78]), 3: Object.freeze([10, 0.003, 0.741, 0.770, 0.80]),
    4: Object.freeze([16, 0.361, 0.735, 0.581, 0.82]), 5: Object.freeze([21, 0.540, 0.713, 0.436, 0.84]), 6: Object.freeze([27, 0.680, 0.681, 0.297, 0.86]) }),
});

/** `base` (rows of [kn, r, g, b, a]) with every row from LIGHT_PATH.from to `to` (LIGHT_PATH.to unless given) replaced by `rows`; the rows outside that span are base's own. */
export function lightPathRows(base, rows, to = LIGHT_PATH.to) {
  return base.filter(function(s) { return s[0] < LIGHT_PATH.from; }).concat(rows, base.filter(function(s) { return s[0] > to; }));
}

let TABLES = null;
/**
 * What light draws under the white streak (WindColorRamp.js darkRulesTables): `field` and `marks` as they are, or, on the path, with the
 * field's 1 to 63 kn rows and the streak row's 1 to 32 kn rows replaced by LIGHT_PATH's. One streak row over land and sea alike. The path's tables are built once: the caller always
 * hands in the same two module constants (LIGHT_LOOK_FIELD.deep, LIGHT_LOOK_MARKS.deep).
 */
export function lightTables(onPath, field, marks) {
  if (!onPath) return { field: field, land: marks, water: marks };
  if (!TABLES) { const m = lightPathRows(marks, LIGHT_PATH.marks); TABLES = { field: lightPathRows(field, LIGHT_PATH.field, LIGHT_PATH.fieldTo), land: m, water: m }; }
  return TABLES;
}
