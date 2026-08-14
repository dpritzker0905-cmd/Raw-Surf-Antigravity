# Audit 12.2 — Source Inventory: CROSS-FEATURE + SHARED-INFRASTRUCTURE DEPENDENCIES

**Area:** audit spec §24. Every dependency crossing the weather boundary, in BOTH directions.
**Repo:** `C:\Users\dprit\Raw-Surf`, branch `dev`, HEAD `791fdf78`. Read-only outside this file.
**Method:** inventory first, register-diff second. Every absence claim is paired with a positive
control run with the same technique on the same file/dir. Every count states the command.

---

## 0. HOW I COUNTED (method notes, reproducible)

| Question | Command | Result |
|---|---|---|
| Who touches the mandated chain? | `git grep -ln "resolve_surf_geometry\|estimate_surf_at\|compute_surf_rating" -- '*.py' '*.js'` | 74 files (14 audit scripts, 26 backend prod, 33 backend tests, 2 frontend, 1 script) |
| Non-map frontend importers of `components/map/*` | `grep -rn "from ['\"].*components/map/" --include=*.js . \| grep -v "^./components/map/"` | 15 import edges from 10 files |
| Frontend consumers of the forecast rating | `grep -rn "rating_level\|conditions\.rating" --include=*.js . \| grep -v "^./components/map/" \| grep -v test` | **0** |
| — positive control, same technique, sibling field | `grep -rn "forecast_confidence" --include=*.js .` | 5+ hits in `SpotConditions.js` (proves the technique finds a producer field that IS consumed) |
| "alert"/"notification" in the four program registers | `grep -o -i "alert" ...12.1/*.csv` / `grep -o -i "notif" ...12.1/*` | **1 alert** (WS-CAN-0025 "alerting", a monitoring word) · **0 notif** |
| — positive control, same files | `grep -c -i "rating"` on the task register | 8 |
| Size-ladder implementations | `git grep -n "Ankle High" -- '*.py' '*.js'` | 1 Python authority + **1 stale JS copy** + 4 JS colour maps + 8 test references |
| `?spot=` query-param readers | `grep -rn "useSearchParams\|location.search"` in `components/MapPage.js` and `components/map/` | **0** |
| — positive control, same technique, whole app | same grep over `src/` | ~20 files (Auth, Bookings, Credits, OnDemandTab, …) |
| `engine-brain` / `surf-intelligence` in registers | `grep -o -i "engine-brain\|surf-intelligence\|wave-scoring"` over 12.1 + 12.0 registers | **0** |
| — positive control, same files | `grep -o "WebGLMarineEngine"` | 2 |
| The alert-quality guard's file census | `~/AppData/Local/Python/bin/python3.exe` AST probe (§2.1) | 1 of 2 alert paths |

⚠️ **Windows tax paid up front:** PowerShell `Measure-Object -Line` undercounts; all counts here are
Git-Bash `grep`/`wc`. Python is `~/AppData/Local/Python/bin/python3.exe`, ASCII stdout only.

---

## 1. DIRECTION (b) — NON-WEATHER APP CODE THAT DEPENDS ON WEATHER

This is the higher-value direction and where every material finding landed.

### 1.1 The full consumer census of the mandated chain

`spot_conditions.resolve_spot_conditions_impl` (`backend/services/weather_pipeline/spot_conditions.py:195`)
is the ONE producer that runs the mandated chain for non-map surfaces. It is reached through
`PointResolutionService.resolve_spot_conditions` (`point_resolution.py:744`). Its **six** callers,
enumerated by `git grep -n "resolve_spot_conditions" -- 'backend/*'` minus tests:

