# Audit 12.2 — Source Inventory: FRONTEND RENDERING SURFACES

**Area:** MapLibre custom layers, WebGL engines, shaders, textures, buffers, framebuffers, canvases,
RAF/animation schedulers, GL contexts, tile protocols.
**Repo:** `C:\Users\dprit\Raw-Surf` · branch `dev` · HEAD `791fdf78` · read-only pass, 2026-08-13.
**Machine-readable companion:** `fe-render-inventory.json` (203 files, every flag count).

---

## 0. METHOD, AND THE CONTROLS THAT MAKE IT MEAN SOMETHING

Every "there is no X" below is paired with a positive control from the same file or directory. The
inventory was built independently of the audit vocabulary: enumerate the tree first, classify by
runtime reachability, and only then diff against the registers.

**Counting method.** `frontend/src/components/map` + `frontend/src/engine` + `frontend/src/utils` +
`frontend/src/components/weather`, all non-test `.js`:

```
find frontend/src/components/map -type f | wc -l          -> 293 (incl. 90 .test.js)
python inv.py                                             -> 203 non-test files, 67,226 LOC scanned
```

`inv.py` (in the session scratchpad, reproduced logic below) regex-counts, per file:
`.addLayer(`, `.addSource(`, `addProtocol(`, `type: 'custom'`, `onAdd(`, `onRemove(`, `getContext(`,
`requestAnimationFrame(`, `cancelAnimationFrame(`, `create/deleteTexture|Buffer|Framebuffer|Program`,
`VERTEX_SHADER|FRAGMENT_SHADER`, `createElement('canvas')`, `new Worker(`, `drawArrays|drawElements`,
and counts production importers by scanning every `.js/.jsx/.ts/.tsx` under `frontend/src` for a
module-path string ending in the file's stem.

⚠️ **Importer-count caveat, found and corrected mid-pass.** The first regex required the quote to
close immediately after the stem, so it MISSED `new URL('./GridParserWorker.js', import.meta.url)`
and reported a live 749-LOC worker as an orphan. Every orphan claim below was therefore re-run with a
suffix-tolerant pattern:

```
git grep -c "['\"][^'\"]*<stem>\(\.js\)\?['\"]" -- frontend/src | grep -v '\.test\.' | grep -v "/<stem>\.js:"
```

**POSITIVE CONTROL for that grep:** `GridParserWorker -> 1` (its `new URL` site). All fourteen other
orphans returned `0` under the *same* pattern that finds the worker. The technique works.

---

## 1. WHAT IS ACTUALLY REGISTERED WITH MAPLIBRE AT RUNTIME

This is the complete set. Every row was traced to a call site, not inferred from a filename.

### 1a. `map.addLayer` / `map.addSource` — imperative

```
git grep -n "addLayer\|addSource" -- frontend/src      # 10 addLayer, 7 addSource, 4 files
```
(The 448 KB of hits under `frontend/public/maplibre-gl-worker.js` are the vendored bundle and are
excluded from every count in this document.)

| # | Layer / source id | Site | Type | Reachability |
|---|---|---|---|---|
| 1 | `radar-frame-<djb2>` × (2·preload+1) | `MapWebGL.js:484,487` | raster | **Active-reachable** — only while `activeLayers.includes('radar')`; killed by `__RAW_RADAR_MULTILAYER_DISABLED__` |
| 2 | `lightning-strikes` (source) | `MapWebGL.js:543` | geojson | **Active-reachable** — radar only |
| 3 | `lightning-glow` | `MapWebGL.js:544` | circle | **Active-reachable** — radar only |
| 4 | `lightning-core` | `MapWebGL.js:552` | circle | **Active-reachable** — radar only |
| 5 | `ocean-mask-source` | `OceanMask.js:400` | geojson | **Active-reachable** |
| 6 | `ocean-mask-buffer` | `OceanMask.js:463` | fill | **Active-reachable** |
| 7 | `ocean-mask-fill` | `OceanMask.js:511` | fill | **Active-reachable** — also the marine layer's default anchor |
| 8 | `ocean-mask-inland-water` | `OceanMask.js:533` | fill | **Active-reachable** — order-pinned below the marine layer |
| 9 | `ocean-mask-inland-waterway` | `OceanMask.js:565` | line | **Active-reachable** |
| 10 | `ocean-mask-line` | `OceanMask.js:595` | line | **Active-reachable** |
| 11 | `webgl-marine-particles` | `WebGLMarineLayer.js:859` | **custom** | **Active-reachable** — resident, `active` prop gates `render()` |
| 12 | `webgl-wind-particles` | `WebGLWindLayer.js:267` | **custom** | **Active-reachable** — resident, `active` prop gates `render()` |

