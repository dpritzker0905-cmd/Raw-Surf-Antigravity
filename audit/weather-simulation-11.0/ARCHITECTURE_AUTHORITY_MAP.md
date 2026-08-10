# ARCHITECTURE_AUTHORITY_MAP — Frontend Weather/Marine Render Authority

**Agent B — frontend architecture and render authority. READ-ONLY forensic audit.**

| Field | Value |
|---|---|
| Repo | `C:/Users/dprit/Raw-Surf` |
| Branch | `dev` |
| **HEAD actually audited** | **`9f4f8570`** (`docs(handoff): the tide A/B produced its first TRUSTWORTHY verdict…`) |
| HEAD stated in the task | `3d3ccdc2` — that is HEAD~1. `git log --oneline -3` shows `9f4f8570 → 3d3ccdc2 → b20dba2a`. |
| Tree | clean (`git status --porcelain` empty) |
| maplibre-gl | 5.24.0 (`frontend/node_modules/maplibre-gl/package.json`) |
| Files modified by this audit | **none** outside `audit/weather-simulation-11.0/` |

**Reachability method.** Every ACTIVE claim below is anchored to an unbroken import/render chain
starting at the router: `frontend/src/App.js:28` (`React.lazy(() => import('./components/MapPage'))`)
→ `App.js:153` (`<Route path="/map" … <MapPage /> …>`) → `components/MapPage.js:3`
(`import MapWebGL from './map/MapWebGL'`) → the JSX render tree in
`components/map/MapWebGL.js:956-1094`. A file merely existing is never treated as evidence it runs;
where the chain terminates, the row is marked DEAD and the terminating fact is cited.

---

## 0. EXECUTIVE SUMMARY OF WHAT IS ACTUALLY TRUE

1. **Exactly two MapLibre custom layers exist and both are ACTIVE** — `webgl-marine-particles`
   (`WebGLMarineCustomLayer.js:5,78`) and `webgl-wind-particles` (`WebGLWindLayer.js:18,29`). There
   is no third.
2. **Particle motion is NOT frame-rate independent in either GPU engine.** The integration step is
   `nextPos = pos + offset` with `offset` containing **no elapsed-time term**
   (`WebGLWindShaders.js:181,195,198`; `WebGLMarineParticleShaders.js:199,211,214`; CPU-side scale at
   `WebGLWindEngine.js:546-548` and `WebGLMarineEngine.js:2171`). Both Canvas2D **fallbacks** *are*
   dt-scaled (`GPUMarineLayer.js:432`, `WindParticleOverlay.js:56,389`) — the fallback is more
   physically correct than the primary.
3. **RK4 exists, runs at 60 Hz, and reaches no renderer.** `engine/particle-system.js:113` +
   `engine/SimulationLoop.js:243-250` advect 6,000 wind + 3,000 marine particles every fixed step;
   the only consumer of `rk4Particles` is a health metric (`SimulationHealthMonitor.js:135`). No
   drawing code reads it.
4. **`RenderPlanDispatcher` is a fully-wired SECOND upload path into both GPU engines**, live but
   flag-gated OFF (`RenderPlanDispatcher.js:452` for wind, `:470` for marine). Flipping one `window`
   boolean at runtime hands render authority to a different data source — including a
   `localStorage`-hydrated grid (`RenderPlanDispatcher.js:38-186`).
5. **Two GL state mutations happen OUTSIDE the capture/restore window in `WebGLWindEngine.render`** —
   most importantly `gl.bindFramebuffer(gl.FRAMEBUFFER, null)` at `WebGLWindEngine.js:438`, executed
   *before* `captureWebGLState` at `:447`. The capture therefore records `prevFBO = null`, not
   whatever MapLibre had bound.
6. **`gl.clearColor` is neither captured nor restored** (`WebGLStateIsolation.js:8-66,68-141`), while
   both engines call it (`WebGLWindEngine.js:435,437,962,1057,1060`; `WebGLMarineEngine.js:547,610`).
7. **One RAF loop in the weather path has no stop condition and no cancellation at all** —
   `WeatherTelemetry.js:397-399`, started from the constructor (`:73`) of a module-scope singleton
   (`:549`), i.e. at import time, and it keeps running after `/map` unmounts.
8. **`createRampTexture` (`WindColorRamp.js:278-289`) allocates a `gl.createTexture()` and has ZERO
   callers** — verified by full-tree grep. Dead allocator, no teardown path (never reached, so no
   leak today; it is a trap for the next caller).
9. **The pressure subsystem is disconnected.** `usePressureEngine.js` has no importer; `MapWebGL.js`
   substitutes `const lowSystems = useMemo(() => [], [])` at `:118-119`.

---

## 1. RESPONSIBILITY → AUTHORITY MATRIX

Legend for *Migration status*: **SETTLED** = one authority, no live competitor. **DUAL-GATED** = two
implementations, both reachable, one selected by a flag/state. **ORPHANED** = built, wired, never
reached. **DEAD** = no import chain.

### 1.1 Rendering

| Responsibility | Intended authority | ACTUAL authority | Active impl (file:line) | Legacy impl | Bypass paths | State owner | Resource owner | Lifecycle owner | Tests | Migration status |
|---|---|---|---|---|---|---|---|---|---|---|
| Marine particles + wave heatmap draw | `WebGLMarineEngine` via one custom layer | same | `WebGLMarineCustomLayer.js:112-339` `render()` → `WebGLMarineEngine.js:326` (`engine.render(...)` call at `WebGLMarineCustomLayer.js:326`) | `GPUMarineLayer.MarineParticleCanvas` (Canvas2D) `GPUMarineLayer.js:258` | `MapWebGL.js:1027-1049` ternary on `webglMarineFailed`; set true by `onMarineWebglError` (`MapWebGL.js:507-510`) which is called from `WebGLMarineCustomLayer.js:108` (init throw) **and** `:336` (3rd render error) | React `marineData` in `MapWebGL`/orchestrator; engine-resident `_waveData` | `WebGLMarineEngineInit.js:119-207` (create) / `:243-290` (dispose) | `WebGLMarineLayer.js:837-915` mount effect | `WebGLMarineEngine.*.test.js` (16 files), `WebGLMarineMaskRenderer.*.test.js` | **DUAL-GATED** |
| Wind particles + wind heatmap draw | `WebGLWindEngine` via one custom layer | same | `WebGLWindLayer.js:46-183` `render()` → `WebGLWindEngine.js:170` (`engine.render(...)` call at `WebGLWindLayer.js:170`) | `WindParticleOverlay` (Canvas2D) `WindParticleOverlay.js` | `MapWebGL.js:1071-1089` ternary on `webglWindFailed`; set true by `onWindWebglError` (`MapWebGL.js:511-514`) — **called ONLY from `WebGLWindLayer.js:42` (init throw). The 5-error render path at `:179-181` logs and does NOT call `onError`.** | React `windData` from `WeatherEngine.js` | `WebGLWindEngineInit.js:54-151` / `:172-200` | `WebGLWindLayer.js:217-285` | `WebGLWindEngine.*.test.js` | **DUAL-GATED (fallback nearly unreachable)** |
| Land/coast visual mask (basemap) | `OceanMask` | same | `OceanMask.js:473,521,543,575,605` → 5 style layers `ocean-mask-buffer` / `-fill` / `-inland-water` / `-inland-waterway` / `-line` (ids `OceanMask.js:33-37`, list `:39-45`) | — | layer-order pin fights: `WebGLMarineLayer.js:883-894` demotes `ocean-mask-inland-water`, `-inland-waterway`, `national-park` below the marine layer on every `styledata` | React `theme`/`active` props | MapLibre style | `OceanMask.js` effects (`:740-745,757,826,842,856,870,880,887` RAF-guarded sync) | `OceanMask.bufferColor.test.js` | SETTLED |
| Radar frames | imperative frame-layer manager | same | `MapWebGL.js:422` (`PREFIX='radar-frame-'`), `addLayer` at `:488` | — | `radarAdvection.js`, `radarTileRecolor.js` | `radarFrames` / `radarFrameIndex` props | MapLibre raster sources | `MapWebGL.js` effect | `radarForecastSources.advect.test.js` | SETTLED |
| Lightning flashes | imperative point layers | same | `MapWebGL.js:545` (`lightning-glow`), `:553` (`lightning-core`) | v3b raster underlay (removed, comment `MapWebGL.js:516-518`) | `window.__LTG_STRIKES__`, `window.__LTG_REFRESH__` globals | module-local `flash` Map (`MapWebGL.js:539`) | geojson source `lightning-strikes` | effect cleanup `MapWebGL.js:596-608` | none found | SETTLED |
| Atmospheric raster slots | `useOpenMeteoTileUrls` + JSX `<Source>/<Layer>` | same | `MapWebGL.js:824` (`openMeteoRasterSlots`), `:803` (`esriSatelliteLayers`) | — | `openMeteoProtocol.js` custom `om://` protocol | `useOpenMeteoTileUrls` | MapLibre | `useRasterTransactions.js` | `decodedOmSampler.test.js` | SETTLED |
| Spot glyph ratings | `useSpotRatings` → `MapMarkerLayers` | same | `MapWebGL.js:1053-1066` | grid-sample fallback inside `useSpotRatings.js` (`gridRatings`) | `spotRatingsCdn.js` | `useSpotRatings` | MapLibre symbol layers | effect-scoped | `spotRatingsCdn.test.js` | SETTLED |

### 1.2 Simulation / animation

