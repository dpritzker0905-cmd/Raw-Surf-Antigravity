# The residual island halo — measured and characterised, NOT yet attributed

**Owner:** *"The land mask halo is still slightly visible… more visible on the islands."*
**Surface:** dev alias, build **`441c8c9e`**, theme beach, guardrail disabled throughout (otherwise
the renderer is swapped for Open-Meteo raster tiles mid-run).
**Harnesses:** `frontend/scripts/island-halo.js`, `island-rim-ab.js`.

---

## 1. Why the earlier "band = 0 px" missed it

`coastband-ladder.js` needs 20 sustained samples of land AND water to accept a transition. Islands
never meet that floor, so every Grand Bahama row below z7.5 returned `VOID_NO_TRANSITION` and was
dropped. **The refusal was correct; the coverage was not** — the shipped "0 px" was a mainland
result. Islands are now probed radially, 24 bearings from the centroid, with ray length and zoom
derived from each target's own width.

## 2. The halo is REAL, and it is a RAMP — not a step

Radial profile: mean colour at *d* device px outward from the shoreline. Field tint = |ON − OFF|.

| Nassau z10.17 | d1 | d3 | d8 | d12 | d20 | d35 |
|---|---|---|---|---|---|---|
| field tint | **7** | 10 | 12 | 17 | **18** | 17 |

Grand Bahama z8.85 shows the same shape (d1 ≈ 7–12, d35 ≈ 16–19).

⇒ **The field applies at roughly 40% strength at the shoreline and reaches full strength only
12–20 device px out.** That gradient is the halo. It is ~10× wider than a mask texel (2–3 px), so
it is NOT texel softness — the LOP-0002 elimination stands, for a second reason.

★ **This is why the step detectors read zero.** `band`/`bleed` ask "did the field paint here?"; the
defect is "how MUCH did it paint". A binary detector is blind to a gradient. The earlier zeros were
true and irrelevant.

## 3. It is OURS, not the basemap — the L6 control

With Waves OFF the radial profile is **flat** (Nassau 139→143, Grand Bahama 118→143 with no
near-shore feature). The Bahamian banks' turquoise was the obvious alternative explanation and it is
refuted: no field, no rim.

## 4. Why islands and not the mainland

Median `bleed` is **1 device px on islands AND on the Florida mainland** — the same defect. An
island is a closed ring around a small object, so the eye integrates it as a halo; on a mainland
coast the identical fringe is one edge at the frame's border. **Same mechanism, different salience.**
Do not look for an island-specific code path.

## 5. ⛔ Two candidate causes KILLED, and neither by argument

- **Coast SDF.** Measured live at both islands: `coastSDF {base:false, overlay:false, erode:0}`.
  The shader's SDF branch (`maskFade = oceanAlpha`, which would skip sharpening entirely) is not
  taken. ⭐ Worth noting: LOP-0002 rejected "coast SDF" quoting only `base:false`; the **overlay**
  half was never quoted and is a separate flag. It is now measured too, so that elimination rests on
  both halves rather than one.
- **BLEND-BOTH (`__RAW_DISABLE_BLEND_BOTH__`).** Not a usable discriminator: with it set, Grand
  Bahama's profile becomes **identical to Waves-OFF** — the switch removes the *entire* field at this
  zoom, not the near-shore fade. A lever that deletes the subject cannot test a property of it.

## 6. ✅ THE DISCRIMINATOR RAN — it is the RENDERER, two independent ways

`frontend/scripts/halo-value-vs-colour.js` reads the served grid VALUES along the same radial rays
(off the wire — `grid.vectors[].speed`, because `__MARINE_ENGINE__` is absent on the deployed build).

| target | grid | ONE CELL | value d1 → d35 | ratio |
|---|---|---|---|---|
| Grand Bahama z8.85 | 5×5 @ 2.0° | **2,625 device px** | 0.295 → 0.295 | **1.000** |
| Nassau z10.17 | 5×5 @ 2.0° | **6,554 device px** | 0.323 → 0.365 | 0.885 |

**1. By construction.** One grid cell is 2,625–6,554 device px wide. The halo ramp is 12–20 px —
**about 0.5% of a single cell.** The data cannot express a shore-aligned gradient at that scale
whatever its values are.
**2. By measurement.** Grand Bahama's values are *identical* at every distance (0.295, ratio 1.000).
Nassau's 0.885 is a cell CROSSING, not a shore falloff — it steps at d8 and d35, where the rays pass
into the neighbouring 2° cell, and is flat between.

⇒ **The rim is rendered, not represented. The "the data is honestly smaller near shore" hypothesis
is REFUTED**, and the concern that a fix would be "correcting a truthful rendering" is retired.

⚠️ One statistic in that run is the wrong one and is kept here so it is not re-read as a
contradiction: the `lum` column is flat (182→184) because the field's near-shore shift is CHROMATIC
(R +17, B −12 on Grand Bahama) at nearly constant luminance. Absolute luminance was never the
signal; the ON−OFF chromatic delta of §2 is. The two runs agree exactly where they overlap
(182.2 → 185.0 computed from §2's RGB vs 182.2 → 184.2 measured here).

## 7. The narrowed cause — a 2–3 TEXEL ramp, and why LOP-0002's rejection still stands

Resident mask here is the **2048** tier over a ~10° span ⇒ texel = 0.00488° = **6.4 device px** at
this camera. A LINEAR-filtered mask ramps over 1–2 texels ≈ **6–13 px**, and the measured ramp is
12–20 px. The magnitudes line up.

★ This does NOT overturn LOP-0002. That entry measured a **2.3 px** texel in ITS regime and
correctly rejected texel softness for a 10–20 px band. Here the resident mask is a coarser tier, so
the same mechanism produces a ramp 3× wider. **Both readings are right; they are different regimes.**
The lesson is that the rejection should have been recorded as regime-scoped, not absolute.

⚠️ **NOT YET CONFIRMED:** `_maskEdgeSharp` was not recorded at these two cameras. If it was 1.0
(the `min_combine` observations suggest it should have been), then `smoothstep(0.45,0.6)` over a
6.4 px texel ought to give a ~1 px edge, not 12–20 — which would mean the sharpening is not reaching
this pass and that, not the texel, is the defect. **That one uniform is the next read, and it
decides between "widen the sharpening's regime" and "the sharpening never applied here at all".**

## 8. ⛔ THE UNIFORM WAS READ — and it REFUTES §7 (the mask is exonerated)

Read directly off the engine locally (`maskedge-read.js`; the handle is present on localhost, absent
on the deployed build):

| camera | `_maskEdgeSharp` | mask | span | density | **texel** |
|---|---|---|---|---|---|
| Grand Bahama z8.85 | **1** | 4096×2048 | 2.38° | 1720 px/deg | **0.76 device px** |
| Nassau z10.17 | **1** | 4096×2048 | 1.38° | 2962 px/deg | **1.11 device px** |
| Florida z10.17 | **1** | 4096×2048 | 0.83° | 4937 px/deg | **0.66 device px** |

**The sharpening IS applied and the texel is SUB-PIXEL.** A sub-pixel texel behind a crisp
`smoothstep(0.45,0.6)` cannot produce a 12–20 px ramp. ⇒ **the mask edge is not the halo, and §7 is
wrong.** My error there was arithmetic on an ASSUMED tier (2048 over ~10° ⇒ 6.4 px) instead of the
resident one; the real mask is 4096 over 1–2°, nearly 10× finer. ★ **I estimated a quantity I could
have read. The reading is one line of telemetry and it inverted the conclusion.**

## 9. Crests: a REAL near-shore-excluded ring, but not the whole ramp

`__RAW_CREST_LAND_THRESH__=9` (every crest discards), Grand Bahama, R channel:

| | d1 | d3 | d8 | d12 | d20 | d35 |
|---|---|---|---|---|---|---|
| ON | 107 | 109 | 110 | 117 | 113 | **137** |
| ON_NOCREST | 107 | 108 | 108 | 113 | 112 | **124** |
| crest contribution | **0** | 1 | 2 | 4 | 1 | **+13** |

⇒ **Crests add ~13 units of warm colour offshore and ZERO at the shoreline** — a genuine
crest-free ring hugging every coast, closed around an island. That is a real component of what the
owner sees, and it explains the chroma direction (crest ribbons are warm/pink).

⛔ **But it is not the whole story.** With crests removed, the field tint STILL ramps (11 → 19 from
d1 to d35). So crests are one contributor layered on a residual.

⚠️ **And one earlier claim needs narrowing:** §3 said the Waves-OFF profile is flat. That holds for
Nassau (139→143) but NOT for Grand Bahama (118→143) — the basemap itself lightens away from the
bank there. So part of Grand Bahama's apparent tint ramp may be a compositing artifact of a
changing basemap under a semi-transparent field, not a field falloff. **Nassau remains the clean
case, and Nassau's ON_NOCREST leg was void** (it painted no field at all — the same intermittent
failure seen in the blend-both run), so the crest leg has one valid target, not two.

