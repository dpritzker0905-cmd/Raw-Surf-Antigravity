# 2026-10-11 · The pale band: a streak's white must pay (one rule of dark's rules, with a kill of its own)

Local session (Windows, AMD Radeon 890M, D3D11), a side session started by the session that built #312, in its own worktree
(`claude/serene-wiles-d3574d`). The task: remove the pale "cream" band in light's and beach's wind streaks as one small rule in the
solver with its own kill switch, measured before and after. It is the follow-up #312's log recommended ("Recommended next") and
DECISIONS D-020 lists under "Not decided": whether a streak may stop short of dark's step to keep its colour.

Started 17:27Z. `memory_audit.py --docs-only` at the start: 0 FAIL, 13 WARN (the same overdue commitments as this morning, each a
live read-back of backend or app work outside this task), 14 NOTE. Checked live before acting on STATE: `git fetch` (dev at
`432b0135`), `gh pr view 312` (OPEN, head `ced52301`). **So this branch is STACKED on #312's branch**, not on dev. No request of
this session reached the Raw Surf backend. Instruments: Jest (both trees), the palette checker (`frontend/scripts/wind-color`,
coloraide 8.13), the wind bench's map mode on the offline basemap and on the real Mapbox basemaps (the app's public token read from
the main checkout's local env file into the process environment, never printed), and its 3-seed scanner, all on this machine's GPU.

## 17:30-17:40Z · The "before", from the code before the edit (LESSONS L-V25)

Captured at `ced52301` with nothing edited: FNV-1a of the drawn 256-entry RGBA tables under no lever.

| theme | max kn | marks row 0 (land) | marks row 1 (sea) | field |
|---|---|---|---|---|
| light | 50 | `46e55dbb` | `177f0c5b` | `f03b4ab5` |
| light | 75 | `6d6d01df` | `f1f3ef88` | `bf0b2134` |
| beach | 50 | `6e75db94` | `72b4bd7f` | `7c248d5f` |
| beach | 75 | `be558fd8` | `cd4835ed` | `b9db3bb2` |

The palette checker's output at the same commit was saved too (`check.mjs --strict`: exit 1, the four colour-blind lines).

## 17:40-18:00Z · The streak rows read per knot (L-V34), and what the white buys

Every streak row (land and sea, both themes, 0-75 kn) was read with a scratch probe on the test file's own composite: the white's
share, the streak's L* and C*, its step, dark's step, the step at full colour, and what the white buys.

**The defect, confirmed.** A streak is its hue's most saturated colour mixed toward white. Where dark's step is out of reach, #312's
solver takes white up to the colour floor (C* 25):

| over land | white's share | streak C* | step bought by the white | L* of step per C* given up |
|---|---|---|---|---|
| light 22-25 kn | 0.27 to 0.71 | 81 to 37 | 1.2 to 3.7 | 0.06 to 0.08 |
| light 26-30 kn (the band) | 0.79 to 0.80 | 25 to 26 | 1.7 to 3.6 | 0.02 to 0.05 |
| light 31-33 kn | 0.62 to 0.33 | 46 to 75 | 3.2 to 2.0 | 0.07 to 0.13 |
| light 34-40 kn (oranges) | 0.31 to 0.37 | 73 to 60 | 2.5 to 6.7 | 0.16 to 0.30 |
| beach 26 kn | 0.09 | 98 | 0.3 | 0.13 |
| beach 27-29 kn (the band) | 0.80 | 26 | 4.2 to 2.5 | 0.04 to 0.06 |
| beach 30-32 kn | 0.63 to 0.53 | 47 to 55 | 1.1 to 4.2 | 0.02 to 0.12 |
| beach 33-39 kn (oranges) | 0.52 to 0.65 | 52 to 30 | 5.6 to 17.1 | 0.16 to 0.31 |
| blues, violets, reds (both themes) | 0.10 to 0.80 | 27 to 101 | up to 35 | 0.28 and up |

Over the sea no streak takes white at 13-42 kn (light) or 0-36 kn (beach), and where one does the white buys 0.23 or more.

**The one-knot edge (the positive control):** beach over land, 26 to 27 kn: C* 98.0 to 26.2, the white's share 0.09 to 0.80.

**A second steep step that is NOT white, said so it is not mistaken for this defect:** light's streak chroma steps +45.9 C* between
15 and 16 kn over land (+57.3 over the sea). Neither streak has any white in it: the field turns from teal to green there, and
teal's most saturated colour holds C* 65 where green's holds 111. It is the gamut along the field's hue path. Not changed here; the
test pins it before and after so the per-knot instrument is read correctly.

## The rule, and why it is on the white as a whole

**THE WHITE MUST PAY** (`DARK_RULES.pay = 0.15`): the white a streak takes must buy, taken as a whole, at least `pay` L* of step for
each C* of colour it gives up. Where it would not, the streak keeps the most white that does and stops short of dark's step. One
constant, one block in `solveDarkRules` after the three existing branches; `opts.pay: 0` skips it, so the tables before it come out
of the same code path byte for byte.

**The hand-off suggested a walk up from no white, stopping at the first step that does not pay. Measured, that fails:** light at
46 kn over land is a red (OKLCH hue 27) whose first 1% of white buys 0.148 L* a C*, under 0.15, while its white as a whole buys
0.35; with no white that streak is 1.7 L* DARKER than its ground, so rule 1 (light only adds) would break. Beach at 51-54 kn reads
0.13 to 0.15 at the first step and would have given up about 10 L*. The cost and the gain are not front-loaded alike: a red's
first white costs colour before it adds light. So the rule judges the whole white, and walks DOWN from what dark's step asked for
to the most that pays. Where the pay falls as white is added (the yellows and oranges, where the rule binds) that point moves
smoothly with the hue. The case is pinned as a test ("WHY the white is judged as a whole").

**`pay` chosen from the numbers.** The whole white buys 0.02-0.13 in the band and 0.16 or more everywhere else: 0.15 sits in the gap
(light 33 kn 0.128 | 34 kn 0.161; beach 32 kn 0.115 | 33 kn 0.161), so nothing outside the band moves. Modelled apart from the
solver for six values before the rule was written:

| `pay` | light's land changes | beach's land changes | most step given up | beach's steepest C* step a knot (20-36 kn) | sea rows |
|---|---|---|---|---|---|
| 0 (before) | none | none | 0 | -71.8 (26 to 27 kn) | as #312 |
| 0.10 | 22-32 kn | 27-31 | 3.5 | -30.7 | unchanged |
| 0.125 | 22-32 | 27-32 | 3.8 | -26.2 | unchanged |
| **0.15** | **22-33** | **26-32** | **4.1** | **-20.4 (32 to 33 kn)** | **unchanged** |
| 0.175 | 22-34 | 26-33 | 4.1 | -17.7 | unchanged |
| 0.20 | 22-35 | 26-34 | 4.1 | -14.3 | unchanged |
| 0.25 | 22-36 | 26-36 | 4.1 | -15.9 | beach 48-50 kn lose up to 6.3 L* |