| Responsibility | Intended authority | ACTUAL authority | Active impl (file:line) | Legacy impl | Bypass paths | State owner | Resource owner | Lifecycle owner | Tests | Migration status |
|---|---|---|---|---|---|---|---|---|---|---|
| Particle advection (GPU, marine) | GPU transform pass | GPU fragment shader, **fixed per-frame Euler** | `WebGLMarineParticleShaders.js:199` `offset = (waveVec*driftHeight*0.1/merc_scale)*u_speed_scale*energyBoost`; `:211/:214` `nextPos = pos + offset` | — | `window.__RAW_WAVE_SPEED__`, `__RAW_REDUCED_MOTION__`, `__RAW_SPEED_HEIGHT_CAP__` | ping-pong `particleStateA/B` textures | `WebGLMarineEngineInit.js:37,41-42` | engine dispose | `WebGLMarineEngine.ribbonTaper.test.js` etc. | SETTLED (but see §4 Q4) |
| Particle advection (GPU, wind) | GPU transform pass | GPU fragment shader, **fixed per-frame Euler** | `WebGLWindShaders.js:181,195,198` | — | `__RAW_REDUCED_MOTION__`, `resolveWindAnimTuning` | ping-pong particle textures | `WebGLWindEngineInit.js:30-31,193-194` | engine dispose | `WebGLWindEngine.*.test.js` | SETTLED (but see §4 Q4) |
| Particle advection (CPU, RK4) | `engine/particle-system.js` | **nobody consumes the output** | `particle-system.js:113-140` `rk4Advect`; driven `SimulationLoop.js:243-250` | `engine-brain/wind-advection-model.js:94` `advectParticleRK4` | — | `_windParticles`/`_marineParticles` (`SimulationLoop.js:39-40`) | JS typed arrays | `startSimulation`/`stopSimulation` (`engine-bootstrap.js:77,102`) | none found | **ORPHANED** (RK4 in `SimulationLoop`) / **DEAD** (`engine-brain/wind-advection-model.js`) |
| Particle advection (Canvas2D fallbacks) | dt-scaled Euler | same | `GPUMarineLayer.js:432` `dt * 1500 * pow(0.62, zoom-6)`; `WindParticleOverlay.js:56` `dt * base * pow(0.55, zoom-refZoom)` | — | `CanvasAnimationCoordinator` throttle states | per-layer particle arrays | Canvas2D | `CanvasAnimationCoordinator.register/unregister` (`GPUMarineLayer.js:546,555`; `WindParticleOverlay.js:487,495`) | `MarineAnimTuner.defaults.test.js` | DUAL-GATED |
| Frame driver — WebGL layers | MapLibre's own frame | `map.triggerRepaint()` from inside `render()` | `WebGLMarineCustomLayer.js:327`; `WebGLWindLayer.js:172` | — | 20+ other `triggerRepaint` call sites (see §4 Q3) | MapLibre | MapLibre | MapLibre | — | SETTLED |
| Frame driver — Canvas2D layers | one shared RAF | `CanvasAnimationCoordinator` singleton | `CanvasAnimationCoordinator.js:91,196` (+ dormant re-arm `:135`) | — | `disposeAnimationCoordinator` imported at `MapWebGL.js:44` | `_layers` Map | RAF id | `start`/`stop`/`dispose` `:87-116` | none found | SETTLED |
| Frame driver — engine physics | one fixed-timestep RAF | `render-orchestrator` | `render-orchestrator.js:144` start, `:132` re-arm, `:79` gated re-arm, `:154` cancel | — | `getInitState()` gate `:77-81` | module scalars | RAF id | `startPluginRenderLoop`/`stopPluginRenderLoop` (`engine-bootstrap.js:74,103`) | none found | SETTLED |

### 1.3 Data authority

| Responsibility | Intended authority | ACTUAL authority | Active impl (file:line) | Legacy impl | Bypass paths | State owner | Resource owner | Lifecycle owner | Tests | Migration status |
|---|---|---|---|---|---|---|---|---|---|---|
| Marine grid → GPU | React forecast path only | React path (dispatcher gated off) | `WebGLMarineLayer.js:350,538,669` + `WebGLMarineCustomLayer.js:95` → `engine.setWaveData` | `RenderPlanDispatcher.js:611` `_marineEngine.setWaveData(_marineGL, gridToUpload)` | `window.__ALLOW_FCE_MARINE_UPLOAD__ = true` (`RenderPlanDispatcher.js:470`) opens it; `hydrateGridFromLocalStorage` (`:38`) then sources from `localStorage['rawsurf_marine_cache_v9']` | React `marineData` | GPU textures | `WebGLMarineLayer.js:837-915` | `WebGLMarineTextureEncoder.*.test.js` | **DUAL-GATED (dormant)** |
| Wind grid → GPU | React forecast path only | React path (dispatcher gated off) | `WebGLWindLayer.js:240,376` `engine.setWindData` | `RenderPlanDispatcher.js:458` `_windEngine.setWindData(_windGL, windGrid)` | `window.__ALLOW_FCE_WIND_UPLOAD__ = true` (`RenderPlanDispatcher.js:452`) | React `windData` from `WeatherEngine.js` | GPU textures | `WebGLWindLayer.js:217-285` | — | **DUAL-GATED (dormant)** |
| `marineData` React state writes | one fetcher | **five modules write it** | `useMarineDataFetcherCore.js:600,626,658,694`; `useMarineDataFetcherHelpers.js:239,344,350,470,512`; `useMarineOrchestrator.js:274,571,732,766`; `useMarineOrchestratorScrubCache.js:189,263`; `useMarineScrubSettle.js:327,403,466` | — | `marineCommitShortCircuit.js`, `marineTransitionCoordinator` generation tokens | `useMarineOrchestrator` owns the `useState` | — | orchestrator | `useMarineOrchestrator.dedup.test.js`, `marineCommitShortCircuit.test.js`, `useMarineScrubSettle.detectClamp.test.js` | **DUAL-GATED (many writers, one coordinator)** |
| Point surf height + quality (infobox) | backend `surf_height_m` + JS mirror of `surf_rating.py` | same | `MapForecastOverlay.js:439-465` — `computeSurfRating(useExactPoint?.surf_height_m, …)` | — | `getSurfModeFlag()` gate (`MapForecastOverlay.js:439`); `useExactPointFetch` | `useExactPointFetch` | — | hook | `surfRating` mirrored by `test_rating_composition_parity.py` (cited in-code `MapForecastOverlay.js:447`) | **DUAL-GATED BY DESIGN** (`surfRating.js:1-2` declares itself a mirror; height comes from the backend, so the ONE FORECAST COMPOSITION rule is honoured for the number) |
| Pressure systems | `usePressureEngine` | **nothing** | — | `usePressureEngine.js:1-80` | — | — | — | — | — | **DEAD** — `MapWebGL.js:118-119` `const lowSystems = useMemo(() => [], [])` |

### 1.4 Land/sea masking (see §4 Q10 for the full chain)

| Responsibility | Intended authority | ACTUAL authority | Active impl (file:line) | Legacy impl | Bypass paths | State owner | Resource owner | Lifecycle owner | Tests | Migration status |
|---|---|---|---|---|---|---|---|---|---|---|
| Physics land/sea (what the shader samples) | one ocean-mask texture | **4-stage composite** | `WebGLMarineMaskRenderer.js:515` `renderMaskToCanvas` → `:96` `overlayBasemapWaterOnMask` → `:276` `applyInlandWaterGuard` → `:291` `reassertNeLand` | grid-carried `vectors[i].isOcean` (still encoded, `RenderPlanDispatcher.js:392`) | `__RAW_DISABLE_INLAND_WATER_GUARD__`, `__RAW_WORLD_MASK_WIDTH__`, `__RAW_INLAND_WATER_KM__` | engine `_cachedMaskTex` / `_overlayMaskTex` | `WebGLMarineEngine.js:2654,2461,2602` | `WebGLMarineEngineInit.js:274-275` | `WebGLMarineMaskRenderer.*.test.js` (4), `inlandWaterGuard.test.js`, `maskSmoothing.test.js` | SETTLED (composite by design) |
| Visual land mask | `OceanMask` | same | `OceanMask.js:473-620` | — | — | React props | MapLibre | OceanMask effects | `OceanMask.bufferColor.test.js` | SETTLED |
| Canvas2D fallback land/sea | grid `isOcean` only | same | `GPUMarineLayer.js:100-107,142-143,206-214` | — | — | grid data | — | — | — | SETTLED |

---

## 2. COMPETING AUTHORITIES — every duplicate path, with proof both are reachable

### CA-1 — TWO PARTICLE ENGINES PER DOMAIN (WebGL primary / Canvas2D fallback) — **CONFIRMED**

Both branches of both ternaries are compiled and mounted from the same render tree:

```
MapWebGL.js:1027   {!webglMarineFailed ? (
MapWebGL.js:1028       <WebGLMarineLayer … onError={onMarineWebglError} />
MapWebGL.js:1040   ) : (
MapWebGL.js:1041       <MarineParticleCanvas id="marine-canvas-layer" … />
MapWebGL.js:1049   )}
…
MapWebGL.js:1071   {!webglWindFailed ? (
MapWebGL.js:1072       <WebGLWindLayer … onError={onWindWebglError} />
MapWebGL.js:1081   ) : (
MapWebGL.js:1082       <WindParticleOverlay id="wind-particle-overlay" … />
MapWebGL.js:1089   )}
```

Reachability of the MARINE fallback — two independent triggers:
- `WebGLMarineCustomLayer.js:106-109` — `engine.init()` throw → `onErrorRef.current()`.
- `WebGLMarineCustomLayer.js:334-337` — `if (errorCount === 3) … onErrorRef.current()`.

Reachability of the WIND fallback — **one** trigger only:
- `WebGLWindLayer.js:40-43` — `engine.init()` throw → `onErrorRef.current()`.
- `WebGLWindLayer.js:179-181` — the 5-error path prints `'[WebGLWind] Too many errors, temporarily
  disabling GPU particles (will retry in 10s).'` and **does not** call `onErrorRef`. So a wind engine
  that renders-but-throws goes dark (early return at `:107`, `errorCount > 5`) and stays dark until
  the 10 s decay at `:103-105` — it never hands over to `WindParticleOverlay`.

**Asymmetry that matters:** the fallbacks integrate with `dt` (`GPUMarineLayer.js:432`,
`WindParticleOverlay.js:56`), the primaries do not (§4 Q4). Switching to the fallback therefore
changes particle *speed semantics*, not just the renderer.

### CA-2 — `RenderPlanDispatcher` IS A SECOND WRITER INTO BOTH LIVE GPU ENGINES — **CONFIRMED (dormant by flag)**

Registration is unconditional and happens inside the custom layers' `onAdd`:

```
WebGLMarineCustomLayer.js:87    registerMarineEngine(engine, _gl);
WebGLWindLayer.js:39            registerWindEngine(engine, _gl);
```

The dispatcher is started unconditionally by the engine bootstrap that `MapWebGL` drives:

```
engine-bootstrap.js:80          startDispatcher();      // ← called from initEngine
MapWebGL.js:40                  import { initEngine, shutdownEngine } from '../../engine/engine-bootstrap';
RenderPlanDispatcher.js:270     _unsubscribe = onRenderPlan(dispatchRenderPlan);
```

So `dispatchRenderPlan` runs every 6th composed plan (`RenderPlanDispatcher.js:279`
`DISPATCH_INTERVAL = 6`) with **live engine handles**. What stops it writing:

```
RenderPlanDispatcher.js:452  const windUploadEnabled = typeof window === 'undefined' || window.__ALLOW_FCE_WIND_UPLOAD__ === true;
RenderPlanDispatcher.js:470  if (typeof window !== 'undefined' && window.__ALLOW_FCE_MARINE_UPLOAD__ !== true) { … return; }
```

In a browser `typeof window !== 'undefined'`, so both reduce to "off unless a `window` boolean is
set". Setting either at runtime — from the console, a bookmarklet, a diagnostic, or any code that
touches those globals — makes the dispatcher an equal-authority writer to `setWaveData`/`setWindData`.

**The bypass has its own data source.** When the dispatcher is enabled and the evolved field is
rejected, it falls back to `hydrateGridFromLocalStorage(activeModel, activeMarineLayer, hourOffset)`
(`RenderPlanDispatcher.js:38-186`, called at `:595`), reconstructing a marine grid from
`localStorage['rawsurf_marine_cache_v9']` (`:41`) and uploading it (`:611`). That path re-derives
`u = -h*sin(dir)`, `v = -h*cos(dir)` and `speed = h` (`:145-155`) directly from cached Open-Meteo
`wave_height` — i.e. an **offshore-Hs-shaped** grid, entirely outside the React forecast chain.
*(Consequence for displayed numbers NOT MEASURED — this path is off at HEAD; the code fact is that
it exists, is registered against the live engine, and is one boolean away.)*