### 1b. Declarative `<Source>/<Layer>` (react-map-gl) — `MapWebGL.js` render tree

| Element | Site | Reachability |
|---|---|---|
| `esri-satellite-source` / `esri-satellite-layer` | `:803-818` | Active; visibility keyed on `activeLayers.includes('satellite')` |
| `<layerKey>-slot-{0,1,2}-source/-layer` (~12 layers × 3 slots) | `:871-919` | Active; gated on `protocolReady` **and** `LAYER_REGISTRY[k].omVariable`; marine keys only appear when `webglMarineFailed` |
| `spot-geofences` / `spot-geofences-layer` | `:923-949` | Active; `minzoom = SPOT_GEOFENCE_MIN_ZOOM` |
| `<Marker>` × 7 kinds | `MapMarkerLayers.js:119,168,306,341,353,370,384` | Active; DOM markers, **not** GL layers |

### 1c. `maplibregl.addProtocol` — 5 global protocol handlers, 0 removals

```
git grep -n "addProtocol"  -- frontend/src   -> 5 registration sites, 2 files
git grep -n "removeProtocol" -- frontend/src -> 0     (positive control: the 5 adds above)
```

| Scheme | Registrar | Idempotency | Reachability |
|---|---|---|---|
| `om://` | `openMeteoProtocol.js:719` via `registerOpenMeteoProtocol` ← `useOpenMeteoTileUrls.js:331` (`useEffect(...,[])`) | `try/catch` swallow "already registered" (`:912`) | **Active-reachable** |
| `hrrr-rv://` | `radarTileRecolor.js:583` | `_registered` module flag (`:581`) | **Active-reachable** — radar |
| `dwd-rv://` | `radarTileRecolor.js:584` | same flag | **Active-reachable** — radar (DWD region) |
| `ltg-flash://` | `radarTileRecolor.js:585` | same flag | **Active-reachable** — lightning extraction |
| `advect-rv://` | `radarTileRecolor.js:586` | same flag | **Active-reachable** — radar future frames |

Registration entry point for the radar family: `useWeatherState.js:116`
(`useEffect(() => { registerRadarRecolorProtocol(); }, [])`).

---

## 2. (a) HOW MANY MARINE / WIND ENGINES COEXIST — THE ANSWER

**Live at runtime: exactly ONE marine GL engine and ONE wind GL engine, plus TWO Canvas2D fallbacks
that are mutually exclusive with them by ternary.** Everything else that carries a renderer-shaped
name is unreachable. The decoys are real and they are the reason this question keeps recurring.

| Candidate | Verdict | Proof |
|---|---|---|
| `map/WebGLMarineEngine.js` (3,205 LOC) | **Active-reachable — THE marine engine** | `new WebGLMarineEngine()` at `WebGLMarineLayer.js:840`; `engine.init(gl)` from `onAdd` |
| `map/WebGLMarineCustomLayer.js` (359) | **Active-reachable — the `CustomLayerInterface` factory**, not a second engine | `type:'custom'` at `:78`; `createCustomLayer(engine, …)` called once at `WebGLMarineLayer.js:847`; the object it returns is what `addLayer` receives |
| `map/WebGLMarineLayer.js` (1,222) | **Active-reachable — React wrapper** | mounted at `MapWebGL.js:1027` behind `!webglMarineFailed` |
| `map/GPUMarineLayer.js` → `MarineParticleCanvas` (574) | **Fallback-only** | mounted at `MapWebGL.js:1040` in the `webglMarineFailed` arm only; Canvas2D (`getContext('2d')` at `:298`) |
| `map/WindParticleOverlay.js` (518) | **Fallback-only** | `MapWebGL.js:1081`, `webglWindFailed` arm only |
| `map/WebGLWindEngine.js` (1,094) + `WebGLWindLayer.js` (471) | **Active-reachable — THE wind engine** | `type:'custom'` at `WebGLWindLayer.js:29`; `addLayer` at `:267` |
| `engine/layer-renderers/webgl-layer.js` (95) | **Dead** | 0 module-path references (control above) |
| `engine/layer-plugins/marine-layers.js` (312) | **Dead** | 0 references |
| `engine/render-pipeline.js` (117) | **Dead** | 0 references |
| `engine/gpu-texture-manager.js` (232) | **Legacy-unreachable in practice** | imported by `engine-bootstrap.js:29`, but `bindContext(ctx.gl)` runs only `if (ctx.gl)` (`:57-59`) and the one caller passes **no `gl`** — `MapWebGL.js:659` calls `initEngine({ mapInstance, config })` |

**Fallback entry conditions** (`MapWebGL.js:95-96, 700-731`): `window.__FORCE_WIND_FALLBACK__` /
`__FORCE_MARINE_FALLBACK__`, the persisted `localStorage` keys `force_wind_fallback` /
`force_marine_fallback` read in `useState` **initialisers** (so they survive reload), or a real
`webglcontextlost` event.