## 10. ⛔⛔ v3: CRESTS REFUTED, AND THE SIGN TEST KILLS MY OWN METRIC

`island-rim-v3.js` — all legs share ONE page load and one resident field (the crest lever is a
per-frame window flag, toggled live), plus a validity gate requiring tint@d20 >= 6. Three targets,
24 rays each, all valid on attempt 1. Tint = max per-channel |leg − Waves-OFF|.

| target | bathymetry | d1 | d3 | d8 | d12 | d20 | d35 |
|---|---|---|---|---|---|---|---|
| Nassau | shallow bank | **26** | 30 | 24 | 21 | 23 | **19** |
| Madeira | deep/steep | **33** | 37 | 52 | 56 | 67 | **80** |
| La Palma | deep/steep | **47** | 61 | 61 | 92 | 115 | **111** |

**1. CRESTS ARE NOT THE CAUSE.** ON and NO-CREST agree to within 1–2 units at every distance on all
three targets. §9's "+13 at d35" was a single target in a run whose baseline was itself contaminated;
applied cleanly — live lever, same resident field — the crest pass changes nothing. **§9 is refuted.**

**2. ⭐⭐⭐ THE SIGN FLIPS, WHICH REFUTES THE WHOLE APPROACH.** Nassau's tint is HIGHEST at the
shoreline and falls outward (26 → 19). Madeira and La Palma do the opposite (33 → 80, 47 → 111). A
coast-relative rendering deficit must have the SAME sign on every coast. It does not.

⇒ **My radial-tint metric is CONFOUNDED and cannot answer the question.** On an island, "distance
from shore" and "exposure to open ocean" are the same axis — going outward on every bearing also
means going into bigger swell. At Madeira the tint reaches 80–111 units, which is Atlantic swell
structure, not a pixel-scale edge effect. The metric measures the wave field, not the halo, and I
built that collinearity in from the first ray.

★ The program's own rule caught this: *a mechanism that predicts the wrong sign is refuted, not
partial.* Applied here it does not merely reject a mechanism — it rejects the instrument.

## 11. What would actually isolate it — measure ALPHA, not colour

A halo IS an alpha deficit, and alpha is exactly what a composite hides:
`C = α·field + (1−α)·basemap`. Two unknowns, one equation — so any single-frame colour reading is
under-determined, which is why every metric so far has been confounded by either the basemap (§9)
or the field (§10).

**Solve it instead.** Capture the SAME camera under two themes (light and beach give different
basemap colours, `B_A ≠ B_B`) with the field identical, then per pixel:
`α = 1 − (C_A − C_B)/(B_A − B_B)`, taking `B` from the matching Waves-OFF frames. That yields alpha
directly — independent of both the basemap and the field's value — and a halo is then simply α
falling below 1 near the shore, on any coast, with a sign that cannot flip.

## 12. ✅ THE ALPHA SOLVE — built, validated, and it isolates the halo

`frontend/scripts/alpha-solve.js`. Triangulation matting (Smith & Blinn 1996): the same foreground
over two known backgrounds, so `a = 1 - (C1-C2)/(B1-B2)` and F cancels.

⛔ **The obvious implementation is wrong here.** The literature's constraint is that the foreground
must be IDENTICAL across both captures; the tempting backdrop swap is the light/beach themes, but
`getThemedWaveColor(displayHeight, u_theme, u_surfMode)` gives the field a different palette per
theme, so F would move with B and the solve would be under-determined again. **Checked in the shader
before building.** The backdrop is therefore swapped WITHOUT the theme: the basemap water layer's
`fill-color` is forced at runtime (`water`, `water-shadow`, `ocean-mask-inland-water`), re-applied
before every capture because OceanMask re-asserts paint on a timer.

**Validation.** Background separation |B1−B2| = 161–255 of 255. Alpha lands in [0,1] throughout, so
the blend is linear in the measured space — no gamma/premultiplication failure. And **Madeira
reproduces across two independent runs to three decimals**: d0 0.100/0.099, d1 0.274/0.270,
d4 0.310/0.304, d8 0.427/0.424.

**Madeira (deep water, 24 rays, the reliable target), alpha vs device px from the shoreline:**

| d0 | d1 | d4 | d8 | d16 | d32 | d64 | d128 | d200 | d400 |
|---|---|---|---|---|---|---|---|---|---|
| **0.099** | 0.270 | 0.304 | 0.424 | 0.508 | **0.648** | 0.645 | 0.700 | 0.722 | **0.753** |

⇒ **The halo is a real alpha deficit, and it now has a shape**: a one-pixel step at the shoreline
(0.099 → 0.270), then a ramp reaching **86% of full opacity by ~32 device px**, then a slow creep to
~0.75 out at d400. The steep component — the halo the owner sees — has a characteristic width of
**~32 device px**, which matches NEITHER the regional mask texel (0.66–1.11 px) nor the coarse global
mask texel (~288 px). It is a third scale, and that is the clue the next A/B needs.

★ Every earlier metric was under-determined; this one is not, and the sign is consistent on every
coast measured.

## 13. ⚠️ TWO FAULTS IN THIS RUN, recorded so the numbers are not over-read

- **Nassau is NOT reproducible.** d0 read **0.115** in the first run and **0.706** in the second, same
  camera, same method. Nassau has now failed three separate times this session (twice painting no
  field at all). **Use Madeira.** Do not average the two Nassau runs — one of them is wrong and it is
  not known which.
- **The open-ocean control is VOID BY CONSTRUCTION** — 0 rays. It anchors on a land→water transition,
  and a no-coast target has none. The control that was supposed to prove the instrument is not
  responding to something other than coast proximity did not run. It needs a different sampling
  scheme (fixed radius, no shoreline anchor) before the profile can be called coast-specific.

## 14. ✅ ATTRIBUTED BY MODE, NOT BY LEVER — and repaired

`alpha-lever-isolated.js`: ONE page load per leg (no state carry-over), lever set via
`addInitScript` before the first frame (no flip-then-settle race), every leg REPLICATED, and a
stability gate refusing any leg whose replicates disagree by > 0.08.

⭐⭐ **The gate refused three of five levers — and the answer was not a lever at all.** Grouping the
ten isolated runs by the compositing MODE the engine actually used:

| overlayReason | runs | alpha spread |
|---|---|---|
| **`min_combine`** | 4 | 0.606 · 0.615 · 0.594 · 0.219 |
| **REPLACE** (`coverage_gap`) | 5 | 0.024 · 0.011 · 0.011 · 0.011 · 0.024 |
| `off` | 1 | 0.113 |

Shoreline alpha: **0.10 under min-combine, ~0.68 flat under REPLACE.**

⇒ **THE HALO IS `min(base, overlay)`.** The two masks are built from different coastlines — base
from the grid's coastline geojson, overlay from basemap water truth — so where they disagree `min()`
takes the UNION of both land areas and carves real water. Around an island that strip closes into a
ring. Every lever that appeared to "fix" it was only changing which mode the engine landed in, which
is why lever-grouping gave contradictory answers twice and mode-grouping is clean.

★★★ **A LEVER SWEEP CAN NAME THE WRONG THING WHEN THE LEVER'S REAL EFFECT IS TO CHANGE A REGIME.**
Group by the regime, not by the knob.

**THE FIX (shipped): `computeMidCarveReplace`** — when the mid-zoom carve engages, REPLACE instead
of min-combining. Safe *precisely here*: the historical Istria/Susak flood came from REPLACE with an
overlay that did NOT contain the viewport, and the carve already refuses to engage unless the
overlay CONTAINS the viewport and is non-degraded. The predicate restates both preconditions itself
rather than inheriting them. Kill: `__RAW_DISABLE_MIDCARVE_REPLACE__`. Telemetry gains a distinct
`midcarve_replace` reason so it is never confused with the wide-grid REPLACE.

