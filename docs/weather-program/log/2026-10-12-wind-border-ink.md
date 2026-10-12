# 2026-10-12 · Dark ink for the borders under the wind in light and beach (D-023), and what the bench did not draw

Local session (Windows, AMD Radeon 890M, D3D11), started by the session that built #314 with a written brief. Branch
`claude/wind-border-ink`, cut from `origin/dev` at `ec8f46a2` (#314's merge). Times are UTC.

**The owner's words this rests on** were said to the session that built #314, which recorded them first-hand in its log
(`2026-10-11-wind-dark-white`, "After the first commit"; on dev):

- 2026-10-12 01:02Z, after two side-by-side clips: "The animations do look better. The map below, I think the labels and borders
  need to be more visible. In dark mode they are white boarders and labels. So in beach and light mode, there maybe needs to be
  black borders and labels? This would be for the maps land mass below. What do you think?"

**No word of the owner's was given to this session.** That session's brief to this one says it answered yes and showed the three
border layers in dark ink live in the owner's tab (`hsl(230, 25%, 14%)` at 0.7 to 0.9: "readable at zoom 5; they stayed thin"),
and asked for the measurements below before anything was built. That the change ships ON with a kill is D-020's standing rule;
applying it here is this session's reading, as it was D-022's.

**Checked live before acting on STATE:** `git fetch` (dev at `ec8f46a2`); `gh pr list --state open` (only the draft #264);
`gh pr view 314` (MERGED 2026-10-12T01:48:08Z as `ec8f46a2`; STATE on dev still reads OPEN, so this change records the merge:
ledger seq 1063). `memory_audit.py --docs-only`: 0 FAIL, 13 WARN (the standing OVERDUE commitments, none of this lane), 14 NOTE.
**No request of this session reached the Raw Surf backend:** the benches draw Mapbox tiles and a served-grid fixture, and nothing
was loaded from the deployed app. `/api/health` was not probed (nothing here needed the box).

## 01:55-02:20Z · The three questions, measured before any product code

### 1. What draws the borders and the names, and where (the styles as the app loads them)

The three style documents were fetched from Mapbox's Styles API with the app's public token (read from the main checkout's
gitignored `.env` into the process, never printed or written). All three keep the same block, and `windLayerBeforeId` puts the
wind layer just before its first layer (`admin-1-boundary-bg`: light layer 96 of 118, beach 98 of 121, dark 96 of 118):

| layer (all ABOVE the wind) | light, navigation-day-v1 | beach, outdoors-v11 | dark, navigation-night-v1 |
|---|---|---|---|
| `admin-1-boundary-bg` (casing; opacity 0 at z7, 0.75 from z8; 3.75 to 5.5 px, blurred) | near white | `hsl(35, 12%, 89%)` to `hsl(230, 49%, 90%)` | `hsl(214, 17%, 31%)` to `hsl(250, 30%, 46%)` |
| `admin-0-boundary-bg` (casing; opacity 0.5 from z4; 3.5 to 8 px, blurred) | near white | the same two | the same two |
| `admin-1-boundary` (state line; 0.75 px to z7, 1.5 px at z12; dashed from z7) | `hsl(250, 53%, 75%)` at z3 to `hsl(250, 90%, 85%)` at z7 | `hsl(230, 14%, 77%)` to `hsl(230, 8%, 62%)` | `hsl(250, 6%, 60%)` to `hsl(250, 10%, 70%)` |
| `admin-0-boundary` and `-disputed` (country line; 0.5 px at z3, 2 px at z10) | `hsl(250, 90%, 80%)` | `hsl(230, 8%, 51%)` | `hsl(250, 10%, 65%)` |
| `state-label`, `country-label`, `settlement-*-label` | text `hsl(230, 20%, 5%)`, halo white | text black, halo white | text `hsl(215, 30%, 75%)`, halo `hsl(214, 24%, 30%)` |

No `admin`-sourced layer and no place name is below the wind in any of them (12 symbol layers in light and in dark and 7 in beach
are: road arrows and crossings).
Beach's style was not the brief's assumption: its lines are a MID GREY, not a pale tint, and they vanish for the same reason
(below). The line widths are the same in all three styles, so a contrast a pixel is a like-for-like comparison.

### 2. Above or below the wind: does a streak cut a border or a name? (No.)

The brief carried a hypothesis: a white streak at full strength is opaque at its core, so the layer ORDER might matter more than
the colour. The new border probe answers it with pixels and with a control. It finds the lines and the names from the style
(everything hidden but those layers, painted white on black: a coverage mask), and reads the largest L* change, between the map
alone and any moment under the wind, of a pixel a glyph (or a border) covers WHOLE:

| | names, wind in the app's slot | names, wind forced on top (control) | whole border pixels, slot / on top |
|---|---|---|---|
| dark z4 / z6 / z8 | 0.00 / 0.00 / 0.00 | 38.4 / 41.0 / 23.2 | 0.00 / 0.00 / 0.00 against 34.0 / 34.7 / 38.2 |
| light z4 / z6 / z8 | 0.27 / 0.21 / 0.21 | 96.7 / 96.7 / 62.8 | 0.25 / 0.12 / 0.00 against 91.8 / 87.4 / 56.2 |
| beach z4 / z6 / z8 | 0.20 / 0.27 / 0.27 | 98.2 / 98.4 / 64.2 | 0.28 / 0.30 / 0.00 against 86.9 / 86.1 / 55.3 |

Light's and beach's 0.2 to 0.3 L* is one 8-bit step in every arm, with or without ink (not explained; it is under any streak's
effect by two orders). **The borders and the names are above the wind; no streak touches them. The order is already right, and
with the wind on top an inked border would keep 21 to 45 L* of the 54 to 59 it has in its slot.** The fault is the colour alone.

### 3. How much of a border survives (dark is the bar)

`border-run.js`, the real basemaps, the real engine, the served GFS fixture at Mobile Bay, the page AND the map at device pixel
ratio 1.5 (the owner's laptop), the app's own restyle run (`syncWindBasemapMute`), 180 frames then 6 moments 0.2 s apart. A RIDGE
pixel is a land pixel on a line's centre, away from labels (4,704 / 1,001 / 440 of them at zooms 4 / 6 / 8); the number is the
median |L*| between it and the ring of ground 1.5 to 2.75 CSS px from it, under field and particles:

| under field + particles | zoom 4 | zoom 6 | zoom 8 | share of (pixel, moment) pairs under 5 L* |
|---|---|---|---|---|
| **dark (the bar)** | 11.9 | 20.9 | 28.5 | 0.105 / 0.005 / 0.008 |
| light today | 7.6 | 2.8 | 5.8 | 0.278 / 0.734 / 0.394 |
| beach today | 4.0 | 4.7 | 3.0 | 0.585 / 0.511 / 0.761 |
| light, the ink at 0.70 / 0.85 / 1.00 | 39.9 / 49.2 / 58.9 | 36.5 / 44.8 / 53.6 | 35.1 / 46.4 / 58.4 | 0.000 to 0.005 |
| beach, the ink at 0.70 / 0.85 / 1.00 | 38.9 / 47.9 / 57.2 | 34.4 / 42.3 / 50.5 | 31.7 / 41.7 / 52.1 | 0.000 to 0.003 |

- **Why they vanish.** On the bare map light's lines stand 18.7 to 23.7 L* off their ground and beach's 15.6 to 26.9 (dark's 32.8
  to 37.1). The field darkens a pale land to about the lines' own lightness: light's line goes from darker than its ground to
  LIGHTER than it (`sign` -1.0 at zoom 4, 0.0 at zoom 6, +0.9 at zoom 8), passing through nothing on the way. Beach is the worse
  of the two at zooms 4 and 8.
- **Dark's own lines are modest:** 11.9 L* at zoom 4, and a white streak under a light line takes contrast away (72% of pairs
  under half their bare contrast at zoom 4). A dark line gains from a streak under it, which is why the ink holds 31 to 40 L* at
  every zoom with no pair lost.
- **The candidates were measured before any product code** through the probe's own paint override (`--arms '{"ink70":{"ink":
  "hsla(230, 25%, 14%, 0.7)"}}'`), on the colour the owner had been shown.

**Looked at, not only measured** (`border-pre-crops/`, 900 x 600 device px): at zoom 6 light's Mississippi-Alabama line and the
Florida line cannot be found today and are thin, clear dark lines at 0.7; at zoom 4 the states read as a political map; at zoom 8
the dashed state line is delicate and readable. **Colour alone is enough; no width was changed.** The lines stay as thin as the
styles draw them (0.5 to 0.75 px at these zooms, the same as dark's).

## The build (D-023)

- **`frontend/src/components/map/windBasemapMute.js`** (the only product file; 235 to 330 lines). The mute's plan is "the area
  colours BELOW the wind layer"; the borders are ABOVE it, so the ink is a second PLAN fed to the mute's own record: one record a
  map, one restore, the same stale check.
  - `WIND_BORDER_INK.color` = `rgba(27, 30, 45, 0.7)` in light and in beach (the owner's shown colour, `hsl(230, 25%, 14%)`).
    **0.7 is the lightest strength measured, and is at or above dark's line at every zoom in both themes** (light 3.35 / 1.75 /
    1.23 times dark's, beach 3.27 / 1.65 / 1.11); it is the low end of what the owner was shown.
  - `windBorderInk(theme, win)`, `inkColor`, `inkValue`, `windBorderInkPlan(layers, windId, ink)`: line layers named `admin-*`
    (the casings `*-bg` apart) drawn above the wind; `line-color` only. `inkValue` walks the paint value and redraws each colour
    literal (its own alpha multiplied in), so `["interpolate", ["linear"], ["zoom"], 3, a, 7, b]` keeps its stops. The mute's
    walker and the ink's are now one (`mapStrings`).
  - It is laid only on a map the mute is restyling. With imagery showing under the wind (a satellite photo, a weather wash) both
    stand down. **The mute's own kill, and its lever at 0, take the ink off too** (see "This session's slips").
  - Kill `window.__RAW_DISABLE_WIND_BORDER_INK__ = true`; lever `window.__RAW_WIND_BORDER_INK__` (a CSS colour; light and beach
    only). Both are read at the next sync: a wind toggle, a theme change, or the map's next style change (as the mute's are).
  - Read-back `window.__WIND_BORDER_INK__ = { applied, layers, color, theme, at }`, or `{ applied: false, layers: 0, reason }`
    with `wind off`, `no wind layer`, `theme`, `kill`, `mute off`, `imagery:<layer id>`, `no border lines above the wind`. The
    mute's own read-back and return keep their shape (`layers` counts the muted areas only).
- **`WebGLWindLayer.js`:** the ink rides the calls that already sync the mute (the toggle, the layer's re-add, the theme's idle,
  the stale check on every style change, teardown). One call was added after the review, for the mute and the ink alike: a
  sync on every `style.load` (the section "The independent review" below).
- **Not changed:** the wind's colours, the streak's strength, the land mask, the mute's chroma numbers, the casings, the names,
  any width, opacity or dash. Dark is never inked, by a lever either.
- **Tests first** (`windBasemapMute.test.js`, 40 to 79 tests): 31 failed on the unedited code for the missing functions, then
  green; 4 more were written and failed before the review's repairs (the layer's handler, a refused write, a colour that does not
  parse). They run on the REAL styles' border block (paint as served on 2026-10-12) laid over the mute's ground, with the wind
  layer placed by `windLayerBeforeId` as the app places it, and on the app's stack (hidden satellite and weather slots under the
  wind, a radar frame above; LESSONS L-V21). The new kill is classified in `windDarkRules.test.js` (60 named; it holds nothing:
  a line above the wind is no part of the ground the rules were solved on).

## Measurements of the build

- **The built code reads the candidate's numbers, and its kill reads today's** (`border-run.js`, the same camera and seed):

  | `dL full`, zooms 4 / 6 / 8 | default | kill | read-back |
  |---|---|---|---|
  | dark | 11.9 / 20.9 / 28.5 | (none) | `ink off (theme)`, mute 0 |
  | light | 39.9 / 36.5 / 35.0 | 7.6 / 2.8 / 5.8 | `ink 3 lines rgba(27, 30, 45, 0.7)`, mute 9; `ink off (kill)` |
  | beach | 38.9 / 34.4 / 31.6 | 4.0 / 4.7 / 3.0 | `ink 3 lines rgba(27, 30, 45, 0.7)`, mute 17; `ink off (kill)` |

  Light's 9 muted layers are the count read on the deployed build on 2026-10-11 (log `2026-10-11-wind-dark-white`): the bench's
  style and layer stack are the app's there.
- **The kill is exact on the GPU** (`map-run.js --offline --app-sync --crop 900x640:png`, zooms 4, 6, 8, the camera on the offline
  map's state line): under the kill 18 of 18 crops (light, beach; off, field, full) are the same PNG, byte for byte, as
  `origin/dev` with no lever; dark's 9 of 9 with no lever; the default differs from the kill in 12 of 12 field and full crops (the
  positive control: the offline style was given the state line the ink restyles); the bare map is the same under both, 6 of 6.
- **Map mode's own columns, every line of the map, over land** (`map-run.js --app-sync`, the real basemaps; kill to default):

  | | `retF` | `retP` | `lostP` | `3:1P` |
  |---|---|---|---|---|
  | dark z4 / z6 / z8 (both arms equal, the control) | 0.817 / 0.772 / 0.747 | 0.599 / 0.653 / 0.667 | 0.346 / 0.290 / 0.261 | 0.308 / 0.597 / 0.661 |
  | light z4 | 0.541 to 0.950 | 0.680 to 1.045 | 0.263 to 0.071 | 0.923 to 0.925 |
  | light z6 | 0.770 to 0.835 | 0.695 to 0.756 | 0.248 to 0.218 | 0.776 to 0.779 |
  | light z8 | 0.696 to 0.770 | 0.658 to 0.730 | 0.235 to 0.197 | 0.745 to 0.745 |
  | beach z4 | 0.475 to 0.984 | 0.624 to 1.073 | 0.308 to 0.142 | 0.985 to 0.986 |
  | beach z6 | 0.723 to 0.787 | 0.684 to 0.742 | 0.251 to 0.217 | 0.880 to 0.881 |
  | beach z8 | 0.663 to 0.710 | 0.628 to 0.674 | 0.304 to 0.267 | 0.760 to 0.760 |

  Read with care: on these columns light and beach were ALREADY level with dark before the ink (`retP` 0.62 to 0.70 against 0.60
  to 0.67) while their borders stood 2.8 to 7.6 L* off the ground. A column over every line could not see the few the owner named
  (L-V47). `3:1P` cannot move: it asks only whether lines at 3:1 on the bare map keep it.
- **In motion, at the owner's pixel ratio** (`motion-run.js --dpr 1.5 --map-dpr 1.5 --crop 600x400 --at 0.5,0.3`, 120 frames a
  run, ten runs; every run's read-back as in the table above): two clips, dark | today | with the ink, zooms 6 and 4
  (`out/border-ink/border-ink-light.webm`, `-beach.webm`; sent to the owner).

## 03:10-03:35Z · The independent review, and the theme change it found (observed, then repaired here)

A read-only review of the diff by a separate agent (given the requirement and the files, not this session's conclusions; it read
MapLibre 5.24's source and ran its own harnesses in the scratchpad). **Verdict: nothing blocks; one should-fix.**

**1. After a theme change with the wind on, the NEW theme could be left unmuted and un-inked, with both read-backs saying
"applied".** The reviewer walked the caller's sequence by hand; this session then replayed it on the real library and the real
styles, because every bench mode built a fresh map a theme and none could see a theme change (new: `switch-run.js`,
`page/switch-probe.js`).

- **What happens.** The app changes theme with `map.setStyle(url, { diff: true })` (react-maplibre's default): the new style is
  FETCHED, then diffed into the old one; the style object and the wind's custom layer both survive. The layer's theme effect
  registers `once('idle', re-sync)`, and the map is idle a frame later. Observed, light to beach: the re-sync ran at 19 ms, on
  light's style under beach's name; beach's style arrived at 121 ms and the diff wrote its own colours over the restyle; the
  handler then asked `windBasemapMuteStale`, which compares the record's theme, amount, water factor and ink, found them equal,
  and did nothing.
- **It is a race the network decides.** A style already in the browser's cache arrives before the first idle (the good order); one
  fetched over the network arrives after it.
- **It is on dev today, for the mute.** `switch-run.js --ref origin/dev --wirings dev` (dev's module and dev's handler): in the
  order the network gave, 2 of 3 changes into a muted theme ended UNMUTED (light to beach, dark to light); in the forced
  fetched-style order 3 of 3. The read-back said `applied` each time, once with the other theme's layer count ("17 (light)").
  Since #299 the basemap has been silently left unmuted after such a theme change until the wind was toggled; the read-backs taken
  on the deployed build after a theme change could not have shown it.
- **The repair, in this change** (the ink would otherwise be missing in the very flow the owner uses to compare themes):
  `WebGLWindLayer.js`, two lines: the layer's style handler now syncs on every `style.load` (once a load or a diff; it cannot
  trade writes with another writer), and on the other style events only when the record is stale, as before. The module was
  already right once called: a sync finds its values overwritten, restores only what is still its own, and restyles the new
  theme from the new theme's colours.
- **Read back on the real library** (`switch-run.js --wirings dev,app`, four changes, both orders):

  | the layer's handler | order | changes into a restyled theme that ended inked AND muted | what the read-back said |
  |---|---|---|---|
  | before the repair | as the network gave it | 2 of 3 (light to beach: NO) | applied, in all 3 |
  | before the repair | the fetched-style order, forced | 0 of 3 | applied, in all 3 |
  | the app's, now | as the network gave it | 3 of 3 | applied 3 lines; mute 17 (beach), 9 (light) |
  | the app's, now | the fetched-style order, forced | 3 of 3 | the same |

  Light to dark ends the style's own in every row (dark is never restyled).
- **Left as it is:** in the fetched-style order, dark to light restyles DARK's map as light for the length of the fetch (its
  ground muted, its borders inked dark on a dark land) until light's style lands. About 100 ms here, and the mute alone did the
  same before. Not measured on a slow connection.

**2. Read-backs counted the plan, not the writes** (the library refuses an invalid paint value with an error event and no write;
the fake map always writes). Not reachable with today's three styles. Done here for the ink: its read-back now counts the lines
that TOOK the ink, read back from the library, and says `the style refused the ink` when none did; a lever that is not a colour
the library can read (`rgb(0 0 0 / 50%)` parsed with alpha NaN) is no longer a colour. **Not done:** the mute's own read-back
still counts its plan, as on dev; and a `match` whose LABELS are colour names (`white`, `black`, `transparent`) would have its
labels rewritten by the shared walker and be refused whole. No admin line and no muted area of the three styles is written that
way.

**3. Smaller points, each taken:** the duplicate key in `motion-run.js` (already fixed in the tree, now committed); the comment
that a partly-failed write "is retried by the next styledata" (it is undone by the next SYNC; corrected); a test of the app's
theme-change order and of a refused write (added); the build's own zoom-8 numbers in the code comment and the pin (35.0 and 31.6,
not the candidate's 35.1 and 31.7).

**4. What the reviewer said of the border probe, recorded because it bounds the numbers above:**
- A ridge pixel is a local maximum of coverage, so `dL` is the line at its best-covered pixels: an UPPER estimate of a typical
  pixel of the line. The comparisons between arms and themes stand (the widths are equal).
- Only state, country and settlement names are masked: a ridge pixel under a road shield or a water name reads the label. The
  same in every arm.
- The `windOnTop` arm lays the arm's restyle first and moves the wind after: it reads an inked line UNDER the wind, which is not
  the app under the under-labels kill (nothing is inked there). The table in question 2 uses it as the order control only.
- An arm that laid its own `ink` printed the app's read-back in the `drawn` column (corrected: it prints the arm's own).
- The order test in Jest runs on the file's own fixture of the styles: it cannot fail if Mapbox moves the admin block. The check
  on the real styles is `border-run.js --inventory` and the `names moved` column.

