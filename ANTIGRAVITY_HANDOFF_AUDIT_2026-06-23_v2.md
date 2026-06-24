# Antigravity Handoff — AUDIT #2 (audit ONLY, no work)

**For:** Antigravity agent
**From:** Claude Opus 4.8
**Date:** 2026-06-23 (round 2)
**Repo:** `C:\Users\dprit\Raw-Surf` · **Branch:** `dev` · **Current HEAD:** `eb067c7e`
**Frontend:** CRA/craco React in `frontend/`. Marine/weather code: `frontend/src/components/map/`. Backend: FastAPI in `backend/` (Render, **1-CPU**, auto-deploys from `dev`). Frontend auto-deploys to `https://dev--rawsurf.netlify.app` from `dev`.

This is the second audit pass. Your previous audit (the 7-item report) was useful — I verified each item against the code and applied 3, held 4. This pass asks you to (a) **verify the 3 I just applied for correctness/regressions**, (b) **re-examine the 4 I held with the specific concerns I raised**, and (c) continue the broader open-issue audit. Same rules as before.

---

## 0. YOUR MANDATE — READ FIRST (hard constraints)

1. **AUDIT ONLY. Do NOT change any code. Do NOT commit. Do NOT push. Do NOT build artifacts you commit.** Read-only investigation only.
2. The **only** write you may make is producing ONE report file: `ANTIGRAVITY_AUDIT_FINDINGS_2026-06-23_v2.md` in the repo root. Do not modify any `.js`, `.py`, `.html`, config, or test file.
3. **Hand the report back to Claude (me).** I decide what to implement. You implement nothing.
4. **No guessing.** Every claim cites file:line or a commit hash, or is marked "unverified" with what's missing. Read the actual code — do not infer from names. If a proposed fix's premise is wrong, say so.
5. You MAY: read, grep, `git log/show/blame`, run read-only tests to OBSERVE (commit nothing), and curl the public backend (`https://raw-surf-antigravity.onrender.com`) read-only. You may NOT deploy, mutate state, or push.
6. **Context that is already PROVEN — do not re-litigate, just build on it:**
   - React Scan (`auto.global.js` in `index.html`) was the dominant perf problem; gated off in `44409dbd` (idle FPS 3→31, renderer un-froze).
   - Backend is **1 CPU on Render**; full-global ICON marine `/grid` (`bbox=-180,-80,180,85`) and EURO `grid_series` **hang/504/CORS-fail under request-storm load**, but resolve in ~0.3s when idle. **Un-abortable background fetches that accumulate on this box are a known production-incident pattern** (the reverted backend shield `4bbe81c3`). Treat any "use a fresh/un-abortable signal" or "let it finish in the background" proposal as HIGH RISK and explicitly assess whether it can accumulate.
   - EURO/Copernicus has no coverage outside its region (`no_copernicus_coverage` 404 expected when panned away). ICON global marine covers ~6 days native only (no global estimated extension; regional path does 14 days).

---

## 1. VERIFY the 3 fixes I just applied (regression check)

Read the diffs (`git show <hash>`) and the surrounding code; confirm correctness and look for any regression or edge case I missed. Report verdict + file:line evidence for each.

| Commit | Change | Verify |
|---|---|---|
| `49dc3fd6` (part A) | `OceanMask.js` ~L313: recolor fast-path changed `setPaintProperty(MASK_BUFFER,'fill-color',…)` → `'line-color'` (MASK_BUFFER is a line layer). | Confirm MASK_BUFFER is a line layer everywhere; confirm the fast-path now correctly matches the full-sync recolor; confirm no other fast-path property is wrong; confirm `lastSyncCoreRef` gating still correct. |
| `49dc3fd6` (part B) | `useMarineDataFetcherCore.js`: moved `requestId = ++marineRequestIdRef.current` to AFTER the cooldown early-return (was before). | Confirm nothing between the old and new position uses `requestId`; confirm the `finally` (`requestId === marineRequestIdRef.current` → clears `locks.isFetching`) is now correctly satisfied on the prior fetch; confirm the cooldown path (requestId stays `0`) can't false-match; check for any OTHER early-return between the bump and the dispatch that has the same stranded-lock bug; check the analogous wind fetcher (`WeatherEngine.js`) for the same pattern. |
| `eb067c7e` | `useMarineOrchestrator.js` `checkScrubSettle`: added (1) terminal-`__failureReason` (coverage/unsupported) bypass, (2) cap of 3 no-data refetches per `{hour,model,layer}` (resets on target change). | Confirm `__failureReason` is actually present on the safe-zero/held grid at this point (trace `createFallbackSafeZeroGrid` / commit path); confirm the cap can't wedge a legitimately-recoverable hour (e.g. cold-ingestion empty that WOULD succeed on retry); confirm reset-on-target-change is correct; confirm hour-mismatch-with-data still fetches. |