**Tests:** `WebGLMarineEngine.midCarveReplace.test.js` — 8 cases pinning each precondition
individually, the composition with the engage gate, and fail-safe on NaN/absent opts.
**146 suites / 1564 tests pass.**

## 15. ⚠️ THE LOCAL VERIFICATION IS VOID — deployed proof still owed

Paired A/B on the new build (kill switch = before/after inside one build):

| leg | mode | alpha d0 | spread |
|---|---|---|---|
| fixed | **`midcarve_replace`** | 0.796 / 0.792 | 0.112 / 0.122 (stable) |
| fix disabled | `min_combine` | **0.780** | 0.129 |

⛔ **The disabled leg should have reproduced the halo and did not** — min-combine reads 0.780 at the
shoreline locally versus **0.10** on the dev alias. **localhost does not exhibit this defect**, so
the legs agree and the A/B proves nothing about removal.

Verified locally: the new mode is selected and reported (`ovl=midcarve_replace` in both replicates),
alpha is flat under it, nothing regressed. NOT verified: that it removes the halo. **The deployed
A/B is owed** — same harness against the alias after deploy, expecting the disabled leg near 0.6
and the fixed leg near 0.02.

## 16. ⛔⛔ THE DEPLOYED A/B PARTLY REFUTES §14 — read this before trusting the attribution

Same harness against the alias on `3a686f78`, where the defect actually reproduces. **Both legs
stable** (|rep1-rep2| = 0.043 and 0.031), so this is a trustworthy controlled comparison:

| leg | mode | alpha at shore | spread |
|---|---|---|---|
| fixed | `midcarve_replace` | 0.153 / 0.162 | 0.507 / 0.550 |
| fix disabled | `min_combine` | 0.088 / 0.097 | 0.570 / 0.601 |

**The fix is a REAL but SMALL improvement**: shoreline alpha up ~1.7x (0.09 → 0.16), spread down
~10%. It is **NOT** the flat alpha ~0.68 that §14 predicted, and the halo remains.

⛔ **WHY §14 OVER-READ ITS OWN DATA — the same error one level up.** §14 grouped runs by compositing
MODE and concluded REPLACE removes the halo. But the flat runs were all `coverage_gap` REPLACE,
which is a different **REGIME**, not merely a different min/replace choice: it fires when the base
mask does not cover the viewport, so the resident mask situation differs too. Grouping across
regimes is a correlation, not a controlled comparison. The deployed A/B IS the controlled
comparison — same regime, same masks, only min() vs replace — and it yields ~10%.

★★★ I corrected "grouping by lever" into "grouping by mode" and then made the identical mistake at
the next level. **A grouping is only causal if everything else is held fixed, and switching regime
holds nothing fixed.** The A/B was always the arbiter; the grouping was a hypothesis generator that
I promoted to a finding.

**WHAT SURVIVES.** Under REPLACE the overlay ALONE governs the coast, and alpha still ramps
0.16 → 0.66. So the residual halo is **the overlay mask's own coastal alpha**, not a disagreement
between two masks — one mask, one coastline, no union. That is the narrowest target this arc has
produced.

**DISPOSITION.** The change is KEPT, not reverted: measured improvement, no regression, principled
under its own preconditions, kill-switched. But the commit message on `7b6fc77d` claims the halo IS
min(base, overlay); **as stated that is wrong, and this corrects it.**

## 17. ✅ THE MASK PROFILE BY MODE — and why the shipped fix bought only 10%

`overlay-mask-profile.js` reads `oceanAlpha` itself via the shader's built-in
`__GPU_DEBUG__ = {mode:'mask'}` (greyscale mask value, emitted BEFORE maskFade, the height term and
the feather), recovered from two backgrounds so it is separated from every other alpha factor.

| mode | mask alpha @ shore | @ d4 | @ d128 | edge |
|---|---|---|---|---|
| `coverage_gap` | **0.911** | 0.987 | 0.987 | crisp, ~4 px |
| `min_combine` | **0.385** | 0.618 | 0.982 | soft, 32-64 px |
| **`midcarve_replace`** (shipped, 6 replicates) | **0.441** | 0.618 | 0.982 | **soft** |

⇒ **BOTH REPLACE PATHS SET THE SAME UNIFORM, YET ONE IS CRISP AND THE OTHER SOFT.** So the halo was
never min-vs-replace: the overlay texture that the midcarve path replaces WITH is itself feathered.
Overlay span 2.409 deg over a <=2048 canvas is ~2.1 device px/texel, which cannot make a 32-64 px
edge by filtering — the softness is **baked into the overlay canvas**.

★ **This closes the deployed A/B's loop.** The fix swapped `min(base, overlay)` for `overlay`, but
the overlay is soft too — which is exactly why it bought ~10% rather than the cure. The 10% is the
difference between two soft masks, not between soft and crisp.

⚠️ **MY OWN GUARD FIRED, so these absolutes carry a caveat.** The recovered `u_opacity` runs
0.85 -> 1.00 across distance in 5 of 6 replicates, and it is a UNIFORM — it must be flat. The
two-unknown decomposition is therefore not clean (most likely premultiplied blending coupling RGB
and A in the debug path). **The DIRECTION is robust** — 0.911 vs 0.441 at the shoreline is a large
separation, reproducible across independent runs and stable to ~0.01 within mode — but the absolute
alpha values must not be quoted as exact.

## 18. ➡️ THE NEXT STEP, narrowed to one diff

Same painter, two call sites, different results: `renderMaskToCanvas` + `overlayBasemapWaterOnMask`
produce a CRISP coastline in the `coverage_gap` path and a FEATHERED one in the midcarve path.
Compare those two call sites — canvas width, bounds padding, and whether the basemap-water overlay
actually applied — rather than looking for a feather in the shader, which has now been measured
three separate ways and is not the source.

⛔ Do NOT make a third shader change on inference. Seven candidate causes have died under
measurement in this arc; the pattern is that each shader-side hypothesis has been wrong.

## 19. ⭐⭐⭐ THE MASK IS NOT SOFT — IT IS DISPLACED, AND MY OWN METRIC MADE THE RAMP

Per-ray decomposition of the same mask-alpha capture (24 bearings solved individually instead of
collapsed to a mean per bucket), reproducible across replicates:

| statistic | value |
|---|---|
| median 10-90% transition width **PER RAY** | **3.5 - 4.6 device px** |
| median 50% crossing | 5.9 - 6.0 px seaward of the basemap shoreline |
| **50% crossing SPREAD across bearings** | **47.9 px** (identical in both replicates) |

⇒ **Every individual ray has a nearly HARD edge (~4 px, consistent with a 1-2 px texel plus
antialiasing). The "soft 32-64 px ramp" was AN ARTIFACT OF AVERAGING** — 24 crisp steps whose
positions scatter over ~48 px, meaned into a smooth curve.

⇒ **The mask coastline is DISPLACED from the basemap coastline by a bearing-dependent amount**, not
feathered. That is a GEOMETRY disagreement, not a rendering softness.

★★★★ **THE METHODOLOGICAL LESSON, and it invalidated seven rounds of hypotheses: A MEAN OVER
BEARINGS CONVERTS DISPLACEMENT VARIANCE INTO APPARENT SOFTNESS.** I built that average into the very
first radial harness and every later step inherited it — which is why no shader hypothesis ever
matched the measured width, why the texel arithmetic never reconciled, and why each "cause" died.
The shader was never the problem. **When a profile looks like a ramp, check whether it is a ramp per
sample or a distribution of steps.**

★ And it retroactively VINDICATES LOP-0002, which attributed the band to "generalized land geometry"
rather than to any shader term. That was right. My mean-based metric obscured it for seven rounds.

## 20. ➡️ THE FIX TARGET, now precise

Make the mask's coastline agree with the basemap's. `overlayBasemapWaterOnMask` exists for exactly
that and reports `applied`; the residual ~6 px median displacement with ~48 px bearing spread says
it is either applying at coarser fidelity than the basemap renders (simplified tiles at the queried
zoom) or applying only partially. That is where to look — NOT in the shader, which has now been
measured clean three independent ways.

⛔ Everything shader-side in this document is downstream of the averaging artifact. Re-read §19
before trusting any width or ramp figure in sections 2, 12, 14, 17.

