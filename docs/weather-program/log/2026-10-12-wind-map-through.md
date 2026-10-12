# 2026-10-12 · Seeing the map through the wind in light and beach: the coast in the borders' ink (D-028)

Local session (Windows, AMD Radeon 890M, D3D11), the lead of the light/beach wind lanes (the session of #314, #315, #320, #321).
Branch `claude/wind-map-shows-through`, cut from `origin/dev` at `b764797b` and brought up to `a022b398` (#322's merge). Times UTC.

**The owner's words this rests on** (this session's chat, first-hand):

- 19:05Z, on the deployed dev build with #321, #320, #315, #319 and #318 on it: "Visually observing, I still cannot see the map as
  well through the wind animations on light or beach modes. Dark mode I can see the map underneath it, better. The map is glowing
  through? I am not sure exactly, but we're on day 3 of working on just making light wind and beach wind work well. Lets use all
  we've learned over the past few days, study the maps and make this work".
- 19:43Z: "make sure your sub agents arent working against you too, we got this".
- 20:02Z, watching this session's clips of dark beside light and beach: "I can see in your screenhot videos, that lighter moving
  air/wind in dark mode is almost transparent, or even smaller animations than in beach or light mode. You need to really compare
  deeply each aspect to make this work perfectly".

Nothing in this log was seen in the app. Every number is the wind bench on the real basemaps at the owner's pixel ratio (1.5),
Mobile Bay, unless said.

## 19:05-19:35Z · What "the map shows through" is, measured on dev

Three reads of `origin/dev` `b764797b`, dark as the bar.

**1. The land against the sea** (`ground-run.js`, the hurricane fixture, zoom 6; L\* medians):

| | own map, land / sea | as restyled under the wind | under the field |
|---|---|---|---|
| dark | 29.3 / 47.7 | no restyle | 33.5 / 42.5 |
| light | 97.7 / 84.9 | 76.2 / 74.2 | 52.4 / 46.9 |
| beach | 91.6 / 78.9 | 75.3 / 72.5 | 48.4 / 48.2 |

The hurricane's sea is windier than its land, so its field differs over the two. On a speed ramp (one speed a column over land and
over sea; `ground-run.js --fixture <ramp 2 to 30 kn> --strips 12 --full 60`, new today), land minus sea in each of 12 bands, the
median, and `kept` = the share of the own map's land-sea Michelson contrast still there:

| | own | restyled | under the field | with the streaks (60-frame mean) |
|---|---|---|---|---|
| dark | -18.4 | -18.4 (1.00) | -9.4, from -11.5 to -8.5 (0.52) | -5.4 (0.25) |
| light | +12.7 | +2.1 (0.19) | +1.1 (0.14) | +1.0 (0.11) |
| light, `__RAW_DISABLE_WIND_LAND_DEPTH__` | +12.7 | +23.7 (1.91) | +16.0 (1.83) | +18.0 (1.73) |
| beach | +12.7 | +2.7 (0.24) | +1.9 (0.23) | +2.8 (0.32) |
| beach, the same kill | +12.7 | +18.9 (1.51) | +12.3 (1.43) | +19.0 (1.72) |

Light and beach lay the field as a MULTIPLY (`V2_FIELD_TINT`), which passes the map's contrast ratios through: their map is
flattened by the restyle under the wind (`windBasemapMute.js`: the sea darkened by `waterL`, then the land darkened to it by D-026),
before any wind is drawn. Dark's field is an alpha film: it keeps half of dark's land-sea step, with its sign.

**2. Every edge of the bare map** (`map-run.js --app-sync`, zooms 4 / 6 / 8, the water-side edges; `retF` = contrast kept under
the field, `lostP` = share under half their contrast under field + particles):

| | retF | lostP |
|---|---|---|
| dark | 0.89 / 0.93 / 0.90 | 0.26 / 0.16 / 0.10 |
| light | 0.43 / 0.44 / 0.42 | 0.47 / 0.52 / 0.61 |
| light, land depth killed | 0.70 / 0.68 / 0.60 | 0.18 / 0.12 / 0.17 |
| beach | 0.78 / 0.44 / 0.51 | 0.40 / 0.54 / 0.60 |
| beach, land depth killed | 1.00 / 0.68 / 0.71 | 0.19 / 0.22 / 0.26 |

