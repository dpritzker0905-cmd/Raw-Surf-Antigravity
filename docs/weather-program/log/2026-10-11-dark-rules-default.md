# 2026-10-11 · Dark's rules on light and beach, ON by default (D-020)

Local session (Windows, AMD Radeon 890M, D3D11), picking up the WIP commit `1df5e128` on `claude/fervent-rubin-aa8708` (dev `432b0135` plus
the WIP). Owner, 2026-10-11: "build the five rules into the app behind a lever, I want to see the changes done, not start with them off,
that makes no sense. Do the changes, let me observe them. Then if we dont like them, we turn them off", and "why would you make changes
to turn them off? makes no sense."

Started 14:50Z. `memory_audit.py --docs-only` at the start: 0 FAIL, 13 WARN (overdue commitments, each a live read-back of backend or app
work outside this task), 14 NOTE. Checked live before acting on STATE: `git fetch` (dev at `432b0135`), `gh pr list` (one open: #264, a
Codex draft), #311 MERGED 2026-10-11T14:31:44Z. No request of this session reached the live backend. Instruments: Jest (both trees), the
palette checker (`frontend/scripts/wind-color`, coloraide 8.13), the wind bench's map mode on the offline basemap and its 3-seed scanner,
both on this machine's GPU. The solved tables were read per knot with scratch probes; every number that matters is pinned in
`windDarkRules.test.js`.

## 14:55-15:25Z · The WIP ran, and what running it found

Both Jest trees on the WIP: 302 suites, 2 failures, both stale assertions about the old default (`windInk.test.js`). Then the solved
tables were read at every knot, and the levers swept:

| Found | Measured | Now |
|---|---|---|
| The solver read light's 10-16 kn on the straight sRGB line. The lab's solver read `lut()`, which walks the hue path first; the port read the raw stops | light's ground over land at 13 kn: C* 0.9, the grey D-019 removed | the solver is given the field's own path: C* 15.4; weakest colour 3-40 kn 9.6 (land) / 8.3 (water) |
| The ink, glow and neutral-body levers drew their marks on the new field and the new streak rows | `windDarkRulesOn` true while `windInk` returned ink or glow | `windDarkRulesOn` is the one place that decides; an older lever holds its theme whole; a sweep of 2,880 lever combinations |
| The name guard's edge was a hard line (L-V8) | light's ground over land 55.5 → 74.1 L* between 25 and 26 kn (15.7 dE00); the field before it never steps more than 2.3 L* a knot | the guard reaches 4 kn outward along speed: 4.4 L* a knot (water 3.5); beach 6.1 → 4.3 |
| Light's calm was grey | C* 0.7 over land: the tint is at its weakest at calm and was clamped | under 3 kn the ground dims only as far as the tint can colour it: C* 5.7, 1 L* lighter |
| The palette checker could not load the ramp module | `new Function` cannot hold an import | it loads the solver first |
| The land mask bound with a raw `activeTexture`, uploaded under whatever unpack state the page left, kept dead textures after a restored context, and took an empty file as an all-sea mask | read of `WebGLWindUtils.bindTexture`'s record of the active unit; the mask uploads from an idle callback | bound through the engine's helper; FLIP_Y and alignment pinned; re-validated when the program changes; an empty file is a failure; `window.__WIND_LAND_MASK__` |

**The guard, eased to both sides first, cost the colour-blind floor.** A triangle 4 kn to each side dimmed light's 27 kn stop toward
33 kn (L* 75.3 → 71.1 against 68.4) and the Machado floor fell from 4.60 to 2.16. Outward only, every Beaufort stop the guard did not
touch keeps the lab's ground, and the floor reads 4.96 over land and 3.80 over water (the lab's hand-over: 4.60 and 3.59).

## The build as it stands

- `windDarkRules.js`: `DARK_RULES` (ceil light 58 / beach 62, guard 76, ease 4, cMin 25, opacity 1.0, ring 0.25, white 0) and
  `solveDarkRules(theme, fieldRows, darkRows, opts)`, three tables at every knot 0-75: the dimmed field, the land streak row, the sea
  streak row. `opts.ease: 0` and `opts.calm: false` are the lab's hand-over and the clamped calm, kept as the tests' positive controls.
- `windLandMask.js`: the app's Natural Earth land rasterised once into a 2048 x 2048 Web Mercator mask, off the frame, bound on texture
  unit 5. Until it is ready, or if it fails, every mark draws its land row.
