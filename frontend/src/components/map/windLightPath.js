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
 *   - no knot steps further than 7.8 dE00 (16.0 before; dark's hardest is 8.9).
 * WHAT IT COSTS, said plainly:
 *   - the 6 to 16 kn bands are less colourful (C* 28 to 32 against 45 to 47): a cyan or a blue this deep cannot hold more under a
 *     multiply tint. It is still more colour than dark's own field shows there (C* 18 to 21 on screen);
 *   - 10 kn is 5.8 L* lighter and 16 kn 3.0 lighter than before (21 kn is 1.3 deeper): the cyan band stays light in every solve;
 *   - 3 kn is a shade less colourful (C* 21.6 against 26.4), which is what separates it from the new 6 kn for a protan viewer;
 *   - the weakest NORMAL-vision neighbours are 8.0 dE00 apart (27 to 33 kn over the sea); the field's weakest was 9.0 (47 to 55 kn,
 *     kept). Dark's own weakest is 5.5 over its land and 5.1 over its sea;
 *   - a hue match about three times as tight was solved too: it needs the field 4 to 12 L* paler from 6 to 21 kn to keep the floor.
 * Each streak's colour core follows the field's hue (the rule light's streak row was built by: the field's own hue at full brightness,
 * 14 L* above the field over the land).
 *
 * THE LEGEND MOVES WITH IT (the field and the legend move together or not at all: LESSONS L-V45). `legend` below is the bar's 3 to 27 kn
 * rows (scripts/wind-color/light-path-legend.mjs): each within 6 degrees of the hue the field draws at that stop, and the bar within 17
 * degrees of the field at every half knot from 3 to 40 kn over land and sea (the palette checker's line asks for 30). Neighbouring rows
 * from calm to 33 kn are 12.0 dE2000 apart or more in normal vision (9.3 before) and 5.4 for protan, deutan and tritan (5.2 before);
 * lightness never rises along the bar (it turned back twice). Calm (cloud white) and the rows from 33 kn (gold) are the legend's own.
 * These rows are drawn ONLY on the bar: with the path on, the streaks take `marks` above; with it off, every row is the one before.
 *
 * Kill: window.__RAW_DISABLE_WIND_LIGHT_PATH__ = true (light's field, streak row and legend as they drew before it, byte for byte; the
 * engine rebuilds its tables at once). ON only where the white streak draws (WindColorRamp.js windLightPathOn), so every lever and
 * older kill that stands the white streak down still draws exactly what it drew. Beach and dark are not touched.
 */
export const LIGHT_PATH = Object.freeze({
  from: 1,    // the first and last knot it owns: light's calm row, and every row from 33 kn, stay the deeper field's own
  to: 32,
  field: [
    [1, 0.663, 0.242, 0.573, 0.73], [2, 0.560, 0.307, 0.684, 0.74], [3, 0.467, 0.397, 0.771, 0.75], [4, 0.446, 0.457, 0.804, 0.76],
    [5, 0.412, 0.498, 0.823, 0.77], [6, 0.354, 0.518, 0.829, 0.78], [7, 0.217, 0.564, 0.832, 0.785], [8, 0.072, 0.589, 0.791, 0.79],
    [9, 0.000, 0.606, 0.718, 0.795], [10, 0.000, 0.615, 0.618, 0.8], [11, 0.000, 0.603, 0.576, 0.803], [12, 0.000, 0.590, 0.533, 0.807],
    [13, 0.012, 0.577, 0.490, 0.81], [14, 0.028, 0.563, 0.446, 0.813], [15, 0.047, 0.549, 0.402, 0.817], [16, 0.069, 0.534, 0.358, 0.82],
    [17, 0.098, 0.533, 0.323, 0.824], [18, 0.131, 0.531, 0.288, 0.828], [19, 0.166, 0.528, 0.252, 0.832], [20, 0.202, 0.524, 0.217, 0.836],
    [21, 0.240, 0.519, 0.182, 0.84], [22, 0.274, 0.514, 0.148, 0.843], [23, 0.310, 0.508, 0.114, 0.847], [24, 0.347, 0.501, 0.082, 0.85],
    [25, 0.384, 0.493, 0.052, 0.853], [26, 0.423, 0.484, 0.024, 0.857], [27, 0.462, 0.474, 0.000, 0.86], [28, 0.463, 0.451, 0.000, 0.862],
    [29, 0.462, 0.428, 0.000, 0.863], [30, 0.460, 0.406, 0.000, 0.865], [31, 0.456, 0.384, 0.000, 0.867], [32, 0.451, 0.362, 0.000, 0.868],
  ],
  marks: [
    [1, 1.000, 0.850, 0.967, 0.73], [2, 0.950, 0.830, 1.000, 0.74], [3, 0.858, 0.820, 1.000, 0.75], [4, 0.800, 0.802, 1.000, 0.76],
    [5, 0.730, 0.786, 1.000, 0.77], [6, 0.650, 0.774, 1.000, 0.78], [7, 0.530, 0.796, 1.000, 0.785], [8, 0.310, 0.825, 1.000, 0.79],
    [9, 0.000, 0.892, 1.000, 0.795], [10, 0.000, 1.000, 1.000, 0.8], [11, 0.000, 1.000, 0.962, 0.803], [12, 0.010, 1.000, 0.926, 0.807],
    [13, 0.000, 1.000, 0.888, 0.81], [14, 0.010, 1.000, 0.843, 0.813], [15, 0.010, 1.000, 0.794, 0.817], [16, 0.000, 1.000, 0.737, 0.82],
    [17, 0.030, 1.000, 0.669, 0.824], [18, 0.000, 1.000, 0.587, 0.828], [19, 0.000, 1.000, 0.483, 0.832], [20, 0.000, 1.000, 0.350, 0.836],
    [21, 0.000, 1.000, 0.100, 0.84], [22, 0.317, 1.000, 0.000, 0.843], [23, 0.517, 1.000, 0.000, 0.847], [24, 0.646, 1.000, 0.000, 0.85],
    [25, 0.750, 1.000, 0.000, 0.853], [26, 0.846, 1.000, 0.000, 0.857], [27, 0.929, 1.000, 0.000, 0.86], [28, 0.967, 1.000, 0.000, 0.862],
    [29, 1.000, 0.996, 0.000, 0.863], [30, 1.000, 0.958, 0.000, 0.865], [31, 1.000, 0.925, 0.000, 0.867], [32, 1.000, 0.892, 0.000, 0.868],
  ],
  // by the legend's own row index (as the PRE_* tables in WindColorRamp.js): violet, blue-violet, cyan, sea green, green, yellow-green
  legend: { 1: [3, 0.816, 0.720, 0.999, 0.75], 2: [6, 0.555, 0.663, 0.939, 0.78], 3: [10, 0.003, 0.741, 0.770, 0.80], 4: [16, 0.361, 0.735, 0.581, 0.82],
    5: [21, 0.540, 0.713, 0.436, 0.84], 6: [27, 0.680, 0.681, 0.297, 0.86] },
});

/** `base` (rows of [kn, r, g, b, a]) with every row from LIGHT_PATH.from to LIGHT_PATH.to replaced by `rows`; the rows outside that span are base's own. */
export function lightPathRows(base, rows) {
  return base.filter(function(s) { return s[0] < LIGHT_PATH.from; }).concat(rows, base.filter(function(s) { return s[0] > LIGHT_PATH.to; }));
}
