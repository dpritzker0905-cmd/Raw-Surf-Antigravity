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

## 0. UPDATE (07-09, later session) — SCRUB-PERF RESOLVED BY MEASUREMENT; §7c RETIRED

A follow-up session drove the `window.__SCRUB_PROBE__.bench('forecast',{durationMs:6000})` harness live on
`dev--rawsurf.netlify.app` (EURO waves, premium) at BOTH close and global zoom. **The measurement retires the
whole §7c question — do NOT execute the `useSyncExternalStore` refactor.**

| Metric | CLOSE (warm) | GLOBAL | Reading |
|---|---|---|---|
| `mapWebGLRenders` / 6s | 7 | 7 | **React barely re-renders under playback (~1/s)** → react-map-gl reconcile is NOT the bottleneck |
| `frameMsMedian` | 33.3 | 33.3 | **flat 30 FPS at every zoom** (≈ the fixed-timestep loop cap, not a GPU limit) |
| `frameMsP95 / Max` | 35.2 / 73.9 | 36.1 / 77.2 | zoom-INDEPENDENT → particle fill-rate is NOT the differentiator |
| `newMarineClears / newParticleReinits` | 0 / 0 | 0 / 0 | scrub-hold guards intact; engine stable |

**Verdict:**
- **§7c (`useSyncExternalStore`) — RETIRED.** Only 5–7 MapWebGL renders in 6 s ⇒ the reconcile it targets is not
  the cost. Removing it from consideration retires the single riskiest board item (no kill switch, 371-hotspot).
- **No particle-cull needed** — global == close. The engine (87616 marine + 147456 wind particles) is fine.
- **The felt "zoom-out crawl" is transient transition churn, not a steady-state bottleneck.** Each grid
  bounds/dims change fires a 32 MB `4096x2048` land-mask rebuild (the 300–450 ms load-time RAF stalls). Those
  are LEGITIMATE coarse→regional progressive-sharpen commits (finer each step), recurring per new viewport / cold
  hour. The settle backstop already guards the pathological no-progress case (`useMarineScrubSettle.js:694-721`).
- **OFF-LIMITS (documented-regression minefields):** mask resolution tier (`WebGLMarineMaskRenderer.js:716` —
  4096 for <10° span fixes inlet land-bleed, 4096 for world fixes coastline-over-heatmap); the mask-retain block;
  the particle engine; the prewarm subsystem (503 history).
- **Caveat:** the bench measures PLAYBACK cadence (4 s), not manual DRAG. A residual manual-drag cost can't be
  fully excluded without a manual-drag frame-time trace — but every steady-state signal says the app is stable.

**∴ Jacobian: further scrub-perf = minefield surgery for a marginal gain on a stable 30-FPS app → do NOT grind
it.** Bank the wins (encoder LOC split shipped `42ae206f`; §7c retired). Prefer §8 higher-value / lower-risk work.

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
Cron detail (`70ac67ce`): `15 */4` core + `45 1-21/4` pilots (SAME shared serial group — must never overlap;
serialization is intentional, protects manifest writes) + backend `IntervalTrigger(hours=4)` — but the in-process
path is DISABLED on Render (`DISABLE_FORECAST_SCHEDULER=1`, serve-only), so PROD ingests via the Action = the cron
IS the prod cadence. If cancellations relapse, the durable fix is merge core+pilots into ONE sequential workflow
(removes pending-eviction between them) — do NOT split the shared concurrency group.

---

## 7. SCRUB-PERF / §7c — FULL FORENSIC MAP + an HONEST "should you do this?"  ⚠️ READ 7.0 FIRST

### 7.0 Decision gate — DO NOT default into this
§7c is the durable fix for "timeline scrub feels slow" (the confirmed ~62 ms/step react-map-gl reconcile). But
weigh it honestly before spending a session on it:
- **Reward is MARGINAL.** The user described it as "a little faster." Scrub is **already responsive when warm** —
  the felt sluggishness in the 07-09 session was mostly **cold cache after 5 model-switches** (see 7.5), not the
  per-tick React cost.
- **Risk is MEDIUM** (revised down from "maximal" by the 3rd-pass best-practice finding — see 7.4): with the
  `useSyncExternalStore` pattern it is NOT a whole-`useWeatherState` restructure, just a surgical external store +
  a marine-subtree extraction on the **371-commit MapWebGL hotspot** — still **NO runtime kill switch** (git-revert
  only) and still hotspot surgery needing live verification, but materially safer than the original context-split.
- **Verifiability is PARTIAL.** Correctness across 5 entangled data pipelines can't be fully confirmed by tests +
  "feels fine" — it needs a live React DevTools Profiler + you exercising forecast/playback/switch/marine.
- ∴ **Jacobian = marginal value ÷ MEDIUM coupling (revised) = still-low-priority.** The `useSyncExternalStore`
  rewrite lowers the risk, but the reward is still marginal (7.5 cache-retention likely beats it for the FELT
  problem). Execute §7c only if timeline-scrub slowness becomes a real, repeated complaint AND you have a watched
  full-budget session — and if so, use the store pattern (7.4), not the context-split.
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

