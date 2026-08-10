# V3 — Re-verification of commit `0bf6278e` (observability batch)

**Scope.** Hostile re-derivation of the four fixes in `0bf6278e`
("live accessors, evolutionTicks, listener leak, land-fetch dedup"), plus the claimed revert of the
`openMeteoProtocol` half. Baseline `9f4f8570`, HEAD `d1b40987`. Read-only; nothing outside
`audit/weather-simulation-11.0/evidence/` was written.

**Headline.** Three of the four fixes are correct as code. One claim in the commit message is
overstated, one comment documents an incomplete fix as complete, and — measured, not inferred —
**all four fixes have 0% test coverage on the exact lines they changed**, including the one file
that already ships a test suite named for that precise defect class.

---

## 1. Are `__SIM_DIAGNOSTICS__` / `__GPU_DISPATCHER__` / `__FCE_*` accessors now?

**CODE FACT — yes, all four.** `frontend/src/components/map/useMapDebugTools.js:54-60` routes every
one through `defineLive` (`:21-25`), which calls
`Object.defineProperty(window, name, { configurable: true, enumerable: true, get: read })`.
The four plain assignments that existed at `9f4f8570` are gone.

### 1a. Is the `try/catch` swallow in `defineLive` reachable?

**CODE FACT — not from this tree.** A non-configurable prior definition is the only way to reach it.
Repo-wide grep for `defineProperty(window`, `defineProperties(window`, `Object.freeze(window)`
returns exactly two hits: `deviceTier.windRes.test.js:10` (targets `window.navigator`, unrelated) and
`useMapDebugTools.js:23` itself, which sets `configurable: true`. Plain `window.x = v` assignments
create configurable properties, so even the pre-fix state redefines cleanly. React StrictMode
double-invocation and effect re-runs are therefore safe.

**LOOSE END (Low).** The catch is *silent* — no `console.warn`, no `__DIAG_INSTALL_FAILED__` flag.
The one realistic way to reach it is an engineer typing
`Object.defineProperty(window,'__SIM_DIAGNOSTICS__',{value:x})` in DevTools while debugging
(`defineProperty` defaults `configurable` to **false**). That is exactly the population this fix
serves, and if it happens the global silently reverts to the stale-snapshot behaviour being fixed,
with no way to tell from the page.

### 1b. Does anything else assign those globals (replacing the accessor with a value)?

**CODE FACT — no.** Repo-wide grep for the four names returns only `useMapDebugTools.js` plus
markdown (audit/docs). No `src`, `e2e`, or test file assigns them. Note the accessors are
**getter-only**: any future `window.__FCE_FIELD__ = x` from an ES module (strict mode) would throw
`TypeError` rather than silently re-snapshot — a fail-loud property, which is good.

### 1c. Side effects of `enumerable: true` getters on `window`

**CODE FACT — none reachable.** Grep for `Object.keys(window)`, `for (… in window)`,
`{...window}`, `getOwnPropertyNames(window)` across `frontend/src`: **no matches**. Nothing
enumerates `window`, so making these enumerable getters invokes no accessor unexpectedly.
`getDispatcherDiagnostics` (`RenderPlanDispatcher.js:769-777`) is a pure object literal over
module-level `let`s and cannot throw, so the missing `try/catch` on the `__GPU_DISPATCHER__` getter
(`useMapDebugTools.js:57`, vs. the guarded `:54-56`) is harmless in practice.

### 1d. ⚠ The commit's proof statement is OVERSTATED

The commit message asserts: *"each read constructs a fresh object and deep-equals the live module,
so a stale snapshot is structurally impossible."*

That is true for `__SIM_DIAGNOSTICS__` and `__GPU_DISPATCHER__` only. It is **false for the other
two**:

* `useMapDebugTools.js:59-60` — `__FCE_FIELD__` / `__FCE_DIAGNOSTICS__` return `ref.current`. They
  construct nothing and read no module. They are still **snapshots**, merely per-*render* instead of
  per-*effect*, and they carry **no timestamp**. By the rule the same file states at `:15-17`
  ("must either be live or carry its own timestamp"), these two satisfy neither. The in-file comment
  at `:39-40` is honest ("as fresh as the last render"); the commit message is not.
* `useMapDebugTools.js:55` — `try { return getSimDiagnostics(); } catch (e) { return simDiagRef.current; }`.
  The fallback is *precisely* the stale React-prop snapshot the fix removed, returned **silently**
  with no marker. `getSimDiagnostics` (`SimulationLoop.js:393-407`) does `_simTime.toFixed(2)` and
  `_windParticles.getCount()`, both of which are throwable in principle. If it ever throws, the
  instrument reverts to lying and nothing says so.