**Mutation check** (19 one-line mutants of `windBasemapMute.js` and the layer's handler, the mute's test file run for each): 18
red. The one that stayed green is equivalent: `wanted` nulls the ink when the mute stands down, and both readers of it already
return before using it when the mute's amount is 0.

**Byte for byte, on the real library:** `border-run.js` now reads every paint value of every layer of the style from
`getStyle()` with the wind off, before the arms and after each: exact in all six rows (dark, light and beach at zoom 6, kill and
default), and it HAD moved while the wind was on in the four restyled ones (the control).

## 03:50Z · #315 is open beside this change: what whoever merges second has to do

`gh pr list` at 03:47Z: #315 (`claude/wind-beach-sea-055`, opened 03:07Z by the session that built #314 and started this one:
beach's sea strength for the white streak, 0.77 to 0.55). Read from its diff against dev, not from a message:

- **It appends ledger seq 1063 to 1068, and so does this branch (1063 on).** Two branches that append after the same head fork
  the chain. Whichever merges SECOND merges dev, takes dev's `ACTIONS.jsonl` as it is, and re-appends its own lines after dev's
  head (LESSONS L-P21); its STATE bullet goes on top of the other's and the `Ledger head` anchor is re-read.
- **It does not record `pr_merge #314`; this branch does** (its first new line). If #315 merges first, dev owes that line until
  this one lands.