Every value from 0.125 up clears the band (C* 90 or more at 26-30 kn in both themes); `pay` only decides how far into the oranges
the rule reaches. 0.20 gives beach a softer exit and takes 0.8 to 1.9 L* more step at 32-34 kn. 0.25 is too far: it starts taking
step from the sea's reds.

## The build

- `windDarkRules.js`: `DARK_RULES.pay`, the header's paragraph, and one block in `solveDarkRules`.
- `WindColorRamp.js`: `streakPay(w)` reads the kill; `darkRulesTables` passes `{ pay }` and keys its cache on it; `windLookKey`
  carries `~unpaid` under the kill so the engine rebuilds its tables at once, and still ENDS `|dark-rules` (the read-back handle of
  ledger seq 1047 stays true).
- **Kill: `window.__RAW_DISABLE_WIND_STREAK_PAY__ = true`.** It draws #312's tables byte for byte with dark's rules still on. It is
  not a hold (it changes nothing the solver assumes), so it is classified in the test that reads every kill out of the wind
  sources as "one rule inside dark's rules": 58 named, 21 hold, 37 do not, 0 unclassified.
- `scripts/wind-bench/matrix.js`: the scanner can name the kill (`--variants candidate,before-pay`).
- The field tables, the ceilings, the guard, its reach, the land mask, the sea rows and every other look: not touched.

## Measurements

**Tests first.** The new block and the changed pins ran RED on the unedited solver (9 failed), except the kill's byte test, which
passed on it: the hashes in the test are the unedited code's. Then green.

**The tables, per knot** (`windDarkRules.test.js`, "THE WHITE MUST PAY"):

| streak C* over land | 24 | 25 | 26 | 27 | 28 | 29 | 30 | 31 | 32 | 33 kn |
|---|---|---|---|---|---|---|---|---|---|---|
| light, before | 59.7 | 37.4 | 25.8 | 25.7 | 25.4 | 25.0 | 25.8 | 45.5 | 62.5 | 74.5 |
| light, after | 106.1 | 100.6 | 97.7 | 96.9 | 96.0 | 94.8 | 91.6 | 88.3 | 84.4 | 79.8 |
| beach, before | 100.5 | 100.3 | 98.0 | 26.2 | 26.0 | 25.8 | 47.1 | 55.1 | 52.6 | 52.0 |
| beach, after | 100.5 | 100.3 | 100.4 | 100.5 | 98.7 | 97.5 | 96.9 | 89.4 | 72.4 | 52.0 |

| step given up, L* | 22 | 23 | 24 | 25 | 26 | 27 | 28 | 29 | 30 | 31 | 32 | 33 kn |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| light | 1.2 | 3.3 | 3.4 | 3.7 | 2.9 | 1.6 | 2.1 | 2.9 | 3.2 | 2.5 | 1.5 | 0.4 |
| beach | | | | | 0.3 | 4.1 | 3.4 | 2.6 | 1.1 | 1.9 | 1.7 | |

- **The edge:** beach's steepest streak chroma step over land falls from 71.8 C* a knot (26 to 27 kn) to 20.4 (32 to 33 kn, the
  rule's upper end, where an orange's white begins to pay). Light's steepest inside 20-36 kn falls from 22.3 to 15.7, and that one
  is full colour to full colour (22 to 23 kn).
