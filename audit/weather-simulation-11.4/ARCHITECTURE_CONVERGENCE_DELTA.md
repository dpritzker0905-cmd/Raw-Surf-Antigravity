# ARCHITECTURE CONVERGENCE DELTA — Audit 11.4

| Responsibility | Pre-repair authority | Current runtime authority | Trend |
|---|---|---|---|
| Shelter classification | `classifySheltered` (pure) | `classifySheltered` (pure) — unchanged | Unchanged |
| Morphological close | inline block inside `suppressShelteredWater` | exported `_closeShelteredMask`, called from the same place | Unchanged (extracted, not relocated in the flow) |
| Shelter **verdict** | recomputed every call, no owner | **NEW: module-level LRU in `marineMaskShelter.js`** | **New authority added** |
| Basin verdict stash | `stashBasinVerdict` | `stashBasinVerdict` — untouched | Unchanged |
| Model / layer / forecast-time selection | elsewhere | elsewhere — untouched | Unchanged |
| Projection / OceanMask | elsewhere | elsewhere — untouched | Unchanged |
| Animation scheduling, workers, GPU resources | elsewhere | elsewhere — untouched | Unchanged |

## The one honest concern

This repair **adds a cache authority**. The audit standard is right to treat that as a cost, so it
should be priced rather than waved through.

**Mitigating, and verified:**

- It is *local*: module-scoped inside the only file that consumes it. No cross-module reads, no
  export of the cache itself, no global registry entry.
- It is *content-keyed*, not identity-keyed. It cannot serve a stale verdict for changed input
  without a 32-bit hash collision, because the key is derived from the input bytes themselves. This
  is the property that keeps it out of the classic "stale response wins" failure class.
- It is *bounded* (~2 MB) and the bound is test-pinned (mutation M6 is caught).
- It is *reversible at runtime* (kill switch), and the switch is test-pinned (M5 is caught).
- It **replaces nothing**. No second renderer, no second state owner for an existing quantity, no
  bypass, no transitional path. On a miss, the code is the pre-repair code.

**Not mitigating:**

- It is module state that survives component unmount and remount. Bounded, so it cannot accumulate,
  but no remount test exercises it.

**Trend verdict: Unchanged, with one bounded local addition.** The architecture is neither more
converged nor more duplicated. Nothing that had one authority now has two.
