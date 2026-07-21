# HANDOFF 2026-07-21 — OPUS 4.8 TAKEOVER: wind delivery hop · marine cluster · flip gate

HEAD `537192d3` on `origin/dev` (verified pushed, tree clean). Suites at HEAD: frontend
**1300/1300**, backend **811 passed**. Companion evidence document:
`HANDOFF-2026-07-20-EVE-estimator-guard-and-queue-verifications.md` (§1-§13b — every claim
in this file carries its proof there). Task list #10-#14 carries the per-item dossiers.

## 0. BINDING RULES FOR THIS SESSION (the user's standing mandate — apply without being re-told)

1. **FORENSICS, NOT GUESSING.** Every root cause, fix, and "it works" claim needs an
   instrument, a probe, a counter, or a live measurement. This arc falsified THREE plausible
   hypotheses by instrument (clearBuffers, React batching as sole cause, ref-history churn
   guard) — a narrative that fits the log is not a root cause.
2. **JACOBIAN LENS.** Name the single highest-leverage variable before editing. The last three
   sessions' variables were, in order: the base-lane trigger predicate, React setState
   batching, and now the LAYER DELIVERY EFFECT (see §1).
3. **Study memory + this doc + recent commits BEFORE touching a subsystem.** `git log
   --oneline -30` and the memory index headline entries. The marine commit path and the wind
   engine are regression graveyards; the scars are load-bearing.
4. **Instrument-first on the minefield; every lever kill-switched + A/B.** Suite after every
   change; live verification on the rendered map, not only tests.
5. **THREE THEMES (light/dark/beach) × desktop AND mobile** for anything user-visible.
   Data-path changes are theme-neutral by construction but still get the three-theme
   ladder/zoomburst close-out. ARIA mandate on any touched UI element.
6. **Probes run ALONE. Hard-reload before judging (HMR lies). Hidden-tab rAF lies** —
   the Browser-pane tab renders foreground (~31 FPS) but confirm before any perf verdict.
7. **One change-set at a time, committed with its evidence, pushed, `git log origin/dev`
   verified.** Pathspec commits — the tree carries unrelated scratch.

## 1. IMMEDIATE TASK — #14's last hop: the wind LAYER DELIVERY EFFECT (small, fenced)

**State: everything up to the engine call is PROVEN working.** The `__WIND_BASE_LANE__`
counters (live, committed telemetry) returned `fires=5 committed=4 skipped=1 errors=0` on the
model-switch round-trip — the cold-start base lane fires on every activation and the world
grid COMMITS through the `commitWindData` choke every time. Yet the engine slots end
clip-primary (`_windData` = 26° clip, no `_windFine`), with matching fresh valid_times.
**Every fetch-side hypothesis is eliminated by count. The drop is in the ONE remaining hop:
the layer effect that consumes `windData` React state and calls `engine.setWindData`**
(WebGLWind layer component; find the consumer of `useWeatherEngine`'s `windData`).

Protocol (do not deviate; each step has a prior-session scar behind it):
1. Read the layer's windData→engine effect. Candidate drop mechanisms to check IN THE CODE
   before instrumenting: effect dedupe by revision/reference (windRevision semantics), a
   keepTrails/model-compare gate (`data.source` — see windGridModel's header comment), an
   early-return on bounds identity, a race where the deferred/base commit is superseded by
   the same-tick render of the clip state.
2. **⚠️ INSTRUMENT TRAP (cost a full session-hour):** the layer BINDS `engine.setWindData`
   at mount — property-wrapping `window.__WIND_ENGINE__.setWindData` later is provably blind
   (empty hook log while slots changed). Put a delivery counter INSIDE the layer effect
   (world-span vs clip, plus the branch taken), not on the engine method.
3. Reproduce with the established gate (60 s): :3011 `frontend-arb` server → /map →
   jumpTo([-85,-1], z5.5) → Wind ON → 8 s → EURO → 12 s → GFS → read
   `window.__WIND_BASE_LANE__` + your delivery counter + engine slots
   (`__WIND_ENGINE__._windData/_windFine` bounds spans).
4. Fix at the choke-point altitude (ONE function all paths call — never a distributed guard),
   kill-switched. Suite. Re-run the gate: **PASS = engine ends `_windData` span≥350 +
   `_windFine` = clip after the round-trip AND after a cold activation.**
5. Close-out: `probe_wind_zoomburst.js` toggle leg + staircase ladders in/out + three themes
   (`ZL_THEME=light|beach`, dark default) + both zoomout legs. Every zoomlab run ends with
   `node zoomlab-verdict.js <trace>`.

Shipped context you inherit (all kill-switched, do NOT re-derive): base lane widened+relaxed
(`__RAW_DISABLE_WIND_BASE_LANE_WIDE__`; 877→336 ms measured), BASE-FIRST v2 at the choke
(`__RAW_DISABLE_WIND_BASE_FIRST__`; fires only when `windGridsCompatible` guarantees overlay
filing; React same-tick setStates BATCH — the one-tick deferral in the choke is deliberate),
engine-tracking churn ref (cross-model commits evict the engine base), lane telemetry.
Engine semantics (WebGLWindEngine.js): PROMOTE (world over resident clip) and overlay filing
both REQUIRE `windGridsCompatible` — model (source||truthTag.model) + hour + valid_time
±180 min. `windGridIsGlobal` = span≥350 or coverage_scope global.

## 2. THEN, IN ORDER (dossiers in the task list + EVE handoff §11-§12)

- **#10 + #13 as ONE arc** (same supply geometry): marine warm-commit containment cluster.
  Scrub-cache zoomed-in containment (mirror `regionalValidInPlace`, useMarineOrchestrator
  :556), cooldownFallback sibling gates, series per-frame bounds re-check, plus the Ecuador
  rated-clip edge (band cover-fade at the stash interlude — mode-independent, guard-mode
  reproduced). MINEFIELD: rating ON+OFF legs, kill switch per lever, zoomlab staircase +
  scrub + pan_coverage with guard-mode controls (SETTLED_STEP at z7 hour scrubs is a KNOWN
  mode-independent content step — control before chasing).
- **#11**: reactivate_refeed + initial_onAdd coverage gates (small; toggle-off→pan→toggle-on
  live leg).
- **#12**: tooling follow-ups (vortex probe multi-leg median metric — do NOT transplant
  zoomclamp's TH_SUM=20 there, it is measured-WORSE in the frame-pair regime; zoomlab-diff
  1.6 margin; non-backend lanes).
