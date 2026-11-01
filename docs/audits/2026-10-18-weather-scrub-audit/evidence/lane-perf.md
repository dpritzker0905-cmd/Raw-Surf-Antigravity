# Lane PERF — rendering + backend performance of heatmap forecast scrubbing

Audit-only. Baseline `origin/dev` f3ef50fb2 (worktree `audit-scrub-2026-10-18`). No tracked file changed, no git state
changed, no request sent to the live backend or dev site. Live numbers used: the `/api/health` capture supplied by the
lead (2026-10-19T02:20Z, uptime 10.5 h). Local measurements: two Python microbenchmarks in the scratchpad
(`bench_enc.py`, `bench_copy.py`; Python 3.14 + pydantic 2.14 on the owner's PC, NOT the Render box, NOT pydantic 2.11.7
/ FastAPI 0.110.1 as deployed — FastAPI is not installed locally, so `jsonable_encoder` was approximated by
`model_dump(mode="json")`, which is a LOWER bound on it). Prior offline evidence re-read from the untracked
`audit/repair-2026-10-04/` (PF03-DIAGNOSIS, CPU-PHASE-DIAGNOSIS, NATIVE-RENDERER-PROFILE).

Grades: **CONFIRMED** = read in code at the cited line (behaviour, not duration); **MEASURED** = a number from an
instrument, with its scope; **HYPOTHESIS** = inferred, needs the stated benchmark.

---

## 0. One-paragraph answer

Scrubbing itself (hour change with a warm page) is cheap and mostly client-side: an 11 Hz commit (ForecastWheel.js:64)
selects a cached frame (marineGridSeries.js:568), React commits it, and the engine re-encodes ~1-15 k vectors into
RGBA8 and `texSubImage2D`s them into the SAME resident textures (WebGLMarineTextureEncoder.js:452-458). The expensive
part is getting the pages: every 48-frame page is a JSON document of per-cell dicts (11 keys, ~150-235 B/vector raw)
assembled from 48 independent per-hour resolver calls, each of which (for the world/mid tier) json-parses a whole
stored product file and pydantic-validates it, then the default route returns a `dict` that FastAPI converts with
`jsonable_encoder` and Starlette gzips at level 9 — all on the single event loop of a 1-CPU box, with no cross-client
admission (the `serve_series` envelope is default-off). The client then `res.json()`s it on the main thread and keeps
~1 k-object arrays per frame. There is no worker, no binary payload, no temporal GPU interpolation and no server-side
precomputed series page. The ranked levers are: (1) stop rebuilding identical world pages per request (server page
cache / precomputed pages), (2) binary quantized payload, (3) direct serializer + lower gzip level, (4) client worker
decode with transferables, (5) GPU two-texture temporal blend. Details and falsifiable benchmarks below.

---

## A. Backend serve path

### A1. Request lifecycle (CONFIRMED unless noted)

`GET /api/weather/grid_series` (routes/weather.py:80-110)

1. `GRID_SERIES_RESPONSE_BOUNDS != "1"` (default) → `await build_grid_series(...)` returns a **dict**
   (weather.py:110). No `response_model`. FastAPI 0.110.1 (requirements.txt:1) therefore runs
   `jsonable_encoder(dict)` → `JSONResponse` (`json.dumps`) **on the event loop**, then `GZipMiddleware`
   (server.py:486, `minimum_size=500`, Starlette default compresslevel 9) compresses **on the event loop**.
   The flag-on path (`series_response.serve_series`) instead encodes with `TypeAdapter(dict).dump_json` + gzip-9 in
   `asyncio.to_thread` (series_response.py:62-74, 137) and adds per-process admission (1 page + 1 mini active, queue ≤4,
   series_response.py:77-118). Whether Render sets it: unknown (STATE.md says PF03/PF04 "remain open", flags off) —
   HYPOTHESIS: off in production.
2. `build_grid_series` → `_build_grid_series_impl` (grid_series_helper.py:280+). For GFS/ICON marine without
   `GFS_ICON_SERIES_FASTPATH=1` and EURO without `EURO_SERIES_LIVE_COPERNICUS=1`, the **generic per-hour loop** runs:
   hour 1 serially (warms, chooses the stride, :507-511), the other ≤47 via `asyncio.gather` under
   `Semaphore(CONCURRENCY=4)` (:38, :514), each `resolve_grid = routes.weather.get_grid` (the `/grid` route function
   called as a plain coroutine), each bounded by `PER_HOUR_TIMEOUT` 10 s and the 20 s `OVERALL_DEADLINE` (:170).
