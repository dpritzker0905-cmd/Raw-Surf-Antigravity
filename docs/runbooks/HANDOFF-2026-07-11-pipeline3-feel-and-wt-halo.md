# HANDOFF — Pipeline-3 Feel Session SHIPPED (#31/#25/#30) + Water-Temp Coastal Halo ROOT-FIXED
**2026-07-11 (the pipeline-3 session the previous handoff called for). dev local, ready to push.
FE suite green (97/781 — +1 suite/+4 tests over the 96/777 baseline). All fixes preview-verified
where the preview can observe them; the rest is one user eyeball pass (§4). Supersedes the queue
in HANDOFF-2026-07-11-temp-pair-close-and-raster-flash.md.**

## 0. USER DECISION RECORDED (temp-pair §1b question — CLOSED)
User: keep Air Temp tri-model with silent GFS on the ICON tail, keep Water Temp bi-model with
ICON silently serving GFS at every hour. Optional future: differentiate ICON water temp with
estimate science ("fresh perspective") — NOT built this session (feature-fatigue rule; design
note in §5). No code change; the rain-convention consistency stands.

## 1. #31 DOUBLE-FLASH — FIXED + LIVE-VERIFIED (preview)
**Measured mechanism (instrumented preview, GFS→EURO with a raster active):** t+90ms
`setIsTransitioning(true)` → declarative blank of ALL raster slots → `isStyleLoaded()` false
(ambient: geofence setData churn) → 2s safety fallback → restore at t+2162ms. **The "flash" is a
≥2.1s full-raster blank that restores THE SAME (old-model) tiles** — pure vestige of the legacy
wipe era (pre-9f231d40 retention). Flash #2 = the 2s slot-flip TIMEOUT force-flipping onto a slot
whose cold .om decode wasn't done → transparent until decode. The user-log "Transition finished
×2" = the boot window where BOTH finish arms (once('load') + 2s fallback) fire — they never
cancelled each other and leaked per switch.