### 7.4 Target architecture — ⭐ REVISED to industry best practice (3rd pass, 07-09)
**Use `useSyncExternalStore`, NOT a context-split.** Web research (React docs + practitioners — see Sources at
close) is unambiguous: for HIGH-FREQUENCY state a large tree consumes but shouldn't re-render on — a **timeline
scrubber is the textbook example** — Context, *even split into multiple providers*, is a "propagation penalty" you
cannot memoize away; the standard pattern is an **external store subscribed via `useSyncExternalStore` with
selectors**, so ONLY components reading the changed slice re-render. This is LOWER-risk than the context-lift (no
`WeatherProvider`/MapPage restructure, no context-value-identity pitfall) → drops §7c coupling MAXIMAL→MEDIUM.
Goal unchanged: MapWebGL's body re-renders only on the DEBOUNCED cadence; only a small marine subtree per tick.
1. **`scrubTimeStore`** (module-level, NO provider): `{ getRaw(), getDebounced(), setHour(h), subscribe(cb),
   subscribeDebounced(cb) }` — the debounce lives IN the store (relocated from `useOpenMeteoTileUrls`). The scrubber
   (`MapWeatherControls`) + `useWeatherState`'s playback interval WRITE via `setHour` (functional → no read → no
   re-render). Expose `useScrubHour()` / `useDebouncedScrubHour()` wrapping `useSyncExternalStore`.
2. **MapPage stops owning + prop-passing `timeOffsetHours`** (the store owns it) → MapPage no longer re-renders per
   tick. `useOpenMeteoForecast` (infobox) + `MapForecastOverlay` + both `MapWeatherControls` read `useScrubHour()`;
   the clamp / `isLockedForecast` derive from a `useDebouncedScrubHour()` selector or move store-side. **Verify
   behavior-identical FIRST** (forecast, playback, model/layer switch, premium lock, radar, marine unchanged).
3. **MapWebGL body subscribes to `useDebouncedScrubHour()` ONLY** (→ re-renders on settle, not per tick); the RAW
   hour is consumed ONLY inside an extracted **`<MarineHeatmapSubtree>`** (`useMarineOrchestrator`+`useMarineWindData`
   +`<WebGLMarineLayer>`, `useScrubHour()`) that publishes `marineData` up debounced for the settle-tolerant
   consumers (preloader/omTiles/ratings/FCE/`useMapDebugTools`/`onMarineDataChange`/`TruthOverlay`).
4. **A/B with `__SCRUB_PROBE__`**: renders/step → ~0 on unchanged-data steps; median < 16 ms; `clears`/`reinits`=0;
   `__MASK_PROBE__` no re-flood; infobox/forecast still track (verify no stale-hour mislabel). Rollback = git-revert.

### 7.4a Guardrails the refactor MUST preserve (3-mo archaeology)
engine residency `9c89701e`/`15302d35`; synchronous scrub upload `6f173bc0`/`a9c30178`; the **vector mirror**
(`useMarineWindData` conform — the LAST place field lists eat `is_valid`/`dirConfidence`); FCE-decoupled-in-normal-
mode `40d28b9d`; the `task_c5366c79` memo slices `b720752c`/`2cb4e709`/`19b2ec79`; the **TWO complementary
marine scrub-holds** — commit-layer `useMarineDataFetcherHelpers.js:472` (holds stale/degenerate `timeline_scrub`
commits) + upload-layer `b1f19453` (holds coarse-over-regional at the GPU); they catch DIFFERENT cases, don't
remove either as "redundant". Verify `__WEBGL_MARINE_CLEAR_COUNT__` / particle-reinits = 0 throughout.

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
Root (TRACED, not fully confirmed): `createFallbackSafeZeroGrid` DOES tag `__failureReason` at both grid + top
level, and `runScrubSettleCheck` HAS a coverage-terminal bypass — yet the log shows it re-driving, so either the
"conformed safe zero grid" step strips the tag before it reaches `marineData`, OR the blank-heatmap **backstop**
(a separate path that re-drives on `engine-empty` without checking `__failureReason`) is the churn source. Fix =
confirm which, then make the backstop respect a terminal-no-coverage signal (kill-switched), + extend
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

## Sources (3rd-pass best-practice research — the §7.4 revision)
React's standard for high-frequency state (a scrubber is the textbook case) is an external store via
`useSyncExternalStore` + selectors, NOT context-splitting (which is "propagation-penalty" tech-debt at high state
velocity):
- [useSyncExternalStore — React docs](https://react.dev/reference/react/useSyncExternalStore)
- [Bypassing React Context re-renders via useSyncExternalStore (azguards)](https://azguards.com/performance-optimization/the-propagation-penalty-bypassing-react-context-re-renders-via-usesyncexternalstore/)
- [Isolating React component updates with useSyncExternalStore (Phil Parsons)](https://philparsons.co.uk/blog/isolating-react-component-updates-with-usesyncexternalstore/)
- [useSyncExternalStore demystified — Epic React / Kent C. Dodds](https://www.epicreact.dev/use-sync-external-store-demystified-for-practical-react-development-w5ac0)

**Session status: CLOSED (see `git log` for dev HEAD).** Strong stable checkpoint. Radar closed; marine
scrub-clears + pipeline cadence shipped; §7c fully mapped, best-practice-corrected (7.4 = `useSyncExternalStore`,
risk MAXIMAL→MEDIUM), and DELIBERATELY deferred (marginal reward — see §7.0). Next session: evaluate 7.5 (cache
retention) for responsiveness FIRST, or pick a §8 higher-value item — NOT a default §7c.
