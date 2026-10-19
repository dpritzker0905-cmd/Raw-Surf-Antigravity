# Lane: temporal / async correctness of forecast scrubbing

Baseline: detached worktree `audit-scrub-2026-10-18` = origin/dev `f3ef50fb2` (verified with `git rev-parse HEAD`).
Method: static reading only. No code was run, no tracked file changed, no live backend or dev site touched.
All paths are relative to `frontend/src/components/map/` unless stated.

Severity: High = wrong data shown as correct, or the map wedged until a reload or an unrelated gesture.
Medium = transient wrong or missing data with a recovery path. Low = latent, diagnostic-only or cosmetic.

---

## 0. Pipeline as built (input -> pixels)

| # | Stage | File:line | Async? | Identity checked before acting |
|---|---|---|---|---|
| 1 | Wheel pointer, keyboard, buttons | `ForecastWheel.js:243-292`, `MapWeatherControls.js:508-519, 566-578` | rAF (coast/settle) | none needed (sync); `commit()` dedups on `s.lastCommitted` (`:200-205`) |
| 2 | In-drag commit throttle (90 ms, non-radar) | `ForecastWheel.js:87-99, 265-268` | sync | n/a |
| 3 | `onTimeChange` -> `timeOffsetHours` prop | `MapWeatherControls.js:516` | React render | n/a |
| 4 | Scrub-cache effect: instant commit from per-hour cache / series | `useMarineOrchestratorScrubCache.js:32-240` | sync in effect | reads the CURRENT prop + refs; writes `timeOffsetRef` (`:34`) |
| 5 | Miss while not scrubbing -> `enqueueMarineUpdate('timeline_scrub_deferred')`, 150 ms trailing debounce | `useMarineDataFetcherCore.js:817-824` | setTimeout | reads refs at fire time (latest wins) |
| 6 | Generic dispatch slot (rAF + 1500 ms fallback, 20/300 ms stable delay, map idle) | `useMarineDataFetcherCore.js:830-951` | rAF/timers | reads refs at fire time |
| 7 | `updateMarineGrid` network fetch | `useMarineDataFetcherCore.js:204-805` | fetch + AbortController | **`requestId` (`:450`) + live target model/layer/hour (`:577-580`)** |
| 8 | `commitMarineData` -> `setMarineData` | `useMarineDataFetcherHelpers.js:371-...` | sync | caller-guarded |
| 9 | Scrub-settle net (scrub_end, 150 ms poll, moveend, series_revalidated) | `useMarineScrubSettle.js:270-500, 518-562` | timers | current refs, sync commits |
| 10 | Abort recovery / detached wake / SWR / cooldown retry | `useMarineDataFetcherCore.js:669-720, 727-736` | timers | requestId + model/layer |
| 11 | Engine commit decision (guard chain; arbiter is SHADOW only) | `marineCommitArbiter.js:5-8`, `WebGLMarineEngine.js` | sync | model/layer/flavor, coverage |
| 12 | `WebGLMarineLayer` upload (`engine.setWaveData`), no worker, sync encode | `WebGLMarineLayer.js:140-301` | sync in effect | `marineGridRejection` model/layer (`marineGridValidation.js:4-22`); **no hour check** |
| 13 | Parity record publish + post-upload republish | `marineRenderParity.js:32-145`, `WebGLMarineLayer.js:302` | effect | hour only |
| 14 | Readout label / sr text | `MapWeatherControls.js:331-339, 553`, `forecastReadout.js:47-55` | render | uses `sliderVal` (requested/preview) |
| 15 | "Stale Hour Retained" badge (point card only) | `MapForecastOverlay.js:596-598`, `forecastDiagnostics.js:53-80` | useMemo in render | reads globals |
| W1 | Wind scrub effect (drag: cache-only; else fetch, no abort signal) | `WeatherEngine.js:740-880` | fetch | hour + model (`:877-881`) |
| W2 | Wind primary fetch | `WeatherEngine.js:520-545` | fetch (aborted) | hour (`:540`) + effect cancel |
| W3 | Wind viewport refetch | `WeatherEngine.js:920-990` | fetch (no signal) | model (`:973`) + hour (`:987`) |
| W4 | Wind BASE-FIRST deferred clip | `WeatherEngine.js:195-201` | setTimeout(0) | `lastGoodCoveringRef === world` only (no hour/model) |

