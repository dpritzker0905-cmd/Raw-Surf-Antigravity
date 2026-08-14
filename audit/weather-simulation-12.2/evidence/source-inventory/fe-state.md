# FE STATE + LIFECYCLE + CONTROLS — raw source inventory (Audit 12.2)

**Scope:** React state, contexts, external stores, model state, layer state, timeline/scrubber state,
request state, worker state, mount/unmount, `visibilitychange`, resize, feature flags.
**Repo:** `C:\Users\dprit\Raw-Surf` · **branch** `dev` · **HEAD** `791fdf78` (verified `git rev-parse HEAD`).
**Working tree at read time:** only `backend/uploads/forecast_cache/{marine,wind}_global.json` modified —
no frontend file differs from HEAD, so every line/number below is a HEAD reading.

**Method note up front (per the 12.2 anti-inflation and absence rules):**
- Every "there is no X" below is paired with a **positive control** run with the *same command shape*
  over the *same path set*, so a zero is distinguishable from a broken search.
- Repo-wide searches use `git grep` (plain `grep -rn` reads the five orphan worktrees under
  `.claude/worktrees/` and returns another branch's content — that trap fired once during this audit
  and is recorded in §0).
- Counts are produced by scripts recorded verbatim in §1.1; no count is asserted from impression.

---

## §0 — Instrument calibration (what I ran, and the one trap that fired)

| Instrument | Result |
|---|---|
| `git rev-parse HEAD` | `791fdf78b91a056ff95e17d2aec22487aba0c2ad` |
| `grep -rn '__RAW_DISABLE_' --include=*.md .` | **CONTAMINATED** — first 20 hits were all `./.claude/worktrees/gracious-cannon-e4aed4/docs/...`, i.e. another branch's worktree. Re-run as `git grep -l "__RAW_DISABLE_" -- '*.md'` → 95 tracked files. All doc claims below use `git grep`. |
| Positive control for "no flag registry" | `git grep -niE "LAYER_REGISTRY *=" -- 'frontend/src/components/map/*.js'` → 1 hit (`LayerRegistry.js:50`). Same command shape for `FLAG_DEFAULTS\|FEATURE_FLAGS *=\|KILL_SWITCH_REGISTRY` → **0**. |
| Positive control for the global census | `__RAW_DOES_NOT_EXIST__` is the only name that appears **exclusively** in test files — it is the deliberate negative control inside the estate, and my classifier found it as such. |

---

## §1 — THE RUNTIME GLOBAL / FEATURE-FLAG SURFACE

### 1.1 How it was counted (exact script)

Written to the scratchpad, walked `frontend/src` recursively, `.js` only, `*.test.js` classified separately:

```python
pat   = re.compile(r'__(?:RAW|OM)_[A-Za-z0-9_]+__')
write = re.compile(r'(?:window|globalThis|self)\s*\.\s*(__(?:RAW|OM)_[A-Za-z0-9_]+__)\s*=[^=]')
```

| Measure | Value |
|---|---|
| Distinct `__RAW_*` / `__OM_*` names in `frontend/src` | **337** |
| …of which appear **only** in `*.test.js` | **1** (`__RAW_DOES_NOT_EXIST__`, the negative control) |
| Non-test `.js` files that read at least one | **93** |
| Names **written** by production code (`window.X = …`) | **81** |
| Names **read but never written by production code** — i.e. externally injected (devtools / e2e / localStorage bridge) | **255** |
| …of those, `_DISABLE`-named (kill switches, default = new behaviour ON) | **154** |
| …of those, non-`_DISABLE` (tunables + opt-ins) | **101** |
| Read as an **opt-in gate** `=== true`, non-`_DISABLE`-named ⇒ **default OFF** | **26** |

Widening beyond the `__RAW_`/`__OM_` namespace, `grep -rhoE '(window|globalThis|self)\.__[A-Za-z0-9_]+__'`
returns **~200 further distinct** `window.__X__` names (diagnostics rings, engine handles, service
flags). Audit 11.0 R11-15 already recorded the aggregate as *"the frontend has 474 `window.__*`
globals"* — **that count exists**; what does not exist anywhere in the program is the split between
**published diagnostics** and **externally-settable behavioural gates**, which is the split that
decides whether B2's exit-condition rule applies.

### 1.2 The 26 default-OFF opt-in gates (the ones B2 is about)

