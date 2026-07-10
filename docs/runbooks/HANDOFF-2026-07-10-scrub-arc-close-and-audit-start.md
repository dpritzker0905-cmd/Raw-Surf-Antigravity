# HANDOFF — 2026-07-10: scrub-responsiveness arc CLOSED (7 ships, all verified) → Master Audit is the active workstream

**For a fresh context.** Read order: (1) memory index (auto-loaded), (2) memory topic
`marine-scrub-perf-and-encoder-split-2026-07-09.md` §A–H (the arc's full forensics + every kill switch),
(3) `docs/runbooks/WEATHER-SIM-MASTER-AUDIT-2026-07-10.md` (the 14-phase mandate, Phases 1–3 seeded),
(4) this doc for current state. dev == origin/dev at `073d8aa4` + this handoff; FE 88 suites / 745 green;
prod = `main`, untouched. User verifies on `dev--rawsurf.netlify.app` — **check SW `BUILD_VERSION` == HEAD
first, and NEVER judge feel during a Render deploy (every push restarts it) or the ~1-1.5h ingest window.**

## 1. SHIPPED THIS ARC (all pushed, all live-verified)
| Commit | Fix | Kill switch | Live verification |
|---|---|---|---|
| `42ae206f` | Encoder split 1090→632 LOC (LOC gate) | — (pure extraction) | 745 green |
| `5fcf8276` | §7c React-store refactor RETIRED by 3 live benches | — | benches: 30 FPS all zooms |
| `6a0055be` | EURO marine `grid_series` 40s→empty → fast L2 loop | `EURO_SERIES_LIVE_COPERNICUS=1` | 40s→2-6.5s, 4.6MB real |
| `d38a693b` | Far-horizon settle churn → terminal-no-coverage tracker | `__RAW_DISABLE_TERMINAL_NOCOV_BYPASS__` | tracker counts |
| `cb074b8b` | **Drag commits decimated ~11Hz** (THE universal drag-jank root) + per-commit logs quieted | `__RAW_SCRUB_COMMIT_THROTTLE_MS__` (0=off, tunable live); logs `__MARINE_VERBOSE__=true` | user: "improving" |
| `21c1bf3a` | Wind settle consults warmed series (was per-hour fetch storm) | `__WIND_SERIES__=false` | `__WIND_SERIES_SETTLE_HIT__` |
| `b0655047` | Wind far-horizon fail-fast — **unmasked a working GFS fallback**: EURO wind >240h now serves labeled `provider:gfs_fallback` DATA (was naked 500 = "wind clears at 14d") | `WIND_HORIZON_GATE=0`; ICON EXEMPT (its `extend_icon_wind_to_14d` works) | 500 → 200 gfs_fallback, curled |
| Render env | `GFS_ICON_SERIES_FASTPATH=1` (user-authorized, **NOT in git** — revert=delete var in Render dashboard, srv-d7fhiu7lk1mc73debje0) | the var itself | cold-bbox regional frames 1.3-2.1s |

## 2. WHAT THE FINAL USER LOG (07-10, post-`073d8aa4` bundle) CONFIRMS WORKING
- Marine: `No-downgrade: kept resident regional 11×7; rejected coarser 5×5 — skips particle reset` ✅ ·
  `Series hit for hour=38 — committing warmed frame (no fetch)` ✅ · `Instant re-index` on GFS+ICON+EURO ✅.
- Wind: within-model scrub mostly cache-hits; far-horizon serves gfs_fallback data ✅.
- User verdict: "seems to be improving, keep testing." EURO marine = the reference feel.

## 3. OPEN QUEUE (ranked; audit doc has recipes)
1. ~~**Wind series cold on MODEL-SWITCH & click-jumps** (§H tail)~~ **FIXED `9494d8c2` (07-10 next
   session)**: ref-guarded model-switch/first-landing prewarm in WeatherEngine.js (mirror of marine's
   at useMarineOrchestrator.js:726); rapid re-switch aborts the previous warm. Kill
   `__RAW_WIND_MODEL_PREWARM_DISABLED__`; tel `__WIND_MODEL_PREWARM_COUNT__`. Live-verified preview
   3007: first-landing + switch warm fire, hour ticks don't, click-jump settle = series hit (no fetch).
2. **300-vector wind grids** — now seen on ALL models (EURO+296h, ICON, GFS+28h; usually 629). Possibly a
   legit clamped viewport product; triage BEFORE assuming bug (`WIND-TELEMETRY` bounds + product ids).
3. **Estimate ingest-window gap** (§D1b): estimates ABSENT ~1-1.5h per 4h cycle → far-horizon 404s users
   can hit. Fix = atomic write-new-then-delete-old in ingest. ⚠️ Ingest minefield — read-only first.
4. **OM raster-tile pipeline audit** (pressure/fog/rain/satellite — pipeline 3): preloader window, .om
   decode cost, slot thrash. Un-audited; it's already CDN-architecture so likely tuning not surgery.
5. **capabilities EURO-wind native:336 is FALSE** (ECMWF=240h) — contract doc fix + decide whether the
   gfs_fallback labeling is the desired product story for 240-336h.
6. Model-switch cache wipe retention (§7.5) · transient FPS 15-17 dips at cold load (mask 4096² rebuilds
   — known, minefield) · Master Audit Phases 4–12.

## 4. LANDMINES (binding)
Mask-res/retain + prewarm + engine internals + marineControllerUtils density = documented-regression
minefields, OFF-LIMITS without a dedicated watched session. `viewport_service.py` at 784/800 LOC.
eslint-9 crashes on some files (`unused-imports` plugin) = environmental; tests are the gate. Per-commit
marine logs are QUIET — flip `__MARINE_VERBOSE__=true` before reading scrub logs, or you'll see nothing.
PostHog rrweb records console+network on dev — heavy logging = jank; keep new logs gated.

## 5. LIVE TELEMETRY CHEAT SHEET
`__MARINE_VERBOSE__=true` (commit trace) · `__MARINE_CACHE_DIAG__.counts` (miss classes) ·
`__SCRUB_PROBE__.bench('forecast',{durationMs:6000})` (renders/frameMs) · `__WIND_SERIES_SETTLE_HIT__` ·
`__MARINE_TERMINAL_NOCOV_RECORDED__/_BYPASS_COUNT__` · `__RAW_GPU__` (texture count/mem) ·
`__RAW_SCRUB_COMMIT_THROTTLE_MS__=150` (live-tune drag decimation, no deploy).

**Session status: CLOSED.** Scrub arc done and verified; Master Audit (14 phases) is the active mandate —
next session starts at §3 queue item 1 or Audit Phase 4, per the user's test feedback.