| # | Caller | Line | Surface it feeds | Whitelisted? | Carries quality? |
|---|---|---|---|---|---|
| 1 | `routes/explore_discover/explore.py` | 109 | Explore spot list | **NO** — full dict returned | yes (unrendered) |
| 2 | `routes/explore_discover/spot_details.py` | 89 | **Spot Hub** (`SpotHub.js`) | **NO** — `current_conditions` passed through whole | yes (**never rendered**) |
| 3 | `routes/surf_data/alerts.py` | 322 | `POST /alerts/check` (manual) | n/a | **yes — reads `rating`/`rating_level`** |
| 4 | `routes/surf_data/conditions.py` | 78 | `GET /conditions/batch` → Explore cards | **YES, 6 keys (`:84-91`)** | **NO** |
| 5 | `routes/surf_data/conditions.py` | 120 | `GET /conditions/{spot_id}` → spot drawer | **YES, 8 keys + 1 optional (`:146-168`)** | **NO** |
| 6 | `scheduler/surf_alerts.py` | 64 | **the 15-min production alert job** | n/a | **NO — see §2.1** |

(`conditions.py:198` is a third call inside `/conditions/forecast/{spot_id}`; the AST census in
`backend/tests/test_spot_hub_local_size_reference.py:288` pins this exact caller set at 7 calls
across 5 modules and asserts every one passes `spot_id`. That guard covers the *local size
reference*, not the *rating*.)

### 1.2 What the producer attaches vs what reaches the wire — MEASURED

Base dict, `spot_conditions.py:361-373` — 9 keys:
`wave_height_ft` (BREAKING), `offshore_height_ft`, `surf_regime`, `wave_direction`, `wave_period`,
`swell_height_ft`, `swell_direction`, `label`, `updated_at`.

Conditionally attached (`grep -o 'current_conditions\["[a-z_]*"\]' … | sort -u | wc -l` → **8**):
`rating_raw`, `rating_confirmed`, **`rating`**, **`rating_level`** (`:436-439`),
`forecast_confidence` (`:458`), `directional_conflict` (`:474`), `wind_speed_kts` (`:479`),
`wind_direction`.

`GET /conditions/batch` whitelist (`conditions.py:84-91`, keys at `:85-90`) — **6 keys**:
`wave_height_ft`, `wave_direction`, `wave_period`, `swell_height_ft`, `label`, `updated_at`.
`GET /conditions/{spot_id}` `current` whitelist (`conditions.py:146-168`, keys at `:147-154`) —
**8 keys** + optional `forecast_confidence` (`:166-167`).

⇒ `rating`, `rating_level`, `rating_raw`, `rating_confirmed`, `offshore_height_ft`, `surf_regime`,
`wind_speed_kts`, `wind_direction`, `directional_conflict` are dropped by BOTH.

**The file already knows this class.** `conditions.py:156-166` carries a comment naming the
whitelist as "a second wire boundary with the same failure mode as an undeclared Pydantic field",
and `backend/tests/test_conditions_route_wire_contract.py` exists *only* because that whitelist
silently ate `forecast_confidence` (MASTER-AUDIT-10.0 §1.2: producer 9 keys, response 8). The repair
restored **one** key and never censused the other seven. `rating`/`rating_level` are written 14
lines earlier in the same producer than `forecast_confidence` is.

### 1.3 Frontend: the rating reaches nothing

`grep -rn "rating_level\|currentConditions\.rating\|conditions\.rating" --include=*.js src | grep -v "^src/components/map/" | grep -v test` → **zero hits.**
Broad control (`grep -rn "rating"` outside `components/map`, minus `migrat|integrat|generat|…`)
returns only: `engine/RenderPlanDispatcher.js` + `engine/SimulationField*.js` (the MAP's rating
band, reached from `MapWebGL.js:42`), `SpotUIComponents.js`/`SpotDrawerHelpers.js` (the
*photographer-entered* Spot-of-the-Day enum, §1.5), `useSpotHubActions.js:110` (a comment), and
`reportWebVitals.js` ("rating" the web-vitals field).

