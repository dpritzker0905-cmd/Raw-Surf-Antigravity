# The island halo is the NE island re-assert — attributed, fixed, and validated pre-deploy

Separate file on purpose: `ISLAND-HALO-2026-08-17.md` has uncommitted edits from a CONCURRENT
SESSION (its §24). Appending there would sweep their in-progress work into someone else's commit —
the `aa305291` hazard. Cross-reference, don't merge.

---

## 1. The cause

**`reassertNeLand` multiplies coarse Natural Earth land back over the accurate basemap-derived mask**
(`mask * NE / 255`): NE land = 0 forces the mask to land whatever the basemap says. Where NE 10m's
generalized coastline bulges seaward of the real one, the marine field is carved off REAL water.
Worst on intricate coastline — which is exactly the NE-to-E cluster measured at Madeira.

## 2. The A/B, per bearing, on the deployed build (`6ce6a37b`)

| leg | visible band (waves on) | onset median | worst bearing |
|---|---|---|---|
| stock (gate 1200) | **15 px** | 5 px | **75° @ 57 px** |
| `__RAW_DISABLE_ISLAND_REASSERT__` | **3 px** | 0 px | 255° @ 28 px |
| **`MAX_DENSITY = 400`** (the fix) | **3 px** | 0 px | 255° @ 28 px |

Waves-OFF baseline is **2 px**, so 3 px is the coast returning to the basemap's own edge. The whole
NE-to-E cluster (45/60/75°) and the north (345/0°) collapse to zero.

★ **The candidate constant was A/B'd on the DEPLOYED build BEFORE any code change**, because the gate
was already window-overridable (`__RAW_ISLAND_REASSERT_MAX_DENSITY__`). Ship-then-measure was
avoidable here and was avoided.

## 3. Why 400, and why not simply disable it

The re-assert earned its place: the basemap's water polygons DROP small islands, which the
ocean-white pass then floods — forensics measured **Abaco 8–17% flooded at a z9 mask of 205 px/deg**,
re-assert → 0. That evidence stands and the fix keeps it.

★ **The gate was comparing the wrong pair.** It asked whether the MASK's texel is coarser than NE,
but what decides whether NE HELPS is whether the BASEMAP is coarser than NE. At 205 px/deg the mask
is coarse and NE genuinely adds detail; the viewport overlay runs at **~850 px/deg** (2048 canvas
over ~2.4°), where the basemap is far finer than NE 10m and NE only corrupts. 400 separates them:

| regime | density | gate 1200 | **gate 400** |
|---|---|---|---|
| world mask | ~11 px/deg | on | **on** |
| Abaco z9 (the justification) | 205 | on | **on** |
| viewport overlay (the halo) | ~850 | **on ← harmful** | **off** |
| dense regional base | ~1720 | off | off |

## 4. Shipped

`islandReassertEnabled(...)` — the gate extracted as a pure predicate so the threshold is testable
rather than inline; `ISLAND_REASSERT_MAX_DENSITY = 400`. Levers unchanged:
`__RAW_ISLAND_REASSERT_MAX_DENSITY__`, `__RAW_DISABLE_ISLAND_REASSERT__`.

**10 tests** pin the separation — the two densities either side of the threshold are real
measurements (205 Abaco, 850 overlay), not round numbers, so moving the threshold between them fails
a test. Plus boundary bracketing, both lever directions, NaN-override fallback, and unknown-density
fail-safe.

⚠️ **LOC:** the change would have grown `WebGLMarineEngine.js` past its grandfathered baseline
(3207 → 3254). Per this repo's rule the rationale was RELOCATED, not deleted: `computeMidCarveReplace`
and `computeMidZoomOverlayEngage` moved into a new `marineOverlayMode.js` (both are overlay-mode
decisions, so this is cohesion rather than a LOC dodge), re-exported by name so every importer and
test is untouched. Engine 3199 ≤ 3207. **147 suites / 1574 tests pass; ratchet `Regressed: 0`; lint
no new errors.**

## 5. ⚠️ What is NOT fixed

- **Bearing 255° @ 28 px is UNCHANGED in all three legs** (32.69350, −17.12638). A separate, smaller
  residual with a different cause. One bearing of 24.
- The earlier `midcarve REPLACE` change (`7b6fc77d`, ~10%) stays; it is independent and kill-switched.
- Not yet verified on a deployed build — but the exact constant WAS validated live via the window
  override (§2), which is stronger than the usual pre-deploy position.
