# V2 -- RE-VERIFY of 1073f36f (triggerRepaint -> finally) and d1b40987 (un-gate staleness)

Auditor lane: hostile re-derivation. READ-ONLY. Baseline `9f4f8570`, HEAD `d1b40987`.
Everything below is either a CODE FACT (file:line, re-read at HEAD) or an explicitly labelled
CONSEQUENCE / NOT MEASURED. No browser was available in this lane, so every live-runtime number
quoted in the two commit messages is NOT MEASURED here.

---

## Q1 -- Is `map.triggerRepaint()` in a `finally` on BOTH layers, and does any early return now
##       wrongly get a repaint?

**ANSWER: YES to the first, NO to the second. The commit's claim holds exactly as written.**

CODE FACT -- the two `finally` blocks:
- `frontend/src/components/map/WebGLMarineCustomLayer.js:337-349` -- `} finally { ... map.triggerRepaint(); }` (call at :348)
- `frontend/src/components/map/WebGLWindLayer.js:180-190` -- same shape (call at :189)

CODE FACT -- EVERY `return` statement in each `render()`, with the position of the guarded `try`:

| layer | `try` opens | return sites | above the try? | gets a repaint? |
|---|---|---|---|---|
| Marine `render()` (:112-350) | **:322** | :167, :176, :291, :314 | all four YES | **NO** |
| Wind `render()` (:46-191) | **:122** | :116, :120 | both YES | **NO** |

There is **no `return` anywhere inside either `try`, `catch` or `finally`** (enumerated by scanning
lines 112-350 / 46-191 for `return`). Marine has a nested `try/catch` at :180-186 (viewport bounds)
and wind has three nested ones (:78-80, :128-152, :156-168) -- none contains a return, so none can
short-circuit into the outer `finally`.

Semantics of the four marine early returns, all of which correctly stay silent:
- `:156-167` `!activeRef.current || errorCount > 3` -- layer OFF or disabled. Must not repaint.
- `:176` `if (!map) return;` -- no map to repaint.
- `:291` regional grid rejected while NOT zooming/moving -- deliberately idle.
- `:314` zoomed out past `MARINE_ZOOMED_OUT_MAX_ZOOM` with a global product available -- deliberately idle.

Wind: `:107-116` (`!activeRef.current || errorCount > 5`) and `:120` (`!map`). Same shape.

VERDICT: **CLAIM HOLDS.** The commit message's line
*"Early returns above the try are untouched -- they intentionally stop the chain when the layer
should be idle, and must not start repainting"* is literally true of the code at HEAD.

---

## Q2 -- THE INFINITE-ERROR-LOOP QUESTION. Is `errorCount` ever RESET, and did the change make
##       it better or worse?

**ANSWER: `errorCount` IS reset -- and the change did NOT create a burn loop. It is
neutral-to-better. The reason is that the disable guard sits ABOVE the `try`, so a disabled layer
never reaches the `finally`.**

### The declarations and the resets (CODE FACT)

| | marine | wind |
|---|---|---|
| `let errorCount = 0` | `WebGLMarineCustomLayer.js:68` | `WebGLWindLayer.js:25` |
| `let lastErrorTime = 0` | `:75` | `:26` |
| RESET site | `:152-154` via `shouldResetErrorBurst(...)` | `:103-105` (inline, v3.15) |
| reset predicate | `:63-65` `errorCount > 0 && (now - lastErrorTime) > windowMs` (default **10000**) | same expression inline, 10000 |
| `lastErrorTime` re-stamped on catch | `:329` | `:173` |
| disable/log threshold | `errorCount === 3` -> `onErrorRef.current()` (`:333-336`) | `errorCount === 5` -> console.error only (`:177-179`) |
| **guard that stops rendering** | `:156` `errorCount > 3` -> return `:167` | `:107` `errorCount > 5` -> return `:116` |

### Why the loop is BOUNDED (derivation from the above; CONSEQUENCE, not measured)

1. The reset predicate needs **10 s since the LAST error**. Under a persistently throwing engine
   the catch re-stamps `lastErrorTime` on *every* frame (`:329` / `:173`), so `now - lastErrorTime`
   is one frame interval (~16 ms). **The reset can never fire mid-burst.** It is a burst decay, not
   an escape hatch.
2. The guard that stops the layer (`:156` / `:107`) is **above the `try`**, so once it trips the
   function returns at `:167` / `:116` and **the `finally` is never reached -- no repaint is
   issued.** The layer cannot drive its own next frame while disabled.
