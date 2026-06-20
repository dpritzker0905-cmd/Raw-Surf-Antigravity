# Weather Simulation Sync Upgrade — Forensic Audit and Claude Handoff

Date: 2026-06-20  
Repository: `C:\Users\dprit\Raw-Surf`  
Branch/deployment audited: `dev`, commit `46ae013c` (`fix(weather): reconnect timeline scrub rendering`)  
Audit mode: read-only runtime/code audit; no implementation changes made in this audit

## Executive verdict

The weather truth path is currently correct, but the diagnostics/simulation sidecar is doing substantial work that the production renderer does not consume.

The live map reported:

- `GFS / waves`
- Render mode `Marine`
- Raster source `LOADED`
- Provider `OPEN-METEO`
- Class `AUTHORITATIVE NATIVE`
- `No Causal Layer Violations Detected`

At the same time, the GPU/FCE HUD reported 15 FPS, 112 cumulative frames over the marine renderer's 16.6 ms threshold, 100 texture uploads, 26 resident textures, 9.35 MB estimated GPU memory, FBO complete, FCE revision 109, simulation frame 49,357, and a 171-cell marine field. The collapsed React Scan toolbar showed about 30–31 FPS; opening its inspector reduced the observed rate to about 13–15 FPS.

The primary optimization target is not the forecast-direct WebGL upload path. It is the always-running FCE/diagnostics bridge around it:

1. `SimulationLoop.renderCallback` composes a new RenderPlan at display refresh rate.
2. `useRenderPlanBridge` publishes both `renderPlan` and `frameIndex` into React at up to 10 Hz.
3. Those state updates re-render `MapWebGL`, execute `useMapDebugTools`, and pass changing props into `TruthOverlay`.
4. `SimulationHealthMonitor` recomputes integrity/energy/divergence/particle metrics for every RenderPlan.
5. In normal map mode, field evolution is disabled unless `window.__IN_SIMULATION_SANDBOX__ === true`, and FCE wind/marine GPU uploads are disabled unless explicit diagnostic flags are set.

React Scan independently confirmed the same causal path. Its selected memoized component showed cumulative render volume in the thousands and specifically attributed fresh renders to changed `renderPlan` and `simFrameIndex` props.

## Runtime evidence

### Deployment identity

Netlify's Builds page showed the current `dev` branch deploy completed successfully for commit `46ae013c`. The service worker log removed the prior `01fff0b8` caches during activation, consistent with the new deployment taking control.

### GPU/FCE HUD snapshot

| Metric | Observed value |
|---|---:|
| Weather telemetry FPS | 15 FPS while GPU tab/diagnostic inspector activity was present |
| Collapsed floating monitor | approximately 30–31 FPS |
| React Scan inspector open | approximately 13–15 FPS |
| Estimated GPU memory | 9.35 MB |
| Resident textures | 26 |
| Texture uploads | 100 |
| Marine render calls over 16.6 ms | 112 |
| FBO | `FRAMEBUFFER_COMPLETE` |
| FCE field revision | 109 |
| Simulation frame | 49,357 |
| Marine field | 171 cells |
| Wind field | none |

These are point-in-time/cumulative diagnostics, not a controlled benchmark. React Scan and console recording add overhead, so performance acceptance must be measured once with those tools disabled and again with them enabled.

### Supplied/live console-log counts

The 985-line supplied console capture contained:

| Signal | Count |
|---|---:|
| Open-Meteo per-tile protocol callback logs | 332 |
| Forensic Audit lines | 67 |
| Simulation field binds | 46 |
| Simulation health re-baselines | 34 |
| Forecast-direct marine uploads | 21 |
| OceanMask state changes | 21 |
| OceanMask layer sync runs | 19 |
| Map viewport-bound logs | 26 |
| Timeline backend-cache misses | 35 |
| Scrub-settle checks | 10 |
| Explicit abort logs | 6 |
| Fetch-aborted lines | 8 |
| Abort-gate preservation | 1 |
| Layer-switch backend-cache misses | 18 |
| Layer-switch backend-cache hits | 0 |
| WebGL marine early return with no wave data | 1 |

