# Wind palette checker

Checks the wind colours **as they are actually drawn over the map**. Bare swatches can look fine and still disappear
over the basemap water.

- **Light and beach** multiply the field into the basemap: `out = map × (1 − s(1 − c))`, on encoded sRGB.
- **Dark** blends the field over the basemap.
- **Particle streaks** sit on top of that tint.

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
```

## What it reports, per theme

| Line | Meaning | Floor |
|---|---|---|
| legend | Weakest pair of neighbouring legend stops, normal vision | ≥ 9 ΔE2000 |
| tint off the water / land | Weakest tint at 6 kn and above. 3 kn is the owner's deliberately soft "middle ground" | ≥ 14 ΔE2000 |
| speeds < 20° off the water hue | Speeds whose tint reads as "more water" | ≤ 2 kn wide; a violet → green ramp must cross a cyan water's hue once |
| speed-colour core vs its tint | The streak's ~1 px colour core against the tint it sits on. Watch item only: the white ring carries the motion | \|ΔL*\| ≥ 3 |
| colour-blind | Neighbouring legend stops and neighbouring tints over water, via coloraide (Viénot protan/deutan, Brettel tritan) | ≥ 5 ΔE2000 |

## Why coloraide and not culori for colour blindness

culori's Machado filter rendered a textbook red/green pair 17.6 ΔE2000 apart under deuteranopia. Both coloraide models
give about 6, the expected near-collapse. The DaltonLens review rates Viénot (protan/deutan) and Brettel (tritan) best
for dichromacy.

## Keep in sync

The `MODEL` block in `check.mjs` must match `HEATMAP_FS` / `DRAW_FS` and the `TINT` / `SURFACES` / `BASEMAP` constants
in `windFieldLut.test.js`: strengths, base alphas, ramp ends, particle opacities, and the measured water and land
colours.

Background: `reports/Color and motion tools for Claude.md` and `reports/Wind particle color basemap contrast.md`.
