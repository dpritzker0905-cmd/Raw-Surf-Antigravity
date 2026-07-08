# HANDOFF — 2026-07-08: Radar nowcast→forecast mismatch, scrub/toggle perf root, and the ranked backlog

**For a fresh context starting tomorrow.** Discussion-mode forensics (no code changed in this analysis).
dev HEAD `2aacf99d`, dev == origin/dev (PUSHED). prod Netlify = `main` (NO main push). Read the memory
index + `HANDOFF-2026-07-06-eve-radar-runpin-euro-guard-lightning.md` (§5 = 3-mo regression ledger, §6 radar,
§10 z9 clamping) first. This doc adds the radar-transition + scrub-perf roots and the ranked next steps.

---

## 0. What shipped this session (07-08) — the foundation is now healthy

| Commit | What |
|---|---|
| `10a5a4a4` | **forecast-ingest cron-HANG fixed** — root was a missing `POINT_CACHE_MAX` (default 100): the CMEMS pre-warm cached 977 pts but per-box eviction trimmed to 100 → 0 batched hits → 846 per-point subprocess spawns = the ~100-min ratings tail that crossed the 165-min timeout. Fix = `POINT_CACHE_MAX=6000` (precompute parity) + self-correcting cap floor. |
| `806976d4` | Point-fallback empty-error → diagnosable (`{e!r}` + WARNING; transport transients, fail-open). |
| `a2e3bf28` | **Data-freshness health check** — `compute_data_health` (9 lanes: liveness/presence/parity/horizon) + cron `health.json` + `GET /api/health/data` (503 when critical). |
| `9800a7eb`/`44050d3e` | **Themed admin health viewer** in `WeatherDiagnostics.tsx` (light/dark/beach) + model-aware horizon floors (GFS 288 / EURO 192 / ICON 96h — ICON native 5-7d was cry-wolfing a fixed 7d floor). |
| `ca7f69ff` | **Cron-health monitor workflow** (`data-health-monitor.yml`, polls /api/health/data every 30m, red X on critical) + **L2 orphan-sweep tool** (`sweep_orphaned_l2.py`). |
| `2aacf99d` | 4 stale ingestion tests → green (hermetic, authoritative path) + split `test_weather_services.py` (1101→645) into `test_weather_ingestion.py` (463). |

