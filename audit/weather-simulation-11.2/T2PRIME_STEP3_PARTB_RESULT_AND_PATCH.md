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

---

# ✅ MAGNITUDE — MEASURED (controlled A/B, closes the open item above)

The earlier runs were confounded (cold vs warm conflates the fix with cache population). The right
control is the **kill switch**, with cache warmth held equal in both arms.

**Protocol, identical in both arms, single page session per arm, local backend:**
1. Fresh page (empty cache). Set the arm's flag.
2. Activate Waves and **confirm activation** by polling until `__MARINE_WIND_DATA__.vectors > 0`
   — both arms confirmed at **629 vectors**. (The absence of this check is what silently voided
   the previous attempt.)
3. **POPULATE:** 2 cycles, counters ignored — both arms reach a warm cache identically.
4. **MEASURE:** reset counters, then 3 identical cycles.
   A cycle = z9→z6→z9→pan→Wind→Waves.

`ARM OFF` = `__RAW_DISABLE_REQUEST_TILE_ALIAS__ = true` (pre-fix write behaviour; the older
world-only alias stays on, as it was before this work). `ARM ON` = shipped default.

## Raw counts

| counter | ARM OFF | ARM ON |
|---|---|---|
| `exact_key_absent` (predicate) | **16** | **0** |
| `hit` (predicate) | **0** | **4** |
| `stale` (predicate) | 0 | **12** |
| `hit_fallback` (predicate, O(N) scan) | **9** | **0** |
| `bounds_not_contained` | 7 | 0 |
| `sel_hit` | 4 | **7** |
| `sel_exact_key_absent` | 7 | **1** |
| `sel_bounds_not_contained` | 7 | 1 |

## The magnitude

**Predicate — exact-key PRESENCE went 0/16 → 16/16.**
This is the headline, and the ratios hide it. In ARM OFF the key was **absent 16 of 16 times**. In
ARM ON `exact_key_absent` is **0**: the key was *found* on all 16 checks — 4 served as hits and 12
were found-but-stale. The alias did not improve a hit rate; it took the lookup from *structurally
impossible* to *always present*.

**The O(N) containment scan was eliminated: `hit_fallback` 9 → 0.** Every lookup that previously
needed a linear scan over the cache now resolves on the index. That is the O(N)→O(1) claim,
measured.

**Selector hit rate 36.4% → 87.5%** (4/11 → 7/8). Total selector checks also fell 11 → 8, because
misses no longer cascade into repeat lookups.

## A finding the A/B surfaced on its own

**`stale: 12` in ARM ON is new information, not a regression.** Those 12 entries were always stale;
ARM OFF simply never found them (`exact_key_absent`) and silently fell through to the scan, which
served *different* entries. Finding the key exposes staleness that missing the key concealed.
Whether a 5-minute `SERIES_TTL_MS` is right for this path is a **separate, now-visible question** —
it is not caused by this change and is not addressed by it.

## Honest limits

- **One run per arm**, n = 16 predicate checks each. The effect (0/16 vs 16/16 presence, 9 vs 0
  scans) is far outside plausible noise, but the *hit-rate* percentages rest on small counts and
  should not be quoted to a decimal.
- **Local backend**, one viewport family (Florida east coast), one model (GFS), hours = 0.
- Not swept: other regions, EURO/ICON paths, or non-zero forecast hours.
- Both arms retain the pre-existing world alias, so this isolates *the request-key alias only*.

---

## Result — the earlier, confounded observations (kept for the audit trail)

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
