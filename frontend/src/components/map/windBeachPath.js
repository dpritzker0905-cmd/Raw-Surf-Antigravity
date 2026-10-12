/**
 * windBeachPath.js — beach's wind field: lightness one way through its green band, and its pale gale band under a ceiling, in beach's
 * own colours (owner, 2026-10-12; DECISIONS D-025).
 *
 * The owner: "Dark mode is the model. It needs to be copied, but with the proper colors to match the themes and the maps underneath";
 * on the plan for light's and beach's colours: "you need to double check all this. The light and beach modes need to make sense
 * logically. It could be the way it is, or it could not be. It all has to make sense to match dark mode, but [in] their colors and
 * maps"; of beach: "beach can use improvement, just a little milder"; after watching dark, beach as it was and two solved fields
 * moving side by side on a speed ramp: "go with F"; and, once F had been re-solved to hold the colour-blind bar over the deeper land
 * of PR #320 and filmed beside F: "take the re-solved F" (the last two relayed by the session leading this work).
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
 * since D-026) as the land's constraint, moving no knot of F more than 0.4 dE00, so the floor holds on EITHER land. The field ON
 * SCREEN over the land as the mute alone leaves it, L* / C* / hue (before); the land numbers of the notes under it are that land's:
 *    6 kn  57.6 / 17.6 / 177  (56.8 / 21.6 / 170)        10 kn  51.5 / 15.6 / 169  (46.7 / 18.2 / 156)
 *   16 kn  44.8 / 14.3 / 160  (53.0 / 33.6 / 146)        21 kn  44.7 / 16.7 / 123  (54.2 / 32.7 / 124)
 *   27 kn  60.1 / 24.7 / 123  (70.8 / 44.0 / 122)        33 kn  60.1 / 35.2 /  92  (67.5 / 44.5 /  92)
 *   40 kn  59.9 / 27.8 /  49  (63.1 / 30.3 /  51)        55 kn  44.4 / 13.6 /  23  (44.7 / 14.3 /  24)
 *   75 kn  43.6 / 11.5 / 297  (45.5 / 10.7 / 305)
 *   - lightness never rises from calm to 21 kn, over land or sea, nor from 33 to 75 kn; between them it climbs once, 15.5 L*, to a gale
 *     band that is level at L* 60 from 27 to 40 kn (it peaked at 72.9). From 6 to 40 kn the ground spans 15.4 L* over the land and
 *     12.9 over the sea (26.2 and 21.7 before; dark 7.4 and 7.2);
 *   - neighbouring Beaufort stops from 3 kn are 5.0 dE2000 or more apart for protan, deutan and tritan viewers: by the palette checker
 *     5.0 over the sea and 5.0 over the deeper land that draws by default (5.05 and 5.02), and 5.3 over the land before PR #320
 *     (`node check.mjs --strict` and `--strict --before-depth` both exit 0). The checker's two red lines, red on dev since D-020 (3.1
 *     and 3.2; 3.1 and 2.9 once the land was laid deeper), are gone. THERE IS NO MARGIN, AND AS UPLOADED THE LINE IS UNDER THE BAR:
 *     the table reads 5.05 over the sea and 5.02 over the deeper land, and once it is quantised into the 256-entry 8-bit texture the
 *     engine uploads, the sea reads 5.01 at a 75 kn maximum and 4.98 at a 50 kn maximum, and THE DEEPER LAND 4.87 AND 4.89 (4.79 at
 *     the least, a 65 kn maximum; 16-21 kn for protan viewers the weakest pair, with 27-33, 6-10 and 10-16 kn beside it). Beach
 *     before its path reads 2.84 there. The solve put five of the land's pairs on the bar at once, and rounding tips some under;
 *   - over the LAND every stop keeps its hue within 13.5 degrees (16 kn; 12.6 at 10 kn), and beach's order is kept to 0.6 degrees.
 *     Not eight: the looser hue match is what keeps the ground deep (at 8 degrees the everyday ground must lift 6.7 L*). Over the SEA
 *     the same rows move 10 kn by 14.2 degrees and 16 kn by 18.2;
 *   - the steepest knot is 3.1 dE00 (3.9 before; dark's own hardest is 8.9), and the chroma line is as even as it was (within 0.1).
 * OVER THE DEEPER LAND, which is what draws by default since PR #320 (D-026: the land at the sea's depth), the same rows read in
 * lightness as they do over the sea, within 0.5 L* at every Beaufort stop. L* / C* / hue (before the path, over that land):
 *    6 kn  46.9 / 14.8 / 176  (46.2 / 18.2 / 169)        10 kn  41.8 / 13.2 / 168  (37.8 / 15.4 / 156)
 *   16 kn  36.2 / 12.0 / 159  (43.0 / 28.2 / 146)        21 kn  36.1 / 14.1 / 122  (44.1 / 27.5 / 124)
 *   27 kn  49.0 / 20.9 / 123  (57.9 / 37.0 / 121)        33 kn  49.0 / 29.7 /  92  (55.2 / 37.5 /  92)
 *   40 kn  48.9 / 23.5 /  50  (51.5 / 25.6 /  51)
 * There the gale band is level at L* 49 (it peaked at 59.7), the ground from 6 to 40 kn spans 12.9 L* (21.9 before), and the 10 kn
 * ground is 4.0 L* lighter than it was. The costs below are stated on the land before #320; over the deeper land each is the same
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
 *   - THE GREENS GO GREY-GREEN: 16 and 21 kn keep C* 14.3 and 16.7 of 33.6 and 32.7, and sit 8.2 and 9.6 L* deeper. Deep AND colourful
 *     does not exist under a multiply tint at 0.60 strength (over beach's land C* 33 needs L* 54 or lighter). Over the sea the field
 *     is about half as colourful as dark's own from 12 to 21 kn, where it was more colourful than dark's;
 *   - the gale band's lime, gold and apricot are 10.7, 7.4 and 3.2 L* deeper, and 27 kn keeps C* 24.7 of 44.0: a sage, not a lime;
 *   - the 10 kn ground is 4.7 L* LIGHTER over land (4.0 over the sea): the streak has that much less to stand on at the commonest wind;
 *   - from 13 kn up the ground is the deepest beach draws, and over the sea the streaks add more light than dark's do there. That is the
 *     white strength's to trim (windDarkRules.js DARK_WHITE; not changed here);
 *   - over the land as the mute alone left it the gale band was still pale on screen (rendered L* 68 to 72 against dark's 34 to 39):
 *     the rest of that gap was the map's, and PR #320 lays the land at the sea's depth (the table above);
 *   - the everyday neighbours are told apart about half as well by a NORMAL eye: 6-10 kn 6.2 dE00 over land and 5.2 over the sea (10.8
 *     and 8.5 before), 10-16 kn 7.0 and 5.3 (10.0 and 8.8). A grey-green band is closer to its neighbours than an emerald was;
 *   - a bar of D-021 is crossed at 7 and 8 kn: there the head of a streak stands 18.5 L* off its ground at the least, where D-021 held
 *     19.5 from a light breeze up (windWhiteStreak.test.js holds that bar on the tables under this kill; windBeachPath.test.js says so);
 *   - the legend is not moved, and over the SEA the field at 16 kn sits 31.2 degrees off the legend's hue (13.1 before; 23.5 over
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
  field: Object.freeze([
    [4, 0.115, 0.466, 0.350], [5, 0.126, 0.488, 0.397], [6, 0.119, 0.490, 0.421], [7, 0.130, 0.471, 0.399], [8, 0.114, 0.437, 0.360], [9, 0.098, 0.403, 0.322],
    [10, 0.082, 0.370, 0.285], [11, 0.068, 0.346, 0.258], [12, 0.055, 0.322, 0.230], [13, 0.041, 0.298, 0.203], [14, 0.028, 0.274, 0.177], [15, 0.014, 0.250, 0.150],
    [16, 0.001, 0.227, 0.125], [17, 0.019, 0.224, 0.098], [18, 0.041, 0.221, 0.072], [19, 0.065, 0.217, 0.047], [20, 0.092, 0.211, 0.023], [21, 0.120, 0.205, 0.000],
    [22, 0.165, 0.258, 0.035], [23, 0.211, 0.312, 0.069], [24, 0.257, 0.367, 0.104], [25, 0.303, 0.422, 0.139], [26, 0.350, 0.477, 0.174], [27, 0.396, 0.534, 0.210],
    [28, 0.426, 0.528, 0.171], [29, 0.459, 0.521, 0.133], [30, 0.496, 0.513, 0.096], [31, 0.536, 0.503, 0.061], [32, 0.578, 0.491, 0.029], [33, 0.622, 0.478, 0.000],
    [34, 0.663, 0.461, 0.019], [35, 0.700, 0.445, 0.043], [36, 0.731, 0.430, 0.071], [37, 0.758, 0.416, 0.103], [38, 0.779, 0.404, 0.138], [39, 0.796, 0.393, 0.175],
    [40, 0.807, 0.384, 0.214], [41, 0.767, 0.353, 0.201], [42, 0.726, 0.322, 0.188], [43, 0.684, 0.292, 0.175], [44, 0.642, 0.263, 0.161], [45, 0.600, 0.234, 0.147],
    [46, 0.557, 0.205, 0.132], [48, 0.489, 0.165, 0.114], [49, 0.465, 0.154, 0.112], [50, 0.444, 0.146, 0.112], [51, 0.425, 0.138, 0.114], [52, 0.406, 0.131, 0.115],
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