Note the two gates are also **not symmetric**: the marine gate `return`s out of
`dispatchRenderPlan` entirely (`:471`), while the wind gate only skips its own block
(`:453-467`) — the in-code comment at `:445-448` says this asymmetry was deliberate.

### CA-3 — TWO PARTICLE INTEGRATORS (GPU Euler vs CPU RK4) — **CONFIRMED, one is ORPHANED**

`SimulationLoop` runs a full RK4 particle system every fixed step:

```
SimulationLoop.js:62-63   const WIND_PARTICLE_COUNT = 6000;  const MARINE_PARTICLE_COUNT = 3000;
SimulationLoop.js:243-250 if (_windParticles …) _windParticles.update(dt);
                          if (_marineParticles …) _marineParticles.update(dt);
particle-system.js:113    function rk4Advect(uData, vData, cols, rows, x, y, dt)
particle-system.js:207    const vel = rk4Advect(uData, vData, cols, rows, fx, fy, dt);
```

Its output is attached to the render plan:

```
SimulationLoop.js:295     _renderPlan.windParticles.rk4Particles = _windParticles.getParticles();
SimulationLoop.js:301     _renderPlan.waveField.rk4Particles  = _marineParticles.getParticles();
```

Full-tree grep for `rk4Particles` returns exactly four hits: the two writes above and two reads in
`SimulationHealthMonitor.js:135,137`. **No renderer reads it.** The GPU engines draw from their own
ping-pong textures and never consult the render plan's particle arrays.

A *second*, entirely separate RK4 implementation exists at `engine-brain/wind-advection-model.js:94`
(`advectParticleRK4`). Full-tree grep for that symbol returns exactly one hit — its own definition.
**DEAD.**

### CA-4 — FIVE MODULES WRITE `marineData` — **CONFIRMED**

`setMarineData` is invoked from 18 sites across 5 files (listed in §1.3). They are mediated by
`marineTransitionCoordinator`'s generation tokens (`marineTransitionCoordinator.js:12-17,221-244`)
and `lastCommittedSigRef`, not by a single owner. Reachability of the non-obvious ones:
`useMarineScrubSettle.js:327,403,466` fire from two module-scope `setInterval`s
(`useMarineScrubSettle.js:512`, `:582`) that run independently of the fetcher effect.

### CA-5 — TWO MARINE FETCHER HOOKS — **CONFIRMED, both reachable**

`useMarineDataFetcher.js` (293 lines) and `useMarineDataFetcherCore.js` (1,4xx lines) both import
`fetchMarineData` from `marineController`. `useMarineDataFetcher.js:4` is imported by
`useMarineOrchestrator.js:8`, so both are on the live chain. (This is a wrapper/core split, not two
rival fetchers — but the split means the abort/generation contract is spread across two files.)

### CA-6 — SURF RATING: BACKEND PYTHON + FRONTEND JS MIRROR — **CONFIRMED, declared**

`frontend/src/components/map/surfRating.js:1-2` opens with
`"surfRating.js — JS MIRROR of backend services/weather_pipeline/surf_rating.py. KEEP IN SYNC."`.
`computeSurfRating` is **reachable, not just imported**: called at `MapForecastOverlay.js:441`.
Critically, its *height* input is `useExactPoint?.surf_height_m` (`:442`) — the backend breaking
height — so the ONE FORECAST COMPOSITION rule is honoured for the magnitude; only the 0-100 scoring
is duplicated. `MapForecastOverlay.js:454-464` documents a live divergence risk: `referenceSizeM`
was passed `null` while `RATING_LOCAL_SIZE` is on backend-side.

### CA-7 — LAYER ORDER: TWO MECHANISMS FIGHT OVER THE SAME LAYERS — **CONFIRMED (documented in-code)**

`WebGLMarineLayer.js:876-893` demotes `ocean-mask-inland-water`, `ocean-mask-inland-waterway` and
`national-park` below the marine layer on every `styledata` tick. `OceanMask.js` raises landuse/parks
above the land fill. The in-code note at `WebGLMarineLayer.js:888-893` states the two mechanisms
"fight every styledata tick" when the demote list is widened. Both run.

---

## 3. GPU RESOURCE LEDGER (Q7 detail)

### 3.1 Allocation sites

| Site | Kind | Teardown |
|---|---|---|
| `WebGLMarineEngineInit.js:119,120,121` | 3 programs | `WebGLMarineEngineInit.js:251-253` `deleteAttachedShaders` |
| `WebGLMarineEngineInit.js:123,133,153,173` | 4 buffers | `:254-257` |
| `WebGLMarineEngineInit.js:181` | `advFBO` | `:258` |
| `WebGLMarineEngineInit.js:187,197,206` | 3 VAOs | `:247-249` |
| `WebGLMarineEngineInit.js:37` (`particleStateA/B` via `createTexture`) | 2 textures | `:265-266` (+ `:41-42` on re-init) |
| `WebGLMarineTextureEncoder.js:479,501,503,505,508` | resident wave/chl/bath/score textures | `WebGLMarineEngineInit.js:268-273` |
| `WebGLMarineTextureEncoder.js:542,555,559,728,758,767` | mask textures | `WebGLMarineEngine.js:3171-3185` (`clearBuffers`), `:680,776` (encoder), `WebGLMarineEngineInit.js:274` |
| `WebGLMarineEngine.js:2654` | `_overlayMaskTex` | `WebGLMarineEngineInit.js:275` |
| `WebGLMarineEngine.js:2709` | probe FBO | `WebGLMarineEngine.js:2763` (same function) |
| coarse-base LRU sets (`_captureCoarseBase`, `WebGLMarineEngine.js:2887`) | wave/chl/bath/mask per set | `_freeCoarseBase` `:2963-2987`; called from `dispose` `:3189` and from `clearBuffers` **only when the LRU is disabled** (`:3167`) |
| `WebGLWindEngineInit.js:54-58` | 5 programs | `:172` (`deleteProgram` per program) |
| `WebGLWindEngineInit.js:59,64,93,96` | 4 buffers | `:188-191` |
| `WebGLWindEngineInit.js:102` | `advFBO` | `:192` |
| `WebGLWindEngineInit.js:106,116,125,134,143` | 5 VAOs | `:177-181` |
| `WebGLWindEngine.js:415-416` (`createFBO` ×2 → 2 FBOs + 2 textures) | `screenA`/`screenB` | `WebGLWindEngine.js:413-414` (on resize) + `WebGLWindEngineInit.js:198-199` |
| `WebGLWindEngine.js:398,1084` | `_colorRamp` | `:397,1083` (pre-delete) + `WebGLWindEngineInit.js:197` |
| `WebGLWindUtils.js:182,240` | wind data / particle textures | `WebGLWindEngine.js:245,267,271,284,292,344,345`; `WebGLWindEngineInit.js:193-196` |
| `engine/gpu-texture-manager.js:73,141` | managed textures/FBOs | `:70,132-133,151,190,203,208,214` + `destroyAll` (`engine-bootstrap.js:104`) |
| **`WindColorRamp.js:280`** | **`gl.createTexture()`** | **NONE — and no caller either (see below)** |

### 3.2 Allocations with NO teardown path

1. **`WindColorRamp.createRampTexture` (`WindColorRamp.js:278-289`)** — allocates a texture, returns
   `{ texture, maxSpeed }`, and **has zero call sites**. Full-tree grep for `createRampTexture`
   returns two hits: the definition (`:278`) and a comment (`:137`). `WebGLWindEngine.js:15` imports
   only `generateRampData`. **CLASSIFICATION: dead allocator.** It leaks nothing today because it is
   unreachable; it is a trap because a future caller inherits no `deleteTexture`.
2. **Coarse-base LRU entries when `clearBuffers` runs with the LRU enabled** — `WebGLMarineEngine.js:3167`
   `if (!this._coarseBaseLruEnabled()) this._freeCoarseBase(gl);`. The retention is deliberate and
   documented (`:3160-3166`); true teardown happens in `dispose` (`:3189`). This is **not** a leak
   under normal dispose, but it *is* an allocation whose only teardown is a code path that a
   `clearBuffers`-without-`dispose` lifecycle never reaches. NOT MEASURED whether such a lifecycle
   occurs at runtime.
3. `WebGLWindLayer.js:318` (`gl.deleteTexture(engine._windData.texture)`) is a manual fallback that
   bypasses the engine's accounting choke, unlike the marine side's `safeDeleteTexture` (compare the
   R11-10d note at `WebGLMarineEngineInit.js:259-264`). Bookkeeping asymmetry, not a leak.

---

## 4. THE TEN QUESTIONS

### Q1 — Which custom MapLibre layers are registered? **CONFIRMED**

Full-tree grep for `type: 'custom'` returns exactly **two** definitions:

| id | Defined | `onAdd` | `render` | `onRemove` | Registered by | ACTIVE? |
|---|---|---|---|---|---|---|
| `webgl-marine-particles` (`WebGLMarineCustomLayer.js:5`) | `WebGLMarineCustomLayer.js:76-346` (`type:'custom'` `:78`, `renderingMode:'2d'` `:79`) | `:82` | `:112` | `:341` | `WebGLMarineLayer.js:859` `mapInstance.addLayer(customLayer, targetBeforeId)` | **ACTIVE** — chain: `MapWebGL.js:11,1028` |
| `webgl-wind-particles` (`WebGLWindLayer.js:18`) | `WebGLWindLayer.js:27-190` (`:29`, `:30`) | `:32`, re-wrapped `:233` | `:46` | `:185` | `WebGLWindLayer.js:259` `mapInstance.addLayer(customLayer)` | **ACTIVE** — chain: `MapWebGL.js:10,1072` |

No `prerender` hook is implemented anywhere. Non-custom style layers added imperatively in the
weather path (for completeness): `ocean-mask-buffer/-fill/-inland-water/-inland-waterway/-line`
(`OceanMask.js:473,521,543,575,605`), `radar-frame-*` (`MapWebGL.js:488`, prefix `:422`),
`lightning-glow` (`:545`), `lightning-core` (`:553`).

`useMapInitialization.js:102,128` patch `src.onRemove` on MapLibre **sources** (not layers) — that is
a monkey-patch of source teardown, not a custom layer.

### Q2 — Render authority per visible layer; is there more than one candidate? **CONFIRMED**

See §1.1. Two layers have two candidates each (CA-1). Every other visible surface has exactly one
drawing module. The *upload* side has a second candidate for both engines (CA-2).

### Q3 — Animation ownership: every RAF / interval / repaint driver in the weather path

