# Antigravity Handoff — FULL CODE + COMMIT AUDIT (audit ONLY, no work)

**For:** Antigravity agent
**From:** Claude Opus 4.8
**Date:** 2026-06-23
**Repo:** `C:\Users\dprit\Raw-Surf` · **Branch:** `dev` · **Current HEAD:** `42c61128`
**Frontend:** CRA/craco React in `frontend/`. Marine/weather code: `frontend/src/components/map/`. Backend: FastAPI in `backend/` (Render, **1-CPU**, auto-deploys from `dev`). Frontend auto-deploys to `https://dev--rawsurf.netlify.app` from `dev`.

---

## 0. YOUR MANDATE — READ THIS FIRST (hard constraints)

1. **AUDIT ONLY. Do NOT change any code. Do NOT commit. Do NOT push. Do NOT run builds that write artifacts you commit.** Read-only investigation only.
2. **Produce ONE report file** named `ANTIGRAVITY_AUDIT_FINDINGS_2026-06-23.md` in the repo root (writing that single markdown report is the ONLY write you may do). Do not modify any `.js`, `.py`, `.html`, config, or test file.
3. **Hand the report back to Claude (me).** I will decide what to fix. You do not implement anything.
4. **No guessing.** Every claim must cite a file path + line number (or a commit hash). If you can't verify it, say "unverified" and explain what's missing. Read the actual code; do not infer behavior from names.
5. You MAY: read files, grep, read git history (`git log`, `git show`, `git blame`), run read-only tests to observe (but do not commit any change), and curl the public backend (`https://raw-surf-antigravity.onrender.com`) for read-only verification. You may NOT deploy, mutate state, or push.
6. If you believe something is urgent/broken, **write it in the report** — do not fix it.

---

## 1. What this system is (so the audit is grounded)

A surf-forecast web app. The audited subsystem is the **weather simulation / marine heatmap**: a WebGL heatmap (waves/swell_1/swell_2/wind_waves) + wind particle layer over a MapLibre/Mapbox basemap, driven by a backend grid API, with a timeline scrubber (0–336h), 3 models (GFS, ICON, EURO), and a time-series prefetch system for instant scrub.

