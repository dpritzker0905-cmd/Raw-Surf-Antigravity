# UPGRADE PROGRAM STATUS MATRIX — Agent F

**Scope.** Reconstruct the actual weather/marine upgrade program from the repository's own record and
report where each item **stands at HEAD**, distinguishing a code fact from its runtime consequence.

**Baseline.** `git rev-parse HEAD` → `9f4f85708e765741d51ac2812de5a36373ac514b`, branch `dev`,
`git status --porcelain` → `?? audit/` only. **The briefed HEAD `3d3ccdc2` is HEAD~1** — a docs-only
commit landed on top. This matches packs A1-11 and D1; it corrects the brief, and every claim below is
against `9f4f8570`.

**Method.** Read-only. Repository archaeology (`git log --diff-filter=A`, `git log -S`, `git show`),
static import-graph tracing with `grep`/`Grep`, and two executions of the backend's own pure functions
via `C:/Users/dprit/AppData/Local/Python/bin/python3.exe`. Nothing outside
`audit/weather-simulation-11.0/` was created or modified. No server started, no production API loaded.

**Relationship to the input packs.** A1, A2, B1, B2, D1 and E1 are treated as leads, not authority.
Where I re-ran their check I say so; where my reading **corrects** one, §6 records it.

---

## SECTION 0 — THE PROGRAM IS THREE PROGRAMS, NOT ONE

The seventeen items in the brief do not belong to a single roadmap. Repository archaeology separates
them into three programs with different founders, different fates, and — critically — **different
degrees of abandonment**. Conflating them is how "the FCE is the single source of truth" survived in
three code comments for ten weeks after the FCE stopped feeding a pixel.

| Program | Founding artifact (date) | Domain | Fate at HEAD |
|---|---|---|---|
| **A. The frontend simulation kernel** ("GPU Engine Architecture v2" → "FCE Phase 1–4") | `42435c41` 2026-05-17 · `ddb941d9` 2026-05-16 (`frontend/system-brain/`, 9 governance docs) · `b5fad579` 2026-05-27 · `5c4d9c05` 2026-05-27 | `frontend/src/engine/`, `frontend/src/engine-brain/` | **Superseded 2026-05-31** (`45072247` "v7.6: Forecast-authoritative marine heatmap — disable FCE texture override"), never removed. Boots on every `/map` mount. |
| **B. The backend weather migration** | `6470014e` 2026-06-02 `docs/architecture/weather-backend-migration-roadmap.md` (self-titled "the canonical roadmap and active architecture guide") | `backend/services/weather_pipeline/`, `frontend/src/components/map/backend*ServiceClient.js` | **Partially implemented.** Stages 1–6F recorded complete; Stages 6J–6N (viewport coverage, strict grid/point parity, EURO contract lock, legacy quarantine, regression harness) are the declared remainder and are each partially landed. |
| **C. The forecast-science program** | `aa29cc18` 2026-06-27 (`surf_transform.py`) → `cf2efb48` 2026-07-27 (`surf_point.py`, the geometry extraction) → CLAUDE.md's ONE FORECAST COMPOSITION mandate (2026-07-28) | `backend/services/weather_pipeline/surf_*.py`, the ETOPO/shore-normal assets | **Active, mostly validated, one surface outside the mandated chain.** |

Program A's governance layer (`frontend/system-brain/`, 12 docs) was itself rewritten on 2026-07-05
(`d43eedc1`) to say the quiet part: *"The FCE / SimulationLoop / RenderPlanDispatcher pipeline is
**wind-path only**; it has been DISABLED for marine since ~2026-06-30"*
(`frontend/system-brain/weather-simulation-system.md:8-9`). At HEAD it is not even wind-path: §1.2
shows the wind upload gate is fail-closed too.

---

## SECTION 1 — THE MATRIX

Status vocabulary as briefed. Each entry: **First proposed** | **Intended goal** | **Commits** |
**Current runtime path** | **Status** | **Validation** | **Remaining gate**.

---

### 1.1 · Weather Engine Kernel (fixed-timestep engine bootstrap + init sequencer + render orchestrator)

- **First proposed:** `ddb941d9` 2026-05-16 — `frontend/system-brain/` governance layer, 9 docs including
  `render-loop-governance.md`, `init-order.md`, `engine-boundaries.md`. Kernel v2 shipped `42435c41`
  2026-05-17 ("fixed timestep simulation (16.67ms = 60Hz) decoupled from render").
- **Intended goal:** one deterministic 60 Hz simulation clock, one RAF loop, plugin layers driven from it,
  a hard init gate against the TDZ/"before initialization" crash class.
- **Commits:** `42435c41` (orchestrator v2 + texture pool + tile streaming + RK4), `28926806` 2026-05-16
  (Phase 2 RAF merge + plugin LayerRegistry), `b5fad579`/`5c4d9c05` 2026-05-27 (FCE wiring),
  `5b3476b6` 2026-05-27 (post-FCE hardening).
- **Current runtime path (traced):** `MapWebGL.js:660` → `engine-bootstrap.initEngine` →
  `assertSafeToInitEngine` (`init-sequencer.js:95`) → `bootstrapCoreLayers()` → `initPlugins()` →
  `startPluginRenderLoop()` (`render-orchestrator.js:139`, one RAF) → `startSimulation()` →
  `startDispatcher()` → `startHealthMonitor()`. **The loop runs and renders nothing:**
  `bootstrapCoreLayers` (`LayerRegistry.js:332-343`) registers every layer with `enabled: false`, and
  `setPluginEnabled` (`LayerRegistry.js:281`) — the only way to flip that — **has zero callers repo-wide**
  (`grep -rn "setPluginEnabled" frontend/src` → the definition alone). So `updatePlugins`/`renderPlugins`
  (`LayerRegistry.js:309-320`) iterate a registry in which no entry passes `if (plugin.enabled …)`.
- **Status:** **Active but unvalidated**, and functionally **Superseded** as a renderer — a 60 Hz
  bookkeeping loop whose plugin dispatch is structurally unreachable. The init-sequencer half is
  **Active and validated** (guards a real, 26-commit crash class: `git log -i --grep=TDZ` → 26 commits
  incl. sweeps of 1,045 and 59 violations).
- **Validation:** `frontend/src/__tests__/` carries dispatcher/gate tests; the loop's *no-op* property is
  not asserted anywhere. No test fails if `setPluginEnabled` is deleted.
- **Remaining gate:** decide — enable the plugin path or delete it. It currently costs one always-on
  60 Hz RAF for zero pixels, and it participates in the **zombie-shutdown** defect (§1.1a).

**1.1a · The kernel's live defect — restart is impossible after a `userTier` change (re-verified).**
`MapWebGL.js:685-694` calls `shutdownEngine()` in an effect cleanup whose deps are `[mapInstance, userTier]`
(`:695`). `engine-bootstrap.js:98-107` clears its own `_initialized` flag but **never touches the
sequencer**; `init-sequencer.js:87-89` `markComplete()` leaves `_state = 'complete'` and nothing resets it.
On re-run, `MapWebGL.js:647-656` reads `getInitState()`, sees `'complete'`, sets `didInit = true` and
returns **without calling `initEngine`**. The in-line comment at `:650-653` states the branch exists to
suppress an `[InitSequencer] Engine init blocked. State=complete` error and asserts "Same net behavior
(no re-init)" — true for a bare double-invoke, **false once the cleanup has already run `shutdownEngine`**.
`userTier` is async-derived (`MapPage.js:421` from `AuthContext` `user`, `AuthContext.js:7` `useState(null)`
→ `:70` localStorage → `:170` async `/profiles/{id}`), so a guest→tier transition mid-session is the
trigger. **CONFIRMED as a code fact; the runtime frequency is not measured** (would need a mounted test
with a tier flip). This is D1's D-01, independently re-read at HEAD.

---

### 1.2 · Field Composition Engine (FCE)

- **First proposed:** `b5fad579` 2026-05-27 "FCE Phase 1-3: Physics simulation engine activation" —
  `SimulationField`, `FieldCompositionEngine`, `FieldEvolutionEngine`, `SimulationLoop`; completed by
  `5c4d9c05` 2026-05-27 "Phase 4: RenderPlanDispatcher — wire evolved field to GPU renderers".
- **Intended goal:** one governed path from data → evolved field → GPU. `RenderPlanDispatcher.js:1-20`:
  *"Evolved SimulationField → GPU texture format → WebGLWindEngine.setWindData()"*.