3. Per hour, `resolve_grid` (grid_resolver.py:114):
   - `await asyncio.to_thread(store.get_manifest)` (:159) — cached object.
   - `find_candidates` — a **linear scan of every manifest product, on the event loop** unless `GRID_RESPONSE_BOUNDS=1`
     (:160-169; grid_resolver_selection.py:27-58). The 10-04 audit reproduced this on a 20,007-entry manifest
     (MANIFEST-SCAN-RESULTS.md). Repeated 48× per page.
   - Mid tier (world/wide spans): `try_serve_mid_res_tier` (mid_res_tier.py:299+). With a series stride it calls
     `store.load_product(filename, stride=s)` in a thread under a 2-permit semaphore (:416, :475). With stride 1
     (`/grid`, the 1-hour mini page) it serves a clip-cache hit via **`copy.deepcopy(_hit)`** (:421-427).
   - `load_product_helper` (store_helpers.py:562-676): L1 in-memory product cache (TTL 300 s, ≤128 items, ≤120,000
     vectors total; store.py:357-374), key `filename#sN` for strided loads (:587); on miss: disk file (L2 Supabase
     download on cold, :633-660) → **`json.load` of the whole product file** (:669) → `_stride_raw_grid_dicts`
     → `NormalizedProduct.model_validate` (:676). The stride is applied to dicts BEFORE validation (good), but the full
     file is still parsed every miss.
   - `filter_grid_to_bbox` (route_helpers.py:306+) on the event loop: `sorted(set(v.lat …))`, `sorted(set(v.lng …))`
     over all vectors (:346-347) plus a filtering pass — Python object iteration per frame.
   - Back in `get_grid`: `fill_coarse_enclosed_sea_from_gfs_served` (EURO/ICON 10° only) and `apply_wind_lane`
     (wind only) (weather.py:158-159).
4. Per-hour decimation as each frame lands (`_apply_build_stride`, grid_series_helper.py:120-150), then the end-stage
   `apply_vector_budget` (series_vector_budget.py; budget 80,000 vectors/page, :51) — a 48-frame world page is
   46 × 21 = 966 vectors/frame (comment in marineSeriesFrame.js:95), ≈ 46 k vectors/page.
5. Response: `frames[].vectors` = the GridVector model objects themselves (grid_series_helper.py:532-549), serialized as
   11-key JSON objects (`gust`/`value` emitted as `null`, `phys_speed`/`speed_spread` omitted when None;
   schemas.py:11-51).

### A2. Payload format and sizes

- Format: JSON, array of objects per frame, full float precision of whatever the product stored (normalizer rounds
  speed/u/v to 4 dp, direction/period to 2 dp, normalizer.py:422-427). gzip negotiated by middleware. No
  quantization, no columnar layout, no binary. **CONFIRMED.**
- **MEASURED (local, synthetic, unrounded floats — a worst case):** 79,968 vectors (the 80 k budget) = 18.8 MB raw,
  235 B/vector; gzip-9 5.3 MB, gzip-1 8.2 MB. With the real 4-dp rounding expect ~150-170 B/vector raw. The 10-04 PF03
  run (76,800 distinct vectors, smoother fixture) gave 650 KB gzip-9 / 899 KB gzip-1 — real wave fields are smooth and
  compress far better than random data, so the wire size is fixture-dependent; the RAW size is not.
- Historical live: one unbounded world 48 h series = 6.67 MB on the wire (grid_series_helper.py comment, 2026-08-10).
  The 1-hour mini is ~36 KB (marineGridSeries.js:513 comment).
- Per world page today (HYPOTHESIS, arithmetic): 46 k vectors × ~160 B ≈ 7.4 MB raw JSON, ≈ 1-2 MB gzip-9.
- A uint16 × 4-channel (height, u, v, period) packing is 8 B/vector before compression (≈20× smaller raw than JSON);
  a uint8 RGBA packing matching what the GPU actually uploads (WebGLMarineTextureEncoder.js:335-338 quantizes height to
  /10 m × 255, period /20 s × 255) is 4 B/vector.

### A3. Where the CPU goes (ranked; durations are HYPOTHESES unless MEASURED)