| # | Driver | Creation site | Start condition | Stop condition | Cancellation | Can it be created twice? |
|---|---|---|---|---|---|---|
| 1 | Engine fixed-timestep loop | `render-orchestrator.js:144` (re-arm `:132`, gated re-arm `:79`) | `startPluginRenderLoop()` ← `engine-bootstrap.js:74` ← `initEngine` ← `MapWebGL.js` sequencer effect | `_running=false` (`:152`) | `cancelAnimationFrame(_rafId)` `:154` | **No** — `if (_running) return` `:140`, module singleton |
| 2 | Canvas2D coordinator | `CanvasAnimationCoordinator.js:91` (re-arm `:196`; dormant re-arm inside a 500 ms `setTimeout` `:134-136`) | first `register()` (`:78`) | last `unregister()` (`:84`) | `:96` | **No** — `if (this._running) return` `:88`; singleton `:201-204`. **But** `init()` `:62-63` calls `dispose()` which does `this._layers.clear()` (`:102`) — any layer registered *before* `init(mapInstance)` is silently unregistered |
| 3 | Marine self-repaint | `WebGLMarineCustomLayer.js:327` `map.triggerRepaint()` | every frame while `activeRef.current === true` | `!activeRef.current \|\| errorCount > 3` early-return `:156-168`; also the regional-reject `return` at `:290-291` / `:313-314` | n/a (MapLibre owns the frame) | **No** — one layer id, `addLayer` guarded by `if (!mapInstance.getLayer(LAYER_ID))` (`WebGLMarineLayer.js:852`) |
| 4 | Wind self-repaint | `WebGLWindLayer.js:172` | every frame while active | `!activeRef.current \|\| errorCount > 5` `:107-117` | n/a | **No** — guarded at `WebGLWindLayer.js:256` |
| 5 | Marine-canvas opacity fade | `MapWebGL.js:633` (re-arm `:630`) | effect `[mapInstance, activeLayers]` when a marine layer is active | `t >= 1` (`:628-630`) | `:632` pre-cancel, `:635` cleanup | **No** — single `animFrameRef`, pre-cancelled |
| 6 | Timeline scrub coalescer | `MapWeatherControls.js:352` | pointer drag while `isDraggingRef` | one-shot; nulls its ref `:354` | `:319` unmount, `:384`, `:417` | **No** — `if (requestRef.current === null)` `:351` |
| 7 | OceanMask style-sync retry | `OceanMask.js:741,745,842,870` | style/theme/active effects | one-shot per run | `:740,744,757,826,856,880,887` | **No** — pre-cancel before each arm |
| 8 | Tile-flip settle | `useOpenMeteoTileUrls.js:245,655` (+ `triggerRepaint` `:677`) | raster slot flip | one-shot | `:654,666` | **No** — pre-cancel |
| 9 | Marine dispatch defer | `useMarineDataFetcherCore.js:944` `requestAnimationFrame(_runDispatch)` | dispatch scheduling | one-shot | **none** | Yes in principle (no dedupe ref shown at the call site) — but the callback itself is idempotent-guarded upstream. NOT MEASURED |
| 10 | Commit-flag release | `useMarineDataFetcherHelpers.js:603` | after a commit | one-shot | none | one per commit by construction |
| 11 | Model transition | `useModelTransition.js:170` (+ `triggerRepaint` `:227`) | model switch | one-shot | none | per-switch |
| 12 | Raster transaction | `useRasterTransactions.js:69,99,130` (+ `triggerRepaint` `:87`) | raster swap | one-shot | none | per-swap |
| 13 | **WeatherTelemetry FPS monitor** | **`WeatherTelemetry.js:399` start, `:397` re-arm** | **module import** — constructor calls `this.initFpsMonitor()` at `:73`; singleton constructed at `:549` (`export const WeatherTelemetry = new WeatherTelemetryEngine()`), also pinned to `window.__WEATHER_TELEMETRY__` `:550` | **NONE** | **NONE** | **No** (one module instance) — but it **never stops**, including after `/map` unmounts, for the page lifetime |
| 14 | WebGL guardrail FPS | `useWebGLGuardrail.js:183` `mapInstance.on('render', onRender)` | effect on `[mapInstance, …]` | effect cleanup | `off('render')` in cleanup | per `mapInstance` |
| 15 | Layer truth diff | `useLayerTruthDiff.js:210` `on('render')` | effect | cleanup `:216-220` | `off('render')` | **Re-subscribes on every `windData`/`marineData` identity change** (deps line `:222`) — paired `on`/`off`, so no accumulation, but the handler is re-created on every grid commit |
| 16 | Scrub perf probe (dev) | `scrubPerfProbe.js:71,73` | `window.__SCRUB_PROBE__.bench()` | `stopRef.stopped` | none | dev-only; installed by `MapWebGL.js:58` import |
| 17 | Lightning flash tick | `MapWebGL.js:575` `setInterval(…, tickMs=240)` | `activeLayers.includes('radar')` | effect cleanup `:597` | `clearInterval` | **No** — effect-scoped |
| 18 | Lightning strike refresh | `MapWebGL.js:535` `setInterval(refresh, 60000)` | same effect | `:598` | `clearInterval` | No |
| 19 | Timeline autoplay | `hooks/useWeatherState.js:103` `setInterval(tick, 2000)` | play toggle | effect cleanup | `clearInterval` | No |
| 20 | Scrub-settle driver | `useMarineScrubSettle.js:512` `setInterval(…, 150)` | effect | effect cleanup | `clearInterval` | No |
| 21 | Blank/clamp backstop | `useMarineScrubSettle.js:582` `setInterval` | effect (created once; layer-active read via ref, `:583-585`) | effect cleanup | `clearInterval` | No |
| 22 | **ExactPoint cache sweeper** | **`forecastExactPoint.js:63` `setInterval(…, 60000)` at MODULE SCOPE** | module import | **NONE** | **NONE** | No (one module) — never cleared |
| 23 | **Truth-absence sweeper** | **`weatherTruthTracker.js:390` `setInterval(…, 10000)`** | first `recordTruthStage` call (`:389` `if (!_absenceTimer …)`) | **NONE** — grep for `_absenceTimer` returns only `:369` (decl), `:389` (guard), `:390` (assign). No `clearInterval` | **NONE** | No — but never cleared |
| 24 | TruthOverlay poll (dev) | `TruthOverlay.js:69` `setInterval` (+ `triggerRepaint` `:161,223`) | overlay mounted (`MapWebGL.js:958`) | cleanup | `clearInterval` | No |
| 25 | MarineAnimTuner poll (dev) | `MarineAnimTuner.js:105` `setInterval` | tuner enabled (`MapWebGL.js:974`) | cleanup | `clearInterval` | No |

**Verdict for Q3:** three drivers have no stop condition and no cancellation at all — #13, #22, #23.
Only #13 is a per-frame RAF; #22/#23 are low-frequency intervals. Everything else is either
effect-scoped with a paired cleanup or guarded against double-arm.

### Q4 — Is particle motion FRAME-RATE INDEPENDENT? **CONFIRMED: NO.**

**Wind.** The integration step, verbatim:

```
WebGLWindShaders.js:181    vec2 offset = (windMerc / merc_scale) * u_speed_scale;
WebGLWindShaders.js:195      nextPos = pos + (offset / u_tile_width);      // z > 6.0
WebGLWindShaders.js:198      nextPos = pos + offset;                        // z <= 6.0
```

`u_speed_scale` is supplied on the CPU with no time term:

```
WebGLWindEngine.js:546-548  const stableSpeedScale = ((z > 6.0)
                              ? (this.speedFactor * Math.pow(0.5, z) * 0.00025)
                              : Math.max(2.5e-6, this.speedFactor * Math.pow(0.5, z) * 0.00025)) * _rmScale;
WebGLWindEngine.js:741      gl.uniform1f(… 'u_speed_scale'), stableSpeedScale);
```

Inputs: `speedFactor`, `z` (zoom), `_rmScale` (reduced-motion). **No `dt`, no `performance.now`, no
frame delta.** Grep for `u_dt`/`u_deltaTime` across `frontend/src` returns nothing.

**Marine.** Same shape:

```
WebGLMarineParticleShaders.js:199  vec2 offset = (waveVec * driftHeight * 0.1 / merc_scale) * u_speed_scale * energyBoost;
WebGLMarineParticleShaders.js:211    nextPos = pos + (offset / u_tile_width);
WebGLMarineParticleShaders.js:214    nextPos = pos + offset;
WebGLMarineEngine.js:2171          const stableSpeedScale = this.speedFactor * Math.pow(0.5, Math.max(0, z - 6)) * 1.5e-5 * motionScale * _waveSpeedMult * _rmScale;
WebGLMarineEngine.js:2195          gl.uniform1f(… 'u_speed_scale'), stableSpeedScale);
```

Also frame-rate dependent: the **respawn/mortality** model. `WebGLWindShaders.js:265`
`dropRate = max(dropRate * mix(1.0, 0.35, vortexGate), 0.002)` and `:266`
`float drop = step(1.0 - dropRate, rand(seed))` are per-**frame** probabilities, so particle
lifetime in seconds scales with refresh rate too.

`u_time` **is** wall-clock (`WebGLMarineEngine.js:624` `var time = (Date.now() - this._startTime)/1000.0`,
bound at `:1624,2091,3110`), but it feeds the **heatmap/draw** shaders, not the advect pass — grep
shows `u_time` is bound to `heatmapProgram` and `drawProgram` only, never to `advectProgram`.

**Consequence — MEASURED only as a code relation, not on hardware:** at 120 Hz the same wind field
advects particles at exactly 2× the ground speed it does at 60 Hz, and particles die twice as fast in
wall-clock terms. NOT MEASURED on a real display; I did not run the app.

**Contrast:** the Canvas2D fallbacks are dt-correct —
`GPUMarineLayer.js:432` `const speedScale = dt * 1500 * Math.pow(0.62, zoom - 6) * waveSpeedAmp;`
and `WindParticleOverlay.js:56` `return dt * base * Math.pow(0.55, zoom - refZoom);`, both fed the
clamped delta from `CanvasAnimationCoordinator.js:141`
(`var dt = Math.min(50, now - this._lastTime) / 1000;`).

### Q5 — Is there RK4 integration? **CONFIRMED: yes, twice, neither reaches a pixel.**

| Implementation | Location | Used by | Status |
|---|---|---|---|
| `rk4Advect` | `engine/particle-system.js:113-140` | `ParticleSystem.update` `:207`; `FieldEvolutionEngine.js:23` imports `rk4Advect, sampleField` | **ORPHANED for rendering** — driven at 60 Hz from `SimulationLoop.js:243-250`, output attached at `:295,301`, read only by `SimulationHealthMonitor.js:135,137` |
| `advectParticleRK4` | `engine-brain/wind-advection-model.js:94-103` | nothing (single grep hit = its own definition) | **DEAD** |

