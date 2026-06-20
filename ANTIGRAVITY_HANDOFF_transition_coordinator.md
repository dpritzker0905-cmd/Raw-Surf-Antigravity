# Antigravity Handoff — Marine Transition Coordinator Testing

**For:** Antigravity agent (Gemini Flash 3.5 driving)
**From:** Claude Opus 4.8
**Date:** 2026-06-19
**Repo:** `C:\Users\dprit\Raw-Surf`
**Branch:** `dev`
**Baseline commit:** `4ca20452` — *the implementation is already written, committed, and passing.* Your job is **testing and verification only.**

---

## 0. READ THIS FIRST — Rules you must follow

1. **DO NOT refactor or rewrite the production code.** It is done and committed. You only ADD tests and RUN them.
2. **DO NOT "fix" anything unless a test you wrote fails AND you have confirmed the failure is a real product bug.** If a test fails, first suspect your test, not the code.
3. **If you believe you found a real bug, STOP. Write a short note in a file called `ANTIGRAVITY_FINDINGS.md` describing: the test, the expected vs actual, and the file/line. Do not change production files.** A human will review.
4. **Run commands exactly as written.** Do not invent flags.
5. **Work in small steps.** Run the test after every file you add. Never write 5 test files then run once.
6. The list of "Known limitations" at the bottom are **NOT bugs.** Do not try to fix them or write failing tests for them.

---

## 1. What this feature is (1 paragraph)

The marine weather heatmap and the info box can switch model (GFS / EURO / ICON), layer (waves / swell_1 / swell_2 / wind_waves), and hour. While new data loads, old code could (a) let a stale network request end a newer transition, and (b) show old or wrong-source data labeled as the new selection. A new module `marineTransitionCoordinator.js` fixes this with a **generation** (a counter) that proves ownership: only the request that owns the current generation may end a transition. Your tests must prove these guarantees hold.

---

## 2. Setup — run these once

Open a terminal. All test commands run from the `frontend` folder.

```powershell
cd C:\Users\dprit\Raw-Surf\frontend
```

**To run a single test file (PowerShell):**
```powershell
$env:CI='true'; npx craco test src/__tests__/NAME.test.js --watchAll=false
```

**To run a single test file (bash / git-bash):**
```bash
CI=true npx craco test src/__tests__/NAME.test.js --watchAll=false
```

**To run the production build (must stay green):**
```powershell
$env:CI='true'; npx craco build
```
A passing build prints `Compiled successfully.` If it prints `Failed to compile`, you broke something — undo your last change.

---

## 3. The files involved (reference only — do not edit)

| File | Role |
|---|---|
| `frontend/src/components/map/marineTransitionCoordinator.js` | The coordinator module you are testing. |
| `frontend/src/components/map/useMarineWindData.js` | Decides what heatmap frame to show; holds last-good frame during transitions. |
| `frontend/src/components/map/useMarineOrchestrator.js` | Opens transitions on model/layer change. |
| `frontend/src/components/map/useMarineDataFetcher.js` | Network fetch; ends the transition it owns. |
| `frontend/src/components/map/MapForecastOverlay.js` | The info box; parity gate for fallback values. |
| `frontend/src/components/map/forecastCardCompiler.js` | Pure function that turns values into card rows. |

## 3a. Coordinator API (these are the functions to import in tests)

Import from `'../components/map/marineTransitionCoordinator'`:

| Function | Call it like | Returns / does |
|---|---|---|
| `beginTransition` | `beginTransition({ model:'GFS', layer:'waves', hour:0 })` | Returns a number (the generation). |
| `endTransition` | `endTransition(gen)` | Returns `true` only if `gen` is the current generation, else `false`. |
| `endCurrentTransition` | `endCurrentTransition()` | Ends whatever transition is current. |
| `isTransitioning` | `isTransitioning()` | `true`/`false`. |
| `getGeneration` | `getGeneration()` | current generation number. |
| `getTarget` | `getTarget()` | object `{gen, model, layer, hour, viewportKey, status}` or `null`. |
| `getDisplayed` | `getDisplayed()` | object `{model, layer, hour, viewportKey}` or `null`. |
| `markDisplayed` | `markDisplayed({model,layer,hour})` | records what is on screen. |
| `displayMatchesRequested` | `displayMatchesRequested({model,layer,hour})` | `true`/`false`. |
| `recordClear` | `recordClear('reason')` | pushes to `window.__MARINE_CLEAR_LOG__`. |
| `__resetForTests` | `__resetForTests()` | resets everything. **Call in `beforeEach`.** |

