# Coastline below z8, and the rating band — measured on the dev alias

> ## ⛔⛔ READ FIRST — ROOT CAUSE FOUND, AND IT INVALIDATES PART OF THIS DOCUMENT
>
> **`useWebGLGuardrail` drops the WebGL marine layer to OPEN-METEO RASTER TILES after 12 consecutive
> seconds below 20 FPS.** Under SwiftShader it fires at **t ≈ 51 s**, so every reading taken later in
> a session is of a third-party wave-HEIGHT raster — not this codebase's marine field, and not the
> ONE FORECAST COMPOSITION chain. The rating band goes with the renderer; the heatmap stays. That is
> the owner's report, exactly.
>
> Paired A/B on the deployed alias, identical cameras, one variable (`__DISABLE_WEBGL_GUARDRAIL__`):
>
> | leg | freshness | band |
> |---|---|---|
> | guardrail **on** (default) | **REFUSED** 6/6, zero `[rating-band]` breadcrumbs | telemetry frozen |
> | guardrail **off** (control) | **FRESH** 6/6, 6–12 breadcrumbs per stop | **`PAINTING ✓`** 6/6, ribbon visible |
>
> ⇒ **§2a's "sourcing" hypothesis is REFUTED.** The `ratingMode` chain is healthy end to end.
> ⇒ **§2c's telemetry freeze is EXPLAINED** — the render loop was switched off, not broken.
> ⇒ **§1's numbers were taken after the trip and therefore measured the raster fallback.** They are
> superseded by the re-run in §4. Detail: `RATING-BAND-ROOT-CAUSE-2026-08-16.md`.


**Surface:** `https://dev--rawsurf.netlify.app/map`, authenticated (localStorage seed, no credentials),
theme **pinned to beach**, viewport 1280×800 @ dpr 2.
**Deployed build:** `d74b38f9` — read from `/service-worker.js` `BUILD_VERSION`, not assumed from git.
**Renderer:** `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)` —
headless software GL. Same shaders, but **not the owner's GPU**; stated, not hidden.

Harnesses: `frontend/scripts/coastband-ladder.js` · `coastband-analyze2.js` · `coastband-selftest.js`
· `ratingband-ladder.js` · `ratingband-gesture-probe.js`.

---

## 1. The coastline below z8 — the field reaches the shore

`LOP-0003` lowered `MIDZOOM_OVERLAY_CARVE_MIN_Z` 9 → 8. Below 8 the carve still does not run, so
`LOP-0002`'s attribution predicts a residual band there. **Measured: there is none.**

Definition used — no eyeballing. Along fixed GEOGRAPHIC transects (two per coast, land → open water),
one sample per device pixel:

> **band** = the run of samples, from the basemap land→water transition seaward, that are basemap
> WATER but that the marine field did not paint.
> **bleed** = the run landward of that transition that the field DID paint.

Basemap water truth comes from `queryRenderedFeatures` on the vector water layers, not from colour.

| zoom | band (median) | bleed (median) | n transects |
|---|---|---|---|
| 8.40 | **0 px / 0.00 km** | 0 px | 6 |
| 8.00 | **0 px / 0.00 km** | 0 px | 4 |
| 7.90 | **0 px / 0.00 km** | 1 px / 0.14 km | 4 |
| 7.50 | **0 px / 0.00 km** | 0 px | 3 |
| 7.00 | **0 px / 0.00 km** | 1 px / 0.27 km | 2 |
| 6.50 | **0 px / 0.00 km** | 0 px | 3 |
| 6.00 | **0 px / 0.00 km** | 0 px | 3 |

Across all 25 measurable transect-stops: band max **0 px**, bleed max **1 px (0.54 km)**. Owner coast
(Grand Bahama) and control coast (SE Florida) agree. z5.00 refused on every transect
(`VOID_NO_TRANSITION` — the island is narrower than the 20-sample transition floor), which is the
correct answer, not a zero.

**The raw profile, SE Florida at z7.50**, is the whole result in one place: the last land sample is
i=154, and i=155 — the first water pixel — is already field cyan `#75cff0` against the basemap's
`#6ea5f2`. There is no strip of bare water at the shoreline to measure.

