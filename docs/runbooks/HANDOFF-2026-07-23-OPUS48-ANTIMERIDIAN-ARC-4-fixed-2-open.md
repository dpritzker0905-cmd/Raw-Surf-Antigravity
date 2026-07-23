# HANDOFF 2026-07-23 (Opus 4.8) — THE ANTIMERIDIAN ARC: 5 fixes committed, 2 open

**STATUS: 5 commits on `dev`, NOT pushed (nothing is live). Working tree clean, suite green (714 marine tests).
Two symptoms remain OPEN and are rooted-but-unfixed. Supersedes the item-B section of
`HANDOFF-2026-07-23-OPUS48-EOD-marine-revert-and-open-forensics.md`.**

## 0. THE META-INSIGHT (read this first)

Every bug fixed today was **one family: ±180 / antimeridian handling**. The wide-zoom LOD arc did **not
create** them — it drove the map into antimeridian + wide-zoom territory that had never been exercised, and a
family of latent wrap/coverage assumptions began failing one by one. Two of the four predate the arc outright
(the `_needWrap` type bug dates to 2026-07-07).

**This is why a "roll back the 3° work" reflex is wrong** (the user asked twice, correctly): the 3° commit
`e05c313e` was ALREADY reverted (`d2b2576f`) before this session. Rolling back further would reintroduce the
four real defects below while leaving the two open symptoms — the open rectangle provably has healthy data,
which was the 3° scramble's actual signature. The one arc piece still live and worth a *controlled* test is
`41addb91` (`MARINE_MID_RES_MAX_SPAN` 40→400) — an **env var**, revertible with no code change.

## 1. COMMITTED (each verified 3 ways + kill-switch A/B; none pushed)

| Commit | Bug | Root | Kill |
|---|---|---|---|
| `89e466c8` | wide-zoom particle "split" | 180° PARTIAL tile's fract-wrap edge = a geographic teleport seam. Fix = **WHOLE-WORLD tile** (backoff 3, tileWidth 1.0) at z3-4 | `__RAW_TILE_BACKOFF_GATE_MODE__=off` |
| `2b482386` | crests died on ONE side of ±180 | shader LOOKUP lng un-wrapped: lookups only wrapped when the DATA BOUNDS crossed ±180, so on a global grid tex_u fell outside [0,1]. Fix = `fract(global_pos.x)` at **4** sites + `u_wrapLng` | `__RAW_DISABLE_PARTICLE_LNG_WRAP__` |
| `ec1c395d` | half the HEATMAP blanked at z≥4 | `_needWrap` read `.west/.east` on an **ARRAY** ⇒ all 3 antimeridian conditions were **DEAD CODE**; only `zoom<4` ever wrapped | `__RAW_DISABLE_WRAP_CULL__` |
| `16cfb368` | GRAY BOX over open water | stale viewport overlay applied in **REPLACE** while covering 0.263 of view (`_rawWideTrigger` has no coverage test) | `__RAW_DISABLE_NONCOVERING_OVERLAY_DROP__` |
| `f172f898` | heatmap CLEARS on zoom-out | resident stops covering at **z7.99** but `__coarseBridgeActive` only fires at **z6.29** ⇒ `_baseMult` falls back to `mult`(=0) ⇒ the coarse wash collapses. Fix = derive the bridge **geometrically** | `__RAW_DISABLE_ZOOMOUT_WASH_FLOOR__` |

Unit guard added: `WebGLMarineEngine.tileBackoff.test.js` (10 tests) asserts the REAL on-screen invariants
(whole-world tile, no edge-gap) — per the 3°-disaster lesson that a test which checks metadata instead of the
actual invariant lets a scrambled grid ship.

## 2. OPEN #1 — N-PACIFIC RECTANGLE (rooted-NOT, 5 hypotheses refuted)

Memory: [[marine-npacific-rectangle-open-2026-07-23]]. **Reproducible from a COLD reload.**

**Repro:** waves + EURO, `map.jumpTo({zoom:4.67, center:[-172.75, 9.05]})`.
**Geometry (measured via `map.unproject`, not eyeballed):** unpainted box = **lng > −180 AND lat > ~4.9°N**;
left edge is EXACTLY the antimeridian (canvas 20.5% → lng −180.0). Painted area is an L-shape (strip west of
±180 + everything below ~4.9°N).
**KEY SIGNATURE: the crest PARTICLES are missing in the box too** — they and the heatmap fail together, which
is the land/no-data signature; but the data is healthy, so it is a RENDER/paint failure.

