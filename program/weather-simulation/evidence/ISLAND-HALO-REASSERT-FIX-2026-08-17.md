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

## 4a. ✅ VERIFIED ON THE DEPLOYED BUILD `050f19b3`, with a working positive control

| leg | visible band (waves on) | onset median | bearing 75° |
|---|---|---|---|
| **stock — the fix (gate 400)** | **2 px** (= the waves-OFF baseline) | **0 px** | gone |
| `MAX_DENSITY = 1200` | 2 px | 0 px | gone |
| **`MAX_DENSITY = 100000`** (forced on) | **17 px** | **5 px** | **55 px** |

Forcing the re-assert on restores the halo exactly, including the signature 75° bearing at 55 px
(original: 57 / 55). **The lever discriminates on this build, so this is a within-build verification,
not a cross-build inference.**

⭐ **THE LEG THAT DID NOT REVERSE IS THE MOST INFORMATIVE ONE.** Gate 1200 no longer re-enables the
halo while 100000 does, so the overlay's density lies BETWEEN them — above the ~850 estimated from a
2048 canvas, i.e. the 4096 tier was selected. That puts the old threshold of 1200 right at the
density: **the pre-fix gate was MARGINAL, engaging on some paints and not others depending on which
canvas tier the span picked.** That is why the halo was intermittent and "slightly" visible rather
than constant, and it is the argument for 400 rather than a value just under 1200 — the fix must sit
clear of the boundary, not next to it.

⚠️ Two identical legs (stock vs 1200) would have read as "the fix does nothing" without the forced-on
control. **A null A/B needs a positive control before it means anything** — the third time that rule
paid out in this arc.

## 5. ⚠️ What is NOT fixed

- **Bearing 255° @ 28 px is UNCHANGED in all three legs** (32.69350, −17.12638). A separate, smaller
  residual with a different cause. One bearing of 24.
- The earlier `midcarve REPLACE` change (`7b6fc77d`, ~10%) stays; it is independent and kill-switched.
- ✅ Deployed verification is DONE — §4a. (This bullet previously read "not yet verified"; §4a
  superseded it and the stale line is corrected rather than left to contradict the section above it.)
