# 12.2 — OBSERVABILITY + INCIDENT READINESS (audit spec §20)

Independent source inventory. Branch `dev`, HEAD `791fdf78`, 2026-08-13. READ-ONLY pass; no
production source, test, config or lockfile was modified.

**Verdict on the KEY QUESTION — can a PRODUCTION user incident be diagnosed without the owner
running a browser console?**
`Partial`, and the partial half is **not the one the program registers describe**.

- The **first-party** answer is *no*. Exactly one first-party client→server transport exists
  (`TruthOverlay.js:147`), it fires only on `truthIssues` (map truth violations), it is throttled to
  1/60 s per `type:layerId`, its sink is an unrotated file on an ephemeral container disk, and every
  other client signal — uncaught exceptions, React crashes, worker crashes, GPU context loss,
  network failure, fallback activation, cache misses, flag state — terminates in a 500-entry
  in-browser ring or in `console`.
- The **third-party** answer is *partly yes, and it is undocumented*: **PostHog session replay is
  initialised in `frontend/public/index.html:210-227` and is ON in production** (recording is
  disabled only for localhost). It has been present since the initial commit and **is present in the
  pinned production build `3bd38a83`**. It appears in **zero** files under
  `audit/weather-simulation-12.0/` or `12.1/`.
- But PostHog is configured `captureCanvas: { recordCanvas: false }` — so the one production replay
  channel is **structurally blind to the WebGL map**, i.e. to the entire subject of this program.

---

## 0. Method, and the controls that make the absence claims usable

Every "there is no X" below was grepped and **paired with a positive control from the same
file/dir/instrument**. Commands are stated so counts are reproducible.

| # | Claim | Command | Result | Positive control (same instrument) |
|---|---|---|---|---|
| M1 | No error-reporting SDK is a dependency | `git grep -l -i sentry` | 3 hits, all prose/regex — `request_telemetry.py:4`, `zoomlab.js:402`, one audit doc; **0** in `package.json`/`requirements*.txt` | `git grep -n fastapi -- "*requirements*.txt"` → `requirements.txt:1 fastapi==0.110.1` |
| M2 | No other analytics/error SDK | `git grep -i "gtag\|mixpanel\|logrocket\|datadog\|bugsnag\|rollbar\|amplitude"` on `index.html` + `package.json` | 0 | `git grep -n session_recording -- frontend/public/index.html` → `:216,:217` |
| M3 | No log rotation in the backend | `git grep -i "RotatingFileHandler\|logrotate\|TimedRotating" -- backend/` | 0 | `git grep "logging.basicConfig\|dictConfig" -- backend/` → 10+ hits |
| M4 | No pager/notifier in any workflow | `grep -rn -iE "slack\|discord\|pagerduty\|webhook\|mailto\|create-issue\|peter-evans" .github/workflows/` | 1 hit, the word "slack" inside a CI comment at `ci.yml:918` | `grep -rln "schedule:" .github/workflows/` → 9 files; `grep -rn forecast_accuracy_monitor .github/workflows/` → hit |
| M5 | `uptime_probe.py` is scheduled nowhere | `grep -rn uptime_probe .github/ --include=*.yml` | 1 hit, a comment in `ci.yml:926` | as M4 |
| M6 | `SystemAlert` has no producer | `git grep -n "create_system_alert\|SystemAlert(" -- backend/` | definition at `system.py:553`, **0 call sites**; one constructor, inside that dead function | sibling model on the same import line: `git grep ScheduledJobStatus -- backend/` → real writers at `scheduler/base.py:34,37,76` |
| M7 | No flag registry / enumeration surface | `git grep -i "FLAG_REGISTRY\|listFlags\|allFlags\|flagState\|__RAW_FLAGS__" -- frontend/src` | 0 | `git grep -c LAYER_REGISTRY -- frontend/src/components/map/LayerRegistry.js` → 7 |
| M8 | PostHog is absent from the 12.x registers | `grep -ril posthog audit/weather-simulation-12.{0,1}/` | 0 | `grep -ril TruthOverlay audit/weather-simulation-12.1/` → 5 files |
| M9 | `diagnostics.log` is absent from the 12.x registers | `grep -ril "diagnostics.log" audit/weather-simulation-12.{0,1}/` | 0 | `grep -rl client-diagnostics audit/weather-simulation-12.1/` → the task register |
| M10 | Console-log capture not enabled client-side in PostHog | `git grep "enable_recording_console_log\|recordConsole" -- frontend/` | 0 | `git grep -n session_recording -- frontend/public/index.html` → `:217` |
| M11 | No backend request-id / correlation middleware | `git grep -i "X-Request-Id\|request_id\|correlation" -- backend/core backend/main.py` | 0 (`backend/main.py` does not exist; entry is `backend/server.py`) | `git grep -n add_middleware -- backend/server.py` → `:499 app.add_middleware(RequestTelemetryMiddleware)` |

