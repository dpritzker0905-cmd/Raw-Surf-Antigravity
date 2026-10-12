# 2026-10-12 · Wind: beach's lightness against dark's logic (beach's own colours)

Session branch `claude/wind-beach-lightness`, cut from `origin/dev` at `ec8f46a2` (#314's merge). Times are UTC. One writer: this
session. **State at the last entry: a candidate built behind a kill and FILMED beside dark, waiting on the owner's eye. Nothing is
pushed, no PR is open, no ledger line, STATE entry, DECISIONS or LESSONS entry has been written** (the ledger pen is `wind-border-ink`'s
and #315's; this branch takes the next free ids at PR time).

## 03:50Z · The direction, and what was checked first

The owner, first-hand in the lead session's chat, 2026-10-12 02:48Z (relayed in this session's brief; D-022 carries the earlier line):
"you need to double check all this. The light and beach modes need to make sense logically. It could be the way it is, or it could not
be. It all has to make sense to match dark mode, but it their colors and maps"; and 2026-10-11 23:45Z: "beach can use improvement, just
a little milder".

**Before, reproduced from the code at `ec8f46a2` before any edit (03:56Z):**
- `node frontend/scripts/wind-color/mirror-model.mjs`, beach over its muted land, L*: calm 67.4, 3 kn 63.6, 6 kn 56.8, **10 kn 46.7**,
  16 kn 53.0, 21 kn 54.2, 27 kn 70.8, 33 kn 67.5, 40 kn 63.1, 47 kn 49.0, 55 kn 44.7, 63 kn 44.1, 75 kn 45.5.
- `node check.mjs --strict`: exit 1, two red lines, both beach's colour-blind lines: 3.1 (water) and 3.2 (land), 16-21 kn, protan.
  `--theme beach --today`: 5.1 / 5.2.
- FNV of the drawn tables (marks row 0, marks row 1, field): beach 50 kn `6e75db94 72b4bd7f 7c248d5f`, 75 kn `be558fd8 cd4835ed
  b9db3bb2` (equal to `windWhiteStreak.test.js` WATCHED.beach); light and dark recorded in `windBeachPath.test.js` BEFORE.
- The colour-blind replica (`light-path-lib.mjs`, taken byte for byte from the local branch `claude/wind-light-path`): `--verify`
  agrees with coloraide to 2.3e-12 over 4,000 pairs.

**What already follows dark's logic (kept, byte for byte):** beach's hue ORDER (to the aqua at 6 kn, then one way round the wheel: the
whole turn back is 0.5 degrees); calm and 3 kn; 33 to 47 kn; 63 kn.

**What does not (instrument: `beach-path-solve.mjs --audit`):**
- Lightness through the green band runs both ways: the whole climb back from 10 kn is 7.5 L* over land, 6.2 over the sea.
- **Four** pairs are under the colour-blind bar, not one (the checker prints only the weakest): 16-21 kn 3.2 / 3.1 (protan; deutan 4.7
  over the sea), 27-33 kn 3.6 / 3.6 (deutan), 47-55 kn 4.6 (sea, tritan), 63-75 kn 4.6 (sea, protan).
- Why: the dusk factor of dark's rules pushes rows to the edge of what a tint can lay. The red channel is 0.000 from 8 to 15 kn and the
  blue from 19 to 24 kn; 21 kn keeps C* 32.7 where the factor alone would leave about 40. Before dark's rules every pair read 5.1 or more.
- Dark's own steepest knot, by the engine's law (field x alpha squared + map x (1 - alpha); read in `WebGLWindShaders.js` HEATMAP_FS and
  `WebGLWindEngine.js`'s blend, as the light-path session found): 8.9 dE00. Beach's own is 3.9 (39-40 kn). The brief's 11.0 was the
  plain "over" reading.

## 04:20Z · A rule or a table: a table

Dark's rules dim every band by ONE factor in linear light. One factor cannot change the order of two bands, and the 10 kn dip is in
beach's own field stops (before dark's rules, over land: 6 kn 69.6, 10 kn 56.9, 16 kn 65.2). The name guard acts on yellow and orange
grounds only and the ceiling on the lightest everyday band only. A factor a band is a table. So: a solved table for the field beach
DRAWS (a row a knot, laid over the solver's field), gated on the white streak. `BEACH_FIELD_RAMP` is not touched, so every kill that
restores it still restores it.

## 04:30Z to 05:20Z · The solve, with the floor as a constraint (`frontend/scripts/wind-color/beach-path-solve.mjs`)

Unknowns: the field's colour over the muted land (L*, C*, hue) at the Beaufort stops that are freed. Bars (hard): every neighbouring
pair from 3 kn at 5.0 dE2000 or more for protan, deutan and tritan, land AND sea; lightness never rising over 0-21 kn and over 29-75 kn,
knot by knot, both grounds; each stop within a hue tolerance of what beach draws, and beach's order kept as a WHOLE turn back of 0.6
degrees at most; no knot harder than dark's 8.9; no changed knot under C* 12; the tint 14 dE00 or more off the bare ground from 6 kn;
every row a tint the app can lay; the chroma line no further from one rise and one fall than today's. Aim: the floor (credit to 5.1
only), then the LEAST change from what beach draws.

Findings, in the order they were found:
1. **The three faults decouple at every kept stop**, so they were solved apart and joined.
   - 27-33 kn: moving 27 kn alone costs 3.1 dE00 (summed over both grounds); moving 33 kn alone costs 10.0. Taken: 27 kn, 0.9 L* lighter.
   - 47-75 kn: moving 55 and 75 kn costs 4.4 in all (0.6 and 2.5 dE00 over land); 63 to 75 kn no longer rises.
2. **The green band has two basins, and one corner that cannot be had.** Deep AND colourful does not exist under a multiply tint at
   0.60 strength: over beach's land C* 33 needs L* 54 or lighter; at L* 49 the most is about 20; at 46 about 14. So one-way lightness
   through 10, 16 and 21 kn is paid for in one of three coins:
   - **A, level** (built): 10 kn lifted to the level of 16 and 21 kn (L* 55), which keep their colour. Moved 37.0 in all.
   - **B, step**: 6 and 10 kn at L* 57, 16 and 21 kn at L* 50, 10 kn's colour kept, 16 and 21 kn a third and a fifth less colourful
     (C* 22.0 and 26.2 against 33.6 and 32.7). Moved 50.3 in all. Floor 5.10 on both grounds.
   - **deep** (not filmed): 6 kn kept exactly; 16 and 21 kn at L* 46 with C* 14 to 15. Moved about 60.
3. **The hue tolerance is 8 degrees.** At 4 degrees no solve holds the floor with 6 kn's ground at today's depth (best 4.4 to 4.9). With
   6 kn kept EXACTLY the level basin is not reachable (only the deep one, 60 moved): 6 kn's aqua must go 8 degrees bluer (170 to 178).
4. **A loophole found and closed in the instrument:** a hue bar read a knot at a time let 10 kn (148) sit BEHIND 16 kn (151): beach's
   order turned back by 2.9 degrees over six knots at under 0.6 a knot. The bar is now the whole turn back. Every number below is after it.
5. **How the rows between stops are laid:** inside the green band (6 to 21 kn) on straight lines between the stops; everywhere else as
   the colour beach drew at that knot, moved by what its two stops moved. Straight lines everywhere lifted 22 to 26 kn by up to 4 L*
   (the eased climb into the gale band became a ramp): not wanted, not built.

## 05:25Z · The candidate, built (local commit `98c50e3b` and the one after it; kill `window.__RAW_DISABLE_WIND_BEACH_PATH__ = true`)

`frontend/src/components/map/windBeachPath.js` (`BEACH_PATH.field`: 56 rows, knots 4-32, 48-62, 64-75), wired in `WindColorRamp.js`
(`windBeachPathOn`, `darkRulesTables`, the look key: beach reads `white+path|dark-rules`). ON only where the white streak draws.
The streaks' two rows are NOT touched.

| kn | land now (L* / C* / hue) | land before | sea now | moved (dE00, land) |
|---|---|---|---|---|
| 6 | 57.8 / 17.6 / 178 | 56.8 / 21.6 / 170 | 47.2 / 15.4 / 185 | 3.2 |
| 10 | 55.2 / 14.1 / 151 | 46.7 / 18.2 / 156 | 44.9 / 12.0 / 161 | 9.0 |
| 16 | 55.0 / 32.7 / 152 | 53.0 / 33.6 / 146 | 44.8 / 27.3 / 155 | 2.7 |
| 21 | 54.8 / 33.9 / 125 | 54.2 / 32.7 / 124 | 44.6 / 28.3 / 129 | 0.8 |
| 27 | 71.7 / 40.3 / 123 | 70.8 / 44.0 / 122 | 58.7 / 33.5 / 127 | 1.5 |
| 55 | 44.4 / 13.6 / 23 | 44.7 / 14.3 / 24 | 35.6 / 9.2 / 16 | 0.6 |
| 75 | 43.6 / 11.5 / 297 | 45.5 / 10.7 / 305 | 35.2 / 11.1 / 289 | 2.5 |

Read back (instruments named):
- `node check.mjs --strict`: **exit 0, no red line** (it was exit 1, two red). Beach's colour-blind lines: water 5.0 (5.02, 3-6 kn,
  protan), land 5.1 (5.12, 27-33 kn, deutan). Warn lines: the three it printed before, light's marks line as before, and beach's marks
  line now names 6-10 kn tritan 1.9 (it named 3-6 kn deutan 2.0; a watch line, the streaks never carried the bands).
  Control: `node check.mjs --strict --before-path` prints the before run's text line for line and the same JSON.