- **It takes LESSONS `L-V50`.** This branch's lessons are `L-V46` to `L-V49` (claimed in the sessions' shared notes at 02:50Z)
  and `L-V51`; the fifth was written as L-V50 and renumbered before any push.
- **It also edits STATE's top, `DECISIONS` (an amendment to D-022) and the bench README.** No file of product code is shared:
  #315 changes `windDarkRules.js` and its test; this change `windBasemapMute.js`, its test, one line of
  `windDarkRules.test.js` and two of `WebGLWindLayer.js`.

## Two things the bench's older modes do not draw (found here; their defaults are NOT changed)

- **`map-run.js` draws the wind over the style's own colours.** Its `shoot` never ran the app's restyle: the basemap mute went
  into path mode (#296, #299) and flow and motion modes (#306, #314), never into map mode (`git show origin/dev:` its `shoot` has
  no `syncWindBasemapMute`). Light's and beach's map-mode crops and style columns since 2026-10-09 are on an unmuted ground. New,
  opt-in: `map-run.js --app-sync`. The default is as it was, because its recorded numbers were taken that way.
- **A mark is sized by the PAGE's device pixel ratio and drawn on a canvas that was always 2.** `WebGLWindEngine.js` sets `u_dpr`
  from `window.devicePixelRatio` (the sprite's size is in device pixels); the bench map's `pixelRatio` was the constant 2. At the
  bench's default (page ratio 1) a mark is half its app size in CSS pixels; at `motion-run.js --dpr 1.5` three quarters. No bench
  frame before today was the owner's 1.5 in both. New: `init({ pixelRatio })`, `motion-run.js --map-dpr`, `--crop`, `--at`;
  `border-run.js` runs both at 1.5 by default. What this did to earlier numbers (D-020 to D-022's style columns and lifts) is NOT
  measured here.

## Gates

All on the final code (the local commit `bf8fd34d`, squashed into the PR's commit with the records):

- Jest, both trees (`--testMatch "**/src/components/map/**/*.test.js" "**/src/tests/**/*.test.{js,jsx}"`): 306 suites, 4,101
  tests, 0 failed (4,060 on dev; 4,094 before the review's repairs).
- `node scripts/check_eslint.js`: no never-zero rule fired, no rule over its baseline. `python scripts/loc_ratchet.py`: no new
  violation (12 grandfathered, none growing).
- Production build through Git Bash (`node update-sw-version.js && NODE_OPTIONS=--openssl-legacy-provider CI=false npx craco
  build`): exit 0, no warning from the two changed source files; the two stamped files restored.
- **Not re-run after the review's repairs:** the border table, the offline pixel identity and the motion clips above were taken
  on the code before them. The repairs do not touch what a settled map draws (the plan, the ink, the mute's numbers); a short
  `border-run.js` on light at zoom 6 afterwards read the same picture (2.9 under the kill, 36.4 with the ink, three moments
  instead of six) and `restore exact` in every arm.

## What is not verified, and what it costs

- **Nothing of this build has been seen in the app or by the owner.** The numbers are the real engine on the real basemaps at
  the owner's pixel ratio, on the bench's view (Mobile Bay), with the fixture's wind.
- **One view, one wind field, three zooms.** No border over a storm's fast band, no coast-heavy view, no zoom under 4 or over 8
  was scored. At zoom 2 to 3 the state line fades in by the style's own opacity (the ink keeps that).
- **Phones were not measured** (a higher pixel ratio draws a thin line with more pixels; the ink's colour does not depend on it).
- **The kill and the lever are not instant.** They are read at the next sync (a wind toggle, a theme change, the next style
  change), as the mute's are; `__RAW_DISABLE_WIND_DARK_WHITE__` acts at once because it is a uniform.
- **A partly-failed write is not retried by the stale check** (the record is written before the writes, so the next sync repairs
  it, but `windBasemapMuteStale` reads the record as current). This is the mute's own behaviour since #299; the next sync is now
  at latest the next `style.load`. A style that is not loaded throws before the record is written and IS retried.
- **The theme-change repair has been read on the bench's replay of the app's sequence, not in the app.** The replay is pinned to
  the layer's source by a test, and it runs the real library and styles; it is not React, and the order in the owner's browser
  depends on their cache and connection.
- **The mute's own read-back still counts its plan** (as on dev), so `__WIND_BASEMAP_MUTE__` alone cannot prove the ground is
  muted; `map.getPaintProperty('water', 'fill-color')` can.
- **The wind on top of the style** (the under-labels kill): the borders are then under the wind and are left as the style draws
  them; the read-back says `no border lines above the wind`. Unmeasured, so today's look is kept.
- **The lines are thin by the styles' own widths.** If the owner wants them bolder, that is a width change: a second variable,
  not in this change.

## This session's slips

- **I designed the two kills as independent, and an existing test said no.** With the mute's kill set the ink still drew, and the
  mute's own test ("the kill switch restores on the next sync") failed: that kill's documented meaning is "the map keeps its own
  colours". LESSONS L-V25 already says an older kill steps back past what was built on it. The ink is now laid only on a map the
  mute is restyling. Caught by running the whole file, not by reading.
- **I read the module's state machine and not the caller's order of events.** My tests of a theme change ran diff, wind off, wind
  on: the order that works. The app's order (re-sync, then the diff, then the stale check) was found by the independent reviewer
  walking `WebGLWindLayer.js`, and it fails for the mute on dev too. No bench mode changed theme, so no instrument of mine could
  have shown it (L-V51).
- **Two patches written through a shell heredoc did not run** (a quote, then an escaped newline, ended or broke the script;
  nothing was applied either time). The known hazard, twice in one session; the edits were then made with the editor.
- **An apostrophe inside a single-quoted string** in `border-run.js`; caught by `node --check` before anything ran.
- **A duplicate key in `motion-run.js`** (my new `ink` read-back overwrote the run's `ink` metric in its JSON, and the console
  line printed `[object Object]`). The frames were not affected; the field is now `borderInk`. The ten runs' JSON carries the
  read-back under `ink`.

## 03:55Z · PR #316 is open

`gh pr create` returned https://github.com/dpritzker0905-cmd/Raw-Surf-Antigravity/pull/316 at 2026-10-12T03:55Z, against dev,
from `claude/wind-border-ink` (one commit, `266e9be6`, then this line and the ledger's in a second). Not merged; the owner
merges. Ledger seq 1063 to 1070: `pr_merge #314` (1063), two findings (1064 the borders, 1065 the theme change), D-023 (1066),
the default (1067), `pr_open` (1068), and two commitments due 2026-10-19: the read-back on the deployed build by the paint, with
the owner's verdict (1069), and what the bench's two gaps did to D-020 to D-022's numbers (1070).

Sent to the owner at about 03:00Z, before the review returned (so of the border ink alone): two contact sheets (dark | today |
with the ink, zooms 4, 6, 8, device pixels at 1.5) and two 2-second clips (zooms 6 and 4). No reply yet.
