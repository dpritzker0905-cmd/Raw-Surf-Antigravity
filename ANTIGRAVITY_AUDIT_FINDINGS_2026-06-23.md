# Antigravity Handoff: Weather Simulation & Marine Heatmap Subsystem Audit Findings

**Date:** June 23, 2026  
**Auditor:** Antigravity AI  
**Scope:** Weather simulation / marine heatmap subsystem in `Raw-Surf` (branch: `dev`, HEAD: `42c61128`)  
**Target Delivery:** `ANTIGRAVITY_AUDIT_FINDINGS_2026-06-23.md` in repository root  

---

## 1. Per-Commit Verdicts (§2 Stack & Same-Day Reverts)

We audited the recent commit stack and same-day reverts on `dev`. All verdicts are supported by exact file paths and line numbers.

| Commit Hash | Verdict | Key File & Line Range | Notes / Findings |
| :--- | :--- | :--- | :--- |
| `44409dbd` | **CORRECT** | [index.html:10-27](file:///C:/Users/dprit/Raw-Surf/frontend/public/index.html#L10-L27) | Successfully gates `auto.global.js` React Scan injection to `localhost`, `127.0.0.1`, or `?reactscan=1`. No other codebase files reference `reactScan`. |
| `ac2cf6a0` | **CORRECT** | [useMarineOrchestrator.js:443](file:///C:/Users/dprit/Raw-Surf/frontend/src/components/map/useMarineOrchestrator.js#L443) | Correctly enables cache hits for regional grids (`florida_east_coast`, etc.) when viewport is contained and not zoomed out. |
| `94838c51` | **CORRECT** | [useMarineWindData.js:232-235](file:///C:/Users/dprit/Raw-Surf/frontend/src/components/map/useMarineWindData.js#L232-L235) | Correctly defines `isZoomedOutRegionalReject` to skip held-frame return when regional tiles are rejected on zoom-out. |
| `c09c5131` | **REGRESSION** | [OceanMask.js:313](file:///C:/Users/dprit/Raw-Surf/frontend/src/components/map/OceanMask.js#L313) | **REGRESSION:** The fast path calls `mapInstance.setPaintProperty(MASK_BUFFER, 'fill-color', oceanColorFast)`. However, `MASK_BUFFER` is defined as a `'line'` layer type at [OceanMask.js:391](file:///C:/Users/dprit/Raw-Surf/frontend/src/components/map/OceanMask.js#L391). Line layers do not support `'fill-color'` (they require `'line-color'`). The call fails silently inside a try-catch, leaving the buffer color stale on layer switches. |
| `2795b763` | **CORRECT** | [useMarineRevalidation.js:40-41](file:///C:/Users/dprit/Raw-Surf/frontend/src/hooks/useMarineRevalidation.js#L40-L41) <br> [marineController.js:437](file:///C:/Users/dprit/Raw-Surf/frontend/src/components/map/marineController.js#L437) | Correctly parses `__failureReason` to suppress doomed revalidations for terminal no-coverage errors. |
| `42c61128` | **CORRECT** | [useMarineOrchestrator.js:583-606](file:///C:/Users/dprit/Raw-Surf/frontend/src/components/map/useMarineOrchestrator.js#L583-L606) | Revert of `0c0f9f58` is clean. The code was restored to `94838c51` state, removing the blocky timeline-scrub settle regression. |

### Same-Day Reverts Audit:
*   `105c9161` (Reverting `e89017bb` wind retry) - **Clean.** Left no half-states.
*   `65ab8c55` (Reverting `49104bc5` viewport containment) - **Clean.** Fully restored transition coordinator.
*   `32f38c49` (Reverting `96a69065` EURO retry) - **Clean.** Superseded cleanly by `2795b763`.
*   `9620e0d5` (Reverting `4bbe81c3` backend shield) - **Verified Clean.** The background-task shield was fully removed from [grid_series_helper.py:70-74](file:///C:/Users/dprit/Raw-Surf/backend/services/weather_pipeline/grid_series_helper.py#L70-L74) and [grid_series_helper.py:172-182](file:///C:/Users/dprit/Raw-Surf/backend/services/weather_pipeline/grid_series_helper.py#L172-L182). Tests have been added in `test_grid_series_euro_merge.py` to assert that fast path failure does not trigger native-hour re-grinding.

---

## 2. Root-Cause Analysis of Open Issues (§3)

### Issue 1: Zoomed-out Timeline Scrub Infinite Loop & Sluggishness (Impact: High)
*   **Location:** [backendWeatherServiceClientCoverage.js:217](file:///C:/Users/dprit/Raw-Surf/frontend/src/components/map/backendWeatherServiceClientCoverage.js#L217) and [useMarineOrchestrator.js:571-591](file:///C:/Users/dprit/Raw-Surf/frontend/src/components/map/useMarineOrchestrator.js#L571-L591).
*   **Mechanism:**
    1. For GFS and ICON, when the viewport span is wide (`spanLng > 5.0 || spanLat > 5.0`), `clampViewportBbox` overrides the request parameters to a full-global bounding box (`-180,-80,180,85`).
    2. During active timeline scrubbing, the browser floods the backend with `/grid` requests for this global bbox. Since these are full-global, they bypass the local series cache (which is keyed by snapped regional viewports). Under load, the 1-CPU Render backend yields 504 gateway timeouts or CORS errors (which appear in the browser as CORS/Network failures).
    3. The scrub-settle safety net in `useMarineOrchestrator.js` checks if the rendered frame has settled. Because the `/grid` fetch failed, `fetchMarineData` returns a safe-zero grid (vectors length is 0). 
    4. The safety net checks `noData = !marineData || !marineData.grid?.vectors?.length`. Since the safe-zero grid has 0 vectors, `noData` is `true`. The safety net fires the fetch again on the next cycle, establishing a **doomed infinite fetch loop** that saturates the server permanently.
*   **Design Constraints for Fix:**
    1. **Never commit a coarse grid on settle when zoomed in:** Sharp regional views must be requested on settle if the user is zoomed in.
    2. **Avoid per-hour global fetches if series frame is present:** When zoomed out, the client already has a coarse global time-series frame from the `grid_series` page. This frame is resolution-identical to a `/grid` fetch. The orchestrator should commit this series frame on settle when zoomed out instead of firing a redundant `/grid` query.
    3. **Enforce retry limits on safety net:** The safety net must check for terminal error reasons (e.g. `backend_fetch_failed`, `no_coverage`) and stop retrying after a small limit (e.g. 3 attempts) instead of infinite looping.

### Issue 2: Abort-Storm & Stuck In-Flight Deadlock (Impact: High)
*   **Location:** [useMarineDataFetcherCore.js:214](file:///C:/Users/dprit/Raw-Surf/frontend/src/components/map/useMarineDataFetcherCore.js#L214) and [useMarineDataFetcherCore.js:459](file:///C:/Users/dprit/Raw-Surf/frontend/src/components/map/useMarineDataFetcherCore.js#L459).
*   **Mechanism:**
    1. During a rapid sequence of model/layer swaps, `updateMarineGrid` is called repeatedly.
    2. In one execution, `requestId = ++marineRequestIdRef.current` is incremented to value `N`.
    3. Immediately after, the function checks the rate-limit/cooldown gate:
       ```javascript
       if (getRemainingCooldown('marine') > 0 || isInCooldown('marine')) { ... return; }
       ```
       If rate-limited, it calls `handleCooldownFallback` and returns early. Because of the early return, no new fetch is started, but `marineRequestIdRef.current` remains `N`.
    4. Concurrently, an active fetch (dispatched earlier with ID `N - 1`) completes and runs its `finally` block, comparing:
       ```javascript
       if (requestId === marineRequestIdRef.current) { locks.isFetching = false; ... }
       ```
       Since `N - 1 !== N`, this comparison fails. The cleanup is bypassed, and **`locks.isFetching` remains `true` permanently**.
    5. On all subsequent calls, the same-target check at [useMarineDataFetcherCore.js:162](file:///C:/Users/dprit/Raw-Surf/frontend/src/components/map/useMarineDataFetcherCore.js#L162) sees `locks.isFetching === true` and aborts/returns early, deadlocking the renderer and leaving the heatmap blank.
*   **Design Constraints for Fix:**
    1. Never increment `marineRequestIdRef.current` before passing all early-return checks (e.g., rate-limit and cooldown fallbacks). Bumping the request ID must be the final action immediately before launching the asynchronous task.

### Issue 3: ICON 14-Day Extended Blend Reliability & EURO No Coverage (Impact: Medium)
*   **Location:** [backendWeatherServiceClientHelpers.js:370-374](file:///C:/Users/dprit/Raw-Surf/frontend/src/components/map/backendWeatherServiceClientHelpers.js#L370-L374).
*   **Mechanism:**
    1. `fetchBackendMarineGridIconExtended` blends native ICON and GFS grids. It fires a conjoined `Promise.allSettled` for `[ICON@168, GFS@168, GFS@target]`, passing the caller's `signal`.
    2. During active timeline scrubbing, the caller's signal is aborted. This cancels the static anchor fetches (`ICON@168` and `GFS@168`).
    3. On the next scrubbing step, these static anchors must be re-requested from scratch, preventing them from completing and caching. This causes a cascade of aborts and errors, making the blended timeline unstable.
    4. EURO out-of-coverage (outside Europe) correctly returns clean fast HTTP 404s. `2795b763` correctly prevents SWR from retrying these.
*   **Design Constraints for Fix:**
    1. Static anchor fetches (`ICON@168`, `GFS@168`) do not depend on the user's active scrub offset. They should be fetched using an un-aborted controller so they can complete in the background and write to the cache, providing instant hits for subsequent steps.

### Issue 4: Resident WebGL Engine Re-init Churn (Impact: Medium)
*   **Location:** [WebGLMarineLayer.js:376-429](file:///C:/Users/dprit/Raw-Surf/frontend/src/components/map/WebGLMarineLayer.js#L376-L429) and [WebGLMarineCustomLayer.js:247-250](file:///C:/Users/dprit/Raw-Surf/frontend/src/components/map/WebGLMarineCustomLayer.js#L247-L250).
*   **Mechanism:**
    1. Map style changes (e.g. toggling dark/light theme) cause MapLibre to destroy all custom layers in the style. This calls `customLayer.onRemove(map, gl)`.
    2. `onRemove` calls `engine.dispose(gl)` which sets `engine._initialized = false`.
    3. When the new style is loaded, `handleStyleData` re-adds the custom layer, triggering `onAdd` -> `engine.init()`. Since `_initialized` is false, this recompiles all shaders and rebuilds GPU textures.
    4. Desktop particle resolution is `296` (87,616 crests), while mobile is `192` (36,864 crests). If window width changes across `768px` (e.g. opening DevTools or rotating screen), the resolution is updated on the next style/mount reload.
*   **Design Constraints for Fix:**
    1. Shaders and static VAO buffers can be cached or kept resident across style reloads. Complete disposal in `onRemove` should only occur on actual unmounts of the map component, rather than temporary style changes.

### Issue 5: OceanMask Churn on Layer Toggles (Impact: Low)
*   **Location:** [OceanMask.js:605-615](file:///C:/Users/dprit/Raw-Surf/frontend/src/components/map/OceanMask.js#L605-L615).
*   **Mechanism:**
    1. Toggling between marine and wind layers deactivates `OceanMask`.
    2. The deactivation is debounced by 350ms. If the user stays on the wind layer for more than 350ms, all mask layers and sources are removed from the map.
    3. Switching back to marine requires recreating the source, re-fetching the GeoJSON, parsing features, and re-adding 5 distinct layers. This incurs a ~250ms main-thread cost.
*   **Feasibility / Risk of Hide-vs-Remove (`visibility: none`):**
    *   **Feasibility:** High. Instead of removing sources/layers, we can call `mapInstance.setLayoutProperty(lid, 'visibility', 'none')`.
    *   **Risk:** Low. When `visibility: none` is set, MapLibre ignores layout generation and drawing for these layers, reducing runtime cost to 0. Repositioning base map parks during style loads is still handled. This eliminates all toggling CPU overhead.

### Issue 6: Dev-Build PostHog Overhead (Impact: Low)
*   **Location:** [index.html:189-202](file:///C:/Users/dprit/Raw-Surf/frontend/public/index.html#L189-L202).
*   **Mechanism:**
    1. PostHog session recording initializes unconditionally on all deployed pages. 
    2. rrweb intercepts console logging, network fetches, and DOM mutations on every frame. On a WebGL map page with continuous rendering and timeline scrubbing, this MutationObserver overhead taxes the main thread.
*   **Recommendation:**
    1. Gate PostHog recording or session capture behind localhost: check `location.hostname` and disable session recording on dev/localhost environments unless explicitly opted in via `?posthog_debug=1`.

---

## 3. Code-Quality & Invariant Audit (§4)

### 3.1 Cache Key Inconsistency (Verified)
*   **Location:** [marineControllerCache.js:160](file:///C:/Users/dprit/Raw-Surf/frontend/src/components/map/marineControllerCache.js#L160) vs [marineController.js:82](file:///C:/Users/dprit/Raw-Surf/frontend/src/components/map/marineController.js#L82).
*   **Forensics:**
    1. When caching a fetched grid, `_cacheMarineResult` derives the LRU cache key using:
       ```javascript
       const tileId = data.tile_id || data.region_id || data.grid?.region_id || 'unknown';
       const key = `${model || 'GFS'}_${layerPart}_${tileId}_${hourOffset}`;
       ```
       For dynamic viewports, this resolves to `viewport_west_south_east_north` (e.g. `viewport_-85.00_24.00_-79.00_31.00`).
    2. However, `getModelSafeMarine` attempts to look up exact keys using:
       ```javascript
       const clampRes = clampViewportBbox(bounds, wantedLayer, wanted, 'marine');
       const tileId = clampRes.selectedTileId || 'outside';
       const lookupKey = `${wanted}_${layerPart}_${tileId}_${wantedHour}`;
       ```
       For dynamic viewports, `clampRes.selectedTileId` is `null`, resolving the lookup key to prefix `model_layer_outside_hour`.
    3. Because `viewport_... !== outside`, **exact key lookups always fail for dynamic viewports**.
    4. The system is forced to fall back to the O(N) containment loop:
       ```javascript
       // Fallback search: check if any cached entry in _perModelHourCache contains these bounds
       for (const [key, entry] of _perModelHourCache.entries()) { ... }
       ```
       This containment search succeeds, but it is less efficient and pollutes console telemetry with `exact_key_absent` followed by `hit_contained` warnings.
*   **Recommendation:** Align cache key derivation to use `viewportKey` hashes or consistent tile IDs for both set and get operations.

### 3.2 Weather-Truth Invariants
*   We audited [useMarineDataFetcherHelpers.js:311-314](file:///C:/Users/dprit/Raw-Surf/frontend/src/components/map/useMarineDataFetcherHelpers.js#L311-L314) and [useMarineWindData.js:390-404](file:///C:/Users/dprit/Raw-Surf/frontend/src/components/map/useMarineWindData.js#L390-L404). 
*   The guards successfully ensure that async fetches arriving after a user changes model/layer/hour are rejected. 
*   `useMarineWindData` correctly calls `markDisplayed(lastValidKeyRef.current)` when returning held frames during transitions, ensuring that the infobox display remains locked to "updating" rather than claiming stale data is new.

### 3.3 File Length Audit (800-LOC Gate)
No files in `frontend/src/components/map/` exceed the 750 lines threshold. The largest files are:
1.  [GridParserWorker.js](file:///C:/Users/dprit/Raw-Surf/frontend/src/components/map/GridParserWorker.js) — **739 lines** (Safe, but approaching limit).
2.  [useMarineOrchestrator.js](file:///C:/Users/dprit/Raw-Surf/frontend/src/components/map/useMarineOrchestrator.js) — **673 lines**.
3.  [useMarineDataFetcherCore.js](file:///C:/Users/dprit/Raw-Surf/frontend/src/components/map/useMarineDataFetcherCore.js) — **615 lines**.

---

## 4. Commit History Hygiene (§5)

We inspected the last 40 commits on the `dev` branch.
*   **Reverts Correctness:** All same-day reverts (`105c9161`, `65ab8c55`, `32f38c49`, `9620e0d5`) are clean and fully restored the codebase state. 
*   **Backend Shield Removal:** Checked [grid_series_helper.py](file:///C:/Users/dprit/Raw-Surf/backend/services/weather_pipeline/grid_series_helper.py). The background-task shield was fully reverted, and the test suite has been successfully adjusted.
*   **Prior Handoff Parity:** 
    *   **WebGL Resident Engines:** Active and correct. Components stay mounted.
    *   **Transition Coordinator:** Monotonic generations and displayed state tracking are fully functional.

---

## 5. Prioritized Fix Backlog

Recommendations for the next agent (Claude) to implement, categorized by risk.

### High Priority (Critical Fixes)
1.  **Fix OceanMask Paint Property Regression (Low Risk):**
    *   *Touch point:* [OceanMask.js:313](file:///C:/Users/dprit/Raw-Surf/frontend/src/components/map/OceanMask.js#L313).
    *   *Change:* Set paint property `'line-color'` instead of `'fill-color'` on the `'line'` layer `MASK_BUFFER`.
2.  **Fix Abort-Storm Deadlock (Low Risk):**
    *   *Touch point:* [useMarineDataFetcherCore.js:214](file:///C:/Users/dprit/Raw-Surf/frontend/src/components/map/useMarineDataFetcherCore.js#L214).
    *   *Change:* Defer incrementing `marineRequestIdRef.current` until after passing the cooldown fallback checks.
3.  **Fix Scrub-Settle Safety Net Loop (Medium Risk):**
    *   *Touch point:* [useMarineOrchestrator.js:570-590](file:///C:/Users/dprit/Raw-Surf/frontend/src/components/map/useMarineOrchestrator.js#L570-L590).
    *   *Change:* (a) Ensure a valid series frame is committed on settle when zoomed out. (b) Limit safety-net retries to 3 attempts on failed fetches to prevent infinite loops.

### Medium Priority (Optimizations)
4.  **Resolve Cache Key Inconsistency (Medium Risk):**
    *   *Touch point:* [marineControllerCache.js:160](file:///C:/Users/dprit/Raw-Surf/frontend/src/components/map/marineControllerCache.js#L160) vs [marineController.js:82](file:///C:/Users/dprit/Raw-Surf/frontend/src/components/map/marineController.js#L82).
    *   *Change:* Align cache key write-and-lookup structures so dynamic viewport lookups match exactly without O(N) containment loops.
5.  **Wind/Marine Extended Blend Anchor Fetches (Medium Risk - DO-NOT-TOUCH Fetch Layer):**
    *   *Touch point:* [backendWeatherServiceClientHelpers.js:370-374](file:///C:/Users/dprit/Raw-Surf/frontend/src/components/map/backendWeatherServiceClientHelpers.js#L370-L374).
    *   *Change:* Run anchor fetches using an un-aborted `AbortController` signal so static anchors finish and write to cache even if active timeline scrub gets aborted.
6.  **Implement OceanMask Hide-vs-Remove Toggling (Low Risk):**
    *   *Touch point:* [OceanMask.js:605-615](file:///C:/Users/dprit/Raw-Surf/frontend/src/components/map/OceanMask.js#L605-L615).
    *   *Change:* Toggle `'visibility': 'none' / 'visible'` layout property instead of removing layers and sources from MapLibre.

### Low Priority (Developer Hygiene)
7.  **Gate PostHog on Localhost (Low Risk):**
    *   *Touch point:* [index.html:189](file:///C:/Users/dprit/Raw-Surf/frontend/public/index.html#L189).
    *   *Change:* Conditionally disable session recording when running on `localhost` or `127.0.0.1`.

---

## 6. Not in Scope / Unverified

*   **Upstream Open-Meteo Server Availability:** We could not verify whether Open-Meteo's native endpoint experienced transient rate-limiting during the audit, but the client-side cooldown handling functions as expected.
*   **Production Netlify Deploys:** Netlify deployment outcomes and actual client performance on `https://dev--rawsurf.netlify.app` could not be verified directly, but local production builds compile successfully.
