# LV-12 — WS-CAN-0061 fixed: the mask sat below the basemap ocean, and everything anchored beneath it went under too

**Objective:** WS-OBJ-101 · **Task:** WS-CAN-0061 · **Date:** 2026-08-13
**Method:** Playwright against live dev and a local build — authenticated, compositing, continuous
wheel zoom. **The program's first runtime video and frames after six audits of "zero recordings".**

---

## 1. The symptom, finally reproduced

The owner reported the field "getting painted over really fast" while zooming out. Every prior
measurement in this session settled the map for 4–5 s first and therefore found the steady state
**healthy** — which is why six hypotheses died.

Driving a real wheel and sampling every ~120 ms inverted the picture:

| moment | result |
|---|---|
| **mid-gesture, z2.00** | heatmap renders perfectly — full green→yellow→orange gradient, land masked (`TR-12-z2.00.jpg`) |
| **same view, 6 s after settling** | heatmap **gone**, plain blue basemap ocean (`TR-99-settled.jpg`) |

**Nothing paints over it during the zoom. It is visible *during* the zoom and erased *when the map
settles*.** The owner was seeing the only moments it worked.

## 2. Mechanism

The series shows `areTilesLoaded: false` for the whole gesture and `true` only once settled. With
the measured order — slots `3,4,5`, `ocean-mask-fill` `6`, `water` `11` — that resolves it:

> While zooming, the basemap's vector tiles for the new zoom have not arrived, so `water` draws
> nothing and the field below shows through. When the tiles land, `water` paints its opaque fill on
> top and the field disappears.

**Root cause:** `OceanMask.findInsertionPoint` returned the first structural layer in the style. In
Mapbox Streets that is `landcover`, which **precedes `water`**. So the mask anchored *below* the
basemap ocean, and everything anchored beneath the mask — the water_temp slots, and the marine layer
via `mapUtils.findMarineInsertionLayer` — went below the ocean with it.

⚠️ **Theme-dependent, which is why it hid from me.** An earlier capture ran in `theme: light` and
showed the field surviving at settled z2. Pinned to `theme: beach` (the owner's), the same code at
the same indices shows it erased. Any future om:// measurement must record the active **theme** as
well as the model.

## 3. The fix (Option 1, owner-selected)

`waterTempAnchor.findMaskInsertionPoint` — pure, testable — anchors the mask above the highest
basemap water fill while keeping the original structural rule. **Falls back to the exact pre-fix
anchor** when no structural layer exists above the water, so an unparseable style behaves as before
rather than floating the mask over the labels.

## 4. Verification — structural and visual

| | BEFORE (live dev) | AFTER (local build + fix) |
|---|---|---|
| water_temp slots | `[3, 4, 5]` | **`[19, 20, 21]`** |
| `ocean-mask-fill` | `6` | **`22`** |
| `water` | `11` | **`6`** |
| slots above the ocean? | **no** | **yes** |
| settled z2, beach theme | heatmap **gone**, blue ocean | **heatmap renders**, land masked |
| `ANCHOR REFUSED` in log | fires immediately | **never fires** |

Frames: `TR-99-settled.jpg` (before) vs `AFTER/TR-99-settled.jpg` (after). The AFTER frame's own
Diagnostics HUD reads `GFS / water_temp · Render Mode: Raster · Raster Source: LOADED`.

Tests: **18/18**; mutating the rule back to pre-fix behaviour fails **5**. Full map surface
**133 suites / 1398 tests**. `OceanMask.js` **905 → 895** — grandfathered shrink-only, and it shrank.

⭐ **`e88b0f68` converts from a no-op into a regression detector.** Its guard refuses when an opaque
basemap water fill sits above `ocean-mask-fill`. With the mask raised there is none, so it stops
refusing — and if anyone drops the mask back under the ocean it fires and names the layer. A test
pins that composition.

## 5. What is NOT established

- **Local build, not the dev deployment.** Ordering logic is identical, but a CRA dev build differs
  in bundling and env. Owner confirmation after deploy is still required.
- The AFTER HUD shows `Provider: UNKNOWN`, `Class: NO DATA`, `NOT VERIFIED — source parity not
  established`. Believed a local-env artifact (no marine grid to establish parity against) and
  unrelated to this fix, since the raster is loaded and rendering. **If it appears on dev, it is a
  separate finding.**
- Videos (3 × webm, 45 MB) are **deliberately not committed**. The frames carry the proof and the
  harness reproduces them; committing 45 MB of media permanently is not worth it.
  Harness: `zoomcap.js` / `transientcap.js` in this directory.

## 6. Instrument errors this cost, all mine

| error | consequence |
|---|---|
| `queryRenderedFeatures` **never returns raster layers** | every "the ocean pixel is covered by `water`" reading was listing vector features and could never have seen the field. Right conclusion, worthless evidence |
| Settled every measurement before reading | made a mid-gesture symptom invisible for six rounds |
| Read `landPixel: null` as "mask absent" | it meant "no land on that scanline"; I published a regression claim and withdrew it |
| Measured `theme: light` while the owner used `beach` | the two disagreed and I did not pin the variable |
| Shipped `e88b0f68` on predicted indices, unverified | a no-op guarding an operation that was not the one burying the field |

★ **The two decisive observations came from the owner, not from any instrument I built**: *"it gets
painted over"* reframed a never-renders bug as a compositing bug, and *"this is a previous
regression with many layers"* pointed at the history that named the class.
