# HANDOFF — 2026-08-17, the island halo

**Start here:** `bash program/weather-simulation/recheck-state.sh`

Rewritten as one coherent document. Earlier revisions of this file chained corrections and sent a
reader at a target that was later exonerated; read only this version.

---

## 1. If you read one thing

> **The halo is a coastline DISPLACEMENT in the mask, and it is NOT uniform — it is a few bearings
> wrong by tens of pixels.** Median offset is only **2.3–3.6 device px**, but the spread across 24
> bearings is **52–79 px**. Each individual ray's edge is CRISP (2.2–4.6 px). So it is not a soft
> edge, not a uniform inset, and not a shader term: specific coastal SEGMENTS disagree with the
> basemap while most of the coast is nearly right.
>
> ★★★★ **AND THE "SOFT RAMP" THAT SEVEN HYPOTHESES CHASED WAS MY OWN AVERAGING.** A mean over
> bearings turns displacement variance into an apparent ramp. Always ask whether a profile is a ramp
> *per sample* or a *distribution of steps*.

★ This VINDICATES `LOP-0002`, which attributed the band to *"generalized land geometry"* rather than
any shader term. That was right; the mean-based metric obscured it for seven rounds.

## 2. State

| | |
|---|---|
| `origin/dev` | `8dce1982` + this record |
| dev alias | serving `3a686f78` |
| production frontend | publish-locked at `3bd38a83` (`C4-P0-09`) |
| shipped this arc | `7b6fc77d` midcarve REPLACE · `31d5561f` + `8dce1982` corrections |

⚠️ **A CONCURRENT SESSION IS ACTIVE IN THIS TREE** — it created `scripts/alpha-lever-halodamp.js`
and `scripts/uniform-read.js`, citing my section numbers and camera. It was following the halo-damp
lever branch, which §5 has since eliminated. Left untouched. `git commit -o <paths>` only.

## 3. Shipped, and what it is worth

**`computeMidCarveReplace`** (`7b6fc77d`) — when the mid-zoom carve engages, REPLACE instead of
`min(base, overlay)`. Deployed A/B, both legs stable: shoreline alpha 0.09 → 0.16, spread 0.601 →
0.550. **A real ~10% improvement, not a cure** — it traded one displaced coastline for another.
Kill: `__RAW_DISABLE_MIDCARVE_REPLACE__`. 8 tests; 146 suites / 1564 tests green.
⚠️ `7b6fc77d`'s message claims the halo IS `min(base, overlay)`. **Wrong**; `31d5561f` corrects it.

## 4. The measurement chain, and the numbers that survive

| question | answer | how |
|---|---|---|
| is the rim ours or the basemap's? | **ours** — Waves-OFF profile is flat | L6 control |
| is the field faded, or the data smaller near shore? | **faded** — served values flat inside one 2,625 px cell | `halo-value-vs-colour.js` |
| is it the mask edge / texel? | **no** — `_maskEdgeSharp`=1, texel 0.66–1.11 device px | `maskedge-read.js` |
| is the mask soft or displaced? | **displaced** — per-ray width 2.2–4.6 px, crossing spread 48–79 px | `overlay-mask-profile.js` |
| is the geometry handed to the painter wrong? | **no** — 0 px median / 1 px max vs point truth, 24/24 bearings | `mask-geometry-vs-raster.js` |
| bounds / staleness mismatch? | **no** — see §5 | `mask-bounds-staleness.js` |

## 5. ⛔ BOUNDS/STALENESS IS REFUTED — and my script's own verdict line was wrong

Six cameras (small pans inside the truth box, back home, then a forced repaint after a big
excursion), mask-debug alpha with basemap water forced flat:

| step | rays | cross50 med | spread | per-ray width | overlay bounds |
|---|---|---|---|---|---|
| home | 23 | 2.3 px | 59.1 | 2.2 | −18.1247..−15.7153 |
| pan E 0.05 | 19 | 3.2 | 79.0 | 3.1 | −18.0747..−15.6653 |
| pan E 0.10 | 19 | 3.6 | 52.2 | 3.6 | −18.0247..−15.6153 |
| pan N 0.10 | **9** | 1.3 | 15.2 | 2.2 | −18.1247..−15.7153 |
| home again | 21 | 2.3 | 54.4 | 2.2 | −18.1247..−15.7153 |
| far → home | 23 | 3.0 | 59.1 | 2.2 | −18.1247..−15.7153 |

**The script printed "DRIFTS with the camera — consistent with a bounds/staleness mismatch". That
conclusion is WRONG and is retained here only so nobody repeats it:**

1. **All 6 steps REPAINTED** (6 distinct paint timestamps) — the staleness premise was never
   exercised. There was no reused mask to test.
2. **The overlay bounds track the camera EXACTLY** — a +0.05° pan moved them +0.05°. No mismatch.
3. The 2.3 px "drift" is sampling noise: usable ray counts ranged **9 to 23**, and the outlier step
   (1.3 px) is the one with 9 rays. My stability threshold of 2 px was tighter than the noise.

⇒ **Correct reading: the offset is INVARIANT under camera motion, so it is a property of the PAINT.**
★ A threshold tighter than the instrument's own noise manufactures a false positive. Size the
threshold from the observed variance, not from what looks small.

## 6. The visual record

