# Codex Investigation Plan — Marine/Wind Abort Storm

Date: 2026-06-21  
Repository: `C:\Users\dprit\Raw-Surf`  
Branch: `dev`  
Code baseline investigated: `c9256563` (handoff commit), production code through `fff3cd90`  
Deliverable type: investigation and plan only; no runtime code changed

## Verdict

Claude's root-cause hypothesis is confirmed for marine, with two refinements:

1. The current background cache fill does work when it is invoked, but the dominant abort path in `enqueueMarineUpdate` does not invoke it.
2. Even when invoked, it starts a second fetch and aborts the original. It is cache warming, not true in-flight reuse. A rapid A→B→A can still duplicate A if the background fill has not completed.

The safest primary fix is therefore a bounded in-flight intent registry that **detaches the original request instead of aborting and refetching it**, lets `fetchMarineData` finish and self-cache, rejects stale display commits using the existing request/current-target checks, and wakes the final target from cache when a matching detached request completes.

Wind is not part of the marine abort lifecycle. It has separate cache/state and currently receives no AbortSignal. Reports that wind “struggles” during marine storms are consistent with shared main-thread/GPU/React pressure, not a shared fetch lock.

## Existing fixes verified intact

- R22 readiness gate remains in `useMarineOrchestrator.js:150-178`.
- R23 same-target dedup remains in both gates: `useMarineDataFetcher.js:217-224` and `604-615`.
- R24 empty grids are rejected by `_cacheMarineResult` at `marineControllerCache.js:133-143`; SWR behavior remains separate.
- R25 stale-target abort recovery guard remains at `useMarineDataFetcher.js:485-528`; the oversized-grid guard remains in the backend helper.
- R26b keeps ICON's advertised 336-hour window. The fetcher resolves backend ICON past 168h when the backend feature is active.
- The 600 ms switch coalescers and 150 ms scrub coalescer remain intact.
- Generation ownership and displayed/requested parity remain intact in `marineTransitionCoordinator.js` and `MapForecastOverlay.js`.

## Answers to the six investigation questions

### 1. Does `backgroundCacheFill` actually make A→B→A cheaper?

Only sometimes. It is not reliable for the dominant storm.

End-to-end trace:

1. `backgroundCacheFill` is defined at `useMarineDataFetcher.js:118-153`.
2. It creates an independent AbortController, calls `fetchMarineData(...)`, never calls `setMarineData`, and tracks only started/completed counts.
3. `fetchMarineData` checks `_perModelHourCache`, fetches the backend product, calls `_cacheMarineResult` for GFS/EURO/ICON, then returns (`marineController.js:302-429`).
4. R24 prevents empty/non-renderable grids from entering the cache.
5. Therefore a successful background fill really does populate `_perModelHourCache` and is display-safe.

But invocation coverage is incomplete:

- `updateMarineGrid` invokes it before abort at `useMarineDataFetcher.js:235-240` and again through the pre-controller replacement path at `268-271` (the Map dedupes the duplicate invocation).
- The dominant console signature comes from the other gate: `enqueueMarineUpdate` logs `Aborting active fetch ... in enqueueMarineUpdate` at `625-628`. That gate aborts without calling `backgroundCacheFill`.

Even on the covered path it is not reuse:

- It launches a replacement request with a new controller, then aborts the original request.
- Its Map dedupes background fills only; foreground requests do not consult it.
- If the user returns to A before fill A finishes, the foreground A request can start again.
- The four-request cap aborts the oldest fill, and telemetry increments `completed` for both success and failure, so current counters cannot prove cache population.

Conclusion: the fill is functionally correct but structurally incomplete and bandwidth-duplicating. It should be superseded by adoption/detachment of the original promise, not merely added to the missing abort gate.

### 2. Should switches abort at all?

Normal model/layer/hour switches should not abort a viable request. They should detach it under a strict concurrency cap.

Why the existing lifecycle already makes completion weather-truth-safe:

- Backend success is cached inside `fetchMarineData` before control returns to the hook.
- `useMarineDataFetcher.js:392` rejects a response whose `requestId` is no longer current.
- `useMarineDataFetcher.js:393-395` independently rejects a response whose `{raw model, layer, hour}` no longer equals the live refs.
- `finally` clears locks and ends a transition only when the request id is current (`537-547`).
- `endTransition(gen)` refuses stale generations.
- The render path records the actual displayed identity, and the overlay parity gate refuses to relabel it.

Those checks mean an old request can safely finish, write its cache entry, and then be rejected before `commitMarineData`.

One extra guarantee is required for A→B→A: a detached A that becomes desired again must not merely be skipped. Its completion must schedule a cache-backed re-entry for A. Otherwise the matching in-flight request finishes cache-only and the display may remain pending until another trigger.