`SpotHub.js` (659 LOC) contains the string `rating` **zero** times, yet
`/explore/spot-details/{id}` hands it `current_conditions` **whole** — the quality arrives at the
Spot Hub and is discarded client-side.

⇒ **The only surfaces in the product that display a forecast quality are the map glyph/band and the
`/alerts/check` route body.** Everywhere else a blown-out 6 ft and a groomed 6 ft render
identically — the mandate's own words.

### 1.4 The size-label ladder: one authority, one stale mirror

`backend/services/conditions_labels.py` declares itself THE canonical vocabulary, and its docstring
records the 2026-07-26 correction: the old 8 ft / 10 ft edges for Overhead→Double→Triple were
"internally impossible" given Head High = 5–6 ft, and `report_calibration.py:37` had the right
anchors all along.

`frontend/src/components/SpotConditions.js:701-711` is a byte-level copy of the **pre-fix** ladder:

| ft | `conditions_labels.py` (authority) | `SpotConditions.js:701` (mirror) |
|---|---|---|
| 6 – 7.99 | Overhead | Overhead |
| **8 – 9.99** | **Overhead** | **Double Overhead** |
| **10 – 14.99** | **Double Overhead** | **Triple Overhead+** |
| 15 + | Triple Overhead+ | Triple Overhead+ |

Worse: the payload already carries the right answer. `conditions.py:89` (batch) and `:153`
(`{spot_id}`) both serialise `"label": current["label"]`, produced by the authority
`get_conditions_label` at `spot_conditions.py:371`. `SpotConditions.js:256` reads
`current.wave_height_ft` and **re-derives** the label, discarding `current.label`.

Reachable: `UnifiedSpotDrawer.js:24,588` → `spot-drawer/SpotReportContent.js:82` → `SpotConditions`.
Consequence: at 8 ft the Explore card (backend `label`, via `useExploreData.js:32`) says
**"Overhead"** and the spot drawer says **"Double Overhead"**, in the same app, for the same spot.

The backend module's own consumer census is also short: it names `SpotHubConditionsTab.js`'s colour
map as the one thing that must stay in sync. `git grep -n "Ankle High"` finds **four** JS colour
maps (`ExploreSpotCard.js:19`, `SpotConditions.js:52`, `SpotHub.js:45`,
`SpotHubConditionsTab.js:12`) and the JS ladder it never mentions.

### 1.5 A second, unrelated rating vocabulary (inventory, not a defect)

`SpotOfTheDay.rating` is a **photographer-entered** query param, validated against
`FLAT|POOR|FAIR|GOOD|GOOD_TO_EPIC|EPIC` (`routes/surf_spots/spot_of_day.py:122`). Colour-mapped by
`spot-drawer/SpotDrawerHelpers.js:30` and `spot-hub/SpotUIComponents.js:14` (byte-duplicated).
The forecast vocabulary is `very_poor|poor|poor_fair|fair|fair_good|good|epic`
(`surf_rating.py:34` ≡ `components/map/surfRating.js:11`, correctly mirrored).
No forecast value is ever fed into the uppercase switch — verified by reading both call sites
(`SpotDrawerHelpers.js:43`, `SpotUIComponents.js:27`): both take `spotOfTheDay.rating` only.
**Not a bypass.** Recorded so a future session does not re-open it. NOTE the latent hazard: both
switches `.toUpperCase()` and fall through to a default colour, so a forecast `fair_good` routed
here would degrade silently.

### 1.6 `/surf-conditions` — the "fourth forecast path", repaired for height, quality-free