**Fixes (all kill-switched):**
- **MapWebGL.js `openMeteoRasterSlots`:** visibility/opacity no longer gated on `isTransitioning`
  — rasters hold the last frame through model switches (the marine #27 retain philosophy).
  Kill: `__RAW_MODEL_SWITCH_BLANK_LEGACY__ = true` (restores blank-out AND re-enables the paired
  imperative restore in finishTransition — matched pair, never split).
- **useModelTransition.js:** finishTransition run-once + mutual disarm (load listener ↔ fallback
  timer) + effect-teardown disarm. The imperative slot restore is legacy-gated (its opacity table
  is pre-bold/pre-temp-pair; re-applying it over the declarative paint with no react diff to
  correct it = the dual-control race the NOTE in useOpenMeteoTileUrls warns about).
- **useOpenMeteoTileUrls.js `runTransitionsAudit`:** slot force-flip timeout 2s→10s when the
  layer has content on screen (cold start keeps 2s). Bounded: the om protocol resolves every tile
  terminally (data / 404-blacklist transparent / error transparent). Kill:
  `__RAW_SLOT_FLIP_TIMEOUT_LEGACY__ = true`.

**Live verification (preview, water_temp active, GFS→EURO):** 42 visibility polls across the
switch = `visible,visible,visible` throughout (pre-fix: 2.1s of `none`); exactly ONE
"Transition finished"; 0 imperative hides; slot flip loaded-gated at t+2.96s (no force-flip).
Tests: `useModelTransition.finishOnce.test.js` (4 tests: single-finish both arms, no-restore
default, legacy restore exact).

## 2. #25 / #30 — SHIPPED MITIGATIONS (user eyeball to close)
**maplibre-gl 5.24 source verdict (corrects the banked #25 diagnosis):** parent/child substitute
retention at pyramid crossings is fade-INDEPENDENT in 5.x (`_updateRetainedTiles` +
`_retainLoadedChildren`, maxOverzooming/maxUnderzooming caps). What fade>0 adds: the deeper
2-generation descendant search (`updateFadingTiles`, gated `fadeDuration > 0`) + soft pop-in.
The real gap = no loaded substitute within range at the crossing + slow cold .om decode +
**`cancelPendingTileRequestsWhileZooming` default TRUE cancelling in-flight .om loads mid-gesture**
(also the #30 aborted-buffer decode suspect).
- **Map init:** `cancelPendingTileRequestsWhileZooming={false}` (om tiles too expensive to
  throw away mid-zoom). Init-time kill: set `__RAW_CANCEL_ZOOM_TILES_LEGACY__ = true` BEFORE map
  mount.
- **Fade A/B:** the temp PAIR (Air Temp + Water Temp — the user-reported zoom-clearing layers)
  gets `raster-fade-duration: 200`; rain/fog/pressure/satellite keep the deliberate 0 as the
  control arm. (Originally Air-only; widened after the user re-reported water_temp clearing —
  testing the broken layer as the fade-0 arm would have made the A/B unreadable.) Radar
  precedent: frame-layers already ship fade 180 for the same "clear then fill" symptom. Tune
  all: `__RAW_RASTER_FADE_MS__ = <ms>`; force 0: `__RAW_RASTER_FADE_DISABLED__ = true.
  **A/B recipe: compare the temp pair vs Precip on the same zoom crossing.**

## 3. WATER-TEMP COASTAL HALO — ROOT-CAUSED IN DATA + FIXED (user report this session)
**Forensics (live decoded-grid sampling via `window.__DECODED_OM_TILES__`):** the halo is NOT a
style/mask layer — the mask covered land correctly in preview (probe trap log: the "orange inland
band" first read was a traffic-paint motorway pixel + geography misread — bisect before
believing pixels). The DATA carries it: gfs013 `surface_temperature` is SKIN temp; cells
containing land carry land heat. Catalina cell 20.05°C vs 17.75°C open water (+2.3°C, night
timestep; mainland LA cell 27.45°C — daytime halos are far worse), and the steep palette turns
+2° into green→yellow ring; `contours=true` traces the fake island gradients (the gray smudges).
**Grid orientation landmine: row 0 = SOUTH (GFS ascending-lat). A row-north read mirrors you into
the opposite hemisphere and produces plausible-flat garbage — validate with a Sahara/Antarctica
probe pair before trusting any sample.**
**Fix (openMeteoProtocol.js, final form `981c4cfd`):** decode-level OCEAN-FILL for
`surface_temperature` only — land cells take the mean of clean water neighbors (3 breadth-first
dilation passes; NE 50m polygons rasterized to the grid via OffscreenCanvas, row-south aligned),
deep interior NaN'd (under the opaque mask anyway). Field runs continuous to the coastline with
water-derived values (LA-coast cell 20.4°C filled vs 27.5°C raw land heat). The intermediate
NaN-only version left a no-data MOAT that read as a worse band on ifs025 (whole SoCal bight
empty) — user-reported, corrected same session. Kill: `globalThis.__RAW_WT_LANDMASK_DISABLED__`.
Residual soft coastal gradient = real nearshore warmth + model-internal land influence
(not removable client-side, physically plausible).
**Hardening round (after the user re-reported persistence — which was pre-deploy, but the
probes exposed two REAL gaps):**
1. **Lazy-build race:** the first decode per grid-dims rendered unmasked and the library CACHED
   it (probed live: first ecmwf decode kept Catalina 20.2°C). Fixed: masks for both water-temp
   grids (gfs013 3072×1536 bounds [-180,-89.912…,180,90.029…]; ifs025 1440×721
   [-180,-90,180,90.25]) pre-build at protocol REGISTRATION (shared geojson fetch), plus a
   belt-and-suspenders heal: an unmasked decode flags the entry → mask-ready dispatches
   `rawsurf:wt-landmask-ready` → useOpenMeteoTileUrls rotates wt URLs once (`&wtlm=1`) → fresh
   masked decode replaces the poisoned cache.
2. **Pixel-dilation trap:** canvas `lineWidth` is in CELLS, not km — lineWidth 2 on ifs025
   (0.25°≈28km/cell) merged the Channel-Islands moats and NaN'd water 60km offshore (socal60km
   MASKED on EURO while GFS was fine). Fixed: lineWidth 1 (alpha>0 already counts partial AA
   coverage = every land-touching cell; the 1px stroke only adds the straddler margin).
**Verified (fresh reload, both models):** FIRST decodes masked (Catalina/mainland/Sahara NaN) on
gfs013 AND ifs025; open water intact (GFS socal35km 20.1°C, EURO socal60km 17.5-17.8°C, mid-Pac/
S.Atl/North-Sea/Tasman/Indian/GoM all live); Caribbean-wide EURO screenshot: every island cleanly
masked, zero halo rings, no console errors. **ECMWF grid also row-0-SOUTH (Sahara 34.7°C-day /
Antarctica -41°C probe).** Air Temp (`temperature_2m`) deliberately untouched — it SHOULD render
over land.

## 3b. BLEED-THROUGH ROUND (`92b0c754`, same day — three more water_temp roots, live-verified)
A translucent raster (0.45-0.62) exposes every style layer beneath it — the opaque above-all
marine engine never showed any of this. ① ocean-mask-buffer (marine coastline blend band) under
the field = the "halo band bleeding through" → gated to marine-active (OceanMask #9,
`__RAW_WATER_TEMP_COAST_BUFFER__` force-on). ② repositionLanduse-raised green fills — including
MARINE parks over open ocean (Silver Bank sanctuary = the giant olive "shapes under water") →
gated to marine-active + restore-on-deactivate (OceanMask #10, `__RAW_WATER_TEMP_GREEN_LANDUSE__`).
③ "deep hot red spot off Marsh Harbour" = 47.3°C (cluster 38.5/34.1/33) midday land-skin in
cells GFS's own landmask calls land but NE-50m misses (Abaco cays) → mask dilation restored to
lineWidth 2 (safe under ocean-fill: fills, not holes) + coastalOutlierQC (2-cell coastal ring,
symmetric >3°C deviation vs 9×9-stride-2 local water median; kill
`__RAW_WT_COASTAL_QC_DISABLED__`) — Abaco window now 29.3-30.9°C across all 81 cells. Plus
street-zoom fade: wt opacity 0.62 → 0.12 across z12.5-15 (one SST cell spans the viewport;
NE-10m coast error dominates; kill `__RAW_WT_HIGHZOOM_FADE_DISABLED__`); full field at the z12
GPS default. **Also explained: "not showing at default load zoom" = z12 GPS coastal view on the
NaN-moat bundle (every viewport cell in the moat) — ocean-fill resolves it.**

## 4. USER EYEBALL PASS (the close-out; dev--rawsurf AFTER push+deploy, SW BUILD_VERSION==HEAD)
1. Model flips GFS↔EURO↔ICON with each raster — expect NO flash (field holds, one clean swap).
2. Water Temp mid-zoom clearing (the user's report): zoom coast z2→z9→z2. NOT reproducible in
   preview (field rendered fine at z7/z9) — most plausible root = #25 pyramid cold-decode, which
   this ships against. If it persists: probe `__DECODED_OM_TILES__` + tile states at the cleared
   zoom, and A/B `__RAW_RASTER_FADE_MS__ = 200` (water_temp is the fade-0 arm of the A/B).
3. Water Temp coasts/islands: halo should be a slate no-data moat now. If the moat reads too wide
   at z10+, drop the mask stroke to lineWidth 1 (one-line change).
4. Satellite + model flips + zoom: #30 decode-error bursts should be gone/rare.
5. Air Temp vs Water Temp zoom-crossing A/B (fade 200 vs 0) — pick the winner, then set it
   family-wide via `__RAW_RASTER_FADE_MS__` verdict.

## 4b. LATER SAME SESSION — activation affordance + S2 SHIPPED
**Air-Temp-on-ICON "doesn't load" (user report):** cold-CDN-edge .om fetch latency on the less-
trafficked models (GFS = default = always edge-warm; warm-edge activation measured 916ms
toggle→decode). Shipped `3886f00c`: the layer picker pulses the active layer's icon while the
first tiles fetch+decode — poll the TARGET slot (tracer-proven: the ring advances on activation
so the real URL loads in the target slot while the ACTIVE slot still holds the transparent tile),
settle-race guard for model switches (early ticks see the OLD model's loaded URL), 30s cap,
settles permanently per (layer, model). Live-verified under an injected 3s/range-read throttle:
pulse ON t+448ms, OFF at cap; fast loads never pulse.
**Radar "faint over Sebastian" (user report): NOT a regression** — scheme-7 (`/7/1_0.png`) is
pale-by-design at low dBZ and the whole radar family is scheme-7-keyed (recolor tables). A/B
lever: `__RAW_RADAR_OPACITY__`. Palette change = the backlogged DWD/EU palette arc.
**S2 run-keyed manifest + Postgres pointer CAS: SHIPPED + MIGRATED.**
`services/weather_pipeline/manifest_pointer.py`: every successful legacy manifest.json upload
(the serial, writer-gated choke point in `_upload_to_supabase`) also publishes immutable
`manifests/manifest-g<generation>.json` then CAS-advances the single-row
`public.weather_manifest_pointer` (PostgREST PATCH, `generation=eq.<expected>` precondition —
Supabase Storage has no If-Match). Readers (restore helper) resolve the pointer and GET the
immutable object with a PLAIN request (CDN-correct by construction), falling back to the legacy
cache-busted manifest.json on ANY failure. Ring retention KEEP_RUN_KEYED=5 (publisher prunes
g-5; sweep_orphaned_l2 reserves the `manifests/` prefix). Lane self-disables per process until
the migration exists; kill `MANIFEST_POINTER=0`. Migration applied to prod
(jnfbxcvcbtndtsvscppt, user-approved; versioned at
`backend/migrations/2026-07-11_weather_manifest_pointer.sql`); pointer row initializes on the
next ingest cycle. **P8 follow-up (separate session): once `manifest_written_by`/pointer
generation shows healthy cycles, flip hot serve routes to Cache-Control using pointer-resolved
run-keyed URLs.**

## 4c. SESSION CLOSE — cluster ping + waves-clamping verdict (`0a67cbaf`)
**Cluster rating "not activating" = design gap, not bug** (probe-captured render props:
clusterRatings 10/10 populated, tint+glow applied) → rated cluster bubbles now carry the same
animated ping ring as spot glyphs. Probe recipe: `__SCRUB_PROBE_ON__ = true` + wrap
`__SCRUB_PROBE__.onRender` to capture the last render's props. ⚠️ The Swell/Rating pill shares
its visible label with the Swell LAYER button — select it by `title` ("Toggle Swell").
**Waves "clamping at z7.84" (user hypothesis: rating-mode-caused): A/B DISPROVEN** — Rating
on/off screenshots at the identical z7.84 view show an indistinguishable field. The "grid" look
is the regional band's particle streak structure (both modes), stepping to the coarse wash at
z5.23 — designed tiering; the z9 native-resolution verdict stands (density ladder
marineControllerUtils.js:298-303 = documented minefield). FPS 31 in dev preview ≈ the stable 30
target; re-judge FEEL only on the deployed build.
**`__SPOT_RATINGS_DIAG__` decoder:** eligibleSpots = UNCLUSTERED spots in view; mergedCount 0
with surfMode:false = correct gating, not failure.

## 4d. LIVE-EYEBALL ROUND (user on deploy + localhost, post-`76a3d98b`) — NEW QUEUE
User confirms the temp toggles work overall. Three precise items remain (full forensic context
in each):
1. **Waves rating-band refetch loop** (user logs, z7.76-7.84, BOTH environments): `__SURF_MODE__`
   flag ON + the florida_east_coast regional was 15Z vs 18Z coarse (transient ingest-cadence
   staleness) → the rating lane's want is unsatisfiable → 4+ WEATHER_TRUTH chains for the SAME
   product, repeated Abort-Gate dup-skips, repeated particle-state resets → 13 FPS + the felt
   "animation/heatmap clamping". The honest-waves gate itself (WebGLMarineEngine.js:1020) and the
   2s-throttled rating-band log are CORRECT — the loop is the settle/backstop refetch family
   (closed #29's shape). Fix: TTL/backoff terminal-gate on the rating-lane refetch when the
   served regional lacks ratingMode; check the fromSeries=false vs series race (THREE-pipeline
   landmine). Also: WEATHER_TRUTH "ABSENT after orchestratorCommit" = no-downgrade rejection
   flagged as death — tracker noise worth a label.
2. **Air temp clears at z3.46** (zoom-out, deployed build, despite fade-200+cancelZoomTiles):
   the #25 residual at the tile-z2→z1 crossing. Recipe: __RASTER_SLOT_TELEMETRY__ + tile states
   at the crossing; candidate fix: prime z0-z1 tiles at activation (1-4 tiles/level from the
   already-decoded grid).
3. **Temp-pair infobox "no data" = the KNOWN v1 gap, NOT a regression** (grep-verified: zero
   temperature branches in the point lane; the backlog's "Temperature infobox long-press" item).
   Design: sample `__DECODED_OM_TILES__` client-side (row-0-SOUTH!) at the clicked point, keyed
   by resolved model (incl. dwd_icon SST→gfs013 cross-fall) + timeIndex; NaN interior = "land".

## 5. OPTIONAL FUTURE (not started, by design)
ICON water temp "estimate science" differentiation: serve GFS SST nudged by an ICON-derived
anomaly (e.g., ICON 2m-air anomaly vs GFS, damped coastal) labeled `estimate` provenance like the
marine far-edge lane — gives ICON users a distinct field without pretending DWD publishes SST.
Needs: pipeline-2 style estimate lane + legend provenance. One session if ever wanted.

## 6. FRESH LANDMINES (this session)
- **Hidden preview tab: rAF NEVER fires** — resolveAllUrls/finishTransition/engine loops all
  starve; slot layers never mount; `document.visibilityState === 'hidden'` even after fronting.
  Fix: shim `window.requestAnimationFrame = cb => setTimeout(() => cb(performance.now()), 16)`
  FIRST, then drive. With the shim the preview fully renders (tiles load, screenshots work).
- Pixel-probing the map: bisect layers (hide → readPixels → restore) before blaming a family —
  the first "field over land" read was a traffic-colored motorway.
- `__DECODED_OM_TILES__` sampling: row 0 = SOUTH; bounds `[w,s,e,n]`; global grid per timestep
  (3072×1536 gfs013), ~2 entries per variable (LRU 150).
- jsdelivr ne_10m_land.json = 10 dissolved MultiPolygons (18MB, feature 0 = 11MB) — a
  10-feature count is NOT truncation.
- StrictMode dev double-mount doubles every boot log — don't count boot-window logs as evidence
  of production double-fire (the finish dedupe covers the real prod path anyway).
