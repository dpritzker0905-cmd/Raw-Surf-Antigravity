# WEATHER SIM — MASTER ARCHITECTURAL AUDIT (living doc, started 2026-07-10)

Mandate: the 14-phase "Master Diagnostic Prompt" (no code edits until root causes are proven with
evidence). This doc seeds the audit with what the 07-09→10 forensic arc **already proved live**
(citations = commits/telemetry), and queues the unproven phases with exact recipes. Companion detail:
memory `marine-scrub-perf-and-encoder-split-2026-07-09.md` §A–H + `HANDOFF-2026-07-09-EOD…` §0/§7.

## PHASE 1 — MENTAL MODEL (PROVEN this arc)
**There is no single pipeline. There are FOUR, and a fix in one does not transfer:**
1. **MARINE** (vector grids → GPU heatmap+crests): backend GRIB/netCDF ingest (GH cron → Supabase L2 →
   Render serve-only) → `/grid` + `/grid_series` → client `marineController` caches (`_perModelHourCache`
   LRU50 + series pages) → `useMarineOrchestrator` → `WebGLMarineLayer.safeUpload` → `WebGLMarineEngine`
   (87,616 crest quads, 4096² land-mask texture, fixed-timestep ~30 FPS) + `SimulationLoop` RK4 (3,000).
2. **WIND** (vector grid → particle field): same backend → `WeatherEngine.js` (own per-hour cache +
   `windGridSeries` pages) → `WebGLWind` (147,456 particles) + RK4 (6,000). SEPARATE code, SEPARATE caches.
3. **OM RASTER TILES** (pressure/fog/rain/satellite/temp): client fetches `.om` per-timestep spatial files
   DIRECT from `map-tiles.open-meteo.com` (their CDN) via `openMeteoProtocol` worker decode → 3-slot
   raster ring (`Raster Queue Transition`) + `useTemporalPreloader`. Already Windy/Ventusky-style
   (pre-baked CDN timesteps) — that IS the industry pattern for these layers.
4. **RADAR**: RainViewer CDN via `/rv/*` edge proxy + advection. CLOSED, snappy — the reference feel.
Shared React spine: `useWeatherState` (hour owner) → MapPage → MapWebGL (5 raw-hour hooks §7.2) →
engines; scrubber = `MapWeatherControls` (local 60fps thumb; commits decimated ~11Hz `cb074b8b`).
FCE (`useSimulationField`) feeds `useRenderPlanBridge`→renderPlan (NOT display-decoupled — §7 guardrail).

