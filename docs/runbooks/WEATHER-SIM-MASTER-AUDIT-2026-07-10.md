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
| 7 | Estimates ABSENT during each ~1–1.5h ingest window (every 4h) — old products gone before new land | ROOT PROVEN (run 29052535445 log): EURO native prune 22:41 deletes old est tail (68/layer ×4, silent — L2-lazy files skip the per-file log) → extend job 23:01 (2s compute) → L2 upload backlog drains 23:24 → serving 23:30. Gap ≈ 35-45min/cycle. In-job GFS-ext = 0 in production (see #15) | FIXED `cf0b4b23` + ✅ **VERIFIED run 29068687719** (05:24Z, fixed code): EURO per-layer prune **68 → 2** (old est tail preserved; the 2 = receding-edge old natives — also proves the 68 was ~all estimates); extend job 05:05 overwrote the est files IN PLACE (same valid-time-keyed names, anchor unmoved → sweep 0 = consistent); continuity by construction. Kill `INGEST_PRUNE_PRESERVE_ESTIMATES=0`. ✅ **Awake-cycle probe BANKED (run 29124845622, 07-10 21:36→22:50Z):** EURO/marine horizon held 319-320h through the ENTIRE window (3-min polls, zero dips; log `scratchpad/ingest_window_probe.log`) + extend job saved 144 estimates at 22:24. Belt-and-suspenders complete |
| 15 | In-job EURO GFS 10→14d ext saves 0 products every cycle (premise drift) | run log 22:40: gfs_ext fetch 429s — the "GFS job ran ~1 min earlier → _GRID_CACHE hit (TTL 300s)" premise died when the 21-min CMEMS fetch moved in between | OPEN (LOW with #7 fixed — extend job + preserved tail cover continuity). Fix option: fetch gfs_ext BEFORE the CMEMS fetch, while the cache is warm |
| 17 | OM rasters render ABOVE wind particles (fog/pressure/rain wash dims the wind field) — unanchored appends make z-order time-of-add dependent | live `map.style._order` dump 07-10 (P10): wind=121, OM slots=122-133 | FIXED `bcbc25c6` (user-approved): slots anchor before `webgl-wind-particles` via styledata-tracked beforeId (marineBeforeId precedent). Live-verified post-restart: wind 121→132, above all 12 slots. Kill `__RAW_OM_SLOTS_ANCHOR_DISABLED__` |
| 23 | **Wind field BLANKED on every screen-sized pan + z6 tier crossing** — camera-driven particle reseeds (tile drift recenter 25%, isHighZoom flip) hard-cleared the trail FBOs; ~1s rebuild per gesture = the dominant remaining "not snappy" feel once all data paths were warm (6 reinit pairs in the user's short 07-10 eve log) | code: WebGLWindEngine.js:306/314/325 → reinitParticles → clearBuffers; live repro + fix verified (tier crossings log "re-seeded (trails kept)" ×3, no blank; data commits still full-clear) | FIXED `68e80179`: camera reseeds keep the screen-space trail FBOs (fade pass ages them <1s = crossfade — the instant-toggle path's established trade); data-driven reseeds unchanged. Kill `__RAW_WIND_TRAIL_CLEAR_LEGACY__=1` |
| 21 | **USER-REPORTED (07-10 eve): ICON waves, semi-far zoom — horizontal lines "heatmap at a different resolution"; after panning, animations clamp to an equatorial band at very-far zoom** | UN-REPRODUCED after 4 targeted recipes (h0/z2, h202-blend/z2, pan+fast-zoom-out tile-state drive — state machine clean, tile clears on z≤3 —, wind-on z2). Data probes clean: ICON global_coarse + far-hour blend grids global/complete. Preview confound found: pane rAF 1Hz w/ zero long-tasks + zero wind-engine renders + healthy __RAW_GPU__ (unresolved; SpectorJS/P7 territory; user's machine benched 30 FPS global 07-09) | OPEN — ranked hypotheses: ① crest-tile edge/stale-tile band under REAL zoom gestures (mid-gesture commits; A/B lever `__RAW_DISABLE_MIDGESTURE_COMMIT__=true` — the §3b ready fix; user's own word "clamping" recurs from the z9 saga); ② wind-layer visual at global; ③ real Southern-Ocean swell banding misread. **Capture recipe (run in console WHEN visible):** `copy({zoom:map.getZoom(),tile:{cx:__MARINE_ENGINE__._tileCenterX,cy:__MARINE_ENGINE__._tileCenterY,w:__MARINE_ENGINE__._lastTileWidth,lastZ:__MARINE_ENGINE__._lastZoom},grid:(g=>g&&({b:g.bounds,c:g.cols,r:g.rows,p:g.__gridProvider,h:g.hourOffset}))(__MARINE_ENGINE__._waveData&&__MARINE_ENGINE__._waveData.waveGrid)})` + screenshot + note the FPS badge |
| 20 | **Cancelled requests poisoned the dynamic-viewport shared in-flight context** (LATENT; exposed by #10's longer 629-pt fetch): waiters awaited a BARE future (cancelling a task blocked on one CANCELS the future); CancelledError = BaseException → every `except Exception` ladder missed it; only the fetcher's Exception path popped IN_FLIGHT_REQUESTS → one cancelled request = instant naked 500s for ALL far-hour dynamic wind (global dedup key shared) until restart | Render traceback (CancelledError at the waiter await); post-bcbc25c6 500-storm ~13:08-13:45Z; local repro of code path CLEAN (env-specific: local uvicorn doesn't cancel on disconnect, Render's edge does) | FIXED `db94a7c3`: asyncio.shield on 4 shared awaits + waiter CancelledError reap (task.cancelling() discriminator, identity-guarded `_reap_shared_context`) + fetcher CancelledError cleanup resolving futures with a NORMAL 504. 3 mechanism-pinning tests. Wind gates split → `wind_gates.py` (LOC gate). ⚠️ viewport_service.py = 800/800 EXACTLY — split before ANY next change |
| 16 | Wind no-coverage blanked the layer + churned (safe-zero passed the settle's `vectors.length>0` guard and COMMITTED; doomed hours re-fetched per landed hour; 404 detail discarded by the client) | code-proven 07-10 (backendWindServiceClient:463 bare-404, windController safe-zero w/o failureReason, WeatherEngine settle guard); live-verified via fetch-interception on preview 3007 | FIXED `06fbeef2` — 3-part mirror of marine d38a693b (surface detail → record terminal (model,'wind',hour) → settle holds last frame + skips terminal hours). Kills `__RAW_WIND_HOLD_LAST_FRAME_DISABLED__` / `__RAW_DISABLE_TERMINAL_NOCOV_BYPASS__`; tel `__WIND_TERMINAL_NOCOV_SKIP_COUNT__` |
| 8 | Wind series cold on MODEL-SWITCH & click-jumps (prewarm = drag-start only, per-model) | this round's log; code-proven 07-10 (scrub_start dispatch = drag only; F3 cleanup aborts the warm on rapid switches) | FIXED `9494d8c2` (model-switch/first-landing prewarm, mirror of marine's; kill `__RAW_WIND_MODEL_PREWARM_DISABLED__`; tel `__WIND_MODEL_PREWARM_COUNT__`; live-verified preview 3007: settle hit, no per-hour fetch) |
| 9 | `capabilities` EURO-wind native:336 is FALSE (ECMWF open-data = 240h) — contract vs reality | curls + health | **FIXED `e1adb799`** (07-10 late): native:240 + estimated:96, max stays 336 (the only frontend-consumed field — verified zero consumers of native/estimated); fallback_sources stays [] (locked contract restricts it to EURO marine). Shipped WITH the slice-1 pre-bake: EURO wind 240-336h now saved on ingest as gfs_fallback clones of stored GFS products (euro_wind_extension.py, kill EURO_WIND_EXTEND=0, 3 hermetic tests; VERIFY on next cycle: health EURO/wind 229->~330h + far-hour /grid instant provider=gfs_fallback). ICON-marine >168h half of slice-1 RE-SCOPED: the blend is FRONTEND-side (marine_mid_res_ingestion.py:44 — client recursively fetches GFS component grids); pre-baking it = migrating a client blend server-side = own design session |
| 10 | ICON wind returned **300 vectors** (vs 629) at far hours | live curls 07-10: far grid = COMPLETE 25×12 global, all nonzero, `is_estimated:true`, product `viewport_icon_wind_wind_*_-180.00_-80.00_180.00_85.00` | TRIAGED — NOT A BUG. Dynamic global wind build uses `target_pts=400` (viewport_service.py:163) → `choose_adaptive_resolution(360,165,400)`=√148.5=12.19 → 15° tier (route_helpers.py:137) → 25×12=300; stored ingest product is 10° → 37×17=629. Fires whenever the stored hour is missing (ICON wind >~113h ingested horizon, EURO >240h, or ingest-window gap = #7). User-felt = slightly coarser far-hour wind field. PARITY FIXED `bcbc25c6` + fitted timeout `95b42121` (the 629-pt fetch measured >20s on Render — every retry hit the 20s cap, parity never served; `WIND_GLOBAL_PARITY_TIMEOUT_SEC` default 40s, global wind only, EURO short-timeout override still wins). Kills `WIND_GLOBAL_PARITY_10DEG=0` / the timeout env. Deploy also surfaced latent finding #20 |
| 11 | Model switch unconditionally wipes OM block cache + discards in-flight (fetch storms on compare) | `useModelTransition` wipe + `_cb` nonce rotation BOTH predate the real leakage fix (model-keyed caches + model/run-pathed URLs `9f231d40`) — the wipe was vestigial; user log 07-10 eve: a dozen switches, each a full raster refetch ("not snappy") | FIXED `22eb81c8`: retention default (keys collision-impossible, LRU-bounded); kill `__RAW_OM_MODEL_WIPE_LEGACY__=1`. Live-verified: return-to-model leg = ZERO map-tiles requests (was a full latest.json+.om wave) |
| 22 | Cold dynamic global ICON wind builds >40s (both 3h-aligned and unaligned hours 504 at the fitted ceiling; success depends on background completion + caching) — far-hour ICON wind cold-scrubs feel bad and grind the 1-CPU box | live curls 07-10 eve (+168/+170h: 504 @40s ×2; +204h band served only after a prior bg completion cached it) | FIXED `fc0ec396`: the DWD-direct ingest path now ALSO saves the 14d loop-extrapolated tail (3-hourly, estimated, `icon_loop_extrapolation` basis; natives stay authoritative; cf0b4b23 prune preserves the old tail = continuity). Kill `ICON_WIND_EXTEND=0`. ✅ **VERIFIED run 29124845622** (21:29→22:48Z success, 07-10): log 21:40:25 "Ingested **52 ICON wind extended-tail files** (beyond 07-18)" on the DWD path (612 pts, 61 natives, from_dwd=True) + 21:36 startup hygiene purged 68 stale >120h AUTH products; health horizon **113.7→323.2h** (window probe caught the serve-box L2-restore flip at 21:52Z); far-hour +250h /grid = **200 in 0.62s** serving `icon_wind_wind_global_coarse_20260721T070000Z_estimated.json` (is_estimated:true, basis icon_loop_extrapolation, **629 vectors** = full 10° parity). NOTE: the summary log line is "extended-tail files", NOT the "14d loop-ext tail" prefix this row predicted — grep for "extended-tail" |
| 24 | **NEW (07-10 P8 curls): `grid_series` GFS/ICON marine regional = flat ~30s stall then 200** — the `GFS_ICON_SERIES_FASTPATH=1` live open-meteo fetch (grid_series_helper.py:336-351) times out at `OPENMETEO_SERIES_TIMEOUT=30.0` on EVERY probe (4×, hours=0 alone identical), then the per-hour loop serves stored instantly. The flag's documented trade ("instant manifest-coarse render for a live regional fetch") flipped negative with open-meteo degraded (this week's 503s) — worst case: every regional series page pays 30s; may explain client series "loads:N, hits:0" stalls | curls 07-10 ~22:15Z (window) + ~23:00Z (settled) ×4 all 30.3-30.4s; /grid same bbox 0.34s | **FIXED (07-11, option ② — evidence made the call): Render logs (API pull, 100 retained hits) split the failures 62% TimeoutError / 21% upstream 400 Bad Request (request-class, never self-heals) / 17% no-frames** — every attempt held a request slot up to 30s before the instant stored fallback. Mechanism discovered: the inner fetch is SHIELDED (keeps warming the provider 5-min cache after timeout) and the client's coarse-reval already re-fetches spaced retries — the SWR upgrade loop existed end-to-end; the 30s await bought nothing. Fix: await only `GFS_ICON_SERIES_FASTPATH_WAIT_SEC` (default 2.5s; =30 reverts) — warm-cache scrubs still return regional instantly (finding #3 preserved), cold falls back in 2.5s and the next reval picks up the warmed cache. 1 pinning test (hang → fallback <3s); backend 573. Follow-up candidate: negative-cache the 400-class bboxes |
| 12 | PostHog rrweb console+network capture serializes EVERYTHING (marine logged 4–6 lines/commit) | stack traces in every user log | MITIGATED (logs quieted `cb074b8b`; ungated [MapCore] observability block gated `3379b47b` 07-10 eve, opt-in `__RAW_MAP_OBSERVABILITY_LOG__`); posthog config un-audited |
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

## PHASE 4/10 — PIPELINE TRACES + LIVE LAYER ORDER (DONE 2026-07-10, preview 3007)
### Live z-order (via `map.style._order` — ⚠️ `getStyle().layers` OMITS custom layers; never audit order with it)
Bottom→top: `land(0)` · `landcover(1)` · **`webgl-marine-particles`(3)** · `landuse(4)` · `waterway(6)` ·
`water(7)` · `esri-satellite-layer(8)` · roads/labels(9-119, `country-label`=119) · `spot-geofences(120)` ·
**`webgl-wind-particles`(121)** · `rain-slot-0..2(122-124)` · `satellite-slot-0..2(125-127)` ·
`pressure-slot-0..2(128-130)` · `fog-slot-0..2(131-133)`.
- Marine BELOW landuse/water = the DESIGNED coastline sandwich (insert before `ocean-mask-fill`||`landuse`,
  WebGLMarineLayer.js:707; mask layers mount on activation + safeMoveLayer re-asserts). Marine also below
  `esri-satellite-layer` — eyeball satellite-basemap mode (queued).
- Radar frames anchor before `lightning-glow` (MapWebGL.js:408); lightning appends top at ITS mount time.
- **UNANCHORED APPENDS = time-of-add ordering** (wind, lightning, OM slots) — whoever mounts last wins.
- Custom layers persist mounted regardless of active state (render-skip via activeRef when off).
### Finding #17 (NEW, ordering): OM rasters (122-133) render ABOVE `webgl-wind-particles` (121) — active
fog/pressure/rain/vis-satellite washes dim/occlude the wind particle field. Time-of-add accident, not a
decision. OPEN — user call whether wind should ride above the rasters (a one-line anchored insert, but
layer-order changes are regression-adjacent: radar/lightning/mask ordering history).
### Per-pipeline traces (P4)
1. **MARINE**: `useWeatherState`(hour) → MapWebGL → `useMarineOrchestrator` (scrub-start prewarm :670;
   model-switch prewarm :726) → `marineController` (enqueue/fetch; terminal record :696; LRU50 caches
   `marineControllerCache`; series pages `marineGridSeries`) → `backendWeatherServiceClient.
   fetchBackendMarineGrid` (surfaces reason :510) → `/api/weather/grid|grid_series` → `grid_resolver`
   9-step ladder → L2 products / `viewport_service` dynamic build → `useMarineWindData` conform gate →
   `WebGLMarineLayer` (custom `webgl-marine-particles`) → `WebGLMarineEngine` (encoder split → 4096² mask) ·
   settle backstop `useMarineScrubSettle` (terminal bypass :396).
2. **WIND**: `WeatherEngine.js` hook (primary 5-min loop w/ renderable-retain · during-drag cache-only ·
   settle w/ series-first `21c1bf3a` + terminal-skip + hold-last-frame `06fbeef2` · moveend refetch ·
   scrub-start + model-switch prewarms `9494d8c2`) → `windController.fetchWindData` (per-model WIND_CACHE;
   safe-zero + terminal record) → `backendWindServiceClient` (404 detail surfaced) + `windGridSeries`
   pages → same `/grid` backend (`wind_horizon_fail_fast` `b0655047`; ICON `extend_icon_wind_to_14d`;
   EURO>240h resolver gfs_fallback) → `WebGLWindLayer` (custom `webgl-wind-particles`) → 147456-particle
   engine + RK4 SimLoop.
3. **OM RASTER** (pressure/fog/rain/vis-satellite): `openMeteoProtocol` worker decode (om://,
   BroadcastChannel, model lock target) → `map-tiles.open-meteo.com` CDN per-timestep .om → per-layer
   3-slot raster ring (`{layer}-slot-{0,1,2}-layer`, mounted at init, Raster Queue Transition) +
   `useTemporalPreloader`.
4. **RADAR**: RainViewer catalog+tiles via `/rv/*` edge proxy → per-frame raster layers (anchored before
   `lightning-glow`) + `advect-rv://` advection; HRRR `refp-t` future frames opt-in (`__RAW_RADAR_HRRR_FAR__`).
Shared spine: `useWeatherState` hour owner → `MapWeatherControls` scrubber (drag commits decimated ~11Hz
`cb074b8b`, radar exempt) → 5 raw-hour hooks → engines; FCE `useSimulationField` → renderPlan bridge.

## PHASE 5 — SILENT RENDER-FAILURE MATRIX (DONE 2026-07-10, code-proven)
Two client detectors exist; their combined coverage and the proven blind spots:
### Detector A: `weatherTruthTracker.js` (stage-lineage tracer, 11 stages: backendResponse → mappedGrid →
cacheWrite/cacheRead → orchestratorCommit → webglUpload → webglRender → animationFrame + point/infobox)
DETECTS: within-product stage DIVERGENCE (traceId/productId/dataHash/boundsHash vs previous stage of the
SAME product) → console.error + verdict BLOCKED (`window.__WEATHER_TRUTH_TRACE__`). Lineage=product by
design (zoom coarse↔regional swaps are legit cross-product moves — 2026-07-04 note in code).
BLIND SPOTS (all code-cited):
- **A1 Stage ABSENCE is invisible** — no completeness watchdog; a chain that dies after any stage leaves
  verdict=PASS. There is NO failure status (only OK/MISMATCH); a failed fetch records nothing.
- **A2 Observed domain = GFS-waves@h0 + wind@h0 ONLY.** Every call site gates `hourOffset === 0`
  (backendWeatherServiceClient:524, backendWindServiceClient:75/255/278/479, WeatherEngine commitWindData,
  windController cacheRead/Write) and marine sites additionally `model==='GFS' && layer==='waves'`
  (also mismatch scope, weatherTruthTracker.js:217/235). ⇒ ALL scrubbed hours + EURO/ICON marine + all
  swell layers are unobserved — the exact domain of this week's real bugs (EURO series, wind 500s,
  ingest gap, no-coverage blanks). Extending = per-commit hashing cost (629-vector FNV per stage) — a
  DECISION (finding #18), not a bug.
- **A3 Series-frame lineage orphaned**: series commits carry product `series_<model>_<layer>_h<N>` but
  webglUpload records `Product: undefined` + a different traceId (live-observed 07-10 log) — the
  same-product previousStages filter never matches ⇒ commit→upload divergence undetectable for series.
- A4 truthTag-less data silently skips recording (debug-gated warn only). A5 sink = console + window only.
### Detector B: `useLayerTruthDiff.js` (runtime invariants, 4 rules @4fps render/idle/moveend)
DETECTS: RASTER_OVERLAP (multi-family visible) · WIND_DATA_EMPTY + WIND_TOPOLOGY_INVALID (cols×rows≠len)
· MARINE_EMPTY_RENDER (transition-suppressed) · SOURCE_MISMATCH_FLASH (shared visible source).
BLIND SPOTS: **B1 console report is `NODE_ENV==='development'`-gated** (prod = HUD state only); **B2 only
`activeLayers[0]` is evaluated** for the empty-data rules (multi-layer states partially checked); B3 all
checks bypassed during scrubbing (`isScrubbingTimeline`) and MARINE_EMPTY suppressed by the 3 transition
flags (inherits stranded-flag risk — the 5f3d12c9 class); B4 radar frame layers excluded from the family
rule (sources don't match the `-source` naming convention).
### Complementary watchdogs (different failure classes, already shipped)
SimHealth (engine frame health) · engine guards w/ counters (no-downgrade, terminal-nocov ×2, marker-wedge
heal, debounce-strand heal) · backend `/api/health/data` (data-lane freshness/horizon) · TruthDiff HUD.
### Findings
| # | Finding | Status |
|---|---|---|
| 18 | Truth tracker observes only GFS-waves@h0 + wind@h0; stage absence + failed fetches invisible; series lineage orphaned (A1-A3) | **A3-marine FIXED `3c1b9aec`** + ✅ USER-LOG VERIFIED 07-10 eve (series_GFS_waves_h0 shared traceId 07504714 across commit/upload/render/animationFrame). **A3-wind FIXED** (next commit): the same user log exposed the WIND lane still orphaned (orchestratorCommit b5a30ffe vs webglUpload 620d8e2f, both Product: undefined) — extractWindAtOffset + windHourlyCache dropped identity, windGridSeries frames minted none; now cache/extraction carry truthTag+product_id through and series frames mint via buildTruthTag (3 pinning tests; preview-verified: all 5 wind stages one traceId + real product id). **A1 FIXED (07-11): stage-absence watchdog** — chains that start recording must reach a terminal stage (webglUpload+) within 30s or fire ONCE (console.warn + verdict.failReasons + `__WEATHER_TRUTH_ABSENT__` ring); display-lane supersession (domain-layer, model-agnostic) + resetTruthTracker clearing prevent transition false-positives; 5 pinning tests + 60s live noise-check clean. A2 (scope extension = per-commit hashing DECISION) still OPEN |
| 19 | TruthDiff prod-silent + first-active-layer-only (B1-B2) | **FIXED `3c1b9aec`**: B1 report un-gated (violations-only, 250ms-batched console.debug); B2 rules 2/3 evaluate ALL active layers. Follow-up (user log 07-10 late: `WIND_DATA_EMPTY:wind` fired during the DESIGNED activation window): RULE 2 now suppressed while `__WIND_FETCH_PENDING__`>0 (counter at the fetchWindData choke point, prewarms excluded; topology rule unsuppressed) — the wind mirror of RULE 3's transition flags; live-verified zero false fires on activation. Also fixed same session: MapWebGL tryInit re-init attempts from booted states (StrictMode/HMR) logged console.error ×6 — caller now no-ops on engine-ready/layers-ready/complete (sequencer assert unchanged). B3/B4 unchanged |

## PHASE 8 — API AUDIT (static sweep DONE 2026-07-10 eve; latency curls pending post-ingest)
**Surface:** 11 serving routes in `routes/weather.py` (products, grid_series, grid, point, spot-ratings,
buoy-/report-calibration, status, capabilities, client-diagnostics POST, diagnostics-log) + health.py +
marine_tiles.py + 16 POST `/ingest_*` triggers (weather_ingest.py — ALL admin-gated ✓).
| Item | Evidence | Verdict |
|---|---|---|
| #9 EURO wind contract | `capabilities.py:372-374` native:336/est:0, served live; ECMWF open-data=240h; >240h serves labeled `gfs_fallback` (b0655047); health native 218.7h | CONFIRMED wrong both fields; truthful = native:240 + fallback-labeled 240→336 (locked-doc; user decision) |
| ICON wind contract | `capabilities.py:348-350` = 120/216/336 — already promises the loop-ext tail | #22 makes stored reality converge to it (no contract change needed) |
| `/status` fabricates telemetry | weather.py:464-479: hardcoded provider_status "healthy" (still names open-meteo), stale_products_count:0, active_background_threads:1, last_errors:[] | Observability debt (#18/#19 class) — anything trusting /status is misled |
| `/client-diagnostics` | unauthenticated POST → unbounded append to backend/diagnostics.log; no size cap / rate limit | disk-fill + log-injection vector on the serve box (read side admin-gated) |
| `/products` | unauth full manifest + files_on_disk + absolute cache_dir path | info disclosure + unbounded payload |
| `/tiles/{layer}` (marine_tiles.py) | mounted; ZERO frontend callers; stale 3h-cadence premise; serves uploads/forecast_cache/*_global.json | DEAD legacy surface — retire |
| No Cache-Control on hot routes | /grid, /grid_series, /capabilities, /spot-ratings ship no caching headers | every request hits the 1-CPU origin; stored products are immutable per run → cheap slice of the North-star CDN lever |
| Healthy | gzip ≥500B + CORS middleware (server.py:435-439); /grid catch-all → CORS-safe no-coverage 404; 422 validation shape clean 0.25s; all ingest triggers admin-gated | — |
Also: GH concurrency note — a group holds ONE pending slot; a newer run (e.g. late cron) EVICTS a queued
dispatch as "cancelled, jobs: []" (observed 21:29Z 07-10: cron 29124845622 evicted dispatch 29124260482).
Same harmless class as runner contention, sharper mechanism.
**Latency (post-ingest settled box, 07-10 ~23:00Z):** health 0.25s · capabilities 0.17s · 422 shape 0.25s
· GFS marine regional /grid 0.34s · ICON wind global near 0.31s / **far +250h 0.62s (stored tail — was
504@40s pre-#22)** · spot-ratings 0.77s · ⚠️ **grid_series GFS waves regional = flat ~30.3-30.4s ×4**
(hours=0 alone identical → timeout-bound, NOT per-hour cost; == `OPENMETEO_SERIES_TIMEOUT=30.0`) → finding #24.

## PHASE 6 — OCEANMASK LIFECYCLE (documented 2026-07-10 eve; READ-ONLY — finding #14 minefield, DO NOT TOUCH)
**Truth composition rule (the "why" behind every guard):** the mask is composed from TWO sources —
Natural Earth (macro coastline) + basemap water tiles (meter-accurate micro: bays/lagoons/piers/
sheltered) — and every consumer must state which source it trusts for WHAT, within what distance
(inland guard ≤10km) and timing window (async repaint). Lifecycle per commit:
1. **NE rebuild** — every bounds-changing commit re-renders the mask NE-only via
   `renderMaskToCanvas` (WebGLMarineMaskRenderer.js:744); the basemap patch is NOT part of the
   rebuild (engine comment WebGLMarineEngine.js:274).
2. **Patch carry-forward** (maskSmoothing.js) — the last painted truth box (`_lastPatchedMask`)
   is transplanted SYNCHRONOUSLY into the fresh canvas (geo-exact drawImage; both canvases affine
   in MercY/lng). Refuses: antimeridian boxes, sub-2px src / sub-8px dst, dst canvases ≥30°
   (grey-rect hardening — world residency gets truth from overlay-REPLACE instead). Kill
   `__RAW_DISABLE_MASK_PATCH_CARRY__`; tel `__RAW_MASK_PATCH_CARRY__`.
3. **Async basemap-truth repaint** — `refreshMaskWithBasemapWater` (WebGLMarineEngine.js:1578):
   700ms throttle + tile-readiness gate (`areTilesLoaded()`); truth box recorded with 50% pad for
   the repaint hysteresis (~:1614-1720; `_lastMaskRepatchReason`, log lever
   `__RAW_MASK_REPATCH_LOG__`). Degraded paints (partial tile coverage → parent-fallback source
   query) NEVER hysteresis-lock and NEVER become carry sources — partial tiles bake FALSE LAND
   rectangles otherwise (the El-Salvador grey-rect class, `d7e89335`).
4. **Refinement passes (order matters)** — inlandWaterGuard.js runs BEFORE wetland/sheltered:
   basemap water only whitens ≤10km (Chebyshev chamfer) of NE water — "the basemap refines the
   coastline; it cannot invent new seas" (Salton-Sea class; kill
   `__RAW_DISABLE_INLAND_WATER_GUARD__`, tune `__RAW_INLAND_WATER_KM__`) → wetland dilation
   (`__RAW_DISABLE_WETLAND_DILATE__`, `a4795435`) → sheltered classifier (⚠️ lonSpan ≥10° skip;
   the socal tile is EXACTLY 10.0°) → wrap cull (`__RAW_DISABLE_WRAP_CULL__`, `f8d4f3fa`).
5. **Resolution tiering** — 50m↔10m GeoJSON swap gated by `desiredMaskRes` hysteresis (enter z≥8,
   exit z<7.3, maskSmoothing.js:107) since a single threshold fired a full `land_mask_res_swap`
   re-encode per straddling gesture; the ENCODER's last-mile hires substitution
   (WebGLMarineTextureEncoder.js:422-427, `__LAND_GEOJSON_HIRES_CACHE__`, span<30°) pins regional
   masks to 10m regardless, so most swaps change nothing visually.
6. **Encoder retain branches** (WebGLMarineTextureEncoder.js) — mask carry-retain
   (:489, tel `__RAW_MASK_RETAIN_COUNT__`) + mask-res no-downgrade retain (:502-512, kill
   `__RAW_DISABLE_MASK_NO_DOWNGRADE__`, tel `__RAW_MASK_RES_RETAIN_COUNT__`).
7. **Grid no-downgrade guard** (adjacent, same family) — `shouldRejectResolutionDowngrade`
   (WebGLMarineEngine.js:94; viewport snapshot :581; stash self-heal re-eval :613; kill
   `__RAW_DISABLE_NO_DOWNGRADE__`) + the useSimulationField ENGINE-PARITY twin (`d7e89335` —
   field/engine divergence = 8 RK4 rebinds/gesture; tel `__MARINE_FIELD_NO_DOWNGRADE__`).
**Matched pair (never revert one alone, `94072098`):** mask re-assert + overlay-REPLACE.
**Landmines:** Mapbox Streets v8 `water` has NO class field — class-based filtering is a NO-OP;
span guards must be checked against EXACT tile spans (≥10 vs ==10.0); probes = `__MASK_PROBE__`
(maskFloodProbe, engine import :11) + `__RAW_GPU__.inlandWaterGuard/.shelteredWater/.basemapWaterMask`.
**Perf verdict banked (P12):** fixed-viewport scrub = mode 'reuse', 0 rebuilds; zoom-out transition
churn = documented accepted class — DO NOT grind.

## SLICE ① SECOND HALF — ICON MARINE >168h SERVER-SIDE PRE-BAKE (DESIGN banked 07-11; implement AFTER the EURO-tail cycle verifies)
**Today (client-side, 3 /grid requests per far hour per viewport):** `fetchBackendMarineGridIconExtended`
(backendWeatherServiceClientHelpers.js:447) — 168<h≤240: persistence(ICON anchor@168, per-viewport cached)
+ GFS trend (anchor@168 vs target@h), weight ramp IDENTICAL to the backend `get_estimate_weights`
no-ICON path (0.70−0.30·d → ramp → GFS-1.0); h>240: `icon_gfs_euro_blend` branch; swell_2: inline
60/40 GFS+EURO blend (backendWeatherServiceClient.js:280+, ICON/GWAM has no native swell_2).
**Migration = parameterize the EXISTING rail, not new math:**
1. Anchor pool: last native ICON marine product per region/layer (mirror `euro_estimate_anchor_pool`).
2. Targets: GFS marine 3-hourly stored products 168→336h (already ingested to 14d).
3. Blend: `estimate_euro_grid` machinery with the ICON anchor in the persistence role, no third model
   (the weights path already exists as is_icon_valid=False); basis `icon_persistence_gfs_blend`.
4. ⚠️ GATE: `copernicus_validator.py:78` WHITELISTS basis types — add the new basis or products are rejected.
5. Save via Stage-6I.2 scaffold (new scheduler stage, kill `ICON_MARINE_EXTEND=0`); prune preserved by cf0b4b23.
6. Client: `fetchBackendMarineGridIconExtended` becomes the FALLBACK (resolver serves stored first —
   the fc0ec396/e1adb799 pattern); swell_2 blend stays client-side initially (own follow-up).
Effect: ICON/marine stored horizon 158→~330h; kills 3-fetch-per-hour far scrubs. Prereq: one clean
production cycle of the EURO-wind clone pattern (same rail, evidence first).

## REMAINING PHASES — QUEUE + RECIPES (next sessions; graph server ready: 34k nodes/73k edges)
- **P6 (OceanMask lifecycle):** DONE — section above (documentation only, code untouched).
- **P7 (particles):** SpectorJS (`tools/spectorjs`) + `__WIND_TELEMETRY__`; triage #10 (300 vectors) first.
- **P8 (API audit):** static sweep DONE (section above); remaining = latency curls on a quiet window.
- **P9 (races):** proven classes so far: test-during-deploy window; ingest estimate window; scrub-start-
  only prewarm; model-switch stale-discard storm. Hunt more via `__MARINE_CACHE_DIAG__` reasons.
  **Commit-site invariant audit (07-10 eve): 3/3 live wind commit sites renderable-guarded**
  (WeatherEngine.js:173/440/524; layer setWindData calls are pass-throughs of gated state).
  ⚠️ RenderPlanDispatcher.js:453 = 4th site, UNGUARDED but flag-gated OFF (`__ALLOW_FCE_WIND_UPLOAD__`);
  enabling it bypasses isRenderableWindData. WebGLSynchronizedOverlay.js = DEAD (comment-only refs),
  contains an unguarded engine commit — cleanup candidate.
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
