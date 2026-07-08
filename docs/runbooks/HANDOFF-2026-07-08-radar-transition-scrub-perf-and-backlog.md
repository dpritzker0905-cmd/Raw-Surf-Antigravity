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