## PHASE 2/13 — PROVEN ROOT CAUSES & ARCHITECTURAL FINDINGS (evidence attached)
| # | Finding | Evidence | Status |
|---|---|---|---|
| 1 | Manual-drag jank = 40–60 commits/s × ~62ms layer-independent reconcile | §7.1 measurement; playback benches blind to it | FIXED `cb074b8b` (decimate ~11Hz) |
| 2 | EURO marine `grid_series` = 40s→empty (live-Copernicus path, stale premise) | curls 40.1s/145B vs /grid 0.8s | FIXED `6a0055be` |
| 3 | GFS/ICON series carried only global-coarse at regional zoom (`misses:692`) | live log + curls | FIXED via Render env `GFS_ICON_SERIES_FASTPATH=1` (NOT in git) |
| 4 | Wind settle path ignored its own warmed series → per-hour fetch storm | log: "Cache miss… Fetching immediately" ×N | FIXED `21c1bf3a` |
| 5 | EURO wind >240h = naked 500 (unhandled slice past forecast_days=10); masked a working GFS fallback | curls 500→ post-fix 200 `provider:gfs_fallback` | FIXED `b0655047` (fail-fast unblocked resolver ladder) |
| 6 | Far-horizon settle churn re-drove doomed 404s (stale grid carries no failureReason) | §7.6 trace | FIXED `d38a693b` (terminal tracker) |
| 7 | Estimates ABSENT during each ~1–1.5h ingest window (every 4h) — old products gone before new land | ROOT PROVEN (run 29052535445 log): EURO native prune 22:41 deletes old est tail (68/layer ×4, silent — L2-lazy files skip the per-file log) → extend job 23:01 (2s compute) → L2 upload backlog drains 23:24 → serving 23:30. Gap ≈ 35-45min/cycle. In-job GFS-ext = 0 in production (see #15) | FIXED `cf0b4b23` + ✅ **VERIFIED run 29068687719** (05:24Z, fixed code): EURO per-layer prune **68 → 2** (old est tail preserved; the 2 = receding-edge old natives — also proves the 68 was ~all estimates); extend job 05:05 overwrote the est files IN PLACE (same valid-time-keyed names, anchor unmoved → sweep 0 = consistent); continuity by construction. Kill `INGEST_PRUNE_PRESERVE_ESTIMATES=0`. (Probe had a laptop-suspend hole 04:22-05:55 — re-run `ingest_probe.sh` on an awake cycle for belt-and-suspenders) |
| 15 | In-job EURO GFS 10→14d ext saves 0 products every cycle (premise drift) | run log 22:40: gfs_ext fetch 429s — the "GFS job ran ~1 min earlier → _GRID_CACHE hit (TTL 300s)" premise died when the 21-min CMEMS fetch moved in between | OPEN (LOW with #7 fixed — extend job + preserved tail cover continuity). Fix option: fetch gfs_ext BEFORE the CMEMS fetch, while the cache is warm |
| 16 | Wind no-coverage blanked the layer + churned (safe-zero passed the settle's `vectors.length>0` guard and COMMITTED; doomed hours re-fetched per landed hour; 404 detail discarded by the client) | code-proven 07-10 (backendWindServiceClient:463 bare-404, windController safe-zero w/o failureReason, WeatherEngine settle guard); live-verified via fetch-interception on preview 3007 | FIXED `06fbeef2` — 3-part mirror of marine d38a693b (surface detail → record terminal (model,'wind',hour) → settle holds last frame + skips terminal hours). Kills `__RAW_WIND_HOLD_LAST_FRAME_DISABLED__` / `__RAW_DISABLE_TERMINAL_NOCOV_BYPASS__`; tel `__WIND_TERMINAL_NOCOV_SKIP_COUNT__` |
| 8 | Wind series cold on MODEL-SWITCH & click-jumps (prewarm = drag-start only, per-model) | this round's log; code-proven 07-10 (scrub_start dispatch = drag only; F3 cleanup aborts the warm on rapid switches) | FIXED `9494d8c2` (model-switch/first-landing prewarm, mirror of marine's; kill `__RAW_WIND_MODEL_PREWARM_DISABLED__`; tel `__WIND_MODEL_PREWARM_COUNT__`; live-verified preview 3007: settle hit, no per-hour fetch) |
| 9 | `capabilities` EURO-wind native:336 is FALSE (ECMWF open-data = 240h) — contract vs reality | curls + health | OPEN (contract fix, locked-doc territory) |
| 10 | ICON wind returned **300 vectors** (vs 629) at far hours | live curls 07-10: far grid = COMPLETE 25×12 global, all nonzero, `is_estimated:true`, product `viewport_icon_wind_wind_*_-180.00_-80.00_180.00_85.00` | TRIAGED — NOT A BUG. Dynamic global wind build uses `target_pts=400` (viewport_service.py:163) → `choose_adaptive_resolution(360,165,400)`=√148.5=12.19 → 15° tier (route_helpers.py:137) → 25×12=300; stored ingest product is 10° → 37×17=629. Fires whenever the stored hour is missing (ICON wind >~113h ingested horizon, EURO >240h, or ingest-window gap = #7). User-felt = slightly coarser far-hour wind field. OPTIONAL parity fix (user decision — adds ~2× upstream/CPU per dynamic global build on the 1-CPU box): raise global-wind target_pts ≥594 so est_res ≤10° |
| 11 | Model switch unconditionally wipes OM block cache + discards in-flight (fetch storms on compare) | `useModelTransition` (deliberate: cross-model pollution) + "Discarding stale" logs | OPEN (§7.5 retention idea; guarded) |
| 12 | PostHog rrweb console+network capture serializes EVERYTHING (marine logged 4–6 lines/commit) | stack traces in every user log | MITIGATED (logs quieted `cb074b8b`); posthog config un-audited |
| 13 | React reconcile NOT the steady-state bottleneck; engine stable 30 FPS all zooms; §7c retired | 3 live benches | CLOSED — do not reopen |
| 14 | Mask-res/retain, prewarm, engine internals = documented-regression minefields | 3-mo commit archaeology | OFF-LIMITS without dedicated session |
Disconfirmed (do not re-chase): LRU eviction as scrub root; particle fill-rate vs zoom; mask rebuild as per-step cost; cache-retention as the felt EURO lag.

## PHASE 3 — FEATURE STATUS (as verified live 07-10)
✓ Marine waves/swells (EURO best-in-class; GFS/ICON good w/ fastpath) · ✓ Radar · ✓ Timeline+playback
(decimated commits; settle nets) · ✓ 14-day contract marine (GFS native, ICON blend, EURO estimates —
including ingest-window continuity `cf0b4b23`) · ✓ Wind client resilience (#8 FIXED `9494d8c2`; #10 triaged not-a-bug; #16 hold-last-frame FIXED `06fbeef2`; EURO>240h = labeled GFS fallback)
· ⚠ Pressure/fog/rain/satellite (pipeline 3 — functional; scrub feel UN-AUDITED: preloader window,
.om decode cost, slot thrash) · ⚠ Temperature (exists? un-audited) · ✓ OceanMask (heavily guarded;
Phase 6 = document, don't touch).

## REMAINING PHASES — QUEUE + RECIPES (next sessions; graph server ready: 34k nodes/73k edges)
- **P4/P10 (pipeline traces + layer order):** `codebase-memory` `trace_path`/`query_graph` per layer;
  MapLibre layer order via live `map.getStyle().layers` dump. Deliverable: per-layer diagrams.
- **P5 (silent render-failure matrix):** enumerate via `WEATHER_TRUTH` stages (backendResponse→…→
  animationFrame) — the tracer already exists; audit each stage's failure detection.
- **P6 (OceanMask lifecycle):** document from `mask-truth-guards` + `maskSmoothing.js` + encoder retain
  branches. READ-ONLY (minefield).
- **P7 (particles):** SpectorJS (`tools/spectorjs`) + `__WIND_TELEMETRY__`; triage #10 (300 vectors) first.
- **P8 (API audit):** seed = `data-source-matrix-2026-07-08` memory + this arc's latency curls.
- **P9 (races):** proven classes so far: test-during-deploy window; ingest estimate window; scrub-start-
  only prewarm; model-switch stale-discard storm. Hunt more via `__MARINE_CACHE_DIAG__` reasons.
- **P12 (WebGL perf):** `window.__RAW_GPU__` (textureCount/gpuMemoryEstimate — telemetry exists),
  SpectorJS capture, `__SCRUB_PROBE__.bench`.
- **P14 (prod readiness):** score after P4–P12.
**North star (Windy/Ventusky parity for pipelines 1–2):** pre-bake marine/wind rasters per timestep to a
CDN (pipeline-3-ify them). Big project; the durable end-state. Interim: Render capacity + keep-warm (exists).

## TEST DISCIPLINE (learned this arc, binding)
Judge NOTHING during: a Render deploy (push = restart), the ingest window, or on a stale SW (check
`BUILD_VERSION`==HEAD). One variable per test.
⭐ **Browser "blocked by CORS policy: No ACAO header" on onrender.com during/near a deploy = Render-edge
5xx (no app CORS headers on edge-generated errors), NOT a CORS config bug** — verified 07-10: all three
"CORS-failed" global far-horizon /grid URLs re-curled 200+ACAO in 3-4s steady-state; the client's
"Falling back cleanly to standard proxy pipeline" is the designed fallback (collateral: the ICON blend
can transiently use a regional 13×13=169 anchor instead of global 629 — self-heals next fetch).
Re-curl the exact URL with `-H "Origin: ..."` AFTER the deploy settles before diagnosing. Live telemetry first: `__MARINE_VERBOSE__`,
`__MARINE_CACHE_DIAG__`, `__SCRUB_PROBE__`, `__WIND_SERIES_SETTLE_HIT__`, `__MARINE_TERMINAL_NOCOV_*`.