## 21. ⛔ THE §20 FIX TARGET IS MEASURABLY NOT THE DEFECT — the geometry is faithful

`mask-geometry-vs-raster.js` compares, per ray, where the coast sits according to two oracles at the
same camera: (A) `queryRenderedFeatures([x,y])` point truth — what the basemap actually renders — and
(B) point-in-polygon against **the exact rings `overlayBasemapWaterOnMask` is handed**
(`queryRenderedFeatures({layers})`, its own class filter applied, projected in Web Mercator as
`makeMaskProjector` does).

| | |
|---|---|
| rays with BOTH a point-coast and a polygon-coast | **24 / 24** |
| polygon-coast − point-coast | **median 0 px, min 0, max 1** |
| features / polygons / skipped by the class filter | 12 / 12 / **0** |

⇒ **The geometry handed to the painter is CORRECT to within one device pixel on every bearing.** The
query is not coarse, the class filter drops nothing, and the source/source-layer resolve correctly.
**§20's target is exonerated — "fix the coastline fidelity in overlayBasemapWaterOnMask" would be
changing something already right.**

⇒ The ~6 px median displacement with ~48 px bearing spread is introduced **DOWNSTREAM of the
geometry**: either in the rasterisation into the canvas, or in the BOUNDS the finished texture is
sampled with.

★ Ninth elimination in this arc. Also note the projector was checked and is proper Web Mercator, so a
projection mismatch is out too.

## 22. ➡️ THE TARGET NOW — a texture/bounds mismatch is the leading candidate

The rings are right and the paint is a plain even-odd fill of those rings, so the most likely place
for a bearing-dependent offset is a disagreement between the bounds a mask texture was PAINTED for
and the bounds it is SAMPLED with (`u_overlayBounds` / `_overlayMaskBounds` vs the bounds passed to
`renderMaskToCanvas`). The engine's own MASK NO-SHRINK comment already names this class:
*"a tex/bounds mismatch is strictly worse than the halo"*.

**Discriminator:** measure the mask-alpha coast offset while panning INSIDE the repaint hysteresis
box (no repaint) and again immediately after a forced repaint. An offset that drifts with camera
movement and snaps back on repaint is a bounds/staleness mismatch; one that is invariant is in the
paint itself.

## 23. ⚠️ WHAT IS NOT ESTABLISHED

**Four candidate causes are now eliminated by measurement** — the mask edge (§8, direct uniform
read), the crest pass (§10, clean live A/B on three targets), and the "data is honestly smaller
near shore" reading (§6, flat values inside one 2,625 px cell). That is real progress, and none of
it is a fix.

The halo is now ISOLATED as a reproducible alpha profile (§12) but the causal TERM is still unnamed.
The shader has exactly three alpha factors — `maskFade`, the height-keyed `smoothstep`, and the
grid-edge `feather` — and the ~32 px width matches none of the mask texel scales, so the attribution
is a lever A/B, not a reading.

⛔ **No fix shipped.** With a trustworthy instrument now in hand, the remaining work is mechanical:
run the alpha solve at Madeira with each candidate lever flipped (`__RAW_DISABLE_HALO_DAMP__` first —
it is named for this and multiplies the base wash by 0.35; then `__RAW_DISABLE_BLEND_BOTH__`, which
also gates `u_heightAlphaEnabled`) and keep whichever one FLATTENS the profile. That is a decisive
attribution rather than a fifth guess, and the fix follows from whichever term owns the ramp.

## 24. ⛔ THE §23 LEVER PLAN RAN — leg 1 was VOID, leg 2 REFUTES THE LAST LIVE SHADER TERM

§23 closed with a mechanical plan: run the alpha solve with `__RAW_DISABLE_HALO_DAMP__` first, then
`__RAW_DISABLE_BLEND_BOTH__`, and keep whichever FLATTENS. Both legs ran, isolated
(one page load each, lever set before the first frame, replicated, stability-gated). **Neither
outcome was the one the plan anticipated, and the first was not a result at all.**

⚠️ **READ §19 FIRST.** This section was executed before §19/§21 landed from a concurrent session.
Its spread figures are built on the SAME mean-over-24-bearings that §19 shows converts displacement
variance into apparent softness, so **no "ramp" number below should be read as a ramp**. What
survives that critique is stated explicitly in §24e — the eliminations here are readings and
engagement facts, not ramp measurements.

### 24a. ⛔ `__RAW_DISABLE_HALO_DAMP__` IS VOID BY CONSTRUCTION — the lever cannot fire here

`frontend/scripts/alpha-lever-halodamp.js`, Madeira z9.30, beach, 2 legs × 2 replicates. Identical
telemetry in **all four** legs, captured with the field painting (not after `setWaves(false)`, which
is when the parent harness read it):

| signal | value | reading |
|---|---|---|
| `leverSeen` (off legs) | **true** | the flag did reach the page — not a plumbing failure |
| `haloDamp` (stock) | **false** | the damp never fired; there was nothing to disable |
| `washPreDamp` / `washEff` | **0.21 / 0.21** | arithmetic proof no ×0.35 applied (would be 0.074) |
| `baseMaskDense` | **true** | ← the cause |
| `washNoTruthDamp` | **false** | the ISLAND damp is inactive too |

⇒ `baseMaskDense` sets `_washSole`, and `WebGLMarineEngine.js:1237` requires `!_washSole`. **The
DENSE-BASE WASH UN-DAMP exemption (2026-07-16) structurally disarms the halo damp at this camera.**
The lever was inert before it was ever flipped. Spreads confirm a no-op: stock 0.515 / 0.538,
off 0.554 / 0.538 — both stable, indistinguishable.

⭐⭐⭐ **THIS IS WHY THE HARNESS GAINED AN ENGAGEMENT GATE. A lever that CANNOT FIRE reads exactly
like a term that is INNOCENT.** Without `haloDamp` in the capture this run reports "0% flatter ⇒ the
damp does not own the ramp" and books a fifth false elimination. The run is **VOID BY CONSTRUCTION,
not negative** — the halo damp is neither implicated nor cleared, it is untested.

★ **Free corollary, no run needed:** `washNoTruthDamp=false` and `washEff==washPreDamp` in every leg
⇒ **`__RAW_DISABLE_ISLAND_HALO_DAMP__` is void at this camera too**, by the same exemption. Both
0.35 damps are structurally off at Madeira z9.3. Neither is worth a leg.

### 24b. ✅ THE UNIFORM READ — three terms eliminated without flipping anything

`frontend/scripts/uniform-read.js` reads the live `heatmapProgram` uniforms off
`map.painter.context.gl`. **Positive control:** `u_maskEdgeSharp` read from GL == `engine._maskEdgeSharp`
== 1, and two reads across separate repaints agree — a GL uniform returns whatever was last set, so
a program that did not draw returns a stale value that looks perfectly valid. The probe REFUSES
rather than reports if the control fails.

```
u_opacity 0.763   u_maskEdgeSharp 1   u_coastSDFEnabled 0   u_overlaySDFEnabled 0
u_heightAlphaEnabled 1  (lo 0.05, hi 1.4)     u_edgeFeatherEnabled 1  (width 0.18)
u_surfMode 0   u_ribbonRadiusDeg 0            u_overlayMaskEnabled 1  u_overlayReplace 1
```

- **Band ribbon — ELIMINATED BY READING.** `u_ribbonRadiusDeg=0`, `u_surfMode=0`: the band path
  (line 471) is not rendering here. Worth checking, because that path carries its own alpha chain
  with a far SOFTER coastal `smoothstep(0.05,0.45,oceanAlpha)` than the main path's crisp (0.45,0.6).
- **Grid-edge feather — ELIMINATED BY GEOMETRY, despite being ENABLED.** Madeira sits at grid_uv
  (0.540, 0.370) in the 2.000° data grid, so `minEdgeDist = 0.370` against width 0.18. A 128
  device-px ray moves uv by only 0.071 ⇒ worst case 0.299, still past the ramp. `smoothstep(0, 0.18,
  ≥0.299) = 1.0` across the **entire** sampled range: live but CONSTANT, so it cannot make a gradient.
- **Coast SDF — CONFIRMED 0/0** from the shader's own uniforms, independently of the engine-side
  flags §5 quoted.
