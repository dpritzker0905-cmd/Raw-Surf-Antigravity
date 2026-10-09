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
```

## What it reports, per theme

| Line | Meaning | Floor |
|---|---|---|
| legend | Weakest pair of neighbouring legend stops, normal vision | ≥ 9 ΔE2000 |
| tint off the water / land | Weakest tint at 6 kn and above. 3 kn is the owner's deliberately soft "middle ground" | ≥ 14 ΔE2000 |
| speeds < 20° off the water hue | Speeds whose tint reads as "more water" (unmuted map only: a grey ground has no hue to hide in) | ≤ 2 kn wide; a violet → green ramp must cross a cyan water's hue once |
| speeds > 30° off the legend's own hue | Speeds whose tint the ground bends into another band's colour (a 33 kn gold multiplied into cyan water came out green). The path bench's `hue30` asks the same of real frames | ≤ 2 kn |
| speed-colour core vs its tint | The streak's ~1 px colour core against the tint it sits on. Watch item only: the white ring carries the motion | \|ΔL*\| ≥ 3 |
| colour-blind | Neighbouring legend stops and neighbouring tints over water, via coloraide (Viénot protan/deutan, Brettel tritan) | ≥ 5 ΔE2000 |

The checker does not run in CI. `src/components/map/windPaletteCvd.test.js` pins the colour-blind lines there with a JS
port of coloraide's models, anchored to coloraide's output. It also pins one accepted gap: light's tint over water is
at 2.75, not 5 (log `docs/weather-program/log/2026-10-09-wind-cvd-palettes.md`). With the basemap muted, light's tint over
water reads like its tint over its own near-grey land always has: 1.9 (27-33 kn, deuteranope; the land was already
1.8). That is pinned too, as a known gap whose fix is a light field pass on a neutral ground (log
`docs/weather-program/log/2026-10-09-wind-basemap-mute.md`).

## Why coloraide and not culori for colour blindness

culori's Machado filter rendered a textbook red/green pair 17.6 ΔE2000 apart under deuteranopia. Both coloraide models
give about 6, the expected near-collapse. The DaltonLens review rates Viénot (protan/deutan) and Brettel (tritan) best
for dichromacy.

## Keep in sync

The `MODEL` block in `check.mjs` must match `HEATMAP_FS` / `DRAW_FS` and the `TINT` / `SURFACES` / `BASEMAP` constants
in `windFieldLut.test.js`: strengths, base alphas, ramp ends, particle opacities, and the measured water and land
colours.

Background: `reports/Color and motion tools for Claude.md` and `reports/Wind particle color basemap contrast.md`.
