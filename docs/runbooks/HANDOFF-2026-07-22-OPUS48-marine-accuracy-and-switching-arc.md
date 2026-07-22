# HANDOFF 2026-07-22 (Opus 4.8) — marine ACCURACY (enclosed-sea dropout) + the switching/readiness arc

Base was `9297e5f4` (SDF coastline) on `origin/dev`. HEAD is now **`0fcde49c`**, `HEAD==origin/dev` (verified in
sync). **5 commits shipped this session, all pushed.** Every claim below carries a live instrument, a test, or a
server-side probe. **The live thread the USER is on = §2 (marine accuracy / enclosed-sea dropout) — read it first.**

## 0. BINDING RULES (applied all session): forensics-not-guessing · Jacobian lens (isolate the ONE variable
that flips behaviour — here the kill-switch or the model) · study memory + recent commits before touching a
subsystem · instrument-first + kill-switch + A/B · test units AND live · probe the DATA not just the code ·
one change-set at a time, committed with evidence, pushed, `git log origin/dev` verified · report faithfully
(the null-encode guard is framed as DEFENSIVE, not a cure, because the path proved unreachable).

## 1. SHIPPED (5 commits + the dev-server fix) — newest first
| Commit | Fix | Kill switch | Tests |
|---|---|---|---|
| `0fcde49c` | **marine coarse enclosed-sea dropout** (USER accuracy bug — §2) | `DWD_GWAM_SCALAR_BLOCKMEAN` / `ECMWF_WAVE_SCALAR_BLOCKMEAN` / `COPERNICUS_SCALAR_BLOCKMEAN` (backend env) | +11 backend |
| `d863f169` | render contract can't strand in STYLE_LOADING (the isStyleLoaded() class, generalized) | `__RAW_DISABLE_RENDER_CONTRACT_BACKSTOP__` | +12 FE |
| `8c48615c` | model/layer switch now actually LOADS the new model (style-ready fetch strand) | `__RAW_DISABLE_STYLE_READY_FALLBACK__` (+ `__RAW_STYLE_READY_FALLBACK_MS__`) | +9 FE |
| `adf0e6d1` | switch no longer BLANKS the heatmap (switch-hold race) | `__RAW_DISABLE_SWITCH_HOLD__` (+ `__RAW_SWITCH_HOLD_TTL_MS__`) | +15 FE |
| `5ffcd6ab` | null-encode resident guard (DEFENSIVE + falsifiability probe, NOT a reproduced cure) | `__RAW_DISABLE_NULL_ENCODE_RESIDENT_GUARD__` | +13 FE |
- **Dev server fix (no commit):** it was crashing with `FATAL: invalid table size` — a **corrupt 1.7 GB
  `node_modules/.cache`** (NOT a heap OOM — `--max-old-space-size` + `GENERATE_SOURCEMAP=false` both ruled out live).
  `rm -rf node_modules/.cache` fixed it. react-scripts 5 / webpack 5 / Node v24. See [[local-dev-frontend-setup]].
- FE suite ended at **1419** (was 1370); backend marine/ingest **121 + 11 new** green.

