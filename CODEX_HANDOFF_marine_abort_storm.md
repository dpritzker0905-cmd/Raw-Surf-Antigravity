# Codex Handoff — Marine/Wind "abort storm" on rapid layer/model toggle

**Branch:** `dev` (Netlify auto-deploys frontend from `dev`; backend on Render auto-deploys from `dev`).
**Repo:** monorepo — `frontend/` (CRA/craco React) + `backend/` (FastAPI). Marine weather lives in `frontend/src/components/map/`.
**Date:** 2026-06-21. **Author:** Claude (Opus). **Audience:** Codex, to investigate BEFORE I start the "abort-storm rework."

> ⚠️ Read this whole doc before editing. Do **not** start coding a fix yet — the ask is **deeper investigation + a written plan**, validating or refuting my hypotheses with code evidence. Constraints at the bottom.

---

## 1. The user-visible problem

On a **fresh map load**, if the user **quickly toggles marine + wind layers and/or switches models** (ICON↔EURO↔GFS) before fetches finish:
- Marine (and sometimes wind) heatmaps **don't load** — they only appear once the user *stops* interacting. Switching to EURO/GFS and back often "unsticks" it.
- The infobox shows **"Loading…"** and can **time out**, out of sync with the timeline scrubber.

The dominant console signature is a storm of:
```
[Marine] Layer switch backend cache MISS for <layer>. Retaining stale view while fetching.
[Abort] Aborting active fetch (<src>) in enqueueMarineUpdate for new source=manual
[Backend Weather Service] Grid fetch error: signal is aborted without reason.
[Marine] Fetch aborted (expected during model/layer switch) phase=standard_fetch
[ABORT RECOVERY] AbortError ... model=X, layer=Y. Retry count: 0/3
[ABORT RECOVERY] Skipping recovery-grid blank — target moved on (...)   ← my recent fix
```
…repeated per switch. Nothing commits until the user pauses, at which point the final target's un-aborted fetch completes and renders.

---

## 2. What's ALREADY fixed this session (do not re-litigate; verify still intact)

All on `dev`, deployed & confirmed live in logs:

- **R23** `fd2ec5a4` — same-target dedup: identical in-flight `{model,layer,hour}` request is skipped, not aborted (`[Abort-Gate] Same-target fetch already in-flight … skipping duplicate`).
- **R24** `04a86cf6` — HTTP-200 empty grids: `_cacheMarineResult` no longer caches empties (`marineControllerCache.js:133`), and `scheduleSWRRevalidation` retries a non-stale empty grid 3×@2500ms (`useMarineRevalidation.js:25`). Self-heals far-hour cold-ingestion blanks.
- **R25** `321338d1` — (A) abort-recovery no longer commits a blank "recovery grid" when the user has switched target (`useMarineDataFetcher.js` ~L500, `targetChanged` guard); (B) `mapNormalizedGridToWebGL` rejects grids >250k cells (`backendWeatherServiceClientHelpers.js` top) — kills a tab-freezing ~1M-vector (1441×661) ICON encode.
- **R26→R26b** `6ea4687e`→`fff3cd90` — I wrongly capped the ICON marine timeline to native 168h/7d; **reverted** — ICON must stay at **14 days (336h)**. Kept exact-point abort timeout trim 18s→12s (`useExactPointFetch.js:166`).

**Lesson encoded:** do not hide an advertised capability (ICON 14-day window) to mask a fetch-reliability bug.

---

## 3. The remaining root cause (my hypothesis — please validate/refute)

**Rapid model/layer switching aborts in-flight marine fetches faster than they can complete, and the system has no "settle and commit the final target" guarantee beyond the user manually stopping.** Each switch:
1. Orchestrator effects fire a `manual` fetch for the new target.
2. `enqueueMarineUpdate` / `updateMarineGrid` **abort** the prior in-flight controller (different target).
3. The aborted fetch lands in the abort-recovery path; with R25 it no longer blanks, but it also commits nothing.
4. Net: during a burst, 0 successful commits until the burst ends.

### Marine is structurally heavy (context, verified earlier rounds)
- Marine = **12 products** (4 layers × 3 models), fetched **per-viewport-tile** (cache miss on most pans). Wind = 1 global grid per model (cache-friendly). So `[Marine] cache MISS` on every switch is mostly expected.
- ICON far-hour (>168h) marine uses an **estimated extension** that fires **3 recursive sub-fetches on the SAME abort signal** — see §4. Under the storm those sub-fetches abort → `ICON extended blend target GFS and EURO are both unavailable` → conformed safe-zero grid → infobox timeout. **This is why "ICON 14-day far hours don't load" — it's the abort storm, not a missing capability.**