Recommended ownership point:

- Keep display commit guards at `392-395`; do not move or weaken them.
- Put detach/reuse logic before both current abort sites.
- Let the completing detached request notify the registry; if its key now matches the live target, enqueue one `detached_complete` intent. That call should hit `_perModelHourCache` and pass through the normal current-request commit path.

True cancellation remains correct for:

- hook/component unmount;
- explicit layer deactivation when no consumer remains;
- registry-cap eviction of the oldest detached request;
- an explicit hard cancel/timeout policy.

### 3. What is the smallest safe ICON-extension change?

Do not give anchor requests independent “never abort” controllers. Once normal switching detaches instead of aborts, the caller's signal remains alive and all extension inputs can complete. Separate anchor controllers would outlive true unmount/cap cancellation and create a second ownership system.

Current partial behavior is already better than the handoff implies:

- For 168–240h, an ICON anchor can produce an ICON persistence estimate even when GFS inputs are missing because `extrapolateSubVector` falls back to ICON values.
- For >240h, either GFS or EURO alone is accepted; it throws only when both are empty.

Two small correctness hardenings are recommended:

1. After each `Promise.allSettled`, if `signal.aborted` and there is not enough data to form the estimate, rethrow an `AbortError` rather than converting cancellation into generic “sources unavailable.” This preserves abort truth and avoids misleading safe-zero/error diagnostics.
2. Remove the raw fallback `if (gfsTargetGrid) return gfsTargetGrid` at `backendWeatherServiceClientHelpers.js` in the 168–240h branch. That object is a GFS grid returned through an ICON request and can be cached under an ICON key. Safest behavior is:
   - require the ICON anchor for an ICON persistence/trend product;
   - if the anchor exists but GFS is missing, return an explicitly tagged `icon_persistence` estimate;
   - if the ICON anchor is absent, return/throw a typed non-renderable estimate failure and let bounded SWR retry. Do not cache or display raw GFS as ICON.

For >240h, the GFS/EURO estimate remains valid because it is intentionally constructed as an estimated ICON-extension product and tagged `is_estimated`/`estimated_blend`.

### 4. How many fetches fire for one clean activation?

There are two relevant shapes.

Later activation after the map is mounted:

- activation effect: one immediate `manual` enqueue (`useMarineOrchestrator.js:150-178`);
- layer effect: one `manual` enqueue after 600 ms on cache miss (`606-780`);
- moveend: only if the camera actually changes; delayed 50/900 ms and suppressed during the 1.5-second manual window;
- model effect does not rerun merely because a layer became active if `activeModel` did not change.

Expected result: two enqueue calls, one actual network fetch. The second call is stopped by same-target in-flight dedup, cache hit, or lastHash/valid-data dedup.

Fresh load with a marine layer already active can expose more triggers:

- `mount` or `load`;
- activation `manual`;
- initial model coalescer;
- initial layer coalescer;
- optional real `moveend`.

Expected result: up to four normal enqueue intents (five with a genuine camera move), but still one actual network fetch for a non-empty successful target. Same-frame calls are collapsed by `scheduledRef`; later calls are stopped by same-target/cache/lastHash gates. Different source strings do not bypass the same-target gate.

Exceptions that intentionally exceed one network request:

- R24's bounded retry after an HTTP-200 empty grid;
- a genuine viewport/target change;
- the current abort-storm path for different targets.

The model and layer coalescers use separate timer refs, so they are not one combined switch transaction. They can both fire for the same final target, but R23 prevents a duplicate network request once one is in flight.

### 5. Is wind actually coupled to marine aborts?

No fetch-level coupling was found.

- `WeatherEngine` calls `fetchWindData(..., null, ...)`; it supplies no AbortSignal.
- Effect cleanup sets a local `cancelled` flag, preventing stale React commits while the network request continues.
- `fetchWindData` owns `WIND_CACHE`; it does not use marine fetch locks, `marineRequestIdRef`, or the marine AbortController.
- Wind backend success can therefore complete and cache during a marine storm.

The user can still perceive wind as stalled because both render through the same main thread/map:

- marine grid mapping and texture encoding are synchronous;
- dimension/bounds changes reinitialize marine particle state;
- the shared `MapWebGL` tree and existing FCE/diagnostics bridge generate React/main-thread work;
- React Scan/PostHog/verbose console instrumentation add measurable overhead.

Conclusion: do not merge wind into the abort-storm rework. Benchmark wind presentation latency before/after the marine detach change and the separate simulation/diagnostic optimizations. Treat remaining wind delay as render scheduling/main-thread contention unless wind-specific logs show otherwise.

### 6. Can particle-state resets be avoided?

The reset is already skipped for values-only updates with identical geometry.

