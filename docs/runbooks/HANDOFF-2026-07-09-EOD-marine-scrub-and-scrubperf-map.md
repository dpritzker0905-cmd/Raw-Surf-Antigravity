# HANDOFF — 2026-07-09 EOD: strong stable checkpoint + the scrub-perf (§7c) forensic map

**For a fresh context.** dev HEAD `9c21de24`, **dev == origin/dev (PUSHED)**, tree CLEAN. **FE 88 suites /
741 tests GREEN.** prod = Netlify `main` (NO main push). User verifies on `dev--rawsurf.netlify.app` —
**always reconcile the deployed SW `BUILD_VERSION` vs HEAD before trusting a "regression"** (a stale SW served
an old bundle and cost multiple false alarms this arc). Read the memory index first, then this doc.

**The app is in a genuinely strong, stable state — that is the thing to protect.** Radar is closed, the marine
"heatmap clears on scrub" is fixed, the ingest pipeline is healthy at a 4h cadence, data is green. This session
ALSO fully mapped the scrub-perf refactor (§7c) and — deliberately — did NOT execute it. §7 below explains why,
and preserves the complete map so a future session can execute it cheaply IF it decides the reward is worth the
risk. **Do not default into §7c.** Read §7.0 before anything.

---

## 1. WHAT SHIPPED THIS SESSION (all on dev, pushed)

| Commit | What | Kill switch | Verified |
|---|---|---|---|
| `d6d98402` | **Radar neighbor-aware advection warp** — fills each tile's upwind edge from the neighbor's real echo; kills the last-hour "vertical rectangle" seams. | `__RAW_RADAR_ADVECT_NEIGHBOR_DISABLED__` | ✅ user: "radar is better" |
| `160ffcbe` | **Radar OBSERVED tiles → `/rv/*` proxy** — scrub NOW→past no longer clears (burst 429s). | `__RAW_RADAR_PROXY_DISABLED__` | ✅ |
| `74ef3897` | **Radar CATALOG → `/rv/*` proxy** — "radar barely visible" was a catalog 429 (not a render bug). | `__RAW_RADAR_PROXY_DISABLED__` | ✅ user: "working much better" |
| `133ca705` | **Radar smoothness pass** — preload window ±1→±2 + tile `raster-fade-duration` 300→180 ms. | `__RAW_RADAR_PRELOAD__` / `__RAW_RADAR_FADE_MS__` | ✅ user: "improving" |
| `b1f19453` | **Marine "heatmap CLEARS on scrub" fix** — hold the resident regional grid mid-scrub instead of uploading a coarser grid (the coarse↔regional flip). Pure helper `marineScrubHold.js` → `safeUploadWaveData`. | `__RAW_MARINE_SCRUB_HOLD_DISABLED__` (tel `__MARINE_SCRUB_HOLD_COUNT__`) | ✅ user: "improving" |
| `70ac67ce` | **Ingest cadence 3h→4h** (6 runs/day) — accuracy + relieves the shared-group oversubscription that caused the cancellation storm. | — | ⏳ watch a couple cycles |

Radar detail: `HANDOFF-2026-07-09-radar-close-and-marine-start.md` + memory `radar-advection-core-2026-07-08`.
Marine scrub-clears detail: memory `Marine (in progress)` line + that runbook §3a.

---

## 2. GH ACTIONS CANCELLATIONS — diagnosed, benign now (do not re-investigate)
The cancelled runs were **ingest crons** (not push-CI): a MIX of 165-min timeouts (GitHub labels a timeout
"cancelled"; fixed by `10a5a4a4`) + pending-queue evictions from the shared serial concurrency group doing ~3.5h
of work per 3h window. **Harmless to data** (an evicted *pending* run never wrote → no orphans; only a skipped
cycle). Zero cancellations in the last 100 runs; `/api/health/data` = ok, all 9 lanes green. The 4h cadence
(`70ac67ce`) gives the group margin. "Job not acquired by Runner" CI failures = GitHub runner contention with a
long ingest, NOT code. **Batch dev pushes** (each = CI+Lighthouse runner load + a Render restart).

---

## 7. SCRUB-PERF / §7c — FULL FORENSIC MAP + an HONEST "should you do this?"  ⚠️ READ 7.0 FIRST

### 7.0 Decision gate — DO NOT default into this
§7c is the durable fix for "timeline scrub feels slow" (the confirmed ~62 ms/step react-map-gl reconcile). But
weigh it honestly before spending a session on it:
- **Reward is MARGINAL.** The user described it as "a little faster." Scrub is **already responsive when warm** —
  the felt sluggishness in the 07-09 session was mostly **cold cache after 5 model-switches** (see 7.5), not the
  per-tick React cost.
- **Risk is MAXIMAL.** It's a monolithic refactor of the **371-commit MapWebGL hotspot** + MapPage + the whole
  `useWeatherState` atom, with **NO runtime kill switch** (Rules of Hooks) → git-revert is the only rollback.
