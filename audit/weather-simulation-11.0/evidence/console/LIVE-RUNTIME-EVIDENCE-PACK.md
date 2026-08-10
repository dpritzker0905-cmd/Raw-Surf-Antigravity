# Live Runtime Evidence Pack — Weather Simulation Audit 11.0

**Captured by:** lead auditor (hands-on browser session, not a subagent)
**Date:** 2026-08-09
**Branch / HEAD:** `dev` @ `3d3ccdc2` — working tree clean at audit start and unchanged at capture time
**App URL:** `http://localhost:3007/map` (CRA dev server, `craco start`, compiled clean, "No issues found")
**Backend:** `https://raw-surf-antigravity.onrender.com` (PRODUCTION Render backend — per `frontend/.env.local`)
**Browser:** in-app Chromium (Claude Browser pane), viewport 961×910 CSS, DPR 2, canvas backing 1794×1820
**Host:** Windows 11 Pro 26200, i7-11800H 8C/16T, 63.75 GB RAM, RTX 3060 Laptop + Intel UHD, 3840×2160
**Map state at baseline:** center 28.3327,-80.6147 (Cocoa Beach), zoom 9, bearing 0, pitch 0, Mercator

> ⚠️ **Environment caveat that bounds every number below.** The local frontend talks to the **production**
> backend. Latency and grid contents are production's, not a fixture's. No load was generated: the whole
> session issued well under 100 backend requests.

---

## 0. What is actually running (established, not assumed)

`window.__MAP_INSTANCE__.style._order` filtered to `type === 'custom'`:

```
customLayers = ["webgl-marine-particles", "webgl-wind-particles"]
styleLayers  = 140      sources = 23 (mapbox composite, esri-satellite, 6 raster layers × 3 slots, spot-geofences)
```

Both custom WebGL layers are registered **at boot, before any weather layer is enabled**.

Boot console (verbatim, trimmed):

```
[SimLoop] Simulation started — RK4 particles + field evolution active
[RenderOrchestrator v2] Engine loop started (fixed timestep)
[RenderPlanDispatcher] Started — GPU renderers will receive evolved field data
[WebGLMarine] v5.3 quad ribbon renderer. 87616 particles × 6 verts = 525696 vertices.
[WebGLMarine] Initialized engine with 87616 wave crests + 96x96 grid
[WebGLWind] Initialized: 147456 particles
[WebGLWind] Layer added (384^2 = 147456 particles)
[WebGLMarineLayer] render called! activeRef: false errorCount: 0 matrixType: object matrixLen: 16
[WebGLWindLayer] render init: matrix Float32Array len: 16 active: false
[WebGLMarine-Forensic] Failed to add layer: Style is not done loading.
[WebGLWind] Failed to add layer: Style is not done loading.
```

**235,072 particles are allocated at boot with zero layers active**, and both layers enter `render()`
with `active: false`. Two "Failed to add layer: Style is not done loading" warnings show an
add-before-style-ready race that is subsequently retried successfully.

`__LAYER_REGISTRY_DIAG__` → `pluginCount: 12`, `reregisterCount: 0` (no duplicate plugin registration).

---

## 1. ⭐ FINDING L-01 — The engine loop is CORRECT. My first three measurements of it were WRONG.

This is recorded in full because the *method* matters more than the result.

### 1a. What I measured first (and reported to myself as a defect)

Polling `window.__SIM_DIAGNOSTICS__`:

| window | wall s | `frameIndex` Δ | implied updates/s | sim s per real s |
|---|---|---|---|---|
| first probe | 4.01 | 1808 | 451 | **7.52×** |
| later probes ×5 | 2.00 each | 0 | 0 | **0.00×** |

Both readings are impossible for the code in `render-orchestrator.js`, which caps work at
`MAX_UPDATES_PER_FRAME = 4` per RAF frame (≈120 updates/s at 30 fps).

### 1b. Falsification attempts, in order

1. **"Duplicate RAF loops"** — REFUTED. A wrapper over `window.requestAnimationFrame` counting callbacks
   by identity showed `frame` firing **29.6/s against a 29.6/s vsync** — exactly one orchestrator chain.
   (Four RAF chains total exist: the orchestrator + **two independent FPS counters** + a web-vitals probe.)
2. **"Duplicate module instances"** — REFUTED. Walking the webpack module cache
   (`webpackChunkfrontend` runtime probe) found exactly **one** instance each of
   `render-orchestrator.js`, `SimulationLoop.js`, `init-sequencer.js`, `FieldCompositionEngine.js`.
