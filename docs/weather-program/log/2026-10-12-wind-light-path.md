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

## 03:55Z · CORRECTION: every DARK number above was read through the wrong law

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
