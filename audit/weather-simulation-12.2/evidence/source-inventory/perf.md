# AREA INVENTORY — PERFORMANCE · CAPACITY · STORAGE · COST (Audit 12.2 §23)

**Repo:** `C:\Users\dprit\Raw-Surf` · branch `dev` · HEAD `791fdf78`
**Mode:** READ-ONLY on all production source. No commits, no pushes, no dispatches, no installs.
**Measurement environment:** local working tree + local Python
(`~/AppData/Local/Python/bin/python3.exe`). **No production load test was run** — prior audits
(11.0 §6, 11.2 §4, 12.0 compliance ledger) prohibit it and this audit inherits that prohibition.
**No credential VALUES are reproduced anywhere in this file.** One pre-existing committed-secret
site was encountered incidentally during a keyword grep and is named by file only, never by value:
`BRAIN_RULES.md` (and its twin `.antigravityrules`) — already tracked as **WS-CAN-0021**.

---

## 0. METHOD, AND HOW EVERY COUNT IN THIS FILE WAS PRODUCED

The audit brief forbids an exact count in prose without the command that produced it, and requires
that every "there is no X" be paired with a positive control from the same file or directory. Both
rules are honoured below; the positive controls are listed inline with the claims they guard.

### 0.1 Commands used for the physical measurements

| # | Measurement | Command | Result |
|---|---|---|---|
| M-01 | forecast cache footprint | `du -sh backend/uploads/forecast_cache` | **276K** |
| M-02 | forecast cache file count | `find backend/uploads/forecast_cache -type f \| wc -l` | **2** |
| M-03 | forecast cache contents | `ls -la backend/uploads/forecast_cache` | `marine_global.json` 204,796 B · `wind_global.json` 72,833 B |
| M-04 | **real** product cache footprint | `du -sh backend/uploads/weather_products` | **615M** |
| M-05 | product cache file count | `ls backend/uploads/weather_products \| wc -l` | **6,297** |
| M-06 | all upload dirs | `du -sh backend/uploads/*` | weather_products 615M · feed 138M · gallery 115M · stories 44M · general 33M · avatars 7.2M · chat_media 2.5M · forecast_cache 276K · crew_chat 6.0K |
| M-07 | total uploads | `du -sh backend/uploads` | **953M** |
| M-08 | frontend JS, maps excluded | `find static/js -name '*.js' -not -name '*.map' -printf '%s\n' \| awk '{s+=$1} END {print s}'` | **9,038,774 B (8.62 MiB)** |
| M-09 | frontend sourcemaps | `find static -name '*.map' -printf '%s\n' \| awk '{s+=$1} END {print s" ("NR" files)"}'` | **33,420,587 B (31.87 MiB), 105 files** |
| M-10 | largest single chunk | `find static/js -name '*.js' -not -name '*.map' -printf '%s %p\n' \| sort -rn \| head -1` | `6770.db8f084f.chunk.js` = **1,378,701 B** |
| M-11 | total build dir | `du -sh frontend/build` | **54M** |
| M-12 | root static assets | `find frontend/build -maxdepth 1 -type f -printf '%s %p\n' \| sort -rn` | `ne_50m_land.json` 2,764,441 B · `maplibre-gl-worker.js` 457,880 B · `logo.svg` 304,350 B · `ne_110m_land.json` 219,362 B · `logo.png` 114,017 B |
| M-13 | CSS | `find static/css -name '*.css' -printf '%s %p\n' \| sort -rn \| head -1` | `main.cb7944ef.css` = 269,178 B |
| M-14 | media dir | `du -sh static/media` | 8.8M |
| M-15 | precompressed assets present? | `find frontend/build -name '*.gz' -o -name '*.br'` | **none** (Netlify compresses at the edge) |

⚠️ **M-08..M-15 measure a LOCAL build artifact, not the deployed one.** `frontend/build` is
gitignored (`git check-ignore -v` → `frontend/.gitignore:12:/build`; `git ls-files frontend/build`
returns 0 rows). Netlify runs the same `npm run build` (`netlify.toml` `[build] command`), so the
*shape* transfers; the *bytes* are what this tree's build command produces at HEAD. The production
frontend is separately known to be frozen at `3bd38a83` (2026-05-20).

### 0.2 The size-of-a-cache-entry computation (M-16)

`OpenMeteoProvider._GRID_CACHE` has no byte accounting, so the entry size was **derived from the
serving path's own declared caps**, using the same deep-`getsizeof` method `series_vector_budget.py`
uses to price a vector (its docstring: *"1,226 B deep getsizeof"*).

Caps read from source, not assumed:
* `grid_series_helper.py:343` — `while len(lats) > 500 and resolution != steps[-1]:` ⇒ **≤ 500 coords per grid fetch**
* `grid_series_helper.py:350` — `forecast_days = min(16, max(3, (max_h // 24) + 2))` ⇒ **≤ 16 days = 384 hourly steps**
* `open_meteo_provider.py:471` — `if len(self._GRID_CACHE) >= 50:` ⇒ **≤ 50 entries**

```
one coord entry, 4 marine variables + time array, 384 steps → deep getsizeof =  66,664 B
× 500 coords (the serving path's own cap)                                   =   31.8 MB per cache entry
× 50 entries (the cache's own cap)                                          = 1.55 GB
```
Against the **2,048 MB cgroup** measured by `/api/health` (`limit_source: cgroup`, LV-07/11.1).

