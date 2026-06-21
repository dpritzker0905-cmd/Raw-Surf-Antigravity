# Gemini Flash 3.5 Handoff — Marine map frame-drop (FPS) perf, SURGICAL only

**Branch:** `dev` (Netlify auto-deploys frontend from `dev`). **Repo:** `C:\Users\dprit\Raw-Surf`, frontend is CRA/craco React in `frontend/`. Marine code: `frontend/src/components/map/`.
**Your job:** reduce the main-thread/GPU frame drops on the weather map. **Make small, surgical, reversible changes only.** Do NOT refactor, rename, or restructure. Do NOT touch the data-fetch / abort-storm / transition machinery (it was just stabilized — see "DO NOT TOUCH").

---

## 0. Read this first — how to not break anything
- **One change at a time.** After each change: `cd frontend && CI=true npx craco build` (must succeed — `CI=true` makes warnings fail) AND `CI=true npx craco test --watchAll=false --testPathPattern="marine|coordinator|dispatcher"` (must stay green). Commit that one change. Then do the next.
- **Never use `git --no-verify`.** There is an 800-LOC-per-file pre-commit gate. If a file would exceed 800 lines, STOP and ask — do not bypass.
- **Weather-truth rule:** never make the heatmap show data whose model/layer/hour doesn't match the UI. Don't change what data is displayed — only HOW the browser draws/schedules it.
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- After pushing, the user verifies live (hard-reload; the service worker logs `Removing old cache: rawsurf-v3-<hash>` — `<hash>` must equal `git rev-parse --short HEAD`).

## DO NOT TOUCH (recently stabilized — changing these will reintroduce bugs)
- `useMarineDataFetcher.js`, `useMarineDataFetcherCore.js`, `useMarineDataFetcherHelpers.js`, `marineInFlightRegistry.js`, `useMarineRevalidation.js`, `marineController*.js`, `marineTransitionCoordinator.js`, `useMarineOrchestrator*.js`, `MapForecastOverlay.js`, `useExactPointFetch.js`, `backendWeatherServiceClient*.js`.
- The abort/detach/registry/parity logic. The model timeline window (ICON = 14 days is intentional).
- These are the fetch+truth layers. The perf problem is in the RENDER/DRAW layer (below), which is separate.

---

## 1. The problem (confirmed from React Scan + console)
Frame drops while interacting with the map. React Scan reports, repeatedly:
- **`react component render time: 0ms`** and all time in **"other" = 169ms / 216ms / 375ms** (and earlier sessions up to 1433ms; one route click had 588ms in "dom commit → frame presented").

**Conclusion (already established):** this is **NOT React re-renders** and NOT the data fetching. It is **main-thread JS + GPU/compositor** work done on every weather commit / map move. So memoizing React components will NOT help. Focus on the imperative draw path.

## 2. Ranked suspects, with evidence from the console log

### Suspect A (cheap, do first) — Canvas2D `getImageData` without `willReadFrequently`
Console shows at startup:
> `Canvas2D: Multiple readback operations using getImageData are faster with the willReadFrequently attribute set to true.`
This means some 2D canvas is doing repeated `getImageData` GPU→CPU readbacks without the optimization flag. Each readback stalls the pipeline.
**Action:** `grep -rn "getContext('2d'" frontend/src` and `grep -rn "getImageData" frontend/src`. For EVERY canvas whose context is later used with `getImageData`, ensure the context is created with `{ willReadFrequently: true }`. Known offender to fix: `WindParticleOverlay.js` (uses `willReadFrequently: false` — change to `true`). Leave the ones already `true` (GPUMarineLayer, GPUWindLayer, WebGLMarineMaskRenderer) alone. This is a one-word change per site; verify the warning disappears in console after deploy.
**Risk:** ~none. Pure perf hint.

