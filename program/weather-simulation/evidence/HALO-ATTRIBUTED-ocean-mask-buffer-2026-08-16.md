# THE HALO IS ATTRIBUTED — `ocean-mask-buffer`, ordered above the marine field

**Ledger row:** `C4-P0-03` (attribute the first bad halo painter) -> **CLOSED**
**Date:** 2026-08-16 · **Surface:** `https://dev--rawsurf.netlify.app/map`, authenticated, real browser
**Deployed SHA under test:** `origin/dev` = `1f41601b` (frontend service worker `7becd023`; `1f41601b`
is docs-only on top, so the renderer bytes are `7becd023`)
**Scene held fixed for every leg:** center `[-80.2, 28.33]`, zoom `7.50`, dark theme, model GFS,
layer **Waves**, `map.isStyleLoaded() === true`, `style._order.length = 145`

---

## 1. Result

| Leg | Single variable changed | Everything else | Halo |
|---|---|---|---|
| **A** | baseline (`line-opacity` = `interpolate(zoom, 8.5->1.0, 9.5->0.0)`, i.e. **1.0** at z7.5) | — | **PRESENT** |
| **B** | `line-opacity` -> `0` | center, zoom, layer order, coverage state all verified unchanged | **ABSENT** |
| **A'** | `line-opacity` restored to the original expression | same | **PRESENT** (returns) |
| **C** | `line-opacity` **left at full**; layer **moved below** `webgl-marine-particles` | same | **ABSENT** |

**`d(halo)/d(ocean-mask-buffer) != 0`, reversibly.** Leg A' is the non-vacuity control: a one-way
disappearance could have been a coincidental repaint; the halo returning on restore rules that out.

**Leg C is the one that names the fix.** At *full opacity*, merely reordering the layer below the
field removes the halo. The defect is therefore **stack order, not styling** — which means the
2026-07-05 `resolveBufferColor` recolor was treating a symptom, and no color choice can fix it while
the layer is above the field.

## 2. Measured layer order at the failing scene

```
 8  ocean-mask-fill
 9  ocean-mask-inland-water
10  ocean-mask-inland-waterway
11  webgl-marine-particles        <-- the marine FIELD
12  ocean-mask-buffer             <-- ABOVE the field, visibility: "visible"
13  ocean-mask-line
```

Telemetry at the same moment, before any lever:

```
maskFamilyOrder   { moved: 2, ceiling: "waterway" }      (planner active; fixpoint at moved:0 after)
coverageTerminal  { state:"safe_degraded", action:"clip", maskClip:true, reason:"retry_exhausted" }
washOverlayMode   { replace:false, baseGlobalDense:true }
overlayMask       { on:false, reason:"coverage_gap", bounds:null }
heatmapGate       resident{gateValue:1, clipValue:1}  coarse{gateValue:1, clipValue:0}
```

Note that the SAFE_DEGRADED clip (`aa026f7f`) and the wash min-combine (`7becd023` half 2) were
**both engaged and working** in the frames that show the halo. They are not implicated. They were
also never going to help: neither governs a MapLibre style layer.

## 3. Why this paints a halo

`ocean-mask-buffer` (`OceanMask.js:464-497`) is a `line` layer on the land polygon, offset outward
into the ocean. At the owner's band:

| property | value at z6.7-8.3 |
|---|---|
| `line-width` | ~45-55 px |
| `line-offset` | ~22-27 px **outward into the ocean** |
| `line-opacity` | **1.0** (only ramps to 0 between z8.5 and z9.5) |
| `line-color` | the **theme ocean color** (`resolveBufferColor`) |
| `line-blur` | ~2 px |

An opaque ~50 px ocean-colored blurred band tracing every coastline. Drawn **under** the field it is
invisible (leg C). Drawn **over** the field it occludes it in a coast-hugging band — the reported
symptom exactly.

The 2026-07-05 fix (`ea488c5a`) made the line take the theme **ocean** color so it would blend with
the basemap water showing through a mask gap. **That premise requires the buffer to be above basemap
water.** It is now above the *marine field*, so the ocean color no longer blends — it occludes.

## 4. Root cause chain

1. **`f3fe2c85` (2026-08-13, WS-CAN-0061)** — the water_temp fix. Re-anchored the mask family
   **above the basemap water fill** so the field stopped being buried by the basemap ocean.
2. That made the **2026-07-17 inland ORDER PIN** unsatisfiable (its clauses "below the field" and
   "above the land fill" could no longer both hold), so the realized family order became
   **mount-timing dependent** — `7becd023`'s own message records "two probes, two orders".
3. **`7becd023` (2026-08-15 22:52 EDT)** — added `planMaskFamilyOrder` to make the order
   deterministic. Its canonical chain (`waterTempAnchor.js:139-152`) is:

   ```
   water < MASK_FILL < (landuse) < INLAND_WATER < INLAND_WATERWAY
         < FIELD < MASK_BUFFER < MASK_LINE < basemap detail
   ```

   **`MARINE_FIELD_LAYER_ID` is placed below `ocean-mask-buffer`.** Before this commit that
   relationship was a coin flip; after it, the buffer is above the field on every load.

**The specific error:** the v15 header constraint is *"[marine rasters] <- GFS wave/swell slot layers
(forced below MASK_BUFFER)"*. That constraint exists because the buffer **blends the blocky
coastline of the raster slots**. `7becd023` generalized it to `webgl-marine-particles`, which is a
different painter: the WebGL field draws its own coastline via the in-shader land mask and does not
need the buffer above it. Applying a raster-slot constraint to the custom field is what puts an
opaque band over the field.

