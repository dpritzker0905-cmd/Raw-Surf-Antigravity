/**
 * windBeachPath.js — beach's wind field: lightness one way through its green band, and its pale gale band under a ceiling, in beach's
 * own colours (owner, 2026-10-12; DECISIONS D-025).
 *
 * The owner: "Dark mode is the model. It needs to be copied, but with the proper colors to match the themes and the maps underneath";
 * on the plan for light's and beach's colours: "you need to double check all this. The light and beach modes need to make sense
 * logically. It could be the way it is, or it could not be. It all has to make sense to match dark mode, but [in] their colors and
 * maps"; of beach: "beach can use improvement, just a little milder"; and, after watching dark, beach as it was and two solved fields
 * moving side by side on a speed ramp: "go with F".
 *
 * THE CHECK (scripts/wind-color/beach-path-solve.mjs --audit: the field as drawn over beach's own muted map, knot by knot).
 *   WHAT ALREADY FOLLOWED DARK'S LOGIC, and is kept: beach's hue ORDER (its own sea greens to the aqua at 6 kn, then one way round the
 *   wheel as dark goes: green, yellow-green, gold, apricot, coral, magenta, violet); calm and 3 kn; 47 kn; 63 kn. Byte for byte.
 *   WHAT DID NOT:
 *   - its LIGHTNESS through the green band ran both ways: over the land L* 67 at calm, 46.7 at 10 kn (its darkest band below 47 kn),
 *     back up to 53.0 at 16 kn and 54.2 at 21 kn. A gentle breeze drew deeper than a fresh one;
 *   - its GALE BAND was as light as calm (L* 70.8 at 27 kn, 67.5 at 33 kn; the name guard of dark's rules holds yellows pale). Dark's own
 *     ground, by the engine's law, spans 7.4 L* from 6 to 40 kn; beach's spanned 26.2. A white streak stands on its ground, so on a
 *     speed ramp beach's streaks lifted the picture 0.60 to 0.68 times as far as dark's over the sea from 26 to 39 kn and 0.38 to 0.52
 *     over the land, where even full white only just reaches dark's: the one place no white strength repairs;
 *   - its colour-blind floor: neighbouring Beaufort bands read 3.1 (sea) and 3.2 (land) dE2000 against the project's bar of 5 since
 *     dark's rules dimmed the field (D-020). FOUR pairs were under the bar, not one (the checker prints the weakest): 16-21 kn 3.1,
 *     27-33 kn 3.6, 47-55 kn 4.6 (sea) and 63-75 kn 4.6 (sea).
 * WHY A TABLE AND NOT A RULE: dark's rules dim every band by ONE factor (windDarkRules.js rule 2), and one factor cannot change the
 * order of two bands: the 10 kn dip is in beach's own field stops. A factor a band is a table.
 *
 * WHAT THIS DRAWS. Nine of beach's 13 Beaufort stops move, solved with the colour-blind floor as a CONSTRAINT (LESSONS L-V45), the gale
 * band under a ceiling of L* 60 over the land, and the streak's ground FIRST: the everyday ground (6 to 21 kn) lifted as little as
 * the floor allows. The field ON SCREEN over beach's muted land, L* / C* / hue (before):
 *    6 kn  57.3 / 17.6 / 175  (56.8 / 21.6 / 170)        10 kn  51.0 / 15.8 / 168  (46.7 / 18.2 / 156)
 *   16 kn  44.5 / 14.1 / 158  (53.0 / 33.6 / 146)        21 kn  44.5 / 16.4 / 123  (54.2 / 32.7 / 124)
 *   27 kn  60.0 / 25.2 / 123  (70.8 / 44.0 / 122)        33 kn  60.0 / 35.1 /  92  (67.5 / 44.5 /  92)
 *   40 kn  59.9 / 28.5 /  50  (63.1 / 30.3 /  51)        55 kn  44.4 / 13.6 /  23  (44.7 / 14.3 /  24)
 *   75 kn  43.6 / 11.5 / 297  (45.5 / 10.7 / 305)
 *   - lightness never rises from calm to 21 kn, over land or sea, nor from 33 to 75 kn; between them it climbs once, 15.5 L*, to a gale
 *     band that is level at L* 60 from 27 to 40 kn (it peaked at 72.9). From 6 to 40 kn the ground spans 15.5 L* over the land and
 *     13.0 over the sea (26.2 and 21.7 before; dark 7.4 and 7.2);
 *   - neighbouring Beaufort stops from 3 kn are 5.1 dE2000 or more apart for protan, deutan and tritan viewers over the sea AND the
 *     land (5.10 and 5.11 on the table; 5.01 at the least once the table is quantised into the 256-entry texture the engine uploads):
 *     the palette checker's two red lines, red on dev since D-020, are gone (`node check.mjs --strict` exits 0);
 *   - over the LAND every stop keeps its hue within 12 degrees, and beach's order is kept to 0.6 degrees. Twelve, not eight: the looser
 *     hue match is what keeps the ground deep (at 8 degrees the everyday ground must lift 6.7 L*; at 12, 4.3). Over the SEA the same
 *     rows move 10 kn by 13.5 degrees and 16 kn by 16.7;
 *   - the steepest knot is 3.1 dE00 (3.9 before; dark's own hardest is 8.9), and the chroma line is as even as it was (within 0.1).
 * Rows between two moved stops run on straight lines in lightness, chroma and hue from 6 to 47 kn; elsewhere a moved row is the colour
 * beach drew at that knot, moved by what its two stops moved.
 * WHAT IT BUYS, MEASURED (the lead session's capture: the real engine on the real basemaps, wind due north on a speed ramp, every wind
 * lane merged, beach's sea white at 0.55 AS ON PR #315; the streaks' lift against dark's at the same crop, before -> now). It was NOT
 * measured on the 0.77 this file's neighbour windDarkRules.js DARK_WHITE holds until #315 merges: on 0.77 the sea already read 1.3 to
 * 1.4 times dark's at 8 to 17 kn, and this field's deeper 16 to 21 kn sea would read further over. #315 belongs before or with this:
 *   the gale band, 26 / 32 / 39 kn   sea 0.68 / 0.60 / 0.62 -> 0.86 / 0.82 / 0.75      land 0.38 / 0.52 / 0.49 -> 0.63 / 0.60 / 0.62
 *   everyday, 9 / 12 / 15 / 18 kn    sea 0.99 / 1.04 / 0.98 / 0.97 -> 0.95 / 1.01 / 1.09 / 1.12
 *                                    land 0.86 / 0.91 / 0.88 / 0.82 -> 0.74 / 0.86 / 1.08 / 1.12
 * WHAT IT COSTS, said plainly:
 *   - THE GREENS GO GREY-GREEN: 16 and 21 kn keep C* 14.1 and 16.4 of 33.6 and 32.7, and sit 8.5 and 9.8 L* deeper. Deep AND colourful
 *     does not exist under a multiply tint at 0.60 strength (over beach's land C* 33 needs L* 54 or lighter);
 *   - the gale band's lime, gold and apricot are 10.8, 7.5 and 3.2 L* deeper, and 27 kn keeps C* 25.2 of 44.0: a sage, not a lime;
 *   - the land at 9 to 12 kn loses lift (0.74 and 0.86 of dark's from 0.86 and 0.91): the 10 kn ground is 4.3 L* lighter;
 *   - at 15 to 18 kn the streaks lift 8 to 12% FURTHER than dark's on both grounds (the ground there is the deepest beach draws). The
 *     sea's share is the white strength's to trim (windDarkRules.js DARK_WHITE; not changed here);
 *   - the land's gale band is still pale on screen (rendered L* 68 to 72 against dark's 34 to 39): the rest of that gap is the map's;
 *   - the everyday neighbours are told apart about half as well by a NORMAL eye: 6-10 kn 6.3 dE00 over land and 5.2 over the sea (10.8
 *     and 8.5 before), 10-16 kn 6.8 and 5.2 (10.0 and 8.8). A grey-green band is closer to its neighbours than an emerald was;
 *   - a bar of D-021 is crossed at 7 and 8 kn: there the head of a streak stands 18.6 L* off its ground at the least, where D-021 held
 *     19.5 from a light breeze up (windWhiteStreak.test.js holds that bar on the tables under this kill; windBeachPath.test.js says so);
 *   - the legend is not moved, and over the sea the field at 16 kn sits 29.8 degrees off the legend's hue (13.1 before): 0.2 inside the
 *     palette checker's 30.
 * The streaks' own rows are NOT touched (one visual variable): a white streak takes its colour from the field under it.
 *
 * Kill: window.__RAW_DISABLE_WIND_BEACH_PATH__ = true (beach's field as it drew before, byte for byte; the engine rebuilds its tables at
 * once). ON only where the white streak draws (WindColorRamp.js windBeachPathOn), so every lever and older kill that stands the white
 * streak or dark's rules down still draws exactly what it drew; D-022's kill (__RAW_DISABLE_WIND_DARK_WHITE__) stands it down too, since
 * that kill is documented to draw PR #313's picture. (So in beach that kill now moves the field and the look key as well as the white:
 * it cannot A/B the white strength alone on this field.) Read-back: window.__WIND_ENGINE__._lookKey is `white+path|dark-rules`.
 * The solve, the options not taken (A, B, C, E) and every measurement: docs/weather-program/log/2026-10-12-wind-beach-path.md.
 */