- **Texel arithmetic.** Resident base mask 4096×2048 over exactly 2.000° ⇒ 4.883e-4 deg/texel =
  **0.44 DEVICE PX per texel** at z9.3/dpr2. A bilinear edge ramps over ~1 texel.
  ⚠️ The overlay has no dims property on the engine (it is uploaded straight from a canvas), so its
  figure is **bounded from source, not measured**: `renderMaskToCanvas(geo, bounds, {maxWidth: 2048})`
  (`WebGLMarineEngine.js:2616`) over its 2.409° span ⇒ **≥1.05 device px/texel**.

### 24c. ⛔ THE HEIGHT-KEYED SMOOTHSTEP IS REFUTED AS THE OWNER

`u_heightAlphaEnabled` read **1**, so the term is live and had to be tested — but NOT with
`__RAW_DISABLE_BLEND_BOTH__`, which §5 already showed deletes the whole field (a lever that deletes
the subject cannot test a property of it). `__RAW_BLEND_HEIGHT_LO__/HI` are re-read from `window`
every frame (`WebGLMarineEngine.js:1665-1667`), so **LO=-1, HI=0 forces `smoothstep` to exactly 1
for every h≥0 while the composite keeps painting.** Surgical, and the subject survives.

| leg | d0 | d128 | spread | mean alpha |
|---|---|---|---|---|
| stock | 0.160 / 0.153 | 0.725 / 0.682 | 0.565 / 0.529 | 0.443 / 0.431 |
| identity | 0.178 / 0.178 | 0.813 / 0.804 | 0.635 / 0.626 | **0.528 / 0.527** |

Four gates all passed: **(1)** the lever reached the SHADER — `u_heightAlphaLo/Hi` read back off the
live program as **-1/0** in the treated legs vs 0.05/1.4 in stock (not merely "the window global is
set"); **(2)** `u_heightAlphaEnabled=1` in every leg; **(3)** subject not deleted — mean alpha rose,
it did not collapse; **(4)** no compound movement, `u_maskEdgeSharp` and `u_overlayReplace` identical
across legs.

⇒ Removing the term **lifted alpha everywhere** (mean 0.43 → 0.53, exactly as a <1 multiplier should)
and left the profile **STEEPER, not flatter** (0.547 → 0.631, −15%). **REFUTED as the owner.** It
scales alpha; it does not create the shore-to-offshore profile.

### 24d. ⚠️ TWO CORRECTIONS TO §23

- §23 says *"The shader has exactly three alpha factors"*. That is true only of the MAIN path. The
  BAND path (471-500) has its own chain — `presence`, `vividness`, `smoothstep(0.05,0.45,oceanAlpha)`,
  the ribbon, and the inland gate. It is not rendering here (24b), but the count as written is wrong,
  and the band path's coastal smoothstep is the softer of the two.
- §23's recommended first lever is **retired** by 24a, and its second (`__RAW_DISABLE_BLEND_BOTH__`)
  should be replaced by the LO/HI identity of 24c, which tests the same term without deleting the field.

### 24e. ⇒ WHAT THIS ADDS ONCE §19 IS APPLIED

§19 shows the ramp these harnesses measure is an artifact of averaging 24 bearings whose crisp edges
scatter over ~48 px. **My harnesses inherit that construction verbatim** (`mean(buckets[d])` per
distance bucket), so 24a's and 24c's *spread* numbers are the same artifact and must not be quoted as
widths. What survives, because none of it depends on the profile's shape:

1. The halo damp and the island damp are **structurally inert** at this camera (engagement telemetry).
2. The band ribbon, coast SDF, and the grid-edge feather are **off or constant** (direct reads + geometry).
3. The height-keyed smoothstep is **refuted as the owner** — it is a multiplier, and forcing it to
   identity did not flatten anything.
4. ★ The base-mask texel is **0.44 device px** — which is *independent corroboration of §19* from a
   different instrument: a mask edge that sharp cannot be soft, and §19's per-ray 3.5-4.6 px width is
   what a ~1 texel edge plus antialiasing looks like. Two instruments, same conclusion.

⇒ **Every alpha term in the shader is now either off, constant, or refuted.** Combined with §19 and
§21 this closes the shader as a source, and leaves §22's texture/bounds mismatch standing alone.

### 24f. ⛔ ONE §22 SUB-HYPOTHESIS KILLED BY READING, before it cost a run

A degree-vs-Mercator mismatch between the painted canvas and the sampled texture would produce
exactly the latitude-dependent (hence bearing-dependent) offset §19 measured. **It is refuted:** the
shader samples the overlay through `latToMercatorY(u_overlayBounds_*)`
(`WebGLMarineShaders.js:382-384`), matching the proper Web Mercator `makeMaskProjector` §21 verified.
Both ends are in Mercator, so canvas dimensions affect RESOLUTION only, not geometry. §22's remaining
candidates are rasterisation fidelity and bounds STALENESS — its pan-inside-the-hysteresis-box
discriminator is untouched by this and remains the right next test.

**Artifacts:** `frontend/scripts/{alpha-lever-halodamp,uniform-read,alpha-lever-heightalpha}.js`,
outputs in the matching `*-out/` dirs (untracked). Nothing shipped, no code changed, no lever left set.

## 25. ✅ THE SAMPLING CHAIN IS CONSISTENT END TO END — §22's bounds/projection branch closes

§22 named two candidates for the displacement §19 measured: the RASTERISATION into the canvas, or a
disagreement between the bounds a texture was PAINTED for and the bounds it is SAMPLED with. The
second is settled **by reading**, which is cheaper than a run and does not risk another void leg.
Four links, each verified in source at HEAD:

| link | what it does | source |
|---|---|---|
| projector **x** | `(lng − wrappedWest) / span × width` — linear in longitude | `marineMaskProjection.js:141` |
| projector **y** | Web Mercator; `mercMinY = latToMercatorY(north)` ⇒ **north at canvas y=0** | `marineMaskProjection.js:133-141` |
| upload | `UNPACK_FLIP_Y_WEBGL = true` ⇒ texture **v=0 becomes the canvas BOTTOM row = south** | `WebGLMarineEngine.js:2676` |
| shader | `o_u` linear in longitude; `o_v = (oMercMaxY − v_mercator_xy.y)/…` ⇒ **v=0 at south** | `WebGLMarineShaders.js:382-385` |

⇒ **Both axes are normalised identically at both ends, and the vertical flip cancels exactly.** A
projection mismatch, an axis-normalisation mismatch, and an orientation flip are all out. With §21
(the rings are correct to within 1 device px on every bearing) and §24f (both ends are Mercator, so
canvas dimensions affect RESOLUTION only), **the geometry pipeline is verified from GeoJSON ring to
sampled texel.**

⚠️ **Verified by READING, not by execution.** That is the appropriate instrument for a question about
which formula is used — but it cannot see a stale *value* flowing through a correct formula, which is
exactly what bounds STALENESS would be. That half stays open until §26's derivative measures it.

### 25a. ⚠️ ONE STRUCTURAL ODDITY, recorded because it predicts SPREAD and not MEDIAN

`renderMaskToCanvas` hardcodes **`const height = width / 2`** (`WebGLMarineMaskRenderer.js:531`), so
the overlay canvas is always 2:1 — 2048×1024 — regardless of the box's real aspect. Madeira's overlay
box is **2.409° × 1.501°**, nothing like 2:1.

This is **not a geometry error**: the projector and the shader both normalise to the full span on each
axis independently, so the non-uniform scale is applied consistently at both ends and cancels. What it
costs is **resolution asymmetry** — 1.18e-3 deg/px horizontally against 1.47e-3 deg/px vertically, so
the mask is ~25% coarser north-south than east-west.

★ Why that is worth writing down anyway: §19's signal is **bearing-dependent** (47.9 px spread around a
~6 px median). A resolution that differs by axis produces an edge whose quantisation differs by
bearing — a plausible contributor to the SPREAD, while explaining none of the MEDIAN. ⛔ Do not
"fix" the aspect on this reasoning alone: it is a hypothesis about a second-order term, the median is
the defect, and this arc's record on unmeasured shader-side inferences is 0 for 9.

### 25b. ➡️ WHAT IS STILL LIVE

Of §22's two branches, bounds/projection is closed and **rasterisation fidelity** stands alone —
together with the one thing reading cannot settle, bounds STALENESS (a correct formula fed a stale
value). §26 measures both as derivatives rather than as a before/after.

## 26. ⭐⭐⭐ THE ISLAND RE-ASSERT IS A SECOND UNION — AND IT IS BAKED INTO THE TEXTURE

