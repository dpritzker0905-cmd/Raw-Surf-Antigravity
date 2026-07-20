# HANDOFF 2026-07-20 (day) — AUDIT of the global-overlay arc · queue · debt · path forward

Audit of the `ee9e3b09` → `dbd142dc` session (12 commits, 22 files, +1261/−128, **0 unpushed**).
Every claim below re-verified against live evidence at audit time, not recalled. Companion
narrative: `HANDOFF-2026-07-20-NIGHT-global-overlay-arc-and-livelock-roots.md` (the why) +
memory topic `wind-global-overlay-architecture-2026-07-20` (the lessons).

## 1. AUDIT VERDICT — claim vs evidence

| Shipped claim | Evidence at audit time | Verdict |
|---|---|---|
| Global 2° wind base serves worldwide | world-span /grid → `global_mid`, 15,023 vectors | ✅ LIVE |
| Wide spans serve covering mid instantly | 40×30° probe → mid 23 cols, fresh | ✅ LIVE |
| Close zoom SWR-sharpens to fine | live sequence: mid `swr_revalidation_pending` → 25 s → `viewport_…` 23×17 (0.5°), fresh | ✅ LIVE |
| Hairline square eliminated (single-pass composite) | A/B: default no line · kill switch restores the step; suite pin `windTwoTexture` | ✅ (localhost) |
| Calm-band visibility v3.22, 3 themes | suite value-pins + GLSL-interpreter forensics + Gulf-distribution deltas | ✅ (localhost) |
| Livelock / stranded-dedup / guards fixed | code + tests; the abort storms ended on the live tab post-fix | ✅ (localhost) |
| Vortex window real-invest calibrated | fixture `wind-vortex-out/fl_low_grid.json` committed; both shader sites + mirrors at 0.5/1.2 | ✅ |
| Tests | frontend **1296/1296** · backend **801 passed** · mid-tier 24/24 · probes: zoomburst 0/0/0, 3-theme PASS | ✅ |
| 13 kill/tune levers | `git grep` sweep — all 13 present in source | ✅ |

## 2. AUDIT FINDINGS (new, load-bearing)

**F1 — CI ingest budget is nearly exhausted: 156 of 165 min.** The successful seed run
(29718695874) consumed 156 min **before** the ICON/EURO wind mids existed (it ran at
`b56bece8`). The next core cycle adds two more full-globe native GRIB jobs; a timeout run
"uploads early hours but never prunes" (the documented superseded-product debt). **Do first**
— options, cheapest adequate first: (a) move the three wind-mid jobs to the pilots workflow
(`INGEST_PILOTS=only`, its own budget, same pattern as the marine pilots split); (b) trim
`GFS_WIND_MID_RES_FORECAST_DAYS` 14→10; (c) raise the workflow timeout. Watch the very next
scheduled run's duration either way.

**F2 — the PRODUCTION frontend is ≥2 days stale.** `dev--rawsurf.netlify.app` serves
`main.9b725b49.js`, which lacks not only this session's client work but even 07-19's fine tier
(`wind_viewport_fine_` absent). Netlify has not built dev since before 07-19 — plausibly the
still-pending `MAPBOX_PUBLIC_TOKEN` secret (07-18 EVE handoff flagged it; needs the dashboard).
Consequence: every "✅ (localhost)" row above is NOT yet in production users' hands; they run
old-client + new-backend (graceful — they do get the 2° world base — but keep the old palette,
the two-pass seam, and the livelock). **USER ACTION: fix the Netlify build/secret, then spot-
check the deployed bundle for `__RAW_DISABLE_WIND_HEATMAP_SINGLEPASS__`.**

## 3. JACOBIAN COUPLINGS THIS SESSION INTRODUCED (watch these when touching neighbors)

