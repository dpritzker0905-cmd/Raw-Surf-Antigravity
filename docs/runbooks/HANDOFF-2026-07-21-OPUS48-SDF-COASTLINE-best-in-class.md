# HANDOFF 2026-07-21 (Opus 4.8) — best-in-class SDF coastline (the marine land-bleed arc)

Continues the 07-21 marine-stability sessions. Base was `eef17b2a` on `origin/dev`. This session took
the user-reported **coastal land-mask halo** ("bleed sticking out at John Pennekamp Coral Reef State
Park, varies with zoom") from a symptom-patch to a **signed-distance-field (SDF) coastline** — crisp,
resolution-independent, tunable-erosion coast shared by the heatmap wash AND the crest particles.
Every claim below carries a live instrument or a test. **Read §0 + §6 (how to test) first if you are
picking up the live thread; read §7 (perf) + §8 (path to production) before flipping the SDF default-on.**

## 0. TL;DR — what shipped and how to see it
- The marine coast now has a real **SDF path** (opt-in `window.__RAW_COAST_SDF__ = true`): a runtime
  Euclidean distance transform packs signed distance-to-coast into the mask's free `.b` channel; the
  heatmap + crest shaders threshold that distance → a crisp coast at ANY zoom, with a tunable
  `__RAW_COAST_ERODE__` that pulls the wave off the land. **Live-proven: the Pennekamp bleed drops
  8 → 0 cells at z9/z11.5/z13**, crests and wash cut at ONE coastline.
- Also shipped (default-on, kill-switched) earlier in the arc: the **mid-zoom overlay carve**
  (`__RAW_DISABLE_MIDZOOM_OVERLAY_CARVE__`) — engages the fine viewport overlay + crisp mask-edge cut
  down to z≥9. This is the SDF-OFF band fix; the SDF supersedes it when on.
- A permanent, toggleable **halo debug overlay** (`__HALO_DEBUG__`, **Ctrl+Alt+H**) that paints the
  basemap's true coastline (white) and, in red, where the marine field renders on true land — the tool
  that rooted this whole thing (see §5, §6).
- **SDF is OPT-IN → ships dark, byte-identical when off (forensically verified, §6).** Nothing about the
  default build changes until someone flips it on.

## 1. The arc — forensics, not guessing (how we got here)
1. The shipped halo bounds-gate (`25fd7c18`) did NOT kill what the user saw. Live probe: at z10.5 the
   viewport is INSIDE the grid+mask (`overlayMask.baseCoversView:true, on:false`) — so the gate (which
   only blanks OUT-of-bounds edge-clamp) legitimately can't touch it. **Jacobian:** the ONE variable
   that flipped the halo on/off across the band was `overlayMask.on` (the fine viewport overlay).
2. First fix (`mid-zoom overlay carve`): engage the min-combine overlay + crisp `u_maskEdgeSharp` cut
   down to z≥9 (were both gated z≥12) + lift the overlay resolution cap to 4096 in the band. Reduced
   the visible fringe a lot, but a residual remained "varying with zoom."
3. Built the **halo debug overlay** (the user asked for a permanent tool). Its FIRST version used a
   framebuffer-colour classifier and was FOOLED by the basemap's own teal `ocean-mask-fill` /
   `national-park` fills → false positives. **Corrected to a GPU mask read-back** (`probeMaskGPU`) →
   the false-positive-free metric. That tool then pinned the real bleed: a small cluster at the
   **Pennekamp peninsula tip**, a **mask-resolution artifact** (the basemap water TILES at z11 can't
   resolve the thin peninsula; gone by z13–14). The mid-zoom carve's benefit was mostly reef-water
   suppression, NOT genuine dry-land bleed.
4. Best path chosen = **SDF** (user picked it): distance-to-coast interpolates smoothly under GPU
   `LINEAR`, so a threshold reconstructs the coast isoline SUB-TEXEL even from a coarse mask (the binary
   `.r` staircases), and a threshold offset erodes/dilates for free.

## 2. SHIPPED this session (files)
NEW:
- `frontend/src/components/map/maskCoastSDF.js` — the runtime EDT (3-4 weighted chamfer → signed
  distance → `.b`), `writeCoastDistanceField()` + pure `computeCoastSDFBytes()`. Unit-tested.
- `frontend/src/components/map/maskCoastSDF.test.js` — 5 tests (encoding/monotonicity/saturation/2D).
- `frontend/src/components/map/haloDebugOverlay.js` — the permanent toggleable diagnostic (§5).
- `frontend/src/components/map/WebGLMarineEngine.midZoomOverlayCarve.test.js` — the band-carve gate.
MODIFIED:
- `WebGLMarineEngine.js` — mid-zoom carve (`_maskEdgeSharp`, `computeMidZoomOverlayEngage`,
  `dimsForOverlay` 4096 bump, refresh gates z≥9); SDF write at the 3 upload chokes + `_cachedMaskHasSDF`
  / `_overlayMaskHasSDF` flags; heatmap + draw-program SDF uniforms; `probeMaskGPU` returns `effB`.
- `WebGLMarineShaders.js` — heatmap `u_coastSDFEnabled/u_overlaySDFEnabled/u_coastErode/u_coastAA`,
  base + overlay `.b` decode, `maskFade` passthrough under SDF; imports the `computeMidZoomOverlayEngage`
  test. (also carries the earlier crisp-cut.)
- `WebGLMarineParticleShaders.js` — DRAW crest-center reads the `.b` SDF (base + overlay) + `_crestCut`.
- `WebGLMarineTextureEncoder.js` — SDF write at the base rebuild + flag resets on grid fallbacks.
- `WebGLMarineShaders.test.js`, `WebGLMarineGeoData.motionUnlock.test.js` — updated to the new shader forms.

## 3. The SDF architecture
- **Channel:** the mask canvas is grayscale (`.r==.g==.b`, `.a=255`). `.r` = land/water (all shaders),
  `.g` = motion-water (particle shaders). **`.b` is free** and is where the signed distance goes.
  **`.a` must stay 255** (non-premultiplied upload; grid-fallback alpha is inconsistent).
- **Write (build time):** `writeCoastDistanceField(canvas)` runs at the 3 mask upload chokes — base
  rebuild (`WebGLMarineTextureEncoder.js` ~732), base-patched (`WebGLMarineEngine.js` ~2822 in
  `refreshMaskWithBasemapWater`), overlay (`WebGLMarineEngine.js` ~2946 in `refreshViewportOverlayMask`).
  Each sets `engine._cachedMaskHasSDF` / `_overlayMaskHasSDF`. Grid-mask fallbacks reset the flag false.
- **Read (shader):** `oceanAlpha = smoothstep(-u_coastAA, u_coastAA, (.b - 0.5) - u_coastErode)` when
  `u_coastSDFEnabled`. Base + overlay both decode; min-combine of two SDF coverages stays crisp.
- **Engine gates the uniforms** from the `_has*SDF` flags on BOTH the heatmap program (main pass; the
  coarse-wash pass forces SDF off) and the draw program (crests) — mirrored EXACTLY so crests + wash
  never diverge.
- **Encoding:** byte 128 = coastline, >128 offshore, <128 inland; `__RAW_COAST_SDF_RANGE__` texels
  (default 40) map to the half-range. `u_coastErode` is in normalized SDF units; ~0.0125 ≈ 1 texel.
  Default validated erosion **0.025 (≈2 texels)** kills the bleed.

## 4. Flags / kill-switches (complete)
- `__RAW_COAST_SDF__ = true` — **opt-in** the SDF (default OFF → byte-identical). Requires a mask rebuild
  (pan/commit) to take effect (the EDT runs at build time).
- `__RAW_DISABLE_COAST_SDF__ = true` — hard kill (forces the shader path off even if `.b` has an SDF).
- `__RAW_COAST_ERODE__` (default 0.0 at the uniform; set 0.025 for the bleed-kill) — coast erosion.
- `__RAW_COAST_AA__` (default 0.012) — coast smoothstep half-width.
- `__RAW_COAST_SDF_RANGE__` (default 40) — texels per encoded half-range.
- `__RAW_COAST_SDF_MAXDIM__` (default 0 = full-res) — **downsample lever. LOSSY — do not ship on**
  (§7: it drops the thin coastal features that are the point → bleed 0→34 at step 2). Kept for measurement.
- `__RAW_DISABLE_MIDZOOM_OVERLAY_CARVE__` — the earlier band carve (crisp cut + overlay engage z≥9 + 4096).

## 5. The tools
- **`__HALO_DEBUG__`** (haloDebugOverlay.js) — Ctrl+Alt+H toggles. `.start()/.stop()/.toggle()/.refresh()`.
  Paints white = basemap true coast (`queryRenderedFeatures` on the `water` fill), red = renders WATER
  on true land (**SDF-aware**: uses `probeMaskGPU().effB` + the live erode when the SDF is on, else the
  `.r` mask), orange = near-coast band. `window.__HALO_DBG_STATS__ = {realBleed, feather, sdfOn, erode}`.
- **`engine.probeMaskGPU(points)`** — GPU read-back of the mask texel the shader used. Now returns
  `{base, overlay, effective, src, effB}` per point (`effB` = the coast-SDF byte; `effective` = the
  binary `.r`). `>=128` = water.
- **`__MASK_PROBE__`** (maskFloodProbe.js, pre-existing) — `scoreFlood/scoreVisual/sweep`. ⚠️ `scoreVisual`
  reads the composited framebuffer and is fooled by basemap teal near coasts — use `__HALO_DEBUG__`'s
  mask-value metric for a false-positive-free bleed count.
- `__RAW_GPU__.coastSdf = {dims, step, ms, read, compute, put}` (EDT timing) and `.coastSDF =
  {base, overlay, erode, aa}` (shader uniform state).

## 6. HOW TO TEST (the forensic protocol — do this before trusting any change)
Live harness: `preview_start name:"frontend-preview"` (autoPort, openssl-legacy) → localhost. Drive with
`window.map.jumpTo`; click the "Waves" button by label. Center on Pennekamp `[-80.40, 25.12]`, z11.5.
1. **SDF-off byte-identical** (regression guard): with the SDF OFF, `probeMaskGPU` over a grid → `effB`
   MUST equal `effective` at every sample (verified this session: 660/660 identical). `.b` is a redundant `.r`.
2. **Bleed-0** (the fix): set `__RAW_COAST_SDF__=true; __RAW_COAST_ERODE__=0.025`, force a rebuild (pan),
   `__HALO_DEBUG__.refresh().realBleed` → **0** across z9/z11.5/z13 (was 8 at z11.5 legacy).
3. **Crest/wash parity**: `__RAW_GPU__.coastSDF` shows `base:true, overlay:true` on BOTH programs;
   screenshot → no crest streaks past the wash coastline.
4. **Perf**: read `__RAW_GPU__.coastSdf.compute` over several rebuilds (§7).
⚠️ INSTRUMENT PITFALLS (cost hours): `engine._waveData` is nulled after upload (NOT a "showing" signal —
use a screenshot or `_residentWaveTex`); the framebuffer-colour bleed classifier false-positives on
basemap teal (use the mask-value metric); the debug refresh is slow (~3640 `queryRenderedFeatures` +
GPU read-back per call — a full sweep can exceed the 30s JS-eval tool limit, do ≤2 zooms per call);
Browser-pane screenshots + navigate occasionally hang — a rapid edit+test cycle can **wedge the CRA dev
server** (direct curl hangs too) → `preview_stop` + `preview_start` to recover.

## 7. Perf profile (the honest numbers)
Measured on a 2048×1024 mask (`__RAW_GPU__.coastSdf`, after a JIT-warmup first call):
- **compute (the distance transform) is the bottleneck: ~50–65 ms**; getImageData ~8 ms; putImageData ~2 ms.
- The chamfer allocated ~24 MB of Int32Array per call → GC spikes to ~145 ms. **Fixed** by reusing
  module-level scratch buffers (`maskCoastSDF.js` `signedDistChamfer`), which removed the spikes.
- Two EDTs run per settle (base + overlay) → **~110–130 ms/settle**, gated by the mask-rebuild hysteresis
  (only on real view changes, not micro-pans). **Acceptable for opt-in; NOT for default-on.**
- The CPU **downsample lever is not viable** (`step 2` → bleed 0→34: it drops the sub-ds-pixel land
  features the SDF exists to preserve). Left default-off.
- **The real perf fix = GPU jump-flood (JFA):** compute the distance field on the GPU (log-n ping-pong
  passes, sub-ms, full precision). The FBO/ping-pong infra already exists (advect pass, particle-state
  textures). This is the prerequisite for default-on.

## 8. PATH TO PRODUCTION (best path for quality + long-term stability)
1. **GPU-JFA perf** — move the distance transform to the GPU (seed from the mask `.r`, JFA to the `.b`,
   or a dedicated SDF texture). Removes the settle hitch. THE blocker for default-on.
2. **Flip default-on** — after (1) + a theme pass (SDF is theme-independent — it's geometry, not colour —
   but the theme swap disposes+rebuilds the engine, so verify `_cachedMaskHasSDF` re-sets true and the
   coast re-carves) + a mobile check (the EDT/JFA cost + the 4096 overlay memory).
3. **Retire the superseded band-aids** — once the SDF is default-on it supersedes `u_maskEdgeSharp`
   (crisp cut) and much of the mid-zoom carve. Removing them is a real long-term-stability win (less
   coupled coast logic), but do it AFTER the SDF is proven default-on, one at a time, A/B'd.
4. **Extend the particle SDF** (optional completeness) — the ADVECT motion sites + the DRAW ribbon-endpoint
   fade still use binary `.r`. Harmless today (a particle in the eroded strip simply doesn't draw), but for
   full consistency wire them to the same `.b` (the workflow map in the session has the exact sites/sketch).
5. **Erode/AA final tune** — 0.025/0.012 validated at z11.5; sweep the band + open water for the sweet spot.

## 9. Other open items (not this arc)
- **Zoom-clear heatmap (queue §6.2)** — FORENSICALLY DISPROVEN as a zoom bug: 3 clean synthetic gestures
  showed 0 disposes, resident texture held. The engine disposes only on a **style/theme swap** (custom
  layer `onRemove`). A background hunt DID find a real blank-heatmap defect: `setWaveData`
  (`WebGLMarineEngine.js` ~811) assigns `this._waveData = newWaveData` unconditionally, so a null encode
  (degenerate <2-col grid @ `WebGLMarineTextureEncoder.js` ~86, or a thrown upload) discards the valid
  resident → blank with no re-drive. **Worth fixing.**
- **Adversarial defect hunt (task #2)** — the encoder-null-commit above + the style-swap #11-refeed blank
  window are the top verified candidates.
- Halo/ARBITER-flip/Issue-B items from the prior handoffs remain user-eye-pass gated.

## 10. Where things live / ops
- Suites: `node node_modules/@craco/craco/dist/bin/craco.js test --watchAll=false` (cd frontend). Full =
  **1370 tests**; the SDF adds `maskCoastSDF.test.js` (5) + shader-source assertions.
- Windows python broken → `AppData\Local\Python\bin\python3.exe`. Bash CWD persists.
- ⚠️ WebGLMarineEngine.js has PRE-EXISTING grandfathered eslint errors — the v8 build tolerates them.
- The Grep TOOL index went stale mid-session (missed just-written strings) — cross-check with Bash `grep`.
- Non-mine working-tree noise to NOT commit: `.agents/skills/supabase/SKILL.md`, `skills-lock.json`.