**3. The pictures.** At zoom 4 Florida is a shape in dark (a darker land in a pale outline) and is not there in light or beach:
borders and names on one coloured sheet. With the land depth killed it returns as a pale body, and the streaks over it wash out.

## 19:35-20:00Z · Which lever: the coastline stroke, not the land

The wind layer lays a coastline stroke above itself (`WebGLWindUtils.js` `WIND_COASTLINE`): pale slate at 0.45 in dark, dark slate
at 0.42 in light and 0.28 in beach, solved on the bench on 2026-10-09 when light's and beach's ground was pale. `border-run.js
--lines coast` (new today: the border probe on that one layer; its ground is the ring on both sides of the line) reads the stroke's
best-covered pixels against the ground beside them under field + streaks, L\*, zooms 4 / 6; arms are the bench's own paint on dev's
code:

| | dark | light | beach (zoom 4) |
|---|---|---|---|
| as drawn on dev | 17.1 / 24.5 (lighter) | 16.9 / 21.0 (darker) | 11.8 |
| the border ink's colour at 0.55 | | 26.2 / 32.9 | 24.7 |
| at 0.75 | | 33.8 / 41.0 | 31.4 |
| at 0.95 | | 41.2 / 47.4 | 37.8 |
| dark's own pale line at 0.45 | | 9.8 / 13.0 | 11.5 |
| a paler line at 0.75 | | 21.2 / 27.0 | 24.1 |
| the land lifted to the sea's own factor (0.90 / 0.94), stroke as on dev | | 20.3 / 25.3 | 14.7 |

**The instrument and the eye disagreed, and the eye was right** (LESSONS L-V74): by its best pixels light's stroke on dev is level
with dark's (16.9 against 17.1 at zoom 4), and on the crops Florida is drawn in dark and absent in light. A pale hairline on a
deep ground carries; a dark hairline of the streaks' own width, among white streaks, on a ground that is now dark itself, does not.
On the crops the ink at 0.75 draws Florida, the Gulf coast, the delta, the lakes and the wide rivers in both themes; the paler line
competes with the streaks; the lifted land moves the picture little and pales the streaks over land. So: the stroke, in the
borders' ink, and the land left where the owner put it.

## 20:00-20:35Z · Built, measured, reviewed

**What draws.** `windBasemapMute.js`: while the borders are inked (D-023) the layer `wind-coastline` takes the same ink
(`rgba(27, 30, 45, 0.7)`) and its `line-opacity` goes to 1: `windCoastInk`, two entries in `windBorderInkPlan` marked `coast`, laid
and lifted by the mute's one record. Kill `window.__RAW_DISABLE_WIND_COAST_INK__`; lever `__RAW_WIND_COAST_INK__` (0.1 to 1);
read-back `window.__WIND_COAST_INK__`. Dark, the ink's kill, the mute's kill and imagery under the wind leave the stroke the layer's own.

**Measured on the built code** (`border-run.js --lines coast`, arms `ink` = the default and `kill`; L\* under field + streaks at
zooms 4 / 6 / 8 / 10; `weak` = share of (pixel, moment) pairs under 5 L\*):

| | L\* | weak |
|---|---|---|
| dark (the bar) | 17.1 / 24.5 / 23.9 / 21.1 | 0.051 / 0.010 / 0.010 / 0.021 |
| light, the ink | 31.8 / 39.1 / 32.2 / 28.4 | 0.007 / 0.001 / 0.006 / 0.017 |
| light, the kill | 16.9 / 21.0 / 15.5 / 12.6 | 0.050 / 0.015 / 0.014 / 0.019 |
| beach, the ink | 29.7 / 37.1 / 29.4 / 25.0 | 0.009 / 0.001 / 0.003 / 0.008 |
| beach, the kill | 11.8 / 14.9 / 9.9 / 8.2 | 0.187 / 0.097 / 0.120 / 0.139 |