- **Commits (the whole arc):** `b5fad579` → `5c4d9c05` → **`45072247` 2026-05-31 "v7.6:
  Forecast-authoritative marine heatmap — disable FCE texture override"** (its body: the dispatcher
  *"called `_marineEngine.setWaveData()` at ~10Hz with FCE-evolved SimulationField data, overwriting
  forecast-authoritative marine grids from the React pipeline … the heatmap texture was being
  continuously overwritten with FCE-evolved synthetic data"*) → `40d28b9d` 2026-06-20 (decouple the
  diagnostics sidecar from React) → `fd4ac138` 2026-07-03 (orphan engine removal).
- **Current runtime path:** **fully wired, fail-closed, and still executing every frame.**
  `WebGLMarineCustomLayer.js:87` `registerMarineEngine(engine, _gl)` and `WebGLWindLayer.js:39`
  `registerWindEngine(engine, _gl)` are unconditional inside `onAdd`; `engine-bootstrap.js:80`
  `startDispatcher()` is unconditional; `RenderPlanDispatcher.js:270` subscribes, `:279`
  `DISPATCH_INTERVAL = 6`. The only thing between it and the GPU is two window booleans:
  `:447 windUploadEnabled = … window.__ALLOW_FCE_WIND_UPLOAD__ === true` and
  `:470 if (window.__ALLOW_FCE_MARINE_UPLOAD__ !== true) { … return; }`.
  **I searched the whole tree for a production setter and there is none** —
  `grep -rn "__ALLOW_FCE_(MARINE|WIND)_UPLOAD__" frontend/src` returns 6 reads in
  `RenderPlanDispatcher.js`/`SimulationLoop.js` and 4 writes, **all four inside
  `__tests__/dispatcher.domainGates.test.js:74-94`**.
- **Status:** **Superseded (2026-05-31) but not retired — a dormant dual path.** `SimulationLoop.js:53`
  `NORMAL_COMPOSE_INTERVAL = 15` composes at ~4 Hz purely for diagnostics.
- **Validation:** the gates themselves are tested (`dispatcher.domainGates.test.js`). What is *not*
  tested is that no production code sets them.
- **Remaining gate:** delete the upload branches or move the gate from a window boolean to a build
  constant. **New evidence that the dormant path has already rotted:** `RenderPlanDispatcher.js:595`
  falls back to `hydrateGridFromLocalStorage(...)`, defined at `:38-186`, whose first act is
  `localStorage.getItem('rawsurf_marine_cache_v9')` (`:41`). **Nothing in this repository has written
  that key since 2026-06-01** — `8bd8685a` bumped the writer to
  `rawsurf_marine_cache_v10` (`git show 8bd8685a -- .../marineController.js`:
  `-var LS_MARINE_KEY = 'rawsurf_marine_cache_v9'` / `+… 'rawsurf_marine_cache_v10'`), and the live
  writer today is `marineControllerCache.js:24` (`v10`). A repo-wide `git grep rawsurf_marine_cache`
  returns exactly three lines: the `v10` writer, the dispatcher's `v9` read, and one unrelated
  diagnostics string. **So if anyone ever set `__ALLOW_FCE_MARINE_UPLOAD__`, the recovery arm would
  silently return null on a 69-day-stale key.** *(Not previously reported in any pack or report.)*

---

### 1.3 · Unified wind + marine field handling (`SimulationField`)

- **First proposed:** `b5fad579` 2026-05-27. `useSimulationField.js:5-16`: *"Connects the existing
  production data hooks (WeatherEngine, useMarineOrchestrator, usePressureEngine) to the SimulationField
  data model. This hook runs IN PARALLEL with existing rendering. It does NOT replace any rendering path."*
- **Intended goal:** one typed field carrying wind + marine (+ pressure) so downstream consumers stop
  re-deriving per-domain.
- **Commits:** `b5fad579`; hardened `8bd8685a` 2026-06-01, `b2e78952` 2026-07-05 (revision alignment),
  `d7e89335` 2026-07-05 (field/engine no-downgrade parity).
- **Current runtime path:** `MapWebGL.js:295` `useSimulationField({...})` → `SimulationFieldBuilder.buildSimulationField`
  → `MapWebGL.js:318` `useRenderPlanBridge({ field: simulationField, … })` → `bindField` → `SimulationLoop`.
  Its **one** consumer is diagnostics: `useRenderPlanBridge.js:109-114` writes `window.__FCE_LATEST_PLAN__`
  / `__FCE_RENDER_PLAN__` / `__SIM_FRAME__` / `__SIM_EVOLUTION__` as plain assignments, and React
  `setState` runs **only** under `window.__IN_SIMULATION_SANDBOX__ === true || window.__FCE_REACT_PUBLISH__ === true`
  (`:121-126`). The third declared source is dead: `usePressureEngine` has no importer, and
  `MapWebGL.js:118-119` substitutes `useMemo(() => [], [])` for both its outputs.
- **Status:** **Prototype only** (built, bound, consumed by nothing that draws). The real runtime handles
  wind and marine as two independent pipelines with independent caches, guards and hours.
- **Validation:** field-builder unit tests exist; there is **no** test that a wind/marine skew in the
  unified field would be caught, because nothing reads it.
- **Remaining gate:** the FCE decision (§1.2). Until the FCE ships or dies, the unified field is a
  ~4 Hz clone of two typed-array sets that nothing consumes — the `bindField` deep-clone is the
  documented reason `useRenderPlanBridge.js:59-72` skips binding during scrub.

---

### 1.4 · RK4 particle integration

