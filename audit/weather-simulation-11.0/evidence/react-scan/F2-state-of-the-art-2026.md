# F2 — State of the Art, August 2026: current primary sources vs. what this repo actually installs

**Agent F — read-only research pass. No source file under `frontend/src`, `backend`, `scripts`, `tests`
or any config/lockfile was modified.**

| | |
|---|---|
| Repo | `C:/Users/dprit/Raw-Surf` |
| Branch | `dev` |
| HEAD at brief | `3d3ccdc2` (tree clean at session start per brief) |
| **Access date for every web citation below** | **2026-08-09** |
| Scope | installed dependency inventory (measured, not read off manifests where possible) + current primary-source guidance |
| Deliverable rule | *no technology is recommended without naming the CONFIRMED limitation it addresses; where the limitation is not confirmed in THIS repo the decision is Benchmark First / Defer / Reject, never Adopt* |

**Evidence vocabulary used below:** `CODE FACT` = read with the Read tool or `node -e require(...)` at a
cited path/line. `MEASURED` = I executed something and report its output. `NOT MEASURED` = a consequence
I did not execute — spelled out with the test that would settle it. Web claims carry the URL I actually
fetched; failed fetches are listed in §12.

---

## 1. INSTALLED VERSION INVENTORY (measured, not assumed)

### 1a. Frontend — read from `node_modules/*/package.json` via `node -e`, not from `package.json` ranges

| Package | **Installed (measured)** | Declared range (`frontend/package.json`) | Current upstream (2026-08-09) |
|---|---|---|---|
| `maplibre-gl` | **5.24.0** | `^5.24.0` (line 56) | **6.2.0** (2026-08-06) |
| `react` | **19.2.6** | `^19.0.0` (line 58) | 19.x |
| `react-dom` | **19.2.6** | `^19.0.0` (line 60) | 19.x |
| `react-scripts` | **5.0.1** | `5.0.1` (line 67) | 5.0.1 (unmaintained; CRA retired) |
| `@craco/craco` | **7.1.0** | `^7.1.0` (line 106) | 7.x |
| `@playwright/test` | **1.60.0** | `^1.60.0` (line 108) | **1.62.1** |
| `react-scan` | **0.5.6** | `^0.5.6` (line 127) | 0.5.x |
| `typescript` | **6.0.3** | `^6.0.3` (line 129) | 6.x |
| `spectorjs` | **0.9.30** | `^0.9.30` (line 70) | 0.9.x |
| `react-map-gl` | **8.1.1** | `^8.1.1` (line 63) | 8.x |
| `@sakitam-gis/maplibre-wind` | **2.0.3** | `^2.0.3` (line 37) | 2.x |
| `@openmeteo/weather-map-layer` | **0.0.19** | `^0.0.19` (line 9) | 0.0.x |

**Node runtime pinned for the deployed build:** `NODE_VERSION = "18.20.2"` — `netlify.toml:7`. **CODE FACT.**

**Peer/dep constraints that bind a MapLibre upgrade — CODE FACT, read from installed manifests:**

- `react-map-gl@8.1.1` → `peerDependencies: { "maplibre-gl": ">=1.13.0" }`, marked **optional**. *Permissive — does not block v6.*
- `@sakitam-gis/maplibre-wind@2.0.3` → `peerDependencies: { "maplibre-gl": ">=3.0.0" }`. *Permissive — does not block v6.*
- **`@openmeteo/weather-map-layer@0.0.19` → `dependencies: { "maplibre-gl": "^5.20.1" }`** — a **hard dependency, not a peer**. This is the single binding blocker on a clean MapLibre 6 upgrade: npm will install a *second, duplicate* MapLibre 5 copy under that package, which for a library that adds a **custom layer into the host map's GL context** means two different MapLibre runtimes sharing one canvas.

### 1b. Backend — declared vs. actually resolvable

Declared (`backend/requirements.txt`): `xarray==2026.7.0` (line 64), `netCDF4==1.7.4` (65), `h5netcdf==1.8.1` (66),
`copernicusmarine==2.4.1` (63), `pygrib==2.1.8` (69), `ecmwf-opendata==0.3.34` (74), `shapely==2.0.4` (32).
`numpy` and `zarr` are **deliberately unpinned** — `requirements.txt:54-59` states the reason (a producer/consumer
split: the serving lane runs 3.12, the artifact-writing workflows run 3.11, resolving numpy 2.4.6 vs 2.5.1 and
zarr 3.1.6 vs 3.3.0).

**MEASURED** on the working interpreter (`C:/Users/dprit/AppData/Local/Python/bin/python3.exe`, `importlib.metadata`):

```
numpy 2.4.4      scipy NOT INSTALLED      xarray 2026.4.0    netCDF4 1.7.4
cfgrib 0.9.15.1  dask 2026.3.0            zarr 3.2.1         pandas 3.0.3
pygrib NOT INSTALLED    copernicusmarine 2.4.1   ecmwf-opendata NOT INSTALLED
h5netcdf 1.8.1   shapely NOT INSTALLED    numcodecs 0.16.5   fsspec 2026.4.0
kerchunk NOT INSTALLED  virtualizarr NOT INSTALLED   icechunk NOT INSTALLED
eccodes 2.47.0   jax NOT INSTALLED        torch NOT INSTALLED
```

Two things follow immediately, both **CODE FACT / MEASURED**:

1. **The local interpreter is not the declared stack.** `xarray` locally is **2026.4.0**; `requirements.txt`
   pins **2026.7.0**. `pygrib`, `shapely` and `ecmwf-opendata` are **absent locally** — so every GRIB-decoding
   and ECMWF fetch path in `backend/services/*_fetcher.py` is **unrunnable on this machine**. Any local
   "measurement" of those lanes would be measuring an import error, not the forecast.
