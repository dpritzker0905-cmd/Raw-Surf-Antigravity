# HANDOFF — Marine render: density consistency, wave speed, NOAA provenance, animation pass
**Date:** 2026-06-30  ·  **Branch:** `dev`  ·  **System:** Raw-Surf weather-simulation (marine heatmap + GPU wave-crest particles)

> Read this top-to-bottom before touching code. It audits everything from the long 2026-06-30 session, records
> the forensic truths (several of which CORRECT earlier assumptions), lists exactly what's committed vs. pending
> visual sign-off, and gives the one methodology rule that will save you hours.

---

## 0. THE ONE RULE THAT WILL SAVE YOU HOURS — the hidden-tab confound
The Chrome-MCP automation tab is almost always `document.visibilityState === "hidden"` (the user is looking at
THEIR own tab). **Chrome pauses `requestAnimationFrame` in hidden tabs**, so the marine render loop
(`triggerRepaint → rAF`) never ticks → `drawCalls:0`, `frameTimeHistogram` all-zero, heatmap+particles read as
EMPTY/"vanished"/"sparse". **Most of the session's wasted effort was chasing render artifacts that were really
this confound.**

- **Always check `document.visibilityState` first.** If `hidden`, a "nothing renders" read is meaningless.
- **Telemetry workaround:** `window.map._render(0)` forces ONE synchronous frame even when hidden → `__RAW_GPU__.*`
  telemetry (drawCalls, `particleDensity`, `blendBoth`) becomes valid. Use this for COUNT/number verification.
- **Screenshots still don't work hidden** — a hidden tab's GPU compositor doesn't present frames, so CDP
  screenshots are blank even after `_render(0)`. **VISUAL verification REQUIRES a foregrounded tab.** Ask the user
  to bring the test tab to the front and KEEP it there; verify in that window, fast, before it slips back to hidden.
- Long `await`s on a hidden tab can detach the CDP context ("Detached while handling command") — keep JS calls short.

Memory: `[[marine-raf-hidden-tab-confound]]`.

---

## 1. Verification environment
- App: `http://localhost:3001/map` (user's craco dev server; sluggish/long-running — fresh tab loads take 25–40s and
  can freeze; a fully fresh tab/window helps).
- Backend override (point localhost at live Render): `localStorage.setItem('__BACKEND_URL__','https://raw-surf-antigravity.onrender.com')` then reload. localStorage is shared across same-origin tabs.
- Activate marine: Weather panel → select **GFS** → click **Waves**. (`source=forecast_direct`, orchestrator→WebGLMarineLayer is the live path; the dispatcher/FCE path is disabled.)
- **Data reality 2026-06-30:** California & Florida are genuinely CALM (~1.2 m) → faint crests there. Real swell (≈7.7 m) is in the **Southern Ocean (≈ −115, −52)** — go there for vivid crests to judge animation.

---

## 2. Committed this session (on `dev`)
| hash | what |
|---|---|
| `db363a14` | **BLEND BOTH** heatmap composite + nearshore wash + **constant-screen-density particles** |
| `aea21be0` | **stranded fetch-lock watchdog** hard-lease (govIdle gap) |
| `830c4c7b` | **NOAA provenance** — series grids carry `__sourceDataset` so HUD shows NOAA, not contract "open-meteo" |

Detail:
- **`db363a14`** — GFS heatmap "clears ~1.5s after activation" (the coarse→regional swap looked blank because the
  regional tile is faint). Fix = retain the global-coarse grid as a STANDALONE texture snapshot and composite it as
  a faded wash UNDER the regional, with height-based alpha so flat regional cells let the wash show. **Two forensic
  catches:** (a) the engine reuses ONE resident wave/chl/bath texture set in place, so you can't "keep the old coarse
  textures" — they're freed when the regional commits → need the standalone snapshot; (b) the coarse base needs a
  high-res **MERCATOR** mask (`renderMaskToCanvas`), NOT the grid mask — the heatmap FS samples `mask_v` in mercator,
  grid mask is linear-lat → wrong row → invisible wash. Also the **constant-density** particle fix: hold a fixed
  on-screen seed count (`u_densityBase`, engine computes the cull fraction from the viewport's share of the particle
  tile) instead of an ad-hoc per-zoom fraction; tile backoff 3→2 for headroom. A/B verified live on FL.
- **`aea21be0`** — `releaseStaleMarineLock` only healed when the governor was idle, but a stranded fetch can leave
  the governor's in-flight counters set too → govIdle false forever → abort-gate skips every recovery fetch →
  permanent blank. Added `MARINE_FETCH_HARD_LEASE_MS=25000`: past 25s held = provably dead, heal regardless of
  govIdle. `useMarineDataFetcherCore.js` + 2 tests.