**Timing corroborates:** owner reports 08-14 good and most of 08-15 good; the planner deployed at
22:52 EDT on 08-15. Zero backend files changed in that window
(`git diff --stat 3114b9ba origin/dev -- backend/` is empty), so the marine data is identical to the
good day. Production frontend is frozen at `3bd38a83` and is unaffected.

## 5. A trap that would have produced a FALSE NEGATIVE

The planned isolation leg was
`map.setLayoutProperty('ocean-mask-buffer','visibility','none')`. **That is silently reverted.**
`OceanMask.js:658` re-asserts `visibility` on every sync tick while a marine layer is active:

```js
const bufferOn = !!stateRef.current.activeMarineLayer || window.__RAW_WATER_TEMP_COAST_BUFFER__ === true;
mapInstance.setLayoutProperty(MASK_BUFFER, 'visibility', bufferOn ? 'visible' : 'none');
```

Measured: set to `none`, read back **`"visible"`** 2.5 s later. Anyone running that leg would have
seen no pixel change and concluded the buffer was **not** the painter — the exact opposite of the
truth. The working levers are `line-opacity` (paint properties are not re-asserted) and `moveLayer`
with `__RAW_DISABLE_MASK_FAMILY_ORDER__ = true`.

**Generalize this:** an isolation lever must be verified to have *taken effect* before its pixel
result is read. A lever that is silently reverted reports "no effect" identically to a lever that
genuinely has none.

## 6. Reproduction

With the map open and authenticated at the scene above, in the console:

```js
// A: baseline - halo present
// B: the painter
map.setPaintProperty('ocean-mask-buffer','line-opacity',0);            // halo GONE
// A': control
map.setPaintProperty('ocean-mask-buffer','line-opacity',
  ['interpolate',['linear'],['zoom'],8.5,1.0,9.5,0.0]);                // halo RETURNS
// C: the fix direction - full opacity, order corrected
window.__RAW_DISABLE_MASK_FAMILY_ORDER__ = true;
map.moveLayer('ocean-mask-buffer','webgl-marine-particles');           // halo GONE
```

All four legs are in-page only; a page refresh restores stock behavior.

## 6a. ZOOM LADDER — the defect is bounded, and the fix holds across the whole affected band

Owner challenge, correctly raised: the z7.5 result proves nothing about other zooms, because the
buffer's geometry is zoom-interpolated. Re-run as **paired captures at the same position** with the
order toggled in place (`center [-80.2, 28.33]`, dark, GFS, Waves, settled at every stop).

| zoom | buffer width / offset / opacity | STOCK (buffer above field) | FIXED (buffer below field) |
|---|---|---|---|
| z2 | ~13 px / ~6 px / **1.0** | **halo PRESENT** — dark outline on both American coasts, Caribbean islands as dark blobs | **ABSENT** |
| z4 | ~20 px / ~11 px / **1.0** | **halo PRESENT, severe** — thick black band on the entire Gulf + Atlantic seaboard, Cuba, Hispaniola, Jamaica, Central America | **ABSENT** — field reaches every shoreline |
| z6 | ~40 px / ~20 px / **1.0** | (order verified `buffer 12 > field 11`) | **ABSENT**, order held `buffer 9 < field 12` |
| z7.5 | ~50 px / ~25 px / **1.0** | **halo PRESENT** (the A/B/A/C legs in section 1) | **ABSENT** |
| z9 | ~60 px / ~30 px / **0.5** | **effectively ABSENT** — opacity is ramping out | n/a |
| > z9.5 | — / — / **0.0** | **ABSENT by construction** — the paint expression is 0 | n/a |

**The affected band is roughly z1 to z9.5, worst z4-z8.5, and it self-extinguishes above z9.5** —
which is exactly why the defect reads as "the halo appears at wide/mid zoom and goes away when you
zoom in", and why close-zoom inspection alone would have missed it. The `line-opacity` ramp
(`8.5 -> 1.0`, `9.5 -> 0.0`) is the sole reason the top of the range is clean; nothing else protects
it.

**The fix direction holds at every zoom tested.** Ordering the buffer below the field clears the
halo at z2, z4, z6 and z7.5 with the buffer at full stock opacity and `visibility: visible`
throughout. At each stop the order was re-verified after settle (`plannerMoved: 0`,
`__RAW_DISABLE_MASK_FAMILY_ORDER__ = true`), so no stop is reporting a stale arrangement.

**Coverage-state note:** `coverageTerminal` reads `unknown` at z2-z6, `safe_degraded` at z7.5 and
`covered` at z9 — three different regimes, and the halo is present in all of the opaque ones. The
defect is therefore independent of the coverage state machine, which corroborates section 2: the
clip and the wash mode are not implicated.

## 7. What this does NOT establish

- It does not clear the other faces. Particles/crests (`C4-MR-01`) and the missing INVALID mask
  state (`C4-MR-02`) remain untested and un-attempted; this result says only that the *dominant,
  owner-visible* band at this scene is the buffer.
- It was measured at one scene (Florida east coast, z7.5, dark theme). A control coast and the
  light/beach themes are required before the repair is certified (`C4-P0-06`/`C4-P0-07`).
- No fix has been written. Leg C shows the *direction*; the repair must still be made in
  `MASK_FAMILY_CHAIN` with a failing-before/passing-after test, and must not re-break the raster-slot
  blend the buffer exists to provide.