**CRITICAL:** Because this module keeps state between calls, EVERY test file that imports it MUST start with:
```js
beforeEach(() => { __resetForTests(); });
```

---

## 4. Existing tests — run them first to confirm a green baseline

```powershell
$env:CI='true'; npx craco test src/__tests__/marineTransitionCoordinator.test.js src/__tests__/useMarineWindData.transition.test.js src/__tests__/forecastCard.parity.test.js --watchAll=false
```
**Expected output ends with:** `Tests:       17 passed, 17 total`

If you do NOT see 17 passed, STOP and write the output into `ANTIGRAVITY_FINDINGS.md`. Do not continue.

---

## 5. TASK LIST — add these tests, one file at a time

For each task: create the file, write the test, run it, confirm green, then move on. Do not batch.

### TASK 1 — Coordinator: viewport key is captured
**File:** `frontend/src/__tests__/coordinator.viewport.test.js`
Write a test that:
1. calls `beginTransition({ model:'GFS', layer:'waves', hour:0, viewportKey:'vp-1' })`
2. asserts `getTarget().viewportKey === 'vp-1'`
3. calls `beginTransition({ model:'GFS', layer:'waves', hour:0, viewportKey:'vp-2' })` (same model+layer)
4. asserts `getTarget().viewportKey === 'vp-2'` and `getGeneration() === 1` (generation did NOT change).

### TASK 2 — Coordinator: clear log records the reason
**File:** `frontend/src/__tests__/coordinator.clearlog.test.js`
In `beforeEach`, also do `window.__MARINE_CLEAR_LOG__ = [];`
Write a test that:
1. calls `beginTransition({ model:'EURO', layer:'swell_1', hour:12 })`
2. calls `markDisplayed({ model:'GFS', layer:'waves', hour:9 })`
3. calls `recordClear('model_mismatch')`
4. asserts `window.__MARINE_CLEAR_LOG__.length === 1`
5. asserts the entry `.reason === 'model_mismatch'`, `.transitioning === true`, `.displayed.model === 'GFS'`, `.requested.model === 'EURO'`.

### TASK 3 — Coordinator: a non-owning generation cannot end a transition
**File:** `frontend/src/__tests__/coordinator.ownership.extra.test.js`
Write a test that:
1. `const a = beginTransition({ model:'GFS', layer:'waves' });`
2. `const b = beginTransition({ model:'ICON', layer:'waves' });`
3. asserts `endTransition(a) === false` (a is stale)
4. asserts `isTransitioning() === true`
5. asserts `getTarget().model === 'ICON'`
6. asserts `endTransition(b) === true`
7. asserts `isTransitioning() === false`.

### TASK 4 — Info box card: null marine height shows "Loading...", never a stale number
**File:** `frontend/src/__tests__/card.loading.extra.test.js`
Import `{ compileForecastCards }` from `'../components/map/forecastCardCompiler'`.
Copy the `baseProps` object from the existing file `src/__tests__/forecastCard.parity.test.js` (read it first to copy it exactly).
Write a test that:
1. calls `compileForecastCards({ ...baseProps, activeLayer:'swell_1', swell1Height:null, swell1Period:null, swell1Dir:null })`
2. finds the card whose `.label === 'Status'` OR `.label === 'Height'` (swell_1 uses a 'Status' row — inspect the returned array with `console.log` first to see the exact labels)
3. asserts that card's `.value` is a loading/placeholder string (e.g. contains `'Loading'`) and does NOT contain `'ft'`.

> Note for Task 4: swell_1/swell_2/wind_waves render slightly differently from waves. Run with a `console.log(JSON.stringify(cards, null, 2))` first to SEE the real labels and values, then write the assertion to match reality. Do not guess.

---

## 6. E2E / live-app verification (do this AFTER all unit tests are green)

This requires the running app. If you cannot start the app, SKIP this section and report that it was skipped.

### 6a. Start the app
```powershell
cd C:\Users\dprit\Raw-Surf\frontend
npm start
```
Wait until it says compiled, then open `http://localhost:3000` in a browser. Open DevTools → Console.

