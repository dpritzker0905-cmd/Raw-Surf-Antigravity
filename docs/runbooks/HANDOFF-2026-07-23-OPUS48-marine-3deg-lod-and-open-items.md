# HANDOFF 2026-07-23 (Opus 4.8) — marine wide-zoom LOD ladder (far-zoom clear FIXED + 3° light base), open items

**STATUS: two fixes DEPLOYED + live-verified. HEAD = `e05c313e` (== origin/dev). Three items OPEN
(need a clean repro — do NOT guess-fix).** Full detail: memory
[[marine-lod-ladder-3deg-base-2026-07-23]].

## 0. BINDING RULES (keep applying)
forensics-not-guessing · Jacobian (isolate the ONE variable) · study memory + 3mo commits before
touching a subsystem · instrument + kill-switch + A/B · unit AND live tests, before AND after ·
probe the SERVED data at exact cells · **do NOT hammer the live map** (rapid jumpTos + base-eviction
induce mask/gray-box artifacts AND wedge the renderer — reload for a clean slate; the pane was wedged
at end-of-session by a 2400px resize + rapid jumps).

## 1. WHAT SHIPPED (both DEPLOYED to origin/dev → Render, live-verified 3×)

### `41addb91` — serve the 2° global_mid at ALL zooms (the far-zoom "storm clears" root)
USER: "Bertha clears/heatmap changes when I zoom out." ROOT (forensic): past 40° viewport span the
heatmap dropped the 2° `global_mid` tier for the 10° `global_coarse`, which block-averages a compact
storm (Bertha 2.74m sharp → 1.65m smeared 4° away = VANISHES) and masks EURO's enclosed-sea Gulf.
FIX: `MARINE_MID_RES_MAX_SPAN` 40→400 in `backend/services/weather_pipeline/mid_res_tier.py` — serve
the FULL 2° global at every zoom (mirrors the WIND sibling `WIND_MID_RES_MAX_SPAN=400`). The frontend
ALREADY globalizes to the WORLD bbox at its own 40° ceiling (`__RAW_MARINE_GLOBAL_SPAN__`), so the tier
serves the full 2° world grid — **no clip edge** (that box-edge is why the earlier 120° VIEWPORT-clip
attempt was reverted). The 5 frontend lockstep sites are UNTOUCHED (this changes only the BACKEND serve
resolution, not the handoff ceiling). Kill: `MARINE_MID_RES_MAX_SPAN=40`. Verified: sweep (Bertha 2.74m
held z6→z2.3), served-data probe (world→15k vec, Bertha 2.74), z5.35 screenshot (sharp core where the
user's was uniform cyan).

### `e05c313e` — 3° light global BASE (serve-time energy-pool)
The 2° world base = ~15k vec = 24× the 10° coarse the wide-zoom pipeline was tuned for → its ~2-4s
cold-fetch WIDENED the fast-zoom-out rectangle + ballooned the world series/memory. USER-chosen 3°
after deep research (Windy = one field + BILINEAR interp; our shader samples `gl.LINEAR`; a TC's true
Hs peak is SUB-CELL at 2°/3°/4° alike → a lighter INTERPOLATED base reads as a smooth blob).
**`backend/services/weather_pipeline/wide_base_decimate.py`** (`maybe_decimate_wide_base`, hooked in
`mid_res_tier.py` after the clip, before the LRU store): mean-pool ONLY the WORLD base (served span
≥ 350°) from 2° → `MARINE_WIDE_BASE_RES` (default **3°**); viewport CLIPS (< 350°, the z5-8 storm-watch
tier) stay full 2°. **CRITICAL: ENERGY-mean Hs = √(mean(H²)), NOT linear** (unit test caught linear
smearing a 1-cell 3.1m storm to 1.3m < the 1.65m vanish threshold). u/v re-derived to |Hs| at the
vector-mean direction; masked bins stay masked. Kill/A-B: `MARINE_WIDE_BASE_RES=2.0`. 7 unit tests +
19 existing mid-tier green.

**3° LIVE before/after:** world base 15k→**6655 vec / cell 3.0 / Gulf-max 2.57m** (vs 2° 2.81m — only
~8% peak drop, z5 transition is a gentle dim not a vanish). Base loads **~740ms** (vs 2-4s) and is
**LRU-RETAINED across zoom**. **Real-use fast zoom-out (base resident) = 0 rectangle frames.** Continental
screenshot = smooth storm blob, crests animate, no blockiness/gray-box/rectangle.

**ANIMATION NEEDED NO CHANGE at 3°** (workflow-verified, 2 agents): crest/particle anim is ALL
screen-space / data-value (particle count const `particleRes=296`, positions tile/Mercator-space +
bilinear-sampled, density viewport-solved, crest wavelength PERIOD-derived, tile sizing zoom+viewport).
Only grid-coupled sites (vortex gate `isMagnifiedCoarseField` WebGLMarineEngine.js:443-451; nearest-cell
dir snap `u_waveGridSize`) read LIVE cols/rows/cellDeg → the pool MUST emit true 3° metadata (it does:
120×55, world bounds). Live tune knobs if the coarse field reads rigid: `__RAW_CREST_DIR_JITTER__`,
`__RAW_VORTEX_MIN_CELL_PX__` (default 80).

## 2. OPEN QUEUE (do in order; NEED A CLEAN REPRO FIRST — no guess-fixes)

1. **Fast-zoom-out RECTANGLE residual (worst case only).** Real-use is CLEAN (0 rect). Only the
   fresh-cold + <740ms burst (base not yet loaded) briefly clears then heals at 740ms. To fully close:
   **eager-prefetch the global base on marine ACTIVATION** so it's resident before any zoom-out. The
   mechanism EXISTS: `marineController.js` `prewarmGlobalMarineGrid` (:248) fires after every fetch
   (:687/707/722) while zoomed-in (≤15°) and seeds `_pendingCoarseBaseGrid` → `_captureCoarseBase`
   (WebGLMarineEngine.js:1104). It just needs to fire EARLIER/harder on first activation. FRONTEND-only,
   instant iterate. Test with the base-evicted `__ZOOMBURST__` (see §4).

2. **Particle-tile L/R split (§7i, `fe2aa8ea`).** On a WIDE monitor at a specific zoom the camera-centered
   particle tile is narrower than the viewport → one side animated, flips on pan. RESOLUTION-INDEPENDENT
   (extent-based) — the 3° base does NOT fix it. Sites: `clampTileToViewport` WebGLMarineEngine.js:203-208
   (called :1448), tile sizing :1438-1450 (tileZoom=floor(z)-TILE_BACKOFF(2), tileWidth=1/2^tileZoom),
   reinit-on-change :1456-1471. **COULD NOT REPRODUCE** in a 1700px pane (tile covered at z3-3.7); a 2400px
   resize wedged the renderer. NEED: the user's exact monitor width + zoom, OR a stable wide-canvas repro.
   Read `__RAW_GPU__.tileCover` = {tileWidth, vpW, vpH, clamped}; the split is when tileWidth <
   max(vpW,vpH)*1.1 and clamped stayed false. Kill: `__RAW_DISABLE_TILE_VP_CLAMP__`.

3. **Gray box.** Stale ocean-mask box (mask is a FIXED 4096×2048 → resolution-independent). The GIANT one
   the user saw was very likely corruption I induced by hammering the map; a clean reload rendered fine.
   NEED a clean repro. Class = El Salvador grey-rect self-heal WebGLMarineEngine.js:3016 (bad box on a
   wide-grid residency) + escaped-mask-under-world-grid (mask didn't rebuild for the new global grid,
   `64bd1ff6`). Watch `mask_rebuild` in `__RAW_FORENSIC__`.

4. **Raster layers (rain/satellite/pressure/temperature/water_temp/fog) clear/reappear at zooms** —
   SEPARATE from the grid engine (the "Raster Queue Transition" system, `[TRANSITION] [Raster Queue
   Transition]` in console). Check per-layer minzoom/maxzoom, tile availability by zoom, `useOpenMeteoTileUrls`,
   the raster queue slot transitions. Reproduce with a zoom sweep per raster layer × model.

5. **All-layers/models verification** of the 3° base (swell_1/swell_2/wind_waves × GFS/EURO/ICON). The
   backend change covers all `_MID_LAYERS`; the decimation guards `layer=="waves"` ONLY (extend to the
   swell layers if desired — `mid_res_tier.py` decimation hook). Wind is a separate engine (already
   always-globalizes, v3.15).

## 3. HOUSEKEEPING
- **MEMORY.md is ~20.2KB (approaching the 24.4KB read limit)** — compact to <17KB: one line/entry, move
  detail to topic files, drop stale entries. Deferred this session (context budget).
- The `489c52ed` stale-wind-test fix is on origin/dev (bundled with the 3° push).
- Two background investigation workflows ran (`wf_bc836c75-402` marine-fastzoom — partial; `wf_711fe936-b50`
  animation-coupling — COMPLETE, decisive). Journals under `subagents/workflows/`.

## 4. FORENSIC TOOLS (re-inject after any reload; scripts in scratchpad)
- `__BERTHA_SWEEP__([zooms])` → settled tier + Bertha per zoom.
- `__ZOOMBURST__`/base-evict variant → per-frame resCov+baseCov during a fast easeTo → rectFrames +
  baseReadyMs (measures the cold-window rectangle). Base-resident run = real-use; base-evicted = worst case.
- `__RAW_FORENSIC__.summary()` / `.dump()` — the marine lifecycle recorder (commits, reject_downgrade,
  selfheal_accept, mask_rebuild, snap).
- `__RAW_GPU__.tileCover` — particle-tile coverage. `__MARINE_RENDER_SOURCE_DIAG__` — model/max/renderable.
- Deploy poll: `scratchpad/poll_3deg.py` (world bbox flips 2°→3° when cell≥2.6).
- Served-data probe: `fetch('https://raw-surf-antigravity.onrender.com/api/weather/grid_series?model=EURO&domain=marine&layer=waves&bbox=W,S,E,N&hours=0')`.
- Enable EURO+Waves after reload: click the `EURO` button then the `Waves` layer button (aria-pressed
  toggles). Resize the pane to ~1900 (2400 wedged the renderer).

## 5. LANDMINES
- Backend serve-path changes (ceiling, decimate) activate on Render DEPLOY (~4-6 min), NO re-bake. Poll a
  served-data probe until it flips.
- The fortified arbiter/guard zone (differential + 37k-seq harness, 0 divergences) — the far-zoom fix did
  NOT touch it (only the backend serve res). Keep it that way.
- Provider label lies: served `provider:'open-meteo'` is a normalizer artifact even for direct-GRIB.
- Dev server (:3007/:3009) wedges from many rapid map ops / HMR recompiles — reload / preview_stop+start.