No Web Workers or `createImageBitmap` sit on the marine/wind path (only `radarTileRecolor.js` and `openMeteoProtocol.js`). Decode and texture encode run synchronously inside the React effect, so a stale completion cannot arrive at the GPU stage on its own: every stale-data risk is upstream, at `setMarineData` / `setWindData`.

---

## 1. Identity of the latest selection

**There is no single generation token for "the user's latest selection".** Identity is spread across four mechanisms:

- `marineRequestIdRef` (monotonic, bumped only when a network fetch actually dispatches, `useMarineDataFetcherCore.js:450`). It gates the fetch-lane commit (`:577`), lock release (`:738`), abort recovery (`:671`) and the pending-intent replay.
- Live-target compare `fetchIntent.{model,layer,hour}` vs the refs (`:578`). The surf flavor is NOT compared here, but requestId covers it.
- Transition generation (`marineTransitionCoordinator.js:225-256`): bumped on model/LAYER switches only. `beginTransition` is idempotent on {model,layer}, so an hour change never bumps it.
- Wind: per-call snapshot of `reqHour` / `activeModel` compared on arrival (`WeatherEngine.js:254, 472, 540, 878, 973, 987`).

Synchronous cache lanes (scrub cache, settle net, layer-switch instant commit, flavor fast path) do not need a token: they read the current refs in the same tick.

### Per-stage table: can a stale completion (a) commit pixels, (b) change the label/legend/readout, (c) flip loading/error state?

| Stage | (a) pixels | (b) label/readout | (c) loading/error |
|---|---|---|---|
| Fetch lane success/empty (`:577-640`) | No (requestId + target) | No (label = slider) | No |
| Fetch lane **non-abort exception** (`:648-667`) | **Yes: can blank or mark stale (T-03)** | No | **Yes: sets `stale:true` or null** |
| Abort recovery (`:669-715`) | No (requestId, model/layer) | No | No |
| `finally` locks / pending stamp / transition (`:721-747`) | n/a | n/a | No (identity-safe stamp, generation-checked `endTransition`) |
| `consecutiveFailuresRef += 1` (`:622`) | n/a | n/a | after requestId gate: No |
| Detached request completion (registry `complete`) | No (self-caches only) | No | wake re-drive uses current refs |
| Scrub cache / settle / series commits | sync, current refs | No | No |
| Layer-switch coalesced path (`useMarineOrchestrator.js:595-787`) | No (live hour via `resolveCoalesceHour`, live model) | No | No |
| Parity record (`marineRenderParity.js`) | n/a | **badge can lag one transition (T-05)** | n/a |
| Wind W1-W3 | No (hour+model guards) | No | No |
| Wind W4 deferred clip | **Hypothesis: yes, 0 ms window (T-12)** | No | No |
| Autoplay buffering (`hooks/useWeatherState.js:201-245`) | n/a | n/a | its own effect; reset per hour |

---

## 2. Requested vs loaded vs displayed time

Tracked separately, but only in diagnostics:
- REQUESTED: `timeOffsetHours` prop / `timeOffsetRef`; `window.__MARINE_FETCH_PENDING__.hour`.
- LOADED: caches (`_perModelHourCache`, series pages, `WIND_CACHE`).
- DISPLAYED: `lastUploadedGridRef.current.renderedDataHour` / `renderedValidTime` (`WebGLMarineLayer.js:290-301`), published as `__MARINE_RENDER_HOUR_PARITY__` (`marineRenderParity.js:95-100`).

**The visible timestamp comes from the REQUESTED hour, never from the committed frame.** `formatTime()` -> `forecastReadout(sliderVal, ...)` (`MapWeatherControls.js:338`), and `displayedForecastTime` resolves the manifest-snapped valid time of the *selected* hour (`forecastReadout.js:16-31`). The comment "F-07: the DISPLAYED instant" means the snapped instant for the selected hour, not what the GPU holds. `TimelineStatus` uses `currentTimeOffset` (`MapWeatherControls.js:584`), also requested.