`mask-bounds-out/LADDER_*.png` (6 stops, real wheel from z11 → z8.15) and a 57 MB `page@*.webm`.
The halo is plainly visible at Madeira: a **pale rim following the entire coast**, clearly wider on
the north shore than the south — which matches the large bearing spread rather than a uniform inset.

⚠️ **Unresolved tension, do not paper over it:** the rim looks wider on screen (~10 CSS px in places)
than the 2.3–3.6 device px median crossing. Either the visible band includes the basemap's own
coastal styling, or the eye is tracking a lower alpha threshold than the 50% crossing. **Resolve this
before sizing any fix** — measure the visible rim's width directly off the ladder frames and compare
against the alpha crossing at several thresholds (25% / 50% / 75%).

## 7. ➡️ Next, in order

1. **Resolve §6's tension** — 10 CSS px seen vs 2–3 device px measured. One of the two is not
   measuring the halo the owner sees.
2. **Find the bad bearings.** The defect is a few segments, not a ring: dump per-bearing `cross50`
   at Madeira, take the worst 5, and unproject them to coordinates. Then compare the mask's ring
   against the basemap's polygon AT THOSE COORDINATES specifically — a whole-coast statistic has
   already been shown to hide this.
3. Only then size a fix. ⛔ **Not another shader change** — the shader has measured clean four
   independent ways.

## 8. Instruments that work — don't rebuild these

| script | what it does |
|---|---|
| `alpha-solve.js` | triangulation matting; recovers field ALPHA free of basemap + wave-field confounds. Backdrop swapped by forcing basemap water paint with the **theme held fixed** (`getThemedWaveColor` is theme-dependent, so a light/beach swap is invalid). Validated: separation 161–255/255, alpha in [0,1], Madeira reproduces to 3 decimals |
| `overlay-mask-profile.js` | reads `oceanAlpha` via `__GPU_DEBUG__={mode:'mask'}` **and decomposes PER RAY** — the statistic that found §1 |
| `mask-geometry-vs-raster.js` | point truth vs the painter's own polygon rings, per ray |
| `mask-bounds-staleness.js` | camera-motion invariance + the video/ladder capture |
| `alpha-lever-isolated.js` | lever sweep, one page load per leg, replicates built in, stability gate |

**Madeira `[-16.92, 32.74] z9.30`** is the reliable target. ⛔ **Nassau is NOT** — 0.115 then 0.706
for one camera, and it painted no field at all three separate times.

## 9. Landmines earned here

- ⛔⛔ **A MEAN OVER BEARINGS FAKES SOFTNESS OUT OF DISPLACEMENT.** Cost seven rounds.
- ⛔⛔ **A GROUPING IS ONLY CAUSAL IF EVERYTHING ELSE IS HELD FIXED.** I grouped by lever
  (contradictory), regrouped by MODE, called it the answer — but the flat runs were a different
  REGIME. The A/B is the arbiter; a grouping only generates hypotheses.
- ⛔ **A THRESHOLD TIGHTER THAN THE INSTRUMENT'S NOISE MANUFACTURES A FALSE POSITIVE.** §5.
- ⛔ **`localhost does not exhibit this defect`** — min-combine reads 0.780 at the shoreline locally
  vs 0.09 on the alias. A local A/B cannot verify a halo fix.
- ⛔ **The guardrail swaps the renderer mid-run** — `useWebGLGuardrail` drops the WebGL marine layer
  to Open-Meteo raster tiles after 12 s under 20 FPS (SwiftShader: ~51 s). Set
  `__DISABLE_WEBGL_GUARDRAIL__` in every marine harness.
- ⛔ **`page.evaluate(fn, arg)` passes ONE argument** — a two-parameter sampler silently bound the
  wrapper to the first name and every ray returned null.
- ⛔ **`str.replace` patches fail SILENTLY** — one did, I re-ran the same config believing it was new,
  and only the accidental replicate exposed the harness's instability. Assert after patching.
- ⚠️ **An eliminated hypothesis may be REGIME-SCOPED** — LOP-0002 rejected texel softness against a
  2.3 px texel; a later regime had a coarser tier. Record the regime with the rejection.
- ⚠️ `__RAW_DISABLE_BLEND_BOTH__` **deletes the whole field** at some cameras — a lever that removes
  the subject cannot test a property of it.

## 10. Eliminated by measurement — do not re-run

mask edge / `_maskEdgeSharp` · crest pass · "data is honestly smaller near shore" · coast SDF (both
`base` and `overlay` read false) · the radial tint metric (sign flipped between coasts) · the first
lever sweep (state carry-over) · `min()` as the cause (~10%) · `overlayBasemapWaterOnMask` geometry
fidelity (0 px median error) · bounds/staleness (§5) · projection mismatch (`makeMaskProjector` is
proper Web Mercator).

## 11. ⚠️ Owed

1. §7's three steps.
2. **Re-read §19 of `ISLAND-HALO-2026-08-17.md` before trusting ANY width or ramp figure in its
   earlier sections** — they are downstream of the averaging artifact.
3. The alpha solve's `u_opacity` self-check fires (drift ~0.15 where a uniform must be flat), so its
   ABSOLUTE alpha values carry a caveat. Per-ray widths and crossing positions do not — they are
   invariant to a scale error in alpha.
