# Audit 12.2 — Source Inventory: WORKERS · SERVICE WORKER · CACHES · STORAGE

**Auditor:** independent area auditor (12.2 coverage / blind-spot audit)
**Repo:** `C:\Users\dprit\Raw-Surf` · branch `dev` · HEAD `791fdf78`
**Method:** independent enumeration FIRST, then diff against
`audit/weather-simulation-12.1/{PROGRAM_OBJECTIVE_REGISTER.csv, CURRENT_CANONICAL_TASK_REGISTER_12.1.csv,
FINISH_LINE_GAP_MATRIX.csv, STATE_OF_THE_ART_TARGET_CONTRACT.md}` and
`audit/weather-simulation-12.0/CANONICAL_TASK_REGISTER.csv`.
**Discipline:** every "there is no X" is paired with a POSITIVE CONTROL from the same file or
directory; every count names the command that produced it. Read-only throughout — no production
file, test, config or lockfile was modified. No credential value appears below.

---

## 0. How I counted (reproducible, all run this session)

| Question | Command (cwd) | Result |
|---|---|---|
| Web Worker constructions | `grep -rn "new Worker(" frontend/src frontend/public` | **2 sites** |
| Worker-ish files | `find frontend/src frontend/public -iname "*worker*" -not -path "*/node_modules/*"` | **9 paths** (4 worker sources + 1 hook + 1 test + SW + OneSignal SW + maplibre vendor) |
| Storage API volume | `grep -rn "<api>" frontend/src --include=*.js \| wc -l` (repo `frontend/`) | `localStorage` **376**, `sessionStorage` **5**, `indexedDB` **2**, `caches.` **13**, `openDatabase` **0** |
| Distinct **literal** storage keys, weather/map dirs | `grep -rhoE "(localStorage\|sessionStorage)\.(get\|set\|remove)Item\(\s*['\"\`][^'\"\`]+" src/components/map src/utils src/hooks src/contexts src/services \| sed -E "s/.*\(\s*['\"\`]//" \| sort -u` | **38** |
| Distinct **variable-bound** storage keys (invisible to the line above) | `grep -rnoE "(const\|let\|var) +[A-Z_a-z0-9]+ *= *'rawsurf[^']*'" src --include=*.js \| sort -u` | **13** |
| Backend disk cache files | `ls backend/uploads/forecast_cache/` | **2**, both **dirty in the working tree** |
| Module-level Python caches | `grep -rnE "^_?[A-Za-z_]*(CACHE\|_cache)[A-Za-z_]* *[:=] *(\{\}\|Dict\|OrderedDict)" backend/services backend/routes --include=*.py` | **8** at module scope + 2 class-scope on `ProductStore` |

⚠️ **METHOD LANDMINE, recorded because it would corrupt any storage census that repeated it.** The
literal-key grep (38 keys) **misses the three largest weather caches in the app** —
`rawsurf_marine_cache_v10`, `rawsurf_pressure_cache_v2`, `rawsurf_wind_cache_v3` — because their keys
are bound to `LS_*_KEY` variables and passed to `hydrateCache(key)` / `persistCache(key, …)`. This is
the *rebound-name-defeats-grep* class. **A storage inventory needs BOTH greps.** Full variable-bound
set: `marineControllerCache.js:24`, `marineControllerPressure.js:23`, `windController.js:34`,
`ErrorBoundary.js:17`, `useIPGeolocation.js:12,13`, `useOfflineMode.js:16-20`,
`useOfflineQueue.js:11`, `offlineGallery.js:11`.

⚠️ Repo-root `grep -rn` reaches `.claude/worktrees/` and takes >2 min; every count above is scoped to
`frontend/`, `frontend/src/` or `backend/`. (Stale-worktree hazard = WS-CAN-0055, already registered.)

---

## 1. WEB WORKERS — complete inventory

**4 worker source files + 1 vendor SW + the app SW. 2 `new Worker(` constructions.**

| # | Worker file | Constructed at | Asset-path mechanism | Reachability | Evidence |
|---|---|---|---|---|---|
| W1 | `frontend/src/workers/gpsWorker.js` (62 LOC) | `frontend/src/hooks/useSessionTracker.js:22` — `new Worker(new URL('../workers/gpsWorker.js', import.meta.url))` | webpack 5 (CRA 5 / craco) emits a hashed chunk under `/static/js/` | **Active-reachable** (session tracking, not weather) | `grep -rl "PROCESS_POSITION" build/static/js/` → **4 files** |
| W2 | `frontend/src/components/map/GridParserWorker.js` (748 LOC) | `frontend/src/components/map/useGridWorker.js:25-26` — `new Worker(new URL('./GridParserWorker.js', import.meta.url))` | same | ⛔ **Legacy-unreachable** — §1a | `grep -rl "calculatePressureExtrema" build/static/js/` → **0**; `grep -rl "GridWorker" build/static/js/` → **0** |
| W3 | `frontend/src/engine/workers/forecast-decode-worker.js` (152 LOC) | **never** | n/a | ⛔ **Dead** — 0 references anywhere | `grep -rn "forecast-decode-worker" frontend/src frontend/public frontend/e2e` → **0**. POS CONTROL, same shape: `grep -rn "GridParserWorker" frontend/src frontend/e2e` → **7 hits** |
| W4 | `frontend/public/maplibre-gl-worker.js` (457,880 B, committed) | not `new Worker` — `maplibregl.setWorkerUrl('/maplibre-gl-worker.js')` at `frontend/src/components/map/mapUtils.js:15` | served **verbatim** from `public/` (CRA copies unhashed) | **Active-reachable**, weather map lane | `ls -la build/maplibre-gl-worker.js` → 457,880 B present in the emitted build |
| — | `frontend/public/OneSignalSDKWorker.js` (1 line) | registered by `useOneSignal.js` (`serviceWorkerPath`) | verbatim from `public/` | Active-reachable, **out of weather scope** | file is a single `importScripts(...OneSignalSDK.sw.js)` |
| — | `frontend/public/service-worker.js` (395 LOC) | `frontend/src/index.js:333` | verbatim from `public/` | **Active-reachable** (non-localhost only) | §2 |

### 1a. The `GridParserWorker` lane cannot execute in a shipped build

