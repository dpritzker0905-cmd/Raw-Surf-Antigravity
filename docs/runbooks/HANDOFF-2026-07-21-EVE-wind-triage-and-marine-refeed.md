# HANDOFF 2026-07-21 (eve) — OPUS 4.8: wind live-bug triage (×3 shipped) · marine #11 · issue B trade-off

HEAD `784b60cb` on `origin/dev` (verified pushed, HEAD==origin/dev). Suites at HEAD:
**frontend 1314/1314**, backend 811 (untouched this session). Continues the 07-21 takeover
(`789392b7`). Every claim below carries an instrument or a test.

## 0. BINDING RULES (unchanged, applied) — forensics not guessing · Jacobian lens · study memory +
this doc + recent commits before touching a subsystem · instrument-first + kill-switch + A/B ·
THREE THEMES × desktop/mobile for anything user-visible · probes run ALONE · hard-reload before
judging (HMR lies) · one change-set at a time, committed with evidence, pushed, `git log origin/dev`
verified. **Test twice** (user mandate this session).

## 1. SHIPPED THIS SESSION — 4 fixes, each rooted by instrument + tested twice

### 1a. `9cab00e5` — #14 wind DELIVERY QUEUE (the fenced takeover task, CLOSED)
Root (2 live instruments): on a model round-trip (GFS→EURO→GFS @ z5.5) the world base commits to
`windData` React state (base lane committed=2) but **React 18 batches it with the same-flush clip
commit**, so the layer effect's `[data]` dep fires ONCE with only the last-in-batch clip
(`__WIND_STATE_COMMITS__`=[360,360,22,22], delivered=only 22 → engine clip-primary). INTERMITTENT
race (kill-on repro FAILed cycle 2 not cycle 1). Fix: a commit-order **delivery queue** ref at the
`setWindData` choke (WeatherEngine), drained IN FULL by the layer effect (WebGLWindLayer) — the
engine's base/fine/promote filing is order-independent. Kill `__RAW_DISABLE_WIND_DELIVERY_QUEUE__`.
Tripwires kept: `__WIND_LAYER_DELIVERY__` + `__WIND_STATE_COMMITS__`. Verified 9 ways (gate PASS
drained:4 · kill A/B · toggle-off→pan→on · zoomburst dark/light/beach 0 clamps · suite).
See [[wind-delivery-queue-batching-drop-2026-07-21]].

### 1b. `4dc97010` — wind SCRUB BASE-LANE backfill ("half heatmap clear", USER-REPORTED)
Root (state+code+fault-injection): the base-lane world fetch lives in the PRIMARY fetch effect
(WeatherEngine.js:619, deps `[mapInstance, activeModel, forecastDays, isWindActive]` — NOT
`timeOffsetHours`) so it **never fires on a scrub**; the scrub effect (:922) commits only the
new-hour CLIP → clip-primary (no world base) → smeared/basemap-through until a moveend recovers.
Fix: when a scrub commits a non-covering clip, `backfillScrubWorldBase` fetches the world for THAT
hour → promotes under the clip. Kill `__RAW_DISABLE_WIND_SCRUB_BASE_LANE__`, tel
`__WIND_SCRUB_BASE_LANE__`. Suite 1300, near-hour no-op verified. User confirmed "seems better."
⚠️ live far-scrub firing was blocked by this session's short data horizon (see §3). See
[[wind-scrub-base-lane-gap-2026-07-21]].