So **yes: the label can read hour B while the heatmap shows hour A.** This is by design for every pending fetch (release -> settle ~180 ms -> 150 ms debounce -> network), for misses during a drag (no fetch until release, `useMarineOrchestratorScrubCache.js:225-229`), and for the held world base at another hour (F-21 dim only). The only on-screen signal is the "Stale Hour Retained" text, and it appears only inside the selected-point card (`MapForecastOverlay.js:759-768`), not on the timeline. `window.__RAW_GPU__.staleHour` (`marineStaleHourLayer.js:58`) is telemetry plus an opacity multiplier for a stale WORLD frame, not a label.

Findings: T-05 (badge memo lag), T-06 (parity ignores model/layer), T-09 (offset-keyed caches across the anchor rollover).

---

## 3. Drag coalescing, release, keyboard, touch

- Drag: in-drag commits throttled to 1 per 90 ms per detent crossing (`ForecastWheel.js:262-268`). There is no backlog in the marine lane: during a drag, cache misses do NOT enqueue (`useMarineOrchestratorScrubCache.js:226`, `useMarineDataFetcherCore.js:242, 815`). Wind in-drag is cache-only too (`WeatherEngine.js:746-779`).
- Release: `onPointerUp` -> coast (|v| > 1.2 h/s) or settle. The final commit happens in `finish()` after the settle easing reaches 0.01 h (factor 0.3/frame, about 11 frames, about 180 ms) or after the coast (up to about 1 s). Then a cache hit commits at once; a miss waits the 150 ms debounce plus the network. The documented 200 ms-1.1 s is confirmed.
- `onPointerCancel` is mapped to `onPointerUp` (`:342`), so a browser-claimed gesture (`touchAction: 'pan-y'`, `:345`, a vertical swipe) can COAST the wheel on the last sampled velocity. Not handled: `lostpointercapture`.
- Keyboard and the +/-1h/1d buttons: commit at once on every press (no throttle). The marine lane coalesces through the 150 ms trailing debounce. **The wind lane does not (T-04).**
- Findings: T-01 (unmount/redraw cancels settle: final hour never committed, `isScrubbingTimeline` stuck), T-02 (wind never fetches the final hour after a drag).

---

## 4. Layer/model switch with a future hour pending

- Marine: old-model/layer fetches are detached (not aborted), and their completion is blocked by requestId + target (`:577-580`). The layer-switch coalesced path uses the live hour (`useMarineOrchestrator.js:603`). The model switch waits `SWITCH_FETCH_COALESCE_MS = 350` (`:33`) and then a manual fetch. During that window plus the fetch, the resident old-model frame is HELD (`shouldHoldFrameThroughSwitch`, TTL 2 s, `marineTransitionCoordinator.js:133-160`, and longer under `isTransitionGuard`). The upload gate rejects a mismatched model (`marineGridValidation.js:8`), so old-model data cannot be *uploaded* under the new label. Old-model pixels already on the GPU stay visible under the new model label, and the parity record calls that `parity: true` (T-06).
- The non-abort exception path can blank the new model's frame (T-03).
- Wind vs heatmap: two independent lanes with separate caches, guards and cadences (marine 3-hourly snapping via `frameServesSelectedHour`; wind uses `getSharedValidTime(h,'wind',...)`). There is no joint commit barrier. During any pending period the particles and the heatmap can show different hours (confirmed by structure). After a drag, wind can stay on the old hour indefinitely (T-02).

---

## 5. Caches and keys