Chain: `GridParserWorker.js` ← `useGridWorker.js` ← `usePressureEngine.js` ← **nothing**.

```
[NEG] grep -rnE "usePressureEngine" frontend/src frontend/e2e
      src/components/map/usePressureEngine.js:5        ← its own export
      src/engine/SimulationFieldBuilder.js:268,277,324 ← COMMENTS only ("from usePressureEngine")
      src/engine/useSimulationField.js:5,33            ← COMMENTS only
      → ZERO import/require edges
[POS CONTROL, same dir] grep -rnE "from ['\"].*useMarineOrchestrator" frontend/src
      → src/components/map/MapWebGL.js:15 (+4 more)   ← the grep technique finds real edges
```

Artifact confirmation (`frontend/build/`, **untracked local build dated 2026-08-12 14:11,
`BUILD_VERSION = '91c561cf'` — one day and several commits behind HEAD, stated as a caveat**):
`calculatePressureExtrema` and `GridWorker` appear in **0 of the 99** files under `build/static/js/`,
while positive controls in the same directory are unambiguous — `WebGLMarineEngine` → **4** files,
`map-tiles.open-meteo.com` → **6** files, `PROCESS_POSITION` (W1) → **4** files. Webpack tree-shook
the whole worker lane because nothing imports its entry point. The source-level evidence (0 import
edges) is independent of the build's age and is the stronger of the two.

**Consequence for the register.** WS-CAN-0008 ("Worker crash handling: onerror + reply ordering …",
*Implemented and Active / Partially Verified*, remaining work = reply-ordering test R11-14.3) names
`useGridWorker.js:42` / `:68` as its symbols, and WS-OBJ-301 names `useGridWorker / disposeEngine /
RAF owners` as its architecture owner. Both point at a module that **cannot run in a shipped build**.
Meanwhile `frontend/src/tests/grid-parser-worker.test.js` runs unit tests against it by reading the
file off disk — so the estate has *more* test coverage on the dead worker than on the live service
worker, which has **zero** (§2e).

### 1b. `public/maplibre-gl-worker.js` — hand-committed vendor asset, one reference, no guard

* Byte-identical to the installed CSP worker **today**:
  `md5sum public/maplibre-gl-worker.js` = `dd56fbe95866b5ee76658b1c0778c77f`
  `md5sum node_modules/maplibre-gl/dist/maplibre-gl-csp-worker.js` = `dd56fbe95866b5ee76658b1c0778c77f`
* `package.json:56` declares `"maplibre-gl": "^5.24.0"` (caret); `package-lock.json:15547-15549` pins
  `5.24.0`. `netlify.toml:3` builds with `npm install --legacy-peer-deps` (not `npm ci`) — **the lock
  is present and honoured, so drift is LATENT (a lock regeneration), not live.** Recorded at Low.
* **No guard.** `grep -rn "setWorkerUrl\|maplibre-gl-worker" frontend/src frontend/e2e
  frontend/craco.config.js frontend/package.json` → **exactly 1 hit**, `mapUtils.js:15`. No test, no
  build step, no checksum ties the public copy to the installed package.
* Non-CSP `dist/maplibre-gl.js` already inlines its own worker as a Blob URL, so `setWorkerUrl`
  **overwrites** it — ~450 KB of worker payload is shipped twice per build.

### 1c. Worker lifecycle vs SOTA A11 / B11

* `useGridWorker.js:42` `onerror = onmessageerror` rejects all pending promises, terminates, nulls
  the instance; `:70` re-creates on next use. **Correct — on a lane that does not ship.**