### Existing mitigations already in place (so the rework must not duplicate/fight them)
- Switch-fetch **coalescing 600ms** in `useMarineOrchestrator` (`SWITCH_FETCH_COALESCE_MS`) on model + layer effects.
- Scrub coalescing 150ms.
- Same-target dedup (R23) in both abort gates.
- Activation **readiness gate** (R22): defer the activation fetch until `mapInstance.isStyleLoaded()` else `once('idle')`.
- A generation-owned transition coordinator: `frontend/src/components/map/marineTransitionCoordinator.js` (`beginTransition`/`endTransition(gen)`/`markDisplayed`/`displayMatchesRequested`). **Reuse this, don't reinvent.**

---

## 4. Key files & exact locations (verified line numbers @ `fff3cd90`)

**Fetch lifecycle — `frontend/src/components/map/useMarineDataFetcher.js`:**
- `marineRequestIdRef` (L40), `abortControllerRef` (L41). Controller tagged with `__intent = {model, rawModel, layer, hour, bounds, zoom, boundsKey}` at L277.
- `updateMarineGrid` (the actual fetch+commit fn): abort-gate inside it at **L218–239** (same-target dedup L221-223; high-priority preserve L229; abort L232-239); new controller L268-277; `fetchMarineData` call ~L361; empty-but-`emptyGridWarning` commit path L429; unsupported-layer preserve L411-427; **catch/abort block L464–523** (requestId staleness guard L485; abort-recovery commit + `targetChanged` guard ~L490-519); `finally` ends transition ~L537.
- `enqueueMarineUpdate` (the debounced public entry, `useCallback`): **L571–640**. Second abort-gate: same-target dedup L610-614; high-priority preserve L622; **abort L625-628**.
- `backgroundCacheFill` (R14, Phase C): detached-completes the abandoned layer's fetch so switching back is a cache hit. L42, ~L119-136.

**Commit + retry:**
- `commitMarineData` — `frontend/src/components/map/useMarineDataFetcherHelpers.js:320` (hold-prior-frame-on-empty guard, same model+layer only, L365; calls `scheduleSWRRevalidation` L414).
- `getAbortRecoveryGrid` — same file L152 (non-renderable safe-zero placeholder).
- `useMarineRevalidation.js:25` — `scheduleSWRRevalidation` (stale + empty-transient retry, bounded 3).

**Controller / cache — `frontend/src/components/map/marineController.js`:**
- `fetchMarineData` L302; per-model branches call `fetchBackendMarineGrid`/`fetchBackendCopernicusGrid` then `_cacheMarineResult` (L389-419).
- `marineControllerCache.js:133` `_cacheMarineResult` (skips empty grids, R24).

**Backend client — `frontend/src/components/map/backendWeatherServiceClient.js`:**
- `fetchBackendMarineGrid` L243. ICON-extended gate `model==='ICON' && hourOffset>168` L244-250. URL/clamp L405-461.

**ICON extension (the far-hour failure) — `frontend/src/components/map/backendWeatherServiceClientHelpers.js`:**
- `fetchBackendMarineGridIconExtended` **L357**. The **3 sub-fetches share `signal`** at **L370-373** (`Promise.allSettled([ICON@168, GFS@168, GFS@target])`). Throw on all-empty L386. `>240h` blend path ~L500-524 (throws `ICON extended blend target GFS and EURO are both unavailable` L524).
- `mapNormalizedGridToWebGL` L143 (oversized-grid guard at top, R25).

**Coverage/clamp — `frontend/src/components/map/backendWeatherServiceClientCoverage.js`:**
- `clampViewportBbox` L139. Wide viewport (span>5°, non-EURO) → global coarse `-180..180` L217-228. EURO span capped to 20° L166-193. Per-model tile snap L230-247.

**Orchestrator — `frontend/src/components/map/useMarineOrchestrator.js`:**
- Model switch effect + 600ms coalesce (~L580); layer switch effect (~L757); activation `activeLayersKey` effect + readiness gate (~L156); scrub-settle verification (~L775-821, logs `[SCRUB-SETTLE] Post-scrub verification`).

**Infobox (separate path) — `frontend/src/hooks/useExactPointFetch.js`** + **`frontend/src/components/map/MapForecastOverlay.js`:**
- Suppression during scrub/play/cooldown L111; sets `exact_loading` + nulls response L146-147; debounce 400ms(switch)/1200ms(non-switch) L161; fetch abort timeout **12s** L166.
- Overlay parity gate `MapForecastOverlay.js:141-171`: `gridParityOk = hasGridParity && displayMatchesRequested(...)`; `useGridFallback` (L158) allows grid sample during scrub / terminal failure / transient-wait-with-parity; `blockFallbacks` L164 → "Loading…" when neither exact-point nor grid has the requested target. **This is working as designed; far-hour "Loading…" is often truthful.**

---

## 5. Specific questions for Codex to answer (with code evidence)

1. **In-flight reuse vs abort:** When the user switches A→B then back to A while A's fetch is still in flight (or just aborted), is there any path that *reuses* A's result? `backgroundCacheFill` is supposed to detached-complete the abandoned fetch so the return is a cache hit — **does it actually populate `_perModelHourCache` for the abandoned target during a storm, or does its own fetch also get aborted / never fire?** Trace `backgroundCacheFill` (useMarineDataFetcher.js ~L119-136) end-to-end. If it works, the storm should be far cheaper on the 2nd pass — is it?