Practical impact is low — in the shipped map path the two FCE globals read `null` /
`{populated:false}` anyway (`MASTER_WEATHER_SIMULATION_REPORT_11.0.md:75-76`) — but the *claim*
does not hold as written.

---

## 2. Does importing `getSimDiagnostics` into `components/map` create an import cycle?

**NO CYCLE. Proven by graph, not by eyeball.** A static import crawler over all 1,0xx JS/JSX files
in `frontend/src` (relative specifiers resolved through `.js/.jsx/.ts/.tsx/index.js`) gives:

```
[SimulationLoop]        static transitive closure = 10 modules
                        reaches useMapDebugTools.js ?  False
                        reaches components/* ?         RenderPlanDispatcher only, and it is NOT
                                                       in SimulationLoop's closure
[RenderPlanDispatcher]  static transitive closure = 13 modules
                        reaches useMapDebugTools.js ?  False
[useMapDebugTools]      static transitive closure = 14 modules
                        static cycles reachable      = 1  (see below)
```

`SimulationLoop.js` imports: `particle-system`, `render-orchestrator`, `FieldCompositionEngine`,
`SimulationField`, `FieldEvolutionEngine`, `SimulationHealthMonitor`, `PerformanceBudget`. None is a
component. There are **no runtime dynamic imports** in `engine/` — every `import(` hit is a JSDoc
`@param {import('./X').Y}` type reference.

**The stronger argument:** `SimulationLoop` was *already* in `useMapDebugTools`'s transitive graph at
`9f4f8570`. Line 2 (`import { getDispatcherDiagnostics } from '../../engine/RenderPlanDispatcher'`)
is unchanged by this commit, and `RenderPlanDispatcher.js:22` does
`import { onRenderPlan } from './SimulationLoop'`. The new line 3 adds **zero** modules to the bundle
and **zero** new edges into a cycle — it only shortens an edge that already existed.

**Pre-existing, unchanged, not introduced here:** there is one real static cycle in the closure —
`engine/SimulationLoop.js → engine/SimulationHealthMonitor.js → engine/SimulationLoop.js`
(`SimulationHealthMonitor.js:20` imports `onRenderPlan`). Byte-identical import line at `9f4f8570`.
Recorded so it is not mistaken for fallout from this commit.

---

## 3. `_evolutionTicks++` moved inside the `shouldEvolve` guard

**CODE FACT.** `SimulationLoop.js:223-233` — the increment now sits inside `if (shouldEvolve)`,
immediately after `evolveField(...)`.

**Consumer census — 3 read sites, none depends on it advancing when evolution is skipped:**

| site | use | affected by the move? |
|---|---|---|
| `SimulationLoop.js:298` | `_renderPlan.evolutionTicks` | no consumer found — grep for `.evolutionTicks` outside `engine/` returns nothing rendered |
| `SimulationLoop.js:313` | `getEvolutionDiagnostics(field, { evolutionTicks })` | **improves**: `FieldEvolutionEngine.js:428-429` computes `evolved = inSandbox && evolutionTicks > 0`. Outside the sandbox `inSandbox` is already false, so the AND short-circuits either way — the move makes the input honest instead of relying on the downstream AND |
| `SimulationLoop.js:398` | `getSimDiagnostics().evolutionTicks` | this is the number that read **304 while `evolveField` ran zero times**; now reads 0 |

The only UI consumer of the evolution block is `TruthOverlay.js:260-261`, which reads
`renderPlan?.evolution?.mode` — **`mode`, not `ticks`** — and `mode` is derived from `inSandbox`
alone (`FieldEvolutionEngine.js:433`). Nothing regresses.

**Test run (read-only):**

```
$ npx craco test --watchAll=false --testPathPattern="evolutionDiagnostics"
PASS src/__tests__/evolutionDiagnostics.test.js
  √ returns no_field for a null field
  √ reports disabled_forecast_authoritative + evolved:false in normal map mode
  √ reports sandbox_active + evolved:true once evolution ticks have run in the sandbox
  √ reports evolved:false in the sandbox before any evolution tick
Test Suites: 1 passed  Tests: 4 passed
```

⚠ **That test proves nothing about this fix.** It calls `getEvolutionDiagnostics` directly and
*passes `evolutionTicks` in as an argument* (`:29, :36, :43`). It never executes `simulationTick`.
See §6.

---