```
__RAW_ANIM_LEGACY__            __RAW_API_DEBUG__               __RAW_AXIS_FLOOR__
__RAW_BACKSTOP_IGNORE_GUARDRAIL__  __RAW_CANCEL_ZOOM_TILES_LEGACY__  __RAW_CLASSIC_SCRUBBER__
__RAW_COAST_SDF__              __RAW_ENABLE_BASE_COVER_GATE__  __RAW_ESTIMATED_POWERLAW__
__RAW_LAYER_CAP_ALIAS__        __RAW_MAP_OBSERVABILITY_LOG__   __RAW_MARINE_ARBITER__
__RAW_MARINE_BUFFER_SCALE_COLORS__  __RAW_MASK_INPUT_HASH__    __RAW_MODEL_SWITCH_BLANK_LEGACY__
__RAW_OM_MODEL_WIPE_LEGACY__   __RAW_RADAR_512_TILES__         __RAW_RATING_LIVING_BAND__
__RAW_REDUCED_MOTION__         __RAW_RES_WATCH_WARN__          __RAW_SHOW_FERRY_ROUTES__
__RAW_SLOT_FLIP_TIMEOUT_LEGACY__  __RAW_WATER_TEMP_COAST_BUFFER__  __RAW_WATER_TEMP_GREEN_LANDUSE__
__RAW_WATER_TEMP_LAKES_REPAINT__  __RAW_WIND_TRAIL_CLEAR_LEGACY__
```

Of these the program tracks exactly **one** (`__RAW_MARINE_ARBITER__` → WS-CAN-0043). The `_LEGACY__`
suffixed six are *restore-the-old-behaviour* switches — the new behaviour is live, so they need no
arm date. That leaves **≈19 built-but-dark behavioural paths with no dated arm-or-delete condition.**

Two exemplars, both self-documenting in source:

- **`__RAW_LAYER_CAP_ALIAS__`** — `LayerAccessResolver.js:135-155`. The comment states the live defect
  in the shipped default: *"The scrubber offers 14 days of a layer that carries 7"* (frontend calls the
  layer `rain`, backend capability rows call it `precipitation`, so the per-layer cap never matches and
  the model-wide max wins). The repair is written and **default OFF** because *"FIXING IT REDUCES WHAT
  USERS CAN REACH (14 d → 7 d), which is a product decision, so it stays owner-gated"*. No date.
- **`__RAW_AXIS_FLOOR__`** — `useOpenMeteoTileUrls.js:477-483`. Floors a declared cutover by the model's
  real axis so an over-reaching cutover becomes a *disclosed model substitution* instead of a silent
  stale frame. Default OFF. No date.

### 1.3 Who owns the `__RAW_GPU__` / `__OM_*` diagnostic globals

| Global | Writer (single) | Readers |
|---|---|---|
| `__RAW_GPU__` | `WebGLMarineEngine.js`, `WebGLMarineTextureEncoder.js`, `marineMaskShelter.js` (3 writers) | 18 prod files, incl. `TruthOverlay.js:310-315` |
| `__OM_URL_TRACE__` | `omUrlTrace.js` | 2 |
| `__OM_PROTOCOL_SETTINGS__` | `openMeteoProtocol.js` | 2 |
| `__OM_ACTIVE_MODELS__` | `useOpenMeteoTileUrls.js` | 2 |
| `__OM_BROADCAST_CHANNEL__` / `…_WORKER__` | `openMeteoProtocol.js` | 2 / 3 |
| `__LAYER_REGISTRY_DIAG__` | `LayerRegistry.js:422-426` (getters over `_reregisterCount`, `_pluginRegistry`) | — |
| `__MAP_RENDER_FPS__` | `useWebGLGuardrail.js:126` | **nobody** (write-only; a second, unread fps authority alongside `WeatherTelemetry.gpuStats.fps` which WS-CAN-0063 just repaired) |
| `__ACTIVE_MODEL__` | **nobody** — `git grep -nE "__ACTIVE_MODEL__\s*=" -- frontend/src` is empty (positive control: the same regex finds `window.activeModel =` at `useMarineOrchestrator.js:120`) | read at `WebGLWindUtils.js:188` as a fallback that can never fire |

**No flag registry, no defaults table, no runtime enumeration exists.** `git grep -niE
"FLAG_DEFAULTS|FEATURE_FLAGS *=|KILL_SWITCH_REGISTRY" -- 'frontend/src/components/map/*.js'
'frontend/src/hooks/*.js'` → 0 hits; positive control `LAYER_REGISTRY *=` → 1 hit. The best in-repo
enumeration is a handoff doc listing **30 of 337** (`docs/runbooks/HANDOFF-2026-07-06-eve-radar-runpin-euro-guard-lightning.md`).

---

## §2 — LOCALSTORAGE / SESSIONSTORAGE KEYS THE WEATHER FEATURE TOUCHES