- **Verifiability is PARTIAL.** Correctness across 5 entangled data pipelines can't be fully confirmed by tests +
  "feels fine" — it needs a live React DevTools Profiler + you exercising forecast/playback/switch/marine.
- ∴ **Jacobian = marginal value ÷ maximal coupling = LOW.** Only execute §7c if timeline-scrub slowness becomes a
  real, repeated user-blocking complaint AND you can commit a dedicated, watched, full-budget session.
- **Consider 7.5 (cache-retention) FIRST** — plausibly higher value (the model-comparison workflow) at lower risk.

### 7.1 Confirmed root (measured across prior sessions — do NOT re-derive)
Manual drag ≈ **2 MapWebGL renders/step at ~62 ms**; the **no-layer control drag held ~62–66 ms** (layer-
independent) and `map._render(0)` sync paint is ~1–4.5 ms → the cost is **main-thread React + the react-map-gl
`<Map>` reconcile when MapWebGL re-renders**, NOT GPU/paint. Cheap wins are BANKED (ratings-churn `63765848`,
static-`<Map>`-children memo `32e7035e` — kill `__RAW_SCRUB_MEMO_DISABLED__`). Harness: `window.__SCRUB_PROBE__`
(`scrubPerfProbe.js`) — renders/step + per-hook attribution + `clears`/`reinits` 0-tripwire.

### 7.2 Why there is NO safe partial win (the monolith proof)
MapWebGL re-renders every scrub tick because it takes `timeOffsetHours` as a **prop** and its body consumes the
**RAW** hour in FIVE entangled hooks (verified `MapWebGL.js`, 07-09):
- `useTemporalPreloader` (164) — raw.
- `useOpenMeteoTileUrls` (180) — raw input; it is the **debounce source** (emits `debouncedTimeOffsetHours`).
- `useMarineOrchestrator` (200) — raw (the heatmap; MUST stay raw to track the scrubber).
- `useSpotRatings` (212) — raw (settle-tolerant).
- `useSimulationField` (226) — raw (FCE = diagnostics in normal mode `40d28b9d`; settle-tolerant).

These produce `marineData`/`windData`/`simulationField`/`omTileUrls` that feed the WHOLE render. Debouncing just
the settle-tolerant hooks (ratings/FCE/preloader) reduces their internal work but **NOT** MapWebGL's re-render
(the prop still changes) → does NOT move the reconcile cost. Verified: no partial win exists.

### 7.3 The coupling that forces a full lift
In `useWeatherState.js`, `timeOffsetHours` is welded to `maxHoursForUser` / `isLockedForecast` (premium gate) /
the clamp effect / **both playback intervals** (the forecast interval WRITES `setTimeOffsetHours` every 4 s), all
derived from `user`/`activeModel`/`activeLayers`. So lifting the hour above MapPage drags the model/layer/
max-hours/lock/playback logic with it — it is a **top-level state-ownership restructure**, not a wrap.

MapPage consumers of the raw hour (all must be rewired to context): `useOpenMeteoForecast` (259, the infobox —
MUST re-run on scrub), the `__MARINE_BOOT_DIAG__` effect (241), the MapWebGL prop (416), both `MapWeatherControls`
(548–575), `MapForecastOverlay` (583–600).

### 7.4 Target architecture + increment order (for the future session)
Goal: MapWebGL's body re-renders only on the DEBOUNCED cadence; only a small marine subtree re-renders per tick.
1. **Lift `useWeatherState` into a `<WeatherProvider>` above MapPage.** Split into TWO contexts to dodge the
   context-value-identity pitfall: **`RawScrubTimeContext`** (`timeOffsetHours`, changes per tick) and
   **`WeatherStateContext`** (`activeModel`/`activeLayers`/radar/`maxHoursForUser`/`isLockedForecast`/setters,
   changes rarely). The provider ALSO owns the playback intervals + clamp and computes+provides
   **`debouncedTimeOffsetHours`** (relocate the debounce OUT of `useOpenMeteoTileUrls`). `MapPage` becomes a thin
   wrapper rendering `<WeatherProvider><MapPageInner/></WeatherProvider>`; `MapPageInner` reads `WeatherStateContext`
   only → inert on a scrub tick. **Behavior-identical; verify FIRST** (forecast, playback, model/layer switch,
   premium lock, radar, marine all unchanged) before step 2.
2. **Extract `<MarineHeatmapSubtree>`** inside MapWebGL: it consumes `RawScrubTimeContext` →
   `useMarineOrchestrator` → `useMarineWindData` → `<WebGLMarineLayer>`; publishes `marineData` UP **debounced**
   for MapWebGL's settle-tolerant consumers. MapWebGL's body switches to `debouncedTimeOffsetHours` (from context)
   + debounced `marineData` for `useTemporalPreloader`/`useOpenMeteoTileUrls`/`useSpotRatings`/`useSimulationField`/
   `useMapDebugTools`/`onMarineDataChange`/`TruthOverlay` → MapWebGL body no longer consumes the raw hour → stops
   re-rendering per tick.
