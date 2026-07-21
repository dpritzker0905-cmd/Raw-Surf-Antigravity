# HANDOFF 2026-07-21 (Opus 4.8, cont.) — marine #10 coverage cluster: Sources 1 & 2 + #11 live A/B closed

Continues the 07-21 EVE session (`001b98eb`). Every claim carries a test or a live instrument.
User mandate this session: **test 3 times, a different forensic way each time.**

## 0. BINDING RULES (unchanged, applied)
forensics not guessing · Jacobian lens · study memory + handoff + recent commits before touching a
subsystem · instrument-first + kill-switch + A/B · THREE THEMES × desktop/mobile for user-visible ·
one change-set at a time, committed with evidence, pushed, `git log origin/dev` verified · **test 3×.**

## 1. SHIPPED — #10 Source 1 (`f6040e95`, pushed, HEAD==origin/dev)
The scrub-cache instant re-index (`useMarineOrchestratorScrubCache.js`) rejected a regional/non-covering
grid ONLY when zoomed OUT (`rejectRegionalCache` gated on `isViewportZoomedOut`). Zoomed IN over region
A, a cached regional tile for region B could warm-commit → floating rectangle (render's regional cull
only fires zoomed out). The `#13` Ecuador class.

**Fix = the commit-point invariant.** New pure predicate `marineWarmCommitCovers(grid, vb, win)` in
`marineWarmCoverage.js` — the coverage half of `regionalValidInPlace` (useMarineOrchestrator.js:556):
a width-regional grid may only warm-commit when it COVERS the viewport, at ANY zoom. Global-width/scope
covers everything; fail-OPEN on missing/malformed input; antimeridian-aware eps 0.05 containment. The
reject keeps `legacyReject` VERBATIM + one disjunct that fires only zoomed-IN for a non-covering grid ⇒
kill switch restores exact prior behaviour. Kill `__RAW_DISABLE_MARINE_WARM_COVERAGE__`, tripwire
`__MARINE_WARM_COVER_REJECT__`. Modelled on #11 `marineRefeedCovers`.

**Tested 3 ways:** (1) 14 enumerated predicate branches + full suite 1328 (arbiter sweep 37268×2 =
0 divergences). (2) Live localhost:3009 real-GPU: covering FL scrub tracks 1→2→3h (hash changes),
0 false rejects across covering/global-fallback/non-covering-resident states, code in the loaded chunk,
ESLint clean. (3) Adversarial 4-lens review (7 agents): 0 confirmed defects — regression-algebra PROVEN
strict-superset; 2 antimeridian edges fail-SAFE + inherited from the reference; 1 autoplay note =
intended choppy-correct over smooth-wrong (bounded).