Enumerated with
`grep -rhoE "(localStorage|sessionStorage)\.(getItem|setItem|removeItem)\(\s*['\"\`][^'\"\`]+"`
then filtered to weather sites. R = read, W = write.

| Key | R/W sites | Owner | Notes |
|---|---|---|---|
| `rawsurf-active-model` | W `useWeatherState.js:26`; R `useWeatherState.js:18`, `SpotHub.js:114`, `SpotConditions.js:143,175`, `Explore.js:155`, `UnifiedSpotDrawer.js:157`, `useExploreData.js:28` | `useWeatherState` | **one writer, six non-map readers.** Read at render time with no subscription — a model change on /map does not re-render SpotHub. `SpotHub.js:114` adds a URL override: `searchParams.get('model') \|\| localStorage.…` |
| `__SURF_MODE__` | W `backendWeatherServiceClient.js:161`; R `:147`, `marineCommitGate.js:182`, `marineEngineDecisions.js:277,291`, `WebGLMarineEngine.js:675,1007,1529,1557` | `backendWeatherServiceClient` | persisted render-mode toggle; also mirrored on `window.__SURF_MODE__` (41 occurrences) |
| `force_wind_fallback` / `force_marine_fallback` | R/W `MapWebGL.js:95,96,100,101,724,725,757,758,759` | `MapWebGL` + `window.__WEBGL_GUARDRAIL_FALLBACK__` | **persisted failure latch** — a guardrail trip survives reload until `.reset()` is called by hand. Named in WS-CAN-0022's residual list. |
| `__BACKEND_URL__` | R `LayerAccessResolver.js:33`, `useOpenMeteoForecast.js:154`, `apiClient.js:23` | none (dev override) | 3 independent copies of the same resolution ladder |
| `__USE_BACKEND_MARINE_SYSTEM__`, `__USE_BACKEND_WEATHER_SERVICE__`, `__USE_BACKEND_WIND_SERVICE__`, `__USE_BACKEND_COPERNICUS_SERVICE__`, `__USE_BACKEND_ICON_MARINE_SERVICE__` | R `backendWeatherServiceClient.js:70,90,109,129,175` | — | five persisted service-routing flags, all default-on-code, none with an exit condition |
| `rawsurf_backend_precipitation_enabled` / `…_pressure_enabled` | R `backendPrecipitationServiceClient.js:26`, `backendPressureServiceClient.js:25` | — | two more persisted routing flags |
| `marine_series` / `wind_series` | R `marineGridSeries.js:162`, `windGridSeries.js:74` | — | `=== 'false'` disables the series lane |
| `marine_sibling_prewarm` | R `marineController.js:95` | — | |
| `wind_model_prewarm` | R `windController.js:427` | — | |
| `rawsurf_cooldown_marine_count` | R/W `marineControllerUtils.js:183,186,202` | governor | |
| `rawsurf_cooldown_${domain}_until`, `rawsurf_failure_${requestKey}` | `marineRequestGovernor.js:287,218` | governor | **unbounded key family** — one key per domain / per request key, never swept |
| `rawsurf_marine_cache_v9` | R `RenderPlanDispatcher.js:40` | sim engine | |
| `__RAW_TUNER__`, `__RAW_DIAG__`, `__RAW_HEIGHT_UNIT__`, `__RAW_DISABLE_RATINGS_CDN__` | `MarineAnimTuner.js:54,56`, `TruthOverlay.js:22,24`, `heightUnits`, `spotRatingsCdn.js:36` | — | four of the `__RAW_` gates have a **localStorage bridge** as well as a window one |
| `debug-fce` | R `MapWebGL.js:300` | — | |
| `raw-surf-theme` | R/W `ThemeContext.js:14,33` | `ThemeContext` | the only weather-relevant context state with a single clean owner |

**Contexts:** `frontend/src/contexts/` contains exactly four (`AuthContext`, `PersonaContext`,
`PricingContext`, `ThemeContext`). **No weather/map/model/layer context exists** — all weather state is
prop-drilled from `MapPage` → `MapWebGL` → children, or passed through `window`. Positive control:
`ls frontend/src/contexts/` lists the four above and their one test file.

---

## §3 — BARE (UN-NAMESPACED) `window.*` STATE AUTHORITIES

These are the ones a `__RAW_`/`__OM_` census cannot see.