- **`830c4c7b`** — GFS IS NOAA-direct; the regional/series path (`marineGridSeries.frameToMarineData`) never plumbed
  `__sourceDataset`, so the HUD's source→origin mapper fell back to the contract `provider` ("open-meteo"). Now it
  carries `ncep_gfswave025` → HUD shows **NOAA**.

---

## 3. UNCOMMITTED in the working tree — implemented, **awaiting the user's VISUAL sign-off, then commit**
4 files: `WebGLMarineEngine.js`, `WebGLMarineParticleShaders.js`, `WebGLMarineShaders.js`, `WebGLMarineShaders.test.js`.
(Ignore the also-dirty `.claude/launch.json` + `backend/diagnostics.log` — unrelated local noise, do NOT commit.)
84/84 map tests green; all syntax-checked. Four features:

1. **Density-cliff fix (tile-zoom-min)** — the constant-density only engaged `z>6`; below z6 particles seed GLOBALLY
   (spread → ~90× sparser in view) → a hard DENSE→SPARSE cliff at z6 zooming out. Added `u_tileZoomMin` uniform
   (replaces 7 hardcoded `u_zoom > 6.0` in ADVECT_FS+DRAW_VS), engine `tileZoomMin` default **4.0** so the
   concentrated tile mode + constant-density extend down to z5. **Telemetry-verified:** constant **1653 seeds z5→z14**
   (was cliffing at z6); cliff now at z4. Tunable `window.__RAW_TILE_ZOOM_MIN__`. NEEDS VISUAL: confirm z4–6 advection
   looks right (tile mode now active there). Lower the default if the user wants consistency further out.
2. **Wave-speed cap** — `ADVECT_FS offset ∝ waveHeight` made a 7 m swell drift ~9× a 1 m wave → "unnaturally fast at
   mid-zoom" over the coarse-global. Added `u_speedHeightCap` (default **3.0 m**, `__RAW_SPEED_HEIGHT_CAP__`) capping
   the height term, + overall `__RAW_WAVE_SPEED__` multiplier (default 1.0). NEEDS VISUAL (motion can't be screenshotted).
3. **Clamp softener** (gated, kill `__RAW_DISABLE_CLAMP_SOFTEN__`) — when a regional tile is narrower than the viewport
   AND a coarse base exists, widen `u_edgeFeatherWidth` so it dissolves into the coarse base instead of a hard edge.
   NOTE: only engages WITH a coarse base — rarely captured here, so the dominant clamp case is unaddressed (see §5).
4. **Crest direction-jitter** (OPT-IN, default OFF, `__RAW_CREST_DIR_JITTER__` ≈ 0.25 rad) — per-crest random heading
   (directional spectrum) to break the rigid parallel-crest LATTICE over uniform/coarse fields. NEEDS VISUAL on real swell.

---

## 4. Forensic TRUTHS established (some correct earlier wrong calls)
- **Backend is HEALTHY; GFS marine IS NOAA-direct.** `/api/weather/grid` returns `source_dataset: ncep_gfswave025`,
  `is_estimated:False`, `fallbackReason:None`. Scheduler runs `fetch_gfs_marine_global_coarse` (NOAA AWS) as PRIMARY;
  `provider="open-meteo"` is a deliberately hardcoded byte-identical contract key. **Decisive:** on the decoupled
  GitHub ingest runner open-meteo is unreachable/rate-limited, so the fallback can't run → existing data MUST be NOAA.
- **CA/FL calm ~1.2 m today is CORRECT, not a bug.** Faint crests = real conditions. My earlier "data degraded /
  wedged" calls were WRONG — they were the hidden-tab pause + rapid-jump fetch-debounce. Governor was idle; no stranded lock.
- **The "grid/lattice" the user sees** = (a) blocky coarse-global 37×17 (~10°/cell) shown zoomed-in because the
  regional "sharpen" misses (`sharpen={found:false,covers:false}`, `series:{hits:0,misses:2}`), plus (b) a regular
  parallel-crest lattice from the uniform direction field. The jitter (§3.4) targets (b).
- **The density jump** = tile (concentrated) vs global-seeded (sparse) particle modes switching at z6 (fixed §3.1).
- **The fast waves** = height-linear drift speed (fixed §3.2).

---

## 5. OPEN WORK — next session, prioritized
1. **Get the user's tab foregrounded over Southern Ocean swell and visually verify + commit the §3 batch** (density
   cliff, speed cap, clamp softener, jitter). Dial the flags with the user, bake chosen defaults, commit.
2. **ANIMATION UPGRADES still to do (doc-grounded, all need visual iteration with the user):**
   - **Trochoidal crest shape** — make the ribbon asymmetric: sharp leading face, broad trailing back (DRAW_FS shape;
     currently a symmetric ellipse). Refs: Trochoidal wave (wikipedia), Crest Ocean docs.
   - **Orbital pitch** — small phase-synced forward/back oscillation so crests pitch, not just translate (DRAW_VS).
   - **Shoaling foam** — intensify whitecap in shallow water via the heatmap's `depthFactor` (bathymetry). Needs the
     bathymetry texture bound into the particle pass (new binding). Refs: Crest "foam in shallow water".
   - DON'T regress the carefully-tuned v5.x anim (commit `09897a77` foam-direction; v5.4 anti-blink).