- `WindColorRamp.js`: `windDarkRulesOn`, `resolveDrawnField`, `resolveDrawnMarks`, `drawnMarkRampData` (256 x 2: row 0 land, row 1 sea),
  `windLookKey`. `resolveFieldRamp` and `resolveMarkRamp` are untouched: they are the tables the kill restores.
- `windInk.js`, `WebGLWindShaders.js` (1,029 lines, its ratchet baseline), `WebGLWindEngine.js` (1,074 against 1,095): as the WIP left them.
- Levers: kill `window.__RAW_DISABLE_WIND_DARK_RULES__ = true`; narrow with `window.__RAW_WIND_DARK_RULES__` = `true` | `false` |
  `'light'` | `'beach'`. An explicit light look, the ink and glow levers and the neutral-body lever each hold their theme.

## Rulings (where this build departs from the lab's solver or the hand-off; each is one constant or one function to undo)

1. **The solver reads the hue path.** A port defect against D-019 rule 3. Cost if wrong: none found.
2. **An older lever holds its theme whole.** The hand-off named a precedence for the mark model only; the tables did not follow it.
   Cost if wrong: a session that wanted ink or glow ON the new tables cannot have it.
3. **The guard reaches 4 kn outward along speed** (`DARK_RULES.ease`). Light's ground at 22-26 kn (59.7, 63.8, 67.5, 70.9, 74.2) and
   beach's at 24-28 kn (59.1, 62.2, 66.4, 70.8, 72.0) are lighter than the lab's and above their ceilings; streaks there have less room.
   Beach's 27 kn stop moved 62.4 → 70.8. Undo: `ease: 0`.
4. **Calm keeps its tint** (`opts.calm`). Light's calm is 1 L* lighter than the clamped grey. Undo: `calm: false`.
5. **The land mask's upload, bind and restart**, and a status object for the read-back.
6. **Ledger commitment 1042 (the owner's pick among #311's four looks) is closed as superseded**, not as met: the owner chose dark's
   rules for the default, and #311's looks stay levers. Said here and in the ledger line so it is not read as a pick.

**Not changed, though measured: the pale band.** Over light's land at 26-30 kn (beach 27-29) the guard keeps the ground light (L* 72-75),
the streak wants dark's step above it and runs to the colour floor: a near-white yellow (C* 25). Whitening it there buys little:

| light, land | ground L* | as built: streak L* / C*, step | at full colour: L* / C*, step | step bought |
|---|---|---|---|---|
| 26 kn | 74.1 | 98.5 / 25.8, +19.8 | 95.1 / 97.7, +16.9 | 2.9 |
| 27 kn | 75.3 | 98.9 / 25.7, +19.2 | 97.1 / 96.9, +17.6 | 1.6 |
| 28 kn | 74.1 | 98.7 / 25.4, +20.1 | 96.3 / 96.0, +18.0 | 2.1 |
| 29 kn | 73.0 | 98.5 / 25.0, +21.0 | 95.2 / 94.8, +18.1 | 2.9 |
| 30 kn | 71.8 | 98.2 / 25.8, +21.7 | 94.1 / 93.6, +18.2 | 3.5 |

It is the colour floor as the rule set states it (C* 25), so it ships as specified. On the storm crop it is a cream band between the
green and the yellow. **Recommended next, the owner's call once it has been seen on the map:** where dark's step is out of reach, let a streak stop
2 to 4 L* short and keep its colour.

## Measurements

**Gates.** Jest, both trees: 303 suites, 3,964 tests, 0 failed (302 and 3,900 before; `windDarkRules.test.js` adds 64). `check_eslint.js`:
no rule over its baseline. `loc_ratchet.py`: no new violation. `craco build` (CI=false, as Netlify and CI run it): built. `npm run build`
as written fails on Windows cmd (`NODE_OPTIONS=...` prefix), unrelated to this change; the same build ran through Git Bash.

**The kill is exact.** Table bytes: the drawn marks table (both rows) and the drawn field table hash to the values captured at
`ca42f552` for light, beach and dark. On the GPU: the bench at `origin/dev` and the working tree under the kill read the same on every
metric for light, beach and dark at z6. `check.mjs --today` prints what the checker printed at `432b0135`, line for line (JSON within
1e-16).

**Palette checker, `node check.mjs --strict`: exit 1, four red lines, all colour-blind.** Normal-vision lines: 0 red. `--today`: 0 red.