## 4. `marineGridSeries` abort-listener balance

**CODE FACT — census of `marineGridSeries.js`:**

| line | op | function |
|---|---|---|
| `115` | add (`{once:true}`) | `acquireSeriesSlot` — on `localController.signal` (**ephemeral, per-request**), not the caller signal. No leak; not the defect. |
| `421` | **add** | `loadSeriesPage`, on the **long-lived caller signal** |
| `429` | **remove** | `loadSeriesPage` — the queued-drop early return ← **the fix** |
| `526` | **remove** | `loadSeriesPage` `finally` |
| `567` | add | `loadSeriesHour0`, caller signal |
| `597` | remove | `loadSeriesHour0` `finally` |

**Every exit path of `loadSeriesPage`'s inner IIFE (`:423-528`) is covered.** The `addEventListener`
is at `:421`, immediately before the IIFE; there is no code between them that can exit. Inside the
IIFE there are exactly two ways out:

1. `:427-431` — `if (!gotSlot || localController.signal.aborted) { … return; }` — now removes at `:429`.
2. everything from `:432` onward is inside `try { … } finally { … }` (`:433-527`) — removes at `:526`.
   Every `return` inside that try (`:441`, `:461`, `:470`) and every throw runs the `finally`.

**DOUBLE-REMOVE: not possible, and harmless if it were.** The early return at `:430` exits the async
function *before* entering the `try` at `:433`, so the `finally` never runs on that path — the two
removals are mutually exclusive. Independently: **`removeEventListener` is idempotent** by DOM spec
(removing a callback that is not in the listener list is a no-op, never an error), and
`addEventListener` de-duplicates on the `(type, callback, capture)` triple, so neither a double-remove
nor a double-add could corrupt the count. Both removals are additionally wrapped in
`try { … } catch { /* ignore */ }`.

The path is genuinely reachable in production: `prewarmMarineSeries` fires many pages against a
2-slot semaphore (`MARINE_SERIES_MAX_CONCURRENT = 2`, `:104`), and the caller signal is aborted from
a React effect cleanup (`useMarineOrchestrator.js:864, :903`) on every model/layer/map change.

**NOT MEASURED:** the commit's browser census ("10 added / 0 removed over 4 toggle cycles" → "3 add /
3 remove") was not re-run here — that needs a live page. The code-level balance above is what I can
prove.

### 4a. ⚠ The new comment documents an incomplete fix as complete

`marineGridSeries.js:429` ends with: *"Do NOT move the acquire into the try (finally would
over-release the slot)."* That is correct **only for the `!gotSlot` half** of the branch. It omits
the other half, which has the opposite defect:

`acquireSeriesSlot` increments `_seriesActiveLoads` **before** resolving `true` on both of its
success paths (`:109` fast path, `:129` queued hand-off). So `gotSlot === true` ⟺ **a slot is held**.
The branch condition is `!gotSlot || localController.signal.aborted` — when `gotSlot` is `true` and
the signal aborted, the function returns at `:430` **without ever calling `releaseSeriesSlot()`**.
That slot is leaked permanently; two such events would deadlock all marine series loading
(`_seriesActiveLoads` pinned at 2, `releaseSeriesSlot` never reached to drain `_seriesWaiters`).

Reachability requires the abort to land after `resolve(true)` is queued but before the awaiting
continuation runs — a microtask-width window, but the code explicitly tests for it, so the author
believed it reachable. `releaseSeriesSlot` is itself called from a `finally` inside a promise
continuation, and `loadSeriesPage:504` dispatches a **synchronous** `window.dispatchEvent` from
inside the same microtask chain, which gives a listener a place to abort the caller controller.

* **CODE FACT:** the branch releases no slot when `gotSlot` is true.
* **CONSEQUENCE (reasoned, NOT MEASURED):** a permanent semaphore leak on that interleaving.
* **PRE-EXISTING:** verified byte-for-byte at `9f4f8570` (the baseline block is identical apart from
  the absent `:429` removal). Not a regression from `0bf6278e`.
* **The auditable delta:** the fix touched this exact branch and left the release missing, and the
  new comment gives a rationale that would steer the next reader away from adding it. The correct
  shape is a targeted `if (gotSlot) releaseSeriesSlot();` in the branch — not moving the acquire.

---

## 5. `OceanMask` → `getSharedLandGeoJSON()`: does failure behave differently?

**The fallback chain still works. Two things changed on failure, both against the commit's own thesis.**