The scrub path is not showing the old one-abort-per-tick flood. Intermediate scrub positions log cache misses while retaining the prior frame; only settled requests fetch. Abort churn still exists between distinct settled intents/model changes, but it is much smaller than the miss count.

## End-to-end data path

```text
MapWeatherControls
  -> timeOffsetHours / active model / active marine layer
  -> useMarineOrchestrator
     -> exact per-model/hour/tile cache lookup
     -> useMarineDataFetcher (150 ms trailing coalescing retained)
     -> marineController.fetchMarineData
     -> backend weather/Copernicus clients
     -> marineControllerCache write
     -> commitMarineData / setMarineData
        -> WebGLMarineLayer -> WebGLMarineEngine (forecast-authoritative render path)
        -> useSimulationField -> SimulationLoop -> RenderPlan/health/diagnostics sidecar
        -> MapForecastOverlay exact-point authority and parity gates
```

The production visual authority is the first branch: `WebGLMarineLayer` directly uploads forecast-authoritative data. `RenderPlanDispatcher` explicitly blocks FCE marine uploads by default. The second branch remains useful for diagnostics and sandbox evolution but currently drives continuous normal-map work.

## Findings

### P0 — RenderPlan/frame state drives avoidable React work

Evidence:

- `SimulationLoop.renderCallback` calls `composeRenderPlan` at display refresh rate and notifies all plan subscribers.
- `composeRenderPlan` allocates a fresh object graph and increments `_planRevision` each call.
- `useRenderPlanBridge` subscribes unconditionally and calls `setRenderPlan` plus `setFrameIndex` at up to 10 Hz.
- `MapWebGL` invokes the bridge with `enabled: true` in all modes.
- `MapWebGL` passes `renderPlan` and `simFrameIndex` to `TruthOverlay` and `useMapDebugTools`.
- Outside the simulation sandbox, `simulationTick` does not evolve fields or particles.
- FCE wind/marine GPU uploads are disabled by default.
- React Scan named `renderPlan` and `simFrameIndex` as changed-prop render causes.

Impact:

- Whole-map React work runs for diagnostic state that is not controlling forecast-direct rendering.
- `useMapDebugTools` rebuilds/writes global diagnostic objects with each bridge update.
- `TruthOverlay` receives changing props even when the active tab does not display them.

Required upgrade:

- In normal forecast-authoritative mode, do not publish per-frame RenderPlans through React state.
- Derive OceanMask activity directly from `activeMarineLayer`/`activeLayers`; it does not require a frame plan.
- Keep the latest plan/frame in refs or an external diagnostic store sampled only when the GPU diagnostics tab is open.
- Enable the React bridge and full simulation plan stream only in the simulation sandbox or an explicit FCE diagnostic mode.
- Do not remove the sandbox capability.

### P0 — Unconditional per-tile logging amplifies main-thread and recording overhead

Evidence:

- `openMeteoProtocol.js:466` logs every protocol callback and full URL.
- The capture contained 332 such lines.
- `WeatherTelemetry.initConsoleInterceptors` wraps every `console.log`, joins all arguments into a string, then pattern-checks the result.
- PostHog's recorder also captured the console stream.

Impact:

- Every tile callback performs console formatting, interception, and recording work.
- Long tile URLs materially inflate captured session data.

Required upgrade:

- Remove the unconditional callback log or guard it behind `window.__RASTER_DEBUG__`.
- Keep one-time protocol initialization and failure logs.
- Make console interception opt-in outside development/diagnostic sessions, or short-circuit before `args.join` when the first argument cannot match a tracked prefix.
- Add counters to telemetry rather than emitting one console line per tile.

### P1 — “Plan Evolution: Active” is false in normal map mode

Evidence:

- `simulationTick` calls `evolveField` only when `window.__IN_SIMULATION_SANDBOX__ === true`.
- `getEvolutionDiagnostics` returns `{ evolved: true }` for any non-null field without checking that gate or an actual evolution tick.
- `TruthOverlay` maps that boolean directly to `Plan Evolution: Active`.

Impact:

- The HUD overstates what the FCE is doing and can send investigators toward the wrong renderer.

Required upgrade:

- Report `disabled_forecast_authoritative`, `sandbox_active`, or an equivalent explicit mode.
- Set `evolved` from actual evolution state/tick count, not field existence.