| Tint over the muted ground (coloraide; floor 5) | before | as drawn | weakest pair |
|---|---|---|---|
| light, water | 5.2 | **3.9** | 16-21 kn, deutan |
| light, land | 5.3 | **4.9** | 55-63 kn, tritan |
| beach, water | 5.1 | **3.1** | 16-21 kn, protan |
| beach, land | 5.2 | **3.2** | 16-21 kn, protan |

By the lab's method (Machado, every band from calm): light 5.19 → 4.96 (land), 4.87 → 3.80 (water); beach 3.51 → 3.40, 3.50 → 3.28.
The streaks' own colours do not separate neighbouring bands for a colour-blind viewer (under 1 dE00 at some pair in both themes): a
watch line in the checker, never a gate. The field under them carries the bands.

**Map bench, offline basemap, seed 1, 180 frames, the mask reading 1 on every `rules` row** (`map-run.js --offline`; `today` is the kill):

| | LAND step | lighter | end | lines kept | WATER step | lighter | end | lines kept |
|---|---|---|---|---|---|---|---|---|
| light z4, today | +7.0 | 0.76 | 76.7 | 0.375 | +11.0 | 0.90 | 73.4 wash | 0.317 |
| light z4, rules | +16.0 | 1.00 | 65.1 | 0.372 | +11.5 | 0.99 | 56.9 | 0.427 |
| light z6, today | +6.0 | 0.71 | 74.4 | 0.504 | +11.0 | 0.88 | 73.0 wash | 0.337 |
| light z6, rules | +13.5 | 1.00 | 59.4 | 0.426 | +12.5 | 0.99 | 65.9 | 0.372 |
| light z8, today | +5.5 | 0.88 | 74.3 wash | 0.579 | +6.5 | 0.87 | 63.0 | 0.530 |
| light z8, rules | +8.0 | 1.00 | 57.1 | 0.460 | +5.5 | 1.00 | 61.0 | 0.544 |
| beach z4, today | +6.0 | 0.75 | 69.7 | 0.525 | +8.5 | 0.91 | 64.8 | 0.404 |
| beach z4, rules | +18.0 | 1.00 | 68.1 | 0.405 | +18.5 | 1.00 | 62.3 | 0.333 |
| beach z6, today | +6.0 | 0.80 | 64.2 | 0.604 | +8.0 | 0.88 | 65.3 | 0.485 |
| beach z6, rules | +15.5 | 1.00 | 57.8 | 0.482 | +14.5 | 1.00 | 64.5 | 0.360 |
| beach z8, today | +5.5 | 0.95 | 64.6 | 0.611 | +5.0 | 0.92 | 60.5 | 0.638 |
| beach z8, rules | +8.5 | 1.00 | 55.9 | 0.504 | +6.0 | 1.00 | 61.2 | 0.566 |
| dark z4 | +18.5 | 1.00 | 39.5 | 0.360 | +11.5 | 0.96 | 50.9 | 0.333 |
| dark z6 | +17.0 | 1.00 | 31.6 | 0.412 | +10.5 | 0.93 | 50.1 | 0.352 |
| dark z8 | +12.5 | 1.00 | 29.9 | 0.379 | +7.0 | 0.92 | 44.1 | 0.371 |
| storm (x 2.3), z6: light today | +6.5 | 0.71 | 75.5 | 0.416 | +9.5 | 0.69 | 60.3 | 0.336 |
| storm: light rules | +15.0 | 1.00 | 63.7 | 0.376 | +14.0 | 0.98 | 49.2 | 0.442 |
| storm: beach today | +5.5 | 0.75 | 68.6 | 0.558 | +7.0 | 0.72 | 56.3 | 0.564 |
| storm: beach rules | +17.0 | 1.00 | 64.8 | 0.424 | +15.0 | 0.98 | 53.5 | 0.501 |
| storm: dark | +18.5 | 1.00 | 35.3 | 0.369 | +12.0 | 0.96 | 51.7 | 0.330 |

Step: median L* of a streak pixel against the field under it. Lighter: share of streak pixels lighter than their ground. End: where the
picture ends (field L* plus cover x step; `wash` above 71 with under 15% of streak pixels darker). Lines kept: share of each basemap
line's L* contrast kept under field and marks.

- **Over land the step is 79 to 97% of dark's at z4 and z6** (it was 32 to 38%) and 64 to 68% at z8, where `WIND_CLOSE_LAND` (light and
  beach 0.65, dark 0.8) was left as it is. Every streak pixel is lighter than its ground. No surface reads wash (three did).
