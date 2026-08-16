# C4-MR-02 — the INVALID mask state: read-only inventory and contract design

**Status:** phase 1 (inventory) complete. **No source file was modified.**
**Measured against:** `origin/dev` @ `52e2abd1`, 2026-08-16.
**Why this row is unusual:** it is the only marine face with **zero** attempted fixes in the
project's history. `git log --all -S "CLAMP_TO_EDGE"` returns 20 commits spanning 2026-05-16 to
2026-08-15; every one sets or preserves the clamp, and **none has ever added a validity companion.**
This is not a fix that was tried and failed — it was never attempted.

---

## 1. The defect in one sentence

**A mask texel of `.r = 1.0` means "water" and also means "we have no coverage here, and
`CLAMP_TO_EDGE` handed you the border texel" — and nothing in the pipeline can tell those apart.**

## 2. There is exactly ONE chokepoint, which is good news

`createTexture` (`WebGLMarineTextureState.js:60`) hardcodes the wrap mode for **every** texture the
marine engine creates, with **no opt-out parameter**:

```js
export function createTexture(gl, filter, data, width, height) {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
```

The `filter` argument is caller-supplied; the **wrap is not**. Every mask, wave, bathymetry and
chlorophyll texture in the engine passes through here.

⚠️ **It is duplicated.** `WebGLWindUtils.js:30` declares a second `export function createTexture`
with the same signature. Any contract applied to one and not the other silently exempts the wind
engine — the same shape as `C4-MR-12`'s duplicate-authority rows. **Both must move together.**

## 3. The 15 sample sites

| File | Lines | Sampler |
|---|---|---|
| `WebGLMarineShaders.js` | 292, 356, 392 | `u_oceanMaskTexture` ×2, `u_overlayMaskTexture` |
| `WebGLMarineParticleShaders.js` | 174, 175, 185, 257, 258, 264, 508, 509, 522, 760, 770, 777 | `u_coarseMaskTexture`, `u_oceanMaskTexture`, `u_overlayMaskTexture` |

Three distinct mask samplers, read by the heatmap main pass, the coarse wash, particle **advect**,
and particle **draw**.

## 4. The finding that matters: the guard is a CONJUNCTION, and it is deliberate

`WebGLMarineShaders.js:370-373`:

```glsl
if (u_dataMaskGate > 0.5) {
  bool _outData = (tex_u <= 0.0 || tex_u >= 1.0 || tex_v <= 0.0 || tex_v >= 1.0);
  bool _outMask = (mask_u <= 0.0 || mask_u >= 1.0 || mask_v <= 0.0 || mask_v >= 1.0);
  if (_outData && _outMask) { oceanAlpha = 0.0; }
```

**Both** must be out of range before the sample is blanked. So the case *outside the mask but inside
the data grid* **deliberately consumes the clamped edge texel as truth** — and the code says so:

> *"The DECOUPLED case (outside the viewport mask but INSIDE the world data grid — the Istria/Susak
> regression) is preserved: outside-MASK but inside-DATA makes the AND false, so the base edge-clamp
> stands."*

⇒ This is **load-bearing**, not an oversight. A previous regression was fixed *by* relying on the
clamp. Any validity contract that simply blanks on out-of-mask will reintroduce Istria/Susak.
**That constraint is the real design problem, and it is why this row is hard rather than tedious.**

⚠️ And the guard barely matters today anyway: `u_dataMaskGate` is ON by default
(`marineCoverageContract.js:109`, `gateValue = 1.0` unless `__RAW_DISABLE_HEATMAP_BOUNDS_GATE__`),
but it was **measured PIXEL-INERT on 2026-08-15** (`aa026f7f`). So the only bounds guard the heatmap
has is both a conjunction *and* effectively inert.

## 5. The design space: `.a` is free, at zero memory cost

Measured across every mask sampler in both shader files:

| channel | used for | count |
|---|---|---|
| `.r` | ocean alpha / land-water | 4 sites |
| `.b` | coast SDF (signed distance, 0.5 = coast) | 3 sites |
| `.g` | particle end-sample | 2 sites |
| **`.a`** | **nothing — zero reads** | **0** |

The textures are already `gl.RGBA` / `UNSIGNED_BYTE`, so the alpha byte is **already allocated and
already uploaded**. A validity channel in `.a` costs **no additional memory and no format change** —
only the encoder writing it and the samplers consulting it.

## 6. ⛔ The trap that would break a naive `.a` implementation

**Masks are `LINEAR`-filtered** (`createTexture(gl, gl.LINEAR, …)` at
`WebGLMarineTextureEncoder.js:458/480/482/484`). A validity flag in `.a` would therefore be
**bilinearly interpolated**, producing fractional validity (0.37, 0.61 …) in exactly the border
region where the answer matters most — and a threshold on that fraction re-creates the same
"is this real or is this an artifact of interpolation" ambiguity one level down.

Two viable resolutions, both already hinted at in the audit:

1. **A separate NEAREST validity texture.** Costs one more texture and one more sampler slot per
   pass, but validity is then exact by construction.
2. **A one-texel INVALID border** written into the mask at encode time, so the clamp returns an
   explicitly-invalid value rather than a plausible one. Cheapest — no new texture, no new sampler —
   and it converts `CLAMP_TO_EDGE` from a liar into a truth-teller. **This is the recommended
   starting point**, because it changes one writer instead of fifteen readers.

⚠️ Option 2 has its own edge: with `LINEAR`, the border texel blends into its neighbour, so the
outermost *valid* texel becomes partially invalid. That is acceptable for a 1-texel band at grid
resolution but must be **measured, not assumed**, on the owner scene before adoption.

## 7. Recommended sequence (branch by abstraction, per Audit 4.1)

1. Add the validity write at the **encoder** (one writer), behind one flag, changing no reader.
2. Dual-read in ONE sampler — the heatmap main pass — and assert parity against today's behaviour
   across the zoom ladder. Parity means *identical pixels*, not "looks the same".
3. Only after parity holds, let the validity channel override, and delete the `_outData && _outMask`
   conjunction — **with an Istria/Susak regression scene committed first**, since that geography is
   what the conjunction exists to protect.
4. Extend to the wash, then particles (`C4-MR-01`), then the wind engine's duplicate `createTexture`.
5. Retire the inference paths.

**Do not** add another permanent kill switch (Audit 4.1 §1 is explicit), and **do not** start at the
readers — there are 15 of them and one writer.

## 8. What this inventory does NOT establish

- It does not show the missing INVALID state *causes* any currently-reported defect. The halo was
  attributed to `ocean-mask-buffer` (`LOP-0001`) and this is a different face.
- It has not been measured against a live scene; every claim here is from source at `52e2abd1`.
- The Istria/Susak constraint is quoted from the code comment; the geography has **not** been
  re-measured. Before step 3 it must be reproduced, or the regression it guards is unfalsifiable.