---

## 3. (b) EVERY RAF LOOP AND ITS CANCEL PATH

```
git grep -n "requestAnimationFrame" -- frontend/src | grep -v '\.test\.' | wc -l   -> 47
```

| # | Owner | Site | Cancel path | Class |
|---|---|---|---|---|
| 1 | `WeatherTelemetry.initFpsMonitor` | `:397,399` (armed from `:73`) | ❌ **NONE** — no `cancelAnimationFrame` anywhere in the 551-LOC file | module-lifetime loop, runs on every screen |
| 2 | `engine/render-orchestrator.frame` | `:79,132,144` | ✅ `stopPluginRenderLoop` `:154` ← `shutdownEngine` | map-lifetime loop; **body is provably a no-op — see §7** |
| 3 | `CanvasAnimationCoordinator._doAnimate` | `:91,135,196` | ✅ `stop()` `:96` + `dispose()` `:100`; dormancy `setTimeout` also cleared | fallback-renderer scheduler |
| 4 | `OceanMask` sync/retry + 2 debouncers | `:731,735,832,860` | ✅ 7 `cancelAnimationFrame` incl. unmount `:816,877` | balanced |
| 5 | `ForecastWheel` inertia | `:222,225,237,240` | ✅ `:224,239,246,321` | balanced |
| 6 | `MapWeatherControls` scrub | `:353` | ✅ `:320,385,418` | balanced |
| 7 | `useOpenMeteoTileUrls` slot flip | `:246,674` | ✅ `:673,685` | balanced |
| 8 | `MapWebGL` marine-canvas fade | `:628,630` | ✅ `:629` + cleanup `:633` | balanced |
| 9 | `scrubPerfProbe.sampleFrames` | `:71,73` | ⚠️ cooperative `stopRef.stopped` only | dev-only bench (`window.__SCRUB_PROBE_ON__`) |
| 10 | `useRasterTransactions` | `:69,99,130` | ❌ none | **Dead file — 0 importers**, so no runtime effect |
| 11 | one-shot deferrals (not loops) | `useModelTransition:170`, `useMarineDataFetcherCore:944`, `useMarineDataFetcherHelpers:603`, `index.js:253` | n/a | single-frame |