## 2. ⚠️ THE LIVE THREAD — marine ACCURACY: coarse enclosed-sea dropout (`0fcde49c`)
**USER-REPORTED:** EURO & ICON marine heatmaps showed ~4-5 ft off the Texas coast where reality (Windy/Ventusky +
NDBC + open-meteo, all models at the analysis hour) was ~1.5 ft; GFS was correct. User principle (right): at the
ANALYSIS hour wave models assimilate the same obs → they agree; big model divergence at hour 0 = a bug.
**ROOT (Jacobian — same coarse grid 37x17, same cells, ONLY the model differs; server-side confirmed via
`/api/weather/grid_series`):** the COARSE-GLOBAL tier (z<~6) drops enclosed-sea cells for EURO+ICON but not GFS.
GFS block-means the wave HEIGHT over each 10° cell (`energy_mean_height_block`); the **ICON (`dwd_gwam_fetcher`),
EURO (`ecmwf_opendata_fetcher`), and EURO-fallback (`copernicus_global_fetcher`) fetchers POINT-SAMPLE the height at
the cell CENTRE** (`arr[r,c]`/`a[:,row,col]`). A 10° cell whose centre lands on masked land (coastline, Mississippi
delta at (30,-90), enclosed-sea edge) → NaN → the whole cell drops → the sea goes blank → zoomed out the heatmap
fills it from distant cells (~1-1.3m ≈ 4-5ft). MID/regional tiers were always CORRECT (why zoomed-in looked fine).
**FIX (worldwide, location-independent, land-safe):** block-mean the height in all 3 fetchers; added
`energy_mean_height_lonspan` to `_fetch_common` for the thin-band CMEMS path. GFS untouched.
**FOOTPRINT (live-mapped via the coverage overlay):** Gulf of Mexico, W+E Mediterranean, Baltic, Black Sea, Red Sea,
Persian Gulf, Gulf of California, Gulf of Guinea, Caribbean, S China Sea, Sea of Japan.
**⚠️⚠️ NOT YET LIVE — the fix is in the INGEST fetchers; the served `*_marine_waves_global_coarse` products are
PRE-BAKED.** It activates only when the coarse products are RE-INGESTED: (1) Render must deploy the push, (2) the
marine cron OR an admin `POST /api/weather/ingest_*_marine_global_mid_direct` re-bakes them. **VERIFY:** rebuild the
coverage overlay — red enclosed-sea squares turn GREEN, and the halo `realBleed` stays 0.
Detail: [[marine-coarse-enclosed-sea-dropout-2026-07-22]].

## 3. THE SWITCHING/READINESS ARC (§1 commits `adf0e6d1`/`8c48615c`/`d863f169`) — what & why
Two DISTINCT bugs behind "switching models/layers clears the heatmap", both live-rooted with wrapped-function traces:
- **Blank on switch (`adf0e6d1`):** `recordClear('non_renderable_terminal')` fires in the WebGLMarineLayer
  data-commit effect BEFORE `beginTransition` sets `__MARINE_TRANSITIONING__` (multi-render React race) → ~875ms
  blank. `shouldHoldFrameThroughSwitch` holds the last-good frame (2s TTL, target-keyed, truth-safe via the
  displayMatchesRequested parity gate — never mislabels). Live A/B: fix OFF blanks, fix ON 0 blank frames.
- **New model never LOADS (`8c48615c`):** the switch-fetch deferred on `map.isStyleLoaded()`, which mapbox-gl 5.24
  returns FALSE while any source (re)loads; `once('idle')` never re-fires → the fetch STRANDS (`__MARINE_FETCH_PENDING__`
  null, transition pending). Fix `fireWhenStyleReady` uses `isStyleLoaded() OR areTilesLoaded()` → fires immediately.
  ⚠️ CORRECTION: earlier I wrote "isStyleLoaded permanently false" — it's TRANSIENTLY false (source-load timing).
- **Render-contract strand (`d863f169`):** the same isStyleLoaded() class — `useMapRenderContract` could stay stuck
  STYLE_LOADING (missed `style.load` + a false-isStyleLoaded window), and `canCommit()` gates ALL raster commits
  (precip/radar/pressure/OM) → total raster stall. Fix `isMapFunctionallyReady` + `on('idle')` + a 4s backstop.
- backendCopernicusServiceClient:310 + useModelTransition:150 audited = BENIGN (fallbacks). Pattern going forward:
  any readiness gate uses `areTilesLoaded()`/`idle`, NEVER bare `isStyleLoaded()`. See [[marine-switch-hold-2026-07-21]].

## 4. LIVE TOOLS / HARNESS (all installed this session, on localhost:3010)
- **Dev server:** `preview_start name:"frontend-verify"` won't work until `rm -rf node_modules/.cache`; I ran it
  manually (`PORT=3010 NODE_OPTIONS=--openssl-legacy-provider craco start`). It's UP. Drive via `window.map.jumpTo`
  + JS `.click()` on the model/layer buttons (⚠️ the `computer` click tool did NOT register on the layer buttons —
  use `[...document.querySelectorAll('button')].find(b=>b.innerText.trim()==='EURO').click()`).
