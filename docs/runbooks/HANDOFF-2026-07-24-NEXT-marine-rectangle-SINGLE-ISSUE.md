# HANDOFF → FRESH CONTEXT — SINGLE ISSUE: the marine RECTANGLE (heatmap + crests both blank)

**SCOPE DISCIPLINE: this handoff is ONE issue only. Do NOT pull in the wind seam, the GFS/ICON coarse
freshness item, the raster clear/reappear item, or the LOD/3° arc. Those live in
`HANDOFF-2026-07-23-OPUS48-ANTIMERIDIAN-ARC-4-fixed-2-open.md`. Finish THIS, then go back to that queue.**

**Repo state you inherit:** `dev`, 6 commits ahead of `origin/dev`, **nothing pushed** (production untouched).
Working tree clean. Marine suite green (714 tests). Do not push without the user's explicit go-ahead — pushing
deploys to Render.

---

## 1. THE SYMPTOM (user-reported, reproducible from a COLD reload)

A **rectangular region where the marine heatmap AND the crest particles are BOTH absent** — flat basemap gray.
Not a colour error, not a seam: nothing paints.

**Exact repro (verified cold, twice):**
```js
// waves layer ON, model EURO
map.jumpTo({ zoom: 4.67, center: [-172.75, 9.05] })   // central Pacific
```
**Geometry, measured with `map.unproject` (NOT eyeballed):**
- blank box = **lng > −180 (east of the antimeridian) AND lat > ~4.9°N**
- its **left edge is EXACTLY the antimeridian** (canvas x 20.5% → lng −180.0)
- painted area is an **L-shape**: the strip west of ±180 (full height) + everything below ~4.9°N

⚠️ The user has seen this repeatedly and it is their top complaint. It survives a page reload, so it is NOT
stale GL state.

---

## 2. THE JACOBIAN — start here

**The one fact that should drive the whole investigation: the heatmap and the particles are drawn by SEPARATE
GL programs (`heatmapProgram` vs `drawProgram`), yet they fail TOGETHER in the same box.**

Enumerate what those two programs actually share. It is a short list:
1. **`oceanFlag` / the ocean-mask texture** (`u_oceanMaskTexture`) — both suppress on "land".
2. The GL context state (scissor / viewport / blend).
3. The map's paint order (something drawn OVER both).

Anything that gates only ONE of them (heatmap opacity, wash, blend-both, crest density, tile backoff, data
values) **cannot** explain the joint failure and should be deprioritised. That is the Jacobian: the symptom
flips only with a variable both programs read.

### PRIORITY 1 — the mask TEXTURE CONTENT (NOT yet tested; strongest lead)
Prior work verified the mask **coordinates** are correct (see §3.3) but **never read back the mask texture
values** in the blank box. A mask that reads LAND there would suppress heatmap *and* crests simultaneously —
exactly the observed signature.
- There is precedent for the mask being wrong in a region: **`64bd1ff6` "rebuild the base mask when the
  viewport escapes it on zoom-out — kills the SC/Cuba land-cover bleed"**, and
  `e8f10955`/`3299a1d1`/`8625841b` in the same family.
- Live probe showed `_lastMaskRepatchReason: "wide_delegate"` and `_cachedMaskTexDims {w:4096,h:2048}`,
  `_cachedMaskBounds` global, `maskTexIsCached: true`.
- **There is a purpose-built diagnostic already in the repo: `maskFloodProbe.js`** (the engine writes
  `this._probeState = { overlayOn, replace, z, maskBounds, waveBounds }` at ~`WebGLMarineEngine.js:1927`
  specifically so this probe samples exactly what the shader used). USE IT.
- **Do this:** GPU read-back of `u_oceanMaskTexture` over the blank box (lng −180..−160, lat 5..21) and compare
  against a known-ocean control (lng 175..180E, same lats — which DOES paint). If `.r` reads ~0 (land) in the
  box and ~1 in the control, the root is mask CONTENT, and the fix belongs in mask build/repatch, not the
  render path.

### PRIORITY 2 — GL scissor / viewport
The engine defensively calls `gl.disable(gl.SCISSOR_TEST)` (~`WebGLMarineEngine.js:1193`), which implies this
has bitten before. A stale scissor rect from another layer would clip BOTH programs to a rectangle.
- **Do this:** log `gl.getParameter(gl.SCISSOR_BOX)`, `gl.isEnabled(gl.SCISSOR_TEST)` and
  `gl.getParameter(gl.VIEWPORT)` at the top of the marine render, and compare to the canvas size
  (1764×1820 backing store at dpr 2 / 882×910 CSS — confirmed correct).

### PRIORITY 3 — paint order (a layer drawing OVER the marine layer)
Precedent: **`e4a6bdd0` "pin the inland-water repaints BELOW the marine layer — kills the close-zoom curtain"**.
⚠️ The marine layer is a **custom GL layer and does NOT appear in `map.getStyle().layers`** (verified: a scan
of all 143 layers found no marine/custom entry), so you must determine paint order another way — e.g. inspect
the custom-layer insertion point in `WebGLMarineCustomLayer` / where `map.addLayer(..., beforeId)` is called.