| Rank | Cost | Where | Evidence |
|---|---|---|---|
| 1 | **Per-hour product parse on L1 miss**: `json.load` of a full global_mid file (181 × 83 = 15,023 cells) + validate the strided subset, 48× per cold world page, GIL-bound in a thread (no parallelism on 1 CPU) | store_helpers.py:669-676 via mid_res_tier.py:475 | MEASURED local: 15,023-vector product ≈ 2.7 MB at 182 B/vec, `json.loads` 25 ms, validate-all 43 ms, validate 1/16 3 ms. The code comment says stored products are ~688 B/vector (schemas.py:48), i.e. ~10 MB/file → ~0.1 s/load locally, plausibly 0.2-0.4 s on Render's vCPU → 48 × ≈ 10-15 s/page, matching the "10-13 s CPU per world page" note. HYPOTHESIS until measured on the box. |
| 2 | **Response encoding on the event loop** (flag-off default): `jsonable_encoder` over every GridVector → `json.dumps` → gzip-9 in middleware | weather.py:110, server.py:486 | MEASURED local lower bound for 80 k vectors: model_dump(json) 0.31-0.36 s + dumps 0.26 s + gzip-9 0.47 s (gzip-1 0.07-0.09 s). PF03 (actual FastAPI route, 76.8 k vectors): legacy dict + gzip-9 median 1,358 ms vs guarded direct pydantic + gzip-1 431-512 ms. On the box, multiply by an unknown CPU factor. This blocks every other request (spot-ratings, point) for its duration. |
| 3 | **L1 vector-budget thrash** (HYPOTHESIS): 3 world pages × 48 strided entries × 966 vectors ≈ 139 k > 120 k cache budget (store.py:373) → a repeat within the 5-min TTL can re-parse page 1 after page 3 evicted it. Cache keys also include the stride, so a different budget-derived stride (different frame count) is a different entry. | store.py:357-374, store_helpers.py:587 | Read `_product_cache_vectors` sum after a 3-page warm offline. |
| 4 | **Manifest linear scan per frame on the loop** (`GRID_RESPONSE_BOUNDS` off) | grid_resolver.py:160-169 | 10-04 reproduction (20 k entries); duration on the live manifest unmeasured. |
| 5 | **Python per-vector passes per frame**: `filter_grid_to_bbox` set/sort/filter, `decimate_vectors`, `node_extent_bounds`, `_apply_build_stride` | route_helpers.py:346-360, series_vector_budget.py:188-276 | O(cells) Python each; small per frame, ×48. |
| 6 | **`copy.deepcopy` of a cached clip** for unstrided mid-tier serves (`/grid`, 1-hour minis, exact world upgrade) | mid_res_tier.py:427 | MEASURED local: deepcopy of 15,023 GridVectors 81 ms. A shallow model_copy (the store's own pattern, store_helpers.py:603-605) would do. |
| 7 | **gc**: full `gc.collect()` per background hour for dynamic (wind and live-provider) builds, 0.42 s each on the loop | viewport_helper.py:541-543, 561; viewport_service.py:507-510 | Measured in wind_bg_build.py docstring (163 of 201 s). Bounded build behind `WIND_BG_BUILD_BOUNDED` (default off; flip status unknown). Not on the stored-GFS marine path. |
| 8 | **Per-frame provenance/rating helpers** (`_frame_provenance`, `_frame_rating_mode`, run census) | grid_series_helper.py:532-549, 262-271 | Small. |

### A4. Caching, keys, invalidation (CONFIRMED)

- **No response-level / page-level cache.** Every `/grid_series` request rebuilds every frame from L1/L2 products
  (dynamic-viewport products have their own cache in viewport_service). Two clients asking for the identical world page
  10 s apart do the full assembly + encode twice.
- L1 product cache: key = filename (+`#sN`), TTL 300 s, shallow copies handed out. Optional `PRODUCT_REVISION_REFRESH`
  revision check (store_helpers.py:590-600). Product filenames embed model/run/valid time (save path
  store_helpers.py:162), so a new model run is a new filename → natural invalidation; the manifest picks it.
- Mid clip cache `_CLIP_CACHE` keyed `filename|snapped_bbox`, bypassed for strided loads (mid_res_tier.py:420-421).
- Client cache keys include model, layer, surf flavour, viewport key (world collapses to `global` for spans > 15°),
  page, and the hour anchor (marineGridSeries.js:178-202) → an hour rollover invalidates every cached page client-side
  (one re-warm per hour per client).

### A5. Concurrency on 1 CPU (CONFIRMED)

- `uvicorn server:app` single process (render.yaml:42). One event loop. `asyncio.to_thread` moves file I/O + json
  parse off the loop but the GIL means CPU-bound work still serializes with the loop on 1 vCPU.
- Default path has **no server-side admission across clients** for series; the client-side limiter is per tab
  (marine: 2 pages + 1 mini, marineSeriesLimiter.js:2-4; wind has its own separate 2, windGridSeries.js:38). One tab with
  marine + wind can therefore have ~4-5 heavy series requests open, plus `/grid`.
- Client disconnect is checked per hour (`request.is_disconnected`, grid_series_helper.py:300-307) — it stops building
  new hours, but encode/gzip of an already-built page is not interruptible.
- Live telemetry (lead's capture): `/grid_series` n=105, p50 bucket ≤2.5 s, p90/p95 ≤10 s, p99/max 13.8 s, 14 > 5 s,
  3 > 10 s. Request telemetry wraps the whole send cycle, so these include encode + gzip + transfer
  (request_telemetry.py docstring). Bucket upper bounds read high.

---

## B. Client

### B1. Paging, prefetch, priority (CONFIRMED)

- Page span: 48 frames × 3 h (144 h) for GFS/ICON swell, 16 × 3 h for EURO or surf mode (marineGridSeries.js:122-129);
  hours are phase-aligned to 00/03/06… UTC (:158-170).
- `ensureMarineSeries`: a 1-hour **mini** (`_h0` key, bypasses the page queue) when the current page is cold, then the
  current page, then idle-deferred (1.5 s) adjacent pages +1 and −1 (:503-536).
- **Scrub start prewarms every page** for GFS/ICON as background loads (`prewarmMarineSeries`, :542-559; triggered from
  MapWeatherControls.js:398-401 / 459-461). EURO skipped.
- Priority: visible > background, queued warm promoted when it becomes visible (`promoteQueuedWarm`, :269-273);
  aborted-while-queued pages never hit the network (:303-310). 45 s fetch timeout armed after slot acquisition (:312).
- Supersession: a long-lived per-model/layer `AbortController` signal; queued loads drop; an in-flight fetch is aborted
  on supersede (server sees disconnect only between hours).
- Fallback: a page miss during an active scrub does NOT fetch (`window.isScrubbingTimeline`,
  useMarineOrchestratorScrubCache.js:225-229); settle enqueues `/grid`.
- **Exact-GFS policy (flag `REACT_APP_GFS_EXACT_PLAYBACK`, unset in netlify.toml):** when on, every thinned world series
  frame is refused (marineGridSeries.js:679) so each hour goes to an exact per-hour `/grid` — i.e. scrubbing at world
  zoom becomes per-hour network. Netlify UI env not checked → HYPOTHESIS that it is off.

### B2. Parse, copies, memory (CONFIRMED structure; durations HYPOTHESIS)

- `await res.json()` (marineGridSeries.js:324, 464): the browser builds the JS object graph **on the main thread** —
  one object per cell with 11 properties. ≈ 46 k objects per world page; up to 80 k at budget.
- `frameToMarineData` per frame, synchronously for all frames in one task (:345-350; marineSeriesFrame.js): no vector
  copy (`vectors: frame.vectors`), but builds a truth tag per frame (buildTruthTag) and spreads several objects.
- `computeGridContentHash` once per grid (memoised on the grid, marineGridHash.js) — O(N) per first commit of a frame.
- Series cache: 48 entries, 32 MB estimate cap only when `REACT_APP_MARINE_SERIES_CACHE_BOUNDS=true`
  (marineSeriesCache.js); otherwise only the 48-entry FIFO (marineGridSeries.js:383-387). JS objects at ~11 numeric
  props cost far more than the 256 B/vector the estimator assumes.
- **No Worker, no OffscreenCanvas, no transferable decode** anywhere in the marine path (only openMeteoProtocol.js and
  radarTileRecolor.js use OffscreenCanvas/createImageBitmap). **CONFIRMED by grep.**

### B3. What runs per scrub step vs once (CONFIRMED by code path)

Per committed hour (wheel commits ≤ 11 Hz, ForecastWheel.js:64; frames are 3-hourly so ~2 of 3 detents re-select the
same frame and skip commit via the signature check, useMarineOrchestratorScrubCache.js:165-167):

1. `MapWebGL` re-renders on the `timeOffsetHours` prop (MapWebGL.js:80, 929, 1010; partial memo lever at :750-764)
   — every detent, even when the frame does not change. `__SCRUB_PROBE__` exists to count this.
2. Scrub-cache effect: `getMarineSeriesFrame` (3 page lookups + a containment scan over all cache entries, :568-685),
   coverage checks, `setMarineData` (:193) → React state update → consumers re-render.
3. `WebGLMarineLayer` upload: `engine.setWaveData` → `encodeMarineTexture`: one pass over vectors into scratch typed
   arrays (scratch reused, WebGLMarineTextureEncoder.js:122-131), `extrapolateOceanData` (2 passes, 3×3), direction
   dilation, `getMarineGeoData` (cached by key + mask equality, WebGLMarineGeoData.js:21-45), RGBA8 pack, then
   **`texSubImage2D` into the resident textures when cols × rows are unchanged** (:452-458); a geometry change deletes
   and re-allocates (:470-500). Three textures (wave, chl, bath) + optional score texture are re-uploaded each commit even
   though chl/bath depend only on geometry/mask.
4. Mask: the land-mask texture is reused when bounds and GeoJSON are unchanged (:571-579); the basemap-water re-patch
   effect fires on every data commit (`[revision]`, WebGLMarineLayer.js:734-748) but short-circuits by hysteresis when
   the camera did not move (WebGLMarineEngine.js:2462-2473, 2570-2591). Homogeneous GFS pages keep bounds constant →
   no mask rebuild per hour. Heterogeneous pages (EURO past 240 h: different bounds per frame, marineGridSeries.js:665-672)
   would rebuild — HYPOTHESIS for cost.
5. GPU: one wave texture; **no temporal interpolation** (a single `u_waveTexture` sampler, WebGLMarineShaders.js:58).
   The visible field jumps by 3 h per frame change.

Continuous (independent of scrub): MapLibre's frame, the marine particle/crest custom layer (triggerRepaint loop), the
wind particle layer when wind is on, and `CanvasAnimationCoordinator`'s single rAF for Canvas2D layers. NATIVE-RENDERER-
PROFILE (10-06) MEASURED 1,320 `getParameter` + 7,320 uniform-location lookups per 60 frames in the isolated engine
(2.2-3.9 ms/frame of state reads, can include GPU waits).

Once per page / camera change: JSON parse, frame minting, mask canvas paint + upload (CPU-PHASE-DIAGNOSIS 10-07 live
receipt MEASURED 22 water paints = 4,038 ms, regional refresh 4,268 ms, overlay 3,669 ms nested, 18 long tasks 4,196 ms
during a 1 FPS fallback — before PR #253's repaint repairs; current cost unmeasured live).

---

## C. Instrumentation: what can be measured today

| Stage | Instrument today | Status |
|---|---|---|
| Backend route latency (incl. encode/gzip/send) | `/api/health` request_telemetry histogram (buckets 5…10,000 ms) | **Yes**, coarse, cumulative since boot, no per-stage split |
| Backend per-hour build vs encode vs gzip split | none in the default path; `serve_series` (flag) measures deadline only | **No** — needs a timing wrapper (offline harness can wrap) |
| Backend per-hour parse time / L1 hit rate | log lines only (`Memory cache HIT` at debug) | **No** counter |
| Page bytes / frame count on the wire | browser Resource Timing (`transferSize`, `decodedBodySize`) in the offline harness; `__MARINE_SERIES_DIAG__.lastFrames` | **Yes** offline |
| Client fetch start → response end | Resource Timing / Playwright request log (`scn_swap_ab.js` AB_OUT) | **Yes** offline |
| Client JSON parse + frame minting | nothing wraps `res.json()` / the mint loop | **No** (Long Tasks/LoAF only, unattributed) |
| Series hits/misses/minis/cover misses | `window.__MARINE_SERIES_DIAG__` (loads, hits, misses, h0Loads, ttlCoverageBypass, coverMisses) | **Yes** |
| React re-render churn per scrub | `window.__SCRUB_PROBE__` (`__SCRUB_PROBE_ON__`, bench('forecast')) | **Yes** (dev console; production bundle needs MapPage setters exposed) |
| Encode/upload per commit | `__RAW_GPU__.cpuPhaseTiming.buckets.waveDataUpdate` (setWaveData CPU), `textureUploadCount`, `encodeDupCount`, `__WEBGL_MARINE_UPLOAD_COUNT__`, `__WEBGL_MARINE_DUP_UPLOAD_SKIP__` | **Yes** (CPU only; nested phases must not be summed) |
| Mask paint/upload | `cpuPhaseTiming` maskFeatureQuery/maskBaseCanvas/maskWaterPaint/maskUpload + `__RAW_GPU__.maskCommit.exit` | **Yes** |
| Engine draw CPU | `cpuPhaseTiming` engineDraw/customCallback | **Yes**; GPU completion **No** (no timer queries by design) |
| Requested vs drawn hour | `__MARINE_RENDER_HOUR_PARITY__` | **Partly** — known to lag 15 s under latency (offline README); use the engine's held grid hour + upload content hash instead |
| Event timeline | `__RAW_FORENSIC__.dump()`, TruthOverlay `?diag=1` (GPU tab) | **Yes**, qualitative |
| Wind | wind-bench (`node scripts/wind-bench/run.js --control`, eye/ladder/path runs) | GPU look/position, not scrub latency |
| End-to-end "scrub step → pixels changed" | none | **No** — add a frame-stamp: commit time vs first engine draw with the new content hash |

Offline harness (frontend/scripts/offline-backend): real FastAPI app + real resolver over synthetic stored GFS/ICON
products (181 × 83 global_mid, 37 × 17 coarse), production bundle in headless Chrome, `LAT_SERIES`/`LAT_GRID` latency
injection. It can measure every "Yes offline" row and is the right place for every benchmark below. Its latency is the
local machine's, not the box's: compare arms within one machine, never against live.

---

## D. Candidate optimizations (ranked against this architecture)

Format: mechanism · memory/bandwidth · compatibility · complexity · falsifiable benchmark. "Served numbers" = none of
these change a forecast value unless stated; any that changes quantization of what is DRAWN must show identical encoded
texture bytes (see benchmark).

### Supported (code evidence + a measured or arithmetic basis)

**P-01 Server-side page memo (request sharing + response cache) — HIGH value, low-medium complexity. CONFIRMED gap.**
Mechanism: key the encoded (gzipped) page body by (model, domain, layer, surf, snapped bbox / `global`, hours list,
base_time hour, manifest revision or the frame product_ids). In-flight dedup (one build per key, followers await the
same future) + a small LRU of encoded bytes (a world page is ~1-2 MB gzipped). Every client at world zoom asks for the
same three pages per anchor hour. Memory: N × ~2 MB; bandwidth unchanged. Compatibility: identical bytes; must include
everything that varies the body (thin-bounds flag, decimate mode, vector budget env). Complexity: medium (key
completeness is the risk — L-F9 class). Benchmark: offline harness, two concurrent identical world-page requests;
measure backend CPU-seconds (process time) and `/grid_series` wall time for request 2. Falsified if request 2 costs
> 10% of request 1's CPU.

**P-02 Precomputed series pages in Storage/CDN (precompute lane) — HIGH value, medium-high complexity.**
Mechanism: the precompute/ingest lane (already writes products after each 4 h ingest) writes the 3 world pages per
model/layer/anchor-phase as static gzipped (or binary, P-03) objects; the client fetches them from the bucket/CDN, not
Render. Removes the dominant cold cost (A3 rank 1-2) from the 1-CPU box entirely. Memory: Storage objects (note the
storage growth history: ~19 GiB/day episode; retention needed). Compatibility: anchor alignment (pages keyed by UTC
cycle hour, not "now"), thinned-frame bounds, provenance fields must match the live builder (one builder function,
reused offline — never a second path). Benchmark: build a page offline with the same builder and diff its JSON with the
live builder's output (must be byte-equal after key ordering); measure client time-to-first-fine-paint offline with the
page served statically vs via `/grid_series`.

**P-03 Binary quantized frames (uint16 or uint8 + scale/offset, columnar) — HIGH value for bytes/parse, medium
complexity. CONFIRMED that the GPU only consumes 8-bit channels.**
Mechanism: per frame send `{cols, rows, bounds, scale/offset per channel, data: base64 or a binary body}` with
channels height, u, v (or direction), period, mask/is_valid, dir_confidence. The encoder already quantizes height to
`floor(min(h/10,1)×255)` and period to `/20 s×255` (WebGLMarineTextureEncoder.js:335-338), so a uint16 transport is
strictly finer than what is drawn. 8 B/vector (uint16 × 4) vs ~160 B JSON (~20× raw); gzip still applies. Client
decode becomes a typed-array view (no per-cell objects, no GC). Compatibility: many consumers read `grid.vectors[i].speed`
(encoder, content hash, spot/sim fields, diagnostics). Ship as an additional `format=bin` opt-in on `/grid_series`, keep
JSON, and adapt `frameToMarineData` to synthesize a lazy accessor or feed the encoder directly. Must preserve
`is_valid`, nulls (period None vs 0 — PF03's NaN→null finding), `phys_speed` for surf frames. Benchmark: (a) offline,
same page in both formats; decode → `encodeMarineTexture` → FNV-1a of the uploaded bytes (the harness already hashes
`texSubImage2D` payloads): **must be identical** for every frame; (b) wire bytes and main-thread time (Long Task
duration around fetch→ready) per format. Falsified if (a) differs or (b) saves < 50% of main-thread time.

**P-04 Direct serializer + gzip level 1-4, off the event loop — MEDIUM-HIGH value, low complexity (prototype exists).**
Mechanism: the default path already has a qualified envelope (`serve_series`, `TypeAdapter.dump_json`, `to_thread`)
behind `GRID_SERIES_RESPONSE_BOUNDS`; it still uses gzip-9 (series_response.py:72). PF03 MEASURED legacy 1,358 ms →
direct+gzip-1 431-512 ms locally (76.8 k vectors), at 38% more bytes. Lower level also cuts the middleware cost for
`/grid`. Memory: same. Compatibility: PF03's finite-value guard is already in `finite_compatible`. Benchmark: offline
harness, real route, 3 world pages, process CPU-seconds and response wall time, gzip 1/4/6/9 × legacy/direct; pick by
CPU × bytes; also verify the event loop stays responsive (`/api/health` latency during the build).

**P-05 Avoid full-file parse per hour on L1 miss — MEDIUM-HIGH value, medium complexity. HYPOTHESIS on magnitude.**
Mechanism options: (a) keep a per-run **decoded columnar** representation (numpy arrays per channel, one per product) in
memory instead of GridVector lists, and slice/stride it per request — validation once per product, not per stride;
(b) store a sidecar pre-strided product (s = 2, 4) at ingest; (c) raise/re-weight the L1 budget for strided entries
(they are ≤ 1/16 the size). Memory: columnar float32 × 6 channels × 15 k cells ≈ 360 KB/product vs ~12 MB as models.
Benchmark: offline, cold world page with L1 empty; instrument `load_product_helper` (count + summed seconds); A/B (c)
alone first (cheapest): falsified if the second warm of all 3 pages within 5 min still shows L1 misses = 0 → no thrash
(then drop rank 3 of A3).

**P-06 Client worker decode with transferables — MEDIUM value, medium complexity.**
Mechanism: fetch + parse + pack (to the RGBA8 arrays the encoder produces, or at least to typed arrays) in a Worker;
transfer `ArrayBuffer`s to the main thread. With JSON this moves `JSON.parse` off the main thread; with P-03 it is
almost free. Compatibility: the engine/sim/spot consumers still need either vectors or a typed accessor; CRA/craco
supports `new Worker(new URL(...))` with webpack 5. Benchmark: offline harness, PerformanceObserver Long Tasks during a
3-page warm, worker on/off: total long-task ms and max single task; falsified if the max long task during page arrival
is not reduced below 50 ms.

**P-07 Intent coalescing on the wheel — LOW-MEDIUM value, low complexity. CONFIRMED partial.**
The wheel commits at 11 Hz in 1-h detents; frames are 3-hourly, so ~2/3 of commits are no-op frame selections that
still re-render MapWebGL (prop) and run the scrub-cache effect. Mechanism: commit only when the nearest available
frame changes (quantize the committed hour to the cache lattice during drag), or move `timeOffsetHours` out of
MapWebGL's props (context/ref — the documented §2b decoupling). Benchmark: `__SCRUB_PROBE__.bench('forecast')` before /
after: `mapWebGLRenders` and frame-time p95; must keep `newMarineClears`/`newParticleReinits` = 0.

**P-08 Upload only the wave texture on a same-geometry hour change — LOW-MEDIUM value, low complexity.**
`chl` and `bath` textures depend on geometry + ocean mask (cached by `getMarineGeoData`) yet are re-uploaded every
commit (WebGLMarineTextureEncoder.js:456-458). Skip when the geo cache returned the same object. Benchmark:
`__RAW_GPU__.textureUploadCount` per scrub step (expect 3→1) and `waveDataUpdate` CPU bucket; identical drawn pixels
(screenshot diff at a fixed hour).

**P-09 Bounded / adaptive prefetch — MEDIUM value for the box, low complexity.**
Scrub start prewarms every page (marineGridSeries.js:556) and wind does the same in parallel. Mechanism: prewarm only
the page in the drag direction (+1 by default), and share one cross-domain limiter between marine and wind (today two
independent 2-slot limiters). FINDING-2026-08-09 measured that turning prewarm OFF regressed (moves work into the
gesture) — so bound, don't remove. Benchmark: offline replay of the standard scrub script; count `/grid_series` pages
and backend CPU-seconds per gesture; time-to-hit for a +72 h and +288 h jump; falsified if hits at +72 h drop.

**P-10 Shallow copy instead of `deepcopy` for the mid clip cache — LOW-MEDIUM, very low complexity.**
mid_res_tier.py:427 deep-copies thousands of pydantic models per unstrided serve (81 ms locally for 15 k). The store's
own contract is shallow product + grid copy and never mutate vectors in place (store_helpers.py:603-605,
route_helpers.py:317-325). Caller mutation (surf transform) must rebind, not mutate — verify. Benchmark: pytest timing
of `try_serve_mid_res_tier` hit path + an aliasing test (mutate the returned product's vectors list; the cached clip
must be unchanged).

**P-11 Move `find_candidates` off the loop / index it — LOW-MEDIUM, low complexity (flag exists).**
`GRID_RESPONSE_BOUNDS=1` already offloads it; an index by (model, domain, layer) → sorted by valid time would make it
O(log n). Benchmark: the 10-04 manifest-scan fixture (20,007 entries): scan seconds per frame and loop responsiveness.

### Exploratory (plausible, not evidenced in this code)

**P-12 GPU temporal interpolation between frames (two wave textures + `u_timeBlend`).** Mechanism: keep the bracketing
3-hourly frames resident (double buffer: A = floor frame, B = next) and `mix()` height/period in the shader; direction
via blended unit vectors. Gives smooth hourly scrubbing and play with zero network per hour, and double-buffering
removes the visible re-upload of the current texture. Risks: blended heights are NOT served numbers (D-001: this changes
what is drawn between frames — owner decision; ship dark/ kill switch), masks must match (same geometry only), particle
advection fields need the same treatment. Memory: +1 wave texture (cols × rows × 4 B — trivial). Benchmark: offline,
hour h+1 rendered via blend vs the exact hourly product (where hourly exists, e.g. synthetic `--step 1`): RMSE of decoded
heights vs the exact field, and per-step upload count = 0 during intra-bracket scrubs.

**P-13 Progressive resolution.** The mini (1 h, ~36 KB) is already a progressive first paint; extend to "coarse page
first (stride 8), fine page later". Risk: more requests per gesture on a saturated box — only after P-01/P-02.
Benchmark: time-to-first-paint and time-to-fine, total backend CPU per gesture.

**P-14 PNG-encoded frames (weather-tile style, RGBA8 or 16-bit) decoded by `createImageBitmap` → `texImage2D`.** Lets the
browser decode off-thread and upload directly; CDN-friendly with P-02. Risks: the CPU-side field is still needed by
sim/spot/hover consumers; premultiplied-alpha/colour-space pitfalls (set `UNPACK_COLORSPACE_CONVERSION_WEBGL = NONE`,
`premultiplyAlpha: 'none'`). Benchmark: decoded bytes must equal the P-03 raw bytes for every pixel.

**P-15 Persistent texture atlas for a whole page** (48 frames in a texture array / atlas, select the layer per hour).
WebGL1 has no texture arrays; an atlas of 48 × 966 cells is small (~185 KB). Removes per-step uploads entirely; combines
with P-12. Benchmark: `textureUploadCount` per scrub step = 0 after page load; identical pixels per hour vs current path.

### Not recommended now

- More aggressive client prefetch or more concurrent slots: the box is the bottleneck (lead's p90 10 s); load-shedding
  (P-01, P-02, P-04) comes first.
- Raising `MAX_FRAMES`/budget: increases peak memory (the 2026-08 OOM class) and encode time linearly.

---

## E. Minimal benchmark plan (offline only; one machine; arms interleaved, forward + reverse order)

1. **Stage split, backend**: run `serve_synthetic.py`; wrap (scratch copy, not tracked) `load_product_helper`,
   `find_candidates`, `filter_grid_to_bbox`, `build_grid_series`, and the response encode in `time.process_time` /
   `perf_counter` accumulators; request the 3 world pages cold, then warm, then after a 4th distinct page. Output:
   seconds per stage per page, L1 hit/miss counts, vectors cached. Decides A3 ranks 1-4.
2. **Encode arms**: PF03 script re-run with real-shaped (rounded) vectors at 46 k and 80 k: legacy/gzip-9, direct/gzip-1,
   direct/gzip-4, binary-uint16/gzip-1.
3. **Client stage split**: `scn_swap_ab.js` with a PerformanceObserver for `longtask` + `long-animation-frame`, plus
   `performance.mark` around `res.json()` and the mint loop (scratch build only), `__RAW_GPU__.cpuPhaseTiming`,
   `__SCRUB_PROBE__`, and the engine upload hash. Output per scrub step: commit→upload ms, upload→first draw with new hash.
4. **Null controls**: repeat the same arm twice (expect equal within noise); **positive control**: inject a 200 ms busy
   loop in the mint path and confirm the instrument sees +200 ms.
5. At most ONE short live read (only if the owner asks): `/api/health` before/after; never a replay loop.

## F. Findings index

- P-perf-F1 CONFIRMED: default `/grid_series` encodes via FastAPI dict path + gzip-9 middleware on the event loop
  (weather.py:110, server.py:486); the off-loop direct envelope exists but is default-off (weather.py:104-109).
- P-perf-F2 CONFIRMED: no page/response cache or in-flight sharing across clients for `/grid_series`.
- P-perf-F3 CONFIRMED structure / HYPOTHESIS cost: every world frame re-parses the full stored product JSON on L1 miss
  (store_helpers.py:669) even when only 1/16 of its cells are kept.
- P-perf-F4 HYPOTHESIS: L1 vector budget (120 k) < 3 world pages of strided entries (~139 k) → re-parse thrash.
- P-perf-F5 CONFIRMED: `find_candidates` linear manifest scan on the loop per frame (flag-off default).
- P-perf-F6 CONFIRMED: `copy.deepcopy` of mid clip cache hits (mid_res_tier.py:427); 81 ms/15 k vectors locally.
- P-perf-F7 CONFIRMED: client parses JSON pages on the main thread; no Worker/transferables anywhere in marine.
- P-perf-F8 CONFIRMED: payload is per-cell JSON objects (~150-235 B/cell) although the GPU consumes RGBA8.
- P-perf-F9 CONFIRMED: no temporal interpolation; one wave texture; same-dims commits reuse textures via texSubImage2D
  (good), but chl/bath are re-uploaded every commit.
- P-perf-F10 CONFIRMED: MapWebGL re-renders on every 11 Hz detent; ~2/3 of detents select the same 3-hourly frame.
- P-perf-F11 CONFIRMED: scrub start prewarms all pages; marine and wind limiters are independent (up to ~4-5 heavy
  series requests per tab).
- P-perf-F12 HYPOTHESIS: if `REACT_APP_GFS_EXACT_PLAYBACK=true` on any Netlify context, world-zoom scrubbing refuses
  every thinned series frame and goes per-hour `/grid` (marineGridSeries.js:679) — check the Netlify env.
