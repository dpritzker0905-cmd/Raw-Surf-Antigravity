# LV-11 — WS-CAN-0061 ROOT CAUSE: the anchor re-assert buries water_temp beneath the basemap ocean

**Objective:** WS-OBJ-101 · **Task:** WS-CAN-0061 · **Date:** 2026-08-13 · **Production files modified: NONE**
**Method:** owner-driven live bisect + `queryRenderedFeatures` + `git log -S` + primary-source CDN checks

---

## The finding

At an **ocean** pixel, `dev--rawsurf.netlify.app/map`, z2, model GFS held fixed:

```json
{ "pt": [11,155], "waterTempTopIdx": 5,
  "layersAtThisPixel": [
    { "id": "water",        "idx": 11, "type": "fill", "above": true },
    { "id": "water-shadow", "idx": 17, "type": "fill", "above": true } ] }
```

**The basemap's own `water` (11) and `water-shadow` (17) fills render ABOVE the water-temp slots
(3, 4, 5 of 146).** The field decodes, paints, and is then covered by the basemap ocean.

## The mechanism, and the commit

`0dcfc4ee` (2026-07-11) added the **water-temp anchor re-assert** to fix a real defect —
*"water_temp intermittently displaying over land"* (`MapWebGL.js:188-215`):

```js
const fillIdx = order.indexOf('ocean-mask-fill');
if (idx > fillIdx) { mapInstance.moveLayer(lid, 'ocean-mask-fill'); }
```

`moveLayer(id, beforeId)` places the layer **immediately below** `ocean-mask-fill`. And
`ocean-mask-fill` sits at **index 6 — below the basemap's `water` at 11.**

So the re-assert moves the slots from 18/19/20 (where they render correctly over ocean) down to
3/4/5 (beneath the basemap ocean). Live log, every session:

```
[WaterTemp] Re-asserted water_temp-slot-0-layer below ocean-mask-fill (was above, idx 18 > 2)
```

**The ordering constraint is unsatisfiable as currently arranged.** water_temp must be:
- **above** `water` (11) — or the basemap ocean covers the field
- **below** `ocean-mask-fill` (6) — or land skin temperatures show

`6 < 11`, so no index satisfies both. The 07-11 fix traded a land-bleed defect for an ocean-cover
defect; it did not have a correct position available to move to.

**Why it presents as zoom-related:** `styledata` fires on zoom, and slot rotation
(`Processing layer 'water_temp' from slot 0 to 1`) re-mounts slots *above* the fill, where they
paint — then the re-assert immediately pushes them back down. That is exactly *"I can see it get
painted over as I rapidly zoom out."*

## This is the fourth instance of one class, and the file says so

`OceanMask.js:422-432` documents the same bug from **2026-07-17**:

> *"the z11.51 'heatmap + animations clear/dim' root: the inland repaint layers paint ALL water on
> class-less basemaps (their `['get','class']` filter **FAILS OPEN**) at fill-opacity 1.0 … whole
> zoom bands of the marine field went behind **an opaque ocean-colored curtain**, and WHICH bands
> varied per session."*

| date | what covered the field | fix |
|---|---|---|
| 07-11 #8 | lakes repaint | marine-only gate |
| 07-11 #9 | coast buffer | `__RAW_WATER_TEMP_COAST_BUFFER__` |
| 07-11 #10 | green landuse | `__RAW_WATER_TEMP_GREEN_LANDUSE__` |
| 07-17 | inland repaints over the marine field | ORDER PIN below the marine layer |
| **08-13 (this)** | **basemap `water` + `water-shadow`** | **none — open** |

Five occurrences, five point fixes, same root: **weather fields are anchored beneath a layer family
that keeps acquiring opaque members.** A sixth gate will not hold.

## Corrections to my own earlier conclusions in this session

| I concluded | Refuted by | Status |
|---|---|---|
| the block is `model_lock` / `isModelMatch` | `blockedDetail` null on 64 traced URLs | **wrong** |
| it is a zoom-floor defect | GFS paints at z2 and z3 | **wrong** |
| `__OM_ACTIVE_MODELS__ = []` is the cause | owner session reads `["ncep_gfs025"]` | **my artifact** |
| ECMWF lacks `surface_temperature` | CDN metadata: PRESENT (119 vars) | **wrong** |
| `ocean-mask-fill` covers the ocean | grid: 45% covered, continent-shaped | **wrong** |