| Cache | Key | Run / valid time in key? | File |
|---|---|---|---|
| Engine coarse base (`coarseBaseKey`) | model, layer, cols, rows, bounds, `hourOffset \|\| 0`, flavor | **No run, no valid time, no content hash** | `marineEngineDecisions.js:734-745`; used `WebGLMarineEngine.js:407-418, 549, 2940` |
| Coarse base LRU slot | model, layer, flavor | no | `marineStaleHour.js:129` |
| `_perModelHourCache` (30 min TTL) | `${model}_${layer}_${tile}_${hourOffset}` | **no anchor, no valid time** | `marineControllerCache.js:191, 214`; TTL `marineControllerUtils.js:122` |
| Marine series pages | model, layer, flavor, viewport, page, **anchor tag** | anchor yes (F-01 fixed) | `marineGridSeries.js:190-202` |
| `WIND_CACHE` (10 min fresh TTL) | `${model}_wind_grid_${tile}_${hourOffset}` | **no anchor, no valid time** | `windController.js:162, 263, 334`; TTL `windFineContainment.js:42` |
| In-flight registry | model, rawModel, layer, hour, surf, boundsKey | n/a | `useMarineDataFetcherCore.js:463-465` |

**Verified: the open issue "coarseBaseKey has no run or valid time" is still present at f3ef50fb2** (T-08).

---

## 6. Console noise, TDZ, render loops

- `[rating-band]` console.log is still unconditional (not behind `__MARINE_VERBOSE__`), throttled to one line per 2 s whenever the surf flag is on, from inside the engine render path: `WebGLMarineEngine.js:1584-1595` (T-10).
- TDZ: no live TDZ hazard found by reading. `CanvasAnimationCoordinator.js` and `WebGLWindEngine.js` are deliberately var/function-hoisted. This was not verified at runtime, so it is not certified.
- Render loops: both custom layers call `map.triggerRepaint()` in `finally` every frame (`WebGLMarineCustomLayer.js:405`, `WebGLWindLayer.js:193`), so MapLibre renders continuously while either is active. That is one driver, plus MapLibre's own. A separate rAF loop exists only for Canvas2D particles (`CanvasAnimationCoordinator.js:91, 135, 196`). `TruthOverlay.js:92` runs a setInterval and repaints only under `?diag=1`. No competing marine renderer found. Continuous repaint is a power/CPU cost, not a correctness bug (Low; recorded only).

---

## 7. Findings

### CONFIRMED (code-proven)

**T-01 (High). Unmount or redraw during coast/settle drops the final commit and strands `window.isScrubbingTimeline = true`.**
`ForecastWheel.js:321` cleanup only does `cancelAnimationFrame(s.raf)`; `finish()` (`:216`), which commits the hour and calls `onScrubEnd`, never runs. The same effect re-runs whenever `draw` changes (deps `[draw, s]`; `draw` depends on `max, isRadar, pitch, colors`), so a `maxForecastHours` change (a model switch) or a theme/radar flip mid-coast also kills it. `s.coasting` stays true, so the follow-external-value effect (`:295`) stops following autoplay/model resets until the next pointerdown. The mobile expanded sheet mounts the wheel conditionally (`MapWeatherControls.js:947`), and `renderTimeline` returns null when `!activeLayer` (`:477`).
Consequences of the stuck flag: `updateMarineGrid` and `enqueueMarineUpdate` drop every non-timeline source (`useMarineDataFetcherCore.js:242, 815`), so pan/zoom/moveend fetches stop. Wind moveend is suppressed (`WeatherEngine.js:927, 953`). Autoplay ticks return (`hooks/useWeatherState.js:215`). The scrub-settle net never runs (`useMarineScrubSettle.js:279`). The only writers that clear the flag are the wheel/slider scrub-end handlers (`MapWeatherControls.js:413, 467`), so nothing heals it until the user drags again.
Repro: on mobile, open the sheet, flick the wheel (coast about 1 s), tap the collapse control within the coast, then pan the map. Expected: the final hour commits and pans fetch. Actual (by code): the label holds the last previewed hour, the heatmap holds the last in-drag commit, and pans never fetch.