`backend/routes/surf_spots/conditions.py:20` (registered at `routes/surf_spots/__init__.py:31`)
→ `services/surf_conditions.py`. Its `_breaking_ft` (`:61-95`) **does** call
`resolve_surf_geometry` + `estimate_surf_at`; the in-file comment names itself the FOURTH forecast
path and records the repair, mirroring `spot_conditions._breaking_ft` (`902f47a9`).
`grep -c "compute_surf_rating"` → **0** (positive control on the same file:
`grep -c "estimate_surf_at"` → 3; on `spot_conditions.py` → 2). So height is chain-derived, quality
absent. Consumers: `CreatePostModal.js:96` and `useCreatePostActions.js:182` — post-creation
auto-fill. This is a *session record*, not a forecast display, so the missing quality is a weaker
instance of §1.2 and is recorded rather than raised.

### 1.7 Non-weather modules with wave-height fields that are NOT forecast (cleared)

Verified by reading, all user-authored / DB columns, no chain involvement:
`models/posts.py:54`, `models/sessions.py:168`, `models/gamification.py:585`,
`routes/condition_reports/*` (crud/feed/admin/schemas), `routes/posts/*`,
`routes/content/meta_sharing.py:329,432`, `routes/social.py:159`,
`routes/explore_discover/explore.py:627` + `spot_details.py:111` (`r.wave_height` = `SurfReport`
column), `routes/surf_spots/spot_of_day.py` (`wave_height: Optional[str]` query param),
`backend/google_maps_mcp_server.py` (standalone MCP cache table).

### 1.8 Dead second scoring engine (`engine-brain/`)

`frontend/src/engine-brain/` contains a complete parallel surf-quality model:
`wave-scoring-engine.js` (`scoreSession` → `waveQuality`, `rideQualityIndex`, `overallScore`,
`grade`), `surf-break-model.js` (`computeBreakQuality`, `classifyBreak`, `classifyWindType`,
`findSurfWindow`, returning `'poor'|'ok'|'good'|'epic'` at `:70-73`), `wave-propagation-model.js`
(`computeWaveHeight`), `crowd-prediction-model.js`, `wave-height-ramp.js`, `turbulence-model.js`.

**Import-edge reachability (the only defensible test):**

| module | importers (excluding self) | verdict |
|---|---|---|
| `engine/sessions/surf-intelligence.js` | 0 | Legacy-unreachable |
| `engine/queries/spot-hub-query.js` | 0 | Legacy-unreachable |
| `engine/surf-intelligence-fusion.js` | only `spot-hub-query.js` (dead) | Legacy-unreachable |
| `engine/render-pipeline.js` | 0 | Legacy-unreachable |
| `engine/layer-plugins/marine-layers.js` | 0 | Legacy-unreachable |
| `engine/workers/forecast-decode-worker.js` | 0 | Legacy-unreachable |
| `engine/data/model-normalizers.js` | 0 real imports (2 comment mentions) | Legacy-unreachable |
| `engine-brain/*` | only via the dead modules above | Legacy-unreachable |

Positive control with the identical grep: `useSimulationField` → `MapWebGL.js:42` (live).
No barrel re-exports in `engine/` or `engine-brain/` (`grep -rn "export .* from"` → 0).
Dynamic `import()` exists only in `App.js` route lazies — none reach `engine-brain`.
`new Worker(` exists at exactly 2 sites: `components/map/useGridWorker.js:25` and
`hooks/useSessionTracker.js:22` (`workers/gpsWorker.js`) — so `forecast-decode-worker.js` is never
instantiated either.

⇒ **Dead**, but a live *mandate* hazard: a second surf-quality model with a colliding vocabulary,
zero import edges, and zero mention in any program register.

---

## 2. THE TWO ALERT PATHS

### 2.1 The guard reads one file; the production job is the other one

`backend/routes/surf_data/alerts.py:339-388` was repaired (a 15-line comment quotes CLAUDE.md
verbatim: *"A size without a quality is also incomplete"*) and is pinned by
`backend/tests/test_surf_alert_states_the_quality.py`. Its structural guard,
`test_the_route_uses_the_helper_rather_than_rebuilding_the_string` (`:100`), opens **one hard-coded
path**: `routes/surf_data/alerts.py`.