- **The streaks carry colour:** median chroma of the marks over land at z6 29.5 (light, the field under them 15.0) and 50.0 (beach, 25.5);
  before, 19.0 and 29.5, at or under the field's.
- **The map's lines keep less over land:** light 0.43 against 0.50 at z6 and 0.46 against 0.58 at z8; beach 0.48 against 0.60 and 0.50
  against 0.61. The dimmed field alone takes it (light land, field only: 0.60 against 0.82). Dark's own is 0.36 to 0.41. Over water
  light keeps more (0.37 against 0.34 at z6), beach less (0.36 against 0.49).
- **The dark reference over water is not the solver's.** The bench's offline dark sea is rgb(93, 117, 126); the solver takes dark's step
  over the app's night palette. Compare land with land.

**The land mask's control** (`--no-land-file`: the fetch fails, every mark draws its land row; z6): the LAND columns are identical with
and without the file. Over WATER the step falls with the mask from +17.5 to +12.5 (light) and +18.5 to +14.5 (beach), the picture's end
from 70.0 to 65.9 and 67.9 to 64.5, and the streaks' chroma rises from 32.5 to 53.5 and 40.0 to 55.0. Storm strength: +19.5 → +14.0 and
+20.0 → +15.0. The mask is aligned with the map and does what rule 4 was solved to do.

**The 3-seed scanner** (`run.js --seeds 3 --themes light,beach --variants candidate,before-rules`, run `20261011-154752`, 13 views,
positive control PASS on all three seeds). The new default: 7 recurring shapes in 5 of 26 views (4 flickering). Its kill: 5 in 4 of 26
(5 flickering). **No shape the engine before dark's rules lacks.** Each of the seven sits where an arm before it has the same kind and
band:

- world-z4, light and beach: the same three HOLEs at the same places in every arm. The one at about [315, 505] reads 4.4-4.6 kn in the
  kill arm, which the scanner labels calm and does not count, and 5.1-7.9 kn in two of three seeds under the default: it straddles the
  scanner's 5 kn line.
- fine-z6.5: the HOLE at the view's bottom-left edge ([27-42, 856-869], the shape the earlier logs describe) recurs in 3 of 3 seeds
  for beach under the default and 1 of 3 under its kill; for light, 1 of 3 and 2 of 3.
- fine-z7: the BLOB at 16.9 kn, 4 blocks, [384, 512], is in every seed of light's kill arm and of both default arms; beach's kill arm
  stays under the threshold.

Dark's streak method lays a brighter trail (ink 93-160 against 82-145), which carries an existing shape over a counting threshold: the
pattern the glow scan and #311's scan found. The scanner page has no basemap and no land file, so its marks drew their land rows.