### P1 — Health monitoring is frame-rate work even when evolution is disabled

Evidence:

- `startHealthMonitor` subscribes globally during engine bootstrap.
- `onPlanReceived` measures integrity, energy drift, wave divergence, particle loss, and jitter for every plan.
- A plan is composed every display frame even in normal forecast-authoritative mode.
- The capture showed 34 health re-baselines and no instability warnings.

Impact:

- Array scans and rolling-window work run continuously while monitoring a field that is not evolving.

Required upgrade:

- In forecast-authoritative mode, sample health at a low cadence (for example 1 Hz) or only on field revision changes.
- Preserve full-rate health checks in the simulation sandbox.
- Separate renderer health (FBO/context/upload validity) from physics-evolution health.

### P1 — Simulation-field dedupe can preserve stale time metadata

Evidence:

- `useSimulationField` includes `timeOffsetHours` in its memo dependencies and diagnostic changed list.
- Its early-return `currentSig` omits `timeOffsetHours`.
- If a new hour produces an identical content hash/signature, the hook returns the previous field object, whose `hourOffset` and `time` remain old.

Current exposure:

- Forecast-direct WebGL rendering is not controlled by this metadata.
- FCE dispatcher validation, diagnostics, and any future enabled FCE upload can become temporally stale.

Required upgrade:

- Include normalized `timeOffsetHours` in the strict field signature, or update temporal metadata through an immutable metadata-only field revision.
- Add a regression test for two hours with identical vector content but distinct requested offsets.

### P1 — Dispatcher domain gates return from the whole dispatcher

Evidence:

- In `dispatchRenderPlan`, when a wind engine/field exists and FCE wind upload is disabled, the function returns before reaching marine dispatch/diagnostic logic.
- The marine disabled gate similarly returns from the entire dispatcher.

Impact:

- One domain's disabled gate can suppress other-domain diagnostics and future work.
- `__FCE_MARINE_BLOCKED__` and marine dispatcher status may be stale when wind is present.

Required upgrade:

- Skip each domain independently; do not return from the entire dispatch function for a disabled wind or marine upload.
- Add mixed wind+marine tests with each gate enabled/disabled independently.

### P1 — Cache misses need reason-level truth before cache expansion

Evidence:

- Timeline exact lookup uses `selectedTileId || 'outside'`.
- Cache writes use `tile_id || region_id || grid.region_id || 'unknown'`.
- A fallback scan can recover only when model/layer/hour, TTL, staleness, bounds containment, and stored signature all match.
- The capture showed 35 timeline misses and no layer-switch cache hits.
- The same ICON +90h position appeared as a miss twice, although the earlier request may not yet have completed; current logs cannot distinguish this.

Required upgrade:

- Do not increase the 50-entry LRU or add speculative prefetch first.
- Add structured miss reasons: `exact_key_absent`, `tile_id_mismatch`, `pending_same_hour`, `expired`, `stale`, `bounds_not_contained`, `signature_mismatch`, and `evicted`.
- Log write key, lookup key, normalized tile id, model/layer/hour, bounds signature, and request generation in one sampled diagnostic event.
- After evidence identifies the dominant miss class, choose key normalization, in-flight reuse, adjacent-hour warming, or capacity changes.

### P2 — Grid-size changes cause legitimate but costly GPU resets

Evidence:

- The log alternates between 629-vector (`37×17`) and 171-vector (`19×9`) fields during model/layer/viewport changes.
- `WebGLMarineEngine` resets particle state textures when bounds or dimensions change.
- It deletes old particle textures before allocation and replaces/deletes resident field textures, so this audit found no demonstrated GPU leak.

Required upgrade:

- Preserve truthful native product grids; do not force one resolution solely to avoid resets.
- Add reset counters with reason (`bounds`, `dimensions`, `both`) and source product id.
- Only optimize after identifying whether resets occur for real product changes or redundant commits.

### P2 — Diagnostic UI is always mounted

Evidence:

- `MapWebGL` renders `TruthOverlay` unconditionally.
- `TruthOverlay` subscribes to WeatherTelemetry even when minimized and receives per-bridge props.

Required upgrade:

- Gate the full HUD behind an explicit diagnostics flag in production.
- When visible, subscribe only the active tab to its required source.
- Keep the compact truth indicator if product requirements need it, but separate it from high-frequency FCE telemetry.

## Things Claude must not regress

1. Keep `MapWeatherControls` as the only writer of `window.isScrubbingTimeline`.
2. Keep the 150 ms trailing debounce and always-coalesce behavior in `useMarineDataFetcher`.
3. Keep forecast-authoritative `WebGLMarineLayer` uploads as production authority.
4. Keep FCE marine uploads disabled by default.
5. Keep WebGL engine residency across layer toggles.
6. Keep OceanMask deactivation debounce and layer-reposition batching.
7. Keep stale-good-frame retention and degenerate-grid scrub suppression.
8. Do not treat the single `_waveData: false` early return during a layer transition as a persistent engine failure; it recovered on the next valid upload.

## Recommended implementation sequence

### Phase 1 — Observability hygiene

1. Gate/remove the per-tile Open-Meteo callback log.
2. Make WeatherTelemetry console interception cheap/opt-in.
3. Add structured cache miss reasons and GPU reset reasons.
4. Correct the HUD evolution mode.

This phase is low risk and improves the quality of every later benchmark.

### Phase 2 — Decouple FCE from React in normal map mode

1. Replace normal-mode `renderPlan`/`frameIndex` React state with refs or a sampled external diagnostics store.
2. Derive OceanMask activation directly from layer state.
3. Stop composing/subscribing to per-frame plans when neither sandbox evolution nor explicit FCE diagnostics is active.
4. Throttle health monitoring by mode.

### Phase 3 — Sync correctness hardening

1. Include time offset in simulation field identity.
2. Make dispatcher gates domain-local.
3. Add mixed-domain and identical-content/different-time tests.

### Phase 4 — Cache optimization based on new evidence

1. Repeat controlled scrub scenarios.
2. Fix the dominant miss reason only.
3. Consider adjacent-hour warming only if the backend response/cache contract supports it without extra request amplification.

## Verification contract

### Automated

- `npx react-scripts build`
- Add unit tests for:
  - no normal-mode React state update from each RenderPlan frame;
  - sandbox mode still receives evolving plans;
  - identical grid content at two offsets produces correct field time metadata;
  - wind upload gate does not suppress marine diagnostics and vice versa;
  - `getEvolutionDiagnostics` reports disabled vs active truthfully;
  - cache miss reason classification and key normalization;
  - protocol callback logging is silent unless raster debug is enabled.

### Controlled runtime benchmark

Run each scenario twice: React Scan/PostHog console capture off, then diagnostics on.

1. Idle GFS waves for 30 seconds.
2. Drag 0h → 320h continuously, then settle once.
3. Perform five distinct settle-and-drag operations.
4. Switch GFS → ICON → EURO and waves → swell 1 → swell 2 → wind waves.
5. Repeat a previously completed model/layer/hour request.

Capture:

- median and 5th-percentile FPS;
- MapWebGL/TruthOverlay React commits;
- RenderPlan compositions and React publications;
- backend requests, aborts, and in-flight reuse;
- cache hit/miss reasons;
- texture uploads and particle resets;
- truth violations and infobox/heatmap hour parity.

Proposed pass criteria:

- No RenderPlan-driven React commits in normal forecast-authoritative mode.
- At most one backend request for one continuous scrub that settles once.
- No intermediate-hour fetch/abort storm.
- A completed repeated model/layer/hour request produces a cache hit or an explicit, justified miss reason.
- No causal truth violations.
- Infobox, committed grid, and requested hour converge after settle.
- Normal-mode HUD says evolution is disabled/forecast-authoritative, not active.
- FBO remains complete and GPU memory does not grow monotonically across repeated identical scenarios.

## Suggested Claude starting prompt

> Read this report and verify every P0/P1 claim against the cited functions before editing. Implement Phases 1–3 only. Preserve all items in “Things Claude must not regress.” Do not change the 150 ms scrub coalescing debounce or engine residency. Add focused tests, run the production build, and provide before/after React commit, request/abort, cache-reason, FPS, and GPU-reset evidence. Leave Phase 4 cache capacity/prefetch decisions pending the new miss-reason telemetry.