## 2. SHIPPED — #10 Source 2 (`handleCooldownFallback`) — commit PENDING review at time of writing
**KEY FORENSIC (verified, corrects the cluster map):** `getModelSafeMarine` returns only covering-or-
global grids on every lane EXCEPT `per_model_hour_cache_nearest` (marineController.js:456-471), which
returns a nearest-HOUR grid with NO containment check, flagged `__staleHour`. Source 1 already rejects
`__staleHour` grids (its `!__staleHour` commit gate). But **Source 2 commits any cachedData with
vectors — no `__staleHour`/coverage gate** — so a non-covering nearest-hour tile could paint a floating
rectangle during a 429 cooldown. (So Source 2's guard is NOT dead code — the earlier "getModelSafeMarine
is fully gated" reasoning missed the nearest-hour lane.)

**Fix:** reuse a cached grid only if it COVERS the viewport while zoomed IN (zoomed-out reuse unchanged;
covering grids incl. `__staleHour` reuse as before). Same predicate + kill switch; tripwire
`source:'cooldown_fallback'`. Rejecting falls to the existing stale/prior-retain branch → never blanks
when prior data exists.

**Tested:** (1) 7 enumerated unit cases (covering reuse / non-covering reject+tripwire / global / zoomed-
out legacy / wide-vp legacy / kill-switch A/B / stale-retain-no-blank). (2) Full suite 1335 + ESLint
clean. (3) Live: code confirmed in the reloaded bundle, marine renders 208 vec/107 nonzero/1.42m at FL
z8, HUD green (AUTHORITATIVE NATIVE, 0 causal violations), 0 false rejects. Adversarial reviewer running.

## 3. VERIFIED — #11 re-feed guard live A/B CLOSED (handoff 07-21 EVE §1d "pending")
Clean guard-ON vs guard-OFF reproduction on localhost:3009 (toggle waves OFF → pan far to a FRESH region
→ toggle ON):
- **guard OFF** (`__RAW_DISABLE_MARINE_REFEED_COVER_GUARD__=true`): the stale FL grid `{-84..-76}` re-feeds
  over fresh Hawaii `{-159..-156}`, `covers:false`, persists >1.3s = THE FLOATING RECTANGLE.
- **guard ON** (default): FL refeed SUPPRESSED → global-coarse (covering) → fresh Portugal regional lands;
  engine bounds NEVER non-covering. No rectangle.
`marineRefeedCovers` validated live. Item closed.

## 4. THE CLUSTER NOW — what's left and why
Live-reachable floating-rectangle vectors are covered: #11 refeed (fixed+live-verified), Source 1 scrub-
cache commit-point (fixed+3-way), Source 2 cooldown (fixed+tested). `getModelSafeMarine` is containment-
gated on all lanes but nearest-hour (now caught at the two commit points that consume it).
- **Source 3 (`getMarineSeriesFrame`)**: already heavily guarded (bboxContains vs entry.bounds :678/:717
  + global-width guards). The mapped gap (entry-aggregate vs per-frame bounds) is largely theoretical —
  frames within an entry share the entry bbox. Source 1's commit-point guard already catches any non-
  covering series frame in the scrub path. VERIFY the frame.grid.bounds≠entry.bounds case actually occurs
  before investing. Other consumer to check: `useMarineScrubSettle` (commits series frames; has its own
  detectClamp/gridCoversViewport at :8 — likely already coverage-safe).
- **Source 5 (non-backend remap lanes)**: reachable only when backend flags OFF ⇒ dead in prod. Skip.
- **#13 Ecuador**: a rated-clip-edge during the stash interlude (handoff EVE §12, `968f428b`) — a DIFFERENT
  (rating/stash) mechanism, "not a flip blocker." Distinct from the coverage cluster.

## 5. STILL OPEN (need the user)
- **Issue B** (future-scrub cleared-surroundings): ROOTED, FIX DEFERRED — coverage-vs-freshness product
  trade-off. Candidates (a)/(b)/(c) in the 07-21 EVE handoff §2. **Needs the user's preference.**
- **ARBITER default flip**: gated ONLY on the user 8-item eye pass (server :3011). Unchanged.

## 6. ENVIRONMENT NOTES (this session)
- Live harness: `preview_start name:"frontend-verify"` → localhost:3009 (openssl-legacy, mock-auth on
  `/map`, Render backend). Real GPU in the Browser pane. Screenshots time out on first paint — warm up
  first, or rely on `__MARINE_RENDER_SOURCE_DIAG__` (note: TWO diag shapes — `direct_mapwebgl` has
  vectorCount/nonzeroCount, NOT renderable/hasGrid; don't false-alarm on a missing field).
- Drive marine via `window.map.jumpTo` + the "Waves"/"Wind"/"Step +1h" buttons (`.click()` by label).
  `window.__MARINE_ENGINE__._waveData.bounds` = resident grid. Kill switches are window globals (reset
  on reload).
- No orphaned dev servers this session (the two node PIDs are DesktopCommander MCP + Adobe CC).
- Windows python broken → `AppData\Local\Python\bin\python3.exe`. Bash CWD persists across calls (cd back
  to frontend before craco). Craco test: `node node_modules/@craco/craco/dist/bin/craco.js test --watchAll=false`.
- Suites at HEAD after Source 2: frontend 1335 · backend 811 (untouched).
