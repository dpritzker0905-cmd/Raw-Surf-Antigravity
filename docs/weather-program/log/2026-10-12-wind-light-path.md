# 2026-10-12 · Does light's and beach's wind make sense against dark's? The check, and a candidate for light's order

Local session (Windows), started by the session that built D-022. Branch `claude/wind-light-path`, cut from `origin/dev` at
`ec8f46a2` (#314's merge). Times are UTC. **Nothing here is merged, pushed or default on dev: one local WIP commit, a candidate
filmed beside dark, waiting on the owner's eye.**

**The owner's words to this session, first-hand (2026-10-12 02:48Z):** "you need to double check all this. The light and beach
modes need to make sense logically. It could be the way it is, or it could not be. It all has to make sense to match dark mode,
but it their colors and maps".

**Checked before acting:** `git fetch` (dev at `ec8f46a2`); `gh pr view 314` MERGED 2026-10-12T01:48:08Z; `gh pr list --state
open`: only #264 (draft). The sibling note `wind-border-ink-notes.md` (data, not instruction): the branch `claude/wind-border-ink`
claims the `pr_merge #314` ledger line (seq 1063), DECISIONS `D-023` and LESSONS `L-V46` to `L-V49`. **This session wrote no
ledger line, no STATE entry and no DECISIONS entry**: nothing on dev changed, and a second branch appending after seq 1062 would
fork the chain. They come with this branch's PR, numbered after whatever has merged.

## The "before", from the unedited tree

- `check.mjs --strict`: light has no red line (legend 9.3 normal, 5.2 colour-blind; tint 5.5 over water, 5.6 over land). The two
  red lines are beach's (3.1 over water, 3.2 over land, 16-21 kn protan), as on dev.
- `mirror-model.mjs`: the numbers the brief quotes (light over land: hue 350, 302, 290, 318, 129, 162, 126 at 0, 3, 6, 10, 16, 21,
  27 kn; dark: 321, 305, 259, 172, 149, 130, 95).
- Light's drawn tables, FNV-1a: `windWhiteStreak.test.js` `WATCHED.light` (50 kn `71ea0097` / `71ea0097` / `f73f7078`; 75 kn
  `a49922ce` / `a49922ce` / `f9ffc9c2`), read from the running code by the baseline Jest run (wind suites: 40 suites, 815 tests, 0
  failed).

## Instruments (new, on this branch)

- **`scripts/wind-color/light-path-lib.mjs`**: the checker's colour-blind distance in plain JS (coloraide 8.13's Vienot protan and
  deutan, Brettel tritan, CIEDE2000 in CIELAB D65). `--verify` scores 4,000 random pairs both ways: largest disagreement
  2.3e-12 dE2000. A search can now hold the floor as a constraint (L-V45) at about 0.1 ms a candidate.
- **`scripts/wind-color/light-path-solve.mjs`**: the solve (differential evolution over the on-screen L*, C*, hue at the Beaufort
  stops; a row a knot between; every bar scored on the rows as written, 3 decimals). `--score <file> --emit <file>` writes the
  field and streak rows.
- Scratch, to be tidied or dropped before a PR: `_audit.mjs` (the check below), `_read.mjs`, `_sheet.mjs` (the still sheet).

## The check: dark's logic, and each theme against it on its own map

Read from the tables through the composite model (`mirror-model.mjs`), knot by knot, 0 to 60 kn. **Not read from pixels**; the
motion bench further down is the pixel read for light.

**What dark does.** Speed is carried by the ORDER of its hues: one way round the wheel (magenta, violet, blue, aqua, green,
yellow-green, yellow, orange, red, magenta), never turning back. Its lightness is one arc (dim at calm, lightest at 16 to 27 kn,
dimmer through the reds, pale at 75 kn): it is not the code. Its distance from its own map rises to 21 kn and FALLS for storms
(43.4 dE00 at 21 kn, 32.5 at 40). Hardest edge 11.0 dE00 a knot over land, 12.1 over its sea. Weakest normal-vision neighbours
7.4 to 7.6 (16-21 kn).

| | dark | light | beach |
|---|---|---|---|
| hue turns back, 0-60 kn | never | 4 times (at 6, 10, 16, 21 kn) | once over land (8 kn, 14 degrees), never over sea |
| same colour name as dark, speed by speed | | 0-6 kn and 16 kn yes; **10 kn orchid (dark: aqua), 21 kn teal (dark: yellow-green), 27 kn green (dark: yellow)**; 33 kn up yes | 0-10 kn its own sea greens (dark: violet, blue, aqua); 16 kn up yes (27 kn one step behind) |
| lightness over land along speed | one arc | falls, except 16 to 21 kn (+4.3 L*) | **67 at calm, down to 46.7 at 10 kn, up to 70.8 at 27 kn, down to 44** |
| hardest edge a knot (land) | 11.0 | **16.0** (11-12 kn) | 3.9 |
| colour-blind neighbours (checker) | 5.2 | 5.5 / 5.6 | **3.1 / 3.2, red** |

**Light.** It follows dark's order except in two places. 10 kn is an orchid, hue 318: nearer its own calm (350) than its 6 kn
(291), and the colour dark gives calm air. 21 kn is a teal behind 16 kn's green, and lighter than it, so a fresh breeze reads as
less wind than a moderate one. Between them the field swings 188 degrees of hue in six knots, which is the 16.0 edge. Cause, from
the code's own history (`WindColorRamp.js`, LIGHT LOW BAND, 2026-10-09): 10 kn went violet and 16 kn green to keep the wind off
the colour of light's cyan sea. The basemap mute came after; the sea under the wind is grey now, so that reason is gone. The
colour-blind passes then held the zigzag in place (L-V45). **Calm to 6 kn and 33 kn up are right as they are.**

**Beach.** Its order is sound: its own sea greens to 10 kn, dark's order from there. What does not hold is its lightness: 10 kn
is its darkest band below 47 kn and 27 to 40 kn are as light as calm (the name guard keeps yellow and orange grounds pale). In
its green low band the hue hardly moves, so lightness is what tells 6 from 16 kn there, and it runs both ways. And its field has
read 3.1 / 3.2 against the 5.0 colour-blind floor since dark's rules dimmed it (`check.mjs --theme beach --today`, the tables
before D-020: 5.1 / 5.2). **Not changed here.**

**A side reading, not acted on:** the checker scores dark over its sea only. Over this model's dark land ([18, 20, 26], the
bench's offline colour) dark's weakest colour-blind pair reads 3.8 (47-55 kn, tritan). Three files hold three different dark
grounds (`check.mjs`, `mirror-model.mjs`, `windDarkRules.js` `BASE.dark`): the number depends on which is right.

## What a fix for light costs: the frontier

Every row: the deepest field (L* over land at 6 / 10 / 16 / 21 / 27 kn; today 65.1 / 59.1 / 57.1 / 61.4 / 60.3) that holds the
colour-blind floor at 5.2 with lightness never rising, one chroma crest (a stop no more than 6 C* above both neighbours), no knot
harder than 11.0 dE00, and the 33 kn row up as drawn.

| hue held to dark's within | weakest normal-vision neighbours held at | 6 / 10 / 16 / 21 / 27 kn | read |
|---|---|---|---|
| 8 degrees | 9.0 | 73.4 / 68.9 / 68.9 / 68.9 / 61.8 | 8 to 12 L* paler than today |
| 8 degrees | 8.0 | 70.8 / 65.5 / 65.5 / 65.5 / 61.0 | 4 to 8 paler |
| 20 degrees, calm and 3 kn kept as drawn | 8.0 | **64.2 / 63.8 / 63.8 / 63.8 / 60.1** | the candidate |
| calm, 3 AND 6 kn kept as drawn | 8.0 | none | the 6-10 kn edge reads 13 to 15 dE00, floor 4.8 to 5.0 |

- With the hue held to 8 degrees and 10 to 21 kn at 62 or deeper, no solve reached the floor: 4.0 at best. The 33 kn row, fixed
  at L* 53.6, leaves 11 L* for five neighbouring pairs, and a cyan this deep cannot carry more than C* 30 under a 0.70 multiply tint.
- **A second shape exists and was not built:** two levels instead of one (6 and 10 kn at about 65, 16 and 21 kn at about 59.5,
  27 kn 60). With calm and 3 kn re-solved it holds 5.2 at 16 to 25 degrees; with them kept as drawn it reached 5.08 at 20 degrees
  with a 0.6 L* rise at 27 kn. It gives the streaks back their ground at 16 to 21 kn; 10 kn stays light in every solve.
- One bar at a time, at one depth (68 from 10 kn): dropping the chroma-crest bar buys 0.85 of floor (by drawing stripes: not
  taken); a normal-vision bar of 8 instead of 9 buys 0.6 to 0.8; 2 L* more lightness buys 0.7.
- **The brief's tolerance (8 degrees) was the expensive assumption.** Dark's own field differs by 6 to 11 degrees between its
  land and its sea, and light's storm rows already sit 12 to 13 degrees behind dark's.

## The candidate (built behind a kill, filmed; NOT finished)

`src/components/map/windLightPath.js` (`LIGHT_PATH`: rows 4 to 32 kn of the field and of the streak row; calm, 3 kn and 33 kn up
are `LIGHT_LOOK_FIELD.deep`'s own), `WindColorRamp.js` (`windLightPathOn`, a branch in `darkRulesTables`, the look key gains
`path`: `white+path|dark-rules` in light). Kill: `window.__RAW_DISABLE_WIND_LIGHT_PATH__ = true`. On only where the white streak
draws. Beach and dark untouched.

Over light's muted land, L* / C* / hue (dark's hue): 6 kn 64.2 / 30.0 / 279 (259) · 10 kn 63.8 / 30.2 / 192 (172) · 16 kn 63.8 /
30.4 / 154 (149) · 21 kn 63.8 / 36.6 / 127 (130) · 27 kn 60.1 / 42.6 / 106 (95). Hue turns back 0 times; steepest knot 9.0.

- **`check.mjs --strict` on it:** colour-blind lines pass (5.2 over water, 27-33 kn deutan; 5.5 over land); **two RED lines, both
  "tint sits > 30 deg off the legend's own hue" (7 kn of range)**, because the legend has not moved yet. Under the kill light's
  lines are the unedited tree's, line for line.
- **Jest, wind suites:** 11 tests fail in 3 files, all pins of the old default (table hashes, the look key, the kill
  classification, two descriptive lightness pins). Not re-pinned yet. The depth bars themselves (65.2 over land, 50.2 over sea
  from 6 kn) still pass.