Two counting scripts were used (written to the session scratchpad, **not** to the repo):

- `census.py` — walks `frontend/src`, regex `window\.(__[A-Za-z0-9_]+__)` for references and
  `window\.(__…__)\s*=[^=]` for assignments.
  **483 distinct `window.__X__` globals, 2258 references, 323 ever assigned in `src`, 160 never
  assigned** (144 of those 160 are `__RAW_*` / `*DISABLE*` / `*FORCE*` shaped, i.e. kill switches and
  tunables that only ever arrive from a console, a script, or localStorage).
- `prefixcov.py` — walks non-test `frontend/src` (832 files), regex
  `console\.(error|warn)\(\s*(['"\`])(\[[^'"\`\]]{1,60}\])`, and compares each captured prefix against
  the 21 prefixes hard-coded in `WeatherTelemetry.initConsoleInterceptors`.

**Instrument self-check (a blind spot I found and corrected mid-pass):** my first `__RAW_GPU__`
mutation regex `\bfield\s*(\+\+|--|\+=|-=|=[^=])` reported `frameTimeHistogram` as never mutated.
That was **my regex being wrong**, not the field being dead — the real mutations are *indexed*
(`frameTimeHistogram[0]++` … `[4]++` at `WebGLMarineEngine.js:2310-2314`). Corrected by re-grepping
each candidate by bare name across the whole repo. The three fields reported dead below survived
that correction: their bare name has **two** occurrences repo-wide (the initialiser in `src` plus
the same line in the built bundle) and **no** consumer in `src` at all.

---

## 1. The §20 checklist — what the RUNNING system can expose, and to whom

`dev-console` = only by typing into a browser console. `dev-HUD` = the gated diagnostics panel.
`server` = readable off-box without a browser. `nobody` = terminates in memory or a suppressed handler.