Old (`9f4f8570`, `OceanMask.js:255-257`): `fetch('/ne_50m_land.json')`, `throw new Error("Status N")`
on `!r.ok`, caught at `:264`, falls through to step 2 (local 110m, `:271`) then step 3 (10m CDN,
`:287`).

New (`OceanMask.js:256-257`): `await getSharedLandGeoJSON()`, `throw` if falsy, same catch, same
steps 2 and 3. **Chain intact — nothing is swallowed that would have aborted the component.**

But `mapUtils.js:480-501` is not equivalent to the old bare fetch:

1. **An error that used to surface no longer does.** `mapUtils.js:493` —
   `.catch(() => fetch('/ne_110m_land.json').then(res => res.json()))`. A 50m failure that the shared
   loader silently recovers with 110m now produces **no warning at all**, and `OceanMask.js:261`
   then logs **`'[OceanMask] Loaded local 50m land: N land features'`** over data that is 110m. The
   old code would have `console.warn`ed the status and logged the honest
   `'Loaded local 110m land fallback'`. This is a silent, mislabelled resolution downgrade
   (110m coastline where 50m is claimed) in a commit whose thesis is that instruments must not lie.
   Also note `mapUtils.js:490` throws `new Error()` with **no message**, and the 110m fallback never
   checks `res.ok` — a 404 serving HTML surfaces as a `SyntaxError` from `res.json()` with the
   original 50m status discarded.
2. **The failed promise is memoised forever.** `window.__LAND_GEOJSON_PROMISE__` is never cleared on
   rejection. Its sibling `getSharedLandGeoJSONHiRes` explicitly does clear
   (`mapUtils.js:530-534`, *"Allow a later retry"*) — this one does not. After a total 50m+110m
   failure, every later caller (`OceanMask.js:256`, `WebGLMarineLayer.js:521`, `:603`) gets the same
   rejected promise for the life of the page. OceanMask still recovers via its own steps 2/3, so the
   mask is not lost, but `WebGLMarineLayer` has no such private fallback.

**The "3 → 2" claim holds as a code fact.** Grep for `ne_50m_land.json` across `frontend/src` now
returns exactly two fetch origins: `mapUtils.js:488` (the shared, cached loader) and
`openMeteoProtocol.js:184` (still private). The third — OceanMask's own — is gone.
**NOT MEASURED:** the in-browser network count was not re-run.

---

## 6. ⭐ MEASURED: all four fixes have 0% coverage on the lines they changed

Jest at HEAD `d1b40987` is fully green:

```
Test Suites: 209 passed, 209 total
Tests:       1928 passed, 1928 total
```

Coverage restricted to the four touched files
(`--coverageDirectory` pointed outside the repo; nothing written to the tree):

```
File                  | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
----------------------|---------|----------|---------|---------|------------------
  OceanMask.js        |    4.33 |     2.77 |       2 |    5.45 | 81-94,102-115,122-157,162-181,185-900
  marineGridSeries.js |   87.46 |    80.82 |      80 |    96.3 | 116-117,163,218-220,428-430,491-492
  useMapDebugTools.js |       0 |        0 |       0 |       0 | 22-180
  SimulationLoop.js   |   15.03 |        0 |       0 |   17.39 | 71-394
```

Line-by-line against the four fixes:

| fix | changed line | covered? |
|---|---|---|
| 1 — live accessors | `useMapDebugTools.js:21-60` | **NO** — 0% of everything; `22-180` uncovered. No test file in the repo imports `useMapDebugTools` (grep: only `MapWebGL.js:54`). |
| 2 — `_evolutionTicks++` | `SimulationLoop.js:232` | **NO** — inside the uncovered `71-394` span; 0% branches, 0% functions. The only test touching this module (`renderPlanBridge.publish.test.js:12`) **`jest.mock`s the entire module**, stubbing `getSimDiagnostics: () => ({})`. `simulationTick` is never executed by any test. |
| 3 — abort remove | `marineGridSeries.js:429` | **NO** — the uncovered list literally names `428-430`. |
| 4 — shared land loader | `OceanMask.js:256` | **NO** — inside the uncovered `185-900` span. |