### PRIORITY 4 — world-copy geometry
The blank region is *exactly* what the **base world copy (offset 0, mercX [0,1])** should paint, while the
strip that DOES paint corresponds to the **−360 copy**. Suspicious — but it does **not** explain the horizontal
lat≈4.9 edge, so if you go here, assume TWO effects and isolate them separately.

---

## 3. ALREADY REFUTED — DO NOT RE-CHASE (each with the evidence)

1. **Overlay mask.** Nulled `_overlayMaskTex` (`overlayOn` requires it ⇒ overlay fully OFF) ⇒ **rectangle
   UNCHANGED**. ⚠️ A fix was planned here (wrap `o_u`, whose bounds are unwrapped e.g. −197.03..−148.47) and
   was **tested before shipping and found WRONG**. Do not resurrect it without new evidence.
2. **Heatmap bounds-gate blanking** (`_outData && _outMask ⇒ oceanAlpha = 0`). Killed via
   `__RAW_DISABLE_HEATMAP_BOUNDS_GATE__=true` ⇒ **unchanged**.
3. **Mask lookup COORDINATES.** `_probeState` → maskBounds global (−180..180 / −80..84), tex 4096×2048;
   computed `mask_u` = 0.986 @175°E, 0.014 @−175°, 0.042 @−165° — all in range and correctly wrapped.
   (This does NOT clear the mask *content* — see Priority 1.)
4. **Data hole.** Sampled the resident grid INSIDE the box: **n=80, null=0, zero=0, mean 1.92 m, max 2.54 m** —
   statistically identical to the painted areas (1.87 / 1.86). Data is healthy. *(This also rules out the
   3°-scramble "N-Pacific no-data" signature — see §5.)*
5. **Stale GL state / camera hammering.** Persists after a clean page reload at the same view.
6. **Environment health.** `areTilesLoaded=true`, `isStyleLoaded=true`, zero console errors, DPR backing store
   correct, resident = global 181×83 (−180..180), `wrapCull.needWrap=true` (world copies ARE drawn),
   `drawCallsPerFrame=7`, `washFloor.residentCovers=true`.

---

## 4. METHOD (brain rules — non-negotiable)

- **USE THE HARNESS: `frontend/scripts/zoomlab.js` for marine zoom/pan repro, and END every run with
  `node zoomlab-verdict.js`.** The previous session used ad-hoc browser camera jumps — slower, noisier, and it
  fights the app's controlled camera. If you must drive the camera live: `map.stop()` before AND after
  `jumpTo`, then let it settle before trusting telemetry (telemetry reflects the last RENDERED frame).
- **Forensics, not guessing.** Two first-hypotheses were wrong in the previous session. One was shipped and
  regressed live; the other was tested first and refuted. **Test the hypothesis before writing the fix.**
- **Never dismiss a visual anomaly as "expected/natural"** without proving the mechanism.
- **Every fix: instrument + kill-switch + live A/B + unit test.** Assert the REAL on-screen invariant, not
  metadata (the 3°-disaster lesson: a test that checked cols/rows instead of `len(vectors)==cols*rows` let a
  scrambled grid ship).
- Don't hammer the live map; rapid camera jumps + base eviction induce their own artifacts.

---

## 5. SCOPE GUARD — what this is NOT

- **NOT the 3° / LOD arc.** `e05c313e` (3°) was already reverted in `d2b2576f`. The data in the blank box is
  provably healthy, which was the 3° scramble's actual signature — so a "roll back the 3° work" reflex will
  not fix this and would reintroduce four verified fixes. (The user asked about this twice; answer with the
  data in §3.4.) The only arc piece still live is `41addb91` (`MARINE_MID_RES_MAX_SPAN` 40→400) — an **env
  var**, so it is a zero-code controlled experiment if you ever want to test it.
- **NOT the wind seam** (separate, rooted, own handoff).
- **NOT** the five fixes already committed this session — they are verified with kill-switch A/Bs. If you
  suspect one, flip its switch rather than reverting:
  `__RAW_TILE_BACKOFF_GATE_MODE__=off` · `__RAW_DISABLE_PARTICLE_LNG_WRAP__` · `__RAW_DISABLE_WRAP_CULL__` ·
  `__RAW_DISABLE_NONCOVERING_OVERLAY_DROP__` · `__RAW_DISABLE_ZOOMOUT_WASH_FLOOR__`.

## 6. DEFINITION OF DONE

The blank box is gone at the §1 repro, verified **3 ways** (telemetry + visual + kill-switch A/B), with a unit
test asserting the real invariant, the marine suite green, and **no regression at close zoom** (z≥9 coastal:
the overlay/mask carve behaviour must be unchanged). Then hand back to the queue in the other handoff.
