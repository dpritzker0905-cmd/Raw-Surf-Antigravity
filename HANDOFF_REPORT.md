# Raw Surf — Weather Simulation Audit Implementation & Visual Fixes Handoff Report

**Date:** 2026-06-22
**Branch:** `dev` · **Workspace:** `Raw-Surf`
**Status:** All tasks completed. Automated test suite (48 suites, 323 tests) is 100% green. Local visual verification confirmed using browser subagent on `localhost:3001`.

---

## 1. Summary of Latest Visual Fixes (Current Sprint)

### A. Zoom-In Regional Grid Culling Fix
- **Problem:** Zooming in closely on the Florida coast (e.g. Sebastian Inlet) culled the high-resolution regional grid, falling back to the coarse, clamped global grid preview.
- **Root Cause:** The `!isContained` check (which checks if the viewport is completely contained in the regional grid boundary) was being applied regardless of the zoom level. At high zoom, the viewport bounds are extremely small but may fall slightly outside the regional grid boundaries (due to coordinate projections or rounding), causing a false culling rejection.
- **Fix:** Gated the `!isContained` check on `isViewportZoomedOut` in:
  - [useMarineWindData.js](file:///c:/Users/dprit/Raw-Surf/frontend/src/components/map/useMarineWindData.js) (lines 212–221)
  - [WebGLMarineCustomLayer.js](file:///c:/Users/dprit/Raw-Surf/frontend/src/components/map/WebGLMarineCustomLayer.js) (lines 182–187)
- **Result:** Zooming in close displays the high-resolution wave/wind heatmaps perfectly.

### B. Timeline Scrub Flash/Blank-Out Fix
- **Problem:** Rapid scrubbing on the timeline cleared the active heatmap, leaving a blank canvas.
- **Fix:** In [useMarineWindData.js](file:///c:/Users/dprit/Raw-Surf/frontend/src/components/map/useMarineWindData.js) (lines 273 and 379), updated the transition check:
  - If the requested `activeModel` and `activeMarineLayer` match the currently held frame (`lastValidKeyRef.current`), we return `returnHeld()` to preserve the last rendered frame even when transition flags are false.
- **Result:** Smooth timeline scrubbing without map clearing/blank-out.

### C. WebGL State Cache & Bindings Optimization
- **Problem:** Performance diagnostics warning about high active texture unit swaps and slow `getParameter` queries for texture bindings during rendering.
- **Fix:** Added context-level state caching to the `gl` context:
  - [WebGLStateIsolation.js](file:///c:/Users/dprit/Raw-Surf/frontend/src/components/map/WebGLStateIsolation.js): Captures and restores `gl.__activeTextureUnit` and `gl.__boundTextures2D`.
  - [WebGLWindUtils.js](file:///c:/Users/dprit/Raw-Surf/frontend/src/components/map/WebGLWindUtils.js): Optimized `bindTexture` and `unbindTexture` to read from/write to `gl.__boundTextures2D` and only execute native gl bindings when state actually changes, eliminating slow GPU syncs.
  - [WebGLMarineEngine.js](file:///c:/Users/dprit/Raw-Surf/frontend/src/components/map/WebGLMarineEngine.js) & [WebGLWindEngine.js](file:///c:/Users/dprit/Raw-Surf/frontend/src/components/map/WebGLWindEngine.js): Standardized unbind loops to use `bindTexture(gl, null, unit)`.

---

## 2. Deploy & Service Status

- **Frontend Netlify Deploy:** Configured on `dev` push to `https://dev--rawsurf.netlify.app`. Bumps service-worker cache hash to the current commit hash.
- **Backend Render Deploy:** Live at `https://raw-surf-antigravity.onrender.com`.
- **Local Dev Servers:**
  - Frontend: `http://localhost:3001`
  - Backend: `http://localhost:8000`

---

## 3. History of Prior Codex Audit Changes

| Finding | Summary of Fix |
|---|---|
| **F1: EURO 14-day Horizon** | Pinned EURO native horizon to 240h + 96h estimates (336h max). Scrubber derives directly from the resolver. Clamped to 336h. |
| **F2: Paged Marine Series** | Integrated paged grid loading (loads current hour page first, then neighbours on idle). Merges native and estimates spanning pages. |
| **F3: Wind Dedup & Wind Series ON** | Wind series default toggled ON by default (`window.__WIND_SERIES__ = true`). Added in-flight request dedup. |
| **F4: OM-Protocol Logs Gate** | Gated high-frequency per-tile log noise behind `globalThis.__OM_TILE_DEBUG__`. |
| **F5: Capabilities Single-Source** | Unified DISPLAY_* exports and pinned the contract using cross-referenced backend and frontend tests. |

---

## 4. Verification Screenshots Available in Brain Artifacts
- **High-Res GFS Waves close zoom:** [florida_close_gfs_waves_1782105589614.png](file:///C:/Users/dprit/.gemini/antigravity-ide/brain/724403c5-6fdd-4bcb-a59d-1eb946fde385/florida_close_gfs_waves_1782105589614.png)
- **High-Res ICON Wind close zoom:** [florida_close_icon_wind_1782105553857.png](file:///C:/Users/dprit/.gemini/antigravity-ide/brain/724403c5-6fdd-4bcb-a59d-1eb946fde385/florida_close_icon_wind_1782105553857.png)
- **Visual verification walkthrough video/gif:** [verify_zoom_success_1782105177292.webp](file:///C:/Users/dprit/.gemini/antigravity-ide/brain/724403c5-6fdd-4bcb-a59d-1eb946fde385/verify_zoom_success_1782105177292.webp)

---

## 5. Next Steps for Claude Desktop
1. **Review Local Code Changes:** Verify the state-tracking cache implementation in `WebGLStateIsolation.js` and `WebGLWindUtils.js`.
2. **Telemetry Monitor:** Run the app locally, open the diagnostics HUD and confirm that active texture swaps and frame render counters perform optimally.
3. **Commit & Push:** If the changes look good, commit and push to branch `dev`.
