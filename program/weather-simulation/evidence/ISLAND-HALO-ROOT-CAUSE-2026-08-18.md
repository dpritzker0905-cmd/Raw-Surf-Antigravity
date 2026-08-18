# The island halo is a GRID-RESOLUTION limit — not the mask, a layer, a discard, or the overlay

Owner, 2026-08-17: *"the coastline land band halo still is visible over islands. It seems improved
over land."* Both halves of that are correct, and the second half is the clue that cracked it.

---

## 1. The cause, in the numbers

Madeira, z9.3. The marine grid resident at that camera is **8×7 at ~22.5 km per cell**
(`_waveData.waveGrid`, read directly — not from pixels):

```
 1.4  1.3  1.1  1.0  1.0  1.0  1.1  1.3      row 0 = SOUTH (lat 32.12)
 1.5  1.4  1.2  1.0  0.8  0.8  1.1  1.3
 1.5  1.4  1.3  0.9  0.6  0.7  1.0  1.3
 1.6  1.5  1.5  0.0  0.0  0.0  1.2  1.4      <- MADEIRA: three land cells, zeroed
 1.6  1.6  1.6  1.5  1.4  1.4  1.6  1.6
 1.6  1.6  1.6  1.6  1.6  1.5  1.6  1.7
 1.7  1.7  1.7  1.7  1.6  1.6  1.7  1.7      row 6 = NORTH
```

`backendWeatherServiceClientHelpers.js:537` zeroes every `!isOcean` vector. Those zeros do **not**
reach the GPU: `extrapolateOceanData` (`WebGLMarineFieldMath.js:74`, called at
`WebGLMarineTextureEncoder.js:258`) already fills them with an 8-neighbour ocean mean, 2 passes.
Applying it by hand to the three island cells:

| | |
|---|---|
| island cells after extrapolation | **1.26, 1.08, 1.13** |
| south of the island (lee) | mean **1.12** |
| north of the island (exposed) | mean **1.60** |

⇒ the island's cells are filled with a blend of **both** regimes, and `gl.LINEAR` then spreads that
single averaged number outward. The **windward north shore, which should read ~1.6, ramps down to
~1.1** approaching land. The ramp is one cell — ~22 km — and it closes into a ring because an island
has coast on every side.

★ **The lee/windward asymmetry itself (1.12 vs 1.60) is REAL PHYSICS and correctly in the data.**
Madeira's south coast genuinely is sheltered. The defect is only that the island's own cell carries
a mixture of both onto shores where one applies.

★ **Why land is better, exactly as the owner observed.** On a mainland coast the zeroed/averaged
cells sit INLAND, so the ramp falls on land and the coastline covers it. Lisbon's grid has 0.0 cells
too and shows no band. An island smaller than a couple of cells has its cells in the middle of
visible water, so the whole ramp is exposed.

## 2. Why every lever in this arc failed

None of them touch the sampled **value**. Excluded by direct measurement, each with a control:

| eliminated | how |
|---|---|
| the ocean mask | reads **255 = full water** on every term through the band |
| a covering basemap layer | hiding each in turn changes nothing (except a road shield — see §3) |
| overlay engagement | `coverage_gap` and `midcarve_replace` both show it |
| the two shader discards | `mode='why'` shows neither fires |
| wave-data region/staleness | Florida grid and Madeira grid give the same result at fixed zoom |
| basemap generalisation | basemap shoreline is stable at every zoom |
| **missing field** | symbol-suppressed survey: band median **0 m** on 24/24 bearings, all cameras |

## 3. ⚠️ Two of my own instruments produced false findings — both retracted

- **The "255° residual" was a `road-number-shield` ICON.** Hiding that one symbol layer flipped the
  hole to the debug colour; every `ocean-mask-*`/`water` layer changed nothing. The detector —
  *"the pixel equals its own waves-OFF colour, so there is no field here"* — **cannot separate NO
  FIELD from COVERED BY A LABEL**, because a label paints identically in both states, and coastal
  roads put shields exactly where coastlines are. Every canvas readback in this arc is suspect;
  `island-halo-survey.js` suppresses all layers above the marine layer before measuring.
- **I almost shipped `marineGridLandFill.js`, a duplicate of `extrapolateOceanData`.** Caught by
  grepping before building. It would have been dead code, and worse, its premise — that the raw
  zeros reach the GPU — was wrong.

★ Both were caught the same way: **a positive control and a grep, not a green result.**

## 4. The only two real repairs

1. **Land-aware sampling.** Weight the bilinear fetch to exclude land texels and renormalise.
   Correct — but the wave texture's four channels are already u/v/height/period, and the ocean mask
   is a DIFFERENT grid at a different resolution, so the shader has no per-texel ocean flag. Needs a
   new channel or texture: a substantial change to the encode/upload path.
2. **Finer marine data near islands.** Data-side, outside the frontend.

⛔ **Anything smaller is cosmetic.** Filling the island cell differently only moves the error from
the windward coast to the lee — one 22 km cell cannot represent both. **Do not "tune" the
extrapolation.**

## 5. Instruments left behind (all committed)

`island-halo-survey.js` (symbol-suppressed gap survey) · `island-rim-metric.js` (rim width/peak with
an open-water noise-floor control) · `island-grid-values.js` (raw grid dump; refuses to report when
the resident grid does not cover the camera) · `teardown-255-whopaints.js` (per-layer covering test)
· `__GPU_DEBUG__.mode='why'` (discard-reason map, shipped in `3bf1ef1d`).
