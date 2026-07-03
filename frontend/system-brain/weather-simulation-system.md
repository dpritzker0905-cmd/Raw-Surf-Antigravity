# Weather & Marine Simulation System Codebase Tracker
*System Brain & Codebase Organizational Tracking Ledger*

> [!WARNING]
> **PARTIALLY STALE (flagged by the 2026-07-03 system audit — last substantive update 2026-06-02).**
> The FCE / SimulationLoop / RenderPlanDispatcher pipeline documented below is **DISABLED for the
> MARINE path** (kill: `__ALLOW_FCE_MARINE_UPLOAD__`): marine renders via
> `useMarineOrchestrator` → `useMarineDataFetcher*` → `useMarineWindData` (the LAST vector
> conform before the GPU — fields not on its explicit list are DROPPED) →
> `WebGLMarineLayer` → `WebGLMarineEngine` + `WebGLMarineTextureEncoder`/`ParticleShaders`.
> Ingestion is DECOUPLED (GitHub-Action cron → Supabase L2 → Render serve-only; NOAA/DWD/Copernicus
> direct). Before debugging from this document, read
> `docs/audits/AUDIT-2026-07-03-weather-system.md` §4 for the current front-to-back map.

This document serves as the high-fidelity source of truth for the **Raw Surf OS Map Weather & Marine Simulation System**. It details the architectural bounds, component contracts, binary WASM protocols, GPU-accelerated rendering pipelines, and stabilization checklists necessary to maintain pristine performance and zero regressions.