- **`window.__COVERAGE__`** — the coverage overlay (green=cell has data, big RED square=enclosed-sea ocean cell with
  NO data). `.build()` rebuilds for the current grid; `.off()` clears. THE verification tool for the §2 fix.
- **`window.__HALO_DEBUG__`** (Ctrl+Alt+H) — coast/land-bleed overlay; `__HALO_DBG_STATS__.realBleed` (0 = land-safe).
- Tripwires: `__MARINE_SWITCH_HOLD_COUNT__`, `__MARINE_NULL_ENCODE_GUARD__.count` (stays 0 ⇒ that path unreached),
  `__MARINE_CLEAR_LOG__` (clear reasons), `__MARINE_DISPLAY_SOURCE_DIAG__`/`__MARINE_LAYER_VALUE_DIAG__` (per-model
  source + values), `/api/health/data` lanes (real per-model source + age).
- **Ground truth:** open-meteo marine API — runs the SAME models — `https://marine-api.open-meteo.com/v1/marine?
  latitude=..&longitude=..&hourly=wave_height&models=ncep_gfswave025,ecmwf_wam025,gwam&current=wave_height`.
  Off Texas hour 0 all read ~0.46-0.56m. NDBC buoys = real-world truth (42019 was 404; try 42001/42035/42020).

## 5. REMAINING QUEUE + DEBT (Jacobian-ranked: highest-signal / most-reachable first)
1. **ACTIVATE + verify §2** — deploy `0fcde49c`, trigger the marine coarse re-ingest, confirm red→green on the
   overlay worldwide (incl. Europe/Africa: Med/Baltic/Red Sea/Gulf of Guinea) + halo realBleed 0. **The user is
   waiting on this.**
2. **ANTARCTIC heatmap painting (USER-observed, side note):** the heatmap may paint into Antarctic regions
   (coarse-grid south edge ~-69.7°; ice-edge mask). Same masking family as §2 — check the coarse grid's south rows
   + the ice mask. NOT yet investigated.
3. **6 CONFIRMED lifecycle/race defects** (from the `wm83hpi71` adversarial defect-hunt workflow, all read-verified):
   - `WeatherEngine.js:981` (⭐ fix first) — wind viewport-refetch parity gate checks MODEL only, not HOUR → a
     stale-hour wind grid commits for the wrong hour (no self-heal net). Trivial: capture `reqHour` before the
     await, extend the guard `|| timeOffsetRef.current !== reqHour`.
   - `useMarineOrchestrator.js:525` — layer-switch coalesce body reads the raw `timeOffsetHours` prop captured at
     switch time, not `timeOffsetRef.current` → a scrub within 350ms + a cache HIT overwrites with a stale hour.
   - `useMarineDataFetcherCore.js:730` — `__MARINE_FETCH_DEBOUNCING__` set by enqueue but cleared only under
     `requestId===marineRequestIdRef.current`; early-returns leave `requestId=0` → flag STRANDED true (self-heals
     ≤8s / next gesture). Fix: clear in `finally` when `requestId===0 && clearDebounce`.
   - `useMarineOrchestrator.js:~56` (`fireWhenStyleReady`, MY code) — the not-ready branch registers `once('idle')`
     + a setTimeout fallback; when the timeout wins, the idle listener LEAKS. Fix: `once` tears down both.
   - (dropped: `useRasterTransactions` findings — it's DEAD CODE, zero call sites; delete-or-wire, don't patch.)
4. **Model-switch STRANDS at the zoomed-out coarse tier** — I could NOT switch GFS↔EURO↔ICON at z<5 in the browser
   (fp:null, transition pending). The style-ready fix (`8c48615c`) fixed the mid tier; the coarse tier still strands.
   Same stuck-fetch class. Blocked live diagnosis of §2 (worked around it server-side).