3. **The clamp's DOMINANT case is an ORCHESTRATOR bug**, not engine: at zoom-out it commits a tiny sub-viewport
   regional tile (e.g. 2° tile in a 4° viewport) with NO coarse base instead of serving the coarse-global. Fix is in
   the regional↔coarse selection (`useMarineOrchestrator` / dispatcher / `marineGridSeries`). Regression-prone clamp
   lineage — go carefully.
4. **Regional "sharpen" misses for non-flagship areas** → stuck on blocky coarse-global. Data-coverage (precompute)
   question; the jitter mitigates the LOOK but the real fix is regional-tile coverage.

---

## 6. All live-tunable flags (window globals, read every frame — set in console, no rebuild)
| flag | default | effect |
|---|---|---|
| `__RAW_PART_TARGET__` | 1650 | on-screen seeded crest count (0 = legacy per-zoom curve) |
| `__RAW_TILE_BACKOFF__` | 2 | particle tile size: 2 = 4×screen (more on-screen headroom); 3 = 8× |
| `__RAW_TILE_ZOOM_MIN__` | 4.0 | zoom above which concentrated tile mode + constant-density apply (lower = consistent further out) |
| `__RAW_CREST_DIR_JITTER__` | 0 (off) | radians of per-crest heading spread (breaks the lattice); try 0.2–0.3 |
| `__RAW_SPEED_HEIGHT_CAP__` | 3.0 | cap (m) on the height term driving drift speed (slows big swell) |
| `__RAW_WAVE_SPEED__` | 1.0 | overall drift-speed multiplier (e.g. 0.6 to slow everything) |
| `__RAW_DISABLE_CLAMP_SOFTEN__` | (off) | kill the adaptive edge-feather clamp softener |
| `__RAW_DISABLE_BLEND_BOTH__` | (off) | kill the coarse-base composite |
| `__RAW_BLEND_BASE_WASH__` / `__RAW_BLEND_HEIGHT_LO__` / `__RAW_BLEND_HEIGHT_HI__` | 0.72 / 0.05 / 1.4 | blend wash strength + height-alpha crossover |
| `__RAW_DISABLE_COARSE_FADE__` | (off) | kill the close-zoom coarse-grid fade |

Telemetry (read after `map._render(0)`): `__RAW_GPU__.particleDensity` (zoom/onScreenFrac/densityBase/estInViewport),
`.blendBoth` (engaged/haveCoarseBase/...), `.clampSoften` (coverage/featherWidth), `.drawCallsPerFrame`.
GPU debug modes: `window.__GPU_DEBUG__ = {mode:'part_fbo'}` (bypass all discards → see all particles), `'part_pos'`
(only particles surviving the VS discard), `'mask'` (heatmap ocean mask).

---

## 7. Backend forensic endpoints (curl directly — bypass the flaky frontend)
- `GET /api/weather/status` — health, grid file count, errors.
- `GET /api/weather/products` — manifest; frontend snaps `valid_time` to the nearest product within 3h (else fallback).
- `GET /api/weather/grid?model=GFS&domain=marine&layer=waves&valid_time=<recent ISO>&bbox=w,s,e,n` — returns the
  coarse-global 37×17 (real values; provenance fields: `source_dataset`=true origin, `provider`=contract label).
  Use a recent manifest-snapped `valid_time` or you'll trigger the open-meteo fallback yourself and misread it.

Backend code (this repo): scheduler `backend/services/weather_pipeline/scheduler.py` (GFS marine ingest, NOAA-direct
PRIMARY, kill switch `GFS_MARINE_NOAA_DIRECT`); fetcher `backend/services/noaa_gfs_wave_fetcher.py`; capabilities
(static `upstream_provider` labels — NOT the real fetch path) `backend/services/weather_pipeline/capabilities.py`.

---

## 8. Key files
- Engine: `frontend/src/components/map/WebGLMarineEngine.js` (render loop, blend passes, density compute, tile, speed)
- Shaders: `WebGLMarineShaders.js` (heatmap FS), `WebGLMarineParticleShaders.js` (ADVECT_FS / DRAW_VS / DRAW_FS)
- Encoder: `WebGLMarineTextureEncoder.js` (`{standalone:true}` coarse-base snapshot)
- Series/regional path: `marineGridSeries.js` · fetch+locks: `useMarineDataFetcherCore.js` · HUD: `TruthOverlay.js`
- Memory index: `[[blend-both-marine-coarse-base-2026-06-30]]` is the live session index with all the detail.
