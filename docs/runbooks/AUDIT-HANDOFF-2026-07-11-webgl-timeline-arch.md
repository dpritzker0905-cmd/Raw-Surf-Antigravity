# AUDIT HANDOFF — WebGL / Timeline / Layers / Races / APIs / Particles / Architecture / Feature Matrix
**2026-07-11. Read-only synthesis: this week's LIVE-verified findings (#1–#27, master audit) + fresh
static GPU forensics. Zero code modified. Where a verdict needs the user's live GPU session it says so
— preview-pane FPS/rAF measurements are DOCUMENTED-UNRELIABLE (unresolved 1Hz-rAF confound), and the
user's own sessions were profiler-contaminated (`?reactscan=1`) until flagged tonight.**

## 1. WEBGL PERFORMANCE AUDIT
**Large allocations (by size):** ① land-mask texture, tiered to 4096×2048 RGBA ≈ **33.5MB** — the
single largest; tracked in `__RAW_GPU__.gpuMemoryEstimate` (its decrement bug fixed 07-05, was
poisoning OOM forensics). ② wind particle state textures 384²=147,456 particles (ping-pong pair).
③ marine crest geometry 87,616 quads = 525,696 verts (static, init-once). ④ wind trail FBOs
(screen-sized pair). ⑤ marine coarse-base FBO. ⑥ per-commit wave/bathy/chl textures (grid-sized, small).
**Duplicate textures:** none live-confirmed; the risk site is mask rebuilds across toggles — audit #27
recipe discriminates with existing telemetry (`_lastMaskEncodeMode` at unchanged bounds = defect).
**Memory leaks:** historical classes FIXED (`726ab13f` pipeline leaks; texture-count telemetry;
PRODUCT_CACHE LRU `669ccc56` backend). Encoder has a transactional rollback (deletes allocated textures
on error — verified in code). `safeDeleteTexture` guards engine deletes. No unbounded growth signature
in any banked session; `__RAW_GPU__.textureCount` is the watch metric.
**Framebuffer recreation:** init-only (WebGLWindEngineInit.js:102 advFBO; marine equivalent). Trail
FBOs recreated ONLY on data-driven reseeds — camera reseeds keep them since `68e80179` (was the
pan/zoom blank, #23). **Shader recompilation:** NONE at runtime — all programs compiled once at init
(WebGLWindEngineInit.js:54-58 ×5, WebGLMarineEngineInit.js:110-112 ×3). Color-ramp re-upload on
theme/maxWindSpeed change is 256×1 (trivial). **Uniform updates:** 52 call sites (wind) / 121 (marine)
across the per-frame passes — moderate; no live bench flagged them. **Buffer uploads:** geometry
init-once (0 `bufferData` in render files); runtime uploads are the DATA path (texture encodes per
commit). **Unused GPU resources:** WebGLSynchronizedOverlay DELETED tonight; RenderPlanDispatcher wind
upload flag-gated OFF (`__ALLOW_FCE_WIND_UPLOAD__`) — engine registered but path dormant (and
UNGUARDED if ever flipped — audit P9 note); FCE marine render path disabled (06-30 verdict).
**FPS bottleneck estimate (measured, not guessed):** engine steady-state is NOT the bottleneck —
3 live benches, 30 FPS all zooms (#13 CLOSED, do not reopen). The felt jank ranked: ① WAS React
commit-rate 40-60/s ×62ms reconcile (FIXED `cb074b8b` decimation) ② WAS wind trail-FBO clears per
gesture (FIXED `68e80179`) ③ REMAINING: #27 marine cross-family toggle-clear (re-encode + mask
rebuild + 2 particle resets per return leg — THE open user-felt item, fix designed) ④ pipeline-3
slot/decode churn (#25, instrumentation shipped, needs the user's clean session). True frame profiling
= P7: user session + SpectorJS (`tools/spectorjs`), with `?reactscan=1` OFF for baseline, ON for
render-churn attribution.

## 2. TIMELINE ENGINE
**Position:** `useWeatherState` owns the hour; `MapWeatherControls` scrubs at 60fps locally, commits
decimated ~11Hz (`cb074b8b`). **Forecast selection:** `getSharedValidTime(hour, domain, model)`;
scrubber window = capabilities `max_forecast_hours` ONLY (LayerAccessResolver; contract now truthful
after #9/#26). **Interpolation:** marine = texture crossfade between committed hours; wind = continuous
advection over the committed field; OM rasters = 3-slot ring transitions; radar = per-frame layers.
**Cache invalidation:** model-keyed retention across switches (`22eb81c8`/`9f231d40` — NOT wiped);
series pages TTL'd; negative caches 60/120s; terminal no-coverage trackers per lane (`d38a693b` marine,
`06fbeef2` wind) stop doomed refetch churn. **Particle reset:** data-driven bounds change → full reinit
+ FBO clear (by design); camera-driven → trails kept (#23). **Texture updates:** per settled commit;
mid-scrub coarse↔regional flip held (`b1f19453`).
**Can scrubbing produce stale simulation fields? YES — historically five distinct ways, ALL now
guarded:** stale-model fetch commit (guard: req model/hour discard), settle re-driving dead hours
(terminal trackers), safe-zero commits blanking layers (renderable-guards at ALL 3 wind sites — the
one dormant unguarded site was deleted tonight), rendered≠requested drift (post-scrub verification),
silent chain death (A1 absence watchdog, 07-11). **REMAINING documented gap:** FCE
(`useSimulationField`→renderPlan) is NOT display-decoupled (§7 guardrail) — the engine-parity guard
(`d7e89335`, `__MARINE_FIELD_NO_DOWNGRADE__`) pins field==engine resolution, but the bridge remains
the one place a non-displayed field can evolve; ranked LOW with the parity guard, flagged for P14.

## 3. MAPLIBRE LAYERS — RENDER ORDER
⚠️ Rule: audit z-order via `map.style._order` ONLY — `getStyle().layers` OMITS custom layers (landmine,
fooled forensics before). Live dump (P10, 07-10): basemap → OceanMask land fill → marine heatmap/crests
(custom) → 12 OM raster slots (fog/pressure/rain/satellite ×3 slots) → **wind particles TOP** (121→132
after `bcbc25c6`) → radar frame-layers (own family) → labels. **beforeId usage:** marine anchors via
marineBeforeId; OM slots anchor before `webgl-wind-particles` via a styledata-tracked beforeId
(`bcbc25c6`, kill `__RAW_OM_SLOTS_ANCHOR_DISABLED__`); radar per-frame layers self-managed.
**Insertion timing:** engines add on style-ready; early attempts log "Failed to add layer: Style is not
done loading" then retry via RenderContract STYLE_LOADING gate + the transition safety fallback —
benign at boot (bootstrap double-init errors silenced `940cda61`). **Visibility:** OceanMask
syncLayers hide/show; raster slots toggle per transition. **Opacity:** precip bold pass `6b6e5d64`;
wind fade pass ages trails. **Mask ordering:** OceanMask land fill above heatmap, below labels —
matched pair with overlay-REPLACE (`94072098`, never revert one alone). **Canvas stacking:** single
MapLibre canvas; all weather renderers are custom layers within it (no separate stacked canvases since
the overlay deletion). **Could a layer accidentally cover another? It DID** — #17, OM rasters washed
out wind (unanchored appends = z-order by time-of-add), FIXED with anchoring. Remaining risk = any NEW
`addLayer` without beforeId lands on top; the invariant is documented, not enforced — a lint/runtime
assert is a cheap P14 hardening candidate.

## 4. ASYNC RACE CONDITIONS
Proven classes + status: ① style-load timing (deferred fetches + safety fallback + tile-readiness
gates — the mask painter refuses partial-tile paints, `d7e89335` class) ② React effect re-runs
(StrictMode/HMR double-init — caller no-op fix `940cda61`; CRA jest resetMocks landmine) ③ shared
in-flight context cancellation poison (`db94a7c3`: CancelledError=BaseException, shields ×4 + reap —
**Render-edge-only, un-reproducible locally**) ④ model-switch stale-discard (guards + retention)
⑤ scrub-start-only prewarm (`9494d8c2`) ⑥ ingest estimate window (`cf0b4b23`, awake-probe verified)
⑦ stranded fetch-marker wedge (zero-network signature; watchdog was blind → A1 now fires ABSENT;
remedy hard-refresh; root un-caught) ⑧ GPU/canvas init: sequencer state machine (idle→map-ready→
engine-ready→complete) with a hard too-early assert ⑨ L2-restore windows (serve box refreshes
manifest ~30min — the f8c0c6b2 oscillation class, fixed) ⑩ GH pending-slot eviction (ops).
**Can timing alone explain intermittent rendering bugs? YES — proven repeatedly this week**; it is
exactly why the binding test discipline exists (never judge during deploy/ingest/stale-SW windows).
The remaining timing-shaped unknowns: #21 (un-reproduced ×4) and the wedge root (⑦).

## 5. WEATHER APIs
**Endpoints (serving):** `/api/weather/` grid, grid_series, point, products, spot-ratings, capabilities,
status, buoy-/report-calibration, client-diagnostics(POST), diagnostics-log · `/api/health/data` ·
16 admin-gated `/ingest_*` triggers · external: map-tiles.open-meteo.com (.om tiles, run-pathed CDN),
RainViewer via `/rv/*` edge proxy. **Refresh:** ingest 4h cron (GH runner → Supabase L2 → Render
serve-only; providers DIRECT per the data-source matrix — GFS→NOAA, ICON→DWD, EURO→ECMWF+Copernicus;
open-meteo = FALLBACK only). Client: series TTL + coarse-reval; SWR 1.5s retry; negative cache 60/120s.
**Caching:** client model-keyed LRU + series pages; store L1 disk + L2 Supabase; **no HTTP
Cache-Control on hot routes** (P8) — safe CDN requires run-keyed URLs first (f8c0c6b2 scar vs 84bb1351
precedent). **Normalization:** single WeatherNormalizer via normalize_and_save_loop (ingest) and the
same resolver for /grid + series. **Error handling:** CORS-safe no-coverage 404s (catch-all), fail-fast
wind-horizon 404s, structured 504s, shielded shared futures. **Fallbacks (resolver ladder):** stored →
dynamic viewport → EURO→GFS relabeled (honest `gfs_fallback`/`gfs_estimated_fallback`) → forecast_cache
recycle (ESTIMATED from h0). **Mock data:** test-fixture guard refuses non-test saves; mocks only via
`_fetch_or_mock` in test env; runner runs NODE_ENV=production. **Missing fields / landmines:** vector
metadata mirrors eat fields (is_valid/dirConfidence class; A3 fixed truthTag in 2 lanes); `speed` IS
wave height backend-side. **Invalid assumptions caught this week:** capabilities native:336 (#9),
fastpath premise (#24), fallback-14d-as-native (#26) — all fixed. **Where API data becomes simulation
data:** JSON → backendWeather/WindServiceClient mapping (metadata preserved) → controller caches →
orchestratorCommit/commitWindData (truth-tracked) → `encodeMarineTexture`/`setWindData` → GPU field
textures → advection samples them; in parallel `useSimulationField` builds the CPU field for RK4
SimulationLoop (3,000 marine / 6,000 wind CPU particles) via renderPlan (dispatcher marine path live,
wind path gated off).

## 6. PARTICLE ENGINE
**Spawning:** wind seeds 384² positions in ping-pong state textures at init; marine crests are 87,616
static quads animated by phase; CPU RK4 systems (3k/6k) spawn from field bounds. **Lifecycle/death/
recycling:** GPU-side in the advection GLSL (drop-rate + random respawn — standard wind-gl; not in JS,
hence zero JS-side lifecycle code). **Velocity:** advection pass samples the u/v field texture
(bilinear); step scaled by `advection step` (logged in WIND-TELEMETRY; ⚠️ uMin/uMax = COMPONENT ranges,
not bounds — fooled forensics twice). **GPU buffers:** state textures ping-pong through advFBO;
draw pass renders points/quads; trail accumulation via screen FBO + fade pass. **Frame updates:**
fixed-timestep RenderOrchestrator v2. **Timing:** fade ages trails <1s (the crossfade trade, #23).
**Triage guide when particles look wrong:** coarse/blocky field → SAMPLING/data resolution (the
300-vector 15° tier class — NOT sim); particles over land → mask SAMPLING (check
`__RAW_GPU__.inlandWaterGuard`/mask probes); frozen/blank → commit path (renderable guards, A1
watchdog now fires); wrong speeds → maxWindSpeed ramp rescale events; equator-clamped at far zoom
(#21) → UNRESOLVED, capture recipe in audit row; interpolation artifacts at tier crossings → tile
recenter class (trails kept post-#23). Sim math itself (RK4/advection) has NO open defect.

## 7. ARCHITECTURE VIOLATIONS (ranked)
1. **HIGH — #27 marine cross-family toggle-clear asymmetry**: wind retains (hold-last-frame+trail-keep),
   marine hard-clears via the `shouldHoldClearOnDeactivate` scope gap. Root-caused; fix designed;
   dedicated session (radar-suspend landmine + VRAM + A/B). THE user-felt item.
2. **HIGH (latent) — FCE/renderPlan not display-decoupled** (§7 guardrail) + the dispatcher's dormant
   wind path bypasses `isRenderableWindData` if `__ALLOW_FCE_WIND_UPLOAD__` is ever enabled.
3. **MED — three scrub pipelines, fixes don't transfer** (§G structural; the cost shows every week).
4. **MED — legacy `forecast_ingester.py` writer + git-tracked runtime fallback files** (tests churn
   them; only consumer is the last-resort recycle path).
5. **MED — per-pipeline metadata mirrors** (each client mapper re-lists fields; the "field lists eat
   fields" class produced A3 twice; a shared mapper or spread-with-blocklist would end the class).
6. **LOW — estimator EURO-branding reused for ICON via relabel wrapper** (deliberate, documented,
   tested — but a rename-to-generic refactor is the clean end-state).
7. **LOW — `scratch_*.py` files in backend root; pilots workflow overruns to its timeout.**
CLOSED this week: WebGLSynchronizedOverlay (dup renderer, deleted), marine_tiles route (dead API),
`/status` fake telemetry (documented P8), unguarded commit sites (0 remain), vestigial model-switch
wipes, client-only ICON far blend (now also server-baked).

## 8. FEATURE MATRIX (intended vs actual)
| Feature | Status | Production gap |
|---|---|---|
| Wind | ✓ | Tails pre-baked BOTH models; resilience arc complete. Open: #21 far-zoom report (un-reproduced) |
| Waves | ✓ | EURO best-in-class; GFS/ICON good (fastpath + SWR budget) |
| Swell 1 | ✓ | — |
| Swell 2 | ⚠ | ICON has NO native swell_2 — client 60/40 GFS/EURO blend synthesizes it (works; unbaked server-side; [SWELL2_DROP] event un-diagnosed) |
| Wind Waves | ✓ | — |
| Rain (precip) | ⚠ | Functional (pipeline 3 + bold pass); scrub feel UN-AUDITED = #25 (instrumentation shipped, needs clean user session) |
| Clouds (fog) | ⚠ | Same #25 class; fog slot ping-pong observed in user session |
| Pressure | ✓ backend / ⚠ raster feel | Backend all 3 models direct; raster scrub = #25 |
| Temperature | ⚠ UN-AUDITED | OM protocol registers temp-capable color scales; no verified UI layer exercise — one session to confirm exists/works |
| Satellite | ⚠ | Functional; black-patch triage recipe exists (`__FETCH_OM_TILE__`); #25 class |
| Ocean Mask | ✓ | Heavily guarded (P6 documented); minefield — document-only |
| Timeline | ✓ | Guard rails complete (decimation, settle, terminals, holds); stale-field vectors all closed (§2) |
| Animation | ✓ | 30 FPS verified all zooms; remaining felt gap = #27 toggle blank |
| GPU Particles | ✓ | Wind 147k + marine crests + CPU RK4; init-once shaders/FBOs verified |

## NEXT SESSION QUEUE (post-audit, Jacobian order)
1. **#27 dedicated session** (design + discriminator + React-Scan-deliberate ready).
2. Verify the 04:15Z+ cycle: ICON/marine 153→~330h + `icon_marine_*_estimated.json` + EURO clone path
   (needs ECMWF-direct success).
3. #25 with the user's CLEAN session (`?reactscan=1` OFF) reading `__RASTER_SLOT_TELEMETRY__`.
4. P7 SpectorJS on the user's machine; then P14 readiness score.
5. Cheap hardenings surfaced here: beforeId runtime assert; pin react-scan version; negative-cache
   fastpath 400-bboxes; shared client mapper (ends the A3 class).
