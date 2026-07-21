# HANDOFF 2026-07-21 (Opus 4.8) — marine stability arc: #10 cluster · churn · leaks · halo gate

HEAD `25fd7c18` on `origin/dev` (verified pushed, HEAD==origin/dev). Suites: **frontend 1355**, backend
811 (untouched). Continues the 07-21 EVE session (`001b98eb`). Every claim carries a test or a live
instrument. This was a long multi-arc session; read §7 (halo, the one OPEN visual item) first if you are
picking up the user's live thread.

## 0. BINDING RULES (applied): forensics not guessing · Jacobian lens · study memory + this doc + recent
commits before touching a subsystem · instrument-first + kill-switch + A/B · THREE THEMES × desktop/mobile ·
probes ALONE · hard-reload before judging (HMR lies) · one change-set at a time, committed with evidence,
pushed, `git log origin/dev` verified · **test before AND after** (user mandate).

## 1. SHIPPED — #10 marine warm-commit COVERAGE CLUSTER (COMPLETE)
The floating-rectangle / non-covering-commit class is closed across EVERY warm-commit path. New pure
predicate `marineWarmCommitCovers` (marineWarmCoverage.js) mirrors `regionalValidInPlace`.
- **Source 1** `f6040e95` scrub-cache commit-point (was: rejected non-covering only zoomed OUT).
- **Source 2** `81ab3d0b` cooldown fallback (the bounds-blind `per_model_hour_cache_nearest` lane).
- **Source 3** `ef72136e` `getMarineSeriesFrame` served-frame guard — **EURO returns HETEROGENEOUS-bounds
  frames across the 240h boundary (live-probed); a code-only audit wrongly cleared it → PROBE THE DATA.**
- **#11 refeed** live A/B closed (guard OFF re-feeds stale FL grid over fresh Pacific = rect; ON suppresses).
- Audit: Core:687/Orch:450 safe; Source 5 lanes unreachable in prod. Master kill
  `__RAW_DISABLE_MARINE_WARM_COVERAGE__`. Detail `f6f96f06` handoff + [[marine-warm-coverage-guard-source1-2026-07-21]].

## 2. SHIPPED — scrub re-render churn (2 Jacobian-rooted perf fixes, live A/B)
- **clusterRatings** `51f12179`: useSpotRatings minted a fresh ratings map per grid commit → re-rendered
  the memo'd MapMarkerLayers even when LEVELS unchanged. Fix: stable prior ref when value-equal
  (`ratingsShallowEqual`). **Live A/B 9→3 churn (−67%).** Kill `__RAW_DISABLE_RATINGS_STABLE_MEMO__`.
- **marineWindData** `5355e65e`: FCE-input memo depended on the raw `timeOffsetHours` (only a hourOffset
  FALLBACK). Fix: depend on the EFFECTIVE hour; output byte-identical. **Live A/B 21→9 / 12→1 (−57%),
  engine frames identical (no freeze).** Kill `__RAW_DISABLE_MARINE_WIND_HOUROFFSET_MEMO__`.
- **NOT touched (forensically cleared):** `simulationField` churn is a Step-button/settled artifact (drag
  uses the in-place path); `omTileUrls` = time-dependent raster tiles. See [[clusterratings-rerender-storm-2026-07-21]].

## 3. SHIPPED — 2 verified defects from an adversarial hunt (`1416b823`, `23e544a0`)
- **marineGridSeries leaks** `1416b823`: (a) `signal.addEventListener('abort',…)` on the session-long
  caller signal never removed (loadSeriesPage:402/loadSeriesHour0:545) — hundreds accumulate over a
  pan/scrub session; fixed with a named handler removed in the finally. (b) `_idleTimers` accumulated fired
  timer ids (coarse-reval/warming/fail-retry) — `armIdleTimer` self-deletes. Behaviour-neutral, 3 tests.
- **Wind stale-model commit** `23e544a0`: WeatherEngine viewport-refetch (:975) had no abort signal + no
  model-parity check → previous model's grid committed as the selected model on a mid-flight switch. Added
  the guard mirroring :884/:253. Kill `__RAW_DISABLE_WIND_VIEWPORT_MODEL_GUARD__`.