### 6b. Diagnostic globals you can read in the browser console
Type these in the console to inspect state at any moment:
- `window.__MARINE_TRANSITION_STATE__` → `{ gen, status, target:{model,layer,hour}, displayed:{model,layer,hour} }`
- `window.__MARINE_CLEAR_LOG__` → array of GPU clear events with reasons
- `window.__WEBGL_MARINE_CLEAR_COUNT__` → a number (how many times the heatmap was cleared)

### 6c. Test sequence 1 — layer switching keeps the heatmap visible
1. Select a marine model (GFS) and the `waves` layer. Wait for the heatmap to appear.
2. In the console, type `window.__WEBGL_MARINE_CLEAR_COUNT__` and write down the number (call it N).
3. Switch layer: waves → swell_1 → swell_2 → wind_waves, fairly quickly.
4. **PASS if:** the heatmap never goes fully blank between switches (there may be a brief "updating" but not a blank screen).
5. After it settles, type `window.__MARINE_TRANSITION_STATE__`. **PASS if** `.status === 'settled'` and `.displayed.layer` equals the layer currently selected in the UI.

### 6d. Test sequence 2 — model switching does not show wrong-model data
1. Select GFS / waves, wait for heatmap + info box values.
2. Switch model GFS → EURO → ICON.
3. While each switch is loading, look at the info box. **PASS if:** during loading it shows "Loading..." (or similar) OR keeps the previous values WITHOUT changing the model label to the new model prematurely. **FAIL if:** the info box shows a number but labels it as a model whose data has not loaded yet.
4. After settle: type `window.__MARINE_TRANSITION_STATE__`. **PASS if** `.displayed.model` equals the model selected in the UI.

### 6e. Test sequence 3 — no surprise heatmap clears during a normal switch
1. Note `window.__WEBGL_MARINE_CLEAR_COUNT__` before a GFS→EURO switch.
2. Do the switch, let it settle.
3. Check `window.__MARINE_CLEAR_LOG__`. **PASS if** every entry has a sensible `.reason` (one of: `unsupported_layer`, `non_renderable_terminal`, `model_mismatch`, `component_mismatch`, `layer_disabled`). There should be no clears with empty/undefined reasons.

Write the results of 6c–6e (PASS/FAIL for each, with the console values you observed) into `ANTIGRAVITY_FINDINGS.md`.

---

## 7. Final checklist — report this back

Create `ANTIGRAVITY_FINDINGS.md` with:
- [ ] Baseline 17 tests pass? (yes/no + the `Tests:` line)
- [ ] Task 1 test added and passing?
- [ ] Task 2 test added and passing?
- [ ] Task 3 test added and passing?
- [ ] Task 4 test added and passing? (include the labels you discovered)
- [ ] `npx craco build` still prints `Compiled successfully.`?
- [ ] E2E 6c result (PASS/FAIL + observed values)
- [ ] E2E 6d result
- [ ] E2E 6e result
- [ ] Any suspected real bugs (with file/line, expected vs actual). If none, say "none".

---

## 8. Known limitations — these are NOT bugs, do not test for or fix them

1. **`viewportKey` is captured but not compared.** `displayMatchesRequested` only checks model + layer + hour, not viewport. A pan during a transition will not break parity. This is intentional for now.
2. **A transition that never finishes (endless network retries) holds the old frame indefinitely.** This matches the prior behavior; it is not in scope.
3. **The FPS / performance (OceanMask) work is deferred.** Do not test or touch it.
4. **The data provenance matrix (is the data real/estimated/stale) is a separate task.** Out of scope here.
5. **`window.__MARINE_FETCH_PENDING__` and `window.__MARINE_FETCH_DEBOUNCING__`** are managed by the fetcher, not the coordinator. Do not assert the coordinator controls them.

---

## 9. If you get stuck

- A test won't import the module → check the relative path: from `src/__tests__/` it is `'../components/map/marineTransitionCoordinator'`.
- State leaks between tests → you forgot `beforeEach(() => { __resetForTests(); })`.
- The build fails after you added a test → tests never break the build; you probably edited a production file by mistake. Run `git status`, and `git checkout -- <file>` to undo changes to any file that is NOT in `src/__tests__/`.
- You are unsure whether something is a bug → it is probably a Known Limitation (section 8). When in doubt, write it in `ANTIGRAVITY_FINDINGS.md` instead of changing code.
