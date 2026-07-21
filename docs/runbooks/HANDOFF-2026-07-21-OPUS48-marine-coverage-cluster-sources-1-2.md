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

## 3b. SHIPPED — #10 Source 3 (`ef72136e`, pushed): getMarineSeriesFrame served-frame coverage
Looked theoretical (entry.bounds vs per-frame) until an **empirical live grid_series probe overturned it**:
EURO across the 240h native→estimated boundary returns HETEROGENEOUS-bounds frames — h228 `5x5
[-84,24,-76,32]` WIDE, h240+ `13x17 [-82,26,-79,30]` NARROW. entry.bounds = the FIRST frame (wide,
:457-467), so the entry-bounds containment (:678/:717) passes for a viewport the served NARROW frame
doesn't cover → clamped sub-rectangle. series_sharpen has its own frameCovers gate; recovery_2b/series_settle
commit with NONE. Fix at the choke: reject a served frame whose OWN bounds don't cover the request
(marineWarmCommitCovers). Kill `__RAW_DISABLE_MARINE_SERIES_FRAME_COVER__`; tripwire
`__MARINE_SERIES_DIAG__.coverMisses`. Tested 4×: empirical probe · 5 units (kill-switch leg reproduces the
bug) · suite 1340 · live EURO 52 series hits/0 false rejects (live suppression not reachable — app data
horizon caps EURO scrub ~168h before the boundary).

## 4. THE CLUSTER IS COMPLETE — every marine warm-commit path is covering-safe
A 6-path code-only audit workflow + Sources 1/2/3 + #11 together close the non-covering-commit (floating-
rectangle) class:
- Source 1 scrub-cache commit-point ✓ · Source 2 cooldown ✓ · Source 3 series choke ✓ · #11 refeed
  (live-verified) ✓.
- **Core.js:687 recoveryGrid** — global-width + empty/non-renderable placeholder (audit: cannot paint).
- **useMarineOrchestrator.js:450 cachedNow** — local coverage gate (gridWidth≥340 OR contained&&!zoomedOut);
  :594 = regionalValidInPlace (both audit-safe).
- **Source 5 lanes A/B** (useMarineOrchestrator.js:628 / scrubCache.js:263) — audit-confirmed UNREACHABLE
  in prod: they live in the `!isBackendActive` else-branch, and GFS/ICON/EURO backend flags all default
  true → isBackendActive always true. Skip.
- Kill family: `__RAW_DISABLE_MARINE_WARM_COVERAGE__` (master) + per-source switches.
- **#13 Ecuador**: a DIFFERENT (rating/stash) mechanism (handoff EVE §12, `968f428b`) — distinct from this
  coverage cluster, unaffected.

**LESSON (recorded):** the code-only audit wrongly cleared Source 3 as "covers-by-construction" — it assumed
getMarineSeriesFrame checks the SERVED frame's bounds; it checks entry.bounds. The EMPIRICAL backend probe
caught the heterogeneity pure code-reading missed. Forensics = probe the real data, not only read the code.

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
