# Codex Handoff v2 — Audit the abort-storm rework + plan the next round

**Branch:** `dev` (Netlify auto-deploys frontend; Render auto-deploys backend, both from `dev`).
**HEAD:** `5e9dc7f6`. **Repo:** monorepo — `frontend/` (CRA/craco React) + `backend/` (FastAPI). Marine code: `frontend/src/components/map/`.
**Date:** 2026-06-21. **Author:** Claude (Opus).

> **Two asks:**
> 1. **Audit** the abort-storm rework we just shipped (Phases 1/2a/2b + the particle-texture perf change) — find correctness bugs, regressions, and especially any way it can still strand a transition or leak/over-fetch.
> 2. Produce a **new implementation plan** for what's left: the GPU/compositor frame drops (the now-dominant "feel" problem) and two deferred items. Plan only — no code.

---

## 1. What shipped since the last handoff (all on `dev`, deployed)

You previously returned an investigation plan; we implemented it in phases. Commits:

- `d4b4c2df` **P1** — `frontend/src/components/map/marineInFlightRegistry.js` (pure registry + telemetry, no wiring). Unit test `marineInFlightRegistry.test.js`.
- `54e5b0ec` **P2a** — detach-instead-of-abort wired into `useMarineDataFetcher.js`. Removed the old duplicate-fetch `backgroundCacheFill` + `__MARINE_BG_FILL__`. **Confirmed live working:** logs show `[Detach] Detaching…` and ZERO `[ABORT RECOVERY] … Committing recovery grid` (the blank-storm is gone; only `Discarding abort recovery because requestId stale` remains = guard correctly not committing).
- `978c6335` **P2b** — detached-dedup + wake (stuck-proof attempt). **Not yet live-verified.**
- `5e9dc7f6` **perf** — reseed particle-state textures in place (texSubImage2D) instead of delete+realloc on grid shift.

Earlier context still in force: R23 same-target dedup, R24 empty-grid no-cache + SWR retry, R25 abort-recovery target-guard + oversized-grid reject (>250k cells), R26b ICON marine timeline stays 14 days, exact-point abort timeout 18→12s.

---

## 2. How the rework works now (so you can audit it)

**Registry — `marineInFlightRegistry.js`** (`createMarineInFlightRegistry({cap:3})`):
- Key = `rawModel|model|layer|hour|boundsKey`. Entry: `{controller, intent, requestId, state:'foreground'|'detached', wantedAgain, completionStatus}`.
- `registerForeground / find / detach / markWanted / complete(identity-safe) / remove / enforceCap / abortAll`.
- `pickEvictionVictim`: NEVER evicts a `wantedAgain` entry or the just-detached `protectKey`; returns only oldest non-wanted (else null → temporary over-cap). `shouldWake = state==='detached' && wantedAgain && status!=='abort'`.
- Telemetry → `window.__MARINE_INFLIGHT__` (counts incl. foreground_detached, detached_reused_on_return, detached_cache_completed, detached_failed, detached_aborted_by_cap, detached_wake_enqueued).

**Fetcher — `useMarineDataFetcher.js`** (current line numbers @ `5e9dc7f6`):
- L47 `inFlightRef = useRef(createMarineInFlightRegistry({cap:3}))`; L93 `detachedWaitTimerRef`.
- updateMarineGrid abort gate (L~205-214): on a real switch, `inFlight.detach(prior.__intent)` (no abort), `locks.isFetching=false`.
- **Detached-dedup early-return (L224-243):** before pre_fetch, `const di={model,rawModel,layer,hour:timeOffset,boundsKey:viewportHash}; if (inFlight.find(di)?.state==='detached'){ inFlight.markWanted(di); set 2s detachedWaitTimerRef fallback → updateMarineGrid('detached_wake_fallback'); clearDebounce=false; return; }`. L243 clears that timer when a real fetch proceeds.
- Controller creation (L264-273): detach prior, `new AbortController()`, `myController=…`, tag `__intent`, `inFlight.registerForeground(myController, __intent, requestId)`.
- After fetch (L~392): `fetchStatus='success'` if data renderable, BEFORE the `requestId !== marineRequestIdRef.current` stale-reject return + the live-target reject.
- catch: `fetchStatus = isAbort ? 'abort' : 'failure'`.
- **finally (L543-553):** `const {shouldWake}=inFlight.complete(myController.__intent, myController, fetchStatus); if(shouldWake && active && enqueueRef) setTimeout(()=>enqueue('detached_wake'),0);` — runs for foreground AND detached/stale (identity-safe). The existing `requestId===current` block (foreground cleanup, transition end) is unchanged below it.
- enqueueMarineUpdate abort gate (L~640-646): `inFlight.detach(prior.__intent)` instead of abort, then the existing 150ms coalesced retry.
- unmount (L755-756): `inFlight.abortAll()` + clear `detachedWaitTimerRef`.

