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
node mirror-model.mjs           # each theme's field over its own map, knot by knot, beside dark's (L*, C*, hue; see below)
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

**As drawn, the colour-blind floor holds in light and does NOT hold in beach** (`node check.mjs --strict` exits 1, two
red lines, both beach's). Dark's rules dim beach's field by one factor, which draws the bands' lightness together. Light
drew the same kind of field from 2026-10-11 (D-020) until the white streak (D-021, the same day) gave it the deeper field
of its A/B, which was solved to hold the floor:

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

## Light's path: solving a table with the floor as a constraint (`light-path-*.mjs`)

Light's field, streak row and legend bar from 1 to 32 kn are solved tables (`src/components/map/windLightPath.js`, DECISIONS
D-024): dark's hue ORDER in light's own key. Three files made them, and can re-make them:

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
(`window.__RAW_DISABLE_WIND_LIGHT_PATH__ = true`). The checker's legend lines read the bar as the app draws it
(`resolveLegendRamp`): in light on its path that is no longer the particle ramp.

What the solve found, so the next one starts further on: holding light's hue to dark's within 8 degrees (dark by the engine's
law) keeps a 5.2 floor with 6 kn 6 to 7 L\* lighter and 16 to 21 kn 2 to 5 lighter than at 20 degrees, where the depth holds. A cyan as deep as L\* 60 cannot
carry more than C\* 30 under the 0.70 multiply tint, so the 10 kn band stays light in every solve. A bar that chroma have ONE
crest is stricter than dark itself (dark dips through cyan).

## Why coloraide and not culori for colour blindness

culori's Machado filter rendered a textbook red/green pair 17.6 ΔE2000 apart under deuteranopia. Both coloraide models
give about 6, the expected near-collapse. The DaltonLens review rates Viénot (protan/deutan) and Brettel (tritan) best
for dichromacy.

## Keep in sync

The `MODEL` block in `check.mjs` must match `HEATMAP_FS` / `DRAW_FS` and the `TINT` / `SURFACES` / `BASEMAP` constants
in `windFieldLut.test.js`: strengths, base alphas, ramp ends, particle opacities, and the measured water and land
colours.

Background: `reports/Color and motion tools for Claude.md` and `reports/Wind particle color basemap contrast.md`.