- **The cost:** at most 3.7 L* (light) and 4.1 (beach) of step given up at one speed. Against dark's own step the streaks at
  22-33 kn (light) now stand 0.5 to 5.6 L* short (5.6 at 27 kn, where #312 was already 4.0 short) and beach's at 27-32 kn 1.0 to
  5.1 short. Each still stands 16.8 L* or more above its ground. The median step over light's land at the everyday winds
  (6-27 kn) moves from 21.6 to 20.2 (dark's 22.0); beach's from 22.0 to 21.8.
- **Nothing else moved:** the field and the sea rows hash to #312's values; over land, 0-21 and 34 kn up (light) and 0-25 and 33 kn
  up (beach) are #312's rows exactly. Every texel of the drawn tables still steps lighter than its ground, and the colour floor
  holds (those tests read the drawn tables and did not change).
- **The kill is exact:** under `__RAW_DISABLE_WIND_STREAK_PAY__` the land row, the sea row and the field hash to the values above
  at 50 and at 75 kn, in both themes.

**Gates.** Jest, both trees: 304 suites, 4,007 tests, 0 failed (3,998 on #312; this adds 9). `check_eslint.js`: no rule over its
baseline. `loc_ratchet.py`: no new violation (`windDarkRules.test.js` 738 lines, `WindColorRamp.js` 753).

**Palette checker, `node check.mjs --strict`: exit 1, the same four red lines, the same numbers** (light 3.9 over water and 4.9 over
land, beach 3.1 and 3.2; the field did not change). `--today`: 0 red, exit 0. Two lines of 50 differ from the output saved before
the edit, both watch lines on the marks' own colours over land, never a gate:

| marks over land, weakest Beaufort neighbours (watch below 9 dE00) | before | after |
|---|---|---|
| light | 6-10 kn at 7.0 | 27-33 kn at 5.7 |
| beach | 3-6 kn at 6.3 | **21-27 kn at 1.5** |

Beach's 21 and 27 kn streaks over land are now the same yellow-green (C* 102 and 101, 2 degrees of hue apart): the cream band had
been telling those two bands apart by accident. The sea row already read 1.7 at the same pair on #312. The field under them carries
the band (the ground climbs from L* 54 to 71 across it). The marks' colour-blind watch lines read the sea rows and did not move.

**Map bench, `map-run.js`, seed 1, 180 frames, `--arms '{"unpaid":{"__RAW_DISABLE_WIND_STREAK_PAY__":true},"pay":{}}'`; `mask 1` on
every row.** **The kill is #312 on the GPU too:** `--ref ced52301` with an empty arm (offline, storm strength, z6) reads the same as
the working tree under the kill on every metric of the run's JSON, light and beach, and differs from the default. The `unpaid` arm
also reads, on every printed column, what #312's log reads for its `rules` arm (offline and Mapbox, z4 / z6 / z8 and storm).

| LAND | step | lighter | marks C* | end | lines kept |
|---|---|---|---|---|---|
| OFFLINE, storm (x 2.3), z6: light, unpaid | +15.0 | 1.00 | 34.0 | 63.7 ok | 0.376 |
| light, pay | +14.5 | 1.00 | **41.0** | 64.0 ok | 0.376 |
| beach, unpaid | +17.0 | 1.00 | 53.5 | 64.8 ok | 0.424 |
| beach, pay | +16.5 | 1.00 | **58.5** | 64.5 ok | 0.424 |
| MAPBOX, storm (x 2.3), z6: light, unpaid | +13.0 | 1.00 | 34.5 | 64.9 ok | 0.568 |
| light, pay | +12.5 | 1.00 | **41.0** | 64.7 ok | 0.566 |
| beach, unpaid | +13.0 | 1.00 | 57.0 | 67.5 ok | 0.650 |
| beach, pay | +12.5 | 1.00 | **61.5** | 67.3 ok | 0.648 |

At the served strength (Mobile Bay median 13 kn; little of the view is at 22-33 kn) the arms read the same within one step of the
instrument at z4, z6 and z8 on both basemaps: offline, light's land step +16.0 / +13.5 / +8.0 against +16.0 / +13.0 / +7.5 and
beach's +18.0 / +15.5 / +8.5 in both arms; on Mapbox, light +14.0 / +11.5 / +7.0 against +13.5 / +11.5 / +7.0 and beach
+14.5 / +12.5 / +7.5 in both. Every streak pixel over land is lighter than its ground in every arm; no surface reads wash. The WATER
columns agree arm to arm within one step of the instrument (0.5), not to the digit: the sea rows are byte for byte the same, so
what remains is most likely the land row where the mask blends the two near a coast (an inference, not isolated). Step: median L*
of a streak pixel against the field under it.

**The storm crops, looked at** (900 x 640 device px, the bench's out folder, not committed). Light, offline and Mapbox: the cream band
between the green and the yellow is gone; the green runs into yellow-green, yellow, then orange. Beach: the white band at the
green's edge is gone. The place names keep their halos.

**The 3-seed scanner** (`run.js --seeds 3 --themes light,beach --variants candidate,before-pay`, run `20261011-180508`, 13 views, no
land file served so every mark drew its land row; positive control PASS on all three seeds). The default and the kill read the
SAME on every number in all 26 views: 8 recurring shapes in 6 of 26 views (3 flickering) in both arms, ink 98-162 in both, in the
same views (world-z4, fine-z6.5 and fine-z7, light and beach). That is the count and the ink range #312's second scan reads for
its default; the shapes were not compared one by one with that run.

**That null was checked before it was believed.** The scanner printed "rendered IDENTICALLY in every view: this engine reads none of
the levers that tell them apart". Every number it prints is read from max(R,G,B), and this rule moves only a full-brightness
colour's share of white, which leaves its strongest channel at 1 and its alpha as it was: the instrument could not have read a
difference. The lever WAS read: all 26 image pairs in the run's contact sheet differ between the arms. So the result stands as
"the rule changes a streak's colour and nothing about the trail's shape or brightness", and the warning's wording now names both
causes (`report.js`, the bench README). LESSONS L-V40.

**What the crops show that this rule does not reach, said plainly:** in beach a paler peach band remains between the yellow and the
orange, in both arms (33-39 kn over land). Those are oranges over the held ground, and their white pays (0.16 to 0.31): it buys 5.6
to 17 L* of step, and without it an orange at 38-40 kn is level with its ground. It is not this defect and `pay` is not its knob
(0.25 would reach 36 kn and take step from the sea's reds). Not changed.

## 18:04-18:20Z · #312 merged under this branch; the default; and a read-back carried for another session

- **#312 was MERGED at 2026-10-11T17:27:44Z as `86306199`** (`gh pr view 312`: state MERGED, merged by the account
  `dpritzker0905-cmd`). This session read it OPEN at 17:27Z, seconds before, and built on its head `ced52301`. `git diff ced52301
  origin/dev` is empty (the squash's tree is #312's head's tree), so every "before" above is dev's too, and the branch is
  re-parented onto `origin/dev` before its PR: the PR targets dev, not #312's branch. (LESSONS L-P32, met again: a base can merge
  under a stacked branch within the minute.)
- **The default is ON, with the kill, and that is a READING.** The session that built #312 reports the owner's words to it
  (13:25 EDT) as "merge #312 and start the cream band follow-up", and reads D-020's rule onto it (a visual change the owner asked
  to see is built on, with a kill). This session did not see those words. The owner has not said which default THIS rule takes.
  Recorded as an amendment to D-020 that says so and names what would change it.
- **First-hand, static only (one Netlify file, no backend request), 18:12:01Z:** `dev--rawsurf.netlify.app/service-worker.js`
  carries `BUILD_VERSION = '86306199'`: the dev site serves #312's merge commit.

**RELAYED, not observed by this session: the read-back of #312 on the deployed dev build.** The session that built #312 ran it
(2026-10-11 17:33-17:43Z, on the owner's word to it, "check if the dev site has deployed and read it back") and asked this session
to record it, because this PR holds the ledger pen and a second PR appending to the ledger would fork the chain. As reported:

- **Static** (Netlify files, 17:33:32Z): the service worker's `BUILD_VERSION` is `86306199`; the wind chunk carries
  `__RAW_DISABLE_WIND_DARK_RULES__`, `__RAW_WIND_DARK_RULES__`, `__WIND_LAND_MASK__`, `u_land_mask` and `dark-rules`;
  `/ne_50m_land.json` answers 200, 2,764,441 bytes, 1,420 features.
- **Live** (ONE map load, in the owner's own Chrome, desktop, Merritt Island FL at a close zoom, GFS wind, data max 49.3 kn;
  17:36-17:40Z). Light: `__WIND_ENGINE__._lookKey` is `|dark-rules`; `__WIND_LAND_MASK__` is `{ status: "ready", size: 2048,
  tries: 1, ms: 79 }`; `__WIND_BASEMAP_MUTE__` is `{ applied: true, layers: 9, amount: 0.85, waterL: 0.9 }`. With
  `__RAW_DISABLE_WIND_DARK_RULES__ = true` set at runtime the key read `|` within 1.5 s and the streaks went back to the look
  before; deleted, `|dark-rules` again; no reload either way. Beach: `|dark-rules`, mute `{ applied: true, layers: 17, waterL:
  0.94 }`, the kill and back the same. Dark: `|`, mute not applied, the mask still `ready`. No console error naming wind, mask,
  WebGL or shader. The theme was switched without a second map load.
- **Also the first live read of #299's effect** (the basemap mute's layer counts: 9 in light, 17 in beach, as expected).
- **Not read:** the pale band itself (the view was mostly under 20 kn), any other zoom, a phone. **The owner's verdict on the look
  is not in.**
- **Its cost, as that session reports it, and the rule it draws:** the merge had just restarted the backend (a frontend-only merge
  redeploys it). `/api/health` before the load, 17:34:06Z: 200 in 0.35 s, uptime 3 m 47 s. After, 17:41:02Z: 200 in 10.8 to 15.4 s
  (three probes); 17:43:25Z: 4.6 to 5.4 s; telemetry n 551, two 5xx, 71 requests over 5 s, the longest 74 s. One map load on a box
  restarted six minutes earlier took the health answer from a third of a second to over ten. Its rule: read `uptime` in
  `/api/health` and do not spend the one live map load on a box a merge has just restarted. LESSONS L-P33, recorded as reported.

**What this does to ledger commitment 1047** (the read-back of #312 on the deployed build, the owner's verdict, and the re-measure
on the real basemaps if kept): the read-back half is met by the report above; the verdict and the re-measure are not. Recorded
the way the ledger carried "the rest of 94" (seq 187 and 188): a finding that closes 1047 and says which part it meets, and a new
commitment for the rest, same due date. This session made no live map load and will not for this PR: the box needs to be warm,
and the pale band needs 26-30 kn over land in view.

## 18:17-18:36Z · The owner's verdict on #312, first-hand in this session's chat; the pale-band PR is PARKED

**The owner's words to this session** (times from the chat's own stamps, EDT + 4 h):

- 18:17Z: "What I am visually seeing now is dark mode has changed, and it should not have changed. It should have been a model for the
  other modes. What is going on here? Deep research all this"
- 18:29Z: "I was wrong, dark is untouched..... It was beach mode that I mistaken for dark mode...... beach mode isn't right. Nor is
  light mode. But dark mode is good. Its the model to use"
- 18:32Z: "We need to carry on with the work to improve light mode and beach mode's wind animations and colors. Dark mode is the
  model. It needs to be copied, but with the proper colors to match the themes and the maps underneath. WE got this!!!!"

So the verdict ledger commitment 1047 was waiting for is in: **dark's rules as #312 draws them are not right in beach and not right
in light; dark is good and stays the model; the copy must carry each theme's own colours and suit the map under it.** The owner has
not said to turn #312 off, and has not said what the copy should look like beyond that sentence.

**This session's pale-band PR is parked: nothing pushed, no PR opened.** It tunes one band of a look the owner has just said is not
right, so it waits for the direction. Its state: branch `claude/serene-wiles-d3574d`, local commits `64dc8c7a`, `47eab9e4`,
`a8055c45` on top of `ced52301` (tree-equal to dev `86306199`); gates green as recorded above; the independent review found no
functional defect (1,392,768 lever, theme and max-speed comparisons of the kill against #312's source, 0 mismatches; 19 of 24
mutants killed) and three things to fix before any PR: a code comment that over-states the rule's smoothness (for reds the paying
set is all-or-nothing: a latent cliff if `pay` ever rose past 0.23), three small text mismatches, and two untested paths (the
solver's own default `pay`, and the walk-down against a plain bisection).

**Dark checked, before the owner's correction arrived (kept as evidence that #312 left dark alone):**

- GPU, offline map bench, a fresh page, dark at z4 / z6 / z8: the basemap alone, the field, and field plus marks are the SAME PNG,
  byte for byte, at `432b0135` (before #312) and `86306199` (#312).
- **A theme switch inside one engine**, which no bench mode could see (every mode builds a fresh engine and map per theme, and the
  app keeps one engine across a theme change): a scratch page drew one engine through light then dark, beach then dark, and
  dark alone, same seed, the land mask ready in light and beach. Dark after either switch is the same canvas, pixel for pixel, as a
  fresh dark (hash `53689a4f` three ways; the particle state the same too), and light after dark equals a fresh light. Engine
  `86306199`. Not covered: the app's own style swap and the basemap mute's restore (read, not run).
- **Dark's colour table since 10-07, read from the source at 30 dev merges:** it changed ONCE, at `1cdcd8d3` (#294, 2026-10-09
  21:14Z, the colour-blind palette of #292 folded in; kill `__RAW_DISABLE_WIND_DARK_CVD__`): 225 of 256 texels, 6-50 kn, up to
  15.9 dE76 at the 27 kn stop and 14.6 at 16 kn. Nothing since, #312 included (both rows of its table are that table).

**Why beach could be taken for dark, measured** (`map-run.js --ref 86306199`, the real Mapbox basemaps, Mobile Bay, z6, served wind;
`before` is #312's kill). L* and C* of the field under the marks, then of the marks:

| over LAND | field L* | marks L* | step | field C* | marks C* | share of the view that is streak |
|---|---|---|---|---|---|---|
| dark (the model) | 35.0 | 48.0 | +13.0 | 21.5 | 23.0 | 0.38 |
| light, before #312 | 74.5 | 79.5 | +4.5 | 20.0 | 19.0 | 0.52 |
| light, now | 55.0 | 68.5 | +11.5 | 15.5 | 29.0 | 0.48 |
| beach, before #312 | 68.0 | 73.5 | +3.5 | 40.5 | 34.5 | 0.48 |
| beach, now | 55.5 | 71.5 | +12.5 | 32.5 | 52.0 | 0.50 |

| over WATER | field L* | marks L* | step | field C* | marks C* | share that is streak |
|---|---|---|---|---|---|---|
| dark (the model) | 43.0 | 53.0 | +10.0 | 19.5 | 21.0 | 0.70 |
| light, before #312 | 64.5 | 74.5 | +9.5 | 28.0 | 24.5 | 0.89 |
| light, now | 56.0 | 68.0 | +11.5 | 24.5 | 51.5 | 0.85 |
| beach, before #312 | 62.0 | 69.0 | +6.0 | 34.0 | 30.0 | 0.87 |
| beach, now | 54.5 | 69.0 | +13.0 | 31.5 | 55.0 | 0.85 |

- #312 matched dark on ONE relation, the step (a streak 11.5 to 13 L* lighter than its ground, where it was 3.5 to 9.5).
- It paid for that by dimming the map under the wind to L* 55: 12.5 (beach) to 19.5 (light) L* darker over land than the theme
  was, about two fifths and half of the way to dark's own ground. That is the dusk of rule 2, and it is why beach reads as a dark
  mode.
- **It did not match dark's colour relation.** In dark a streak is its ground's colour a little lighter: the marks' chroma is 1.07
  times the field's (23.0 against 21.5; 21.0 against 19.5). In light and beach now it is 1.6 to 2.1 times the field's and 1.3 to
  2.6 times dark's marks: the solver draws each streak as its hue's MOST SATURATED colour. Dark is calm; these are loud.
- Dark's whole picture is low in colour (C* about 20 to 23 everywhere). Beach now runs 32 to 55.

**Every look the deployed engine can already draw, beside dark** (`map-run.js --ref 86306199`, the real basemaps, Mobile Bay z6; the
sheets went to the owner at 18:46Z, in the bench's out folder, not committed). LAND, field L* then marks L*, the step, field C*
then marks C*, the bench's wash verdict; served wind, then the same wind x 2.3:

| look (lever) | served: L* field > marks | step | C* field > marks | end | storm: L* | step | C* | end |
|---|---|---|---|---|---|---|---|---|
| dark, the model | 35.0 > 48.0 | +13.0 | 21.5 > 23.0 | 39.9 ok | 36.0 > 50.0 | +14.0 | 21.5 > 24.0 | 43.2 ok |
| light, before #312 (its kill) | 74.5 > 79.5 | +4.5 | 20.0 > 19.0 | 76.9 ok | 74.5 > 79.5 | +4.5 | 23.0 > 22.0 | 77.3 ok |
| light, dark's rules (dev today) | 55.0 > 68.5 | +11.5 | 15.5 > 29.0 | 60.5 ok | 57.0 > 74.0 | +13.0 | 19.5 > 34.5 | 64.9 ok |
| light, ink | 75.0 > 64.5 | -10.5 | 20.0 > 33.0 | 69.6 ok | 75.0 > 63.0 | -12.5 | 23.5 > 39.5 | 67.0 ok |
| light, glow | 74.5 > 82.0 | +6.0 | 20.5 > 23.0 | 76.5 wash | 74.5 > 84.5 | +8.5 | 26.0 > 30.5 | 78.8 wash |
| light, look A moderate | 68.5 > 76.5 | +8.0 | 38.0 > 32.5 | 71.4 wash | 68.5 > 77.5 | +9.5 | 36.5 > 40.5 | 73.6 wash |
| light, look A deep | 62.0 > 73.5 | +10.0 | 41.0 > 37.0 | 66.0 ok | 62.0 > 75.5 | +13.0 | 39.0 > 48.5 | 69.4 ok |
| light, look B (ink, capped) | 75.0 > 68.0 | -7.5 | 20.0 > 30.0 | 71.4 ok | 75.0 > 69.0 | -6.0 | 23.5 > 34.5 | 71.3 ok |
| beach, before #312 (its kill) | 68.0 > 73.5 | +3.5 | 40.5 > 34.5 | 69.7 ok | 72.0 > 75.0 | +2.5 | 47.5 > 38.5 | 73.5 ok |
| beach, dark's rules (dev today) | 55.5 > 71.5 | +12.5 | 32.5 > 52.0 | 61.7 ok | 59.5 > 77.0 | +13.0 | 39.5 > 57.0 | 67.5 ok |
| beach, ink | 68.0 > 57.0 | -11.5 | 40.5 > 47.5 | 61.8 ok | 72.0 > 57.5 | -15.0 | 46.5 > 53.0 | 62.1 ok |
| beach, glow | 68.0 > 80.5 | +9.0 | 40.5 > 48.0 | 72.0 wash | 72.0 > 82.5 | +8.5 | 47.5 > 56.5 | 76.8 wash |

Read against dark: every look that keeps the theme's own light ground and adds light reads wash (the bench's bar: the picture ends
above L* 71 with under 15% of streak pixels darker). The lightest ground on which dark's step does not wash is about L* 64 to 65
(64.5 + 0.48 x 12 = 70.3), where #312 took it to 55. The owner's earlier words on the same choice, in `windInk.js`'s header: glow
over ink in the A/B of 2026-10-10 ("I like glow better"), then "light mode washes out from the glow".

## 18:50-19:20Z · Dark watched in motion at every zoom; what makes it read as moving air; why light and beach do not

**The owner's direction** (about 18:50Z, answering this session's question on which way to take light and beach; first-hand): "Watch
how the dark mode operates using video screenshots at all zooms, then use skills and connectors and plugins of art and animations to
help further diagnose the solution. It should be more simple than its been. Light and beach modes need to visually look like air
moving, similiarly to dark does, but using their own color schemes. Dig deeper here. We got this". The two-fix design this session
had proposed a few minutes earlier (calm streaks by a chroma rule, a shallower dusk) was NOT approved and is withdrawn. No product
code was written in this section: it is a study, on scratch instruments, with the engine exactly as deployed (`86306199`).

**Instruments (scratch, in the session's scratchpad and the bench's out folder; not committed).**
- `motion-run.js`: the map bench's own `flowRun` with a STILL camera and every frame sampled: 90 or 150 consecutive 60 Hz frames of
  the real engine on the real Mapbox basemap (Mobile Bay, served GFS), saved as frames and encoded to WebM with Playwright's ffmpeg.
- `motion-analyze.js`: at every pixel and frame where a streak head arrives (L* jumps 3 or more in one frame), the average of what
  that pixel does next (the jump, the tail's fade), the share of pixels a head reaches per frame, and the heads' speed.
- `streak-shape.js`: each pixel's own darkest moment over the run as its ground; the colour of a streak's core against the ground
  under that same pixel (CIELAB), cover, step. Its width and length columns did not resolve at this capture size and are not used.
- Tools the owner asked for: the algorithmic-art skill (flow-field practice: trails that accumulate and fade; a lab the owner can
  watch is its format), the Mapbox cartography skill (a data layer over a muted base; hierarchy by contrast), the Leonardo colour
  connector (CIELAB to hex, contrast ratios), and a web research pass by a subagent (its findings are marked as such below).

**Dark, measured at zooms 3 to 11** (dark mode's own ground L* 37 to 48 in these windows):

| zoom | brightening when a head arrives (L*) | left after 4 / 8 / 16 / 23 frames | pixels a head or tail edge crosses per frame | heads' speed (css px a frame) | ink along the wind |
|---|---|---|---|---|---|
| 3 | 4.9 | 3.5 / 3.1 / 2.7 / 2.4 | 18.5% | 1.15 | 0.72 |
| 4 | 5.0 | 3.6 / 3.2 / 2.7 / 2.5 | 21.6% | 1.29 | 0.73 |
| 5 | 5.0 | 3.6 / 3.2 / 2.7 / 2.5 | 19.4% | 1.28 | 0.74 |
| 6 | 5.6 | 3.9 / 3.3 / 2.8 / 2.7 | 22.5% | 1.42 | 0.67 |
| 7 | 5.6 | 3.9 / 3.0 / 2.1 / 1.8 | 19.2% | 1.45 | 0.71 |
| 8 | 5.9 | 4.5 / 3.2 / 2.0 / 1.6 | 17.5% | 1.43 | 0.80 |
| 9 | 6.4 | 5.2 / 3.3 / 1.4 / 0.8 | 11.8% | 1.49 | 0.84 |
| 10 | 6.6 | 5.6 / 3.4 / 1.0 / 0.2 | 8.3% | 1.73 | 0.86 |
| 11 | 6.7 | 5.9 / 3.5 / 1.2 / 0.4 | 8.6% | 1.87 | 0.85 |

At wide zooms dark is a dense silk of long-lived trails (half the brightening is still there 0.4 s later); from zoom 9 in it is
sparse, separate strokes that are gone in a quarter of a second. Light and beach as deployed read alike on these timing columns
(jump 4.5 to 5.9, the same decay, heads at 1.2 to 1.9 px a frame): **the motion is the same engine's; the difference is in what a
streak IS.**

**What a streak is, in dark, from the shader and from the pixels.**
- `DRAW_FS`: a mark is a small colour core (the legend colour), a WHITE inner ring at 92% over most of its body, and a black outer
  rim that carves it out of its neighbours. `SCREEN_FS` lays the trail buffer at alpha = its own brightness x 0.505. So a dark streak
  is nearly white light at half strength at most. It is not a coloured stroke.
- The pixels agree. Colour of a streak's core against the ground under that same pixel (CIELAB, zoom 10): core `lab(55.6 -15.1
  15.8)`, ground `lab(40.2 -15.3 15.6)`: the SAME a* and b*, 15.4 L* lighter. Chroma ground to streak 22.0 to 21.9 at zoom 10,
  19.5 to 19.4 at zoom 6, and 1.00 times at zooms 4 and 8 too; the hue turns 1.5 to 2.6 degrees. **A dark streak looks coloured
  because the colour field shows through it.**

**What a streak is in light and beach today.** #312's marks run the same pipeline with the white ring cut to 25% (`DARK_RULES.ring`
0.25; dark's own is 1) and the body set to the hue's most saturated colour at full brightness, laid at up to full strength
(`opacity` 1.0, alpha = brightness squared). Zoom 10: light's core `lab(63.5 -32.8 22.4)` on ground `lab(49.3 -18.5 13.2)`, chroma
23.4 to 34.6; beach's `lab(65.7 -29.4 44.6)` on `lab(50.2 -23.1 29.5)`, 37.9 to 47.3. Enlarged, they are fat neon dashes where
dark's are thin pale wisps. Every attempt since 2026-10-10 had been trying to give the STREAK a colour of its own (the owner's
"perhaps they should have color" was read that way); in dark the streak has none.

**The one-lever test, on the deployed engine** (`window.__RAW_WIND_GLOW_RING__ = 1`: dark's own white ring; nothing else changed).
Core against ground at zoom 10, chroma ground to streak, and the WCAG contrast of core on ground (Leonardo connector):

| | core L* above its ground | chroma, ground to streak | contrast |
|---|---|---|---|
| dark, the model | 15.4 | 22.0 to 21.9 (1.00) | 1.72 |
| light today | 14.2 | 23.4 to 34.6 (1.48) | 1.62 |
| beach today | 15.5 | 37.9 to 47.3 (1.25) | 1.68 |
| light, today's field, dark's mark | 16.0 | 23.0 to 25.0 (1.09) | n/m |
| light, look A's deep field (L* 62), dark's mark | 17.5 | 33.2 to 33.3 (1.00) | n/m |
| light, look A's moderate field (L* 68), dark's mark | 14.6 | 25.3 to 25.1 (0.99) | 1.63 |
| beach, today's field, dark's mark | 16.6 | 36.4 to 37.4 (1.03) | n/m |
| beach, the field before #312 (L* 68), dark's mark | 13.1 | 40.7 to 39.8 (0.98) | 1.52 |

With dark's own mark, a light or beach streak is its ground's colour, 13 to 17.5 L* lighter: dark's relation, reproduced by one
number. (n/m: not measured.)

**The one constraint that is physics, not design: white light shows only on something deeper than itself.** The bench's style
columns for dark's mark over land, real basemaps, served wind (field L* > marks L*, the step, the bench's wash verdict; the wash
bar is the picture ending above L* 71 with under 15% of streak pixels darker):

| light | zoom 4 | zoom 6 | zoom 8 |
|---|---|---|---|
| today (coloured streaks, field 55) | 54.5 > 71.0, +14.0, ok | 55.0 > 68.5, +11.5, ok | 55.5 > 63.5, +7.0, ok |
| today's field + dark's mark | 54.5 > 75.0, +17.5, ok | 55.0 > 72.5, +15.5, ok | 55.5 > 66.0, +10.0, ok |
| field 62 + dark's mark | 61.5 > 78.5, +15.5, WASH (72.6) | 62.0 > 76.5, +13.0, ok | 62.5 > 71.0, +8.5, ok |
| field 68 + dark's mark | 68.5 > 80.0, +11.0, wash | 68.5 > 78.5, +9.5, wash | 69.5 > 75.0, +6.5, wash |
| field 75 (before #312) + dark's mark | 74.0 > 86.0, +10.0, wash | 74.5 > 83.0, +7.0, wash | 75.0 > 81.5, +5.5, wash |

| beach | zoom 4 | zoom 6 | zoom 8 |
|---|---|---|---|
| today (coloured streaks) | 59.0 > 74.5, +14.5, ok | 55.5 > 71.5, +12.5, ok | 56.0 > 63.5, +7.5, ok |
| today's field + dark's mark | 59.0 > 76.5, +17.0, WASH (71.8) | 55.5 > 73.5, +15.0, ok | 55.5 > 65.5, +9.5, ok |
| the field before #312 (68 to 72) + dark's mark | 72.0 > 83.0, +11.0, wash | 68.0 > 81.5, +10.5, wash | 68.0 > 76.0, +7.5, wash |

Dark's own row for comparison: 35 > 48, +13.0 at zoom 6. By the bar, dark's mark needs a field of about L* 60 under it. On the field
drawn today it steps FURTHER than dark does (+15.5 against +13), so the field can come up about 5 L* or the mark's strength can come
down. The bar itself rests on two of the owner's live verdicts (2026-10-10: light on glow "washes out"; beach on glow, ending at 72,
"look a lot better" and later taken off for another reason), so for beach it may be strict.

**The research pass (a subagent, web only; its findings, not this session's measurements).** Every wind product it could verify puts a
dark or a saturated mid-tone ground under pale particles before it draws them (Windy and Ventusky lay an opaque speed-colour field
over the map and draw white or pale particles that are not speed-coloured; Mapbox's particle example runs on a monochrome night
style; MapTiler's default particle is white over a colour ramp; earth.nullschool and webgl-wind draw on black). Where a light map
shows through, products switch to dark, sparse, single-hue marks (Windy's purple dashes at zoom 13; Ventusky's "Dark" animation mode;
Esri's flow smart-mapping picks dark colours on light basemaps and suggests bloom only on dark ones). The vision literature it cites
says the same thing three ways: motion is carried by lightness contrast, not hue (Cavanagh, Tyler and Favreau 1984; Lu, Lesmes and
Sperling 1999); colour does not resolve at 1 to 3 px (Mullen 1985); and marks must all sit on one side of their ground's lightness
(Edwards and Badcock 1994). It could not verify Apple Weather, Zoom Earth or Google, and several pages were blocked: its own list
of what it did not verify is in the session's notes.

**Read together.** Dark is two layers: a colour field that says how fast, and white wisps that say which way and that the air is
moving. The leaders draw it the same way. Light and beach need the same two layers in their own palettes: dark's own mark
(`ring` 1), on a field deep enough to hold it. If the owner takes that, the land and sea streak rows, the land mask, the streak
solver's three branches and this session's pale-band rule have nothing left to do (a white wisp takes whatever colour is under it,
land or sea), and "dark's rules" comes down to two numbers a theme: how deep its field is, and how strong its white is.

**A slip of this session's, corrected at once:** this section was first appended with a shell heredoc, which cut it off mid-sentence
(the known Windows heredoc hazard, LESSONS and the agent notes: write anything with a quote in it to a file first). The log was
restored to its last commit and the section appended from a file. Nothing else was touched.

## 20:09-21:05Z · The owner picked the middle row; the white streak, built ON by default (D-021)

**The owner's word, first-hand in this session's chat, 20:09Z:** "middle row for both, build it". It answered two clips sent at
about 19:40Z (zoom 10 and zoom 6, five seconds each at real speed, dev's engine `86306199` on the real Mapbox basemaps), each a
3 x 3 grid: dark in the left column; light and beach as deployed in the top row; the middle row light under
`__RAW_WIND_LIGHT_LOOK__ = 'deep'` with `__RAW_WIND_GLOW_RING__ = 1` and beach under `__RAW_WIND_GLOW_RING__ = 1`; the bottom row
the same streak over a lighter field (L* 68). This session's recommendation with the clips was the middle row; the owner took it.

**Where the work is.** A fresh branch from `origin/dev` at `86306199`: `claude/wind-white-streaks`. The pale-band work stays where
it was parked, on the local branch `claude/serene-wiles-d3574d` (five commits on `ced52301`, never pushed, no PR). Carried over
from it, file by file: this log, the lessons (L-V39, L-V40, L-P33), and the scanner's warning wording (`report.js`, the bench
README). NOT carried: `DARK_RULES.pay` and its tests, its bench arm, its amendment to D-020 and its STATE bullet. The sections
above that describe that rule describe work that was not merged.

### The "before", from the code before the edit (LESSONS L-V25)

FNV-1a of the 256-entry RGBA tables the engine uploads (marks row 0 over land, marks row 1 over sea, field), read from dev's own
code at `86306199` through a throwaway Jest file, before any edit:

| arm on dev | theme | max kn | marks, land | marks, sea | field | mark model |
|---|---|---|---|---|---|---|
| the watched arm (`'deep'` + ring 1) | light | 50 | 71ea0097 | 71ea0097 | f73f7078 | mode 2, opacity 1, ring 1, white 0 |
| | light | 75 | a49922ce | a49922ce | f9ffc9c2 | |
| the watched arm (ring 1) | beach | 50 | 6e75db94 | 72b4bd7f | 7c248d5f | mode 2, opacity 1, ring 1, white 0 |
| | beach | 75 | be558fd8 | cd4835ed | b9db3bb2 | |
| no lever (what dev draws; what the kill must restore) | light | 50 | 46e55dbb | 177f0c5b | f03b4ab5 | mode 2, opacity 1, ring 0.25, white 0 |
| | light | 75 | 6d6d01df | f1f3ef88 | bf0b2134 | |
| | beach | 50 and 75 | as the watched arm's | | | ring 0.25 |
| any | dark | 50 | c2ebc33e | c2ebc33e | none | off |

Beach's watched arm moved no table: only its ring. Light's moved all three, and its two mark rows are one row.

### The build

Three source files, 20 lines of code:
- `windDarkRules.js`: `WHITE_STREAK = { opacity: 1.0, ring: 1, white: 0 }` beside `DARK_RULES`, with the finding in its comment.
- `WindColorRamp.js`: `windWhiteStreakOn(theme, win)` = the kill is not set AND `windDarkRulesOn(theme, win)`; under it
  `darkRulesTables('light')` returns `LIGHT_LOOK_FIELD.deep` and `LIGHT_LOOK_MARKS.deep` (both rows); `windLookKey` carries
  `white`, so the engine rebuilds at once when the kill flips (`white|dark-rules`, still ending `|dark-rules`).
- `windInk.js`: where dark's rules draw, the marks are `WHITE_STREAK`'s, or `DARK_RULES`' under the kill.
The engine and the shaders are untouched. Kill: `window.__RAW_DISABLE_WIND_WHITE_STREAK__ = true`.
Also: the bench's scanner arm `before-white` (`matrix.js`); `check.mjs --before-white` and its banner.

**A choice made here, not by the owner.** Light's watched arm ran on the light-look path, where dark's rules stand down. The
build keeps light under dark's rules and hands those rules the same two tables, so that every older kill and lever still stands
the theme down exactly as D-020 promises (on the look path they would have stood aside). The one difference that leaves: the
land mask stays bound for light (`mask 1` where the watched arm read `mask 0`). Its two rows are equal, so it picks between two
identical colours: the bench reads the same pixels (below).

### Tests first

`windWhiteStreak.test.js` was written before the code and run: 44 of its 46 tests failed (no such function; the two that passed
pin behaviour dev already has). After the build: 46 of 46 (48 after the review, below). They pin the default's tables to the watched arm's hashes above and to
the live lever path, the kill to dev's hashes, dark, the look key, and that each of the 21 holds, 5 bench levers, the ink, glow
and v2 levers, an explicit light look and dark's rules' own kill stands the white streak down and draws the same with or without
its kill. `windDarkRules.test.js` pinned the previous default: 30 of its tests failed, as they should. Its solver, guard, step and
colour-blind pins now read the rules' own tables under the new kill (what it restores); its lever sweep runs both with and
without it (69,120 theme-and-lever cases, 78 draw the rules); no bar in it moved.

**Mutation check, 18 mutants, each run against four wind test files: 18 of 18 red** (and the review's four more, below: 22 of 22). Among them: ring 1 to 0.25, opacity 1 to
0.8, white 0 to 0.2, the kill ignored, a truthy value kills, on without dark's rules, light keeps the solved tables, light draws
the `moderate` field, the `moderate` streak row, a different sea row, beach takes light's tables, a table handed out uncopied, the
look key without its marker, the marks never or always taking dark's ring, an explicit light look taking the white ring.

### The look read per knot (the model; L-V34)

The head of a streak is the mark's brightest pixel: the row's colour at full brightness, mixed 0.92 x ring toward white, written at
the row's alpha and laid by dark's streak method over the tinted, muted ground.
- **Lighter than its ground at every speed, over land and sea, in both themes:** +8.5 L* at the least (beach, 3 kn over land);
  from 6 kn up +19.6 or more (dark's own head-of-streak step is about +22).
- **Near-white at every speed:** head C* 21.2 at the most; at 6-27 kn the ground under a streak is always more colourful than
  the streak's head. The field carries the colour.
- **Light's ground has the room:** over the muted land L* 65.1 at 6 kn, 57.1 to 61.4 from 9 to 27 kn, 53.6 at 33 kn, 36.0 at
  75 kn; over the sea 50.1 at 6 kn and deeper above. Calm keeps a pale tint (78.7 at 0 kn, 72.1 at 3 kn).
- **The cost, pinned as a test:** beach's ground over land at 26 to 39 kn is L* 65.5 to 72.9 (D-020's name guard keeps yellow
  and orange from being dimmed), so a white streak has less to stand on there; beach's sea has the room at every speed.

### On the GPU: is the built default the arm the owner watched?

Map bench (`map-run.js`), Mobile Bay, the served GFS grid, seed 1, zooms 4, 6, 8 and 10 at served strength and 6 and 8 at storm
strength (x 2.3). Two sides: dev's code at `86306199` with the watched levers and with none; this branch with no lever and with
the kill.

**Fixed (offline) basemap, centre crops written pixel for pixel as PNG and compared by SHA-256:** 108 of 108 crops are the
same file (36 light, 36 beach, 36 dark): dev with the watched levers against this branch with none, dev with none against this
branch under the kill, and dark against dark. Controls: on this branch the default and the kill differ in 4 of 4 full shots in
light and in beach (the lever is live), and dark's default and dark under the kill are the same file 18 times of 18. The Mapbox
basemap cannot be compared this way: its bare-map shot (no wind at all) differs between two runs at zooms 6, 8 and 10.

**Real Mapbox basemaps, every number of every row (1,800 numbers):** beach, 732 of 732 equal. Light and dark: every style number
equal bar one of light's 384 (a rounding step), and the line-survival numbers differ by 0.003 at the most, in dark as much as in
light, at exactly the zooms where the bare basemap's own edge count differed between the two runs (dark's code is untouched: that
is the size of this instrument's noise on Mapbox tiles). Light's `mask 1` against `mask 0` is the choice above.

**The built default on the real basemaps** (streaks against the field under them, over land; L* field to streak; wash bar 71):

| zoom | light | beach | dark | light under the kill | beach under the kill |
|---|---|---|---|---|---|
| 4 | +15.5 (61.5 to 78.5), ends 72.6 WASH | +17.0 (59.0 to 76.5), ends 71.8 WASH | +14.5 (35.5 to 49.5) | +14.0, ends 65.3 | +14.5, ends 70.4 |
| 6 | +13.0 (62.0 to 76.5), ends 67.6 | +15.0 (55.5 to 73.5), ends 62.6 | +13.0 (35.0 to 48.0) | +11.5 | +12.5 |
| 8 | +8.5 (62.5 to 71.0), ends 66.4 | +9.5 (55.5 to 65.5), ends 60.6 | +10.5 (36.5 to 47.0) | +7.0 | +7.5 |
| 10 | +8.5 (62.0 to 70.5), ends 65.4 | +8.0 (58.5 to 67.5), ends 62.1 | +9.5 (38.5 to 48.0) | +6.0 | +6.0 |
| 6, storm | +16.0 (62.0 to 78.5), ends 71.3 WASH | +15.0 (59.5 to 79.5), ends 68.6 | +14.0 (36.0 to 50.0) | +13.0 | +13.0 |
| 8, storm | +11.0, ends 70.6 | +9.0, ends 67.6 | +11.0 | +8.0 | +8.0 |

Every streak pixel is lighter than its ground in light and beach at every zoom (dark: 97 to 100%). Over the sea nothing reads
wash. **Streak chroma against the field's, over land:** dark 1.02 to 1.10; beach 1.05 to 1.14; light 0.67 to 0.96 (its field is
twice as colourful as dark's, and white takes that down); under the kill light 1.42 to 2.19 and beach 1.33 to 1.60 (the coloured
dashes). **Over the sea the step is larger than dark's** (zoom 6: light +21.0, beach +16.5, dark +10.0). **The map's lines kept
under field and streaks, land, zoom 6:** light 0.677 (0.588 under the kill), beach 0.659 (0.653), dark 0.652.

**Palette checker (`check.mjs`, the drawn tables):** 0 red composite lines. Colour-blind floor: light 5.6 over land and 5.5 over
water, back above the bar of 5 (4.9 and 3.9 under the kill); beach 3.2 and 3.1, unchanged and under it (`--strict` still exits
1, on beach's two lines; four under the kill).

### Gates

Jest, both trees, on the final code: 305 suites, 4,046 tests, 0 failed (dev: 304 and 3,998). `check_eslint.js`: exit 0.
`loc_ratchet.py`: no new violation (`WindColorRamp.js` 762 lines). `craco build`: compiled, exit 0 (with the lint-debt warnings the
ESLint gate ratchets); its two generated files restored. No CI floor moves: the frontend floor is raised from hosted receipts only.

### Independent review

A fresh subagent, read-only, given the commit and not this session's conclusions.

**What it verified by running.** Dev's source at `86306199` loaded beside the working tree and compared over 83,979 lever
combinations (singles, all pairs, structured products, 60,000 random) x four themes x three max speeds, 959,664 cases: with the
new kill set, the marks' bytes, the field's bytes, `windInk`, `v2SpeedPremul`, the field tint, `windDarkRulesOn`, the drawn stops
and the look key equal dev's in every case (0 mismatches); without it, nothing differs wherever dev's rules are off, nor in dark;
where dev's rules are on, beach differs only in the mark model and light's tables always differ. The default equals dev's lever
arm in marks and field bytes at every max speed from 10 to 80 kn in half-knot steps (282 cases). Every hash in the new test file,
recomputed from dev's source, matches. A key change rebuilds both of the engine's textures.

**What it found, and what was done:**
1. **The kill was untested in the engine's call shape.** Every test handed a lever object in; the engine calls these functions
   with none and reads the window. Two mutants that never read the window passed all 39 wind suites. The shipped code does read
   the window; the tests could not have told. Three tests now set the kill on the real `window` and read the look key, the
   tables and the marks as the engine does; those two mutants and two more of the same kind are red (4 of 4).
2. **`scripts/wind-color/README.md` was false** (four colour-blind red lines, light under the bar): corrected to two, with the
   three-column table, and `--before-white` added.
3. **`check.mjs` printed light's one streak row twice** (it compared references; the resolver hands out copies) and laid the
   marks with `DARK_RULES`' opacity (equal to `WHITE_STREAK`'s today): both fixed. Left and written down in its README: the same
   light tables read through `--look deep` and through the default give different mark lines (two models of how the core is
   laid); both are watch lines.
4. **One of the new tests could not fail on any table** ("the ring only adds light": true of the model whatever the tables).
   Removed.
5. **Light binds the land mask for two equal rows.** Nothing is drawn wrong; it costs a fetch and a texture read. Left for the
   cleanup, as recorded above.
6. **Six stale comments** (five described the tables as before; one in `windDarkRules.js` quoted numbers from arms that were not
   built): corrected, the last one to the built default's own bench numbers.
7. **It could not check that the owner's middle row was these levers** (the bench's frames carry no arm). This session's
   record: the capture's run list names them (`v-light-wisp62-*`: `'deep'` with ring 1; `v-beach-wisp55-*`: ring 1), and the
   built default captured again reads the same ink as those runs at zoom 10 (light 36.35 against 36.34, beach 27.51 against
   27.51) and zoom 6 (78.8 against 78.83, 54.24 against 54.24).

### What is not verified, and what it costs

- **Nothing has been seen in the app.** The bench is the real engine on the real map tiles; it is not the app.
- **Zoom 4 and a storm were not in the clips the owner watched.** By the bench's bar both themes read wash over land at zoom 4,
  and light sits on the bar at zoom 6 at storm strength. A third clip, sent to the owner with the report
  (`white-streak-built.webm`: dark, light and beach as built, at zooms 10, 6 and 4 and at zoom 6 at storm strength), shows both.
- **The gale band differs between the themes** (beach keeps its pale gold ground and gives the streak less room; light dims its
  gold). In that clip's storm row beach's band shows as a pale cream ring over the land round the storm; light's as a deeper
  yellow-green. The owner has not yet said which is right.
- **Beach's colour-blind floor is still under 5.**
- **Left for a change of its own:** beach's land and sea rows, the land mask (light binds it for two equal rows) and the streak
  solver now do little; each theme's palette under this look has not been tuned.

## 21:08-21:11Z · PR #313 opened; the ledger; what is owed

- **PR #313 opened against dev at 21:08:31Z** from `claude/wind-white-streaks` (dev `86306199` plus three commits at open). Not
  merged: the owner merges. The app's PR status at 21:09Z: open, mergeable, 8 checks pending.
- **Ledger, seq 1050 to 1056** (appended with `action_ledger.py append`; dev's ledger was this branch's before the first line;
  `verify`: 1056 entries, OK): `pr_merge #312` (owed since 17:27Z); a finding that closes commitment 1047 (the read-back, relayed;
  the owner's verdict, first-hand); the decision D-021; `pr_open #313`; the default's `flag_flip`; the review as a finding; and the
  commitment for #313's own read-back, seq 1056, due 2026-10-18.
- **Sent to the owner with the report:** `white-streak-built.webm` (the build in motion beside dark at zooms 10, 6 and 4 and at
  zoom 6 at storm strength; the bench's own output folder, not committed).
- **Owed, in order:** the owner's merge; the read-back on the deployed build (seq 1056: the look key, the kill, then the owner's
  eye at zoom 4 and on a storm); the owner's call on each theme's palette, on beach's gale band and on removing the streak rows,
  the land mask and the solver.
- **Not this session's, still open:** the 13 overdue commitments `memory_audit.py` lists (each a live read-back of backend or app
  work from earlier sessions).