| Global | Writers | Readers | Cleanup on unmount |
|---|---|---|---|
| `window.isScrubbingTimeline` | **4 sites, 1 file** — `MapWeatherControls.js:401,413` (classic slider drag start/end) and `:461,467` (`wheelScrubStart`/`wheelScrubEnd`, passed to `ForecastWheel` as `onScrubStart`/`onScrubEnd`) | **50 occurrences across 24 non-test files** (list below) | **NONE** |
| `window.lastScrubTime` | `MapWeatherControls.js:414,468`, `WebGLMarineLayer.js:1088`, `RenderPlanDispatcher.js:475` | `useWebGLGuardrail.js:89` and others | n/a |
| `window.activeModel` | `useMarineOrchestrator.js:120` | `WebGLWindUtils.js:188`, `RenderPlanDispatcher.js:481` | **NONE** (effect has no return) |
| `window.activeMarineLayer` | `useMarineOrchestrator.js:121` | `RenderPlanDispatcher.js:482` | **NONE** |
| `window.activeTimeOffsetHours` | `useMarineOrchestrator.js:122` | `RenderPlanDispatcher.js:480` | **NONE** |
| `window.setActiveModel` / `setTimeOffsetHours` / `toggleLayer` / `setRadarFrameIndex` / `setIsPlayingTimeline` | `MapPage.js:211-216` (React setters published to `window`) | `scrubPerfProbe` harness | **NONE** — `sed -n '209,219p' … \| grep -c "return ()"` = 0 |
| `window.map` / `window.__MAP_INSTANCE__` | map init | 58 / 14 occurrences | two names for one map handle |

Readers of `window.isScrubbingTimeline` (24 files):
`MapWeatherControls.js`, `marineController.js`, `marineControllerPressure.js`, `marineGlobalPrewarm.js`,
`useLayerTruthDiff.js`, `useMapObservability.js`, `useMarineDataFetcher.js`, `useMarineDataFetcherCore.js`,
`useMarineDataFetcherHelpers.js`, `useMarineOrchestrator.js`, `useMarineOrchestratorScrubCache.js`,
`useMarineScrubSettle.js`, `useOpenMeteoTileUrls.js`, `useTemporalPreloader.js`, `useWebGLGuardrail.js`,
`WeatherEngine.js`, `WebGLMarineCustomLayer.js`, `WebGLMarineLayer.js`, `WebGLWindLayer.js`,
`windController.js`, `RenderPlanDispatcher.js`, `useRenderPlanBridge.js`, `useSimulationField.js`,
`useOpenMeteoForecast.js`.

**The strand path, verified line-by-line:**
- `MapWeatherControls.js:317-326` — the only unmount cleanup — cancels `requestRef.current` and
  `trailingTimeoutRef.current`. It does **not** reset `window.isScrubbingTimeline`.
- `ForecastWheel.js:321` — the only cleanup in the wheel — `if (ro) ro.disconnect(); if (s.raf)
  cancelAnimationFrame(s.raf);`. It does **not** call `onScrubEnd`. So an unmount during a drag or a
  coast leaves the flag `true` and never stamps `lastScrubTime`.
- The wheel unmounts on a routine action: `MapWeatherControls.js:476` `if (!activeLayer) return null` —
  toggling the layer off mid-gesture removes it.
- There is a `mouseup`/`touchend` window backstop at `MapWeatherControls.js:437-453`, but it calls
  `handleDragEndRef.current()` which is *classic-slider* drag-end; it does not cover the wheel, and the
  listener is itself removed by the same unmount.
- `useWebGLGuardrail.js:87-90` reads `window.isScrubbingTimeline === true || (window.lastScrubTime &&
  Date.now() - window.lastScrubTime < 5000)`. The `||` means the 5-second decay **cannot heal a stuck
  `true`** — the guardrail is then permanently bypassed for the tab.

`git grep` for any watchdog resetting the flag on a timer: none (positive control: watchdog timers *are*
findable in the same tree — `__RAW_MARINE_STRAND_WATCHDOG_MS__`, `marineController` healers).

---

## §4 — TIMERS, RAF AND WORKER LIFECYCLE

### 4.1 RAF create-vs-cancel per file (`frontend/src/components/map`, `engine`, `hooks`, non-test)

```
4 raf / 7 cancel  OceanMask.js
4 raf / 4 cancel  ForecastWheel.js
4 raf / 1 cancel  CanvasAnimationCoordinator.js
3 raf / 1 cancel  engine/render-orchestrator.js
3 raf / 0 cancel  useRasterTransactions.js      <- one-shot, stale-token guarded (:127-131). NOT a leak.
2 raf / 2 cancel  useOpenMeteoTileUrls.js
2 raf / 2 cancel  MapWebGL.js
2 raf / 0 cancel  scrubPerfProbe.js
2 raf / 0 cancel  WeatherTelemetry.js           <- WS-CAN-0022, already tracked
1 raf / 3 cancel  MapWeatherControls.js
1 raf / 0 cancel  useModelTransition.js / useMarineDataFetcher{Helpers,Core}.js / WindParticleOverlay.js
```

