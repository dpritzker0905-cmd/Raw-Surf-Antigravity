# HANDOFF — 2026-08-17, the island halo

**Start here:**

```bash
bash program/weather-simulation/recheck-state.sh
```

---

## 1. If you read one thing

> **The halo is coastline GEOMETRY, not shader softness. The mask's coast sits ~6 device px seaward
> of the basemap's on the median bearing and scatters ~48 px across bearings. Every individual ray's
> edge is CRISP (~4 px).**
>
> **And the "soft ramp" that seven earlier hypotheses chased was my own averaging** — 24 hard steps
> at scattered positions, meaned into a smooth curve. ★★★★ **A MEAN OVER BEARINGS CONVERTS
> DISPLACEMENT VARIANCE INTO APPARENT SOFTNESS.** Check whether a profile is a ramp *per sample* or
> a *distribution of steps* before attributing it to anything.

Reproducible across three independent page loads: per-ray width 3.5 / 4.6 / 4.6 px, 50% crossing
5.9 / 6.0 / 6.0 px, crossing spread **47.9 / 47.9 / 47.8 px**.

★ This VINDICATES `LOP-0002`, which attributed the coastal band to *"generalized land geometry"*
rather than any shader term. That was right. My metric obscured it for seven rounds.

## 2. State

| | |
|---|---|
| `origin/dev` | `31d5561f` + this record |
| dev alias | serving `3a686f78` |
| production frontend | still publish-locked at `3bd38a83` (`C4-P0-09`) |
| shipped this arc | `7b6fc77d` midcarve REPLACE · `31d5561f` its correction |

## 3. What is shipped, and what it is worth

**`computeMidCarveReplace`** (`7b6fc77d`) — when the mid-zoom carve engages, REPLACE instead of
`min(base, overlay)`. Deployed A/B, both legs stable: shoreline alpha 0.09 → 0.16, spread 0.601 →
0.550. **A real ~10% improvement, not a cure.** Now explained: it traded one displaced coastline for
another. Kill: `__RAW_DISABLE_MIDCARVE_REPLACE__`. 8 tests; 146 suites / 1564 tests green.

⚠️ `7b6fc77d`'s message claims the halo IS `min(base, overlay)`. **That claim is wrong** and
`31d5561f` corrects it on the remote. Do not quote the original.

## 4. ➡️ THE NEXT STEP — one function, not a shader constant

Make the mask's coastline agree with the basemap's. `overlayBasemapWaterOnMask`
(`WebGLMarineMaskRenderer.js`) exists for exactly that and returns `applied`. A residual **~6 px
median displacement with ~48 px bearing spread** says it is applying at coarser fidelity than the
basemap renders — simplified tiles at the queried zoom is the leading suspect (the file's own
comments already note NE 10m drops sub-200 m islands, and that the mask texel is coarser than NE 10m
from z5–z11) — or applying only partially.

⛔ **Do NOT make another shader change.** The shader measured clean three independent ways:
`_maskEdgeSharp` reads 1, the mask texel is 0.66–1.11 device px, and per-ray edges are ~4 px.

## 5. Instruments that work — use these, don't rebuild them

| script | what it does |
|---|---|
| `alpha-solve.js` | **triangulation matting** — recovers the field's ALPHA free of basemap and wave-field confounds. Backdrop swapped by forcing basemap water paint with the THEME HELD FIXED (`getThemedWaveColor` is theme-dependent, so the light/beach swap is invalid). Validated: separation 161–255/255, alpha in [0,1], Madeira reproduces to 3 decimals |
| `overlay-mask-profile.js` | reads `oceanAlpha` itself via `__GPU_DEBUG__={mode:'mask'}`, **and decomposes PER RAY** (width vs crossing-spread) — the statistic that found §1 |
| `alpha-lever-isolated.js` | lever sweep with ONE page load per leg, lever set via `addInitScript` before the first frame, **replicates built in** and a stability gate that refuses disagreeing legs |
| `island-halo.js` | radial probe around islands; ray length and zoom derived from each target's own width |

**Madeira `[-16.92, 32.74] z9.30`** is the reliable target. ⛔ **Nassau is NOT** — it read 0.115 then
0.706 for one camera and painted no field at all three times.

## 6. Landmines earned here

- ⛔⛔ **A MEAN OVER BEARINGS FAKES SOFTNESS OUT OF DISPLACEMENT.** §1. Cost seven rounds.
- ⛔⛔ **A GROUPING IS ONLY CAUSAL IF EVERYTHING ELSE IS HELD FIXED.** I grouped by lever (contradictory),
  regrouped by MODE, and called it the answer — but the flat runs were a different REGIME. The A/B is
  the arbiter; a grouping only generates hypotheses.
- ⛔ **`localhost does not exhibit this defect`** — min-combine reads 0.780 at the shoreline locally vs
  0.09 on the alias. A local A/B cannot verify a halo fix.
- ⛔ **The guardrail swaps the renderer mid-run.** `useWebGLGuardrail` drops the WebGL marine layer to
  Open-Meteo raster tiles after 12 s under 20 FPS (SwiftShader: fires at ~51 s). Set
  `__DISABLE_WEBGL_GUARDRAIL__` in every marine harness or you measure third-party tiles.
- ⛔ **`page.evaluate(fn, arg)` passes ONE argument.** A two-parameter sampler silently bound the
  wrapper to the first name; every ray projected `undefined` and returned null.
- ⛔ **`str.replace` patches fail SILENTLY.** One did, I re-ran the same config believing it was a new
  one, and only the accidental replicate exposed the harness's instability. Assert after patching.
- ⚠️ **An eliminated hypothesis may be REGIME-SCOPED.** LOP-0002 rejected texel softness against a
  2.3 px texel; a later regime had a different tier. Record the regime with the rejection.
- ⚠️ `__RAW_DISABLE_BLEND_BOTH__` **deletes the whole field** at some cameras — a lever that removes
  the subject cannot test a property of it.

## 7. Eliminated by measurement — do not re-run these

mask edge / `_maskEdgeSharp` · crest pass · "the data is honestly smaller near shore" (flat values
inside one 2,625 px cell) · coast SDF (`base:false, overlay:false`, both halves read) · the radial
tint metric (sign flipped between coasts) · the first lever sweep (state carry-over) · `min()` as the
cause (≈10% of it).

## 8. ⚠️ Owed

1. The §4 fidelity fix — unstarted.
2. **Re-read §19 of `ISLAND-HALO-2026-08-17.md` before trusting ANY width or ramp figure in its
   earlier sections** — they are downstream of the averaging artifact.
3. The alpha solve's `u_opacity` self-check fires (drift ~0.15 where a uniform must be flat), so its
   ABSOLUTE alpha values carry a caveat. Per-ray width and crossing-spread do not — they are
   invariant to a scale error in alpha.