**Which layers use RK4 vs Euler:** *every* rendering layer uses Euler.
- `webgl-marine-particles` → GPU Euler (`WebGLMarineParticleShaders.js:211,214`)
- `webgl-wind-particles` → GPU Euler (`WebGLWindShaders.js:195,198`)
- `MarineParticleCanvas` → CPU Euler with dt (`GPUMarineLayer.js:432`)
- `WindParticleOverlay` → CPU Euler with dt (`WindParticleOverlay.js:56`)

RK4 exists exclusively in the simulation lane that no renderer consumes.

### Q6 — WebGL state hygiene after custom-layer draw

Both engines wrap their draw in `captureWebGLState` / `restoreWebGLState`
(`WebGLMarineEngine.js:12,599,2305`; `WebGLWindEngine.js:29,447,1027`).

**RESTORED** (`WebGLStateIsolation.js:68-141`): `ARRAY_BUFFER_BINDING`, `ELEMENT_ARRAY_BUFFER_BINDING`,
`VERTEX_ARRAY_BINDING` (WebGL2), `FRAMEBUFFER_BINDING`, `CURRENT_PROGRAM`, `VIEWPORT`,
`TEXTURE_BINDING_2D` for **units 0-6** (`:53,89` — widened from 0-3 by R11-10e, comment `:48-51`),
`ACTIVE_TEXTURE`, `BLEND` enable + `blendFuncSeparate` + `blendEquationSeparate`, `DEPTH_TEST`,
`DEPTH_WRITEMASK`, `STENCIL_TEST`, `SCISSOR_TEST`, `COLOR_WRITEMASK`, `CULL_FACE`.

**NOT RESTORED — code facts, each verified by absence from `captureWebGLState`:**

| Not captured | Mutated where |
|---|---|
| `COLOR_CLEAR_VALUE` (`gl.clearColor`) | `WebGLWindEngine.js:435,437,962,1057,1060`; `WebGLMarineEngine.js:547,610` |
| `SCISSOR_BOX` (only the *enable* is captured) | not observed to be set by these engines |
| `DEPTH_FUNC`, `DEPTH_RANGE` | not observed to be set |
| `STENCIL_FUNC` / `STENCIL_OP` / `STENCIL_WRITEMASK` (only the enable) | not observed to be set |
| `CULL_FACE_MODE` / `FRONT_FACE` (only the `CULL_FACE` enable) | `gl.disable(gl.CULL_FACE)` `WebGLMarineEngine.js:601` |
| `BLEND_COLOR` | not observed to be set |
| `TEXTURE_BINDING_CUBE_MAP` | not observed to be set |
| texture units ≥ 7 | not observed to be used |
| `RENDERBUFFER_BINDING` | not observed to be set |
| `UNPACK_*` pixel-store | set **and locally restored** at every site (`WebGLMarineEngine.js:2470-2472,2664-2666`; `WebGLMarineTextureEncoder.js:40-42,59-67,549-551,736-738`) — self-balanced, so not a gap |

**Two mutations occur BEFORE the capture window in `WebGLWindEngine.render` — CONFIRMED:**

```
WebGLWindEngine.js:411-418   // screen FBO (re)creation — deleteFramebuffer/deleteTexture + createFBO
WebGLWindEngine.js:433-439   gl.bindFramebuffer(gl.FRAMEBUFFER, this.screenA.fbo);
                             gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
                             gl.bindFramebuffer(gl.FRAMEBUFFER, this.screenB.fbo);
                             gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
                             gl.bindFramebuffer(gl.FRAMEBUFFER, null);      // ← line 438
WebGLWindEngine.js:447       const webglState = captureWebGLState(gl);      // ← capture AFTER
```

Because line 438 forces the binding to `null` before line 447 reads it, `state.prevFBO` records
`null` rather than whatever MapLibre had bound when it invoked `render()`. `restoreWebGLState`
(`WebGLStateIsolation.js:84`) then "restores" to `null`.
`WebGLWindEngine.js:398` (`createTexture` for the colour ramp) is also pre-capture, but
`WebGLWindUtils.js:31,45` save/restore `TEXTURE_BINDING_2D` locally, and `createFBO`
(`WebGLWindUtils.js:83-90`) restores `FRAMEBUFFER_BINDING` locally — those two are self-balanced.
**Consequence NOT MEASURED**: whether MapLibre 5.24 ever has a non-default FBO bound at custom-layer
`render()` time (terrain / render-to-texture paths) was not verified against its source.

Both engines' `finally` blocks additionally detach their own `advFBO` colour attachment before
restore (wind: `WebGLWindEngine.js:1022-1027`, ending `restoreWebGLState(gl, webglState)` at `:1027`)
— a deliberate feedback-loop guard.

**A third gap:** `engine.clearBuffers(gl)` is called from `WebGLMarineCustomLayer.js:163` on
deactivation, **outside** any capture/restore. `WebGLMarineEngine.prototype.clearBuffers`
(`:3154-3187`) and `WebGLWindEngine.prototype.clearBuffers` (`:1053-1070`) both call
`gl.bindFramebuffer(gl.FRAMEBUFFER, null)` and `gl.clearColor(0,0,0,0)` with no save/restore.

### Q7 — GPU resource lifecycle

See §3. Summary: **one allocation site with no teardown path and no caller** —
`WindColorRamp.js:280` inside `createRampTexture` (`:278-289`), zero call sites tree-wide. Everything
else in both engines has a matching `delete*` in `WebGLMarineEngineInit.disposeEngine` (`:243-290`)
or `WebGLWindEngineInit` (`:172-200`), with the marine side routing through the accounted
`safeDeleteTexture` choke and the wind side using raw `gl.deleteTexture` (bookkeeping asymmetry,
`WebGLMarineEngineInit.js:259-264` documents the marine-side fix).

Registration teardown: `unregisterMarineEngine()` is called (`WebGLMarineLayer.js:909`);
`unregisterWindEngine()` is called (`WebGLWindLayer.js:281`). Both null the dispatcher's handles.

### Q8 — Shared canvas / clearing conflict? **CONFIRMED: yes, three distinct cases.**

1. **Flag-gated full-canvas clear (by design, debug).**
   `WebGLMarineEngine.js:546-549` and `:609-612`, both guarded by
   `window.__WEATHER_DEBUG_ISOLATE_OVERLAY__ === true`, call `gl.clear(gl.COLOR_BUFFER_BIT)` with
   **no framebuffer bound by the engine** — i.e. against whatever MapLibre had bound, which for a
   custom layer is normally the default framebuffer. That wipes everything drawn beneath. The flag's
   name (`ISOLATE_OVERLAY`) says this is the intent. **Note `:547-548` is also pre-capture** (capture
   is at `:599`), so its `clearColor` change survives the frame.
2. **Offscreen clears (safe).** `WebGLWindEngine.js:962` and `:1057-1061` bind `screenA.fbo` /
   `screenB.fbo` first and rebind `null` after — trail buffers, not the shared canvas.
