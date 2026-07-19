# HANDOFF 2026-07-19 (late) — queue #5 + #9 shipped; viewport-fine tier back ON by default

Continues `HANDOFF-2026-07-20-wind-close-marine-lessons-and-forward-plan.md` (§3 order:
#5 → #9 → re-enable tier → vortex levers). Baseline at start: `3e886348` (+docs `6c99356e`).

## 1. Queue #5 — native-upstream background recovery for the wind dynamic lane (`1bf55931`)

`backend/services/weather_pipeline/wind_native_recovery.py`. On a wind dynamic-lane failure
(exception ladder AND negative-cache hit in `viewport_service.py`), the request still serves its
instant stale/coarse fallback, and ONE background task fetches the SAME snapped bbox from the
model's native upstream — the proven bbox-parameterized cron fetchers (GFS→NOAA byte-range GRIB2,
ICON→DWD icosahedral, EURO→ECMWF Open Data) — then persists through the STANDARD pipeline
(`normalize_and_persist_layers` + `bg_process_remaining_hours_helper`), so provider labels, ICON
14d loop-extension stamping and dynamic-index registration are byte-identical. Next client
refetch upgrades from cache.

- Guards (all enumerated in `backend/tests/test_wind_native_viewport_fallback.py`, 8/8 ×3):
  kill `WIND_NATIVE_VIEWPORT_FALLBACK=0` · wind-only · **viewport-scope only** (never build a
  world-span dynamic product — §1.3 span-containment trap) · mapped models only · per-{model,bbox}
  dedup + 600 s cooldown · GLOBAL semaphore 1 (subprocess decodes full-globe GRIB regardless of
  bbox — 512 MB box).
- Env: `WIND_NATIVE_RECOVERY_CONCURRENCY/COOLDOWN_SEC/TIMEOUT_SEC/FORECAST_DAYS`
  (days default GFS 16 / ICON 5+extend / EURO 5-trimmed).
- Serve-path diagnostics: `native_recovery: spawned|none` in fallback grid diagnostics.
- `timeout_sec` pass-through added to the three thin wind service wrappers.
- **Hardening found by test forensics:** `run_fetcher_subprocess` now passes `stdin=DEVNULL`
  (inheriting a redirected stdin fails CreateProcess WinError 50 — pytest capture, daemons).
- **Test-isolation root:** `ProductStore._product_cache` is CLASS-level, filename-keyed — two
  tests persisting the same {model,hour,bbox} cross-serve in-memory products. Clear it per test.
- Evidence: gate 8/8 ×3 · wind+viewport+fetch_common net 98/98 ×3 · weather-pipeline sweep
  117/117. Real-subprocess boundary round-trip proven (stand-in fetcher script through the real
  plumbing); pygrib decode itself is Linux-only (verify on Render/runner after deploy: look for
  `[Wind Native Recovery] Spawned/COMPLETE` in logs when the fine lane rate-limits).

## 2. Queue #9 — BASE+OVERLAY two-texture wind engine (`639d5fce`)

Marine's BLEND-BOTH pattern ported to wind. `_windData` stays the **base** (all probes keep
working); `_windFine` is a resident viewport-fine grid rendered on top.

- **Filing** (`WebGLWindEngine.setWindData`, returns `'base'|'fine'`): a REGIONAL grid arriving
  while a GLOBAL base of the same model+hour is resident files as the overlay — base untouched.
  Anything else takes the legacy replace path; a replaced base drops an incompatible overlay.
  Compatibility = same model (source-first — must agree with the choke) + same hourOffset +
  valid_times within 90 min (the 3-hourly snap). Pure predicates exported for tests.
- **Heatmap**: base pass gains a complementary CUTOUT (fades out exactly where the overlay's
  feather fades in — no compounding-alpha rectangle; skipped for antimeridian-crossing fine
  boxes), then an overlay pass (same program/mesh, fine bounds/texture/decode/feather).
- **ADVECT_FS / DRAW_VS**: mirrored fine-overlay lookup — feather-BLENDED `mix(base, fine, w)`
  so velocity/colour are continuous at the seam; outside the box particles read the base (no
  data edge to fall off — clamp geometrically impossible). ADVECT stays theme-free.
- **Choke** (`WeatherEngine.commitWindData`): guarded pass-through — a non-covering grid of the
  same model+hour as a WORLD-SPAN covering grid commits through (engine files it as overlay).
  All four predicates source-pinned in the gate. Different hour/model still blocks (truth).
- Layer: overlay filings skip particle reseeds; empty-data path routes through
  `engine.clearWindData` (frees BOTH textures); dispose covers `_windFine`.
- Kill: `__RAW_DISABLE_WIND_BASE_OVERLAY__` (live-verified instant + reversible).
  Telemetry: `window.__WIND_FINE_OVERLAY__` (`active/bounds/cols/rows`).
- **Engages only when a regional grid commits over a resident global base** — always-global
  traffic is byte-identical by construction.
- Evidence: `windTwoTexture.test.js` 16/16 · full suite 1273/1273 ×3 · LIVE wire-proof on :3009
  (global 37×17 base → Gulf z6.5 fine 25×29 filed as overlay → pan to Atlantic: base stayed,
  NEW fine box swapped on top, coverage never dropped) · zoomclamp ladder 72/72 tier-OFF
  (grid 37×17 global every step, 0 blank, 0 clamp).

## 3. Viewport-fine tier default ON (this commit)

`backendWeatherServiceClientCoverage.js`: `__RAW_WIND_VIEWPORT_FINE__ !== false` (default ON;
`= false` opts out; `__RAW_DISABLE_WIND_VIEWPORT_FINE__` still hard-disables). The regression
shield test now pins the NEW contract (fine id by default, opt-out restores global bit-exactly).
Evidence: suite 1274/1274 ×3 · tier-ON zoomclamp ladder (see summary.json / session log).

## 4. Probe updates

`probe_wind_vortex_dump.js` prefers `_windFine` (the vortex-resolving grid) and records
`fromFineOverlay` + the holder's own uMin/uMax.

## 5. Next in queue

1. **#2 vortex levers**: dump a real fine grid (`probe_wind_vortex_dump.js` → analyze), then
   R-gated gamma restore + R-gated persistence, calibrated on the analyzer's numbers.
   z5.5-8 live, 3 runs, both devices, three themes.
2. **#8 probe hardening** (blank-leg flake after ~30 GL contexts) — also: ladder runs contend
   badly with concurrent jest/dev-server load on this box (mobile legs took 80 min under load,
   ~15 min clean) — run ladders alone.
3. Light-wind chroma lever (composite-space gate FIRST — see 07-20 handoff §2).
4. Marine debt bank (07-20 handoff §1) — ARBITER Phase C first.
5. Deploy-side verification of #5 once dev merges: watch for `[Wind Native Recovery]` logs.