**Result: exactly ONE production RAF loop with no cancel path — `WeatherTelemetry` (#1).** That is
already WS-CAN-0022. Neither GL engine owns a RAF: both are MapLibre custom layers driven by the map's
own frame loop plus `map.triggerRepaint()`.

⛔ **But see §6 — the number the program used to *confirm* this is a hardcoded literal.**

---

## 4. (c) WEBGL CONTEXTS AND CONTEXT-LOSS HANDLING

```
git grep -n "getContext(" -- frontend/src | grep -v '\.test\.'    -> 44 sites
git grep -n "webglcontextlost\|webglcontextrestored" -- frontend/src -> 4 (all MapWebGL.js)
```

| Context | Created by | `webglcontextlost` | `webglcontextrestored` |
|---|---|---|---|
| **The map context** (WebGL2) — shared by MapLibre, `WebGLMarineEngine`, `WebGLWindEngine` | MapLibre; reached via `mapInstance.getCanvas()` | ✅ `MapWebGL.js:731`, `e.preventDefault()`, telemetry, flips **both** engines to the Canvas2D fallbacks | ✅ `:732`, un-flips unless a `force_*_fallback` override is set |
| `utils/WebGLFilterEngine.js:191` (`getContext('webgl')`) | photo-filter engine, own offscreen canvas | ❌ none | ❌ none |

All remaining 42 `getContext` calls are `'2d'`: the mask rasterizers
(`WebGLMarineMaskRenderer.js` ×7, `marineMaskShelter.js` ×3, `inlandWaterGuard.js` ×3,
`maskSmoothing.js`, `maskCoastSDF.js`), the tile recolorers (`radarTileRecolor.js` ×5,
`openMeteoProtocol.js`), the two Canvas2D fallbacks, `ForecastWheel`, `haloDebugOverlay`, and
non-map media components.

Both custom layers dispose their engine on removal:
`WebGLMarineCustomLayer.js:352-356` and `WebGLWindLayer.js:193-197` → `engine.dispose(gl)`.
⚠️ MapLibre calls `onRemove` on **every `setStyle`**, and `currentMapStyle` is memoized on `theme`
(`MapWebGL.js:613`) — so **each theme switch is a full engine dispose + re-add**. That matters for §6b.

---

## 5. (d) GL RESOURCE ALLOCATION vs DISPOSE

| Resource | create sites | delete sites | Verdict |
|---|---|---|---|
| Buffers | `WebGLMarineEngineInit` 4, `WebGLWindEngineInit` 4 | 4 / 4 | balanced |
| VAOs | 3 / 5 | 3 / 5 | balanced |
| Framebuffers | marine 2, wind 2 | marine 2, wind 5 | balanced (wind's `screenA/B` pair) |
| Programs / shaders | marine 3/6, wind 5/10 | `deleteAttachedShaders` per program | balanced |
| Textures — marine | `WebGLMarineTextureState.createTexture` (accounted) + **2 raw `gl.createTexture()`** at `WebGLMarineTextureEncoder.js:521, 707` + 1 at `WebGLMarineEngine.js:2654` | `disposeEngine` `WebGLMarineEngineInit.js:266-276` via `safeDeleteTexture` | GL objects freed; **accounting is NOT — see §6b** |
| Textures — wind | `WebGLWindUtils` 5, `WebGLWindEngine` 2 | 21 raw `gl.deleteTexture` (`WebGLWindEngineInit` 9, `WebGLWindEngine` 12) | GL objects freed. ⚠️ Wind bypasses `safeDeleteTexture` entirely, so the file header's claim that "the accounting now lives in the ONE function every deletion passes through" is **already false for 21 sites**. Currently harmless only because no wind site increments the counters. |

`WindColorRamp.createRampTexture` (`:278`, `gl.createTexture()`, no delete) has **zero callers** —
the wind engine builds its ramp with `createTexture(gl, gl.LINEAR, rampData, 256, 1)` at
`WebGLWindEngine.js:398,1084` and deletes it at `:309,397,1083` and in `disposeEngine`. Dead export.

---

## 6. FABRICATED / DRIFTING RENDER TELEMETRY (the two headline findings)

### 6a. `__RAW_GPU__.activeRafCount` is a hardcoded `1`, and it is the program's runtime evidence for A11

```
git grep -in "rafcount" -- frontend/src frontend/public frontend/e2e backend
frontend/src/components/map/WebGLMarineEngine.js:106:      activeRafCount: 1,
```

**One occurrence in the entire repo.** No write site, no bracket-notation write
(`git grep -n "__RAW_GPU__\["` → 0), no `Object.assign` onto it.

**POSITIVE CONTROLS from the same object literal** (`WebGLMarineEngine.js:101-114`) — every one of
these *does* have real write sites, found by the same grep:

| key | write sites |
|---|---|
| `drawCallsPerFrame` | `WebGLMarineEngine.js:473,1855,2136,2280,3144` |
| `framebufferCount` | `WebGLMarineEngineInit.js:183` |
| `droppedFrameCounter` | `WebGLMarineEngine.js:2317` |
| `frameTimeHistogram` | `WebGLMarineEngine.js:2310-2314` |
| `textureUploadCount` | `WebGLMarineTextureState.js:56,79` |
| **`activeRafCount`** | **none** |
| **`shaderCompileCount`** (literal `6`, comment "6 shaders compiled at start") | **none** |
| **`reactRerenderCounter`** | **none** |

**Who consumes it:** not the app — the **audit**.
`audit/weather-simulation-12.1/LIVE_OBJECTIVE_VERIFICATION_MATRIX.csv` LV-04;
`evidence/console/LV-04_truth_overlay_fabricates_fps_on_the_wire.md:12`;
`CURRENT_ARCHITECTURE_CONVERGENCE_MAP.md:60` ("**Stable — now runtime-confirmed**");
`PROGRAM_OBJECTIVE_REGISTER.csv` WS-OBJ-301 Notes; and WS-CAN-0022's 12.1 note, verbatim:
*"FIRST LIVE RUNTIME CONFIRMATION 12.1 (LV-04): `__RAW_GPU__.activeRafCount = 1` with
`activeLayers = []` … Previously grep-only."*

The reading is invariant: it returns `1` whether zero RAF loops or twelve are running. Audit 11.1
footnoted this correctly (`SYSTEM_CAPACITY_DELTA.md:178`: *"it does not enumerate"*); 12.1 promoted
the same number to a runtime confirmation.

★ The **conclusion** WS-CAN-0022 draws survives — `WeatherTelemetry.js:397,399` really has no
`cancelAnimationFrame`, by grep (§3). What does not survive is the claim that it was runtime-confirmed,
and the value `1` is factually wrong: §3 counts **three** loops alive while the map is mounted
(WeatherTelemetry, render-orchestrator, CanvasAnimationCoordinator when a fallback is registered).

### 6b. `textureCount` / `gpuMemoryEstimate` drift upward on every engine dispose

```
git grep -n "textureCount++\|textureCount--" -- frontend/src | grep -v '\.test\.'
  WebGLMarineTextureEncoder.js:661:  window.__RAW_GPU__.textureCount--;
  WebGLMarineTextureEncoder.js:731:  window.__RAW_GPU__.textureCount++;
  WebGLMarineTextureState.js:78:    window.__RAW_GPU__.textureCount++;

git grep -n "noteTextureCreated" -- frontend/src
  WebGLMarineTextureState.js:84   (the ONLY production registration site)
  WebGLWindUtils.js:251           (the definition)
```

The high-resolution land mask `_cachedMaskTex` is created **raw** at
`WebGLMarineTextureEncoder.js:707` (`maskTex = gl.createTexture()`), counted **manually** at
`:731-734` (`textureCount++`, `gpuMemoryEstimate += maskCanvas.width * maskCanvas.height * 4`), and
**never registered** with `noteTextureCreated`.

Its two release paths are asymmetric:

* **Mask REBUILD** — `:658-670` — raw `gl.deleteTexture` **plus a matching manual decrement** using
  `_cachedMaskTexDims`. Balanced. ✅
* **Engine DISPOSE** — `WebGLMarineEngineInit.js:274` — `safeDeleteTexture(gl, engine._cachedMaskTex, null)`.
  `safeDeleteTexture` (`WebGLWindUtils.js:274-295`) frees the GL object but gates its decrement on
  `TEX_DIMS.has(tex)` (`:286`), and `TEX_DIMS` is written **only** by `noteTextureCreated`.
  `_cachedMaskTex` is not in it. **No decrement. ❌**

Per dispose that is `+1` texture and `+ w·h·4` bytes retained forever in the estimate;
`_cachedMaskTexDims` is tiered up to 4096×2048 ⇒ **up to +33.55 MB per dispose**. Disposes are not
rare: `onRemove` fires on every `setStyle`, i.e. **every theme switch** (§4), and `LayerRegistry.js:236-240`
records a live measurement of *"9 engine_init / 12 engine_dispose off ~4 model clicks and 2 pans"*.

**Consumers of the poisoned numbers:**
* `TruthOverlayGpuTab.js:27` "GPU Memory", `:33` "Resident Textures";
* `TruthOverlay.js:133` — the `memory` field of the **only** client→server POST in the system
  (`/weather/client-diagnostics`), the same payload whose `fps` field was just repaired by WS-CAN-0063.

**Why the existing guard cannot see it.** `textureAccounting.test.js:39-45` builds its fixture with

```js
function makeTex(gl, w = W, h = H) {
  const tex = { id: Math.random() };
  window.__RAW_GPU__.textureCount++;
  window.__RAW_GPU__.gpuMemoryEstimate += w * h * 4;
  noteTextureCreated(tex, w, h);          // <- always
  return tex;
}
```

Every fixture texture is registered, so the test proves the *choke* and is structurally unable to
fail on a *production site that increments without registering*. That is precisely the shape the file's
own header warns about ("the fix was applied where the bug was, not where the invariant belongs").

### 6c. The rest of the render-telemetry fabrication census — including `fps: 60`, which WS-CAN-0063 removed from the READ site but not from the INITIAL-VALUE site

`WeatherTelemetry.js` is instantiated at module scope (`:549 export const WeatherTelemetry = new WeatherTelemetryEngine();`)
and published on `window.__WEATHER_TELEMETRY__` (`:550`) — the same object LV-04 read live.

```
grep -n "gpuStats\." frontend/src/components/map/WeatherTelemetry.js
  :278 fps: this.gpuStats.fps            (read, telemetry report)
  :279 memory: this.gpuStats.estimatedMemoryMb   (read)
  :388 this.gpuStats.fps = Math.round(...)       (WRITE — only after `now - lastTime >= 1000`)
  :393,394 read
  :407 this.gpuStats.shaderCompilations++        (WRITE — positive control)
  :478 this.gpuStats.contextResets++             (WRITE — positive control)
```

| field | declared at | write sites | reaches |
|---|---|---|---|
| `gpuStats.fps` | `:42` as the literal **`60`** | `:388` **only after ≥1000 ms of wall clock** | `TruthOverlay.js:132` (the client→server POST) and `:313` → GPU tab; `admin/advanced/WeatherDiagnostics.tsx:167-168` |
| `gpuStats.estimatedMemoryMb` | `:48` as `0` | **none** | emitted as `memory` at `:279` |
| `gpuStats.drawCalls` | `:44` | **none** | — |
| `gpuStats.textureCount` | `:45` | **none** | — |
| `gpuStats.shaderCompilations` | `:47` | `:407` ✅ | — |
| `gpuStats.contextResets` | `:46` | `:478` ✅ | — |

WS-CAN-0063 replaced `?.fps || 60` with `?.fps ?? null` at `TruthOverlay.js:132` so that a *measured*
`0` survives. It did not touch `WeatherTelemetry.js:42`, where `fps` is **initialised to `60`**. For the
first second of every session — and for any session whose render dies before the first 1 s tick —
`?? null` faithfully forwards a number nobody measured. Same value, same field, same transport; the
other end of the same defect.

Also on the same always-published object, `topologyMap.layers` (`:61-67`) hardcodes:

```
wind:  { engine: 'WebGL Wind Engine',    sync: 'Canvas2D RAF Overlay' },
waves: { engine: 'Canvas2D Foam Engine', sync: 'Orchestrated Local Reflow' }
```

At HEAD `waves` renders through `WebGLMarineEngine` (§2); Canvas2D is the *fallback* arm only.

⛔ **And it is not inert.** `topologyMap` is shipped out through `getDiagnosticReport()` (`:531`), whose
only consumer is the admin **Weather Diagnostics** page:

```
git grep -n "getDiagnosticReport" -- frontend/src backend
  frontend/src/admin/advanced/WeatherDiagnostics.tsx:13,42,74
  frontend/src/components/map/WeatherTelemetry.js:524   (definition)
```

`WeatherDiagnostics.tsx` renders, all in a green `successText` class:

| line | renders | truth at HEAD |
|---|---|---|
| `:430` | `report.topology.layers.waves.engine` → **"Canvas2D Foam Engine"** | `WebGLMarineEngine`, a WebGL2 MapLibre custom layer |
| `:426` | `report.topology.layers.wind.engine` → "WebGL Wind Engine" | correct |
| `:167-168` | `report.gpuStats.fps` with green >45 / amber >24 / red | the literal `60` until the first ≥1 s tick |
| `:342`, `:91` | `fail.memory` "MB" | `gpuStats.estimatedMemoryMb`, **zero write sites** ⇒ always `0` |

So a frontend admin status surface reports a renderer it does not use, a frame rate it has not yet
measured, and a memory figure nothing ever writes. WS-CAN-0010 closed "the three fabricated status
surfaces" — its census was `backend/routes/admin/system.py:208` and siblings. This page was not in it.

---

## 7. A DEAD-BUT-RUNNING PLUGIN RENDER SUBSYSTEM

`engine-bootstrap.initEngine` (`MapWebGL.js:659`, on `map-ready`) runs, in order:
`bindGPUContext(ctx.gl)` → **skipped, `ctx.gl` undefined**; `bootstrapCoreLayers()`; `initPlugins(ctx)`;
`startPluginRenderLoop()`; `startSimulation()`; `startDispatcher()`; `startHealthMonitor()`.

```
LayerRegistry.js:332-344   bootstrapCoreLayers()
  registerLayerPlugin({ id, type, dataSource, renderMode, updateFrequency, enabled: false })
                                            ^ no init / update / render / destroy member exists

git grep -n "setPluginEnabled" -- frontend/src
  frontend/src/components/map/LayerRegistry.js:281:export function setPluginEnabled(id, enabled) {   # definition only, ZERO callers
git grep -n "registerLayerPlugin" -- frontend/src | grep -v '\.test\.'
  LayerRegistry.js:233 (definition), LayerRegistry.js:334 (bootstrapCoreLayers)                # one production caller
```

Therefore `plugin.enabled` is `false` for every entry for the life of the app, and
`initPlugins` / `updatePlugins` / `renderPlugins` (`:299-321`, each guarded by `if (plugin.enabled && plugin.X)`)
are **provably no-ops**. Yet `render-orchestrator.startPluginRenderLoop()` runs an unconditional
display-rate RAF for the entire map session, executing `updatePlugins(FIXED_DT)` up to 4× per frame
plus `renderPlugins()` (`render-orchestrator.js:97,113`).

Two riders on the same finding:
* `engine/gpu-texture-manager.js` — its own `createTexture`/`createFramebuffer`/`destroyAll` — is
  never bound (no `ctx.gl`), so `destroyGPU()` in `shutdownEngine` is likewise a no-op.
* `render-orchestrator.getFPS()` (`:166`) computes a real per-second frame rate every second and has
  **zero consumers** (`git grep -n "getFPS\|getEngineDiagnostics\|isPluginLoopRunning" -- frontend/src`
  → the three definitions only), while SOTA row B4 records "frame rate **unmeasurable**".

---

## 8. THE RADAR / LIGHTNING RENDER FAMILY IS OUTSIDE EVERY PAINT-TRUTH GUARD

Four registered MapLibre protocols plus an imperative frame-layer manager render a live user-facing
layer, and none of it is instrumented.

**Silent transparent tile on failure.** `radarTileRecolor.makeAdvectHandler`:
* `:486` — `if (!prevUrl || !currUrl || !isFinite(leadFactor)) return { data: await advBlankTile() };`
* `:568-570` — catch → `return { data: await advBlankTile() }`, falling back to `new ArrayBuffer(0)`
* `advBlankTile` `:462-466` — *"untouched canvas = fully transparent"*

No counter, no `console`, no `WeatherTelemetry` call, no `traceOmBlock` analogue.

```
grep -n "window\.__" frontend/src/components/map/radarTileRecolor.js
  :270 __RAW_RADAR_LIGHTNING_DISABLED__   :590 __LTG_STRIKES__   :591 __LTG_REFRESH__
```

**Contrast — the `om://` handler does instrument its blocks:** `openMeteoProtocol.js:813,820,826`
call `traceOmBlock('missing_run' | 'transparent_sentinel' | 'model_lock', …)`, and its decode-error
fallbacks at `:894,909` at least emit `console.error` + `WeatherTelemetry.trackTileError`.

**The truth layer does not see radar at all:**
```
grep -n "radar\|lightning" frontend/src/components/map/weatherTruthTracker.js   -> 0
grep -c "waves\|wind"      frontend/src/components/map/weatherTruthTracker.js   -> 20   (positive control)
git grep -l "recordTruthStage" -- frontend/src | grep -v '\.test\.'             -> 15 files, none radar
useLayerTruthDiff.js:87-89   filters to sources ending in '-source'
                             (radar sources are 'radar-frame-<djb2>' -> excluded)
```

**And WS-CAN-0060's guard cannot reach it:** `layerColorScaleCoverage.test.js:64-77` iterates
`LAYER_REGISTRY` entries that have an `omVariable` and `type === 'raster' | 'marine'`. Radar has no
`omVariable` and no colour-scale key — it carries its own `recolorRadarImageData` /
`recolorDwdImageData` / `lightningTransform` palettes.

---

## 9. (f) RENDERERS AND RENDER BEHAVIOUR REACHABLE ONLY UNDER A FLAG

```
git grep -oh "window\.__RAW_[A-Z0-9_]*__ *=== *true" -- frontend/src/components/map frontend/src/engine \
  | sed 's/ *=== *true//' | sort -u | wc -l      -> 135 unique boolean flags
```

The overwhelming majority are `__RAW_DISABLE_*__` / `*_LEGACY__` **kill switches for a shipped,
default-ON behaviour** — the program's B12 strength, correctly recorded as such. Separating those out
leaves the default-**OFF** alternates, which is a different animal: an unshipped second implementation
of a live render responsibility, retained indefinitely.

| Flag | Site | What it arms | Kill switch also present |
|---|---|---|---|
| `__RAW_COAST_SDF__` | `maskCoastSDF.js:113`; shader branch `WebGLMarineEngine.js:1665,2007` (`u_coastSDFEnabled`) | signed-distance coastline instead of the alpha threshold | yes — `__RAW_DISABLE_COAST_SDF__` |
| `__RAW_ENABLE_BASE_COVER_GATE__` | `WebGLMarineEngine.js:1130,1138` | a coverage gate *demoted to opt-in after a live regression*, code retained | — |
| `__RAW_RATING_LIVING_BAND__` | `RenderPlanDispatcher.js:347-349` | score-scaled motion for the rating band | — |
| `__RAW_AXIS_FLOOR__` | `useOpenMeteoTileUrls.js:477-480` | a refusal on a not-live axis | — |
| `__RAW_RADAR_512_TILES__` | `MapWebGL.js:403` | 512 px supersampled radar tiles | `__RAW_RADAR_256_TILES__` |

Dev-gated render surfaces (correctly gated, listed for completeness): `MarineAnimTuner`
(`?tuner=1` / `localStorage.__RAW_TUNER__`), `haloDebugOverlay.js`, `scrubPerfProbe.js`
(`window.__SCRUB_PROBE_ON__`), `TruthOverlay` panel (`isDiagHudEnabled`, `TruthOverlay.js:327`).

---

## 10. ZERO-IMPORTER FILES IN THE RENDER / ENGINE TREE

Fourteen files, **2,775 LOC**, no module-path reference from any non-test file (suffix-tolerant grep,
control `GridParserWorker -> 1`):

| file | LOC | note |
|---|---|---|
| `engine/sessions/surf-intelligence.js` | 331 | |
| `engine/layer-plugins/marine-layers.js` | 312 | named "dead" by report 11.0 |
| `engine/layer-plugins/weather-layers.js` | 307 | |
| `engine/tile-streaming-system.js` | 259 | |
| `engine/data/model-normalizers.js` | 258 | |
| `map/useRasterTransactions.js` | 212 | contains 3 uncancelled RAF calls |
| `engine/IndustryPluginRuntime.js` | 200 | exports its own `getAllPlugins` — a name collision with the live `LayerRegistry.getAllPlugins` |
| `engine/queries/spot-hub-query.js` | 192 | |
| `engine/workers/forecast-decode-worker.js` | 153 | a worker nothing constructs |
| `engine/FieldInterpolator.js` | 149 | |
| `engine/render-pipeline.js` | 117 | named "Delete" by report 11.0 |
| `engine/layer-plugins/rain-layer.js` | 109 | |
| `engine/layer-renderers/webgl-layer.js` | 95 | **a fourth file named like the marine layer** |
| `map/usePressureEngine.js` | 81 | referenced only in comments/docstrings of live files |

`GridParserWorker.js` (749 LOC) is **live** — `useGridWorker.js:25-26`,
`new Worker(new URL('./GridParserWorker.js', import.meta.url))`. It is the positive control.

---

## 11. FULL GL/RENDER SIGNAL TABLE (39 files carrying any GL/RAF/canvas/protocol signal)

See `_table_gl.md` (generated alongside this file) and `fe-render-inventory.json` for all 203 scanned
files with per-file flag counts.

---

## 12. REGISTER DIFF — WHAT THE 12.0/12.1 REGISTERS NAME, AND WHAT THEY DO NOT

```
for k in <name>; do grep -rl "$k" audit/weather-simulation-12.1/*.csv audit/weather-simulation-12.1/*.md \
                                  audit/weather-simulation-12.0/*.csv; done
```

| Render surface | Named in a register? |
|---|---|
| `openMeteoProtocol` / `om://` | ✅ WS-CAN-0060, WS-CAN-0061, WS-OBJ-101 |
| `WebGLWindEngine` | ✅ WS-CAN-0011, WS-CAN-0012 |
| `OceanMask` | ✅ (WS-CAN-0032, mask settle debounce) |
| `LayerRegistry` | ⚠️ once — as WS-CAN-0060's colour-scale fixture, **not** the plugin lifecycle |
| `radarTileRecolor` / `radarAdvection` | ❌ **zero** occurrences in either register |
| `GPUMarineLayer` / `WindParticleOverlay` | ❌ zero (11.0's D-02 covered them; 12.1 carries only the residual as WS-CAN-0022) |
| `CanvasAnimationCoordinator` | ❌ zero |
| `WebGLMarineMaskRenderer` | ❌ zero |
| `render-orchestrator` | ❌ zero |
| `maskCoastSDF` / `__RAW_COAST_SDF__` | ❌ zero |
| `GridParserWorker` | ❌ zero by name (the worker interface `useGridWorker` is WS-CAN-0008) |
| `IndustryPluginRuntime`, `tile-streaming-system`, `forecast-decode-worker` | ❌ zero |

---

## 13. THINGS THAT LOOKED LIKE FINDINGS AND WERE KILLED

* **"The om:// handler silently returns blank tiles."** It does at `:885`, but that is the *intended*
  marine path (marine paints via WebGL, so the raster must be transparent), and the two error paths
  at `:894,909` emit `console.error` + `WeatherTelemetry.trackTileError`. The three *block* paths are
  traced via `traceOmBlock`. Not a gap.
* **"The Canvas2D fallbacks freeze after a `userTier` change."** True and still current at HEAD —
  `GPUMarineLayer.js:374,546,558` and `WindParticleOverlay.js:255,487,498` capture the coordinator
  singleton in effects with deps `[mapInstance]` only, while `MapWebGL.js:662-694` calls
  `disposeAnimationCoordinator()` from an effect keyed `[mapInstance, userTier]`. But this is 11.0's
  D-02 and it is explicitly inside WS-CAN-0022's title ("userTier zombie shutdown"). **Covered.**
* **"Protocols are never unregistered."** 5 `addProtocol`, 0 `removeProtocol` — but all five are
  idempotent (module `_registered` flag / try-catch) and MapLibre's protocol map is process-global by
  design. No unbounded growth. Not a gap.
* **"`WebGLFilterEngine` has an unhandled WebGL context."** True (`utils/WebGLFilterEngine.js:191`,
  no `webglcontextlost`) — but it is the photo-filter engine, not a weather-simulation render surface.
  Recorded here, not raised.
* **"Wind textures are unaccounted."** True — `noteTextureCreated` is never called for wind — but
  wind never *increments* either, so the counters are symmetric and no number is wrong today. Latent,
  folded into §6b's narrative rather than raised separately.
* **"The wind Canvas2D fallback is untested."** `force_marine_fallback` is set by
  `frontend/e2e/weather-simulation.spec.js:262` and `_diag_maploader.mjs:60`; `force_wind_fallback` is
  set nowhere. But SOTA row B11 already records context-loss recovery as ⚠️ partial. **Covered.**