- Table hashes: beach's field `e7b904ad` (50 kn) / `949f2ec6` (75 kn); its two streak rows, light and dark as before. Under the kill
  beach's field is `7c248d5f` / `b9db3bb2`: the before.
- `beach-path-solve.mjs --score beach-path.json --mono 0-21,29-75`: violation 0.000; lightness climbs back 0.0; hue's whole turn back
  0.6; steepest knot 3.9 (unchanged); weakest C* 3-40 kn 13.5 / 11.8 (unchanged, 3 kn's).

**What it costs (measured):**
- Table model (`windBeachPath.test.js`): the head of a streak steps 20.6 L* off its ground at 10 kn over land (24.8 before; dark's own
  is about 22) and 17.6 at its weakest from 6 kn (8 kn over land; 19.6 before). From 7 to 15 kn only.
- **GPU bench, the real engine on the real basemaps, device pixel ratio 1.5, 180 frames a run, Mobile Bay, the served-wind fixture**
  (`motion-run.js` then `mirror-run.js --at`; the streaks' LIFT against dark's own at the same zoom):

  | | zoom 4 | zoom 6 | zoom 9 |
  |---|---|---|---|
  | over LAND (`--at 0.5,0.12`): today | 0.86 | 1.03 | 0.74 |
  | A, level (built) | 0.80 | 0.82 | **0.45** |
  | B, step | 0.89 | 0.82 | 0.59 |
  | over the SEA (`--at 0.5,0.9`): today | 1.35 | 0.94 | 0.89 |
  | A, level (built) | 1.28 | 0.93 | 0.90 |
  | B, step | 1.31 | 0.95 | 0.89 |

  Over the sea neither candidate moves the lift by more than 0.07. Over the land both lose it where the 7 to 13 kn ground is lifted
  (the land's ground reads L* 57.1 to 61.4 at zoom 6 and 51.5 to 57.1 at zoom 9); A loses more at zoom 9 because its 12 to 15 kn stays
  at the lifted level where B has already stepped down.
- The sea's floor is AT the bar (5.02); the four pairs of the green band all sit within 0.1 of it over the sea. B holds 5.10.
- The gale band is 0.6 L* paler at its peak (73.5 at 29 kn against 72.9).

## 05:40Z · The gale band, both ways (the owner's call; nothing chosen here)

- **Kept pale (what is built):** one-way to 21 kn, a 16.9 L* climb to 27 kn, then one way down. Cost: the peak above, and the pair
  27-33 kn bought with 0.9 L* at 27 kn.
- **Deepened so the whole line runs one way (solved, NOT built):** in beach's own hues (8 degrees) the floor stops at **4.99**: it does
  not hold 5. 27 kn goes from L* 70.8 / C* 44.0 to 57.3 / 22.0, 33 kn from 67.5 / 44.5 to 51.8 / 24.1, 40 kn from 63.1 / 30.3 to 51.6 /
  20.1, 75 kn to a near-black grey (C* 2.0): the yellows and oranges go olive and brown, 12 to 16 dE00 a band, 160 moved in all (37 for
  A). Allowed 20 degrees of hue it holds 5.10 at 137 to 168 moved, with 6 kn's ground lifted to L* 62 to 63.

## 05:55Z · Shown to the owner (sent from this session; verdict pending)

- `frontend/scripts/wind-bench/out/videos/beach-path-sheet.png` (`beach-path-sheet.mjs`): dark by the engine's law, beach today, A, B and
  the deepened gale band at the 13 Beaufort speeds over land and sea, the colour-blind distance between each pair, and the lightness line.
- `.../beach-path-side-by-side.webm` (`compose-video.js`): dark | beach today | A | B at zooms 4, 6 and 9, 3 s at real speed, twice.
  B was filmed from a local side commit (`c2d59fa5`, branch `claude/wind-beach-path-alt-b`, never pushed) through `motion-run.js --ref`.
- **This session's reading (not the owner's):** A is the smaller change and keeps the greens' colour; B keeps more of the streaks' lift
  over land, has the floor margin and keeps 10 kn's colour. If the streaks over land weigh most, B; if the colours weigh most, A.

## Instruments added on this branch

- `scripts/wind-color/beach-path-solve.mjs` (`--audit`, the solve, `--score file --emit rows`), `beach-path.json` (the built
  candidate's stops), `beach-path-sheet.mjs`, and `light-path-lib.mjs` (copied unchanged from `claude/wind-light-path`).
- `check.mjs` and `mirror-model.mjs` take `--before-path` and load `windBeachPath.js` (any other loader that reads `WindColorRamp.js`
  as text must hand `BEACH_PATH` and `beachPathRows` in). `mirror-model.mjs drawnField(theme, levers)` takes levers (the same one-line
  change `claude/wind-light-path` makes).

## Not done, said plainly

- **Nothing has been seen in the app.** The clip is the bench (the real engine and basemaps, a still camera), not the deployed build.
- The legend has not moved and did not need to: the field stays within 30 degrees of the legend's hue at every band (the checker's line).
- The streaks' rows were not re-solved for the new ground (one visual variable). Re-solving them is the obvious next lever for the
  land's lost lift, and it is a second variable.
- Gates run locally at 06:00Z: see the next entry. No PR: the brief stops here for the owner's eye.
- Overdue commitments printed by `memory_audit.py --docs-only` at session start (13, the oldest seq 149) are not this lane's and were
  not touched.

## 06:00Z · Gates run locally on the candidate (before the owner's verdict; the PR's own gates are still owed)

(This header first read 06:10Z, an estimate ahead of the clock (LESSONS L-P10); `memory_audit.py` caught it and it was set to the
clock's reading before the commit left this machine. No other session had read it.)

- Jest, from `frontend/`, `--testMatch` (a `.claude/worktrees` checkout): `**/src/components/map/**/*.test.js` 284 suites, 3829 tests
  passed; `**/src/tests/**/*.test.{js,jsx}` 23 suites, 254 tests passed. New: `windBeachPath.test.js`, 23 tests, each bar with the
  table before as its positive control. Twelve pins of the old default moved with it, in three files (`windWhiteStreak.test.js`,
  `windDarkWhite.test.js`, `windDarkRules.test.js`): beach's default field hash and its look key. Those files now read the tables
  D-021 and D-022 drew through the path's kill, so they still pin what they pinned; the kill is classified in `windDarkRules.test.js`.
- `node scripts/check_eslint.js`: exit 0. `python scripts/loc_ratchet.py`: new 0, regressed 0 (`WindColorRamp.js` is 779 lines).
- `node check.mjs --strict`: exit 0 (before: exit 1, two red lines; every red and warn line is listed in the 05:25Z entry).
- **NOT run:** `npm run build`, an independent read-only review, `memory_audit.py` and `action_ledger.py verify` after the shared
  records are written. They belong to the PR, which waits for the owner's verdict on A, B, or neither.

## 06:20Z · CORRECTION to the 05:25Z entry, and what three notes from the other lanes changed

**The correction (my error).** The 05:25Z table's SEA rows, and the sentence "Over the sea neither candidate moves the lift by more than
0.07", were read on the bench's default scene. That scene is a HURRICANE (found by the lead session and the simplification lane, read in
the bench's fixture): at zoom 6 its sea crop holds about 41 kn (quartiles 36 and 47), a band this change does not touch. So those sea
numbers say nothing about everyday winds; the LAND rows (about 8 kn at scale 1) stand. Re-read at everyday winds (`motion-run.js` with
`scale` 0.2 and 0.4, which put the sea crop near 8 and 17 kn; zoom 6, pixel ratio 1.5, dev's sea white 0.77, `mirror-run.js --size 360`;
ONE run each, no replicate), lift against dark's:

| | sea, about 8 kn | sea, about 17 kn | land at scale 0.2 | land at scale 0.4 |
|---|---|---|---|---|
| today | 1.41 (ground L* 42.0) | 1.28 (45.2) | 0.19 | 0.35 |
| A, level (built) | 1.23 (46.8) | 1.24 (47.3) | 0.33 | 0.42 |
| B, step | 1.21 (47.2) | 1.30 (44.7) | 0.34 | 0.44 |

- Over the sea at about 8 kn both candidates bring the lift 0.18 to 0.20 nearer dark's (the ground is 4.8 to 5.2 L* lighter). That is on
  dev's 0.77; #315's 0.55 scales every arm down, and a lighter ground then reads UNDER dark's. The field and the strength must be read together.
- The land rows at these scales are calm air (ground L* 65 to 67, lifts of 1.6 to 4.3 L*): the arms differ by about 1 L* where the tables
  barely differ, so read them as one run's noise, not as a gain.
- The bench's `--dpr` sets the page's pixel ratio only (the map is drawn at 2 unless `--map-dpr`, a flag on #316's branch).

**An older kill keeps its meaning (the rule the review of #318 applied; relayed by the light lane).** D-022's kill
(`__RAW_DISABLE_WIND_DARK_WHITE__`) is documented to draw #313's picture pixel for pixel, so beach's path now stands down under it:
`windBeachPathOn` reads it, `windBeachPath.test.js` pins the field captured before under it, and `windDarkWhite.test.js` is back to
asserting #313's tables under its own kill. Four test files re-run: 165 passed.

**Ids assigned by the lead (not yet written anywhere):** DECISIONS D-025, LESSONS L-V63 up. `pr_merge #314` is not this branch's.

**The streak's ground first (the light lane relays the owner's choice for LIGHT: "option 2, give the streaks their ground back"; the
lead's frame: the SHAPE of the ground along speed sets how far one white strength can lift at every speed).** Two more solves, stills only:
- **How little the ground must be lifted, against the hue tolerance** (`--aim deep`): at 8 degrees the 6 to 21 kn ground is lifted 6.8 L*
  at best; at 12 degrees 2.5; at 16 and 20 degrees 2.1 to 2.6. The looser hue match is what keeps the depth, as it was for light.
  **C, the ground kept** (12 degrees): 10 kn 49.2 / C* 18.0, 16 kn 49.1 / 17.9, 21 kn 41.9 / 14.5 over land; floor 5.11; moved 65.7; the
  greens go grey-green and 21 kn sits 29 L* under the pale 27 kn.
- **E, the gale band under a ceiling** (`--ceilgale 60`, beach's own hues within 8 degrees): 27, 33 and 40 kn at L* 59.9, 59.9 and 59.6
  (70.8, 67.5, 63.1 today), C* 23.9, 35.0, 27.7 (44.0, 44.5, 30.3); 16 and 21 kn at 46.4 and 46.3 with C* 16.0 and 19.1; floor 5.12; moved
  107.6. Unlike D (the whole line one way, 4.99) it HOLDS the floor in beach's own hues.
- **How flat the ground is from 6 to 40 kn** (lightest minus deepest, L*, land / sea; `beach-path-ground.mjs`): dark 7.4 / 7.2; beach
  today 26.2 / 21.7; A 18.7 / 15.5; B 23.4 / 19.4; C 31.0 / 25.8; **E 13.7 / 11.4**. From 6 to 21 kn only: dark 7.3 / 6.8; today
  10.0 / 8.5; A 3.0 / 2.6; B 6.7 / 5.8; C 14.3 / 12.1; E 11.3 / 9.6.
- The lead's speed ramp (zoom 6, sea white 0.55) reads beach's lift at 0.60 to 0.68 of dark's over the sea and 0.38 to 0.53 over land
  from about 26 to 38 kn, where even full white only just reaches dark's: the pale band is where beach falls furthest short, and A and B
  leave it as it is. E is the only option here that acts on it.
- The per-knot grounds (dark by the engine's law, today, A, B, C, E; land and sea) are in the shared notes for the lead:
  `wind-beach-path-ground-per-knot.md`. A caution carried there: the models' beach land is L* 83.9, the border lane measured 91.4 rendered.

**This session's reading now (not the owner's):** by "the streak's ground first" neither A nor B is the best field: both lift the 7 to
13 kn ground and leave the pale band. E follows the lead's frame best and holds every bar, at three times A's change and about half the
16 to 27 kn colour; it has not been filmed. The owner has the first sheet and clip (A and B); a second sheet with C, E and D is sent.

## 06:44Z · A lab lever for the options, at the lead's request (bench and preview only; default A, byte for byte)

The lead, 06:39Z by its note: show the owner A and E MOVING on a speed ramp beside dark with every lane merged, not as sheets (the pale
band is seen in motion at 26 to 38 kn, not on a swatch); it asked for the options behind a lever whose name starts with `__RAW_`.
- `window.__RAW_WIND_BEACH_PATH__ = 'B' | 'C' | 'E'` lays that option's field where the path draws (`BEACH_PATH_OPTIONS`,
  `beachPathPick` in `windBeachPath.js`; picked in `WindColorRamp.js` `darkRulesTables`). Any other value, or none, draws A: the
  default's hashes are unchanged (`e7b904ad` / `949f2ec6`). The look key carries the pick (`white+path-E|dark-rules`). Every kill
  and hold still wins over it. The streak rows, light and dark do not move under it.
- Read through the palette checker (`node check.mjs --theme beach --strict --beach-option X`): B, C and E each exit 0 with no red
  line; colour-blind lines water / land: B 5.1 / 5.1, C 5.1 / 5.1, E 5.1 / 5.3. `windBeachPath.test.js` pins each option's floor
  (5.10, 5.11, 5.12), its one-way lightness from calm to 21 kn, and its ground's span over land. Four wind table test files: 173 passed.
- The options not picked leave with the PR; this lever is not a product switch.

**For the merge (the lead's finding, proven in its combined preview):** this branch and #318 collide in `WindColorRamp.js` in three
places, and a careless resolution drops `windBeachPathOn`'s definition while keeping a reference (the page dies). Keep both imports,
both switches (`windLightPathOn`, then `windBeachPathOn`) with ONE declaration after them (`var SOLVED = {}, PATH_TABLES = null;`),
and one look-key entry for both. The same holds for `check.mjs`, `mirror-model.mjs` and the three test files (keep every entry of
the ORTHOGONAL list). #318 will very likely merge first: rebase onto it, not onto dev. #315 edits `windDarkWhite.test.js` too.

**Worth a line to the owner (the lead's point):** the palette checker has been red on dev since D-020 (four beach pairs under the bar,
the weakest 3.1); with A, or with any of B, C and E, it exits 0.

## 06:58Z · A on the lead's speed ramps at sea white 0.55 (measured by the lead session, relayed 06:58Z; these REPLACE my scaled-hurricane read)

Not measured here. The lead session captured A (this branch at `c80f680f`) with every lane merged (#318's option 2, the border ink,
#315) and this branch's kill as the control in the same capture: wind due north, speed rising with longitude (low ramp 2 to 30 kn across
the zoom 6 view, high ramp 7 to 61 kn), `motion-run.js --dpr 1.5` (map at 2), 120 frames, `mirror-run.js --size 110`, lift against
dark's at the same crop. Starred speeds are the high ramp.

| SEA, kn | 5 | 9 | 12 | 15 | 18 | 22 | 25 | 13* | 19* | 26* | 32* | 39* | 45* | 51* |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| before | 0.88 | 0.99 | 1.04 | 0.98 | 0.97 | 0.91 | 0.72 | 0.97 | 0.93 | 0.68 | 0.60 | 0.62 | 0.85 | 0.93 |
| A | 0.88 | 0.93 | 0.93 | 0.93 | 0.93 | 0.90 | 0.70 | 0.92 | 0.91 | 0.65 | 0.59 | 0.62 | 0.85 | 0.93 |

| LAND, kn | 5 | 9 | 12 | 15 | 18 | 22 | 25 | 13* | 19* | 26* | 32* | 39* | 45* | 51* |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| before | 0.78 | 0.86 | 0.91 | 0.88 | 0.82 | 0.75 | 0.46 | 0.92 | 0.82 | 0.38 | 0.52 | 0.49 | 0.81 | 0.97 |
| A | 0.73 | 0.64 | 0.65 | 0.76 | 0.76 | 0.73 | 0.43 | 0.76 | 0.78 | 0.37 | 0.52 | 0.49 | 0.81 | 0.97 |

Rendered ground L*, before to A: sea 42.9 to 47.4 (9 kn), 41.4 to 47.1 (12), 44.9 to 47.4 (15), 46.3 to 47.6 (18); land 54.5 to 60.6
(9 kn), 53.6 to 60.3 (12), 56.9 to 59.9 (15), 58.5 to 59.8 (18). Dark's own lift, sea / land L*: 7.5 / 10.5 at 9 kn, 8.6 / 11.8 at 15,
11.0 / 12.9 at 32.

The lead's reading, which this session shares:
- **Sea:** A makes the 9 to 18 kn sea ground level (47.1 to 47.6) and the lift level with it: 0.93 at each of those speeds, where it
  wandered 0.97 to 1.04. That is 0.04 to 0.11 under today's and 7% under dark's; a level ground is what one strength can match (about
  0.60 in place of 0.55 would read 1.0 across 9 to 18 kn; the lead's number to move, and only if the owner takes A).
- **Land:** A costs 0.22 to 0.26 of the lift at 9 to 12 kn and 0.12 to 0.16 at 13 to 15 kn, on a land already at full white: no
  strength gives it back. Only a deeper land under the wind could (the map's term; not built; the owner's call).
- **The pale band is untouched by A:** sea 0.59 to 0.70 and land 0.37 to 0.52 from 25 to 39 kn, the largest gap to dark in beach. E is
  the only option here that acts on it.
- A caution the lead gives for the land rows: along a ramp the place changes with the speed, so compare the two arms at the same crop.

Next, the lead's: A, C and E through the same capture (the lever is on this branch at `7d4ecffe`), cut into one clip beside dark.

## 07:33Z · A, C and E on the lead's speed ramps (measured by the lead session, relayed 07:23Z), and the pair it asked about (F)

Not measured here. The lead captured this branch's options through the lab lever at `7aa11c10`, every lane merged, sea white 0.55,
this branch's kill as the control in the same capture (the method of the entry above). Lift against dark's; starred speeds are the
high ramp. A clip (dark | today | A | C | E) went to the owner from the lead session.

| SEA, kn | 9 | 12 | 15 | 18 | 13* | 26* | 32* | 39* | 45* |
|---|---|---|---|---|---|---|---|---|---|
| before | 0.99 | 1.04 | 0.98 | 0.97 | 0.97 | 0.68 | 0.60 | 0.62 | 0.85 |
| A | 0.93 | 0.93 | 0.93 | 0.93 | 0.92 | 0.65 | 0.59 | 0.62 | 0.85 |
| C | 0.97 | 1.04 | 1.05 | 1.07 | 1.02 | 0.71 | 0.61 | 0.62 | 0.85 |
| E | 0.93 | 0.95 | 1.05 | 1.09 | 0.98 | 0.86 | 0.82 | 0.76 | 0.84 |

| LAND, kn | 9 | 12 | 15 | 18 | 13* | 26* | 32* | 39* | 45* |
|---|---|---|---|---|---|---|---|---|---|
| before | 0.86 | 0.91 | 0.88 | 0.81 | 0.92 | 0.38 | 0.52 | 0.49 | 0.81 |
| A | 0.64 | 0.65 | 0.76 | 0.76 | 0.76 | 0.37 | 0.52 | 0.49 | 0.81 |
| C | 0.80 | 0.88 | 0.97 | 1.06 | 0.98 | 0.39 | 0.51 | 0.49 | 0.81 |
| E | 0.69 | 0.77 | 1.01 | 1.05 | 0.94 | 0.61 | 0.61 | 0.63 | 0.81 |

The lead's reading, shared here:
- **E is the only option that moves the pale band, and it moves it about half way:** sea 0.60-0.68 to 0.76-0.86, land 0.38-0.52 to
  0.61-0.63, on a rendered sea ground 4 to 7 L* deeper and a land ground 3 to 4 deeper. It stays UNDER dark's there (my caution to the
  lead expected over: wrong). The rendered land is still plainly pale in E (L* 68 to 72 against dark's 34 to 39): the rest of that gap
  is the map's, not the palette's.
- **E's gain is all above 15 kn and its cost all below it:** at 15 to 18 kn E and C read 1.01 to 1.09 on both grounds (today's land
  0.81 to 0.88); at 9 to 12 kn E costs like A over land (0.69 / 0.77 against 0.86 / 0.91).
- **C** keeps everyday lift, improves the 15 to 18 kn land, and does nothing for the pale band. **A** is level and under.
- By eye the options are hard to tell apart in a still at this scale.

**The pair the lead asked about ("E with C's ground at 9 to 12 kn, if a solve can hold both"): it holds. Option F.**
`beach-path-solve.mjs --ceilgale 60 --aim deep --tol 12` (three seeds agree to 0.1): the gale band under L* 60 as in E (27 / 33 / 40 kn
at 60.0 / 60.0 / 59.9 over land) AND no everyday ground more than **4.3 L*** lighter than today (E 6.7, A 8.5, B 10.2, C 2.5). 10 kn sits
at L* 51.0 (46.7 today), 16 and 21 kn at 44.5 with C* 14.1 and 16.4; hue within 12 degrees; colour-blind floor 5.10; the 6 to 40 kn ground
spans 15.5 L* over land and 13.0 over the sea (E 13.7 / 11.4; today 26.2 / 21.7; dark 7.4 / 7.2). Cost: 110 moved in all, the greens grey-green
(as in C). It is drawable as `window.__RAW_WIND_BEACH_PATH__ = 'F'`; the palette checker exits 0 on it (water 5.1, land 5.1). Stills
and tables only: NOT filmed, not measured on a ramp.

## 07:52Z · F on the lead's speed ramps (measured by the lead session, relayed 07:51Z)

Not measured here. The lead captured F from this branch at `e2587c88` at sea white 0.55, every lane merged, with E and this branch's
kill in the same capture as controls (both reproduced its earlier rows to the digit). The method is the entry above's. A clip of
dark | today | E | F went to the owner from the lead session, which recommends F. Lift against dark's; starred speeds are the high ramp.

| SEA, kn | 9 | 12 | 15 | 18 | 13* | 26* | 32* | 39* | 45* |
|---|---|---|---|---|---|---|---|---|---|
| before | 0.99 | 1.04 | 0.98 | 0.97 | 0.97 | 0.68 | 0.60 | 0.62 | 0.85 |
| E | 0.93 | 0.95 | 1.05 | 1.09 | 0.98 | 0.86 | 0.82 | 0.76 | 0.84 |
| F | 0.95 | 1.01 | 1.09 | 1.12 | 1.02 | 0.86 | 0.82 | 0.75 | 0.84 |

| LAND, kn | 9 | 12 | 15 | 18 | 13* | 26* | 32* | 39* | 45* |
|---|---|---|---|---|---|---|---|---|---|
| before | 0.86 | 0.91 | 0.88 | 0.82 | 0.92 | 0.38 | 0.52 | 0.49 | 0.81 |
| E | 0.69 | 0.77 | 1.01 | 1.06 | 0.94 | 0.61 | 0.61 | 0.63 | 0.81 |
| F | 0.74 | 0.86 | 1.08 | 1.12 | 1.03 | 0.63 | 0.60 | 0.62 | 0.81 |

Rendered ground L* under F, sea: 45.4, 42.2, 39.3, 38.6 at 9 / 12 / 15 / 18 kn and 52.7, 56.1, 54.4 at 26 / 32 / 39 kn; land: 57.8, 54.5,
51.2, 50.0 and 68.1, 71.9, 69.7.

The lead's reading, shared here:
- F keeps E's whole gain in the pale band (sea 0.75 to 0.86 from 0.60 to 0.68; land 0.60 to 0.63 from 0.38 to 0.52) and gives back about
  half of E's everyday cost over land (0.74 / 0.86 at 9 / 12 kn against E's 0.69 / 0.77 and today's 0.86 / 0.91).
- At 15 to 18 kn F reads 8 to 12% OVER dark's on both grounds: its 16 and 21 kn grounds are the deepest of the set. Over the sea that is
  the lead's to trim with the strength if the owner takes F; one number cannot flatten 0.95 at 9 kn to 1.12 at 18 kn.
- Over land F is the first beach arm to reach dark's lift anywhere below 45 kn. The land's pale band is still pale (L* 68 to 72): the
  rest of that gap is the map's.

**What F still owes, if the owner takes it** (none of it done): it becomes the default in place of A (`BEACH_PATH.field`, the test
pins, the header's numbers); its hue tolerance is 12 degrees, not the 8 this log states for A, and its greens are C* 14 to 16; the
legend's 30 degree line and every bar are re-read for it as the default; the lab lever and the options not picked leave; then the PR's
own gates, records (D-025, L-V63 up) and the rebase onto #318.

## 12:07Z · The owner picked F; F is the default; the branch for the PR

**The pick (relayed, not first-hand here).** The lead session, 11:52Z: the owner said to it at 11:50Z, in full, "merge #316 and go
with F and the deeper land and open the pr". Checked against GitHub before acting: #316 reads MERGED at 2026-10-12T11:52:11Z and
`origin/dev` is `74417b5a`. The lead had recommended F with its ramp rows and a clip (dark | today | E | F). "The deeper land" is the
lead's own change (D-026), not this branch's. DECISIONS D-025 records the pick and whose words they are.

**What was done.**
- A new branch `claude/wind-beach-path` from `origin/dev` at `74417b5a`, with the eight local commits of `claude/wind-beach-lightness`
  squashed onto it (they were never pushed). The squash merged cleanly; `windDarkRules.test.js` keeps #316's entry and this one's
  in the ORTHOGONAL list.
- **F is what beach draws by default.** `BEACH_PATH.field` is F's 70 rows. The default's field hashes, `682f16ac` (50 kn) and
  `4026fb5f` (75 kn), equal the bytes read through the lab lever at `35b99ac5` (the same table as at `e2587c88`, the head the lead
  captured), read BEFORE the swap. Under the kill beach's field is `7c248d5f` / `b9db3bb2`: the before.
- **The lab lever and the options not taken are gone from the app** (`BEACH_PATH_OPTIONS`, `beachPathPick`,
  `window.__RAW_WIND_BEACH_PATH__`, `check.mjs --beach-option`): the look key is `white+path|dark-rules` again, which is also the
  form the lead's merge recipe for #318 expects. A, B, C and E remain as numbers in this log only.
- `beach-path.json` holds F's stops; `node beach-path-solve.mjs --score beach-path.json --mono 0-21,33-75 --tol 12 --ceilgale 60`
  reads violation 0.000: floor 5.10 (27-33 kn, protan, sea), lightness climbs back 0.0 over 0-21 and 33-75 kn, the hue's whole
  turn back 0.2 degrees, steepest knot 3.1 dE00 (3.9 before; dark's own 8.9), weakest C* from 3 to 40 kn 13.5 / 11.8 (3 kn's, as
  before), the everyday ground lifted 4.3 L* at most, the 6 to 40 kn ground spanning 15.5 L* over land.

**Gates, on the branch at `d7f597c2` (the feature commit):**
- `node check.mjs --strict`: exit 0, no red line (on `dev`: exit 1, two red lines). Beach's colour-blind lines: water 5.1 (27-33 kn,
  protan), land 5.1 (33-40 kn, deutan). "Speeds whose tint sits more than 30 degrees off the legend's own hue": none, on both
  grounds, so the legend does not move. Warn lines: the two marks lines it printed before (3-6 kn 6.3 over land, 21-27 kn 1.7 over
  the sea), dark's water-hue line, light's marks line, and beach's marks colour-blind watch line (now 27-33 kn deutan 2.0; it
  named 3-6 kn deutan 2.0). `--before-path` prints the before.
- Jest from `frontend/` with `--testMatch`: the map tree 284 suites, 3872 tests passed; `src/tests` 23 suites, 254 tests passed.
  `windBeachPath.test.js` re-pinned for F (each bar with the table before as its control); `windWhiteStreak.test.js`,
  `windDarkWhite.test.js` and `windDarkRules.test.js` read D-021's and D-022's tables through this kill and pin F's hash as the
  default.
- `node scripts/check_eslint.js` exit 0; `python scripts/loc_ratchet.py` new 0, regressed 0 (`WindColorRamp.js` 782 lines).
- The build: `npm run build` cannot run from this Windows shell (its script sets `NODE_OPTIONS=...` in POSIX form), so the same
  command was run in Git Bash as Netlify runs it, `CI=false NODE_OPTIONS=--openssl-legacy-provider npx craco build`: "Compiled
  with warnings", exit 0. With `CI=true` it fails on 587 lint warnings in files this change does not touch, as `dev` does. The
  build's version stamp touched two tracked files; they were restored and are not in the commit.
- An independent read-only review of the diff was run before the push: its findings and what was done about each are in the next entry.

**This change moves no served number** (client only: a colour table), so it adds no SCOREBOARD row.

**Owed after it:** the read-back on the deployed build once the owner merges (the look key, the kill flipping it with no reload,
the owner's eye); the sea strength re-read on F's ground and the land re-read under the deeper land (both the lead's).

## 12:30Z · The independent review, and what was done about each finding (before the push)

A read-only reviewer (a subagent given the diff and the rules, not this session's conclusions) compared `origin/dev`'s module with
this branch's over 103,840 lever cases (every one of the 111 `__RAW_*WIND*__` names at 14 values, all pairs at `true`, string levers
against every other lever, 6,000 random sets of 3 to 6 levers; both call shapes; 50 and 75 kn in full): **beach's tables differ from
dev's exactly when `windBeachPathOn` is true, with no exception; light, dark, both streak rows, the mark model and the white strength
never moved; no cache or aliasing fault; the look key carries `path` exactly when the tables change.** It did not run `check.mjs`
(no coloraide in its view) or anything on the GPU. Its findings, most severe first:

1. **The measured gain is for a white strength this branch does not ship.** The lead's rows were taken at beach's sea white 0.55
   (#315, OPEN); this branch and `dev` hold 0.77. No capture of F exists at 0.77, and at 0.77 the sea already read 1.28 to 1.41 times
   dark's at 8 to 17 kn before the path; F then deepens the sea ground at 16 and 21 kn by 7 to 8 L*. Merged before #315, a zoomed-out
   beach sea at 15 to 18 kn would lift well beyond the "8 to 12% over dark's" quoted. **Done:** said in the PR description as a merge
   order (#315 before or with this), in the file's header, in D-025's amendment and in STATE. Nothing in code ties the two together.
2. **A bar of D-021 was moved off the default, and is crossed there.** `windWhiteStreak.test.js` now reads beach through the path's
   kill, so its bar "from a light breeze up the head of a streak stands 19.5 L* or more off its ground" ran only on the kill arm; on
   the field beach now draws it reads 18.6 at 8 kn over land (19.2 at 7 kn; 18.8 and 19.3 over the sea). **Done:**
   `windBeachPath.test.js` runs D-021's four per-knot bars on the path's field: three hold, the fourth is asserted as CROSSED at
   exactly those four places, with the table before as the control. The header lists it as a cost.
3. **D-022's kill now moves a table in beach, and four places still said it does not.** Its bytes equal dev's, so the rule (an older
   kill draws its old picture) is met; the consequence is that the kill can no longer A/B the white strength ALONE on the path's
   field. **Done:** the test title and comment in `windDarkWhite.test.js`, the comment in `windDarkRules.test.js` and the bench's
   `matrix.js` say so; a `before-path` bench variant was added with its test. `windDarkWhite.test.js`'s per-knot section reads the
   field its strengths were solved on (through the path's kill), so its `was` arm is again a picture the app can draw.
   **Not done:** `windDarkRules.js`'s own header still says of D-022 "No table moves" (true of D-022's change; that file is #315's
   to edit, and this branch does not touch it).
4. **Header claims that were too wide, and costs that were missing.** "Within 12 degrees" is the LAND's (over the sea 10 kn moves
   13.5 degrees and 16 kn 16.7). Over the sea the field at 16 kn sits 29.8 degrees off the legend's hue (13.1 before), 0.2 inside
   the checker's 30. A normal eye tells the everyday neighbours apart about half as well (6-10 kn 6.3 / 5.2 dE00 over land / sea
   from 10.8 / 8.5; 10-16 kn 6.8 / 5.2 from 10.0 / 8.8). The floor is 5.10 / 5.11 on the table and 5.01 at the least once quantised
   into the 8-bit texture. **Done:** each is in the header and pinned in `windBeachPath.test.js` (this session's model reproduced
   every number the reviewer gave).
5. **Assertions that could not fail.** The legend test compared nothing; a control compared two literals; the hue-order bar had no
   control. **Done:** the legend bar is compared with and without the kill on the real window; the control reads the tables; the
   hue-order bar is shown to fail on a table with 10 and 16 kn exchanged.
6. **Informational:** the path draws under every lever that leaves the white streak drawing (the mark sub-levers, a light look,
   `__RAW_WIND_DARK_RULES__ = 'beach'`), as #313's precedent has it.

After the fixes: the four wind table files 170 passed; both trees, the ratchets and the checker re-run before the push (read from the
PR's own checks, and below if they differ).
