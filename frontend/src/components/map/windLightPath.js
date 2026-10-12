/**
 * windLightPath.js — light's wind field in dark's ORDER, in light's own key (owner, 2026-10-12).
 *
 * The owner: "Dark mode is the model. It needs to be copied, but with the proper colors to match the themes and the maps underneath",
 * and, on the plan for this change: "you need to double check all this. The light and beach modes need to make sense logically. It
 * could be the way it is, or it could not be. It all has to make sense to match dark mode, but [in] their colors and maps".
 *
 * THE CHECK (scripts/wind-color/mirror-model.mjs, the field as drawn over each theme's own map, knot by knot). Dark carries speed in
 * the ORDER of its hues: one way round the wheel with speed (magenta, violet, blue, aqua, green, yellow-green, yellow, orange, red),
 * never turning back. Light already ran that order from calm to 6 kn and from 33 kn up; those rows are NOT touched. It broke it twice:
 *   10 kn  an orchid (CIELAB hue 318), the colour dark gives CALM air: the hue ran backwards from 6 kn's periwinkle (291);
 *   21 kn  a teal (162) behind 16 kn's green (129), and LIGHTER than it (L* 61.4 against 57.1): a fresh breeze read as less wind.
 * Both were chosen to keep the wind off the colour of light's cyan sea, before the map was greyed under the wind (windBasemapMute.js),
 * and were then held in place by the colour-blind passes. Between them the field swung through 190 degrees of hue in six knots, the
 * hardest edge any theme draws (16.0 dE00 from 11 to 12 kn; dark's hardest is 11.0).
 *
 * WHAT THIS DRAWS. Rows 4 to 32 kn of light's field under the white streak (WindColorRamp.js LIGHT_LOOK_FIELD.deep) are replaced by a
 * row a knot, solved with the colour-blind floor as a constraint (scripts/wind-color/light-path-solve.mjs; LESSONS L-V45). The field ON
 * SCREEN over light's muted land, L* / C* / hue (dark's hue at that speed):
 *    6 kn  64.2 / 30.0 / 279  blue-violet    (259)        10 kn  63.8 / 30.2 / 192  cyan          (172)
 *   16 kn  63.8 / 30.4 / 154  green          (149)        21 kn  63.8 / 36.6 / 127  yellow-green  (130)
 *   27 kn  60.1 / 42.6 / 106  yellow-green   ( 95)        33 kn  53.6 / 33.0 /  92  gold, as before (80)
 *   - the hue never turns back from calm to 60 kn (it did four times), and sits within 20 degrees of dark's at every Beaufort stop
 *     from 3 to 21 kn (dark's own field differs by 6 to 11 degrees between its land and its sea);
 *   - lightness never rises from calm to 33 kn, and from 6 kn the ground is as deep as before (L* 65.2 or deeper over land);
 *   - neighbouring Beaufort stops stay 5.2 dE2000 or more apart for protan, deutan and tritan viewers, over land AND sea (5.5 before);
 *   - no knot steps further than 9.0 dE00 (16.0 before).
 * WHAT IT COSTS, said plainly:
 *   - the 6 to 16 kn bands are less colourful (C* 30 against 45 to 47): a cyan or a blue this deep cannot hold more under a multiply
 *     tint, and that is dark's own strength there (C* 31 to 40);
 *   - 10 and 16 kn are 4.7 and 6.7 L* lighter than before (the 6 to 21 kn ground is one level, L* 64, where it stepped 65, 59, 57, 61);
 *   - the weakest NORMAL-vision neighbours are 8.0 dE00 apart (16 to 21 kn over the sea); the field's weakest was 9.0 (47 to 55 kn, kept).
 *     Dark's own weakest is 7.4;
 *   - holding dark's hue to 8 degrees instead of 20 was solved too: it needs the field 6 to 9 L* paler from 6 to 21 kn to keep the floor.
 * Each streak's colour core follows the field's hue (the same rule its row was built by: the field's own hue at full brightness, 14 L*
 * above the field over the land).
 *
 * Kill: window.__RAW_DISABLE_WIND_LIGHT_PATH__ = true (light's field and streak row as they drew before it, byte for byte; the engine
 * rebuilds its tables at once). ON only where the white streak draws (WindColorRamp.js windLightPathOn), so every lever and older kill
 * that stands the white streak down still draws exactly what it drew. Beach and dark are not touched.
 */