3. Therefore the self-driven throw burst is bounded at:
   - marine: **4 throwing frames** (log+`onError` at `=== 3`; the guard is `> 3`, so exactly one
     more throwing frame is admitted after the "disabling" message)
   - wind: **6 throwing frames** (log at `=== 5`, guard `> 5`)
4. Re-arming requires BOTH (a) an *external* repaint driver calling `render()` again and (b) >=10 s
   of quiet. The layer cannot supply (a) for itself.

**So: no 60 fps throw loop. The `finally` made `errorCount` reach its threshold deterministically
in 4/6 frames instead of depending on an unrelated repaint driver -- which is the stated goal.**

### What the commit did NOT say (real findings)

**(a) The twins are still asymmetric in the way that matters, and it is the more consequential half.**
Marine's catch calls `onErrorRef.current()` at `:335` -> `MapWebGL.js:504-507` `setWebglMarineFailed(true)`
-> the WebGL layer is unmounted and `MarineParticleCanvas` takes over (`MapWebGL.js:1038` vs `:1041`).
That is **terminal**: no ping-pong.
Wind's catch **never calls `onErrorRef`** -- the only call is in `onAdd` at `WebGLWindLayer.js:42` --
even though `onWindWebglError` exists (`MapWebGL.js:508-511`) and is wired at `:1079`. So a
permanently broken wind engine ping-pongs **forever**: <=6 throws + 5 `console.warn` + 1
`console.error` per 10 s, with **no Canvas2D fallback ever**.
This is PRE-EXISTING (v3.15), NOT introduced by `1073f36f`. But the commit's stated reason for
touching wind was *"fixing one would have left the pair to drift"* -- and the pair is still drifted,
on the disable/fallback axis rather than the repaint axis.

**(b) A new (low-probability) escape path was introduced and is not mentioned.**
Moving the call from `try` to `finally` means an exception thrown *by `map.triggerRepaint()` itself*
now propagates **out of `render()` into MapLibre's paint loop**, uncaught and uncounted. Before the
change it sat inside the `try` and was caught, counted, and would eventually disable the layer.
Same for a throw out of the catch block (`onErrorRef.current()` at marine `:335`): the `finally`
still runs, and if it throws it replaces that exception. `map` is null-checked (`:176` / `:120`) so
the common case is safe. Likelihood in production: NOT MEASURED (no browser in this lane).

**(c) The commit message overstates the wind half.** Headline: *"a throw in render() disarmed the
animation clock AND the fallback"*, applied to both layers. Wind's catch implements **no fallback**
-- only a log. The in-code comment is more careful (`WebGLWindLayer.js:185` says "retry path"), but
it says the retry path is *"below"* when the reset it refers to is **above**, at `:103-105`.

**(d) Zero automated test covers this change.** The only adjacent test is
`WebGLMarineCustomLayer.errorBurst.test.js`, which exercises the **pure predicate**
`shouldResetErrorBurst` plus two source-regex wiring assertions (`:62-66`). Nothing in the tree
invokes `render()`, the `finally`, or `triggerRepaint` on either layer (`grep -rl triggerRepaint`
over `*.test.js` returns one unrelated file). The evidence for `1073f36f` is entirely the live
browser A/B recorded in its message -- which this lane could not reproduce. NOT MEASURED.

---

## Q3 -- Is the EURO tail below the new branch BYTE-IDENTICAL to HEAD~1?

**ANSWER: YES, byte-for-byte.**

Method: `git show HEAD~1:frontend/src/components/map/forecastDiagnostics.js` -> temp file (252 lines).
Old tail = from its first `no_copernicus_coverage` line (old **:18**) to EOF.
New tail = HEAD file (283 lines) from **:49** to EOF.

```
cmp  -> identical
md5  6a55c9813fec24d1ccf5e79caa813755  tail_old.txt
md5  6a55c9813fec24d1ccf5e79caa813755  tail_new.txt
```

`diff -u` of the two whole files produces exactly **one hunk**, which ends at the
`no_copernicus_coverage` line. Nothing below it moved. **CLAIM HOLDS.**

---

## Q4 -- Does the new branch return null (not fall through)? Can `ready` leak?

**ANSWER: YES it returns null on every path; NO, `ready` cannot leak.**