**REFUTED — do NOT re-chase:**
1. Overlay mask — nulled `_overlayMaskTex` (overlayOn requires it) ⇒ overlay fully OFF ⇒ **unchanged**.
   (An `o_u` antimeridian-wrap fix was planned here and **tested before shipping — it was WRONG**.)
2. Bounds-gate blanking — `__RAW_DISABLE_HEATMAP_BOUNDS_GATE__` ⇒ **unchanged**.
3. Mask lookup misaligned — `_probeState`: maskBounds global, tex 4096×2048, `mask_u` 0.986@175E / 0.014@−175
   / 0.042@−165 — all correct and properly wrapped.
4. Data hole — sampled resident grid INSIDE the box: **n=80, null=0, zero=0, mean 1.92 m, max 2.54 m**,
   statistically identical to painted areas (1.87 / 1.86).
5. Stale GL state from camera hammering — persists after a clean reload at the same view.
Also healthy: tiles+style loaded, no console errors, DPR backing store correct (1764×1820 @dpr2), resident =
global 181×83 (−180..180), `wrapCull.needWrap=true` (copies ARE drawn), 7 draw calls.

**UNTESTED LEADS:** (a) the failing region is exactly what the **base world copy (offset 0, mercX [0,1])**
should paint while the strip that DOES paint is the **−360 copy** — but that doesn't explain the horizontal
lat edge, so it may be two effects; (b) a layer painting OVER the marine layer (precedent `e4a6bdd0` "pin the
inland-water repaints BELOW the marine layer") — note the marine layer is a **custom GL layer NOT listed in
`getStyle().layers`**, so check paint order another way; (c) a stale GL **scissor/viewport** (the engine
defensively calls `gl.disable(gl.SCISSOR_TEST)` ~:1193, which hints at history).

## 3. OPEN #2 — WIND ANTIMERIDIAN SEAM

Memory: [[wind-antimeridian-heatmap-seam-2026-07-23]]. A vertical seam at lng 180 at wide zoom.
**REFUTED:** data step (col0==col180 EXACT) · single-pass composite (persists with kill) · fine overlay
(re-tested at healthy 31fps) · base edge-feather (off for global) · **particle clamp/pile-up** (read back the
particle texture, histogrammed x over 147,456 particles: **0.61% at x≈0, 0.79% at x≈1 vs 0.5% uniform** ⇒ no
"dam"; wind wraps correctly via `nextPos.x = fract(nextPos.x)`) · copy geometry (layer passes `[0,360]`).
**Remaining:** world-copy SHARED-EDGE composite (two semi-transparent copies both rasterizing mercX=1.0).
Fix candidates: clip each copy to a half-open lng window, or render-once-offscreen.
⚠️ `WebGLWindShaders.js:117` and `:446` carry the **same latent un-wrapped LOOKUP-lng bug** marine had (only
bites at z>6, where wind switches to the camera-centered tile). Unfixed.

## 4. METHOD NOTES (earned the hard way today)

- **USE `frontend/scripts/zoomlab.js` for marine zoom/pan repro, and END every run with
  `node zoomlab-verdict.js`.** This session used ad-hoc browser camera jumps instead — slower, noisier, and
  it fights the app's controlled camera (`map.stop()` before/after `jumpTo`, and let it settle).
- **Never explain away a visual anomaly as "natural".** A faint line was dismissed as wind structure; it was a
  real seam. Subtlety is not evidence of innocence. See [[dont-dismiss-visual-anomalies-2026-07-23]].
- **Verify the hypothesis before shipping the fix.** Two first-hypotheses were wrong today: backoff-1 (shipped,
  regressed live — "animations continually clearing") and the `o_u` overlay wrap (tested, refuted, NOT shipped).
  The difference in cost is the whole argument for testing first.
- A **kill-switch on every fix** is what made all five A/B-provable in seconds.

## 5. NEXT STEPS (recommended order)

1. **Verify the 5 commits with the user**, then push (push = Render deploy; nothing is live yet).
2. **One systematic ANTIMERIDIAN AUDIT** rather than N bug hunts: enumerate every lng-derived lookup and every
   coverage predicate in the marine + wind engines/shaders, check each for the wrap case and for the
   array-vs-object shape, fix as a SET with one test matrix. Today proved they fail one at a time otherwise.
3. Open #1 rectangle: start from lead (b)/(c) above — paint order and scissor — since data/mask/overlay are
   all eliminated.
4. Optional controlled experiment for the user's LOD hypothesis: `MARINE_MID_RES_MAX_SPAN=40` (env only).