`backend/scheduler/surf_alerts.py` is a **second, independent implementation** of the same job.
Applying that test's own AST logic to both files:

```
backend/routes/surf_data/alerts.py
  LIVE perfect-conditions literals: []
  calls surf_alert_body: True
  reads rating / rating_level: True / True
backend/scheduler/surf_alerts.py
  LIVE perfect-conditions literals: [(94, 'ft - perfect conditions!')]
  calls surf_alert_body: False
  reads rating / rating_level: False / False
```

Which one runs? `backend/scheduler/__init__.py:14` imports `check_surf_alerts_task`; `:43-45`
registers it on `IntervalTrigger(minutes=15)` with `id='check_surf_alerts'`, corroborated by
`routes/admin/system.py:350` (`"Check surf alerts against conditions", "Every 15 minutes"`).
`routes/surf_data/alerts.py`'s `/alerts/check` is a **manual POST**, no scheduler registration.

⇒ The repaired path is the one nobody calls; the path that fires every 15 minutes still sends
`"Waves are {h}ft - perfect conditions!"` (in-app, `:94`) and `"Waves are {h}ft - Go get some!"`
(**push**, `:111`), with `rating`/`rating_level` sitting unread in the same `current_conditions`
dict it already fetched.

Repo's own recorded class: **"THE CENSUS IS THE DEFECT, NOT THE ASSERTION."** The assertion here is
excellent (it even excludes docstrings so the record of a defect does not read as the defect). The
census — one file — is wrong.

### 2.2 The same notification deep-links to two different places

| arrival path | destination | source |
|---|---|---|
| Web push | `/map?spot=${data.spot_id}` | `frontend/public/service-worker.js` `notificationclick`, `type === 'surf_alert'` |
| In-app drawer / page | `/alerts?alert_id=…` | `frontend/src/utils/notificationDeepLinks.js:210-214`, consumed by `NotificationsDrawer.js:250` and `NotificationsPage.js:285` |

And `/map?spot=` is **not read by anything**: `components/MapPage.js` and all of `components/map/`
contain zero `useSearchParams` / `location.search` / `URLSearchParams(window…)` (positive control:
~20 files elsewhere in `src/` use `useSearchParams`). `/alerts` does exist
(`App.js:174` → `SurfAlerts`). So the push tap lands on a generic map at whatever the previous
viewport was.

---

## 3. DIRECTION (a) — WEATHER'S DEPENDENCIES ON SHARED APP INFRASTRUCTURE

### 3.1 Shared HTTP client — `frontend/src/lib/apiClient.js`

The weather subsystem is a full consumer of the app-wide axios instance. Importers inside
`components/map/`: `backendWeatherServiceClient.js`, `backendWeatherServiceClientDiag.js`,
`backendCopernicusServiceClient.js`, `backendPrecipitationServiceClient.js`,
`backendPressureServiceClient.js`, `marineGridSeries.js`, `windGridSeries.js`,
`spotRatingsClient.js`, `TruthOverlay.js`, `RequestProModal.js`.

Consequences that cross the boundary:

* **`timeout: 60000` (`:30`), no override anywhere in weather or conditions code.**
  `grep -rn "timeout:" src/components/map src/hooks src/lib` returns zero axios timeouts on any
  weather/conditions call. WS-CAN-0064 measures `/api/conditions/batch` at p50 **52,238 ms**
  (12.0 RV-01) and **58,713 ms** (12.1 LV-01) — i.e. the shared ceiling sits 1–8 s above the
  measured median. The one caller, `hooks/useExploreData.js:29`, catches into
  `logger.error` with no user-visible state, so the Explore tab simply shows no conditions.