| # | Item | Exposed? | To whom | Where |
|---|---|---|---|---|
| 1 | active model | yes | dev-HUD + **server** (on truth violation only) | `TruthOverlay.js:428`; POST field `model` `:123` → `weather.py:722` |
| 2 | model init time (`run_time`) | yes | server | `grid_series_helper.py:58-63`; **A2 FAILS** — four tiles share one wall clock (LV-05) |
| 3 | forecast hour | yes | dev-HUD + server | POST `timeOffset` `TruthOverlay.js:125`; `served_valid_time` on responses |
| 4 | active layer | partial | dev-HUD + server | POST sends `activeLayers?.[0]` only (`:124`) — a multi-layer session is reported as one layer |
| 5 | data source / provider | dev only | dev-HUD | `TruthOverlay.js:306` `displayProvider`, `:305` `gridSourceDataset`; **not in the POST payload** |
| 6 | cache hit / miss | dev only, **1 cache of ~11** | dev-console ring | `trackCacheHit/Miss` called only from `openMeteoProtocol.js:452,467` for `MODEL_METADATA_CACHE`; `_tileCache`, `_seriesCache`, `_exactPointCache`, `clientGridCache`, `_maskCanvasCache`, `_landCache`, `_shelterCache`, `_geoCache`, `_dwdCache`, `_iconAnchorCache`, `DECODED_TILE_CACHE` emit nothing |
| 7 | cache age | server-side only | server | `/api/health/data` lane `age_h`; **client cache age is exposed nowhere** |
| 8 | SW asset version | yes | dev-console + server | `service-worker.js:3`; `buildVersion.js`; stamped by `frontend/update-sw-version.js:11,18,31`; rides the POST at `TruthOverlay.js:143` |
| 9 | request generation id | no | nobody | no `generationId`/`requestGeneration`/`seqRef` in `components/map` (grep 0) |
| 10 | stale-response rejection | partial | dev-console | `useExactPointFetch.js:108` emits status `exact_stale_rejected`, consumed by `MapForecastOverlay.js:147` for a spinner and `MapForecastOverlayDiag.js:105` for a `console.log`. **No counter, no telemetry event, no uplink** |
| 11 | active workers | no | nobody | `useGridWorker.js` holds a module-level `_workerInstance`; nothing publishes it |
| 12 | active RAF owners | **fabricated** | dev-console | `__RAW_GPU__.activeRafCount` — see §3, it is a literal |
| 13 | active renderer | dev only | dev-console | `__CREST_DIAG__.rendererMode` (`WebGLMarineEngineDiagnostics.js:44`) |
| 14 | MapLibre layer list | dev only | dev-HUD | keypad combo `2-0-2` (`TruthOverlay.js:183-194`) + `archiveFailure` `mapStyleSnapshot` (`WeatherTelemetry.js:511-516`) |
| 15 | texture / buffer counts | dev only | dev-console + dev-HUD | `__RAW_GPU__.textureCount` / `framebufferCount` / `textureUploadCount` — **these are genuinely measured** (8/2/4 mutation sites) |
| 16 | memory growth | client dev-only; **server yes** | dev-HUD + server | `__RAW_GPU__.gpuMemoryEstimate`; server `health.py:127-145` `peak_rss_mb` from `ru_maxrss` + `limit_source` |
| 17 | network failures | dev only | dev-console ring | `tile_failed` (`WeatherTelemetry.js:366`); `[apiClient]` console.error at `lib/apiClient.js:93` is **not** intercepted |
| 18 | parse failures | dev only | dev-console ring | `texture_encoding_failed` (`:429`); worker parse rejection at `useGridWorker.js:44` logs `[GridWorker]`, **not** intercepted |
| 19 | normalization failures | no | nobody | `WeatherNormalizer` is the single authority (A4 MET) but emits no failure event; no `normalization_failed` type exists |
| 20 | GPU context loss | dev only | dev-console ring | `trackWebGLContextLost` called once, `MapWebGL.js:715`; the event never leaves the device |
| 21 | fallback activation | dev only | dev-console ring | `model_warning{warningType:'fallback_active'}` via console string match on `[Fallback]` (`WeatherTelemetry.js:175`) |
| 22 | data freshness | **yes** | server, public | `/api/health/data` → `data_health.compute_data_health`; 503 on critical. Client-side `freshness_sec` is a constant 1800 (WS-CAN-0029) |
| 23 | browser capability | no | nobody | `deviceTier.js:31` and `useAdaptivePerformance.js:25-35` *read* `hardwareConcurrency`/`deviceMemory` to make decisions; neither is ever reported |
| 24 | feature-flag state | **no** | nobody | 160 read-only `window.__X__` globals + 20 localStorage keys in `components/map` alone; no registry (M7) |

---

## 2. Full surface inventory

### 2.1 Client — first-party