5. **User-eye-pass gated (need the user):** land-halo visual A/B (`__RAW_DISABLE_HEATMAP_BOUNDS_GATE__`), ARBITER
   default-flip (8-item eye pass, server :3011), Issue B (future-scrub cleared-surroundings product decision).
6. **SDF coastline default-on** — blocked on GPU-JFA perf (CPU EDT ~50-65ms/rebuild). See
   `HANDOFF-2026-07-21-OPUS48-SDF-COASTLINE-best-in-class.md` §8.
7. **Zoom-clear heatmap** — the REAL lead is the zoom-remount `clearBuffers` dispose (not a plain-zoom bug);
   the null-encode `5ffcd6ab` is a latent gap (watch `__MARINE_NULL_ENCODE_GUARD__.count` — if 0 in prod, it's elsewhere).

## 6. LANDMINES / LESSONS (cost real time this session — DO NOT REPEAT)
- **Provider labels LIE:** `provider:'open-meteo'` is set BY DESIGN even for direct-GRIB sources. The real per-model
  source is `capabilities.py` + the `/api/health/data` lanes (GFS=ncep_gfswave025, ICON=dwd_gwam, EURO=cmems/ecmwf).
  The pipelines ARE direct GRIB — don't be misled by the label (I wasted a probe assuming EURO=ECMWF; it's CMEMS/ecmwf mix).
- **Probe the DATA, not just the code, AND at the right TIER/ZOOM:** the §2 bug is ONLY in the coarse tier; mid/regional
  are correct. I sampled the mid tier first and saw correct values → nearly missed it. The user's "zoomed out" clue
  was the key. Also I sampled the wrong SPOT first (calm mid-Gulf) — the bug shows where a coarse cell centre lands on land.
- **The corrupt `node_modules/.cache` (1.7 GB) crashes CRA with `invalid table size`** — NOT a heap OOM; delete the cache.
- **`computer` screenshot + click tools are unreliable on the heavy WebGL map** (screenshots 30s-timeout; clicks don't
  register on the layer buttons). Use JS: `map.getCanvas().toDataURL()` (this app HAS preserveDrawingBuffer; force a
  render first with a tiny net-zero `panBy` — the Browser-pane tab is `visibilityState:hidden` so rAF is throttled)
  and `.click()` on the button elements.
- **`_waveData` is NOT "nulled after upload"** (a FALSE memory pitfall I corrected — it nulls only on init/clearBuffers/
  degenerate-encode; render gates on `!_waveData`). Use a SCREENSHOT / `_residentWaveTex`, never `_waveData`, as the showing signal.
- **`half=1` block-mean samples cols `[c-half, c+half)` = {c-1, c}** (exclusive upper) — a test-writing gotcha.
- Windows python broken → `AppData/Local/Python/bin/python3.exe`; run backend pytest from `backend/` (for the `services` import).
- Two background WORKFLOWS ran: `wm83hpi71` (defect hunt, DONE — §5.3) and the enclosed-sea rootfix (redundant — I
  completed §2 independently; it corroborates but is not needed).

## 7. WHERE THINGS LIVE / OPS
- Fixed backend files (§2): `_fetch_common.py` (new `energy_mean_height_lonspan`), `dwd_gwam_fetcher.py`,
  `ecmwf_opendata_fetcher.py`, `copernicus_global_fetcher.py`; test `tests/test_enclosed_sea_height_survival.py`.
- Fixed FE files (§1/§3): `WebGLMarineEngine.js` (null-encode predicate), `marineTransitionCoordinator.js`
  (`shouldHoldFrameThroughSwitch`), `WebGLMarineLayer.js` (wiring), `useMarineOrchestrator.js` (`fireWhenStyleReady`),
  `useMapRenderContract.js` (`isMapFunctionallyReady` + backstop).
- Working-tree noise to NOT commit: `.agents/skills/supabase/*`, `skills-lock.json`, `frontend/scripts/wind-*-out/*`.
- Craco test: `cd frontend && node node_modules/@craco/craco/dist/bin/craco.js test --watchAll=false`.
