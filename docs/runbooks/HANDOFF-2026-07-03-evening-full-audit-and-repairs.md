# HANDOFF — 2026-07-03 evening: to-do sweep complete, full audit, deep-dive repairs (dev `fd4ac138`)

**Standing order unchanged: dev-only, NO main pushes.** Netlify prod = `main`, ~620 commits behind —
verify bundle hash (the **MapPage CHUNK**, not bundle.js!) before diagnosing "still broken".
Companion: `docs/audits/AUDIT-2026-07-03-weather-system.md` (the full front-to-back audit) +
memory `gate-rebuild-verified-2026-07-03`, `gulf-bay-sweep-and-visual-contrast-2026-07-03`,
`satellite-black-patches-triage-2026-07-03`.

## 0. Where the system stands

Every item from the night-2 handoff and the day's user requests is CLOSED. 19 commits shipped
2026-07-03 (`7d3b8a71`..`fd4ac138`), each tested + live-verified. Suites at handoff: backend
476/476, frontend 508/508. Serving matrix probed live: 17/18 model×layer combos healthy
(ICON swell_2 empty = by-design GWAM gap, synthesized client-side as `gfs_euro_blend`).

**The day's arc, compressed:** gate rebuild VERIFIED (pinned-`ncep_gfswave025` discriminator +
R_d block probes — the raw best_match bar is weather-dependent and NOT a product invariant) →
backend freeze lifted → Gulf/Texas + worldwide gulf/bay /point classes fixed (degraded-sample,
masked-bilinear smear, inland-zero) → §0B-a confidence pipeline shipped END-TO-END (export →
GridVector.dir_confidence → mapper → conform → encoder → seam-fade machinery; (20,−120) conf
0.242 renders dim, (20,−110) conf 0.9987 renders full) → visual contrast upgrades (+20%
low-range heatmap, zoom-band crest self-contrast z3.5–4.4) → dedup/wedge class closed
(orchestrator ledger-only sites, surf boot pin + mode-keyed caches, stranded fetch-pending
stamp, phantom inflight entry) → full audit → final repairs (reduced-motion a11y, docs stamp,
orphan engine deletion).

## 1. This evening's commits (each = BEFORE → AFTER, all live-verified)

- `56c63dbf` **/point smear + inland-zero**: Gulf of Oman 3.07m (Arabian-Sea smear) → 0.8m
  direct; Kansas fabricated 0.0 → "--". `bilinear_ocean_masked` at GLOBAL COARSE (marine) joins
  the degraded set; null upstream heights can never coerce to zeros; `point_resolution.py`
  split at the 800-LOC hook (`point_direct_fallbacks.py`, re-exported).