3. **`clearColor` residue (unrestored).** Every `gl.clearColor` call above leaves the clear colour
   changed after the custom layer returns, because `COLOR_CLEAR_VALUE` is absent from
   `captureWebGLState`. **Consequence NOT MEASURED** — MapLibre does call `clearColor` itself (the
   string appears in `maplibre-gl@5.24.0`'s dist bundle), but I did not trace whether it does so on
   every frame or only on context setup, so I cannot claim a visible artefact.

### Q9 — Stale response handling: can an older response overwrite a newer choice?

| Fetcher | Mechanism | Verdict |
|---|---|---|
| Marine grid (`useMarineDataFetcherCore.js`) | `AbortController` `:454`; monotonic `requestId` checked at `:576` (`if (requestId !== marineRequestIdRef.current) return;`); **plus** intent equality at `:577-579` (`fetchIntent.model/layer/hour` vs the live refs → `stale_async_response_rejected`); in-flight registry `marineInFlightRegistry.js`; transition generation `marineTransitionCoordinator.js:221-244` | **GUARDED (belt + braces)** |
| Wind grid (`WeatherEngine.js`) | supersession token `windFetchGen` `:301,519,529,616`; `AbortController` `:521-522`; **hour** guard `:539-543` (deps deliberately exclude `timeOffsetHours`, so the hour check is the only stale-scrub defence — documented `:530-538`); coverage guard `:549-552` | **GUARDED** |
| Exact point (`forecastExactPoint.js`) | `AbortController` `:409`; in-flight dedupe map; `useExactPointFetch.js:178` per-effect controller | **GUARDED** |
| Open-Meteo point forecast (`hooks/useOpenMeteoForecast.js`) | `abortRef` aborted before each new fetch `:145-147`, `:416-418`, `:628` | **GUARDED** |
| Raster tile URLs (`useOpenMeteoTileUrls.js`) | `AbortController` `:430` + `isMounted` `:427`, effect-scoped | **GUARDED** |
| Spot ratings (`useSpotRatings.js`) | `AbortController` `:268` + debounce `:269` + `controller.abort()` in cleanup `:339`; `AbortError` distinguished from failure `:327` | **GUARDED** |
| Marine/wind grid series (`marineGridSeries.js:414,564`, `windGridSeries.js:180`) | per-call `localController`, plus a named abort handler that is REMOVED in `finally` (`marineGridSeries.js:416`) so a long-lived caller signal doesn't accumulate listeners | **GUARDED** |
| Pressure (`marineControllerPressure.js:173-175`) | module-scope singleton `pressureAbortController`, aborts the previous | **GUARDED at transport; commit-side not exercised (see next row)** |
| **`usePressureEngine.js`** | **NO `AbortController`, NO request id, NO generation counter.** Only `isSubscribed` (`:16,19,37,54,58`), which flips solely on effect teardown. `lastComputedVersionRef` is checked *before* the fetch (`:31`) and set only *after* the whole chain (`:62`), so two `moveend`-driven `handleUpdate` calls can overlap and the later-**resolving** one wins `setLowSystems/setHighSystems`. | **UNGUARDED — but DEAD** (no importer; `MapWebGL.js:118-119` stubs `lowSystems`/`highSystems` to `[]`) |
| Marine background prewarm (`marineController.js:312`) | deliberately **no** abort signal — comment at `:312` states it must survive the pan/zoom that started it | **BY DESIGN** |

**Answer:** among *reachable* fetchers I found **no** path where an older response can overwrite a
newer user choice — every live one carries either a generation token or an intent-equality check (or
both). The single unguarded fetcher, `usePressureEngine`, is dead code.

### Q10 — OceanMask authority: who decides land vs sea, at what resolution, how many maskers?

**There are four maskers, and `OceanMask.js` is not the one the physics reads.**

| # | Masker | What it decides | Resolution | Reachable? |
|---|---|---|---|---|
| 1 | `OceanMask.js` | **Visual only** — paints Natural Earth land over the basemap and re-stacks basemap landuse/inland water. `NE_LAND_URL` = Natural Earth 10 m (`OceanMask.js:30`), fetched via `getSharedLandGeoJSONHiRes` (`mapUtils.js:509`, 10 m URL at `:507`) | vector polygons | **ACTIVE** — `MapWebGL.js:1001` |
| 2 | `WebGLMarineMaskRenderer.renderMaskToCanvas` (`:515`) | **The physics mask.** Rasterises land GeoJSON into the ocean-mask texture the marine shader samples | tiered by longitude span: `<10° → 4096 px`, `<30° → 2048 px`, else `4096` (or `window.__RAW_WORLD_MASK_WIDTH__`) — `maskCanvasWidthForSpan` `:486-491` | **ACTIVE** — `WebGLMarineEngine.js:2461,2602`; `WebGLMarineTextureEncoder.js:535,693` |
| 3 | `overlayBasemapWaterOnMask` (`WebGLMarineMaskRenderer.js:96`) | Repaints the mask inside the padded viewport from the **basemap's OSM water polygons** — land-black then ocean/sea-class water white. Gated on `isBasemapWaterSourceReady` (`:46`) | basemap tile resolution | **ACTIVE** — `WebGLMarineEngine.js:2462,2603` |
| 4 | `applyInlandWaterGuard` (`inlandWaterGuard.js:89`, core `classifyInlandWater` `:25`) + `reassertNeLand` (`WebGLMarineMaskRenderer.js:79`) + `suppressShelteredWater` (`marineMaskShelter`) | Re-blacks basemap water further than `__RAW_INLAND_WATER_KM__` (default 10 km) from Natural-Earth water; re-asserts NE islands | same canvas | **ACTIVE** — `WebGLMarineMaskRenderer.js:276,291` |
| 5 | `vectors[i].isOcean` from the grid itself | Per-cell land flag carried in the data, encoded into the mask alpha channel (`RenderPlanDispatcher.js:392` comment: *"isOcean flag is REQUIRED by WebGLMarineEngine's shader (alpha channel = land mask)"*) | grid resolution | **ACTIVE** — and it is the **only** land/sea decider in the Canvas2D fallback (`GPUMarineLayer.js:100-107,142-143,206-214`) |

Composition order inside one mask build (all in `WebGLMarineMaskRenderer.js`):
`renderMaskToCanvas` → `overlayBasemapWaterOnMask` → `applyInlandWaterGuard` (`:276`) →
`reassertNeLand` (`:291`). This is a documented pipeline, not an accident.

**The genuine duplication is between lanes, not inside the pipeline:** the WebGL lane decides land/sea
from the 4-stage raster mask, while the Canvas2D fallback lane decides it from `isOcean` alone
(`GPUMarineLayer.js:143` `if (typeof cell.isOcean === 'boolean') return cell.isOcean;`). A fallback
activation therefore changes the coastline definition, not only the renderer. `maskFloodProbe.js` is
a diagnostic probe (`:201` `m.triggerRepaint()`), not a masker.

---

## 5. RESIDUAL UNCERTAINTY / BLOCKED

- **B1.** Whether MapLibre 5.24 ever binds a non-default framebuffer at custom-layer `render()` time.
  Would unblock the *consequence* of the pre-capture `bindFramebuffer(null)` at
  `WebGLWindEngine.js:438`. Unblocked by: reading `node_modules/maplibre-gl/dist/maplibre-gl.js`
  `Painter.render` around the `custom` layer dispatch, or a live `gl.getParameter(FRAMEBUFFER_BINDING)`
  probe inside `render()`.
- **B2.** Whether MapLibre re-issues `gl.clearColor` every frame. Would unblock the consequence of the
  unrestored clear colour. Same unblocker.
- **B3.** Actual frame-rate sensitivity of particle ground speed on a 120 Hz display. The code
  relation is proven; the number is not measured. Unblocked by: running the dev frontend with a
  frame-rate cap and comparing particle displacement per wall-clock second.
- **B4.** CPU cost of the orphaned RK4 loop (6,000 + 3,000 particles at up to 4 fixed steps per frame,
  `render-orchestrator.js:27,95-107`). Not profiled.
- **B5.** Whether `useMarineDataFetcherCore.js:944`'s bare `requestAnimationFrame(_runDispatch)` can
  be armed twice concurrently. The call site shows no dedupe ref; upstream guards were not traced to
  the point of proof.

---

## 6. HOW TO RE-RUN THE KEY CHECKS (read-only)

```
# 1. Every custom layer, exhaustively
rg -n "type:\s*'custom'" frontend/src

# 2. The integration step — must show no dt term
rg -n "nextPos = pos|vec2 offset = " frontend/src/components/map/WebGLWindShaders.js \
                                     frontend/src/components/map/WebGLMarineParticleShaders.js
rg -n "stableSpeedScale" frontend/src/components/map/WebGLWindEngine.js \
                         frontend/src/components/map/WebGLMarineEngine.js

# 3. RK4 consumers — must return exactly 4 hits, none of them a renderer
rg -n "rk4Particles" frontend/src

# 4. The dead ramp allocator — must return only its definition + one comment
rg -n "createRampTexture" frontend/src

# 5. The dispatcher's gates
rg -n "__ALLOW_FCE_(WIND|MARINE)_UPLOAD__" frontend/src/engine/RenderPlanDispatcher.js

# 6. The unstoppable RAF
rg -n "initFpsMonitor|new WeatherTelemetryEngine" frontend/src/components/map/WeatherTelemetry.js

# 7. Dead pressure hook
rg -n "usePressureEngine" frontend/src
rg -n "const lowSystems" frontend/src/components/map/MapWebGL.js
```

---
---

# APPENDIX F — ARCHITECTURAL INVARIANT AUDIT (Agent F)

*Appended 2026-08-09 by Agent F (upgrade-program status reconstruction). Everything above this line was
written by Agent B1 and is unmodified. Companion deliverable:
`audit/weather-simulation-11.0/UPGRADE_STATUS_MATRIX.md`.*

**Baseline:** HEAD `9f4f85708e765741d51ac2812de5a36373ac514b`, branch `dev`, tree clean except `?? audit/`.
(The brief's `3d3ccdc2` is HEAD~1 — a docs-only commit landed on top.)

**Status vocabulary:** Preserved / Partially Preserved / Violated / Superseded / Unable to verify.

**How to read the two evidence columns.** *Runtime evidence* = what is reachable and what actually
executes, traced from `App.js:153` to `MapPage` to `MapWebGL` (or from a route handler on the backend);
where I executed something, the output is quoted. *Code evidence* = `file:line`. **Where I could not
observe runtime — no browser, no server, read-only audit — the runtime column says so explicitly rather
than inferring.** That is the difference between "this code path is reachable" (verifiable statically)
and "this code path ran" (not verifiable here).

**Relationship to `MASTER_WEATHER_SIMULATION_REPORT_11.0.md` §6.** That report audits 20 invariants. This
table covers the 25 named in Agent F's brief, which overlap but are not the same list. Where both cover
an invariant and agree, the row says so. Where I reach a **different** conclusion or add a decisive
artefact the report does not carry, the row is marked with a warning sign.

| # | Invariant | Status | Runtime evidence | Code evidence | Risk |
|---|---|---|---|---|---|
| F-1 | **One forecast-time owner** | **Partially Preserved** | One `useState` holds the hour; consumers read mirrors. Not runtime-observed — established by exhaustive static search for competing `useState`. | Sole owner `hooks/useWeatherState.js:45` `const [timeOffsetHours, setTimeOffsetHours] = useState(0)`. One-way mirrors: `useMarineOrchestrator.js:122` writes `window.activeTimeOffsetHours`; read at `RenderPlanDispatcher.js:480`. Harness setter `MapPage.js:212` `window.setTimeOffsetHours = setTimeOffsetHours` invokes the owner (not a second owner). | Skew, not conflict. A new consumer reading the window global inherits the weakest sync. Agrees with Report 11 inv-17. |
| F-2 | **One model-selection owner** | **Preserved** | Same method as F-1. | `useWeatherState.js:16` `const [activeModel, setActiveModel] = useState(...)`; the only other `setActiveModel` references are the harness exposure (`MapPage.js:211`) and two prop passes (`:542`, `:565`). | Low. `window.setActiveModel` is a real setter reachable from the console — fine for the scrub harness, a footgun if product code starts using it. |
| F-3 | **One layer-selection owner** | **Preserved** | Same method. Permissions are a separate single authority. | `useWeatherState.js:44` `const [activeLayers, setActiveLayers] = useState([])`; access decided solely by `LayerAccessResolver.js` (`frontend/system-brain/weather-simulation-system.md:132` states it is the ONLY permissions authority; no parallel gating found in the audited map path). | Low. |
| F-4 | **One normalization contract** | **Partially Preserved** (differs from Report 11) | Ordering: single site, verified by exhaustive grep. Period statistic: **not** contracted — established by reading all four fetchers' variable maps. | ONE sort site: `rg "sort\(key=lambda v: \(v\.lat, v\.lng\)\)" backend/services/weather_pipeline` returns `normalizer.py:504` only. The competing frontend pipeline is dead (`engine/data/model-normalizers.js`, zero real imports). **But** `wave_period` carries three different statistics under one tag: PEAK `noaa_gfs_wave_fetcher.py:49`, mean tm10 `dwd_gwam_fetcher.py:44`, mean VTM10 `copernicus_global_fetcher.py:35`, plus a silent per-value peak-to-mean substitution `ecmwf_opendata_fetcher.py:522-525`; declared only as `units.period = 'seconds'` (`schemas.py:178-182`), consumed by two documented **peak**-period functions (`surf_transform.py:92-101`, `surf_rating.py:126-135`). | Report 11 inv-15 rates this **Preserved** on the strength of the single sort site. That is right about *ordering* and silent about *meaning*: a field whose statistic varies by source is a normalization hole even with a perfect sort. Pack E1 measured -3% to -7% on height, up to -6.3 rating points. |
| F-5 | **One grid-orientation contract** | **Preserved** | Not runtime-observed. Four independent links traced statically end-to-end and they agree. | Asset row 0 = south (`etopo_depth_0p25.meta.json` lat0 -90; index `bathymetry.py:72-73`); API sorts lat ASCENDING (`normalizer.py:504`); encoder writes flat order with `UNPACK_FLIP_Y_WEBGL=false` (`WebGLMarineTextureEncoder.js:40-41,59-62`); shader `tex_v = (lat - south)/(north - south)` (`WebGLMarineShaders.js:327,66`). No explicit row reversal anywhere; the only reversal code (frontend `GridParserWorker`) is dead. | Contract is comment-enforced between normalizer and encoders. A normalizer-bypassing fetcher would ship inverted rows undetected. Agrees with Report 11 inv-2/4 and pack E1-07. |
| F-6 | **One longitude convention** | **Preserved** | Not runtime-observed; per-source auto-detection read in the shared helper. | `_fetch_common.build_regular_nn` auto-detects 0-360 via `lon1d.max() > 180`; final wrap to +/-180 plus sort in exactly one place (`normalizer.py`). EURO antimeridian dead column repaired in two idempotent places (backend mirror plus a wind-texture-only frontend repair). | Low; the frontend-only repair means an equivalent artefact in another lane relies on the backend mirror alone. Agrees with Report 11 inv-16. |
| F-7 | **One direction convention per variable** | **Preserved** | Pack E1 **executed** the consumers: `offshoreness(270,270) = -1.000`, `offshoreness(90,270) = +1.000`, `swell_exposure(270,270) = 1.000`; u/v round-trip returns the input bearing exactly. I re-read the code sites, not the probe. | All lanes FROM-convention, unrotated: `noaa_gfs_wave_fetcher.py:50,57,58`, `dwd_gwam_fetcher.py:44,47,50`, `copernicus_global_fetcher.py:35-38`, `ecmwf_opendata_fetcher.py:344`; wind synthesised `_fetch_common.py:491-493` (`(270 - atan2(v,u)) % 360`). Consumers share the frame with correctly opposite optima: `surf_rating.py:138-147` (wind, `-cos`) vs `:386-395` (swell, `+cos`). The only rotation in the pipeline is `+40` degrees at `normalizer.py:331`, gated by `MARINE_PARTITION_RATIO_FALLBACK` default `'0'` (`:313`). | Low. The "180-degree error" hypothesis is **refuted**, not open. |
| F-8 | **One projection contract** | **Partially Preserved** (adds the exact drift site) | Not runtime-observed. Copy census done by grep at HEAD. | Authority is single (MapLibre's own matrix; no `MercatorCoordinate` usage). **Formula is not**: 6 GLSL definitions of `float latToMercatorY` (`WebGLMarineParticleShaders.js:86,402`; `WebGLMarineShaders.js:15,93`; `WebGLWindShaders.js:103,421`) plus 6 JS copies (`mapUtils.js:118`, `marineEngineDecisions.js:27`, `marineMaskProjection.js:123`, `WebGLMarineMaskRenderer.js:568`, `WebGLWindEngine.js:32`, inline lambda `WebGLMarineEngine.js:2693`) plus a constant `maskSmoothing.js:18` plus one dead util `engine-brain/projection-utils.js`. **Clamp drift: `WebGLWindShaders.js:803` `clamp(lat, -85.0511, 85.0511)`** vs `85.051129` everywhere else (and `85.05112878` in the dead util). | Report 11 inv-1 names the drift; this row supplies the **exact site and the 12-copy count**. Copies can desynchronize silently — no test cross-checks them. |
| F-9 | **One field-composition path** | **Superseded** | Reachable and executing every frame, uploading nothing. Gate state established by exhaustive search for a setter. | Superseded 2026-05-31 by `45072247` ("disable FCE texture override"). Still wired: `WebGLMarineCustomLayer.js:87` and `WebGLWindLayer.js:39` register unconditionally; `engine-bootstrap.js:80` `startDispatcher()`; `RenderPlanDispatcher.js:270,279`. Barrier = two window booleans (`:447`, `:470`); a tree-wide search for `__ALLOW_FCE_MARINE_UPLOAD__` / `__ALLOW_FCE_WIND_UPLOAD__` finds **all four writes inside `__tests__/dispatcher.domainGates.test.js:74-94`**. Live authority instead: `decideMarineCommit` via `engine.setWaveData`. | **New this pass:** the dormant recovery arm at `:595` reads `localStorage['rawsurf_marine_cache_v9']` (`:41`); the writer moved to `v10` at `8bd8685a` (2026-06-01) and now lives at `marineControllerCache.js:24`. So the path behind the gate has been **broken for 69 days** — if enabled during an incident it returns null, silently. Reported in no pack, handoff, memory index or report. |
| F-10 | **One render owner per layer** | **Preserved** | Not runtime-observed; render tree read statically. | Exactly two MapLibre custom layers exist (search for `type: 'custom'` returns `WebGLMarineCustomLayer.js:78`, `WebGLWindLayer.js:29`); each self-drives via `map.triggerRepaint()` (`:327`, `:172`); state capture/restore wraps every draw. Canvas2D fallbacks draw to their own DOM canvases and are mutually exclusive by JSX ternary (`MapWebGL.js:1027-1048`, `:1071-1089`). | Low. One latent hazard: the wind engine clears its FBOs **before** `captureWebGLState` (`WebGLWindEngine.js:434-438` vs `:447`), so the "restored" FBO is one the engine set itself — harmless on the flat-map default framebuffer, a corruption vector if terrain/RTT is ever enabled. |
| F-11 | **No competing RAF loops** | **Violated** | Not runtime-observed. Census by static call-site enumeration: 45 non-test `requestAnimationFrame(` calls across 24 files in `frontend/src`. | Three **persistent** loops in the healthy path: MapLibre's frame (triggerRepaint-driven); the engine loop `render-orchestrator.js:144` (60 Hz, renders nothing — see F-18); **`WeatherTelemetry.initFpsMonitor` `WeatherTelemetry.js:380-399`** — no stored id, a `cancelAnimationFrame` count of **0** in that file, instantiated at module scope `:549` with the constructor calling it at `:73`, imported by `MapWebGL.js:4` **and** `openMeteoProtocol.js:2`. A fourth appears in fallback (`CanvasAnimationCoordinator.js:94-98`, which *is* a correct dt-clamped single owner). | The FPS loop runs on **every screen of the app forever** after one map visit. Agrees with Report 11 inv-8; the doctrine at `render-orchestrator.js:12` ("ONE single RAF loop (no duplicates)") is true per-domain and false globally. |
| F-12 | **No duplicate GPU upload path** | **Partially Preserved** | Reachable, fail-closed. | Two writers exist and both go through engine mutation APIs. Live: the `decideMarineCommit` choke — every feeder funnels through it. Dormant: `RenderPlanDispatcher.js:458` `_windEngine.setWindData(...)` and `:611` `_marineEngine.setWaveData(...)`, each behind a window boolean with zero production setters. **Gate asymmetry:** the marine gate `return`s out of the whole function (`:471`) while the wind gate skips only its block (`:453-467`) — the comment at `:445-446` shows this asymmetry was already fixed once, in the other direction. | Two console assignments re-open the exact defect `45072247` closed, whose commit body describes the user-visible symptom ("heatmaps not updating on scrub"). Agrees with Report 11 inv-11. |
| F-13 | **No shared-canvas clearing conflict** | **Partially Preserved** | Not runtime-observed. | GL clears are engine-owned and FBO-scoped. Canvas2D clears are owner-only (`GPUMarineLayer.js:380`, `WindParticleOverlay.js:260,265,282`) — **except** `MapWebGL.js:620-623`, which reaches across ownership: `document.getElementById('marine-canvas-layer')` then `getContext('2d')?.clearRect(...)`, where that id belongs to the fallback canvas (`GPUMarineLayer.js:258` default `id = "marine-canvas-layer"`, mounted at `MapWebGL.js:1042`). Additionally `engine.clearBuffers(gl)` is invoked from `WebGLMarineCustomLayer.js:163` entirely **outside** any capture/restore, and both implementations (`WebGLMarineEngine.js:3154`, `WebGLWindEngine.js:1053`) call `bindFramebuffer(null)` plus `clearColor(0,0,0,0)` unguarded. | Benign today (idempotent deactivation clears) but it bypasses the coordinator's ownership model; any future renderer reusing that DOM id inherits an invisible external eraser. Agrees with Report 11 inv-10. |
| F-14 | **No stale response overwriting newer state** | **Preserved** (one dead exception) | Not runtime-observed; every reachable fetcher's guard read at its call site. | Marine: `useMarineDataFetcherCore.js:454` (AbortController), `:576` monotonic request-id, `:577-579` intent equality producing `stale_async_response_rejected`. Wind: `WeatherEngine.js:519,529` generation plus `:539-543` hour guard plus `:549-552` coverage guard. Also guarded: `useOpenMeteoForecast.js:145-147,416-418`, `useOpenMeteoTileUrls.js:427,430`, `useSpotRatings.js:268,339`, `marineGridSeries.js:414,564`, `windGridSeries.js:180`. The **one** unguarded fetcher, `usePressureEngine.js:11-77` (only `isSubscribed`; `lastComputedVersionRef` read `:31` and written `:62`), **is dead code** — no importer; `MapWebGL.js:118-119` substitutes `useMemo(() => [], [])`. | Low. `commitMarineData` itself does not hard-reject a mismatched hour — protection depends on callers passing the gates. Agrees with Report 11 inv-18. |
| F-15 | **No renderer-specific compensation for upstream orientation mistakes** | **Preserved** in the normal path; **does not hold on two fallbacks** | Not runtime-observed; both orientations traced to their contracts. | Two orientations exist **by contract, not by compensation**: data textures lat-linear with `FLIP_Y=false` (`WebGLMarineTextureEncoder.js:40-41`), masks mercator-rasterised with `FLIP_Y=true` (`:549-551`, `WebGLMarineEngine.js:2470,2664`), each with one canonical sampling formula. No shader inverts a value or flips a row to fix an upstream error. | The dual convention is intrinsically confusable and the encoder documents the exact cross-sampling failure in its own comment (`WebGLMarineTextureEncoder.js:522-525`: the grid mask is linear in latitude, so sampling it with `mask_v` reads the wrong row, e.g. lat 28 degrees reads about lat 7) — and **two fallback branches still bind the grid mask into that slot** (`:555` catch-path, `:559` no-geojson path). Pack E1-08 computed the error at up to 17.1 degrees of latitude for a world frame. |
| F-16 | **No model-specific assumptions leaking** | **Preserved** | Not runtime-observed. | 0-360 vs +/-180 auto-detected per source; ICON's icosahedral cloud handled pole-safe; ECMWF's absent `pp1d` substituted per-value at the fetcher (`ecmwf_opendata_fetcher.py:522-525`) rather than downstream; provider dispatch key kept separate from true origin (`provider` stays `'open-meteo'`, truth in `source_dataset` / `upstream_provider`). | The ECMWF substitution *is* a model-specific behaviour, but it is confined to the fetcher — it leaks as a **statistic** mismatch (F-4), not as a convention. Agrees with Report 11 inv-16. |
| F-17 | **No hidden legacy renderer active** | **Preserved** (corrects pack A2-04) | Not runtime-observed; render tree read statically. | `GPUMarineLayer` / `WindParticleOverlay` are **failure fallbacks**, mutually exclusive by ternary (`MapWebGL.js:1027-1048`, `:1071-1089`), entered on `webglcontextlost` (`:713-719`) or the persisted flags (`:94-95`). Dead legacy is genuinely dead: `render-pipeline.js`, `tile-streaming-system.js`, `IndustryPluginRuntime.js`, `FieldInterpolator.js`, `engine/layer-plugins/*`, `engine/layer-renderers/webgl-layer.js`, and all 11 `engine-brain/*` modules — **zero non-test importers** (the 4 with importers are imported only by other unreachable modules). | **Correction to pack A2-04**, which reports the two as "legacy and replacement coexisting for 81 days" because both are imported by `MapWebGL.js`. The import is real; the runtime coexistence is not. The real risks in that pair are F-22 (a fallback changes the coastline) and the dt asymmetry in the matrix section 1.4 — neither named by A2-04. Also: `force_marine_fallback` / `force_wind_fallback` **persist in localStorage**, so one debugging session pins a browser to the fallback indefinitely. |
| F-18 | **No hidden layer doing expensive work** | **Violated** | Not runtime-observed — **no profiler was run**. Cost is inferred from declared counts and loop cadence, and is stated as inference, not measurement. | (a) `SimulationLoop.js:62-63` advects **6,000 wind plus 3,000 marine particles at 60 Hz** through RK4 (`particle-system.js:113,207`, driven `SimulationLoop.js:243-250`) whose only consumer is a health counter — a tree-wide search for `rk4Particles` returns exactly 4 hits: 2 writes plus `SimulationHealthMonitor.js:135,137`. (b) `render-orchestrator.js:144` runs 60 Hz and calls `updatePlugins` / `renderPlugins` (`LayerRegistry.js:309-320`) over a registry where **every** entry is `enabled: false` (`:340`) and `setPluginEnabled` (`:281`) has **zero callers** — structurally no-op, not merely idle. (c) `FieldCompositionEngine` composes at about 4 Hz for diagnostics (`SimulationLoop.js:53`). (d) the always-on FPS RAF (F-11). | Report 11 inv-8 notes the loop "spins 60 fps with zero visible layers (bookkeeping only)". This row supplies the **mechanism** — no plugin can ever be enabled — which upgrades it from "currently idle" to "unreachable by construction". Magnitude of the battery/CPU cost is **NOT MEASURED**. |
| F-19 | **No resource ownership without teardown** | **Preserved** (one dead exception) | Not runtime-observed; create/dispose pairs read. | Symmetric dispose paths: marine `WebGLMarineEngineInit.js:119-207` create vs `:243-290` dispose; wind `WebGLWindEngineInit.js:54-151` vs `:172-200`. Coordinator self-stops (`CanvasAnimationCoordinator.js:100-116`). One deliberate retention documented with its rationale (`WebGLMarineEngine.js:3167`, coarse-base LRU, freed at `:3189`). The one allocation with **no** teardown, `WindColorRamp.js:278-289` `createRampTexture`, also has **no caller** (a tree-wide search returns its definition plus one comment). | Low. The retain policy holds tens of MB of GPU memory while layers are toggled off — an accepted trade that is invisible to a naive leak audit. |
| F-20 | **No texture / buffer / worker / listener leak** | **Partially Preserved** | Not runtime-observed. Counts are static. | Textures and buffers: see F-19 — clean. Workers: **no leak, because there are no live weather workers** — `engine/workers/forecast-decode-worker.js` has zero importers; `useGridWorker` is imported only by the dead `usePressureEngine`; the one live worker is `hooks/useSessionTracker.js:22` (GPS). Listeners: `components/map` is 35 `addEventListener` to 33 `removeEventListener` — near-balanced, and the residual is not necessarily a leak since some adds sit outside effects. **Timers that never clear:** `forecastExactPoint.js:63` `setInterval(..., 60000)` at module scope with no `clearInterval` in the file; `weatherTruthTracker.js:390` `_absenceTimer = setInterval(..., 10000)` with no `clearInterval` anywhere (searching `_absenceTimer` returns only `:369` decl, `:389` guard, `:390` assign). Plus the F-11 RAF. | Three unbounded time-driven lanes with no deadline. Report 11 Phase 1 already lists "the three unbounded frontend lanes' deadlines". |
| F-21 | **Heatmap + legend + cursor + infobox share one run / hour / unit / field** | **Violated** | Not runtime-observed; the divergence is structural and was measured by packs B2 and E1 with probes I did **not** re-run. I verified the code facts that permit it. | **Field:** the heatmap band composes via `surf_rating.py:738` `estimate_surf(sp, period, depth, coastal=True, shelf_width_km=width)` — 5 args, no geometry — while the infobox and glyphs go through `surf_point.estimate_surf_at` (10 kwargs, `surf_point.py:258-267`). **Run:** `point_resolution.py:36-50` `_selection_key` returns `(diff, resolution, area)` — `run_time` is **not** a term; `spot_ratings.py` resolves marine (`:94`) and wind (`:124`) independently, and its own comment at `:127-129` records that they shared a run at **0 of 4 spots** measured 2026-07-31. **Unit:** the payload carries `value_unit` / `display_unit_hint` (20 assignment sites) and the frontend **never reads them** — every conversion is hardcoded (`heightUnits.js:9,38`, `MapForecastOverlay.js:444`). **Hour:** one owner plus six one-way mirrors (F-1). | The most consequential violation in this table alongside F-9's live half. Both are the same root shape: a second composition path the parity guard cannot see (`test_rating_composition_parity.py:93-205` enumerates three surfaces; the band is a fourth, and `sim_rating.py:9-11` asserts in prose that only three exist). |
| F-22 | **One ocean-masking authority** | **Violated** | Not runtime-observed; the three deciders read at their call sites. | The WebGL lane composes four stages: `WebGLMarineMaskRenderer.js:515` `renderMaskToCanvas`, then `:96` `overlayBasemapWaterOnMask` (OSM basemap water), then `:276` `applyInlandWaterGuard`, then `:291` `reassertNeLand`. The style tier is separate: `OceanMask` (`MapWebGL.js:12`, rendered `:1001`), five basemap style layers. The Canvas2D fallback decides from a **third** authority: `GPUMarineLayer.js:143` `if (typeof cell.isOcean === 'boolean') return cell.isOcean;`. Report 11 inv-6 counts five mechanisms over three data sources, plus a sixth on the spot side. | **A fallback activation changes the definition of the coastline, not just the renderer** — and the fallback flags persist in localStorage (F-17). Every historical mask defect was a coordination failure between two of these, and each fix added a compensation layer. Agrees with Report 11 inv-6. |
| F-23 | **Loading state == actual readiness** | **Partially Preserved** | Not runtime-observed. Established by tracing every `isLoading` consumer in the map path. | The only user-facing loading state in the map is the **infobox's**: `MapPage.js:261` `isLoading: forecastLoading` from `useOpenMeteoForecast`, passed at `:594` into `MapForecastOverlay.js:42,532,693` and `forecastCardCompiler.js:206,221,226,231,250` ("Loading" vs "--"). **The heatmap has no readiness signal at all** — it holds the last committed frame; the honest-degradation machinery (labelled stale fallbacks, `far_edge_hold`, `frame_substituted`) reports in telemetry, not in the UI. | The infobox's "Loading" is honest for the infobox. The map's silence means a stale frame and a fresh frame are visually indistinguishable — exactly the condition under which F-9's historical defect ("heatmaps not updating on scrub") went unnoticed. Not a defect per se; an **absent instrument** on the surface users actually look at. |
| F-24 | **Cached data cannot mix runs** | **Violated** | Not runtime-observed; cache keys read at every construction site. | `run_time` appears in **no** cache key: `providers/open_meteo_provider.py:284,573`; `route_helpers.py:147-154` (`viewport_{model}_{domain}_{layer}_{valid_time}_{bbox}`); `routes/weather.py:504`; `sim_forecast.py:127`. Product filenames are valid-time-keyed and explicitly "immutable-per-filename" (`store.py:350`), so a new run **overwrites the same filename** and `ProductStore._product_cache` (`store.py:282-284`, 300 s TTL) can serve the superseded run. Compounding: `run_time` is ingest wall-clock everywhere (`scheduler.py:84,293,410,517`; `normalizer.py:143-144` defaults to `now`), and the NOAA fetcher computes the true cycle (`noaa_gfs_wave_fetcher.py::_pick_cycle`) then **discards** it. | Marine, swell and wind legs of one payload can come from three different model runs, and nothing in the payload would say so. Report 11 Phase 3 already names the fix ("True cycle identity `cycle_dt` plus `ingested_at` split"); it is Not started. |
| F-25 | **ONE FORECAST COMPOSITION — every surface showing surf height/quality uses `resolve_surf_geometry` + `estimate_surf_at` then `compute_surf_rating`** *(the CLAUDE.md binding rule)* | **Partially Preserved** | Not runtime-observed for the band. The sim's compliance **was** verified by execution in pack E1 (CLAUDE.md's five-point sweep reproduces digit-for-digit once the unstated wind direction 045 is supplied) and I re-read the delegation sites. | Compliant: `spot_ratings.rate_one_spot` (the reference), `spot_conditions.py:53-71`, `services/surf_conditions.py:91-95`, and the sim — `sim_rating.py:30` imports `estimate_surf_at, resolve_surf_geometry`, `:239` height, `:293` quality, with no private physics copy. **Non-compliant: the map band.** `surf_rating.py:703` imports `estimate_surf` directly; `:738` calls it bare; identical shape at `surf_transform.py:790`. Reached by default (`SURF_RATING` / `SURF_TRANSFORM` both `"1"`, `grid_resolver_surf.py:30,86`) from `/api/weather/grid?surf=1` and `/grid_series`. | **The rule's own guard cannot see the violation** (F-21). The two historical incidents CLAUDE.md cites (+19% sim, 93% hub) were the same shape. This is the highest-value single open item in the upgrade program. |

## Summary of this table

| Status | Count | Invariants |
|---|---|---|
| **Preserved** | 9 | F-2, F-3, F-5, F-6, F-7, F-10, F-14, F-16, F-19 |
| **Preserved with a correction to an input pack** | 1 | F-17 |
| **Partially Preserved** | 8 | F-1, F-4, F-8, F-12, F-13, F-15, F-20, F-23 |
| **Violated** | 5 | F-11, F-18, F-21, F-22, F-24 |
| **Partially Preserved, violating surface named** | 1 | F-25 (the map band) |
| **Superseded** | 1 | F-9 |
| **Unable to verify** | 0 | — |

**Two invariants share one root cause and should be fixed together: F-21 and F-25.** Both are the map
rating band re-deriving the breaking height outside the mandated chain (`surf_rating.py:738`), and both
are invisible to `test_rating_composition_parity.py` because it enumerates three surfaces and the band
is a fourth. The cheapest first move changes no physics: **add the band to that test's `SURFACES` list**
so the divergence becomes a number the suite reports, before anyone decides how to close it.

**Three invariants share a second root cause — Program A was superseded and never retired:** F-9
(field composition), F-11 (competing loops) and F-18 (hidden expensive work) all trace to
`frontend/src/engine/*` continuing to boot on every map mount after `45072247` (2026-05-31) removed its
purpose. That subsystem is 24-plus modules with zero reachable consumers. Retiring it closes three
invariants at once and removes the two window booleans that stand between the tree and a reinstated
two-writer GPU defect.

**BLOCKED (stated, not inferred).** No runtime observation was possible in this audit: no browser, no
server, no production API load. Every "runtime evidence" cell above is a *reachability* trace or a quoted
execution of a pure backend function — never an observation of the running app. Specifically unmeasured:
the CPU and battery cost of F-18; the real-world lifetime of the F-11 FPS loop; whether the `userTier`
transition that strands the engine (matrix section 1.1a) occurs in practice; and the current Render
environment-variable state, which bounds the true value of every flag-gated row.