**T-02 (Medium/High). Wind never fetches the final hour after a drag when that hour was committed in-drag on a cache miss.**
In-drag wind is cache-only and returns on a miss (`WeatherEngine.js:746-779`). On release, `commit()` dedups (`ForecastWheel.js:202`: `s.lastCommitted === t` -> return), so no new `timeOffsetHours` arrives, and the wind effect early-returns on `prevOffsetRef === timeOffsetHours` (`:741`). Wind has no `timeline_scrub_end` listener (the only listeners are marine `useMarineScrubSettle.js:536`; `windSeriesWarm.js:56` listens to scrub START only). Marine is rescued by the settle net; wind is not.
Repro: wind layer, cold series, drag slowly so the last detent crossing is more than 90 ms after the previous commit, then release on that detent. Expected: wind fetches and shows the final hour. Actual: particles stay on the pre-drag or last cached hour until a pan.

**T-03 (Medium). A stale non-abort exception can blank or mark stale the CURRENT display.**
`useMarineDataFetcherCore.js:648-667`: the catch for non-abort errors is gated only on `isCurrentHour` (hour equality) and `!isScrubbingTimeline`. It is NOT gated on `requestId === marineRequestIdRef.current` or model/layer. The `setMarineData` updater then compares the *resident* to the *request's* model/layer; when they differ (a new model is now resident) it returns `null`, which clears the heatmap. Detached requests (model/layer switch, `releaseAbandonedFetch`) keep running, so they do reach this catch. The empty-data branch (`:621-641`) runs after the requestId gate and is safe; this one is not. `fetchMarineData` swallows most network errors into a fallback grid (`marineController.js:617-700`), so the trigger is a thrown exception after dispatch (in the fetch code or in `commitMarineData` itself, which sits inside the try).
Repro (unit): mock `fetchMarineData` for request 1 (GFS/waves/h48) to reject with `new Error('boom')` after request 2 (EURO/waves/h48) has committed. Expected: EURO frame kept. Actual: `setMarineData(null)`.

**T-04 (Medium). The wind lane has no debounce or abort for keyboard, step-button or autoplay hour changes, so the 1-CPU box gets a backlog.**
`WeatherEngine.js:782-880`: every non-drag hour change with a cache miss calls `fetchWindData(bounds, null, ...)` (signal null, `:875`). Superseded results are discarded (`:878`), but the requests still run server-side. Holding ArrowRight (OS autorepeat about 30/s) or clicking +1h repeatedly issues one unabortable `/grid` wind request per hour. The marine lane coalesces the same input through its 150 ms trailing debounce (`useMarineDataFetcherCore.js:817-824`). This contradicts the CLAUDE.md "1-CPU box" caution.

**T-05 (Medium). The "Stale Hour Retained" badge is computed BEFORE the producer runs, so it lags one transition.**
`MapForecastOverlay.js:596-598`: `useMemo(() => computeHeatmapStatus(...), [renderMarineData, activeModel, activeLayer, timeOffsetHours])` evaluates during render. The producer `publishRenderParity` runs later in `WebGLMarineLayer` effects and again after upload (`marineRenderParity.js:13-19, 132-145`). On a scrub to B it reads A's status (often null, so no badge during the stale window). When B lands and republish clears the status, the memo is not recomputed unless `renderMarineData` changes, so a warning can stick. The file's own comment (`marineRenderParity.js:129-131`) documents a variant of this.
Status-name mismatch in the same area: the scrub-cache path writes `retained_previous_hour_warning` (`useMarineOrchestratorScrubCache.js:310-319`), but `publishRenderParity`'s parity-true branch clears only `retained_previous_hour` / `no_*` (`marineRenderParity.js:118-122`), and never clears `rate_limited_cached`. Those statuses persist until another writer clears them.

**T-06 (Medium). The parity record ignores model and layer.**
`marineRenderParity.js:35-38`: `parity = requestedHour === renderedDataHour || uploadedGridServesHour(...)`. `lastSig.activeModel` / `activeMarineLayer` are recorded (`WebGLMarineLayer.js:288-290`) but never compared. During the switch hold, old-model pixels at the same hour read `parity: true`, and `MapForecastOverlay` then allows the selected-point grid fallback (`:164`), sampling the old model's field under the new model's label. The hold's own comment (`marineTransitionCoordinator.js:122-124`) assumes a "displayed-vs-requested identity" gate that compares the full identity. It does not.

