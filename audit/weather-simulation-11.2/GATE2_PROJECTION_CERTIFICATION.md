# GATE 2 — PROJECTION TRUTH — ~~FAIL~~ → **CONDITIONAL PASS** (corrected 2026-08-11)

> ## ⛔ RETRACTION — G2-01 IS REFUTED. I PUBLISHED A CRITICAL FINDING THAT WAS WRONG.
>
> **The marine field DOES render at the antimeridian.** Re-measured with a 20 s settle instead of
> 10 s: the Aleutian view at 179.6 E / z4.2 paints a full teal field with particle streaks.
>
> **What I got wrong:** I concluded "the field does not render" from a single screenshot taken 10 s
> after a `jumpTo`. That is a **settle-time artifact**, not a projection defect. The two controls
> (mid-Pacific, North Atlantic) happened to paint within 10 s; the antimeridian view did not — so my
> "only longitude differs" reasoning was sound but my readiness criterion was not. **I compared
> rendered-vs-blank when I should have compared time-to-paint.**
>
> **The mechanism I proposed was also refuted by measurement.** `__RAW_GPU__.wrapCull` — a
> diagnostic the code already publishes — reads at the two views:
>
> | view | vbWest | vbEast | `needWrap` |
> |---|---|---|---|
> | control mid-Pacific | −157.16 | −122.84 | `false` (correct — no wrap needed) |
> | **antimeridian 179.6 E** | **162.44** | **196.76** | **`true`** (correct — wrap engaged) |
>
> The world-copy loop is present and correct (`WebGLMarineEngine.js:1850`:
> `worldOffsets = _needWrap ? [0.0, -360.0, 360.0] : [0.0]`), and `_needWrap` fires exactly as
> designed. This defect class was **already found and fixed** — `WebGLMarineEngine.js:496-502`
> documents the prior incarnation (array-vs-object property access made all three antimeridian
> conditions dead code) in terms that match my symptom almost word for word. I rediscovered a
> **closed** bug and mistook a slow paint for its return.
>
> **What survives as a real (Low) observation — G2-01b:** the antimeridian view was blank at 10 s
> and painted by 20 s, while both controls painted within 10 s. A **slower first paint near ±180**
> is plausible (wrap engages 3× the heatmap draw calls) but is **NOT yet measured** — I have two
> data points, not a timing study. It must not be reported as a defect until time-to-paint is
> measured head-to-head.
>
> **Gate 2 is corrected from FAIL to CONDITIONAL PASS.** Everything in §"What PASSED" below stands
> unchanged and was independently verified; the condition is the unmeasured paint-latency asymmetry
> plus the items still untested (DPR, resize, pixel-wise mask registration, synthetic fields).

---

## ~~ORIGINAL VERDICT (SUPERSEDED — retained for the audit trail)~~

Commit `e015d90b` · production backend · Chromium · 2026-08-11.
Supersedes the `BLOCKED (untested)` status recorded in `RELEASE_GATE_MATRIX.csv` and gap G-02.

---

## VERDICT: ❌ FAIL — one Critical defect, on an otherwise sound projection stack

The projection *mathematics* are correct and the field is stable under rotation, tilt, latitude and
zoom. **But an entire longitude band renders no forecast at all.**

---

## G2-01 — CRITICAL — the marine field does not render at/near the antimeridian

**Reproduction** (identical layer, model, hour, zoom; only the centre longitude varies):

| view | centre | zoom | lat | field rendered? |
|---|---|---|---|---|
| Aleutians / Bering Sea | **179.6 E**, 51.5 N | 4.2 | 51.5 | ❌ **NOTHING** |
| Mid-Pacific | 140 W, 35 N | 4.2 | 35 | ✅ full field |
| North Atlantic | 30 W, **51.5 N** | 4.2 | **51.5** | ✅ full field (storm core, 12–20 ft) |

**Both confounds were controlled and eliminated:**
- *Zoom fade?* `marineZoomThresholds.js` documents a 5.5→6.5 coarse fade, so z4.2 could plausibly
  be transparent by design. **REFUTED** — mid-Pacific renders fully at the identical z4.2.
- *High latitude?* **REFUTED** — the North Atlantic control sits at the **same 51.5 N** and renders
  fully. Only longitude differs.