### 4.2 setInterval create-vs-clear

```
5 set / 5 clear  hooks/useWeatherState.js
2 set / 2 clear  useMarineScrubSettle.js, MapWebGL.js
2 set / 0 clear  weatherTruthTracker.js        <- NOT tracked anywhere
1 set / 1 clear  TruthOverlay.js, MarineAnimTuner.js, useMapInteractions.js, useMapData.js …
1 set / 0 clear  forecastExactPoint.js
```

**`weatherTruthTracker.js` — the untracked module-singleton timer.**
`:369 let _absenceTimer = null` · `:389-391` creates `setInterval(() => _sweepAbsentChains(Date.now()),
10000)` on the first arming stage · **zero `clearInterval` in the file** (positive control: the same
grep finds `clearInterval` at `useMarineScrubSettle.js:543`). `recordTruthStage` is imported by ≥10
production modules, so the timer arms on first weather activity and runs for the life of the tab.

**And its terminal has one call site.** `git grep -n "cancelTruthChains" -- frontend/src` returns
exactly two lines outside tests: the definition (`weatherTruthTracker.js:423`) and **one** caller
(`useWebGLGuardrail.js:161`). `resetTruthTracker` — which does `_pendingChains.clear()` at
`weatherTruthTracker.js:99` — is called only from `useMarineOrchestrator.js:496` (model switch) and
`:604` (layer switch). **Neither is wired to unmount / route change.** Consequence: navigating off
`/map` with a chain between an arming stage and a terminal stage leaves it pending; ≥30 s later
`_sweepAbsentChains` emits `ABSENT: … died after <stage>` into `console.warn`,
`__WEATHER_TRUTH_TRACE__.verdict.failReasons` and the `__WEATHER_TRUTH_ABSENT__` ring. The file's own
comment at `:419-421` records that this exact false death *"polluted verdict.failReasons and misdirected
live forensics (observed in the 2026-08-09 Codex episode)"* — the cancel terminal was built for the
guardrail transition and never extended to the unmount transition.

### 4.3 Worker state

`useGridWorker.js` — `onerror = onmessageerror` at `:42`, re-create on next use at `:68` (WS-CAN-0008,
tracked). Nothing new found.

---

## §5 — `visibilitychange`, focus/blur, resize, remount

### 5.1 visibilitychange — the whole-app census

`git grep -n "visibilitychange\|document.hidden\|visibilityState" -- frontend/src` (non-test), 10 hits:

| File | What it does |
|---|---|
| `useWebGLGuardrail.js:45` | early-returns from `onRender` when `document.hidden \|\| !document.hasFocus()` |
| `useWebGLGuardrail.js:186,202` | add/remove `visibilitychange` → `handleReset`, which only zeroes `frameCount / lastTime / lastFrameTime / lowFpsCount` |
| `useWebGLGuardrail.js:189-190,205-206` | same for `window` `focus`/`blur` |
| `Feed.js:176-193`, `Bookings.js:184`, `OnDemandSessionManager.js:190`, `useActiveSession.js:77`, `useSessionChatSync.js:73` | **social features, not weather** |

⇒ **In the entire weather/map subsystem, `visibilitychange` is handled in exactly one file, and that
handler resets FPS counters only.** Nothing revalidates data, pauses a poll, or re-fetches on return to
foreground. `pagehide` / `freeze` / `resume`: `git grep "'pagehide'\|'freeze'"` → 0 in the weather stack
(positive control: `'focus'`/`'blur'` *are* found, at `useWebGLGuardrail.js:189-190`).

The polls that keep running while hidden, all in `useWeatherState.js`: RainViewer catalogue refresh
`setInterval(loadCatalog, 5*60*1000)` `:81`; radar-region poll `setInterval(tick, 2000)` `:103`; HRRR
run refresh `setInterval(refreshRun, HRRR_RUN_TTL_MS)` `:128`; radar frame animation `setInterval(…,800)`
`:184`; forecast time-step animation `setInterval(…, 800|4000)` `:203`, which advances
`timeOffsetHours` and therefore drives real network fetches.

### 5.2 resize

| Site | Handling |
|---|---|
| `useMarineOrchestrator.js:367,391` | `mapInstance.on/off('resize', onMoveEnd)` — bound and unbound |
| `useMapInitialization.js:50-82` | DPR sync via `matchMedia('(resolution: …dppx)')` re-arm + `map.on('resize')`, torn down on `map.once('remove')`. Kill: `__RAW_DISABLE_DPR_SYNC__` |
| `ForecastWheel.js:302-322` | `ResizeObserver` on the box, `ro.disconnect()` on cleanup |
| `GPUMarineLayer.js:549,556`, `WindParticleOverlay.js:490,496` | `window.addEventListener('resize')` + matching remove |