3. **"Subscriber churn / multiply-registered tick"** — REFUTED. 150 samples over 15 s:
   `updateSubscribers` constant **1**, `renderSubscribers` constant **1**, `planSubscribers` constant **3**,
   **zero** transitions.
4. **Decisive test** — I registered my own subscriber via the module's real `onSimulationUpdate`:

```
MY_updateCallbacksPerSec : 60.0     lastDt: 0.016666666666666666  (exactly 1/60)
MY_renderCallbacksPerSec : 30.0
orchestratorSimAdvancedSec (3 s wall): 3.00        → 1.00× real time
SimulationLoop frameIndex advanced   : 180         → exactly 60 Hz
```

### 1c. Root cause of the false readings — CONFIRMED

```
Object.getOwnPropertyDescriptor(window,'__SIM_DIAGNOSTICS__') → DATA property (static snapshot object)
over 3 s:  window.__SIM_DIAGNOSTICS__.frameIndex Δ = 0
           SimulationLoop.getSimDiagnostics().frameIndex Δ = 180
live frameIndex 29157  vs  stale global 27743   → global lagging 1414 frames ≈ 23.6 s
```

**`window.__SIM_DIAGNOSTICS__` is a frozen snapshot object, not a live getter.** It is refreshed only
intermittently, so it reports a healthy 60 Hz engine as frozen, and reports catch-up bursts that never
happened.

**VERDICT — two separate dispositions:**

* **The fixed-timestep engine loop: `CONFIRMED HEALTHY`.** `render-orchestrator.js` is a textbook
  accumulator loop, single RAF, 1.00× real-time, `dt` exactly 1/60. The invariants
  "one authoritative animation loop" and "motion is not frame-rate dependent" are **PRESERVED at the
  orchestrator level**. This is a genuine asset — *do not touch it.*
* **The published diagnostic: `CONFIRMED DEFECTIVE`,** severity **Medium**, subsystem observability.
  `window.__SIM_DIAGNOSTICS__` is the single most obvious handle an engineer reaches for, it is wired
  into the on-screen Diagnostics HUD, and it lies in **both directions**. It cost this audit four probes
  and would have produced a fabricated "engine stalls / engine runs 7× fast" finding in a less careful one.
  This repo's own history already names this failure class ("the measuring instrument was dead").

**Repair boundary:** convert the global to an accessor (`Object.defineProperty(window,'__SIM_DIAGNOSTICS__',
{get: getSimDiagnostics})`) — a one-line change with no product-behaviour effect.

---

## 2. ⭐⭐⭐ FINDING L-02 — CRITICAL: the timeline advertises an hour the map is not rendering

**The single most important user-facing finding of this audit.**

### Reproduction (exact)

1. `/map`, Cocoa Beach, z9, model **GFS**, layer **Waves** on, timeline at **+6 h** → parity healthy.
2. Click **ICON**; 300 ms later click **EURO** (switch while the first is still in flight).
3. Immediately click **+1d** three times (→ requested hour **78**).
4. Wait. Sample `window.__MARINE_RENDER_HOUR_PARITY__`.

### Measured

```
T0 GFS  : parity true   requestedHour 6   renderedDataHour 6    particles 87616
T4 +12s : parity FALSE  requestedHour 78  renderedDataHour 6    particles 87616   model EURO  offset 78
T5 +60s : parity FALSE  requestedHour 78  renderedDataHour 6    particles 87616   reason "retained_previous"
```

`renderedParticleCount` is **byte-identical (87616) across the entire sequence** — the wave field was
never re-uploaded. The on-screen field is pixel-identical to the pre-switch GFS hour-6 render.

### What the user sees

Screenshot at T5: model chip **EURO** selected, layer **Waves** lit, timeline label **"Thu 12 AM"**,
legend "Combined Waves (ft) 0–20+". **No spinner, no staleness badge, no error, no greyed state.**
A confident, fully-styled forecast that is **72 hours and one model away from what the labels claim.**

### Why it happens (traced, not guessed)

The hour-78 EURO fetches **succeeded** (HTTP 200):

```
/api/weather/grid_series?model=EURO&domain=marine&layer=waves&bbox=-81.73,27.28,-79.50,29.38&hours=78   200  2869 ms
/api/weather/grid_series?model=EURO&domain=marine&layer=waves&bbox=-180,-80,180,85&hours=78              200  6327 ms
```

but the grid that came back is degenerate:

```
__MARINE_RENDER_SOURCE_DIAG__ → cols: 6, rows: 5   (= 30 cells)   maxHeight: 1.1519
```