- **First proposed:** `42435c41` 2026-05-17 — *"RK4 (4th-order Runge-Kutta) advection replaces Euler"*.
- **Intended goal:** replace Euler advection with RK4 + bilinear field sampling, zero-allocation update.
- **Commits:** `42435c41`; wired to 60 Hz by `b5fad579` ("SimulationLoop: 60Hz RK4 particle advection
  (6k wind + 3k marine)").
- **Current runtime path — two integrators, neither reaches a pixel:**
  1. **Live but orphaned.** `particle-system.js:113 rk4Advect(...)` used at `:207` by
     `ParticleSystem.update`, driven from `SimulationLoop.js:243-250` every fixed step with
     `WIND_PARTICLE_COUNT = 6000` / `MARINE_PARTICLE_COUNT = 3000` (`:62-63`). Output attached at
     `SimulationLoop.js:295`/`:301` as `renderPlan.*Particles.rk4Particles`. **`grep -rn "rk4Particles"
     frontend/src` returns exactly four hits: those two writes and two reads in
     `SimulationHealthMonitor.js:135,137` — a health metric.** No drawing code reads it.
  2. **Fully dead.** `engine-brain/wind-advection-model.js:94 advectParticleRK4` — one hit tree-wide,
     its own definition.
  The pixels come from GPU ping-pong advection instead: `WebGLWindShaders.js:181,195,198` and
  `WebGLMarineParticleShaders.js:199,211,214`, both **first-order Euler with no elapsed-time term**
  (`nextPos = pos + offset`, offset built from zoom and a speed factor only). I re-ran D1's check:
  no `u_dt`/`u_deltaTime` exists anywhere; `u_time` (`WebGLMarineEngine.js:624`) is bound only to the
  heatmap and draw programs, never to `advectProgram`.
- **Status:** **Abandoned in practice / Documentation ahead of code.** RK4 is real, runs 9,000 particles
  at 60 Hz, and its only consumer is a diagnostic counter.
- **Validation:** `frontend/src/tests/` cover the particle system's math. Nothing asserts the GPU path
  is *not* RK4, and nothing asserts frame-rate independence.
- **Remaining gate:** the brief's own roadmap already names it — Report 11 §13 lists **"dt-normalized
  advection"** at MED risk with *"Kill switch pinning dt=1; ship OFF, flip after A/B"*
  (`MASTER_WEATHER_SIMULATION_REPORT_11.0.md:501`). Not started. Note the inversion this creates:
  **both Canvas2D fallbacks ARE dt-correct** (`GPUMarineLayer.js:432`, `WindParticleOverlay.js:56`,
  fed by `CanvasAnimationCoordinator.js:141`), so the failure renderer is more physically correct than
  the primary.

---

### 1.5 · Single animation ownership

- **First proposed:** `28926806` 2026-05-16 "Phase 2 RAF merge + plugin LayerRegistry (v3.9.7)";
  doctrine in `frontend/system-brain/render-loop-governance.md`. Reasserted by `render-orchestrator.js:12`
  *"ONE single RAF loop (no duplicates)"*.
- **Intended goal:** one RAF, one owner per surface.
- **Commits:** `28926806`; `2cb4e709`/`19b2ec79`/`32e7035e` 2026-07-06..08 (memoize heavy children);
  `9c89701e` 2026-06-19 (keep engines resident across toggles).
- **Current runtime path:** **three persistent loops in the healthy map path, four in fallback.**
  (a) MapLibre's own frame, self-driven by the two custom layers'
  `map.triggerRepaint()` (`WebGLMarineCustomLayer.js:327`, `WebGLWindLayer.js:172`);
  (b) the engine loop `render-orchestrator.js:144` (60 Hz, zero pixels — §1.1);
  (c) **`WeatherTelemetry.initFpsMonitor` (`WeatherTelemetry.js:380-399`) — an uncancellable
  module-scope RAF.** I re-verified all three properties: the loop stores no id, `grep -c
  "cancelAnimationFrame" WeatherTelemetry.js` → **0**, and the class is instantiated at module scope
  (`:549 export const WeatherTelemetry = new WeatherTelemetryEngine();`) with the constructor calling
  `this.initFpsMonitor()` at `:73`. The module is imported by `MapWebGL.js:4` and
  `openMeteoProtocol.js:2`, so it runs on **every screen of the app, forever, after one visit**.
  (d) in fallback only, `CanvasAnimationCoordinator` (`:94-98`), which *is* a correct single-owner
  coordinator with `dt` clamping.
  Transient loops (fade, wheel settle, model transition, raster transactions, tile URLs, marine fetch
  helpers, scrub probe) bring the non-test `requestAnimationFrame(` call count in `frontend/src` to 45
  across 24 files.
- **Status:** **Partially implemented / Regressed.** The doctrine holds *per domain*; it is false globally.
- **Validation:** none — no test counts live RAF loops. This is why (c) survived.
- **Remaining gate:** give `initFpsMonitor` a stored id + `stop()`, and gate it on an active map. One
  ~20-line change; it is the single clearest ownership violation in the tree.

---

### 1.6 · GPU projection authority

- **First proposed:** the roadmap's regression table, `weather-backend-migration-roadmap.md:194`
  ("Florida-only grid stretched" → *"Implement Web Mercator projection in shaders and clip/scale
  coordinate mapping based on `u_dataBounds_min` and `u_dataBounds_max` uniforms"*), 2026-06-02.
  A generic util (`engine-brain/projection-utils.js`) predates it.
- **Intended goal:** one projection contract — MapLibre's matrix, one closed-form lat→Mercator.
- **Commits:** shader-side established with `8dd9abe3` 2026-05-20 (marine engine introduction);
  `b5bbaa7d` 2026-05-27 (world-wrap seam, `u_lng_offset` + 3 world copies below z3.5);
  wrap-cull type fix documented in-line at `WebGLMarineEngine.js:494-510` (2026-07-23).
- **Current runtime path:** both engines multiply the map's own matrix; no `MercatorCoordinate` usage.
  **But the closed-form formula is source-duplicated.** I counted at HEAD: **6 GLSL definitions of
  `float latToMercatorY`** (`WebGLMarineParticleShaders.js:86,402`, `WebGLMarineShaders.js:15,93`,
  `WebGLWindShaders.js:103,421`) + **6 JS copies** (`mapUtils.js:118`, `marineEngineDecisions.js:27`,
  `marineMaskProjection.js:123`, `WebGLMarineMaskRenderer.js:568`, `WebGLWindEngine.js:32`, an inline
  lambda at `WebGLMarineEngine.js:2693`) + a constant in `maskSmoothing.js:18` + **one dead util**
  (`engine-brain/projection-utils.js`, zero non-test importers).
  **One clamp constant has drifted:** `WebGLWindShaders.js:803`
  `float clampedLat = clamp(lat, -85.0511, 85.0511);` — every other copy in the tree uses
  `85.051129`, and the dead util uses a third value `85.05112878`.
- **Status:** **Partially implemented.** The authority (MapLibre's matrix) is single; the *formula* is not.
- **Validation:** shader-parsing tests exist for the rating ramp, not for the projection formula. No
  test cross-checks the twelve copies against each other.
- **Remaining gate:** hoist one GLSL `#define`/one JS export and have the shader builders inject it.
  Report 11 invariant 1 already rates this **Partially Preserved** for the same reason; my count and
  the drift site are the concrete artefacts.

---

### 1.7 · OceanMask

- **First proposed:** `74fa33ef` 2026-05-18 "v83: Add OceanMask coastline clipping for marine layers".
  Re-scoped by `b5fad579` 2026-05-27 ("OceanMask v13: pure static layers, zero MapLibre mutation").
- **Intended goal:** one land/sea authority for the marine surface.
- **Commits:** `74fa33ef` → `b5fad579` → `a82f5852` 2026-06-24 (hide instead of remove on deactivate)
  → `c47f7a81` 2026-07-03 (encoder-level 10 m mask authority) → `caeb440c` 2026-07-12 (flicker debounce)
  → `25fd7c18` 2026-07-21 (heatmap gated to data+mask bounds) → `9deb0ebb` 2026-07-31 (land-bleed probe).
- **Current runtime path:** `OceanMask` is imported at `MapWebGL.js:12` and rendered at `:1001` — it is
  **style-tier only** (five basemap style layers). The GPU marine shader samples a *different* mask
  built by `WebGLMarineMaskRenderer` (`renderMaskToCanvas :515` → `overlayBasemapWaterOnMask :96` →
  `applyInlandWaterGuard :276` → `reassertNeLand :291`), and the **Canvas2D fallback decides land/sea
  from a third authority entirely**: `GPUMarineLayer.js:143 if (typeof cell.isOcean === 'boolean') return cell.isOcean;`.
- **Status:** **Dual-path transition, indefinitely parked.** The name "OceanMask" now denotes one of at
  least three live land/sea deciders; Report 11 invariant 6 counts **five mechanisms over three data
  sources** and rates the "exactly one ocean-mask authority" invariant **Violated (documented division
  of labour)**. I independently confirmed the three named above.
- **Validation:** strong per-mechanism (mask-alignment tests, the land-bleed probe that "refuses to lie",
  order pins). Nothing tests the mechanisms *against each other*, and a fallback activation changes the
  coastline definition, not just the renderer.
- **Remaining gate:** owner decision on whether the fallback's `isOcean` may disagree with the WebGL
  composite. Until then, "OceanMask" should not be cited as the authority in any new code.

---

### 1.8 · Backend field / heatmap migration

- **First proposed:** `6470014e` 2026-06-02 — `weather-backend-migration-roadmap.md`. North star at `:13-15`:
  *"Backend owns weather truth … Frontend owns visualization."* Anti-patterns at `:31-36`.
- **Intended goal:** all fetching, normalization, interpolation and caching on the backend; the frontend
  consumes `/products`, `/grid`, `/point` (+ future `/tile`, `/timeline`) and renders.
- **Commits:** `efcbe3a8` 2026-06-01 (normalizer / Stage 1.5) through Stages 2→6F recorded at
  `weather-backend-migration-roadmap.md:100-119`; `48b97def` 2026-06-20 (`grid_series`);
  `2c9fa5fb`/`f7025fe5` (mid-res tier, estimated-hour mirror).
- **Current runtime path:** the marine heatmap, the wind field, `/spot-ratings`, `/point` and the map
  infobox are backend-owned. **`hooks/useOpenMeteoForecast.js` is backend-owned despite its name**
  (`:153-160` resolve a backend base URL; `:213-234` fetch `/api/weather/...`) — a naming trap worth
  recording. The declared remainder is Stages 6J–6N (`:337-341`); of those:
  - **6K (strict `grid_product_id` point sampling): backend done, frontend never exercises it.**
    `routes/weather.py:164,178,268-279` accept and verify it; `point_resolution.py:237-239` implements
    the strict path. **`git grep "grid_product_id|gridProductId" -- frontend/`** returns only
    `backendCopernicusServiceClient.js` (Copernicus/EURO point only) and one captured fixture — the
    GFS/ICON marine lane never sends it, so the Grid/Point Parity Contract (`:227-234`) is unenforced
    on the majority lane.
  - **6M (legacy quarantine): enforced at runtime, but only in production builds.**
    `index.js:36-53` intercepts `fetch` and blocks `marine-api.open-meteo.com` / `api.open-meteo.com` /
    `/api/weather-proxy` with a synthetic **403** (`:147-157`) — **but only when
    `process.env.NODE_ENV === 'production'` or `window.__WEATHER_FORCE_QUARANTINE__ === true`** (`:49-51`).
    Consequence, and this is load-bearing for this repo: **the local dev frontend — which the brief
    states is the only live surface — does NOT block these**, so a dev session exercises code paths a
    production build would 403.
- **Status:** **Dual-path transition (deliberate).** The roadmap itself says so (`:170-176` "Legacy
  Fallback Audit", "Sunsetting Candidates … once the backend service proves stable across a 30-day
  confidence window").
- **Validation:** strong on the backend contract (schemas, snapping, cache-key uniqueness). The declared
  Frontend and Deployed-E2E gates (`:281-290`) are partially met; the SHA-gated e2e exists.
- **Remaining gate:** (1) send `grid_product_id` from the marine lane or retire the contract; (2) decide
  whether the quarantine should be environment-independent; (3) the 30-day window has long elapsed —
  the sunset decision is owner-gated, not blocked.
- ⚠️ **The roadmap's self-description is stale.** `:3` calls itself *"the canonical roadmap and active
  architecture guide"*, and at HEAD the shipped frontend contradicts two of its six stated anti-patterns:
  `tideClient.js:16` fetches `https://marine-api.open-meteo.com/v1/marine` directly (reachable —
  `MapMarkerLayers.js:14` imports it), and `backendWeatherServiceClientHelpers.js:16,45,64`
  (`blendDirection`/`blendPeriod`/`blendSubVector`) plus `surfRating.js` perform model math client-side.
  This corroborates A1-05. **I add the nuance A1-05 did not measure:** the tide fetch is *blocked in a
  production build* by `index.js:44`, so the violation is real in dev and inert in prod.

---

### 1.9 · Worker offloading

- **First proposed:** `frontend/src/engine/workers/forecast-decode-worker.js` (*"Same logic as
  model-normalizers.js but runs in worker context"*, `:27`) and `useGridWorker`/`GridParserWorker`,
  Program-A era.
- **Intended goal:** move GRIB/grid decode and pressure-extremum search off the main thread.
- **Commits:** part of the Program-A engine tree; the surviving live offload is the `om://` WASM decode
  path (`openMeteoProtocol.js`, mutex ≤3 — `frontend/system-brain/weather-simulation-system.md:135`).
- **Current runtime path:** **the two purpose-built workers are unreachable.**
  `grep -rn "forecast-decode-worker" frontend/src` → **zero importers**.
  `useGridWorker` is imported by exactly one module, `usePressureEngine.js:3`, and `usePressureEngine`
  itself has **no importer** (`MapWebGL.js:118-119` substitutes empty arrays for its outputs). The one
  *live* worker is `hooks/useSessionTracker.js:22` (`gpsWorker`) — not a weather worker.
  Main-thread decode work therefore still runs on the main thread except where the WASM `om://`
  protocol handler does it.
- **Status:** **Prototype only / Abandoned.** (Two workers written, zero on the weather path.)
- **Validation:** none reachable. Report 11 R11-14.3 already asks for a "worker reply-ordering test" —
  for a worker with no consumer.
- **Remaining gate:** delete or wire. `useGridWorker.js:22-25` is at least well-built (module singleton,
  so re-renders cannot spawn workers) — the gate is a consumer, not the worker.

---

### 1.10 · Cache + hydration changes

- **First proposed:** `42435c41` 2026-05-17 (tile-streaming LRU 512 + temporal pyramids + predictive
  prefetch); reworked backend-side from `6470014e` onward.
- **Intended goal:** bounded caches, instant cold-boot hydration from persisted state, no run mixing.
- **Commits:** `42435c41`; `3ea6ef78` 2026-05-31 (persistent cache recovery on startup);
  `8bd8685a` 2026-06-01 (**cache key v9 → v10, "avoid stale 3-var GFS cache poisoning"**);
  `04110e1c` 2026-08-02 (warm the series cache along the zoom axis); `b80f1be2` 2026-07-24 (shared 429
  circuit breaker).
- **Current runtime path:** live caching is `marineControllerCache.js` (`LS_MARINE_KEY = 'rawsurf_marine_cache_v10'`,
  `:24`, hydrated at `:27`), `marineGridSeries.js` (paged SWR), the backend `ProductStore` and
  `ViewportService`. The Program-A `tile-streaming-system.js` has **zero real importers** (one comment
  in `forecast-pipeline.js:7`). The Program-A hydration path is the stale-key defect in §1.2.
- **Status:** **Superseded (Program A) + Partially implemented (Program B).** Three backend caches in the
  serving path are **unbounded**, which B2-07 measured and I did not re-derive:
  `viewport_service.py:60` `NEGATIVE_CACHE` (no `del`/`pop`/`clear` anywhere),
  `store.py:274` `_l2_negative_cache`, `store.py:272` `_download_locks` (one `threading.Lock` per
  filename, never released) — against `store.py:748-755`, which shows the codebase knows how to bound
  a cache when it means to.
- **Validation:** the bounded caches are tested; the unbounded ones are not, and an unbounded cache
  fails silently on a 512 MB box.
- **Remaining gate:** bound the three; fix or delete the `v9` read.

---

### 1.11 · Service-worker caching

- **First proposed:** present since `b8aa692f` 2026-04-15 (initial commit).
- **Intended goal:** offline shell + spot-list caching **without ever caching a weather payload**.
- **Commits:** the exclusion list and the localhost self-unregistration hardened after a documented
  07-12 stale-bundle incident.
- **Current runtime path (re-read at HEAD, corroborating D-13):**
  `frontend/public/service-worker.js:3 const BUILD_VERSION = 'd50cc058';` keys four of five cache names
  (`:4`), `GALLERY_CACHE_NAME` deliberately unversioned (`:7`). Weather is excluded by an early return
  at `:92-104` for `/marine`, `/weather`, `open-meteo.com`, rainviewer, `tiles.`, `tile.`, `maplibre`,
  `.om`. Only `/api/surf-spots`, `/api/surf-spots/search`, `/api/spots-in-bounds` are cached (`:19-23`),
  network-first, success-only (`:116`), with `X-SW-Cache-Fallback: 1` on the stale path (`:143`).
  On localhost, `index.js:319-330` unregisters every SW and deletes all `rawsurf-*` caches.
- **Status:** **Active and validated** — the only item in this matrix that is unambiguously finished.
  A stale-bundle *detector* also ships (`marineForensics.js:87-98`).
- **Validation:** the exclusion list is explicit and the localhost purge is commented with the incident
  it fixed. `BUILD_VERSION 'd50cc058'` is a build stamp — note it does **not** equal HEAD `9f4f8570`,
  i.e. the checked-in stamp is from an earlier build; the deploy pipeline rewrites it.
- **Remaining gate:** none. Do not add a weather route to the cache list.

---

### 1.12 · Model normalization

- **First proposed:** `efcbe3a8` 2026-06-01 (Stage 1.5). Contract table at
  `weather-backend-migration-roadmap.md:70-92`.
- **Intended goal:** one normalization contract — units, ordering, longitude and direction convention
  absorbed once, per-model quirks never leaking downstream.
- **Commits:** `efcbe3a8`; per-fetcher `is_360` detection in `_fetch_common.build_regular_nn`.
- **Current runtime path:** **one sort site, verified** —
  `grep -n "sort(key=lambda v: (v.lat, v.lng))" backend/services/weather_pipeline/*.py` returns exactly
  one line, `normalizer.py:504`. Frontend `engine/data/model-normalizers.js` has **zero real imports**
  (two comment references only) — the second pipeline is dead, which is the good outcome.
- **Status:** **Active and validated** for ordering/longitude. **Partially implemented** for units and
  for the *meaning* of a field:
  - E1-04's finding, which I did not re-measure but did re-locate: `wave_period` carries a **peak**
    period from `noaa_gfs_wave_fetcher.py:49` (PERPW), a **mean** period from `dwd_gwam_fetcher.py:44`
    (tm10) and `copernicus_global_fetcher.py:35` (VTM10), with a silent per-value peak→mean substitution
    at `ecmwf_opendata_fetcher.py:522-525` — all under one tag `units.period = 'seconds'`
    (`schemas.py:178-182`). Both consumers are documented **peak**-period functions.
  - E1-05's finding, which I re-ran: `grep -rn "valueUnit\|displayUnitHint" --include=*.js frontend/src`
    yields assignments only, **zero reads**. The unit is carried honestly and never consulted.
- **Validation:** golden/differential coverage on ordering and the sampler; none on period *statistic*.
- **Remaining gate:** carry the period statistic in the payload (`period_stat: 'peak'|'tm10'`) or convert
  at the fetcher. This is a normalization-contract hole, not a physics bug.

---

### 1.13 · GPU texture residency

- **First proposed:** `42435c41` 2026-05-17 — `gpu-texture-manager.js` NEW, *"Persistent GPU resource
  pool (textures, framebuffers), named texture slots with automatic resize handling, ping-pong buffers,
  full cleanup on context loss."*
- **Intended goal:** one pool, no per-frame texture churn, symmetric teardown.
- **Commits:** `42435c41`; `9c89701e` 2026-06-19 (engines resident across toggles).
- **Current runtime path — the goal is met, by a different implementation, and the proposed one is
  provably never initialized.** The live residency lives inside the marine engine:
  `WebGLMarineTextureEncoder.js:36 updateTexture(gl, tex, data, w, h)` does `texSubImage2D` on the
  resident texture with flipY snapshot/restore, called at `:471-477` for wave/chl/bath/score;
  create-and-delete only on a dims change.
  The **v2 pool is dead in a way no import-count reveals**: `engine-bootstrap.js:57-59` calls
  `bindGPUContext(ctx.gl)` **only `if (ctx.gl)`** — and the sole caller,
  `MapWebGL.js:660-663`, passes `initEngine({ mapInstance, config: { userTier } })` with **no `gl`**.
  So `gpu-texture-manager._gl` stays `null`, every accessor short-circuits (`getTexture` `:53
  if (!_gl) return null;`, `destroyAll` `:198 if (!_gl) return;`), and none of the pool's eight exports
  other than `bindContext`/`destroyAll` has any caller at all. *(A naive "is it imported?" check calls
  this module live; the argument shape is what kills it.)*
- **Status:** **Superseded** (the engine-internal implementation won) with a dead twin still in the boot
  path.
- **Validation:** residency is validated where it is real — Report 11 S-04 records `texSubImage2D` reuse,
  bounded LRUs, `__RAW_GPU__` accounting. The dead pool is validated by nothing and would silently
  return `null` if ever used.
- **Remaining gate:** delete `gpu-texture-manager.js` and its two bootstrap calls, or pass `gl`. Leaving
  it is how a future author "reuses the pool" and gets `null`.

---

### 1.14 · Timeline / tile-scrub optimization

- **First proposed:** `48b97def` 2026-06-20 "marine time-series sync upgrade for instant scrub (Option 1,
  flag-gated)"; scrub arc runbooks from `HANDOFF-2026-07-08-radar-transition-scrub-perf-and-backlog.md`
  onward.
- **Intended goal:** scrub a 14-day timeline without refetch, without texture churn, without React churn.
- **Commits:** `48b97def`; `32e7035e` 2026-07-08 (memoize static `<Map>` children); `5355e65e` 2026-07-21
  (depend on effective hour, not the raw slider); `04110e1c` 2026-08-02 (zoom-axis series warm);
  `c727e305`/`79595367` 2026-08-02 (two wheel-commit defects).
- **Current runtime path:** `marineGridSeries.js` paged SWR (≤48 3-hourly frames per page,
  `MARINE_SERIES_MAX_CONCURRENT=2`), all pages prewarmed on scrub start for GFS/ICON;
  `scrubPerfProbe.js` installs `window.__SCRUB_PROBE__` from `MapWebGL.js:58` with a `bench()` harness.
- **Status:** **Active but unvalidated as a contract.** The optimizations shipped and are measured
  ad-hoc; Report 11 §14 states the intended contract — *"scrub budget via `__SCRUB_PROBE__.bench` with
  `newMarineClears=0`/`newParticleReinits=0` as hard contract"* — as a **gap to add**, not a gate in CI.
- **Validation:** the probe exists and is armed by hand (`__SCRUB_PROBE_ON__`, `MapWebGL.js:772`).
  No CI assertion.
- **Remaining gate:** ⚠️ **a correctness hazard sits inside this optimization and is not a performance
  question.** `window.isScrubbingTimeline` is a bare global written in exactly one component
  (`MapWeatherControls.js:400,412,460,466`) and read as a hard gate at 60+ sites across marine fetch,
  wind fetch, tile URLs, field binding and repaint. `ForecastWheel.js:321` cancels the settle RAF on
  unmount, and `onScrubEnd` fires **only** from `finish()` inside that RAF (`:216`, scheduled `:225`) —
  so unmounting mid-gesture leaves the flag stuck `true`, and nothing anywhere resets it. That one flag
  would produce frozen animation, a stale timeline, missing repaints and "buffer not updating"
  simultaneously. (D1's D-03; I re-read the write sites and the cleanup.) **Close this before tuning
  anything else in the scrub path.**

---

### 1.15 · Higher-resolution coastal data

- **First proposed:** `50c6d8c1` 2026-06-27 (ETOPO depth 0.25°) → `fa86fb53` 2026-06-29 (ETOPO slope
  0.1°, 12,960,128 B) → `b389f3a8` 2026-07-26 (`shore_normals.json`, per-spot normals + break depth).
- **Intended goal:** replace the 0.25° (~28 km) grid's bearing and depth with per-spot resolved geometry.
- **Commits:** those three, plus `5bb49478` 2026-08-09 (241 spots onto 0.25° forcing) and `4d82a13c`
  2026-08-09 (14 atoll spots stop serving offshore Hs).
- **Current runtime path:** the shore-normal + break-depth asset **is live** — `SHORE_NORMAL_ASSET`
  default `"1"` (`routes/admin/surf_forecast.py:142`), used by `resolve_spot_geometry.py` and the
  precedence chain in `surf_point.py`. Break depth reaches `spot_ratings.py:164-165` unconditionally.
- **Status:** **Partially implemented, with one asset shipped-but-gated and one stale precondition.**
  - **The 12.96 MB slope asset has been git-tracked since 2026-06-29 and reaches no serving code**, for
    two independent reasons: `RATING_BREAKER_TYPE` defaults `"0"` (`surf_forecast.py:208`), and even
    if flipped, the only caller is `spot_ratings.py:151-155`.
  - **The written precondition for wiring it is false and has been for 41 days.** I executed
    `bed_slope_at` at HEAD via the local Python: **Pipeline 0.0301 · Mavericks 0.0066 · Nazare 0.0606 ·
    Cocoa 0.0012 · Teahupoo 0.1563 · JBay 0.0052 — non-None 6 of 6.** Meanwhile
    `test_rating_composition_parity.py:142-144` still reads *"Inert everywhere today:
    `bathymetry.bed_slope_at` returns None until the finer slope asset is bundled … Wire it WITH the
    asset, not before"* and `spot_ratings.py:149` still says *"neutral unless the FINER slope asset is
    bundled (`bed_slope_at`→None)"*. This is A1-01, independently reproduced.
- **Validation:** `test_shore_normal.py`, `test_geometry_shore_normal_census.py`, the coverage census
  script. The slope asset is validated by nothing, because nothing calls it.
- **Remaining gate:** the repo's own record already rules on priority — Report 11 `:464` lists **finer
  bathymetry as rejected-and-stays-rejected (0.72% vs 16.83% reach)**. So the gate is not "wire the
  slope asset", it is **"delete the two stale comments so the next agent does not re-derive a false
  blocker"**. The live coastal-data lever is 0.25° tile coverage, which is being worked (`5bb49478`).

---

### 1.16 · Nearshore transformations

- **First proposed:** `aa29cc18` 2026-06-27 "surf_transform physics module — shoaling + depth-limited
  breaking (Option-2 core)"; consolidated by `cf2efb48` 2026-07-27 (geometry extraction) and made
  binding by CLAUDE.md's ONE FORECAST COMPOSITION mandate (2026-07-28).
- **Intended goal:** every surface showing surf height/quality goes through
  `surf_point.resolve_surf_geometry` + `estimate_surf_at` → `surf_rating.compute_surf_rating`.
- **Commits:** `aa29cc18` → `cf2efb48` → the 2026-08-05 height pair (γ→0.81 + `REFRACTION_KR=0.797` +
  H110 ON) → `bd4d67e5` 2026-08-07 (tide η wired at the one producing site) →
  `4d82a13c`/`3eeda053`/`5bb49478` 2026-08-09.
- **Current runtime path:** compliant on the per-spot surfaces (`/api/weather/point`, `/spot-ratings`,
  `/conditions/*`, the alert loop, the weather sim — the sim genuinely delegates both halves,
  `sim_rating.py:30` imports, `:239` height, `:293` quality).
- **Status:** **Partially implemented — one surface is outside the mandated chain, and it is the map.**
  I read the call site myself: `backend/services/weather_pipeline/surf_rating.py:738` is
  `surf, regime = estimate_surf(sp, period, depth, coastal=True, shelf_width_km=width)` — five
  arguments, importing `estimate_surf` directly at `:703`, never `resolve_surf_geometry` /
  `estimate_surf_at`. Four inputs the mandated chain supplies are absent: `swell_from_deg`,
  `shore_normal_deg`, `break_depth_m`, `magnet_factor`. Same shape at `surf_transform.py:790` for the
  `SURF_RATING=0` band. Reached by default (`SURF_RATING`/`SURF_TRANSFORM` both `"1"`,
  `grid_resolver_surf.py:30,86`) from `/api/weather/grid?surf=1` and `/grid_series`.
  E1 measured the divergence at the identical coordinate (band/point height ratio up to **3.037×**,
  rating delta up to **56.9 points, signed both ways**); B2 measured 1.429×–2.125×. I did not re-run
  either probe; I verified the code fact that makes them possible.
- **Validation:** **structurally blind.** `test_rating_composition_parity.py:93-205` enumerates exactly
  three surfaces (`spot_ratings` `:94`, `spot_conditions` `:113`, `sim_rating` `:152`); neither
  `rating_transform_grid` nor `grid_resolver_surf` appears in the file, and E1 ran the suite green
  (21 passed) while the divergence is live. `sim_rating.py:9-11` asserts in prose that *"There are
  exactly three surfaces that compose a rating"* — false at HEAD; the band is a fourth.
- **Remaining gate:** **this is the single highest-value open item in the whole program.** Either route
  the band through `estimate_surf_at` per cell (cost: geometry resolution per grid cell) or make the
  parity test enumerate it and accept a declared, measured delta. Note the queue's live entry
  ("the band and the glyph are two populations") reaches the same conclusion from the opposite
  direction and names **per-cell composition** as the cause — consistent with this being the mechanism.

---

### 1.17 · AI-assisted forecast correction

- **First proposed:** `docs/research/QUEUE-2026-08-03-the-learned-nearshore-transform.md`
  (*"Status: RESEARCH BRIEF, nothing built. Queued 2026-08-03 at the owner's request."*), preceded by
  `3138db1b` 2026-07-30 "the height quantile map — fitted, measured, and refused by its own instrument".
- **Intended goal:** two distinct things, and the record keeps them separate — (a) an EQM quantile map
  correcting the offshore height input's compression; (b) a per-spot learned nearshore transform trained
  on ERA5 + instruments.
- **Commits:** `3138db1b` (`height_quantile_map.py` + `scripts/fit_quantile_map.py`); nothing for (b).
- **Current runtime path:** **none.** `apply_height_quantile_map` (`height_quantile_map.py:120`) has no
  serving caller — `git grep "HEIGHT_QUANTILE_MAP|apply_height_quantile_map" backend/` returns six lines,
  of which **the only `HEIGHT_QUANTILE_MAP` mentions are inside docstrings** (`fit_quantile_map.py:7,132`,
  `height_quantile_map.py:17`). The flag does not exist in code, so a docstring-only match is exactly the
  trap the brief warns about; I checked for the `os.environ.get` and there is none.
- **Status:** **(a) Prototype only, refused by its own gate. (b) Design only.** `fit_quantile_map.py:69`
  prints `NO-GO` when no band satisfies both `MIN_ROWS_TO_FIT` and `MIN_BUOYS_TO_FIT`, `:115` prints
  `VERDICT: NO-GO for a global map`, and `:120` `raise SystemExit("refusing --upload on a NO-GO verdict")`
  — **the fitter refuses to ship itself.** Report 11 `:464` records both as rejected for now:
  *"learned transform (labels accrue at 0.00/day), quantile map (its own fitter says NO-GO)"*.
- **Validation:** `test_height_quantile_map.py` covers fit/apply/refusal. There is no skill number to
  validate a correction against: E1-12's inventory shows the **only measured accuracy figure is
  OFFSHORE height MAE p50 0.198 m over n=37 runs** (`forecast_accuracy_monitor.py:10-16`), the breaking
  height is validated by nothing, and the skill-vs-persistence gate is deliberately unarmed until ~08-22.
- **Remaining gate:** exactly what Report 11 Phase 6 says — *"only after the ledger matures"*, reliability
  diagram/Brier for the categorical rating first. **Correctly sequenced; do not accelerate.**

---

## SECTION 2 — (a) WHERE ARE WE IN THE INTENDED UPGRADE PROCESS RIGHT NOW?

**One sentence:** the frontend simulation-kernel program (A) was **abandoned in place on 2026-05-31 and
never dismantled**, so its scaffolding still boots on every map mount; the backend migration (B) is
**~two-thirds through its own declared stage list and stalled on frontend-side contract adoption, not on
backend capability**; and the forecast-science program (C) is **the only one still advancing**, with one
surface (the map band) still outside the rule that governs it.

**Long form, with the evidence that fixes each position:**

**1. Program A is a graveyard that still runs.** Its supersession is dated and documented (`45072247`,
2026-05-31) and its own governance doc admits it (`weather-simulation-system.md:8-9`). But nothing was
removed. At HEAD the following are reachable-but-consumed-by-nothing, each verified by import-graph
trace: `FieldCompositionEngine` (composes for diagnostics), `FieldEvolutionEngine`, `SimulationField`,
`particle-system` RK4 (9,000 particles at 60 Hz → one health counter), `render-orchestrator`
(60 Hz → a registry where no plugin is enabled), `gpu-texture-manager` (never receives a `gl`),
`RenderPlanDispatcher` (fail-closed, with a 69-day-stale localStorage key behind the gate). And the
following have **zero non-test importers at all**: `FieldInterpolator.js`, `IndustryPluginRuntime.js`,
`render-pipeline.js`, `tile-streaming-system.js`, `engine/data/model-normalizers.js`,
`engine/workers/forecast-decode-worker.js`, `engine/queries/spot-hub-query.js`,
`engine/sessions/surf-intelligence.js`, `engine/surf-intelligence-fusion.js`,
`engine/layer-plugins/*` (3 files), `engine/layer-renderers/webgl-layer.js`, and **all 11
`engine-brain/*` models** (4 have importers, but every importer is itself unreachable).
**That is 24+ modules.** The cost is not disk: it is that three in-code comments still call the FCE the
single source of truth, and every audit in the series has had to re-derive that they are wrong.

**2. Program B's blocker is on the frontend, not the backend.** Stage 6J (dynamic viewport/global
coverage) and 6K (strict `grid_product_id`) are implemented server-side — `routes/weather.py:164,268-279`,
`point_resolution.py:237-239`, `dynamic_index.py` — and the marine lane **never sends the parameter**.
Stage 6M (quarantine) is implemented but environment-conditional (`index.js:49-51`), which means the
one live surface (local dev frontend) is the one where it does not apply. Stage 6N's regression harness
exists in fragments (SHA-gated e2e, LOC/encoding ratchets, flag-lane parity) but the roadmap's own
Frontend Verification Gates (`:281-286`) — scrub signature invalidation, infobox sync, WebGL bounds
alignment — are not CI gates.

**3. Program C is where the work is, and it has one unfinished edge.** The chain is real, singular and
execution-verified on the per-spot surfaces. The map band is the exception (`surf_rating.py:738`) and
the guard that should see it enumerates three surfaces and misses the fourth
(`test_rating_composition_parity.py:93-205`). Everything else in C is either shipped-and-measured (the
height pair, the coastal-from-land-bit promotions) or correctly parked behind a measured reach argument
(γ thread 0.145%, finer bathymetry 0.72%, quantile map NO-GO, learned transform 0.00 labels/day).

**4. The programs' *instruments* are younger than the code they grade.** The skill ledger fix, the
accuracy monitor and the persistence baseline all landed within ~30 h of Report 11. Until their clocks
mature (skill-MAE gate ~08-22, ledger `scored>0` recovery), **no accuracy claim about any of these
seventeen items can be validated by measurement** — which is why fourteen of them are rated on
structure, not on outcome.

### 2.1 · The auditable checklist (no percentages without one)

Seventeen items × one status. Counted, not estimated.

| # | Item | Status |
|---|---|---|
| 1 | Weather Engine Kernel | Active but unvalidated (renderer half Superseded) |
| 2 | Field Composition Engine | **Superseded** (dormant dual path, fail-closed) |
| 3 | Unified wind+marine field | **Prototype only** |
| 4 | RK4 particle integration | **Abandoned** in the render path / Documentation ahead of code |
| 5 | Single animation ownership | **Partially implemented** (3 persistent loops; 1 uncancellable) |
| 6 | GPU projection authority | **Partially implemented** (12 formula copies, 1 clamp drift) |
| 7 | OceanMask | **Dual-path transition** (≥3 land/sea deciders) |
| 8 | Backend field/heatmap migration | **Dual-path transition** (Stages 6J–6N partial) |
| 9 | Worker offloading | **Prototype only / Abandoned** (0 weather workers live) |
| 10 | Cache + hydration | Superseded (A) + **Partially implemented** (B; 3 unbounded caches) |
| 11 | Service-worker caching | **Active and validated** |
| 12 | Model normalization | Active and validated (ordering) / **Partially implemented** (period statistic, unit reads) |
| 13 | GPU texture residency | **Superseded** (engine-internal won; v2 pool never initialized) |
| 14 | Timeline/tile-scrub optimization | **Active but unvalidated** (no CI contract; one stuck-flag hazard) |
| 15 | Higher-resolution coastal data | **Partially implemented** (slope asset shipped, gated, stale precondition) |
| 16 | Nearshore transformations | **Partially implemented** (3 of 4 surfaces compliant) |
| 17 | AI-assisted forecast correction | **Design only** (b) / **Prototype only, self-refused** (a) |

**Tally:** Active and validated **1** · Active but unvalidated **2** · Partially implemented **6**
(one of which is also Superseded) · Dual-path transition **2** · Prototype only **2** · Superseded **2**
· Abandoned **1** · Design only **1**. **Zero items are "Not started"; zero are cleanly "Complete"
except service-worker caching.** The characteristic failure of this program is not stalling — it is
**shipping the replacement without retiring the original.**

---

## SECTION 3 — (b) WHICH INCOMPLETE TRANSITIONS ARE ACTIVELY CREATING INSTABILITY?

Criterion: **both paths are reachable at HEAD**, and reaching the wrong one changes what a user sees or
what the machine spends. Ranked by how cheaply the wrong path can be reached.

### I-1 · Two rating/height composition paths — the map band vs the mandated chain · **CRITICAL, live now**
*Both reachable:* no flag needed. `grid_resolver_surf.py:30,86` default `"1"`; every close-zoom map view
takes the band path (`surf_rating.py:738` bare `estimate_surf`), every infobox/glyph/hub takes the chain.
*Instability:* the same coordinate at the same hour yields two different heights and two different
scores in one screen — measured up to 3.04× and 56.9 points by E1, 2.3–2.7× live in production by
`112d2c34`'s sweep. *Why it persists:* the parity guard enumerates three surfaces and the band is the
fourth, so the suite is green while the contradiction is live.
*Cheapest fix that stops the bleeding:* add the band to `test_rating_composition_parity.py`'s `SURFACES`
so the divergence becomes visible before deciding how to close it.

### I-2 · `window.isScrubbingTimeline` — one bare global gating 60+ sites, with a leak path · **HIGH**
*Both reachable:* the flag is written in one component (`MapWeatherControls.js:400,412,460,466`) and read
as a hard gate across marine fetch (`useMarineDataFetcherCore.js:242,818`), wind (`windController.js:453`),
tile URLs (`useOpenMeteoTileUrls.js:64`), field binding (`useRenderPlanBridge.js:67`), repaint
(`WebGLMarineCustomLayer.js:277,310`) and the settle machinery (`useMarineScrubSettle.js:276,513,536,585`).
*Instability:* `ForecastWheel.js:321` cancels the settle RAF on unmount, and `onScrubEnd` fires only from
`finish()` inside it (`:216`), so an unmount mid-gesture pins the flag `true` with **no reset anywhere in
the tree**. One stuck boolean produces frozen animation, stale timeline, missing repaints and
"buffer not updating" **at the same time** — which is exactly the historical symptom cluster.
*Note:* the classic-slider path has a window mouseup/touchend backstop (`MapWeatherControls.js:436-452`)
but the wheel is the default (`:471`) and has none.

### I-3 · Engine shutdown without restart — the kernel's zombie state · **HIGH (latency-of-trigger unmeasured)**
*Both reachable:* `shutdownEngine()` runs on any `[mapInstance, userTier]` change
(`MapWebGL.js:685-695`); the re-entry branch (`:647-656`) reads a sequencer state that shutdown never
resets (`engine-bootstrap.js:98-107` vs `init-sequencer.js:87-89`).
*Instability:* after one tier transition the simulation loop, dispatcher and health monitor stay stopped
for the life of the map instance, **and** `disposeAnimationCoordinator()` (`MapWebGL.js:693`) nulls the
shared Canvas2D RAF singleton (`CanvasAnimationCoordinator.js:206-208`) while `GPUMarineLayer.js:374,546`
and `WindParticleOverlay.js:255,487` hold the disposed instance under deps `[mapInstance]` only — so if
the WebGL fallback is ever entered afterwards, its particles never animate.
*Why it is not visible:* the engine loop renders nothing (§1.1), so its death is silent. The Canvas2D
half is only reachable in the fallback branch, which is why it has not been reported by users.

### I-4 · The FCE dispatcher — a fail-closed second GPU writer holding live engine handles · **MEDIUM**
*Both reachable:* registration is unconditional (`WebGLMarineCustomLayer.js:87`, `WebGLWindLayer.js:39`),
the dispatcher is started unconditionally (`engine-bootstrap.js:80`), and the only barrier is
`window.__ALLOW_FCE_{MARINE,WIND}_UPLOAD__` — **two console assignments from re-opening the exact
two-writer defect that `45072247` closed on 2026-05-31**, whose commit body describes the resulting
symptom ("heatmaps not updating on scrub") in the user's own words.
*Aggravator found this pass:* the recovery arm behind that gate reads
`localStorage['rawsurf_marine_cache_v9']` (`RenderPlanDispatcher.js:41`) — a key with **no writer since
2026-06-01** (`8bd8685a`). So the dormant path is not merely dormant, it is broken in a way nobody would
discover until they enabled it during an incident.
*Asymmetry worth fixing regardless:* the marine gate `return`s out of the whole function (`:471`) while
the wind gate skips only its own block (`:453`) — the domain-locality comment at `:445-446` says this
was already fixed once for wind.

### I-5 · Ocean-mask authority split across renderers · **MEDIUM**
*Both reachable:* the WebGL lane composes four stages (`WebGLMarineMaskRenderer.js:515,96,276,291`) plus
the style-tier `OceanMask`; the Canvas2D fallback decides from `cell.isOcean` alone
(`GPUMarineLayer.js:143`). A `webglcontextlost` event (`MapWebGL.js:713-719`) or a persisted
`localStorage['force_marine_fallback']` (`MapWebGL.js:95`) switches lanes.
*Instability:* **a fallback activation changes the coastline definition, not just the renderer** — the
water/land boundary moves. And the `force_*_fallback` keys persist across sessions, so one debugging
session silently pins a browser to the second authority indefinitely.

### I-6 · Legacy-quarantine asymmetry between dev and production builds · **MEDIUM (measurement risk)**
*Both reachable:* `index.js:44-53` blocks direct Open-Meteo JSON only when `NODE_ENV === 'production'`.
*Instability:* the local dev frontend — per the brief, **the only live frontend surface** — exercises
`tideClient.js:16`'s direct `marine-api.open-meteo.com` fetch, while a production build 403s it
(`:147-157`). Any measurement taken locally therefore measures a code path production does not run.
This is the "a flag wrong in the measuring lane is worse than in the measured one" class.

### I-7 · Frame-rate-dependent GPU advection vs dt-correct Canvas2D fallback · **LOW-MEDIUM**
*Both reachable:* the primary GPU path (`WebGLWindShaders.js:195,198`,
`WebGLMarineParticleShaders.js:211,214`) has no time term; the fallback
(`GPUMarineLayer.js:432`, `WindParticleOverlay.js:56`) does.
*Instability:* particle ground speed and lifetime differ between a 60 Hz and a 120 Hz display **and**
between the primary and the fallback for the same data — so "the wind looks faster" is a real,
reproducible observation with no data cause. Report 11 already prices the fix at MED risk
(`:501`) because the current look is tuned to 60 Hz.

### I-8 · Three unbounded serving caches on a 512 MB box · **LOW-MEDIUM**
`viewport_service.py:60` `NEGATIVE_CACHE`, `store.py:274` `_l2_negative_cache`, `store.py:272`
`_download_locks`. Reachable on every failed viewport request; the key space grows with every distinct
hour × snapped viewport that has ever failed. The control that proves this is fixable is in the same
file: `store.py:748-755` bounds `_product_cache` twice.

### Not on this list, and why
- **`GPUMarineLayer` / `WindParticleOverlay` as "hidden legacy renderers"** — A2-04 reports them as
  legacy-and-replacement coexisting for 81 days because both are imported by `MapWebGL.js` (`:7`, `:9`,
  `:11`). The **import** is real; the **consequence is not**. I read the render tree:
  `MapWebGL.js:1027-1048` and `:1071-1089` are mutually-exclusive JSX ternaries on `webglMarineFailed` /
  `webglWindFailed`. They are declared failure fallbacks, not concurrent renderers. *(Correction to A2-04.)*
- **`WeatherEngine.js`'s forecast-pipeline subscription** — looks like a second data path
  (`WeatherEngine.js:3` imports `onForecastUpdate`), but `_notify` is only called from
  `fetchNormalized`/`fetchBestNormalized` (`forecast-pipeline.js:105,141`) and **neither has any caller**;
  the subscriber body (`:1109-1111`) is a `console.log`. Dead, not dual.

---

## SECTION 4 — WHAT I COULD NOT VERIFY (BLOCKED)

| Question | Why blocked | What would unblock it |
|---|---|---|
| How often does `userTier` actually change mid-session in production? | Requires runtime telemetry from real sessions; frontend truth events carry no build/session identity (Report 11 R11-03). | A counter on the `[mapInstance, userTier]` effect re-run, shipped with the build stamp. |
| Does the stuck-`isScrubbingTimeline` path fire in practice? | Needs a mounted React test unmounting `ForecastWheel` mid-drag, or a live session. Read-only audit, no server. | The mounted integration test Report 11 §14 already specifies. |
| Render production env-var state (which flags are actually set)? | Not readable from this repo; the admin registry is the only view and it is wrong about at least one flag (§5). | One Render dashboard screenshot. |
| The band-vs-point divergence magnitude at HEAD | E1 and B2 measured it with probes I did not re-run; I verified only the code fact that permits it. | Re-run `evidence/synthetic-probes/probe_E1_band_vs_point.py`. |
| Whether the 60 Hz engine loop measurably costs battery | No profiling was run (read-only, no browser). | A `react-profiler`/devtools trace with the loop stopped vs running. |

---

## SECTION 5 — CROSS-CUTTING FINDING: THE OPERATOR'S ONLY INSTRUMENT IS WRONG ABOUT THE FLAG THAT SCALES EVERY HEIGHT

Not one of the seventeen items, but it conditions the status of §1.15 and §1.16, so it is recorded here
with its own execution evidence.

- **Code (runtime authority):** `surf_height_convention.py:74`
  `return os.environ.get("SURF_HEIGHT_H110", "1") == "1"` → **ON**.
- **Same module's docstring:** `:42` *"⛔ DEFAULT OFF (`SURF_HEIGHT_H110=1` to enable). This changes
  EVERY displayed height by ~27%"*.
- **Admin flag registry — the operator's only view of Render:** `routes/admin/surf_forecast.py:160`
  `"SURF_HEIGHT_H110": ("0", …)` → declares **OFF**.
- **I executed it at HEAD with the env var popped:** `enabled() → True`, `H110_OVER_HS = 1.27`.

Three declared defaults, one of them in the instrument an operator would consult during an incident.
This corroborates A1-02 and B2-05; my contribution is the third execution and the note that the same
registry block (`:157-159`) *correctly* warns "NEVER FLIP ALONE" while its own tuple says the flag is
already off — an operator reading it would conclude the height pair has not shipped.

---

## SECTION 6 — CORRECTIONS TO THE INPUT PACKS

| Pack | Claim | My reading |
|---|---|---|
| A2-04 | "Legacy and replacement marine renderers have coexisted for 81 days and are BOTH imported by MapWebGL.js" — framed as a hidden-legacy-renderer risk. | The imports are real (`MapWebGL.js:7,11`); the runtime relationship is a **mutually-exclusive JSX ternary** (`:1027-1048`), i.e. an explicit failure fallback. Severity of the *coexistence* framing is overstated; the real risk in that pair is the **land/sea authority change** on fallback (§I-5) and the **dt asymmetry** (§I-7), neither of which A2-04 names. |
| A1-05 | The canonical roadmap is contradicted by the shipped frontend on two anti-patterns (direct Open-Meteo fetch; client-side model math). | Confirmed, with one nuance A1-05 did not measure: `index.js:44-53` **blocks** `marine-api.open-meteo.com` in production builds, so the `tideClient.js:16` violation is live in dev and inert in prod. That makes it a *measurement-lane* hazard as much as a contract violation. |
| B1 (implicit) | `gpu-texture-manager` treated as bound-but-unused. | Stronger: it is **never bound**. `engine-bootstrap.js:57-59` guards on `if (ctx.gl)` and the sole caller `MapWebGL.js:660-663` passes no `gl`, so `_gl` stays `null` and every accessor short-circuits. |
| — (new) | — | `RenderPlanDispatcher.js:41` reads `localStorage['rawsurf_marine_cache_v9']`; the writer moved to `v10` at `8bd8685a` (2026-06-01) and lives at `marineControllerCache.js:24`. The dispatcher's hydration arm has been unable to hydrate for 69 days. Reported in no pack, no handoff, no report. |
| — (new) | — | `setPluginEnabled` (`LayerRegistry.js:281`) has **zero callers**, and `bootstrapCoreLayers` (`:340`) registers everything `enabled: false` — so the 60 Hz `render-orchestrator` loop's `updatePlugins`/`renderPlugins` are structurally no-ops, not merely idle. |

---

## SECTION 7 — VERIFICATION COMMANDS (re-runnable, all read-only)

```bash
# Baseline
git rev-parse HEAD                      # 9f4f85708e765741d51ac2812de5a36373ac514b
git status --porcelain                  # ?? audit/

# §1.1 the plugin loop is a structural no-op
rg -n "setPluginEnabled" frontend/src                       # 1 hit: the definition
rg -n "enabled: false" frontend/src/components/map/LayerRegistry.js

# §1.2 no production setter for the FCE gates; the stale hydration key
rg -n "__ALLOW_FCE_(MARINE|WIND)_UPLOAD__" frontend/src     # writes only in __tests__
git grep -n "rawsurf_marine_cache"                          # v10 writer, v9 read, 1 diag string
git log --all --oneline -S "rawsurf_marine_cache_v9"        # 8bd8685a bumped it 2026-06-01

# §1.4 RK4 reaches only a health metric
rg -n "rk4Particles" frontend/src                           # exactly 4 hits

# §1.5 the uncancellable FPS loop
rg -n "initFpsMonitor|new WeatherTelemetryEngine" frontend/src/components/map/WeatherTelemetry.js
rg -c "cancelAnimationFrame" frontend/src/components/map/WeatherTelemetry.js   # 0

# §1.6 mercator formula copies + the clamp drift
rg -n "float latToMercatorY" frontend/src/components/map     # 6 GLSL definitions
rg -n "85\.0511[^1]" frontend/src                            # WebGLWindShaders.js:803

# §1.12 one sort site
rg -n "sort\(key=lambda v: \(v\.lat, v\.lng\)\)" backend/services/weather_pipeline

# §1.13 the pool never receives a gl
rg -n "bindGPUContext|initEngine\(\{" frontend/src/engine/engine-bootstrap.js frontend/src/components/map/MapWebGL.js

# §1.15 the stale blocker — execute, do not read
C:/Users/dprit/AppData/Local/Python/bin/python3.exe -c "import sys;sys.path.insert(0,'.');\
from services.weather_pipeline.bathymetry import bed_slope_at;print(bed_slope_at(21.665,-158.053))"   # 0.0301

# §1.16 the band's bare call
sed -n '703p;738p' backend/services/weather_pipeline/surf_rating.py
rg -n "SURFACES = |'spot_ratings'|'spot_conditions'|'sim_rating'" backend/tests/test_rating_composition_parity.py

# §1.17 the flag exists only in docstrings
git grep -n "HEIGHT_QUANTILE_MAP" backend/                   # 3 hits, all docstrings

# §5 three declared defaults
C:/Users/dprit/AppData/Local/Python/bin/python3.exe -c "import os,sys;sys.path.insert(0,'.');\
os.environ.pop('SURF_HEIGHT_H110',None);\
from services.weather_pipeline import surf_height_convention as s;print(s.enabled())"   # True
sed -n '160p' backend/routes/admin/surf_forecast.py                                     # ("0", ...)
```