- **ARBITER DEFAULT FLIP**: everything structural is green (37,268-sequence harness, teeth
  proven, live battery ×2 passes — EVE §10). Gated ONLY on the user's 8-item eye pass
  (checklist EVE §10). When they report clean: flip the default in `decideMarineCommit`,
  update the THREE arbiter test files' mode plumbing (Q1/guard legs must PIN guard mode via
  `__RAW_DISABLE_MARINE_ARBITER__` once the default flips — otherwise Q1 compares arbiter to
  itself), suite ×3, push. Never flip on the battery alone.

## 3. LANDMINES SPECIFIC TO WHAT YOU WILL TOUCH

- `commitWindData` choke: the ONLY place wind commit invariants live. Do not add gates at
  call sites (distributed guards leak — proven seven times in the 07-19 arc).
- React batching: any base+clip pair committed in one tick collapses; the deferral pattern
  in the choke is the shipped answer — reuse it, don't reinvent.
- `lastCommittedWindRef`/`lastGoodCoveringRef` are REFS deliberately (effect-local state
  blinded gates — 07-19 scar). `windWorldBaseRef` tracks the ENGINE, not history.
- Marine: `updateMarineGrid` closure is mount-stale (07-17 landmine); scrub-settle quarantine
  evidence within ~60 s of HMR; `ProductStore._product_cache` is class-level (backend).
- CI lanes: core 165 min / pilots 200 min budgets, cron drift ~3 h; estimator forensic line
  is `"ZERO blendable cells"` in cron logs — grep it if EURO far hours ever blank again.
- The deployed prod bundle auto-rotates on push (Netlify builds dev) — VERIFY-BUNDLE-FIRST
  before diagnosing any "still broken in prod" report.

## 4. WHERE EVERYTHING LIVES

- Evidence ledger: `HANDOFF-2026-07-20-EVE-estimator-guard-and-queue-verifications.md`
  §1-§13b. Memory index headline entries (07-20 EVE / EVE-2 / EVE sweep). Tasks #10-#14.
- Harness: `frontend-arb` launch config on :3011; zoomlab (`ZL_BASE`, `ZL_FLAGS`, `ZL_SURF`,
  `ZL_THEME`); the §13b hook protocol for wind activation order.
- Backend python: `AppData\Local\Python\bin\python3.exe` (system python broken). Git via
  PowerShell `git -C` (Bash git flaky).
- Kill switches this arc: `__RAW_DISABLE_WIND_BASE_LANE_WIDE__`, `__RAW_DISABLE_WIND_BASE_FIRST__`,
  `__RAW_DISABLE_MARINE_ARBITER__`/`__RAW_MARINE_ARBITER__`, `__RAW_DISABLE_RATING_GRACE__`.

The bar for every claim you make to the user: an instrument they could re-run. If you cannot
reproduce or measure it, say so — do not guess.