No resize gap found. `prefers-reduced-motion` is sampled **once and cached** in `WebGLMarineEngine.js:2163`
and `WebGLWindEngine.js:535` (both with an in-file comment saying OS-level changes need a reload) and
re-read per render in `ForecastWheel.js:155` — an inconsistency, but WS-CAN-0012 already owns the
reduced-motion port.

### 5.3 remount

`WS-CAN-0001` seams verified present at HEAD by grep (`WebGLMarineEngine.js:3199-3200` identity-guarded
null; `useMarineScrubSettle.js:91` `webglMarineFailed` gate; `weatherTruthTracker.js:428`
`chainCancelled`). Not re-measured here. What is **new** is §3 and §4.2: the `window` mirrors and the
absence timer are exactly the state that *does* outlive a remount.

---

## §6 — "ACTIVE MODEL": who owns it (five channels)

1. **React state** — `useWeatherState.js:16-22` `useState` seeded from localStorage; the only
   `setActiveModel`. Tier-validated at `:35-42` against `getAllowedModels(user)`.
2. **localStorage `rawsurf-active-model`** — written by `useWeatherState.js:26`; read directly by six
   other surfaces (§2) with no subscription.
3. **URL param** — `SpotHub.js:114` `searchParams.get('model') || localStorage… || 'GFS'`.
4. **`window.activeModel`** — `useMarineOrchestrator.js:120`, no cleanup; consumed as a live-target
   guard at `RenderPlanDispatcher.js:481`.
5. **`window.__ACTIVE_MODEL__`** — read at `WebGLWindUtils.js:188`, **never written** (§1.3): dead.

Entitlement layer: `LayerAccessResolver.js` is declared *"the ONLY system allowed to decide what users
can access"*. It runs a **module-import-time** `fetch('/api/weather/capabilities')` (`:41`), writes
`window.__WEATHER_CAPABILITIES__` (`:47`) and dispatches a `weatherCapabilitiesLoaded` CustomEvent
(`:48`) which `useWeatherState.js:154-162` listens for. There is **no retry and no refresh** — on a
failed capabilities fetch the app silently keeps the full static `TIER_ACCESS` table. `getUserTier`
honours `window.__FORCE_PREMIUM_TIER__` (`:60`), an un-namespaced entitlement override my `__RAW_`
census does not see.

---

## §7 — FORECAST-HOUR / BASE-TIME DERIVATION (the "hour-0 has three owners" claim, verified at HEAD)

12.1 (`STATE_OF_THE_ART_TARGET_CONTRACT.md` A9, `CURRENT_ARCHITECTURE_CONVERGENCE_MAP.md:44`) records
*hour zero — Accidental Duplicate (3 owners)*. Audit 11.0 R11-12 names them: two backend floors
(`grid_series_helper.py:322`, `spot_ratings.py:573`) + the frontend round (`getSharedValidTime`), with
the label (`MapWeatherControls.js:327-331`) as the fourth concern. **Verified still true at HEAD**, and
the *frontend* denominator is larger than the register records:

| # | Site | Convention |
|---|---|---|
| a | `backendWeatherServiceClient.js:189-194` `getSharedValidTime` | `Math.round(baseTime/3600000)` → **round to nearest hour**, then snap to the products manifest within ≤3 h (`:228`). Base is `window.__MOCK_DATE_NOW__ \|\| Date.now()`. |
| b | `MapWeatherControls.js:328-340` `formatTime()` | `sliderVal === 0 → 'Live'`; otherwise `new Date()` + sliderVal hours, **raw client clock**, never the served frame |
| c | `ForecastWheel.js:132-136` `wheelValueText` (`hour === 0 → 'Now'`) and `:181-182` day labels (`new Date()` + h) | raw client clock — **and this is the DEFAULT scrubber**: `ForecastWheel.js:102-105 shouldUseClassicScrubber` returns true only when `__RAW_CLASSIC_SCRUBBER__ === true`, and `MapWeatherControls.js:472` sets `useWheel = !shouldUseClassicScrubber(...)` |
| d | `MapForecastOverlay.js:129` `isLive = timeOffsetHours === 0` (and `:574`) | offset-equality, no frame read |
| e | `LayerRegistry.js:367-374` `getAlignedReferenceTime()` | `Date.now() - 12 h`, then `Math.floor(h/6)*6` UTC — **floor to a 6-hour cycle**, evaluated **once at module import** (`const referenceTime = …`) and frozen into all seven `MODEL_METADATA_CACHE` entries at `:411-417` |
| f | `radarForecastSources.js:87` | `Math.floor(nowMs/3600000)` — **floor to hour** |
| g | `useOpenMeteoTileUrls.js:391` and `:589-590` | `Date.now() + offset*3600000` then `closestAxisIndex` — nearest-neighbour on the axis, **saturating** past its end |