> ⚠️⚠️ **READ FIRST — §§26-27 ARE AN INDEPENDENT REPLICATION, NOT A DISCOVERY.** A concurrent session
> had already attributed this and **SHIPPED THE FIX** before this work began: `050f19b3` *"the island
> halo is the NE island re-assert — gate 1200 → 400"*, verified deployed in `6022f4cf`, written up in
> `ISLAND-HALO-REASSERT-FIX-2026-08-17.md`. It is in HEAD (`04e7c3ec`);
> `ISLAND_REASSERT_MAX_DENSITY = 400` today. I did not connect those commits (they were in my
> session-start snapshot) and re-derived the cause from source. **Value kept:** the attribution now
> rests on two independent measurement routes reaching the same answer, which is genuine
> corroboration — but nothing here is new, and §27c's proposed fix is SUPERSEDED (see the correction
> in §27c).
> ⚠️ **All numbers in §§26-27 were measured against the DEPLOYED build while it still had gate 1200**
> (my stock legs read `applied=true` at 850 px/°, which the shipped 400 gate now makes `false`). They
> describe PRE-FIX behaviour.

⚠️ **HYPOTHESIS FROM READING, NOT YET MEASURED.** This arc's record on unmeasured shader-side
inference is 0 for 9, so this is written as a candidate with its own kill switch and its own
predictions, and the A/B is §27. What raises it above the previous nine is that it predicts the
**SIGN**, the **bearing-dependence**, the **island salience**, and the **zoom self-limit**
simultaneously — and it sits in §22's one surviving branch, the rasterisation.

**THE MECHANISM.** `overlayBasemapWaterOnMask` step **3c**, the ISLAND RE-ASSERT
(`WebGLMarineMaskRenderer.js:280-296`), takes a pristine full-resolution copy of the
**Natural Earth 10m** mask canvas and composites it back over the basemap-patched canvas with

```js
ctx.globalCompositeOperation = 'multiply';        // reassertNeLand, :85-87
ctx.imageSmoothingEnabled = false;
ctx.drawImage(neFull, 0, 0, canvas.width, canvas.height);
```

Land is black (0), water white (255), so **multiply keeps land wherever EITHER source calls it
land.** The finished overlay mask is therefore the **UNION OF TWO LAND SETS — Natural Earth 10m and
the basemap's own water polygons.**

★★★★ **THAT IS THE SAME UNION `7b6fc77d` ATTRIBUTED TO `min(base, overlay)`, AT A DIFFERENT LAYER.**
The commit reasoned that two masks built from different coastlines take the union of both land areas
wherever they disagree — correct as a mechanism, wrong about where it happens. The deployed A/B (§16)
measured the shader-side min() at only ~10% because the *real* union is applied inside the overlay
canvas, on the CPU, **before the GPU ever samples it**. That also explains why every shader-side
hypothesis died: the displacement is already in the texture.

**IT IS ACTIVE AT MADEIRA — the gate is arithmetic, not a guess.** `neFull` is captured only when
`canvas.width / lonSpan < __RAW_ISLAND_REASSERT_MAX_DENSITY__` (default **1200** px/°,
`WebGLMarineMaskRenderer.js:305-310`). The overlay canvas is capped at **2048** px wide over a
**2.409°** span ⇒ **850 px/° < 1200 ⇒ THE RE-ASSERT ENGAGES.**

**FOUR PREDICTIONS, all matching what is already measured:**

| prediction | why | observed |
|---|---|---|
| the displacement is **SEAWARD** | multiply can only ADD land, never remove it | §19: median **+5.9-6.0 px seaward** ✅ |
| it is **bearing-dependent** | NE-10m generalisation error varies around a coastline | §19: **47.9 px spread** ✅ |
| worst on **ISLANDS** | it is literally the island re-assert; small islands are where NE 10m generalises hardest | owner: *"more visible on the islands"* ✅ |
| it **self-disables at deep zoom** | the ≥1200 px/° gate | the midcarve block's "z≥12 is already sub-pixel-clean" ✅ |

⇒ It also explains why §21 found the rings **correct to 1 px**: they are. The basemap water is
painted faithfully — and then step 3c paints Natural Earth land back on top of it.

**KILL SWITCH + TELEMETRY (both already exist):** `__RAW_DISABLE_ISLAND_REASSERT__` and
`__RAW_GPU__.islandReassert = { applied, mode, densityPxDeg }`. ⛔ **Gate the A/B on
`islandReassert.applied`** — §24a is the standing lesson that a lever which cannot fire reads exactly
like a term that is innocent.

⛔ **DO NOT SHIP A FIX ON THIS SECTION.** The re-assert exists for a reason (the Venice/Andros
regressions: basemap parent tiles simplify small islands away, and painting them white floods the
island). Disabling it wholesale would re-open those. If §27 confirms the attribution, the fix is a
question of **which source wins in the disputed strip at which resolution**, not of deleting the pass.

## 27. ✅✅ CONFIRMED — THE ISLAND RE-ASSERT OWNS THE DISPLACEMENT, BY TWO INDEPENDENT ROUTES

`frontend/scripts/island-reassert-ab.js`, Madeira z9.30, beach, 4 legs × 2 replicates, one page load
each, lever set before the first frame. **All three controls pass**: engagement matches expectation
on all 8 legs, the gate relation `applied == (density < threshold)` holds on every leg, and every
leg yielded **24/24 rays**.

**Metric:** `a0` = field alpha AT the basemap shoreline, per ray, normalised as `G(0)/G_far`. Never
meaned across bearings (§19). Over forced-red water G is exactly 0 without field and rises with it.

| state | route | mechanism | reason | a0 (mean of reps) |
|---|---|---|---|---|
| ON | `stock` | threshold 1200 (default) | `multiply` | **0.509** |
| ON | `dens_high` | threshold 5000 ⇒ gate open | `multiply` | **0.509** |
| OFF | `off_flag` | boolean kill switch | `disabled` | **0.901** |
| OFF | `dens_low` | threshold 400 ⇒ gate closed | `fine_basemap` | **0.893** |

**Two ON routes agree to 0.000. Two OFF routes agree to 0.008. Separation 0.388** — ~48× the
within-state scatter. Two mechanisms sharing no code path beyond the pass itself (one bypasses the
gate, the other closes it) land on the same state, which is what separates *"the re-assert causes
this"* from *"setting a global perturbed the paint"*. `dens_high` sets a `__RAW_ISLAND_REASSERT_*`
global and lands **exactly** on stock, so the act of setting one is not the cause.

⇒ **`reassertNeLand`'s `multiply` — the CPU-side union of Natural Earth 10m land with the basemap's
water — suppresses the marine field seaward of the true coastline.** §26's mechanism is confirmed.

### 27a. ⭐⭐⭐ THE PER-BEARING DECOMPOSITION — it is a SECTOR, and it is NOT the whole halo

Same bearing, stock → off_flag (a0):

```
 0: 0.00->0.93   1: 0.51->0.99   2: 0.05->0.90   3: 0.05->0.88   4: 0.18->0.78
 5: 0.05->0.87   6: 0.00->0.80  20: 0.00->0.97          <-- CHANGED (8 bearings)
 7,8,9,10,11,12,13,14,15,16,17,18,19,21,22,23           <-- IDENTICAL to 2 d.p. (16 bearings)
```

⇒ **The re-assert moves exactly 8 of 24 bearings — a contiguous arc — and leaves the other 16
byte-identical.** A localised sector is a far stronger causal signature than a shift in a median: a
global change to edge softness or alpha would move every bearing a little, not eight bearings
completely and sixteen not at all.

⛔ **AND IT IS NOT THE WHOLE DEFECT.** Suppressed fraction (`a0 < 0.5`) over all 48 rays per state:

| | suppressed fraction | mean a0 | crossings > 2 px |
|---|---|---|---|
| ON (stock, dens_high) | **0.500** | 0.594 | **0.333** |
| OFF (off_flag, dens_low) | **0.208** | 0.847 | **0.000** |

- The re-assert accounts for **0.292 of the 0.500** suppressed fraction — call it ~58% of the
  suppression — and **100% of the displacement**: every crossing beyond 2 px disappears with it off.