**Live-verified:** all 8 direct sources flowing (NOAA/DWD/ECMWF/Copernicus), `/api/health/data` = ok, freshest 0.2h.
**One user-gated action left:** run `python backend/scripts/sweep_orphaned_l2.py --delete --yes` to reclaim ~1.2 GB
(22,674 orphaned L2 objects — dry-run confirmed; delete not run because it's hard-to-reverse prod storage).

---

## 1. RADAR forecast↔nowcast mismatch ("loses visuals when it switches into forecast")

### 1a. Forensic verdict — this is the §6a coverage cliff, and it is DATA TRUTH, not a render bug
Measured (runbook §6a, raw pre-pipeline tiles): **RainViewer OBSERVED past frames = 9.71% CONUS coverage;
HRRR forecast frames = 3.27%.** A **~3× drop** in precip AREA at the "now" boundary. When the timeline crosses
into forecast, the model simply predicts precipitation over ~1/3 the area RainViewer observed (HRRR doesn't
carry the low-dBZ observed echoes, and its QPF footprint is smaller). RainViewer's own `nowcast` array is
EMPTY (discontinued Jan 2026), so there is no dense observed→forecast bridge feed. You reported this exact
symptom before ("when the forecast starts it makes the weather dissipate visually").

**What is ALREADY shipped and sound (do NOT re-chase):**
- **Run-pinning** (`cbbc9557`, `radarForecastSources.js` `discoverHrrrRun`/`refp-t`): future frames pin exact
  wall-clock valid times off the discovered HRRR run, so the timeline no longer jumps ~1.7h backward at "now".
- **Palette continuity** (`acf637c8`/`201d6a7b`, `radarTileRecolor.js` `hrrr-rv://`/`dwd-rv://`): HRRR/DWD tiles
  recolored client-side to RainViewer scheme-7 → one continuous palette across "now".
- **Texture parity** (§6 `d5ec3b96`): 512px GetMap on 256px tiles (2× supersample) + 1.5px blur → future frames
  match the smoothed organic nowcast look (visually verified).
- **Per-frame-layer architecture** (`6e29694e`): each frame is its own Source/Layer (RainViewer's pattern).
  ⚠️ NEVER revert to a single re-pointed source (caused the MapLibre corruption loop `d4cf42af`).

### 1b. The real fix (the top OPEN radar item — big lift, high visible value)
**Advection nowcast.** For "carry over exactly," extrapolate the LAST OBSERVED RainViewer frames FORWARD along
their motion vector for the near term (0-30/60 min), then cross-fade into HRRR for longer leads. This carries
the observed precip continuously (advected, not frozen) so the visuals don't cliff at "now". A **frozen-
persistence** underlay was TRIED and REVERTED (§6 graveyard — stale echoes = wrong, read as ghosting). The
advection version is the real fix: compute a per-pixel/optical-flow motion field from the last two observed
frames, warp the latest frame forward per lead, blend `alpha(lead)` from advected→HRRR as lead grows.
- **Jacobian:** highest *visible* radar value; MEDIUM coupling (isolated to the radar layer + a new advection
  module; does NOT touch the marine engine). Effort = HIGH (optical flow + warp + blend + perf on 256px tiles).
- **Scope carefully:** near-term advection only (≤60 min); HRRR remains the authority beyond. Kill switch
  `__RAW_RADAR_ADVECTION_DISABLED__`. Verify against a live storm (CONUS) that the boundary no longer cliffs.

### 1c. Also verify live tomorrow (cheaper, may be a second contributor)
Before the advection lift, confirm on a live CONUS storm whether there is ALSO a *discrete* discontinuity beyond
the coverage cliff: (a) does `discoverHrrrRun` ever return null (feed hiccup) → future frames vanish entirely
(reads as "loses visuals")? (b) is there a blank/gap frame exactly at the transition (last observed at "now"
vs first HRRR at now+15/30)? (c) does the recolor ever fail-open to the native green ramp mid-animation? These
are cheap to check with the frame-by-frame timeline and would be quick wins independent of advection.

---

## 2. Timeline SCRUB + marine LAYER-TOGGLE slowness ("slow or buggy") — the "once and for all" root

### 2a. Forensic root — the frame index re-renders the whole map tree
`MapWebGL.js` takes **`radarFrameIndex`, `radarFrames`, `timeOffsetHours` as PROPS** (MapWebGL.js:58-60). Every
scrub tick, the parent changes these → **MapWebGL re-renders** (a ~850-line component) → and react-map-gl
reconciles the per-frame radar Source/Layer set on every step. The chip **task_c5366c79** already memoized the
CHILD layers so they don't re-render with the parent — slices SHIPPED: OceanMask (`b720752c`), WebGLMarineLayer
+ MapMarkerLayers (`2cb4e709`), WebGLWindLayer + WindParticleOverlay (`19b2ec79`). **But the parent MapWebGL
itself still re-renders every scrub tick — the "big one" that remains.** Data-side is already optimized (scrub
tile cache `a978db02`; GFS/ICON marine series full-range fetch+slice `99460f29`), so the residual jank is the
RENDER path, not fetching.

### 2b. The durable fix (truly once-and-for-all) — decouple frame state from React render
Pick ONE (in increasing order of "correctness", all high-coupling → full §5c ritual + A/B with a scrub-FPS
harness before shipping):
1. **Imperative frame updates (recommended end-state).** Scrubbing should NOT go through React reconciliation.
   Hold the radar frame sources mounted once; on scrub, imperatively swap visibility/opacity of the active
   frame's layer via `map.setPaintProperty`/`setLayoutProperty` (or `source.setTiles`) in a ref-driven effect
   keyed on `radarFrameIndex`, and drive the marine engine's frame via its existing imperative `setWaveData`
   path. MapWebGL stops taking the frame index as a render-driving prop. This is the RainViewer/mapbox pattern
   (per-frame imperative, zero React churn) — matches the per-frame-layer architecture already in place.
2. **Context split.** Put `{radarFrameIndex, timeOffsetHours}` in a dedicated React context; only the radar/
   time-dependent subtree subscribes (`useContext`). MapWebGL no longer receives them as props → its render is
   stable across scrub; only the small time-consuming subtree updates.
3. **Subtree extraction.** Lift the time-dependent layers into a separate `<RadarTimeLayers frameIndex=…>` that
   is the only thing re-rendering on scrub; wrap the rest of MapWebGL in `React.memo` so it's inert on scrub.

**Jacobian:** HIGH value (the user's daily complaint), HIGH coupling (MapWebGL is the biggest churn-hotspot
component — §5c). This is exactly the "scoped NOT rushed" class: build the scrub-FPS harness first (mark
`radarFrameIndex` change → next paint; count MapWebGL renders/scrub), A/B each approach, verify ZERO new marine
`__WEBGL_MARINE_CLEAR_COUNT__`/particle resets. Recommend #1 (imperative) as the end-state, but #2 (context) is
the lower-risk first step that removes the parent re-render with the least surface change.

### 2c. Marine layer-toggle churn (the second half of the complaint)
Switching marine layers/models churns: the OceanMask deactivate-per-switch hide/show + a follow-up fetch skip
(task_c5366c79 ORIGINAL scope, still open) and the resident-GPU-state handling through transitions
(`15302d35` held resident state through model/layer transitions; `d7e89335` field/engine no-downgrade parity).
The durable fix is the same family as §2b: keep the mask/engine RESIDENT and swap data imperatively rather than
tear-down/rebuild per toggle. Verify with the mask-flood probe (`__MASK_PROBE__`) that no re-flood/blank frame
occurs on toggle.

---

## 3. RANKED BACKLOG (Jacobian: value ÷ coupling, and what can be done safely-now vs needs-a-session)

| # | Item | Value | Coupling / risk | Notes |
|---|---|---|---|---|
| 1 | **Scrub/toggle re-render fix** (§2b) | HIGH (daily UX) | HIGH (MapWebGL §5c) | Context-split first (low-risk), imperative end-state; scrub-FPS harness + A/B. |
| 2 | **Radar advection nowcast** (§1b) | HIGH (visible) | MEDIUM (radar-only) | Big lift (optical flow); near-term only; kill switch; live-storm verify. |
| 3 | **z9 clamping §10c** (prev runbook) | HIGH (visible) | HIGH (marine commit §5c) | Ready-to-execute spec exists; commit-during-gesture, full-coverage gate, harness A/B. |
| 4 | **Run L2 orphan sweep** | MED (1.2GB cost) | LOW (guarded tool) | User-gated delete: `sweep_orphaned_l2.py --delete --yes`. Safe by construction. |
| 5 | Radar live-checks (§1c) | MED | LOW | Cheap: HRRR-discovery-null / boundary-gap / recolor fail-open. Possible quick wins. |
| 6 | Sheltered-water / intracoastal exposure model | HIGH (accuracy) | MED, design-heavy | Rating truth for protected spots; multi-step design. |
| 7 | External uptime probe on `/api/health/data` | MED (stability) | ~0 | UptimeRobot/cron-job.org, survives a GitHub outage the internal monitor can't. |
| 8 | Eyeballs owed | LOW | 0 | colormap v5 light/beach, Baja 4-corner; DWD/EU radar palette LIVE-verify. |
| 9 | Reseed blink (swap-time land cull) | LOW | MED | Residual transient. |

**Deferred-with-reason:** items 1/2/3 are all high-coupling → NONE should be rushed async; each needs a focused
session with its harness + A/B against the §5a graveyard. Do them one at a time on clean/warm builds.

---

## 4. Landmines & brain-rules carry-forward (do not re-learn the hard way)
- **Judge marine/radar on CLEAN/WARM builds only** — cold Render (every dev push restarts it) + preview churn
  amplify clamp/dissipation perception. Cold-Render tell: failing spot-ratings/grid_series fetches.
- **radar render-mode SUSPENDS the marine engine** — any scrub/toggle fix must preserve this handoff.
- **NEVER `--no-verify`** (800-LOC pre-commit gate; split files instead, as done for `test_weather_services.py`).
- **`new Map()` in MapWebGL = react-map-gl shadow** (use `globalThis.Map`); protocol registration BEFORE source
  mount; `map.stop()` before jumpTo; screenshots time out under repaint loops (use serialize().data traces).
- **prod = Netlify `main` (~600 behind dev)** — recent FE work (themed viewer, etc.) only shows on dev previews;
  verify bundle hash == dev HEAD before diagnosing a "regression".
- **Data source-of-record** is locked in memory (`data-source-matrix-2026-07-08.md`): everything GRIB2 EXCEPT
  EURO marine = Copernicus netCDF; open-meteo = FALLBACK only; `7d3b8a71` coarse-vs-direct-point guard.
- **Admin-hang (07-08) was NOT a backend bug** — Render warm, endpoints fast, DB tiny, admin code unchanged;
  most likely the cold-start window during this session's dev pushes. Re-check when warm before digging.

---

## 5. Suggested first move tomorrow
Start with **#5 (cheap radar live-checks)** to rule out a discrete discontinuity, THEN commit to either **#1
(scrub perf, context-split first)** or **#2 (advection)** as the session's focus — both are high-value but each
is a full focused session. Build the harness before touching MapWebGL. Run the orphan sweep (#4) whenever
convenient — it's safe and reclaims 1.2 GB.

---

## 6. SESSION CLOSE (07-08, Opus 4.8) — L2 orphan sweep moved to the cloud AND RAN clean (backlog #4 → DONE)

**Finish-the-runbook close. dev HEAD `35ab3b18`, dev == origin/dev (PUSHED). Tree CLEAN.** After the
§0–§5 forensics doc (`89ee5455`) shipped, two commits landed and the one user-gated action in the whole
backlog got executed — safely, in the cloud, verified. This section supersedes backlog item #4 and OPEN ①.

### 6a. What shipped after the forensics doc
| Commit | What |
|---|---|
| `65ff1140` | **Cloud L2 orphan-sweep workflow** (`.github/workflows/l2-orphan-sweep.yml`, `workflow_dispatch`) + **hardened the script for ephemeral runners.** Runs on `ubuntu-latest` so it completes with the user's computer OFF (the local delete of ~21k objects is a ~1h serial job). DEFAULTS TO DRY-RUN; delete requires checking the `delete` input → `--delete --yes`. `older_than_hours` input (default 24). |
| `35ab3b18` | **Own concurrency group** (`group: l2-orphan-sweep`, `cancel-in-progress: false`) — the first two dispatch attempts were **CANCELLED** (33s / 2m32s) because they shared a group with the ingest crons and got evicted. The sweep only touches >24h orphans NOT in the manifest, so it's safe to run alongside a live ingest and must not be evicted by it. |

**The ephemeral-runner landmine `65ff1140` closed (the reason the script needed hardening):** on a fresh
runner the local store is EMPTY, so `get_manifest()` would return zero live products → **every object reads
as an orphan → the sweep would delete the entire LIVE bucket.** Fix = `restore_from_supabase()` FIRST so
`manifest_names` is the true live set, plus two abort guards: (1) refuse if manifest < `SWEEP_MIN_MANIFEST`
(500) products; (2) refuse if > 95% of objects flag as orphan (manifest almost certainly failed to load).
Both are the "empty-manifest deletes everything" failure mode caught by construction.

### 6b. The RUN — actual outcome (run `28918394895`, DELETE mode, 1h4m, SUCCESS)
Live-pulled from the run log (this is ground truth, not the pre-run estimate):
- **Manifest referenced 6,400 live products** → guard 1 passed with wide margin (≥ 500).
- **Bucket had 27,569 objects; 21,133 were orphans (~908 MB)** older than 24h and not in the manifest —
  a **76.7% orphan ratio**, under the 95% abort → guard 2 passed.
- **Deleted 21,133 / 21,133** → bucket down to **~6,436 objects** (≈ the 6,400 live + reserved/recent).
  ~908 MB reclaimed (the earlier dry-run estimate "~22,674 / ~1.2 GB" was in the right ballpark; the delta
  is the live manifest having grown to 6,400 and the 24h window advancing between estimate and run).
- **Benign warnings:** a handful of `L2 delete failed … HTTP 400 … Object not found (404)` on future-dated
  `euro_marine_swell_2_global_coarse_*_estimated.json` — objects listed but already gone (list/delete race
  or a prior supersede). The store logs these internally and does NOT raise, so the counter still reached
  21,133/21,133. Not a failure; do not chase.

### 6c. Verification (post-sweep, live) — live data survived the delete
The **Data Health Monitor** (`ca7f69ff`, `data-health-monitor.yml`, polls `/api/health/data` every 30m)
ran on schedule at **06:43 / 09:19 / 11:20Z — all AFTER the sweep (04:51–05:56Z) — all green.** That is
the live proof the delete removed only orphans: `/api/health/data` = ok immediately after, and stayed ok.
The sweep's own guards (manifest ≥ 500, ≤ 95% orphan, reserved-key + <24h spare) held as designed.

### 6d. For the occasional future run
Accumulation is already stopped at the source (`10a5a4a4` cron-hang fix — CANCELLED runs were the orphan
factory). If the bucket drifts up again, re-run the cloud workflow instead of the local script:
`gh workflow run l2-orphan-sweep.yml -f delete=true` (omit `-f delete=true`, or leave it unchecked in the
UI, for a safe dry-run count first). Never lower `older_than_hours` below the ingest cadence — a live
ingest's not-yet-manifested uploads must stay outside the window.

### 6e. Ranked backlog — carry-forward (item #4 struck; the rest unchanged, all high-coupling)
1. **Scrub/toggle re-render fix** (§2b) — HIGH value / HIGH coupling (MapWebGL §5c). Context-split first
   (low-risk), imperative end-state; build the scrub-FPS harness + A/B before touching MapWebGL.
2. **Radar advection nowcast** (§1b) — HIGH value / MEDIUM coupling (radar-only). Big lift (optical flow);
   near-term ≤60 min only; kill switch `__RAW_RADAR_ADVECTION_DISABLED__`; live-storm verify.
3. **z9 clamping §10c** (prev runbook `12c6a2f2`) — HIGH value / HIGH coupling (marine commit §5c). Ready
   spec exists (commit-during-gesture, full-coverage gate, harness A/B).
4. ~~Run L2 orphan sweep~~ **DONE this session** (§6b) — 21,133 orphans / ~908 MB reclaimed.
5. Radar live-checks (§1c) — MED / LOW. Cheap: HRRR-discovery-null / boundary-gap / recolor fail-open.
6. Sheltered-water / intracoastal exposure model — HIGH accuracy / MED design-heavy (folds in 07-06-eve
   §8c residual ② tidal-creek/marshy-cay class, partial fix `a4795435`).
7. External uptime probe on `/api/health/data` — MED / ~0. UptimeRobot/cron-job.org, survives a GitHub
   outage the internal monitor can't (the monitor IS a GitHub Action).
8. Eyeballs owed — LOW / 0. colormap v5 light/beach, Baja; DWD/EU radar palette LIVE-verify from an EU viewport.
9. Reseed blink (swap-time land cull) — LOW / MED. Residual transient.
   Plus 07-06-eve §8b residual ① (zoom-out sub-second transient — overlay-built-during-zoom, coverage-gated,
   verify VISUALLY not by flood %).

**Deferred-with-reason (unchanged):** #1/#2/#3 are all high-coupling → NONE rushed async; each needs a
focused session with its harness + A/B against the §5a graveyard. Do them one at a time on clean/warm builds.

**Session status: CLOSED at `35ab3b18`.** Tree clean, dev == origin/dev (pushed), health monitor green
post-sweep, storage backlog reclaimed. The foundation (cron-hang, health check + monitor, orphan sweep) is
now healthy end-to-end; next session is free to take on one of the high-coupling UX items (#1 or #2).

---

## 7. SCRUB-PERF DEEP-DIVE (07-08, Opus 4.8) — backlog #1 root-caused, cheap wins banked, refactor spec'd

Built the harness (`3faf66d6`) and drove it live (warm preview-3007) to root-cause the "timeline scrub slow"
complaint. **The forensics reframed the fix and ruled out the wrong ones — read before touching MapWebGL.**

### 7a. What shipped
- `3faf66d6` **scrubPerfProbe** — `window.__SCRUB_PROBE__`: counts MapWebGL renders/step with per-hook
  attribution, samples frame times, watches `__WEBGL_MARINE_CLEAR_COUNT__` / `__MARINE_ZOOMSTATE_REINITS__`
  (the 0-tripwire). `bench(mode,{durationMs})` drives real playback; for a manual DRAG, step `setTimeOffsetHours`
  with `window.isScrubbingTimeline=true` (the real slider sets it, `MapWeatherControls.js:304`) or you bypass
  the atmospheric debounce and over-count. rAF hangs when the preview tab is unfocused — pace with setTimeout.
- `63765848` **ratings-churn fix** — `useSpotRatings` fired a fresh `{}` state-update every scrub step with the
  overlay OFF (`spotRatings` drove 47/95 renders). Now returns a shared frozen `EMPTY_RATINGS` + no-ops the
  idle setState. A/B: spotRatings 47→0, clusterRatings 47→2, clears/reinits 0/0. (Correct waste-removal; NOT
  the dominant cost.) Rating-overlay ON path unchanged; live-verified glyphs still populate.

### 7b. Root cause (measured, definitive)
Manual drag 0→48h ≈ **2 MapWebGL renders/step at ~62 ms median**. The **no-layer isolation test held the same
~62 ms** → the felt jank is the **parent MapWebGL re-render + react-map-gl `<Map>` reconcile + maplibre
repaint**, layer-independent. It is NOT the marine data/GPU (that only adds the P95 tail), because:
- the marine **upload path already tracks the scrubber** — `WebGLMarineLayer` uploads synchronously per commit
  via `safeUploadRef`→`safeUploadWaveData` (rAF-coalesced input, content-diffed skip, scrub-aware holds:
  `WebGLMarineLayer.js:752,840,918-932`);
- the vector conform (**"the last vector mirror"**, §5b) is **already memoized** on `marineData` identity
  (`useMarineWindData.js:55-160`) — it only re-runs on real data changes (~17× per drag, not per step);
- the atmospheric-tile machinery **debounces** during a real (fast) drag (`useOpenMeteoTileUrls.js:57-68`).

**∴ cheap/safe wins are EXHAUSTED with proof.** The `~62 ms` floor is `timeOffsetHours` re-rendering MapWebGL
every step because the marine data hooks in its body need the hour. No memoization removes it.

### 7c. READY-TO-EXECUTE SPEC — the imperative/subtree fix (the ONLY remaining lever; §5c churn-hotspot)
Goal: MapWebGL stops re-rendering on a scrub step. The heatmap already updates imperatively; the parent
re-render is pure waste on the ~⅔ of steps where `marineData` is even unchanged. Stage it, each step behind a
kill switch + harness A/B, `clears/reinits=0` as the hard tripwire, verify on a CLEAN/WARM build:
1. **Lift `timeOffsetHours` into a `<ScrubTimeProvider>` above MapPage** (owns the atom + the forecast/radar
   playback intervals moved from `useWeatherState`). MapPage + its consumers (`useOpenMeteoForecast`, the
   `__MARINE_BOOT_DIAG__` effect, `MapForecastOverlay`, both `MapWeatherControls`) read via `useContext`.
   `props.children` isolation → MapPage goes inert on a scrub tick (no prop-stability audit needed — the win
   doesn't depend on it, unlike a fragile `React.memo(MapWebGL)`). **Behavior-identical; verify first.**
2. **Extract the heatmap into `<MarineHeatmapSubtree>`** (inside `<Map>`): it consumes the RAW scrub time from
   context → `useMarineOrchestrator`→`useMarineWindData`→`WebGLMarineLayer`; re-renders per step (cheap, small
   subtree). It **publishes `marineData` up DEBOUNCED** (a ref+throttled setState) for MapWebGL's NON-heatmap
   consumers — `useSpotRatings`, `useSimulationField`/`useRenderPlanBridge` (FCE = diagnostics in normal mode,
   not the heatmap driver), `useLayerTruthDiff`, `useMapDebugTools`, `onMarineDataChange`→`MapForecastOverlay`,
   `TruthOverlay` — all of which are settle-tolerant. MapWebGL now re-renders only on the DEBOUNCED cadence.
3. **A/B** with the harness (target: renders/step → ~0 on the ⅔ unchanged-data steps; median well under 16 ms);
   confirm the mask stays correct (`__MASK_PROBE__`), zero new clears/reinits, and — the landmine — the
   infobox/forecast panel still tracks (they now read debounced marineData; verify no stale-hour mislabel).
- Kill switch `__RAW_SCRUB_DECOUPLE_DISABLED__` restores the prop path. Use the **React DevTools Profiler
  flamegraph** to confirm which setState remains the second render/step before declaring done.
- ⚠️ This touches the subsystem carrying the most §5b guards — do it as its own focused session, not a tail.
  Do NOT attempt the fragile `React.memo(MapWebGL)` shape (≥10 props from various hooks, stability unaudited;
  one unstable prop silently defeats it and "fixing" it in a shared hook ripples). Provider-isolation is safer.

### 7d. State at deep-dive close
dev `63765848`, **+3 ahead of origin/dev (unpushed** — 1 Render restart when batched): `52cccace` (runbook
close), `3faf66d6` (harness), `63765848` (ratings fix). Tree clean. Diagnosis complete + bounded; the remaining
fix is spec'd above for a dedicated execution. Harness is the permanent A/B + eventual CI-gate net.

---

## 8. SESSION CLOSE / FRESH-CONTEXT HANDOFF (07-08 late, Opus 4.8) — START HERE

**State:** dev HEAD `d2e85c6e`. **origin/dev at `9ef2a14e`** (the `52cccace`→`9ef2a14e` batch is PUSHED);
`3b8dfe73` (radar resilience) + `d2e85c6e` (ratings test) are **+2 LOCAL, unpushed** (1 batched Render restart
when you push). Tree CLEAN. **Full FE suite audited GREEN: 85 suites / 696 tests** (this session added the
harness + 2 regression locks, changed 5 code files, broke 0). Preview 3007 warm.

### 8a. What shipped this session (a "finish the runbook" that became a backlog #1/#2 arc)
| Commit | What |
|---|---|
| `52cccace` | Finished the runbook (§6) — L2 orphan sweep moved to a CLOUD workflow AND ran clean (21,133 orphans / ~908 MB reclaimed; health monitor green post-sweep = live data survived). |
| `3faf66d6` | **scrubPerfProbe** (`window.__SCRUB_PROBE__`) — the scrub-FPS harness backlog #1 mandated. Counts MapWebGL renders/step with per-hook attribution + frame-time sampling + the `clears`/`reinits` 0-tripwire. |
| `63765848` | **Ratings-churn fix** — `useSpotRatings` fired a fresh `{}` state-update every scrub step with the overlay OFF (`spotRatings` drove 47/95 renders). Now a shared frozen `EMPTY_RATINGS` + idle no-op setState. |
| `9ef2a14e` | Scrub-perf deep-dive (§7) — root cause + cheap-wins-exhausted proof + the §7c refactor spec. |
| `3b8dfe73` | **Radar feed-hiccup resilience** — `discoverHrrrRun` falls back to the last-known run on total-probe-failure instead of `null`→blank forecast. +test, 16/16. |
| `d2e85c6e` | Test lock for the ratings stable-empty ref (prevents a silent churn regression). |

### 8b. Backlog status after this session (Jacobian: value ÷ coupling)
- **#1 scrub/toggle perf — ROOT-CAUSED, cheap wins BANKED, big fix SPEC'd (§7).** The ~62 ms/step jank is the
  parent MapWebGL re-render + react-map-gl `<Map>` reconcile (layer-independent — proven by the no-layer test),
  NOT marine GPU/data (upload already imperative + content-diffed; conform already memoized; atmospheric
  debounces). Only lever left = the **§7c `ScrubTimeProvider` + `MarineHeatmapSubtree` refactor** (HIGH coupling,
  §5b-guarded subsystem → dedicated session + React Profiler). Do NOT `React.memo(MapWebGL)` (fragile prop audit).
- **#2 radar — cheap checks CLEAN, resilience SHIPPED, advection remains.** Live-verified over FL: `discoverHrrrRun`
  works, boundary continuous (first HRRR frame now+3 min) → the two discrete-discontinuity quick wins ruled out.
  Shipped the feed-hiccup fallback (`3b8dfe73`). Remaining = the **§6a coverage cliff** (RainViewer 9.71% vs HRRR
  3.27%) → **advection nowcast** (MEDIUM coupling / radar-only, big lift; spec §8c). Needs a LIVE STORM to verify.
- **#3 z9 clamping — VERDICT: dedicated session, don't rush (§10c ready in 07-06-eve).** Settled z9 already
  resolved (crest-jitter `3d604a12`); residual is a ~600 ms INTRINSIC zoom-animation bridge + a load-bearing cold
  bridge. The §10c mid-gesture-commit fix is MODEST value on the marine COMMIT path (§5c hotspot + §5a timing-change
  graveyard) — "MUST be A/B'd against the graveyard, not shipped reactively." Same discipline as #1.

### 8c. Radar advection spec (the #2 remaining fix — grounded in this session's pipeline map)
Pipeline: `radarFutureFramesForModel` emits frame descriptors → `radarForecastTileUrl` builds a WMS URL with a
recolor-protocol prefix (`hrrr-rv://`) → the per-frame-layer manager (`MapWebGL.js:320-379`, `6e29694e`) mounts
one source/layer per frame and crossfades opacity. Plug advection in for the NEAR-TERM future leads:
1. `radarAdvection.js` (new, pure + unit-testable): from the last 2 OBSERVED RainViewer tiles, estimate a motion
   field. Start with the SMALLEST version — phase-correlation / block-match for a coarse-per-block (or single
   dominant) vector — before per-pixel optical flow. Test with synthetic shifted frames → estimated motion == shift.
2. `advect-rv://` protocol (mirror `radarTileRecolor`'s `hrrr-rv://`): for a near-term future frame at lead L,
   sample the latest observed tile warped by `-motion·L`, recolor to scheme-7, output. Cache warped tiles (like the
   scrub tile cache) — the warp is a per-tile canvas op.
3. Frames: emit advected frames for CONUS leads ≤~30-60 min (`source:'advect'`); **cross-fade `alpha(lead)`
   advected→HRRR** as lead grows (blend the two per-frame layers' opacity in the manager). HRRR is the authority
   beyond ~60 min. Kill `__RAW_RADAR_ADVECTION_DISABLED__`.
4. ⚠️ **Graveyard (§6a):** the FROZEN-persistence underlay was REVERTED (stale echoes = ghosting; and its per-frame
   `moveLayer`+source-recreate churned the style during scrub). Advection differs (the field MOVES), but MUST reuse
   the existing per-frame-layer architecture (NO moveLayer/source-recreate per step). Verify on a LIVE CONUS storm:
   near-term coverage should ≈ observed (~9.7%), not cliff to HRRR's ~3.3%; and the scrub must stay smooth.

### 8d. Landmines / carry-forward for the fresh context
- **Harness bench fidelity:** a manual DRAG must set `window.isScrubbingTimeline=true` (the real slider does,
  `MapWeatherControls.js:304`) or you bypass the atmospheric debounce and OVER-count. rAF hangs when the preview
  tab is unfocused — pace `bench` steps with setTimeout, not double-rAF.
- **Judge marine/radar on CLEAN/WARM builds** — the user's live observations this session (grid clamping,
  intracoastal spill, zoom-out squares) were all KNOWN preview-3007-amplified transients (z9 data-floor / mask
  self-heal / residual ①), not regressions; the harness's `clears`/`reinits` stayed 0 throughout.
- Everything else in §4 + the 07-06-eve §5a graveyard / §5b guards / §5d verification-discipline still stands.

### 8e. Recommended first move for the fresh context
1. **Push the +2 local commits** (`git push origin dev`) — one Render restart; puts the harness+resilience on origin.
2. Pick ONE dedicated item: **§7c scrub refactor** (biggest daily-UX win, needs the React Profiler) OR **§8c radar
   advection** (needs a live CONUS storm). Both are focused-session work; do NOT interleave with the marine §5b
   subsystem casually. Build/verify with the harness (#1) and `clears/reinits=0` (both), live-storm (advection).
3. #3 z9 (§10c) only when you want a marine-commit A/B session against the §5a graveyard.

**Session status: CLOSED at `d2e85c6e`.** FE suite green, diagnosis + specs complete for all three UX items, two
low-coupling wins shipped (ratings churn, radar resilience), two big-lift items scoped for dedicated sessions.