export const LIGHT_PATH = Object.freeze({
  from: 4,    // the first and last knot it owns: light's calm and 3 kn rows, and every row from 33 kn, stay the deeper field's own
  to: 32,
  field: [
    [4, 0.460, 0.443, 0.844, 0.76], [5, 0.415, 0.481, 0.842, 0.77], [6, 0.353, 0.496, 0.832, 0.78], [7, 0.190, 0.549, 0.831, 0.785],
    [8, 0.029, 0.576, 0.779, 0.79], [9, 0.000, 0.592, 0.688, 0.795], [10, 0.004, 0.597, 0.571, 0.8], [11, 0.036, 0.597, 0.536, 0.803],
    [12, 0.071, 0.596, 0.500, 0.807], [13, 0.109, 0.594, 0.464, 0.81], [14, 0.149, 0.591, 0.428, 0.813], [15, 0.189, 0.588, 0.394, 0.817],
    [16, 0.230, 0.583, 0.360, 0.82], [17, 0.254, 0.582, 0.326, 0.824], [18, 0.280, 0.579, 0.292, 0.828], [19, 0.310, 0.576, 0.257, 0.832],
    [20, 0.342, 0.571, 0.222, 0.836], [21, 0.376, 0.566, 0.188, 0.84], [22, 0.385, 0.553, 0.143, 0.843], [23, 0.397, 0.539, 0.097, 0.847],
    [24, 0.411, 0.524, 0.051, 0.85], [25, 0.427, 0.509, 0.004, 0.853], [26, 0.444, 0.493, 0.000, 0.857], [27, 0.464, 0.475, 0.000, 0.86],
    [28, 0.466, 0.451, 0.000, 0.862], [29, 0.467, 0.428, 0.000, 0.863], [30, 0.465, 0.405, 0.000, 0.865], [31, 0.460, 0.383, 0.000, 0.867],
    [32, 0.453, 0.362, 0.000, 0.868],
  ],
  marks: [
    [4, 0.815, 0.800, 1.000, 0.76], [5, 0.740, 0.776, 1.000, 0.77], [6, 0.660, 0.758, 1.000, 0.78], [7, 0.510, 0.788, 1.000, 0.785],
    [8, 0.220, 0.818, 1.000, 0.79], [9, 0.000, 0.904, 1.000, 0.795], [10, 0.010, 1.000, 0.963, 0.8], [11, 0.000, 1.000, 0.921, 0.803],
    [12, 0.000, 1.000, 0.871, 0.807], [13, 0.000, 1.000, 0.817, 0.81], [14, 0.000, 1.000, 0.750, 0.813], [15, 0.010, 1.000, 0.674, 0.817],
    [16, 0.000, 1.000, 0.579, 0.82], [17, 0.000, 1.000, 0.479, 0.824], [18, 0.000, 1.000, 0.354, 0.828], [19, 0.000, 1.000, 0.129, 0.832],
    [20, 0.304, 1.000, 0.000, 0.836], [21, 0.513, 1.000, 0.000, 0.84], [22, 0.604, 1.000, 0.000, 0.843], [23, 0.688, 1.000, 0.000, 0.847],
    [24, 0.758, 1.000, 0.000, 0.85], [25, 0.825, 1.000, 0.000, 0.853], [26, 0.875, 1.000, 0.000, 0.857], [27, 0.933, 1.000, 0.000, 0.86],
    [28, 0.975, 1.000, 0.000, 0.862], [29, 1.000, 0.987, 0.000, 0.863], [30, 1.000, 0.950, 0.000, 0.865], [31, 1.000, 0.917, 0.000, 0.867],
    [32, 1.000, 0.892, 0.000, 0.868],
  ],
});

/** `base` (rows of [kn, r, g, b, a]) with every row from LIGHT_PATH.from to LIGHT_PATH.to replaced by `rows`; the rows outside that span are base's own. */
export function lightPathRows(base, rows) {
  return base.filter(function(s) { return s[0] < LIGHT_PATH.from; }).concat(rows, base.filter(function(s) { return s[0] > LIGHT_PATH.to; }));
}