3. **A/B with `__SCRUB_PROBE__`**: renders/step → ~0 on unchanged-data steps; median well under 16 ms; `clears`/
   `reinits` = 0; `__MASK_PROBE__` no re-flood; infobox/forecast still track (they read debounced now — verify no
   stale-hour mislabel). Rollback = git-revert (no runtime switch).

### 7.4a Guardrails the refactor MUST preserve (3-mo archaeology)
engine residency `9c89701e`/`15302d35`; synchronous scrub upload `6f173bc0`/`a9c30178`; the **vector mirror**
(`useMarineWindData` conform — the LAST place field lists eat `is_valid`/`dirConfidence`); FCE-decoupled-in-normal-
mode `40d28b9d`; the `task_c5366c79` memo slices `b720752c`/`2cb4e709`/`19b2ec79`; the marine scrub-hold
`b1f19453`. Verify `__WEBGL_MARINE_CLEAR_COUNT__` / particle-reinits = 0 throughout.

### 7.5 ⭐ CONSIDER FIRST — cache-retention on model-switch (plausibly better value/risk than §7c)
The 07-09 log showed `[MODEL] Model changed … wiping block cache` on **every** switch → scrubbing after a
GFS↔EURO↔ICON comparison hits a COLD cache (`Layer switch backend cache MISS` per hour) instead of the warm
`[SCRUB] [BACKEND CACHE] Instant re-index` fast path. Surfers compare models constantly, so this is a COMMON
workflow. **If per-model block caches can be keyed-and-retained across a switch safely** (retaining GFS's cache
while viewing EURO can't contaminate — EURO reads EURO's cache), switch-back becomes instant — fixing the
responsiveness the user actually felt, likely without touching the MapWebGL hotspot. ⚠️ The wipe MAY be
intentional (investigate `marineController` cache + the model-transition path before changing it; it is a guarded
subsystem). This is the recommended responsiveness investigation BEFORE committing to §7c.

### 7.6 EURO far-horizon churn (low priority, edge case)
Scrubbing EURO to hour ~336 (beyond Copernicus coverage) → `no_copernicus_coverage` 404 → safe-zero grid, and the
scrub-settle **backstop** re-drives the doomed fetch ~6× before the 3-retry cap. It's data truth + bounded churn.
Root: the terminal `__failureReason` (set by `createFallbackSafeZeroGrid`) doesn't reach the backstop's re-drive
gate. Fix = make the backstop respect a terminal-no-coverage signal (kill-switched), + extend
`marineEmptyGridRetry.test.js`. LOW value (rare) / rising complexity on a guarded subsystem — don't rush it.

---

## 8. HIGHER-VALUE / LOWER-RISK backlog (better next-focus than §7c)
- **Sheltered-water / intracoastal exposure model** — rating truth for protected spots (HIGH accuracy value; design-heavy, multi-session).
- **External uptime probe on `/api/health/data`** — UptimeRobot/cron-job.org; survives a GitHub outage the internal monitor (itself a GitHub Action) can't. ~0 risk.
- **Eyeballs owed** — colormap v5 light/beach, Baja 4-corner, DWD/EU radar palette from an EU viewport. LOW risk.
- **z9 §10c** commit-regional-mid-gesture (`__RAW_DISABLE_MIDGESTURE_COMMIT__`) — kill-switched marine-commit A/B; modest value.

---

## 9. LANDMINES & DISCIPLINE (carry-forward)
- **Judge marine/radar on CLEAN/WARM builds only** — cold Render + preview churn amplify clamp/dissipation perception.
- **radar render-mode SUSPENDS the marine engine** — any scrub/toggle work must preserve this.
- `new Map()` in MapWebGL = react-map-gl shadow (use `globalThis.Map`); protocol registration BEFORE source mount;
  `map.stop()` before jumpTo; `/grid` vectors live at `grid.vectors`. 800-LOC pre-commit gate = **Python files only**
  (JS is exempt), NEVER `--no-verify`. Screenshots time out under repaint loops (use `serialize().data` / `map._render(0)`).
- Headless preview can't judge animation/FPS/edge-functions; the user's real browser is the verifier.
- prod = Netlify `main` (~600 behind dev); dev pushes restart Render + add runner load → BATCH.

**Session status: CLOSED at `9c21de24`.** Strong stable checkpoint. Radar closed; marine scrub-clears + pipeline
cadence shipped; §7c fully mapped and DELIBERATELY deferred (marginal reward / maximal risk — see §7.0). Next
session: evaluate 7.5 (cache retention) for responsiveness, or pick a §8 higher-value item — NOT a default §7c.