* **Global 401 handling (`:109-131`)** clears 8 localStorage keys and does
  `window.location.href = '/auth'` 2 s after ANY non-admin non-auth 401. Weather endpoints
  themselves are unauthenticated (`backend/routes/weather.py`: only `:759 get_diagnostics_log` has
  `Depends(get_current_admin)`; `routes/surf_data/conditions.py` has only `Depends(get_db)`), so
  weather cannot *cause* it — but a 401 from any concurrent poller during a long map dwell tears the
  map down mid-flight. Weather is a passive victim; app-wide behaviour, not a weather defect.
* **Module-import warm-up ping** (`:44-49`) fires `GET /api/health` on import, before React renders.
* `BACKEND_URL` (`:23`) is overridable at runtime via `window.__BACKEND_URL__` or a localStorage
  key — the same origin the weather clients use.

### 3.2 Shared auth/pricing state gates what the forecast *is*

`components/MapPage.js:421,545,568` derives `userTier` from AuthContext:
`user ? (user.subscription_tier || user.tier_id || 'tier_1') : 'guest'`.

That single string then decides **forecast content**, not just chrome:

* `MapWebGL.js:260` — `resolveForecastWindow(userTier, activeModel, activeLayers[0])` sets
  `forecastDays`, i.e. the forecast horizon fetched.
* `MapWeatherControls.js:4,278` — `getAllowedModels(user)` + `resolveForecastWindow` set the model
  menu and `maxForecastDays`.
* `hooks/useWeatherState.js` imports `LayerAccessResolver` for layer gating.
* `MapWebGL.js:694` — the engine-lifecycle effect is keyed `[mapInstance, userTier]`, so a tier
  change runs `shutdownEngine()` (`:687`) and re-inits.

The canonical mapper `LayerAccessResolver.js:59-86` is **substring matching over names owned by the
billing subsystem**: `includes('free')`, `includes('basic')`, `includes('paid')`,
`includes('premium')`, `includes('pro')`, `includes('parent')`, `includes('admin')`, plus exact
`tier_1`…`tier_4`. Demonstrable collisions: `'unpaid'.includes('paid')` → **basic**;
`'promo'.includes('pro')` → **premium**; `'freelance'.includes('free')` → **free**. A new tier name
shipped by the pricing team therefore changes which weather models and how many forecast days the
weather subsystem serves, with no weather-side test. There is also a global escape hatch at `:60`:
`window.__FORCE_PREMIUM_TIER__`.

Registers: `userTier` appears **once** across 12.1 (WS-CAN-0022's "userTier zombie shutdown" — a
lifecycle residual). `LayerAccessResolver` appears **zero** times.

### 3.3 React providers

`grep -rhn "from '../../contexts/…'" src/components/map` → only two providers reached:
`ThemeContext` (5 files: `MapWebGL.js`, `MapWeatherControls.js`, `MapForecastOverlay.js`,
`FeaturedPhotographersPanel.js`, `RequestProModal.js`) and `AuthContext` (1 file:
`RequestProModal.js`). `PersonaContext` and `PricingContext` are not imported by any map module —
they reach weather only indirectly, through the `userTier` prop threaded from `MapPage.js`.
`grep -rl "return (" --include=*.js src/components/map | grep -v test | wc -l` → 76 (an upper bound
on rendering modules, not a JSX-verified count); 5 of those are theme-aware.

### 3.4 Error boundaries

Two layers. `App.js:113` wraps every lazy route in `components/routing/ErrorBoundary` (handles
ChunkLoadError with a reload, `:52-57`). `components/MapPage.js:716` additionally wraps the map in
`components/map/MapErrorBoundary.js`.

`MapErrorBoundary` (50 LOC) does exactly two things on catch: `logger.error` (`:19`) and render a
fallback. It emits **no** truth event, **no** telemetry, and no client-diagnostics POST — so a map
crash is invisible to the server (this is the same hole WS-CAN-0020 / WS-OBJ-504 describe: one
throttled POST at `TruthOverlay.js:141` is the only client→server transport). GL disposal happens
only implicitly: React unmounts `this.props.children`, running `MapWebGL.js:683-693`'s cleanup →
`shutdownEngine()` + `disposeAnimationCoordinator()`. There is no test that asserts this.
Its fallback hardcodes `bg-zinc-900 text-white` (`:25`) — single-theme, against the binding
THREE THEMES mandate, on the map's own failure surface.