### 1c. `ee0da1e8` — wind COARSE-OVERLAY guard ("grid within a full heatmap", USER-REPORTED, issue A)
Root (user console + deterministic test): a 5×4 (~4°/cell) `swr_revalidation_pending` SWR-preview
clip commits, then when the real 15,023-vector 2° world lands it PROMOTES and the coarse 5×4 is
**moved into the FINE overlay slot** (`5x4 moved to overlay`) — a blocky patch on good data. Fix
(WebGLWindEngine.setWindData, single filing choke): a grid may only occupy the fine overlay if not
CLEARLY coarser (`windGridClearlyCoarserThan`, cell>1.3×) than the base → `'noop_coarse'` /
promote-drop. WebGLWindLayer net-reseed now keys on the engine's actual BASE bounds before/after
the drain (no wasted reseed on a no-op'd coarse grid). Kill
`__RAW_DISABLE_WIND_COARSE_OVERLAY_GUARD__`. 5 deterministic tests (bug reproduced on old code, pass
after) + suite 1305 + zoomburst PASS. See [[wind-coarse-overlay-guard-2026-07-21]].

### 1d. `784b60cb` — marine #11 RE-FEED coverage guard (queue #11, CLOSED)
`reactivate_refeed` (WebGLMarineLayer:1187) + `initial_onAdd` (WebGLMarineCustomLayer:46) re-feed
the RETAINED frame with NO bbox check → toggle-off→pan→toggle-on paints a floating rectangle at the
old location (render's regional cull only fires zoomed OUT). Fix: `marineRefeedCovers(grid, vb)` —
pure exported predicate, only re-feed a covering-or-global grid, fail-open on any missing input.
Kill `__RAW_DISABLE_MARINE_REFEED_COVER_GUARD__`. 9 enumerated gate tests + suite 1314.
⚠️ **live floating-rectangle A/B still pending** (needs a marine session: waves on → toggle-off →
pan far → toggle-on, A/B via the kill switch, watch `__MARINE_ENGINE__._waveData` bounds vs
viewport). The guard is additive + fail-open + kill-switched, so low-risk to ship ahead of the live
leg.

## 2. ISSUE B — "clearing surrounding a grid-square heatmap" (USER-REPORTED) — ROOTED, FIX DEFERRED

The user pinned the trigger: **scrubbing the timeline into the FUTURE**. Reproduced live: a
far-future scrub commits a viewport clip for the new hour; cross-hour-incompatible with the resident
world base, the clip replaces the base (or the covering base is already lost), so the base is a
non-covering clip → cleared surroundings. The scrub backfill (§1b) fires and recovers, but a
**far-future world fetch takes ~3.5 s** (measured worstDwell 3467 ms) and "beyond precompute bound"
far hours may be coarse/unavailable. Eliminating the window means KEEPING a covering base during the
fetch — a genuine **coverage-vs-freshness product trade-off** (risk: briefly show a stale hour, or
get stuck if far-future data is unavailable). **I did NOT ship this blind** (avoid-regression
mandate, user asleep). Candidate fixes for the user to pick:
- (a) engine keep-covering: a cross-hour clip does not replace a covering GLOBAL base — hold it
  until the new-hour world lands (consistent with the codebase's "coverage over freshness"; but
  changes the `hour-mismatched regional replaces` test + drops the instant new-hour box). Kill idea:
  `__RAW_DISABLE_WIND_SCRUB_COVER_HOLD__`.
- (b) retained covering-fallback base slot (render the last covering world where the current base
  doesn't reach) — cleanest UX (snappy box + covered surroundings) but a shader change + transient
  cross-hour surroundings (the codebase avoids blending two hours).
- (c) prefetch adjacent future `world_mid` on scrub so the backfill hits cache (helps near-future
  only; far "beyond precompute" hours still cold).
Task #7 carries this. Recommend confirming the user's coverage-vs-freshness preference first.

## 3. ENVIRONMENT LANDMINES HIT THIS SESSION (save the next session hours)
- **Backend-state-dependent repros.** :3011 served FRESH grids all session, so the coarse SWR
  preview (issue A live) and the far-future clip-primary (issue B) only reproduce when the backend
  is REVALIDATING / the far-hour data is cold. My deterministic UNIT tests are the reliable repro;
  the live pixel state is backend-timing-dependent. The user's deployed dev site (Netlify + onrender
  backend, service worker `rawsurf-v3-<sha>`) hits these naturally.
- **Headless swiftshader HANGS on sustained runs.** `probe_wind_zoomburst.js` at ZB_CYCLES=12 lost
  its GL context ~frame 6 and hung, which also slowed :3011 (had to kill the node PID). Keep probe
  runs ≤6-8 cycles; for a "5-minute" test, drive MY Browser pane (real GPU, foreground) with an
  injected rAF watcher + gesture setInterval instead (reliable; used for the natural sustained test
  — 4600+ frames, 0 clamps). Kill orphan `chrome_headless_shell` (NOT the user's real chrome.exe).
- **The forecast wheel is a canvas widget** — programmatic left_click/keyboard on it is flaky, the
  weather panel collapses on re-render churn (clusterRatings storm, §4), and refs go stale. The
  `+1d`/`+1h`/`Jump to now` buttons work but the panel must be expanded. Data horizon capped scrubs
  at +3h in one session and reached +5 days in another (data availability, not the UI).
- **Wind data horizon varies by session/viewport** — `windCache.n` was 1 on a fresh load; far hours
  fetch on demand and "beyond precompute bound" ones fall back to coarse.

## 4. SEPARATE FINDING (not fixed) — clusterRatings re-render storm
React-Scan-style profiling (`window.__SCRUB_PROBE__.snapshot()`) during a 22 s gesture: **445
MapWebGL renders, `clusterRatings` caused 211 of them** (vs windData 13). A real perf smell (not the
half-clear). Candidate follow-up: memoize/stabilize the clusterRatings prop into MapWebGL.

## 5. REMAINING QUEUE (forensic maps ready in `scratchpad/marine_cluster_map.md`)
- **#10 marine containment cluster** (sources 1-3 + #13 Ecuador): scrub-cache containment-blind when
  zoomed IN (useMarineOrchestratorScrubCache.js:132 `rejectRegionalCache` only consults `isContained`
  when `isViewportZoomedOut` — extend to `(isGridWidthRegional && !isContained) || (isViewportZoomedOut
  && isRegional)`) · handleCooldownFallback commits on vectors.length alone (useMarineDataFetcherHelpers:314)
  · getMarineSeriesFrame proves containment vs entry.bounds not the served frame's per-frame bounds
  (marineGridSeries.js:678/717). Each is a HOOK-internal gate → needs a LIVE marine A/B (waves on,
  rating ON+OFF legs, zoomlab staircase+scrub+pan_coverage with guard-mode controls) OR extract the
  predicate to a pure exported fn + unit test (the #11 pattern). MINEFIELD: SETTLED_STEP at z7 hour
  scrubs is a KNOWN mode-independent content step — control before chasing. Mirror the reference
  predicate `regionalValidInPlace` (useMarineOrchestrator.js:556).
- **#12 tooling**: vortex probe multi-leg median metric (do NOT transplant zoomclamp TH_SUM=20 —
  measured worse in the frame-pair regime); zoomlab-diff 1.6 margin; non-backend remap lanes
  (useMarineOrchestrator:628 / scrubCache:242 — bounds-blind AND poison the fetch dedup hash).
- **ARBITER default flip**: still gated ONLY on the user 8-item eye pass (EVE §10). Unchanged.

## 6. WHERE EVERYTHING LIVES
- Forensic tools added: `scripts/analyze_halfclear.js` (per-frame colored-fraction + quadrant
  half-clear detector; ⚠️ clip-primary renders SMEARED not hard-cleared, so the zoomburst STRUCTURAL
  "clamp samples" is the signal, not the pixel analyzer). `probe_wind_zoomburst.js` sampler now logs
  base/fine resolution + flags coarse-overlay(A)/coarse-clip(B).
- Marine cluster map: `scratchpad/marine_cluster_map.md` (all 5 warm-commit sources, file:line +
  guard conditions + kill-switch context).
- Kill switches added this session: `__RAW_DISABLE_WIND_DELIVERY_QUEUE__`,
  `__RAW_DISABLE_WIND_SCRUB_BASE_LANE__`, `__RAW_DISABLE_WIND_COARSE_OVERLAY_GUARD__`,
  `__RAW_DISABLE_MARINE_REFEED_COVER_GUARD__`.
- Python: `AppData\Local\Python\bin\python3.exe`. Git via PowerShell (Bash git flaky). Craco test
  ran via `node node_modules/@craco/craco/dist/bin/craco.js test --watchAll=false` (npx flaked once).

The bar for every claim: an instrument the user could re-run. Issue B's fix is the one open product
decision; everything else is shipped + tested twice.
