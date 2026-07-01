# HANDOFF — Marine render: vortex FIXED, regional-coverage CLAMP still open (2026-07-01)

**Branch:** `dev` (HEAD `fe7431c3`). **Do NOT promote to `main`** — `main` is `f948b2a4` (2026-06-04), **647 commits behind**; production release is a separate §22 handshake and marine render is not fully clean yet.

**One-line status:** The close-zoom "clockwise SPIN/vortex" is **FIXED and user-confirmed**. What remains is a **separate regional-grid COVERAGE problem** (clamp / clear / coastal land-bleed on zoom transitions) — that is the focus of the next session.

---

## 1. What was FIXED this session — DO NOT re-investigate or revert

Five commits landed on `dev` (all pushed to `origin/dev`):

| Commit | What |
|---|---|
| `43977351` | First vortex attempt (coherence floor) + **no-downgrade guard** (kept) |
| `1dba14ce` | **Service worker never runs on localhost** (the session-wrecking root cause) |
| `f5c6c83f` | Strengthened the (later-abandoned) coherence floor |
| `4520300e` | **REAL vortex fix: suppress crest animation on the coarse-global grid** |
| `fe7431c3` | Bound the suppression to the vortex band (z3.5–7) so crests return when zoomed in |

### 1a. The vortex — ROOT CAUSE (settled, with measurements)
- The "spin" is **NOT** sibling-layer cycling, **NOT** FieldEvolutionEngine rotation, **NOT** a shader time-rotation, and **NOT** merely a bilinear-interpolation artifact. Those were all ruled out (some were red herrings from a prior session's handoff).
- **It is the COARSE-GLOBAL 37×17 wave grid's own direction field being genuinely ROTATIONAL** at regional magnification. Measured live on the resident coarse grid: `maxAbsCurl = 1.769`, `meanAbsCurl = 0.423` across 195 interior ocean cells (vs a regional grid = **0** interior cells / 0 curl).
- It appears when the coarse grid is the resident advection source and you're at **z ~4–6** (you see 1–2 of its ~10°/cell cells filling the screen). The coarse grid becomes resident via the **reactivation instant-cache-hit** (see §2d) or a zoom-out.
- **Why a "coherence floor" (culling low-magnitude interpolated particles) FAILED:** it only removes particles at cell *boundaries*; the particles at cell *centers* (interp magnitude ≈1) survive and keep advecting the divergent per-cell headings → the field still rotates at ANY floor < 1. Confirmed live: 0.5 and 0.7 both failed. **Do not resurrect the floor approach.**
- Wave texture filtering is `gl.LINEAR` (`WebGLMarineTextureEncoder.js:605`) — confirmed, not the cause.

### 1b. The vortex — THE FIX (in `WebGLMarineEngine.js`, render method, ~line 429)
When the resident grid is coarse-global (`isCoarseGlobalGrid()`) AND `z > 3.5 && z < 7.0`, set `dirCoherenceMin = 2.0`. The draw/advect shaders discard every crest where `length(waveVec) < max(0.02|0.005, u_dirCoherenceMin)`; since unit vectors max at 1.0 and 2.0 > 1.0, **all crests are discarded** → no vortex. The **heatmap pass is untouched** (it doesn't read this uniform).
- **Kill switch:** `window.__RAW_DISABLE_COARSE_CREST_SUPPRESS__ = true`
- **Partial-cull override (instead of full suppress):** `window.__RAW_DIR_COHERENCE_MIN__ = <0..1>`
- **Telemetry:** `window.__RAW_GPU__.anim.dirCoherenceMin` → `2` means suppression is active.
- Uniform `u_dirCoherenceMin` lives in `WebGLMarineParticleShaders.js` (ADVECT_FS + DRAW_VS); tests in `WebGLMarineShaders.test.js`.
- **Verified:** live-captured the gate firing (`dirCoherenceMin=2` on the resident 37×17 grid). User confirmed "I am not seeing the vortex" and "animations appeared at zoom 9."

### 1c. The no-downgrade guard (`43977351`, kept)
Pure `shouldRejectResolutionDowngrade(resident, incoming, lastZoom, viewportBounds, disabled)` exported from `WebGLMarineEngine.js` + a guard at the top of `setWaveData`. Refuses to overwrite a resident **regional** grid with the **coarse-global** fallback for the same layer+hour while zoomed in **over a covered viewport**. Directional/hour/coverage-gated so it never strands a rectangle. Kill: `window.__RAW_DISABLE_NO_DOWNGRADE__`. Telemetry: `window.__MARINE_NO_DOWNGRADE__.count`. 10 unit tests in `WebGLMarineEngine.noDowngrade.test.js`. **Note:** this guard is mostly dormant in practice (it correctly does not fire during the clamp repro because the regional there does NOT cover); do not expect it to fix the clamp.

### 1d. Service worker on localhost (`1dba14ce`) — CRITICAL context
**This wrecked most of the session.** The localhost dev SW (`frontend/public/service-worker.js`, `skipWaiting()` + `clients.claim()`, hourly update check) pinned an OLD build (`rawsurf-v3-3b94b570` cache) and served stale JS across reloads, so fixes appeared not to work for MANY rounds. Fixed in `frontend/src/index.js`: on localhost we now `unregister()` any SW and purge `rawsurf-*` caches; SW only registers in production/preview. **The log line `[SW] Localhost — service worker unregistered + caches purged` confirms fresh code is running.** ⚠️ There is a SECOND SW registration in `frontend/src/hooks/usePushNotifications.js:27` that still re-registers on localhost (logs `[ServiceWorker] Loaded...`); it did NOT re-introduce staleness (the SW doesn't cache the JS bundle, and index.js purges caches), but consider guarding it too for cleanliness.

---

## 2. What is NOT fixed — THE WORK FOR THE NEXT SESSION

All remaining symptoms are ONE family: **regional-grid COVERAGE on zoom transitions.** They are unrelated to the (now-fixed) animation vortex.

### 2a. ★ PRIMARY BUG — `regional_too_small` clamp: a covering frame is committed but never reaches the engine
**Symptom (user):** activate at z9 → zoom to ~7.67 → crests "clamp down" (render into a sub-rectangle that doesn't fill the screen). At z8.58 a tile happens to cover ("proper shape"); at z9.17 it "cleared."

**Root evidence (from the live console log, fresh code):**
```
[Marine] Render backstop: regional_too_small grid at zoomed-in viewport + idle ≥3s — re-driving.
         sharpen={found:true, covers:true, fw:4.0, willSharpen:true} series={loads:6, hits:3, misses:4}
[SCRUB-SETTLE] Sharpening regional_too_small grid: committing covering regional series frame.
...
[Marine] Clamp backstop: regional_too_small made no progress after 3 re-drives — stopping churn until the view changes.
         (sharpen willSharpen=true frameFw=4; engineGw=3.0)
         engineBounds=[W-82.00 E-79.00 S27.00 N30.00] viewport=[W-82.75 E-79.02 S27.56 N29.23]
```
**Interpretation:** the regional wave tiles for Cocoa are **~3° wide** (`-82…-79`). At z7–8 the viewport widens to **~3.7°** (`-82.75…-79.02`), so the 3° tile can't cover → clamp. The scrub-settle recovery **FINDS a covering 4° frame** (`found:true, covers:true, fw:4.0, willSharpen:true`) and commits it — **but the engine grid stays 3° (`engineGw=3.0`)**. i.e. **the committed covering frame does not stick at the engine.** After 3 no-progress re-drives the loop-cap (from `5a13c9ef`, working as intended) stops the churn, leaving the clamped 3° rectangle.

**This is the highest-value bug to fix.** Start by tracing WHY the committed 4°-wide `series_GFS_waves_h0` frame does not become the engine's resident grid:
- Path: `useMarineScrubSettle.js` `runScrubSettleCheck()` → `setMarineData(frame)` → `WebGLMarineLayer` data effect → `safeUploadWaveData()` → `engine.setWaveData()`.
- Suspects: (a) `computeVectorDiffAndLog` in `WebGLMarineLayer.js` skipping the upload as a "duplicate"; (b) a later commit (SWR / `land_mask_res_swap`) overwriting the covering frame with the old 3° tile; (c) the frame's bounds/coverage metadata not matching what `detectClamp`/`gridCoversViewport` expect; (d) `getMarineSeriesFrame` returning a frame tagged covering but whose actual `bounds` are still 3°.
- **Confirm the no-downgrade guard is NOT the culprit** — it only blocks *coarse-global* incoming; a 4° regional frame is not coarse-global, so it should pass. (Verify anyway with `window.__RAW_DISABLE_NO_DOWNGRADE__ = true`.)
- Files: `useMarineScrubSettle.js` (detectClamp, runScrubSettleCheck, clamp backstop), `marineGridSeries.js` (`getMarineSeriesFrame`, `bboxContains`, `ensureMarineSeries`), `WebGLMarineLayer.js` (`safeUploadWaveData`, `computeVectorDiffAndLog`), `useMarineOrchestrator.js`.

### 2b. Zoom-out CLEAR with no coarse fallback
**Symptom:** zooming further out, the heatmap **clears** entirely (`[WebGLMarineEngine-Clear] Clearing resident wave textures and waveData`), instead of falling back to the coarse-global grid (which covers the whole world).
**Proposed fix direction:** when the regional clamp gives up (2a) or the viewport outgrows all regional tiles, **commit the cached coarse-global grid as a covering fallback**. With the vortex suppression from §1b, the coarse fallback shows heatmap (covering) with **no crest vortex** — clean. The coarse grid is already fetched/cached (`gfs_marine_waves_global_coarse_*`). Beware: this interacts with the no-downgrade guard (which blocks coarse *over a covering regional* — but here the regional does NOT cover, so coarse should be allowed).

### 2c. Coastal LAND-BLEED at z8.8
**Symptom:** "clamped animations that also are covering coastal land" — crests render over land near the coast at ~z8.8.
**Likely cause:** land-mask resolution / the ocean mask not masking crests at that zoom (the draw shader samples `u_oceanMaskTexture`; the mask is a 1024×512 high-res land texture — check its coverage/threshold at mid-zoom). Related prior work: `1bb181df` swapped to a 10m land mask at z9 to stop wave bleed. This is a separate, smaller issue; can be folded into the coverage work.

### 2d. Reactivation commits the coarse-global grid (the vortex's *source*)
**Mechanism:** deactivate → reactivate waves while zoomed out → `[SWITCH] [Marine] Instant cache-hit commit for waves` commits the **coarse-global 37×17** frame because the instant-cache-hit fast-path deems a global grid "valid everywhere" (`useMarineOrchestrator.js` ~line 378, `if (gridWidth >= 340.0) safe = true`). This is WHY the coarse grid becomes resident (and used to vortex; now it's suppressed but still shows a coarse heatmap with no crests). **Optional deeper fix:** don't instant-commit a coarse-global frame at a regional/zoomed-in viewport when a regional fetch is pending — but this is the delicate clamp path; the §1b suppression already neutralizes the *visible* vortex, so this is lower priority.

### 2e. Minor: "no visible waves" at z3.59 after reactivate
At z3.59 the coarse grid is resident and `3.5 < 3.59 < 7.0`, so the §1b suppression fires → heatmap with no crests. This is arguably correct (borderline vortex zone) but if it feels wrong, the lower bound (3.5) can be nudged up. Low priority; tune only after the coverage bugs are fixed.

---

## 3. Critical gotchas for the next session (read before touching anything)

1. **VERIFY YOU ARE ON FRESH CODE.** The SW-stale-bundle trap ate ~half this session. On localhost the guard now auto-purges, but always confirm: console shows `[SW] Localhost — service worker unregistered...`, and `'dirCoherenceMin' in (window.__RAW_GPU__?.anim || {})` returns `true`. A full page reload (not just HMR) is needed to reinstantiate `WebGLMarineEngine` with new render-method code.
2. **The app HARD-CONTROLS the map view (react-map-gl controlled).** Imperative `map.setZoom()/jumpTo()` REVERTS. In the Claude preview harness the map container also renders 0×0 in the narrow viewport, and synthetic wheel events are unreliable. **Net: you cannot reliably drive zoom via preview automation** — this is why the clamp (a zoom-transition bug) could not be reproduced locally and had to be diagnosed from the user's logs. Plan for log-based iteration, or find a way to reproduce (e.g. a wider viewport, or a test harness that sets viewState).
3. **Local dev backend:** localhost hits the **Render** backend via `localStorage.__BACKEND_URL__ = 'https://raw-surf-antigravity.onrender.com'` plus flags `__USE_BACKEND_MARINE_SYSTEM__`, `__USE_BACKEND_WEATHER_SERVICE__`, `__USE_BACKEND_WIND_SERVICE__` = `'true'`. A fresh origin (new preview port) has empty localStorage → marine fetch fails ("Failed to fetch products manifest") until you set these.
4. **Dev server:** `.claude/launch.json` has `frontend-live` (PORT 3001, `--openssl-legacy-provider`) and a `frontend-preview` (autoPort, added this session for the Claude preview). The user runs their own `npm start` on 3001. The map auto-centers on Cocoa Beach (28.33, -80.61) z9 via IP-geo. Activate marine via the "Waves" button (a `<button>` with textContent `Waves`).
5. **The `regional_too_small` clamp only churns 3× then stops** (the `5a13c9ef` loop-cap is WORKING — do not "fix" the loop-cap; the bug is that the covering frame doesn't stick, not that it loops forever).
6. **Do NOT re-attempt the coherence-floor approach** for the vortex — it is mathematically incapable of removing data-level rotation (§1a). The suppression (§1b) is the answer.
7. **Deployment gap:** `dev` is 647 commits ahead of `main` (production). Netlify production builds from `main`; the dev-preview `dev--rawsurf.netlify.app` builds from `dev`. Don't promote to main until the coverage work is done and verified (§22 handshake).

---

## 4. Reproduction (from the user, on localhost 3001, fresh code)

1. Load `/map` (auto-centers Cocoa z9), activate **Waves** (GFS). → crests appear (good; vortex fixed).
2. Zoom to ~7.67 → crests **clamp down** into a sub-rectangle (bug 2a).
3. Zoom to ~8.58 → sometimes "proper shape" (a tile happens to cover).
4. Zoom to ~9.17 → animations **clear** (investigate — regional coverage/commit).
5. Zoom out to ~3.5, deactivate, reactivate → heatmap returns, **no crests** (coarse resident + suppression; expected) — but note the coarse commit path (2d).
6. Zoom out further → heatmap **clears** with no coarse fallback (bug 2b).

---

## 5. Verification methods that WORKED this session (reuse them)
- **Numerical curl** of the resident grid's direction field (in-page eval) proved the vortex is data-rotation, not interpolation.
- **`window.__RAW_GPU__.anim.dirCoherenceMin`** echo proved the suppression gate fires (`=2`) on the coarse grid.
- **A poller** (`setInterval` capturing `window.__MARINE_ENGINE__._waveData.waveGrid` dims/bounds + the anim echo every 250ms) caught the coarse→regional transitions without needing to drive zoom.
- Jest: `WebGLMarineShaders.test.js` (shader uniform asserts) + `WebGLMarineEngine.noDowngrade.test.js` (10 decision cases). Run: `cd frontend && CI=true NODE_OPTIONS=--openssl-legacy-provider npx craco test --watchAll=false --testPathPattern="(WebGLMarineShaders|noDowngrade)"`.
- Babel parse check (from `frontend/`): `NODE_ENV=test node -e "require('@babel/core').parseSync(require('fs').readFileSync('src/components/map/WebGLMarineEngine.js','utf8'),{presets:[require.resolve('babel-preset-react-app')],filename:'x.js'})"`.

---

## 6. Key files
- `frontend/src/components/map/WebGLMarineEngine.js` — engine render loop; the vortex suppression (~L429), the no-downgrade guard + `shouldRejectResolutionDowngrade`, `isCoarseGlobalGrid`/`isRegionalBounds`, `setWaveData`, particle reset, `clearBuffers` (L1119).
- `frontend/src/components/map/WebGLMarineParticleShaders.js` — ADVECT_FS / DRAW_VS (`u_dirCoherenceMin` discard gate).
- `frontend/src/components/map/useMarineScrubSettle.js` — `detectClamp`, `runScrubSettleCheck`, clamp backstop + loop-cap. **Primary file for the clamp bug (2a).**
- `frontend/src/components/map/marineGridSeries.js` — `getMarineSeriesFrame`, `ensureMarineSeries`, `bboxContains` (series tile coverage).
- `frontend/src/components/map/useMarineOrchestrator.js` — layer-switch commit, instant-cache-hit (2d), `setMarineData`.
- `frontend/src/components/map/WebGLMarineLayer.js` — `safeUploadWaveData`, `computeVectorDiffAndLog` (duplicate-skip), `clearBuffers` call sites.
- `frontend/src/components/map/WebGLMarineTextureEncoder.js` — texture encode (`gl.LINEAR` wave tex L605), land mask.
- `frontend/src/index.js` — SW localhost guard.
- Memory: `[[marine-close-zoom-spin-direction-interp-2026-07-01]]`, `[[clamp-root-step37-preview-coverage-2026-07-01]]`, `[[marine-clamp-recommit-fix-2026-07-01]]`, `[[verify-bundle-hash-first]]`, `[[blend-both-marine-coarse-base-2026-06-30]]`.

---

## 7. Suggested first move for the new session
Reproduce §2a, then instrument the commit path to answer: **"the covering 4° frame is committed (`willSharpen:true, covers:true`) — why is the engine's resident grid still 3°?"** Log the grid bounds at every `engine.setWaveData` call vs what `runScrubSettleCheck` committed, in one repro. That single question, answered, likely unblocks the whole coverage family (2a/2b/2c). Then add the coarse-global covering fallback (2b) as the safety net, which the vortex suppression makes visually clean.