**Display-safety invariant (unchanged, do not weaken):** a detached/stale fetch is blocked from committing by `requestId !== marineRequestIdRef.current` and the live-target check (model/layer/hour vs active refs), and the transition coordinator's generation guard. The registry never calls setMarineData.

**Particle reuse — `WebGLMarineEngineInit.js` `reseedParticleStateInPlace(engine,gl)`** + `WebGLMarineEngine.js:146`: `particleRes=296` is constant, so on grid shift it now `texSubImage2D`s fresh random seed into the existing A/B textures (one random pass, shared buffer) instead of delete+`initParticleTexture`.

---

## 3. Audit questions (please answer with code evidence)

1. **Can the P2b dedup early-return still strand a transition?** Trace: orchestrator `beginTransition` → updateMarineGrid early-returns at L224-243 (capturedTransitionGen never set) → relies on the detached request's `complete()→shouldWake` (finally L543) OR the 2s fallback to re-drive. Verify every path that reaches the early-return is guaranteed a wake or fallback. Edge cases: detached request already completed between `find()` and `markWanted()`; the detached request's finally ran its `complete()` BEFORE we called `markWanted()` (race → wanted set on a deleted/absent entry → no wake → only the 2s fallback saves it; is 2s acceptable, and does the fallback actually re-enter cleanly?). Is there a TOCTOU window?

2. **Wake correctness / loops.** `detached_wake` and `detached_wake_fallback` re-enter `enqueueMarineUpdate`/`updateMarineGrid`. Confirm they pass through same-target dedup + cache so they can't loop or thunder. Confirm `'detached_wake'` isn't treated as high-priority in a way that detaches a legitimate foreground fetch. Confirm the wake fetches the CURRENT target (not the stale one).

3. **Concurrency / leak.** With detach-not-abort + cap=3, what's the real max concurrent backend requests during a fast storm, and can detached entries leak if `complete()`'s identity check misses (e.g., key re-registered)? Is `cap:3` right for a 1-CPU Render backend, or should it be lower? Does anything still reference the removed `backgroundCacheFill`/`__MARINE_BG_FILL__`?

4. **fetchStatus precision.** It's set 'success' when `data.grid.renderable!==false && vectors.length>0` before the stale-reject. Is there a path where a detached request self-caches but we record 'failure' (→ unnecessary wake-refetch), or vice-versa (caches nothing but we record 'success' → wake cache-misses and refetches anyway, harmless)? 