CODE FACT `forecastDiagnostics.js:34-47`:
```js
const isEuroScoped = activeModel === 'EURO' && activeLayer !== 'waves';
if (!isEuroScoped) {
  if (... retained ...) return 'retained_stale_warning';
  if (... no_backend_coverage) return 'no_backend_coverage';
  if (... 413 ...)            return 'payload_too_large';
  if (... cooldown ...)       return 'rate_limited';
  return null;                          // <-- terminal, :46
}
```
Every branch returns and the block is terminated by `return null`. There is no fall-through edge
into the EURO tail. `'ready'` is produced at exactly one site, `:77`, inside the EURO-scoped tail,
reachable only when `activeModel === 'EURO' && activeLayer !== 'waves'`. **CLAIM HOLDS.**

**Independently re-verified the commit's supporting claim that `'ready'` is unreachable *anyway*.**
`:73-74` read `webglDiag.renderedVectorCount` and `webglDiag.renderedNonzeroCount`. A repo-wide grep
of `frontend/src` finds those two names at **only four sites, all READS**, all inside
`forecastDiagnostics.js` (`:73`, `:74`, `:241`, `:242`). The sole writer of
`window.__WebGLMarineLayer_DIAG__` is `WebGLMarineLayerDiag.js:94-137`, which builds
`backendGridVectorCount` / `webglSourceVectorCount` (`:114-115`, `:125-126`) and **replaces the whole
object at `:137`**; the module-load seed at `:10-25` does not contain them either. So
`isWebGLRendered` is permanently `false`. **CLAIM HOLDS -- verified, not taken on trust.**

**The un-gate does reach a rendered badge.** All four statuses the new branch can return have
`STATUS_RENDERS` entries (`forecastCardCompiler.js:20` rate_limited, `:22` retained_stale_warning,
`:23` payload_too_large, `:25` no_backend_coverage), consumed at `MapForecastOverlay.js:781-789`.
`'loading'` has no entry -- consistent with the commit's stated reason for scoping rather than
deleting the gate. Caveat, disclosed by the commit: the infobox returns null with no pin selected
(`MapForecastOverlay.js:648-650`), so the badge only reaches a user who has selected a spot/pin.

**FINDING -- the "no cry-wolf" control did not cover two of the four new arms.**
The commit's control was *"healthy producer -> 0/12 before AND after"*, i.e. it pinned
`window.__MARINE_HEATMAP_STATUS__` and perturbed only model x layer. But two of the four
model-agnostic arms do not read that producer at all:
- `:40` `window.__MARINE_FETCH_DIAG__?.httpStatus === 413`
- `:43` `window.__MARINE_FETCH_DIAG__?.cooldownState === 'rate_limited' || isInCooldown('marine')`

`isInCooldown('marine')` (`marineControllerUtils.js:171-177`) is a localStorage-persisted global set
by `enterCooldown` (`:179-196`) for **30-120 s adaptively** after any marine 429. Consequence
(CODE-DERIVED, not measured live): a marine 429 cooldown now paints **"Rate Limited (429 Cooldown)"**
on `GFS/waves` and `ICON/waves` -- the default cell -- where it previously showed nothing, and it
does so **regardless of whether the heatmap currently on screen is correct**. That is a new
disclosure surface the stated control never varied.

---

## Q5 -- MapForecastOverlay.js: <= 800 lines? dep added? `timeOffsetHours` really in scope?

- **Line count: exactly 800** (`wc -l`). Ratchet limit is 800 (`scripts/loc_ratchet.py`,
  `--max-lines` default 800). The file is now **at the ceiling with zero headroom**.
- **HEAD~1 was 799.** `git show HEAD~1:... | wc -l` -> 799. The diffstat is `3 +-` = 2 insertions,
  1 deletion = **net +1 line**. The commit message's *"Added timeOffsetHours to the memo deps,
  line-neutral"* is **false**; and *"MapForecastOverlay held at exactly 800/800"* describes the
  after-state as if it were the before-state. The change consumed the last free line under the
  ratchet.
  Mechanism worth naming: the +1 line is a **324-character single-line comment** at `:617` -- the
  rationale was folded onto one line to beat the ratchet. That is the documented
  "the LOC ratchet measures our documentation" pathology, reproduced.
- **The dep IS present:** `MapForecastOverlay.js:618-620`
  `}, [renderMarineData, activeModel, activeLayer, timeOffsetHours]);`
- **`timeOffsetHours` is a real prop, correctly in scope:** destructured in the component signature
  at `:41`, and used independently throughout (`:85`, `:91`, `:94`, `:124-125`, `:129`, `:483`,
  `:565`, `:598-599`, `:637`, ...). **No outer/undefined name was silently captured.**
