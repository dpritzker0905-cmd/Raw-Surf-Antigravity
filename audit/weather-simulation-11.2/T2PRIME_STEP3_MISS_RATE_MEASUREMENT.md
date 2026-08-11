# T-2′ STEP 3 — CACHE-KEY MISS RATE, MEASURED

**Measured 2026-08-11**, after the concurrent session's cut-2 refactor landed (`origin/dev`
@ `1b447f44`, branch green). Local backend `127.0.0.1:8000`. Frontend `localhost:3007/map`.
Sequence: activate Waves at z9 Cocoa Beach, then 2+ cycles of zoom-out z9→z6→z9 / pan /
layer-switch Waves↔Wind — the "activation hot path" the MAR-01 note names.

## The number

| outcome | count |
|---|---|
| `hit` (exact key, O(1)) | **0** |
| `exact_key_absent` | 15 |
| `stale` | 4 |
| `hit_fallback` (O(N) containment scan) | 10 |
| `bounds_not_contained` (genuine miss) | 5 |

- **Exact-key checks: 19. Exact-key hits: 0. Miss rate: 100%.**
- **Lookups resolved from cache: 10. Resolved via the O(N) scan: 10 → 100%.**
- Cache held 41 logged lookups at the end.

**The O(1) index never hit once.** The per-model-hour cache is, in practice, a linear scan.

## Jacobian

| input | output | expected | observed |
|---|---|---|---|
| key-derivation side (write=response, read=request) | exact-key hit rate | high | **0%** — the two sides agree on nothing |
| `_aw >= 340` global alias (`marineControllerCache.js:209`) | fraction of traffic rescued | the desync | **0 of 19** — it covers only world-width grids; none of the measured traffic was one |
| containment scan | fraction of resolutions carried | a rare fallback | **100%** — it is the primary path |

∂(exact-key hit)/∂(everything measured) = **0**. The fast path contributes nothing; its cost is
paid (key construction, Map lookup, miss bookkeeping) and its benefit is never realised.

## Forensics — why, in the general case

Logged lookup keys are **request-derived, `clampViewportBbox`-snapped** viewport tiles:

```
GFS_waves_viewport_-89.00_21.00_-73.00_36.00_0     reason: exact_key_absent
GFS_waves_viewport_-82.25_26.75_-79.00_30.00_0     reason: exact_key_absent
```

The write key (`marineControllerCache.js:167-168`) is `data.tile_id || data.region_id || …` — the
**served** tile id. For a viewport product the backend returns its own snapped bbox
(e.g. `viewport_-80.00_24.00_-76.00_28.00`), which is a *different* rectangle from the one the
client asked for. The two strings can therefore never be equal.

**This generalises the MAR-01 finding.** That note diagnosed the desync for **world** grids and
patched it with the `_aw >= 340` alias. The same desync exists for **every viewport product**, and
the alias does not reach it — measured: 0 of 19 lookups were world-width.

⚠️ **Instrumentation scope, stated precisely.** All 9 `recordMarineCacheLookup` call sites live in
`isContainedInMarineCache` (`marineControllerCache.js:387-457`). **`getModelSafeMarine` — the actual
data selector, where the tightest-containing fix landed — is NOT instrumented.** These numbers
measure the "can we skip fetching?" predicate only. Both functions build the lookup key with the
identical `${model}_${layerPart}_${tileId}_${hourOffset}` template from the identical
request-derived `clampViewportBbox(...).selectedTileId`, so the desync mechanism is shared — but
that is an **inference**, not a measurement, and instrumenting the selector is itself a gap worth
closing.

## Consequence, and what it does NOT mean

**It is a performance defect, not a correctness one.** The containment scan is now deterministic
(tightest-containing, shipped in `516a7200`), so a scan-resolved lookup returns the *right* grid.
The cost is O(N) over the cache on the activation hot path instead of O(1).

## The fix this measurement specifies

Write the entry under the key the readers actually use. Every read derives its key from
`clampViewportBbox(viewport).selectedTileId`; the response-derived key is read by nobody. So
`_cacheMarineResult` should register the entry under a **request-derived alias** in addition to the
existing response key — generalising `:209` from "world grids only" to "always", which requires the
caller's `selectedTileId` to be threaded in (the signature currently has no request-side parameter).

**Blast radius:** `_cacheMarineResult` has 5+ call sites, and the concurrent session has
uncommitted work in `marineController.js` (4 of those call sites) plus an untracked
`marineGlobalPrewarm.js`. Not started for that reason.

**Acceptance criterion:** re-run this exact battery and require `hit > 0` with the
scan-resolved share falling materially below 100%.