- `194fd1e8` ⚠️ **THE conform mirror**: `useMarineWindData.conformedGridBase` is the LAST vector
  rebuild before the GPU and drops any field not on its explicit list — it ate `is_valid`
  (night-1) and `dir_confidence` (found live: waves-sub had it, top-level didn't, scaledCells 0).
  Now carries dirConfidence (camel + snake); encoder reads all four shape variants.
- `8ff9dc79` **surf boot pin + mode-keyed identity**: getSurfModeFlag stamps window flag on
  first read; per-model-hour cache keys (4 sites) + useMarineWindData held-frame keys carry the
  Swell↔Surf mode. Known residual: toggle-mid-fetch cache-label race (bounded by forced refetch).
- `bb7d5da3` **fetch-pending stamp identity-clear + registry delete-before-record** — the
  night-1 "fetchPending wedged true / phantom active entry" leftovers, structurally closed.
  Verified: toggle storm ends 6/6 completed, active=[], pending=null.
- `7fdc2626` docs: the full audit.
- `fd4ac138` **final repairs**: prefers-reduced-motion damp (0.15× drift, heatmap untouched,
  `__RAW_REDUCED_MOTION__` override, `__RAW_GPU__.anim.reducedMotion` echo); system-brain
  weather doc stamped PARTIALLY STALE w/ current pipeline map; **GPUWindLayer.js deleted**
  (495 lines, zero imports, yet edited 2 days ago — the edited-while-dead hazard).

## 2. Regression map from the 3-month study (2,559 commits)

Churn hotspots = where regressions live: `MapWebGL.js` (358 touches), `marineController.js`
(174), `useMarineOrchestrator.js` (150), `WebGLMarineLayer.js`/`OceanMask.js` (122 each),
`WebGLMarineEngine.js` (97). The recurring defect FAMILIES (all now with structural fixes +
tests): ① side-ledger vs state divergence (dedup wedges) → state-authoritative
`shouldSkipDuplicateCommit`; ② explicit-field-list vector rebuilds dropping data → conform +
encoder read-chain hardening (any NEW GridVector field must be added to
`mapNormalizedGridToWebGL` AND `useMarineWindData` AND the encoder read chain — grep
`dirConfidence` for the template); ③ mode/identity missing from cache keys → surf marker in
layerPart; ④ ownership-scoped global flags stranded by superseded requests → object-identity
stamps; ⑤ bbox/wrap geometry (antimeridian, feature-vs-polygon culls) — per-polygon culling +
monotonic-lng patterns are the reference implementations.

## 3. OPEN / NEXT (priority order)

1. **User eyeballs** (unchanged): Baja directions + 25°N/−115° 4-corner seam + close-zoom
   roam + the NEW confidence-fade look (41 Southern-Ocean cells <0.65 render dim crests — the
   heatmap stays full; that asymmetry is the design).
2. **Upgrade queue** (audit §6, in order of value): ① encoded marine data tiles (JSON vectors →
   raster-encoded, off the main thread — biggest win for the 1-CPU backend); ② two-texture
   hourly time-interpolation for continuous scrubber playback (second resident wave texture +
   mix uniform); (reduced-motion ✅ done).
3. **Docs**: rewrite `frontend/system-brain/weather-simulation-system.md` architecture map
   properly (the stamp is a tourniquet, not the fix).
4. **Residuals (watch, no action)**: toggle-mid-fetch surf cache-label race (full fix = grid
   carries its own surf marker end-to-end); SWR-reschedule-vs-dup-skip cycle (terminated by
   dedup; touch SWR scheduling only with a live repro); satellite black patches (run the
   2-min triage in memory FIRST on recurrence).

## 4. Landmine sheet (new this session — check FIRST next time)

- **Bundle checks**: map code lives in the `src_components_MapPage_js-*.chunk.js`, NOT
  bundle.js. A "reused" preview server can serve a pre-edit compile — verify chunk markers
  (`dirConfidence`, `u_crestContrast`) before ANY live-behavior conclusion.
- `map.stop()` before `jumpTo` — the boot camera animates ~20s and silently overrides jumps.
- Cancelled ingestion runs still upload EARLY valid-hours (run_time per-product, not per-run) —
  a "cancelled" run can still refresh what's serving.
- The raw global-scan bar (13/11/4) is weather-relative. Verification recipe: raw scan →
  pinned-`ncep_gfswave025` discriminator → R_d block probe. Only "R_d≥0.65 AND ours far from
  DIRPW block mean" is a product defect.
- `__MARINE_DIR_CONFIDENCE__.scaledCells` counts every conf<1.0 cell (~366/367); read `min`
  and the <0.65 population for signal.
- Theme switch for tests: `localStorage['raw-surf-theme']` = dark|light|beach + reload.

## 5. Verification quick-reference (proven levers)

`__RAW_GPU__.anim` (per-frame truth: crestContrast, reducedMotion, seamFadeFloor, …) ·
`__MARINE_DIR_CONFIDENCE__` · `__MARINE_INFLIGHT__` (active must drain to []) ·
`__MARINE_FETCH_PENDING__` (must return to null) · `__FETCH_OM_TILE__(variable, ti, model)`
(raster forensics) · synthetic grids via captured `map.painter.context.gl` +
`__ORIG_SET_WAVE_DATA__` · FBO readPixels on `engine._residentWaveTex` · kill switches:
`__RAW_DISABLE_DIR_CONFIDENCE__`, `__RAW_CREST_CONTRAST__`, `__RAW_REDUCED_MOTION__`,
`__RAW_DISABLE_DIR_DILATION__`, `__RAW_DISABLE_NO_DOWNGRADE__`, `NOAA_COARSE_DIR_{BLOCKMEAN,TOTAL_FIELD,CONFIDENCE}`.
