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

## 4b. ✅ THE ABACO FLOODING PROTECTION SURVIVES THE FIX — with a working positive control

The risk this fix carried: the re-assert exists to stop the ocean-white pass flooding small islands
the basemap drops, so narrowing its gate could have reintroduced that. Metric = share of basemap-LAND
samples whose pixel looks more like the FIELD than like its OWN waves-OFF colour (comparing each
pixel to itself is what makes it immune to the landuse restyle the Waves toggle causes).

| camera | mode | stock (gate 400) | re-assert OFF | verdict |
|---|---|---|---|---|
| **bahamas z6.5** | `dense_base_min_combine` | **0 %** | **9.4 %** | ✅ **protection intact** |
| bahamas z7.5 | `off` | 2.8 % | 3.7 % | control did not fire — NULL |
| abaco z8.2 | `midcarve_replace` | 1.3 % | 2.5 % | control did not fire — NULL |
| abaco z9 | `midcarve_replace` | 5.2 % | 4.9 % | control did not fire — NULL |
| abaco z9.6 | `midcarve_replace` | 3.7 % | 3.4 % | control did not fire — NULL |

⇒ **z6.5 is the only camera where the control actually floods, and there the shipped gate takes
9.4 % → 0 %.** That is the Abaco mechanism, exercised and preserved.

★ **The four nulls are reported as nulls, not as passes.** At those cameras the re-assert is inert in
EVERY leg including the pre-fix gate, so this change cannot have regressed them — but a 1.3 % with a
dead control proves nothing, and the harness says so in its own output rather than letting the low
number read as a win. ⚠️ Finding the one camera that exercises the mechanism took a deliberate move
to a WIDER span: density = mask_width / span, so the coarse regime the 205 px/deg forensics came from
does not exist at z9.

⚠️ **One leg is unreliable and is not attributed:** `gate_1200` at z6.5 read 36.5 %, worse than
disabling the re-assert entirely — but it ran in `coverage_gap` while the other two ran in
`dense_base_min_combine`. Different regime, so it is confounded, not evidence about the gate. Same
regime-drift that produced two contradictory lever sweeps earlier in this arc.

## 5. ⚠️ What is NOT fixed

- **Bearing 255° — REAL, but 16 px PERPENDICULAR rather than the 28 px the ray metric reported**
  (32.69350, −17.12638). Every onset in this arc was measured along a ray cast from the island
  centroid, which is a perpendicular distance divided by `cos(angle between ray and coast normal)`.
  Measuring along the LOCAL COAST NORMAL instead (`frontend/scripts/coast-normal-onset.js`, normal
  estimated from a ring of basemap-water truth):

  | probe | ray-onset | **normal-onset** | obliquity |
  |---|---|---|---|
  | residual 255° | 28 px | **16 px** | 35° |
  | repaired 75° | 55 px *(pre-fix)* | **0 px** | 67.5° |
  | clean 285° | 0 px | **4 px** | 0° |

  ⇒ obliquity inflated 255° by ~1.75× **without creating it**. Against the 4 px read at a clean
  bearing — the noise floor of antialiasing plus ring-estimate error — 16 px is ~4× baseline: real,
  modest, and moved by none of the levers (re-assert, midcarve, blend-both, crests).
  **Cause unidentified. Not worth an eleventh hypothesis in the same session.**

  ★ The same probe reads **0 px at bearing 75°**, which confirms the re-assert fix a THIRD way and
  proves the instrument can report zero. Without that control the "16" would be unreadable.

  ⚠️ **That script's first verdict column was WRONG and is corrected in place.** It compared each
  probe's STALE PRE-FIX ray onset against a FRESH normal measurement, so it labelled the repaired
  75° "consistent with obliquity" (its 55 px no longer exists) and called 4 px of noise "REAL along
  the normal too". The raw measurements were sound throughout; only the labels were not.
  **A verdict is only as good as the vintage of BOTH numbers it compares.**
- The earlier `midcarve REPLACE` change (`7b6fc77d`, ~10%) stays; it is independent and kill-switched.
- ✅ Deployed verification is DONE — §4a. (This bullet previously read "not yet verified"; §4a
  superseded it and the stale line is corrected rather than left to contradict the section above it.)