### 1a. Why these zeros are believable, and exactly how far
Two controls were run, and **the first one failed**:

- ⛔ **`__RAW_DISABLE_MIDZOOM_OVERLAY_CARVE__` is INERT in this regime.** It produced a
  byte-identical state and identical zeros. The overlay here engages through the REPLACE branch
  (`overlayMask.reason = "coverage_gap"`), driven by the resident grid — **not** by
  `MIDZOOM_OVERLAY_CARVE_MIN_Z`. ⇒ *In the regime this session could reach, the threshold LOP-0003
  changed is not the operative gate.* Do not re-use that flag as a band discriminator.
- ⛔ **`__RAW_BASEMAP_WATER_MASK__=false`, injected before load, also produced band = 0.** It did
  move the render state (`overlayOn` true → false), so the lever is live — it simply did not
  manufacture a shortfall.
- ✅ **So sensitivity was proven directly instead.** `coastband-selftest.js` injects a band of known
  width into the captured transect and requires the detector to return it. **17 of 25 stops recover
  1, 2, 3, 5, 8, 13 and 21 px exactly**; 8 do not (near-shore shallow-water styling is not separable
  there). Beyond ~20 px the detector REFUSES rather than reporting 0.

⇒ **Honest scope: at 17 of 25 stops a band of 1 px or wider would have been reported. It was not.
At the other 8 the zero is not evidence.** That is the strongest claim the data supports.

### 1b. Two detectors were refuted en route
1. **"ON minus OFF" is not "the field painted".** Toggling Waves off restyles the whole basemap
   (landuse reorder, water fill-opacity), so the difference map is green over **land** too. The
   first run's 100% "paint fraction" meant nothing.
2. **A flat colour-distance test false-positives at the shore.** The basemap shades shallow water
   lighter (`#89b6ee` → `#6ea5f2` over ~4 samples) and the semi-transparent field composites over
   it, so genuinely-painted near-shore pixels fall outside any lightness tolerance — that alone
   produced a spurious "19 px / 1.97 km band". Replacing it with a **hue** test (B−G, references
   learned per transect, separation floor 15, measured separation 44) removed it.
   ★ Both were caught by LOOKING AT THE PIXELS, not by re-reading the code.

---

## 2. The rating band is NOT a layer-order defect

Owner report: *"the rating band is being layered underneath the marine heatmap."*

**There is nothing to reorder.** The band and the wash are two passes of the SAME WebGL engine:
`_drawCoarseBasePass` draws the wash FIRST (`WebGLMarineEngine.js:1433`) and the rating pass draws
on top (`:2135`). Draw order is already band-over-wash. ⛔ Reordering cannot fix this — and this
program has already learned that reordering was the WRONG fix for the halo (LOP-0001).

What CAN put the wash visually on top is **alpha**, and there are two separate ways it happens.

### 2a. What is actually on screen — the direct optical read
At **z9, Surf Rating: ON, the Florida coast in view**, the legend renders *"Surf Rating (coastal
band)"* with the Poor→Epic ramp — and the water is a **uniform height-heatmap wash with no coastal
rating band anywhere** (`scripts/ratingband-out/RB_z9.00.png`). The viewport span is **1.48°**.

⇒ ⭐ **This is NOT the documented 9.5–40° dead zone.** The band's full-strength window runs to
`LO = 6.0°`; at 1.48° the span fade is not involved at all. The band is missing where the fade says
it should be at full strength.

The engine already names this case, at `WebGLMarineEngine.js:1577`:
> *"OFF — rendered grid is NOT a rating grid (ratingMode=false): the backend surf=1/regional tile is
> not reaching the engine for this viewport"*

and the resident grid at every stop reads **`~223 km grid (2°)`** — the mid-res tier. So the live
hypothesis is **sourcing, not layering**: the rated grid is not reaching the engine, so the engine
paints the honest height field. That has a regression history to match — `975903b2` (the conform
mirror was EATING `ratingMode`), `7696f0dc` (flavor-mismatch defeats the viewport dedup),
`83def648` (the toggle could silently no-op), `f9c35e07` (the band would not release on toggle-off).