The kill arm reads dev's numbers to the digit (16.9 / 21.0, 11.8): its control. Share of the stroke under half its bare contrast:
light 0.46 / 0.42 / 0.82 / 0.82 under the kill, 0.01 or less with the ink.

**The independent review** (a fresh agent given the diff, not the conclusion; it ran the suite against 20 mutants of its own, 14
killed) found, in order:

1. **On dev today a theme change with the wind on leaves NO coastline at all.** A theme change diffs the new style into the
   map's style; the custom wind layer survives and the coastline, a style layer the new style does not name, is removed; the
   layer's handler added the coastline only together with the wind layer. Read on the real library (`switch-run.js`, which
   gained a `coastline` column and the wiring `nocoast` = the handler before this change): **gone in 8 of 8 changes** (light to
   beach, beach to light, dark to light, light to dark, in both orders of the re-sync), into dark too. Fixed in
   `WebGLWindLayer.js`: the handler puts the stroke back in its slot before anything else (`windCoastlineWanted`, cheap, asked
   first). With it: there in 8 of 8, inked in the six that end in light or beach, dark's own in the two that end in dark.
2. A stroke added after a sync was never inked (the stale check and the sync's early return did not look for it). Fixed: the
   record holds whether the stroke was there, and both compare it.
3. The stroke rode the ink that was ASKED for, not the ink that took; and with one of its two values refused it was left half
   inked. Fixed: it needs a border that took, and it is whole or the layer's own.
4. A rebuilt stroke whose own opacity equalled ours (the opacity lever at 1) was "restored" to the last layer's 0.42. Fixed: the
   stroke is ours only as a whole.
5. Left, and pinned as known: in the fetch window of a dark-to-light change the re-sync can run on dark's style under light's
   name (the window D-023 already has for the borders); with the theme still dark nothing is written.
6. Bench: `ground-probe.js` lifted a run's levers before the app's restyle (swapped); border mode's coast rows now carry the
   stroke's own read-back.

**Tests.** 79 to 100 across `windBasemapMute.test.js` and the new `windCoastInk.test.js` (the fixtures moved, unchanged, to `basemapStyle.testutil.js`: the first file had crossed the 800-line ratchet): the plan, the sync, the kill, the lever, the ride on the ink, imagery, a refused
stroke, a late stroke, a dropped and re-added stroke, the handler's text and order. One existing test pinned "the coastline keeps
the style's own values": it is the pin this change overturns, and it now holds to the letter under the kill. The fixture draws each
theme's own stroke (it drew light's in all three). 14 mutations of the change, 14 red (7 before the review, 7 of its fixes).

## 20:02-20:30Z · The owner's second observation: what a streak IS by speed (measured; NOT changed here)