| Surface | File / symbol | Reachability | Consumer | Notes |
|---|---|---|---|---|
| Diagnostics HUD render | `TruthOverlay.js:19-28,329-712` | **Flag-gated** — `isDiagHudEnabled`: `?diag=1` or `localStorage.__RAW_DIAG__='1'` anywhere, default ON on localhost/127.0.0.1/0.0.0.0, **OFF in production**, fails closed on storage error | human at the screen | Prod gate added 2026-07-19. Four tabs: Health / Events / Visual / GPU-FCE |
| Truth-violation uplink | `TruthOverlay.js:108-158`, fetch at `:147` | **Active-reachable in production** — the effect is deliberately above the render gate (`:325-327`) | `POST /api/weather/client-diagnostics` | The ONLY first-party client→server transport (re-verified at HEAD: the only `client-diagnostics` fetch in `frontend/src`). Throttle 60 s per `type:layerId` (`:117`). `fps: … ?? null` since WS-CAN-0063 |
| Telemetry ring | `WeatherTelemetry.js:10-549`, singleton at `:549-550` | **Active-reachable** — constructed at module import; `window.__WEATHER_TELEMETRY__` published unconditionally | `TruthOverlay` Events tab; `admin/advanced/WeatherDiagnostics.tsx` | 500-entry ring with proportional-fair eviction (`_evictOne` `:205`), monotonic per-type `counts`, `ringHealth()` saturation flag. Genuinely good design; **it never leaves the browser** |
| Console interceptors | `WeatherTelemetry.js:78-184` | **Active-reachable** — monkey-patches `console.warn/error/log` globally at module import | the ring | 21 hard-coded prefixes. See §4 |
| FPS RAF loop | `WeatherTelemetry.js:380-400` | **Active-reachable** — started in the constructor, i.e. on every screen | `gpuStats.fps` | `requestAnimationFrame` at `:397,:399`, **zero** `cancelAnimationFrame` in the file (WS-CAN-0022). `gpuStats.fps` is seeded to the literal `60` at `:42` and only becomes measured after the first 1-second window |
| GPU counters | `WebGLMarineEngine.js:101-114` + 20 extension sites | **Active-reachable** — `window.__RAW_GPU__` | dev-console; `TruthOverlayGpuTab` reads 5 of the fields | 8 of 11 fields measured; 3 are literals (§3) |
| Crest / direction diag | `WebGLMarineEngineDiagnostics.js:43-148` | **Active-reachable** — called from inside the per-frame render loop | dev-console (`__CREST_DIAG__`, `__MARINE_DIRECTION_DIAG__`) | Mostly a static description of the shader, not a measurement. Content-identity dedup at `:176-181` (a prior `Date.now()` key made this the ring's loudest writer) |
| Texture-upload trace | `WebGLMarineEngineDiagnostics.js:205-245` | Active-reachable | `trackTextureGeneration` → ring; `__MARINE_WAVES_SINGLE_SLICE_TRACE__` | Real measurements (cols/rows/nonzero/min/max/mean) |
| Pressure parity diag | `MapForecastOverlayDiag.js:9-141` | **Flag-gated** — only when `activeLayer==='pressure'` AND `getBackendPressureFlag()` | `console.log` + `window.__PRESSURE_PARITY_DIAG__` | Not gated on production |
| Forensic audit | `MapForecastOverlayDiag.js:186-224` | **Active-reachable in production** — fires whenever `isExactPointRequired && pointLat && pointLng` | `console.log` / `console.table` | Dev chrome that ships to prod. `:205-211` documents the "diagnostic keyed on a display string" class that blinded it once already |
| Map observability | `useMapObservability.js:21-144` | **Flag-gated** — info logs behind `window.__RAW_MAP_OBSERVABILITY_LOG__`; the clipping WARN and catch-all error are unconditional | console | Rate-limited to 1/1.5 s. Its own comment (`:35`) is the repo's only acknowledgement that PostHog rrweb serialises console lines |
| Build announce | `marineForensics.js:39,80-93` | Active-reachable | console `[BUILD]` + `__RAW_GPU__.build` | `[BUILD]` is **not** an intercepted prefix |
| Error boundaries | `routing/ErrorBoundary.js:29-57`, `map/MapErrorBoundary.js:18` | **Active-reachable in production** | `console.error('[ErrorBoundary] …')` | ChunkLoadError auto-reload once. **Nothing is reported anywhere**; `[ErrorBoundary]` is not an intercepted prefix |
| Global error handlers | `index.js:165-207` | **Active-reachable in production** | — | `window.onerror`, `error`, `unhandledrejection` are **pure suppressors** (ResizeObserver, AbortError/DOMException). No counter, no report, no uplink |
| Worker crash handler | `useGridWorker.js:41-53` | Active-reachable | `console.error('[GridWorker] …')` | R11-07 repair: rejects all pending, nulls the instance so the next call re-creates. **Recovery is instrumented; observability is not** — prefix not intercepted |
| Flag / kill-switch state | 483 `window.__X__`, 20 `localStorage` keys in `components/map` | Active-reachable | — | **No surface reports any of it** (M7) |

### 2.2 Client — third-party

| Surface | File / symbol | Reachability | Consumer | Notes |
|---|---|---|---|---|
| **PostHog session replay** | `frontend/public/index.html:149-227`, `posthog.init(...)` at `:210` | **Active-reachable in production.** `disable_session_recording: __isLocalDev` (`:216`) — off on localhost only. Present since the initial commit `b8aa692f`, and **present in the pinned prod build `3bd38a83`** (9 matches) | PostHog cloud (`us.i.posthog.com`) | `person_profiles:'identified_only'`; `recordCrossOriginIframes:true`; `capturePerformance:false`; **`captureCanvas.recordCanvas:false`** (`:222-224`). Absent from every 12.x register (M8) |

### 2.3 Backend

| Surface | File / symbol | Reachability | Consumer | Notes |
|---|---|---|---|---|
| Request telemetry | `services/request_telemetry.py:1-171`; wired `server.py:498-499` | **Active-reachable**, kill `REQUEST_TELEMETRY=0` | `/api/health.request_telemetry`, `/admin/system/api-metrics`, `/admin/system/health` | Bounded (≤200 route templates, log-scale buckets, counts only). Percentiles are bucket UPPER bounds and say so (`p50_ge_ms`, `over_10000ms`). Cumulative since `started_at`. Exemplary honesty |
| `/api/health` | `routes/health.py:71-287` | **Active-reachable, PUBLIC, unauthenticated** | uptime probe, keep-warm, humans | Embeds SHA (`RENDER_GIT_COMMIT`), python major.minor, `deps_digest`, cgroup-measured memory limit + `limit_source`, peak RSS, scheduler job list, table row counts, `request_telemetry` |
| `/api/health/simple` | `routes/health.py:290-296` | Active-reachable, public | load balancers | |
| `/api/health/data` | `routes/health.py:299-317` | Active-reachable, public | `data-health-monitor.yml`, `WeatherDiagnostics.tsx` | Computes lane freshness ON READ from the served manifest → catches a dead cron even when the cron never publishes. 503 on critical. The single strongest server observability surface |
| `/api/weather/status` | `routes/weather.py:650-700` | Active-reachable | — | Repaired by WS-CAN-0010: `provider_status: not_instrumented`, `stale_products_count: None`, `last_errors: None`, plus a `note` pointing at the measured surfaces |
| `POST /api/weather/client-diagnostics` | `routes/weather.py:715-756`; schema `schemas.py:328-337` | **Active-reachable, UNAUTHENTICATED, un-rate-limited** (only two `Depends` in the whole file, neither a limiter; `core/rate_limiter.py` exists but is not applied here) | `logger.error/warning` (stdout) + append to `backend/diagnostics.log` | `fps` prints `unmeasured` for None and preserves a measured 0 (WS-CAN-0063 server half). See §5 for the sink |
| `GET /api/weather/diagnostics-log` | `routes/weather.py:758-775` | Admin-gated (`get_current_admin`); test at `test_weather_pipeline_auth.py:24` | admin | Reads the **entire** file into memory, no cap, no tail, no paging. **No frontend consumer** (grep 0; positive control `/health/data` has one) |
| `/admin/system/health` | `routes/admin/system.py:165-300` | Admin-gated | `AdminSystemDashboard.js:47` | `measured_error_rate_percent()` (`:143-162`) returns None → `status:"not_instrumented"` (WS-CAN-0010 closure). cgroup memory limit measured, clamp deliberately removed |
| `/admin/system/api-metrics` | `routes/admin/system.py:502-549` | Admin-gated | — | Reads `request_telemetry`; refuses with `not_instrumented` when n=0. Echoes `hours` but states `requested_hours_ignored: true` |
| `/admin/system/alerts` (+ acknowledge/resolve) | `routes/admin/system.py:426-498`; producer `create_system_alert` `:553` | Admin-gated; **producer has ZERO callers** (M6) | `AdminSystemDashboard.js:61,82,94` | Permanently empty. `unacknowledged_alerts` on `/admin/system/health` is structurally always 0 |
| `/admin/system/jobs` | `routes/admin/system.py:332-398` | Admin-gated | `AdminSystemDashboard.js:54` | Genuinely written — `scheduler/base.py:31-76` records real run status/duration/errors |
| `/admin/system/storage` | `routes/admin/system.py:304-328` | Admin-gated | — | |

### 2.4 Admin UI

| Surface | File | Reachability | Notes |
|---|---|---|---|
| `WeatherDiagnostics` | `admin/advanced/WeatherDiagnostics.tsx:12-…`, routed `admin/AdminApp.tsx:25,173` | Admin-gated | **This is the crux.** It polls `WeatherTelemetry.getDiagnosticReport()` at 1 Hz — the **admin's own browser singleton**. It looks like a fleet console; it is a self-portrait. It shows nothing about any other user's session. Its one genuinely server-sourced panel is `/health/data` (`:27`) |
| `AdminSystemDashboard` | `components/admin/AdminSystemDashboard.js:47-94` | Admin-gated | Server-sourced. Health + jobs are real; alerts are structurally empty |

### 2.5 Out-of-band monitors

| Surface | File | Reachability | Pages? |
|---|---|---|---|
| Uptime probe | `backend/scripts/uptime_probe.py` (231 LOC, stdlib only) | **Implemented but Inactive** — scheduled nowhere (M5) | designed to, via `--ping-url` dead-man's switch; **not wired** |
| Data Health Monitor | `.github/workflows/data-health-monitor.yml` | Active, `*/30 * * * *` | red run on `critical`, on any lane older than `HEALTH_PAGE_HOURS` (7 h), and on the regional run-age census |
| Forecast Accuracy Monitor | `.github/workflows/forecast-accuracy-monitor.yml` | Active, `5 1,7,13,19 * * *` | red run on MAE > 0.40 m, report age > 8 h, ledger death, retention stall, and (WS-CAN-0026) losing to persistence on **both** MAE and win rate. Self-expiring grace `ACCURACY_PAIRED_GRACE=2026-08-22` |
| Sim Parity Monitor | `.github/workflows/sim-parity-monitor.yml` | Active, `20 5,11,17,23 * * *` | red run on data-level composition divergence |
| **Notification channel for all of the above** | — | **none exists** (M4) | GitHub's default run-failure email only |

---

## 3. `__RAW_GPU__` — three fields are literals, and the audit program has been quoting them

Field-by-field mutation census over 1213 `frontend` JS/TS files (`src` **and** the committed
`build/` bundle), by bare name:

| Field | init | mutation sites | verdict |
|---|---|---|---|
| `textureCount` | `:103` | 8 (`WebGLMarineTextureEncoder.js:661,731`, `WebGLMarineTextureState.js:78`, `WebGLWindUtils.js:290`, +bundle) | **measured** |
| `textureUploadCount` | `:104` | 4 (`WebGLMarineTextureState.js:56,79`) | **measured** |
| `framebufferCount` | `:105` | 2 (`WebGLMarineEngineInit.js:183`) | **measured** |
| `activeRafCount` | `:106` = `1` | **0** | **LITERAL** |
| `drawCallsPerFrame` | `:107` | 10 (`WebGLMarineEngine.js:473`, +) | **measured** |
| `gpuMemoryEstimate` | `:108` | 8 | **measured** |
| `shaderCompileCount` | `:109` = `6` | **0** | **LITERAL** |
| `frameTimeHistogram` | `:110` | 5 indexed (`WebGLMarineEngine.js:2310-2314`) | **measured** (my first regex missed this — see §0) |
| `droppedFrameCounter` | `:111` | 2 (`:2317`) | **measured** |
| `reactRerenderCounter` | `:112` = `0` | **0** | **LITERAL** |
| `advFboStatus` | runtime | 2 (`:2252`) | **measured** |

8 of 11 measured is the positive control: the technique detects mutation reliably, including on
sibling fields inside the same object literal in the same file.

**Why this is not cosmetic — these three literals have been used as evidence:**

- `audit/weather-simulation-12.1/CURRENT_CANONICAL_TASK_REGISTER_12.1.csv` (WS-CAN-0022 note):
  *"FIRST LIVE RUNTIME CONFIRMATION 12.1 (LV-04): `__RAW_GPU__.activeRafCount = 1` with
  `activeLayers = []` … Previously grep-only."* — the "upgrade from grep-only to runtime-confirmed"
  read a constant.
- `audit/weather-simulation-12.1/PROGRAM_OBJECTIVE_REGISTER.csv` WS-OBJ-301 **Required Closure
  Evidence = "activeRafCount 0 with no weather layer active"** — a closure criterion **no code path
  can ever satisfy**, because no code path writes the field.
- `docs/research/FINDING-2026-08-03-product-thrash-at-a-fixed-viewport.md:154` —
  *"★ `reactRerenderCounter: 0` kills the React avenue outright."* Repeated at `:199` and in three
  handoffs. A hypothesis was refuted by a constant.
- `docs/research/AUDIT-2026-08-02-v6-the-latency-audit-and-the-one-root.md:274` — Hypothesis 5 marked
  **DEAD** because *"`shaderCompileCount` was 6 before any gesture and 6 after nine gestures"*.
- Audit 11.1 came closest (`TEST_LADDER_REGRESSION_RESULTS.csv:25`: *"activeRafCount is the engine's
  own counter and does not enumerate MapLibre's or WeatherTelemetry's loops"*, graded
  **Inconclusive**) — but nobody established that it is a **constant**, and 12.1 then upgraded it to
  "runtime-confirmed". That is a regression in rigour.

This is the WS-CAN-0010 / WS-CAN-0063 shape (a constant served as a measurement) with the worst
possible consumer: **the measuring lane itself**.

---

## 4. The telemetry ring is fed by console string-matching, and it misses 55% of error emitters

`WeatherTelemetry.initConsoleInterceptors` (`:81-103`) matches on 21 hard-coded bracket prefixes.

**Coverage measured** (`prefixcov.py`, 832 non-test source files, `console.error|warn` whose first
argument is a string literal beginning with `[`):

- 232 such call sites, 84 distinct prefixes.
- **104 sites / 24 prefixes are captured** (positive control — the matcher works).
- **128 sites / 60 prefixes are NOT captured (55.2%).**

Uncaptured emitters that matter for incident readiness:

| Prefix | sites | first site | why it matters |
|---|---|---|---|
| `[Marine]` | 14 | `GPUMarineLayer.js:290` | the marine layer itself |
| `[Governor]` | 10 | `marineRequestGovernor.js:198` | request governor / throttling |
| `[ExactPoint Forensic]` | 6 | `forecastExactPoint.js:448` | infobox truth |
| `[CACHE]` | 3 | `openMeteoProtocol.js:937` | cache faults |
| `[WEATHER_TRUTH]` | 3 | `weatherTruthTracker.js:229` | **the truth tracker that feeds the only uplink** |
| `[GridWorker]` | 2 | `useGridWorker.js:44` | **the R11-07 worker crash** |
| `[ErrorBoundary]` | 2 | `routing/ErrorBoundary.js:30` | **every React crash** |
| `[apiClient]` | 2 | `lib/apiClient.js:93` | **every API failure** |
| `[ABORT RECOVERY]` | 2 | `useMarineDataFetcherCore.js:683` | fetch aborts |
| `[Raster TX]` | 2 | `useRasterTransactions.js:91` | raster transactions |
| `[MapLibre Error]` | 1 | `useMapInitialization.js:90` | map engine errors |
| `[Orchestrator Fatal Exception]` | 1 | `useMarineDataFetcherCore.js:654` | named "Fatal" |
| `[BUILD]` | 1 | `marineForensics.js:93` | stale-bundle self-check |

**And two of the 21 configured prefixes have zero emitters anywhere in `frontend/src`:**
`[WebGLOverlay]` and `[WebGLMarine-Validate]`. The second is load-bearing — `WeatherTelemetry.js:155-160`
carries a dedicated branch emitting `model_warning{warningType:'validation_mismatch'}` on that string.
**That event type can never be produced.** (Positive control: `[WebGLMarine` matches 7 files, so the
substring search itself works.)

This is the class the repo has already documented at `MapForecastOverlayDiag.js:205-211` —
*"A DIAGNOSTIC KEYED ON A DISPLAY STRING BREAKS SILENTLY WHEN THE DISPLAY CHANGES"* — recurring,
uncaught, at the ingestion layer of the whole telemetry system. No register row names
`initConsoleInterceptors` (grep 0; positive control: `WeatherTelemetry` appears 3× in the 12.1 task
register).

---

## 5. The incident sink: `backend/diagnostics.log`

`routes/weather.py:740-748` appends every client diagnostic to
`backend/diagnostics.log`, and `:758-775` serves the whole file to an admin.

- **No rotation, no truncation, no size cap** anywhere in the backend (M3).
- **No disk mount** in `render.yaml` (`grep -i "disk\|mountPath"` → 0; the file exists, 2788 bytes).
  Render's filesystem is ephemeral without one ⇒ **every deploy wipes the incident history**, and
  per the project's own operating note *every push to `dev` is a production backend deploy*.
- The **write** route is unauthenticated and un-rate-limited; fields are interpolated straight into a
  single log line, so a newline in `event_type`/`correlationId`/`details` forges log records.
- The **read** route loads the entire file into memory in one `f.read()`.
- No frontend consumer (M9 control), and the file is named in **zero** 12.x register rows (M9).

The parallel `logger.error/warning` call goes to stdout → Render's log stream, whose retention is a
platform setting outside this repo.

---

## 6. What is genuinely strong (so the gap list is read in proportion)

1. `request_telemetry.py` — bounded cardinality, honest percentiles, `pNN_ge_ms` overflow markers, a
   `note` that tells the reader what the number is *not*. Best instrument in the repo.
2. `/api/health/data` — freshness computed ON READ from the served manifest, so it catches a dead
   cron without depending on the cron.
3. `uptime_probe.py` — grades the **body** not the status code, three-way OK/RED/REFUSED, timeouts
   derived from measured p99, and it found a defect in itself (`urlopen` raising on 4xx/5xx made the
   RED path unreachable while its positive-control test stayed green).
4. The measure-or-refuse repairs already landed: `weather.py` status, `system.py` api-metrics,
   `system.py` health error rate, `TruthOverlay` fps + its server twin.
5. `WeatherTelemetry._evictOne` proportional-fair eviction + `ringHealth()` saturation flag — a ring
   that says when its own sample is a sample.
6. `useGridWorker` R11-07 crash recovery.
7. `data-health-monitor.yml`'s `HEALTH_PAGE_HOURS` deaf-spot fix and the regional run-age census.

---

## 7. Gap ledger (see the structured return for dispositions)

| ID | One line | Survives kill? |
|---|---|---|
| G-OBS-01 | PostHog session replay is a live, undocumented second production transport, **blind to the map canvas** | yes — WS-CAN-0020's stated premise ("the only client-to-server transport") is false at HEAD; PostHog absent from all 12.x registers |
| G-OBS-02 | `activeRafCount` / `shaderCompileCount` / `reactRerenderCounter` are literals quoted as measurements, and WS-OBJ-301's closure criterion is unreachable | yes — WS-CAN-0010 (backend, closed), WS-CAN-0063 (different field, closed), B6's census (2 named sites, both closed) all exclude these |
| G-OBS-03 | Telemetry ingestion is console string-matching: 55% of error emitters uncaptured; 2 of 21 prefixes dead, one with a dedicated dead branch | yes — WS-CAN-0020 is the transport, not the ingestion; no row names `initConsoleInterceptors` |
| G-OBS-04 | `SystemAlert` has one producer with zero callers ⇒ the alerts dashboard is structurally always empty | yes — same shape as R11-08's `SystemHealthMetric`, but that instance was named and closed; this one is in no register |
| G-OBS-05 | The incident sink is an unrotated, unauthenticated, un-rate-limited append to an ephemeral container file, read whole | yes — not named in any register |
| G-OBS-06 | Flag/kill-switch state is exposed on no surface (160 read-only globals, 20 persisted localStorage keys) | partial — WS-CAN-0022 covers *clearing* 2 of them; B5's enumeration omits flags entirely |
| G-OBS-07 | `WeatherDiagnostics` admin panel reads the **admin's own** browser singleton and presents it as a system console | yes — no register row states the scope limit |

Closed and correctly excluded from the above: WS-CAN-0060, WS-CAN-0061 (`f3fe2c85`), WS-CAN-0027
(`181b7ba7`), WS-CAN-0010 + WS-CAN-0063 (`69ac3ddb`, `172f66aa`), WS-CAN-0014 (`172f66aa`).
