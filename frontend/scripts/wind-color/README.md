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
node wave-check.mjs                     # every palette in marineWavePalette.js (v1, A, B), both themes
node wave-check.mjs --palette A --pairs # one palette, every neighbouring pair by model at world alpha, crest by height
node wave-check.mjs --table cand.json   # a solver's table ({ heights, cap, over: {light, beach}, light, beach }) instead
node wave-check.mjs --strict            # exit 1 on any RED line, here or in the coloraide authority
node wave-solve.mjs --theme light --family A [--hend 315,350] [--seed 1] [--gens 1800]   # search one theme's table
```

**The model (`wave-lib.mjs`).** HEATMAP_FS lays `W(h) + swell lighting` premultiplied at the wash alpha, blended
`ONE, ONE_MINUS_SRC_ALPHA` over the style's `water` layer; the land is drawn OVER the marine rasters, so the coast is the land
colour against the composite. Alpha by view (`heatmapZoomOpacity`): world 0.65, regional 0.70, coastal 0.77. Basemap water and
land are the measured colours in `windFieldLut.test.js` (unmuted: the wind's basemap mute runs only while the wind is on). The
shader's depth floor under 0.18 m is reported on its own line; LEGEND STOPS are composited from the table itself. Crests are
DRAW_FS's colours at their 0.85 core alpha, with the whitecap the shader allows at that height.

| Line | Meaning | Bar |
|---|---|---|
| lightness | OKLCH L of the wash and of the composite (every view; swell lighting off, half, full), every 0.02 m | falls at every step (RED) |
| no grey | CIELAB C* of the wash path and of the composite, the above-cap state included (D-019) | >= 12 / >= 8 (RED) |
| neighbours | neighbouring legend stops and the above-cap state, as composited, normal + protan/deutan/tritan | target >= 10 (RED) |
| land vs sea | the composite nearest the land colour | watch below 15 |
| crests | a crest's core against the wash under it, normal and colour-blind, and APCA | watch below 15 |
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

## Why coloraide and not culori for colour blindness

culori's Machado filter rendered a textbook red/green pair 17.6 ΔE2000 apart under deuteranopia. Both coloraide models
give about 6, the expected near-collapse. The DaltonLens review rates Viénot (protan/deutan) and Brettel (tritan) best
for dichromacy.

## Keep in sync

The `MODEL` block in `check.mjs` must match `HEATMAP_FS` / `DRAW_FS` and the `TINT` / `SURFACES` / `BASEMAP` constants
in `windFieldLut.test.js`: strengths, base alphas, ramp ends, particle opacities, and the measured water and land
colours.

Background: `reports/Color and motion tools for Claude.md` and `reports/Wind particle color basemap contrast.md`.