2. **Zarr is installed but never used.** `backend/scripts/artifact_interpreter_parity.py:16` states it, and I
   confirmed it independently: a repo-wide grep for `import zarr` / `from zarr` / `to_zarr` / `.zarr` store
   over `**/*.py` returns **no production hit** (the only `zarr` mentions are that docstring and a comment in
   `services/copernicus_global_fetcher.py:5` describing *CMEMS's* upstream store). `kerchunk`, `virtualizarr`
   and `icechunk` are absent entirely. This is load-bearing for §8.

### 1c. What the data path actually is (so §8's recommendations are anchored to it)

**CODE FACT**, from grepping `backend/services/`:

- **GRIB2 via `pygrib`** — NOAA GFS/GFS-Wave (`noaa_gfs_*_fetcher.py`), DWD ICON + GWAM
  (`dwd_icon_wind_fetcher.py:111`, `dwd_gwam_fetcher.py:198`), ECMWF open data
  (`ecmwf_opendata_fetcher.py`). ICON arrives as `.grib2.bz2` on an **icosahedral** grid with separate
  `clat`/`clon` invariant files (`dwd_icon_pressure_fetcher.py:11-12,134-135`).
- **NetCDF via `copernicusmarine` + `xarray`** — CMEMS, written to a temp `.nc`
  (`copernicus_global_fetcher.py:135`, `copernicus_marine_service.py:517`).
- **Output is JSON**, Open-Meteo-shaped (`ecmwf_opendata_fetcher.py:23`), serialized with
  `json.dumps(separators=(",", ":"))` (`artifact_interpreter_parity.py` docstring).
- The nearshore transform is **analytic**, composed in `services/weather_pipeline/surf_point.py`
  (`resolve_surf_geometry` → shore-normal precedence chain → break depth → shelf) feeding
  `surf_transform.estimate_surf`. The module docstring is explicit that it exists to stop the composition
  being re-derived per caller.

---

## 2. DOMAIN A — MapLibre GL JS `CustomLayerInterface` + projection contract

### 2a. The contract for the **installed** version, read from the installed artifact

I did not take this from the website. I read `frontend/node_modules/maplibre-gl/dist/maplibre-gl.d.ts` and
`.../src/webgl/draw/draw_custom.ts` at version 5.24.0.

**`CustomRenderMethod`** — `maplibre-gl.d.ts:5004`:

```ts
export type CustomRenderMethod = (gl: WebGLRenderingContext | WebGL2RenderingContext,
                                  options: CustomRenderMethodInput) => void;
```

Two positional args, `gl` **first**. `CustomRenderMethodInput` (`:4901-4999`) carries
`farZ, nearZ, fov, modelViewProjectionMatrix, projectionMatrix, shaderData{variantName, vertexShaderPrelude, define}, defaultProjectionData`.
`ProjectionData` (`:4830-4879`) carries `mainMatrix, tileMercatorCoords, clippingPlane, projectionTransition, fallbackMatrix`.

**`renderingMode`** — `maplibre-gl.d.ts:5017-5021`, verbatim:

> `"renderingMode": "3d"` to use the depth buffer and share it with other layers
> `"renderingMode": "2d"` to add a layer with no depth. If you need to use the depth buffer for a `"2d"` layer you must use an offscreen framebuffer and `CustomLayerInterface.prerender`

**The state contract** — `maplibre-gl.d.ts:5091-5101`, verbatim:

> The layer can assume blending and depth state is set to allow the layer to properly blend and clip other
> layers. **The layer cannot make any other assumptions about the current GL state.** …
> The blend function is set to `gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)`. This expects colors to be
> provided in premultiplied alpha form…

Note the direction: the spec constrains what the layer may **assume**, and says nothing requiring the layer to
**restore**. §3 shows why.

**Public docs cross-check** (fetched 2026-08-09):
<https://maplibre.org/maplibre-gl-js/docs/API/interfaces/CustomLayerInterface/> — the published page renders the
render signature in its *destructured object* form (`render({gl, modelViewProjectionMatrix})`), matching the
`NullIslandLayer` example embedded in the same typings at `:5058-5064`. **The published page and the typings
describe the same call; the example just destructures.** A reader who takes the published page literally as
"one object argument" would be wrong — the runtime call is two positional args (proved in §2b).

### 2b. What MapLibre 5.24.0 actually calls — read from source, not docs

`frontend/node_modules/maplibre-gl/src/webgl/draw/draw_custom.ts:45-63`:

```ts
} else if (painter.renderPass === 'translucent') {
    painter.setCustomLayerDefaults();
    context.setColorMode(painter.colorModeForRenderPass());
    context.setStencilMode(StencilMode.disabled);
    const depthMode = renderingMode === '3d' ? painter.getDepthModeFor3D()
                                             : painter.getDepthModeForSublayer(0, DepthMode.ReadOnly);
    context.setDepthMode(depthMode);
    implementation.render(context.gl, customLayerArgs);   // ← two positional args
    context.setDirty();
    painter.setBaseState();
    context.bindFramebuffer.set(null);
}
```

and `:16` — `const projectionData = transform.getProjectionDataForCustomLayer(isRenderingGlobe);`

### 2c. How this repo's layer meets that contract

`frontend/src/components/map/WebGLMarineCustomLayer.js`:

- `renderingMode: '2d'` (`:79`) — correct: the marine engine uses no depth.
- `render(glOrArgs, matrixArg)` (`:112`) with a **runtime type shim** (`:114-146`) that handles *four* shapes:
  `(gl, Float32Array)`, `(gl, optionsObject)`, `({gl,...})`, and a raw fallback. Under 5.24.0 the branch taken is
  `isWebGLCtx === true` with `matrixArg` an object, so the matrix resolves as
  `matrixArg.defaultProjectionData?.mainMatrix || matrixArg.mercatorMatrix || matrixArg.mainMatrix || matrixArg.modelViewProjectionMatrix` (`:120`).
- `onAdd(_mapOrArgs, glArg)` (`:82-83`) with the same shim.

**Compatibility verdict — CODE FACT:** `defaultProjectionData.mainMatrix` **does exist** in 5.24.0
(`maplibre-gl.d.ts:4836`) and is the documented custom-layer projection matrix, so the first branch of the `||`
chain hits and the shim is behaving correctly today. The shim is *defensive over-engineering* against a v4-era
signature, not a bug.

**The latent hazard is projection, and it is not live.** `mainMatrix` is documented (`:4832-4834`) as: *"For
mercator projection, it usually projects in-tile coordinates 0..EXTENT to screen, for globe projection, it
projects a unit sphere planet to screen."* If globe were ever enabled, the same field would silently start
meaning something else and the engine's mercator-assuming shaders would draw garbage rather than error.
**A repo-wide grep of `frontend/src` for `setProjection` and for a `projection:` map option returns
zero hits** (MEASURED) — the only `globe` matches are comments. The map is mercator-only, with
`renderWorldCopies={true}` at `MapWebGL.js:989`.
⇒ **Not a live defect. It is a tripwire on any future globe flip.**

⚠️ **A correction to a neighbouring claim, made because I checked it rather than inherited it.** D1 §D-21
cites `worldCopyJump: true` at `mapUtils.js:259` as part of the MapLibre antimeridian story. I read
`mapUtils.js:255-262` and that flag sits in an options object alongside `preferCanvas`, `zoomControl`,
`attributionControl`, `maxBoundsViscosity` and `tap` — **all Leaflet options**, and `leaflet@1.9.4` is a
declared dependency (`package.json:53`). **That line configures Leaflet, not MapLibre.** It therefore
contributes nothing to MapLibre's world-copy behaviour. This does not change any decision below; it is
recorded so the claim is not carried forward as MapLibre configuration.

### 2d. What changed since the installed major

Fetched <https://api.github.com/repos/maplibre/maplibre-gl-js/releases> and
<https://api.github.com/repos/maplibre/maplibre-gl-js/releases/tags/v5.24.0> (2026-08-09):

| Version | Published | Relevant content (quoted) |
|---|---|---|
| **5.24.0** | **2026-04-23** | "GPU performance optimization: Render halo and glyph in a single pass (-40% Time Reduction)"; "Optimize matrix inversions and reduce GPU stalls" |
| **6.0.0** | **2026-07-22** | "Switch to an ESM-only distribution (`maplibre-gl.mjs`). The UMD bundles are no longer published"; **"WebGL (v1) support has been removed; WebGL2 is now required"**; "`Map` now composes a `Camera` instead of extending it"; "All map events are now real classes"; TypeScript target ES2022; **"Expose `getProjectionData` function in custom layer args objects"** |
| **6.1.0** | **2026-07-30** | `ImageSource` decoded-image updates; `GeoJSONSource.getClusterOptions`; `MapOptions.rotateSpeed`/`pitchSpeed`; globe latitude precision fixes |
| **6.2.0** | **2026-08-06** | `fill-extrusion-rounded-corner-distance`; Mercator rendering + terrain elevation sampling perf |

**So: the repo is on the last release of the previous major, 3.5 months old, and the new major is 18 days old.**
That is a defensible position, not neglect. The blocker is §1a's `@openmeteo/weather-map-layer@0.0.19` hard-pinning
`maplibre-gl: ^5.20.1`, plus the ESM-only distribution meeting a `react-scripts@5.0.1` (webpack 5, but with
`NODE_OPTIONS=--openssl-legacy-provider` in the build script, `package.json:80`) toolchain.

### 2e. `triggerRepaint` semantics

Typings (`:5013-5015`), verbatim: *"They can trigger rendering using `Map.triggerRepaint`"*. Nothing in the 5.24.0
contract makes the repaint automatic for a custom layer; a layer that wants continuous animation must schedule it.
That is exactly what `WebGLMarineCustomLayer.js:327` does — and exactly why D1's **D-05** (the `triggerRepaint()`
sitting *inside* the same `try` as `engine.render()`, `:322-338`) is a real structural risk: one throw drops the
self-sustaining chain. **The MapLibre contract does not save you here; there is no framework-level heartbeat.**
This is a repo-shape issue, not a version issue — see the decision table row `F-A4`.

---

## 3. DOMAIN B — WebGL resource lifecycle, state sharing, and WebGPU in 2026

### 3a. The most consequential finding in this pass: MapLibre 5.24.0 already invalidates its own state cache

`frontend/node_modules/maplibre-gl/src/render/painter.ts:760-777`, verbatim comment and body:

```
/*
 * Reset some GL state to default values to avoid hard-to-debug bugs in custom layers.
 */
setCustomLayerDefaults() {
    // Prevent custom layers from unintentionally modify the last VAO used.
    // All other state is state is restored on it's own, but for VAOs it's
    // simpler to unbind so that we don't have to track the state of VAOs.
    this.context.unbindVAO();
    // The default values for this state is meaningful and often expected.
    this.context.cullFace.setDefault();
    this.context.activeTexture.setDefault();
    this.context.pixelStoreUnpack.setDefault();
    this.context.pixelStoreUnpackPremultiplyAlpha.setDefault();
    this.context.pixelStoreUnpackFlipY.setDefault();
}
```

and `src/webgl/context.ts:160-192` — `setDirty()` sets `.dirty = true` on **every** cached value:
`clearColor, clearDepth, clearStencil, colorMask, depthMask, stencilMask, stencilFunc, stencilOp, stencilTest,
depthRange, depthTest, depthFunc, blend, blendFunc, blendColor, blendEquation, cullFace, cullFaceSide, frontFace,
program, activeTexture, viewport, bindFramebuffer, bindRenderbuffer, bindTexture, bindVertexBuffer,
bindElementBuffer, bindVertexArray, pixelStoreUnpack, pixelStoreUnpackPremultiplyAlpha, pixelStoreUnpackFlipY`.

`draw_custom.ts:60-62` calls `setDirty()` + `setBaseState()` + `bindFramebuffer.set(null)` **after every custom
layer draw**, and `setCustomLayerDefaults()` **before every one**. MapLibre's `Value` wrapper (`src/webgl/value.ts`)
skips redundant `gl.*` calls only while `dirty === false`; marking everything dirty forces MapLibre to re-issue
each state call the next time it is used.

**⇒ CODE FACT: for MapLibre's own subsequent drawing, and for a *sibling* custom layer, MapLibre 5.24.0
restores/re-asserts every piece of GL state this repo's `WebGLStateIsolation.js` captures — with one exception.**

**The exception is `SCISSOR_TEST`.** I grepped `src/webgl/*.ts` and `src/render/painter.ts` for `scissor`:
**zero hits.** MapLibre 5.24.0 does not track scissor at all, so a custom layer that leaves `SCISSOR_TEST`
enabled would corrupt every subsequent draw and MapLibre would never fix it.
`WebGLStateIsolation.js:31,125-129` does save/restore it. **That part earns its place.**

### 3b. What the repo pays for the redundant part — CONFIRMED cost shape, NOT MEASURED magnitude

`frontend/src/components/map/WebGLStateIsolation.js`:

