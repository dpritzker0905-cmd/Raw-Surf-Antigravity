/**
 * marineUnpatchedMaskHold.js — do not draw the regional heatmap through a mask that has not yet had its basemap-water truth
 * (2026-11-08, owner report: "the wave heatmap bleeds into the Indian River Lagoon / Banana River / Mosquito Lagoon / ICW, then
 * corrects itself a moment later").
 *
 * THE WINDOW. The regional ocean mask is built in two steps. The encoder (WebGLMarineTextureEncoder, `renderMaskToCanvas`) rasterizes
 * Natural Earth land only: NE 10m calls every sea-connected lagoon WATER. The lagoon exclusion lives entirely in the SECOND step,
 * `refreshMaskWithBasemapWater` -> `overlayBasemapWaterOnMask` (WebGLMarineMaskRenderer.js): basemap water polygons, the inland-water
 * guard (inlandWaterGuard.js), then `suppressShelteredWater` (marineMaskShelter.js), which paints enclosed water 0.25, under the
 * heatmap's 0.5 discard. That step is async and gated: tile readiness (`isBasemapWaterSourceReady` is false mid-gesture), the 700 ms
 * layer throttle, the z>=6 gate. Until it lands, the mask the heatmap samples is the NE-only one, and the heatmap floods the lagoons.
 * Every commit that rebuilds the mask (a lane or model switch, a pan to other grid bounds, a zoom that crosses a mask tier) starts in
 * that state; `idle` / `sourcedata` close it a moment later, which is the "corrects itself" the owner sees.
 * The paint stamps `tex.__rsPatch` on the texture it painted (maskPatchKeep.stampMaskPatch), so "has this mask been painted" is
 * knowable per frame, for free.
 *
 * THE HOLD. While the bound regional mask is a mask the patch gate (z>=6, mask span <=16 deg) WILL paint but has not, the heatmap is
 * drawn at opacity 0 (the cold-veil precedent, marineColdVeil.js: a bounded hide beats a wrong field). Bounded: after HOLD_MS the
 * heatmap draws regardless (fail open: a source that never becomes queryable must not leave the sea blank), and a mask that a viewport
 * overlay is already carving (`overlayOn`) is not held. Only the heatmap is held; crests and particles keep their own 0.3 mask cull.
 * Kill: window.__RAW_DISABLE_UNPATCHED_MASK_HOLD__ = true (draw through the NE-only mask, as before). Tune: __RAW_UNPATCHED_MASK_HOLD_MS__.
 */
export const HOLD_MS = 1200;
const PATCH_MIN_Z = 6;       // WebGLMarineLayer refresh gate: below it nothing patches, so nothing is waited for
const PATCH_MAX_SPAN = 16;   // WebGLMarineLayer commit gate (_ms <= 16): wider masks are not patched by the commit path

const W = () => (typeof window !== 'undefined' ? window : {});

/** Pure verdict: is the mask bound for this frame one that is still waiting for its basemap-water paint? */
export function maskAwaitsPatch(o) {
  const w = o.win || W();
  if (w.__RAW_DISABLE_UNPATCHED_MASK_HOLD__ === true) return false;
  const { tex, cachedTex, bounds, z, overlayOn } = o;
  if (!tex || tex !== cachedTex || !bounds || overlayOn) return false;   // not the engine's own rebuilt regional mask
  if (!(z >= PATCH_MIN_Z)) return false;
  const span = (bounds.east < bounds.west ? bounds.east + 360 : bounds.east) - bounds.west;
  if (!(span > 0 && span <= PATCH_MAX_SPAN)) return false;
  return !tex.__rsPatch;                                                 // never painted with basemap water
}

/**
 * Per-frame opacity multiplier (0 while held, else 1). `engine._maskHold` remembers when this texture first waited, so the hold ends
 * by itself. o: { tex, cachedTex, bounds, z, overlayOn, nowMs?, win? }.
 */
export function unpatchedMaskHold(engine, o) {
  const w = o.win || W();
  const now = Number.isFinite(o.nowMs) ? o.nowMs : (typeof performance !== 'undefined' ? performance.now() : Date.now());
  let mult = 1;
  if (!maskAwaitsPatch(o)) {
    engine._maskHold = null;
  } else {
    if (!engine._maskHold || engine._maskHold.tex !== o.tex) engine._maskHold = { tex: o.tex, t0: now };
    const limit = Number(w.__RAW_UNPATCHED_MASK_HOLD_MS__) || HOLD_MS;
    mult = now - engine._maskHold.t0 < limit ? 0 : 1;
  }
  if (w.__RAW_GPU__) w.__RAW_GPU__.unpatchedMaskHold = engine._maskHold ? { held: mult === 0, ms: Math.round(now - engine._maskHold.t0) } : null;
  return mult;
}
