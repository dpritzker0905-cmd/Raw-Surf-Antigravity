# 2026-10-11 · Why light and beach did not mirror dark: the white, ground by ground (D-022), and what is still not dark's

Local session (Windows, AMD Radeon 890M, D3D11), the session that built #312, continuing after #313 merged. Branch
`claude/wind-dark-white`, cut from `origin/dev` at `0173f365` (#313's merge). Times are UTC; the owner's are from the chat's own
stamps (EDT + 4 h).

**The owner's words to this session, first-hand:**

- 23:23Z: "I dont see the wind for light mode or beach mode mirroring the dark mode. You need to do a deeper dive into making this
  work right. Create special instruments to help. Use video. Use connectors. Use plugins. Use skills. For art. For animation. Do a
  side by side comparison. We've been working on this for two days now. Lets make it work. You got this"
- 23:35Z, watching this session drive the deployed app in their own Chrome: "light mode and beach mode close up zoom that you're in
  looks somewhat okay. The slowest speeds of wind should be closer in color to the color of the map, which seems like they are. Its
  when you start zooming out that the contrast in theme modes happens"
- 23:43Z: "light mode is definitely a lot worse than dark mode, and beach mode is better than light mode, but not as good as dark
  mode, overall"
- 23:45Z: "light could use a lot of improvement, and beach can use improvement, just a little milder. you should be able to
  mathmatically determine"

Those words close the owner's half of ledger commitment 1056 (the verdict on #313's look): not yet dark's, and where.