### Suspect B (biggest repeated cost) — `OceanMask.syncLayers` thrash
Console shows `[OceanMask] State Changed` + `[OceanMask] syncLayers running` + `[OceanMask] Deactivating: removing layers` firing on **nearly every** weather commit and model/layer switch. `syncLayers` mutates Mapbox/MapLibre style layers (add/move/remove), which forces style recompute + compositor work on the main thread — the likely bulk of the "other" time.
**Action (careful):** Open `frontend/src/components/map/OceanMask.js`. Find `syncLayers` and what calls it. It likely already has some batching (`safeMoveLayersBatch`, rAF). The goal is to **coalesce redundant calls**: if `syncLayers` is invoked multiple times within the same frame / in rapid succession with no actual layer-set change, collapse them into ONE `requestAnimationFrame`-batched run, and early-return if the computed layer order is identical to the last applied order (cheap signature compare).
**Guardrails:** Do NOT change WHICH layers are shown or their stacking order — only avoid re-applying an identical order and avoid running more than once per frame. If you can't do this without risk, STOP and just report what `syncLayers` does + how often it's called; do not guess.
**Risk:** medium (layer ordering / ocean mask correctness). Make it a standalone commit so it can be reverted alone.

### Suspect C (already optimized — verify only, likely leave alone)
- `[WebGLMarineEngine] Resetting particle state textures…` — already made in-place (texSubImage2D) last round; should be cheap now. Don't re-touch unless a perf trace proves it's still hot.
- `High-resolution land mask texture created (1024x512)` — already bounds-cached; fires rarely. Leave it.
- The marine (87,616) + wind (147,456) particle RK4 sim runs continuously (`frontend/src/engine/SimulationLoop.js`, compose throttled to ~4Hz via `NORMAL_COMPOSE_INTERVAL=15`). Only touch if a trace proves the sim STEP (not compose) is the bottleneck — and then ask first.

## 3. REQUIRED before deep changes — get a real profile
The console logs alone can't rank A/B/C precisely. Ask the user to capture **ONE Chrome DevTools Performance trace**: DevTools → Performance → Record → reproduce the lag (toggle a marine layer / pan once) → Stop. Then read the **Main thread flame chart** and identify the single widest block:
- If it's `syncLayers` / Mapbox style functions → do Suspect B.
- If it's `getImageData` / canvas readback → Suspect A is bigger than expected.
- If the Main thread is mostly idle and GPU is the bottleneck → it's fill-rate (the two resident WebGL layers); report back, don't guess.
**Do Suspect A regardless (it's free and safe). Do Suspect B only after the trace or with the careful guardrails above.**

## 4. Verification after each change
```
cd frontend
CI=true npx craco test --watchAll=false --testPathPattern="marine|coordinator|dispatcher|forecast"
CI=true npx craco build
```
Both must pass. Then `git add <specific files>` and commit (one logical change per commit). Push to `dev` only when the user says to, or ask.

## 5. What "done" looks like
- The `willReadFrequently` console warning is gone.
- `[OceanMask] syncLayers running` no longer fires multiple times per single commit (coalesced to ≤1/frame), with NO change to which layers/ocean mask appear.
- React Scan "other time" during a marine layer toggle drops measurably (user will re-measure).
- Zero regressions: marine + wind heatmaps still load, model/layer switching still works, no blank/stuck heatmap, no `[ABORT RECOVERY] Committing recovery grid` storm.

## 6. Context you can rely on (no need to re-investigate)
- Abort-storm is fixed: switches now `[Detach] Detaching…` (let fetch finish + self-cache) instead of aborting; an in-flight registry (`marineInFlightRegistry.js`) bounds concurrency. Do not modify.
- Data correctness (which model/layer/hour shows) is governed by `requestId`/live-target guards + the transition coordinator + `MapForecastOverlay` parity gate. Do not weaken.
- The grid is small (37×17 / 19×9 ≈ hundreds of vectors) in normal operation; an oversized-grid guard rejects >250k-cell anomalies. So `encodeMarineTexture` input is usually small — it is probably NOT the main cost; the repeated Mapbox style work (Suspect B) is more likely.
