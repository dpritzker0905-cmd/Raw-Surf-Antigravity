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

## 16. ⚠️ WHAT IS NOT ESTABLISHED

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

## 7. Session hygiene

Nothing shipped, no lever left set, no code changed. Harnesses are untracked. Three of my own
instrument faults were caught and are recorded here rather than hidden: the 20-sample floor that
voided every island (§1), a freshness signal that counted `[rating-band]` breadcrumbs while Surf
Rating was OFF so it read `false` at every stop and proved nothing, and a Nassau `ON` leg that
painted no field at all — which would have read as "the kill switch changed nothing" had the
ON-vs-OFF validity check not caught that the comparison did not exist.