30 cells over a 2.2° × 2.1° viewport ≈ 0.44° spacing — against the **0.083°** Copernicus dataset that
`__WEATHER_CAPABILITIES__` advertises for EURO marine. The renderer **correctly refuses** to upload this
and retains the previous field (`reason: "retained_previous"`).

**So the guard is right and the disclosure is missing.** This is a *silent fail-safe*: the system protects
the pixels from bad data and then tells the user those pixels are something they are not.

### ⚠️ CORRECTION AFTER FURTHER TESTING — severity revised Critical → High

A later geographic tour (Portugal → Morocco → New York → back to Cocoa Beach) showed
`parity: true, reason: "parity_match", requestedHour 78 == renderedDataHour 78` at **every** site,
**including Cocoa Beach z9 on return**. So the stale state is **not permanent — it self-heals.**

Revised, defensible statement of the defect:

> After a model switch immediately followed by a far-horizon scrub, the map rendered a **72-hour-stale,
> wrong-model field under confident "+78 h / EURO / Thu 12 AM" labels for ≥ 60 seconds**, with no
> spinner, badge or error. The app's own `__MARINE_RENDER_HOUR_PARITY__` held
> `{parity:false, reason:"retained_previous"}` for that entire window — **the system knew and did not
> tell the user.** The condition cleared after subsequent viewport changes.

**Mechanism: NOT ISOLATED.** The degenerate 6×5 / maxHeight 1.15 grid observed at the time is a
candidate, but Portugal (6×7, nonzero 31), Morocco (9×9, nonzero 38) and New York (7×7, nonzero 27)
all rendered correctly from comparably small grids — so **grid size alone does not explain it** and I
am not claiming it does. What is proven is the *disclosure* failure, which is independent of mechanism.

### Classification