2. **Should switches abort at all?** The abort is justified to free the network and avoid stale commits. But could we instead **let the in-flight fetch run to completion and cache-only-commit (never setMarineData unless it matches the *current* target)**? i.e. convert "abort on switch" → "detach + self-cache + commit-iff-still-current". Evaluate feasibility against the existing `requestId`/`marineRequestIdRef` + `marineTransitionCoordinator` ownership model. Where would the "commit-iff-still-current" check live? (Candidate: the `requestId === marineRequestIdRef.current` gate already exists at L392/L537 — can we keep the fetch alive instead of aborting and rely on that gate?)

3. **ICON extension under abort:** In `fetchBackendMarineGridIconExtended` (L357), the 3 sub-fetches share the caller's `signal`. Under a storm the signal aborts and the whole extension throws → safe-zero. Options to evaluate: (a) give the extension its own un-aborted controller for the *anchor* fetches (ICON@168, GFS@168 are viewport-stable and cacheable) while only the *target* slice honors the user signal; (b) serve anchors from cache; (c) accept partial (ICON-only persistence) instead of throwing when GFS target is the only missing piece. Which is safest and smallest? Does it risk weather-truth (showing estimate labeled as authoritative)? Note the result is already tagged estimated/`renderDecision:'estimated_blend'`.

4. **How many fetches per single activation?** On one marine activation the log shows activation effect + layer-change effect + model-change effect + `moveend` all able to enqueue. The 600ms coalesce + same-target dedup should collapse these. **Quantify:** for one clean activation (no user spam), how many `enqueueMarineUpdate` calls and how many actual network fetches fire? Is the coalescing actually collapsing them, or do different `source` values bypass it? (See enqueueMarineUpdate L571-640 + orchestrator effects.)

5. **Wind coupling:** Wind fetches succeed (`Viewport wind fetch success: 300/629 vectors`) but the user says wind "struggles" too. Is wind genuinely blocked, or is it just visually stalled by the marine main-thread work (`encodeMarineTexture`, 1024×512 land mask, `Resetting particle state textures due to grid shift/resize` on every commit since grid dims change per model)? Confirm whether wind has its own abort coupling to marine or shares any lock.

6. **`Resetting particle state textures due to grid shift/resize`** fires on essentially every commit because grid dims differ per model (37×17 GFS/EURO coarse, 19×9 ICON coarse, 13×9, 25×12). Is this reset avoidable when only values change but the engine could reuse buffers? (Marine engine: `frontend/src/components/map/WebGLMarineEngine*.js` / `GPUMarineLayer.js`.) Lower priority but it's the bulk of the per-commit GPU cost.

---

## 6. Constraints (hard rules — the user is strict on these)

- **Weather-truth:** never display data whose `{model, layer, hour}` doesn't match the requested target. No relabeling a stale/other-model frame as the current one. The `marineTransitionCoordinator` + `displayMatchesRequested` parity machinery exists precisely for this — **do not weaken `MapForecastOverlay.js:141-171` or the coordinator** without explicit sign-off (it's the product of rounds R1-R6 and has a history of stuck-`pending` regressions).
- **Surgical, no rewrites.** Additive, reversible changes. Cite line numbers.
- **Do NOT** "fix" by hiding capabilities (e.g. capping the ICON 14-day window) — already tried and reverted.
- **Do NOT** loop-poll the Render/Netlify deploy. Verify with ONE curl after the user says it's live.
- **Bundle staleness gotcha:** the Service Worker is cache-first; `BUILD_VERSION` (= git short hash) is injected by `frontend/update-sw-version.js` at build. Confirm any test of a deployed fix is on the right bundle: the SW logs `Removing old cache: rawsurf-v3-<hash>` — `<hash>` must equal `git rev-parse --short HEAD` of `dev`. Stale bundle = re-test after hard reload.
- Tests: `cd frontend && CI=true npx craco test --watchAll=false --testPathPattern="..."`; build: `CI=true npx craco build`. Pre-commit hook blocks files >800 LOC (don't `--no-verify`; split helpers instead).

## 7. Deliverable I want from Codex

A written plan (not a PR) that:
1. Confirms or refutes hypothesis §3 with specific code evidence (answer the §5 questions).
2. Recommends ONE primary approach for the abort-storm (likely Q2: detach-instead-of-abort + commit-iff-current, or strengthen `backgroundCacheFill`), with the exact functions/lines to change and why it's weather-truth-safe.
3. Recommends the smallest ICON-extension robustness change (Q3).
4. Flags any risk of regressing R22-R26b or the parity machinery.
5. Lists the test cases to add.

Reference docs in repo: prior handoffs `CODEX_TEST_HANDOFF_transition_coordinator.md`, `ANTIGRAVITY_HANDOFF_marine_loading_perf.md`, and the audit `WEATHER_SIMULATION_SYNC_AUDIT_CLAUDE_HANDOFF_2026-06-20.md` if present.
