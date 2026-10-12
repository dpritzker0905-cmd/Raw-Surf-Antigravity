# 2026-10-12 · The land at the sea's depth under the wind (D-026), the owner's verdict on the deployed build, and the three themes read by wind speed

Local session (Windows, AMD Radeon 890M, D3D11): the session that built #314 and #315 and was asked by the owner to lead the
light/beach-against-dark work across the lanes. Branch `claude/wind-land-depth`, cut from `origin/dev` at `74417b5a` (#316's
merge). Times are UTC. Its earlier log is `2026-10-11-wind-dark-white.md` (as it stands on PR #315, which is not merged).

**The owner's words this rests on, first-hand, to this session:**

- 2026-10-12 11:50Z: "merge #316 and go with F and the deeper land and open the pr". (#316 is the border ink; F is the beach lane's
  palette option; "the deeper land" is the prototype this session had shown moving beside dark at about 04:06Z.)
- 12:28Z: "I just did a visual check for wind on beach and light modes, and I still do not visually see the improvements yet....
  notate that".
- 12:36Z: "you need to also compare the amount and density of the animations from beach and light mode to dark mode. And colors,
  how slower color wind is more transparent than faster color wind. Weve worked on this for 2 days already. This should work
  after all the agents worked on this. Study your research and best practices more".

**No request of this session reached the Raw Surf backend.** The benches draw Mapbox tiles and synthetic or recorded wind; the
deployed build was read from its static files only.

## 11:52Z · #316 merged

`gh pr merge 316 --squash` on the owner's word, after reading it OPEN, mergeable, 14 checks passed, 0 failed: MERGED
2026-10-12T11:52:11Z as dev `74417b5a`. The beach lane was sent the owner's pick of F in the owner's words.

## 12:28Z · THE OWNER'S VERDICT ON THE DEPLOYED BUILD: no visible improvement yet

Recorded as said (above). What the owner was looking at, read from the dev site's static files at 12:28:36Z
(`service-worker.js` `BUILD_VERSION = 74417b5a`; the bundles searched for each change's own switch name): the build holds #314
(the white by the ground) and #316 (the border ink, and its fix for a theme change leaving the new theme unmuted). It does NOT
hold #315 (beach's sea strength 0.55), #318 (light's hue order), the beach lane's F, or this change. **No change to the look of
the wind has reached the site since #314 (01:48Z).** That is a fact about the build, not an answer to the verdict: every bench
number of the last day said light's sea already equals dark's, and the owner, looking at the app, does not see dark's look. The
profile below is the attempt to find what the eye sees that the one tuned number did not.

## The three themes by wind speed: amount, density, and colour (what the owner asked for at 12:36Z)

**Instrument:** speed ramps (`ramp-fixture.js`, new here: the wind blows due north, its speed rises with longitude, so a column
of the picture is one speed over land and sea), three of them (0.5 to 12, 2 to 30 and 6.85 to 60.6 kn across the zoom 6 view);
`motion-run.js --fixture --dpr 1.5` (120 frames a run; the map drawn at 2, as every number so far); `mirror-run.js --size 110` at
the same crop in each theme. **dev's own look** (this branch with its kill set, which the tests show is dev byte for byte). Cover
= the share of the crop a streak crosses in 2 s; flicker = mean frame-to-frame change (L*); lift = how far the streaks raise the
picture above its ground (L*); C* = how much colour the ground under the streaks carries.

| kn | SEA cover d / l / b | SEA flicker | SEA lift | SEA ground C* | SEA ground L* | LAND cover | LAND flicker | LAND lift | LAND ground L* |
|---|---|---|---|---|---|---|---|---|---|
| 1.8 | 0.51 / 0.54 / 0.55 | 0.46 / 0.42 / 0.48 | 3.8 / 4.3 / 4.5 | 21 / 16 / 11 | 32 / 57 / 54 | 0.61 / 0.49 / 0.43 | 0.56 / 0.46 / 0.41 | 6.7 / 1.9 / 2.4 | 20 / 77 / 70 |
| 3.2 | 0.51 / 0.54 / 0.55 | 0.56 / 0.51 / 0.56 | 3.9 / 4.3 / 4.6 | 30 / 23 / 15 | 29 / 54 / 52 | 0.65 / 0.59 / 0.51 | 0.83 / 0.68 / 0.59 | 8.4 / 1.2 / 2.3 | 18 / 72 / 67 |
| 4.5 | 0.73 / 0.65 / 0.65 | 1.46 / 1.02 / 1.04 | 6.3 / 6.4 / 6.6 | 29 / 31 / 18 | 30 / 52 / 51 | 0.76 / 0.69 / 0.67 | 1.56 / 1.24 / 1.10 | 11.2 / 2.7 / 4.3 | 21 / 69 / 65 |
| 5.9 | 0.69 / 0.65 / 0.69 | 1.32 / 1.03 / 1.20 | 6.1 / 6.2 / 7.3 | 21 / 37 / 21 | 36 / 49 / 48 | 0.76 / 0.71 / 0.70 | 1.61 / 1.39 / 1.31 | 9.1 / 4.3 / 6.0 | 26 / 65 / 61 |
| 8.6 | 0.70 / 0.68 / 0.74 | 1.29 / 1.16 / 1.42 | 6.2 / 6.7 / 8.7 | 20 / 39 / 20 | 39 / 45 / 41 | 0.77 / 0.74 / 0.77 | 1.59 / 1.52 / 1.54 | 10.0 / 4.8 / 8.1 | 30 / 61 / 53 |
| 11.8 | 0.78 / 0.78 / 0.82 | 1.46 / 1.41 / 1.73 | 8.4 / 9.0 / 11.7 | 23 / 33 / 23 | 41 / 45 / 42 | 0.78 / 0.77 / 0.81 | 1.70 / 1.73 / 1.85 | 12.0 / 7.3 / 10.9 | 33 / 60 / 54 |
| 15.3 | 0.80 / 0.80 / 0.83 | 1.38 / 1.49 / 1.67 | 8.5 / 9.4 / 11.1 | 23 / 26 / 32 | 43 / 45 / 45 | 0.83 / 0.83 / 0.82 | 1.85 / 2.05 / 2.04 | 11.9 / 9.5 / 10.4 | 35 / 60 / 57 |
| 18.5 | 0.81 / 0.82 / 0.86 | 1.44 / 1.55 / 1.83 | 9.2 / 9.6 / 11.9 | 24 / 37 / 39 | 43 / 47 / 47 | 0.84 / 0.86 / 0.86 | 1.84 / 2.19 / 2.21 | 12.3 / 8.5 / 10.1 | 36 / 61 / 58 |
| 25.6 | 0.87 / 0.87 / 0.86 | 1.70 / 1.78 / 1.65 | 10.7 / 10.0 / 8.8 | 26 / 35 / 44 | 45 / 52 / 61 | 0.85 / 0.85 / 0.83 | 2.05 / 2.46 / 2.29 | 13.0 / 7.6 / 4.5 | 38 / 66 / 73 |
| 32.3 | 0.89 / 0.89 / 0.84 | 1.94 / 1.98 / 1.44 | 10.9 / 11.3 / 7.9 | 22 / 28 / 42 | 43 / 49 / 65 | 0.91 / 0.91 / 0.84 | 2.47 / 2.86 / 2.58 | 13.1 / 11.6 / 6.7 | 37 / 66 / 74 |
| 38.5 | 0.92 / 0.92 / 0.91 | 2.33 / 2.23 / 2.25 | 11.4 / 11.5 / 9.5 | 18 / 27 / 27 | 40 / 44 / 60 | 0.92 / 0.92 / 0.87 | 2.67 / 3.18 / 2.57 | 13.7 / 12.6 / 6.7 | 34 / 59 / 73 |
| 44.7 | 0.92 / 0.91 / 0.93 | 2.68 / 2.51 / 3.13 | 11.9 / 11.7 / 12.8 | 18 / 23 / 25 | 36 / 41 / 48 | 0.92 / 0.92 / 0.92 | 2.90 / 3.41 / 3.21 | 14.4 / 13.2 / 11.5 | 30 / 54 / 60 |

(d / l / b = dark / light / beach. Beach's sea is at dev's 0.77. The full rows, 14 speeds, are in the session's `speed-profile.json`.)

**What it says, in the owner's terms:**

1. **The amount of animation is the same and its visible strength is not.** The engine draws the same marks in every theme.
   Over the SEA light's cover is within 0.08 of dark's and its lift within 0.93 to 1.13 at every speed from 1.8 to 45 kn: light's
   sea is dark's sea. **Over LAND in light air it is not close:** under 10 kn light's streaks lift the picture 0.14 to 0.56 of
   what dark's do (1.2 to 5.2 L* against 6.7 to 11.2) and beach's 0.27 to 1.00; fewer of them are seen at all (cover 0.49 and
   0.43 against 0.61 at 1.8 kn). Most land, most days, is under 10 kn: in dark there is faint motion everywhere, in light almost
   none over land. D-022 read the land at one speed (about 8 kn) and concluded "no white can lift a pale land"; the profile
   shows the gap is largest below that.
2. **Above 15 kn over land light is HARSHER than dark,** not weaker: its flicker is 1.1 to 1.2 times dark's (full white on a
   pale land), with less lift.
3. **"Slower wind more transparent than faster":** dark's picture builds from 3 kn to about 26 kn (its ground over the sea
   climbs from L* 29 to 45, and the colour it carries stays modest, C* 18 to 26 from 6 kn). **Light spends its whole range by
   10 kn** (its sea goes from L* 57 to 44.5 by 10 kn and then does not move in that direction again until 39 kn), **and lays its
   strongest colour in its lightest winds:** C* 37 to 40 from 6 to 10 kn, about twice dark's 19 to 23 there. Beach is dark's
   equal in colour from 4.5 to 12 kn (18 to 23) and then nearly twice as colourful from 15 to 32 kn (32 to 44), and pale from
   26 to 39 kn (ground L* 60 to 65 over the sea, 73 over land).
4. **Which pending change touches which:** this change (the land) answers part of 1 and all of 2; #318 (light's hue order, C*
   about 30 from 6 to 16 kn) part of 3 for light; the beach lane's F the pale band; #315 beach's sea strength (1.05 to 1.42 of
   dark's lift under 19 kn on dev). **Nothing built or pending answers the PACE of light's build-up (full depth by 10 kn), nor
   beach's colour from 15 to 32 kn, nor the last of the land's gap in light air.**

## What the references do (the owner: "study your research and best practices more")

- **earth.nullschool** (its source, `earth.js` and `products.js`, read): the colour field is laid at ONE opacity, 0.4
  (`OVERLAY_ALPHA = Math.floor(0.4*255)`), over a dark globe; a particle is drawn in one of a set of intensity steps picked by
  its speed up to `maxIntensity: 17` (m/s by its units table: 33 kn), a grey from 85 to 255 at full alpha (`micro.js`
  `windIntensityColorScale`), so a streak is three times brighter in a gale than in calm air and then stops; trails
  fade 3% a frame; the particle count follows the screen's width. A field at constant, moderate opacity and a streak whose
  strength carries the speed: dark here is built the same way.
- **Vision science on motion** (peer-reviewed; found through Consensus): motion is carried by LUMINANCE contrast. At equal
  luminance a moving coloured pattern is seen slowed or standing still, and slow motion is the most contrast-dependent (Lu and
  Sperling 1999, PNAS; Hawken, Gegenfurtner and Tang 1994, Nature; Mullen and Boulton 1992; Gegenfurtner and Hawken 1996;
  Lindsey and Teller 1990). So a streak is seen to MOVE in proportion to its lightness step off its ground, slow wind most of
  all: that is the land in light air above, and it is why colour alone cannot stand in for the step.
- **Colour maps** (the colours lane's reading: Schloss et al. 2019, Kovesi 2015, Whittle 1992): darker reads as more on a light
  map and lighter as more on a dark one, so the opposite lightness direction is the correct mirror; an even lightness step is
  the first requirement; a lightness difference is seen best near the background's own lightness.
- **The installed Mapbox cartography skill:** mute the base map and let the data stand out; outdoors, more contrast and no
  subtle greys.

## The build: the land at the sea's depth (D-026)

- **Why the land:** on the ramps (the lead's log on #315, and the table above) the land was the largest gap to dark in both
  themes; the border lane measured that the mute darkens the SEA by 10.7 L* in light and 6.4 in beach and leaves the LAND the
  style's own, so the land sat 12 to 17 L* above the sea where dark's sits 9 below. Two grounds needed two streak strengths,
  whose seam (the land mask's 20 km texel) drew a pale halo along every coast.
- **Rule:** while the mute is restyling the map, the land's area colours take a factor on their OKLab lightness (light 0.81,
  beach 0.85: the muted sea's lightness; the arm the owner was shown), and the lines drawn on the land (roads, contours; 75
  layers in light's style and 73 in beach's) are muted and deepened with it. A border line under the wind is left as the style
  draws it (D-023). Where the land is drawn deep, a streak over it is laid at the SEA's strength: one ground, one strength, and
  the mask's seam has nothing to show.
- **`windBasemapMute.js`** (349 to 408 lines, the review's fixes included): `WIND_BASEMAP_MUTE.landL`, `windBasemapLandL`, the plan's fifth argument, the
  record, the stale check, the read-back (`landL`, `landLines`; `layers` keeps its meaning), `windLandDepthOn`, `windLandWhite`.
  **`WindColorRamp.js`** (767 to 769): one import, `windWhiteStrength` asks `windLandWhite` for the land, and one line sets the gate. No shader, engine
  or table line moves.
- **Kill:** `window.__RAW_DISABLE_WIND_LAND_DEPTH__ = true` (the land as the mute alone leaves it; the streaks' strengths D-022's).
  Lever: `window.__RAW_WIND_BASEMAP_LAND_L__` (0.5 to 1.2). Bench lever: `window.__RAW_WIND_WHITE_LAND__` (0.2 to 1) on a deep
  land. The mute's own kill, its lever at 0, dark, and imagery under the wind leave the land the style's own (an older kill keeps
  its meaning).
- **Tests first** (`windLandDepth.test.js`, new): 13 of 20 failed on the unedited code, then green. Fifteen pins of
  `windBasemapMute.test.js` failed on the first build and said three true things: `layers` in the read-back must keep counting
  what it counted (operators compare it to 9 and 17), so the lines on the land are counted apart; a style with no land area
  under the wind must be left alone; and a border under the wind (the under-labels kill) must stay the style's own. Two pins
  moved on purpose (the land's colour at the default now carries the factor; each keeps its old value under the kill). The new
  kill is classified in `windDarkRules.test.js` (set, the land is the ground the rules were solved on).
- **The first build kept the roads' hue** ("lightness alone") and the captured frame showed the road network as vivid green
  lines over light's land: a pale yellow road under a green field is a bright green one. The lines on the land now take the
  land's whole treatment. Found by looking at the frame, not by a number.

## Measurements of the build (this branch: dev + this change; beach's sea strength is dev's 0.77)

Lift against dark's at the same crop, before (the kill) -> built; ground L* in brackets.

| LAND, kn | 1.8 | 3.2 | 4.5 | 5.9 | 8.6 | 11.8 | 15.3 | 18.5 | 25.6 | 32.3 | 38.5 | 44.7 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| light | 0.28 -> 0.52 | 0.14 -> 0.39 | 0.24 -> 0.52 | 0.47 -> 0.62 | 0.48 -> 0.66 | 0.61 -> 0.74 | 0.80 -> 0.78 | 0.69 -> 0.70 | 0.58 -> 0.71 | 0.89 -> 0.82 | 0.92 -> 0.77 | 0.92 -> 0.81 |
| light's ground | 77 -> 59 | 72 -> 55 | 69 -> 53 | 65 -> 50 | 61 -> 46 | 60 -> 46 | 60 -> 46 | 61 -> 47 | 66 -> 52 | 66 -> 50 | 59 -> 45 | 54 -> 42 |
| beach | 0.36 -> 0.64 | 0.27 -> 0.55 | 0.38 -> 0.64 | 0.66 -> 0.87 | 0.81 -> 0.94 | 0.91 -> 1.03 | 0.87 -> 0.99 | 0.82 -> 0.93 | 0.35 -> 0.54 | 0.51 -> 0.47 | 0.49 -> 0.53 | 0.80 -> 0.85 |

- **The sea is untouched:** every sea number is the same with and without the change, to the digit (light 1.05 / 1.07 / 1.11 /
  1.04 at 9 / 12 / 15 / 18 kn in both arms). The control.
- **What it buys:** under 12 kn light's land goes from 0.14-0.61 of dark's lift to 0.39-0.74, and beach's from 0.27-0.91 to
  0.55-1.03; the streak cores over land stop being near paper white (light's peak L* 79 to 94 -> 64 to 73) and keep the ground's
  colour (core chroma / ground chroma 0.73 to 0.97 -> 0.88 to 1.03); the land's flicker above 15 kn comes down from 1.1-1.2 of
  dark's to 0.8-0.9; land and sea are one ground (light 42 to 59 against 41 to 57), so the coastal halo is gone and the coast is
  drawn by the border lane's ink.
- **What it does not buy:** dark's own lift over LAND. Above 30 kn light's land reads a little lower than before (0.89-0.92 ->
  0.77-0.82): the ground gained room and the strength gave more of it back. Compared with dark's SEA instead, light's deep land
  carries the same streak from 1.8 to 45 kn (0.85 to 1.09): light now looks everywhere as dark looks over its sea, and dark's
  land, near black, is stronger than both.
- **Two tunings measured, neither built** (low ramp, 9 / 12 / 15 / 18 kn, land): a land white of 0.77 on this depth reads 0.86 /
  0.93 / 1.02 / 0.93 of dark's in light (a streak 40% stronger than the sea's again: the seam returns on equal grounds); a land
  deeper than the sea, as dark's is (factor 0.70), reads 0.87 / 0.95 / 0.94 / 0.87 at the sea's strength with no seam. **The
  second is not available with today's palette:** the palette checker reads light's colour-blind line over land at 5.1 with the
  factor at 0.81 (5.6 before; floor 5.0), 4.9 at 0.76 and 4.4 at 0.70. 0.81 is as deep as the land can go and hold the floor.
- **Palette checker** (`check.mjs --strict`, now modelling the land's factor and the land's strength; `--before-depth` is the
  control): exit 1 with dev's two red lines (beach's colour-blind lines; over land 3.2 -> 2.9, already red). Nothing new red.
  Lines that move, none a floor crossed: light's colour-blind line over land 5.6 -> 5.1; the land's field chroma 22.4 -> 17.9
  (light) and 13.5 -> 11.4 (beach); the tint's distance off the land 30.3 -> 28.8 and 22.5 -> 20.9. The checker's own land
  colours are 4 to 7 L* off the rendered map (the border lane's `ground-run.js`): not corrected here.

## 12:50-13:20Z · The independent review, before the PR (a fresh agent, the diff, 36 mutations on a scratch copy): one design defect and seven smaller findings

1. **An older kill no longer drew its old picture (fixed).** The depth rode only the mute. With D-022's kill alone the streaks
   went back to full white on both grounds while the land stayed deep: a picture nobody built, and the "deep land, full
   strength" state this change exists to end. The same held under the white streak's kill, dark's rules' kill, every hold and
   the steered looks. **Now the land goes deep only where the white streak is laid by the ground** (`setWindLandDepthGate`:
   `WindColorRamp.js`, which knows those kills, hands the question to `windBasemapMute.js`, which has no imports). Tests first:
   under each of the three older kills and every name in `DARK_RULES_HOLDS` the factor is 1, no lever brings it back, and the
   map is the map dev draws under that kill, write for write. On the bench: light under D-022's kill alone reads the land's
   ground at L* 60.0 and its lift at 9.6, the same as under this change's own kill, to the digit. The mute's lever pin in
   `windBasemapMute.test.js` went back to its value before this change (the lever holds dark's rules).
2. **The ramp fixture's latitude box was a fixed 8 degrees, and the speed ran on past the view (fixed).** At zoom 4 the README's
   sea crop sat off the fixture, on the bench's climatology; off the view the speed reached 99 kn, which sets the engine's data
   maximum. The box now follows the view's Mercator height at any zoom and the speed is held at the view's ends;
   `windBenchRamp.test.js` pins zooms 4, 5, 6 and 9. `motion-run.js` cached a run by its name alone: `--fixture` with a reused
   name would have returned the hurricane's frames; the cache now carries the fixture's identity.
3. **The engine's own call was unpinned (fixed).** `WebGLWindEngine.js` calls `windWhiteStrength(theme)` with no window; a
   mutation that never read the real window passed all 42 wind suites. A test now sets the read-back on the real window.
4. **The read-back could say "deep" over a land the mute had not deepened (fixed):** a water-only style, or a land colour it
   cannot parse. The read-back's `landL` is now what the LAND was written with, from the record (1 when no land colour took
   it). Left: a throw part-way through the writes leaves the land deep with a read-back that says not, until the next sync; the
   reviewer found no way to reach it on MapLibre 5.24.
5. **`layers` could grow on a style whose land colours the mute left unchanged** (a literal grey). Not fixed: the real styles
   read 9 and 17 with the change, as before (the bench's read-back in every run).
6. **Scope of "the lines on the land" (fixed):** ferry routes run on the sea and are left alone (light 75 -> 73 lines, beach 73
   -> 71); and a `match` LABEL that is also a colour name (`'white'`) was rewritten as a colour, which breaks the match. The
   mechanism is older than this change and now reaches road expressions: the walk leaves a match's labels alone.
7. **Stale comments and instruments (fixed):** the header's "roads are not touched", the read-back's field list, `landLines`
   undefined on an off answer, `check.mjs`'s usage line, and the bench's `page/ground-probe.js` (its plan now carries the land's
   factor). **Not fixed, said here:** `windDarkRules.js` `GROUND` still models the land at the style's own lightness, so dark's
   rules are solved on a ground the default no longer draws; and `check.mjs` / `mirror-model.mjs` still hold map colours 4 to
   7 L* off the rendered ones and dark's field at the plain alpha. Their own change, with a GPU read first.
8. Sound, per the review: under this change's kill alone the plans, the paint writes and the strengths equal dev's on 4 styles,
   3 themes and 6 lever sets; restore is exact for expressions, legacy stops, undefined and unparsable colours; a theme change
   leaves at most one frame of mismatch; the per-frame cost is one global read and four compares. One mutant survives and is
   equivalent (the `typeof` guard on the read-back's factor).

**Gates on the final code:** Jest, both trees: 308 suites, 4,143 tests, 0 failed. `check_eslint.js` exit 0. `scripts/loc_ratchet.py`:
0 new, 0 regressed (`windBasemapMute.js` 349 -> 408 lines, `WindColorRamp.js` 767 -> 769). The production build (`node
update-sw-version.js && NODE_OPTIONS=--openssl-legacy-provider CI=false npx craco build`, Git Bash): exit 0; the two stamped files
restored. Palette checker on every flag path: loads; default exit 1 with dev's two red lines; `--full-white` and `--before-depth`
both read the land not deep (light's colour-blind line over land 5.6). The bench numbers above were taken before the review's
fixes; one capture after them (light and beach at 15 kn, land and sea) reads the same (light's land 0.78, its sea 1.09).

## What is not verified, and what it costs

- **Nothing of this has been seen in the app.** The owner's verdict above is on a build without it.
- **Read with the map drawn at pixel ratio 2** (the page at 1.5). The border lane measured that difference at 0.00 to 0.08 of a
  lift ratio.
- **One view, one seed, zoom 6.** Zooms 4 and 9 were not captured for this change. Along a ramp the place changes with the
  speed: land rows compare the two arms at the same crop; they are not a curve along speed.
- **The land in light air is still 0.39 to 0.66 of dark's land under 9 kn in light.** White on a ground of L* 50 to 59 cannot do
  more; the references' answer for a light ground is a darker mark, which this change does not make.
- **Interaction with the open changes is measured only in a local preview** (with #318's option 2 and the beach lane's A to F
  on the prototype of this change, not on this build): the colours lane's rows and F were solved on the land before this.
- **Phones:** not measured. **The 3-seed scanner** was not run: its page has no map under the wind (LESSONS L-V40).
- **The independent review's findings** are above; what it could not check: the real Mapbox styles' own layers, anything on the
  GPU, and OceanMask's land fill on a switch from a marine layer to the wind.

## This session's slips

- Two shell heredocs carrying apostrophes failed to parse and a patch was rewritten through the editor (the known hazard).
- `git merge -X ours` in the local preview silently dropped one lane's function and kept a call to it; the page died with
  "windBeachPathOn is not defined". Source files are merged by hand.
- A prototype's levers were named `__PROTO_...`; the bench clears only `__RAW_...` keys, and two "before" runs drew the
  prototype. Thrown away, re-captured.