⚠️ **Not yet confirmed live** — see §2c. Stated as the leading hypothesis, not a finding.

### 2b. The dead zone is real, still open, and still owner-gated
Verified in source at HEAD (both halves, not from memory):
- backend `MARINE_MID_RES_RATING` defaults `"1"` and skips rating only at span ≥ 350°
  (`grid_resolver_surf.py:70-76`); `MARINE_MID_RES_MAX_SPAN` defaults **400.0**
  (`mid_res_tier.py:143`);
- frontend `resolveRatingBandFade` drives `bandMult` → 0 from span **9.5°** while lifting
  `washStrength` 0.72 → 1.0 (`marineEngineDecisions.js:112-133`).

⇒ Between 9.5° and 40° the backend ships a **rated** grid the frontend multiplies by **zero**.
Diagnosed 2026-08-09 (`df7a3d73`), pinned by a deliberately known-defective block in
`WebGLMarineEngine.ratingBandFade.test.js`, **owner-gated ever since**. The one-value fix is
`__RAW_RATING_SPAN_FADE_HI__ = 40`.
⛔ **Do not flip it as a side effect of this work.** Two reasons: it is the owner's call, and
QUEUE E#1 measured the band reading **2.3–2.7× ABOVE** the glyph with the binding sub-term not yet
isolated — widening the band's visible zoom range makes a known-miscalibrated surface *more* visible.

### 2c. ⛔ AN INSTRUMENT DEFECT THAT INVALIDATES PART OF THIS, AND OF EARLIER WORK
**`__RAW_GPU__.ratingBandFade`, `.blendBoth`, `.overlayMask` and `.maskDelivered` freeze after the
first rendered camera.**

Proven two ways, neither of them inference:
1. The telemetry's own `span` field read **0.742 at all twelve cameras** of the rating ladder, while
   the live viewport went 0.742° → 47.461°. A self-inconsistency, not a suspicion.
2. It survives a **real 34-notch mouse-wheel descent**, not just `jumpTo` — so "the harness used the
   wrong gesture" is refuted. Console shows the mechanism:
   `[WebGLMarineEngine] render returned early! _initialized: true _waveData: false matrix: true`.

Consequences, stated plainly:
- **Every fade number in the rating ladder is VOID.** §2a rests on the screenshot and the source, not
  on that telemetry.
- ⚠️ **Any earlier conclusion drawn from `__RAW_GPU__` at a camera other than the first is suspect
  unless it was cross-checked against the live view** — including LOP-0002's
  `overlayMask.on=false / reason=off` ladder and this session's own `coverage_gap` readings. The
  §1 band numbers are unaffected: they are PIXELS.
- `window.__MARINE_ENGINE__` is **absent or transient** on the deployed build, so every
  engine-sourced field silently reads `null`. `halo-isolate.js` waits on it and therefore cannot run
  against the dev alias at all — it is localhost-only.
- ⇒ **A harness reading `__RAW_GPU__` must assert freshness** (compare the telemetry's own view
  against the live one) **and refuse otherwise.** Same family as *"a check that can't tell 'not
  sampled' from 'broken' must REFUSE"* — this one silently answered with last frame.

---

## 3. What is owed

1. **`C4-MR-16` optical verification is only half done.** §1 is the pixel half on the deployed build
   at z8.4→6.0, both coasts. Still missing: a **real-GPU** confirmation (this was SwiftShader), and
   the **repaint cost** of the extra zoom level LOP-0003 bought — still unmeasured.
2. **Root-cause §2a before touching any lever.** The discriminator is whether the grid reaching the
   engine carries `ratingMode`, at a viewport where the coast is in view — and it needs the
   freshness assertion from §2c or it will read last frame's answer.
3. **Fix the telemetry freshness gap (§2c)** — it is upstream of every future measurement here.
4. Nothing in §2 is shipped. No lever was left set; no code path was changed.