export const BEACH_PATH = Object.freeze({
  // [kn, r, g, b]: the field's tint at every knot that moves (70 rows: 4 to 75 kn but 47 and 63). A row keeps the alpha it had.
  field: Object.freeze([
    [4, 0.114, 0.463, 0.344], [5, 0.125, 0.483, 0.387], [6, 0.117, 0.483, 0.406], [7, 0.126, 0.464, 0.385], [8, 0.108, 0.430, 0.347], [9, 0.090, 0.395, 0.310],
    [10, 0.072, 0.361, 0.273], [11, 0.061, 0.337, 0.246], [12, 0.049, 0.314, 0.219], [13, 0.038, 0.291, 0.193], [14, 0.026, 0.267, 0.167], [15, 0.015, 0.244, 0.141],
    [16, 0.003, 0.221, 0.116], [17, 0.021, 0.219, 0.092], [18, 0.042, 0.216, 0.067], [19, 0.065, 0.212, 0.044], [20, 0.091, 0.207, 0.021], [21, 0.117, 0.201, 0.000],
    [22, 0.163, 0.255, 0.033], [23, 0.209, 0.309, 0.066], [24, 0.255, 0.364, 0.100], [25, 0.301, 0.420, 0.133], [26, 0.348, 0.476, 0.167], [27, 0.395, 0.533, 0.201],
    [28, 0.425, 0.527, 0.163], [29, 0.459, 0.520, 0.127], [30, 0.495, 0.511, 0.091], [31, 0.535, 0.501, 0.058], [32, 0.576, 0.489, 0.027], [33, 0.620, 0.476, 0.000],
    [34, 0.661, 0.460, 0.018], [35, 0.698, 0.444, 0.040], [36, 0.731, 0.429, 0.067], [37, 0.759, 0.415, 0.097], [38, 0.782, 0.402, 0.131], [39, 0.800, 0.391, 0.167],
    [40, 0.813, 0.382, 0.205], [41, 0.772, 0.351, 0.194], [42, 0.730, 0.321, 0.182], [43, 0.688, 0.291, 0.170], [44, 0.645, 0.262, 0.158], [45, 0.602, 0.233, 0.145],
    [46, 0.558, 0.205, 0.131], [48, 0.489, 0.165, 0.114], [49, 0.465, 0.154, 0.112], [50, 0.444, 0.146, 0.112], [51, 0.425, 0.138, 0.114], [52, 0.406, 0.131, 0.115],
    [53, 0.387, 0.124, 0.116], [54, 0.368, 0.117, 0.118], [55, 0.349, 0.110, 0.119], [56, 0.338, 0.112, 0.129], [57, 0.327, 0.114, 0.140], [58, 0.316, 0.116, 0.150],
    [59, 0.305, 0.118, 0.161], [60, 0.295, 0.120, 0.172], [61, 0.284, 0.122, 0.184], [62, 0.274, 0.124, 0.195], [64, 0.255, 0.126, 0.215], [65, 0.248, 0.127, 0.224],
    [66, 0.240, 0.127, 0.232], [67, 0.231, 0.128, 0.241], [68, 0.223, 0.129, 0.249], [69, 0.214, 0.130, 0.258], [70, 0.204, 0.131, 0.266], [71, 0.195, 0.132, 0.275],
    [72, 0.185, 0.133, 0.283], [73, 0.174, 0.135, 0.292], [74, 0.164, 0.136, 0.300], [75, 0.153, 0.138, 0.308],
  ].map(Object.freeze)),
});

/** `base` (a field table with a row a knot, [kn, r, g, b, a]) with the path's rows laid over the knots they name; every other row, and every alpha, is base's. */
export function beachPathRows(base, rows) {
  var byKnot = {};
  rows.forEach(function(r) { byKnot[r[0]] = r; });
  return base.map(function(s) { var p = byKnot[s[0]]; return p ? [s[0], p[1], p[2], p[3], s[4]] : s.slice(); });
}