**T-07 (Low/Medium). Autoplay outside the exact-GFS-wide case advances blind every 4 s.**
`hooks/useWeatherState.js:234-239`: `setTimeOffsetHours(prev+6)` with no readiness check, so the label advances while the heatmap/wind may still be on an older hour (the wind lane piles up per T-04). Only the GFS + wide view + surf-off branch waits for an exact frame (`:209-231`).

**T-08 (Medium). `coarseBaseKey` has no run id, valid time or content hash (the known issue, still present).**
`marineEngineDecisions.js:734-745`. A new model cycle with the same dims/bounds/hour label maps to the same key, so `WebGLMarineEngine.js:410-417` takes the LRU hit and skips the re-encode. The engine keeps drawing the previous run's world base. `hourOffset` is an anchor-relative label, so the same key also spans valid times across the hourly anchor rollover; `|| 0` folds an undefined hour into hour 0.

**T-09 (Medium). Offset-keyed per-hour caches outlive the anchor rollover.**
`_perModelHourCache` key `${model}_${layer}_${tile}_${hourOffset}` with a 30 min TTL (`marineControllerCache.js:191`, `marineControllerUtils.js:122`), and `WIND_CACHE` `${model}_wind_grid_${tile}_${hourOffset}` with a 10 min TTL. The anchor `Math.round(now/1h)` flips at hh:30 (`backendWeatherServiceClient.js:200-203`). After the flip, offset N names an absolute time one hour later, but a cached entry for N (valid one hour earlier) is served by `getModelSafeMarine` first (`useMarineOrchestratorScrubCache.js:74`) and stamped with the same `hourOffset`, so parity reads true. Series pages were fixed for this (F-01, `marineGridSeries.js:190-202`); these two caches were not. For the 3-hourly marine product the effect shows only when the shift crosses a snap boundary; for hourly wind it is always 1 h.

**T-10 (Low). `[rating-band]` console.log in the engine render path** (`WebGLMarineEngine.js:1584-1595`), not behind a verbose flag.

**T-11 (Low). `describeStaleHour` uses `Date.now() + offset`** (`modelProvenance.js:103-104`) rather than the series anchor, a third clock (the F-07 class), up to 30 min off at the horizon edge.

### HYPOTHESIS (plausible, not proven)

**T-12 (Low).** The wind BASE-FIRST deferred clip (`WeatherEngine.js:195-201`) re-commits `data` after `setTimeout(0)` checking only `lastGoodCoveringRef.current === world`, not the hour or model. An hour change inside that tick whose new commit does not replace `lastGoodCoveringRef` could let the old clip land over the new hour. The window is tiny.

**T-13 (Low).** `getModelSafeMarine` nearest-hour fallback (`marineController.js:401-415`) spreads `{...bestEntry.data}`. If a cached entry lacks `hourOffset`, `commitMarineData` stamps the *requested* hour onto it and onto the shared cached grid (`useMarineDataFetcherHelpers.js:406-407`). A grid up to 6 h away would then read as parity-true. This needs a cache writer that omits `hourOffset`; none was confirmed.

**T-14 (Low).** `onPointerCancel` -> `onPointerUp` -> coast (`ForecastWheel.js:342, 271-277`): a vertical swipe that the browser claims (`touchAction: pan-y`) can throw the wheel to an hour the user never chose. The release-velocity decay limits but does not remove this.

**T-15 (Info).** The commit arbiter is SHADOW-only (`marineCommitArbiter.js:5-8`), so its sequence tests do not certify the shipped guard chain.

---

## 8. Proposed minimal race tests (offline, no live backend)

Jest units (fake timers, mocked `fetchMarineData` / `fetchWindData` with controllable deferreds; drive the hooks via `@testing-library/react` `renderHook`):