Data flow (verify against code, don't trust this):
`prefetcher/scheduler.py → grid_resolver.py / viewport_service.py → /api/weather/grid + /api/weather/grid_series → frontend marineController*.js / backend*ServiceClient*.js → useMarineDataFetcher*.js / useMarineOrchestrator*.js (+ scrub cache) → marineTransitionCoordinator.js + useMarineWindData.js (render gate) → WebGLMarineLayer/CustomLayer/Engine + OceanMask.js → MapLibre`.

---

## 2. Current `dev` commit stack (what landed today, 2026-06-23) — AUDIT EACH

These are the live changes on top of `b05f7391`. **Audit every one for correctness, regressions, and side effects:**

| Commit | What it claims to do | Audit focus |
|---|---|---|
| `44409dbd` | Gate React Scan (`auto.global.js`) to localhost/`?reactscan=1` in `frontend/public/index.html` | Was the **root perf cause** (a render profiler shipped to prod froze the renderer; idle 3→31 FPS after removal). Verify the gate is correct, nothing else depends on `window.reactScan`, and PostHog/rrweb session recording (also in index.html) is the next-largest tax. |
| `ac2cf6a0` | Marine cache-hit re-display on in-place toggle-back (allow regional cache hit when `isContained && !isViewportZoomedOut`) in `useMarineOrchestrator.js` (~L437) | Verify it never serves a regional grid when zoomed out or panned-away; verify the `isContained`/`isViewportZoomedOut` math; confirm it doesn't mask a real fetch. |
| `94838c51` | Stop clamped regional heatmap flash on zoom-out after scrub — skip held-frame return for zoomed-out regional rejection in `useMarineWindData.js` (~L226) | Verify the held-frame logic; confirm no new blank/flash; confirm `isZoomedOutRegionalReject` is correct. |
| `c09c5131` | OceanMask recolor fast-path (setPaintProperty vs full rebuild) on marine layer switch in `OceanMask.js` (~L287, `lastSyncCoreRef`) | Verify `lastSyncCoreRef` invalidation on all teardown paths; verify no stale buffer color; verify styledata feedback is suppressed by `syncingRef`. |
| `2795b763` | Stop retrying terminal no-coverage grids (SWR exclusion of any `coverage`/`unsupported` reason) in `useMarineRevalidation.js` + `marineController.js` | Verify cold-ingestion transient empties STILL retry; verify the `__failureReason` plumbing. |
| `42c61128` | **Revert** of `0c0f9f58` (a scrub-settle series-commit that regressed: committed coarse 9×9 series frames on settle → blocky/"clamp" when zoomed in). | Confirm the revert is clean and the tree matches `94838c51` for `useMarineOrchestrator.js`. |

Also confirm these earlier same-day **reverts** are intentional and left no half-state: `105c9161`, `65ab8c55`, `32f38c49`, `9620e0d5` (reverted `e89017bb` wind-retry, `49104bc5` coordinator-viewport-parity, `96a69065` EURO-no-coverage, `4bbe81c3` backend-shield). The **backend shield (`4bbe81c3`) was a genuine production incident** (it accumulated background Copernicus fetches and saturated the 1-CPU box) — verify the revert fully removed it from `backend/services/weather_pipeline/grid_series_helper.py`.

---

## 3. KNOWN-OPEN issues to investigate and characterize (do NOT fix — diagnose + report)

1. **Zoomed-out timeline scrub snappiness is poor.** Console shows per-hour `/grid?bbox=-180,-80,180,85` (full-global) requests that **CORS-fail / 504 / net::ERR_FAILED** for ICON under load, while `grid_series` with a **clipped** viewport bbox succeeds. The scrub-settle safety net (`useMarineOrchestrator.js` `checkScrubSettle`, ~L567) re-fires the doomed fetch forever because `renderedHour` never settles. **Audit:** (a) why the per-hour marine fetch resolves to full-global `-180,-80,180,85` (see `backendWeatherServiceClientCoverage.js` `clampViewportBbox`, ~L217) when the series uses a clipped bbox; (b) whether the backend can serve full-global ICON marine at all under load (`grid_resolver.py` / `viewport_service.py`); (c) the series-warming triggers (`marineGridSeries.js`, `useMarineOrchestrator.js:~616` `ensureMarineSeries`/`prewarmMarineSeries`) — does the series reliably warm for a zoomed-out viewport, and does viewport pan+zoom during scrub defeat its viewport-keying? **A naive fix (committing the series frame on settle) was just reverted because it downgrades the sharp regional view to coarse — explain the correct design constraint.**

2. **Far-hour rapid model+layer toggle abort-storm.** At a far hour (e.g. h192) rapid GFS↔ICON↔EURO + waves↔swell toggling leaves a **stuck same-target in-flight marker** (`[Abort-Gate] Same-target fetch already in-flight (ICON/waves/h192); skipping duplicate` repeating), plus `ICON extended estimate fetch aborted`, 504 `target_dt not covered`, and `[Safe Cache] Mismatch! Wanted ICON/waves, got GFS/waves`. Heatmap stays blank (`render returned early! _waveData:false`). **Audit:** the in-flight registry + abort-gate (`marineInFlightRegistry.js`, `useMarineDataFetcher*.js`, the abort/detach logic) — find how an aborted far-hour fetch can leave a permanent in-flight marker that blocks all subsequent re-fetches. Characterize the exact stuck-state; do not fix.

3. **ICON 14-day (>168h) extended blend reliability.** `fetchBackendMarineGridIconExtended` (`backendWeatherServiceClientHelpers.js`) fans out sub-fetches on the same signal; rapid switching aborts them → safe-zero. EURO has no coverage outside its region (`no_copernicus_coverage` 404s). **Audit:** the far-hour fetch reliability paths and whether they leave stuck state.

4. **Engine re-init churn.** Console occasionally shows `Initialized engine with 36864 wave crests` (192²) ≠ the startup `87616`/`147456` — a dispose+reinit (likely canvas-resize-driven). R7 was supposed to keep engines resident. **Audit:** `WebGLMarineCustomLayer.js` / `WebGLMarineEngineInit.js` / `MapWebGL.js` — when does the resident engine actually re-init, and is it per-interaction?

5. **OceanMask churn on marine↔wind toggle.** Each toggle still does `Deactivating: removing layers` + re-add `syncLayers` (350ms-debounced). FPS holds 30 post-React-Scan but it's wasteful. **Audit:** whether a hide-vs-remove (`visibility:none`) approach is safe (don't recommend implementing — just assess feasibility/risk).