> [!NOTE]
> For the active backend-owned weather ingestion engine migration status and GFS/Copernicus API data contracts, see the [Weather Backend Migration Roadmap](file:///c:/Users/dprit/Raw-Surf/docs/architecture/weather-backend-migration-roadmap.md).

---

## 1. High-Level Architecture Map

The system uses a strict **Domain Separation** philosophy, isolating standard UI components, React hooks, mathematical advection physics, GPU custom layers, and direct binary GRIB decoding.

```
                  ┌─────────────────────────────────────┐
                  │          React UI / Controls        │
                  │   MapWebGL.js  |  MapForecastCard   │
                  └──────────────────┬──────────────────┘
                                     │
                     Updates / State │ Subscriptions (10Hz)
                                     ▼
                  ┌─────────────────────────────────────┐
                  │       useRenderPlanBridge.js        │
                  │    (React ↔ Engine Loop Bridge)     │
                  └──────────────────┬──────────────────┘
                                     │
                        Bind Field   │ Evolved RenderPlan
                        & Config     │ (Position + Vectors)
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        Simulation Engine Core                          │
│                                                                        │
│  ┌─────────────────────────┐               ┌────────────────────────┐  │
│  │   SimulationLoop.js     │◄─────────────►│ FieldCompositionEngine │  │
│  │  (60Hz Fixed Timestep)  │  Tick State   │ (FCE: Interpolates     │  │
│  └────────────┬────────────┘               │  wind, waves, press.)  │  │
│               │                            └───────────▲────────────┘  │
│               │ Dispatch                               │               │
│               ▼                                        │               │
│  ┌─────────────────────────┐                           │ Build Field   │
│  │  RenderPlanDispatcher   │                           │               │
│  │  (Propagates physics to │                           │               │
│  │   WebGL Custom Layers)  │                           │               │
│  └────────────┬────────────┘                           │               │
└───────────────┼────────────────────────────────────────┼───────────────┘
                │                                        │
                │ Draw Call (Continuous repaint)         │
                ▼                                        │
┌────────────────────────────────────────────────────────┼───────────────┐
│                     GPU Rendering & Textures           │               │
│                                                        │               │
│  ┌─────────────────────────┐                           │               │
│  │  WebGLMarineEngine.js   │                           │               │
│  │ (Phase 1: GPU Heatmap   │                           │               │
│  │  Phase 2: GPU Particles)│                           │               │
│  └────────────▲────────────┘                           │               │
│               │ WebGL Context / Main Matrix            │               │
│               ▼                                        │               │
│  ┌─────────────────────────┐                           │               │
│  │   MapLibre GL Engine    │                           │               │
│  │  (WebGL Custom Layers)  │                           │               │
│  └────────────▲────────────┘                           │               │
└───────────────┼────────────────────────────────────────┼───────────────┘
                │ Tile Decode                            │
                ▼                                        │
┌────────────────────────────────────────────────────────┴───────────────┐
│                 WASM Binary GRIB Pipeline & Caching                    │
│                                                                        │
│  ┌─────────────────────────┐               ┌────────────────────────┐  │
│  │   openMeteoProtocol.js  │◄─────────────►│ useTemporalPreloader.js│  │
│  │ (Custom Protocol + WASM │  Broadcast    │ (Programmatic pre-warm │  │
│  │  Concurrency Mutex)    │  Decoded Tile │  of GRIB tiles)        │  │
│  └─────────────────────────┘               └────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Component Directory & File Catalog

### A. The Field Composition Engine (FCE)
* **[`SimulationField.js`](file:///c:/Users/dprit/Raw-Surf/frontend/src/engine/SimulationField.js)**: 
  Defines the primary data structure of the simulation. Encapsulates regional boundaries (bounds), grid parameters (cols, rows, coordinate spacing), and flat analytical arrays representing vectors (U/V wind velocities, height, period, direction). Contains low-level helper functions for coordinate transformations and index lookups.
* **[`SimulationFieldBuilder.js`](file:///c:/Users/dprit/Raw-Surf/frontend/src/engine/SimulationFieldBuilder.js)**:
  Harmonizes raw, asynchronously fetched data streams (marine wind-wave data, GFS/ICON wind components, and sea-level pressure vectors) into a single coordinate-aligned `SimulationField`. Solves grid-boundary differences and performs bilinear matching to align grids of varying densities.
* **[`useSimulationField.js`](file:///c:/Users/dprit/Raw-Surf/frontend/src/engine/useSimulationField.js)**:
  React hook bridge running inside the component tree in parallel with visual layers. It listens to the outputs of active weather hooks, performs primitive-dependency memoization to prevent unnecessary re-calculations, and constructs new `SimulationField` instances only when data changes.

### B. RK4 Physics & Simulation Loops
* **[`SimulationLoop.js`](file:///c:/Users/dprit/Raw-Surf/frontend/src/engine/SimulationLoop.js)**:
  The absolute heart of the mathematical advection engine. Runs a high-performance **60Hz fixed-timestep integration loop** using the `requestAnimationFrame` thread. Drives particles across active fields utilizing Runge-Kutta 4th Order (RK4) integration for immaculate particle advection curves, preventing stepping artifacts.
* **[`useRenderPlanBridge.js`](file:///c:/Users/dprit/Raw-Surf/frontend/src/engine/useRenderPlanBridge.js)**:
  The reactive connector. It binds the active React-level configuration (selected layers, models, timeline offset) to the simulation loop and throttle-subscribes to evolved `RenderPlan` frames at **10Hz** to feed React components without saturating the UI rendering cycle.
* **[`RenderPlanDispatcher.js`](file:///c:/Users/dprit/Raw-Surf/frontend/src/engine/RenderPlanDispatcher.js)**:
  Manages GPU engine subscription registers. Seamlessly propagates newly calculated frame vectors and physics updates to the independent WebGL engine layers (`WebGLWindLayer` and `WebGLMarineLayer`) as they hook onto MapLibre's rendering context.

### C. GPU Custom Layer Engines
* **[`WebGLMarineEngine.js`](file:///c:/Users/dprit/Raw-Surf/frontend/src/components/map/WebGLMarineEngine.js)**:
  Low-level GPU marine renderer. Orchestrates a two-phase WebGL frame composition:
  1. *Phase 1 (Heatmap Base)*: Binds float arrays to dynamic 2D textures, utilizing custom fragment shaders to render a premium, HSL-graded waves heatmap. Relies on `u_oceanMaskTexture` and dynamic GeoJSON masks for absolute coastline clipping.
  2. *Phase 2 (Marine Foam & Crest)*: Evolves and advects thousand-point particle arrays simulating breaking crests, incorporating custom vertex shaders for scale-dependent point sizing.
* **[`WebGLMarineTextureEncoder.js`](file:///c:/Users/dprit/Raw-Surf/frontend/src/components/map/WebGLMarineTextureEncoder.js)**:
  Extracted helper file created to house heavy WebGL texture and program compilation logic, multi-texture compression algorithms (`encodeMarineTexture`), and GFS coastline extrapolation. Keeps both engine files modular and strictly under the **800 LOC** limit.
* **[`WebGLWindLayer.js`](file:///c:/Users/dprit/Raw-Surf/frontend/src/components/map/WebGLWindLayer.js)**:
  MapLibre custom layer implementation wrapper. It hooks into the WebGL state, binds dynamic regional advection wind grids, and triggers Continuous WebGL repaints while active. Features inline regional grid samplers to build real-time local wind advection maps from decoded tiles.

### D. Direct WASM GRIB Pipeline & Preloading
* **[`openMeteoProtocol.js`](file:///c:/Users/dprit/Raw-Surf/frontend/src/components/map/openMeteoProtocol.js)**:
  Custom protocol system intercepting spatial `om://` requests. Features a custom fetch-rate-limiter to prevent 429 errors. Employs a **Concurrency Semaphore (limit = 3)** to serialize GRIB decodes, preventing concurrent memory heap expansions in the Emscripten-compiled C decoder. Caches decoded floating-point grid arrays and broadcasts them to the main thread via a persistent `BroadcastChannel`.
* **[`useTemporalPreloader.js`](file:///c:/Users/dprit/Raw-Surf/frontend/src/components/map/useTemporalPreloader.js)**:
  The programmatic timeline pre-warmer. Instead of mounting slow-moving MapLibre layers, it leverages GRIB metadata (`MODEL_METADATA_CACHE`) to map seek offsets to valid indices, triggering background `window.__FETCH_OM_TILE__` calls to warm the WASM decoder cache for future frame steps.

---

## 3. Core Data Flows & State Machines

### A. GRIB Decoding & Broadcast Loop
```
[CDN GRIB File (.om)] ──► [openMeteoProtocol Worker]
                                 │
                     WASM Emscripten Decode (Serialized via Mutex)
                                 │
                                 ▼
                     [BroadcastChannel payload]
                                 │
                     ┌───────────┴───────────┐
                     ▼                       ▼
          [__DECODED_OM_TILES__]   [BroadcastChannel Main]
             (In-Memory Map)                 │
                     │                       ▼
                     │            [WebGLWindLayer / Overlay]
                     │               (Rebuilds Grid)
                     ▼
          [MapForecastOverlay.js]
         (Bilinear Interpolation)
```

### B. Timeline Seek & Programmatic Preloading State Machine
```
   [User Scrubs Timeline]
             │
             ▼
   [Debounced Hour Offset] (useTemporalPreloader.js)
             │
             ▼
   [Query Cache for closest validIndex]
             │
      ┌──────┴─────────────────────────────────┐
      │ Cache Hit (Warm)                       │ Cache Miss (Cold)
      ▼                                        ▼
   [Instant GRIB Extraction]            [Trigger Fetch & Decode]
      │                                        │
      ▼                                        ▼
   [Populate __DECODED_OM_TILES__]     [window.__FETCH_OM_TILE__]
      │                                        │
      ▼                                        ▼
   [Repaint WebGL custom layer]        [WASM Mutex Decode]
```

---

## 4. Key Constraints & Architecture Boundaries

To prevent regressions, maintain high performance, and ensure clean codebase structure, the following guidelines are **strictly enforced**:

### 1. The Strict 800 LOC Module Boundary
* **Rule**: No module in the `frontend/src/components/map/` or `frontend/src/engine/` folder may exceed **800 lines of code**.
* **Implication**: Any addition of rendering features, complex equations, or helpers must be factored out into modular utility files (e.g. `WebGLMarineTextureEncoder.js` or `LayerAccessResolver.js`).

### 2. 0% Visual MapLibre Raster Layer Footprint for Simulation Layers
* **Rule**: Wind and marine wave layers are **strictly isolated** from MapLibre's built-in raster renderer (opacity = 0.0, visibility = 'none').
* **Implication**: They mount standard raster Sources and Layers solely to trigger background tile preloading via the custom protocol (populating `window.__DECODED_OM_TILES__`), but are **never visually drawn by MapLibre itself**. Visual representation is handled exclusively by custom hardware-accelerated GPU custom layers (`WebGLWindLayer` and `WebGLMarineLayer`).

### 3. Mutex-Serialized WASM Decoding
* **Rule**: All spatial tile decodes must go through the serialized `ConcurrencySemaphore` in `openMeteoProtocol.js` (configured to a maximum of 3 concurrent requests).
* **Reason**: Prevents concurrent Emscripten heap allocations, preventing browser memory exhaustion and `RuntimeError: Aborted(OOM)` crashes during rapid seek operations.

### 4. Absolute Enforcement of Live Real Data Over Persistent Mocks
* **Rule**: Canonical simulation metrics must flow from authentic, live spatial forecast grids (binary GRIB or direct programmatic coords). Synthetic or static fallback models (such as local in-memory sine waves) are strictly restricted to dev-environment proxy rate-limit shielding inside `setupProxy.js` and must **never** be written to the persistent database, production cache files (`wind_global.json`/`marine_global.json`), or client-side telemetry state.

---

## 5. Troubleshooting & Common Bug Resolutions

### A. The Heatmap Blackout Bug
* **Symptom**: The marine wave height/period heatmap goes completely black upon initial load or transition.
* **Root Cause**: The Phase 1 base rendering pass was gated behind `if (this._cachedMaskGeoJSON)`. While the high-res coastline GeoJSON is fetching over the network, this condition is null, completely skipping base heatmap draw calls.
* **Fix**: Remove the hard guard and proceed to draw the base layer utilizing the GFS grid's fallback mask (`u_oceanMaskTexture`) if `_cachedMaskGeoJSON` is null, upgrading smoothly to high-res once loaded.

### B. GRIB TimeIndex Cache Pollution
* **Symptom**: Seeking the timeline shows low-resolution Route A data or flat, land-diluted periods.
* **Root Cause**: Conformed spatial URLs query strings were stripped during normalization. In `postReadCallback`, the index parser returned `null` and cached every tile under `timeIndex = 0`. Seeking timeline indices found no tiles in cache, failing Route B.
* **Fix**: Implemented forensic ISO-date extraction from tile request paths, resolving target times against `MODEL_METADATA_CACHE` to retrieve the correct valid times index.

### C. The Wind Raster Slot Leak
* **Symptom**: MapLibre stylesheet contains `wind-slot-0-layer`, `wind-slot-1-layer`, etc., polluting the map style and generating unnecessary connection requests.
* **Root Cause**: The loops in `MapWebGL.js` and `useOpenMeteoTileUrls.js` filtered out `type !== 'marine'`. Since `wind` has `type: 'particle'`, it passed the filter.
* **Fix**: Restrict both loops strictly to `type === 'raster'`.