- `captureWebGLState` issues **20 explicit `gl.getParameter` calls** (`:13-35,42`) plus **7 more inside the
  texture-unit loop** (`:52-57`) = **27 `gl.getParameter` per call**, plus 8 `gl.activeTexture` calls.
- It is called **once per engine per frame** and is **reachable**, verified by grep of call sites:
  `WebGLMarineEngine.js:599` (restore at `:2305`) and `WebGLWindEngine.js:447` (restore at `:1027`).
- With both engines active that is **up to 54 `gl.getParameter` calls per frame**; at the marine layer's
  self-driven repaint rate (`WebGLMarineCustomLayer.js:327`) that is ~3,240/s.

`gl.getParameter` for **binding** queries (`FRAMEBUFFER_BINDING`, `CURRENT_PROGRAM`, `TEXTURE_BINDING_2D`,
`ARRAY_BUFFER_BINDING`, `VERTEX_ARRAY_BINDING`) is the classic synchronous-readback shape in a
command-buffer browser architecture. **I did not measure it here** — that requires the live browser lane.
`spectorjs@0.9.30` is already installed (`package.json:70`) and is the right instrument.

**Required benchmark before any change:** with the map idle and a marine layer on, capture one frame in
Spector.js and count `getParameter` calls; then A/B `captureWebGLState` reduced to the scissor-only subset
against the full capture, comparing `window.__RAW_GPU__.frameTimeHistogram` and `droppedFrameCounter`
(installed at `WebGLMarineEngine.js:101-114`) over a fixed 60 s idle window.
**Until that runs, the decision is Benchmark First — not "delete it".** The 2026-08-09 widening from 4 to 7
texture units (`WebGLStateIsolation.js:48-51`, R11-10e) is documented as fixing a *real* leak of marine textures
into MapLibre's frame, which means at least one of the residuals was observed to matter.

⚠️ **A correctness caveat that cuts against simply trusting `setDirty()`:** `setDirty()` restores MapLibre's
*cache coherence*, not the GL state itself. Anything that reads GL state **without** going through MapLibre's
`Context` wrapper — including this repo's own second engine, `spectorjs`, or any third-party layer such as
`@openmeteo/weather-map-layer` — is still exposed. Two custom layers in one frame are each individually
bracketed by MapLibre, so the exposure is narrower than it looks, but it is not zero.

### 3c. WebGPU maturity in 2026

- MDN, <https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API> (page last modified 2026-05-05, fetched
  2026-08-09): **"Limited availability - This feature is not Baseline because it does not work in some of the
  most widely-used browsers."** Secure-context only.
- caniuse, <https://caniuse.com/webgpu> (fetched 2026-08-09): global support **85.56%**. Chrome 113+, Edge 113+,
  Samsung Internet 24+, Chrome Android 151+, **Safari iOS 26.0+ full / Safari desktop 26.0+ *partial***,
  **Firefox disabled by default across v153–156**.
- MapLibre's own roadmap, <https://maplibre.org/roadmap/maplibre-gl-js/graphics-modernization/> (fetched
  2026-08-09): four phases — (1) WebGL2 immutable textures + layout qualifiers, (2) Drawables + Uniform Buffer
  Objects, (3) integer vertex attributes / GLSL ES 3.00 / instancing, (4) **"Add the WebGPU code path, port GLSL
  shaders to WGSL, and establish WebGPU render testing."** **The page gives no dates and no status markers, and
  makes no mention of `CustomLayerInterface`.** WebGPU is Phase 4 and unshipped.

**Verdict: Reject for this repo, this year.** A custom layer renders *into the host map's context*. Until
MapLibre itself has a WebGPU backend, a WebGPU marine engine cannot compose with the basemap at all — it would
need a separate canvas and a separate compositing story, which re-creates the "second forecast path" shape the
project's own CLAUDE.md forbids by analogy. There is **no confirmed limitation in this repo that WebGPU addresses**:
the marine engine runs 296² = 87,616 particles (`WebGLMarineEngine.js:89`), which is not a compute-bound workload.

---

## 4. DOMAIN C — OffscreenCanvas and worker rendering

- MDN, <https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas> (fetched 2026-08-09):
  **"Baseline Widely available … It's been available across browsers since March 2023."** WebGL contexts in
  workers are shown in the documented example.

**The repo already uses it where it applies — CODE FACT:** `components/map/openMeteoProtocol.js:199-202`
(guarded `typeof OffscreenCanvas === 'undefined'` fallback) and `components/map/radarTileRecolor.js:287-288,
334-335, 348-349, 429-430`. Those are *tile decode/recolor* paths, which is the correct use.

**It does not apply to the marine/wind engines.** Those are MapLibre `CustomLayerInterface` implementations
that draw into MapLibre's own canvas (`WebGLMarineCustomLayer.js:326` passes `map.getCanvas().width/height`).
`transferControlToOffscreen()` detaches a canvas from the main thread permanently; you cannot transfer a canvas
MapLibre owns and still have MapLibre draw the basemap into it. **Not Applicable** — there is no confirmed
limitation here and no mechanism by which the technology could address one.

Worker usage today is already singleton-safe: `components/map/useGridWorker.js:22-25,70` holds a module-level
`_workerInstance`, so re-renders cannot spawn workers (independently corroborated by D1 §D-18).

---

## 5. DOMAIN D — React 19 rendering, profiling, React Scan, and when memoization is indicated

### 5a. Installed

React and React-DOM **19.2.6** (measured). No `<React.StrictMode>` — D1 §D-17 established this from
`index.js:305-310`; I did not re-derive it.

### 5b. React Compiler — primary sources

- <https://react.dev/blog/2025/10/07/react-compiler-1> (fetched 2026-08-09). **React Compiler 1.0, released
  2025-10-07.** Verbatim: *"React Compiler is compatible with React 17 and up."* On when manual memoization is
  still indicated, verbatim:

  > "in some cases developers may need more control over memoization. The `useMemo` and `useCallback` hooks can
  > continue to be used with React Compiler as an escape hatch … A common use-case for this is if a memoized value
  > is used as an effect dependency, in order to ensure that an effect does not fire repeatedly even when its
  > dependencies do not meaningfully change."

  Reported effect at Meta: *"initial loads and cross-page navigations improve by up to 12%, while certain
  interactions are more than 2.5× faster. Memory usage stays neutral."*

- <https://react.dev/learn/react-compiler/installation> (fetched 2026-08-09):
  `npm install -D babel-plugin-react-compiler@latest`; **"React Compiler must run *first* in your Babel plugin
  pipeline."**; *"React Compiler is designed to work best with React 19, but it also supports React 17 and 18."*;
  requires `eslint-plugin-react-hooks@latest` with the compiler rules in the `recommended-latest` preset.
  **The docs do not mention `react-scripts`/CRA**; for webpack they point at a community loader
  (`react-compiler-webpack`).

### 5c. Does this repo have a confirmed limitation the compiler addresses?

**Partly, and the honest answer is "not yet costed".**

The candidate is D1 §D-18: `MapWeatherControls.js:458,464,509,510` pass **inline arrow functions** into
`ForecastWheel`, invalidating `commit`/`setHour`/`settle`/`coast`/`onPointerDown`/`onPointerMove`
(`ForecastWheel.js:205,212,226,241,251,269`) on every render. That is precisely the identity churn the compiler
auto-memoizes. **But D1 explicitly classified it as "reconcile churn, not a re-init storm" and did not measure
its cost.** Under this brief's rule, an unconfirmed limitation cannot yield `Adopt`.

There is also a **live compatibility risk specific to this codebase**: the compiler enforces the Rules of React,
and this app deliberately mutates and reads bare globals during render/effects at scale — `window.isScrubbingTimeline`
read as a hard gate at 60+ sites (D1 §D-03), 465 distinct `window.__*__` identifiers across 1,505 sites (D1 §2).
Compiler bailouts on those components are *likely* and would make the win smaller than the headline number, while
any component it *does* compile changes effect-firing timing in the map path — the highest-blast-radius code here.

**Decision: Benchmark First**, with a concrete, already-built instrument: arm `window.__SCRUB_PROBE_ON__ = true`,
run one full scrub, read `window.__SCRUB_PROBE__.mapWebGLRenders` (`scrubPerfProbe.js:11-14`) before and after
enabling the compiler on `components/map/**` only via craco's Babel hook. If `mapWebGLRenders` does not move, the
limitation was never real and the decision becomes Reject.

### 5d. Profiling instrumentation — the repo is already at the current state of the art