`CONFIRMED` (symptom + duration + the app's own parity verdict) ·
`HYPOTHESIS` (mechanism) · Severity **High** · Confidence **High** on the symptom, **Low** on the cause ·
Subsystem: marine render / timeline authority.

* **Falsification attempted:** waited 60 s+ (not transient); confirmed the fetches returned 200 (not a
  network failure); confirmed `parity:false` is the app's *own* diagnostic verdict, not my inference;
  confirmed the model chip and hour label both updated (so the UI state machine advanced normally).
* **Alternative explanation considered and NOT excluded:** the degenerate 6×5 grid may be a *backend*
  defect specific to EURO at long horizons rather than a frontend one. **The frontend defect — rendering
  hour 6 under a "+78 h EURO" label with no disclosure — stands regardless of which side produced the
  bad grid.** Backend disposition is an open question (see OPEN_QUESTIONS).
* **Invariant violated:** *"user-visible loading state corresponds to actual readiness"* and
  *"heatmap, legend, cursor value and infobox use the same model run and forecast hour."*

### Corroborating signal

`__WebGLMarineLayer_DIAG__.infoboxHeatmapParity` reads **`false`** — the app already tracks
heatmap-vs-infobox disagreement and it is currently failing. Not separately reproduced this session.

---

## 3. FINDING L-03 — Stale-request cancellation WORKS (a confirmed strength)

Switching GFS → ICON → EURO 300 ms apart:

```
/api/weather/grid_series?model=ICON&...&hours=0,3,6,9,12,15    ABORT:AbortError   303 ms
/api/weather/grid_series?model=ICON&...&hours=144,147,150,...  ABORT:AbortError   302 ms
final pressed model = EURO   (the last click won)
```

Both in-flight ICON requests were aborted the instant the newer choice landed. **No older response
overwrote a newer selection.** The invariant *"no stale response overwriting newer state"* is
**PRESERVED for model switching.** Preserve this mechanism.

---

## 4. FINDING L-04 — Timeline scrubbing costs ZERO network (strength), so the scrub race was not exercised

Ten rapid `+1h` clicks at 120 ms, then four `-1h`:

```
offset 0 → +10 → 6      requestsIssued: 0      requestsAborted: 0      requestsStillPending: 0
__MARINE_RENDER_HOUR_PARITY__ → { parity: true, reason: "parity_match", requestedHour: 6, renderedDataHour: 6 }
```

Click arithmetic exact, no dropped/duplicated toggles, rendered hour == requested hour. Scrubbing inside
the cached horizon is served from a **local time series** with no per-hour fetch.

⚠️ **Honest scope limit:** because zero requests were issued, this test **did not exercise** the
stale-response race for scrubbing. The race only becomes reachable when the scrub leaves the cached
horizon — which is exactly the path that produced FINDING L-02.

---

## 5. FINDING L-05 — GPU resource lifecycle is balanced (strength); listeners leak slowly

Six full Waves OFF→ON cycles with `gl.*` create/delete wrapped on the live MapLibre context:

| resource | created | deleted | net |
|---|---|---|---|
| textures | 204 | 204 | **0** |
| buffers | 3114 | 3124 | **0** (10 pre-instrumentation deletes) |
| vertex arrays | 1092 | 1092 | **0** |
| **programs** | **0** | **0** | **0** — shaders compiled once at boot and reused |
| framebuffers | 0 | 0 | 0 |

**No texture / buffer / VAO / shader-program leak across layer toggles.** This directly contradicts the
historical lead about "transient recreation of wave/chlorophyll/bathymetry textures" *at the layer-toggle
level* — that lead is **NOT REPRODUCED** here.

Two secondary observations:

* **Allocation churn is high:** ~**519 buffers, 182 VAOs, 34 textures created *and* destroyed per
  toggle cycle**. Balanced, but a real Gate-3 optimisation target (reuse rather than recreate).
* **Event listeners: net +5.4 per cycle** (661 added / 630 removed over 6 cycles). Monotonic, small.
  `Medium`/`Low`. Worth a bounded fix, not urgent.
* **JS heap: INCONCLUSIVE.** 171→186→130→296→235→339→246 MB — GC-dominated, no clean monotonic trend.
  A leak here is **NOT MEASURED**; it needs a longer soak with forced GC. Do not claim one.

---

## 6. FINDING L-06 — Land masking is correct here; "land bleed" NOT REPRODUCED

`gl.readPixels` straight from the MapLibre drawing buffer after a render pass, Waves active, z9:

| point | lng, lat | expected | RGBA | G−R |
|---|---|---|---|---|
| inland (Orlando-ish) | -81.05, 28.55 | LAND | `66,77,92` | 11 |
| inland (Bithlo) | -81.10, 28.57 | LAND | `66,77,92` | 11 |
| inland (W of Palm Bay) | -80.90, 28.00 | LAND | `66,87,92` | 21 |
| barrier island | -80.60, 28.35 | LAND (narrow) | `93,117,126` | 24 |
| Indian River lagoon | -80.75, 28.40 | inland water | `74,103,119` | 29 |
| Atlantic nearshore | -80.50, 28.35 | OCEAN | `48,161,129` | **113** |
| Atlantic offshore | -80.20, 28.35 | OCEAN | `41,171,142` | **130** |

A **4–12× separation** in the green channel between land and ocean. The wave field does **not** paint
land, and the coastline registers correctly including a narrow barrier island.

**Disposition: `NOT REPRODUCIBLE` at z9 / Florida.** The apparent green-over-land in a casual screenshot
read is the **basemap's own dark-teal landcover**, not the wave field.

### 6b. Geographic tour — the historically-named "dead zones" do NOT reproduce

Same `readPixels` probe, model **EURO**, layer **Waves**, hour **+78**, zoom 8, `map.jumpTo` per site:

| site | centre | sea RGBA | **sea G−R** | land RGBA | land G−R | grid | nonzero | parity |
|---|---|---|---|---|---|---|---|---|
| Portugal (Nazaré) | -9.20, 39.50 | `30,182,236` | **152** | `199,199,199` | 0 | 6×7 | 31 | ✅ 78=78 |
| Morocco (Taghazout) | -9.90, 30.55 | `33,176,235` | **143** | `66,77,92` | 11 | 9×9 | 38 | ✅ 78=78 |
| New York (Long Island) | -72.90, 40.75 | `35,172,137` | **137** | `63,73,87` | 10 | 7×7 | 27 | ✅ 78=78 |
| Cocoa Beach z9 (return) | -80.61, 28.33 | — | — | — | — | — | 27 | ✅ 78=78 |
| Cocoa Beach z6 (wide) | -80.61, 28.33 | — | — | — | — | 18×17 = 306 | 191 | ✅ 78=78 |

**Every historically-suspected dead-zone geography renders the field at sea with a 13–150× green-channel
separation from land, and every one reports hour parity.** Portugal's land sample reads `199,199,199`
(light basemap landcover) with G−R = 0 — no field on land.

**Disposition: the "geographic dead zones around New York, Portugal, Spain, Morocco" lead is
`NOT REPRODUCIBLE` at HEAD.** Treat it as a **STALE historical description** unless someone produces a
current reproduction. ⚠️ Still untested: Spain specifically, El Salvador, open Pacific, island chains,
high latitude, the antimeridian, and any zoom above 9 — see BLOCKED.

`[OceanMask] Land fill upgraded to 10m polygons for close zoom (10 features)` — only **10** features at
10 m; 1420 at 50 m. Not a defect at this zoom but a coverage question at higher zoom.

---

## 7. FINDING L-07 — The "physics simulation" does not execute in the shipped map path

`SimulationLoop.simulationTick` gates **all** evolution and advection on one flag
(`SimulationLoop.js:219`):

```js
const shouldEvolve = typeof window !== 'undefined' && window.__IN_SIMULATION_SANDBOX__ === true;
```

Measured live on `/map`: `window.__IN_SIMULATION_SANDBOX__` is **`undefined`** ⇒ `shouldEvolve === false`.
Therefore, in the normal map path:

* `evolveField(...)` — **never called** (`SimulationLoop.js:224`)
* `_windParticles.update(dt)` — **never called** (`:245`)
* `_marineParticles.update(dt)` — **never called** (`:250`)

Yet the boot banner reads **"RK4 particles + field evolution active"**, and with Waves on the
diagnostics report `marineParticles: 3000`, `evolutionTicks: 304`, `hasEvolvedField: true`.
`_evolutionTicks++` sits **outside** the `shouldEvolve` guard (`:226`), so the counter advances at 15 Hz
while nothing evolves; the particle systems are *constructed* (3000 objects) but never *advanced*.

**Consequence for the audit's central question:** the moving crests on screen are produced by
`WebGLMarineEngine` / `WebGLWindEngine` doing **GPU advection of a forecast field** — a separate path
from the `SimulationLoop` RK4 system. The RK4 + field-evolution kernel is **built, wired, loop-connected
and inert** in production.

⇒ **The feature is a forecast VISUALISER with GPU particle advection, not a running physics simulation.**
`CONFIRMED` · Severity **High** (as a truth-in-telemetry and dead-weight issue, not a rendering bug).
The FCE agrees: `__FCE_DIAGNOSTICS__ → { populated: false }`, `__FCE_FIELD__ → null`,
`__GPU_DISPATCHER__.dispatchCount → 0`.

---

## 8. Idle cost and instrumentation overhead

* **Four concurrent RAF chains** at idle: engine orchestrator + **two separate FPS counters** + a
  web-vitals probe = 120.5 RAF callbacks/s for one 29.6 Hz display.
* **React Scan ships in the dev bundle and is active** (`__REACT_SCAN__`, `react-grab v0.1.32`,
  outdated-version warning on every boot). Render-count badges are drawn over the live map.
* Observed FPS badge: **11–31 fps**, 21 fps with Waves active at z9.
* `__RAW_GPU__` at idle: `drawCallsPerFrame: 0`, `textureCount: 2`, `framebufferCount: 1`,
  `shaderCompileCount: 6`, `gpuMemoryEstimate: 700,928 B`.
* `ne_50m_land.json` is fetched **three times** on one page load (plus `ne_10m_land.json` once).
* **88 `window.__*` diagnostic globals** are exposed on the map page.

⚠️ `window.__RAW_GPU__` changed type mid-session (callable function → plain object), breaking a probe.
A second global with an unstable contract.

---

## BLOCKED / NOT COVERED — and what would unblock it

| Area | Why blocked | What would unblock |
|---|---|---|
| Geographic matrix (Portugal, Spain, Morocco, NY, El Salvador, antimeridian, high latitude) | Session turn budget spent on the engine-loop falsification chain and the L-02 root cause | The `readPixels` land/ocean probe in §6 is reusable verbatim — re-run per `map.jumpTo()` |
| Cross-browser (Firefox, WebKit) | Only the in-app Chromium pane is wired; `frontend/playwright.config.js` exists but no run was made | `npx playwright test` with the existing config |
| Video capture + frame-differencing forensics | No recording tool available in this pane; screenshots are returned inline and not persisted to disk | ffmpeg + Playwright video, or a desktop recorder |
| DPR 1 / mobile viewport / bearing / pitch | Not reached | `resize_window` presets + `map.setBearing/setPitch` |
| Wind layer, swell 1/2, wind waves, and all 6 raster layers | Only **Waves** was exercised end-to-end | Repeat §2/§5/§6 per layer |
| React Profiler commit counts | React Scan badges observed visually; no programmatic profile captured | `react-devtools` programmatic profiling API |
| JS heap leak | GC noise dominated a 6-cycle run | 50+ cycle soak with `--expose-gc` |
| Baseline comparison vs `b5bbaa7d` / `f5f6a3d` | Not attempted live | Isolated worktree + identical probe script |

**No production source file was modified.** All probes were runtime-only (`javascript_tool`), and every
wrapper installed (`requestAnimationFrame`, `gl.*`, `fetch`, `EventTarget.prototype.*`) was **restored**
in the same call. Working tree remained clean throughout.