---

## 2. RE-EXAMINE the 4 I HELD (tell me the correct, safe version — do not implement)

These came from your last report; I held them. For each, either **confirm my concern and propose the corrected approach**, or **show me I was wrong with file:line evidence**.

1. **OceanMask hide-vs-remove (toggle churn).** Your proposal removed the 350ms debounced deactivation entirely and toggled `visibility` none/visible. My concern: removing the debounce + the source/layer lifecycle is medium-high risk (correctness of the mask, interaction with the unmount-cleanup `useEffect`, and the `styledata`/`syncingRef` feedback). **Audit:** is a hide-vs-remove safe here, and what's the minimal-risk version (e.g. keep the debounce but hide instead of remove; ensure re-show on reactivate; ensure `lastSyncCoreRef`/`lastSyncSignatureRef` invalidation stays correct)? Assess GPU/source retention cost of keeping hidden layers.

2. **Cache-key tile match (`exact_key_absent`).** Your proposal made `clampViewportBbox` return a regional tile id when the 2°-snapped viewport bbox `≈` a regional tile's bounds. My concern: it's likely a **no-op** — the 2°-snap rarely equals a tile's bounds exactly (e.g. Florida tile west `-85` isn't on a 2° boundary), so the `<0.01` match almost never fires. **Audit the REAL mismatch:** read exactly what key `_cacheMarineResult` STORES under (`marineControllerCache.js`) vs what `getModelSafeMarine` / `isContainedInMarineCache` LOOK UP (`marineController.js` + `clampViewportBbox`). Give the precise store-key vs lookup-key divergence with file:line, and the correct fix (align the two), not a bounds-guess.

3. **ICON 14-day extended-blend anchors (`backendWeatherServiceClientHelpers.js` ~L370).** Your proposal ran the ICON@168 / GFS@168 anchor fetches on a **fresh un-abortable AbortController** so they finish + cache. My concern: **this is the backend-shield accumulation pattern** — during scrub+pan the bounds change, so the anchor fetches are NOT the same request and can pile up un-abortably on the 1-CPU box. **Audit:** are the anchor fetches deduped/cached such that they CANNOT accumulate (check the controller/provider in-flight dedup + cache keys for the anchor bounds)? If they can accumulate, this is unsafe — say so and propose a bounded alternative (e.g. dedup the anchor by a coarse key, cap concurrency, or detach-with-cap like the existing in-flight registry).

