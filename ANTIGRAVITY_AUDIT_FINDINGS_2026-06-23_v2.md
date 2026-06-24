# Antigravity Handoff: Weather Simulation & Marine Heatmap Subsystem Audit Findings (Pass #2)

**Date:** June 23, 2026  
**Auditor:** Antigravity AI  
**Scope:** Weather simulation / marine heatmap subsystem in `Raw-Surf` (branch: `dev`, HEAD: `eb067c7e`)  
**Target Delivery:** `ANTIGRAVITY_AUDIT_FINDINGS_2026-06-23_v2.md` in repository root  
**Status:** AUDIT ONLY (No code modifications, commits, or pushes have been performed)

---

## 1. Verification of Applied Fixes (§1)

We verified the correctness and checked for regressions on the 3 fixes applied in commits `49dc3fd6` and `eb067c7e`.

| Commit | Area / Verdict | File & Line Range | Evidence / Verification Findings |
| :--- | :--- | :--- | :--- |
| `49dc3fd6` (Part A) | **CORRECT** <br> *No Regressions* | [OceanMask.js:315](file:///C:/Users/dprit/Raw-Surf/frontend/src/components/map/OceanMask.js#L315) | Confirmed that `MASK_BUFFER` is a `'line'` layer initialized at [OceanMask.js:393](file:///C:/Users/dprit/Raw-Surf/frontend/src/components/map/OceanMask.js#L393) and full-sync recolors it with `'line-color'` at [OceanMask.js:432](file:///C:/Users/dprit/Raw-Surf/frontend/src/components/map/OceanMask.js#L432). The fast-path paint property is now corrected from `'fill-color'` to `'line-color'`. No other paint properties are incorrect. `lastSyncCoreRef` gating remains correct. |
| `49dc3fd6` (Part B) | **CORRECT** <br> *No Regressions* | [useMarineDataFetcherCore.js:228](file:///C:/Users/dprit/Raw-Surf/frontend/src/components/map/useMarineDataFetcherCore.js#L228) | Confirmed that moving `requestId = ++marineRequestIdRef.current` below the rate-limit/cooldown fallback check resolves the stranded-lock bug. Cooldown fallbacks no longer increment the ref, allowing a prior in-flight fetch's `finally` block to clear `locks.isFetching` since `requestId` matches the current ref. Audited the wind fetcher ([WeatherEngine.js](file:///C:/Users/dprit/Raw-Surf/frontend/src/components/map/WeatherEngine.js)) and verified it uses standard React effect cleanups (`clearTimeout`, `cancelled` boolean) instead of a `requestId` lock, making it immune to this pattern. |
| `eb067c7e` | **CORRECT** <br> *No Regressions* | [useMarineOrchestrator.js:580-605](file:///C:/Users/dprit/Raw-Surf/frontend/src/components/map/useMarineOrchestrator.js#L580-L605) | Verified that adding the terminal error bypass (`__failureReason` check) and a 3-refetch cap per `{hour, model, layer}` target halts retry loops. Traced the grid-creation path: `buildCopernicusEmptyGrid` ([useMarineDataFetcherHelpers.js:150](file:///C:/Users/dprit/Raw-Surf/frontend/src/components/map/useMarineDataFetcherHelpers.js#L150)) and `getAbortRecoveryGrid` ([useMarineDataFetcherHelpers.js:183](file:///C:/Users/dprit/Raw-Surf/frontend/src/components/map/useMarineDataFetcherHelpers.js#L183)) correctly attach the `__failureReason` property. The cap does not block recoverable hours since it automatically resets on UI target switches. |

---

## 2. Re-examination of Held Items (§2)

We audited the 4 held items and formulated safe, minimal-risk approaches that satisfy the specified concerns.

### 2.1 OceanMask Hide-vs-Remove Toggling
*   **Audit Verdict:** User's concern confirmed. Completely removing the 350ms debounce deactivation is risky because it introduces layout/theme feedback cycle issues.
*   **Minimal-Risk Approach:**
    1. Keep the 350ms deactivation debounce timer in the `useEffect` ([OceanMask.js:601](file:///C:/Users/dprit/Raw-Surf/frontend/src/components/map/OceanMask.js#L601)).
    2. When the deactivation timer fires, instead of tearing down layers and sources with `removeLayer`/`removeSource`, set their layout property `visibility` to `'none'` (via `mapInstance.setLayoutProperty(lid, 'visibility', 'none')`).
    3. Inside `syncLayers()`, if layers already exist when `active` is true, synchronously restore them with `visibility: 'visible'` (in the `else` branch of `hasBuf`, `hasFill`, etc.).
    4. Keep the unmount-cleanup `useEffect` ([OceanMask.js:674-687](file:///C:/Users/dprit/Raw-Surf/frontend/src/components/map/OceanMask.js#L674-L687)) fully intact to remove all sources and layers synchronously on actual component unmount.
*   **Performance/Resource Cost:**
    *   **GPU Cost:** 0 (MapLibre skips draw calls, shader execution, and layout generation for layers with `visibility: 'none'`).
    *   **Memory Cost:** Extremely low (keeping the ne_110m GeoJSON source parsed in the MapLibre heap consumes ~5-10MB of JS memory, which is negligible).
*   **Design Constraint:** Keep the `lastSyncCoreRef` signature and `styleVersionRef` tracking in place so that a MapLibre style reload (theme switch) still triggers a full rebuild if layers are destroyed.

### 2.2 Cache-Key Tile Match Inconsistency
*   **Audit Verdict:** User's concern confirmed (the bounds-snap `< 0.01` check is a no-op). However, we identified the **real mismatch** causing `exact_key_absent` cache misses.
*   **Forensics & Key Divergence:**
    *   **Store Key:** When GFS/ICON dynamic global coarse grids resolve, `_cacheMarineResult` ([marineControllerCache.js:160](file:///C:/Users/dprit/Raw-Surf/frontend/src/components/map/marineControllerCache.js#L160)) derives the key using the backend response `data.region_id` (which is `"global_coarse"`).  
        *Resulting Store Key:* `GFS_all_global_coarse_0`
    *   **Lookup Key:** During scrubbing/pan checking, `getModelSafeMarine` ([marineController.js:82](file:///C:/Users/dprit/Raw-Surf/frontend/src/components/map/marineController.js#L82)) and `isContainedInMarineCache` ([marineControllerCache.js:317](file:///C:/Users/dprit/Raw-Surf/frontend/src/components/map/marineControllerCache.js#L317)) call `clampViewportBbox`, which returns `'global_marine_coarse'` for global viewports ([backendWeatherServiceClientCoverage.js:223](file:///C:/Users/dprit/Raw-Surf/frontend/src/components/map/backendWeatherServiceClientCoverage.js#L223)).  
        *Resulting Lookup Key:* `GFS_all_global_marine_coarse_0`
    *   **Consequence:** Exact key lookups always fail (`exact_key_absent`). The system is forced to fall back to the O(N) cache containment loop, which succeeds (`hit_fallback`) but wastes cycles and generates false misses.
*   **Correct Fix:** Align the lookup key by changing `selectedTileId` from `'global_marine_coarse'` to `'global_coarse'` in [backendWeatherServiceClientCoverage.js:223](file:///C:/Users/dprit/Raw-Surf/frontend/src/components/map/backendWeatherServiceClientCoverage.js#L223) and update its tests in `backendWeatherServiceClientCoverage.test.js` (lines 75 and 85).

### 2.3 ICON 14-Day Extended-Blend Anchors
*   **Audit Verdict:** User's concern confirmed. Running anchor fetches on an un-abortable fresh signal is unsafe; because `fetchBackendMarineGrid` lacks in-flight promise caching, panning the map during scrubbing would launch new requests with differing bounds. These would pile up un-abortably on the 1-CPU Render box, causing a request storm.
*   **Minimal-Risk Approach:**
    1. Keep the caller's abortable `signal` on the anchor fetches to prevent pan-based request storms.
    2. Implement a private, lightweight `anchorCache` (a `Map` storing in-flight promises and resolved grids) inside [backendWeatherServiceClientHelpers.js](file:///C:/Users/dprit/Raw-Surf/frontend/src/components/map/backendWeatherServiceClientHelpers.js) keyed by `model`, `layer`, and `bboxParam`.
    3. If the user scrubs the timeline without panning (bounds are constant), the static anchor requests hit this cache instantly as a warm hit, generating **zero network requests** after the first step.
    4. If the user pans, the active requests are safely aborted (avoiding accumulation) and restarted on settle.

### 2.4 Scrub-Settle Series-Commit
*   **Audit Verdict:** User's concern confirmed. Committing a global coarse series frame while the viewport is zoomed in results in a blocky, low-resolution heatmap remaining visible indefinitely.
*   **Correct Design Constraints:**
    1. **Scrub Phase:** Committing the series frame during active scrubbing is safe (even if zoomed in) to prevent heatmap blanking during timeline drags.
    2. **Settle Phase:** On settle (`checkScrubSettle`), if the user is zoomed in (`!isZoomedOut`), the client must request the sharp regional grid. To guarantee this, the safety net must check if the rendered frame is a global grid while the viewport is zoomed in:
       ```javascript
       const isViewportZoomedIn = !isZoomedOut;
       const isRenderedGridGlobal = marineData?.grid?.bounds && (
         (marineData.grid.bounds.east - marineData.grid.bounds.west >= 340.0) ||
         marineData.grid.coverage_scope === 'global_coarse'
       );
       const gridMismatch = isViewportZoomedIn && isRenderedGridGlobal;
       const shouldFetch = hourMismatch || noData || gridMismatch;
       ```
       If `gridMismatch` is true, the safety net will trigger a fresh fetch to overwrite the coarse global frame with the sharp regional grid.

---

## 3. Root-Cause Analysis of Open Issues (§3)

### 3.1 Zoomed-Out Timeline Scrub Sluggishness (Impact: High)
*   **Location:** [backendWeatherServiceClientCoverage.js:217](file:///C:/Users/dprit/Raw-Surf/frontend/src/components/map/backendWeatherServiceClientCoverage.js#L217) and [useMarineOrchestrator.js:580](file:///C:/Users/dprit/Raw-Surf/frontend/src/components/map/useMarineOrchestrator.js#L580).
*   **Mechanism:** When the viewport span is wide (`spanLng > 5.0 || spanLat > 5.0`), `clampViewportBbox` overrides the request parameters to a full-global bounding box (`-180,-80,180,85`). This causes every timeline scrub step to fire a per-hour `/grid` request for a global grid. The 1-CPU Render backend gets saturated by these concurrent global gridding requests (especially since ASGI thread pools do not cancel ongoing CPU tasks on client aborts), yielding 504 gateway timeouts.
*   **Fix Constraints:** Deduplicate static anchor fetches via the private cache (Item 2.3) and utilize the client-side multi-hour series cache (`grid_series`) when zoomed out to load the entire timeline in a single request instead of per-hour calls.

### 3.2 Stuck-State Audit under Rapid Swaps (Impact: Low)
*   **Location:** [useMarineDataFetcherCore.js:239](file:///C:/Users/dprit/Raw-Surf/frontend/src/components/map/useMarineDataFetcherCore.js#L239) and [marineInFlightRegistry.js:178](file:///C:/Users/dprit/Raw-Surf/frontend/src/components/map/marineInFlightRegistry.js#L178).
*   **Mechanism:** We audited the in-flight registry, abort/detach gates, and `__MARINE_FETCH_PENDING__` lifecycle. All locks and buffers are properly cleared. Setting `locks.isFetching = false` in `enqueueMarineUpdate` when releasing active fetches, combined with identity-safe `finally` logic, ensures that no deadlocks can occur on aborts. **No stuck state remains.**

### 3.3 WebGL Resident Engine Re-Init Churn (Impact: Medium)
*   **Location:** [WebGLMarineLayer.js:376-429](file:///C:/Users/dprit/Raw-Surf/frontend/src/components/map/WebGLMarineLayer.js#L376-L429) and [WebGLMarineCustomLayer.js:249](file:///C:/Users/dprit/Raw-Surf/frontend/src/components/map/WebGLMarineCustomLayer.js#L249).
*   **Mechanism:** The WebGL engine remains resident in memory during normal map interactions (scrubbing, panning, layer switches) because the initialization `useEffect` depends only on `mapInstance`. However, full disposal and re-initialization (which recompiles all shaders and rebuilds GPU textures) occur on:
  1. Map style/theme changes (which trigger MapLibre to destroy all custom layers via `onRemove`).
  2. Component unmounting and remounting (e.g., when responsive layout swaps unmount the desktop Map container and mount a mobile Map container, changing `mapInstance`).
*   **Fix Constraints:** Compiled shader programs and static VAO buffers can be cached in a registry keyed by the GL context, and the responsive layout should only resize the container rather than remounting the map.

### 3.4 Dev-Build Telemetry Overhead (Impact: Low)
*   **Location:** [index.html:189-202](file:///C:/Users/dprit/Raw-Surf/frontend/public/index.html#L189-L202).
*   **Mechanism:** PostHog session recording is active in production. However, because canvas drawing is done inside WebGL, it doesn't trigger DOM mutations, resulting in a negligible performance cost (~22.49ms over 4.5s of timeline scrubs). Disabling it on localhost is recommended only for clean telemetry/quota hygiene.

---

## 4. Broader Audit Findings (§4)

### 4.1 Weather-Truth Invariants
We audited [commitMarineData](file:///C:/Users/dprit/Raw-Surf/frontend/src/components/map/useMarineDataFetcherHelpers.js#L298), the `requestId`/live-target guards ([useMarineDataFetcherCore.js:316](file:///C:/Users/dprit/Raw-Surf/frontend/src/components/map/useMarineDataFetcherCore.js#L316)), [marineTransitionCoordinator.js](file:///C:/Users/dprit/Raw-Surf/frontend/src/components/map/marineTransitionCoordinator.js), and the [useMarineWindData.js](file:///C:/Users/dprit/Raw-Surf/frontend/src/components/map/useMarineWindData.js) render gate. 
*   **Verdict:** All guards are fully compliant. Stale async responses are correctly discarded. During active transitions, `useMarineWindData.js` returns the held frame but correctly logs the old frame's identity to `markDisplayed`, keeping the infobox locked to "updating" rather than claiming stale data is new. No violations found.

### 4.2 File Length Audit (800-LOC Gate)
No files in `frontend/src/components/map/` exceed the 750 lines threshold:
1.  [GridParserWorker.js](file:///C:/Users/dprit/Raw-Surf/frontend/src/components/map/GridParserWorker.js) — **739 lines** (Safe, but approaching limit).
2.  [useMarineOrchestrator.js](file:///C:/Users/dprit/Raw-Surf/frontend/src/components/map/useMarineOrchestrator.js) — **673 lines**.
3.  [useMarineDataFetcherCore.js](file:///C:/Users/dprit/Raw-Surf/frontend/src/components/map/useMarineDataFetcherCore.js) — **620 lines**.

### 4.3 Backend Viewport Clamping & Performance
*   `viewport_service.py` ([viewport_service.py:138](file:///C:/Users/dprit/Raw-Surf/backend/services/weather_pipeline/viewport_service.py#L138)) correctly clamps global views to `(-180, -80, 180, 85)`.
*   `route_helpers.py` ([route_helpers.py:118](file:///C:/Users/dprit/Raw-Surf/backend/services/weather_pipeline/route_helpers.py#L118)) choose_adaptive_resolution chooses a coarse `15.0` resolution for global views, generating a fast, lightweight 24x11 grid (~264 vectors) to limit CPU load during global queries.

---

## 5. Prioritized Fix Backlog

Recommendations for the next agent (Claude) to implement, categorized by risk.

### High Priority (Critical Fixes)
1.  **Fix Cache Key Inconsistency (Low Risk):**
    *   *Touch point:* [backendWeatherServiceClientCoverage.js:223](file:///C:/Users/dprit/Raw-Surf/frontend/src/components/map/backendWeatherServiceClientCoverage.js#L223) and tests.
    *   *Change:* Change `'global_marine_coarse'` to `'global_coarse'`.
2.  **Fix Zoomed-In Scrub-Settle Regional Recovery (Medium Risk):**
    *   *Touch point:* [useMarineOrchestrator.js:580](file:///C:/Users/dprit/Raw-Surf/frontend/src/components/map/useMarineOrchestrator.js#L580).
    *   *Change:* Treat global rendered grids as a mismatch when zoomed in, triggering a high-resolution regional fetch on settle.
3.  **Deduplicate ICON Extended Anchor Fetches (Medium Risk):**
    *   *Touch point:* [backendWeatherServiceClientHelpers.js:370](file:///C:/Users/dprit/Raw-Surf/frontend/src/components/map/backendWeatherServiceClientHelpers.js#L370).
    *   *Change:* Implement a private in-flight promise cache to prevent duplicate GFS/ICON @168 requests during scrubs, while keeping the caller's abortable signal to prevent pile-up.

### Medium Priority (Optimizations)
4.  **Implement OceanMask Hide-vs-Remove Toggling (Low Risk):**
    *   *Touch point:* [OceanMask.js:610](file:///C:/Users/dprit/Raw-Surf/frontend/src/components/map/OceanMask.js#L610).
    *   *Change:* Toggle `'visibility': 'none' / 'visible'` layout property instead of removing layers and sources from MapLibre.

### Low Priority (Developer Hygiene)
5.  **Gate PostHog on Localhost (Low Risk):**
    *   *Touch point:* [index.html:189](file:///C:/Users/dprit/Raw-Surf/frontend/public/index.html#L189).
    *   *Change:* Conditionally disable session recording when running on `localhost` or `127.0.0.1`.

---

## 6. Not in Scope / Unverified

*   **Production Netlify Deploys:** Netlify deployment outcomes and actual client performance on `https://dev--rawsurf.netlify.app` could not be verified directly.