**Checked live before acting on STATE:** `git fetch` (dev at `0173f365`); `gh pr view 313` (MERGED 23:14:33Z); the dev site's
`service-worker.js` `BUILD_VERSION = 0173f365` (23:26Z); `/api/health` 200 in 0.4 to 0.7 s at backend uptime 13 m 47 s (23:31Z).
The merge had restarted the backend at about 23:17Z, so the one live map load waited until the health answer had stayed fast
(this session's own rule from the #312 read-back). Health during: 1.0 s (one probe, time not stamped); after: 0.38 to 0.88 s (23:58:45Z). One map
load, in the owner's own Chrome (their choice at the #312 read-back); themes and zooms were changed inside that one page. No
request of this session's benches reached the Raw Surf backend.

## The instruments (committed with this change)

- **`scripts/wind-bench/page/mirror-probe.js`**: reads a wind picture from the pixels, frame by frame, and keeps for every pixel
  its darkest moment (the ground), its lightest (a streak's core) and its mean. One file, two entries: `capture()` on a live canvas
  (the deployed app, pasted into the console or run through a browser connector) and `fromImages()` on saved frames (the bench). A
  bench number and a number from the owner's screen now mean the same thing. Its main column is the LIFT: how far the streaks raise
  the whole picture above its ground.
- **`scripts/wind-bench/motion-run.js`** and **`compose-video.js`**: every 60 Hz frame of the real engine on the real basemaps
  with a still camera, at a chosen device pixel ratio; several runs side by side as one WebM. First written as scratch by the
  session that built #313 (its log, "Dark watched in motion"); committed here with flags, the pixel ratio and the token read as
  `map-run.js` reads it.
- **`scripts/wind-bench/mirror-run.js`**: the probe over `motion-run.js`'s frames, every run beside dark's at the same zoom;
  `--at x,y` places the crop so land and sea are read apart.
- **`scripts/wind-color/mirror-model.mjs`**: each theme's field as drawn over its own map, knot by knot (L*, C*, hue), beside
  dark's.

Tools the owner asked for: the Chrome connector (the deployed app on the owner's screen, live levers, live table uploads), the
palette checker with its colour-blind models (coloraide), Playwright's video encoder for the clips. The Leonardo colour connector
and the algorithmic-art skill were looked at and not needed: every colour number here is CIELAB from the pixels or the tables.

## 23:33-23:42Z · The owner's screen, measured (deployed `0173f365`, live wind, max 54.2 kn)

Chrome, device pixel ratio 1.5, map canvas 1620 x 742 device px, centred on Merritt Island FL. `_lookKey` `white|dark-rules`,
land mask `ready` (75 ms), basemap mute 9 layers in light (this is also the live read-back of #313: it draws). Two 400 px crops a
view (left: land and calm air; right: open sea), 120 presented frames each. Ground and picture are L*; lift = picture - ground.

| zoom 6 | ground | picture | lift | streak core L* | core C* (ground C*) | view lit at one instant |
|---|---|---|---|---|---|---|
| dark, left / right | 40.2 / 59.8 | 50.8 / 76.7 | 10.6 / 16.9 | 86.3 / 95.6 | 23.1 (28.7) / 19.7 (29.1) | 43% / 79% |
| light, left / right | 66.8 / 47.4 | 76.8 / 74.2 | 10.0 / 26.8 | 100 / 98.8 | 0 (31.2) / 4.2 (36.6) | 54% / 84% |
| beach, left / right | 65.1 / 44.1 | 72.8 / 71.2 | 7.7 / 27.1 | 96.5 / 96.6 | 12.2 (17.2) / 16.2 (23.2) | 50% / 84% |

At zoom 9 the three read close to each other (the owner: "somewhat okay"): streaks cover 9 to 18% of a crop. At zoom 4 light's
picture ended at L* 79.7 and 81.0 on grounds of 55.2 and 52.7.

**First reading, and it was half right.** The code: #313 gave light and beach dark's white ring and laid it at `opacity: 1.0`;
dark lays its trail at 0.505 (`WebGLWindEngine.js` `finalOpacity`). With the bench's lever `__RAW_WIND_GLOW_OPACITY__ = 0.5` set
live in the owner's tab, zoom 6: light's lift 6.8 / 16.9 and beach's 3.5 / 16.4 against dark's 10.6 / 16.9, and a core kept its
ground's colour (C* 11 to 33). I told the owner the white was "laid twice as strong as dark's" and that one number would ship.
**That was said before land and sea had been read apart, and it was wrong as a fix:** see the next section but one.

## 23:45-00:10Z · Light's colours, read knot by knot; a prototype in the owner's tab; why it is NOT in this change

`mirror-model.mjs`, the field on screen over each theme's land:

- **Dark:** hue sweeps one way with speed (321 at calm, 305 at 3 kn, 259 at 6, 211 at 8, 172 at 10, 149 at 16, 130 at 21, 95 at
  27, 60 at 40, 18 at 55); no reversal; L* climbs from 13 to a plateau of 46 to 50 from 10 to 27 kn. The steepest step a knot is
  11.0 dE00 (5 to 6 kn).
- **Light:** hue 350, 302 (3 kn), 290 (6), 318 (10), 129 (16), 162 (21), 126 (27): it turns back FOUR times, and at 10 kn it is
  146 degrees from dark (an orchid where dark is teal). Steepest step a knot 16.0 dE00 (11 to 12 kn). That is the pastel banding of
  a zoomed-out light view. Light's own LEGEND turns back the same way: the reversals came with the colour-blind passes.
- **Beach:** its own green family to 10 kn, then dark's hue within 15 degrees; one reversal. Its L* falls to 46.7 at 10 kn and
  returns to 53.0 at 16: a dark grey-teal band where dark only climbs.

A prototype was solved from that (light's field on dark's hue to 21 kn, lightness only falling, calm nearer the map; beach's dip
filled) and uploaded straight into the engine's textures in the owner's tab, with two side-by-side sheets sent (dark | today |
prototype, zooms 6 and 4). **Then the palette checker was run on it, and it is not shippable as solved:** light's colour-blind
floor fell from 5.5 to 2.9 (10-16 kn, tritan, over water) and 3.2 (21-27 kn, deutan, over land); beach's from 3.1 to 1.3; and
light's field sat more than 30 degrees off its own legend bar for 7.5 kn of the range. The reversals and the dip are what the
colour-blind passes bought. A constrained search (the checker's own models, lightness only falling, hue within 8 degrees of
dark's) reaches 5.11 for light with hue within 4 degrees of dark's from 3 to 21 kn; it still needs light's legend moved with the
field. For beach no fill kept the floor. **Parked on the branch `claude/wind-dark-path-wip` (one commit, never pushed); the
owner's eye and call first.** The prototype stays visible in the tab this session left open in the owner's Chrome.

## 00:20-00:55Z · Land and sea read apart: the finding

A first build laid the white at dark's 0.505 on both grounds (tests first, both Jest trees green). Then it was captured in motion
beside dark and the kill (`motion-run.js`, the real basemaps, Mobile Bay, served GFS, device pixel ratio 1.5, 120 frames a run)
and read with the probe over the land (`--at 0.5,0.12`) and over the sea (`--at 0.5,0.9`). Lift against dark's at the same zoom:

| lift / dark's lift | land z6 | land z4 | land z9 | sea z6 | sea z4 | sea z9 |
|---|---|---|---|---|---|---|
| light, as deployed (1.0 on both grounds) | 0.85 | 0.74 | 0.30 | 1.62 | 1.53 | 1.64 |
| light, 0.505 on both grounds | 0.48 | 0.41 | 0.01 | 0.94 | 1.05 | 0.91 |
| beach, as deployed | 0.93 | 0.80 | 0.70 | 1.23 | 1.46 | 1.06 |
| beach, 0.505 on both grounds | 0.67 | 0.49 | 0.40 | 0.74 | 1.01 | 0.64 |

**Dark's map is light's and beach's turned over.** Dark has a near-black land and a slate sea; they have a pale land and a deep
sea. Over a pale land there is no room above the ground: even full white lifts the picture less than dark's streaks lift dark's
land. Over a deep sea full white lifts it half as far again as dark's, and its cores go near paper white. #313's one strength was
calibrated on a view that is mostly land (the bench's centre crop reads 1.05 of dark's at zoom 6: "equal"); the owner's zoomed-out
view is mostly sea. One number cannot fit both grounds; halving it everywhere would have halved a lift over land that is already
short. **The global number was dropped before anything was pushed.**

## The build: the white by the ground under the mark (D-022)

- **Rule:** full strength over land; over the sea, the share of full at which the lift equals dark's, the median over zooms 4, 6
  and 9 of the strength interpolated between the two measured (0.505 and 1): **0.55 in light, 0.77 in beach**.
- **`windDarkRules.js`** `DARK_WHITE`; **`WindColorRamp.js`** `windWhiteStrength(theme)`; **`windLandMask.js`**: `u_white` in
  the mark shader's land block, set by `bindLandMask` as the square root of each strength (the screen pass lays a trail at its
  level squared). **`WebGLWindShaders.js`** (two lines in place): the mask sample the row pick already made is kept and scales
  the mark's light, never its cover. **`WebGLWindEngine.js`** (two lines in place): the import, and the strengths handed to the
  bind. Both files are at their size limits (1,029 and 1,074 lines) and did not grow.
- **Kill:** `window.__RAW_DISABLE_WIND_DARK_WHITE__ = true`. No table, mark model or look key moves.
- **Tests first** (`windDarkWhite.test.js`, new, 12; `windLandMask.test.js` +1): 7 failed on the unedited code, then green. Three
  source pins in `windDarkRules.test.js` moved to the lines as they are now; the new kill is classified there (59 named, 21 hold,
  38 do not, 0 unclassified).

## Measurements of the build

**The same bench, the build beside dark** (lift against dark's; land crops at zooms 6 and 4 read the numbers before, to the digit):

| over the sea | zoom 6 | zoom 4 | zoom 9 | streak core L* at zoom 6 | core C* / ground C* |
|---|---|---|---|---|---|
| dark | 1 (lift 12.6) | 1 (10.4) | 1 (6.9) | 63.1 | 0.92 |
| light before / now | 1.62 / 1.03 | 1.53 / 1.22 | 1.64 / 1.07 | 88.5 / 67.1 | 0.91 / 0.95 |
| beach before / now | 1.23 / 1.01 | 1.46 / 1.34 | 1.06 / 0.91 | 87.9 / 78.6 | 0.89 / 0.92 |

Over land at zoom 9 light reads 0.26 (0.30 before) and beach 0.69 (0.70): that crop holds a coast, and the mask eases across it.
The centre crop (land and sea together): light 0.84 of dark's at zooms 6 and 4 (1.05 before), beach 0.96 and 0.98 (1.07, 1.09).

- **Controls in the same run:** the kill arm on this tree reads the deployed arm's numbers (ink 87.70 against 87.75 in light,
  64.72 against 64.72 in beach); dark captured twice reads 34.48 and 34.49.
- **The kill is exact on the GPU:** `map-run.js --offline --crop 900x640:png`, zooms 4, 6 and 8, three themes, three shots each:
  27 of 27 crops under the kill are the same PNG, byte for byte, as `origin/dev` with no lever; dark's 9 are the same with no
  lever set. (With no lever, light's and beach's `full` shots differ from the kill's, as they should; so do four of their six
  `field` shots, which is not the field moving: that shot runs a 2 x 2 engine, four marks, and at zooms 4 and 8 one lies over the
  sea. Read from the bench's code, not isolated.)
- **Palette checker, `check.mjs --strict`:** exit 1 with the same two red lines as on dev (beach's colour-blind lines, 3.1 over
  water and 3.2 over land); nothing new red. Against `--full-white` only the marks' watch lines over WATER move (the core against
  its tint: 18.2 to 10.2 L* in light, 16.0 to 12.3 in beach).
- **Gates:** Jest, both trees: 306 suites, 4,060 tests, 0 failed (4,059 at the run the ledger's flag_flip line quotes; one test, the bench's name for the kill, was added before the commit). `check_eslint.js`: no rule over
  its baseline. `loc_ratchet.py`: no new violation. The production build and the 3-seed scanner: see "After the first commit" below.

## What is not verified, and what it costs

- **Nothing of this build has been seen in the app.** The numbers are the real engine on the real basemaps at the owner's pixel
  ratio, on a bench view (Mobile Bay), not the owner's.
- **Zoom 4 over the sea is still 1.2 to 1.3 of dark's lift.** The median was taken; a per-zoom number was not built.
- **The land is not helped.** Light's streaks over land lift the picture 0.26 to 0.85 as far as dark's, as before.
- **The two sea numbers are measurements on one view and one wind field,** interpolated between two strengths. They were not
  re-solved after the build read 1.22 and 1.34 at zoom 4.
- **The mask is coarse** (a texel is about 20 km): near a coast the strength eases across it; inland lakes are laid as land;
  with no mask (loading, or failed) every mark is laid as over land.
- **The scanner's own page serves no land file,** so it cannot see this change (LESSONS L-V40): its arms are equal there by
  construction. The motion bench is where it was read.
- **Phones:** not measured.
- **This session's own slips:** the claim to the owner that one number would ship (above); and three scratch scripts written
  through a shell heredoc lost their backslashes (a regular expression in `motion-run.js` was written with a real line break in
  it and failed to parse; caught by `node -c`, fixed from a file). The known hazard; the files that matter were written with the
  editor.

## After the first commit (`f2ac199c`): the scanner, the build, the owner's reply

- **The 3-seed scanner** (`run.js --seeds 3 --themes light,beach --variants candidate,full-white`, 162 runs): positive control PASS on
  all three seeds. The default and the kill read the SAME on every number in all 26 views (8 recurring shapes in 6 of 26 views, 4
  flickering, ink 98 to 162 in both). **That null is by construction, not a finding:** the scanner's page serves no land file (its
  three 404s are the mask's three tries), so every mark is laid as over land in both arms. It shows the fallback is #313's picture;
  it says nothing about the sea. The count is the one #313's log reads for its default.
- **Production build:** `node update-sw-version.js && NODE_OPTIONS=--openssl-legacy-provider CI=false npx craco build` through Git
  Bash, exit 0; the two stamped files restored.
- **The owner, 2026-10-12 01:02Z, after the two side-by-side clips (dark | before | now, zooms 6 and 4, light and beach):** "The
  animations do look better. The map below, I think the labels and borders need to be more visible. In dark mode they are white
  boarders and labels. So in beach and light mode, there maybe needs to be black borders and labels? This would be for the maps
  land mass below. What do you think?" Read on the deployed light style in the owner's tab: the state and country lines
  (`admin-1-boundary`, `admin-0-boundary`) are pale lavender (`hsl(250, 90%, 80-85%)`), which is why they vanish under a lilac
  field with white streaks; the place labels are already near-black (`hsl(230, 20%, 5%)`) with white halos. Set to dark ink live
  (`hsl(230, 25%, 14%)`, opacity 0.7 to 0.9) they read at zoom 5, thin. This session's answer: yes, for the reason dark works (its
  borders and labels are the lightest thing on the map and streaks only add light), with one caution (a full-strength streak over
  land is opaque at its core, so the layer order may matter as much as the colour). **Not built here:** proposed to the owner as
  its own change (beach's style was not read; the natural home is `windBasemapMute.js`).
- **Left in the owner's Chrome:** one tab of this session, open on the dev site, showing two PROTOTYPES and not this build: light's
  field on dark's hue path with a global 0.505 white (`mirror(false)` / `mirror(true)` in its console) and the borders in dark ink
  (`borderInk(false)` / `borderInk(true)`). Nothing in it persists past a reload.

## 2026-10-12 01:48Z to 02:20Z · #314 merged; the read-back on the deployed build; the count of moving marks

- **Merged:** the owner, "merge #314 and start the borders and light colours follow-ups". Squash-merged 2026-10-12T01:48:08Z as
  dev `ec8f46a2`. Two sessions were started for the follow-ups (border ink under the wind; light's colours on dark's hue path).
- **Read back** in the owner's Chrome on the dev site (build `ec8f46a2` by its `service-worker.js`; one map load, made after the
  backend had been up 15 minutes and `/api/health` answered in 0.46 to 0.75 s; the window's device pixel ratio was 3, canvas
  3240 x 1725, not the owner's usual 1.5; the live field reached 67.1 kn): the mark program's `u_white` reads `[1, 0.7416]` in
  light, `[1, 0.8775]` in beach, `[1, 1]` in dark and under the kill; the look key is `white|dark-rules`; the land mask is ready
  (68 ms). With `page/mirror-probe.js` over one open-sea crop at zoom 6:

  | zoom 6, open sea | ground L* | lift | core L* | kept | lift / dark's |
  |---|---|---|---|---|---|
  | dark | 59.8 | 15.5 | 93.6 | | the model |
  | light, as built (0.55) | | 16.1 | 87.8 | 0.54 | 1.04 |
  | light, the kill set | | 24.8 | 98.7 | 0.12 | 1.60 |
  | beach, as built (0.77) | 43.8 | 21.2 | 92.8 | | 1.37 |

- **What the read cost (the warm-box rule was kept and was not enough):** `/api/health` answered in 6.6 to 8.1 s at 02:16:19Z,
  right after the read, and in 0.36 to 0.67 s at 02:19:33Z; no 5xx. The page had been taken from zoom 9 to 6 and back, and each
  zoom band asks for new 48-frame wind series pages (`GET /api/weather/grid_series`: 33 requests, median 10 s, longest 21.5 s).
  A live read keeps the zoom it loaded at; the bench is for several zooms.
- **The owner asked:** "double check that the animations counts are near the dark mode settings for beach mode and light mode, in
  terms of density of animations moving". Read on the same deployed page: the engine draws the same marks in all three themes
  (147,456 particles; the share kept 0.2972 at zoom 6 and 0.0322 at zoom 9; the thinning and the close-zoom density both 1).
  Head arrivals per presented frame at zoom 9 (13.8 frames a second in both): dark 0.035 over the sea and 0.025 over land, light
  the same. The share of the view lit at one instant, sea / land: zoom 6 dark 0.777 / 0.528, light 0.771 / 0.576, beach 0.791 /
  0.569; zoom 9 dark 0.171 / 0.089, light 0.151 / 0.127, beach 0.170 / 0.136. The count is equal; over land at zoom 9 light and
  beach light about 1.4 to 1.5 times as much of the view as dark at one instant; over the sea the three are within 12%.
- **An independent review of the merged change** (a fresh agent, the diff and the records, after the merge): no code defect
  (under the kill and in dark nothing differs from the code before across 6,093 lever combinations). Four errors in these
  records, corrected in DECISIONS D-022 ("Corrected 2026-10-12") and in the bench's README: the lifts above were all read with
  `mirror-run.js --size 360` and no size was named; D-022's read-back criterion (`kept` above about 0.9) is the bench's, not the
  deployed page's; the README's example paths resolved to `frontend/out/`; and **the checker paragraph above omitted two watch
  lines that moved with D-022** (the marks' own colours, colour-blind: light 3.6 to 2.5 dE00, beach 2.6 to 2.0; watch lines,
  not floors).

## 2026-10-12 02:27Z to 03:10Z · Beach's sea at 0.55 (the owner's word), and why the bench and the screen had disagreed

- **The owner, 2026-10-12 02:27Z, after the read-back above:** "make the beach sea strength change to 0.55". This session had
  recommended it from the one live row above (beach 1.37 of dark's lift at 0.77; light 1.04 at 0.55).
- **Built, tests first:** the three pins in `windDarkWhite.test.js` moved to 0.55 and failed on the unedited code (3 of 13), then
  `DARK_WHITE.beach.sea` 0.77 to 0.55 (`windDarkRules.js`, one number and its comment). The per-knot thresholds were re-read from
  the model, not guessed: over the sea at 0.55 a beach core keeps at least 0.376 of its ground's colour (47 kn; 0.183 at 0.77),
  peaks at L* 82.1 (29 kn; 90.9) and stands 22.7 to 36.8 L* off its ground (31.5 to 50.4): **the cost is beach's 29 kn band, held
  pale, where a core is now 22.7 L* off its ground.** No table, key, shader or engine line moves.
- **The bench, the same view and crops as D-022's** (`motion-run.js --dpr 1.5`, 120 frames a run, `mirror-run.js --size 360`).
  Controls first: dark's lift 12.6 / 10.4 / 6.9, the kill arm 1.23 / 1.46 / 1.06, light 1.03 at zoom 6 and the inks (dark 34.48,
  the kill 64.72) are the earlier run's, to the digit.

  | beach, lift / dark's lift | sea z6 | sea z4 | sea z9 | land z6 | land z4 | land z9 |
  |---|---|---|---|---|---|---|
  | the kill (1.0 on both grounds) | 1.23 | 1.46 | 1.06 | 0.93 | 0.80 | 0.71 |
  | 0.77 over the sea (D-022 as merged) | 1.01 | 1.34 | 0.91 | 0.93 | 0.80 | 0.69 |
  | **0.55 over the sea (this change)** | **0.80** | **1.19** | **0.74** | 0.93 | 0.80 | 0.69 |

  At zoom 6 over the sea the streak core's L* is 70.9 (78.6 at 0.77, 87.9 under the kill; dark's 63.1) and the cover 0.896 (dark
  0.922). **On the bench's view 0.55 puts beach UNDER dark's lift at zooms 6 and 9.**
- **Why the deployed read said 1.37 where the bench said 1.01: the wind's strength.** Two more captures, one variable each, zoom
  6 over the sea:

  | zoom 6, sea | dark's ground L* / lift | beach's ground L* | beach 0.55 | beach, the kill | light 0.55 |
  |---|---|---|---|---|---|
  | the wind as served, dpr 1.5 | 36.7 / 12.6 | 49.6 | 0.80 | 1.23 | 1.03 |
  | the wind x 2.3 (`scale`), dpr 1.5 | 43.9 / 11.8 | 42.0 | 1.07 | 1.70 | 1.23 |
  | the wind as served, dpr 3 | 41.3 / 13.5 | 52.7 | 0.84 | 1.35 | 0.98 |

  With the wind scaled, beach at 0.77 works out to 1.38 of dark's lift (between the two measured strengths): the deployed read.
  A stronger wind brightens dark's own ground and deepens beach's, so the same white lifts beach further and dark less. The
  pixel ratio moves it by 0.04. **So 0.55 is dark's lift in a storm and a quieter streak than dark's in a breeze; 0.77 was the
  reverse; no one number is both.** The recommendation was made before this was known (LESSONS L-V50). Light reads 1.23 in the
  scaled wind on the bench and read 1.04 in the live 67 kn field: the two strong-wind scenes do not agree for light, and that
  is not explained here.
- **Palette checker** (`check.mjs --strict`): exit 1 with the same two red lines as dev (beach's colour-blind tint lines, 3.1
  over water, 3.2 over land). Two lines move, neither a floor: `water: speed-colour core vs its own tint` weakest at 8 kn, 12.3
  to 8.8 L* (watched below 3); `beach marks (the look's own colours), colour-blind` weakest at 3 to 6 kn, 2.0 to 0.8 dE00
  (protan; a watch line).
- **Gates:** Jest, both trees: 306 suites, 4,060 tests, 0 failed. `check_eslint.js` exit 0. `scripts/loc_ratchet.py`: 0 new, 0
  regressed. The production build (`node update-sw-version.js && NODE_OPTIONS=--openssl-legacy-provider CI=false npx craco
  build`, Git Bash): exit 0; the two stamped files restored.
- **Not verified:** nothing of 0.55 has been seen in the app. The 3-seed scanner was not rerun (its page serves no land file,
  so it cannot see a sea strength: L-V40). Zooms 4 and 9 were not read in the scaled wind. Phones: not measured.
- **Not built, the owner's calls:** a sea strength that follows the wind's speed (the mark shader holds the speed; it would
  fit a breeze and a storm both); the `bindLandMask` guard the review named.