* `useGridWorker.js:99` cleanup deliberately does **not** terminate ("Don't terminate shared worker
  other components may use it"), so the module-level `_workerInstance` outlives every consumer.
* `gpsWorker` (W1): no `onerror` at the construction site. Out of weather scope.
* MapLibre workers: disposed via `map.remove()`; not independently audited here.

---

## 2. SERVICE WORKER — `frontend/public/service-worker.js`

### 2a. Versioning and invalidation

| Cache constant | Value | Carries BUILD_VERSION? | On `activate` | Ever written? |
|---|---|---|---|---|
| `CACHE_NAME` | `rawsurf-v3-${BUILD_VERSION}` | ✅ | kept | ✅ `STATIC_ASSETS` on install |
| `SPOT_CACHE_NAME` | `rawsurf-spots-v1-${BUILD_VERSION}` | ✅ | kept | ✅ §2d |
| `OFFLINE_CACHE_NAME` | `rawsurf-offline-v1-${BUILD_VERSION}` | ✅ | kept | ⛔ **never** — declaration + keep-list only |
| `GALLERY_CACHE_NAME` | `rawsurf-gallery-offline-v1` | ❌ **deliberate** (`// Gallery persists across deploys`) | **exempted from purge** | ⛔ only by `utils/offlineGallery.js`, which is dead (§3d) |
| `FEED_CACHE_NAME` | `rawsurf-feed-v1-${BUILD_VERSION}` | ✅ | kept | ⛔ **never** in the SW |

`activate` (`:63-73`) deletes every cache key not on the five-name keep-list — so a `BUILD_VERSION`
change purges four of the five.

**Stamping.** `frontend/update-sw-version.js` writes `git rev-parse --short HEAD` (timestamp
fallback) into **both** `public/service-worker.js` and `src/buildVersion.js`, so the running bundle
can self-identify. It runs **twice per deploy**: `package.json:80 "prebuild"` and again as the first
term of `netlify.toml:3 command = "node update-sw-version.js && npm install --legacy-peer-deps && CI=false npm run build"`.
Tracked values at HEAD: SW = `d50cc058`, `buildVersion.js` = `'dev'` — **both are placeholders,
rewritten at build time; never trust the tracked value.** (Side effect: a local `npm run build`
dirties two tracked source files.)

**Registration.** `frontend/src/index.js:314-344`. An explicit **localhost guard** at `:320-331`
unregisters every SW and purges every `rawsurf-*` cache, with the motivating incident in-comment
("a whole marine-render session was lost to it"). Non-localhost: `register('/service-worker.js')`
plus `registration.update()` every 60 min. `skipWaiting()` + `clients.claim()` → a new SW takes over
immediately. A second registration path exists in `hooks/usePushNotifications.js`.

**Delivery headers** (`frontend/public/_headers`): `/static/js/*` and `/static/css/*` →
`max-age=31536000, immutable` (safe — content-hashed); `/index.html` → `no-cache, no-store,
must-revalidate`; `/*` → `no-cache`, which covers `service-worker.js` and `maplibre-gl-worker.js`.

### 2b. Can a stale SW serve a stale **weather bundle**? — measured: **NO**

```
[NEG] grep -nE "static/js|\.chunk|precache|workbox" frontend/public/service-worker.js  → 0 hits
[POS CONTROL, same file] grep -c "cache.put\|cache.addAll"                            → 4 lines
```
`STATIC_ASSETS = ['/', '/index.html', '/manifest.json', '/offline.html']`. **No JS/CSS bundle is ever
cached by the SW.** There is no Workbox, no precache manifest. The only bundle-adjacent path is the
`mode === 'navigate'` handler (`:192-218`), which is **network-first** and falls back to a cached
`/offline.html` → `/index.html` only when `fetch` throws — and that cache is `CACHE_NAME`, i.e.
scoped to `BUILD_VERSION`.

⚠️ **Several project documents assert the opposite and are stale at HEAD** (e.g. a runbook line
"a stale SW can serve an old bundle", and a handoff calling the SW "cache-first"). A reader acting on
those will mis-attribute a stale-render report. `docs/` is documentation, not production source — a
LEAD, not a code gap.

### 2c. What the SW does to **weather** traffic

Exclusion list `:91-104` — early `return` with no `respondWith` when
`hostname.includes('open-meteo.com'|'rainviewer'|'tiles.'|'tile.'|'maplibre'|'.om')`,
`protocol.includes('om')`, or `pathname.includes('/marine'|'/weather')`.

| Route | Excluded? | Cached? | Net effect |
|---|---|---|---|
| `/api/weather/point`, `/api/weather/grid_series` | ✅ (`/weather`) | no | passthrough |
| `/api/marine/*` | ✅ (`/marine`) | no | passthrough |
| `map-tiles.open-meteo.com` `.om` tiles | ✅ (`open-meteo.com`) | no | passthrough |
| `/api/conditions/batch` | ❌ | no (not in `OFFLINE_API_PATTERNS`) | passthrough |
| `/api/spot-ratings` | ❌ | no | passthrough |
| `/api/surf-spots`, `/api/surf-spots/search`, `/api/spots-in-bounds` | ❌ | **YES** → `SPOT_CACHE_NAME` | §2d |

`om://` URLs never reach this handler — they are a MapLibre `addProtocol` scheme resolved in-page,
not a network `Request`, so `protocol.includes('om')` is unreachable. The checks use the same
**substring** shape that produced WS-CAN-0059 (`.js` matching `.json`); e.g. `hostname.includes('tile.')`
matches any host containing `tile.` anywhere, and `.om` would match `cdn.omni.example.com`. **No live
false match found among the routes actually in use** → class observation, not a defect.

### 2d. `SPOT_CACHE_NAME` growth

`:112-127` — `cache.put(event.request, responseClone)` for every **successful**
`/api/spots-in-bounds?sw_lat=…&sw_lng=…&ne_lat=…&ne_lng=…`. The caller
(`frontend/src/hooks/useOfflineMode.js:154-160`) builds that query from raw geolocation floats
(`lat - 0.9` … `lng + 0.9`), so **every sync at a new position is a distinct cache entry**. There is
**no size cap, no entry-count cap, no TTL and no LRU**; the only eviction is the whole-cache delete on
a `BUILD_VERSION` change, or an explicit `CLEAR_SPOT_CACHE` message (`:359`). Quota failures are
swallowed (`.catch(() => {})` at `:125`).

Good practice present and worth preserving: `if (response && response.ok)` (`:116`) refuses to cache
a cold-start 502/4xx with the incident in-comment; the cache-fallback path stamps
`X-SW-Cache-Fallback: 1` (`:143`) so the client can tell a transient cold start from real offline —
both motivated by the "only Central FL spots" report, recorded in-file.

### 2e. Service-worker test coverage: **zero**, and the E2E lane stubs it out

```
[NEG] grep -rlnE "service-worker|rawsurf-v3|SPOT_CACHE_NAME|OFFLINE_API_PATTERNS|skipWaiting" \
        frontend/src frontend/e2e --include=*.test.js --include=*.spec.js   → 0 files
[POS CONTROL] grep -rl "openMeteoProtocol\|colorScales" frontend/src --include=*.test.js
        → colorScales.aliasSurfaceTemperature.test.js, layerColorScaleCoverage.test.js
```
`frontend/e2e/weather-simulation.spec.js:27-42` `beforeEach` replaces `navigator.serviceWorker` with
a mock whose `register` and `ready` are **promises that never settle** — comment: "Disable service
worker to prevent NS_ERROR_FAILURE and caching issues in E2E tests". So the certified-green E2E lane
(WS-OBJ-705, LV-02, `Running 52 tests`) has never executed one line of the service worker, and no
unit test covers it either.

---

## 3. BROWSER STORAGE — every key the weather feature touches

### 3a. `localStorage`

| Key | Owner | Written? | Identity carries | TTL / eviction | Survives a deploy? |
|---|---|---|---|---|---|
| `rawsurf_marine_cache_v10` | `marineControllerCache.js:24,50` | ✅ `persistCache` | `hash, bounds, model, activeLayer, provider, isGlobal, timestamp` — **no run** | `HOURLY_CACHE_TTL` 60 min on hydrate; hard-rejected + removed if `provider !== 'open-meteo'` (`:32-37`) | **YES** — key has no `BUILD_VERSION`, only a hand-bumped `_v10` |
| `rawsurf_pressure_cache_v2` | `marineControllerPressure.js:23,250` | ✅ | same slim shape — **no run** | 60 min | **YES** (`_v2` hand-bumped) |
| `rawsurf_wind_cache_v3` | `windController.js:34,37,47` | ⛔ **NEVER** — §3b | — | hydrate-only | **YES** |
| `rawsurf_cooldown_${domain}_until` (wind/marine/pressure/copernicus) | `marineControllerUtils.js`, `marineRequestGovernor.js` | ✅ | domain only | value *is* the expiry | YES |
| `rawsurf_cooldown_marine_count` | `marineControllerUtils.js` | ✅ | — | reset to `'0'` on recovery | YES |
| `rawsurf_failure_${requestKey}` | `marineRequestGovernor.js` | ✅ | request key | removed on success; **no sweep for keys that never succeed again** | YES |
| `force_wind_fallback`, `force_marine_fallback` | map controllers; also seeded by `e2e/weather-simulation.spec.js` | ✅ | — | none — sticky until cleared | YES — **named by WS-CAN-0022** |
| `rawsurf-active-model` | model selector | ✅ | — | none | YES |
| `wind_series`, `marine_series`, `wind_model_prewarm`, `marine_sibling_prewarm` | grid-series / prewarm flags | read-only `'true'`/`'false'` | — | n/a | YES |
| `rawsurf_backend_pressure_enabled`, `rawsurf_backend_precipitation_enabled`, `__USE_BACKEND_{WIND,WEATHER,MARINE,ICON_MARINE,COPERNICUS}_*`, `__RAW_DISABLE_RATINGS_CDN__`, `__RAW_TUNER__`, `__RAW_HEIGHT_UNIT__`, `__RAW_DIAG__`, `__SURF_MODE__`, `__BACKEND_URL__` | runtime overrides | mixed | — | none | YES |
| `rawsurf_cached_spots`, `rawsurf_nearby_spots`, `rawsurf_favorite_spots`, `rawsurf_spots_cache_time`, `rawsurf_auto_sync_enabled` | `useOfflineMode.js:16-20` | ✅ | — | manual `clearCache()` only | YES |
| `rawsurf_offline_queue` | `useOfflineQueue.js:11` | ✅ | — | drained on reconnect | YES |
| `rawsurf_last_known_city`, `rawsurf_last_known_coords` | `useIPGeolocation.js:12,13` | ✅ | — | prefix-filtered purge | YES |
| `rawsurf_chunk_reload_attempted` | `ErrorBoundary.js:17` (**sessionStorage**) | ✅ | — | one-shot | n/a |
| `rawsurf_recent_spots`, `rs-recent-searches`, `rawsurf_cached_feed{,_ts}`, `raw-surf-user{,-original}`, `raw-surf-theme`, `isGodMode`, `activePersona`, `impersonation_session`, `godModeMinimized`, `godModeDesktopMinimized`, `isPersonaBarActive`, `debug-fce`, `surfer_gallery_visibility_seen` | non-weather | — | — | — | — |

**Absence check — no forecast is ever persisted to `localStorage` by offline mode:**
```
[NEG] grep -cniE "forecast|conditions|weather" frontend/src/hooks/useOfflineMode.js  → 0
[POS] grep -c  "localStorage.setItem"          frontend/src/hooks/useOfflineMode.js  → 6
```
Offline mode caches **spots only**. The only persisted forecast data are the three
`rawsurf_*_cache_v*` controller caches above.

### 3b. `rawsurf_wind_cache_v3` is hydrate-only — its writer was deleted by a LOC refactor

```
[NEG] grep -n "persistCache" frontend/src/components/map/windController.js   → 0
[POS] grep -rn "persistCache(" frontend/src/components/map/
        marineControllerCache.js:50 · marineControllerPressure.js:250 · marineControllerUtils.js:126 (defn)
[HISTORY] git log --oneline -S "persistCache(LS_WIND_KEY" -- frontend/src/
        3cca47f1, 020ca9b0, 130aab7d
[DIFF] git show 3cca47f1 -- frontend/src/components/map/windController.js
        -  HOURLY_CACHE_TTL, persistCache, hydrateCache,
        -      persistCache(LS_WIND_KEY, windHourlyCache);
        (63 insertions, 240 deletions)
[COMMIT] 3cca47f1  2026-06-08  "Relocate weather_sim_mcp.py to backend, refactor frontend clients,
          overlays, and pages to meet <800 LOC rule"
```
`windController.js:37` still calls `hydrateCache(LS_WIND_KEY)` at module init and `:47` still removes
the key on a rejected hydrate. With no writer, the read is always a miss on a fresh browser profile,
`lastKnownGoodWind` starts `null` every session, and every reload re-fetches the wind hourly grid.
The marine and pressure siblings kept their writers. **The LOC-ratchet class is documented in project
memory as costing *documentation*; this instance cost a *behaviour*, silently, for 66 days.**

### 3c. `sessionStorage` — 5 sites, none weather

`ErrorBoundary.js:49,51,63,68` (`rawsurf_chunk_reload_attempted`, the one-shot chunk-load-failure
reload guard) and `useIPGeolocation.js:193` — a bare `sessionStorage.clear()` inside a location-cache
purge that otherwise carefully filters `localStorage` by prefix (`:185-190`). The `clear()` wipes
every other consumer's session keys including `rawsurf_chunk_reload_attempted`, re-arming the
one-shot reload.

### 3d. `IndexedDB` — one database, unreachable

`frontend/src/utils/tileCache.js`: DB `leaflet_tile_cache` v1, store `tiles`, `MAX_AGE_MS` = 7 days,
and `_MAX_CACHE_SIZE = 500` **declared at `:12` and never read again** (`grep -n "_MAX_CACHE_SIZE"`
→ the declaration only) — so there is no size bound, only age. `:190` `initDB().then(() => cleanupCache())`
is an **import-time side effect**.
```
[NEG] grep -rn "utils/tileCache|from './tileCache'|require.*tileCache" frontend/src --include=*.js → 0
[POS CONTROL] grep -rcE "from ['\"].*utils/logger" frontend/src --include=*.js → dozens of real edges
```
**0 importers ⇒ Dead, and the import-time side effect therefore never fires.**
Same for `frontend/src/utils/offlineGallery.js`: `grep -rn "offlineGallery" frontend/src` → **1 hit,
its own docstring**. ⇒ **Dead.** But the SW at `:168-189` still intercepts *every* Supabase
`/storage/` request to look in `GALLERY_CACHE_NAME`, and `:66` still exempts that cache from the
deploy purge — a per-request lookup that can never hit, guarding data nothing can write, that is
immortal across deploys.

### 3e. Cache API (`caches.*`) — 13 call sites

* SW-side: the five named caches (§2a).
* `frontend/src/index.js:325-329` — purges every `rawsurf-*` cache, **localhost only**.
* `frontend/src/components/map/marineForensics.js:87-94` — reads `caches.keys()` to cross-check the
  SW build hash against `BUILD_VERSION` and prints a loud `[BUILD] ⚠️ STALE BUNDLE` line. Diagnostic
  only, but it is the one real anti-stale instrument in the estate.
* `frontend/src/utils/offlineGallery.js` — 7 sites, dead (§3d).

---

## 4. FRONTEND IN-MEMORY CACHES holding forecast data

| Cache | File:line | Key identity | Model? | **Run?** | Bound | Eviction |
|---|---|---|---|---|---|---|
| `DECODED_TILE_CACHE` | `openMeteoProtocol.js:144` | `params.url` (full `om://…/{model}/{run}/{z}/{x}/{y}.om`) | ✅ | ✅ **incidentally** — the run is a path segment | `MAX_CACHE_SIZE = 150` (`:145`) | insertion-order FIFO (`:148-150`), **not LRU**; no TTL |
| `MODEL_METADATA_CACHE` | `LayerRegistry.js:346` | model folder id only | ✅ | ⛔ **no — and the value it holds IS the run** | 7 seeded keys | ⛔ **never invalidated** — §5 |
| `WIND_CACHE` | `windController.js:14` | `${model}_wind_grid_${tileId}_${hourOffset}` | ✅ | ⛔ | ⛔ **none** | ⛔ **no `.delete`, no `.size` check** (`grep -n "WIND_CACHE.delete\|WIND_CACHE.size"` → 0); TTL read-side only; `.clear()` only on explicit reset (`:443`). Plus an **O(n) linear scan over the whole unbounded Map on every miss** (`:170`, `:278`) |
| `PRESSURE_CACHE` | `marineControllerPressure.js:17` | `viewportCacheKey(bounds, "pressure_${model}_h${hour}")` (`:164`) | ✅ | ⛔ | ⛔ **none** | ⛔ no `.delete`/`.size`/`.clear`; TTL read-side only |
| `_seriesCache` (marine) | `marineGridSeries.js:31` | page key (model, bounds, page) | ✅ | ⛔ | `SERIES_MAX = 48` | 5 min TTL + coverage-aware dedup |
| `_seriesCache` (wind) | `windGridSeries.js:27` | `pageKey(model, bounds, page)` | ✅ | ⛔ | `SERIES_MAX = 24` | 5 min TTL, size trim |
| `clientGridCache` | `copernicusGridFetcher.js:42` | `(bounds, layer, hour, zoom)` | layer only | ⛔ | ⛔ none | 5 min TTL sweep |
| `_tileCache` (radar) | `radarTileRecolor.js:307` | `httpsUrl` (radar frame id in URL) | n/a | frame id | `TILE_CACHE_MAX` | oldest-by-ts |
| `tideClient` `cache` | `tideClient.js:21` | rounded `cellKey` | n/a | n/a (astronomical) | ⛔ none | `TTL_OK_MS` 3 h / `TTL_FAIL_MS` 10 min |
| `_iconAnchorCache` | `backendWeatherServiceClientHelpers.js:398` | anchor key | ✅ | ⛔ | ⛔ none | ts-based |
| `_landCache`, `_geoCache`, `_maskCanvasCache` | `GPUMarineLayer.js:188`, `WebGLMarineGeoData.js:10`, `WebGLMarineMaskRenderer.js:511` | geometry/dimension | n/a | n/a | `_landCache` **is** bounded (`:252` `delete(oldestKey)`) | — |
| `spotRatingsCdn` `_cache` | `spotRatingsCdn.js:136` | single slot; staleness bounded by `CB_BUCKET_MS` in the URL | ✅ | frames carry `valid_time` | 1 entry | bucket / `NEG_TTL_MS` |
| `MISSING_OM_RUNS` | `openMeteoProtocol.js:20` | — | — | — | — | ⛔ **never written** — §6 |

**POSITIVE CONTROL that "no eviction" is a real finding and not a grep failure:** the same directory
contains caches that *are* evicted — `BoundedPointCache.js:33 this.cache.delete(oldestKey)`,
`GPUMarineLayer.js:252`, `marineControllerCache.js:92 super.delete(oldestKey)`,
`forecastExactPoint.js:557`. The technique finds eviction where it exists.

**Cache-identity verdict.** No frontend forecast cache keys on the model **run**. A short wall-clock
TTL (5–60 min) is the only thing bounding how far a cached frame can lag a cycle rotation (GFS is
6-hourly). The single exception, `DECODED_TILE_CACHE`, carries the run only because the `om://` path
embeds it — not by design.

---

## 5. ⛔ THE `om://` RASTER LANE'S RUN IDENTITY: SEEDED FROM A GUESS, FETCHED ONCE PER PAGE, NEVER REFRESHED, RE-SERVED STAMPED FRESH

The highest-value finding in this area. Three verified facts compose.

**(i) The seed is a computed guess.** `frontend/src/components/map/LayerRegistry.js:374`
```js
const referenceTime = getAlignedReferenceTime();
function getAlignedReferenceTime() {
  const date = new Date(Date.now() - 12 * 3600000);
  const hours = date.getUTCHours();
  date.setUTCHours(Math.floor(hours / 6) * 6, 0, 0, 0);
  return date.toISOString().replace(/\.\d+Z$/, 'Z');
}
```
`:411-417` seeds **all seven** model entries with that value plus synthetic `validTimes` arrays from
`generateDefaultTimes` / `generateGfsDefaultTimes`. Nothing measured the run.

**(ii) The real fetch happens at most once per model per page and cannot be retried or aborted.**
`frontend/src/components/map/mapUtils.js:343-370`
```
[COUNT] grep -rn "LIVE_FETCHED_MODELS" frontend/src
        mapUtils.js:343  export var LIVE_FETCHED_MODELS = new Set();   ← 1 construction
        mapUtils.js:370  LIVE_FETCHED_MODELS.add(modelToCheck);        ← 1 write
        mapUtils.js:347 · modelProvenance.js:99 · useOpenMeteoTileUrls.js:483 ·
        useTemporalPreloader.js:116 · (+ comments)                     ← reads only
        → ZERO .delete, ZERO .clear, no TTL, no interval
```
Once a model is marked live-fetched, its run identity **and** its whole time axis are pinned for the
life of the page. `MODEL_METADATA_CACHE` has no invalidation of any kind.
Additionally `useOpenMeteoTileUrls.js:363-369` calls
`fetchModelMetadata(modelToCheck, MODEL_METADATA_CACHE, onChanged, signal)` — **4 arguments into a
3-parameter function** (`mapUtils.js:345`). The abort signal is silently dropped; the fetch is
unabortable.

**(iii) The page serves that cache back to MapLibre as if it were the network, stamped fresh.**
`frontend/src/components/map/openMeteoProtocol.js` (fetch intercept, ~`:625-640`) catches every
`map-tiles.open-meteo.com/.../latest.json` that lacks `skip_intercept=true` and synthesises:
```js
const responseData = {
  completed: true, crs_wkt: "",
  last_modified_time: new Date().toISOString(),                    // ← fabricated freshness
  reference_time: meta.referenceTime || new Date().toISOString(),  // ← second fabrication
  valid_times: meta.validTimes, variables: meta.variables || []
};
```
Because every seeded entry has a non-empty `validTimes`, the intercept branch is **always** taken for
the seven registered models — MapLibre never sees upstream metadata on this path. A second
`referenceTime`-defaults-to-`new Date()` site sits in the tile-index fallback (~`:622`).

**Net effect:** the raster lane's `reference_time` is (a) a computed guess until one successful
`skip_intercept` fetch lands, (b) never refreshed afterwards for the whole session, and (c) always
accompanied by `last_modified_time: <now>`, asserting a freshness the value does not have. A session
held open across a cycle rotation keeps painting the old run and keeps claiming it is current.

**Partial mitigation already present (recorded so the fix is not over-scoped).**
`frontend/src/components/map/modelProvenance.js:91-100` `describeStaleHour` **refuses to speak on
placeholder data** — it returns `null` unless `LIVE_FETCHED_MODELS.has(omModelId)`, with the reason
in-comment ("LayerRegistry seeds every model with generateDefaultTimes … reading one of those as
evidence would manufacture a false banner"). So the codebase already knows the seed is a guess and
correctly declines to build a *stale-hour* banner on it. What it does **not** do is decline to serve
that guess to MapLibre as `reference_time` with a `last_modified_time` of now. **The refusal exists
one layer above the fabrication.**

---

## 6. `MISSING_OM_RUNS` — a run-blocking guard that can never fire

```
[NEG] grep -n "MISSING_OM_RUNS" frontend/src/components/map/openMeteoProtocol.js
        :20   const MISSING_OM_RUNS = new Set();
        :434  for (const runPattern of MISSING_OM_RUNS) {   ← fetch intercept
        :811  for (const runPattern of MISSING_OM_RUNS) {   ← protocol callback
      → declaration + two reads, ZERO writes
[POS CONTROL, same file, sibling set] grep -n "MISSING_OM_TILES" …
        :21 new Set()  ·  :428 .has()  ·  :491 .has()  ·  :492 .add(urlString)   ← IS written
```
The comment above the second loop reads "Fast-path: Block requests to known missing model runs in 0ms
without throwing or logging." The set is empty for the life of the process, so the block never
triggers and both loops are per-tile-request no-ops. This is the *"a refusal you cannot read is a
pass"* class in its purest form: the guard's negative result is indistinguishable from
"nothing was ever wrong".

---

## 7. BACKEND CACHES

### 7a. `backend/uploads/forecast_cache/` — 2 files, both tracked, **both dirty at HEAD**

Producer: `backend/services/forecast_ingester.py:10` `CACHE_DIR`, `:90` `f"{model_type}_global.json"`,
written atomically (tmp + `os.replace`), refusing to overwrite with empty data. Grid at `:46-47`:
`for lat in range(50, 9, -10): for lon in range(-130, -50, 10)` = **5 × 8 = 40 points** (a USA box,
not a globe). Scheduled by `backend/scheduler/forecast.py` for `'wind'` and `'marine'` each cycle.

Measured this session with `~/AppData/Local/Python/bin/python3.exe -c "json.load(...)"`:

| File | Size | Array len | `hourly.time` | Variables | Run identity in the file |
|---|---|---|---|---|---|
| `wind_global.json` | 72,833 B | **40** | 48 h, `2026-08-13T00:00` → `2026-08-14T23:00` | `wind_speed_10m`, `wind_direction_10m` | **none** — top-level keys are `elevation, generationtime_ms, hourly, hourly_units, latitude, longitude, timezone, timezone_abbreviation, utc_offset_seconds`. No model, no cycle, no ingest stamp |
| `marine_global.json` | 204,796 B | **40** | same 48 h | 12 wave variables | **none**, same key set |

**(1) The wind fallback is structurally unreachable.** The only reader —
`backend/services/weather_pipeline/wind_ingestion.py:190` (GFS), `:304` (EURO), `:502` (ICON) — refuses
at `:196`, `:310`, `:508`:
```python
if len(cached_data) < 100:
    logger.warning("[Pipeline Scheduler] Fallback file has only {n} points (too small for global). "
                   "Skipping this cycle (no mock is generated in production).")
```
The only writer produces exactly **40**. `40 < 100` at all three sites, **always**. The recycling
branch below it — which time-shifts the 48 h snapshot cyclically across 14 days and correctly labels
its output `{"type": "stale_cache_recycled", …}` — has therefore never executed in production. A
degradation path that is priced as protection and cannot run.

**(2) `marine_global.json` has ZERO readers.**
```
[NEG] grep -rn "marine_global\.json" backend --include=*.py  → 0
[POS] grep -rn "wind_global\.json"   backend --include=*.py  → 3 (wind_ingestion.py:190,304,502)
```
⚠️ The bare needle `marine_global` returns ~149 hits — **all** of them `ingest_*_marine_global()`
*function* names. Recorded because it is exactly the `"x" in src` is-never-a-real-needle trap.
The marine leg of the ingester pays an Open-Meteo marine batch fetch for 12 variables (plus inter-batch
sleeps) every cycle to write a file nothing reads.

**(3) Both files are committed AND dirty right now** (`git status --short` → ` M` on both), so the
versioned content is whatever a developer's last local ingest fetched; `hourly.time` starts today.

### 7b. `ProductStore` — L1 disk + L2 Supabase (the real forecast store)

* **L1 filename IS the cache identity.** `backend/services/weather_pipeline/store_helpers.py:81-86`:
  `f"{model}_{domain}_{layer}{region_suffix}_{valid_time:%Y%m%dT%H%M%SZ}{estimated_suffix}.json"`.
  Model, domain, layer, region, **valid time**, estimated flag — **no run/cycle component.** This is
  verbatim WS-CAN-0005's remaining work. ✅ **COVERED.**
* **In-memory `_product_cache`** (`store.py`, used from `store_helpers.py:588-693`): key = `filename`,
  or `filename#sN` for strided reads — a deliberate identity split so a decimated grid cannot be
  served to a full-grid consumer, with the hazard spelled out above the line. TTL 300 s, **dual bound**
  (`PRODUCT_CACHE_LIMIT` **and** a vector budget), insertion-order eviction until both hold. The
  best-instrumented cache in the system.
* **`_l2_negative_cache`** (`store.py:284`, `Dict[str, float]`, lock at `:285`): written at
  `store_helpers.py:637`, read at `:604-606` and `:618-620`.
  ```
  [NEG] grep -rn "_l2_negative_cache" backend/services --include=*.py | grep -E "pop|clear|del " → 0
  [POS] grep -rn "_product_cache.pop"  backend/services --include=*.py → 4 (…:213, :329, :599, :690)
  ```
  Entries are never removed → the dict grows with the number of distinct filenames that ever missed
  L1 and failed an L2 download. Small (`str → float`) but unbounded.
* **L2 download has no integrity check** — `download()` → `write_bytes` → `rename`, no length, no
  `Range`, no checksum. ✅ **COVERED** by WS-CAN-0017 / WS-OBJ-304 / SOTA B14.
* **A corrupt L1 file is never revalidated or removed** — the parse `except Exception` logs and
  returns `None`, and because `filepath.exists()` is checked first the L2 re-download branch is
  skipped forever after. ✅ **COVERED** by WS-CAN-0017's "L1 revalidation" clause.

### 7c. Backend in-process caches

| Cache | File:line | Key | Model? | **Run?** | Bound | Eviction |
|---|---|---|---|---|---|---|
| `_FORECAST_CACHE` | `sim_forecast.py:127` | `(round(lat,4), round(lng,4), valid_time)` — `:374`, `:392` | ⛔ **no** | ⛔ no | `SIM_FORECAST_CACHE_MAX` 256 (`:103`) | **true LRU** (`move_to_end` `:139` + `popitem(last=False)` `:141`), **per-entry TTL stored with the entry** (`:137-138`) so changing the negative TTL mid-incident cannot retroactively extend absences already banked |
| `_CATALOG_CACHE` | `sim_forecast.py:172` | `"spots"` | n/a | n/a | 1 key | none |
| `_GEOMETRY_CACHE` | `sim_rating.py:62` | `(round(lat,6), round(lng,6))` | n/a | n/a | ⛔ **none** — `:86-92` insert + read only, no eviction anywhere | bounded in practice by the ~1,773-spot catalogue |
| `_cache` (sim observed) | `sim_observed.py:54` | observation key | — | — | `SIM_OBSERVED_CACHE_MAX` 256 | FIFO (self-documented "NOT an LRU"), 900 s TTL |
| `_TIDE_CACHE` | `tide.py:22` | `(lat_r, lng_r)` | n/a | n/a (astronomical) | `_TIDE_CACHE_MAX` 2000 | **full `.clear()` on overflow** (`:222-223`, `:287-288`) — a thundering-herd shape |
| `_conditions_cache` | `routes/explore_discover/explore.py:39` | `_get_cache_key(lat, lng, forecast_days, model, spot_id)` (`:49`) | ✅ | ⛔ no | soft 500 (`:82`) | `:84-86` deletes **only already-expired** keys — if >500 entries are all live, the bound is silently exceeded |
| `_surf_spots_response_cache` | `explore.py:45` | response key | — | — | soft 100 | same expired-only shape (`:668` region) |
| `_point_cache` | `copernicus_marine_service.py:173` | point | — | — | not audited | — |
| `_watermark_logo_cache` | `watermark.py:27` | logo path | n/a | n/a | ⛔ none | non-weather |

`_FORECAST_CACHE`'s missing model component is exactly WS-CAN-0006's quoted key tuple. ✅ **COVERED.**

---

## 8. Register diff — what IS already covered (a first-class result)

Absence method: each term was counted in all four register files **plus** the SOTA contract, with
positive controls run against the same files (`surf_rating`, `playwright`, `L1`, `Worker` all returned
non-zero, so the search technique works).

| Term | tasks 12.1 | objectives | SOTA | tasks 12.0 |
|---|---|---|---|---|
| `service.?worker` | 1 (WS-CAN-0039 only) | 0 | 0 | 1 |
| `localStorage` / `sessionStorage` / `IndexedDB` / `CacheStorage` | 0 | 0 | 0 | 0 |
| `reference_time` / `referenceTime` | **0** | **0** | **0** | **0** |
| `forecast_cache` / `marine_global` / `wind_global` | **0** | **0** | **0** | **0** |
| `maplibre-gl-worker` | 0 | 0 | 0 | 0 |
| `BUILD_VERSION` | 2 | 1 | 0 | 2 |
| POS CONTROLS: `surf_rating` / `playwright` / `L1` / `Worker` | 1 / 3 / 2 / 3 | 2 / 1 / 0 / 2 | 0 / 1 / 0 / 3 | — |

| Observation | Covered by | Why that row covers it |
|---|---|---|
| L1 product filename lacks a run component | **WS-CAN-0005** | Row title is literally "…key L1 by run"; `store_helpers.py:81-86` is its named symbol |
| L2 download written to L1 with no length/checksum | **WS-CAN-0017 / WS-OBJ-304 / SOTA B14** | "end-to-end checksum, byte-count/Range validation…" |
| Corrupt L1 never revalidated or removed | **WS-CAN-0017** | its "L1 revalidation" clause |
| `_FORECAST_CACHE` key omits the model | **WS-CAN-0006** | the row quotes this exact key tuple |
| `force_wind_fallback` / `force_marine_fallback` persist | **WS-CAN-0022** | "persisted `force_*_fallback` keys" is one of its four named residuals |
| `useGridWorker` `onerror` / reply ordering | **WS-CAN-0008** | same file, same seam (with the §1a reachability caveat) |
| Substring route/exclusion matching | **WS-CAN-0059** (closed) | the `.js`/`.json` fix established the class; no live instance in the SW |
| Prod frontend serves an 85-day-old SW `BUILD_VERSION` | **WS-CAN-0039 / WS-OBJ-104 / A18** | owner-gated; re-measured twice |
| Stale worktrees polluting repo-wide grep | **WS-CAN-0055 / WS-OBJ-704** | hit once during this audit |
| Client `resolution` derived rather than served | **WS-CAN-0014** (closed) note on WS-CAN-0034 | already flagged on `backendWeatherServiceClientDiag.js:203-210` |
| No rendered-frame / pixel oracle | **WS-CAN-0018/0019** | the `test.fixme` block |

**Why §5 is NOT covered.** SOTA **A2** ("Model initialization time is correct") is the closest
contract row and is ❌ FAILS — but its **only** task, WS-CAN-0005, is scoped in its own row to
`store_helpers.py`, `normalizer.py` and `scheduler.py _pick_cycle`, i.e. the **backend** product
pipeline. Fixing WS-CAN-0005 to completion would leave §5 entirely intact, because the `om://` raster
lane fetches `map-tiles.open-meteo.com` directly and never touches the backend. WS-CAN-0029
(`freshness_sec`) is the backend point/grid response. WS-CAN-0010 + WS-CAN-0063 (measure-or-refuse,
both CLOSED) covered `routes/weather.py`, `routes/admin/system.py` and `TruthOverlay.js` — §5 is a
**new instance of that now-closed class at a site those closures did not touch**. WS-CAN-0034 lists
its provenance inputs explicitly (`gridVectorCount`, `productId`, `isEstimated`, `isSubstituted`,
`resolutionDeg`) — `reference_time` is not among them. SOTA **A1** is ✅ MET on LV-05/LV-06, both of
which are `/api/weather/point` and `/spot-ratings` payloads.

---

## 9. Full residue list (surfaces with no owning objective or task)

Everything found; the structured return carries only what survived a kill attempt.

1. `om://` model-run identity + time axis: guessed seed, one fetch per page, never refreshed,
   re-served to MapLibre with `last_modified_time: now` (§5).
2. `MISSING_OM_RUNS`: a declared run-blocking guard with zero writers (§6).
3. `marine_global.json`: written every cycle, read by nothing (§7a-2).
4. `wind_global.json`: 40 points produced vs ≥100 required at all three readers — the
   `stale_cache_recycled` degradation path is structurally unreachable (§7a-1).
5. `rawsurf_wind_cache_v3`: hydrate-only since `3cca47f1` (2026-06-08); marine and pressure siblings
   kept their writers (§3b).
6. The service worker has **zero** test coverage, and the E2E lane replaces `navigator.serviceWorker`
   with never-settling promises (§2e).
7. `WIND_CACHE` / `PRESSURE_CACHE`: no size bound, no eviction; `WIND_CACHE` additionally scans the
   whole unbounded Map on every miss (§4).
8. `SPOT_CACHE_NAME` (Cache API): unbounded entry count keyed by float bbox query strings; quota
   errors swallowed (§2d).
9. `public/maplibre-gl-worker.js`: hand-committed 457 KB vendor asset, one reference, no checksum or
   version guard; ships alongside the inlined blob (§1b). Latent, not live.
10. Six unreachable modules: `GridParserWorker.js`, `useGridWorker.js`, `usePressureEngine.js`,
    `engine/workers/forecast-decode-worker.js`, `utils/tileCache.js`, `utils/offlineGallery.js` —
    two of which carry storage side effects, and one of which (`offlineGallery`) leaves the SW
    performing a per-request lookup in a cache nothing can write, exempted from deploy purge.
11. `_l2_negative_cache`: never popped or cleared (§7b).
12. `fetchModelMetadata` is called with a 4th `signal` argument it does not accept, so the metadata
    fetch is unabortable (§5-ii).
13. `useIPGeolocation.js:193` calls bare `sessionStorage.clear()`, wiping other consumers' keys
    including the chunk-reload guard (§3c).
14. `_conditions_cache` / `_surf_spots_response_cache`: the 500/100 caps prune only already-expired
    keys, so an all-live population exceeds them without bound (§7c).
15. `_GEOMETRY_CACHE` unbounded; `_TIDE_CACHE` full `.clear()` on overflow (§7c).
16. `MODEL_METADATA_CACHE` is never invalidated and is keyed by model folder alone (§4, §5).

---

## 10. What this area is already good at (recorded so it is not re-litigated)

* **Deploy-scoped cache names.** Four of five SW caches carry `BUILD_VERSION`; `activate` deletes
  everything off the keep-list. The one unversioned cache is deliberate and commented.
* **Refusal over poisoning.** `service-worker.js:116` refuses to cache a non-`ok` spots response
  because a cold-start 502 would otherwise be served as "spots"; the fallback path tags itself
  `X-SW-Cache-Fallback: 1` so the client can tell a cold start from real offline. Both carry the
  motivating incident in-file.
* **The localhost SW guard** (`index.js:320-331`) unregisters and purges rather than trusting a dev
  to hard-reload — with the lost debugging session recorded as the reason.
* **The stale-bundle self-diagnosis.** `update-sw-version.js` stamps the same hash into the SW *and*
  the bundle, and `marineForensics.js:91-95` cross-checks them at runtime and prints one loud line.
* **Strided-read cache identity.** `filename#sN` keeps a decimated grid out of a full-grid
  consumer's hands, with the hazard spelled out above the line that prevents it.
* **`_FORECAST_CACHE`** — true LRU *and* a per-entry TTL stored with the entry, so a mid-incident TTL
  change cannot retroactively extend absences already banked. A subtler correctness property than
  most caches here attempt.
* **Dual-bound product cache.** Count *and* vector budget, so one mid-resolution product cannot
  silently multiply resident memory.
* **`modelProvenance.describeStaleHour` refuses on placeholder data** rather than manufacture a false
  banner — the codebase already knows `MODEL_METADATA_CACHE` ships guesses (§5).