- **In motion** (`motion-run.js --dpr 1.5`, the real engine and basemaps, Mobile Bay, 120 frames; `mirror-run.js`). The "before"
  arm reproduces D-022's numbers. Lift against dark's:

  | | sea z6 / z4 / z9 | land z6 / z4 / z9 |
  |---|---|---|
  | light today | 1.03 / 1.22 / 1.14 | 0.89 / 0.78 / 0.30 |
  | candidate | 1.05 / 1.11 / 1.20 | **0.74 / 0.68 / 0.02** |

  Over the sea nothing is lost. Over land the streaks lift the picture less: the 10 to 16 kn ground is 5 to 7 L* lighter and a
  white streak has less to stand on (a streak's step at zoom 9 over land: 16.7 L* before, 11.0 now).
- **What it costs, said plainly:** 6 to 16 kn are less colourful (C* 30 against 45 to 47; dark's own is 31 to 40); 10 and 16 kn
  are 4.7 and 6.7 L* lighter; streaks over land are fainter, most at close zoom; the weakest normal-vision neighbours are 8.0
  (the field's weakest was 9.0; dark's is 7.4); a turquoise 10 kn field over a pale land may read as water (not measured: the eye's).

Sent to the owner at 03:32Z: the still sheet (each theme, speed by speed), one frame of the nine runs, and the clip (dark | light
today | candidate at zooms 6, 4, 9). Files: `frontend/scripts/wind-bench/out/show/` (not tracked).

## Not done, and owed before any PR

1. **The owner's eye on the candidate.** No verdict yet.
2. **The legend** (`THEME_RAMPS.light`, rows 6 to 27 kn) moved to the field's hues, gated with the same switch so every older
   kill still draws its own legend; the checker's two red lines cleared; 9 dE00 normal and 5.0 colour-blind held on the bar.
3. Tests (the switch, the kill byte for byte against `WATCHED.light`, the order, the lightness, the floor, each with the table
   before as its control); the three existing files re-pinned with the kill reading what they pin now.
4. Both Jest trees, `check_eslint.js`, `loc_ratchet.py` (`WindColorRamp.js` is at 781 of 800 lines), the build, the 3-seed
   scanner, an independent review; STATE, DECISIONS, LESSONS, the ledger.
5. **Beach** is its own change: lightness that runs one way through its green band, and the colour-blind floor back above 5.0.

## This session's own slips

- For most of an hour the solve held light to dark's hue within 8 degrees, the brief's starting figure, and was heading for a
  field 6 to 9 L* paler. The owner's message stopped that: the check came before the solve should have.
- A bar that the chroma line have ONE crest was stricter than dark itself (dark dips through cyan). It is kept from the first
  stop that moves only.
- A table module written through a shell heredoc lost its backticks, and a patch passed inline failed to parse: the known
  hazard, again. Both were redone from files.

## 03:45Z · CORRECTION: every DARK number above was read through the wrong law

*(This header first read 03:55Z: an estimate, written at 03:45:48Z by the commit's own clock (LESSONS L-P10). Corrected before the
branch was pushed; the audit caught it.)*

Found by the session leading this work (its message, about 03:40Z) and checked here in the code: `WebGLWindShaders.js` line 992
writes dark's field premultiplied, `vec4(fieldRgb * alpha, alpha)`, and `WebGLWindEngine.js` line 590 blends it with
`gl.blendFunc(SRC_ALPHA, ONE_MINUS_SRC_ALPHA)`. On screen dark is **field x alpha squared + map x (1 - alpha)**.
`mirror-model.mjs` and `check.mjs` lay it at alpha: twice as strong from 5 kn. A GPU read is owed by that session;
`mirror-model.mjs` and `check.mjs` are NOT changed on this branch (their dark lines and pins are that session's change). The
solver now takes dark through its own function (`light-path-solve.mjs` `darkOn`), and a scratch `_dark-law.mjs` prints both laws.

**What stands:** everything read about light and beach (the multiply law): their tables, their turn-backs, their lightness
lines, their colour-blind lines, the candidate's rows, the motion bench. Dark's hue ORDER: over its land it never turns back
by either law, and its hue at a stop moves 2 to 5 degrees.

**What is wrong above, and the reading by the engine's law** (style grounds: land [18, 20, 26], sea [93, 117, 126]):

| said above | by the engine's law |
|---|---|
| dark's field over land, L* 13 to 50, C* 31 to 47 | L* 5.6 to 26.5, C* 18 to 25: dimmer, and about half as colourful |
| "its lightness is one arc, lightest at 16 to 27 kn" | nearly FLAT from 6 to 40 kn: 19.1 to 26.5 over land, 39.6 to 46.8 over sea |
| dark's hardest edge 11.0 dE00 a knot (land), 12.1 (sea) | 8.9 and 8.2 |
| dark's weakest normal-vision neighbours 7.4 to 7.6 | 5.5 over land, 5.1 over sea (16-21 kn) |
| dark's colour-blind line 5.2 (the checker's, over its sea) | 3.1 over sea (47-55 kn tritan), 2.5 over land (33-40 kn deutan): **under the 5.0 floor** |
| the candidate's hue within 20 degrees of dark's at the stops | within 23.5 (6 kn; 14.8 at 10 kn, 1.2 at 16, 5.0 at 21) |
| the candidate's steepest knot 9.0, under dark's 11.0 | 9.0 against dark's 8.9: **0.1 over, not under** |
| the candidate's 6 to 16 kn colour (C* 30) "is dark's own strength there" | it is above dark's (C* 18 to 21 on screen) |
| dark over its sea never turns back | one turn under 3 kn (hue 276 at calm, 286 at 3 kn), where its veil is weakest |

The frontier table's first two rows held hue to 8 degrees of dark's hue by the OLD law; against the engine's law those solves sit
within about 12. The conclusion drawn from them (a tight hue match costs depth) rests on light's own rows and stands.

**For the lightness along speed** (the leading session's question): from 6 to 27 kn the candidate's ground is as flat as dark's
(64.2 to 60.1 over land, 49.5 to 46.0 over sea; today's light 57.1 to 65.1 and 43.8 to 50.1, running both ways). From 27 to 40 kn
it slides darker with the rows that were kept (60.1 to 46.8 over land), so over 6 to 40 kn its span is 17.4 L* against dark's 7.4.
Sign: dark's ground gets LIGHTER from 3 to 21 kn (+21 L*) where light's gets darker (-8); from 21 to 55 kn both get darker.
The per-knot table (dark, light today, the candidate; land and sea; 0 to 60 kn) is in the shared notes folder,
`wind-light-path-ground-per-knot.md`.

**What the colour-science sources say** (searched 03:50Z; the last inference is this session's, not theirs):
- Schloss, Gramazio, Silverman, Parker and Wang, "Mapping Color to Meaning in Colormap Data Visualizations", IEEE TVCG 2019:
  readers assume darker means more (dark-is-more), and where a colour map looks as if it varies in opacity, that the more opaque
  end means more (opaque-is-more). The two agree on a light background and pull against each other on a dark one. So light's
  field getting DARKER with speed and dark's getting lighter is each right for its own map: the opposite sign is the correct
  mirror, not a fault to remove.
- Kovesi, "Good Colour Maps: How to Design Them", arXiv 1509.03700 (2015): an even step in perceived LIGHTNESS is the first
  requirement; flat spots hide features and discontinuities invent them; CIELAB is uniform only at low spatial frequency. So a
  band carried by hue alone on one lightness level (the candidate's 6 to 21 kn, and dark's own plateau) reads weaker at fine
  scale than the same step in lightness, and light's 16.0 edge was a feature that is not in the data.
- Whittle, "Brightness, discriminability and the crispening effect", Vision Research 1992 (PubMed 1455722); Kane and Bertalmio
  2016: a lightness difference is seen best near the background's own luminance. An equal L* step is therefore NOT the same
  visible step on a near-black map and on a pale one; equal lift in L* between themes is a first approximation.

## 03:48Z to 04:55Z · The owner's choice (option 2), built: two levels, the legend bar, tests, gates

**The owner, first-hand, 03:48Z**, after the still sheet, the frame sheet and the clip of the first candidate, and three options
(take it; take the order but give the streaks their ground back at 16 to 21 kn; leave light as it is): "option 2, give the
streaks their ground back and do the suggested task in the popup". The popup was this session's proposal card for beach; it was
started at 03:49Z as its own session ("Beach wind: lightness one way, colour-blind floor back"), and the corrections found after
its brief was written (dark's law, the edge bar, the ids) were sent to it.

**Relayed by the session leading this work, not first-hand here:** the owner, 01:33Z, "merge #314 and start the borders and light
colours follow-ups"; and, 02:58Z, asking that session to lead the sub-sessions with "the jacobian lens". Its asks of this lane
(a per-knot ground table for land and sea, the flatness of the ground along speed, the sign, cited colour science) are answered
in the 03:45Z correction section above and in the shared notes folder.

### The solve (dark by the engine's law; `light-path-solve.mjs --deep`)

Bars: calm kept as drawn; hue within 20 degrees of dark's at the stops and never turning back; lightness never rising beyond the
table's own rounding (0.02 L*); depth caps 65.2 at 6 kn, 65.8 from 10 to 15 kn, 60.3 from 16 kn; no knot harder than dark's own
(8.9 dE00); one chroma crest from the first stop that moves; normal-vision neighbours 8.0. The aim: the deepest ground, 10, 16
and 21 kn weighted double.

| | 3 kn | 6 kn | 10 kn | 16 kn | 21 kn | 27 kn | 33 kn (kept) |
|---|---|---|---|---|---|---|---|
| before, over land (L* / C* / hue) | 72.1 / 26.4 / 302 | 65.1 / 45.5 / 291 | 59.1 / 47.5 / 318 | 57.1 / 44.6 / 129 | 61.4 / 39.2 / 162 | 60.3 / 32.1 / 126 | 53.6 / 33.0 / 92 |
| built (option 2) | 71.9 / 21.6 / 299 | 65.2 / 28.0 / 276 | 64.9 / 30.3 / 197 | 60.1 / 32.1 / 165 | 60.1 / 36.3 / 138 | 60.1 / 42.5 / 107 | 53.6 / 33.0 / 92 |
| built, over sea | 55.4 / 18.0 / 293 | 50.2 / 23.5 / 274 | 50.2 / 24.7 / 199 | 46.2 / 25.9 / 167 | 46.2 / 29.3 / 140 | 46.0 / 33.8 / 110 | 40.8 / 25.6 / 97 |
| dark over its land, engine's law (hue) | 299 | 256 | 177 | 153 | 132 | 97 | 82 |

Colour-blind floor 5.13 (21-27 kn, protan, over the sea; 5.5 over land). Weakest normal-vision neighbours 8.0. Hue gap to dark
19.9 degrees at the stops, 24.6 at some knot between. Hardest edge 7.9 dE00 (6 to 7 kn over land).

- **Calm kept; 3 kn re-solved.** With calm AND 3 kn kept as drawn the two-level shape reached 5.01 to 5.09 at 20 to 24 degrees.
  With 3 kn free it lost 4.8 C* (26.4 to 21.6) and the floor reads 5.13 at 20 degrees: the 3 to 6 kn pair is what it buys.
- **5.20 was available and not taken:** with lightness allowed to rise 0.1 L* from 21 to 27 kn (the first tolerance) the same
  shape reads 5.20. The bar is "never rises"; the table holds it to 0.02.
- **Option 2 against the first candidate, in motion** (`motion-run.js --dpr 1.5`, `mirror-run.js --at`; lift against dark's):

  | | sea z6 / z4 / z9 | land z6 / z4 / z9 | a streak's step over land at z9 |
  |---|---|---|---|
  | light before | 1.03 / 1.22 / 1.14 | 0.89 / 0.78 / 0.30 | 16.7 L* |
  | first candidate (one level) | 1.05 / 1.11 / 1.20 | 0.74 / 0.68 / 0.02 | 11.0 |
  | built (two levels) | 1.03 / 1.13 / 1.14 | 0.71 / 0.74 / 0.19 | 13.1 |

  It gives back the ground from 16 kn (zoom 4 and part of zoom 9). The zoom 6 land crop sits in 6 to 10 kn wind, on the L* 65
  level: nothing came back there. **Under 6 to 13 kn winds over land the streaks are fainter than before, and stay so.**

### The legend bar

A first build laid the new rows INSIDE `resolveThemeRamp`. 28 tests failed, most in states this change never draws (the looks,
the hue-path kill, the mid-band refine): the particle ramp is what every older kill draws its marks from. Rebuilt with the bar's
own resolver (`resolveLegendRamp`, used by `windLegendGradientCSS`); `resolveThemeRamp` is byte for byte what it was. 16 pins
moved, all of the old default. `light-path-legend.mjs` solved the six rows (3 to 27 kn): each within 6 degrees of the field's
hue at its stop, the bar within 17 degrees of the field at every half knot from 3 to 40 kn over land and sea; neighbours from
calm to 33 kn 12.0 dE00 or more in normal vision and 5.4 colour-blind; lightness never rising along the bar. `check.mjs` and the
bench's `map-entry.js` read the bar through it. `MapWeatherControls.js` is not edited: its three layouts draw the one derived
bar.

### The palette checker, `check.mjs --strict` (every red and warn line as it is)

| | before (dev `ec8f46a2`) | now | under the kill |
|---|---|---|---|
| light legend, normal / colour-blind | 9.3 (6-10 kn) / 5.2 (27-33 protan) | 11.7 (40-47) / 5.4 (10-16 tritan) | dev's |
| light tint over water / land, colour-blind | 5.5 / 5.6 | 5.1 (21-27 protan) / 5.5 | dev's |
| light: tint > 30 deg off the legend | none | none | none |
| light marks' own colours, colour-blind (a watch line) | warn 2.5 | warn 2.3 | dev's |
| beach tint over water / land, colour-blind | RED 3.1 / RED 3.2 | RED 3.1 / RED 3.2 | |
| beach marks (watch lines) | warn 6.3, 1.7, 2.0 | the same | |
| dark: tint < 20 deg off the water hue (watch) | warn 6-7.5 kn | the same | |

Exit 1 before and now, for beach's two red lines alone. No bar was lowered.

### Tests and gates

- **`windLightPath.test.js`, new, 62 tests:** the switch and every lever that stands it down (36 lever cases, each compared with
  and without the kill: tables, key, bar, mark model); the kill byte for byte against `WATCHED.light`; beach and dark against
  their own pins; the engine's call shape on the real window; the order (reversals 0 against 4, hue gap against dark by the
  engine's law, pinned from the shader's and the engine's own lines); the edge; the two levels; the floor on both grounds; the
  costs; the streak core; the bar. **Mutations, 5 of 5 red:** the kill ignored (14 tests fail), 10 kn back to an orchid (9), the
  bar ignoring its levers (2), the path drawn without the white streak (1), the look key forgetting the path (2).
- **Re-pinned on purpose, not loosened:** `windWhiteStreak.test.js` (light's D-021 bytes are read under the path's kill; the
  window block kills the path; the descriptive lightness pins moved: everyday 60.1 to 65.0 where the arm read 57.1 to 61.4, 3 kn
  71.9, and the depth bars 65.3 / 50.3 where they were 65.2 / 50.2, because 6 kn over the sea reads 50.21), `windDarkWhite.test.js`
  (its `TABLES` for light under the path's kill; the look key), `windDarkRules.test.js` (the new kill classified: 60 named, 21
  hold, 39 do not; the look key), `windLightLook.test.js` and `windClearLowBand.test.js` (the bar before the path, read through
  the kill), `src/tests/windLegendFromRamp.test.js` (the bar derives from `resolveLegendRamp`; a new test for the bar under the
  kill).
- **Jest, both trees:** 307 suites, 4,123 tests, 0 failed (306 and 4,060 on dev at #314's record: 62 new and 1 in the legend
  file). **`check_eslint.js`:** no rule over its baseline. **`loc_ratchet.py`:** no new violation (`WindColorRamp.js` 790 of 800
  lines). **Production build** (`node update-sw-version.js && NODE_OPTIONS=--openssl-legacy-provider CI=false npx craco build`,
  Git Bash): exit 0; the two stamped files restored.
- **The 3-seed scanner** (`run.js --seeds 3 --themes light --variants candidate,before-path`, 84 runs): positive control PASS on
  all three seeds; the default and the kill read IDENTICALLY on every number in all 13 views (4 shapes in 3 of 13 views, ink 100
  to 160 in both). **A null by construction, as the scanner itself prints:** it reads max(R, G, B), and the path moves hue and
  saturation only. It shows the path moves no shape; it says nothing about the colours.

### This stretch's own slips

- A trailing comment added to the solver's penalty line commented out four bars; one run returned a table 0.8 L* over its depth
  cap with "violation 0.000". Caught on the printed bars, fixed, re-run (LESSONS L-V53).
- A write of the two-level tables was refused (the file had changed under an earlier patch) and went unnoticed for one bench
  run: the first "two-level" film was the one-level tables. Caught because its ink read the first candidate's to two decimals;
  re-filmed under new run names.
- The first legend build (above) changed a shared table at the table instead of at the reader (LESSONS L-V54).

### Not verified, and what it costs

- **Nothing of this build has been seen in the app.** The owner chose option 2 from its description and the first candidate's
  clip; the clip of option 2 itself goes out with the PR. The numbers are the real engine on the real basemaps at pixel ratio
  1.5, on the bench's view (Mobile Bay, a hurricane fixture), not the owner's.
- **Dark's law is read from the code,** not from pixels (the leading session owes the GPU read). If it is wrong, the hue gap
  and the edge bar quoted against dark move; light's own bars do not.
- **The bench's `hue30` line was not run** on this build (the bar is now read through `resolveLegendRamp` there).
- **Phones:** not measured. **The legend bar** was checked as a ramp and as CSS, not looked at in the three layouts.
- **No served number moves** (client only): no SCOREBOARD row.

## 05:23Z · CORRECTIONS before the push: the sea and the land read on a speed ramp; the independent review; lesson ids

**1. "Over the sea nothing is lost" was read where this change does not draw.** From the session leading this work (checked here):
the hurricane scene's sea crops hold about 41 kn wind, and this change's rows run 1 to 32 kn. Its own ramp read of the FIRST
candidate found the sea 9 to 15% under its "before" at 13 to 19 kn and the land 0.06 to 0.22 lower. So the built tables were
filmed on a ramp of their own: wind due north, 3 kn at 93 W to 33 kn at 83 W (a synthetic fixture run through a scratch copy of
`motion-run.js`; neither is committed, the leading session is committing a ramp fixture), zoom 6, dark | light under the kill |
light, 120 frames each, 110 px crops (about 3.3 kn each) read with `mirror-run.js --size 110 --at`. Lift against dark's:

| kn | land, before -> now | sea, before -> now | ground over land, before -> now (L*, the probe's) |
|---|---|---|---|
| 6 | 0.78 -> 0.75 | 1.08 -> 1.06 | 65.9 -> 67.3 |
| 8 | 0.60 -> 0.56 | 1.03 -> 1.00 | 63.1 -> 66.1 |
| 10 | **0.68 -> 0.52** | 1.05 -> 0.99 | 61.2 -> 66.6 |
| 13 | **0.78 -> 0.56** | 1.07 -> 0.99 | 60.5 -> 65.0 |
| 16 | **0.90 -> 0.77** | 1.11 -> 1.02 | 60.2 -> 62.6 |
| 19 | 0.77 -> 0.74 | 1.00 -> 0.97 | 61.6 -> 62.0 |
| 21 | 0.74 -> 0.74 | 0.97 -> 0.96 | 62.5 -> 62.0 |
| 24 | 0.73 -> 0.75 | 0.96 -> 0.99 | 63.7 -> 64.1 |
| 27 | 0.70 -> 0.70 | 0.95 -> 0.99 | 64.9 -> 65.6 |
| 30 | 0.84 -> 0.81 | 1.02 -> 1.01 | 65.1 -> 65.3 |

- **The sea:** 0.96 to 1.06 of dark's at every speed (0.95 to 1.11 before). From 8 to 16 kn it comes down 0.03 to 0.09, from a
  little above dark's to dark's. Not a loss against the model; lower than before.
- **The land:** the cost sits at **10 to 16 kn** (not "6 to 13" as written above): 0.68, 0.78, 0.90 become 0.52, 0.56, 0.77.
  From 19 kn the two-level ground gives everything back.
- The probe's ground reads 1 to 3 L* lighter than the table's (it is each pixel's darkest moment under a dense field, and the
  real land is lighter than the model's): trust the differences more than the levels.
- **"Pixel ratio 1.5" was the PAGE's.** `motion-run.js --dpr` sets the page's ratio; the bench's map canvas is drawn at 2 unless
  `--map-dpr` is passed (a flag on PR #316's branch, not on dev). Every lift in this log was taken that way.
- A still of the ramp (dark | light before | light now) is the clearest single picture of the change: light's old rows open
  lilac, periwinkle, a pink band at 10 kn, blue, teal, green, a lighter teal band at 21 kn; the new ones run lilac, blue, cyan,
  sea green, green, yellow-green, as dark's do.

**2. The independent review** (a read-only agent with no part in the work; it loaded dev's and this branch's `WindColorRamp.js`
as text and compared 13,693 lever sets across three themes and two call shapes: the look key, the drawn field and streak rows,
both LUTs at 50 and 75 kn, the field texture, the legend CSS and stops, the particle LUT and the mark model). **Under the kill:
0 mismatches against dev. Beach and dark: 0. Light with the path off (21,294 cases): 0. No partial mix of field, streak row and
legend.** It recomputed the header's numbers (floor 5.13 over the sea and 5.50 over land, hardest step 7.85 dE00, the legend
12.05 normal and 5.41 colour-blind, 0 hue reversals, largest lightness rise 0.02). Four should-fix findings, all fixed:

- **D-022's kill no longer restored PR #313's look in light:** with `__RAW_DISABLE_WIND_DARK_WHITE__` alone light drew the path's
  tables under full-strength white, a picture nobody built (and the test here had pinned it as intended). Fixed: that kill
  stands the path down; under it light's tables hash to D-021's again, and `windDarkWhite.test.js` asserts so for both themes.
- **The Canvas2D fallback** (`WindParticleOverlay.js`, drawn when the WebGL wind fails or `__FORCE_WIND_FALLBACK__` is set) samples
  the particle ramp, so its 10 kn marks would have sat under a bar showing the path's cyan. Fixed: the overlay publishes
  `window.__WIND_CANVAS_FALLBACK__` while it is mounted, and the path (and its bar) stand down.
- **The rendered bar did not follow a kill set after first paint:** `MapWeatherControls.js` memoised the legend on `[theme,
  heightUnit]`. Fixed: the memo is keyed on the look key too (two lines changed in place; the file did not grow). The header and
  a test title that said "at once" now say what is true: the engine at once, the bar at its next render.
- **The default arm's bytes were not pinned:** two mutants of the tables passed every suite. Fixed: the default's field, streak
  and legend-bar hashes are pinned (`NOW`), with a chroma floor on the streak cores.
- Notes taken: two comments said "4 to 32 kn" (the code replaces 1 to 32); "the legend within 6 degrees" is 6.1 over land and
  12.5 over the sea (the header now says 6.5 and 13); the legend rows handed out are copies and `LIGHT_PATH`'s rows are frozen;
  a streak's colour core steps 12.8 dE00 from calm to 1 kn and 8.1 from 32 to 33 kn, where the path meets the rows it keeps
  (4.2 and 4.8 before): recorded in the header, not changed.
- Not checked by it: the GPU, the bench and a rendered legend.

After the fixes: `windLightPath.test.js` 66 tests; mutations 9 of 9 red (the five before, the reviewer's two, D-022's kill no
longer standing the path down, the fallback no longer standing it down).

**3. Lesson ids.** The border-ink branch (#316) holds L-V51 and #315 holds L-V50 and L-V60 to L-V62 (their notes, 05:05Z). This
branch's three lessons are L-V52, L-V53 and L-V54; D-024 stands.

**4. `_dark-law.mjs` is kept** on the branch at the leading session's request (it cites it): dark's field by the engine's law
beside the instruments' law, per stop, with the steepest step and the colour-blind line each law gives.

**5. Gates re-run after the fixes:** Jest, both trees: 307 suites, 4,127 tests, 0 failed. `check_eslint.js` exit 0. `loc_ratchet.py`:
no new violation, none regressed (`WindColorRamp.js` 792 of 800 lines; `MapWeatherControls.js` did not grow). Production build
exit 0, the two stamped files restored. `check.mjs --strict`: light's lines as in the table above (the tables did not move), exit 1
for beach's two red lines alone. The films stand: the default's bytes are the ones pinned (`NOW`) and they are the tables filmed.

## 05:37Z · #318 is open; one more correction (what a tight hue match costs); a what-if for the map lane

- **PR #318** opened against dev at 05:30:00Z from `claude/wind-light-path` (ledger seq 1066; the read-back commitment is seq
  1067, due 2026-10-19). Not merged. The owner had the clip and stills of option 2 at 05:03Z; no verdict on it yet.
- **CORRECTION: "holding dark's hue tight needs the field 4 to 12 L* paler"** (the frontier table above, the first header, ledger
  seq 1063's `why`) was solved against dark's hues as `mirror-model.mjs` read them. Re-solved against dark by the engine's law
  (`--deep --tol 8 --keep 0`, no depth caps, floor 5.2, normal-vision 8.0; two seeds, both feasible): 3 / 6 / 10 / 16 / 21 / 27
  kn over land read L* 74.8 / 71.0 / 64.8 / 64.8 / 64.8 / 60.6 on one level, or 73.5 / 72.6 / 66.9 / 62.2 / 62.2 / 60.1 on two.
  Against what is built (65.2 / 64.9 / 60.1 / 60.1 / 60.1 at 6 to 27 kn): **6 kn is 6 to 7 L* lighter and 16 to 21 kn 2 to 5
  lighter.** An 8-degree match is therefore dearer than 20 at 6 kn and little dearer elsewhere; the header, the README and
  LESSONS L-V52 say so now. What was built and filmed does not move.
- **A what-if, asked by the leading session, NOT built anywhere:** the same 8-degree rows read over light's land with its base
  scaled 0.81 in OKLab lightness (bare land L* 93.4 to 72.6, about the muted sea's 72.4). Ground over that land at 3 / 6 / 10 /
  16 / 21 / 27 / 33 kn: L* 56.8 / 56.0 / 51.5 / 47.8 / 47.8 / 46.2 / 41.0; over the sea 56.6 / 56.1 / 51.7 / 47.9 / 47.8 / 46.0 /
  40.8. **Land and sea become one ground.** Colour-blind over that land 5.07 (21-27 kn, protan; the rows were not re-solved for
  it), over the sea 5.20; hardest edge 6.9 dE00. With the map supplying the depth, a field held to dark's hue within 8 degrees
  would no longer cost the streaks their ground over land: the two lanes want the same change. A scratch read, one pass.

## 05:44Z · A second, independent ramp read of option 2 (the leading session's), and the merge order it recommends

Relayed by the session leading this work (its message, about 05:43Z; its capture, not this session's): the combined local preview
(this branch at `dc1f1881`, the border ink, #315's beach strength), a ramp of its own (wind due north, 2 kn at the view's west edge
to 30 kn at its east, zoom 6), dark | light | beach | light under this change's kill in ONE capture, `mirror-run.js --size 110`,
lift against dark's at the same crop:

| kn | 5 | 9 | 12 | 15 | 18 | 22 | 25 |
|---|---|---|---|---|---|---|---|
| sea, under the kill | 1.04 | 1.03 | 1.06 | 1.09 | 1.04 | 0.98 | 0.96 |
| sea, option 2 | 1.01 | 0.99 | 0.99 | 1.01 | 1.00 | 0.97 | 1.00 |
| land, under the kill | 0.73 | 0.52 | 0.62 | 0.81 | 0.70 | 0.62 | 0.71 |
| land, option 2 | 0.69 | 0.44 | 0.42 | 0.67 | 0.63 | 0.63 | 0.74 |

- **It agrees with this session's ramp read above** (a different fixture and capture): the sea within 3% of dark's lift from 5 to 25
  kn, flatter than before; the land 0.04 to 0.20 lower from 5 to 18 kn and unchanged from 22 kn.
- Its caution, taken: along a ramp the place changes with the speed (its 9 kn land crop sits over the Mississippi valley), so each
  land row is read as one arm against the other at the same crop, never as a curve along speed. That holds for this session's
  table too.
- Its reading of the land, recorded as its own: the land's ground is 25 to 35 L* paler than dark's in every theme, so that part
  of the gap is the map's, not the palette's.
- **Merge order it is recommending to the owner: #316, #315, #318, #317.** If this PR merges after #316 and #315, its ledger lines
  (seq 1063 to 1068 here) are re-appended after dev's head, D-024 and L-V52 to L-V54 stay, and `windDarkWhite.test.js` and the
  ORTHOGONAL list in `windDarkRules.test.js` are merged by hand (both branches' lines kept).

## 13:15Z · Dev brought in (#316 merged ahead); the ledger lines re-appended; the seq numbers above have moved

- #316 (the border ink) merged into dev at 2026-10-12T11:52:11Z as `74417b5a`, on the owner's word to the session leading this
  work (relayed). #318 then read CONFLICTING. `origin/dev` was merged into `claude/wind-light-path` here (the app's sync tool
  stopped at "Committer identity unknown", so the merge was run locally: dev's changes touch no protected path). Conflicts: the
  four records only. `windDarkRules.test.js` (both kills in the ORTHOGONAL list) and the bench's `map-entry.js` merged cleanly.
- **Resolution:** DECISIONS and LESSONS keep dev's entries first (D-023; L-V46 to L-V49 and L-V51), then this branch's (D-024;
  L-V52 to L-V54). STATE: this branch's bullet at the top of Now, then dev's text. The ledger is dev's file through seq 1074,
  with this branch's six lines re-appended after it, each carrying the time it was first written as its `acted_at`.
- **THE SEQ NUMBERS CITED ABOVE IN THIS LOG ARE THE BRANCH'S, BEFORE THIS:** 1063 is now **1075** (decision D-024), 1064 is
  **1076** (flag_flip), 1065 is **1077** (the correction of the sea read), 1066 is **1078** (pr_open #318), 1067 is **1079**
  (the read-back commitment, due 2026-10-19), 1068 is **1080** (the correction of what a tight hue match costs). On dev, seq
  1063 to 1074 are the border-ink branch's lines.
- `pr_merge #316` is NOT written here: the leading session's recommended order puts #315 next, and two branches writing it
  would fork the chain again. If #318 merges before #315, the line is owed by whichever merges after.
- The owner's verdict on the DEPLOYED build (`74417b5a`: #314 and #316, none of the palette changes), relayed by the leading
  session, first-hand to it at 12:28Z: "I just did a visual check for wind on beach and light modes, and I still do not visually
  see the improvements yet.... notate that"; and 12:36Z: "you need to also compare the amount and density of the animations from
  beach and light mode to dark mode. And colors, how slower color wind is more transparent than faster color wind". Nothing of
  #318 is on the site, so this is not a verdict on option 2.

## 13:26Z · A what-if for the leading session (NOT built): light's slow wind as soft as dark's, the ground deepening evenly to 27 kn

Its finding on dev's look (relayed; its ramps, log `2026-10-12-wind-land-depth` on PR #320): light reaches its full depth by 10 kn
and lays its STRONGEST colour in its lightest winds (ground chroma 37 to 40 over the sea from 6 to 10 kn, where dark's is 19 to
23), while dark's picture builds from 3 to about 26 kn with a modest, even chroma. Its question: what does the solver give if
the field's chroma over the sea is held near dark's and the lightness keeps falling to 27 kn instead of reaching its level at 6?

`light-path-solve.mjs` gained two what-if bars for it (off by default): `--csea N --csea-to K` (the field's chroma over the sea
at most N from 3 kn to K) and `--even D` (the 6 to 21 kn stops within D L* of the straight line from 3 to 27 kn). Run with no
depth cap, calm kept, hue within 20 degrees of dark's (the engine's law), one chroma crest, and the FLOOR as the aim:

| held | ground over land at 3 / 6 / 10 / 16 / 21 / 27 kn (L*) | chroma over land | colour-blind floor | normal-vision |
|---|---|---|---|---|
| built (option 2), for reference | 71.9 / 65.2 / 64.9 / 60.1 / 60.1 / 60.1 | 22 / 28 / 30 / 32 / 36 / 43 | 5.13 | 8.0 |
| sea chroma 21 to 12 kn, even fall | 74.0 / 73.8 / 69.8 / 69.6 / 65.9 / 64.3 | 16 / 25 / 25 / 25 / 55 / 51 | 5.72 | 9.8 |
| sea chroma 26 to 27 kn, even fall | 76.2 / 74.8 / 73.6 / 67.0 / 67.0 / 62.0 | 19 / 28 / 31 / 31 / 31 / 33 | 6.0 | 8.0 to 8.8 |
| sea chroma 21 to 27 kn (dark's own level), even fall | 74.1 / 73.8 / 71.0 / 64.7 / 64.6 / 59.5 | 16 / 24 / 25 / 25 / 26 / 26 | 5.5 | 6.9 to 8.1 |

- **No colour-blind pair breaks.** With the ground allowed to be lighter and to keep deepening, the floor RISES (5.5 to 6.0
  against 5.13): the lightness the built tables spend on depth is what separates the bands.
- **The price is depth, and nothing else:** 6 kn sits 8 to 10 L* lighter than built, 10 kn 5 to 9, 16 kn 5 to 10. Over light's
  land as it is, that takes more from the streaks than option 2 does. Over a land at the sea's depth (PR #320's factor) it would not.
- With the chroma held only to 12 kn the solver pays the soft slow colours back with a jump at 21 kn (C* 25 to 55): hold it to
  27 kn or the colour arrives in one step.
- Read at the stops by the solver's own model, two seeds a row; not built, not filmed, not checked by `check.mjs`.

## 14:18Z · Two findings of the leading session that qualify every picture and every ratio in this log (relayed; not re-measured here)

Relayed by the session leading this work (its message, about 14:16Z; its branch `claude/wind-opaque-canvas`, its log
`2026-10-12-wind-canvas-alpha`; D-027 there). Neither is this session's measurement.

1. **The app's light page showed through every streak; the bench drew over black.** The wind left the map canvas see-through
   under the trail composite, `MapPage.js` lays a near-white page behind the map in light (black in dark and beach), and the
   bench saved the bare canvas. So: this log's FIELD numbers for light stand (the multiply pass keeps the canvas opaque), but
   **every picture of light WITH STREAKS here (the stills, the clips, the ramp) is light over a black page: what the app will
   draw once that fix is on dev, not what the deployed app draws today.** In the app today light's streaks are brighter than in
   these pictures.
2. **The mirror probe reads dark's ground 3.4 to 5.5 L* low, and light's true.** Dark's lift was read 8.6 to 12.4 where it is
   5.1 to 8.1 against the field alone. **Every "lift against dark's" in this log is therefore against a bar read too high: the
   ratios understate light.** The comparisons this change rests on are light against light at the same crop (before -> now),
   and those stand in direction and size; the ratios to dark (0.52, 0.56, 0.77 over land at 10 to 16 kn and the rest) do not,
   as absolute numbers.
- Its question to this lane: with every open change in one preview, light's ground chroma over the sea reads 42 at 25.6 kn
  against dark's 27; intended? Answer: it is the solve's one chroma crest (27 kn: C* 42.5 over land, 33.8 over the sea by the
  table), placed where dark's own crest sits and what separates 21-27 and 27-33 kn for red-green viewers (the binding pair,
  5.13). The what-if above shows it is not needed if the ground may be lighter: with the sea's chroma held to 26 all the way to
  27 kn the floor reads 6.0.
- #318 at this time: head `12d8748e`, MERGEABLE, checks clean, dev still at `74417b5a`.

## 14:28Z · A model read for the land lane: this change's rows over a land at PR #320's depth (NOT built, not measured in motion)

Asked by the leading session, because beach's new field (#319) reads 4.69 over its deeper land against the bar of 5.0. The
built tables as they are, the checker's composite and colour-blind models, light's muted land with its lightness scaled 0.81
(the app's own `muteColor`, the factor PR #320 sets for light; bare land L* 93.4 to 72.5):

| | over today's land | over the 0.81 land | over the sea (unchanged) |
|---|---|---|---|
| this change (#318), colour-blind | 5.50 (21-27 kn, protan) | **5.01** (21-27 kn, protan) | 5.13 (21-27 kn, protan) |
| before it, colour-blind | 5.60 (55-63 kn, tritan) | 5.05 (40-47 kn, deutan) | 5.51 (40-47 kn, tritan) |
| this change, normal-vision | 9.6 | 8.2 | 8.0 |

- **Not under the floor, and no margin:** 5.01 on the deep land, with 27-33 kn at 5.04 and the kept 40-47 kn rows at 5.05. The
  rows before this change read 5.05 there too, so the land's depth is what takes the margin, in both.
- Ground this change lays over the 0.81 land at 3 / 6 / 10 / 16 / 21 / 27 / 33 kn: L* 55.5 / 50.1 / 49.9 / 46.1 / 46.1 / 46.1 /
  41.0: the sea's own levels (50.2 / 46.2 from 6 and 16 kn): one ground.
- If #320 and #318 are both on dev, light's rows want re-solving with that land in the loop to get the margin back. Held, at
  the leading session's word, until the owner has seen the canvas fix (#321) and the deep land (#320) in the app.

## 15:13Z · CORRECTION to point 1 of the 14:18Z section: the saved frames were darker than the screen, in every theme (relayed; not re-measured here)

Relayed by the leading session (its message, about 15:10Z), from the independent review of its PR #321. The measurements are
the review's (one scene, the offline basemap), not this session's.

- **What 14:18Z said, and is wrong in:** that this log's pictures of light with streaks are "light over a black page: what the
  app will draw once that fix is on dev". They are not that either.
- **What the review found:** a frame saved from the bare canvas is un-premultiplied by the encoder (clamped at 255) and then
  laid over black. Wherever a channel was brighter than the alpha the wind had left, the saved pixel held min(channel, alpha).
  Under dev's blends: light 21% to 26% of pixels with a clamped channel (a third of the wind-touched ones), 1.7 to 2.0 L*
  darker each on average, up to 13.0 (canvas 239,226,234 saved as 193,193,193); dark 6.1% to 8.6%, 2.0 to 2.8 L*; beach 11.5%
  to 25.6%, 3.1 to 3.6 L*.
- **Checked here, in the code only:** this branch's bench saves through that path. `scripts/wind-bench/page/map-entry.js`
  (`cropShot`, `thumb`) draws the map's canvas into a 2D canvas and calls `toDataURL`, with no page behind it, and
  `mirror-probe.js` reads those frames. So it applies to every frame this log made.
- **What stands:** every number that reads no frame: the field's tables and their on-screen colours by the composite model,
  the checker's lines, the colour-blind and normal-vision distances, the hue order, the hashes, the tests.
- **What does not stand as a number:** every streak lift in this log, in STATE's bullet, in D-024 and in the PR's text (the
  hurricane reads and the ramp reads; the lifts themselves and their ratios to dark's), and every still and clip with streaks
  as a picture of the app. With #321 light's streak cores will be brighter and more coloured than in any sample made here; the
  review puts the samples at "about 2 L* at up to a quarter of the pixels", not to the byte.
- **Before against now, in light:** both arms went through the same clamp, but the clamp depends on the colour under the
  streak, so the two arms were not darkened equally. The DIRECTION does not rest on the frames: the tables put the ground 5.8
  L* lighter at 10 kn and 3.0 lighter at 16 kn, and a white streak lifts less off a lighter ground. The SIZES (0.68 -> 0.52,
  0.78 -> 0.56, 0.90 -> 0.77 over land; the sea's 0.03 to 0.09) are owed a re-read on the corrected bench.
- **The leading session's first re-measure on corrected frames** (its numbers; dev's engine with the fix, the hurricane x 0.4,
  zoom 6, one sea and one land crop; the mean picture minus the same crop drawn with the field alone): dark adds 8.5 L* over
  the sea and 3.3 over land; light on dev's strengths adds 12.3 and 3.8; beach on dev adds 16.3 and 4.1. Dark's marks take a
  pixel BELOW the field at their darkest moment (2.7 L* over the sea, 6.4 over land); light's and beach's never do. Its
  reading: by added light, light is not behind dark anywhere, and dark differs in kind. That is dev's light, not this change's
  rows; it is re-measuring every open change by speed, with and without #320's land.
- **Owed:** this change's streak lift by speed on the corrected bench (the leading session's table, or this session's when
  asked). Nothing was rebuilt or re-measured for this section; the re-solve stays held.
- #318 at this time: head `25db110d` before this commit, MERGEABLE, dev still at `74417b5a`.

## 15:38Z · The corrected read by speed arrived (the leading session's): against dark, this change's streaks are not weaker at any speed read; the "land gap" was the gauge

Relayed by the leading session (its message, 15:36Z). Its measurement on its build, not this session's; nothing was re-run
here. Records of its own: #321's log ("After the independent review"), #320's log (a dated correction), LESSONS L-V73 on #321's
branch.

- **How it read:** its local preview (dev `74417b5a` + #320 + #315 + #318 + #319, on #321's corrected bench); speed ramps, zoom
  6, page and map at 1.5, 110 px crops. "Added" is the mean picture minus the SAME crop drawn with the colour field alone. The
  old probe's lift read dark high and light low at once, so no "x of dark's lift" written before this section stands.
- **Light added by the streaks, light (this change's rows) against dark:**

  | kn | 3.2 | 5.9 | 8.6 | 11.8 | 15.3 | 18.5 | 25.6 | 38.5 |
  |---|---|---|---|---|---|---|---|---|
  | sea, dark adds (L*) | 1.1 | 3.4 | 3.0 | 6.7 | 7.7 | 8.2 | 14.3 | 14.9 |
  | sea, light adds (white 0.55) | 2.6 | 5.1 | 5.0 | 9.7 | 10.9 | 11.3 | 19.0 | 21.9 |
  | sea, light / dark | 2.36 | 1.50 | 1.67 | 1.45 | 1.42 | 1.38 | 1.33 | 1.47 |
  | land with #320, dark adds | 2.3 | 5.0 | 4.4 | 7.9 | 10.4 | 10.8 | 15.2 | 17.5 |
  | land with #320, light adds | 2.8 | 5.1 | 4.7 | 8.1 | 10.6 | 10.9 | 15.6 | 19.9 |
  | land with #320, light / dark | 1.22 | 1.02 | 1.07 | 1.03 | 1.02 | 1.01 | 1.03 | 1.14 |
  | land as on dev (#320 killed, white 1), light / dark | 1.17 | 1.10 | 1.16 | 1.18 | 1.23 | 1.21 | 1.29 | 1.55 |

- **What that does to this log's cost line.** "Streaks over land at 10 to 16 kn: 0.52 / 0.56 / 0.77 of dark's lift" is wrong as
  a reading of the picture. On the pale land with this change's rows light adds 1.16 to 1.23 times what dark adds at 8.6 to
  15.3 kn. The old probe read those same rows 0.15, 0.55, 0.48, 0.55 at 3.2 to 11.8 kn: the gap to dark over land was the
  gauge.
- **Still not read on the corrected bench: before against now in light** (this change's rows against dev's at the same crop).
  The tables put the ground 5.8 L* lighter at 10 kn and 3.0 lighter at 16 kn, so some loss of streak contrast there is still
  expected; its size is unmeasured. Whatever it is, the "now" arm is not behind dark.
- **What the read finds dark has and light lacks** (its numbers; whether this change's rows move either is not measured):
  - Dark's streaks come back to the field between cores: over the sea dark's darkest moment sits 2.3 to 3.9 L* UNDER its field
    to 18.5 kn; light's sits 1.5 to 2.1 under to 8.6 kn, then 1.3, 1.9, 2.5, 9.2, 11.7 OVER it from 11.8 kn up. Light's trails
    linger.
  - A core's height over the field, sea: dark 4.5, 14.7, 14.7, 20.8, 22.2, 22.7, 25.0, 26.0; light 4.5, 14.9, 15.5, 21.9, 22.9,
    23.0, 28.0, 31.4: the cores match dark's to 18.5 kn.
  - Flicker against dark's: sea 0.74 to 0.86; land with #320 0.65 to 0.82.
  - Lossless at 15.3 kn (device resolution): added, dark / light, 7.7 / 10.8 sea and 9.9 / 10.1 land; share of pixel-instants 3
    L* or more over the field 0.58 / 0.75 sea, 0.62 / 0.71 land; line contrast (Weber) 1.82 / 1.70 sea, 2.86 / 1.62 land:
    over land light's line contrast is 0.57 of dark's (light's deep land is still 11 L* lighter than dark's).
- **This change's field as that bench read it** (the field alone, at the eight speeds above): over the sea L* 56.5, 51.8, 51.5,
  50.3, 48.1, 47.4, 47.0, 37.6, never rising. Checked here against `mirror-model.mjs` (run at 15:39Z, light over water, its
  rows read across to those speeds: 55.1, 50.4, 50.2, 48.9, 46.7, 46.2, 46.1, 36.5): the bench reads 0.9 to 1.4 L* above the
  model at every one of the eight speeds, one steady offset and the same shape, the two levels included. Over the deep land
  the bench read 56.3, 52.2, 52.0, 51.9, 48.6, 47.4, 49.5, 38.9: the 25.6 kn crop reads 2.1 L*
  ABOVE the 18.5 kn crop, where the model is flat (46.1 at 16, 21 and 27 kn over a 0.81 land). Crops along a ramp are
  different land, so this is not read as the field rising; it is noted so a later read at ONE crop can settle it.
- **Owed, changed:** the 15:13Z section's "streak lift by speed on the corrected bench" is met against dark by this table.
  Before against now in light stays unread. The re-solve on the deep land stays held, at the leading session's word.
- #318 at this time: head `206661f3` before this commit, MERGEABLE, dev still at `74417b5a`. Not merged.

## 15:58Z · The owner's go-ahead to merge, RELAYED by the leading session; the ramp file trimmed so the merged file fits its 800-line cap

**The go-ahead, as relayed (the leading session's message, about 15:41Z).** The owner's words to IT, first-hand there, 2026-10-12
15:38Z: "merge #321 and #320 and take the re-solved F" and "and merge anything else needed as well". It reads "anything else
needed" as the open changes its re-filmed combined clip showed the owner: #315, #319 and this change (#318).
**This session did not hear those words, and #318 is not named in them: that they cover #318 is the leading session's reading.**
The leading session merges; this session does not.

- **Its order:** #321, #320, #315, #319 (with beach's re-solved F), then #318 last.
- **On its signal** (dev's head once #319 is on it): dev merged into this branch; `WindColorRamp.js`, `windDarkRules.test.js`'s
  ORTHOGONAL list, the `check.mjs` / `mirror-model.mjs` loaders and the four records resolved; dev's ledger taken and this
  branch's lines re-appended after it; the `pr_merge #319` line the next PR owes; then Jest on both trees, the lint and line
  ratchets, the build, and `check.mjs --strict` on the merged tree. The checker there is the authority for light's
  colour-blind line over #320's land (this log's model read 5.01, 14:28Z). **If it prints under 5.0: stop and say so; no row
  is adjusted without showing the owner.**

**The line cap, found by a dry run before the signal.** `WindColorRamp.js` is not in the line ratchet's baseline, so it may never
pass 800 lines. Single-file three-way merges in a scratch folder (dev `74417b5a` as the base; #320 at `ccd23463`, #319 at
`0ed6694f`): dev 767 lines; this branch 792 (+25); #320 +2; #319 +14: **808 once resolved.** It would not have fitted.

- **The trim (this branch only; nothing drawn changes):** the path's built-once tables moved to `windLightPath.js`
  (`lightTables(onPath, field, marks)`; the two base tables are passed in, so the module still imports nothing); two doc
  comments in the ramp file shortened to pointers, their reasons moved to `windLightPath.js`'s "Kill" paragraph.
  `WindColorRamp.js` 792 -> 780 lines; `windLightPath.js` 86 -> 107. `var SOLVED = {};` is dev's line again, so one conflict
  with #319 is gone. `check.mjs` and `mirror-model.mjs` hand the ramp source `lightTables` where they handed `lightPathRows`.
- **Expected size after the merges:** 780 + 2 + 14 = 796. #319's count is its head today; its form with the re-solved F may differ.
- **Checked after the trim:** Jest on both trees 307 suites, 4,169 tests, 0 failed (one new test, `lightTables`; the first
  version of that test was wrong, it expected the built-once tables to be rebuilt from toy inputs, and was corrected); the
  byte pins of the default and of the kill unchanged and green; `check.mjs --strict`: light's lines as before (tint 5.1 over the
  sea and 5.5 over land, legend 11.7 and 5.4 colour-blind), exit 1 for beach's two red lines alone, as on dev;
  `mirror-model.mjs` runs through its changed loader; `check_eslint.js` exit 0; `loc_ratchet.py` New 0, Regressed 0; the
  production build exit 0.
- **Not checked:** the two loaders' output against the previous output byte for byte (the Jest byte pins and the checker's
  unchanged lines stand in for it). Nothing of this build has been seen in the app by this session.
- #318 at this time: head `05100f28` before this commit, MERGEABLE, dev still at `74417b5a`. Not merged.
- **Correction, 16:02Z, to the line above:** it was a stale read given as a current one. This session had last fetched at
  15:43Z, and dev moved to `720b3980` at 15:47:43Z when #321 was merged. Read at 16:01Z: #321 MERGED; #318 (head `ade024d5`)
  CONFLICTING against dev, as expected (the four records, `windDarkRules.test.js`, the bench's `page/map-entry.js`); #315 and
  #319 CONFLICTING; #320 MERGEABLE. Dev is brought into this branch once, at the leading session's signal after #319, so this
  branch's ledger lines are re-appended once and not after each of the four merges. The gates in this section were run on the
  tree with dev `74417b5a` merged in.

## 17:20Z · A TRIAL merge of dev (#321, #320, #315) into this branch, local only: light's colour-blind line over #320's land reads 5.006

Asked by the leading session (its message, 17:05Z): work the rebase out on a trial so the real one is minutes, and say what the
checker prints for light on a tree that holds #320. Local branch `scratch/light-path-trial` (`453a5a42` = this branch `576ed6f4`
+ dev `89f0dc33`), never pushed. Nothing on this branch or on the PR moved.

- **The reading the trial was for.** `node check.mjs --strict` on the trial tree, light: no red line. Colour-blind, the weakest
  neighbouring tints, unrounded (coloraide in the checker's own `.venv`, the checker's JSON):

  | light, on the trial tree | over the sea | over the land |
  |---|---|---|
  | as it will draw (this change + #320's land) | 5.130 (21-27 kn, protan) | **5.006** (21-27 kn, protan); then 5.039 (27-33 kn), 5.053 (40-47 kn) |
  | under this change's kill (`--before-path`) | 5.511 (40-47 kn, tritan) | 5.053 (40-47 kn, deutan) |
  | under #320's kill (`--before-depth`) | 5.130 | 5.503 (21-27 kn, protan) |

  **Not under the floor of 5.0, and no margin: 0.006.** The checker prints "5.0" and "[ ok ]" (it gates on the unrounded value).
  This session's model said 5.01 (14:28Z). Dev without this change reads 5.053 there, so the deep land takes most of the
  margin (5.50 to 5.05) and this change the rest (5.05 to 5.01). The legend's lines are unchanged (11.7; 5.4 colour-blind).
  `--strict` exits 1 for beach's two red lines alone, dev's own (3.1 over the sea, 2.9 over the land).
- **No test in CI holds this line on the deep land.** This change's own floor tests score the land as the mute alone leaves
  it (they pass at 5.4 and above), and `windLandDepth.test.js` scores no colour-blind distance. Only the checker reads it. Not
  fixed here; listed for the leading session.
- **What the trial needed, file by file** (scripts kept in this session's scratch folder for the real merge):
  - `WindColorRamp.js`: both imports; dev's `setWindLandDepthGate(...)` line after `windWhiteStrength`, then `windLightPathOn`.
    782 lines with #320 (the cap is 800; #319 adds 14 at its head today).
  - `windDarkRules.test.js`: the ORTHOGONAL list holds dev's `__RAW_DISABLE_WIND_LAND_DEPTH__` and this change's kill.
  - `check.mjs`, `mirror-model.mjs`: dev's loader (the basemap mute first, `windLandWhite` and `setWindLandDepthGate` handed
    to the ramp source, `--before-depth`, `--land-l`) with `LIGHT_PATH` and `lightTables` handed in too, `resolveLegendRamp`
    handed out, and `--before-path` beside `--before-depth`.
  - `windLightPath.test.js`: ONE test failed on the merged tree and was re-pinned there: it pinned the engine's source line
    `else gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); // field tint: multiply`, which #321 rewrote as
    `else blendIntoMap(gl, gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); ...`. Read in `windCanvasAlpha.js`: `blendIntoMap` hands the
    colour's two factors through in both of its arms and keeps only the canvas's own alpha, so dark's field still lands at
    alpha squared. The re-pin also pins those two lines of `windCanvasAlpha.js`.
  - The bench's `page/map-entry.js`, the README and `windDarkWhite.test.js` merged with no conflict.
  - The records: D-024 before dev's D-026 and D-027; L-V52 to L-V54 between dev's L-V50 and L-V60; STATE's Now bullets with
    dev's newer ones first; dev's ledger taken and this branch's seven lines re-appended after its head (seq 1075-1081 became
    1099-1105 on the trial; they will move again once #319 is on dev).
- **Gates on the trial tree:** Jest on both trees 311 suites, 4,349 tests, 0 failed (after the re-pin; 1 failed before it);
  `check_eslint.js` exit 0; `loc_ratchet.py` New 0, Regressed 0; the production build exit 0; `action_ledger.py verify` OK
  (1105 entries); `memory_audit.py --docs-only` 0 FAIL; `mirror-model.mjs` runs with `--before-path` and `--before-depth`.
- **Left for the real merge** (after #319 is on dev, at the leading session's signal): #319's edits to `WindColorRamp.js`
  and to the two loaders; the `pr_merge #319` line; STATE's ledger head and the seq numbers cited in STATE (the read-back
  commitment); the same gates and the same checker read again, on that tree.
- **Not checked:** nothing was seen in the app; the trial's bench was not run (no frame was made).

## 17:38Z · A second TRIAL, on the tree dev will be after #319: every gate green and the checker prints no red line; AS UPLOADED, light's line over the deeper land is under 5.0 at about half of the engine's maxima

Asked by the leading session (17:21Z): the beach branch at `9100ec95` is the tree dev will be once #319 is squashed. Local
branch `scratch/light-path-trial2` (`949b2c6e` = this branch `e77d35f9` + `9100ec95`), never pushed. Nothing on this branch or on
the PR moved but this section.

**Gates on that tree.** Jest on both trees 312 suites, 4,378 tests, 0 failed. `check_eslint.js` exit 0. `loc_ratchet.py` New 0,
Regressed 0 (`WindColorRamp.js` 796 of 800 lines). The production build exit 0. `action_ledger.py verify` OK (this branch's seven
lines re-appended as 1109 to 1115 there). `memory_audit.py --docs-only` 0 FAIL. `mirror-model.mjs` runs, with `--before-path` too.

**The checker (`node check.mjs --strict`): exit 0, no red line in any theme.** Light's colour-blind lines, unrounded: the legend
5.4; **over the sea 5.130** (21-27 kn, protan; printed 5.1); **over the land 5.006** (21-27 kn, protan; printed 5.0). The same
as the first trial. Beach's on that tree: 5.048 over the sea, 5.021 over the land.

**AS UPLOADED (not what the checker reads).** The beach lane read its own line from the texture the engine uploads (256
entries, 8 bits a channel) and found it under the bar where its table passes (its commit `732d6ebe`). Light has 0.006 of margin
on the deeper land, so the same read was made for light, by the beach lane's method: a stop at `kn` is read at
`kn / max x 255`, linear between two texels of `generateRampData(max, ...)`; the checker's composite and grounds; the
colour-blind distance of `light-path-lib.mjs`. The engine's maximum is the data's own, held between 10 and 80 kn
(`WebGLWindEngine.js`), so maxima from 10 to 80 kn were swept every quarter knot (281 of them); a pair wholly above the maximum
is not drawn and not scored. Control: read from the TABLE the same script prints the checker's own numbers (5.006, 5.503,
5.130; under this change's kill 5.053, 5.603, 5.511).

| light, weakest neighbouring tints, colour-blind | the table | uploaded, 50 kn max | uploaded, 75 kn max | uploaded, the least | maxima under 5.0 |
|---|---|---|---|---|---|
| **as it will draw, over the deeper land** | 5.006 | 5.033 | **4.987** | **4.859** (27-33 kn, deutan; 72.75 kn max) | **151 of 281** |
| as it will draw, over the sea | 5.130 | 5.126 | 5.102 | 4.960 (27-33 kn, deutan; 72.75 kn max) | 12 of 281 |
| as it will draw, over the land before #320 (its kill) | 5.503 | 5.546 | 5.482 | 5.364 | 0 |
| under this change's kill, over the deeper land (dev's light) | 5.053 | 5.033 | 5.074 | 4.928 (40-47 kn, deutan; 74.25 kn max) | 21 of 281 |
| under this change's kill, over the sea | 5.511 | 5.449 | 5.282 | 5.243 | 0 |

- **Read plainly:** by the checker light holds 5.0. As uploaded, on the deeper land, it is under 5.0 at about half of the
  maxima the engine can pick, by up to 0.14. Dev's own light on that land is already under at 21 of 281 maxima (by up to
  0.07): #320's land takes the margin and this change takes what is left. On the land before #320 neither is ever under.
- **What the read is not:** the shader's own sampling may sit half a texel from this model's, and the framebuffer rounds to 8
  bits again; neither is modelled. It is the beach lane's model, applied to light, with a control.
- **This is the owner's to decide, and the leading session has it before the merge** (the brief: never a lower floor
  quietly). Two ways: merge this change as it was shown, with this stated and pinned in a test, and re-solve light's rows on
  the deeper land next (already planned, 14:28Z; the kill restores dev's light at once); or hold this change until that
  re-solve is done and shown. No row was changed here.

**What this merge needed beyond the first trial's** (one script now does every code file from scratch, `res_code2.py` in this
session's scratch folder):
- **Two names both lanes took.** `--before-path` (`check.mjs`, `mirror-model.mjs`) and the bench's `before-path` variant
  (`matrix.js`) were light's kill here and beach's kill there. Merged, each means "each theme before ITS path": both kills
  are set, and each is read by its own theme only. Each lane's test of the variant now asks that it CONTAINS its kill.
- **Six tests failed before the re-pins, in three suites, for one reason.** Each lane's tests pinned "the other theme is not
  touched" to the other theme's bytes and look key from BEFORE the other lane's path. Re-pinned so each still proves its point:
  the other theme, read under its own path's kill, draws the bytes pinned, and this lane's kill does not move it (two tests
  in `windLightPath.test.js`, two in the beach lane's `windBeachPath.test.js`). `windWhiteStreak.test.js` and
  `windDarkWhite.test.js` were re-pinned by both lanes with different helpers; merged on one, `B4` (each theme before its
  path), with beach's default bytes kept from the beach lane and light's default still pinned in `windLightPath.test.js`.
- `WindColorRamp.js`: the three imports; the look key names the path where either theme's is on.
- The records: D-024, then D-025 to D-027; L-V52 to L-V54 before L-V60; the ledger after the beach branch's head (1108).
- The beach branch moved to `732d6ebe` while this ran (its as-uploaded pins); the three lines of its test that this merge
  re-pins are still there.
- **Not checked:** nothing seen in the app; no frame made; the as-uploaded read is a model, not a read of the canvas.

## 17:45Z · The owner's choice, first-hand: "option 1, merge as shown and add the pin"

- **Asked** (this session's message, 17:40Z): by the checker light holds 5.0 over the deeper land (5.006); read from the
  texture the engine uploads it is under 5.0 at about half of the engine's maxima, by up to 0.14. Two ways were put: (1)
  merge #318 as it was shown, with this stated and pinned in a test, and re-solve light's rows on the deeper land next; (2)
  hold #318 until that re-solve is done and shown. This session recommended the first.
- **The owner, 2026-10-12 17:43Z, in this session's chat:** "option 1, merge as shown and add the pin".
- **What that settles:** #318 merges with the rows that were filmed; light's as-uploaded line is pinned in
  `windLightPath.test.js` on the merged tree (the pin needs #320's land, which this branch does not hold until dev is brought
  in); light's rows are re-solved on the deeper land next, and shown before they replace these.
- **What it does not change:** who merges and when. The leading session merges #318, last of the queue, once #319 is on dev,
  this branch has dev in it and hosted CI is green (its plan, 15:41Z and 17:21Z). This session does not merge.
- **Recorded:** DECISIONS D-024 (amended), STATE, the ledger (a decision and a commitment for the re-solve).
- At this time: #319 OPEN and MERGEABLE (head `732d6ebe`), dev at `89f0dc33`, #318 at `81d941a3` before this commit.

## 17:55Z · Dev brought in for the merge (#321, #320, #315 and #319 are on it); the as-uploaded pin added; the seq numbers above have moved again

- **Why now.** #319 was merged at 2026-10-12T17:46:09Z (dev `11fb734d`; `git diff origin/dev origin/claude/wind-beach-path` is
  empty: dev's tree is the beach branch's head `732d6ebe`). That is the tree the second trial ran on, one beach commit later.
  The leading session's signal had not arrived as a message; this session read #319's merge from GitHub and went on, on the
  owner's first-hand word of 17:43Z. This session does not merge #318.
- **The merge:** `git merge origin/dev` (local; no protected path), resolved by the scripts the two trials left, with nothing
  resolved by hand: the same 11 conflicted files and the same resolutions as the second trial (17:38Z).
- **The pin (the owner: "add the pin").** One test in `windLightPath.test.js`, "ON THE DEEPER LAND (PR #320) THERE IS NO MARGIN,
  and AS UPLOADED the line dips UNDER 5". It holds: the table's line on the deeper land at 5.0 or above and 5.006; as uploaded
  5.033 at a 50 kn maximum and 4.987 at 75 kn; over the 281 maxima from 10 to 80 kn the least 4.859, under 5.0 at 151; the sea
  4.960 and 12; and two controls: under this change's kill on the same land 5.053, 4.928 and 21, and on the land before #320
  5.364 and never under. The test's own colour code and the standalone script (`light-path-lib.mjs`) are two implementations;
  they agree on all twelve numbers at first run. Mutation: one channel of the 21 kn row moved 0.01 turns it red (the table's
  line reads 4.9925). The floor test above it now says in its title which land it scores (the land before #320).
- **The records:** D-024 before D-025 to D-027; L-V52 to L-V54 before L-V60; STATE (#319 MERGED; this branch's base; the
  ledger head). **The ledger: dev's file taken; this branch's nine lines re-appended after its head (1109) as seq 1110 to 1118,
  each with its first time as `acted_at`; then `pr_merge #319` as seq 1119.** Where this log says seq 1075 to 1083, read 1110
  to 1118: the decision is 1110, the read-back commitment 1114, the owner's choice of 17:43Z 1117, the re-solve commitment 1118.
- **README (`scripts/wind-color`):** `--before-path` now sets both paths' kills (each theme reads its own); a paragraph on
  light's line on the deeper land, by the table and as uploaded.
- **Gates on the merged tree:** Jest on both trees 312 suites, 4,380 tests, 0 failed. `check_eslint.js` exit 0.
  `loc_ratchet.py` New 0, Regressed 0 (`WindColorRamp.js` 796 of 800 lines). The production build exit 0.
  `node check.mjs --strict` exit 0, no red line in any theme: light's legend 5.4, over the sea 5.1 (5.130), over the land 5.0
  (5.006); `--strict --before-path` exits 1 for beach's two red lines alone (3.1 and 2.9), as before either path.
  `action_ledger.py verify` OK (1119 entries). `memory_audit.py --docs-only` 0 FAIL.
- **Not verified:** nothing of this build has been seen in the app by this session; the as-uploaded numbers are a model with a
  control, not a read of the canvas; hosted CI had not run on this head when this was written.

## 21:39Z · The re-solve on the deeper land: THE MARGIN, a candidate behind a lever on a LOCAL branch (nothing pushed; the owner has not seen it)

**Why now.** #318 merged at 18:17:56Z (dev `b764797b`); `pr_merge #318` is on dev as seq 1120 (carried by #322). The leading
session, 20:58Z: the hold on this re-solve is lifted (the land's depth stands, D-026), and it is this session's; the owner to
it, 20:54Z, relayed: "merge #323 and build the tail, also make sure the other sub agents are getting what they need to do done
so we can get this working". The owner's own word for the re-solve is the first-hand choice of 17:43Z above (option 1). The
proposal card this session left for a fresh session was withdrawn: the work is done here.

**The bar, restated by the leading session: AS DRAWN, not the table.** The GPU reads the 256-texel texture at position
256 t - 0.5 (the beach lane read the law back from a GPU: `lut-lookup-gpu.cjs`, LESSONS L-V69), and
`check.mjs --as-uploaded 10-80:0.25` is that read. Reproduced first, on dev `a022b398`: light 4.85 over the land (27-33 kn,
deutan, at a 72.75 kn maximum; under 5.0 at 123 of 281 maxima) and 4.93 over the sea (3-6 kn, protan, at 79 kn; 32 of 281).
**The pin this session added at 17:55Z read the texture at the table's own index (4.859, 151 of 281): that lookup is not the
GPU's, and the pin now reads by the GPU's (4.847, 123; the sea 4.934, 32; dev's light before #318 4.962 and 8).**

**The solve** (`scripts/wind-color/light-margin-solve.mjs`, new). A step in CIELAB on screen at each Beaufort stop from 3 to 63
kn, blended along speed, rows written at 3 decimals; every bar of #318 held hard and printed on the candidate's own rows; each
pair's target on the table is the floor plus what the 8-bit rounding takes from that pair on dev's rows (0.06 to 0.26); after
each solve the candidate is read as drawn at all 281 maxima and the target of any pair still short is raised. Floor asked: 5.03
as drawn (room for the one rounding not modelled, the framebuffer's).

| aim | runs | largest move a knot (dE00) | total move | as drawn, land / sea (least) | bars of #318 |
|---|---|---|---|---|---|
| least largest move (no cap) | 3 seeds | 0.46 to 0.53 | 8.9 to 11.3 | 5.04 to 5.12 / 5.05 to 5.19 | held |
| least TOTAL move (no cap) | 3 seeds | 0.42 to 0.53 (at 47 or 63 kn) | 3.5 to 4.1 | 5.05 to 5.08 / 5.05 to 5.08 | held |
| least total, capped at 0.30 | 2 seeds | 0.22, 0.26 | 3.4, 3.6 | 5.06 / 5.05, 5.07 | held |
| **least total, capped at 0.25** | 2 seeds | **0.18**, 0.24 | **3.16**, 3.75 | **5.053 / 5.057**; 5.08 / 5.06 | held |
| least total, capped at 0.20 | 2 seeds | 0.20, 0.19 | 3.4, 3.5 | 5.04 / 5.05, 5.07 | held |
| capped at 0.15, 0.12, 0.10 | 2 seeds each, stopped after 4 rounds | 0.11 to 0.15 | 2.5 to 3.4 | not held | **short of the floor, or outside a bar** |

- **What the cap buys:** with no cap the least-total solves put 0.42 to 0.53 dE00 on one row; capped at 0.25 the largest move is
  0.18 and the total is no higher (3.16). The "least largest move" aim did worse on both counts than the capped least-total
  aim: a search result, not a property of the problem. Under about 0.15 a solve can only reach the floor by leaving one of
  #318's bars, so it does not (L-V69, rule 3).
- **Taken as the candidate:** capped at 0.25, seed 1.

**The candidate, read by two instruments** (the solver's audit of the BUILT rows, and `check.mjs --light-path margin
--as-uploaded 10-80:0.25`; they agree):

| light, colour-blind, weakest neighbours | table | as drawn, the least (where) | as drawn, 50 kn max | maxima under 5.0 |
|---|---|---|---|---|
| dev, over the deeper land | 5.006 | 4.847 (27-33 kn at 72.75 kn) | 5.077 | 123 of 281 |
| dev, over the sea | 5.130 | 4.934 (3-6 kn at 79 kn) | 5.090 | 32 of 281 |
| **the margin, over the deeper land** | 5.195 | **5.053** (40-47 kn at 78.75 kn) | 5.193 | **0** |
| **the margin, over the sea** | 5.181 | **5.057** (3-6 kn at 78.5 kn) | 5.173 | **0** |
| the margin, over the land before #320 | 5.625 | 5.475 | 5.599 | 0 |

- **The move:** the largest 0.182 dE00, at 21 kn; total 3.16 over 37 rows. At 6, 10, 16, 21, 27, 33, 40, 55 kn: 0.08, 0.05, 0.08,
  0.18, 0.16, 0.12, 0.06, 0.05. Nothing moves at calm or at 75 kn. A step of 0.18 dE00 is not one the eye finds side by side.
- **Every bar of #318, re-read on the candidate's rows** (dev's value in brackets): hue turns back 0 times (0); hue within 19.93
  degrees of dark's at the stops 3 to 21 kn (19.93; bar 20.2); lightness rises at most 0.05 L* from calm to 33 kn (0.02; the
  bar is 0.05, so this one is AT its bar); hardest edge 7.84 dE00 a knot (7.85; dark's 8.9); upper level L* 65.00 to 65.24
  (64.94 to 65.18); lower level 60.02 to 60.24 (60.06 to 60.10: its spread grew from 0.04 to 0.22, inside 59.9 to 60.3);
  weakest normal-vision neighbours 8.17 (8.00); weakest colour C* 16.7 (17.0); the legend bar, NOT moved, within 16.95 degrees
  of the field (16.87; the checker's bar is 30); each streak's colour core, NOT moved, within 1.05 degrees of the field's hue
  (0.79; bar 3).
- **Rows from 33 kn move too** (33, 40, 47, 55, 63 kn, which #318 kept): the weakest pairs over the deeper land include 27-33
  and 40-47 kn, and 40-47 was already under 5.0 as drawn before #318 (8 of 281 maxima).

**Built** (local branch `claude/wind-light-path-margin` from dev `a022b398`; NOT pushed, no PR): `LIGHT_MARGIN` and
`lightPathOption` in `windLightPath.js`; three lines changed in place in `WindColorRamp.js` (796 lines, as on dev). **Lever:
`window.__RAW_WIND_LIGHT_PATH__ = 'margin'`, DEFAULT OFF** (unset, or any other value, draws #318's rows byte for byte); read
only where the path is on, so every kill and lever that stands the path down stands it down; the look key reads
`white+path-margin|dark-rules`, so the engine rebuilds at once. Field hashes with the lever: `de27184f` at a 50 kn maximum,
`eebfc1a0` at 75 kn (default: `7c17c193`, `be9bf367`); the streak rows are the default's (`b9cf6f25`, `ad6b7fa5`). The bench's
variant is `light-margin`.

**Tests** (`windLightPath.test.js`, 118 tests, was 68): default off; one visual variable (only the field's bytes move); the
look key; the span; the stand-down sweep (the path's kill and 38 lever sets: the lever changes nothing under any); beach and
dark do not read it; the engine's own call shape on the real window; as drawn 5.0 or more at all 281 maxima over land and
sea (with dev's rows as the control: 123 and 32 under); the move under 0.2 dE00; every bar re-read; the streak row and the
legend bar still fit. **Mutation: 5 of 5 red** (the lever on by default 13 tests; the key not naming it 2; the margin drawn
under the path's kill 3; one row moved by 0.004 5; the streak row moved 2).

**Gates on the local branch:** Jest on both trees 312 suites, 4,432 tests, 0 failed; `check_eslint.js` exit 0; `loc_ratchet.py`
New 0, Regressed 0; the production build exit 0; `check.mjs --strict` exit 0 with no lever (as on dev); `check.mjs --strict
--light-path margin --as-uploaded 10-80:0.25` exits 1 for DARK's own line alone (4.97 at one maximum of 281, as on dev):
light and beach read no red line there.

**Not done, on purpose:** no PR, no push, no ledger line (nothing on dev or in the app changed; commitment seq 1118 stays open
until the owner has seen it and it is built as the default or dropped). DECISIONS D-030 is kept for the owner's decision on
it. The leading session films it beside dev and dark on the corrected bench and shows the owner.

**Not verified:** nothing seen in the app or on a real canvas; the as-drawn read does not model the framebuffer's own
rounding; phones not measured; no independent review of this diff yet (owed before any PR).

## 21:50Z · The candidate on TWO lands: it holds as drawn over the land at 0.81 and at 0.90; the branch rebased onto dev `e89aaa85`

**Asked by the leading session (its note of 21:43Z, written before this session's table reached it).** The owner to it, 21:13Z,
relayed: "if the coastline fix is live on dev, then it needs to be checked at all zooms, because I don't see the fix at higher
out zooms, cannot see the land below the wind animations in beach or light modes well" and "make sure your sub agents are on
the same page here, so we're not just lapping work over work". The map lane (the leading session's own, `windBasemapMute.js`)
is trying the land at the sea's own factor, lightness x 0.90 in light in place of 0.81. So: hold 5.0 as drawn over the sea,
over today's land AND over the lighter land, and pin no number that is true of one default land only.

| light, colour-blind, weakest neighbours, AS DRAWN (281 maxima) | the path as merged | the margin |
|---|---|---|
| over the sea | 4.934, under 5.0 at 32 | **5.057**, never under |
| over the land at 0.81 (today's default) | 4.847, under at 123 | **5.053**, never under |
| over the land at 0.90 (`--land-l 0.90`) | 5.177, never under | **5.288**, never under |
| over the land before #320 (1.0) | 5.330, never under | 5.475, never under |

- **Today's land is the binding one**, as the leading session expected from beach: a lighter land has more room. On the table
  the margin reads 5.195 (0.81), 5.431 (0.90), 5.625 (1.0); the sea 5.181.
- **A lighter land does not make the margin unnecessary:** at 0.90 the path as merged holds over the land, and is still short
  over the SEA (4.934, 32 maxima). The margin is what lifts the sea.
- **The tests name their land.** Every as-drawn number in `windLightPath.test.js` is now read on a land set through its lever
  (`__RAW_WIND_BASEMAP_LAND_L__` 0.81 or 0.90, or #320's kill), never on "whatever draws by default"; one test added for the
  0.90 land (119 tests in the file). The move's cap is read over both lands and the sea.
- **Rebased** (a local, unpushed branch) onto dev `e89aaa85` (#323, the coast in the borders' ink; it touches none of this
  change's files). Gates there: Jest on both trees 313 suites, 4,454 tests, 0 failed; `check_eslint.js` exit 0;
  `loc_ratchet.py` New 0, Regressed 0. The checker's reads above are `check.mjs --theme light [--light-path margin]
  [--land-l 0.90] --as-uploaded 10-80:0.25`.
- Still local, default off, not pushed, no PR; the owner has not seen it.

## 22:12Z · The target narrowed to the SEA (the leading session's note 3): the margin re-solved, a smaller move (0.11 dE00)

**What changed** (its note, 21:53Z): the map lane built the land a step above the sea (lightness x 0.90 in light, in place of
0.81; its local branch `claude/wind-map-far-zoom` `5e8cba72`, kill `window.__RAW_DISABLE_WIND_LAND_STEP__`, an amendment of
D-026, not on dev yet). On that land light's line holds without help (5.18 as drawn), so the re-solve is for the SEA: hold 5.0
as drawn over the sea by the smallest move, show the land's line stays at or above 5.0 on the land at 0.90, and REPORT the
land at 0.81 (now a kill's picture) without solving for it.

**The solve** (`light-margin-solve.mjs --solve --land-l 0.90 --sum --maxmove C --floor 5.03`; the solver gained `--land-l`,
which names the land through the app's own lever, and prints the line over every land it was not asked to hold):

| cap on the largest move | seeds | largest move (dE00) | total | as drawn, sea / land at 0.90 | the bars of #318 |
|---|---|---|---|---|---|
| 0.25 | 2 | 0.21, 0.12 | 2.6, 2.0 | 5.06 / 5.21; 5.04 / 5.21 | held |
| **0.15** | 2 | 0.13, **0.11** | 2.3, **2.07** | 5.06 / 5.25; **5.034 / 5.204** | held |
| 0.10 | 2, stopped after 3 rounds | 0.09, 0.10 | 2.1, 2.2 | 5.03 / 5.20 (5.0 held, the table's targets not) | held |
| 0.07 | 2, stopped | 0.10 | 2.0, 2.3 | | **outside a bar** |

**Taken: capped at 0.15, seed 2.** Read by the solver's audit of the BUILT rows and by `check.mjs --theme light --light-path
margin --land-l X --as-uploaded 10-80:0.25`:

| light, colour-blind, weakest neighbours | table | as drawn, the least (where) | 50 kn max | maxima under 5.0 |
|---|---|---|---|---|
| dev, the sea | 5.130 | 4.934 (3-6 kn at 79 kn) | 5.090 | 32 of 281 |
| dev, the land at 0.90 | 5.275 | 5.177 | 5.356 | 0 |
| **the margin, the sea** | 5.159 | **5.034** (27-33 kn at 68.5 kn) | 5.130 | **0** |
| **the margin, the land at 0.90** | 5.303 | **5.204** (21-27 kn at 45.75 kn) | 5.357 | **0** |
| the margin, the land at 0.81 (a kill's picture; NOT solved for) | 5.035 | 4.935 | | 68 of 281 (dev: 4.847, 123) |
| the margin, the land before #320 | 5.534 | 5.430 | | 0 |

- **The move:** the largest 0.112 dE00, at 10 kn; total 2.07 over 37 rows (the first candidate: 0.182 and 3.16). At 6, 10, 16, 21,
  27, 33, 40, 55 kn: 0.09, 0.11, 0.02, 0.07, 0.06, 0.09, 0.06, 0.07.
- **Every bar of #318, re-read on these rows** (dev in brackets): hue turns back 0 times (0); within 19.95 degrees of dark's at
  the stops 3 to 21 kn (19.93; bar 20.2); lightness rises at most 0.05 L* (0.02; AT its bar of 0.05); hardest edge 7.85 dE00
  (7.85); upper level L* 65.05 to 65.19 (64.94 to 65.18); lower level 60.03 to 60.12 (60.06 to 60.10); weakest normal-vision
  neighbours 8.05 (8.00); the legend bar, not moved, within 17.01 degrees of the field (16.87; the test's bar 18, the
  checker's 30); each streak's colour core, not moved, within 0.88 degrees of the field's hue (0.79; bar 3).
- **Built:** the same lever (`window.__RAW_WIND_LIGHT_PATH__ = 'margin'`), `LIGHT_MARGIN` replaced. Field hashes `df782223` at a
  50 kn maximum and `3c00deb3` at 75 kn (the first candidate's were `de27184f`, `eebfc1a0`; the default's `7c17c193`,
  `be9bf367`). The first candidate's rows are in this branch's history (`7073a90a`): it also held the land at 0.81 (5.05), for
  a largest move of 0.18.
- **Tests:** the margin's as-drawn tests now hold the sea and the land at 0.90 as bars and pin the land at 0.81 and the land
  before #320 as READINGS; the move's cap is 0.12 over both lands and the sea; 118 tests in the file. Mutation: 5 of 5 red.
- **Gates on the local branch** (dev `e89aaa85` + this change): Jest on both trees 313 suites, 4,453 tests, 0 failed;
  `check_eslint.js` exit 0; `loc_ratchet.py` New 0, Regressed 0; the production build exit 0.
- **A read thrown away:** while the mutation run was rewriting `windLightPath.js` in the background, a checker read taken at
  the same moment printed 4.99 for the sea. It had read a mutant's rows. Read again once the run had finished and restored
  the file; the numbers above are from that read and from the solver's audit before the run. An instrument must not be run
  while a mutation run holds the sources.
- **When the map lane's land step is on dev:** this branch is rebased onto it (it edits the same describe of
  `windLightPath.test.js`: its `DEEPER` constant and its new test are kept, this change's reads through the GPU's lookup stay).
- Still local, default off, not pushed, no PR; the owner has not seen it.

## 2026-10-13 01:48Z · The margin made what light draws BY DEFAULT, under the path's own kill; a draft PR (no ledger lines yet)

**Why.** The leading session, 01:21Z: the owner asked for this change to be merged. The owner to it, first-hand there, 2026-10-13
01:19Z, relayed: "run the bench at phone size and pixel ratio, and also merge 325, 316. And the small colour-blind tweak to
lights colors" (it had described this change to them as "a small colour-blind tweak to light's colours that you haven't
seen"); and, 01:09Z, on the dev site with everything on: "Ok I like this". The owner's own word for the re-solve is the choice
of 2026-10-12 17:43Z above. **The owner has not seen this change moving**: it was put to them as a number, because it is a
move no eye finds side by side.

**What was built** (branch `claude/wind-light-path-margin`, cut fresh from dev `f6310516`, which holds #324 the trails' veil,
#325 the land a step above the sea and #326 near-calm air; the lever build of the three sections above is kept on the local
branch `claude/wind-light-path-margin-lever`):
- **ON by default, one kill.** `LIGHT_PATH.field` in `windLightPath.js` IS the margin's rows now and owns 1 to 63 kn
  (`fieldTo`; 37 rows: the path's 32 and the rows it first kept at 33, 40, 47, 55, 63 kn). No lever and no second kill, as
  beach's margin (PR #322): `window.__RAW_DISABLE_WIND_LIGHT_PATH__ = true` restores light before the path, byte for byte, as
  it did. `WindColorRamp.js`, `check.mjs` and `mirror-model.mjs` are not changed. The rows PR #318 merged are kept as
  `scripts/wind-color/light-path-318.json` (the solver's reference and the tests' control; its texture bytes are pinned).
- **The same rows as the lever build's** (22:13Z): field hashes `df782223` at a 50 kn maximum, `3c00deb3` at 75 kn.
- **Dev had not moved under it:** on `f6310516` the checker reads light exactly as on `e89aaa85` (the table below, "before").

**The numbers** (`node check.mjs --theme light [--before-step] --as-uploaded 10-80:0.25`; 281 maxima; "as drawn" is the least):

| light, colour-blind, weakest neighbouring Beaufort stops | table, before -> after | as drawn, before -> after | maxima under 5.0, before -> after |
|---|---|---|---|
| over the sea | 5.130 -> 5.159 | **4.934 -> 5.034** | **32 -> 0** |
| over the land as it draws (a step above the sea, x 0.90) | 5.275 -> 5.303 | 5.177 -> 5.204 | 0 -> 0 |
| `--before-step`: over the land at the sea's depth (x 0.81) | 5.006 -> 5.035 | 4.847 -> 4.935 | 123 -> 68 (a kill's picture; not solved for) |

- `check.mjs --strict` exit 0. `check.mjs --strict --as-uploaded 10-80:0.25` exits 1 for DARK's own line alone (4.97 at one
  maximum of 281); light's red line is gone; beach reads none.
- **How far the colours move** from the field PR #318 merged (`light-margin-solve.mjs --audit`, every half knot along the
  drawn path): **0.112 dE00 at the most over the land (10 kn), 0.108 over the sea (10 kn)**; 2.07 summed over the 37 rows.
  Calm and 75 kn do not move. Three readings the move shows up in: 10 kn is 0.15 L* lighter (5.95 lighter than before the
  path, 5.8 as merged); 3 kn 0.08 L* lighter; the gold at 33 kn 0.07 L* deeper.
- **Every bar of #318 is read on these rows by its own tests** (they read the default): the hue never turns back; within
  20.2 degrees of dark's at the stops; no edge above 8.0 dE00; lightness never rises by 0.05 L*; the two levels inside
  64.7 to 65.3 and 59.9 to 60.3; the streak cores within 3 degrees of the field; the bar within 18 degrees.

**Tests.** `windLightPath.test.js` 72 tests (was 69 on dev): the default's bytes re-pinned (the field's; the streak row's and
the bar's are unchanged and say so); the span; the as-drawn block now reads by the GPU's lookup, with five tests in place of
two: the control is the field PR #318 merged, to the byte; the default holds at all 281 maxima over the sea and over the land
as it draws; the control dipped at 32 over the sea; the kills' pictures pinned as readings; the move under 0.12 dE00. Five pins moved on purpose, each
with the value before in its comment (10 kn's hue 197 -> 196; 10 kn's lift 5.8 -> 5.95; 33 kn's L* 53.6 -> 53.5; in
`windWhiteStreak.test.js` the everyday levels 60.1 / 65.0 -> 60.0 / 65.1 and 3 kn 71.9 -> 72.0). **Mutation: 5 of 5 red**
(a row moved by 0.004; a kept row put back a step; the field owning only 1 to 32 kn; the margin leaking under the kill; the
streak row moved).

**Gates** (dev `f6310516` + this change): Jest on both trees 316 suites, 4,573 tests, 0 failed; `check_eslint.js` exit 0;
`loc_ratchet.py` New 0, Regressed 0 (`WindColorRamp.js` 796 lines, untouched); the production build exit 0.

**Not done yet:** the ledger lines (the leading session gives the head to append after: a docs PR of its own merges first);
the PR is a DRAFT until then. Commitment seq 1118 (the re-solve) closes with those lines.

**Not verified:** nothing seen in the app or on a real canvas, by this session or the owner; the as-drawn read models the
texture and the GPU's lookup, not the framebuffer's own rounding; phones not measured.

## 2026-10-13 02:10Z · Rebased onto dev `e1c0f28c`, pushed, PR #327 opened as a draft; the ledger lines appended at the leading session's go

- **The go** (the leading session, 01:56Z): #317 merged at 2026-10-13T01:56:05Z (dev `e1c0f28c`, docs and bench scripts
  only; ledger head seq 1165); this PR is the last before dev is promoted to main. The owner to it, 01:54Z, relayed: "yes push
  to main after the color tweaks are in".
- **The owner, first-hand in this session's chat:** 01:51Z, "push it and open the draft PR when the review is back"; 02:06Z,
  **"push it now, don't wait for the review"**. So it was pushed and opened with the independent review of its diff still
  running; the PR stays a DRAFT until that review is in and its findings are answered.
- **Rebase:** both commits onto `e1c0f28c`; one conflict, STATE's `Updated` line (dev's list of logs kept, this log's item
  first). No lesson or decision number collided (dev's last are L-V84 and D-030). Re-run there: the wind suites 50 suites,
  1,328 tests, 0 failed; `check.mjs --strict` exit 0; light as uploaded 5.03 over the sea and 5.20 over the land, 0 of 281
  maxima under 5.0; `loc_ratchet.py` New 0. The full gates of the section above ran on the same app sources before the rebase.
- **PR #327**, opened 02:07Z as a draft at head `b4480119`.
- **Ledger, after dev's seq 1165:** 1166 `pr_merge #317` (written here from the leading session's relay; it did the merge);
  1167 the decision (D-031); 1168 the default; 1169 closes commitment seq 1118 (the re-solve) and says which two parts of its
  check were NOT met as written: the land at the sea's depth, which is now a kill's picture and still short as drawn, and
  "shown to the owner moving before it replaces the rows", which the owner waived by asking for it to be merged unseen; 1170
  `pr_open #327`; 1171 the read-back commitment (a static read of the deployed bundle's rows; due 2026-10-20).
- This session does not merge. After this push nothing more is pushed unless a check fails or the review finds something.

## 2026-10-13 02:17Z · The PR marked ready at the owner's word; the independent review came in after: no must-fix, one should-fix (stale comments), and a limit of the "as drawn" read said plainly

- **The owner, first-hand in this session's chat, 02:13Z:** "mark it ready now, don't wait for the review". PR #327 was marked
  ready at 02:13Z (head `810ad447`), with the review still running; its description says so.
- **The review** (a read-only agent; its harness loaded the ramp code of both commits and compared bytes; its report reached
  this session at 02:14Z). What it measured:
  - **Under the kill:** 0 mismatches (the kill alone, 49 lever sets that include it, and "set + kill" over 1,093 sets).
  - **Lever sweep:** 1,093 sets a theme. Differences only in light, only in the field, only where the commit before already
    drew the path; never in the streak row, the legend, the look key or `windLightPathOn`. Unexpected differences: 0.
  - **Beach and dark:** 0 differences in 2 x 1,093 comparisons.
  - **The default in light:** 39 rows in both, the same knots; 34 rows changed; alpha unchanged in every row; calm and 75 kn
    identical; the largest change in any channel 0.003 (under one byte); in the texture 105 of 256 texels differ at a 50 kn
    maximum and 84 at 75 kn, each by exactly 1.
  - **`light-path-318.json`** equals dev's field number for number, and its texture bytes match.
  - **The reported numbers reproduce exactly.** They also hold at 7,001 maxima (a hundredth of a knot apart: the sea 5.034,
    the land 5.194, none under), and under the lookup this session's first pin used (the table's index: the sea 5.022, the
    land 5.165, none under): the change of lookup in the tests is not what makes them pass.
- **Its findings, and what was done with each:**
  1. *Must-fix for the first commit alone:* a 3 kn pin in `windWhiteStreak.test.js` was still at 71.9 there. Already moved by
     the second commit (to 72.0); the PR is squashed. Nothing to do.
  2. *Should-fix:* two comments in `WindColorRamp.js` and one line of the README still said rows "1 to 32 kn" of both tables
     are the path's; the field is 1 to 63 kn now. One of them told an editor that a change to the deep field changes what
     light draws with no lever, which is no longer true from 33 to 63 kn. **Made true, in a commit held locally** (comments
     and docs only; no line added to `WindColorRamp.js`).
  3. *A limit of the claim, the owner's to know:* **"holds 5.0 as drawn" is a claim about the texture and the GPU's lookup,
     not about the pixel.** The screen rounds each pixel to 8 bits once more. The reviewer's crude model of that (one flat
     ground colour, each tinted pixel rounded to a byte; its own model, not a GPU read) moves a pair by about ten times this
     change's 0.034 of room: the sea's 3-6 kn pair reads 4.63 at the worst in BOTH commits, under 5.0 at 153 of 281 maxima
     before and 80 with the margin. So the margin helps there too, and does not make that reading hold. The tests and the PR
     said the framebuffer was not modelled; the module's own note now says it as well, with these numbers.
  4. *The recorded solve command:* the README's command lacked three of the flags the run used. With them (`--land-l 0.90 --gens 1500 --rounds 6`) the run was made again on this branch and gives the committed rows, value for value.
  5. *Two bars now sit at their limits* (both were already inside, and are): lightness rises 0.0498 L* from calm to 33 kn
     against a bar of under 0.05 (0.0163 before); light's ground from 6 kn up peaks at L* 65.191 against the 65.2 of
     `windWhiteStreak.test.js` (65.183 before).
  6. *No bug reachable from the app* in `lightPathRows` / `lightTables` (the memo ignores its arguments after the first
     on-path call; the app's one caller always hands in the same two constants).
  7. *No kill of its own:* the path's kill steps back past PR #318 too, so the app cannot show the margin beside the field as
     filmed. Known and chosen (as beach's margin); the owner's call if they want one.
  8. *Two nits in the solver:* `--dump-merged` could have overwritten the reference with the margin's rows (it refuses now);
     a label said "the deeper land" where the audit reads the land as drawn (fixed).
- **Not pushed:** the leading session asked for no further push unless a check fails. The commit with 2, 3, 4 and 8 is held
  locally; it changes comments, docs and a script, nothing drawn, and a push restarts the hosted checks.