`WebGLMarineEngine.js:109-135` resets only when bounds or dimensions change. It deletes both old particle textures before creating replacements, so this audit found allocation churn but no demonstrated leak.

Different product geometries legitimately trigger the reset. The semantic reset (reseed positions for a changed field/bounds) should remain. The allocation can be optimized later because particle textures use fixed `particleRes`, independent of weather-grid dimensions:

- regenerate seed bytes;
- upload them into the existing A/B textures with `texSubImage2D`/the existing update helper;
- allocate only if particle resolution or WebGL context changes.

This is lower priority than abort reuse. Do not normalize all weather grids to one geometry or weaken bounds truth merely to suppress resets.

## Additional finding: ICON far-hour layer cache lookup still remaps to GFS

`useMarineOrchestrator.js:636-643` changes `curModel` from ICON to GFS whenever `timeOffsetHours > 168` during the layer-switch cache lookup. The actual fetcher correctly preserves backend ICON through 336h. This does not remove the capability, but it prevents the layer-switch fast path from looking up the cached ICON extended product and produces avoidable cache misses.

This should be corrected after the in-flight rework, using the same centralized model-resolution rule as `updateMarineGrid`. Do not patch the 887-line orchestrator casually: the repository's LOC gate requires extracting the cache-switch resolver/block into a helper before modifying that file.

## Primary implementation approach

### Add a bounded in-flight intent registry

Create a small helper module, for example:

`frontend/src/components/map/marineInFlightRegistry.js`

Keep `useMarineDataFetcher.js` below the LOC limit by moving registry mechanics into this helper.

Registry key:

```text
rawModel | effectiveModel | layer | hour | boundsKey
```

Entry fields:

```text
key, controller, intent, requestId, state (foreground|detached), startedAt,
wantedAgain, completionStatus
```

Required operations:

- `registerForeground(entry)`
- `find(key)`
- `detach(key, reason)`
- `markWanted(key)`
- `complete(key, status)`
- `remove(key, controller)` (identity-safe)
- `abortOldestDetached()` when the detached cap exceeds four
- `abortAll()` for true unmount

### Modify `useMarineDataFetcher` surgically

1. Capture each newly created controller in a request-local variable; do not rely on `abortControllerRef.current` inside that request's completion cleanup.
2. Register it under its full target/bounds key.
3. At both different-target gates (`217-242` and `604-648`):
   - retain R23 same-target skip;
   - retain high-priority-vs-low-priority suppression;
   - detach the old foreground request instead of aborting it;
   - clear only the foreground lock/ref so the successor can start;
   - cap detached requests at four and abort only the oldest overflow entry.
4. Remove/retire the duplicate-fetch `backgroundCacheFill` path after equivalent telemetry exists in the registry.
5. Before starting a new network request, check the registry:
   - matching foreground: existing R23 behavior;
   - matching detached: mark it wanted again and do not issue a duplicate request;
   - no match: start normally.
6. When a detached request completes:
   - `fetchMarineData` has already written a valid non-empty result to cache;
   - never call `commitMarineData` from the detached completion;
   - if its key matches the current live target/bounds and it was marked wanted, enqueue one `detached_complete` intent to run the normal cache-read/current-owner commit path.
7. Preserve the checks at `392-395` and `537-547` exactly in purpose.
8. On true unmount, abort foreground and all detached controllers.

### Why this is weather-truth-safe

- Detached requests have no direct display callback.
- Cache writes retain the product's true metadata.
- A visible commit still flows through the current `updateMarineGrid` request and its `{model, layer, hour}` guard.
- The transition coordinator still decides which generation may settle.
- `markDisplayed` and `displayMatchesRequested` remain unchanged.
- A detached result for old bounds cannot wake the current display because boundsKey is part of its key.

## Telemetry required before rollout

Extend existing cache/churn diagnostics rather than adding per-event console spam:

- `foreground_started`
- `foreground_same_target_reused`
- `foreground_detached`
- `detached_reused_on_return`
- `detached_cache_completed`
- `detached_failed`
- `detached_aborted_by_cap`
- `detached_aborted_on_unmount`
- `detached_wake_enqueued`
- `network_request_started`

The present `__MARINE_BG_FILL__.completed` counter is ambiguous because failure and abort count as completed. Replace it with success/failure/abort outcomes.

## Risks and regression controls