- <https://react.dev/reference/react/Profiler> (fetched 2026-08-09): `onRender(id, phase, actualDuration,
  baseDuration, startTime, commitTime)`; **"Profiling adds some additional overhead, so it is disabled in the
  production build by default"**; production profiling requires *"a special production build with profiling
  enabled."*
- The repo's own harness, `frontend/scripts/live_session_diagnostic.js:31-35,172-178`, already documents the
  better instrument, **measured rather than assumed**: react-scan's auto build exposes `window.reactScan` as a
  *bare function*, so the reliable commit stream is `__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot` — *"that is
  what react-scan itself wraps, it is version-proof, and it costs a function call per commit instead of a repaint."*
  It injects the **local** `node_modules/react-scan/dist/auto.global.js` (`:58-62`) so a blocked CDN cannot
  masquerade as zero renders, and keeps the overlay opt-in behind `LSD_SCAN_OVERLAY=1` (`:220`) because it
  *"repaints per commit"* and would inflate the very timings being measured.
- `public/index.html:10-33` gates the CDN react-scan to `localhost`/`127.0.0.1`/`?reactscan=1`, **pins the
  version** (`react-scan@0.5.6`, `:22`, matching the installed 0.5.6), and sets
  `window.__REACT_SCAN_STATUS__ = 'loading'|'loaded'|'failed'` with an `onerror` handler
  (`:20,24,26`) — so an absent profiler is distinguishable from an idle app.

**This is better practice than the upstream default.** Nothing to adopt. **Keep Current Approach.**

---

## 6. DOMAIN E — Playwright trace / video / visual testing

### 6a. Installed vs current

Installed **1.60.0**; latest **1.62.1** (<https://registry.npmjs.org/@playwright/test/latest>, fetched
2026-08-09). From <https://playwright.dev/docs/release-notes> (fetched 2026-08-09):

- **1.60** — HAR recording as a first-class tracing API: `tracing.startHar()` / `tracing.stopHar()`; ARIA
  snapshots gain a `boxes` option.
- **1.61** — `testOptions.video` gains `'on-all-retries'`, `'retain-on-first-failure'`,
  `'retain-on-failure-and-retries'`; WebAuthn virtual authenticator.
- **1.62** — `page.screencast` with action annotations, overlays and real-time frame capture; **WebP screenshots**
  for visual comparison and standalone screenshots.

Trace modes (<https://playwright.dev/docs/trace-viewer>, fetched 2026-08-09): `'on'` (*"not recommended as it's
performance heavy"*), `'off'`, `'on-first-retry'`, `'on-all-retries'`, `'retain-on-failure'`.

### 6b. What this repo configures — CODE FACT

`frontend/playwright.config.js:33-37`:

```js
use: {
  baseURL: process.env.E2E_BASE_URL || 'https://dev--rawsurf.netlify.app',
  trace: 'on-first-retry',
  screenshot: 'only-on-failure',
},
```

`timeout: 90000` (`:27`), `retries: process.env.CI ? 2 : 0` (`:30`), four projects incl. Mobile Safari (`:38-55`).

**Three confirmed gaps, all CODE FACT:**

1. **No `video` at all.** A grep of `e2e/*.js` and `playwright.config.js` for `video`/`screencast` returns
   **zero hits**. For an *animated GL field* whose failures are temporal (frozen animation, missed repaint,
   stale timeline — D1's D-01/D-03/D-05/D-06), a still screenshot on failure is close to the least informative
   artifact available. `trace: 'on-first-retry'` does capture screencast frames, but only on the retry.
2. **No `toHaveScreenshot`.** Zero hits repo-wide. The suite hand-rolls pixel comparison:
   `e2e/weather-simulation.spec.js:653-655` takes `page.screenshot({clip})` pairs and `e2e/pngPixels.js`
   (108 lines) computes `diffFraction`/`varianceFraction`.
3. **`baseURL` is a live deployment**, so the suite grades a *deployed artifact*, not this tree (`:34`, and the
   config's own comment at `:6-9` says so).

### 6c. …and why gap 2 is **not** a defect

Reading `e2e/weather-simulation.spec.js:640-670` changed my initial view. The hand-rolled oracle is *better
suited to this problem than `toHaveScreenshot`*:

- It clips to mid-ocean and excludes UI, with a stated reason (*"the +1d readout repaint alone measured 0.16%
  and could masquerade as field change"*, `:641-643`).
- It takes a **control pair** at the same hour ~1.2 s apart to self-calibrate the animation noise floor
  (`:651-656`) — because *"foam phase is wall-clock and cannot be frozen; that is WHY the threshold is
  self-calibrated"*.
- It **refuses rather than lies** when the environment cannot paint (`:664-667`):
  `test.skip(structure < 0.02, "marine wash produced no field pixels in this environment … pixel truth requires
  a painting GL environment; run headed/GPU")`, and again if animation noise dominates (`:669`).

A golden-image `toHaveScreenshot` baseline cannot be stable against a wall-clock-phased animated field; the
`stylePath`/`animations:'disabled'` levers Playwright documents suppress CSS animation, not GL. **Reject** for
the field oracle. `toHaveScreenshot` remains reasonable for *static* chrome (legend, scrubber, infobox) — but
no confirmed limitation there is named, so that stays **Defer**.

### 6d. The real limitation gap 3 exposes, with a current-source fix

`e2e/weather-simulation.spec.js:660-663` records the measurement directly: *"the run showed engine resident +
diag renderable + **ZERO field pixels** on this headless runner (a white void; SwiftShader-class silent
no-paint)"*. **This is the confirmed limitation**: the CI lane cannot execute GL, so a green run there is a skip,
not a pass.

Current primary guidance: <https://playwright.dev/docs/browsers> (fetched 2026-08-09) —
*"Playwright ships a regular Chromium build for headed operations and a separate chromium headless shell for
headless mode"*, and you *"opt into the new headless mode by using `'chromium'` channel"*, which is
*"the real Chrome browser, and is thus more authentic, reliable, and offers more features."* The current
Desktop Chrome project (`playwright.config.js:43-45`) uses `devices['Desktop Chrome']` with **no `channel`**, so
it gets the headless *shell* — the build with the weakest GL story.

**This is a `Repair Current Approach`, not an adoption**: add `channel: 'chromium'` plus GPU launch args to the
one project that runs the GL oracle, and keep the existing `test.skip` refusal as the safety net. Benchmark:
re-run `weather-simulation.spec.js` and check `varianceFraction` crosses 0.02 — that single number tells you
whether the lane became real.

---

## 7. DOMAIN F — Service-worker cache versioning, abortable fetch, transferables, SharedArrayBuffer

### 7a. Service-worker cache versioning — already correct

**CODE FACT:** `frontend/public/service-worker.js:3-8` keys four of five caches on
`const BUILD_VERSION = 'd50cc058'`; `GALLERY_CACHE_NAME` is deliberately unversioned (`:7`, *"Gallery persists
across deploys"*). `frontend/update-sw-version.js:7-22` stamps `git rev-parse --short HEAD` into **both** the SW
and `src/buildVersion.js`, and its own comment gives the reason: *"a session on a stale service-worker cache is
then provable from one log line instead of a re-diagnosis"*.

**And it is actually wired into the deploy** — `netlify.toml:3`:
`command = "node update-sw-version.js && npm install --legacy-peer-deps && CI=false npm run build"`.
I checked this specifically because a stamping script that never runs is the classic silent failure. It runs.

Weather routes are excluded from the SW entirely (D1 §D-12, `service-worker.js:100-101`) and localhost actively
unregisters (D1 §D-13, `index.js:319-330`). **Keep Current Approach — nothing in current guidance improves on this.**

**The one thing that IS behind current practice here is the Node pin.** `netlify.toml:7` sets
`NODE_VERSION = "18.20.2"`. Per <https://nodejs.org/en/about/previous-releases> (fetched 2026-08-09):
**Node 18 (Hydrogen) reached End-of-Life 2025-03-27** — 16 months ago. Node 20 (Iron) is **also EOL, 2026-03-24**.
Node 22 (Jod) moved to Maintenance 2026-07-28. **Active LTS in August 2026 is Node 24 (Krypton).** The build is
running on a runtime that has had no security patches for over a year. `--legacy-peer-deps` on the same line
additionally masks the exact peer conflicts §1a describes.

### 7b. Abortable fetch — present and used

**MEASURED:** `AbortController` appears in **21 files** under `frontend/src`, including every hot weather path:
`useMarineDataFetcherCore.js`, `useMarineOrchestrator.js`, `marineGridSeries.js`, `windGridSeries.js`,
`windController.js`, `useOpenMeteoTileUrls.js`, `useTemporalPreloader.js`, `useSpotRatings.js`,
`useExactPointFetch.js`, `openMeteoProtocol.js`, plus dedicated leak/retry tests
(`marineGridSeries.leak.test.js`, `marineGridSeries.retry.test.js`, `marineInFlightRegistry.test.js`).
**Keep Current Approach.**

### 7c. Transferable buffers and SharedArrayBuffer — Not Applicable, and that is the right answer

**MEASURED:** grep for `SharedArrayBuffer`, `crossOriginIsolated`, `Cross-Origin-Embedder-Policy`, `COOP` across
`frontend/src`, `frontend/public`, `frontend/netlify` returns **zero hits**. Grep for a transfer list
(`postMessage(..., [...])`) returns **zero hits**.

MDN, <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer>
(fetched 2026-08-09), verbatim: *"To use shared memory your document must be in a secure context **and
cross-origin isolated**"* — i.e. `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy:
require-corp`. Baseline widely available since December 2021.

**Reject.** Enabling cross-origin isolation would require CORP/CORS headers on **every** cross-origin subresource
this app loads — and `public/index.html:51-60` alone preconnects/loads Google Fonts (two stylesheets), Mapbox tile
API, unpkg (react-scan), and the Render backend. The cost is a site-wide header migration with a real chance of
silently breaking third-party assets, against **no confirmed limitation**: the only worker in the weather path is
a singleton grid worker, and no measurement shows main↔worker copy cost as a bottleneck.

**Transferable `ArrayBuffer`s are the cheap, isolation-free half of this** — worth revisiting *only* if a
measurement ever shows `useGridWorker` postMessage copy cost is material. Today it is unmeasured. **Defer.**

---

## 8. DOMAIN G — Cloud-native forecast data access in 2026

### 8a. Current state of the ecosystem (sources fetched 2026-08-09)

| Technology | Status | Source |
|---|---|---|
| **Zarr-Python 3** | 3.0 released Jan 2025; blog's most recent post *"Evolving Zarr Governance"*, **2026-03-05** | <https://zarr.dev/blog/> |
| **VirtualiZarr** | Active; *"supports a range of archival file formats, including netCDF4 and HDF5"*; default HDF backend is now a native `HDFVirtualBackend`, **replacing** the kerchunk wrapper | <https://virtualizarr.readthedocs.io/en/latest/index.html>, <https://github.com/zarr-developers/VirtualiZarr> |
| **Kerchunk** | Pioneering but being superseded: *"Once the Icechunk specification reaches a stable v1.0, it would be recommended to use that over Kerchunk's references"* | VirtualiZarr FAQ |
| **Icechunk** | **2.0** current; *"open-source, cloud-native transactional tensor storage engine"*; migration guides exist for both 1.0 and 2.0 | <https://icechunk.io/en/latest/> |
| **NOAA GFS on AWS** | `noaa-gfs-bdp-pds` (us-east-1), 4 cycles/day 00/06/12/18Z, SNS new-object notifications. **The registry entry does not list GFS-Wave and does not advertise a Zarr/ARCO mirror.** | <https://registry.opendata.aws/noaa-gfs-bdp-pds/> |
| **ECMWF open data** | IFS **and** AIFS, *"0.25 degrees resolution in GRIB2 format unless stated otherwise"*, CCSDS compression, **CC-BY-4.0**, 00/06/12/18Z, rolling ~2–3 day archive. IFS 00/12z: 0–144 h @3 h then 150–360 h @6 h; 06/18z: 0–144 h. AIFS: 6-hourly to 360 h | <https://www.ecmwf.int/en/forecasts/datasets/open-data> |

### 8b. Does any of it address a confirmed limitation in **this** repo?

**No — and the reason is architectural, not a matter of taste.**

The ARCO/Zarr stack solves *random access into a large archive without downloading whole files*. This repo's
access pattern is the opposite: per-cycle **regional subsets of the newest run**, already byte-range-limited by
the vendor's own index. `ecmwf_opendata_fetcher.py:8-9` states it: the client *"resolves the latest available
cycle and byte-range-downloads only the requested params via each file's `.index`"* — that **is** the
kerchunk/virtual-reference idea, delivered by the publisher, for free, with no reference file for this repo to
build or maintain. CMEMS is fetched through `copernicusmarine`, which already does server-side subsetting
(`copernicus_global_fetcher.py:5` records the failure mode of *not* doing so: *"Lazy open_dataset + isel-stride
OOMs (the CMEMS zarr is map-chunked 1024x2048…)"* — i.e. the team has already been burned by naïve chunk-aligned
access and routed around it).

Against that, the deployment constraint is decisive and is recorded in the repo: `requirements-dev.txt:61-62` —
*"The serve box is a 1-CPU / 2 GiB instance that has been OOM-killed at 1,579 MB"*. Icechunk/VirtualiZarr add a
Rust extension, an object-store client and a Dask-shaped access model to an image that already cannot afford
`cdsapi`.

**Decisions: Zarr v3 / VirtualiZarr / Icechunk / Kerchunk → Defer.** The condition that would flip any of them to
`Prototype` is specific and testable: *a requirement to serve arbitrary historical time-slices across many spots
from the team's own archive* (e.g. moving the ERA5 climatology campaign from per-spot `cdsapi` pulls to a
self-hosted store). That requirement does not exist today.

**One thing here IS actionable and it is a hygiene repair, not an adoption.** `zarr` and `dask` are installed as
unexercised transitives (§1b) — and `requirements.txt:54-59` deliberately leaves `numpy`/`zarr` unpinned because
producer (3.11) and consumer (3.12) lanes disagree. Since **zarr is provably unused**, the zarr half of that
producer/consumer split is a *phantom* blocker: it cannot change any artifact. The unresolved half is **numpy**
(2.4.6 vs 2.5.1), which does reach `services/weather_pipeline/ocean_access.py`. `artifact_interpreter_parity.py`
is exactly the right instrument and already exists. **Complete Existing Migration** — run it on both
interpreters, and if digests match, pin numpy and move the writer workflows to 3.12.

### 8c. GRIB2 handling — `pygrib` vs `cfgrib`

**CODE FACT:** the repo decodes with `pygrib` (`requirements.txt:69`; `dwd_gwam_fetcher.py:198`,
`dwd_icon_wind_fetcher.py:111`, `ecmwf_opendata_fetcher.py`), and the requirements comment records the reason:
*"pygrib manylinux wheels bundle the ecCodes binary, so no apt step is needed on Render."* `cfgrib` (0.9.15.1) is
present on my local interpreter but **absent from `requirements.txt`** and imported nowhere.

`cfgrib` would buy xarray-native GRIB access; it would cost an ecCodes system dependency on a memory-constrained
box, and would not change a single forecast number. **Keep Current Approach.**

### 8d. ECMWF AIFS — the one genuinely new, genuinely relevant capability

**On 12 May 2026 ECMWF's AIFS ENS began producing operational wave forecasts** — its first operational
data-driven wave forecasts (<https://www.ecmwf.int/en/forecasts/datasets/aifs-forecast-aifs-ensemble-wave-set-xiii-aifs-ens-wave>,
fetched 2026-08-09). Configuration from that page, verbatim: *"4 forecast runs per day (00/06/12/18)"*,
*"6 hourly steps to 360 (15 days)"*, *"0.25° x 0.25° lat/lon grid or any multiple thereof (global or sub-area)"*.
AIFS ENS itself is *"50 perturbed members and one control member"* at ~30 km
(<https://www.ecmwf.int/en/newsletter/185/earth-system-science/aifs-ens-becomes-operational>) — with the caveat,
quoted from the same article, that it is *"currently overdispersive for a range of upper-air variables"*.

**And the repo can already reach it.** `ecmwf-opendata==0.3.34` (`requirements.txt:74`) is the **latest** release
(published **2026-07-30**, <https://pypi.org/pypi/ecmwf-opendata/json>), and its documented model keys are
`ifs`, `aifs-single`, **`aifs-ens`**. The repo currently requests `stream="wave"` on the IFS model only —
`ecmwf_opendata_fetcher.py:55`: `LAYER_STREAM = {"wind": "oper", "pressure": "oper", "waves": "wave"}`.

**But it does not fix the confirmed EURO limitation.** That limitation is stated in the repo at
`ecmwf_opendata_fetcher.py:16-17`: *"The free wave stream has NO swell-partition params (shww/shts) — total sea
only, so swell_1/swell_2/wind_waves stay on their existing sources."* The AIFS ENS Wave parameter list on the
ECMWF dataset page is the same shape — significant wave height **by period band** (10–12 s, 12–14 s, 14–17 s,
17–21 s, 21–25 s, 25–30 s), combined wind-waves-and-swell height, mean wave direction, mean wave period, drag
coefficient, model bathymetry. **No partitions.** So AIFS ENS Wave would add *ensemble spread*, not partitions.

The repo has already extracted most of the available value from the band route, with a measurement:
`ecmwf_opendata_fetcher.py:60-70` records a band-closure probe over 20,494 ocean cells of the 20260802/00z cycle
— `sqrt(sum(band²))/swh` p50 0.5549, p90 0.8008, p99 0.9929, max 1.0012, **exceed 0.0%** — and correctly reads
the p50 near 0.55 as wind sea, not deficit. That is a higher standard of evidence than most of the literature.

⇒ **Prototype, not Adopt.** The named limitation an AIFS ENS wave feed *could* address is
**per-spot forecast uncertainty**, for which the repo already has a consumer surface
(`services/weather_pipeline/forecast_spread.py`, `forecast_skill.py`). Required benchmark, stated as a
falsifiable claim: over ≥2 weeks, does AIFS-ENS wave spread at the buoy-adjacent spots **correlate with the
realised error** of the shipped height (i.e. does high spread predict a bad forecast)? If spread does not
predict error, the feed adds bandwidth and a fetch lane for nothing. Cost note: 51 members × 6-hourly × 15 days
is a large multiple of the current single-field fetch on a 1-CPU/2 GiB box — start with `type="em"`/`"es"`
(ensemble mean / standard deviation), which the client supports and which is a **two-field** fetch.

---

## 9. DOMAIN H — Vector-field rendering, particle advection, large geospatial textures

### 9a. What the repo does — CODE FACT

`WebGLMarineEngine.js:89`: `this.particleRes = 296;  // 296² = 87,616 crests`. Advection runs in an
FBO-based ping-pong at fixed particle resolution — `:2219` sets `u_particles_res`, `:2234`
`gl.viewport(0, 0, this.particleRes, this.particleRes)`, and `:2129` draws
`this.particleRes * this.particleRes * 6` quad vertices. A repo-wide grep for `transformFeedback` /
`TRANSFORM_FEEDBACK` returns **zero hits**.

The FBO is **viewport-independent** (D1 §D-20 established this at `WebGLMarineEngine.js:2232-2234`), which is
why the DPR/resize class of bug does not reach it.

### 9b. Current practice, and whether it indicates a change

Surveyed sources (fetched 2026-08-09) — the canonical GPGPU pattern set: ping-pong FBOs for stateful fields
(<https://ostefani.dev/tech-notes/ping-pong-technique>, <https://ostefani.dev/tech-notes/webgl-fluid-advection>),
WebGL2 **transform feedback** writing particle state directly into VBOs with rasterisation disabled
(<https://github.com/code4fukui/webgl2-gpgpu-test>), and ring-buffered timestep streaming for unsteady flow
(<https://arxiv.org/pdf/2201.08440>, *A Guide to Particle Advection Performance*).

**Assessment: the repo's choice is the correct one for its constraint, and transform feedback would be a
regression risk with no named benefit.** Transform feedback's win is avoiding the texture round-trip for very
large particle counts; at 87,616 particles the ping-pong texture is 296×296 and the advection pass is one
full-screen-quad draw. More importantly, transform feedback binds VAO/buffer state that MapLibre explicitly
unbinds around custom layers (`painter.ts:766-769`) — it *increases* the state-sharing surface described in §3,
in exchange for an unmeasured and probably negligible gain. **Reject.**

**Large geospatial textures** — the confirmed constraint here is not in the renderer, it is in the *encoding*:
the heatmap texture channel encodes height as `B = height/10`, which **saturates at 10 m**. That is a known,
documented project landmine, not a new finding, and it is an encoding decision, not a technology gap. No current
source recommends a different container; the fix (if wanted) is a wider-range encoding, which is a repo change
outside this brief's scope. **Not Applicable** to a technology decision.

---

## 10. DOMAIN I — Forecast validation practice for a small team, 2026

### 10a. Observations

NDBC moored buoys *"measure and transmit wave energy spectra from which significant wave height, dominant wave
period, and average wave period are derived"*, with real-time raw spectral products published at
<https://www.ndbc.noaa.gov/data_spec.shtml>, and a documented automated QC handbook
(<https://www.ndbc.noaa.gov/publications/NDBCHandbookofAutomatedDataQualityControl2023.pdf>). Incomplete spectral
records are flagged `W` and withheld — i.e. the feed already refuses rather than lies, and a validation harness
must honour that flag rather than treat a gap as a zero.

**The repo already consumes this class of data**: `services/weather_pipeline/buoy_calibration.py` and
`buoy_residual_retention.py` exist. **CODE FACT** (file listing); I did not audit their correctness — that is
outside this brief.

### 10b. Nearshore transformation

Operational practice is **nested spectral models**: regional WAVEWATCH III → SWAN for shallow-water refraction,
shoaling and sheltering. NOAA/PacIOOS runs SWAN regional grids at roughly 500 m producing 7-day output, nested in
a WW3 quarter-degree parent, with parts *"still in the testing and validation phase"*
(<https://catalog.data.gov/dataset/simulating-waves-nearshore-swan-regional-wave-model-oahu>,
<https://www.weather.gov/sti/coastalact_ww3>).

**Is running SWAN credible for this team? No, and the blocker is measured, not aesthetic.** The serve box is
*"a 1-CPU / 2 GiB instance that has been OOM-killed at 1,579 MB"* (`requirements-dev.txt:61-62`). A SWAN
nest is a bathymetry-grid spectral solve; it does not fit, and it would introduce exactly the second forecast
path CLAUDE.md forbids. The repo's analytic chain (`surf_point.resolve_surf_geometry` → shore normal from an
ETOPO 15 s asset → break depth → shelf → `estimate_surf`) is the right complexity tier for the deployment.
**Keep Current Approach.**

### 10c. Neural emulators — the 2026 picture changed, and it argues for *less* ambition, not more

Two facts from this cycle, both load-bearing:

1. **ECMWF's AIFS ENS became operational, including waves (12 May 2026)** — §8d.
2. **In the same May 2026 update ECMWF *stopped running* its experimental ML models — Aurora, FourCastNet,
   GraphCast and Pangu-Weather.** (Reported consistently across the ECMWF-linked results surfaced by search;
   I did **not** fetch a single ECMWF page stating all four names, so I classify this as **PROBABLE**, not
   confirmed — see §12.)

The GenCast headline (*"outperformed ECMWF's 51-member ENS on 97.2% of verification targets"*) comes from the
model's own publication and I did not fetch the paper; treat it as a vendor claim.

**The correct reading for a small team is: consume, do not train.** The frontier has moved *inside the
operational centres*, and their output is free under CC-BY-4.0. Training or fine-tuning a GNN coastal model here
would need a labelled nearshore dataset the team does not have, a GPU budget the deployment does not have, and
would land in the one subsystem the project's own history calls a regression graveyard.

**But there is a credible, small, high-value learned component, and the repo has already built most of it:**
**buoy-anchored bias correction / quantile mapping of the shipped height** — `buoy_calibration.py`,
`height_quantile_map.py`, `grid_size_climatology.py`, `forecast_skill.py` all exist. This is the standard,
defensible statistical-postprocessing route (model output statistics), it needs no GPU, and it is validated
against the very observations §10a describes. **Complete Existing Migration**, not Adopt.

⚠️ **One standing hazard that current sources reinforce**, and which the project already knows: ERA5
underestimates extremes, so a calibration fitted on reanalysis will systematically under-serve the tails. Any
learned correction must be evaluated **on the tails, not the median**.

---

## 11. THE DECISION TABLE

Every row: **Source | Source date/version | Access date | Installed version | Compatibility | Confirmed limitation addressed | Expected value | Migration cost | Regression risk | Required benchmark | Decision.**
Rows whose "confirmed limitation" cell says **NONE CONFIRMED** are, per the brief's rule, barred from `Adopt`.

| # | Technology / change | Source (fetched) | Source date / version | Access date | Installed version | Compatibility | Confirmed limitation addressed | Expected value | Migration cost | Regression risk | Required benchmark | **Decision** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **F-A1** | Stay on MapLibre GL JS 5.24.0 | GH releases API | 5.24.0 pub. 2026-04-23 | 2026-08-09 | **5.24.0** | Exact | Repo is on the **last** 5.x; no CVE or defect named | Zero churn in the highest-blast-radius subsystem | 0 | 0 | none | **Keep Current Approach** |
| **F-A2** | Upgrade to MapLibre 6.x | GH releases API; changelog | 6.0.0 2026-07-22 · 6.2.0 2026-08-06 | 2026-08-09 | 5.24.0 | **BLOCKED**: `@openmeteo/weather-map-layer@0.0.19` hard-deps `maplibre-gl:^5.20.1` → duplicate MapLibre in one GL context. Also ESM-only vs `react-scripts@5.0.1` + `--openssl-legacy-provider` | NONE CONFIRMED | Mercator perf work in 6.2.0; unquantified here | High: ESM-only bundling, `Map` composes `Camera`, events become classes, WebGL1 removal | **Very high** — one duplicated MapLibre runtime sharing a canvas is a silent-corruption class | After the dep blocker clears: full `weather-simulation.spec.js` on a **GL-capable** runner + `__RAW_GPU__` frame histogram A/B | **Defer** |
| **F-A3** | Keep `renderingMode:'2d'` | Installed typings `maplibre-gl.d.ts:5017-5021` | 5.24.0 | 2026-08-09 | `WebGLMarineCustomLayer.js:79` | Exact | Engine uses no depth; `'2d'` is the documented match | Correctness already held | 0 | 0 | none | **Keep Current Approach** |
| **F-A4** | Move `map.triggerRepaint()` **out of** the `try` that wraps `engine.render()` | Installed typings `:5013-5015` ("layers can trigger rendering using `Map.triggerRepaint`"); D1 §D-05 | 5.24.0 | 2026-08-09 | `WebGLMarineCustomLayer.js:322-338` | Exact — no API change | **CONFIRMED code shape**: a throw in `render()` skips `:327` and drops the self-sustaining repaint chain; MapLibre provides no heartbeat for custom layers | Removes an entire "frozen animation" failure mode | ~1 line (out of scope for this read-only pass) | Low, but changes frame scheduling under error — must be measured | Force a throw via a kill switch; confirm `__SIM_FRAME__` keeps advancing and `[WebGLMarine] Render error` still increments | **Repair Current Approach** |
| **F-A5** | Globe projection | `maplibre-gl.d.ts:4832-4834`; GH issue 5117 | 5.24.0 / 6.x | 2026-08-09 | mercator only (`setProjection`/`projection:`: **0 hits, measured**; `renderWorldCopies` `MapWebGL.js:989`) | Would silently change `defaultProjectionData.mainMatrix` semantics under the engine's mercator shaders | NONE CONFIRMED | none for surf | Very high (shader port to `projectTileFor3D`) | Very high | n/a | **Reject** |
| **F-B1** | Keep `WebGLStateIsolation` **scissor** save/restore | `maplibre-gl/src/webgl/context.ts` + `render/painter.ts` grep: **zero `scissor` hits** | 5.24.0 | 2026-08-09 | `WebGLStateIsolation.js:31,125-129` | Exact | **CONFIRMED**: MapLibre 5.24.0 tracks no scissor state; a leaked `SCISSOR_TEST` is unrecoverable | Prevents a whole-map corruption class | 0 | 0 | none | **Keep Current Approach** |
| **F-B2** | Trim the **redundant** part of `captureWebGLState` (blend/depth/stencil/program/buffers/VAO/viewport) | `draw_custom.ts:34-63`; `context.ts:160-192` (`setDirty` marks all cached state dirty); `painter.ts:764-777` ("All other state is state is restored on it's own") | 5.24.0 | 2026-08-09 | `WebGLStateIsolation.js:13-57` — **27 `gl.getParameter`/engine/frame**, up to **54/frame** with both engines (`WebGLMarineEngine.js:599`, `WebGLWindEngine.js:447`) | Exact | **Redundancy CONFIRMED as a code fact. Its COST is NOT MEASURED.** ⚠️ The 2026-08-09 4→7 texture-unit widening (`:48-51`, R11-10e) shows at least one residual was real | Fewer synchronous GL queries per frame | Low (one file) | **Medium-high** — this is a "remove a guard because the framework should handle it" change, the exact shape that regresses | Spector.js capture of one frame; then A/B scissor-only vs full capture over 60 s idle, comparing `__RAW_GPU__.frameTimeHistogram` + `droppedFrameCounter` | **Benchmark First** |
| **F-B3** | WebGPU custom layer | MDN WebGPU; caniuse; MapLibre graphics-modernization roadmap | MDN mod. 2026-05-05; roadmap undated | 2026-08-09 | n/a | **Impossible today** — a custom layer draws into MapLibre's context; MapLibre WebGPU is unshipped Phase 4 | NONE CONFIRMED | none | Prohibitive | Prohibitive | n/a | **Reject** |
| **F-C1** | OffscreenCanvas for marine/wind engines | MDN OffscreenCanvas (Baseline since Mar 2023) | 2026 | 2026-08-09 | already used in `openMeteoProtocol.js:199-202`, `radarTileRecolor.js:287+` | **Mechanically impossible** for the custom layers — MapLibre owns the canvas | NONE CONFIRMED | none | n/a | n/a | n/a | **Not Applicable** |
| **F-D1** | Keep react-scan @0.5.6 + DevTools `onCommitFiberRoot` harness | `react.dev/reference/react/Profiler`; repo `scripts/live_session_diagnostic.js:31-35,172-178`; `public/index.html:10-33` | React 19 docs, 2026 | 2026-08-09 | react-scan **0.5.6**, pinned in both HTML and devDeps | Exact | Repo already pins the CDN build, sets `__REACT_SCAN_STATUS__`, falls back to the local build, and keeps the overlay opt-in — **better than the upstream default** | Already realised | 0 | 0 | none | **Keep Current Approach** |
| **F-D2** | React Compiler 1.0 (`babel-plugin-react-compiler`) via craco | `react.dev/blog/2025/10/07/react-compiler-1`; `react.dev/learn/react-compiler/installation` | **1.0, 2025-10-07** | 2026-08-09 | React **19.2.6**; `@craco/craco@7.1.0` can inject a Babel plugin; docs do **not** cover CRA | Plugin must run **first** in the Babel pipeline; needs `eslint-plugin-react-hooks@latest` (installed: 5.2.0) | **NOT CONFIRMED as costly** — D1 §D-18 found inline-arrow churn at `MapWeatherControls.js:458,464,509,510` but classified it *"reconcile churn, not a re-init storm"* | Meta reports up to 12% load / 2.5× interaction | Medium; likely **bailouts** on the map components (bare-global reads at 60+ sites, `window.__*__` at 1,505 sites) | **High in the map path** — compiled components change effect-firing timing | `window.__SCRUB_PROBE_ON__=true`, one full scrub, compare `__SCRUB_PROBE__.mapWebGLRenders` before/after, scoped to `components/map/**` | **Benchmark First** |
| **F-D3** | React `<Profiler>` production-profiling build | `react.dev/reference/react/Profiler` ("disabled in the production build by default") | React 19 | 2026-08-09 | not used | Compatible | NONE CONFIRMED — the DevTools-hook harness already measures commits with lower overhead | Marginal | Medium (special build) | Low | n/a | **Reject** |
| **F-E1** | Upgrade Playwright 1.60.0 → 1.62.1 | `playwright.dev/docs/release-notes`; npm registry | 1.62.1 current | 2026-08-09 | **1.60.0** | Same major line | NONE CONFIRMED as a defect — but 1.61 `video` modes and 1.62 `page.screencast` are the artifacts a **temporal** GL failure needs | Better failure evidence | Low | Low | Re-run `weather-simulation.spec.js`; confirm no new failures | **Adopt** *(minor-version currency; the confirmed need is F-E2)* |
| **F-E2** | Add `video: 'retain-on-failure'` (1.61 modes) to the weather-sim project | `playwright.dev/docs/release-notes` (1.61) | 1.61 | 2026-08-09 | **zero `video`/`screencast` hits** in `e2e/` or `playwright.config.js` | Requires ≥1.61 (F-E1) | **CONFIRMED**: the failures this suite chases are temporal (D1 D-01/D-03/D-05/D-06) and the only artifact today is `screenshot:'only-on-failure'` (`playwright.config.js:36`) | A frozen animation becomes *visible* instead of inferred | Low (config) | Low (artifact size / CI time) | One deliberately-failed run producing a playable video | **Adopt** |
| **F-E3** | `expect(page).toHaveScreenshot()` golden images for the marine field | `playwright.dev/docs/test-snapshots` | current | 2026-08-09 | **zero hits**; hand-rolled `e2e/pngPixels.js` (108 lines) + `page.screenshot({clip})` at `weather-simulation.spec.js:653-655` | Available | NONE — and it would be **worse**: foam phase is wall-clock (`:651-653`), so no golden image can be stable; the existing oracle **self-calibrates** its noise floor with a control pair and **refuses** when the environment cannot paint (`:664-669`) | Negative | Low | High (flaky baselines in the highest-value spec) | n/a | **Reject** |
| **F-E4** | `channel:'chromium'` + GPU launch args on the GL project | `playwright.dev/docs/browsers` ("opt into the new headless mode by using `'chromium'` channel"; separate headless **shell** ships for headless mode) | current | 2026-08-09 | `devices['Desktop Chrome']`, **no `channel`** (`playwright.config.js:43-45`) | Compatible | **CONFIRMED, measured by the repo itself** — `weather-simulation.spec.js:660-663`: *"engine resident + diag renderable + **ZERO field pixels** on this headless runner (a white void; SwiftShader-class silent no-paint)"* ⇒ the GL lane is a **skip**, not a pass | Turns a permanently-skipped oracle into a real one | Low-medium (runner image / flags) | Low — the existing `test.skip` refusal stays as the net | Re-run the spec; check `varianceFraction` crosses the 0.02 gate at `:665` | **Repair Current Approach** |
| **F-F1** | Keep SW `BUILD_VERSION` cache keying | `service-worker.js:3-8`; `update-sw-version.js:7-22`; `netlify.toml:3` (script **is** wired into the build) | repo | 2026-08-09 | in place | Exact | Already meets current guidance; gallery cache deliberately unversioned (`:7`) | Realised | 0 | 0 | none | **Keep Current Approach** |
| **F-F2** | Move `NODE_VERSION` off 18.20.2 | `nodejs.org/en/about/previous-releases` | **Node 18 EOL 2025-03-27**; Node 20 EOL 2026-03-24; Node 22 → Maintenance 2026-07-28; **Active LTS = Node 24** | 2026-08-09 | `netlify.toml:7` = `"18.20.2"` | `react-scripts@5.0.1` on Node 22/24 needs verification; `NODE_OPTIONS=--openssl-legacy-provider` (`package.json:80`) is itself a Node-17+ workaround | **CONFIRMED**: the deployed build runs a runtime that has been unsupported for ~16 months | Security patches; unblocks toolchain moves | Medium — CRA 5 on modern Node is the risk, not Node itself | Medium — a build-only change, but this build is the frozen-prod story's only lever | Netlify branch deploy on Node 22 first, then 24; diff `build/` asset hashes and boot `/map` | **Repair Current Approach** |
| **F-F3** | Remove `--legacy-peer-deps` from the Netlify build | `netlify.toml:3` | repo | 2026-08-09 | present | Removing it will surface the §1a conflicts | **CONFIRMED as a masking mechanism**, but no downstream defect traced to it | Makes F-A2's blocker visible in CI instead of at runtime | Low | Medium — the build may simply start failing | Run `npm ci` without the flag locally and record the exact conflict set | **Benchmark First** |
| **F-F4** | SharedArrayBuffer + COOP/COEP | MDN SharedArrayBuffer ("must be in a secure context **and cross-origin isolated**"; Baseline since Dec 2021) | 2026 | 2026-08-09 | **zero hits** for `SharedArrayBuffer`/`crossOriginIsolated`/COEP | Would require CORP/CORS on every cross-origin subresource — Google Fonts ×2, Mapbox, unpkg, Render (`public/index.html:51-60`) | NONE CONFIRMED | none | High (site-wide headers) | High (silent third-party breakage) | n/a | **Reject** |
| **F-F5** | Transferable `ArrayBuffer`s in `useGridWorker` postMessage | MDN Transferable objects | 2026 | 2026-08-09 | zero transfer lists; singleton worker `useGridWorker.js:22-25,70` | Compatible | NONE CONFIRMED — copy cost unmeasured | Unknown | Low | Low-medium (detached-buffer bugs) | Measure postMessage duration for a full grid payload before changing anything | **Defer** |
| **F-F6** | Keep `AbortController` fetch cancellation | MDN; repo grep | 2026 | 2026-08-09 | **21 files**, incl. all weather fetchers + 3 dedicated leak/retry tests | Exact | Already current practice | Realised | 0 | 0 | none | **Keep Current Approach** |
| **F-G1** | Zarr v3 / VirtualiZarr / Icechunk 2.0 store | zarr.dev/blog; virtualizarr.readthedocs.io; icechunk.io | Zarr-Python 3.0 Jan 2025; Icechunk **2.0**; VirtualiZarr active | 2026-08-09 | `zarr 3.2.1` installed but **provably unused** (no `import zarr`/`to_zarr`/`.zarr` in repo); kerchunk/virtualizarr/icechunk **absent** | Would add Rust ext + object-store client to a **1-CPU / 2 GiB** box already OOM-killed at 1,579 MB (`requirements-dev.txt:61-62`) | NONE CONFIRMED — the access pattern is *newest cycle, regional subset*, and ECMWF's `.index` byte-range download (`ecmwf_opendata_fetcher.py:8-9`) already delivers the virtual-reference benefit for free | Only materialises for a self-hosted historical archive | High | High | n/a until the requirement exists | **Defer** |
| **F-G2** | Resolve the numpy producer/consumer split with the existing parity harness | `requirements.txt:54-59`; `backend/scripts/artifact_interpreter_parity.py` | repo, 2026-08-06 | 2026-08-09 | numpy unpinned; 3.11 lanes write what 3.12 serves | Exact | **CONFIRMED**: writer workflows (forecast-ingest, precompute, l2-orphan-sweep, calibration-census) run 3.11; the server runs 3.12; resolutions differ (numpy 2.4.6 vs 2.5.1) | Removes a live unpinned-dependency risk on the forecast path | Low — **the harness already exists** | Low | Run `artifact_interpreter_parity.py` on 3.11 and 3.12; compare digests | **Complete Existing Migration** |
| **F-G3** | Drop the *zarr half* of the split from the blocker rationale | `artifact_interpreter_parity.py:16`; my independent grep (no `import zarr` anywhere) | repo | 2026-08-09 | zarr 3.2.1 unexercised | Exact | **CONFIRMED**: zarr cannot change an artifact it never touches — it is a phantom half of the stated blocker | Narrows a decision from "two unknowns" to one | ~0 (documentation) | 0 | the same parity run | **Repair Current Approach** |
| **F-G4** | `cfgrib` instead of `pygrib` | repo `requirements.txt:69` comment; installed set | cfgrib 0.9.15.1 present locally, **not** in requirements | 2026-08-09 | pygrib (bundled ecCodes wheels — no apt step on Render) | Compatible in principle | NONE CONFIRMED | Zero change to any forecast number | Medium (ecCodes system dep) | Medium | n/a | **Keep Current Approach** |
| **F-G5** | ECMWF **AIFS ENS Wave** feed (`model="aifs-ens"`) | ECMWF Set XIII dataset page; ECMWF Newsletter 185; PyPI `ecmwf-opendata` | **Operational 2026-05-12**; client **0.3.34 pub. 2026-07-30 = installed** | 2026-08-09 | `ecmwf-opendata==0.3.34` (`requirements.txt:74`) **already supports `aifs-ens`**; repo uses IFS `stream="wave"` only (`ecmwf_opendata_fetcher.py:55`) | Free, CC-BY-4.0, 0.25°, 00/06/12/18Z, 6-hourly to 360 h | ⚠️ Does **NOT** fix the confirmed EURO gap — repo states *"The free wave stream has NO swell-partition params (shww/shts)"* (`:16-17`) and AIFS ENS Wave publishes the **same period-band shape**, no partitions. The limitation it *could* address is **per-spot uncertainty** (consumers exist: `forecast_spread.py`, `forecast_skill.py`) | Calibrated spread → honest confidence on the user's number | Medium; **start with `type="em"/"es"`** (2 fields) not 51 members, given the 2 GiB box | Medium — a new upstream lane is a new failure surface; AIFS ENS is *"currently overdispersive"* per ECMWF | Over ≥2 weeks at buoy-adjacent spots: does AIFS-ENS wave spread **correlate with realised error** of the shipped height? If not, reject | **Prototype** |
| **F-H1** | WebGL2 transform feedback for particle advection | ping-pong / TF survey sources; *A Guide to Particle Advection Performance* (arXiv 2201.08440) | 2022–2026 | 2026-08-09 | FBO ping-pong at `particleRes = 296` (87,616 particles), `WebGLMarineEngine.js:89,2129,2219,2234`; **zero** `transformFeedback` hits | Would bind VAO/buffer state that MapLibre explicitly unbinds around custom layers (`painter.ts:766-769`) | NONE CONFIRMED — 87k particles is not compute-bound | ~0 | High (shader + buffer rewrite) | High (enlarges the §3 state-sharing surface) | n/a | **Reject** |
| **F-I1** | Run a SWAN nest for nearshore transformation | NOAA/PacIOOS SWAN regional (~500 m, nested in WW3 ¼°); `weather.gov/sti/coastalact_ww3` | 2025–2026 | 2026-08-09 | analytic chain in `services/weather_pipeline/surf_point.py` | **Infeasible** on a 1-CPU / 2 GiB box OOM-killed at 1,579 MB | NONE CONFIRMED that SWAN uniquely fixes | Would be a second forecast path — forbidden by CLAUDE.md's ONE FORECAST COMPOSITION | Prohibitive | Prohibitive | n/a | **Reject** |
| **F-I2** | Buoy-anchored bias correction / quantile mapping | NDBC spectral products + automated QC handbook | NDBC QC handbook 2023; feed current | 2026-08-09 | **already built**: `buoy_calibration.py`, `buoy_residual_retention.py`, `height_quantile_map.py`, `grid_size_climatology.py`, `forecast_skill.py` | Exact — no new dependency | **CONFIRMED (project-standing)**: the mid-range still reads high (uncancelled input-compression error) | The highest-value, lowest-risk accuracy lever available | Low — finish, don't start | Medium — a calibration fitted on reanalysis under-serves tails (ERA5 underestimates extremes) | Evaluate **on the tails, not the median**; honour NDBC's `W` flag as *missing*, never zero | **Complete Existing Migration** |
| **F-I3** | Train/fine-tune our own neural wave or GNN coastal emulator | ECMWF May-2026 update (AIFS ENS operational; experimental ML models discontinued — **PROBABLE**, see §12); GenCast claim is vendor-reported | 2026 | 2026-08-09 | no torch, no jax (measured) | n/a | NONE CONFIRMED | Negative for this team — no labelled nearshore set, no GPU budget | Prohibitive | Prohibitive | n/a | **Reject** |

---

## 12. WHAT I COULD NOT ESTABLISH — be explicit

- **Fetch that failed:** `https://github.com/maplibre/maplibre-gl-js/blob/main/CHANGELOG.md` returned GitHub
  chrome + *"Uh oh! There was an error while loading"* with no file body. I recovered via
  `https://raw.githubusercontent.com/.../CHANGELOG.md` (versions, no dates) and the GitHub **releases API**
  (authoritative dates). All MapLibre version dates above come from the API, not the changelog.
- **Fetch that redirected without content:** `https://virtualizarr.readthedocs.io/en/latest/releases.html`
  redirected to `.../about/releases.html` and returned no release data. **I therefore have no VirtualiZarr version
  numbers or dates** — only the project's own feature/positioning statements. That gap does not change the
  decision (Defer), but the row must not be read as version-anchored.
- **ECMWF discontinuing Aurora / FourCastNet / GraphCast / Pangu-Weather (May 2026):** surfaced consistently in
  ECMWF-linked search results, but **I did not fetch a single ECMWF page stating all four names**. Classified
  **PROBABLE**. The decision it supports (F-I3 Reject) does not depend on it.
- **GenCast "97.2% of verification targets":** vendor/publication claim surfaced via search; **paper not fetched**.
  Do not quote it as independently verified.
- **AIFS ENS Wave member count:** the ECMWF Set XIII page did **not** state members. The 50+1 figure comes from
  the AIFS ENS newsletter article and describes AIFS ENS generally, not the wave stream specifically.
- **caniuse WebGPU numbers** are a third-party aggregate, not a browser-vendor statement. MDN's
  *"not Baseline"* is the primary claim; the 85.56% is corroboration only.
- **The cost of `gl.getParameter` (F-B2) is NOT MEASURED.** I established redundancy as a code fact and counted
  the calls; I did not time them. Anyone acting on F-B2 without the Spector.js benchmark is guessing.
- **I did not verify the correctness of any backend physics or calibration module.** §10's references to
  `buoy_calibration.py` etc. are file-existence facts establishing that a capability is present, not audits.
- **`@openmeteo/weather-map-layer` duplicate-MapLibre consequence (F-A2) is NOT MEASURED.** I confirmed the hard
  dependency from its installed `package.json`; I did not install MapLibre 6 to observe the resulting tree.
- **Production frontend is out of scope for everything above.** Production is the frozen Netlify shell pinned at
  `3bd38a83` (2026-05-20). Every frontend statement here describes **this tree** — the local dev surface — only.
- **One inherited claim was checked and found wrong** (§2c): `worldCopyJump: true` at `mapUtils.js:259` is a
  **Leaflet** option, not MapLibre configuration. Recorded rather than silently dropped, because the same
  attribution appears in D1 §D-21.
- **I did not re-derive D1's findings.** Where a limitation originates in D1 (D-01/D-03/D-05/D-06/D-17/D-18/D-20)
  I cite it as D1's and treat its own classification (Confirmed code fact vs. NOT MEASURED consequence) as
  binding — I did not upgrade any of them.