Six hypotheses died. **Every one died to a measurement, and the two decisive ones came from the
owner's eyes, not from an instrument**: *"it gets painted over"* reframed a "never renders" bug as a
compositing bug, and *"this is a previous regression with many layers"* pointed at the history that
named the class.

⚠️ **The instrument actively misled me.** `decodedDelta: 0` read as "nothing rendered"; the tiles
were rendering from cache without re-entering the protocol. **A protocol counter cannot answer a
pixel question.** This is the program's own most-repeated root cause wearing new clothes — a check
that cannot distinguish "not sampled" from "broken."

## Fix options — owner decision, not authorised here

1. **Raise the mask family above the basemap water fills**, then anchor water_temp just below
   `ocean-mask-fill`. Restores both constraints. Risk: the mask's position is load-bearing for the
   marine engine (`mapUtils.js:405-407`, `WebGLMarineLayer.js:856`) and the 07-17 ORDER PIN.
2. **Anchor water_temp above `water`/`water-shadow`** and give it land-clipping of its own (GPU-side,
   as the marine engine already does) so it no longer needs to sit under the mask.
3. **Compute the re-assert target dynamically** as "below `ocean-mask-fill`, above the highest
   opaque basemap water fill" — and refuse (log) when no such index exists, rather than silently
   burying the layer.

⭐ Option 3 is the one that would have *caught* this: the current re-assert moves the layer with no
check that the destination is above anything that would cover it. **A layer-ordering operation with
no post-condition is how five of these shipped.**

## FIX IMPLEMENTED — Option 3 (owner-selected, 2026-08-13)

**Dynamic target + loud refusal.** New pure module `frontend/src/components/map/waterTempAnchor.js`
(90 LOC): `findOccludingWaterFill(order, fillIdx, getLayer)` and `planAnchorMoves(...)` decide
whether a legal destination exists **before** anything moves. `MapWebGL.js` calls it and, on refusal,
emits one `console.error` naming the occluder and leaves the slots where they are.

| Check | Result |
|---|---|
| New tests | **10/10 pass** (`waterTempAnchor.test.js`) |
| Mutation-proven | ⛔ guard neutered to pre-fix behaviour ⇒ **2 tests fail**, incl. the defect reproduction; restored ⇒ 10/10 |
| Full map surface | **133 suites / 1390 tests pass** |
| LOC ratchet | `MapWebGL.js` **1097 → 1096** (grandfathered shrink-only; it SHRANK). `[OK] No new violations` |
| eslint | 5 errors on the touched file — **identical count on HEAD, 0 added** |

The fixture is the **real measured stack**, not invented: slots 3/4/5, `ocean-mask-fill` 6, `water`
11, `water-shadow` 17. `ocean-mask-*` is excluded from occluder detection on purpose — including it
would make the guard refuse on every tick and reintroduce the land bleed `0dcfc4ee` fixed.

### ⚠️ The behaviour change this ships, stated plainly

Refusing the move leaves the slots **above** `ocean-mask-fill`, so:

- ✅ the field becomes **visible over ocean** — the reported defect is gone
- ⚠️ **land skin temperatures become visible again** — the exact defect `0dcfc4ee` was written to fix

That is the trade Option 3 makes: a visible field with land bleed instead of an invisible one, plus
a console error that names the real problem. **It is a mitigation, not the cure.** The cure is fix
option 1 or 2 — move the mask family above the basemap water fills, or give water_temp its own
GPU-side land clipping — and the refusal log is what should drive that.

### NOT yet verified

**No browser verification of the runtime behaviour.** The change is frontend-only and
`dev--rawsurf.netlify.app` serves it only after a push; this audit has pushed nothing. The
visible-over-ocean and land-bleed outcomes above are **predicted from the layer indices, not
observed.** Owner verification required after deploy: water temp should paint over ocean at every
zoom, one `ANCHOR REFUSED` line should appear in the console, and land should show skin temps.

## Register

**WS-CAN-0061** — retitle to *"water_temp anchor re-assert buries the field beneath the basemap
`water` fill (`0dcfc4ee`); the ordering constraint is unsatisfiable as arranged."*
Severity **HIGH, user-visible**. Zoom framing retired. `isModelMatch` / `model_lock` closed as
refuted. Related: `WS-CAN-0060`, and a candidate new task for the recurring class.