- **~21% of bearings stay suppressed with the re-assert fully disabled** (bearings 9, 12, 13, 14, 15
  sit at a0 ≈ 0.05-0.10 in BOTH states). Those are suppressed in AMPLITUDE without being DISPLACED —
  a different signature, and this pass does not explain them.

⚠️ **HYPOTHESIS, NOT MEASURED:** bearings 9-15 are the S/SW-facing arc. Under a NW swell that is the
sheltered side, so a genuinely smaller nearshore height there would be **correct physics, not a
halo**. ⛔ Do not treat the residual as a defect until that is tested — the obvious test is whether
the residual arc rotates with swell direction.

> ⛔⛔ **REFUTED 2026-08-17 BY §28. THE ARC DOES NOT ROTATE.** Swell turned **35°** and the arc centre
> moved **0.0°** (201.8° → 201.8°, same 10 suppressed bearings) at 7.5° resolution. The sheltering
> reading above is **wrong**, and so is the empty-cell alternative — see §28. Do not re-propose either.

### 27b. ⚠️ TWO CORRECTIONS TO §26, AND ONE TO THIS RUN'S OWN OUTPUT

- **§26 states 850 px/° as a computed constant. It is not a constant.** `densityPxDeg` is
  `canvas.width / lonSpan` where the padded bounds follow the viewport at paint time; an earlier
  session measured **690 and 850 in two replicates of the same leg**. All 8 legs here read 850, so
  the conclusion is unaffected (690 and 850 are both far below the 1200 gate, so the pass engages
  either way) — but the first version of this A/B used thresholds 900/800 to "straddle 850" and that
  design was invalid, because at 690 a threshold of 800 leaves the pass ON. The gate route was moved
  to 400/5000, outside the observed range in both directions.
- **The script's own CONFIRMED line says "the gate flips exactly where it crosses 850".** That
  sentence is stale from the discarded design; the gate legs are 400 and 5000 and nothing in this run
  straddles 850. The verdict stands, the sentence overclaims.