### 3.5 Service worker — `frontend/public/service-worker.js` (394 LOC)

* Weather/marine are **explicitly excluded** from SW interception (`:91-104`): hostname tests for
  `open-meteo.com`, `rainviewer`, `tiles.`, `tile.`, `maplibre`, `.om`, `om` protocol; pathname
  tests `includes('/marine')` and `includes('/weather')`. `/api/weather/spot-ratings` matches
  `/weather` and is excluded. **No stale-forecast hazard from the SW.**
* But `/api/conditions/*` and `/api/tides/*` match **neither** the exclusion list nor
  `OFFLINE_API_PATTERNS` (`:19-23`: `/api/surf-spots`, `/api/surf-spots/search`,
  `/api/spots-in-bounds`), so they fall through to the terminal no-`respondWith` branch (`:218`) —
  native, uncached. Correct outcome, reached by omission rather than by rule: adding a pattern to
  `OFFLINE_API_PATTERNS` would start caching forecast-derived conditions with no weather-side guard.
* `BUILD_VERSION` (`:2-8`) namespaces 5 caches; this is the stamp WS-CAN-0039 reads to prove the
  production frontend is 85 days behind HEAD.
* `notificationclick` deep-links `surf_alert` into `/map` (§2.2).

### 3.6 Workers

Exactly two `new Worker(` sites app-wide. `components/map/useGridWorker.js:25` is weather-owned
(WS-CAN-0008 covers its `onerror`/recreate path). `hooks/useSessionTracker.js:22` →
`src/workers/gpsWorker.js` is session tracking and shares nothing with weather.
`src/engine/workers/forecast-decode-worker.js` has zero importers and zero instantiations — dead.
No SharedWorker, no shared worker pool between weather and the rest of the app.

### 3.7 Shared caches

No shared cache object crosses the boundary. `utils/tileCache.js` exists but is imported by nobody;
the two live tile caches are private module-level `Map`s:
`components/map/radarTileRecolor.js:307` (weather, LRU-bounded at `TILE_CACHE_MAX`) and
`engine/tile-streaming-system.js:25` (dead path). `routes/explore_discover/explore.py:98` keeps a
server-side conditions cache keyed by `_get_cache_key(lat, lng, days, model, spot_id)` — pinned by
`test_spot_hub_local_size_reference.py` to include `spot_id`, because two catalogued peaks inside
one 2-dp rounded cell would otherwise share a rating.

### 3.8 Route transitions, RAF and GL contexts

`/map` is `App.js:153`: `<ProtectedRoute><AppLayout><Lazy><MapPage/></Lazy></AppLayout></ProtectedRoute>`
— React.lazy'd (`:28`), so navigating away unmounts it and runs `MapWebGL.js:683-693`
(`shutdownEngine()` → `stopHealthMonitor`, `stopDispatcher`, `stopSimulation`,
`stopPluginRenderLoop`, `destroyGPU`; then `disposeAnimationCoordinator()`).
The known exception is already an ID: `WeatherTelemetry.js:397-399` starts a RAF at **module import**
with zero `cancelAnimationFrame` in the file — WS-CAN-0022 / WS-OBJ-301, confirmed live at 12.1
(LV-04, `activeRafCount = 1` with `activeLayers = []`). No test asserts route-change disposal.

### 3.9 Build config / release identity

`frontend/src/buildVersion.js` is imported by `weatherTruthTracker.js:8` and
`WeatherTelemetry.js:8` (WS-CAN-0003, closed) and by the service worker's `BUILD_VERSION`.
`netlify.toml`, `render.yaml`, `lighthouserc.json` are shared; no weather-specific build step.

