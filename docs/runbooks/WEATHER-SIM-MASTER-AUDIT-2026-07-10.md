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
| 9 | `capabilities` EURO-wind native:336 is FALSE (ECMWF open-data = 240h) — contract vs reality | curls + health | **FIXED `e1adb799`** (07-10 late): native:240 + estimated:96, max stays 336 (the only frontend-consumed field — verified zero consumers of native/estimated); fallback_sources stays [] (locked contract restricts it to EURO marine). Shipped WITH the slice-1 pre-bake: EURO wind 240-336h now saved on ingest as gfs_fallback clones of stored GFS products (euro_wind_extension.py, kill EURO_WIND_EXTEND=0, 3 hermetic tests). ✅ Cycle 29133472321 (07-11): horizon 229→331.4h + far +300h /grid 200 in 1.46s — BUT via the open-meteo FALLBACK path (ECMWF-direct failed that cycle), which exposed finding #26; the extension SKIP path verified live (native_max≥ceiling → designed no-op); the CLONE path executes on the next ECMWF-direct-successful cycle (native 240h). ICON-marine >168h half of slice-1 RE-SCOPED: the blend is FRONTEND-side (marine_mid_res_ingestion.py:44 — client recursively fetches GFS component grids); pre-baking it = migrating a client blend server-side = own design session |
| 10 | ICON wind returned **300 vectors** (vs 629) at far hours | live curls 07-10: far grid = COMPLETE 25×12 global, all nonzero, `is_estimated:true`, product `viewport_icon_wind_wind_*_-180.00_-80.00_180.00_85.00` | TRIAGED — NOT A BUG. Dynamic global wind build uses `target_pts=400` (viewport_service.py:163) → `choose_adaptive_resolution(360,165,400)`=√148.5=12.19 → 15° tier (route_helpers.py:137) → 25×12=300; stored ingest product is 10° → 37×17=629. Fires whenever the stored hour is missing (ICON wind >~113h ingested horizon, EURO >240h, or ingest-window gap = #7). User-felt = slightly coarser far-hour wind field. PARITY FIXED `bcbc25c6` + fitted timeout `95b42121` (the 629-pt fetch measured >20s on Render — every retry hit the 20s cap, parity never served; `WIND_GLOBAL_PARITY_TIMEOUT_SEC` default 40s, global wind only, EURO short-timeout override still wins). Kills `WIND_GLOBAL_PARITY_10DEG=0` / the timeout env. Deploy also surfaced latent finding #20 |
| 11 | Model switch unconditionally wipes OM block cache + discards in-flight (fetch storms on compare) | `useModelTransition` wipe + `_cb` nonce rotation BOTH predate the real leakage fix (model-keyed caches + model/run-pathed URLs `9f231d40`) — the wipe was vestigial; user log 07-10 eve: a dozen switches, each a full raster refetch ("not snappy") | FIXED `22eb81c8`: retention default (keys collision-impossible, LRU-bounded); kill `__RAW_OM_MODEL_WIPE_LEGACY__=1`. Live-verified: return-to-model leg = ZERO map-tiles requests (was a full latest.json+.om wave) |
| 22 | Cold dynamic global ICON wind builds >40s (both 3h-aligned and unaligned hours 504 at the fitted ceiling; success depends on background completion + caching) — far-hour ICON wind cold-scrubs feel bad and grind the 1-CPU box | live curls 07-10 eve (+168/+170h: 504 @40s ×2; +204h band served only after a prior bg completion cached it) | FIXED `fc0ec396`: the DWD-direct ingest path now ALSO saves the 14d loop-extrapolated tail (3-hourly, estimated, `icon_loop_extrapolation` basis; natives stay authoritative; cf0b4b23 prune preserves the old tail = continuity). Kill `ICON_WIND_EXTEND=0`. ✅ **VERIFIED run 29124845622** (21:29→22:48Z success, 07-10): log 21:40:25 "Ingested **52 ICON wind extended-tail files** (beyond 07-18)" on the DWD path (612 pts, 61 natives, from_dwd=True) + 21:36 startup hygiene purged 68 stale >120h AUTH products; health horizon **113.7→323.2h** (window probe caught the serve-box L2-restore flip at 21:52Z); far-hour +250h /grid = **200 in 0.62s** serving `icon_wind_wind_global_coarse_20260721T070000Z_estimated.json` (is_estimated:true, basis icon_loop_extrapolation, **629 vectors** = full 10° parity). NOTE: the summary log line is "extended-tail files", NOT the "14d loop-ext tail" prefix this row predicted — grep for "extended-tail" |
| 24 | **NEW (07-10 P8 curls): `grid_series` GFS/ICON marine regional = flat ~30s stall then 200** — the `GFS_ICON_SERIES_FASTPATH=1` live open-meteo fetch (grid_series_helper.py:336-351) times out at `OPENMETEO_SERIES_TIMEOUT=30.0` on EVERY probe (4×, hours=0 alone identical), then the per-hour loop serves stored instantly. The flag's documented trade ("instant manifest-coarse render for a live regional fetch") flipped negative with open-meteo degraded (this week's 503s) — worst case: every regional series page pays 30s; may explain client series "loads:N, hits:0" stalls | curls 07-10 ~22:15Z (window) + ~23:00Z (settled) ×4 all 30.3-30.4s; /grid same bbox 0.34s | **FIXED (07-11, option ② — evidence made the call): Render logs (API pull, 100 retained hits) split the failures 62% TimeoutError / 21% upstream 400 Bad Request (request-class, never self-heals) / 17% no-frames** — every attempt held a request slot up to 30s before the instant stored fallback. Mechanism discovered: the inner fetch is SHIELDED (keeps warming the provider 5-min cache after timeout) and the client's coarse-reval already re-fetches spaced retries — the SWR upgrade loop existed end-to-end; the 30s await bought nothing. Fix: await only `GFS_ICON_SERIES_FASTPATH_WAIT_SEC` (default 2.5s; =30 reverts) — warm-cache scrubs still return regional instantly (finding #3 preserved), cold falls back in 2.5s and the next reval picks up the warmed cache. 1 pinning test (hang → fallback <3s); backend 573. Follow-up candidate: negative-cache the 400-class bboxes |
| 26 | **NEW (07-11, live-caught during slice-① verification): EURO wind open-meteo FALLBACK path saved ALL 14d as NATIVE** — ECMWF IFS open-data is 240h; hours 240-336 are open-meteo's extension yet a fallback cycle labeled them is_estimated:False (the 7b89eadf-banned provenance class; also the origin of the false capabilities native:336 = audit #9) | manifest 07-11 ~02:20Z: 112 native EURO wind global products to +331h, 0 estimated; +300h /grid served is_estimated:False provider:open-meteo | **FIXED (07-11)**: fallback path saves hours >240 as ESTIMATED, basis `openmeteo_ifs_extended` (native_horizon_hours:240); ECMWF-direct + cache paths unchanged; backend 573. NOTE: existing mislabeled products age out next successful cycle (prune) |
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

