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

1. ~~**Land-aware sampling.**~~ ⛔ **BUILT, MEASURED, AND REFUTED — see ADDENDUM (b) §4.** It was
   implemented (`bcd8eb3e`, flag corrected in `2f58c7e6`) and the within-build A/B made the halo
   **WORSE**: 0 → 40 px at z9.3 against an open-water control of 0. Renormalising the weights makes
   the interpolant DISCONTINUOUS at the coast — it replaces a ramp with a step. Shipped OFF in
   `f7714cf2`, opt-in via `__RAW_ENABLE_LAND_AWARE_FETCH__`. **Do not re-enable it without a smooth
   variant, and note that a smarter INFILL is refuted too (identical at unit island thickness).**
2. **Finer marine data near islands.** Data-side, outside the frontend. Still the only real repair.

⛔ **Anything smaller is cosmetic.** Filling the island cell differently only moves the error from
the windward coast to the lee — one 22 km cell cannot represent both. **Do not "tune" the
extrapolation.**

## 5. Instruments left behind (all committed)

`island-halo-survey.js` (symbol-suppressed gap survey) · `island-rim-metric.js` (rim width/peak with
an open-water noise-floor control) · `island-grid-values.js` (raw grid dump; refuses to report when
the resident grid does not cover the camera) · `teardown-255-whopaints.js` (per-layer covering test)
· `__GPU_DEBUG__.mode='why'` (discard-reason map, shipped in `3bf1ef1d`).

---

# ADDENDUM 2026-08-18 (b) - the owner's water_temp hypothesis, tested; and the limit, PROVEN

Owner: *"You had this issue resolved 4 days ago for marine layers. And I think our fixing water temp
layers, we messed this up."* The history has exactly that shape, so it was tested directly.

## 1. The water_temp regression was real - and it is already repaired

| date | commit | what |
|---|---|---|
| 08-13 | `e88b0f68`, `f3fe2c85` | water_temp anchor fixes. `f3fe2c85` RAISED the ocean mask above the basemap water fill, moving the water_temp slots **and the marine layer** with it (`water_temp [3,4,5]->[19,20,21]`, `ocean-mask-fill 6->22`, `water 11->6`) |
| 08-15 | `7becd023` | "the owner's visible regression ROOT-CAUSED - the mask-family **stack order**" |
| 08-16 | `784b4c6c`, `d555b17e` | the repairs; LOP-0001..0003 |

**Audited live on deployed `f7714cf2` (`layer-order-audit.js`) - every proven invariant HOLDS:**

```
  4  water                 (basemap fill)
  8  water-shadow          (basemap fill)
 10-12 water_temp-slot-{0,1,2}-layer
 13  ocean-mask-fill       opacity 1
 16  webgl-marine-particles   <- the marine field
 17  ocean-mask-buffer     vis=none    (LOP-0001: resolveCoastBufferOn returns forceFlag===true)
 18  ocean-mask-line       opacity 0.8@z9 -> 0@z12
```

=> `water < water-shadow < water_temp < ocean-mask-fill < marine`. The 08-16 repair is intact and the
water_temp anchor move has **not** come back.

WARNING - **my audit first reported INV-1 BROKEN, and that was MY filter, not the code**: it counted
`ocean-mask-inland-water` (idx 14) as a basemap water fill because its `source-layer` is `water`, then
compared `ocean-mask-fill` (13) against it. The real basemap fills are 4 and 8, and 13 > 8.
* A layer named `*-water` in a MASK family is not a basemap water fill - test set membership by ROLE,
never by name.

## 2. No layer paints the ring - measured one at a time

`ring-layer-isolate.js`, nothing suppressed by default, one layer to opacity 0 per leg:

| camera | stock rim | best single-layer improvement |
|---|---|---|
| madeira z8.5 | **16 px**, peak 51, 24/24 bearings, open-water control **0** | `water-shadow` -2 px |
| madeira z9.3 | **11 px**, peak 38, 23/24 | `ocean-mask-buffer` -3 px |

A real band exists (control 0) and **no candidate accounts for it** - not the mask family, the buffer,
the line, or the basemap water. => it is in the FIELD's values, not in the compositing.

**This also explains why my earlier surveys found "no band".** `island-halo-survey.js` and
`island-rim-metric.js` suppress every layer above the marine layer before measuring - a defence
against the road-shield artifact - which also removed every suspect. **A defence against one artifact
became blindness to the target.**

## 3. THE LIMIT IS NOW PROVEN, not asserted - and no infill can fix it

Madeira is **one cell thick**. Each island cell touches the north AND south ocean rows directly, so
there is no interior for any solver to differentiate. Computed on the measured grid:

| island cell | shipped 1-ring mean | Laplace/Dirichlet solve |
|---|---|---|
| r3c3 | 1.26 | 1.25 |
| r3c4 | 1.08 | 1.09 |
| r3c5 | 1.13 | 1.10 |

Identical to within 0.03 m - **the harmonic solution IS the neighbour mean at unit thickness.**

```
north (windward)  true 1.43  ->  renders 1.24-1.38    ~10% LOW
south (lee)       true 0.73  ->  renders 0.84-1.08    15-48% HIGH
```

Nearshore is pulled toward ~1.1 from BOTH sides; that intermediate band is the ring.
WARNING - this corrects my own earlier claim of "1.6 -> 1.1 on the windward shore": measured, it is
1.43 -> 1.24. Smaller than I said.

## 4. Ruled out, by measurement or arithmetic

- NO: a layer-order / water_temp regression - invariants audited, all hold
- NO: any compositing layer - isolated one at a time against a working control
- NO: land-aware fetch (exclude + renormalise) - **measured WORSE**, 0->40 px at z9.3, because
  renormalising makes the interpolant discontinuous at the coast. Shipped OFF (`f7714cf2`).
- NO: a smarter infill (Laplace, normalized convolution, inverse distance) - **arithmetically
  identical at unit island thickness. Do not build one.**

**Only two things can move this:** finer marine data near islands, or a presentation decision to stop
implying resolution the data does not have within one cell of a small island. Both are owner calls.
