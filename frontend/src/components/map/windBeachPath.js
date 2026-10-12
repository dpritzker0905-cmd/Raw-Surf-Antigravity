/**
 * windBeachPath.js — beach's wind field: lightness one way through its green band, and its pale gale band under a ceiling, in beach's
 * own colours (owner, 2026-10-12; DECISIONS D-025).
 *
 * The owner: "Dark mode is the model. It needs to be copied, but with the proper colors to match the themes and the maps underneath";
 * on the plan for light's and beach's colours: "you need to double check all this. The light and beach modes need to make sense
 * logically. It could be the way it is, or it could not be. It all has to make sense to match dark mode, but [in] their colors and
 * maps"; of beach: "beach can use improvement, just a little milder"; after watching dark, beach as it was and two solved fields
 * moving side by side on a speed ramp: "go with F"; and, once F had been re-solved to hold the colour-blind bar over the deeper land
 * of PR #320 and filmed beside F: "take the re-solved F"; and, once that field had been re-solved with margin for the texture the GPU
 * draws and filmed beside it: "take the margin and merge it" (the last three relayed by the session leading this work).
 *
 * THE CHECK (scripts/wind-color/beach-path-solve.mjs --audit: the field as drawn over beach's own muted map, knot by knot).
 *   WHAT ALREADY FOLLOWED DARK'S LOGIC, and is kept: beach's hue ORDER (its own sea greens to the aqua at 6 kn, then one way round the
 *   wheel as dark goes: green, yellow-green, gold, apricot, coral, magenta, violet); calm and 3 kn; 47 kn; 63 kn. Byte for byte.
 *   WHAT DID NOT:
 *   - its LIGHTNESS through the green band ran both ways: over the land L* 67 at calm, 46.7 at 10 kn (its darkest band below 47 kn),
 *     back up to 53.0 at 16 kn and 54.2 at 21 kn. A gentle breeze drew deeper than a fresh one;
 *   - its GALE BAND was as light as calm (L* 70.8 at 27 kn, 67.5 at 33 kn; the name guard of dark's rules holds yellows pale). Dark's own
 *     ground, by the engine's law, spans 7.4 L* from 6 to 40 kn; beach's spanned 26.2. A white streak stands on its ground, and there
 *     is little room for white light above a ground that pale;
 *   - its colour-blind floor: neighbouring Beaufort bands read 3.1 (sea) and 3.2 (land) dE2000 against the project's bar of 5 since
 *     dark's rules dimmed the field (D-020). FOUR pairs were under the bar, not one (the checker prints the weakest): 16-21 kn 3.1,
 *     27-33 kn 3.6, 47-55 kn 4.6 (sea) and 63-75 kn 4.6 (sea).
 * WHY A TABLE AND NOT A RULE: dark's rules dim every band by ONE factor (windDarkRules.js rule 2), and one factor cannot change the
 * order of two bands: the 10 kn dip is in beach's own field stops. A factor a band is a table.
 *
 * WHAT THIS DRAWS. Nine of beach's 13 Beaufort stops move, solved with the colour-blind floor as a CONSTRAINT (LESSONS L-V45), the gale
 * band under a ceiling of L* 60 over the land, and the streak's ground FIRST: the everyday ground (6 to 21 kn) lifted as little as
 * the floor allows. Solved twice: option F on the land as the basemap mute alone leaves it (the land before PR #320; D-026's kill
 * draws it), then the seven stops from 6 to 40 kn again with the DEEPER land of PR #320 (the land's lightness times 0.85, the default
 * since D-026) as the land's constraint, moving no knot of F more than 0.4 dE00, so the floor holds on EITHER land; then THE MARGIN (below)
 * for the texture the GPU draws, moving no knot of that field more than 1.2 dE00. The field ON
 * SCREEN over the land as the mute alone leaves it, L* / C* / hue (before); the land numbers of the notes under it are that land's:
 *    6 kn  57.9 / 17.3 / 182  (56.8 / 21.6 / 170)        10 kn  52.2 / 14.5 / 166  (46.7 / 18.2 / 156)
 *   16 kn  45.1 / 14.4 / 161  (53.0 / 33.6 / 146)        21 kn  44.9 / 17.0 / 122  (54.2 / 32.7 / 124)
 *   27 kn  59.8 / 23.6 / 122  (70.8 / 44.0 / 122)        33 kn  60.1 / 34.9 /  92  (67.5 / 44.5 /  92)
 *   40 kn  59.3 / 27.1 /  48  (63.1 / 30.3 /  51)        55 kn  44.4 / 13.4 /  22  (44.7 / 14.3 /  24)
 *   75 kn  43.6 / 11.5 / 297  (45.5 / 10.7 / 305)
 *   - lightness never rises from calm to 21 kn, over land or sea, nor from 33 to 75 kn; between them it climbs once, 15.2 L*, to a gale
 *     band that is level at L* 60 from 27 to 40 kn (59.8, 60.1, 59.3; it peaked at 72.9). From 6 to 40 kn the ground spans 15.2 L* over the land and
 *     12.5 over the sea (26.2 and 21.7 before; dark 7.4 and 7.2);
 *   - neighbouring Beaufort stops from 3 kn are 5.0 dE2000 or more apart for protan, deutan and tritan viewers ON THE TABLE, which is
 *     what the palette checker reads: 5.12 over the sea and 5.15 over the deeper land that draws by default (the checker prints 5.1
 *     and 5.1), and 5.73 over the land before PR #320 (`node check.mjs --strict` and `--strict --before-depth` both exit 0). The
 *     checker's two red lines, red on dev since D-020 (3.1 and 3.2; 3.1 and 2.9 once the land was laid deeper), are gone;
 *   - THE MARGIN: AS THE GPU DRAWS IT the same line holds 5.0 at every maximum the engine can set. The engine does not draw the table:
 *     it draws a 256-texel, 8-bit texture of it (generateRampData), and the shader reads that texture at speed / maximum with LINEAR
 *     filtering, so the GPU reads half a texel from the table's own index (texel centres; scripts/wind-color/lut-lookup-gpu.cjs reads
 *     the law back from a GPU). The maximum is the data's strongest wind, clamped to 10..80 kn. Drawn that way, at 1401 maxima 0.05 kn
 *     apart, the line reads 5.04 at the least over the deeper land, 5.04 over the sea and 5.46 over the land before PR #320
 *     (`node check.mjs --theme beach --strict --as-uploaded 10-80:0.25` exits 0: 5.06 and 5.04 by coloraide). The field before the
 *     margin (PR #319) held the table's bar with none to spare and read 4.64 to 5.0 as drawn (4.85 at a 50 kn maximum; lowest at 3 to
 *     6 kn when a storm sets the scale, where the lookup pulls both colours toward calm); beach before its path read 2.78 and 2.93.
 *     The margin is 0.04: a floor, not a cushion, and the canvas's own 8-bit rounding is not modelled;
 *   - over the LAND every stop keeps its hue within 14.4 degrees (16 kn; 11.5 at 6 kn, 9.2 at 10 kn), and beach's order is kept to 0.6 degrees.
 *     Not eight: the looser hue match is what keeps the ground deep (at 8 degrees the everyday ground must lift 6.7 L*). Over the SEA
 *     the same rows move 10 kn by 11.8 degrees and 16 kn by 18.9;
 *   - the steepest knot is 3.1 dE00 (3.9 before; dark's own hardest is 8.9), and the chroma line is as even as it was (within 0.1).
 * OVER THE DEEPER LAND, which is what draws by default since PR #320 (D-026: the land at the sea's depth), the same rows read in
 * lightness as they do over the sea, within 0.5 L* at every Beaufort stop. L* / C* / hue (before the path, over that land):
 *    6 kn  47.1 / 14.6 / 180  (46.2 / 18.2 / 169)        10 kn  42.4 / 12.2 / 164  (37.8 / 15.4 / 156)
 *   16 kn  36.5 / 12.2 / 160  (43.0 / 28.2 / 146)        21 kn  36.3 / 14.4 / 121  (44.1 / 27.5 / 124)
 *   27 kn  48.7 / 19.9 / 122  (57.9 / 37.0 / 121)        33 kn  49.1 / 29.4 /  92  (55.2 / 37.5 /  92)
 *   40 kn  48.3 / 22.9 /  49  (51.5 / 25.6 /  51)
 * There the gale band is level at L* 49 (it peaked at 59.7), the ground from 6 to 40 kn spans 12.7 L* (21.9 before), and the 10 kn
 * ground is 4.6 L* lighter than it was. The costs below are stated on the land before #320; over the deeper land each is the same
 * in kind and a little smaller in L* and C* (this table).
 * Rows between two moved stops run on straight lines in lightness, chroma and hue from 6 to 47 kn; elsewhere a moved row is the colour
 * beach drew at that knot, moved by what its two stops moved.
 * WHAT IT RESTS ON is the FIELD, which no captured frame touches: the three faults above, read off the tables through the composite
 * model and the palette checker. (Streak-lift sizes "against dark's" quoted for this change on 2026-10-12 were read from bench frames
 * that under-read bright cores, in every theme, and are withdrawn: log 2026-10-12-wind-beach-path, the correction entries.) On true
 * frames, with every open wind change merged and beach's sea white at 0.55, the lead session reads this field's streaks adding 1.5 to
 * 1.8 times the light dark's add over the sea from 6 to 18 kn, and 0.9 to 1.2 times over a land laid at the sea's depth (PR #320):
 * beach's streaks are not weaker than dark's anywhere. A before-and-after of this field ALONE on true frames does not exist.
 * WHAT IT COSTS, said plainly:
 *   - THE GREENS GO GREY-GREEN: 16 and 21 kn keep C* 14.4 and 17.0 of 33.6 and 32.7, and sit 7.9 and 9.3 L* deeper. Deep AND colourful
 *     does not exist under a multiply tint at 0.60 strength (over beach's land C* 33 needs L* 54 or lighter). Over the sea the field
 *     is about half as colourful as dark's own from 12 to 21 kn, where it was more colourful than dark's;
 *   - the gale band's lime, gold and apricot are 11.0, 7.4 and 3.8 L* deeper, and 27 kn keeps C* 23.6 of 44.0: a sage, not a lime;
 *   - the 10 kn ground is 5.5 L* LIGHTER over land (4.6 over the sea, and over the land as drawn): the streak has that much less to stand on at
 *     the commonest wind. The margin is 0.7 L* of that;
 *   - from 13 kn up the ground is the deepest beach draws, and over the sea the streaks add more light than dark's do there. That is the
 *     white strength's to trim (windDarkRules.js DARK_WHITE; not changed here);
 *   - over the land as the mute alone left it the gale band was still pale on screen (rendered L* 68 to 72 against dark's 34 to 39):
 *     the rest of that gap was the map's, and PR #320 lays the land at the sea's depth (the table above);
 *   - the everyday neighbours are told apart about two thirds as well by a NORMAL eye: 6-10 kn 6.6 dE00 over land and 5.6 over the sea (10.8
 *     and 8.5 before), 10-16 kn 7.1 and 5.3 (10.0 and 8.8). A grey-green band is closer to its neighbours than an emerald was;
 *   - a bar of D-021 is crossed at 7 and 8 kn: there the head of a streak stands 18.3 L* off its ground at the least, where D-021 held
 *     19.5 from a light breeze up (windWhiteStreak.test.js holds that bar on the tables under this kill; windBeachPath.test.js says so);
 *   - the legend is not moved, and over the SEA the field at 16 kn sits 32.0 degrees off the legend's hue (13.1 before; 24.4 over
 *     land): PAST the palette checker's 30 for 1 kn (15.5 to 16 kn), which the checker prints as a watch line (2 kn would be red).
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
  // Rows 4 to 46 and 49 to 62 are THE MARGIN's (the bytes filmed at 957d4ed5); 48 kn and 64 to 75 kn are as PR #319 laid them.
  field: Object.freeze([
    [4, 0.112, 0.469, 0.361], [5, 0.121, 0.492, 0.417], [6, 0.114, 0.496, 0.449], [7, 0.137, 0.479, 0.420], [8, 0.134, 0.446, 0.376], [9, 0.130, 0.413, 0.333],
    [10, 0.125, 0.381, 0.293], [11, 0.104, 0.356, 0.266], [12, 0.084, 0.332, 0.239], [13, 0.063, 0.307, 0.213], [14, 0.043, 0.283, 0.186], [15, 0.023, 0.259, 0.160],
    [16, 0.003, 0.235, 0.134], [17, 0.022, 0.232, 0.106], [18, 0.044, 0.228, 0.078], [19, 0.070, 0.223, 0.051], [20, 0.098, 0.217, 0.024], [21, 0.128, 0.210, 0.000],
    [22, 0.172, 0.261, 0.036], [23, 0.218, 0.313, 0.071], [24, 0.263, 0.365, 0.107], [25, 0.308, 0.418, 0.143], [26, 0.355, 0.470, 0.179], [27, 0.400, 0.525, 0.216],
    [28, 0.429, 0.521, 0.178], [29, 0.460, 0.515, 0.140], [30, 0.496, 0.509, 0.104], [31, 0.535, 0.501, 0.069], [32, 0.577, 0.491, 0.036], [33, 0.620, 0.480, 0.006],
    [34, 0.660, 0.461, 0.024], [35, 0.695, 0.442, 0.047], [36, 0.724, 0.425, 0.074], [37, 0.749, 0.409, 0.105], [38, 0.768, 0.395, 0.139], [39, 0.782, 0.383, 0.175],
    [40, 0.789, 0.372, 0.213], [41, 0.752, 0.343, 0.200], [42, 0.713, 0.314, 0.187], [43, 0.673, 0.286, 0.174], [44, 0.634, 0.258, 0.160], [45, 0.595, 0.231, 0.146],
    [46, 0.554, 0.203, 0.132], [48, 0.489, 0.165, 0.114], [49, 0.464, 0.154, 0.113], [50, 0.443, 0.146, 0.113], [51, 0.424, 0.138, 0.116], [52, 0.404, 0.131, 0.117],
    [53, 0.385, 0.124, 0.118], [54, 0.365, 0.117, 0.120], [55, 0.346, 0.110, 0.121], [56, 0.335, 0.112, 0.131], [57, 0.324, 0.114, 0.142], [58, 0.314, 0.116, 0.151],
    [59, 0.303, 0.118, 0.162], [60, 0.294, 0.120, 0.172], [61, 0.283, 0.122, 0.184], [62, 0.273, 0.124, 0.195], [64, 0.255, 0.126, 0.215], [65, 0.248, 0.127, 0.224],
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