5. **Particle reuse safety.** `reseedParticleStateInPlace` does `texSubImage2D` into existing textures. Verify: the textures are always allocated at `particleRes` before any reset can run (no first-run path that resets before init); `texSubImage2D` format/type (RGBA/UNSIGNED_BYTE) matches the `createTexture` allocation; binding is restored; no FBO/feedback hazard with the ping-pong sim reading these mid-frame. Any case where dims COULD differ from particleRes (they shouldn't — confirm)?

6. **Did we regress R22-R26b or the parity/coordinator machinery?** Specifically the transition end (finally `requestId===current` + `endTransition(capturedTransitionGen)`), the pending-intent re-fire, and `useMarineWindData`/`MapForecastOverlay` parity.

---

## 4. New plan needed — the remaining problems

### P-perf (now the dominant "feel" issue): GPU/compositor frame drops
React Scan repeatedly reports **react render time = 0ms** with all time in **"other"/compositor** (223ms, 525ms, up to **1433ms**; a route click had **588ms in "dom commit → frame presented"**). So it's GPU/main-thread, not React, not the abort storm. Suspected contributors (please confirm/rank with evidence; we do NOT yet have the React Scan component-level "Formatted Data"):
- Continuous simulation: marine 87,616 + wind 147,456 particles RK4 every frame (`frontend/src/engine/SimulationLoop.js`; compose throttled to ~4Hz via `NORMAL_COMPOSE_INTERVAL=15` at L53, but the sim step itself runs hot).
- Per-commit `encodeMarineTexture` (`WebGLMarineEngine.js:94`) building Float32 wave/chl/bath arrays + uploads.
- Land-mask 1024×512 via Canvas2D `getImageData` (`WebGLMarineTextureEncoder.js` — already bounds-cached; confirm it's not a hotspot).
- `OceanMask` `syncLayers` running on nearly every commit (long-standing audit P1).
- Possible: both WebGL engines always resident (R7 resident-engine fix) — GPU memory/fill cost.
**Want:** a ranked, evidence-based hypothesis of the 588ms and the smallest surgical wins, PLUS exactly what React Scan "Formatted Data" / Chrome perf trace to capture to confirm before changing code.

### P-deferred-1: orchestrator ICON→GFS cache-lookup remap
`useMarineOrchestrator.js:294-296` AND `:636` flip `curModel='ICON'→'GFS'` when `timeOffsetHours>168` for the cache lookup, while the fetcher correctly serves ICON-extended through 336h → ICON-extended products never cache-hit (extra churn) and a possible GFS-as-ICON labeling concern. Fix requires extracting a shared model-resolution helper (the file is 887 LOC, over the 800 pre-commit gate). Want the safe extraction + fix plan.

### P-deferred-2: ICON extension hardening
`backendWeatherServiceClientHelpers.js:357 fetchBackendMarineGridIconExtended` — 3 sub-fetches share the caller signal; on all-empty it throws, and L385 `if (gfsTargetGrid) return gfsTargetGrid` returns a raw GFS grid out of an ICON call. With detach-not-abort the signal now usually stays alive, so re-evaluate: rethrow AbortError on aborted inputs (don't convert to "sources unavailable"); stop returning/caching GFS-as-ICON; keep the 14-day window.

---

## 5. Constraints (hard)
- **Weather-truth:** never display data whose `{model,layer,hour}` ≠ requested target; never relabel another model's grid. Don't weaken `MapForecastOverlay.js` parity gate or `marineTransitionCoordinator.js` (history of stuck-`pending` regressions).
- **Surgical, additive, reversible.** Cite file:line. Each change independently revertable.
- **Don't hide capabilities** (ICON 14-day already reverted once for this).
- **800-LOC pre-commit gate** per file — `useMarineDataFetcher.js` is at 799, `useMarineOrchestrator.js` at 887 (extract helpers, don't `--no-verify`).
- **SW bundle staleness:** verify any live test is on the right bundle — SW logs `Removing old cache: rawsurf-v3-<shorthash>`; `<shorthash>` must == `git rev-parse --short HEAD`.
- Tests: `cd frontend && CI=true npx craco test --watchAll=false --testPathPattern="…"`; build `CI=true npx craco build` (CI=true makes warnings fail).
- **Do not deploy-loop.** One curl / one live check after the user says it's live.

## 6. Deliverable
A written report: (a) audit findings on §3 (bugs/regressions/risks with file:line, severity, fix sketch); (b) a ranked plan for §4 P-perf incl. exactly what profiling data to capture first; (c) the §4 deferred-1/2 plans with the helper-extraction approach; (d) test cases to add; (e) anything that should be reverted.

Prior docs in repo: `CODEX_HANDOFF_marine_abort_storm.md` (v1) and its plan, `CODEX_TEST_HANDOFF_transition_coordinator.md`, `ANTIGRAVITY_HANDOFF_marine_loading_perf.md`.