- `mid_res_tier` now serves TWO domains: wind shares marine's clip LRU, load semaphore,
  `MARINE_MID_CLIP_PAD_DEG`, `MARINE_REVAL_QUEUE_MAX` and `MARINE_MID_CLIP_CACHE_MAX` knobs
  (only the span band + reval cap are wind-scoped). More wind traffic → more pressure on the
  shared cache; a clip-cache HIT returns the stored `stale=True` copy without re-scheduling a
  reval (acceptable: the first serve's reval upgrades the product) — do not "fix" that flag
  without reading the SWR flow.
- `decide_manifest_product`: wind cut = `WIND_DYNAMIC_MAX_SPAN_DEG` (100), marine stays 15.0 —
  pinned by `test_wind_dynamic_wide_band.py::test_marine_gate_unchanged_at_15`. Cross-kill
  independence pinned in `test_wind_mid_res_tier.py`.
- The wind fine lane now runs ALMOST ONLY via SWR revals — open-meteo pressure dropped, but it
  also means `wind_native_recovery` rarely triggers; its Render-side health is still unverified
  (`native_recovery: "none"` on every observation this session — cooldown vs env unknown).
- forecast.py core job list grew by three (budget → F1).
- WIND SERIES lane payloads post-mid are UNMEASURED (a series page of clipped-mid hours should
  be small, but nobody looked). Cheap check: one `/weather/grid_series` wind call, log sizes.

## 4. THE QUEUE (from 07-19 §6, reconciled after this session)

CLOSED this session: #1 slow-wind visibility · #2 drift · #3 global mid (all models + serving
+ SWR) · #4 vortex real-invest window · plus unqueued closures (hairline seam, livelock,
stranded dedup, no-op guard, zoom-out fast lane, wide band).

REMAINING, in recommended order:
1. **F1 CI budget** (above — cheap, prevents silent product rot).
2. **F2 Netlify deploy** (user action + bundle spot-check; everything client-side ships with it).
3. **Native-recovery deploy watch** (07-19 queue #6): grep Render logs for
   `[Wind Native Recovery]`; if the env kill is set or the spawn never fires, the rate-limit
   safety net is dead code in prod. One evening with the dashboard.
4. **EURO/ICON mid verification** on their next cron cycles (jobs shipped, native-only —
   expect model-switch resolution drops until their products exist; that is by design).
5. **React Scan interactive pass** on a visible tab post-deploy (the no-op guard should have
   killed the FPS-drop class; verify, then consider `MapWeatherControls` memo if 160 ms
   renders persist).
6. **Marine debt bank** (07-20 §1 — untouched this session): ARBITER stateful harness first,
   then mapper flag audit, span-aware containment, refs-not-locals sweep, SUM thresholds.
7. **Vortex window second sample**: re-run `probe_wind_vortex_dump/analyze` on the next
   distinct real system; one invest calibrated 0.5/1.2 — two would make it a contract.
8. Cosmetic: the `attempt N/5` retry counter can exceed its max label (display only).

## 5. STANDING DEBT (pre-existing, unchanged this session)

- **Security**: public storage buckets (chat_media/crew_chat world-readable — P1, user wants
  this) · user-id BOLA (221/930 routes; plan in the 07-12 architecture review — deliberate).
- **Accessibility mandate**: map surfaces still short of the ARIA bar (07-14 audit).
- EURO wind >240 h, ICON >5 d: estimated-tail behavior unchanged.
- The 10° `global_coarse` products stay (mid's own fallback + >400° requests) — do not retire.

## 6. PATH FORWARD, one paragraph

Fix the CI budget split and the Netlify secret first — they are the only two things between
"everything works on the dev box" and "everything works for users." Then spend one evening on
the native-recovery log check and the React Scan pass (both are verification, not construction).
After that the wind arc is genuinely done and the pendulum swings back to the marine debt bank
(ARBITER first) — with the same discipline that won this session: forensics before fixes, the
invariant in the one function all paths call, a kill switch and a gate per lever, and probes
run alone.