- **eslint (read-only run at HEAD):** `MapForecastOverlay.js` -> 0 errors + exactly the 4 warnings
  the commit named (`useRef` :1, `selectExactPointHour` :10, `isGridLayerSupported` :20,
  `isInCooldown` :20 -- all `unused-imports/no-unused-imports`). `forecastDiagnostics.js` -> clean.
  **CLAIM HOLDS.** *But it is vacuous as evidence for a dep-array edit*: `eslint.config.js` sets
  **`"react-hooks/exhaustive-deps": "off"`**, so the only rule that could ever have flagged an
  unnecessary or missing dependency is disabled. The lint result carries zero information about the
  thing it was cited for.
- Incidental: `WebGLMarineCustomLayer.js` has **1 eslint ERROR** at `133:108` (`no-empty`). Verified
  byte-identical at baseline `9f4f8570` -- pre-existing, not introduced by `1073f36f`.

### FINDING -- the second gate is NARROWED, not CLOSED: the consumer reads the producer one dep-change late

- Producer: `WebGLMarineLayer.js:105` **`useEffect`**, deps `[timeOffsetHours, revision, active, activeModel]`
  (`:196`); writes `window.__MARINE_HEATMAP_STATUS__` at `:182-189`.
- Consumer: `MapForecastOverlay.js:618-620` **`useMemo`** -- render phase.

Both now key on `timeOffsetHours`, but a `useMemo` evaluates **during render** and a `useEffect`
runs **after commit**. On the hour scrub that both react to, the memo therefore reads the value the
producer wrote for the **previous** dep change. CONSEQUENCE:
- For the **sustained** defect the commit actually measured (a retained hour that persists -- the
  producer only clears the global on parity, `WebGLMarineLayer.js:190-195`), the flag is already set
  from an earlier run, so the badge **does** fire. The fix works for its target case.
- For the **leading edge** of a newly-stale hour whose `renderMarineData` does not change (which is
  precisely the retained case), the badge appears one dep-change late.
The commit asserts the gate is closed without this qualification.

### FINDING -- `computeHeatmapStatus` has no test at all

`grep -rn "computeHeatmapStatus" src --include=*.test.js` returns **nothing**. The commit cites
"149 suites / 1496 tests pass" as PROOF; that suite does not execute the changed function. The real
evidence for `d1b40987` is the live Jacobian in its message, which this lane could not re-run.
NOT MEASURED.

---

## Q6 -- `npx craco test --watchAll=false --testPathPattern="(map|forecast|marine)"`

Run at HEAD `d1b40987`, read-only, exit code **0**:

```
Test Suites: 143 passed, 143 total
Tests:       1450 passed, 1450 total
Snapshots:   0 total
Time:        29.517 s
Ran all test suites matching /(map|forecast|marine)/i.
```

`FAIL` line count: **0**. One non-fatal warning emitted after the summary:
*"A worker process has failed to exit gracefully and has been force exited"* (teardown/timer leak
warning, not a test failure).

Note the totals are lower than the 149/1496 quoted in `d1b40987` because this run is the
`(map|forecast|marine)` subset, not the full suite. Consistent, not contradictory.

---

## Bottom line

| # | question | verdict |
|---|---|---|
| 1 | `finally` on both layers; no early return repaints | **CLAIM HOLDS** |
| 2 | infinite error loop | **NO.** `errorCount` resets (marine :152-154 / wind :103-105) but only after 10 s of quiet, which a persistent throw prevents; the disable guard sits above the `try` so a disabled layer never repaints. Bounded at 4/6 throwing frames. Change is neutral-to-better. |
| 2b | new exposure | a throw from `triggerRepaint()` (or the catch) now escapes `render()` -- previously caught. LOW, NOT MEASURED. |
| 2c | pair "cannot drift" | **OVERSTATED** -- wind still never calls `onErrorRef` on a render error, so it never falls back to Canvas2D and ping-pongs indefinitely. Pre-existing. |
| 3 | EURO tail byte-identical | **CLAIM HOLDS** (md5 match) |
| 4 | new branch returns null; `ready` cannot leak | **CLAIM HOLDS**, and the supporting "ready is unreachable" claim independently verified |
| 4b | "no cry-wolf" control | **OVERSTATED** -- the cooldown/413 arms were never perturbed by the stated control |
| 5 | <= 800 lines, dep added, in scope | 800 exactly (was 799): **"line-neutral" is FALSE**. Dep present, prop real and in scope. |
| 5b | second gate "closed" | **OVERSTATED** -- render-phase memo vs commit-phase producer = lag-1 on the leading edge |
| 6 | scoped jest | 143 suites / 1450 tests, 0 failures, exit 0 |
