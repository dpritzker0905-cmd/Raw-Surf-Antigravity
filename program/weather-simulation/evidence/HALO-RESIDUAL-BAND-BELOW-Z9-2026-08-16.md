# The residual coastal band below z9 — attributed

**Owner report, 2026-08-16:** *"the land mask halo issue is still persisting around coast lines."*
**Proof-log entry:** `LAYER_ORDER_PROOF_LOG.json#LOP-0002` · **Ledger row:** `C4-MR-16`
**Surface:** `https://dev--rawsurf.netlify.app/map`, authenticated, build **`5117d4fc`**, real browser GPU.

---

## 1. The headline, stated plainly

**The buffer fix (LOP-0001) is live and working — and it is not the cause of what you are seeing
now.** `ocean-mask-buffer` measured `visibility: "none"` in every frame of this investigation.

What remains is a **second defect that removing the buffer exposed.** The buffer had been covering
it since 2026-07-05.

## 2. What was eliminated, by measurement

| candidate | lever | result |
|---|---|---|
| `ocean-mask-buffer` (LOP-0001) | measured `visibility` | **`none` throughout** — fix live, not regressed |
| `ocean-mask-line` | `line-opacity → 0` | band **unchanged** |
| `ocean-mask-fill` | `fill-opacity → 0` | band **unchanged** |
| the marine field itself | **L6: Waves OFF** | band **ABSENT** — so it requires the field |
| mask LINEAR filtering | measured texel size | mask is 4096×2048 over 8°, **1 texel ≈ 2.3 screen px** at z8.72 — cannot produce a 10–20 px band |
| coast SDF erosion | `__RAW_GPU__.coastSDF` | `base: false`, `erode: 0` — the SDF path is not even active |
| Bahamas-bank bathymetry | control coast | reproduces **identically on SE Florida** |

The L6 basemap control is the pivot: with the weather layer off, the coastline is clean. The band
needs the marine field, and no `ocean-mask-*` painter produces it.

## 3. The cause

**`MIDZOOM_OVERLAY_CARVE_MIN_Z = 9`.**

Below z9 the viewport-truth overlay does not run, so the field's land/water boundary comes from the
**generalized land geometry** rather than basemap water truth. The field is therefore masked out
over real water in a band whose width is the generalization error (~1–2 km) — which at z8.7
(≈1199 px/deg) is **10–20 screen pixels**. Exactly what is visible.

Measured ladder, three stops, two coasts, everything else held fixed:

| zoom | `overlayMask.on` | reason | truthGate | band |
|---|---|---|---|---|
| **8.72** | `false` | `off` | false | **PRESENT** — Grand Bahama *and* SE Florida |
| **8.90** | `false` | `off` | false | **PRESENT** |
| **9.30** | **`true`** | `min_combine` | **true** | **ABSENT** — field reaches the shore |

## 4. ★ The handoff — why this appeared only after LOP-0001

`ocean-mask-buffer` ramps `line-opacity` **1.0 until z8.5, → 0 by z9.5**, and its 2026-07-05 comment
states it was *"built to blend the MARINE heatmap's coastline."*

- The **buffer** covered `z < 9.5`.
- This **carve** covers `z ≥ 9`.

That is a **designed handoff**, and the two halves overlap by half a zoom level. LOP-0001 removed the
buffer correctly — its colour was near-black against medium-slate water, which is why it read as a
halo — but removing it took away the cover over the `z < 9` band.

**Two defects were stacked: a wrong-coloured cover, and the thing it was covering.** Fixing the first
necessarily reveals the second. Neither finding invalidates the other.

## 5. The fix is an owner decision, because none of the options is free

- **(a) Lower `MIDZOOM_OVERLAY_CARVE_MIN_Z` below 9.** Closes the gap at its source — the field would
  get basemap-truth coastlines further out. But the threshold exists for **repaint cost**; the
  overlay is a canvas paint plus a texture upload per refresh. Needs a measured perf leg first.
- **(b) Restore `ocean-mask-buffer` with a colour that matches the composited basemap water** — the
  2026-07-05 intent, executed correctly this time (that fix used `tc.ocean`, which is *not* what the
  water composites to; see LOP-0001). Cheap, and it is still a cover-up rather than a repair.
- **(c) Both** — carve lower where affordable, correctly-coloured buffer as the fallback band.

I have deliberately **not** picked one. (a) changes a performance-tuned threshold and (b) reinstates
a layer we just proved harmful in its current form; both deserve an explicit decision rather than my
preference.

## 6. What is pinned so this cannot drift while you decide

`WebGLMarineEngine.midzoomCarve.test.js` asserts the threshold is 9, that the engage flips **exactly**
at the boundary, that unknown zooms fail safe (NaN included), and — non-vacuously — that the other
preconditions can still veto above the threshold. If the number moves, the ladder must be re-run and
LOP-0002 updated.

## 7. ⚠️ The proof log's own guard fired on its author

My first draft of LOP-0002 shipped a **two-stop** ladder. The log's integrity test — the one added
with LOP-0001, requiring every proven entry to carry a ≥3-stop zoom ladder — **rejected it**. The
third stop (z8.72, both coasts) was real and measured; I had simply not recorded it.

That is the only way to learn a guard is not decoration: it has to fail someone, and this time it
failed me.