| Risk | Control |
|---|---|
| Runaway sockets during rapid toggles | Maximum four detached requests; abort oldest overflow |
| Old request commits wrong target | Preserve requestId and live target guards; detached completion never commits directly |
| Old request ends new transition | Preserve captured generation and current-request finally guard |
| A→B→A waits forever | Registry marks A wanted; completion enqueues cache-backed current-target re-entry |
| Duplicate A request while A detached | Registry key lookup before network start |
| Wrong viewport cache reuse | Include boundsKey and retain cache bounds/signature validation |
| Empty HTTP-200 poisons reuse | R24 `_cacheMarineResult` guard remains unchanged |
| Recovery-grid blank returns | Preserve R25 targetChanged and requestId guards |
| ICON capability reduced | Keep 336h window; do not remap/cap the fetch target |
| Exact-point parity weakened | No changes to overlay/coordinator/exact-point paths |
| Hook exceeds 800 LOC | Put registry and key/telemetry helpers in a new module |

## Tests to add

### Pure registry tests

`frontend/src/__tests__/marineInFlightRegistry.test.js`

1. Different target detaches without calling `abort`.
2. Same key returns the existing foreground entry.
3. A→B→A finds detached A and does not register/start a second A.
4. Fifth detached request aborts the oldest only.
5. Completion removal is controller-identity-safe.
6. `abortAll` cancels foreground and detached entries.
7. Bounds-key changes do not reuse a request.

### Fetch lifecycle integration tests

`frontend/src/__tests__/marineDetachLifecycle.test.js`

Use deferred mocked `fetchMarineData` promises.

1. A starts, switch to B: A signal remains live; B starts.
2. A resolves after B starts: A cache write occurs, `setMarineData(A)` does not.
3. B resolves: only B commits and only B's generation settles.
4. A→B→A before A resolves: one A network call total; A completion wakes a cache-backed commit.
5. Old A finally cannot clear B's lock, pending diagnostic, or transition.
6. True unmount aborts both foreground and detached requests.
7. Cap eviction produces AbortError but no recovery-grid display commit.
8. Same-target multi-source activation remains one network request.

### Activation-trigger count tests

`frontend/src/__tests__/marineActivationCoalescing.test.js`

1. Later clean activation: activation + layer timer produce two enqueue attempts and one network fetch.
2. Fresh-load activation: mount/load + activation + model + layer triggers still produce one network fetch.
3. A moveend inside `manualFetchActiveUntil` produces no extra fetch.
4. HTTP-200 empty result is the explicit exception and schedules the bounded R24 retry.

### ICON extension tests

`frontend/src/__tests__/iconExtendedAbortRobustness.test.js`

1. 168–240h with all sources returns an estimated ICON trend product.
2. ICON anchor only returns explicitly tagged ICON persistence, never authoritative.
3. GFS target only does not return/cache a raw GFS object under ICON.
4. >240h accepts GFS-only or EURO-only and remains tagged estimated.
5. Both target sources missing returns typed unavailable/non-renderable behavior.
6. Aborted allSettled inputs propagate AbortError, not generic source-unavailable.
7. Detached caller signal stays live and allows all source fetches to finish.

### Existing parity tests that must remain green

- `marineTransitionCoordinator.test.js`
- `useMarineWindData.transition.test.js`
- `forecastCard.parity.test.js`
- the untracked coordinator/card additions already present in the worktree
- `marineEmptyGridRetry.test.js`
- `marineCacheMissReasons.test.js`
- `marineOversizedGrid.test.js`
- `marineGridSeries.test.js`

## Verification commands for the implementation turn

From `frontend/`:

```powershell
$env:CI='true'; npx craco test --watchAll=false --testPathPattern="marineInFlightRegistry|marineDetachLifecycle|marineActivationCoalescing|iconExtendedAbortRobustness|marineTransitionCoordinator|useMarineWindData.transition|forecastCard.parity|marineEmptyGridRetry|marineCacheMissReasons|marineOversizedGrid|marineGridSeries"
$env:CI='true'; npx craco build
```

Do not deploy-loop. After the user confirms deployment, perform one bundle-version check and one controlled live scenario.

## Live acceptance scenario

After confirming the service-worker bundle hash matches `git rev-parse --short HEAD`:

1. Reset marine cache/churn/in-flight diagnostics.
2. Fresh-load the map on marine waves.
3. Rapidly execute A→B→A across model and layer targets, including ICON at >168h and >240h.
4. Stop on A.

Pass conditions:

- final A commits without another user action;
- displayed `{model, layer, hour}` matches requested parity;
- one A network request, not two;
- abandoned valid requests complete into cache unless evicted by the four-request cap;
- no recovery-grid blank for moved-on targets;
- no raw GFS product cached/displayed as ICON in the 168–240h extension branch;
- transition ends at the final generation;
- wind fetch completion remains independent;
- no browser freeze or >250k marine-grid encode.

## Scope boundaries

Do not combine this change with:

- the FCE/React render-plan optimization;
- console/protocol logging cleanup;
- particle texture allocation reuse;
- exact-point timeout/parity changes;
- cache-size or speculative prefetch changes.

Those are valid separate work, but mixing them would make abort-storm causality and rollback much harder.