### 3.10 i18n — checked and cleared

`components/map/` uses `useTranslation` **zero** times. But the positive control kills the finding:
`grep -rln "useTranslation" --include=*.js src` returns **2 files total**, and both are the
infrastructure itself (`i18n.js`, `hooks/useLocale.js`). Locales exist (`public/locales/{en,es,pt}`)
but essentially nothing in the app is internationalised. **Not weather-specific; not a gap for this
area.**

### 3.11 Global CSS / viewport

`grep -n "canvas\|maplibre\|mapboxgl" src/index.css src/App.css` → zero. No global rule targets the
map canvas. `src/styles/` holds exactly two files, both weather-owned (`map-status.css`,
`wraparound.css`). No shared viewport-measurement utility crosses the boundary.

---

## 4. WHAT IS ALREADY COVERED (kill attempts that succeeded)

| Apparent concern | Killed by | Why |
|---|---|---|
| Map crash never reaches the server | WS-CAN-0020 / WS-OBJ-504 | `MapErrorBoundary` logs locally only; the objective is precisely "a frontend incident reaches a server without asking a user", and its blocker WS-CAN-0063 is closed |
| Module-import RAF survives route change | WS-CAN-0022 / WS-OBJ-301 | Named site-for-site (`WeatherTelemetry.js:397-399`), confirmed live at LV-04 |
| Engine teardown on `userTier` change | WS-CAN-0022 | "userTier zombie shutdown" is an explicit sub-item |
| `/api/conditions/batch` is far too slow | WS-CAN-0064 (+ WS-CAN-0009, same file) | p50 measured in two consecutive audits |
| `/conditions/*` returns 200 with an error body (verified at HEAD: `conditions.py:172,176,212,216,270,274,327,331` + the batch `one()` error tuple) | WS-CAN-0009 | Nine sites already enumerated by the register |
| Grid worker crash handling | WS-CAN-0008 | `useGridWorker.js:42,68` |
| Build stamp on truth/telemetry | WS-CAN-0003 | Closed |
| Production SW is stale | WS-CAN-0039 / WS-OBJ-104 | Owner-gated |
| Weather map is English-only | *not a gap* | Positive control: the whole app is (2 i18n files) |
| Spot-of-the-Day uppercase rating enum | *not a gap* | Human-entered; no forecast value routed into it (both call sites read) |
| SW might cache forecasts | *not a gap* | `/marine` + `/weather` explicitly excluded at `service-worker.js:91-104` |
| `services/surf_conditions.py` is a 4th forecast path | *already repaired* | `_breaking_ft:61-95` calls the chain; in-file record of the fix |
| Chain callers might drop `spot_id` | `test_spot_hub_local_size_reference.py:273-306` | AST census pins all 7 calls across 5 modules |

---

## 5. STANDING HAZARDS RECORDED, NOT RAISED

* `test_conditions_route_wire_contract.py:124` and `:126` use `pytest.skip(...)` when the route
  cannot run — a refusal that reads as a pass. Same shape as the program's "A REFUSAL YOU CANNOT
  READ IS A PASS" class; belongs to the test-integrity area, not this one.
* `LayerAccessResolver.js:60` `window.__FORCE_PREMIUM_TIER__` is an unregistered global that changes
  which forecast models and horizon are served.
* `SpotDrawerHelpers.js:30` and `SpotUIComponents.js:14` are byte-duplicated `getRatingColor`
  implementations.
* `MapErrorBoundary.js:25` hardcodes `bg-zinc-900 text-white` (single theme) on the map's failure
  surface, against the binding THREE THEMES mandate.
* `backend/scheduler/surf_alerts.py` constructs its own `PointResolutionService` at module import
  (`:11-16`), a second instance beside every route module's — no shared L1 cache between the
  scheduler's 15-minute sweep and the request path.