4. **Scrub-settle series-commit (the part of #4 I did NOT apply).** I reverted committing the time-series frame on settle (`0c0f9f58` → `42c61128`) because the series can be a **coarse 9×9 global** product and committing it when zoomed IN downgrades the sharp 37×17 regional view. **Audit + state the exact design constraint** a correct zoomed-out-scrub fix must satisfy: when (zoom/viewport span) is it safe to show the series frame, how to guarantee it never replaces a sharp regional grid with coarse, and whether the series even covers the needed hours/viewport reliably (`marineGridSeries.js` warming triggers + `viewportKey`).

---

## 3. STILL-OPEN issues (diagnose + report, do NOT fix)

1. **Zoomed-out timeline scrub snappiness.** Per-hour `/grid?bbox=-180,-80,180,85` (full-global) CORS/504-fails under load while `grid_series` (clipped viewport bbox) succeeds. **Audit:** (a) why the per-hour marine fetch resolves to full-global `-180,-80,180,85` (`backendWeatherServiceClientCoverage.js clampViewportBbox` ~L217) when the series uses a clipped bbox; (b) whether the per-hour fetch could use the clipped bbox the backend can actually serve; (c) backend: can `grid_resolver.py`/`viewport_service.py` serve a global ICON marine product fast, or only under no-load; (d) the series warming reliability for a zoomed-out viewport that pans during scrub (viewport-keyed → re-fetches?).

2. **Far-hour rapid model+layer toggle abort-storm.** I just fixed the stranded-`isFetching` lock (`49dc3fd6`). **Audit whether OTHER stuck-state remains:** the in-flight registry (`marineInFlightRegistry.js`), the abort/detach gates (`useMarineDataFetcher*.js`), `__MARINE_FETCH_PENDING__` lifecycle — can an aborted far-hour fetch still leave a pending/in-flight marker that blocks re-fetches? Characterize precisely.

3. **Engine re-init churn.** `Initialized engine with 36864 wave crests` (192²) ≠ startup `87616`/`147456` — a dispose+reinit (likely canvas-resize). **Audit** `WebGLMarineCustomLayer.js` / `WebGLMarineEngineInit.js` / `MapWebGL.js`: when does the resident engine re-init, and is it per-interaction (R7 was meant to keep it resident)?

4. **Dev-build overhead still shipping.** PostHog session recording + rrweb console/network capture (`frontend/public/index.html` ~L172) run on every deployed page. **Audit/quantify** its main-thread cost and whether it should be gated (like React Scan was). Note: your last proposal gated it on LOCALHOST (helps dev, not prod) — assess the PROD cost specifically.

---

## 4. Broader audit (same as last time — keep going where you left off)

- **Weather-truth invariant:** no path may display data whose model/layer/hour/viewport ≠ the UI. Audit `commitMarineData` (`useMarineDataFetcherHelpers.js`), the `requestId`/live-target guards, `marineTransitionCoordinator.js`, the `useMarineWindData.js` render gate. Report violations file:line.
- **800-LOC pre-commit gate:** flag any `frontend/src/components/map/` file > ~750 LOC (refactor risk).
- **Backend:** `grid_resolver.py`, `viewport_service.py`, `grid_series_helper.py`, `copernicus_marine_service.py`, `scheduler.py` — global-vs-regional/dynamic decision, global-coarse product generation per model, any path that hangs/500s under load.
- **Commit hygiene:** walk the last ~30 commits; flag reverted-then-relanded churn, anything whose diff doesn't match its message, anything in the DO-NOT-TOUCH fetch/abort/transition zone.
- Cross-reference prior handoff docs (`GEMINI_HANDOFF_marine_perf.md`, `CODEX_HANDOFF_*`, `ANTIGRAVITY_HANDOFF_*`, `WEATHER_SIMULATION_SYNC_AUDIT_*`, and `ANTIGRAVITY_HANDOFF_AUDIT_2026-06-23.md`) — what was done / partially done / never done.

---

## 5. Deliverable (the ONLY thing you produce)

Write `ANTIGRAVITY_AUDIT_FINDINGS_2026-06-23_v2.md` with:
1. **§1 verification verdicts** — for each of the 3 applied fixes: correct / has-a-residual-bug / regression, with file:line.
2. **§2 re-examination** — for each held item: "your concern confirmed → corrected approach" OR "concern wrong → evidence", plus the precise design constraint (esp. items 2, 3, 4).
3. **§3 open-issue root-causes** — mechanism + file:line, ranked by user impact, with the design constraints a correct fix must satisfy.
4. **§4 broader findings** — file:line.
5. **Prioritized fix backlog** — recommendations only, each tagged low/med/high risk, and flagged if it touches the DO-NOT-TOUCH zone or the un-abortable-accumulation pattern.
6. **"NOT VERIFIED / out of scope"** section for anything you couldn't confirm.

Then STOP. Implement nothing. Hand the report back to Claude.