**Crops** (device resolution, in the bench's out folder, not committed): the looks read as the numbers say. Two things the numbers do not
say: under storm strength light's land shows the cream band above between the green and the yellow, and beach's dimmed land under light
wind is a dark khaki.

## 15:57Z · PR #312 and the ledger

- **PR #312** (https://github.com/dpritzker0905-cmd/Raw-Surf-Antigravity/pull/312), against `dev` from `claude/fervent-rubin-aa8708`. ON by
  default for light and beach; the kill is in its title. Opened as a draft while the independent review ran. Not merged: the owner merges.
- **Ledger:** seq 1043 (`pr_merge #311`, merged 2026-10-11T14:31:44Z as `432b0135`), 1044 (decision D-020; closes 1042 as superseded),
  1045 (`pr_open #312`), 1046 (the default flip, in code on #312), 1047 (commitment: the read-back on the deployed build, due 2026-10-18).
- **STATE:** #311 MERGED; the new entry at the top of Now; the ledger head.

## 16:00-16:05Z · The same bench on the REAL basemaps (Mapbox, the app's public token from the local env file)

`map-run.js` without `--offline`: Mapbox navigation-day (light), outdoors (beach) and navigation-night (dark), Mobile Bay, the served GFS
wind, the app's own Natural Earth land file for the mask (`mask 1` on every `rules` row). Tiles came from Mapbox; no request reached the
Raw Surf backend. This answers the first known limit below for one camera: the solver's flat grounds against a real map.

| | LAND step | lighter | end | lines kept | WATER step | lighter | end | lines kept |
|---|---|---|---|---|---|---|---|---|
| light z4, today | +5.0 | 0.66 | 77.6 | 0.706 | +9.5 | 0.88 | 73.6 wash | 0.727 |
| light z4, rules | +14.0 | 1.00 | 65.3 | 0.556 | +11.5 | 0.99 | 57.1 | 0.518 |
| light z6, today | +4.5 | 0.63 | 76.9 | 0.685 | +9.5 | 0.85 | 73.0 | 0.781 |
| light z6, rules | +11.5 | 1.00 | 60.5 | 0.590 | +11.5 | 0.99 | 65.8 | 0.648 |
| light z8, today | +4.5 | 0.80 | 77.5 | 0.700 | +5.5 | 0.83 | 63.0 | 0.757 |
| light z8, rules | +7.0 | 1.00 | 59.2 | 0.574 | +5.0 | 1.00 | 61.6 | 0.645 |
| beach z4, today | +2.5 | 0.63 | 73.9 | 0.627 | +6.0 | 0.82 | 66.8 | 0.810 |
| beach z4, rules | +14.5 | 1.00 | 70.4 | 0.582 | +17.5 | 1.00 | 64.2 | 0.817 |
| beach z6, today | +3.5 | 0.68 | 69.7 | 0.744 | +6.0 | 0.79 | 67.2 | 0.759 |
| beach z6, rules | +12.5 | 1.00 | 61.7 | 0.653 | +13.0 | 0.99 | 65.5 | 0.694 |
| beach z8, today | +3.5 | 0.91 | 70.0 | 0.690 | +4.0 | 0.84 | 61.8 | 0.786 |
| beach z8, rules | +7.5 | 1.00 | 60.4 | 0.593 | +5.5 | 1.00 | 61.8 | 0.721 |
| dark z4 | +14.5 | 0.99 | 44.9 | 0.599 | +11.0 | 0.96 | 51.0 | 0.733 |
| dark z6 | +13.0 | 0.97 | 39.9 | 0.654 | +10.0 | 0.93 | 50.0 | 0.790 |
| dark z8 | +10.5 | 1.00 | 40.3 | 0.669 | +7.0 | 0.92 | 44.5 | 0.814 |

- **Over land the step is dark's at z4 and z6:** light 97% and 88% of it, beach 100% and 96% (before: 34-35% and 17-27%). At z8, 67% and 71%.
- **Every streak pixel over land is lighter than its ground, and no surface reads wash** (light's water at z4 did).
- **The lines over land keep about what dark's keep:** light 0.56 / 0.59 / 0.57 and beach 0.58 / 0.65 / 0.59 against dark's 0.60 / 0.65 /
  0.67. That is 0.05 to 0.15 less than before (0.63 to 0.74). Of the lines that were at least 3:1 on the bare map, light keeps 0.67 at
  z6 over land (0.79 before; dark 0.59) and 0.39 over water (0.59 before; dark 0.48).
- **The mask on a real coast** (`--no-land-file` against the app's file, z6): LAND identical; WATER step +16.5 → +11.5 (light) and
  +16.5 → +13.0 (beach), the end 69.8 → 65.8 and 68.5 → 65.5, the streaks' chroma 33.0 → 51.5 and 41.0 → 55.0.
- On the crops the place names keep their halos and read; the pale patch is there on the delta south of New Orleans (land under
  26-30 kn).

## Known limits

- The grounds the solver assumes are the wind bench's offline basemap colours, muted as the app mutes them, not the live Mapbox map.
  Checked on the real basemaps for one camera (the section above); not in the app.
- The land mask's texel is about 20 km: the hand-over between land and sea rows is soft near coasts at z8 and beyond.
- The mask costs one fetch of a 2.8 MB file the app already serves, and one rasterisation of 1,420 polygons into a 2048 x 2048 canvas in an
  idle callback. Not timed on a phone.
- `WIND_CLOSE_LAND` (light and beach 0.65, dark 0.8) was left as it is: the step at z8 is two thirds of dark's.
- The Canvas2D fallback is untouched.
- The scanner page has no land mask; the path and flow modes were not re-run.

## Not verified

- **Nothing has been seen in the app.** Every number is the engine on the bench's offline basemap, or a model of the composite.
- The live map's grounds (Mapbox styles, labels, terrain) against the solver's flat ones.
- The mask's cost and the look on a phone.

**No served number moved** (client only), so no SCOREBOARD row.