**The sharpest version of this.** `frontend/src/components/map/marineGridSeries.leak.test.js`
already exists, is 75 lines long, and its header docblock describes *this exact defect class*
("registered `signal.addEventListener('abort', …)` on the LONG-LIVED caller signal … but never
removed it"). It still does not reach the fixed line, because its `makeTrackedSignal()` (`:28-36`)
hard-codes `aborted: false` and never dispatches `abort`, and its three cases run **one or six
sequential awaited loads** — so `acquireSeriesSlot` always takes the fast path at `:109`, always
returns `true`, and the `:427-431` queued-drop branch is **never entered**. Coverage confirms it:
`428-430` uncovered.

Consequence: **reverting `marineGridSeries.js:429` today would leave all 1928 tests green.** Same for
the other three. The commit's `PROOF:` line is honest that the real evidence was browser
measurement — but the suite is a non-regression signal only, and the one suite an engineer would
reasonably trust here does not test the thing it is named for. This is the house rule verbatim:
*every one was caught by a COUNT, a CONTROL, a MUTATION or a WIDER RANGE — never by a green suite.*

---

## 7. `openMeteoProtocol` revert — confirmed byte-identical

```
base blob (9f4f8570):  78af96cde5ba061e9078709725312b1cdeb8fcdb
HEAD blob (d1b40987):  78af96cde5ba061e9078709725312b1cdeb8fcdb
working tree:          78af96cde5ba061e9078709725312b1cdeb8fcdb
.claude/worktrees/gracious-cannon-e4aed4/…: 78af96cde5ba061e9078709725312b1cdeb8fcdb
```

`git log --oneline 9f4f8570..d1b40987 -- frontend/src/components/map/openMeteoProtocol.js` → empty;
the file does not appear in `git diff --stat 9f4f8570 HEAD`. `wc -l` = **943**, matching the
grandfathered ratchet baseline cited in the commit message. **CLAIM HOLDS**, including in the
concurrent worktree (checked because concurrent sessions share this tree).

---

## 8. Lint (read-only)

```
$ npx eslint src/components/map/useMapDebugTools.js src/components/map/OceanMask.js \
             src/components/map/marineGridSeries.js src/engine/SimulationLoop.js
OceanMask.js       3:10  warning  'findMarineInsertionLayer' is defined but never used
SimulationLoop.js 27:86  warning  'onFieldReset' is defined but never used
SimulationLoop.js 28:10  warning  'recordFieldReset' is defined but never used
SimulationLoop.js 29:25  warning  'recordCompose' is defined but never used
✖ 4 problems (0 errors, 4 warnings)
```

**All four are pre-existing**, verified against `9f4f8570` (each identifier appears exactly once —
the import line — in both the baseline and HEAD blobs). The commit added no lint debt.

---

## Verdict table

| id | claim | verdict |
|---|---|---|
| V3-01 | the four globals are live accessors | **CLAIM HOLDS** |
| V3-02 | "a stale snapshot is structurally impossible" | **CLAIM OVERSTATED** — false for `__FCE_FIELD__`/`__FCE_DIAGNOSTICS__`; the `__SIM_DIAGNOSTICS__` catch silently restores the stale snapshot |
| V3-03 | `defineLive`'s catch is not a live hazard | **CLAIM HOLDS** (unreachable from the tree) — but the swallow is silent |
| V3-04 | no import cycle | **CLAIM HOLDS** (graph-proven; `SimulationLoop` was already transitively imported) |
| V3-05 | no consumer needs `evolutionTicks` when not evolving | **CLAIM HOLDS** |
| V3-06 | the tests are proof | **CLAIM OVERSTATED** — 0% coverage on all four changed lines; the named leak suite misses the fixed branch |
| V3-07 | both exit paths remove; no double-remove risk | **CLAIM HOLDS** |
| V3-08 | `:429` comment's rationale | **LOOSE END** — pre-existing slot leak on `gotSlot && aborted`, now mis-documented as intentional |
| V3-09 | OceanMask fallback chain unaffected | **CLAIM OVERSTATED** — chain intact, but a recovered 50m failure is now invisible and mislabelled "50m", and the failed shared promise is memoised with no reset |
| V3-10 | `openMeteoProtocol` reverted | **CLAIM HOLDS** (blob-identical in 4 locations) |
| V3-11 | land fetches 3 → 2 | **CLAIM HOLDS** as a code fact (browser count NOT re-measured) |

## Not measured / blocked

* No live-browser re-measurement: listener census (10/0 → 3/3), accessor freshness, `evolutionTicks`
  reading 0 on `/map`, land-fetch network count 3 → 2. All require a running dev server + page; the
  mandate is read-only and the app was not started.
* The `gotSlot && aborted` semaphore leak is reasoned from code, **not** reproduced.
* Mutation testing (reverting `:429` and re-running) was not performed — forbidden by the read-only
  rule. The coverage report is used instead, and it is dispositive: a line that is never executed
  cannot be asserted on.