Three different snapping conventions (round-to-hour, floor-to-hour, floor-to-6 h-minus-12 h) plus a
nearest-neighbour selector, in one frontend. WS-CAN-0016's `Current Files / Symbols` field names
`getSharedValidTime` and `MapWeatherControls.js:327-331` — i.e. (a) and (b). It does **not** name (c),
which is the shipped default, nor (e).

### 7.1 Stale-hour disclosure is asymmetric between the two lanes

- **Raster lane — DISCLOSED.** `modelHorizons.js:72 isBeyondAxis` → `modelProvenance.js:97-116
  describeStaleHour` → rendered at `MapForecastOverlay.js:248` and `:753-761` as
  *"Showing +N h — the furthest this model carries (you asked for +M h)"*. Words, not colour alone.
  It **refuses** when the model's axis has not been live-fetched (`:100-101`), which is correct.
- **Marine lane (the default, WebGL) — NOT DISCLOSED.** `marineController.js:413-414` stamps
  `__staleHour: true` + `__originalHour` on a nearest-hour cache hit; `:438` does the same for the
  last-known-good path. Several consumers *reject* it (`useMarineOrchestrator.js:543,642`,
  `useMarineOrchestratorScrubCache.js:81,155`), but the **429-cooldown commit does not**:
  `useMarineDataFetcherHelpers.js:320` gates only on `cachedData?.grid?.vectors?.length > 0 &&
  warmCovers`, and its own comment at `:290` says *"covering grids reuse as before, incl. `__staleHour`"*.
  **Absence claim, with positive control:** `git grep -n "__staleHour\|__originalHour" --
  MapForecastOverlay.js TruthOverlay*.js MapWeatherControls.js forecastDiagnostics.js
  weatherTruthTracker.js` → **0 hits**; the same command over the same file set finds
  `isEstimated` at `TruthOverlay.js:238`. It reaches no `window.__*` diag ring either.
  `TruthOverlay`'s seven provenance classes (`:274-286`, WS-CAN-0034, closed) key on
  `gridVectorCount / productId / isEstimated / isSubstituted / resolutionDeg` — **none is `hourOffset`**.

---

## §8 — THE MODEL TIME AXIS IS LATCHED FOR THE LIFE OF THE TAB

`mapUtils.js:342-386 fetchModelMetadata`:

- `:343 export var LIVE_FETCHED_MODELS = new Set()`
- `:347 if (!LIVE_FETCHED_MODELS.has(modelToCheck) && !MODEL_METADATA_PROMISES[modelToCheck])` — the only
  entry gate
- `:370 LIVE_FETCHED_MODELS.add(modelToCheck)` — on first success
- **Absence claim:** `git grep -nE "LIVE_FETCHED_MODELS\.(delete|clear)" -- frontend/src` → **0**
  (positive control: `\.delete\(` *is* found by the same regex at `marineInFlightRegistry.js:196,210,236`).
  There is no TTL, no cycle-boundary check, and — per §5.1 — no `visibilitychange`/`focus` revalidation
  anywhere in the weather stack.

⇒ Once a model's `latest.json` is fetched, its `validTimes` axis is frozen until reload. Open-Meteo
rotates that document every model cycle. Consumers that snap against it: `useOpenMeteoTileUrls.js:391,
483, 590`, `backendPrecipitationServiceClient.js:82-95`, `forecastHelpers.js:87-99`,
`useTemporalPreloader.js:116`.