⚠️ **This is a CEILING the code admits, not an observed occupancy.** Real responses may carry fewer
variables, fewer days, and interned time strings. Whether the cache ever fills is **not measured**
and cannot be measured without a production load test. The honest claim is: *the cap admits up to
1.55 GB on a 2,048 MB box, and nothing in the cache prices it.* The parallel is exact and is
recorded in the codebase itself — `store.py:307-314` says the old 128-**item** product-cache limit
"≈ 1.5-1.9GB, the EXACT resident plateau measured … before every one of the 29 oomKilled events on
2026-07-05", and was replaced by a **vector-weighted** budget. `_GRID_CACHE` never got that fix.

### 0.3 Absence claims and their positive controls

| Absence claim | Search | Result | Positive control (same file/dir, proving the search works) |
|---|---|---|---|
| No `PerformanceObserver` / long-task instrumentation in the client | `git grep -n "PerformanceObserver\|longtask\|long-task" -- frontend/src` | **0 hits** | same grep found `requestIdleCallback` at `marineGridSeries.js:217`, `windGridSeries.js:116` |
| No JS-heap read in the client | `git grep -n "performance.memory\|usedJSHeapSize\|jsHeapSize" -- frontend/src` | **0 hits** | `git grep -c "performance.now" -- frontend/src` → **12 files** |
| No rate limiting on weather/conditions routes | `grep -c "rate_limit" backend/routes/weather.py` | **0** | `grep -c "@router.get" backend/routes/weather.py` → **10 routes exist**; `rate_limit_check(` found at exactly 3 sites, all in `auth_pkg/auth.py` (:108 :363 :545) |
| No `Cache-Control` on weather responses | `grep -c "Cache-Control" backend/routes/weather.py backend/routes/surf_data/conditions.py` | **0, 0** | `grep -c "Cache-Control" backend/routes/uploads/core.py` → **2** |
| No shared/pooled httpx client | `git grep -n "_CLIENT\b\|shared_client\|_http_client\|limits=httpx.Limits\|Limits("  -- backend` | **0 hits** | `git grep -n "httpx.AsyncClient(" -- backend \| grep -v test \| wc -l` → **33 instantiations** |
| No upstream-provider call counter | `git grep -rn "upstream_calls\|provider_calls\|api_call_count\|calls_today" -- backend/services/weather_pipeline` | **0 hits** | module-level counters DO exist and are found by this technique: `store.py:67 _l2_write_skips = 0`, `:78 _l2_write_skips += 1` |
| No executor sizing | `git grep -n "set_default_executor\|ThreadPoolExecutor\|max_workers" -- backend \| grep -v test` | **0 hits outside `backend/scripts/`** (all 15 hits are one-off scripts) | the same grep returns `backend/scripts/build_shore_normals.py:403 cf.ThreadPoolExecutor(max_workers=WORKERS)` |
| No uvicorn concurrency cap | `git grep -rn "limit_concurrency\|limit-concurrency\|limit_max_requests"` | **0 hits** | `git grep -c "uvicorn" -- render.yaml` → **1** |
| No load-testing tool in the repo | `git grep -rn "k6\|locust\|wrk \|hey -n\|sustained load"` | 0 tooling hits; only audit prose | same grep returns `audit/weather-simulation-11.0/SYSTEM_CAPACITY_PROFILE.md:116` |
| `_GRID_CACHE`/`_POINT_CACHE`/stampede/single-flight/admission-control/multi-user never appear in the 12.0/12.1 audit corpus or the 11.0 master report | `grep -rn "_GRID_CACHE\|_POINT_CACHE\|stampede\|single-flight\|admission control\|multi-user\|per-user quota" audit/weather-simulation-12.0 audit/weather-simulation-12.1 MASTER_WEATHER_SIMULATION_REPORT_11.0.md` | **0 hits** | `grep -rln "conditions/batch" audit/weather-simulation-12.1` → **5 files** |
| `tileCache.js` has no importers | `git grep -rn "utils/tileCache\|from './tileCache'\|require.*tileCache" -- frontend/src frontend/e2e` | **0 hits** | `git grep -c "utils/logger" -- frontend/src` → many files |
| `offlineGallery.js` has no importers | `git grep -rn "utils/offlineGallery\|from './offlineGallery'" -- frontend/src frontend/e2e` | **0 hits** | same control as above |
| Only one relative-path `/api` fetch in the client (i.e. essentially nothing uses the Netlify proxy) | `git grep -n "fetch('/api/\|fetch(\`/api/\|fetch(\"/api/" -- frontend/src` | **1 hit**, `marineRequestGovernor.js:267`, to `/api/weather/grid-legacy-proxy-disabled` | absolute-form fetches ARE found by the sibling grep (`GoLiveModal.js`, `LayerAccessResolver.js`, `TruthOverlay.js`, …) |

---

## 1. THE STRUCTURAL PICTURE — one process, no admission control

The audit brief asked the key structural question directly. Here is the answer, read from source.

### 1.1 The serving process

