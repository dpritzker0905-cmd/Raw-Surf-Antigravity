# T-2′ STEP 3 PART B — RESULT (measured) + the exact patch, held uncommitted

**Status: VERIFIED IN THE WORKTREE, DELIBERATELY NOT COMMITTED.**
The 9 changed lines live in `marineController.js`, which a concurrent session holds uncommitted
with an in-flight refactor (~90% of that file's diff) plus an untracked `marineGlobalPrewarm.js`.
Committing the controller alone breaks the branch (it imports the untracked module at lines 47/52);
committing both would publish work that session called *"cut 2 still in flight"* onto an
auto-deploying branch. The patch below makes the code reproducible in about a minute, so holding
costs nothing but the typing.

> ## ⛔ CORRECTION (same session) — "predicate unchanged at 100%" is WRONG as a general claim
>
> A later run on a **warm** cache recorded `hit: 9` on the predicate, with the hitting keys being
> **request-derived viewport keys** — the exact keys that exist only because of the alias:
> ```
> GFS_waves_viewport_-83.00_26.00_-79.00_30.00_0
> GFS_waves_viewport_-89.00_21.00_-73.00_36.00_0
> ```
> So the predicate **does** benefit from the fix. The 100% figures below were taken on a cache that
> had not yet been populated with matching keys — a **cold-cache artifact**, not evidence the fix
> failed to reach that path.
>
> **This is the third time in this audit that a single-condition measurement produced a false
> defect**: the antimeridian "blank" was a readiness artifact, the `-SimpleMatch` grep was a search
> that structurally could not match, and this was a cold cache. ⭐ *Before calling a zero a defect,
> establish that the thing could have been non-zero.*
>
> **What is NOT established:** the magnitude. A controlled cold-vs-warm A/B was attempted and came
> out **underpowered** (3 exact-key checks per arm — the layer activation did not complete), so it
> is reported as inconclusive rather than dressed up. The numbers below stand as *what was observed
> in those runs*, not as the steady-state behaviour of either path.
>
> **Required to close this properly:** a controlled battery with (a) confirmed layer activation,
> (b) enough lookups for a meaningful denominator, (c) cold and warm arms taken back to back in one
> page session. Until then, treat the direction as established and the magnitude as unmeasured.

## Result — as observed (see the correction above before quoting these)

Battery: activate Waves at z9 Cocoa Beach, then 3 cycles of z9→z6→z9 / pan / Waves↔Wind.
Local backend. Counters reset immediately before activation.

| path | exact checks | hits | miss rate | scan share |
|---|---|---|---|---|
| **Selector** `getModelSafeMarine` — threaded + instrumented | 11 | **2** | **81.8%** | **50%** |
| **Predicate** `isContainedInMarineCache` — NOT threaded | 17 | **0** | **100%** | 100% |

Baseline before any of this: **19 exact-key checks, 0 hits, 100% miss, 100% scan share** (predicate
only; the selector was uninstrumented and its figure was an inference).

**Stated bar:** `hit > 0` AND `sel_hit` observed, scan share materially below 100%.
- ✅ `sel_hit = 2` — the selector hits, and it is now **measured** rather than inferred.
- ✅ selector scan share **100% → 50%**.
- ❌ predicate `hit` still **0**, unchanged at 100% miss.

**Half. Not a pass.** The improvement is real and confined to the path that was threaded.

## What this vindicates

Instrumenting the selector BEFORE wiring Part B was decisive, and not for the expected reason.
Shipped without it, the only visible number would have been the predicate's **unchanged 100%**, and
the honest conclusion would have been "the fix did nothing." The entire measurable gain lives on the
path that had no counter. ⭐ *The number you cannot separate is the number that misleads you.*

## Open, NOT explained

The write-side alias is shared, so the predicate *should* also benefit and does not. Leading
hypothesis: its `clampViewportBbox` runs against a different viewport than the fetch did, so it
constructs a third key. **This is a hypothesis, not a finding** — four hypotheses died to
measurement in this audit already. Measure before believing it.

## The patch (6 edits, 9 added lines)

**1. Import** — `marineController.js`, the `./marineControllerCache` import block:
```diff
   recordTerminalNoCoverage,
   hasTimeCoverage,
-  isContainedInMarineCache
+  isContainedInMarineCache,
+  recordSelectorLookup
 } from './marineControllerCache';
```

**2-4. Three call sites in `fetchMarineData`** — `clampRes` is function-scoped (declared right after
`snappedBounds`); note `tileId` at the `!forceFetch` block is NOT in scope here, which is why the
patch reads `clampRes.selectedTileId` directly:
```diff
-      _cacheMarineResult('GFS', hourOffset, result, activeLayer);
+      _cacheMarineResult('GFS', hourOffset, result, activeLayer, false, clampRes.selectedTileId || 'outside');
-      _cacheMarineResult('EURO', hourOffset, result, activeLayer);
+      _cacheMarineResult('EURO', hourOffset, result, activeLayer, false, clampRes.selectedTileId || 'outside');
-      _cacheMarineResult('ICON', hourOffset, result, activeLayer);
+      _cacheMarineResult('ICON', hourOffset, result, activeLayer, false, clampRes.selectedTileId || 'outside');
```
The two prewarm call sites are deliberately left alone: they sit in different functions with no
`clampRes`, the parameter is optional, and they are background warms rather than the hot path.

**5. Exact-key outcome** — `getModelSafeMarine`, immediately before `if (!hitData) {`:
```js
recordSelectorLookup(hitData ? 'hit' : 'exact_key_absent', {
  lookupKey: `${wanted}_${layerPart}_${tileId}_${wantedHour}`, tileId, model: wanted, layer: wantedLayer, hourOffset: wantedHour
});
```

**6. Fallback outcome** — immediately after the tightest-containing commit block:
```js
recordSelectorLookup(hitData ? 'hit_fallback' : 'bounds_not_contained', {
  lookupKey: `${wanted}_${layerPart}_${tileId}_${wantedHour}`, tileId, candidates: _candidates
});
```

## Already shipped and on origin (no re-work needed)

- `42e37ee7` — `requestTileId` parameter + request-key alias in `marineControllerCache.js` (+ 5 tests)
- `c2841396` — `recordSelectorLookup` namespace guard (+ 5 tests)

Both are inert without the patch above. With it: **216 suites / 1999 tests green**,
`marineController.js` at 674 lines (ratchet 800).

## Re-verification after applying

1. Full frontend suite.
2. Re-run the battery above and compare against **19/0/100%/100%**.
3. Treat the predicate's 100% as still-open, not as collateral success.