Compounding: if `latest.json` **fails**, `:377-380` returns the cached bootstrap and does **not** add to
`LIVE_FETCHED_MODELS` — so `describeStaleHour` (`modelProvenance.js:100`) and `effectiveCutoverH`
(`modelHorizons.js:109`) both **refuse**, by design (*"a bootstrap placeholder axis must never be read
as proof that real data is missing"*). Correct in isolation; the gap is that **nothing counts or surfaces
"this model is still on a bootstrap axis"** — `git grep -n "LIVE_FETCHED_MODELS" --
TruthOverlay.js MapForecastOverlay.js forecastDiagnostics.js` → 0 hits. Both hour-truth instruments can
be silently disarmed while the tile lane keeps saturating.

---

## §9 — FULL SURFACE TABLE (state authorities in this area)

| Surface | Files / symbols | Reachability | Owner objective |
|---|---|---|---|
| activeModel React state | `useWeatherState.js:16-42` | Active-reachable | WS-OBJ-401 (no row) |
| activeLayers React state | `useWeatherState.js:44,216-221` (single-layer: `prev.includes ? [] : [layerId]`) | Active-reachable | — |
| timeOffsetHours React state | `useWeatherState.js:45,175-179` (clamped to `maxHoursForUser`) | Active-reachable | WS-CAN-0016 |
| isPlayingTimeline + two animation intervals | `useWeatherState.js:46,182-213` | Active-reachable | — |
| radar frame state (`radarPastFrames`, `radarFrameIndex`, `radarRegion`, `hrrrRunMs`) | `useWeatherState.js:51-148` | Active-reachable | — |
| tier/entitlement + capabilities | `LayerAccessResolver.js:30-53,59-177`; `window.__WEATHER_CAPABILITIES__`; `weatherCapabilitiesLoaded` event | Active-reachable, import-time side effect | WS-OBJ-401 (no row) |
| layer plugin registry | `LayerRegistry.js:233-343`, `__LAYER_REGISTRY_DIAG__` | Active-reachable | WS-CAN-0060 (colour-scale half, closed) |
| frozen model metadata axis | `LayerRegistry.js:367-417` + `mapUtils.js:342-386` | Active-reachable | **NONE** |
| scrub state (`isScrubbingTimeline`, `lastScrubTime`, `timeline_scrub_start/end`) | `MapWeatherControls.js:398-471`, `ForecastWheel.js` | Active-reachable | **NONE** |
| marine window mirrors | `useMarineOrchestrator.js:120-122` → `RenderPlanDispatcher.js:480-482` | Active-reachable | **NONE** |
| published React setters | `MapPage.js:209-218` | Dev/harness-reachable, always installed | **NONE** |
| WebGL failure latch | `MapWebGL.js:95-101,753-761` + `force_*_fallback` | Active-reachable, persisted | WS-CAN-0022 |
| truth-chain lifecycle | `weatherTruthTracker.js:369-455`, `useWebGLGuardrail.js:161`, `useMarineOrchestrator.js:496,604` | Active-reachable | WS-CAN-0001 (seam only) |
| FPS authorities | `WeatherTelemetry.js:380-400` (`gpuStats.fps`) and `useWebGLGuardrail.js:126` (`__MAP_RENDER_FPS__`, unread) | Active-reachable / write-only | WS-CAN-0063 (first only) |
| raster slot state + om:// URLs | `useOpenMeteoTileUrls.js`, `MapWebGL.js:823-920` | Active-reachable | WS-OBJ-101 |
| feature-flag surface (337 names) | 93 non-test files | mixed | **1 of 337 tracked** |

---

## §10 — WHAT I CHECKED AND FOUND ALREADY COVERED

- `WeatherTelemetry` RAF with no cancel — **WS-CAN-0022**, and LV-04 already confirmed it live.
- `force_wind_fallback` / `force_marine_fallback` persistence — **WS-CAN-0022** names it explicitly.
- `TruthOverlay.js:126 fps || 60` — **WS-CAN-0063**, closed `69ac3ddb`; at HEAD the site reads `?? null`.
- `getSharedValidTime` rounding vs the backend floor — **WS-CAN-0016**, open, correctly scoped.
- `__RAW_MARINE_ARBITER__` dark reducer — **WS-CAN-0043** + a proposed exit condition in
  `RELEASE_GATE_AND_DEPENDENCY_GRAPH.md:80-90`.
- settle-debounce shadow flag — **WS-CAN-0032**, explicitly "do not promote".
- ICON >168 h client blend — **WS-CAN-0007**; `backendWeatherServiceClient.js:272` unchanged at HEAD.
- raster stale-hour saturation — **DISCLOSED** end to end (`MapForecastOverlay.js:753-761`). I set out to
  report this and killed it. Only the *marine twin* survives (§7.1).
- `isBeyondAxis` built-but-unwired — **killed**: it is wired via `modelProvenance.js:105`.
- `useRasterTransactions` 3-RAF/0-cancel — **killed**: one-shot RAFs with a stale-token guard (`:127-131`).
- `prefers-reduced-motion` cached once in the engines — **WS-CAN-0012** owns the reduced-motion port.
- `useGridWorker` crash handling — **WS-CAN-0008**.
- resize / DPR handling — complete and torn down; no gap found.
