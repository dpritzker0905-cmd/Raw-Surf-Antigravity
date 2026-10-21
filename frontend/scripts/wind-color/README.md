# Wind palette checker

Checks the wind colours **as they are actually drawn over the map**. Bare swatches can look fine and still disappear
over the basemap water.

- **Light and beach** multiply the field into the basemap: `out = map × (1 − s(1 − c))`, on encoded sRGB.
- **Dark** blends the field over the basemap.
- **Particle streaks** sit on top of that tint.
- **The ground is muted while the wind is on** (light and beach, `src/components/map/windBasemapMute.js`): 85% of the
  basemap's chroma removed, the water a little darker. The checker mutes the surfaces with the app's own function before
  compositing; `--no-mute` models the map as it was before (2026-10-09).

Every "the wind blends into the water" report so far (#285, #288) came from the composite colours between the Beaufort
stops, not from the swatches. No palette plugin or connector models a multiply blend, so this tool does it.

It loads the real ramps from `src/components/map/WindColorRamp.js`. Change a stop there and run it again.

**It reads what the app DRAWS** (2026-10-11, DECISIONS D-020). Light and beach draw dark's rules by default
(`windDarkRules.js`): a dimmed field, and streak rows of their own over land and over sea, laid by dark's streak method.
The checker resolves the tables with `resolveDrawnField` / `resolveDrawnMarks`, lays each ground's own streak row by the
engine's law (the colour at full light at alpha² × opacity), and reads the field at the 13 Beaufort stops for the
colour-blind lines. `--today` reads the tables before dark's rules, which is what
`window.__RAW_DISABLE_WIND_DARK_RULES__ = true` restores. Control for this change: `--today` prints what the checker
printed before it, line for line (JSON within 1e-16).

## Setup (once)

```powershell
cd frontend\scripts\wind-color
npm i                                   # culori (CIEDE2000, Lab)
py -3.12 -m venv .venv
.venv\Scripts\python -m pip install coloraide==8.13   # colour-blind models
```

Both `node_modules` and `.venv` are git-ignored.

## Run

```powershell
node check.mjs                  # all three themes
node check.mjs --theme light    # one theme
node check.mjs --strict         # exit 1 on any RED line (for CI)
node check.mjs --no-mute        # the unmuted basemap (the kill switch's picture)
node check.mjs --mute-amount 0.7 --water-l 0.95   # explore other mute settings (the app's lever values)
node check.mjs --look moderate  # light's look A/B (window.__RAW_WIND_LIGHT_LOOK__: moderate | deep | ink)
node check.mjs --today          # the tables before dark's rules (what the kill restores)
node check.mjs --before-white   # dark's rules before the white streak (window.__RAW_DISABLE_WIND_WHITE_STREAK__: what that kill restores)
node check.mjs --full-white     # the white streak at full strength on both grounds (window.__RAW_DISABLE_WIND_DARK_WHITE__, D-022's kill)
node check.mjs --before-path    # each theme before ITS path: beach's field (window.__RAW_DISABLE_WIND_BEACH_PATH__) and light's rows (window.__RAW_DISABLE_WIND_LIGHT_PATH__); each kill is read by its own theme only
node beach-path-solve.mjs --audit   # beach before its path: per Beaufort stop and per pair, every bar (see "Beach's path" below)
node check.mjs --before-depth   # the land as the mute alone leaves it (window.__RAW_DISABLE_WIND_LAND_DEPTH__, D-026's kill); --land-l 0.75: another depth
node check.mjs --as-uploaded [10-80:1]   # ALSO the field as the GPU draws it: the 8-bit texture by the shader's own lookup, at every maximum of the sweep (red under 5.0 with --strict, or under --as-uploaded-floor 4.9; --index255: by the table's index). OPT-IN: the owner has not set an as-drawn bar, and light and dark are under 5.0 by it
node lut-lookup-gpu.cjs [swiftshader]   # which position the GPU reads in a 256-texel LINEAR texture (the law --as-uploaded models), read back from a GPU
node mirror-model.mjs           # each theme's field over its own map, knot by knot, beside dark's (L*, C*, hue; see below)
node mirror-jacobian.mjs [--json out.json]   # every lever against a streak's step at once: what a 10% turn of the white, the field's strength and the map moves, and a knot of wind, beside dark's (see below)
```

`--look` resolves the field and the marks as the app does with that lever set (`resolveFieldRamp`, `resolveMarkRamp` in
`WindColorRamp.js`); the legend never moves. A look that gives the marks their own colours adds a watch line for them (normal vision
and colour-blind), never a red one: the streaks' separation has never been a gate.

## What it reports, per theme

| Line | Meaning | Floor |
|---|---|---|
| legend | Weakest pair of neighbouring legend stops, normal vision | ≥ 9 ΔE2000 |
| tint off the water / land | Weakest tint at 6 kn and above. 3 kn is the owner's deliberately soft "middle ground" | ≥ 14 ΔE2000 |
| weakest colour on the path | The field's lowest chroma anywhere from 3 to 40 kn, read BETWEEN the stops as the app draws them (`huePathStops`). A straight sRGB line between two opposite hues runs through grey: light's 10-16 kn drew C* 1.0 at 13 kn (the owner's "looks like fog") | ≥ 8 C* |
| calm off the ground | Calm against the bare ground. Under the basemap mute the bare ground is grey, so calm is a tint the eye can name, and weaker than the 3 kn tint | ≥ 5 ΔE2000, below the 3 kn tint |
| speeds < 20° off the water hue | Speeds whose tint reads as "more water" (unmuted map only: a grey ground has no hue to hide in) | ≤ 2 kn wide; a violet → green ramp must cross a cyan water's hue once |
| speeds > 30° off the legend's own hue | Speeds whose tint the ground bends into another band's colour (a 33 kn gold multiplied into cyan water came out green). The path bench's `hue30` asks the same of real frames | ≤ 2 kn |
| speed-colour core vs its tint | The streak's ~1 px colour core against the tint it sits on. Watch item only: the white ring carries the motion | \|ΔL*\| ≥ 3 |
| colour-blind | Neighbouring legend stops, and neighbouring tints over water and (light and beach) land, via coloraide (Viénot protan/deutan, Brettel tritan). The land line is new on 2026-10-10: the muted ground is two grounds | ≥ 5 ΔE2000 |

The checker does not run in CI. `src/components/map/windPaletteCvd.test.js` pins the colour-blind lines there with a JS
port of coloraide's models, anchored to coloraide's output. Since 2026-10-10 light's tint reaches the floor on the
muted ground the wind sits on (A, steady descent: 5.22 over the muted water, 5.26 over the muted land;
`windLightFastBand.test.js`, log `docs/weather-program/log/2026-10-10-light-fastband-a-default.md`). One accepted gap is
left and pinned: over light's own cyan water, which shows only with the basemap mute killed, the weakest pair is 3.04
(10-16 kn).

**Beach's path (2026-10-12, `src/components/map/windBeachPath.js`, DECISIONS D-025; kill `window.__RAW_DISABLE_WIND_BEACH_PATH__`;
log `docs/weather-program/log/2026-10-12-wind-beach-path.md`).** With it, `node check.mjs --strict` exits 0: beach's two
colour-blind lines read 5.1 over the muted water and 5.1 over the muted land (5.12 and 5.15), and one new watch line is
printed (over the sea the field sits more than 30° off the legend's hue across 1 kn, 15.5 to 16 kn). The land is the DEEPER
one that PR #320 lays under the wind (D-026: the land's lightness times 0.85 in beach), the default since that merge;
`--before-depth` (or `--land-l 1`) reads the land before it: 5.1 and 5.7. The field was solved to hold the bar on either land.
**Since the land's step (D-026 amended, 2026-10-12; `windBasemapMute.js` WIND_LAND_STEP) a flagless run reads a LIGHTER land:**
the land at the sea's own factor (0.94 in beach, 0.90 in light), a streak over it at 0.75. There beach reads 5.1 over the
water and 5.5 over the land, light 5.1 and 5.3. Every number in this section that says "the deeper land" or "the default"
without a date is PR #320's land: read it now with `--before-step` (the step's kill: beach 5.1 and 5.1, light 5.1 and 5.0).
`--land-l X` is still the depth's lever, and a land it sets keeps the sea's streak strength, as before the step.
**The checker reads the TABLE; the engine draws a TEXTURE of it.** The table is sampled into 256 texels of 8 bits
(`generateRampData`), and the shader reads that texture at speed / maximum with LINEAR filtering, so the GPU reads half a
texel from the table's own index (`node lut-lookup-gpu.cjs` reads the law back from a GPU: the rule fits to 1/255 of a
texel). The maximum is the data's strongest wind, clamped to 10..80 kn. `--as-uploaded [10-80:1]` reads every theme that way
and prints one more line a ground: the weakest pair over the whole sweep. **It is opt-in, not the gate:** by it beach's
field holds 5.0 at every maximum (5.04 over the water and 5.06 over the land at 281 maxima; it was solved WITH MARGIN for
that, 2026-10-12, D-025's last amendment), light dips to 4.93 over water and 4.85 over land, and dark to 4.97. Before the
margin beach read 4.65 and 4.68 at the lowest (PR #319's field), and before its path 2.93 and 2.78. The canvas's own
8-bit rounding is not modelled.
Beach before its path reads 3.1 and 2.9 (`--before-path`; 3.1 and 3.2 with `--before-depth` as well). `--before-path` prints
the table below.
`beach-path-solve.mjs` is the instrument: it holds the colour-blind floor as a CONSTRAINT (through `light-path-lib.mjs`, a
plain-JS port of coloraide's filters and CIEDE2000; `node light-path-lib.mjs --verify` checks it against coloraide) while it
solves for lightness that never rises through the green band, a gale band under a ceiling, and the least lift of the
streak's ground, in beach's own hues. What is BUILT is option F with its 6 to 40 kn stops re-solved for the deeper land,
then its 6 to 55 kn stops again with margin for the texture (`--upfloor`, `--uploaded`: the as-drawn floor held as a bar):
`--audit --ref built` reads it over the land the app draws (add `--before-depth` or `--land-l 1` for the land before
PR #320); `--audit` alone reads beach before it.
`beach-path.json` holds option F's stops as first solved (`--score beach-path.json --mono 0-21,33-75 --tol 12 --ceilgale 60`). `beach-path-ground.mjs` prints the ground per knot over land and sea
beside dark's (by the engine's law) and how flat each is from 6 to 40 kn; `beach-path-sheet.mjs out.png` draws the
speed-by-speed sheet.

**Before beach's path, as drawn, the colour-blind floor held in light and did NOT hold in beach** (`node check.mjs --strict
--before-path` exits 1, two red lines, both beach's). Dark's rules dim beach's field by one factor, which draws the bands'
lightness together. Light drew the same kind of field from 2026-10-11 (D-020) until the white streak (D-021, the same day)
gave it the deeper field of its A/B, which was solved to hold the floor:

| Tint over the muted ground | `--today` | `--before-white` | as drawn | weakest pair as drawn |
|---|---|---|---|---|
| light, water | 5.2 | 3.9 | 5.5 | 40-47 kn, tritan |
| light, land | 5.3 | 4.9 | 5.6 | 55-63 kn, tritan |
| beach, water | 5.1 | 3.1 | **3.1** | 16-21 kn, protan |
| beach, land | 5.2 | 3.2 | **3.2** | 16-21 kn, protan |

The owner chose to see dark's rules on first and judge them (D-020), and then dark's own white streak over them (D-021).
`windDarkRules.test.js` pins the `--before-white` numbers as under the bar, so a green Jest run never reads as "the floor
holds"; `windLightLook.test.js` holds light's deeper field at 5. The older tests still hold the bar of 5 on the `--today`
tables.

The mark lines judge a streak's colour CORE. Under the white streak the core sits under a white ring that carries the
motion, which this checker does not model (the wind bench's style columns read it). One known unevenness: the same light
tables read through `--look deep` and through the default give different mark lines (the look path lays the core at its
alpha, the default by the engine's own law, alpha squared); both are watch lines, never gates.

## The mirror model (`mirror-model.mjs`): where a theme's colours leave dark's

Dark is the model (owner, 2026-10-11). The model prints each theme's field as it is drawn over its own land and sea at every
knot: L*, C*, hue, the distance from the bare map, and the step of a piled-up streak at the strength drawn over that ground
(`windDarkRules.js` `DARK_WHITE`; the checker's mark lines use the same strengths). Read dark's rows first: its hue sweeps ONE way
with speed and its lightness climbs to a plateau. On 2026-10-11 light's hue turned back four times (blue at 6 kn, orchid at 10,
green at 16, teal at 21; 146 degrees from dark at 10 kn) and beach's lightness dipped to L* 46.7 at 10 kn. **Do not straighten
either without this checker in the loop:** a prototype that did read 2.9 for light's colour-blind floor (5.5 before) and 1.3 for
beach's (3.1), and left light's field off its legend bar. Those turns are what the colour-blind passes bought (LESSONS L-V45).

**Dark is NOT laid by the engine's law here (2026-10-12; not fixed in this file yet).** `mirror-model.mjs` and `check.mjs` lay
dark's field as `field × α + map × (1 − α)`. The engine writes it premultiplied and blends with `SRC_ALPHA`, so on screen it is
`field × α² + map × (1 − α)`: about half as strong from 5 kn. Dark's hue over its land moves 2 to 5 degrees between the two
laws; its lightness, chroma, hardest edge and colour-blind line move a lot (by the engine's law: L\* 19 to 27 from 6 to 40 kn,
nearly flat; hardest edge 8.9 dE00 a knot; colour-blind 2.5 to 3.1). Light and beach (the multiply law) are not affected.
`light-path-solve.mjs` reads dark through its own `darkOn`.

## The Jacobian (`mirror-jacobian.mjs`): every lever against a streak's step, at once

The owner, 2026-10-12: "use the jacobian lens to help see everything as a whole. To not miss any clues." Three lanes had each
tuned one input against one reading at a few scenes, and each found its number did not hold in another (land against sea, a
breeze against a storm, one zoom against another). This prints the matrix those were entries of, from the mirror model's own
tables and laws (no GPU, no map load):

- **Per ground and knot:** the ground under the wind (`G`), the room left above it, the white strength the app lays there
  today (`w`: 0.75 over land with the land step, 0.55 over the sea), how far a piled-up streak steps off the ground at that
  strength, that step over DARK's at the same knot, the strength at which the two would be equal (`w*`) and, where no white
  reaches dark's step, how deep the ground would have to be (`G*`: the map's own term, which no streak setting can stand in for).
- **The sign that makes a breeze and a storm disagree:** how each theme's ground moves per knot. From 6 to 16 kn dark's
  ground gets LIGHTER with speed while light's and beach's get DARKER (or stand still), so a strength matched to dark at one
  speed is off at another.
- **The row for a streak's step:** what a 10% turn of the white, of the field's strength and of the map's lightness moves it
  by, and what one knot of wind does, beside what a knot does to dark's own step.

Dark is laid by the ENGINE's law here (alpha squared, the paragraph above), not the mirror model's, and over the REAL map's
land (`[58, 71, 79]` at zoom 6, as `ground-run.js` read it), not the mirror model's offline land, which reads 11 L\* too dark
under the wind and overstates dark's step over land. That law is written here a second time (LESSONS L-V60 rule 1 asks for one
place): moving it is one change with the checker's dark lines. `--before-step` and `--before-depth` print the kills'
pictures. It refuses to run if its ground for light or beach is not the mirror model's own.

- **The model's ground against the bench** (the last table; L-V60 rule 2): the field alone over the real maps at zoom 6, by
  speed, as `ground-run.js --strips 12` read it on a ramp. Dark agrees within 1.1 L\* on both grounds from 3 to 29 kn.
  Light's ground is 1.3 L\* too dark in the model over the sea and 2.8 over land, beach's 2.3 and 4.1 (10 to 22 kn): the
  model's light and beach map colours are not quite the real maps', and a ground too dark OVERSTATES that theme's step.
  The bench reads are constants in the file, of one place and day: re-read them when a map colour, the mute or a field
  table moves.
**It is a model of ONE piled-up trail, not the moving picture:** read it for the sign and the size of a lever before turning
one, and read the level on the bench (`scripts/wind-bench`: `ground-run.js`, `anatomy-run.js`), which has the veil (D-029),
the trail's whole profile and near-calm air (D-030), none of which are in this model.

## Light's path: solving a table with the floor as a constraint (`light-path-*.mjs`)

Light's field (1 to 63 kn since its margin, below), its streak row (1 to 32 kn) and its legend bar (3 to 27 kn) are solved tables
(`src/components/map/windLightPath.js`, DECISIONS D-024 and D-031): dark's hue ORDER in light's own key. Three files made them, and can re-make them:

- **`light-path-lib.mjs`**: the colour-blind distance `cvd_check.py` scores, in plain JS (coloraide 8.13's Viénot protan and
  deutan, Brettel tritan, CIEDE2000 in CIELAB D65). `node light-path-lib.mjs --verify` scores 4,000 random pairs both ways and
  prints the largest disagreement (2e-12 dE2000 when written). A search scores a candidate in about 0.1 ms, so the floor is a
  bar INSIDE the solve, not a reading after it. The checker stays the authority: every table is still run through it.
- **`light-path-solve.mjs`**: the field. Differential evolution over the colour ON SCREEN over light's muted land at the
  Beaufort stops; a row a knot between; every bar scored on the rows as they are written (3 decimals). The bars and what each
  flag sets are in its header. `--deep` holds the floor and the normal-vision distance as bars and aims for the deepest ground
  (a white streak needs a ground deeper than itself); `--keep N` keeps today's rows up to N kn; `--score cand.json --emit
  tables.json` prints every bar of a saved candidate and writes its field and streak rows.
- **`light-path-legend.mjs`**: the legend bar's 3 to 27 kn rows, each on the hue the field draws at that stop, with the
  checker's own bars (9 dE00 normal, 5.0 colour-blind, the bar within 30 degrees of the field at every half knot).

`check.mjs --before-path` and `mirror-model.mjs --before-path` read light as it drew before the path
(`window.__RAW_DISABLE_WIND_LIGHT_PATH__ = true`; the same flag sets beach's path's kill, and each theme reads its own). The
checker's legend lines read the bar as the app draws it (`resolveLegendRamp`): in light on its path that is no longer the
particle ramp.

**Light's margin (2026-10-13, DECISIONS D-031): the bar is AS DRAWN, and light's field now holds it.** The path as PR #318 merged
it held 5.1 on the table and did not hold as drawn: through the 256-texel 8-bit texture the engine uploads
(`check.mjs --as-uploaded 10-80:0.25`: the GPU's lookup, 256 t - 0.5, at 281 maxima from 10 to 80 kn) the SEA read 4.93, under
5.0 at 32 maxima, whatever the land; over the land at the sea's depth (PR #320's, now `--before-step`) 4.85, under at 123. The
owner took the path as filmed with that pinned (D-024, amended: "option 1, merge as shown and add the pin") and the re-solve
followed. `LIGHT_PATH.field` is now that field moved by the smallest step that holds 5.0 as drawn on what draws by default:

| light, colour-blind, weakest neighbours | table | as drawn, the least | maxima under 5.0 |
|---|---|---|---|
| the sea, before -> after | 5.130 -> 5.159 | 4.934 -> 5.034 | 32 -> 0 |
| the land as it draws (a step above the sea), before -> after | 5.275 -> 5.303 | 5.177 -> 5.204 | 0 -> 0 |
| `--before-step` (the land at the sea's depth: a kill's picture, not solved for) | 5.006 -> 5.035 | 4.847 -> 4.935 | 123 -> 68 |

No knot moves further than 0.11 dE00 on screen (10 kn; 2.1 summed over 37 rows); the streak row and the legend bar are not
moved. `--strict --as-uploaded` still exits 1, for DARK's own line alone (4.97 at one maximum of 281). **"As drawn" is the
texture and the GPU's lookup: the screen rounds each pixel to 8 bits once more, which nothing here models** (a crude model
of it, from the review of this change, moves a pair by several times light's margin, before the margin and with it).

`light-margin-solve.mjs` is the instrument, and can re-make the rows: it moves the on-screen colour by a step in CIELAB at
each Beaufort stop from 3 to 63 kn, holds every bar the path was built on HARD (each is printed on the candidate's own rows),
gives each pair its own target on the table (the floor plus what the 8-bit rounding takes from THAT pair, 0.06 to 0.26), reads
the candidate as drawn after each solve and raises the target of any pair still short. `node light-margin-solve.mjs --audit`
reads the rows the app draws, pair by pair, on every land, with the move from the rows PR #318 merged (`--merged` reads those:
`light-path-318.json`, the reference the solve moves FROM). The run that made the rows:
`--solve --land-l 0.90 --sum --maxmove 0.15 --floor 5.03 --seed 2 --gens 1500 --rounds 6` (re-run on this branch after the rows were built: the same rows, value for value). What the cap on the largest move buys: capped at 0.25 two seeds put 0.12
and 0.21 dE00 on one row; at 0.15, 0.11 and 0.13; at 0.10 the solve held 5.0 as drawn but not 5.03; at 0.07 it left one of the
path's bars (LESSONS L-V69 rule 3, L-V86). A margin under about 0.15 on the table does not survive the upload, and what the
rounding takes is each pair's own.

What the solve found, so the next one starts further on: holding light's hue to dark's within 8 degrees (dark by the engine's
law) keeps a 5.2 floor with 6 kn 6 to 7 L\* lighter and 16 to 21 kn 2 to 5 lighter than at 20 degrees, where the depth holds. A cyan as deep as L\* 60 cannot
carry more than C\* 30 under the 0.70 multiply tint, so the 10 kn band stays light in every solve. A bar that chroma have ONE
crest is stricter than dark itself (dark dips through cyan).

## Wave-height palettes (`wave-check.mjs`, `wave-solve.mjs`, `wave-lib.mjs`; 2026-10-20)

The light and beach wave-height wash (`src/components/map/marineWavePalette.js`; dark keeps the shader's own ramp, surf
quality its own palette) judged as the engine DRAWS it. Same setup as the wind checker (culori is not needed: `wave-lib.mjs`
uses `light-path-lib.mjs`'s port of coloraide, and `wave_cvd_check.py` runs coloraide itself as the authority).

```powershell
node wave-check.mjs                     # every palette in marineWavePalette.js (v1, v2, v2@16 = v2 on the 16 m encoding), both themes (light ships v2@16; beach ships v1, D-035)
node wave-check.mjs --palette v2 --pairs # one palette, every neighbouring pair by model at world alpha, crest by height
node wave-check.mjs --table cand.json   # a solver's table ({ heights, cap, over: {light, beach}, light, beach }) instead
node wave-check.mjs --strict            # exit 1 on any RED line, here or in the coloraide authority
node wave-solve.mjs --theme light --family A [--hend 315,350] [--seed 1] [--gens 1800]   # search one theme's table
node wave-polish.mjs in.json out.json --extend 16 [--ext-lmin light=16] [--ext-turn 5,22] [--over-hue 20,60] [--ext-joint 40]
                                        # one more anchor against the FIXED ramp (the 16 m encoding), then the flag moved up to it
```

**The model (`wave-lib.mjs`).** HEATMAP_FS lays `W(h) + swell lighting` premultiplied at the wash alpha, blended
`ONE, ONE_MINUS_SRC_ALPHA` over the style's `water` layer; the land is drawn OVER the marine rasters, so the coast is the land
colour against the composite. Alpha by view (`heatmapZoomOpacity`): world 0.65, regional 0.70, coastal 0.77. Basemap water and
land are the measured colours in `windFieldLut.test.js` (unmuted: the wind's basemap mute runs only while the wind is on). The
shader's depth floor under 0.18 m is reported on its own line; LEGEND STOPS are composited from the table itself. Crests are
DRAW_FS's colours (light's read from `marineCrestPalette.js`) at their 0.85 core alpha, with the whitecap the shader allows.

| Line | Meaning | Bar |
|---|---|---|
| lightness | OKLCH L of the wash and of the composite (every view; swell lighting off, half, full), every 0.02 m | falls at every step (RED) |
| no grey | CIELAB C* of the wash path and of the composite, the above-cap state included (D-019) | >= 12 / >= 8 (RED) |
| neighbours | neighbouring legend stops and the above-cap state, as composited, normal + protan/deutan/tritan | target >= 10 (RED) |
| land vs sea | the composite nearest the land colour | watch below 15 |
| crests | a crest's core against the wash under it, normal and colour-blind, and APCA, every 0.1 m and the above-cap state | watch below 15 |
| legend | APCA Lc of each stop and the arrow on its panel (light: white; beach: `bg-black/90`) | watch below 15 |
| above the cap | the above-cap colour against the cap's, and no lighter | >= 10 (RED) |

**Why the search has smoothness bars.** Free per-anchor chroma let it zig-zag (C* 85 -> 14 -> 70) to buy colour-blind
distance: a pulsing ramp. `wave-solve.mjs` lays falls of 4-16 L*, chroma steps of at most 12 and hue turns of 8-45 degrees
by construction, and scores the soft minimum over every pair and view.

**The Jacobian (`wave-jacobian.mjs` + `wave_jacobian.py`; owner 2026-10-20: "use jacobian lens to help us decide").** Every
input that moves the on-screen colour, at once, in CAM16-UCS (coloraide's extended build, the space colorcet and colorspacious
judge maps in): the signal (height along the legend axis: perceptual length, how even the legend steps are, the share carried
by lightness, what each dichromat keeps) against the nuisances that move one and the same height (zoom: wash alpha 0.65 -> 0.77;
the swell lighting's texture; the basemap water 4% lighter or darker; one 8-bit height step), each in legend steps. Published
maps (ColorBrewer YlGnBu and BuPu, viridis and magma reversed) are laid through the same wash on the same anchors as yardsticks.
`node wave-jacobian.mjs [--no-refs] [--json f] [--out f]`. Its first read (2026-10-20): light A beats B on heights told apart,
even steps and zoom drift; beach B beats A on heights told apart and the checker's lines; for EVERY palette zoom moves a height's
colour by up to ~2/3 of a legend step (the engine's alpha, not the palette).

**The 16 m encoding (2026-10-20, `wave-polish.mjs --extend 16`).** The GPU's height ceiling moved from 10 m to 16 m for the light
and beach wash (`marineHeightEncoding.js`), so `v2` gained a `h16` extension: one anchor at 16 m and the above-cap flag moved up
to it, every anchor under 10 m byte-identical. The extension is searched against the fixed ramp: lightness falls along 10-16 m on
the wash and as composited (every view and lighting), its hue turns on (`--ext-turn`), and it is scored on the old cap's distance,
the solver's watch lines and (`--ext-joint`) the room it leaves step 2's flag, which must be darker than the new cap as drawn. Two
traps on the way: unbounded, light's anchor dived to L* 9 and left its flag 3.1 dE00 (`--ext-lmin`); and under beach's brick a
saturated red 16 m stop left the violet flag only 7-9 dE00 once it had to be darker as drawn, which only the joint search saw.
`wave-check.mjs` checks the extended table as `v2@16` and the 16 m kill's table as `v2`.

**What the height byte's step costs (`wave-quant.mjs`, 2026-10-20).** One texel decodes to a quantized height; the script prices
it as the wash draws it (the depth-floor blend under 0.18 m, the table, half swell lighting, world alpha) every 1 mm from 0 to
10 m, for the u8 /10 floor (dev), u8 /16 floor and round, and R16F. The calm end dominates (the blend is steep): floored, the /16
byte's worst texel was 23.5 dE00 in light against dev's 15.3, so the 16 m path rounds (11.6, mean 0.17 against 0.22).

**Crests (`crest-solve.mjs`; light's table is `src/components/map/marineCrestPalette.js`; 2026-10-20).** The checker's crest line
reads light's crest colours from that module (v1 over the v1 wash, V2 over v2, as the app draws them) and beach's from the shader's
literals (D-035: beach's colours are the owner's); `--crest v1|v2|cand.json` swaps light's (a candidate file: pass `--theme light`).
It samples every 0.1 m and the above-cap state, every zoom and swell lighting, whitecap off and on, and reports APCA |Lc| for the
crest body and a whitecap's front apart; a watch line adds the engine's crest self-contrast (below 1.05 m at every zoom, and every
height in the z 3-4.9 band). `crest-solve.mjs` searches the colours (CIELAB LCh, the shader's two decimals) for the largest
colour-blind soft minimum of crest core vs wash, with a normal-vision floor (`--floor 18`), a crest path that never greys
(`--path-c`) and the top stops apart (`--stop-de 20`: without it the search lays active = storm and the crest stops telling 3 m
from 6 m). `--polarity` adds a switch height: below it calm and active take a DARK pair, at and above it a LIGHT pair (DRAW_FS
`mix(below, above, step(h, v_wave_height))`, still one line each), and the objective adds the APCA |Lc| soft minimum with a floor
(`--lc`). `--foam r,g,b` sets the foam below the switch (the theme's foam at and above it) and makes the APCA terms score whitecap
fronts too: light's switch sits near 3 m, where DRAW_VS's whitecap (`smoothstep(0.5, 3.0, h)`) is at full strength, and white foam
mixed into a dark ink there lands on the wash's own luminance (|Lc| 0 on its front). The table's `foam: { rgb, above }` switches
DRAW_FS's `foamHighlight` the same way.

```powershell
node crest-solve.mjs --theme light --polarity --switch 2.6,3.3 --dark-h 50,80 --storm-h 60,100 --foam 0.05,0.02,0 --out l.json
node wave-check.mjs --palette v2 --theme light --crest v1   # today's light crests over v2 (the "before")
node wave-check.mjs --theme light                           # what ships (light V2), over v2 and v2@16
.venv/Scripts/python cvd_lut.py lut.json                    # coloraide's dichromats on a 33^3 linear lattice, for ../offline-backend/crest_contrast.py
```

What the light search taught (over v2 and v2@16; light's wash passes APCA Y 0.352 at 2.6-3.3 m):
- A smooth ramp that keeps colour contrast crosses the wash's luminance somewhere (crest lighter at storms, darker at calm); today's
  navy -> amber -> crimson does near 3 m and, in the worst zoom and lighting, stays at |Lc| 0 up to 16 m. Direction of motion is
  lost at isoluminance (Lindsey & Teller 1990), and a crest is a moving mark. Only a switch avoids it.
- Free hues pick a dark RED ink below the switch: the hue of light's red above-cap flag (an oxblood ink sits 1.5 dE00 from it). Navy
  or plum lose colour-blind contrast (10-15) once a whitecap lightens them on the blue wash; umber (hue 50) keeps the blue-yellow
  difference dichromats keep. Light's navy kept below the switch: |Lc| 37.2 against umber's 40.0.
- The light ink at the switch must be near-white (cream, L* 99) and the storm stays as light (lemon-gold): an amber-gold storm drops
  |Lc| to 32 at 5.3 m on the cream-to-storm path, an orange one to 25. A lemon above the switch (beach #416's ink) buys colour-blind
  24 -> 32 for about 4 |Lc|.
- Switch 3.05 m is the best worst case (|Lc| 39.8 at 0.01 m sampling; 3.10 -> 38.2, 3.20 -> 33.9).

**Light's spectrum (D-037, 2026-10-21).** Light draws `spectrum` (seven bands on the WMO / Douglas sea-state breaks, cap 14 m);
the kill `__RAW_DISABLE_WAVE_SPECTRUM__` draws v2 at 16 m. `wave-lib.mjs` models its opacity law (`spectrumAlpha`, no floor blend).

```powershell
node spectrum-solve.mjs      # the seven break colours: widest weakest neighbour step at max displayable chroma, lightness falling
node spectrum-tune.mjs       # 4-6 m: violet trim + OKLab blend anchors so the band's lightness cannot climb (the winner goes in by hand)
node wave-check.mjs --palette spectrum --theme light   # what light ships
node crest-switch.mjs --palette spectrum --from 1.3 --to 3.2   # V2's crest colours: weakest |Lc| by switch height (1.55 m best)
node crest-critique.mjs [--json out.json]   # crests vs the wash under them in all three themes, by height: |Lc|, colour-blind dE00, hue relation
```

**Re-solved apart from dark (same day; owner: "too close to the same color as dark modes water").** `theme-distance.mjs` measures, per
height, light's composite against dark's (the shader ramp over the dark style's sea) and beach's (v1): the first spectrum sat at 0.8-3 m
mean 15.0 dE00 from dark (v2 24.0), and its 4-6 m violet/magenta was dark's own (13.7 / 11.3). `spectrum-apart.mjs` is the solver with a
hard floor: from 1.2 to 6 m light stays at least as far from dark (and beach) as v2 is, at every 0.1 m.

```powershell
node theme-distance.mjs                        # v2@16 and the spectrum against dark and beach, by height
node spectrum-apart.mjs --water-cvd 4 --cmin-common 32 --low 8   # the shipped table: soft green -> aqua -> teal -> steel blue -> indigo -> maroon -> dark red
```

Below 1.2 m the floor is 10 (not v2's): a colour as far from dark's 0.5 m green as v2's is would be lighter than light's own water, and
the spectrum's calm fade (water to 0.5 m) would then climb in lightness. `--water-cvd` keeps that fade's own step visible to every
colour vision. Scores (1 = every neighbour step meets normal 10 / colour-blind 6.5 / lightness 5): a lime start 1.01 but a dusty sage
1.25 m band (the solver kept 1-2 m far from dark's bright cyan by greying it); mint starts 0.22-0.50; shipped: `--cmin-common 32`
(no grey in the common sea) with the calm floor at 8, 1.10.

Over the re-solved spectrum the crest switch sits at 2.35 m (`LIGHT_CRESTS.v2s`, |Lc| 41.7; 33.0 at v2's 3.05 m). The first spectrum
crossed at 1.55 m (42.4).

**The original crests over a light wash (D-041 made them light's default again).** `crest-over-wash.mjs --crest v1` gives the weakest
APCA |Lc| of a crest core over live light and the spectrum at the opacity the engine draws it per zoom (DRAW_VS's zoom factor x DRAW_FS's
energy boost, `crest-over-wash-lib.mjs`): |Lc| 0 from about 2-2.5 m up on both. `spectrum-apart.mjs --crest-lc N --crest-zoom 9` asks a
wash to keep them N off at every height: no solution down to N = 10 (amber and crimson are mid-lightness; a falling light wash passes
through them). The remedy is in the crest, not the wash. The model's numbers are full-opacity crest cores; at world zoom the engine draws crests at partial opacity, where a
mid-lightness wash (the spectrum's 1.5-3 m blue) leaves little room in either polarity: read the engine
(`../offline-backend/crest_contrast.py`, paired frames) before trusting a switch height.

## Why coloraide and not culori for colour blindness

culori's Machado filter rendered a textbook red/green pair 17.6 ΔE2000 apart under deuteranopia. Both coloraide models
give about 6, the expected near-collapse. The DaltonLens review rates Viénot (protan/deutan) and Brettel (tritan) best
for dichromacy.

## Dark's storm crest (`dark-storm-crest.mjs`; the table is `marineCrestPalette.js` `DARK_STORM_CRESTS`; 2026-10-20)

Dark keeps its own palettes; this checks the one place the owner flagged, storms of 8 m and up, where dark's wash runs neon magenta
(5 m) to white (10 m+) past the fiery-orange storm crest. It reads dark's ramp and its non-surf lifts from `WebGLMarineShaders.js`, the
dark crest literals from `WebGLMarineParticleShaders.js` and the storm line from the crest module, and throws if any of them moves. Per
height (0.1 m, and above the cap), worst over zoom alpha (world, the z 3.5-4.4 core lift, regional, coastal, close, and 0.90, above the
BLEND BOTH composite's 0.885 at z 8) and swell lighting: the crest body's APCA |Lc|, a whitecap front's (and at close zoom),
colour-blind and normal CIEDE2000; it also proves every candidate draws today's crest below the switch. `--lut` writes the wash ramp per
harness view for `../offline-backend/crest_by_height.py`; `cvd_lut.py` (coloraide's dichromats on a 33^3 lattice, from this folder's
`.venv`) feeds its colour-blind column.

```bash
node dark-storm-crest.mjs --json check.json --lut lut.json   # today (v1) | cased orange from 8 m (v2, shipped, D-039)
node dark-storm-crest.mjs --from 5 --strict                  # exit 1 if the shipped crest falls under its bar at 8 m+
.venv/Scripts/python cvd_lut.py cvd_lut.json                 # the dichromat lattice crest_by_height.py reads
```

- Over dark's measured water (93, 117, 126) today's orange core is |Lc| 0 at EVERY height from 5.5 m up in the weakest view (its
  whitecap front from 7.5 m): orange is a mid-luminance colour, and the wash's luminance passes it on the way to white.
- Shipped (D-039, the owner's pick): the cased orange. Today's orange stays (no colour switch), and from 8 m dark's crests take the
  engine's own crest self-contrast: a rim at 0.55-0.64 x the colour round a core at 1.30 x plus a little white. The checker judges a
  crest by its stronger part (core, or the rim at ellipse distance 0.7, alpha 0.70): |Lc| 20.4-38.0 from 8 m (the rim; the lifted core
  sits at the wash's brightness), colour-blind 19.7 (today 15.5). Its bar: |Lc| >= 20, never below today's at any height, colour-blind
  not below today's.
- Turned down on the way, kept here as the record: ember-black / ember red (|Lc| 37-58 / 31-53, but soot on the white eye: "I dont
  like the darker middle crests"); electric blue (0, 0, 1) (|Lc| 35-57, colour-blind 38, but a colour switch mid-field, the kind the
  owner rejected in light). No light ink works at 8 m+ (the wash ends white).
- A whitecap front (the colour mixed 45% toward white, 67% at close zoom) is shared by every height and left as it is.

## Keep in sync

The `MODEL` block in `check.mjs` must match `HEATMAP_FS` / `DRAW_FS` and the `TINT` / `SURFACES` / `BASEMAP` constants
in `windFieldLut.test.js`: strengths, base alphas, ramp ends, particle opacities, and the measured water and land
colours.

Background: `reports/Color and motion tools for Claude.md` and `reports/Wind particle color basemap contrast.md`.