1. **R-SEQ marine**: hours 0 -> 48 -> 6 -> 72 -> 18, with the 6 response stalled. Resolve in the order 48, 72, 18, 6. Assert `setMarineData` receives only h18 last, `__MARINE_FETCH_PENDING__` is null at the end, `locks.isFetching` is false, and `__MARINE_RENDER_HOUR_PARITY__ = {requested:18, rendered:18, parity:true}`. Covers requestId plus the live target at `:577-580`. **No existing test drives `updateMarineGrid` with out-of-order resolutions** (the `useMarineDataFetcherCore.*.test.js` files test helpers only: `shouldHealStrandedDebounce`, `claimEnqueueSlot`).
2. **R-SWITCH**: same sequence, switching GFS->EURO after 72 is requested; then reject the stale GFS h72 with `Error('boom')`. Expect the EURO frame kept. Today it fails (T-03).
3. **R-WIND-SEQ**: `WeatherEngine` with keyboard-style hour changes 0->48->6->72->18 (isScrubbingTimeline false), deferreds resolved out of order. Assert only h18 commits AND that at most 1-2 wind fetches are in flight (fails today, T-04).
4. **R-WHEEL-UNMOUNT**: render `ForecastWheel`, pointerdown/move/up with high velocity, unmount before rAF settles. Assert `onCommit(final)` and `onScrubEnd` ran (fails today, T-01). Variant: rerender with a new `max` mid-coast.
5. **R-WIND-DRAG-FINAL**: wheel drag whose last detent commits in-drag, cold wind cache, release. Assert a wind fetch for the final hour within 500 ms (fails today, T-02).
6. **R-BADGE**: render `MapForecastOverlay` + a stub producer; scrub to B with the frame held at A, then land B. Assert the badge appears while A is held and disappears after B (fails today, T-05).
7. **R-PARITY-MODEL**: `publishRenderParity` with `lastSig.activeModel='GFS'`, `activeModel='EURO'`, same hour. Expect `parity:false` (fails today, T-06).
8. **R-ROLLOVER**: `_cacheMarineResult(h=6)` at 12:20, advance the mocked clock to 12:40, call `getModelSafeMarine(h=6)`. Expect a miss or a valid-time mismatch (fails today, T-09). The same for `coarseBaseKey` with two grids that differ only in `run_time` (T-08).

E2E (offline backend + Playwright on the built client, per `scripts/offline-backend/README.md`): add a scenario `scn_race.js` that uses the existing `LAT_SERIES` / `LAT_GRID` latency knobs with per-hour latency (older hours slower), keys 0->48->6->72->18, a layer switch mid-sequence, then reads `__MARINE_RENDER_HOUR_PARITY__`, `__RAW_GPU__.staleHour`, `window.isScrubbingTimeline` and the request log.

### Existing coverage (what is already pinned)

- `ForecastWheel.test.js`: velocity cap, release decay, drag-commit throttle and its wiring, settle target. **No unmount or cancel test.**
- `useMarineOrchestratorScrubCache.timeline.test.js`: scrub-cache instant commits.
- `useMarineOrchestrator.coalesceHour.test.js`: the layer-switch coalesce uses the live hour.
- `marineRenderParity.test.js`, `WebGLMarineLayer.parity.test.js`: the parity record and republish (hour only).
- `marineStaleHour*.test.js`, `marineStaleHourLayer.test.js`, `WebGLMarineCustomLayer.staleHour.test.js`, `staleHour.proof.test.js`, `marineWorldWarmOnSettle.test.js`, `marineGlobalPrewarm.hourAware.test.js`: the world-base wrong-hour rules (F-21/F-22).
- `marinePausedChurn*.test.js`: #267 label-vs-instant.
- `marineTransitionCoordinator.*.test.js`: switch hold, clear hold, strand watchdog.
- `marineCommitArbiter.{differential,sequence}.test.js`: the shadow arbiter only.
- `useMarineScrubSettle.*.test.js`: settle commit stamping, clamp, exact upgrade.
- `forecastReadout.test.js`: readout snapping.
- `e2e/marine-render-continuity.spec.js`: the field keeps drawing through toggles/zoom/pan and a fast burst. It checks continuity, not hour correctness.
- `scripts/offline-backend/scn_home_latency.js`: far scrub then Home under latency, comparing the parity record with the engine. This is the closest existing race scenario, and it is single-sequence.
- Gaps: out-of-order fetch resolution, model switch plus stale error, the wind lane, wheel unmount, badge timing, anchor rollover.