**The data is present.** At the antimeridian view the runtime reported
`vectors: 594, nonzero: 447, NaN: 0, min 0, max 3.971 m` on `gfs_marine_waves_global_mid`
(res 2°). **Coastlines render correctly there** — the Aleutian chain and the "Bering Sea" label
draw continuously across 180°. So this is not a data gap and not a basemap problem: the field
exists, is valid, and is not painted.

**User consequence:** the layer button reads active, the legend renders, and the ocean is blank —
the same false-ready shape as RC-01/RC-04, expressed geographically.

**Mechanism — lead, not conclusion.** `WebGLMarineShaders.js:22-24` handles a date-line-crossing
*data bbox* (`u_dataBounds_min.x > u_dataBounds_max.x` ⇒ +360 branch). But the served product is
`global_mid` with bounds −180..180, so `west < east` and **that branch never fires**. The remaining
suspect is the **world-copy** path: MapLibre draws repeated world copies, and a viewport centred at
179.6 E needs the copy at `u_lng_offset = ±360`. If the layer emits only the offset-0 copy, the
region beyond +180 has no geometry to sample. `u_lng_offset` exists in the shader, so the question
is whether the draw loop issues the wrapped copies — **not yet verified, do not treat as root
cause.**

---

## What PASSED

**P-1 — Mercator projection math is correct.** `WebGLMarineShaders.js:15-19` implements the exact
Web Mercator transform `(1 − ln(tan φ + sec φ)/π)/2` with the correct ±85.051129° clamp, applied
**per grid vertex**, so the field mesh is genuinely Mercator-projected rather than linearly
stretched.

**P-2 — mesh interpolation error is bounded and small at every served tier.** Between grid rows the
GPU interpolates Mercator Y linearly. Computed mid-cell registration error:

| grid | lat 20 | lat 40 | lat 70 | lat 75 |
|---|---|---|---|---|
| **0.25°** regional | 0.0 km | 0.0 km | 0.0 km | **0.1 km** |
| **2°** global_mid | 0.4 km | 0.8 km | 2.8 km | **3.9 km** |
| **10°** global_coarse | 11.4 km | 24.4 km | 93.5 km | **147.9 km** |

Even the worst case is ≈13% of a 10° cell (~1100 km). **Jacobian reading:
∂(registration error)/∂(spacing) is superlinear, but at every tier the projection error is small
relative to the cell.** Projection refinement is *not* where accuracy is lost — resolution is.
This corroborates `STATE_OF_THE_ART_PATH.md`: do not invest in projection; invest in resolution.

**P-3 — bearing and pitch do not perturb the field.** Florida z6 baseline `max = 2.571 m`;
at **bearing 45°** `max = 2.571`; at **pitch 45°** `max = 2.571`. Exact.

**P-4 — no invalid values anywhere.** 7 geographies (Florida, 70 N, antimeridian ×2, 60 S,
bearing 45, pitch 45): **0 NaN total**, every view with data rendered non-zero vectors.

**P-5 — high latitude and the Southern Ocean behave.** 70 N returned 447 non-zero of 594;
60 S returned 517 of 759 with `max = 7.157 m` — physically plausible Southern Ocean swell.

**P-6 — no skipped Jest tests.** `test.skip` / `test.fixme` / `describe.only` census over
`frontend/src`: **zero matches.** (The `test.fixme` problem recorded in memory is in the Playwright
e2e lane, not this suite.)

---

## Still NOT tested under Gate 2

- **DPR 1 vs 2** and viewport resize — not exercised.
- **OceanMask registration against coastline at close zoom** — only judged at z4.2, where the
  basemap coastline was correct but mask-vs-coast alignment was not measured pixel-wise.
- **Synthetic canonical fields** (uniform E/W/N/S, vortex, checkerboard) — still absent (G-08), so
  row reversal / UV flip / handedness remain unverified **in either direction**.
- Polar (>80°) behaviour beyond the shader clamp.

---

## Required corrective action

1. Determine whether the marine custom layer emits wrapped world copies (`u_lng_offset = ±360`).
   The shader supports it; the draw loop is unverified.
2. Add a **deterministic antimeridian render test** — the existing
   `WebGLMarineMaskRenderer.antimeridianRing.test.js` and `marineGridSeries.antimeridian.test.js`
   cover the mask and the series bbox, **not the painted heatmap**, which is why this survived.
3. Re-run this three-view control (179.6 E / 140 W / 30 W at identical zoom+latitude) as the
   acceptance check.

**Gate 2 must not be recorded as passing until G2-01 is closed.**