* **One uvicorn worker.** `render.yaml:28` → `uvicorn server:app --host 0.0.0.0 --port $PORT`, no
  `--workers`. Corroborated independently by `docs/research/MASTER-AUDIT-10.0…md:106-107` ("carries
  no `--workers`, so there is exactly one") and `audit/weather-simulation-11.1/SYSTEM_CAPACITY_DELTA.md:6`
  ("Render standard, 1 uvicorn worker, cgroup limit 2,048 MB").
* ⚠️ **`render.yaml` is NOT applied** — its own header says so in three checked ways. The live start
  command therefore lives only in the Render dashboard and **cannot be verified from this repo**.
  Every statement in this section about the worker count is inherited from prior audits' *live*
  `/api/health` readings, not from `render.yaml`.
* **Middleware stack is three deep** (`server.py:483-499`): `GZipMiddleware(minimum_size=500)`,
  `CORSMiddleware`, `RequestTelemetryMiddleware`. **None of them limits concurrency, queues, or
  meters per client.**
* **Rate limiting exists but only for auth.** `backend/core/rate_limiter.py` is an in-memory
  per-IP limiter; its **only three call sites** are `auth.py:108` (signup 10/300 s), `:363` (login
  5/60 s), `:545` (change_pw 5/300 s). **Zero weather, conditions, grid, grid_series, point,
  spot-ratings or tides route is rate limited, and none requires authentication.**

### 1.2 Semaphores: which bound across requests and which do not

This is the crux. The codebase has six live semaphores. **Three are created inside the request
handler and therefore bound only that one request's fan-out. Three are module- or class-scoped and
therefore bound the whole process.** The distinction has never been stated in the program registers.

| Site | Scope | Default | Bounds N concurrent users? |
|---|---|---|---|
| `routes/surf_data/conditions.py:73` `sem = asyncio.Semaphore(_BATCH_CONCURRENCY)` | **per request** | 6 (`SPOT_RATINGS_CONCURRENCY`) | ❌ **no** — N users ⇒ 6 N concurrent upstream resolutions |
| `routes/weather.py:560` `sem = asyncio.Semaphore(max(1, _SPOT_RATINGS_CONCURRENCY))` | **per request** | 6 (same env var) | ❌ **no** |
| `services/weather_pipeline/grid_series_helper.py:557` `sem = asyncio.Semaphore(CONCURRENCY)` | **per request** | see `PREFETCH_CONCURRENCY`/module default | ❌ **no** |
| `services/weather_pipeline/mid_res_tier.py:199` `_LOAD_SEM` | module-global | 2 (`MARINE_MID_LOAD_CONCURRENCY`) | ✅ yes |
| `services/weather_pipeline/viewport_service.py:632` `type(self)._REVAL_SEMAPHORE` | class-level | 1 (`MARINE_REVAL_CONCURRENCY`) | ✅ yes |
| `services/weather_pipeline/wind_native_recovery.py:56` `_semaphore()` | module-global | env | ✅ yes |
| `services/weather_pipeline/prefetcher.py:120` | per warm-on-boot call | `_prefetch_concurrency()` | n/a (boot lane) |
| `services/weather_pipeline/spot_ratings.py:617` | per call | `concurrency` arg | ❌ no |
| `services/weather_pipeline/report_calibration.py:268` | per call | 8 | ❌ no (cron lane) |

The two module/class-scoped ones were both born from measured OOMs — their comments say so
(`viewport_service.py:625-629`: *"the per-key `ACTIVE_REVALIDATIONS` dedup does NOT bound CONCURRENCY
across keys … the 512MB 1-CPU serve box OOMs"*). **The same reasoning was never applied to the
serving routes.** `conditions.py:42-47` explicitly reasons about the bound as a *per-request* cap
("the 200-spot cap mirrors its `le=200`, and the semaphore reads the SAME env var so one number
governs both call sites") — correct within a request, silent across requests.

### 1.3 Single-flight: present in one lane, absent in the other

* **Present:** `viewport_service.py:53-67, 260-266, 319-325` — `IN_FLIGHT_REQUESTS` +
  `IN_FLIGHT_LOCK` + `ACTIVE_REVALIDATIONS`. Concurrent identical viewport-grid asks join one
  fetch. Consumed by `viewport_helper.py:356,494,512`, `grid_resolver.py:319,407`,
  `mid_res_tier.py:295-303`.
* **Absent:** `OpenMeteoProvider.fetch_point` (`open_meteo_provider.py:570-651`) and
  `fetch_grid` (`:281-291, 471-474`). Read-check-miss-fetch-store, **no lock, no in-flight map**.
  N concurrent identical asks ⇒ N upstream calls.
* **The caller shape makes this a textbook stampede.** The only production caller of
  `/api/conditions/batch` is `frontend/src/hooks/useExploreData.js:29`, fed by
  `:58-60` — `response.data.popular_spots.slice(0, 4).map(s => s.id).join(',')`. **Every user on
  the Explore page requests the SAME four spot ids.** With a 300 s cache TTL
  (`open_meteo_provider.py:191`) and a measured p50 of 52-59 s for that route (LV-07), the
  duplicate-work window is ~17-20% of the TTL, during which every arriving user does the full
  upstream work again.
* The system already carries the scar tissue of this class: the **shared 429 circuit breaker**
  (`open_meteo_provider.py:193-227`) was built in 2026-07-24 precisely because *"a storm of
  POST /v1/marine that all 429, each retrying with 8·attempt backoff … up to 120 s HELD per
  request"* restarted the box. The breaker mitigates the *symptom* (it fails fast once upstream
  says stop); it does not prevent the duplicate work that produces the storm.

### 1.4 Is the forecast cache per-process, per-disk, or shared?

**All three, in three different layers, and only one of them is the directory the brief named.**

| Layer | Where | Scope | Bound | Measured? |
|---|---|---|---|---|
| L0 provider response cache | `OpenMeteoProvider._GRID_CACHE` / `._POINT_CACHE` (class attributes) | **per process** — shared by all users on the single worker | **50 / 200 ENTRIES**, TTL 300 s, FIFO eviction (`next(iter(...))`, no re-insert on hit) | ❌ **no byte accounting at all** |
| L1 parsed-product cache | `store.ProductStore._product_cache` | per process | `_PRODUCT_CACHE_LIMIT=128` **AND** `_PRODUCT_CACHE_VECTOR_BUDGET=120000` vectors | ✅ vector-weighted, TTL 300 s |
| L1 disk | `backend/uploads/weather_products` | per container disk (**ephemeral on Render**, `store.py:271`) | **no size bound**; TTL prune only (`dynamic_index.prune_expired`) | ✅ size reported by `/api/weather/status.cache_telemetry.disk_usage_bytes` (`weather.py:655-668`) — reported, never acted on |
| L2 object storage | Supabase Storage | shared across deploys | manifest prune (future-dated >30 d, `store.py:522-547`) | partially (`admin/system.py:83-95` sums bucket bytes) |
| `forecast_cache/` | `backend/uploads/forecast_cache` | per container disk | 2 fixed files, overwritten | trivially bounded |

**On the brief's specific ask:** `backend/uploads/forecast_cache` is **276K / 2 files** (M-01..M-03).
It is **not the main cache**. It is a *stale-recycling fallback*: `wind_ingestion.py:189-190,
303-304` load `wind_global.json` and **time-shift it** when the live global-coarse fetch fails
(`_cache_basis = {"type": "stale_cache_recycled", "method": "time_shifted_forecast_cache"}`,
`wind_ingestion.py:240`). `forecast_ingester.py:10` owns the directory. The cache that actually
costs disk is `weather_products` at **615M / 6,297 files** (M-04/M-05).

### 1.5 Does a cold cache stampede? — yes, on three independent counts

1. **No single-flight** on the provider caches (§1.3).
2. **No cross-request semaphore** on the serving routes (§1.2), so the fan-out multiplies with users.
3. **No admission control anywhere** (§1.1), so nothing sheds load; the queue is the event loop.

A fourth, quieter multiplier: **the default `asyncio` thread executor is never sized.**
`asyncio.to_thread` is used at **105 non-test sites** in `backend/` (`git grep -n "asyncio.to_thread" -- backend | grep -v test | wc -l`),
including on the hot serving path (`weather.py` ×10, `health.py` ×3, `grid_resolver.py` ×5,
`grid_resolver_surf.py` ×5, `mid_res_tier.py:208` for the full-product parse). `to_thread` routes to
`loop.run_in_executor(None, …)`, i.e. Python's default `ThreadPoolExecutor`, whose size is
`min(32, (os.cpu_count() or 1) + 4)`. **`set_default_executor` is called nowhere** (positive control
in §0.3). So every blocking disk read, Supabase L2 fetch and Pydantic parse in the whole process
shares one pool of unstated size, and `os.cpu_count()` is **cgroup-unaware** — on a container it
reports host CPUs, so the pool may be either far too small (serialising the box) or oversubscribed
relative to the CPU quota. Nobody has stated which, and it is not on any register.
Note this is **distinct** from Starlette's `run_in_threadpool` anyio limiter (40 tokens) — the two
pools are different and neither is configured here.

Also: **33 separate `httpx.AsyncClient(...)` instantiations** across `backend/` (non-test), including
`open_meteo_provider.py:379, 622` — one client constructed *per call*, so **no connection reuse**;
every upstream point/grid fetch pays a fresh TCP + TLS handshake. No `httpx.Limits` is configured
anywhere (positive control in §0.3).

---

## 2. FULL SURFACE INVENTORY

Reachability vocabulary per the brief. Justification is a call site, import edge or registration —
never a filename.

### 2.1 Backend serving routes

| ID | Surface | Reachability | Justification | Capacity property |
|---|---|---|---|---|
| SUR-BE-conditions-batch | `GET /api/conditions/batch` — `conditions.py:52-105` | **Active-reachable**, unauthenticated | client call `useExploreData.js:29`; router mounted via `routes/surf_data/__init__.py` | cap 200 ids; **per-request** sem 6; **p50 52-59 s** (LV-07, two audits) |
| SUR-BE-conditions-single | `GET /api/conditions/{spot_id}` — `:107-176` | Active-reachable | resolves geometry once, 6 forecast hours | 2 upstream resolutions per call (`:120` + `:126`) |
| SUR-BE-conditions-forecast | `GET /api/conditions/forecast/{spot_id}` — `:179-216` | Active-reachable | `days` **uncapped on input**, clamped to 10 at `:199` | 1 resolution, up to 10 days |
| SUR-BE-tides | `GET /api/tides/{spot_id}` — `:218-331` | Active-reachable; legacy NOAA branch is **Flag-gated-off** (`TIDES_GLOBAL_SOURCE=0`) | `:245` | httpx client per call (`:280`) |
| SUR-BE-spot-ratings | `GET /api/weather/spot-ratings` — `weather.py:~540-600` | Active-reachable | map glyph path, every viewport pan | viewport-bounded `limit<=200`; **per-request** sem 6 |
| SUR-BE-grid-series | `/api/weather/grid_series` → `grid_series_helper.py` | Active-reachable | `marineGridSeries.js:402,560`, `windGridSeries.js` | **per-request** sem; `OVERALL_DEADLINE`; **vector budget 80k** (`series_vector_budget.py`) |
| SUR-BE-grid | `/api/weather/grid` | Active-reachable | `backendWeatherServiceClient.js:506-509` | viewport single-flight applies |
| SUR-BE-point | `/api/weather/point` | Active-reachable | `backendPressureServiceClient.js:12`, `backendPrecipitationServiceClient.js:13` | p50 50 ms (LV-07) — **not** the latency problem |
| SUR-BE-weather-status | `GET /api/weather/status` — `weather.py:650-690` | Active-reachable | **measures** `disk_usage_bytes`, `memory_usage_mb`, `active_background_threads`; refuses on `provider_status`/`last_errors` | the only disk-footprint instrument |
| SUR-BE-health | `GET /api/health` — `health.py` | Active-reachable | `rss_mb`, `peak_rss_mb`, `limit_mb`, `peak_pct_of_limit`, `limit_source`, `disk_product_count`, `uptime_seconds`, `request_telemetry` | **the program's only capacity instrument** |

### 2.2 Backend capacity mechanisms

| ID | Surface | Reachability | Bound | Byte-priced? |
|---|---|---|---|---|
| SUR-BE-om-grid-cache | `OpenMeteoProvider._GRID_CACHE` `:189, 285-291, 471-474` | Active-reachable (serving path via `grid_series_helper.py:354`, `viewport_upstream.py:90`) | **50 entries**, TTL 300 s, FIFO | ❌ **no** — ceiling **1.55 GB** (M-16) |
| SUR-BE-om-point-cache | `._POINT_CACHE` `:190, 573-579, 647-650` | Active-reachable (`point_resolution.py:508-510`, `conditions.py:126`, `spot_conditions.py:266`, `estimator.py:555,575`) | **200 entries**, TTL 300 s, FIFO | ❌ no. NB `BATCH_MAX_SPOTS = 200` — one maximal batch exactly turns the cache over |
| SUR-BE-om-breaker | shared 429 circuit breaker `:193-227` | Active-reachable; kill `OPEN_METEO_BREAKER_DISABLED=1` | 30 s cooldown | mitigates the storm, not the duplication |
| SUR-BE-product-cache | `store._product_cache` `:295-315` | Active-reachable | 128 items **AND 120,000 vectors** | ✅ **exemplary** — vector-weighted after 29 oomKilled events |
| SUR-BE-series-budget | `series_vector_budget.py` | Active-reachable; kill `SERIES_VECTOR_BUDGET=0` | 80,000 vectors/response | ✅ **exemplary** — calibrated against measured HIT/MISS populations |
| SUR-BE-inflight | `viewport_service.IN_FLIGHT_REQUESTS` | Active-reachable | dedup by key | the single-flight that exists |
| SUR-BE-reval-sem | `_REVAL_SEMAPHORE` `:632` | Active-reachable | 1, cross-request | born from a measured OOM |
| SUR-BE-midres-sem | `mid_res_tier._LOAD_SEM` `:199` | Active-reachable | 2, cross-request | + `_CLIP_CACHE` (unbounded dict, `:198`) |
| SUR-BE-prefetcher | `prefetcher.py:114-120` | Active-reachable at boot | `_prefetch_max()` cap + `_prefetch_concurrency()` | 11.1 recorded `PREFETCH_CONCURRENCY` **unset on the box** ⇒ default 5 |
| SUR-BE-rate-limiter | `core/rate_limiter.py` | **Active-reachable but auth-only** — 3 call sites | 5-10 req/window per IP | ❌ no weather route uses it |
| SUR-BE-executor | Python default `ThreadPoolExecutor` via 105 `to_thread` sites | Active-reachable | `min(32, cpu_count()+4)`, **never set** | ❌ unstated, cgroup-unaware |
| SUR-BE-httpx | 33 `httpx.AsyncClient(...)` sites | Active-reachable | none — new client per call | ❌ no pool, no `Limits` |
| SUR-BE-telemetry | `services/request_telemetry.py` | Active-reachable; kill `REQUEST_TELEMETRY=0` | `MAX_ROUTES=200`, 12 log-scale latency buckets | **latency only — no bytes, no in-flight gauge, no concurrency** |
| SUR-BE-l1-disk | `uploads/weather_products` | Active-reachable | **no size bound**; TTL prune `dynamic_index.py:49-75` | 615M / 6,297 files locally (M-04/05); ephemeral on Render |
| SUR-BE-forecast-cache | `uploads/forecast_cache` | **Fallback-only** — `wind_ingestion.py:189,303` on live-fetch failure | 2 files, overwritten | 276K (M-01) |
| SUR-BE-event-loop-guard | `tests/test_event_loop_offload_guard.py` | **Test-only** (AST guard) | bans blocking L2 loaders on the loop | the only main-thread-blocking guard in the system, and it is server-side |

### 2.3 Frontend / browser surfaces

| ID | Surface | Reachability | Capacity property |
|---|---|---|---|
| SUR-FE-apiclient | `lib/apiClient.js:27-32` | Active-reachable (every REST call) | **`timeout: 60000`**; base URL is the **absolute Render origin** (`DEFAULT_BACKEND_URL`), so `/api/*` Netlify proxy is bypassed |
| SUR-FE-warmup | `apiClient.js:44-47` | Active-reachable at module import | fire-and-forget `GET /api/health` on **every page load**, before React renders |
| SUR-FE-marine-pager | `marineGridSeries.js:144-156, 654-660` | Active-reachable | `PAGE_SPAN_HOURS=144` (cheap) vs `HEAVY_PAGE_SPAN_HOURS=48`; `lastPageFor` ⇒ **3 pages cheap / 8 pages heavy**, fired in a loop at `:658-659`; client sem `MARINE_SERIES_MAX_CONCURRENT = 2`; local abort 45 s (`:432`) |
| SUR-FE-wind-pager | `windGridSeries.js:36, 66-68` | Active-reachable | `LAST_PAGE = 2` ⇒ 3 pages; `WIND_SERIES_MAX_CONCURRENT = 2`; abort 15 s |
| SUR-FE-om-protocol | `openMeteoProtocol.js` | Active-reachable | `DECODED_TILE_CACHE` **`MAX_CACHE_SIZE = 150`** entries (`:144-148`) — **count-bounded, not byte-bounded**; `MISSING_OM_RUNS`/`MISSING_OM_TILES` unbounded `Set`s (`:20-21`) blocking 404 storms |
| SUR-FE-radar-tilecache | `radarTileRecolor.js:307, 365-367` | Active-reachable | `_tileCache` Map, `TILE_CACHE_MAX`, oldest-by-ts eviction — holds `ArrayBuffer`s, count-bounded |
| SUR-FE-tile-streaming | `engine/tile-streaming-system.js:25, 100-108` | **Dead / Legacy-unreachable** — `git grep -rn "tile-streaming" -- frontend/src frontend/e2e` returns exactly **one** hit and it is a docstring mention (`engine/data/forecast-pipeline.js:7`), not an import. Positive control: sibling engine modules DO have import edges (`MapWebGL.js:39-43`, `WeatherEngine.js:3` → `forecast-pipeline`) | LRU by `accessTime`, `MAX_CACHE_SIZE` — a *third* dead cache bound |
| SUR-FE-ratings-cdn | `spotRatingsCdn.js` | Active-reachable; kill `__RAW_DISABLE_RATINGS_CDN__` / `REACT_APP_RATINGS_CDN=0` | ✅ **explicitly costed in-source**: "~1MB raw / ~150KB gzip", "One object download per `CB_BUCKET_MS` (5 min) window serves EVERY pan/zoom/model-switch/scrub" — **the box is bypassed entirely** |
| SUR-FE-gpu-accounting | `WebGLMarineEngine.js:101-111`; writes in `WebGLMarineTextureState.js:80`, `WebGLMarineTextureEncoder.js:666,732`, `WebGLWindUtils.js:291-292` | Active-reachable | `gpuMemoryEstimate` (arithmetic `w*h*4`), `textureCount`, `textureUploadCount`, `droppedFrameCounter` (`WebGLMarineEngine.js:2317`) — **GPU memory IS accounted**, and the accounting was itself repaired (`WebGLWindUtils.js:256-272`: 18 call sites vs 2 decrements ⇒ +2.63 textures/gesture drift, "IT WAS NOT A LEAK — IT WAS THE ACCOUNTING") |
| SUR-FE-device-tier | `deviceTier.js:31` (`hardwareConcurrency <= 4`), consumers `GPUMarineLayer.js:312-315`, `WebGLMarineLayer.js:13,844`, `WebGLWindLayer.js:15` | Active-reachable | particle pool 500/1000/1200/2200 by tier — **the only mobile-constraint mechanism**; `WindParticleOverlay.js:233` still uses the raw `innerWidth < 768` test `deviceTier.js` exists to replace |
| SUR-FE-sw-spot-cache | `public/service-worker.js:108-125` | Active-reachable | network-first `cache.put` for `OFFLINE_API_PATTERNS` (`/api/surf-spots`, `/api/surf-spots/search`, `/api/spots-in-bounds`) — **no size bound, no eviction, no trim** (grep for `MAX\|limit\|trim\|estimate` in that file: 0 hits) |
| SUR-FE-sw-exclusions | `service-worker.js:95-104` | Active-reachable | `/weather` and `/marine` paths are **deliberately excluded** from SW caching ⇒ weather responses are never SW-cached; and the backend sets **no `Cache-Control`** on them (§0.3) ⇒ **every weather response is a fresh download** |
| SUR-FE-tilecache-idb | `utils/tileCache.js` — IndexedDB, `MAX_AGE_MS` 7 d, `_MAX_CACHE_SIZE = 500` | **DEAD** — 0 importers (positive control in §0.3). Also `_MAX_CACHE_SIZE` is referenced **only at its own declaration** (`:12`), while `MAX_AGE_MS` is used at `:75` and `:126` — the size bound is dead even inside a dead module | — |
| SUR-FE-offline-gallery | `utils/offlineGallery.js` — `MAX_CACHE_BYTES = 500 * 1024 * 1024` | **DEAD** — 0 importers. But `GALLERY_CACHE_NAME` **is** live in the SW (`service-worker.js:7, 165-190`), which reads a cache nothing ever writes ⇒ a `caches.match` on every Supabase `/storage/` request that can only miss | — |
| SUR-FE-telemetry-uplink | `TruthOverlay.js:141` | Active-reachable | the **only** client→server transport; already tracked (WS-CAN-0020, blocked on WS-CAN-0063 — now closed) |
| SUR-FE-longtask | — | **ABSENT** | 0 `PerformanceObserver` in `frontend/src` |
| SUR-FE-heap | — | **ABSENT** | 0 `performance.memory` / `usedJSHeapSize` in `frontend/src` |
| SUR-FE-bundle | `frontend/build` (local artifact) | n/a | 8.62 MiB JS + **31.87 MiB sourcemaps (105 files)**; largest chunk 1.31 MiB; `ne_50m_land.json` 2.64 MiB at the web root; `GENERATE_SOURCEMAP` set nowhere ⇒ CRA default `true` |

### 2.4 Test estate for this area

`ls backend/tests | wc -l` → **497** files. Filtered by
`ls backend/tests | grep -iE "perf|load|capacity|memory|concurren|soak|stress|bench"`, the
**only** relevant ones are:

* `test_health_peak_memory.py` — the `peak_rss_mb` instrument
* `test_event_loop_offload_guard.py` — AST ban on blocking loaders inside `async def`
* `test_manifest_concurrent_merge.py` — manifest write concurrency
* `test_series_load_stride.py` — the vector-budget stride
* `test_scheduler_dispatch_offload.py` — scheduler offload
* `test_spot_conditions_batch_bounds.py` — the batch route's **per-request** cap and semaphore

Frontend: `ls frontend/e2e` → `booking-flow.spec.js`, `weather-simulation.spec.js`, `pngPixels.js`,
`_diag_maploader.mjs`. **No frame, soak, memory or load spec.**

**There is no sustained-load, soak, or multi-user test anywhere in the repo**, and no load-testing
tool is vendored (positive control §0.3). This is *already disclosed*: 11.0 `SYSTEM_CAPACITY_PROFILE.md:116`
("**no load test was run against production**"), 11.0 `OPEN_QUESTIONS_AND_BLOCKERS.md` **B-09**,
11.2 §4, and SOTA **B3**. **It is therefore NOT reported below as a new gap.**

---

## 3. WHAT IS ALREADY MEASURED (recorded so it is not re-litigated)

| Quantity | Instrument | Status |
|---|---|---|
| Per-route p50/p90/p99/max, 5xx counts | `/api/health.request_telemetry` | ✅ live, bounded cardinality, self-disclosing about bucket-upper-bound semantics |
| Process RSS + **peak** RSS + cgroup limit + `limit_source` | `/api/health.memory` | ✅ live; `limit_source` distinguishes MEASURED from ASSUMED |
| Cache **disk bytes** + file count + thread count | `/api/weather/status`, `/api/health.disk_product_count` | ✅ live |
| Per-response **vector** cost | `series_vector_budget.py` | ✅ calibrated from measured HIT/MISS populations |
| Process-wide product-cache **vector** budget | `store.py:314` | ✅ born from 29 measured oomKilled events |
| GPU texture count + memory estimate + dropped frames | `window.__RAW_GPU__` | ✅ present, and the accounting drift was itself found and fixed |
| Ratings CDN transfer cost | `spotRatingsCdn.js` header | ✅ costed in source; bypasses the box entirely |
| Range-streamed GRIB2 ingestion efficiency | SOTA contract "already state of the art" | ✅ 0.72% of bytes vs 16.83% naive |
| Web-vitals + wire bytes + RSS delta per request | 11.0 §5, 11.1 `SYSTEM_CAPACITY_DELTA.md` | ✅ measured **ad hoc**, not instrumented |
| ⚠️ Frame rate | — | **RETRACTED** program-wide; WS-CAN-0037 |
| ⚠️ Browser JS heap | 11.0 §5: "130 – 339 MB … GC-dominated, **inconclusive**" | measured once, inconclusive, **no standing instrument** |

---

## 4. CANDIDATE OMISSIONS THAT DID **NOT** SURVIVE (killed against the registers)

The brief requires reporting these; they are a first-class result.

| Apparent concern | Killed by | Why |
|---|---|---|
| "No sustained-load / p50-p99-under-load measurement exists" | **WS-OBJ-302** (Required Closure Evidence: *"A sustained-load p50/p99 per route"*) + **SOTA B3** + 11.0 B-09 | Registered, and production load testing is *prohibited* by the audit series' own scope. Not new. |
| "Peak RSS has only been read on short windows; 87.0% vs 60.7% is not a trend" | **WS-OBJ-303** (Blocker: *"short measurement windows only"*; Next action: *"Measure under load before concluding"*) | Stated verbatim in the register. |
| "`/api/conditions/batch` p50 is ~1 minute" | **WS-CAN-0064** | Opened by 12.1 from LV-07. Do not re-report. |
| "`/conditions/*` returns 200 with an error body" | **WS-CAN-0009** | 9 sites, tracked. |
| "Frame rate cannot be measured, so no render-perf claim is possible" | **WS-CAN-0037** + **SOTA B4** | Tracked; blocked-then-unblocked by WS-CAN-0027 (now closed). |
| "The `WeatherTelemetry` RAF runs forever with no cancel" | **WS-CAN-0022** (+ LV-04 `activeRafCount = 1` with `activeLayers = []`) | Tracked; SOTA A11. |
| "Ocean-mask classifier costs ~27% of panning" | **WS-CAN-0032** | Shipped in shadow, deliberately default-off pending a human look. |
| "Particle advection is not dt-normalized ⇒ hardware-dependent motion" | **WS-CAN-0011** | Tracked, deferred behind WS-CAN-0037. |
| "WebGPU / OffscreenCanvas / SharedArrayBuffer would help" | **WS-CAN-0050** + **SOTA C7** | Deferred *three times*; explicitly blocked on a measured bottleneck + WS-CAN-0037. Do not reopen. |
| "Zarr / Kerchunk / COG / Dask would cut access latency" | **WS-CAN-0046** + **SOTA C8** | **Rejected three times**; 11.2's reframe stands (the backend contract is strong; the client discards it). |
| "The worker can crash and freeze a lane" | **WS-CAN-0008** | `onerror` present at HEAD; only the reply-ordering test remains. |
| "GPU lifecycle leaks textures across zoom gestures" | **WS-CAN-0013** + `WebGLWindUtils.js:256-272` | Investigated and **refuted** — it was the accounting, since fixed at the single choke point. |
| "The only client→server transport is one throttled POST" | **WS-CAN-0020** + SOTA B5 | Tracked; its `fps` fabrication was WS-CAN-0063, now closed. |
| "No external uptime probe / instrument delivery unmeasured" | **WS-CAN-0025** | Built and proven live; one owner heartbeat URL outstanding. |
| "Backend cache disk size is unmeasured" (11.0 §6 said so) | `/api/weather/status.cache_telemetry.disk_usage_bytes` (`weather.py:655-668`) | **The 11.0 line is now STALE** — it is measured. What is missing is a *bound*, reported below as G-12. |
| "Committed API key in `BRAIN_RULES.md`" | **WS-CAN-0021** | Tracked. Named here by file only. |

---

## 5. CANDIDATE GAPS THAT SURVIVED

Full text in the structured return. Summary, ordered by severity:

| ID | Claim | Sev | Disposition |
|---|---|---|---|
| G-01 | Every concurrency bound on a *serving* route is constructed **inside the request handler**; nothing bounds concurrency **across** requests, and no weather route is authenticated, rate-limited or queued | Critical | Add Task under WS-OBJ-302 |
| G-02 | `OpenMeteoProvider`'s point/grid caches have **no single-flight**, and the only production caller sends an **identical spot-id set for every user** ⇒ perfect stampede shape | High | Add Task under WS-OBJ-302 |
| G-03 | Those same caches are bounded by **entry count with no size weighting** — the exact defect `store.py` fixed after 29 oomKilled events. Ceiling **1.55 GB** on a 2,048 MB cgroup (M-16) | High | Add Task under WS-OBJ-303 |
| G-04 | `/api/conditions/batch`'s p50 (52-59 s) is **87-98% of the client's own 60 s axios abort** | High | Expand WS-CAN-0064 |
| G-05 | The default `asyncio` executor is never sized; 105 `to_thread` sites share it; `os.cpu_count()` is cgroup-unaware | Medium | Add Task under WS-OBJ-302 |
| G-06 | Upstream provider quota is reasoned about in comments (a 5k/hour cap is named) but **never counted** | Medium | Add Task under WS-OBJ-302 |
| G-07 | Browser JS heap and main-thread blocking have **zero standing instrumentation**; WS-OBJ-303 is scoped to the Render cgroup | Medium | Expand WS-OBJ-303 |
| G-08 | `request_telemetry` records **latency only** — no response bytes, no in-flight gauge ⇒ transfer/egress per model run and per forecast hour is uninstrumented | Medium | Expand WS-OBJ-302 |
| G-09 | The heavy-class page span (**8 pages vs 3**) is justified in-source by a Netlify `/api/*` proxy window that **provably does not govern that path** | Medium | Verify |
| G-10 | **Three** browser-storage/cache size bounds live in modules with **zero importers**; the one live browser cache (SW spot cache) is unbounded | Low | Add Task under WS-OBJ-303 |
| G-11 | 31.87 MiB of sourcemaps (105 files) in the published build; `GENERATE_SOURCEMAP` set nowhere | Low | Monitor |
| G-12 | No **size** bound on the L1 product-cache disk; the size is measured and never acted on | Low | Monitor |

---

## 6. HONEST LIMITS OF THIS PASS

1. **No production measurement was taken.** Every latency/RSS figure quoted is inherited from
   LV-07 / RV-01 / 11.1, cited as such. Nothing here re-measures production.
2. **`render.yaml` is not applied**, so the live worker count, the live `SPOT_RATINGS_CONCURRENCY`,
   `PREFETCH_CONCURRENCY`, `PRODUCT_CACHE_LIMIT` and `MALLOC_*` values **cannot be read from this
   repo**. Where a default is quoted it is the *code* default, not a verified live value. 11.1
   recorded a live env read showing `PREFETCH_*`, `PRODUCT_CACHE_*`, `SERIES_VECTOR_BUDGET` and
   `MALLOC_*` all **unset** — that reading is 3 days old and is not re-verified here.
3. **M-16 is a ceiling derived from the code's own caps, not an observed occupancy.** Stated as such
   everywhere it appears.
4. **The frontend bundle numbers are a local build**, not the deployed artifact (§0.1).
5. **Dead-code classifications are import-edge claims, not behaviour claims.** `tileCache.js`,
   `offlineGallery.js` and `tile-streaming-system.js` have no import edge at HEAD in `frontend/src`
   or `frontend/e2e`. That is proven; what is *not* proven is that no build-time or dynamic
   `import()` reaches them by another route.
6. **No monetary figure appears anywhere in this file**, per the brief.