6. **Dev-build overhead still shipping:** PostHog session recording + rrweb console/network capture (`frontend/public/index.html` ~L172) record on every deployed page. **Audit:** quantify/scope its main-thread cost and whether it should be gated like React Scan was.

---

## 4. Code-quality / correctness audit (general)

- **Weather-truth invariant:** the heatmap/infobox must NEVER display data whose model/layer/hour/viewport doesn't match the UI. Audit the commit path (`useMarineDataFetcherHelpers.js` `commitMarineData`, the `requestId`/live-target guards, `marineTransitionCoordinator.js`, the `useMarineWindData.js` render gate) for any path that can relabel/serve mismatched data. Report violations with file:line.
- **Cache key consistency:** `getModelSafeMarine` / `_perModelHourCache` keys vs how grids are stored — the `exact_key_absent` vs `hit_fallback` mismatch (telemetry `window.__MARINE_CACHE_DIAG__`) suggests a key-derivation inconsistency. Characterize it precisely.
- **800-LOC pre-commit gate:** some files hover near 800 lines. Report any file > ~750 LOC in `frontend/src/components/map/` that's a refactor risk.
- **Dead/duplicated code, stale flags, leftover diagnostics** in the marine path.
- **Backend:** `grid_resolver.py`, `viewport_service.py`, `grid_series_helper.py`, `copernicus_marine_service.py`, `scheduler.py` — global-coarse product generation per model, the global-vs-regional/dynamic decision, and any path that hangs/500s under load on the 1-CPU box.

## 5. Commit audit (history hygiene)

- Walk the last ~40 commits on `dev` (since ~`b05f7391`). Flag: commits that were later reverted (confirm clean), commits that touched the "DO-NOT-TOUCH" fetch/abort/transition machinery, and any commit whose claimed effect doesn't match its diff.
- Cross-reference the existing handoff docs in the repo root (`GEMINI_HANDOFF_marine_perf.md`, `CODEX_HANDOFF_marine_abort_storm.md`, `CODEX_HANDOFF_marine_audit_v2.md`, `ANTIGRAVITY_HANDOFF_*`, `WEATHER_SIMULATION_SYNC_AUDIT_*`) — note which recommendations were done, partially done, or never done.

---

## 6. Verification context you can rely on (don't re-derive)

- React Scan in `index.html` was the dominant perf problem; removed in `44409dbd` (idle FPS 3→31, renderer un-froze). Confirmed live via `requestAnimationFrame` measurement.
- Backend is **1 CPU on Render**; full-global ICON marine `/grid` and EURO `grid_series` can hang/504/CORS-fail under request-storm load (saturation), but resolve in ~0.3s when idle. Confirmed via curl.
- EURO/Copernicus has **no coverage outside its region** → `no_copernicus_coverage` 404 is expected when panned away.
- ICON global marine products cover ~6 days (native) only; no global *estimated* extension past native (regional path does 14 days).
- Browser diagnostics available: `window.__MARINE_CACHE_DIAG__`, `__MARINE_INFLIGHT__`, `__MARINE_SERIES_DIAG__`, `__MARINE_TRANSITION_STATE__`, `__MARINE_CHURN__`, and the on-screen Diagnostics HUD + floating FPS chip.

---

## 7. Deliverable (the ONLY thing you produce)

Write `ANTIGRAVITY_AUDIT_FINDINGS_2026-06-23.md` containing:
1. **Per-commit verdict** for the §2 stack (correct / risky / regression-candidate, with file:line evidence).
2. **Root-cause writeups** for each §3 open issue (mechanism + exact file:line, ranked by user impact). For the zoomed-out scrub and the abort-storm, give the precise stuck-state and the *design constraints* a correct fix must satisfy (e.g. "never replace a sharp regional grid with a coarse global frame").
3. **Code-quality findings** (§4) with file:line.
4. **Commit-history hygiene findings** (§5).
5. A **prioritized fix backlog** (recommendations only — Claude implements). Mark each as low/med/high risk and note which touch the DO-NOT-TOUCH zone.
6. An explicit **"NOT IN SCOPE / unverified"** section for anything you couldn't confirm.

Then STOP. Do not implement anything. Hand the report back to Claude.