## 4. SHIPPED — LAND-MASK HALO gate (`25fd7c18`) — ⚠️ VISUAL A/B PENDING USER CONFIRM (the live thread)
**User-reported:** the marine heatmap bleeds onto coastal land ("land mask halo"), all layers.
**Root (live-traced, corrected):** when a committed regional grid is SHORT of the viewport (coverage gap),
the uncovered strip samples `u_oceanMaskTexture` + `u_waveTexture` out of bounds → both GL_CLAMP_TO_EDGE
their edge value (edge WATER + edge wave) → heatmap floods the land beyond the grid. **NOTE: my FIRST fix
targeted the overlay REPLACE ring — WRONG (overlay is INACTIVE at the user's zoom; the ring is outside a
settled viewport anyway). Reverted. The base mask/data edge-clamp is the real mechanism.**
**Fix (WebGLMarineShaders.js heatmap FS):** blank `oceanAlpha` where outside BOTH data (tex_u/tex_v) AND
mask (mask_u/mask_v) bounds. Provably no-op for global grids/masks (mod wraps) and the DECOUPLED world-grid
case (outside-mask-inside-data → base stands, the documented Istria/Susak trap avoided). Kill
`__RAW_DISABLE_HEATMAP_BOUNDS_GATE__`. 3 shader-source tests + suite 1355; live: compiles, uniform used, no
regression to the covering case.
**⚠️ OPEN:** the coverage gap is INTERMITTENT (self-heals ~0.6s when a wider grid loads) so a clean
before/after screenshot was elusive — the USER confirms visually (flip the kill switch on a coastline:
on = blank strip, off = flood). **TRADE-OFF / FOLLOW-UP:** the gate blanks the WHOLE strip (land correct,
but a WATER-strip flash on fast pan). The user also asked for SMOOTH PAINTING ON PAN — the full fix is
pan-ahead MASK coverage (know land vs water in the strip) via activating the viewport OVERLAY for the
regional coverage-gap case (refreshViewportOverlayMask, viewport ± 50% pad). Today smooth-pan rides the
coverage self-heal. See [[marine-heatmap-clear-and-halo-forensics-2026-07-21]] §1.

## 5. ⚠️ INSTRUMENT PITFALLS (cost hours — DO NOT REPEAT)
- **`window.__MARINE_ENGINE__._waveData` is NULLED after texture upload** to `_residentWaveTex`. So
  `_waveData:null` is NORMAL and is NOT a "heatmap cleared" signal — the heatmap renders from the TEXTURE.
  Reads flip true/false mid-upload. Valid "is it showing": a SCREENSHOT or `_residentWaveTex`. NEVER `_waveData`.
- `__MARINE_RENDER_SOURCE_DIAG__.renderable` = what REACT thinks should render, not GL truth. TWO diag
  shapes (`direct_mapwebgl` has vectorCount/nonzeroCount, not renderable).
- Browser-pane screenshots glitched intermittently (UnknownVizError) + hidden/unfocused tab throttles
  setInterval ~1/s & rAF to 2 FPS — under-samples polls. Warm up + retry; check visibilityState.
- Halo/coverage bugs are INTERMITTENT (transient grid coverage) — the reliable repro is the deterministic
  UNIT test; live pixel state is backend/cache-timing dependent.

## 6. REMAINING QUEUE
- **Halo (§4)** — VISUAL A/B + the pan-ahead smooth-pan follow-up (overlay-for-regional-coverage-gap).
- **Zoom-clear heatmap** — user-reported, TRANSIENT, not reliably reproduced (my `_waveData` instrument
  was invalid). Needs a reliable repro (user's exact gesture) + a valid instrument (screenshot / `_residentWaveTex`).
- **Hunt defect #3** (low): `_idleTimers` fired-id leak — ALREADY FIXED as part of `1416b823`.
- **Issue B** (future-scrub cleared-surroundings) — user product decision (07-21 EVE handoff §2).
- **ARBITER default flip** — user 8-item eye pass (server :3011).

## 7. WHERE THINGS LIVE / OPS
- Live harness: `preview_start name:"frontend-verify"` → localhost:3009 (openssl-legacy, mock-auth on
  `/map`, Render backend). Real GPU in the Browser pane. Drive marine via `window.map.jumpTo` + the
  "Waves"/"Wind"/"Step +1h"/"Jump to now" buttons (`.click()` by label). `__RAW_GPU__.overlayMask` /
  `.maskId` = mask state; `overlayMask.baseCoversView:false` + `reason:"coverage_gap"` = the halo condition.
- Kill switches added this session: `__RAW_DISABLE_MARINE_WARM_COVERAGE__` (+ per-source),
  `__RAW_DISABLE_MARINE_SERIES_FRAME_COVER__`, `__RAW_DISABLE_RATINGS_STABLE_MEMO__`,
  `__RAW_DISABLE_MARINE_WIND_HOUROFFSET_MEMO__`, `__RAW_DISABLE_WIND_VIEWPORT_MODEL_GUARD__`,
  `__RAW_DISABLE_HEATMAP_BOUNDS_GATE__`.
- Windows python broken → `AppData\Local\Python\bin\python3.exe`. Bash CWD persists (cd to frontend before
  craco). Craco: `node node_modules/@craco/craco/dist/bin/craco.js test --watchAll=false`. ⚠️
  WebGLMarineEngine.js has 9 PRE-EXISTING eslint errors (no-redeclare/no-undef) — grandfathered; the build
  (v8 config) tolerates them. Verify a shader hot-edit loaded by grepping the loaded MapPage chunk.