- ⭐ **INSTRUMENT LESSON — the channel was chosen from an assumption and it silently inverted the
  test.** The first metric keyed on R, on the reasoning that "the field is dark so it lowers R over
  red". In BEACH theme the field is WARM: far-field R reads 245-247, so the depth gate rejected
  **20 of 24 rays** — precisely the ones where the field was strongest. `ray-profile-diag.js` printed
  the actual pixels and the fix was immediate: over a forced primary, **key on a channel the backdrop
  ZEROES** (G and B are exactly 0 over #ff0000). ★ A colour assumption is a hidden THEME dependency.

### 27c. ⛔ NO FIX SHIPPED — the pass is load-bearing

`94072098` (2026-07-07) introduced the re-assert and its message is explicit: *"z5 halo 65%→6.4%:
overlay coverage-REPLACE … **SAFE only with the re-assert keeping islands masked**"*, and it took the
z9 cay/coastal flood from 8-17% to **0.3%**. Deleting the pass reopens both. Note also that
`reassertNeLand` has **no test coverage** — `reassertNeLand` / `ISLAND_REASSERT` / `islandReassert`
appear in no `*.test.js` in `frontend/src`.

⛔⛔ **THE PROPOSAL BELOW IS SUPERSEDED — DO NOT IMPLEMENT IT.** `050f19b3` already shipped a better
fix: **lower the gate 1200 → 400**. Its insight is the one I missed — *the gate was comparing the
wrong pair.* It asked whether the MASK texel is coarser than NE; what actually decides whether NE
helps is whether the **BASEMAP** is coarser than NE. That separates the regimes cleanly (world mask
~11 px/° on · Abaco z9 205 on · **viewport overlay ~850 OFF** · dense regional ~1720 off), so the
Abaco flood protection is kept by KEEPING the pass where the basemap is coarse, rather than by
eroding geometry everywhere. Simpler, and pinned by 10 tests using the two real measured densities.
Kept below only as a record of what was proposed before that was known.

➡️ ~~**PROPOSED SHAPE (owner decision, not a change): ERODE THE NE LAND BEFORE THE MULTIPLY.**~~ A
missing island's *core* still gets re-asserted, so the flood stays fixed; but at a coastline where
both sources roughly agree, eroded NE land falls INSIDE the basemap land, the multiply becomes a
no-op there, and the basemap's better-positioned coastline wins. An erosion radius near the measured
displacement targets exactly the defect. The machinery exists — `writeCoastDistanceField`
(`WebGLMarineEngine.js:2665`) and `applyInlandWaterGuard`, which already runs a ~10 km distance
operation against the NE snapshot. ⚠️ Any paint correction that ships must be appended to
`LAYER_ORDER_PROOF_LOG.json` (owner mandate).

**Artifacts:** `frontend/scripts/{island-reassert-ab,ray-profile-diag,mask-offset-jacobian}.js`,
outputs in the matching `*-out/` dirs (untracked). Nothing shipped, no code changed, no lever left set.

## 28. ⛔⛔ THE RESIDUAL ARC IS NEITHER SHELTERING NOR EMPTY CELLS — both refuted, one by SIGN

`frontend/scripts/residual-arc-cause.js`, Madeira z9.30, beach, **island re-assert DISABLED
throughout** (so §27's confirmed cause is removed and only the residual is in play), **48 bearings**
(7.5° bins), 48/48 rays at both steps.

### 28a. ⛔ (A) SHELTERING — REFUTED. The arc does not rotate.

| | day +0 | day +4 |
|---|---|---|
| swell (N cell / E cell) | 201° / 198° | **166° / 183°** |
| **arc centre** | 201.8° | **201.8°** |
| suppressed bearings | 10 | **10** |

⇒ **The swell turned 35°; the arc moved 0.0°** — same centre, same count, at a resolution where 35°
is ~5 bins. The residual is invariant under swell direction. It is not a lee shadow.

★★★ **AND THE DAY-0 ALIGNMENT WAS A COINCIDENCE, WHICH IS WHY ONE TIME-STEP IS NOT A TEST.** At day 0
the arc sat at 201.8° while the swell vector pointed 201° — a near-perfect match that looks exactly
like a shadow on the down-wave side, and it briefly moved me toward (A). One rotation step destroyed
it. ⭐ **An alignment at a single value of the driver is not evidence; only the DERIVATIVE is.**

### 28b. ⛔ (B) EMPTY GRID CELLS — REFUTED BY SIGN

The resident grid is 8×8 (64 cells) and **3** are empty; the island's own centre cell IS empty
(`centreCellEmpty=true`). But per bearing:

| | mean empty-cell count |
|---|---|
| SUPPRESSED bearings (n=10) | **0.5** |
| NORMAL bearings (n=38) | **2.92** |

⇒ Suppressed bearings have **~6× FEWER** empty cells — the **opposite** of what
interpolation-toward-empty predicts. ⭐ **A mechanism predicting the wrong SIGN is refuted, not
partial** ([[the-band-and-the-glyph-are-two-populations-2026-08-09]]).
⚠️ The harness printed `INCONCLUSIVE` on Pearson r=+0.293; its thresholds were tuned for correlation
STRENGTH and are blind to an inverted effect. **The group means are the finding, not r.**

★ This also closes a claim I had to retract mid-session: an earlier reading "the island's cells are
all null/zero" came from a broken `cell[0]/cell[1]` accessor that returned null for EVERY cell, land
or water (the real shape is `{u, v, speed, lat, lng}`, GridParserWorker.js:72-86). Measured properly,
the centre cell IS empty — but at 3 of 64 cells, and concentrated where suppression is NOT, the
footprint cannot carry the effect.

### 28bis. ✅ HOW THIS RECONCILES WITH THE SHIPPED FIX'S §5 — two DIFFERENT residuals, not a conflict

`ISLAND-HALO-REASSERT-FIX-2026-08-17.md` §5 records its own leftover: *"Bearing 255° @ 28 px is
UNCHANGED in all three legs (32.69350, −17.12638). A separate, smaller residual with a different
cause. One bearing of 24."* That is **not the same residual measured here**, and the two are
complementary rather than contradictory:

| | shipped-fix §5 | §28 (this section) |
|---|---|---|
| quantity | **displacement** (px offset of the coast edge) | **amplitude** (field alpha at the shoreline) |
| extent | 1 bearing of 24 | 10 bearings of 48 |
| displaced? | yes, 28 px | **no** — `offset > 2 px` = 0.000 |

⇒ §27a already separated these: the re-assert owned **100% of crossings > 2 px** but only ~58% of the
suppression. So §5's 255° residual is the leftover DISPLACEMENT defect, and §28's arc is the leftover
AMPLITUDE defect. **Both survive the shipped gate change, and they are different failures.** §28's
contribution is to refute the two obvious explanations for the amplitude one.

⚠️ Because the shipped gate is now 400 and Madeira's overlay runs at 850, **§28's legs (re-assert
disabled) correspond to TODAY'S SHIPPED BEHAVIOUR** — so this residual is what a user sees on the
fixed build, not a pre-fix artifact.

### 28c. ➡️ WHAT THE RESIDUAL MUST BE

It is **fixed in geography**: invariant under a 35° swell rotation, unchanged by disabling the
re-assert, uncorrelated (inversely correlated) with empty cells, and — from §27a — suppressed in
AMPLITUDE while **not displaced** (`offset > 2 px` = 0.000 with the re-assert off). Already excluded:
the shader's every alpha term (§24), the mask edge (§19), the ring geometry (§21), the sampling chain
(§25), the re-assert (§27), sheltering and empty cells (here).

⚠️ **NOT A NEW HYPOTHESIS, AN OBSERVATION:** `a0` is measured at the FIRST SUSTAINED BASEMAP WATER
along each ray. On a convoluted coast that point can be inside a bay or shoreward of an offshore
rock, where the field may be legitimately masked or the ray may re-enter land. Before hunting a
render cause, the honest next step is to check **whether the 10 suppressed bearings share a coastline
FORM** (bays/inlets vs open headland) — i.e. whether the metric's own coast-detection is picking
different kinds of place, not whether the renderer is failing there. ⛔ Nine causes in this arc died
because a render explanation was preferred to an instrument one.

**Driver note for anyone re-running:** `swell-range-probe.js` reported `GO: 75.6 deg` of available
rotation and that figure is WRONG — it circular-averaged four probes, two of which read ~180° apart,
so the "range" was an artifact of averaging opposed vectors. The real leverage on the stable N/E
cells is **~19-35°**. Read the per-probe values, never the aggregate.

## 29. ⛔⛔ THE MARINE FIELD IS BLANK AT MADEIRA ON THE CURRENTLY DEPLOYED BUILD — the gate change is EXONERATED

✅ **RESOLVED: THE SHIPPED `1200 → 400` GATE CHANGE DID NOT CAUSE THIS.** The field is blank under
**both** gates, with the lever provably taking effect. The blank is real and reproducible; its cause
is environmental, not `050f19b3`. Full result in §29c.

### 29a. THE OBSERVATION

`frontend/scripts/reassert-gate-blank-ab.js`, Madeira z9.30, beach, deployed build **`7f2c6f22`**:

| leg | reassert.applied | dens | regime | water pts | fieldFrac | maxG |
|---|---|---|---|---|---|---|
| shipped gate (400) rep1 | false | 850 | `midcarve_replace` | 51 | **0** | **0** |
| shipped gate (400) rep2 | false | 850 | `midcarve_replace` | 51 | **0** | **0** |
| shipped gate (400) rep3 | false | 850 | `midcarve_replace` | 51 | **0** | **0** |

⇒ **The marine field is entirely absent** — 51 basemap-confirmed water points per replicate, zero
green on every one, before AND after a camera nudge, three replicates with zero variance. This is not
a coast-detection artifact and not a sampling artifact: the metric samples a viewport grid and asks
only "is the field painting".

**The contrast that makes it notable:** earlier the same day, at the same camera with the same flags,
`residual-arc-cause.js` returned **48/48 rays** twice and `island-reassert-ab.js` returned **24/24**
on all eight legs. Those ran against the PRE-fix deployed bundle.

### 29b. ⚠️ THE DEPLOYED BUILD CHANGED MID-SESSION — and it invalidates cross-run comparison

`curl .../service-worker.js` → `BUILD_VERSION = '7f2c6f22'` — *"verify(marine): the Abaco flooding
protection SURVIVES the gate change"*, which **contains** `050f19b3` (gate 1200 → 400).

That resolves an apparent contradiction in this document: §27's stock legs reported
`applied=true, reason=multiply, dens=850`, which is only possible under the **old 1200 gate**. So
**§§26-28 were measured against the PRE-fix bundle** and anything measured now is against the
POST-fix one. The concurrent session pushed and each push redeploys.

⛔ **CORRECTION TO §28bis:** it states §28's re-assert-disabled legs "correspond to TODAY'S SHIPPED
BEHAVIOUR". Directionally that is still true (the re-assert is off either way), but they were measured
on a **different bundle**, and this section shows the two bundles do not render the same thing at this
camera. Treat §28's numbers as pre-fix-bundle measurements.

★★★ **THE CLASS: a deployed target can change UNDER a measurement campaign.** Every run in
§§26-28 was implicitly assumed to be against one build. Date the build (`BUILD_VERSION` in the service
worker) at the START of each run, not once at the start of the session.

### 29c. ✅ THE DISCRIMINATOR RAN — blank under BOTH gates, so the gate is NOT the cause

One lever on the current build: `__RAW_ISLAND_REASSERT_MAX_DENSITY__ = 1200` restores the pre-fix gate
at 850 px/°. Identical nudge sequence in both legs.

| leg | `islandReassert.applied` | dens | water pts | fieldFrac | maxG |
|---|---|---|---|---|---|
| gate 400 (shipped) ×3 | **false** | 850 | 51 | **0** | **0** |
| gate 1200 (pre-fix) ×3 | **true** | 850 | 51 | **0** | **0** |

<sub>All six legs identical at zero variance.</sub>

⛔ **Control 1 PASSED, which is what makes this a negative rather than a void:** `applied` reads
`false` under 400 and `true` under 1200 at the same measured density, so the lever demonstrably
reached the code. Restoring the pre-fix gate **re-enabled the re-assert and the field stayed blank.**

⇒ ✅ **`050f19b3` IS EXONERATED.** The blank is environmental — consistent with the fresh-deploy cache
purge (`BUILD_VERSION` bumps auto-purge) or the known coverage-arrival race
([[the-marine-blank-is-a-coverage-arrival-race-2026-08-15]]), and consistent with its intermittency
all session (`residual-coast-form.js` refused four times, across two different regimes).

★★★ **WHY THIS TEST EXISTED AT ALL.** The circumstantial case against the gate change was strong:
a just-shipped change, deployed mid-session, touching exactly the density where the blank appears,
under a commit (`94072098`) that explicitly warns coverage-REPLACE is *"SAFE only with the re-assert
keeping islands masked"* — and a before/after that lines up perfectly (pre-fix bundle: 48/48 rays;
post-fix bundle: 0/51 water points). **All of that was true and the conclusion would have been
wrong.** One lever separated correlation from cause and stopped a false regression report against a
colleague's deployed commit. ⭐ **When the suspect is someone else's shipped change, the A/B is owed
BEFORE the accusation, not after.**

⚠️ **STILL OPEN, and it is now the blocking item for this camera:** the field genuinely does not paint
at Madeira z9.30 on build `7f2c6f22` — 51 water points, zero field, six consecutive page loads. Until
that clears, **no further residual measurement at this camera is possible** (§28's follow-up is
blocked on it, not abandoned). Next step is to establish whether the blank is camera-specific or
global on this build — the same coverage metric at a mainland camera would tell in one run.

### 29d. ⛔ A FALSE INFERENCE I MADE AND RETRACTED, recorded so it is not repeated

Midway I concluded *"in the `coverage_gap` regime the field does not paint at this camera"*, from
three runs where regime and outcome lined up (`coverage_gap` → blank, `midcarve_replace` → 48/48).
**Refuted by the next run:** blank field with `waterPoints=6` in **`midcarve_replace`**. The regime
instability is real — the overlay regime flips between page loads at an identical camera — but the
causal link I attached to it was not. ★ Three co-occurrences are not a mechanism.

## 7. Session hygiene

Nothing shipped, no lever left set, no code changed. Harnesses are untracked. Three of my own
instrument faults were caught and are recorded here rather than hidden: the 20-sample floor that
voided every island (§1), a freshness signal that counted `[rating-band]` breadcrumbs while Surf
Rating was OFF so it read `false` at every stop and proved nothing, and a Nassau `ON` leg that
painted no field at all — which would have read as "the kill switch changed nothing" had the
ON-vs-OFF validity check not caught that the comparison did not exist.