## FINDING #30 — SATELLITE TILE DECODE-ERROR BURST (user log 07-11 ~15:1xZ; pipeline-3 / #25-adjacent; NEEDS ITS OWN FORENSIC SESSION)
User session (build `7b6a312d`→`f88594da` SW swap visible): ~15+ consecutive MapLibre
`InvalidStateError: The source image could not be decoded` from `tile_manager._loadTile →
raster_tile_source → image_request`, bursting immediately after satellite slot ping-pong
("Processing layer 'satellite' slot 0→1→1→2→2→0") + an EURO→GFS model flip. Session otherwise the
CLEANEST of the arc (marine committing, series cache warm, full truth-chain OKs). Evidence hook:
the SUCCESSFUL `server.arcgisonline.com/World_Imagery` fetches route through
**`openMeteoProtocol.js:272`** — the OM protocol's fetch wrapper intercepts the esri source's tile
requests, so the interception layer is a candidate amplifier (truncated/empty body from a
cancelled/aborted request handed to decode). Hypotheses to discriminate (recipe exists:
`__FETCH_OM_TILE__` black-patch triage + the #25 `__RASTER_SLOT_TELEMETRY__`): ① aborted preloads'
empty bodies fed to createImageBitmap ② ESRI rate-limit/error body with 200 ③ interception wrapper
mangling responses under slot churn. Ranked MED (self-healing black patches, no crash), same
session as #25.

## FINDING #28 — ROOT REVISED (07-11 04:0xZ, second live pass): THE WRITER IS A ROGUE LOCAL DEV BACKEND — designated-writer gate SHIPPED
**Forensic chain:** L2 `storage.objects` showed manifest.json last written 02:55:10Z size 6,609,397 —
a THIRD state matching NO upload in the GH run log → only ONE Render service exists, no workflow ran
at 02:55 → a LOCAL `server.py` (PID 65872, up 14h since 13:24Z 07-10, prod Supabase creds from
backend/.env, DISABLE_FORECAST_SCHEDULER unset → in-process 4h ingestion at 13:26/17:26/21:26/01:26Z)
was probed at :8000 — **its in-memory manifest stamp = `2026-07-11T02:55:05.750845` EXACTLY matching
the L2 manifest field**. Its manifest baseline = its 13:24Z boot restore (newest ICON marine
global_mid 13:07:28Z = exactly what health shows) + its own ingests, re-uploaded at each cycle end →
every GH-runner registration since is silently reverted, AND its prunes DELETE prod L2 objects the
prod manifest references (the dangling-entry minter — the runner's 02:15:19 delete-404s). The
within-run 02:19:50 size growth is likely legitimate concurrent batch-adds, NOT the clobber.
**USER-FELT blast radius (07-11 04:00Z live report):** EURO marine far-range 404s
(`no_copernicus_coverage` at h335/336 — the fresher estimate-tail registrations reverted) + ALL
marine layers churning: each EURO safe-zero clears the engine even with ICON/GFS active.
**FIXED (code):** designated-writer gate in store.py — top-level pipeline writes (manifest.json +
product files) and ALL deletes require `L2_WRITER=1` (set by scripts/ingest_forecast_ci.py — both
GH workflows — + sweep/purge tools); namespaced state blobs (`calibration/`, `spot_ratings/`)
ungated; kill `L2_WRITER_GATE=0`. If in-process Render ingestion is ever re-enabled, set L2_WRITER=1
on Render. 7 mechanism tests.
**REMEDIATION — COMPLETE (07-11 13:1xZ):** ① rogue local backend KILLED by user; ② repair run
29138494882 SUCCEEDED — live-verified: health all-green 0 alerts, manifest fresh (12:31Z cycle),
**ICON marine 168 estimated products tail 07-25T00:00Z = Stage-6I.3 CYCLE-VERIFIED (queue item ②
CLOSED)**, EURO estimated tail restored+advanced (128 products, 07-25T00:00Z).
**S3 ATTRIBUTION SHIPPED (safeguards report follow-through):** every manifest L2 upload now stamps
`written_by` ("designated:gh-run-<id>" / "non-writer:<host>") via the single serialization
choke-point `store.dump_manifest_for_l2` (7 call sites converted); `/api/health/data` reports
`manifest_written_by` and WARNS on a non-designated writer (the gate-bypass detector — absence is
surfaced but not alerted, transition-safe); the Data Health Monitor workflow prints it and
warn-annotates on missing/non-designated; in-process ingestion without L2_WRITER=1 now logs a loud
"local-only persistence" warning at scheduler start. This is the alarm that would have named the
rogue box at its FIRST clobber (~17:26Z 07-10), ten hours before it was user-felt.
**REMAINING (separate findings):** ⑴ far-edge contract gap — ✅ **FIXED (S4 shipped 07-11 ~15Z):**
`far_edge_hold.py` + two resolver wiring points (the marine wide-req empty-fallback and the terminal
no-coverage) serve the lane's LAST covered global frame relabeled (is_estimated,
estimate_basis.type=far_edge_hold, warnings marker) when the target is past the tail — TAIL-ONLY
(mid-range holes still fall through so ingest failures are never masked), overshoot bounded
`FAR_EDGE_HOLD_MAX_H` (24h default), marine+global-tile only, kill `FAR_EDGE_HOLD=0`. 7 hermetic
tests. Verify live: EURO marine h336 should now render the held tail frame instead of 404-blank.
⑵ NEW #29 (client): cross-model dead-target churn — with ICON/GFS active, EURO h336 refetches kept
firing (settle post-verify + backstop + model-switch manual fetch), safe-zero commits cleared the
engine cross-model, terminal-nocov suppression never engaged for this `no_copernicus_coverage` shape
(log evidence banked 07-11; interacts with the #27 hold — the clear sites fire while ACTIVE here,
so the deactivation hold does not cover this path).

## FINDING #28 (ORIGINAL WRITE-UP) — MANIFEST LOST-UPDATE CLOBBER (ICON marine victim; live-caught 07-11 03:2xZ; fix = DEDICATED INGEST SESSION)
**Symptom:** `/api/health/data` ICON/marine critical "stale 13.8→14.3h", horizon stuck 141h, while
every other lane fresh from the same 00:50Z cycle — and yet a global-bbox `/grid` probe serves the
FRESH 12Z GWAM product (run_time `2026-07-11T02:05:55.899798Z`, microsecond-matched to the run log's
"Starting scheduled job: ICON Marine Global"). Data safe; manifest wrong.
**Evidence chain (run 29133472321, all timestamps from its log):** ① ICON marine 12Z saves 02:15:09
+ "L2 upload OK" per file ② validator submit 02:15:50 "pruning 6" → manifest 6,562,099 ③ final prune
pass 02:19:47 "pruning 47 superseded" → manifest SHRINKS 6,553,392→6,508,272 (correct post-ICON
state) ④ **02:19:50 "[Scheduler] Manifest pruning complete." → re-uploads 6,818,758/6,814,960 bytes
— BIGGER and STALE, 3s after the pruned write** ⑤ serve box refreshes 02:55:05 → its manifest's
newest ICON marine = global_mid 13:07:28Z 07-10 + global_coarse 11:58:32Z (both 00Z-run relics);
the 12Z coarse entries ABSENT ⑥ the resurrected 47 old entries are DANGLING — their L2 objects were
already deleted (the 02:15:19 "L2 delete failed … 404" lines; the PRIOR 21:29Z run's same clobber
deleted them). **Mechanism:** two manifest writers at run end — the validator submit path vs the
scheduler's post-pruning write — last-writer-wins with a stale in-memory snapshot (f8c0c6b2's
oscillation FAMILY, different writer pair; the GH serial group serializes WORKFLOWS, not within-run
writers). Order-dependent: bites when ICON marine lands just before the final prune (00:50Z + 21:29Z
cycles; the 11:20Z cycle's registration SURVIVED). ⚠️ Affects the Stage 6I.3 verification: the 04:15Z+
cycle may run the ICON extension correctly and STILL lose the products to this clobber — check the
manifest (products endpoint), not just health, before judging the extension.
**Fix direction (dedicated session, manifest-write minefield):** single serialized manifest writer /
re-read-before-write (compare-and-swap on a manifest revision), and the final scheduler write must
rebuild from the store's CURRENT state, never a stage-start snapshot. Health hardening: flag
dangling manifest entries (file-missing) instead of counting them as live products.

## FINDING #27 — MARINE TOGGLE-CLEAR — ✅ FIXED `cee97385` (07-11 dedicated session; pending user live A/B)
**Fix shipped:** `shouldHoldClearOnDeactivate` extended — deactivation holds residents for a TTL
(120s desktop / 30s handheld) with no in-family flags set; `noteMarineActive()` resets the clock on
reactivation; expiry clears at the per-frame site. Live-verified in a preview drive: full
marine→wind→marine round trip = residents HELD (xfamHoldCount 2), return leg DUP-SKIPPED, GPU
textureCount delta 0 (no mask rebuild), 0 engine clears total; kill A/B restores the old clear with
`deactivate_toggle_off` attribution. VRAM finding: clearBuffers never freed the big residents anyway
— the hold only keeps the coarse-base FBO + `_waveData`, so the marginal VRAM is small. Radar
landmine DISCONFIRMED at code level (no radar code reads marine engine state). Kill:
`__RAW_MARINE_XFAM_HOLD_DISABLED__` / `__RAW_DISABLE_CLEAR_HOLD__`; tune
`__RAW_MARINE_XFAM_HOLD_TTL_MS__`; telemetry `__MARINE_XFAM_HOLD_COUNT__` + churn
`xfam_hold_expired`. USER A/B: compare-toggle marine↔wind on dev--rawsurf (reactscan OFF), expect
no heatmap blank + instant return; lever = the kill switch.
### Original finding (07-11, for the record)
User: toggling/scrubbing between marine and wind still shows heatmap CLEARING; "wind seemed a little
better than marine" — exactly the asymmetry the code predicts. Session log: `[WebGLMarineEngine-Clear]`
×8 + `High-resolution land mask texture created (4096x2048)` ×6 + repeated particle resets.
**Mechanism (all read-only verified):** `shouldHoldClearOnDeactivate` (marineTransitionCoordinator.js:46,
the 2026-07-06 transition-hold) holds resident GPU state ONLY while `__MARINE_TRANSITIONING__`/
`__MARINE_FETCH_PENDING__`/`__MARINE_FETCH_DEBOUNCING__` — i.e. IN-FAMILY model/layer switches. A
marine→wind (cross-family) toggle sets none → "real toggle-off" → BOTH clear sites fire
(WebGLMarineLayer.js:754 !active branch + WebGLMarineCustomLayer.js:113 per-frame edge) →
`clearBuffers` frees residents → the return leg pays full re-encode + mask rebuild + TWO particle
resets (clear → reactivate_refeed via the self-heal effect WebGLMarineLayer.js:981 → data_commit).
Wind's counterpart RETAINS (hold-last-frame 06fbeef2 + trail-keep 68e80179) — hence "wind better".
**Fix design (do NOT implement outside a dedicated session):** extend the hold to cross-family
toggles behind a kill switch (residents kept for a TTL after deactivation), with ① VRAM accounting
(mask 4096×2048 + wave/bathy/chl + coarse-base FBO), ② the "radar render-mode SUSPENDS marine
engine" landmine (radar activation may REQUIRE the clear), ③ mobile-tier gating, ④ user live A/B.
**Second question — PARTIALLY RESOLVED (07-11 second pass):** the mask retain machinery is INTACT
(4 guarded branches in WebGLMarineTextureEncoder.js:455-608, each with a documented same-day-regression
scar — this is P6/#14 minefield, do NOT touch casually); the ×6 rebuilds may be partially LEGITIMATE
(user panned/scrubbed between toggles → bounds changed → rebuild by design). Discriminate in the
dedicated session with EXISTING telemetry: after each toggle read `__MARINE_ENGINE__._lastMaskEncodeMode`
(reuse/retain_*/rebuild/rebuild_upgrade_over_retain) + `__RAW_MASK_RETAIN_COUNT__`/`__RAW_MASK_RES_RETAIN_COUNT__`
deltas — rebuilds at UNCHANGED bounds = the real defect; rebuilds after camera moves = design.
**⚠️ MEASUREMENT CONFOUND (user chime-in 07-11): React Scan is ACTIVE in the user's dev--rawsurf
sessions** — index.html gates it to localhost OR `?reactscan=1`, and the session logs show it
initializing on deploy-hash builds → the user's URL carries the opt-in. A live render-profiler
instruments EVERY component render: the felt "not snappy" + the 77-104ms rAF violations include its
overhead. Clean-feel baseline = re-test WITHOUT `?reactscan=1`; deliberate use = the render-churn
measurement tool for the #27 dedicated session. (Hygiene follow-up: the loader pulls floating
unpkg `latest` — pin the version.)
**Same-session notes:** two grid_series fetches FAILED network-level (EURO marine swell_1 h144-285;
GFS wind h288-384, both on a 204°-wide bbox — abort-vs-server split unresolved) · one `[SWELL2_DROP]`
(unexpanded) · `[Release]`/cache-MISS churn on rapid same-layer re-toggles worth an eye.

## FINDING #25 — PIPELINE-3 SCRUB FEEL (user-reported 07-11; NEXT AUDIT LANE)
User (07-11, build 4afc7c6b): fog + pressure intermittently slow to load; scrubbing wind/precip/fog/
satellite/marine "still slower than I'd like — need snappy". Log evidence: raster slot ring
PING-PONG under toggling (fog 0→1 then 1→0, pressure 0→1→0, satellite 0→1→2→0 — each transition
re-decodes .om) + one "Fetch failed loading: HEAD …2026-07-14T0900.om". ⚠️ DISPROVEN: that timestep
EXISTS (HEAD 200 re-probed) — the client failure was a CANCELLED PRELOAD (PostHog fetch-wrapper stack
→ fetchRetry → preloader), i.e. scrub moved on: do NOT chase the 404-blacklist theory for this URL.
Recipe (own session, live instrumentation — preview measurements unreliable for perf): ① count slot
transitions + .om decodes per scrub step (worker-side timing via BroadcastChannel telemetry);
② preloader window size vs scrub speed (useTemporalPreloader); ③ HEAD-abort rate under scrub;
④ decode-cache hit rate across repeated hours. Pipeline 3 is already CDN-pre-baked — slowness is
CLIENT-side (decode cost / slot thrash / preload window), a different class than pipelines 1-2.
ALSO (radar-adjacent observation, do NOT conflate with the three CLOSED radar failure shapes):
scrubbing radar into the past briefly clears then self-heals — likely first-past-frame tile load
inside the preload window (133ca705 territory); brief + self-healing = LOW, note-only.

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