`anatomy-run.js` (new today): on the ramp, by band, a streak's colour (the median mark pixel and the core against the field), size
(the bright BODY's length and width; the whole mark with its tail) and amount (cover, body share, streaks met along the wind).
Light against dark at zoom 6, dev's code (beach is within 0.1 of light on every row but chroma):

| kn | 3.2 | 5.5 | 7.8 | 10.2 | 12.5 | 14.8 | 17.2 | 19.5 | 21.8 | 24.2 | 26.5 | 28.8 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| sea, body share | 2.32 | 1.64 | 1.39 | 1.41 | 1.33 | 1.38 | 1.27 | 1.29 | 1.27 | 1.33 | 1.41 | 1.42 |
| sea, body length (90th pct) | 1.96 | 2.22 | 1.82 | 1.73 | 1.52 | 1.41 | 1.49 | 1.39 | 1.48 | 1.81 | 2.33 | 2.44 |
| sea, streaks met | 2.12 | 0.95 | 0.90 | 0.94 | 0.96 | 1.03 | 0.95 | 1.04 | 0.88 | 0.81 | 0.63 | 0.60 |
| sea, core L\* over the field | 0.73 | 0.86 | 0.89 | 0.94 | 0.98 | 1.01 | 1.02 | 1.02 | 1.04 | 1.08 | 1.10 | 1.13 |
| land, body share | 2.03 | 1.34 | 1.24 | 1.23 | 1.21 | 1.22 | 1.16 | 1.15 | 1.16 | 1.21 | 1.27 | 1.28 |
| land, body length (90th pct) | 1.32 | 1.41 | 1.41 | 1.47 | 1.33 | 1.25 | 1.29 | 1.16 | 1.21 | 1.40 | 1.71 | 1.73 |

Width is equal to 24 kn. So the cores and the width mirror dark's and the profile ALONG the streak does not: light's and beach's
bright bodies cover 1.2 to 2.3 times the area and run 1.2 to 2.4 times as long, most in light air and in a gale. Dark's own shape,
over land at 3.2 / 5.5 / 7.8 kn: a core 38 / 32 / 29 L\* over the field against a median mark pixel of 9 / 14 / 14.

**The cause, read in `SCREEN_FS`.** Dark lays a trail as `rgb x a` over `(1 - a) x map` with the trail's own faded rgb: against its
peak that is `b (b - m) / (1 - m)`, where `b` is the trail's brightness and `m` the ground's level over the trail's colour. It is
zero at `b = m` and negative under it (the dip under the field), which ends the visible body early. The glow composite of light and
beach lays full-light colour at `b^2`: it never reaches zero.

**A prototype, local only** (`claude/proto-tail-cut`, never pushed; lever `__RAW_WIND_GLOW_CUT__` = k, the glow laid at
`b max(0, b - k) / (1 - k)` and a mark's level solved for its strength): the mean over the 12 bands of each ratio to dark, light /
beach:

| | dev | k 0.30 | k 0.38 | k 0.46 |
|---|---|---|---|---|
| land, body share | 1.30 / 1.28 | 1.06 / 1.04 | 0.97 / 0.95 | 0.88 / 0.85 |
| land, body length (90th pct) | 1.39 / 1.43 | 1.08 / 1.09 | 0.98 / 1.01 | 0.87 / 0.89 |
| sea, body share | 1.47 / 1.45 | 1.20 / 1.16 | 1.11 / 1.05 | 1.00 / 0.94 |
| sea, body length (90th pct) | 1.78 / 1.74 | 1.32 / 1.30 | 1.18 / 1.17 | 1.04 / 1.05 |
| land, core L\* | 0.83 / 0.87 | 0.83 / 0.86 | 0.82 / 0.86 | 0.82 / 0.86 |

k was predicted before it was measured: dark's ground under its field is L\* 33 to 37 over land and 42 to 46 over the sea, about
0.33 and 0.43 on the encoded scale the blend runs in, and the bodies match at 0.38 over land and 0.46 over the sea. The 3.2 kn band
stays at 1.5 to 2 times in every arm: a second term (the calm marks' own strength), not the tail. This is the trails lane's
variable (`claude/wind-trails-linger`); it has the table, the cause and the prototype, and builds it. Shown to the owner as a
local preview clip beside dark, with the coast in ink, at zooms 4 and 6.

## Sub-sessions, checked at 19:45Z (the owner asked)

Read-only (`git status`, `git diff --stat` in each worktree). The beach lane touched `windBeachPath.js`, its test, the palette
checker and its records: nothing of the map's restyle. The trails lane had only bench files uncommitted, one of them
`page/map-entry.js`, which this change also edits: it was told the exact hunks, that this PR goes first and it rebases, and the
record numbers taken here (D-028, L-V74, L-V75).

## #322 merged (the owner's word of 19:01Z)

Before: `gh pr view 322` read OPEN, MERGEABLE, CLEAN, head `84369074`, 18 checks passed, 1 skipped, 0 failed. Checked here before
the merge: dev an ancestor of its head; dev's ledger a byte prefix of its ledger (1119 lines of 1126) and `action_ledger.py verify`
clean; the field hashes `67bfe560` / `b0931ff3` pinned in `windBeachPath.test.js`; its `pr_merge #318` line. Squash-merged at
2026-10-12T20:01:35Z as `a022b398`; `origin/dev` read `a022b398` after.
