# Marine warm-commit containment cluster (#10 + #13 + #11) — forensic map

## Shared containment helpers
| Helper | Location | Semantics |
|---|---|---|
| `bboxContains(outer, inner)` | marineGridSeries.js:638 | 4-side cover, NO antimeridian handling |
| `gridCoversViewport(gb, vb)` | useMarineScrubSettle.js:8 | eps 1e-6, 4-side, no antimeridian |
| `gridCovers(gb, vp)` | WeatherEngine.js:265 | **wind analog** — antimeridian-aware, span>=350 ⇒ true, eps 0.05 |
| `isContainedInMarineCache(...)` | marineControllerCache.js:345 | NOT geometric — tile-key + signature |

## Reference predicates (useMarineOrchestrator.js, layer-switch backend-cache block)
- isViewportZoomedOut :518 `(zoom<=MARINE_ZOOMED_OUT_MAX_ZOOM) || (vpW>15 || vpH>15)`
- isContained :522/:539 `es>=gs && en<=gn && vWest>=gWest && vEast<=gEast`
- isGridWidthRegional :526 `gridWidth < 340`
- regionalValidInPlace :556 `isRegional && isContained && !isViewportZoomedOut`
- commit gate :557 `if (prodId && (!isRegional || regionalValidInPlace))`

## Source 1 — Scrub-cache instant commit (blind when zoomed IN)  [useMarineOrchestratorScrubCache.js]
- commit :168 `setMarineData(cachedBackendData)`
- gate :134 `if (cachedBackendData && .grid && !__staleHour && !rejectRegionalCache)`
- reject :132 `rejectRegionalCache = isViewportZoomedOut && (isRegional || (isGridWidthRegional && !isContained))`
- BUG: isContained computed :120 (against served grid own bounds :106) but only consulted when zoomed OUT. Fix: also reject when `!isViewportZoomedOut && isGridWidthRegional && !isContained`.
- vp available: vpBounds :66-72, currentZoom :87, isContained :120. Kill-switch: NONE (only diag globals).

## Source 2 — handleCooldownFallback (commits on vectors.length alone)  [useMarineDataFetcherHelpers.js]
- commit :314 `setMarineData(cachedData)`
- gate :290 `if (cachedData?.grid?.vectors?.length>0)` → :293 dedup only
- BUG: no containment, no __staleHour, bypasses choke. vpBounds already built :286; served bounds :302. Kill-switch: NONE.

## Source 3 — getMarineSeriesFrame (entry.bounds proven, per-frame bounds unchecked)  [marineGridSeries.js]
- checks :678 & :717 `if (!bboxContains(entry.bounds, bounds)) continue`
- served frame :690 `entry.frames.get(h)` / :718 nearestFrameInEntry → :649
- BUG: containment vs entry-aggregate bounds; served frame's own bounds (frame.grid.bounds) never tested. Width gating on entry only (:687/:729 >=340). Kill-switch: __MARINE_SERIES_DIAG__ counters; feature flag isMarineSeriesEnabled :661.

## Source 4 — reactivate_refeed / initial_onAdd (#11)  [WebGLMarineLayer.js / WebGLMarineCustomLayer.js]
- reactivate_refeed: commit WebGLMarineLayer.js:1187 `safeUploadWaveData('reactivate_refeed',...)`; guard :1184 `if(!engine||!gl||!active||engine._waveData) return` then :1186 `if(cur && cur.vectors?.length>0 && cur.__renderable!==false)`; deps [data,active,revision]. NO bbox check. mapInstance in scope (:1183) ⇒ getBounds(); grid own bounds cur.bounds.
- initial_onAdd: WebGLMarineCustomLayer.js:46 `safeUploadRef.current('initial_onAdd',...)`; guard :43 `if(dataRef.current?.vectors?.length)`; mapRef param (:29) ⇒ getBounds(); data.bounds.
- render() coverage gate WebGLMarineCustomLayer.js:140-256 already computes isContained :183, overlapRatio, isViewportZoomedOut, isGridRegional — but only rejects regional when zoomed OUT (:210), culls on overlapWidth<=0 only (:211/218/222) → partial floating rect at zoomed-in still renders. Kill-switches here: __RAW_DOWNGRADE_COVER_FRAC__ :204, __RAW_DISABLE_ZOOMOUT_REGIONAL_COVER__ :205, __RAW_DISABLE_COARSE_BRIDGE__ :234.

## Source 5 — Non-backend remap lanes (flag-gated, bounds-blind, poison dedup hash)
- Lane A layer-switch remap [useMarineOrchestrator.js]: commit :628 `setMarineData(remapped)`; guard :606 else → :607 model!==EURO → :612 vectors>0. Hash poison :625-626 `marineFetchLocksRef.current.lastHash = vHash`.
- Lane B scrub remap [useMarineOrchestratorScrubCache.js]: commit :242 `setMarineData(data)`; guard :204 else → :206/:225 → :227 → :230 dedup; coverageRejected :215 is TIME-only (>3h), never bbox. Hash poison :240-241.
- Reachable only when backend flags OFF (!isBackendActive). Kill-switch: NONE.

## Shared defect
Every source has viewport + served-grid-own-bounds in scope, but containment is (a) gated behind isViewportZoomedOut so ignored when zoomed IN (S1, render gate behind S4), (b) never computed (S2, S4-upload, S5), or (c) computed vs entry-aggregate not per-frame (S3). None consult a gridCovers-style predicate at the commit point like WeatherEngine.js:265 does for wind.

## Plan (per #10+#13, kill-switch + A/B + zoomlab each)
- Mirror regionalValidInPlace: a REGIONAL grid that does not cover the current viewport may never commit when zoomed IN.
- Prefer fixing at a shared choke if one exists (setMarineData path); else per-source guard with ONE new kill-switch family (e.g. __RAW_DISABLE_MARINE_WARM_COVERAGE__).
- MINEFIELD: rating ON+OFF legs; SETTLED_STEP at z7 hour scrubs is a KNOWN mode-independent content step (control before chasing). zoomlab staircase+scrub+pan_coverage with guard-mode controls.
